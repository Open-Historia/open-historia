import test from "node:test";
import assert from "node:assert/strict";

import { advancePoliticalBackgroundSimulation } from "./politicalBackground.js";
import { advancePoliticalBackgroundKernel } from "./politicalBackgroundKernel.js";
import { normalizePoliticalActors } from "./politicalActors.js";

const backgroundAdvance = async (payload) => advancePoliticalBackgroundKernel(payload);

const makeWorld = ({ responseProfile = true } = {}) => ({
  politicalActors: normalizePoliticalActors({
    byPolity: {
      A: {
        polityKey: "A",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Parliamentary republic", rulingPartyIds: ["gov"] },
        parties: [
          {
            id: "gov",
            name: "Government Party",
            support: { percent: 55 },
            ...(responseProfile ? { politicalResponse: { issues: { cost_of_living: { position: -70, sensitivity: 100 } } } } : {}),
          },
          {
            id: "opp",
            name: "Opposition Party",
            support: { percent: 35 },
            ...(responseProfile ? { politicalResponse: { issues: { cost_of_living: { position: 80, sensitivity: 100 } } } } : {}),
          },
        ],
      },
    },
  }),
  politicalSimulation: {},
  countryStats: {
    A: { stability: 60, economy: { inflation: 14, unemployment: 5, gdpGrowth: 1 } },
  },
  relations: [],
  wars: [],
});

test("political background connects world structure -> pressure -> canonical party response", async () => {
  const world = makeWorld();
  const beforeGov = world.politicalActors.byPolity.A.parties.find((party) => party.id === "gov").support.percent;
  const beforeOpp = world.politicalActors.byPolity.A.parties.find((party) => party.id === "opp").support.percent;

  const result = await advancePoliticalBackgroundSimulation({
    world,
    fromDate: "2014-03-22",
    toDate: "2014-04-22",
    round: 2,
    backgroundAdvance,
  });

  assert.equal(result.skipped, false);
  assert.ok(result.pressureChangedPolities >= 1);
  assert.equal(result.plan.responseTicks, 1);
  assert.ok(result.world.politicalActors.byPolity.A.politicalPressures.issues.cost_of_living);
  assert.ok(result.world.politicalActors.byPolity.A.behavioralDisposition);
  assert.ok(result.world.politicalActors.byPolity.A.behavioralDisposition.regimeVulnerability > 0);
  assert.equal(result.dispositionChangedPolities, 1);
  const afterGov = result.world.politicalActors.byPolity.A.parties.find((party) => party.id === "gov").support.percent;
  const afterOpp = result.world.politicalActors.byPolity.A.parties.find((party) => party.id === "opp").support.percent;
  assert.ok(afterGov < beforeGov);
  assert.ok(afterOpp > beforeOpp);
  assert.equal(result.world.politicalSimulation.lastProcessedDate, "2014-04-22");
  assert.equal(world.politicalActors.byPolity.A.politicalPressures, undefined);
});

test("pressure accumulates even before Phase006 has supplied a polity response profile", async () => {
  const world = makeWorld({ responseProfile: false });
  const before = world.politicalActors.byPolity.A.parties.map((party) => party.support.percent);
  const result = await advancePoliticalBackgroundSimulation({
    world,
    fromDate: "2014-03-22",
    toDate: "2014-04-22",
    round: 2,
    backgroundAdvance,
  });
  assert.ok(result.world.politicalActors.byPolity.A.politicalPressures.issues.cost_of_living);
  assert.deepEqual(result.world.politicalActors.byPolity.A.parties.map((party) => party.support.percent), before);
});

test("a skipped background worker preserves the last valid political state and clock for catch-up", async () => {
  const world = makeWorld();
  const result = await advancePoliticalBackgroundSimulation({
    world,
    fromDate: "2014-03-22",
    toDate: "2014-04-22",
    round: 2,
    backgroundAdvance: async () => ({ skipped: true, reason: "worker-unavailable" }),
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "worker-unavailable");
  assert.equal(result.world, world);
  assert.deepEqual(world.politicalSimulation, {});
});

test("no Political Actors means no generation side effect; the clock simply anchors at the current campaign date", async () => {
  const world = { politicalActors: normalizePoliticalActors({}), politicalSimulation: {}, countryStats: {}, relations: [], wars: [] };
  const result = await advancePoliticalBackgroundSimulation({
    world,
    fromDate: "2067-01-01",
    toDate: "2067-02-01",
    round: 2,
    backgroundAdvance,
  });
  assert.equal(result.reason, "no-political-actors");
  assert.deepEqual(result.world.politicalActors.byPolity, {});
  assert.equal(result.world.politicalSimulation.lastProcessedDate, "2067-02-01");
});

test("a disposition whose inputs have run out is cleared and the rest of the background still commits", async () => {
  const world = {
    politicalActors: normalizePoliticalActors({
      byPolity: {
        A: { polityKey: "A", behavioralDisposition: { threatPerception: 70, updatedAt: "2014-03-01" } },
        B: { polityKey: "B", parties: [{ id: "b1", name: "B Party", support: { percent: 40 } }] },
      },
    }),
    politicalSimulation: {},
    countryStats: { B: { stability: 60, economy: { inflation: 14, unemployment: 5, gdpGrowth: 1 } } },
    relations: [],
    wars: [],
  };
  const result = await advancePoliticalBackgroundSimulation({
    world,
    fromDate: "2014-03-22",
    toDate: "2014-04-22",
    round: 2,
    backgroundAdvance,
  });
  assert.equal(result.skipped, false, result.reason);
  assert.equal(result.world.politicalActors.byPolity.A.behavioralDisposition, undefined);
  assert.ok(result.world.politicalActors.byPolity.B.politicalPressures.issues.cost_of_living);
  assert.equal(result.world.politicalSimulation.lastProcessedDate, "2014-04-22");
  assert.equal(result.dispositionErrors, undefined);
});

test("one failed disposition op is reported without discarding pressures, responses or the clock", async () => {
  const world = makeWorld();
  const result = await advancePoliticalBackgroundSimulation({
    world,
    fromDate: "2014-03-22",
    toDate: "2014-04-22",
    round: 2,
    backgroundAdvance: async (payload) => {
      const computed = advancePoliticalBackgroundKernel(payload);
      return {
        ...computed,
        dispositionOperations: [
          { op: "set-behavioral-disposition", polityKey: "Nowhere", state: { threatPerception: 50 } },
          ...computed.dispositionOperations,
        ],
      };
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.dispositionErrors.length, 1);
  assert.match(result.dispositionErrors[0], /Nowhere/);
  assert.ok(result.world.politicalActors.byPolity.A.politicalPressures.issues.cost_of_living);
  assert.ok(result.world.politicalActors.byPolity.A.behavioralDisposition);
  assert.equal(result.world.politicalSimulation.lastProcessedDate, "2014-04-22");
});
