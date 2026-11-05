/*! Open Historia — what a scenario draws on its map for war: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warGeography.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorldState } from "./gameState.js";
import { normalizeClimateZones, normalizeFortifications, normalizeFreezingRegions, normalizeTerrainAreas } from "./warGeography.js";

const square = [[[20, 50], [21, 50], [21, 51], [20, 51]]];

test("terrain areas: a level from flat to impassable, and a shape of at least three points", () => {
  assert.deepEqual(normalizeTerrainAreas([{ id: "alps", name: " The  Alps ", level: 8.4, rings: square }, { level: 3, rings: [[[0, 0], [1, 1]]] }, null, { rings: square, level: 40 }]), [
    { id: "alps", name: "The Alps", level: 8, rings: square },
    { id: "terrain-4", name: "", level: 10, rings: square },
  ]);
  assert.deepEqual(normalizeTerrainAreas("mountains"), []);
});

test("fortified lines: at least level 3, at least two points, breaches merged in order, and a wall being built", () => {
  const [wall] = normalizeFortifications([{ id: "wall", name: "The Wall", owner: "Night's Watch", level: 1, points: [[20, 50], [25, 50.5]], breaches: [[30, 40], [5, 10], [35, 45], [-1, 3], [9, 2]], wear: [[3, 0.42], [4, 0], [5, 2]], building: { since: "0298-01-01", days: 30.4 } }]);
  assert.deepEqual(wall, { id: "wall", name: "The Wall", owner: "Night's Watch", level: 3, points: [[20, 50], [25, 50.5]], breaches: [[5, 10], [30, 45]], wear: [[3, 0.42], [5, 1]], building: { since: "0298-01-01", days: 30 } });
  assert.deepEqual(normalizeFortifications([{ points: [[20, 50]] }]), [], "a wall is a line");
  assert.equal(normalizeFortifications([{ points: [[20, 50], [21, 50]], level: 99 }])[0].level, 10);
});

test("climate zones: seasons by day of the year, a weather mix and effects in range, dated events", () => {
  const [zone] = normalizeClimateZones([{
    id: "north", name: "The North", color: "#AABBCC", rings: square, blendKm: 250, transitionDays: 21,
    seasons: [{ name: "Winter", start: "11-1", end: "3-15", weather: { snow: 50, blizzard: 30, sunshine: 9, fog: -2 }, effects: { pace: 0.5, cold: 9, freezes: true, bogus: 1 } }, { start: "13-01", end: "04-01" }],
    events: [{ name: "The Long Night", from: "0300-01-01", to: "0300-06-01", weather: "blizzard", effects: { pace: 0.2 } }, { name: "no dates" }],
  }]);
  assert.deepEqual(zone, {
    id: "north", name: "The North", color: "#aabbcc", rings: square, blendKm: 250, transitionDays: 21,
    seasons: [{ name: "Winter", start: "11-01", end: "03-15", weather: { snow: 50, blizzard: 30 }, effects: { pace: 0.5, cold: 2, freezes: true } }],
    events: [{ name: "The Long Night", from: "0300-01-01", to: "0300-06-01", weather: "blizzard", effects: { pace: 0.2 } }],
  });
  assert.equal(normalizeClimateZones([{ rings: square }])[0].color, "#7f8c99");
  assert.deepEqual(normalizeFreezingRegions(["lake", "lake", "", 3]), ["lake", "3"]);
});

test("a game keeps what its scenario drew, and an old game has none of it", () => {
  const world = normalizeWorldState({ terrainAreas: [{ level: 6, rings: square }], fortifications: [{ points: [[20, 50], [21, 50]], level: 5, owner: "Aland" }], freezingRegions: ["r1"] });
  assert.equal(world.terrainAreas.length, 1);
  assert.equal(world.fortifications[0].owner, "Aland");
  assert.deepEqual(world.freezingRegions, ["r1"]);
  const old = normalizeWorldState({});
  assert.deepEqual([old.terrainAreas, old.fortifications, old.climateZones, old.freezingRegions], [[], [], [], []]);
});
