import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// main.jsx is the browser AI runtime and cannot load in node. Every call here
// goes through the injected callModel, so a stub that fails loudly is enough.
registerHooks({
  resolve(specifier, context, next) {
    if (/(^|\/)main\.jsx$/.test(specifier)) {
      return { url: "data:text/javascript,export const callAI = async () => { throw new Error('callAI is not available in tests'); };", shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { createPoliticalWorldV2Checkpoint } = await import("./checkpoint.js");
const { runSimplePoliticalWorldV2 } = await import("./simpleRunner.js");

const polities = ["A", "B", "C"];
const inputs = { scenarioDate: "2014-03-22", polities };
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

// Actors and alignment done; the next task is the one the test sets up.
const readyCheckpoint = () => {
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId: "s",
    scenarioDate: "2014-03-22",
    stagedWorld: {
      institutions: { schemaVersion: 1, byId: {} },
      powerStatus: { byPolity: Object.fromEntries(polities.map((polity) => [polity, { tier: "regional-power", score: 58, baselineScore: 58, basis: "generated-relative-baseline" }])) },
      politicalActors: { schemaVersion: 1, byPolity: Object.fromEntries(polities.map((polity) => [polity, completeActor(polity)])) },
    },
  });
  checkpoint.coverage["political-actor"] = [...polities];
  checkpoint.coverage["governing-alignment"] = [...polities];
  return checkpoint;
};

const withUncoveredInstitution = () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stagedWorld.institutions.byId.pact = { id: "pact", name: "Pact", kind: "alliance", foundedDate: "2000-01-01", members: {} };
  return checkpoint;
};

const membersAnswer = (rows) => ({ toolInput: { membersJson: JSON.stringify(rows) } });

test("a member the map lacks is left out instead of refusing the institution", async () => {
  const result = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 1,
    callModel: async () => membersAnswer([
      { polityKey: "A", status: "member", role: "member", joinedDate: "" },
      { polityKey: "Atlantis", status: "member", role: "member", joinedDate: "" },
    ]),
  });
  assert.deepEqual(result.membership.resolvedInstitutionIds, ["pact"]);
  assert.ok(result.stagedWorld.institutions.byId.pact.members.some((member) => member.polity === "A"));
  assert.ok(!result.stagedWorld.institutions.byId.pact.members.some((member) => member.polity === "Atlantis"));
  assert.ok(result.warnings.some((warning) => /Atlantis/.test(warning)));
  assert.equal(result.pauseReason, "model-call-budget");
});

test("an institution the model keeps answering wrongly is deferred after its bounded attempts, not paused on every Resume", async () => {
  let calls = 0;
  const result = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 10,
    callModel: async () => {
      calls += 1;
      return membersAnswer([{ polityKey: "A", status: "honorary", role: "member" }]);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.modelCalls, 2);
  assert.equal(result.attempts["institution-membership-resolution:pact"], 2);
  assert.deepEqual(result.membership.resolvedInstitutionIds, []);
  assert.equal(result.pauseReason, "bounded-unresolved");
  assert.ok(result.worklistSummary.deferred.some((entry) => entry.kind === "institution-membership-resolution" && entry.target === "pact"));
});

test("a truncated power batch counts an attempt instead of pausing the run", async () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stages.institutionGovernance = "complete";
  checkpoint.stages.agreements = "complete";
  checkpoint.stagedWorld.powerStatus.byPolity = {};
  const requested = [];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 2,
    callModel: async (_system, history) => {
      requested.push(String(history?.at(-1)?.parts?.[0]?.text ?? ""));
      return { toolInput: { powerJson: "[{\"polityKey\":\"A\",\"strategicWeight\":50}," } };
    },
  });
  assert.equal(result.modelCalls, 2);
  assert.equal(result.attempts["power-evidence:A"], 2);
  assert.notEqual(result.pauseReason, "task-error");
  assert.equal(result.pauseReason, "model-call-budget");
});

