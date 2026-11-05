// Run: node --test src/runtime/fronts/line.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { rasterizeArena } from "./arena.js";
import { decodeLines, encodeLines } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { openField, readField, redistance, takeCapsule, traceContour } from "./field.js";
import { projectorOf } from "./frame.js";
import { drawLine, measureLine } from "./line.js";
import { COMPASS_WORDS, describePoint, findPlace, inSector, nearestVertex, placeText, readSectors, resolveSector, sectorMiddle } from "./sectors.js";
import { sideTable, syntheticMap } from "./syntheticMap.js";

const SIDES = [["Aland"], ["Borduria"]];
const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.7, capital: true },
  { name: "Brod", lng: 23.4, lat: 50.4 },
  { name: "Mid", lng: 22.1, lat: 51.0 },
  { name: "Aland 1.1", lng: 23.0, lat: 51.6 },
];

const build = (layout, options = {}) => {
  const world = syntheticMap({ layout, legend, west: 20, north: 52, step: 0.5, cities, ...options });
  const frame = world.frame({ marginKm: 10 });
  const arena = rasterizeArena(frame, world.regions, { cities });
  const sides = sideTable(arena, world, SIDES);
  const field = openField(arena, world.regions, sides);
  const quiet = (cellA, cellB) => sides[arena.region[cellA]] === 0 && sides[arena.region[cellB]] === 1;
  return { world, frame, arena, sides, field, quiet };
};

const NORTH_SOUTH = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"];
const EAST_WEST = ["BBBBBB", "BBBBBB", "AAAAAA", "AAAAAA"];
const DIAGONAL = ["ABBBBB", "AABBBB", "AAABBB", "AAAABB", "AAAAAB"];
const RING = ["BBBBB", "BBABB", "BBBBB"];

// The line as it would be saved and read back.
const saved = (contour, flags) => decodeLines(encodeLines(drawLine(contour, flags)));

const assertLeftIsA = (field, strands, label) => {
  let checked = 0;
  for (const { points, closed } of strands) {
    const count = closed ? points.length : points.length - 1;
    for (let index = 0; index < count; index += 1) {
      const [ax, ay] = points[index];
      const [bx, by] = points[(index + 1) % points.length];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 0.2) continue;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const left = readField(field, mx - ((by - ay) / length) * 0.25, my + ((bx - ax) / length) * 0.25);
      const right = readField(field, mx + ((by - ay) / length) * 0.25, my - ((bx - ax) / length) * 0.25);
      if (left === 0 || right === 0) continue;
      assert.ok(left < 0, `${label}: side A holds the left of segment ${index} at ${mx.toFixed(2)}, ${my.toFixed(2)}`);
      assert.ok(right > 0, `${label}: side B holds the right of segment ${index} at ${mx.toFixed(2)}, ${my.toFixed(2)}`);
      checked += 1;
    }
  }
  return checked;
};

test("the line is measured in kilometres, and its normal points from side A toward side B", () => {
  const { field, frame } = build(NORTH_SOUTH);
  const contour = traceContour(field);
  const line = measureLine(field, contour);
  assert.equal(measureLine(field, contour), line, "measured once");
  // Two degrees of latitude, less the half cells at either end.
  assert.ok(Math.abs(line.total - 2 * 110.9) < 2 * frame.km, `${line.total} km`);
  for (let vertex = 0; vertex < line.count; vertex += 1) {
    assert.ok(line.nx[vertex] > 0.99 && Math.abs(line.ny[vertex]) < 0.1, "eastward, toward Borduria");
    if (vertex > 0) assert.ok(line.km[vertex] >= line.km[vertex - 1]);
  }
  assert.ok(Math.abs(line.km[line.count - 1] - line.total) < 1e-9);
  const level = build(EAST_WEST);
  const across = measureLine(level.field, traceContour(level.field));
  for (let vertex = 0; vertex < across.count; vertex += 1) assert.ok(across.ny[vertex] > 0.99, "northward, toward Borduria");
});

