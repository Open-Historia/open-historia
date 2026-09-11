/*! Open Historia — country Stats per-component split tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/countryStatsSplit.test.js
//
// How a small polity's macro bucket is shared between its components. Split by
// map-region count, a Russia holding Crimea gave Crimea 16/341 of the national
// total and every component inherited the bucket's group and GDP per head. The
// model now splits the bucket once; these check the deterministic half: that the
// split is validated and normalized, applied exactly, remembered, and not undone.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeTerritorialComponentSplit,
  expandTerritorialMacroEstimates,
  guardCountryStatContinuity,
  normalizeCountryStatContinuity,
} from "./countryStats.js";

const splitBuckets = [
  { index: 1, members: [{ componentId: "C1", geography: "Mainland" }, { componentId: "C2", geography: "Island" }] },
];

test("a valid split is normalized to exact fractions of its bucket", () => {
  const { splits, rejected } = decodeTerritorialComponentSplit("C1~90~core~40000\n[C2]~6%~overseas/dependent~20,000", splitBuckets);
  assert.deepEqual(rejected, []);
  const [mainland, island] = splits.get(1);
  assert.equal(mainland.geography, "Mainland");
  assert.equal(island.group, "overseas/dependent");
  assert.equal(island.gdpPerCapita, 20000);
  // 90 + 6 = 96 is within the tolerance, and the shares are rescaled to sum to 1.
  assert.ok(Math.abs(mainland.share + island.share - 1) < 1e-9);
  assert.ok(Math.abs(mainland.share - 90 / 96) < 1e-9);
});

test("a split that does not account for every component, once, is rejected", () => {
  const cases = {
    missing: "C1~100~core~40000",
    duplicated: "C1~50~core~40000\nC1~40~core~40000\nC2~10~core~40000",
    "bad group": "C1~90~capital~40000\nC2~10~core~40000",
    "no gdp": "C1~90~core~0\nC2~10~core~40000",
    "negative share": "C1~110~core~40000\nC2~-10~core~40000",
    "shares far from 100": "C1~50~core~40000\nC2~20~core~40000",
    empty: "",
  };
  for (const [label, text] of Object.entries(cases)) {
    const { splits, rejected } = decodeTerritorialComponentSplit(text, splitBuckets);
    assert.equal(splits.size, 0, label);
    assert.equal(rejected.length, 1, label);
    assert.equal(rejected[0].index, 1, label);
  }
});

test("one bucket's bad rows do not reject another bucket", () => {
  const buckets = [
    ...splitBuckets,
    { index: 2, members: [{ componentId: "C3", geography: "North" }, { componentId: "C4", geography: "South" }] },
  ];
  const { splits, rejected } = decodeTerritorialComponentSplit("C1~80~core~40000\nC2~20~core~30000\nC3~70~core~9000", buckets);
  assert.deepEqual([...splits.keys()], [1]);
  assert.deepEqual(rejected.map((entry) => entry.index), [2]);
});

const macroPlan = [
  { index: 1, members: [{ componentId: "C1", geography: "Mainland", weight: 300 }, { componentId: "C2", geography: "Island", weight: 16 }] },
];
const estimate = [{ index: 1, group: "core", population: 10_000_000, gdpPerCapita: 38_000 }];

test("a split sets each component's population share, group, and relative GDP per head", () => {
  const { splits } = decodeTerritorialComponentSplit("C1~97~core~40000\nC2~3~overseas/dependent~20000", splitBuckets);
  const { components, error, diagnostics } = expandTerritorialMacroEstimates(macroPlan, estimate, { componentSplits: splits });
  assert.equal(error, "");
  assert.equal(diagnostics[0].split, true);
  const byName = Object.fromEntries(components.map((component) => [component.geography, component]));
  // The bucket total is exact; the island gets its 3%, not 16/316 of it.
  assert.equal(byName.Mainland.population + byName.Island.population, 10_000_000);
  assert.equal(byName.Island.population, 300_000);
  assert.equal(byName.Island.group, "overseas/dependent");
  assert.equal(byName.Mainland.group, "core");
  // The island keeps half the mainland's productivity, and the bucket's average
  // is the macro row's.
  assert.ok(Math.abs(byName.Island.gdpPerCapita / byName.Mainland.gdpPerCapita - 0.5) < 0.001);
  const average = (byName.Mainland.population * byName.Mainland.gdpPerCapita + byName.Island.population * byName.Island.gdpPerCapita) / 10_000_000;
  assert.ok(Math.abs(average - 38_000) < 1);
});

test("without a split the bucket falls back to the native weights, as before", () => {
  const { components, diagnostics } = expandTerritorialMacroEstimates(macroPlan, estimate);
  assert.equal(diagnostics[0].split, false);
  const island = components.find((component) => component.geography === "Island");
  assert.equal(island.group, "core");
  assert.ok(Math.abs(island.population - 10_000_000 * 16 / 316) <= 1);
});

test("at a later reassessment a split component keeps its share, group and productivity", () => {
  const previousComponents = [
    { geography: "Mainland", group: "core", population: 9_700_000, gdpPerCapita: 40_000 },
    { geography: "Island", group: "overseas/dependent", population: 300_000, gdpPerCapita: 20_000 },
  ];
  const later = [{ index: 1, group: "core", population: 10_100_000, gdpPerCapita: 38_000 }];
  const byName = (components) => Object.fromEntries(components.map((component) => [component.geography, component]));

  const kept = byName(expandTerritorialMacroEstimates(macroPlan, later, { previousComponents, splitGeographies: ["Island", "Mainland"] }).components);
  assert.equal(kept.Island.group, "overseas/dependent");
  assert.equal(kept.Island.population, 303_000);
  assert.ok(Math.abs(kept.Island.gdpPerCapita / kept.Mainland.gdpPerCapita - 0.5) < 0.001);

  // A component never split takes the bucket's group, as before.
  assert.equal(byName(expandTerritorialMacroEstimates(macroPlan, later, { previousComponents }).components).Island.group, "core");
});

const sheet = (components) => ({
  territorialComponents: components.map(([geography, population, gdpPerCapita, group = "core"]) => ({ geography, group, population, gdpPerCapita })),
});

test("the continuity guard keeps a component's first split instead of restoring its weight estimate", () => {
  const previous = sheet([["Mainland", 9_500_000, 38_000], ["Island", 500_000, 38_000]]);
  const candidate = sheet([["Mainland", 9_900_000, 38_500], ["Island", 100_000, 15_000, "overseas/dependent"]]);

  const unguarded = guardCountryStatContinuity(previous, candidate);
  assert.ok(unguarded.restored.some((entry) => entry.geography === "Island"));

  const guarded = guardCountryStatContinuity(previous, candidate, { freshlySplitGeographies: ["island"] });
  assert.deepEqual(guarded.restored, []);
  const island = guarded.sheet.territorialComponents.find((component) => component.geography === "Island");
  assert.equal(island.population, 100_000);
  assert.equal(island.gdpPerCapita, 15_000);
});

test("continuity remembers which components have a semantic split, for which slice, including none", () => {
  assert.deepEqual(
    normalizeCountryStatContinuity({
      semanticSplitComponents: [
        { geography: " Island ", regions: 1 },
        { geography: "Mainland", regions: 300 },
        { geography: "island", regions: 2 },
        { geography: "", regions: 1 },
        { geography: "Partial", regions: -1 },
        { geography: "Partial", regions: 1.5 },
        "Mainland",
        null,
      ],
    }).semanticSplitComponents,
    [{ geography: "Island", regions: 1 }, { geography: "Mainland", regions: 300 }],
  );
  assert.deepEqual(normalizeCountryStatContinuity({ assessedDate: "2016-02-01", semanticSplitComponents: [] }).semanticSplitComponents, []);
  assert.equal(normalizeCountryStatContinuity({ assessedDate: "2016-02-01" }).semanticSplitComponents, undefined);
});
