/*! Open Historia — ledger records follow the events that caused them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/ledgerEventBinding.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { filterBoundLedgerUpdatesToKeptEvents } from "./ledgerEventBinding.js";

// A month segment routinely has ten to fifteen events, so ids 1 and 12 share a
// prefix. The old substring search kept a record bound to a dropped event 12
// because the kept event 1's id is a substring of it.
const events = Array.from({ length: 12 }, (_, index) => ({ id: `segment-1-event-${index + 1}` }));
const kept = events.filter((event) => event.id !== "segment-1-event-12");

test("a record bound only to a dropped event goes with it, even when a kept id is a prefix of it", () => {
  const war = { id: "war-1", op: "start", eventIds: ["segment-1-event-12"] };
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([war], events, kept), []);
});

test("a record bound to a kept event stays", () => {
  const relation = { id: "relation-1", eventIds: ["segment-1-event-1"] };
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([relation], events, kept), [relation]);
});

test("a record bound to a kept and a dropped event stays", () => {
  const agreement = { id: "agreement-1", eventIds: ["segment-1-event-12", "segment-1-event-3"] };
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([agreement], events, kept), [agreement]);
});

test("a record bound to no event of this round is a baseline row and stays", () => {
  const baseline = { id: "relation-2", eventIds: [], summary: "Relations remain cool." };
  const older = { id: "relation-3", eventIds: ["event-ai-r0003-19140801-001"] };
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([baseline, older], events, kept), [baseline, older]);
});

test("ids in eventId and in nested entries count as references too", () => {
  const single = { id: "puppet-1", eventId: "segment-1-event-12" };
  const nested = { id: "storyline-1", beats: [{ sourceEventIds: ["segment-1-event-12"] }] };
  const nestedKept = { id: "storyline-2", beats: [{ sourceEventIds: ["segment-1-event-2"] }] };
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([single, nested, nestedKept], events, kept), [nestedKept]);
});

test("prose that merely mentions an id is not a binding", () => {
  const mention = { id: "war-2", eventIds: [], summary: "see segment-1-event-12" };
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([mention], events, kept), [mention]);
});

test("anything that is not a list is treated as empty", () => {
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents(null, events, kept), []);
  assert.deepEqual(filterBoundLedgerUpdatesToKeptEvents([{ id: "x", eventIds: ["segment-1-event-1"] }], null, null), [{ id: "x", eventIds: ["segment-1-event-1"] }]);
});
