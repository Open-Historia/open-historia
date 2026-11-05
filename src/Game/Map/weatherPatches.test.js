/*! Open Historia — the weather of a scenario's climate zones, as patches on the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/weatherPatches.test.js
//
// "Think of the shapes more like minecraft biomes, where the biomes are all
// dynamic shapes that are connected to each other and are smoothed out", and
// "the weather patches should be drawn by scenario designers who can choose
// the climate regions".

import test from "node:test";
import assert from "node:assert/strict";

import { PATCH_BANDS, PATCH_EDGE_LAT, contourRings, ringsToPolygons, smoothRing, weatherPatchFeatures, zoneWeatherById } from "./weatherPatches.js";
import { zoneWeatherFor } from "../../runtime/zoneWeather.js";

// A field of `width` x `height` with 1 where `inside(x, y)`.
const field = (width, height, inside) => Float32Array.from({ length: width * height }, (_, at) => (inside(at % width, Math.floor(at / width)) ? 1 : 0));
const area = (ring) => {
  let sum = 0;
  for (let at = 0, back = ring.length - 1; at < ring.length; back = at, at += 1) sum += (ring[back][0] - ring[at][0]) * (ring[back][1] + ring[at][1]);
  return sum / 2;
};
const box = (ring) => ({
  west: Math.min(...ring.map((point) => point[0])),
  east: Math.max(...ring.map((point) => point[0])),
  south: Math.min(...ring.map((point) => point[1])),
  north: Math.max(...ring.map((point) => point[1])),
});

test("an outline is traced where a field crosses its level, closed, through the edges' middles", () => {
  const block = field(7, 7, (x, y) => x >= 2 && x <= 4 && y >= 2 && y <= 4);
  const rings = contourRings(block, 7, 7, 0.5);
  assert.equal(rings.length, 1);
  const { west, east, south, north } = box(rings[0]);
  assert.deepEqual([west, east, south, north], [1.5, 4.5, 1.5, 4.5], "half way between a pixel in and the next out");
  // A field that reaches its edge is closed past it.
  const full = contourRings(field(3, 3, () => true), 3, 3, 0.5);
  assert.equal(full.length, 1);
  assert.deepEqual(Object.values(box(full[0])), [-0.5, 2.5, -0.5, 2.5]);
  // Nothing at the level, nothing traced.
  assert.deepEqual(contourRings(field(4, 4, () => false), 4, 4, 0.5), []);
});

test("a hole is a ring of its own inside its outline, and two patches apart are two", () => {
  const ring = field(9, 9, (x, y) => x >= 1 && x <= 7 && y >= 1 && y <= 7 && !(x >= 3 && x <= 5 && y >= 3 && y <= 5));
  const polygons = ringsToPolygons(contourRings(ring, 9, 9, 0.5));
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].length, 2, "an outline and its hole");
  assert.ok(Math.abs(area(polygons[0][0])) > Math.abs(area(polygons[0][1])));
  const apart = field(10, 4, (x) => x <= 2 || x >= 7);
  assert.equal(ringsToPolygons(contourRings(apart, 10, 4, 0.5)).length, 2);
  // Two corners across from each other: traced either way, never left open.
  const saddle = Float32Array.from([1, 0, 0, 1]);
  for (const ringOf of contourRings(saddle, 2, 2, 0.5)) assert.ok(ringOf.length >= 3);
});

test("an outline is rounded off: its corners cut, never grown past itself", () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const round = smoothRing(square, 2);
  assert.equal(round.length, 16);
  const { west, east, south, north } = box(round);
  assert.ok(west >= 0 && east <= 4 && south >= 0 && north <= 4);
  assert.ok(Math.abs(area(round)) < 16 && Math.abs(area(round)) > 12);
});

// Two zones side by side along 30 E, and a third far off.
const zone = (id, name, west, east, extra = {}) => ({ id, name, color: "#8899aa", blendKm: 200, transitionDays: 10, rings: [[[west, 46], [east, 46], [east, 52], [west, 52], [west, 46]]], seasons: [], events: [], ...extra });
const ZONES = [zone("west", "The West", 22, 30), zone("east", "The East", 30, 38), zone("far", "The Far South", 80, 86)];
const weatherOf = (entries) => new Map(entries.map(([id, state, season]) => [id, { state, season }]));

test("each zone is a patch of its weather in its own shape; zones that meet, meet, each fading into the other", () => {
  const { areas, chips } = weatherPatchFeatures({ zones: ZONES, weather: weatherOf([["west", "snow", "Winter"], ["east", "rain", "Spring"], ["far", "clear", "Summer"]]) });
  // No word of it: the patterns say the weather (frontWeatherFeatures.test.js).
  assert.equal(chips, undefined);
  // Five outlines a weather (a tenth to nine tenths), none for clear weather; laid one over another they
  // come to the whole weather in even steps.
  const levels = PATCH_BANDS.map(([level]) => level);
  assert.deepEqual(areas.features.map((feature) => [feature.properties.weather, feature.properties.level]), [...levels.map((level) => ["snow", level]), ...levels.map((level) => ["rain", level])]);
  let left = 1;
  const steps = PATCH_BANDS.map(([, strength]) => {
    left *= 1 - strength;
    return Math.round((1 - left) * 100) / 100;
  });
  assert.deepEqual(steps, [0.2, 0.4, 0.6, 0.8, 1]);
  for (const feature of areas.features) {
    for (const polygon of feature.geometry.coordinates) {
      polygon.forEach((ring, index) => {
        assert.deepEqual(ring[0], ring[ring.length - 1], "closed");
        assert.ok(index === 0 ? area(ring) > 0 : area(ring) < 0, "outlines one way round, holes the other");
      });
    }
  }
  const atLevel = (state, level) => areas.features.find((feature) => feature.properties.weather === state && feature.properties.level === level);
  const halfOf = (state) => box(atLevel(state, 0.5).geometry.coordinates[0][0]);
  const snow = halfOf("snow");
  const rain = halfOf("rain");
  // At the half, each patch is its zone: the two meet along the border between them, with no gap and no circle.
  assert.ok(Math.abs(snow.east - 30) < 0.25 && Math.abs(rain.west - 30) < 0.25, `${snow.east} ${rain.west}`);
  assert.ok(Math.abs(snow.west - 22) < 0.5 && Math.abs(rain.east - 38) < 0.5);
  assert.ok(snow.south < 46.5 && snow.north > 51.5, "its whole shape, edge to edge");
  // The faintest outline reaches a little way past the zone's edge, into its neighbour.
  const faint = box(atLevel("snow", 0.1).geometry.coordinates[0][0]);
  assert.ok(faint.east > 30.2 && faint.west < 21.8);
});

test("zones of one weather that touch are one patch", () => {
  const { areas } = weatherPatchFeatures({ zones: ZONES, weather: weatherOf([["west", "fog", "Autumn"], ["east", "fog", "Autumn"]]) });
  const full = areas.features.filter((feature) => feature.properties.weather === "fog" && feature.properties.level === 0.9);
  assert.equal(full.length, 1);
  assert.equal(full[0].geometry.coordinates.length, 1, "one shape across both");
  const { west, east } = box(full[0].geometry.coordinates[0][0]);
  // (Its fullest outline lies a little inside the two zones' outer edges, where their blend begins.)
  assert.ok(west < 23.6 && east > 36.4, `${west} ${east}`);
  // No zone, or no weather known for it: nothing.
  assert.deepEqual(weatherPatchFeatures({ zones: [], weather: new Map() }).areas.features, []);
  assert.deepEqual(weatherPatchFeatures({ zones: ZONES, weather: new Map() }).areas.features, []);
});

test("each zone's weather is the one the last turn wrote, else worked out as the turn would", () => {
  const recorded = { date: "1916-01-10", zones: [{ id: "west", state: "snow", season: "Winter" }] };
  assert.deepEqual([...zoneWeatherById(recorded, "1916-01-10")], [["west", { state: "snow", season: "Winter" }]]);
  // Another day's: what is given in its place.
  const fallback = { date: "1916-02-01", zones: [{ id: "west", state: "fog", season: "Winter" }] };
  assert.deepEqual([...zoneWeatherById(recorded, "1916-02-01", fallback)], [["west", { state: "fog", season: "Winter" }]]);
  // As the turn works it out: one a zone, from the campaign's own seed; none where the wars have no weather.
  const world = { climateZones: ZONES, warSettings: {} };
  const worked = zoneWeatherFor(world, { seed: "campaign", date: "1916-01-10" });
  assert.deepEqual(worked.zones.map((entry) => entry.id), ["west", "east", "far"]);
  assert.deepEqual(zoneWeatherFor(world, { seed: "campaign", date: "1916-01-10" }), worked);
  assert.equal(zoneWeatherFor({ ...world, warSettings: { mechanics: { weather: false } } }, { seed: "campaign", date: "1916-01-10" }), null);
  // A world with no zones of its own and a map of its own has none; on the built-in basemaps, the real world's (worldGeographyDefaults.js).
  assert.equal(zoneWeatherFor({ climateZones: [], background: { kind: "image" } }, { seed: "campaign", date: "1916-01-10" }), null);
  assert.ok(zoneWeatherFor({ climateZones: [] }, { seed: "campaign", date: "1916-01-10" }).zones.length >= 30);
  assert.equal(zoneWeatherFor(world, { seed: "campaign", date: "Year 12" }), null);
});

// "there is a weather bug where in antartica on low zoom there are triangle
// cutouts of the weather (snow)" (the owner, 2026-10-28).
test("Antarctica's snow runs round the world to the map's edge, with no wedge at the date line and no corner cut off", async () => {
  const { WORLD_CLIMATE_ZONES } = await import("../../runtime/worldGeographyDefaults.js");
  const zones = WORLD_CLIMATE_ZONES.filter((zone) => zone.id === "world-antarctica");
  const { areas } = weatherPatchFeatures({ zones, weather: new Map([["world-antarctica", { state: "snow", season: "The polar year" }]]) });
  assert.equal(areas.features.length, PATCH_BANDS.length);
  for (const feature of areas.features) {
    const points = feature.geometry.coordinates.flat(2);
    const lngs = points.map(([lng]) => lng);
    const lats = points.map(([, lat]) => lat);
    // Nothing past the date line, nor along the map's very edge.
    assert.ok(Math.min(...lngs) >= -180 && Math.max(...lngs) <= 180);
    assert.ok(Math.min(...lats) >= -PATCH_EDGE_LAT && Math.max(...lats) < -60);
    // Even the full snow of the middle reaches the line from both sides (it stopped near 174° before).
    assert.ok(Math.min(...lngs) < -179.5 && Math.max(...lngs) > 179.5, `level ${feature.properties.level}: ${Math.min(...lngs)}..${Math.max(...lngs)}`);
    // And down to the edge at every longitude: no corner rounded off across the map's last degrees.
    for (let lng = -170; lng <= 170; lng += 20) {
      const south = Math.min(...points.filter(([x]) => Math.abs(x - lng) < 10).map(([, lat]) => lat));
      assert.ok(south <= -PATCH_EDGE_LAT + 0.01, `level ${feature.properties.level} at ${lng}: ${south}`);
    }
  }
});
