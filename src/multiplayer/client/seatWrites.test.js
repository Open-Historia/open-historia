/*! Open Historia — what a player's own screen changes in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/seatWrites.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { planWorldWrite, revealedTurnOf, suggestionsOutlived, unroutedChanges } from "./seatWrites.js";

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
  assert.deepEqual(planWorldWrite(held(), wanted), { device: {} });
  assert.deepEqual(planWorldWrite(held(), null), { device: {} });
});

test("the AI's suggestions stay on this device", () => {
  const topics = [{ id: "topic-0", title: "Shore up the franc", actions: [] }];
  const plan = planWorldWrite(held(), { ...held(), actionSuggestions: topics });
  assert.deepEqual(plan, { device: { actionSuggestions: topics } });
  // Held already (this device's own, laid over the view): saved again, nothing to do.
  assert.deepEqual(planWorldWrite({ ...held(), actionSuggestions: topics }, { ...held(), actionSuggestions: topics }).device, {});
  // Cleared by the page itself.
  assert.deepEqual(planWorldWrite({ ...held(), actionSuggestions: topics }, { ...held(), actionSuggestions: [] }).device, { actionSuggestions: [] });
});

// The board was asked of the host whole, and the host kept the page's entries as they came: their progress and
// what their plans do (the gap audit of 2026-11-18). It is changed by the game's own project operations, asked of
// the host by the screen that makes them ("projectOps"); a save that changes it is a change no door takes.
test("the player's own Projects board never travels in a save: a change to it in one is said", () => {
  const board = [...held().projects, { id: "p2", name: "Naval yard", status: "proposed", progress: 99 }];
  assert.deepEqual(planWorldWrite(held(), { ...held(), projects: board }), { device: {} });
  assert.deepEqual(unroutedChanges("world", held(), { ...held(), projects: board }), ["projects"]);
});

test("forces and agents never travel in a save: their own screens ask the host", () => {
  const moved = { ...held(), units: [unit("fr-1", 11, 50), held().units[1]], spies: [...held().spies, { id: "spy-2", status: "active" }] };
  assert.deepEqual(planWorldWrite(held(), moved), { device: {} });
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

// The map's rule 6: a change a save holds beyond what a door takes is named, by document and field, instead of
// passing for saved (a thread deleted, a flag changed, a unit edited: each was found by a player).
test("what a save changes that no door takes is named, and the empty defaults a page fills in are no change", () => {
  const held = { wars: [{ id: "w" }], projects: [], actionSuggestions: [] };
  assert.deepEqual(unroutedChanges("world", held, { ...held, actionSuggestions: [{ id: "s" }] }), []);
  assert.deepEqual(unroutedChanges("world", held, { ...held, projects: [{ id: "p" }] }), ["projects"], "the board is the host's to change");
  assert.deepEqual(unroutedChanges("world", held, { ...held, seatBoards: {}, interactiveOffer: null, notes: "" }), [], "defaults filled in");
  assert.deepEqual(unroutedChanges("world", held, { ...held, units: [{ id: "u", strength: 99 }], wars: [] }), ["units", "wars"]);
  const threads = [{ id: "t1", title: "Talks", messages: [{ id: "m1", role: "user", text: "Hello" }] }];
  const bubble = { role: "error", speaker: "System", text: "The host did not take that." };
  assert.deepEqual(unroutedChanges("chat", threads, [{ ...threads[0], messages: [...threads[0].messages, bubble] }]), [], "the screen's own bubble");
  assert.deepEqual(unroutedChanges("chat", threads, [{ ...threads[0], status: "closed" }]), ["thread t1"]);
  assert.deepEqual(unroutedChanges("flags", { A: "x" }, { A: "y" }), ["flags"]);
  assert.deepEqual(unroutedChanges("flags", {}, undefined), []);
});

// A save is in the shape the page's writers save in (each normalizes what it saves), and the view is the host's
// projection, which leaves the engine's own fields out. Compared as they came, the defaults the normalizer fills in
// for those were flagged on the host's screen in the two-browser run: AI Suggestions asked there saved a world with
// idlePulseTick 0 and empty institutions and politicalSimulation ledgers. The page compares like with like.
test("a page's save of a view it did not change is no change, once the view is in the shape the page saves it in", async () => {
  const { normalizeWorldState } = await import("../../runtime/gameState.js");
  const { HOST_ONLY_WORLD_KEYS } = await import("../host/projection.js");
  // The view as the host sends it: its stored (normalized) world, without the engine's own fields.
  const stored = normalizeWorldState({ countryStats: [{ name: "France", gdp: 1 }], projects: [{ id: "p1", name: "Rail programme", status: "active" }] });
  const view = Object.fromEntries(Object.entries(stored).filter(([key]) => !HOST_ONLY_WORLD_KEYS.includes(key)));
  const saved = { ...normalizeWorldState(view), actionSuggestions: [{ id: "s1", title: "Talks" }] };
  const raw = unroutedChanges("world", view, saved);
  // (The run's third field, institutions, is reshaped per viewer by the projection, which this view skips.)
  for (const field of ["idlePulseTick", "politicalSimulation"]) assert.ok(raw.includes(field), `what the run flagged: ${field}`);
  assert.deepEqual(unroutedChanges("world", normalizeWorldState(view), saved), []);
  assert.deepEqual(planWorldWrite(normalizeWorldState(view), saved).device, { actionSuggestions: saved.actionSuggestions }, "only what is the device's own");
  // A field really changed is still named.
  assert.deepEqual(unroutedChanges("world", normalizeWorldState(view), { ...saved, idlePulseTick: 37 }), ["idlePulseTick"]);
  // A save that is not normalized (the run's own Projects board PUT: the view and a board) is put in the same shape:
  // once only the held side was, its missing defaults were flagged on the guest's screen instead.
  const board = [{ id: "p1", name: "Rail programme", status: "active" }, { id: "p2", name: "Port works", status: "active" }];
  const rawSave = { ...view, projects: board };
  assert.ok(unroutedChanges("world", normalizeWorldState(view), rawSave).includes("idlePulseTick"), "one side shaped, the other not");
  assert.deepEqual(unroutedChanges("world", normalizeWorldState(view), normalizeWorldState({ ...view, actionSuggestions: [{ id: "s1" }] })), []);
  assert.deepEqual(unroutedChanges("world", normalizeWorldState(view), normalizeWorldState(rawSave)), ["projects"], "a board changed in a save is said");
  const page = (await import("node:fs")).readFileSync(new URL("./sharedGame.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(page, /const before = asThePageSavesIt\(key, held\);\s*const after = asThePageSavesIt\(key, wanted\);[\s\S]*?unroutedChanges\(key, before, after\)[\s\S]*?planWorldWrite\(before, after\)/);
});
