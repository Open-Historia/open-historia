import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTI_STASIS_MIN_MOMENTUM_DELTA,
  ANTI_STASIS_MIN_PRESSURE_DELTA,
  MAX_MOTION_REPAIRS_PER_JUMP,
  MAX_MOTION_REPAIR_MS_PER_JUMP,
  MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS,
  applyWorldStorylineUpdates,
  buildWorldInitiativeContext,
  createMotionRepairBudget,
  describeAntiStasisObjectiveRule,
  findSkipStorylineMotionIssues,
  findWorldStorylineAntiStasisIssues,
  mergeSkipAttentionStorylines,
  motionRepairSkipReason,
  motionRepairTimeRemainingMs,
  recordMotionRepairAttempt,
  recordMotionRepairOutcome,
  settleMotionRepairCall,
  settleSkipStorylineUpdates,
  storylineAtAntiStasisBackstop,
  storylineRepairFingerprint,
  validateWorldStorylinePayload,
} from "../src/Game/AI/nativeWorldDirector.js";
import { mergeSegmentPayloads } from "../src/Game/AI/jumpSegments.js";

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

// ---- What every prompt says about the backstop ------------------------------
// The main pass is the only way out of the repair cooldown, so it must be told
// the rule the validator enforces — for every storyline that rule applies to.

