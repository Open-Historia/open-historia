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

test("member rows that name no polity fail the institution instead of resolving it without them", async () => {
  const result = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 1,
    callModel: async () => membersAnswer(["A", { polityKey: " ", status: "member", role: "member" }]),
  });
  assert.deepEqual(result.membership.resolvedInstitutionIds, []);
  assert.equal(result.attempts["institution-membership-resolution:pact"], 1);
  assert.ok(result.warnings.some((warning) => /2 invalid row\(s\)/.test(warning)));
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

test("a run paused at its lifetime ceiling resumes after the author allows more calls", async () => {
  const { grantPoliticalWorldV2ModelCalls } = await import("./checkpoint.js");
  const atCeiling = withUncoveredInstitution();
  atCeiling.modelCalls = 100;
  const paused = await runSimplePoliticalWorldV2({ checkpoint: atCeiling, inputs, maxModelCalls: 5, callModel: noCalls });
  assert.equal(paused.pauseReason, "total-model-call-budget");

  let calls = 0;
  const resumed = await runSimplePoliticalWorldV2({
    checkpoint: grantPoliticalWorldV2ModelCalls(paused),
    inputs,
    maxModelCalls: 1,
    callModel: async () => { calls += 1; return membersAnswer([{ polityKey: "A", status: "member", role: "member" }]); },
  });
  assert.equal(calls, 1);
  assert.equal(resumed.modelCalls, 101);
  assert.deepEqual(resumed.membership.resolvedInstitutionIds, ["pact"]);
});

test("a save that did not reach durable storage pauses the run before its next call", async () => {
  const result = await runSimplePoliticalWorldV2({
    checkpoint: withUncoveredInstitution(),
    inputs,
    maxModelCalls: 5,
    callModel: noCalls,
    onCheckpoint: async () => ({ primary: false, backup: false, durable: false }),
  });
  assert.equal(result.pauseReason, "storage-unavailable");
  assert.equal(result.modelCalls, 0);
  assert.match(result.lastError, /could not be saved on this device/);
});

test("the pipeline reports each save's persistence and will not spend calls it cannot keep", async () => {
  const { generateOrResumePoliticalWorldV2 } = await import("./pipeline.js");
  const reports = [];
  // No IndexedDB in node: every save is memory-only, as in a browser whose
  // storage is blocked.
  const result = await generateOrResumePoliticalWorldV2({
    scenarioId: "storage-test",
    inputs: { scenarioDate: "2014-03-22", polities, world: {}, politicalActors: { byPolity: {} } },
    maxModelCalls: 5,
    callModel: noCalls,
    onProgress: (report) => reports.push(report.persistence),
  });
  assert.equal(result.pauseReason, "storage-unavailable");
  assert.equal(result.modelCalls, 0);
  assert.ok(reports.length > 0);
  assert.ok(reports.every((persistence) => persistence?.durable === false));
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

test("a failed governing alignment's errors are kept and sent with the next attempt", async () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stagedWorld.politicalActors.byPolity.A = {
    ...completeActor("A"),
    government: { ...completeActor("A").government, rulingPartyIds: [] },
    parties: [...completeActor("A").parties, { id: "opp", name: "Opposition Party", support: { percent: 40 }, ideology: "Conservative", publicPriorities: ["Oppose government"] }],
  };
  checkpoint.coverage["governing-alignment"] = ["B", "C"];
  const prompts = [];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 2,
    callModel: async (_system, history) => {
      prompts.push(String(history?.at(-1)?.parts?.[0]?.text ?? ""));
      return { toolInput: { alignments: [{ polityKey: "A", confidence: "high", alignmentJson: "{\"rulingPartyIds\":[\"ghost\"]}" }] } };
    },
  });
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /PREVIOUS ATTEMPT VALIDATION ERRORS/);
  assert.match(prompts[1], /- alignmentJson references unknown party id ghost/);
  assert.deepEqual(result.retryContext.governingAlignment.A, ["alignmentJson references unknown party id ghost"]);
  assert.equal(result.attempts["governing-alignment:A"], 2);
});

