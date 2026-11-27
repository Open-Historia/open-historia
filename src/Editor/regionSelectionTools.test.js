import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";
import { regionsInRectangle, selectedMoveFeatures } from "./regionSelectionTools.js";
import { trackMove } from "./shapeEdits.js";

const region = (id, x, y, w = 10, h = 10) => {
  const f = new Feature({ geometry: new Polygon([[
    [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y],
  ]]) });
  f.setId(id);
  return f;
};

test("rectangle marquee includes genuinely intersecting polygons, not just bounding-box false positives", () => {
  const included = region("Latvia.1", 10, 0);
  const neighbor = region("Latvia.2", 20, 0);
  const outside = region("Estonia.1", 50, 0);
  const source = new VectorSource({ features: [included, neighbor, outside] });
  assert.deepEqual(regionsInRectangle(source, [12, 2, 23, 8]), ["Latvia.1", "Latvia.2"]);
  assert.deepEqual(regionsInRectangle(source, [0, 20, 30, 30]), []);
});

test("Shift-marquee adds deduplicated IDs; unmodified marquee replaces the selection", () => {
  const source = new VectorSource({ features: [region("A", 0, 0), region("B", 10, 0)] });
  assert.deepEqual(regionsInRectangle(source, [11, 1, 13, 4], ["A"], true), ["A", "B"]);
  assert.deepEqual(regionsInRectangle(source, [11, 1, 13, 4], ["A"], false), ["B"]);
  assert.deepEqual(regionsInRectangle(source, [100, 100, 110, 110], ["A"], true), ["A"]);
});

test("selected Move resolves the actual canonical features and ignores stale or repeated IDs", () => {
  const a = region("Latvia.1", 0, 0);
  const b = region("Latvia.2", 10, 0);
  const source = new VectorSource({ features: [a, b] });
  assert.deepEqual(selectedMoveFeatures(source, ["Latvia.1", "Latvia.2", "Latvia.1", "Old"]), [a, b]);
  assert.deepEqual(selectedMoveFeatures(source, []), []);
});

test("moving selected neighboring regions together preserves shared borders and is one undo/redo step", () => {
  const a = region("Latvia.1", 0, 0);
  const b = region("Latvia.2", 10, 0);
  const unselected = region("Estonia.1", 20, 0);
  const source = new VectorSource({ features: [a, b, unselected] });
  const selected = selectedMoveFeatures(source, ["Latvia.1", "Latvia.2"]);
  const before = selected.map((f) => f.getGeometry().getCoordinates());
  const outsiderBefore = unselected.getGeometry().getCoordinates();
  const move = trackMove();
  move.start(selected, [3, 4]);
  selected.forEach((f) => f.getGeometry().translate(15, 8));
  const cmd = move.end(selected, [18, 12]);
  assert.ok(cmd, "one command for the entire selection");
  const after = selected.map((f) => f.getGeometry().getCoordinates());
  assert.deepEqual(a.getGeometry().getExtent()[2], b.getGeometry().getExtent()[0], "their shared border stays aligned");
  assert.deepEqual(unselected.getGeometry().getCoordinates(), outsiderBefore, "outside regions do not move");
  assert.deepEqual(selected.map((f) => f.get("edited")), [true, true]);
  cmd.undo();
  assert.deepEqual(selected.map((f) => f.getGeometry().getCoordinates()), before);
  assert.deepEqual(selected.map((f) => f.get("edited")), [undefined, undefined]);
  cmd.redo();
  assert.deepEqual(selected.map((f) => f.getGeometry().getCoordinates()), after);
  assert.deepEqual(selected.map((f) => f.get("edited")), [true, true]);
});
