/*! Open Historia — unit motion tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
  eraSpeedFactor,
  hashSeed,
  haversineKm,
  kmPerDay,
  maxTravelKm,
  patrolPoint,
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

test("kmPerDay scales with both type and era", () => {
  assert.equal(kmPerDay("infantry", "2024-01-01"), 40);
  assert.equal(kmPerDay("infantry", "1400-01-01"), 14); // a real medieval march
  assert.equal(kmPerDay("naval", "1400-01-01"), 210); // ~4.7 kt, age of sail
  assert.equal(kmPerDay("garrison", "2024-01-01"), 0); // garrisons do not travel
});

test("kmPerDay falls back to the infantry pace for an unknown type", () => {
  assert.equal(kmPerDay("siege-tower", "2024-01-01"), 40);
});

test("maxTravelKm gives the 30-day footprint radius used by the spawn gate", () => {
  // A modern navy reads as globally supported; a medieval army does not.
  assert.ok(maxTravelKm("naval", "2024-01-01", 30) > 15000);
  assert.equal(maxTravelKm("infantry", "1400-01-01", 30), 420);
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
