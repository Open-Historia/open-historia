import test from "node:test";
import assert from "node:assert/strict";

import {
  advancePoliticalDispositionBatch,
  derivePoliticalDispositionForActor,
  initializePoliticalDispositionsForWorld,
} from "./politicalDisposition.js";
import { normalizePoliticalActors } from "./politicalActors.js";
import { applyPoliticalActorOperations } from "./politicalActorOps.js";

const makeActor = (overrides = {}) => ({
  polityKey: "A",
  government: {
    form: "Republic",
    approval: 62,
    stability: 68,
    rulingPartyIds: ["gov"],
  },
  parties: [
    { id: "gov", name: "Government", support: { percent: 48 } },
    { id: "opp", name: "Opposition", support: { percent: 42 } },
  ],
  traits: {
    riskTolerance: 74,
    opportunism: 78,
    caution: 28,
  },
  ...overrides,
});

test("structured leadership traits produce a bounded decision-facing disposition", () => {
  const result = derivePoliticalDispositionForActor(makeActor(), { updatedAt: "2014-04-22" });
  assert.ok(result);
  assert.ok(result.riskTolerance > 60);
  assert.ok(result.assertiveness > 55);
  assert.ok(result.opportunityPerception > 60);
  assert.ok(Object.values(result).filter((value) => typeof value === "number").every((value) => value >= 0 && value <= 100));
});

test("security pressure and war weariness pull escalation and compromise in different directions", () => {
  const hawkish = derivePoliticalDispositionForActor(makeActor({
    politicalPressures: {
      updatedAt: "2014-07-22",
      issues: {
        security: { salience: 90, strain: 75, lean: 90, persistence: 0.9 },
      },
    },
  }), { updatedAt: "2014-07-22" });

  const weary = derivePoliticalDispositionForActor(makeActor({
    politicalPressures: {
      updatedAt: "2015-07-22",
      issues: {
        security: { salience: 90, strain: 75, lean: 90, persistence: 0.9 },
        war_weariness: { salience: 90, strain: 90, lean: 100, persistence: 0.92 },
      },
    },
  }), { updatedAt: "2015-07-22" });

  assert.ok(hawkish.escalationPressure > weary.escalationPressure);
  assert.ok(weary.compromisePressure > hawkish.compromisePressure);
  assert.ok(weary.deterrenceSensitivity > hawkish.deterrenceSensitivity);
});

test("domestic fragility raises regime vulnerability without interpreting political prose", () => {
  const stable = derivePoliticalDispositionForActor(makeActor(), { updatedAt: "2067-01-01" });
  const fragile = derivePoliticalDispositionForActor(makeActor({
    government: { form: "Republic", approval: 18, stability: 15, rulingPartyIds: ["gov"] },
    politicalPressures: {
      issues: {
        economic_stress: { salience: 80, strain: 85, lean: 100, persistence: 0.8 },
        institutional_trust: { salience: 70, strain: 90, lean: 0, persistence: 0.84 },
      },
    },
  }), { updatedAt: "2067-01-01" });

  assert.ok(fragile.regimeVulnerability > stable.regimeVulnerability);

  const proseOnly = derivePoliticalDispositionForActor({
    polityKey: "B",
    government: { form: "Republic", ideology: "Extremely aggressive expansionist ideology" },
    goals: ["Conquer every neighbor"],
    fears: ["Encirclement"],
    ambitions: ["Build an empire"],
  }, { updatedAt: "2067-01-01" });
  assert.equal(proseOnly, null);
});

test("structured perceptions affect threat and opportunity without parsing target names or prose", () => {
  const actor = makeActor({
    perceptions: {
      RivalA: { threat: 88, cohesionEstimate: 25 },
      RivalB: { threat: 72, weakness: 80 },
    },
  });
  const result = derivePoliticalDispositionForActor(actor, { updatedAt: "1936-03-01" });
  assert.ok(result.threatPerception > 65);
  assert.ok(result.opportunityPerception > 60);
});

test("batch disposition is deterministic and commits only through the canonical Political Actor operation", () => {
  const actors = normalizePoliticalActors({ byPolity: { A: makeActor() } });
  const first = advancePoliticalDispositionBatch({ actorsByPolity: actors.byPolity, updatedAt: "2014-04-22" });
  const second = advancePoliticalDispositionBatch({ actorsByPolity: actors.byPolity, updatedAt: "2014-04-22" });
  assert.deepEqual(first, second);
  assert.equal(first.operations.length, 1);
  assert.equal(first.operations[0].op, "set-behavioral-disposition");

  const world = { politicalActors: actors };
  const applied = applyPoliticalActorOperations(world, first.operations);
  assert.equal(applied.failed, 0);
  assert.ok(world.politicalActors.byPolity.A.behavioralDisposition.assertiveness > 0);
});

test("a stale derived disposition can be cleared if its structured inputs disappear", () => {
  const actor = {
    polityKey: "A",
    government: { form: "Republic" },
    behavioralDisposition: { assertiveness: 70, updatedAt: "2014-01-01" },
  };
  const result = advancePoliticalDispositionBatch({ actorsByPolity: { A: actor }, updatedAt: "2014-02-01" });
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].state, null);
});

test("Round-Zero initializer materializes deterministic native C4 without changing authored semantics", () => {
  const world = {
    marker: { untouched: true },
    politicalActors: normalizePoliticalActors({
      byPolity: {
        Japan: makeActor({ polityKey: "Japan", traits: { militarism: 65, pragmatism: 60, ambition: 80, caution: 40 } }),
        Russia: makeActor({ polityKey: "Russia", traits: { militarism: 75, riskTolerance: 70, pragmatism: 60, paranoia: 65 } }),
        Germany: makeActor({ polityKey: "Germany", traits: { pragmatism: 85, caution: 80, consensusDriven: 75, militarism: 20 } }),
        USA: makeActor({
          polityKey: "USA",
          traits: { pragmatism: 70, riskTolerance: 45, caution: 55 },
          goals: ["Preserve the settlement"],
          fears: ["Strategic isolation"],
          ambitions: ["Regional leadership"],
        }),
        Partial: {
          polityKey: "Partial",
          government: { form: "Republic" },
          parties: [],
          traits: { caution: 80 },
          goals: ["Avoid escalation"],
        },
      },
    }),
  };
  const before = structuredClone(world);

  const first = initializePoliticalDispositionsForWorld(world, { updatedAt: "2014-03-22" });
  assert.deepEqual(world, before, "initialization must not mutate the caller world");
  for (const polityKey of ["Japan", "Russia", "Germany", "USA", "Partial"]) {
    const disposition = first.world.politicalActors.byPolity[polityKey].behavioralDisposition;
    assert.ok(disposition && Object.keys(disposition).length > 1, `${polityKey} should start with native C4`);
    assert.equal(disposition.updatedAt, "2014-03-22");
  }
  assert.ok(first.world.politicalActors.byPolity.Partial.behavioralDisposition.compromisePressure > 50);
  assert.deepEqual(first.world.politicalActors.byPolity.USA.goals, before.politicalActors.byPolity.USA.goals);
  assert.deepEqual(first.world.politicalActors.byPolity.USA.fears, before.politicalActors.byPolity.USA.fears);
  assert.deepEqual(first.world.politicalActors.byPolity.USA.ambitions, before.politicalActors.byPolity.USA.ambitions);

  const second = initializePoliticalDispositionsForWorld(first.world, { updatedAt: "2014-03-22" });
  assert.equal(second.changedPolities, 0);
  assert.equal(second.applied, 0);
  assert.deepEqual(second.world, first.world, "repeated Round-Zero initialization must not drift");
});
