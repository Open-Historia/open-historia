import test from "node:test";
import assert from "node:assert/strict";
import { recordNativeWarOrigins, statOrigin, statNumericValues, normalizeStatProvenance, mergeStatProvenance, provenanceForStat, seedScenarioStatProvenance, packStatProvenance, recordExternalStatOrigin } from "./statProvenance.js";
import { mergeCountryStatPatch, buildCountryStatHistorySample, normalizeCountryStatHistorySample, normalizeCountryStatSheet, describeCountryStatsForAdvisor, appendCountryStatHistorySample } from "../src/runtime/countryStats.js";
import { normalizeWorldState, applyCountryStatPatchToWorld, applyEventImpactsToWorld } from "../src/runtime/gameState.js";

const origin = { source: "ai", date: "1200-01-01", round: 1 };

test("origins preserve zero and exclude absent, invalid and unsupported fields", () => {
  assert.deepEqual(statNumericValues({ stability: 0, population: { total: "12" }, economy: { currency: "marks" }, customStats: { grain: null, gold: false } }), { stability: 0, "population.total": 12 });
  const meta = normalizeStatProvenance({ stability: { ...origin, value: 0 }, "customStats.grain": { source: "historically-verified", value: 12 }, arbitrary: { ...origin, value: 5 } });
  assert.deepEqual(meta, { stability: { ...origin, value: 0 } });
  assert.equal(provenanceForStat(meta, "stability", 0)?.source, "ai");
  assert.equal(provenanceForStat(meta, "stability", 1), null);
  assert.equal(provenanceForStat(meta, "stability", null), null);
});

test("only accepted changed values get a new origin; untouched values keep theirs", () => {
  const base = mergeCountryStatPatch(null, { customStats: { grain: 12, silver: 0 }, stability: 70 }, { origin });
  const next = mergeCountryStatPatch(base, { customStats: { grain: 18, silver: 0 } }, { origin: { source: "manual", date: "1200-02-01", round: 2 } });
  assert.equal(next.statProvenance["customStats.grain"].source, "manual");
  assert.deepEqual(next.statProvenance["customStats.silver"], base.statProvenance["customStats.silver"]);
  assert.deepEqual(next.statProvenance.stability, base.statProvenance.stability);
  const unknown = mergeCountryStatPatch(next, { customStats: { grain: 24 } });
  assert.equal(unknown.statProvenance["customStats.grain"], undefined);
  assert.equal(unknown.statProvenance.stability.source, "ai");
  assert.equal(mergeStatProvenance({}, {}, {}, { source: "historically-verified" }), undefined);
});

test("rejected or clamped aggregate patches cannot claim an unaccepted value", () => {
  const base = mergeCountryStatPatch(null, { territorialComponents: [{ geography: "Realm", group: "core", population: 1000, gdpPerCapita: 50 }], stability: 70 }, { origin });
  const rejected = mergeCountryStatPatch(base, { economy: { gdp: 1e16 } }, { origin: { source: "manual", round: 2 }, maxAggregateRescale: 10 });
  assert.equal(rejected.economy.gdp, base.economy.gdp);
  assert.deepEqual(rejected.statProvenance["economy.gdp"], base.statProvenance["economy.gdp"]);
  const clamped = mergeCountryStatPatch(base, { stability: 200 }, { origin: { source: "manual" } });
  assert.equal(clamped.statProvenance.stability.value, 100);
});

test("legacy data stays unspecified and changed stored values invalidate old labels", () => {
  assert.equal(normalizeCountryStatSheet({ stability: 50 }).statProvenance, undefined);
  const old = mergeCountryStatPatch(null, { customStats: { grain: 12 } }, { origin });
  const changed = { ...old, customStats: { grain: 18 } };
  assert.equal(provenanceForStat(normalizeCountryStatSheet(changed).statProvenance, "customStats.grain", 18), null);
});

test("new-game scenario origins survive JSON persistence without modifying the scenario", () => {
  const world = { countryStats: { Realm: { customStats: { grain: 0 }, population: { total: 1000 }, economy: { gdp: 50000 } } }, intelligence: { Realm: 35 }, polityOverrides: { Realm: { military: { quality: 60 } } } };
  const original = JSON.stringify(world);
  const seeded = seedScenarioStatProvenance(world, { gameDate: "-0218-03-01", round: 0 });
  assert.equal(JSON.stringify(world), original);
  const reloaded = normalizeWorldState(JSON.parse(JSON.stringify(seeded)));
  assert.equal(reloaded.countryStats.Realm.statProvenance["customStats.grain"].source, "scenario");
  assert.equal(reloaded.countryStats.Realm.statProvenance["military.quality"].source, "scenario");
  assert.equal(reloaded.countryStats.Realm.statProvenance.intelligenceService.date, "-0218-03-01");
});

