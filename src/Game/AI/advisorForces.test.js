/*! Open Historia — the advisor's view of the world's forces: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/advisorForces.test.js
//
// The advisor is handed every power's forces (${ALL_FORCES_POSTURE}, several KB)
// by its template alone. main.jsx used to append the same paragraph and the same
// posture again at call time, for campaigns whose prompt was frozen; no prompt
// is frozen any more (every game composes its prompts from the current
// defaults), so every advisor message carried the posture twice. What has to
// hold for the call-time copy to stay gone: the paragraph and its placeholder
// sit in the technical text, once, where no edit to the guidance can remove them.
import test from "node:test";
import assert from "node:assert/strict";

import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { composePrompt, guidanceSegmentsFor } from "./promptGuidance.js";

const count = (text, needle) => text.split(needle).length - 1;

test("the advisor template carries the world's forces once, outside every guidance passage", () => {
  const shipped = defaultPrompts.advisor;
  assert.equal(count(shipped, "[Forces on the Map]"), 1);
  assert.equal(count(shipped, "${ALL_FORCES_POSTURE}"), 1);
  assert.equal(defaultPrompts.helpers.ALL_FORCES_POSTURE, "${forcePosture}");

  // An author who rewrote every passage still sends the posture, once.
  const rewritten = Object.fromEntries(guidanceSegmentsFor("advisor").map((segment) => [segment.id, `Rewritten ${segment.id}.`]));
  const composed = composePrompt("advisor", shipped, rewritten);
  assert.notEqual(composed, shipped, "the edits landed");
  assert.equal(count(composed, "[Forces on the Map]"), 1);
  assert.equal(count(composed, "${ALL_FORCES_POSTURE}"), 1);
});
