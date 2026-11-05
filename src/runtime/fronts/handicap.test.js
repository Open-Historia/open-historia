/*! Open Historia — battlefields and fronts: what the difficulty weighs: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/handicap.test.js
//
// "Make the difficulty modes affect this. With normal being realistic and
// fair, and anything above giving opponents handicaps, with impossible giving
// the opponents huge advantages." On Medium a battlefield is fought as it is.
// Above it the side fighting a country a person plays fights harder and has
// more behind it, level by level; below it that side is the one held back.
// Nobody is weighed against another player, and a war nobody plays in is
// fought fair on every level.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DIFFICULTY_LEVELS } from "../difficulty.js";
import { decodeTroops } from "./codec.js";
import { DIFFICULTY_EDGES, POOL_PER_TROOP } from "./constants.js";
import { runFronts } from "./engine.js";
import { FAIR_EDGE, edgeOfDifficulty, handicapOf, weighedSide } from "./handicap.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

const LEVELS = ["very-easy", "easy", "medium", "hard", "very-hard", "impossible"];
const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "handicap" });
const order = (day, side, word) => ({ day, type: "order", battlefield: "The Front", side, order: word, sector: "all" });
const strength = (record, side) => decodeTroops(record.troops[side]).reduce((sum, troop) => sum + Math.max(0, troop.strength), 0);

// An even fight on an even sheet: `attacker` advances for `days`, and Aland is who is played unless said.
const fight = ({ difficulty, attacker = "Borduria", days = 20, players = ["Aland"], battlefields = undefined, fromDate = undefined } = {}) => {
  const world = sheet();
  const input = frontInput(world, { arenas: new Map(), days, moments: [order(0, attacker, "advance")], players, ...(battlefields ? { battlefields, fromDate } : {}), ...(difficulty === undefined ? {} : { difficulty }) });
  const result = runFronts(input);
  applyFlips(world, result.flips);
  const [record] = result.battlefields;
  const { held } = readBattlefield(record, world);
  return { result, record, share: held[0] / (held[0] + held[1]) };
};

test("the table: Medium is the fight as it is, every level above it gives more and every level below it less", () => {
  assert.deepEqual(Object.keys(DIFFICULTY_EDGES), LEVELS);
  // The levels are the game's own, one for one (runtime/difficulty.js).
  assert.deepEqual(DIFFICULTY_LEVELS.map((level) => level.id), LEVELS);
  assert.deepEqual(DIFFICULTY_EDGES.medium, { power: 1, pace: 1, reserves: 1, mend: 1 });
  assert.equal(FAIR_EDGE, DIFFICULTY_EDGES.medium);
  for (const figure of ["power", "pace", "reserves", "mend"]) {
    for (let index = 1; index < LEVELS.length; index += 1) {
      assert.ok(DIFFICULTY_EDGES[LEVELS[index]][figure] > DIFFICULTY_EDGES[LEVELS[index - 1]][figure], `${figure} rises from ${LEVELS[index - 1]} to ${LEVELS[index]}`);
    }
  }
  // "Impossible giving the opponents huge advantages."
  assert.ok(DIFFICULTY_EDGES.impossible.power >= 1.5 && DIFFICULTY_EDGES.impossible.pace >= 1.3 && DIFFICULTY_EDGES.impossible.reserves >= 2.5 && DIFFICULTY_EDGES.impossible.mend >= 2);
  // An old game's "standard", a blank and anything unknown are Medium; nothing is read off the object's own workings.
  for (const value of ["standard", "", undefined, null, "nonsense", "constructor", "toString"]) assert.equal(edgeOfDifficulty(value), FAIR_EDGE, String(value));
  assert.equal(edgeOfDifficulty(" Very-Hard "), DIFFICULTY_EDGES["very-hard"]);
});

test("who is weighed: the side fighting a person's country, and nobody against another player", () => {
  const sides = [["Aland", "Cisland"], ["Borduria"]];
  assert.equal(weighedSide(sides, ["Aland"]), 1);
  assert.equal(weighedSide(sides, ["borduria"]), 0);
  // An ally nobody plays is on the player's side: the other side is still the one weighed.
  assert.equal(weighedSide(sides, ["Cisland"]), 1);
  // Nobody plays here; people on both sides; nobody plays at all.
  assert.equal(weighedSide(sides, ["Neutralia"]), -1);
  assert.equal(weighedSide(sides, ["Aland", "Borduria"]), -1);
  assert.equal(weighedSide(sides, []), -1);

  const hard = handicapOf({ difficulty: "hard", sides, players: ["Aland"] });
  assert.equal(hard.side, 1);
  assert.equal(hard.edge, DIFFICULTY_EDGES.hard);
  assert.deepEqual(hard.edges, [FAIR_EDGE, DIFFICULTY_EDGES.hard]);
  // The player's allies are given nothing either way: their side is the fair one.
  assert.equal(hard.edges[0], FAIR_EDGE);
  // On Medium nobody is weighed, whoever plays.
  assert.deepEqual(handicapOf({ difficulty: "medium", sides, players: ["Aland"] }), { side: -1, edge: FAIR_EDGE, edges: [FAIR_EDGE, FAIR_EDGE] });
  assert.equal(handicapOf({ difficulty: "impossible", sides, players: ["Aland", "Borduria"] }).side, -1);
  assert.equal(handicapOf().side, -1);
});

test("attacked by an even enemy, a player keeps less ground the harder the level", () => {
  const share = Object.fromEntries(["easy", "medium", "hard", "very-hard", "impossible"].map((difficulty) => [difficulty, fight({ difficulty }).share]));
  assert.ok(share.easy > share.medium + 0.05, `easy ${share.easy} medium ${share.medium}`);
  assert.ok(share.medium > share.hard + 0.03, `medium ${share.medium} hard ${share.hard}`);
  assert.ok(share.hard > share["very-hard"], `hard ${share.hard} very hard ${share["very-hard"]}`);
  assert.ok(share["very-hard"] > share.impossible, `very hard ${share["very-hard"]} impossible ${share.impossible}`);
  // Impossible is a rout: the same enemy that took a part of the sheet on Medium takes nearly all of it.
  assert.ok(share.impossible < share.medium * 0.5, `impossible ${share.impossible} medium ${share.medium}`);
});

test("attacking an even enemy, a player takes less ground the harder the level, and none at all on the hardest", () => {
  const start = 0.5;
  const share = Object.fromEntries(["easy", "medium", "hard", "impossible"].map((difficulty) => [difficulty, fight({ difficulty, attacker: "Aland" }).share]));
  assert.ok(share.easy >= share.medium, `easy ${share.easy} medium ${share.medium}`);
  assert.ok(share.medium > share.hard + 0.03, `medium ${share.medium} hard ${share.hard}`);
  assert.ok(share.hard > share.impossible, `hard ${share.hard} impossible ${share.impossible}`);
  assert.ok(share.medium > start + 0.1, `on Medium an attack at even strength gains ground: ${share.medium}`);
  assert.ok(share.impossible < start + 0.05, `on Impossible it gains nothing to speak of: ${share.impossible}`);
});

test("Medium is the engine as it was, and a war nobody plays in is fought fair on every level", () => {
  const plain = fight({});
  // Medium, an old game's "standard" and no difficulty at all are one and the same run.
  assert.deepEqual(fight({ difficulty: "medium" }).record, plain.record);
  assert.deepEqual(fight({ difficulty: "standard" }).record, plain.record);
  // Two countries nobody plays: Impossible changes nothing between them.
  const unplayed = fight({ players: ["Neutralia"] });
  assert.deepEqual(fight({ difficulty: "impossible", players: ["Neutralia"] }).record, unplayed.record);
  assert.deepEqual(unplayed.record, plain.record);
  // People on both sides: nobody is handicapped against another player.
  assert.deepEqual(fight({ difficulty: "impossible", players: ["Aland", "Borduria"] }).record, plain.record);
  // And it is always the side AGAINST the player: with Borduria played, Aland is the one given the edge.
  const other = fight({ difficulty: "impossible", players: ["Borduria"] });
  assert.ok(other.share > plain.share + 0.05, `Aland, attacked, keeps ${other.share} against ${plain.share}`);
});

test("the edge is in the reserves a side is raised with, and it is never kept with the record", () => {
  const medium = fight({ difficulty: "medium", days: 0 }).record;
  const impossible = fight({ difficulty: "impossible", days: 0 }).record;
  const troops = decodeTroops(medium.troops[1]).length;
  assert.equal(decodeTroops(impossible.troops[1]).length, troops, "the same army, in numbers");
  assert.equal(medium.pool[1], troops * POOL_PER_TROOP);
  assert.equal(impossible.pool[1], troops * POOL_PER_TROOP * DIFFICULTY_EDGES.impossible.reserves);
  // The player's own side is raised as ever.
  assert.equal(impossible.pool[0], medium.pool[0]);
  // Nothing of it is in the record: a level changed in mid-game counts from the next run.
  assert.equal(Object.hasOwn(impossible, "edge"), false);
  assert.deepEqual(impossible.quality, medium.quality);
  const next = (difficulty) => fight({ difficulty, battlefields: [medium], fromDate: "2024-03-01", days: 15 });
  const [eased, kept, raised] = [next("easy"), next("medium"), next("impossible")];
  assert.ok(raised.share < kept.share - 0.03, `raised to Impossible: ${raised.share} against ${kept.share}`);
  assert.ok(eased.share > kept.share + 0.01, `lowered to Easy: ${eased.share} against ${kept.share}`);
  // What it costs the player's troops to be attacked by the stronger army.
  assert.ok(strength(raised.record, 0) < strength(kept.record, 0), `${strength(raised.record, 0)} against ${strength(kept.record, 0)}`);
});

test("the game's difficulty reaches the engine, and each level says what it does on the battlefields", () => {
  const apply = read("../../Game/AI/frontApply.js");
  // The run made before the story is asked for and the one that applies it are given the same level.
  assert.match(apply, /players: humanCountriesOf\(game\),\n\s*\/\/[^\n]*\n\s*difficulty: normalizeDifficulty\(game\?\.difficulty\),\n\s*\};/);
  assert.match(apply, /players: humanCountriesOf\(game\),\n\s*difficulty: normalizeDifficulty\(game\?\.difficulty\),\n\s*\}\);/);
  const turn = read("../../Game/AI/frontTurn.js");
  assert.match(turn, /players: asArray\(players\)\.map\(clean\)\.filter\(Boolean\),\n\s*difficulty: clean\(difficulty\),/);
  // In the fight itself: attack, defence and mending; the pace of an advance; and the other side's empty ground.
  const combat = read("combat.js");
  assert.equal(combat.split("battle.edge[side].power").length - 1, 2);
  assert.match(combat, /REINFORCE_PER_DAY \* battle\.edge\[side\]\.mend/);
  assert.match(combat, /troop\.paceFactor \* battle\.edge\[entry\.side\]\.pace \* troop\.legs\) \/ kmAt\(troop\.y\)/);
  assert.match(combat, /const open = theirs \? Math\.min\(1, 1 \/ battle\.edge\[1 - side\]\.power\) : 1;/);
  // What the player is told of each level is the figures the engine uses.
  for (const level of DIFFICULTY_LEVELS) {
    const edge = DIFFICULTY_EDGES[level.id];
    const told = level.effects.filter((effect) => effect.startsWith("On battlefields, "));
    assert.equal(told.length, 1, level.id);
    if (level.id === "medium") {
      assert.match(told[0], /both sides fight on equal terms/);
      continue;
    }
    assert.ok(told[0].includes(`fight at ${Math.round(edge.power * 100)}% of their strength and advance at ${Math.round(edge.pace * 100)}% of their pace`), `${level.id}: ${told[0]}`);
    assert.ok(told[0].includes(`with ${Math.round(edge.reserves * 100)}% of the usual reserves`), `${level.id}: ${told[0]}`);
  }
  assert.match(DIFFICULTY_LEVELS.at(-1).effects.at(-1), /a huge advantage/);
});
