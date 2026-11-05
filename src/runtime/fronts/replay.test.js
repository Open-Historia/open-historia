// Run: node --test src/runtime/fronts/replay.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { PAINT_OWN_A, PAINT_OWN_B, PAINT_WALL, decodePaint, decodeStates, decodeTracks } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL } from "./constants.js";
import {
  MAX_REPLAY_CHARS,
  MAX_TRACK_POINTS,
  TRACK_TOLERANCE,
  createReplayRecorder,
  normalizeReplay,
  replayBetween,
  replayDayOn,
  replayOf,
  replayWindowOf,
  stillReplayOf,
  trackAt,
  shownOwnersAt,
} from "./replay.js";

const COLS = 40;
const ROWS = 20;
const frame = { cols: COLS, rows: ROWS };
const sides = [["Russia", "Belarus"], ["Ukraine"]];
const troop = (x, y, strength = 80, state = 0) => ({ x, y, strength, state });
const at = (col, row) => row * COLS + col;

// Ground with side A west of `line` and side B east of it, a strip of sea
// along the south, and the home ground of the two meeting at column 20.
const groundAt = (line, { painterNorth = 0, when = null } = {}) => {
  const holders = new Uint8Array(COLS * ROWS);
  const painters = new Uint8Array(COLS * ROWS);
  const homes = new Uint8Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = at(col, row);
      holders[cell] = row === 0 ? HOLDER_WALL : col < line ? HOLDER_SIDE_A : HOLDER_SIDE_B;
      homes[cell] = row === 0 ? 2 : col < 20 ? 0 : 1;
      painters[cell] = row >= ROWS / 2 ? painterNorth : 0;
    }
  }
  return { holders, painters, homes, ...(when ? { when } : {}) };
};

test("a run is kept as the ground it began with, every cell that changed hands with its time, and each troop's path", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  // Days 0 to 3 nothing moves; days 4 to 6 side A takes a column a day, and
  // one troop goes with it; then it stands until day 10.
  for (let day = 0; day <= 10; day += 1) {
    const pushed = Math.max(0, Math.min(3, day - 3));
    recorder.record(day, [
      [troop(19 + pushed, 10, 80, pushed > 0 && day <= 6 ? 1 : 0), troop(19, 15)],
      [troop(22 + pushed, 10, 70)],
    ], groundAt(20 + pushed, { painterNorth: 1 }));
  }
  const replay = recorder.finish({ date: "2024-03-01", days: 10 });
  assert.deepEqual([replay.d, replay.n, replay.s, replay.e], ["2024-03-01", 10, 0, 10]);
  assert.deepEqual(replay.names, ["Russia", "Belarus", "Ukraine"]);

  // As it began: home ground is not painted, but whose it is is known; the sea is wall.
  const began = decodeStates(replay.m, COLS * ROWS);
  assert.equal(began[at(5, 5)], PAINT_OWN_A);
  assert.equal(began[at(30, 5)], PAINT_OWN_B);
  assert.equal(began[at(5, 0)], PAINT_WALL);
  // Then a column a day: 19 cells of land each, in the name of whose troops took them.
  const log = decodePaint(replay.p);
  assert.equal(log.cells.length, 3 * (ROWS - 1));
  assert.deepEqual([...new Set(log.ticks)], [64, 80, 96], "at the end of days 4, 5 and 6");
  const south = [...log.cells].findIndex((cell) => cell === at(20, 5));
  const north = [...log.cells].findIndex((cell) => cell === at(20, 15));
  assert.equal(log.states[south], 1, "Russia's");
  assert.equal(log.states[north], 2, "Belarus's");
  assert.ok([...log.cells].every((cell) => cell % COLS >= 20 && cell % COLS <= 22 && Math.floor(cell / COLS) >= 1));

  const [sideA, sideB] = [decodeTracks(replay.t[0]), decodeTracks(replay.t[1])];
  assert.equal(sideA.length, 2);
  assert.equal(sideB.length, 1);
  assert.deepEqual(sideA[1], [{ day: 0, x: 19, y: 15, strength: 80, state: 0 }], "a troop that never moved is one point");
  const moved = sideA[0];
  assert.deepEqual(moved.map((sample) => sample.day), [0, 3, 6, 10], "where it waited, where it set off, where it stopped, and that it held there");
  assert.equal(moved[2].x, 22);
  assert.equal(moved[2].state, 1, "what it was doing on the way");
  assert.equal(moved[3].state, 0);
  assert.equal(trackAt(moved, 5).state, 1);
  assert.equal(trackAt(moved, 8).state, 0);
  // Where it was is right on every day, not only at the points kept.
  for (let day = 0; day <= 10; day += 1) {
    const where = trackAt(moved, day);
    assert.ok(Math.abs(where.x - (19 + Math.max(0, Math.min(3, day - 3)))) <= TRACK_TOLERANCE + 1 / 16, `day ${day}`);
  }
  assert.equal(trackAt(moved, 4.5).moving, true);
  assert.equal(trackAt(moved, 2).moving, false);
  assert.equal(trackAt(moved, 9).moving, false);
});

