/*! Open Historia — the strategy network experiment: a worker that fights wars © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One of the pool league.mjs and evaluate.mjs hand matches to. A task names two
// staffs and the seeds of the scenarios they are to fight each other in; in
// each scenario each staff leads each team once (arena.mjs match). The answer
// is how much better the first did than the second.
//
// A staff is said as { params, prior } (a network that orders the side as a
// whole), { params, troops: true } (one that orders every troop by itself),
// { habit } (a plain habit: "advance", "hold", "dig") or { staff: true } (the
// engine's own scripted staff).

import { parentPort } from "node:worker_threads";

import { createPlainerPlanner, createPlanner, valueFeatures, withLateEval } from "../../src/runtime/fronts/mind/planner.js";
import { MIND_SHAPE, TROOP_SHAPE, createStaffPolicy, createTroopPolicy } from "../../src/runtime/fronts/mind/policy.js";
import { HABITS, REWARD_PARTS, fight, makeScenario, match } from "./arena.mjs";
import { makeDuel } from "./duel.mjs";

// What each plan of a staff that looks ahead was chosen, over a task's wars (with `detail`).
let chosen = {};
const staffOf = (said) => {
  // The plainer commander, for a side a war is meant to lose (planner.js PLAINER_PLANNER).
  if (said?.plainer) return createPlainerPlanner({ tally: (name) => { chosen[name] = (chosen[name] ?? 0) + 1; } });
  if (said?.planner) {
    return createPlanner({
      ...(said.params ? { params: withLateEval(said.params) } : {}),
      ...(said.look ? { look: said.look } : {}),
      ...(said.ahead ? { ahead: said.ahead } : {}),
      ...(said.plans ? { plans: said.plans } : {}),
      ...(Number.isFinite(said.refine) ? { refine: said.refine } : {}),
      ...(said.replies ? { replies: true } : {}),
      ...(said.airControl === 0 ? { airControl: false } : {}),
      ...(Number.isFinite(said.late) ? { late: [said.late] } : {}),
      tally: (name) => { chosen[name] = (chosen[name] ?? 0) + 1; },
    });
  }
  if (said?.params && said.troops) return createTroopPolicy({ shape: TROOP_SHAPE, params: Float64Array.from(said.params) });
  if (said?.params) return createStaffPolicy({ shape: MIND_SHAPE, params: Float64Array.from(said.params), prior: Number(said.prior) || 0 });
  if (said?.habit) return HABITS[said.habit] ?? null;
  return null;
};

// What a planner saw at each of its looks in a war, with how the war came out for its side: [{ x, y }], x the
// weighing's features (planner.js valueFeatures), y its team's reward less the other's (values.mjs).
const gather = ({ id, a, b, seeds }) => {
  const records = [];
  for (const seed of seeds) {
    const scenario = makeDuel(seed);
    for (const [first, second] of [[a, b], [b, a]]) {
      const seen = [[], []];
      const staffs = [first, second].map((said, team) => {
        if (!said?.planner) return staffOf(said);
        return createPlanner({
          ...(said.params ? { params: withLateEval(said.params) } : {}),
          observe: (battle, side) => { seen[team].push(Array.from(valueFeatures(battle, side), (value) => Math.round(value * 1e4) / 1e4)); },
        });
      });
      const result = fight(scenario, staffs);
      for (const team of [0, 1]) {
        const y = result.rewards[team] - result.rewards[1 - team];
        for (const x of seen[team]) records.push({ x, y: Math.round(y * 100) / 100, seed });
      }
    }
  }
  parentPort.postMessage({ id, results: records });
};

parentPort.on("message", ({ id, kind = "", a, b, seeds = [], detail = false, duels = false }) => {
  if (kind === "values") {
    try {
      gather({ id, a, b, seeds });
    } catch (error) {
      parentPort.postMessage({ id, error: String(error?.stack ?? error) });
    }
    return;
  }
  try {
    chosen = {};
    const first = staffOf(a);
    const second = staffOf(b);
    let margin = 0;
    let won = 0;
    let drawn = 0;
    const games = [];
    for (const seed of seeds) {
      // (Fair duels, duel.mjs, or the arena's own wars.)
      const scenario = duels ? makeDuel(seed) : makeScenario(seed);
      const played = match(scenario, first, second);
      margin += played.margin;
      if (played.margin > 1e-9) won += 1;
      else if (played.margin >= -1e-9) drawn += 1;
      if (detail) {
        games.push({
          seed,
          kind: scenario.kind,
          countries: scenario.countries.length,
          year: scenario.year,
          // How strong the team that began the war is against the other, by what their countries are.
          odds: scenario.teams[0].reduce((sum, index) => sum + scenario.weights[index], 0) / scenario.teams[1].reduce((sum, index) => sum + scenario.weights[index], 0),
          margin: played.margin,
          first: played.first,
          second: played.second,
          parts: Object.fromEntries(REWARD_PARTS.map((key) => [key, played.parts[key] / 2])),
          said: played.said,
        });
      }
    }
    parentPort.postMessage({ id, results: [{ margin, won, drawn, played: seeds.length, chosen, ...(detail ? { games } : {}) }] });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.stack ?? error) });
  }
});
