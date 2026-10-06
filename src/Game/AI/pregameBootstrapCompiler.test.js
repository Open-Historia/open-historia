import test from "node:test";
import assert from "node:assert/strict";

import {
  PREGAME_BOOTSTRAP_CONTRACT_VERSION,
  allocatePregameCanonicalId,
  compilePregameBootstrapCandidate,
  validatePregameBootstrapCandidateShape,
} from "./pregameBootstrapCompiler.js";
import { applyWorldStorylineUpdates } from "./nativeWorldDirector.js";

const makeWorld = (names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]) => ({
  polityOverrides: Object.fromEntries(
    names.map((name) => [name, { name, status: "active" }]),
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
    /guarantee must use directional guarantor\/beneficiary roles/,
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
    warFact({ sideA: ["Beta"], sideB: ["Alpha"] }),
  ], { world: first.projectedWorld });
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.receipt.facts[0].outcome, "merged");
  assert.equal(replay.receipt.facts[0].canonicalId, warId);
  assert.equal(replay.receipt.derived[0].outcome, "merged");
  assert.equal(replay.receipt.derived[0].canonicalId, `storyline-${warId}`);
});

test("a unique live war keeps its identity when an unknown start date later becomes known", () => {
  const first = compile([warFact({ startedDate: "" })]);
  assert.equal(first.ok, true, first.error);
  const warId = first.receipt.facts[0].canonicalId;

  const replay = compile([
    warFact({ ref: "w2", startedDate: "2020-11-18" }),
  ], { world: first.projectedWorld });
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.receipt.facts[0].outcome, "merged");
  assert.equal(replay.receipt.facts[0].canonicalId, warId);
  assert.equal(replay.projectedWorld.wars.length, 1);
});

