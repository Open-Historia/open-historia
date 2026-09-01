/*! Open Historia — unit motion/volume state tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.unitMotion.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl. The pure
// motion math is covered dependency-free in unitMotion.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_UNITS_GLOBAL,
  MAX_UNITS_PER_POLITY,
  advanceStandingOrders,
  applyEventImpactsToWorld,
  applyUnitOpBatch,
  applyUnitOps,
  buildOwnerFootprint,
  clampUnitStrength,
  clearStaleUnitMotion,
  enforceUnitVolume,
  normalizePendingUnitOrders,
  normalizeUnits,
  normalizeWorldState,
  pruneSatisfiedUnitOrders,
} from "./gameState.js";
import { haversineKm } from "./unitMotion.js";

const unit = (over = {}) => ({
  id: "unit-1",
  name: "1st Fleet",
  type: "naval",
  ownerCode: "France",
  strength: 100,
  // Not 0,0: normalizeUnitEntry rejects the null island as the output
  // template's placeholder rather than a real position.
  lng: 0,
  lat: 1,
  ...over,
});

const spawnOp = (over = {}) => ({
  op: "spawn",
  unit: { name: "Task Force", type: "naval", ownerCode: "Russia", strength: 100, lng: 0, lat: 1, ...over },
});

// ---- strength is now a percentage -----------------------------------------

test("clampUnitStrength coerces the old 1-1000 scale to a percentage", () => {
  assert.equal(clampUnitStrength(1000), 100);
  assert.equal(clampUnitStrength(340), 34);
  assert.equal(clampUnitStrength(100), 100); // the old default = a full-strength unit
  assert.equal(clampUnitStrength(78), 78); // already a percentage, left alone
  assert.equal(clampUnitStrength(0), 0);
});

test("normalizeUnitEntry defaults the new fields without asserting anything untrue", () => {
  const [normalized] = normalizeUnits([unit()]);
  assert.equal(normalized.posture, "");
  assert.equal(normalized.covert, false);
  assert.equal(normalized.composition, "");
  assert.equal(normalized.eventId, "");
});

test("normalizeUnitEntry drops a posture it does not recognise", () => {
  const [normalized] = normalizeUnits([unit({ posture: "rampaging" })]);
  assert.equal(normalized.posture, "");
});

test("covert is engine-assigned and never taken from the incoming payload string", () => {
  const [truthy] = normalizeUnits([unit({ covert: "yes" })]);
  assert.equal(truthy.covert, false);
});

// ---- standing orders -------------------------------------------------------

test("a patrol order survives the prune that would delete it for being on station", () => {
  const units = normalizeUnits([unit({ lng: -30, lat: 50 })]);
  const orders = normalizePendingUnitOrders([
    { id: "o1", unitId: "unit-1", kind: "patrol", toLng: -30, toLat: 50, radiusKm: 250 },
  ]);
  assert.equal(pruneSatisfiedUnitOrders(units, orders).length, 1);
});

test("a satisfied move order is still pruned", () => {
  const units = normalizeUnits([unit({ lng: -30, lat: 50 })]);
  const orders = normalizePendingUnitOrders([
    { id: "o1", unitId: "unit-1", kind: "move", toLng: -30, toLat: 50 },
  ]);
  assert.equal(pruneSatisfiedUnitOrders(units, orders).length, 0);
});

test("a legacy attack order is coerced to move, keeping its objective", () => {
  const [order] = normalizePendingUnitOrders([
    { id: "o1", unitId: "unit-1", kind: "attack", toLng: 10, toLat: 10, targetLabel: "Kronstadt" },
  ]);
  assert.equal(order.kind, "move");
  assert.equal(order.targetLabel, "Kronstadt");
  assert.equal(order.toLng, 10);
});

test("orders without the new fields default to a never-expiring move order", () => {
  const [order] = normalizePendingUnitOrders([{ unitId: "unit-1", toLng: 5, toLat: 5 }]);
  assert.equal(order.kind, "move");
  assert.equal(order.radiusKm, 0);
  assert.equal(order.untilRound, 0);
});

// ---- move ops: the anti-teleport clamp -------------------------------------

test("a move within the travel budget lands exactly on its destination", () => {
  const result = applyUnitOpBatch(
    [unit({ type: "infantry", lng: 0, lat: 1 })],
    [],
    [{ op: "move", unitId: "unit-1", toLng: 1, toLat: 0 }],
    { gameDate: "2024-01-01", elapsedDays: 7 }, // infantry: 40 km/day = 280 km
  );
  assert.equal(result.units[0].lng, 1);
  assert.equal(result.orders.length, 0);
});

test("a move beyond the budget lands short and keeps an order to the full destination", () => {
  const result = applyUnitOpBatch(
    [unit({ type: "infantry", lng: 0, lat: 1 })],
    [],
    [{ op: "move", unitId: "unit-1", toLng: 40, toLat: 0 }],
    { gameDate: "2024-01-01", elapsedDays: 7 },
  );
  const moved = result.units[0];
  const covered = haversineKm(1, 0, moved.lat, moved.lng);
  assert.ok(Math.abs(covered - 280) < 2, `expected ~280 km covered, got ${covered}`);
  assert.equal(moved.status, "moving");
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].kind, "move");
  assert.equal(result.orders[0].toLng, 40); // the FULL destination, not the step
});

test("successive jumps converge on the destination and then clear the order", () => {
  let units = [unit({ type: "naval", lng: 0, lat: 1 })];
  let orders = [];
  ({ units, orders } = applyUnitOpBatch(units, orders, [
    { op: "move", unitId: "unit-1", toLng: 30, toLat: 0 },
  ], { gameDate: "2024-01-01", elapsedDays: 1 }));
  assert.equal(orders.length, 1);

  let world = { units, pendingUnitOrders: orders };
  for (let round = 2; round < 12 && world.pendingUnitOrders.length; round += 1) {
    world = advanceStandingOrders(world, {
      fromDate: "2024-01-01",
      toDate: "2024-01-05",
      round,
    });
  }
  assert.equal(world.pendingUnitOrders.length, 0, "the order should clear on arrival");
  assert.ok(haversineKm(0, 30, world.units[0].lat, world.units[0].lng) < 60);
});

test("elapsedDays null leaves a move unclamped, so non-Gregorian scenarios still work", () => {
  const result = applyUnitOpBatch(
    [unit({ type: "infantry", lng: 0, lat: 1 })],
    [],
    [{ op: "move", unitId: "unit-1", toLng: 40, toLat: 0 }],
    { gameDate: "1200 BCE", elapsedDays: null },
  );
  assert.equal(result.units[0].lng, 40);
  assert.equal(result.orders.length, 0);
});

test("a garrison ignores a move op entirely", () => {
  const result = applyUnitOpBatch(
    [unit({ type: "garrison", lng: 5, lat: 5 })],
    [],
    [{ op: "move", unitId: "unit-1", toLng: 40, toLat: 0 }],
    { gameDate: "2024-01-01", elapsedDays: 30 },
  );
  assert.equal(result.units[0].lng, 5);
  assert.equal(result.units[0].lat, 5);
});

// ---- spawn ops: detection, never rejection ---------------------------------

test("a spawn is never dropped for being far from its owner's forces", () => {
  const world = { units: [unit({ id: "ru-1", ownerCode: "Russia", lng: 37, lat: 55 })], markers: [] };
  const result = applyUnitOpBatch(
    world.units,
    [],
    [spawnOp({ id: "sub-1", type: "naval", lng: -40, lat: 45 })],
    { gameDate: "1400-01-01", markers: [] },
  );
  assert.equal(result.units.length, 2, "the detected unit must still appear");
});

test("a far spawn is flagged unconfirmed but keeps its full strength", () => {
  // A submarine that has been shadowing a fleet for months: the spawn is the
  // moment it was DETECTED, not the moment it arrived.
  const result = applyUnitOpBatch(
    [unit({ id: "ru-1", ownerCode: "Russia", lng: 37, lat: 55 })],
    [],
    [spawnOp({ id: "sub-1", type: "naval", lng: -50, lat: -30, strength: 95 })],
    { gameDate: "1400-01-01" },
  );
  const spawned = result.units.find((u) => u.id === "sub-1");
  assert.equal(spawned.covert, true);
  assert.equal(spawned.strength, 95, "a detected force is whatever size it actually is");
});

test("era and type decide what counts as supported", () => {
  const home = [unit({ id: "ru-1", ownerCode: "Russia", lng: 37, lat: 55 })];
  const far = spawnOp({ id: "x", type: "naval", lng: -50, lat: -30 }); // ~12,500 km

  const modern = applyUnitOpBatch(home, [], [far], { gameDate: "2024-01-01" });
  assert.equal(modern.units.find((u) => u.id === "x").covert, false,
    "a modern navy is globally supported");

  const medieval = applyUnitOpBatch(home, [], [far], { gameDate: "1400-01-01" });
  assert.equal(medieval.units.find((u) => u.id === "x").covert, true,
    "an age-of-sail fleet that far from home is not");
});

test("a far garrison becomes infantry but still appears", () => {
  const result = applyUnitOpBatch(
    [unit({ id: "ru-1", ownerCode: "Russia", lng: 37, lat: 55 })],
    [],
    [spawnOp({ id: "base-1", type: "garrison", lng: 45, lat: 25 })],
    { gameDate: "1400-01-01" },
  );
  const spawned = result.units.find((u) => u.id === "base-1");
  assert.ok(spawned, "the troops must land even though the base is refused");
  assert.equal(spawned.type, "infantry", "a fixed installation cannot be conjured");
  assert.equal(spawned.covert, true);
});

test("an owner with no known footprint spawns normally", () => {
  const result = applyUnitOpBatch([], [], [spawnOp({ id: "first" })], { gameDate: "2024-01-01" });
  assert.equal(result.units[0].covert, false, "unknown is not implausible");
});

test("a spawn near the owner's own structures is supported", () => {
  const result = applyUnitOpBatch(
    [],
    [],
    [spawnOp({ id: "x", type: "infantry", lng: 44.4, lat: 33.3 })],
    {
      gameDate: "1400-01-01",
      markers: [{ id: "m1", name: "Basra Depot", kind: "port", ownerCode: "Russia", lng: 44.3, lat: 33.2 }],
    },
  );
  assert.equal(result.units[0].covert, false);
});

test("a spawn is idempotent on its id, so a replayed batch cannot duplicate it", () => {
  const once = applyUnitOpBatch([], [], [spawnOp({ id: "x" })], {});
  const twice = applyUnitOpBatch(once.units, once.orders, [spawnOp({ id: "x" })], {});
  assert.equal(twice.units.length, 1);
});

test("a patrol spawn mints its own standing order at the type's default radius", () => {
  const result = applyUnitOpBatch(
    [],
    [],
    [spawnOp({ id: "fleet", type: "naval", posture: "patrol", lng: -30, lat: 50 })],
    { gameDate: "2024-01-01", round: 4 },
  );
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].kind, "patrol");
  assert.equal(result.orders[0].radiusKm, 250);
  assert.equal(result.orders[0].untilRound, 16); // round 4 + 12
});

test("removing a unit takes its standing order with it", () => {
  const spawned = applyUnitOpBatch(
    [],
    [],
    [spawnOp({ id: "fleet", type: "naval", posture: "patrol", lng: -30, lat: 50 })],
    { round: 1 },
  );
  const removed = applyUnitOpBatch(spawned.units, spawned.orders, [
    { op: "remove", unitId: "fleet" },
  ], {});
  assert.equal(removed.units.length, 0);
  assert.equal(removed.orders.length, 0);
});

test("applyUnitOps keeps its old array contract for any caller that still expects it", () => {
  const units = applyUnitOps([], [spawnOp({ id: "x" })], {});
  assert.ok(Array.isArray(units));
  assert.equal(units.length, 1);
});

// ---- advanceStandingOrders -------------------------------------------------

test("a patrol repositions each round but stays on station", () => {
  const world = {
    units: normalizeUnits([unit({ type: "naval", lng: -30, lat: 50 })]),
    pendingUnitOrders: normalizePendingUnitOrders([
      { id: "o1", unitId: "unit-1", kind: "patrol", toLng: -30, toLat: 50, radiusKm: 250 },
    ]),
  };
  const r3 = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-02-01", round: 3 });
  const r4 = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-02-01", round: 4 });
  assert.notEqual(r3.units[0].lng, r4.units[0].lng);
  for (const state of [r3, r4]) {
    assert.ok(haversineKm(50, -30, state.units[0].lat, state.units[0].lng) <= 251);
    assert.equal(state.pendingUnitOrders.length, 1, "a patrol must not prune itself");
  }
});

test("a patrol is reproducible for the same round and idle tick", () => {
  const world = {
    units: normalizeUnits([unit({ type: "naval", lng: -30, lat: 50 })]),
    pendingUnitOrders: normalizePendingUnitOrders([
      { id: "o1", unitId: "unit-1", kind: "patrol", toLng: -30, toLat: 50, radiusKm: 250 },
    ]),
  };
  const a = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-01-01", round: 3, tick: 2 });
  const b = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-01-01", round: 3, tick: 2 });
  assert.equal(a.units[0].lng, b.units[0].lng);
  assert.equal(a.units[0].lat, b.units[0].lat);
});

test("an expired order is dropped and the unit stands down", () => {
  const world = {
    units: normalizeUnits([unit({ type: "naval", lng: -30, lat: 50, posture: "patrol" })]),
    pendingUnitOrders: normalizePendingUnitOrders([
      { id: "o1", unitId: "unit-1", kind: "patrol", toLng: -30, toLat: 50, radiusKm: 250, untilRound: 5 },
    ]),
  };
  const next = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-02-01", round: 6 });
  assert.equal(next.pendingUnitOrders.length, 0);
  assert.equal(next.units[0].posture, "");
  assert.equal(next.units[0].status, "idle");
});

test("advanceStandingOrders is a no-op when nothing has a standing order", () => {
  const world = { units: normalizeUnits([unit()]), pendingUnitOrders: [] };
  assert.equal(advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-02-01" }), world);
});

// ---- volume ----------------------------------------------------------------

const aiUnits = (count, owner = "Germany") =>
  Array.from({ length: count }, (_, i) =>
    unit({ id: `${owner}-${i}`, ownerCode: owner, strength: 100 - i, source: "ai", lng: i + 1, lat: 1 }));

test("the player's own forces are exempt from both caps", () => {
  const world = normalizeWorldState({
    units: [
      ...Array.from({ length: 20 }, (_, i) =>
        unit({ id: `me-${i}`, ownerCode: "France", source: "player", lng: i + 1, lat: 2 })),
      ...aiUnits(20),
    ],
  });
  const next = enforceUnitVolume(world, { playerCode: "France" });
  assert.equal(next.units.filter((u) => u.ownerCode === "France").length, 20);
  assert.equal(next.units.filter((u) => u.ownerCode === "Germany").length, MAX_UNITS_PER_POLITY);
});

test("the player's units do not eat another power's headroom", () => {
  const world = normalizeWorldState({
    units: [
      ...Array.from({ length: 40 }, (_, i) =>
        unit({ id: `me-${i}`, ownerCode: "France", source: "player", lng: i + 1, lat: 2 })),
      ...aiUnits(12),
    ],
  });
  const next = enforceUnitVolume(world, { playerCode: "France" });
  assert.equal(next.units.filter((u) => u.ownerCode === "Germany").length, 12);
});

test("the global cap holds across many polities", () => {
  const owners = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const world = normalizeWorldState({
    units: owners.flatMap((owner) => aiUnits(12, owner)),
  });
  const next = enforceUnitVolume(world, { playerCode: "France" });
  assert.ok(next.units.length <= MAX_UNITS_GLOBAL, `got ${next.units.length}`);
});

test("engaged and pending units are never pruned as surplus", () => {
  const world = normalizeWorldState({
    units: [
      ...aiUnits(20),
      unit({ id: "fighting", ownerCode: "Germany", status: "engaged", strength: 1, lng: 30, lat: 5 }),
      unit({ id: "awaiting", ownerCode: "Germany", status: "pending", strength: 1, lng: 31, lat: 5 }),
    ],
  });
  const next = enforceUnitVolume(world, { playerCode: "France" });
  assert.ok(next.units.some((u) => u.id === "fighting"));
  assert.ok(next.units.some((u) => u.id === "awaiting"));
});

test("pruning is deterministic, so a rollback and re-run produce the same map", () => {
  const world = normalizeWorldState({ units: aiUnits(30) });
  const a = enforceUnitVolume(world, { playerCode: "France" });
  const b = enforceUnitVolume(world, { playerCode: "France" });
  assert.deepEqual(a.units.map((u) => u.id), b.units.map((u) => u.id));
});

test("enforceUnitVolume leaves a world already under the caps untouched", () => {
  const world = normalizeWorldState({ units: aiUnits(3) });
  assert.equal(enforceUnitVolume(world, { playerCode: "France" }), world);
});

// ---- buildOwnerFootprint ---------------------------------------------------

test("buildOwnerFootprint gathers that owner's units and structures only", () => {
  const world = {
    units: [unit({ ownerCode: "Russia", lng: 37, lat: 55 }), unit({ id: "u2", ownerCode: "France", lng: 2, lat: 48 })],
    markers: [{ ownerCode: "Russia", lng: 30, lat: 60 }, { ownerCode: "France", lng: 5, lat: 45 }],
  };
  assert.equal(buildOwnerFootprint(world, "Russia").length, 2);
  assert.equal(buildOwnerFootprint(world, "").length, 0);
});

// ---- the jump path ---------------------------------------------------------

test("each event gets a budget measured from the previous event, not the jump start", () => {
  const world = normalizeWorldState({ units: [unit({ id: "u1", type: "infantry", lng: 0, lat: 1 })] });
  const events = [
    { date: "2024-01-04", title: "March begins", description: "x", impacts: {
      unitOps: [{ op: "move", unitId: "u1", toLng: 40, toLat: 0 }] } },
  ];
  const { world: next } = applyEventImpactsToWorld({
    world, events, motion: { originDate: "2024-01-01", round: 2 },
  });
  // 3 days of infantry travel = 120 km, not the whole 4400 km.
  const covered = haversineKm(1, 0, next.units[0].lat, next.units[0].lng);
  assert.ok(Math.abs(covered - 120) < 3, `expected ~120 km, got ${covered}`);
});

test("motion null leaves the impacts path exactly as it was", () => {
  const world = normalizeWorldState({ units: [unit({ id: "u1", type: "infantry", lng: 0, lat: 1 })] });
  const events = [
    { date: "2024-01-04", title: "March", description: "x", impacts: {
      unitOps: [{ op: "move", unitId: "u1", toLng: 40, toLat: 0 }] } },
  ];
  const { world: next } = applyEventImpactsToWorld({ world, events });
  assert.equal(next.units[0].lng, 40);
});

test("a unit records the event that moved it", () => {
  const world = normalizeWorldState({ units: [unit({ id: "u1", type: "infantry", lng: 0, lat: 1 })] });
  const events = [
    { id: "ev-7", date: "2024-01-02", title: "Advance", description: "x", impacts: {
      unitOps: [{ op: "move", unitId: "u1", toLng: 1, toLat: 0 }] } },
  ];
  const { world: next } = applyEventImpactsToWorld({
    world, events, motion: { originDate: "2024-01-01", round: 2 },
  });
  assert.equal(next.units[0].eventId, "ev-7");
});

test("idlePulseTick survives a normalize round trip", () => {
  assert.equal(normalizeWorldState({ idlePulseTick: 7 }).idlePulseTick, 7);
  assert.equal(normalizeWorldState({}).idlePulseTick, 0);
});

// A unit that reached its destination used to be stamped "moving" unless its
// posture happened to be "patrol" — and pruneSatisfiedUnitOrders then dropped the
// order, so nothing was ever left to correct it. The map counter kept its yellow
// moving ring for the rest of the campaign, and the classic popup's Status row read
// "moving" for a formation sitting still.
test("arriving stands a unit down whatever its posture", () => {
  for (const posture of ["", "holding", "massing", "blockade", "patrol"]) {
    const result = applyUnitOpBatch(
      [unit({ type: "naval", lng: 0, lat: 1, posture })],
      [],
      [{ op: "move", unitId: "unit-1", toLng: 1, toLat: 0, posture }],
      { gameDate: "2024-01-01", elapsedDays: 7, round: 3 },
    );
    assert.equal(result.units[0].status, "idle", `posture "${posture}" left the unit reading as moving`);
  }
});

// The other side of the same line: still short of the destination is still moving.
test("falling short of the destination still reads as moving", () => {
  const result = applyUnitOpBatch(
    [unit({ type: "infantry", lng: 0, lat: 1, posture: "holding" })],
    [],
    [{ op: "move", unitId: "unit-1", toLng: 40, toLat: 0 }],
    { gameDate: "2024-01-01", elapsedDays: 7 },
  );
  assert.equal(result.units[0].status, "moving");
});

// ---- stale "moving" on old saves -------------------------------------------

test("a unit left claiming to move with nothing moving it is repaired to idle", () => {
  const world = normalizeWorldState({
    units: [unit({ id: "u1", status: "moving" })],
    pendingUnitOrders: [],
  });
  const repaired = clearStaleUnitMotion(world);
  assert.equal(repaired.units[0].status, "idle");
  assert.equal(repaired.units[0].orderId, "");
});

test("a unit the engine is still advancing keeps its moving status", () => {
  const world = normalizeWorldState({
    units: [unit({ id: "u1", status: "moving", lng: 0, lat: 1 })],
    pendingUnitOrders: [{ id: "o1", unitId: "u1", kind: "move", toLng: 40, toLat: 40 }],
  });
  assert.equal(clearStaleUnitMotion(world), world, "an ordered unit must not be touched");
});

test("a classic long-range order still in the queue keeps its unit moving", () => {
  const world = normalizeWorldState({
    units: [unit({ id: "u1", status: "moving" })],
    pendingUnitOrders: [],
  });
  assert.equal(clearStaleUnitMotion(world, { queuedUnitIds: ["u1"] }), world);
});

test("clearStaleUnitMotion repairs only the stale unit, and is idempotent", () => {
  const world = normalizeWorldState({
    units: [
      unit({ id: "u1", status: "moving" }),
      unit({ id: "u2", status: "moving", lng: 0, lat: 1 }),
      unit({ id: "u3", status: "engaged" }),
    ],
    pendingUnitOrders: [{ id: "o1", unitId: "u2", kind: "move", toLng: 40, toLat: 40 }],
  });
  const repaired = clearStaleUnitMotion(world);
  const byId = Object.fromEntries(repaired.units.map((entry) => [entry.id, entry.status]));
  assert.deepEqual(byId, { u1: "idle", u2: "moving", u3: "engaged" });
  assert.equal(clearStaleUnitMotion(repaired), repaired, "a repaired world reads back unchanged");
});

test("a world with nothing moving comes back untouched", () => {
  const world = normalizeWorldState({ units: [unit({ id: "u1", status: "idle" })] });
  assert.equal(clearStaleUnitMotion(world), world);
});
