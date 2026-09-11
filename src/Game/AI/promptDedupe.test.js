/*! Open Historia — directive de-duplication tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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
  SIMULATION_RULES_POINTER,
  collapseRepeatedBlock,
  collapseRepeatedWorldContext,
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

// ---------------------------------------------------------------------------
// The briefing and the simulation rules, across every bundled prompt
//
// Field report: the Pre-Game History prompt pasted the simulation rules twice,
// once under its own heading and again inside ${GRAND_MAP_DESCRIPTION_NO_CITY}.

const RULES = `No nuclear weapons exist. ${"Colonial borders follow the 1914 settlement. ".repeat(12)}`;

// Built the way buildWorldSummary (promptContext.js) embeds both.
const worldSummary = [
  "Player polity: France",
  `World before round one: ${BRIEFING}`,
  `Simulation rules: ${RULES}`,
  "",
  "Map ownership:",
  "- France: Brittany, Normandy",
].join("\n");

const VARIABLES = {
  playerPolity: "France",
  simulationRules: RULES,
  worldBeforeRoundOne: BRIEFING,
  worldSummary,
  worldSummaryNoCity: worldSummary,
};

// resolveHelperValues and renderTemplate, without promptContext.js's imports.
const renderBundled = (template) => {
  const fill = (text, values) => String(text).replace(/\$\{([^}]+)\}/g, (_match, key) => values[key] ?? "");
  let helpers = {};
  for (let pass = 0; pass < 2; pass += 1) {
    helpers = Object.fromEntries(Object.entries(defaultPrompts.helpers)
      .map(([key, text]) => [key, fill(text, { ...VARIABLES, ...helpers })]));
  }
  return fill(template, { ...VARIABLES, ...helpers });
};

const countOf = (text, block) => text.split(block.trim()).length - 1;

const BUNDLED_PROMPTS = {
  advisor: defaultPrompts.advisor,
  leader: defaultPrompts.leader,
  ...defaultPrompts.tasks,
};

test("the rules pasted under their own heading and in the world summary collapse to one", () => {
  const prompt = `Simulation rules for this world:\n${RULES}\n\nThe current political map:\n${worldSummary}`;
  const out = collapseRepeatedWorldContext(prompt, VARIABLES);
  assert.equal(countOf(out, RULES), 1);
  assert.equal(countOf(out, BRIEFING), 1);
  assert.ok(out.includes(`Simulation rules: ${SIMULATION_RULES_POINTER}`));
  // The copy under the prompt's own heading is the one that survives.
  assert.ok(out.startsWith(`Simulation rules for this world:\n${RULES}`));
});

test("every bundled prompt carries the rules and the briefing at most once", () => {
  for (const [key, template] of Object.entries(BUNDLED_PROMPTS)) {
    const rendered = renderBundled(template);
    const out = collapseRepeatedWorldContext(rendered, VARIABLES);
    for (const [name, block] of [["rules", RULES], ["briefing", BRIEFING]]) {
      // Collapsing may never take away the only copy a prompt had.
      assert.equal(countOf(out, block), Math.min(countOf(rendered, block), 1), `${key}: ${name}`);
    }
  }
});

// The report's prompt, and the two tasks that see the rules only through the
// world summary: the first must lose its repeat, the others must keep theirs.
test("pre-game history loses the repeat, and the summary-only tasks keep their copy", () => {
  const pregame = renderBundled(defaultPrompts.tasks.pregameHistory);
  assert.equal(countOf(pregame, RULES), 2, "the bundled pre-game prompt no longer repeats the rules");
  assert.equal(countOf(collapseRepeatedWorldContext(pregame, VARIABLES), RULES), 1);
  for (const key of ["actions", "idleDiplomacy"]) {
    const rendered = renderBundled(defaultPrompts.tasks[key]);
    assert.equal(countOf(rendered, RULES), 1, `${key} now renders the rules on its own`);
    assert.equal(collapseRepeatedWorldContext(rendered, VARIABLES), rendered);
  }
});

// A lazily built task may not construct simulationRules at all; with nothing to
// match, the prompt goes out as rendered.
test("missing variables leave the prompt untouched", () => {
  const prompt = `${RULES}\n${worldSummary}`;
  assert.equal(collapseRepeatedWorldContext(prompt, {}), prompt);
  assert.equal(collapseRepeatedWorldContext(prompt, null), prompt);
});
