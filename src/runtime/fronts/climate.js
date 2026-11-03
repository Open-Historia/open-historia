/*! Open Historia — battlefields and fronts: a scenario's own climate zones © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. "Scenario designers can create custom seasonal effect
// and weather maps that are a layer for the seasonal/weather engine to
// smoothly apply effects with smooth transitions in areas ... scenario
// designers should choose what happens and when in certain areas and when
// each season starts and stops in those areas, with each area having its own
// seasonal effects per season."
//
// A CLIMATE ZONE (runtime/warGeography.js climateZones) is an area a designer
// painted, with its own SEASONS (each from a day of the year to another, with
// the weather it brings and what it does: pace, attack, wear, cold, heat, air,
// and whether water freezes) and its own dated EVENTS (a long night, a
// monsoon that failed). Where none of its seasons is in, the world's own by
// latitude is (weather.js).
//
// Nothing changes at a line on the map or on a day of the calendar:
//
//   across the map   a zone's weight at a place is a half at its edge, rising to
//                    the whole `blendKm` / 2 inside it and falling to nothing as
//                    far outside: where zones meet, and where one meets the
//                    world's own climate, the one fades into the other
//   over time        a season's weight is a half on the day it begins, rising
//                    to the whole `transitionDays` / 2 later: autumn's mud
//                    eases into winter's frost; an event fades in and out the same way
//
// The engine reads a battlefield's zones once a frame (zonesOver): each zone's
// weight at each cell. Each day a zone's season mix (zoneMixOn) gives the
// weather odds at the battlefield's middle, where its weather is drawn
// (weather.js skyOver), and what the day does at each troop's own ground
// (climateAt). Water a designer marked as freezing freezes where its winter
// (or the world's) says (freezesAt).
//
// A zone has ONE weather at a time, the whole of it (zoneWeatherOn): "the
// weather patches should be drawn by scenario designers who can choose the
// climate regions" (the owner, 2026-10-14). And a zone's weather fits the
// weather of the zones beside it ("weather conditions should only border
// other weather conditions that make sense": zoneWeathersOn, WEATHER_NEIGHBOURS). A battlefield whose middle is in a
// zone (half or more of its weight there) fights in the zone's weather, and the
// map draws the zone as a patch of it (Game/Map/weatherPatches.js); elsewhere a
// battlefield's weather is its own, from the odds where it lies.
//
// Only + - * / and comparisons; dates through gameDates.js.

import { parseGameDate } from "../gameDates.js";
import { fillPolygon, projectRegion } from "./arena.js";
import { WEATHER_ODDS, WEATHER_STATES, climateOf, seasonOf, weatherDraw, weatherOn } from "./weather.js";

const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const YEAR = 365;
// A day of the year, 1 to 365 (the 29th of February is the 1st of March's day).
export const dayOfYear = (month, day) => MONTH_START[month - 1] + (day > 28 && month === 2 ? 28 : day);
const dayOfMonthDay = (text) => {
  const [month, day] = String(text).split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 ? dayOfYear(month, day > 31 ? 31 : day) : 1;
};
// Days forward from one day of the year to another, 0 to 364.
const ahead = (from, to) => ((to - from) % YEAR + YEAR) % YEAR;
const within = (value, least, most) => (value < least ? least : value > most ? most : value);

// What nothing does: the world's own, with no effect of a designer's.
export const NEUTRAL_EFFECTS = Object.freeze({ pace: 1, attack: 1, wear: 0, cold: 0, heat: 0, air: 1, freezes: 0 });
const effectsOf = (raw) => ({
  pace: Number.isFinite(raw?.pace) ? raw.pace : 1,
  attack: Number.isFinite(raw?.attack) ? raw.attack : 1,
  wear: Number.isFinite(raw?.wear) ? raw.wear : 0,
  cold: Number.isFinite(raw?.cold) ? raw.cold : 0,
  heat: Number.isFinite(raw?.heat) ? raw.heat : 0,
  air: Number.isFinite(raw?.air) ? raw.air : 1,
  freezes: raw?.freezes === true ? 1 : 0,
});
// A season's weather as odds adding to 1, or null where it gives none (the world's own then).
const oddsOf = (mix) => {
  let total = 0;
  for (const state of WEATHER_STATES) total += mix?.[state] > 0 ? mix[state] : 0;
  if (!(total > 0)) return null;
  const odds = {};
  for (const state of WEATHER_STATES) odds[state] = mix?.[state] > 0 ? mix[state] / total : 0;
  return odds;
};

// Which of a zone's seasons covers a day of the year: its place in the list, or -1 for none (the world's own).
const seasonAt = (zone, day) => {
  const seasons = zone.seasons ?? [];
  for (let at = 0; at < seasons.length; at += 1) {
    const start = dayOfMonthDay(seasons[at].start);
    const end = dayOfMonthDay(seasons[at].end);
    if (start <= end ? day >= start && day <= end : day >= start || day <= end) return at;
  }
  return -1;
};
// The first day of the stretch of the year a day lies in (the same season, or the same gap between seasons), and its last.
const stretchOf = (zone, day) => {
  const here = seasonAt(zone, day);
  let first = day;
  let last = day;
  for (let step = 1; step < YEAR && seasonAt(zone, ((day - step - 1 + YEAR) % YEAR) + 1) === here; step += 1) first = ((day - step - 1 + YEAR) % YEAR) + 1;
  for (let step = 1; step < YEAR && seasonAt(zone, ((day + step - 1) % YEAR) + 1) === here; step += 1) last = ((day + step - 1) % YEAR) + 1;
  return { here, first, last };
};

// A zone's mix on a date: what share each of its seasons (or the world's own, -1) has of it today.
// [{ season, weight }], the weights adding to 1.
export const seasonMixOn = (zone, date) => {
  const parsed = parseGameDate(date);
  if (!parsed) return [{ season: -1, weight: 1 }];
  const day = dayOfYear(parsed.month, parsed.day);
  const { here, first, last } = stretchOf(zone, day);
  const half = (Number(zone.transitionDays) || 0) / 2;
  if (!(half > 0) || ahead(first, last) >= YEAR - 1) return [{ season: here, weight: 1 }];
  const sinceStart = ahead(first, day) + 0.5;
  const toEnd = ahead(day, last) + 0.5;
  if (sinceStart < half && sinceStart <= toEnd) {
    const before = seasonAt(zone, ((first - 2 + YEAR) % YEAR) + 1);
    const weight = 0.5 + sinceStart / (2 * half);
    return before === here ? [{ season: here, weight: 1 }] : [{ season: here, weight }, { season: before, weight: 1 - weight }];
  }
  if (toEnd < half) {
    const after = seasonAt(zone, (last % YEAR) + 1);
    const weight = 0.5 + toEnd / (2 * half);
    return after === here ? [{ season: here, weight: 1 }] : [{ season: here, weight }, { season: after, weight: 1 - weight }];
  }
  return [{ season: here, weight: 1 }];
};

// How much of a zone's dated events is upon a date, 0 to 1 each, fading in and out over half its transition days.
const eventsOn = (zone, date) => {
  const out = [];
  const parsed = parseGameDate(date);
  if (!parsed) return out;
  const half = (Number(zone.transitionDays) || 0) / 2;
  for (const event of zone.events ?? []) {
    const from = parseGameDate(event.from);
    const to = parseGameDate(event.to);
    if (!from || !to) continue;
    const at = (when) => when.year * YEAR + dayOfYear(when.month, when.day);
    const now = at(parsed);
    const outside = now < at(from) ? at(from) - now : now > at(to) ? now - at(to) : 0;
    const weight = outside === 0 ? 1 : half > 0 ? within(1 - outside / (half + 1), 0, 1) : 0;
    if (weight > 0) out.push({ event, weight });
  }
  return out;
};

// What a zone brings on a date at a latitude: { odds, effects, season, color }:
// the weather odds (its seasons', or the world's own by latitude where it
// gives none), what it does (NEUTRAL_EFFECTS where it says nothing), the name
// of the season most in (and its colour, or the zone's own).
export const zoneMixOn = (zone, date, lat) => {
  const parsed = parseGameDate(date);
  const worldSeason = parsed ? seasonOf(parsed.month, lat) : "summer";
  const worldOdds = WEATHER_ODDS[climateOf(lat)][worldSeason];
  const odds = Object.fromEntries(WEATHER_STATES.map((state) => [state, 0]));
  const effects = { pace: 0, attack: 0, wear: 0, cold: 0, heat: 0, air: 0, freezes: 0 };
  let top = null;
  for (const { season, weight } of seasonMixOn(zone, date)) {
    const own = season >= 0 ? zone.seasons[season] : null;
    const seasonOdds = (own && oddsOf(own.weather)) ?? worldOdds;
    const seasonEffects = own ? effectsOf(own.effects) : NEUTRAL_EFFECTS;
    for (const state of WEATHER_STATES) odds[state] += weight * seasonOdds[state];
    for (const key of Object.keys(effects)) effects[key] += weight * seasonEffects[key];
    if (!top || weight > top.weight) top = { weight, name: own ? own.name : worldSeason, color: own?.color || zone.color };
  }
  // A dated event takes over what it says, as much as it is upon the day.
  for (const { event, weight } of eventsOn(zone, date)) {
    const said = effectsOf({ ...Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, key === "freezes" ? value >= 0.5 : value])), ...event.effects });
    for (const key of Object.keys(effects)) effects[key] = effects[key] * (1 - weight) + said[key] * weight;
    if (event.weather && WEATHER_STATES.includes(event.weather)) for (const state of WEATHER_STATES) odds[state] = odds[state] * (1 - weight) + (state === event.weather ? weight : 0);
    if (weight >= 0.5) top = { weight: 1, name: event.name, color: top?.color ?? zone.color };
  }
  return { odds, effects, season: top?.name ?? worldSeason, color: top?.color ?? zone.color };
};

// The latitude a zone is reckoned at where its own seasons say nothing and the
// world's own by latitude stand in: the middle of its outer ring, north to south.
export const zoneLatOf = (zone) => {
  let south = Infinity;
  let north = -Infinity;
  for (const point of zone?.rings?.[0] ?? []) {
    const lat = point?.[1];
    if (!(lat >= -90 && lat <= 90)) continue;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return south <= north ? (south + north) / 2 : 45;
};

// A zone's weather on a date, one for the whole of it: { state, season (the
// name of its season most in), climate }. The same seed, zone and spell of
// days is the same weather, for every battlefield in it and on the map.
export const zoneWeatherOn = ({ seed = "", zone, date = "" } = {}) => {
  const lat = zoneLatOf(zone);
  const mix = zoneMixOn(zone, date, lat);
  const sky = weatherOn({ seed, place: `zone:${zone?.id ?? ""}`, lat, date, odds: mix.odds });
  return { ...sky, season: mix.season };
};

// ---- a zone's outline ------------------------------------------------------------

// How many times a zone's corners are cut: a zone is a curving shape, not a
// polygon ("the climate zones should not be geometric, they should be curvy",
// the owner, 2026-10-14). The points the designer drew stay what is kept and
// edited; the engine, the map and the Workshop all read the outline rounded
// off, the same way.
export const ZONE_CURVE_ROUNDS = 3;
const curves = new WeakMap();

// Past this latitude nothing is on the map (the edge of its square Mercator
// world): a corner drawn there is not rounded off.
export const CURVE_KEPT_LAT = 85.0511287798066;

// A closed ring with its corners cut, round by round (Chaikin): each side
// keeps its middle half. Closed again on its first point. A corner past
// CURVE_KEPT_LAT stays sharp (a point twice over keeps its place through every
// round): "in antartica on low zoom there are triangle cutouts of the weather"
// (the owner, 2026-10-28), where Antarctica's corners at 89.5° S were cut by
// lines across the map's last degrees, and the cuts took triangles out of it.
export const curveRing = (ring, rounds = ZONE_CURVE_ROUNDS) => {
  let points = (Array.isArray(ring) ? ring : []).filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
  const last = points[points.length - 1];
  if (points.length > 1 && points[0][0] === last[0] && points[0][1] === last[1]) points = points.slice(0, -1);
  if (points.length < 3) return points;
  points = points.flatMap((point) => (Math.abs(point[1]) > CURVE_KEPT_LAT ? [point, point] : [point]));
  for (let round = 0; round < rounds; round += 1) {
    const next = [];
    for (let at = 0; at < points.length; at += 1) {
      const [ax, ay] = points[at];
      const [bx, by] = points[(at + 1) % points.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    points = next;
  }
  return [...points, [points[0][0], points[0][1]]];
};

// A zone's rings as everything reads them: rounded off. Kept for the zone it was worked out for.
export const curvedRings = (zone) => {
  const known = zone && typeof zone === "object";
  if (known && curves.has(zone)) return curves.get(zone);
  const rings = (Array.isArray(zone?.rings) ? zone.rings : []).map((ring) => curveRing(ring)).filter((ring) => ring.length >= 4);
  if (known) curves.set(zone, rings);
  return rings;
};

// ---- what weather lies beside what ---------------------------------------------------

// Which weathers may lie side by side, one zone's beside the next's: snow
// beside frost or rain and never beside heat, a blizzard only among snow and
// frost, heat only under clear skies, a storm only where it rains.
export const WEATHER_NEIGHBOURS = Object.freeze({
  clear: Object.freeze(["clear", "frost", "fog", "heat", "rain", "snow", "mud"]),
  frost: Object.freeze(["frost", "clear", "snow", "fog", "blizzard"]),
  snow: Object.freeze(["snow", "frost", "blizzard", "clear", "rain", "fog"]),
  blizzard: Object.freeze(["blizzard", "snow", "frost"]),
  fog: Object.freeze(["fog", "clear", "frost", "rain", "mud", "snow"]),
  rain: Object.freeze(["rain", "storm", "fog", "mud", "clear", "snow"]),
  storm: Object.freeze(["storm", "rain", "mud"]),
  mud: Object.freeze(["mud", "rain", "storm", "fog", "clear"]),
  heat: Object.freeze(["heat", "clear"]),
});
export const weathersFit = (a, b) => (WEATHER_NEIGHBOURS[a] ?? []).includes(b);

const PI = 3.141592653589793;
const KM_A_DEGREE = 111.2;
// The cosine of a latitude, near enough for the distances between zones (Bhaskara's rule: + - * / only).
const cosineOf = (lat) => {
  const x = (lat < 0 ? -lat : lat) * (PI / 180);
  return (PI * PI - 4 * x * x) / (PI * PI + x * x);
};
// A zone's outer ring, the box round it, and how far it blends.
const outlineOf = (zone) => {
  const points = (curvedRings(zone)[0] ?? []).filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
  if (points.length < 3) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { points, west, east, south, north, blend: Number(zone.blendKm) || 0 };
};
const insideOutline = (points, [x, y]) => {
  let odd = false;
  for (let at = 0, back = points.length - 1; at < points.length; back = at, at += 1) {
    const [ax, ay] = points[back];
    const [bx, by] = points[at];
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) odd = !odd;
  }
  return odd;
};
// How far a place is from a stretch of outline, all of it in degrees with
// longitude narrowed by `squeeze`.
const fromStretch = (px, py, ax, ay, bx, by, squeeze) => {
  const x = px * squeeze;
  const x1 = ax * squeeze;
  const x2 = bx * squeeze;
  const dx = x2 - x1;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  let share = length > 0 ? ((x - x1) * dx + (py - ay) * dy) / length : 0;
  share = share < 0 ? 0 : share > 1 ? 1 : share;
  const ex = x1 + share * dx - x;
  const ey = ay + share * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
};

// Whether two zones lie side by side: their outlines come within the reach of
// their blends of each other (half of each), or one has a corner inside the other.
export const zonesMeet = (a, b) => {
  const A = outlineOf(a);
  const B = outlineOf(b);
  if (!A || !B) return false;
  const reach = (A.blend + B.blend) / 2 / KM_A_DEGREE;
  const cosine = cosineOf((A.south + A.north + B.south + B.north) / 4);
  const squeeze = cosine > 0.05 ? cosine : 0.05;
  const reachAcross = reach / squeeze;
  if (A.east + reachAcross < B.west || B.east + reachAcross < A.west || A.north + reach < B.south || B.north + reach < A.south) return false;
  if (insideOutline(B.points, A.points[0]) || insideOutline(A.points, B.points[0])) return true;
  const near = (from, to) => {
    for (const [px, py] of from.points) {
      for (let at = 0, back = to.points.length - 1; at < to.points.length; back = at, at += 1) {
        if (fromStretch(px, py, to.points[back][0], to.points[back][1], to.points[at][0], to.points[at][1], squeeze) <= reach) return true;
      }
    }
    return false;
  };
  return near(A, B) || near(B, A);
};

// Which zones lie beside which: Map of a zone's place in the list to the places of those beside it.
export const zoneNeighbours = (zones) => {
  const list = Array.isArray(zones) ? zones : [];
  const beside = new Map(list.map((_, index) => [index, []]));
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      if (!zonesMeet(list[a], list[b])) continue;
      beside.get(a).push(b);
      beside.get(b).push(a);
    }
  }
  return beside;
};

const boxArea = (zone) => {
  const outline = outlineOf(zone);
  return outline ? (outline.east - outline.west) * (outline.north - outline.south) : 0;
};

// Every zone's weather on a date, each drawn as zoneWeatherOn draws it and then
// made to fit the zones beside it: the largest zones are settled first, and one
// whose weather does not fit a neighbour already settled takes, of the
// weathers that fit them all (or else the most of them), the one its own odds
// favour by the same draw; where its odds give none of them, the first of them.
// [{ zone, state, season, climate }], in the zones' own order.
//   neighbours   zoneNeighbours(zones), where the caller keeps it
export const zoneWeathersOn = ({ seed = "", zones = [], date = "", neighbours = null } = {}) => {
  const list = Array.isArray(zones) ? zones : [];
  const beside = neighbours ?? zoneNeighbours(list);
  const drawn = list.map((zone) => {
    const lat = zoneLatOf(zone);
    const mix = zoneMixOn(zone, date, lat);
    const place = `zone:${zone?.id ?? ""}`;
    const sky = weatherOn({ seed, place, lat, date, odds: mix.odds });
    return { zone, state: sky.state, season: mix.season, climate: sky.climate, odds: mix.odds, draw: weatherDraw(seed, place, date) };
  });
  const order = drawn.map((_, index) => index).sort((a, b) => boxArea(list[b]) - boxArea(list[a]) || a - b);
  const settled = new Set();
  for (const index of order) {
    const entry = drawn[index];
    const around = (beside.get(index) ?? []).filter((other) => settled.has(other)).map((other) => drawn[other].state);
    settled.add(index);
    if (around.every((state) => weathersFit(entry.state, state))) continue;
    const fitting = WEATHER_STATES.map((state) => around.filter((other) => weathersFit(state, other)).length);
    let most = 0;
    for (const count of fitting) if (count > most) most = count;
    const candidates = WEATHER_STATES.filter((_, at) => fitting[at] === most);
    let total = 0;
    for (const state of candidates) total += entry.odds?.[state] > 0 ? entry.odds[state] : 0;
    let chosen = candidates[0];
    if (total > 0) {
      let sum = 0;
      for (const state of candidates) {
        const share = entry.odds?.[state] > 0 ? entry.odds[state] / total : 0;
        if (!(share > 0)) continue;
        chosen = state;
        sum += share;
        if (entry.draw < sum) break;
      }
    }
    entry.state = chosen;
  }
  return drawn.map(({ zone, state, season, climate }) => ({ zone, state, season, climate }));
};

// ---- across the map --------------------------------------------------------------

// Distances on a grid by the 3-4 chamfer, in thirds of a cell, from every cell
// to the nearest cell that is `target` (1 in `mask` when target is 1, 0 when
// it is 0). Two passes, + - and comparisons only.
const chamfer = (mask, width, height, target) => {
  const far = 1e9;
  const distance = new Int32Array(width * height);
  for (let at = 0; at < distance.length; at += 1) distance[at] = mask[at] === target ? 0 : far;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      let best = distance[at];
      if (x > 0 && distance[at - 1] + 3 < best) best = distance[at - 1] + 3;
      if (y > 0) {
        if (distance[at - width] + 3 < best) best = distance[at - width] + 3;
        if (x > 0 && distance[at - width - 1] + 4 < best) best = distance[at - width - 1] + 4;
        if (x < width - 1 && distance[at - width + 1] + 4 < best) best = distance[at - width + 1] + 4;
      }
      distance[at] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const at = y * width + x;
      let best = distance[at];
      if (x < width - 1 && distance[at + 1] + 3 < best) best = distance[at + 1] + 3;
      if (y < height - 1) {
        if (distance[at + width] + 3 < best) best = distance[at + width] + 3;
        if (x < width - 1 && distance[at + width + 1] + 4 < best) best = distance[at + width + 1] + 4;
        if (x > 0 && distance[at + width - 1] + 4 < best) best = distance[at + width - 1] + 4;
      }
      distance[at] = best;
    }
  }
  return distance;
};

// The most cells a zone's edge is looked for beyond a battlefield's frame.
const PAD_MOST = 80;

// Each zone's weight at each cell of a battle's frame, 0 to 1: where zones
// meet the weights are shared out so they add to no more than 1, and what is
// left is the world's own climate. Worked out once a frame; null where no zone
// reaches it. [{ zone, weights }].
export const zonesOver = (run, battle) => {
  const zones = Array.isArray(run.input?.climateZones) ? run.input.climateZones : [];
  if (battle.zonesFor === battle.place) return battle.zones;
  battle.zonesFor = battle.place;
  battle.zones = null;
  if (zones.length === 0) return null;
  const { frame } = battle.arena;
  const { cols, rows } = battle.field;
  const { kmAt } = battle.place;
  const found = [];
  for (const zone of zones) {
    // (Its edge may lie outside the frame and still reach in: the grid is drawn round it by as far as the zone blends.)
    let least = Infinity;
    for (let row = 0; row < rows; row += 1) if (kmAt(row) < least) least = kmAt(row);
    const pad = Math.min(PAD_MOST, Math.ceil(((Number(zone.blendKm) || 0) / 2) / least) + 1);
    const width = cols + 2 * pad;
    const height = rows + 2 * pad;
    const mask = new Uint8Array(width * height);
    const shape = projectRegion(frame, { geometry: { type: "Polygon", coordinates: curvedRings(zone) } });
    if (shape.polygons.length === 0 || shape.east < -pad || shape.west > cols + pad || shape.north < -pad || shape.south > rows + pad) continue;
    let filled = 0;
    for (const rings of shape.polygons) filled += fillPolygon(rings, mask, width, height, -pad, -pad, 1, 1);
    if (filled === 0) continue;
    const inside = chamfer(mask, width, height, 0);
    const outside = chamfer(mask, width, height, 1);
    const weights = new Float32Array(cols * rows);
    let any = false;
    for (let row = 0; row < rows; row += 1) {
      const km = kmAt(row + 0.5);
      for (let col = 0; col < cols; col += 1) {
        const at = (row + pad) * width + col + pad;
        const into = mask[at] === 1 ? inside[at] / 3 : -outside[at] / 3;
        const blend = Number(zone.blendKm) || 0;
        const weight = blend > 0 ? within(0.5 + (into * km) / blend, 0, 1) : mask[at] === 1 ? 1 : 0;
        weights[row * cols + col] = weight;
        if (weight > 0) any = true;
      }
    }
    if (any) found.push({ zone, weights });
  }
  if (found.length === 0) return null;
  // Where zones overlap, their weights are shared out so they add to no more than 1.
  for (let cell = 0; cell < cols * rows; cell += 1) {
    let total = 0;
    for (const entry of found) total += entry.weights[cell];
    if (total > 1) for (const entry of found) entry.weights[cell] /= total;
  }
  battle.zones = found;
  return found;
};

// Each zone's mix on a day, worked out once a day for a battle: [{ weights, mix }].
export const zonesToday = (run, battle, date, lat) => {
  const zones = zonesOver(run, battle);
  if (!zones) return null;
  if (battle.zonesDate === date && battle.zonesLat === lat) return battle.zonesMix;
  battle.zonesDate = date;
  battle.zonesLat = lat;
  battle.zonesMix = zones.map((entry) => ({ ...entry, mix: zoneMixOn(entry.zone, date, lat) }));
  return battle.zonesMix;
};

// What the climate does at a cell today: the zones' effects by their weights there, the world's own for the rest.
export const climateAt = (today, cell) => {
  const out = { ...NEUTRAL_EFFECTS };
  if (!today || cell < 0) return out;
  let rest = 1;
  const sum = { pace: 0, attack: 0, wear: 0, cold: 0, heat: 0, air: 0, freezes: 0 };
  for (const { weights, mix } of today) {
    const weight = weights[cell];
    if (!(weight > 0)) continue;
    rest -= weight;
    for (const key of Object.keys(sum)) sum[key] += weight * mix.effects[key];
  }
  if (rest >= 1) return out;
  for (const key of Object.keys(sum)) out[key] = sum[key] + (rest > 0 ? rest * NEUTRAL_EFFECTS[key] : 0);
  return out;
};

// The weather odds at a cell today, the zones' by their weights there and the world's own for the rest; and the zone most there.
export const oddsAt = (today, cell, worldOdds) => {
  if (!today || cell < 0) return { odds: worldOdds, zone: null };
  const odds = Object.fromEntries(WEATHER_STATES.map((state) => [state, 0]));
  let rest = 1;
  let top = null;
  for (const entry of today) {
    const weight = entry.weights[cell];
    if (!(weight > 0)) continue;
    rest -= weight;
    for (const state of WEATHER_STATES) odds[state] += weight * entry.mix.odds[state];
    if (!top || weight > top.weight) top = { weight, zone: entry.zone, mix: entry.mix };
  }
  if (rest >= 1) return { odds: worldOdds, zone: null };
  if (rest > 0) for (const state of WEATHER_STATES) odds[state] += rest * worldOdds[state];
  return { odds, zone: top && top.weight >= 0.5 ? top : null };
};

// ---- ice ---------------------------------------------------------------------------

// Whether water freezes at a place on a date: by the zones there (their weight
// of a freezing season, a half or more), or where no zone reaches, by the
// world's own winter in a polar or continental climate. `zones` is the
// scenario's climate zones with a test of whether a place is inside each:
// [{ zone, inside(lng, lat) -> 0..1 }].
export const freezesAt = (zones, lng, lat, date) => {
  const parsed = parseGameDate(date);
  if (!parsed) return false;
  let weight = 0;
  let rest = 1;
  for (const { zone, inside } of zones) {
    const share = inside(lng, lat);
    if (!(share > 0)) continue;
    rest -= share;
    weight += share * zoneMixOn(zone, date, lat).effects.freezes;
  }
  if (rest > 0) {
    const climate = climateOf(lat);
    const winter = seasonOf(parsed.month, lat) === "winter";
    weight += rest * (winter && (climate === "polar" || climate === "continental") ? 1 : 0);
  }
  return weight >= 0.5;
};