test("a task that throws after its answer came back counts an attempt; a failed provider call pauses without one", async () => {
  const afterAnswer = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 1,
    createExecutor: () => ({
      executeJob: async (_task, _checkpoint, { consumeModelCall }) => {
        await consumeModelCall();
        throw new Error("Political World v2 task exceeded its bounded provider-call ceiling (1).");
      },
      applyJobResult: async () => ({}),
    }),
  });
  assert.equal(afterAnswer.attempts["institution-membership-resolution:pact"], 1);
  assert.equal(afterAnswer.pauseReason, "model-call-budget");
  assert.ok(afterAnswer.warnings.some((warning) => /bounded provider-call ceiling/.test(warning)));

  const providerDown = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 5,
    createExecutor: () => ({
      executeJob: async (_task, _checkpoint, { consumeModelCall }) => {
        await consumeModelCall();
        const error = new Error("Failed to fetch");
        error.politicalWorldV2ProviderCall = true;
        throw error;
      },
      applyJobResult: async () => ({}),
    }),
  });
  assert.equal(providerDown.pauseReason, "provider-unavailable");
  assert.equal(providerDown.attempts["institution-membership-resolution:pact"], undefined);
  assert.equal(providerDown.modelCalls, 1);
});

test("the real executor marks a failed provider call so the run pauses without penalizing the target", async () => {
  const result = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 5,
    callModel: async () => { throw new Error("429 Too Many Requests"); },
  });
  assert.equal(result.pauseReason, "provider-rate-limit");
  assert.equal(result.attempts["institution-membership-resolution:pact"], undefined);
});

test("a landscape-only actor and a new actor are two one-call tasks, not one task that breaks its ceiling", async () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stagedWorld.politicalActors.byPolity.A = {
    ...completeActor("A"),
    parties: [{ id: "gov", name: "Government Party", ideology: "Pragmatic", publicPriorities: ["Maintain stability"] }],
  };
  delete checkpoint.stagedWorld.politicalActors.byPolity.C;
  checkpoint.coverage["political-actor"] = ["B"];
  const tools = [];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 2,
    callModel: async (_system, _history, options) => {
      tools.push(options?.tool?.name);
      if (options?.tool?.name === "submit_political_world_quantitative_landscapes") {
        return { toolInput: { landscapes: [{ polityKey: "A", landscapeJson: "{\"gov\":92}" }] } };
      }
      return { toolInput: { proposals: [] } };
    },
  });
  assert.deepEqual(tools, ["submit_political_world_quantitative_landscapes", "submit_political_world_generation"]);
  assert.ok(result.coverage["political-actor"].includes("A"));
  assert.ok(!result.warnings.some((warning) => /provider-call ceiling/.test(warning)));
});

// A stand-in executor: one paid call, then the given result and staging.
const scriptedExecutor = ({ result = {}, stage = () => {} } = {}) => () => ({
  executeJob: async (_task, _checkpoint, { consumeModelCall }) => {
    await consumeModelCall();
    return structuredClone(result);
  },
  applyJobResult: async ({ checkpoint, job, result: given }) => {
    stage({ checkpoint, job, result: given });
    return { stagedWorld: checkpoint.stagedWorld, newJobs: [] };
  },
});

test("a staging rejection's own errors reach the political-actor retry feedback", async () => {
  const checkpoint = readyCheckpoint();
  delete checkpoint.stagedWorld.politicalActors.byPolity.C;
  checkpoint.coverage["political-actor"] = ["A", "B"];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 1,
    createExecutor: scriptedExecutor({
      result: { generation: { proposals: [], failures: [] }, acceptedPolities: ["C"], unresolvedPolities: [] },
      stage: ({ result: given }) => {
        given.stagingRejectedPolities = ["C"];
        given.stagingErrorsByPolity = { C: ["parties[0].id gov collides with an authored party"] };
      },
    }),
  });
  assert.deepEqual(result.retryContext.politicalActor.C, ["parties[0].id gov collides with an authored party"]);
  assert.equal(result.attempts["political-actor:C"], 1);
});

test("a governing alignment rejected at staging is not counted as aligned", async () => {
  const checkpoint = readyCheckpoint();
  checkpoint.coverage["governing-alignment"] = [];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 1,
    createExecutor: scriptedExecutor({
      result: { generation: { proposals: [], failures: [] }, acceptedPolities: ["A", "B", "C"], unresolvedPolities: [] },
      stage: ({ result: given }) => { given.stagingRejectedPolities = ["B"]; },
    }),
  });
  assert.deepEqual(result.coverage["governing-alignment"].sort(), ["A", "C"]);
  assert.equal(result.attempts["governing-alignment:B"], 1);
});

