// How a Gemini task's answer is asked for, request by request, against a fake
// fetch (geminiAnswer.js askGeminiAnswer).
// Run: node --test src/Game/AI/geminiAnswer.test.js
//
// A player's log, 2026-11-10, Gemini with the lookup functions on and the skip's
// events shown as they are written: every skip's first request declared the
// skip's function and 25 lookup functions, 400 "Request contains an invalid
// argument" (the function's grammar ceiling), then was asked again the old way
// and arrived whole, so no event appeared until all of them had. A watched skip
// with lookups is now split: its lookup round declares the lookup functions
// alone, and its answer declares none and streams as JSON text.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  askGeminiAnswer,
  geminiAnswersAsText,
  geminiDeclaredChars,
  geminiFunctionCallRefusals,
  geminiJsonAnswerRefusals,
  geminiRequestForm,
  GEMINI_TEXT_ANSWER_NOTE,
} from "./geminiAnswer.js";
import { appendLookupRound } from "./toolTurns.js";
import { createStreamedEventReader } from "./streamedEvents.js";
import { getGameplayTool } from "./gameplaySchemas.js";
import { LOOKUP_TOOLS } from "./lookupTools.js";
import { toGeminiSchema } from "./geminiSchema.js";

const MODEL = "gemini-3.5-flash-lite";
const SKIP = getGameplayTool("jumpForward");
const LOOKUPS = LOOKUP_TOOLS.slice(0, 5);
const ANSWER = {
  events: [
    { date: "1941-03-05", title: "Supreme Soviet elections", description: "The party is returned." },
    { date: "1941-03-12", title: "The thaw stalls the front", description: "Mud holds both armies." },
    { date: "1941-03-25", title: "Raids on Plymouth", description: "The docks burn." },
  ],
  summary: "A quiet month.",
};

const reset = () => {
  geminiJsonAnswerRefusals.clear();
  geminiFunctionCallRefusals.clear();
};

