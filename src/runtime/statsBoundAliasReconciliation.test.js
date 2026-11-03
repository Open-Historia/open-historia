/*! Regression: scenario-author-reviewed custom readings must never be silently swapped into native state. */
import test from "node:test";
import assert from "node:assert/strict";
import { planBoundNationalStatsAliasReconciliation as plan } from "./statsBoundAliasReconciliation.js";
import { nationalStatsPresentationCoverage } from "./statsMetricBindings.js";

const cards = [
  ["totalPopulation", "number"], ["gdp", "currency"], ["gdpPerCapita", "currency"],
  ["inflation", "percentage"], ["unemployment", "percentage"],
  ["publicDebt", "percentage"], ["budgetBalance", "percentage"],
];
const definition = { custom: true, sections: [{ key: "national", label: "National", stats: cards.map(([key, kind]) =>
  ({ key, label: key, kind, nativeMetric: key })) }] };
const sample = ({ inflation = 0, unemployment = 0, customInflation = 2.5, customUnemployment = 6.5 } = {}) => ({
  statsSchemaVersion: 2,
  territorialScope: "mapped",
  territorialComponents: [
    { geography: "Latvia", population: 1860000, gdpPerCapita: 23000, group: "core" },
  ],
  population: { total: 1860000 },
  economy: {
    gdp: 42780000000, gdpPerCapita: 23000, coreGdpPerCapita: 23000, gdpGrowth: 0,
    inflation, unemployment, publicDebt: 45, budgetBalance: -2,
    currency: "scenario accounting units",
  },
  customStats: {
    totalPopulation: 1860000, gdp: 42780000000, gdpPerCapita: 23000,
    inflation: customInflation, unemployment: customUnemployment,
    publicDebt: 45, budgetBalance: -2,
    nationalStability: 70, gdpGrowthPerMonth: 0.2,
  },
  continuity: { assessedDate: "2026-01-01",
    scenarioBaseline: { version: 1, source: "scenario-author-reviewed", date: "2026-01-01" } },
});
const fixture = () => ({
  world: { countryStats: { LV: sample(), FI: sample({ customInflation: -0.5, customUnemployment: 0 }) } },
  roster: [{ code: "LV", name: "Latvia" }, { code: "FI", name: "Finland" }],
});
const run = ({ world, roster }, metricKey, mode, scope = "all") =>
  plan({ definition, world, roster, metricKey, mode, scope });
const apply = (world, patches) => ({ ...world, countryStats: { ...world.countryStats, ...patches } });

test("source-like 2026 custom scenario: no implicit promotion, native-zero conflicts require author choice", () => {
  const { world, roster } = fixture();
  const original = JSON.stringify(world);
  const result = run({ world, roster }, "inflation", "keep-native");
  assert.equal(result.countries, 2);
  assert.equal(result.disagreements, 2);
  assert.equal(result.patches.LV.economy.inflation, 0);
  assert.equal(result.patches.LV.customStats.archivedInflation, 2.5);
  assert.equal(result.patches.FI.customStats.archivedInflation, -0.5);
  assert.equal(Object.hasOwn(result.patches.LV.customStats, "inflation"), false);
  assert.equal(result.patches.LV.customStats.gdpGrowthPerMonth, 0.2);
  assert.equal(JSON.stringify(world), original, "planning must not mutate source");
  assert.equal(nationalStatsPresentationCoverage(definition, result.patches.LV).ready, false,
    "other unreviewed aliases continue blocking readiness");
  assert.equal(result.originals.LV, JSON.stringify(world.countryStats.LV));
});

test("author-selected inflation promotion archives both old native and old legacy readings losslessly", () => {
  const { world, roster } = fixture();
  const prior = structuredClone(world.countryStats.LV);
  const result = run({ world, roster }, "inflation", "promote-legacy", "native-zero");
  assert.equal(result.countries, 2);
  const saved = result.patches.LV;
  assert.equal(saved.economy.inflation, 2.5);
  assert.equal(saved.customStats.archivedPriorNativeInflation, 0);
  assert.equal(saved.customStats.archivedInflation, 2.5);
  assert.equal(saved.customStats.unemployment, 6.5, "unselected legacy key remains independently authored");
  assert.deepEqual(saved.population, prior.population);
  assert.deepEqual(saved.territorialComponents, prior.territorialComponents);
  assert.equal(saved.economy.gdp, prior.economy.gdp);
  assert.equal(saved.economy.publicDebt, prior.economy.publicDebt);
  assert.deepEqual(saved.continuity, prior.continuity);
});

