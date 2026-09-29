import test from "node:test";
import assert from "node:assert/strict";

import {
  PREGAME_BOOTSTRAP_CONTRACT_VERSION,
  allocatePregameCanonicalId,
  compilePregameBootstrapCandidate,
  validatePregameBootstrapCandidateShape,
} from "./pregameBootstrapCompiler.js";
import { applyWorldStorylineUpdates } from "./nativeWorldDirector.js";

const makeWorld = () => ({
  polityOverrides: Object.fromEntries(
    ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((name) => [name, { name, status: "active" }]),
  ),
  wars: [],
  relations: [],
  agreements: [],
  puppets: [],
  storylines: [],
});

const compile = (facts, options = {}) => compilePregameBootstrapCandidate({
  candidate: { contractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION, facts },
  world: options.world || makeWorld(),
  eventIdsByRef: options.eventIdsByRef || {},
  startDate: options.startDate || "2021-07-18",
  puppetStates: options.puppetStates ?? true,
});

const warFact = (patch = {}) => ({
  ref: "w1",
  kind: "war",
  title: "Alpha-Beta War",
  status: "active",
  sideA: ["Alpha"],
  sideB: ["Beta"],
  startedDate: "2020-11-18",
  note: "Open conflict continues.",
  ...patch,
});

test("CP2 candidate contract rejects model-owned persistent ids and lifecycle bookkeeping", () => {
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{ ...warFact(), id: "model-war-id", op: "start", eventIndexes: [0] }],
    }),
    /unsupported field.*Persistent ids, lifecycle verbs and engine bookkeeping are native-owned/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{
        ref: "g1", kind: "agreement", type: "guarantee", title: "Security Guarantee",
        guarantor: "Alpha", beneficiary: "Beta", parties: ["Alpha", "Beta"], startedDate: "2021-01-01",
      }],
    }),
    /must use directional guarantor\/beneficiary roles, not parties/,
  );
});

test("CP2 candidate contract is versioned and rejects model-authored war storylines", () => {
  assert.match(
    validatePregameBootstrapCandidateShape({ contractVersion: 99, facts: [] }),
    /contractVersion/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{
        ref: "s1", kind: "storyline", processKind: "war", status: "active",
        title: "War", participants: ["Alpha", "Beta"], pressure: 80, momentum: 30,
      }],
    }),
    /non-war processKind/,
  );
});

test("native war identity is side-order independent and replay is idempotent", () => {
  const first = compile([warFact()]);
  assert.equal(first.ok, true, first.error);
  const warId = first.receipt.facts[0].canonicalId;
  assert.match(warId, /^war-r0v1-/);
  assert.equal(first.receipt.derived[0].canonicalId, `storyline-${warId}`);

  const replay = compile([
    warFact({ title: "Renamed Alpha-Beta Conflict", sideA: ["Beta"], sideB: ["Alpha"] }),
  ], { world: first.projectedWorld });
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.receipt.facts[0].outcome, "merged");
  assert.equal(replay.receipt.facts[0].canonicalId, warId);
  assert.equal(replay.receipt.derived[0].outcome, "merged");
  assert.equal(replay.receipt.derived[0].canonicalId, `storyline-${warId}`);
});

test("a unique live war keeps its identity when an unknown start date later becomes known and the title is paraphrased", () => {
  const first = compile([warFact({ startedDate: "" })]);
  assert.equal(first.ok, true, first.error);
  const warId = first.receipt.facts[0].canonicalId;

  const replay = compile([
    warFact({ ref: "w2", title: "Renamed Alpha-Beta Conflict", startedDate: "2020-11-18" }),
  ], { world: first.projectedWorld });
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.receipt.facts[0].outcome, "merged");
  assert.equal(replay.receipt.facts[0].canonicalId, warId);
  assert.equal(replay.projectedWorld.wars.length, 1);
});

