/*! Open Historia — which events the territory director is asked about © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTerritoryDirector.rules.test.js
//
// Runs without node_modules: nativeTerritoryDirector.js imports nothing.
//
// The director is a request (or a job in the turn review) after every skip with
// a territorial event. Its answer is filtered by wording: a control flip needs a
// capture, a contest a fight, a clear_contest a ceasefire or withdrawal. An event
// with none of those can only get ops the rules drop, so it must not be asked
// about at all.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTerritoryDirectorInput, directGeneratedTerritoryOps } from "./nativeTerritoryDirector.js";

const event = (title, description = "", impacts = {}) => ({
  date: "1914-09-01",
  title,
  description,
  impacts: { regionTransfers: [], regionControlOps: [], unitOps: [], ...impacts },
});

const world = { regionOwnershipOverrides: {}, regionSovereigntyOverrides: {}, regionClaimants: {} };

const candidateIndexes = async (events) =>
  (await buildTerritoryDirectorInput({ events, world }))?.candidates.map((row) => row.eventIndex) ?? [];

test("a treaty cession with no fighting or capture wording is not asked about", async () => {
  const cession = event(
    "Treaty of Frankfurt cedes Alsace",
    "France cedes Alsace to the German Empire under the treaty, and German sovereignty over the province is recognised.",
    { regionTransfers: [{ regionId: "Alsace", fromCode: "France", toCode: "German Empire" }] },
  );
  assert.deepEqual(await candidateIndexes([cession]), []);
});

test("a treaty or sovereignty event without a fight is skipped, and the analyzer is never run", async () => {
  let asked = 0;
  const events = [
    event("Trade treaty signed in Lisbon", "Portugal and Brazil sign a commercial treaty lowering tariffs on coffee."),
    event("Parliament debates sovereignty", "Deputies argue over sovereignty in a long session; no vote is taken."),
  ];
  const out = await directGeneratedTerritoryOps({ events, world, analyzeBatch: async () => { asked += 1; return { eventOrders: [] }; } });
  assert.equal(asked, 0);
  assert.equal(out.length, 2);
});

test("a capture, a fight and a ceasefire are each asked about", async () => {
  const events = [
    event("German army captures Liège", "The fortress city falls to German troops after a siege."),
    event("Battle on the Marne", "French and British forces counterattack along the river."),
    event("Ceasefire on the Bosnian front", "Both sides agree to a ceasefire and begin to withdraw."),
    event("Coal output rises", "Mines in the Ruhr report a record quarter."),
  ];
  assert.deepEqual(await candidateIndexes(events), [0, 1, 2]);
});

test("a control change the event itself denies is not asked about", async () => {
  const stalemate = event(
    "Stalemate over the pass",
    "Neither side manages to take control of the pass; the lines hold where they were.",
  );
  // "control of" is territorial wording, but the only op it could suggest is a
  // negated control flip, and nothing here is a fight or a ceasefire.
  assert.deepEqual(await candidateIndexes([stalemate]), []);
});

test("a peace event can still clear a contest, so it is still asked about", async () => {
  const peace = event("Peace returns to the valley", "The two powers make peace and the claims along the valley lapse.");
  assert.deepEqual(await candidateIndexes([peace]), [0]);
});
