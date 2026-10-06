/*! Open Historia — Listen in: where the feeds are kept © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The feeds a player has already paid a request for (listenIn.js), per game, in
// a small IndexedDB store of their own on the device — as the AI call record is
// (AI/telemetry.js), and not in the save. They are colour, not canon: nothing
// reads them back into the game, and a save that carried them would grow with
// every place its player was curious about.
//
// Best effort throughout. Without IndexedDB (a private window, node) the
// session's memory still holds them, and a write that fails only means that
// feed is asked for again another day.
import { emptyListenInStore, normalizeListenInStore } from "./listenIn.js";

const DB_NAME = "oh-listen-in";
const DB_VERSION = 1;
const STORE = "games";
// Feeds are kept for the games read last; an older game's are dropped.
export const LISTEN_IN_GAMES_KEPT = 12;

const clean = (value) => String(value ?? "").trim();

// `idb` is read at every open rather than once: a test installs its own.
export const createListenInStorage = ({
  idb = () => (typeof indexedDB === "undefined" ? null : indexedDB),
  now = Date.now,
} = {}) => {
  const memory = new Map();
  let dbPromise = null;

  const openDb = () => {
    const factory = idb();
    if (!factory) return Promise.reject(new Error("no indexeddb"));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      // A failed open is tried again by the next call, not remembered.
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  };

  const withStore = async (mode, work) => {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const outcome = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(outcome && "result" in outcome ? outcome.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };

  // What is kept for one game. Read from storage once, then from memory.
  const read = async (gameId) => {
    const id = clean(gameId);
    if (!id) return emptyListenInStore();
    if (memory.has(id)) return memory.get(id);
    let stored = null;
    try {
      stored = await withStore("readonly", (store) => store.get(id));
    } catch {
      // This session's memory only.
    }
    // A batch written while the read was out is newer than what was stored.
    if (!memory.has(id)) memory.set(id, normalizeListenInStore(stored));
    return memory.get(id);
  };

  const persist = async (id, value) => {
    try {
      await withStore("readwrite", (store) => { store.put({ id, updatedAt: now(), ...value }); });
      const keys = await withStore("readonly", (store) => store.getAllKeys());
      if (!Array.isArray(keys) || keys.length <= LISTEN_IN_GAMES_KEPT) return;
      // Over the limit: only now are the rows themselves read, to find the oldest.
      const rows = await withStore("readonly", (store) => store.getAll());
      const stale = (Array.isArray(rows) ? rows : [])
        .sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))
        .slice(LISTEN_IN_GAMES_KEPT)
        .map((row) => row.id);
      if (stale.length) await withStore("readwrite", (store) => { for (const key of stale) store.delete(key); });
    } catch {
      // Kept for this session only.
    }
  };

  // Changes what is kept for one game: `change` gets the current store and
  // returns the next. Read first, then changed in one step, so two feeds that
  // come back together both land.
  const update = async (gameId, change) => {
    const id = clean(gameId);
    if (!id) return emptyListenInStore();
    await read(id);
    const next = normalizeListenInStore(change(memory.get(id)));
    memory.set(id, next);
    await persist(id, next);
    return next;
  };

  return { read, update };
};

const storage = createListenInStorage();
export const readListenInStore = storage.read;
export const updateListenInStore = storage.update;
