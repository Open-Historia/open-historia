/*! Open Historia — applying a suggestion's changes outside the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/suggestionApply.test.js
//
// The author's side of a suggestion, outside the map editor. What has to hold:
//   - a file from the hub can name only the fields the diff makes: never the
//     scenario's world whole, its storage or its provenance, however it is
//     spelled, and applying re-checks each key it writes;
//   - Undo, after Accept, puts back exactly what the author had, for every
//     kind of change: a Politics entry the change took out comes back, and
//     one it added goes again (the Undo used to repeat the change's own op);
//   - text changes read word by word, a replaced phrase as one.

import test from "node:test";
import assert from "node:assert/strict";

import { buildScenarioSnapshot, diffScenarioBundles, sameValue } from "./scenarioChanges.js";
import { normalizeSuggestion, SUGGESTION_SCHEMA } from "./scenarioSuggestion.js";
import { applyToSnapshot, buildDetailSave, detailChangeStatus, detailValueIn, diffWords, inverseOf } from "./suggestionApply.js";

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

// ---- Accept, then Undo ------------------------------------------------------

// A scenario saved the way both stores save one: meta fields, worldPatch,
// gamePatch, features and prompts; asset uploads and clears.
const save = (bundle, { patch, uploads, clears }) => {
  const next = structuredClone(bundle);
  const { worldPatch, gamePatch, features, prompts, ...meta } = patch;
  Object.assign(next.scenario, meta);
  if (features) next.scenario.features = features;
  if (worldPatch) next.data.world = { ...next.data.world, ...worldPatch };
  if (gamePatch) next.data.game = { ...next.data.game, ...gamePatch };
  if (prompts) next.data.prompts = prompts;
  for (const upload of uploads) {
    next.assets[upload.key] = upload.json !== undefined
      ? { mode: "embedded", data: upload.json }
      : { mode: "embedded", data: upload.base64, contentType: upload.contentType };
  }
  for (const key of clears) next.assets[key] = { mode: "default" };
  return next;
};
const detailsOf = (bundle) => ({ scenario: bundle.scenario, data: bundle.data });
const coverOf = (snapshot) => (snapshot.cover ? { hash: snapshot.cover.hash, contentType: snapshot.cover.contentType, base64: snapshot.cover.base64 } : null);

// Accepts `change` on `bundle`, then applies its Undo, the way the review
// does: the author's scenario, and the snapshot kept in step with it, are
// what they were. Returns the bundle after the Undo.
const acceptThenUndo = (bundle, change) => {
  const original = buildScenarioSnapshot(bundle);
  const kept = buildScenarioSnapshot(bundle);
  const inverse = inverseOf(change, change.kind === "cover" ? coverOf(kept) : detailValueIn(kept, change));

  const accepted = save(bundle, buildDetailSave([change], detailsOf(bundle)));
  applyToSnapshot(kept, change);
  assert.equal(detailChangeStatus(change, buildScenarioSnapshot(accepted)), "applied", `${change.id}: accepted`);
  assert.equal(detailChangeStatus(change, kept), "applied", `${change.id}: the kept snapshot agrees`);

  const undone = save(accepted, buildDetailSave([inverse], detailsOf(accepted)));
  applyToSnapshot(kept, inverse);
  const after = buildScenarioSnapshot(undone);
  assert.ok(sameValue(detailValueIn(after, change), detailValueIn(original, change)), `${change.id}: undone`);
  assert.ok(sameValue(detailValueIn(kept, change), detailValueIn(original, change)), `${change.id}: the kept snapshot agrees after Undo`);
  return undone;
};

const COVER_OLD = Buffer.from("the author's cover").toString("base64");
const COVER_NEW = Buffer.from("a suggested cover").toString("base64");
const ledger = (byId) => ({ schemaVersion: 1, ledgerVersion: 3, byId });
const NATO = { id: "nato", name: "NATO", members: ["France"] };
const EU = { id: "eu", name: "European Union", members: ["France"] };
const authorBundle = () => ({
  scenario: { name: "Old World", description: "A world.", features: { espionage: { enabled: true } } },
  data: {
    game: { country: "France" },
    world: {
      simulationRules: "No airships.",
      allowedUnitTypes: ["infantry"],
      institutions: ledger({ nato: NATO, eu: EU }),
      agreements: [{ id: "pact", name: "The Pact" }],
    },
    prompts: { promptModel: 2, guidance: { leader: { tone: "Speak plainly." } } },
  },
  assets: {
    cover: { mode: "embedded", data: COVER_OLD, contentType: "image/png" },
    stats: { mode: "embedded", data: { version: 2, sections: [{ id: "economy", stats: [] }] } },
  },
});

test("Undo puts back every kind of field", () => {
  const bundle = authorBundle();
  const fields = [
    { id: "meta:name", path: ["meta", "name"], from: "Old World", to: "New World" },
    { id: "meta:description", path: ["meta", "description"], from: "A world.", to: "A better world." },
    { id: "game:country", path: ["game", "country"], from: "France", to: "Germany" },
    { id: "world:simulationRules", path: ["world", "simulationRules"], from: "No airships.", to: "" },
    { id: "world:allowedUnitTypes", path: ["world", "allowedUnitTypes"], from: ["infantry"], to: ["armor", "infantry"] },
    { id: "features:espionage.enabled", path: ["features", "espionage", "enabled"], from: true, to: false },
    { id: "prompts:advisor.role", path: ["prompts", "advisor", "role"], from: "", to: "A gruff general." },
    { id: "prompts:leader.tone", path: ["prompts", "leader", "tone"], from: "Speak plainly.", to: "" },
  ];
  for (const change of fields) acceptThenUndo(bundle, { area: "details", kind: "field", ...change });
});

test("Undo puts back the stats sheet, the institution logos and the cover", () => {
  const bundle = authorBundle();
  acceptThenUndo(bundle, { id: "stats", area: "details", kind: "stats", from: null, to: { version: 2, sections: [] } });
  acceptThenUndo(bundle, { id: "stats", area: "details", kind: "stats", from: null, to: null });
  acceptThenUndo(bundle, { id: "institutionLogos", area: "details", kind: "institutionLogos", from: null, to: { nato: "data:image/png;base64,AA==" } });
  const undone = acceptThenUndo(bundle, {
    id: "cover", area: "details", kind: "cover", from: null, to: coverOf(buildScenarioSnapshot({ assets: { cover: { mode: "embedded", data: COVER_NEW, contentType: "image/jpeg" } } })),
  });
  assert.equal(undone.assets.cover.data, COVER_OLD, "the author's own image, not only its fingerprint");
  assert.equal(undone.assets.cover.contentType, "image/png");
  acceptThenUndo(bundle, { id: "cover", area: "details", kind: "cover", from: null, to: null });
});

test("Undo of a Politics entry added, removed or changed restores the author's entry", () => {
  const bundle = authorBundle();
  const institution = (entry, op, from, to) => ({
    id: `politics:institutions:${entry}`, area: "details", kind: "politics", field: "institutions", container: "map",
    within: "byId", shell: { schemaVersion: 1, ledgerVersion: 3 }, entry, op, from, to,
  });

  // A removed institution comes back (the Undo used to remove it again).
  const restored = acceptThenUndo(bundle, institution("eu", "remove", EU, null));
  assert.deepEqual(restored.data.world.institutions.byId.eu, EU);

  // An added one goes again, leaving no empty entry behind.
  const un = { id: "un", name: "United Nations" };
  const withoutUn = acceptThenUndo(bundle, institution("un", "add", null, un));
  assert.equal(Object.hasOwn(withoutUn.data.world.institutions.byId, "un"), false);
  assert.deepEqual(Object.keys(withoutUn.data.world.institutions.byId).sort(), ["eu", "nato"]);

  // A changed one, and one "added" that the author already had, go back to the author's.
  acceptThenUndo(bundle, institution("nato", "change", NATO, { ...NATO, members: ["France", "Sweden"] }));
  const authorsOwn = acceptThenUndo(bundle, institution("nato", "add", null, { ...NATO, name: "The Alliance" }));
  assert.deepEqual(authorsOwn.data.world.institutions.byId.nato, NATO);

  // A list: an added agreement goes without leaving a null, a removed one comes back.
  const agreement = (entry, op, from, to) => ({
    id: `politics:agreements:${entry}`, area: "details", kind: "politics", field: "agreements", container: "list", entry, op, from, to,
  });
  const noTreaty = acceptThenUndo(bundle, agreement("treaty", "add", null, { id: "treaty", name: "The Treaty" }));
  assert.deepEqual(noTreaty.data.world.agreements, [{ id: "pact", name: "The Pact" }]);
  const pactBack = acceptThenUndo(bundle, agreement("pact", "remove", { id: "pact", name: "The Pact" }, null));
  assert.deepEqual(pactBack.data.world.agreements, [{ id: "pact", name: "The Pact" }]);
});

// ---- the word diff -------------------------------------------------------------

test("a text change reads word by word, a replaced phrase as one", () => {
  assert.deepEqual(diffWords("The old grey wall", "The new red wall"), [
    { type: "same", text: "The " },
    { type: "del", text: "old grey" },
    { type: "add", text: "new red" },
    { type: "same", text: " wall" },
  ]);
  assert.deepEqual(diffWords("", "Added"), [{ type: "add", text: "Added" }]);
  assert.deepEqual(diffWords("Same text.", "Same text."), [{ type: "same", text: "Same text." }]);
});

test("a text too long to compare word by word shows whole", () => {
  const before = Array.from({ length: 2000 }, (_, i) => `a${i}`).join(" ");
  const after = Array.from({ length: 2000 }, (_, i) => `b${i}`).join(" ");
  assert.deepEqual(diffWords(before, after), [{ type: "del", text: before }, { type: "add", text: after }]);
});
