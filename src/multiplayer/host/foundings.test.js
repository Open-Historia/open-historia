/*! Open Historia — a player's people founding a country: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/foundings.test.js
//
// The events are the two a Discord test game's time skips wrote (2026-10-26),
// where two players' groups each founded a country and both seats stayed on
// the group: the new countries' armies and wars were played by the AI.

import test from "node:test";
import assert from "node:assert/strict";
import { formerNamesOf, seatFoundings, withSeatMoved } from "./foundings.js";

const BURGHERS = "The Free Townsmen of Gullhaven";
const HILL = "Hill folk";

const saltport = {
  id: "event-ai-r0001-03540105-005",
  title: "The Free Townsmen of Gullhaven found the country of Saltport",
  impacts: {
    actionIds: ["order-mvpnke40-6"],
    polityChanges: [{ operation: "create", code: "Saltport", name: "Saltport", note: "Founded by the Free Townsmen of Gullhaven." }],
    regionTransfers: [
      { basis: "independence", fromCode: BURGHERS, regionId: "reg_mvoy42nk1k2i", toCode: "Saltport" },
      { basis: "independence", fromCode: BURGHERS, regionId: "reg_mvp0k6s938", toCode: "Saltport" },
    ],
    groupOps: [{ op: "release", name: BURGHERS, regionIds: ["reg_mvoy42nk1k2i", "reg_mvp0k6s938"] }],
  },
};
const hillKingdom = {
  id: "event-ai-r0004-03540115-001",
  title: "The hill folk's realm is founded as the country of Hill Kingdom",
  impacts: {
    actionIds: ["order-mvpo8u5k-f"],
    polityChanges: [{ operation: "create", code: "Hill Kingdom", name: "Hill Kingdom" }],
    regionTransfers: [{ basis: "independence", fromCode: HILL, regionId: "reg_mvp0kbey39", toCode: "Hill Kingdom" }],
  },
};
const actions = [
  { id: "order-mvpnke40-6", ownerCode: BURGHERS, status: "resolved", text: "Found a new country... Saltport" },
  // The host's order names no owner.
  { id: "order-mvpo8u5k-f", status: "resolved", text: "Hill Kingdom is founded as a new country" },
];

test("a seat follows its people to the country their own order founded with their land", () => {
  assert.deepEqual(seatFoundings({ events: [saltport, hillKingdom], actions, seated: [HILL, BURGHERS], host: HILL }), [
    { from: BURGHERS, to: "Saltport", eventId: saltport.id },
    { from: HILL, to: "Hill Kingdom", eventId: hillKingdom.id },
  ]);
});

test("no seat moves for a country founded on someone else's land, by someone else's order, or already played", () => {
  const puppet = { ...saltport, impacts: { ...saltport.impacts, regionTransfers: [{ fromCode: "Kestrelmark", toCode: "Saltport", regionId: "r" }] } };
  assert.deepEqual(seatFoundings({ events: [puppet], actions, seated: [BURGHERS], host: HILL }), []);
  assert.deepEqual(seatFoundings({ events: [saltport], actions: [{ ...actions[0], ownerCode: "Kestrelmark" }], seated: [BURGHERS], host: HILL }), []);
  assert.deepEqual(seatFoundings({ events: [saltport], actions, seated: [BURGHERS, "Saltport"], host: HILL }), []);
  const update = { ...saltport, impacts: { ...saltport.impacts, polityChanges: [{ operation: "update", code: "Saltport" }] } };
  assert.deepEqual(seatFoundings({ events: [update], actions, seated: [BURGHERS], host: HILL }), []);
});

test("what was the old seat's goes with it: queued orders, its board, its agents and its threads; what was done stays", () => {
  const moved = withSeatMoved({
    actions: [{ id: "a", ownerCode: HILL, status: "planned" }, { id: "b", ownerCode: HILL, status: "resolved" }, { id: "c", ownerCode: BURGHERS }, { id: "d", status: "resolved" }],
    world: { seatBoards: { [HILL]: [{ id: "p" }] }, spies: [{ id: "s", owner: HILL, target: BURGHERS }] },
    chats: [{ id: "t", player: HILL }, { id: "u", player: BURGHERS }],
  }, { from: HILL, to: "Hill Kingdom", host: true });
  assert.deepEqual(moved.actions.map((action) => action.ownerCode), ["Hill Kingdom", HILL, BURGHERS, HILL]);
  assert.equal(moved.world.spies[0].owner, "Hill Kingdom");
  assert.deepEqual(Object.keys(moved.world.seatBoards), ["Hill Kingdom"]);
  assert.deepEqual(moved.chats.map((chat) => chat.player), ["Hill Kingdom", BURGHERS]);
});

test("a faction founds a state on its area, whose land is still its countries'; a country with no area does not", () => {
  const faction = "The Narva Committee";
  const event = {
    id: "ev-narva",
    impacts: {
      actionIds: ["order-narva"],
      polityChanges: [{ operation: "create", code: "Narva Republic" }],
      regionTransfers: [{ regionId: "reg-narva", fromCode: "Estonia", toCode: "Narva Republic" }],
    },
  };
  const areas = { "reg-narva": faction };
  assert.deepEqual(seatFoundings({ events: [event], actions: [{ id: "order-narva", ownerCode: faction }], seated: [faction], areas }), [
    { from: faction, to: "Narva Republic", eventId: "ev-narva" },
  ]);
  assert.deepEqual(seatFoundings({ events: [event], actions: [{ id: "order-narva", ownerCode: "Russia" }], seated: ["Russia"], areas }), []);
});

test("a state brought back counts as founded", () => {
  const event = { ...hillKingdom, impacts: { ...hillKingdom.impacts, polityChanges: [{ operation: "restore", code: "Hill Kingdom" }] } };
  assert.equal(seatFoundings({ events: [event], actions, seated: [HILL], host: HILL })[0]?.to, "Hill Kingdom");
});

test("a seat reads under every name its government had", () => {
  const game = { seatFoundings: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "X", to: "Y" }] };
  assert.deepEqual(formerNamesOf(game, "C"), ["C", "B", "A"]);
  assert.deepEqual(formerNamesOf(game, "Z"), ["Z"]);
  assert.deepEqual(formerNamesOf({ seatFoundings: [{ from: "A", to: "B" }, { from: "B", to: "A" }] }, "A"), ["A", "B"]);
});
