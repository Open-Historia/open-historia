/*! Open Historia — the war room's writes for fortified lines and fleets: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warRoomWrites.test.js
//
// A fortified line or a fleet's order is written as the war room's own ops
// are: never while a turn runs, through the write queue on the world as it
// stands, and held to the map read for it. Driven against an in-memory runtime
// store behind a stubbed fetch, the way the page talks to the local server.

import test from "node:test";
import assert from "node:assert/strict";

import { setRuntimeAssetEndpoints } from "./assets.js";
import { readWorldState } from "./gameState.js";
import { TURN_RUNNING_REFUSAL, sendFleetOp, sendFortifyOp } from "./warRoomWrites.js";

const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  const key = match ? match[1] : null;
  if (!key) return new Response("not found", { status: 404 });
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    store.set(key, String(init.body));
    return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!store.has(key)) return new Response("missing", { status: 404 });
  return new Response(store.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

const reset = () => {
  store.clear();
  setRuntimeAssetEndpoints({ token: "campaign-war-room" });
  store.set("game", JSON.stringify({ country: "Aland", gameDate: "1914-08-01", round: 3 }));
  store.set("world", JSON.stringify({
    units: [{ id: "u1", name: "Home Fleet", type: "naval", ownerCode: "Aland", strength: 80, lng: 5.5, lat: 52.5, status: "idle", posture: "patrol" }],
    wars: [{ id: "w1", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }],
  }));
};
// A chart of a map that is all Aland's land south of 53°N and sea north of it.
const chart = {
  sea: (lng, lat) => lat > 53,
  joins: (from, to) => to[1] > 53,
  holds: (country, lng, lat) => (lat > 53 ? null : country === "Aland"),
  coastOff: () => [5.5, 53.2],
};
const reading = (value = chart) => {
  const reads = [];
  return { reads, readChart: async () => { reads.push(true); return value; } };
};
const LINE = { op: "fortify", points: [[1, 51], [1.6, 51.4]], level: 5, name: "The Line" };

test("a line is built on the world as it stands, held to the map read for it, and never while a turn runs", async () => {
  reset();
  const busy = reading();
  await assert.rejects(sendFortifyOp(LINE, { turnRunning: () => true, readChart: busy.readChart }), new RegExp(TURN_RUNNING_REFUSAL.slice(0, 30)));
  assert.equal(busy.reads.length, 0, "the map is not read for a write that cannot be made");
  const map = reading();
  await sendFortifyOp(LINE, { readChart: map.readChart });
  assert.equal(map.reads.length, 1);
  const world = await readWorldState({ force: true });
  assert.deepEqual(world.fortifications.map((line) => [line.owner, line.level, line.name, line.building.since]), [["Aland", 5, "The Line", "1914-08-01"]]);
  // Refused in words: off its own ground, or with no map to see it on.
  await assert.rejects(sendFortifyOp({ ...LINE, points: [[1, 53.5], [1.6, 53.9]] }, { readChart: map.readChart }), /only over water/);
  await assert.rejects(sendFortifyOp(LINE, { readChart: reading(null).readChart }), /could not be read/);
  await assert.rejects(sendFortifyOp(LINE, { readChart: async () => { throw new Error("no map"); } }), /could not be read/);
  await assert.rejects(sendFortifyOp({ op: "raze" }), /Nothing was asked/);
  // Giving a line up needs no map.
  const id = (await readWorldState({ force: true })).fortifications[0].id;
  const stop = reading();
  await sendFortifyOp({ op: "unfortify", id }, { readChart: stop.readChart });
  assert.equal(stop.reads.length, 0);
  assert.deepEqual((await readWorldState({ force: true })).fortifications, []);
});

test("a fleet's order is written for the player's own fleet, and the map is read only for one that sends it somewhere", async () => {
  reset();
  const posture = reading();
  await sendFleetOp({ op: "posture", unit: "u1", posture: "holding" }, { readChart: posture.readChart });
  assert.equal(posture.reads.length, 0);
  assert.equal((await readWorldState({ force: true })).units[0].posture, "holding");
  const sail = reading();
  await sendFleetOp({ op: "station", unit: "u1", to: [3, 56], order: "move" }, { readChart: sail.readChart });
  assert.equal(sail.reads.length, 1);
  const world = await readWorldState({ force: true });
  assert.deepEqual(world.pendingUnitOrders.map((order) => [order.unitId, order.kind, order.toLng, order.toLat, order.issuedRound]), [["u1", "move", 3, 56, 3]]);
  assert.deepEqual([world.units[0].posture, world.units[0].status], ["transit", "moving"]);
  await assert.rejects(sendFleetOp({ op: "station", unit: "u1", to: [3, 50] }, { readChart: sail.readChart }), /not at sea/);
  await assert.rejects(sendFleetOp({ op: "posture", unit: "u1", posture: "holding" }, { turnRunning: () => true }), new RegExp(TURN_RUNNING_REFUSAL.slice(0, 30)));
});
