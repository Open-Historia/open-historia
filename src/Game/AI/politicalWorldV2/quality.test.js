import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalWorldV2Checkpoint, normalizePoliticalWorldV2Checkpoint } from "./checkpoint.js";
import { evaluatePoliticalWorldV2Quality } from "./quality.js";

const completeActor = (polityKey) => ({
  polityKey,
  politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
  government: { form: "Parliamentary republic", ideology: "Pragmatic constitutional government", rulingPartyIds: ["gov"] },
  parties: [{ id: "gov", name: "Government Party", support: { percent: 55 }, ideology: "Pragmatic", publicPriorities: ["Maintain stability"] }],
  traits: { pragmatism: 60 },
  goals: ["Maintain national security"],
  fears: ["Strategic isolation"],
  ambitions: ["Improve regional influence"],
  domesticPressures: ["Budget constraints"],
  perceptions: { Neighbor: { threat: 25 } },
});

const readyCheckpoint = () => {
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId: "s",
    scenarioDate: "2014-03-22",
    stagedWorld: {
      institutions: { schemaVersion: 1, byId: { pact: { id: "pact", name: "Pact", foundedDate: "2000-01-01", members: {} } } },
      agreements: [{ id: "agreement" }],
      powerStatus: { byPolity: { A: { score: 50 }, B: { score: 40 } } },
      politicalActors: { schemaVersion: 1, byPolity: { A: completeActor("A"), B: completeActor("B") } },
    },
  });
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stages.institutionGovernance = "complete";
  checkpoint.stages.agreements = "complete";
  checkpoint.coverage["political-actor"] = ["A", "B"];
  checkpoint.coverage["governing-alignment"] = ["A", "B"];
  checkpoint.coverage["historical-verification"] = ["A", "B"];
  checkpoint.membership.resolvedInstitutionIds = ["pact"];
  return checkpoint;
};

test("canonical quality is derived directly from staged canon and explicit coverage", () => {
  const quality = evaluatePoliticalWorldV2Quality({ checkpoint: readyCheckpoint(), polities: ["A", "B"], historicalVerificationRequired: true });
  assert.equal(quality.canonicalReady, true);
  assert.equal(quality.counts.politicalActors, 2);
  assert.equal(quality.counts.memberships, 2);
  assert.equal(quality.counts.governingAlignment, 2);
  assert.equal(quality.counts.powerEvidence, 2);
  assert.equal(quality.counts.verified, 2);
  assert.deepEqual(quality.unresolved, []);
});

test("one missing actor produces exactly one actor quality gap", () => {
  const checkpoint = readyCheckpoint();
  checkpoint.coverage["political-actor"] = ["A"];
  const quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities: ["A", "B"], historicalVerificationRequired: true });
  assert.equal(quality.canonicalReady, false);
  assert.deepEqual(quality.unresolved.filter((item) => item.kind === "political-actor"), [{ kind: "political-actor", polityKey: "B" }]);
});

test("membership becomes complete only when every live active institution is resolved", () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stagedWorld.institutions.byId.league = { id: "league", name: "League", foundedDate: "2001-01-01", members: {} };
  let quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities: ["A", "B"] });
  assert.equal(quality.counts.membershipInstitutionsResolved, 1);
  assert.equal(quality.counts.membershipInstitutionsTotal, 2);
  assert.equal(quality.counts.memberships, 0);
  assert.equal(quality.unresolved.filter((item) => item.kind === "membership").length, 2);

  checkpoint.membership.resolvedInstitutionIds.push("league");
  quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities: ["A", "B"] });
  assert.equal(quality.counts.memberships, 2);
  assert.equal(quality.unresolved.some((item) => item.kind === "membership"), false);
});

test("checkpoint normalization preserves persisted quality counts", () => {
  const checkpoint = readyCheckpoint();
  checkpoint.quality.counts = { politicalActors: 202, institutions: 12 };
  const normalized = normalizePoliticalWorldV2Checkpoint(checkpoint);
  assert.deepEqual(normalized.quality.counts, { politicalActors: 202, institutions: 12 });
});

