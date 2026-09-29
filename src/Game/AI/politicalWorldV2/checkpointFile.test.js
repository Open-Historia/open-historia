import test from "node:test";
import assert from "node:assert/strict";

import { buildPoliticalWorldInputFingerprint, createPoliticalWorldV2Checkpoint } from "./checkpoint.js";
import {
  POLITICAL_WORLD_V2_CHECKPOINT_FILE_KIND,
  buildPoliticalWorldV2CheckpointFile,
  restorePoliticalWorldV2CheckpointFile,
} from "./checkpointFile.js";

const makeInputs = (overrides = {}) => ({
  scenarioDate: "2014-03-22",
  world: {
    polityOverrides: { Avalon: { name: "Avalon", status: "active" }, Borduria: { name: "Borduria", status: "active" } },
    simulationRules: "Rules",
  },
  roundZeroContext: null,
  polities: [{ polityKey: "Avalon", active: true }, { polityKey: "Borduria", active: true }],
  ...overrides,
});

const makeCheckpoint = (scenarioId, inputs) => {
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId,
    scenarioDate: inputs.scenarioDate,
    inputFingerprint: buildPoliticalWorldInputFingerprint({ scenarioId, scenarioDate: inputs.scenarioDate, world: inputs.world, roundZeroContext: inputs.roundZeroContext }),
    stagedWorld: { ...inputs.world, politicalActors: { schemaVersion: 1, byPolity: { Avalon: { polityKey: "Avalon" } } } },
  });
  checkpoint.modelCalls = 14;
  checkpoint.coverage["political-actor"] = ["Avalon"];
  checkpoint.status = "paused";
  checkpoint.pauseReason = "model-call-budget";
  return checkpoint;
};

// What the panel writes to disk and reads back.
const throughDisk = (value) => JSON.parse(JSON.stringify(value));

test("an exported checkpoint restores with its staged work for the same scenario", () => {
  const inputs = makeInputs();
  const file = throughDisk(buildPoliticalWorldV2CheckpointFile({
    checkpoint: makeCheckpoint("scenario-a", inputs),
    scenario: { id: "scenario-a", name: "Test World" },
  }));
  assert.equal(file.kind, POLITICAL_WORLD_V2_CHECKPOINT_FILE_KIND);
  assert.deepEqual(file.scenario, { id: "scenario-a", name: "Test World", scenarioDate: "2014-03-22" });

  const restored = restorePoliticalWorldV2CheckpointFile(file, { scenarioId: "scenario-a", inputs });
  assert.equal(restored.scenarioId, "scenario-a");
  assert.equal(restored.modelCalls, 14);
  assert.equal(restored.pauseReason, "model-call-budget");
  assert.deepEqual(restored.coverage["political-actor"], ["Avalon"]);
  assert.equal(restored.stagedWorld.politicalActors.byPolity.Avalon.polityKey, "Avalon");
});

test("the same scenario under a new id is rebound to it when its political inputs are identical", () => {
  const inputs = makeInputs();
  const file = throughDisk(buildPoliticalWorldV2CheckpointFile({ checkpoint: makeCheckpoint("old-id", inputs) }));
  const restored = restorePoliticalWorldV2CheckpointFile(file, { scenarioId: "new-id", inputs });
  assert.equal(restored.scenarioId, "new-id");
  assert.equal(
    restored.inputFingerprint,
    buildPoliticalWorldInputFingerprint({ scenarioId: "new-id", scenarioDate: inputs.scenarioDate, world: inputs.world, roundZeroContext: null }),
  );
  assert.equal(restored.modelCalls, 14);
});

test("a checkpoint is refused for another date, other political inputs or another scenario", () => {
  const inputs = makeInputs();
  const file = throughDisk(buildPoliticalWorldV2CheckpointFile({ checkpoint: makeCheckpoint("scenario-a", inputs) }));

  assert.throws(
    () => restorePoliticalWorldV2CheckpointFile(file, { scenarioId: "scenario-a", inputs: makeInputs({ scenarioDate: "2015-01-01" }) }),
    /does not match current canonical date 2015-01-01/,
  );
  const changed = makeInputs({ world: { ...inputs.world, simulationRules: "Different rules" } });
  assert.throws(
    () => restorePoliticalWorldV2CheckpointFile(file, { scenarioId: "scenario-a", inputs: changed }),
    /political data has changed since this checkpoint was exported/,
  );
  assert.throws(
    () => restorePoliticalWorldV2CheckpointFile(file, { scenarioId: "scenario-b", inputs: changed }),
    /Checkpoint belongs to scenario scenario-a, not scenario-b/,
  );
});

test("files that are not a checkpoint export, or hold an unsupported checkpoint, are refused", () => {
  const inputs = makeInputs();
  assert.throws(
    () => restorePoliticalWorldV2CheckpointFile({ kind: "political-world-v2-diagnostic", schemaVersion: 2 }, { scenarioId: "scenario-a", inputs }),
    /not a supported Political World checkpoint/,
  );
  const file = throughDisk(buildPoliticalWorldV2CheckpointFile({ checkpoint: makeCheckpoint("scenario-a", inputs) }));
  file.checkpoint.version = 4;
  assert.throws(
    () => restorePoliticalWorldV2CheckpointFile(file, { scenarioId: "scenario-a", inputs }),
    /different version of the game/,
  );
  assert.throws(() => buildPoliticalWorldV2CheckpointFile({ checkpoint: null }), /no Political World generation checkpoint/);
});
