import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GAMEPLAY_TOOLS,
  decodePregameHistoryTransportPayload,
  mergePregameHistoryTransportSections,
  extractPregameHistoryStableRetrySections,
  normalizeGameplayPayload,
  validateGameplayPayload,
} from "./gameplaySchemas.js";
import {
  PREGAME_BOOTSTRAP_CONTRACT_VERSION,
  compilePregameBootstrapCandidate,
} from "./pregameBootstrapCompiler.js";

const event = (overrides = {}) => ({
  ref: "e1",
  date: "2020-11-18",
  title: "Federal fracture",
  description: "Federal command fractures before the campaign begins.",
  ...overrides,
});

const warFact = (overrides = {}) => ({
  ref: "f1",
  kind: "war",
  title: "The Constitutional War",
  status: "active",
  sideA: ["Alpha"],
  sideB: ["Beta"],
  startedDate: "2020-11-18",
  note: "Open conflict remains active on Day One.",
  sourceEventRefs: ["e1"],
  ...overrides,
});

const world = () => ({
  polityOverrides: {
    Alpha: { displayName: "Alpha", status: "active" },
    Beta: { displayName: "Beta", status: "active" },
    Gamma: { displayName: "Gamma", status: "active" },
  },
  wars: [],
  relations: [],
  agreements: [],
  puppets: [],
  storylines: [],
});

test("pregame history keeps the shallow provider transport but carries semantic baseline facts", () => {
  const transport = GAMEPLAY_TOOLS.pregameHistory.schema;
  assert.equal(transport.properties.eventsJson.type, "string");
  assert.equal(transport.properties.canonicalUpdatesJson.type, "string");
  assert.equal(transport.properties.events, undefined);
  assert.equal(transport.properties.canonicalUpdates, undefined);

  const decoded = decodePregameHistoryTransportPayload({
    eventsJson: JSON.stringify([event()]),
    summary: "The opening balance takes shape.",
    canonicalUpdatesJson: JSON.stringify([warFact()]),
  });
  assert.equal(decoded.error, "");
  assert.equal(validateGameplayPayload("pregameHistory", decoded.payload).valid, true);
  assert.equal(decoded.payload.canonicalUpdates[0].kind, "war");
  assert.equal(Object.prototype.hasOwnProperty.call(decoded.payload.canonicalUpdates[0], "id"), false);
});

test("legacy lifecycle-shaped Round-Zero facts are rejected instead of silently adapted", () => {
  const candidate = normalizeGameplayPayload("pregameHistory", {
    events: [event()],
    summary: "Legacy answer.",
    canonicalUpdates: [{
      ref: "f1",
      kind: "war:start",
      id: "war-model-owned",
      polities: ["Alpha"],
      opponents: ["Beta"],
    }],
  });
  const verdict = validateGameplayPayload("pregameHistory", candidate);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /canonicalUpdates\[0\]\.kind|must be one of/);
  assert.equal(candidate.canonicalUpdates[0].kind, "war:start");
  assert.equal(candidate.canonicalUpdates[0].id, "war-model-owned");
});

test("semantic provider contract rejects model-owned persistent bookkeeping fields", () => {
  const candidate = {
    events: [event()],
    summary: "Bad bookkeeping.",
    canonicalUpdates: [{ ...warFact(), id: "war-model-owned" }],
  };
  const verdict = validateGameplayPayload("pregameHistory", candidate);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /additional property.*id|id.*not allowed/i);
});

test("pregame transport fails closed without erasing independently valid sibling sections", () => {
  const facts = [warFact({ sourceEventRefs: [] })];
  const decoded = decodePregameHistoryTransportPayload({
    eventsJson: "not json",
    summary: "x",
    canonicalUpdatesJson: JSON.stringify(facts),
  });
  assert.match(decoded.error, /eventsJson must contain valid JSON array text/);
  assert.equal(decoded.payload.events, null);
  assert.deepEqual(decoded.payload.canonicalUpdates, facts);
  assert.deepEqual(decoded.validSections.canonicalUpdates, facts);
  assert.equal(decoded.validSections.summary, "x");
  assert.equal(Object.prototype.hasOwnProperty.call(decoded.validSections, "events"), false);
});

