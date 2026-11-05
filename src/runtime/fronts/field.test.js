// Run: node --test src/runtime/fronts/field.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { rasterizeArena } from "./arena.js";
import { EDIT_MARGIN_CELLS, FAR_CELLS, HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, REDISTANCE_REACH_CELLS } from "./constants.js";
import {
  bodiesOf,
  countHolders,
  holderAtPoint,
  nearest,
  nearestOnContour,
  openField,
  packField,
  readField,
  rebuildFromHolders,
  redistance,
  resampleField,
  setGround,
  takeCapsule,
  takeCells,
  traceContour,
  unpackField,
} from "./field.js";
import { createFrame, projectorOf } from "./frame.js";
import { sideTable, syntheticMap } from "./syntheticMap.js";

const SIDES = [["Aland"], ["Borduria"]];
const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };

// Aland in the west, Borduria in the east, the sea to the south; the border
// runs along 22 degrees east, which is on no cell's edge.
const plain = (layout = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "~~~~~~~~"], options = {}) => {
  const world = syntheticMap({ layout, legend, west: 20, north: 52, step: 0.5, ...options });
  const frame = world.frame({ marginKm: options.marginKm ?? 10 });
  const arena = rasterizeArena(frame, world.regions, {});
  const sides = sideTable(arena, world, SIDES);
  return { world, frame, arena, sides, field: openField(arena, world.regions, sides) };
};

const strandPoints = (contour, strand) =>
  Array.from({ length: strand.count }, (_, offset) => [contour.x[strand.first + offset], contour.y[strand.first + offset]]);

const bits = (values) => Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("hex");

// The true distance from a point to a traced line, the slow way.
const slowDistance = (contour, px, py) => {
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

// Side A's ground is on the left of every strand, side B's on the right.
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
      const leftX = -(by - ay) / length;
      const leftY = (bx - ax) / length;
      const left = readField(field, mx + leftX * 0.25, my + leftY * 0.25);
      const right = readField(field, mx - leftX * 0.25, my - leftY * 0.25);
      if (left === 0 || right === 0) continue;
      assert.ok(left < 0, `${label}: side A is on the left of segment ${index} (${mx.toFixed(2)}, ${my.toFixed(2)})`);
      assert.ok(right > 0, `${label}: side B is on the right of segment ${index} (${mx.toFixed(2)}, ${my.toFixed(2)})`);
      checked += 1;
    }
  }
  assert.ok(checked >= 4, `${label}: enough segments were long enough to check (${checked})`);
};

test("a new field holds each cell for its region's side and puts the line on the border", () => {
  const { world, frame, arena, sides, field } = plain();
  const { toCell } = projectorOf(frame);
  for (let index = 0; index < field.size; index += 1) {
    const side = arena.speed[index] > 0 ? sides[arena.region[index]] : -1;
    assert.equal(field.holders[index], side < 0 ? HOLDER_WALL : side);
    assert.equal(field.play[index], side < 0 ? 0 : 1);
    if (side === 0) assert.ok(field.phi[index] < 0);
    if (side === 1) assert.ok(field.phi[index] > 0);
    if (side < 0) assert.equal(field.phi[index], 0);
  }
  const contour = traceContour(field);
  assert.equal(contour.strands.length, 1);
  assert.equal(contour.strands[0].closed, false);
  const [borderX] = toCell(22, 51);
  assert.ok(Math.abs(borderX - Math.round(borderX)) > 0.05 && Math.abs(borderX - Math.round(borderX) - 0.5) > 0.05, "the border is on no cell's edge or centre");
  const points = strandPoints(contour, contour.strands[0]);
  assert.ok(points.length > 20);
  for (const [x] of points) assert.ok(Math.abs(x - borderX) <= 0.25, `the line at ${x} is within a quarter of a cell of the border at ${borderX}`);
  // Distances are distances: a cell three cells from the border says so.
  const row = Math.floor(field.rows / 2);
  for (const offset of [-3, -2, -1, 0, 1, 2]) {
    const col = Math.floor(borderX) + offset;
    const lineX = points.reduce((best, [x, y]) => (Math.abs(y - (row + 0.5)) < Math.abs(best[1] - (row + 0.5)) ? [x, y] : best), points[0])[0];
    assert.ok(Math.abs(field.phi[row * field.cols + col] - (col + 0.5 - lineX)) < 0.02, `column ${col}`);
  }
  assert.equal(Math.abs(field.phi[row * field.cols + 2]), FAR_CELLS, "far from the line a cell is simply far");
  assert.equal(world.controllerOf("r0-0"), "Aland");
});

