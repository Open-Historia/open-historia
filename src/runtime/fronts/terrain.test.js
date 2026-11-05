/*! Open Historia — battlefields and fronts: ground a scenario made harder to cross: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/terrain.test.js
//
// "Make it so scenario creators can make certain areas have harder traversal
// than others and make troops move slower, like for mountains or crevices or
// rivers ... a level 0-10 of traversability, 10 being impossible to pass."

import test from "node:test";
import assert from "node:assert/strict";

import { rasterizeArena } from "./arena.js";
import { runFronts } from "./engine.js";
import { createFrame } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = (cities = []) => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities, key: "terrain" });
// A band of rough ground across Borduria's side of the border, north to south.
const band = (level) => ({ key: `band-${level}`, areas: [{ id: "hills", level, rings: [[[24.2, 52.2], [26, 52.2], [26, 49.8], [24.2, 49.8]]] }] });

test("rough ground is slower in proportion to its level, level 10 is a wall, and a city keeps a way in", () => {
  const world = sheet([{ name: "Hilltown", lng: 25, lat: 51.25, population: 50000 }]);
  const frame = createFrame({ west: 19.5, south: 49.5, east: 28.5, north: 52.5 });
  const plain = rasterizeArena(frame, world.map.regions, { cities: world.map.cities });
  const hills = rasterizeArena(frame, world.map.regions, { cities: world.map.cities, terrain: band(6) });
  const wall = rasterizeArena(frame, world.map.regions, { cities: world.map.cities, terrain: band(10) });
  assert.equal(rasterizeArena(frame, world.map.regions, { cities: world.map.cities, terrain: { key: "none", areas: [] } }).key, plain.key, "no rough ground, the same arena");
  assert.notEqual(hills.key, plain.key);
  // A cell inside the band: 4 tenths of its speed at level 6; none at level 10, and no region's either.
  let inside = -1;
  for (let cell = 0; cell < plain.size; cell += 1) {
    const col = cell % plain.cols;
    const lng = frame.lng0 + (col + 0.5) * frame.cell;
    if (lng > 25.3 && lng < 25.7 && plain.region[cell] !== 0 && !plain.cities.some((city) => city.cell === cell)) {
      inside = cell;
      break;
    }
  }
  assert.ok(inside >= 0);
  assert.ok(Math.abs(hills.speed[inside] - plain.speed[inside] * 0.4) < 1e-6);
  assert.equal(wall.speed[inside], 0);
  assert.equal(wall.region[inside], 0, "impassable ground is no part of a region: it can never be held");
  const regionOf = plain.region[inside];
  assert.ok(wall.cells[regionOf] < plain.cells[regionOf], "and its region is taken by what of it can be held");
  // The city in the band keeps a way in, at a tenth of the pace.
  const city = wall.cities.find((entry) => entry.name === "Hilltown");
  assert.ok(wall.speed[city.cell] > 0 && wall.region[city.cell] !== 0);
});

test("an advance into rough ground is slower, and one into a wall of it stops at its edge", () => {
  const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
  const heldBy = (terrain) => {
    let last = null;
    const world = sheet();
    runFronts(frontInput(world, {
      arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: fixed,
      ...(terrain ? { map: { ...world.map, terrain } } : {}),
      watch: (seen) => { last = seen.holders; },
    }));
    return last.filter((holder) => holder === 0).length;
  };
  const open = heldBy(null);
  const hills = heldBy(band(7));
  const wall = heldBy(band(10));
  assert.ok(hills < open, `${hills} against ${open}`);
  assert.ok(wall <= hills, `${wall} against ${hills}`);
});
