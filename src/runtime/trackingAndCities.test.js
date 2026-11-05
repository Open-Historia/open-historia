/*! Open Historia — historical tracking on by default, and cities that follow their country: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/trackingAndCities.test.js
//
// "Fiscal Dynamic: Historical tracking on for player by default set to 6
// months (country population stats also update) (city population and country
// population stats should be connected so city updates proportionally with
// country unless something happens to the city like if it's nuked, then it
// updates proportionally to the country stats from that moment onward)."

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CITY_FOLLOW_STEP, citiesFollowing, cityPopulationOverridesByTileName, countryPopulationMoves, effectiveCityPopulation } from "./cityPopulation.js";
import { COUNTRY_STATS_TRACKING_DEFAULT_MONTHS, COUNTRY_STATS_TRACKING_INTERVALS, COUNTRY_STATS_TRACKING_VERSION, normalizeCountryStatsTracking } from "./countryStats.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// ---- tracking ---------------------------------------------------------------------------

test("a game whose player has chosen nothing tracks his own country every six months", () => {
  assert.equal(COUNTRY_STATS_TRACKING_DEFAULT_MONTHS, 6);
  assert.ok(COUNTRY_STATS_TRACKING_INTERVALS.includes(COUNTRY_STATS_TRACKING_DEFAULT_MONTHS));
  for (const nothing of [undefined, null, {}, "x"]) {
    const tracking = normalizeCountryStatsTracking(nothing, { playerCountry: "Aland" });
    assert.deepEqual([tracking.intervalMonths, tracking.trackedPolities, tracking.trackingVersion], [6, ["Aland"], COUNTRY_STATS_TRACKING_VERSION], String(nothing));
  }
  // A setting stored before there was a default, with no interval, was the default of its day.
  assert.equal(normalizeCountryStatsTracking({ trackingVersion: 1, intervalMonths: 0, trackedPolities: [] }, { playerCountry: "Aland" }).intervalMonths, 6);
  // What a player chose then is still his choice.
  assert.deepEqual(normalizeCountryStatsTracking({ trackingVersion: 1, intervalMonths: 12, trackedPolities: ["Borduria"] }, { playerCountry: "Aland" }).trackedPolities, ["Aland", "Borduria"]);
  assert.equal(normalizeCountryStatsTracking({ trackingVersion: 1, intervalMonths: 12 }, { playerCountry: "Aland" }).intervalMonths, 12);
});

test("a player who turns it off has turned it off, and it stays off through every reading", () => {
  const on = normalizeCountryStatsTracking(undefined, { playerCountry: "Aland" });
  // (The stats pane hands back the setting it was given with the interval changed.)
  const off = normalizeCountryStatsTracking({ ...on, intervalMonths: 0 }, { playerCountry: "Aland" });
  // (The countries he had listed stay listed, for when he turns it on again; with no interval nothing is tracked.)
  assert.equal(off.intervalMonths, 0);
  assert.equal(normalizeCountryStatsTracking(off, { playerCountry: "Aland" }).intervalMonths, 0);
  assert.equal(normalizeCountryStatsTracking(JSON.parse(JSON.stringify(off)), { playerCountry: "Aland" }).intervalMonths, 0);
  // And a choice of interval is kept as it is.
  assert.equal(normalizeCountryStatsTracking({ ...on, intervalMonths: 24 }, { playerCountry: "Aland" }).intervalMonths, 24);
});

test("the player's country is given its first sheet for the tracking to begin from, asked for once as any first reading is", () => {
  const source = read("../Game/AI/gameplay.js");
  // (With what the war reads on it: runtime/statsBackend.js.)
  assert.ok(source.includes('if (waiting) agentClient.holdSkip(ensureCountryStatSheet(waiting, { reason: "historical tracking", needBackend: true, agentKind: "skip" }));'));
  assert.equal(source.split("  requestTrackedBaseline(pendingBaseline, game);\n").length - 1, 2, "in the standard sheet's runner and the custom sheet's");
});

// ---- cities -----------------------------------------------------------------------------

test("a country is due when its people have moved enough since its cities last followed", () => {
  assert.equal(CITY_FOLLOW_STEP, 0.005);
  const stats = { Aland: { population: { total: 10300000 } }, Borduria: { population: { total: 4010000 } }, Cisland: { population: { total: 2000000 } }, Nowhere: {} };
  // First sight of a country: it is noted, and its cities are what they are.
  const first = countryPopulationMoves(stats, {});
  assert.deepEqual(first, { due: [], basis: { Aland: 10300000, Borduria: 4010000, Cisland: 2000000 } });
  // Later: Aland has grown three per cent, Borduria a quarter of one, Cisland has lost a tenth.
  const later = countryPopulationMoves(stats, { Aland: 10000000, Borduria: 4000000, Cisland: 2222222 });
  assert.deepEqual(later.due.map((entry) => entry.name), ["Aland", "Cisland"]);
  assert.ok(Math.abs(later.due[0].ratio - 1.03) < 1e-9 && later.due[1].ratio < 0.91);
  // Borduria's small move is kept in hand: its basis stays, so the moves add up until they count.
  assert.deepEqual(later.basis, { Aland: 10300000, Borduria: 4000000, Cisland: 2000000 });
  assert.deepEqual(countryPopulationMoves(null, null), { due: [], basis: {} });
});

test("its cities move by the same share, each from what it is at that moment", () => {
  const cities = [
    { name: "Alba", population: 1000000, holder: "Aland" },
    { name: "Arn", population: 200000, holder: "aland" },
    { name: "Brod", population: 500000, holder: "Borduria" },
    { name: "Nobody's", population: 9000, holder: "" },
  ];
  const { cityPopulations, moved } = citiesFollowing({ cityPopulations: { brod: 500000 }, cities, due: [{ name: "Aland", ratio: 1.03 }] });
  assert.deepEqual(cityPopulations, { brod: 500000, alba: 1030000, arn: 206000 });
  assert.equal(moved, 2);
  // Every reader of a city's population looks at that figure first.
  assert.equal(effectiveCityPopulation({ name: "Alba", population: 1000000 }, { cityPopulations }), 1030000);
  assert.equal(effectiveCityPopulation({ name: "Brod", population: 480000 }, { cityPopulations }), 500000);
  assert.deepEqual(cityPopulationOverridesByTileName(cityPopulations, { "old alba": "Alba" })["old alba"], 1030000, "a renamed city's figure is found under the name on the map");
});

test("a city something happened to follows from what was left of it, and not on the turn it happened", () => {
  // Alba was struck this turn: an event set it to 150,000. The country's people fell by four per cent the same turn.
  const struck = citiesFollowing({
    cityPopulations: { alba: 150000 },
    cities: [{ name: "Alba", population: 150000, holder: "Aland" }, { name: "Arn", population: 200000, holder: "Aland" }],
    due: [{ name: "Aland", ratio: 0.96 }],
    skip: new Set(["alba"]),
  });
  assert.deepEqual(struck.cityPopulations, { alba: 150000, arn: 192000 }, "the event's figure stands; the other city follows");
  // Half a year on the country has grown by two per cent: Alba grows with it, from the 150,000.
  const after = citiesFollowing({
    cityPopulations: struck.cityPopulations,
    cities: [{ name: "Alba", population: 150000, holder: "Aland" }, { name: "Arn", population: 192000, holder: "Aland" }],
    due: [{ name: "Aland", ratio: 1.02 }],
  });
  assert.deepEqual(after.cityPopulations, { alba: 153000, arn: 195840 });
  // Nothing due: nothing written.
  assert.deepEqual(citiesFollowing({ cityPopulations: { alba: 1 }, cities: [{ name: "Arn", population: 5, holder: "Aland" }], due: [] }), { cityPopulations: { alba: 1 }, moved: 0 });
});

test("the turn does it after the statistics are brought up to date, with no request, and leaves what its own events set", () => {
  const turn = read("../Game/AI/gameplay.js");
  const refreshed = turn.indexOf("nextWorld = await refreshTrackedCountryStatsIfDue({");
  const followed = turn.indexOf("nextWorld = await citiesFollowCountries({ world: nextWorld, baseWorld, game: nextGame, campaignId, loadRegions: createRenderedRegionsReader() });");
  assert.ok(refreshed > 0 && followed > refreshed);
  const apply = read("../Game/AI/frontApply.js");
  assert.ok(apply.includes("if (moves.due.length === 0) return noted ? { ...world, cityPopulationBasis: moves.basis } : world;"), "the map is read only when a country is due");
  assert.ok(apply.includes("const skip = new Set(Object.keys(now).filter((key) => Number(now[key]) !== Number(before[key])).map(cityPopulationKey));"));
  assert.ok(apply.includes("if (asArray(regions).length === 0) return world;"), "a map that cannot be read moves nothing and notes nothing");
});