test("a strand ends on a coast and on another country's border, and never runs through a wall", () => {
  const { frame, field } = plain();
  const { toCell } = projectorOf(frame);
  const contour = traceContour(field);
  const points = strandPoints(contour, contour.strands[0]);
  const [, coastY] = toCell(22, 50);
  const [, topY] = toCell(22, 52);
  const ys = points.map(([, y]) => y);
  // It reaches each end of the land to within the cell the land ends in.
  assert.ok(Math.abs(Math.min(...ys) - coastY) <= 0.75, `south end ${Math.min(...ys)} against the coast at ${coastY}`);
  assert.ok(Math.abs(Math.max(...ys) - topY) <= 0.75, `north end ${Math.max(...ys)} against the land's edge at ${topY}`);
  // A neutral country in the middle of the border parts the line in two.
  const parted = plain(["AAAABBBB", "AAANNBBB", "AAAABBBB", "~~~~~~~~"]);
  const two = traceContour(parted.field);
  assert.equal(two.strands.length, 2);
  for (const strand of two.strands) assert.equal(strand.closed, false);
  for (let segment = 0; segment < two.segments; segment += 1) {
    const mx = (two.x[two.from[segment]] + two.x[two.to[segment]]) / 2;
    const my = (two.y[two.from[segment]] + two.y[two.to[segment]]) / 2;
    assert.notEqual(holderAtPoint(parted.field, mx, my), HOLDER_WALL, `segment ${segment} at ${mx},${my} lies on ground in play`);
  }
  // Two sides that only touch across a strip of sea or of another country have no line.
  assert.equal(plain(["AAA~BBBB", "AAA~BBBB"]).field, null);
  assert.equal(plain(["AAANBBBB", "AAANBBBB"]).field, null);
});

test("side A's ground is on the left of every strand, and a pocket is a closed strand", () => {
  // A line running north to south with side A in the west, and one running east to west with it in the south.
  const northSouth = plain();
  const upright = traceContour(northSouth.field);
  const first = strandPoints(upright, upright.strands[0]);
  assert.ok(first.at(-1)[1] > first[0][1], "with side A in the west the strand runs northward");
  assertLeftIsA(northSouth.field, upright.strands.map((strand) => ({ points: strandPoints(upright, strand), closed: strand.closed })), "north-south");

  const eastWest = plain(["BBBBBB", "BBBBBB", "AAAAAA", "AAAAAA"]);
  const level = traceContour(eastWest.field);
  const across = strandPoints(level, level.strands[0]);
  assert.ok(across.at(-1)[0] < across[0][0], "with side A in the south the strand runs westward");
  assertLeftIsA(eastWest.field, level.strands.map((strand) => ({ points: strandPoints(level, strand), closed: strand.closed })), "east-west");

  // A pocket of each side inside the other's ground.
  const { field, frame } = northSouth;
  const { toCell } = projectorOf(frame);
  const [inB, y] = toCell(23.2, 51);
  const [inA] = toCell(20.8, 51);
  takeCapsule(field, HOLDER_SIDE_A, inB, y, inB, y, 3.2, 3.2);
  takeCapsule(field, HOLDER_SIDE_B, inA, y, inA, y, 3.2, 3.2);
  redistance(field);
  const contour = traceContour(field);
  const strands = contour.strands.map((strand) => ({ points: strandPoints(contour, strand), closed: strand.closed }));
  assert.equal(strands.filter((strand) => strand.closed).length, 2);
  assert.equal(strands.filter((strand) => !strand.closed).length, 1);
  assertLeftIsA(field, strands, "pockets");
  // Round a pocket of A the strand turns counter-clockwise, round one of B clockwise.
  const turning = (points) => points.reduce((sum, [ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length];
    return sum + ax * by - bx * ay;
  }, 0);
  const closed = strands.filter((strand) => strand.closed);
  const ofA = closed.find((strand) => strand.points[0][0] > inB - 4 && strand.points[0][0] < inB + 4);
  const ofB = closed.find((strand) => strand.points[0][0] > inA - 4 && strand.points[0][0] < inA + 4);
  assert.ok(turning(ofA.points) > 0, "counter-clockwise round side A's pocket");
  assert.ok(turning(ofB.points) < 0, "clockwise round side B's pocket");
  assert.ok(Math.abs(Math.abs(turning(ofA.points)) / 2 - Math.PI * 3.2 * 3.2) < 2.5, "and it encloses the disc that was taken");
  assert.equal(bodiesOf(field, HOLDER_SIDE_A).count, 2);
  assert.equal(bodiesOf(field, HOLDER_SIDE_B).count, 2);
  const [a, b] = countHolders(field);
  assert.ok(a > 0 && b > 0);
});

