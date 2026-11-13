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
import fs from "node:fs";

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

// A refit could destroy the fleet it refitted: the schema required a strength, the prompt's example showed
// "strength":0 beside the new make-up, and a provider that does not hold to the schema sends strength null, which
// the unit director read as 0 (deleting the formation from its working map), the turn read as a removal and the
// reveal told as "strength null%". A missing or null strength is "unchanged" wherever a refit is read.
test("a refit with no strength, or a null one, keeps the formation and its strength everywhere it is read", async () => {
  for (const strength of [undefined, null, ""]) {
    const refit = { op: "strength", unitId: "fleet-1", strength, composition: "1 carrier, 4 Akizuki-class destroyers" };
    const { units } = applyUnitOpBatch([fleet], [], [refit]);
    assert.equal(units.length, 1, `strength ${strength}`);
    assert.equal(units[0].strength, 80);
    assert.equal(units[0].composition, "1 carrier, 4 Akizuki-class destroyers");
  }
  // One that says neither a strength nor a make-up changes nothing; it no longer sinks the fleet.
  assert.equal(applyUnitOpBatch([fleet], [], [{ op: "strength", unitId: "fleet-1" }]).units[0]?.strength, 80);

  // The unit director's working map keeps the refitted formation, so its later orders still find it.
  const { sanitizeDirectorOrders, strengthGiven } = await import("../Game/AI/nativeUnitDirector.js");
  assert.deepEqual([undefined, null, "", "abc", 0, "40"].map((strength) => strengthGiven({ strength })), [false, false, false, false, true, true]);
  const event = {
    title: "Japanese Carrier Escort Group sails for Truk after its refit",
    description: "The navy's carrier escort group, its destroyers replaced, sails south.",
    kind: "military",
    impacts: { unitOps: [{ op: "strength", unitId: "fleet-1", strength: null, composition: "1 carrier, 4 Akizuki-class destroyers" }] },
  };
  const { acceptedByEvent } = sanitizeDirectorOrders({
    events: [event],
    orders: [{ eventIndex: 0, unitOps: [{ op: "move", unitId: "fleet-1", toLng: 151.8, toLat: 7.4, posture: "transit" }] }],
    units: [fleet],
    game: {},
  });
  assert.equal(acceptedByEvent.get(0)?.length, 1, "the refitted fleet is still there to move");

  // The reveal tells the refit, not "strength null%".
  const { describeEventMapChanges } = await import("../Game/GameUI/turnReveal.js");
  const [line] = describeEventMapChanges({ impacts: { unitOps: [event.impacts.unitOps[0]] } }, { unitName: () => "Carrier Escort Group" });
  assert.equal(line.text, "Carrier Escort Group: refitted: 1 carrier, 4 Akizuki-class destroyers");

  // The turn binds a written name: only a strength of 0 is a removal.
  const gameplay = fs.readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /normalizeString\(op\.op\)\.toLowerCase\(\) === "strength" && strengthGiven\(op\) && Number\(op\.strength\) === 0\);/);
});

test("the time skip's schema and prompt let a refit give no strength, and never show it a strength of 0", () => {
  const schema = getGameplayTool("jumpForward").schema;
  const ops = schema.properties.events.items.properties.impacts.properties.unitOps.items.anyOf;
  const strength = ops.find((entry) => entry.properties.op.enum.includes("strength"));
  assert.ok(!strength.required.includes("strength"), "a refit gives only the make-up");
  const prompts = fs.readFileSync(new URL("../Game/AI/gameplayPrompts.js", import.meta.url), "utf8");
  assert.doesNotMatch(prompts, /"strength":0,"composition"/);
  assert.match(prompts, /for a refit \{"op":"strength","unitId":"<the unit's name>","composition":"<its new make-up>","note":""\}/);
});
