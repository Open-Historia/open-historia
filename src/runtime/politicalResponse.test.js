import test from "node:test";
import assert from "node:assert/strict";

import { applyPoliticalActorOperations } from "./politicalActorOps.js";
import { normalizePoliticalActors } from "./politicalActors.js";
import {
  advancePoliticalResponseBatch,
  advancePoliticalResponseForActor,
} from "./politicalResponse.js";

const immigrationPressure = {
  updatedAt: "2015-09-01",
  issues: {
    immigration: {
      salience: 70,
      lean: 85,
      strain: 55,
      persistence: 0.9,
      momentum: 18,
    },
  },
};

const electoralActor = () => ({
  polityKey: "Testland",
  government: {
    form: "Parliamentary republic",
    rulingPartyIds: ["liberal-government"],
  },
  parties: [
    {
      id: "liberal-government",
      name: "Liberal Government",
      support: { percent: 46 },
      politicalResponse: {
        organization: 70,
        credibility: 65,
        inertia: 75,
        resilience: 55,
        issues: {
          immigration: { position: -70, sensitivity: 90, strainResponse: -20 },
        },
      },
    },
    {
      id: "national-opposition",
      name: "National Opposition",
      support: { percent: 18 },
      politicalResponse: {
        organization: 68,
        credibility: 60,
        inertia: 68,
        resilience: 50,
        issues: {
          immigration: { position: 95, sensitivity: 100, strainResponse: 20 },
        },
      },
    },
    {
      id: "centrist",
      name: "Centrist Party",
      support: { percent: 25 },
    },
    {
      id: "coalition-group",
      name: "Coalition Group",
      coalition: true,
      // No polling percentage on purpose. Government membership != polling data.
      politicalResponse: {
        issues: { immigration: { position: 20, sensitivity: 50 } },
      },
    },
  ],
  politicalPressures: immigrationPressure,
});

test("the same pressure moves electoral parties differently according to issue fit and incumbency", () => {
  const result = advancePoliticalResponseForActor(electoralActor(), {
    polityKey: "Testland",
    updatedAt: "2015-09-01",
  });

  const government = result.changes.find((change) => change.id === "liberal-government");
  const opposition = result.changes.find((change) => change.id === "national-opposition");

  assert.ok(government);
  assert.ok(opposition);
  assert.ok(government.delta < 0);
  assert.ok(opposition.delta > 0);
  assert.ok(Math.abs(government.directDelta) <= 2.5);
  assert.ok(Math.abs(opposition.directDelta) <= 2.5);
  assert.equal(result.operations.every((operation) => operation.op === "set-party-support"), true);
  assert.equal(result.operations.some((operation) => operation.partyId === "coalition-group"), false);
});

test("response engine never invents polling for a party that has no numeric support", () => {
  const result = advancePoliticalResponseForActor(electoralActor(), { polityKey: "Testland" });
  assert.equal(result.changes.some((change) => change.id === "coalition-group"), false);
  assert.equal(result.operations.some((operation) => operation.partyId === "coalition-group"), false);
});

test("no pressure or no authored issue response means no random political drift", () => {
  const noPressure = electoralActor();
  delete noPressure.politicalPressures;
  assert.deepEqual(
    advancePoliticalResponseForActor(noPressure, { polityKey: "Testland" }).operations,
    [],
  );

  const noProfiles = electoralActor();
  noProfiles.parties = noProfiles.parties.map((party) => {
    const copy = { ...party };
    delete copy.politicalResponse;
    return copy;
  });
  assert.deepEqual(
    advancePoliticalResponseForActor(noProfiles, { polityKey: "Testland" }).operations,
    [],
  );
});

test("ordinary response is bounded to gradual movement rather than one-tick political teleportation", () => {
  const actor = electoralActor();
  actor.parties[1].support.percent = 4;
  actor.parties[1].politicalResponse = {
    organization: 100,
    credibility: 100,
    inertia: 0,
    resilience: 0,
    issues: {
      immigration: { position: 100, sensitivity: 100, strainResponse: 100 },
    },
  };
  actor.politicalPressures.issues.immigration = {
    salience: 100,
    lean: 100,
    strain: 100,
    persistence: 1,
    momentum: 100,
  };

  const result = advancePoliticalResponseForActor(actor, { polityKey: "Testland", updatedAt: "2015-09-01" });
  const opposition = result.changes.find((change) => change.id === "national-opposition");
  assert.ok(opposition);
  assert.ok(opposition.to <= 6.5);
  assert.ok(opposition.directDelta <= 2.5);
});

