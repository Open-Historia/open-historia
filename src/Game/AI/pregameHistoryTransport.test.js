import test from "node:test";
import assert from "node:assert/strict";
import {
  GAMEPLAY_TOOLS,
  decodePregameHistoryTransportPayload,
  normalizeGameplayPayload,
  validateGameplayPayload,
} from "./gameplaySchemas.js";

test("pregame history uses a shallow provider transport while native validation stays structured", () => {
  const transport = GAMEPLAY_TOOLS.pregameHistory.schema;
  assert.equal(transport.properties.eventsJson.type, "string");
  assert.equal(transport.properties.canonicalUpdatesJson.type, "string");
  assert.equal(transport.properties.events, undefined);
  assert.equal(transport.properties.canonicalUpdates, undefined);

  const decoded = decodePregameHistoryTransportPayload({
    eventsJson: JSON.stringify([{ date: "1911-01-01", title: "Alliance tested", description: "A concrete pre-game event establishes the setting." }]),
    summary: "The pre-game balance takes shape.",
    canonicalUpdatesJson: JSON.stringify([{
      kind: "relation", id: "", polities: ["A", "B"], opponents: [], score: 50,
      pressure: 0, momentum: 0, date: "", category: "", title: "", detail: "Friendly relations.",
    }]),
  });
  assert.equal(decoded.error, "");
  assert.equal(validateGameplayPayload("pregameHistory", decoded.payload).valid, true);
});

test("pregame normalization recovers only a bare standing agreement discriminator", () => {
  const transport = (kind) => ({
    eventsJson: JSON.stringify([{
      date: "2004-03-29",
      title: "Latvia enters NATO",
      description: "Latvia joins the North Atlantic Treaty before the campaign begins.",
    }]),
    summary: "Latvia enters the campaign with an existing collective-defense commitment.",
    canonicalUpdatesJson: JSON.stringify([{
      kind,
      id: "agreement-nato-latvia-usa",
      polities: ["Republic of Latvia", "United States of America"],
      opponents: [],
      score: 0,
      pressure: 0,
      momentum: 0,
      date: "2004-03-29",
      category: "mutual_defense",
      title: "North Atlantic Treaty Organization (NATO) Alliance",
      detail: "Mutual defense commitments and collective security guarantees under the North Atlantic Treaty Organization.",
    }]),
  });

  const decodedBare = decodePregameHistoryTransportPayload(transport("agreement"));
  assert.equal(decodedBare.error, "");
  assert.equal(decodedBare.payload.canonicalUpdates[0].kind, "agreement");

  const normalizedBare = normalizeGameplayPayload("pregameHistory", decodedBare.payload);
  assert.equal(normalizedBare.canonicalUpdates[0].kind, "agreement:start");
  assert.equal(validateGameplayPayload("pregameHistory", normalizedBare).valid, true);

  const decodedExplicitEnd = decodePregameHistoryTransportPayload(transport("agreement:end"));
  const normalizedExplicitEnd = normalizeGameplayPayload("pregameHistory", decodedExplicitEnd.payload);
  assert.equal(
    normalizedExplicitEnd.canonicalUpdates[0].kind,
    "agreement:end",
    "explicit invalid lifecycle operations must remain visible to the strict Round-Zero validator",
  );
});


test("Round-Zero fills only semantically irrelevant flat-envelope padding", () => {
  const decoded = decodePregameHistoryTransportPayload({
    eventsJson: JSON.stringify([{
      date: "2020-11-18",
      title: "Washington D.C. Clashes and Military Fracture",
      description: "Federal command fractures as the civil war deepens before the campaign start.",
    }]),
    summary: "The United States enters Round One in civil war.",
    canonicalUpdatesJson: JSON.stringify([
      {
        kind: "war:start",
        id: "war-us-civil-war-acg",
        polities: ["Union of America"],
        opponents: ["American Constitutional Government"],
        date: "2020-11-18",
        detail: "The conflict remains active at Round One.",
      },
      {
        kind: "storyline:active",
        id: "storyline-second-american-civil-war",
        polities: ["Union of America", "American Constitutional Government"],
        pressure: 95,
        momentum: 60,
        date: "2020-11-03",
        category: "crisis",
        title: "The Second American Civil War",
        detail: "Federal authority remains fractured and the conflict unresolved.",
      },
    ]),
  });
  assert.equal(decoded.error, "");
  const normalized = normalizeGameplayPayload("pregameHistory", decoded.payload);
  assert.deepEqual(
    {
      score: normalized.canonicalUpdates[0].score,
      pressure: normalized.canonicalUpdates[0].pressure,
      momentum: normalized.canonicalUpdates[0].momentum,
      category: normalized.canonicalUpdates[0].category,
      title: normalized.canonicalUpdates[0].title,
    },
    { score: 0, pressure: 0, momentum: 0, category: "", title: "" },
  );
  assert.deepEqual(normalized.canonicalUpdates[1].opponents, []);
  assert.equal(normalized.canonicalUpdates[1].score, 0);
  assert.equal(validateGameplayPayload("pregameHistory", normalized).valid, true);
});