test("ground is painted only where it is held away from home, and unpainted when it is taken back", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  recorder.record(0, [[], []], groundAt(20));
  recorder.record(1, [[], []], groundAt(23)); // A takes three columns of B's home ground
  recorder.record(2, [[], []], groundAt(18)); // B takes them back and two of A's
  recorder.record(3, [[], []], groundAt(20)); // and A takes those back: as it began
  const replay = recorder.finish({ days: 3 });
  const read = replayOf({ frame, replay: normalizeReplay(replay) });
  const stateOn = (day, cell) => {
    let state = read.paint.began[cell];
    for (let index = 0; index < read.paint.cells.length && read.paint.ticks[index] <= day * 16; index += 1) {
      if (read.paint.cells[index] === cell) state = read.paint.states[index];
    }
    return state;
  };
  assert.equal(stateOn(1, at(21, 5)), 1, "painted Russia's");
  assert.equal(stateOn(2, at(21, 5)), PAINT_OWN_B, "back with its own side: no paint");
  assert.equal(stateOn(2, at(19, 5)), 3, "painted Ukraine's");
  assert.equal(stateOn(3, at(19, 5)), PAINT_OWN_A);
  assert.equal(stateOn(3, at(21, 5)), PAINT_OWN_B);
});

test("a cell is painted at the moment in the day its troop reached it", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  recorder.record(0, [[], []], groundAt(20));
  const when = new Float32Array(COLS * ROWS).fill(9);
  for (let row = 1; row < ROWS; row += 1) {
    when[at(20, row)] = 0.25;
    when[at(21, row)] = 0.5;
    when[at(22, row)] = Number.NaN;
  }
  recorder.record(1, [[], []], groundAt(23, { when }));
  const log = decodePaint(recorder.finish({ days: 1 }).p);
  const tickOf = (col) => log.ticks[[...log.cells].findIndex((cell) => cell === at(col, 5))];
  assert.deepEqual([tickOf(20), tickOf(21), tickOf(22)], [4, 8, 16], "a quarter and a half of the way through the day; the end of it where nothing says");
  assert.deepEqual([...log.ticks], [...log.ticks].sort((a, b) => a - b), "in order of time");
});

test("a path keeps its bends, and a troop is where it was when it was", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  // East for ten days, then north for ten: a corner, not a diagonal.
  for (let day = 0; day <= 20; day += 1) {
    recorder.record(day, [[troop(10 + Math.min(day, 10), 5 + Math.max(0, day - 10))], []]);
  }
  const [path] = decodeTracks(recorder.finish({ days: 20 }).t[0]);
  assert.deepEqual(path.map((sample) => [sample.day, sample.x, sample.y]), [[0, 10, 5], [10, 20, 5], [20, 20, 15]]);

  // A troop that waits and then runs is not shown ambling the whole way.
  const waiting = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 20; day += 1) waiting.record(day, [[troop(day < 15 ? 10 : 10 + (day - 15) * 2, 10)], []]);
  const [late] = decodeTracks(waiting.finish({ days: 20 }).t[0]);
  assert.deepEqual(late.map((sample) => sample.day), [0, 15, 20]);
  assert.equal(trackAt(late, 14).x, 10);
});

test("a troop raised during the run starts there, and one that falls ends there", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 8; day += 1) {
    const side = [troop(5, 5, day >= 4 ? 0 : 80 - day * 20)];
    if (day >= 3) side.push(troop(6, 6 + (day - 3), 60));
    recorder.record(day, [side, []]);
  }
  const [fallen, raised] = decodeTracks(recorder.finish({ days: 8 }).t[0]);
  assert.equal(fallen.at(-1).day, 4);
  assert.equal(fallen.at(-1).strength, 0);
  assert.equal(trackAt(fallen, 8).strength, 0);
  assert.equal(raised[0].day, 3);
  assert.equal(trackAt(raised, 2), null, "not there before it was raised");
  assert.equal(trackAt(raised, 8).y, 11);
});

