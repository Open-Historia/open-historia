import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateTerritorialEconomy,
  captureCountryStatsHistory,
  countryStatsTrackingMonthsElapsed,
  finalizeCountryStatSheet,
  guardCountryStatContinuity,
  mergeCountryStatPatch,
  normalizeCountryStatSheet,
  normalizeCountryStatsTracking,
  parseStatNumber,
} from "../src/runtime/countryStats.js";

const ledger = () => [
  { geography: "Mainland", group: "core", population: 1000, gdpPerCapita: 50 },
  { geography: "Island", group: "overseas/dependent", population: 100, gdpPerCapita: 20 },
];

test("parseStatNumber accepts the number forms old saves and prompts produce", () => {
  assert.equal(parseStatNumber("$48.5B"), 48.5e9);
  assert.equal(parseStatNumber("1,200,000"), 1200000);
  assert.equal(parseStatNumber("850 million"), 850e6);
  assert.equal(parseStatNumber("1.2 trillion"), 1.2e12);
  assert.equal(parseStatNumber("−3.5%"), -3.5);
  assert.equal(parseStatNumber(""), null);
  assert.equal(parseStatNumber("abc"), null);
  assert.equal(parseStatNumber(Number.NaN), null);
});

test("territorial aggregation splits core and overseas rows and drops unusable rows", () => {
  const aggregate = aggregateTerritorialEconomy([
    ...ledger(),
    { geography: "Ghost", group: "core", population: -5, gdpPerCapita: 50 },
    { geography: "Idle", group: "core", population: 10, gdpPerCapita: 0 },
    { geography: "Elsewhere", group: "colony", population: 10, gdpPerCapita: 5 },
    { geography: "", group: "core", population: 10, gdpPerCapita: 5 },
  ]);

  assert.equal(aggregate.population, 1100);
  assert.equal(aggregate.gdp, 52000);
  assert.ok(Math.abs(aggregate.gdpPerCapita - 52000 / 1100) < 1e-9);
  assert.equal(aggregate.corePopulation, 1000);
  assert.equal(aggregate.otherPopulation, 100);
  assert.equal(aggregate.coreGdp, 50000);
  assert.equal(aggregate.otherGdp, 2000);
  assert.equal(aggregate.coreGdpPerCapita, 50);
  assert.equal(aggregate.otherGdpPerCapita, 20);
});

test("territorial aggregation keeps every live-map component and lets the latest duplicate win", () => {
  assert.equal(aggregateTerritorialEconomy([]), null);
  assert.equal(aggregateTerritorialEconomy("nonsense"), null);

  const duplicated = aggregateTerritorialEconomy([
    { geography: "Mainland", group: "core", population: 1000, gdpPerCapita: 50 },
    { geography: " mainland ", group: "core", population: 2000, gdpPerCapita: 50 },
  ]);
  assert.equal(duplicated.population, 2000);

  const many = Array.from({ length: 300 }, (_, index) => ({
    geography: `Province ${index + 1}`,
    group: "core",
    population: 1,
    gdpPerCapita: 10,
  }));
  assert.equal(aggregateTerritorialEconomy(many).population, 300);
});

test("finalising a sheet makes the component ledger the arithmetic authority", () => {
  const sheet = finalizeCountryStatSheet({
    capital: " Paris ",
    stability: "72.4",
    indices: { sovereignty: 101, foodAutonomy: "88%", bogus: 5 },
    gdpBreakdown: { agriculture: 20, industry: 40, services: 39 },
    population: { total: 5 },
    economy: { gdp: "1 trillion", gdpGrowth: 2.5, currency: "EUR" },
    territorialComponents: ledger(),
  });

  assert.equal(sheet.capital, "Paris");
  assert.equal(sheet.stability, 72);
  assert.deepEqual(sheet.indices, { sovereignty: 100, foodAutonomy: 88 });
  assert.deepEqual(sheet.gdpBreakdown, { agriculture: 20, industry: 41, services: 39 });
  assert.deepEqual(sheet.population, { total: 1100, coreIntegrated: 1000, otherTerritories: 100 });
  assert.equal(sheet.economy.gdp, 52000);
  assert.equal(sheet.economy.gdpPerCapita, 47.27);
  assert.equal(sheet.economy.coreGdpPerCapita, 50);
  assert.equal(sheet.economy.otherGdpPerCapita, 20);
  assert.equal(sheet.economy.gdpGrowth, 2.5);
  assert.equal(sheet.economy.currency, "EUR");
  assert.equal(sheet.statsSchemaVersion, 1);
});

