/*! Open Historia — suggested changes to a scenario's pre-history: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioPrehistorySuggestions.test.js
//
// A scenario's pre-history (world.prehistory, scenarioPrehistory.js) travels in
// a suggestion like the rest of it. What has to hold:
//   - each event added, changed or removed is its own change, labelled with its
//     title, found by its id;
//   - the summary, the prompt and the Day-one facts are one change;
//   - an event's status is its own, and accepting it keeps the author's others;
//   - a pre-history generated on a post that had none arrives whole on Accept
//     all, and an empty one arriving is a change too (its games ask for none);
//   - a file cannot carry a pre-history change of an unknown part or key.

import test from "node:test";
import assert from "node:assert/strict";

import { diffScenarioBundles } from "./scenarioChanges.js";
import { buildDetailSave, detailStatuses } from "./suggestionApply.js";
import { normalizeSuggestion, SUGGESTION_SCHEMA } from "./scenarioSuggestion.js";
import { normalizeScenarioPrehistory } from "./scenarioPrehistory.js";

const bundle = (world) => ({ scenario: { name: "Europe" }, data: { world, game: { startDate: "1914-07-28" } }, assets: {} });
const details = (world) => ({ scenario: {}, data: { world } });
const historyOf = (changes) => changes.filter((change) => change.kind === "history");

const EVENTS = [
  { id: "bosnia", date: "1908-10-06", title: "Bosnia annexed", description: "Austria-Hungary annexes Bosnia." },
  { id: "balkan", date: "1912-10-08", title: "First Balkan War", description: "The Balkan League attacks the Ottomans." },
  { id: "sarajevo", date: "1914-06-28", title: "Archduke shot", description: "In Sarajevo." },
];
const POSTED = { prehistory: { summary: "Europe arms itself.", events: EVENTS, updates: { relationUpdates: [{ a: "France", b: "German Empire", score: -50 }] } } };

test("each event added, changed or removed is its own change", () => {
  const suggested = { prehistory: {
    ...POSTED.prehistory,
    events: [
      EVENTS[0],
      { ...EVENTS[2], title: "Archduke Franz Ferdinand shot" },
      { id: "agadir", date: "1911-07-01", title: "Agadir Crisis", description: "A gunboat at Agadir." },
    ],
  } };
  const changes = historyOf(diffScenarioBundles(bundle(POSTED), bundle(suggested)));
  assert.deepEqual(changes.map((change) => [change.id, change.op, change.label]).sort(), [
    ["history:event:agadir", "add", "Agadir Crisis"],
    ["history:event:balkan", "remove", "First Balkan War"],
    ["history:event:sarajevo", "change", "Archduke Franz Ferdinand shot"],
  ]);
  assert.ok(!changes.some((change) => change.part === "setup"), "the summary and the facts did not change");
});

test("the summary and the Day-one facts are one change", () => {
  const suggested = { prehistory: { ...POSTED.prehistory, summary: "Europe sleepwalks.", updates: { relationUpdates: [{ a: "France", b: "German Empire", score: -70 }] } } };
  const changes = historyOf(diffScenarioBundles(bundle(POSTED), bundle(suggested)));
  assert.deepEqual(changes.map((change) => change.id), ["history:setup"]);
  assert.equal(changes[0].to.summary, "Europe sleepwalks.");
  assert.equal(changes[0].to.updates.relationUpdates[0].score, -70);
});

test("an event's status is its own, and accepting it keeps the author's others", () => {
  const suggested = { prehistory: { ...POSTED.prehistory, events: [EVENTS[0], EVENTS[1], { ...EVENTS[2], title: "Archduke Franz Ferdinand shot" }] } };
  const [change] = historyOf(diffScenarioBundles(bundle(POSTED), bundle(suggested)));
  // The author reworded Bosnia since posting: no conflict with Sarajevo.
  const authorNow = { prehistory: { ...POSTED.prehistory, events: [{ ...EVENTS[0], title: "Bosnian Crisis" }, EVENTS[1], EVENTS[2]] } };
  assert.equal(detailStatuses([change], bundle(authorNow))[change.id], "open");
  const authorEditedIt = { prehistory: { ...POSTED.prehistory, events: [EVENTS[0], EVENTS[1], { ...EVENTS[2], title: "Sarajevo" }] } };
  assert.equal(detailStatuses([change], bundle(authorEditedIt))[change.id], "conflict");

  const saved = buildDetailSave([change], details(authorNow)).patch.worldPatch.prehistory;
  assert.deepEqual(saved.events.map((event) => event.title), ["Bosnian Crisis", "First Balkan War", "Archduke Franz Ferdinand shot"]);
  assert.equal(saved.summary, "Europe arms itself.", "the rest of the record stays");
  assert.equal(detailStatuses([change], bundle({ prehistory: saved }))[change.id], "applied");
});

test("a pre-history generated on a post that had none arrives whole", () => {
  const generated = normalizeScenarioPrehistory({ ...POSTED.prehistory, prompt: "The road to war.", generatedAt: "2026-09-28T00:00:00.000Z" });
  const changes = historyOf(diffScenarioBundles(bundle({}), bundle({ prehistory: generated })));
  assert.equal(changes.filter((change) => change.part === "event").length, 3);
  assert.equal(changes.filter((change) => change.part === "setup").length, 1);
  assert.ok(Object.values(detailStatuses(changes, bundle({}))).every((status) => status === "open"));
  const saved = buildDetailSave(changes, details({})).patch.worldPatch.prehistory;
  const { generatedAt, ...withoutStamp } = generated;
  assert.ok(generatedAt);
  assert.deepEqual({ ...saved, generatedAt: undefined }, { ...withoutStamp, generatedAt: undefined }, "the author's record is the generated one");
});

test("an empty pre-history arriving is a change: its games ask for none", () => {
  const changes = historyOf(diffScenarioBundles(bundle({ startingTimelineText: "Tense." }), bundle({ startingTimelineText: "Tense.", prehistory: {} })));
  assert.deepEqual(changes.map((change) => change.id), ["history:setup"]);
  const saved = buildDetailSave(changes, details({})).patch.worldPatch.prehistory;
  assert.deepEqual(saved.events, []);
  assert.equal(saved.version, 1);
});

test("a file cannot carry a pre-history change of an unknown part or key", () => {
  const change = (overrides) => ({ id: `history:${JSON.stringify(overrides)}`, area: "details", kind: "history", part: "event", entry: "bosnia", op: "change", to: {}, ...overrides });
  const suggestion = normalizeSuggestion({
    schema: SUGGESTION_SCHEMA,
    changes: [change({}), change({ part: "script" }), change({ entry: "__proto__" }), change({ part: "setup", entry: null })],
  });
  assert.deepEqual(suggestion.changes.map((entry) => [entry.part, entry.entry]), [["event", "bosnia"], ["setup", null]]);
});
