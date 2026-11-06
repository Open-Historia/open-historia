// Run: node --test src/Game/Map/sourceCaches.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { attachSourceCaches, sharedTileZoom, tileBoxKey } from "./sourceCaches.js";

const fakeMap = (sourceIds = ["a", "b"]) => {
  const listeners = new Map();
  const zoomCalls = [];
  const boxCalls = [];
  const provider = {
    getTileBoundingVolume(tileID, wrap) {
      boxCalls.push(`${tileID.z}/${tileID.x}/${tileID.y}/${wrap}`);
      return { tileID, wrap };
    },
  };
  const transform = { getCoveringTilesDetailsProvider: () => provider };
  const manager = (id) => {
    const source = { id };
    return { getSource: () => source, getState: () => null };
  };
  const style = {
    tileManagers: Object.fromEntries(sourceIds.map((id) => [id, manager(id)])),
    sweepBody: null,
    _updateSources(givenTransform) { this.sweepBody?.(givenTransform); return "updated"; },
  };
  const map = {
    style,
    on: (name, listener) => listeners.set(name, listener),
    off: (name) => listeners.delete(name),
    setSourceTileLodParams(maxZoomLevels, ratio, sourceId) {
      map.style.tileManagers[sourceId].getSource().calculateTileZoom = (...args) => {
        zoomCalls.push(args);
        return maxZoomLevels + ratio + args[0];
      };
    },
  };
  return { map, style, transform, provider, zoomCalls, boxCalls, listeners };
};

test("tile zoom is worked out once for the same arguments, and every argument counts", () => {
  const calls = [];
  const share = sharedTileZoom((...args) => { calls.push(args); return args.reduce((sum, value) => sum + value, 0); });
  assert.equal(share(4, 1, 2, 3, 36), 46);
  assert.equal(share(4, 1, 2, 3, 36), 46);
  assert.equal(calls.length, 1);
  for (const args of [[5, 1, 2, 3, 36], [4, 9, 2, 3, 36], [4, 1, 9, 3, 36], [4, 1, 2, 9, 36], [4, 1, 2, 3, 9]]) share(...args);
  assert.equal(calls.length, 6);
  share.forget();
  share(4, 1, 2, 3, 36);
  assert.equal(calls.length, 7);
});

test("an answer of zero is kept like any other", () => {
  let calls = 0;
  const share = sharedTileZoom(() => { calls += 1; return 0; });
  assert.equal(share(1, 1, 1, 1, 1), 0);
  assert.equal(share(1, 1, 1, 1, 1), 0);
  assert.equal(calls, 1);
});

test("every source is given the one shared tile zoom, from MapLibre's own function", () => {
  const { map, style, transform, zoomCalls } = fakeMap();
  attachSourceCaches(map);
  style._updateSources(transform);
  const a = style.tileManagers.a.getSource().calculateTileZoom;
  assert.equal(a, style.tileManagers.b.getSource().calculateTileZoom);
  assert.equal(a(4, 1, 2, 3, 36), 9.314 + 3 + 4);
  a(4, 1, 2, 3, 36);
  assert.equal(zoomCalls.length, 1);
});

test("what is shared lasts one update of the sources", () => {
  const { map, style, transform, zoomCalls, boxCalls, provider } = fakeMap();
  attachSourceCaches(map);
  style.sweepBody = () => {
    const zoom = style.tileManagers.a.getSource().calculateTileZoom;
    zoom(4, 1, 2, 3, 36);
    zoom(4, 1, 2, 3, 36);
    provider.getTileBoundingVolume({ z: 3, x: 1, y: 2 }, 0, 100, { terrain: {} });
    provider.getTileBoundingVolume({ z: 3, x: 1, y: 2 }, 0, 100, { terrain: {} });
  };
  style._updateSources(transform);
  assert.equal(zoomCalls.length, 1);
  assert.equal(boxCalls.length, 1);
  style._updateSources(transform);
  assert.equal(zoomCalls.length, 2);
  assert.equal(boxCalls.length, 2);
});

test("no two tiles share a key, at any zoom or world copy kept", () => {
  const seen = new Set();
  for (let z = 0; z <= 6; z += 1) {
    const size = 2 ** z;
    for (let x = 0; x < size; x += 1) for (let y = 0; y < size; y += 1) for (const wrap of [-31, -3, -1, 0, 1, 3, 31]) {
      const key = tileBoxKey({ z, x, y }, wrap);
      assert.ok(!seen.has(key), `${z}/${x}/${y}/${wrap}`);
      seen.add(key);
    }
  }
  // The largest kept stays a whole number a double can hold exactly.
  const last = 2 ** 20 - 1;
  assert.ok(Number.isSafeInteger(tileBoxKey({ z: 20, x: last, y: last }, 31)));
  assert.notEqual(tileBoxKey({ z: 20, x: last, y: last }, 31), tileBoxKey({ z: 20, x: last - 1, y: last }, 31));
});

