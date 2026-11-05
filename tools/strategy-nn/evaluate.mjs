/*! Open Historia — the strategy network experiment: how a champion does © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. Fights a trained network against every other
// kind of staff on wars the league never saw, each leading each team of each
// war once (arena.mjs match), and says how it did: against the engine's
// scripted staff, against the plain habits, against the habit of going for
// the cities troop by troop, against the earlier trained staff that orders the
// side as a whole (runs/league), and, of the same wars, how the scripted staff
// does against the best habit.
//
//   node tools/strategy-nn/evaluate.mjs --name troops --wars 150 --workers 12
//
// It prints a table and keeps it in tools/strategy-nn/runs/<name>/evaluation.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readWeights } from "../../src/runtime/fronts/mind/net.js";
import { TROOP_ACTIONS } from "../../src/runtime/fronts/mind/troops.js";
import { REWARD, REWARD_PARTS } from "./arena.mjs";
import { createPool, playMatch } from "./pool.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").map((part) => part.trim()).filter(Boolean).map((part) => {
  const [key, ...rest] = part.split(/\s+/);
  return [key, rest.join(" ") || "1"];
}));
const name = args.name ?? "troops";
const wars = Number(args.wars ?? 150);
const workers = Number(args.workers ?? 12);
const file = args.file ?? "best.json";
const folder = path.join(here, "runs", name);
const packed = JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"));
const weights = readWeights(packed);
if (!weights) throw new Error(`runs/${name}/${file} holds no weights this build can read`);

// Wars nobody trained on and no champion was picked on.
const SEEDS = Array.from({ length: wars }, (_, index) => 5000000 + index);
const pool = createPool(workers);
const troops = weights.shape.head > 0;
const network = troops ? { params: Array.from(weights.params), troops: true } : { params: Array.from(weights.params), prior: weights.prior };
// The earlier trained staff, that orders the side as a whole, where it is kept.
const sideFile = path.join(here, "runs", "league", "best.json");
const sideWeights = troops && fs.existsSync(sideFile) ? readWeights(JSON.parse(fs.readFileSync(sideFile, "utf8"))) : null;
const others = [
  ["the scripted staff", { staff: true }],
  ["always advancing", { habit: "advance" }],
  ["always holding", { habit: "hold" }],
  ["always digging in", { habit: "dig" }],
  ["going for the cities, troop by troop", { habit: "cities" }],
  ...(sideWeights ? [["the trained staff of the whole side", { params: Array.from(sideWeights.params), prior: sideWeights.prior }]] : []),
];
const played = await Promise.all(others.map(([, staff]) => playMatch(pool, network, staff, SEEDS, { detail: true })));
// And the mark the network is held to: what the best plain habit makes of the scripted staff on the same wars.
const habit = await playMatch(pool, { habit: "advance" }, { staff: true }, SEEDS, { detail: true });
await pool.close();

const mean = (values) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
// A match's wars summed up: the margin a war (over its two fights), with its standard error, and who did better in how many.
const sum = (games) => {
  const margins = games.map((game) => game.margin);
  const centre = mean(margins);
  const error = Math.sqrt(mean(margins.map((margin) => (margin - centre) ** 2)) / Math.max(1, margins.length - 1));
  return {
    wars: games.length,
    margin: round(centre),
    error: round(error),
    better: margins.filter((margin) => margin > 1e-9).length,
    level: margins.filter((margin) => Math.abs(margin) <= 1e-9).length,
    worse: margins.filter((margin) => margin < -1e-9).length,
    parts: Object.fromEntries(REWARD_PARTS.map((key) => [key, round(mean(games.map((game) => game.parts[key])))])),
  };
};
const cut = (games, label, test) => ({ label, ...sum(games.filter(test)) });
const versusStaff = played[0].games;
const said = new Array(TROOP_ACTIONS.length).fill(0);
for (const game of versusStaff) game.said.forEach((count, at) => { said[at] += count; });
const total = said.reduce((all, count) => all + count, 0);

const report = {
  name,
  file,
  trained: { round: packed.round, id: packed.id, score: packed.score },
  reward: REWARD,
  wars,
  against: Object.fromEntries(others.map(([label], at) => [label, sum(played[at].games)])),
  alwaysAdvancingAgainstTheScriptedStaff: sum(habit.games),
  againstTheScriptedStaffBy: [
    cut(versusStaff, "one against one", (game) => game.kind.startsWith("one against one")),
    cut(versusStaff, "two against one, or one against two", (game) => game.kind === "two against one" || game.kind === "one against two"),
    cut(versusStaff, "two against two", (game) => game.kind === "two against two"),
    cut(versusStaff, "the team that began is much the weaker (under 0.7)", (game) => game.odds < 0.7),
    cut(versusStaff, "about even (0.7 to 1.4)", (game) => game.odds >= 0.7 && game.odds <= 1.4),
    cut(versusStaff, "the team that began is much the stronger (over 1.4)", (game) => game.odds > 1.4),
    cut(versusStaff, "contested (two to one or closer)", (game) => game.odds >= 0.5 && game.odds <= 2),
    cut(versusStaff, "before 1900", (game) => game.year < 1900),
    cut(versusStaff, "from 1900", (game) => game.year >= 1900),
  ],
  whatItSaid: Object.fromEntries(TROOP_ACTIONS.map((word, at) => [word, total > 0 ? round(said[at] / total) : 0])),
  // Against always advancing, by the kind of war, too: the mark to beat.
  againstAlwaysAdvancingBy: [
    cut(played[1].games, "contested (two to one or closer)", (game) => game.odds >= 0.5 && game.odds <= 2),
    cut(played[1].games, "lopsided", (game) => game.odds < 0.5 || game.odds > 2),
  ],
};
fs.writeFileSync(path.join(folder, "evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);

const row = (cells) => `| ${cells.join(" | ")} |`;
const signed = (value) => `${value >= 0 ? "+" : ""}${value}`;
console.log(`\n${wars} wars the league never saw, each fought twice with the teams exchanged (runs/${name}/${file}, round ${packed.round})\n`);
console.log(row(["the network against", "margin a war", "standard error", "better / level / worse"]));
console.log(row(["---", "---", "---", "---"]));
for (const [label, entry] of Object.entries(report.against)) console.log(row([label, signed(entry.margin), entry.error, `${entry.better} / ${entry.level} / ${entry.worse}`]));
const mark = report.alwaysAdvancingAgainstTheScriptedStaff;
console.log(row(["(always advancing against the scripted staff)", signed(mark.margin), mark.error, `${mark.better} / ${mark.level} / ${mark.worse}`]));
console.log("\nwhat the network's team came to against the scripted staff, a war (land in thousands of km², towns and capitals counted, troops and encircling as shares):");
console.log(row(REWARD_PARTS));
console.log(row(REWARD_PARTS.map(() => "---")));
console.log(row(REWARD_PARTS.map((key) => report.against["the scripted staff"].parts[key])));
console.log("\nagainst the scripted staff, by the kind of war:");
console.log(row(["where", "wars", "margin a war", "better / level / worse"]));
console.log(row(["---", "---", "---", "---"]));
for (const entry of report.againstTheScriptedStaffBy) console.log(row([entry.label, entry.wars, signed(entry.margin), `${entry.better} / ${entry.level} / ${entry.worse}`]));
console.log("\nagainst always advancing, by the kind of war:");
console.log(row(["where", "wars", "margin a war", "better / level / worse"]));
console.log(row(["---", "---", "---", "---"]));
for (const entry of report.againstAlwaysAdvancingBy) console.log(row([entry.label, entry.wars, signed(entry.margin), `${entry.better} / ${entry.level} / ${entry.worse}`]));
console.log(`\nwhat the network told its ${troops ? "troops" : "sides"} to do: ${Object.entries(report.whatItSaid).map(([word, part]) => `${word} ${Math.round(part * 100)}%`).join(", ")}`);
