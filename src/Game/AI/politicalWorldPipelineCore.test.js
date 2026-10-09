import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPoliticalWorldPipelineCore,
  buildPoliticalWorldPipelineDiagnosticCore,
} from "./politicalWorldPipelineCore.js";

const scenarioDate = "2067-04-19";
const polityKey = "Kingdom of Poland";

const politicsProposal = {
  schemaVersion: 1,
  polityKey,
  scenarioDate,
  depth: "rich",
  provenance: { source: "generated", confidence: "moderate", generatedAt: "2026-09-07T00:00:00Z" },
  actorPatch: {
    politicalSystem: { type: "constitutional_monarchy", representation: "electoral" },
    government: { form: "Constitutional monarchy", ideology: "Civic constitutionalism" },
    parties: [{ id: "civic-league", name: "Civic League", politicalResponse: { organization: 65 } }],
    traits: { riskTolerance: 48 },
    goals: ["Preserve the constitutional settlement"],
  },
};

const alignmentProposal = {
  schemaVersion: 1,
  polityKey,
  scenarioDate,
  depth: "rich",
  provenance: { source: "generated", confidence: "high", generatedAt: "2026-09-07T00:00:01Z" },
  actorPatch: { government: { rulingPartyIds: ["civic-league"], coalitionPartyIds: [] } },
};

const politicsResult = {
  scenarioDate,
  generatedAt: "2026-09-07T00:00:00Z",
  plan: { items: [{ polityKey, depth: "rich", needs: ["political_system"] }] },
  proposals: [{ item: { polityKey, depth: "rich", needs: ["political_system"] }, proposal: politicsProposal }],
  failures: [],
  warnings: [],
  batches: [],
  diagnostics: [],
  generatedPolities: 1,
  failedPolities: 0,
};

const alignmentResult = {
  scenarioDate,
  generatedAt: "2026-09-07T00:00:01Z",
  plan: { items: [{ polityKey, depth: "rich", needs: ["governing_alignment"] }] },
  proposals: [{ item: { polityKey, depth: "rich", needs: ["governing_alignment"] }, proposal: alignmentProposal }],
  failures: [],
  warnings: [],
  batches: [],
  diagnostics: [],
  governingAlignmentRepair: { requested: 1, nonPartisan: [], modelCalls: 1 },
  generatedPolities: 1,
  failedPolities: 0,
};

const geopoliticalResult = {
  scenarioDate,
  generatedAt: "2026-09-07T00:00:02Z",
  requestedPolities: 1,
  records: [{ polityKey, regimeCharacter: "democratic", memberships: [] }],
  institutionCatalog: [],
  powerCalibration: [{ polityKey, strategicWeight: 50, note: "test" }],
  agreements: [],
  warnings: [],
  diagnostics: [],
  blockingErrors: [],
  modelCalls: 3,
};

test("Apply Political World revalidates both political stages and commits through one final geopolitical application", () => {
  const pipeline = {
    schemaVersion: 1,
    kind: "political-world-pipeline-result",
    scenarioDate,
    generatedAt: "2026-09-07T00:00:03Z",
    allowEntityExpansion: false,
    politics: politicsResult,
    governingAlignment: alignmentResult,
    geopolitics: geopoliticalResult,
    blockingErrors: [],
    complete: true,
  };
  let sawAlignedWorld = false;
  const inputWorld = { politicalActors: { byPolity: {} }, marker: "original" };
  const applied = applyPoliticalWorldPipelineCore({
    world: inputWorld,
    result: pipeline,
    date: scenarioDate,
    applyGeopolitics: ({ world }) => {
      sawAlignedWorld = world.politicalActors.byPolity[polityKey]?.government?.rulingPartyIds?.[0] === "civic-league";
      return { world: { ...world, geopoliticalApplied: true }, applied: ["geo:test"], warnings: [] };
    },
  });

  assert.equal(sawAlignedWorld, true);
  assert.equal(applied.world.geopoliticalApplied, true);
  assert.equal(applied.applied.politics.length, 1);
  assert.equal(applied.applied.governingAlignment.length, 1);
  assert.ok(applied.world.politicalActors.byPolity[polityKey].behavioralDisposition?.riskTolerance >= 0);
  assert.equal(applied.world.politicalActors.byPolity[polityKey].behavioralDisposition?.updatedAt, scenarioDate);
  assert.deepEqual(applied.world.politicalActors.byPolity[polityKey].goals, politicsProposal.actorPatch.goals);
  assert.deepEqual(inputWorld, { politicalActors: { byPolity: {} }, marker: "original" }, "Apply helper must not mutate caller world before persistence");
});

test("combined diagnostic retains all three phase results and uses staged politics for geopolitical preview", () => {
  const pipeline = {
    schemaVersion: 1,
    kind: "political-world-pipeline-result",
    scenarioDate,
    generatedAt: "2026-09-07T00:00:03Z",
    allowEntityExpansion: false,
    politics: politicsResult,
    governingAlignment: alignmentResult,
    geopolitics: geopoliticalResult,
    blockingErrors: [],
    complete: true,
  };
  let previewSawAlignment = false;
  const diagnostic = buildPoliticalWorldPipelineDiagnosticCore({
    result: pipeline,
    world: { politicalActors: { byPolity: {} } },
    scenario: { id: "scenario-1", name: "Pipeline Test" },
    buildGeopoliticalDiagnostic: ({ world }) => {
      previewSawAlignment = world.politicalActors.byPolity[polityKey]?.government?.rulingPartyIds?.[0] === "civic-league";
      return { kind: "geopolitical-baseline-diagnostic", ok: true };
    },
  });

  assert.equal(previewSawAlignment, true);
  assert.equal(diagnostic.kind, "political-world-pipeline-diagnostic");
  assert.equal(diagnostic.politics.accepted, 1);
  assert.equal(diagnostic.governingAlignment.accepted, 1);
  assert.equal(diagnostic.geopolitics.ok, true);
});