test("repeated war episodes with different known start dates do not collapse", () => {
  const first = compile([warFact()]);
  assert.equal(first.ok, true, first.error);
  const oldWar = { ...first.projectedWorld.wars[0], status: "ended", endedDate: "2021-01-01" };
  const world = { ...first.projectedWorld, wars: [oldWar], storylines: [] };
  const second = compile([warFact({ ref: "w2", startedDate: "2021-05-01" })], { world });
  assert.equal(second.ok, true, second.error);
  assert.notEqual(second.receipt.facts[0].canonicalId, oldWar.id);
  assert.equal(second.projectedWorld.wars.length, 2);
});

test("a conflicting date for an already-live same war fails closed instead of forking identity", () => {
  const first = compile([warFact()]);
  assert.equal(first.ok, true, first.error);
  const conflict = compile([warFact({ ref: "w2", startedDate: "2021-05-01" })], { world: first.projectedWorld });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /same sides\/title but a different known start date/);
});

test("an agreement with incomplete identity fails closed rather than guessing across a renamed title", () => {
  const first = compile([{
    ref: "a1", kind: "agreement", type: "alliance", title: "Alpha-Gamma Pact",
    parties: ["Alpha", "Gamma"], startedDate: "", terms: "Standing alliance.",
  }]);
  assert.equal(first.ok, true, first.error);

  const replay = compile([{
    ref: "a2", kind: "agreement", type: "alliance", title: "Renamed Mutual Defense Treaty",
    parties: ["Gamma", "Alpha"], startedDate: "2020-01-01", terms: "Possibly the same alliance.",
  }], { world: first.projectedWorld });
  assert.equal(replay.ok, false);
  assert.match(replay.error, /incomplete date identity/);
  assert.equal(replay.projectedWorld, null);
});

