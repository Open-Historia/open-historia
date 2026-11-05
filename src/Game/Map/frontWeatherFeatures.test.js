/*! Open Historia — the weather as the map shows it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/frontWeatherFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { WEATHER_OVERLAYS, weatherFrontsOf, weatherOverlayOf } from "./frontWeatherFeatures.js";
import {
  ICE_LAYERS,
  ICE_TINT,
  WEATHER_DRAWN,
  WEATHER_LAYERS,
  iceImageId,
  icePattern,
  weatherImageId,
  weatherPattern,
} from "./mapPatterns.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");

const frame = { lng0: 30, lat0: 48, cell: 0.1, cols: 60, rows: 40, km: 7 };
const battlefield = (extra = {}) => ({ name: "The Steppe", status: "active", sides: [["Aland"], ["Borea"]], frame, brief: { weather: { season: "winter", now: "snow", days: { snow: 6, clear: 2 } } }, ...extra });
const shown = (image) => {
  let count = 0;
  for (let at = 3; at < image.data.length; at += 4) if (image.data[at] > 0) count += 1;
  return count;
};
// A colour a person would call purple or violet: blue and red both well over green, blue at least red.
const purple = ([red, green, blue]) => blue >= red && red > green + 40 && blue > green + 60;
const isPrime = (value) => {
  for (let factor = 2; factor * factor <= value; factor += 1) if (value % factor === 0) return false;
  return value > 1;
};

test("each weather is a speckle over at most a faint wash, and clear weather draws nothing", () => {
  for (const state of WEATHER_STATES) assert.ok(Object.hasOwn(WEATHER_OVERLAYS, state), `${state} has no look`);
  assert.deepEqual(weatherOverlayOf("clear"), { pattern: null, wash: null });
  assert.equal(weatherOverlayOf("hail"), null);
  assert.equal(weatherOverlayOf(""), null);
  assert.deepEqual(weatherOverlayOf("rain"), { pattern: "oh-weather-rain", wash: null });
  const storm = weatherOverlayOf("storm");
  assert.equal(storm.pattern, "oh-weather-storm");
  assert.ok(parseInt(storm.wash.color.slice(1), 16) < 0x404040, "a darker wash");
  // No wash is heavier than frost's own faint one, a little over a tenth: the speckle says the weather.
  for (const state of WEATHER_STATES) assert.ok(!WEATHER_OVERLAYS[state].wash || WEATHER_OVERLAYS[state].wash.opacity <= 0.12, state);
  assert.ok(weatherOverlayOf("blizzard").wash.opacity > weatherOverlayOf("snow").wash.opacity);
  const heat = weatherOverlayOf("heat").wash.color;
  assert.ok(parseInt(heat.slice(1, 3), 16) > parseInt(heat.slice(5, 7), 16), "warm");
});

test("each weather is three still tiles of speckle of prime sizes, so that together they do not repeat to the eye", () => {
  assert.equal(weatherPattern("clear"), null);
  assert.equal(weatherPattern("hail"), null);
  assert.equal(weatherPattern("frost", 3), null, "three tiles, no more");
  // (Primes: what the three make together repeats only every 97 x 131 x 173 pixels.)
  assert.ok(WEATHER_LAYERS.length === 3 && WEATHER_LAYERS.every(isPrime));
  assert.ok(WEATHER_LAYERS.reduce((product, size) => product * size, 1) > 2e6);
  const counts = {};
  const area = WEATHER_LAYERS.reduce((sum, size) => sum + size * size, 0);
  for (const state of WEATHER_DRAWN) {
    counts[state] = 0;
    WEATHER_LAYERS.forEach((size, layer) => {
      const image = weatherPattern(state, layer);
      assert.deepEqual([image.width, image.height, image.data.length], [size, size, size * size * 4]);
      counts[state] += shown(image);
      for (let at = 0; at < image.data.length; at += 4) {
        if (image.data[at + 3] === 0) continue;
        assert.equal(purple([image.data[at], image.data[at + 1], image.data[at + 2]]), false, `${state} has a purple pixel`);
      }
    });
    assert.ok(counts[state] > 50 && counts[state] < area * 0.3, `${state}: ${counts[state]} of ${area} pixels`);
  }
  // Frost keeps about the grains it had, some eleven a thousand pixels of the map (the three tiles lie over one
  // another, so their densities add); the worse weather is denser.
  const frostOnMap = WEATHER_LAYERS.reduce((sum, size, layer) => sum + shown(weatherPattern("frost", layer)) / (size * size), 0);
  assert.ok(frostOnMap > 0.008 && frostOnMap < 0.03, String(frostOnMap));
  assert.ok(counts.storm > counts.rain * 1.5, "a storm's rain is denser");
  assert.ok(counts.blizzard > counts.snow * 1.5, "a blizzard's snow is denser");
  // The same picture every time, each tile and each weather its own.
  assert.deepEqual(weatherPattern("frost", 1).data, weatherPattern("frost", 1).data);
  assert.notDeepEqual(weatherPattern("snow", 0).data, weatherPattern("blizzard", 0).data);
  // Rain leans: its drops' pixels run down and to the left.
  const rain = weatherPattern("rain", 2);
  const size = rain.width;
  const at = (x, y) => rain.data[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4 + 3] > 0;
  let leaning = 0;
  let upright = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!at(x, y) || at(x, y + 1)) continue;
      if (at(x - 1, y + 1)) leaning += 1;
      else if (at(x + 1, y + 1)) upright += 1;
    }
  }
  assert.ok(leaning > upright, `${leaning} leaning, ${upright} the other way`);
  // Mud is brown.
  const mud = weatherPattern("mud", 0);
  for (let index = 0; index < mud.data.length; index += 4) {
    if (mud.data[index + 3] === 0) continue;
    assert.ok(mud.data[index] > mud.data[index + 1] && mud.data[index + 1] > mud.data[index + 2]);
  }
});

test("the speckle gathers into drifts and thins into bare patches, and nothing of it moves", () => {
  // Counted in squares of a tile, some hold several times what others do: not a sprinkle spread evenly.
  for (const state of ["frost", "snow", "fog"]) {
    const image = weatherPattern(state, 2);
    const size = image.width;
    const step = Math.floor(size / 6);
    const squares = [];
    for (let sy = 0; sy + step <= size; sy += step) {
      for (let sx = 0; sx + step <= size; sx += step) {
        let count = 0;
        for (let y = sy; y < sy + step; y += 1) for (let x = sx; x < sx + step; x += 1) if (image.data[(y * size + x) * 4 + 3] > 0) count += 1;
        squares.push(count);
      }
    }
    assert.ok(Math.max(...squares) > 3 * Math.max(1, Math.min(...squares)), `${state}: ${JSON.stringify(squares)}`);
  }
  // Still, as frost is: no picture is ever handed to the map again.
  assert.doesNotMatch(read("FrontWeatherLayers.jsx"), /updateImage|setTimeout|setInterval|requestAnimationFrame/);
  assert.equal(weatherImageId("snow"), "oh-weather-snow");
  assert.deepEqual([1, 2].map((layer) => weatherImageId("snow", layer)), ["oh-weather-snow-b", "oh-weather-snow-c"]);
});

test("ice is a thin pale tint the map shows through, cracked on clear tiles of prime sizes", () => {
  assert.ok(ICE_LAYERS.length === 2 && ICE_LAYERS.every(isPrime));
  let cracked = 0;
  ICE_LAYERS.forEach((size, layer) => {
    const ice = icePattern(layer);
    assert.deepEqual([ice.width, ice.height], [size, size]);
    let clear = 0;
    for (let at = 0; at < ice.data.length; at += 4) {
      const [red, green, blue, alpha] = ice.data.subarray(at, at + 4);
      if (alpha === 0) {
        clear += 1;
        continue;
      }
      cracked += 1;
      assert.ok(blue >= green && green >= red, "blue-white, never purple");
    }
    assert.ok(clear > size * size * 0.85, `mostly clear, the tint and the map showing between the cracks: ${clear} of ${size * size}`);
  });
  assert.ok(cracked > 400, `cracked: ${cracked}`);
  assert.equal(icePattern(2), null);
  assert.deepEqual(icePattern(1).data, icePattern(1).data, "the same every time");
  assert.deepEqual(ICE_LAYERS.map((_, layer) => iceImageId(layer)), ["oh-ice", "oh-ice-b"]);
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(ICE_TINT.slice(at, at + 2), 16));
  assert.ok(blue >= green && green >= red && red > 200, "the tint is pale blue-white");
});

test("the battlefields drawn are those being fought over whose brief says the day's weather", () => {
  const list = weatherFrontsOf([
    battlefield(),
    battlefield({ name: "Closed", status: "closed" }),
    battlefield({ name: "No weather", brief: {} }),
    battlefield({ name: "Odd weather", brief: { weather: { season: "winter", now: "hail" } } }),
    battlefield({ name: "No frame", frame: null }),
    battlefield({ name: "Ceasefire", status: "frozen", brief: { weather: { season: "The North, Deep Winter", now: "blizzard" } } }),
    null,
  ]);
  assert.deepEqual(list.map((front) => [front.name, front.season, front.now]), [["The Steppe", "winter", "snow"], ["Ceasefire", "The North, Deep Winter", "blizzard"]]);
  assert.deepEqual(weatherFrontsOf(undefined), []);
});

test("no word of the season or the weather on the map, and no shape round a battlefield: the patterns say it, the advisor when asked", () => {
  // "remove all the things that say (winter frost) and other weather and seasonal stuff make that just be
  // seen by the visuals or by asking the advisor" (the owner, 2026-10-14).
  const component = read("FrontWeatherLayers.jsx");
  assert.doesNotMatch(component, /text-field|symbol|chip/i);
  assert.ok(!MAP_LAYER_ORDER.some((id) => /chip/.test(id)), "no chip layer in the map's order");
  for (const name of ["frontWeatherFeatures.js", "weatherPatches.js", "mapPatterns.js"]) assert.doesNotMatch(read(name), /chipLabel|weatherChipText|chipPicture/);
  assert.match(fs.readFileSync(path.join(here, "../AI/main.jsx"), "utf8"), /describeWeatherForAdvisor\(/);
  // The map draws no shape of its own round a battlefield: the patches are the zones'.
  assert.doesNotMatch(read("frontWeatherFeatures.js"), /oval|Math\.cos|Math\.sin/i);
});

test("its layers are in the map's order: the weather over the walls and under the troops' ways", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const layers = ["fronts-weather-wash", "fronts-weather-pattern", "fronts-weather-pattern-b", "fronts-weather-pattern-c"];
  for (const id of layers) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...layers].sort((a, b) => index(a) - index(b)), layers);
  assert.ok(index("fronts-weather-wash") > index("war-walls-teeth") && index("fronts-weather-wash") > index("group-areas-outline"));
  assert.ok(index("fronts-weather-pattern-c") < index("fronts-arrows-past"), "under the ways the troops came");
  const component = read("FrontWeatherLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]), layers, "every layer it declares is in the order, and no other");
  assert.match(read("MapScene.jsx"), /<SeaBattleLayers \/>\s*<FrontWeatherLayers \/>/);
  // Behind the player's switches: Seasons and weather, and Weather effects under it.
  assert.match(component, /useMapSettingDefaultOn\(MAP_SETTING_KEYS\.seasonsWeather\)/);
  assert.match(component, /useMapSettingDefaultOn\(MAP_SETTING_KEYS\.weatherEffects\)/);
  assert.match(component, /const shown = switchedOn && effectsOn && /);
  // Seen at every zoom, the whole world at once too.
  assert.doesNotMatch(component, /minzoom|maxzoom/);
  assert.match(component, /map\.on\("styleimagemissing", asked\);/);
  for (const name of ["frontWeatherFeatures.js", "weatherPatches.js", "mapPatterns.js", "FrontWeatherLayers.jsx", "IceLayers.jsx"]) assert.doesNotMatch(read(name), /createLinearGradient|createRadialGradient|createConicGradient|gradient\(/i);
  // The patches are the zones' weather as the last turn wrote it, else worked out as the turn would.
  assert.match(component, /zoneWeatherById\(recorded, date, zoneWeatherFor\(\{ climateZones: zones \}, \{ seed: gameId, date \}\)\)/);
});
