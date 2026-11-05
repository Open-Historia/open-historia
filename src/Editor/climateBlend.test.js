/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
// Run: node --test src/Editor/climateBlend.test.js
//
// "It should look like a blend of colors where they blend into each other."
// The Workshop paints the climate zones itself, a cell at a time: these are
// the weights and the colours it paints.

import test from "node:test";
import assert from "node:assert/strict";

import { blendCellPixels, blendWeight, mercatorKmPerUnit, paintClimateBlend, prepareClimateZones, signedDistance } from "./climateBlend.js";
import { ZONE_CURVE_ROUNDS } from "../runtime/fronts/climate.js";

// Two zones side by side on a plane measured in km: A from x 0 to 100, B from
// 100 to 200, both from y 0 to 100. Rings as the world keeps them, closed.
const square = (x0, x1) => [[[x0, 0], [x1, 0], [x1, 100], [x0, 100], [x0, 0]]];
const zoneA = { color: "#ff0000", blendKm: 40, rings: square(0, 100) };
const zoneB = { color: "#00ff00", blendKm: 40, rings: square(100, 200) };

// One cell at (x, y), the picture's only one, as RGBA.
const cellAt = (zones, x, y) => [...paintClimateBlend({ zones, cols: 1, rows: 1, x0: x - 0.5, y0: y + 0.5, cell: 1 })];

test("a zone holds a spot fully deep inside, by half on its edge, and not at all half its blend width outside", () => {
  assert.equal(blendWeight(30, 40), 1);
  assert.equal(blendWeight(0, 40), 0.5);
  assert.equal(blendWeight(-10, 40), 0.25);
  assert.equal(blendWeight(-20, 40), 0);
  assert.equal(blendWeight(-500, 40), 0);
  // No blend width: a hard edge.
  assert.equal(blendWeight(0.001, 0), 1);
  assert.equal(blendWeight(-0.001, 0), 0);
});

test("a spot's distance to a zone's edge is positive inside it and negative outside, and a ring inside is a hole", () => {
  const [zone] = prepareClimateZones([{ color: "#000000", blendKm: 10, rings: [[[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]] }]);
  assert.equal(signedDistance(zone.edges, 2, 5), 2);
  assert.equal(signedDistance(zone.edges, 13, 5), -3);
  assert.equal(signedDistance(zone.edges, 5, 5), -1, "the middle of the hole is outside, a unit from its edge");
});

test("a ring is closed whether or not it repeats its first point, and a zone with no shape is left out", () => {
  const [open] = prepareClimateZones([{ color: "#000000", rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]] }]);
  const [closed] = prepareClimateZones([{ color: "#000000", rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }]);
  assert.deepEqual([...open.edges], [...closed.edges]);
  // (Each corner rounded off, as the game reads a zone: runtime/fronts/climate.js curvedRings.)
  assert.equal(open.edges.length / 4, 4 * 2 ** ZONE_CURVE_ROUNDS);
  assert.deepEqual([open.minX, open.minY, open.maxX, open.maxY], [0, 0, 10, 10]);
  assert.deepEqual(prepareClimateZones([{ color: "#000000", rings: [] }, null]), []);
});

test("deep inside a zone is its own colour at full strength", () => {
  const zones = prepareClimateZones([zoneA, zoneB]);
  const [r, g, b, a] = cellAt(zones, 40, 50);
  assert.deepEqual([r, g, b], [255, 0, 0]);
  assert.equal(a, Math.round(255 * 0.35));
});

test("where two zones meet their colours blend evenly, and the blend shifts across the width", () => {
  const zones = prepareClimateZones([zoneA, zoneB]);
  // On the shared edge: half each, at full strength between them.
  const [r, g, , a] = cellAt(zones, 100, 50);
  assert.ok(Math.abs(r - g) <= 1 && r > 120 && r < 135, `${r} ${g}`);
  assert.equal(a, Math.round(255 * 0.35));
  // 10 km into B: B holds 0.75 of it, A 0.25.
  const [r2, g2] = cellAt(zones, 110, 50);
  assert.ok(Math.abs(r2 - 64) <= 1 && Math.abs(g2 - 191) <= 1, `${r2} ${g2}`);
});

test("a zone with nothing beside it fades out into the plain map", () => {
  const zones = prepareClimateZones([zoneA]);
  assert.equal(cellAt(zones, 100, 50)[3], Math.round(255 * 0.35 * 0.5), "half strength on its edge");
  assert.equal(cellAt(zones, 110, 50)[3], Math.round(255 * 0.35 * 0.25));
  assert.equal(cellAt(zones, 121, 50)[3], 0, "nothing past half its blend width");
});

test("the picture is laid out row by row from the top, with y growing upwards as on the map", () => {
  const zones = prepareClimateZones([{ color: "#0000ff", blendKm: 0, rings: [[[0, 0], [10, 0], [10, 5], [0, 5]]] }]);
  // Two rows of one cell: the top row is y 5 to 10 (outside), the bottom y 0 to 5.
  const bytes = paintClimateBlend({ zones, cols: 1, rows: 2, x0: 0, y0: 10, cell: 5 });
  assert.equal(bytes[3], 0);
  assert.equal(bytes[7], Math.round(255 * 0.35));
});

test("the map's plane is measured in km at each latitude, and the cells grow with the zones' edges", () => {
  assert.ok(Math.abs(mercatorKmPerUnit(0) - 0.001) < 1e-12, "a metre at the equator");
  // At 60° north a unit of the plane is half a metre on the ground.
  const y60 = 6378137 * Math.log(Math.tan(Math.PI / 4 + Math.PI / 6));
  assert.ok(Math.abs(mercatorKmPerUnit(y60) - 0.0005) < 1e-9);
  assert.equal(blendCellPixels(10, 1920 * 1080), 4, "a few edges: the finest cells");
  assert.equal(blendCellPixels(5e6, 1920 * 1080), 48, "too many: the coarsest");
  const middle = blendCellPixels(2000, 1920 * 1080);
  assert.ok(middle > 4 && middle < 48);
});