test("guarantee direction is canonical identity, not an unordered party set", () => {
  const result = compile([
    {
      ref: "g1", kind: "agreement", type: "guarantee", title: "Security Guarantee",
      guarantor: "Alpha", beneficiary: "Beta", startedDate: "2021-01-01", terms: "Alpha guarantees Beta.",
    },
    {
      ref: "g2", kind: "agreement", type: "guarantee", title: "Security Guarantee",
      guarantor: "Beta", beneficiary: "Alpha", startedDate: "2021-01-01", terms: "Beta guarantees Alpha.",
    },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.compiled.agreements.length, 2);
  assert.notEqual(result.compiled.agreements[0].id, result.compiled.agreements[1].id);
  assert.deepEqual(
    result.compiled.agreements.map((entry) => [entry.guarantor, entry.beneficiary]),
    [["Alpha", "Beta"], ["Beta", "Alpha"]],
  );
});

test("unknown baseline dates remain unknown across canonical record families", () => {
  const result = compile([
    warFact({ startedDate: "" }),
    { ref: "a1", kind: "agreement", type: "alliance", title: "Alpha-Gamma Pact", parties: ["Alpha", "Gamma"], startedDate: "", terms: "Standing alliance." },
    { ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title: "Gamma Crisis", participants: ["Gamma"], startedDate: "", pressure: 60, momentum: 20, state: "Unresolved." },
    { ref: "p1", kind: "puppet", overlord: "Delta", puppet: "Epsilon", puppetKind: "client", loyalty: 55, secrecy: "open", startedDate: "" },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.compiled.wars[0].startedDate, "");
  assert.equal(result.compiled.agreements[0].startedDate, "");
  const crisis = result.compiled.storylines.find((entry) => entry.kind === "crisis");
  assert.equal(crisis.startedDate, "");
  assert.equal(result.compiled.puppets[0].startedDate, "");
  const mirror = result.compiled.storylines.find((entry) => entry.kind === "war");
  assert.equal(mirror.startedDate, "");
});

test("native allocation never trusts a hash slot that is already occupied", () => {
  const seed = "same semantic seed";
  const base = allocatePregameCanonicalId("war", seed, new Set());
  const collided = allocatePregameCanonicalId("war", seed, new Set([base]));
  assert.notEqual(collided, base);
  assert.equal(collided, `${base}-2`);
});

test("war-like non-war storyline is ambiguity, not an automatic merge", () => {
  const result = compile([
    warFact(),
    {
      ref: "s1", kind: "storyline", processKind: "crisis", status: "active",
      title: "Alpha-Beta War", participants: ["Alpha", "Beta"], startedDate: "2020-11-01",
      pressure: 95, momentum: 60, state: "A constitutional crisis accompanies the fighting.",
    },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /ambiguous with war fact w1/);
  assert.equal(result.receipt.facts.find((entry) => entry.ref === "s1")?.outcome, "rejected");
});

test("an explicitly distinct crisis may coexist with its related war", () => {
  const result = compile([
    {
      ref: "s1", kind: "storyline", processKind: "crisis", status: "active",
      title: "Alpha-Beta War", participants: ["Alpha", "Beta"], startedDate: "2020-11-01",
      pressure: 95, momentum: 60, state: "A separate constitutional legitimacy crisis.",
      distinctFromWarRef: "w1",
    },
    warFact(),
  ]);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.projectedWorld.storylines.length, 2);
  assert.ok(result.projectedWorld.storylines.some((entry) => entry.kind === "crisis"));
  assert.ok(result.projectedWorld.storylines.some((entry) => entry.kind === "war"));
});

test("id-authoritative baseline storylines survive ordinary coalescing even with same semantics", () => {
  const result = compile([
    {
      ref: "s1", kind: "storyline", processKind: "crisis", status: "active",
      title: "Constitutional Crisis", participants: ["Alpha", "Beta"], startedDate: "2020-01-01",
      pressure: 70, momentum: 20, state: "First phase remains unresolved.",
    },
    {
      ref: "s2", kind: "storyline", processKind: "crisis", status: "active",
      title: "Constitutional Crisis", participants: ["Alpha", "Beta"], startedDate: "2021-01-01",
      pressure: 75, momentum: 25, state: "A distinct later phase remains unresolved.",
    },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.projectedWorld.storylines.length, 2);
  assert.notEqual(result.projectedWorld.storylines[0].id, result.projectedWorld.storylines[1].id);
  assert.ok(result.projectedWorld.storylines.every((entry) => /^storyline-r0v1-/.test(entry.id)));

  const ordinary = applyWorldStorylineUpdates({
    world: result.projectedWorld,
    updates: [],
    events: [],
    stopDate: "2021-08-01",
    round: 2,
  });
  assert.equal(ordinary.world.storylines.length, 2, "ordinary coalescing must not erase compiler-owned identities");
});

test("source event refs bind to stable event ids and missing refs fail closed", () => {
  const result = compile([
    { ref: "r1", kind: "relation", a: "Alpha", b: "Beta", score: 20, summary: "Working ties.", sourceEventRefs: ["e1"] },
  ], { eventIdsByRef: { e1: "pregame-event-1" } });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.compiled.relations[0].sourceEventIds, ["pregame-event-1"]);

  const missing = compile([
    { ref: "r1", kind: "relation", a: "Alpha", b: "Beta", score: 20, summary: "Working ties.", sourceEventRefs: ["missing"] },
  ]);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /does not resolve to a generated event id/);
});

test("existing scenario-authored relation is reused only when the substantive score agrees", () => {
  const first = compile([{ ref: "r1", kind: "relation", a: "Alpha", b: "Beta", score: 20, summary: "Working ties." }]);
  assert.equal(first.ok, true, first.error);

  const replay = compile([{ ref: "r2", kind: "relation", a: "Beta", b: "Alpha", score: 20, summary: "Different wording." }], { world: first.projectedWorld });
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.receipt.facts[0].outcome, "merged");
  assert.equal(replay.receipt.facts[0].canonicalId, first.receipt.facts[0].canonicalId);

  const conflict = compile([{ ref: "r3", kind: "relation", a: "Alpha", b: "Beta", score: -40, summary: "Contradictory model state." }], { world: first.projectedWorld });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /conflicts with existing authoritative relation/);
});

