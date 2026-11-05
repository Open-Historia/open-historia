// Run: node --test src/Game/Map/terrainCaches.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { asFloat32Matrix, attachTerrainCaches, drapeView } from "./terrainCaches.js";

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

// A map with its terrain's drapes, as MapLibre lays them out.
const drapedMap = ({ size = 30, tiles = 2 } = {}) => {
  const base = fakeMap();
  const renderbuffers = [];
  let transitions = false;
  const managers = {};
  const style = {
    tileManagers: managers,
    hasTransitions: () => transitions,
    _layers: {},
    listeners: [],
    on(name, listener) { this.listeners.push(listener); },
    off(name, listener) { this.listeners = this.listeners.filter((other) => other !== listener); },
    fire(event) { for (const listener of this.listeners) listener(event); },
  };
  const context = { createRenderbuffer() { const made = { id: renderbuffers.length }; renderbuffers.push(made); return made; } };
  const pool = {
    _context: context,
    _size: size,
    _objects: [],
    _recentlyUsed: [],
    _createObject(id) { return { id, stamp: -1, inUse: false, depth: this._context.createRenderbuffer() }; },
    getOrCreateFreeObject() { throw new Error("MapLibre's own was kept"); },
  };
  const screen = Array.from({ length: tiles }, () => ({ rtt: [] }));
  const transform = { zoom: 4, bearingInRadians: 0, pitch: 0, width: 800, height: 600, getPixelScale: () => 1 };
  const painter = {
    transform,
    renderToTexture: { pool, _renderableTiles: screen, prepared: 0, prepareForRender() { this.prepared += 1; } },
  };
  let frees = 0;
  base.terrain.options = { source: "terrain-source" };
  base.terrain.tileManager.freeRtt = (tileID) => { frees += 1; return tileID; };
  const seen = [];
  const listener = (event) => seen.push(event);
  style.on("data", listener);
  Object.assign(base, { painter, style, _terrainDataCallback: listener });
  return {
    map: base,
    pool,
    screen,
    transform,
    style,
    seen,
    renderbuffers,
    managers,
    frame: () => {
      frees = 0;
      painter.renderToTexture.prepareForRender(style, transform.zoom);
      return frees;
    },
    setTransitions: (value) => { transitions = value; },
  };
};

// Takes a slot as MapLibre's stack loop does, and stamps it to a tile.
const paint = (pool, tile, stack, stamp) => {
  const slot = pool.getOrCreateFreeObject();
  slot.inUse = true;
  slot.stamp = stamp;
  pool._recentlyUsed = pool._recentlyUsed.filter((id) => id !== slot.id).concat(slot.id);
  tile.rtt[stack] = { id: slot.id, stamp };
  return slot;
};
const endStack = (pool) => { for (const slot of pool._objects) slot.inUse = false; };

// With two stacks every slot was overwritten by the next stack: nothing survived to the next frame.
test("a stack leaves the drapes of the stack before it where they are", () => {
  const { map, pool, screen } = drapedMap();
  attachTerrainCaches(map);
  const first = screen.map((tile, index) => paint(pool, tile, 0, index + 1));
  endStack(pool);
  const second = screen.map((tile, index) => paint(pool, tile, 1, index + 10));
  assert.equal(pool._objects.length, 4);
  for (const slot of second) assert.ok(!first.includes(slot));
});

test("a slot whose tile has left the screen is used before a new one is made", () => {
  const { map, pool, screen } = drapedMap();
  attachTerrainCaches(map);
  screen.forEach((tile, index) => paint(pool, tile, 0, index + 1));
  endStack(pool);
  screen[0].rtt = [];
  assert.equal(pool.getOrCreateFreeObject().id, 0);
  assert.equal(pool._objects.length, 2);
});

test("a stale stamp does not hold a slot", () => {
  const { map, pool, screen } = drapedMap();
  attachTerrainCaches(map);
  paint(pool, screen[0], 0, 1);
  endStack(pool);
  screen[0].rtt[0].stamp = 99;
  assert.equal(pool.getOrCreateFreeObject().id, 0);
});