// A streamed reply, one frame per piece, as Gemini sends it (no [DONE]: the
// last frame's finishReason ends it).
const sse = (frames) => {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "text/event-stream" : null) },
    body: new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\r\n\r\n`));
        controller.close();
      },
    }),
  };
};
const textReply = (text, pieces = 6) => {
  const size = Math.ceil(text.length / pieces);
  const chunks = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return sse(chunks.map((chunk, index) => ({
    candidates: [{ content: { role: "model", parts: [{ text: chunk }] }, ...(index === chunks.length - 1 ? { finishReason: "STOP" } : {}) }],
  })));
};
const callsReply = (calls) => sse([{
  candidates: [{
    content: { role: "model", parts: calls.map(([name, args], index) => ({ functionCall: { name, args }, ...(index === 0 ? { thoughtSignature: "sig-1" } : {}) })) },
    finishReason: "STOP",
  }],
}]);
const refused = (message = "Request contains an invalid argument.") => ({
  ok: false,
  status: 400,
  headers: { get: () => "application/json" },
  payload: { error: { code: 400, message, status: "INVALID_ARGUMENT" } },
});

// The provider's side of a call (main.jsx callGemini hands the real ones), with
// every request kept as it was sent.
const fakeGemini = (replies) => {
  const queue = [...replies];
  const requests = [];
  const io = {
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      const next = queue.shift();
      if (!next) throw new Error(`request ${requests.length} was not expected`);
      return next;
    },
    url: (stream) => (stream ? "https://gemini.test/m:streamGenerateContent?alt=sse" : "https://gemini.test/m:generateContent"),
    retryOrFail: async () => { throw new Error("busy"); },
    sleep: async () => {},
    readErrorPayload: async (response) => response.payload ?? {},
    readJsonAnswer: async (response) => response.json,
    refusedRequestError: (message, failure) => Object.assign(new Error(message), { providerFailure: failure }),
    retriesSpentError: () => new Error("retries spent"),
    failIfClosedEarly: () => {},
    keepProseClosedEarly: () => {},
    canRetryBeforeDeadline: () => true,
    waitingCannotFix: (failure) => failure.kind === "unusable" || failure.kind === "spent",
    retryableStatuses: new Set([429, 502, 503, 504, 529]),
    overloadedRetryDelay: 0,
  };
  return { io, requests, left: () => queue.length };
};

// The lookup conversation as main.jsx runWithLookups holds it: rounds while the
// limit allows, each round's calls answered and appended, the rounds answered so
// far (carried ones too) handed to the provider.
const askSkip = async (io, { watched = true, maxRounds = 2, carried = 0, lookups = LOOKUPS, onToolStream } = {}) => {
  let conversation = [{ role: "user", parts: [{ text: "Simulate March 1941." }] }];
  const answered = [];
  for (let round = 0; ; round += 1) {
    const requireOutputTool = carried + round >= maxRounds;
    const result = await askGeminiAnswer(io, {
      model: MODEL,
      systemPrompt: "SYSTEM PROMPT",
      history: conversation,
      tool: SKIP,
      lookupTools: lookups,
      requireOutputTool,
      lookupRoundsAnswered: carried + round,
      generationConfig: { thinkingConfig: { thinkingBudget: 8192 } },
      ...(watched ? { onToolStream: onToolStream ?? (() => {}) } : {}),
    });
    const calls = Array.isArray(result?.lookupCalls) ? result.lookupCalls : [];
    if (!calls.length || result?.toolInput || requireOutputTool) return { result, answered };
    const results = calls.map((call) => ({ id: call.id, name: call.name, response: { answer: `${call.name} answered` } }));
    answered.push(...calls);
    conversation = appendLookupRound(conversation, calls, results);
  }
};

const declaredNames = (body) => (body.tools?.[0]?.functionDeclarations ?? []).map((entry) => entry.name);
const contractPart = (body) => body.system_instruction.parts.slice(1).map((part) => part.text).join("");

test("a watched skip that looks things up: its lookup round declares the lookups alone, and its answer declares nothing and streams", async () => {
  reset();
  const { io, requests, left } = fakeGemini([
    callsReply([["war_ledger", {}], ["storylines", {}]]),
    textReply(JSON.stringify(ANSWER)),
  ]);
  const progress = [];
  const shown = [];
  const reader = createStreamedEventReader({ onEvent: (event) => shown.push({ title: event.title, frames: progress.length }) });
  const { result, answered } = await askSkip(io, {
    onToolStream: (piece) => {
      progress.push(piece);
      if (typeof piece?.json === "string") reader.pushJson(piece.json);
    },
  });
  reader.finish();

  assert.equal(requests.length, 2, "two requests, as a skip with one lookup round always cost");
  assert.equal(left(), 0);
  const [round, final] = requests.map((request) => request.body);

  // The round: the lookup functions alone, free to ask or to answer.
  assert.deepEqual(declaredNames(round), LOOKUPS.map((entry) => entry.name));
  assert.equal(declaredNames(round).includes(SKIP.name), false, "the skip's function, the one with the grammar ceiling, is not sent");
  assert.deepEqual(round.toolConfig, { functionCallingConfig: { mode: "AUTO" } });
  assert.equal(round.generationConfig.responseMimeType, undefined, "Gemini refuses a mime type beside functions");
  const [, note, format] = round.system_instruction.parts.map((part) => part.text);
  assert.equal(note, GEMINI_TEXT_ANSWER_NOTE, "the prompt's lookup rules speak of an output function: the request says there is none");
  assert.match(format, /^\[Answer Format\]/, "and the contract is in the prompt");
  assert.equal(round.system_instruction.parts.length, 3);
  assert.match(requests[0].url, /streamGenerateContent\?alt=sse/);

  // The answer: no function, the mime type, the same contract, the round in the history.
  assert.equal(final.tools, undefined);
  assert.equal(final.toolConfig, undefined);
  assert.equal(final.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(final.generationConfig.thinkingConfig, { thinkingBudget: 8192 });
  assert.equal(contractPart(final), contractPart(round), "the prompt and its contract are the same on both, for the cache");
  assert.equal(final.system_instruction.parts[0].text, round.system_instruction.parts[0].text);
  assert.match(requests[1].url, /streamGenerateContent\?alt=sse/, "streamed");
  const [ask, calls, responses] = final.contents;
  assert.equal(ask.role, "user");
  assert.deepEqual(calls.parts.map((part) => part.functionCall.name), ["war_ledger", "storylines"]);
  assert.equal(calls.parts[0].thoughtSignature, "sig-1", "Gemini 3's signature goes back on its call");
  assert.deepEqual(responses.parts.map((part) => part.functionResponse.name), ["war_ledger", "storylines"]);
  assert.equal(answered.length, 2);

  // Read as the answer, and seen as it was written.
  assert.deepEqual(result.toolInput, ANSWER);
  assert.equal(result.answeredAsText, true);
  assert.ok(progress.length >= 6, "the text arrived in pieces");
  assert.deepEqual(shown.map((entry) => entry.title), ANSWER.events.map((event) => event.title));
  assert.ok(shown[0].frames < progress.length, "the first event was shown before the answer was complete");
});

test("a watched skip that looks nothing up is answered by its first request, as text", async () => {
  reset();
  const { io, requests } = fakeGemini([textReply(JSON.stringify(ANSWER))]);
  const pieces = [];
  const { result } = await askSkip(io, { onToolStream: (piece) => pieces.push(piece) });
  assert.equal(requests.length, 1);
  assert.deepEqual(declaredNames(requests[0].body), LOOKUPS.map((entry) => entry.name));
  assert.equal(requests[0].body.toolConfig.functionCallingConfig.mode, "AUTO");
  assert.deepEqual(result.toolInput, ANSWER);
  assert.equal(result.answeredAsText, true);
  assert.ok(pieces.length >= 6 && pieces.every((piece) => piece.name === "" && typeof piece.json === "string"));
});

test("an answer in the round that does not parse whole goes back as text, for the task's salvage", async () => {
  reset();
  const fenced = `\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``;
  const { io, requests } = fakeGemini([textReply(fenced)]);
  const { result } = await askSkip(io);
  assert.equal(requests.length, 1);
  assert.equal(result.toolInput, null);
  assert.equal(result.rawText, fenced);
});

