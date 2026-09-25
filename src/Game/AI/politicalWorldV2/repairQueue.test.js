import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalWorldV2Checkpoint } from "./checkpoint.js";
import { addPoliticalWorldV2Jobs, completePoliticalWorldV2Job, createPoliticalWorldV2Job } from "./jobGraph.js";
import { evaluatePoliticalWorldV2Quality } from "./quality.js";
import { reconcilePoliticalWorldV2QualityRepairJobs } from "./repairQueue.js";

const unresolvedMemberships = (count) => Array.from({ length: count }, (_, index) => ({
  kind: "membership",
  polityKey: `Polity ${index + 1}`,
}));

test("Resume batches quality gaps instead of appending one repair job per polity", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint.quality.unresolved = unresolvedMemberships(17);
  checkpoint.status = "blocked";

  checkpoint = reconcilePoliticalWorldV2QualityRepairJobs(checkpoint);
  const repairs = Object.values(checkpoint.jobs).filter((job) => job?.payload?.resumeRepair === true);
  assert.equal(repairs.length, 3);
  assert.deepEqual(repairs.map((job) => job.targets.length), [8, 8, 1]);
});

test("Repeated Resume recycles the same repair slots instead of growing the job graph", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint.quality.unresolved = unresolvedMemberships(17);
  checkpoint.status = "blocked";
  checkpoint = reconcilePoliticalWorldV2QualityRepairJobs(checkpoint);
  const firstIds = Object.keys(checkpoint.jobs);

  for (const job of Object.values(checkpoint.jobs)) {
    job.status = "completed";
    job.result = { acceptedPolities: [], unresolvedPolities: [...job.targets] };
  }
  checkpoint.status = "blocked";
  checkpoint = reconcilePoliticalWorldV2QualityRepairJobs(checkpoint);

  assert.equal(Object.keys(checkpoint.jobs).length, firstIds.length);
  assert.deepEqual(Object.keys(checkpoint.jobs), firstIds);
  assert.ok(Object.values(checkpoint.jobs).every((job) => job.status === "pending"));
});

test("existing open work prevents duplicate quality repair coverage", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "existing", type: "membership-resolution", targets: ["Polity 1", "Polity 2", "Polity 3"] }),
  ]);
  checkpoint.quality.unresolved = unresolvedMemberships(5);
  checkpoint = reconcilePoliticalWorldV2QualityRepairJobs(checkpoint);

  const repairs = Object.values(checkpoint.jobs).filter((job) => job?.payload?.resumeRepair === true);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].targets, ["Polity 4", "Polity 5"]);
});

test("coverage ledger survives recycling a completed repair slot", () => {
  const polities = ["A"];
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "resume-repair:political-actor:001", type: "political-actor", targets: ["A"], payload: { resumeRepair: true } }),
  ]);
  checkpoint.jobs["resume-repair:political-actor:001"].status = "running";
  checkpoint = completePoliticalWorldV2Job(checkpoint, "resume-repair:political-actor:001", { acceptedPolities: ["A"], unresolvedPolities: [] });
  assert.deepEqual(checkpoint.coverage["political-actor"], ["A"]);

  checkpoint.quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities });
  checkpoint.quality.unresolved = [{ kind: "membership", polityKey: "A" }];
  checkpoint = reconcilePoliticalWorldV2QualityRepairJobs(checkpoint);

  const quality = evaluatePoliticalWorldV2Quality({ checkpoint, polities });
  assert.equal(quality.counts.politicalActors, 1);
});


test("institution-centric membership surface prevents legacy polity membership repairs on Resume", () => {
  let checkpoint = createPoliticalWorldV2Checkpoint({ scenarioId: "s" });
  checkpoint.quality = { unresolved: [{ kind: "membership", polityKey: "Polity 1" }, { kind: "membership", polityKey: "Polity 2" }] };
  checkpoint = addPoliticalWorldV2Jobs(checkpoint, [
    createPoliticalWorldV2Job({ id: "memberships:surface", type: "membership-surface" }),
  ]);
  const reconciled = reconcilePoliticalWorldV2QualityRepairJobs(checkpoint);
  assert.equal(Object.values(reconciled.jobs).some((job) => job?.payload?.resumeRepair === true && job.type === "membership-resolution"), false);
});
