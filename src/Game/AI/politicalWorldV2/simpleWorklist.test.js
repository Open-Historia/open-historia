import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalWorldV2Checkpoint } from "./checkpoint.js";
import { deriveNextPoliticalWorldV2Task, summarizePoliticalWorldV2Worklist } from "./simpleWorklist.js";

const inputs = { polities: ["A", "B", "C"] };
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
const base = (actorPolities = ["A", "B", "C"]) => createPoliticalWorldV2Checkpoint({
  scenarioId: "s",
  scenarioDate: "2014-03-22",
  stagedWorld: {
    institutions: { schemaVersion: 1, byId: {} },
    powerStatus: { byPolity: {} },
    politicalActors: { schemaVersion: 1, byPolity: Object.fromEntries(actorPolities.map((key) => [key, completeActor(key)])) },
  },
});

test("worklist does not grow when derived repeatedly from unchanged canon", () => {
  const checkpoint = base();
  const one = summarizePoliticalWorldV2Worklist({ checkpoint, inputs });
  const two = summarizePoliticalWorldV2Worklist({ checkpoint, inputs });
  assert.deepEqual(two, one);
});

test("201 of 202 actors would produce only the single missing actor task", () => {
  const polities = Array.from({ length: 202 }, (_, index) => `P${index + 1}`);
  const checkpoint = base(polities.slice(0, 201));
  checkpoint.coverage["political-actor"] = polities.slice(0, 201);
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.equal(task.type, "political-actor");
  assert.deepEqual(task.targets, ["P202"]);
});


test("202 unresolved governing alignments use the proven 48-polity compact batch instead of nine undersized calls", () => {
  const polities = Array.from({ length: 202 }, (_, index) => `P${index + 1}`);
  const checkpoint = base(polities);
  checkpoint.coverage["political-actor"] = [...polities];
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.equal(task.type, "governing-alignment");
  assert.equal(task.targets.length, 48);
  assert.deepEqual(task.targets, polities.slice(0, 48));
  const summary = summarizePoliticalWorldV2Worklist({ checkpoint, inputs: { polities } });
  assert.equal(summary.pending, 5);
});

test("after actors and alignment, reference-covered institutions cost no membership task", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B", "C"];
  checkpoint.coverage["governing-alignment"] = ["A", "B", "C"];
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stagedWorld.institutions.byId.pact = { id: "pact", name: "Pact", foundedDate: "2000-01-01", members: {} };
  checkpoint.bootstrap = { referenceCoveredInstitutionIds: ["pact"] };
  checkpoint.membership.resolvedInstitutionIds = ["pact"];
  let task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "institution-governance", "reference-covered membership still requires the one global governance pass");
  checkpoint.stages.institutionGovernance = "complete";
  task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "agreement-resolution");
});

test("one uncovered institution creates exactly one institution-centric membership task", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B", "C"];
  checkpoint.coverage["governing-alignment"] = ["A", "B", "C"];
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stagedWorld.institutions.byId.pact = { id: "pact", name: "Pact", foundedDate: "2000-01-01", members: {} };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "institution-membership-resolution");
  assert.deepEqual(task.targets, ["pact"]);
});

test("exhausted actor targets are deferred instead of blocking later polities", () => {
  const checkpoint = base();
  checkpoint.attempts = {
    "political-actor:A": 3,
    "political-actor:B": 3,
  };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "political-actor");
  assert.deepEqual(task.targets, ["C"]);
  const summary = summarizePoliticalWorldV2Worklist({ checkpoint, inputs });
  assert.equal(summary.failed, 2);
  assert.deepEqual(summary.deferred, [
    { kind: "political-actor", target: "A" },
    { kind: "political-actor", target: "B" },
  ]);
});

test("actor retries shrink once, then defer exhausted targets and continue the world", () => {
  const polities = Array.from({ length: 12 }, (_, index) => `P${index + 1}`);
  const checkpoint = base();
  let task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.equal(task.targets.length, 8);

  checkpoint.attempts["political-actor:P1"] = 1;
  checkpoint.attempts["political-actor:P2"] = 1;
  task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.deepEqual(task.targets, ["P1", "P2"]);

  checkpoint.attempts["political-actor:P1"] = 2;
  checkpoint.attempts["political-actor:P2"] = 2;
  task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.deepEqual(task.targets, ["P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]);
});

test("when every unresolved actor is exhausted there is no actionable task but failures stay diagnostic", () => {
  const checkpoint = base();
  checkpoint.attempts = {
    "political-actor:A": 3,
    "political-actor:B": 3,
    "political-actor:C": 3,
  };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task, null);
  const summary = summarizePoliticalWorldV2Worklist({ checkpoint, inputs });
  assert.equal(summary.pending, 0);
  assert.equal(summary.failed, 3);
  assert.equal(summary.deferred.length, 3);
});


test("null fallback power scores remain actionable instead of counting as completed evidence", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B", "C"];
  checkpoint.coverage["governing-alignment"] = ["A", "B", "C"];
  checkpoint.stages.institutionDiscovery = "complete";
  checkpoint.stages.institutionGovernance = "complete";
  checkpoint.stages.agreements = "complete";
  checkpoint.stagedWorld.powerStatus.byPolity = {
    A: { tier: "minor-power", score: null, baselineScore: null, basis: "native-fallback" },
    B: { tier: "regional-power", score: 58, baselineScore: 58, basis: "generated-relative-baseline" },
    C: { tier: "minor-power", score: null, baselineScore: null, basis: "native-fallback" },
  };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "power-evidence");
  assert.deepEqual(task.targets, ["A", "C"]);
});


test("stale 202/202 coverage reopens an Other-heavy generated electoral roster", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B", "C"];
  checkpoint.stagedWorld.politicalActors.byPolity.B = {
    ...completeActor("B"),
    parties: [
      { id: "gov", name: "Government Party", support: { percent: 50, basis: "generated-estimate" }, ideology: "Pragmatic", publicPriorities: ["Maintain stability"] },
      { id: "opp", name: "Opposition Party", support: { percent: 15, basis: "generated-estimate" }, ideology: "Conservative", publicPriorities: ["Oppose government"] },
    ],
  };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "political-actor");
  assert.deepEqual(task.targets, ["B"]);
});

test("stale 202/202 actor coverage reopens a behaviorally shallow STANDARD actor", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B", "C"];
  checkpoint.stagedWorld.politicalActors.byPolity.B = {
    polityKey: "B",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", rulingPartyIds: ["gov"] },
    parties: [{ id: "gov", name: "Government Party", support: { percent: 55 } }],
  };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "political-actor");
  assert.deepEqual(task.targets, ["B"]);
});
