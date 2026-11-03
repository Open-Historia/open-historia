import test from "node:test";
import assert from "node:assert/strict";
import Polygon from "ol/geom/Polygon.js";

import { buildLandField, fitToImage, ringCrossesItself } from "./fitToImage.js";

// A 200 x 200 picture laid one map unit to the pixel with y up: sea (dark blue)
// west of x = 100 and land (sand) east of it, or what `colour(x)` paints. The
// land field learns its colours from the `land` regions on it.
const coastAt = 100;
const SEA = [20, 50, 110];
const SAND = [210, 190, 140];
const picture = (land, colour = (x) => (x < coastAt ? SEA : SAND)) => {
  const size = 200;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) rgba.set([...colour(x), 255], (y * size + x) * 4);
  }
  return buildLandField(rgba, size, size, [0, 0, size, size], land);
};
const square = (x1, y1, x2, y2) => new Polygon([[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]]);
// Where the region's west side crosses the line across its middle.
const westmost = (geometry, y = 100) => {
  const ring = geometry.getCoordinates()[0];
  let least = Infinity;
  for (let i = 1; i < ring.length; i += 1) {
    const [x1, y1] = ring[i - 1];
    const [x2, y2] = ring[i];
    if ((y1 - y) * (y2 - y) > 0 || y1 === y2) continue;
    least = Math.min(least, x1 + ((x2 - x1) * (y - y1)) / (y2 - y1));
  }
  return least;
};

test("a coast drawn short of the picture's shore is pulled onto it", () => {
  const land = square(92, 40, 180, 160);
  const [fitted] = fitToImage([land], { field: picture([land]), reach: 20, selected: [true] });
  const x = westmost(fitted);
  assert.ok(Math.abs(x - coastAt) <= 1.5, `the west coast lies at ${x}`);
  const ring = fitted.getCoordinates()[0];
  assert.ok(ring.every(([cx]) => cx <= 180.5), "the far side, with no shore near it, stays");
});

test("out of reach, a coast stays where it is", () => {
  const land = square(60, 40, 180, 160);
  const [fitted] = fitToImage([land], { field: picture([land]), reach: 10, selected: [true] });
  assert.equal(westmost(fitted), 60);
});

test("a sea region on the far side of the coast keeps the same border", () => {
  const land = square(92, 40, 180, 160);
  const sea = new Polygon([[[10, 40], [92, 40], [92, 160], [10, 160], [10, 40]]]);
  const [fittedLand, fittedSea] = fitToImage([land, sea], { field: picture([land]), reach: 20, selected: [true, false], water: [false, true] });
  const key = ([x, y]) => `${x},${y}`;
  const seaPoints = new Set(fittedSea.getCoordinates()[0].map(key));
  const coast = fittedLand.getCoordinates()[0].filter(([x]) => x < 120);
  assert.ok(coast.length >= 2);
  assert.deepEqual(coast.filter((point) => !seaPoints.has(key(point))), [], "every point of the land's coast is a point of the sea");
  assert.ok(Math.abs(westmost(fittedLand) - coastAt) <= 1.5);
});

test("a border between two land regions is never moved", () => {
  const west = square(40, 40, 92, 160);
  const east = square(92, 40, 180, 160);
  const [fittedWest, fittedEast] = fitToImage([west, east], { field: picture([west, east]), reach: 20, selected: [true, true] });
  assert.equal(westmost(fittedEast), 92);
  assert.ok(fittedWest.getCoordinates()[0].some(([x]) => x === 92), "the west keeps its side of it");
});

test("where a coast meets the border of two land regions, that point slides onto the shore in both", () => {
  // Two land regions, north and south, their coast drawn 8 short of the shore.
  const north = new Polygon([[[92, 100], [180, 100], [180, 160], [92, 160], [92, 100]]]);
  const south = new Polygon([[[92, 40], [180, 40], [180, 100], [92, 100], [92, 40]]]);
  const [fittedNorth, fittedSouth] = fitToImage([north, south], { field: picture([north, south]), reach: 20, selected: [true, true] });
  const meeting = (geometry) => [...new Set(geometry.getCoordinates()[0].filter(([x, y]) => y === 100 && x < 150).map(String))].map((point) => point.split(",").map(Number));
  const [[x]] = meeting(fittedNorth);
  assert.ok(Math.abs(x - coastAt) <= 1.5, `the border meets the coast at ${x}`);
  assert.deepEqual(meeting(fittedSouth), meeting(fittedNorth), "both regions have the same meeting point");
});

test("a shelf of deeper sea beyond the shore does not pull the coast out to it", () => {
  const SHALLOW = [90, 150, 210];
  const land = square(92, 40, 180, 160);
  const field = picture([land], (x) => (x < 70 ? SEA : x < coastAt ? SHALLOW : SAND));
  const [fitted] = fitToImage([land], { field, reach: 40, selected: [true] });
  assert.ok(Math.abs(westmost(fitted) - coastAt) <= 1.5, `the west coast lies at ${westmost(fitted)}`);
});

test("a sea that pales toward the shore, its palest water unseen, is still sea", () => {
  // Deep blue far out, paling to (190, 215, 240) at the shore: that pale band
  // lies inside the border drawn out to sea, where the fit learns nothing.
  const land = square(85, 20, 180, 180);
  const shade = (x) => {
    const k = Math.max(0, Math.min(1, (x - 20) / 80));
    return [Math.round(60 + 130 * k), Math.round(110 + 105 * k), Math.round(190 + 50 * k)];
  };
  const field = picture([land], (x) => (x < coastAt ? shade(x) : [240, 238, 232]));
  const [fitted] = fitToImage([land], { field, reach: 30, selected: [true] });
  assert.ok(Math.abs(westmost(fitted) - coastAt) <= 1.5, `the west coast lies at ${westmost(fitted)}`);
});

test("a river inland does not pull a coast drawn too far inland", () => {
  const RIVER = [40, 80, 160];
  const land = square(132, 40, 190, 160);
  const field = picture([land], (x) => (x < coastAt ? SEA : x === 140 ? RIVER : SAND));
  const [fitted] = fitToImage([land], { field, reach: 20, selected: [true] });
  assert.equal(westmost(fitted), 132);
});

test("a ring that crosses itself is told apart from one that does not", () => {
  assert.equal(ringCrossesItself([[0, 0], [10, 0], [10, 10], [0, 10]]), false);
  assert.equal(ringCrossesItself([[0, 0], [10, 10], [10, 0], [0, 10]]), true);
});
