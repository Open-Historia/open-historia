/*! Open Historia — what is a guest's waits while nobody shares the game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/heldSeats.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { hasSeatsHeld, holdSeatRecords, returnSeatRecords, seatsHeldOf } from "./heldSeats.js";
import { seatsLeftBehindPatch } from "../../runtime/seatsLeftBehind.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

const LATVIA = "Republic of Latvia"; // the host
const RUSSIA = "Russian Federation"; // a guest
const ESTONIA = "Republic of Estonia"; // the AI's
const POLAND = "Republic of Poland"; // a guest who only sits in a thread

const docs = () => ({
  actions: [
    { id: "o-lv", status: "planned", text: "Talks" },
    { id: "o-lv-named", status: "planned", text: "Fortify", ownerCode: LATVIA },
    { id: "o-ru", status: "planned", text: "Invade Latvia", ownerCode: RUSSIA },
    { id: "o-ru-done", status: "resolved", text: "Mobilise", ownerCode: RUSSIA },
  ],
  chats: [
    { id: "c-lv-est", countries: [{ code: ESTONIA, name: ESTONIA }], messages: [{ id: "m1", role: "user", text: "Riga to Tallinn" }] },
    { id: "c-ru-est", player: RUSSIA, countries: [{ code: ESTONIA, name: ESTONIA }], messages: [{ id: "m2", role: "user", speaker: RUSSIA, text: "Moscow to Tallinn" }] },
    // The host's thread with a person: the person's line is the person's.
    { id: "c-lv-ru", countries: [{ code: RUSSIA, name: RUSSIA }], messages: [{ id: "m3", role: "user", speaker: LATVIA, text: "Riga" }, { id: "m4", role: "user", speaker: RUSSIA, text: "Moscow" }] },
    // The host's thread a person only sits in.
    { id: "c-lv-pl", countries: [{ code: POLAND, name: POLAND }], messages: [{ id: "m5", role: "user", speaker: LATVIA, text: "Riga to Warsaw" }] },
  ],
  events: [
    { id: "e1", date: "2014-04-01", title: "Public" },
    { id: "e2", date: "2014-04-02", title: "Moscow's secret", audience: [RUSSIA] },
    { id: "e3", date: "2014-04-02", title: "Moscow's second secret", audience: [RUSSIA, POLAND] },
    { id: "e4", date: "2014-04-03", title: "Riga knows too", audience: [RUSSIA, LATVIA] },
    { id: "e5", date: "2014-04-04", title: "Public again" },
  ],
  world: {
    wars: [],
    simulationHistory: [
      { round: 3, date: "2014-03-30", eventIds: [], plannedActions: [{ id: "p-lv", status: "resolved", text: "Riga" }, { id: "p-ru", status: "resolved", text: "Moscow", ownerCode: RUSSIA }] },
      { round: 2, date: "2014-02-28", eventIds: [], plannedActions: [{ id: "p-lv-2", status: "resolved", text: "Riga" }] },
    ],
  },
});

test("the host's own game keeps the host's: another person's orders, threads and secret events are held", () => {
  const before = docs();
  const held = holdSeatRecords(before, { host: LATVIA, people: [LATVIA, RUSSIA, POLAND] });
  assert.equal(held.changed, true);
  assert.deepEqual(held.actions.map((row) => row.id), ["o-lv", "o-lv-named"]);
  assert.deepEqual(held.chats.map((row) => row.id), ["c-lv-est"]);
  assert.deepEqual(held.events.map((row) => row.id), ["e1", "e4", "e5"]);
  const kept = seatsHeldOf(held.world);
  assert.deepEqual(kept.orders.map((row) => row.id), ["o-ru", "o-ru-done"]);
  assert.deepEqual(kept.threads.map((row) => row.id), ["c-ru-est", "c-lv-ru", "c-lv-pl"]);
  assert.deepEqual(kept.events.map((row) => [row.after, row.event.id]), [["e1", "e2"], ["e1", "e3"]]);
  assert.equal(hasSeatsHeld(held.world), true);
  assert.deepEqual(held.world.simulationHistory.map((turn) => turn.plannedActions.map((row) => row.id)), [["p-lv"], ["p-lv-2"]], "a past turn lists only the host's orders");
  assert.deepEqual(kept.turns.map((turn) => [turn.round, turn.orders.map((row) => row.id)]), [[3, ["p-ru"]]]);
  assert.deepEqual(held.world.wars, [], "the rest of the world as it was");
  // The save keeps the record as it is.
  assert.deepEqual(normalizeWorldState(held.world).seatsHeld, held.world.seatsHeld);
});

test("given back, everything is where it was, and the record is gone", () => {
  const before = docs();
  const held = holdSeatRecords(before, { host: LATVIA, people: [RUSSIA, POLAND] });
  const back = returnSeatRecords(held);
  assert.equal(back.changed, true);
  assert.equal(back.returned, 8);
  assert.deepEqual(back.world.simulationHistory, before.world.simulationHistory, "each past turn lists every order again");
  assert.deepEqual(back.events, before.events, "each event in its place, in its order");
  assert.deepEqual(back.actions.map((row) => row.id).sort(), before.actions.map((row) => row.id).sort());
  assert.deepEqual(back.chats.map((row) => row.id).sort(), before.chats.map((row) => row.id).sort());
  assert.equal("seatsHeld" in back.world, false);
  assert.equal(normalizeWorldState(back.world).seatsHeld, undefined, "a world without the record never gains one");
});

test("holding and giving back are idempotent: an engine killed between the two leaves nothing twice and nothing lost", () => {
  const before = docs();
  const held = holdSeatRecords(before, { host: LATVIA, people: [RUSSIA, POLAND] });
  // Held again (the commit ran, then ran again): nothing new.
  const again = holdSeatRecords(held, { host: LATVIA, people: [RUSSIA, POLAND] });
  assert.equal(again.changed, false);
  // Rows already back beside the record: given back once.
  const half = { ...held, actions: before.actions, chats: before.chats, events: before.events, world: { ...held.world, simulationHistory: before.world.simulationHistory } };
  const back = returnSeatRecords(half);
  assert.equal(back.actions.length, before.actions.length);
  assert.equal(back.chats.length, before.chats.length);
  assert.deepEqual(back.events, before.events);
  assert.deepEqual(back.world.simulationHistory, before.world.simulationHistory);
  assert.equal(back.returned, 0);
});

test("an event goes back after the one it followed, or by its date when that one is gone", () => {
  const before = docs();
  const held = holdSeatRecords(before, { host: LATVIA, people: [RUSSIA] });
  const folded = { ...held, events: held.events.filter((row) => row.id !== "e1") };
  assert.deepEqual(returnSeatRecords(folded).events.map((row) => row.id), ["e2", "e3", "e4", "e5"]);
});

test("a save that was never shared names nobody, and nothing is held from it", () => {
  const single = {
    actions: [{ id: "o1", status: "planned", text: "Talks" }],
    chats: [{ id: "c1", countries: [{ code: ESTONIA, name: ESTONIA }], messages: [{ id: "m1", role: "user", text: "Riga" }] }],
    events: [{ id: "e1", date: "2014-04-01", title: "Public" }],
    world: {},
  };
  const held = holdSeatRecords(single, { host: LATVIA, people: [] });
  assert.equal(held.changed, false);
  assert.equal(held.actions, single.actions);
  assert.equal(held.world, single.world);
  assert.equal(returnSeatRecords(single).changed, false);
});

test("a game left while it was shared is held when it is opened alone, and its people forgotten; one never shared is not touched", () => {
  const left = { ...docs(), game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA, POLAND] } };
  const patch = seatsLeftBehindPatch(left);
  assert.equal(patch.game.humanCountries, undefined);
  assert.deepEqual(patch.actions.map((row) => row.id), ["o-lv", "o-lv-named"]);
  assert.deepEqual(seatsHeldOf(patch.world).threads.map((row) => row.id), ["c-ru-est", "c-lv-ru", "c-lv-pl"]);
  assert.equal(seatsLeftBehindPatch({ ...docs(), game: { country: LATVIA } }), null);
});

// FOLLOWUPS A9: in single player, rolling back to a restore point taken while the game was shared put the guests'
// records back into the host's game, and dropped what was held for them.
test("a restore point put back alone keeps what is held, and one that names the people is held as Stop holds it", async () => {
  const { restoredAlone } = await import("../../runtime/seatsLeftBehind.js");
  // What Stop held for the guests, in the game as it stands.
  const stopped = holdSeatRecords(docs(), { host: LATVIA, people: [RUSSIA, POLAND] });
  const live = stopped.world;
  // A restore point captured while the game was shared: every guest's record in the documents, its people named.
  const shared = { ...docs(), game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA] }, world: { ...docs().world, wars: [{ id: "old-war" }] } };
  const back = restoredAlone(shared, { live });
  assert.equal(back.game.humanCountries, undefined, "its people are forgotten");
  assert.deepEqual(back.actions.map((row) => row.id), ["o-lv", "o-lv-named"], "the host's own orders alone");
  assert.deepEqual(back.chats.map((row) => row.id), ["c-lv-est"]);
  assert.deepEqual(back.events.map((row) => row.id), ["e1", "e4", "e5"]);
  assert.deepEqual(back.world.wars, [{ id: "old-war" }], "the rest is the restore point's");
  const held = seatsHeldOf(back.world);
  assert.deepEqual(held.orders.map((row) => row.id), ["o-ru", "o-ru-done"], "each held once");
  assert.deepEqual(held.threads.map((row) => row.id), ["c-ru-est", "c-lv-ru", "c-lv-pl"]);
  assert.deepEqual(held.turns.map((turn) => [turn.round, turn.orders.map((row) => row.id)]), [[3, ["p-ru"]]]);
  // A restore point of a solo turn, from before anything was held: what is held now stays held.
  const solo = { actions: [{ id: "o-lv", status: "planned", text: "Talks" }], chats: [], events: [], game: { country: LATVIA }, world: { wars: [] } };
  const kept = restoredAlone(solo, { live });
  assert.deepEqual(seatsHeldOf(kept.world), seatsHeldOf(live));
  assert.deepEqual(kept.actions, solo.actions);
  // A game never shared: the restore point as it is.
  assert.deepEqual(restoredAlone(solo, { live: { wars: [] } }), solo);
});
