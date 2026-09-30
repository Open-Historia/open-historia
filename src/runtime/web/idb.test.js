/*! Open Historia — web-mode IndexedDB primitives tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/idb.test.js
//
// Version 5 of the web database gave covers and restore points stores of their
// own, and deleted scenarios and games a trash. Opening it over a version 4
// database must add them and touch nothing a player already has, and a write
// spread over several stores must land whole or not at all (libraryStore.js
// putRecord).
//
// Deleting a scenario or game on the web moves its record into the trash, and
// Restore moves it back (libraryStore.js). idbMovePair does each move in one
// transaction, so a failure half-way never leaves a save in both places or in
// neither.

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIndexedDb } from "./fakeIndexedDb.js";

const fake = installFakeIndexedDb();
const DB = "open-historia-web";

// A version 4 database, as a player's browser holds it before this update.
const VERSION_4_STORES = ["scenarios", "games", "mapeditorDocs", "basemapMeta", "basemapPayload", "flags", "scenarioMeta", "gameMeta", "mapeditorMeta", "kv"];
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
fake.rows(DB, "gameMeta").set("old", { id: "old", meta: { name: "Old" }, cover: { contentType: "image/png", bytes: new Uint8Array([1]) } });
fake.rows(DB, "scenarios").set("map", { id: "map", meta: { name: "Map" }, geojson: {}, pmtiles: {} });
fake.rows(DB, "scenarioMeta").set("map", { id: "map", meta: { name: "Map" }, cover: null });
fake.rows(DB, "mapeditorDocs").set("doc", { id: "doc", name: "Sketch" });
// What each store held before version 5 opened it.
const version4 = new Map(VERSION_4_STORES.map((name) => [name, new Map(fake.rows(DB, name))]));

const { STORES, idbGet, idbGetMany, idbMovePair, idbPutPair, idbTransaction } = await import("./idb.js");

const rows = (store) => [...(fake.rows(DB, store)?.keys() ?? [])];

test("opening version 5 over version 4 adds the new stores and keeps every save", async () => {
  const old = await idbGet(STORES.games, "old");
  assert.deepEqual(old.snapshots, [{ id: "snap-1" }], "the record is untouched, restore points and all");
  assert.equal((await idbGet(STORES.kv, "seeded")).value, true);
  for (const name of [STORES.covers, STORES.snapshots, STORES.snapshotIndex]) {
    assert.ok(fake.rows(DB, name), `${name} exists`);
  }
});

// The one version 5 carries two changes: covers and restore points in stores of
// their own, and the trash deleted scenarios and games wait in. Its upgrade
// creates each store only when it is missing, so both sets arrive together and
// no store version 4 had is made again (which would empty it).
test("version 5 over version 4 creates the stores of both its changes, and keeps every row version 4 held", async () => {
  await idbGet(STORES.kv, "seeded");
  for (const name of ["covers", "snapshots", "snapshotIndex", "trash", "trashMeta"]) {
    assert.ok(fake.rows(DB, name), `${name} exists`);
    assert.deepEqual(rows(name), [], `${name} starts empty: the upgrade moves nothing`);
  }
  for (const name of Object.values(STORES)) assert.ok(fake.rows(DB, name), `${name} exists`);
  for (const [name, before] of version4) {
    assert.deepEqual(new Map(fake.rows(DB, name)), before, `${name} is as version 4 left it`);
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

test("a record and its index row move together, under the new key", async () => {
  fake.clear();
  await idbPutPair(STORES.games, { id: "saga", meta: { name: "The Saga" } }, STORES.gameMeta, { id: "saga" });
  const moved = await idbMovePair(STORES.games, STORES.gameMeta, "saga", STORES.trash, STORES.trashMeta, (record) => [
    { id: "game-saga-1", kind: "game", record },
    { id: "game-saga-1", name: record.meta.name },
  ]);
  assert.deepEqual(moved, { id: "game-saga-1", name: "The Saga" });
  assert.deepEqual(rows(STORES.games), []);
  assert.deepEqual(rows(STORES.gameMeta), []);
  assert.deepEqual((await idbGet(STORES.trash, "game-saga-1")).record, { id: "saga", meta: { name: "The Saga" } });
  assert.deepEqual(rows(STORES.trashMeta), ["game-saga-1"]);
});

test("nothing moves when the record is not there, or when building its new form fails", async () => {
  fake.clear();
  assert.equal(await idbMovePair(STORES.games, STORES.gameMeta, "gone", STORES.trash, STORES.trashMeta, () => [{}, {}]), null);
  assert.deepEqual(rows(STORES.trash), []);

  await idbPutPair(STORES.games, { id: "saga" }, STORES.gameMeta, { id: "saga" });
  await assert.rejects(
    idbMovePair(STORES.games, STORES.gameMeta, "saga", STORES.trash, STORES.trashMeta, () => {
      throw new Error("no room");
    }),
    /no room/,
  );
  assert.deepEqual(rows(STORES.games), ["saga"]);
  assert.deepEqual(rows(STORES.gameMeta), ["saga"]);
  assert.deepEqual(rows(STORES.trash), []);
});

// A record's cover (and a game's restore points) live in stores of their own;
// a move into the trash and back carries them in the same transaction.
test("rows a record keeps in stores of their own move in the same transaction, or nothing moves", async () => {
  fake.clear();
  await idbPutPair(STORES.games, { id: "saga", cover: { key: "game:saga" } }, STORES.gameMeta, { id: "saga" });
  await idbTransaction([STORES.covers], (tx) => tx.put(STORES.covers, { id: "game:saga", bytes: new Uint8Array([4]) }));

  await idbMovePair(STORES.games, STORES.gameMeta, "saga", STORES.trash, STORES.trashMeta, async (record, tx) => {
    const cover = await tx.get(STORES.covers, "game:saga");
    await tx.delete(STORES.covers, "game:saga");
    return [{ id: "game-saga-1", record: { ...record, cover } }, { id: "game-saga-1" }];
  }, [STORES.covers]);
  assert.deepEqual(rows(STORES.covers), [], "the cover left its store");
  assert.deepEqual([...(await idbGet(STORES.trash, "game-saga-1")).record.cover.bytes], [4]);

  const putBack = (fail) => idbMovePair(STORES.trash, STORES.trashMeta, "game-saga-1", STORES.games, STORES.gameMeta, async (trashed, tx) => {
    await tx.put(STORES.covers, trashed.record.cover);
    if (fail) throw new Error("no room");
    return [{ ...trashed.record, cover: { key: "game:saga" } }, { id: "saga" }];
  }, [STORES.covers]);
  await assert.rejects(putBack(true), /no room/);
  assert.deepEqual(rows(STORES.covers), [], "the cover written before the failure is undone with the rest");
  assert.deepEqual(rows(STORES.trash), ["game-saga-1"]);
  assert.deepEqual(rows(STORES.games), []);

  assert.deepEqual(await putBack(false), { id: "saga" });
  assert.deepEqual([...(await idbGet(STORES.covers, "game:saga")).bytes], [4]);
  assert.deepEqual(rows(STORES.games), ["saga"]);
  assert.deepEqual(rows(STORES.trash), []);
});
