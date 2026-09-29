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
