/*! Open Historia — prompt layout tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/promptLayout.test.js
//
// Runs without node_modules: promptLayout.js is import-free.
//
// The asymmetry that shapes these tests: mis-tiering a variable as MORE volatile
// than it is only costs cache. Mis-tiering it as more STABLE than it is hands the
// model last turn's world and is invisible. So "unknown means volatile" is the
// rule, and it is tested first.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAMPAIGN_VARS,
  ERA_VARS,
  buildStateBlocks,
  stablePrefixLength,
  tierOf,
} from "./promptLayout.js";

test("anything unrecognised is treated as changing every turn", () => {
  // The safe default: a variable added later and never classified lands in NOW.
  assert.equal(tierOf("somethingAddedNextYear"), "now");
  assert.equal(tierOf("worldSummary"), "now");
  assert.equal(tierOf("recentEventsLong"), "now");
  assert.equal(tierOf("chatHistoryLong"), "now");
  assert.equal(tierOf("unitsSummary"), "now");
  assert.equal(tierOf("date"), "now");
  assert.equal(tierOf(""), "now");
  assert.equal(tierOf(undefined), "now");
});

test("campaign-fixed and era-scale content are separated from the turn", () => {
  for (const name of CAMPAIGN_VARS) assert.equal(tierOf(name), "campaign", `${name} should be campaign-fixed`);
  for (const name of ERA_VARS) assert.equal(tierOf(name), "era", `${name} should be era-scale`);
  // The consolidated history is the whole reason the era tier exists: 41% of a
  // mature prompt, and it only moves when the consolidator runs.
  assert.ok(ERA_VARS.includes("consolidatedHistory"));
});

test("blocks are emitted most-stable first", () => {
  const out = buildStateBlocks(
    { playerPolity: "Britain", consolidatedHistory: "Long ago...", worldSummary: "Today..." },
    ["worldSummary", "playerPolity", "consolidatedHistory"],
  );
  const campaign = out.indexOf("THIS CAMPAIGN");
  const era = out.indexOf("THE STORY SO FAR");
  const now = out.indexOf("THE WORLD RIGHT NOW");
  assert.ok(campaign >= 0 && era > campaign && now > era, `wrong order:\n${out}`);
  // Order in, order out: the volatile value must not leak forward.
  assert.ok(out.indexOf("Britain") < out.indexOf("Today..."));
});

// A heading with nothing under it is noise the model has to read past, and an
// empty section changes length between turns — which breaks the prefix.
test("empty and missing values produce no heading at all", () => {
  assert.equal(buildStateBlocks({}, ["worldSummary"]), "");
  assert.equal(buildStateBlocks({ worldSummary: "   " }, ["worldSummary"]), "");
  const out = buildStateBlocks({ playerPolity: "Britain", worldSummary: "" }, ["playerPolity", "worldSummary"]);
  assert.ok(out.includes("THIS CAMPAIGN"));
  assert.ok(!out.includes("THE WORLD RIGHT NOW"), "an empty tier still printed its heading");
});

test("nothing is dropped — every supplied value survives the reorder", () => {
  const variables = {
    playerPolity: "Britain",
    simulationRules: "RULE-ALPHA",
    consolidatedHistory: "ERA-BRAVO",
    worldSummary: "NOW-CHARLIE",
    unitsSummary: "NOW-DELTA",
  };
  const out = buildStateBlocks(variables, Object.keys(variables));
  for (const value of Object.values(variables)) {
    assert.ok(out.includes(value), `${value} was lost in the reorder`);
  }
});

test("the prefix covers the rules and everything stable, and stops at the turn", () => {
  const variables = {
    playerPolity: "Britain",
    consolidatedHistory: "E".repeat(1000),
    worldSummary: "N".repeat(5000),
  };
  const order = ["playerPolity", "consolidatedHistory", "worldSummary"];
  const rules = "R".repeat(2000);
  const prefix = stablePrefixLength(rules, variables, order);

  // Rules + campaign + era are in; the turn is not.
  assert.ok(prefix > 3000, `prefix too short: ${prefix}`);
  const whole = `${rules}\n\n${buildStateBlocks(variables, order)}`;
  assert.ok(prefix < whole.length, "the prefix cannot include the volatile tail");
  // And it must not accidentally swallow the volatile block.
  assert.ok(whole.indexOf("N".repeat(5000)) >= prefix, "volatile content fell inside the prefix");
});

test("a prompt with no stable content still works", () => {
  assert.equal(stablePrefixLength("", {}, []), 0);
  assert.equal(buildStateBlocks(null, null), "");
});
