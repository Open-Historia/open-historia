/*! Open Historia — who a letter is for in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/sharedLetters.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { sharedLetterOf } from "./sharedLetters.js";
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
  // Naming nobody, it is the host's, as before.
  assert.equal(sharedLetterOf({ countries: [copperleaf], speaker: copperleaf }, { people, host }).to, host);
});

test("a person named among the other side is the one it was written to (the Copperleaf Company's loan offer, 2026-10-27)", () => {
  const letter = sharedLetterOf({ countries: ["Saltport"], speaker: copperleaf, title: "Copperleaf wartime loan terms", openingMessage: "The Board of Directors sends greetings to the Council of Saltport." }, { people, host });
  assert.deepEqual(letter.chat.countries, [copperleaf]);
  assert.equal(letter.owner, "Saltport");
  assert.equal(sharedLetterOf({ countries: ["Saltport"], speaker: "Saltport" }, { people, host }), null, "no government left to write it");
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
