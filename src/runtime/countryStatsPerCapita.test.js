import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCountryStatSheet, mergeCountryStatPatch } from "./countryStats.js";

const base = {
  territorialComponents: [
    { geography: "Mainland", group: "core", population: 60_000_000, gdpPerCapita: 3_000 },
    { geography: "Dependent Island", group: "overseas/dependent", population: 10_000_000, gdpPerCapita: 1_000 },
  ],
  economy: { gdp: 999_000_000_000, gdpPerCapita: 19_000, coreGdpPerCapita: 999, gdpGrowth: 2 },
};

test("GDP/capita is derived from national GDP and total population for territorial sheets, not model totals", () => {
  const sheet = normalizeCountryStatSheet(base);
  assert.equal(sheet.population.total, 70_000_000);
  assert.equal(sheet.economy.gdp, 190_000_000_000);
  assert.equal(sheet.economy.gdpPerCapita, 2_714.29);
  assert.equal(sheet.economy.coreGdpPerCapita, 3_000);
  assert.equal(sheet.economy.otherGdpPerCapita, 1_000);
});

test("component-backed GDP/capita follows GDP and population edits even when stale per-capita was supplied", () => {
  const sheet = normalizeCountryStatSheet(base);
  const changed = mergeCountryStatPatch(sheet, {
    economy: { gdp: 210_000_000_000, gdpPerCapita: 50_000 },
  });
  assert.equal(changed.population.total, 70_000_000);
  assert.equal(changed.economy.gdpPerCapita, Math.round(changed.economy.gdp / changed.population.total * 100) / 100);
  assert.ok(changed.economy.gdpPerCapita < 5_000);
});

test("legacy and nonterritorial sheets with GDP and population derive per-capita instead of preserving AI output", () => {
  const old = { territorialScope: "nonterritorial", population: { total: 4_000_000 }, economy: { gdp: 20_000_000_000, gdpPerCapita: 90_000, gdpGrowth: 2 } };
  const normalized = normalizeCountryStatSheet(old);
  assert.equal(normalized.economy.gdpPerCapita, 5_000);
  const afterGdp = mergeCountryStatPatch(normalized, { economy: { gdp: 22_000_000_000 } });
  assert.equal(afterGdp.economy.gdpPerCapita, 5_500);
  const afterPop = mergeCountryStatPatch(afterGdp, { population: { total: 5_000_000 } });
  assert.equal(afterPop.economy.gdpPerCapita, 4_400);
});

test("unset or zero population never invents per-capita or rewrites unknown baselines", () => {
  const missingPopulation = normalizeCountryStatSheet({ economy: { gdp: 20_000_000_000 } });
  assert.equal(missingPopulation.economy?.gdpPerCapita, undefined);
  const zeroPopulation = normalizeCountryStatSheet({ population: { total: 0 }, economy: { gdp: 20_000_000_000 } });
  assert.equal(zeroPopulation.economy?.gdpPerCapita, undefined);
});

test("Country panel GDP/capita headline uses whole-polity scope to match headline GDP", () => {
  const ui = readFileSync(new URL("../Game/GameUI/stats.jsx", import.meta.url), "utf8");
  assert.match(ui, /const displayedPerCapita = Number\.isFinite\(wholePerCapita\)/);
  assert.match(ui, /Core\/integrated.*formatDollarPerCapita\(corePerCapita\)/);
  assert.doesNotMatch(ui, /const displayedPerCapita = hasOtherTerritories && Number\.isFinite\(corePerCapita\)/);
});

test("AI event GDP-per-capita suggestions cannot independently move canonical GDP", () => {
  const baseline = normalizeCountryStatSheet(base);
  const attempted = mergeCountryStatPatch(baseline, {
    economy: { gdpPerCapita: 30_000, coreGdpPerCapita: 40_000 },
  }, { allowPerCapitaRescale: false });
  assert.deepEqual(attempted.territorialComponents, baseline.territorialComponents);
  assert.equal(attempted.economy.gdp, baseline.economy.gdp);
  assert.equal(attempted.economy.gdpPerCapita, baseline.economy.gdpPerCapita);

  const authoritative = mergeCountryStatPatch(baseline, {
    economy: { gdp: 210_000_000_000, gdpPerCapita: 90_000 },
  }, { allowPerCapitaRescale: false });
  assert.ok(authoritative.economy.gdp > baseline.economy.gdp);
  assert.equal(authoritative.economy.gdpPerCapita, Math.round(authoritative.economy.gdp / authoritative.population.total * 100) / 100);
});

test("structured event stat mutations opt out of model GDP-per-capita targets", () => {
  const source = readFileSync(new URL("./gameState.js", import.meta.url), "utf8");
  assert.match(source, /maxAggregateRescale: COUNTRY_STATS_EVENT_RESCALE_LIMIT,\s*allowPerCapitaRescale: false/);
});

test("unassessed legacy countries cannot acquire invented GDP-per-capita from AI events alone", () => {
  const after = mergeCountryStatPatch(
    { territorialScope: "nonterritorial", economy: { currency: "Franc" } },
    { economy: { gdpPerCapita: 14_000, coreGdpPerCapita: 29_000, inflation: 3 } },
    { allowPerCapitaRescale: false },
  );
  assert.equal(after.economy.gdpPerCapita, undefined);
  assert.equal(after.economy.coreGdpPerCapita, undefined);
  assert.equal(after.economy.inflation, 3, "ordinary supported economic changes still apply");
  assert.equal(after.economy.currency, "Franc");
});
