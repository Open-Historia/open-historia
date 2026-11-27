import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";
import { get as getProjection } from "ol/proj.js";
import { regionMoveInteractions } from "./regionMoveInteractions.js";

const square = (id, x) => {
  const f = new Feature({ geometry: new Polygon([[
    [x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0],
  ]]) });
  f.setId(id);
  return f;
};

const eventFor = (hit, layer, coordinate) => {
  const map = {
    forEachFeatureAtPixel: (_pixel, cb, options = {}) => options.layerFilter?.(layer) === false ? undefined : cb(hit, layer),
    getViewport: () => ({ classList: { add() {}, remove() {} } }),
    getView: () => ({ getProjection: () => getProjection("EPSG:3857") }),
  };
  return { map, pixel: [0, 0], coordinate, originalEvent: {} };
};

test("actual OpenLayers Translate processes a selected polity region group in one history transaction", () => {
  const a = square("LV.1", 0);
  const b = square("LV.2", 10);
  const c = square("EE.1", 20);
  const source = new VectorSource({ features: [a, b, c] });
  const layer = {};
  const steps = [];
  let updates = 0;
  const [single, group] = regionMoveInteractions({
    source, layer, selectionIds: ["LV.1", "LV.2"],
    selectedIdsRef: { current: new Set(["LV.1", "LV.2"]) },
    onStep: (cmd) => steps.push(cmd),
    onRegionsChanged: () => { updates += 1; },
  });
  const start = eventFor(a, layer, [5, 5]);
  assert.equal(group.handleDownEvent(start), true, "selected group claims drag start");
  assert.equal(single.handleDownEvent(start), false, "fallback ignores selected region");
  group.handleDragEvent(eventFor(a, layer, [12, 7]));
  group.handleUpEvent(eventFor(a, layer, [12, 7]));
  assert.equal(steps.length, 1);
  assert.equal(updates, 1);
  assert.deepEqual([a.getGeometry().getExtent()[0], b.getGeometry().getExtent()[0], c.getGeometry().getExtent()[0]], [7, 17, 20]);
  assert.deepEqual([a.get("edited"), b.get("edited"), c.get("edited")], [true, true, undefined]);
  steps[0].undo();
  assert.deepEqual([a.getGeometry().getExtent()[0], b.getGeometry().getExtent()[0]], [0, 10]);
  steps[0].redo();
  assert.deepEqual([a.getGeometry().getExtent()[0], b.getGeometry().getExtent()[0]], [7, 17]);
});

test("clicking an unselected region moves only it, preserving the previously selected group", () => {
  const a = square("LV.1", 0);
  const b = square("LV.2", 10);
  const c = square("EE.1", 20);
  const source = new VectorSource({ features: [a, b, c] });
  const layer = {};
  const steps = [];
  const [single, group] = regionMoveInteractions({
    source, layer, selectionIds: ["LV.1", "LV.2"],
    selectedIdsRef: { current: new Set(["LV.1", "LV.2"]) },
    onStep: (cmd) => steps.push(cmd),
  });
  const start = eventFor(c, layer, [25, 5]);
  assert.equal(group.handleDownEvent(start), false, "group cannot start on unselected region");
  assert.equal(single.handleDownEvent(start), true, "unselected region remains individually draggable");
  single.handleDragEvent(eventFor(c, layer, [27, 9]));
  single.handleUpEvent(eventFor(c, layer, [27, 9]));
  assert.equal(steps.length, 1);
  assert.deepEqual([a.getGeometry().getExtent()[0], b.getGeometry().getExtent()[0], c.getGeometry().getExtent()[0]], [0, 10, 22]);
  steps[0].undo();
  assert.equal(c.getGeometry().getExtent()[0], 20);
});
