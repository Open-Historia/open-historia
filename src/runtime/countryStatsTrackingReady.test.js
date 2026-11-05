/*! Open Historia — which tracked countries the automatic refresh carries: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/countryStatsTrackingReady.test.js
//
// The tracking panel called a country "Stats ready" whenever it had any sheet
// at all, while the scheduler skipped every sheet that was not complete — so a
// tracked country could look ready and never refresh. Both now ask
// isTrackedStatSheetReady.

import test from "node:test";
import assert from "node:assert/strict";

import { isTrackedStatSheetReady } from "./countryStats.js";
import { DEFAULT_STAT_INDEX_KEYS } from "./statIndexDefinitions.js";

const completeSheet = () => ({
    statsSchemaVersion: 1,
    capital: "Paris",
    continent: "Europe",
    government: "Republic",
    leader: "Head of State",
    stability: 60,
    indices: Object.fromEntries(DEFAULT_STAT_INDEX_KEYS.map((key) => [key, 50])),
    territorialComponents: [{ geography: "France", group: "core", population: 68000000, gdpPerCapita: 44000 }],
    population: { total: 68000000 },
    economy: { gdp: 3e12, gdpPerCapita: 44000, gdpGrowth: 1, inflation: 2, unemployment: 7, publicDebt: 110, budgetBalance: -5, currency: "EUR" },
    gdpBreakdown: { agriculture: 2, industry: 18, services: 80 },
});

test("a complete standard sheet is ready; a partial one is not, though it is a sheet", () => {
    assert.equal(isTrackedStatSheetReady(completeSheet()), true);
    const partial = completeSheet();
    delete partial.leader;
    assert.equal(isTrackedStatSheetReady(partial), false);
    assert.equal(isTrackedStatSheetReady({ economy: { gdp: 3e12 } }), false);
});

test("a scenario-defined sheet is ready only with every one of the scenario's values", () => {
    const keys = ["timber", "silver"];
    assert.equal(isTrackedStatSheetReady({ customStats: { timber: 72, silver: 4210 } }, keys), true);
    assert.equal(isTrackedStatSheetReady({ customStats: { timber: 72 } }, keys), false);
    // A standard sheet does not satisfy a scenario that replaced it.
    assert.equal(isTrackedStatSheetReady(completeSheet(), keys), false);
});

test("no sheet is never ready", () => {
    assert.equal(isTrackedStatSheetReady(null), false);
    assert.equal(isTrackedStatSheetReady(undefined, ["timber"]), false);
});
