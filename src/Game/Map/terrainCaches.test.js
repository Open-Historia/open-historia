// Run: node --test src/Game/Map/terrainCaches.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { attachTerrainCaches } from "./terrainCaches.js";

const fakeMap = () => {
  const listeners = new Map();
  const coordCalls = [];
  const dataCalls = [];
  const tileManager = {
    _renderableTilesKeys: ["a", "b"],
    getTerrainCoords(tileID, ranges) {
      coordCalls.push(tileID.key);
      return { tile: tileID.key, ranges: ranges ?? null };
    },
  };
  const terrain = {
    tileManager,
    getTerrainData(tileID) {
      dataCalls.push(tileID.key);
      return { tile: tileID.key };
    },
  };
  return {
    terrain,
    coordCalls,
    dataCalls,
    on: (name, listener) => listeners.set(name, listener),
    off: (name) => listeners.delete(name),
    fire: (name) => listeners.get(name)?.(),
    listeners,
  };
};

test("a tile's place on the terrain is worked out once, until the terrain's tiles change", () => {
  const map = fakeMap();
  attachTerrainCaches(map);
  const manager = map.terrain.tileManager;
  const first = manager.getTerrainCoords({ key: "t1" });
  assert.equal(manager.getTerrainCoords({ key: "t1" }), first);
  manager.getTerrainCoords({ key: "t2" });
  assert.deepEqual(map.coordCalls, ["t1", "t2"]);
  // MapLibre makes the list anew every frame: the same tiles keep what is known.
  manager._renderableTilesKeys = ["a", "b"];
  assert.equal(manager.getTerrainCoords({ key: "t1" }), first);
  assert.deepEqual(map.coordCalls, ["t1", "t2"]);
  manager._renderableTilesKeys = ["a", "c"];
  assert.notEqual(manager.getTerrainCoords({ key: "t1" }), first);
  assert.deepEqual(map.coordCalls, ["t1", "t2", "t1"]);
});

test("a picture's tile ranges are never answered from what is kept", () => {
  const map = fakeMap();
  attachTerrainCaches(map);
  const manager = map.terrain.tileManager;
  const ranges = { 3: {} };
  assert.equal(manager.getTerrainCoords({ key: "t1" }, ranges).ranges, ranges);
  assert.equal(manager.getTerrainCoords({ key: "t1" }, ranges).ranges, ranges);
  assert.deepEqual(map.coordCalls, ["t1", "t1"]);
});

test("terrain data lasts one frame, and a tile arriving ends it", () => {
  const map = fakeMap();
  attachTerrainCaches(map);
  const first = map.terrain.getTerrainData({ key: "t1" });
  assert.equal(map.terrain.getTerrainData({ key: "t1" }), first);
  assert.deepEqual(map.dataCalls, ["t1"]);
  map.fire("render");
  map.terrain.getTerrainData({ key: "t1" });
  assert.deepEqual(map.dataCalls, ["t1", "t1"]);
  map.fire("sourcedata");
  map.terrain.getTerrainData({ key: "t1" });
  assert.deepEqual(map.dataCalls, ["t1", "t1", "t1"]);
});

test("new terrain is tuned once, no terrain is left alone, and detaching stops listening", () => {
  const map = fakeMap();
  const detach = attachTerrainCaches(map);
  const tuned = map.terrain.getTerrainData;
  map.fire("terrain");
  assert.equal(map.terrain.getTerrainData, tuned, "not wrapped twice");
  const next = fakeMap();
  map.terrain = next.terrain;
  map.fire("terrain");
  assert.notEqual(Object.getOwnPropertyDescriptor(next.terrain, "getTerrainData")?.value?.name, undefined);
  next.terrain.getTerrainData({ key: "t1" });
  next.terrain.getTerrainData({ key: "t1" });
  assert.deepEqual(next.dataCalls, ["t1"]);
  map.terrain = null;
  map.fire("terrain");
  map.fire("render");
  detach();
  assert.equal(map.listeners.size, 0);
  assert.doesNotThrow(() => attachTerrainCaches({ on() {}, off() {}, terrain: null }));
});

test("what MapLibre no longer has is skipped, not broken", () => {
  const listeners = new Map();
  const map = { terrain: { tileManager: {} }, on: (name, listener) => listeners.set(name, listener), off() {} };
  assert.doesNotThrow(() => attachTerrainCaches(map));
  assert.doesNotThrow(() => listeners.get("render")());
  assert.equal(map.terrain.getTerrainData, undefined);
  assert.equal(map.terrain.tileManager.getTerrainCoords, undefined);
});

// On an upgrade: if this fails the map still works, and has lost this speed. Look at what took their place.
test("the MapLibre this game ships has what the caches rely on", () => {
  const library = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl.js", import.meta.url), "utf8");
  for (const name of ["getTerrainCoords", "_renderableTilesKeys", "getTerrainData"]) assert.ok(library.includes(name), name);
});

test("the map attaches them to every instance, as it does its gestures", () => {
  const world = fs.readFileSync(new URL("./World.jsx", import.meta.url), "utf8");
  assert.ok(world.includes("detach = attachTerrainCaches(mapInstance);"));
});
