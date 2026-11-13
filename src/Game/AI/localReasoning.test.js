// Run: node --test src/Game/AI/localReasoning.test.js
//
// Runs without node_modules: localReasoning.js is import-free.
//
// The promise: the "Model reasoning" setting switched off reaches a local
// server as an explicit "none" (a thinking model's template reasons when it is
// told nothing), a hosted API is sent exactly what it was sent before, and ON
// is unchanged everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isReasoningOffRefusal, openAiReasoningFields } from "./localReasoning.js";

test("ON sends what it always did: medium everywhere, enable_thinking to a local server", () => {
  assert.deepEqual(openAiReasoningFields({ enabled: true, local: false }), { reasoning_effort: "medium" });
  assert.deepEqual(openAiReasoningFields({ enabled: true, local: true }), { reasoning_effort: "medium", enable_thinking: true });
  assert.deepEqual(openAiReasoningFields(), { reasoning_effort: "medium" }, "the setting is on by default");
});

test("OFF tells a local server so, and tells a hosted API nothing", () => {
  assert.deepEqual(openAiReasoningFields({ enabled: false, local: true }), { reasoning_effort: "none" });
  assert.deepEqual(openAiReasoningFields({ enabled: false, local: false }), {});
});

test("a call whose endpoint refused reasoning with function tools carries none of it", () => {
  assert.deepEqual(openAiReasoningFields({ enabled: true, local: true, toolRefused: true }), {});
  assert.deepEqual(openAiReasoningFields({ enabled: true, local: false, toolRefused: true }), {});
});

test("a local server that refused \"none\" is not sent it again", () => {
  assert.deepEqual(openAiReasoningFields({ enabled: false, local: true, offRefused: true }), {});
  // The memory is about OFF only: ON still goes out.
  assert.deepEqual(openAiReasoningFields({ enabled: true, local: true, offRefused: true }), { reasoning_effort: "medium", enable_thinking: true });
});

test("a refusal of the field is told apart from the tools-and-reasoning conflict", () => {
  assert.equal(isReasoningOffRefusal("invalid value for reasoning_effort: 'none' (expected low, medium, high)"), true);
  assert.equal(isReasoningOffRefusal("Unsupported reasoning effort none"), true);
  assert.equal(isReasoningOffRefusal("Function tools with reasoning_effort are not supported for this model"), false);
  assert.equal(isReasoningOffRefusal("context length exceeded"), false);
  assert.equal(isReasoningOffRefusal(null), false);
});

test("callOpenAiCompatible builds its reasoning fields here and nowhere else", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  assert.ok(source.includes("openAiReasoningFields({"), "main.jsx no longer asks this module");
  assert.ok(!/reasoning_effort: "medium"/.test(source), "main.jsx writes reasoning_effort \"medium\" by hand again");
  assert.ok(!/enable_thinking: true/.test(source), "main.jsx writes enable_thinking by hand again");
});
