/*! Open Historia — a scenario's pre-game history: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioPrehistory.test.js
//
// A scenario keeps its backstory (world.prehistory) so a game opens with it
// without a request. What has to hold:
//   - a record reads back as the editor and the game expect it: events with
//     ids, known importance, tags from the timeline's vocabulary, oldest first,
//     and the Day-one facts kept as they were decoded;
//   - an empty record is still a record (the designer chose no backstory), and
//     anything that is not a record is none;
//   - the editor keeps an event whose title is still blank; a saved record
//     never does, and the problems say why an event cannot be saved yet;
//   - a game applies only events dated before its start date, and a record with
//     nothing left to apply is nothing;
//   - the Day-one facts list as names, and one can be removed.

import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyScenarioPrehistory,
  MAX_PREHISTORY_EVENTS,
  normalizeScenarioPrehistory,
  prehistoryHasContent,
  prehistoryPayload,
  prehistoryProblems,
  prehistoryUpdateRows,
  withoutPrehistoryUpdate,
} from "./scenarioPrehistory.js";

const RECORD = {
  prompt: "The road to the Great War.",
  summary: "Europe arms itself.",
  generatedAt: "2026-09-28T12:00:00.000Z",
  events: [
    { id: "e2", date: "1914-06-28", title: "Archduke shot in Sarajevo", description: "A Serbian nationalist kills the heir.", importance: "MAJOR", kind: "Military", tags: ["military", "Politics", "nonsense"], warId: "war-great" },
    { id: "e1", date: "1908-10-06", title: "Bosnia annexed", description: "Austria-Hungary annexes Bosnia.", quote: { text: "  A fait accompli.  ", speaker: "Aehrenthal" } },
    { date: "sometime", title: "Undated rumour" },
  ],
  updates: {
    warUpdates: [{ id: "war-great", op: "start", actors: ["Austria-Hungary"], opponents: ["Serbia"], eventIds: [], eventIndexes: [] }],
    relationUpdates: [{ a: "France", b: "German Empire", score: -55.4 }],
    agreementUpdates: [{ id: "entente", op: "start", type: "alliance", parties: ["France", "Russia"], title: "Franco-Russian Alliance" }],
    puppetUpdates: [],
    storylineUpdates: [{ id: "balkans", status: "active", title: "Balkan powder keg", participants: ["Serbia", "Austria-Hungary"] }],
  },
};

test("a record reads back as the editor and the game expect it", () => {
  const prehistory = normalizeScenarioPrehistory(RECORD);
  assert.equal(prehistory.version, 1);
  assert.equal(prehistory.prompt, "The road to the Great War.");
  assert.deepEqual(prehistory.events.map((event) => event.title), ["Bosnia annexed", "Archduke shot in Sarajevo", "Undated rumour"], "oldest first, the undated one last");
  const sarajevo = prehistory.events[1];
  assert.equal(sarajevo.importance, "major");
  assert.equal(sarajevo.kind, "military");
  assert.deepEqual(sarajevo.tags, ["Military", "Politics"], "the timeline's own tags only");
  assert.equal(sarajevo.warId, "war-great");
  assert.deepEqual(prehistory.events[0].quote, { text: "A fait accompli.", speaker: "Aehrenthal" });
  assert.ok(prehistory.events[2].id, "an event without an id gets one");
  assert.deepEqual(prehistory.updates.warUpdates, RECORD.updates.warUpdates, "the Day-one facts as they were decoded");
  assert.deepEqual(prehistory.updates.puppetUpdates, []);
});

test("an empty record is a record; anything else is none", () => {
  assert.deepEqual(emptyScenarioPrehistory().events, []);
  assert.equal(normalizeScenarioPrehistory({}).version, 1);
  for (const value of [null, undefined, "text", [], 3]) assert.equal(normalizeScenarioPrehistory(value), null);
  assert.equal(prehistoryHasContent({}), false);
  assert.equal(prehistoryHasContent({ updates: { relationUpdates: [{ a: "A", b: "B", score: 10 }] } }), true, "Day-one facts alone");
  assert.equal(prehistoryHasContent(RECORD), true);
});

test("the editor keeps a blank title; a saved record does not, and the problems say why", () => {
  const draft = normalizeScenarioPrehistory({ events: [{ id: "new", date: "", title: "" }, { id: "late", date: "1914-08-01", title: "War declared" }] }, { draft: true });
  assert.deepEqual(draft.events.map((event) => event.id), ["new", "late"], "in the order written");
  assert.deepEqual(normalizeScenarioPrehistory(draft).events.map((event) => event.id), ["late"]);
  assert.deepEqual(prehistoryProblems(draft, { startDate: "1914-07-28" }), [
    { id: "new", problem: "title" },
    { id: "new", problem: "date" },
    { id: "late", problem: "late" },
  ]);
  const saved = normalizeScenarioPrehistory(RECORD);
  assert.deepEqual(prehistoryProblems(saved, { startDate: "1914-07-28" }), [{ id: saved.events[2].id, problem: "date" }]);
});

test("BC dates are dates, oldest first", () => {
  const prehistory = normalizeScenarioPrehistory({ events: [
    { id: "b", date: "-0044-03-15", title: "Caesar killed" },
    { id: "a", date: "-0049-01-10", title: "The Rubicon crossed" },
  ] });
  assert.deepEqual(prehistory.events.map((event) => event.id), ["a", "b"]);
  assert.deepEqual(prehistoryProblems(prehistory, { startDate: "-0043-01-01" }), []);
});

test("a game applies only what is before its start date", () => {
  const payload = prehistoryPayload(RECORD, { startDate: "1914-06-01" });
  assert.deepEqual(payload.events.map((event) => event.id), ["e1"], "Sarajevo is after this start date, the rumour has no date");
  assert.equal(payload.summary, "Europe arms itself.");
  assert.equal(payload.warUpdates.length, 1);
  assert.equal(payload.storylineUpdates.length, 1);
  assert.equal(prehistoryPayload({ events: [{ date: "1920-01-01", title: "Later" }] }, { startDate: "1914-06-01" }), null, "nothing left to apply");
  assert.equal(prehistoryPayload({}, { startDate: "1914-06-01" }), null);
  assert.equal(prehistoryPayload({ updates: { relationUpdates: [{ a: "A", b: "B", score: 1 }] } }, { startDate: "1914-06-01" }).events.length, 0, "Day-one facts alone still apply");
});

test("the Day-one facts list as names, and one can be removed", () => {
  const rows = prehistoryUpdateRows(normalizeScenarioPrehistory(RECORD));
  assert.deepEqual(rows.map((row) => row.family), ["warUpdates", "relationUpdates", "agreementUpdates", "storylineUpdates"]);
  assert.deepEqual(rows[0], { family: "warUpdates", index: 0, title: "war-great", sideA: ["Austria-Hungary"], sideB: ["Serbia"], detail: "start" });
  assert.deepEqual(rows[1], { family: "relationUpdates", index: 0, title: "", sideA: ["France"], sideB: ["German Empire"], detail: "-55" });
  assert.equal(rows[2].title, "Franco-Russian Alliance");
  const without = withoutPrehistoryUpdate(RECORD, "relationUpdates", 0);
  assert.equal(without.updates.relationUpdates.length, 0);
  assert.equal(without.updates.warUpdates.length, 1, "the others stay");
});

test("a record holds a bounded number of events, and no two share an id", () => {
  const many = normalizeScenarioPrehistory({ events: Array.from({ length: MAX_PREHISTORY_EVENTS + 10 }, (_, index) => ({ id: "same", date: "1900-01-01", title: `Event ${index}` })) });
  assert.equal(many.events.length, MAX_PREHISTORY_EVENTS);
  assert.equal(new Set(many.events.map((event) => event.id)).size, MAX_PREHISTORY_EVENTS);
});