test("every saved strand has side A's ground on its left: straight lines, and a pocket of each side", () => {
  for (const [label, layout] of [["north-south", NORTH_SOUTH], ["east-west", EAST_WEST]]) {
    const { field, quiet } = build(layout);
    const contour = traceContour(field);
    const flags = new Uint8Array(contour.x.length);
    const drawn = drawLine(contour, flags);
    assert.ok(drawn[0].points.length <= 4, `${label}: a straight line is drawn with few points (${drawn[0].points.length})`);
    const strands = saved(contour, flags);
    assert.equal(strands.length, 1);
    assert.ok(assertLeftIsA(field, strands, label) >= 1);
    const [first, last] = [strands[0].points[0], strands[0].points.at(-1)];
    if (label === "north-south") assert.ok(last[1] > first[1], "side A in the west: the strand runs northward");
    else assert.ok(last[0] < first[0], "side A in the south: the strand runs westward");
  }
  const { field, frame, quiet } = build(NORTH_SOUTH);
  const { toCell } = projectorOf(frame);
  const [inB, y] = toCell(23.1, 51);
  const [inA] = toCell(20.9, 51);
  takeCapsule(field, HOLDER_SIDE_A, inB, y, inB, y + 1.5, 3, 3);
  takeCapsule(field, HOLDER_SIDE_B, inA, y, inA + 1, y, 3, 3);
  redistance(field);
  const contour = traceContour(field);
  const strands = saved(contour, new Uint8Array(contour.x.length));
  assert.equal(strands.filter((strand) => strand.closed).length, 2);
  assert.ok(assertLeftIsA(field, strands, "pockets") >= 12);
  const turning = ({ points }) => points.reduce((sum, [ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length];
    return sum + ax * by - bx * ay;
  }, 0);
  const rings = strands.filter((strand) => strand.closed);
  const roundA = rings.find((strand) => strand.points[0][0] > inB - 4);
  const roundB = rings.find((strand) => strand.points[0][0] < inA + 5);
  assert.ok(turning(roundA) > 0, "counter-clockwise round a pocket of side A");
  assert.ok(turning(roundB) < 0, "clockwise round a pocket of side B");
});

test("the drawn line follows the contour closely with far fewer points", () => {
  const { field, frame, quiet } = build(NORTH_SOUTH);
  const { toCell } = projectorOf(frame);
  const [x, y] = toCell(22, 51);
  takeCapsule(field, HOLDER_SIDE_A, x - 1, y, x + 5, y + 2, 2.2, 2.2);
  redistance(field);
  const contour = traceContour(field);
  const drawn = drawLine(contour, new Uint8Array(contour.x.length).fill(1));
  const points = drawn.flatMap((strand) => strand.points);
  assert.ok(points.length < contour.x.length, `${points.length} points for ${contour.x.length} vertices`);
  const off = (px, py) => {
    let best = Infinity;
    for (let segment = 0; segment < contour.segments; segment += 1) {
      const ax = contour.x[contour.from[segment]];
      const ay = contour.y[contour.from[segment]];
      const bx = contour.x[contour.to[segment]] - ax;
      const by = contour.y[contour.to[segment]] - ay;
      const length = bx * bx + by * by;
      const along = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / length)) : 0;
      best = Math.min(best, Math.hypot(px - ax - bx * along, py - ay - by * along));
    }
    return best;
  };
  for (const [px, py] of points) assert.ok(off(px, py) < 0.3, `a drawn point is ${off(px, py)} cells from the line`);
  // An open strand keeps its two ends exactly.
  const { first, count } = contour.strands[0];
  assert.deepEqual(drawn[0].points[0], [contour.x[first], contour.y[first]]);
  assert.deepEqual(drawn[0].points.at(-1), [contour.x[first + count - 1], contour.y[first + count - 1]]);
});

