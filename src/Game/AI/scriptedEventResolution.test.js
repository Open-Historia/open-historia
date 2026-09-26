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
