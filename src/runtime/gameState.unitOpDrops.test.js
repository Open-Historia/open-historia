/*! Open Historia — a dropped unit operation is said once: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.unitOpDrops.test.js
//
// normalizeEventImpacts says why it threw a unit operation away, because a
// dropped op is the difference between an event that narrates a deployment
// and troops on the map. But a turn's validators normalize the same raw events
// again and again before the turn is applied, and each pass said it again: a
// player's log (beta 0.0.66, 2026-10-05) has one line,
//   [ai] unitOps[1] dropped — spawn has unusable coordinates (lng=undefined, lat=undefined): (×18, last 05:33:48)
// for one spawn, in two seconds.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvents } from "./gameState.js";

// The operation the log printed: a fleet whose coordinates had been taken away.
const strandedSpawn = () => ({
  op: "spawn",
  unit: {
    composition: "крейсер «Москва», БПК «Керчь», СКР «Сметливый», БДК «Цезарь Куников», БДК «Ямал»",
    id: "ru-bsf-squadron",
    name: "Отряд кораблей Черноморского флота",
    note: "После сентябрьского учения держит постоянное присутствие в центральной части Чёрного моря.",
    ownerCode: "Russian Federation",
    posture: "patrol",
    strength: 100,
    type: "naval",
    regionId: "",
  },
});
const goodSpawn = () => ({ op: "spawn", unit: { id: "ru-guards", name: "1st Guards Army", ownerCode: "Russian Federation", type: "armor", strength: 100, lng: 36.2, lat: 50 } });
const eventWith = (unitOps) => ({ title: "Черноморский флот выходит в море", date: "2014-09-12", impacts: { unitOps } });

test("the same dropped op is reported once, however many times the event is normalized", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const raw = [eventWith([goodSpawn(), strandedSpawn()])];
  for (let pass = 0; pass < 18; pass += 1) {
    const [event] = normalizeEvents(raw);
    assert.deepEqual(event.impacts.unitOps.map((op) => op.unit.id), ["ru-guards"], "dropped on every pass, as before");
  }
  assert.equal(warn.mock.callCount(), 1);
  const [message, entry] = warn.mock.calls[0].arguments;
  assert.equal(message, "[ai] unitOps[1] dropped — spawn has unusable coordinates (lng=undefined, lat=undefined):");
  assert.equal(entry, raw[0].impacts.unitOps[1], "with the operation itself, for the report");
});

test("each dropped op is reported, and an event copied around its ops says nothing new", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const noDestination = { op: "move", unitId: "ru-guards" };
  const noOwner = { op: "spawn", unit: { name: "Nobody's Army", lng: 30, lat: 50 } };
  const raw = eventWith([strandedSpawn(), noDestination, noOwner]);
  normalizeEvents([raw]);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]), [
    "[ai] unitOps[0] dropped — spawn has unusable coordinates (lng=undefined, lat=undefined):",
    "[ai] unitOps[1] dropped — move has unusable destination (toLng=undefined, toLat=undefined):",
    "[ai] unitOps[2] dropped — spawn has no owner:",
  ]);
  // The repair's trial copies, a merged segment: new event and impacts objects
  // around the same operations.
  normalizeEvents([{ ...raw, impacts: { ...raw.impacts, unitOps: [...raw.impacts.unitOps] } }]);
  assert.equal(warn.mock.callCount(), 3);
});

test("the same mistake in another answer is another op, and is reported again", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  normalizeEvents([eventWith([strandedSpawn()])]);
  normalizeEvents([eventWith([strandedSpawn()])]);
  assert.equal(warn.mock.callCount(), 2);
});

test("an entry that is not an object is reported each time, as it always was", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const raw = [eventWith(["spawn the fleet", null])];
  normalizeEvents(raw);
  normalizeEvents(raw);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]), [
    "[ai] unitOps[0] dropped — not an object:",
    "[ai] unitOps[1] dropped — not an object:",
    "[ai] unitOps[0] dropped — not an object:",
    "[ai] unitOps[1] dropped — not an object:",
  ]);
});
