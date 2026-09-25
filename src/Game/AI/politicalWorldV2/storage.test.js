import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalWorldV2Checkpoint } from "./checkpoint.js";
import {
  clearPoliticalWorldV2Checkpoint,
  clearPoliticalWorldV2CheckpointMemoryForTests,
  loadPoliticalWorldV2Checkpoint,
  savePoliticalWorldV2Checkpoint,
} from "./storage.js";

test("checkpoint persistence falls back to memory without touching scenario canon", async () => {
  clearPoliticalWorldV2CheckpointMemoryForTests();
  const checkpoint = createPoliticalWorldV2Checkpoint({
    scenarioId: "scenario-a",
    inputFingerprint: "pw2-test",
    stagedWorld: { politicalActors: { byPolity: { Alpha: { id: "alpha" } } } },
  });
  await savePoliticalWorldV2Checkpoint(checkpoint);
  const loaded = await loadPoliticalWorldV2Checkpoint("scenario-a");
  assert.equal(loaded.inputFingerprint, "pw2-test");
  assert.equal(loaded.stagedWorld.politicalActors.byPolity.Alpha.id, "alpha");

  await clearPoliticalWorldV2Checkpoint("scenario-a");
  assert.equal(await loadPoliticalWorldV2Checkpoint("scenario-a"), null);
});