test("an edit writes only the cells its shape reaches, and the rest keep every bit", () => {
  const { field, frame } = plain();
  const { toCell } = projectorOf(frame);
  const before = Float64Array.from(field.phi);
  const holdersBefore = Uint8Array.from(field.holders);
  const [lineX, y] = toCell(22, 51.2);
  const radius = 1.6;
  const fromX = lineX - 1;
  const toX = lineX + 6;
  takeCapsule(field, HOLDER_SIDE_A, fromX, y, toX, y + 2, radius, radius);
  let written = 0;
  let taken = 0;
  for (let index = 0; index < field.size; index += 1) {
    const cx = (index % field.cols) + 0.5;
    const cy = Math.floor(index / field.cols) + 0.5;
    const sx = toX - fromX;
    const along = Math.max(0, Math.min(1, ((cx - fromX) * sx + (cy - y) * 2) / (sx * sx + 4)));
    const distance = Math.hypot(cx - fromX - sx * along, cy - y - 2 * along);
    if (!Object.is(field.phi[index], before[index])) {
      written += 1;
      assert.ok(distance <= radius + EDIT_MARGIN_CELLS + 1e-9, `cell ${index}, ${distance} cells from the path, was written`);
      assert.ok(field.phi[index] < before[index], "side A's edit only ever brings the line nearer to side B");
      assert.ok(Math.abs(field.phi[index] - (distance - radius)) < 1e-12);
    }
    if (field.play[index] && distance < radius - 1e-9) {
      assert.equal(field.holders[index], HOLDER_SIDE_A, `cell ${index} inside the strip is side A's`);
      if (holdersBefore[index] === HOLDER_SIDE_B) taken += 1;
    } else assert.equal(field.holders[index], holdersBefore[index], `cell ${index} outside the strip did not change hands`);
    if (!field.play[index]) assert.equal(field.holders[index], HOLDER_WALL);
  }
  assert.ok(taken > 10 && written > taken);
  assert.equal(field.changed.length, written);

  // Working the distances out again moves the line by nothing at all.
  const line = traceContour(field);
  const lineBits = [bits(line.x), bits(line.y)];
  const touched = field.changed.slice();
  redistance(field);
  const after = traceContour(field);
  assert.deepEqual([bits(after.x), bits(after.y)], lineBits);
  assert.equal(field.changed.length, 0);
  // ...and the cells behind the line now hold their true distance to it.
  let exact = 0;
  for (const index of touched) {
    const col = index % field.cols;
    const row = Math.floor(index / field.cols);
    const want = 1 - field.holders[index];
    const beside = [index - 1, index + 1, index - field.cols, index + field.cols].some((other) => field.holders[other] === want);
    if (beside) continue;
    const distance = slowDistance(after, col + 0.5, row + 0.5);
    if (distance > REDISTANCE_REACH_CELLS) assert.equal(Math.abs(field.phi[index]), FAR_CELLS);
    else assert.ok(Math.abs(Math.abs(field.phi[index]) - distance) < 1e-9, `cell ${index}`);
    exact += 1;
  }
  assert.ok(exact > 5);
  // Far from the edit nothing was ever written.
  const far = field.cols + 1;
  assert.ok(Object.is(field.phi[far], before[far]));

  // Side B takes some of it back the same way, and a second pass of the same edit writes nothing.
  takeCapsule(field, HOLDER_SIDE_B, toX, y + 2, toX, y + 2, 1.2, 1.2);
  const middle = Math.floor(y + 2) * field.cols + Math.floor(toX);
  assert.equal(field.holders[middle], HOLDER_SIDE_B);
  redistance(field);
  const settled = traceContour(field);
  const settledBits = [bits(settled.x), bits(settled.y), bits(field.holders)];
  takeCapsule(field, HOLDER_SIDE_B, toX, y + 2, toX, y + 2, 1.2, 1.2);
  redistance(field);
  const again = traceContour(field);
  assert.deepEqual([bits(again.x), bits(again.y), bits(field.holders)], settledBits, "ground already taken is not taken again");
});

