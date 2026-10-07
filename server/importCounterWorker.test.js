/*! Open Historia — the retired import counter Worker: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/importCounterWorker.test.js
//
// tools/import-counter/worker.js still answers the game builds that call it,
// from the hub's index, and no longer touches KV: its daily allowance on the
// free plan was what ran out.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import worker, { HUB_INDEX_URL } from "../tools/import-counter/worker.js";

const INDEX = { version: 1, files: {}, imports: { 12: 345, 7: 0, 9: "junk", 10: -4 } };

// The Workers runtime's globals, as much of them as the Worker uses.
const runtime = (t, { index = INDEX, status = 200 } = {}) => {
  const state = { upstream: 0, cached: new Map(), waited: [] };
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.fetch = async (input) => {
    assert.equal(String(input?.url ?? input), HUB_INDEX_URL, "the only place it ever asks");
    state.upstream += 1;
    return new Response(JSON.stringify(index), { status });
  };
  globalThis.caches = {
    default: {
      match: async (request) => state.cached.get(request.url)?.clone() ?? null,
      put: async (request, response) => { state.cached.set(request.url, response); },
    },
  };
  t.after(() => {
    globalThis.fetch = original.fetch;
    globalThis.caches = original.caches;
  });
  const ctx = { waitUntil: (promise) => state.waited.push(promise) };
  // Any use of the old KV binding fails the test.
  const env = { IMPORTS: new Proxy({}, { get: (_target, name) => () => { throw new Error(`KV was used: IMPORTS.${String(name)}`); } }) };
  const call = async (path, init) => {
    const response = await worker.fetch(new Request(`https://oh-import-counter.example${path}`, init), env, ctx);
    await Promise.all(state.waited.splice(0));
    return response;
  };
  return { state, call };
};

test("/counts answers old builds in the shape they read, from the hub's index", async (t) => {
  const { call, state } = runtime(t);
  const response = await call("/counts");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), { 7: { count: 0 }, 12: { count: 345 } }, "only whole, non-negative counts");
  // The index is kept at the edge: a second read does not go back to GitHub.
  await call("/counts");
  assert.equal(state.upstream, 1);
});

test("/count/<id> answers one post", async (t) => {
  const { call } = runtime(t);
  assert.deepEqual(await (await call("/count/12")).json(), { id: "12", count: 345 });
  assert.deepEqual(await (await call("/count/9999")).json(), { id: "9999", count: 0 });
});

test("/hit is accepted and stores nothing", async (t) => {
  const { call } = runtime(t);
  const response = await call("/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "12", title: "Old World" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "12", count: 345, retired: true });
  assert.equal((await call("/hit", { method: "POST", body: "{}" })).status, 400);
});

test("an index that cannot be read is no counts, not an error", async (t) => {
  const { call } = runtime(t, { status: 503 });
  const response = await call("/counts");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
});

test("the Worker's code has no KV, no hashing and no address in it", () => {
  const source = fs.readFileSync(new URL("../tools/import-counter/worker.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /env\.IMPORTS|\.put\(\s*`?[ch]:|getWithMetadata|crypto\.subtle|cf-connecting-ip|HASH_SALT/);
});
