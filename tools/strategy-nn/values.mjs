/*! Open Historia — the strategy experiment: the planner's weighing, learnt from how wars end © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The staff that looks ahead (planner.js) weighs where a battle will stand a few
// days on by a sum of what it sees (EVAL_NAMES, LATE_EVAL_NAMES), each by a
// weight. The ladder (ladder.mjs) looks for better weights by trying some; this
// learns them instead from what the weighing is for: telling a battle that will
// be won from one that will be lost. A planner fights fair duels against the
// champion and the habits; at each of its looks what it saw is kept with how
// that war came out for its side (its reward less the other's), and the weights
// that best tell the one from the other (least squares, a little ridge) are its
// new weighing, the champion's net kept as it was. The weighing is only ever
// compared with itself, so what scale it comes out at does not matter.
//
//   node tools/strategy-nn/values.mjs <run dir> [--duels 24] [--from 950000] [--workers N] [--ridge 0.01] [--out file]
//     [--data file]   learn from data gathered before (a .jsonl of { x, y }) and gather none

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EVAL_NAMES, LATE_AT, LATE_EVAL_NAMES, withLateEval } from "../../src/runtime/fronts/mind/planner.js";
import { createPool } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const runDir = args[0];
const state = JSON.parse(fs.readFileSync(path.join(runDir, "latest.json"), "utf8"));
const count = Number(option("duels", "24"));
const from = Number(option("from", "950000"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));
const ridge = Number(option("ridge", "0.01"));
const dataFile = option("data", "");
const out = option("out", path.join(runDir, "values.json"));
const NAMES = [...EVAL_NAMES, ...LATE_EVAL_NAMES];
const champion = withLateEval(state.champion.params);
const OPPONENTS = [{ planner: true, params: Array.from(champion) }, { habit: "advance" }, { habit: "dig" }, { staff: true }];

let records = [];
if (dataFile) {
  records = fs.readFileSync(dataFile, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
} else {
  const pool = createPool(workers);
  const started = Date.now();
  const tasks = [];
  for (const seed of duelSeeds(from, count)) {
    for (const opponent of OPPONENTS) tasks.push(pool.run({ kind: "values", a: { planner: true, params: Array.from(champion) }, b: opponent, seeds: [seed] }));
  }
  records = (await Promise.all(tasks)).flat();
  await pool.close();
  fs.writeFileSync(path.join(runDir, "values-data.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  console.log(`${records.length} looks from ${count} duels against ${OPPONENTS.length} opponents (${Math.round((Date.now() - started) / 1000)} s)`);
}

// Least squares of y on x, each x scaled to unit spread first and the ridge added to the diagonal.
const width = NAMES.length;
const n = records.length;
const mean = new Float64Array(width);
const spread = new Float64Array(width);
for (const { x } of records) for (let at = 0; at < width; at += 1) mean[at] += x[at] / n;
for (const { x } of records) for (let at = 0; at < width; at += 1) spread[at] += (x[at] - mean[at]) ** 2 / n;
for (let at = 0; at < width; at += 1) spread[at] = Math.sqrt(spread[at]) || 1;
const xtx = Array.from({ length: width }, () => new Float64Array(width));
const xty = new Float64Array(width);
let yy = 0;
for (const { x, y } of records) {
  const z = x.map((value, at) => value / spread[at]);
  for (let i = 0; i < width; i += 1) {
    xty[i] += z[i] * y;
    for (let j = 0; j < width; j += 1) xtx[i][j] += z[i] * z[j];
  }
  yy += y * y;
}
for (let i = 0; i < width; i += 1) xtx[i][i] += ridge * n;
// Gaussian elimination with partial pivoting.
const solve = (a, b) => {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < width; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < width; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = col + 1; row < width; row += 1) {
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= width; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  const w = new Float64Array(width);
  for (let row = width - 1; row >= 0; row -= 1) {
    let sum = m[row][width];
    for (let k = row + 1; k < width; k += 1) sum -= m[row][k] * w[k];
    w[row] = sum / m[row][row];
  }
  return w;
};
const scaled = solve(xtx, xty);
const weights = Array.from(scaled, (value, at) => value / spread[at]);
let residual = 0;
for (const { x, y } of records) {
  const guess = x.reduce((sum, value, at) => sum + value * weights[at], 0);
  residual += (y - guess) ** 2;
}
const explained = 1 - residual / Math.max(1e-9, yy);
// Put at the champion's scale (its weight of strength), for reading beside it.
const strengthAt = EVAL_NAMES.indexOf("strength");
const scale = Math.abs(weights[strengthAt]) > 1e-9 ? Math.abs(champion[strengthAt] / weights[strengthAt]) : 1;
const learnt = weights.map((value) => Math.round(value * scale * 1e4) / 1e4);
const params = Array.from(champion);
EVAL_NAMES.forEach((_, at) => { params[at] = learnt[at]; });
LATE_EVAL_NAMES.forEach((_, at) => { params[LATE_AT + at] = learnt[EVAL_NAMES.length + at]; });
const report = {
  looks: n,
  explained: Math.round(explained * 1000) / 1000,
  ridge,
  weights: Object.fromEntries(NAMES.map((name, at) => [name, learnt[at]])),
  champion: Object.fromEntries(NAMES.map((name, at) => [name, at < EVAL_NAMES.length ? champion[at] : champion[LATE_AT + at - EVAL_NAMES.length]])),
};
fs.writeFileSync(out, JSON.stringify({ ...report, params }, null, 1) + "\n");
console.log(JSON.stringify(report));
