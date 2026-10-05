import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installFakeIndexedDb } from "../../../runtime/web/fakeIndexedDb.js";

// A run pauses before its next call when a checkpoint save does not reach
// durable storage, so these runs get an IndexedDB to save into.
installFakeIndexedDb();

// The pipeline's executor imports callAI from main.jsx, which node cannot load.
// These runs pass their own callModel, so a stub that fails loudly is enough.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./main.jsx" || specifier === "../main.jsx") {
      return {
        url: "data:text/javascript,export const callAI = async () => { throw new Error('unexpected callAI'); };",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { POLITICAL_WORLD_V2_ALREADY_RUNNING, generateOrResumePoliticalWorldV2 } = await import("./pipeline.js");
const { clearPoliticalWorldV2CheckpointMemoryForTests } = await import("./storage.js");

const runOptions = (scenarioId, callModel) => ({
  scenarioId,
  inputs: {
    scenarioDate: "2014-03-22",
    world: { polityOverrides: { Avalon: { name: "Avalon", status: "active" } } },
    polities: [{ polityKey: "Avalon", active: true }],
  },
  maxModelCalls: 1,
  callModel,
});

test("a second run on the same scenario is refused while the first is still going", async () => {
  clearPoliticalWorldV2CheckpointMemoryForTests();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const slowCallModel = async () => {
    calls += 1;
    await gate;
    throw new Error("provider unavailable");
  };

  const first = generateOrResumePoliticalWorldV2(runOptions("scenario-lock", slowCallModel));
  await assert.rejects(
    generateOrResumePoliticalWorldV2(runOptions("scenario-lock", slowCallModel)),
    (error) => error?.code === POLITICAL_WORLD_V2_ALREADY_RUNNING,
  );

  // Another scenario is not blocked by this one.
  const other = generateOrResumePoliticalWorldV2(runOptions("scenario-other", async () => { throw new Error("provider unavailable"); }));

  release();
  const firstCheckpoint = await first;
  await other;
  assert.equal(firstCheckpoint.status, "paused");
  assert.equal(calls, 1, "the refused run made no call");

  // Once the first run has ended, Resume is allowed again.
  const resumed = await generateOrResumePoliticalWorldV2(runOptions("scenario-lock", async () => { throw new Error("provider unavailable"); }));
  assert.equal(resumed.scenarioId, "scenario-lock");
});

test("a run that throws still releases the scenario", async () => {
  clearPoliticalWorldV2CheckpointMemoryForTests();
  await assert.rejects(generateOrResumePoliticalWorldV2({ scenarioId: "scenario-bad", inputs: { scenarioDate: "not a date" } }));
  await assert.rejects(
    generateOrResumePoliticalWorldV2({ scenarioId: "scenario-bad", inputs: { scenarioDate: "not a date" } }),
    (error) => error?.code !== POLITICAL_WORLD_V2_ALREADY_RUNNING,
  );
});

const partial = await import("./pipeline.js");
const { buildPoliticalWorldInputFingerprint, checkpointMatchesInput, createPoliticalWorldV2Checkpoint } = await import("./checkpoint.js");

const PARTIAL_DATE = "2014-03-22";
const sourceWorld = () => ({
  polityOverrides: {
    Avalon: { name: "Avalon", status: "active" },
    Borduria: { name: "Borduria", status: "active" },
  },
  politicalActors: { schemaVersion: 1, byPolity: {} },
});
const partialPolities = [{ polityKey: "Avalon", active: true }, { polityKey: "Borduria", active: true }];
const actor = (polityKey) => ({ polityKey, government: { form: "Parliamentary republic", headOfGovernment: `${polityKey} Leader` } });
const pausedAtCeiling = ({ world = sourceWorld(), verificationRequired = false, institutionsDone = false } = {}) => {
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId: "partial",
    scenarioDate: PARTIAL_DATE,
    inputFingerprint: buildPoliticalWorldInputFingerprint({ scenarioId: "partial", scenarioDate: PARTIAL_DATE, world }),
    stagedWorld: {
      ...structuredClone(world),
      politicalActors: { schemaVersion: 1, byPolity: { Avalon: actor("Avalon"), Borduria: actor("Borduria") } },
      powerStatus: {
        schemaVersion: 1,
        byPolity: {
          Avalon: { polityKey: "Avalon", tier: "regional-power", score: 55 },
          Borduria: { polityKey: "Borduria", tier: "minor-power", score: 20 },
        },
      },
      institutions: { schemaVersion: 1, byId: {} },
      agreements: [{ id: "avalon-borduria-pact", type: "non_aggression", parties: ["Avalon", "Borduria"], startedDate: "2010-01-01" }],
    },
  });
  checkpoint.status = "paused";
  checkpoint.pauseReason = "total-model-call-budget";
  checkpoint.historicalVerificationRequired = verificationRequired;
  checkpoint.coverage["political-actor"] = ["Avalon", "Borduria"];
  // Borduria's government was never aligned before the ceiling.
  checkpoint.coverage["governing-alignment"] = ["Avalon"];
  checkpoint.coverage["power-evidence"] = ["Avalon", "Borduria"];
  checkpoint.quality.unresolved = [{ kind: "governing-alignment", polityKey: "Borduria" }];
  checkpoint.quality.blockingErrors = institutionsDone ? [] : ["Standing-agreement resolution has not completed."];
  if (institutionsDone) {
    checkpoint.stages = { institutionDiscovery: "complete", institutionGovernance: "complete", agreements: "complete" };
  }
  return checkpoint;
};
const applyOptions = (checkpoint, freshWorld = sourceWorld()) => ({
  checkpoint,
  freshWorld,
  scenarioId: "partial",
  scenarioDate: PARTIAL_DATE,
  polities: partialPolities,
});

