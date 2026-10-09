// Run: node --test src/runtime/assets.runtimeJsonPrune.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { deleteRuntimeJsonByPrefix, readRuntimeJson, writeRuntimeJson } from "./assets.js";

// A Cache Storage stand-in: one cache, keyed by URL.
const installFakeCaches = () => {
  const entries = new Map();
  const cache = {
    async put(request, response) {
      entries.set(String(request?.url ?? request), response);
    },
    async match(request) {
      return entries.get(String(request?.url ?? request))?.clone() ?? undefined;
    },
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
    async delete(request) {
      return entries.delete(String(request?.url ?? request));
    },
  };
  const previous = globalThis.caches;
  globalThis.caches = { open: async () => cache };
  return { entries, restore: () => { globalThis.caches = previous; } };
};

test("a retired runtime cache family is deleted and nothing else is", async () => {
  const fake = installFakeCaches();
  try {
    await writeRuntimeJson("country-labels-v3-123-abc-en", { pointLabelData: {} });
    await writeRuntimeJson("country-labels-v3-123-abc-fr", { pointLabelData: {} });
    await writeRuntimeJson("region-catalog-v1", { keep: true });
    assert.equal(fake.entries.size, 3);

    assert.equal(await deleteRuntimeJsonByPrefix("country-labels-"), 2);
    assert.equal(fake.entries.size, 1);
    assert.deepEqual(await readRuntimeJson("region-catalog-v1"), { keep: true });
    assert.equal(
      await readRuntimeJson("country-labels-v3-123-abc-en", { defaultValue: null }),
      null,
      "the in-memory copy goes too",
    );
    assert.equal(await deleteRuntimeJsonByPrefix("country-labels-"), 0);
  } finally {
    fake.restore();
  }
});

test("without Cache Storage, or without a prefix, nothing happens", async () => {
  const previous = globalThis.caches;
  delete globalThis.caches;
  try {
    assert.equal(await deleteRuntimeJsonByPrefix("country-labels-"), 0);
    assert.equal(await deleteRuntimeJsonByPrefix(""), 0);
  } finally {
    if (previous !== undefined) globalThis.caches = previous;
  }
});