test("history freezes and shares origins without duplicating input values", () => {
  const sheet = mergeCountryStatPatch(null, { stability: 70, customStats: { grain: 12 }, population: { total: 1000 }, economy: { gdp: 50000 } }, { origin });
  const snapshot = buildCountryStatHistorySample(sheet, { date: "1200-01-01", round: 1 });
  assert.equal(snapshot.statProvenance.origins.length, 1);
  assert.equal(Object.hasOwn(snapshot.statProvenance.origins[0], "value"), false);
  const loaded = normalizeCountryStatHistorySample(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(loaded, snapshot);
  assert.equal(provenanceForStat(loaded.statProvenance, "customStats.grain", loaded.customStats.grain)?.source, "ai");
  const later = mergeCountryStatPatch(sheet, { customStats: { grain: 18 } }, { origin: { source: "manual", round: 2 } });
  assert.equal(provenanceForStat(snapshot.statProvenance, "customStats.grain", snapshot.customStats.grain)?.source, "ai");
  assert.equal(later.statProvenance["customStats.grain"].source, "manual");
  assert.equal(packStatProvenance({ origins: [{ source: "ai" }], fields: { stability: -1 } }, { stability: 70 }), undefined);
});

test("a metadata-only intelligence record is not a statistical history reading", () => {
  const world = {};
  recordExternalStatOrigin(world, "Realm", 40, origin);
  assert.equal(buildCountryStatHistorySample(world.countryStats.Realm, { date: "1200-01-01", round: 1 }), null);
  assert.equal(provenanceForStat(world.countryStats.Realm.statProvenance, "intelligenceService", 40)?.source, "ai");
});

test("unchanged values do not grow history or change recorded origins on a new turn", () => {
  const sheet = mergeCountryStatPatch(null, { stability: 70 }, { origin });
  let history = appendCountryStatHistorySample({}, "Realm", sheet, { date: "1200-01-01", round: 1 });
  const unchanged = mergeCountryStatPatch(sheet, { stability: 70 }, { origin: { source: "ai", date: "1200-02-01", round: 2 } });
  history = appendCountryStatHistorySample(history, "Realm", unchanged, { date: "1200-02-01", round: 2 });
  assert.equal(history.Realm.length, 1);
});

test("event changes use the canonical merge and engine-known AI attribution", () => {
  const world = normalizeWorldState({ countryStats: { Realm: { stability: 70 } }, polityOverrides: { Realm: { name: "Realm" } } });
  applyCountryStatPatchToWorld(world, "Realm", { stability: 65 }, { origin });
  assert.equal(world.countryStats.Realm.statProvenance.stability.source, "ai");
  const result = applyEventImpactsToWorld({ world, colors: {}, events: [{ id: "e1", date: "1200-02-01", title: "Change", description: "An event", impacts: { polityChanges: [{ operation: "update", code: "Realm", intelligence: 50, stats: { stability: 60 } }] } }] });
  assert.equal(result.world.countryStats.Realm.stability, 60);
  assert.equal(result.world.countryStats.Realm.statProvenance.stability.source, "ai");
  assert.equal(result.world.countryStats.Realm.statProvenance.stability.date, "1200-02-01");
  assert.equal(result.world.countryStats.Realm.statProvenance.intelligenceService.date, "1200-02-01");
  const unchanged = applyEventImpactsToWorld({ world: result.world, events: [{ id: "e2", date: "1200-03-01", title: "Unchanged rating", description: "No change", impacts: { polityChanges: [{ code: "Realm", intelligence: 50 }] } }] });
  assert.equal(unchanged.world.countryStats.Realm.statProvenance.intelligenceService.date, "1200-02-01");
});

test("advisor origins describe authorship without claiming historical verification", () => {
  const sheet = mergeCountryStatPatch(null, { stability: 70 }, { origin });
  const text = describeCountryStatsForAdvisor(sheet);
  assert.match(text, /NOT historical verification/);
  assert.match(text, /unspecified sources/);
});

test("historical source dates validate calendar dates without inventing a timestamp", () => {
  for (const date of ["1200-02-30", "0000-01-01", "1200-13-01", "1200-00-01", "1200-01-00", "unknown"]) {
    assert.deepEqual(statOrigin("ai", { date }), { source: "ai" });
  }
  assert.equal(statOrigin("manual", { date: "-0001-02-29", round: 0 }).date, "-0001-02-29");
});

test("compact legacy history still preserves flat strategic indices", () => {
  const sample = normalizeCountryStatHistorySample({ date: "1200-01-01", round: 1, sovereignty: 60 });
  assert.equal(sample.sovereignty, 60);
});

test("native war origins follow actual changes, including a return to full resources", () => {
  const before = { warWeariness: [{ country: "Realm", value: 20 }], warResources: [{ country: "Realm", value: 50 }] };
  assert.equal(recordNativeWarOrigins(before, before, { date: "1200-01-01" }), before);
  const after = { warWeariness: [{ country: "Realm", value: 15 }], warResources: [] };
  const next = recordNativeWarOrigins(before, after, { date: "1200-02-01", round: 2 });
  assert.equal(after.countryStats, undefined, "the input world is not mutated");
  assert.equal(next.countryStats.Realm.statProvenance.warWeariness.source, "calculated");
  assert.equal(next.countryStats.Realm.statProvenance.warResources.value, 100);
});

test("unusual polity names remain own data keys rather than changing a map prototype", () => {
  const world = JSON.parse('{"intelligence":{"__proto__":35},"countryStats":{}}');
  const seeded = seedScenarioStatProvenance(world, { gameDate: "1200-01-01", round: 0 });
  assert.equal(Object.getPrototypeOf(seeded.countryStats), Object.prototype);
  assert.equal(Object.hasOwn(seeded.countryStats, "__proto__"), true);
  assert.equal(seeded.countryStats["__proto__"].statProvenance.intelligenceService.source, "scenario");
  const next = {};
  recordExternalStatOrigin(next, "__proto__", 50, origin);
  assert.equal(Object.getPrototypeOf(next.countryStats), Object.prototype);
  assert.equal(Object.hasOwn(next.countryStats, "__proto__"), true);
});
