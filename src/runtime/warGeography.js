/*! Open Historia — what a scenario draws on its map for war: terrain, walls, climates, ice © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. What a scenario's designer draws on its map (the
// Workshop) for its wars to be fought over, each a world key:
//
//   terrainAreas      ground harder to cross than its region says: mountains,
//                     marsh, a crevice, a river line
//                       [{ id, name, level 0-10, rings }]
//                     level 0 is flat ground, 10 can never be crossed; rings
//                     are a polygon's rings of [lng, lat], the outer first
//   fortifications    walls that must be broken through: a castle's curtain, a
//                     great wall, a line of forts
//                       [{ id, name, owner, level 3-10, points, breaches, wear, building? }]
//                     level 10 can never be broken; owner the country that
//                     built or holds it; points a line of [lng, lat]; breaches
//                     where it is broken, as [from km, to km] along it; wear
//                     how near each stretch of it is to breaking,
//                     [[stretch, 0-1]]; building { since, days } while it is
//                     being built (a War Room order)
//   climateZones      a designer's own climates: each its seasons, with their
//                     dates, weather and effects, and its dated events,
//                     blending into the next at its edges and between seasons
//                       [{ id, name, color, rings, blendKm, transitionDays, seasons, events }]
//   freezingRegions   water regions that freeze in their zone's winter: the
//                     ids of regions of a water type, [id]
//
// The engine reads them through the front run (runtime/fronts/: arena.js,
// walls.js, climate.js); the Workshop draws them; the map shows them.

import { curvedRings } from "./fronts/climate.js";
import { WEATHER_STATES } from "./fronts/weather.js";
import { kmPerDegreeAt } from "../../server/mapDistance.js";
import { currentMapMeasure } from "./mapMeasure.js";

export const TERRAIN_LEVEL_MOST = 10;
export const WALL_LEVEL_LEAST = 3;
export const WALL_LEVEL_MOST = 10;
export const CLIMATE_ZONES_MOST = 48;
export const TERRAIN_AREAS_MOST = 200;
export const FORTIFICATIONS_MOST = 200;
const POINTS_MOST = 2000;
const NAME_MOST = 80;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value, most = NAME_MOST) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most);
const round = (value, places = 1e5) => Math.round(value * places) / places;
const numberIn = (value, least, most, otherwise = null) => {
  if (value === null || value === undefined || value === "") return otherwise;
  const number = Number(value);
  return Number.isFinite(number) ? (number < least ? least : number > most ? most : number) : otherwise;
};

// A point as kept: [lng, lat] to five places, or null.
const pointOf = (value) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  return [round(lng), round(lat)];
};
const lineOf = (value, least) => {
  const points = (Array.isArray(value) ? value : []).map(pointOf).filter(Boolean).slice(0, POINTS_MOST);
  return points.length >= least ? points : null;
};
// A polygon's rings: the outer first, each of at least three points.
const ringsOf = (value) => {
  const rings = (Array.isArray(value) ? value : []).map((ring) => lineOf(ring, 3)).filter(Boolean).slice(0, 32);
  return rings.length > 0 ? rings : null;
};
const idOf = (value, fallback) => clean(value, 64) || fallback;

export const normalizeTerrainAreas = (value) => (Array.isArray(value) ? value : []).map((area, at) => {
  if (!isRecord(area)) return null;
  const rings = ringsOf(area.rings);
  if (!rings) return null;
  return { id: idOf(area.id, `terrain-${at + 1}`), name: clean(area.name), level: Math.round(numberIn(area.level, 0, TERRAIN_LEVEL_MOST, 5)), rings };
}).filter(Boolean).slice(0, TERRAIN_AREAS_MOST);

// Stretches along a line, [from km, to km], from the nearest first, those that overlap made one.
const stretchesOf = (value) => {
  const stretches = (Array.isArray(value) ? value : [])
    .map((entry) => (Array.isArray(entry) ? [Number(entry[0]), Number(entry[1])] : null))
    .filter((entry) => entry && Number.isFinite(entry[0]) && Number.isFinite(entry[1]) && entry[1] > entry[0] && entry[0] >= 0)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [from, to] of stretches) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged.slice(0, 200).map(([from, to]) => [round(from, 100), round(to, 100)]);
};

export const normalizeFortifications = (value) => (Array.isArray(value) ? value : []).map((wall, at) => {
  if (!isRecord(wall)) return null;
  const points = lineOf(wall.points, 2);
  if (!points) return null;
  const since = clean(wall.building?.since, 40);
  const days = numberIn(wall.building?.days, 0, 36500, null);
  const wear = (Array.isArray(wall.wear) ? wall.wear : [])
    .map((entry) => (Array.isArray(entry) ? [Math.floor(Number(entry[0])), numberIn(entry[1], 0, 1, null)] : null))
    .filter((entry) => entry && entry[0] >= 0 && entry[1] !== null && entry[1] > 0)
    .slice(0, 2000)
    .map(([piece, worn]) => [piece, round(worn, 1000)]);
  return {
    id: idOf(wall.id, `wall-${at + 1}`),
    name: clean(wall.name),
    owner: clean(wall.owner),
    level: Math.round(numberIn(wall.level, WALL_LEVEL_LEAST, WALL_LEVEL_MOST, 5)),
    points,
    breaches: stretchesOf(wall.breaches),
    wear,
    ...(since && days !== null ? { building: { since, days: Math.round(days) } } : {}),
  };
}).filter(Boolean).slice(0, FORTIFICATIONS_MOST);

// A day of the year as a zone's seasons keep it: "MM-DD".
const monthDayOf = (value) => {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const colorOf = (value) => (/^#[0-9a-f]{6}$/i.test(String(value ?? "").trim()) ? String(value).trim().toLowerCase() : "");
// What a season or an event does, each a multiplier or an amount, and whether the water freezes.
const EFFECT_RANGES = Object.freeze({ pace: [0, 2], attack: [0, 2], wear: [0, 0.2], cold: [0, 2], heat: [0, 2], air: [0, 1] });
const effectsOf = (value) => {
  const out = {};
  for (const [key, [least, most]] of Object.entries(EFFECT_RANGES)) {
    const number = numberIn(value?.[key], least, most, null);
    if (number !== null) out[key] = round(number, 1000);
  }
  if (value?.freezes === true) out.freezes = true;
  return out;
};
const weatherMixOf = (value) => {
  const out = {};
  for (const state of WEATHER_STATES) {
    const weight = numberIn(value?.[state], 0, 100, null);
    if (weight !== null && weight > 0) out[state] = round(weight, 1000);
  }
  return out;
};

export const normalizeClimateZones = (value) => (Array.isArray(value) ? value : []).map((zone, at) => {
  if (!isRecord(zone)) return null;
  const rings = ringsOf(zone.rings);
  if (!rings) return null;
  const seasons = (Array.isArray(zone.seasons) ? zone.seasons : []).map((season) => {
    const start = monthDayOf(season?.start);
    const end = monthDayOf(season?.end);
    if (!isRecord(season) || !start || !end) return null;
    return { name: clean(season.name, 40) || "season", start, end, ...(colorOf(season.color) ? { color: colorOf(season.color) } : {}), weather: weatherMixOf(season.weather), effects: effectsOf(season.effects) };
  }).filter(Boolean).slice(0, 12);
  const events = (Array.isArray(zone.events) ? zone.events : []).map((event) => {
    const from = clean(event?.from, 40);
    const to = clean(event?.to, 40);
    if (!isRecord(event) || !from || !to) return null;
    const weather = WEATHER_STATES.includes(event.weather) ? event.weather : "";
    return { name: clean(event.name) || "event", from, to, ...(weather ? { weather } : {}), effects: effectsOf(event.effects) };
  }).filter(Boolean).slice(0, 40);
  return {
    id: idOf(zone.id, `zone-${at + 1}`),
    name: clean(zone.name),
    color: colorOf(zone.color) || "#7f8c99",
    rings,
    blendKm: Math.round(numberIn(zone.blendKm, 0, 2000, 100)),
    transitionDays: Math.round(numberIn(zone.transitionDays, 0, 120, 14)),
    seasons,
    events,
  };
}).filter(Boolean).slice(0, CLIMATE_ZONES_MOST);

// What a turn's fighting did to a scenario's walls (runtime/fronts/walls.js
// linesChanged: [{ id, breaches, wear }]): each line's breaches and wear as
// the run leaves them; the rest as they were.
export const withFrontFortifications = (lines, changes) => {
  const byId = new Map((Array.isArray(changes) ? changes : []).filter((change) => isRecord(change) && change.id).map((change) => [String(change.id), change]));
  return normalizeFortifications(lines).map((line) => (byId.has(line.id) ? normalizeFortifications([{ ...line, breaches: byId.get(line.id).breaches, wear: byId.get(line.id).wear }])[0] : line));
};

// A climate zone's weight at a place, 0 to 1 (as the engine reads it cell by
// cell, runtime/fronts/climate.js zonesOver): a half at its edge, the whole
// `blendKm` / 2 inside, nothing as far outside. For the turn and the map, which
// may measure as they like; the engine keeps to its own arithmetic.
export const zoneWeightAt = (zone, lng, lat) => {
  // (Its outline rounded off, as the engine reads it: fronts/climate.js curvedRings.)
  const rings = curvedRings(zone);
  let inside = false;
  let nearest = Infinity;
  // (By the map's measure where it is not plain Mercator: server/mapDistance.js.)
  const measure = currentMapMeasure();
  const per = measure.plain ? null : kmPerDegreeAt(measure, lng, lat);
  const kx = per ? per.x : 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = per ? per.y : 110.57;
  for (const ring of rings) {
    for (let at = 0, back = ring.length - 1; at < ring.length; back = at, at += 1) {
      const [ax, ay] = ring[back];
      const [bx, by] = ring[at];
      if ((by > lat) !== (ay > lat) && lng < ((ax - bx) * (lat - by)) / (ay - by) + bx) inside = !inside;
      const px = (lng - ax) * kx;
      const py = (lat - ay) * ky;
      const qx = (bx - ax) * kx;
      const qy = (by - ay) * ky;
      const length = qx * qx + qy * qy;
      const along = length > 0 ? Math.max(0, Math.min(1, (px * qx + py * qy) / length)) : 0;
      const dx = px - along * qx;
      const dy = py - along * qy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < nearest) nearest = distance;
    }
  }
  const blend = Number(zone?.blendKm) || 0;
  if (!(blend > 0)) return inside ? 1 : 0;
  return Math.max(0, Math.min(1, 0.5 + (inside ? nearest : -nearest) / blend));
};

// The weather of each climate zone as the last turn left it (runtime/zoneWeather.js):
// { date, zones: [{ id, state, season }] }, or null.
export const normalizeZoneWeather = (value) => {
  if (!isRecord(value) || !clean(value.date, 40) || !Array.isArray(value.zones)) return null;
  const zones = value.zones
    .map((entry) => (isRecord(entry) && clean(entry.id, 64) && WEATHER_STATES.includes(entry.state)
      ? { id: clean(entry.id, 64), state: entry.state, season: clean(entry.season, 80) }
      : null))
    .filter(Boolean)
    .slice(0, CLIMATE_ZONES_MOST);
  return zones.length > 0 ? { date: clean(value.date, 40), zones } : null;
};

export const normalizeFreezingRegions = (value) => [...new Set((Array.isArray(value) ? value : []).map((id) => clean(id, 120)).filter(Boolean))].slice(0, 5000);
