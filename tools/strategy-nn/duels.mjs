/*! Open Historia — the strategy experiment: a staff in fair duels © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How a staff does in fair duels (duel.mjs) against the plain habits, the
// engine's own scripted staff and anything else named: each duel fought both
// ways round, so neither side's beginning the war counts for either.
//
//   node tools/strategy-nn/duels.mjs [--staff planner|<weights.json>] [--duels 40] [--from 1] [--workers N]
//                                    [--against advance,dig,hold,cities,staff] [--ahead 6] [--look 5] [--out file.json]
//
// A staff named by a file is the planner with that file's `params` (tools/strategy-nn/tune.mjs writes them).

import fs from "node:fs";
import os from "node:os";

import { createPool, playMatch } from "./pool.mjs";
import { duelSeeds } from "./duel.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const staffName = option("staff", "planner");
const count = Number(option("duels", "40"));
const from = Number(option("from", "1"));
const workers = Number(option("workers", String(Math.max(1, os.cpus().length - 2))));
const against = option("against", "advance,dig,cities,staff").split(",").map((word) => word.trim()).filter(Boolean);
const ahead = Number(option("ahead", "0")) || undefined;
const look = Number(option("look", "0")) || undefined;
const out = option("out", "");

const staffOf = (word) => {
  if (word === "staff") return { staff: true };
  // The plainer commander (planner.js PLAINER_PLANNER), for a side a war is meant to lose.
  if (word === "plainer") return { plainer: true };
  if (word === "planner") return { planner: true, ahead, look };
  if (word.endsWith(".json")) return { planner: true, ahead, look, params: JSON.parse(fs.readFileSync(word, "utf8")).params };
  return { habit: word };
};
const OPPONENTS = { advance: "always advancing", dig: "always digging in", hold: "always holding", cities: "every troop for a town", staff: "the scripted staff" };

const seeds = duelSeeds(from, count);
const pool = createPool(workers);
const started = Date.now();
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const report = { staff: staffName, duels: count, from, against: {} };
for (const word of against) {
  const result = await playMatch(pool, staffOf(staffName), word === "staff" ? null : staffOf(word), seeds, { detail: true, chunk: 1, duels: true });
  const margins = (result.games ?? []).map((game) => game.margin);
  const m = mean(margins);
  const sd = Math.sqrt(mean(margins.map((value) => (value - m) * (value - m))));
  const won = margins.filter((value) => value > 1e-9).length;
  const lost = margins.filter((value) => value < -1e-9).length;
  report.against[word] = { mean: m, se: sd / Math.sqrt(Math.max(1, margins.length)), won, lost, played: margins.length, chosen: result.chosen, margins };
  console.log(`${staffName} vs ${OPPONENTS[word] ?? word}: ${m >= 0 ? "+" : ""}${m.toFixed(1)} a duel (SE ${(sd / Math.sqrt(Math.max(1, margins.length))).toFixed(1)}), won ${won} / lost ${lost} of ${margins.length}  [${((Date.now() - started) / 1000).toFixed(0)} s]`);
  if (Object.keys(result.chosen ?? {}).length > 0) console.log(`  plans chosen: ${Object.entries(result.chosen).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(", ")}`);
}
await pool.close();
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
