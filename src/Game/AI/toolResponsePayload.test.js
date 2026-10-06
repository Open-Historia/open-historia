import assert from "node:assert/strict";
import test from "node:test";

import { holdsWholeAnswer, toolResponsePayload } from "./toolResponsePayload.js";

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

// A stream that closed before the provider said it had finished: what arrived
// is used only when it is a whole answer, and is a failed call otherwise.
test("what a stream that closed early left is whole only as a tool call or one complete JSON payload", () => {
  assert.equal(holdsWholeAnswer("", { events: [] }), true, "the output function's call arrived");
  assert.equal(holdsWholeAnswer('{"events":[{"title":"A war"}]}'), true);
  assert.equal(holdsWholeAnswer('<think>plan</think>\n```json\n{"events":[]}\n```'), true);
  // Half a turn: an object left open is missing content by definition.
  assert.equal(holdsWholeAnswer('{"events":[{"title":"A war"},{"title":"A tre'), false);
  assert.equal(holdsWholeAnswer('{"topics":[{"title":"x","actions":[{"title":"y","text":"cut mid-sent'), false);
  // Prose cannot say it is complete, so a reply in words is never whole.
  assert.equal(holdsWholeAnswer("Your Excellency, we accept the terms and"), false);
  assert.equal(holdsWholeAnswer(""), false);
  assert.equal(holdsWholeAnswer(undefined, null), false);
  assert.equal(holdsWholeAnswer("", []), false, "a tool call's input is an object");
});
