import test from "node:test";
import assert from "node:assert/strict";
import { planBoundNationalStatsAliasArchival } from "./statsBoundAliasArchival.js";
import { assertNoLegacyNativeStatCopies } from "./statsMetricBindings.js";
import { normalizeCountryStatSheet } from "./countryStats.js";

const definition = { custom: true, sections: [{ key: "economy", label: "Economy", stats: [
  { key: "gdp", label: "GDP", kind: "currency", nativeMetric: "gdp" },
  { key: "inflation", label: "Inflation", kind: "percentage", nativeMetric: "inflation" },
  { key: "publicDebt", label: "Debt", kind: "percentage", nativeMetric: "publicDebt" },
  { key: "domesticHarvest", label: "Harvest", kind: "number" },
] }] };
const czech = () => ({
  economy: { gdp: 328_800_000_000, inflation: 0, publicDebt: 44, budgetBalance: -3 },
  population: { total: 10_800_000 }, stability: 66,
  territorialComponents: [{ geography: "Prague", population: 1_000_000, gdp: 123 }],
  customStats: { gdp: 324_000_000_000, inflation: 2.5, publicDebt: 44, domesticHarvest: 12 },
  continuity: { assessedDate: "2026-01-01" },
});

test("reviewed bulk archive preserves every Czech native reading, independently authored value and nonalias field", () => {
  const original = czech();
  const world = { countryStats: { "Czech Republic": original } };
  const untouched = structuredClone(world);
  const plan = planBoundNationalStatsAliasArchival({
    definition, world, roster: [{ code: "Czech Republic", name: "Czech Republic" }],
  });
  assert.equal(plan.entries.length, 3);
  assert.equal(plan.entries.filter((row) => !row.equal).length, 2);
  assert.equal(plan.entries.filter((row) => row.equal).length, 1);
  assert.deepEqual(world, untouched, "preview never mutates scenario state");
  const updated = plan.patches["Czech Republic"];
  assert.equal(updated.economy.gdp, 328_800_000_000);
  assert.equal(updated.economy.inflation, 0, "canonical zero must not become 2.5");
  assert.equal(updated.economy.publicDebt, 44);
  assert.deepEqual(updated.territorialComponents, original.territorialComponents);
  assert.equal(updated.customStats.archivedGdp, 324_000_000_000);
  assert.equal(updated.customStats.archivedInflation, 2.5);
  assert.equal(updated.customStats.archivedPublicDebt, 44);
  assert.equal(updated.customStats.domesticHarvest, 12);
  assert.equal(Object.hasOwn(updated.customStats, "gdp"), false);
  assert.equal(Object.hasOwn(updated.customStats, "inflation"), false);
  assert.equal(Object.hasOwn(updated.customStats, "publicDebt"), false);
  assert.equal(normalizeCountryStatSheet(updated).customStats.archivedGdp, 324_000_000_000);
  assert.doesNotThrow(() => assertNoLegacyNativeStatCopies(definition, updated));
  assert.equal(plan.originals["Czech Republic"], JSON.stringify(original));
  assert.deepEqual(planBoundNationalStatsAliasArchival({ definition, world: { countryStats: plan.patches },
    roster: [{ code: "Czech Republic" }] }).entries, [], "idempotent after author approval");
});

test("legacy semantics are never inferred without explicit native bindings", () => {
  const unbound = { custom: true, sections: [{ key: "economy", label: "Economy", stats: [
    { key: "gdp", label: "GDP", kind: "currency" },
  ] }] };
  const world = { countryStats: { CZ: czech() } };
  const plan = planBoundNationalStatsAliasArchival({ definition: unbound, world,
    roster: [{ code: "CZ" }] });
  assert.equal(plan.entries.length, 0);
  assert.match(plan.unsupported, /No explicit native-bound/);
  assert.equal(world.countryStats.CZ.customStats.gdp, 324_000_000_000);
});

