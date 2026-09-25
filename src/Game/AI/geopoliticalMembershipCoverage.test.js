import assert from "node:assert/strict";
import test from "node:test";

import {
  GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE,
  resolveGeopoliticalMembershipCoverage,
} from "./geopoliticalMembershipCoverage.js";

const currentFailureOmissions = new Set([
  "Algeria",
  "Hellenic Republic",
  "Ireland",
  "Kingdom of Denmark",
  "Kingdom of Spain",
  "Kingdom of the Netherlands",
  "Portuguese Republic",
  "Togolese Republic",
  "Union of the Comoros",
  "United Kingdom",
  "United Republic of Tanzania",
]);

const makePolities = () => {
  const fillers = Array.from({ length: 191 }, (_, index) => `Fixture Polity ${String(index + 1).padStart(3, "0")}`);
  return [...fillers, ...currentFailureOmissions];
};

const recordsFor = (polities) => polities.map((polityKey) => ({ polityKey, regimeCharacter: "other", memberships: [] }));

test("191/202-shaped omission is rescued with one unresolved-only request, not large-batch reruns", async () => {
  const requestedPolities = makePolities();
  const calls = [];
  const result = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: 48,
    requestProfiles: async (targets, meta) => {
      calls.push({ targets: [...targets], phase: meta.phase });
      if (meta.phase === "memberships") return recordsFor(targets.filter((polity) => !currentFailureOmissions.has(polity)));
      if (meta.phase === "memberships-rescue") {
        assert.deepEqual(new Set(targets), currentFailureOmissions);
        return recordsFor(targets);
      }
      throw new Error(`unexpected phase ${meta.phase}`);
    },
  });

  assert.equal(result.records.length, 202);
  assert.deepEqual(result.unresolvedPolities, []);
  assert.equal(result.requestCount, 6, "five normal membership batches + one bounded unresolved rescue");
  assert.deepEqual(calls.map((entry) => entry.phase), [
    "memberships",
    "memberships",
    "memberships",
    "memberships",
    "memberships",
    "memberships-rescue",
  ]);
  assert.equal(calls.at(-1).targets.length, 11);
});

test("only a one-or-two polity remainder receives the final tiny retry", async () => {
  const requestedPolities = makePolities();
  const stillMissing = new Set(["Ireland", "United Kingdom"]);
  const calls = [];
  const result = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: 48,
    requestProfiles: async (targets, meta) => {
      calls.push({ targets: [...targets], phase: meta.phase });
      if (meta.phase === "memberships") return recordsFor(targets.filter((polity) => !currentFailureOmissions.has(polity)));
      if (meta.phase === "memberships-rescue") return recordsFor(targets.filter((polity) => !stillMissing.has(polity)));
      if (meta.phase === "memberships-tiny-retry") {
        assert.deepEqual(new Set(targets), stillMissing);
        return recordsFor(targets);
      }
      return [];
    },
  });

  assert.equal(result.records.length, 202);
  assert.deepEqual(result.unresolvedPolities, []);
  assert.equal(result.requestCount, 7, "five normal batches + one rescue + one two-polity retry");
  assert.deepEqual(calls.at(-1).targets.sort(), [...stillMissing].sort());
});

test("genuinely unresolved rescue data is retried only through bounded subdivision then remains fail-closed", async () => {
  const requestedPolities = makePolities();
  const stillMissing = new Set(["Ireland", "United Kingdom", "Algeria"]);
  const calls = [];
  const result = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: 48,
    requestProfiles: async (targets, meta) => {
      calls.push({ targets: [...targets], phase: meta.phase, depth: meta.recoveryDepth });
      if (meta.phase === "memberships") return recordsFor(targets.filter((polity) => !currentFailureOmissions.has(polity)));
      return recordsFor(targets.filter((polity) => !stillMissing.has(polity)));
    },
  });

  assert.equal(result.records.length, 199);
  assert.deepEqual(new Set(result.unresolvedPolities), stillMissing);
  assert.ok(calls.some((entry) => entry.phase === "memberships-recovery-split"));
  assert.ok(calls.filter((entry) => entry.phase !== "memberships").every((entry) => entry.targets.length <= GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE));
});

test("catastrophic 48-polity omission never creates one giant rescue request", async () => {
  const requestedPolities = Array.from({ length: 202 }, (_, index) => `Polity ${String(index + 1).padStart(3, "0")}`);
  const catastrophic = new Set(requestedPolities.slice(48, 96));
  const calls = [];

  const result = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: 48,
    requestProfiles: async (targets, meta) => {
      calls.push({ phase: meta.phase, targets: [...targets] });
      if (meta.phase === "memberships") {
        if (targets.every((polity) => catastrophic.has(polity))) return [];
        return recordsFor(targets);
      }
      assert.ok(targets.length <= GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE, "recovery request must stay bounded");
      return recordsFor(targets);
    },
  });

  assert.equal(result.records.length, 202);
  assert.deepEqual(result.unresolvedPolities, []);
  assert.equal(result.requestCount, 8, "five normal batches + three 16-polity rescue chunks");
  assert.deepEqual(
    calls.filter((entry) => entry.phase === "memberships-rescue").map((entry) => entry.targets.length),
    [16, 16, 16],
  );
});

test("197-polity catastrophic unresolved set is chunked before rescue, preventing malformed mega-responses", async () => {
  const requestedPolities = Array.from({ length: 202 }, (_, index) => `Polity ${String(index + 1).padStart(3, "0")}`);
  const firstPassSurvivors = new Set(requestedPolities.slice(0, 5));
  const calls = [];

  const result = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: 48,
    requestProfiles: async (targets, meta) => {
      calls.push({ phase: meta.phase, targets: [...targets], depth: meta.recoveryDepth });
      if (meta.phase === "memberships") return recordsFor(targets.filter((polity) => firstPassSurvivors.has(polity)));
      if (meta.phase === "memberships-rescue") {
        assert.ok(targets.length <= GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE);
        // Reproduce flaky provider behavior: every third rescue chunk returns nothing.
        const rescueIndex = calls.filter((entry) => entry.phase === "memberships-rescue").length - 1;
        return rescueIndex % 3 === 2 ? [] : recordsFor(targets);
      }
      if (meta.phase === "memberships-recovery-split") {
        assert.ok(targets.length <= 8, "first subdivision of a failed 16-polity rescue must be <=8");
        return recordsFor(targets);
      }
      return [];
    },
  });

  assert.equal(result.records.length, 202);
  assert.deepEqual(result.unresolvedPolities, []);
  assert.ok(calls.filter((entry) => entry.phase !== "memberships").every((entry) => entry.targets.length <= GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE));
  assert.ok(!calls.some((entry) => entry.targets.length === 197), "the old 197-polity mega rescue must never happen");
  assert.ok(calls.some((entry) => entry.phase === "memberships-recovery-split"));
});

test("partial rescue is subdivided, but bad data still cannot force Apply green", async () => {
  const requestedPolities = makePolities();
  const stillMissing = new Set(["Ireland", "United Kingdom", "Algeria"]);
  const phases = [];
  const result = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: 48,
    requestProfiles: async (targets, meta) => {
      phases.push(meta.phase);
      if (meta.phase === "memberships") return recordsFor(targets.filter((polity) => !currentFailureOmissions.has(polity)));
      return recordsFor(targets.filter((polity) => !stillMissing.has(polity)));
    },
  });

  assert.equal(result.records.length, 199);
  assert.deepEqual(new Set(result.unresolvedPolities), stillMissing);
  assert.ok(phases.includes("memberships-recovery-split"));
});
