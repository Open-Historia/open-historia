/*! Open Historia — the real world's own climate zones and hard ground: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/worldGeographyDefaults.test.js
//
// "Make the default climate zones on every existing scenario be very large
// realistic zones ... like alot of russia is really cold", "add terrain
// traversability to realistic places all over the map", and "all scenarios
// that use one of the built in ezri basemaps should get the default climate
// and terrain from the modern day scenario".

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { zoneMixOn, zoneWeathersOn } from "./fronts/climate.js";
import { WEATHER_ODDS } from "./fronts/weather.js";
import { addGameDays } from "./gameDates.js";
import { zoneWeightAt } from "./warGeography.js";
import { WORLD_CLIMATE_ZONES, WORLD_TERRAIN_AREAS, climateZonesOf, onBuiltInBasemap, terrainAreasOf } from "./worldGeographyDefaults.js";
import { zoneWeatherFor } from "./zoneWeather.js";

// The zone most of a place is in, and what it brings on a date.
const zoneAt = (lng, lat) => {
  let best = null;
  let most = 0;
  for (const zone of WORLD_CLIMATE_ZONES) {
    const weight = zoneWeightAt(zone, lng, lat);
    if (weight > most) {
      best = zone;
      most = weight;
    }
  }
  return most >= 0.5 ? best : null;
};
const oddsAt = (lng, lat, date) => zoneMixOn(zoneAt(lng, lat), date, lat).odds;
const share = (odds, states) => states.reduce((sum, state) => sum + (odds[state] ?? 0), 0);
// Of the days that are not clear, the share that are these.
const rough = (odds, states) => share(odds, states) / (1 - (odds.clear ?? 0));

test("the world's climates: large zones over the continents, each its own seasons, none dropped", () => {
  assert.ok(WORLD_CLIMATE_ZONES.length >= 30 && WORLD_CLIMATE_ZONES.length <= 48, String(WORLD_CLIMATE_ZONES.length));
  assert.equal(new Set(WORLD_CLIMATE_ZONES.map((zone) => zone.id)).size, WORLD_CLIMATE_ZONES.length);
  assert.equal(new Set(WORLD_CLIMATE_ZONES.map((zone) => zone.name)).size, WORLD_CLIMATE_ZONES.length);
  const source = fs.readFileSync(new URL("./worldGeographyDefaults.js", import.meta.url), "utf8");
  assert.equal((source.match(/^ {2}zone\("world-/gm) ?? []).length, WORLD_CLIMATE_ZONES.length, "every zone written is kept");
  for (const zone of WORLD_CLIMATE_ZONES) {
    assert.ok(zone.seasons.length >= 1 && zone.blendKm >= 250, zone.name);
    // Large: none smaller than a few hundred kilometres across.
    const lngs = zone.rings[0].map((point) => point[0]);
    const lats = zone.rings[0].map((point) => point[1]);
    assert.ok(Math.max(...lngs) - Math.min(...lngs) > 4 || Math.max(...lats) - Math.min(...lats) > 4, zone.name);
  }
});

test("a lot of Russia is really cold: Siberia's January, when not clear, is snow and frost; the Sahara's July heat; India's monsoon rain", () => {
  assert.equal(zoneAt(100, 62).name, "Siberia");
  const siberia = oddsAt(100, 62, "1942-01-15");
  assert.ok(rough(siberia, ["snow", "blizzard", "frost"]) > 0.95, "a Siberian January that is not clear is snow, frost or a blizzard");
  assert.ok(siberia.clear >= 0.3 && siberia.clear <= 0.6, "and many of its days are clear and bitter");
  assert.ok(zoneMixOn(zoneAt(100, 62), "1942-01-15", 62).effects.freezes > 0.9, "and its water freezes, clear or not");
  assert.equal(zoneAt(37.6, 55.75).name, "Central & Eastern Europe", "Moscow");
  assert.ok(rough(oddsAt(37.6, 55.75, "1942-01-15"), ["snow", "blizzard", "frost"]) > 0.85);
  assert.ok(rough(oddsAt(37.6, 55.75, "1942-04-01"), ["mud"]) > 0.6, "and its spring thaw turns the roads to mud");
  const sahara = oddsAt(10, 24, "1942-07-15");
  assert.ok(rough(sahara, ["heat"]) > 0.95 && sahara.heat > 0.3, "the Sahara");
  const monsoon = oddsAt(78, 22, "1942-07-15");
  assert.ok(share(monsoon, ["rain", "storm", "mud"]) > 0.6 && monsoon.rain > monsoon.clear, "India's monsoon: rain commoner than a clear sky");
  assert.ok(share(oddsAt(-60, -5, "1942-02-15"), ["rain", "storm", "fog"]) > 0.6, "the Amazon");
  const outback = oddsAt(134, -25, "1942-01-15");
  assert.ok(rough(outback, ["heat"]) > 0.95 && outback.heat > 0.3, "the Outback's summer, in January");
  // The open ocean is no zone's.
  assert.equal(zoneAt(-35, 30), null, "the mid-Atlantic");
  // And neighbours' weathers fit one another, on any day.
  for (const date of ["1942-01-15", "1942-04-01", "1942-07-15", "1942-10-10"]) {
    const skies = zoneWeathersOn({ seed: "test", zones: WORLD_CLIMATE_ZONES, date });
    assert.equal(skies.length, WORLD_CLIMATE_ZONES.length);
  }
});

test("clear skies are very common: the likeliest weather of nearly every season, and most of the world clear on any day", () => {
  // The engine's own odds by latitude: clear the likeliest in every season of every climate.
  for (const [climate, seasons] of Object.entries(WEATHER_ODDS)) {
    for (const [season, odds] of Object.entries(seasons)) assert.ok(odds.clear === Math.max(...Object.values(odds)) && odds.clear >= 0.4, `${climate} ${season}`);
  }
  // The world's zones: clear the commonest in every season but the three great wet seasons, and never
  // rarer than three days in ten.
  const wetter = [];
  for (const zone of WORLD_CLIMATE_ZONES) {
    for (const season of zone.seasons) {
      const weights = Object.values(season.weather);
      const clear = season.weather.clear ?? 0;
      assert.ok(clear / weights.reduce((sum, weight) => sum + weight, 0) >= 0.3, `${zone.name}, ${season.name}`);
      if (clear < Math.max(...weights)) wetter.push(`${zone.name}, ${season.name}`);
    }
  }
  assert.deepEqual(wetter, ["The Amazon, The rains", "The Indian Subcontinent, Monsoon", "South-East Asia, Wet season"]);
  // Over a year most of the world is clear, and never is all of it under weather: a quarter of the
  // zones at least are clear on any day.
  let clear = 0;
  let all = 0;
  for (let at = 0; at < 365; at += 4) {
    const skies = zoneWeathersOn({ seed: "test", zones: WORLD_CLIMATE_ZONES, date: addGameDays("1942-01-01", at) });
    const here = skies.filter((sky) => sky.state === "clear").length;
    assert.ok(here >= skies.length / 4, `day ${at}: ${here} of ${skies.length}`);
    clear += here;
    all += skies.length;
  }
  assert.ok(clear / all > 0.55, String(clear / all));
});

test("the world's hard ground: the great ranges, the marshes, the jungles, the sand seas, at 3 to 9", () => {
  assert.ok(WORLD_TERRAIN_AREAS.length >= 40);
  const source = fs.readFileSync(new URL("./worldGeographyDefaults.js", import.meta.url), "utf8");
  assert.equal((source.match(/^ {2}area\("world-/gm) ?? []).length, WORLD_TERRAIN_AREAS.length, "every area written is kept");
  assert.ok(WORLD_TERRAIN_AREAS.every((area) => area.level >= 3 && area.level <= 9), "nothing impassable: troops cross the worst of it slowly");
  const level = (name) => WORLD_TERRAIN_AREAS.find((area) => area.name === name)?.level;
  assert.equal(level("The Himalaya"), 9);
  assert.ok(level("The Alps") >= 6 && level("The Andes") >= 7 && level("The Caucasus") >= 7);
  assert.ok(level("The Pripyat Marshes") >= 5 && level("The Sudd") >= 6);
  assert.ok(level("The Urals") <= 4, "the Urals are old and low");
  for (const name of ["The Amazon Rainforest", "The Congo Rainforest", "The Empty Quarter", "The Siberian Taiga & Tundra", "The Darién Gap"]) assert.ok(level(name) >= 4, name);
});

test("a scenario on the built-in basemaps gets the world's; one with its own map, none; one's own stand in for them", () => {
  assert.equal(onBuiltInBasemap({}), true, "Modern Day: no map of its own");
  assert.equal(onBuiltInBasemap({ background: null }), true);
  assert.equal(onBuiltInBasemap({ background: { kind: "image" } }), false);
  assert.equal(onBuiltInBasemap({ background: { kind: "vector" } }), false);
  assert.equal(onBuiltInBasemap({ background: { kind: "plain" } }), false, "the plain sea of a flat sheet");
  assert.equal(climateZonesOf({}), WORLD_CLIMATE_ZONES);
  assert.equal(terrainAreasOf({}), WORLD_TERRAIN_AREAS);
  assert.deepEqual(climateZonesOf({ background: { kind: "image" } }), []);
  assert.deepEqual(terrainAreasOf({ background: { kind: "image" } }), []);
  const own = [{ id: "mine", name: "Mine", rings: [[[0, 0], [5, 0], [5, 5], [0, 5]]], seasons: [] }];
  assert.equal(climateZonesOf({ climateZones: own }), own);
  assert.equal(climateZonesOf({ climateZones: own, background: { kind: "image" } }), own);
  const ground = [{ id: "hill", name: "Hill", level: 4, rings: [[[0, 0], [1, 0], [1, 1]]] }];
  assert.equal(terrainAreasOf({ terrainAreas: ground }), ground);
  // The same object for the same world, so a page's selector of it holds still.
  assert.equal(climateZonesOf({ background: { kind: "image" } }), climateZonesOf({ background: { kind: "vector" } }));
  // The turn writes their weather as it writes a scenario's own.
  const written = zoneWeatherFor({}, { seed: "campaign", date: "1942-01-15" });
  assert.equal(written.zones.length, WORLD_CLIMATE_ZONES.length);
  assert.ok(["clear", "snow", "blizzard", "frost"].includes(written.zones.find((entry) => entry.id === "world-siberia").state));
  // The engine is handed them (Game/AI/frontTurn.js).
  const turn = fs.readFileSync(new URL("../Game/AI/frontTurn.js", import.meta.url), "utf8");
  assert.match(turn, /climateZones: normalizeClimateZones\(climateZonesOf\(world\)\)/);
  assert.match(turn, /const source = terrainAreasOf\(world\);/);
});