test("political-system locks reported for an unresolved actor are kept for its next attempt", async () => {
  const checkpoint = readyCheckpoint();
  delete checkpoint.stagedWorld.politicalActors.byPolity.C;
  checkpoint.coverage["political-actor"] = ["A", "B"];
  const lock = { type: "presidential_republic", representation: "electoral" };
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 1,
    createExecutor: scriptedExecutor({
      result: { generation: { proposals: [], failures: [{ polityKey: "C", errors: ["parties must not be empty"] }], politicalSystemLocksByPolity: { C: lock } }, acceptedPolities: [], unresolvedPolities: ["C"] },
    }),
  });
  assert.deepEqual(result.retryContext.politicalSystemLocks, { C: lock });
  assert.deepEqual(result.retryContext.politicalActor.C, ["parties must not be empty"]);
});

test("one prime minister leading two countries is sent back for one focused re-check before Canonical", async () => {
  const checkpoint = finishedCheckpoint();
  checkpoint.historicalVerificationRequired = true;
  for (const polity of ["A", "B"]) {
    const government = { ...completeActor(polity).government, headOfGovernment: "Jane Doe" };
    checkpoint.stagedWorld.politicalActors.byPolity[polity] = { ...completeActor(polity), government };
    checkpoint.generationEntriesByPolity[polity] = {
      item: { polityKey: polity, depth: "standard", needs: ["governing_structure"] },
      proposal: { polityKey: polity, actorPatch: { government: { form: government.form, headOfGovernment: "Jane Doe" } } },
      validation: { actor: checkpoint.stagedWorld.politicalActors.byPolity[polity] },
    };
  }
  const prompts = [];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 5,
    callModel: async (_system, history, options) => {
      const text = String(history?.at(-1)?.parts?.[0]?.text ?? "");
      prompts.push({ tool: options?.tool?.name, text });
      if (options?.tool?.name === "submit_political_world_temporal_sentinel") {
        const checks = ["A", "B"].map((polityKey) => {
          const block = text.split(`POLITY: ${polityKey}`)[1] || "";
          const ids = [...block.split("POLITY-SPECIFIC")[0].matchAll(/^(F\d+) \[/gm)].map((match) => match[1]);
          return { polityKey, verdict: "clear", confidence: "high", issue: "", checkedFactIds: ids, challengedFactIds: [] };
        });
        return { toolInput: { checksJson: JSON.stringify(checks) } };
      }
      return { toolInput: { verifications: ["A", "B"].map((polityKey) => ({ polityKey, verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" })) } };
    },
  });
  assert.deepEqual(prompts.map((prompt) => prompt.tool), ["submit_political_world_temporal_sentinel", "submit_political_world_historical_verification"]);
  assert.match(prompts[1].text, /MANDATORY SAME-DATE OFFICEHOLDER COLLISION/);
  assert.match(prompts[1].text, /government\.headOfGovernment = Jane Doe/);
  assert.ok(result.warnings.some((warning) => /Officeholder collision kept after a focused exact-date re-check: Jane Doe/.test(warning)));
  assert.equal(result.status, "complete");
});

test("a batched membership call keeps every complete list and retries only what was dropped", async () => {
  const checkpoint = readyCheckpoint();
  checkpoint.stages.institutionDiscovery = "complete";
  for (const id of ["p1", "p2", "p3"]) {
    checkpoint.stagedWorld.institutions.byId[id] = { id, name: `Pact ${id}`, kind: "security_alliance", foundedDate: "2000-01-01", members: {} };
  }
  const prompts = [];
  const result = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls: 1,
    callModel: async (_system, history, options) => {
      prompts.push({ tool: options?.tool?.name, text: String(history?.at(-1)?.parts?.[0]?.text ?? "") });
      return { toolInput: { institutionsJson: JSON.stringify([
        { institutionId: "p1", members: [{ polityKey: "A", status: "member", role: "leader" }, { polityKey: "B", status: "member", role: "member" }] },
        { institutionId: "p2", members: [] },
        // p3 left out: its list may have been trimmed, so it is asked again alone.
      ]) } };
    },
  });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].tool, "submit_geopolitical_institutions_members");
  assert.equal(prompts[0].text.split("Active polity vocabulary").length - 1, 1, "the vocabulary is sent once");
  assert.deepEqual([...result.membership.resolvedInstitutionIds].sort(), ["p1", "p2"]);
  assert.deepEqual(result.stagedWorld.institutions.byId.p1.members.map((member) => member.polity).sort(), ["A", "B"]);
  assert.equal(result.attempts["institution-membership-resolution:p3"], 1);
  assert.ok(result.warnings.some((warning) => /Pact p3: left out of the answer/.test(warning)));
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
