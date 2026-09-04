/*! Open Historia — standing unit-order tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/gameState.unitOrders.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { haversineKm, normalizeWorldState, pruneSatisfiedUnitOrders } from "./gameState.js";

const unit = (over = {}) => ({
  id: "unit-1",
  name: "1st Fleet",
  type: "naval",
  ownerCode: "France",
  strength: 100,
  lng: 0,
  lat: 0,
  ...over,
});

const order = (over = {}) => ({
  id: "unitorder-1",
  unitId: "unit-1",
  kind: "move",
  toLng: 10,
  toLat: 10,
  ...over,
});

// ---- haversineKm ------------------------------------------------------------

test("haversineKm: same point is zero distance", () => {
  assert.equal(haversineKm(10, 20, 10, 20), 0);
});

test("haversineKm: a known distance is roughly right (London -> Paris, ~344km)", () => {
  const km = haversineKm(51.5072, -0.1276, 48.8566, 2.3522);
  assert.ok(km > 330 && km < 360, `expected ~344km, got ${km}`);
});

// ---- pruneSatisfiedUnitOrders ------------------------------------------------

test("prune: an order whose unit is still far from its destination survives", () => {
  const kept = pruneSatisfiedUnitOrders([unit({ lng: 0, lat: 0 })], [order({ toLng: 50, toLat: 50 })]);
  assert.equal(kept.length, 1);
});

test("prune: an order whose unit has arrived (within tolerance) is dropped", () => {
  const kept = pruneSatisfiedUnitOrders([unit({ lng: 10, lat: 10 })], [order({ toLng: 10.05, toLat: 10.05 })]);
  assert.equal(kept.length, 0);
});

test("prune: an order referencing a unit that no longer exists is dropped", () => {
  const kept = pruneSatisfiedUnitOrders([unit({ id: "unit-2" })], [order({ unitId: "unit-1" })]);
  assert.equal(kept.length, 0);
});

test("prune: multiple orders are judged independently", () => {
  const units = [unit({ id: "a", lng: 0, lat: 0 }), unit({ id: "b", lng: 10, lat: 10 })];
  const orders = [
    order({ id: "o1", unitId: "a", toLng: 50, toLat: 50 }), // still far
    order({ id: "o2", unitId: "b", toLng: 10.01, toLat: 10.01 }), // arrived
  ];
  const kept = pruneSatisfiedUnitOrders(units, orders);
  assert.deepEqual(kept.map((o) => o.id), ["o1"]);
});

// ---- normalizeWorldState integration ----------------------------------------

test("normalizeWorldState: prunes pendingUnitOrders against the units in the same world", () => {
  const world = normalizeWorldState({
    units: [unit({ lng: 10, lat: 10 })],
    pendingUnitOrders: [order({ toLng: 10.02, toLat: 10.02 })],
  });
  assert.deepEqual(world.pendingUnitOrders, []);
});

test("normalizeWorldState: keeps a live order and fills in defaults (kind, id)", () => {
  // lng/lat 0,0 is the reserved "unset placeholder" position normalizeUnitEntry
  // rejects on purpose (see gameState.js) — use a real position here.
  const world = normalizeWorldState({
    units: [unit({ lng: 5, lat: 5 })],
    pendingUnitOrders: [{ unitId: "unit-1", toLng: 80, toLat: 80 }],
  });
  assert.equal(world.pendingUnitOrders.length, 1);
  assert.equal(world.pendingUnitOrders[0].kind, "move");
  assert.ok(world.pendingUnitOrders[0].id);
});

test("normalizeWorldState: an entry missing unitId or coordinates is dropped entirely", () => {
  const world = normalizeWorldState({
    units: [unit()],
    pendingUnitOrders: [{ toLng: 10, toLat: 10 }, { unitId: "unit-1" }, "not an object"],
  });
  assert.deepEqual(world.pendingUnitOrders, []);
});

test("normalizeWorldState: defaults pendingUnitOrders to an empty array", () => {
  const world = normalizeWorldState({});
  assert.deepEqual(world.pendingUnitOrders, []);
});
