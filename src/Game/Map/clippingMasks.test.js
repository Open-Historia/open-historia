// Run: node --test src/Game/Map/clippingMasks.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { attachClippingMasks } from "./clippingMasks.js";

const tiles = (...keys) => keys.map((key) => ({ key }));
const layer = (source, clipped = true) => ({ source, isTileClipped: () => clipped });

const fakeMap = () => {
  const listeners = new Map();
  const drawn = [];
  const painter = {
    currentStencilSource: undefined,
    context: { bindFramebuffer: { current: null } },
    _renderTileClippingMasks(forLayer, tileIDs) {
      if (this.currentStencilSource === forLayer.source || !forLayer.isTileClipped() || !tileIDs?.length) return;
      this.currentStencilSource = forLayer.source;
      drawn.push(forLayer.source);
    },
  };
  return { painter, drawn, listeners, on: (name, listener) => listeners.set(name, listener), off: (name) => listeners.delete(name) };
};

test("a source with the same tiles keeps the masks already in the stencil", () => {
  const map = fakeMap();
  attachClippingMasks(map);
  map.painter._renderTileClippingMasks(layer("a"), tiles("1", "2"), false);
  map.painter._renderTileClippingMasks(layer("b"), tiles("1", "2"), false);
  map.painter._renderTileClippingMasks(layer("c"), tiles("1", "2"), false);
  assert.deepEqual(map.drawn, ["a"]);
  assert.equal(map.painter.currentStencilSource, "c", "the next layer of c needs no masks either");
});

test("other tiles, more tiles or fewer tiles are drawn", () => {
  const map = fakeMap();
  attachClippingMasks(map);
  map.painter._renderTileClippingMasks(layer("a"), tiles("1", "2"), false);
  map.painter._renderTileClippingMasks(layer("b"), tiles("1", "3"), false);
  map.painter._renderTileClippingMasks(layer("c"), tiles("1", "3", "4"), false);
  map.painter._renderTileClippingMasks(layer("d"), tiles("1"), false);
  assert.deepEqual(map.drawn, ["a", "b", "c", "d"]);
});

// clearStencil, the raster passes and a new drape all do this.
test("masks are drawn again after anything else has used the stencil", () => {
  const map = fakeMap();
  attachClippingMasks(map);
  map.painter._renderTileClippingMasks(layer("a"), tiles("1"), false);
  map.painter.currentStencilSource = undefined;
  map.painter._renderTileClippingMasks(layer("b"), tiles("1"), false);
  assert.deepEqual(map.drawn, ["a", "b"]);
});

test("a stencil is its framebuffer's: masks are not kept across a change of target", () => {
  const map = fakeMap();
  attachClippingMasks(map);
  map.painter._renderTileClippingMasks(layer("a"), tiles("1"), false);
  map.painter.context.bindFramebuffer.current = {};
  map.painter._renderTileClippingMasks(layer("b"), tiles("1"), false);
  assert.deepEqual(map.drawn, ["a", "b"]);
});

test("masks for a drape are not the masks for the screen", () => {
  const map = fakeMap();
  attachClippingMasks(map);
  map.painter._renderTileClippingMasks(layer("a"), tiles("1"), false);
  map.painter._renderTileClippingMasks(layer("b"), tiles("1"), true);
  assert.deepEqual(map.drawn, ["a", "b"]);
});

test("a layer that is not clipped, or has no tiles, changes nothing", () => {
  const map = fakeMap();
  attachClippingMasks(map);
  map.painter._renderTileClippingMasks(layer("a"), tiles("1"), false);
  map.painter._renderTileClippingMasks(layer("b", false), tiles("1"), false);
  map.painter._renderTileClippingMasks(layer("c"), [], false);
  map.painter._renderTileClippingMasks(layer("d"), null, false);
  assert.equal(map.painter.currentStencilSource, "a");
  assert.deepEqual(map.drawn, ["a"]);
});

test("a restored context's new painter is tuned too, once, and detaching stops listening", () => {
  const map = fakeMap();
  const detach = attachClippingMasks(map);
  const tuned = map.painter._renderTileClippingMasks;
  map.listeners.get("webglcontextrestored")();
  assert.equal(map.painter._renderTileClippingMasks, tuned, "not wrapped twice");
  const next = fakeMap();
  map.painter = next.painter;
  map.listeners.get("webglcontextrestored")();
  next.painter._renderTileClippingMasks(layer("a"), tiles("1"), false);
  next.painter._renderTileClippingMasks(layer("b"), tiles("1"), false);
  assert.deepEqual(next.drawn, ["a"]);
  detach();
  assert.equal(map.listeners.size, 0);
});

test("what MapLibre no longer has is skipped, not broken", () => {
  assert.doesNotThrow(() => attachClippingMasks({ on() {}, off() {}, painter: {} }));
  assert.doesNotThrow(() => attachClippingMasks({ on() {}, off() {}, painter: null }));
});

// On an upgrade: if this fails the map still works, and draws its masks as often as it used to.
test("the MapLibre this game ships has what this relies on", () => {
  const library = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl.js", import.meta.url), "utf8");
  for (const name of ["_renderTileClippingMasks", "currentStencilSource", "isTileClipped", "bindFramebuffer"]) assert.ok(library.includes(name), name);
});

// Every other stencil write in MapLibre clears currentStencilSource. One that did not would leave these masks wrong.
test("whatever writes to the stencil in MapLibre says so", () => {
  const painter = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/src/render/painter.ts", import.meta.url), "utf8");
  const drape = fs.readFileSync(new URL("../../../node_modules/maplibre-gl/src/render/render_to_texture.ts", import.meta.url), "utf8");
  assert.ok(drape.includes("painter.currentStencilSource = undefined;"));
  for (const method of ["clearStencil() {", "stencilModeFor3D(): StencilMode {"]) {
    const start = painter.indexOf(method);
    assert.ok(start > 0, method);
    assert.ok(painter.slice(start, start + 300).includes("this.currentStencilSource = undefined;"), method);
  }
});

test("no custom layer of this game writes to the stencil", () => {
  for (const file of ["./frontBasemapLayer.js", "./frontGroundLayer.js", "./strikeCustomLayer.js", "./vnext/ownershipFloodCustomLayer.js", "./labels/polityTextCustomLayer.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/stencil(Op|Func|Mask)|STENCIL_BUFFER_BIT/.test(source), false, file);
  }
});
