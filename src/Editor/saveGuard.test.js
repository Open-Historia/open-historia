/*! Open Historia — the Workshop's save guard: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/saveGuard.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createSaveGate, mayReplaceDocument, retryDelayMs, MAX_SAVE_FAILURES } from "./saveGuard.js";

const spy = (result) => {
  const fn = async () => { fn.calls += 1; return result; };
  fn.calls = 0;
  return fn;
};
const ask = (answer) => {
  const fn = (reason) => { fn.reasons.push(reason); return answer; };
  fn.reasons = [];
  return fn;
};

test("a saved document is replaced without a save or a question", async () => {
  const save = spy(true), confirm = ask(false);
  assert.equal(await mayReplaceDocument({ getStatus: () => "saved", save, confirm }), true);
  assert.equal(save.calls, 0);
  assert.deepEqual(confirm.reasons, []);
});

test("dirty and error documents are saved first, and replaced only once that landed", async () => {
  for (const status of ["dirty", "error"]) {
    const save = spy(true), confirm = ask(false);
    assert.equal(await mayReplaceDocument({ getStatus: () => status, save, confirm }), true, status);
    assert.equal(save.calls, 1, status);
    assert.deepEqual(confirm.reasons, [], status);
  }
});

test("a failed save asks, and the answer decides", async () => {
  const kept = ask(false), dropped = ask(true);
  assert.equal(await mayReplaceDocument({ getStatus: () => "error", save: spy(false), confirm: kept }), false);
  assert.deepEqual(kept.reasons, ["failed"]);
  assert.equal(await mayReplaceDocument({ getStatus: () => "error", save: spy(false), confirm: dropped }), true);
});

test("a write still in flight is not raced: ask instead of saving again", async () => {
  const save = spy(true), confirm = ask(false);
  assert.equal(await mayReplaceDocument({ getStatus: () => "saving", save, confirm }), false);
  assert.equal(save.calls, 0);
  assert.deepEqual(confirm.reasons, ["saving"]);
});

test("an edit that lands during the save is asked about, not saved over", async () => {
  // The save lands, but the map is dirty again by then.
  let status = "dirty";
  const save = async () => { save.calls += 1; status = "dirty"; return false; };
  save.calls = 0;
  const confirm = ask(false);
  assert.equal(await mayReplaceDocument({ getStatus: () => status, save, confirm }), false);
  assert.equal(save.calls, 1);
  assert.deepEqual(confirm.reasons, ["edited"]);
});

test("the retry delay backs off from 2 s, stops growing at 30 s, and stops after the last allowed failure", () => {
  assert.equal(MAX_SAVE_FAILURES, 6);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs), [2000, 4000, 8000, 16000, 30000, null, null]);
});

// A write whose end the test decides.
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test("a second save while one is in flight joins it instead of writing again", async () => {
  const gate = createSaveGate();
  const landed = deferred();
  let writes = 0;
  const write = async () => { writes += 1; await landed.promise; return true; };
  const first = gate.run(write), second = gate.run(write);
  assert.equal(first, second);
  landed.resolve();
  assert.equal(await second, true);
  assert.equal(writes, 1);
  // Once it has landed the next save is a new write.
  assert.equal(await gate.run(write), true);
  assert.equal(writes, 2);
});

test("a save that outlives its document learns so, and the replacement saves on its own", async () => {
  const gate = createSaveGate();
  const oldLanded = deferred(), newLanded = deferred();
  const old = gate.run(async (isCurrent) => { await oldLanded.promise; return isCurrent(); });
  gate.replace();
  const fresh = gate.run(async (isCurrent) => { await newLanded.promise; return isCurrent(); });
  assert.notEqual(fresh, old);
  // The old write ending late answers "not current" and leaves the new one in flight.
  oldLanded.resolve();
  assert.equal(await old, false);
  assert.equal(gate.run(async () => false), fresh);
  newLanded.resolve();
  assert.equal(await fresh, true);
});

test("a failed write frees the gate for the retry", async () => {
  const gate = createSaveGate();
  await assert.rejects(gate.run(async () => { throw new Error("disk full"); }));
  assert.equal(await gate.run(async () => true), true);
});
