/*! Open Historia — the strategy experiment: two settings of the staff that looks ahead, head to head © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The same weights (a champion's file) under two settings of the planner (how
// far ahead it looks, how often, how many bodies it refines), in fair duels
// neither trained on, both ways round.
//
//   node tools/strategy-nn/versus.mjs <champion.json> --a ahead=10 --b ahead=6 [--duels 24] [--from 900400] [--workers N]

import fs from "node:fs";
import os from "node:os";

import { createPool, playMatch } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const params = JSON.parse(fs.readFileSync(args[0], "utf8")).params;
const settingOf = (text) => Object.fromEntries(String(text ?? "").split(",").filter(Boolean).map((pair) => {
  const [key, value] = pair.split("=");
  return [key.trim(), Number(value)];
}));
const a = { planner: true, params, ...settingOf(option("a", "")) };
const b = { planner: true, params, ...settingOf(option("b", "")) };
const count = Number(option("duels", "24"));
const from = Number(option("from", "900400"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));

const pool = createPool(workers);
const started = Date.now();
const result = await playMatch(pool, a, b, duelSeeds(from, count), { detail: true, chunk: 1, duels: true });
await pool.close();
const margins = (result.games ?? []).map((game) => game.margin);
const mean = margins.reduce((sum, value) => sum + value, 0) / Math.max(1, margins.length);
const sd = Math.sqrt(margins.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, margins.length));
console.log(`${option("a", "")} vs ${option("b", "")}: ${mean >= 0 ? "+" : ""}${mean.toFixed(1)} a duel (SE ${(sd / Math.sqrt(Math.max(1, margins.length))).toFixed(1)}), won ${margins.filter((value) => value > 1e-9).length} / lost ${margins.filter((value) => value < -1e-9).length} of ${margins.length} [${((Date.now() - started) / 1000).toFixed(0)} s]`);