test("a battlefield that opens during the run begins its replay that day, and one that closes ends it", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 12; day <= 15; day += 1) recorder.record(day, [[troop(19, 5)], [troop(22, 5)]], groundAt(20 + (day - 12)));
  const replay = recorder.finish({ date: "1939-09-01", days: 30 });
  assert.deepEqual([replay.s, replay.e, replay.n], [12, 15, 30]);
  assert.equal(decodeTracks(replay.t[0])[0][0].day, 12);
  assert.equal(decodePaint(replay.p).ticks[0], 13 * 16, "the first change is on its second day");
});

test("a path with more turns than can be kept is kept coarser, ends and all", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 300; day += 1) recorder.record(day, [[troop(20 + (day % 2) * 3, 10 + day * 0.02)], []]);
  const [path] = decodeTracks(recorder.finish({ days: 300 }).t[0]);
  assert.ok(path.length <= MAX_TRACK_POINTS);
  assert.equal(path[0].day, 0);
  assert.equal(path.at(-1).day, 300);
});

test("a replay too big to save keeps the ground as it ended, with nothing of how it came to be so", () => {
  const big = 200;
  const recorder = createReplayRecorder({ sides, cols: big, rows: big });
  const holders = new Uint8Array(big * big).fill(HOLDER_SIDE_B);
  const homes = new Uint8Array(big * big).fill(1);
  const painters = new Uint8Array(big * big);
  recorder.record(0, [[], []], { holders, painters, homes });
  // Side A takes the whole of it in two days, every other cell a day: forty
  // thousand changes, no two of which lie side by side at one moment.
  for (let day = 1; day <= 2; day += 1) {
    for (let cell = 0; cell < big * big; cell += 1) {
      if ((cell + Math.floor(cell / big) + day) % 2 === 0) holders[cell] = HOLDER_SIDE_A;
    }
    recorder.record(day, [[], []], { holders, painters, homes });
  }
  const replay = recorder.finish({ days: 2 });
  assert.ok(replay.m.length + replay.p.length + replay.t[0].length + replay.t[1].length <= MAX_REPLAY_CHARS);
  assert.equal(replay.p.length, 0);
  assert.ok(decodeStates(replay.m, big * big).every((state) => state === 1), "all of it painted, as it ended");
});

test("ground taken a strip at a time is kept in far fewer letters than a cell at a time", () => {
  const big = 200;
  const recorder = createReplayRecorder({ sides, cols: big, rows: big });
  const holders = new Uint8Array(big * big).fill(HOLDER_SIDE_B);
  const homes = new Uint8Array(big * big).fill(1);
  const painters = new Uint8Array(big * big);
  recorder.record(0, [[], []], { holders, painters, homes });
  for (let day = 1; day <= big; day += 1) {
    holders.fill(HOLDER_SIDE_A, (day - 1) * big, day * big);
    recorder.record(day, [[], []], { holders, painters, homes });
  }
  const replay = recorder.finish({ days: big });
  assert.ok(replay.p.length > 0 && replay.p.length < 6000, `forty thousand cells in ${replay.p.length} letters`);
  assert.equal(decodePaint(replay.p).cells.length, big * big);
});

test("the same run gives the same replay", () => {
  const run = () => {
    const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
    for (let day = 0; day <= 30; day += 1) {
      recorder.record(day, [
        Array.from({ length: 20 }, (_, index) => troop(8 + day * 0.31 + index * 0.01, 2 * index + (day % 7) * 0.2, 90 - day, day % 3 === 0 ? 1 : 0)),
        Array.from({ length: 12 }, (_, index) => troop(13 + day * 0.4, 3 * index, 70)),
      ], groundAt(20 + Math.floor(day / 3)));
    }
    return JSON.stringify(recorder.finish({ date: "1914-08-01", days: 30 }));
  };
  assert.equal(run(), run());
});

