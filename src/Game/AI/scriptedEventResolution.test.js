import assert from "node:assert/strict";
import test from "node:test";
import {
  commitScriptedEventPlan,
  evaluateScriptedEventCondition,
  evaluateScriptedEventConditions,
  normalizeScriptedEventState,
  planScriptedEvents,
} from "./scriptedEventResolution.js";

const event = (id, trigger = { mode: "rules", operator: "all", conditions: [], percent: 100 }, date = "1914-03-21") => ({
  id, date, title: id, text: `${id} happens.`, trigger,
});

const world = {
  polityOverrides: {
    GBR: { code: "GBR", name: "United Kingdom", status: "active" },
    GER: { code: "GER", name: "German Empire", status: "active" },
    FRA: { code: "FRA", name: "France", status: "active" },
    GONE: { code: "GONE", name: "Gone", status: "dissolved" },
  },
  politicalActors: {
    byPolity: {
      GBR: { name: "United Kingdom" },
      GER: { name: "German Empire" },
    },
  },
  wars: [
    { id: "war-balkan", status: "active" },
    { id: "war-ended", status: "ended" },
  ],
  institutions: {
    byId: {
      "triple-entente": {
        id: "triple-entente",
        status: "active",
        members: [
          { polity: "GBR", status: "member", role: "member" },
          { polity: "GER", status: "observer", role: "member" },
        ],
      },
    },
  },
  puppets: [
    { id: "rel-1", overlord: "GER", puppet: "GBR", kind: "client", status: "active" },
  ],
};

test("rules with no conditions and 100 percent preserve Always exactly-once behavior", () => {
  const first = planScriptedEvents([event("always")], { world, resolvedState: {} });
  assert.deepEqual(first.eligible.map((row) => row.id), ["always"]);
  const committed = commitScriptedEventPlan({}, first, { throughDate: "1914-03-21" });
  assert.equal(committed.state.always.outcome, "fired");

  const second = planScriptedEvents([event("always")], { world, resolvedState: committed.state });
  assert.deepEqual(second.eligible, []);
  assert.deepEqual(second.resolutions, []);
});

test("Chance is rolled once for a held attempt, then persisted after the accepted segment", () => {
  let rolls = 0;
  const chance = event("chance", { mode: "rules", operator: "all", conditions: [], percent: 25 });

  const first = planScriptedEvents([chance], {
    world,
    resolvedState: {},
    pendingState: {},
    random: () => { rolls += 1; return 0.10; },
  });
  assert.equal(rolls, 1);
  assert.equal(first.eligible.length, 1);

  const retry = planScriptedEvents([chance], {
    world,
    resolvedState: {},
    pendingState: first.pendingState,
    random: () => { rolls += 1; return 0.99; },
  });
  assert.equal(rolls, 1, "a held-segment retry must reuse the first roll");
  assert.equal(retry.eligible.length, 1);

  const committed = commitScriptedEventPlan({}, retry, { throughDate: "1914-03-21" });
  assert.equal(committed.state.chance.outcome, "fired");
  assert.equal(committed.state.chance.roll, 0.10);

  const afterReload = planScriptedEvents([chance], {
    world,
    resolvedState: normalizeScriptedEventState(committed.state),
    random: () => { rolls += 1; return 0.99; },
  });
  assert.equal(rolls, 1, "a persisted outcome must never reroll after reload");
  assert.deepEqual(afterReload.eligible, []);
});

test("conditions are checked before chance and a failed condition never consumes a roll", () => {
  let rolls = 0;
  const conditionalChance = event("conditional-chance", {
    mode: "rules",
    operator: "all",
    conditions: [
      { type: "polity_exists", polityId: "GBR" },
      { type: "institution_has_polity", institutionId: "triple-entente", polityId: "GONE" },
    ],
    percent: 50,
  });
  const plan = planScriptedEvents([conditionalChance], {
    world,
    random: () => { rolls += 1; return 0; },
  });
  assert.equal(rolls, 0);
  assert.deepEqual(plan.eligible, []);
});

