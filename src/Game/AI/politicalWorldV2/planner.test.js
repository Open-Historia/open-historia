import assert from "node:assert/strict";
import test from "node:test";

import { planPoliticalWorldV2Jobs } from "./planner.js";

const polities = Array.from({ length: 202 }, (_, index) => `Polity ${index + 1}`);

test("canonical planner uses bounded internal jobs rather than giant world requests", () => {
  const plan = planPoliticalWorldV2Jobs({ polities, qualityMode: "canonical" });
  const actorJobs = plan.jobs.filter((job) => job.type === "political-actor");
  const membershipSurfaceJobs = plan.jobs.filter((job) => job.type === "membership-surface");
  assert.equal(actorJobs.length, 26);
  assert.equal(membershipSurfaceJobs.length, 1);
  assert.ok(actorJobs.every((job) => job.targets.length <= 8));
  assert.equal(membershipSurfaceJobs[0].targets.length, 0);
  const powerJobs = plan.jobs.filter((job) => job.type === "power-evidence");
  assert.ok(powerJobs.length > 1);
  assert.ok(powerJobs.every((job) => job.targets.length <= 24));
  assert.equal(plan.jobs.some((job) => job.targets.length === 202 && ["membership-resolution", "institution-membership-resolution", "power-evidence"].includes(job.type)), false);
});

test("canonical exact-date sentinels stay bounded instead of verifying the whole world in one response", () => {
  const plan = planPoliticalWorldV2Jobs({
    polities,
    qualityMode: "canonical",
    verificationTargets: polities,
  });
  const sentinels = plan.jobs.filter((job) => job.type === "temporal-sentinel");
  assert.ok(sentinels.length > 1);
  assert.ok(sentinels.every((job) => job.targets.length <= 12));
});

test("reference-resolved memberships cost zero AI membership jobs while canonical mode still checks institution completeness", () => {
  const plan = planPoliticalWorldV2Jobs({
    polities: polities.slice(0, 20),
    qualityMode: "canonical",
    hasCanonicalInstitutionCatalog: true,
    referenceResolvedMembershipPolities: polities.slice(0, 20),
  });
  assert.equal(plan.jobs.some((job) => job.type === "institution-discovery"), true);
  assert.equal(plan.jobs.some((job) => job.type === "membership-resolution"), false);
  assert.equal(plan.jobs.filter((job) => job.type === "membership-surface").length, 1);
  assert.ok(plan.jobs.some((job) => job.type === "political-actor"));
});

test("governing alignment depends on completed political actor jobs rather than regenerating actors", () => {
  const plan = planPoliticalWorldV2Jobs({ polities: polities.slice(0, 16), qualityMode: "canonical" });
  const actorIds = new Set(plan.jobs.filter((job) => job.type === "political-actor").map((job) => job.id));
  const alignment = plan.jobs.find((job) => job.type === "governing-alignment");
  assert.ok(alignment.dependencies.length > 0);
  assert.ok(alignment.dependencies.every((id) => actorIds.has(id)));
});

test("reference-covered institution ids are passed to one deterministic membership-surface job", () => {
  const plan = planPoliticalWorldV2Jobs({
    polities: polities.slice(0, 16),
    qualityMode: "canonical",
    hasCanonicalInstitutionCatalog: true,
    referenceCoveredInstitutionIds: ["nato", "united-nations"],
  });
  const surface = plan.jobs.filter((job) => job.type === "membership-surface");
  assert.equal(surface.length, 1);
  assert.deepEqual(surface[0].payload.referenceCoveredInstitutionIds, ["nato", "united-nations"]);
  assert.equal(plan.jobs.some((job) => job.type === "membership-resolution"), false);
});

test("native-resolved power evidence does not consume AI power jobs", () => {
  const targets = polities.slice(0, 30);
  const plan = planPoliticalWorldV2Jobs({
    polities: targets,
    qualityMode: "canonical",
    nativeResolvedPowerPolities: targets.slice(0, 24),
  });
  const powerJobs = plan.jobs.filter((job) => job.type === "power-evidence");
  assert.equal(powerJobs.length, 1);
  assert.deepEqual(powerJobs[0].targets, targets.slice(24));
});
