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

test("native pregame directive teaches the shallow transport field names", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /PROVIDER TRANSPORT[\s\S]*eventsJson[\s\S]*canonicalUpdatesJson/);
  assert.match(source, /Do not return events or canonicalUpdates as direct top-level tool fields/);
});
