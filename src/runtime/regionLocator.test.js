/*! Open Historia — which region a place is in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/regionLocator.test.js
//
// "You should only be able to build fortifications on your own territory": a
// place is found in the regions' own shapes, to the kilometre, not in the
// sheet's cells of a quarter of a degree.

import test from "node:test";
import assert from "node:assert/strict";

import { regionLocatorOf } from "./regionLocator.js";

const square = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];

test("a place is in the region whose shape it lies in, and in none on the water", () => {
  const locate = regionLocatorOf([
    // Split by a border aslant: at 51 N it is at 1.5 E.
    { id: "west", geometry: { type: "Polygon", coordinates: [[[0, 50], [2, 50], [1, 52], [0, 52], [0, 50]]] } },
    { id: "east", geometry: { type: "Polygon", coordinates: [[[2, 50], [3, 50], [3, 52], [1, 52], [2, 50]]] } },
  ]);
  assert.equal(locate(1.45, 51), "west");
  assert.equal(locate(1.55, 51), "east");
  assert.equal(locate(0.1, 51.9), "west");
  assert.equal(locate(2.9, 50.1), "east");
  assert.equal(locate(5, 51), "", "the sea");
  assert.equal(locate(1, 53), "");
  assert.equal(locate("x", 51), "");
  assert.equal(locate(1, null), "", "a place that is no place");
});

test("a hole is no part of its shape, an island of a region is, and water is nobody's", () => {
  const locate = regionLocatorOf([
    { id: "ring", geometry: { type: "Polygon", coordinates: [square(10, 40, 14, 44), square(11, 41, 13, 43)] } },
    { id: "isles", geometry: { type: "MultiPolygon", coordinates: [[square(20, 40, 21, 41)], [square(23, 40, 24, 41)]] } },
    { id: "lake", typeId: "water", geometry: { type: "Polygon", coordinates: [square(11, 41, 13, 43)] } },
  ], { water: new Set(["water"]) });
  assert.equal(locate(10.5, 42), "ring");
  assert.equal(locate(12, 42), "", "the hole, and the lake in it, which is water");
  assert.equal(locate(20.5, 40.5), "isles");
  assert.equal(locate(23.5, 40.5), "isles");
  assert.equal(locate(22, 40.5), "", "between the islands");
});

test("a shape drawn across the date line is one shape, on either side of it; a flat map has no date line", () => {
  const locate = regionLocatorOf([{ id: "strait", geometry: { type: "Polygon", coordinates: [[[179, 60], [-179, 60], [-179, 62], [179, 62], [179, 60]]] } }]);
  assert.equal(locate(179.5, 61), "strait");
  assert.equal(locate(-179.5, 61), "strait");
  assert.equal(locate(180.5, 61), "strait", "however the place is written");
  assert.equal(locate(0, 61), "", "and not the other way round the world");
  assert.equal(locate(178.5, 61), "");
  const flat = regionLocatorOf([{ id: "far", geometry: { type: "Polygon", coordinates: [square(400, 10, 420, 30)] } }], { flat: true });
  assert.equal(flat(410, 20), "far");
  assert.equal(flat(50, 20), "", "a flat sheet does not go round");
});
