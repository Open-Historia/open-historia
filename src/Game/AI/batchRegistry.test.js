/*! Open Historia — stored background batch tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/batchRegistry.test.js
//
// A batch is paid for when it is sent. What is stored here is what lets the
// game collect it after a reload instead of sending the same work again.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BATCH_MAX_AGE_MS,
  BATCH_REGISTRY_STORAGE_KEY,
  forgetBatch,
  readStoredBatches,
  rememberBatch,
} from "./batchRegistry.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    raw: () => values.get(BATCH_REGISTRY_STORAGE_KEY),
  };
};

const consolidation = {
  kind: "consolidation",
  campaignId: "game-1",
  actionIds: ["a1"],
  chatIds: [],
  throughDate: "1915-06-01",
  throughEventId: "evt-9",
  throughRound: 4,
  baseRevision: 2,
  eventCount: 12,
  chatCount: 0,
};
const batch = (overrides = {}) => ({
  customId: "oh_eventConsolidator_1",
  batchId: "msgbatch_1",
  connectionId: "conn-anthropic",
  taskKey: "eventConsolidator",
  campaignId: "game-1",
  resume: consolidation,
  ...overrides,
});

test("a remembered batch survives a reload with everything needed to collect it", () => {
  const storage = memoryStorage();
  assert.equal(rememberBatch(batch(), { storage, now: 1000 }), true);
  assert.deepEqual(readStoredBatches({ storage, now: 2000 }), [{ ...batch(), submittedAt: 1000 }]);
});

test("a batch is forgotten once collected, and storage is cleared with the last one", () => {
  const storage = memoryStorage();
  rememberBatch(batch(), { storage, now: 1000 });
  rememberBatch(batch({ customId: "oh_eventConsolidator_2", batchId: "msgbatch_2" }), { storage, now: 1500 });
  forgetBatch("oh_eventConsolidator_1", { storage });
  assert.deepEqual(readStoredBatches({ storage, now: 2000 }).map((entry) => entry.customId), ["oh_eventConsolidator_2"]);
  forgetBatch("oh_eventConsolidator_2", { storage });
  assert.equal(storage.raw(), undefined);
  forgetBatch("never-stored", { storage });
});

test("nothing that cannot be collected again is stored", () => {
  const storage = memoryStorage();
  assert.equal(rememberBatch(batch({ batchId: "" }), { storage }), false);
  assert.equal(rememberBatch(batch({ connectionId: undefined }), { storage }), false);
  assert.equal(rememberBatch(batch({ resume: null }), { storage }), false);
  assert.equal(storage.raw(), undefined);
});

test("expired, malformed and mis-keyed records are dropped on read", () => {
  const storage = memoryStorage();
  rememberBatch(batch(), { storage, now: 0 });
  rememberBatch(batch({ customId: "fresh" }), { storage, now: BATCH_MAX_AGE_MS });
  const all = JSON.parse(storage.raw());
  all.broken = { customId: "broken" };
  all.renamed = { ...all.fresh, customId: "other" };
  storage.setItem(BATCH_REGISTRY_STORAGE_KEY, JSON.stringify(all));

  const kept = readStoredBatches({ storage, now: BATCH_MAX_AGE_MS + 1 });
  assert.deepEqual(kept.map((entry) => entry.customId), ["fresh"]);
  assert.deepEqual(Object.keys(JSON.parse(storage.raw())), ["fresh"], "the dropped records are removed from storage");
});

test("unreadable or missing storage never throws", () => {
  const storage = memoryStorage();
  storage.setItem(BATCH_REGISTRY_STORAGE_KEY, "{not json");
  assert.deepEqual(readStoredBatches({ storage }), []);
  assert.deepEqual(readStoredBatches({ storage: null }), []);
  assert.equal(rememberBatch(batch(), { storage: null }), true, "the batch still runs; only a reload would lose it");
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
  assert.deepEqual(readStoredBatches({ storage: throwing }), []);
  assert.equal(rememberBatch(batch(), { storage: throwing }), true);
});