test("a tile past what a key holds is worked out, not kept", () => {
  assert.equal(tileBoxKey({ z: 21, x: 0, y: 0 }, 0), null);
  assert.equal(tileBoxKey({ z: 3, x: 0, y: 0 }, 32), null);
  assert.equal(tileBoxKey({ z: 3, x: 0, y: 0 }, -32), null);
  const { map, style, transform, boxCalls, provider } = fakeMap();
  attachSourceCaches(map);
  style.sweepBody = () => {
    provider.getTileBoundingVolume({ z: 21, x: 1, y: 1 }, 0, 0, { terrain: {} });
    provider.getTileBoundingVolume({ z: 21, x: 1, y: 1 }, 0, 0, { terrain: {} });
  };
  style._updateSources(transform);
  assert.equal(boxCalls.length, 2);
});

test("a tile's box is told apart by its place and its world copy", () => {
  const { map, style, transform, boxCalls, provider } = fakeMap();
  attachSourceCaches(map);
  style.sweepBody = () => {
    const options = { terrain: {} };
    for (const [tile, wrap] of [[{ z: 3, x: 1, y: 2 }, 0], [{ z: 3, x: 1, y: 2 }, 1], [{ z: 3, x: 2, y: 2 }, 0], [{ z: 3, x: 1, y: 3 }, 0], [{ z: 4, x: 1, y: 2 }, 0]]) {
      provider.getTileBoundingVolume(tile, wrap, 0, options);
    }
  };
  style._updateSources(transform);
  assert.equal(boxCalls.length, 5);
});

// The terrain's own update and other callers run between sweeps, with the camera or the elevation moved on.
test("a box is not kept outside an update of the sources, or without terrain", () => {
  const { map, style, transform, boxCalls, provider } = fakeMap();
  attachSourceCaches(map);
  style._updateSources(transform);
  provider.getTileBoundingVolume({ z: 1, x: 0, y: 0 }, 0, 0, { terrain: {} });
  provider.getTileBoundingVolume({ z: 1, x: 0, y: 0 }, 0, 0, { terrain: {} });
  assert.equal(boxCalls.length, 2);
  style.sweepBody = () => {
    provider.getTileBoundingVolume({ z: 1, x: 0, y: 0 }, 0, 0, {});
    provider.getTileBoundingVolume({ z: 1, x: 0, y: 0 }, 0, 0, {});
  };
  style._updateSources(transform);
  assert.equal(boxCalls.length, 4);
});

test("a sweep that throws leaves nothing kept", () => {
  const { map, style, transform, boxCalls, provider } = fakeMap();
  attachSourceCaches(map);
  style.sweepBody = () => { throw new Error("no"); };
  assert.throws(() => style._updateSources(transform));
  provider.getTileBoundingVolume({ z: 1, x: 0, y: 0 }, 0, 0, { terrain: {} });
  provider.getTileBoundingVolume({ z: 1, x: 0, y: 0 }, 0, 0, { terrain: {} });
  assert.equal(boxCalls.length, 2);
});

const stateOf = (map, style, transform) => {
  const applied = [];
  const state = { revision: 3, initializeTileState(tile) { applied.push(tile); } };
  style.tileManagers.a.getState = () => state;
  attachSourceCaches(map);
  style._updateSources(transform);
  return { state, applied };
};

test("a tile back from the cache with nothing changed is not read again", () => {
  const { map, style, transform } = fakeMap(["a"]);
  const { state, applied } = stateOf(map, style, transform);
  const tile = { buckets: {} };
  state.initializeTileState(tile);
  state.initializeTileState(tile);
  assert.equal(applied.length, 1);
});

test("a change of state while the tile was away is applied", () => {
  const { map, style, transform } = fakeMap(["a"]);
  const { state, applied } = stateOf(map, style, transform);
  const tile = { buckets: {} };
  state.initializeTileState(tile);
  state.revision += 1;
  state.initializeTileState(tile);
  assert.equal(applied.length, 2);
});

test("a reloaded tile has new buckets, and they are given their state", () => {
  const { map, style, transform } = fakeMap(["a"]);
  const { state, applied } = stateOf(map, style, transform);
  const tile = { buckets: {} };
  state.initializeTileState(tile);
  tile.buckets = {};
  state.initializeTileState(tile);
  assert.equal(applied.length, 2);
});