test("the nearest point of the line is found, and of two equally near the first listed", () => {
  const { field, frame } = plain();
  const contour = traceContour(field);
  const { toCell } = projectorOf(frame);
  const [lineX, y] = toCell(22, 51);
  for (const [dx, dy] of [[-2.3, 0.1], [1.7, -3.2], [0.4, 2.5], [-3.4, 0]]) {
    const found = nearestOnContour(field, contour, lineX + dx, y + dy, 4);
    assert.ok(Math.abs(found - slowDistance(contour, lineX + dx, y + dy)) < 1e-12);
    assert.ok(nearest.segment >= 0 && nearest.along >= 0 && nearest.along <= 1);
  }
  assert.equal(nearestOnContour(field, contour, lineX - 6, y, 4), Infinity);
  assert.equal(nearest.segment, -1);
  // On a vertex two segments are equally near: the lower one answers.
  const vertex = contour.strands[0].first + 5;
  nearestOnContour(field, contour, contour.x[vertex], contour.y[vertex], 4);
  assert.equal(nearest.segment, 4);
});

test("a region taken whole puts the line on its cells' edges", () => {
  const { field, arena } = plain();
  const region = arena.indexOf.get("r4-1");
  const cells = [];
  for (let index = 0; index < field.size; index += 1) if (arena.region[index] === region) cells.push(index);
  takeCells(field, HOLDER_SIDE_A, cells);
  redistance(field);
  for (const index of cells) assert.equal(field.holders[index], HOLDER_SIDE_A);
  const contour = traceContour(field);
  assert.equal(contour.strands.length, 1, "it joins side A's ground: still one line");
  const east = Math.max(...cells.map((index) => index % field.cols));
  const row = Math.floor(cells.reduce((sum, index) => sum + Math.floor(index / field.cols), 0) / cells.length);
  const crossing = strandPoints(contour, contour.strands[0]).find(([x, y]) => Math.abs(y - (row + 0.5)) < 1e-9 && x > east);
  assert.ok(Math.abs(crossing[0] - (east + 1)) < 1e-9, "midway between the last cell taken and the next");
});

