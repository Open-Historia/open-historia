/*! Open Historia — directive de-duplication tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/promptDedupe.test.js
//
// Runs without node_modules: promptDedupe.js is import-free.
//
// The asymmetry this guards: a false negative re-appends a directive the prompt
// already had, which is merely today's behaviour. A false positive DELETES a
// rule from the prompt, and nothing at runtime would report it — the model just
// quietly stops being told something.

import test from "node:test";
import assert from "node:assert/strict";

import { UNIT_CONTRACT_MARKER, templateAlreadySays } from "./promptDedupe.js";
import defaultPrompts from "./defaultPrompts.json" with { type: "json" };

test("a rule already in the prompt is recognised", () => {
  assert.equal(
    templateAlreadySays("...Units are EVIDENCE OF YOUR OWN EVENTS, not a game the player plays...", UNIT_CONTRACT_MARKER),
    true,
  );
});

test("reflowed or recapitalised wording still counts as present", () => {
  // A scenario author who wrapped the paragraph differently has not lost the
  // rule, so the directive must not be appended a second time.
  assert.equal(templateAlreadySays("Units are EVIDENCE\n  OF YOUR   OWN EVENTS.", UNIT_CONTRACT_MARKER), true);
  assert.equal(templateAlreadySays("units are evidence of your own events", UNIT_CONTRACT_MARKER), true);
});

test("a prompt without the rule gets the directive", () => {
  assert.equal(templateAlreadySays("A prompt about diplomacy and borders.", UNIT_CONTRACT_MARKER), false);
  // A frozen campaign predating the rule: this is the case the whole call-time
  // injection mechanism exists for, and it must keep receiving it.
  assert.equal(templateAlreadySays("Simulate events between the two dates.", UNIT_CONTRACT_MARKER), false);
});

// An empty marker would match every prompt and silently drop the directive it
// guards on every single call — the exact failure mode this module is here to
// prevent, so it fails closed.
test("an empty marker or prompt never claims the rule is present", () => {
  assert.equal(templateAlreadySays("anything at all", ""), false);
  assert.equal(templateAlreadySays("anything at all", null), false);
  assert.equal(templateAlreadySays("anything at all", undefined), false);
  assert.equal(templateAlreadySays("", UNIT_CONTRACT_MARKER), false);
  assert.equal(templateAlreadySays(null, UNIT_CONTRACT_MARKER), false);
});

// The marker is only useful if it actually appears in the bundled template. If
// someone rewrites that section (Phase 5 does exactly that), this fails and says
// so, rather than the de-duplication silently going dead and the duplicate
// quietly returning.
test("the unit marker still matches the bundled jumpForward template", () => {
  assert.equal(
    templateAlreadySays(defaultPrompts.tasks.jumpForward, UNIT_CONTRACT_MARKER),
    true,
    "the bundled template no longer contains the unit-contract marker — update UNIT_CONTRACT_MARKER",
  );
});

// The other half of the same decision, recorded as a test so it is not "fixed"
// by someone extending the de-duplication to ACTIONS_REFERENCE. The template's
// output-contract tail overlaps that block heavily, but predates three levers
// that ONLY the appended block mentions, so skipping it would take them away.
test("the bundled template does not carry the newer levers, so ACTIONS_REFERENCE must keep being appended", () => {
  const template = defaultPrompts.tasks.jumpForward;
  for (const lever of ["regionClaims", "actionIds", "projectOps"]) {
    assert.equal(
      template.includes(lever),
      false,
      `${lever} is now in the template — re-check whether ACTIONS_REFERENCE can be de-duplicated too`,
    );
  }
});
