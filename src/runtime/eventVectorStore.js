/*! Open Historia — the related-events vectors kept on this device © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One vector per event of a game, for related past events
// (Game/AI/relatedEvents.js), in IndexedDB. Each record is keyed "<gameId>:<eventId>" and holds the
// hash of what was embedded (embeddingModels.js contentHash), so an event
// that changed, or a vector of another model, is embedded again.
//
// Beside it, a store of its own for the older conversations kept on file
// (Game/AI/chatArchive.js): one vector per chunk of an archived chat, keyed
// "<gameId>:<chatId>:<chunk>", with the hash of the chunk's text.
//
// Derived data: everything here can be rebuilt from the game's events and
// chats, so the stores have no migrations. A version that changes a shape
// deletes the database and starts again (the name carries the version).

// i18n-ignore: storage names.
export const EVENT_VECTOR_DB = "oh-event-vectors-v1";
export const CHAT_VECTOR_DB = "oh-chat-vectors-v1";
const STORE = "vectors";
const BY_GAME = "byGame";

export const vectorKey = (gameId, eventId) => `${gameId}:${eventId}`;
export const chatVectorKey = (gameId, chatId, chunk) => `${gameId}:${chatId}:${chunk}`;

const request = (operation) =>
  new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });

// One database of vectors by game: opened on first use, closed when a newer
// version replaces it.
const openVectorDatabase = (idb, name) => {
  let opening = null;
  const db = () => {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const open = idb.open(name, 1);
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
  return {
    store,
    rowsOf: async (gameId) => (await request((await store("readonly")).index(BY_GAME).getAll(String(gameId)))) || [],
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
  };
};

// `idb`: the IndexedDB to use (the tests pass a fake). Null where there is none:
// the feature then finds nothing, quietly.
export const openEventVectorStore = (idb = globalThis.indexedDB) => {
  if (!idb) return null;
  const base = openVectorDatabase(idb, EVENT_VECTOR_DB);
  return Object.freeze({
    // Every vector of a game: Map(eventId → { hash, vector }).
    async readGame(gameId) {
      const out = new Map();
      for (const row of await base.rowsOf(gameId)) {
        if (row?.eventId && row.vector) out.set(row.eventId, { hash: row.hash, vector: row.vector });
      }
      return out;
    },
    // [{ eventId, hash, vector }] of one game.
    async write(gameId, rows) {
      const objects = await base.store("readwrite");
      await Promise.all(rows.map((row) => request(objects.put(
        { gameId: String(gameId), eventId: String(row.eventId), hash: row.hash, vector: row.vector },
        vectorKey(gameId, row.eventId),
      ))));
    },
    async remove(gameId, eventIds) {
      const objects = await base.store("readwrite");
      await Promise.all([...eventIds].map((eventId) => request(objects.delete(vectorKey(gameId, eventId)))));
    },
    // A deleted game's vectors (runtime/library.js removeGame).
    removeGame: base.removeGame,
    close: base.close,
  });
};

// The archived chats' chunks. Map keys are "<chatId>:<chunk>"
// (chatArchive.js chatChunkKey), the ids the search ranks.
export const openChatVectorStore = (idb = globalThis.indexedDB) => {
  if (!idb) return null;
  const base = openVectorDatabase(idb, CHAT_VECTOR_DB);
  return Object.freeze({
    // Every chunk vector of a game: Map("chatId:chunk" → { chatId, chunk, hash, vector }).
    async readGame(gameId) {
      const out = new Map();
      for (const row of await base.rowsOf(gameId)) {
        if (!row?.chatId || !row.vector || !Number.isInteger(row.chunk)) continue;
        out.set(`${row.chatId}:${row.chunk}`, { chatId: row.chatId, chunk: row.chunk, hash: row.hash, vector: row.vector });
      }
      return out;
    },
    // [{ chatId, chunk, hash, vector }] of one game.
    async write(gameId, rows) {
      const objects = await base.store("readwrite");
      await Promise.all(rows.map((row) => request(objects.put(
        { gameId: String(gameId), chatId: String(row.chatId), chunk: Number(row.chunk), hash: row.hash, vector: row.vector },
        chatVectorKey(gameId, row.chatId, row.chunk),
      ))));
    },
    // Keys as readGame gives them ("chatId:chunk").
    async remove(gameId, keys) {
      const objects = await base.store("readwrite");
      await Promise.all([...keys].map((key) => request(objects.delete(`${gameId}:${key}`))));
    },
    removeGame: base.removeGame,
    close: base.close,
  });
};

let shared = null;
// The page's one store.
export const eventVectorStore = () => {
  if (!shared) shared = openEventVectorStore();
  return shared;
};

let sharedChats = null;
export const chatVectorStore = () => {
  if (!sharedChats) sharedChats = openChatVectorStore();
  return sharedChats;
};

// A deleted game's vectors, its events' and its chats'. Never throws: a game's
// deletion must not fail on it.
//   stores  the stores to clear, or functions giving them (the tests pass their own)
export const forgetGameVectors = async (gameId, { stores = null } = {}) => {
  if (!gameId) return;
  for (const store of stores ?? [eventVectorStore, chatVectorStore]) {
    try {
      await (typeof store === "function" ? store() : store)?.removeGame(gameId);
    } catch {
      // The store is derived; what is left is never read for another game.
    }
  }
};