test("legacy sheets without a ledger stay readable with their declared totals", () => {
  const legacy = normalizeCountryStatSheet({
    stability: 50,
    population: { total: "67 million" },
    economy: { gdp: "$2.8 trillion", inflation: "1.9%" },
  });

  assert.equal(legacy.population.total, 67e6);
  assert.equal(legacy.economy.gdp, 2.8e12);
  assert.equal(legacy.economy.inflation, 1.9);
  assert.equal(legacy.statsSchemaVersion, 0);
  assert.equal(normalizeCountryStatSheet(null), null);
  assert.equal(normalizeCountryStatSheet("text"), null);
  assert.equal(finalizeCountryStatSheet({ population: { total: 5 } }).statsSchemaVersion, 0);
});

test("a stat patch scales the ledger to aggregate targets and records event continuity", () => {
  const base = {
    leader: "Old Leader",
    indices: { sovereignty: 90 },
    continuity: { accountedEventIds: ["event-a"] },
    territorialComponents: ledger(),
  };

  const merged = mergeCountryStatPatch(
    base,
    { population: { total: 2200 }, indices: { internalSecurity: 60 }, leader: "New Leader" },
    { continuity: { accountedEventIds: ["event-b", "event-a"] } },
  );

  assert.deepEqual(
    merged.territorialComponents.map((component) => component.population),
    [2000, 200],
  );
  assert.equal(merged.population.total, 2200);
  assert.deepEqual(merged.indices, { sovereignty: 90, internalSecurity: 60 });
  assert.equal(merged.leader, "New Leader");
  assert.deepEqual(merged.continuity.accountedEventIds, ["event-a", "event-b"]);
  assert.equal(base.territorialComponents[0].population, 1000, "the base sheet is not mutated");

  const richer = mergeCountryStatPatch(base, { economy: { gdp: 104000 } });
  assert.deepEqual(richer.territorialComponents.map((component) => component.gdpPerCapita), [100, 40]);
  assert.equal(richer.economy.gdp, 104000);
  assert.equal(richer.economy.gdpPerCapita, 94.55);

  const coreOnly = mergeCountryStatPatch(base, { population: { coreIntegrated: 500 } });
  assert.deepEqual(coreOnly.population, { total: 600, coreIntegrated: 500, otherTerritories: 100 });
});

test("a stat patch merges component rows by geography unless replacement is requested", () => {
  const base = { territorialComponents: ledger() };
  const row = { geography: "Mainland", group: "core", population: 3000, gdpPerCapita: 50 };

  const merged = mergeCountryStatPatch(base, { territorialComponents: [row] });
  assert.equal(merged.population.total, 3100);

  const replaced = mergeCountryStatPatch(base, { territorialComponents: [row] }, { replaceComponents: true });
  assert.deepEqual(replaced.population, { total: 3000, coreIntegrated: 3000, otherTerritories: 0 });

  const legacy = mergeCountryStatPatch(
    { population: { total: 5000000 }, economy: { gdp: 1e9 } },
    { population: { total: 6000000 } },
  );
  assert.equal(legacy.population.total, 6000000);
  assert.equal(legacy.economy.gdp, 1e9);
});

test("the continuity guard restores unexplained re-baselining of surviving components and macro rates", () => {
  const previous = {
    territorialComponents: ledger(),
    economy: { gdpGrowth: 2, inflation: 3, unemployment: 5, publicDebt: 60, budgetBalance: -2 },
  };
  const candidate = {
    territorialComponents: [
      { geography: "Mainland", group: "core", population: 3000, gdpPerCapita: 50 },
      { geography: "Island", group: "overseas/dependent", population: 100, gdpPerCapita: 45 },
    ],
    economy: { gdpGrowth: 12, inflation: 3, unemployment: 5, publicDebt: 60, budgetBalance: -2 },
  };

  const guarded = guardCountryStatContinuity(previous, candidate, { elapsedYears: 0 });
  const restoredFields = guarded.restored.map((entry) => `${entry.geography}:${entry.field}`).sort();
  assert.deepEqual(restoredFields, ["Island:gdpPerCapita", "Mainland:population", "whole polity:gdpGrowth"]);
  assert.equal(guarded.sheet.population.total, 1100);
  assert.equal(guarded.sheet.economy.gdpGrowth, 2);
  assert.equal(guarded.sheet.economy.otherGdpPerCapita, 20);
});

