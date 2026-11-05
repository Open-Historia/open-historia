/*! Open Historia — what the advisor knows of the seasons and the weather: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/advisorWeather.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { WORLD_CLIMATE_ZONES } from "../../runtime/worldGeographyDefaults.js";
import { zoneWeatherFor } from "../../runtime/zoneWeather.js";
import { describeWeatherForAdvisor, frontSkiesOf, zoneSkiesOf } from "./advisorWeather.js";

const square = (west, south) => [[[west, south], [west + 10, south], [west + 10, south + 10], [west, south + 10], [west, south]]];
const zone = (id, name, west, south) => ({ id, name, color: "#8899aa", blendKm: 300, transitionDays: 10, rings: square(west, south), seasons: [], events: [] });
const world = (extra = {}) => ({
  background: { kind: "image" },
  climateZones: [zone("z-north", "The Frozen North", 20, 60), zone("z-plain", "The Great Plain", 20, 45)],
  zoneWeather: { date: "1942-01-15", zones: [{ id: "z-north", state: "snow", season: "Long winter" }, { id: "z-plain", state: "clear", season: "Winter" }] },
  battlefields: [
    { name: "The Eastern Front", status: "active", sides: [["Aland"], ["Borea"]], brief: { weather: { season: "The Frozen North, Long winter", now: "blizzard", days: { snow: 6, blizzard: 2, clear: 2 } } } },
    { name: "Someone Else's War", status: "active", sides: [["Carta"], ["Dorne"]], brief: { weather: { season: "Winter", now: "mud", days: { mud: 4 } } } },
    { name: "An Old War", status: "closed", sides: [["Aland"], ["Dorne"]], brief: { weather: { season: "Winter", now: "rain", days: { rain: 4 } } } },
  ],
  ...extra,
});

test("the advisor is told each zone's season and weather today and its own battlefields', by name, harsh weather first", () => {
  const text = describeWeatherForAdvisor({ world: world(), player: "Aland", date: "1942-01-15", seed: "campaign" });
  assert.match(text, /^\[Seasons and weather\] The map shows the seasons and the weather only by their patterns, with no words\./);
  assert.match(text, /\(as of 1942-01-15\)/);
  assert.match(text, /Climate zones, by today's weather \(each with its season\): snow: The Frozen North \(Long winter\); clear skies: The Great Plain \(Winter\)\./);
  assert.match(text, /Battlefield The Eastern Front: blizzard now, The Frozen North, Long winter; over its last 10 days of fighting: snow 6, blizzard 2, clear 2\./);
  // Only the player's own wars, and only those being fought; names, never ids.
  assert.doesNotMatch(text, /Someone Else's War|An Old War|z-north|z-plain/);
  assert.deepEqual(frontSkiesOf(world(), "aland").map((front) => front.name), ["The Eastern Front"]);
});

test("another day's record is not today's: the weather is worked out as the turn and the map work it out", () => {
  const later = world({ zoneWeather: { date: "1941-12-01", zones: [{ id: "z-north", state: "fog", season: "Autumn" }] } });
  const expected = zoneWeatherFor(later, { seed: "campaign", date: "1942-01-15" }).zones.map((entry) => entry.state);
  assert.deepEqual(zoneSkiesOf(later, { date: "1942-01-15", seed: "campaign" }).map((entry) => entry.state), expected);
  // On the built-in basemaps, the real world's zones.
  assert.equal(zoneSkiesOf({}, { date: "1942-01-15", seed: "campaign" }).length, WORLD_CLIMATE_ZONES.length);
});

test("nothing when the scenario's wars have no weather, or there is none to tell", () => {
  assert.equal(describeWeatherForAdvisor({ world: world({ warSettings: { mechanics: { weather: false } } }), player: "Aland", date: "1942-01-15", seed: "campaign" }), "");
  assert.equal(describeWeatherForAdvisor({ world: { background: { kind: "image" } }, player: "Aland", date: "1942-01-15", seed: "campaign" }), "");
});

test("it rides in the advisor's own system prompt, beside what it is told of the player's territory", () => {
  const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8").split("\r\n").join("\n");
  assert.match(main, /import \{ describeWeatherForAdvisor \} from "\.\/advisorWeather\.js";/);
  assert.match(main, /advisorTerritory,\n {8}describeWeatherForAdvisor\(\{ world: worldData, player: gameData\?\.country \|\| "", date: gameData\?\.gameDate \|\| "" \}\),/);
});
