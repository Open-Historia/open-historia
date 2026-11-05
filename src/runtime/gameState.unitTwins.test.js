/*! Open Historia — a formation is never raised twice: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.unitTwins.test.js
//
// A player marked his oil and gas sites with units ("GSI Arzew", "Hub Sud");
// after a time skip each had a twin, and deleting the twin by an action took
// the original with it (a player's report, 2026-10-28).

import test from "node:test";
import assert from "node:assert/strict";

import { applyUnitOpBatch, normalizeWorldState } from "./gameState.js";
import { findUnitByRef, newestTwinByRef } from "../Game/AI/nameRefs.js";

const placed = (name, lng, lat, extra = {}) => ({ id: `p-${name}`, name, type: "garrison", ownerCode: "Algeria", strength: 100, lng, lat, source: "player", createdAt: "2026-10-01T00:00:00.000Z", ...extra });
const spawn = (name, lng, lat, extra = {}) => ({ op: "spawn", unit: { name, type: "garrison", ownerCode: "Algeria", lng, lat, ...extra } });

test("a spawn named as one of its owner's units on the map is that unit: no twin, and the unit stays where it was", () => {
  const units = [placed("GSI Arzew", -0.3, 35.8), placed("Hub Sud", 2.9, 28.5)];
  const { units: after } = applyUnitOpBatch(units, [], [spawn("GSI Arzew", 1.2, 24.1), spawn("hub  sud", 3.0, 28.6)]);
  assert.equal(after.length, 2);
  assert.deepEqual(after.map((unit) => [unit.name, unit.lng, unit.lat]), [["GSI Arzew", -0.3, 35.8], ["Hub Sud", 2.9, 28.5]]);
  // Another owner's unit of the name is its own formation; so is a new name; and two spawns of one new name are one.
  const { units: more } = applyUnitOpBatch(units, [], [
    spawn("GSI Arzew", 1.2, 24.1, { ownerCode: "Morocco" }),
    spawn("GSI Skikda", 6.9, 36.9),
    spawn("GSI Skikda", 7.0, 36.8),
  ]);
  assert.deepEqual(more.map((unit) => `${unit.name} (${unit.ownerCode})`), ["GSI Arzew (Algeria)", "Hub Sud (Algeria)", "GSI Arzew (Morocco)", "GSI Skikda (Algeria)"]);
  // A formation with no name of its own is never matched.
  assert.equal(applyUnitOpBatch([placed("Unit", 1, 30)], [], [spawn("Unit", 2, 31)]).units.length, 2);
});

test("a save with twins keeps the player's unit and drops the AI's copy of it", () => {
  const world = normalizeWorldState({
    units: [
      placed("GSI Arzew", -0.3, 35.8),
      { ...placed("GSI Arzew", 1.2, 24.1), id: "ai-1", source: "ai", createdAt: "2026-10-05T00:00:00.000Z" },
      { ...placed("Base El-Hoggar", 5.5, 22.8), id: "ai-2", source: "ai" },
      { ...placed("GSI Hassi", 3.1, 31.7), id: "ai-3", source: "ai", type: "infantry" },
      placed("GSI Hassi", 6.1, 31.6),
    ],
  });
  assert.deepEqual(world.units.map((unit) => unit.id).sort(), ["ai-2", "ai-3", "p-GSI Arzew", "p-GSI Hassi"]);
});

test("an order to remove one of two units that cannot be told apart removes the newer, never both", () => {
  const units = [
    placed("GSI Arzew", -0.3, 35.8, { source: "ai" }),
    { ...placed("GSI Arzew", 1.2, 24.1, { source: "ai" }), id: "twin", createdAt: "2026-10-05T00:00:00.000Z" },
  ];
  assert.equal(findUnitByRef("GSI Arzew", units), null, "a move cannot tell them apart");
  assert.equal(newestTwinByRef("GSI Arzew", units)?.id, "twin");
  const { units: after } = applyUnitOpBatch(units, [], [{ op: "remove", unitId: "twin" }]);
  assert.deepEqual(after.map((unit) => unit.id), ["p-GSI Arzew"]);
  // Units that differ are not twins.
  assert.equal(newestTwinByRef("GSI Arzew", [units[0], { ...units[1], ownerCode: "Morocco" }]), null);
  assert.equal(newestTwinByRef("GSI Arzew", [units[0]]), null);
});

test("the turn turns a removal of a twin into the newer one's id", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /\|\| \(removes \? newestTwinByRef\(written, units\) : null\);/);
});
