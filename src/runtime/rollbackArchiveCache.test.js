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
import { JSON_URLS, loadRollbackSnapshot, loadTurnRestorePoint, readJson, setRuntimeAssetEndpoints, writeJson } from "./assets.js";

const stored = new Map();
const gets = [];
globalThis.fetch = async (url, { method = "GET", body } = {}) => {
  const key = String(url);
  if (method === "PUT") {
    stored.set(key, body);
    return new Response(null, { status: 204 });
  }
  gets.push(key);
  // One restore point by id (/api/runtime/snapshots/:id): a 404 when there is none.
  if (key.includes("/api/runtime/snapshots/") && !stored.has(key)) return new Response("{}", { status: 404 });
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

// The staged reveal and viewAsSeen want the one world a turn started from.
const oneRestorePoint = { id: "snap-9", fromDate: "1915-01-01", toDate: "1915-02-01", state: { world: { note: "before" } } };

test("with the archive in memory, one restore point is taken from it, with no fetch", async () => {
  setRuntimeAssetEndpoints({ token: "game-c" });
  await writeJson(JSON_URLS.snapshots, [oneRestorePoint], { cacheClone: false, cloneResult: false, echo: false });
  gets.length = 0;
  assert.equal(await loadRollbackSnapshot("snap-9"), oneRestorePoint);
  assert.equal(await loadTurnRestorePoint({ fromDate: "1915-01-01", toDate: "1915-02-01" }), oneRestorePoint);
  assert.equal(await loadRollbackSnapshot("snap-none"), null);
  assert.deepEqual(gets, []);
});

test("without it, the index and that one restore point are read, never the archive", async () => {
  setRuntimeAssetEndpoints({ token: "game-d" });
  const one = `/api/runtime/snapshots/snap-9?v=game-d`;
  stored.set(String(JSON_URLS.snapshotsIndex), JSON.stringify({ entries: [{ id: "snap-9", fromDate: "1915-01-01", toDate: "1915-02-01" }] }));
  stored.set(one, JSON.stringify(oneRestorePoint));
  gets.length = 0;
  assert.deepEqual(await loadTurnRestorePoint({ fromDate: "1915-01-01", toDate: "1915-02-01" }), oneRestorePoint);
  assert.deepEqual(gets, [String(JSON_URLS.snapshotsIndex), one]);
  assert.equal(await loadTurnRestorePoint({ fromDate: "1915-02-01", toDate: "1915-03-01" }), null, "no restore point spans that turn");
  assert.equal(await loadRollbackSnapshot("snap-gone"), null, "a 404 is none");
  assert.equal(gets.includes(String(JSON_URLS.snapshots)), false);
});
