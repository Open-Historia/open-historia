/*! Open Historia — diplomatic chat visibility tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/chatVisibility.test.js
//
// Runs without node_modules: chatVisibility.js is import-free.
//
// This module decides what one government is allowed to know about another, so
// the two failure directions are NOT equal:
//   showing a chat a polity was not in  = the confidentiality breach (the bug)
//   hiding a chat a polity WAS in       = a leader forgets a conversation
// The first is silent and corrupts the whole diplomatic game; the second is
// visible and recoverable. Ambiguity must therefore resolve to HIDDEN.

import test from "node:test";
import assert from "node:assert/strict";

import { chatParticipantMatches, filterChatsVisibleTo, isChatVisibleTo } from "./chatVisibility.js";

// Shaped like storage/chat.json: `countries` lists the NON-PLAYER participants.
const algeriaChat = { id: "c1", title: "Algeria: Electricity Corridor Inquiry", countries: [{ code: "DZA", name: "Algeria" }] };
const nigeriaChat = { id: "c2", title: "Concerns Regarding the London Summit", countries: [{ code: "NGA", name: "Nigeria" }] };
const summitChat = {
  id: "c3",
  title: "Three-way summit",
  countries: [{ code: "NGA", name: "Nigeria" }, { code: "AGO", name: "Angola" }],
};

test("a polity sees its own chat and not another's", () => {
  assert.equal(isChatVisibleTo(algeriaChat, "Algeria"), true);
  // The bug, stated as a test: Nigeria must never see the Algeria correspondence
  // it was copying phrasing out of.
  assert.equal(isChatVisibleTo(algeriaChat, "Nigeria"), false);
  assert.equal(isChatVisibleTo(nigeriaChat, "Algeria"), false);
});

test("every member of a group chat still sees it", () => {
  assert.equal(isChatVisibleTo(summitChat, "Nigeria"), true);
  assert.equal(isChatVisibleTo(summitChat, "Angola"), true);
  // ...and nobody else does.
  assert.equal(isChatVisibleTo(summitChat, "Algeria"), false);
});

test("no polity means no restriction — the narrator and advisor paths", () => {
  // The jump narrator must resolve what actually happened everywhere, and the
  // advisor is the player's own staff (the player is in every chat), so passing
  // nothing is the documented, correct no-op rather than an oversight.
  for (const nothing of ["", null, undefined, "   "]) {
    assert.equal(isChatVisibleTo(algeriaChat, nothing), true);
    assert.deepEqual(filterChatsVisibleTo([algeriaChat, nigeriaChat], nothing), [algeriaChat, nigeriaChat]);
  }
});

test("matching tolerates case and spacing, and accepts a code", () => {
  assert.equal(chatParticipantMatches({ code: "DZA", name: "Algeria" }, "algeria"), true);
  assert.equal(chatParticipantMatches({ code: "DZA", name: "Algeria" }, "  ALGERIA  "), true);
  assert.equal(chatParticipantMatches({ code: "DZA", name: "Algeria" }, "DZA"), true);
  assert.equal(chatParticipantMatches("Algeria", "Algeria"), true);
  assert.equal(chatParticipantMatches({ code: "DZA", name: "Algeria" }, "Nigeria"), false);
});

// Fail closed. A blank participant entry must not become a wildcard that quietly
// re-opens every channel.
test("blank and malformed participants never match", () => {
  assert.equal(chatParticipantMatches({ code: "", name: "" }, "Algeria"), false);
  assert.equal(chatParticipantMatches(null, "Algeria"), false);
  assert.equal(chatParticipantMatches(undefined, "Algeria"), false);
  assert.equal(chatParticipantMatches(42, "Algeria"), false);
  assert.equal(chatParticipantMatches({ name: "Algeria" }, ""), false);
});

test("a chat with no recorded participants is hidden from a named polity", () => {
  // Failing closed: we cannot show it is theirs, so we do not show it.
  assert.equal(isChatVisibleTo({ id: "x", countries: [] }, "Algeria"), false);
  assert.equal(isChatVisibleTo({ id: "x" }, "Algeria"), false);
  assert.equal(isChatVisibleTo(null, "Algeria"), false);
  // ...but an omniscient reader still gets it.
  assert.equal(isChatVisibleTo({ id: "x", countries: [] }, ""), true);
});

test("filtering keeps only that polity's correspondence", () => {
  const all = [algeriaChat, nigeriaChat, summitChat];
  assert.deepEqual(filterChatsVisibleTo(all, "Algeria").map((c) => c.id), ["c1"]);
  assert.deepEqual(filterChatsVisibleTo(all, "Nigeria").map((c) => c.id), ["c2", "c3"]);
  assert.deepEqual(filterChatsVisibleTo(all, "Angola").map((c) => c.id), ["c3"]);
  // A polity with no correspondence at all gets an empty list, not everything.
  assert.deepEqual(filterChatsVisibleTo(all, "Peru"), []);
  assert.deepEqual(filterChatsVisibleTo(null, "Algeria"), []);
});