test("a run stopped at its ceiling finds the polities that passed every check", () => {
  assert.deepEqual(partial.completePoliticalWorldV2Work({ checkpoint: pausedAtCeiling(), polities: partialPolities }), { polities: ["Avalon"], institutions: false });
  // Where the scenario needs an exact-date check, an unchecked polity is not finished.
  assert.deepEqual(partial.completePoliticalWorldV2Work({ checkpoint: pausedAtCeiling({ verificationRequired: true }), polities: partialPolities }).polities, []);
  assert.equal(partial.completePoliticalWorldV2Work({ checkpoint: pausedAtCeiling({ institutionsDone: true }), polities: partialPolities }).institutions, true);
});

test("Apply what is complete writes only the finished polities and leaves everything else as the author has it", () => {
  const fresh = sourceWorld();
  fresh.politicalActors.byPolity.Borduria = { polityKey: "Borduria", government: { form: "Authored monarchy" } };
  const checkpoint = pausedAtCeiling({ world: fresh });
  const applied = partial.applyCompletePoliticalWorldV2Work(applyOptions(checkpoint, fresh));
  assert.deepEqual(applied.polities, ["Avalon"]);
  assert.equal(applied.institutions, false);
  assert.equal(applied.world.politicalActors.byPolity.Avalon.government.headOfGovernment, "Avalon Leader");
  assert.equal(applied.world.politicalActors.byPolity.Borduria.government.form, "Authored monarchy", "the unfinished polity keeps the author's actor");
  assert.deepEqual(Object.keys(applied.world.powerStatus.byPolity), ["Avalon"]);
  assert.equal(applied.world.agreements, undefined, "agreements wait until the institution layer is done");
  assert.equal(fresh.politicalActors.byPolity.Avalon, undefined, "the caller's world is not changed");
});

test("Apply what is complete brings the institutions and agreements once that layer is done", () => {
  const applied = partial.applyCompletePoliticalWorldV2Work(applyOptions(pausedAtCeiling({ institutionsDone: true })));
  assert.equal(applied.institutions, true);
  assert.deepEqual(applied.world.agreements.map((entry) => entry.id), ["avalon-borduria-pact"]);
});

test("Apply what is complete refuses an edited scenario and a run with nothing finished", () => {
  const edited = sourceWorld();
  edited.polityOverrides.Avalon.name = "Avalon Republic";
  assert.throws(() => partial.applyCompletePoliticalWorldV2Work(applyOptions(pausedAtCeiling(), edited)), /source canon changed/);
  assert.throws(
    () => partial.applyCompletePoliticalWorldV2Work(applyOptions(pausedAtCeiling({ verificationRequired: true }))),
    /nothing finished to apply/,
  );
});

