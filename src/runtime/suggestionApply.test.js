/*! Open Historia — applying a suggestion's changes outside the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/suggestionApply.test.js
//
// The author's side of a suggestion, outside the map editor. What has to hold:
//   - a file from the hub can name only the fields the diff makes: never the
//     scenario's world whole, its storage or its provenance, however it is
//     spelled, and applying re-checks each key it writes.

import test from "node:test";
import assert from "node:assert/strict";

import { diffScenarioBundles } from "./scenarioChanges.js";
import { normalizeSuggestion, SUGGESTION_SCHEMA } from "./scenarioSuggestion.js";
import { buildDetailSave } from "./suggestionApply.js";

const field = (path, to = "x") => ({ id: `field:${path.join(".")}`, area: "details", kind: "field", path, from: "", to });
const politics = (fieldName) => ({ id: `politics:${fieldName}`, area: "details", kind: "politics", field: fieldName, container: "value", entry: null, from: null, to: { any: "thing" } });

const HOSTILE = [
  field(["meta", "world"], { polities: {} }),
  field(["meta", "worldPatch"], { regionOwnershipOverrides: {} }),
  field(["meta", "hubOrigin"], null),
  field(["meta", "hubPublished"], null),
  field(["meta", "storage"], {}),
  field(["game", "storage"], {}),
  field(["world", "regionOwnershipOverrides"], { r1: "Alpha" }),
  field(["world", "simulationRules", "extra"]),
  field(["features", "espionage", "__proto__"], true),
  field(["features", "notAFeature", "enabled"], true),
  field(["prompts", "advisor", "notASegment"]),
  field(["prompts", "hubOrigin"]),
  field(["somewhere", "else"]),
  politics("regionOwnershipOverrides"),
  politics("groups"),
];

test("a file cannot name a field the diff never makes", () => {
  const suggestion = normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes: HOSTILE });
  assert.deepEqual(suggestion.changes, [], "every one is dropped on reading");
  const { patch, uploads, clears } = buildDetailSave(HOSTILE, { scenario: {}, data: { world: {} } });
  assert.deepEqual(patch, {}, "and applying one directly writes nothing");
  assert.deepEqual(uploads, []);
  assert.deepEqual(clears, []);
});

test("every field the diff makes survives reading a file", () => {
  const base = {
    scenario: { name: "Old World", features: { espionage: { enabled: true } } },
    data: { game: { country: "Alpha" }, world: { simulationRules: "" }, prompts: {} },
    assets: {},
  };
  const next = {
    scenario: { name: "New World", features: { espionage: { enabled: false }, idleDiplomacy: { enabled: true, averageMinutes: 30 } } },
    data: {
      game: { country: "Beta" },
      world: { simulationRules: "No airships.", agreements: [{ id: "pact", name: "The Pact" }] },
      prompts: { promptModel: 2, guidance: { advisor: { role: "A gruff general." }, tasks: {} } },
    },
    assets: {},
  };
  const changes = diffScenarioBundles(base, next).filter((change) => change.area === "details");
  assert.ok(changes.some((change) => change.kind === "field" && change.path[0] === "features"));
  assert.ok(changes.some((change) => change.kind === "field" && change.path[0] === "prompts"));
  assert.ok(changes.some((change) => change.kind === "politics"));
  const suggestion = normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes });
  assert.deepEqual(suggestion.changes.map((change) => change.id), changes.map((change) => change.id));
});
