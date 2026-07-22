/*! Open Historia — timeline event de-dup tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/eventDedup.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { dedupeGeneratedEvents, dedupeEventLog, eventContentKey } from "./eventDedup.js";

const ev = (over = {}) => ({ id: "x", date: "1950-01-01", title: "War begins", description: "The front opens.", ...over });
const ids = (arr) => arr.map((e) => e.id);

// ---- Group K: eventContentKey ----------------------------------------------

test("K1 identical content → identical key", () => {
  assert.equal(eventContentKey(ev({ id: "a" })), eventContentKey(ev({ id: "b" })));
});
test("K2 different date → different key", () => {
  assert.notEqual(eventContentKey(ev()), eventContentKey(ev({ date: "1950-02-01" })));
});
test("K3 different title → different key", () => {
  assert.notEqual(eventContentKey(ev()), eventContentKey(ev({ title: "Peace" })));
});
test("K4 different description → different key", () => {
  assert.notEqual(eventContentKey(ev()), eventContentKey(ev({ description: "Something else." })));
});
test("K5 title case is ignored", () => {
  assert.equal(eventContentKey(ev({ title: "WAR BEGINS" })), eventContentKey(ev({ title: "war begins" })));
});
test("K6 description case is ignored", () => {
  assert.equal(eventContentKey(ev({ description: "THE FRONT OPENS." })), eventContentKey(ev({ description: "the front opens." })));
});
test("K7 leading/trailing whitespace on title is ignored", () => {
  assert.equal(eventContentKey(ev({ title: "  War begins  " })), eventContentKey(ev({ title: "War begins" })));
});
test("K8 leading/trailing whitespace on description is ignored", () => {
  assert.equal(eventContentKey(ev({ description: "\tThe front opens.\n" })), eventContentKey(ev({ description: "The front opens." })));
});
test("K9 id is NOT part of the key (fresh-id restatements collide)", () => {
  assert.equal(eventContentKey(ev({ id: "zzz" })), eventContentKey(ev({ id: "aaa" })));
});
test("K10 null/undefined fields collapse to empty parts, no throw", () => {
  assert.equal(eventContentKey({ date: null, title: undefined, description: null }), eventContentKey({}));
});
test("K11 a null event does not throw", () => {
  assert.doesNotThrow(() => eventContentKey(null));
});
test("K12 numeric date is coerced to string", () => {
  assert.equal(eventContentKey(ev({ date: 1950 })), eventContentKey(ev({ date: "1950" })));
});
test("K13 key is always a string", () => {
  assert.equal(typeof eventContentKey(ev()), "string");
  assert.equal(typeof eventContentKey(null), "string");
});
test("K14 same date+title, different description → different key", () => {
  assert.notEqual(eventContentKey(ev({ description: "A" })), eventContentKey(ev({ description: "B" })));
});

// ---- Group L: dedupeGeneratedEvents ----------------------------------------

test("L1 drops a generated event that restates one in the base log", () => {
  const base = [ev({ id: "a" })];
  const gen = [ev({ id: "b" }), ev({ id: "c", date: "1950-02-01", title: "Offensive" })];
  assert.deepEqual(ids(dedupeGeneratedEvents(base, gen)), ["c"]);
});
test("L2 collapses duplicates within the generated batch (keeps first)", () => {
  const gen = [ev({ id: "a" }), ev({ id: "b" })];
  assert.deepEqual(ids(dedupeGeneratedEvents([], gen)), ["a"]);
});
test("L3 rolling-date restatement (same title, different date) is KEPT", () => {
  const base = [ev({ id: "a", title: "The war continues" })];
  const gen = [ev({ id: "b", date: "1950-02-01", title: "The war continues" })];
  assert.deepEqual(ids(dedupeGeneratedEvents(base, gen)), ["b"]);
});
test("L4 distinct events on the same date are kept", () => {
  const gen = [ev({ id: "a", title: "Election" }), ev({ id: "b", title: "Earthquake" })];
  assert.equal(dedupeGeneratedEvents([], gen).length, 2);
});
test("L5 distinct titles are kept", () => {
  const gen = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "B" }), ev({ id: "c", title: "C" })];
  assert.equal(dedupeGeneratedEvents([], gen).length, 3);
});
test("L6 empty base → all generated kept", () => {
  const gen = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "B" })];
  assert.equal(dedupeGeneratedEvents([], gen).length, 2);
});
test("L7 empty generated → empty result", () => {
  assert.deepEqual(dedupeGeneratedEvents([ev()], []), []);
});
test("L8 null base is treated as empty", () => {
  assert.deepEqual(ids(dedupeGeneratedEvents(null, [ev({ id: "a" })])), ["a"]);
});
test("L9 null generated → empty result", () => {
  assert.deepEqual(dedupeGeneratedEvents([ev()], null), []);
});
test("L10 both null → empty array", () => {
  assert.deepEqual(dedupeGeneratedEvents(null, undefined), []);
});
test("L11 non-array base is treated as empty", () => {
  assert.deepEqual(ids(dedupeGeneratedEvents("nope", [ev({ id: "a" })])), ["a"]);
});
test("L12 non-array generated → empty result", () => {
  assert.deepEqual(dedupeGeneratedEvents([], "nope"), []);
});
test("L13 preserves the order of fresh events", () => {
  const gen = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "B" }), ev({ id: "c", title: "C" })];
  assert.deepEqual(ids(dedupeGeneratedEvents([], gen)), ["a", "b", "c"]);
});
test("L14 returns the SAME object references (no cloning)", () => {
  const kept = ev({ id: "a", title: "A" });
  const out = dedupeGeneratedEvents([], [kept]);
  assert.equal(out[0], kept);
});
test("L15 a batch of all-identical restatements collapses to one", () => {
  const gen = Array.from({ length: 20 }, (_, i) => ev({ id: `g${i}` }));
  assert.deepEqual(ids(dedupeGeneratedEvents([], gen)), ["g0"]);
});
test("L16 base already contains every generated event → empty", () => {
  const base = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "B" })];
  const gen = [ev({ id: "c", title: "A" }), ev({ id: "d", title: "B" })];
  assert.deepEqual(dedupeGeneratedEvents(base, gen), []);
});
test("L17 partial overlap keeps only the fresh ones", () => {
  const base = [ev({ id: "a", title: "A" })];
  const gen = [ev({ id: "b", title: "A" }), ev({ id: "c", title: "B" }), ev({ id: "d", title: "C" })];
  assert.deepEqual(ids(dedupeGeneratedEvents(base, gen)), ["c", "d"]);
});
test("L18 case-only variation vs base is treated as a restatement", () => {
  const base = [ev({ id: "a", title: "War Begins", description: "The Front Opens." })];
  const gen = [ev({ id: "b", title: "war begins", description: "the front opens." })];
  assert.deepEqual(dedupeGeneratedEvents(base, gen), []);
});
test("L19 whitespace-only variation vs base is treated as a restatement", () => {
  const base = [ev({ id: "a" })];
  const gen = [ev({ id: "b", title: "  War begins ", description: "The front opens.  " })];
  assert.deepEqual(dedupeGeneratedEvents(base, gen), []);
});
test("L20 unicode content is handled and distinct unicode is kept", () => {
  const gen = [ev({ id: "a", title: "Belagerung von Königsberg" }), ev({ id: "b", title: "Осада" })];
  assert.equal(dedupeGeneratedEvents([], gen).length, 2);
});
test("L21 same content but different id vs base → dropped (id irrelevant)", () => {
  const base = [ev({ id: "original" })];
  assert.deepEqual(dedupeGeneratedEvents(base, [ev({ id: "brand-new-random" })]), []);
});
test("L22 different content but same id → both kept (id irrelevant)", () => {
  const base = [ev({ id: "same", title: "A" })];
  const gen = [ev({ id: "same", title: "B" })];
  assert.deepEqual(ids(dedupeGeneratedEvents(base, gen)), ["same"]);
});
test("L23 does not mutate the base array", () => {
  const base = [ev({ id: "a" })];
  const before = base.length;
  dedupeGeneratedEvents(base, [ev({ id: "b", title: "B" })]);
  assert.equal(base.length, before);
});
test("L24 does not mutate the generated array", () => {
  const gen = [ev({ id: "a" }), ev({ id: "b" })];
  const before = gen.length;
  dedupeGeneratedEvents([], gen);
  assert.equal(gen.length, before);
});
test("L25 two content-empty events collapse to one", () => {
  const gen = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(ids(dedupeGeneratedEvents([], gen)), ["a"]);
});
test("L26 a restatement among genuinely-new events is surgically removed", () => {
  const base = [ev({ id: "a", title: "A" })];
  const gen = [ev({ id: "b", title: "B" }), ev({ id: "c", title: "A" }), ev({ id: "d", title: "D" })];
  assert.deepEqual(ids(dedupeGeneratedEvents(base, gen)), ["b", "d"]);
});
test("L27 null entries inside the generated array do not throw", () => {
  const gen = [null, ev({ id: "a", title: "A" })];
  assert.doesNotThrow(() => dedupeGeneratedEvents([], gen));
});

// ---- Group M: dedupeEventLog -----------------------------------------------

test("M1 collapses exact repeats in a full log (keeps first)", () => {
  const log = [ev({ id: "a", title: "X" }), ev({ id: "b", title: "X" }), ev({ id: "c", title: "Y" })];
  assert.deepEqual(ids(dedupeEventLog(log)), ["a", "c"]);
});
test("M2 preserves order", () => {
  const log = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "B" }), ev({ id: "c", title: "C" })];
  assert.deepEqual(ids(dedupeEventLog(log)), ["a", "b", "c"]);
});
test("M3 empty log → empty", () => {
  assert.deepEqual(dedupeEventLog([]), []);
});
test("M4 null → empty, no throw", () => {
  assert.deepEqual(dedupeEventLog(null), []);
});
test("M5 non-array → empty, no throw", () => {
  assert.deepEqual(dedupeEventLog("nope"), []);
});
test("M6 single event is returned as-is", () => {
  const log = [ev({ id: "a" })];
  assert.deepEqual(ids(dedupeEventLog(log)), ["a"]);
});
test("M7 all-identical log collapses to one", () => {
  const log = Array.from({ length: 10 }, (_, i) => ev({ id: `e${i}` }));
  assert.deepEqual(ids(dedupeEventLog(log)), ["e0"]);
});
test("M8 a log with no duplicates is unchanged in length", () => {
  const log = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "B" }), ev({ id: "c", title: "C" })];
  assert.equal(dedupeEventLog(log).length, 3);
});
test("M9 mixed duplicates and distinct events", () => {
  const log = [
    ev({ id: "a", title: "A" }),
    ev({ id: "b", title: "B" }),
    ev({ id: "c", title: "A" }),
    ev({ id: "d", title: "C" }),
    ev({ id: "e", title: "B" }),
  ];
  assert.deepEqual(ids(dedupeEventLog(log)), ["a", "b", "d"]);
});
test("M10 case/whitespace variants collapse within a log", () => {
  const log = [ev({ id: "a", title: "War" }), ev({ id: "b", title: " war " })];
  assert.deepEqual(ids(dedupeEventLog(log)), ["a"]);
});
test("M11 returns the same object references it keeps", () => {
  const first = ev({ id: "a", title: "A" });
  const out = dedupeEventLog([first, ev({ id: "b", title: "A" })]);
  assert.equal(out[0], first);
});
test("M12 does not mutate the input log", () => {
  const log = [ev({ id: "a", title: "A" }), ev({ id: "b", title: "A" })];
  const before = log.length;
  dedupeEventLog(log);
  assert.equal(log.length, before);
});
test("M13 large log with heavy duplication stays correct", () => {
  const log = [];
  for (let i = 0; i < 100; i += 1) log.push(ev({ id: `e${i}`, title: i % 2 === 0 ? "Even" : "Odd" }));
  assert.deepEqual(ids(dedupeEventLog(log)), ["e0", "e1"]);
});