test("pregame transport distinguishes a missing canonical section from explicit empty state", () => {
  const eventText = JSON.stringify([event()]);
  const missing = decodePregameHistoryTransportPayload({ eventsJson: eventText, summary: "x" });
  assert.match(missing.error, /canonicalUpdatesJson is required/);
  assert.equal(missing.payload.canonicalUpdates, null);
  assert.equal(missing.validSections.events.length, 1);

  const blank = decodePregameHistoryTransportPayload({ eventsJson: eventText, summary: "x", canonicalUpdatesJson: "   " });
  assert.match(blank.error, /blank is not the same as \[\]/);

  const explicitEmpty = decodePregameHistoryTransportPayload({ eventsJson: eventText, summary: "x", canonicalUpdatesJson: "[]" });
  assert.equal(explicitEmpty.error, "");
  assert.deepEqual(explicitEmpty.payload.canonicalUpdates, []);
});

test("pregame semantic normalization accepts lossless singleton list spellings", () => {
  const candidate = normalizeGameplayPayload("pregameHistory", {
    events: [event()],
    summary: "Singleton spellings are normalized before schema validation.",
    canonicalUpdates: [{
      ...warFact({ sourceEventRefs: "e1" }),
      sideA: "Alpha",
      sideB: "Beta",
    }],
  });

  assert.deepEqual(candidate.canonicalUpdates[0].sideA, ["Alpha"]);
  assert.deepEqual(candidate.canonicalUpdates[0].sideB, ["Beta"]);
  assert.deepEqual(candidate.canonicalUpdates[0].sourceEventRefs, ["e1"]);
  assert.equal(validateGameplayPayload("pregameHistory", candidate).valid, true);
});

test("pregame transport recovers one extra corrective quote-escaping layer without changing semantics", () => {
  const escaped = (value) => JSON.stringify(value).replace(/"/g, '\\"');
  const decoded = decodePregameHistoryTransportPayload({
    eventsJson: escaped([event()]),
    summary: "Corrective retry preserved meaning.",
    canonicalUpdatesJson: escaped([warFact()]),
  });

  assert.equal(decoded.error, "");
  assert.deepEqual(decoded.payload.events, [event()]);
  assert.deepEqual(decoded.payload.canonicalUpdates, [warFact()]);
  assert.equal(validateGameplayPayload("pregameHistory", decoded.payload).valid, true);
});

test("pregame schema correction freezes validated event refs but not invalid canonical facts", () => {
  const candidate = {
    events: [event({ ref: "stable-e1" })],
    summary: "The historical interpretation is already valid.",
    canonicalUpdates: [{
      ref: "bad-fact",
      type: "war",
      title: "Missing discriminator",
      status: "active",
      sideA: ["Alpha"],
      sideB: ["Beta"],
    }],
  };
  const verdict = validateGameplayPayload("pregameHistory", candidate);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /kind is required/);

  const stable = extractPregameHistoryStableRetrySections(candidate);
  assert.equal(stable.events.length, 1);
  assert.equal(stable.events[0].ref, "stable-e1");
  assert.equal(stable.summary, "The historical interpretation is already valid.");
  assert.equal(Object.prototype.hasOwnProperty.call(stable, "canonicalUpdates"), false);

  const transportStable = extractPregameHistoryStableRetrySections({
    events: [event()],
    summary: "Stable.",
    canonicalUpdates: [warFact({ sourceEventRefs: [] })],
  }, { includeCanonical: true });
  assert.equal(transportStable.canonicalUpdates.length, 1);
});

test("pregame corrective merge preserves nested candidate-local reference arrays by value", () => {
  const preserved = {
    summary: "Original interpretation.",
    canonicalUpdates: [warFact({ sourceEventRefs: ["e1", "e2"] })],
  };
  const retry = {
    events: [event({ ref: "e2" })],
    summary: "Regenerated interpretation.",
    canonicalUpdates: [warFact({ ref: "f2", sourceEventRefs: [] })],
  };
  const merged = mergePregameHistoryTransportSections(retry, preserved);
  assert.equal(merged.summary, "Original interpretation.");
  assert.deepEqual(merged.canonicalUpdates[0].sourceEventRefs, ["e1", "e2"]);
  assert.notEqual(merged.canonicalUpdates[0], preserved.canonicalUpdates[0]);
  assert.notEqual(merged.canonicalUpdates[0].sourceEventRefs, preserved.canonicalUpdates[0].sourceEventRefs);
});

test("canonicalUpdates remains required by the internal semantic pregame contract", () => {
  const validation = validateGameplayPayload("pregameHistory", {
    events: [event()],
    summary: "z",
  });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /canonicalUpdates/);
});

