/*! Open Historia — web-mode IndexedDB primitives tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/idb.test.js
//
// Version 5 of the web database gave covers and restore points stores of their
// own. Opening it over a version 4 database must add them and touch nothing a
// player already has, and a write spread over several stores must land whole or
// not at all (libraryStore.js putRecord).

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIndexedDb } from "./fakeIndexedDb.js";

const fake = installFakeIndexedDb();
const DB = "open-historia-web";

// A version 4 database, as a player's browser holds it before this update.
await new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 4);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const name of ["scenarios", "games", "mapeditorDocs", "basemapMeta", "basemapPayload", "flags", "scenarioMeta", "gameMeta", "mapeditorMeta"]) {
      db.createObjectStore(name, { keyPath: "id" });
    }
    db.createObjectStore("kv", { keyPath: "key" });
  };
  request.onsuccess = resolve;
  request.onerror = () => reject(request.error);
});
fake.rows(DB, "games").set("old", { id: "old", snapshots: [{ id: "snap-1" }], cover: { contentType: "image/png", bytes: new Uint8Array([1]) } });
fake.rows(DB, "kv").set("seeded", { key: "seeded", value: true });

const { STORES, idbGet, idbGetMany, idbTransaction } = await import("./idb.js");

test("opening version 5 over version 4 adds the new stores and keeps every save", async () => {
  const old = await idbGet(STORES.games, "old");
  assert.deepEqual(old.snapshots, [{ id: "snap-1" }], "the record is untouched, restore points and all");
  assert.equal((await idbGet(STORES.kv, "seeded")).value, true);
  for (const name of [STORES.covers, STORES.snapshots, STORES.snapshotIndex]) {
    assert.ok(fake.rows(DB, name), `${name} exists`);
  }
});

test("a transaction's reads see its own writes, and it commits across stores", async () => {
  const seen = await idbTransaction([STORES.covers, STORES.snapshotIndex], async (tx) => {
    await tx.put(STORES.covers, { id: "game:a", bytes: new Uint8Array([2]) });
    await tx.put(STORES.snapshotIndex, { id: "a", entries: [] });
    return (await tx.get(STORES.covers, "game:a"))?.id;
  });
  assert.equal(seen, "game:a");
  assert.deepEqual(await idbGetMany(STORES.covers, ["game:a", "game:none"]), [{ id: "game:a", bytes: new Uint8Array([2]) }, undefined]);
  assert.ok(fake.rows(DB, STORES.snapshotIndex).has("a"));
});

test("a transaction that fails part-way leaves every store as it was", async () => {
  await assert.rejects(idbTransaction([STORES.covers, STORES.games], async (tx) => {
    await tx.put(STORES.covers, { id: "game:b", bytes: new Uint8Array([3]) });
    await tx.delete(STORES.games, "old");
    throw new Error("the put of the record failed");
  }), /failed/);
  assert.equal(fake.rows(DB, STORES.covers).has("game:b"), false);
  assert.ok(fake.rows(DB, STORES.games).has("old"));
});
