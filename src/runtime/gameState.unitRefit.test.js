/*! Open Historia — a formation refitted takes its new make-up: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.unitRefit.test.js
//
// "Made new ships and so went to switch outdated designs from carrier escort
// duty and use the new ones. The game's events act like this worked, but the
// ship make-up list when clicked on still show old ships rather than the
// altered version" (a player's report, 2026-11-09). No unit op could change a
// formation's composition: the story told the refit, and the card kept the
// ships the fleet was raised with.

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld, applyUnitOpBatch, normalizeWorldState } from "./gameState.js";
import { getGameplayTool } from "../Game/AI/gameplaySchemas.js";

const fleet = { id: "fleet-1", name: "Carrier Escort Group", type: "naval", ownerCode: "Japan", strength: 80, lng: 139.7, lat: 34.6, composition: "1 carrier, 4 Fubuki-class destroyers", source: "ai" };

test("a strength op with a composition refits the formation: the card shows the new ships", () => {
  const refit = { op: "strength", unitId: "fleet-1", strength: 100, composition: "1 carrier, 4 Akizuki-class destroyers", note: "The old escorts are replaced." };
  const { units } = applyUnitOpBatch([fleet], [], [refit]);
  assert.equal(units[0].composition, "1 carrier, 4 Akizuki-class destroyers");
  assert.equal(units[0].strength, 100);
  // A refit that gives no strength keeps the fleet's own; one that gives no composition keeps its ships.
  const { units: kept } = applyUnitOpBatch([fleet], [], [{ op: "strength", unitId: "fleet-1", composition: "1 carrier, 2 Akizuki-class destroyers" }]);
  assert.equal(kept[0].strength, 80);
  assert.equal(kept[0].composition, "1 carrier, 2 Akizuki-class destroyers");
  const { units: worn } = applyUnitOpBatch([fleet], [], [{ op: "strength", unitId: "fleet-1", strength: 60 }]);
  assert.equal(worn[0].composition, fleet.composition);
  assert.equal(worn[0].strength, 60);
  // A strength op of 0 with no composition still sinks it.
  assert.equal(applyUnitOpBatch([fleet], [], [{ op: "strength", unitId: "fleet-1", strength: 0 }]).units.length, 0);
});

test("a time skip's event that re-equips a fleet changes the fleet in the world", () => {
  const world = normalizeWorldState({ units: [fleet] });
  const { world: after } = applyEventImpactsToWorld({
    world,
    round: 4,
    events: [{
      id: "e1",
      date: "1942-06-01",
      title: "Escort group re-equipped",
      description: "The carrier's old destroyers are replaced by the new Akizuki class.",
      importance: "minor",
      kind: "military",
      impacts: { unitOps: [{ op: "strength", unitId: "fleet-1", strength: 95, composition: "1 carrier, 4 Akizuki-class destroyers" }] },
    }],
  });
  const unit = after.units.find((entry) => entry.id === "fleet-1");
  assert.equal(unit.composition, "1 carrier, 4 Akizuki-class destroyers");
  assert.equal(unit.strength, 95);
});

test("the time skip's schema lets a strength op carry the new composition", () => {
  const schema = getGameplayTool("jumpForward").schema;
  const ops = schema.properties.events.items.properties.impacts.properties.unitOps.items.anyOf;
  const strength = ops.find((entry) => entry.properties.op.enum.includes("strength"));
  assert.equal(strength.properties.composition?.type, "string");
  assert.ok(!strength.required.includes("composition"), "a strength op without a refit needs none");
});