test("the continuity guard honours specific evidence, elapsed time and territorial change", () => {
  const previous = { territorialComponents: ledger(), economy: { gdpGrowth: 2 } };
  const candidate = {
    territorialComponents: [
      { geography: "Mainland", group: "core", population: 3000, gdpPerCapita: 50 },
      { geography: "Island", group: "overseas/dependent", population: 100, gdpPerCapita: 45 },
    ],
    economy: { gdpGrowth: 12 },
  };

  const evidenced = guardCountryStatContinuity(previous, candidate, {
    elapsedYears: 0,
    evidenceText: "Mainland absorbed a massive migration wave this spring.",
  });
  assert.equal(evidenced.sheet.population.coreIntegrated, 3000, "a geography named in the evidence may move");
  assert.equal(evidenced.sheet.economy.gdpGrowth, 12, "fresh evidence unlocks the macro rates");
  assert.deepEqual(evidenced.restored.map((entry) => entry.field), ["gdpPerCapita"]);

  const modest = {
    territorialComponents: [{ geography: "Mainland", group: "core", population: 1700, gdpPerCapita: 50 }],
  };
  assert.equal(guardCountryStatContinuity(previous, modest).sheet.population.total, 1000);
  assert.equal(
    guardCountryStatContinuity(previous, modest, { territoryChanged: true }).sheet.population.total,
    1700,
  );
  assert.equal(
    guardCountryStatContinuity(previous, modest, { elapsedYears: 10 }).sheet.population.total,
    1700,
  );

  const fresh = guardCountryStatContinuity(undefined, candidate);
  assert.deepEqual(fresh.restored, []);
  assert.equal(fresh.sheet.population.total, 3100);
});

test("history capture samples every existing sheet once per date without generating stats", () => {
  const world = {
    countryStats: {
      Alpha: { territorialComponents: ledger(), stability: 55, indices: { sovereignty: 80 } },
      Beta: { stability: 40 },
      Gamma: { capital: "Nowhere" },
    },
    countryStatsHistory: {
      Alpha: [{ date: "2014-01-01", round: 1, stability: 10 }],
    },
  };

  const once = captureCountryStatsHistory(world, { date: "2014-02-01", round: 2 });
  assert.deepEqual(Object.keys(once.countryStatsHistory).sort(), ["Alpha", "Beta"]);
  assert.deepEqual(once.countryStatsHistory.Alpha.map((sample) => sample.date), ["2014-01-01", "2014-02-01"]);
  const latest = once.countryStatsHistory.Alpha[1];
  assert.equal(latest.round, 2);
  assert.equal(latest.stability, 55);
  assert.equal(latest.sovereignty, 80);
  assert.equal(latest.population, 1100);
  assert.equal(latest.gdp, 52000);
  assert.equal(once.countryStatsHistory.Beta[0].stability, 40);
  assert.equal(world.countryStatsHistory.Alpha.length, 1, "the input world is not mutated");

  const twice = captureCountryStatsHistory(
    { ...once, countryStats: { ...once.countryStats, Alpha: { ...once.countryStats.Alpha, stability: 60 } } },
    { date: "2014-02-01", round: 2 },
  );
  assert.equal(twice.countryStatsHistory.Alpha.length, 2, "a repeated date replaces the sample");
  assert.equal(twice.countryStatsHistory.Alpha[1].stability, 60);

  assert.equal(captureCountryStatsHistory(world, { date: "not a date" }).countryStatsHistory.Alpha.length, 1);
  assert.equal(captureCountryStatsHistory(null), null);
});

test("tracking settings are bounded and the player joins the tracked list only with an interval", () => {
  const manual = normalizeCountryStatsTracking({
    intervalMonths: 5,
    trackedPolities: ["France", "france", " Spain "],
    lastAutoRefreshByPolity: { France: "2014-01-01", Italy: "2014-01-01", Spain: "bad" },
    pendingBaselinePolities: ["Spain", "Italy"],
    lastBatchDate: "2014-02-01",
  }, { playerCountry: "Germany" });

  assert.equal(manual.intervalMonths, 0, "an interval outside the allowed set means manual only");
  assert.deepEqual(manual.trackedPolities, ["France", "Spain"]);
  assert.deepEqual(manual.lastAutoRefreshByPolity, { France: "2014-01-01" });
  assert.deepEqual(manual.pendingBaselinePolities, ["Spain"]);
  assert.equal(manual.lastBatchDate, "2014-02-01");

  const scheduled = normalizeCountryStatsTracking(
    { intervalMonths: 6, trackedPolities: Array.from({ length: 10 }, (_, index) => `Polity ${index}`) },
    { playerCountry: "Germany" },
  );
  assert.equal(scheduled.intervalMonths, 6);
  assert.equal(scheduled.trackedPolities[0], "Germany");
  assert.equal(scheduled.trackedPolities.length, 8);

  assert.equal(countryStatsTrackingMonthsElapsed("2014-01-15", "2014-04-14"), 2);
  assert.equal(countryStatsTrackingMonthsElapsed("2014-01-15", "2014-04-15"), 3);
  assert.equal(countryStatsTrackingMonthsElapsed("2014-01-15", "bad"), 0);
});