test("the sentinel's challenged paths reach the exact-date verification prompt", async () => {
  const checkpoint = readyCheckpoint();
  checkpoint.historicalVerificationRequired = true;
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stages.institutionGovernance = "complete";
  checkpoint.stages.agreements = "complete";
  const actorPatch = { government: { form: "Parliamentary republic", headOfGovernment: "Leader Old" } };
  checkpoint.generationEntriesByPolity.B = {
    item: { polityKey: "B", depth: "standard", needs: ["governing_structure"] },
    proposal: { polityKey: "B", actorPatch },
    validation: { actor: { ...completeActor("B"), ...actorPatch } },
  };
  checkpoint.verification.challenges.B = {
    issue: "The head of government changed before the scenario date.",
    challengedFacts: [{ id: "F2", path: "government.headOfGovernment", display: "Leader Old" }],
  };
  let prompt = "";
  await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 1,
    callModel: async (_system, history) => {
      prompt = String(history?.at(-1)?.parts?.[0]?.text ?? "");
      return { toolInput: { verifications: [] } };
    },
  });
  assert.match(prompt, /CHALLENGED GENERATED TEMPORAL PATHS:\n- government\.headOfGovernment = Leader Old/);
});

const finishedCheckpoint = () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stages.institutionGovernance = "complete";
  checkpoint.stages.agreements = "complete";
  return checkpoint;
};
const noCalls = async () => { throw new Error("no AI call expected"); };

test("a finished world completes without a call", async () => {
  const result = await runSimplePoliticalWorldV2({ checkpoint: finishedCheckpoint(), inputs, maxModelCalls: 5, callModel: noCalls });
  assert.equal(result.status, "complete");
  assert.equal(result.modelCalls, 0);
});

test("completion honours relevance: an actor the richer depth finds incomplete is not Canonical", async () => {
  const result = await runSimplePoliticalWorldV2({
    checkpoint: finishedCheckpoint(),
    inputs: { ...inputs, relevanceByPolity: { A: { depth: "full" } } },
    maxModelCalls: 0,
    callModel: noCalls,
  });
  assert.notEqual(result.status, "complete");
  assert.equal(result.quality.canonicalReady, false);
  assert.ok(result.quality.unresolved.some((entry) => entry.kind === "political-actor" && entry.polityKey === "A"));
  assert.equal(result.pauseReason, "model-call-budget");
});

test("the session budget and the lifetime ceiling pause before any call", async () => {
  const budget = await runSimplePoliticalWorldV2({ checkpoint: withUncoveredInstitution(), inputs, maxModelCalls: 0, callModel: noCalls });
  assert.equal(budget.status, "paused");
  assert.equal(budget.pauseReason, "model-call-budget");

  const atCeiling = withUncoveredInstitution();
  atCeiling.modelCalls = 100;
  const ceiling = await runSimplePoliticalWorldV2({ checkpoint: atCeiling, inputs, maxModelCalls: 5, callModel: noCalls });
  assert.equal(ceiling.pauseReason, "total-model-call-budget");
  assert.equal(ceiling.modelCalls, 100);
  assert.match(ceiling.lastError, /lifetime safety ceiling of 100 AI calls/);
});

test("the session budget counts calls across tasks and stops exactly at the limit", async () => {
  const checkpoint = finishedCheckpoint();
  checkpoint.stagedWorld.powerStatus.byPolity = {};
  let calls = 0;
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 2,
    callModel: async () => { calls += 1; return { toolInput: { powerJson: "[]" } }; },
  });
  assert.equal(calls, 2);
  assert.equal(result.modelCalls, 2);
  assert.equal(result.pauseReason, "model-call-budget");
});

test("institution membership reads a text-mode answer", async () => {
  const result = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 1,
    callModel: async () => ({ rawText: JSON.stringify({ membersJson: JSON.stringify([{ polityKey: "B", status: "member", role: "leader" }]) }), toolInput: null }),
  });
  assert.deepEqual(result.membership.resolvedInstitutionIds, ["pact"]);
  assert.ok(result.stagedWorld.institutions.byId.pact.members.some((member) => member.polity === "B"));
});
