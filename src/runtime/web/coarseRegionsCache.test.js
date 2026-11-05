/*! Open Historia — web-mode coarse regions cache tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/coarseRegionsCache.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { createCoarseRegionsCache } from "./coarseRegionsCache.js";

const counting = () => {
  const built = [];
  const cache = createCoarseRegionsCache((source) => {
    built.push(source);
    return `coarse(${source})`;
  });
  return { cache, built };
};

test("the same scenario and value build once", () => {
  const { cache, built } = counting();
  assert.equal(cache.text("europe", "A"), "coarse(A)");
  assert.equal(cache.text("europe", "A"), "coarse(A)");
  assert.deepEqual(built, ["A"]);
});

test("a re-upload rebuilds", () => {
  const { cache, built } = counting();
  cache.text("europe", "A");
  assert.equal(cache.text("europe", "B"), "coarse(B)");
  assert.deepEqual(built, ["A", "B"]);
});

test("only the last scenario is kept", () => {
  const { cache, built } = counting();
  cache.text("europe", "A");
  cache.text("asia", "A");
  cache.text("europe", "A");
  assert.deepEqual(built, ["A", "A", "A"], "asia replaced europe's copy");
});

test("deleting a scenario, or Android asking for memory, lets the copy go", () => {
  const { cache, built } = counting();
  cache.text("europe", "A");
  cache.forget("asia");
  cache.text("europe", "A");
  assert.equal(built.length, 1, "forgetting another scenario keeps this one");
  cache.forget("europe");
  cache.text("europe", "A");
  assert.equal(built.length, 2);
  cache.clear();
  cache.text("europe", "A");
  assert.equal(built.length, 3);
});
