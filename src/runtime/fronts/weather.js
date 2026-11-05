/*! Open Historia — battlefields and fronts: seasons and the day's weather © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "weather"). "Nothing in the war engine
// changes with the season: add in depth seasonal effects and weather
// conditions."
//
// Every battlefield has its CLIMATE, by how far from the equator the middle of
// its ground lies (polar, continental, arid, tropical), and every day its
// SEASON (by the month, the other way round south of the equator) and its
// WEATHER, drawn from what that season brings in that climate: snow and
// blizzards in a northern winter, the spring thaw and autumn rains that turn
// the ground to mud, summer heat in the desert, the monsoon in the tropics.
// Weather comes in SPELLS of a few days, the same for a battlefield whoever
// runs it and however the turns are cut: each is drawn from the campaign's own
// seed, the battlefield and the spell, nothing else.
//
// What the weather does (WEATHER), each morning (dawn.js) and evening:
//
//   pace     how far troops get: deep mud and blizzards stop an advance
//   attack   how hard they hit: fog and storms blunt an attack
//   wear     what a day of it adds to every troop's fatigue (fatigue.js)
//   rest     how much a day's rest freshens a troop in it
//   air      whether aircraft fly (air.js): storms, blizzards and fog ground them
//   cold     strength a day lost to cold, by a troop short of supply in it
//   heat     the same, to heat and thirst
//
// A scenario's designer may draw climate zones of their own over this
// (climate.js); where none reaches, this is the weather.
//
// Only + - * / and comparisons; dates through gameDates.js.

import { diffGameDays, parseGameDate } from "../gameDates.js";
import { hashSeed } from "../unitMotion.js";
import { climateAt, oddsAt, zoneNeighbours, zoneWeatherOn, zoneWeathersOn, zonesToday } from "./climate.js";
import { cellAt } from "./ground.js";
import { ATTRITION_DUG, ATTRITION_SHORT, ATTRITION_TIRED, ATTRITION_WEATHER } from "./constants.js";

export const WEATHER_STATES = Object.freeze(["clear", "rain", "storm", "mud", "snow", "blizzard", "frost", "heat", "fog"]);
export const SEASONS = Object.freeze(["winter", "spring", "summer", "autumn"]);
export const CLIMATES = Object.freeze(["polar", "continental", "arid", "tropical"]);

const effect = (pace, attack, wear, rest, air, cold, heat) => Object.freeze({ pace, attack, wear, rest, air, cold, heat });
export const WEATHER = Object.freeze({
  clear: effect(1, 1, 0, 1, 1, 0, 0),
  rain: effect(0.8, 0.95, 0.01, 0.9, 0.6, 0, 0),
  storm: effect(0.6, 0.85, 0.02, 0.8, 0, 0.1, 0),
  mud: effect(0.45, 0.85, 0.025, 0.85, 0.7, 0, 0),
  snow: effect(0.65, 0.9, 0.015, 0.85, 0.5, 0.3, 0),
  blizzard: effect(0.3, 0.7, 0.03, 0.6, 0, 1, 0),
  frost: effect(0.9, 0.95, 0.01, 0.8, 0.9, 0.6, 0),
  heat: effect(0.85, 0.9, 0.02, 0.8, 1, 0, 0.5),
  fog: effect(0.9, 0.8, 0, 1, 0, 0, 0),
});
// Strength a day that "cold" or "heat" of 1 takes from a troop wholly without supply.
export const WEATHER_LOSS = 1.2;

// What each season brings in each climate: the odds of each state, adding to 1.
// Clear skies are the commonest weather nearly everywhere, nearly always ("dont
// make it so there is always a weather condition, clear skies should be very
// common", the owner, 2026-10-14): a winter of the north has more clear, hard
// frosty days than snowy ones, and only the tropics' wet season rains more
// often than not.
const odds = (fields) => Object.freeze({ clear: 0, rain: 0, storm: 0, mud: 0, snow: 0, blizzard: 0, frost: 0, heat: 0, fog: 0, ...fields });
export const WEATHER_ODDS = Object.freeze({
  polar: Object.freeze({
    winter: odds({ clear: 0.45, frost: 0.25, snow: 0.2, blizzard: 0.1 }),
    spring: odds({ clear: 0.55, frost: 0.15, snow: 0.15, fog: 0.15 }),
    summer: odds({ clear: 0.65, fog: 0.2, rain: 0.15 }),
    autumn: odds({ clear: 0.5, snow: 0.2, frost: 0.15, rain: 0.15 }),
  }),
  continental: Object.freeze({
    winter: odds({ clear: 0.5, snow: 0.2, frost: 0.15, blizzard: 0.05, fog: 0.1 }),
    spring: odds({ clear: 0.55, rain: 0.2, mud: 0.2, fog: 0.05 }),
    summer: odds({ clear: 0.7, rain: 0.15, storm: 0.08, heat: 0.07 }),
    autumn: odds({ clear: 0.55, rain: 0.2, mud: 0.15, fog: 0.1 }),
  }),
  arid: Object.freeze({
    winter: odds({ clear: 0.8, rain: 0.12, fog: 0.08 }),
    spring: odds({ clear: 0.75, heat: 0.18, storm: 0.07 }),
    summer: odds({ clear: 0.6, heat: 0.4 }),
    autumn: odds({ clear: 0.82, heat: 0.13, rain: 0.05 }),
  }),
  tropical: Object.freeze({
    winter: odds({ clear: 0.7, heat: 0.22, fog: 0.08 }),
    spring: odds({ clear: 0.6, heat: 0.2, rain: 0.2 }),
    summer: odds({ clear: 0.4, rain: 0.35, storm: 0.15, mud: 0.1 }),
    autumn: odds({ clear: 0.45, rain: 0.3, storm: 0.15, mud: 0.1 }),
  }),
});

// How many days a spell of weather lasts.
export const SPELL_DAYS = 4;
// The day spells are counted from.
export const SPELL_EPOCH = "2000-01-01";

// A climate by latitude.
export const climateOf = (lat) => {
  const away = lat < 0 ? -lat : lat;
  return away >= 60 ? "polar" : away >= 40 ? "continental" : away >= 20 ? "arid" : "tropical";
};

// A season by month (1 to 12) and latitude: the other way round south of the equator.
export const seasonOf = (month, lat) => {
  const turned = lat < 0 ? ((month + 5) % 12) + 1 : month;
  return turned === 12 || turned <= 2 ? "winter" : turned <= 5 ? "spring" : turned <= 8 ? "summer" : "autumn";
};

// What a draw from 0 up to 1 comes to among a season's odds.
export const pickWeather = (table, draw) => {
  let sum = 0;
  for (const state of WEATHER_STATES) {
    sum += table[state] ?? 0;
    if (draw < sum) return state;
  }
  return "clear";
};

// The weather on a day at a place: { state, season, climate }. `place` names
// what is having it (a battlefield, a stretch of sea): the same place, seed
// and spell is the same weather. A date the calendar cannot read is fair.
// `odds`, where given, are what the season brings there instead of the world's own (climate.js).
export const weatherOn = ({ seed = "", place = "", lat = 45, date = "", odds = null } = {}) => {
  const climate = climateOf(lat);
  const parsed = parseGameDate(date);
  if (!parsed) return { state: "clear", season: "", climate };
  const season = seasonOf(parsed.month, lat);
  return { state: pickWeather(odds ?? WEATHER_ODDS[climate][season], weatherDraw(seed, place, date)), season, climate };
};

// The draw, from 0 up to 1, that picks a place's weather for the spell a date is in.
export const weatherDraw = (seed, place, date) => {
  const days = diffGameDays(SPELL_EPOCH, date);
  const spell = Math.floor((Number.isFinite(days) ? days : 0) / SPELL_DAYS);
  return (hashSeed(`${seed}|${place}|${spell}|weather`) % 10000) / 10000;
};

// A zone's weather on a day of a run: every zone's worked out together once a
// day, so that each fits the zones beside it (climate.js zoneWeathersOn).
const zoneSkyOn = (run, zone, date, seed) => {
  if (run.zoneSkiesDate !== date) {
    const zones = Array.isArray(run.input?.climateZones) ? run.input.climateZones : [];
    if (!run.zoneNeighbours) run.zoneNeighbours = zoneNeighbours(zones);
    run.zoneSkies = zoneWeathersOn({ seed, zones, date, neighbours: run.zoneNeighbours });
    run.zoneSkiesDate = date;
  }
  const found = run.zoneSkies.find((entry) => entry.zone === zone) ?? run.zoneSkies.find((entry) => entry.zone?.id === zone?.id);
  return found ? { state: found.state, season: found.season, climate: found.climate } : zoneWeatherOn({ seed, zone, date });
};

// What a battlefield's weather is on a date: where its ground's middle lies, read
// once a frame (battle.climateFor). { sky, today, middle }: the weather, what the
// scenario's climate zones do that day (climate.js), and the middle's cell.
const skyAt = (run, battle, date) => {
  if (battle.climateFor !== battle.place) {
    const [, lat] = battle.place.toLngLat(battle.field.cols / 2, battle.field.rows / 2);
    battle.climateLat = Math.round(lat * 100) / 100;
    battle.climateFor = battle.place;
  }
  const seed = String(run.input?.climateSeed ?? run.seed ?? "");
  // Where a scenario's own climate zones reach the battlefield (climate.js), they bring its weather and set
  // what each troop's own ground does today; at its middle, the odds of the day's weather and the season's name.
  const today = zonesToday(run, battle, date, battle.climateLat);
  const parsed = parseGameDate(date);
  const worldOdds = parsed ? WEATHER_ODDS[climateOf(battle.climateLat)][seasonOf(parsed.month, battle.climateLat)] : null;
  const middle = cellAt(battle.field, battle.field.cols / 2, battle.field.rows / 2);
  const there = today && worldOdds ? oddsAt(today, middle, worldOdds) : null;
  // In a zone (half or more of its weight at the middle) the weather is the zone's, one for the whole of it
  // (climate.js zoneWeatherOn); elsewhere the battlefield's own, from the odds where it lies.
  const sky = there?.zone
    ? zoneSkyOn(run, there.zone.zone, date, seed)
    : weatherOn({ seed, place: battle.name, lat: battle.climateLat, date, odds: there ? there.odds : null });
  if (there?.zone) sky.season = `${there.zone.zone.name ? `${there.zone.zone.name}, ` : ""}${sky.season}`;
  const forced = run.steer?.weather;
  return { sky, today, middle, state: typeof forced === "string" && WEATHER[forced] ? forced : sky.state };
};

// The weather ahead: each of the `days` after `day` of a run, as skyOver will find it then (the weather is drawn
// from the campaign's seed, so it is known in advance): [{ d, w }], for the War Room's forecast (battle.js).
export const FORECAST_DAYS = 14;
export const skiesAhead = (run, battle, day, days = FORECAST_DAYS) => {
  const ahead = [];
  for (let step = 1; step <= days; step += 1) {
    const date = run.dateOf(day + step);
    if (!parseGameDate(date)) break;
    ahead.push({ d: date, w: skyAt(run, battle, date).state });
  }
  return ahead;
};

// A battlefield's weather for a day of a run (skyAt). Sets battle.sky = { state,
// season, climate, effects } and counts the day (battle.skies) for the story.
export const skyOver = (run, battle, day) => {
  const { sky, today, middle, state } = skyAt(run, battle, run.dateOf(day));
  battle.climateToday = today;
  // (The zones' own say over whether aircraft fly, at its middle.)
  const local = today ? climateAt(today, middle) : null;
  battle.sky = { ...sky, state, effects: local && local.air !== 1 ? { ...WEATHER[state], air: WEATHER[state].air * local.air } : WEATHER[state] };
  if (!battle.skies) battle.skies = {};
  battle.skies[state] = (battle.skies[state] ?? 0) + 1;
  return battle.sky;
};

// How harsh a troop's day is: the day's weather's cold and heat, and its own
// ground's where a scenario's climate zones say more (climate.js).
export const harshnessOf = (sky, troop) => (sky ? sky.effects.cold + sky.effects.heat + (troop.climate ? troop.climate.cold + troop.climate.heat : 0) : 0);

// What a day of weather takes from a troop's strength: by its supply (a troop
// cut off has none), and with attrition on (`exposure`: { short }, the side's
// shortage) from every troop out in it, supplied or not: the more so tired and
// short, the less so dug in (constants.js ATTRITION_*).
export const weatherLoss = (sky, troop, exposure = null) => {
  if (!sky) return 0;
  const harsh = harshnessOf(sky, troop);
  if (!(harsh > 0)) return 0;
  const short = troop.pocket ? 1 : 1 - troop.supply;
  const unsupplied = short > 0 ? harsh * WEATHER_LOSS * short : 0;
  if (!exposure) return unsupplied;
  const tired = troop.fatigue > 0 ? (troop.fatigue < 1 ? troop.fatigue : 1) : 0;
  const lacking = exposure.short > 0 ? (exposure.short < 1 ? exposure.short : 1) : 0;
  const exposed = harsh * ATTRITION_WEATHER * (1 + ATTRITION_TIRED * tired) * (troop.dug ? ATTRITION_DUG : 1);
  return (unsupplied + exposed) * (1 + ATTRITION_SHORT * lacking);
};
