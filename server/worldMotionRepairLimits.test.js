import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTI_STASIS_MIN_MOMENTUM_DELTA,
  ANTI_STASIS_MIN_PRESSURE_DELTA,
  MAX_MOTION_REPAIRS_PER_JUMP,
  MAX_MOTION_REPAIR_MS_PER_JUMP,
  MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS,
  createMotionRepairBudget,
  findWorldStorylineAntiStasisIssues,
  motionRepairSkipReason,
  recordMotionRepairAttempt,
  recordMotionRepairOutcome,
  storylineAtAntiStasisBackstop,
  storylineRepairFingerprint,
  validateWorldStorylinePayload,
} from "../src/Game/AI/nativeWorldDirector.js";

// Active, high-pressure, and 82 days without a visible milestone at the stop
// date: past the 45-day anti-stasis backstop.
const stalled = {
  id: "storyline-motion-limits",
  kind: "war",
  title: "Motion Limits War",
  participants: ["Poland", "Russian Empire"],
  status: "active",
  pressure: 78,
  momentum: 20,
  startedDate: "1916-01-01",
  accountedThroughDate: "1916-06-11",
  lastUpdatedDate: "1916-06-11",
  lastVisibleEventDate: "1916-04-20",
  nextReviewDate: "1916-09-01",
  state: "A high-pressure stalemate remains unchanged.",
};
const ORIGIN = "1916-06-11";
const STOP = "1916-07-11";

const issueFor = (id, prior = { ...stalled, id }) => ({ id, prior, kind: "missing-update" });
const ids = (count, prefix = "storyline-") => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

// Runs one segment's repairs the way repairAntiStasisStorylines does.
const runSegment = (issueIds, { budget, failures = null, campaignId = "c1", round = 1, ms = 1000 }) => {
  const attempted = [];
  const skipped = [];
  for (const id of issueIds) {
    const issue = issueFor(id);
    const reason = motionRepairSkipReason(issue, { budget, failures, campaignId, round });
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    recordMotionRepairAttempt(budget, id, ms);
    attempted.push(id);
  }
  return { attempted, skipped };
};

test("a storyline is repaired at most once per skip", () => {
  const budget = createMotionRepairBudget();
  const first = runSegment(["storyline-a"], { budget });
  const second = runSegment(["storyline-a"], { budget });
  assert.deepEqual(first.attempted, ["storyline-a"]);
  assert.deepEqual(second.skipped, [{ id: "storyline-a", reason: "already-attempted-this-skip" }]);
});

test("a four-segment skip flagging the same storylines makes one round of calls, not four", () => {
  const budget = createMotionRepairBudget();
  const flagged = ids(MAX_MOTION_REPAIRS_PER_JUMP);
  let calls = 0;
  for (let segment = 0; segment < 4; segment += 1) {
    // A storyline first flagged in segment 3 arrives after the cap is spent.
    const segmentIds = segment === 2 ? [...flagged, "storyline-new"] : flagged;
    const { attempted, skipped } = runSegment(segmentIds, { budget });
    calls += attempted.length;
    if (segment > 0) {
      assert.ok(skipped.filter((entry) => flagged.includes(entry.id)).every((entry) => entry.reason === "already-attempted-this-skip"));
    }
    if (segment === 2) {
      assert.deepEqual(skipped.find((entry) => entry.id === "storyline-new"), { id: "storyline-new", reason: "call-cap" });
    }
  }
  assert.equal(calls, MAX_MOTION_REPAIRS_PER_JUMP);
  assert.equal(budget.calls, MAX_MOTION_REPAIRS_PER_JUMP);
});

test("no new repair starts once the skip's repair time is spent", () => {
  const budget = createMotionRepairBudget();
  recordMotionRepairAttempt(budget, "storyline-slow", MAX_MOTION_REPAIR_MS_PER_JUMP);
  assert.equal(motionRepairSkipReason(issueFor("storyline-next"), { budget }), "time-budget");
});

