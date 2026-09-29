import test from "node:test";
import assert from "node:assert/strict";
import {
  createSaveRunner,
  isUnsavedStatus,
  saveRetryDelay,
  SAVE_RETRY_DELAYS_MS,
  settleUnsavedWork,
} from "./documentSaving.js";

// A save that finishes only when the test says so.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("a save asked for while one runs waits for it instead of writing beside it", async () => {
  const writes = [];
  const gates = [];
  let docId = null;
  const run = createSaveRunner(async () => {
    const gate = deferred();
    gates.push(gate);
    writes.push(docId ? `PUT ${docId}` : "POST");
    await gate.promise;
    docId = docId || "doc-1";
    return true;
  });

  const first = run();
  await Promise.resolve();
  const second = run();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(writes, ["POST"], "the second save must not start while the first is running");

  gates[0].resolve();
  assert.equal(await first, true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(writes, ["POST", "PUT doc-1"], "the follow-up uses the id the first save created");
  gates[1].resolve();
  assert.equal(await second, true);
});

test("many calls during one save make a single follow-up", async () => {
  let attempts = 0;
  const gate = deferred();
  const run = createSaveRunner(async () => {
    attempts += 1;
    if (attempts === 1) await gate.promise;
    return true;
  });
  const first = run();
  const others = [run(), run(), run()];
  assert.equal(others[0], others[1]);
  assert.equal(others[1], others[2]);
  gate.resolve();
  await first;
  await Promise.all(others);
  assert.equal(attempts, 2);
});

test("a failed save does not stop the follow-up, and the runner is free afterwards", async () => {
  let attempts = 0;
  const run = createSaveRunner(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("disk full");
    return true;
  });
  const first = run();
  const second = run();
  await assert.rejects(first, /disk full/);
  assert.equal(await second, true);
  assert.equal(await run(), true);
  assert.equal(attempts, 3);
});

test("idle waits for the running save and the one queued behind it", async () => {
  const gates = [deferred(), deferred()];
  let attempts = 0;
  const run = createSaveRunner(async () => {
    await gates[attempts++].promise;
    return true;
  });
  await run.idle();
  run();
  run().catch(() => {});
  let idle = false;
  const waiting = run.idle().then(() => { idle = true; });
  gates[0].resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(idle, false, "the queued save is still to come");
  gates[1].reject(new Error("failed"));
  await waiting;
  assert.equal(idle, true);
  assert.equal(attempts, 2);
});

test("automatic retries wait 5 s, 15 s and 60 s, then stop", () => {
  assert.deepEqual(SAVE_RETRY_DELAYS_MS, [5000, 15000, 60000]);
  assert.equal(saveRetryDelay(0), 5000);
  assert.equal(saveRetryDelay(1), 15000);
  assert.equal(saveRetryDelay(2), 60000);
  assert.equal(saveRetryDelay(3), null);
});

test("a failed save counts as unsaved work", () => {
  assert.equal(isUnsavedStatus("saved"), false);
  assert.equal(isUnsavedStatus("dirty"), true);
  assert.equal(isUnsavedStatus("saving"), true);
  assert.equal(isUnsavedStatus("error"), true);
});

test("closing a saved map neither saves nor asks", async () => {
  let saves = 0;
  let asked = 0;
  const ok = await settleUnsavedWork({
    status: "saved",
    save: async () => { saves += 1; return true; },
    confirm: () => { asked += 1; return false; },
    question: "lose them?",
  });
  assert.equal(ok, true);
  assert.equal(saves, 0);
  assert.equal(asked, 0);
});

test("pending edits are saved first and a save that lands asks nothing", async () => {
  for (const status of ["dirty", "saving", "error"]) {
    let asked = 0;
    const ok = await settleUnsavedWork({
      status,
      save: async () => true,
      confirm: () => { asked += 1; return false; },
      question: "lose them?",
    });
    assert.equal(ok, true, status);
    assert.equal(asked, 0, status);
  }
});

test("a save that does not land asks, and Cancel keeps the map", async () => {
  const questions = [];
  const stay = await settleUnsavedWork({
    status: "dirty",
    save: async () => false,
    confirm: (q) => { questions.push(q); return false; },
    question: "This map has changes that could not be saved. Close it and lose them?",
  });
  assert.equal(stay, false);
  assert.deepEqual(questions, ["This map has changes that could not be saved. Close it and lose them?"]);

  const leave = await settleUnsavedWork({
    status: "error",
    save: async () => false,
    confirm: () => true,
    question: "q",
  });
  assert.equal(leave, true);
});
