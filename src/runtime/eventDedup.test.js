/*! Open Historia — timeline event de-dup tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/eventDedup.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { dedupeGeneratedEvents, dedupeEventLog, eventContentKey } from "./eventDedup.js";

test("drops a generated event that restates one already in the base log", () => {
  const base = [{ id: "a", date: "1950-01-01", title: "War begins", description: "The front opens." }];
  const generated = [
    { id: "b", date: "1950-01-01", title: "War begins", description: "The front opens." }, // exact restatement
    { id: "c", date: "1950-02-01", title: "First offensive", description: "Troops advance." }, // genuinely new
  ];
  assert.deepEqual(dedupeGeneratedEvents(base, generated).map((e) => e.id), ["c"]);
});

test("collapses duplicates within the generated batch (keeps first)", () => {
  const generated = [
    { id: "a", date: "1950-01-01", title: "Coup", description: "The junta seizes power." },
    { id: "b", date: "1950-01-01", title: "Coup", description: "The junta seizes power." },
  ];
  assert.deepEqual(dedupeGeneratedEvents([], generated).map((e) => e.id), ["a"]);
});

test("keeps events sharing a title but with different dates (rolling-date case the prompt handles)", () => {
  const base = [{ id: "a", date: "1950-01-01", title: "The war continues", description: "Fighting drags on." }];
  const generated = [{ id: "b", date: "1950-02-01", title: "The war continues", description: "Fighting drags on." }];
  // Different date -> different key -> kept. The [New Developments Only] prompt directive addresses this class.
  assert.deepEqual(dedupeGeneratedEvents(base, generated).map((e) => e.id), ["b"]);
});

test("keeps genuinely distinct events on the same date", () => {
  const generated = [
    { id: "a", date: "1950-01-01", title: "Election", description: "A new leader." },
    { id: "b", date: "1950-01-01", title: "Earthquake", description: "A disaster strikes." },
  ];
  assert.equal(dedupeGeneratedEvents([], generated).length, 2);
});

test("dedupeEventLog collapses exact repeats in a full log", () => {
  const log = [
    { id: "a", date: "1950-01-01", title: "X", description: "x" },
    { id: "b", date: "1950-01-01", title: "X", description: "x" },
    { id: "c", date: "1951-01-01", title: "Y", description: "y" },
  ];
  assert.deepEqual(dedupeEventLog(log).map((e) => e.id), ["a", "c"]);
});

test("empty / non-array inputs never throw", () => {
  assert.deepEqual(dedupeGeneratedEvents(null, undefined), []);
  assert.deepEqual(dedupeGeneratedEvents([], []), []);
  assert.deepEqual(dedupeEventLog(null), []);
});

test("content key is case- and whitespace-insensitive on title/description", () => {
  assert.equal(
    eventContentKey({ date: "1950-01-01", title: " War Begins ", description: "The Front Opens." }),
    eventContentKey({ date: "1950-01-01", title: "war begins", description: "the front opens." }),
  );
});
