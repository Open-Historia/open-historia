/*! Open Historia — the difficulty in the land war, through a turn and in what is said of it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontDifficulty.test.js
//
// "Make the difficulty modes affect this. With normal being realistic and
// fair, and anything above giving opponents handicaps, with impossible giving
// the opponents huge advantages." The engine's side of it is
// runtime/fronts/handicap.test.js. Here: the level a game is played at reaches
// the engine through a turn; the story is told what the engine is doing, on
// every level but Medium; and the player is told too, in the war room and in
// the difficulty panel, so that the handicap is never a hidden one.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeMask } from "../../runtime/fronts/codec.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { buildFrontsBlock, difficultyRule } from "./frontPrompt.js";
import { runTurnFronts } from "./frontTurn.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = syntheticMap({ layout: enlarge(["AAABBB", "AAABBB", "AAABBB", "AAABBB"], 2), legend, west: 20, north: 52, step: 0.25 });

// A turn of three weeks in which Borduria attacks Aland along the whole border.
const turn = async ({ difficulty, players = ["Aland"] } = {}) => {
  const world = {
    regionOwnershipOverrides: Object.fromEntries(sheet.regions.map((region) => [region.id, sheet.controllerOf(region.id)])),
    wars: [{ id: "war-17", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01" }],
    battlefields: [],
    units: [],
  };
  const run = await runTurnFronts({
    createFrontRun,
    // (Every side is left to the orders this test gives it: a side's own staff is tested in frontStaff.test.js.)
    staff: false,
    world,
    events: [{ id: "event-ai-r0002-20240302-001", date: "2024-03-02", title: "Borduria attacks", description: "x", impacts: {} }],
    frontOrders: [{ id: "front-0", battlefield: "The Border", side: "Borduria", order: "advance", sector: "all", eventIds: ["event-ai-r0002-20240302-001"] }],
    warStages: [world.wars],
    fromDate: "2024-03-01",
    toDate: "2024-03-22",
    map: { key: "the difficulty sheet", cities: [], flat: false },
    regionIds: sheet.regions.map((region) => region.id),
    arenas: new Map(),
    loadRegions: async () => sheet.regions,
    seed: "campaign|2",
    players,
    ...(difficulty === undefined ? {} : { difficulty }),
  });
  const [record] = run.battlefields;
  // (A battlefield one side was driven off altogether is closed, and keeps no ground to count.)
  if (!record.field) return { record, share: 0 };
  const holders = decodeMask(record.field.mask, record.frame.cols * record.frame.rows);
  const held = [0, 0];
  for (const holder of holders) if (holder < 2) held[holder] += 1;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  return { record, share: held[side] / (held[0] + held[1]) };
};

test("the level a game is played at reaches the engine through a turn", async () => {
  const [plain, medium, hard, impossible] = await Promise.all([turn(), turn({ difficulty: "medium" }), turn({ difficulty: "hard" }), turn({ difficulty: "impossible" })]);
  // No level given is Medium, which is the turn as it was.
  assert.deepEqual(medium.record, plain.record);
  assert.ok(medium.share > hard.share, `medium ${medium.share} hard ${hard.share}`);
  assert.ok(hard.share > impossible.share, `hard ${hard.share} impossible ${impossible.share}`);
  // With nobody playing either of them, the level changes nothing.
  const unplayed = await turn({ difficulty: "impossible", players: [] });
  assert.deepEqual(unplayed.record, plain.record);
});

test("the story is told what the engine gives, on every level but Medium", async () => {
  const { record } = await turn();
  const battlefields = [record];
  assert.equal(difficultyRule(battlefields, ["Aland"], "medium"), "");
  assert.equal(difficultyRule(battlefields, ["Aland"], ""), "");
  // Nobody plays here, or people play on both sides: nobody is weighed, and nothing is said.
  assert.equal(difficultyRule(battlefields, ["Neutralia"], "impossible"), "");
  assert.equal(difficultyRule(battlefields, ["Aland", "Borduria"], "impossible"), "");
  assert.equal(difficultyRule([], ["Aland"], "impossible"), "");
  assert.equal(difficultyRule([{ ...record, status: "closed" }], ["Aland"], "impossible"), "");

  const hard = difficultyRule(battlefields, ["Aland"], "hard");
  assert.equal(hard, "The difficulty is Hard: the engine gives the troops that fight a player's country an edge (they fight at 115% of their strength and advance at 110% of their pace, with 130% of the usual reserves). Command them to use it: they attack where they stand the stronger and do not wait to be attacked.");
  assert.match(difficultyRule(battlefields, ["Aland"], "impossible"), /^The difficulty is Impossible: .*fight at 175% of their strength and advance at 140% of their pace, with 300% of the usual reserves/);
  const easy = difficultyRule(battlefields, ["Aland"], "easy");
  assert.equal(easy, "The difficulty is Easy: the engine holds back the troops that fight a player's country (they fight at 93% of their strength and advance at 95% of their pace, with 85% of the usual reserves). Command them with the caution that calls for.");

  // In the block: once, with the rules, and not at all on Medium, where the block is what it was.
  const plain = buildFrontsBlock({ battlefields, players: ["Aland"] });
  assert.equal(buildFrontsBlock({ battlefields, players: ["Aland"], difficulty: "medium" }), plain);
  const told = buildFrontsBlock({ battlefields, players: ["Aland"], difficulty: "hard" });
  assert.equal(told.split(hard).length - 1, 1);
  assert.ok(told.indexOf(hard) < told.indexOf("Battlefields open now:"), "it stands with the rules, above the battlefields");
  assert.equal(plain.includes("The difficulty is"), false);
  // The skip's block is given the game's level.
  assert.match(read("frontApply.js"), /buildFrontsBlock\(\{ battlefields: world\?\.battlefields, players: humanCountriesOf\(game\), period: foreseen, transports: world\?\.transports, difficulty: normalizeDifficulty\(game\?\.difficulty\), orderFunction: /);
});

test("the player is told too: in the war room, and where the level is chosen", () => {
  const room = read("../GameUI/warRoom.jsx");
  // The room reads the game's level (its view of the game is a few fields picked out: this is one of them),
  assert.match(room, /const selectGame = \(game\) => \(\{[^}]*\n\s*difficulty: String\(game\?\.difficulty \|\| ""\),\n\}\);/);
  // works out which side is weighed as the engine does, and says the other side's figures.
  assert.match(room, /const given = handicapOf\(\{ difficulty: game\.difficulty, sides: record\.sides, players: people \}\);/);
  assert.match(room, /return given\.side === 1 - side \? \{ power: Math\.round\(given\.edge\.power \* 100\), pace: Math\.round\(given\.edge\.pace \* 100\), reserves: Math\.round\(given\.edge\.reserves \* 100\) \} : null;/);
  assert.match(room, /\{theirEdge && \(\s*<div data-oh-war-room-edge="" [^>]*>\s*At this difficulty their troops here fight at \{theirEdge\.power\}% of their strength and advance at \{theirEdge\.pace\}% of their pace, with \{theirEdge\.reserves\}% of the usual reserves\.\s*<\/div>\s*\)\}/);
  const panel = read("../GameUI/cheats.jsx");
  assert.match(panel, /On battlefields the level is also a stated handicap\. Medium is realistic and fair\. Above it the armies fighting you fight harder, advance faster and are reinforced more, hugely so on Impossible\. Below it they are the ones held back\./);
  // (The panel's own account of the level is the game's; the battlefields' is beside it.)
  assert.match(panel, /Difficulty decides how things tend to go for you./);
});
