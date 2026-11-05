/*! Open Historia — the war room: what its panel and the map share: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/warRoomStore.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  closeWarRoom,
  getWarRoom,
  onWarRoomWay,
  openWarRoom,
  reportWarRoomWay,
  setWarRoom,
  showBattlefield,
  subscribeWarRoom,
  takeTool,
} from "./warRoomStore.js";

const watching = () => {
  let told = 0;
  const stop = subscribeWarRoom(() => { told += 1; });
  return { told: () => told, stop };
};

test("the war room opens on a battlefield with nothing in hand, and shuts to how it began", () => {
  closeWarRoom();
  const shut = getWarRoom();
  assert.deepEqual([shut.open, shut.battlefield, shut.side, shut.tool, shut.selected.length, shut.highlight], [false, "", -1, "pan", 0, -1]);
  const watch = watching();
  openWarRoom("The Alba Front", 1);
  const open = getWarRoom();
  assert.deepEqual([open.open, open.battlefield, open.side, open.tool], [true, "The Alba Front", 1, "pan"]);
  assert.ok(open.fit > shut.fit, "and asks for the battlefield to be fitted on the map");
  assert.equal(watch.told(), 1);
  closeWarRoom();
  assert.equal(getWarRoom(), shut, "the very same state as before");
  closeWarRoom();
  assert.equal(watch.told(), 2, "shutting what is shut tells nobody");
  watch.stop();
});

test("setting what is already there changes nothing and tells nobody", () => {
  closeWarRoom();
  openWarRoom("The Alba Front", 0);
  const watch = watching();
  setWarRoom({ selected: [3, 4, 5], highlight: 2 });
  const first = getWarRoom();
  assert.equal(watch.told(), 1);
  setWarRoom({ selected: [3, 4, 5], highlight: 2 });
  assert.equal(getWarRoom(), first, "the same lists and numbers: the same state");
  assert.equal(watch.told(), 1);
  setWarRoom({ selected: [3, 4] });
  assert.notEqual(getWarRoom(), first);
  assert.deepEqual([...getWarRoom().selected], [3, 4]);
  assert.throws(() => getWarRoom().selected.push(9), "what is shared cannot be changed behind the store's back");
  setWarRoom({ nonsense: true });
  assert.equal(getWarRoom().nonsense, undefined, "only what the store knows");
  setWarRoom(null);
  assert.equal(watch.told(), 2);
  watch.stop();
  closeWarRoom();
});

test("another battlefield puts down what was picked out on the last", () => {
  closeWarRoom();
  openWarRoom("The Alba Front", 0);
  setWarRoom({ selected: [1, 2], highlight: 1, tool: "route", pointed: "d1", plans: [{ id: "d1" }], known: [{ id: "known:0" }] });
  const before = getWarRoom().fit;
  showBattlefield("The Quiet Border", 1);
  const next = getWarRoom();
  assert.deepEqual([next.battlefield, next.side, next.tool, next.selected.length, next.highlight, next.pointed, next.plans.length, next.known.length], ["The Quiet Border", 1, "pan", 0, -1, "", 0, 0]);
  assert.ok(next.fit > before, "and the map is fitted to it");
  showBattlefield("The Quiet Border", 1);
  assert.equal(getWarRoom(), next, "the one already shown is left as it is");
  closeWarRoom();
});

test("a tool is taken up, and put down by taking it up again", () => {
  closeWarRoom();
  openWarRoom("The Alba Front", 0);
  takeTool("select");
  assert.equal(getWarRoom().tool, "select");
  takeTool("select");
  assert.equal(getWarRoom().tool, "pan");
  takeTool("replan", { replan: "project-1" });
  assert.deepEqual([getWarRoom().tool, getWarRoom().replan], ["replan", "project-1"]);
  // Another operation's arrow: still the tool, for that one.
  takeTool("replan", { replan: "project-2" });
  assert.deepEqual([getWarRoom().tool, getWarRoom().replan], ["replan", "project-2"]);
  takeTool("replan", { replan: "project-2" });
  assert.deepEqual([getWarRoom().tool, getWarRoom().replan], ["pan", ""]);
  takeTool("route");
  assert.equal(getWarRoom().replan, "", "no other tool keeps an operation in hand");
  takeTool("bulldozer");
  assert.equal(getWarRoom().tool, "route", "a tool there is not changes nothing");
  closeWarRoom();
});

test("a way drawn on the map is handed to whoever is listening, and to nobody once they have gone", () => {
  const heard = [];
  const stop = onWarRoomWay((tool, way, extra) => heard.push([tool, way.length, extra.replan ?? ""]));
  reportWarRoomWay("route", [[30, 50], [31, 50]]);
  reportWarRoomWay("replan", [[30, 50], [31, 50], [32, 50]], { replan: "project-1" });
  assert.deepEqual(heard, [["route", 2, ""], ["replan", 3, "project-1"]]);
  stop();
  reportWarRoomWay("route", [[30, 50], [31, 50]]);
  assert.equal(heard.length, 2);
  // A listener that fails does not take the map down with it.
  const quiet = console.error;
  console.error = () => {};
  try {
    const stopBad = onWarRoomWay(() => { throw new Error("no"); });
    assert.doesNotThrow(() => reportWarRoomWay("route", [[30, 50], [31, 50]]));
    stopBad();
  } finally {
    console.error = quiet;
  }
});