test("a saved replay is held to its shape, and passes through whole a second time", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 5; day += 1) recorder.record(day, [[troop(9 + day, 5)], [troop(12 + day, 5)]], groundAt(20 + day));
  const saved = JSON.parse(JSON.stringify(recorder.finish({ date: "2024-03-01", days: 5 })));
  const replay = normalizeReplay(saved);
  assert.deepEqual(replay, saved);
  assert.equal(normalizeReplay(replay), replay);

  assert.equal(normalizeReplay(null), null);
  assert.equal(normalizeReplay({ m: saved.m }), null, "nothing to say where its troops are");
  const odd = normalizeReplay({
    d: "  2024-03-01 ",
    n: 9,
    s: 40,
    e: 3,
    t: ["A;B", 7],
    names: ["Russia", 7, "  the   Free State  "],
    m: "not packed!",
    p: saved.p,
    until: 99,
  });
  assert.deepEqual([odd.d, odd.n, odd.s, odd.e], ["2024-03-01", 9, 9, 9], "no day is past the run's end, and it does not end before it begins");
  assert.deepEqual(odd.t, ["A;B", ""]);
  assert.deepEqual(odd.names, ["Russia", "7", "the Free State"]);
  assert.equal(odd.m, "");
  assert.equal(odd.p, saved.p);
  assert.deepEqual([odd.from, odd.until], [9, 9]);
  assert.equal(normalizeReplay({ t: ["", ""] }).e, 0);
  assert.equal(normalizeReplay({ t: ["", ""], n: 12 }).e, 12, "a replay with no end of its own ends with the run");
});

test("a replay is read once, and a copy made to be shown part of the way shares the reading", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 5; day += 1) recorder.record(day, [[troop(9 + day, 5)], []], groundAt(20 + day));
  const battlefield = { frame, replay: normalizeReplay(recorder.finish({ date: "2024-03-01", days: 5 })) };
  const read = replayOf(battlefield);
  assert.deepEqual([read.days, read.start, read.end], [5, 0, 5]);
  assert.equal(read.tracks[0].length, 1);
  assert.equal(read.paint.began.length, COLS * ROWS);
  assert.equal(read.paint.cells.length, 5 * (ROWS - 1));
  assert.deepEqual(read.paint.names, ["Russia", "Belarus", "Ukraine"]);
  assert.equal(replayOf(battlefield), read);
  assert.equal(replayWindowOf(battlefield), null);

  const part = { frame, replay: replayBetween(battlefield.replay, 1, 3) };
  assert.equal(replayOf(part), read);
  assert.deepEqual(replayWindowOf(part), { from: 1, until: 3 });
  assert.equal(normalizeReplay(part.replay), part.replay);
  assert.deepEqual(replayWindowOf({ replay: replayBetween(battlefield.replay, 4, 99) }), { from: 4, until: 5 });
  assert.equal(replayOf({}), null);
  assert.equal(replayOf({ replay: null }), null);
});

test("a date is placed in the run, on any calendar the game reads", () => {
  const replay = { d: "2024-03-01", n: 30, s: 0, e: 30, t: ["", ""], names: [], m: "", p: "" };
  assert.equal(replayDayOn(replay, "2024-03-01"), 0);
  assert.equal(replayDayOn(replay, "2024-03-16"), 15);
  assert.equal(replayDayOn(replay, "2024-12-01"), 30);
  assert.equal(replayDayOn(replay, "2023-01-01"), 0);
  assert.equal(replayDayOn(replay, ""), null);
  assert.equal(replayDayOn(replay, "the third age"), null);
  assert.equal(replayDayOn(null, "2024-03-01"), null);
  assert.equal(replayDayOn({ ...replay, d: "-0219-03-01" }, "-0219-03-11"), 10);
});

test("a replay with nothing left to play is the ground as it ended and where every troop ended", () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 9; day += 1) {
    recorder.record(day, [[troop(9 + day, 5), troop(4, 4, day >= 5 ? 0 : 50)], [troop(12 + day, 5, 70)]], groundAt(20 + day));
  }
  const battlefield = { frame, replay: normalizeReplay(recorder.finish({ date: "2024-03-01", days: 9 })) };
  const still = stillReplayOf(battlefield);
  assert.deepEqual([still.n, still.s, still.e, still.p], [0, 0, 0, ""]);
  const ground = decodeStates(still.m, COLS * ROWS);
  assert.equal(ground[at(25, 5)], 1, "what was taken is painted");
  assert.equal(ground[at(35, 5)], PAINT_OWN_B);
  assert.equal(ground[at(5, 0)], PAINT_WALL);
  const [moved, fallen] = decodeTracks(still.t[0]);
  assert.deepEqual(moved, [{ day: 0, x: 18, y: 5, strength: 80, state: 0 }]);
  assert.equal(fallen[0].strength, 0, "the fallen keep their place in the list");
  assert.ok(JSON.stringify(still).length < JSON.stringify(battlefield.replay).length / 2);
  assert.equal(normalizeReplay(still), still);
  assert.equal(stillReplayOf({ replay: null }), null);
});

