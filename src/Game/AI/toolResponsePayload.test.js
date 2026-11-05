import assert from "node:assert/strict";
import test from "node:test";

import { holdsWholeAnswer, toolResponsePayload, unmarkedEndVerdict } from "./toolResponsePayload.js";

test("a real tool call wins over the text beside it", () => {
  assert.deepEqual(toolResponsePayload({ rawText: "{\"a\":2}", toolInput: { a: 1 } }), { a: 1 });
});

test("a text-mode answer is parsed from rawText", () => {
  assert.deepEqual(toolResponsePayload({ rawText: "{\"checksJson\":\"[]\"}", toolInput: null }), { checksJson: "[]" });
});

test("fences and a think block around a text-mode answer are stripped", () => {
  assert.deepEqual(
    toolResponsePayload({ rawText: "<think>plan</think>\n```json\n{\"membersJson\":\"[]\"}\n```", toolInput: null }),
    { membersJson: "[]" },
  );
});

test("a text answer that imitates a tool call is unwrapped to its arguments", () => {
  const rawText = JSON.stringify([{ name: "submit_x", parameters: { powerJson: "[]" } }]);
  assert.deepEqual(toolResponsePayload({ rawText, toolInput: null }, "submit_x"), { powerJson: "[]" });
});

test("an unparseable text answer falls back to the envelope and a bare payload passes through", () => {
  assert.deepEqual(toolResponsePayload({ rawText: "no json here", toolInput: null }), { rawText: "no json here", toolInput: null });
  assert.deepEqual(toolResponsePayload({ verifications: [] }), { verifications: [] });
  assert.equal(toolResponsePayload(null), null);
  assert.equal(toolResponsePayload("text"), null);
});

// A stream that ended before the provider said it had finished: a structured
// answer is used only when what arrived is a whole one.
test("what a stream that closed early left is whole only as a tool call or one complete JSON payload", () => {
  assert.equal(holdsWholeAnswer("", { events: [] }), true, "the output function's call arrived");
  assert.equal(holdsWholeAnswer('{"events":[{"title":"A war"}]}'), true);
  assert.equal(holdsWholeAnswer('<think>plan</think>\n```json\n{"events":[]}\n```'), true);
  // Half a turn: an object left open is missing content by definition.
  assert.equal(holdsWholeAnswer('{"events":[{"title":"A war"},{"title":"A tre'), false);
  assert.equal(holdsWholeAnswer('{"topics":[{"title":"x","actions":[{"title":"y","text":"cut mid-sent'), false);
  // Prose cannot say it is complete, so a reply in words is never whole: it has its own rule, below.
  assert.equal(holdsWholeAnswer("Your Excellency, we accept the terms and"), false);
  assert.equal(holdsWholeAnswer(""), false);
  assert.equal(holdsWholeAnswer(undefined, null), false);
  assert.equal(holdsWholeAnswer("", []), false, "a tool call's input is an object");
});

// The whole rule for a stream with no end marker: no finish reason, no [DONE],
// no error. What the call wanted decides.
test("a structured answer on a stream with no end marker is used when whole, and is a closed connection otherwise", () => {
  assert.equal(unmarkedEndVerdict({ structured: true, toolInput: { events: [] } }), "whole");
  assert.equal(unmarkedEndVerdict({ structured: true, answerText: '{"events":[{"title":"A war"}]}' }), "whole");
  assert.equal(unmarkedEndVerdict({ structured: true, answerText: '{"events":[{"title":"A war"},{"title":"A tre' }), "closed");
  // A task that wanted JSON and got words has nothing it can use, however complete they read.
  assert.equal(unmarkedEndVerdict({ structured: true, answerText: "Here is the turn you asked for." }), "closed");
  assert.equal(unmarkedEndVerdict({ structured: true, answerText: "" }), "closed");
  assert.equal(unmarkedEndVerdict({ structured: true }), "closed");
});

test("a reply in words on a stream with no end marker is kept as it arrived, and an empty one is a closed connection", () => {
  // Some gateways send neither a finish reason nor [DONE] on any stream: every
  // reply they send ends this way, and each is a whole reply.
  assert.equal(unmarkedEndVerdict({ structured: false, answerText: "Your Excellency, we accept the terms." }), "kept");
  // One that really was cut is kept too: nothing tells the two apart, and it is visibly cut short.
  assert.equal(unmarkedEndVerdict({ structured: false, answerText: "Your Excellency, we accept the terms and" }), "kept");
  // Words that happen to be JSON (the translator's reply) are still a reply in words.
  assert.equal(unmarkedEndVerdict({ structured: false, answerText: '["Annuler","Enreg' }), "kept");
  // Nothing arrived: there is no reply to keep.
  assert.equal(unmarkedEndVerdict({ structured: false, answerText: "" }), "closed");
  assert.equal(unmarkedEndVerdict({ structured: false, answerText: " \n\t" }), "closed");
  assert.equal(unmarkedEndVerdict({ structured: false, answerText: null }), "closed");
  assert.equal(unmarkedEndVerdict({ structured: false }), "closed");
  // A call says which it is; one that does not is a reply in words.
  assert.equal(unmarkedEndVerdict({ answerText: "Quiet on the border." }), "kept");
  assert.equal(unmarkedEndVerdict(), "closed");
});