test("a renamed live war is ambiguity rather than silent identity reuse", () => {
  const first = compile([warFact()]);
  assert.equal(first.ok, true, first.error);
  const renamed = compile([warFact({ ref: "w2", title: "Renamed Alpha-Beta Conflict" })], { world: first.projectedWorld });
  assert.equal(renamed.ok, false);
  assert.match(renamed.error, /identity is ambiguous/);
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
  assert.match(replay.error, /identity is ambiguous/);
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
  assert.match(conflict.error, /conflicts on absolute score/);
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

test("same-batch war facts resolve against staged canon and conflicts fail closed in either order", () => {
  const active = warFact({ ref: "w-active", status: "active" });
  const ceasefire = warFact({ ref: "w-ceasefire", status: "ceasefire" });
  for (const facts of [[active, ceasefire], [ceasefire, active]]) {
    const result = compile(facts);
    assert.equal(result.ok, false);
    assert.match(result.error, /conflicts on status/);
  }

  const renamed = compile([
    warFact({ ref: "w1" }),
    warFact({ ref: "w2", title: "A Different Label For The Same Live War" }),
  ]);
  assert.equal(renamed.ok, false);
  assert.match(renamed.error, /identity is ambiguous/);
});

test("war merge enriches unknown date and provenance and conserves them into the native mirror", () => {
  const first = compile([
    warFact({ startedDate: "", sourceEventRefs: ["e0"] }),
  ], { eventIdsByRef: { e0: "event-old" } });
  assert.equal(first.ok, true, first.error);
  const warId = first.receipt.facts[0].canonicalId;

  const replay = compile([
    warFact({ ref: "w2", startedDate: "2020-11-18", sourceEventRefs: ["e1"] }),
  ], {
    world: first.projectedWorld,
    eventIdsByRef: { e1: "event-new" },
  });
  assert.equal(replay.ok, true, replay.error);
  const war = replay.projectedWorld.wars.find((entry) => entry.id === warId);
  assert.equal(war.startedDate, "2020-11-18");
  assert.deepEqual(new Set(war.sourceEventIds), new Set(["event-old", "event-new"]));
  assert.equal(war.storylineIds.length, 1);
  const mirror = replay.projectedWorld.storylines.find((entry) => entry.id === war.storylineIds[0]);
  assert.ok(mirror);
  assert.equal(mirror.startedDate, "2020-11-18");
  assert.deepEqual(new Set(mirror.sourceEventIds), new Set(["event-old", "event-new"]));
  assert.equal(mirror.canonicalIdentity, true);
});

test("agreement merge enriches unknown date and provenance but rejects contradictory terms", () => {
  const first = compile([{
    ref: "a1", kind: "agreement", type: "alliance", title: "Alpha-Gamma Pact",
    parties: ["Alpha", "Gamma"], startedDate: "", terms: "Mutual support.", sourceEventRefs: ["e0"],
  }], { eventIdsByRef: { e0: "event-old" } });
  assert.equal(first.ok, true, first.error);
  const id = first.receipt.facts[0].canonicalId;

  const enriched = compile([{
    ref: "a2", kind: "agreement", type: "alliance", title: "Alpha-Gamma Pact",
    parties: ["Gamma", "Alpha"], startedDate: "2020-01-01", terms: "Mutual support.", sourceEventRefs: ["e1"],
  }], { world: first.projectedWorld, eventIdsByRef: { e1: "event-new" } });
  assert.equal(enriched.ok, true, enriched.error);
  const agreement = enriched.projectedWorld.agreements.find((entry) => entry.id === id);
  assert.equal(agreement.startedDate, "2020-01-01");
  assert.deepEqual(new Set(agreement.sourceEventIds), new Set(["event-old", "event-new"]));

  const conflict = compile([{
    ref: "a3", kind: "agreement", type: "alliance", title: "Alpha-Gamma Pact",
    parties: ["Alpha", "Gamma"], startedDate: "2020-01-01", terms: "A materially different obligation.",
  }], { world: enriched.projectedWorld });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /conflicts on substantive terms/);
});

test("military access preserves grant direction and reciprocal access explicitly", () => {
  const directional = compile([
    {
      ref: "m1", kind: "agreement", type: "military_access", title: "Base Access",
      grantor: "Alpha", grantee: "Beta", startedDate: "2020-01-01", terms: "Alpha grants Beta access.",
    },
    {
      ref: "m2", kind: "agreement", type: "military_access", title: "Base Access",
      grantor: "Beta", grantee: "Alpha", startedDate: "2020-01-01", terms: "Beta grants Alpha access.",
    },
  ]);
  assert.equal(directional.ok, true, directional.error);
  assert.equal(directional.projectedWorld.agreements.length, 2);
  assert.deepEqual(
    directional.projectedWorld.agreements.map((entry) => [entry.grantor, entry.grantee, entry.reciprocalAccess]).sort(),
    [["Alpha", "Beta", false], ["Beta", "Alpha", false]].sort(),
  );

  const reciprocal = compile([{
    ref: "m3", kind: "agreement", type: "military_access", title: "Reciprocal Access",
    parties: ["Alpha", "Beta"], reciprocal: true, startedDate: "2020-02-01", terms: "Mutual access.",
  }]);
  assert.equal(reciprocal.ok, true, reciprocal.error);
  assert.equal(reciprocal.projectedWorld.agreements[0].reciprocalAccess, true);
  assert.equal("grantor" in reciprocal.projectedWorld.agreements[0], false);
});

test("legacy military access without directional roles is ambiguity, not a silent reverse grant", () => {
  const world = makeWorld();
  world.agreements = [{
    id: "legacy-access", title: "Base Access", type: "military_access", status: "active",
    parties: ["Alpha", "Beta"], startedDate: "2020-01-01", terms: "Legacy record without direction.",
  }];
  const result = compile([{
    ref: "m1", kind: "agreement", type: "military_access", title: "Base Access",
    grantor: "Alpha", grantee: "Beta", startedDate: "2020-01-01", terms: "Alpha grants Beta access.",
  }], { world });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not record grant direction/);
});

test("scenario-authored storyline identity is adopted explicitly and survives ordinary coalescing", () => {
  const world = makeWorld();
  world.storylines = [
    {
      id: "scenario-one", kind: "crisis", title: "Banking Crisis", participants: ["Alpha"], status: "active",
      pressure: 70, momentum: 20, startedDate: "2020-01-01", state: "Banking stress remains unresolved.",
    },
    {
      id: "scenario-two", kind: "crisis", title: "Banking Crisis", participants: ["Alpha"], status: "active",
      pressure: 75, momentum: 25, startedDate: "2021-01-01", state: "A later distinct banking episode.",
    },
  ];
  const result = compile([{
    ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title: "Banking Crisis",
    participants: ["Alpha"], startedDate: "2020-01-01", pressure: 70, momentum: 20,
    state: "Banking stress remains unresolved.",
  }], { world });
  assert.equal(result.ok, true, result.error);
  const adopted = result.projectedWorld.storylines.find((entry) => entry.id === "scenario-one");
  assert.equal(adopted.canonicalIdentity, true);

  const ordinary = applyWorldStorylineUpdates({
    world: result.projectedWorld,
    updates: [], events: [], stopDate: "2021-08-01", round: 2,
  });
  assert.ok(ordinary.world.storylines.some((entry) => entry.id === "scenario-one"));
  assert.ok(ordinary.world.storylines.some((entry) => entry.id === "scenario-two"));
});

