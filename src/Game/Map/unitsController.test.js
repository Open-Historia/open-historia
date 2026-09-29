/*! Open Historia — unit orders reach the next jump, or say they did not: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/unitsController.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// A deploy, a disband and a request for orders each change what the next time
// skip is told (actions.json) and, for the first two, what is on the map
// (world.units). The card's Disband used to take the unit off the map without
// queueing any order, so the AI never heard of it; every write failure was
// swallowed, so the card said "Queued" for an order that was never saved, and a
// deploy whose unit could not be saved still queued its request.

import test from "node:test";
import assert from "node:assert/strict";
import { setRuntimeAssetEndpoints } from "../../runtime/assets.js";
import {
  ORDER_NOT_SAVED,
  deployUnit,
  disbandUnit,
  getUnitById,
  requestUnitOrders,
  revertUnitOrder,
  startUnitsSync,
  getPlayerCode,
} from "./unitsController.js";

// The local server's JSON routes, in memory, with a switch to fail a write.
const store = new Map();
const failing = new Set();
globalThis.fetch = async (url, init = {}) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  const key = match[1];
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    if (failing.has(key)) return new Response("disk full", { status: 500 });
    store.set(key, String(init.body));
    return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!store.has(key)) return new Response("missing", { status: 404 });
  return new Response(store.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

const fleet = {
  id: "fleet-1", name: "Home Fleet", type: "naval", ownerCode: "United Kingdom", strength: 90, lng: -3, lat: 56, status: "idle",
};
const read = (key) => JSON.parse(store.get(key) ?? "null");
const savedUnits = () => read("world")?.units ?? [];
const savedActions = () => read("actions") ?? [];

let started = false;
const reset = async () => {
  failing.clear();
  store.set("game", JSON.stringify({ country: "United Kingdom", round: 3, gameDate: "1940-06-01" }));
  store.set("world", JSON.stringify({ units: [fleet] }));
  store.set("actions", JSON.stringify([]));
  if (!started) {
    started = true;
    setRuntimeAssetEndpoints({ token: "units-controller" });
    startUnitsSync();
    for (let tries = 0; tries < 100 && !(getPlayerCode() && getUnitById("fleet-1")); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  // The controller's list follows each save; one round trip puts the fleet back.
  if (!getUnitById("fleet-1")) await revertUnitOrder({ unitId: "fleet-1", restore: fleet });
  store.set("world", JSON.stringify({ units: [fleet] }));
};

const deployment = { type: "infantry", strength: 80, name: "1st Division", composition: "", lng: 1, lat: 50 };

test("a deploy puts a pending unit on the map and its request in the queue", async () => {
  await reset();
  assert.deepEqual(await deployUnit(deployment), { ok: true });
  const unit = savedUnits().find((entry) => entry.name === "1st Division");
  assert.equal(unit?.status, "pending");
  const [request] = savedActions();
  assert.match(request.text, /^Deploy request: 1st Division/);
  assert.deepEqual(request.unitRevert, { unitId: unit.id, remove: true });
});

test("a deploy whose unit cannot be saved leaves no request behind", async () => {
  await reset();
  failing.add("world");
  assert.deepEqual(await deployUnit(deployment), { ok: false, error: ORDER_NOT_SAVED });
  assert.deepEqual(savedActions(), [], "the request was taken back");
  assert.equal(savedUnits().some((entry) => entry.name === "1st Division"), false);
});

test("a deploy whose request cannot be saved leaves no unit behind", async () => {
  await reset();
  failing.add("actions");
  assert.equal((await deployUnit(deployment)).ok, false);
  assert.equal(savedUnits().some((entry) => entry.name === "1st Division"), false);
});

test("disbanding a unit tells the next jump, and deleting that order brings the unit back", async () => {
  await reset();
  assert.deepEqual(await disbandUnit("fleet-1"), { ok: true });
  assert.equal(savedUnits().some((entry) => entry.id === "fleet-1"), false, "it leaves the map now");
  const [order] = savedActions();
  assert.match(order.text, /^Disband order: Home Fleet/);
  assert.equal(order.status, "planned");
  assert.equal(order.unitRevert.restore.name, "Home Fleet", "the order carries the unit as it was");

  assert.equal(await revertUnitOrder(order.unitRevert), true);
  const back = savedUnits().find((entry) => entry.id === "fleet-1");
  assert.equal(back?.name, "Home Fleet");
  assert.equal(back?.strength, 90);
  assert.deepEqual([back.lng, back.lat], [-3, 56]);
});

test("a disband that cannot be saved keeps the unit and queues nothing", async () => {
  await reset();
  failing.add("world");
  assert.deepEqual(await disbandUnit("fleet-1"), { ok: false, error: ORDER_NOT_SAVED });
  assert.deepEqual(savedActions(), []);
  assert.ok(savedUnits().some((entry) => entry.id === "fleet-1"));
});

test("disbanding a unit not yet confirmed withdraws its deploy request instead", async () => {
  await reset();
  await deployUnit(deployment);
  const pending = savedUnits().find((entry) => entry.name === "1st Division");
  assert.deepEqual(await disbandUnit(pending.id), { ok: true });
  assert.equal(savedUnits().some((entry) => entry.id === pending.id), false);
  assert.deepEqual(savedActions(), [], "no request to raise it again, and no disband order for a unit never raised");
});

test("a request for orders says whether it was saved", async () => {
  await reset();
  assert.equal(await requestUnitOrders("fleet-1", "Shadow the enemy squadron"), true);
  assert.match(savedActions()[0].text, /^Orders requested for Home Fleet/);
  failing.add("actions");
  assert.equal(await requestUnitOrders("fleet-1", "Return to Scapa Flow"), false);
  assert.equal(savedActions().length, 1);
});
