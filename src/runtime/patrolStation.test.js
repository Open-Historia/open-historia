/*! Open Historia — a patrol's station moves with its unit: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/patrolStation.test.js
//
// The user (2026-09-24): "when a patrolling troop moved, the ring showing where
// they are patrolling did not move with them". The ring is drawn around the
// patrol order's station (world.pendingUnitOrders[].toLng/toLat). The turn's
// reveal showed the units of the moment being revealed but the standing orders
// of another (the pre-jump world while a skip streams), so a patrol that moved
// to a new station left its ring behind. Anything else that moves a unit must
// move its station too, or the ring stays behind and the next patrol step pulls
// the unit straight back to the old spot.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advanceStandingOrders,
  applyEventImpactsToWorld,
  applyUnitOpBatch,
  normalizePendingUnitOrders,
  recenterPatrolOrders,
} from "./gameState.js";
import { haversineKm } from "./unitMotion.js";
import { getPendingUnitOrders, getUnitOrder, getUnits, setUnitsOverride } from "../Game/Map/unitsController.js";

const fleet = (over = {}) => ({
  id: "fleet-1", name: "1st Fleet", type: "naval", ownerCode: "France", strength: 100, lng: 0, lat: 1, ...over,
});
const patrolOrder = (over = {}) => ({ id: "order-1", unitId: "fleet-1", kind: "patrol", toLng: 0, toLat: 1, radiusKm: 150, untilRound: 20, ...over });

// What the reveal hands the map: the world after the events revealed so far.
// A patrol sent to a new station has both its unit and its station there.
test("the reveal's world moves a patrol's station with its unit", () => {
  const world = { units: [fleet({ posture: "patrol", lng: 10, lat: 40 })], pendingUnitOrders: [patrolOrder({ toLng: 10, toLat: 40 })] };
  const events = [{
    id: "event-1", date: "2016-01-03", title: "The fleet shifts south", description: "It takes up a new station.",
    impacts: { unitOps: [{ op: "move", unitId: "fleet-1", toLng: 12, toLat: 36, posture: "patrol" }] },
  }];
  const { world: staged } = applyEventImpactsToWorld({ colors: {}, events, world });
  const unit = staged.units.find((entry) => entry.id === "fleet-1");
  const station = staged.pendingUnitOrders.find((order) => order.unitId === "fleet-1");
  assert.deepEqual([unit.lng, unit.lat], [12, 36]);
  assert.equal(station.kind, "patrol");
  assert.deepEqual([station.toLng, station.toLat], [12, 36], "the station is where the unit went");
});

// The map reads units and orders from the units controller. While the reveal
// overrides the units, the orders must be the reveal's too: the saved ones are
// the pre-jump world's while a skip streams, so the ring stayed at the old
// station while the unit moved off.
test("while the reveal runs the map draws the reveal's orders, and the saved ones after", () => {
  const units = [fleet({ lng: 12, lat: 36 })];
  const orders = normalizePendingUnitOrders([patrolOrder({ toLng: 12, toLat: 36 })]);
  setUnitsOverride(units, orders);
  assert.equal(getUnits(), units);
  assert.deepEqual(getPendingUnitOrders(), orders);
  assert.deepEqual([getUnitOrder("fleet-1").toLng, getUnitOrder("fleet-1").toLat], [12, 36]);
  setUnitsOverride(null);
  assert.deepEqual(getPendingUnitOrders(), [], "the saved orders again once the reveal clears");
  setUnitsOverride(units);
  assert.deepEqual(getPendingUnitOrders(), [], "an override without orders leaves the saved ones");
  setUnitsOverride(null);
});

test("both reveals hand the map their orders with their units", () => {
  const source = readFileSync(new URL("../Game/GameUI/time.jsx", import.meta.url), "utf8");
  const calls = [...source.matchAll(/setUnitsOverride\(([^;]*)\);/g)].map((match) => match[1]).filter((args) => args !== "null");
  assert.equal(calls.length, 2, "the live skip and the replay of a past turn");
  for (const args of calls) assert.match(args, /\.pendingUnitOrders \?\? \[\]\)?$/, args);
});

test("a unit placed by hand takes its patrol station with it", () => {
  const orders = [patrolOrder(), patrolOrder({ id: "order-2", unitId: "fleet-2" })];
  const next = recenterPatrolOrders(orders, "fleet-1", 12.5, 41.9);
  assert.deepEqual([next[0].toLng, next[0].toLat], [12.5, 41.9], "the station is where the unit now stands");
  assert.equal(next[0].radiusKm, 150, "the station keeps its size");
  assert.equal(next[0].untilRound, 20, "and its expiry");
  assert.deepEqual([next[1].toLng, next[1].toLat], [0, 1], "another unit's station stays put");
});

test("a march keeps its destination when the marching unit is placed by hand", () => {
  const orders = [{ id: "order-1", unitId: "fleet-1", kind: "move", toLng: 30, toLat: 0 }];
  const next = recenterPatrolOrders(orders, "fleet-1", 12.5, 41.9);
  assert.deepEqual([next[0].toLng, next[0].toLat], [30, 0]);
});

test("a placement with no usable position changes nothing", () => {
  const orders = normalizePendingUnitOrders([patrolOrder()]);
  assert.deepEqual(recenterPatrolOrders(orders, "fleet-1", Number.NaN, 4), orders);
  assert.deepEqual(recenterPatrolOrders(orders, "", 1, 4), orders);
});

test("the next patrol step works the new station, not the old one", () => {
  const placed = { units: [fleet({ lng: 20, lat: 35 })], pendingUnitOrders: recenterPatrolOrders([patrolOrder()], "fleet-1", 20, 35) };
  const after = advanceStandingOrders(placed, { fromDate: "2024-01-01", toDate: "2024-01-08", round: 3 });
  const unit = after.units[0];
  assert.ok(haversineKm(35, 20, unit.lat, unit.lng) <= 150 + 1, "the fleet patrols around where it was placed");
  assert.ok(haversineKm(1, 0, unit.lat, unit.lng) > 1000, "not dragged back to the old station");
});

test("a formation that marches in under posture patrol starts a station where it arrives", () => {
  // Too far for one turn: the op leaves a move order behind, and the patrol order
  // that was there is replaced by it.
  let { units, orders } = applyUnitOpBatch(
    [fleet({ posture: "patrol" })],
    [patrolOrder()],
    [{ op: "move", unitId: "fleet-1", toLng: 30, toLat: 0 }],
    { gameDate: "2024-01-01", elapsedDays: 1, round: 2 },
  );
  assert.equal(orders[0].kind, "move");
  let world = { units, pendingUnitOrders: orders };
  for (let round = 3; round < 15 && world.pendingUnitOrders[0]?.kind === "move"; round += 1) {
    world = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-01-05", round });
  }
  const [order] = world.pendingUnitOrders;
  assert.equal(order?.kind, "patrol", "the unit patrols where it arrived instead of standing there with no station");
  assert.ok(haversineKm(0, 30, order.toLat, order.toLng) < 60, "the station is at the destination");
  assert.ok(order.radiusKm > 0 && order.untilRound > 0);
  ({ units, orders } = { units: world.units, orders: world.pendingUnitOrders });
  assert.equal(units[0].posture, "patrol");
});

test("a formation that marches in under any other posture just stops", () => {
  const { units, orders } = applyUnitOpBatch(
    [fleet()],
    [],
    [{ op: "move", unitId: "fleet-1", toLng: 30, toLat: 0, posture: "transit" }],
    { gameDate: "2024-01-01", elapsedDays: 1, round: 2 },
  );
  let world = { units, pendingUnitOrders: orders };
  for (let round = 3; round < 15 && world.pendingUnitOrders.length; round += 1) {
    world = advanceStandingOrders(world, { fromDate: "2024-01-01", toDate: "2024-01-05", round });
  }
  assert.equal(world.pendingUnitOrders.length, 0);
});

test("the admin placement seam moves a unit and its station in one write", () => {
  const source = readFileSync(new URL("../Game/Map/unitsController.js", import.meta.url), "utf8");
  assert.match(source, /recenterPatrolOrders\(list, id, unit\.lng, unit\.lat\)/, "updateUnitAdmin recentres the station");
  assert.match(source, /pendingUnitOrders: nextOrders/, "commit writes the orders beside the units");
  assert.match(source, /return updateUnitAdmin\(id, \{ lng: nextLng, lat: nextLat \}\)/, "placeUnitAdmin goes through it");
});
