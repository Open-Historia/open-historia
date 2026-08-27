/*! Open Historia — unit-system toggle tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.unitSystem.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// The beta unit system sits behind a setting that defaults off (see
// runtime/mapSettings.js). What these cover is the promise that makes the toggle
// safe to flip: a save can move between the two systems in either direction, any
// number of times, and lose nothing. gameState.js never reads the setting — the
// caller passes betaEngine — so every case here drives it directly.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEventImpactsToWorld,
  normalizeWorldState,
  resumeStandingOrders,
} from "./gameState.js";

// A unit carrying every field the beta system adds on top of the classic set.
const betaUnit = (over = {}) => ({
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

const event = (impacts) => ({
  date: "2024-02-01", title: "Quiet week", description: "x", impacts,
});

// ---- the reversibility promise ---------------------------------------------

test("a classic turn preserves every beta-only unit field", () => {
  const world = normalizeWorldState({ units: [betaUnit()] });
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({})],
    motion: null,
    betaEngine: false,
  });

  const [unit] = normalizeWorldState(next).units;
  assert.equal(unit.posture, "patrol");
  assert.equal(unit.covert, true);
  assert.equal(unit.composition, "1 aircraft carrier, 2 frigates");
  assert.equal(unit.eventId, "ev-7");
});

test("a classic turn preserves standing orders rather than clearing them", () => {
  // A patrol is never satisfied by proximity, so it survives the prune on every
  // read and write and simply lies dormant while nothing is advancing it.
  const world = normalizeWorldState({ units: [betaUnit()], pendingUnitOrders: [patrolOrder()] });
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({})],
    motion: null,
    betaEngine: false,
  });

  assert.equal(normalizeWorldState(next).pendingUnitOrders.length, 1);
});

test("beta -> classic -> beta leaves the save byte-identical in the fields that matter", () => {
  const world = normalizeWorldState({ units: [betaUnit()], pendingUnitOrders: [patrolOrder()] });
  const classic = applyEventImpactsToWorld({
    world, events: [event({})], motion: null, betaEngine: false,
  }).world;
  const back = applyEventImpactsToWorld({
    world: classic, events: [event({})], motion: { originDate: "2024-02-01", round: 3 }, betaEngine: true,
  }).world;

  const before = normalizeWorldState(world);
  const after = normalizeWorldState(back);
  for (const field of ["posture", "covert", "composition", "eventId", "name", "type", "ownerCode"]) {
    assert.deepEqual(after.units[0][field], before.units[0][field], `${field} changed`);
  }
  assert.equal(after.pendingUnitOrders.length, 1);
});

// ---- the classic system mints nothing ---------------------------------------

test("a classic turn does not mint a patrol order for a patrol-posture spawn", () => {
  const world = normalizeWorldState({});
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "spawn", unit: betaUnit({ id: "u2" }) }] })],
    motion: null,
    betaEngine: false,
  });

  assert.equal(next.units.length, 1);
  assert.equal(normalizeWorldState(next).pendingUnitOrders.length, 0);
});

test("a beta turn DOES mint one, so the gate is what makes the difference", () => {
  const world = normalizeWorldState({});
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "spawn", unit: betaUnit({ id: "u2" }) }] })],
    motion: { originDate: "2024-01-01", round: 2 },
    betaEngine: true,
  });

  assert.equal(normalizeWorldState(next).pendingUnitOrders.length, 1);
});

test("a classic turn takes an over-long move at face value and mints no order", () => {
  // No travel clamp in classic, so the unit simply arrives — which is the
  // behaviour that existed before the motion engine.
  const world = normalizeWorldState({ units: [betaUnit({ posture: "" })] });
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "move", unitId: "unit-1", toLng: 120, toLat: 30 }] })],
    motion: null,
    betaEngine: false,
  });

  assert.equal(next.units[0].lng, 120);
  assert.equal(normalizeWorldState(next).pendingUnitOrders.length, 0);
});

test("a classic spawn is taken where the model put it, with no reach downgrade", () => {
  // The beta engine would mark a garrison this far from its owner's footprint
  // covert and downgrade it to infantry; the classic system has no such rule.
  const world = normalizeWorldState({ units: [betaUnit({ id: "anchor", covert: false })] });
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "spawn", unit: betaUnit({
      id: "far", type: "garrison", posture: "", covert: false, lng: 150, lat: -40,
    }) }] })],
    motion: null,
    betaEngine: false,
  });

  const spawned = next.units.find((entry) => entry.id === "far");
  assert.equal(spawned.type, "garrison");
  assert.equal(spawned.covert, false);
});

// ---- the unitSystem stamp ---------------------------------------------------

test("a turn stamps which system wrote it", () => {
  const world = normalizeWorldState({});
  assert.equal(world.unitSystem, "", "a fresh world claims neither system");

  const classic = applyEventImpactsToWorld({
    world, events: [event({})], motion: null, betaEngine: false,
  }).world;
  assert.equal(classic.unitSystem, "classic");

  const beta = applyEventImpactsToWorld({
    world, events: [event({})], motion: { originDate: "2024-01-01", round: 2 }, betaEngine: true,
  }).world;
  assert.equal(beta.unitSystem, "beta");
});

test("the stamp survives a normalize round trip, and a junk value does not", () => {
  assert.equal(normalizeWorldState({ unitSystem: "beta" }).unitSystem, "beta");
  assert.equal(normalizeWorldState({ unitSystem: "nonsense" }).unitSystem, "");
});

// ---- resuming after time passed under the classic system ---------------------

test("a patrol expired by classic play is rebased, not cleared", () => {
  // Issued to run until round 14, then twenty rounds went by with no engine to
  // expire it. Coming back to beta it should get the rest of its life from here.
  const world = { ...normalizeWorldState({ units: [betaUnit()], pendingUnitOrders: [patrolOrder()] }) };
  const resumed = resumeStandingOrders(world, { round: 34, previousSystem: "classic" });

  const [order] = normalizeWorldState(resumed).pendingUnitOrders;
  assert.ok(order, "the order survived");
  assert.ok(order.untilRound > 34, `expected a future expiry, got ${order.untilRound}`);
});

test("resumeStandingOrders is a no-op when beta wrote the save", () => {
  const world = normalizeWorldState({ units: [betaUnit()], pendingUnitOrders: [patrolOrder()] });
  assert.equal(resumeStandingOrders(world, { round: 34, previousSystem: "beta" }), world);
});

test("resumeStandingOrders leaves a patrol that has not expired alone", () => {
  const world = normalizeWorldState({ units: [betaUnit()], pendingUnitOrders: [patrolOrder()] });
  const resumed = resumeStandingOrders(world, { round: 5, previousSystem: "classic" });
  assert.equal(normalizeWorldState(resumed).pendingUnitOrders[0].untilRound, 14);
});

test("resumeStandingOrders is idempotent", () => {
  const world = normalizeWorldState({ units: [betaUnit()], pendingUnitOrders: [patrolOrder()] });
  const once = resumeStandingOrders(world, { round: 34, previousSystem: "classic" });
  // The second pass sees a world whose stamp the caller would now read as "beta",
  // but even told "classic" again it must not keep pushing the expiry outward.
  const twice = resumeStandingOrders(once, { round: 34, previousSystem: "classic" });
  assert.equal(
    normalizeWorldState(twice).pendingUnitOrders[0].untilRound,
    normalizeWorldState(once).pendingUnitOrders[0].untilRound,
  );
});

// ---- an old save meeting the beta system ------------------------------------

test("a save with only classic unit fields opens in beta with sane defaults", () => {
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

  // And a beta turn on top of it does not throw.
  const { world: next } = applyEventImpactsToWorld({
    world,
    events: [event({ unitOps: [{ op: "move", unitId: "u1", toLng: 3, toLat: 48 }] })],
    motion: { originDate: "2024-01-01", round: 2 },
    betaEngine: true,
  });
  assert.equal(next.units.length, 1);
});
