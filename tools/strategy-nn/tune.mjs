/*! Open Historia — the strategy experiment: tuning the staff that looks ahead © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. Tunes mind/planner.js's weights (how it weighs a
// battle, and its own judgement troop by troop) by evolution strategies in
// fair duels (duel.mjs): each generation, pairs of weights a little either side
// of the present ones (the same nudge, once added and once taken off) fight the
// same duels against the same opponents, and the weights move toward the side
// of each pair that did better. The opponents go round: always advancing, the
// scripted staff, always digging in, every troop for a town, every troop down
// one route to the capital, and the present weights themselves.
//
//   node tools/strategy-nn/tune.mjs [--run name] [--hours 2] [--workers N] [--pairs 6] [--duels 4]
//                                   [--sigma 0.1] [--rate 0.03] [--ahead 6] [--look 5]
//
// Writes tools/strategy-nn/runs/planner/<run>/latest.json ({ gen, params, adam, history }) after every
// generation, and gen-<n>.json every fifth; picks up from latest.json when there is one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_EVAL, EVAL_NAMES, PLAN_PARAMS, plainPlanner } from "../../src/runtime/fronts/mind/planner.js";
import { createPool, playMatch } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const runName = option("run", "es-1");
const hours = Number(option("hours", "2"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));
const pairs = Number(option("pairs", "6"));
const duels = Number(option("duels", "4"));
const sigma = Number(option("sigma", "0.1"));
const rate = Number(option("rate", "0.03"));
const ahead = Number(option("ahead", "0")) || undefined;
const look = Number(option("look", "0")) || undefined;
const dir = path.join(here, "runs", "planner", runName);
fs.mkdirSync(dir, { recursive: true });
const latestFile = path.join(dir, "latest.json");

// How far each weight is nudged: the weighing by its own size, the net's by one.
const SCALE = Float64Array.from({ length: PLAN_PARAMS }, (_, at) => (at < EVAL_NAMES.length ? Math.max(0.1, Math.abs(DEFAULT_EVAL[at])) : 1));
const OPPONENTS = ["advance", "staff", "dig", "cities", "thrust", "self"];

let state = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, "utf8")) : null;
const params = state ? Float64Array.from(state.params) : plainPlanner();
const adam = state?.adam ? { m: Float64Array.from(state.adam.m), v: Float64Array.from(state.adam.v), t: state.adam.t } : { m: new Float64Array(PLAN_PARAMS), v: new Float64Array(PLAN_PARAMS), t: 0 };
const history = state?.history ?? [];
let gen = state?.gen ?? 0;

// A seeded stream of normal numbers (Box-Muller): the nudges of a generation are its own.
const normals = (seed) => {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
};
const said = (values) => ({ planner: true, params: Array.from(values, (value) => Math.round(value * 1e6) / 1e6), ahead, look });

const pool = createPool(workers);
const until = Date.now() + hours * 3600 * 1000;
console.log(`tuning ${runName}: ${PLAN_PARAMS} weights, ${pairs} pairs x ${duels} duels a generation, ${workers} workers, from generation ${gen}, for ${hours} h`);
while (Date.now() < until) {
  const started = Date.now();
  const draw = normals(1000003 * (gen + 1));
  const nudges = Array.from({ length: pairs }, () => Float64Array.from({ length: PLAN_PARAMS }, () => draw()));
  // The duels of this generation, and whom each is fought against.
  const seeds = duelSeeds(100000 + gen * duels, duels);
  const against = seeds.map((seed, at) => OPPONENTS[(gen + at) % OPPONENTS.length]);
  const opponentOf = (word) => (word === "staff" ? null : word === "self" ? said(params) : { habit: word });
  // Each nudged set of weights: [+ or -][pair] -> margin over the generation's duels.
  const tryOne = async (values) => {
    const results = await Promise.all(seeds.map((seed, at) => playMatch(pool, said(values), opponentOf(against[at]), [seed], { duels: true, chunk: 1 })));
    return results.map((result) => result.margin);
  };
  const plus = [];
  const minus = [];
  const tasks = [];
  for (const nudge of nudges) {
    const up = Float64Array.from(params, (value, at) => value + sigma * SCALE[at] * nudge[at]);
    const down = Float64Array.from(params, (value, at) => value - sigma * SCALE[at] * nudge[at]);
    tasks.push(tryOne(up).then((margins) => plus.push({ nudge, margins })), tryOne(down).then((margins) => minus.push({ nudge, margins })));
  }
  await Promise.all(tasks);
  // (Pushed in whatever order they finished: set back in the order of the nudges.)
  const order = (list) => nudges.map((nudge) => list.find((entry) => entry.nudge === nudge).margins);
  const ups = order(plus);
  const downs = order(minus);
  const sum = (list) => list.reduce((total, value) => total + value, 0);
  // Each pair's difference, by duel scaled by how much the duel's margins vary (one large war must not decide it all).
  const spread = seeds.map((seed, at) => {
    const values = [...ups.map((list) => list[at]), ...downs.map((list) => list[at])];
    const mean = sum(values) / values.length;
    return Math.sqrt(sum(values.map((value) => (value - mean) * (value - mean))) / values.length) + 1;
  });
  const gradient = new Float64Array(PLAN_PARAMS);
  nudges.forEach((nudge, pair) => {
    const difference = sum(seeds.map((seed, at) => (ups[pair][at] - downs[pair][at]) / spread[at])) / seeds.length;
    for (let at = 0; at < PLAN_PARAMS; at += 1) gradient[at] += (difference * nudge[at]) / (2 * pairs);
  });
  // Adam, each weight moving by its own scale.
  adam.t += 1;
  for (let at = 0; at < PLAN_PARAMS; at += 1) {
    adam.m[at] = 0.9 * adam.m[at] + 0.1 * gradient[at];
    adam.v[at] = 0.999 * adam.v[at] + 0.001 * gradient[at] * gradient[at];
    const m = adam.m[at] / (1 - 0.9 ** adam.t);
    const v = adam.v[at] / (1 - 0.999 ** adam.t);
    params[at] += (rate * SCALE[at] * m) / (Math.sqrt(v) + 1e-8);
  }
  // What this generation came to, by opponent.
  const byOpponent = {};
  seeds.forEach((seed, at) => {
    const word = against[at];
    const all = [...ups.map((list) => list[at]), ...downs.map((list) => list[at])];
    byOpponent[word] ??= [];
    byOpponent[word].push(sum(all) / all.length);
  });
  const summary = Object.fromEntries(Object.entries(byOpponent).map(([word, list]) => [word, Math.round((sum(list) / list.length) * 10) / 10]));
  gen += 1;
  history.push({ gen, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), mean: Math.round((sum([...ups.flat(), ...downs.flat()]) / (2 * pairs * duels)) * 10) / 10, byOpponent: summary, eval: EVAL_NAMES.map((name, at) => Math.round(params[at] * 1000) / 1000) });
  const saved = { gen, run: runName, params: Array.from(params, (value) => Math.round(value * 1e6) / 1e6), adam: { m: Array.from(adam.m), v: Array.from(adam.v), t: adam.t }, settings: { pairs, duels, sigma, rate, ahead, look }, history };
  fs.writeFileSync(`${latestFile}.tmp`, JSON.stringify(saved));
  fs.renameSync(`${latestFile}.tmp`, latestFile);
  if (gen % 5 === 0) fs.writeFileSync(path.join(dir, `gen-${String(gen).padStart(3, "0")}.json`), JSON.stringify({ gen, run: runName, params: saved.params }));
  const last = history[history.length - 1];
  console.log(`gen ${gen}: mean margin ${last.mean} ${JSON.stringify(summary)} weighing ${JSON.stringify(last.eval)} (${last.seconds} s)`);
}
await pool.close();