test("rules can fire on at least N of M conditions regardless of which conditions matched", () => {
  const twoOfThree = event("two-of-three", {
    mode: "rules",
    operator: "at_least",
    requiredCount: 2,
    conditions: [
      { type: "polity_exists", polityId: "GBR" },
      { type: "polity_exists", polityId: "GER" },
      { type: "polity_exists", polityId: "GONE" },
    ],
    percent: 100,
  });
  const evaluation = evaluateScriptedEventConditions(twoOfThree.trigger, world);
  assert.equal(evaluation.matched, true);
  assert.equal(evaluation.matchedCount, 2);
  assert.equal(evaluation.requiredCount, 2);
  assert.deepEqual(planScriptedEvents([twoOfThree], { world }).eligible.map((row) => row.id), ["two-of-three"]);
});

test("safe authoring predicates read Political World, membership status and puppet canon by exact ids", () => {
  assert.equal(evaluateScriptedEventCondition({ type: "political_actor_exists", polityId: "GBR" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "political_actor_not_exists", polityId: "FRA" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "political_actor_not_exists", polityId: "GONE" }, world).matched, false, "negative relationship predicates fail closed when the polity itself is absent");
  assert.equal(evaluateScriptedEventCondition({ type: "institution_member_status", institutionId: "triple-entente", polityId: "GER", status: "observer" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_subordinate_to", polityId: "GBR", overlordId: "GER" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_subordinate_to", polityId: "GBR", overlordId: "GER", kind: "client" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_subordinate_to", polityId: "GBR", overlordId: "GER", kind: "satellite" }, world).matched, false);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_not_subordinate_to", polityId: "GER", overlordId: "GBR" }, world).matched, true);
});

test("legacy war predicates remain readable but malformed predicates still fail closed", () => {
  assert.equal(evaluateScriptedEventConditions({
    operator: "all",
    conditions: [
      { type: "polity_not_exists", polityId: "GONE" },
      { type: "war_not_active", warId: "war-ended" },
      { type: "institution_has_polity", institutionId: "triple-entente", polityId: "GBR" },
    ],
  }, world).matched, true);

  assert.equal(evaluateScriptedEventConditions({
    operator: "all",
    conditions: [{ type: "polity_exists", polityId: "" }],
  }, world).matched, false);

  assert.equal(evaluateScriptedEventConditions({
    operator: "any",
    conditions: [{ type: "future_predicate_we_do_not_support", value: "x" }],
  }, world).matched, false);
});

test("a false dated condition is terminal and does not wake up later", () => {
  const conditional = event("curragh", {
    mode: "rules",
    operator: "all",
    conditions: [{ type: "institution_exists", institutionId: "future-institution" }],
    percent: 100,
  });
  const first = planScriptedEvents([conditional], { world });
  assert.deepEqual(first.eligible, []);
  const committed = commitScriptedEventPlan({}, first, { throughDate: "1914-03-21" });
  assert.equal(committed.state.curragh.outcome, "skipped");

  const changedWorld = {
    ...world,
    institutions: {
      byId: {
        ...world.institutions.byId,
        "future-institution": { id: "future-institution", status: "active", members: [] },
      },
    },
  };
  const later = planScriptedEvents([conditional], { world: changedWorld, resolvedState: committed.state });
  assert.deepEqual(later.eligible, [], "a condition that was false on its date stays skipped");
});

test("a planned chance beyond an auto-stop date is not committed", () => {
  const chance = event("later", { mode: "rules", operator: "all", conditions: [], percent: 100 }, "1914-04-01");
  const plan = planScriptedEvents([chance], { world, random: () => 0 });
  const before = commitScriptedEventPlan({}, plan, { throughDate: "1914-03-22" });
  assert.deepEqual(before.state, {});
});

