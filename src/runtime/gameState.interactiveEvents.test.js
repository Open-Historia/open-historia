/*! Open Historia — interactive events in a save © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.interactiveEvents.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// What a save carries of interactive events: the scene in progress, the offer
// the last time skip made and the round of the last offer. And what a save
// written before they were renamed (they were catalysts until 18 September
// 2026) carries instead, read under the new names and never written back
// under the old.

import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_DEFAULTS, normalizeEventEntry, normalizeWorldState } from "./gameState.js";

const scene = { title: "The table", premise: "p", opening: "o", choices: ["a", "b"], history: [], origin: "player" };

test("a new world has no scene, no offer and no offer made yet", () => {
  assert.equal(WORLD_DEFAULTS.activeInteractive, null);
  assert.equal(WORLD_DEFAULTS.interactiveOffer, null);
  assert.equal(WORLD_DEFAULTS.lastInteractiveOfferRound, 0);
  const world = normalizeWorldState({});
  assert.equal(world.activeInteractive, null);
  assert.equal(world.interactiveOffer, null);
  assert.equal(world.lastInteractiveOfferRound, 0);
});

test("the offer and the round of the last one survive a save, tidied", () => {
  const world = normalizeWorldState(JSON.parse(JSON.stringify({
    interactiveOffer: { eventId: " event-ai-r0007-19140801-003 ", round: 7, stray: true },
    lastInteractiveOfferRound: "7",
  })));
  assert.deepEqual(world.interactiveOffer, { eventId: "event-ai-r0007-19140801-003", round: 7 });
  assert.equal(world.lastInteractiveOfferRound, 7);
  assert.equal(normalizeWorldState({ interactiveOffer: { eventId: "" } }).interactiveOffer, null);
  assert.equal(normalizeWorldState({ lastInteractiveOfferRound: -3 }).lastInteractiveOfferRound, 0);
});

test("a scene saved under its old key is the scene in progress, and the old key is gone", () => {
  const world = normalizeWorldState({ activeCatalyst: scene });
  assert.equal(world.activeInteractive.title, "The table");
  assert.equal("activeCatalyst" in world, false);
  const both = normalizeWorldState({ activeCatalyst: { ...scene, title: "Old" }, activeInteractive: { ...scene, title: "New" } });
  assert.equal(both.activeInteractive.title, "New", "the new key wins");
});

test("a turn record keeps no scene, and an old scene turn reads as an interactive one", () => {
  const [record] = normalizeWorldState({
    simulationHistory: [{ mode: "catalyst", catalyst: scene, round: 4, eventIds: ["e1"] }],
  }).simulationHistory;
  assert.equal(record.mode, "interactive");
  assert.equal("catalyst" in record, false);
  assert.equal("interactive" in record, false);
  const [jump] = normalizeWorldState({ simulationHistory: [{ mode: "jump", interactive: null, round: 5 }] }).simulationHistory;
  assert.equal(jump.mode, "jump");
  assert.equal("interactive" in jump, false);
});

test("an event a scene wrote before the rename is an interactive one", () => {
  assert.equal(normalizeEventEntry({ title: "The summit", kind: "catalyst" }).kind, "interactive");
  assert.equal(normalizeEventEntry({ title: "The summit", kind: "interactive" }).kind, "interactive");
  assert.equal(normalizeEventEntry({ title: "A border clash" }).kind, "world");
});
