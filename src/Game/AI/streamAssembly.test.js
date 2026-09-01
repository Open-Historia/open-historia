/*! Open Historia — SSE stream reassembly tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
