/*! Open Historia — battlefields and fronts: the trained staff the lab can switch on (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. The staff a training run produced (weights.js,
// written by tools/strategy-nn/export.mjs), as the engine takes one
// (policy.js). null where none is shipped or its weights do not fit this
// build's network: the engine's own scripted staff then decides, as ever.
//
// Where no network is shipped (Wars and Fronts Pt.2), it is the staff that
// looks ahead (planner.js), with the weights plannerWeights.js ships: "put that
// current model on 3319 for me to test" (the owner, 2026-10-14).
//
// It is used only when the lab's switch is on (Game/AI/frontsGate.js
// strategyNetOn).

import { readWeights } from "./net.js";
import { LATE_AT, PLAN_PARAMS, createPlainerPlanner, createPlanner, plainPlanner, withLateEval } from "./planner.js";
import { normalizeWarOutcomes } from "../../warOutcomes.js";
import { COMMANDER_OF_DIFFICULTY, commanderOf } from "./commanders.js";
import { SHIPPED_PLANNER } from "./plannerWeights.js";
import { createStaffPolicy, createTroopPolicy } from "./policy.js";
import { TRAINED_STAFF } from "./weights.js";

// (Who leads a side: commanders.js, where the War Room reads it.)
export { COMMANDER_OF_DIFFICULTY, commanderOf };

let made = false;
let policy = null;
// What each commander decided at each of its looks this sitting (planner.js `memo`): a skip fights its period
// twice, before its story is written and again as it is applied, and the second time each has what it decided the
// first time at hand rather than thinking it all again.
const TRAINED_MEMO = new Map();
const PLAINER_MEMO = new Map();
const THOROUGH_MEMO = new Map();
let plainer = null;
const plainerPolicy = () => {
  plainer ??= createPlainerPlanner({ memo: PLAINER_MEMO });
  return plainer;
};
// The best there is, weighing each plan against the other side's likely replies as well (planner.js REPLIES).
let thorough = null;
const thoroughPolicy = () => {
  thorough ??= createPlanner({ params: shippedPlannerParams(), replies: true, memo: THOROUGH_MEMO });
  return thorough;
};
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// The weights the staff that looks ahead is shipped with: a champion's that fit, or its plain ones.
// (Weights made before the later weighing, LATE_AT long, are read with it at its defaults: planner.js withLateEval.)
export const shippedPlannerParams = () => (Array.isArray(SHIPPED_PLANNER?.params) && (SHIPPED_PLANNER.params.length === PLAN_PARAMS || SHIPPED_PLANNER.params.length === LATE_AT) && SHIPPED_PLANNER.params.every(Number.isFinite)
  ? withLateEval(SHIPPED_PLANNER.params)
  : plainPlanner());

export const trainedStaffPolicy = () => {
  if (made) return policy;
  made = true;
  const weights = readWeights(TRAINED_STAFF);
  // (Weights with a head order troops one by one; without, the side as a whole; none, the staff that looks ahead.)
  policy = !weights ? createPlanner({ params: shippedPlannerParams(), memo: TRAINED_MEMO }) : weights.shape.head > 0 ? createTroopPolicy(weights) : createStaffPolicy(weights);
  return policy;
};

// The lab's staff for a run: the best there is (the trained one) for every side, but the plainer commander for a
// side a scenario's designer meant its war to lose (planner.js PLAINER_PLANNER; runtime/warOutcomes.js), and for a
// side that fights a person, the commander the game's difficulty gives it (COMMANDER_OF_DIFFICULTY).
//   outcomes    the scenario's (warSettings.outcomes)
//   difficulty  the game's; players, the countries people play
export const labStaffPolicy = ({ outcomes = [], difficulty = "medium", players = [] } = {}) => {
  const trained = trainedStaffPolicy();
  if (!trained) return null;
  const rules = normalizeWarOutcomes(outcomes);
  const people = (Array.isArray(players) ? players : []).map(fold).filter(Boolean);
  const byDifficulty = COMMANDER_OF_DIFFICULTY[fold(difficulty)] ?? "trained";
  if (rules.length === 0 && (people.length === 0 || byDifficulty === "trained")) return trained;
  // Who leads a side of a battle: "plainer", "trained" or "thorough". (Only a staff that looks ahead has replies
  // to weigh: a trained network leads as it is.)
  const commanderFor = (battle, side) => {
    const who = commanderOf({ sides: battle?.sides, side, outcomes: rules, difficulty, players: people });
    return who === "thorough" && typeof trained.steps !== "function" ? "trained" : who;
  };
  const leadOf = (battle, side) => {
    const who = commanderFor(battle, side);
    return who === "plainer" ? plainerPolicy() : who === "thorough" ? thoroughPolicy() : trained;
  };
  const policy = (battle, side, context, run) => leadOf(battle, side)(battle, side, context, run);
  // (A look in steps, as the engine takes it where a run is played out in slices: planner.js.)
  policy.steps = function* steps(battle, side, context, run) {
    const lead = leadOf(battle, side);
    return typeof lead.steps === "function" ? yield* lead.steps(battle, side, context, run) : lead(battle, side, context, run);
  };
  policy.often = trained.often === true;
  policy.commanderFor = commanderFor;
  return policy;
};

// What is shipped, for whoever looks: { run, round, score, overStaff, overAdvance, troops } or null.
export const trainedStaffInfo = () => (TRAINED_STAFF
  ? { run: TRAINED_STAFF.run, round: TRAINED_STAFF.round, score: TRAINED_STAFF.score, overStaff: TRAINED_STAFF.overStaff, overAdvance: TRAINED_STAFF.overAdvance, troops: TRAINED_STAFF.shape?.head > 0 }
  : { planner: true, run: SHIPPED_PLANNER?.run ?? "plain", champion: SHIPPED_PLANNER?.champion ?? 0 });
