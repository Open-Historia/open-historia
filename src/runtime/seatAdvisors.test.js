/*! Open Historia — each player's advisor conversation, kept with the game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/seatAdvisors.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { SEAT_ADVISORS_ROLE, advisorOfSeat, withSeatAdvisor, withSeatAdvisorMoved } from "./seatAdvisors.js";
import { advisorContacts, advisorMessagesFor, replaceAdvisorThread } from "./advisorThreads.js";

const HOST = "Republic of Latvia";
const GUEST = "Russian Federation";
const hostFile = [
  { role: "user", text: "Riga asks." },
  { role: "advisor", id: "a1", text: "Riga is told." },
  { role: "advisor-contact", id: "advisor-minister-1", name: "Minister", recipientType: "minister" },
];
const opts = { gameCountry: HOST };

test("single player: the file is the player's conversation, and nothing is added to it", () => {
  assert.deepEqual(advisorOfSeat(hostFile, HOST, opts), hostFile);
  assert.deepEqual(withSeatAdvisor(hostFile, HOST, [...hostFile, { role: "notice", id: "n1" }], opts), [...hostFile, { role: "notice", id: "n1" }]);
  assert.deepEqual(advisorOfSeat(hostFile, ""), hostFile, "naming no seat is the game country's");
});

test("another seat's conversation is kept beside the game country's, in one entry no reader takes for anything", () => {
  const guestOwn = [{ role: "user", text: "Moscow asks." }];
  const file = withSeatAdvisor(hostFile, GUEST, guestOwn, opts);
  assert.equal(file.filter((entry) => entry.role === SEAT_ADVISORS_ROLE).length, 1);
  assert.deepEqual(advisorOfSeat(file, GUEST, opts), guestOwn);
  assert.deepEqual(advisorOfSeat(file, "russian federation", opts), guestOwn, "by name, case aside");
  assert.deepEqual(advisorOfSeat(file, HOST, opts), hostFile, "the host's is as it was");
  // The game's own readers see only the host's: messages, contacts, a thread saved over it.
  assert.deepEqual(advisorMessagesFor(file).map((entry) => entry.text), ["Riga asks.", "Riga is told."]);
  assert.equal(advisorContacts(file).length, 1);
  const saved = replaceAdvisorThread(file, "chief", [...advisorMessagesFor(file), { role: "user", text: "Riga again." }]);
  assert.deepEqual(advisorOfSeat(saved, GUEST, opts), guestOwn, "a single-player save keeps every seat's");
  // Replacing the host's keeps every seat's, and an empty seat is no entry.
  assert.deepEqual(advisorOfSeat(withSeatAdvisor(file, HOST, [], opts), GUEST, opts), guestOwn);
  assert.deepEqual(withSeatAdvisor(file, GUEST, [], opts), hostFile);
  assert.deepEqual(advisorOfSeat(hostFile, GUEST, opts), [], "a seat with none has none");
});

test("a seat that moves to a new name takes its conversation with it; the game country's follows the game", () => {
  const guestOwn = [{ role: "user", text: "Moscow asks." }];
  const file = withSeatAdvisor(hostFile, GUEST, guestOwn, opts);
  const moved = withSeatAdvisorMoved(file, GUEST, "Novorossiya", opts);
  assert.deepEqual(advisorOfSeat(moved, "Novorossiya", opts), guestOwn);
  assert.deepEqual(advisorOfSeat(moved, GUEST, opts), []);
  assert.equal(withSeatAdvisorMoved(file, HOST, "Livonia", opts), file);
  assert.equal(withSeatAdvisorMoved(hostFile, GUEST, "Novorossiya", opts), hostFile, "nothing to move");
});