test("a failed repair waits out its cooldown unless the storyline changes", () => {
  const failures = new Map();
  const issue = issueFor(stalled.id, stalled);
  const fingerprint = storylineRepairFingerprint(stalled);
  recordMotionRepairOutcome(failures, { campaignId: "c1", id: stalled.id, fingerprint, round: 10, ok: false });

  const reasonAt = (round, extra = {}) =>
    motionRepairSkipReason({ ...issue, ...extra }, { budget: createMotionRepairBudget(), failures, campaignId: "c1", round });

  assert.equal(reasonAt(11), "failed-recently");
  assert.equal(reasonAt(10 + MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS - 1), "failed-recently");
  assert.equal(reasonAt(10 + MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS), "");

  // A newly linked event moves the storyline, so it is eligible at once.
  assert.equal(reasonAt(11, { prior: { ...stalled, lastVisibleEventDate: "1916-07-01" } }), "");

  // Another campaign never inherits the failure.
  assert.equal(
    motionRepairSkipReason(issue, { budget: createMotionRepairBudget(), failures, campaignId: "c2", round: 11 }),
    "",
  );

  recordMotionRepairOutcome(failures, { campaignId: "c1", id: stalled.id, fingerprint, round: 11, ok: true });
  assert.equal(reasonAt(11), "");
  assert.equal(failures.size, 0);
});

test("the failure memory stays bounded and drops the oldest entry first", () => {
  const failures = new Map();
  for (const id of ids(100)) {
    recordMotionRepairOutcome(failures, { campaignId: "c1", id, fingerprint: "f", round: 1, ok: false });
  }
  assert.equal(failures.size, 64);
  assert.equal(failures.has("c1::storyline-1"), false);
  assert.equal(failures.has("c1::storyline-100"), true);
});

test("issues say when the repair must move the numbers", () => {
  assert.equal(storylineAtAntiStasisBackstop(stalled, STOP), true);

  // Due for review this pass (so its omission is an issue), but below the
  // high-pressure line, so the backstop's numeric rule does not apply.
  const quiet = {
    ...stalled,
    id: "storyline-quiet",
    kind: "politics",
    title: "Quiet Politics",
    pressure: 40,
    nextReviewDate: "1916-07-01",
  };
  const recentlyVisible = { ...stalled, id: "storyline-visible", title: "Visible War", lastVisibleEventDate: "1916-07-01" };
  assert.equal(storylineAtAntiStasisBackstop(quiet, STOP), false);
  assert.equal(storylineAtAntiStasisBackstop(recentlyVisible, STOP), false);

  const issues = findWorldStorylineAntiStasisIssues(
    { events: [], storylineUpdates: [] },
    {
      existingStorylines: [stalled, quiet],
      selectedStorylines: [stalled, quiet],
      originDate: ORIGIN,
      stopDate: STOP,
    },
  );
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  assert.equal(byId.get(stalled.id)?.requiresObjectiveDelta, true);
  assert.equal(byId.get(quiet.id)?.requiresObjectiveDelta, false);
});

test("the numbers the repair prompt states are exactly what the validator accepts", () => {
  const validate = (changes) =>
    validateWorldStorylinePayload(
      { events: [], storylineUpdates: [{ ...stalled, eventIndexes: [], ...changes }] },
      {
        existingStorylines: [stalled],
        selectedStorylines: [stalled],
        deferredStorylines: [],
        originDate: ORIGIN,
        stopDate: STOP,
        enforceAntiStasis: true,
      },
    );

  assert.equal(validate({ pressure: stalled.pressure + ANTI_STASIS_MIN_PRESSURE_DELTA, state: "Both armies dig in as reserves arrive." }), "");
  assert.equal(validate({ momentum: stalled.momentum + ANTI_STASIS_MIN_MOMENTUM_DELTA, state: "Command reshuffles quicken the front." }), "");
  assert.match(
    validate({ pressure: stalled.pressure + ANTI_STASIS_MIN_PRESSURE_DELTA - 1, state: "A reworded but numerically frozen stalemate." }),
    /anti-stasis backstop/,
  );
});
