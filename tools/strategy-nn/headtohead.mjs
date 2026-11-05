/*! Open Historia — the strategy experiment: a ladder's challenger against its champion, at length © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A trial of the ladder (ladder.mjs) is 16 duels: too few to tell a challenger
// a little better than its champion from one as good. This fights the two on
// as many fair duels as asked, neither trained on, both ways round.
//
//   node tools/strategy-nn/headtohead.mjs <run dir> [--duels 40] [--from 910000] [--workers N] [--challenger file]
//     --challenger  a file of weights ({ params }, as values.mjs writes) to fight the champion instead of the run's

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPool, playMatch } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const state = JSON.parse(fs.readFileSync(path.join(args[0], "latest.json"), "utf8"));
const count = Number(option("duels", "40"));
const from = Number(option("from", "910000"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));
const challengerFile = option("challenger", "");
const challenger = challengerFile ? JSON.parse(fs.readFileSync(challengerFile, "utf8")).params : state.challenger;

const pool = createPool(workers);
const started = Date.now();
const result = await playMatch(pool, { planner: true, params: challenger }, { planner: true, params: state.champion.params }, duelSeeds(from, count), { detail: true, chunk: 1, duels: true });
await pool.close();
const margins = (result.games ?? []).map((game) => game.margin);
const mean = margins.reduce((sum, value) => sum + value, 0) / Math.max(1, margins.length);
const sd = Math.sqrt(margins.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, margins.length));
const won = margins.filter((value) => value > 1e-9).length;
const lost = margins.filter((value) => value < -1e-9).length;
console.log(JSON.stringify({ gen: state.gen, champion: state.champion.n, duels: margins.length, won, lost, mean: Math.round(mean * 10) / 10, se: Math.round((sd / Math.sqrt(Math.max(1, margins.length))) * 10) / 10, seconds: Math.round((Date.now() - started) / 1000) }));
