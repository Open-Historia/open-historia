/*! Open Historia — unit motion tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/unitMotion.test.js
//
// unitMotion.js is deliberately import-free, so this file runs in a bare
// checkout with no node_modules — unlike gameState's tests, which drag in
// assets.js -> maplibre-gl. Keep it that way.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PATROL_RADIUS_KM,
  daysBetweenDates,
  describeTravelPace,
  eraOf,
  eraSpeedFactor,
  hashSeed,
  haversineKm,
  kmPerDay,
  maxTravelKm,
  patrolPoint,
  seaShareOf,
  stepToward,
} from "./unitMotion.js";

// ---- haversineKm (moved here from gameState.js; keep its assertions) --------

test("haversineKm is zero for the same point", () => {
  assert.equal(haversineKm(51.5, -0.12, 51.5, -0.12), 0);
});

test("haversineKm matches a known city pair", () => {
  const km = haversineKm(51.5074, -0.1278, 48.8566, 2.3522); // London -> Paris
  assert.ok(km > 330 && km < 350, `expected ~344 km, got ${km}`);
});

// ---- era & pace ------------------------------------------------------------

test("eraSpeedFactor bands by year, and reads BCE as negative", () => {
  assert.equal(eraSpeedFactor("1200 BCE"), 0.35);
  assert.equal(eraSpeedFactor("1400-06-01"), 0.35);
  assert.equal(eraSpeedFactor("1700-06-01"), 0.5);
  assert.equal(eraSpeedFactor("1900-06-01"), 0.75);
  assert.equal(eraSpeedFactor("2024-06-01"), 1);
});

test("eraSpeedFactor defaults to the modern band when no year parses", () => {
  assert.equal(eraSpeedFactor(""), 1);
  assert.equal(eraSpeedFactor(null), 1);
});

test("eraOf reads the four eras off the game's date", () => {
  assert.equal(eraOf("1200 BCE"), 0);
  assert.equal(eraOf("-0218-03-01"), 0);
  assert.equal(eraOf("1499-12-31"), 0);
  assert.equal(eraOf("1500-01-01"), 1);
  assert.equal(eraOf("1849-06-01"), 1);
  assert.equal(eraOf("1850-01-01"), 2);
  assert.equal(eraOf("1944-06-06"), 2);
  assert.equal(eraOf("1945-01-01"), 3);
  assert.equal(eraOf(""), 3);
});

test("kmPerDay scales with both type and era", () => {
  assert.equal(kmPerDay("infantry", "2024-01-01"), 500); // rail and road
  assert.equal(kmPerDay("infantry", "1400-01-01"), 25); // a medieval march
  assert.equal(kmPerDay("naval", "1400-01-01"), 130); // oar and coasting sail
  assert.equal(kmPerDay("naval", "2024-01-01"), 750);
  assert.equal(kmPerDay("garrison", "2024-01-01"), 0); // garrisons do not travel
});

test("kmPerDay falls back to the infantry pace for an unknown type", () => {
  assert.equal(kmPerDay("siege-tower", "2024-01-01"), 500);
  assert.equal(kmPerDay("siege-tower", "2024-01-01", { posture: "assaulting" }), 30);
});

test("an advance against an enemy is far slower than a redeployment", () => {
  // The same division: carried across a continent, or fighting its way forward.
  assert.equal(kmPerDay("armor", "2024-01-01", { posture: "transit" }), 500);
  assert.equal(kmPerDay("armor", "2024-01-01", { posture: "assaulting" }), 50);
  assert.equal(kmPerDay("infantry", "1942-01-01", { posture: "assaulting" }), 20);
  assert.equal(kmPerDay("infantry", "1942-01-01", { posture: "withdrawing" }), 300);
  // A fleet and an air wing are not slowed by the posture of an army.
  assert.equal(kmPerDay("naval", "2024-01-01", { posture: "assaulting" }), 750);
});

test("a redeployment is paced by how much of its way is over water", () => {
  // Before the railway a voyage is several times a march; the days add.
  assert.equal(kmPerDay("infantry", "1805-01-01", { seaShare: 0 }), 28);
  assert.equal(kmPerDay("infantry", "1805-01-01", { seaShare: 1 }), 170);
  assert.equal(kmPerDay("infantry", "1805-01-01", { seaShare: 0.5 }), Math.round(1 / (0.5 / 28 + 0.5 / 170)));
  // A modern division from Texas to Korea, some 11,200 km and mostly by sea,
  // is three weeks on the way, not four to eleven months.
  const days = 11200 / kmPerDay("armor", "2016-01-01", { seaShare: 0.6 });
  assert.ok(days > 14 && days < 28, `expected about three weeks, got ${days.toFixed(1)} days`);
  // An order nobody measured: a long journey is taken to be half by sea.
  assert.equal(kmPerDay("infantry", "1805-01-01", { remainingKm: 400 }), 28);
  assert.equal(kmPerDay("infantry", "1805-01-01", { remainingKm: 4000 }), kmPerDay("infantry", "1805-01-01", { seaShare: 0.5 }));
  // Out of range is brought into it.
  assert.equal(kmPerDay("infantry", "1805-01-01", { seaShare: 7 }), 170);
});

test("seaShareOf measures the water on the way", () => {
  // Land west of 10 E, sea east of it; a straight run along the equator.
  const isLand = ([lng]) => lng < 10;
  assert.equal(seaShareOf({ lng: 0, lat: 0 }, { lng: 9, lat: 0 }, isLand), 0);
  assert.equal(seaShareOf({ lng: 11, lat: 0 }, { lng: 30, lat: 0 }, isLand), 1);
  const half = seaShareOf({ lng: 0, lat: 0 }, { lng: 20, lat: 0 }, isLand);
  assert.ok(half > 0.4 && half < 0.6, `about half, got ${half}`);
  // A hop of a few kilometres is not a voyage, and no map means no answer.
  assert.equal(seaShareOf({ lng: 11, lat: 0 }, { lng: 11.2, lat: 0 }, isLand), 0);
  assert.equal(seaShareOf({ lng: 0, lat: 0 }, { lng: 20, lat: 0 }, null), null);
  assert.equal(seaShareOf({ lng: NaN, lat: 0 }, { lng: 20, lat: 0 }, isLand), null);
});

test("the model is told the paces of the game's own era", () => {
  const modern = describeTravelPace("2016-01-01");
  assert.match(modern, /about 500 km a day by rail and road and about 650 by sea/);
  assert.match(modern, /posture "assaulting"\) covers about 30 km a day on foot and 50 with armour/);
  assert.match(modern, /HAS ARRIVED only when the days since its order allow it/);
  const ancient = describeTravelPace("-0218-03-01");
  assert.match(ancient, /about 25 km a day on the march and about 110 by sea/);
  assert.doesNotMatch(ancient, /air wing/);
});

test("maxTravelKm gives the 30-day footprint radius used by the spawn gate", () => {
  // A modern navy reads as globally supported; a medieval army does not.
  assert.ok(maxTravelKm("naval", "2024-01-01", 30) > 15000);
  assert.equal(maxTravelKm("infantry", "1400-01-01", 30), 750);
  assert.equal(maxTravelKm("infantry", "2024-01-01", 30, { posture: "assaulting" }), 900);
});

test("maxTravelKm treats a missing or negative span as no budget", () => {
  assert.equal(maxTravelKm("armor", "2024-01-01", 0), 0);
  assert.equal(maxTravelKm("armor", "2024-01-01", -5), 0);
  assert.equal(maxTravelKm("armor", "2024-01-01", null), 0);
});

// ---- daysBetweenDates ------------------------------------------------------

test("daysBetweenDates counts whole days between plain dates", () => {
  assert.equal(daysBetweenDates("2024-01-01", "2024-03-01"), 60);
  assert.equal(daysBetweenDates("2024-01-01", "2024-01-01"), 0);
});

test("daysBetweenDates returns null for non-Gregorian dates, meaning do not clamp", () => {
  assert.equal(daysBetweenDates("1200 BCE", "1199 BCE"), null);
  assert.equal(daysBetweenDates("2024-01-01", "Third Age 3019"), null);
  assert.equal(daysBetweenDates("", "2024-01-01"), null);
});

test("daysBetweenDates never goes negative when the dates are reversed", () => {
  assert.equal(daysBetweenDates("2024-03-01", "2024-01-01"), 0);
});

// ---- stepToward ------------------------------------------------------------

test("stepToward crosses the antimeridian over the Pacific, not back over Asia", () => {
  const yokosuka = { lng: 139.67, lat: 35.28 };
  const sanDiego = { lng: -117.16, lat: 32.71 };
  const step = stepToward(yokosuka, sanDiego, 3000);
  // Eastward across the Pacific means the longitude runs past 180 and wraps
  // negative; a lerp would have dragged it down toward 0 across Eurasia.
  assert.ok(
    step.lng > 140 || step.lng < -150,
    `expected a Pacific crossing, got lng ${step.lng}`,
  );
  assert.ok(step.lat > 20 && step.lat < 60, `expected a northern arc, got lat ${step.lat}`);
});

test("stepToward covers exactly the budget it is given", () => {
  const from = { lng: 0, lat: 0 };
  const to = { lng: 40, lat: 0 };
  const step = stepToward(from, to, 1000);
  const covered = haversineKm(from.lat, from.lng, step.lat, step.lng);
  assert.ok(Math.abs(covered - 1000) < 1, `expected ~1000 km covered, got ${covered}`);
  assert.equal(step.arrived, false);
});

test("stepToward clamps to the destination instead of overshooting", () => {
  const step = stepToward({ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, 99999);
  assert.equal(step.arrived, true);
  assert.equal(step.remainingKm, 0);
  assert.ok(Math.abs(step.lng - 1) < 1e-9);
});

test("stepToward with no budget holds position and reports the distance left", () => {
  const step = stepToward({ lng: 0, lat: 0 }, { lng: 10, lat: 0 }, 0);
  assert.equal(step.arrived, false);
  assert.equal(step.lng, 0);
  assert.ok(step.remainingKm > 1000);
});

test("stepToward on a zero-length move reports arrival", () => {
  const step = stepToward({ lng: 5, lat: 5 }, { lng: 5, lat: 5 }, 0);
  assert.equal(step.arrived, true);
});

test("stepToward reports the remaining distance for the standing order", () => {
  const step = stepToward({ lng: 0, lat: 0 }, { lng: 40, lat: 0 }, 1000);
  const total = haversineKm(0, 0, 0, 40);
  assert.ok(Math.abs(step.remainingKm - (total - 1000)) < 1);
});

// ---- patrolPoint -----------------------------------------------------------

const station = { lng: -30, lat: 50 };

test("patrolPoint is byte-identical for the same seed", () => {
  const a = patrolPoint(station, 250, "unit-1|3|0");
  const b = patrolPoint(station, 250, "unit-1|3|0");
  assert.deepEqual(a, b);
});

test("patrolPoint moves the unit when the round or idle tick advances", () => {
  const round3 = patrolPoint(station, 250, "unit-1|3|0");
  const round4 = patrolPoint(station, 250, "unit-1|4|0");
  const tick1 = patrolPoint(station, 250, "unit-1|3|1");
  assert.notDeepEqual(round3, round4);
  assert.notDeepEqual(round3, tick1);
});

test("patrolPoint stays inside its station radius", () => {
  for (let round = 0; round < 60; round += 1) {
    const point = patrolPoint(station, 250, `unit-1|${round}|0`);
    const distance = haversineKm(station.lat, station.lng, point.lat, point.lng);
    assert.ok(distance <= 250 + 1, `round ${round} drifted ${distance} km off station`);
  }
});

test("patrolPoint holds a high-latitude station instead of smearing in longitude", () => {
  const polar = { lng: 20, lat: 84 };
  for (let round = 0; round < 40; round += 1) {
    const point = patrolPoint(polar, 300, `arctic|${round}|0`);
    const distance = haversineKm(polar.lat, polar.lng, point.lat, point.lng);
    assert.ok(distance <= 300 + 1, `round ${round} drifted ${distance} km off station`);
    assert.ok(point.lat <= 85, "latitude must stay inside the map's clamp");
  }
});

test("patrolPoint with no radius sits on the station itself", () => {
  const point = patrolPoint(station, 0, "unit-1|3|0");
  assert.equal(point.lng, station.lng);
  assert.equal(point.lat, station.lat);
});

test("every unit type has a default patrol radius, and garrisons hold still", () => {
  for (const type of ["garrison", "artillery", "infantry", "armor", "naval", "air"]) {
    assert.equal(typeof DEFAULT_PATROL_RADIUS_KM[type], "number");
  }
  assert.equal(DEFAULT_PATROL_RADIUS_KM.garrison, 0);
});

test("hashSeed is stable and unsigned", () => {
  assert.equal(hashSeed("unit-1|3|0"), hashSeed("unit-1|3|0"));
  assert.ok(hashSeed("unit-1|3|0") >= 0);
  assert.notEqual(hashSeed("a"), hashSeed("b"));
});
