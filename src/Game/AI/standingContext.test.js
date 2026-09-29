/*! Open Historia — what a prompt is told of a country's standing: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/standingContext.test.js
//
// standingContext.js is the one place the prompts read a country's standing
// from: the skip and the suggestion tasks through gameplay.js, the advisor and
// the leaders through main.jsx. What has to hold is in each test's name.
import test from "node:test";
import assert from "node:assert/strict";

import {
  describeIntelligenceStanding,
  describeReputationStanding,
  otherRecordedReputations,
  recordedReputation,
  reputationOf,
} from "./standingContext.js";

const PLAYER = "French Republic";

const WORLD = {
  internationalReputation: { [PLAYER]: 72, "Kingdom of Italy": 18, Spain: 50, Portugal: 61, "German Empire": 90 },
  intelligence: { [PLAYER]: 64, "German Empire": 80 },
};

// ---- Reputation --------------------------------------------------------------

test("a reputation is the one the AI evolved, else the Stats sheet's, else a neutral 50", () => {
  assert.equal(recordedReputation(WORLD, PLAYER), 72);
  assert.equal(recordedReputation({ countryStats: { Spain: { indices: { internationalReputation: 33.4 } } } }, "Spain"), 33);
  assert.equal(recordedReputation(WORLD, "Belgium"), null);
  assert.equal(reputationOf(WORLD, "Belgium"), 50);
  assert.equal(reputationOf(WORLD, "Belgium", 41), 41, "the caller's own fallback");
  assert.equal(recordedReputation(WORLD, "french republic"), null, "a polity name is an exact key");
});

test("the player's reputation comes with every other recorded one, the most extreme first", () => {
  const text = describeReputationStanding(WORLD, PLAYER);
  assert.equal(text.split("\n")[0], "International reputation: 72/100 (well-regarded).");
  assert.match(text, /^Other recorded reputations: German Empire 90\/100, Kingdom of Italy 18\/100, Portugal 61\/100\. Every polity not listed stands at 50\.$/m);
  assert.doesNotMatch(text.split("\n")[1], /Spain|French Republic/, "a neutral 50 and the player are not listed");
  assert.deepEqual(otherRecordedReputations(WORLD, [PLAYER], 1), [["German Empire", 90]]);
  assert.equal(describeReputationStanding({}, PLAYER), "International reputation: 50/100 (mixed).", "nothing else recorded, nothing else said");
  assert.equal(describeReputationStanding(WORLD, ""), "No player polity is currently set.");
});

test("the intelligence line names the player's service and the others the AI has rated", () => {
  assert.equal(describeIntelligenceStanding(WORLD, PLAYER), "French Republic's intelligence service: 64/100 (capable).\nOther rated services: German Empire 80/100.");
  assert.match(describeIntelligenceStanding({}, "Belgium"), /^Belgium's intelligence service: \d+\/100 \(ordinary\)\.$/);
  assert.equal(describeIntelligenceStanding(WORLD, ""), "");
});
