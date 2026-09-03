import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");
const world = fs.readFileSync(path.resolve(here, "../src/Game/Map/World.jsx"), "utf8");
const store = fs.readFileSync(path.resolve(here, "../src/Game/Map/useWorldState.js"), "utf8");
const trace = fs.readFileSync(path.resolve(here, "../src/runtime/mapPerfTrace.js"), "utf8");

test("R5.4.6 uses bounded renderer confirmation instead of theoretical warp ownership", () => {
  assert.doesNotMatch(nations, /expectedWarpOwnerList|inspectRenderedWarps|renderedWarpOwners/);
  assert.match(nations, /renderConfirmedCurveOwners/);
  assert.match(nations, /queryRenderedFeatures\(\{ layers: curveLayers \}\)/);
  assert.match(nations, /"country-line-labels-live-world"/);
  assert.match(nations, /"country-line-labels-live-detail"/);
});

test("R5.3 does not mount an unused DEM source", () => {
  assert.doesNotMatch(world, /"terrain-source"\s*:\s*\{/);
  assert.doesNotMatch(world, /TERRAIN_TILE_TEMPLATE\s*,/);
  assert.match(world, /const terrain = null/);
});

test("R5.3 map instrumentation binds directly to MapLibre instance", () => {
  assert.match(world, /mapInstance\.on\?\.\("sourcedata"/);
  assert.match(world, /mapInstance\.on\?\.\("styledata"/);
  assert.doesNotMatch(world, /map\?\.getMap\?\.\(\)\?\.on/);
});

test("R5.3 preserves freeze forensics and world-store traces", () => {
  assert.match(trace, /__OH_LAST_MAP_FREEZE__/);
  assert.match(trace, /__OH_MAP_TRACE__/);
  assert.match(world, /recordMapFreeze/);
  assert.match(store, /world-store:publish/);
});
