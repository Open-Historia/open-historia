/*! Open Historia — battlefields and fronts: seasons and the day's weather: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/weather.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { addGameDays, diffGameDays } from "../gameDates.js";
import { runNaval } from "../naval/engine.js";
import { describeBattlefield } from "./brief.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { CLIMATES, SEASONS, SPELL_DAYS, SPELL_EPOCH, WEATHER, WEATHER_ODDS, WEATHER_STATES, climateOf, pickWeather, seasonOf, weatherLoss, weatherOn } from "./weather.js";

test("climates by latitude, and seasons by month that turn round south of the equator", () => {
  assert.deepEqual([climateOf(75), climateOf(-52), climateOf(30), climateOf(5)], ["polar", "continental", "arid", "tropical"]);
  assert.deepEqual([1, 4, 7, 10].map((month) => seasonOf(month, 50)), ["winter", "spring", "summer", "autumn"]);
  assert.deepEqual([1, 4, 7, 10].map((month) => seasonOf(month, -35)), ["summer", "autumn", "winter", "spring"]);
  // Every season of every climate has its odds, and they add to one.
  for (const climate of CLIMATES) {
    for (const season of SEASONS) {
      const table = WEATHER_ODDS[climate][season];
      const sum = WEATHER_STATES.reduce((total, state) => total + table[state], 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${climate} ${season}: ${sum}`);
    }
  }
  assert.equal(pickWeather(WEATHER_ODDS.arid.summer, 0.1), "clear");
  assert.equal(pickWeather(WEATHER_ODDS.arid.summer, 0.99), "heat");
  // Clear weather does nothing.
  assert.deepEqual(WEATHER.clear, { pace: 1, attack: 1, wear: 0, rest: 1, air: 1, cold: 0, heat: 0 });
});

test("the weather comes in spells, the same for the same place and seed whoever draws it, and a calendar of its own is fair", () => {
  const on = (date, extra = {}) => weatherOn({ seed: "campaign", place: "Western Front", lat: 50, date, ...extra });
  // The same day twice is the same weather; a spell's days have the same.
  assert.deepEqual(on("1916-11-02"), on("1916-11-02"));
  // Within a spell the weather holds; it changes, if at all, only where a new spell or a new season begins.
  for (let at = 0; at < 60; at += 1) {
    const day = addGameDays("1916-01-01", at);
    const next = addGameDays(day, 1);
    if (diffGameDays(SPELL_EPOCH, next) % SPELL_DAYS !== 0 && on(next).season === on(day).season) assert.equal(on(next).state, on(day).state, day);
  }
  const winter = Array.from({ length: 120 }, (_, at) => on(addGameDays("1915-12-01", at)).state);
  assert.ok(new Set(winter).size > 1, "a winter is not one spell");
  assert.ok(winter.every((state) => Object.keys(WEATHER_ODDS.continental.winter).includes(state) && WEATHER_ODDS.continental.winter[state] > 0 || WEATHER_ODDS.continental.spring[state] > 0));
  assert.deepEqual(on("Year 12 of the Long Night"), { state: "clear", season: "", climate: "continental" });
  // Another campaign, another sky somewhere in a year.
  const other = Array.from({ length: 365 }, (_, at) => on(addGameDays("1916-01-01", at), { seed: "another" }).state);
  const mine = Array.from({ length: 365 }, (_, at) => on(addGameDays("1916-01-01", at)).state);
  assert.notDeepEqual(other, mine);
});

test("cold and heat wear down only troops short of supply", () => {
  const blizzard = { effects: WEATHER.blizzard };
  assert.equal(weatherLoss(blizzard, { supply: 1, pocket: false }), 0);
  assert.ok(weatherLoss(blizzard, { supply: 0.4, pocket: false }) > 0);
  assert.ok(weatherLoss(blizzard, { supply: 1, pocket: true }) > weatherLoss(blizzard, { supply: 0.4, pocket: false }));
  assert.equal(weatherLoss({ effects: WEATHER.rain }, { supply: 0, pocket: true }), 0);
  assert.equal(weatherLoss(null, { supply: 0, pocket: true }), 0);
});

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "weather" });
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: fixed, ...extra });
const heldBy = (extra) => {
  let last = null;
  const result = runFronts(war({ ...extra, watch: (seen) => { last = seen.holders; } }));
  return { held: [0, 1].map((side) => last.filter((holder) => holder === side).length), result };
};

test("deep mud and a blizzard stop an advance that clear weather would carry; the story is told the weather", () => {
  const clear = heldBy({ mechanics: { weather: true }, steering: { weather: "clear" } });
  const mud = heldBy({ mechanics: { weather: true }, steering: { weather: "mud" } });
  const blizzard = heldBy({ mechanics: { weather: true }, steering: { weather: "blizzard" } });
  assert.ok(mud.held[0] < clear.held[0], `${mud.held} against ${clear.held}`);
  assert.ok(blizzard.held[0] < mud.held[0], `${blizzard.held} against ${mud.held}`);
  // Clear weather is no weather at all: the run it always was.
  assert.deepEqual(clear.held, heldBy({}).held);
  // What the story is told: the season and the weather it was fought in.
  const text = describeBattlefield(mud.result.battlefields[0]);
  assert.match(text, /Weather: spring; mud on 20 of 20 days; mud now/);
  assert.doesNotMatch(describeBattlefield(heldBy({}).result.battlefields[0]), /Weather:/);
  // Its own weather, from the campaign's seed: the same run twice is the same war.
  const seeded = (seed) => runFronts(war({ mechanics: { weather: true }, climateSeed: seed })).battlefields;
  assert.deepEqual(seeded("one"), seeded("one"));
});

test("a storm at sea keeps fleets that would have met apart", () => {
  const fleet = (id, ownerCode, lng, lat) => ({ id, name: id, type: "naval", ownerCode, strength: 100, lng, lat, posture: "assaulting" });
  // Both in one five-degree stretch of sea, which has one sky.
  const units = [fleet("u1", "Albion", 13, 72), fleet("u2", "Teutonia", 17, 72)];
  const sea = (seed, weatherSeed) => runNaval({ fromDate: "1914-01-02", days: 8, seed, wars: [{ id: "war-1", status: "active", sideA: ["Albion"], sideB: ["Teutonia"] }], units, strengthOf: () => 13, weatherSeed });
  // A run in which they meet in fair weather, and a campaign whose arctic winter is one long storm for those eight days
  // (a rare campaign: most arctic winter days are clear).
  const met = Array.from({ length: 60 }, (_, at) => `run ${at}`).find((seed) => sea(seed, null).battles.length > 0);
  assert.ok(met, "fleets that seek battle meet within a week or so");
  const stormyAt = (weatherSeed, lng, lat) => Array.from({ length: 9 }, (_, day) => weatherOn({ seed: weatherSeed, place: `sea ${Math.round(lng / 5)} ${Math.round(lat / 5)}`, lat, date: addGameDays("1914-01-02", day) }).state)
    .every((state) => state === "storm" || state === "blizzard");
  const storm = Array.from({ length: 4000 }, (_, at) => `campaign ${at}`).find((weatherSeed) => stormyAt(weatherSeed, 13, 72) && stormyAt(weatherSeed, 17, 72));
  assert.ok(storm, "some campaign has such a storm");
  assert.ok(sea(met, storm).battles.length < sea(met, null).battles.length || sea(met, storm).battles.length === 0);
});
