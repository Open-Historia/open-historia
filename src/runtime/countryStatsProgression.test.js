import test from "node:test";
import assert from "node:assert/strict";
import { advanceCountryStatsInterval } from "./countryStatsProgression.js";
import { aggregateTerritorialEconomy, normalizeCountryStatSheet } from "./countryStats.js";

const country = (growth = 3, demographics = 1) => normalizeCountryStatSheet({
  territorialComponents: [
    { geography: "Core", group: "core", population: 1_000_000, gdpPerCapita: 20_000 },
    { geography: "Island", group: "overseas/dependent", population: 100_000, gdpPerCapita: 10_000 },
  ],
  population: { annualGrowthRate: demographics },
  economy: { gdpGrowth: growth, currency: "2026 USD" },
});

const settle = (sheets, fromDate, toDate) =>
  advanceCountryStatsInterval(sheets, { fromDate, toDate });

const closeTo = (actual, expected, relative = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * relative), `${actual} differs from ${expected}`);

test("interim GDP, demographics and GDP/capita advance together on a valid component ledger", () => {
  const base = country(3, 1);
  const result = settle({ A: base }, "2026-01-01", "2027-01-01");
  const next = result.countryStats.A;
  assert.ok(next.economy.gdp > base.economy.gdp);
  assert.ok(next.population.total > base.population.total);
  closeTo(next.economy.gdp, base.economy.gdp * 1.03);
  closeTo(next.population.total, base.population.total * 1.01);
  assert.equal(next.economy.gdpPerCapita, Math.round(next.economy.gdp / next.population.total * 100) / 100);
  assert.equal(next.population.annualGrowthRate, 1);
  assert.equal(next.continuity.lastProgressedDate, "2027-01-01");
});

test("one long jump and twelve shorter jumps agree within bounded national ledger rounding", () => {
  const base = country(2.5, -0.6);
  const dates = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"];
  const long = settle({ A: base }, dates[0], dates.at(-1)).countryStats.A;
  let short = { A: base };
  for (let i = 1; i < dates.length; i += 1) short = settle(short, dates[i - 1], dates[i]).countryStats;
  closeTo(short.A.economy.gdp, long.economy.gdp, 3e-4);
  assert.ok(Math.abs(short.A.population.total - long.population.total) <= 2);
  closeTo(short.A.economy.gdpPerCapita, long.economy.gdpPerCapita, 3e-4);
});

test("same-date replay, overlapping interval and backward time never compound growth twice", () => {
  const first = settle({ A: country() }, "2026-01-01", "2026-03-01").countryStats;
  const same = settle(first, "2026-01-01", "2026-03-01").countryStats;
  const backwards = settle(first, "2026-03-01", "2026-02-01").countryStats;
  assert.deepEqual(same, first);
  assert.deepEqual(backwards, first);
  const next = settle(first, "2026-01-01", "2026-04-01").countryStats;
  const proper = settle(first, "2026-03-01", "2026-04-01").countryStats;
  assert.deepEqual(next, proper);
});

test("missing population trend keeps demographics unchanged while GDP moves", () => {
  const base = country(4, undefined);
  delete base.population.annualGrowthRate;
  const next = settle({ A: base }, "2026-01-01", "2027-01-01").countryStats.A;
  assert.equal(next.population.total, base.population.total);
  assert.ok(next.economy.gdp > base.economy.gdp);
});

test("explicit negative demographic trend and declining GDP both decrease without inventing economic effects", () => {
  const base = country(-2, -1);
  const next = settle({ A: base }, "2026-01-01", "2027-01-01").countryStats.A;
  assert.ok(next.population.total < base.population.total);
  assert.ok(next.economy.gdp < base.economy.gdp);
  const original = aggregateTerritorialEconomy(base.territorialComponents);
  closeTo(next.economy.gdp, original.gdp * .98);
});

test("legacy nonterritorial sheet with explicit numbers and rates progresses without inventing map components", () => {
  const old = normalizeCountryStatSheet({ territorialScope: "nonterritorial", population: { total: 20000, annualGrowthRate: 2 }, economy: { gdp: 100000000, gdpGrowth: 4 } });
  const next = settle({ X: old }, "2026-01-01", "2027-01-01").countryStats.X;
  assert.equal(next.territorialComponents, undefined);
  assert.ok(next.population.total > old.population.total);
  assert.ok(next.economy.gdp > old.economy.gdp);
  assert.equal(next.economy.gdpPerCapita, Math.round(next.economy.gdp / next.population.total * 100) / 100);
});

