/*! Open Historia — SSE stream reassembly for buffered/tool calls © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
// Kept import-free and separate from main.jsx (which pulls in the whole browser
// runtime and so cannot be unit-tested) for the same reason as jsonSalvage.js,
// providerErrors.js and geminiSchema.js. The frame reducers are exported
// separately from the readers so tests can drive them frame by frame — the cases
// that matter (a tool call split mid-argument across frames, a stream that ends
// halfway through one) are otherwise unreachable.

// ---------------------------------------------------------------------------
// SSE plumbing

// Reads an SSE body and hands each `data:` payload to onFrame as parsed JSON.
// Non-JSON and keep-alive lines are skipped rather than thrown on: a gateway
// that injects comments or padding must not break a turn.
async function readSSE(response, onFrame) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
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
    toolName: "",
    toolArguments: "",
    finishReason: null,
    streamError: null,
});

export function applyOpenAIFrame(state, chunk) {
    // A gateway that ignored stream:true, or one that is overloaded, puts its
    // error in a frame on an otherwise fine 200. Keep it so the caller can tell
    // "busy, ask again" from "the model said nothing".
    if (chunk?.error && !state.streamError) state.streamError = chunk.error;
    const choice = chunk?.choices?.[0];
    if (!choice) return state;
    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === "string") state.content += delta.content;
    // Thinking-mode models (Qwen3, DeepSeek-R1) stream their chain of thought in a
    // separate reasoning field; keep it so an all-reasoning delta isn't lost (#540).
    if (typeof delta.reasoning === "string") state.reasoning += delta.reasoning;
    else if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
    const call = Array.isArray(delta.tool_calls) ? delta.tool_calls[0] : null;
    if (call?.function?.name) state.toolName = call.function.name;
    if (typeof call?.function?.arguments === "string") state.toolArguments += call.function.arguments;
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
                ...(state.toolName || state.toolArguments
                    ? { tool_calls: [{ type: "function", function: { name: state.toolName, arguments: state.toolArguments } }] }
                    : {}),
            },
        }],
        ...(state.streamError ? { error: state.streamError } : {}),
    };
}

export async function readOpenAIStreamedResponse(response) {
    const state = createOpenAIStreamState();
    await readSSE(response, (chunk) => applyOpenAIFrame(state, chunk));
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
});

const blockAt = (state, index) => {
    const key = Number(index) || 0;
    if (!state.blocks.has(key)) state.blocks.set(key, { type: "", name: "", id: "", text: "", json: "" });
    return state.blocks.get(key);
};

export function applyAnthropicFrame(state, chunk) {
    const type = chunk?.type;

    // overloaded_error arrives as an error EVENT on a 200 stream, so the
    // status-code retry in main.jsx never sees it. Surface it instead.
    if (type === "error" && !state.streamError) {
        state.streamError = chunk.error ?? chunk;
        return state;
    }

    if (type === "content_block_start") {
        const block = blockAt(state, chunk.index);
        block.type = chunk.content_block?.type ?? "";
        // tool_use blocks name the tool up front; the arguments follow as deltas.
        if (typeof chunk.content_block?.name === "string") block.name = chunk.content_block.name;
        if (typeof chunk.content_block?.id === "string") block.id = chunk.content_block.id;
        if (typeof chunk.content_block?.text === "string") block.text += chunk.content_block.text;
        return state;
    }

    if (type === "content_block_delta") {
        const block = blockAt(state, chunk.index);
        const delta = chunk.delta ?? {};
        if (delta.type === "text_delta" && typeof delta.text === "string") block.text += delta.text;
        // The tool's arguments, streamed as PARTIAL JSON — never valid on its own
        // until the block closes. Concatenated verbatim and parsed once at the end.
        else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") block.json += delta.partial_json;
        // Extended thinking. Deliberately not accumulated into text: extractAnthropicText
        // has always filtered thinking out, and a chain of thought must never be
        // handed back as if it were the answer.
        return state;
    }

    if (type === "message_delta" && chunk.delta?.stop_reason) {
        state.stopReason = chunk.delta.stop_reason;
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
export function finishAnthropicStream(state) {
    const content = [];
    let partialToolJson = "";

    for (const key of [...state.blocks.keys()].sort((a, b) => a - b)) {
        const block = state.blocks.get(key);
        if (block.type === "tool_use") {
            let input = null;
            try {
                input = block.json ? JSON.parse(block.json) : null;
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
    };
}

export async function readAnthropicStreamedResponse(response) {
    const state = createAnthropicStreamState();
    await readSSE(response, (chunk) => applyAnthropicFrame(state, chunk));
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
// Unlike Anthropic's, a Gemini functionCall is not streamed as partial JSON: it
// arrives whole, in one part, with `args` already an object. So there is nothing
// to reassemble for it — only the text parts accumulate — and a stream that ends
// early yields no call at all rather than half of one, which is the outcome
// finishAnthropicStream goes to some length to guarantee.

export const createGeminiStreamState = () => ({
    text: "",
    calls: [],
    finishReason: null,
    streamError: null,
});

export function applyGeminiFrame(state, chunk) {
    // Gemini reports an overloaded model or a safety refusal INSIDE an otherwise
    // fine 200 stream, exactly as the other two do; keep the first one.
    if (chunk?.error && !state.streamError) state.streamError = chunk.error;
    // A prompt blocked before generation starts carries no candidates at all —
    // without this the caller would only see an empty answer and guess.
    if (chunk?.promptFeedback?.blockReason && !state.streamError) {
        state.streamError = { message: `Gemini blocked the prompt (${chunk.promptFeedback.blockReason}).` };
    }
    const candidate = chunk?.candidates?.[0];
    if (!candidate) return state;
    for (const part of candidate.content?.parts ?? []) {
        // NOT trimmed: the parts are joined verbatim and only trimmed once at the
        // end, or a chunk boundary that falls on a space runs two words together.
        if (typeof part?.text === "string") state.text += part.text;
        if (part?.functionCall) state.calls.push(part.functionCall);
    }
    if (candidate.finishReason) state.finishReason = candidate.finishReason;
    return state;
}

// Rebuilds the generateContent envelope. joinGeminiParts and
// extractGeminiToolInput (main.jsx) read `candidates[0].content.parts`, so both
// work on this unchanged — which is the whole point: the jump path does not
// learn that it streamed.
export function finishGeminiStream(state) {
    return {
        candidates: [{
            content: {
                role: "model",
                parts: [
                    ...(state.text ? [{ text: state.text }] : []),
                    ...state.calls.map((functionCall) => ({ functionCall })),
                ],
            },
            finishReason: state.finishReason,
        }],
        ...(state.streamError ? { error: state.streamError } : {}),
    };
}

export async function readGeminiStreamedResponse(response) {
    const state = createGeminiStreamState();
    await readSSE(response, (chunk) => applyGeminiFrame(state, chunk));
    return finishGeminiStream(state);
}