// Below the high-pressure line, 82 days past a visible milestone at STOP: at the
// backstop only because it is an active war.
const westernFront = {
  ...stalled,
  id: "storyline-w-western-front",
  title: "Western Front Deadlock",
  participants: ["France", "German Empire"],
  pressure: 30,
  nextReviewDate: "1916-06-01",
};
const balkanCrisis = {
  ...stalled,
  id: "storyline-balkan-crisis",
  kind: "crisis",
  title: "Balkan Crisis",
  participants: ["Bulgaria", "Serbia"],
  nextReviewDate: "1916-06-01",
};
const directorBundle = () => {
  const actors = ["France", "German Empire", "Bulgaria", "Serbia"];
  return {
    game: { country: "France", gameDate: ORIGIN, round: 20 },
    events: [],
    chats: [],
    world: {
      polityOverrides: Object.fromEntries(actors.map((name) => [name, { name, code: name, aliases: [name], status: "active" }])),
      countryStats: Object.fromEntries(actors.map((name) => [name, {}])),
      regionOwnershipOverrides: Object.fromEntries(actors.map((name, index) => [String(index + 1), name])),
      regionClaimants: {},
      storylines: [westernFront, balkanCrisis],
      wars: [{
        id: "w-western-front",
        title: "Western Front",
        status: "active",
        sideA: ["France"],
        sideB: ["German Empire"],
        startedDate: "1914-08-03",
      }],
      relations: [],
      agreements: [],
      units: [],
      consolidatedHistory: [],
    },
  };
};
const mainPassText = () => buildWorldInitiativeContext(directorBundle(), { targetDate: STOP }).text;
// A storyline's entry in the main pass's attention list: its header line and
// the indented detail lines under it.
const attentionEntry = (text, id) => {
  const lines = String(text).split("\n");
  const list = lines.slice(
    lines.indexOf("PERSISTENT STORYLINE ATTENTION"),
    lines.indexOf("DEFERRED PERSISTED STORYLINES — LOW ATTENTION, NOT FROZEN"),
  );
  const start = list.findIndex((line) => /^\d+\. \[/.test(line) && line.includes(`[${id} |`));
  if (start < 0) return "";
  const entry = [list[start]];
  for (let index = start + 1; index < list.length && list[index].startsWith("   "); index += 1) entry.push(list[index]);
  return entry.join("\n");
};

test("the backstop rule names the validator's own numbers", () => {
  const rule = describeAntiStasisObjectiveRule();
  assert.ok(rule.includes(`pressure by ${ANTI_STASIS_MIN_PRESSURE_DELTA} or more points`), rule);
  assert.ok(rule.includes(`momentum by ${ANTI_STASIS_MIN_MOMENTUM_DELTA} or more points`), rule);
  assert.match(rule, /change status/);
  assert.match(rule, /link a material event/);
  // The repair may not manufacture an event, so its prompt leaves that way out.
  assert.doesNotMatch(describeAntiStasisObjectiveRule({ withEvent: false }), /event/);
});

test("the main pass warns every storyline the backstop holds, active wars below the pressure line included", () => {
  const { world } = directorBundle();
  assert.equal(storylineAtAntiStasisBackstop(westernFront, STOP), false, "below the high-pressure line on its own");
  assert.equal(storylineAtAntiStasisBackstop(westernFront, STOP, world), true, "at the backstop because it is an active war");

  const text = mainPassText();
  for (const [storyline, subject] of [
    [westernFront, "active war"],
    [balkanCrisis, "active high-pressure process"],
  ]) {
    const entry = attentionEntry(text, storyline.id);
    assert.ok(entry, `${storyline.id} is not in the attention list`);
    assert.match(entry, new RegExp(`ANTI-STASIS BACKSTOP: this ${subject} reaches`));
    assert.ok(entry.includes(describeAntiStasisObjectiveRule()), `${storyline.id} is not told the numbers:\n${entry}`);
  }
});

test("the main pass's general rule states the numbers and offers no way out the validator rejects", () => {
  const general = mainPassText().split("\n").find((line) => line.includes("anti-stasis rule, NOT an event quota")) ?? "";
  assert.ok(general.includes(describeAntiStasisObjectiveRule()), general);
  // A "genuinely different hidden state" in prose alone is exactly what the
  // validator rejects; it may only count through the numbers.
  assert.doesNotMatch(general, /reflected in those fields/);
});

test("the validator's rejection tells the model the same numbers", () => {
  const message = validateWorldStorylinePayload(
    { events: [], storylineUpdates: [{ ...stalled, eventIndexes: [], state: "A reworded but numerically frozen stalemate." }] },
    {
      existingStorylines: [stalled],
      selectedStorylines: [stalled],
      deferredStorylines: [],
      originDate: ORIGIN,
      stopDate: STOP,
      enforceAntiStasis: true,
    },
  );
  assert.match(message, /anti-stasis backstop/);
  assert.ok(message.includes(describeAntiStasisObjectiveRule()), message);
});

// ---- The time budget is a cap on the pass -----------------------------------

test("each repair may run only for what is left of the skip's repair time", () => {
  const budget = createMotionRepairBudget();
  assert.equal(motionRepairTimeRemainingMs(budget), MAX_MOTION_REPAIR_MS_PER_JUMP);

  recordMotionRepairAttempt(budget, 240000);
  assert.equal(motionRepairTimeRemainingMs(budget), MAX_MOTION_REPAIR_MS_PER_JUMP - 240000);

  // The call is stopped at what was left, so the pass ends on its budget.
  recordMotionRepairAttempt(budget, MAX_MOTION_REPAIR_MS_PER_JUMP - 240000);
  assert.equal(motionRepairTimeRemainingMs(budget), 0);
  assert.equal(motionRepairSkipReason(issueFor("storyline-next"), { budget }), "time-budget");

  // A timer firing a little late never turns into a negative limit.
  recordMotionRepairAttempt(budget, 50);
  assert.equal(motionRepairTimeRemainingMs(budget), 0);
});

test("a repair stopped when the pass ran out of time starts no cooldown", () => {
  const failures = new Map();
  const budget = createMotionRepairBudget();
  const issue = issueFor(stalled.id, stalled);
  const pass = { budget, failures, campaignId: "c1", round: 10 };
  const nextSkip = () =>
    motionRepairSkipReason(issue, { budget: createMotionRepairBudget(), failures, campaignId: "c1", round: 11 });

  assert.equal(
    settleMotionRepairCall(issue, { ...pass, ms: 250000, ok: false, stoppedAtTimeBudget: true }),
    "stopped-at-time-budget",
  );
  assert.equal(budget.calls, 1);
  assert.equal(budget.ms, 250000, "its time still counts against the skip");
  assert.equal(nextSkip(), "", "the next skip may try it again");

  // A repair that failed on its own does wait out the cooldown...
  assert.equal(settleMotionRepairCall(issue, { ...pass, ms: 1000, ok: false }), "failed");
  assert.equal(nextSkip(), "failed-recently");

  // ...and one that answers clears it.
  assert.equal(settleMotionRepairCall(issue, { ...pass, ms: 1000, ok: true }), "repaired");
  assert.equal(nextSkip(), "");
  assert.equal(budget.calls, 3);
});

// ---- Writing the pass back into the skip ------------------------------------

const bornInSkip = {
  ...stalled,
  id: "storyline-born-in-skip",
  kind: "crisis",
  title: "Polish Regency Crisis",
  participants: ["Poland", "German Empire"],
  pressure: 60,
  momentum: 40,
  startedDate: "1916-11-05",
  lastVisibleEventDate: "1916-11-05",
  state: "The Central Powers' proclamation of a Polish regency opens a contest over recruitment and loyalty.",
};
const copyForward = (storyline, segment) => ({
  ...storyline,
  state: `${storyline.state} (segment ${segment})`,
  eventIndexes: [],
});

test("settling withdraws a pre-skip storyline's copy-forwards and puts its repair last", () => {
  const untouched = { ...stalled, id: "storyline-untouched", title: "Untouched War", participants: ["Italy", "Austria-Hungary"] };
  const segments = [
    [copyForward(stalled, 1), copyForward(untouched, 1)],
    [copyForward(bornInSkip, 2)],
    [copyForward(stalled, 3)],
  ];
  const repair = {
    ...stalled,
    pressure: stalled.pressure + ANTI_STASIS_MIN_PRESSURE_DELTA,
    state: "Reserves arrive on both sides.",
    eventIndexes: [],
  };

  const settled = settleSkipStorylineUpdates(segments, {
    settledIds: new Set([stalled.id, bornInSkip.id]),
    preSkipIds: [stalled.id, untouched.id],
    repairedUpdates: [repair],
  });

  assert.deepEqual(
    settled.map((updates) => updates.map((entry) => entry.id)),
    [[untouched.id], [bornInSkip.id], [stalled.id]],
  );
  assert.equal(settled[2][0].state, repair.state, "the last word on the storyline is its repair");
  // Settled, but born in the skip: withdrawing it would erase it, so its
  // segment is left exactly as it was.
  assert.equal(settled[1], segments[1]);
});

test("settling with nothing settled or repaired leaves every segment exactly as it was", () => {
  const segments = [[copyForward(stalled, 1)], [], [copyForward(bornInSkip, 3)]];
  const settled = settleSkipStorylineUpdates(segments, { settledIds: [], preSkipIds: [stalled.id] });
  assert.equal(settled.length, segments.length);
  settled.forEach((updates, index) => assert.equal(updates, segments[index]));
});

test("after a skip, a failed storyline stays overdue, a repaired one ends on its repair, and one born in the skip survives", () => {
  const failed = { ...stalled, id: "storyline-repair-failed", title: "Carpathian Deadlock", participants: ["Romania", "Bulgaria"] };
  const repaired = { ...stalled, id: "storyline-repaired", title: "Isonzo Deadlock", participants: ["Italy", "Austria-Hungary"] };
  const before = { storylines: [failed, repaired] };
  const regency = {
    id: "event-polish-regency",
    date: "1916-11-05",
    title: "Central Powers Proclaim a Polish Regency",
    description: "Berlin and Vienna announce a Polish kingdom under their protection and open recruitment for a Polish army.",
    storylineIds: [bornInSkip.id],
  };
  const payloads = [
    { events: [], storylineUpdates: [copyForward(failed, 1), copyForward(repaired, 1)], stopDate: "1916-09-11" },
    { events: [regency], storylineUpdates: [copyForward(failed, 2), copyForward(bornInSkip, 2)], stopDate: "1917-01-11" },
    { events: [], storylineUpdates: [copyForward(repaired, 3)], stopDate: SKIP_STOP },
  ];
  const repair = {
    ...repaired,
    momentum: repaired.momentum + ANTI_STASIS_MIN_MOMENTUM_DELTA,
    state: "A new commander reorganises the front for a spring offensive.",
    eventIndexes: [],
  };

  // What repairSkipStorylineMotion does once the repair pass is over: the
  // failed and the repaired storyline are both settled.
  const settled = settleSkipStorylineUpdates(payloads.map((payload) => payload.storylineUpdates), {
    settledIds: [failed.id, repaired.id],
    preSkipIds: before.storylines.map((entry) => entry.id),
    repairedUpdates: [repair],
  });
  payloads.forEach((payload, index) => {
    payload.storylineUpdates = settled[index];
  });
  // ...and what finishTimelineJump then writes.
  const merged = mergeSegmentPayloads(payloads, { targetDate: SKIP_STOP });
  const { world: after } = applyWorldStorylineUpdates({
    world: before,
    updates: merged.storylineUpdates,
    events: merged.events,
    stopDate: merged.stopDate,
    round: 12,
  });
  const byId = new Map(after.storylines.map((entry) => [entry.id, entry]));

  // Failed: exactly where it stood before the skip, so it is overdue next turn
  // rather than silently pushed forward by its copy-forwards.
  const failedAfter = byId.get(failed.id);
  assert.equal(failedAfter.accountedThroughDate, failed.accountedThroughDate);
  assert.equal(failedAfter.state, failed.state);
  assert.equal(failedAfter.pressure, failed.pressure);
  assert.equal(failedAfter.momentum, failed.momentum);

  // Repaired: its repair's numbers, accounted through the end of the skip, and
  // no event linked — a repair moves the numbers, it does not invent history.
  const repairedAfter = byId.get(repaired.id);
  assert.equal(repairedAfter.momentum, repair.momentum);
  assert.equal(repairedAfter.state, repair.state);
  assert.equal(repairedAfter.accountedThroughDate, SKIP_STOP);
  assert.equal(repairedAfter.lastVisibleEventDate, repaired.lastVisibleEventDate);

  // Born in the skip: kept, with the event that established it.
  const bornAfter = byId.get(bornInSkip.id);
  assert.ok(bornAfter, "the storyline born in the skip was erased");
  assert.equal(bornAfter.lastVisibleEventDate, regency.date);
});
