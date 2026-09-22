// Run: node --test src/Editor/geometry.test.js
//
// polygon-clipping sweeps every segment of both inputs, so the save-time
// border cleanup's pair checks used to cost as much as the larger region: a
// coastal province against a 41,000-vertex sea zone took 85 ms, and the sweep
// asked that 4,800 times a pass. geometry.js now clips both inputs to the box
// their extents share first. These pin that the clipping is exact — the same
// pieces and areas as the whole inputs give — on shapes that cross the box and
// on the built-in map's own neighbouring pairs.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import polygonClipping from "polygon-clipping";
import GeoJSON from "ol/format/GeoJSON.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";

import { clipCoordsToBox, intersectionGeom, overlaps, planarGeometryArea, subtractFrom } from "./geometry.js";

const coordsToOl = (mp) => (mp.length === 1 ? new Polygon(mp[0]) : new MultiPolygon(mp));
const areaOfCoords = (coords) => (coords && coords.length ? planarGeometryArea(coordsToOl(coords)) : 0);
const rect = (x0, y0, x1, y1) => new Polygon([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
const close = (x, y) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
const pieceCount = (geom) => (geom ? (geom.getType() === "MultiPolygon" ? geom.getPolygons().length : 1) : 0);

test("clipping to a box keeps exactly the part inside, holes included", () => {
  const box = [100, 100, 900, 900];
  const inside = rect(200, 200, 300, 300);
  assert.deepEqual(clipCoordsToBox(inside, box), [inside.getCoordinates()], "a geometry within the box is handed over as it is");
  assert.equal(clipCoordsToBox(rect(2000, 2000, 2100, 2100), box), null, "a geometry apart from the box is nothing");
  // A U shape whose two arms leave through the box's top edge: the clipped
  // ring comes back joined along that edge, and covers the same area as
  // polygon-clipping's own intersection with the box.
  const u = new Polygon([[[0, 0], [1000, 0], [1000, 1500], [700, 1500], [700, 400], [300, 400], [300, 1500], [0, 1500], [0, 0]]]);
  const clipped = clipCoordsToBox(u, box);
  const expected = polygonClipping.intersection(u.getCoordinates(), rect(...box).getCoordinates());
  assert.ok(close(areaOfCoords(clipped), areaOfCoords(expected)), `${areaOfCoords(clipped)} vs ${areaOfCoords(expected)}`);
  assert.ok(areaOfCoords(clipped) > 0);
  // A donut whose hole crosses the box's top edge.
  const donut = new Polygon([
    [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]],
    [[400, 700], [400, 980], [600, 980], [600, 700], [400, 700]],
  ]);
  const donutBox = [50, 50, 950, 950];
  const donutClipped = clipCoordsToBox(donut, donutBox);
  const donutExpected = polygonClipping.intersection(donut.getCoordinates(), rect(...donutBox).getCoordinates());
  assert.ok(close(areaOfCoords(donutClipped), areaOfCoords(donutExpected)), `${areaOfCoords(donutClipped)} vs ${areaOfCoords(donutExpected)}`);
  assert.equal(donutClipped[0].length, 2, "the hole survives the clip");
});

test("intersections and differences agree with the unclipped answer on shapes that reach past each other's box", () => {
  // A long cross and a small square overlapping one arm.
  const cross = new MultiPolygon([
    [[[0, 450], [2000, 450], [2000, 550], [0, 550], [0, 450]]],
    [[[950, 0], [1050, 0], [1050, 1000], [950, 1000], [950, 0]]],
  ]);
  const square = rect(1500, 400, 1600, 600);
  const direct = polygonClipping.intersection(cross.getCoordinates(), square.getCoordinates());
  const local = intersectionGeom(cross, square);
  assert.ok(close(planarGeometryArea(local), areaOfCoords(direct)));
  assert.equal(planarGeometryArea(local), 100 * 100, "the square's overlap with the arm");
  assert.ok(overlaps(cross, square));
  assert.ok(!overlaps(cross, rect(3000, 3000, 3100, 3100)), "apart: no shared box, nothing to ask");
  assert.equal(intersectionGeom(cross, rect(0, 600, 100, 700)), null, "the boxes meet but the shapes do not");
  const trimmed = subtractFrom(square, cross);
  const directTrim = polygonClipping.difference(square.getCoordinates(), cross.getCoordinates());
  assert.ok(close(planarGeometryArea(trimmed), areaOfCoords(directTrim)));
  assert.equal(planarGeometryArea(trimmed), 100 * 200 - 100 * 100);
  assert.equal(subtractFrom(square, square), null, "swallowed whole");
  const untouched = subtractFrom(square, rect(3000, 3000, 3100, 3100));
  assert.ok(close(planarGeometryArea(untouched), 100 * 200), "a cutter apart from the target leaves it as it was");
});

test("on the built-in map, neighbouring pairs give the same pieces and areas as the whole inputs", () => {
  const text = fs.readFileSync(new URL("../../server/seed/default/regions.geojson", import.meta.url), "utf8");
  const features = new GeoJSON().readFeatures(JSON.parse(text), { featureProjection: "EPSG:3857" }).filter((f) => f.getGeometry());
  const source = new VectorSource({ features });
  const order = new Map(features.map((f, i) => [f, i]));
  let pairs = 0;
  let overlapping = 0;
  // Every seventh region: about 2,000 of the map's 14,011 neighbouring pairs.
  for (let i = 0; i < features.length; i += 7) {
    const a = features[i];
    for (const b of source.getFeaturesInExtent(a.getGeometry().getExtent())) {
      if (!(order.get(b) > i)) continue;
      pairs += 1;
      const name = `${a.get("name")} + ${b.get("name")}`;
      const direct = polygonClipping.intersection(a.getGeometry().getCoordinates(), b.getGeometry().getCoordinates());
      const local = intersectionGeom(a.getGeometry(), b.getGeometry());
      const directArea = areaOfCoords(direct);
      const localArea = local ? planarGeometryArea(local) : 0;
      // The clip points along the box edge move the answer by thousandths of a
      // square metre on a ~1 km region, nothing a 2 m floor can see.
      assert.ok(Math.abs(directArea - localArea) <= Math.max(0.01, 1e-6 * directArea), `${name}: ${directArea} vs ${localArea} m²`);
      assert.equal(pieceCount(local), direct?.length || 0, `${name}: pieces`);
      if (directArea > 0) {
        overlapping += 1;
        const cut = areaOfCoords(polygonClipping.difference(b.getGeometry().getCoordinates(), a.getGeometry().getCoordinates()));
        const trimmed = subtractFrom(b.getGeometry(), a.getGeometry());
        assert.ok(Math.abs(cut - (trimmed ? planarGeometryArea(trimmed) : 0)) <= Math.max(0.01, 1e-6 * cut), `${b.get("name")} minus ${a.get("name")}`);
      }
    }
  }
  assert.ok(pairs > 1500 && overlapping > 50, `${pairs} pairs, ${overlapping} overlapping`);
});
