/*! Open Historia — SSE stream reassembly for buffered/tool calls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Turning a streamed response back into the buffered envelope the extractors in
// main.jsx already understand, so a call can stream WITHOUT the rest of the code
// learning that it did.
//
// Two reasons a call streams:
//
//   1. Cancel. Local inference servers (llama.cpp, LM Studio, Ollama) only notice
//      a dead connection when they next WRITE, so a non-streaming request keeps
//      generating after Cancel — the reported "cancel doesn't actually stop my
//      local model". Streaming makes the stop physical: the next token write
//      fails and inference halts within a token or two.
//
//   2. Staying alive. A hosted gateway times a request out when nothing crosses
//      the wire, and a timeline jump is the longest request the game makes — a
//      ~190 KB prompt asking for 30+ events, which at an observed 27 chars/s is
//      tens of minutes. A buffered tool call sends zero bytes for that whole
//      span, so a proxy closes it: the field report behind this was a 502 at
//      exactly 301.7s on a healthy endpoint. Streamed, each delta resets the
//      idle timer.
//
// Anthropic makes the second point sharper: it REFUSES a non-streaming request
// whose max_tokens implies a long generation, and the game sends max_tokens
// 64000 uncapped, so those jumps could be rejected before generating at all.
//
// Each reader also takes an `onToolProgress` hook, which is how a time skip shows
// its events arriving one by one (streamedEvents.js). It fires as the tool call's
// arguments grow, with `json` for partial-JSON text or `args`+`paths` for the
// object partialArgs fragments build. Purely an observer: what it does or throws
// can never change the envelope returned here.
//
// Separate from main.jsx (which pulls in the whole browser runtime and so cannot
// be unit-tested) for the same reason as jsonSalvage.js, providerErrors.js and
// geminiSchema.js. Its one import, streamedEvents.js, imports nothing, so this
// still runs under bare node. The frame reducers are exported separately from
// the readers so tests can drive them frame by frame: a tool call split
// mid-argument, or a stream that ends halfway through one, is otherwise unreachable.

import { parseJsonPathSteps, partialArgValue, setAtJsonPath } from "./streamedEvents.js";

const observe = (hook, payload) => {
    if (typeof hook !== "function") return;
    try { hook(payload); } catch { /* a progress listener must not break the stream */ }
};

// ---------------------------------------------------------------------------
// SSE plumbing

// Reads an SSE body and hands each `data:` payload to onFrame as parsed JSON.
// Non-JSON and keep-alive lines are skipped rather than thrown on: a gateway
// that injects comments or padding must not break a turn.
//
// `onActivity` fires once per network chunk — before the chunk is parsed, and
// whether or not it contained a whole frame. It is what "Limit AI generation"
// counts (idleDeadline.js): the question that setting asks is whether anything
// is still arriving, and a keep-alive comment or half a frame answers it just as
// well as a token does. Wrapped like the onChunk callbacks, since a throwing UI
// callback must never cost the player a turn.
async function readSSE(response, onFrame, onActivity) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (onActivity) {
                try { onActivity(); } catch { /* a watchdog callback must not break the stream */ }
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                let chunk;
                try { chunk = JSON.parse(data); } catch { continue; }
                onFrame(chunk);
            }
        }
    } finally {
        try { reader.releaseLock(); } catch { /* stream already closed */ }
    }
}

// ---------------------------------------------------------------------------
// OpenAI-style chat completions

export const createOpenAIStreamState = () => ({
    content: "",
    reasoning: "",
    // One entry per tool call, in stream order. A jump makes one call; a task
    // with lookup functions (lookupTools.js) may make several in one turn,
    // each arriving under its own `index` in the tool_calls deltas.
    toolCalls: [],
    finishReason: null,
    streamError: null,
    usage: null,
});

