import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";

import { FAR_DETAIL, createRegionDisplay, detailOf, regionFrame, simplifyRegion, toleranceOf } from "./regionDisplay.js";

const ZOOM0 = 156543.03392804097;
const wiggly = (x, y, size, steps, amplitude = 1) => {
  const ring = [];
  for (let i = 0; i <= steps; i += 1) ring.push([x + (size * i) / steps, y + (i % 2 ? amplitude : 0)]);
  ring.push([x + size, y + size], [x, y + size], [x, y]);
  return [ring];
};
const square = (x, y, size) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];
const settle = () => new Promise((resolve) => queueMicrotask(resolve));
const vertices = (geometry) => geometry.getFlatCoordinates().length / 2;

test("a zoom level is the whole zoom the resolution stands at, and its tolerance halves with each level", () => {
  assert.equal(detailOf(ZOOM0), 0);
  assert.equal(detailOf(ZOOM0 / 8), 3);
  assert.equal(detailOf(ZOOM0 / 11), 3);
  assert.equal(toleranceOf(2) / toleranceOf(3), 2);
  assert.equal(toleranceOf(2, 2), toleranceOf(2) / 2);
});

test("a region is simplified within the tolerance, its specks are dropped, and one that vanishes keeps a box", () => {
  const coast = new Polygon(wiggly(0, 0, 1000, 200));
  const simple = simplifyRegion(coast, 5);
  assert.ok(vertices(simple) < 10, `kept ${vertices(simple)}`);
  assert.deepEqual(simple.getExtent().map(Math.round), [0, 0, 1000, 1000]);

  const holed = new Polygon([...square(0, 0, 1000), [[500, 500], [501, 500], [501, 501], [500, 501], [500, 500]]]);
  assert.equal(simplifyRegion(holed, 5).getLinearRingCount(), 1);

  const islands = new MultiPolygon([square(0, 0, 1000), square(5000, 5000, 1)]);
  const kept = simplifyRegion(islands, 5);
  assert.deepEqual(kept.getPolygons().map((polygon) => polygon.getExtent()), [[0, 0, 1000, 1000]]);

  const speck = simplifyRegion(new Polygon(square(10, 10, 1)), 5);
  assert.equal(speck.getType(), "Polygon");
  assert.deepEqual(speck.getExtent(), [10, 10, 11, 11]);
});

test("islands too small to draw leave one speck where the first lies, never a box over the sea between them", () => {
  const scattered = new MultiPolygon([square(-20000000, -2000000, 3), square(0, -2100000, 2), square(19000000, -1900000, 4)]);
  const drawn = simplifyRegion(scattered, 1000);
  assert.deepEqual(drawn.getPolygons().map((polygon) => polygon.getExtent()), [[-20000000, -2000000, -19999997, -1999997]]);
  const lone = simplifyRegion(new Polygon(square(170, 20, 3)), 1000);
  assert.deepEqual(lone.getExtent(), [170, 20, 173, 23]);
});

test("every region has a drawn copy; near the view it is detailed, far away it is coarse", async () => {
  const near = new Feature({ geometry: new Polygon(wiggly(0, 0, 100000, 4000, 500)), owner: "A" });
  const far = new Feature({ geometry: new Polygon(wiggly(9000000, 0, 100000, 4000, 500)), owner: "B" });
  const regions = new VectorSource({ features: [near, far] });
  const display = createRegionDisplay({ regionSource: regions });
  await settle();
  assert.equal(display.source.getFeatures().length, 2);
  for (const copy of display.source.getFeatures()) assert.ok(copy.getGeometry() !== display.originalOf(copy).getGeometry());

  assert.equal(display.setView(ZOOM0 / 2 ** 12, [-50000, -50000, 150000, 150000]), true);
  display.drain();
  assert.equal(display.levelOf(near), 12);
  assert.equal(display.levelOf(far), FAR_DETAIL);
  const copyOf = (original) => display.source.getFeatures().find((copy) => display.originalOf(copy) === original);
  assert.ok(vertices(copyOf(near).getGeometry()) > vertices(copyOf(far).getGeometry()));

  assert.equal(display.setView(ZOOM0 / 2 ** 12, [-40000, -40000, 140000, 140000]), false, "a view inside the detailed stretch changes nothing");
});

