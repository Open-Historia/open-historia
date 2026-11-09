/*! Open Historia — counting a hub scenario's imports: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubImportCount.test.js
//
// The counts the Community tab shows come from the import counter, never from
// the downloads GitHub counts (hubImportCount.js; the Worker's own tests are
// server/importCounterWorker.test.js; the reports, src/runtime/hubReimport.test.js).
import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_COUNTER_URL,
  countHubImport,
  fetchImportCounts,
  importCountIn,
  importCounterUrl,
  resetImportCountsCache,
} from "./hubImportCount.js";

const COUNTS = `${IMPORT_COUNTER_URL}/counts`;

const mockFetch = (t, answer) => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", body: init.body ?? null });
    const value = typeof answer === "function" ? answer(String(input), init) : answer;
    if (value instanceof Error) throw value;
    return value.clone();
  };
  t.after(() => {
    globalThis.fetch = original;
    resetImportCountsCache();
  });
  resetImportCountsCache();
  return calls;
};

test("the counter's address is ours unless the build names another", () => {
  assert.equal(importCounterUrl({}), "https://oh-import-counter.nichojkrol.workers.dev");
  assert.equal(importCounterUrl({ VITE_OH_IMPORT_COUNTER_URL: "https://counter.example/" }), "https://counter.example");
});

test("the counts are read in the counter's shape, kept five minutes, and malformed ones left out", async (t) => {
  const calls = mockFetch(t, Response.json({ 12: { count: 346 }, 7: { count: 0 }, 9: 4, 10: { count: -1 }, x: { count: 3 }, 11: { count: 1.5 } }));
  const counts = await fetchImportCounts();
  assert.deepEqual(counts, { 7: 0, 9: 4, 12: 346 });
  assert.equal(await fetchImportCounts(), counts, "the same object while it is kept");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { url: COUNTS, method: "GET", body: null });
  await fetchImportCounts({ force: true });
  assert.equal(calls.length, 2, "Refresh asks again");
  assert.equal(importCountIn(counts, 12), 346);
  assert.equal(importCountIn(counts, "7"), 0, "a count of nothing yet is still a count");
  assert.equal(importCountIn(counts, 99), null);
  assert.equal(importCountIn(counts, "constructor"), null);
  assert.equal(importCountIn(null, 12), null);
});

test("a counter that cannot be read is no counts, and the last good read stays", async (t) => {
  let up = false;
  mockFetch(t, () => (up ? Response.json({ 12: { count: 5 } }) : new TypeError("Failed to fetch")));
  assert.equal(await fetchImportCounts(), null);
  up = true;
  const good = await fetchImportCounts();
  assert.deepEqual(good, { 12: 5 });
  up = false;
  assert.equal(await fetchImportCounts({ force: true }), good);
});

test("a report that fails is no error and holds nothing up", async (t) => {
  mockFetch(t, new TypeError("Failed to fetch"));
  assert.equal(await countHubImport(12), null);
  assert.equal(await countHubImport("not a post"), null);
});
