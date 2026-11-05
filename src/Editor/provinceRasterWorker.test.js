import test from "node:test";
import assert from "node:assert/strict";
import { vectorizeColorGrid } from "./provinceRasterWorker.js";

const RED = 0xff0000;
const GREEN = 0x00ff00;
const BLUE = 0x0000ff;

// Rows of colours (top row first) -> the importer's inputs. With bounds equal
// to the pixel size, a pixel corner (x, y) lands on lon x, lat height - y, so
// expected coordinates can be read straight off the grid.
const grid = (rows) => {
  const height = rows.length;
  const width = rows[0].length;
  return { width, height, colors: Int32Array.from(rows.flat()), bounds: { west: 0, east: width, north: height, south: 0 } };
};
const run = (rows, options = {}) => {
  const g = grid(rows);
  return vectorizeColorGrid(g.width, g.height, g.colors, { bounds: g.bounds, ...options });
};
const byColor = (fc, color) => fc.features.find((f) => f.properties.sourceColor === `#${color.toString(16).padStart(6, "0").toUpperCase()}`);
const polygonsOf = (geometry) => (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates);
const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
};
// Filled area: each outer ring minus its holes.
const areaOf = (geometry) =>
  polygonsOf(geometry).reduce((sum, [outer, ...holes]) => sum + Math.abs(ringArea(outer)) - holes.reduce((h, ring) => h + Math.abs(ringArea(ring)), 0), 0);
const vertexSet = (geometry) => new Set(polygonsOf(geometry).flat(2).map(([x, y]) => `${x},${y}`));

test("a 4x3 two-colour grid gives two regions whose shared border has identical vertices", () => {
  const fc = run([
    [RED, RED, GREEN, GREEN],
    [RED, RED, RED, GREEN],
    [RED, GREEN, GREEN, GREEN],
  ]);
  assert.equal(fc.features.length, 2);
  const red = byColor(fc, RED);
  const green = byColor(fc, GREEN);
  assert.equal(red.geometry.type, "Polygon");
  assert.equal(green.geometry.type, "Polygon");
  assert.equal(red.geometry.coordinates.length, 1, "no holes");
  assert.equal(areaOf(red.geometry), 6);
  assert.equal(areaOf(green.geometry), 6);

  // The stepped border, pixel corners (2,0) (2,1) (3,1) (3,2) (1,2) (1,3), in lon/lat.
  const border = ["2,3", "2,2", "3,2", "3,1", "1,1", "1,0"];
  const redVertices = vertexSet(red.geometry);
  const greenVertices = vertexSet(green.geometry);
  for (const corner of border) {
    assert.ok(redVertices.has(corner), `red has ${corner}`);
    assert.ok(greenVertices.has(corner), `green has ${corner}`);
  }
  // Collinear points along straight runs are dropped: the red outline is just its corners.
  assert.equal(red.geometry.coordinates[0].length, 8 + 1);
});

test("a ring closes on its first point", () => {
  const fc = run([[RED, RED], [RED, RED]]);
  const ring = byColor(fc, RED).geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(ring.length, 5, "a square: four corners and the closing point");
  assert.equal(areaOf(byColor(fc, RED).geometry), 4);
});

test("an enclosed province becomes a hole in its neighbour, traced on the same corners", () => {
  const fc = run([
    [RED, RED, RED],
    [RED, GREEN, RED],
    [RED, RED, RED],
  ]);
  const red = byColor(fc, RED);
  const green = byColor(fc, GREEN);
  assert.equal(red.geometry.type, "Polygon");
  assert.equal(red.geometry.coordinates.length, 2, "outer ring + one hole");
  assert.equal(areaOf(red.geometry), 8);
  const [outer, inner] = red.geometry.coordinates;
  assert.ok(Math.sign(ringArea(outer)) === -Math.sign(ringArea(inner)), "a hole runs the other way round");
  const hole = new Set(red.geometry.coordinates[1].map(([x, y]) => `${x},${y}`));
  assert.deepEqual(hole, vertexSet(green.geometry));
});

