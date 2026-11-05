/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// What a scenario draws on its map for war (runtime/warGeography.js), as the
// Workshop's document keeps it: the same four lists a world keeps, in the
// world's own form, so a save writes them as they are and opening the
// scenario's map reads back what the save wrote.
//
//   terrainAreas     drawn with the Terrain tool
//   fortifications   drawn with the Fortified line tool
//   climateZones     drawn with the Climate zone tool
//   freezingRegions  water regions marked "Can freeze" in the region inspector
//
// The shapes are drawn on the map (OlMap.jsx, warGeographyLayers.js) and the
// rest is edited in the War map panel (WarMapPanel.jsx). Pure; tested in
// warGeographyDoc.test.js.

import { normalizeClimateZones, normalizeFortifications, normalizeFreezingRegions, normalizeTerrainAreas } from "../runtime/warGeography.js";
import { WEATHER_ODDS } from "../runtime/fronts/weather.js";
import { waterTypeIds } from "../runtime/regionTypes.js";

// The three tools, each named for the kind of shape it draws, and the
// document list that kind lives in.
export const WAR_TOOLS = Object.freeze(["terrain", "fortification", "climate"]);
export const isWarTool = (tool) => WAR_TOOLS.includes(tool);
export const WAR_LISTS = Object.freeze({ terrain: "terrainAreas", fortification: "fortifications", climate: "climateZones" });
export const WAR_KEYS = Object.freeze(["terrainAreas", "fortifications", "climateZones", "freezingRegions"]);

// The four lists of a stored document, of a scenario's world, or of the map a
// scenario hands the Workshop when it opens, cleaned the way the game cleans
// them. Anything else in `source` is ignored.
export const warGeographyOf = (source) => ({
  terrainAreas: normalizeTerrainAreas(source?.terrainAreas),
  fortifications: normalizeFortifications(source?.fortifications),
  climateZones: normalizeClimateZones(source?.climateZones),
  freezingRegions: normalizeFreezingRegions(source?.freezingRegions),
});

// What a save writes into the scenario's world (exportPreset.js buildGameSeed).
// A region is marked as able to freeze for as long as the document lasts, but
// only one that is on the map and of a water type is written: a lake whose type
// was changed to land, or a region since deleted, is not water that freezes.
export const warGeographyForGame = (doc, regionsFC) => {
  const lists = warGeographyOf(doc);
  const water = waterTypeIds(doc?.types);
  const waterRegions = new Set();
  for (const feature of regionsFC?.features || []) {
    const props = feature?.properties || {};
    const id = props.id != null ? String(props.id) : feature?.id != null ? String(feature.id) : "";
    if (id && water.has(String(props.typeId || "land"))) waterRegions.add(id);
  }
  return { ...lists, freezingRegions: lists.freezingRegions.filter((id) => waterRegions.has(id)) };
};

// The keys a Workshop save hands the scenario's world (libraryBar.jsx
// writeMapToScenario): each list the save carries replaces the world's, since
// the Workshop opened with the world's own.
export const warGeographyWorldPatch = (world) => Object.fromEntries(
  WAR_KEYS.filter((key) => Array.isArray(world?.[key])).map((key) => [key, world[key]]),
);

// ---------------------------------------------------------------------------
// New shapes, as the tools make them. Each is named and numbered after the
// ones already there; the designer renames it in the panel.

const numberAfter = (list) => (Array.isArray(list) ? list.length : 0) + 1;

export const TERRAIN_LEVEL_FIRST = 5;
export const WALL_LEVEL_FIRST = 5;

export const newTerrainArea = (id, rings, list) => ({
  id,
  name: `Terrain ${numberAfter(list)}`,
  level: TERRAIN_LEVEL_FIRST,
  rings,
});

export const newFortification = (id, points, owner, list) => ({
  id,
  name: `Fortified line ${numberAfter(list)}`,
  owner: String(owner || ""),
  level: WALL_LEVEL_FIRST,
  points,
  breaches: [],
  wear: [],
});

// Zone colours far enough apart to tell neighbours by, none of them purple.
export const CLIMATE_COLORS = Object.freeze(["#4f8fd6", "#d6a03f", "#4fae6a", "#d6604a", "#5fb8b8", "#b8b45a", "#8aa0b8", "#b5835a"]);

// The game's own four climates (runtime/fronts/weather.js), which a zone can
// take its seasons from.
export const CLIMATE_PRESETS = Object.freeze(["polar", "continental", "arid", "tropical"]);
const SEASON_DATES = Object.freeze([
  { key: "winter", name: "Winter", start: "12-01", end: "02-28" },
  { key: "spring", name: "Spring", start: "03-01", end: "05-31" },
  { key: "summer", name: "Summer", start: "06-01", end: "08-31" },
  { key: "autumn", name: "Autumn", start: "09-01", end: "11-30" },
]);

// A climate's four seasons, by the northern months, each with that climate's
// odds of every weather as whole weights. In the two climates that have snow,
// winter freezes the water that can freeze.
export const seasonsOfClimate = (climate) => {
  const known = WEATHER_ODDS[climate] ? climate : "continental";
  const odds = WEATHER_ODDS[known];
  return SEASON_DATES.map(({ key, name, start, end }) => {
    const weather = {};
    for (const [state, chance] of Object.entries(odds[key] || {})) {
      if (chance > 0) weather[state] = Math.round(chance * 100);
    }
    const freezes = key === "winter" && (known === "polar" || known === "continental");
    return { name, start, end, weather, effects: freezes ? { freezes: true } : {} };
  });
};

export const newClimateZone = (id, rings, list) => {
  const number = numberAfter(list);
  return {
    id,
    name: `Climate zone ${number}`,
    color: CLIMATE_COLORS[(number - 1) % CLIMATE_COLORS.length],
    rings,
    blendKm: 100,
    transitionDays: 14,
    seasons: seasonsOfClimate("continental"),
    events: [],
  };
};

export const newSeason = () => ({ name: "Season", start: "01-01", end: "03-31", weather: { clear: 100 }, effects: {} });
export const newClimateEvent = () => ({ name: "Event", from: "", to: "", effects: {} });

// ---------------------------------------------------------------------------
// Days of the year as a season keeps them: "MM-DD". February stops at the
// 28th, so a season's day is the same day in every year.

export const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

export const monthDayParts = (value) => {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(value ?? "").trim());
  const month = match ? Math.min(12, Math.max(1, Number(match[1]))) : 1;
  const day = match ? Math.min(DAYS_IN_MONTH[month - 1], Math.max(1, Number(match[2]))) : 1;
  return { month, day };
};

export const monthDayOf = (month, day) => {
  const m = Math.min(12, Math.max(1, Math.round(Number(month) || 1)));
  const d = Math.min(DAYS_IN_MONTH[m - 1], Math.max(1, Math.round(Number(day) || 1)));
  return `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

// The value most of `values` have (in a tie, the one that got there first), or
// null for none: the country whose regions a fortified line mostly crosses is
// its first owner.
export const mostCommon = (values) => {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  for (const value of Array.isArray(values) ? values : []) {
    if (value === null || value === undefined || value === "") continue;
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};
