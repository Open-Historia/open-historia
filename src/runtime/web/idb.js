/*! Open Historia — web-mode IndexedDB primitives © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Minimal promise-based IndexedDB wrapper (no external dependency). Backs the
// web-mode store that replaces the local Express server's file stores. Only ever
// bundled into the web build (dynamically imported behind import.meta.env.VITE_OH_WEB).

const DB_NAME = "open-historia-web";
const DB_VERSION = 5;

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
  // Lean per-record projections (id, meta, cover marker, counts — NEVER the embedded
  // ~100MB pmtiles/geojson or game snapshots) used to build the library menu
  // WITHOUT structured-cloning every full scenario/game into memory. Derived +
  // self-healing, never a source of truth — see libraryStore.js catalog builders.
  scenarioMeta: "scenarioMeta",
  gameMeta: "gameMeta",
  // The same for Workshop documents: the eight-field summary the Documents menu
  // lists, so opening it never loads a whole saved map (one shipped map is 54 MB).
  mapeditorMeta: "mapeditorMeta",
  // Version 5. Scenario and game covers, one row each keyed "scenario:<id>" or
  // "game:<id>": the records and their lean rows keep only a marker, so listing
  // the library or loading a game never copies cover bytes it does not show.
  covers: "covers",
  // A game's restore points, one row each (server/restorePoints.js), and their
  // order per game: reading a game record no longer deserialises up to twelve
  // whole worlds, and a turn writes one row instead of all of them.
  snapshots: "snapshots",
  snapshotIndex: "snapshotIndex",
  // Deleted scenarios and games, kept a while so they can be restored (the
  // library's Recently deleted shelf; libraryStore.js keeps the limits): the
  // whole record as it was, and a lean row per entry that the shelf lists
  // without loading any of them.
  trash: "trash",
  trashMeta: "trashMeta",
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

// Several rows of one store by key, in one transaction; undefined for a key with
// no row.
export const idbGetMany = (store, keys) =>
  runTx(store, "readonly", (tx) => Promise.all(keys.map((key) => promisifyRequest(tx.objectStore(store).get(key)))));

// Reads and writes across several stores in ONE readwrite transaction, so they
// commit or roll back together. `fn` gets { get, put, delete } bound to it and
// must await only these (awaiting anything else lets the transaction commit
// early).
export const idbTransaction = (storeNames, fn) =>
  runTx(storeNames, "readwrite", (tx) => fn({
    get: (store, key) => promisifyRequest(tx.objectStore(store).get(key)),
    getAllKeys: (store) => promisifyRequest(tx.objectStore(store).getAllKeys()),
    put: (store, value) => promisifyRequest(tx.objectStore(store).put(value)),
    delete: (store, key) => promisifyRequest(tx.objectStore(store).delete(key)),
  }));

export const idbDelete = (store, key) =>
  runTx(store, "readwrite", (tx) => promisifyRequest(tx.objectStore(store).delete(key)));

// Move one record and its index row to another pair of stores in ONE
// transaction: the record at `key` in fromRecords is read, build(record)
// returns the [record, index row] written to toRecords and toIndex, and `key`
// leaves fromRecords and fromIndex. A delete into the trash and a restore out
// of it either happen whole or not at all. Resolves the new index row, or null
// when there was no record (nothing is written).
//
// Rows a record keeps in stores of its own (its cover, a game's restore points)
// move in the same transaction: `alsoStores` adds those stores to it, and build
// gets idbTransaction's { get, getAllKeys, put, delete } as its second argument.
// It may then be async, awaiting only those.
export const idbMovePair = (fromRecords, fromIndex, key, toRecords, toIndex, build, alsoStores = []) =>
  idbTransaction([fromRecords, fromIndex, toRecords, toIndex, ...alsoStores], async (tx) => {
    const record = await tx.get(fromRecords, key);
    if (record === undefined) return null;
    const [nextRecord, nextIndex] = await build(record, tx);
    await Promise.all([
      tx.delete(fromRecords, key),
      tx.delete(fromIndex, key),
      tx.put(toRecords, nextRecord),
      tx.put(toIndex, nextIndex),
    ]);
    return nextIndex;
  });

// Delete one key from a record store and its index store in ONE transaction.
export const idbDeletePair = (storeA, storeB, key) =>
  runTx([storeA, storeB], "readwrite", (tx) =>
    Promise.all([
      promisifyRequest(tx.objectStore(storeA).delete(key)),
      promisifyRequest(tx.objectStore(storeB).delete(key)),
    ]));

// Reconcile a lean index store against its real store WITHOUT structured-cloning
// the records: getAllKeys is keys-only (cheap even for rows embedding 100MB
// binaries). Backfill any record missing from the index — an existing store on its
// first build after its index shipped, or a record written without its index row —
// by loading it ONE AT A TIME (peak = a single record, not the whole store at once,
// which is the OOM), and drop index rows whose record was deleted out-of-band.
// After the first build the index is populated, so a listing loads NO full records.
// Returns the index rows in key order.
export const reconcileMetaIndex = async (recordStore, metaStore, project) => {
  const [keys, metas] = await Promise.all([idbGetAllKeys(recordStore), idbGetAll(metaStore)]);
  const byId = new Map(metas.map((m) => [m.id, m]));
  const live = new Set(keys);
  for (const id of keys) {
    if (byId.has(id)) continue;
    const record = await idbGet(recordStore, id); // released before the next iteration
    if (!record) continue;
    const proj = project(record);
    try { await idbPut(metaStore, proj); } catch { /* self-heals next build */ }
    byId.set(id, proj);
  }
  for (const m of metas) {
    if (live.has(m.id)) continue;
    try { await idbDelete(metaStore, m.id); } catch { /* self-heals next build */ }
    byId.delete(m.id);
  }
  return [...byId.values()];
};

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
