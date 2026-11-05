/*! Open Historia — the events a map card names: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Selection/eventLookup.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { clearEventLookup, resolveEventsById } from "./eventLookup.js";

const log = [
  { id: "e1", date: "1805-10-21", title: "Victory at Trafalgar", description: "A long description the cards never show." },
  { id: "e2", date: "1806-01-01", title: "The dockyard is enlarged" },
];

const counting = (events) => {
  const reader = async () => {
    reader.reads += 1;
    return events;
  };
  reader.reads = 0;
  return reader;
};

test("the log is read once for ids not in hand, and only what the cards show is kept", async () => {
  clearEventLookup();
  const readEvents = counting(log);
  const found = await resolveEventsById(["e2", "e1"], { readEvents });
  assert.deepEqual(found, [
    { id: "e2", title: "The dockyard is enlarged", date: "1806-01-01" },
    { id: "e1", title: "Victory at Trafalgar", date: "1805-10-21" },
  ]);
  await resolveEventsById(["e1"], { readEvents });
  assert.equal(readEvents.reads, 1, "an id in hand costs no read");
});

test("an id the log does not hold costs one read, not one per selection", async () => {
  clearEventLookup();
  const readEvents = counting(log);
  assert.deepEqual(await resolveEventsById(["gone"], { readEvents }), [null]);
  assert.deepEqual(await resolveEventsById(["gone"], { readEvents }), [null]);
  assert.equal(readEvents.reads, 1);
});

test("a failed read records nothing, so the next selection tries again", async () => {
  clearEventLookup();
  await assert.rejects(resolveEventsById(["e1"], { readEvents: async () => { throw new Error("offline"); } }));
  const readEvents = counting(log);
  assert.equal((await resolveEventsById(["e1"], { readEvents }))[0].title, "Victory at Trafalgar");
  assert.equal(readEvents.reads, 1);
});

test("no ids, no read", async () => {
  clearEventLookup();
  const readEvents = counting(log);
  assert.deepEqual(await resolveEventsById([], { readEvents }), []);
  assert.deepEqual(await resolveEventsById(["", null], { readEvents }), []);
  assert.equal(readEvents.reads, 0);
});
