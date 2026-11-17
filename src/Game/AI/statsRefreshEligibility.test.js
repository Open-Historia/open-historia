import test from "node:test";
import assert from "node:assert/strict";
import { mayReuseCountryStatsAssessment } from "./statsRefreshEligibility.js";

const known = {
  previousComplete: true,
  territorialCoverageMatches: true,
  previousStateFingerprint: "stats-old-date-scoped",
  previousTerritorialFingerprint: "same-legal-territory",
  territorialFingerprint: "same-legal-territory",
  unaccountedEconomicEvents: 0,
};

test("date/round drift does not trigger an AI Stats reassessment", () => {
  assert.equal(mayReuseCountryStatsAssessment(known), true);
  assert.equal(mayReuseCountryStatsAssessment({ ...known, date: "2028-01-01", round: 300 }), true);
});

test("a relevant unaccounted economy event or changed legal map demands reassessment", () => {
  assert.equal(mayReuseCountryStatsAssessment({ ...known, unaccountedEconomicEvents: 1 }), false);
  assert.equal(mayReuseCountryStatsAssessment({ ...known, territorialFingerprint: "new-legal-territory" }), false);
  assert.equal(mayReuseCountryStatsAssessment({ ...known, territorialCoverageMatches: false }), false);
});

test("deliberate hard rebuild and legacy baselines with uncertain provenance stay eligible", () => {
  assert.equal(mayReuseCountryStatsAssessment({ ...known, forceReassess: true }), false);
  assert.equal(mayReuseCountryStatsAssessment({ ...known, rebuildNumericBaseline: true }), false);
  assert.equal(mayReuseCountryStatsAssessment({ ...known, previousStateFingerprint: "" }), false);
  assert.equal(mayReuseCountryStatsAssessment({ ...known, previousComplete: false }), false);
});