test("missing or incomplete mapped ledgers are not filled in merely because the fields exist", () => {
  const incomplete = normalizeCountryStatSheet({ territorialComponents: [], population: { total: 1000, annualGrowthRate: 1 }, economy: { gdp: 1000, gdpGrowth: 2 } });
  const unknown = normalizeCountryStatSheet({ economy: { gdpGrowth: 3 } });
  const next = settle({ incomplete, unknown }, "2026-01-01", "2027-01-01").countryStats;
  assert.deepEqual(next, { incomplete, unknown });
});

test("out-of-range rates do not create invalid canonical GDP or population", () => {
  const invalid = country();
  invalid.economy.gdpGrowth = 200;
  invalid.population.annualGrowthRate = 80;
  const result = settle({ invalid }, "2026-01-01", "2027-01-01");
  assert.deepEqual(result.countryStats.invalid, invalid);
});

test("BCE dates use the game clock with no year zero", () => {
  const next = settle({ A: country() }, "-0001-12-20", "0001-01-20").countryStats.A;
  assert.ok(next.economy.gdp > country().economy.gdp);
  assert.equal(next.continuity.lastProgressedDate, "0001-01-20");
});

test("rate changes apply only to the remaining interval when a dated impact changes the rate", () => {
  const initial = country(2, 0);
  const middle = settle({ A: initial }, "2026-01-01", "2026-07-01").countryStats.A;
  const updated = normalizeCountryStatSheet({ ...middle, economy: { ...middle.economy, gdpGrowth: -2 } });
  const final = settle({ A: updated }, "2026-07-01", "2027-01-01").countryStats.A;
  const naive = settle({ A: initial }, "2026-01-01", "2027-01-01").countryStats.A;
  assert.ok(final.economy.gdp < naive.economy.gdp);
});

test("population fractional progression is not permanently lost to frequent integer rounding", () => {
  const old = normalizeCountryStatSheet({ territorialScope: "nonterritorial", population: { total: 100, annualGrowthRate: 1 } });
  let sheets = { X: old };
  for (let year = 2026; year < 2036; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
      sheets = settle(sheets, start, end).countryStats;
    }
  }
  assert.ok(sheets.X.population.total >= 110, "fractional carry preserves small-polity demographic growth");
});

test("pre-component legacy custom-scenario backends with actual GDP and population still progress prospectively", () => {
  const old = normalizeCountryStatSheet({
    population: { total: 2_000_000 },
    economy: { gdp: 10_000_000_000, gdpGrowth: 3 },
    customStats: { nationalStability: 61 },
  });
  const result = settle({ A: old }, "2029-07-01", "2030-07-01");
  const after = result.countryStats.A;
  assert.ok(after.economy.gdp > old.economy.gdp);
  assert.equal(after.population.total, old.population.total, "no invented population rate");
  assert.deepEqual(after.customStats, old.customStats, "scenario-visible custom layer remains independent");
});

test("a legacy population-only record cannot become an invented economic backend", () => {
  const source = normalizeCountryStatSheet({ population: { total: 1000, annualGrowthRate: 1 } });
  const result = settle({ A: source }, "2026-01-01", "2027-01-01");
  assert.deepEqual(result.countryStats.A, source);
});

test("settlement cursor survives JSON save/reload and Undo-style restoration without double charging", () => {
  const initial = { A: country(3, -0.3) };
  const first = settle(initial, "2026-01-01", "2026-05-01").countryStats;
  const reloaded = JSON.parse(JSON.stringify(first));
  const twice = settle(reloaded, "2026-01-01", "2026-05-01").countryStats;
  assert.deepEqual(twice, reloaded);
  const next = settle(reloaded, "2026-01-01", "2026-07-01").countryStats;
  const expected = settle(first, "2026-05-01", "2026-07-01").countryStats;
  assert.deepEqual(next, expected);
  assert.deepEqual(settle(JSON.parse(JSON.stringify(initial)), "2026-01-01", "2026-05-01").countryStats, first);
});