test("Round-Zero never invents semantic canonical fields just to satisfy the flat envelope", () => {
  const base = {
    events: [{ date: "2020-11-18", title: "Civil war", description: "The conflict is active." }],
    summary: "A fractured country enters Round One.",
  };

  const missingWarOpponent = normalizeGameplayPayload("pregameHistory", {
    ...base,
    canonicalUpdates: [{
      kind: "war:start", id: "war-us-civil-war-acg", polities: ["Union of America"],
      date: "2020-11-18", detail: "Active conflict.",
    }],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(missingWarOpponent.canonicalUpdates[0], "opponents"), false);
  assert.match(validateGameplayPayload("pregameHistory", missingWarOpponent).error, /opponents is required/);

  const missingRelationScore = normalizeGameplayPayload("pregameHistory", {
    ...base,
    canonicalUpdates: [{ kind: "relation", polities: ["A", "B"], detail: "Hostile relations." }],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(missingRelationScore.canonicalUpdates[0], "score"), false);
  assert.match(validateGameplayPayload("pregameHistory", missingRelationScore).error, /score is required/);

  const missingStorylinePressure = normalizeGameplayPayload("pregameHistory", {
    ...base,
    canonicalUpdates: [{
      kind: "storyline:active", id: "storyline-crisis", polities: ["A", "B"], momentum: 40,
      category: "crisis", title: "Crisis", detail: "Still unresolved.",
    }],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(missingStorylinePressure.canonicalUpdates[0], "pressure"), false);
  assert.match(validateGameplayPayload("pregameHistory", missingStorylinePressure).error, /pressure is required/);
});

test("Round-Zero rejects unknown canonical kinds instead of silently dropping them during expansion", () => {
  const candidate = normalizeGameplayPayload("pregameHistory", {
    events: [{ date: "2020-11-18", title: "Crisis", description: "The crisis is active." }],
    summary: "A crisis shapes the opening world.",
    canonicalUpdates: [{
      kind: "mystery:active", id: "mystery", polities: ["A"], opponents: [], score: 0,
      pressure: 0, momentum: 0, date: "", category: "", title: "", detail: "",
    }],
  });
  const verdict = validateGameplayPayload("pregameHistory", candidate);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /canonicalUpdates\[0\]\.kind/);
});

test("pregame transport fails closed on malformed nested JSON", () => {
  const decoded = decodePregameHistoryTransportPayload({
    eventsJson: "not json",
    summary: "x",
    canonicalUpdatesJson: "[]",
  });
  assert.equal(decoded.payload, null);
  assert.match(decoded.error, /eventsJson must contain valid JSON array text/);
});

test("canonicalUpdates is required by the internal pregame contract", () => {
  const validation = validateGameplayPayload("pregameHistory", {
    events: [{ date: "1911-01-01", title: "x", description: "y" }],
    summary: "z",
  });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /canonicalUpdates/);
});

test("pregame schema treats war linkage as optional provenance and accepts a war transition date", () => {
  const internal = validateGameplayPayload("pregameHistory", {
    events: [{ date: "2021-01-01", title: "Federal crisis deepens", description: "The historical record does not duplicate an opaque war id." }],
    summary: "The conflict is already active when play begins.",
    canonicalUpdates: [{
      kind: "war:start",
      id: "sec-us-civil-war-apla",
      polities: ["Union of America"],
      opponents: ["American People's Liberation Army"],
      score: 0,
      pressure: 0,
      momentum: 0,
      date: "2021-04-10",
      category: "",
      title: "",
      detail: "The war remains active at Round One.",
    }],
  });
  assert.equal(internal.valid, true);
});

test("native pregame directive teaches the shallow transport field names", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /PROVIDER TRANSPORT[\s\S]*eventsJson[\s\S]*canonicalUpdatesJson/);
  assert.match(source, /Do not return events or canonicalUpdates as direct top-level tool fields/);
  assert.match(source, /canonical war does NOT require a filler event solely for linkage/);
  assert.match(source, /validatePregameWarBootstrap\(\{/);
  assert.match(source, /protectedPathPrefixes: taskKey === "pregameHistory" \? \["\$\.canonicalUpdates"\] : \[\]/);
  assert.match(source, /updates: warUpdates,\s*events: bootstrapEvents,[\s\S]{0,220}stopDate: ""/);
  assert.doesNotMatch(source, /must link to a real pre-game event/);
});
