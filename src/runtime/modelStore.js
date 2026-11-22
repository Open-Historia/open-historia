/*! Open Historia — where on-device models are kept © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A downloaded model's files, kept by URL: in the browser's Cache Storage where
// the page has it, otherwise in IndexedDB. The Android app is served over
// plain http (mobile/capacitor.config.json), which is not a secure origin,
// and Cache Storage only exists in one; so there every translation
// model download failed ("Browser cache is not available in this
// environment.", a player's log, Arabic, Android stable #26).
//
// The IndexedDB copy answers the part of the Web Cache API that Transformers.js
// (env.customCache) and the workers use: match, put, keys and delete, by URL.

// i18n-ignore: a storage key.
const DB_PREFIX = "oh-model-store:";
const STORE = "files";

const keyOf = (request) => (typeof request === "string" ? request : request?.url || String(request));

const request = (operation) =>
  new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });

// Open connections by store name, closed before their database is deleted: a
// deletion waits for every connection to close, and one this file left open
// would hold it forever.
const connections = new Map();
const close = (name) => {
  try {
    connections.get(name)?.close();
  } catch {
    // Already closed.
  }
  connections.delete(name);
};

const openDatabase = (name) =>
  new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_PREFIX + name, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE)) opening.result.createObjectStore(STORE);
    };
    opening.onsuccess = () => {
      const database = opening.result;
      // Another worker deleting it (forgetting the model): let it.
      database.onversionchange = () => close(name);
      connections.set(name, database);
      resolve(database);
    };
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error("The model store is open elsewhere."));
  });

export function indexedDbModelCache(name) {
  const db = async () => connections.get(name) || openDatabase(name);
  const store = async (mode) => (await db()).transaction(STORE, mode).objectStore(STORE);
  return Object.freeze({
    async match(url) {
      const record = await request((await store("readonly")).get(keyOf(url)));
      if (!record) return undefined;
      return new Response(record.body, { headers: record.headers });
    },
    async put(url, response) {
      // Read whole before the transaction opens: one left waiting on a
      // download closes itself.
      const body = new Blob([await response.arrayBuffer()]);
      const headers = [...response.headers.entries()];
      await request((await store("readwrite")).put({ body, headers }, keyOf(url)));
    },
    async keys() {
      const keys = await request((await store("readonly")).getAllKeys());
      return keys.map((url) => ({ url }));
    },
    async delete(url) {
      await request((await store("readwrite")).delete(keyOf(url)));
      return true;
    },
  });
}

export async function openModelCache(name) {
  try {
    if (typeof caches !== "undefined") return await caches.open(name);
  } catch {
    // Cache Storage refused (a private window, an insecure origin): IndexedDB.
  }
  if (typeof indexedDB === "undefined") return null;
  return indexedDbModelCache(name);
}

export async function deleteModelCache(name) {
  try {
    if (typeof caches !== "undefined") await caches.delete(name);
  } catch {
    // Nothing kept there.
  }
  try {
    if (typeof indexedDB !== "undefined") {
      close(name);
      await request(indexedDB.deleteDatabase(DB_PREFIX + name));
    }
  } catch {
    // Nothing kept there.
  }
}
