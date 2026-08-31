/*! Open Historia — SSE stream reassembly tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/streamAssembly.test.js
//
// Runs without node_modules: streamAssembly.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAnthropicFrame,
  applyOpenAIFrame,
  createAnthropicStreamState,
  createOpenAIStreamState,
  finishAnthropicStream,
  finishOpenAIStream,
  readAnthropicStreamedResponse,
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
