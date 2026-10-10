/*! Open Historia — a player's forces in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/forces.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { MAX_UNITS_PER_PLAYER, deployFor, disbandFor, revertOrderFor } from "./forces.js";

const FRANCE = "France";
const GERMANY = "Germany";
const AT = "2026-10-05T12:00:00.000Z";
const unit = (id, ownerCode, extra = {}) => ({ id, name: id, type: "infantry", ownerCode, strength: 90, lng: 2.3, lat: 48.8, status: "idle", source: "ai", orderId: "", ...extra });
const state = () => ({
  world: { units: [unit("fr-1", FRANCE), unit("de-1", GERMANY)], pendingUnitOrders: [], allowedUnitTypes: null },
  actions: [{ id: "a-de", status: "planned", text: "Hold the Rhine", ownerCode: GERMANY }],
});
const ask = { type: "armor", strength: 80, name: "2e Division Blindée", composition: "Leclerc tanks", lng: 4.83, lat: 45.76 };
const ids = (n) => ({ orderId: `order-${n}`, unitId: `unit-${n}`, at: AT, maxOrders: 12 });

test("raising a formation puts it on the map as pending, with the request that asks the skip to confirm it", () => {
  const result = deployFor(state(), FRANCE, ask, ids(1));
  assert.equal(result.error, undefined);
  const raised = result.world.units.at(-1);
  assert.deepEqual([raised.id, raised.ownerCode, raised.status, raised.source, raised.type, raised.strength], ["unit-1", FRANCE, "pending", "player", "armor", 80]);
  const order = result.actions.at(-1);
  assert.equal(order.ownerCode, FRANCE);
  assert.deepEqual(order.unitRevert, { unitId: "unit-1", remove: true });
  assert.match(order.text, /^Deploy request: 2e Division Blindée \(armor, strength 80% of establishment, Leclerc tanks, owner France\) at lat 45\.76, lng 4\.83\./);
  assert.equal(result.actions.length, 2, "everyone else's orders are left alone");
});

test("the rules a deployment is held to: the scenario's types, a place on the map, a ceiling on formations and on orders", () => {
  const medieval = state();
  medieval.world.allowedUnitTypes = ["infantry", "naval"];
  assert.match(deployFor(medieval, FRANCE, ask, ids(1)).error, /does not allow that kind of unit/);
  assert.match(deployFor(state(), FRANCE, { ...ask, type: "death-star" }, ids(1)).error, /not a place on the map, or not a kind of unit/);
  assert.match(deployFor(state(), FRANCE, { ...ask, lng: 0, lat: 0 }, ids(1)).error, /not a place on the map/);
  assert.match(deployFor(state(), FRANCE, { ...ask, lat: "north" }, ids(1)).error, /not a place on the map/);

  const full = state();
  full.world.units = Array.from({ length: MAX_UNITS_PER_PLAYER }, (_, n) => unit(`fr-${n}`, FRANCE));
  assert.match(deployFor(full, FRANCE, ask, ids(1)).error, /at most 15 formations/);
  // The beaten are not counted, and nor is anyone else's army.
  full.world.units[0].status = "defeated";
  full.world.units.push(...Array.from({ length: 20 }, (_, n) => unit(`de-${n}`, GERMANY)));
  assert.equal(deployFor(full, FRANCE, ask, ids(1)).error, undefined);

  const busy = state();
  busy.actions = Array.from({ length: 12 }, (_, n) => ({ id: `a-${n}`, status: "planned", text: "x", ownerCode: FRANCE }));
  assert.match(deployFor(busy, FRANCE, ask, ids(1)).error, /At most 12 orders a round/);
});

test("standing down a formation that was only pending withdraws its request too, and asks nothing of the skip", () => {
  const raised = deployFor(state(), FRANCE, ask, ids(1));
  const result = disbandFor(raised, FRANCE, "unit-1", ids(2));
  assert.equal(result.world.units.some((entry) => entry.id === "unit-1"), false);
  assert.deepEqual(result.actions.map((action) => action.id), ["a-de"]);
});

test("standing down a standing formation takes it off the map and queues the order that says so; withdrawing the order brings it back", () => {
  const before = state();
  before.world.units[0] = unit("fr-1", FRANCE, { status: "moving", orderId: "march-1", posture: "advance" });
  before.world.pendingUnitOrders = [{ id: "march-1", unitId: "fr-1", kind: "move" }, { id: "march-2", unitId: "de-1", kind: "move" }];
  const result = disbandFor(before, FRANCE, "fr-1", ids(3));
  assert.deepEqual(result.world.units.map((entry) => entry.id), ["de-1"]);
  assert.deepEqual(result.world.pendingUnitOrders.map((order) => order.id), ["march-2"], "its march goes with it");
  const order = result.actions.at(-1);
  assert.match(order.text, /^Disband order: fr-1 \(infantry, owner France\)/);
  assert.equal(order.unitRevert.restore.id, "fr-1");

  const back = revertOrderFor(result.world, order, FRANCE, { at: AT });
  const restored = back.units.find((entry) => entry.id === "fr-1");
  assert.deepEqual([restored.status, restored.orderId, restored.posture], ["idle", "", ""], "it stands again, without the march that went with it");
  assert.equal(revertOrderFor(back, order, FRANCE, { at: AT }).units.filter((entry) => entry.id === "fr-1").length, 1, "twice is once");
});

test("a formation is its owner's alone to stand down, and an order's undo touches only its owner's pieces", () => {
  assert.match(disbandFor(state(), FRANCE, "de-1", ids(1)).error, /not one of your formations/);
  assert.match(disbandFor(state(), FRANCE, "nothing", ids(1)).error, /not one of your formations/);
  const raised = deployFor(state(), FRANCE, ask, ids(1));
  const order = raised.actions.at(-1);
  // Withdrawn by its owner: the pending formation goes.
  assert.equal(revertOrderFor(raised.world, order, FRANCE).units.some((entry) => entry.id === "unit-1"), false);
  // The same order's undo, asked as another country, removes nothing.
  assert.equal(revertOrderFor(raised.world, order, GERMANY).units.some((entry) => entry.id === "unit-1"), true);
  // An order that moved nothing on the map undoes nothing.
  const world = state().world;
  assert.equal(revertOrderFor(world, { id: "a", text: "Open talks" }, FRANCE), world);
});

test("an order the engine gave a standing march is cancelled with the order", () => {
  const world = { units: [unit("fr-1", FRANCE, { status: "moving", orderId: "march-9" })], pendingUnitOrders: [{ id: "march-9", unitId: "fr-1" }] };
  const after = revertOrderFor(world, { unitRevert: { unitId: "fr-1", pendingOrderId: "march-9", status: "idle" } }, FRANCE, { at: AT });
  assert.deepEqual(after.pendingUnitOrders, []);
  assert.deepEqual([after.units[0].orderId, after.units[0].status], ["", "idle"]);
});
