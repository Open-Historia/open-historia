/*! Open Historia — a polity change's note is its reason, not its description © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.polityNote.test.js
//
// The time skip's polityChanges carry `note: "Brief reason."`, and the game wrote
// that reason over the polity's description: a week's "Provision sent in
// fulfilment of Ulfric II's promise to the Order" took the place of a
// scenario's whole account of Brightdale, its character and its economy (a Discord
// game, 2026-10-28).

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld } from "./gameState.js";

const event = (polityChanges) => ({ date: "0523-01-10", title: "Provisions for the Order", description: "Wagons left Corvale.", impacts: { polityChanges } });
const BRIGHTDALE = "A wealthy and decadent kingdom.\nCharacter: Charming, vain and full of intrigue.";

test("an update's reason leaves the polity's description as it was", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: { Brightdale: { name: "Brightdale", aliases: [], color: "#f08a3c", note: BRIGHTDALE } } },
    events: [event([{ operation: "update", code: "Brightdale", reputation: 60, note: "Provision sent in fulfilment of Ulfric II's promise to the Order." }])],
  });
  assert.equal(world.polityOverrides.Brightdale.note, BRIGHTDALE);
});

test("a polity with no description yet takes the reason as its first", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: { Brightdale: { name: "Brightdale", aliases: [], color: "#f08a3c", note: "" } } },
    events: [event([{ operation: "update", code: "Brightdale", note: "A southern kingdom of vineyards." }])],
  });
  assert.equal(world.polityOverrides.Brightdale.note, "A southern kingdom of vineyards.");
});