test("region-control predicates use live overrides before authored base ownership and fail closed when unknown", () => {
  const controlled = { ...world, regionOwnershipOverrides: { R1: "GER" } };
  assert.equal(evaluateScriptedEventCondition({ type: "polity_controls_region", polityId: "GER", regionId: "R1", baseOwner: "FRA" }, controlled).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_controls_region", polityId: "FRA", regionId: "R1", baseOwner: "FRA" }, controlled).matched, false);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_not_controls_region", polityId: "GER", regionId: "R2", baseOwner: "FRA" }, controlled).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_not_controls_region", polityId: "GER", regionId: "UNKNOWN" }, controlled).matched, false);
});

test("scripted-event dependency negatives stay false until the referenced event actually resolves", () => {
  const unresolved = { scriptedEventState: {} };
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_event_skipped", eventId: "prior" }, world, unresolved).matched, false);
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_outcome_not_selected", eventId: "prior", outcomeId: "b" }, world, unresolved).matched, false);
  const resolved = { scriptedEventState: { prior: { outcome: "fired", selectedOutcomeId: "a" } } };
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_event_fired", eventId: "prior" }, world, resolved).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_outcome_selected", eventId: "prior", outcomeId: "a" }, world, resolved).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_outcome_not_selected", eventId: "prior", outcomeId: "b" }, world, resolved).matched, true);
});

test("one weighted branch outcome is selected once and survives retry plus save reload", () => {
  let rolls = 0;
  const branched = { ...event("election"), outcomes: [
    { id: "a", title: "A wins", text: "Candidate A wins.", weight: 25 },
    { id: "b", title: "B wins", text: "Candidate B wins.", weight: 75 },
  ] };
  const first = planScriptedEvents([branched], { world, random: () => { rolls += 1; return 0.8; } });
  assert.equal(first.eligible.length, 1);
  assert.equal(first.eligible[0].selectedOutcomeId, "b");
  assert.equal(first.eligible[0].text, "Candidate B wins.");
  assert.equal(rolls, 1, "100% trigger consumes no roll; only the branch selection rolls");
  const retry = planScriptedEvents([branched], { world, pendingState: first.pendingState, random: () => { rolls += 1; return 0; } });
  assert.equal(retry.eligible[0].selectedOutcomeId, "b");
  assert.equal(rolls, 1, "held retry must not reroll branch selection");
  const committed = commitScriptedEventPlan({}, retry, { throughDate: "1914-03-21" });
  assert.equal(committed.state.election.selectedOutcomeId, "b");
  const afterReload = planScriptedEvents([branched], { world, resolvedState: normalizeScriptedEventState(committed.state), random: () => { rolls += 1; return 0; } });
  assert.deepEqual(afterReload.eligible, []);
  assert.equal(rolls, 1);
});

test("later due events in the same plan can depend on the selected outcome of an earlier event", () => {
  const primary = { ...event("primary", undefined, "1914-03-20"), outcomes: [
    { id: "reformer", text: "The reformer wins.", weight: 1 },
    { id: "hardliner", text: "The hardliner wins.", weight: 0 },
  ] };
  const followup = event("followup", { mode: "rules", operator: "all", conditions: [
    { type: "scripted_outcome_selected", eventId: "primary", outcomeId: "reformer" },
  ], percent: 100 }, "1914-03-21");
  const plan = planScriptedEvents([primary, followup], { world, random: () => 0.2 });
  assert.deepEqual(plan.eligible.map((row) => row.id), ["primary", "followup"]);
});

test("a branch with no positive-weight outcome fails closed", () => {
  const branched = { ...event("bad-branch"), outcomes: [
    { id: "a", text: "A", weight: 0 },
    { id: "b", text: "B", weight: -4 },
  ] };
  const plan = planScriptedEvents([branched], { world, random: () => 0 });
  assert.deepEqual(plan.eligible, []);
  assert.equal(plan.resolutions[0].outcome, "skipped");
});