test("puppet baseline rejects chains instead of silently reparenting Round-Zero canon", () => {
  const result = compile([
    { ref: "p1", kind: "puppet", overlord: "Alpha", puppet: "Beta", puppetKind: "client", loyalty: 60, secrecy: "open", startedDate: "2020-01-01" },
    { ref: "p2", kind: "puppet", overlord: "Beta", puppet: "Gamma", puppetKind: "client", loyalty: 60, secrecy: "open", startedDate: "2020-01-01" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /puppet chain is forbidden/);
});

test("final-state conservation refuses a baseline that would evict existing authoritative canon", () => {
  const world = makeWorld();
  world.wars = Array.from({ length: 64 }, (_, index) => ({
    id: `existing-war-${index + 1}`,
    title: `Historical War ${index + 1}`,
    status: "ended",
    sideA: ["Alpha"],
    sideB: ["Beta"],
    startedDate: `19${String(index).padStart(2, "0")}-01-01`,
    endedDate: `19${String(index).padStart(2, "0")}-12-31`,
    lastUpdatedDate: `19${String(index).padStart(2, "0")}-12-31`,
  }));

  const result = compile([warFact({ ref: "w-new", title: "Current War", startedDate: "2020-11-18" })], { world });
  assert.equal(result.ok, false);
  assert.match(result.error, /would evict existing authoritative war record/);
});

test("successful receipt conserves every candidate fact and native-derived war mirror", () => {
  const result = compile([
    warFact(),
    { ref: "r1", kind: "relation", a: "Alpha", b: "Gamma", score: -25, summary: "Cautious ties." },
    { ref: "a1", kind: "agreement", type: "alliance", title: "Gamma-Delta Pact", parties: ["Gamma", "Delta"], startedDate: "2020-01-01", terms: "Mutual support." },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.receipt.facts.length, 3);
  assert.equal(result.receipt.counts.candidateFacts, 3);
  assert.equal(result.receipt.derived.length, 1);
  const survivingIds = new Set([
    ...result.projectedWorld.wars.map((entry) => entry.id),
    ...result.projectedWorld.relations.map((entry) => entry.id),
    ...result.projectedWorld.agreements.map((entry) => entry.id),
    ...result.projectedWorld.storylines.map((entry) => entry.id),
  ]);
  for (const entry of [...result.receipt.facts, ...result.receipt.derived]) {
    assert.ok(survivingIds.has(entry.canonicalId), `${entry.canonicalId} must survive projected final state`);
  }
});

test("semantic baseline contract rejects clamped numeric ranges and lossy polity overflow", () => {
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{ ref: "r1", kind: "relation", a: "Alpha", b: "Beta", score: 101 }],
    }),
    /between -100 and 100/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{
        ref: "w1", kind: "war", title: "War", status: "active",
        sideA: ["Alpha"], sideB: ["Beta"], assessment: { pressure: -1, momentum: 20 },
      }],
    }),
    /assessment\.pressure must be between 0 and 100/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{
        ref: "s1", kind: "storyline", processKind: "crisis", status: "active",
        title: "Crisis", participants: ["Alpha"], pressure: 50, momentum: 101,
      }],
    }),
    /pressure and momentum must each be between 0 and 100/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{
        ref: "p1", kind: "puppet", overlord: "Alpha", puppet: "Beta",
        puppetKind: "client", loyalty: -1, secrecy: "open",
      }],
    }),
    /loyalty must be between 0 and 100/,
  );

  const thirteen = Array.from({ length: 13 }, (_, index) => `Polity ${index + 1}`);
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{ ref: "w1", kind: "war", title: "War", status: "active", sideA: thirteen, sideB: ["Beta"] }],
    }),
    /war sides may contain at most 12 distinct polities/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{ ref: "a1", kind: "agreement", type: "alliance", title: "Pact", parties: thirteen }],
    }),
    /agreement may contain at most 12 distinct parties/,
  );
  assert.match(
    validatePregameBootstrapCandidateShape({
      contractVersion: 1,
      facts: [{
        ref: "s1", kind: "storyline", processKind: "crisis", status: "active",
        title: "Crisis", participants: thirteen, pressure: 50, momentum: 20,
      }],
    }),
    /storyline may contain at most 12 distinct participants/,
  );
});
