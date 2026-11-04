// Run: node --test src/Game/Map/terrainCaches.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { asFloat32Matrix, attachTerrainCaches } from "./terrainCaches.js";

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

// Chrome copied a Float64Array into WebGL a number at a time: a fifth of the main thread while panning.
test("the terrain matrix goes to WebGL as 32-bit floats, and only when every number stays the same", () => {
  // As MapLibre makes it for a tile two levels under its elevation tile: 1 / (8192 << 2), and an offset of 3/4.
  const matrix = new Float64Array(16);
  matrix[0] = 1 / (8192 << 2);
  matrix[5] = 1 / (8192 << 2);
  matrix[12] = 0.75;
  matrix[13] = 0.25;
  matrix[15] = 1;
  const quick = asFloat32Matrix(matrix);
  assert.ok(quick instanceof Float32Array);
  assert.deepEqual([...quick], [...matrix]);
  // Its empty matrix is a plain array.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual([...asFloat32Matrix(identity)], identity);
  assert.ok(asFloat32Matrix(identity) instanceof Float32Array);
  // A number 32 bits cannot hold leaves the matrix as it was, so elevation read from it is unchanged.
  const fine = Float64Array.from(matrix);
  fine[12] = 0.1;
  assert.equal(asFloat32Matrix(fine), fine);
  const already = new Float32Array(16);
  assert.equal(asFloat32Matrix(already), already);
  assert.equal(asFloat32Matrix(null), null);
  assert.deepEqual(asFloat32Matrix([1, 2]), [1, 2]);

  const map = fakeMap();
  map.terrain.getTerrainData = (tileID) => ({ tile: tileID.key, u_terrain_matrix: matrix });
  attachTerrainCaches(map);
  const data = map.terrain.getTerrainData({ key: "t1" });
  assert.ok(data.u_terrain_matrix instanceof Float32Array);
  assert.equal(map.terrain.getTerrainData({ key: "t1" }).u_terrain_matrix, data.u_terrain_matrix, "made once a frame");
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
