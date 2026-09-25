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
import {
  addPoliticalWorldV2Jobs,
  createPoliticalWorldV2Job,
  reopenFailedPoliticalWorldV2Jobs,
  resetInterruptedPoliticalWorldV2Jobs,
  summarizePoliticalWorldV2Jobs,
} from "./jobGraph.js";
import { runPoliticalWorldV2Jobs } from "./runner.js";


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

test("checkpoint normalization preserves external corrective political-system locks", () => {
  const checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22" });
  checkpoint.retryContext.politicalActor["Republic X"] = ["representation=party_state requires explicit one-party evidence"];
  checkpoint.retryContext.politicalSystemLocks["Republic X"] = { type: "dominant_party_republic" };
  const normalized = normalizePoliticalWorldV2Checkpoint(checkpoint);
  assert.deepEqual(normalized.retryContext.politicalSystemLocks, {
    "Republic X": { type: "dominant_party_republic" },
  });
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

test("runner pauses at finite call budget and resumes without rerunning completed jobs", async () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", scenarioDate: "2014-03-22", stagedWorld: {}, maxModelCalls: 2 });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "a", type: "actor", targets: ["A"] }),
    createPoliticalWorldV2Job({ id: "b", type: "actor", targets: ["B"] }),
    createPoliticalWorldV2Job({ id: "c", type: "actor", targets: ["C"] }),
  ]);
  const calls = [];
  checkpoint = await runPoliticalWorldV2Jobs({
    checkpoint,
    executeJob: async (job, checkpoint, { consumeModelCall }) => { await consumeModelCall(); calls.push(job.id); return { accepted: job.targets }; },
  });
  assert.equal(checkpoint.status, "paused");
  assert.equal(checkpoint.pauseReason, "model-call-budget");
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(summarizePoliticalWorldV2Jobs(checkpoint).completed, 2);

  checkpoint = await runPoliticalWorldV2Jobs({
    checkpoint,
    maxModelCalls: 2,
    executeJob: async (job, current, { consumeModelCall }) => { await consumeModelCall(); calls.push(job.id); return { accepted: job.targets }; },
  });
  assert.equal(checkpoint.status, "complete");
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.equal(summarizePoliticalWorldV2Jobs(checkpoint).completed, 3);
});

test("dependency graph preserves completed work and blocks child until parent completes", async () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", stagedWorld: {}, maxModelCalls: 10 });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "catalog", type: "institution-catalog" }),
    createPoliticalWorldV2Job({ id: "members", type: "memberships", dependencies: ["catalog"] }),
  ]);
  const order = [];
  checkpoint = await runPoliticalWorldV2Jobs({ checkpoint, executeJob: async (job) => { order.push(job.id); return {}; } });
  assert.deepEqual(order, ["catalog", "members"]);
  assert.equal(checkpoint.status, "complete");
});

test("interrupted running jobs reset to pending without consuming their domain retry", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    { ...createPoliticalWorldV2Job({ id: "done", type: "x", maxAttempts: 1 }), status: "completed", attempts: 1 },
    { ...createPoliticalWorldV2Job({ id: "running", type: "x", maxAttempts: 1 }), status: "running", attempts: 1, startedAt: "2026-09-07T00:00:00Z" },
  ]);
  checkpoint = resetInterruptedPoliticalWorldV2Jobs(checkpoint);
  assert.equal(checkpoint.jobs.done.status, "completed");
  assert.equal(checkpoint.jobs.running.status, "pending");
  assert.equal(checkpoint.jobs.running.attempts, 0);
  assert.equal(checkpoint.jobs.running.startedAt, "");
});

test("newly created repair jobs are preferred before unrelated downstream work", async () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", maxModelCalls: 10 });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "actor", type: "actor" }),
    createPoliticalWorldV2Job({ id: "later", type: "later", dependencies: ["actor"] }),
  ]);
  const order = [];
  checkpoint = await runPoliticalWorldV2Jobs({
    checkpoint,
    executeJob: async (job) => {
      order.push(job.id);
      return {};
    },
    applyJobResult: async ({ checkpoint: current, job }) => {
      if (job.id !== "actor") return { stagedWorld: current.stagedWorld };
      return {
        stagedWorld: current.stagedWorld,
        newJobs: [createPoliticalWorldV2Job({ id: "repair:actor:1", type: "actor", payload: { repairDepth: 1 }, dependencies: ["actor"] })],
      };
    },
  });
  assert.deepEqual(order, ["actor", "repair:actor:1", "later"]);
});


test("a later explicit Resume can reopen only failed jobs without discarding completed work", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    { ...createPoliticalWorldV2Job({ id: "done", type: "x", maxAttempts: 1 }), status: "completed", attempts: 1, result: { acceptedPolities: ["A"] } },
    { ...createPoliticalWorldV2Job({ id: "failed", type: "x", maxAttempts: 1 }), status: "failed", attempts: 1, error: "provider failed" },
  ]);
  checkpoint.status = "blocked";
  checkpoint = reopenFailedPoliticalWorldV2Jobs(checkpoint);
  assert.equal(checkpoint.jobs.done.status, "completed");
  assert.deepEqual(checkpoint.jobs.done.result, { acceptedPolities: ["A"] });
  assert.equal(checkpoint.jobs.failed.status, "pending");
  assert.equal(checkpoint.jobs.failed.attempts, 0);
  assert.equal(checkpoint.jobs.failed.error, "");
});

test("checkpoint matching is exact and explicit", () => {
  const checkpoint = createPoliticalWorldV2Checkpoint({ inputFingerprint: "pw2-abc" });
  assert.equal(checkpointMatchesInput(checkpoint, "pw2-abc"), true);
  assert.equal(checkpointMatchesInput(checkpoint, "pw2-def"), false);
});


test("repeated failed Resume cycles are bounded so a deterministic failure cannot drain quota forever", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  const failed = createPoliticalWorldV2Job({ id: "failed", type: "x", maxAttempts: 1 });
  failed.status = "failed";
  failed.attempts = 1;
  failed.error = "same validation failure";
  failed.payload = { resumeFailureCount: 2 };
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [failed]);
  checkpoint = reopenFailedPoliticalWorldV2Jobs(checkpoint);
  assert.equal(checkpoint.jobs.failed.status, "failed");
  assert.equal(checkpoint.jobs.failed.payload.resumeFailureCount, 2);
});

test("runner records no completed coverage when domain staging rejects a provider result", async () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s", maxModelCalls: 5 });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "actor", type: "political-actor", targets: ["A"], maxAttempts: 1 }),
  ]);
  checkpoint = await runPoliticalWorldV2Jobs({
    checkpoint,
    executeJob: async () => ({ acceptedPolities: ["A"] }),
    applyJobResult: async () => { throw new Error("staging rejected result"); },
  });
  assert.equal(checkpoint.jobs.actor.status, "failed");
  assert.deepEqual(checkpoint.coverage["political-actor"] || [], []);
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
