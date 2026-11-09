/*! Open Historia — nothing is ever put at lng 0, lat 0: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/nullIsland.test.js
//
// "i had an airplane squadron and i tasked them to bomb the enemy but they
// spawned on the equator in the middle of the ocean"; "troops just appeared
// and disappeared" (a player's report, 2026-11-09). A coordinate a save kept
// as null (JSON writes NaN so) was read as 0: a standing order to lng 0, lat 0
// carried its unit there, a patrol worked its ring round it, and a unit that
// reached it exactly was taken off the map (no unit stands at 0, 0).

import test from "node:test";
import assert from "node:assert/strict";

import { advanceStandingOrders, normalizeWorldState } from "./gameState.js";
import { stepToward } from "./unitMotion.js";
import { applyFrontUnitChanges } from "../Game/AI/frontTurn.js";

const squadron = { id: "air-1", name: "No. 1 Bomber Squadron", type: "air", ownerCode: "Belgium", strength: 100, lng: 4.35, lat: 50.85, composition: "12 bombers", source: "ai" };
const nearNullIsland = (unit) => Math.abs(unit.lng) < 20 && Math.abs(unit.lat) < 20;

test("a standing order whose place a save lost as null is no order to lng 0, lat 0", () => {
  for (const kind of ["move", "patrol"]) {
    const world = normalizeWorldState({
      units: [{ ...squadron, posture: kind === "patrol" ? "patrol" : "" }],
      pendingUnitOrders: [{ id: "o1", unitId: "air-1", kind, toLng: null, toLat: null, radiusKm: 300 }],
    });
    assert.deepEqual(world.pendingUnitOrders, [], `a ${kind} order with no place is dropped`);
    const after = advanceStandingOrders({ ...world, pendingUnitOrders: [{ id: "o1", unitId: "air-1", kind, toLng: null, toLat: null, radiusKm: 300 }] }, { fromDate: "1885-01-01", toDate: "1885-07-01", round: 3 });
    const unit = after.units.find((entry) => entry.id === "air-1");
    assert.ok(unit, "the squadron is still on the map");
    assert.ok(!nearNullIsland(unit), `the squadron is at ${unit.lng}, ${unit.lat}`);
  }
  // Nor is one to 0, 0 itself, the placeholder of the answer's template.
  assert.deepEqual(normalizeWorldState({ units: [squadron], pendingUnitOrders: [{ id: "o1", unitId: "air-1", kind: "move", toLng: 0, toLat: 0 }] }).pendingUnitOrders, []);
  // A real order still stands.
  assert.equal(normalizeWorldState({ units: [squadron], pendingUnitOrders: [{ id: "o1", unitId: "air-1", kind: "move", toLng: 5.1, toLat: 52.1 }] }).pendingUnitOrders.length, 1);
});

test("a step toward no place stays where it stands, and 0 is still a place", () => {
  for (const to of [null, undefined, {}, { lng: null, lat: null }, { lng: "", lat: "" }, { lng: Number.NaN, lat: 52 }]) {
    const step = stepToward({ lng: 4.35, lat: 50.85 }, to, 5000);
    assert.deepEqual([step.lng, step.lat, step.arrived], [4.35, 50.85, true], JSON.stringify(to));
  }
  // One that stood nowhere is put where it was going.
  assert.deepEqual([stepToward({ lng: null, lat: null }, { lng: 5.1, lat: 52.1 }, 10).lng, stepToward({}, { lng: 5.1, lat: 52.1 }, 10).lat], [5.1, 52.1]);
  // The prime meridian and the equator are places like any other.
  const along = stepToward({ lng: 0, lat: 10 }, { lng: 0, lat: -10 }, 99999);
  assert.deepEqual([along.lng, along.lat, along.arrived], [0, -10, true]);
});

test("a formation the front engine hands back with no place keeps its own, never 0, 0", () => {
  const brigade = { id: "inf-1", name: "1st Brigade", type: "infantry", ownerCode: "Belgium", strength: 80, lng: 4.4, lat: 51.2, committedTo: "The Scheldt" };
  for (const change of [{ lng: null, lat: null }, { lng: "", lat: "" }, { lng: 0, lat: 0 }, {}]) {
    const [unit] = applyFrontUnitChanges([brigade], [{ unitId: "inf-1", committedTo: "", strength: 60, ...change }]);
    assert.deepEqual([unit.lng, unit.lat, unit.strength, unit.committedTo], [4.4, 51.2, 60, undefined], JSON.stringify(change));
  }
  const [moved] = applyFrontUnitChanges([brigade], [{ unitId: "inf-1", committedTo: "", lng: 4.9, lat: 51.4, strength: 70 }]);
  assert.deepEqual([moved.lng, moved.lat], [4.9, 51.4]);
});