test("native-unset, nonfinite legacy readings and exhausted capacity refuse before saving anything", () => {
  const w = { countryStats: { CZ: { ...czech(), economy: { inflation: 0, publicDebt: 44 },
    customStats: { gdp: 324_000_000_000 } } } };
  assert.throws(() => planBoundNationalStatsAliasArchival({ definition, world: w,
    roster: [{ code: "CZ" }] }), /missing or nonnumeric/);
  assert.equal(w.countryStats.CZ.customStats.gdp, 324_000_000_000);

  const invalid = { countryStats: { CZ: { ...czech(),
    customStats: { gdp: Number.NaN } } } };
  assert.throws(() => planBoundNationalStatsAliasArchival({ definition, world: invalid,
    roster: [{ code: "CZ" }] }), /missing or nonnumeric/);

  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["stat" + i, i]));
  many.gdp = 321;
  const full = { countryStats: { CZ: { ...czech(), customStats: many } } };
  assert.throws(() => planBoundNationalStatsAliasArchival({ definition, world: full,
    roster: [{ code: "CZ" }] }), /more than 60 custom Statistics slots/);
});

test("archival keys cannot overwrite existing authored keys or collide with display definition", () => {
  const def = { custom: true, sections: [{ key: "main", label: "Main", stats: [
    { key: "gdpHero", label: "GDP", kind: "currency", nativeMetric: "gdp" },
    { key: "archivedGdp", label: "Ancient crop figure", kind: "number" },
  ] }] };
  const world = { countryStats: { CZ: { ...czech(),
    customStats: { gdp: 320, gdpHero: 325, archivedGdp: 315 } } } };
  const plan = planBoundNationalStatsAliasArchival({ definition: def, world,
    roster: [{ code: "CZ" }, { code: "CZ" }] });
  const updated = plan.patches.CZ;
  assert.equal(plan.entries.length, 2);
  assert.equal(updated.customStats.archivedGdp, 315, "existing field untouched");
  assert.equal(updated.customStats.archivedGdp2, 320);
  assert.equal(updated.customStats.archivedGdpHero, 325);
  assert.doesNotThrow(() => assertNoLegacyNativeStatCopies(def, updated));
});

test("one invalid country blocks entire migration plan rather than returning partial patch set", () => {
  const world = { countryStats: {
    CZ: czech(),
    SK: { ...czech(), customStats: { gdp: "unknown" } },
  } };
  assert.throws(() => planBoundNationalStatsAliasArchival({
    definition, world, roster: [{ code: "CZ" }, { code: "SK" }],
  }), /SK: gdp/);
  assert.equal(world.countryStats.CZ.customStats.gdp, 324_000_000_000);
});

test("at-capacity legacy alias archive is an exact key replacement, including an explicit numeric zero", () => {
  const source = { ...czech(),
    customStats: { gdp: 0, ...Object.fromEntries(
      Array.from({length:59},(_,index)=>["independent"+index,index+1])) } };
  const world = {countryStats:{CZ:source}};
  const plan = planBoundNationalStatsAliasArchival({definition,world,roster:[{code:"CZ"}]});
  assert.equal(plan.entries.length,1);
  assert.equal(plan.entries[0].legacyValue,0);
  assert.equal(plan.entries[0].equal,false);
  assert.equal(Object.keys(plan.patches.CZ.customStats).length,60);
  assert.equal(plan.patches.CZ.customStats.archivedGdp,0);
  assert.equal(Object.hasOwn(plan.patches.CZ.customStats,"gdp"),false);
  const saved=normalizeCountryStatSheet(JSON.parse(JSON.stringify(plan.patches.CZ)));
  assert.equal(saved.customStats.archivedGdp,0,
    "save/reload normalization must not reinterpret an explicit zero as unset");
  assert.equal(Object.keys(saved.customStats).length,60);
  assert.deepEqual(world,{countryStats:{CZ:source}},
    "a proposed archive must not mutate the existing scenario");
});

test("legacy archival refuses unrelated values that normalization would silently drop or coerce", () => {
  for(const extra of [{ unrelated:"not yet measured" },{ unrelated:1e30 },
    { legacyKeyNotValid:"42" }]) {
    const sheet={...czech(),customStats:{gdp:320, ...extra}};
    assert.throws(()=>planBoundNationalStatsAliasArchival({
      definition,world:{countryStats:{CZ:sheet}},roster:[{code:"CZ"}],
    }),/lossless|cannot preserve|round-trip/i,
      "archiving one alias must not erase or rewrite unrelated legacy evidence");
  }
});
