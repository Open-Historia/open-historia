/*! Open Historia — battlefields and fronts: a scenario's own climate zones, and ice: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/climate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { frozenFor } from "../../Game/AI/frontTurn.js";
import { runNaval } from "../naval/engine.js";
import { zoneWeightAt } from "../warGeography.js";
import { describeBattlefield } from "./brief.js";
import { decodeTroops } from "./codec.js";
import { WEATHER_NEIGHBOURS, climateAt, freezesAt, seasonMixOn, weathersFit, zoneLatOf, zoneMixOn, zoneWeatherOn, zoneWeathersOn, zonesMeet, zonesOver } from "./climate.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const winterZone = (extra = {}) => ({
  id: "north", name: "The North", color: "#aabbcc", blendKm: 100, transitionDays: 20,
  rings: [[[23.5, 53], [29, 53], [29, 49], [23.5, 49]]],
  seasons: [
    { name: "Winter", start: "12-01", end: "02-28", weather: { blizzard: 1 }, effects: { pace: 0.3, freezes: true } },
    { name: "Thaw", start: "03-01", end: "04-30", weather: { mud: 1 }, effects: { pace: 0.6 } },
  ],
  events: [],
  ...extra,
});

test("a zone's seasons fade into each other over its transition days, and its events in and out", () => {
  const zone = winterZone();
  // Deep in winter, all winter; on the day the thaw begins, half and half; ten days on, all thaw.
  assert.deepEqual(seasonMixOn(zone, "0300-01-15"), [{ season: 0, weight: 1 }]);
  const turning = seasonMixOn(zone, "0300-03-01");
  assert.equal(turning[0].season, 1);
  assert.ok(Math.abs(turning[0].weight - 0.525) < 1e-9 && Math.abs(turning[1].weight - 0.475) < 1e-9, JSON.stringify(turning));
  assert.deepEqual(seasonMixOn(zone, "0300-03-15"), [{ season: 1, weight: 1 }]);
  // Out of its seasons, the world's own (-1).
  assert.deepEqual(seasonMixOn(zone, "0300-07-01"), [{ season: -1, weight: 1 }]);
  // A hard edge where it asks for none.
  assert.deepEqual(seasonMixOn({ ...zone, transitionDays: 0 }, "0300-03-01"), [{ season: 1, weight: 1 }]);
  // What it brings: winter's pace and blizzards, the thaw's mud; an event takes over what it says.
  assert.equal(zoneMixOn(zone, "0300-01-15", 50).effects.pace, 0.3);
  assert.equal(zoneMixOn(zone, "0300-01-15", 50).odds.blizzard, 1);
  assert.equal(zoneMixOn(zone, "0300-01-15", 50).season, "Winter");
  const night = winterZone({ events: [{ name: "The Long Night", from: "0300-03-10", to: "0300-03-20", weather: "blizzard", effects: { pace: 0.1 } }] });
  assert.equal(zoneMixOn(night, "0300-03-15", 50).effects.pace, 0.1);
  assert.equal(zoneMixOn(night, "0300-03-15", 50).season, "The Long Night");
  assert.ok(zoneMixOn(night, "0300-03-06", 50).effects.pace < 0.6 && zoneMixOn(night, "0300-03-06", 50).effects.pace > 0.1, "fading in");
});

test("a zone's weight is a half at its edge, the whole well inside, nothing well outside", () => {
  const zone = winterZone();
  assert.ok(Math.abs(zoneWeightAt(zone, 23.5, 51) - 0.5) < 0.01);
  assert.equal(zoneWeightAt(zone, 26, 51), 1);
  assert.equal(zoneWeightAt(zone, 20, 51), 0);
  assert.ok(zoneWeightAt(zone, 23.9, 51) > 0.6 && zoneWeightAt(zone, 23.1, 51) < 0.4);
});

test("water freezes in its zone's winter, or where no zone reaches in a cold climate's own", () => {
  const zones = [{ zone: winterZone(), inside: (lng, lat) => zoneWeightAt(winterZone(), lng, lat) }];
  assert.equal(freezesAt(zones, 26, 51, "0300-01-15"), true);
  assert.equal(freezesAt(zones, 26, 51, "0300-03-15"), false);
  // Outside the zone: the world's own winter at 51 north freezes it, the tropics never.
  assert.equal(freezesAt(zones, 15, 51, "0300-01-15"), true);
  assert.equal(freezesAt([], 15, 5, "0300-01-15"), false);
  assert.equal(freezesAt(zones, 26, 51, "Year 12"), false);
});

const legend = { A: "Aland", B: "Borduria", L: { owner: "", typeId: "lake" } };
const lakeTypes = [{ id: "lake", name: "Lake", water: true, pathfindingSpeed: 0 }];
const sheet = (layout = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], key = "climate") => syntheticMap({ layout, legend, west: 20, north: 52, step: 1, stepLat: 0.5, key });
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
const fight = (world, extra = {}) => {
  let last = null;
  const result = runFronts(frontInput(world, {
    arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: fixed, fromDate: "0300-01-05",
    watch: (seen) => { last = seen.holders; },
    ...extra,
  }));
  const aland = result.battlefields[0]?.sides.findIndex((members) => members[0] === "Aland") ?? 0;
  return { result, held: last ? last.filter((holder) => holder === aland).length : 0 };
};

test("a zone's winter slows an advance into it and brings its weather; the story is told its season", () => {
  const world = sheet();
  const plain = fight(world, { mechanics: { weather: true }, steering: { weather: "clear" } });
  const zoned = fight(sheet(), { mechanics: { weather: true }, steering: { weather: "clear" }, climateZones: [winterZone()] });
  assert.ok(zoned.held < plain.held, `${zoned.held} against ${plain.held}`);
  // Its own weather: blizzards, all winter.
  const sky = fight(sheet(), { mechanics: { weather: true }, climateZones: [winterZone({ rings: [[[18, 54], [30, 54], [30, 48], [18, 48]]] })] });
  assert.match(describeBattlefield(sky.result.battlefields[0]), /Weather: The North, Winter; blizzard on 20 of 20 days/);
  // Where it reaches, cell by cell: Borduria's side is in it, Aland's west is not.
  let battle = null;
  runFronts(frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 1, fromDate: "0300-01-05", mechanics: { weather: true }, climateZones: [winterZone()], staffPolicy: (seen) => { battle = battle ?? seen; return undefined; } }));
  const zones = zonesOver({ input: { climateZones: [winterZone()] } }, battle);
  const { cols, rows } = battle.field;
  const at = (lng) => {
    const [x] = battle.place.toCell(lng, 51);
    return Math.floor(rows / 2) * cols + Math.floor(x);
  };
  assert.equal(zones.length, 1);
  assert.ok(zones[0].weights[at(27)] > 0.99 && zones[0].weights[at(20.5)] === 0, `${zones[0].weights[at(27)]} ${zones[0].weights[at(20.5)]}`);
  assert.ok(Math.abs(zones[0].weights[at(23.5)] - 0.5) < 0.15, String(zones[0].weights[at(23.5)]));
  const today = [{ ...zones[0], mix: zoneMixOn(winterZone(), "0300-01-15", 51) }];
  assert.equal(climateAt(today, at(27)).pace, 0.3);
  assert.equal(climateAt(today, at(20.5)).pace, 1);
});

test("a zone has one weather at a time: a battlefield in it fights in the zone's weather, the one the map draws", () => {
  // A zone of mixed weather over the whole battlefield, so its middle is in it.
  const mixed = winterZone({
    rings: [[[18, 54], [30, 54], [30, 48], [18, 48]]],
    seasons: [{ name: "Winter", start: "12-01", end: "02-28", weather: { snow: 1, rain: 1, fog: 1, frost: 1 }, effects: {} }],
  });
  const days = [];
  for (const span of [3, 7, 12, 17]) {
    const { result } = fight(sheet(), { mechanics: { weather: true }, climateZones: [mixed], climateSeed: "campaign-1", days: span });
    const record = result.battlefields[0];
    days.push([record.asOf, record.brief.weather.now]);
    // The battlefield's weather on its last day is the zone's (zoneWeatherOn), as the map draws it.
    assert.equal(record.brief.weather.now, zoneWeatherOn({ seed: "campaign-1", zone: mixed, date: record.asOf }).state, record.asOf);
    assert.match(record.brief.weather.season, /^The North, Winter$/);
  }
  assert.ok(new Set(days.map(([, now]) => now)).size > 1, `the weather changes from spell to spell: ${JSON.stringify(days)}`);
  // The same zone, seed and spell is the same weather, whoever asks; another campaign, its own.
  const once = zoneWeatherOn({ seed: "campaign-1", zone: mixed, date: "0300-01-10" });
  assert.deepEqual(zoneWeatherOn({ seed: "campaign-1", zone: { ...mixed }, date: "0300-01-10" }), once);
  assert.equal(once.season, "Winter");
  const others = ["a", "b", "c", "d", "e", "f"].map((seed) => zoneWeatherOn({ seed, zone: mixed, date: "0300-01-10" }).state);
  assert.ok(new Set(others).size > 1, String(others));
  // Reckoned at the middle of the zone, north to south.
  assert.equal(zoneLatOf(mixed), 51);
});

test("a zone's weather fits the zones beside it: snow is never beside heat, and the smaller zone gives way", () => {
  const box = (id, west, east, weather) => ({ id, name: id, color: "#8899aa", blendKm: 200, transitionDays: 0, rings: [[[west, 46], [east, 46], [east, 52], [west, 52]]], seasons: [{ name: "All year", start: "01-01", end: "12-31", weather, effects: {} }], events: [] });
  // A great hot plain beside a small cold one, and a far one alone.
  const hot = box("hot", 20, 34, { heat: 1 });
  const cold = box("cold", 34, 38, { blizzard: 3, snow: 2, clear: 1 });
  const far = box("far", 80, 84, { blizzard: 1 });
  assert.equal(zonesMeet(hot, cold), true);
  assert.equal(zonesMeet(hot, far), false);
  for (const date of ["0300-01-05", "0300-01-09", "0300-01-13", "0300-02-20"]) {
    const [h, c, f] = zoneWeathersOn({ seed: "c", zones: [hot, cold, far], date }).map((entry) => entry.state);
    assert.equal(h, "heat", "the larger zone keeps its own");
    assert.equal(c, "clear", "of the weathers that fit heat, only clear is in the small zone's own odds");
    assert.equal(f, "blizzard", "a zone with none beside it keeps its own");
  }
  // The table goes both ways, and each weather may lie beside its own kind.
  for (const [a, list] of Object.entries(WEATHER_NEIGHBOURS)) {
    assert.ok(list.includes(a), a);
    for (const b of list) assert.ok(WEATHER_NEIGHBOURS[b].includes(a), `${a} and ${b}`);
  }
  assert.equal(weathersFit("snow", "heat"), false);
  assert.equal(weathersFit("blizzard", "rain"), false);
  assert.equal(weathersFit("storm", "rain"), true);
  // In the engine: a battle in the small cold zone, beside a greater hot one, fights in the weather that fits.
  const { result } = fight(sheet(), { mechanics: { weather: true }, climateZones: [box("west", 6, 22, { heat: 1 }), box("here", 22, 30, { blizzard: 3, snow: 2, clear: 1 })], climateSeed: "c", days: 6 });
  assert.equal(result.battlefields[0].brief.weather.now, "clear");
});

test("frozen water is crossed, slowly; thawed, it is wall again and those on it get off it as they can", () => {
  // A lake down the middle of the border, the two countries either side.
  const layout = ["AAALLBBB", "AAALLBBB", "AAALLBBB", "AAALLBBB"];
  const lake = sheet(layout, "lake");
  const ids = lake.regions.filter((region) => region.typeId === "lake").map((region) => region.id);
  const open = fight(lake, { regionTypes: lakeTypes });
  assert.equal(open.result.battlefields.length, 0, "with the lake between them, no front at all");
  const frozen = fight(sheet(layout, "lake"), { regionTypes: lakeTypes, map: { ...lake.map, frozen: ids } });
  assert.equal(frozen.result.battlefields.length, 1, "frozen, it is a front");
  assert.match(describeBattlefield(frozen.result.battlefields[0]), /Ice: .* frozen hard enough for troops to cross/);
  // The thaw: the next run, without the ice, finds nobody left on it.
  const [record] = frozen.result.battlefields;
  const thawed = runFronts(frontInput(sheet(layout, "lake"), { arenas: new Map(), staff: true, troops: 1, days: 1, strengthOf: () => 4, staffPolicy: fixed, regionTypes: lakeTypes, battlefields: [record], fromDate: record.asOf }));
  const [after] = thawed.battlefields;
  assert.ok(after, "the battlefield is still there");
  const onIce = (entry) => [0, 1].flatMap((side) => decodeTroops(entry.troops[side]).filter((troop) => troop.strength > 0).map((troop) => entry.frame.lng0 + troop.x * entry.frame.cell)).filter((lng) => lng > 23.05 && lng < 24.95);
  assert.ok(onIce(record).length > 0, "troops stood on the ice");
  assert.deepEqual(onIce(after), [], "and none is left on the water");
  // And the turn knows which of a scenario's waters are frozen when.
  const world = { freezingRegions: ids, climateZones: [] };
  const regions = lake.regions.map((region) => ({ ...region, bbox: region.bbox }));
  assert.deepEqual(frozenFor({ world, regions, fromDate: "0300-01-05", days: 20 }).map((entry) => entry.id).sort(), ids.slice().sort());
  assert.deepEqual(frozenFor({ world, regions, fromDate: "0300-07-05", days: 20 }), []);
});

test("a fleet frozen in neither sails nor fights", () => {
  const fleet = (id, ownerCode, lng, lat) => ({ id, name: id, type: "naval", ownerCode, strength: 100, lng, lat, posture: "assaulting" });
  const sea = (seed, iced) => runNaval({ fromDate: "1914-08-02", days: 20, seed, wars: [{ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"] }], units: [fleet("u1", "Albion", 2, 56), fleet("u2", "Teutonia", 6, 55)], strengthOf: () => 13, iced });
  const met = Array.from({ length: 40 }, (_, at) => `run ${at}`).find((seed) => sea(seed, []).battles.length > 0);
  assert.ok(met);
  assert.deepEqual(sea(met, [[5, 54, 7, 56]]).battles, [], "the one frozen in is not brought to battle");
});
