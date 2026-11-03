// Run: node --test src/runtime/nextTask.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nextTask } from "./nextTask.js";

test("it waits for a task of its own, after everything already queued as a microtask", async () => {
  const order = [];
  const waited = nextTask().then(() => order.push("task"));
  Promise.resolve().then(() => order.push("microtask"));
  await waited;
  assert.deepEqual(order, ["microtask", "task"]);
});

test("without MessageChannel it falls back to a timer", async () => {
  const real = globalThis.MessageChannel;
  globalThis.MessageChannel = undefined;
  try {
    await nextTask();
  } finally {
    globalThis.MessageChannel = real;
  }
});
