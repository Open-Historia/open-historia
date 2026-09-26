import assert from "node:assert/strict";
import test from "node:test";
import {
  commitScriptedEventPlan,
  evaluateScriptedEventConditions,
  normalizeScriptedEventState,
  planScriptedEvents,
} from "./scriptedEventResolution.js";

const event = (id, trigger = { mode: "always" }, date = "1914-03-21") => ({
  id, date, title: id, text: `${id} happens.`, trigger,
});

const world = {
  polityOverrides: {
    GBR: { code: "GBR", name: "United Kingdom", status: "active" },
    GONE: { code: "GONE", name: "Gone", status: "dissolved" },
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
        members: [{ polity: "GBR", status: "member", role: "member" }],
      },
    },
  },
};

test("Always resolves once and an already-resolved event is never planned again", () => {
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
  const chance = event("chance", { mode: "chance", percent: 25 });

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

test("a planned Chance beyond an auto-stop date is not committed", () => {
  const chance = event("later", { mode: "chance", percent: 100 }, "1914-04-01");
  const plan = planScriptedEvents([chance], { world, random: () => 0 });
  const before = commitScriptedEventPlan({}, plan, { throughDate: "1914-03-22" });
  assert.deepEqual(before.state, {});
});

test("Conditional supports shallow ALL and ANY groups", () => {
  const all = event("all", {
    mode: "conditional",
    operator: "all",
    conditions: [
      { type: "polity_exists", polityId: "GBR" },
      { type: "war_active", warId: "war-balkan" },
    ],
  });
  const any = event("any", {
    mode: "conditional",
    operator: "any",
    conditions: [
      { type: "polity_exists", polityId: "GONE" },
      { type: "institution_exists", institutionId: "triple-entente" },
    ],
  });
  const plan = planScriptedEvents([all, any], { world });
  assert.deepEqual(plan.eligible.map((row) => row.id), ["all", "any"]);
});

test("canonical polity, war and institution predicates read exact ids and fail closed when malformed", () => {
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

test("a Conditional outcome is committed once and does not wake up later", () => {
  const conditional = event("curragh", {
    mode: "conditional",
    operator: "all",
    conditions: [{ type: "war_active", warId: "war-never-started" }],
  });
  const first = planScriptedEvents([conditional], { world });
  assert.deepEqual(first.eligible, []);
  const committed = commitScriptedEventPlan({}, first, { throughDate: "1914-03-21" });
  assert.equal(committed.state.curragh.outcome, "skipped");

  const changedWorld = { ...world, wars: [...world.wars, { id: "war-never-started", status: "active" }] };
  const later = planScriptedEvents([conditional], { world: changedWorld, resolvedState: committed.state });
  assert.deepEqual(later.eligible, [], "a condition that was false on its date stays skipped");
});
