/*! Open Historia — a suggestion carries a scenario's language packs: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioLanguageSuggestions.test.js
//
// A player who improved a scenario's German can suggest it back to the author
// like any other change: one change per language, which the author accepts or
// refuses, and Undo puts theirs back. Read from a file, so only strings under
// a language's code ever reach the author's scenario.
import test from "node:test";
import assert from "node:assert/strict";

import { buildScenarioSnapshot, diffScenarioBundles, summarizeChangesForComment } from "./scenarioChanges.js";
import { normalizeSuggestion, SUGGESTION_SCHEMA } from "./scenarioSuggestion.js";
import { applyToSnapshot, buildDetailSave, detailChangeStatus, detailValueIn, inverseOf } from "./suggestionApply.js";

const bundleWith = (languages) => ({
  scenario: { name: "Thirty Years", ...(languages ? { languages } : {}) },
  data: { game: { country: "Bohemia" }, world: {}, prompts: {} },
  assets: {},
});
const languageChanges = (base, next) => diffScenarioBundles(bundleWith(base), bundleWith(next)).filter((change) => change.kind === "languages");

const POSTED = { de: { "Kingdom of Bohemia": "Königreich Böhmen" }, fr: { "Kingdom of Bohemia": "Royaume de Bohême" } };
const SUGGESTED = { de: { "Kingdom of Bohemia": "Königreich Böhmen", Prague: "Prag" }, fr: POSTED.fr, es: { "Kingdom of Bohemia": "Reino de Bohemia" } };

test("each language is its own change, and only the languages that differ", () => {
  const changes = languageChanges(POSTED, SUGGESTED);
  assert.deepEqual(changes, [
    { id: "languages:de", area: "details", kind: "languages", code: "de", from: POSTED.de, to: SUGGESTED.de },
    { id: "languages:es", area: "details", kind: "languages", code: "es", from: null, to: SUGGESTED.es },
  ]);
  assert.deepEqual(languageChanges(POSTED, { fr: POSTED.fr }).map((change) => [change.code, change.to]), [["de", null]]);
  assert.deepEqual(languageChanges(POSTED, JSON.parse(JSON.stringify(POSTED))), []);
  assert.deepEqual(languageChanges(null, null), []);
  assert.deepEqual(summarizeChangesForComment(changes), ["Language packs changed"]);
  assert.equal(buildScenarioSnapshot(bundleWith(null)).languages, null);
});

test("an author accepts a language, the others stay as they are, and Undo puts theirs back", () => {
  const [german, spanish] = languageChanges(POSTED, SUGGESTED);
  assert.deepEqual(normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes: [german, spanish] }).changes, [german, spanish], "it survives the file");

  const author = buildScenarioSnapshot(bundleWith(POSTED));
  assert.equal(detailChangeStatus(german, author), "open");
  assert.equal(detailChangeStatus(german, buildScenarioSnapshot(bundleWith({ de: { "Kingdom of Bohemia": "Böhmen" } }))), "conflict");
  assert.equal(detailChangeStatus(german, buildScenarioSnapshot(bundleWith(SUGGESTED))), "applied");

  const before = detailValueIn(author, german);
  const { patch, uploads, clears } = buildDetailSave([german, spanish], { scenario: { languages: POSTED }, data: {} });
  assert.deepEqual(patch, { languages: { de: SUGGESTED.de, es: SUGGESTED.es, fr: POSTED.fr } }, "the author's French kept beside them");
  assert.deepEqual([uploads, clears], [[], []]);
  applyToSnapshot(author, german);
  assert.equal(detailChangeStatus(german, author), "applied");
  const undo = inverseOf(german, before);
  assert.deepEqual(buildDetailSave([undo], { scenario: { languages: SUGGESTED }, data: {} }).patch.languages.de, POSTED.de);
  applyToSnapshot(author, undo);
  assert.deepEqual(author.languages.de, POSTED.de);

  // A suggestion to drop a language takes only that one away.
  const [dropped] = languageChanges(POSTED, { fr: POSTED.fr });
  assert.deepEqual(buildDetailSave([dropped], { scenario: { languages: POSTED }, data: {} }).patch, { languages: { fr: POSTED.fr } });
  const [last] = languageChanges({ de: POSTED.de }, null);
  assert.deepEqual(buildDetailSave([last], { scenario: { languages: { de: POSTED.de } }, data: {} }).patch, { languages: null });
});

test("a suggestion's pack is a file's: a bad code is dropped, and only strings reach the author", () => {
  const read = normalizeSuggestion({
    schema: SUGGESTION_SCHEMA,
    changes: [
      { id: "languages:__proto__", area: "details", kind: "languages", code: "__proto__", from: null, to: { a1: "b" } },
      { id: "languages:x", area: "details", kind: "languages", code: "../x", from: null, to: { a1: "b" } },
      { id: "languages:de", area: "details", kind: "languages", code: "de", from: null, to: "not a pack" },
      { id: "languages:it", area: "details", kind: "languages", code: "it", from: null, to: { Bohemia: "Boemia", Bad: { x: 1 }, Number: 3 } },
    ],
  });
  assert.deepEqual(read.changes.map((change) => change.id), ["languages:it"]);
  assert.deepEqual(buildDetailSave(read.changes, { scenario: {}, data: {} }).patch, { languages: { it: { Bohemia: "Boemia" } } });
});
