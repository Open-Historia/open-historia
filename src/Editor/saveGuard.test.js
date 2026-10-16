/*! Open Historia — the Workshop's save guard: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/saveGuard.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { mayReplaceDocument, retryDelayMs } from "./saveGuard.js";

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
  assert.equal(await mayReplaceDocument({ status: "saved", save, confirm }), true);
  assert.equal(save.calls, 0);
  assert.deepEqual(confirm.reasons, []);
});

test("dirty and error documents are saved first, and replaced only once that landed", async () => {
  for (const status of ["dirty", "error"]) {
    const save = spy(true), confirm = ask(false);
    assert.equal(await mayReplaceDocument({ status, save, confirm }), true, status);
    assert.equal(save.calls, 1, status);
    assert.deepEqual(confirm.reasons, [], status);
  }
});

test("a failed save asks, and the answer decides", async () => {
  const kept = ask(false), dropped = ask(true);
  assert.equal(await mayReplaceDocument({ status: "error", save: spy(false), confirm: kept }), false);
  assert.deepEqual(kept.reasons, ["failed"]);
  assert.equal(await mayReplaceDocument({ status: "dirty", save: spy(false), confirm: dropped }), true);
});

test("a write still in flight is not raced: ask instead of saving again", async () => {
  const save = spy(true), confirm = ask(false);
  assert.equal(await mayReplaceDocument({ status: "saving", save, confirm }), false);
  assert.equal(save.calls, 0);
  assert.deepEqual(confirm.reasons, ["saving"]);
});

test("the retry delay backs off from 2 s and stops growing at 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