// A cycle through more drapes than slots loses every one of them to an oldest-first pick.
test("with no slot to spare the newest is given up, so the rest stay", () => {
  const { map, pool, screen } = drapedMap({ tiles: 3 });
  attachTerrainCaches(map);
  pool._size = 2;
  paint(pool, screen[0], 0, 1);
  paint(pool, screen[1], 0, 2);
  endStack(pool);
  assert.equal(pool.getOrCreateFreeObject().id, 1);
  pool._objects.forEach((slot) => { slot.inUse = true; });
  assert.throws(() => pool.getOrCreateFreeObject());
});

test("there is room for every stack of a full screen, and the slots share one depth and stencil buffer", () => {
  const { map, pool, renderbuffers } = drapedMap();
  attachTerrainCaches(map);
  assert.ok(pool._size >= 48);
  const slots = [pool._createObject(0), pool._createObject(1), pool._createObject(2)];
  assert.equal(renderbuffers.length, 1);
  assert.equal(slots[0].depth, slots[2].depth);
  assert.equal(Object.hasOwn(pool._context, "createRenderbuffer"), false, "put back after each slot");
});

test("drapes last while the camera only pans", () => {
  const { map, frame, transform } = drapedMap();
  attachTerrainCaches(map);
  frame();
  transform.center = { lng: 30, lat: 10 };
  assert.equal(frame(), 0);
  assert.equal(frame(), 0);
});

// Each of these was seen on screen when left out: line widths at a stale zoom, the hillshade's light at a stale bearing.
for (const [what, change] of [
  ["zoom", (transform) => { transform.zoom = 4.01; }],
  ["bearing", (transform) => { transform.bearingInRadians = 0.1; }],
  ["pitch", (transform) => { transform.pitch = 30; }],
  ["the globe's pixel scale", (transform) => { transform.getPixelScale = () => 1.4; }],
  ["the map's width", (transform) => { transform.width = 801; }],
  ["the map's height", (transform) => { transform.height = 601; }],
]) {
  test(`drapes are painted again when ${what} changes`, () => {
    const { map, frame, transform } = drapedMap();
    attachTerrainCaches(map);
    frame();
    change(transform);
    assert.equal(frame(), 1);
    assert.equal(frame(), 0);
  });
}

test("the view is told apart by each thing a drape hangs on", () => {
  const view = { zoom: 1, bearingInRadians: 2, pitch: 3, width: 4, height: 5, getPixelScale: () => 6 };
  assert.equal(drapeView(view), "1,2,3,6,4,5");
  assert.doesNotThrow(() => drapeView({ zoom: 1 }));
});

test("drapes last one frame while anything eases, and are painted once more after it ends", () => {
  const { map, frame, setTransitions } = drapedMap();
  attachTerrainCaches(map);
  frame();
  setTransitions(true);
  assert.equal(frame(), 1);
  assert.equal(frame(), 1);
  setTransitions(false);
  assert.equal(frame(), 1, "pause() takes the picture up once more as it stops");
  assert.equal(frame(), 0);
});

// MapLibre's CanvasSource says type "image": a test for "canvas" never matched, and pictures went stale.
const pictureSource = () => ({
  type: "image",
  canvas: { width: 4, height: 4 },
  width: 4,
  height: 4,
  _playing: false,
  taken: 0,
  prepare() { this.taken += 1; },
});

test("a canvas that takes up its picture with no frame in between paints the drapes again", () => {
  const { map, frame, managers } = drapedMap();
  const source = pictureSource();
  managers.front = { getSource: () => source };
  attachTerrainCaches(map);
  frame();
  assert.equal(frame(), 0);
  source._playing = true;
  source.prepare();
  source._playing = false;
  assert.equal(source.taken, 1);
  assert.equal(frame(), 1);
  assert.equal(frame(), 0);
});

test("a resized canvas paints the drapes again, an unchanged one does not, and other sources are left alone", () => {
  const { map, frame, managers } = drapedMap();
  const source = pictureSource();
  const other = { type: "geojson", prepare() {} };
  const prepare = other.prepare;
  managers.front = { getSource: () => source };
  managers.other = { getSource: () => other };
  attachTerrainCaches(map);
  frame();
  assert.equal(other.prepare, prepare);
  source.prepare();
  assert.equal(frame(), 0);
  source.canvas.width = 8;
  source.prepare();
  assert.equal(frame(), 1);
});

