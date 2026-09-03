/*! Open Historia — turn event assembly tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/turnEvents.test.js
//
// The bug these guard against left no trace: espionage events were built, the
// world was updated to match, and the events were dropped on the floor because
// the lists that carry them had already been copied. Nothing failed, nothing
// logged — the timeline was simply silent about a rolled-up spy ring.

import test from "node:test";
import assert from "node:assert/strict";
import { buildTurnEvents } from "./turnEvents.js";

const prior = (id) => ({ id, title: `prior ${id}`, description: "", date: "1911-01-01" });
const fresh = (id) => ({ id, title: `fresh ${id}`, description: "", date: "1911-06-01" });
const espionage = (title) => ({ date: "1911-06-02", kind: "world", source: "espionage", title, description: "d" });

test("espionage events reach the persisted log", () => {
  const { nextEvents } = buildTurnEvents({
    priorEvents: [prior("p1")],
    freshEvents: [fresh("f1")],
    espionageEvents: [espionage("Spy ring rolled up in Germany")],
    round: 4,
  });

  assert.equal(nextEvents.length, 3, "prior + fresh + espionage");
  assert.ok(
    nextEvents.some((event) => event.title === "Spy ring rolled up in Germany"),
    "the exposure is in the list that gets written",
  );
});

test("espionage events reach the turn's own record", () => {
  const { eventIds, turnEvents } = buildTurnEvents({
    priorEvents: [prior("p1")],
    freshEvents: [fresh("f1"), fresh("f2")],
    espionageEvents: [espionage("Doubts about the agent in Germany")],
    round: 4,
  });

  // time.jsx renders a turn by looking each id up in the event log, so an id
  // missing here means the event exists but never appears in that turn.
  assert.deepEqual(eventIds, turnEvents.map((event) => event.id));
  assert.equal(eventIds.length, 3);
  assert.ok(eventIds.some((id) => id.startsWith("espionage-4-")), "the espionage id is recorded");
});

test("prior events stay first and keep their order", () => {
  const { nextEvents } = buildTurnEvents({
    priorEvents: [prior("p1"), prior("p2")],
    freshEvents: [fresh("f1")],
    espionageEvents: [espionage("Counter-intelligence uncovers a Germany agent")],
    round: 2,
  });

  assert.deepEqual(nextEvents.slice(0, 2).map((event) => event.id), ["p1", "p2"]);
  assert.equal(nextEvents[2].id, "f1");
});

test("a turn with no espionage is exactly prior + fresh", () => {
  const { nextEvents, turnEvents, eventIds } = buildTurnEvents({
    priorEvents: [prior("p1")],
    freshEvents: [fresh("f1"), fresh("f2")],
    espionageEvents: [],
    round: 7,
  });

  assert.deepEqual(nextEvents.map((event) => event.id), ["p1", "f1", "f2"]);
  assert.deepEqual(turnEvents.map((event) => event.id), ["f1", "f2"]);
  assert.deepEqual(eventIds, ["f1", "f2"]);
});

test("several agents resolving in one round get distinct ids", () => {
  const { eventIds } = buildTurnEvents({
    freshEvents: [fresh("f1")],
    espionageEvents: [espionage("one"), espionage("two"), espionage("three")],
    round: 9,
  });

  const spyIds = eventIds.filter((id) => id.startsWith("espionage-"));
  assert.equal(spyIds.length, 3);
  assert.equal(new Set(spyIds).size, 3, "ids are unique within the round");
  assert.ok(spyIds.every((id) => id.startsWith("espionage-9-")), "ids are namespaced by round");
});

test("an unusable espionage event leaves no dangling id", () => {
  // normalizeEventEntry drops an entry with nothing to show; the record must not
  // then point at an event that was never added.
  const { turnEvents, eventIds, nextEvents } = buildTurnEvents({
    freshEvents: [fresh("f1")],
    espionageEvents: [{ date: "1911-06-02", kind: "world" }, espionage("real one")],
    round: 3,
  });

  assert.equal(turnEvents.length, 2, "only the usable espionage event is added");
  assert.equal(eventIds.length, 2);
  assert.deepEqual(eventIds, nextEvents.map((event) => event.id));
});

test("the caller's arrays are not mutated", () => {
  // The original defect was aliasing: a list handed out earlier, then appended
  // to. Building a new list instead is what makes an early copy impossible.
  const priorEvents = [prior("p1")];
  const freshEvents = [fresh("f1")];

  buildTurnEvents({
    priorEvents,
    freshEvents,
    espionageEvents: [espionage("Spy ring rolled up in Germany")],
    round: 1,
  });

  assert.equal(priorEvents.length, 1);
  assert.equal(freshEvents.length, 1, "freshEvents is left as the simulator produced it");
});
