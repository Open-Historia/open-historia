/*! Open Historia — country stats calibration check tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/countryStatsCalibration.test.js
//
// The checks generateCountryStatSheet runs on a Stats answer before it is
// saved. A wrong rejection costs a re-ask; a wrong acceptance keeps a bad
// sheet for good.

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeCountryStatMacroEstimates,
  normalizeNearBoundaryHistoricalNominalScale,
  validateNativeEconomicCalibration,
} from "./countryStatsCalibration.js";

const plan = [
  { index: 1, members: [{ componentId: "a" }, { componentId: "b" }] },
  { index: 2, members: [{ componentId: "c" }] },
];

test("macro rows decode one per planned bucket, in plan order", () => {
  const decoded = decodeCountryStatMacroEstimates(
    "2~integrated~1,200,000~€15,000.5\n\n1~core~40_000_000~$38000\n7~core~5~5\n1~core~1~1\nnot a row",
    plan,
  );
  assert.equal(decoded.error, "");
  assert.deepEqual(decoded.estimates, [
    { index: 1, group: "core", population: 40000000, gdpPerCapita: 38000 },
    { index: 2, group: "integrated", population: 1200000, gdpPerCapita: 15000.5 },
  ]);
});

test("a missing, empty or invalid macro row is an error naming what is missing", () => {
  assert.match(decodeCountryStatMacroEstimates("", plan).error, /territorialMacroComponentsText is empty; return exactly 2 macro estimate row/);
  const missing = decodeCountryStatMacroEstimates("1~core~100~100", plan);
  assert.deepEqual(missing.estimates, []);
  assert.match(missing.error, /missing index\(es\): 2\./);
  assert.match(decodeCountryStatMacroEstimates("1~core~100~100\n2~capital~100~100", plan).error, /missing index\(es\): 2\./,
    "an unknown group does not count");
  assert.match(decodeCountryStatMacroEstimates("1~core~100~100\n2~core~100", plan).error, /missing index\(es\): 2\./,
    "a row needs four fields");
});

test("a polity with no map plan takes NONE or the old group~geography rows", () => {
  assert.deepEqual(decodeCountryStatMacroEstimates("none", []), { estimates: [], components: [], error: "" });
  assert.deepEqual(decodeCountryStatMacroEstimates("", []), { estimates: [], components: [], error: "" });
  const decoded = decodeCountryStatMacroEstimates(
    "Core~Diaspora communities~2,500,000.4~$12,000\nsettler~Somewhere~10~10\ncore~~10~10\ncore~Camps~-5~10\ncore~Camps~10~0",
    [],
  );
  assert.equal(decoded.error, "");
  assert.deepEqual(decoded.components, [
    { geography: "Diaspora communities", group: "core", population: 2500000, gdpPerCapita: 12000 },
  ]);
});

const historical = (overrides = {}) => ({
  mode: "historical_start",
  historyAuthorityCutoff: "1900-01-01",
  basis: "Maddison project nominal estimates",
  anchorYear: 1900,
  anchorCurrency: "USD",
  nominalGdpBillions: 1,
  nominalGdpPerCapita: 10,
  rebasedGdpPerCapita2026Eur: 10000,
  divergenceEventIds: [],
  ...overrides,
});
const ledger = (gdpPerCapita, population = 100_000_000) => [
  { geography: "Core", population: population / 2, gdpPerCapita },
  { geography: "Coast", population: population / 2, gdpPerCapita: gdpPerCapita * 2 },
];

test("the nominal-scale nudge only moves an unexplained historical answer just outside the guard", () => {
  // No elapsed years: the guard is 1/1.35 .. 1.35 of the rebased anchor.
  const inside = normalizeNearBoundaryHistoricalNominalScale({ calibration: historical(), components: ledger(8000), currentDate: "1900-06-01" });
  assert.equal(inside.adjusted, false);

  const justLow = ledger(4800); // average 7200 = 0.72x, within 10% of the 0.7407 floor
  const nudged = normalizeNearBoundaryHistoricalNominalScale({ calibration: historical(), components: justLow, currentDate: "1900-06-01" });
  assert.equal(nudged.adjusted, true);
  assert.ok(Math.abs(nudged.beforeRatio - 0.72) < 1e-9);
  assert.ok(Math.abs(nudged.afterRatio - 1 / 1.35) < 1e-9);
  assert.ok(Math.abs(nudged.components[1].gdpPerCapita / nudged.components[0].gdpPerCapita - 2) < 1e-3, "the regional pattern is kept");
  assert.equal(justLow[0].gdpPerCapita, 4800, "the input is not mutated");

  const justHigh = normalizeNearBoundaryHistoricalNominalScale({ calibration: historical(), components: ledger(9500), currentDate: "1900-06-01" });
  assert.equal(justHigh.adjusted, true);
  assert.ok(Math.abs(justHigh.afterRatio - 1.35) < 1e-9);

  assert.equal(normalizeNearBoundaryHistoricalNominalScale({ calibration: historical(), components: ledger(3000), currentDate: "1900-06-01" }).adjusted, false,
    "far outside the guard still fails closed");
  assert.equal(normalizeNearBoundaryHistoricalNominalScale({ calibration: historical({ divergenceEventIds: ["e1"] }), components: justLow, currentDate: "1900-06-01" }).adjusted, false,
    "a cited divergence is the model's call");
  assert.equal(normalizeNearBoundaryHistoricalNominalScale({ calibration: historical({ mode: "campaign_reconstruction" }), components: justLow, currentDate: "1900-06-01" }).adjusted, false);
  // Five years on, the guard widens to 1.75x, so 0.72x is already inside it.
  assert.equal(normalizeNearBoundaryHistoricalNominalScale({ calibration: historical(), components: justLow, currentDate: "1905-06-01" }).adjusted, false);
  assert.deepEqual(normalizeNearBoundaryHistoricalNominalScale({}), { components: [], adjusted: false });
});

test("a credible historical calibration passes", () => {
  assert.equal(validateNativeEconomicCalibration({
    calibration: historical(),
    populationCalibration: { mode: "historical_start" },
    components: ledger(6667),
    eligibleEvidenceIds: [],
    currentDate: "1900-06-01",
  }), "");
});

test("the calibration audit names each broken field", () => {
  const check = (calibration, extra = {}) => validateNativeEconomicCalibration({
    calibration, components: ledger(6667), eligibleEvidenceIds: ["e1"], currentDate: "1900-06-01", ...extra,
  });
  assert.match(check(null), /economicCalibration is required/);
  assert.match(check(historical({ mode: "vibes" })), /mode must be historical_start, counterfactual_start, or campaign_reconstruction; received vibes/);
  assert.match(check(historical({ historyAuthorityCutoff: "" })), /historyAuthorityCutoff is required/);
  assert.match(check(historical({ basis: " " })), /basis must briefly state/);
  assert.match(check(historical({ anchorYear: 0 })), /anchorYear must be a real integer year/);
  assert.match(check(historical({ anchorCurrency: "gbp" })), /anchorCurrency must be USD or EUR/);
  assert.match(check(historical({ nominalGdpBillions: 0 })), /must all be positive/);
  assert.match(check(historical(), { populationCalibration: { mode: "counterfactual_start" } }), /must match populationCalibration\.mode \(counterfactual_start\)/);
  assert.match(check(historical({ divergenceEventIds: ["e1", "e9"] })), /not present in the bounded fresh economic evidence: e9\./);
  assert.match(check(historical({ anchorYear: 1950 })), /anchorYear 1950 lies after the shared-history cutoff 1900/);
});

test("a modern anchor may not smuggle PPP output in through the rebasing factor", () => {
  const modern = (rebased) => validateNativeEconomicCalibration({
    calibration: {
      mode: "counterfactual_start",
      historyAuthorityCutoff: "2020",
      basis: "IMF WEO nominal",
      anchorYear: 2020,
      anchorCurrency: "USD",
      nominalGdpBillions: 60,
      nominalGdpPerCapita: 6000,
      rebasedGdpPerCapita2026Eur: rebased,
    },
    components: ledger(6000, 10_000_000),
    eligibleEvidenceIds: [],
    currentDate: "2020-01-01",
  });
  // 2020 allows up to 1 + 6 * 0.075 = 1.45x.
  assert.equal(modern(8400), "");
  assert.match(modern(9000), /rebasing factor 1\.50x is not credible for a 2020 USD nominal anchor \(allowed modern accounting range 0\.45x-1\.45x\)/);
  assert.match(modern(2400), /rebasing factor 0\.40x is not credible/);
});

test("a historical start checks the anchor's territorial scope and its nominal scale", () => {
  const check = (calibration, components) => validateNativeEconomicCalibration({
    calibration, components, eligibleEvidenceIds: ["e1"], currentDate: "1900-06-01",
  });
  // The anchor implies 100 M people; a 50 M ledger is the wrong scope.
  assert.match(check(historical(), ledger(6667, 50_000_000)), /imply 100\D?000\D?000 people, but the authoritative live baseline contains 50\D?000\D?000/);
  // Average 20,000 is 2x the 10,000 anchor with no cited divergence.
  assert.match(check(historical(), ledger(13334)), /is 2\.00x the audited historical nominal anchor/);
  assert.equal(check(historical({ divergenceEventIds: ["e1"] }), ledger(13334)), "", "a cited divergence explains it");
});
