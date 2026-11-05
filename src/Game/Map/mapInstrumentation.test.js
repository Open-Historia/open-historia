import test from "node:test";
import assert from "node:assert/strict";
import { attachMapInstrumentation, isBasemapTileLoading } from "./mapInstrumentation.js";
import { clearMapTrace, getMapTrace } from "../../runtime/mapPerfTrace.js";

const fakeMap = () => {
  const handlers = new Map();
  return {
    _removed: false,
    handlers,
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    off(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    fire(type, event = {}) {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
    count() {
      let total = 0;
      for (const set of handlers.values()) total += set.size;
      return total;
    },
    getZoom: () => 4,
  };
};

const fakeCanvas = () => {
  const handlers = new Map();
  return {
    isConnected: true,
    handlers,
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
  };
};

const freshPerf = () => ({
  active: false,
  sourceEvents: 0,
  sourceLoads: 0,
  sourceLoaded: 0,
  dataEvents: 0,
  styleEvents: 0,
  styleLoadingEvents: 0,
  webglLosses: 0,
  renders: 0,
  idles: 0,
  zoomStarts: 0,
  zoomEnds: 0,
});

test("without the debug switch only the WebGL context listeners are attached", () => {
  const map = fakeMap();
  const canvas = fakeCanvas();
  const detach = attachMapInstrumentation({ map, canvas, perf: freshPerf(), verbose: false });
  assert.equal(map.count(), 0);
  assert.equal(canvas.handlers.get("webglcontextlost").size, 1);
  assert.equal(canvas.handlers.get("webglcontextrestored").size, 1);
  detach();
  assert.equal(canvas.handlers.get("webglcontextlost").size, 0);
  assert.equal(canvas.handlers.get("webglcontextrestored").size, 0);
});

test("with the debug switch the per-event listeners count a sampled pan and all come off again", () => {
  const map = fakeMap();
  const canvas = fakeCanvas();
  const perf = freshPerf();
  const loaded = [];
  const detach = attachMapInstrumentation({
    map,
    canvas,
    perf,
    verbose: true,
    onSourceLoaded: (id) => loaded.push(id),
  });
  assert.ok(map.count() >= 8);
  map.fire("render");
  assert.equal(perf.renders, 0, "counters stay still while no pan is sampled");
  perf.active = true;
  map.fire("render");
  map.fire("sourcedata", { sourceId: "satellite", sourceDataType: "content", isSourceLoaded: true });
  assert.equal(perf.renders, 1);
  assert.equal(perf.sourceEvents, 1);
  assert.equal(perf.sourceLoads, 1);
  assert.equal(perf.sourceLoaded, 1);
  assert.deepEqual(loaded, ["satellite"]);
  detach();
  assert.equal(map.count(), 0);
});

test("each sourcedata event is traced once", () => {
  clearMapTrace();
  const map = fakeMap();
  const detach = attachMapInstrumentation({ map, canvas: fakeCanvas(), perf: freshPerf(), verbose: true });
  map.fire("sourcedata", { sourceId: "regions-source", sourceDataType: "content" });
  const sourceEntries = getMapTrace().filter((entry) => entry.detail?.sourceId === "regions-source");
  assert.equal(sourceEntries.length, 1);
  detach();
});

test("a lost context is logged as lost, but a removed map's own teardown is not", async () => {
  clearMapTrace();
  const map = fakeMap();
  const canvas = fakeCanvas();
  const perf = freshPerf();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const detach = attachMapInstrumentation({ map, canvas, perf });
    canvas.dispatch("webglcontextlost", { statusMessage: "gpu reset" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    map._removed = true;
    canvas.dispatch("webglcontextlost", {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    canvas.dispatch("webglcontextrestored", {});
    const types = getMapTrace().map((entry) => entry.type);
    assert.ok(types.includes("gpu:webgl-lost"));
    assert.ok(types.includes("gpu:webgl-released"));
    assert.ok(types.includes("gpu:webgl-restored"));
    detach();
  } finally {
    console.warn = warn;
  }
});

test("the loading toast hears basemap tile loads only", () => {
  const map = fakeMap();
  const heard = [];
  const ids = new Set(["satellite", "satellite-lowres", "pax-world-relief"]);
  const detach = attachMapInstrumentation({
    map,
    canvas: fakeCanvas(),
    perf: freshPerf(),
    onBasemapTileLoading: (event) => heard.push(event.sourceId),
    basemapSourceIds: () => ids,
  });
  map.fire("sourcedataloading", { dataType: "source", sourceId: "satellite", tile: {} });
  map.fire("sourcedataloading", { dataType: "source", sourceId: "custom-regions-source", tile: {} });
  map.fire("sourcedataloading", { dataType: "source", sourceId: "satellite" });
  assert.deepEqual(heard, ["satellite"]);
  detach();
  assert.equal(map.count(), 0);
});

test("isBasemapTileLoading needs a tile from one of the style's own sources", () => {
  const ids = new Set(["satellite"]);
  assert.equal(isBasemapTileLoading({ dataType: "source", sourceId: "satellite", tile: {} }, ids), true);
  assert.equal(isBasemapTileLoading({ dataType: "source", sourceId: "satellite" }, ids), false);
  assert.equal(isBasemapTileLoading({ dataType: "source", sourceId: "units-source", tile: {} }, ids), false);
  assert.equal(isBasemapTileLoading({ dataType: "style", sourceId: "satellite", tile: {} }, ids), false);
  assert.equal(isBasemapTileLoading({ dataType: "source", sourceId: "satellite", tile: {} }, null), false);
});