test("only one round is asked the split way: after it the answer is due, whatever rounds the limit has left", async () => {
  reset();
  const { io, requests } = fakeGemini([callsReply([["war_ledger", {}]]), textReply(JSON.stringify(ANSWER))]);
  await askSkip(io, { maxRounds: 6 });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.tools, undefined);
  assert.equal(requests[1].body.generationConfig.responseMimeType, "application/json");
});

test("a round answered on an earlier attempt counts: the next attempt asks for the answer at once", async () => {
  reset();
  const { io, requests } = fakeGemini([textReply(JSON.stringify(ANSWER))]);
  const { result } = await askSkip(io, { carried: 1, maxRounds: 3 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(result.toolInput, ANSWER);
});

test("with no round left in the budget the first request is the answer, with no function declared", async () => {
  reset();
  const { io, requests } = fakeGemini([textReply(JSON.stringify(ANSWER))]);
  await askSkip(io, { maxRounds: 0 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
});

test("a model that refuses the JSON-text answer is asked again at once as the function call, and so for the session", async () => {
  reset();
  const mime = "Function calling with a response mime type: 'application/json' is unsupported";
  const { io, requests } = fakeGemini([
    callsReply([["war_ledger", {}]]),
    refused(mime),
    sse([{ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: SKIP.name, args: ANSWER } }] }, finishReason: "STOP" }] }]),
  ]);
  const { result } = await askSkip(io, { maxRounds: 1 });
  assert.equal(requests.length, 3, "the refused one, and the same answer asked as a call");
  const call = requests[2].body;
  assert.deepEqual(declaredNames(call), [SKIP.name, ...LOOKUPS.map((entry) => entry.name)]);
  assert.deepEqual(call.toolConfig.functionCallingConfig, { mode: "ANY", allowedFunctionNames: [SKIP.name] }, "the round limit is spent: only the answer");
  assert.equal(call.generationConfig.responseMimeType, undefined);
  assert.deepEqual(result.toolInput, ANSWER);
  assert.equal(result.answeredAsText, undefined);
  assert.equal(geminiJsonAnswerRefusals.has(MODEL), true);

  // The next skip of the session is asked as the call from its first request.
  const next = fakeGemini([sse([{ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: SKIP.name, args: ANSWER } }] }, finishReason: "STOP" }] }])]);
  const again = await askSkip(next.io);
  assert.equal(next.requests.length, 1);
  assert.deepEqual(declaredNames(next.requests[0].body), [SKIP.name, ...LOOKUPS.map((entry) => entry.name)]);
  assert.equal(next.requests[0].body.toolConfig.functionCallingConfig.mode, "ANY");
  assert.deepEqual(again.result.toolInput, ANSWER);
});

test("a skip that is not watched keeps the function call, its lookups beside it", async () => {
  reset();
  const { io, requests } = fakeGemini([
    callsReply([["war_ledger", {}]]),
    sse([{ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: SKIP.name, args: ANSWER } }] }, finishReason: "STOP" }] }]),
  ]);
  const { result } = await askSkip(io, { watched: false });
  assert.equal(requests.length, 2);
  for (const { body } of requests) {
    assert.deepEqual(declaredNames(body), [SKIP.name, ...LOOKUPS.map((entry) => entry.name)]);
    assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
    assert.equal(body.generationConfig.responseMimeType, undefined);
  }
  assert.deepEqual(result.toolInput, ANSWER);
});