export function applyOpenAIFrame(state, chunk, onToolProgress) {
    // A gateway that ignored stream:true, or one that is overloaded, puts its
    // error in a frame on an otherwise fine 200. Keep it so the caller can tell
    // "busy, ask again" from "the model said nothing".
    if (chunk?.error && !state.streamError) state.streamError = chunk.error;
    // Token accounting rides on the final frame and has no `choices`, so it has
    // to be picked up before the early return below. Native OpenAI only sends it
    // when asked (stream_options.include_usage); most local gateways send it
    // unprompted. Kept whenever it appears — see usageStats.js.
    if (chunk?.usage && typeof chunk.usage === "object") state.usage = chunk.usage;
    const choice = chunk?.choices?.[0];
    if (!choice) return state;
    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === "string") {
        state.content += delta.content;
        // The lower rungs of the ladder (structuredMode.js) put the payload in
        // content, not a tool call, so a watcher has to hear that too.
        if (delta.content) observe(onToolProgress, { name: "", json: state.content });
    }
    // Thinking-mode models (Qwen3, DeepSeek-R1) stream their chain of thought in a
    // separate reasoning field; keep it so an all-reasoning delta isn't lost (#540).
    if (typeof delta.reasoning === "string") state.reasoning += delta.reasoning;
    else if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        if (!call || typeof call !== "object") continue;
        // Deltas name their call by index. A gateway that sends none is taken
        // to be continuing the latest call — unless it opens a new one by id,
        // as a buffered message with several complete calls does.
        const latest = state.toolCalls.length - 1;
        let position = Number.isInteger(call.index) ? call.index : latest;
        if (position < 0) position = 0;
        else if (!Number.isInteger(call.index) && call.id && state.toolCalls[position]?.id && state.toolCalls[position].id !== call.id) position = latest + 1;
        while (state.toolCalls.length <= position) state.toolCalls.push({ id: "", name: "", arguments: "" });
        const entry = state.toolCalls[position];
        if (call.id && !entry.id) entry.id = String(call.id);
        if (call.function?.name) entry.name = call.function.name;
        if (typeof call.function?.arguments === "string" && call.function.arguments) {
            entry.arguments += call.function.arguments;
            observe(onToolProgress, { name: entry.name, json: entry.arguments });
        }
    }
    if (choice.finish_reason) state.finishReason = choice.finish_reason;
    return state;
}

export function finishOpenAIStream(state) {
    return {
        choices: [{
            finish_reason: state.finishReason,
            message: {
                content: state.content,
                ...(state.reasoning ? { reasoning: state.reasoning } : {}),
                ...(state.toolCalls.length
                    ? { tool_calls: state.toolCalls.map((call) => ({
                        ...(call.id ? { id: call.id } : {}),
                        type: "function",
                        function: { name: call.name, arguments: call.arguments },
                    })) }
                    : {}),
            },
        }],
        ...(state.streamError ? { error: state.streamError } : {}),
        ...(state.usage ? { usage: state.usage } : {}),
    };
}

export async function readOpenAIStreamedResponse(response, onActivity, onToolProgress) {
    const state = createOpenAIStreamState();
    await readSSE(response, (chunk) => applyOpenAIFrame(state, chunk, onToolProgress), onActivity);
    return finishOpenAIStream(state);
}

// ---------------------------------------------------------------------------
// Anthropic Messages

export const createAnthropicStreamState = () => ({
    // Keyed by content-block index, because Anthropic interleaves blocks and the
    // deltas only carry the index — a jump that thinks, then writes a sentence,
    // then calls the tool is three blocks whose deltas arrive under one stream.
    blocks: new Map(),
    stopReason: null,
    streamError: null,
    // Anthropic splits the accounting across two events: message_start carries
    // the input side (including the cache_read figure that proves a prefix cache
    // hit), message_delta the output side. Merged rather than replaced.
    usage: null,
});

const blockAt = (state, index) => {
    const key = Number(index) || 0;
    if (!state.blocks.has(key)) state.blocks.set(key, { type: "", name: "", id: "", text: "", json: "" });
    return state.blocks.get(key);
};

export function applyAnthropicFrame(state, chunk, onToolProgress) {
    const type = chunk?.type;

    // overloaded_error arrives as an error EVENT on a 200 stream, so the
    // status-code retry in main.jsx never sees it. Surface it instead.
    if (type === "error" && !state.streamError) {
        state.streamError = chunk.error ?? chunk;
        return state;
    }

    // message_start opens with the input-token side of the accounting.
    if (type === "message_start" && chunk.message?.usage) {
        state.usage = { ...state.usage, ...chunk.message.usage };
        return state;
    }

    if (type === "content_block_start") {
        const block = blockAt(state, chunk.index);
        block.type = chunk.content_block?.type ?? "";
        // tool_use blocks name the tool up front; the arguments follow as deltas.
        if (typeof chunk.content_block?.name === "string") block.name = chunk.content_block.name;
        if (typeof chunk.content_block?.id === "string") block.id = chunk.content_block.id;
        if (typeof chunk.content_block?.text === "string") block.text += chunk.content_block.text;
        // Normally {} here, with the real arguments following as deltas — and
        // the whole input when the call takes none (list_powers({})), which
        // then gets no delta at all.
        if (chunk.content_block?.input && typeof chunk.content_block.input === "object") block.input = chunk.content_block.input;
        return state;
    }

    // The block is whole: a tool call with no argument deltas was not cut off.
    if (type === "content_block_stop") {
        blockAt(state, chunk.index).closed = true;
        return state;
    }

    if (type === "content_block_delta") {
        const block = blockAt(state, chunk.index);
        const delta = chunk.delta ?? {};
        if (delta.type === "text_delta" && typeof delta.text === "string") block.text += delta.text;
        // The tool's arguments, streamed as PARTIAL JSON — never valid on its own
        // until the block closes. Concatenated verbatim and parsed once at the end.
        else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            block.json += delta.partial_json;
            observe(onToolProgress, { name: block.name, json: block.json });
        }
        // Extended thinking. Deliberately not accumulated into text: extractAnthropicText
        // has always filtered thinking out, and a chain of thought must never be
        // handed back as if it were the answer.
        return state;
    }

    if (type === "message_delta") {
        if (chunk.delta?.stop_reason) state.stopReason = chunk.delta.stop_reason;
        // The output-token side. Merged onto message_start's input side rather
        // than replacing it, or the input and cache figures would be lost.
        if (chunk.usage) state.usage = { ...state.usage, ...chunk.usage };
    }

    return state;
}

