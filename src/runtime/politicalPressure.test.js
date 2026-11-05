import test from "node:test";
import assert from "node:assert/strict";

import {
  advancePoliticalPressureBatch,
  advancePoliticalPressureState,
  normalizePoliticalPressureSignal,
  normalizePoliticalPressureState,
} from "./politicalPressure.js";

const immigrationShock = {
  issue: "immigration",
  salience: 30,
  strain: 18,
  direction: 0.8,
  persistence: 0.9,
  source: { kind: "event", id: "migration-crisis", date: "2015-09-01" },
};

test("pressure state is bounded and sparse instead of accepting arbitrary numeric junk", () => {
  const state = normalizePoliticalPressureState({
    updatedAt: "2015-09-01",
    issues: {
      immigration: { salience: 140, lean: -180, strain: 120, persistence: 3, momentum: 160 },
      "bad key !": { salience: 50, lean: 20 },
      empty: { salience: 0, lean: 0, strain: 0 },
    },
  });

  assert.equal(state.issues.immigration.salience, 100);
  assert.equal(state.issues.immigration.lean, -100);
  assert.equal(state.issues.immigration.strain, 100);
  assert.equal(state.issues.immigration.persistence, 1);
  assert.equal(state.issues.immigration.momentum, 100);
  assert.equal("bad key !" in state.issues, false);
  assert.equal("empty" in state.issues, false);
});

test("world signals create causal pressure; there is no random drift when no signal exists", () => {
  const first = advancePoliticalPressureState({}, {
    months: 1,
    updatedAt: "2015-09-01",
    signals: [immigrationShock],
  });

  assert.equal(first.issues.immigration.salience, 30);
  assert.equal(first.issues.immigration.strain, 18);
  assert.equal(first.issues.immigration.lean, 80);
  assert.equal(first.issues.immigration.recentSources[0].id, "migration-crisis");

  const second = advancePoliticalPressureState(first, {
    months: 1,
    updatedAt: "2015-10-01",
    signals: [],
  });

  assert.equal(second.issues.immigration.salience, 27);
  assert.equal(second.issues.immigration.strain, 16.2);
  assert.equal(second.issues.immigration.lean, 72);
  assert.ok(second.issues.immigration.momentum < 0);
});

test("opposing developments change the direction of an issue without deleting its salience", () => {
  const restrictive = advancePoliticalPressureState({}, { signals: [immigrationShock] });
  const eased = advancePoliticalPressureState(restrictive, {
    signals: [{
      issue: "immigration",
      salience: 30,
      strain: 2,
      direction: -0.8,
      persistence: 0.85,
      sourceKind: "policy",
      sourceId: "successful-integration-reform",
    }],
  });

  assert.equal(eased.issues.immigration.salience, 60);
  assert.equal(eased.issues.immigration.lean, 0);
  assert.equal(eased.issues.immigration.strain, 20);
  assert.equal(eased.issues.immigration.recentSources[0].id, "successful-integration-reform");
});

test("persistence controls decay so structural crises outlive one-off shocks", () => {
  const persistent = advancePoliticalPressureState({}, {
    signals: [{ issue: "security", salience: 50, direction: 0.6, persistence: 0.95 }],
  });
  const transient = advancePoliticalPressureState({}, {
    signals: [{ issue: "security", salience: 50, direction: 0.6, persistence: 0.4 }],
  });

  const persistentLater = advancePoliticalPressureState(persistent, { months: 3 });
  const transientLater = advancePoliticalPressureState(transient, { months: 3 });
  assert.ok(persistentLater.issues.security.salience > transientLater.issues.security.salience);
});

test("non-directional strain can make an issue politically dangerous without inventing a policy preference", () => {
  const state = advancePoliticalPressureState({}, {
    signals: [{ issue: "economic_stress", salience: 25, strain: 45, direction: 0, persistence: 0.88 }],
  });
  assert.equal(state.issues.economic_stress.salience, 25);
  assert.equal(state.issues.economic_stress.strain, 45);
  assert.equal(state.issues.economic_stress.lean, 0);
});

test("batch processing never mints unknown Political Actors and returns only changed patches", () => {
  const result = advancePoliticalPressureBatch({
    actorsByPolity: {
      Poland: { polityKey: "Poland" },
      Germany: { polityKey: "Germany", politicalPressures: {} },
    },
    signalsByPolity: {
      Poland: [immigrationShock],
      Atlantis: [immigrationShock],
    },
    updatedAt: "2015-09-01",
  });

  assert.equal(result.changedPolities, 1);
  assert.ok(result.patchesByPolity.Poland);
  assert.equal("Germany" in result.patchesByPolity, false);
  assert.equal("Atlantis" in result.patchesByPolity, false);
});

test("batch output is deterministic for the same state, time span, and signals", () => {
  const payload = {
    actorsByPolity: {
      Poland: { polityKey: "Poland" },
      Germany: { polityKey: "Germany" },
    },
    signalsByPolity: {
      Poland: [immigrationShock],
      Germany: [{ issue: "security", salience: 14, strain: 8, direction: 0.6, persistence: 0.81 }],
    },
    months: 2,
    updatedAt: "2015-09-01",
  };

  assert.deepEqual(advancePoliticalPressureBatch(payload), advancePoliticalPressureBatch(payload));
});

test("signal normalization accepts compact direction values and rejects zero-information signals", () => {
  const signal = normalizePoliticalPressureSignal({ issue: "sovereignty", intensity: 12, direction: -0.5 });
  assert.equal(signal.salience, 12);
  assert.equal(signal.lean, -50);
  assert.equal(normalizePoliticalPressureSignal({ issue: "sovereignty", salience: 0, strain: 0 }), null);
});