test("adopted scenario storyline identity survives ordinary capacity pressure", () => {
  const world = makeWorld();
  world.storylines = [{
    id: "scenario-anchor", kind: "crisis", title: "Banking Crisis", participants: ["Alpha"], status: "active",
    pressure: 70, momentum: 20, startedDate: "2020-01-01", state: "Banking stress remains unresolved.",
  }];
  const result = compile([{
    ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title: "Banking Crisis",
    participants: ["Alpha"], startedDate: "2020-01-01", pressure: 70, momentum: 20,
    state: "Banking stress remains unresolved.",
  }], { world });
  assert.equal(result.ok, true, result.error);

  const overflowWorld = {
    ...result.projectedWorld,
    storylines: [
      ...result.projectedWorld.storylines,
      ...Array.from({ length: 110 }, (_, index) => ({
        id: `filler-${index + 1}`,
        kind: "world",
        title: `Filler ${index + 1}`,
        participants: [index % 2 === 0 ? "Beta" : "Gamma"],
        status: "active",
        pressure: 50,
        momentum: 10,
        startedDate: "2021-01-01",
        accountedThroughDate: "2021-07-18",
        lastUpdatedDate: "2021-07-18",
        state: `Filler state ${index + 1}`,
      })),
    ],
  };
  const ordinary = applyWorldStorylineUpdates({
    world: overflowWorld, updates: [], events: [], stopDate: "2021-08-01", round: 2,
  });
  assert.ok(ordinary.world.storylines.length <= 96);
  assert.ok(ordinary.world.storylines.some((entry) => entry.id === "scenario-anchor"));
  assert.equal(ordinary.world.storylines.find((entry) => entry.id === "scenario-anchor")?.canonicalIdentity, true);
});

test("same-date distinct storyline title is ambiguity and conflicting state is rejected", () => {
  const world = makeWorld();
  world.storylines = [{
    id: "scenario-crisis", kind: "crisis", title: "Banking Crisis", participants: ["Alpha"], status: "active",
    pressure: 70, momentum: 20, startedDate: "2020-01-01", state: "Banking stress remains unresolved.",
  }];
  const renamed = compile([{
    ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title: "Industrial Slowdown",
    participants: ["Alpha"], startedDate: "2020-01-01", pressure: 70, momentum: 20,
    state: "Banking stress remains unresolved.",
  }], { world });
  assert.equal(renamed.ok, false);
  assert.match(renamed.error, /identity is ambiguous/);

  const conflict = compile([{
    ref: "s2", kind: "storyline", processKind: "crisis", status: "active", title: "Banking Crisis",
    participants: ["Alpha"], startedDate: "2020-01-01", pressure: 70, momentum: 20,
    state: "A contradictory canonical state.",
  }], { world });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /conflicts on canonical state/);
});

test("scenario-authored war mirror linkage is authoritative even when its id is not native-shaped", () => {
  const world = makeWorld();
  world.wars = [{
    id: "scenario-war", title: "Alpha-Beta War", status: "active", sideA: ["Alpha"], sideB: ["Beta"],
    startedDate: "2020-11-18", storylineIds: ["scenario-war-mirror"], sourceEventIds: [],
  }];
  world.storylines = [{
    id: "scenario-war-mirror", kind: "war", title: "Alpha-Beta War", participants: ["Alpha", "Beta"],
    status: "active", pressure: 80, momentum: 25, startedDate: "2020-11-18",
    state: "The conflict remains active.", sourceEventIds: [],
  }];
  const result = compile([warFact({ assessment: { pressure: 80, momentum: 25, state: "The conflict remains active." } })], { world });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.receipt.facts[0].canonicalId, "scenario-war");
  assert.equal(result.receipt.derived[0].canonicalId, "scenario-war-mirror");
  assert.equal(result.projectedWorld.storylines.find((entry) => entry.id === "scenario-war-mirror")?.canonicalIdentity, true);
  assert.deepEqual(result.projectedWorld.wars.find((entry) => entry.id === "scenario-war")?.storylineIds, ["scenario-war-mirror"]);
});

