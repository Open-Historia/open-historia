/*! Open Historia — what a player's own screen changes in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/seatWrites.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { planWorldWrite, revealedTurnOf, suggestionsOutlived } from "./seatWrites.js";

const unit = (id, lng = 10, lat = 50, extra = {}) => ({ id, ownerCode: "France", status: "idle", lng, lat, orderId: "", ...extra });
const held = () => ({
  units: [unit("fr-1"), unit("de-1", 13, 52, { ownerCode: "Germany" })],
  pendingUnitOrders: [],
  spies: [{ id: "spy-1", status: "active" }],
  projects: [{ id: "p1", name: "Rail programme", status: "active" }],
  polityOverrides: { France: { name: "France" } },
});

test("a save that changes nothing of the player's own plans nothing", () => {
  const wanted = { ...held(), polityOverrides: { France: { name: "Changed by a cheat" } }, lastJumpSummary: "", gmAudit: [] };
  assert.deepEqual(planWorldWrite(held(), wanted), { device: {}, board: null, unsent: [] });
  assert.deepEqual(planWorldWrite(held(), null), { device: {}, board: null, unsent: [] });
});

test("the AI's suggestions stay on this device", () => {
  const topics = [{ id: "topic-0", title: "Shore up the franc", actions: [] }];
  const plan = planWorldWrite(held(), { ...held(), actionSuggestions: topics });
  assert.deepEqual(plan, { device: { actionSuggestions: topics }, board: null, unsent: [] });
  // Held already (this device's own, laid over the view): saved again, nothing to do.
  assert.deepEqual(planWorldWrite({ ...held(), actionSuggestions: topics }, { ...held(), actionSuggestions: topics }).device, {});
  // Cleared by the page itself.
  assert.deepEqual(planWorldWrite({ ...held(), actionSuggestions: topics }, { ...held(), actionSuggestions: [] }).device, { actionSuggestions: [] });
});

test("the player's own Projects board is asked of the host, whole", () => {
  const board = [...held().projects, { id: "p2", name: "Naval yard", status: "proposed" }];
  assert.deepEqual(planWorldWrite(held(), { ...held(), projects: board }).board, board);
  assert.equal(planWorldWrite(held(), { ...held() }).board, null);
  assert.deepEqual(planWorldWrite(held(), { ...held(), projects: [] }).board, [], "an emptied board is a change");
  assert.equal(planWorldWrite(held(), { units: [] }).board, null, "a save that says nothing of the board changes none");
});

test("orders to units and agents are not sent, and are named once each", () => {
  const moved = { ...held(), units: [unit("fr-1", 11, 50), held().units[1]] };
  assert.deepEqual(planWorldWrite(held(), moved).unsent, ["units"]);
  const deployed = { ...held(), units: [...held().units, unit("fr-2", 2, 48, { status: "pending" })], pendingUnitOrders: [{ id: "o1", status: "" }] };
  assert.deepEqual(planWorldWrite(held(), deployed).unsent, ["units"]);
  assert.deepEqual(planWorldWrite(held(), { ...held(), spies: [...held().spies, { id: "spy-2", status: "active" }] }).unsent, ["agents"]);
  // The page's normalizer filling a default or reordering a field is not an order.
  const renormalized = { ...held(), units: held().units.map((entry) => ({ note: "", ...entry, lng: Number(entry.lng.toFixed(6)) })) };
  assert.deepEqual(planWorldWrite(held(), renormalized).unsent, []);
});

test("suggestions are for the round they were asked in", () => {
  assert.equal(suggestionsOutlived(4, 4), false);
  assert.equal(suggestionsOutlived(4, 5), true);
  assert.equal(suggestionsOutlived(undefined, 5), false, "nothing was held yet");
});

test("the newest turn is revealed event by event when it is a time skip", () => {
  assert.equal(revealedTurnOf({}), null);
  assert.equal(revealedTurnOf({ simulationHistory: [{ mode: "jump", eventIds: [] }] }), null);
  assert.deepEqual(revealedTurnOf({ simulationHistory: [{ mode: "jump", round: 7, eventIds: ["e7", "e8"] }, { mode: "jump", eventIds: ["e1"] }] }), { key: "e7", eventIds: ["e7", "e8"], round: 7 });
  assert.equal(revealedTurnOf({ simulationHistory: [{ mode: "gm", eventIds: ["g1"] }] }), null, "a Game Master's change is one moment");
});