test("the sector words that fit a line depend on how it runs", () => {
  const sectorsOf = (layout) => {
    const built = build(layout);
    const line = measureLine(built.field, traceContour(built.field));
    return { ...built, line, sectors: readSectors(line) };
  };
  const upright = sectorsOf(NORTH_SOUTH);
  assert.equal(upright.sectors.axis, "north-south");
  assert.deepEqual(upright.sectors.names, ["all", "north", "centre", "south"]);
  const level = sectorsOf(EAST_WEST);
  assert.equal(level.sectors.axis, "east-west");
  assert.deepEqual(level.sectors.names, ["all", "east", "centre", "west"]);
  const slanted = sectorsOf(DIAGONAL);
  assert.equal(slanted.sectors.axis, "northwest-southeast");
  assert.deepEqual(slanted.sectors.names, ["all", "southeast", "centre", "northwest", "north", "south", "east", "west"]);
  const ring = sectorsOf(RING);
  assert.equal(traceContour(ring.field).strands[0].closed, true);
  assert.deepEqual(ring.sectors.names, ["all", "north", "centre", "south", "east", "west", "northeast", "southwest", "southeast", "northwest"]);
  assert.equal(COMPASS_WORDS.length, 8);

  // The three thirds of a north-south line share it out, top to bottom.
  const { arena, line, sectors, frame } = upright;
  const { kmAt } = projectorOf(frame);
  const thirds = ["south", "centre", "north"].map((word) => resolveSector(arena, line, sectors, word));
  const counts = [0, 0, 0];
  for (let vertex = 0; vertex < line.count; vertex += 1) {
    const inside = thirds.map((sector) => inSector(sector, line.contour.x[vertex], line.contour.y[vertex], kmAt));
    assert.ok(inside.filter(Boolean).length >= 1, "every vertex is in a third");
    inside.forEach((yes, index) => { if (yes) counts[index] += 1; });
  }
  for (const count of counts) assert.ok(Math.abs(count - line.count / 3) <= 3, `${counts} of ${line.count}`);
  assert.ok(sectorMiddle(line, thirds[2], kmAt)[1] > sectorMiddle(line, thirds[1], kmAt)[1]);
  assert.ok(sectorMiddle(line, thirds[1], kmAt)[1] > sectorMiddle(line, thirds[0], kmAt)[1]);
  // Ground beyond the end of the line still belongs to the end sector.
  assert.equal(inSector(thirds[2], 3, arena.rows + 50, kmAt), true);
  assert.equal(inSector(thirds[1], 3, arena.rows + 50, kmAt), false);

  // A word that does not fit is no sector: the caller reads it as the whole line and says so.
  assert.equal(resolveSector(arena, line, sectors, "west"), null);
  assert.equal(resolveSector(arena, line, sectors, "northeast"), null);
  assert.equal(resolveSector(arena, line, sectors, "Atlantis"), null);
  assert.deepEqual(resolveSector(arena, line, sectors, "ALL"), { kind: "all" });
  assert.deepEqual(resolveSector(arena, line, sectors, ""), { kind: "all" });
  assert.equal(resolveSector(arena, line, sectors, "center").word, "centre");
  assert.equal(resolveSector(level.arena, level.line, level.sectors, "west").word, "west");
  assert.equal(resolveSector(level.arena, level.line, level.sectors, "north"), null);
});

test("a place is found by its exact name, and can stand for the line near it", () => {
  const { arena, field, frame } = build(NORTH_SOUTH);
  const { kmAt, toCell } = projectorOf(frame);
  const line = measureLine(field, traceContour(field));
  const sectors = readSectors(line);
  assert.equal(placeText(findPlace(arena, "mid")), "city: Mid");
  assert.equal(placeText(findPlace(arena, "City:  MID")), "city: Mid");
  assert.equal(findPlace(arena, "region: Mid"), null);
  assert.equal(findPlace(arena, "Mi"), null, "nothing looser than the whole name");
  assert.equal(findPlace(arena, ""), null);
  // A name that is both a city and a region is the city, unless the writer says which.
  assert.equal(findPlace(arena, "Aland 1.1").kind, "city");
  const region = findPlace(arena, "region: aland 1.1");
  assert.equal(region.kind, "region");
  assert.equal(arena.ids[region.region], "r1-1");
  assert.equal(placeText(region), "region: Aland 1.1");

  const near = resolveSector(arena, line, sectors, "city: Mid");
  assert.equal(near.kind, "place");
  assert.equal(near.word, "city: Mid");
  const [, cityY] = toCell(22.1, 51.0);
  assert.ok(Math.abs(near.py - cityY) < 1, "anchored on the point of the line nearest the city");
  let inside = 0;
  for (let vertex = 0; vertex < line.count; vertex += 1) {
    const yes = inSector(near, line.contour.x[vertex], line.contour.y[vertex], kmAt);
    const km = Math.abs(line.contour.y[vertex] - near.py) * kmAt(near.py);
    assert.equal(yes, km <= 60 + frame.km * 0.2 ? yes : false);
    if (km < 55) assert.equal(yes, true);
    if (yes) inside += 1;
  }
  assert.ok(inside > 5 && inside < line.count);
  assert.equal(nearestVertex(line, near.px, near.py) >= 0, true);
  assert.equal(describePoint(arena, ...toCell(20.7, 51.6)), "city: Alba");
  const bare = rasterizeArena(frame, syntheticMap({ layout: NORTH_SOUTH, legend, west: 20, north: 52, step: 0.5 }).regions, {});
  assert.equal(describePoint(bare, ...toCell(20.7, 51.6)), "region: Aland 1.0", "no city: the region it lies in");
  assert.equal(describePoint(bare, -5, -5), "");
});
