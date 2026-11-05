// Run: node --test src/runtime/fronts/codec.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  PACKED_TEXT,
  PAINT_LETTERS,
  PAINT_NAMES_MAX,
  PAINT_WALL,
  TRACK_LETTERS,
  TROOP_LETTERS,
  bandIndices,
  decodeBand,
  decodeLines,
  decodeMask,
  decodePaint,
  decodeStates,
  decodeTracks,
  decodeTroops,
  encodeBand,
  encodeLines,
  encodeMask,
  encodePaint,
  encodeStates,
  encodeTracks,
  encodeTroops,
  hashKey,
} from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, LINE_PUSHED_BY_A, LINE_QUIET, LINE_UNITS, TROOP_UNITS } from "./constants.js";

// A grid with side A in the west, side B in the east, a sea across the middle
// row and a line that leans, so runs differ from row to row.
const sampleMask = (cols = 40, rows = 30) => {
  const holders = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      holders[row * cols + col] = row === 14 ? HOLDER_WALL : col < 12 + Math.floor(row / 3) ? HOLDER_SIDE_A : HOLDER_SIDE_B;
    }
  }
  return holders;
};

test("the mask comes back cell for cell, and a run longer than one entry holds is split", () => {
  const holders = sampleMask();
  const text = encodeMask(holders);
  assert.match(text, PACKED_TEXT);
  assert.deepEqual([...decodeMask(text, holders.length)], [...holders]);

  const wide = new Uint8Array(5000).fill(HOLDER_SIDE_B);
  wide[4999] = HOLDER_SIDE_A;
  assert.deepEqual([...decodeMask(encodeMask(wide), wide.length)], [...wide]);
  assert.equal(encodeMask(wide).length, 2 * (Math.ceil(4999 / 1024) + 1), "two letters a run");
});

test("a mask shorter than its frame, or damaged, reads as wall where it says nothing", () => {
  const holders = sampleMask();
  const cut = encodeMask(holders).slice(0, 4);
  const read = decodeMask(cut, holders.length);
  assert.equal(read.length, holders.length);
  assert.equal(read[read.length - 1], HOLDER_WALL);
  assert.deepEqual([...decodeMask("", 6)], Array(6).fill(HOLDER_WALL));
  assert.deepEqual([...decodeMask("!!??", 3)].length, 3);
});

test("the band is the cells within reach of the other side, in scan order", () => {
  const cols = 12;
  const rows = 3;
  const holders = new Uint8Array(cols * rows);
  for (let index = 0; index < holders.length; index += 1) holders[index] = index % cols < 6 ? HOLDER_SIDE_A : HOLDER_SIDE_B;
  const cells = bandIndices(holders, cols, rows, 2);
  // Columns 4-5 of A and 6-7 of B, on every row.
  assert.deepEqual([...cells], [4, 5, 6, 7, 16, 17, 18, 19, 28, 29, 30, 31]);

  holders.fill(HOLDER_WALL, cols, 2 * cols);
  const walled = bandIndices(holders, cols, rows, 2);
  assert.ok(![...walled].some((cell) => cell >= cols && cell < 2 * cols), "a wall is never in the band");
  assert.equal(bandIndices(new Uint8Array(20).fill(HOLDER_SIDE_A), 5, 4).length, 0, "no other side, no band");
});

test("band values come back whole and are held to what one entry can carry", () => {
  const values = Int8Array.from([-127, -64, -1, 0, 1, 31, 96, 127]);
  const text = encodeBand(values);
  assert.match(text, PACKED_TEXT);
  assert.deepEqual([...decodeBand(text, values.length)], [...values]);
  assert.deepEqual([...decodeBand(encodeBand([300, -300]), 2)], [127, -127]);
  assert.deepEqual([...decodeBand(text, values.length + 2)].slice(-2), [0, 0], "asked for more than is stored");
});

