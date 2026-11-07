import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_VECTOR_DB, deleteEventVectors, openEventVectorStore, vectorKey } from "./eventVectorStore.js";

// Just enough IndexedDB for the store: object stores by key, and an index on
// one field of the value (getAll and getAllKeys by that field).
const fakeIndexedDb = () => {
  const databases = new Map();
  const later = (result) => {
    const operation = {};
    queueMicrotask(() => {
      operation.result = result;
      operation.onsuccess?.();
    });
    return operation;
  };
  return {
    databases,
    open(name) {
      const operation = {};
      queueMicrotask(() => {
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        const stores = databases.get(name);
        operation.result = {
          close() {},
          objectStoreNames: { contains: (store) => stores.has(store) },
          createObjectStore: (store) => {
            const entry = { rows: new Map(), indexes: new Map() };
            stores.set(store, entry);
            return { createIndex: (index, field) => entry.indexes.set(index, field) };
          },
          transaction: (store) => ({
            objectStore: () => {
              const { rows, indexes } = stores.get(store);
              return {
                get: (key) => later(rows.get(key)),
                put: (value, key) => later(rows.set(key, value) && key),
                delete: (key) => later(rows.delete(key) && undefined),
                index: (index) => {
                  const field = indexes.get(index);
                  const matching = (value) => [...rows].filter(([, row]) => row[field] === value);
                  return {
                    getAll: (value) => later(matching(value).map(([, row]) => row)),
                    getAllKeys: (value) => later(matching(value).map(([key]) => key)),
                  };
                },
              };
            },
          }),
        };
        if (fresh) operation.onupgradeneeded?.();
        operation.onsuccess?.();
      });
      return operation;
    },
    deleteDatabase(name) {
      return later(databases.delete(name) && undefined);
    },
  };
};

const vector = (...values) => Float32Array.from(values);

test("vectors are kept per game, keyed gameId:eventId, with the hash of what was embedded", async () => {
  const idb = fakeIndexedDb();
  const store = openEventVectorStore(idb);
  await store.write("game-a", [
    { eventId: "e1", hash: "h1", vector: vector(1, 0) },
    { eventId: "e2", hash: "h2", vector: vector(0, 1) },
  ]);
  await store.write("game-b", [{ eventId: "e1", hash: "x1", vector: vector(0.6, 0.8) }]);
  const rows = idb.databases.get(EVENT_VECTOR_DB).get("vectors").rows;
  assert.deepEqual([...rows.keys()].sort(), ["game-a:e1", "game-a:e2", "game-b:e1"]);
  assert.equal(vectorKey("game-a", "e1"), "game-a:e1");

  const a = await store.readGame("game-a");
  assert.deepEqual([...a.keys()].sort(), ["e1", "e2"]);
  assert.equal(a.get("e2").hash, "h2");
  assert.deepEqual([...a.get("e2").vector], [0, 1]);
  assert.equal((await store.readGame("game-b")).get("e1").hash, "x1", "the same event id in another game is another record");

  // An event embedded again replaces its vector.
  await store.write("game-a", [{ eventId: "e1", hash: "h1b", vector: vector(0, 1) }]);
  assert.equal((await store.readGame("game-a")).get("e1").hash, "h1b");

  await store.remove("game-a", ["e2"]);
  assert.deepEqual([...(await store.readGame("game-a")).keys()], ["e1"]);
});

test("deleting a game removes only its vectors; turning the feature off removes them all", async () => {
  const idb = fakeIndexedDb();
  const store = openEventVectorStore(idb);
  await store.write("game-a", [{ eventId: "e1", hash: "h", vector: vector(1) }]);
  await store.write("game-b", [{ eventId: "e1", hash: "h", vector: vector(1) }]);
  await store.removeGame("game-a");
  assert.equal((await store.readGame("game-a")).size, 0);
  assert.equal((await store.readGame("game-b")).size, 1);
  await store.close();
  await deleteEventVectors(idb);
  assert.equal(idb.databases.has(EVENT_VECTOR_DB), false);
});

test("no IndexedDB, no store: the feature finds nothing instead of failing", () => {
  assert.equal(openEventVectorStore(null), null);
});
