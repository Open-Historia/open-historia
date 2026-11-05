/*! Open Historia — sharing the Stats worker between jobs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/statsWorkerJobs.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { abandonWorkerJob, createWorkerFailureStreak } from "./statsWorkerJobs.js";

test("a cancelled job alone on the worker may stop it", () => {
  const pending = new Map([[1, "the sheet the player opened"]]);
  assert.equal(abandonWorkerJob(pending, 1), true);
  assert.equal(pending.size, 0);
});

test("a cancelled job leaves the worker running for a job still waiting on it", () => {
  // Brazil's first reading is saving its sheet when the player picks another
  // country: cancelling the pane's job must not take Brazil's with it.
  const pending = new Map([[1, "the pane's sheet"], [2, "Brazil's first reading"]]);
  assert.equal(abandonWorkerJob(pending, 1), false);
  assert.deepEqual([...pending.keys()], [2]);
});

test("a job cancelled before it was queued stops nothing that others still need", () => {
  const pending = new Map([[2, "Brazil's first reading"]]);
  assert.equal(abandonWorkerJob(pending, 7), false);
  assert.equal(pending.size, 1);
});

test("one failure does not set the worker aside for the session", () => {
  const streak = createWorkerFailureStreak(3);
  assert.equal(streak.failed(), false);
  assert.equal(streak.failed(), false);
  assert.equal(streak.failed(), true, "the third failure in a row does");
});

test("a success clears the streak", () => {
  const streak = createWorkerFailureStreak(3);
  streak.failed();
  streak.failed();
  streak.succeeded();
  assert.equal(streak.failed(), false);
  assert.equal(streak.failed(), false);
  assert.equal(streak.failed(), true);
});
