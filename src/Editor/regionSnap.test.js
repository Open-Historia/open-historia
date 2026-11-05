import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import Polygon from "ol/geom/Polygon.js";
import Snap from "ol/interaction/Snap.js";
import VectorSource from "ol/source/Vector.js";
import { get as getProjection } from "ol/proj.js";

import RegionSnap, { bordersIn } from "./regionSnap.js";

const square = (x, y, size) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];
const regions = () => new VectorSource({
  features: [
    new Feature(new Polygon(square(0, 0, 100))),
    new Feature(new MultiPolygon([square(100, 0, 100), square(300, 300, 50)])),
  ],
});
const fakeMap = () => ({
  getView: () => ({ getProjection: () => getProjection("EPSG:3857"), getResolution: () => 1 }),
  getPixelFromCoordinate: (coordinate) => [...coordinate],
});
const attach = (snap, map) => {
  snap.getMap = () => map;
};

test("the region snap finds what Snap's index finds, without building one", () => {
  const source = regions();
  const map = fakeMap();
  const indexed = new Snap({ source, pixelTolerance: 10 });
  attach(indexed, map);
  for (const feature of source.getFeatures()) indexed.addFeature(feature);
  const lazy = new RegionSnap({ source, pixelTolerance: 10 });
  attach(lazy, map);
  for (const point of [[3, 4], [98, 50], [100, 97], [150, 104], [305, 302], [50, 50], [500, 500], [-6, 40]]) {
    const want = indexed.snapTo(point, point, map);
    const got = lazy.snapTo(point, point, map);
    assert.deepEqual(got && { vertex: got.vertex, pixel: got.vertexPixel }, want && { vertex: want.vertex, pixel: want.vertexPixel }, `at ${point}`);
  }
});

test("only the borders near the pointer are read, and a ring never joins the next", () => {
  const source = regions();
  const near = bordersIn(source, [95, -5, 105, 5]);
  assert.ok(near.length > 0 && near.length <= 4, `${near.length} segments`);
  for (const { segment } of bordersIn(source, [-1000, -1000, 1000, 1000])) {
    const [[ax, ay], [bx, by]] = segment;
    assert.ok(ax === bx || ay === by, `a segment runs along a square's side: ${segment}`);
  }
});
