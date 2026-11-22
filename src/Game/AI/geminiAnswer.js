/*! Open Historia — how a Gemini task's answer is asked for © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The requests behind one Gemini call that has an output function (a task) or
// none (a plain reply): which form each is sent in, and what is read back from
// it. main.jsx callGemini hands it everything that is the provider's business
// (the URLs, the retry rules, the errors it throws); what is here is the part a
// test can drive with a fake fetch (geminiAnswer.test.js).
//
// How a Gemini skip's events arrive one by one, as every other provider's do
// (streamedEvents.js).
//
// Streaming a tool call's arguments needs partialArgs, and
// toolConfig.functionCallingConfig.streamFunctionCallArguments is Vertex-only:
// this API's v1beta discovery doc (revision 20260918) gives FunctionCallingConfig
// only `mode` and `allowedFunctionNames`. Sending it buys a 400 and costs the
// player a request, so it is not sent, and a skip asked for as a function call
// arrives whole.
//
// Text does stream, so a watched skip is asked for as JSON text: the answer's
// mime type set to application/json, and the function's contract written out in
// the prompt in place of its declaration (schemaOutline.js buildAnswerFormatBlock).
// Gemini refuses a response mime type alongside tools ("Function calling with a
// response mime type: 'application/json' is unsupported"), so a request that
// carries the mime type declares no function at all.
//
// A skip that has lookup functions is split the same way (a player's log,
// 2026-11-10: every skip's first request refused, then answered whole). Its
// lookup round declares the lookup functions ALONE, free to ask or to answer
// (mode AUTO), with the contract in the prompt as above and no mime type; the
// output function's declaration, the one with the grammar ceiling below, is not
// sent. A model that answers there, with no question, has its text taken as the
// answer, and it streams as it is written. A model that asks has its questions
// answered, and the next request is the last: no function declared, the mime
// type set, the round's calls and answers in the history (measured live
// 2026-11-10, gemini-3.5-flash-lite: a signed call and its response with no
// tools declared, then the answer in six frames). So a skip that looks things up
// once costs the two requests it always did, and one that does not costs one.
// Only one round is asked this way: the lookup rules tell the model to ask
// everything in its first turn, and a round answered on an earlier attempt (a
// Fallback entry, a retry) counts. The round limit and the skip's budget still
// decide whether there is a round at all (main.jsx runWithLookups,
// `requireOutputTool`).
//
// Not generationConfig.responseSchema, which was built first and measured
// against the live API on 2026-10-05 (gemini-3.5-flash-lite): the schema is
// compiled into a grammar with a ceiling on its size, and the skip's contract
// sits at it. As it stood it was refused, 400 "Request contains an invalid
// argument"; with its four unions merged into single objects it passed; with the
// Projects board's ops added it was refused again; and the same weight spent
// anywhere else (the stats block, the institution ops) tipped it the same way.
// That ceiling has moved before (geminiSchema.js), so a contract that passes
// today is no promise. A function declaration is compiled the same way, with the
// lookup functions declared beside it counted against the same ceiling (the log
// above: refused at 28,894 characters with the 25 lookup functions beside it,
// where 30,489 had passed alone). Written into the prompt, the contract's size
// costs tokens and nothing else: measured the same day, the whole folded
// contract is about 5,800 tokens there, fewer than its declaration, the answer
// arrived in 72 frames with no gap over 0.2 s, in the order the outline gives its
// fields, and it passed the task's validation as written. What holds an answer
// to the contract is that validation, as it does for every model that has no
// function calling at all.
//
// A model that refuses the text form itself is asked again at once as the
// function call it always was, and that way for the rest of the session rather
// than paying a refused request per skip.
//
// streamAssembly.js still assembles partialArgs if they ever arrive, so the day
// the field reaches this API, asking for it is the only change.
import { toGeminiSchema } from "./geminiSchema.js";
import { buildAnswerFormatBlock } from "./schemaOutline.js";
import { readGeminiStreamedResponse } from "./streamAssembly.js";
import { geminiContentsFromHistory, lookupCallsFromGemini } from "./toolTurns.js";
import { classifyProviderFailure, errorPayloadText, extractErrorMessage, isBusyErrorPayload, toolStreamRefusalError } from "./providerErrors.js";
import { logDebugEvent } from "../../runtime/debugLog.js";

export const geminiJsonAnswerRefusals = new Set();

// The other way round: a model that refuses a task's function call as a request,
// 400 "Request contains an invalid argument" before a word is written (a
// player's log, 2026-11-06: thirty time skips, every one to the canned events),
// is asked again at once with the contract written into the prompt as JSON text,
// which has no grammar to outgrow, and that way for the rest of the session. A
// task that also has lookup functions is asked the split way above.
export const geminiFunctionCallRefusals = new Set();

// Whether a task's answer is asked for as JSON text rather than as a call of its
// output function: a watched one (its events shown as they are written), unless
// the model refused that form this session, and every task of a model that
// refused the call.
export const geminiAnswersAsText = (model, { watched = false } = {}) => geminiFunctionCallRefusals.has(model)
    || (watched && !geminiJsonAnswerRefusals.has(model));

// The form one request takes:
//   "plain"    no output function: a reply in words;
//   "call"     the output function declared, the lookup functions beside it,
//              one of them must be called (mode ANY);
//   "lookups"  the lookup functions alone, free to ask or to answer (AUTO), the
//              contract in the prompt, no mime type;
//   "json"     no function declared, the mime type application/json, the
//              contract in the prompt.
export const geminiRequestForm = ({ tool = null, lookupCount = 0, asText = false, requireOutputTool = false, lookupRoundsAnswered = 0 } = {}) => {
    if (!tool) return "plain";
    if (!asText) return "call";
    return lookupCount > 0 && !requireOutputTool && !(Number(lookupRoundsAnswered) > 0) ? "lookups" : "json";
};

export function joinGeminiParts(parts) {
    return (parts ?? [])
    .map((part) => part?.text ?? "")
    .join("")
    .trim();
}

export function extractGeminiToolInput(data, tool) {
    const call = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part?.functionCall)
    .find((entry) => entry?.name === tool?.name);
    return call?.args && typeof call.args === "object" ? call.args : null;
}

// The whole answer of a JSON-mode request, or null when it is not one object
// (cut off, fenced, prose around it): the task's own salvage reads those from
// the raw text.
export function parseGeminiJsonAnswer(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

// The lookup rules a task's prompt carries (lookupTools.js LOOKUP_DIRECTIVE) say
// the lookup functions sit beside an output function and the answer is a call
// of it, in up to three rounds. Asked the split way there is no such function
// and one round, so the requests say so, the same words on both, ahead of the
// contract they point to: the round and the answer then share their whole
// system instruction, which is what Gemini caches.
export const GEMINI_TEXT_ANSWER_NOTE = [
    "[Answering Without an Output Function]",
    "This conversation has no output function to call. Wherever the instructions above say to call the output function, write the complete answer as your reply instead: the one JSON object described below, and nothing else.",
    "The lookup functions are offered in your first turn only. Call every one you will need there, all in that turn, or write the answer at once if you need none.",
].join("\n");

const declarationOf = (entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: toGeminiSchema(entry.schema),
});

// The size of the functions a request declares, as Gemini is sent them: the
// output function and the lookup functions beside it. What its ceiling is on
// (gameplay.js fits a folded skip's riders under it).
export const geminiDeclaredChars = (tools) => (Array.isArray(tools) ? tools : [])
    .filter((entry) => entry?.schema)
    .reduce((sum, entry) => sum + JSON.stringify(toGeminiSchema(entry.schema)).length, 0);

// One Gemini call's requests: a busy model's retries, a refused form's second
// asking, and the answer read off the last. `io` is the provider's side:
//   fetch(url, init), url(stream), retryOrFail(response, attempt), sleep(ms),
//   readErrorPayload(response), readJsonAnswer(response),
//   refusedRequestError(message, failure), retriesSpentError(),
//   failIfClosedEarly(data, text), keepProseClosedEarly(closedEarly, text),
//   canRetryBeforeDeadline(delayMs), waitingCannotFix(failure),
//   retryableStatuses (a Set), overloadedRetryDelay (ms).
// `lookupRoundsAnswered`: the rounds this task has had answered already, on this
// attempt or one before it (main.jsx runWithLookups).
export async function askGeminiAnswer(io, {
    model,
    systemPrompt,
    history,
    tool = null,
    lookupTools = null,
    requireOutputTool = false,
    lookupRoundsAnswered = 0,
    retries = 3,
    generationConfig: baseGenerationConfig = {},
    customParams = {},
    signal,
    onActivity,
    onReceived,
    onRequest,
    onSend,
    onToolStream,
    onUsage,
} = {}) {
    // Lookup functions (lookupTools.js), on the rounds that may ask them. They
    // stay declared for the whole conversation (the history carries calls to
    // them); which ones the model may CALL this round is allowedFunctionNames.
    const lookupDeclarations = tool && Array.isArray(lookupTools) ? lookupTools : [];
    let retriedAfterOverload = false;
    // The answer as JSON text rather than a function call, so a watched skip's
    // events arrive one at a time (see the top of this file for when, and for
    // what happens when it is refused).
    let asText = Boolean(tool) && geminiAnswersAsText(model, { watched: typeof onToolStream === "function" });
    let textRefused = false;
    let functionCallRefused = false;
    // Events first: they are what the panel shows as they are written. Built the
    // first time the text form is asked for, which may be after a refused call.
    let answerFormat = "";
    const answerFormatBlock = () => {
        answerFormat ||= buildAnswerFormatBlock(tool.schema, { first: Object.keys(tool.schema?.properties ?? {})[0] || "" });
        return answerFormat;
    };
    // What a text-form request adds after the prompt: the note above where the
    // prompt has lookup rules, then the contract.
    const textAnswerParts = () => [
        ...(lookupDeclarations.length ? [{ text: GEMINI_TEXT_ANSWER_NOTE }] : []),
        { text: answerFormatBlock() },
    ];

    for (let attempt = 1; attempt <= retries; attempt++) {
        const form = geminiRequestForm({ tool, lookupCount: lookupDeclarations.length, asText, requireOutputTool, lookupRoundsAnswered });
        const declared = form === "call" ? [tool, ...lookupDeclarations] : form === "lookups" ? lookupDeclarations : [];
        // Tool calls stream, for the same reason they do on the other three
        // providers: a timeline jump is the longest request the game makes, and
        // a buffered one sends nothing over the wire for the whole generation,
        // which is what an API edge or a proxy cuts. readGeminiStreamedResponse
        // rebuilds the exact envelope the extractors below already read, so
        // nothing downstream changes. (The advisor's own streaming is
        // main.jsx's, where the tokens go to the UI as they arrive.)
        const requestUrl = io.url(Boolean(tool));
        const generationConfig = {
            ...baseGenerationConfig,
            ...(form === "json" ? { responseMimeType: "application/json" } : {}),
        };
        if (tool) {
            logDebugEvent("ai-call", `Gemini request: ${form === "call" ? "the answer as a function call" : form === "lookups" ? "lookup functions only, the answer as JSON text if no lookup is needed" : "the answer as streamed JSON text, no functions"}.`, {
                model,
                functions: declared.length,
                ...(form === "json" ? { responseMimeType: "application/json" } : {}),
                ...(lookupRoundsAnswered ? { lookupRoundsAnswered } : {}),
            }, { verbose: true });
        }
        // The request goes out now: the skip's progress row starts its count
        // from here, again on every retry (requestActivity.js).
        onSend?.();
        const response = await io.fetch(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                // The contract after the prompt, as a part of its own: nothing
                // before it changes, so the prompt's cacheable prefix is the
                // one a function-call request has, and the lookup round and the
                // answer after it share the contract too.
                system_instruction: { parts: [
                    { text: systemPrompt },
                    ...(form === "json" || form === "lookups" ? textAnswerParts() : []),
                ] },
                contents: geminiContentsFromHistory(history),
                ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
                ...customParams,
                ...(declared.length ? {
                    tools: [{ functionDeclarations: declared.map(declarationOf) }],
                    toolConfig: { functionCallingConfig: form === "call" ? {
                        mode: "ANY",
                        // The final round of a lookup conversation may only answer.
                        allowedFunctionNames: [tool.name, ...(requireOutputTool ? [] : lookupDeclarations.map((entry) => entry.name))],
                    } : { mode: "AUTO" } },
                } : {}),
            }),
            signal,
        });
        // Every response is one request against the player's allowance, whatever
        // became of it (requestBudget.js): a lookup round, a retry, a refusal.
        onRequest?.(response.status);

        // A 429 used to be fatal here while every other provider retried it, so
        // one per-minute trip on a free-tier key destroyed the turn and dropped
        // the player to canned events. Only a SPENT quota (daily allowance, or
        // billing) is worth failing over; a rate limit is what waiting is for —
        // unless the player chose to move straight to the next Fallback entry.
        if (io.retryableStatuses.has(response.status)) {
            await io.retryOrFail(response, attempt);
            continue;
        }

        if (!response.ok) {
            const payload = await io.readErrorPayload(response);
            const failure = classifyProviderFailure({ status: response.status, payload });
            // The text form of the answer (its lookup round, or the answer
            // itself), refused as a request: asked again at once as the function
            // call it always was. Not one of the attempts, which are for a busy
            // model; a key, a missing model or a request too large fails the same
            // either way and is not asked twice.
            if (asText && !functionCallRefused && [400, 422].includes(response.status) && !io.waitingCannotFix(failure) && failure.kind !== "tooBig") {
                asText = false;
                textRefused = true;
                console.warn("[ai] Gemini refused the skip's JSON-text form; asking again as a function call (its events will arrive together).");
                logDebugEvent("ai", "Gemini refused a JSON-mode request; asked again as a function call.", {
                    model,
                    form,
                    status: response.status,
                    detail: extractErrorMessage(payload, "").slice(0, 300),
                }, { verbose: true });
                attempt -= 1;
                continue;
            }
            // The function call refused as a request: asked again at once as JSON
            // text (geminiFunctionCallRefusals above), the split way when there
            // are lookup functions. Once a call, and never after the text form
            // was itself refused in this one.
            if (!asText && tool && !functionCallRefused && !textRefused
                && [400, 422].includes(response.status) && failure.kind === "other") {
                asText = true;
                functionCallRefused = true;
                console.warn("[ai] Gemini refused the function call; asking again with the answer as JSON text.");
                logDebugEvent("ai", "Gemini refused a function-call request; asked again as JSON text.", {
                    model,
                    status: response.status,
                    detail: extractErrorMessage(payload, "").slice(0, 300),
                }, { verbose: true });
                attempt -= 1;
                continue;
            }
            throw io.refusedRequestError(
                extractErrorMessage(payload, `Gemini API request failed (${response.status})`),
                failure,
            );
        }
        // Accepted as a function call straight after being refused as JSON text:
        // it was the form that was refused, so this model is asked the function
        // way for the rest of the session.
        if (textRefused) geminiJsonAnswerRefusals.add(model);
        if (functionCallRefused) geminiFunctionCallRefusals.add(model);

        // Branch on what actually came back, not on what was asked for: an edge
        // or proxy that ignored alt=sse still answers plain JSON, and that must
        // keep working exactly as it did.
        const data = String(response.headers.get("content-type") || "").includes("text/event-stream")
            ? await readGeminiStreamedResponse(response, onActivity, onToolStream, onReceived)
            : await io.readJsonAnswer(response);
        onUsage?.(data);
        const replyText = joinGeminiParts(data?.candidates?.[0]?.content?.parts);
        if (tool) {
            // Asked for as JSON text: the text IS the function's arguments. One
            // that will not parse whole (cut off mid-answer, fenced) goes on below
            // as raw text, where the task's salvage and the busy-retry both read
            // it. A lookup round that asked questions has them read first.
            const roundCalls = form === "lookups" ? lookupCallsFromGemini(data, tool.name) : [];
            const jsonInput = form !== "call" && !roundCalls.length && replyText ? parseGeminiJsonAnswer(replyText) : null;
            // answeredAsText: no function was declared, so a correction asks for
            // the JSON again and not for a call (gameplay.js runJsonTask).
            if (jsonInput) return { rawText: replyText, toolInput: jsonInput, answeredAsText: true };
            const toolInput = form === "call" ? extractGeminiToolInput(data, tool) : null;
            if (toolInput) return { rawText: replyText, toolInput };
            io.failIfClosedEarly(data, replyText);
            // Not the answer but a question: the model called lookup functions.
            // Handed back to callAI, which answers them and asks again.
            if (roundCalls.length) return { rawText: replyText, toolInput: null, lookupCalls: roundCalls };
            if (form === "call" && lookupDeclarations.length) {
                const lookupCalls = lookupCallsFromGemini(data, tool.name);
                if (lookupCalls.length) return { rawText: replyText, toolInput: null, lookupCalls };
            }

            // Now that tool calls stream, an overloaded model can refuse INSIDE
            // the stream — HTTP 200, an error frame, no function call — where the
            // same refusal used to arrive as a 503 and be retried by status code
            // above. Without this, a hiccup would cost the player a whole turn to
            // the canned fallback, which is what the buffered path protected them
            // from. (Mirrors the OpenAI-compatible path.)
            const streamedError = data?.error;
            if (!replyText && isBusyErrorPayload(streamedError) && !retriedAfterOverload && attempt < retries
                && io.canRetryBeforeDeadline(io.overloadedRetryDelay)) {
                retriedAfterOverload = true;
                console.warn(`[ai] Gemini reported "${errorPayloadText(streamedError)}" mid-stream; retrying once in ${io.overloadedRetryDelay / 1000}s`);
                await io.sleep(io.overloadedRetryDelay);
                continue;
            }
            // Fragments that stopped partway assemble into a valid object missing
            // half the turn, so streamAssembly.js drops the call and leaves this
            // for the log alone.
            if (data?.partialToolJson) {
                logDebugEvent("warn", `[ai] Gemini tool call was cut off mid-argument.`, {
                    partialChars: data.partialToolJson.length,
                }, { verbose: true });
            }
            // Still refusing: say so, rather than hand back an empty "answer".
            if (!replyText && streamedError) throw toolStreamRefusalError("Gemini", streamedError, retriedAfterOverload);

            return { rawText: replyText, toolInput: null };
        }
        io.keepProseClosedEarly(data?.closedEarly, replyText);

        if (!replyText) {
            throw new Error("Gemini response did not contain text.");
        }

        return replyText;
    }
    throw io.retriesSpentError();
}
