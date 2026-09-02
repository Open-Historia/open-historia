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
  expandVariableOrder,
  stablePrefixLength,
  staticiseTemplate,
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

// ---------------------------------------------------------------------------
// Turning a real template static

test("campaign-fixed values stay inline; volatile ones move to the end", () => {
  const helpers = { PLAYER_POLITY: "${playerPolity}", ORIGIN_ROUND_DATE: "${date}" };
  const vars = { playerPolity: "United Kingdom", date: "2037-03-07", language: "English" };
  const { text, order } = staticiseTemplate(
    "You are ${PLAYER_POLITY}. As of ${ORIGIN_ROUND_DATE}. Write in ${language}.",
    helpers,
    vars,
  );
  // Readable prose for the stable ones — a pointer would be longer than the value.
  assert.ok(text.includes("You are United Kingdom."));
  assert.ok(text.includes("Write in English."));
  // ...and the volatile one is a pointer, because inlining it would end the prefix.
  assert.ok(!text.includes("2037-03-07"), "a volatile value was left inline");
  assert.ok(text.includes('see "date"'));
  assert.deepEqual(order, ["date"]);
});

// Blanking is the tempting shortcut and it damages the prose at 29 sites.
test("no placeholder is left behind, and no hole is left in a sentence", () => {
  const { text } = staticiseTemplate("as of the Origin Date, ${ORIGIN_ROUND_DATE}:", { ORIGIN_ROUND_DATE: "${date}" }, {});
  assert.ok(!/\$\{/.test(text), "an unresolved placeholder survived");
  assert.ok(!text.includes(", :"), "the sentence was left with a hole");
});

// A campaign value that is missing must not leave a gap either.
test("a missing campaign value falls back to a pointer", () => {
  const { text, order } = staticiseTemplate("You are ${PLAYER_POLITY}.", { PLAYER_POLITY: "${playerPolity}" }, {});
  assert.ok(text.includes('see "player polity"'));
  assert.deepEqual(order, ["playerPolity"]);
});

// The 258KB consolidated history only moves every ~5 rounds, but it is shipped
// glued to the last 24 events. Tiered as one, a quarter of the prompt falls out
// of the prefix purely because of how it is packaged.
test("the campaign history is split so its stable half can be reused", () => {
  assert.deepEqual(expandVariableOrder(["recentEventsLong"]), ["consolidatedHistory", "recentEvents"]);
  assert.equal(tierOf("consolidatedHistory"), "era");
  assert.equal(tierOf("recentEvents"), "now");
  // Order is preserved and repeats collapse.
  assert.deepEqual(
    expandVariableOrder(["date", "recentEventsLong", "consolidatedHistory", "date"]),
    ["date", "consolidatedHistory", "recentEvents"],
  );
  assert.deepEqual(expandVariableOrder(null), []);
});