// Rebuilds the Messages envelope. extractAnthropicText reads `text` blocks and
// extractAnthropicToolInput finds the `tool_use` block by name, so both work on
// this unchanged.
//
// A tool_use block whose JSON does not parse is one the stream was cut off
// partway through. It is deliberately emitted with NO input rather than a
// half-object: a shortened turn presented as a whole one is worse than falling
// back (see jsonSalvage.js). The raw fragment comes back on partialToolJson for
// the diagnostics log only — never as content, where a salvage pass could find a
// balanced fragment inside it and apply half a turn.
//
// A call that takes no arguments streams no JSON at all. Once its block has
// closed (or the message stopped to use a tool) it is whole, and goes out with
// the input its start event carried, {} — it used to vanish, which lost a
// lookup like list_powers({}) and wasted the request.
export function finishAnthropicStream(state) {
    const content = [];
    let partialToolJson = "";

    for (const key of [...state.blocks.keys()].sort((a, b) => a - b)) {
        const block = state.blocks.get(key);
        if (block.type === "tool_use") {
            let input = null;
            try {
                input = block.json
                    ? JSON.parse(block.json)
                    : (block.closed || state.stopReason === "tool_use" ? (block.input ?? {}) : null);
            } catch {
                input = null;
            }
            if (input && typeof input === "object") {
                content.push({ type: "tool_use", id: block.id, name: block.name, input });
            } else if (block.json) {
                partialToolJson = block.json;
            }
            continue;
        }
        if (block.text) content.push({ type: "text", text: block.text });
    }

    return {
        content,
        stop_reason: state.stopReason,
        ...(state.streamError ? { error: state.streamError } : {}),
        ...(partialToolJson ? { partialToolJson } : {}),
        ...(state.usage ? { usage: state.usage } : {}),
    };
}

export async function readAnthropicStreamedResponse(response, onActivity, onToolProgress) {
    const state = createAnthropicStreamState();
    await readSSE(response, (chunk) => applyAnthropicFrame(state, chunk, onToolProgress), onActivity);
    return finishAnthropicStream(state);
}

// ---------------------------------------------------------------------------
// Gemini generateContent
//
// Gemini was the last provider whose TOOL calls were still sent buffered — and
// it is the default provider, so a timeline jump on a stock install was the one
// request in the game that sent nothing over the wire for the whole generation.
// That is precisely what a proxy or an API edge cuts (reason 2 at the top of
// this file), and the player cannot tell that cut apart from the "Limit AI
// generation" setting doing its job.
//
// Gemini sends a function call two ways, and both land here.
//
// Whole, in one part, with `args` already an object. Nothing to reassemble, and
// it is all the Gemini Developer API ever sends, so a Gemini skip's events
// arrive together; callGemini says why.
//
// Or as `partialArgs` fragments, when the request asked for them. That field is
// Vertex-only and the game does not ask, but the reader is kept because it costs
// nothing idle and is all that asking would need. Each fragment reads
//   { jsonPath: "$.events[3].title", stringValue: "Ulti", willContinue: true }
// naming where in the arguments the piece belongs; functionCall.willContinue
// marks the call finished.
//
// A call that never finishes is dropped, as finishAnthropicStream drops a
// tool_use whose JSON will not parse: cut-off fragments assemble into a valid
// object missing half the turn, and half a turn shown as a whole one is worse
// than falling back. The fragment goes to partialToolJson for the log only.

export const createGeminiStreamState = () => ({
    text: "",
    calls: [],
    // Calls still assembling from partialArgs, keyed by id or name: several can
    // run at once and their fragments arrive interleaved.
    partial: new Map(),
    finishReason: null,
    streamError: null,
    // Gemini repeats usageMetadata on frames as the answer grows, each one
    // cumulative, so the last is the total. Kept unconditionally rather than
    // only on the final frame, since a stream cut short still reports what it
    // had spent.
    usage: null,
});