test("a field saved and read back is the same field, and saves the same again", () => {
  const { field, arena, sides, frame } = plain();
  const { toCell } = projectorOf(frame);
  const [x, y] = toCell(22.6, 51);
  takeCapsule(field, HOLDER_SIDE_A, x - 4, y, x, y + 1, 1.7, 1.7);
  redistance(field);
  const saved = packField(field);
  assert.equal(saved.key, arena.key);
  const read = unpackField(arena, saved, sides);
  assert.deepEqual([...read.holders], [...field.holders]);
  assert.deepEqual(packField(read), saved, "reading it changes nothing that is saved");
  for (let index = 0; index < field.size; index += 1) {
    if (Math.abs(field.phi[index]) < 3) assert.ok(Math.abs(read.phi[index] - field.phi[index]) <= 1 / 32 + 1e-9, `cell ${index}`);
    assert.equal(read.phi[index] < 0, field.phi[index] < 0);
  }
  const was = traceContour(field);
  const now = traceContour(read);
  assert.equal(now.x.length, was.x.length);
  for (let vertex = 0; vertex < was.x.length; vertex += 1) {
    assert.ok(Math.hypot(now.x[vertex] - was.x[vertex], now.y[vertex] - was.y[vertex]) < 0.06, `vertex ${vertex}`);
  }
  // A band that cannot be trusted is worked out again from who holds what.
  for (const damaged of [{ ...saved, band: saved.band.slice(0, 20) }, { ...saved, key: "another map" }, { ...saved, band: "" }, { mask: saved.mask }]) {
    const rebuilt = unpackField(arena, damaged, sides);
    assert.deepEqual([...rebuilt.holders], [...field.holders]);
    const edges = traceContour(rebuilt);
    for (let vertex = 0; vertex < edges.x.length; vertex += 1) {
      assert.ok(slowDistance(was, edges.x[vertex], edges.y[vertex]) <= 0.75, "the line is where the holders put it");
    }
  }
  // A mask that says nothing of a cell in play leaves it to its region's side.
  const blank = unpackField(arena, { mask: "", band: "", key: arena.key }, sides);
  for (let index = 0; index < field.size; index += 1) {
    assert.equal(blank.holders[index], arena.speed[index] > 0 && sides[arena.region[index]] >= 0 ? sides[arena.region[index]] : HOLDER_WALL);
  }
});

test("ground that leaves the war becomes wall, and ground that joins it is its side's", () => {
  const { world, field, arena } = plain(["AAAABBBB", "AAAABBBB", "NNNNBBBB", "~~~~~~~~"]);
  const before = traceContour(field).x.length;
  const neutral = arena.indexOf.get("r1-2");
  assert.equal(field.play[arena.region.indexOf(neutral)], 0);
  // Neutralia joins side A.
  const joined = sideTable(arena, world, [["Aland", "Neutralia"], ["Borduria"]]);
  assert.equal(setGround(field, joined), true);
  rebuildFromHolders(field);
  assert.equal(field.holders[arena.region.indexOf(neutral)], HOLDER_SIDE_A);
  assert.ok(traceContour(field).x.length > before, "the line now runs along its border too");
  // Borduria's ally leaves: nothing of Aland's changes, and Neutralia is wall again.
  assert.equal(setGround(field, sideTable(arena, world, SIDES)), true);
  assert.equal(field.holders[arena.region.indexOf(neutral)], HOLDER_WALL);
  assert.equal(field.phi[arena.region.indexOf(neutral)], 0);
  assert.equal(setGround(field, sideTable(arena, world, SIDES)), false, "nothing to change the second time");
});

