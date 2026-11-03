/*! Open Historia — scenario GDP cross-country scale review regressions. */
import assert from "node:assert/strict";
import test from "node:test";
import { auditScenarioEconomicComparability, scenarioEconomicReadings, SCENARIO_GDP_ACCOUNTING_UNIT } from "./scenarioEconomicComparability.js";

const sheet = (population, perCapita) => ({ population: { total: population }, economy: { gdp: population * perCapita } });

test("1912 diagnostic mismatch: Russia and Australia are flagged without hardcoding era or country names", () => {
  const data = { russian: sheet(116_000_000, 235), australia: sheet(4_500_000, 6049), german: sheet(77_800_000, 2147) };
  const review = auditScenarioEconomicComparability(data);
  assert.ok(review.warnings.some((item) => item.lowerCode === "russian" && item.higherCode === "australia" && item.ratio > 25));
  assert.ok(review.warnings.some((item) => item.lowerCode === "russian" && item.higherCode === "german"));
  assert.equal(data.russian.economy.gdp, 116_000_000 * 235, "audit never mutates canonical values");
});

test("modern comparable countries pass, while a real 2026 disparity is flagged for REVIEW not automatic correction", () => {
  assert.equal(auditScenarioEconomicComparability({ a: sheet(50_000_000, 30_000), b: sheet(10_000_000, 60_000) }).warnings.length, 0);
  const review = auditScenarioEconomicComparability({ a: sheet(60_000_000, 2_500), b: sheet(50_000_000, 80_000) });
  assert.equal(review.warnings.length, 1);
  assert.match(review.warnings[0].reason, /independent historical evidence/);
});

test("1812 and counterfactual economies follow the same rule; no year, polity or ideology exceptions", () => {
  const review = auditScenarioEconomicComparability({ a: sheet(18_000_000, 110), b: sheet(2_000_000, 1_200) });
  assert.equal(review.warnings.length, 1);
  assert.equal(review.warnings[0].ratio, 10.9);
});

test("medieval / nonmonetary or incomplete readings remain unset, not fabricated zeroes", () => {
  assert.deepEqual(scenarioEconomicReadings({ a: { population: { total: 1_000_000 } }, b: { economy: { gdp: 42 } }, c: sheet(1_000_000, 10) }).map((x) => x.code), ["c"]);
  assert.equal(auditScenarioEconomicComparability({ a: { population: { total: 1_000_000 } } }).warnings.length, 0);
  assert.match(SCENARIO_GDP_ACCOUNTING_UNIT, /not PPP/);
});

test("deterministic order and named comparisons avoid source-list iteration or identity ambiguities", () => {
  const records = { xx: sheet(20_000_000, 100), yy: sheet(5_000_000, 1000), zz: sheet(12_000_000, 3_000) };
  const first = auditScenarioEconomicComparability(records, { xx: "Lower", yy: "Higher" });
  const second = auditScenarioEconomicComparability(Object.fromEntries(Object.entries(records).reverse()), { xx: "Lower", yy: "Higher" });
  assert.deepEqual(first, second);
  assert.equal(first.warnings[0].lowerName, "Lower");
  assert.deepEqual(first.flaggedCodes, ["xx", "yy", "zz"]);
});

test("downloadable review includes all flagged comparisons and escapes author labels safely", async () => {
  const { serializeScenarioEconomicComparabilityCsv } = await import("./scenarioEconomicComparability.js");
  const audit = auditScenarioEconomicComparability({
    aa: sheet(20_000_000, 200), bb: sheet(4_000_000, 5_000), cc: sheet(30_000_000, 10_000),
  }, { aa: 'An "Empire"', bb: "Duchy" });
  const csv = serializeScenarioEconomicComparabilityCsv(audit);
  assert.equal(csv.split("\r\n").length - 2, audit.warnings.length);
  assert.match(csv, /"An ""Empire"""/);
  assert.match(csv, /perCapitaRatio/);
});

test("creator GDP presentation regression: group wide GDP gaps by country without declaring them invalid", async () => {
  const { summarizeScenarioEconomicComparability } = await import("./scenarioEconomicComparability.js");
  const sheets = { africa: sheet(22_000_000, 500), america: sheet(250_000_000, 30_000),
    inland: sheet(8_000_000, 450), west: sheet(40_000_000, 28_000), equal: sheet(9_000_000, 29_000) };
  const input = auditScenarioEconomicComparability(sheets, { africa: "Africa region", america: "America region" });
  const before = structuredClone(input);
  const overview = summarizeScenarioEconomicComparability(input);
  assert.equal(overview.readings, 5);
  assert.equal(overview.comparisons, input.warnings.length);
  assert.equal(overview.countries.length, new Set(input.warnings.flatMap((w) => [w.lowerCode, w.higherCode])).size);
  assert.deepEqual(overview.countries.map((c) => c.code),
    summarizeScenarioEconomicComparability(auditScenarioEconomicComparability(Object.fromEntries(Object.entries(sheets).reverse()))).countries.map((c) => c.code));
  assert.equal(overview.countries.reduce((sum, c) => sum + c.comparisonCount, 0), 2 * overview.comparisons);
  assert.deepEqual(input, before, "overview is a pure non-mutating presentation transform");
  assert.equal(sheets.africa.population.total, 22_000_000, "canonical source remains unchanged");
  assert.deepEqual(summarizeScenarioEconomicComparability({ readings: [], warnings: [] }),
    { readings: 0, comparisons: 0, countries: [] });
});
