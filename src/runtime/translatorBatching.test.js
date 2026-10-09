/*! Open Historia — interface translation batching tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translatorBatching.test.js
//
// How many strings ride in one translation request decides how much of a free
// key's daily allowance a non-English player spends just opening the game
// (AI/requestBudget.js). It used to be 60 strings × 3 concurrent requests; a
// first pass over a new language was dozens of requests nobody pressed a button
// for. These pin the sizing, and the one rule that keeps a big batch safe: a
// reply that must not be truncated is bounded by CHARACTERS as well as count.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BATCH_MAX_CHARS,
  BATCH_MAX_STRINGS,
  BATCH_MIN_STRINGS,
  planTranslationBatch,
} from "./translationRules.js";

const strings = (count, each = "Save game") => Array.from({ length: count }, (_unused, index) => `${each} ${index}`);

test("a batch is as many strings as fit under both ceilings", () => {
  assert.equal(planTranslationBatch(strings(1000)).length, BATCH_MAX_STRINGS);
  assert.equal(planTranslationBatch(strings(12)).length, 12, "fewer than a batch is the whole queue");
  assert.deepEqual(planTranslationBatch([]), []);
});

test("long strings cut the batch short, so the answer cannot be truncated", () => {
  const prose = strings(BATCH_MAX_STRINGS, "x".repeat(400));
  const batch = planTranslationBatch(prose);
  assert.ok(batch.length < BATCH_MAX_STRINGS, `${batch.length} of ${BATCH_MAX_STRINGS} — the character ceiling bit`);
  const chars = batch.reduce((total, text) => total + text.length, 0);
  assert.ok(chars <= BATCH_MAX_CHARS + 400, `${chars} characters is within one string of the ceiling`);
});

test("one string longer than the whole ceiling still goes, alone", () => {
  const huge = "y".repeat(BATCH_MAX_CHARS * 2);
  assert.deepEqual(planTranslationBatch([huge, "Save game"]), [huge], "never an empty batch, never a stuck queue");
});

test("the queue is taken in order, and a Set is accepted as it comes", () => {
  const queue = new Set(["Save game", "Load game", "Quit"]);
  assert.deepEqual(planTranslationBatch(queue, { maxStrings: 2 }), ["Save game", "Load game"]);
});

test("the sizes are the ones the request budget was tuned for", () => {
  // 240 strings a request against the old 60 is a quarter of the requests for
  // the same language; the floor is what a model that cannot hold a big batch
  // falls back to rather than giving up.
  assert.equal(BATCH_MAX_STRINGS, 240);
  assert.equal(BATCH_MAX_CHARS, 6000);
  assert.equal(BATCH_MIN_STRINGS, 30);
  assert.ok(BATCH_MIN_STRINGS < BATCH_MAX_STRINGS);
});
