/*! Open Historia — world director storyline rules: duplicates, initiative evidence, review cadence, anti-stasis © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeWorldDirector.storylines.test.js
//
// These were the director's in-bundle self-test (17 cases, reachable only from
// the browser console). They decide which storylines a jump must move and
// which copy-forward updates it may not get away with, so they run in CI now.

import test from "node:test";
import assert from "node:assert/strict";

import {
  coalesceWorldStorylines,
  decodeWorldStorylineUpdates,
  findWorldStorylineAntiStasisIssues,
  recentEventEligibleForInitiative,
  recommendedReviewDays,
  storylineNeedsAttentionWithin,
  storylineReviewAgeDays,
  storylineStagnationAgeDays,
  stripQuietDeferredStorylineUpdates,
  validateWorldStorylinePayload,
} from "./nativeWorldDirector.js";

const fixtureWorld = {
  wars: [
    { id: "polish-war-of-independence", status: "active", sideA: ["Poland"], sideB: ["Russian Empire"] },
    { id: "austro-serbian-war", status: "active", sideA: ["Austria-Hungary"], sideB: ["Kingdom of Serbia"] },
  ],
  storylines: [
    {
      id: "storyline-polish-war-of-independence",
      kind: "war",
      title: "War of Polish Independence",
      participants: ["Poland", "Russian Empire"],
      status: "active",
      pressure: 85,
      momentum: 30,
      startedDate: "1915-04-18",
      accountedThroughDate: "1916-03-13",
      lastUpdatedDate: "1916-03-13",
      state: "Older canonical-id copy.",
      sourceEventIds: ["polish-a"],
    },
    {
      id: "storyline-polish-independence",
      kind: "war",
      title: "War of Polish Independence",
      participants: ["Poland", "Russian Empire"],
      status: "active",
      pressure: 72,
      momentum: 18,
      startedDate: "1915-04-18",
      accountedThroughDate: "1916-04-12",
      lastUpdatedDate: "1916-04-12",
      state: "Newer duplicate-id copy.",
      sourceEventIds: ["polish-b"],
    },
    {
      id: "storyline-july-crisis",
      kind: "war",
      title: "Austro-Serbian War",
      participants: ["Austria-Hungary", "Kingdom of Serbia"],
      status: "active",
      pressure: 68,
      momentum: 20,
      startedDate: "1914-06-28",
      accountedThroughDate: "1916-05-12",
      lastUpdatedDate: "1916-05-12",
      state: "Freshest Austro-Serbian state.",
      sourceEventIds: ["serbia-a"],
    },
    {
      id: "storyline-austro-serbian-war",
      kind: "war",
      title: "Austro-Serbian War",
      participants: ["Austria-Hungary", "Kingdom of Serbia"],
      status: "active",
      pressure: 80,
      momentum: 25,
      startedDate: "1914-07-28",
      accountedThroughDate: "1916-03-13",
      lastUpdatedDate: "1916-03-13",
      state: "Older canonical-id Austro-Serbian copy.",
      sourceEventIds: ["serbia-b"],
    },
  ],
};

// --- Duplicate storylines ---

test("semantic duplicate war storylines collapse", () => {
  const merged = coalesceWorldStorylines(fixtureWorld);
  assert.equal(merged.storylines.length, 2);
  assert.equal(merged.mergedDuplicateCount, 2);
});

test("a war storyline's canonical id survives a newer alias and keeps both sources", () => {
  const polish = coalesceWorldStorylines(fixtureWorld).storylines
    .find((entry) => entry.id === "storyline-polish-war-of-independence");
  assert.ok(polish);
  assert.equal(polish.state, "Newer duplicate-id copy.");
  assert.ok(polish.sourceEventIds.includes("polish-a"));
  assert.ok(polish.sourceEventIds.includes("polish-b"));
});

test("the canonical Austro-Serbian id keeps the freshest state", () => {
  const serbia = coalesceWorldStorylines(fixtureWorld).storylines
    .find((entry) => entry.id === "storyline-austro-serbian-war");
  assert.ok(serbia);
  assert.equal(serbia.state, "Freshest Austro-Serbian state.");
});

// --- What counts as current initiative evidence ---

test("a 360-day-old event is not current initiative evidence", () => {
  assert.equal(recentEventEligibleForInitiative({ date: "1915-04-18" }, "1916-04-12"), false);
});

test("a 30-day-old storyline event is still current initiative evidence", () => {
  assert.equal(recentEventEligibleForInitiative({
    date: "1916-03-13",
    importance: "minor",
    storylineIds: ["storyline-test"],
    impacts: {},
  }, "1916-04-12"), true);
});

test("a minor narrative card with no impacts is not a causal seed", () => {
  assert.equal(recentEventEligibleForInitiative({
    date: "1916-01-29",
    importance: "minor",
    notable: false,
    playerRelated: false,
    kind: "world",
    storylineIds: [],
    impacts: {},
  }, "1916-04-12"), false);
});

test("a minor event with a structured impact is still a causal seed", () => {
  assert.equal(recentEventEligibleForInitiative({
    date: "1916-03-20",
    importance: "minor",
    notable: false,
    storylineIds: [],
    impacts: { markerOps: [{ op: "build" }] },
  }, "1916-04-12"), true);
});

// --- Review cadence and anti-stasis ---

const stagnantHighPressure = {
  id: "storyline-motion-test",
  kind: "war",
  title: "Motion Test War",
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

const copyForward = (storyline, overrides = {}) => ({
  events: [],
  storylineUpdates: [{
    ...storyline,
    pressure: storyline.pressure,
    momentum: storyline.momentum,
    eventIndexes: [],
    state: storyline.state,
    ...overrides,
  }],
});

const stagnantScope = {
  existingStorylines: [stagnantHighPressure],
  selectedStorylines: [stagnantHighPressure],
  deferredStorylines: [],
  originDate: "1916-06-11",
  stopDate: "1916-07-11",
};

test("21 days of high-pressure stagnation override a later review date", () => {
  assert.ok(storylineStagnationAgeDays(stagnantHighPressure, "1916-07-11") >= 21);
  assert.equal(storylineNeedsAttentionWithin(stagnantHighPressure, "1916-06-11", "1916-07-11"), true);
});

test("the 45-day anti-stasis backstop rejects a high-pressure copy-forward", () => {
  const error = validateWorldStorylinePayload(copyForward(stagnantHighPressure), stagnantScope);
  assert.match(error, /anti-stasis backstop/i);
});

test("45-day anti-stasis is found as a local issue without failing the whole pass", () => {
  const issues = findWorldStorylineAntiStasisIssues(copyForward(stagnantHighPressure), {
    existingStorylines: [stagnantHighPressure],
    selectedStorylines: [stagnantHighPressure],
    stopDate: "1916-07-11",
  });
  const error = validateWorldStorylinePayload(copyForward(stagnantHighPressure), { ...stagnantScope, enforceAntiStasis: false });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.id, stagnantHighPressure.id);
  assert.equal(error, "");
});

test("a missing update for a native-attention storyline becomes a local repair, not a whole-pass failure", () => {
  const candidate = { events: [], storylineUpdates: [] };
  const strict = validateWorldStorylinePayload(candidate, { ...stagnantScope, enforceAntiStasis: false });
  const repairable = validateWorldStorylinePayload(candidate, {
    ...stagnantScope,
    enforceAntiStasis: false,
    enforceSelectedCoverage: false,
  });
  const issues = findWorldStorylineAntiStasisIssues(candidate, {
    existingStorylines: [stagnantHighPressure],
    selectedStorylines: [stagnantHighPressure],
    originDate: "1916-06-11",
    stopDate: "1916-07-11",
  });
  assert.match(strict, /must include native-attention storyline/i);
  assert.equal(repairable, "");
  assert.deepEqual(issues.map((issue) => [issue.kind, issue.id]), [["missing-update", stagnantHighPressure.id]]);
});

test("the 45-day backstop accepts objective hidden evolution", () => {
  const error = validateWorldStorylinePayload(copyForward(stagnantHighPressure, {
    pressure: 74,
    momentum: 28,
    state: "The front remains intact, but both commands reorganize and operational tempo begins to recover.",
  }), stagnantScope);
  assert.equal(error, "");
});

const lowPressureActiveWar = {
  id: "storyline-polish-war-of-independence",
  kind: "war",
  title: "War of Polish Independence",
  participants: ["Poland", "Russian Empire"],
  status: "active",
  pressure: 65,
  momentum: 25,
  startedDate: "1915-04-18",
  accountedThroughDate: "1916-12-08",
  lastUpdatedDate: "1916-12-08",
  lastVisibleEventDate: "1916-11-20",
  nextReviewDate: "1917-04-07",
  state: "Winter positions hold while the active war remains unresolved.",
};

test("an active war's 21-day review overrides the pressure cliff", () => {
  assert.ok(storylineReviewAgeDays(lowPressureActiveWar, "1917-02-06") >= 21);
  assert.equal(storylineNeedsAttentionWithin(lowPressureActiveWar, "1917-01-07", "1917-02-06", fixtureWorld), true);
});

test("an active war's 45-day anti-stasis ignores the pressure cliff", () => {
  const issues = findWorldStorylineAntiStasisIssues(copyForward(lowPressureActiveWar), {
    existingStorylines: [lowPressureActiveWar],
    selectedStorylines: [lowPressureActiveWar],
    stopDate: "1917-02-06",
    world: fixtureWorld,
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.activeWar, true);
});

test("a non-war storyline at pressure 65 enters the high-pressure review cadence", () => {
  const lowPressureNonWar = {
    ...lowPressureActiveWar,
    id: "storyline-domestic-control",
    kind: "politics",
    title: "Domestic Control Test",
    participants: ["Poland"],
    nextReviewDate: "1917-04-07",
  };
  assert.equal(storylineNeedsAttentionWithin(lowPressureNonWar, "1917-01-07", "1917-02-06", fixtureWorld), true);
});

test("an active war's stored review cadence caps at 21 days", () => {
  assert.equal(recommendedReviewDays(65, 25, "active", { activeWar: true }), 21);
});

// --- Final-attempt salvage ---

test("final-attempt salvage strips only quiet deferred bookkeeping", () => {
  const candidate = {
    events: [{
      title: "Independent material event",
      description: "A separate development occurs elsewhere.",
      impacts: {},
    }],
    storylineUpdates: [
      {
        id: "storyline-selected-test",
        status: "active",
        pressure: 72,
        momentum: 24,
        startedDate: "1916-01-01",
        kind: "war",
        title: "Selected Test War",
        participants: ["Poland", "Russian Empire"],
        eventIndexes: [0],
        state: "A material development changes the selected process.",
      },
      {
        id: "storyline-deferred-quiet-test",
        status: "active",
        pressure: 35,
        momentum: 15,
        startedDate: "1915-01-01",
        kind: "diplomacy",
        title: "Deferred Quiet Test",
        participants: ["German Empire", "British Empire"],
        eventIndexes: [],
        state: "The quiet detente remains unchanged.",
      },
    ],
  };
  const salvage = stripQuietDeferredStorylineUpdates(candidate, [{
    id: "storyline-deferred-quiet-test",
    status: "active",
    pressure: 35,
    momentum: 15,
    title: "Deferred Quiet Test",
  }]);
  assert.deepEqual(salvage.strippedIds, ["storyline-deferred-quiet-test"]);
  assert.deepEqual(decodeWorldStorylineUpdates(candidate.storylineUpdates).map((entry) => entry.id), ["storyline-selected-test"]);
});
