/*! Open Historia — the season the map is tinted by: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/seasonTint.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zoneWeightAt } from "../../runtime/warGeography.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import {
  GLOBE_TOP_LAT,
  MERCATOR_TOP_LAT,
  MIN_BLEND_PIXELS,
  SEASON_TINTS,
  seasonTintCorners,
  seasonTintField,
  seasonTintHeight,
  seasonTintOf,
  tintGrid,
  tintPixelAt,
  worldSeasonMix,
  worldStrengthAt,
  worldTintAt,
  zoneTintOn,
  zoneWeightGrid,
} from "./seasonTint.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");
const near = (a, b, within = 1) => a.every((value, index) => Math.abs(value - b[index]) <= within);

const zone = (extra = {}) => ({
  id: "z",
  name: "The Plain",
  color: "#4466aa",
  rings: [[[10, 40], [30, 40], [30, 50], [10, 50]]],
  blendKm: 400,
  transitionDays: 14,
  seasons: [{ name: "Summer", start: "01-01", end: "12-31", weather: {}, effects: {} }],
  events: [],
  ...extra,
});

test("the world's own season, by the month and which side of the equator: winter blue-white north in January, summer yellow south, nothing at the equator", () => {
  const field = seasonTintField({ date: "1941-01-15", width: 256, height: 256 });
  assert.deepEqual([field.width, field.height, field.data.length], [256, 256, 256 * 256 * 4]);
  const north = tintPixelAt(field, 20, 60);
  const south = tintPixelAt(field, 20, -60);
  assert.ok(near(north.rgb, SEASON_TINTS.winter) && north.alpha === 1, JSON.stringify(north));
  assert.ok(near(south.rgb, SEASON_TINTS.summer) && south.alpha === 1, JSON.stringify(south));
  assert.equal(tintPixelAt(field, 20, 5).alpha, 0, "no winter to speak of at the equator, so the turn there is never a line");
  const between = tintPixelAt(field, 20, 27).alpha;
  assert.ok(between > 0.2 && between < 0.8, String(between));
  // Round the year: each in its turn, and the other way round in the south.
  for (const [date, top, bottom] of [["1941-04-15", "spring", "autumn"], ["1941-07-15", "summer", "winter"], ["1941-10-15", "autumn", "spring"]]) {
    const seen = seasonTintField({ date, width: 128, height: 128 });
    assert.ok(near(tintPixelAt(seen, 0, 55).rgb, SEASON_TINTS[top]), `${date} north`);
    assert.ok(near(tintPixelAt(seen, 0, -55).rgb, SEASON_TINTS[bottom]), `${date} south`);
  }
  assert.equal(seasonTintField({ date: "", width: 64, height: 64 }), null, "a date the calendar cannot read tints nothing");
  assert.equal(worldStrengthAt(0), 0);
  assert.equal(worldStrengthAt(-50), 1);
});

test("the world's seasons turn over four weeks round the first of the month, the same south of the equator", () => {
  assert.deepEqual(worldSeasonMix("1941-02-10", 50), [{ season: "winter", weight: 1 }]);
  const turning = worldSeasonMix("1941-03-01", 50);
  assert.deepEqual(turning.map((entry) => entry.season), ["spring", "winter"]);
  assert.ok(turning[0].weight > 0.5 && turning[0].weight < 0.55, "half and half on the day it turns");
  const early = worldSeasonMix("1941-02-20", 50);
  assert.ok(early[0].season === "spring" && early[0].weight > 0.1 && early[0].weight < 0.3, JSON.stringify(early));
  assert.deepEqual(worldSeasonMix("1941-03-20", 50), [{ season: "spring", weight: 1 }]);
  assert.deepEqual(worldSeasonMix("1941-03-01", -50).map((entry) => entry.season), ["autumn", "summer"]);
  // Across the turn of the year too.
  assert.deepEqual(worldSeasonMix("1941-12-05", 50).map((entry) => entry.season), ["winter", "autumn"]);
  assert.deepEqual(worldSeasonMix("BC", 50), []);
  // The colour of a turning season lies between the two.
  const { rgb } = worldTintAt("1941-03-01", 50);
  for (let part = 0; part < 3; part += 1) {
    const [least, most] = [SEASON_TINTS.spring[part], SEASON_TINTS.winter[part]].sort((a, b) => a - b);
    assert.ok(rgb[part] >= least && rgb[part] <= most, JSON.stringify(rgb));
  }
});

test("a season of a designer's tints in its own colour, else its name's, else its weather's", () => {
  assert.deepEqual(seasonTintOf({ name: "Anything", color: "#112233" }), [17, 34, 51]);
  assert.deepEqual(seasonTintOf({ name: "Deep Winter" }), [...SEASON_TINTS.winter]);
  assert.deepEqual(seasonTintOf({ name: "The Fall" }), [...SEASON_TINTS.autumn]);
  const night = seasonTintOf({ name: "The Long Night", weather: { snow: 1, blizzard: 1 } });
  assert.ok(night.every((part) => part > 220), "snow and blizzards are white");
  const monsoon = seasonTintOf({ name: "Monsoon", weather: { rain: 3, storm: 1 } });
  assert.ok(monsoon[2] > monsoon[0], "rain is blue");
  assert.equal(seasonTintOf({ name: "Season 3", weather: { clear: 1 } }), null, "clear weather says nothing");
  // Then the zone's own colour.
  assert.deepEqual(zoneTintOn(zone({ seasons: [{ name: "Season 3", start: "01-01", end: "12-31", weather: { clear: 1 }, effects: {} }] }), "1941-06-01", 45), { rgb: [68, 102, 170], strength: 1 });
});

test("a zone's seasons fade into each other over its transition days, and where none is in it shows the world's own", () => {
  const seasons = [
    { name: "Winter", start: "12-01", end: "02-28", weather: {}, effects: {} },
    { name: "Spring", start: "03-01", end: "05-31", weather: {}, effects: {} },
  ];
  const turning = zoneTintOn(zone({ seasons }), "1941-03-01", 45);
  assert.equal(turning.strength, 1);
  assert.ok(turning.rgb[0] > SEASON_TINTS.spring[0] && turning.rgb[0] < SEASON_TINTS.winter[0], JSON.stringify(turning));
  assert.deepEqual(zoneTintOn(zone({ seasons }), "1941-03-20", 45).rgb, [...SEASON_TINTS.spring]);
  // June to November is the world's own: summer up north, and faded out near the equator.
  assert.deepEqual(zoneTintOn(zone({ seasons }), "1941-07-01", 50), { rgb: [...SEASON_TINTS.summer], strength: 1 });
  assert.equal(zoneTintOn(zone({ seasons }), "1941-07-01", 5).strength, 0);
});

test("a zone shows whole inside it, blends into the world at its edge, and is gone beyond its blend", () => {
  const field = seasonTintField({ zones: [zone()], date: "1941-01-15", width: 512, height: 512 });
  assert.ok(near(tintPixelAt(field, 20, 45).rgb, SEASON_TINTS.summer), "its own summer in the world's January");
  assert.ok(near(tintPixelAt(field, -5, 45).rgb, SEASON_TINTS.winter), "the world's winter well outside it");
  const edge = tintPixelAt(field, 10, 45).rgb;
  assert.ok(edge[2] < SEASON_TINTS.winter[2] - 40 && edge[2] > SEASON_TINTS.summer[2] + 40, `blended at its edge: ${edge}`);
  // Across it from the west, the colour moves steadily from the world's to its own.
  let blue = Infinity;
  for (let lng = 4; lng <= 16; lng += 1) {
    const now = tintPixelAt(field, lng, 45).rgb[2];
    assert.ok(now <= blue, `${lng}: ${now} after ${blue}`);
    blue = now;
  }
});

test("a zone's share of a place is zoneWeightAt's, to within a pixel of the picture", () => {
  const grid = tintGrid(512, 512);
  const plain = zone();
  const weights = zoneWeightGrid(plain, grid);
  assert.ok(weights);
  for (const [lng, lat] of [[10, 45], [8.5, 45], [11.5, 45], [13, 45], [20, 45], [20, 49], [20, 51.5], [31, 41], [7, 44]]) {
    const x = Math.round(grid.toX(lng));
    const y = Math.round(grid.toY(lat));
    // (The pixel's own middle is where the two are compared.)
    const lngAt = ((x + 0.5) / 512) * 360 - 180;
    const latAt = grid.rowLat[y];
    const kmPixel = grid.rowKm[y];
    const got = weights.weights[(y - weights.y0) * weights.width + (x - weights.x0)];
    const want = zoneWeightAt(plain, lngAt, latAt);
    assert.ok(Math.abs(got - want) <= kmPixel / plain.blendKm + 0.04, `${lng},${lat}: ${got} against ${want}`);
  }
  // A zone with no blend of its own still melts over a few pixels.
  const sharp = zoneWeightGrid(zone({ blendKm: 0 }), grid);
  const y = Math.round(grid.toY(45)) - sharp.y0;
  const row = [...sharp.weights.subarray(y * sharp.width, (y + 1) * sharp.width)];
  assert.ok(row.filter((weight) => weight > 0.02 && weight < 0.98).length >= MIN_BLEND_PIXELS, row.map((w) => w.toFixed(2)).join(" "));
});

test("zones that overlap share the place, and one across the date line is drawn on both sides of it", () => {
  const red = zone({ id: "r", seasons: [{ name: "One", start: "01-01", end: "12-31", color: "#c03020", weather: {}, effects: {} }] });
  const green = zone({ id: "g", seasons: [{ name: "Two", start: "01-01", end: "12-31", color: "#20a040", weather: {}, effects: {} }] });
  const field = seasonTintField({ zones: [red, green], date: "1941-01-15", width: 256, height: 256 });
  assert.ok(near(tintPixelAt(field, 20, 45).rgb, [(0xc0 + 0x20) / 2, (0x30 + 0xa0) / 2, (0x20 + 0x40) / 2], 2));
  const pacific = zone({ rings: [[[170, -20], [190, -20], [190, 20], [170, 20]]], seasons: [{ name: "Wet", start: "01-01", end: "12-31", color: "#2080c0", weather: {}, effects: {} }] });
  const wide = seasonTintField({ zones: [pacific], date: "1941-01-15", width: 256, height: 256 });
  assert.ok(near(tintPixelAt(wide, 175, 0).rgb, [0x20, 0x80, 0xc0]) && tintPixelAt(wide, 175, 0).alpha === 1);
  assert.ok(near(tintPixelAt(wide, -175, 0).rgb, [0x20, 0x80, 0xc0]) && tintPixelAt(wide, -175, 0).alpha === 1);
  assert.equal(tintPixelAt(wide, 150, 0).alpha, 0);
});

test("on the globe the picture reaches the poles, taller so its pixels stay square, and the polar caps are tinted", () => {
  assert.deepEqual(seasonTintCorners(), [[-180, MERCATOR_TOP_LAT], [180, MERCATOR_TOP_LAT], [180, -MERCATOR_TOP_LAT], [-180, -MERCATOR_TOP_LAT]]);
  assert.deepEqual(seasonTintCorners(GLOBE_TOP_LAT).map((corner) => corner[1]), [89.9, 89.9, -89.9, -89.9]);
  assert.equal(seasonTintHeight(512), 512, "the flat map's square");
  const tall = seasonTintHeight(256, GLOBE_TOP_LAT);
  assert.ok(tall > 500 && tall < 640, String(tall));
  const globe = seasonTintField({ date: "1941-01-15", width: 256, topLat: GLOBE_TOP_LAT });
  assert.deepEqual([globe.width, globe.height, globe.topLat], [256, tall, GLOBE_TOP_LAT]);
  for (const lat of [88, 60, -88]) {
    const seen = tintPixelAt(globe, 0, lat);
    assert.ok(seen.alpha === 1 && near(seen.rgb, SEASON_TINTS[lat > 0 ? "winter" : "summer"]), `${lat}: ${JSON.stringify(seen)}`);
  }
  // The same places come out the same as on the flat map's picture.
  const flat = seasonTintField({ zones: [zone()], date: "1941-01-15", width: 256 });
  const round = seasonTintField({ zones: [zone()], date: "1941-01-15", width: 256, topLat: GLOBE_TOP_LAT });
  for (const [lng, lat] of [[20, 45], [40, 60], [-5, 45], [20, -30]]) assert.ok(near(tintPixelAt(flat, lng, lat).rgb, tintPixelAt(round, lng, lat).rgb, 2), `${lng},${lat}`);
});

test("the tint is one picture over the whole map, in its place in the map's order, behind the player's switch", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  assert.ok(index("seasons-tint") > index("fronts-paint-11"), "over every fill and every battlefield's paint");
  assert.ok(index("seasons-tint") > index("group-areas-tint"));
  assert.ok(index("seasons-tint") < index("polity-boundaries-shadow"), "under the borders and every name");
  const component = read("SeasonLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]), ["seasons-tint"]);
  assert.match(component, /useMapSettingDefaultOn\(MAP_SETTING_KEYS\.seasonsWeather\)/);
  assert.match(component, /warSettingsOf\(world\)\.mechanics\.weather/);
  assert.match(component, /const topLat = isGlobe \? GLOBE_TOP_LAT : MERCATOR_TOP_LAT;/);
  assert.match(read("MapScene.jsx"), /<Nations isGlobe=\{isGlobe\} \/>\s*<SeasonLayers isGlobe=\{isGlobe\} \/>/);
  for (const name of ["seasonTint.js", "SeasonLayers.jsx"]) assert.doesNotMatch(read(name), /createLinearGradient|createRadialGradient|createConicGradient|gradient\(/i);
});