test("a troop is seven letters and comes back to the precision it is kept at", () => {
  const troops = [
    { x: 10.25, y: 3.5, strength: 100, kind: 1, owner: 2, named: true, dig: 1, state: 1 },
    { x: 0, y: 0, strength: 0, kind: "artillery", owner: 0, named: false, dig: 0, state: "encircled" },
    { x: 254.9375, y: 199.0625, strength: 47, kind: 0, owner: 7, named: false, dig: 0.4, state: 3 },
  ];
  const text = encodeTroops(troops);
  assert.equal(text.length, troops.length * TROOP_LETTERS);
  assert.match(text, PACKED_TEXT);
  const read = decodeTroops(text);
  assert.equal(read.length, 3);
  assert.deepEqual(read[0], { x: 10.25, y: 3.5, strength: 100, kind: 1, owner: 2, named: true, dig: 1, state: 1 });
  assert.equal(read[1].kind, 2);
  assert.equal(read[1].state, 2);
  assert.equal(read[2].x, 254.9375);
  assert.ok(Math.abs(read[2].strength - 47) <= 100 / 126 + 1e-9);
  assert.ok(Math.abs(read[2].dig - 0.4) <= 1 / 30 + 1e-9);
  // A second pass changes nothing: what was read is exactly what is kept.
  assert.equal(encodeTroops(read), text);
  assert.deepEqual(decodeTroops(text.slice(0, TROOP_LETTERS * 2 + 3)).length, 2, "a cut string loses only its last troop");
  assert.ok(1 / TROOP_UNITS <= 0.0625);
});

test("the drawn line comes back to a thirty-second of a cell, strand by strand", () => {
  const strands = [
    { closed: false, points: [[1, 1], [1.5, 2.25], [1.53125, 9], [30, 9.5]], flags: [LINE_QUIET, LINE_QUIET, LINE_PUSHED_BY_A, LINE_PUSHED_BY_A] },
    { closed: true, points: [[100, 100], [101, 100], [101, 101], [100, 101]], flags: [1, 1, 1, 1] },
  ];
  const text = encodeLines(strands);
  assert.match(text, PACKED_TEXT);
  assert.equal(text.split(";").length, 2);
  const read = decodeLines(text);
  assert.equal(read[0].closed, false);
  assert.equal(read[1].closed, true);
  assert.deepEqual(read[1].points, strands[1].points);
  assert.deepEqual(read[0].points[0], [1, 1]);
  assert.deepEqual(read[0].points.at(-1), [30, 9.5]);
  assert.deepEqual(read[0].flags.at(-1), LINE_PUSHED_BY_A);
  // The long step was walked in parts, every part on the straight line between its ends.
  assert.ok(read[0].points.length > strands[0].points.length);
  for (const [x, y] of read[0].points.slice(3, -1)) {
    assert.ok(y >= 9 - 1 / LINE_UNITS && y <= 9.5 + 1 / LINE_UNITS && x > 1.5 && x < 30);
  }
  assert.equal(encodeLines(read), text, "a second pass changes nothing");
  assert.deepEqual(decodeLines(""), []);
  assert.equal(encodeLines([{ points: [] }]), "");
});

test("a troop's path comes back point for point, and a troop with none keeps its place", () => {
  const tracks = [
    [{ day: 0, x: 10.5, y: 3.0625, strength: 80, state: 0 }, { day: 12, x: 14.25, y: 9, strength: 61.4, state: "advancing" }, { day: 4095, x: 255.9375, y: 0, strength: 0, state: 3 }],
    [],
    [{ day: 7, x: 1, y: 2, strength: 100, state: 2 }],
  ];
  const text = encodeTracks(tracks);
  assert.match(text, PACKED_TEXT);
  assert.equal(text.split(";").length, 3);
  assert.equal(text.split(";")[0].length, 3 * TRACK_LETTERS);
  const read = decodeTracks(text);
  assert.deepEqual(read[0][0], { day: 0, x: 10.5, y: 3.0625, strength: 80, state: 0 });
  assert.deepEqual(read[0][1], { day: 12, x: 14.25, y: 9, strength: 61, state: 1 });
  assert.deepEqual(read[0][2], { day: 4095, x: 255.9375, y: 0, strength: 0, state: 3 });
  assert.deepEqual(read[1], []);
  assert.deepEqual(read[2], [{ day: 7, x: 1, y: 2, strength: 100, state: 2 }]);
  assert.equal(encodeTracks(read), text, "a second pass changes nothing");
  assert.deepEqual(decodeTracks(""), []);
  assert.equal(encodeTracks(null), "");
  // What is out of range is held to it, and a damaged string reads as far as it goes.
  assert.deepEqual(decodeTracks(encodeTracks([[{ day: 99999, x: -4, y: 9999, strength: 250, state: 9 }]]))[0][0], { day: 4095, x: 0, y: 255.9375, strength: 100, state: 4 });
  // One that is dug in is kept as that, in a path and where it stands.
  assert.equal(decodeTracks(encodeTracks([[{ day: 3, x: 5, y: 5, strength: 70, state: "dug in" }]]))[0][0].state, 4);
  const stood = decodeTroops(encodeTroops([{ x: 5, y: 5, strength: 70, dig: 1, state: "dug in" }, { x: 6, y: 5, strength: 70, dig: 3 / 7, state: "holding" }]));
  assert.deepEqual(stood.map((troop) => [troop.state, troop.dig]), [[4, 1], [0, 3 / 7]]);
  assert.equal(decodeTracks(text.slice(0, TRACK_LETTERS + 3))[0].length, 1);
});

