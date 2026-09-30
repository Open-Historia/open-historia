import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPoliticalWorldInputFingerprint,
  checkpointMatchesInput,
  createPoliticalWorldV2Checkpoint,
  normalizePoliticalWorldV2Checkpoint,
  recordPoliticalWorldV2ModelCall,
  POLITICAL_WORLD_V2_DEFAULT_TOTAL_MODEL_CALL_CEILING,
  POLITICAL_WORLD_V2_LEGACY_OVERRUN_ALLOWANCE,
  POLITICAL_WORLD_V2_LEGACY_CORRECTION_REPAIR_ALLOWANCE,
  POLITICAL_WORLD_V2_TOTAL_CEILING_SCHEMA_VERSION,
} from "./checkpoint.js";


test("checkpoint records provider calls by task type and high-level stage without changing the total budget counter", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22" });
  checkpoint = recordPoliticalWorldV2ModelCall(checkpoint, { type: "political-actor", stage: "politics" });
  checkpoint = recordPoliticalWorldV2ModelCall(checkpoint, { type: "political-actor", stage: "politics" });
  checkpoint = recordPoliticalWorldV2ModelCall(checkpoint, { type: "temporal-sentinel", stage: "verification" });
  assert.equal(checkpoint.modelCalls, 3);
  assert.deepEqual(checkpoint.modelCallsByType, { "political-actor": 2, "temporal-sentinel": 1 });
  assert.deepEqual(checkpoint.modelCallsByStage, { politics: 2, verification: 1 });

  const normalized = normalizePoliticalWorldV2Checkpoint({
    ...checkpoint,
    modelCallsByType: { ...checkpoint.modelCallsByType, bad: -5, zero: 0 },
    modelCallsByStage: { ...checkpoint.modelCallsByStage, broken: "nope" },
  });
  assert.deepEqual(normalized.modelCallsByType, { "political-actor": 2, "temporal-sentinel": 1 });
  assert.deepEqual(normalized.modelCallsByStage, { politics: 2, verification: 1 });
});

test("fresh checkpoints stay hard-capped at 100 while pre-CP2 overrun work receives one bounded correction-repair migration", () => {
  const fresh = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22" });
  assert.equal(POLITICAL_WORLD_V2_DEFAULT_TOTAL_MODEL_CALL_CEILING, 100);
  assert.equal(POLITICAL_WORLD_V2_TOTAL_CEILING_SCHEMA_VERSION, 2);
  assert.equal(fresh.totalModelCallCeiling, 100);
  assert.equal(fresh.totalModelCallCeilingVersion, 2);

  const lowLegacy = { ...fresh, totalModelCallCeiling: undefined, totalModelCallCeilingVersion: undefined, modelCalls: 42 };
  const lowMigrated = normalizePoliticalWorldV2Checkpoint(lowLegacy);
  assert.equal(lowMigrated.totalModelCallCeiling, 100);
  assert.equal(lowMigrated.totalModelCallCeilingVersion, 2);

  const overrunLegacy = { ...fresh, totalModelCallCeiling: undefined, totalModelCallCeilingVersion: undefined, modelCalls: 295 };
  const migrated = normalizePoliticalWorldV2Checkpoint(overrunLegacy);
  assert.equal(POLITICAL_WORLD_V2_LEGACY_OVERRUN_ALLOWANCE, 60);
  assert.equal(POLITICAL_WORLD_V2_LEGACY_CORRECTION_REPAIR_ALLOWANCE, 20);
  assert.equal(migrated.totalModelCallCeiling, 375);
  assert.equal(migrated.modelCalls, 295);

  const cp1RescuedAtCeiling = { ...fresh, totalModelCallCeiling: 355, totalModelCallCeilingVersion: undefined, modelCalls: 355 };
  const cp2Migrated = normalizePoliticalWorldV2Checkpoint(cp1RescuedAtCeiling);
  assert.equal(cp2Migrated.totalModelCallCeiling, 375);
  assert.equal(normalizePoliticalWorldV2Checkpoint(cp2Migrated).totalModelCallCeiling, 375, "the repair allowance is a one-time migration, not a renewable budget");
});

test("political fingerprint ignores map styling but invalidates political inputs", () => {
  const base = {
    scenarioId: "s",
    scenarioDate: "2014-03-22",
    world: {
      startingTimelineText: "History",
      simulationRules: "Rules",
      canonContext: { universe: { id: "historical-earth", type: "historical" } },
      labelFont: "Georgia",
    },
  };
  const first = buildPoliticalWorldInputFingerprint(base);
  const styleChanged = buildPoliticalWorldInputFingerprint({ ...base, world: { ...base.world, labelFont: "Arial", labelTextColor: "#fff" } });
  const politicsChanged = buildPoliticalWorldInputFingerprint({ ...base, world: { ...base.world, simulationRules: "Different rules" } });
  assert.equal(first, styleChanged);
  assert.notEqual(first, politicsChanged);
});

