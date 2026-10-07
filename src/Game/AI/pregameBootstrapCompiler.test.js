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
  leaveOutAmbiguous: options.leaveOutAmbiguous ?? false,
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

// This was "a renamed live war is ambiguity rather than silent identity reuse":
// the one live war between these sides, said under another name, refused the
// whole answer. It is read as that war now, and said to be (receipt.restated);
// the cases that are still ambiguity are further down.
test("the one live war between two sides, under another title, is that war and keeps its title", () => {
  const first = compile([warFact()]);
  assert.equal(first.ok, true, first.error);
  const warId = first.receipt.facts[0].canonicalId;
  const renamed = compile([warFact({ ref: "w2", title: "Renamed Alpha-Beta Conflict" })], { world: first.projectedWorld });
  assert.equal(renamed.ok, true, renamed.error);
  assert.deepEqual([renamed.receipt.facts[0].outcome, renamed.receipt.facts[0].canonicalId], ["merged", warId]);
  assert.deepEqual(renamed.projectedWorld.wars.map((war) => war.title), ["Alpha-Beta War"]);
  assert.deepEqual(renamed.receipt.restated, [{
    ref: "w2", kind: "war", canonicalId: warId, title: "Renamed Alpha-Beta Conflict", canonicalTitle: "Alpha-Beta War",
  }]);
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

// This was "an agreement with incomplete identity fails closed rather than
// guessing across a renamed title". The one alliance between these two is the
// alliance a second fact means, whatever it is called: the record keeps its own
// title and terms, and takes from the fact the start date it did not have, as
// it would from a fact under its own title.
test("the one agreement of a type among the same parties, under another title, is that agreement", () => {
  const first = compile([{
    ref: "a1", kind: "agreement", type: "alliance", title: "Alpha-Gamma Pact",
    parties: ["Alpha", "Gamma"], startedDate: "", terms: "Standing alliance.",
  }]);
  assert.equal(first.ok, true, first.error);
  const id = first.receipt.facts[0].canonicalId;

  const replay = compile([{
    ref: "a2", kind: "agreement", type: "alliance", title: "Renamed Mutual Defense Treaty",
    parties: ["Gamma", "Alpha"], startedDate: "2020-01-01", terms: "Possibly the same alliance.",
  }], { world: first.projectedWorld });
  assert.equal(replay.ok, true, replay.error);
  assert.deepEqual([replay.receipt.facts[0].outcome, replay.receipt.facts[0].canonicalId], ["merged", id]);
  assert.equal(replay.projectedWorld.agreements.length, 1);
  const pact = replay.projectedWorld.agreements[0];
  assert.deepEqual([pact.title, pact.terms, pact.startedDate], ["Alpha-Gamma Pact", "Standing alliance.", "2020-01-01"]);
  assert.deepEqual(replay.receipt.restated, [{
    ref: "a2", kind: "agreement", canonicalId: id, title: "Renamed Mutual Defense Treaty", canonicalTitle: "Alpha-Gamma Pact",
  }]);
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
// so each title's key was "" and every title was every other: with two wars
// between the same sides on record, a fact that named one of them named both,
// a second treaty was the first without anyone being told, and a crisis among a
// war's belligerents was always "ambiguous with" the war. The rules are the
// same rules in every script now.
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
  test(`${script}: a live war is known by its own title, and told from another on record by it`, () => {
    const first = compile([warFact({ title: wars[0] })]);
    assert.equal(first.ok, true, first.error);
    const warId = first.receipt.facts[0].canonicalId;

    // The same war again, its title cased and punctuated otherwise: the same
    // title, so nothing is said to have been restated.
    const again = compile([warFact({ ref: "w2", title: `  ${wars[0].toUpperCase()}!` })], { world: first.projectedWorld });
    assert.equal(again.ok, true, again.error);
    assert.deepEqual([again.receipt.facts[0].outcome, again.receipt.facts[0].canonicalId], ["merged", warId]);
    assert.deepEqual(again.receipt.restated, []);

    // The only live war between these sides under another name is that war,
    // and is said to be: it used to be taken for it without a word, because
    // both names were the empty key.
    const renamed = compile([warFact({ ref: "w3", title: wars[1] })], { world: first.projectedWorld });
    assert.equal(renamed.ok, true, renamed.error);
    assert.equal(renamed.receipt.facts[0].canonicalId, warId);
    assert.deepEqual(renamed.receipt.restated.map((entry) => [entry.title, entry.canonicalTitle]), [[wars[1], wars[0]]]);
    assert.deepEqual(renamed.projectedWorld.wars.map((war) => war.title), [wars[0]]);

    // Two live wars between the same sides on record: a fact that names one is
    // that one. With the empty key it named both, and was refused.
    const world = makeWorld();
    world.wars = wars.map((title, index) => ({
      id: `scenario-war-${index + 1}`, title, status: "active", sideA: ["Alpha"], sideB: ["Beta"],
      startedDate: "2020-11-18", sourceEventIds: [], storylineIds: [],
    }));
    const second = compile([warFact({ ref: "w4", title: wars[1] })], { world });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.receipt.facts[0].canonicalId, "scenario-war-2");
    assert.deepEqual(second.receipt.restated, []);
  });

  test(`${script}: two wars of one day between the same sides are given two ids`, () => {
    const worldOf = (title) => compile([warFact({ title })]).receipt.facts[0].canonicalId;
    assert.match(worldOf(wars[0]), /^war-r0v1-/);
    assert.notEqual(worldOf(wars[0]), worldOf(wars[1]), "the title is part of what a new war's id is made from");
  });

  test(`${script}: a treaty is known by its own title, and told from another on record by it`, () => {
    const pact = (ref, title, terms) => ({ ref, kind: "agreement", type: "alliance", title, parties: ["Alpha", "Gamma"], startedDate: "2020-01-01", terms });
    const first = compile([pact("a1", pacts[0], "Standing alliance.")]);
    assert.equal(first.ok, true, first.error);
    const id = first.receipt.facts[0].canonicalId;
    const same = compile([pact("a3", pacts[0], "Standing alliance.")], { world: first.projectedWorld });
    assert.equal(same.ok, true, same.error);
    assert.equal(same.receipt.facts[0].outcome, "merged");
    assert.deepEqual(same.receipt.restated, []);

    // The only alliance between these two under another name is that alliance,
    // and is said to be. With the empty key it was taken for it unsaid, and a
    // word of difference in its terms then refused the whole answer.
    const other = compile([pact("a2", pacts[1], "The same alliance in other words.")], { world: first.projectedWorld });
    assert.equal(other.ok, true, other.error);
    assert.equal(other.receipt.facts[0].canonicalId, id);
    assert.deepEqual(other.receipt.restated.map((entry) => [entry.title, entry.canonicalTitle]), [[pacts[1], pacts[0]]]);
    assert.deepEqual(other.projectedWorld.agreements.map((entry) => [entry.title, entry.terms]), [[pacts[0], "Standing alliance."]]);

    // Two alliances between the same two on record: a fact that names one is
    // that one. With the empty key it named both, and was refused.
    const world = makeWorld();
    world.agreements = pacts.map((title, index) => ({
      id: `scenario-pact-${index + 1}`, title, type: "alliance", status: "active", parties: ["Alpha", "Gamma"],
      startedDate: "2020-01-01", terms: "Standing alliance.", sourceEventIds: [],
    }));
    const second = compile([pact("a4", pacts[1], "Standing alliance.")], { world });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.receipt.facts[0].canonicalId, "scenario-pact-2");
    assert.deepEqual(second.receipt.restated, []);
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

// --- a fact that says again what the world already holds ---
//
// A player's log (beta 0.0.66, 2026-10-05, the game played in Russian). The
// first fact of the Round-Zero answer was the 1997 friendship treaty between
// Russia and Ukraine, under its Russian title, and the world already held a
// friendship agreement between the two:
//
//   $.facts[0] Round-Zero agreement identity is ambiguous: the same roles/type/
//   date already exist under a different canonical title.
//
// The whole answer was refused for it, the corrective attempt said the same
// thing again and was refused again, the bootstrap failed, and it was asked for
// again at every open of the game: two requests, of 14,000 and 15,000 tokens,
// and never a pre-game history. The two facts below are the first two of that
// answer as the model wrote them. What the world's own record was titled is not
// in the log; it is given an English title here, the usual case.
const TREATY_IN_RUSSIAN = "Договор о дружбе, сотрудничестве и партнерстве между Российской Федерацией и Украиной";
const UNION_STATE_IN_RUSSIAN = "Договор о создании Союзного государства";
const friendshipFact = (patch = {}) => ({
  ref: "f1", kind: "agreement", type: "friendship_consultation", title: TREATY_IN_RUSSIAN,
  parties: ["Russian Federation", "Ukraine"],
  terms: "Подтверждает стратегическое партнерство, нерушимость границ, уважение территориальной целостности и взаимное обязательство не использовать территорию для нанесения ущерба безопасности друг друга.",
  ...patch,
});
const unionStateFact = (patch = {}) => ({
  ref: "f2", kind: "agreement", type: "trade_economic", title: UNION_STATE_IN_RUSSIAN,
  parties: ["Russian Federation", "Republic of Belarus"],
  terms: "Устанавливает наднациональный союз, объединяющий экономические, политические и военные структуры между Россией и Беларусью.",
  ...patch,
});
const treatyOnRecord = (patch = {}) => ({
  id: "ru-ua-friendship-1997", title: "Treaty on Friendship, Cooperation and Partnership", type: "friendship_consultation",
  status: "active", parties: ["Russian Federation", "Ukraine"], startedDate: "1997-05-31",
  terms: "Strategic partnership; each recognises the other's borders.", sourceEventIds: [],
  ...patch,
});
const worldOf2014 = (agreements = [treatyOnRecord()]) => ({
  ...makeWorld(["Russian Federation", "Ukraine", "Republic of Belarus", "Poland"]),
  agreements,
});
const compile2014 = (facts, options = {}) => compile(facts, { startDate: "2014-03-22", ...options });
const RETITLED_AGREEMENT = "Round-Zero agreement identity is ambiguous: the same roles/type/date already exist under a different canonical title.";

test("the log's treaty, restated in Russian, is read as the treaty on record, and the answer is not refused", () => {
  // Compiled as on a first attempt: nothing is sent back, so no second request.
  const result = compile2014([friendshipFact(), unionStateFact()], { world: worldOf2014() });
  assert.equal(result.ok, true, result.error);
  const [treaty, union] = result.receipt.facts;
  assert.deepEqual([treaty.ref, treaty.outcome, treaty.canonicalId], ["f1", "merged", "ru-ua-friendship-1997"]);
  assert.deepEqual(result.receipt.restated, [{
    ref: "f1", kind: "agreement", canonicalId: "ru-ua-friendship-1997",
    title: TREATY_IN_RUSSIAN, canonicalTitle: "Treaty on Friendship, Cooperation and Partnership",
  }]);

  // The record keeps its own words, and there is still one of it.
  const friendship = result.projectedWorld.agreements.filter((entry) => entry.type === "friendship_consultation");
  assert.equal(friendship.length, 1);
  assert.deepEqual(
    [friendship[0].id, friendship[0].title, friendship[0].terms, friendship[0].startedDate],
    ["ru-ua-friendship-1997", "Treaty on Friendship, Cooperation and Partnership", "Strategic partnership; each recognises the other's borders.", "1997-05-31"],
  );

  // The agreement beside it, which the world did not hold, is still made, under its own title.
  assert.deepEqual([union.ref, union.outcome], ["f2", "applied"]);
  assert.match(union.canonicalId, /^agreement-r0v1-/);
  const made = result.projectedWorld.agreements.find((entry) => entry.id === union.canonicalId);
  assert.deepEqual([made.title, made.type, [...made.parties].sort()], [UNION_STATE_IN_RUSSIAN, "trade_economic", ["Republic of Belarus", "Russian Federation"]]);
  assert.equal(result.projectedWorld.agreements.length, 2);
  assert.deepEqual(result.receipt.omitted, []);
  assert.deepEqual(result.receipt.counts, { candidateFacts: 2, applied: 1, merged: 1, derived: 0, restated: 1, omitted: 0 });
});

test("a restated agreement gives the record what it lacks, and a different known date is another agreement", () => {
  // On record with no date and no terms: the fact's are taken, as they are
  // from a fact under the canonical title, and so is its provenance.
  const bare = compile2014(
    [friendshipFact({ startedDate: "1997-05-31", sourceEventRefs: ["e1"] })],
    { world: worldOf2014([treatyOnRecord({ startedDate: "", terms: "" })]), eventIdsByRef: { e1: "pregame-1" } },
  );
  assert.equal(bare.ok, true, bare.error);
  const [record] = bare.projectedWorld.agreements;
  assert.deepEqual(
    [record.id, record.title, record.startedDate, record.terms, record.sourceEventIds],
    ["ru-ua-friendship-1997", "Treaty on Friendship, Cooperation and Partnership", "1997-05-31", friendshipFact().terms, ["pregame-1"]],
  );

  // A known date that is not the record's is not the record: the fact is an
  // agreement of its own, as it always was.
  const later = compile2014([friendshipFact({ startedDate: "2010-04-21" })], { world: worldOf2014() });
  assert.equal(later.ok, true, later.error);
  assert.deepEqual(later.receipt.restated, []);
  assert.equal(later.receipt.facts[0].outcome, "applied");
  assert.deepEqual(
    later.projectedWorld.agreements.map((entry) => [entry.title, entry.startedDate]).sort(),
    [[TREATY_IN_RUSSIAN, "2010-04-21"], ["Treaty on Friendship, Cooperation and Partnership", "1997-05-31"]].sort(),
  );
});

test("a fact that could be either of two agreements on record is refused, then left out on the last attempt", () => {
  const twoOnRecord = () => worldOf2014([
    treatyOnRecord(),
    treatyOnRecord({ id: "ru-ua-consultations", title: "Agreement on Regular Consultations", startedDate: "", terms: "The foreign ministers meet yearly." }),
  ]);
  const facts = [
    friendshipFact(),
    unionStateFact(),
    { ref: "r1", kind: "relation", a: "Russian Federation", b: "Poland", score: -35, summary: "Напряжённые отношения." },
  ];

  // While a corrective attempt remains: refused, in the words the log has.
  const first = compile2014(facts, { world: twoOnRecord() });
  assert.equal(first.ok, false);
  assert.equal(first.error, `$.facts[0] ${RETITLED_AGREEMENT}`);
  assert.equal(first.projectedWorld, null);

  // On the last attempt: that fact is left out and named; the rest stands.
  const last = compile2014(facts, { world: twoOnRecord(), leaveOutAmbiguous: true });
  assert.equal(last.ok, true, last.error);
  assert.deepEqual(last.receipt.omitted, [{ ref: "f1", kind: "agreement", title: TREATY_IN_RUSSIAN, reason: RETITLED_AGREEMENT }]);
  assert.deepEqual(last.receipt.facts.map((entry) => [entry.ref, entry.outcome]), [["f2", "applied"], ["r1", "applied"]]);
  assert.deepEqual(last.receipt.counts, { candidateFacts: 3, applied: 2, merged: 0, derived: 0, restated: 0, omitted: 1 });
  assert.deepEqual(
    last.projectedWorld.agreements.map((entry) => entry.title).sort(),
    ["Agreement on Regular Consultations", UNION_STATE_IN_RUSSIAN, "Treaty on Friendship, Cooperation and Partnership"].sort(),
  );
  assert.equal(last.projectedWorld.relations.length, 1);

  // A title that is on record twice is the same ambiguity.
  const twins = worldOf2014([treatyOnRecord(), treatyOnRecord({ id: "ru-ua-friendship-copy" })]);
  const named = friendshipFact({ title: "Treaty on Friendship, Cooperation and Partnership" });
  assert.match(compile2014([named], { world: twins }).error, /matches multiple canonical instruments/);
  const without = compile2014([named], { world: twins, leaveOutAmbiguous: true });
  assert.equal(without.ok, true, without.error);
  assert.deepEqual(without.receipt.omitted.map((entry) => entry.ref), ["f1"]);
  assert.equal(without.projectedWorld.agreements.length, 2);
});

test("two facts of one answer that differ only in title are not each other's restatement", () => {
  const pact = (ref, title) => ({
    ref, kind: "agreement", type: "alliance", title, parties: ["Alpha", "Gamma"], startedDate: "2020-01-01", terms: "Standing alliance.",
  });
  const facts = [pact("a1", "Alpha-Gamma Pact"), pact("a2", "Treaty of Mutual Defence")];
  const strict = compile(facts);
  assert.equal(strict.ok, false);
  assert.equal(strict.error, `$.facts[1] ${RETITLED_AGREEMENT}`);
  const last = compile(facts, { leaveOutAmbiguous: true });
  assert.equal(last.ok, true, last.error);
  assert.deepEqual(last.projectedWorld.agreements.map((entry) => entry.title), ["Alpha-Gamma Pact"]);
  assert.deepEqual(last.receipt.omitted.map((entry) => [entry.ref, entry.title]), [["a2", "Treaty of Mutual Defence"]]);

  // Nor does a second fact restate a record the first has just named by its own title.
  const onRecord = compile([pact("a1", "Alpha-Gamma Pact")]).projectedWorld;
  const again = [pact("a3", "Alpha-Gamma Pact"), pact("a4", "Treaty of Mutual Defence")];
  assert.equal(compile(again, { world: onRecord }).error, `$.facts[1] ${RETITLED_AGREEMENT}`);
  const kept = compile(again, { world: onRecord, leaveOutAmbiguous: true });
  assert.equal(kept.ok, true, kept.error);
  assert.deepEqual(kept.receipt.facts.map((entry) => [entry.ref, entry.outcome]), [["a3", "merged"]]);
  assert.deepEqual(kept.receipt.restated, []);
  assert.deepEqual(kept.receipt.omitted.map((entry) => entry.ref), ["a4"]);
});

test("a restated war still has to agree on its status, and two wars on record are still an ambiguity", () => {
  const first = compile([warFact()]);
  assert.equal(first.ok, true, first.error);
  // What is not wording is judged as it is for a fact under the canonical title.
  const ceasefire = [warFact({ ref: "w2", title: "The Northern War", status: "ceasefire" })];
  for (const leaveOutAmbiguous of [false, true]) {
    const result = compile(ceasefire, { world: first.projectedWorld, leaveOutAmbiguous });
    assert.equal(result.ok, false);
    assert.match(result.error, /conflicts on status \(active vs ceasefire\)/);
  }

  const world = makeWorld();
  world.wars = ["Alpha-Beta War", "The Border War"].map((title, index) => ({
    id: `scenario-war-${index + 1}`, title, status: "active", sideA: ["Alpha"], sideB: ["Beta"],
    startedDate: "2020-11-18", sourceEventIds: [], storylineIds: [],
  }));
  const third = [warFact({ ref: "w3", title: "A Third Name For It" })];
  const strict = compile(third, { world });
  assert.equal(strict.ok, false);
  assert.match(strict.error, /^\$\.facts\[0\] Round-Zero war identity is ambiguous: the same live sides\/date already exist under a different canonical title\.$/);
  const last = compile(third, { world, leaveOutAmbiguous: true });
  assert.equal(last.ok, true, last.error);
  assert.deepEqual(last.receipt.omitted.map((entry) => [entry.ref, entry.kind, entry.title]), [["w3", "war", "A Third Name For It"]]);
  assert.deepEqual(last.receipt.facts, []);
  assert.deepEqual(last.receipt.derived, [], "no mirror is made for a war that is not in the baseline");
  assert.deepEqual(last.projectedWorld.wars.map((war) => war.title).sort(), ["Alpha-Beta War", "The Border War"]);
});

test("a storyline under another title is never read as the one on record: refused, then left out", () => {
  const onRecord = {
    id: "scenario-crisis", kind: "crisis", title: "Banking Crisis", participants: ["Alpha"], status: "active",
    pressure: 70, momentum: 20, startedDate: "2020-01-01", state: "Banking stress remains unresolved.",
  };
  const world = () => ({ ...makeWorld(), storylines: [{ ...onRecord }] });
  // One crisis of this country on record, and a fact about another: kind,
  // participants and date do not say they are the same process.
  const facts = [
    {
      ref: "s1", kind: "storyline", processKind: "crisis", status: "active", title: "Industrial Slowdown",
      participants: ["Alpha"], startedDate: "2020-01-01", pressure: 40, momentum: 10, state: "Factories stand idle.",
    },
    { ref: "r1", kind: "relation", a: "Alpha", b: "Gamma", score: 20, summary: "Cordial." },
  ];
  const strict = compile(facts, { world: world() });
  assert.equal(strict.ok, false);
  assert.match(strict.error, /^\$\.facts\[0\] Round-Zero storyline identity is ambiguous/);

  const last = compile(facts, { world: world(), leaveOutAmbiguous: true });
  assert.equal(last.ok, true, last.error);
  assert.deepEqual(last.receipt.restated, []);
  assert.deepEqual(last.receipt.omitted.map((entry) => [entry.ref, entry.kind, entry.title]), [["s1", "storyline", "Industrial Slowdown"]]);
  assert.deepEqual(last.receipt.facts.map((entry) => entry.ref), ["r1"]);
  const crises = last.projectedWorld.storylines.filter((entry) => entry.kind === "crisis");
  assert.deepEqual(crises.map((entry) => [entry.id, entry.title, entry.pressure, entry.state]), [
    ["scenario-crisis", "Banking Crisis", 70, "Banking stress remains unresolved."],
  ]);
});

test("only a fact that could be more than one record is left out: every other refusal still refuses the answer", () => {
  // Canon that does not say which way a grant runs is not an ambiguity of titles.
  const legacy = makeWorld();
  legacy.agreements = [{
    id: "legacy-access", title: "Base Access", type: "military_access", status: "active",
    parties: ["Alpha", "Beta"], startedDate: "2020-01-01", terms: "Legacy record without direction.",
  }];
  const access = compile([{
    ref: "m1", kind: "agreement", type: "military_access", title: "Base Access",
    grantor: "Alpha", grantee: "Beta", startedDate: "2020-01-01", terms: "Alpha grants Beta access.",
  }], { world: legacy, leaveOutAmbiguous: true });
  assert.equal(access.ok, false);
  assert.match(access.error, /does not record grant direction/);

  // Nor are other terms under the canonical title: that fact names the record
  // itself and contradicts it, and is refused on every attempt, as before.
  const sameTitle = compile2014(
    [friendshipFact({ title: "Treaty on Friendship, Cooperation and Partnership" })],
    { world: worldOf2014(), leaveOutAmbiguous: true },
  );
  assert.equal(sameTitle.ok, false);
  assert.match(sameTitle.error, /conflicts on substantive terms/);
});
