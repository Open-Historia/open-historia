import assert from "node:assert/strict";
import test from "node:test";

import { toolResponsePayload } from "./toolResponsePayload.js";

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
