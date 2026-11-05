/*! Open Historia — how far the game's camera may go: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/cameraBounds.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { MERCATOR_MAX_LAT } from "../../../server/mapProjection.js";
import { ALMOST_180, cameraMaxBounds } from "./cameraBounds.js";

test("the real Earth keeps 80°S to 85°N and repeats sideways", () => {
  assert.deepEqual(cameraMaxBounds(), [[-Infinity, -80], [Infinity, 85]]);
  assert.deepEqual(cameraMaxBounds({ customBg: null, noWrap: false }), [[-Infinity, -80], [Infinity, 85]]);
});

test("a map that does not repeat stops at its left and right edges", () => {
  // Infinite longitudes switched off MapLibre's own single-world hold, so the
  // camera panned sideways for ever.
  const [[west, south], [east, north]] = cameraMaxBounds({ noWrap: true });
  assert.equal(west, -ALMOST_180);
  assert.equal(east, ALMOST_180);
  assert.ok(Number.isFinite(west) && Number.isFinite(east));
  assert.ok(east - west < 360 && east - west > 359.99);
  assert.deepEqual([south, north], [-80, 85]);
  const drawn = cameraMaxBounds({ customBg: { kind: "vector" }, noWrap: true });
  assert.deepEqual(drawn, [[-ALMOST_180, -MERCATOR_MAX_LAT], [ALMOST_180, MERCATOR_MAX_LAT]]);
});

test("a scenario's own map without bounds fills the square", () => {
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "vector" } }), [[-Infinity, -MERCATOR_MAX_LAT], [Infinity, MERCATOR_MAX_LAT]]);
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds: null } }), [[-Infinity, -MERCATOR_MAX_LAT], [Infinity, MERCATOR_MAX_LAT]]);
});

test("a picture is cut off at its own top and bottom, and at its sides when it does not repeat", () => {
  const bounds = { west: -180, east: 180, south: -40.2, north: 61.5 };
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds } }), [[-Infinity, -40.2], [Infinity, 61.5]]);
  const narrow = { west: -120, east: 95, south: -30, north: 50 };
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds: narrow }, noWrap: true }), [[-120, -30], [95, 50]]);
  // A repeating picture keeps repeating; only its top and bottom bound it.
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds: narrow } }), [[-Infinity, -30], [Infinity, 50]]);
});

test("a frame reaching past ±180 is held at the world's edges", () => {
  const wide = { west: -200, east: 200, south: -60, north: 60 };
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds: wide }, noWrap: true }), [[-ALMOST_180, -60], [ALMOST_180, 60]]);
  const offside = { west: 185, east: 300, south: -60, north: 60 };
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds: offside }, noWrap: true }), [[-ALMOST_180, -60], [ALMOST_180, 60]]);
});

test("the 3D globe is left as it was", () => {
  const bounds = { west: -120, east: 95, south: -30, north: 50 };
  assert.deepEqual(cameraMaxBounds({ customBg: { kind: "image", bounds }, noWrap: true, globe: true }), [[-Infinity, -MERCATOR_MAX_LAT], [Infinity, MERCATOR_MAX_LAT]]);
  assert.deepEqual(cameraMaxBounds({ globe: true, noWrap: true }), [[-Infinity, -80], [Infinity, 85]]);
});
