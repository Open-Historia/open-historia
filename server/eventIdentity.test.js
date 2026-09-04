import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateCanonicalTurnEventIds,
  duplicateEventIds,
  remapLedgerEventIds,
} from "../src/runtime/eventIdentity.js";

test("new turn event ids are globally round-scoped without rewriting legacy ids", () => {
  const existing = [
    { id: "world-pass-1-event-1", date: "2014-01-01" },
    { id: "world-pass-1-event-1", date: "2014-02-01" },
    { id: "event-ai-r0068-20190515-001", date: "2019-05-15" },
  ];
  const incoming = [
    { id: "world-pass-1-event-1", date: "2019-06-15", title: "A" },
    { id: "world-breadth-repair-event-1", date: "2019-06-20", title: "B" },
  ];

  assert.deepEqual(duplicateEventIds(existing), ["world-pass-1-event-1"]);

  const { events, idMap } = allocateCanonicalTurnEventIds({
    existingEvents: existing,
    newEvents: incoming,
    round: 69,
  });

  assert.deepEqual(events.map((event) => event.id), [
    "event-ai-r0069-20190615-001",
    "event-ai-r0069-20190620-002",
  ]);
  assert.equal(existing[0].id, "world-pass-1-event-1");
  assert.equal(idMap.get("world-pass-1-event-1"), "event-ai-r0069-20190615-001");
});

test("ledger eventIds follow canonical event-id remapping", () => {
  const idMap = new Map([
    ["world-pass-1-event-1", "event-ai-r0069-20190615-001"],
  ]);
  const [update] = remapLedgerEventIds([
    { id: "war-test", eventIds: ["world-pass-1-event-1", "older-stable-id"] },
  ], idMap);

  assert.deepEqual(update.eventIds, [
    "event-ai-r0069-20190615-001",
    "older-stable-id",
  ]);
});
