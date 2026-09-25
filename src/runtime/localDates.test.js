/*! Open Historia — localized game date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/localDates.test.js
//
// The game writes its dates in English wherever it shows one, and the same
// functions write the dates the AI reads, which must stay English. So the
// translator rewrites a shown date in the player's language instead. These pin
// which strings are dates, that the calendar stays the game's Gregorian one in
// every language, and that BC survives.

import test from "node:test";
import assert from "node:assert/strict";

import { createDateLocalizer } from "./localDates.js";
import { createPhraseBook } from "./phraseBook.js";

const de = createDateLocalizer("de");

test("each of the game's date shapes is written the player's way", () => {
  assert.equal(de("1 January 2016"), "1. Januar 2016");
  assert.equal(de("January 1st, 2016"), "1. Januar 2016");
  assert.equal(de("Jan 1, 2016"), "1. Jan. 2016");
  assert.equal(de("Jan 1st, 2016"), "1. Jan. 2016");
  assert.equal(de("1 Jan 2016"), "1. Jan. 2016");
  assert.equal(de("January 2016"), "Januar 2016");
  assert.equal(de("May 2016"), "Mai 2016");
  assert.equal(de("1/8/2016"), "8.1.2016", "the jump widget writes the month first");
  assert.equal(de("2016-01-08"), "8. Jan. 2016", "a stored game date");
  assert.equal(de("-0218-03-01"), "1. März 218 v. Chr.", "stored BC dates carry a minus");
});

test("BC is kept, in the language's own words", () => {
  assert.equal(de("1 March 218 BC"), "1. März 218 v. Chr.");
  assert.match(createDateLocalizer("ja")("1 March 218 BC"), /紀元前218年3月1日/);
});

test("every language counts in the Gregorian calendar with Latin digits", () => {
  // Persian defaults to the Solar Hijri calendar and Thai to the Buddhist era;
  // Arabic and Bengali to their own digits.
  for (const code of ["fa", "th", "ar", "bn", "hi", "ur"]) {
    const out = createDateLocalizer(code)("1 January 2016");
    assert.ok(out, code);
    assert.ok(out.includes("2016"), `${code}: ${out}`);
    assert.ok(!/1394|2559/.test(out), `${code}: ${out}`);
  }
});

test("only a whole date is a date", () => {
  for (const text of ["31 February 2016", "Round 5", "Maybe 2016", "1 January 2016 and more", "13/1/2016", "Jan 32, 2016", ""]) {
    assert.equal(de(text), null, JSON.stringify(text));
  }
});

test("English, or no language, leaves dates alone", () => {
  assert.equal(createDateLocalizer("en")("1 January 2016"), null);
  assert.equal(createDateLocalizer("")("1 January 2016"), null);
});

test("the phrase book writes dates alone and inside patterns", () => {
  const book = createPhraseBook({ localizeValue: de });
  book.setAll({ "Round {{round}} · {{date}}": "Runde {{round}} · {{date}}" });
  assert.equal(book.translate("Jan 8, 2016"), "8. Jan. 2016");
  assert.equal(book.translate("Round 3 · Jan 8, 2016"), "Runde 3 · 8. Jan. 2016");
  assert.equal(book.has("Jan 8, 2016"), false, "a date is not an entry: content checks do not count it");
  assert.equal(book.translate("Nothing known"), null);
});
