// Run: node --test src/Game/Map/frontsController.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeTroops } from "../../runtime/fronts/codec.js";
import { createFrame } from "../../runtime/fronts/frame.js";
import { battlefieldsAtDay } from "../../runtime/fronts/record.js";
import { createReplayRecorder } from "../../runtime/fronts/replay.js";
import {
  adoptWorldForTest,
  getBattlefields,
  getFrontTargets,
  isAtTheFront,
  resetFrontsForTest,
  setFrontsOverride,
  settleFront,
  subscribeFronts,
} from "./frontsController.js";

const frame = createFrame({ west: 30, south: 46, east: 40, north: 52 });
const troopsAt = (col) => [[{ x: col - 1, y: 5, strength: 80 }], [{ x: col + 1, y: 5, strength: 60 }]];
const replayOfRun = ({ from = 30, to = 40, days = 31, opens = 0, closes = days, date = "2024-03-01" } = {}) => {
  const recorder = createReplayRecorder({ sides: [["Russia"], ["Ukraine"]], cols: frame.cols, rows: frame.rows });
  for (let day = opens; day <= closes; day += 1) recorder.record(day, troopsAt(from + ((to - from) * day) / days));
  return recorder.finish({ date, days });
};
const battlefield = (overrides = {}) => ({
  name: "Eastern Ukraine",
  status: "active",
  sides: [["Russia"], ["Ukraine"]],
  frame,
  troops: troopsAt(40).map(encodeTroops),
  replay: replayOfRun(),
  ...overrides,
});
// The world as a write hands it over: read back from disk, every object new.
const written = (list) => ({ battlefields: JSON.parse(JSON.stringify(list)) });
const listen = () => {
  let calls = 0;
  const stop = subscribeFronts(() => { calls += 1; });
  return { stop, count: () => calls };
};

test("what is on the list when a save is opened is shown as it stands", () => {
  resetFrontsForTest([battlefield()]);
  const [target] = getFrontTargets();
  assert.equal(target.name, "eastern ukraine");
  assert.equal(target.from, null);
  assert.equal(target.until, 31, "the day its run ended");
  assert.equal(target.fresh, false, "nothing of it is left to play");
  assert.equal(target.view.replay.days, 31);
  assert.equal(getBattlefields().length, 1);
  resetFrontsForTest([]);
  assert.deepEqual(getFrontTargets(), []);
  assert.deepEqual(getFrontTargets(), [], "a battlefield with no run kept has nothing to draw");
});

test("a write that changes nothing drawn is not a change, and a new run is one to be played", () => {
  resetFrontsForTest([battlefield()]);
  const before = getFrontTargets()[0];
  const heard = listen();

  adoptWorldForTest(written([battlefield()]));
  assert.equal(heard.count(), 0, "read back as new objects, with nothing in it changed");
  assert.equal(getFrontTargets()[0].run, before.run);

  adoptWorldForTest(written([battlefield({ replay: replayOfRun({ from: 40, to: 44, date: "2024-04-01" }), troops: troopsAt(44).map(encodeTroops) })]));
  assert.equal(heard.count(), 1);
  const next = getFrontTargets()[0];
  assert.notEqual(next.run, before.run);
  assert.equal(next.fresh, true, "a turn has landed: its fighting has not been shown");
  assert.equal(next.from, null);

  // Once the map has played it, it is not played again however the map is remade.
  settleFront(next);
  assert.equal(getFrontTargets()[0].fresh, false);
  // ...and the same run read back yet again is still the same run.
  adoptWorldForTest(written([battlefield({ replay: replayOfRun({ from: 40, to: 44, date: "2024-04-01" }), troops: troopsAt(44).map(encodeTroops) })]));
  assert.equal(heard.count(), 1);
  assert.equal(getFrontTargets()[0].run, next.run);
  heard.stop();
});

test("a turn being revealed shows the days each event covers, and the world waits behind it", () => {
  const list = [battlefield()];
  resetFrontsForTest(list);
  const whole = getFrontTargets()[0];
  const heard = listen();

  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 15, 10));
  assert.equal(heard.count(), 1);
  const shown = getFrontTargets()[0];
  assert.deepEqual([shown.from, shown.until], [10, 15]);
  assert.equal(shown.run, whole.run, "the same run, part of the way");
  assert.equal(shown.fresh, false);

  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 15, 10));
  assert.equal(heard.count(), 1, "the same days again are not a change");
  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 22, 15));
  assert.equal(heard.count(), 2);

  // A write that lands during the reveal is kept for when it ends.
  adoptWorldForTest(written([battlefield({ status: "frozen" })]));
  assert.equal(heard.count(), 2);
  assert.equal(getFrontTargets()[0].view.status, "active");
  setFrontsOverride(null);
  assert.equal(heard.count(), 3);
  const after = getFrontTargets()[0];
  assert.equal(after.view.status, "frozen");
  assert.deepEqual([after.from, after.until], [null, 31]);
  heard.stop();
});

test("a battlefield that has closed is drawn only while its last days are still to be played", () => {
  const closed = battlefield({ status: "closed", closedDate: "2024-03-21", replay: replayOfRun({ closes: 20 }) });
  resetFrontsForTest([closed]);
  assert.deepEqual(getFrontTargets(), [], "as it stands, it is over");
  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 12, 8));
  assert.equal(getFrontTargets()[0].view.status, "active");
  // The event that covers its closing plays its last days.
  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 25, 12));
  const [last] = getFrontTargets();
  assert.equal(last.view.status, "closed");
  assert.deepEqual([last.from, last.until], [12, 25]);
  // Shown after its end, there is nothing of it.
  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 30, 25));
  assert.deepEqual(getFrontTargets(), []);
  // One that has not opened yet is not on the list at all.
  resetFrontsForTest([battlefield({ replay: replayOfRun({ opens: 12 }) })]);
  setFrontsOverride(battlefieldsAtDay(getBattlefields(), 11, 5));
  assert.deepEqual(getFrontTargets(), []);
  setFrontsOverride(null);
});

test("a formation at a battlefield being fought over is drawn there, and nowhere else is it", () => {
  resetFrontsForTest([battlefield(), battlefield({ name: "The Caucasus", status: "closed" })]);
  assert.equal(isAtTheFront({ committedTo: "eastern  UKRAINE" }), true);
  assert.equal(isAtTheFront({ committedTo: "The Caucasus" }), false, "that one is over: it is a counter again");
  assert.equal(isAtTheFront({ committedTo: "Ukraine" }), false);
  assert.equal(isAtTheFront({ committedTo: "" }), false);
  assert.equal(isAtTheFront({}), false);
  assert.equal(isAtTheFront(null), false);
  resetFrontsForTest([]);
  assert.equal(isAtTheFront({ committedTo: "Eastern Ukraine" }), false);
});

// "it looks like built up troops are invisible in the released version" (the owner, 2026-11-03): forces built up in
// peace, at home or on a border, are a record standing, and only those fought over were drawn.
test("forces built up in peace are drawn on the map, and a formation among them is drawn there", () => {
  const home = battlefield({ name: "Russia home forces", status: "standing", home: true, warId: "", replay: replayOfRun({ days: 0, closes: 0 }) });
  resetFrontsForTest([home]);
  const [target] = getFrontTargets();
  assert.equal(target?.view.status, "standing");
  assert.equal(isAtTheFront({ committedTo: "Russia home forces" }), true);
  resetFrontsForTest([]);
});
