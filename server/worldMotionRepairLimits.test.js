import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTI_STASIS_MIN_MOMENTUM_DELTA,
  ANTI_STASIS_MIN_PRESSURE_DELTA,
  MAX_MOTION_REPAIRS_PER_JUMP,
  MAX_MOTION_REPAIR_MS_PER_JUMP,
  MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS,
  createMotionRepairBudget,
  findSkipStorylineMotionIssues,
  findWorldStorylineAntiStasisIssues,
  mergeSkipAttentionStorylines,
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

// A four-segment, year-long skip: the case the per-segment check got wrong.
const SKIP_ORIGIN = "1916-06-11";
const SKIP_STOP = "1917-06-11";
const SEGMENTS = 4;
// Every segment of a skip selects the stalled storyline again.
const skipAttention = () => {
  let attention = [];
  for (let segment = 0; segment < SEGMENTS; segment += 1) {
    attention = mergeSkipAttentionStorylines(attention, [{ ...stalled }]);
  }
  return attention;
};
const skipIssues = (storylineUpdates, events = []) =>
  findSkipStorylineMotionIssues({
    events,
    storylineUpdates,
    existingStorylines: [stalled],
    selectedStorylines: skipAttention(),
    originDate: SKIP_ORIGIN,
    stopDate: SKIP_STOP,
  });

test("a storyline every segment selects is judged once for the whole skip", () => {
  assert.equal(skipAttention().length, 1);

  const issues = skipIssues([]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "missing-update");
});

test("movement in any segment counts for the whole skip", () => {
  // Segment 1 moves the storyline; segments 2-4 carry its new numbers forward.
  // Per segment, 2-4 each looked like a stalled copy-forward and paid a repair.
  const moved = { ...stalled, pressure: stalled.pressure + 5, state: "Reserves arrive on both sides." };
  const updates = Array.from({ length: SEGMENTS }, () => ({ ...moved, eventIndexes: [] }));
  assert.deepEqual(skipIssues(updates), []);
});

test("a skip that never moves a stalled storyline is flagged once, not once per segment", () => {
  const copyForward = Array.from({ length: SEGMENTS }, (_, segment) => ({
    ...stalled,
    state: `The stalemate holds (segment ${segment + 1}).`,
    eventIndexes: [],
  }));
  const issues = skipIssues(copyForward);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "anti-stasis");
  assert.equal(issues[0].requiresObjectiveDelta, true);
});

test("a visible development in a later segment counts, whatever that segment's own indexes said", () => {
  // Stalled (no visible milestone since January), high pressure: past the backstop.
  const korea = {
    id: "storyline-korean-peninsula-crisis",
    kind: "crisis",
    title: "Korean Peninsula Security Crisis",
    participants: ["Republic of Korea", "United States of America", "Democratic People's Republic of Korea"],
    status: "active",
    pressure: 72,
    momentum: 63,
    startedDate: "2019-08-14",
    accountedThroughDate: "2020-05-22",
    lastUpdatedDate: "2020-05-22",
    lastVisibleEventDate: "2020-01-05",
    nextReviewDate: "2020-06-01",
    state: "North Korean missile testing and allied military readiness sustain a dangerous regional confrontation.",
  };
  const filler = (date) => ({
    date,
    title: "Ghana Opens New Agricultural Export Terminal",
    description: "The terminal begins commercial operations.",
    storylineIds: [],
  });
  const noImpacts = { actionIds: [], createdChats: [], markerOps: [], polityChanges: [], regionClaims: [], regionTransfers: [], unitOps: [] };
  // Segment 2's standoff, already tagged by its segment's screen. It is event 3
  // of the skip but event 0 of its own segment.
  const standoff = {
    date: "2020-09-05",
    importance: "major",
    kind: "military",
    title: "Naval Standoff in the Yellow Sea Heightens Korean Peninsula Tensions",
    description:
      "North Korean patrol vessels cross the Northern Limit Line, prompting an immediate tactical deployment of Republic of Korea naval forces and allied reconnaissance aircraft before the vessels withdraw after tense maneuvering.",
    storylineIds: [korea.id],
    impacts: noImpacts,
  };
  const events = [filler("2020-06-10"), filler("2020-07-10"), filler("2020-08-10"), standoff];
  const updates = [
    { ...korea, eventIndexes: [] },
    { ...korea, eventIndexes: [0] }, // segment-local: 0 is the filler, skip-wide
  ];

  const issues = findSkipStorylineMotionIssues({
    events,
    storylineUpdates: updates,
    existingStorylines: [korea],
    selectedStorylines: [korea],
    originDate: "2020-05-22",
    stopDate: "2020-11-22",
    world: {},
  });
  assert.deepEqual(issues, []);
});

test("a skip makes at most the capped number of repair calls", () => {
  const budget = createMotionRepairBudget();
  const reasons = ids(MAX_MOTION_REPAIRS_PER_JUMP + 1).map((id) => {
    const reason = motionRepairSkipReason(issueFor(id), { budget });
    if (!reason) recordMotionRepairAttempt(budget, 1000);
    return reason;
  });
  assert.equal(reasons.filter((reason) => reason === "").length, MAX_MOTION_REPAIRS_PER_JUMP);
  assert.equal(reasons.at(-1), "call-cap");
});

test("no new repair starts once the skip's repair time is spent", () => {
  const budget = createMotionRepairBudget();
  recordMotionRepairAttempt(budget, MAX_MOTION_REPAIR_MS_PER_JUMP);
  assert.equal(motionRepairSkipReason(issueFor("storyline-next"), { budget }), "time-budget");
});

test("a failed repair waits out its cooldown unless the storyline changes", () => {
  const failures = new Map();
  const issue = issueFor(stalled.id, stalled);
  const fingerprint = storylineRepairFingerprint(stalled);
  recordMotionRepairOutcome(failures, { campaignId: "c1", id: stalled.id, fingerprint, round: 10, ok: false });

  const reasonAt = (round, extra = {}) =>
    motionRepairSkipReason({ ...issue, ...extra }, { budget: createMotionRepairBudget(), failures, campaignId: "c1", round });

  assert.equal(reasonAt(10), "failed-recently");
  assert.equal(reasonAt(11), "failed-recently");
  assert.equal(reasonAt(10 + MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS - 1), "failed-recently");
  assert.equal(reasonAt(10 + MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS), "");

  // A rewind (undo, or an older save of the campaign) to before the failure:
  // that failure is from a future that no longer exists, so it never blocks.
  assert.equal(reasonAt(9), "");
  assert.equal(reasonAt(4), "");

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