// Writes one part's fragments in, returning the paths it touched.
const applyPartialArgs = (entry, fragments) => {
    const touched = [];
    for (const fragment of fragments) {
        const path = String(fragment?.jsonPath ?? "");
        if (!path) continue;
        const steps = parseJsonPathSteps(path);
        if (!steps.length) continue;
        // Two fragments in a row for the same path are one value split in flight,
        // so the second continues the first. Read from the path rather than the
        // fragment's willContinue flag, which says the same thing: an endpoint
        // that forgets to set it would leave only the last syllable of a title.
        const continuing = entry.lastPath === path;
        let value = partialArgValue(fragment);
        // No value field at all can only be the empty remainder of a string in flight.
        if (value === undefined) {
            if (!continuing) continue;
            value = "";
        }
        setAtJsonPath(entry.args, steps, value, { append: continuing });
        entry.lastPath = path;
        touched.push(path);
    }
    return touched;
};

// A thoughtSignature must go back when the call is echoed, so it is kept exactly
// as it arrived, from whichever part of a streamed call carried it.
const withThoughtSignature = (part, functionCall) => ({
    functionCall,
    ...(part?.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
    ...(part?.thought_signature ? { thought_signature: part.thought_signature } : {}),
});

const applyGeminiFunctionCall = (state, part, onToolProgress) => {
    const call = part.functionCall ?? {};
    const key = String(call.id || call.name || "");
    const fragments = Array.isArray(call.partialArgs) ? call.partialArgs : [];
    const pending = state.partial.get(key);

    // The whole call in one part: pushed verbatim, exactly as it always was.
    if (!pending && !fragments.length && call.willContinue !== true) {
        state.calls.push(withThoughtSignature(part, call));
        return;
    }

    const entry = pending ?? { name: "", id: "", args: {}, lastPath: "", part: null };
    if (!pending) state.partial.set(key, entry);
    if (call.name) entry.name = String(call.name);
    if (call.id) entry.id = String(call.id);
    if (part?.thoughtSignature || part?.thought_signature) entry.part = part;

    const touched = applyPartialArgs(entry, fragments);
    if (touched.length) observe(onToolProgress, { name: entry.name, args: entry.args, paths: touched });
    // A final part that repeats the arguments whole is the authority on them.
    if (call.args && typeof call.args === "object") entry.args = call.args;

    if (call.willContinue === true) return;
    state.partial.delete(key);
    state.calls.push(withThoughtSignature(entry.part, {
        name: entry.name,
        ...(entry.id ? { id: entry.id } : {}),
        args: entry.args,
    }));
};

export function applyGeminiFrame(state, chunk, onToolProgress) {
    // Gemini reports an overloaded model or a safety refusal INSIDE an otherwise
    // fine 200 stream, exactly as the other two do; keep the first one.
    if (chunk?.error && !state.streamError) state.streamError = chunk.error;
    // A prompt blocked before generation starts carries no candidates at all —
    // without this the caller would only see an empty answer and guess.
    if (chunk?.promptFeedback?.blockReason && !state.streamError) {
        state.streamError = { message: `Gemini blocked the prompt (${chunk.promptFeedback.blockReason}).` };
    }
    if (chunk?.usageMetadata && typeof chunk.usageMetadata === "object") state.usage = chunk.usageMetadata;
    const candidate = chunk?.candidates?.[0];
    if (!candidate) return state;
    for (const part of candidate.content?.parts ?? []) {
        // NOT trimmed: the parts are joined verbatim and only trimmed once at the
        // end, or a chunk boundary that falls on a space runs two words together.
        if (typeof part?.text === "string") state.text += part.text;
        if (part?.functionCall) applyGeminiFunctionCall(state, part, onToolProgress);
    }
    if (candidate.finishReason) state.finishReason = candidate.finishReason;
    return state;
}

// Rebuilds the generateContent envelope. joinGeminiParts and
// extractGeminiToolInput (main.jsx) read `candidates[0].content.parts`, so both
// work on this unchanged — which is the whole point: the jump path does not
// learn that it streamed.
export function finishGeminiStream(state) {
    // Anything still assembling was cut off mid-call: left out of the parts, kept
    // only as text for the log.
    let partialToolJson = "";
    for (const entry of state.partial?.values() ?? []) {
        try { partialToolJson = JSON.stringify(entry.args); } catch { partialToolJson = ""; }
    }

    return {
        candidates: [{
            content: {
                role: "model",
                parts: [
                    ...(state.text ? [{ text: state.text }] : []),
                    ...state.calls,
                ],
            },
            finishReason: state.finishReason,
        }],
        ...(state.streamError ? { error: state.streamError } : {}),
        ...(partialToolJson ? { partialToolJson } : {}),
        ...(state.usage ? { usageMetadata: state.usage } : {}),
    };
}

export async function readGeminiStreamedResponse(response, onActivity, onToolProgress) {
    const state = createGeminiStreamState();
    await readSSE(response, (chunk) => applyGeminiFrame(state, chunk, onToolProgress), onActivity);
    return finishGeminiStream(state);
}
