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

import {
  DEDUPE_MIN_BLOCK_CHARS,
  UNIT_CONTRACT_MARKER,
  collapseRepeatedBlock,
  templateAlreadySays,
} from "./promptDedupe.js";
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

// ---------------------------------------------------------------------------
// Collapsing a block the prompt carries twice
//
// The real case: a 107,870-character scenario briefing rendered both by the task
// text's own placeholder and again inside the world summary, on eight of the
// sixteen prompts. About a third of a jump prompt, spent saying it twice.

const BRIEFING = `# HISTORIA TIMELINE\n${"The United Kingdom expands into Sierra Leone. ".repeat(30)}`;
const POINTER = "(reproduced earlier)";

test("a repeated block keeps its first copy and points at it thereafter", () => {
  const prompt = `RULES\n\n${BRIEFING}\n\nWORLD SNAPSHOT\n\n${BRIEFING}\n\nEND`;
  const out = collapseRepeatedBlock(prompt, BRIEFING, POINTER);
  assert.equal(out.split(BRIEFING).length - 1, 1, "the block should survive exactly once");
  assert.ok(out.includes(POINTER));
  // The surviving copy must be the FIRST, where the prose introduces it.
  assert.ok(out.indexOf(BRIEFING) < out.indexOf(POINTER));
  // Nearly the whole second copy is gone. Deliberately not an exact arithmetic
  // check: the block is trimmed before matching, so an exact figure would be
  // brittle about surrounding whitespace without testing anything real.
  assert.ok(out.length < prompt.length - BRIEFING.length + 100, `only saved ${prompt.length - out.length} chars`);
});

test("three copies collapse to one", () => {
  const prompt = `${BRIEFING}\nA\n${BRIEFING}\nB\n${BRIEFING}`;
  const out = collapseRepeatedBlock(prompt, BRIEFING, POINTER);
  assert.equal(out.split(BRIEFING).length - 1, 1);
  assert.equal(out.split(POINTER).length - 1, 2);
});

// Safe to call unconditionally: a prompt that only had it once must be untouched,
// or a task that reaches the briefing by ONE route would silently lose it.
test("a prompt carrying the block once is returned unchanged", () => {
  const prompt = `RULES\n\n${BRIEFING}\n\nEND`;
  assert.equal(collapseRepeatedBlock(prompt, BRIEFING, POINTER), prompt);
});

test("nothing is collapsed when there is nothing to collapse", () => {
  assert.equal(collapseRepeatedBlock("just rules", BRIEFING, POINTER), "just rules");
  assert.equal(collapseRepeatedBlock("", BRIEFING, POINTER), "");
  assert.equal(collapseRepeatedBlock(null, BRIEFING, POINTER), "");
  assert.equal(collapseRepeatedBlock("abc", null, POINTER), "abc");
});

// A short placeholder repeated twice is not bulk, and replacing it with a
// pointer would read as though something had been left out.
test("a short repeated string is left alone", () => {
  const placeholder = "No pre-game world briefing was provided.";
  assert.ok(placeholder.length < DEDUPE_MIN_BLOCK_CHARS);
  const prompt = `A ${placeholder} B ${placeholder} C`;
  assert.equal(collapseRepeatedBlock(prompt, placeholder, POINTER), prompt);
});
