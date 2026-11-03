/*! Open Historia — battlefields in the world state © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.battlefields.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// What the world keeps of a land war (runtime/fronts/): the battlefields
// themselves, the mark on a formation that is fighting on one, and the mark on
// a change of hands the front engine worked out.

import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UNITS_PER_POLITY, enforceUnitVolume, normalizeEventEntry, normalizeUnitEntry, normalizeWorldState } from "./gameState.js";
import { createFrame } from "./fronts/frame.js";

const battlefield = (overrides = {}) => ({
  name: "Eastern Ukraine",
  warId: "war-1",
  status: "active",
  sides: [["Russia"], ["Ukraine"]],
  openedDate: "2024-03-01",
  asOf: "2024-04-01",
  frame: createFrame({ west: 30, south: 46, east: 40, north: 52 }),
  ...overrides,
});
const unit = (overrides = {}) => ({ id: "u1", name: "1st Army", type: "infantry", ownerCode: "Russia", strength: 80, lng: 36, lat: 50, ...overrides });

test("a world with no battlefields has an empty list, and a saved one survives a read", () => {
  assert.deepEqual(normalizeWorldState({}).battlefields, []);
  const world = normalizeWorldState({ battlefields: [battlefield(), { name: "", sides: [] }, "junk"] });
  assert.equal(world.battlefields.length, 1);
  assert.equal(world.battlefields[0].name, "Eastern Ukraine");
  assert.deepEqual(world.battlefields[0].troops, ["", ""]);
  // Read again, as every reader of the world does: nothing changes.
  assert.deepEqual(normalizeWorldState(world).battlefields, world.battlefields);
  assert.deepEqual(normalizeWorldState(JSON.parse(JSON.stringify(world))).battlefields, world.battlefields);
});

// A real-key test (2026-10-28) saved a front named with its war's id.
test("a battlefield saved under its war's id is renamed on reading, and its formations follow it", () => {
  const world = normalizeWorldState({
    battlefields: [battlefield({ name: "WAR-RUSSIA-UKRAINE-2024", warId: "war-russia-ukraine-2024" })],
    units: [unit({ committedTo: "WAR-RUSSIA-UKRAINE-2024" })],
  });
  assert.equal(world.battlefields[0].name, "Russia - Ukraine front");
  assert.equal(world.units[0].committedTo, "Russia - Ukraine front");
  assert.deepEqual(normalizeWorldState(world).battlefields.map((record) => record.name), ["Russia - Ukraine front"]);
});

test("a formation keeps the battlefield it is fighting on, and only then carries the field", () => {
  assert.equal(normalizeUnitEntry(unit({ committedTo: " Eastern Ukraine " })).committedTo, "Eastern Ukraine");
  assert.equal("committedTo" in normalizeUnitEntry(unit()), false);
  assert.equal("committedTo" in normalizeUnitEntry(unit({ committedTo: "" })), false);
});

test("a committed formation is not thinned out and takes none of its country's room", () => {
  const stamp = "2024-01-01T00:00:00.000Z";
  const committed = Array.from({ length: 20 }, (_, index) =>
    unit({ id: `c${index}`, source: "ai", strength: 10, committedTo: "Eastern Ukraine", createdAt: stamp, updatedAt: stamp }));
  const free = Array.from({ length: MAX_UNITS_PER_POLITY + 3 }, (_, index) =>
    unit({ id: `f${index}`, source: "ai", strength: 50 + index, createdAt: stamp, updatedAt: stamp }));
  const pruned = enforceUnitVolume({ units: [...committed, ...free] }, { playerCode: "France" });
  const kept = new Set(pruned.units.map((entry) => entry.id));
  assert.equal(committed.every((entry) => kept.has(entry.id)), true);
  assert.equal(pruned.units.filter((entry) => !entry.committedTo).length, MAX_UNITS_PER_POLITY);
});

test("a change of hands the front engine worked out keeps its mark, and nobody else can claim it", () => {
  const event = (impacts) => normalizeEventEntry({ id: "e1", date: "2024-03-10", title: "The line moves", description: "x", impacts });
  const marked = event({
    regionControlOps: [
      { op: "control", regionId: "r1", fromCode: "Ukraine", toCode: "Russia", basis: "occupation", by: "front", note: "Eastern Ukraine" },
      { op: "control", regionId: "r2", fromCode: "Ukraine", toCode: "Russia", by: "the model" },
      { op: "contest", regionId: "r3", fromCode: "Ukraine", actorCode: "Russia", by: "front" },
    ],
    groupOps: [
      { op: "take", name: "Wagner", regionIds: ["r4"], by: "front" },
      { op: "release", name: "Wagner", regionIds: ["r5"] },
    ],
  }).impacts;
  assert.equal(marked.regionControlOps[0].by, "front");
  assert.equal("by" in marked.regionControlOps[1], false);
  assert.equal("by" in marked.regionControlOps[2], false, "only a change of control carries it");
  assert.equal(marked.groupOps[0].by, "front");
  assert.equal("by" in marked.groupOps[1], false);
});
