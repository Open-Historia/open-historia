/*! Open Historia — who a letter is for in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/sharedLetters.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { sharedDocumentNoteOf, sharedLetterDropped, sharedLetterOf, sharedNoteOf } from "./sharedLetters.js";
import { foldGeneratedChatsIntoStorage } from "./chatFold.js";

const people = ["Hill Kingdom", "Saltport"];
const host = "Hill Kingdom";
const copperleaf = "The Copperleaf Trading Company";

test("single player: every letter is the player's, as it always was", () => {
  const chat = { countries: [copperleaf], speaker: copperleaf, title: "A loan", openingMessage: "Greetings." };
  assert.deepEqual(sharedLetterOf(chat, { people: ["Hill Kingdom"], host }), { chat, to: host, owner: "" });
});

test("a letter goes to the player it names, and only the governments writing are its other side", () => {
  const letter = sharedLetterOf({ countries: [copperleaf], speaker: copperleaf, to: "Saltport", title: "A loan" }, { people, host });
  assert.deepEqual(letter.chat.countries, [copperleaf]);
  assert.equal(letter.to, "Saltport");
  assert.equal(letter.owner, "Saltport");
  // The host's own letters name no owner.
  assert.equal(sharedLetterOf({ countries: [copperleaf], speaker: copperleaf, to: host }, { people, host }).owner, "");
  // Naming nobody, it is nobody's: it went to the host, who read a letter meant for anyone (the gap audit of 2026-11-18).
  assert.equal(sharedLetterOf({ countries: [copperleaf], speaker: copperleaf }, { people, host }), null);
  assert.equal(sharedLetterDropped({ countries: [copperleaf], speaker: copperleaf }, { people }), "unaddressed");
  assert.equal(sharedLetterDropped({ countries: [copperleaf], speaker: copperleaf, to: "Saltport" }, { people }), "");
  assert.equal(sharedLetterDropped({ countries: [copperleaf], speaker: copperleaf }, { people: [host] }), "", "single player drops nothing");
});

test("a person named among the other side is the one it was written to (the Copperleaf Company's loan offer, 2026-10-27)", () => {
  const letter = sharedLetterOf({ countries: ["Saltport"], speaker: copperleaf, title: "Copperleaf wartime loan terms", openingMessage: "The Board of Directors sends greetings to the Council of Saltport." }, { people, host });
  assert.deepEqual(letter.chat.countries, [copperleaf]);
  assert.equal(letter.owner, "Saltport");
  assert.equal(sharedLetterOf({ countries: ["Saltport"], speaker: "Saltport" }, { people, host }), null, "no government left to write it");
  // A letter a person is named as sending is never put in a government's mouth (chatSpeaker.js, 2026-11-04).
  assert.equal(sharedLetterOf({ countries: [copperleaf, "Saltport"], speaker: "Saltport", openingMessage: "Our terms." }, { people, host }), null, "a person's own words are theirs to write");
});

test("the same governments writing to two players are two conversations", () => {
  const toHost = { id: "a", countries: [{ code: copperleaf, name: copperleaf }], messages: [{ role: "leader", speaker: copperleaf, text: "To the hill court." }], status: "open" };
  const toGuest = { id: "b", player: "Saltport", countries: [{ code: copperleaf, name: copperleaf }], messages: [{ role: "leader", speaker: copperleaf, text: "To the Council." }], status: "open" };
  const stored = [toHost];
  const folded = foldGeneratedChatsIntoStorage(stored, [toGuest]);
  assert.equal(folded.length, 2, "Saltport's letter is not filed in the host's thread");
  const again = foldGeneratedChatsIntoStorage(folded, [{ ...toGuest, id: "c", messages: [{ role: "leader", speaker: copperleaf, text: "A second word." }] }]);
  assert.equal(again.length, 2);
  assert.equal(again.find((chat) => chat.player === "Saltport").messages.length, 2, "and the next one joins Saltport's own");
});

test("a note between two people is a line of their thread that nobody speaks, in the thread of the one it is for", () => {
  const note = sharedNoteOf({ from: "Saltport", to: host, title: "A call for help", source: "call-to-arms", message: { id: "msg-call-1", text: "Saltport has been attacked." } }, { people, host });
  assert.deepEqual(note.chat.countries, ["Saltport"]);
  assert.deepEqual(note.chat.messages, [{ id: "msg-call-1", role: "system", speaker: "", code: "", text: "Saltport has been attacked." }]);
  assert.deepEqual([note.to, note.owner], [host, ""], "the host's own threads name nobody");
  assert.equal(sharedNoteOf({ from: host, to: "Saltport", message: { text: "x" } }, { people, host }).owner, "Saltport");
  // Only between two people, and never a government's words.
  assert.equal(sharedNoteOf({ from: copperleaf, to: "Saltport", message: { text: "x" } }, { people, host }), null);
  assert.equal(sharedNoteOf({ from: "Saltport", to: "saltport", message: { text: "x" } }, { people, host }), null);
  assert.equal(sharedNoteOf({ from: "Saltport", to: host, message: { text: " " } }, { people, host }), null);
});

test("a document reaches each player in the thread with the governments that hold it, and another player's as a note between the two", () => {
  const report = { id: "r1", title: "The Saltport Accord", body: "Terms.", visibleTo: ["Saltport", host, copperleaf], from: copperleaf };
  // Single player: as it always was, the thread with every other holder, spoken by its sender.
  const single = sharedDocumentNoteOf({ channel: "diplomacy", report, with: [copperleaf], sender: copperleaf, owner: host }, { people: [host], host });
  assert.deepEqual([single.to, single.owner, single.chat.speaker, single.chat.countries], [host, "", copperleaf, [copperleaf]]);
  // A guest's copy, from a government the AI plays: the guest's own thread with it; the other person is left out.
  const guest = sharedDocumentNoteOf({ channel: "diplomacy", report, with: [host, copperleaf], sender: copperleaf, owner: "Saltport" }, { people, host, eventId: "e1" });
  assert.deepEqual([guest.to, guest.owner, guest.chat.countries], ["Saltport", "Saltport", [copperleaf]]);
  assert.deepEqual([guest.chat.messages[0].speaker, guest.chat.messages[0].reportId, guest.chat.messages[0].eventId], [copperleaf, "r1", "e1"]);
  // Sent by another person: a line between the two, in nobody's name.
  const between = sharedDocumentNoteOf({ channel: "diplomacy", report: { ...report, from: host }, with: [host, copperleaf], sender: host, owner: "Saltport" }, { people, host });
  assert.deepEqual([between.owner, between.chat.countries, between.chat.messages[0].role, between.chat.messages[0].speaker], ["Saltport", [host], "system", ""]);
  assert.match(between.chat.messages[0].text, /The Saltport Accord/);
  assert.equal(between.chat.messages[0].reportId, "r1");
});
