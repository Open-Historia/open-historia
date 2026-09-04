/*! Open Historia — idle deadline tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/idleDeadline.test.js
//
// Runs without node_modules: idleDeadline.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import { AI_FIRST_BYTE_TIMEOUT_MS, AI_IDLE_TIMEOUT_MS, createIdleDeadline } from "./idleDeadline.js";

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
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

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
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

  idle.note();
  timers.tick(AI_IDLE_TIMEOUT_MS - 1);
  assert.equal(expired, false, "must not fire early");
  timers.tick(1);
  assert.equal(expired, true);
});

// The buffered-endpoint guard, and the reason there are two windows at all. A
// response that does not stream sends its headers only when the whole answer is
// ready, and a local model evaluating a long prompt writes nothing for minutes —
// so the short window must not apply until something has actually arrived.
test("before the first byte the long window applies, not the short one", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

  idle.start();
  timers.tick(AI_IDLE_TIMEOUT_MS * 2);
  assert.equal(expired, false, "prompt evaluation must not be mistaken for a stall");

  // Now the model starts writing: the short window takes over from here.
  idle.note();
  timers.tick(AI_IDLE_TIMEOUT_MS - 1);
  assert.equal(expired, false);
  timers.tick(1);
  assert.equal(expired, true);
});

// The gap the first version left open: an endpoint that accepts the request and
// then answers nothing at all was never caught, so the turn hung with no sign to
// the player.
test("a request that is never answered is caught by the long window", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

  idle.start();
  assert.equal(idle.armed, true, "it must arm on send, not only on the first byte");
  timers.tick(AI_FIRST_BYTE_TIMEOUT_MS - 1);
  assert.equal(expired, false, "must not fire early");
  timers.tick(1);
  assert.equal(expired, true);
});

// A retry re-sends the whole prompt, so it gets the long window back rather than
// inheriting the short one the first attempt's tokens left behind.
test("each attempt gets the long window again", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

  idle.start();
  idle.note();          // attempt 1 answered
  idle.cancel();        // ...and was validated
  idle.start();         // attempt 2 goes out
  timers.tick(AI_IDLE_TIMEOUT_MS * 2);
  assert.equal(expired, false, "attempt 2's prompt evaluation must get the long window");
});

test("nothing fires before the task has started", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

  assert.equal(idle.armed, false);
  assert.equal(idle.deadline, null);
  timers.tick(AI_FIRST_BYTE_TIMEOUT_MS * 3);
  assert.equal(expired, false);
});

// The setting off — the shape must still be callable so no caller has to branch.
test("a zero window is inert in every direction", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline({ idleMs: 0, firstByteMs: 0 }, () => { expired = true; });

  idle.start();
  idle.note();
  assert.equal(idle.armed, false);
  assert.equal(idle.deadline, null);
  timers.tick(AI_FIRST_BYTE_TIMEOUT_MS * 10);
  assert.equal(expired, false);
  idle.cancel();
});

test("a finished task stops its timer", (t) => {
  const timers = withTimers(t);
  let expired = false;
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expired = true; });

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
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => { expirations += 1; });

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
  const idle = createIdleDeadline({ idleMs: AI_IDLE_TIMEOUT_MS, firstByteMs: AI_FIRST_BYTE_TIMEOUT_MS }, () => {});

  idle.note();
  const first = idle.deadline;
  timers.tick(60000);
  idle.note();
  assert.equal(idle.deadline, first + 60000);
});