test("a function call with lookups refused as a request is asked again the split way, once, and so for the session", async () => {
  reset();
  const { io, requests } = fakeGemini([refused(), textReply(JSON.stringify(ANSWER))]);
  const { result } = await askSkip(io, { watched: false });
  assert.equal(requests.length, 2);
  assert.ok(declaredNames(requests[0].body).includes(SKIP.name));
  assert.deepEqual(declaredNames(requests[1].body), LOOKUPS.map((entry) => entry.name));
  assert.deepEqual(result.toolInput, ANSWER);
  assert.equal(geminiFunctionCallRefusals.has(MODEL), true);
  assert.equal(geminiAnswersAsText(MODEL, { watched: false }), true);
});

test("a refused key or a request too big is not asked again in another form", async () => {
  reset();
  const { io, requests } = fakeGemini([{ ...refused("API key not valid. Please pass a valid API key."), status: 400 }]);
  await assert.rejects(askSkip(io), /API key not valid/);
  assert.equal(requests.length, 1);
  assert.equal(geminiJsonAnswerRefusals.size, 0);
});

test("a skip with no lookup functions is the one streamed JSON-text request it was", async () => {
  reset();
  const { io, requests } = fakeGemini([textReply(JSON.stringify(ANSWER))]);
  const { result } = await askSkip(io, { lookups: null });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(requests[0].body.system_instruction.parts.length, 2, "the prompt and the contract, with no note about lookups it has not got");
  assert.match(contractPart(requests[0].body), /^\[Answer Format\]/);
  assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(result.toolInput, ANSWER);
});

test("a reply in words (no output function) is a plain request, and its text is the answer", async () => {
  reset();
  const { io, requests } = fakeGemini([{ ok: true, status: 200, headers: { get: () => "application/json" }, json: { candidates: [{ content: { parts: [{ text: "Sire." }] } }] } }]);
  const reply = await askGeminiAnswer(io, { model: MODEL, systemPrompt: "S", history: [{ role: "user", parts: [{ text: "Hello" }] }] });
  assert.equal(reply, "Sire.");
  assert.match(requests[0].url, /:generateContent$/);
  assert.equal(requests[0].body.tools, undefined);
});

test("the request forms, by what a call has", () => {
  assert.equal(geminiRequestForm({}), "plain");
  assert.equal(geminiRequestForm({ tool: SKIP }), "call");
  assert.equal(geminiRequestForm({ tool: SKIP, lookupCount: 3 }), "call");
  assert.equal(geminiRequestForm({ tool: SKIP, asText: true }), "json");
  assert.equal(geminiRequestForm({ tool: SKIP, asText: true, lookupCount: 3 }), "lookups");
  assert.equal(geminiRequestForm({ tool: SKIP, asText: true, lookupCount: 3, lookupRoundsAnswered: 1 }), "json");
  assert.equal(geminiRequestForm({ tool: SKIP, asText: true, lookupCount: 3, requireOutputTool: true }), "json");
});

test("what a request declares is weighed as Gemini is sent it, the lookup functions beside the skip's counted", () => {
  const alone = JSON.stringify(toGeminiSchema(SKIP.schema)).length;
  assert.equal(geminiDeclaredChars([SKIP]), alone, "the skip's function alone is weighed as it always was");
  const beside = LOOKUP_TOOLS.reduce((sum, entry) => sum + JSON.stringify(toGeminiSchema(entry.schema)).length, 0);
  assert.equal(geminiDeclaredChars([SKIP, ...LOOKUP_TOOLS]), alone + beside);
  assert.ok(beside > 4000, "the lookup functions are thousands of characters: what tipped the player's skips over");
  assert.equal(geminiDeclaredChars([null, undefined]), 0);
});

test("main.jsx tells Gemini how many rounds are answered, and hands every Gemini task to askGeminiAnswer", () => {
  const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /const requireOutputTool = outputOnly \|\| carried \+ round >= maxRounds;/);
  assert.match(main, /const result = await dispatch\(conversation, \{ lookupTools: tools, requireOutputTool, lookupRoundsAnswered: carried \+ round \}\);/);
  const callGemini = main.slice(main.indexOf("async function callGemini("), main.indexOf("// Extra output tokens allowed when reasoning is on"));
  assert.match(callGemini, /lookupRoundsAnswered = 0,/);
  assert.match(callGemini, /return askGeminiAnswer\(\{/);
  assert.match(callGemini, /\n {8}lookupRoundsAnswered,\n/);
  assert.match(callGemini, /\n {8}onToolStream,\n/);
  // The call's line in the log says a watched answer streams.
  assert.match(main, /streaming: Boolean\(providerOpts\.onChunk \|\| providerOpts\.onToolStream\),/);
});
