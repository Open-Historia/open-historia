/*! Open Historia — the player's standing goal tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/playerGoal.test.js
//
// Runs without node_modules: playerGoal.js imports nothing.
//
// The invariant: a goal belongs to one polity, survives a save, is told to the
// advisor, the time skip and the suggestions in their own terms, and is gone
// when the player clears it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAYER_GOAL_MAX_CHARS,
  describeGoalForAdvisor,
  describeGoalForSimulation,
  describeGoalForSuggestions,
  normalizePlayerGoals,
  playerGoalOf,
  withPlayerGoal,
} from "./playerGoal.js";

test("a goal is set for the player's polity, kept through a save, and cleared by an empty one", () => {
  let world = withPlayerGoal({}, "Kingdom of Sardinia", "  Unify   Italy by 1870 ", { round: 3, date: "1859-04-01" });
  assert.deepEqual(world.playerGoals, { "Kingdom of Sardinia": { text: "Unify Italy by 1870", round: 3, date: "1859-04-01" } });
  assert.equal(playerGoalOf(JSON.parse(JSON.stringify(world)), "kingdom of sardinia"), "Unify Italy by 1870", "names match however they are cased");
  assert.equal(playerGoalOf(world, "Austrian Empire"), "", "another polity's goal is not the player's");
  world = withPlayerGoal(world, "Kingdom of Sardinia", "Win Lombardy first");
  assert.equal(playerGoalOf(world, "Kingdom of Sardinia"), "Win Lombardy first");
  world = withPlayerGoal(world, "Kingdom of Sardinia", "   ");
  assert.deepEqual(world.playerGoals, {});
  assert.equal(withPlayerGoal({}, "", "anything").playerGoals, undefined, "no player, nothing set");
});

// A shared game's host rewrote the whole world for a goal sent again in the same
// words (FOLLOWUPS A10): the same words are the same world, so nothing is written.
test("a goal set again in the same words changes nothing: the same world, its date and round kept", () => {
  const world = withPlayerGoal({}, "Kingdom of Sardinia", "Unify Italy by 1870", { round: 3, date: "1859-04-01" });
  assert.equal(withPlayerGoal(world, "kingdom of sardinia", "  Unify  Italy by 1870 "), world);
  assert.equal(withPlayerGoal(world, "Kingdom of Sardinia", "Unify Italy by 1870", { round: 9, date: "1866-01-01" }), world, "its date stays the one it was set on");
  const none = { playerGoals: {} };
  assert.equal(withPlayerGoal(none, "Kingdom of Sardinia", ""), none, "no goal to clear, nothing to write");
  assert.notEqual(withPlayerGoal(world, "Kingdom of Sardinia", "Win Lombardy first"), world);
});

test("a malformed store reads as no goals, and an overlong goal is cut", () => {
  assert.deepEqual(normalizePlayerGoals(null), {});
  assert.deepEqual(normalizePlayerGoals([]), {});
  assert.deepEqual(normalizePlayerGoals({ "": { text: "x" }, France: { text: "" }, Spain: "Keep the peace" }), { Spain: { text: "Keep the peace" } });
  assert.equal(normalizePlayerGoals({ Spain: { text: "a".repeat(900) } }).Spain.text.length, PLAYER_GOAL_MAX_CHARS);
});

test("each reader is told the goal in its own terms, and nothing when there is none", () => {
  assert.match(describeGoalForAdvisor("Unify Italy"), /^\[Our Standing Goal\]\n.*"Unify Italy".*say plainly/s);
  const simulation = describeGoalForSimulation("Unify Italy", "Kingdom of Sardinia");
  assert.match(simulation, /^\[The Player's Standing Goal\]\nKingdom of Sardinia's government is steering toward: "Unify Italy"/);
  assert.match(simulation, /never creates an action the player did not order/);
  assert.match(simulation, /never makes success likelier/);
  assert.match(describeGoalForSuggestions("Unify Italy"), /serve it/);
  for (const describe of [describeGoalForAdvisor, describeGoalForSimulation, describeGoalForSuggestions]) assert.equal(describe(""), "");
});

test("with several people playing, each one's goal reaches the time skip under its own name", async () => {
  const { describeGoalsForSimulation } = await import("./playerGoal.js");
  const world = { playerGoals: { France: { text: "Hold the Rhine" }, Spain: { text: "Win back Gibraltar" }, Portugal: { text: "An AI country's goal is nobody's" } } };
  // One person: exactly the single-player directive, as before.
  assert.equal(describeGoalsForSimulation(world, ["France"]), describeGoalForSimulation("Hold the Rhine", "France"));
  assert.equal(describeGoalsForSimulation(world, ["Italy"]), "", "a player with no goal: nothing");
  // Several: the joined name ("France or Spain") was nobody's, and no goal reached the skip.
  const both = describeGoalsForSimulation(world, ["France", "spain", "Italy", "France"]);
  assert.match(both, /^\[The Players' Standing Goals\]\n/);
  assert.match(both, /\n- France: "Hold the Rhine"/);
  assert.match(both, /\n- spain: "Win back Gibraltar"/, "named as the game names its player, the goal found however it is cased");
  assert.doesNotMatch(both, /Italy/, "a player with no goal is left out");
  assert.doesNotMatch(both, /Portugal|nobody's/, "only the polities people play");
  assert.match(both, /never creates an action its player did not order/);
  assert.match(both, /never makes success likelier/);
  assert.equal(describeGoalsForSimulation(world, ["Italy", "Greece"]), "", "nobody with a goal: nothing");
  assert.equal(describeGoalsForSimulation(null, ["France", "Spain"]), "");
});

test("the time skip's goal block is built for everyone a person plays", async () => {
  // gameplay.js cannot load under bare node: its wiring is read.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const playerGoalBlock = async"), source.indexOf("const runJsonTask = async"));
  assert.match(block, /const people = humanCountriesOf\(game\);\r?\n\s+if \(people\.length > 1\) return describeGoalsForSimulation\(raw, people\);/);
});

test("a progress reading is kept with its goal, with the last score for the trend, and dropped when the goal is reworded", async () => {
  const { playerGoalEntryOf, withGoalProgress, withPlayerGoal } = await import("./playerGoal.js");
  const { normalizeWorldState } = await import("./gameState.js");
  let world = withPlayerGoal({}, "Indonesia", "Unite Timor-Leste with Indonesia", { round: 2 });
  const reading = { progress: 140, summary: "Treaty signed; referendum pending.", achieved: ["Treaty signed", ""], obstacles: ["Referendum"], nextSteps: ["Hold the referendum"], asOf: "2026-02-01", round: 3 };
  world = withGoalProgress(world, "indonesia", "Unite Timor-Leste with Indonesia", reading);
  assert.deepEqual(playerGoalEntryOf(world, "Indonesia").progress, {
    progress: 100, summary: "Treaty signed; referendum pending.", achieved: ["Treaty signed"], obstacles: ["Referendum"], nextSteps: ["Hold the referendum"], asOf: "2026-02-01", round: 3,
  });
  world = withGoalProgress(world, "Indonesia", "Unite Timor-Leste with Indonesia", { ...reading, progress: 60 });
  assert.equal(playerGoalEntryOf(world, "Indonesia").progress.previous, 100);
  assert.equal(playerGoalEntryOf(normalizeWorldState(world), "Indonesia").progress.progress, 60, "the reading survives a save");
  assert.equal(withGoalProgress(world, "Indonesia", "A different goal", reading), world, "a reading of another goal is not stored");
  assert.ok(playerGoalEntryOf(withPlayerGoal(world, "Indonesia", "Unite Timor-Leste with Indonesia"), "Indonesia").progress, "the same goal keeps it");
  assert.equal(playerGoalEntryOf(withPlayerGoal(world, "Indonesia", "Grow the economy"), "Indonesia").progress, undefined, "a new goal starts again");
});

test("the goal progress task has a prompt, a tool and a model slot", async () => {
  const { readFileSync } = await import("node:fs");
  const { getGameplayTool, validateGameplayPayload } = await import("../Game/AI/gameplaySchemas.js");
  const defaults = JSON.parse(readFileSync(new URL("../Game/AI/defaultPrompts.json", import.meta.url), "utf8"));
  assert.match(defaults.tasks.goalProgress, /\$\{goalText\}/);
  assert.equal(getGameplayTool("goalProgress")?.name, "submit_goal_progress");
  assert.equal(validateGameplayPayload("goalProgress", { progress: 40, summary: "Halfway.", achieved: [], obstacles: [], nextSteps: [] }).valid, true);
  assert.equal(validateGameplayPayload("goalProgress", { progress: 140, summary: "x", achieved: [], obstacles: [], nextSteps: [] }).valid, false);
  assert.match(readFileSync(new URL("../Game/AI/providerConfig.js", import.meta.url), "utf8"), /key: "goalProgress"/);
});
