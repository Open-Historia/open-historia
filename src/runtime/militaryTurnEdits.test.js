/*! Open Historia — a turn moves a country's military figures: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/militaryTurnEdits.test.js
//
// Wars and Fronts Pt.2: a time skip's polityChanges[].military says by how
// much a country's figures move (a purge, a rearmament, a fleet lost), and the
// game's own sheet holds the result over the scenario author's figures.

import test from "node:test";
import assert from "node:assert/strict";

import { validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "./gameState.js";
import { militaryLookup, normalizeMilitaryShift, shiftedMilitary } from "./militaryStats.js";

const event = (polityChanges) => ({ date: "1938-03-01", title: "The purge", description: "The officer corps is purged.", impacts: { polityChanges } });

test("a change is by how much each of the five figures moves, rounded and held to a hundred either way", () => {
  assert.deepEqual(normalizeMilitaryShift({ quality: -15.4, land: 10, sea: 0, air: "30", weariness: 20, technology: -400 }), { quality: -15, technology: -100, land: 10, air: 30 });
  assert.equal(normalizeMilitaryShift({ quality: 0 }), null);
  assert.equal(normalizeMilitaryShift("much"), null);
  // From what the country counts as now: its sheet's over its author's, else 50; held between 0 and 100.
  const world = { polityOverrides: { Aland: { name: "Aland", military: { quality: 70, sea: 10 } } }, countryStats: { Aland: { military: { quality: 80 } } } };
  assert.deepEqual(shiftedMilitary(world, "Aland", { quality: -15, sea: -30, air: 20 }), { quality: 65, sea: 0, air: 70 });
  assert.equal(shiftedMilitary(world, "Aland", {}), null);
});

test("the time skip's schema takes it, and the turn writes it into the country's own sheet", () => {
  const payload = { events: [event([{ operation: "update", code: "Aland", military: { quality: -15, land: 10 } }])], stopDate: "1938-03-31", summary: "A purge.", clearActions: true };
  const verdict = validateGameplayPayload("jumpForward", payload);
  assert.equal(verdict.valid, true, verdict.error);
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: { Aland: { name: "Aland", code: "Aland", military: { quality: 70 } } } },
    events: [event([{ operation: "update", code: "Aland", military: { quality: -15, land: 10 } }])],
  });
  assert.deepEqual(world.countryStats.Aland.military, { quality: 55, land: 60 });
  // The author's figures stay as they were; the sheet stands over them.
  assert.deepEqual(world.polityOverrides.Aland.military, { quality: 70 });
  assert.deepEqual(militaryLookup(world)("Aland"), { quality: 55, land: 60 });
  // It survives the save.
  assert.deepEqual(normalizeWorldState(JSON.parse(JSON.stringify(world))).countryStats.Aland.military, { quality: 55, land: 60 });
  // A second turn moves it on from there.
  const again = applyEventImpactsToWorld({ world, events: [event([{ operation: "update", code: "Aland", military: { quality: 10 } }])] }).world;
  assert.equal(again.countryStats.Aland.military.quality, 65);
});
