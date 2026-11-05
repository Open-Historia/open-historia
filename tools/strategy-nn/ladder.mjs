/*! Open Historia — the strategy experiment: a ladder of champions © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "Do a training run that trains models against
// it until they consistently beat it and every other stratagy to create even
// better models to build off of" (the owner, 2026-10-14).
//
// A LADDER. There is a champion: the staff that looks ahead
// (src/runtime/fronts/mind/planner.js) with the best weights so far. A
// challenger, its weights a copy of the champion's to begin with, is tuned by
// evolution strategies (as tune.mjs) in fair duels (duel.mjs) against the
// champion above all, and against every habit: always advancing, the scripted
// staff, always digging in, every troop for a town, every troop down one
// route to the capital. Every so many generations it is put to a TRIAL on
// duels it never trained on, fought both ways round: when it beat the champion
// in at least PROMOTE_CHAMPION of them, and every habit in at least
// PROMOTE_HABITS, it is the new champion, kept as champion-<n>.json, and the
// next challenger is tuned against it; one that beat the champion in fewer
// than REVERT_BELOW begins again from the champion's weights.
//
//   node tools/strategy-nn/ladder.mjs [--run name] [--hours 2] [--workers N] [--pairs 6] [--duels 6]
//                                     [--sigma 0.1] [--rate 0.03] [--every 6] [--trial 20] [--from file.json] [--net-scale 1]
//
// Writes tools/strategy-nn/runs/planner/<run>/latest.json after every generation (picked up from when there is
// one), champion-<n>.json at each promotion, and trials.jsonl with every trial.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_EVAL, EVAL_NAMES, LATE_AT, LATE_EVAL, PLAN_PARAMS, plainPlanner, withLateEval } from "../../src/runtime/fronts/mind/planner.js";
import { createPool, playMatch } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const runName = option("run", "ladder-1");
const hours = Number(option("hours", "2"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));
const pairs = Number(option("pairs", "6"));
const duels = Number(option("duels", "6"));
const sigma = Number(option("sigma", "0.1"));
const rate = Number(option("rate", "0.03"));
const every = Number(option("every", "6"));
const trialDuels = Number(option("trial", "20"));
const fromFile = option("from", "");
// How far the net's weights are nudged beside the weighing's (1: alike). Most of what the staff does is which plan
// it weighs best, so a smaller nudge to the net's 451 puts what the duels say on the weighing's 8.
const netScale = Number(option("net-scale", "1"));
const dir = path.join(here, "runs", "planner", runName);
fs.mkdirSync(dir, { recursive: true });
const latestFile = path.join(dir, "latest.json");

// A challenger becomes champion when it beat the champion in this share of the trial's duels, and every habit in
// this share.
export const PROMOTE_CHAMPION = 0.65;
export const PROMOTE_HABITS = 0.85;
// A challenger that beat the champion in fewer than this share of the trial's duels has wandered off: it begins
// again from the champion's weights (what a few duels a generation say is noisy, and noise is followed too).
export const REVERT_BELOW = 0.5;
const HABITS = ["advance", "staff", "dig", "cities", "thrust"];
// Whom a generation's duels are fought against, in turn: the champion every other duel.
const ROTA = ["champion", "advance", "champion", "staff", "champion", "dig", "champion", "cities", "champion", "thrust"];
// The trial's duels: never trained on (training seeds count up from 100,000).
const TRIAL_FROM = 900000;

// How far each weight is nudged: the weighing by its own size, the net's by one.
const SCALE = Float64Array.from({ length: PLAN_PARAMS }, (_, at) => (at < EVAL_NAMES.length ? Math.max(0.1, Math.abs(DEFAULT_EVAL[at]))
  : at >= LATE_AT ? Math.max(1, Math.abs(LATE_EVAL[at - LATE_AT])) : netScale));

const kept = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, "utf8")) : null;
// (Weights made before the later weighing are read with it at its defaults, and Adam's moments of them with none.)
const started = fromFile ? withLateEval(JSON.parse(fs.readFileSync(fromFile, "utf8")).params) : plainPlanner();
let champion = kept ? { params: withLateEval(kept.champion.params), n: kept.champion.n } : { params: Float64Array.from(started), n: 0 };
const params = kept ? withLateEval(kept.challenger) : Float64Array.from(champion.params);
const momentOf = (values) => {
  const out = new Float64Array(PLAN_PARAMS);
  Array.from(values ?? []).slice(0, PLAN_PARAMS).forEach((value, at) => { out[at] = Number(value) || 0; });
  return out;
};
const adam = kept?.adam ? { m: momentOf(kept.adam.m), v: momentOf(kept.adam.v), t: kept.adam.t } : { m: new Float64Array(PLAN_PARAMS), v: new Float64Array(PLAN_PARAMS), t: 0 };
const history = kept?.history ?? [];
let gen = kept?.gen ?? 0;

const normals = (seed) => {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
};
const rounded = (values) => Array.from(values, (value) => Math.round(value * 1e6) / 1e6);
const staffOf = (values) => ({ planner: true, params: rounded(values) });
const opponentOf = (word) => (word === "staff" ? null : word === "champion" ? staffOf(champion.params) : { habit: word });
const sum = (list) => list.reduce((total, value) => total + value, 0);

// A trial: the challenger against the champion and every habit, on the trial's duels, both ways round.
const trial = async (pool) => {
  const seeds = duelSeeds(TRIAL_FROM, trialDuels);
  const out = {};
  for (const word of ["champion", ...HABITS]) {
    const result = await playMatch(pool, staffOf(params), opponentOf(word), seeds, { detail: true, chunk: 1, duels: true });
    const margins = (result.games ?? []).map((game) => game.margin);
    const mean = sum(margins) / Math.max(1, margins.length);
    const sd = Math.sqrt(sum(margins.map((value) => (value - mean) * (value - mean))) / Math.max(1, margins.length));
    out[word] = { won: margins.filter((value) => value > 1e-9).length, of: margins.length, mean: Math.round(mean * 10) / 10, se: Math.round((sd / Math.sqrt(Math.max(1, margins.length))) * 10) / 10 };
  }
  const promoted = out.champion.won >= PROMOTE_CHAMPION * trialDuels && HABITS.every((word) => out[word].won >= PROMOTE_HABITS * trialDuels);
  return { results: out, promoted };
};

const save = () => {
  const state = { gen, run: runName, champion: { n: champion.n, params: rounded(champion.params) }, challenger: rounded(params), adam: { m: Array.from(adam.m), v: Array.from(adam.v), t: adam.t }, settings: { pairs, duels, sigma, rate, every, trialDuels, netScale }, history };
  fs.writeFileSync(`${latestFile}.tmp`, JSON.stringify(state));
  fs.renameSync(`${latestFile}.tmp`, latestFile);
};

const pool = createPool(workers);
const until = Date.now() + hours * 3600 * 1000;
console.log(`ladder ${runName}: champion ${champion.n}, ${PLAN_PARAMS} weights, ${pairs} pairs x ${duels} duels a generation, a trial of ${trialDuels} duels every ${every}, ${workers} workers, from generation ${gen}, for ${hours} h`);
while (Date.now() < until) {
  const begun = Date.now();
  const draw = normals(1000003 * (gen + 1) + 77);
  const nudges = Array.from({ length: pairs }, () => Float64Array.from({ length: PLAN_PARAMS }, () => draw()));
  const seeds = duelSeeds(100000 + gen * duels, duels);
  const against = seeds.map((seed, at) => ROTA[(gen * duels + at) % ROTA.length]);
  const tryOne = (values) => Promise.all(seeds.map((seed, at) => playMatch(pool, staffOf(values), opponentOf(against[at]), [seed], { duels: true, chunk: 1 }).then((result) => result.margin)));
  const ups = new Array(pairs);
  const downs = new Array(pairs);
  await Promise.all(nudges.flatMap((nudge, pair) => [
    tryOne(Float64Array.from(params, (value, at) => value + sigma * SCALE[at] * nudge[at])).then((margins) => { ups[pair] = margins; }),
    tryOne(Float64Array.from(params, (value, at) => value - sigma * SCALE[at] * nudge[at])).then((margins) => { downs[pair] = margins; }),
  ]));
  // Each duel's differences scaled by how much its margins vary, so that no one large war decides the step.
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
  adam.t += 1;
  for (let at = 0; at < PLAN_PARAMS; at += 1) {
    adam.m[at] = 0.9 * adam.m[at] + 0.1 * gradient[at];
    adam.v[at] = 0.999 * adam.v[at] + 0.001 * gradient[at] * gradient[at];
    const m = adam.m[at] / (1 - 0.9 ** adam.t);
    const v = adam.v[at] / (1 - 0.999 ** adam.t);
    params[at] += (rate * SCALE[at] * m) / (Math.sqrt(v) + 1e-8);
  }
  const byOpponent = {};
  seeds.forEach((seed, at) => {
    const all = [...ups.map((list) => list[at]), ...downs.map((list) => list[at])];
    (byOpponent[against[at]] ??= []).push(sum(all) / all.length);
  });
  gen += 1;
  const entry = {
    gen,
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - begun) / 1000),
    champion: champion.n,
    mean: Math.round((sum([...ups.flat(), ...downs.flat()]) / (2 * pairs * duels)) * 10) / 10,
    byOpponent: Object.fromEntries(Object.entries(byOpponent).map(([word, list]) => [word, Math.round((sum(list) / list.length) * 10) / 10])),
    eval: EVAL_NAMES.map((name, at) => Math.round(params[at] * 1000) / 1000),
  };
  history.push(entry);
  console.log(`gen ${gen} (champion ${champion.n}): mean margin ${entry.mean} ${JSON.stringify(entry.byOpponent)} (${entry.seconds} s)`);
  if (gen % every === 0) {
    const t0 = Date.now();
    const { results, promoted } = await trial(pool);
    const line = { gen, at: new Date().toISOString(), champion: champion.n, seconds: Math.round((Date.now() - t0) / 1000), results, promoted };
    fs.appendFileSync(path.join(dir, "trials.jsonl"), `${JSON.stringify(line)}\n`);
    console.log(`TRIAL at gen ${gen} against champion ${champion.n}: ${Object.entries(results).map(([word, r]) => `${word} ${r.won}/${r.of} (${r.mean >= 0 ? "+" : ""}${r.mean})`).join(", ")}${promoted ? " -> PROMOTED" : ""} (${line.seconds} s)`);
    if (promoted) {
      champion = { params: Float64Array.from(params), n: champion.n + 1 };
      fs.writeFileSync(path.join(dir, `champion-${champion.n}.json`), JSON.stringify({ n: champion.n, gen, run: runName, params: rounded(champion.params), trial: results }));
      // (A fresh start for the step sizes: the landscape against a new champion is a new one.)
      adam.m.fill(0);
      adam.v.fill(0);
      adam.t = 0;
    } else if (results.champion.won < REVERT_BELOW * trialDuels) {
      params.set(champion.params);
      adam.m.fill(0);
      adam.v.fill(0);
      adam.t = 0;
      console.log(`  (worse than champion ${champion.n}: the challenger begins again from its weights)`);
    }
  }
  save();
}
await pool.close();