test("war mirror cardinality fails closed above twelve total belligerents", () => {
  const names = Array.from({ length: 24 }, (_, index) => `Polity ${index + 1}`);
  const world = makeWorld(names);
  const twelve = compile([warFact({
    sideA: names.slice(0, 6), sideB: names.slice(6, 12), title: "Twelve-Party War",
  })], { world });
  assert.equal(twelve.ok, true, twelve.error);
  assert.equal(twelve.projectedWorld.storylines.find((entry) => entry.kind === "war")?.participants.length, 12);

  const thirteen = compile([warFact({
    sideA: names.slice(0, 6), sideB: names.slice(6, 13), title: "Thirteen-Party War",
  })], { world });
  assert.equal(thirteen.ok, false);
  assert.match(thirteen.error, /at most 12 total belligerents|more than 12 total belligerents/);

  const twentyFourShape = validatePregameBootstrapCandidateShape({
    contractVersion: 1,
    facts: [warFact({ sideA: names.slice(0, 12), sideB: names.slice(12, 24), title: "Twenty-Four-Party War" })],
  });
  assert.match(twentyFourShape, /at most 12 total belligerents/);
});

test("known Day-One baseline dates may not be later than the campaign start", () => {
  const cases = [
    warFact({ startedDate: "2030-01-01" }),
    { ref: "a1", kind: "agreement", type: "alliance", title: "Pact", parties: ["Alpha", "Beta"], startedDate: "2030-01-01", terms: "x" },
    { ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title: "Crisis", participants: ["Alpha"], startedDate: "2030-01-01", pressure: 50, momentum: 20, state: "x" },
    { ref: "p1", kind: "puppet", overlord: "Alpha", puppet: "Beta", puppetKind: "client", loyalty: 50, secrecy: "open", startedDate: "2030-01-01" },
  ];
  for (const fact of cases) {
    const result = compile([fact], { startDate: "2021-07-18" });
    assert.equal(result.ok, false);
    assert.match(result.error, /after the Round-One campaign start/);
  }
});

test("semantic receipt is family-specific even when scenario canon reuses an id across families", () => {
  const world = makeWorld();
  world.wars = [{
    id: "shared-id", title: "Alpha-Beta War", status: "active", sideA: ["Alpha"], sideB: ["Beta"],
    startedDate: "2020-11-18", storylineIds: ["war-shared-mirror"], sourceEventIds: [],
  }];
  world.storylines = [{
    id: "war-shared-mirror", kind: "war", title: "Alpha-Beta War", participants: ["Alpha", "Beta"],
    status: "active", pressure: 85, momentum: 30, startedDate: "2020-11-18", state: "Open conflict continues.",
  }];
  world.agreements = [{
    id: "shared-id", title: "Gamma-Delta Pact", type: "alliance", status: "active",
    parties: ["Gamma", "Delta"], startedDate: "2020-01-01", terms: "Mutual support.", sourceEventIds: [],
  }];
  const result = compile([{
    ref: "a1", kind: "agreement", type: "alliance", title: "Gamma-Delta Pact",
    parties: ["Gamma", "Delta"], startedDate: "2020-01-01", terms: "Mutual support.",
  }], { world });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.receipt.facts[0].kind, "agreement");
  assert.equal(result.receipt.facts[0].canonicalId, "shared-id");
  assert.ok(result.projectedWorld.wars.some((entry) => entry.id === "shared-id"));
  assert.ok(result.projectedWorld.agreements.some((entry) => entry.id === "shared-id"));
});

// --- titles that are not written in Latin letters ---
//
// Every identity rule above compares titles by a folded key, and the fold kept
// a-z0-9 only. A game played in Russian or Chinese writes its titles in neither,
// so each title's key was "" and every title was every other: two wars between
// the same sides were one war, two treaties among the same parties one treaty,
// and a crisis among a war's belligerents was always "ambiguous with" the war.
// The rules are the same rules in every script now.
const SCRIPTS = {
  Cyrillic: {
    wars: ["Крымская война", "Донбасская война"],
    pacts: ["Договор о дружбе, сотрудничестве и партнёрстве", "Договор о создании Союзного государства"],
    crises: ["Политический кризис и смена власти", "Газовый спор"],
  },
  Chinese: {
    wars: ["第一次边境战争", "第二次边境战争"],
    pacts: ["睦邻友好合作条约", "和平友好条约"],
    crises: ["政治危机与政权更迭", "天然气争端"],
  },
};