test("each tile keeps its own account", () => {
  const { map, style, transform } = fakeMap(["a"]);
  const { state, applied } = stateOf(map, style, transform);
  state.initializeTileState({ buckets: {} });
  state.initializeTileState({ buckets: {} });
  assert.equal(applied.length, 2);
});

test("a source added later is tuned, once, and a new style is too", () => {
  const { map, style, transform, listeners } = fakeMap(["a"]);
  const detach = attachSourceCaches(map);
  style._updateSources(transform);
  const applied = [];
  const state = { revision: 1, initializeTileState(tile) { applied.push(tile); } };
  const late = fakeMap(["c"]).style.tileManagers.c;
  late.getState = () => state;
  style.tileManagers.c = late;
  style._updateSources(transform);
  const tuned = state.initializeTileState;
  style._updateSources(transform);
  assert.equal(state.initializeTileState, tuned, "not wrapped twice");
  const tile = { buckets: {} };
  state.initializeTileState(tile);
  state.initializeTileState(tile);
  assert.equal(applied.length, 1);

  const next = fakeMap(["n"]);
  map.style = next.style;
  listeners.get("style.load")();
  map.style._updateSources(next.transform);
  assert.equal(typeof next.style.tileManagers.n.getSource().calculateTileZoom, "function");
  const sweep = map.style._updateSources;
  listeners.get("style.load")();
  assert.equal(map.style._updateSources, sweep, "not wrapped twice");
  detach();
  assert.equal(listeners.size, 0);
});

// Turning 3D terrain on rebuilds the style; the camera stays, and each wrap would stay with it.
test("a rebuilt style keeps the camera's boxes wrapped once", () => {
  const { map, style, transform, provider, boxCalls, listeners } = fakeMap(["a"]);
  attachSourceCaches(map);
  style._updateSources(transform);
  const tuned = provider.getTileBoundingVolume;
  const next = fakeMap(["n"]);
  map.style = next.style;
  listeners.get("style.load")();
  next.style.sweepBody = () => {
    for (let turn = 0; turn < 2; turn += 1) provider.getTileBoundingVolume({ x: 1, y: 2, z: 3 }, 0, 0, { terrain: {} });
  };
  next.style._updateSources(transform);
  assert.equal(provider.getTileBoundingVolume, tuned);
  assert.equal(boxCalls.length, 1, "and the new style's sources share them");
});

test("what MapLibre no longer has is skipped, not broken", () => {
  const transform = {};
  const source = {};
  const map = { on() {}, off() {}, style: { tileManagers: { a: { getSource: () => source } }, _updateSources: () => "updated" } };
  assert.doesNotThrow(() => attachSourceCaches(map));
  assert.equal(map.style._updateSources(transform), "updated");
  assert.equal(source.calculateTileZoom, undefined);
  assert.doesNotThrow(() => attachSourceCaches({ on() {}, off() {}, style: null }));
  assert.doesNotThrow(() => attachSourceCaches({ on() {}, off() {}, style: {} }));
});

const shipped = (file) => fs.readFileSync(new URL(`../../../node_modules/maplibre-gl/${file}`, import.meta.url), "utf8");

// On an upgrade: if this fails the map still works, and has lost this speed. Look at what took their place.
test("the MapLibre this game ships has what this relies on", () => {
  const library = shipped("dist/maplibre-gl.js");
  const names = [
    "_updateSources", "tileManagers", "getCoveringTilesDetailsProvider", "getTileBoundingVolume", "initializeTileState",
    "calculateTileZoom", "setSourceTileLodParams", "getState", "revision",
  ];
  for (const name of names) assert.ok(library.includes(name), name);
});

// Sources left to MapLibre's default get these numbers: other numbers here would load different tiles.
test("the tile zoom asked for is MapLibre's own default", () => {
  const covering = shipped("src/geo/projection/covering_tiles.ts");
  assert.match(covering, /defaultMaxZoomLevelsOnScreen = 9\.314/);
  assert.match(covering, /defaultTileCountMaxMinRatio = 3\.0/);
  const code = fs.readFileSync(new URL("./sourceCaches.js", import.meta.url), "utf8");
  assert.ok(code.includes("MAX_ZOOM_LEVELS_ON_SCREEN = 9.314"));
  assert.ok(code.includes("TILE_COUNT_MAX_MIN_RATIO = 3;"));
});

test("the map attaches them to every instance", () => {
  const world = fs.readFileSync(new URL("./World.jsx", import.meta.url), "utf8");
  assert.ok(world.includes("const detachSources = attachSourceCaches(mapInstance);"));
});
