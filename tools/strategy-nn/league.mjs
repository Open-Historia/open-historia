/*! Open Historia — the strategy network experiment: the league © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "Train the AIs against each other and whichever
// wins advances", and "train the model to manage individual troops".
//
// A LEAGUE of networks (src/runtime/fronts/mind/), each a side's staff. By
// default each orders every troop of its side by itself (policy.js
// createTroopPolicy); --kind side trains the older kind that orders the side
// as a whole. Every round the networks are drawn into pairs and each pair
// fights a MATCH: the same few wars, drawn afresh for the round from every
// combination of countries the arena makes, with each network leading each
// team once (arena.mjs match). Whichever did better over the match ADVANCES.
// The one that lost is gone, and its place is taken by a child of a network
// that advanced: a copy with some of its weights nudged, now and then a
// mixture of two.
//
// The wars are CONTESTED ones (arena.mjs contestedSeeds): in a war much more
// lopsided than two to one, what is ordered hardly matters, and a match of
// such wars says nothing of who orders better.
//
// So that the league does not go round in circles beating only itself, a few
// networks each round are drawn against a GATEKEEPER in place of another
// network: the engine's scripted staff, the habit of always advancing, the
// habit of going for the cities troop by troop, the trained staff that orders
// the side as a whole (mind/weights.js, when it is one), and the league's own
// past champions. Such a network advances only if it beats the gatekeeper.
//
// Every few rounds the networks that have advanced most often in a row are
// tried against the scripted staff, always advancing and going for the cities
// on wars kept aside for it; the best becomes the CHAMPION
// (runs/<name>/best.json), and a new champion becomes a gatekeeper.
//
//   node tools/strategy-nn/league.mjs --name troops --minutes 90 --workers 12
//
//   --kind       troops (the default) or side
//   --size       how many networks are in the league (even)
//   --wars       how many wars a match is (each fought twice, the teams exchanged)
//   --gates      how many networks a round meet a gatekeeper
//   --rounds     the most rounds, and --minutes the most time
//   --trial      how often (in rounds) a champion is looked for
//   --from       begin from the champion of another run

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MIND_OUTPUTS, MIND_SHAPE, TROOP_SHAPE } from "../../src/runtime/fronts/mind/policy.js";
import { packWeights, paramCount, readWeights } from "../../src/runtime/fronts/mind/net.js";
import { PUSH } from "../../src/runtime/fronts/mind/troops.js";
import { TRAINED_STAFF } from "../../src/runtime/fronts/mind/weights.js";
import { REWARD, contestedSeeds, rngOf } from "./arena.mjs";
import { createPool, playMatch } from "./pool.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").map((part) => part.trim()).filter(Boolean).map((part) => {
  const [key, ...rest] = part.split(/\s+/);
  return [key, rest.join(" ") || "1"];
}));
const number = (key, otherwise) => (args[key] === undefined ? otherwise : Number(args[key]));
const name = args.name ?? "troops";
const troops = (args.kind ?? "troops") !== "side";
const shape = troops ? TROOP_SHAPE : MIND_SHAPE;
const size = Math.max(4, Math.floor(number("size", 12) / 2) * 2);
const wars = number("wars", 5);
const gates = Math.min(size, number("gates", 4));
const rounds = number("rounds", 2000);
const minutes = number("minutes", 90);
const workers = number("workers", 12);
const trialEvery = number("trial", 10);
const TRIAL_WARS = contestedSeeds(900000, number("trialwars", 24));
const TRIED_AT_ONCE = 4;
const CHAMPIONS_KEPT = 4;

const folder = path.join(here, "runs", name);
fs.mkdirSync(folder, { recursive: true });
const say = (entry) => {
  fs.appendFileSync(path.join(folder, "log.jsonl"), `${JSON.stringify(entry)}\n`);
  console.log(JSON.stringify(entry));
};
const round4 = (value) => Math.round(value * 1e4) / 1e4;

const count = paramCount(shape);
const random = rngOf(number("seed", 11));
const gaussian = () => {
  let a = 0;
  while (a === 0) a = random();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random());
};
const pickOf = (list) => list[Math.floor(random() * list.length)];
const shuffled = (list) => {
  const next = list.slice();
  for (let at = next.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1));
    [next[at], next[other]] = [next[other], next[at]];
  }
  return next;
};

// A network that knows nothing: small weights, and for half of them a lean
// toward going straight on, which is the best single habit there is to start
// from. (The last weights are the biases of what it says: for troops, the
// head's; for the side, the side's.)
let born = 0;
const fresh = (lean) => {
  const params = Float64Array.from({ length: count }, () => gaussian() * (lean ? 0.05 : 0.12));
  if (lean) params[count - (troops ? shape.outputs : MIND_OUTPUTS) + (troops ? PUSH : 3)] += 1;
  born += 1;
  return { id: born, params, streak: 0, parent: 0 };
};
// A child of one that advanced (now and then of two): some of its weights nudged, mostly a little.
const childOf = (parent, other = null) => {
  const params = Float64Array.from(parent.params);
  if (other) for (let at = 0; at < count; at += 1) if (random() < 0.5) params[at] = other.params[at];
  const reach = [0.04, 0.04, 0.04, 0.12, 0.12, 0.35][Math.floor(random() * 6)];
  const share = [0.05, 0.1, 0.25, 0.5][Math.floor(random() * 4)];
  for (let at = 0; at < count; at += 1) if (random() < share) params[at] += gaussian() * reach;
  born += 1;
  return { id: born, params, streak: 0, parent: parent.id };
};
const staffOf = (network) => (troops ? { params: Array.from(network.params), troops: true } : { params: Array.from(network.params), prior: 0 });

let league = Array.from({ length: size }, (_, index) => fresh(index % 2 === 0));
if (args.from) {
  const kept = readWeights(JSON.parse(fs.readFileSync(path.join(here, "runs", args.from, "best.json"), "utf8")));
  if (!kept || kept.params.length !== count) throw new Error(`no champion of this kind to begin from in runs/${args.from}`);
  league = league.map((network, index) => (index === 0 ? { ...network, params: kept.params } : childOf({ id: 0, params: kept.params })));
}
// Who a network may be drawn against in place of another network.
const gatekeepers = [
  { name: "the scripted staff", staff: { staff: true } },
  { name: "always advancing", staff: { habit: "advance" } },
  ...(troops ? [{ name: "going for the cities", staff: { habit: "cities" } }] : []),
  ...(TRAINED_STAFF && !(TRAINED_STAFF.shape?.head > 0) ? [{ name: "the trained staff of the whole side", staff: { params: TRAINED_STAFF.params, prior: TRAINED_STAFF.prior ?? 0 } }] : []),
];
const FIXED_GATES = gatekeepers.length;
// The marks every champion is held to.
const MARKS = [
  ["staff", { staff: true }],
  ["advance", { habit: "advance" }],
  ...(troops ? [["cities", { habit: "cities" }]] : []),
];

const pool = createPool(workers);
const started = Date.now();
say({ at: "start", name, kind: troops ? "troops" : "side", size, wars, gates, rounds, minutes, workers, weights: count, reward: REWARD, gatekeepers: gatekeepers.map((gate) => gate.name) });

// How a network does against the marks, on the wars kept aside: its margin a war against each, and their mean.
const trial = async (network) => {
  const played = await Promise.all(MARKS.map(([, staff]) => playMatch(pool, staffOf(network), staff, TRIAL_WARS)));
  const over = Object.fromEntries(MARKS.map(([key], at) => [key, played[at].margin / TRIAL_WARS.length]));
  const beat = Object.fromEntries(MARKS.map(([key], at) => [key, `${played[at].won}/${TRIAL_WARS.length}`]));
  return { score: Object.values(over).reduce((sum, value) => sum + value, 0) / MARKS.length, over, beat };
};

let best = null;
let round = 0;
let seedAt = 1000;
for (round = 1; round <= rounds; round += 1) {
  if ((Date.now() - started) / 60000 > minutes) {
    say({ at: "out of time", round });
    break;
  }
  const seeds = contestedSeeds(seedAt, wars);
  seedAt = seeds[seeds.length - 1] + 1;
  const drawn = shuffled(league);
  const gated = drawn.slice(0, gates);
  const paired = drawn.slice(gates);
  const games = [];
  for (const network of gated) {
    const keeper = pickOf(gatekeepers);
    games.push(playMatch(pool, staffOf(network), keeper.staff, seeds).then((played) => ({ first: network, second: null, keeper: keeper.name, margin: played.margin })));
  }
  for (let at = 0; at + 1 < paired.length; at += 2) {
    games.push(playMatch(pool, staffOf(paired[at]), staffOf(paired[at + 1]), seeds).then((played) => ({ first: paired[at], second: paired[at + 1], keeper: "", margin: played.margin })));
  }
  const played = await Promise.all(games);
  // Whichever wins advances.
  const advanced = [];
  let gatesPassed = 0;
  for (const game of played) {
    if (!game.second) {
      if (game.margin > 0) {
        advanced.push(game.first);
        gatesPassed += 1;
      }
      continue;
    }
    // (Level: the one that has advanced the more often stays.)
    const winner = game.margin > 0 || (game.margin === 0 && game.first.streak >= game.second.streak) ? game.first : game.second;
    advanced.push(winner);
  }
  // (Every one of them lost to a gatekeeper and there was nobody else: the round is played again with those it had.)
  const stock = advanced.length > 0 ? advanced : league;
  for (const network of advanced) network.streak += 1;
  const next = advanced.slice();
  while (next.length < size) next.push(random() < 0.2 && stock.length > 1 ? childOf(pickOf(stock), pickOf(stock)) : childOf(pickOf(stock)));
  league = next;
  const entry = { at: "round", round, advanced: advanced.length, gatesPassed, gates, longest: Math.max(0, ...league.map((network) => network.streak)), seconds: Math.round((Date.now() - started) / 1000) };

  if (round % trialEvery === 0) {
    const tried = league.slice().sort((a, b) => b.streak - a.streak || a.id - b.id).slice(0, TRIED_AT_ONCE);
    const marks = await Promise.all(tried.map(trial));
    const top = marks.reduce((most, mark, at) => (mark.score > marks[most].score ? at : most), 0);
    const mark = marks[top];
    entry.trial = { id: tried[top].id, streak: tried[top].streak, score: round4(mark.score), over: Object.fromEntries(Object.entries(mark.over).map(([key, value]) => [key, round4(value)])), beat: mark.beat };
    if (!best || mark.score > best.score) {
      best = { score: mark.score, id: tried[top].id };
      fs.writeFileSync(path.join(folder, "best.json"), JSON.stringify(packWeights(shape, tried[top].params, {
        prior: 0, drafts: false, round, id: tried[top].id, score: round4(mark.score),
        overStaff: round4(mark.over.staff), overAdvance: round4(mark.over.advance), ...(troops ? { overCities: round4(mark.over.cities) } : {}), reward: REWARD,
      })));
      // A new champion keeps the gate from now on.
      gatekeepers.push({ name: `champion of round ${round}`, staff: staffOf(tried[top]) });
      while (gatekeepers.length > FIXED_GATES + CHAMPIONS_KEPT) gatekeepers.splice(FIXED_GATES, 1);
      entry.champion = true;
    }
  }
  say(entry);
}
say({ at: "done", rounds: round - 1, best: best ? round4(best.score) : null, networks: born, minutes: Math.round((Date.now() - started) / 6000) / 10 });
await pool.close();