for (const [script, { wars, pacts, crises }] of Object.entries(SCRIPTS)) {
  test(`${script}: a live war keeps its identity under its own title, and another title is another war's`, () => {
    const first = compile([warFact({ title: wars[0] })]);
    assert.equal(first.ok, true, first.error);
    const warId = first.receipt.facts[0].canonicalId;

    // The same war again, its title cased and punctuated otherwise.
    const again = compile([warFact({ ref: "w2", title: `  ${wars[0].toUpperCase()}!` })], { world: first.projectedWorld });
    assert.equal(again.ok, true, again.error);
    assert.equal(again.receipt.facts[0].outcome, "merged");
    assert.equal(again.receipt.facts[0].canonicalId, warId);

    // Same sides, same date, another name: it used to be merged into the first
    // without a word, because both names were the empty key.
    const renamed = compile([warFact({ ref: "w3", title: wars[1] })], { world: first.projectedWorld });
    assert.equal(renamed.ok, false);
    assert.match(renamed.error, /identity is ambiguous/);
  });

  test(`${script}: two wars of one day between the same sides are given two ids`, () => {
    const worldOf = (title) => compile([warFact({ title })]).receipt.facts[0].canonicalId;
    assert.match(worldOf(wars[0]), /^war-r0v1-/);
    assert.notEqual(worldOf(wars[0]), worldOf(wars[1]), "the title is part of what a new war's id is made from");
  });

  test(`${script}: a second treaty among the same parties is not the first under another name`, () => {
    const pact = (ref, title, terms) => ({ ref, kind: "agreement", type: "alliance", title, parties: ["Alpha", "Gamma"], startedDate: "2020-01-01", terms });
    const first = compile([pact("a1", pacts[0], "Standing alliance.")]);
    assert.equal(first.ok, true, first.error);
    const other = compile([pact("a2", pacts[1], "Standing alliance.")], { world: first.projectedWorld });
    assert.equal(other.ok, false, "it was merged into the first: same parties, same type, same date, and the same empty title key");
    assert.match(other.error, /identity is ambiguous/);
    const same = compile([pact("a3", pacts[0], "Standing alliance.")], { world: first.projectedWorld });
    assert.equal(same.ok, true, same.error);
    assert.equal(same.receipt.facts[0].outcome, "merged");
  });

  test(`${script}: a crisis among a war's belligerents is not the war unless it has the war's title`, () => {
    const crisis = (title) => ({
      ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title,
      participants: ["Alpha", "Beta"], startedDate: "2020-11-01", pressure: 95, momentum: 60,
      state: "A constitutional crisis accompanies the fighting.",
    });
    // Its own title: a process of its own. This answer used to be refused whole.
    const own = compile([warFact({ title: wars[0] }), crisis(crises[0])]);
    assert.equal(own.ok, true, own.error);
    assert.ok(own.projectedWorld.storylines.some((entry) => entry.kind === "crisis" && entry.title === crises[0]));
    // The war's title: still ambiguous with the war, as in any script.
    const shared = compile([warFact({ title: wars[0] }), crisis(wars[0])]);
    assert.equal(shared.ok, false);
    assert.match(shared.error, /ambiguous with war fact w1/);
  });

  test(`${script}: a scenario's own storyline is not replaced by one of another name`, () => {
    const world = makeWorld();
    world.storylines = [{
      id: "scenario-crisis", kind: "crisis", title: crises[0], participants: ["Alpha"], status: "active",
      pressure: 70, momentum: 20, startedDate: "2020-01-01", state: "Unresolved.",
    }];
    const fact = (title) => ({
      ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title,
      participants: ["Alpha"], startedDate: "2020-01-01", pressure: 70, momentum: 20, state: "Unresolved.",
    });
    const renamed = compile([fact(crises[1])], { world });
    assert.equal(renamed.ok, false, "it was adopted as the scenario's storyline: same kind, same participants, same empty title key");
    assert.match(renamed.error, /identity is ambiguous/);
    const same = compile([fact(crises[0])], { world });
    assert.equal(same.ok, true, same.error);
    assert.equal(same.receipt.facts[0].canonicalId, "scenario-crisis");
  });
}