test("candidate-local event provenance compiles to native persisted ids", () => {
  const payload = {
    events: [event()],
    summary: "The conflict is already active.",
    canonicalUpdates: [warFact()],
  };
  assert.equal(validateGameplayPayload("pregameHistory", payload).valid, true);

  const compiled = compilePregameBootstrapCandidate({
    candidate: {
      contractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION,
      facts: payload.canonicalUpdates,
    },
    world: world(),
    eventIdsByRef: new Map([["e1", "pregame-1"]]),
    startDate: "2021-07-18",
    round: 1,
  });
  assert.equal(compiled.ok, true, compiled.error);
  assert.equal(compiled.projectedWorld.wars.length, 1);
  assert.deepEqual(compiled.projectedWorld.wars[0].sourceEventIds, ["pregame-1"]);
  assert.equal(compiled.projectedWorld.wars[0].id.startsWith("war-r0v1-"), true);
  assert.equal(compiled.receipt.derived.length, 1, "native compiler must create the war scheduler mirror");
});

test("pregame event ref is mandatory because canonical provenance binds through it", () => {
  const payload = {
    events: [{ date: "2020-11-18", title: "No ref", description: "Invalid candidate event." }],
    summary: "x",
    canonicalUpdates: [],
  };
  const verdict = validateGameplayPayload("pregameHistory", payload);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /events\[0\]\.ref is required/);
});

test("native pregame directive and publication path use the semantic compiler, not lifecycle replay", async () => {
  const source = await readFile(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /Round-Zero World Bootstrap Contract v1/);
  assert.match(source, /eventsJson[\s\S]*canonicalUpdatesJson/);
  assert.match(source, /NEVER invent or output persistent war\/agreement\/storyline ids/);
  assert.match(source, /kind="war"[\s\S]*status=active\|ceasefire/);
  assert.match(source, /compilePregameBootstrapCandidate\(\{/);
  assert.match(source, /candidate: buildPregameSemanticCandidate\(payload\)/);
  assert.match(source, /world: currentWorld/);
  assert.match(source, /eventIdsByRef: eventRefs\.map/);
  assert.match(source, /pregameBootstrapContractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION/);
  assert.match(source, /mutateCanonicalTurnState\(\(current\) =>/);
  assert.match(source, /protectedPathPrefixes: taskKey === "pregameHistory" \? \["\$\.canonicalUpdates"\] : \[\]/);

  const start = source.indexOf("export const maybeGeneratePregameHistory");
  const end = source.indexOf("// ---- Idle diplomacy drip", start);
  const pregamePath = source.slice(start, end);
  assert.doesNotMatch(pregamePath, /applyWarUpdates\(/);
  assert.doesNotMatch(pregamePath, /applyDiplomaticUpdates\(/);
  assert.doesNotMatch(pregamePath, /applyWorldStorylineUpdates\(/);
  assert.doesNotMatch(pregamePath, /bindWarUpdatesToEvents\(/);
  assert.doesNotMatch(pregamePath, /ensurePregameWarStorylineMirrors/);
  assert.doesNotMatch(source, /expandCanonicalUpdateEnvelope/);
});

test("schema-invalid semantic retry cannot replace independently validated historical events", () => {
  const first = {
    events: [
      event({ ref: "e1", date: "2020-03-09", title: "Market crash", description: "A valid first-attempt event." }),
      event({ ref: "e2", date: "2020-11-03", title: "Contested election", description: "Another valid first-attempt event." }),
    ],
    summary: "Stable first interpretation.",
    canonicalUpdates: [{
      ref: "f1",
      type: "war",
      title: "Invalid discriminator",
      status: "active",
      sideA: ["Alpha"],
      sideB: ["Beta"],
    }],
  };
  const verdict = validateGameplayPayload("pregameHistory", first);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /kind is required/);

  const frozen = extractPregameHistoryStableRetrySections(first);
  assert.deepEqual(frozen.events, first.events);
  assert.equal(frozen.summary, first.summary);
  assert.equal(Object.prototype.hasOwnProperty.call(frozen, "canonicalUpdates"), false);

  const retry = {
    events: [event({ ref: "e9", date: "2020-06-15", title: "Regenerated history" })],
    summary: "A different interpretation.",
    canonicalUpdates: [{ ref: "r1", kind: "relation", a: "Alpha", b: "Beta", score: 25, summary: "Corrected canon." }],
  };
  const corrected = mergePregameHistoryTransportSections(retry, frozen);
  assert.deepEqual(corrected.events, first.events);
  assert.equal(corrected.summary, first.summary);
  assert.equal(corrected.canonicalUpdates[0].kind, "relation");
  assert.equal(validateGameplayPayload("pregameHistory", corrected).valid, true);
});
