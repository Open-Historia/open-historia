/*! Open Historia — refused-demand charging tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/chatRefusalPersistence.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { chargeRefusals, normalizeChats, normalizeWorldState } from "./gameState.js";

// THE ONE DETERMINISTIC LOYALTY RULE: a demand the Puppet REFUSES costs a fixed
// amount, once. A demand is a record in the thread's log (chatThreads.js), so a
// refusal is read off the saved thread a turn later, and whether it has been
// charged is kept in world.chargedRefusals — never on the thread, because chat
// writers save whatever copy they hold and erased a flag kept there.
//
// It has died three ways before: a normalizer dropping the field, the thread log
// dropping it, and a stale panel saving over a stamp. These pin the demand
// design against all three.

const thread = (id, events) => ({
  id,
  countries: [{ name: "Belarus", code: "" }],
  events: [
    { id: `${id}-created`, kind: "chat_created", time: "2016-01-01", title: "Minsk and Moscow" },
    { id: `${id}-join`, kind: "member_joined", time: "2016-01-01", member: { name: "Belarus" } },
    ...events,
  ],
  messages: [],
});
const demand = (answer) => [
  { id: "d1-made", kind: "demand_made", time: "2016-01-02", by: "Russia", demandId: "d1", target: "Belarus", summary: "Two brigades west" },
  ...(answer ? [{ id: `d1-${answer}`, kind: "demand_answered", time: "2016-01-02", by: "Belarus", demandId: "d1", answer, ...(answer === "alternative" ? { text: "One brigade" } : {}) }] : []),
];

test("a demand and its answer survive being saved and loaded", () => {
  const [chat] = normalizeChats(normalizeChats([thread("t1", demand("refused"))]));
  assert.equal(chat.demands.length, 1);
  assert.equal(chat.demands[0].status, "refused");
  assert.equal(chat.demands[0].by, "Russia");
  assert.equal(chat.demands[0].target, "Belarus");
});

test("a refused demand is charged once, however many times the turn runs", () => {
  const chats = normalizeChats([thread("t1", demand("refused"))]);
  const first = chargeRefusals(chats, []);
  assert.deepEqual(first.refusedDemands, [{ overlord: "Russia", puppet: "Belarus" }]);

  // A retried jump, or a reloaded save jumped again: same chats, same record.
  const second = chargeRefusals(chats, first.charged);
  assert.deepEqual(second.refusedDemands, [], "already charged");
});

test("a stale chat panel saving over the thread cannot un-charge a refusal", () => {
  // The record is in the world, which chat writers never touch.
  const charged = chargeRefusals(normalizeChats([thread("t1", demand("refused"))]), []).charged;
  const panelSavesItsOldCopy = normalizeChats([thread("t1", demand("refused"))]);
  assert.deepEqual(chargeRefusals(panelSavesItsOldCopy, charged).refusedDemands, []);
});

test("nothing but a refusal is charged", () => {
  for (const answer of [null, "accepted", "alternative"]) {
    assert.deepEqual(chargeRefusals(normalizeChats([thread("t1", demand(answer))]), []).refusedDemands, [], String(answer));
  }
});

test("two threads that happen to use the same demand id are charged separately", () => {
  // Demand ids are only unique within a thread; the charge record must not let
  // one thread's refusal hide another's.
  const chats = normalizeChats([thread("t1", demand("refused")), thread("t2", demand("refused"))]);
  assert.equal(chargeRefusals(chats, []).refusedDemands.length, 2);
});

test("charging does not touch the chats it was given", () => {
  const chats = normalizeChats([thread("t1", demand("refused"))]);
  const before = JSON.stringify(chats);
  chargeRefusals(chats, []);
  assert.equal(JSON.stringify(chats), before);
});

test("the charge record survives the world's round trip, and is capped", () => {
  const world = normalizeWorldState({ chargedRefusals: ["t1:d1", "t1:d2", "t1:d1", "", null] });
  assert.deepEqual(world.chargedRefusals, ["t1:d1", "t1:d2"]);

  const many = Array.from({ length: 600 }, (_, index) => `t1:d${index}`);
  const capped = normalizeWorldState({ chargedRefusals: many }).chargedRefusals;
  assert.equal(capped.length, 512);
  assert.equal(capped.at(-1), "t1:d599", "the most recent are the ones kept");
});
