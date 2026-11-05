/*! Open Historia — the strategy experiment: two settings of the staff that looks ahead, head to head © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The same weights (a champion's file) with the planner's newest search and with
// its first (FIRST_PLAN_NAMES, no refinement), in fair duels neither trained on,
// both ways round; and the newest against habits.
//
//   node tools/strategy-nn/compare.mjs <champion.json> [--duels 24] [--from 900200] [--workers N] [--against advance,staff]

import fs from "node:fs";
import os from "node:os";

import { FIRST_PLAN_NAMES } from "../../src/runtime/fronts/mind/planner.js";
import { createPool, playMatch } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const file = args[0];
const params = JSON.parse(fs.readFileSync(file, "utf8")).params;
const count = Number(option("duels", "24"));
const from = Number(option("from", "900200"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));
const against = option("against", "advance,staff").split(",").filter(Boolean);
const newest = { planner: true, params };
const first = { planner: true, params, plans: FIRST_PLAN_NAMES, refine: 0 };

const seeds = duelSeeds(from, count);
const pool = createPool(workers);
const started = Date.now();
const report = (label, result) => {
  const margins = (result.games ?? []).map((game) => game.margin);
  const mean = margins.reduce((sum, value) => sum + value, 0) / Math.max(1, margins.length);
  const sd = Math.sqrt(margins.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, margins.length));
  console.log(`${label}: ${mean >= 0 ? "+" : ""}${mean.toFixed(1)} a duel (SE ${(sd / Math.sqrt(Math.max(1, margins.length))).toFixed(1)}), won ${margins.filter((value) => value > 1e-9).length} / lost ${margins.filter((value) => value < -1e-9).length} of ${margins.length} [${((Date.now() - started) / 1000).toFixed(0)} s]`);
  if (Object.keys(result.chosen ?? {}).length) console.log(`  plans chosen: ${Object.entries(result.chosen).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(", ")}`);
};
report("newest search vs first search", await playMatch(pool, newest, first, seeds, { detail: true, chunk: 1, duels: true }));
for (const word of against) report(`newest search vs ${word}`, await playMatch(pool, newest, word === "staff" ? null : { habit: word }, seeds, { detail: true, chunk: 1, duels: true }));
await pool.close();
