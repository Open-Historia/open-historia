// Run: node --test src/Game/Map/frontGeometry.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeTroops } from "../../runtime/fronts/codec.js";
import { createFrame, projectorOf } from "../../runtime/fronts/frame.js";
import { battlefieldsAtDay, frontViewOf, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { createReplayRecorder } from "../../runtime/fronts/replay.js";
import {
  ARROW_FRESH_DAYS, ARROW_GROUP_DAYS, ARROW_MERGE_REACH, ARROW_STILL_MIN_ZOOM, arrowDetailAt, arrowGroupsOf, arrowRing,
  frontArrowFeatures, frontArrowRgb, frontAt, frontShownOn, frontTroopFeatures, stageOf,
} from "./frontGeometry.js";

const frame = createFrame({ west: 30, south: 46, east: 40, north: 52 });
const sides = [["Russia", "Belarus"], ["Ukraine"]];
const colorOf = (name) => `color:${name}`;
const near = (actual, expected, slack = 1e-6) => Math.abs(actual - expected) <= slack;

const record = ({ replay, troops = [[], []], status = "active", named = [], brief = {} }) => normalizeBattlefield({
  name: "Eastern Ukraine",
  status,
  sides,
  frame,
  troops: troops.map(encodeTroops),
  named,
  replay,
  brief,
});

const runOf = ({ days = 10, opens = 0, closes = days, status = "active" } = {}) => {
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  // Days 0 to 2 nothing moves. Days 3 to 6 one troop goes east a cell and a
  // half a day, then turns north for three days. Then it stands.
  for (let day = opens; day <= closes; day += 1) {
    const pushed = Math.max(0, Math.min(4, day - 2));
    const north = Math.max(0, Math.min(3, day - 6));
    recorder.record(day, [
      [
        { x: 9 + pushed * 1.5, y: 20 + north * 2, strength: 90 - day, state: (pushed > 0 && day <= 6) || (north > 0 && day <= 9) ? 1 : 0 },
        { x: 9, y: 5, strength: 80, state: 0 },
      ],
      [{ x: 12 + pushed * 1.5, y: 20, strength: day >= 5 ? 0 : 60, state: 0 }],
    ]);
  }
  return record({
    status,
    replay: recorder.finish({ date: "2024-03-01", days }),
    troops: [
      [{ x: 15, y: 26, strength: 80, kind: 1, owner: 1, named: true }, { x: 9, y: 5, strength: 80, kind: 0, owner: 0 }],
      [{ x: 18, y: 20, strength: 0, kind: 2, owner: 0 }],
    ],
    named: [{ s: 0, i: 0, name: "1st Guards Tank Army", unitId: "unit-1" }],
  });
};

test("a battlefield's troops are drawn as they were on any day of its run", () => {
  const stage = stageOf(frontViewOf(runOf()));
  assert.equal(stageOf(stage.view), stage, "readied once");
  assert.equal(stage.end, 10);

  const first = frontAt(stage, 0);
  assert.deepEqual(first.troops[0].map((troop) => [troop.x, troop.y]), [[9, 20], [9, 5]]);
  assert.equal(first.troops[0][0].way, null, "it has not gone anywhere yet");
  assert.deepEqual(
    { kind: first.troops[0][0].kind, owner: first.troops[0][0].owner, named: first.troops[0][0].named, label: first.troops[0][0].label },
    { kind: "armor", owner: "Belarus", named: true, label: "1st Guards Tank Army" },
  );
  assert.equal(first.troops[1][0].kind, "artillery");

  const moving = frontAt(stage, 3.5);
  assert.equal(moving.troops[0][0].moving, true);
  assert.equal(moving.troops[0][0].state, "advancing");
  assert.equal(moving.troops[0][1].moving, false);

  const last = frontAt(stage, 10);
  assert.ok(near(last.troops[0][0].x, 15, 1 / 16) && near(last.troops[0][0].y, 26, 1 / 16));
  assert.equal(last.troops[0][0].state, "holding");
  assert.equal(last.troops[1][0], null, "the fallen are not drawn");
  assert.equal(frontAt(stage, 4).troops[1][0].strength > 0, true);
  assert.deepEqual(frontAt(stage, 99).troops[0][0].x, last.troops[0][0].x);
});

test("a troop goes round a corner, and the way behind it is the way it went", () => {
  const stage = stageOf(frontViewOf(runOf()));
  // The corner is at (15, 20): it comes in from the west and leaves northward,
  // and is drawn cutting it a little on the inside.
  const before = frontAt(stage, 5).troops[0][0];
  const turning = frontAt(stage, 6).troops[0][0];
  const after = frontAt(stage, 7).troops[0][0];
  assert.ok(near(before.x, 13.5) && near(before.y, 20), "still on the straight");
  assert.ok(turning.x < 15 && turning.x > 14.5 && turning.y > 20 && turning.y < 20.5, `in the turn: ${turning.x}, ${turning.y}`);
  assert.ok(near(after.x, 15) && near(after.y, 22), "back on the straight");

  const { way } = frontAt(stage, 10).troops[0][0];
  const cells = [...way.xs].map((x, index) => [x, way.ys[index]]);
  assert.ok(cells.length >= 7, "a curve, not three points");
  assert.ok(near(cells[0][0], 9, 1e-6) && near(cells[0][1], 20, 1e-6));
  assert.ok(near(cells.at(-1)[0], 15, 1e-6) && near(cells.at(-1)[1], 26, 1e-6));
  assert.deepEqual([...way.days], [...way.days].sort((a, b) => a - b), "every point with the day it was there");
  // It never doubles back, and never swings outside the way it really went.
  for (let index = 1; index < cells.length; index += 1) {
    assert.ok(cells[index][0] >= cells[index - 1][0] - 1e-6 && cells[index][1] >= cells[index - 1][1] - 1e-6);
    assert.ok(cells[index][0] <= 15 + 1e-6 && cells[index][1] >= 20 - 1e-6);
  }
  // Part of the way through, the way behind it ends where it is, on that day.
  const part = frontAt(stage, 5).troops[0][0];
  assert.ok(near(part.way.xs.at(-1), part.x, 1e-9) && near(part.way.ys.at(-1), part.y, 1e-9));
  assert.equal(part.way.days.at(-1), 5);
  assert.ok(part.way.xs.length < way.xs.length);
  // One that never moved has none.
  assert.equal(frontAt(stage, 10).troops[0][1].way, null);
});

test("a troop that waits stops dead: the curve does not carry it past where it stood", () => {
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  for (let day = 0; day <= 12; day += 1) {
    const x = day <= 4 ? 10 + day : day <= 8 ? 14 : 14 + (day - 8);
    recorder.record(day, [[{ x, y: 10, strength: 80, state: 0 }], []]);
  }
  const stage = stageOf(frontViewOf(record({ replay: recorder.finish({ days: 12 }), troops: [[{ x: 18, y: 10, strength: 80 }], []] })));
  for (let day = 4; day <= 8; day += 0.25) assert.ok(near(frontAt(stage, day).troops[0][0].x, 14, 1e-9), `day ${day}`);
  for (let day = 0; day <= 12; day += 0.25) {
    const troop = frontAt(stage, day).troops[0][0];
    assert.ok(troop.x >= 10 - 1e-9 && troop.x <= 18 + 1e-9 && near(troop.y, 10, 1e-9));
  }
});

test("a battlefield is not drawn before it opened, nor once it has closed", () => {
  const opened = stageOf(frontViewOf(runOf({ opens: 4 })));
  assert.equal(frontAt(opened, 3.9), null);
  assert.equal(frontShownOn(opened, 3.9), false);
  assert.ok(frontAt(opened, 4));
  const closed = stageOf(frontViewOf(runOf({ closes: 6, status: "closed" })));
  assert.ok(frontAt(closed, 5.9));
  assert.equal(frontAt(closed, 6), null);
  assert.equal(frontShownOn(closed, 6), false);
  assert.equal(frontAt(stageOf(frontViewOf(record({ replay: null }))), 0), null, "nothing to draw without a run");
  // A list made for a day of the run is drawn from the same reading.
  const battlefield = runOf();
  const seen = battlefieldsAtDay([battlefield], 5, 2)[0];
  assert.equal(frontViewOf(seen).replay, frontViewOf(battlefield).replay);
  assert.deepEqual(frontAt(stageOf(frontViewOf(seen)), 4.5).troops[0][0].x, frontAt(stageOf(frontViewOf(battlefield)), 4.5).troops[0][0].x);
});

test("the troops are written out a point each, with one more a side for a view from far off", () => {
  const stage = stageOf(frontViewOf(runOf()));
  const { features } = frontTroopFeatures([frontAt(stage, 4), null], colorOf, { labelOf: (name) => name.split(" ").slice(0, 2).join(" ") });
  const troops = features.filter((feature) => feature.properties.what === "troop");
  const sideMarks = features.filter((feature) => feature.properties.what === "side");
  assert.equal(troops.length, 3);
  assert.deepEqual(
    troops.map((feature) => [feature.properties.side, feature.properties.index, feature.properties.owner, feature.properties.glyph, feature.properties.label]),
    [[0, 0, "Belarus", "A", "1st Guards"], [0, 1, "Russia", "I", ""], [1, 0, "Ukraine", "G", ""]],
  );
  assert.equal(troops[0].properties.rgb, "color:Belarus");
  assert.equal(troops[0].properties.state, "advancing");
  assert.equal(troops[0].properties.strength, 86);
  const { toLngLat } = projectorOf(frame);
  assert.deepEqual(troops[1].geometry.coordinates, toLngLat(9, 5));
  assert.deepEqual(sideMarks.map((feature) => [feature.properties.side, feature.properties.count, feature.properties.rgb]), [[0, 2, "color:Russia"], [1, 1, "color:Ukraine"]]);
  // Once a side's last troop has fallen it has no marker either.
  const later = frontTroopFeatures([frontAt(stage, 10)], colorOf).features;
  assert.deepEqual(later.filter((feature) => feature.properties.what === "side").map((feature) => feature.properties.side), [0]);
  assert.equal(frontTroopFeatures([null], colorOf).features.length, 0);
});

test("an arrow begins thin, broadens along the way, and has a head where the troop stands", () => {
  // Twenty days due east, a cell a day.
  const way = { xs: Float64Array.from({ length: 21 }, (_, day) => 10 + day), ys: new Float64Array(21).fill(8), days: Float64Array.from({ length: 21 }, (_, day) => day) };
  const half = 0.5;
  const ring = arrowRing(way, 20, half);
  assert.deepEqual(ring[0], ring.at(-1), "a closed shape");
  const tip = ring.reduce((best, point) => (point[0] > best[0] ? point : best));
  assert.ok(near(tip[0], 30) && near(tip[1], 8), "its point is where the troop stands");
  // How broad it is across, at a place along it.
  const breadthAt = (x) => {
    const near = ring.filter((point) => Math.abs(point[0] - x) < 0.01).map((point) => point[1]);
    return Math.max(...near) - Math.min(...near);
  };
  assert.ok(Math.abs(breadthAt(12) - 2 * half * 0.3) < 1e-6, "its tail, under a third of its width");
  assert.ok(Math.abs(breadthAt(22) - breadthAt(12)) < 1e-6, "thin for as long as it walked more than a few days ago");
  assert.ok(breadthAt(28) > breadthAt(26) && breadthAt(26) > breadthAt(24), "widening over the last days");
  assert.ok(breadthAt(28) > 2 * half * 0.7 && breadthAt(28) <= 2 * half, "nearly its full width where the head begins");
  const widest = Math.max(...ring.map((point) => Math.abs(point[1] - 8)));
  assert.ok(widest > half * 2 && widest < half * 2.6, "the head is broader than the shaft");
  assert.ok(ring.every((point) => point[0] >= 10 - 1e-9 && point[0] <= 30 + 1e-9), "and it lies along the way, no further");
  assert.equal(ARROW_FRESH_DAYS, 6);

  // A way too short to draw is no arrow; a short one is all head, and a smaller one.
  assert.equal(arrowRing({ xs: Float64Array.of(10, 10.1), ys: Float64Array.of(8, 8), days: Float64Array.of(0, 1) }, 1, half), null);
  const short = arrowRing({ xs: Float64Array.of(10, 11), ys: Float64Array.of(8, 8), days: Float64Array.of(0, 1) }, 1, half);
  assert.ok(Math.max(...short.map((point) => Math.abs(point[1] - 8))) < half * 2.3 * 0.6, "the same arrow, smaller");
  // Points that stand on the one before do not break it.
  const waited = { xs: Float64Array.of(10, 14, 14, 14, 18), ys: Float64Array.of(8, 8, 8, 8, 8), days: Float64Array.of(0, 4, 5, 6, 10) };
  assert.ok(arrowRing(waited, 10, half).every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])));
});

