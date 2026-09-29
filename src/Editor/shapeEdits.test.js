/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
// Run: node --test src/Editor/shapeEdits.test.js
//
// Merge, Delete border and Move reshape stock-world regions. Unless the
// survivor is marked edited, the export ships no geometry for it and the game
// keeps drawing the stock tile's shape; and an undo has to put the flag back
// with the shape.
import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";

import { captureShapes, mergeRegionFeatures, restoreShapes, trackMove } from "./shapeEdits.js";

const square = (id, x0, y0, size = 10, props = {}) => {
  const f = new Feature({
    geometry: new Polygon([[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]]]),
    ...props,
  });
  f.setId(id);
  return f;
};

test("a merge marks the surviving stock region edited and removes the others, and undo puts both back", () => {
  const a = square("ESP.1_1", 0, 0);
  const b = square("ESP.2_1", 10, 0);
  const c = square("ESP.3_1", 20, 0, 10, { edited: true });
  const source = new VectorSource({ features: [a, b, c] });
  const before = a.getGeometry().getArea();

  const cmd = mergeRegionFeatures(source, [a, b, c]);
  assert.ok(cmd);
  assert.equal(a.get("edited"), true);
  assert.equal(Math.round(a.getGeometry().getArea()), 300);
  assert.deepEqual(source.getFeatures().map((f) => f.getId()), ["ESP.1_1"]);

  cmd.undo();
  assert.equal(a.get("edited"), undefined);
  assert.equal(a.getGeometry().getArea(), before);
  assert.deepEqual(source.getFeatures().map((f) => f.getId()).sort(), ["ESP.1_1", "ESP.2_1", "ESP.3_1"]);
  assert.equal(c.get("edited"), true);

  cmd.redo();
  assert.equal(a.get("edited"), true);
  assert.equal(Math.round(a.getGeometry().getArea()), 300);
  assert.equal(source.getFeatures().length, 1);
});

test("a merge keeps an already-edited survivor's flag on undo", () => {
  const a = square("A", 0, 0, 10, { edited: true });
  const b = square("B", 10, 0);
  const source = new VectorSource({ features: [a, b] });
  const cmd = mergeRegionFeatures(source, [a, b]);
  cmd.undo();
  assert.equal(a.get("edited"), true);
});

test("a merge that cannot be computed changes nothing", () => {
  const a = square("A", 0, 0);
  const broken = square("B", 10, 0);
  broken.getGeometry().getCoordinates = () => {
    throw new Error("bad");
  };
  const source = new VectorSource({ features: [a] });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(mergeRegionFeatures(source, [a, broken]), null);
  } finally {
    console.warn = warn;
  }
  assert.equal(a.get("edited"), undefined);
  assert.equal(a.getGeometry().getArea(), 100);
  assert.equal(mergeRegionFeatures(source, [a]), null);
});

test("a move marks the moved region edited and is one undo step", () => {
  const a = square("FRA.1_1", 0, 0);
  const move = trackMove();
  move.start([a], [5, 5]);
  a.getGeometry().translate(3, 4);
  const cmd = move.end([a], [8, 9]);
  assert.ok(cmd);
  assert.equal(a.get("edited"), true);
  const moved = a.getGeometry().getCoordinates();

  cmd.undo();
  assert.equal(a.get("edited"), undefined);
  assert.deepEqual(a.getGeometry().getCoordinates()[0][0], [0, 0]);

  cmd.redo();
  assert.equal(a.get("edited"), true);
  assert.deepEqual(a.getGeometry().getCoordinates(), moved);
});

test("a click with the Move tool that moves nothing is not an edit", () => {
  const a = square("FRA.1_1", 0, 0);
  const move = trackMove();
  move.start([a], [5, 5]);
  assert.equal(move.end([a], [5, 5]), null);
  assert.equal(a.get("edited"), undefined);
  assert.equal(move.end([a], [6, 6]), null, "an end with no start records nothing");
});

test("captureShapes and restoreShapes round-trip the geometry and the flag", () => {
  const a = square("A", 0, 0);
  const rows = captureShapes([a]);
  a.getGeometry().translate(1, 1);
  a.set("edited", true);
  restoreShapes(rows);
  assert.deepEqual(a.getGeometry().getCoordinates()[0][0], [0, 0]);
  assert.equal(a.get("edited"), undefined);
});