test("a replay says whose each region the fighting reached is drawn as, through the run", () => {
  const recorder = createReplayRecorder({ sides: [["Russia"], ["Ukraine"]], cols: 4, rows: 4 });
  const still = [[{ x: 1, y: 1, strength: 80, state: 0 }], []];
  for (let day = 0; day <= 12; day += 1) recorder.record(day, still);
  // Carried over from the run before: taken in name, still drawn as Ukraine's.
  recorder.shown(0, "region-9", "Ukraine");
  // Day 3: region-4 changes hands in name. Nothing changes on the map, and the map is told what to go on drawing.
  recorder.shown(3, "region-4", "Ukraine");
  recorder.shown(3, "region-4", "Ukraine");
  // Day 7: it is held in full. Day 10: so is region-9. Day 11: region-4 is won back whole.
  recorder.shown(7, "region-4", "Russia", "Ukraine");
  recorder.shown(10, "region-9", "Russia", "Ukraine");
  recorder.shown(11, "region-4", "Ukraine", "Russia");
  // One never told of before, with what it was drawn as given.
  recorder.shown(12, "region-2", "Russia", "Ukraine");
  recorder.shown(5, "", "Russia");
  recorder.shown(5, "region-1", "");
  const replay = normalizeReplay(recorder.finish({ date: "2024-03-01", days: 12 }));
  assert.deepEqual(replay.o, [["region-9", "Ukraine"], ["region-4", "Ukraine"], ["region-2", "Ukraine"]]);
  assert.deepEqual(replay.f, [[7, "region-4", "Russia"], [10, "region-9", "Russia"], [11, "region-4", "Ukraine"], [12, "region-2", "Russia"]]);
  assert.equal(normalizeReplay(JSON.parse(JSON.stringify(replay))).o.length, 3, "it comes back from a save");

  const on = (day) => shownOwnersAt(replay, day);
  assert.deepEqual(on(0), { "region-9": "Ukraine", "region-4": "Ukraine", "region-2": "Ukraine" });
  assert.deepEqual(on(6.9), on(0));
  assert.equal(on(6.9), on(0), "the same object for as long as nothing has changed");
  assert.deepEqual(on(7), { "region-9": "Ukraine", "region-4": "Russia", "region-2": "Ukraine" });
  assert.deepEqual(on(10.5), { "region-9": "Russia", "region-4": "Russia", "region-2": "Ukraine" });
  assert.deepEqual(on(12), { "region-9": "Russia", "region-4": "Ukraine", "region-2": "Russia" });
  assert.deepEqual(on(3), on(0), "and back again, for a run played from its start");
  // A copy made to show part of the run speaks of the same regions.
  assert.equal(shownOwnersAt(replayBetween(replay, 2, 8), 8), on(8));

  // A run in which no region changed hands says nothing of regions at all.
  const plain = createReplayRecorder({ sides: [["Russia"], ["Ukraine"]], cols: 4, rows: 4 });
  plain.record(0, still);
  plain.record(1, still);
  const none = normalizeReplay(plain.finish({ days: 1 }));
  assert.equal("o" in none, false);
  assert.equal(shownOwnersAt(none, 1), null);
  assert.equal(shownOwnersAt(null, 1), null);

  // What is damaged is dropped, and a change is kept only for a region the replay speaks of.
  const mended = normalizeReplay({ ...JSON.parse(JSON.stringify(replay)), o: [["region-9", "Ukraine"], ["region-9", "Russia"], ["", "x"], ["region-3", 7], "region-5"], f: [[99, "region-9", "Russia"], [2, "region-8", "Russia"], [1, "region-9", ""]] });
  assert.deepEqual(mended.o, [["region-9", "Ukraine"]]);
  assert.deepEqual(mended.f, [[12, "region-9", "Russia"]], "a day past the end is the end");
});