test("checkpoint matching is exact and explicit", () => {
  const checkpoint = createPoliticalWorldV2Checkpoint({ inputFingerprint: "pw2-abc" });
  assert.equal(checkpointMatchesInput(checkpoint, "pw2-abc"), true);
  assert.equal(checkpointMatchesInput(checkpoint, "pw2-def"), false);
});

test("checkpoint v5 deliberately rejects old v2/v3/v4 workspace checkpoints", async () => {
  const { isPoliticalWorldV2Checkpoint, POLITICAL_WORLD_V2_CHECKPOINT_VERSION } = await import("./checkpoint.js");
  assert.equal(POLITICAL_WORLD_V2_CHECKPOINT_VERSION, 5);
  assert.equal(isPoliticalWorldV2Checkpoint({ kind: "political-world-checkpoint-v2", version: 2 }), false);
  assert.equal(isPoliticalWorldV2Checkpoint({ kind: "political-world-checkpoint-v2", version: 3 }), false);
});

test("Political World fingerprint includes authored WBR1/divergence canon and explicit territorial destination", () => {
  const base = {
    scenarioId: "scenario-a",
    scenarioDate: "2400-01-01",
    world: {
      canonContext: { universe: { id: "source-world", type: "alternate" } },
      ownerCodes: ["A", "B"],
      regionOwnershipOverrides: { r1: "A" },
    },
    roundZeroContext: {
      scenario: { description: "A divergent source world." },
      universe: { id: "source-world", type: "alternate" },
      historyAuthority: { referenceAuthority: "pre-divergence-only", cutoffDate: "2300-01-01", cutoffInclusive: false },
      divergence: { date: "2300-01-01", authoredText: "2300-01-01: The branch begins." },
      worldBeforeRoundOne: "2350-01-01: The authored branch develops differently.",
    },
  };
  const first = buildPoliticalWorldInputFingerprint(base);
  const changedWbr1 = buildPoliticalWorldInputFingerprint({
    ...base,
    roundZeroContext: {
      ...base.roundZeroContext,
      worldBeforeRoundOne: "2350-01-01: A materially different authored branch develops.",
    },
  });
  const changedDivergence = buildPoliticalWorldInputFingerprint({
    ...base,
    roundZeroContext: {
      ...base.roundZeroContext,
      divergence: { date: "2310-01-01", authoredText: "2310-01-01: The branch begins later." },
    },
  });
  const changedTerritory = buildPoliticalWorldInputFingerprint({
    ...base,
    world: { ...base.world, regionOwnershipOverrides: { r1: "B" } },
  });
  assert.notEqual(first, changedWbr1, "authored World Before Round One must invalidate stale PWV2 work");
  assert.notEqual(first, changedDivergence, "the reference-canon cutoff must invalidate stale PWV2 work");
  assert.notEqual(first, changedTerritory, "explicit start-world territory must invalidate political generation");
});

test("allowing more calls past the lifetime ceiling raises it one recorded step and clears the pause", async () => {
  const { grantPoliticalWorldV2ModelCalls, POLITICAL_WORLD_V2_CEILING_GRANT } = await import("./checkpoint.js");
  const checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22" });
  checkpoint.modelCalls = 100;
  checkpoint.status = "paused";
  checkpoint.pauseReason = "total-model-call-budget";
  checkpoint.lastError = "Political World generation reached its lifetime safety ceiling of 100 AI calls.";
  const granted = grantPoliticalWorldV2ModelCalls(checkpoint, { now: "2026-09-28T00:00:00.000Z" });
  assert.equal(granted.totalModelCallCeiling, 100 + POLITICAL_WORLD_V2_CEILING_GRANT);
  assert.deepEqual(granted.ceilingGrants, [{ at: "2026-09-28T00:00:00.000Z", from: 100, to: 125, amount: 25 }]);
  assert.equal(granted.status, "ready");
  assert.equal(granted.pauseReason, "");
  assert.equal(granted.lastError, "");
  assert.equal(checkpoint.totalModelCallCeiling, 100, "the input checkpoint is not mutated");

  const again = normalizePoliticalWorldV2Checkpoint(grantPoliticalWorldV2ModelCalls(granted));
  assert.equal(again.totalModelCallCeiling, 150);
  assert.equal(again.ceilingGrants.length, 2, "grants survive normalization");
});

test("a checkpoint saved before partial Apply existed reads with an empty log, and a logged one keeps its entries", () => {
  const older = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22" });
  delete older.partialApplications;
  assert.deepEqual(normalizePoliticalWorldV2Checkpoint(older).partialApplications, []);

  const logged = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22" });
  logged.partialApplications = [{ at: "2026-09-29T00:00:00.000Z", polities: ["Avalon", "Avalon", ""], institutions: true }, "junk"];
  assert.deepEqual(normalizePoliticalWorldV2Checkpoint(logged).partialApplications, [
    { at: "2026-09-29T00:00:00.000Z", polities: ["Avalon"], institutions: true },
  ]);
});
