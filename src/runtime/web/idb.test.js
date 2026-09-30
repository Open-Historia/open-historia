/*! Open Historia — moving a record between IndexedDB stores © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/idb.test.js
//
// Deleting a scenario or game on the web moves its record into the trash, and
// Restore moves it back (libraryStore.js). idbMovePair does each move in one
// transaction, so a failure half-way never leaves a save in both places or in
// neither.
import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIndexedDb } from "./fakeIndexedDb.js";

const fake = installFakeIndexedDb();
const { STORES, idbGet, idbMovePair, idbPutPair } = await import("./idb.js");

const rows = (store) => [...(fake.rows("open-historia-web", store)?.keys() ?? [])];

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
