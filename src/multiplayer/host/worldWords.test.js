/*! Open Historia — what the host writes into a shared world, in the world's language: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/worldWords.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { ENGLISH_WORDS, worldWordsOf } from "./worldWords.js";

const PACK = {
  "Peace between {{first}} and {{second}}": "Frieden zwischen {{first}} und {{second}}",
  "nobody pays reparations": "niemand zahlt Reparationen",
};

test("a pattern is written from the world's pack, its slots filled with the names as given", () => {
  const words = worldWordsOf(PACK, "de");
  assert.equal(words.say("Peace between {{first}} and {{second}}", { first: "Russian Federation", second: "Republic of Latvia" }), "Frieden zwischen Russian Federation und Republic of Latvia");
  assert.equal(words.word("nobody pays reparations"), "niemand zahlt Reparationen");
  // What the pack lacks is the English, never braces or nothing.
  assert.equal(words.say("{{war}} is over.", { war: "The Baltic War" }), "The Baltic War is over.");
  assert.equal(words.word("the other side"), "the other side");
  // Names in a list are joined as the language joins them.
  assert.equal(words.list(["A", "B", "C"]), "A, B und C");
  assert.equal(worldWordsOf(PACK, "ja").list(["A", "B"]), new Intl.ListFormat("ja", { type: "conjunction" }).format(["A", "B"]));
});

test("English, no language, or no pack is the English as the game writes it", () => {
  for (const words of [worldWordsOf(PACK, "en"), worldWordsOf(PACK, ""), worldWordsOf(null, "de"), worldWordsOf([], "de"), ENGLISH_WORDS]) {
    assert.equal(words.say("Peace between {{first}} and {{second}}", { first: "A", second: "B" }), "Peace between A and B");
    assert.equal(words.list(["A", "B", "C"]), "A, B and C");
    assert.equal(words.list(["A"]), "A");
    assert.equal(words.word("nobody pays reparations"), "nobody pays reparations");
  }
});