test("a tile of a source that is not draped reaches no drape, and every other event does", () => {
  const { map, style, seen } = drapedMap();
  style._layers = {
    land: { type: "fill", source: "regions" },
    names: { type: "symbol", source: "cities" },
    units: { type: "circle", source: "units" },
    terrainless: { type: "hillshade", source: "hills" },
  };
  attachTerrainCaches(map);
  const tile = { tileID: {} };
  style.fire({ dataType: "source", sourceId: "cities", tile });
  style.fire({ dataType: "source", sourceId: "units", tile });
  assert.equal(seen.length, 0);
  for (const sourceId of ["regions", "hills", "terrain-source"]) style.fire({ dataType: "source", sourceId, tile });
  style.fire({ dataType: "style" });
  style.fire({ dataType: "source", sourceId: "cities" });
  assert.equal(seen.length, 5);
  assert.equal(style.listeners.length, 1, "in place of MapLibre's listener");
  assert.equal(style.listeners[0], map._terrainDataCallback, "so removing terrain removes it");
});

// backfillDEM rewrites the neighbours' borders: left out, a line of stale hillshade ran along tile edges.
test("an elevation tile frees every drape, not only its own", () => {
  const { map, style, seen, frame } = drapedMap();
  style._layers = { hills: { type: "hillshade", source: "terrain-source" } };
  let all = 0;
  map.terrain.tileManager.freeRtt = (tileID) => { if (tileID === undefined) all += 1; };
  attachTerrainCaches(map);
  frame();
  all = 0;
  style.fire({ dataType: "source", sourceId: "terrain-source", source: { type: "raster-dem" }, tile: { tileID: {} } });
  assert.equal(all, 1);
  assert.equal(seen.length, 1, "after MapLibre's own listener");
  style.fire({ dataType: "source", sourceId: "terrain-source", source: { type: "raster-dem" } });
  assert.equal(all, 1, "only for a tile");
});

test("other tiles free no more than they did", () => {
  const { map, style } = drapedMap();
  style._layers = { land: { type: "fill", source: "regions" } };
  let all = 0;
  map.terrain.tileManager.freeRtt = (tileID) => { if (tileID === undefined) all += 1; };
  attachTerrainCaches(map);
  style.fire({ dataType: "source", sourceId: "regions", source: { type: "geojson" }, tile: { tileID: {} } });
  assert.equal(all, 0);
});

test("a pool that no longer keeps its lists is left to MapLibre", () => {
  const { map, pool } = drapedMap();
  delete pool._recentlyUsed;
  const own = pool.getOrCreateFreeObject;
  attachTerrainCaches(map);
  assert.equal(pool.getOrCreateFreeObject, own);
  assert.equal(pool._size, 30);
});

// On an upgrade: if this fails the map still works, and has lost this speed. Look at what took their place.
test("the MapLibre this game ships has what the caches rely on", () => {
  const library = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl.js", import.meta.url), "utf8");
  const names = [
    "getTerrainCoords", "_renderableTilesKeys", "getTerrainData", "renderToTexture", "prepareForRender", "getOrCreateFreeObject",
    "_createObject", "_recentlyUsed", "_objects", "_size", "createRenderbuffer", "freeRtt", "hasTransitions", "getPixelScale",
    "bearingInRadians", "_terrainDataCallback", "_playing", "_renderableTiles",
  ];
  for (const name of names) assert.ok(library.includes(name), name);
  const dem = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/src/tile/tile_manager_raster_dem.ts", import.meta.url), "utf8");
  assert.ok(dem.includes("tile.needsHillshadePrepare = true;"), "a neighbour's hillshade is still redone in place");
});

// A drape is told from the view above; a new layer type here would be painted into drapes unwatched.
test("the layer types kept in drapes are the ones MapLibre paints into them", () => {
  const source = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/src/render/render_to_texture.ts", import.meta.url), "utf8");
  const table = source.match(/LAYERS_TO_TEXTURES[^=]*= \{([^}]*)\}/)?.[1] ?? "";
  const types = [...table.matchAll(/'?([a-z-]+)'?: true/g)].map((match) => match[1]).sort();
  assert.deepEqual(types, ["background", "color-relief", "fill", "hillshade", "line", "raster"]);
});

test("the map attaches them to every instance, as it does its gestures", () => {
  const world = fs.readFileSync(new URL("./World.jsx", import.meta.url), "utf8");
  assert.ok(world.includes("const detachCaches = attachTerrainCaches(mapInstance);"));
  assert.ok(world.includes("const detachMasks = attachClippingMasks(mapInstance);"));
});
