/*! Open Historia — web-mode IndexedDB primitives © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Minimal promise-based IndexedDB wrapper (no external dependency). Backs the
// web-mode store that replaces the local Express server's file stores. Only ever
// bundled into the web build (dynamically imported behind import.meta.env.VITE_OH_WEB).

const DB_NAME = "open-historia-web";
const DB_VERSION = 3;

// Object stores mirror the server's on-disk stores (see server/libraryStore.js,
// mapEditorStore.js, basemapStore.js, flagStore.js). "kv" holds the small
// singletons: scenario-manifest, game-manifest, mapeditor-manifest,
// basemaps-manifest, ui-settings, and the one-time seed flag. A growing
// collection gets its own store instead — one record per item, so a write touches
// that item rather than rewriting the whole set.
//
// Adding a store means bumping DB_VERSION. onupgradeneeded below creates whatever
// is missing and leaves existing stores alone, so a bump is additive: nobody's
// scenarios, games or basemaps are touched.
export const STORES = {
  scenarios: "scenarios",
  games: "games",
  mapeditorDocs: "mapeditorDocs",
  basemapMeta: "basemapMeta",
  basemapPayload: "basemapPayload",
  flags: "flags",
  kv: "kv",
  // Lean per-record projections (id, meta, cover, counts — NEVER the embedded
  // ~100MB pmtiles/geojson or game snapshots) used to build the library menu
  // WITHOUT structured-cloning every full scenario/game into memory. Derived +
  // self-healing, never a source of truth — see libraryStore.js catalog builders.
  scenarioMeta: "scenarioMeta",
  gameMeta: "gameMeta",
};

let dbPromise = null;

const openDB = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === STORES.kv ? "key" : "id" });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab opening a NEWER version fires this on our (older) connection.
      // Close it so that tab's upgrade can proceed — otherwise its open() sits in
      // onblocked below and rejects, and the player sees a dead second tab until
      // they close this one. Drop the memoized promise so our next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });

  return dbPromise;
};

const promisifyRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Run fn(store) inside a transaction and resolve once the transaction COMMITS
// (not merely when the request succeeds) so writes are durable before callers
// read back.
const runTx = async (storeNames, mode, fn) => {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    Promise.resolve(fn(transaction))
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        try {
          transaction.abort();
        } catch {
          // already settling
        }
        reject(error);
      });
  });
};

export const idbGet = (store, key) =>
  runTx(store, "readonly", (tx) => promisifyRequest(tx.objectStore(store).get(key)));

export const idbGetAll = (store) =>
  runTx(store, "readonly", (tx) => promisifyRequest(tx.objectStore(store).getAll()));

// Primary keys only — never deserializes the record VALUES, so it is cheap even for
// stores whose rows embed ~100MB binaries. Used to reconcile the lean catalogMeta
// index against the real stores without materializing them.
export const idbGetAllKeys = (store) =>
  runTx(store, "readonly", (tx) => promisifyRequest(tx.objectStore(store).getAllKeys()));

export const idbPut = (store, value) =>
  runTx(store, "readwrite", (tx) => promisifyRequest(tx.objectStore(store).put(value)));

// Write two records in ONE transaction so a record and its derived index row commit —
// or roll back — together; the index can never be left stale relative to the record.
export const idbPutPair = (storeA, valueA, storeB, valueB) =>
  runTx([storeA, storeB], "readwrite", (tx) =>
    Promise.all([
      promisifyRequest(tx.objectStore(storeA).put(valueA)),
      promisifyRequest(tx.objectStore(storeB).put(valueB)),
    ]));

export const idbDelete = (store, key) =>
  runTx(store, "readwrite", (tx) => promisifyRequest(tx.objectStore(store).delete(key)));

// kv helpers: values are wrapped as { key, value }.
export const kvGet = async (key, fallback = null) => {
  const record = await idbGet(STORES.kv, key);
  return record ? record.value : fallback;
};

export const kvPut = (key, value) => idbPut(STORES.kv, { key, value });

// Read-modify-write a kv value atomically within one transaction.
export const kvUpdate = (key, updater, fallback = null) =>
  runTx(STORES.kv, "readwrite", async (tx) => {
    const store = tx.objectStore(STORES.kv);
    const record = await promisifyRequest(store.get(key));
    const current = record ? record.value : fallback;
    const next = updater(current);
    await promisifyRequest(store.put({ key, value: next }));
    return next;
  });

// Read-modify-write a keyed record (id-based store) atomically.
export const idbUpdate = (store, key, updater) =>
  runTx(store, "readwrite", async (tx) => {
    const objectStore = tx.objectStore(store);
    const current = await promisifyRequest(objectStore.get(key));
    const next = updater(current);
    if (next === undefined) {
      await promisifyRequest(objectStore.delete(key));
      return null;
    }
    await promisifyRequest(objectStore.put(next));
    return next;
  });
