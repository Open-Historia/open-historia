/*! Open Historia — unit-system tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.unitSystem.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// There is one unit system: the engine mints standing orders, clamps travel and
// checks a spawn's support. What these cover is the engine's contract with a
// save — the stamp a turn leaves, and how a save last written by the old classic
// system (which advanced nothing) is brought back into the present.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEventImpactsToWorld,
  normalizeUnitEntry,
  normalizeWorldState,
  resumeStandingOrders,
} from "./gameState.js";

// A unit carrying every field the engine reads.
const engineUnit = (over = {}) => ({
  id: "unit-1",
  name: "1st Fleet",
  type: "naval",
  ownerCode: "France",
  strength: 100,
  // Not 0,0: normalizeUnitEntry rejects the null island as the output template's
  // placeholder rather than a real position.
  lng: 0,
  lat: 1,
  status: "idle",
  posture: "patrol",
  covert: true,
  composition: "1 aircraft carrier, 2 frigates",
  eventId: "ev-7",
  ...over,
});

const patrolOrder = (over = {}) => ({
  id: "unitorder-1",
  unitId: "unit-1",
  kind: "patrol",
  toLng: 0,
  toLat: 1,
  radiusKm: 300,
  untilRound: 14,
  ...over,
});

const event = (impacts, over = {}) => ({
  date: "2024-02-01", title: "Quiet week", description: "x", impacts, ...over,
});

const motion = { originDate: "2024-01-01", round: 2 };

// ---- the engine mints orders --------------------------------------------------

test("a patrol-posture spawn mints a standing patrol order", () => {
  const world = normalizeWorldState({});
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "spawn", unit: engineUnit({ id: "u2" }) }] })],
    motion,
  });

  assert.equal(next.units.length, 1);
  assert.equal(normalizeWorldState(next).pendingUnitOrders.length, 1);
});

test("an over-long move advances part of the way and keeps a standing order to the destination", () => {
  const world = normalizeWorldState({ units: [engineUnit({ posture: "" })] });
  const { world: next } = applyEventImpactsToWorld({
    world,
    // One day of travel for a fleet ordered across the Pacific.
    events: [event({ unitOps: [{ op: "move", unitId: "unit-1", toLng: 120, toLat: 30 }] }, { date: "2024-01-02" })],
    motion,
  });

  assert.ok(next.units[0].lng < 120, `expected a partial advance, got lng ${next.units[0].lng}`);
  assert.equal(normalizeWorldState(next).pendingUnitOrders.length, 1);
});

// ---- the unitSystem stamp ---------------------------------------------------

test("a turn stamps the save as the engine's", () => {
  const world = normalizeWorldState({});
  assert.equal(world.unitSystem, "", "a fresh world claims no system");

  const next = applyEventImpactsToWorld({ world, events: [event({})], motion }).world;
  assert.equal(next.unitSystem, "beta");
});

test("the stamp survives a normalize round trip, and a junk value does not", () => {
  assert.equal(normalizeWorldState({ unitSystem: "beta" }).unitSystem, "beta");
  assert.equal(normalizeWorldState({ unitSystem: "classic" }).unitSystem, "classic", "an old save's stamp is kept for resumeStandingOrders");
  assert.equal(normalizeWorldState({ unitSystem: "nonsense" }).unitSystem, "");
});

// ---- resuming after time passed under the old classic system -----------------

test("a patrol expired by classic play is rebased, not cleared", () => {
  // Issued to run until round 14, then twenty rounds went by with no engine to
  // expire it. Coming back to the engine it should get the rest of its life from here.
  const world = { ...normalizeWorldState({ units: [engineUnit()], pendingUnitOrders: [patrolOrder()] }) };
  const resumed = resumeStandingOrders(world, { round: 34, previousSystem: "classic" });

  const [order] = normalizeWorldState(resumed).pendingUnitOrders;
  assert.ok(order, "the order survived");
  assert.ok(order.untilRound > 34, `expected a future expiry, got ${order.untilRound}`);
});

test("resumeStandingOrders is a no-op when the engine wrote the save", () => {
  const world = normalizeWorldState({ units: [engineUnit()], pendingUnitOrders: [patrolOrder()] });
  assert.equal(resumeStandingOrders(world, { round: 34, previousSystem: "beta" }), world);
});

test("resumeStandingOrders leaves a patrol that has not expired alone", () => {
  const world = normalizeWorldState({ units: [engineUnit()], pendingUnitOrders: [patrolOrder()] });
  const resumed = resumeStandingOrders(world, { round: 5, previousSystem: "classic" });
  assert.equal(normalizeWorldState(resumed).pendingUnitOrders[0].untilRound, 14);
});

test("resumeStandingOrders is idempotent", () => {
  const world = normalizeWorldState({ units: [engineUnit()], pendingUnitOrders: [patrolOrder()] });
  const once = resumeStandingOrders(world, { round: 34, previousSystem: "classic" });
  // The second pass sees a world whose stamp the caller would now read as "beta",
  // but even told "classic" again it must not keep pushing the expiry outward.
  const twice = resumeStandingOrders(once, { round: 34, previousSystem: "classic" });
  assert.equal(
    normalizeWorldState(twice).pendingUnitOrders[0].untilRound,
    normalizeWorldState(once).pendingUnitOrders[0].untilRound,
  );
});

// ---- an old save meeting the engine -------------------------------------------

test("a save with only classic-era unit fields opens with sane defaults", () => {
  const world = normalizeWorldState({
    units: [{
      id: "u1", name: "II Corps", type: "infantry", ownerCode: "France",
      strength: 80, lng: 2, lat: 48, status: "idle",
    }],
  });

  const [unit] = world.units;
  assert.equal(unit.posture, "", "an absent posture stays absent rather than asserting something untrue");
  assert.equal(unit.covert, false);
  assert.equal(unit.composition, "");
  assert.deepEqual(world.pendingUnitOrders, []);

  // And a turn on top of it does not throw.
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "move", unitId: "u1", toLng: 3, toLat: 48 }] })],
    motion,
  });
  assert.equal(next.units.length, 1);
});

test("a unit placed on a world copy past the date line is stored in range", () => {
  const unit = normalizeUnitEntry({ ownerCode: "United States", lng: 210, lat: 61 });
  assert.equal(unit.lng, -150);
  assert.equal(unit.lat, 61);
  assert.equal(normalizeUnitEntry({ ownerCode: "United States", lng: -155.5, lat: 19.6 }).lng, -155.5);
  assert.equal(normalizeUnitEntry({ ownerCode: "United States", lng: 360, lat: 0 }), null, "a wrapped 0,0 is still no position");
});
