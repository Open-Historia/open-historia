/*! Open Historia — wars meant to end one way: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warOutcomes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { splitWarStartNote } from "../Game/AI/nativeWarLedger.js";
import { compactWarSettings, withWarOutcome, withoutWarOutcome } from "../Game/GameUI/scenarioWarSettings.js";
import { COMMANDER_OF_DIFFICULTY, commanderOf, labStaffPolicy, trainedStaffPolicy } from "./fronts/mind/trained.js";
import { DIFFICULTY_LEVELS } from "./difficulty.js";
import { meantLoserOf, normalizeWarOutcomes } from "./warOutcomes.js";
import { normalizeWarSettings, warSettingsOf } from "./warSettings.js";

const sides = [["Germany", "Austria"], ["Poland"]];

test("the side a war is meant to lose is the scenario designer's to say, in any war between the two", () => {
  assert.equal(meantLoserOf({ sides, outcomes: [{ winner: "Poland", loser: "Austria" }] }), 0);
  assert.equal(meantLoserOf({ sides, outcomes: [{ winner: "germany", loser: "POLAND" }] }), 1);
  // Sides listed the other way round are read by their names.
  assert.equal(meantLoserOf({ sides: [["Poland"], ["Germany"]], outcomes: [{ winner: "Germany", loser: "Poland" }] }), 0);
  // Nothing said, or said of countries not on it: neither.
  assert.equal(meantLoserOf({ sides }), -1);
  assert.equal(meantLoserOf({ sides, outcomes: [{ winner: "France", loser: "Poland" }] }), -1);
  assert.deepEqual(normalizeWarOutcomes([{ winner: "A", loser: "B" }, { winner: "a", loser: "b" }, { winner: "C", loser: "c" }, { winner: "", loser: "D" }]), [{ winner: "A", loser: "B" }]);
});

test("a scenario keeps its outcomes with its war settings, and only where it has some", () => {
  assert.equal(normalizeWarSettings({ mechanics: {} }).outcomes, undefined);
  assert.deepEqual(normalizeWarSettings({ outcomes: [{ winner: "Germany", loser: "Poland" }] }).outcomes, [{ winner: "Germany", loser: "Poland" }]);
  assert.deepEqual(warSettingsOf({ warSettings: { outcomes: [{ winner: "Germany", loser: "Poland" }] } }).outcomes, [{ winner: "Germany", loser: "Poland" }]);
  // The Scenario Editor's form: added, taken off, and nothing at all once there is nothing.
  const one = withWarOutcome(null, "Germany", "Poland");
  assert.deepEqual(one.outcomes, [{ winner: "Germany", loser: "Poland" }]);
  assert.deepEqual(withWarOutcome(one, "Japan", "China").outcomes.map((rule) => rule.winner), ["Germany", "Japan"]);
  assert.equal(withoutWarOutcome(one, 0), null);
  assert.equal(compactWarSettings({ mechanics: {} }), null);
});

test("the difficulty gives the commander of a side that fights a person: plainer when easy, the best there is at medium, weighing replies when hard", () => {
  // "Difficulty sets the commander: Easy gets the plainer commander, Normal the current one, Hard one that also weighs
  // your likely replies" (the owner, 2026-10-16).
  assert.deepEqual(Object.keys(COMMANDER_OF_DIFFICULTY).sort(), DIFFICULTY_LEVELS.map((level) => level.id).sort(), "every level has one");
  const sides = [["Germany"], ["Poland"]];
  const players = ["Poland"];
  const lead = (difficulty, extra = {}) => [0, 1].map((side) => commanderOf({ sides, side, difficulty, players, ...extra }));
  assert.deepEqual(lead("easy"), ["plainer", "trained"]);
  assert.deepEqual(lead("very-easy"), ["plainer", "trained"]);
  assert.deepEqual(lead("medium"), ["trained", "trained"]);
  assert.deepEqual(lead("hard"), ["thorough", "trained"]);
  assert.deepEqual(lead("impossible"), ["thorough", "trained"]);
  // A war no person fights in: the best there is, whatever the difficulty.
  assert.deepEqual(lead("easy", { players: ["France"] }), ["trained", "trained"]);
  assert.deepEqual(lead("hard", { players: [] }), ["trained", "trained"]);
  // A side the scenario means to lose is led by the plainer commander even at hard.
  assert.deepEqual(lead("hard", { outcomes: [{ winner: "Poland", loser: "Germany" }] }), ["plainer", "trained"]);
  // The run's staff follows it; at medium with nothing scripted it is the trained staff itself.
  const policy = labStaffPolicy({ difficulty: "hard", players });
  assert.deepEqual([0, 1].map((side) => policy.commanderFor({ sides }, side)), ["thorough", "trained"]);
  assert.equal(typeof policy.steps, "function");
  assert.equal(labStaffPolicy({ difficulty: "medium", players }), trainedStaffPolicy());
  assert.equal(labStaffPolicy({ difficulty: "easy", players: [] }), trainedStaffPolicy());
});

test("only a designer's scripted war has a plainer commander: every other war is led by the best there is", () => {
  const policy = labStaffPolicy({ outcomes: [{ winner: "Germany", loser: "Poland" }] });
  assert.equal(typeof policy, "function");
  assert.equal(policy.often, true);
  const battle = { warId: "war-1", sides: [["Germany"], ["Poland"]], daysRun: 1 };
  assert.deepEqual([0, 1].map((side) => policy.commanderFor(battle, side)), ["trained", "plainer"]);
  assert.deepEqual([0, 1].map((side) => policy.commanderFor({ ...battle, sides: [["Poland"], ["Germany"]] }, side)), ["plainer", "trained"]);
  // Another war altogether: the best there is on both sides.
  assert.deepEqual([0, 1].map((side) => policy.commanderFor({ warId: "war-2", sides: [["Japan"], ["China"]] }, side)), ["trained", "trained"]);
  // Without a run either orders nothing.
  assert.deepEqual([0, 1].map((side) => policy(battle, side, {}, null)), [undefined, undefined]);
  // With no scripted war it is the trained staff itself, whatever the story wrote of a war.
  assert.equal(labStaffPolicy(), trainedStaffPolicy());
  assert.equal(labStaffPolicy({ wars: [{ id: "war-1", sideA: ["Germany"], sideB: ["Poland"], meantWinner: "sideA" }] }), trainedStaffPolicy());
  // And the story is not asked: a start's note is its title and its cause, nothing else.
  assert.deepEqual(splitWarStartNote("Title: The September Campaign; Favoured: Germany; Danzig"), { title: "The September Campaign", cause: "Favoured: Germany; Danzig" });
});