test("painted ground comes back cell for cell, and ground it does not reach is wall", () => {
  const states = new Uint8Array(20000);
  states.fill(PAINT_WALL, 0, 300);
  states.fill(3, 9000, 9040);
  states[9041] = PAINT_NAMES_MAX;
  states.fill(1, 12000, 20000);
  const text = encodeStates(states);
  assert.match(text, PACKED_TEXT);
  assert.ok(text.length < 40, `${text.length} letters for seven stretches of ground`);
  assert.deepEqual(decodeStates(text, states.length), states);
  assert.equal(encodeStates(decodeStates(text, states.length)), text, "a second pass changes nothing");
  const short = decodeStates(encodeStates(states.subarray(0, 9020)), 9100);
  assert.equal(short[9019], 3);
  assert.equal(short[9020], PAINT_WALL);
  assert.equal(decodeStates("", 4).every((state) => state === PAINT_WALL), true);
  assert.equal(decodeStates(text, 0).length, 0);
});

test("the changes of painted ground come back in order, however long the wait between two", () => {
  const changes = [
    { tick: 0, cell: 7, state: 1 },
    { tick: 3, cell: 47999, state: 2 },
    { tick: 3, cell: 12, state: 0 },
    { tick: 62 + 3, cell: 5, state: PAINT_WALL },
    { tick: 62 + 3 + 400, cell: 6, state: 1 },
    { tick: 62 + 3 + 400 + 63, cell: 9, state: 4 },
  ];
  const text = encodePaint(changes);
  assert.match(text, PACKED_TEXT);
  assert.equal(text.length % PAINT_LETTERS, 0);
  const read = decodePaint(text);
  assert.deepEqual([...read.ticks], changes.map((change) => change.tick));
  assert.deepEqual([...read.cells], changes.map((change) => change.cell));
  assert.deepEqual([...read.states], changes.map((change) => change.state));
  assert.equal(encodePaint([]), "");
  assert.deepEqual([...decodePaint("").ticks], []);
  // Time never runs backwards: a change given out of order is taken as at the one before.
  assert.deepEqual([...decodePaint(encodePaint([{ tick: 9, cell: 1, state: 1 }, { tick: 4, cell: 2, state: 1 }])).ticks], [9, 9]);
  // A damaged string reads as far as it goes.
  assert.equal(decodePaint(text.slice(0, PAINT_LETTERS + 2)).cells.length, 1);
  // Cells in a row that change together are one entry, however many (up to
  // sixty-four); a gap, another state or another moment starts a new one.
  const strip = [
    ...Array.from({ length: 70 }, (_, index) => ({ tick: 5, cell: 1000 + index, state: 2 })),
    { tick: 5, cell: 1071, state: 2 },
    { tick: 5, cell: 1072, state: 3 },
    { tick: 6, cell: 1073, state: 3 },
  ];
  const packed = encodePaint(strip);
  assert.equal(packed.length, 5 * PAINT_LETTERS, "64 + 6, then one after the gap, one of another state, one a tick later");
  const unpacked = decodePaint(packed);
  assert.deepEqual([...unpacked.cells], strip.map((change) => change.cell));
  assert.deepEqual([...unpacked.states], strip.map((change) => change.state));
  assert.deepEqual([...unpacked.ticks], strip.map((change) => change.tick));
});

test("a key names a list and nothing looser", () => {
  assert.equal(hashKey(["a", "b"]), hashKey(["a", "b"]));
  assert.notEqual(hashKey(["a", "b"]), hashKey(["ab"]));
  assert.notEqual(hashKey(["a", "b"]), hashKey(["b", "a"]));
});
