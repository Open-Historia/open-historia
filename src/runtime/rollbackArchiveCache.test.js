/*! Open Historia — the restore-point archive is read once, not on every turn © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/rollbackArchiveCache.test.js
//
// Needs a full install: assets.js -> maplibre-gl.
//
// The restore-point archive (snapshots.json) holds up to twelve whole worlds,
// 8-21 MB on a long game. It was read with force: true on every turn, every
// undo and every staged reveal, re-fetching and re-parsing it although this tab
// is its only writer and every write already primes the cache. The readers
// (gameplay.js captureRollbackSnapshot and loadRollbackSnapshots, the cheats
// Roll-back tool, the stats history) now read it unforced. This holds the
// contract they rely on: after the first read, and after every write, the
// archive comes from memory; a new game starts from the store again.

import test from "node:test";
import assert from "node:assert/strict";
import { JSON_URLS, readJson, setRuntimeAssetEndpoints, writeJson } from "./assets.js";

const stored = new Map();
const gets = [];
globalThis.fetch = async (url, { method = "GET", body } = {}) => {
  const key = String(url);
  if (method === "PUT") {
    stored.set(key, body);
    return new Response(null, { status: 204 });
  }
  gets.push(key);
  return new Response(stored.get(key) ?? "[]", { status: 200, headers: { "Content-Type": "application/json" } });
};

const read = () => readJson(JSON_URLS.snapshots, { defaultValue: [], clone: false });

test("the archive is fetched once, then served from memory", async () => {
  setRuntimeAssetEndpoints({ token: "game-a" });
  stored.set(String(JSON_URLS.snapshots), JSON.stringify([{ id: "snap-1", fromDate: "1914-06-28", toDate: "1914-07-28" }]));
  gets.length = 0;
  const first = await read();
  const second = await read();
  assert.equal(gets.length, 1, "one fetch for two reads");
  assert.equal(second, first, "the same shared list, not a copy");
  assert.equal(first[0].id, "snap-1");
});

test("a write is what the next read returns, with no fetch", async () => {
  setRuntimeAssetEndpoints({ token: "game-a" });
  const prior = await read();
  gets.length = 0;
  const next = [{ id: "snap-2", fromDate: "1914-07-28", toDate: "1914-08-28" }, ...prior];
  await writeJson(JSON_URLS.snapshots, next, { cacheClone: false, cloneResult: false, echo: false });
  const after = await read();
  assert.equal(gets.length, 0);
  assert.deepEqual(after.map((snap) => snap.id), ["snap-2", "snap-1"]);
});

test("another game's archive is read from the store, never the last game's", async () => {
  setRuntimeAssetEndpoints({ token: "game-b" });
  gets.length = 0;
  const list = await read();
  assert.equal(gets.length, 1);
  assert.deepEqual(list, []);
});
