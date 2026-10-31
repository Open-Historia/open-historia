/*! Open Historia — battlefields and fronts: falling back overland after a story capture: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/fallBackOverland.test.js
//
// "when the ai says an area is taken over enemy troops retreat out of that area
// for it to be taken. the enemy troops can retreat out of that region into your
// territory making some wierd stuff happen" (the owner, 2026-10-31).

import test from "node:test";
import assert from "node:assert/strict";

import { HOLDER_SIDE_A as A, HOLDER_SIDE_B as B, HOLDER_WALL as W } from "./constants.js";
import { fallBackOverland, giveWay } from "./orders.js";

// One row of cells, each its own region unless `regions` says otherwise; the
// field's values all zero, so a cell is a side's only where it holds it.
const battleOf = (holders, regions, troop) => {
  const cols = holders.length;
  return {
    field: { cols, rows: 1, size: cols, holders: Int8Array.from(holders), play: Uint8Array.from(holders, (holder) => (holder === W ? 0 : 1)), phi: new Float32Array(cols) },
    arena: {
      region: Int32Array.from(regions), cities: [], cols, rows: 1, frame: { west: 0, north: 1, km: 50, cols, rows: 1 },
      ids: Array.from({ length: cols }, (_, index) => `r${index}`), names: Array.from({ length: cols }, (_, index) => `Region ${index}`),
    },
    troops: [[], [{ x: troop + 0.5, y: 0.5, strength: 1000, dig: 3 }]],
    log: [],
  };
};

// Borduria (B) holds a besieged town west of the line (cell 1), and its own
// ground east of it (cells 7 on); Aland (A) holds between. The story gives
// Aland the region of cells 4-6 (region 4), where a Bordurian troop stands at cell 4.
const holders = [A, B, A, A, A, A, A, B, B, B];
const regions = [0, 1, 2, 3, 4, 4, 4, 7, 8, 9];

test("the nearest as the crow flies was the besieged town behind the taker's line", () => {
  const battle = battleOf(holders, regions, 4);
  giveWay(battle, B, 0, "2016-01-02", 20);
  assert.equal(Math.floor(battle.troops[B][0].x), 1, "giveWay put it in the town, across Aland's ground");
});

test("a story capture's defender falls back across the region taken onto its own side's ground beside it", () => {
  const battle = battleOf(holders, regions, 4);
  fallBackOverland(battle, B, "2016-01-02", 4, 20);
  const troop = battle.troops[B][0];
  assert.equal(Math.floor(troop.x), 7, "out of the region taken, onto Borduria's ground next to it");
  assert.equal(troop.strength, 1000, "without loss");
  assert.equal(troop.dig, 0);
});

test("never across the taker's other ground, a country outside the war or the sea: with no way back it is lost", () => {
  // Cells 4-6 taken; Borduria's ground lies beyond a strip of Aland's (cell 7) and beyond the sea (cell 2).
  const battle = battleOf([B, A, W, A, A, A, A, A, B, B], [0, 1, 2, 3, 4, 4, 4, 7, 8, 9], 5);
  fallBackOverland(battle, B, "2016-01-02", 4, 20);
  assert.equal(battle.troops[B][0].strength, 0);
  assert.deepEqual(battle.log, [{ d: "2016-01-02", k: "overrun", s: B, at: "region: Region 4" }], "and the record says where it was overrun");
});

test("a troop already on its own ground stays where it is", () => {
  const battle = battleOf(holders, regions, 8);
  fallBackOverland(battle, B, "2016-01-02", 4, 20);
  assert.equal(Math.floor(battle.troops[B][0].x), 8);
});

test("the story capture uses it", async () => {
  const fs = await import("node:fs");
  const engine = fs.readFileSync(new URL("./engine.js", import.meta.url), "utf8");
  assert.match(engine, /fallBackOverland\(battle, 1 - side, run\.dateOf\(day\), region, field\.cols \+ field\.rows\);/);
});
