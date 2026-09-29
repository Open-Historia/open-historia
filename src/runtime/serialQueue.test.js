/*! Open Historia — one job at a time tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/serialQueue.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createSerialQueue } from "./serialQueue.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

// A store written the way the Cheats map tools write the world: read, wait,
// write the whole thing back.
const makeStore = () => {
  const store = { owners: {} };
  const annex = async (regionId, owner) => {
    const read = { ...store.owners };
    await tick();
    await tick();
    store.owners = { ...read, [regionId]: owner };
  };
  return { store, annex };
};

test("unqueued, a second quick click writes over the first", async () => {
  const { store, annex } = makeStore();
  await Promise.all([annex("A", "France"), annex("B", "France")]);
  assert.deepEqual(store.owners, { B: "France" });
});

test("queued, both clicks land", async () => {
  const { store, annex } = makeStore();
  const enqueue = createSerialQueue();
  await Promise.all([enqueue(() => annex("A", "France")), enqueue(() => annex("B", "France"))]);
  assert.deepEqual(store.owners, { A: "France", B: "France" });
});

test("jobs run in order, and a failed one does not stop the next", async () => {
  const enqueue = createSerialQueue();
  const order = [];
  const failed = enqueue(async () => { await tick(); order.push(1); throw new Error("no"); });
  const next = enqueue(async () => { order.push(2); return "done"; });
  await assert.rejects(failed, /no/);
  assert.equal(await next, "done");
  assert.deepEqual(order, [1, 2]);
});