test("competitive party support does not grow beyond the existing explicit ceiling / 100 percent", () => {
  const actor = electoralActor();
  actor.parties[0].support.percent = 50;
  actor.parties[1].support.percent = 30;
  actor.parties[2].support.percent = 20;

  const result = advancePoliticalResponseForActor(actor, { polityKey: "Testland", updatedAt: "2015-09-01" });
  const after = new Map(actor.parties
    .filter((party) => Number.isFinite(Number(party?.support?.percent)))
    .map((party) => [party.id, party.support.percent]));
  for (const change of result.changes) after.set(change.id, change.to);
  const total = [...after.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(total <= 100.1);
});

test("non-electoral power blocs respond causally while qualitative-only influence remains qualitative", () => {
  const actor = {
    polityKey: "Kingdom",
    government: { form: "Absolute monarchy" },
    politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
    powerBlocs: [
      {
        id: "security",
        name: "Security establishment",
        influence: { percent: 28, label: "Strong" },
        politicalResponse: {
          organization: 80,
          credibility: 70,
          inertia: 70,
          issues: { security: { position: 100, sensitivity: 95, strainResponse: 40 } },
        },
      },
      {
        id: "reformers",
        name: "Reformist ministers",
        influence: { percent: 24 },
        politicalResponse: {
          organization: 55,
          credibility: 60,
          inertia: 75,
          issues: { security: { position: -80, sensitivity: 75, strainResponse: -20 } },
        },
      },
      {
        id: "court",
        name: "Royal Court",
        influence: { label: "Dominant" },
        politicalResponse: {
          issues: { security: { position: 30, sensitivity: 70 } },
        },
      },
    ],
    politicalPressures: {
      updatedAt: "1901-04-01",
      issues: {
        security: { salience: 80, lean: 90, strain: 60, persistence: 0.9, momentum: 15 },
      },
    },
  };

  const result = advancePoliticalResponseForActor(actor, { polityKey: "Kingdom", updatedAt: "1901-04-01" });
  const security = result.changes.find((change) => change.id === "security");
  const reformers = result.changes.find((change) => change.id === "reformers");

  assert.ok(security?.delta > 0);
  assert.ok(reformers?.delta < 0);
  assert.equal(result.operations.every((operation) => operation.op === "set-power-bloc-influence"), true);
  assert.equal(result.operations.some((operation) => operation.blocId === "court"), false);
});

test("batch results and tiny variation are deterministic for identical canonical input", () => {
  const payload = {
    actorsByPolity: {
      Testland: electoralActor(),
      Secondland: { ...electoralActor(), polityKey: "Secondland" },
    },
    updatedAt: "2015-09-01",
  };

  assert.deepEqual(advancePoliticalResponseBatch(payload), advancePoliticalResponseBatch(payload));
});

test("response batch is pure and its output commits through the canonical Political Actor operations seam", () => {
  const actor = electoralActor();
  const snapshot = structuredClone(actor);
  const batch = advancePoliticalResponseBatch({
    actorsByPolity: { Testland: actor },
    updatedAt: "2015-09-01",
  });

  assert.deepEqual(actor, snapshot);
  assert.ok(batch.operations.length > 0);

  const world = {
    politicalActors: normalizePoliticalActors({ byPolity: { Testland: actor } }),
  };
  const applied = applyPoliticalActorOperations(world, batch.operations);
  assert.equal(applied.failed, 0);
  assert.equal(applied.applied, batch.operations.length);

  for (const change of batch.changesByPolity.Testland) {
    if (change.kind !== "party") continue;
    const party = world.politicalActors.byPolity.Testland.parties.find((entry) => entry.id === change.id);
    assert.equal(party.support.percent, change.to);
  }
});

test("party-state party influence has a canonical campaign movement path when no power-bloc roster exists", () => {
  const actor = {
    polityKey: "Party State",
    politicalSystem: { type: "one_party_state", representation: "party_state" },
    government: { form: "One-party socialist state", rulingPartyIds: ["state-party"] },
    parties: [
      {
        id: "state-party",
        name: "State Party",
        influence: { percent: 72, basis: "generated-estimate" },
        politicalResponse: {
          organization: 90,
          credibility: 80,
          inertia: 50,
          issues: { security: { position: 80, sensitivity: 90, strainResponse: 30 } },
        },
      },
      {
        id: "satellite-party",
        name: "Satellite Party",
        influence: { percent: 18, basis: "generated-estimate" },
        politicalResponse: {
          organization: 55,
          credibility: 45,
          inertia: 65,
          issues: { security: { position: -60, sensitivity: 75, strainResponse: -20 } },
        },
      },
    ],
    politicalPressures: {
      updatedAt: "2014-04-01",
      issues: {
        security: { salience: 85, lean: 90, strain: 65, persistence: 0.9, momentum: 15 },
      },
    },
  };

  const result = advancePoliticalResponseForActor(actor, { polityKey: "Party State", updatedAt: "2014-04-01" });
  assert.ok(result.changes.length > 0);
  assert.equal(result.changes.every((change) => change.kind === "party-influence"), true);
  assert.equal(result.operations.every((operation) => operation.op === "set-party-influence"), true);

  const world = { politicalActors: normalizePoliticalActors({ byPolity: { "Party State": actor } }) };
  const applied = applyPoliticalActorOperations(world, result.operations);
  assert.equal(applied.failed, 0);
  for (const change of result.changes) {
    const party = world.politicalActors.byPolity["Party State"].parties.find((entry) => entry.id === change.id);
    assert.equal(party.influence.percent, change.to);
    assert.equal(party.influence.basis, "campaign-derived");
  }
});