test("Canonical quality cannot pass when an active reference pack expects institutions missing from staged canon", () => {
  const polities = ["A", "B"];
  const checkpoint = {
    status: "complete",
    stages: { institutionDiscovery: "complete", institutionGovernance: "complete", agreements: "complete" },
    coverage: {
      "political-actor": polities,
      "governing-alignment": polities,
      "historical-verification": polities,
    },
    bootstrap: {
      activeReferencePackIds: ["earth-history"],
      expectedReferenceInstitutionIds: Array.from({ length: 13 }, (_, index) => `inst-${index + 1}`),
      materializedReferenceInstitutionIds: ["inst-1", "inst-2", "inst-3", "inst-4"],
      missingReferenceInstitutionIds: Array.from({ length: 9 }, (_, index) => `inst-${index + 5}`),
      referenceCoveredInstitutionIds: ["inst-1", "inst-2", "inst-3", "inst-4"],
    },
    membership: { resolvedInstitutionIds: ["inst-1", "inst-2", "inst-3", "inst-4"] },
    stagedWorld: {
      institutions: {
        byId: Object.fromEntries([1, 2, 3, 4].map((index) => [`inst-${index}`, { id: `inst-${index}`, name: `Institution ${index}`, foundedDate: "1900-01-01", status: "active", members: [] }])),
      },
      powerStatus: { byPolity: { A: { score: 1 }, B: { score: 1 } } },
      agreements: [],
    },
  };

  const quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities, historicalVerificationRequired: true });
  assert.equal(quality.canonicalReady, false);
  assert.match(quality.blockingErrors.join("\n"), /reference knowledge is incomplete/i);
  assert.equal(quality.counts.referenceInstitutionsExpected, 13);
  assert.equal(quality.counts.referenceInstitutionsMaterialized, 4);
});


test("null fallback power records do not satisfy the Canonical power-evidence gate", () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stagedWorld.powerStatus.byPolity.A = { tier: "minor-power", score: null, baselineScore: null, basis: "native-fallback" };
  const quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities: ["A", "B"], historicalVerificationRequired: true });
  assert.equal(quality.counts.powerEvidence, 1);
  assert.equal(quality.canonicalReady, false);
  assert.deepEqual(quality.unresolved.filter((item) => item.kind === "power-evidence"), [{ kind: "power-evidence", polityKey: "A" }]);
});


test("Canonical quality rejects an otherwise behaviorally complete generated actor whose named electoral roster leaves a large Other residual", () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stagedWorld.politicalActors.byPolity.B = {
    ...completeActor("B"),
    parties: [
      { id: "gov", name: "Government Party", support: { percent: 50, basis: "generated-estimate" }, ideology: "Pragmatic", publicPriorities: ["Maintain stability"] },
      { id: "opp", name: "Opposition Party", support: { percent: 15, basis: "generated-estimate" }, ideology: "Conservative", publicPriorities: ["Oppose government"] },
    ],
  };
  const quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities: ["A", "B"], historicalVerificationRequired: true });
  assert.equal(quality.canonicalReady, false);
  assert.equal(quality.counts.politicalActors, 1);
  assert.deepEqual(quality.unresolved.filter((item) => item.kind === "political-actor"), [{ kind: "political-actor", polityKey: "B" }]);
});

test("Canonical quality rejects coverage-only Political Actor shells", () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stagedWorld.politicalActors.byPolity.B = {
    polityKey: "B",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", rulingPartyIds: ["gov"] },
    parties: [{ id: "gov", name: "Government Party", support: { percent: 55 } }],
  };
  const quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities: ["A", "B"], historicalVerificationRequired: true });
  assert.equal(quality.canonicalReady, false);
  assert.equal(quality.counts.politicalActors, 1);
  assert.deepEqual(quality.unresolved.filter((item) => item.kind === "political-actor"), [{ kind: "political-actor", polityKey: "B" }]);
});
