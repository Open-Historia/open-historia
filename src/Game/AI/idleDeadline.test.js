/*! Open Historia — idle deadline tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/idleDeadline.test.js
//
// Runs without node_modules: idleDeadline.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import { AI_IDLE_TIMEOUT_MS, createIdleDeadline } from "./idleDeadline.js";

// Mock timers, because every case here is about when something fires and the
// windows are minutes long.
const withTimers = (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  return t.mock.timers;
};

// The case the whole design exists for: a model that keeps producing is never
// killed, no matter how long the turn takes in total. Before, five minutes of
// perfectly good generation was thrown away and replaced with canned events.
test("a model that keeps streaming is never cut off, however long it takes", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline(AI_IDLE_TIMEOUT_MS, () => { expired = true; });

  // Twenty minutes of generation, a token every two minutes.
  for (let minute = 0; minute < 20; minute += 2) {
    idle.note();
    timers.tick(120000);
  }

  assert.equal(expired, false);
});

test("silence after the last token expires the task", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline(AI_IDLE_TIMEOUT_MS, () => { expired = true; });

  idle.note();
  timers.tick(AI_IDLE_TIMEOUT_MS - 1);
  assert.equal(expired, false, "must not fire early");
  timers.tick(1);
  assert.equal(expired, true);
});

// The buffered-endpoint guard. A response that does not stream sends its
// headers only when the whole answer is ready, so counting silence before the
// first byte would kill the longest generations — the exact turns this protects.
test("nothing is counted until the first sign of life", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline(AI_IDLE_TIMEOUT_MS, () => { expired = true; });

  assert.equal(idle.armed, false);
  assert.equal(idle.deadline, null);
  timers.tick(AI_IDLE_TIMEOUT_MS * 10);
  assert.equal(expired, false, "an unarmed deadline must never fire");

  idle.note();
  assert.equal(idle.armed, true);
  timers.tick(AI_IDLE_TIMEOUT_MS);
  assert.equal(expired, true);
});

// The setting off — the shape must still be callable so no caller has to branch.
test("a zero window is inert in every direction", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline(0, () => { expired = true; });

  idle.note();
  assert.equal(idle.armed, false);
  assert.equal(idle.deadline, null);
  timers.tick(AI_IDLE_TIMEOUT_MS * 10);
  assert.equal(expired, false);
  idle.cancel();
});

test("a finished task stops its timer", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline(AI_IDLE_TIMEOUT_MS, () => { expired = true; });

  idle.note();
  idle.cancel();
  timers.tick(AI_IDLE_TIMEOUT_MS * 2);
  assert.equal(expired, false);
  assert.equal(idle.deadline, null);
});

// It aborts the task, so a second firing would abort whatever ran next.
test("it expires exactly once", (t) => {
  const timers = withTimers(t);
  let expirations = 0;
  const idle = createIdleDeadline(AI_IDLE_TIMEOUT_MS, () => { expirations += 1; });

  idle.note();
  timers.tick(AI_IDLE_TIMEOUT_MS);
  // A frame that arrives after the abort (the stream unwinding) must not re-arm.
  idle.note();
  timers.tick(AI_IDLE_TIMEOUT_MS * 3);
  assert.equal(expirations, 1);
});

// The providers' busy-retry logic reads this to decide whether a 15s wait fits.
test("the deadline moves forward with every token", (t) => {
  const timers = withTimers(t);
  const idle = createIdleDeadline(AI_IDLE_TIMEOUT_MS, () => {});

  idle.note();
  const first = idle.deadline;
  timers.tick(60000);
  idle.note();
  assert.equal(idle.deadline, first + 60000);
});
