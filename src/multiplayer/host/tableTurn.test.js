/*! Open Historia — what a table's turn leaves of its thread: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/tableTurn.test.js
//
// A turn with nobody for the AI to answer for came back with an empty log, and
// the engine wrote it over the thread: the thread lost its members, and a
// thread with no members is dropped when it is saved. A player wrote in a
// thread whose owner had left the game, and the conversation was gone from
// every screen.

import test from "node:test";
import assert from "node:assert/strict";

import { threadAfterTurn, turnWritesThread } from "./tableTurn.js";
import { eventsFromLegacyChat, projectChatThread } from "../../runtime/chatThreads.js";
import { normalizeChats } from "../../runtime/gameState.js";

const RUSSIA = "Russian Federation";
const ESTONIA = "Republic of Estonia";

const thread = () => ({
  id: "thread-1",
  player: RUSSIA,
  countries: [{ code: ESTONIA, name: ESTONIA }],
  messages: [{ id: "m1", role: "user", speaker: RUSSIA, code: RUSSIA, text: "Moscow to Tallinn.", time: "2014-04-01" }],
});

test("a turn with no log to give writes nothing", () => {
  assert.equal(turnWritesThread(null), false);
  assert.equal(turnWritesThread(undefined), false);
  assert.equal(turnWritesThread({ events: [], applied: [], rejected: [], actions: [] }), false, "nobody at the table was the AI's to answer for");
  assert.equal(turnWritesThread({ events: "no" }), false);
  assert.equal(turnWritesThread({ committed: true, events: [{ id: "e1", kind: "message" }] }), false, "the institution's own functions wrote it already");
  assert.equal(turnWritesThread({ events: [{ id: "e1", kind: "message" }] }), true);
});

test("the empty log it used to write dropped the thread; left alone, the thread stands", () => {
  const stored = thread();
  // What the engine wrote before: the empty log, and who is in it read from that log.
  const erased = { ...stored, events: [], countries: projectChatThread([]).countries ?? stored.countries };
  assert.deepEqual(normalizeChats([erased]), [], "a thread with no members is not kept");
  assert.equal(normalizeChats([stored]).length, 1);
  assert.equal(normalizeChats([stored])[0].messages[0].text, "Moscow to Tallinn.");
});

test("a turn's log becomes the thread's, with who is in it and what was said read from it", () => {
  const stored = thread();
  const events = [
    ...eventsFromLegacyChat(stored),
    { id: "e-reply", kind: "message", time: "2014-04-01", by: ESTONIA, role: "leader", code: ESTONIA, text: "Tallinn hears Moscow." },
  ];
  const next = threadAfterTurn(stored, { events });
  assert.equal(next.id, "thread-1");
  assert.equal(next.player, RUSSIA, "whose thread it is does not change");
  assert.deepEqual(next.countries.map((country) => country.name), [ESTONIA]);
  assert.equal(next.events, events);
  const saved = normalizeChats([next])[0];
  assert.deepEqual(saved.messages.map((message) => [message.speaker, message.text]), [
    [RUSSIA, "Moscow to Tallinn."],
    [ESTONIA, "Tallinn hears Moscow."],
  ]);
});
