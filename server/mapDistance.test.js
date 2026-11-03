/*! Open Historia — distances on a scenario's map, tested © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/mapDistance.test.js
//
// Runs without node_modules: mapDistance.js imports only mapProjection.js.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FLAT_EARTH,
  FREEFORM,
  PROJECTIONS,
  convertScaleLine,
  displayToGeo,
  geoToDisplay,
  layOutScenarioBundle,
  mapViewOf,
  normalizeProjection,
  normalizeScaleLine,
  projectionIsDefault,
  sheetBounds,
} from "./mapProjection.js";
import {
  PLAIN_MEASURE,
  SHEET_KM_PER_DEGREE,
  engineMapOf,
  greatCircleKm,
  kmPerDegreeAt,
  latToY,
  mapKm,
  mapMeasureOf,
  mapOffset,
  mapRing,
  mapStep,
  metricTableFor,
  yToLat,
} from "./mapDistance.js";

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} is not within ${tolerance} of ${expected}`);
const LONDON = [-0.1276, 51.5072];
const PARIS = [2.3522, 48.8566];
const LONDON_PARIS_KM = greatCircleKm(...LONDON, ...PARIS);

// ---------------------------------------------------------------------------
// The round flat-earth map

test("the flat-earth map is offered for the game and the Workshop, and is a world projection", () => {
  assert.ok(PROJECTIONS.some((entry) => entry.id === FLAT_EARTH && entry.name === "Flat Earth"));
  assert.equal(normalizeProjection("Flat Earth").type, FLAT_EARTH, "read from its name too");
  assert.equal(mapMeasureOf(FLAT_EARTH).flat, false, "measured on the globe, not as a sheet");
  // A disc is never shown as a globe or repeated sideways.
  assert.deepEqual(mapViewOf({ type: FLAT_EARTH }), { noGlobe: true, noWrap: true });
  // Its sheet is the whole square, the disc drawn inside it.
  assert.deepEqual(sheetBounds(FLAT_EARTH), sheetBounds("mercator"));
});

test("the flat-earth map: the North Pole in the middle, Greenwich straight down, the Americas on the left, and back", () => {
  assert.deepEqual(geoToDisplay(FLAT_EARTH, 0, 90).map((value) => Math.abs(value) < 1e-9 ? 0 : value), [0, 0], "the pole is the middle");
  const greenwich = geoToDisplay(FLAT_EARTH, 0, 0);
  near(greenwich[0], 0, 1e-9, "Greenwich is straight down");
  assert.ok(greenwich[1] < 0, "below the pole");
  assert.ok(geoToDisplay(FLAT_EARTH, -90, 0)[0] < 0, "the Americas are on the left");
  assert.ok(geoToDisplay(FLAT_EARTH, 90, 0)[0] > 0, "Asia is on the right");
  for (const [lon, lat] of [[0, 0], [10, 45], [-120, 30], [170, -60], [-45, 80], [90, -15], [-179, 5], [-74.006, 40.7128], [151.2, -33.87]]) {
    const [x, y] = geoToDisplay(FLAT_EARTH, lon, lat);
    assert.ok(Math.abs(x) <= 180 && Math.abs(y) <= 85.06, `${lon},${lat} lands on the square`);
    const [backLon, backLat] = displayToGeo(FLAT_EARTH, x, y);
    near(backLat, lat, 2e-4, `latitude of ${lon},${lat}`);
    near(backLon, lon, 2e-4, `longitude of ${lon},${lat}`);
  }
});

test("the flat-earth map is equidistant: the way from the pole on the map is the way on the globe", () => {
  // Across the map as it is drawn: x and the height the map draws y at.
  const fromPole = (lon, lat) => {
    const [x, y] = geoToDisplay(FLAT_EARTH, lon, lat);
    return Math.hypot(x, latToY(y));
  };
  const each = [[0, 60], [45, 30], [-100, 0], [135, -30], [-20, -70]].map(([lon, lat]) => fromPole(lon, lat) / (90 - lat));
  for (const ratio of each) near(ratio, each[0], 1e-6, "map distance from the pole over the degrees from it");
  // The South Pole is the rim: the whole circle, as far out as the sheet goes.
  near(fromPole(0, -90), 180, 1e-6, "the rim");
});

// ---------------------------------------------------------------------------
// Freeform: a flat sheet, at one scale everywhere

test("on a freeform map every distance is a straight line at one scale, the same everywhere", () => {
  const sheet = mapMeasureOf({ type: FREEFORM, aspect: 2 });
  assert.equal(sheet.flat, true);
  assert.equal(sheet.scale, SHEET_KM_PER_DEGREE, "without a scale line, a degree is a degree at the equator");
  // Ten degrees across, in the middle of the sheet and near its top: the same.
  const across = mapKm(sheet, 0, 0, 10, 0);
  near(across, 10 * SHEET_KM_PER_DEGREE, 1e-6);
  near(mapKm(sheet, 0, yToLat(70), 10, yToLat(70)), across, 1e-6, "no shrinking toward the top");
  near(mapKm(sheet, -170, yToLat(-60), -160, yToLat(-60)), across, 1e-6, "nor toward the bottom");
  // And ten up is as long as ten across, wherever it is.
  near(mapKm(sheet, 50, yToLat(0), 50, yToLat(10)), across, 1e-6, "up as far as across");
  near(mapKm(sheet, 50, yToLat(60), 50, yToLat(70)), across, 1e-6, "up near the top");
  // A 3-4-5 triangle.
  near(mapKm(sheet, 0, yToLat(0), 3, yToLat(4)), 5 * SHEET_KM_PER_DEGREE, 1e-6);
  // No going round the edge: the far side of the sheet is far.
  near(mapKm(sheet, -170, 0, 170, 0), 340 * SHEET_KM_PER_DEGREE, 1e-6);
});

test("on a freeform map a step, an offset and a ring keep to the sheet's straight lines", () => {
  const sheet = mapMeasureOf({ type: FREEFORM, aspect: 2, scale: { from: [0, 0], to: [10, 0], km: 1000 } });
  const step = mapStep(sheet, { lng: 0, lat: yToLat(0) }, { lng: 30, lat: yToLat(40) }, 1000);
  assert.equal(step.arrived, false);
  near(mapKm(sheet, 0, 0, step.lng, step.lat), 1000, 1e-6, "a step is as long as it was allowed");
  near(step.remainingKm, 4000, 1e-6, "the rest of the 5,000 km");
  near(step.lng, 6, 1e-9, "along the straight line");
  near(latToY(step.lat), 8, 1e-9);
  const [east, eastLat] = mapOffset(sheet, 20, yToLat(50), 90, 500);
  near(east, 25, 1e-9, "500 km east");
  near(latToY(eastLat), 50, 1e-9);
  const ring = mapRing(sheet, 0, yToLat(60), 300, 16);
  assert.equal(ring.length, 17, "closed on its first point");
  for (const [lng, lat] of ring) near(mapKm(sheet, 0, yToLat(60), lng, lat), 300, 1e-6, "every point of the ring as far");
  near(kmPerDegreeAt(sheet, 10, 0).x, 100, 1e-6, "a degree across is 100 km");
});

// ---------------------------------------------------------------------------
// World projections: the great circle on the true globe

test("on every world projection a distance is the great circle between the places' true ends", () => {
  for (const { id } of PROJECTIONS) {
    if (id === FREEFORM) continue;
    const measure = mapMeasureOf(id);
    const a = geoToDisplay(id, ...LONDON);
    const b = geoToDisplay(id, ...PARIS);
    near(mapKm(measure, ...a, ...b), LONDON_PARIS_KM, 1e-3, id);
  }
  assert.equal(PLAIN_MEASURE.plain, true, "Mercator at the Earth's size is the game's old measure");
  near(LONDON_PARIS_KM, 343.5, 1.5, "and the great circle is the real one");
});

test("the land war's engine is told the measure as plain numbers", () => {
  assert.deepEqual(engineMapOf(mapMeasureOf("mercator")), {}, "nothing for Mercator: every battle there as before");
  assert.deepEqual(engineMapOf(mapMeasureOf({ type: FREEFORM, aspect: 2, scale: { from: [0, 0], to: [4, 0], km: 200 } })), { flat: true, scale: 50 });
  const robinson = engineMapOf(mapMeasureOf("robinson"));
  assert.equal(robinson.metric, metricTableFor("robinson"));
  assert.equal(robinson.metric.kx.length, robinson.metric.m.length);
  assert.ok(robinson.metric.kx.every(Number.isFinite) && robinson.metric.m.every(Number.isFinite));
  // Every figure rounded, so the engine's sums are the same on every machine.
  assert.ok(robinson.metric.kx.every((value) => Math.round(value * 1e6) / 1e6 === value));
});

// ---------------------------------------------------------------------------
// The scale line

test("a scale line sets a freeform map's scale, and every distance on it follows", () => {
  const line = { from: [-20, yToLat(10)], to: [10, yToLat(-30)], km: 2500 };
  const sheet = mapMeasureOf({ type: FREEFORM, aspect: 1.5, scale: line });
  // (Its ends kept to six places, as a save keeps them.)
  near(mapKm(sheet, ...line.from, ...line.to), 2500, 1e-4, "the line measures what it was said to");
  near(sheet.scale, 2500 / 50, 1e-6, "fifty degrees of the sheet are 2,500 km");
  near(mapKm(sheet, 0, yToLat(70), 10, yToLat(70)), 500, 1e-4, "and ten anywhere are 500");
});

test("on a world projection a scale line makes the map's world larger or smaller than the Earth", () => {
  for (const type of ["mercator", "equirectangular", FLAT_EARTH]) {
    const from = geoToDisplay(type, ...LONDON);
    const to = geoToDisplay(type, ...PARIS);
    const measure = mapMeasureOf({ type, scale: { from, to, km: LONDON_PARIS_KM * 10 } });
    near(measure.factor, 10, 1e-3, type);
    assert.equal(measure.plain, false, `${type}: no longer the Earth's own measure`);
    const a = geoToDisplay(type, 0, 0);
    const b = geoToDisplay(type, 10, 0);
    near(mapKm(measure, ...a, ...b), greatCircleKm(0, 0, 10, 0) * 10, 1e-2, `${type}: every distance ten times`);
  }
  assert.deepEqual(engineMapOf(mapMeasureOf({ type: "mercator", scale: { from: LONDON, to: PARIS, km: LONDON_PARIS_KM / 2 } })), { factor: 0.5 });
});

test("a scale line is read, refused, and rides with the projection", () => {
  assert.equal(normalizeScaleLine(null), null);
  assert.equal(normalizeScaleLine({ from: [0, 0], to: [0, 0], km: 10 }), null, "a line with no length");
  assert.equal(normalizeScaleLine({ from: [0, 0], to: [1, 0], km: 0 }), null, "a line with no distance");
  assert.equal(normalizeScaleLine({ from: [0, 0], to: [1, 0], km: -4 }), null);
  assert.equal(normalizeScaleLine({ from: [0], to: [1, 0], km: 4 }), null);
  assert.deepEqual(normalizeScaleLine({ from: ["1.5", 2], to: [3, 89], km: "120.4567" }), { from: [1.5, 2], to: [3, 85.051129], km: 120.457 });
  const scale = { from: [1, 2], to: [3, 4], km: 50 };
  // Kept by the normalizer, for a freeform map and a world projection alike,
  // through a save's JSON and back.
  for (const projection of [{ type: FREEFORM, aspect: 2, scale }, { type: "robinson", scale }, { type: "mercator", scale }]) {
    const read = normalizeProjection(JSON.parse(JSON.stringify(normalizeProjection(projection))));
    assert.deepEqual(read.scale, scale, projection.type);
  }
  assert.equal(projectionIsDefault({ type: "mercator", scale }), false, "a Mercator map with a scale line saves its projection");
  assert.equal(projectionIsDefault({ type: "mercator" }), true);
  assert.equal("scale" in normalizeProjection({ type: "mercator", scale: { from: [0, 0], to: [0, 0], km: 1 } }), false);
});

test("a scale line goes where its ends go: converted with the map, and laid out with a file that declares it", () => {
  const scale = { from: [...LONDON], to: [...PARIS], km: LONDON_PARIS_KM * 3 };
  const before = mapMeasureOf({ type: "mercator", scale });
  // Converted to another world projection, the line's true ends stay where
  // they are, so the world is still three times the Earth.
  const robinson = convertScaleLine({ type: "mercator" }, { type: "robinson" }, scale);
  const after = mapMeasureOf({ type: "robinson", scale: robinson });
  near(after.factor, before.factor, 1e-6);
  near(displayToGeo("robinson", ...robinson.from)[0], LONDON[0], 1e-3);
  // A file that declares its projection is laid out with its scale line.
  const bundle = { data: { world: { projection: { type: "equirectangular", scale: { from: [0, 0], to: [10, 0], km: 2000 } } } } };
  const laid = layOutScenarioBundle(bundle).data.world.projection;
  assert.equal(laid.laidOut, true);
  assert.deepEqual(laid.scale.to, geoToDisplay("equirectangular", 10, 0).map((value) => Math.round(value * 1e6) / 1e6));
  near(mapMeasureOf(laid).factor, 2000 / greatCircleKm(0, 0, 10, 0), 1e-3);
});
