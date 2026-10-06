/*! Open Historia — SSE stream reassembly tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/streamAssembly.test.js
//
// Runs without node_modules: streamAssembly.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAnthropicFrame,
  applyGeminiFrame,
  applyOpenAIFrame,
  createAnthropicStreamState,
  createGeminiStreamState,
  createOpenAIStreamState,
  finishAnthropicStream,
  finishGeminiStream,
  finishOpenAIStream,
  readAnthropicStreamedResponse,
  readGeminiStreamedResponse,
  readOpenAIStreamedResponse,
} from "./streamAssembly.js";

// A Response-shaped stub carrying the SSE body a provider would send.
const sseResponse = (frames, { done = true } = {}) => {
  const lines = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`);
  if (done) lines.push("data: [DONE]\n\n");
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream({
      start(controller) {
        // One chunk per frame, so the reader really does have to buffer across
        // reads rather than seeing the whole body at once.
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
  };
};

const runOpenAI = (frames) => frames.reduce(applyOpenAIFrame, createOpenAIStreamState());
const runAnthropic = (frames) => frames.reduce(applyAnthropicFrame, createAnthropicStreamState());

// ---------------------------------------------------------------------------
// OpenAI-style

// The whole point of streaming a tool call: the arguments arrive in pieces and
// have to come back out as one parseable string. If this regresses, structured
// output silently becomes null and every turn falls back to canned events.
test("openai: tool arguments split across frames are rejoined", () => {
  const state = runOpenAI([
    { choices: [{ delta: { tool_calls: [{ function: { name: "submit_jump_result" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: '{"events":[' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: '{"title":"A war"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: "]}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);

  const call = finishOpenAIStream(state).choices[0].message.tool_calls[0];
  assert.equal(call.function.name, "submit_jump_result");
  assert.deepEqual(JSON.parse(call.function.arguments), { events: [{ title: "A war" }] });
});

test("openai: a stream cut off mid-argument yields unparseable JSON, not half a turn", () => {
  const state = runOpenAI([
    { choices: [{ delta: { tool_calls: [{ function: { name: "submit_jump_result", arguments: '{"events":[{"title":"A wa' } }] } }] },
  ]);

  const call = finishOpenAIStream(state).choices[0].message.tool_calls[0];
  assert.throws(() => JSON.parse(call.function.arguments));
});

test("openai: reasoning is kept apart from the answer", () => {
  const state = runOpenAI([
    { choices: [{ delta: { reasoning_content: "thinking..." } }] },
    { choices: [{ delta: { content: "the answer" } }] },
  ]);

  const message = finishOpenAIStream(state).choices[0].message;
  assert.equal(message.content, "the answer");
  assert.equal(message.reasoning, "thinking...");
});

test("openai: an error frame on a 200 stream is surfaced", () => {
  const state = runOpenAI([{ error: { message: "overloaded", type: "server_error" } }]);
  assert.equal(finishOpenAIStream(state).error.message, "overloaded");
});

test("openai: reads a real SSE body end to end", async () => {
  const data = await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { tool_calls: [{ function: { name: "submit_actions", arguments: '{"topics"' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: ":[]}" } }] } }] },
  ]));

  assert.deepEqual(
    JSON.parse(data.choices[0].message.tool_calls[0].function.arguments),
    { topics: [] },
  );
});

// A whole body names the answer and the model that wrote it. The envelope a
// stream is rebuilt into does as well, from the first chunk that carries them:
// it is how a KoboldCpp server is known for one (koboldCpp.js).
test("openai: the rebuilt envelope keeps the answer's id and model, as a whole body has them", async () => {
  const data = await readOpenAIStreamedResponse(sseResponse([
    { id: "chatcmpl-A1", object: "chat.completion.chunk", model: "koboldcpp/Qwen3-8B-Q4_K_M", choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "ok" } }] },
    { id: "chatcmpl-A1", object: "chat.completion.chunk", model: "koboldcpp/Qwen3-8B-Q4_K_M", choices: [{ index: 0, finish_reason: "stop", delta: {} }] },
  ]));
  assert.equal(data.id, "chatcmpl-A1");
  assert.equal(data.model, "koboldcpp/Qwen3-8B-Q4_K_M");
  assert.equal(data.choices[0].message.content, "ok");

  // A stream that names neither gains neither key.
  const bare = finishOpenAIStream(runOpenAI([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]));
  assert.equal("id" in bare, false);
  assert.equal("model" in bare, false);
  // The first chunk to name them is the one kept, a later usage frame or not.
  const late = finishOpenAIStream(runOpenAI([
    { id: 7, choices: [{ delta: { content: "a" } }] },
    { id: "koboldcpp", model: "koboldcpp/x", choices: [{ delta: { content: "b" } }] },
    { id: "other", model: "other", choices: [], usage: { prompt_tokens: 1 } },
  ]));
  assert.equal(late.id, "koboldcpp");
  assert.equal(late.model, "koboldcpp/x");
});

// ---------------------------------------------------------------------------
// Anthropic Messages

test("anthropic: input_json_delta frames rebuild the tool input", () => {
  const state = runAnthropic([
    { type: "message_start", message: {} },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "submit_jump_result" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"stopDate":' } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"2287-11-23","events":[]}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ]);

  const data = finishAnthropicStream(state);
  const block = data.content.find((entry) => entry.type === "tool_use");
  assert.equal(block.name, "submit_jump_result");
  assert.deepEqual(block.input, { stopDate: "2287-11-23", events: [] });
  assert.equal(data.stop_reason, "tool_use");
});

// Interleaved blocks are the normal shape for a thinking model: text, then the
// tool call. The deltas carry only an index, so mixing them up would splice a
// sentence into the middle of the JSON.
test("anthropic: text and tool blocks stay separate", () => {
  const state = runAnthropic([
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Simulating." } },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "submit_jump_result" } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"summary":"x"}' } },
  ]);

  const data = finishAnthropicStream(state);
  assert.deepEqual(data.content[0], { type: "text", text: "Simulating." });
  assert.deepEqual(data.content[1].input, { summary: "x" });
});

test("anthropic: thinking deltas never leak into the answer text", () => {
  const state = runAnthropic([
    { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me consider" } },
    { type: "content_block_start", index: 1, content_block: { type: "text" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "done" } },
  ]);

  const data = finishAnthropicStream(state);
  assert.deepEqual(data.content, [{ type: "text", text: "done" }]);
});

// The all-or-nothing rule: a cut-off tool call must produce NO input, so the turn
// fails validation and retries rather than applying half its events.
test("anthropic: a truncated tool call yields no input and keeps the fragment aside", () => {
  const state = runAnthropic([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "submit_jump_result" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"events":[{"title":"A wa' } },
  ]);

  const data = finishAnthropicStream(state);
  assert.equal(data.content.find((entry) => entry.type === "tool_use"), undefined);
  assert.equal(data.partialToolJson, '{"events":[{"title":"A wa');
});

// list_powers({}) streams its start and stop and no argument delta at all.
test("anthropic: a call with no arguments is kept, with an empty input", () => {
  const state = runAnthropic([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "list_powers", input: {} } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_2", name: "war_ledger", input: {} } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ]);

  const data = finishAnthropicStream(state);
  assert.deepEqual(data.content, [
    { type: "tool_use", id: "toolu_1", name: "list_powers", input: {} },
    { type: "tool_use", id: "toolu_2", name: "war_ledger", input: {} },
  ]);
  assert.equal(data.partialToolJson, undefined);
});

test("anthropic: a message that stopped to use a tool counts the call as whole without a stop event", () => {
  const state = runAnthropic([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "list_powers", input: {} } },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ]);
  assert.deepEqual(finishAnthropicStream(state).content, [{ type: "tool_use", id: "toolu_1", name: "list_powers", input: {} }]);
});

test("anthropic: a stream cut off right after a call started still yields no call", () => {
  const state = runAnthropic([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "submit_jump_result", input: {} } },
  ]);
  assert.deepEqual(finishAnthropicStream(state).content, []);
});

test("anthropic: an overloaded error event on a 200 stream is surfaced", () => {
  const state = runAnthropic([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
  assert.equal(finishAnthropicStream(state).error.type, "overloaded_error");
});

test("anthropic: reads a real SSE body end to end", async () => {
  const data = await readAnthropicStreamedResponse(sseResponse([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "submit_event_consolidation" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"summary":"A quiet year."}' } },
  ], { done: false }));

  assert.deepEqual(data.content[0].input, { summary: "A quiet year." });
});

// ---------------------------------------------------------------------------
// Gemini

const runGemini = (frames) => frames.reduce(applyGeminiFrame, createGeminiStreamState());

// The reason the Gemini tool path streams at all: the envelope the jump code
// reads has to come back out of the frames unchanged, or every jump on the
// DEFAULT provider silently loses its structured output and falls back to canned
// events.
test("gemini: a streamed function call rebuilds the envelope the extractors read", () => {
  const state = runGemini([
    { candidates: [{ content: { parts: [{ text: "Simulating " }] } }] },
    { candidates: [{ content: { parts: [{ text: "the year." }] } }] },
    { candidates: [{
      content: { parts: [{ functionCall: { name: "submit_jump_result", args: { events: [{ title: "A war" }] } } }] },
      finishReason: "STOP",
    }] },
  ]);

  const data = finishGeminiStream(state);
  const parts = data.candidates[0].content.parts;
  assert.deepEqual(parts[0], { text: "Simulating the year." });
  assert.equal(parts[1].functionCall.name, "submit_jump_result");
  assert.deepEqual(parts[1].functionCall.args, { events: [{ title: "A war" }] });
  assert.equal(data.candidates[0].finishReason, "STOP");
});

// Trimming per frame would run words together across a chunk boundary — the same
// bug the advisor's geminiStreamDelta comment warns about.
test("gemini: text frames are joined verbatim, spaces and all", () => {
  const state = runGemini([
    { candidates: [{ content: { parts: [{ text: "the treaty" }] } }] },
    { candidates: [{ content: { parts: [{ text: " was signed" }] } }] },
  ]);
  assert.equal(finishGeminiStream(state).candidates[0].content.parts[0].text, "the treaty was signed");
});

test("gemini: an error frame on a 200 stream is surfaced", () => {
  const state = runGemini([{ error: { code: 503, message: "The model is overloaded." } }]);
  assert.equal(finishGeminiStream(state).error.code, 503);
});

// A prompt refused before generation starts carries no candidates at all, so
// without this the caller sees only an empty answer and has to guess why.
test("gemini: a blocked prompt reports why instead of looking empty", () => {
  const state = runGemini([{ promptFeedback: { blockReason: "SAFETY" } }]);
  assert.match(finishGeminiStream(state).error.message, /SAFETY/);
});

// A cut-off stream must leave no function call behind, for the same reason as
// Anthropic's: half a turn applied is worse than a turn that plainly failed.
test("gemini: a stream cut before the call yields text but no tool input", () => {
  const state = runGemini([{ candidates: [{ content: { parts: [{ text: "The year opens" }] } }] }]);
  const parts = finishGeminiStream(state).candidates[0].content.parts;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].functionCall, undefined);
});

test("gemini: reads a real SSE body end to end", async () => {
  const data = await readGeminiStreamedResponse(sseResponse([
    { candidates: [{ content: { parts: [{ text: "ok" }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "submit_event_consolidation", args: { summary: "A quiet year." } } }] }, finishReason: "STOP" }] },
  ], { done: false }));

  const call = data.candidates[0].content.parts.find((part) => part.functionCall)?.functionCall;
  assert.deepEqual(call.args, { summary: "A quiet year." });
});

// ---------------------------------------------------------------------------
// Activity reporting — what "Limit AI generation" counts (idleDeadline.js).

// A multi-chunk body must report life more than once, or a long generation looks
// identical to a stalled one and the idle deadline aborts a healthy turn.
test("activity is reported once per network chunk, not once per stream", async () => {
  let ticks = 0;
  await readOpenAIStreamedResponse(
    sseResponse([
      { choices: [{ delta: { content: "one " } }] },
      { choices: [{ delta: { content: "two " } }] },
      { choices: [{ delta: { content: "three" } }] },
    ]),
    () => { ticks += 1; },
  );
  // Three frames plus the [DONE] line, one chunk each (see sseResponse).
  assert.equal(ticks, 4);
});

// A keep-alive comment or a frame split across two reads is still the endpoint
// telling us it is alive, so it must count even though it parses to nothing.
test("unparseable chunks still count as life", async () => {
  const encoder = new TextEncoder();
  let ticks = 0;
  const response = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":"));
        controller.enqueue(encoder.encode("{\"content\":\"split\"}}]}\n\n"));
        controller.close();
      },
    }),
  };

  const data = await readOpenAIStreamedResponse(response, () => { ticks += 1; });
  assert.equal(ticks, 3);
  assert.equal(data.choices[0].message.content, "split");
});

test("a throwing activity callback never breaks the stream", async () => {
  const data = await readGeminiStreamedResponse(
    sseResponse([{ candidates: [{ content: { parts: [{ text: "survived" }] } }] }]),
    () => { throw new Error("watchdog exploded"); },
  );
  assert.equal(data.candidates[0].content.parts[0].text, "survived");
});

test("the readers work with no activity callback at all", async () => {
  const data = await readAnthropicStreamedResponse(sseResponse([
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fine" } },
  ]));
  assert.deepEqual(data.content, [{ type: "text", text: "fine" }]);
});

// ---------------------------------------------------------------------------
// Token accounting survives reassembly
//
// Every tool call streams, so if the assemblers dropped `usage` the game could
// only ever measure the cheap buffered chat turns — useless for judging whether
// a prompt change actually made the expensive path cheaper.

test("OpenAI's usage frame is kept, though it carries no choices", async () => {
  const data = await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { content: "hi" } }] },
    // The accounting frame: an empty choices array and the totals.
    { choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 } },
  ]));
  assert.equal(data.choices[0].message.content, "hi");
  assert.deepEqual(data.usage, { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 });
});

test("Anthropic's two-sided accounting is merged, not overwritten", async () => {
  const data = await readAnthropicStreamedResponse(sseResponse([
    // Input side, including the cache read that proves a prefix hit.
    { type: "message_start", message: { usage: { input_tokens: 12, cache_read_input_tokens: 40000 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    // Output side arrives separately; the input figures must survive it.
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 55 } },
  ]));
  assert.deepEqual(data.content, [{ type: "text", text: "ok" }]);
  assert.equal(data.usage.input_tokens, 12);
  assert.equal(data.usage.cache_read_input_tokens, 40000);
  assert.equal(data.usage.output_tokens, 55);
});

test("Gemini's cumulative usageMetadata keeps the last figure", async () => {
  const data = await readGeminiStreamedResponse(sseResponse([
    { candidates: [{ content: { parts: [{ text: "a" }] } }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 1 } },
    { candidates: [{ content: { parts: [{ text: "b" }] } }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 2, totalTokenCount: 92 } },
  ]));
  assert.equal(data.candidates[0].content.parts[0].text, "ab");
  assert.deepEqual(data.usageMetadata, { promptTokenCount: 90, candidatesTokenCount: 2, totalTokenCount: 92 });
});

// A provider that never reports usage must not gain an empty key — downstream
// treats "absent" as "unknown", and an empty object is neither.
test("a stream with no accounting gains no usage key", async () => {
  const openai = await readOpenAIStreamedResponse(sseResponse([{ choices: [{ delta: { content: "x" } }] }]));
  assert.equal("usage" in openai, false);
  const gemini = await readGeminiStreamedResponse(sseResponse([{ candidates: [{ content: { parts: [{ text: "x" }] } }] }]));
  assert.equal("usageMetadata" in gemini, false);
});

test("openai: several tool calls in one turn are kept apart by index, ids included", () => {
  const state = runOpenAI([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "list_powers", arguments: "" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "find_region", arguments: "{\"na" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "me\":\"Crimea\"}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);
  const calls = finishOpenAIStream(state).choices[0].message.tool_calls;
  assert.deepEqual(calls.map((call) => [call.id, call.function.name, call.function.arguments]), [
    ["call_a", "list_powers", "{}"],
    ["call_b", "find_region", "{\"name\":\"Crimea\"}"],
  ]);
});

test("openai: a buffered message with complete calls and no indexes still yields one call each", () => {
  const state = runOpenAI([
    { choices: [{ message: { tool_calls: [
      { id: "call_1", function: { name: "list_powers", arguments: "{}" } },
      { id: "call_2", function: { name: "war_ledger", arguments: "{}" } },
    ] } }] },
  ]);
  const calls = finishOpenAIStream(state).choices[0].message.tool_calls;
  assert.deepEqual(calls.map((call) => [call.id, call.function.name]), [["call_1", "list_powers"], ["call_2", "war_ledger"]]);
});

test("gemini: a signed function call keeps its thoughtSignature on the rebuilt part", () => {
  const state = runGemini([
    { candidates: [{ content: { parts: [
      { functionCall: { name: "list_powers", args: {} }, thoughtSignature: "sig-one" },
      { functionCall: { name: "find_region", args: { name: "Kharkiv" } } },
    ] }, finishReason: "STOP" }] },
  ]);
  const parts = finishGeminiStream(state).candidates[0].content.parts;
  assert.deepEqual(parts, [
    { functionCall: { name: "list_powers", args: {} }, thoughtSignature: "sig-one" },
    { functionCall: { name: "find_region", args: { name: "Kharkiv" } } },
  ]);
});

// ---------------------------------------------------------------------------
// What each chunk carried — what the line under a skip's spinner is told
// (requestActivity.js): reasoning or answer, and how much.

const collect = () => {
  const heard = [];
  return { heard, onReceived: (report) => heard.push([report.reasoningChars, report.answerChars]) };
};

test("openai: each chunk says how much reasoning and how much answer it carried", async () => {
  const { heard, onReceived } = collect();
  await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { role: "assistant" } }] },
    { choices: [{ delta: { reasoning_content: "thinking" } }] },
    { choices: [{ delta: { reasoning: "more" } }] },
    { choices: [{ delta: { content: "Here: " } }] },
    { choices: [{ delta: { tool_calls: [{ function: { name: "submit_jump_result", arguments: '{"events":[]}' } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]), null, null, onReceived);
  // One report per network chunk, the [DONE] line included: nothing, then
  // reasoning, then the answer as text and as a tool call's arguments.
  assert.deepEqual(heard, [[0, 0], [8, 0], [4, 0], [0, 6], [0, 13], [0, 0], [0, 0]]);
});

test("openai: reasoning written between <think> tags in the content is reasoning", async () => {
  const { heard, onReceived } = collect();
  const data = await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { content: "<thi" } }] },
    { choices: [{ delta: { content: "nk>The player wants" } }] },
    { choices: [{ delta: { content: " a war.</th" } }] },
    { choices: [{ delta: { content: "ink>" } }] },
    { choices: [{ delta: { content: '{"events":[]}' } }] },
    { choices: [{ finish_reason: "stop", delta: {} }] },
  ]), null, null, onReceived);
  // The opening tag is split across two frames: its first half cannot be known
  // for reasoning yet, and everything after it is, until the tag closes.
  assert.deepEqual(heard.slice(0, 5), [[0, 4], [19, 0], [11, 0], [0, 4], [0, 13]]);
  // The content itself is untouched: main.jsx strips the block from the answer.
  assert.equal(data.choices[0].message.content, '<think>The player wants a war.</think>{"events":[]}');
});

test("anthropic: thinking is counted as reasoning without joining the answer", async () => {
  const { heard, onReceived } = collect();
  const data = await readAnthropicStreamedResponse(sseResponse([
    { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me plan this." } },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Done." } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", name: "submit_jump_result" } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"events":[]}' } },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ], { done: false }), null, null, onReceived);
  assert.deepEqual(heard, [[0, 0], [17, 0], [0, 0], [0, 5], [0, 0], [0, 13], [0, 0]]);
  assert.deepEqual(data.content.map((block) => block.type), ["text", "tool_use"]);
});

test("gemini: text, a whole function call and a thought summary are each counted", async () => {
  const { heard, onReceived } = collect();
  await readGeminiStreamedResponse(sseResponse([
    { candidates: [{ content: { parts: [{ text: "Weighing it up.", thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: "ok" }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "submit_jump_result", args: { events: [] } } }] }, finishReason: "STOP" }] },
  ], { done: false }), null, null, onReceived);
  assert.deepEqual(heard, [[15, 0], [0, 2], [0, 13]]);
});

test("a chunk that carried nothing readable is still reported, as zeros", async () => {
  const encoder = new TextEncoder();
  const { heard, onReceived } = collect();
  const response = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":"));
        controller.enqueue(encoder.encode("{\"content\":\"split\"}}]}\n\n"));
        controller.close();
      },
    }),
  };
  await readOpenAIStreamedResponse(response, null, null, onReceived);
  assert.deepEqual(heard, [[0, 0], [0, 0], [0, 5]]);
});

test("a throwing receiver never breaks the stream", async () => {
  const data = await readOpenAIStreamedResponse(
    sseResponse([{ choices: [{ delta: { content: "survived" } }] }]),
    null,
    null,
    () => { throw new Error("the row exploded"); },
  );
  assert.equal(data.choices[0].message.content, "survived");
});

// ---------------------------------------------------------------------------
// A stream that just stops is not one that finished.
//
// Every provider says when an answer is over, or why it is not. A stream with
// neither is, as a rule, a connection that closed early, and its envelope used
// to be handed on as a whole answer: half a tool call failed to parse
// downstream and the task paid for a second request. The envelope is marked,
// and main.jsx decides by what the call wanted: a structured answer that is not
// all there fails the call, a reply in words is kept
// (toolResponsePayload.test.js has that rule).

const rawSse = (text) => {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
  };
};

test("openai: a stream with no finish reason and no [DONE] is marked as closed early", async () => {
  const cut = await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { tool_calls: [{ function: { name: "submit_jump_result", arguments: '{"events":[{"title":"A wa' } }] } }] },
  ], { done: false }));
  assert.equal(cut.closedEarly, true);

  // Either sign of an ending is enough: servers send one, the other, or both.
  const finished = await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { content: "ok" } }] },
    { choices: [{ finish_reason: "stop", delta: {} }] },
  ], { done: false }));
  assert.equal("closedEarly" in finished, false);
  const doneOnly = await readOpenAIStreamedResponse(sseResponse([{ choices: [{ delta: { content: "ok" } }] }]));
  assert.equal("closedEarly" in doneOnly, false);
  // Cut at the output limit is an ending the provider reported, not a closed connection.
  const atLimit = await readOpenAIStreamedResponse(sseResponse([
    { choices: [{ delta: { content: '{"events":[' }, finish_reason: "length" }] },
  ], { done: false }));
  assert.equal("closedEarly" in atLimit, false);
  assert.equal(atLimit.choices[0].finish_reason, "length");
  // Nor is a stream the provider ended with an error: it said why.
  const refused = await readOpenAIStreamedResponse(sseResponse([{ error: { message: "overloaded" } }], { done: false }));
  assert.equal("closedEarly" in refused, false);
  // Nothing at all came back.
  assert.equal((await readOpenAIStreamedResponse(sseResponse([], { done: false }))).closedEarly, true);
});

test("anthropic: a message with no stop reason and no message_stop is marked as closed early", async () => {
  const cut = await readAnthropicStreamedResponse(sseResponse([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "submit_jump_result" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"events":[{"title":"A wa' } },
  ], { done: false }));
  assert.equal(cut.closedEarly, true);
  assert.equal(cut.partialToolJson, '{"events":[{"title":"A wa');

  const stopped = await readAnthropicStreamedResponse(sseResponse([
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
  ], { done: false }));
  assert.equal("closedEarly" in stopped, false);
  const messageStop = await readAnthropicStreamedResponse(sseResponse([
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "Done." } },
    { type: "message_stop" },
  ], { done: false }));
  assert.equal("closedEarly" in messageStop, false);
  const overloaded = await readAnthropicStreamedResponse(sseResponse([
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
  ], { done: false }));
  assert.equal("closedEarly" in overloaded, false);
});

test("gemini: a stream with no finish reason is marked as closed early", async () => {
  const cut = await readGeminiStreamedResponse(sseResponse([
    { candidates: [{ content: { parts: [{ text: "The year opens" }] } }] },
  ], { done: false }));
  assert.equal(cut.closedEarly, true);

  const finished = await readGeminiStreamedResponse(sseResponse([
    { candidates: [{ content: { parts: [{ text: "The year opens." }] }, finishReason: "STOP" }] },
  ], { done: false }));
  assert.equal("closedEarly" in finished, false);
  const blocked = await readGeminiStreamedResponse(sseResponse([{ promptFeedback: { blockReason: "SAFETY" } }], { done: false }));
  assert.equal("closedEarly" in blocked, false, "the provider said why there is no answer");
});

// The last line of a body is not always followed by a newline. It used to be
// dropped, which lost a final frame; now that an ending is looked for, losing
// the frame that carries it would fail a whole answer.
test("a last line with no newline after it is still read", async () => {
  const finishOnLastLine = await readOpenAIStreamedResponse(rawSse(
    'data: {"choices":[{"delta":{"content":"whole"}}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  ));
  assert.equal(finishOnLastLine.choices[0].message.content, "whole");
  assert.equal(finishOnLastLine.choices[0].finish_reason, "stop");
  assert.equal("closedEarly" in finishOnLastLine, false);

  const doneOnLastLine = await readOpenAIStreamedResponse(rawSse('data: {"choices":[{"delta":{"content":"whole"}}]}\n\ndata: [DONE]'));
  assert.equal("closedEarly" in doneOnLastLine, false);

  // Half a frame is still nothing: the text before it stands, and the stream reads as cut.
  const halfFrame = await readOpenAIStreamedResponse(rawSse('data: {"choices":[{"delta":{"content":"half"}}]}\n\ndata: {"choices":[{"delta":{"con'));
  assert.equal(halfFrame.choices[0].message.content, "half");
  assert.equal(halfFrame.closedEarly, true);
});

// ---------------------------------------------------------------------------
// Gemini: an answer asked for as JSON text (a watched time skip, main.jsx
// callGemini). This API streams text and never a function call's arguments, so
// the text is where the events are read from as they are written.

test("gemini: text parts are reported as they grow, so a JSON answer can be read while it is written", () => {
  const seen = [];
  const state = createGeminiStreamState();
  for (const frame of [
    { candidates: [{ content: { parts: [{ text: '{"events":[{"title":"A' }] } }] },
    { candidates: [{ content: { parts: [{ text: ' treaty"}' }] } }] },
    { candidates: [{ content: { parts: [{ text: '],"stopDate":"2016-02-01"}' }] }, finishReason: "STOP" }] },
  ]) applyGeminiFrame(state, frame, (progress) => seen.push(progress));
  assert.deepEqual(seen.map((progress) => progress.name), ["", "", ""]);
  assert.equal(seen[0].json, '{"events":[{"title":"A');
  assert.equal(seen[2].json, '{"events":[{"title":"A treaty"}],"stopDate":"2016-02-01"}');
  assert.equal(finishGeminiStream(state).candidates[0].content.parts[0].text, seen[2].json);
});

test("gemini: a thought summary is not part of the answer", () => {
  const seen = [];
  const state = createGeminiStreamState();
  applyGeminiFrame(state, { candidates: [{ content: { parts: [
    { text: "Weighing the fronts first.", thought: true },
    { text: '{"events":[]}' },
  ] } }] }, (progress) => seen.push(progress.json));
  assert.deepEqual(seen, ['{"events":[]}']);
  assert.equal(finishGeminiStream(state).candidates[0].content.parts[0].text, '{"events":[]}');
});
