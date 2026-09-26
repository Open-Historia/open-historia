/*! Open Historia — a city's population by year © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A city in a scenario's cities.geojson may carry its population by year:
//   - a `populationByYear` object, { "1950": 3400000, "2000": 18000000 } (what
//     the Workshop writes; "-500" is 500 BC),
//   - a list of rows, [{ "year": 1950, "population": 3400000 }] or [[1950, 3400000]],
//   - or flat properties, the way Natural Earth's populated places and the UN's
//     city tables spell them: POP1950, pop_2000, population_2020.
// The game reads the population for its own date off that series — straight
// between the two years around it, the nearest year's figure outside them —
// until the AI (or the Game Master) sets the city's population by hand
// (world.cityPopulations, the markerOps "population" op). From then on the
// hand-set figure is the city's population and the series is not read for it.
//
// Years are calendar years, BC negative (gameDates.js); the series is read on
// the astronomical scale, which has a year zero. A figure of 0 or less is no
// figure: Natural Earth fills the years it lacks with 0.

import { astronomicalYear, parseGameDate } from "./gameDates.js";

const SERIES_KEYS = ["populationByYear", "population_by_year", "populations", "populationHistory", "population_history"];
const FLAT_KEY = /^pop(?:ulation)?[\s_-]?(\d{3,4})$/i;
const MAX_POINTS = 400;

const toYear = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n !== 0 && Math.abs(n) <= 100000 ? n : null;
};
const toPopulation = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

// { [calendarYear]: population } from any of the shapes above; {} when none.
export const readPopulationByYear = (properties) => {
  const out = {};
  const put = (year, value) => {
    const y = toYear(year);
    const p = toPopulation(value);
    if (y !== null && p !== null && Object.keys(out).length < MAX_POINTS) out[y] = p;
  };
  const props = properties && typeof properties === "object" ? properties : {};
  for (const key of SERIES_KEYS) {
    let value = props[key];
    // A map click hands nested properties back as JSON text.
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { value = null; }
    }
    if (Array.isArray(value)) {
      for (const row of value) {
        if (Array.isArray(row)) put(row[0], row[1]);
        else if (row && typeof row === "object") put(row.year ?? row.y, row.population ?? row.pop ?? row.value);
      }
    } else if (value && typeof value === "object") {
      for (const [year, population] of Object.entries(value)) put(year, population);
    }
  }
  for (const [key, value] of Object.entries(props)) {
    const match = FLAT_KEY.exec(key);
    if (match) put(match[1], value);
  }
  return out;
};

export const hasPopulationByYear = (properties) => Object.keys(readPopulationByYear(properties)).length > 0;

// { populationByYear } for a city record when its properties carry a series in
// any shape, {} when they do not: how every import and export keeps it.
export const populationByYearField = (properties) => {
  const byYear = readPopulationByYear(properties);
  return Object.keys(byYear).length ? { populationByYear: byYear } : {};
};

// The newest figure in a series, for a city that came with no single number.
export const latestPopulation = (byYear) => {
  const years = Object.keys(byYear ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return years.length ? Number(byYear[years[years.length - 1]]) || 0 : 0;
};

// Sorted [[astronomicalYear, population], ...].
const seriesOf = (byYear) => Object.entries(byYear ?? {})
  .map(([year, population]) => [astronomicalYear(Number(year)), Number(population)])
  .filter(([year, population]) => Number.isFinite(year) && Number.isFinite(population))
  .sort((a, b) => a[0] - b[0]);

const readSeries = (series, at) => {
  if (!series.length || !Number.isFinite(at)) return null;
  if (at <= series[0][0]) return series[0][1];
  const last = series[series.length - 1];
  if (at >= last[0]) return last[1];
  for (let index = 1; index < series.length; index += 1) {
    const [y1, p1] = series[index];
    if (at <= y1) {
      const [y0, p0] = series[index - 1];
      return Math.round(p0 + (p1 - p0) * ((at - y0) / (y1 - y0)));
    }
  }
  return last[1];
};

// Where a date sits on the astronomical scale: its year, plus the part of it gone.
export const gameDateFractionalYear = (value) => {
  const parts = parseGameDate(value);
  if (!parts) return null;
  return astronomicalYear(parts.year) + ((parts.month - 1) * 30.44 + (parts.day - 1)) / 365.25;
};

// The series' population on a date, or null without a series or a date.
export const populationForDate = (byYear, date) => readSeries(seriesOf(byYear), gameDateFractionalYear(date));
// ...and at the start of a calendar year (the map redraws once a year).
export const populationForYear = (byYear, year) => (
  Number.isInteger(Number(year)) && Number(year) !== 0 ? readSeries(seriesOf(byYear), astronomicalYear(Number(year))) : null
);

// The key world.cityPopulations is kept under: the name, lower-cased
// (gameState.js applyEventImpactsToWorld, Cities.jsx cityPopulationExpr).
export const cityPopulationKey = (name) => String(name ?? "").trim().toLowerCase();

// The population the game uses for a city on a date: a hand-set figure first,
// then the city's series for the date, then the file's one number.
export const effectiveCityPopulation = (properties, { date = "", cityPopulations = null, name = "" } = {}) => {
  const key = cityPopulationKey(name || properties?.city || properties?.name);
  if (key && cityPopulations && typeof cityPopulations === "object" && Object.prototype.hasOwnProperty.call(cityPopulations, key)) {
    const set = Number(cityPopulations[key]);
    if (Number.isFinite(set) && set >= 0) return Math.round(set);
  }
  const dated = date ? populationForDate(readPopulationByYear(properties), date) : null;
  if (dated !== null) return dated;
  const base = Number(properties?.population);
  return Number.isFinite(base) && base > 0 ? Math.round(base) : 0;
};

// A collection of cities with each series-carrying city's `population` read for
// the year. The same object back when no city carries a series, so a scenario
// without them costs one pass. Hand-set figures are the map's own expression's
// to apply (Cities.jsx), over whatever this writes.
const seriesCache = new WeakMap();
const cachedSeries = (properties) => {
  if (!properties || typeof properties !== "object") return null;
  if (!seriesCache.has(properties)) {
    const byYear = readPopulationByYear(properties);
    seriesCache.set(properties, Object.keys(byYear).length ? byYear : null);
  }
  return seriesCache.get(properties);
};
export const withPopulationsForYear = (collection, year) => {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  if (!features.length || year == null) return collection;
  let changed = false;
  const next = features.map((feature) => {
    const byYear = cachedSeries(feature?.properties);
    if (!byYear) return feature;
    const population = populationForYear(byYear, year);
    if (population === null || population === feature.properties.population) return feature;
    changed = true;
    return { ...feature, properties: { ...feature.properties, population } };
  });
  return changed ? { ...collection, features: next } : collection;
};
