/*! Open Historia — battlefields and fronts: who leads a side the lab's staff commands © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The rule trained.js labStaffPolicy follows, in a module of its own: the War Room says who leads the other side
// (GameUI/warRoom.jsx) and reads it here without loading the engine.

import { meantLoserOf, normalizeWarOutcomes } from "../../warOutcomes.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Who leads a side that fights a person, by the game's difficulty (runtime/difficulty.js): "Difficulty sets the
// commander: Easy gets the plainer commander, Normal the current one, Hard one that also weighs your likely replies"
// (the owner, 2026-10-16). A side that fights no person is led by the best there is, whatever the difficulty, and a
// side a scenario's designer meant to lose by the plainer commander, whatever the difficulty.
//   "plainer"   planner.js PLAINER_PLANNER
//   "trained"   the best there is (trainedStaffPolicy)
//   "thorough"  the best there is, weighing the person's likely replies too
export const COMMANDER_OF_DIFFICULTY = Object.freeze({
  "very-easy": "plainer",
  easy: "plainer",
  medium: "trained",
  hard: "thorough",
  "very-hard": "thorough",
  impossible: "thorough",
});

// Who leads a side of a battle, by the same rules: "plainer", "trained" or "thorough".
//   sides      the battle's two lists of members
//   outcomes   the scenario's scripted outcomes (warSettings.outcomes)
//   difficulty the game's difficulty; players, the countries people play
export const commanderOf = ({ sides = [[], []], side = 0, outcomes = [], difficulty = "medium", players = [] } = {}) => {
  const rules = normalizeWarOutcomes(outcomes);
  if (rules.length > 0 && meantLoserOf({ sides, outcomes: rules }) === side) return "plainer";
  const people = new Set((Array.isArray(players) ? players : []).map(fold).filter(Boolean));
  const facesPerson = (Array.isArray(sides?.[1 - side]) ? sides[1 - side] : []).some((member) => people.has(fold(member)));
  return facesPerson ? COMMANDER_OF_DIFFICULTY[fold(difficulty)] ?? "trained" : "trained";
};
