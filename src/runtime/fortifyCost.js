/*! Open Historia — how long a fortified line takes to build © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Make it so you can also manually draw fortified lines you want to create in
// the war room, and it says how long it will take to build depending on the
// size, on your country resources, manpower, and the time should also depend
// on the strength of the fortifications you want build."
//
// A line drawn in the war room (GameUI/warRoomFortify.jsx, runtime/fronts/
// fortifyOps.js) stands only once it is built: until then it is one of the
// world's lines (warGeography.js fortifications) with `building: { since,
// days }`, and the engine leaves it out of the fighting (fronts/walls.js
// standsOn). How many days is worked out here, from four things:
//
//   its length    every kilometre of it is dug, raised and manned, so the
//                 days go as the length
//   its level     3 (a palisade) to 9 (a great wall): a higher line is both
//                 taller and deeper, so they go as the square of it. A line
//                 nobody passes (10) is a scenario designer's alone, drawn in
//                 the Workshop: no country builds one in a game
//   the treasury  what the country has for its forces against the countries
//                 it is compared with (militaryFunding.js fundingFactor, 0.6
//                 to 1.5; 1 where its economy is not known)
//   manpower      the men fit to serve, counted as the land war counts them
//                 (fronts/manpower.js: its people by its share of them),
//                 against REFERENCE_MEN; the work is shared out along the line
//                 and only so many hands can work a stretch at once, so it
//                 goes by the square root of the men
//
//   days = km × level² × DAYS_PER_KM / (funding × √(men / REFERENCE_MEN))
//
// held between a day and a hundred years. For a country of some eight million
// people with its treasury in order, a 10 km palisade is about a week, a 50 km
// line of level 5 a little over three months, and a 1,000 km great wall of
// level 9 some eighteen years; a great power builds the same in a fraction of the time,
// and a small state in two or three times as long.
//
// Pure, and loads in plain Node.

import { MANPOWER_SHARE } from "./fronts/constants.js";
import { kmBetween, measureOptions } from "./fronts/worldGrid.js";
import { engineMapOf, worldMeasureOf } from "../../server/mapDistance.js";
import { currentMapMeasure } from "./mapMeasure.js";
import { fundingFactor, middleFundingPerHead } from "./militaryFunding.js";
import { militaryLookup } from "./militaryStats.js";
import { populationFigureOf } from "./populationFigure.js";
import { WALL_LEVEL_LEAST } from "./warGeography.js";
import { warSettingsOf } from "./warSettings.js";

// The days a kilometre of line takes at level 1, for a country of REFERENCE_MEN
// men fit to serve whose treasury is in order.
export const DAYS_PER_KM = 0.08;
// The men fit to serve of a country of middling size: some eight million
// people at the usual share of them.
export const REFERENCE_MEN = 1000000;
export const BUILD_DAYS_LEAST = 1;
export const BUILD_DAYS_MOST = 36500;
// The level a line is drawn at until another is picked.
export const FORTIFY_LEVEL_USUAL = 5;
// The strongest line a country can have built in a game. A line nobody passes
// (level 10, warGeography.js WALL_LEVEL_MOST) is a scenario designer's alone
// (the owner, 2026-10-14: "players should not be able to build level 10
// things, only scenario designers").
export const FORTIFY_LEVEL_MOST = 9;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const records = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

// A level as a country builds a line at: a whole number from 3 to FORTIFY_LEVEL_MOST.
export const fortifyLevelOf = (value) => {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level)) return FORTIFY_LEVEL_USUAL;
  return Math.max(WALL_LEVEL_LEAST, Math.min(FORTIFY_LEVEL_MOST, level));
};

// The days to build a line.
//   km       its length
//   level    3 to 9
//   funding  the country's funding factor (militaryFunding.js), 1 for none known
//   men      its men fit to serve; REFERENCE_MEN where nothing is known of them
export const buildDays = ({ km = 0, level = FORTIFY_LEVEL_USUAL, funding = 1, men = REFERENCE_MEN } = {}) => {
  const length = Math.max(0, Number(km) || 0);
  const height = fortifyLevelOf(level);
  const purse = Number(funding) > 0 ? Number(funding) : 1;
  const hands = Number(men) > 0 ? Number(men) : REFERENCE_MEN;
  const days = (length * height * height * DAYS_PER_KM) / (purse * Math.sqrt(hands / REFERENCE_MEN));
  return Math.max(BUILD_DAYS_LEAST, Math.min(BUILD_DAYS_MOST, Math.round(days)));
};

// How long a line is, in kilometres, measured as the engine measures it (fronts/walls.js readLines),
// on the map whose measure is given (server/mapDistance.js), by default the one being played.
export const lineKm = (points, measure = currentMapMeasure()) => {
  const line = Array.isArray(points) ? points : [];
  const options = measureOptions(engineMapOf(measure));
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    const [lngA, latA] = line[index - 1] ?? [];
    const [lngB, latB] = line[index] ?? [];
    if ([lngA, latA, lngB, latB].every(Number.isFinite)) total += kmBetween(lngA, latA, lngB, latB, options);
  }
  return total;
};

// A country's people as the land war reads them (Game/AI/frontTurn.js
// frontWorldReaders): its sheet's figure, else the figure the scenario's author
// gave it or its group (runtime/populationFigure.js); 0 where nothing says.
export const peopleOf = (world, country) => {
  const wanted = fold(country);
  if (!wanted) return 0;
  for (const [key, sheet] of Object.entries(records(world?.countryStats))) {
    const total = Number(sheet?.population?.total);
    if (fold(key) === wanted && Number.isFinite(total) && total > 0) return total;
  }
  for (const [key, record] of Object.entries(records(world?.polityOverrides))) {
    const figure = populationFigureOf(record);
    if ((fold(key) === wanted || fold(record?.name) === wanted) && figure > 0) return figure;
  }
  for (const [key, record] of Object.entries(records(world?.groups))) {
    const figure = populationFigureOf(record);
    if (fold(key) === wanted && figure > 0) return figure;
  }
  return 0;
};

// The share of a country's people who can fight, as the land war reads it
// (fronts/manpower.js shareOf): its own military figure where the scenario
// weighs them, else the scenario's, else the game's twelve in a hundred.
export const manpowerShareOf = (world, country) => {
  const settings = warSettingsOf(world);
  const own = settings.mechanics.military ? Number(militaryLookup(world)(country)?.manpowerShare) : 0;
  if (own > 0) return own / 100;
  return Number(settings.manpowerShare) > 0 ? Number(settings.manpowerShare) / 100 : MANPOWER_SHARE;
};

// What a country's treasury does for its forces (militaryFunding.js), against
// the other sheets the world has: 1 where its economy is not known.
export const fundingOf = (world, country) => {
  const sheets = records(world?.countryStats);
  const key = Object.keys(sheets).find((name) => fold(name) === fold(country));
  return key ? fundingFactor(sheets[key], middleFundingPerHead(sheets)) : 1;
};

// What a line of `points` ([lng, lat]) at `level` would take a country, and why:
//   { km, level, funding, people, men, days }
// `people` and `men` are 0 where its people are not known; it is then reckoned
// as a country of REFERENCE_MEN.
//
// fortifyCostReckoner(world, country) works out the country's part once and
// prices any line and level with it: (points, level) => the same answer. The
// engineers price up to seven heights of a line, shortening it as they go, and
// read the country's sheets, people and figures each time (2026-10-24).
export const fortifyCostReckoner = (world, country) => {
  const funding = fundingOf(world, country);
  const people = peopleOf(world, country);
  const men = people > 0 ? Math.round(people * manpowerShareOf(world, country)) : 0;
  const measure = worldMeasureOf(world);
  return (points, level) => {
    const km = lineKm(points, measure);
    const height = fortifyLevelOf(level);
    return {
      km: Math.round(km * 10) / 10,
      level: height,
      funding: Math.round(funding * 100) / 100,
      people,
      men,
      days: buildDays({ km, level: height, funding, men }),
    };
  };
};

export const fortifyCostFor = (world, country, points, level) => fortifyCostReckoner(world, country)(points, level);

// How a build time is said: { count, unit }, the unit "day" under a fortnight,
// "week" under two months, "month" under two years and "year" beyond.
export const buildTimeParts = (days) => {
  const value = Math.max(1, Math.round(Number(days) || 1));
  if (value < 14) return { count: value, unit: "day" };
  if (value < 61) return { count: Math.round(value / 7), unit: "week" };
  if (value < 730) return { count: Math.round(value / 30.44), unit: "month" };
  return { count: Math.round(value / 365.25), unit: "year" };
};
