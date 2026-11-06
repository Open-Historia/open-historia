import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deleteModelCache, openModelCache } from "./modelStore.js";

// Just enough IndexedDB for the store: one object store per database, by key.
const fakeIndexedDb = () => {
  const databases = new Map();
  const later = (operation, result) => {
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
          createObjectStore: (store) => stores.set(store, new Map()),
          transaction: (store) => ({
            objectStore: () => {
              const rows = stores.get(store);
              return {
                get: (key) => later({}, rows.get(key)),
                put: (value, key) => later({}, rows.set(key, value) && key),
                getAllKeys: () => later({}, [...rows.keys()]),
                delete: (key) => later({}, rows.delete(key) && undefined),
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
      return later({}, databases.delete(name) && undefined);
    },
  };
};

test("without Cache Storage (the Android app's http origin) models are kept in IndexedDB", async () => {
  const saved = { caches: globalThis.caches, indexedDB: globalThis.indexedDB };
  delete globalThis.caches;
  globalThis.indexedDB = fakeIndexedDb();
  try {
    const url = "https://huggingface.co/Xenova/opus-mt-en-ar/resolve/abc/onnx/encoder_model_quantized.onnx";
    const cache = await openModelCache("oh-translation-model-v1");
    assert.ok(cache, "a store, not nothing");
    assert.equal(await cache.match(url), undefined);
    await cache.put(url, new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } }));
    const kept = await cache.match(url);
    assert.deepEqual([...new Uint8Array(await kept.arrayBuffer())], [1, 2, 3]);
    assert.equal(kept.headers.get("content-length"), "3");
    assert.deepEqual((await cache.keys()).map((key) => key.url), [url]);
    // Transformers.js's own interface: an object with match and put.
    assert.equal(typeof cache.match, "function");
    assert.equal(typeof cache.put, "function");
    await cache.delete({ url });
    assert.equal(await cache.match(url), undefined);
    await cache.put(url, new Response("x"));
    await deleteModelCache("oh-translation-model-v1");
    assert.equal(globalThis.indexedDB.databases.size, 0, "forgetting a model removes its database");
  } finally {
    if (saved.caches) globalThis.caches = saved.caches;
    if (saved.indexedDB) globalThis.indexedDB = saved.indexedDB;
    else delete globalThis.indexedDB;
  }
});

test("where the page has Cache Storage it is used", async () => {
  const saved = globalThis.caches;
  const opened = [];
  globalThis.caches = { open: async (name) => (opened.push(name), { match() {}, put() {} }) };
  try {
    assert.ok(await openModelCache("oh-translation-model-v1"));
    assert.deepEqual(opened, ["oh-translation-model-v1"]);
  } finally {
    if (saved) globalThis.caches = saved;
    else delete globalThis.caches;
  }
});

test("the translation worker reads, writes and hands Transformers.js the same store", () => {
  const worker = readFileSync(new URL("./translationWorker.js", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /\bcaches\.(open|delete)\(/, "no direct Cache Storage call left to fail on Android");
  assert.match(worker, /env\.useCustomCache = true;\s*env\.customCache = store;/);
});