test("a field moved onto a larger frame keeps its line where it was", () => {
  const { world, field, frame, sides } = plain();
  const { toCell, toLngLat } = projectorOf(frame);
  const [x, y] = toCell(22.4, 51);
  takeCapsule(field, HOLDER_SIDE_A, x - 3, y, x + 2, y, 1.6, 1.6);
  redistance(field);
  const was = traceContour(field);
  const wasPoints = Array.from(was.x, (px, vertex) => toLngLat(px, was.y[vertex]));
  for (const grown of [
    // The same cells, more of them on every side...
    { ...frame, lng0: frame.lng0 - 7 * frame.cell, cols: frame.cols + 12, lat0: projectorOf(frame).toLngLat(0, -5)[1], rows: frame.rows + 9 },
    // ...and another grid altogether, with coarser cells.
    createFrame({ west: 19.3, south: 49.2, east: 24.9, north: 52.9 }, { marginKm: 37 }),
  ]) {
    const arena = rasterizeArena(grown, world.regions, {});
    const moved = resampleField(field, arena, sideTable(arena, world, SIDES));
    const now = traceContour(moved);
    const place = projectorOf(grown);
    const cellsApart = grown.cell / frame.cell;
    assert.equal(now.strands.length, was.strands.length);
    for (const [lng, lat] of wasPoints) {
      const [px, py] = place.toCell(lng, lat);
      assert.ok(slowDistance(now, px, py) <= (cellsApart === 1 ? 0.02 : 0.5), `the line passes where it did at ${lng},${lat}`);
    }
    for (let vertex = 0; vertex < now.x.length; vertex += 1) {
      const [lng, lat] = place.toLngLat(now.x[vertex], now.y[vertex]);
      const [px, py] = toCell(lng, lat);
      assert.ok(slowDistance(was, px, py) <= 1, "and nowhere it did not");
    }
  }
  assert.ok(sides.length > 0);
});

test("a sweep leaves alone the ground it is told to: a disc is gone round, and a mask is not written", () => {
  const { field } = plain();
  const row = Math.floor(field.rows / 2) + 0.5;
  const border = traceContour(field).x[0];
  const before = Uint8Array.from(field.holders);
  const phiBefore = Float64Array.from(field.phi);
  // A strip six cells wide driven twenty cells into Borduria, straight through a spared disc of radius 4.
  const spare = [border + 10, row, 4];
  const mask = new Uint8Array(field.size);
  const kept = [];
  for (let index = 0; index < field.size; index += 1) {
    const col = index % field.cols;
    if (Math.floor(index / field.cols) === Math.floor(row) + 2 && col > border + 15 && col < border + 19) {
      mask[index] = 1;
      kept.push(index);
    }
  }
  takeCapsule(field, HOLDER_SIDE_A, border - 1, row, border + 20, row, 3, 3, { spare, keep: mask });
  redistance(field);
  let spared = 0;
  let taken = 0;
  for (let index = 0; index < field.size; index += 1) {
    if (!field.play[index]) continue;
    const dx = (index % field.cols) + 0.5 - spare[0];
    const dy = Math.floor(index / field.cols) + 0.5 - spare[1];
    if (Math.sqrt(dx * dx + dy * dy) <= spare[2]) {
      spared += 1;
      assert.equal(field.holders[index], before[index], "no cell within the disc changed hands");
    } else if (field.holders[index] !== before[index]) taken += 1;
  }
  assert.ok(spared > 40 && taken > 30, `${spared} cells spared, ${taken} taken round them`);
  // The strip beyond the disc was taken all the same, and the line runs round the disc at its radius.
  assert.equal(holderAtPoint(field, border + 17, row), HOLDER_SIDE_A);
  assert.equal(holderAtPoint(field, border + 10, row), HOLDER_SIDE_B);
  assert.ok(Math.abs(nearestOnContour(field, traceContour(field), spare[0], spare[1], 8) - spare[2]) < 0.2, "the disc's edge is where the line now runs");
  // A cell of the mask is not written at all.
  for (const index of kept) {
    assert.equal(field.holders[index], HOLDER_SIDE_B);
    assert.ok(Object.is(field.phi[index], phiBefore[index]) || Math.abs(field.phi[index]) <= Math.abs(phiBefore[index]), "kept as it was, or only measured again");
  }
  assert.equal(holderAtPoint(field, border + 17, row - 1), HOLDER_SIDE_A, "while the cells beside them were taken");
  // Side B is held to the same.
  const { field: other } = plain();
  const edge = traceContour(other).x[0];
  takeCapsule(other, HOLDER_SIDE_B, edge + 1, row, edge - 20, row, 3, 3, { spare: [edge - 10, row, 4] });
  assert.equal(holderAtPoint(other, edge - 10, row), HOLDER_SIDE_A);
  assert.equal(holderAtPoint(other, edge - 17, row), HOLDER_SIDE_B);
});
