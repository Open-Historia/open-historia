/*! Open Historia — the bare map put back under a battlefield, laid on the 3D terrain: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/terrainDrape.test.js
//
// "3d terrain and warfronts do not seem to work together, the war terrain is
// not 3d" (the owner, 2026-11-09). The battlefield's ground draws into the
// terrain's tiles; the bare map put back under the paint is drawn on the
// screen, so it is lifted by the ground's heights, read here.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DRAPE_MAX_STEPS,
  EARTH_RADIUS_M,
  createTerrainHeights,
  drapeGrid,
  gridHeights,
  gridX,
  gridY,
  heightAt,
  latOfY,
  liftToMetres,
  lngOfX,
  meshBounds,
  sheetPerMetre,
  terrainOf,
  vertexHeights,
} from "./terrainDrape.js";
import { mercatorX, mercatorY } from "./vnext/battlefieldGround.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const close = (a, b, within = 1e-9) => Math.abs(a - b) <= within;

test("the sheet and the world: places and metres", () => {
  for (const lng of [-179, -20, 0, 44.5, 180]) assert.ok(close(lngOfX(mercatorX(lng)), lng));
  for (const lat of [-80, -12.5, 0, 38, 85]) assert.ok(close(latOfY(mercatorY(lat)), lat, 1e-7));
  // A metre at the equator is one in the earth's circumference; at 60 degrees, twice that.
  assert.ok(close(sheetPerMetre(0), 1 / (2 * Math.PI * EARTH_RADIUS_M), 1e-20));
  assert.ok(close(sheetPerMetre(60) / sheetPerMetre(0), 2, 1e-9));
});

test("the matrices take metres: the flat map's both, the globe's only the flat one it turns from", () => {
  const matrix = () => Float32Array.from({ length: 16 }, (_, index) => index + 1);
  const perMetre = sheetPerMetre(40);
  const z = (m) => [...m.slice(8, 12)];
  const main = matrix();
  const fallback = matrix();
  liftToMetres(main, fallback, "mercator", 40);
  assert.deepEqual(z(main), z(matrix()).map((value) => Math.fround(value * perMetre)));
  assert.deepEqual(z(fallback), z(main));
  assert.deepEqual([...main.slice(0, 8), ...main.slice(12)], [...matrix().slice(0, 8), ...matrix().slice(12)], "only the height's column");
  const globeMain = matrix();
  const globeFallback = matrix();
  liftToMetres(globeMain, globeFallback, "globe", 40);
  assert.deepEqual([...globeMain], [...matrix()], "the globe takes metres already");
  assert.deepEqual(z(globeFallback), z(main));
});

test("the grid: cells about square, none finer than the terrain's heights, at most so many a side", () => {
  const wide = drapeGrid([0.5, 0.3, 0.52, 0.31]);
  assert.equal(wide.nx, DRAPE_MAX_STEPS);
  assert.equal(wide.ny, DRAPE_MAX_STEPS / 2);
  const coarse = drapeGrid([0.5, 0.3, 0.52, 0.31], { minCell: 0.005 });
  assert.deepEqual([coarse.nx, coarse.ny], [4, 2]);
  const tiny = drapeGrid([0.5, 0.3, 0.5001, 0.3001], { minCell: 0.01 });
  assert.deepEqual([tiny.nx, tiny.ny], [1, 1], "never less than one cell");
  assert.equal(drapeGrid([0.5, 0.3, 0.5, 0.31]), null, "no width, no grid");
  assert.equal(drapeGrid(null), null);
  assert.ok(close(gridX(wide, 0), 0.5) && close(gridX(wide, wide.nx), 0.52));
  assert.ok(close(gridY(wide, 0), 0.3) && close(gridY(wide, wide.ny), 0.31));
  assert.deepEqual(meshBounds(new Float32Array([0.25, 0.5, 0.75, 0.25, 0.5, 0.75])), [0.25, 0.25, 0.75, 0.75]);
  assert.equal(meshBounds(new Float32Array(0)), null);
});

test("heights are read at the grid's corners and between them", () => {
  const grid = drapeGrid([mercatorX(40), mercatorY(40), mercatorX(48), mercatorY(34)], { max: 8 });
  // Heights that rise with the longitude alone are read back exactly between the corners.
  const asked = [];
  const heights = gridHeights(grid, (lng, lat) => {
    asked.push([lng, lat]);
    return (lng - 40) * 100;
  });
  assert.equal(heights.length, (grid.nx + 1) * (grid.ny + 1));
  assert.equal(asked.length, heights.length, "once a corner");
  assert.ok(close(asked[0][0], 40, 1e-9) && close(asked[0][1], 40, 1e-7), "from the top left");
  for (const lng of [40, 41.3, 44, 47.99]) {
    assert.ok(close(heightAt(grid, heights, mercatorX(lng), mercatorY(37)), (lng - 40) * 100, 1e-3), String(lng));
  }
  const positions = new Float32Array([mercatorX(42), mercatorY(36), 9, 9, mercatorX(46), mercatorY(35), 9, 9]);
  const lifted = vertexHeights(positions, grid, heights, 4);
  assert.equal(lifted.length, 2);
  assert.ok(close(lifted[0], 200, 0.5) && close(lifted[1], 600, 0.5));
  // Where the terrain cannot say, the sea's level.
  const unknown = gridHeights(drapeGrid([0.5, 0.3, 0.51, 0.31], { max: 2 }), () => {
    throw new Error("no tile");
  });
  assert.deepEqual([...unknown], new Array(9).fill(0));
});

test("the terrain read from the map: its own LngLat, its finest tiles, its exaggeration in the key", () => {
  assert.equal(terrainOf(null), null);
  assert.equal(terrainOf({ getTerrain: () => null }), null);
  class LngLat {
    constructor(lng, lat) {
      this.lng = lng;
      this.lat = lat;
    }
  }
  const asked = [];
  const map = {
    getTerrain: () => ({ source: "terrain-source", exaggeration: 7.5 }),
    getCenter: () => new LngLat(44, 38),
    getSource: (id) => (id === "terrain-source" ? { maxzoom: 5, tileSize: 256 } : null),
    terrain: {
      exaggeration: 7.5,
      tileManager: { deltaZoom: 1 },
      getElevationForLngLatZoom: (lngLat, zoom) => {
        asked.push([lngLat, zoom]);
        return 1200;
      },
    },
  };
  const terrain = terrainOf(map);
  assert.equal(terrain.key, "terrain-source|7.5");
  assert.equal(terrain.cell, 1 / (32 * 256));
  assert.equal(terrain.sample(45, 39), 1200);
  assert.ok(asked[0][0] instanceof LngLat);
  assert.deepEqual([asked[0][0].lng, asked[0][0].lat, asked[0][1]], [45, 39, 6]);
});

const terrainMap = () => {
  const handlers = new Map();
  let repaints = 0;
  const map = {
    getTerrain: () => ({ source: "terrain-source" }),
    on: (type, handler) => handlers.set(type, handler),
    off: (type, handler) => {
      if (handlers.get(type) === handler) handlers.delete(type);
    },
    triggerRepaint: () => {
      repaints += 1;
    },
  };
  return { map, handlers, repaints: () => repaints };
};

test("the heights are read once, again when the terrain has more of them, and no more often than the wait", async () => {
  const { map, handlers, repaints } = terrainMap();
  let time = 1000;
  let reads = 0;
  const terrain = { key: "t|1", cell: 0, sample: () => (reads += 1) };
  const heights = createTerrainHeights(map, { now: () => time, read: () => terrain, throttleMs: 400, maxSteps: 2 });
  const bounds = [0.5, 0.3, 0.52, 0.32];
  const first = heights.heights("a", bounds);
  assert.equal(reads, 9);
  const version = first.version;
  assert.equal(heights.heights("a", bounds).version, version, "nothing new, nothing read");
  assert.equal(reads, 9);
  // Another source's tile tells nothing.
  handlers.get("sourcedata")({ sourceId: "regions-source", tile: {} });
  assert.equal(heights.heights("a", bounds).version, version);
  // A terrain tile has come: read again, but not before the wait is over.
  handlers.get("sourcedata")({ sourceId: "terrain-source", tile: {} });
  time += 100;
  assert.equal(heights.heights("a", bounds).version, version);
  assert.equal(reads, 9);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(repaints(), 1, "the map is asked to draw again once the wait is over");
  time += 300;
  const later = heights.heights("a", bounds);
  assert.notEqual(later.version, version);
  assert.equal(reads, 18);
  assert.equal(later.grid, first.grid, "the same grid: the cut regions stand");
  // Another exaggeration is read at once.
  terrain.key = "t|2";
  assert.notEqual(heights.heights("a", bounds).version, later.version);
  assert.equal(reads, 27);
  // Off: nothing.
  assert.equal(heights.heights("a", bounds, null), null);
  heights.keep(new Set());
  heights.dispose();
  assert.equal(handlers.size, 0, "a removed layer no longer listens");
});

test("the ground draws into the terrain's tiles; the bare map put back under it, drawn on the screen, is lifted", () => {
  const ground = read("./frontGroundLayer.js");
  assert.ok(ground.includes("renderToTerrainTile(gl, { tileID, width } = {}) {"));
  assert.ok(ground.includes("get terrainTileRevision() {"));
  assert.ok(!ground.includes("a_height"), "drawn into the tiles, it needs no height of its own");
  const put = read("./frontBasemapLayer.js");
  assert.ok(put.includes("in float a_height;"));
  assert.ok(put.includes("gl_Position = projectTileWithElevation(a_pos + vec2(u_world, 0.0), a_height);"));
  assert.ok(put.includes("liftToMetres(main, fallback, shaderData.variantName, this._map?.getCenter?.()?.lat);"));
  assert.ok(put.includes("this._heights = createTerrainHeights(map);") && put.includes("this._heights?.dispose();"));
  assert.ok(!put.includes("renderToTerrainTile"), "it is made from a copy of the screen");
});
