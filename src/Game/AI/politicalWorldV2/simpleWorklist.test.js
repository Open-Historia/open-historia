import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalWorldV2Checkpoint } from "./checkpoint.js";
import { acceptedPoliticalWorldV2ActorTargets, deriveNextPoliticalWorldV2Task, summarizePoliticalWorldV2Worklist } from "./simpleWorklist.js";

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

test("actor retries use the full 12-polity first pass and a bounded 6-polity retry batch", () => {
  const polities = Array.from({ length: 18 }, (_, index) => `P${index + 1}`);
  const checkpoint = base();
  let task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.equal(task.targets.length, 12);

  for (const polity of polities.slice(0, 6)) checkpoint.attempts[`political-actor:${polity}`] = 1;
  task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.deepEqual(task.targets, polities.slice(0, 6));

  for (const polity of polities.slice(0, 6)) checkpoint.attempts[`political-actor:${polity}`] = 2;
  task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs: { polities } });
  assert.deepEqual(task.targets, polities.slice(6, 18));
});

test("a staged actor is not accepted merely because a patch applied when native completeness still says it is shallow", () => {
  const checkpoint = base(["A"]);
  checkpoint.stagedWorld.politicalActors.byPolity.A = {
    polityKey: "A",
    politicalSystem: { type: "unspecified", representation: "none" },
    government: { rulingPartyIds: [], coalitionPartyIds: [] },
    parties: [],
    powerBlocs: [],
    goals: ["Preserve stability"],
  };
  assert.deepEqual(acceptedPoliticalWorldV2ActorTargets({ checkpoint, inputs: { ...inputs, polities: ["A"], scenarioDate: "2014-03-22" }, targets: ["A"] }), []);

  checkpoint.stagedWorld.politicalActors.byPolity.A = completeActor("A");
  assert.deepEqual(acceptedPoliticalWorldV2ActorTargets({ checkpoint, inputs: { ...inputs, polities: ["A"], scenarioDate: "2014-03-22" }, targets: ["A"] }), ["A"]);
});

test("when every unresolved actor is exhausted the scheduler preserves failures and advances independent work", () => {
  const checkpoint = base();
  checkpoint.attempts = {
    "political-actor:A": 3,
    "political-actor:B": 3,
    "political-actor:C": 3,
  };
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "institution-discovery");
  const summary = summarizePoliticalWorldV2Worklist({ checkpoint, inputs });
  assert.equal(summary.pending, 1);
  assert.equal(summary.failed, 3);
  assert.equal(summary.deferred.length, 3);
});

test("deferred actor gaps do not head-of-line block alignment for actor-ready polities", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B"];
  delete checkpoint.stagedWorld.politicalActors.byPolity.C;
  checkpoint.attempts["political-actor:C"] = 2;
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "governing-alignment");
  assert.deepEqual(task.targets, ["A", "B"]);
});

test("once ready-polity alignment is done, a deferred actor does not block independent institution work", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B"];
  checkpoint.coverage["governing-alignment"] = ["A", "B"];
  delete checkpoint.stagedWorld.politicalActors.byPolity.C;
  checkpoint.attempts["political-actor:C"] = 2;
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "institution-discovery");
});


test("an exhausted institution-discovery gate does not run dependent institution stages but allows independent power work", () => {
  const checkpoint = base();
  checkpoint.coverage["political-actor"] = ["A", "B", "C"];
  checkpoint.coverage["governing-alignment"] = ["A", "B", "C"];
  checkpoint.attempts["institution-discovery:global"] = 2;
  checkpoint.stagedWorld.powerStatus.byPolity = {};
  const task = deriveNextPoliticalWorldV2Task({ checkpoint, inputs });
  assert.equal(task.type, "power-evidence");
  assert.deepEqual(task.targets, ["A", "B", "C"]);
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