test("an edited, re-owned, removed or cleared region is followed by its copy", async () => {
  const region = new Feature({ geometry: new Polygon(square(0, 0, 1000)), owner: "A" });
  const regions = new VectorSource({ features: [region] });
  const display = createRegionDisplay({ regionSource: regions });
  await settle();
  display.setView(ZOOM0 / 2 ** 10, [-2000, -2000, 2000, 2000]);
  display.drain();
  const copy = display.source.getFeatures()[0];

  let changes = 0;
  display.source.on("changefeature", () => { changes += 1; });
  region.getGeometry().setCoordinates(square(0, 0, 2000));
  assert.deepEqual(copy.getGeometry().getExtent(), [0, 0, 2000, 2000]);
  region.set("owner", "B");
  assert.ok(changes >= 2, `${changes} changes`);

  const added = new Feature({ geometry: new Polygon(square(5000, 5000, 1000)) });
  regions.addFeature(added);
  await settle();
  assert.equal(display.source.getFeatures().length, 2);
  regions.removeFeature(added);
  assert.equal(display.source.getFeatures().length, 1);
  regions.clear(true);
  assert.equal(display.source.getFeatures().length, 0);
});

test("a new zoom redraws the regions a slice per frame, nearest the view first", async () => {
  const at = (x) => new Feature({ geometry: new Polygon(wiggly(x, 0, 100000, 4000, 500)) });
  const regions = [at(4000000), at(0), at(2000000)];
  const frames = [];
  const display = createRegionDisplay({ regionSource: new VectorSource({ features: regions }), sliceMs: 0, schedule: (fn) => frames.push(fn) });
  await settle();
  const coarse = new Map(regions.map((region) => [region, vertices(display.source.getFeatures().find((copy) => display.originalOf(copy) === region).getGeometry())]));
  const detailed = (region) => vertices(display.source.getFeatures().find((copy) => display.originalOf(copy) === region).getGeometry()) > coarse.get(region);

  display.setView(ZOOM0 / 2 ** 12, [-10000000, -50000, 10000000, 150000]);
  assert.equal(frames.length, 1);
  assert.deepEqual(regions.map(detailed), [false, false, false], "nothing is redrawn before the first frame");
  frames.shift()();
  assert.deepEqual(regions.map(detailed), [false, true, false]);
  frames.shift()();
  assert.deepEqual(regions.map(detailed), [false, true, true]);
  frames.shift()();
  assert.deepEqual(regions.map(detailed), [true, true, true]);
  assert.equal(frames.length, 0);
});

test("regions changed while the view moves are drawn once it stops, not held off", () => {
  // The Workshop's conversion of a map's projection moves every region and at
  // once fits the view to them (an animation): the GPU layer kept drawing the
  // regions where they had been (Avatar: Resurrection, Mercator to
  // equirectangular, 2026-11-03).
  const frame = (over) => regionFrame({ ready: true, hasBuffers: true, still: true, seenRevision: 10, sourceRevision: 10, builtAt: 1000, resolution: 1000, hasExtent: true, ...over });
  assert.equal(frame({ still: false, sourceRevision: 11 }), "wait", "a change seen on a moving frame is not counted as built");
  assert.equal(frame({ sourceRevision: 11 }), "mark", "the view stopped: built");
  assert.equal(frame({}), "hold", "nothing changed: a pan does not rebuild");
  assert.equal(frame({ still: false }), "hold");
  assert.equal(frame({ resolution: 1000 * 2 ** 5 }), "mark", "zoomed far out: rebuilt");
  assert.equal(frame({ ready: false }), "wait", "a build in flight");
  assert.equal(frame({ hasBuffers: false, ready: false }), "mark", "the first build");
  assert.equal(frame({ hasBuffers: false, still: false }), "pass");
});

test("the GPU region layer decides its frames by regionFrame", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  assert.match(source, /const frame = regionFrame\(\{/);
  assert.match(source, /if \(frame === "wait"\) return true;/);
});
