/*! Open Historia — bounded world-repair call tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/repairCall.test.js
//
// Runs without node_modules: repairCall.js imports only idleDeadline.js, which
// imports nothing.
//
// The case this file exists for: the motion repair's per-skip time budget was
// only checked before a repair STARTED. The last repair of a pass could then run
// a whole idle window past it — and for ever if the model kept trickling
// tokens, because every token re-arms the idle window.

import test from "node:test";
import assert from "node:assert/strict";
import {
  REPAIR_STOP_STALLED,
  REPAIR_STOP_TIME_BUDGET,
  runBoundedRepairCall,
} from "./repairCall.js";

// Production values, so every case reads in the units a bug report would use.
const IDLE_MS = 300000;
const FIRST_BYTE_MS = 900000;
const BUDGET_MS = 600000;
const limits = { taskKey: "worldMotionRepair", idleMs: IDLE_MS, firstByteMs: FIRST_BYTE_MS };

// Mock timers: every case is about when something fires, and the windows are
// minutes long.
const withTimers = (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  return t.mock.timers;
};
// Mock time in steps. A timer armed by a callback during one long tick is
// scheduled from the END of that tick on some Node versions, which would skip
// every token in between; stepping keeps each one where it belongs.
const advance = (timers, totalMs, stepMs) => {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    timers.tick(Math.min(stepMs, totalMs - elapsed));
  }
};
// setImmediate is left real, so this lets every settled promise run.
const flush = () => new Promise((resolve) => globalThis.setImmediate(resolve));

const track = (promise) => {
  const state = { settled: false, value: undefined, error: undefined };
  promise.then(
    (value) => { state.settled = true; state.value = value; },
    (error) => { state.settled = true; state.error = error; },
  );
  return state;
};

// A provider call that never answers by itself. It reports activity every
// `trickleMs` (0 = total silence) and rejects the way fetch does when aborted.
const endlessCall = (trickleMs = 0, seen = {}) => ({ signal, deadline, onActivity }) => {
  seen.signal = signal;
  seen.deadline = deadline;
  seen.calls = (seen.calls ?? 0) + 1;
  return new Promise((resolve, reject) => {
    let timer = null;
    const drip = () => {
      onActivity();
      timer = setTimeout(drip, trickleMs);
    };
    if (trickleMs > 0) timer = setTimeout(drip, trickleMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("This operation was aborted", "AbortError"));
    }, { once: true });
  });
};

test("a repair that keeps trickling tokens is still stopped when the repair time runs out", async (t) => {
  const timers = withTimers(t);
  const run = track(runBoundedRepairCall(endlessCall(60000), { ...limits, hardLimitMs: BUDGET_MS }));

  // A token every minute: the idle window never expires on its own.
  advance(timers, BUDGET_MS - 1, 60000);
  await flush();
  assert.equal(run.settled, false, "stopped before the budget was spent");

  timers.tick(1);
  await flush();
  assert.equal(run.settled, true, "still running once the budget was spent");
  assert.equal(run.error?.repairStop, REPAIR_STOP_TIME_BUDGET);
});

test("with no time limit the same stream is never cut off, as idleDeadline.js intends", async (t) => {
  const timers = withTimers(t);
  const player = new AbortController();
  const run = track(runBoundedRepairCall(endlessCall(60000), { ...limits, signal: player.signal }));

  advance(timers, 2 * 60 * 60 * 1000, 60000); // two hours of a token a minute
  await flush();
  assert.equal(run.settled, false);

  player.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
  await flush();
  assert.equal(run.settled, true);
  assert.equal(run.error?.repairStop, undefined, "a Cancel is not a repair stop");
});

test("no answer at all is stopped at the first-byte window", async (t) => {
  const timers = withTimers(t);
  const run = track(runBoundedRepairCall(endlessCall(0), limits));

  timers.tick(FIRST_BYTE_MS - 1);
  await flush();
  assert.equal(run.settled, false);

  timers.tick(1);
  await flush();
  assert.equal(run.error?.repairStop, REPAIR_STOP_STALLED);
});

test("silence after an answer has started is a stall, even with repair time left", async (t) => {
  const timers = withTimers(t);
  const quietAfterOneToken = ({ signal, onActivity }) =>
    new Promise((resolve, reject) => {
      setTimeout(() => onActivity(), 1000);
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  // The budget would stop it at ten minutes; the stall is caught first.
  const run = track(runBoundedRepairCall(quietAfterOneToken, { ...limits, hardLimitMs: BUDGET_MS }));

  timers.tick(1000); // the one token
  timers.tick(IDLE_MS - 1);
  await flush();
  assert.equal(run.settled, false);

  timers.tick(1);
  await flush();
  assert.equal(run.error?.repairStop, REPAIR_STOP_STALLED);
});

test("the player's Cancel wins over the repair's own limits", async (t) => {
  const timers = withTimers(t);
  const player = new AbortController();
  const run = track(runBoundedRepairCall(endlessCall(0), { ...limits, signal: player.signal, hardLimitMs: BUDGET_MS }));

  timers.tick(1000);
  player.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
  await flush();
  assert.equal(run.settled, true);
  assert.equal(run.error?.name, "AbortError");
  assert.equal(run.error?.repairStop, undefined);
});

test("a provider that answers the stop with what it had so far is still stopped", async (t) => {
  const timers = withTimers(t);
  const answersAbortWithPartial = ({ signal }) =>
    new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve('{"storylineUpdate": {"id": "storyline-'), { once: true });
    });
  const run = track(runBoundedRepairCall(answersAbortWithPartial, { ...limits, hardLimitMs: BUDGET_MS }));

  timers.tick(BUDGET_MS);
  await flush();
  assert.equal(run.value, undefined, "the cut-off answer was passed on as a repair");
  assert.equal(run.error?.repairStop, REPAIR_STOP_TIME_BUDGET);
});

test("an answer comes back as-is, and nothing is left running behind it", async (t) => {
  const timers = withTimers(t);
  const seen = {};
  const answersAfterFiveSeconds = ({ signal }) => {
    seen.signal = signal;
    return new Promise((resolve) => setTimeout(() => resolve("the repaired storyline"), 5000));
  };
  const run = track(runBoundedRepairCall(answersAfterFiveSeconds, { ...limits, hardLimitMs: BUDGET_MS }));

  timers.tick(5000);
  await flush();
  assert.equal(run.value, "the repaired storyline");

  // Every limit is long past. Had any timer survived the answer, it would have
  // aborted this signal.
  timers.tick(FIRST_BYTE_MS + BUDGET_MS);
  await flush();
  assert.equal(seen.signal.aborted, false);
});

test("a pass with no time left calls nothing", async () => {
  const seen = {};
  await assert.rejects(
    runBoundedRepairCall(endlessCall(0, seen), { ...limits, hardLimitMs: 0 }),
    (error) => error.repairStop === REPAIR_STOP_TIME_BUDGET,
  );
  assert.equal(seen.calls, undefined, "the provider was called anyway");
});

test("the provider is told the earlier deadline, so a busy-retry cannot sleep past either limit", async (t) => {
  withTimers(t);
  const player = new AbortController();
  const limited = {};
  const open = {};
  runBoundedRepairCall(endlessCall(0, limited), { ...limits, signal: player.signal, hardLimitMs: 60000 }).catch(() => {});
  runBoundedRepairCall(endlessCall(0, open), { ...limits, signal: player.signal }).catch(() => {});

  assert.equal(limited.deadline, Date.now() + 60000, "the time budget ends first");
  assert.equal(open.deadline, Date.now() + FIRST_BYTE_MS, "no budget: the first-byte window");

  player.abort(new DOMException("done", "AbortError"));
  await flush();
});
