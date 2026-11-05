/*! Open Historia — a turn's model is shown the military figures it may move: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/militaryStanding.test.js
//
// "i spent a decade as ukraine to prepare against russia AND SHIT DONT MOVE ...
// i trippled the size of the army, built new jets, spent 10% of gdp and i
// trained my units for 10 years AND IT DIDNT MOVE" (a player, 2026-10-17).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";
import { applyEventImpactsToWorld } from "./gameState.js";
import { MILITARY_CHANGE_RULE, describeMilitaryStanding } from "./militaryStanding.js";
import { normalizeMilitaryShift, shiftedMilitary } from "./militaryStats.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("spending and the share of people under arms move too, the share from the scenario's or the game's twelve", () => {
  assert.deepEqual(normalizeMilitaryShift({ quality: 30, spending: 20, manpower: 24, air: 25 }), { quality: 30, air: 25, spending: 20, manpowerShare: 24 });
  const world = { countryStats: { Ukraine: { military: { quality: 40, technology: 45, spending: 30 } } } };
  assert.deepEqual(shiftedMilitary(world, "Ukraine", { quality: 30, spending: 20, manpower: 24 }), { quality: 70, spending: 50, manpowerShare: 36 });
  // Never more than half its people, never none.
  assert.deepEqual(shiftedMilitary(world, "Ukraine", { manpower: 90 }), { manpowerShare: 50 });
  assert.deepEqual(shiftedMilitary(world, "Ukraine", { manpower: -40 }), { manpowerShare: 0.1 });
  assert.deepEqual(shiftedMilitary({ warSettings: { manpowerShare: 5 } }, "Ukraine", { manpower: 3 }), { manpowerShare: 8 });
});

test("a decade of rearmament reaches the country's sheet through the time skip's answer", () => {
  const change = { operation: "update", code: "Ukraine", military: { quality: 25, technology: 15, spending: 35, manpower: 18, land: 20, air: 25 } };
  const payload = { events: [{ date: "2026-01-01", title: "A decade of rearmament", description: "The army trebles.", impacts: { polityChanges: [change] } }], stopDate: "2026-01-31", summary: "Ten years.", clearActions: true };
  const verdict = validateGameplayPayload("jumpForward", payload);
  assert.equal(verdict.valid, true, verdict.error);
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: { Ukraine: { name: "Ukraine", code: "Ukraine" } }, countryStats: { Ukraine: { military: { quality: 40, technology: 45, spending: 30, land: 50, air: 30 } } } },
    events: payload.events,
  });
  assert.deepEqual(world.countryStats.Ukraine.military, { quality: 65, technology: 60, spending: 65, land: 70, air: 55, manpowerShare: 30 });
});

test("the model is shown the player's figures and its enemies', with the rule for moving them", () => {
  const world = {
    wars: [{ id: "w", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] }, { id: "x", status: "ended", sideA: ["Poland"], sideB: ["Ukraine"] }],
    countryStats: { Ukraine: { military: { quality: 40, technology: 45, spending: 30, sea: 15, air: 30 } } },
  };
  const text = describeMilitaryStanding(world, "Ukraine");
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- Ukraine \(the player's\): troop quality 40, technology 45, spending 30, manpower 12% of its people, land 50, sea 15, air 30$/);
  assert.match(lines[1], /^- Russia: troop quality 50/);
  // Not where the scenario does not weigh countries' figures.
  assert.equal(describeMilitaryStanding({ ...world, warSettings: { mechanics: { military: false } } }, "Ukraine"), "");
  assert.equal(describeMilitaryStanding(world, ""), "");
  assert.match(MILITARY_CHANGE_RULE, /military: \{ quality, technology, spending, manpower, land, sea, air \}/);
  assert.match(MILITARY_CHANGE_RULE, /a decade of determined rearmament twenty or more/);
});

test("the time skip, the actions and the interactive prompts carry it, and the variable is built for them", () => {
  const gameplay = read("../Game/AI/gameplay.js");
  assert.match(gameplay, /if \(militaryStanding\) blocks\.push\(`\[Military Strength\]\\n\$\{militaryStanding\}\\n\$\{MILITARY_CHANGE_RULE\}`\);/);
  assert.match(gameplay, /if \(\["actions", "interactiveCreation", "interactiveExecutor"\]\.includes\(taskKey\)\) \{\s+const militaryContext = normalizeString\(variables\.playerPolityMilitaryContext\);/);
  assert.match(gameplay, /variables\.playerPolityMilitaryContext = describeMilitaryStanding\(/);
  const diagnostics = read("../Game/AI/contextDiagnostics.js");
  assert.equal((diagnostics.match(/"playerPolityMilitaryContext"/g) || []).length, 5, "actions, both skips and both interactive tasks");
  assert.match(read("../Game/AI/gameplaySchemas.js"), /each -40 to 40: quality, technology, spending, manpower, land, sea, air\./);
});
