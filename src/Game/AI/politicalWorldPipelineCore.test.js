import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPoliticalWorldPipelineCore,
  buildPoliticalWorldPipelineDiagnosticCore,
  generatePoliticalWorldPipelineCore,
  resumePoliticalWorldPipelineGeopoliticsCore,
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

test("unified pipeline stages politics then governing alignment before geopolitical generation without mutating input world", async () => {
  const world = { politicalActors: { byPolity: {} }, sentinel: { untouched: true } };
  let alignmentSawStagedPolitics = false;
  let geopoliticsSawAlignment = false;

  const result = await generatePoliticalWorldPipelineCore({
    scenarioDate,
    polities: [{ polityKey }],
    politicalActors: world.politicalActors,
    world,
    generatePolitics: async () => politicsResult,
    generateGoverningAlignment: async ({ politicalActors }) => {
      alignmentSawStagedPolitics = politicalActors.byPolity[polityKey]?.parties?.[0]?.id === "civic-league";
      return alignmentResult;
    },
    generateGeopolitics: async ({ world: stagedWorld }) => {
      geopoliticsSawAlignment = stagedWorld.politicalActors.byPolity[polityKey]?.government?.rulingPartyIds?.[0] === "civic-league";
      return geopoliticalResult;
    },
  });

  assert.equal(result.complete, true, JSON.stringify(result.blockingErrors));
  assert.equal(alignmentSawStagedPolitics, true);
  assert.equal(geopoliticsSawAlignment, true);
  assert.deepEqual(world, { politicalActors: { byPolity: {} }, sentinel: { untouched: true } }, "Generate must remain review-only");
});

test("unified pipeline fails closed before later phases when Political Actor generation has failures", async () => {
  let alignmentCalled = false;
  let geopoliticsCalled = false;
  const failedPolitics = {
    ...politicsResult,
    proposals: [],
    failures: [{ polityKey, errors: ["provider omitted polity"] }],
    generatedPolities: 0,
    failedPolities: 1,
  };

  const result = await generatePoliticalWorldPipelineCore({
    scenarioDate,
    polities: [{ polityKey }],
    politicalActors: { byPolity: {} },
    world: { politicalActors: { byPolity: {} } },
    generatePolitics: async () => failedPolitics,
    generateGoverningAlignment: async () => { alignmentCalled = true; return alignmentResult; },
    generateGeopolitics: async () => { geopoliticsCalled = true; return geopoliticalResult; },
  });

  assert.equal(result.complete, false);
  assert.equal(result.blockingErrors.length, 1);
  assert.equal(alignmentCalled, false);
  assert.equal(geopoliticsCalled, false);
});

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


test("geopolitical resume reuses clean staged politics and governing alignment without regenerating either stage", async () => {
  const priorResult = {
    schemaVersion: 1,
    kind: "political-world-pipeline-result",
    scenarioDate,
    generatedAt: "2026-09-07T00:00:03Z",
    allowEntityExpansion: false,
    politics: politicsResult,
    governingAlignment: alignmentResult,
    geopolitics: { ...geopoliticalResult, blockingErrors: ["old failure"] },
    blockingErrors: ["old failure"],
    complete: false,
  };
  let geopoliticalCalls = 0;
  let sawStagedAlignment = false;
  const resumed = await resumePoliticalWorldPipelineGeopoliticsCore({
    scenarioDate,
    polities: [{ polityKey }],
    politicalActors: { byPolity: {} },
    world: { politicalActors: { byPolity: {} }, untouched: true },
    priorResult,
    generateGeopolitics: async ({ world }) => {
      geopoliticalCalls += 1;
      sawStagedAlignment = world.politicalActors.byPolity[polityKey]?.government?.rulingPartyIds?.[0] === "civic-league";
      return geopoliticalResult;
    },
  });

  assert.equal(geopoliticalCalls, 1);
  assert.equal(sawStagedAlignment, true);
  assert.equal(resumed.complete, true);
  assert.deepEqual(resumed.blockingErrors, []);
  assert.equal(resumed.politics, politicsResult);
  assert.equal(resumed.governingAlignment, alignmentResult);
});

test("unified legacy pipeline propagates one history-authority contract through politics, alignment and geopolitics", async () => {
  const historyAuthority = {
    referenceAllowed: true,
    referenceAuthority: "pre-divergence-only",
    cutoffDate: "2050-01-01",
    cutoffInclusive: false,
  };
  const seen = [];
  const result = await generatePoliticalWorldPipelineCore({
    scenarioDate,
    historyAuthority,
    polities: [{ polityKey }],
    politicalActors: { byPolity: {} },
    world: { politicalActors: { byPolity: {} } },
    generatePolitics: async (args) => { seen.push(["politics", args.historyAuthority]); return politicsResult; },
    generateGoverningAlignment: async (args) => { seen.push(["alignment", args.historyAuthority]); return alignmentResult; },
    generateGeopolitics: async (args) => { seen.push(["geopolitics", args.historyAuthority]); return geopoliticalResult; },
  });
  assert.equal(result.complete, true, JSON.stringify(result.blockingErrors));
  assert.deepEqual(seen, [
    ["politics", historyAuthority],
    ["alignment", historyAuthority],
    ["geopolitics", historyAuthority],
  ]);
});
