/*! Open Historia — in-memory IndexedDB for the web store tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Test-only. Node has no IndexedDB, and the web stores (idb.js and everything on
// it) only ever run in a browser, so their tests install this first. It covers
// exactly what idb.js uses: open with an upgrade, object stores keyed by one
// keyPath, get/getAll/getAllKeys/put/delete, and transactions that commit once
// no request is pending (as a real one does) or roll back on abort. Values are
// structured-cloned in and out, like the real thing, so a test that mutates
// what it read cannot reach into the store.
//
// Nothing in the app imports this; it is never bundled.

const later = (fn) => setImmediate(fn);
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const newRequest = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });

const openHandle = (db) => {
  const handle = {
    onversionchange: null,
    objectStoreNames: { contains: (name) => db.stores.has(name) },
    createObjectStore: (name, { keyPath } = {}) => {
      db.stores.set(name, { keyPath, rows: new Map() });
    },
    close: () => {},
    transaction: (storeNames, mode = "readonly") => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of names) {
        if (!db.stores.has(name)) throw new Error(`NotFoundError: no object store "${name}"`);
      }
      const snapshot = new Map(names.map((name) => [name, new Map(db.stores.get(name).rows)]));
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      let pending = 0;
      let finished = false;
      const settle = () => later(() => {
        if (finished || pending) return;
        finished = true;
        tx.oncomplete?.();
      });
      const run = (op) => {
        if (finished) throw new Error("TransactionInactiveError");
        const request = newRequest();
        pending += 1;
        later(() => {
          pending -= 1;
          if (finished) return;
          try {
            request.result = op();
          } catch (error) {
            request.error = error;
            request.onerror?.();
            settle();
            return;
          }
          request.onsuccess?.();
          settle();
        });
        return request;
      };
      tx.objectStore = (name) => {
        if (!names.includes(name)) throw new Error(`NotFoundError: "${name}" is not in this transaction`);
        const store = db.stores.get(name);
        const writable = () => {
          if (mode !== "readwrite") throw new Error("ReadOnlyError");
        };
        return {
          get: (key) => run(() => clone(store.rows.get(key))),
          getAll: () => run(() => [...store.rows.keys()].sort(compareKeys).map((key) => clone(store.rows.get(key)))),
          getAllKeys: () => run(() => [...store.rows.keys()].sort(compareKeys)),
          put: (value) => run(() => {
            writable();
            const key = value[store.keyPath];
            store.rows.set(key, clone(value));
            return key;
          }),
          delete: (key) => run(() => {
            writable();
            store.rows.delete(key);
          }),
        };
      };
      tx.abort = () => {
        if (finished) throw new Error("InvalidStateError");
        finished = true;
        for (const [name, rows] of snapshot) db.stores.get(name).rows = rows;
        later(() => tx.onabort?.());
      };
      // A transaction nobody issues a request on still completes.
      settle();
      return tx;
    },
  };
  return handle;
};

// Installs globalThis.indexedDB and returns helpers for the test to reach the
// data directly. Call it before the first store call; idb.js opens lazily.
export const installFakeIndexedDb = () => {
  const databases = new Map(); // name -> { version, stores: Map<name, { keyPath, rows }> }
  globalThis.indexedDB = {
    open: (name, version = 1) => {
      const request = { ...newRequest(), onupgradeneeded: null, onblocked: null };
      later(() => {
        let db = databases.get(name);
        if (!db) {
          db = { version: 0, stores: new Map() };
          databases.set(name, db);
        }
        request.result = openHandle(db);
        if (version > db.version) {
          db.version = version;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
  const store = (dbName, storeName) => databases.get(dbName)?.stores.get(storeName)?.rows ?? null;
  return {
    // The live rows of one store (a Map keyed by the store's keyPath), or null.
    rows: store,
    // Empty every store, keeping the schema; for a clean slate between tests.
    clear: () => {
      for (const db of databases.values()) for (const entry of db.stores.values()) entry.rows = new Map();
    },
  };
};