test("a way is written out as an arrow along its last days and a line along what was walked before", () => {
  const stage = stageOf(frontViewOf(runOf()));
  const coloursOf = (name) => ({ top: `top:${name}`, side: `side:${name}` });
  const options = { halfWidthOf: () => 0.4 };
  assert.equal(frontArrowFeatures([frontAt(stage, 2)], coloursOf, options).features.length, 0);
  const moving = frontArrowFeatures([frontAt(stage, 5)], coloursOf, options).features;
  assert.equal(moving.length, 1);
  assert.deepEqual(moving[0].properties, { battlefield: "Eastern Ukraine", side: 0, index: 0, troops: 1, rgb: "top:Belarus", dark: "side:Belarus", moving: true, past: false, alpha: 1 });
  assert.equal(moving[0].geometry.type, "Polygon");
  const ring = moving[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  const { toCell } = projectorOf(frame);
  const troop = frontAt(stage, 5).troops[0][0];
  assert.ok(ring.some(([lng, lat]) => { const [x, y] = toCell(lng, lat); return near(x, troop.x, 1e-6) && near(y, troop.y, 1e-6); }), "its point is where the troop is");
  // On day 10 it has been going for seven days: the first of them is a line,
  // the last six an arrow, and the one starts where the other stops.
  const both = frontArrowFeatures([frontAt(stage, 10), null], coloursOf, { ...options, day: [10] }).features;
  assert.deepEqual(both.map((feature) => [feature.geometry.type, feature.properties.past]), [["LineString", true], ["Polygon", false]]);
  const cut = toCell(...both[0].geometry.coordinates.at(-1));
  assert.ok(near(cut[1], 20, 1e-6) && cut[0] > 9 && cut[0] < 12, "where it was six days before");
  assert.equal(both[0].properties.rgb, "top:Belarus");
  // An arrow drawn for more days lies along more of the way, and the line is the shorter for it.
  const longer = frontArrowFeatures([frontAt(stage, 10), null], coloursOf, { ...options, day: [10], days: 12 }).features;
  assert.deepEqual(longer.map((feature) => [feature.geometry.type, feature.properties.past]), [["Polygon", false]], "all seven days of it are arrow");
  const spanOf = (feature) => {
    const cells = feature.geometry.coordinates[0].map(([lng, lat]) => toCell(lng, lat));
    return Math.max(...cells.map((cell) => cell[0])) - Math.min(...cells.map((cell) => cell[0]));
  };
  assert.ok(spanOf(longer[0]) > spanOf(both[1]) + 1, "and it reaches further back");
  // Long after it stopped, there is no arrow: only the line of the way it went.
  const settled = frontArrowFeatures([frontAt(stage, 10), null], coloursOf, { ...options, day: [20] }).features;
  assert.deepEqual(settled.map((feature) => [feature.geometry.type, feature.properties.past]), [["LineString", true]]);
  const end = toCell(...settled[0].geometry.coordinates.at(-1));
  assert.ok(near(end[0], 15, 1e-6) && near(end[1], 26, 1e-6), "all the way to where it stands");
  // From far off the way of one standing still is left out: the ground it took says where it went.
  assert.equal(frontArrowFeatures([frontAt(stage, 10), null], coloursOf, { ...options, day: [20], still: false }).features.length, 0);
  assert.equal(frontArrowFeatures([frontAt(stage, 10), null], coloursOf, { ...options, day: [10], still: false }).features.length, 2, "one still going keeps both");
  // And so is an arrow along a way shorter than is worth drawing from there.
  const short = frontArrowFeatures([frontAt(stage, 2.5)], coloursOf, { ...options, day: [2.5] }).features;
  assert.deepEqual(short.map((feature) => feature.properties.side), [0], "three quarters of a cell so far: the one pushing has a way, the one pushed back has none");
  assert.equal(frontArrowFeatures([frontAt(stage, 2.5)], coloursOf, { ...options, day: [2.5], leastOf: () => 2 }).features.length, 0);
  assert.equal(frontArrowFeatures([frontAt(stage, 5)], coloursOf, { ...options, day: [5], leastOf: () => 2 }).features.length, 1, "drawn once it has gone that far");
});

test("a troop that falls back has no way drawn, and when it goes forward again only the way it has come since", () => {
  // East for four days, back west for three, east again for three.
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  const xAt = (day) => (day <= 4 ? 10 + day * 2 : day <= 7 ? 18 - (day - 4) * 2 : 12 + (day - 7) * 2);
  for (let day = 0; day <= 10; day += 1) {
    recorder.record(day, [[{ x: xAt(day), y: 20, strength: 80, state: day === 0 || (day > 4 && day <= 7) ? 0 : 1 }], []]);
  }
  const stage = stageOf(frontViewOf(record({ replay: recorder.finish({ days: 10 }), troops: [[{ x: 18, y: 20, strength: 80 }], []] })));
  const wayOn = (day) => frontAt(stage, day).troops[0][0].way;
  assert.ok(wayOn(3), "going forward: a way");
  assert.ok(near(wayOn(3).xs[0], 10, 1e-6), "from where it set off");
  for (const day of [4.5, 6, 7]) assert.equal(wayOn(day), null, `falling back on day ${day}: none`);
  const again = wayOn(10);
  assert.ok(again, "forward again: a way");
  assert.ok(near(again.xs[0], 12, 0.5) && near(again.xs.at(-1), 18, 1e-6), `only from where it turned (${again.xs[0]} to ${again.xs.at(-1)})`);
  assert.ok(again.days[0] >= 7);
  // And it is drawn as one arrow, with no line left from the first advance.
  const drawn = frontArrowFeatures([frontAt(stage, 10)], (name) => ({ top: name, side: name }), { halfWidthOf: () => 0.4, day: [10] }).features;
  assert.deepEqual(drawn.map((feature) => feature.geometry.type), ["Polygon"]);
});

test("the marker seen from far off is a general's: one for each body of a side's troops, where it stands", () => {
  const standing = [[{ x: 10, y: 10, strength: 80 }, { x: 12, y: 10, strength: 60 }, { x: 40, y: 30, strength: 100 }, { x: 42, y: 34, strength: 0 }], [{ x: 50, y: 50, strength: 90 }]];
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  recorder.record(0, standing);
  const stage = stageOf(frontViewOf(record({ replay: recorder.finish({ days: 0 }), troops: standing, brief: { carry: { command: [[0, 0, 1, 1], [0]] } } })));
  const marks = frontTroopFeatures([frontAt(stage, 0)], colorOf).features.filter((feature) => feature.properties.what === "side");
  assert.deepEqual(marks.map((feature) => [feature.properties.side, feature.properties.command, feature.properties.count, feature.properties.strength]), [[0, 0, 2, 70], [0, 1, 1, 100], [1, 0, 1, 90]]);
  const { toLngLat } = projectorOf(frame);
  assert.deepEqual(marks[0].geometry.coordinates, toLngLat(11, 10));
  assert.deepEqual(marks[1].geometry.coordinates, toLngLat(40, 30), "the dead are not counted, nor where they lay");
  const troops = frontTroopFeatures([frontAt(stage, 0)], colorOf).features.filter((feature) => feature.properties.what === "troop");
  assert.deepEqual(troops.map((feature) => [feature.properties.side, feature.properties.command]), [[0, 0], [0, 0], [0, 1], [1, 0]]);
});

test("troops going the same way close together share one broader arrow; from closer in each has its own", () => {
  // Twelve troops go east abreast, two cells apart; a thirteenth goes north alone.
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  for (let day = 0; day <= 12; day += 1) {
    recorder.record(day, [
      [
        ...Array.from({ length: 12 }, (_, index) => ({ x: 10 + Math.max(0, day - 2) * 3 * (1 + index * 0.01), y: 10 + index * 2, strength: 80, state: day > 2 ? 1 : 0 })),
        { x: 60, y: 10 + Math.max(0, day - 2) * 3, strength: 80, state: 1 },
      ],
      [],
    ]);
  }
  const stage = stageOf(frontViewOf(record({
    replay: recorder.finish({ days: 12 }),
    troops: [Array.from({ length: 13 }, (_, index) => ({ x: 20, y: 10 + index * 2, strength: 80 })), []],
  })));
  const coloursOf = (name) => ({ top: `top:${name}`, side: `side:${name}` });
  // How broad an arrow is across the way it points: north to south for one
  // going east, east to west for one going north.
  const breadthOf = (feature, across) => {
    const { toCell } = projectorOf(frame);
    const reach = feature.geometry.coordinates[0].map(([lng, lat]) => toCell(lng, lat)[across]);
    return Math.max(...reach) - Math.min(...reach);
  };

  // From far off (an arrow is broad in cells): those within reach of the one
  // that leads share its arrow, the rest of the rank shares the next one's,
  // and the one going another way keeps its own.
  const arrowsOf = (features) => features.filter((feature) => !feature.properties.past);
  const far = arrowsOf(frontArrowFeatures([frontAt(stage, 12)], coloursOf, { day: [12], halfWidthOf: () => 1.2 }).features);
  const shared = far.filter((feature) => feature.properties.troops > 1);
  assert.ok(shared.length >= 1 && shared.length <= 4, `a broad front is a few arrows side by side: ${shared.length}`);
  assert.equal(shared.reduce((sum, feature) => sum + feature.properties.troops, 0) + far.filter((feature) => feature.properties.troops === 1).length, 13, "every troop is in exactly one");
  assert.ok(far.some((feature) => feature.properties.troops === 1 && feature.properties.index === 12), "the one going north is on its own");
  // A shared arrow is broader than one troop's, and lies in the middle of those that share it.
  const single = far.find((feature) => feature.properties.index === 12);
  assert.ok(shared.every((feature) => breadthOf(feature, 1) > breadthOf(single, 0) * 1.3), "broader, for being more");
  const groups = arrowGroupsOf(stage, 11, 1.2 * ARROW_MERGE_REACH);
  assert.ok(groups.length >= 1 && groups.every((group) => group.members.length >= 2));
  assert.equal(arrowGroupsOf(stage, 11, 1.2 * ARROW_MERGE_REACH), groups, "worked out once for a zoom");
  assert.equal(arrowGroupsOf(stage, 9.5, 1.2 * ARROW_MERGE_REACH), groups, "and for every day the same grouping covers");
  assert.equal(arrowGroupsOf(stage, 11, 1.2 * ARROW_MERGE_REACH * 1.01), groups, "nor again for a zoom a hair off");
  for (const group of groups) {
    const rows = group.members.map((member) => 10 + member * 2);
    // (A reach is rounded to one of a few to a doubling: a little slack.)
    assert.ok(Math.max(...rows) - Math.min(...rows) <= 2 * 1.2 * ARROW_MERGE_REACH * 1.7 * 1.07, "none further from its leader than counts as together");
  }

  // From close in (an arrow is narrow in cells) nobody is near enough to share.
  const near = arrowsOf(frontArrowFeatures([frontAt(stage, 12)], coloursOf, { day: [12], halfWidthOf: () => 0.1 }).features);
  assert.equal(near.length, 13);
  assert.ok(near.every((feature) => feature.properties.troops === 1));
  // Before any of them has set off there is no arrow at all.
  assert.equal(frontArrowFeatures([frontAt(stage, 2)], coloursOf, { day: [2], halfWidthOf: () => 1.2 }).features.length, 0);
});

// A front of `count` troops abreast, a cell apart, going east a cell and a
// half a day at paces of their own, with whoever `others(day)` adds.
const broadFront = ({ count = 40, days = 12, others = () => [], standing = [] } = {}) => {
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  for (let day = 0; day <= days; day += 1) {
    recorder.record(day, [
      [
        ...Array.from({ length: count }, (_, index) => ({ x: 8 + day * 1.5 * (1 + ((index * 7) % 5) * 0.02), y: 4 + index, strength: 80, state: 1 })),
        ...others(day),
      ],
      [],
    ]);
  }
  const extra = others(days);
  return stageOf(frontViewOf(record({
    replay: recorder.finish({ days }),
    troops: [[
      ...Array.from({ length: count }, (_, index) => ({ x: 26, y: 4 + index, strength: 80 })),
      ...extra.map((troop, index) => ({ x: troop.x, y: troop.y, strength: 80, ...(standing[index] ?? {}) })),
    ], []],
    named: standing.flatMap((entry, index) => (entry?.named ? [{ s: 0, i: count + index, name: "1st Guards Tank Army", unitId: "unit-1" }] : [])),
  })));
};
const twoColours = (name) => ({ top: `top:${name}`, side: `side:${name}` });
const arrowsIn = (features) => features.filter((feature) => !feature.properties.past);

test("the further off the map is seen from, the fewer the arrows and the more troops in each", () => {
  // In px on screen: troops share an arrow over a greater distance the
  // further off, an arrow must stand for a greater part of its side, and a
  // short movement or the way of one standing still is left out.
  const zooms = [4.5, 5, 6, 7, 8, 9];
  const details = zooms.map(arrowDetailAt);
  for (let index = 1; index < details.length; index += 1) {
    assert.ok(details[index].reach <= details[index - 1].reach, `reach at ${zooms[index]}`);
    assert.ok(details[index].share <= details[index - 1].share, `share at ${zooms[index]}`);
    assert.ok(details[index].least <= details[index - 1].least, `least at ${zooms[index]}`);
    assert.ok(details[index].halfWidth >= details[index - 1].halfWidth, "an arrow itself is no broader from far off");
    assert.ok(details[index].days <= details[index - 1].days, `days at ${zooms[index]}`);
  }
  // From far off an arrow lies along more days of the way, so it is about as
  // long on screen from anywhere and not a stub on a map of the whole front.
  assert.equal(arrowDetailAt(9).days, ARROW_FRESH_DAYS);
  assert.equal(arrowDetailAt(7).days, ARROW_FRESH_DAYS);
  assert.equal(arrowDetailAt(6).days, 2 * ARROW_FRESH_DAYS);
  assert.equal(arrowDetailAt(3).days, 20, "never more than twenty");
  assert.ok(details[0].reach > 1.5 * details.at(-1).reach);
  assert.ok(details[0].share > 0 && arrowDetailAt(10).share === 0 && arrowDetailAt(10).least === 0, "from close in everything is drawn");
  assert.equal(arrowDetailAt(ARROW_STILL_MIN_ZOOM - 0.1).still, false);
  assert.equal(arrowDetailAt(ARROW_STILL_MIN_ZOOM).still, true);

  // Forty troops abreast on forty cells of front, as the layers would draw
  // them at a zoom: a cell is so many px there.
  const stage = broadFront();
  const drawnAt = (zoom, day = 11) => {
    const detail = arrowDetailAt(zoom);
    const cellsOf = (px) => () => (px * 360) / (frame.cell * 512 * 2 ** zoom);
    return arrowsIn(frontArrowFeatures([frontAt(stage, day)], twoColours, {
      day: [day], halfWidthOf: cellsOf(detail.halfWidth), reachOf: cellsOf(detail.reach), leastOf: cellsOf(detail.least), still: detail.still, share: detail.share,
    }).features);
  };
  const counts = [5, 6, 7, 8, 10, 12].map((zoom) => drawnAt(zoom).length);
  for (let index = 1; index < counts.length; index += 1) assert.ok(counts[index] >= counts[index - 1], `never more from further off: ${counts}`);
  assert.ok(counts[0] <= 3, `a broad front from far off is a few arrows: ${counts}`);
  assert.equal(counts.at(-1), 40, `and close in every troop has its own: ${counts}`);
  const far = drawnAt(5);
  assert.equal(far.reduce((sum, feature) => sum + feature.properties.troops, 0), 40, "all of them in those few");
  assert.ok(far.every((feature) => feature.properties.troops >= 10));
});

test("from far off an arrow is drawn only for a fair part of a side, and always for a formation with a name", () => {
  // Beside the forty going east: two going north together, one going north
  // alone, and a formation with a name of its own going south.
  const stage = broadFront({
    others: (day) => [
      { x: 70, y: 10 + day * 1.5, strength: 80, state: 1 },
      { x: 71, y: 10 + day * 1.5, strength: 80, state: 1 },
      { x: 90, y: 10 + day * 1.5, strength: 80, state: 1 },
      { x: 80, y: 60 - day * 1.5, strength: 80, state: 1 },
    ],
    standing: [{}, {}, {}, { named: true, kind: 1 }],
  });
  const drawn = (share) => arrowsIn(frontArrowFeatures([frontAt(stage, 11)], twoColours, { day: [11], halfWidthOf: () => 0.4, reachOf: () => 6, share }).features);
  const all = drawn(0);
  assert.ok(all.some((feature) => feature.properties.troops === 2 && feature.properties.index === 40), "the two going north share one");
  assert.ok(all.some((feature) => feature.properties.troops === 1 && feature.properties.index === 42));
  assert.ok(all.some((feature) => feature.properties.troops === 1 && feature.properties.index === 43));
  assert.equal(all.reduce((sum, feature) => sum + feature.properties.troops, 0), 44);
  // A twentieth of forty-four is three troops: the pair and the one alone are
  // left out, and the named formation is not.
  const fair = drawn(0.05);
  assert.ok(fair.every((feature) => feature.properties.troops >= 3 || feature.properties.index === 43));
  assert.ok(fair.some((feature) => feature.properties.index === 43), "the formation with a name");
  assert.ok(!fair.some((feature) => feature.properties.index === 40 || feature.properties.index === 42));
  assert.equal(
    fair.reduce((sum, feature) => sum + feature.properties.troops, 0),
    1 + all.filter((feature) => feature.properties.troops >= 3).reduce((sum, feature) => sum + feature.properties.troops, 0),
  );
  // Their lines go with them.
  const lines = frontArrowFeatures([frontAt(stage, 11)], twoColours, { day: [11], halfWidthOf: () => 0.4, reachOf: () => 6, share: 0.05 }).features.filter((feature) => feature.properties.past);
  assert.ok(!lines.some((feature) => feature.properties.index === 40 || feature.properties.index === 42));
});

test("who shares an arrow is worked out for the days it covers, and one grouping fades into the next", () => {
  // Two troops go east side by side for nine days; then one turns north.
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  for (let day = 0; day <= 18; day += 1) {
    const east = Math.min(day, 9) * 2;
    const after = Math.max(0, day - 9) * 2;
    recorder.record(day, [[
      { x: 10 + east + after, y: 10, strength: 80, state: 1 },
      { x: 10 + east, y: 12 + after, strength: 80, state: 1 },
    ], []]);
  }
  const stage = stageOf(frontViewOf(record({ replay: recorder.finish({ days: 18 }), troops: [[{ x: 46, y: 10, strength: 80 }, { x: 28, y: 30, strength: 80 }], []] })));
  const drawn = (day) => arrowsIn(frontArrowFeatures([frontAt(stage, day)], twoColours, { day: [day], halfWidthOf: () => 0.5 }).features)
    .map((feature) => [feature.properties.troops, Math.round(feature.properties.alpha * 100) / 100]);
  assert.equal(ARROW_GROUP_DAYS, 3);
  // While they go together they share one, whole.
  assert.deepEqual(drawn(5), [[2, 1]]);
  assert.deepEqual(drawn(8.9), [[2, 1]]);
  assert.equal(arrowGroupsOf(stage, 8, 0.5 * ARROW_MERGE_REACH).length, 1);
  // Once they part they have one each, however long they went together before.
  assert.equal(arrowGroupsOf(stage, 12, 0.5 * ARROW_MERGE_REACH).length, 0);
  assert.deepEqual(drawn(12), [[1, 1], [1, 1]]);
  assert.deepEqual(drawn(18), [[1, 1], [1, 1]]);
  // Between, the one fades as the others come up: nothing jumps.
  assert.deepEqual(drawn(9), [[2, 1]], "as the grouping changes, still the old one whole");
  assert.deepEqual(drawn(9.5), [[2, 0.5], [1, 0.5], [1, 0.5]]);
  const early = drawn(9.25);
  const late = drawn(9.75);
  assert.ok(early[0][1] > 0.5 && early[1][1] < 0.5 && late[0][1] < 0.5 && late[1][1] > 0.5);
  assert.deepEqual(drawn(10), [[1, 1], [1, 1]]);
});

test("troops crossing each other's way do not share an arrow, however near", () => {
  // Two columns of four pass through the same place going opposite ways.
  const recorder = createReplayRecorder({ sides, cols: frame.cols, rows: frame.rows });
  for (let day = 0; day <= 6; day += 1) {
    recorder.record(day, [[
      ...Array.from({ length: 4 }, (_, index) => ({ x: 10 + day * 2, y: 10 + index * 0.5, strength: 80, state: 1 })),
      ...Array.from({ length: 4 }, (_, index) => ({ x: 22 - day * 2, y: 10.25 + index * 0.5, strength: 80, state: 1 })),
    ], []]);
  }
  const stage = stageOf(frontViewOf(record({
    replay: recorder.finish({ days: 6 }),
    troops: [[...Array.from({ length: 4 }, (_, index) => ({ x: 22, y: 10 + index * 0.5, strength: 80 })), ...Array.from({ length: 4 }, (_, index) => ({ x: 10, y: 10.25 + index * 0.5, strength: 80 }))], []],
  })));
  const arrows = arrowsIn(frontArrowFeatures([frontAt(stage, 5)], twoColours, { day: [5], halfWidthOf: () => 0.5, reachOf: () => 20 }).features);
  assert.deepEqual(arrows.map((feature) => feature.properties.troops).sort(), [4, 4]);
  const groups = arrowGroupsOf(stage, 5, 20);
  assert.deepEqual(groups.map((group) => [...group.members].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]), [[0, 1, 2, 3], [4, 5, 6, 7]]);
});

test("an arrow's colour is its side's hue made strong, so it shows on ground painted that side's colour", () => {
  const spread = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  const russia = frontArrowRgb([54, 91, 75]);
  const ukraine = frontArrowRgb([113, 143, 174]);
  assert.ok(spread(russia) > 2 * spread([54, 91, 75]));
  assert.ok(russia[1] > russia[0] && russia[1] > russia[2], "still a green");
  assert.ok(ukraine[2] > ukraine[0] && ukraine[2] >= ukraine[1], "still a blue");
  const grey = frontArrowRgb([90, 90, 90]);
  assert.ok(grey[0] === grey[1] && grey[1] === grey[2] && grey[0] > 150, "a grey stays grey, only lighter");
  for (const colour of [[0, 0, 0], [255, 255, 255], [255, 0, 0]]) {
    assert.ok(frontArrowRgb(colour).every((part) => Number.isInteger(part) && part >= 0 && part <= 255));
  }
});