test("two separate patches of one colour become one MultiPolygon region", () => {
  const fc = run([
    [RED, GREEN, RED],
    [RED, GREEN, RED],
  ]);
  assert.equal(fc.features.length, 2);
  const red = byColor(fc, RED);
  assert.equal(red.geometry.type, "MultiPolygon");
  assert.equal(red.geometry.coordinates.length, 2);
  assert.equal(areaOf(red.geometry), 4);
  assert.equal(red.properties.sourcePixels, 4);
  assert.equal(fc.importStats.components, 3);
});

test("pixels that touch only at a corner are separate patches, and a pinched outline keeps its area", () => {
  // Blue touches itself only diagonally; red's hole (the centre blue pixel)
  // meets red's outer edge at the single corner (2,2).
  const fc = run([
    [RED, RED, RED],
    [RED, BLUE, RED],
    [RED, RED, BLUE],
  ]);
  const blue = byColor(fc, BLUE);
  assert.equal(blue.geometry.type, "MultiPolygon");
  assert.equal(blue.geometry.coordinates.length, 2);
  assert.equal(areaOf(blue.geometry), 2);
  assert.equal(areaOf(byColor(fc, RED).geometry), 7);
});

test("black and transparent pixels are skipped unless black is asked for", () => {
  const rows = [
    [RED, 0x000000],
    [-1, 0x000000],
  ];
  const skipped = run(rows);
  assert.deepEqual(skipped.features.map((f) => f.properties.sourceColor), ["#FF0000"]);
  const kept = run(rows, { ignoreBlack: false });
  assert.deepEqual(kept.features.map((f) => f.properties.sourceColor).sort(), ["#000000", "#FF0000"]);
  assert.equal(byColor(kept, 0).properties.sourcePixels, 2, "the transparent pixel is never a province");
});

test("minPixels drops colours smaller than the floor", () => {
  const fc = run(
    [
      [RED, RED, GREEN],
      [RED, RED, RED],
    ],
    { minPixels: 2 },
  );
  assert.deepEqual(fc.features.map((f) => f.properties.sourceColor), ["#FF0000"]);
});

test("a HOI4 definition names provinces by id, marks sea as water, and landOnly keeps land", () => {
  const definitionText = [
    "province;red;green;blue;type;coastal;terrain;continent",
    "12;255;0;0;land;true;plains;1",
    "40;0;255;0;sea;true;ocean;0",
  ].join("\n");
  const rows = [
    [RED, GREEN],
    [RED, GREEN],
  ];
  const fc = run(rows, { definitionText });
  const land = fc.features.find((f) => f.id === "imp-12");
  const sea = fc.features.find((f) => f.id === "imp-40");
  assert.equal(land.properties.name, "Province 12");
  assert.equal(land.properties.typeId, "land");
  assert.equal(land.properties.sourceTerrain, "plains");
  assert.equal(sea.properties.name, "Province 40");
  assert.equal(sea.properties.typeId, "water");
  assert.equal(sea.properties.sourceType, "sea");
  assert.equal(fc.importStats.definitionRows, 2);

  const landOnly = run(rows, { definitionText, landOnly: true });
  assert.deepEqual(landOnly.features.map((f) => f.id), ["imp-12"]);
  assert.equal(landOnly.importStats.landOnly, true);

  // Without a definition, landOnly has nothing to go on and keeps everything.
  const noDefinition = run(rows, { landOnly: true });
  assert.equal(noDefinition.features.length, 2);
  assert.equal(noDefinition.features[0].properties.name, "Province #FF0000");
});

test("bad dimensions, a short pixel buffer and inverted bounds are refused", () => {
  assert.throws(() => vectorizeColorGrid(0, 2, new Int32Array(0)), /Invalid raster dimensions/);
  assert.throws(() => vectorizeColorGrid(2, 2, new Int32Array(3)), /does not match/);
  assert.throws(
    () => vectorizeColorGrid(1, 1, Int32Array.of(RED), { bounds: { west: 10, east: 0, north: 1, south: 0 } }),
    /inverted/,
  );
});

test("bounds place the grid on the map", () => {
  const fc = vectorizeColorGrid(2, 1, Int32Array.of(RED, GREEN), { bounds: { west: -10, east: 10, north: 5, south: -5 } });
  const green = byColor(fc, GREEN);
  assert.deepEqual(vertexSet(green.geometry), new Set(["0,5", "10,5", "10,-5", "0,-5"]));
});
