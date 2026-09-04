// Run: node --test server/gameplaySchemas.test.js
//
// Runs without node_modules: gameplaySchemas.js is import-free apart from the
// event-tag vocabulary.
//
// normalizeGameplayPayload (ported from the abdulrahman-2005 fork) accepts the
// shapes lenient local models actually return for a jump — an envelope around
// the result, a singular event, snake_case or synonym keys, doubled impacts
// wrappers, marker builds written flat — and rewrites them to the canonical
// shape BEFORE schema validation, without ever inventing content.
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGameplayPayload,
  validateGameplayPayload,
} from "../src/Game/AI/gameplaySchemas.js";

const event = (overrides = {}) => ({
  date: "1939-09-02",
  title: "The front moves",
  description: "Forces establish a new position.",
  impacts: {
    actionIds: [],
    createdChats: [],
    markerOps: [],
    polityChanges: [],
    regionTransfers: [],
    unitOps: [],
  },
  ...overrides,
});

const jump = (overrides = {}) => ({
  clearActions: true,
  events: [event()],
  stopDate: "1939-09-03",
  summary: "The strategic situation changes.",
  ...overrides,
});

test("normalizes a wrapped jump result without inventing content", () => {
  const normalized = normalizeGameplayPayload("jumpForward", {
    result: jump(),
  });

  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.stopDate, "1939-09-03");
  assert.deepEqual(validateGameplayPayload("jumpForward", normalized), {
    valid: true,
    error: "",
  });
});

test("normalizes a singular event and common envelope aliases", () => {
  const normalized = normalizeGameplayPayload("jumpForward", {
    actionsResolved: true,
    event: event({ headline: undefined, occurredAt: undefined }),
    overview: "The strategic situation changes.",
    stop_date: "1939-09-03",
  });

  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.summary, "The strategic situation changes.");
  assert.equal(normalized.clearActions, true);
  assert.deepEqual(validateGameplayPayload("jumpForward", normalized), {
    valid: true,
    error: "",
  });
});

test("event field synonyms and impact aliases map to the canonical names", () => {
  const normalized = normalizeGameplayPayload("autoJumpForward", jump({
    events: [{
      occurredAt: "1939-09-02",
      headline: "Border town falls",
      details: "The garrison withdraws overnight.",
      effects: {
        transfers: [{ regionId: "r1", fromCode: "Poland", toCode: "Germany" }],
        controlOps: [{ op: "control", regionId: "r2", fromCode: "Poland", toCode: "Germany" }],
        chats: [],
      },
    }],
  }));
  const [first] = normalized.events;
  assert.equal(first.date, "1939-09-02");
  assert.equal(first.title, "Border town falls");
  assert.equal(first.description, "The garrison withdraws overnight.");
  assert.equal(first.impacts.regionTransfers.length, 1);
  assert.equal(first.impacts.regionControlOps.length, 1);
  assert.deepEqual(first.impacts.createdChats, []);
  assert.equal(Object.hasOwn(first, "effects"), false);
  assert.equal(Object.hasOwn(first.impacts, "transfers"), false);
});

test("normalizes marker build aliases and removes unsupported location hints", () => {
  const normalized = normalizeGameplayPayload("jumpForward", jump({
    events: [event({
      impacts: {
        markerOps: [{
          op: "create",
          marker: {
            latitude: "48.8566",
            longitude: "2.3522",
            name: "Forward headquarters",
            owner: "France",
            regionId: "Ile-de-France",
            type: "military base",
          },
        }],
      },
    })],
  }));

  const markerOp = normalized.events[0].impacts.markerOps[0];
  assert.deepEqual(markerOp, {
    op: "build",
    marker: {
      name: "Forward headquarters",
      kind: "military base",
      ownerCode: "France",
      lng: 2.3522,
      lat: 48.8566,
    },
  });
  assert.deepEqual(validateGameplayPayload("jumpForward", normalized), {
    valid: true,
    error: "",
  });
});

test("flattens duplicated impacts wrappers and preserves operations", () => {
  const normalized = normalizeGameplayPayload("jumpForward", jump({
    events: [event({
      impacts: {
        actionIds: ["player-order-1"],
        impacts: {
          markerOps: [{
            op: "build",
            marker: {
              kind: "port",
              lat: 51.5,
              lng: -0.1,
              name: "River supply port",
              ownerCode: "United Kingdom",
            },
          }],
          regionTransfers: [],
        },
      },
    })],
  }));

  assert.equal(Object.hasOwn(normalized.events[0].impacts, "impacts"), false);
  assert.deepEqual(normalized.events[0].impacts.actionIds, ["player-order-1"]);
  assert.equal(normalized.events[0].impacts.markerOps[0].marker.name, "River supply port");
  assert.deepEqual(validateGameplayPayload("jumpForward", normalized), {
    valid: true,
    error: "",
  });
});

test("does not fabricate events when the model omitted them, and leaves other tasks alone", () => {
  const normalized = normalizeGameplayPayload("jumpForward", {
    clearActions: true,
    stopDate: "1939-09-03",
    summary: "The strategic situation changes.",
  });
  const validation = validateGameplayPayload("jumpForward", normalized);

  assert.equal(Object.hasOwn(normalized, "events"), false);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /events/i);

  const untouched = { result: { speaker: "France" } };
  assert.equal(normalizeGameplayPayload("nextSpeaker", untouched), untouched);
  assert.equal(normalizeGameplayPayload("jumpForward", null), null);
});
