/*! Open Historia — structured-output mode tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/structuredMode.test.js
//
// Runs without node_modules: structuredMode.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STRUCTURED_MODE,
  STRUCTURED_MODES,
  STRUCTURED_MODE_HINTS,
  STRUCTURED_MODE_INTRO,
  STRUCTURED_MODE_LABELS,
  SUGGEST_AFTER_OBSERVATIONS,
  createModeObserver,
  nextStructuredMode,
  normalizeStructuredMode,
  startingStructuredMode,
} from "./structuredMode.js";

test("the ladder is ordered strongest first", () => {
  assert.deepEqual(STRUCTURED_MODES, ["tool", "json_schema", "json_object", "text_json"]);
  assert.equal(nextStructuredMode("tool"), "json_schema");
  assert.equal(nextStructuredMode("json_schema"), "json_object");
  assert.equal(nextStructuredMode("json_object"), "text_json");
  // Nothing left to concede.
  assert.equal(nextStructuredMode("text_json"), null);
  assert.equal(nextStructuredMode("nonsense"), null);
});

// A setting chosen months ago must never be able to permanently break a
// campaign, so it says where to BEGIN, not what is allowed.
test("a configured mode is a starting point, not a lock", () => {
  assert.equal(startingStructuredMode("auto"), "tool");
  assert.equal(startingStructuredMode(""), "tool");
  assert.equal(startingStructuredMode(undefined), "tool");
  assert.equal(startingStructuredMode("json_schema"), "json_schema");
  // ...and the ladder can still walk down from wherever it started.
  assert.equal(nextStructuredMode(startingStructuredMode("json_schema")), "json_object");
});

test("an unrecognised setting falls back to auto rather than breaking", () => {
  assert.equal(normalizeStructuredMode("JSON_SCHEMA"), "json_schema");
  assert.equal(normalizeStructuredMode("  tool  "), "tool");
  assert.equal(normalizeStructuredMode("nonsense"), "auto");
  assert.equal(normalizeStructuredMode(null), "auto");
  assert.equal(DEFAULT_STRUCTURED_MODE, "auto");
});

// The copy is written for someone who does not know what JSON is, so it is free
// to change — but every mode must still HAVE a label and an explanation, or the
// dropdown renders a blank row.
test("every mode is labelled and explained", () => {
  for (const mode of ["auto", ...STRUCTURED_MODES]) {
    assert.equal(typeof STRUCTURED_MODE_LABELS[mode], "string", `${mode} has no label`);
    assert.ok(STRUCTURED_MODE_LABELS[mode].length, `${mode}'s label is empty`);
    assert.equal(typeof STRUCTURED_MODE_HINTS[mode], "string", `${mode} has no explanation`);
    assert.ok(STRUCTURED_MODE_HINTS[mode].length, `${mode}'s explanation is empty`);
  }
  assert.ok(STRUCTURED_MODE_INTRO.length, "the dropdown has no introduction");
});

// The whole point of asking rather than inferring: one drop is not evidence.
test("one observation is never enough to suggest anything", () => {
  const observer = createModeObserver();
  const seen = observer.record("nvidia|llama", "tool", "json_schema");
  assert.deepEqual(seen, { mode: "json_schema", count: 1 });
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), null);
});

test("a repeated drop to the same rung is suggested", () => {
  const observer = createModeObserver();
  for (let i = 0; i < SUGGEST_AFTER_OBSERVATIONS; i += 1) {
    observer.record("nvidia|llama", "tool", "json_schema");
  }
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), "json_schema");
});

// Two drops to two different rungs is noise, not a pattern.
test("contradictory evidence resets rather than accumulating", () => {
  const observer = createModeObserver();
  observer.record("gw|m", "tool", "json_schema");
  observer.record("gw|m", "tool", "text_json");
  assert.equal(observer.shouldSuggest("gw|m", "auto"), null);
  // Consistent from here on, so it becomes a pattern again.
  observer.record("gw|m", "tool", "text_json");
  assert.equal(observer.shouldSuggest("gw|m", "auto"), "text_json");
});

test("succeeding where the call began teaches nothing", () => {
  const observer = createModeObserver();
  // The expected case: tool mode worked. Recording it would be noise.
  assert.equal(observer.record("openai|gpt", "tool", "tool"), null);
  observer.record("openai|gpt", "tool", "tool");
  assert.equal(observer.shouldSuggest("openai|gpt", "auto"), null);
});

test("declining is remembered, so it does not nag every turn", () => {
  const observer = createModeObserver();
  observer.record("nvidia|llama", "tool", "json_schema");
  observer.record("nvidia|llama", "tool", "json_schema");
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), "json_schema");

  observer.decline("nvidia|llama", "json_schema");
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), null);

  // Declining one rung must not silence a genuinely different finding later.
  observer.record("nvidia|llama", "tool", "text_json");
  observer.record("nvidia|llama", "tool", "text_json");
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), "text_json");
});

test("a player already set to that mode is never asked about it", () => {
  const observer = createModeObserver();
  observer.record("nvidia|llama", "json_schema", "json_object");
  observer.record("nvidia|llama", "json_schema", "json_object");
  assert.equal(observer.shouldSuggest("nvidia|llama", "json_object"), null);
  // ...but is still told about a rung they have NOT chosen.
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), "json_object");
});

// Endpoints are learned about separately: the same provider can serve one model
// that tool-calls and one that does not.
test("observations do not leak between models", () => {
  const observer = createModeObserver();
  observer.record("gw|good-model", "tool", "json_schema");
  observer.record("gw|good-model", "tool", "json_schema");
  assert.equal(observer.shouldSuggest("gw|good-model", "auto"), "json_schema");
  assert.equal(observer.shouldSuggest("gw|other-model", "auto"), null);
});

test("accepting clears the evidence so later behaviour is learned fresh", () => {
  const observer = createModeObserver();
  observer.record("nvidia|llama", "tool", "json_schema");
  observer.record("nvidia|llama", "tool", "json_schema");
  observer.clear("nvidia|llama");
  assert.equal(observer.shouldSuggest("nvidia|llama", "auto"), null);
});
