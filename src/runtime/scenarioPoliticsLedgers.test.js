/*! Open Historia — suggested changes to the Politics ledgers: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioPoliticsLedgers.test.js
//
// The Political World keeps three of its five parts as ledgers: one map of
// records inside a wrapper that carries its format — the political actors and
// the power status by polity, the institutions by id. A suggestion used to
// compare each ledger whole, so one country's edited government came to the
// author as "Political actors changed", the whole ledger at once: nothing said
// which country, and accepting it put the suggester's copy of every country
// over the author's, their own edits since posting included. What has to hold:
//   - each edited country or institution is a change of its own, labelled;
//   - the wrapper's format fields alone are never a change;
//   - an entry's status is measured on that entry, so the author's edit to
//     another country does not make it a conflict;
//   - accepting one entry keeps every other entry and the author's wrapper,
//     and puts a first entry into a ledger the author does not have yet;
//   - a file cannot name a ledger this build does not know, or an unsafe key;
//   - an older file that carries a ledger whole still applies whole;
//   - a player who generates the whole Political World on a downloaded
//     scenario and suggests it gives the author, on Accept all, exactly the
//     world they generated: the canon version too, without which the game
//     ignores the canon context (its divergence and reference packs).

import test from "node:test";
import assert from "node:assert/strict";

import { changedPathsOf, diffScenarioBundles } from "./scenarioChanges.js";
import { buildDetailSave, detailStatuses } from "./suggestionApply.js";
import { normalizeSuggestion, SUGGESTION_SCHEMA } from "./scenarioSuggestion.js";
import { normalizePoliticalActors } from "./politicalActors.js";
import { normalizeInstitutions } from "./institutions.js";
import { materializeScenarioCanon, readScenarioCanon } from "./scenarioCanon.js";
import { initializePoliticalDispositionsForWorld } from "./politicalDisposition.js";
import { buildSuggestion } from "./scenarioSuggestion.js";

const actors = (leaders) => normalizePoliticalActors({
  byPolity: Object.fromEntries(Object.entries(leaders).map(([polity, name]) => [polity, {
    government: { headOfGovernment: { name } },
    regimeType: "parliamentary republic",
  }])),
});
const institutions = (members) => normalizeInstitutions({
  byId: {
    nato: { id: "nato", name: "NATO", members: members.map((polity) => ({ polity, status: "member" })) },
    eu: { id: "eu", name: "European Union" },
  },
}, {});
const powerStatus = (tiers) => ({ schemaVersion: 1, byPolity: Object.fromEntries(Object.entries(tiers).map(([polity, tier]) => [polity, { polityKey: polity, tier }])) });

const world = ({ leaders, members, tiers }) => ({
  politicalActors: actors(leaders),
  institutions: institutions(members),
  powerStatus: powerStatus(tiers),
});
const bundle = (worldData) => ({ scenario: { name: "Europe" }, data: { world: worldData, game: {} }, assets: {} });
const details = (worldData) => ({ scenario: {}, data: { world: worldData } });

const POSTED = world({ leaders: { France: "Macron", Germany: "Scholz" }, members: ["France", "Germany"], tiers: { France: "major", Germany: "major" } });
const SUGGESTED = world({ leaders: { France: "Macron", Germany: "Merz" }, members: ["France", "Germany", "Sweden"], tiers: { France: "great", Germany: "major" } });
const politicsOf = (changes) => changes.filter((change) => change.kind === "politics");

test("one change per edited country or institution, each labelled", () => {
  const changes = politicsOf(diffScenarioBundles(bundle(POSTED), bundle(SUGGESTED)));
  assert.deepEqual(changes.map((change) => change.id).sort(), [
    "politics:institutions:nato",
    "politics:politicalActors:Germany",
    "politics:powerStatus:France",
  ]);
  const germany = changes.find((change) => change.field === "politicalActors");
  assert.equal(germany.container, "map");
  assert.equal(germany.within, "byPolity");
  assert.equal(germany.entry, "Germany");
  assert.equal(germany.label, "Germany");
  assert.equal(germany.op, "change");
  assert.equal(germany.to.government.headOfGovernment.name, "Merz");
  assert.equal(germany.from.government.headOfGovernment.name, "Scholz");
  assert.equal(changes.find((change) => change.field === "institutions").label, "NATO");
  assert.equal(changes.find((change) => change.field === "institutions").within, "byId");
});

test("a country added or removed is one change; the format fields alone are none", () => {
  const added = politicsOf(diffScenarioBundles(bundle(POSTED), bundle({ ...POSTED, politicalActors: actors({ France: "Macron", Germany: "Scholz", Italy: "Meloni" }) })));
  assert.deepEqual(added.map((change) => [change.id, change.op]), [["politics:politicalActors:Italy", "add"]]);
  const removed = politicsOf(diffScenarioBundles(bundle(POSTED), bundle({ ...POSTED, politicalActors: actors({ France: "Macron" }) })));
  assert.deepEqual(removed.map((change) => [change.id, change.op]), [["politics:politicalActors:Germany", "remove"]]);
  const reformatted = { ...POSTED, institutions: { ...POSTED.institutions, ledgerVersion: 7 } };
  assert.deepEqual(politicsOf(diffScenarioBundles(bundle(POSTED), bundle(reformatted))), []);
});

test("a first ledger is diffed entry by entry too", () => {
  const changes = politicsOf(diffScenarioBundles(bundle({}), bundle({ politicalActors: actors({ France: "Macron" }) })));
  assert.deepEqual(changes.map((change) => [change.id, change.op, change.within]), [["politics:politicalActors:France", "add", "byPolity"]]);
  assert.equal(changes[0].shell.schemaVersion, actors({}).schemaVersion, "the wrapper to put it in");
});

test("an entry's status is its own: the author's edit elsewhere is no conflict", () => {
  const changes = politicsOf(diffScenarioBundles(bundle(POSTED), bundle(SUGGESTED)));
  const germany = changes.find((change) => change.id === "politics:politicalActors:Germany");
  // The author changed France's leader since posting, not Germany's.
  const authorNow = { ...POSTED, politicalActors: actors({ France: "Attal", Germany: "Scholz" }) };
  assert.equal(detailStatuses([germany], bundle(authorNow))[germany.id], "open");
  const authorEditedGermany = { ...POSTED, politicalActors: actors({ France: "Macron", Germany: "Pistorius" }) };
  assert.equal(detailStatuses([germany], bundle(authorEditedGermany))[germany.id], "conflict");
  assert.equal(detailStatuses([germany], bundle(SUGGESTED))[germany.id], "applied");
});

test("accepting one entry keeps every other entry and the author's wrapper", () => {
  const changes = politicsOf(diffScenarioBundles(bundle(POSTED), bundle(SUGGESTED)));
  const germany = changes.find((change) => change.id === "politics:politicalActors:Germany");
  const authorNow = { ...POSTED, politicalActors: actors({ France: "Attal", Germany: "Scholz" }) };
  const { patch } = buildDetailSave([germany], details(authorNow));
  const saved = patch.worldPatch.politicalActors;
  assert.equal(saved.byPolity.Germany.government.headOfGovernment.name, "Merz", "the suggestion");
  assert.equal(saved.byPolity.France.government.headOfGovernment.name, "Attal", "the author's own edit, kept");
  assert.equal(saved.schemaVersion, authorNow.politicalActors.schemaVersion);
  assert.deepEqual(Object.keys(patch.worldPatch), ["politicalActors"], "nothing else is touched");

  const nato = changes.find((change) => change.id === "politics:institutions:nato");
  const withNato = buildDetailSave([nato], details({ ...POSTED, institutions: { ...POSTED.institutions, ledgerVersion: 3 } })).patch.worldPatch.institutions;
  assert.equal(withNato.ledgerVersion, 3, "a format counter never goes back");
  assert.ok(withNato.byId.eu, "the other institution is kept");
  assert.deepEqual(withNato.byId.nato, nato.to);
});

test("removing one entry removes only it; a first entry makes the ledger", () => {
  const removal = politicsOf(diffScenarioBundles(bundle(POSTED), bundle({ ...POSTED, politicalActors: actors({ France: "Macron" }) })))[0];
  const afterRemoval = buildDetailSave([removal], details(POSTED)).patch.worldPatch.politicalActors;
  assert.deepEqual(Object.keys(afterRemoval.byPolity), ["France"]);
  const first = politicsOf(diffScenarioBundles(bundle({}), bundle({ politicalActors: actors({ France: "Macron" }) })))[0];
  const created = buildDetailSave([first], details({})).patch.worldPatch.politicalActors;
  assert.deepEqual(created, actors({ France: "Macron" }));
});

test("a file cannot name an unknown ledger or an unsafe key", () => {
  const change = (overrides) => ({ id: `politics:x:${JSON.stringify(overrides)}`, area: "details", kind: "politics", field: "politicalActors", container: "map", entry: "France", op: "change", to: {}, ...overrides });
  const suggestion = normalizeSuggestion({
    schema: SUGGESTION_SCHEMA,
    changes: [
      change({ within: "byPolity" }),
      change({ within: "__proto__" }),
      change({ within: "byPolity", entry: "__proto__" }),
      change({ within: "byPolity", entry: "constructor" }),
      change({}),
    ],
  });
  assert.deepEqual(suggestion.changes.map((entry) => [entry.within, entry.entry]), [["byPolity", "France"], [undefined, "France"]]);
});

test("an older file that carries a ledger whole still applies whole", () => {
  const whole = { id: "politics:politicalActors", area: "details", kind: "politics", field: "politicalActors", container: "value", entry: null, from: POSTED.politicalActors, to: SUGGESTED.politicalActors };
  assert.deepEqual(buildDetailSave([whole], details(POSTED)).patch.worldPatch.politicalActors, SUGGESTED.politicalActors);
  assert.equal(detailStatuses([whole], bundle(POSTED))[whole.id], "open");
});

test("what changed inside an entry, by path", () => {
  const changes = politicsOf(diffScenarioBundles(bundle(POSTED), bundle(SUGGESTED)));
  const germany = changes.find((change) => change.id === "politics:politicalActors:Germany");
  assert.deepEqual(changedPathsOf(germany.from, germany.to), [{ path: "government.headOfGovernment.name", from: "Scholz", to: "Merz" }]);
  const many = changedPathsOf({ a: 1, b: 2, c: 3, d: { e: 4 } }, { a: 2, b: 3, c: 4, d: { e: 5 } }, { max: 2 });
  assert.equal(many.length, 3, "stops one past the limit, so a caller can say there is more");
  assert.deepEqual(changedPathsOf({ list: [1, 2] }, { list: [1, 3] }), [{ path: "list", from: [1, 2], to: [1, 3] }], "a list compared whole");
  assert.deepEqual(changedPathsOf({}, { divergence: { description: "Rome never fell." } }), [{ path: "divergence.description", from: null, to: "Rome never fell." }], "a new record, field by field");
  assert.deepEqual(changedPathsOf({ divergence: { description: "x" } }, { divergence: "none" }), [{ path: "divergence", from: { description: "x" }, to: "none" }], "a record become a value, whole");
});

// What the Politics tab's Apply writes (politicalWorldV2/pipeline.js
// applyPoliticalWorldV2Checkpoint) on a scenario that never had one.
const generate = (world) => initializePoliticalDispositionsForWorld(materializeScenarioCanon(world, {
  canonContext: { universe: { id: "alt", type: "alternate-history" }, divergence: { description: "Rome never fell." } },
  politicalActors: actors({ France: "Macron", Germany: "Scholz" }),
  institutions: institutions(["France", "Germany"]),
  agreements: [{ id: "elysee", name: "Elysee Treaty", parties: ["France", "Germany"] }],
  powerStatus: powerStatus({ France: "great" }),
}), { updatedAt: "2024-01-01" }).world;
const MAP_ONLY = { regionOwnershipOverrides: { "fra-1": "France", "deu-1": "Germany" }, polityOverrides: {} };

test("a generated Political World, suggested and accepted whole, is the author's exactly", () => {
  const generated = generate(MAP_ONLY);
  const suggestion = buildSuggestion({ changes: diffScenarioBundles(bundle(MAP_ONLY), bundle(generated)), scenario: { name: "Europe" }, origin: { postId: 1 } });
  assert.deepEqual(suggestion.changes.map((change) => change.id).sort(), [
    "politics:agreements:elysee",
    "politics:canonContext",
    "politics:institutions:eu",
    "politics:institutions:nato",
    "politics:politicalActors:France",
    "politics:politicalActors:Germany",
    "politics:powerStatus:France",
  ]);
  const statuses = detailStatuses(suggestion.changes, bundle(MAP_ONLY));
  assert.ok(Object.values(statuses).every((status) => status === "open"));
  const { patch } = buildDetailSave(suggestion.changes, details(MAP_ONLY));
  const accepted = { ...MAP_ONLY, ...patch.worldPatch };
  assert.deepEqual(accepted, generated, "every key, the canon version included");
  assert.equal(readScenarioCanon(accepted).initialized, true);
  assert.equal(readScenarioCanon(accepted).canonContext.divergence.description, "Rome never fell.", "the divergence is read");
  assert.ok(Object.values(detailStatuses(suggestion.changes, bundle(accepted))).every((status) => status === "applied"));
});

test("a canon context the game ignores is no canon: generating one is a change", () => {
  // A scenario carrying a stale context without the canon version.
  const stale = { ...MAP_ONLY, canonContext: generate(MAP_ONLY).canonContext };
  const changes = politicsOf(diffScenarioBundles(bundle(stale), bundle(generate(stale))));
  const canon = changes.find((change) => change.id === "politics:canonContext");
  assert.ok(canon, "offered, though the context itself is the same");
  assert.equal(canon.from, null);
  const accepted = { ...stale, ...buildDetailSave([canon], details(stale)).patch.worldPatch };
  assert.equal(readScenarioCanon(accepted).initialized, true);
});

test("accepting a country without the canon leaves the author's canon as it was", () => {
  const generated = generate(MAP_ONLY);
  const france = politicsOf(diffScenarioBundles(bundle(MAP_ONLY), bundle(generated))).find((change) => change.id === "politics:politicalActors:France");
  const { patch } = buildDetailSave([france], details(MAP_ONLY));
  assert.equal("canonModelVersion" in patch.worldPatch, false);
});
