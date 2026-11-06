/*! Open Historia — how a scenario's wars are fought: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warSettings.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./fronts/codec.js";
import { runFronts } from "./fronts/engine.js";
import { frontInput, syntheticMap } from "./fronts/syntheticMap.js";
import { eraOf, kmPerDay, yearInEra } from "./unitMotion.js";
import { TECHNOLOGY_WEIGHT_MODERN, TECHNOLOGY_WEIGHT_MOST, WAR_MECHANICS, eraSettingOf, normalizeMusterPoints, normalizeWarSettings, warSettingsOf } from "./warSettings.js";

test("an era is read off a year of any length, and a scenario may set it outright", () => {
  // Years of one or two digits are years (they were read as the present).
  assert.equal(eraOf("45-03-01"), 0);
  assert.equal(eraOf("5-01-01"), 0);
  assert.equal(eraOf("99-12-31 BC"), 0);
  assert.equal(eraOf("0298-06-01"), 0);
  assert.equal(eraOf("1652-01-01"), 1);
  assert.equal(eraOf("1914-08-01"), 2);
  assert.equal(eraOf("2024-03-01"), 3);
  // A calendar of its own carries no year the game can read: the present, unless the scenario says.
  assert.equal(eraOf("Year 12"), 3);
  assert.equal(eraOf("Year 12", 0), 0);
  assert.equal(eraOf("2024-03-01", 1), 1);
  // An era outside 0 to 3 is no era.
  assert.equal(eraOf("2024-03-01", 7), 3);
  // A formation's pace follows the era set, not the date.
  assert.equal(kmPerDay("infantry", "2024-03-01", { posture: "assaulting", era: 0 }), kmPerDay("infantry", "1400-03-01", { posture: "assaulting" }));
});

test("the year a scenario's carriers go by stays within the era it set", () => {
  assert.equal(yearInEra(2024, 0), 1499);
  assert.equal(yearInEra(1200, 1), 1500);
  assert.equal(yearInEra(1900, 2), 1900);
  assert.equal(yearInEra(null, 2), 1900, "a calendar with no year: the era's middle");
  assert.equal(yearInEra(1200, null), 1200, "no era set: the year as it is");
});

test("war settings: kept as set, every mechanic on unless the scenario turned it off", () => {
  assert.equal(normalizeWarSettings(null), null);
  assert.equal(normalizeWarSettings([1]), null);
  const kept = normalizeWarSettings({ mechanics: { fatigue: false, air: true, bogus: false, weather: "no" }, era: 2, menPerCounter: 500.4, manpowerShare: 60, muster: [[1, 90], [0.5, 21]] });
  assert.deepEqual(kept, { mechanics: { fatigue: false, air: true }, era: 2, menPerCounter: 500, manpowerShare: 60, technologyWeight: null, muster: [[0.5, 21], [1, 90]] });
  const settings = warSettingsOf({ warSettings: kept });
  assert.deepEqual(Object.keys(settings.mechanics), [...WAR_MECHANICS]);
  assert.equal(settings.mechanics.fatigue, false);
  assert.equal(settings.mechanics.weather, true, "one the scenario says nothing of is on");
  assert.deepEqual(warSettingsOf({}).mechanics, Object.fromEntries(WAR_MECHANICS.map((key) => [key, true])));
  assert.equal(eraSettingOf({ warSettings: { era: 0 } }), 0);
  assert.equal(eraSettingOf({ warSettings: { era: null } }), null);
  assert.equal(eraSettingOf({ warSettings: { era: "" } }), null);
  assert.equal(eraSettingOf({}), null);
  assert.equal(normalizeWarSettings({ era: 4, manpowerShare: 0, menPerCounter: -3 }).era, null);
  assert.equal(normalizeWarSettings({ manpowerShare: 0 }).manpowerShare, null);
  assert.equal(normalizeWarSettings({ menPerCounter: -3 }).menPerCounter, null);
  // The importance of technology (militaryPower.js): 0 to TECHNOLOGY_WEIGHT_MOST, to a tenth; 0 counts the men alone.
  assert.equal(normalizeWarSettings({ technologyWeight: 2.46 }).technologyWeight, 2.5);
  assert.equal(normalizeWarSettings({ technologyWeight: 0 }).technologyWeight, 0);
  assert.equal(normalizeWarSettings({ technologyWeight: TECHNOLOGY_WEIGHT_MOST + 1 }).technologyWeight, null);
  assert.equal(normalizeWarSettings({ technologyWeight: -1 }).technologyWeight, null);
  assert.equal(normalizeWarSettings({ technologyWeight: "" }).technologyWeight, null);
  assert.equal(warSettingsOf({}).technologyWeight, null, "the modern world's, TECHNOLOGY_WEIGHT_MODERN");
  assert.equal(TECHNOLOGY_WEIGHT_MODERN, 4.5);
});

test("a mustering curve's two points: the smaller share first, with fewer days", () => {
  assert.deepEqual(normalizeMusterPoints([[0.5, 21], [1, 90]]), [[0.5, 21], [1, 90]]);
  assert.equal(normalizeMusterPoints([[0.5, 90], [1, 21]]), null, "more of the army sooner is no curve");
  assert.equal(normalizeMusterPoints([[0.5, 21], [0.5, 90]]), null);
  assert.equal(normalizeMusterPoints([[0, 21], [1, 90]]), null);
  assert.equal(normalizeMusterPoints([[0.5, 21]]), null);
  assert.equal(normalizeMusterPoints("soon"), null);
});

test("a run told its era fights in it, whatever the date says", () => {
  const legend = { A: "Aland", B: "Borduria" };
  const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "era" });
  const kinds = (result) => {
    const counts = [0, 0, 0];
    for (const record of result.battlefields) for (const text of record.troops) for (const troop of decodeTroops(text)) counts[troop.kind] += 1;
    return counts;
  };
  const modern = runFronts(frontInput(sheet(), { days: 1 }));
  const medieval = runFronts(frontInput(sheet(), { days: 1, era: 0 }));
  const then = runFronts(frontInput(sheet(), { days: 1, fromDate: "1400-03-01" }));
  // The unit mix of the era set: fewer armoured counters (heavy horse before the tank) than the present's.
  assert.deepEqual(kinds(medieval), kinds(then));
  assert.ok(kinds(medieval)[1] < kinds(modern)[1], `${kinds(medieval)} against ${kinds(modern)}`);
  // An era that is no era is the date's.
  assert.deepEqual(runFronts(frontInput(sheet(), { days: 1, era: 9 })).battlefields, modern.battlefields);
});
