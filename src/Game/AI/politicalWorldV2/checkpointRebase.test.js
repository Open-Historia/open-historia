import assert from "node:assert/strict";
import test from "node:test";

import { materializeScenarioCanon } from "../../../runtime/scenarioCanon.js";
import { buildRoundZeroCanonContext } from "../../../runtime/roundZeroCanonContext.js";
import { rebasePoliticalWorldV2ReferenceCanon } from "./checkpointRebase.js";

const baseWorld = () => ({
  startingTimelineText: "Same premise",
  simulationRules: "Same rules",
  ownerCodes: ["A", "B"],
  polityOverrides: { A: { name: "A" }, B: { name: "B" } },
  wars: [],
  relations: [],
});

const canonContext = (referencePacks = []) => ({
  universe: { id: "historical-earth", type: "historical" },
  referencePacks,
  referenceAuthority: "round-zero-only",
});

const stagedReferenceWorld = () => materializeScenarioCanon(baseWorld(), {
  canonContext: canonContext([]),
});

const freshWorld = () => materializeScenarioCanon(baseWorld(), {
  canonContext: canonContext([{ id: "earth-history", version: "1.0", enabled: true }]),
});

const roundZeroContextFor = (world) => buildRoundZeroCanonContext({
  world,
  game: { startDate: "2014-03-22" },
});


test("completed un-applied checkpoint can rebase only saved Canon Context without losing generated canon", () => {
  const stagedBase = stagedReferenceWorld();
  const checkpoint = {
    scenarioDate: "2014-03-22",
    inputFingerprint: "old",
    status: "complete",
    pauseReason: "",
    lastError: "",
    coverage: { "political-actor": ["A", "B"] },
    bootstrap: {},
    sourceRoundZeroContext: roundZeroContextFor(stagedBase),
    stagedWorld: {
      ...stagedBase,
      politicalActors: { byPolity: { A: { id: "A", generated: true }, B: { id: "B", generated: true } } },
      institutions: { byId: { old: { id: "old", name: "Old", foundedDate: "1900-01-01" } } },
    },
  };
  const world = freshWorld();
  const inputs = {
    scenarioDate: "2014-03-22",
    polities: ["A", "B"],
    world,
    roundZeroContext: roundZeroContextFor(world),
  };
  const rebased = rebasePoliticalWorldV2ReferenceCanon(checkpoint, inputs, "new-fingerprint");

  assert.ok(rebased);
  assert.equal(rebased.inputFingerprint, "new-fingerprint");
  assert.equal(rebased.stagedWorld.canonModelVersion, 2);
  assert.equal(rebased.stagedWorld.canonContext.referencePacks[0].id, "earth-history");
  assert.equal(Object.keys(rebased.stagedWorld.politicalActors.byPolity).length, 2);
  assert.ok(rebased.stagedWorld.institutions.byId.old, "generated staged institution state is preserved until deterministic reference reconciliation runs");
  assert.equal(rebased.bootstrap.canonContextRebased, true);
  assert.equal(rebased.quality.canonicalReady, false, "rebase must never leave Apply enabled against the old reference surface");
  assert.equal(rebased.stages.institutionDiscovery, "pending");
  assert.equal(rebased.stages.institutionGovernance, "pending");
  assert.equal(rebased.stages.agreements, "pending");
  assert.equal(rebased.pauseReason, "reference-canon-rebase");
});

test("checkpoint rebase refuses saved authored political ledgers", () => {
  const world = freshWorld();
  world.politicalActors = { byPolity: { A: { id: "A", authored: true } } };
  const stagedBase = stagedReferenceWorld();
  const checkpoint = {
    scenarioDate: "2014-03-22",
    coverage: { "political-actor": ["A", "B"] },
    sourceRoundZeroContext: roundZeroContextFor(stagedBase),
    stagedWorld: stagedBase,
  };
  assert.equal(rebasePoliticalWorldV2ReferenceCanon(checkpoint, {
    scenarioDate: "2014-03-22",
    polities: ["A", "B"],
    world,
    roundZeroContext: roundZeroContextFor(world),
  }, "new"), null);
});

test("checkpoint rebase refuses a changed divergence or authored World Before Round One", () => {
  const stagedBase = stagedReferenceWorld();
  const checkpoint = {
    scenarioDate: "2014-03-22",
    coverage: { "political-actor": ["A", "B"] },
    sourceRoundZeroContext: roundZeroContextFor(stagedBase),
    stagedWorld: stagedBase,
  };
  const world = freshWorld();
  const changedRoundZero = roundZeroContextFor(world);
  changedRoundZero.divergence = {
    date: "1990-01-01",
    authoredText: "1990-01-01: Source canon diverges.",
    events: [{ date: "1990-01-01", description: "Source canon diverges.", line: 1, provenance: "scenario-author" }],
    issues: [],
    valid: true,
  };
  assert.equal(rebasePoliticalWorldV2ReferenceCanon(checkpoint, {
    scenarioDate: "2014-03-22",
    polities: ["A", "B"],
    world,
    roundZeroContext: changedRoundZero,
  }, "new"), null);

  const changedWbr1 = roundZeroContextFor(world);
  changedWbr1.worldBeforeRoundOne = "A materially different authored pre-game world.";
  assert.equal(rebasePoliticalWorldV2ReferenceCanon(checkpoint, {
    scenarioDate: "2014-03-22",
    polities: ["A", "B"],
    world,
    roundZeroContext: changedWbr1,
  }, "new"), null);
});
