import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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
