/*! Open Historia — what the timeline curator counts as a material recurrence © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTimelineCurator.recurrence.test.js
//
// Runs without node_modules: nativeTimelineCurator.js imports nothing.
//
// A repeat of a recent event survives the curator when it reports real harm
// again. The cue must not fire on a sentence that says the harm did NOT happen.
// These were the curator's in-bundle self-test.

import test from "node:test";
import assert from "node:assert/strict";

import { hasMaterialRecurrenceCue } from "./nativeTimelineCurator.js";

const event = (description) => ({
  title: "Test",
  description,
  impacts: {
    createdChats: [],
    polityChanges: [],
    politicalActorOps: [],
    regionTransfers: [],
    regionClaims: [],
    unitOps: [],
    markerOps: [],
  },
});

test("real disruption counts as a material recurrence", () => {
  assert.equal(hasMaterialRecurrenceCue(event("Repeated shortages and transport disruption spread across the district.")), true);
});

test("\"without disruption\" is not a material recurrence", () => {
  assert.equal(hasMaterialRecurrenceCue(event("Spring sowing concludes without major domestic disruption.")), false);
});

test("\"no shortages\" is not a material recurrence", () => {
  assert.equal(hasMaterialRecurrenceCue(event("Officials report no shortages or unrest during the distribution period.")), false);
});