test("after a partial Apply the checkpoint belongs to the saved scenario, so Resume and the final Apply carry on", async () => {
  clearPoliticalWorldV2CheckpointMemoryForTests();
  const checkpoint = pausedAtCeiling();
  const applied = partial.applyCompletePoliticalWorldV2Work(applyOptions(checkpoint));
  const kept = await partial.keepPoliticalWorldV2CheckpointAfterPartialApply({ checkpoint, world: applied.world, applied, now: "2026-09-29T00:00:00.000Z" });
  const savedKey = buildPoliticalWorldInputFingerprint({ scenarioId: "partial", scenarioDate: PARTIAL_DATE, world: applied.world });
  assert.equal(checkpointMatchesInput(kept, savedKey), true);
  assert.deepEqual(kept.partialApplications, [{ at: "2026-09-29T00:00:00.000Z", polities: ["Avalon"], institutions: false, depthByPolity: {} }]);
  assert.equal(kept.pauseReason, "total-model-call-budget", "the rest still waits for more calls");
  assert.deepEqual(kept.coverage["political-actor"], ["Avalon", "Borduria"], "no finished work is thrown away");
  // Applying the finished work again changes nothing.
  const again = partial.applyCompletePoliticalWorldV2Work(applyOptions(kept, applied.world));
  assert.deepEqual(again.world.politicalActors.byPolity.Avalon, applied.world.politicalActors.byPolity.Avalon);
});

// Behaviourally complete at standard depth, but without the response profiles
// rich depth asks for.
const standardActor = (polityKey) => ({
  polityKey,
  politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
  government: { form: "Parliamentary republic", ideology: "Pragmatic constitutional government", rulingPartyIds: ["gov"] },
  parties: [{ id: "gov", name: "Government Party", support: { percent: 55 }, ideology: "Pragmatic", publicPriorities: ["Maintain stability"] }],
  traits: { pragmatism: 60 },
  goals: ["Maintain national security"],
  fears: ["Strategic isolation"],
  ambitions: ["Improve regional influence"],
  domesticPressures: ["Budget constraints"],
  perceptions: { Borduria: { threat: 25 } },
});

test("a polity applied early keeps the depth it was built at, so Resume does not reopen it", async () => {
  clearPoliticalWorldV2CheckpointMemoryForTests();
  const checkpoint = pausedAtCeiling();
  checkpoint.stagedWorld.politicalActors.byPolity.Avalon = standardActor("Avalon");
  const before = { Avalon: { depth: "standard" }, Borduria: { depth: "standard" } };
  const applied = partial.applyCompletePoliticalWorldV2Work(applyOptions(checkpoint));
  let kept = await partial.keepPoliticalWorldV2CheckpointAfterPartialApply({ checkpoint, world: applied.world, applied, relevanceByPolity: before });
  assert.deepEqual(kept.partialApplications[0].depthByPolity, { Avalon: "standard" });

  // In balanced mode the actor now in the scenario makes Avalon rich. A second
  // partial Apply sees that raised depth but keeps the recorded one.
  const after = { Avalon: { depth: "rich" }, Borduria: { depth: "standard" } };
  kept = await partial.keepPoliticalWorldV2CheckpointAfterPartialApply({ checkpoint: kept, world: applied.world, applied, relevanceByPolity: after });
  assert.deepEqual(kept.partialApplications[1].depthByPolity, {});

  let calls = 0;
  const resumed = await generateOrResumePoliticalWorldV2({
    scenarioId: "partial",
    inputs: { scenarioDate: PARTIAL_DATE, world: applied.world, polities: partialPolities, relevanceByPolity: after },
    maxModelCalls: 1,
    callModel: async () => { calls += 1; throw new Error("provider unavailable"); },
  });
  assert.equal(resumed.partialApplications.length, 2, "Resume kept the checkpoint");
  assert.deepEqual(
    resumed.quality.unresolved.filter((item) => item.polityKey === "Avalon" && item.kind === "political-actor"),
    [],
    "the finished polity is not reopened at the raised depth",
  );
  assert.ok(calls <= 1);
});
