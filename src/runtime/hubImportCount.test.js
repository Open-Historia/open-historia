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
  IMPORT_RETRY_MS,
  countHubImport,
  fetchImportCounts,
  hubImportCountsSettled,
  importCountIn,
  importCounterUrl,
  resetImportCountsCache,
} from "./hubImportCount.js";
import { HUB_INDEX_URL, resetHubIndexCache } from "./hubFiles.js";

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
    resetHubIndexCache();
  });
  resetImportCountsCache();
  resetHubIndexCache();
  return calls;
};

// The hub's index with its download counts: the old method.
const INDEX = { version: 2, files: {}, posts: [], imports: { 12: 400, 7: 3 } };
// What Cloudflare answers for a Worker whose free plan is used up for the day.
const LIMIT_PAGE = () =>
  new Response("<!DOCTYPE html><html><head><title>Worker exceeded resource limits | Cloudflare</title></head><body>Error 1027</body></html>", {
    status: 429,
    headers: { "Content-Type": "text/html" },
  });

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

test("a counter over its free plan falls back to the hub index's counts, and a later answer replaces them", async (t) => {
  let counter = LIMIT_PAGE;
  const calls = mockFetch(t, (url) => (url === HUB_INDEX_URL ? Response.json(INDEX) : counter()));
  assert.deepEqual(await fetchImportCounts(), { 12: 400, 7: 3 }, "Cloudflare's 429 error page: the index's imports");
  assert.deepEqual(calls.map((call) => call.url), [COUNTS, HUB_INDEX_URL]);
  await fetchImportCounts();
  assert.equal(calls.length, 2, "kept a while, without asking either again");
  counter = () => Response.json({ 12: { count: 351 } });
  assert.deepEqual(await fetchImportCounts({ force: true }), { 12: 351 }, "the counter's answer replaces them");
  assert.equal(calls.filter((call) => call.url === HUB_INDEX_URL).length, 1);
});

test("an error page with status 200, or no answer in time, falls back to the index too", async (t) => {
  const answers = [
    () => new Response("<html><body>Error 1015: You are being rate limited</body></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    () => new Response("Service Unavailable", { status: 503 }),
    () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
  ];
  let answer = null;
  mockFetch(t, (url) => (url === HUB_INDEX_URL ? Response.json(INDEX) : answer()));
  for (answer of answers) {
    resetImportCountsCache();
    resetHubIndexCache();
    assert.deepEqual(await fetchImportCounts(), { 12: 400, 7: 3 });
  }
});

test("good counts under half an hour old stay when the counter fails; the index is not read for them", async (t) => {
  let up = true;
  const calls = mockFetch(t, (url) => (url === HUB_INDEX_URL ? Response.json(INDEX) : up ? Response.json({ 12: { count: 9 } }) : LIMIT_PAGE()));
  const good = await fetchImportCounts();
  up = false;
  assert.equal(await fetchImportCounts({ force: true }), good);
  assert.equal(calls.some((call) => call.url === HUB_INDEX_URL), false);
});

test("neither the counter nor the index: no counts", async (t) => {
  mockFetch(t, (url) => (url === HUB_INDEX_URL ? new Response("", { status: 503 }) : LIMIT_PAGE()));
  assert.equal(await fetchImportCounts(), null);
});

test("a report that fails is no error and holds nothing up", async (t) => {
  mockFetch(t, new TypeError("Failed to fetch"));
  assert.equal(await countHubImport(12), null);
  assert.equal(await countHubImport("not a post"), null);
});

// The counter's answers to the reports, in turn; the install's key is stored.
const counterAnswering = (t, answers) =>
  mockFetch(t, (url) =>
    url === "/api/ui-settings"
      ? Response.json({ hubCountKey: "a".repeat(64) })
      : Response.json(answers.length > 1 ? answers.shift() : answers[0]));

test("a scenario the counter does not list yet is reported once more, a while later, with the same token", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = counterAnswering(t, [{ post: 12, counted: false, reason: "not a released scenario" }, { post: 12, counted: true }]);
  const reports = () => calls.filter((call) => call.url === `${IMPORT_COUNTER_URL}/import`);
  assert.deepEqual(await countHubImport(12), { post: 12, counted: false, reason: "not a released scenario" });
  t.mock.timers.tick(IMPORT_RETRY_MS - 1);
  await hubImportCountsSettled();
  assert.equal(reports().length, 1, "not at once");
  t.mock.timers.tick(1);
  await hubImportCountsSettled();
  assert.equal(reports().length, 2);
  assert.equal(reports()[1].body, reports()[0].body, "the same post and token: it can count once at most");
  t.mock.timers.tick(IMPORT_RETRY_MS * 10);
  await hubImportCountsSettled();
  assert.equal(reports().length, 2, "counted: nothing more");
});

test("a report is sent at most twice, and only again for an answer that can change", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const answers = [{ post: 12, counted: false, reason: "not a released scenario" }];
  const calls = counterAnswering(t, answers);
  const reports = () => calls.filter((call) => call.url === `${IMPORT_COUNTER_URL}/import`).length;
  await countHubImport(12);
  for (let n = 0; n < 5; n += 1) {
    t.mock.timers.tick(IMPORT_RETRY_MS);
    await hubImportCountsSettled();
  }
  assert.equal(reports(), 2, "refused twice: given up");
  for (const reason of ["address", "address limit", "again", "over limit", "origin"]) {
    answers[0] = { post: 7, counted: false, reason };
    const before = reports();
    await countHubImport(7);
    t.mock.timers.tick(IMPORT_RETRY_MS * 2);
    await hubImportCountsSettled();
    assert.equal(reports() - before, 1, reason);
  }
});
