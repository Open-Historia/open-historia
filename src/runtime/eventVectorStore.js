/*! Open Historia — the related-events vectors kept on this device © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One vector per event of a game, for related past events
// (Game/AI/relatedEvents.js), in IndexedDB. Each record is keyed "<gameId>:<eventId>" and holds the
// hash of what was embedded (embeddingModels.js contentHash), so an event
// that changed, or a vector of another model, is embedded again.
//
// Derived data: everything here can be rebuilt from the game's events, so the
// store has no migrations. A version that changes its shape deletes the
// database and starts again (DB_NAME carries the version).

// i18n-ignore: storage names.
export const EVENT_VECTOR_DB = "oh-event-vectors-v1";
const STORE = "vectors";
const BY_GAME = "byGame";

export const vectorKey = (gameId, eventId) => `${gameId}:${eventId}`;

const request = (operation) =>
  new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });

// `idb`: the IndexedDB to use (the tests pass a fake). Null where there is none:
// the feature then finds nothing, quietly.
export const openEventVectorStore = (idb = globalThis.indexedDB) => {
  if (!idb) return null;
  let opening = null;
  const db = () => {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const open = idb.open(EVENT_VECTOR_DB, 1);
        open.onupgradeneeded = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains(STORE)) {
            database.createObjectStore(STORE).createIndex(BY_GAME, "gameId", { unique: false });
          }
        };
        open.onsuccess = () => {
          const database = open.result;
          // Deleted elsewhere (a newer version's store replacing it): let it.
          database.onversionchange = () => {
            database.close();
            opening = null;
          };
          resolve(database);
        };
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error("The related-events store is open elsewhere."));
      }).catch((error) => {
        opening = null;
        throw error;
      });
    }
    return opening;
  };
  const store = async (mode) => (await db()).transaction(STORE, mode).objectStore(STORE);
  return Object.freeze({
    // Every vector of a game: Map(eventId → { hash, vector }).
    async readGame(gameId) {
      const rows = await request((await store("readonly")).index(BY_GAME).getAll(String(gameId)));
      const out = new Map();
      for (const row of rows || []) {
        if (row?.eventId && row.vector) out.set(row.eventId, { hash: row.hash, vector: row.vector });
      }
      return out;
    },
    // [{ eventId, hash, vector }] of one game.
    async write(gameId, rows) {
      const objects = await store("readwrite");
      await Promise.all(rows.map((row) => request(objects.put(
        { gameId: String(gameId), eventId: String(row.eventId), hash: row.hash, vector: row.vector },
        vectorKey(gameId, row.eventId),
      ))));
    },
    async remove(gameId, eventIds) {
      const objects = await store("readwrite");
      await Promise.all([...eventIds].map((eventId) => request(objects.delete(vectorKey(gameId, eventId)))));
    },
    // A deleted game's vectors (runtime/library.js removeGame).
    async removeGame(gameId) {
      const objects = await store("readwrite");
      const keys = await request(objects.index(BY_GAME).getAllKeys(String(gameId)));
      await Promise.all((keys || []).map((key) => request(objects.delete(key))));
    },
    async close() {
      if (!opening) return;
      const database = await opening.catch(() => null);
      database?.close();
      opening = null;
    },
  });
};

let shared = null;
// The page's one store.
export const eventVectorStore = () => {
  if (!shared) shared = openEventVectorStore();
  return shared;
};

// A deleted game's vectors. Never throws: a game's deletion must not fail on it.
export const forgetGameVectors = async (gameId) => {
  try {
    if (gameId) await eventVectorStore()?.removeGame(gameId);
  } catch {
    // The store is derived; what is left is never read for another game.
  }
};
