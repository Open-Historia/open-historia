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
const { createPoliticalWorldV2Executor } = await import("./executor.js");

const actorPatch = { government: { form: "Parliamentary republic", headOfGovernment: "Leader A" } };
const checkpointWithEntry = () => {
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId: "s",
    scenarioDate: "2014-03-22",
    stagedWorld: { politicalActors: { schemaVersion: 1, byPolity: { A: { polityKey: "A", ...actorPatch } } } },
  });
  checkpoint.generationEntriesByPolity.A = {
    item: { polityKey: "A", depth: "standard", needs: ["governing_structure"] },
    proposal: { polityKey: "A", actorPatch },
    validation: { actor: { polityKey: "A", ...actorPatch } },
  };
  return checkpoint;
};
const inputs = { scenarioDate: "2014-03-22", polities: ["A"] };
const textAnswer = (payload) => ({ rawText: JSON.stringify(payload), toolInput: null });

test("the temporal sentinel reads a text-mode answer instead of challenging every polity", async () => {
  const executor = createPoliticalWorldV2Executor({
    inputs,
    callModel: async () => textAnswer({
      checksJson: JSON.stringify([{ polityKey: "A", verdict: "clear", confidence: "high", issue: "", checkedFactIds: ["F1", "F2"], challengedFactIds: [] }]),
    }),
  });
  const result = await executor.executeJob(
    { id: "t", type: "temporal-sentinel", stage: "verification", targets: ["A"], payload: {} },
    checkpointWithEntry(),
    { consumeModelCall: async () => {} },
  );
  assert.deepEqual(result.clearPolities, ["A"]);
  assert.deepEqual(result.challengePolities, []);
});

test("a fenced text-mode sentinel answer is still read", async () => {
  const executor = createPoliticalWorldV2Executor({
    inputs,
    callModel: async () => ({
      rawText: "```json\n" + JSON.stringify({ checks: [{ polityKey: "A", verdict: "clear", confidence: "high", issue: "", checkedFactIds: ["F1", "F2"], challengedFactIds: [] }] }) + "\n```",
      toolInput: null,
    }),
  });
  const result = await executor.executeJob(
    { id: "t", type: "temporal-sentinel", stage: "verification", targets: ["A"], payload: {} },
    checkpointWithEntry(),
    { consumeModelCall: async () => {} },
  );
  assert.deepEqual(result.clearPolities, ["A"]);
});

test("exact-date verification reads a text-mode answer instead of leaving the polity unresolved", async () => {
  const executor = createPoliticalWorldV2Executor({
    inputs,
    callModel: async () => textAnswer({
      verifications: [{ polityKey: "A", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" }],
    }),
  });
  const result = await executor.executeJob(
    { id: "v", type: "historical-verification", stage: "verification", targets: ["A"], payload: {} },
    checkpointWithEntry(),
    { consumeModelCall: async () => {} },
  );
  assert.deepEqual(result.confirmedPolities, ["A"]);
  assert.deepEqual(result.unresolvedPolities, []);
});