test("one metric can be resolved for all countries, without reconstructing 238 baselines or altering GDP units", () => {
  let { world, roster } = fixture();
  const outcomes = [
    ["inflation", "promote-legacy"], ["unemployment", "promote-legacy"],
    ["gdp", "keep-native"], ["gdpPerCapita", "keep-native"],
    ["totalPopulation", "keep-native"], ["publicDebt", "keep-native"], ["budgetBalance", "keep-native"],
  ];
  for (const [key, mode] of outcomes) {
    const planned = run({ world, roster }, key, mode);
    world = apply(world, planned.patches);
  }
  assert.equal(nationalStatsPresentationCoverage(definition, world.countryStats.LV).ready, true);
  assert.equal(nationalStatsPresentationCoverage(definition, world.countryStats.FI).ready, true);
  assert.equal(world.countryStats.LV.economy.inflation, 2.5);
  assert.equal(world.countryStats.LV.economy.unemployment, 6.5);
  assert.equal(world.countryStats.FI.economy.unemployment, 0, "explicit zero is retained");
  assert.equal(world.countryStats.FI.customStats.archivedUnemployment, 0);
  assert.equal(world.countryStats.LV.economy.gdp, 42780000000);
  assert.equal(world.countryStats.LV.customStats.archivedGdp, 42780000000);
  assert.equal(world.countryStats.LV.customStats.gdpGrowthPerMonth, 0.2);
});

test("matching-only mode archives just same readings, not incomplete/conflicting values", () => {
  const { world, roster } = fixture();
  const match = run({ world, roster }, "unemployment", "keep-native", "matching");
  assert.deepEqual(Object.keys(match.patches), ["FI"]);
  assert.equal(match.patches.FI.customStats.archivedUnemployment, 0);
  assert.equal(match.patches.FI.economy.unemployment, 0);
  assert.equal(match.entries[0].equal, true);
  const different = run({ world, roster }, "unemployment", "promote-legacy", "different");
  assert.deepEqual(Object.keys(different.patches), ["LV"]);
});

test("GDP, GDP per capita and population cannot be bulk-promoted without map-aware accounting and unit review", () => {
  const input = fixture();
  for (const key of ["gdp", "gdpPerCapita", "totalPopulation"]) {
    assert.throws(() => run(input, key, "promote-legacy"), /territorial accounting ledger/);
  }
});

test("fail closed for ambiguous sources, malformed decisions, invalid native ranges and economic clocks", () => {
  const input = fixture();
  assert.throws(() => run(input, "inflation", "magic"), /explicit reconciliation action/);
  assert.throws(() => run(input, "inflation", "keep-native", "unknown"), /population scope/);
  const bad = structuredClone(input);
  bad.world.countryStats.LV.customStats.unemployment = 121;
  assert.throws(() => run(bad, "unemployment", "promote-legacy"), /validated range/);
  const clock = structuredClone(input);
  clock.world.countryStats.LV.continuity.nativeEconomyClock = { version: 1 };
  assert.throws(() => run(clock, "inflation", "promote-legacy"), /economic continuity cursor/);
  const duplicate = structuredClone(input);
  duplicate.world.countryStats.LV.customStats.archivedPriorNativeInflation = 7;
  const result = run(duplicate, "inflation", "promote-legacy");
  assert.equal(result.patches.LV.customStats.archivedPriorNativeInflation, 7);
  assert.equal(result.patches.LV.customStats.archivedPriorNativeInflation2, 0);
});

test("preserving prior native readings never silently exceeds the 60 custom Stats keys", () => {
  const input = fixture();
  const stats = input.world.countryStats.LV.customStats;
  for (let i = 0; i < 51; i += 1) stats["a" + i] = i;
  assert.equal(Object.keys(stats).length, 60);
  assert.throws(() => run(input, "inflation", "promote-legacy"), /custom Statistics limit/);
  assert.equal(Object.keys(input.world.countryStats.LV.customStats).length, 60);
});

test("mixed duplicate keys cannot bypass a restrictive scope or promote ambiguous readings", () => {
  const input=fixture();
  const def={custom:true,sections:[{key:"metrics",label:"Metrics",stats:[
    {key:"priceTrend",label:"Inflation",kind:"percentage",nativeMetric:"inflation"},
  ]}]};
  input.world.countryStats.LV.customStats.priceTrend=0;
  const base={definition:def,world:input.world,roster:[input.roster[0]],metricKey:"priceTrend"};
  const match=plan({...base,mode:"keep-native",scope:"matching"});
  assert.equal(match.countries,0,"a country with a hidden conflicting alias cannot be archived under matching-only scope");
  assert.throws(()=>plan({...base,mode:"promote-legacy",scope:"all"}),/multiple legacy aliases/);
  const keep=plan({...base,mode:"keep-native",scope:"all"});
  assert.equal(keep.entries.length,2);
  assert.equal(keep.patches.LV.customStats.archivedPriceTrend,0);
  assert.equal(keep.patches.LV.customStats.archivedInflation,2.5);
  assert.equal(keep.patches.LV.economy.inflation,0);
});

test("new archival keys never collide with reserved presentation keys even when those fields are absent", () => {
  const input=fixture();
  const def=structuredClone(definition);
  def.sections[0].stats.push({key:"archivedPriorNativeInflation",label:"Independent reserve",kind:"percentage"});
  const result=plan({definition:def,world:input.world,roster:input.roster,metricKey:"inflation",mode:"promote-legacy"});
  assert.equal(result.patches.LV.customStats.archivedPriorNativeInflation,undefined);
  assert.equal(result.patches.LV.customStats.archivedPriorNativeInflation2,0);
});
