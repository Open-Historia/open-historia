/*! Open Historia — distances on a scenario's map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How far apart two places of a scenario's map are, by its projection: the one
// measure the game takes every distance with (troops and units on the move,
// transports and fleets, the land war's battlefields, reaches, the War Room's
// figures and the distances told to the AI).
//
// Every map is stored laid out on the Mercator plane (server/mapProjection.js),
// so what a place's stored longitude and latitude mean depends on the map:
//
//   MERCATOR (and a map that says nothing)  they are the true longitude and
//       latitude: a distance is the great circle between them.
//   ANOTHER WORLD PROJECTION (equirectangular, Robinson, flat earth…)  they are
//       where that projection draws the place; the true longitude and latitude
//       come back through it (displayToGeo), and the distance is the great
//       circle between those.
//   FREEFORM  there is no globe: the map is a flat sheet, and a distance is the
//       straight line across the map as it is drawn, at one scale everywhere,
//       with no shrinking toward the top and bottom and no going round the edge.
//       Across the map as it is drawn is on the Mercator plane: x is the stored
//       longitude and y the height the map draws the latitude at (latToY), both
//       in degrees.
//
// THE SCALE LINE (projection.scale, normalizeScaleLine) is a line the author
// drew in the Workshop with the distance it measures. On a freeform sheet it is
// the scale: kilometres to a degree of the sheet. Without one a degree of the
// sheet is SHEET_KM_PER_DEGREE, a degree of longitude at the equator, which is
// what a freeform map measured before it had a scale. On a world projection the
// globe already gives every distance, so the line says by how much the map's
// world is larger or smaller than the Earth: every distance is multiplied by
// the line's distance over the great circle between its ends (`factor`).
//
// A MEASURE is a small plain object (mapMeasureOf), made once a projection and
// handed to what measures. The land war's engine cannot use the trigonometry
// here (src/runtime/fronts keep to arithmetic every machine does alike), so it
// is handed engineMapOf(measure): the same measure as numbers, with a table of
// kilometres by the map's height for a world projection that is not Mercator.
//
// DELIBERATELY IMPORT-FREE but for mapProjection.js: the server, the website's
// store and the game all load it.

import { DEFAULT_PROJECTION, FREEFORM, MERCATOR_MAX_LAT, displayToGeo, geoToDisplay, normalizeProjection } from "./mapProjection.js";

const RAD = Math.PI / 180;
// The Earth's mean radius, as the land war's engine takes it (fronts/worldGrid.js).
export const EARTH_KM = 6371.0088;
// A degree of a freeform sheet with no scale line: a degree of longitude at the equator.
export const SHEET_KM_PER_DEGREE = 111.32;
// The widest a scale line may make a world, as a share of the Earth's.
const FACTOR_LEAST = 1e-4;
const FACTOR_MOST = 1e4;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value) => Number.isFinite(Number(value));

// The height the map draws a latitude at, in degrees, and back (Web Mercator).
export const latToY = (lat) => {
  const clamped = clamp(Number(lat) || 0, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);
  return Math.log(Math.tan(Math.PI / 4 + (clamped * RAD) / 2)) / RAD;
};
export const yToLat = (y) => (2 * Math.atan(Math.exp((Number(y) || 0) * RAD)) - Math.PI / 2) / RAD;

// The great circle between two true places, in kilometres of the Earth.
export const greatCircleKm = (lngA, latA, lngB, latB) => {
  const a = latA * RAD;
  const b = latB * RAD;
  const down = Math.sin((b - a) / 2);
  const across = Math.sin(((lngB - lngA) * RAD) / 2);
  const h = Math.min(1, Math.max(0, down * down + Math.cos(a) * Math.cos(b) * across * across));
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
};

// Degrees of the plane between two stored places on a flat sheet.
const sheetDegrees = (lngA, latA, lngB, latB) => Math.hypot(lngB - lngA, latToY(latB) - latToY(latA));

// ---------------------------------------------------------------------------
// The measure
// ---------------------------------------------------------------------------

// A stored place's true longitude and latitude (a world projection).
const trueOf = (spec, lng, lat) => (spec.type === DEFAULT_PROJECTION ? [Number(lng) || 0, Number(lat) || 0] : displayToGeo(spec, lng, lat));
// And a true place as stored.
const storedOf = (spec, lng, lat) => (spec.type === DEFAULT_PROJECTION ? [lng, lat] : geoToDisplay(spec, lng, lat));

const made = new Map();
const MADE_MOST = 64;

// The measure of a map in `projection` (world.projection, or anything
// normalizeProjection reads). Plain and small; the same object for the same projection.
//   type      the projection
//   flat      a freeform sheet
//   scale     kilometres to a degree of the sheet (flat only)
//   factor    every great circle times this (world projections; 1 without a scale line)
//   plain     Mercator at the Earth's own size: every distance as the game always took it
export const mapMeasureOf = (projection) => {
  const spec = normalizeProjection(projection);
  const key = JSON.stringify([spec.type, spec.aspect ?? null, spec.scale ?? null]);
  const known = made.get(key);
  if (known) return known;
  let measure;
  if (spec.type === FREEFORM) {
    const line = spec.scale;
    const degrees = line ? sheetDegrees(line.from[0], line.from[1], line.to[0], line.to[1]) : 0;
    const scale = line && degrees > 1e-9 ? line.km / degrees : SHEET_KM_PER_DEGREE;
    measure = Object.freeze({ type: FREEFORM, aspect: spec.aspect, flat: true, scale, factor: 1, plain: false, key });
  } else {
    const line = spec.scale;
    let factor = 1;
    if (line) {
      const from = trueOf(spec, line.from[0], line.from[1]);
      const to = trueOf(spec, line.to[0], line.to[1]);
      const earth = greatCircleKm(from[0], from[1], to[0], to[1]);
      if (earth > 1e-6) factor = clamp(line.km / earth, FACTOR_LEAST, FACTOR_MOST);
    }
    measure = Object.freeze({ type: spec.type, flat: false, scale: SHEET_KM_PER_DEGREE, factor, plain: spec.type === DEFAULT_PROJECTION && factor === 1, key });
  }
  if (made.size >= MADE_MOST) made.clear();
  made.set(key, measure);
  return measure;
};

// The measure of a world's map.
export const worldMeasureOf = (world) => mapMeasureOf(world?.projection);

// Mercator at the Earth's size: what a measure is when a map says nothing.
export const PLAIN_MEASURE = mapMeasureOf(null);

const measureOrPlain = (measure) => (measure && typeof measure === "object" && typeof measure.type === "string" ? measure : PLAIN_MEASURE);

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

// Kilometres between two stored places.
export const mapKm = (measure, lngA, latA, lngB, latB) => {
  const m = measureOrPlain(measure);
  if (![lngA, latA, lngB, latB].every(finite)) return 0;
  if (m.flat) return sheetDegrees(Number(lngA), Number(latA), Number(lngB), Number(latB)) * m.scale;
  const a = trueOf(m, lngA, latA);
  const b = trueOf(m, lngB, latB);
  return greatCircleKm(a[0], a[1], b[0], b[1]) * m.factor;
};

// The point a share of the way from one stored place to another, as stored: in
// a straight line across a flat sheet, along the great circle on a globe.
const along = (m, a, b, share) => {
  if (m.flat) {
    const y = latToY(a[1]) + (latToY(b[1]) - latToY(a[1])) * share;
    return [a[0] + (b[0] - a[0]) * share, yToLat(y)];
  }
  const [lngA, latA] = trueOf(m, a[0], a[1]);
  const [lngB, latB] = trueOf(m, b[0], b[1]);
  const unit = (lat, lng) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
  const p = unit(latA, lngA);
  const q = unit(latB, lngB);
  const dot = clamp(p[0] * q[0] + p[1] * q[1] + p[2] * q[2], -1, 1);
  const omega = Math.acos(dot);
  const s = Math.sin(omega);
  const wa = s < 1e-12 ? 1 - share : Math.sin((1 - share) * omega) / s;
  const wb = s < 1e-12 ? share : Math.sin(share * omega) / s;
  const x = p[0] * wa + q[0] * wb;
  const y = p[1] * wa + q[1] * wb;
  const z = p[2] * wa + q[2] * wb;
  return storedOf(m, Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD);
};

// A step of at most `km` from one stored place toward another:
// { lng, lat, arrived, remainingKm }, as unitMotion.js stepToward answers.
export const mapStep = (measure, from, to, km) => {
  const m = measureOrPlain(measure);
  const a = [Number(from?.lng) || 0, Number(from?.lat) || 0];
  const b = [Number(to?.lng) || 0, Number(to?.lat) || 0];
  const distance = mapKm(m, a[0], a[1], b[0], b[1]);
  const budget = Math.max(0, Number(km) || 0);
  if (!(distance > 0) || budget >= distance) return { lng: b[0], lat: b[1], arrived: true, remainingKm: 0 };
  if (budget <= 0) return { lng: a[0], lat: a[1], arrived: false, remainingKm: distance };
  const [lng, lat] = along(m, a, b, budget / distance);
  return { lng, lat, arrived: false, remainingKm: distance - budget };
};

// The stored place `km` from a stored place on a bearing (degrees clockwise
// from north): straight across a flat sheet (north is up the sheet), along the
// great circle on a globe.
export const mapOffset = (measure, lng, lat, bearingDeg, km) => {
  const m = measureOrPlain(measure);
  const distance = Math.max(0, Number(km) || 0);
  const bearing = (Number(bearingDeg) || 0) * RAD;
  if (m.flat) {
    const degrees = distance / m.scale;
    const y = latToY(lat) + Math.cos(bearing) * degrees;
    return [(Number(lng) || 0) + Math.sin(bearing) * degrees, yToLat(y)];
  }
  const [lng0, lat0] = trueOf(m, lng, lat);
  const angle = distance / m.factor / EARTH_KM;
  const phi = lat0 * RAD;
  const lat1 = Math.asin(clamp(Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(bearing), -1, 1));
  const lng1 = lng0 * RAD + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(phi), Math.cos(angle) - Math.sin(phi) * Math.sin(lat1));
  const wrapped = ((((lng1 / RAD) + 180) % 360) + 360) % 360 - 180;
  return storedOf(m, wrapped, lat1 / RAD);
};

// A closed ring `km` round a stored place, as stored [lng, lat] points (`points`
// of them and the first again): what is drawn round a patrol's station or a
// blockade. Its longitudes stay on the same turn of the world as the place.
export const mapRing = (measure, lng, lat, km, points = 64) => {
  const m = measureOrPlain(measure);
  const count = Math.max(3, Math.round(Number(points) || 64));
  const centre = Number(lng) || 0;
  const ring = [];
  for (let index = 0; index < count; index += 1) {
    const [x, y] = mapOffset(m, lng, lat, (index / count) * 360, km);
    ring.push([m.flat ? x : x + 360 * Math.round((centre - x) / 360), y]);
  }
  ring.push(ring[0]);
  return ring;
};

// Kilometres to a stored degree east and north at a stored place: what turns a
// distance into degrees where something is drawn or placed round a point.
export const kmPerDegreeAt = (measure, lng, lat) => {
  const m = measureOrPlain(measure);
  const x = Number(lng) || 0;
  const y = clamp(Number(lat) || 0, -MERCATOR_MAX_LAT + 0.02, MERCATOR_MAX_LAT - 0.02);
  const h = 0.01;
  return {
    x: Math.max(1e-6, mapKm(m, x - h, y, x + h, y) / (2 * h)),
    y: Math.max(1e-6, mapKm(m, x, y - h, x, y + h) / (2 * h)),
  };
};

// ---------------------------------------------------------------------------
// For the land war's engine
// ---------------------------------------------------------------------------

// The table a world projection that is not Mercator measures by in the engine:
// by the map's height y (Mercator degrees, from -180 every METRIC_STEP),
//   kx  kilometres to a degree of longitude at that height (on the middle meridian)
//   m   kilometres along the middle meridian from the bottom of the plane up to it
// both times the measure's factor, rounded so the engine's sums are the same
// on every machine.
export const METRIC_STEP = 0.5;
const METRIC_FROM = -180;
const METRIC_ROWS = Math.round(360 / METRIC_STEP) + 1;
const tables = new Map();
const round6 = (value) => Math.round(value * 1e6) / 1e6;
export const metricTableOf = (measure) => {
  const m = measureOrPlain(measure);
  if (m.flat || m.type === DEFAULT_PROJECTION) return null;
  return metricTableFor(m.type, m.factor);
};

// The same by a projection's name and a factor: what a battlefield's frame
// keeps (fronts/frame.js) to measure its rows again when it is read back.
export const metricTableFor = (type, factor = 1) => {
  const spec = normalizeProjection(type);
  if (spec.type === FREEFORM || spec.type === DEFAULT_PROJECTION) return null;
  const times = Number(factor) > 0 ? Number(factor) : 1;
  const key = `${spec.type}|${times}`;
  const known = tables.get(key);
  if (known) return known;
  const m = { type: spec.type, factor: times };
  const kx = new Array(METRIC_ROWS);
  const meridian = new Array(METRIC_ROWS);
  let total = 0;
  let previous = null;
  for (let row = 0; row < METRIC_ROWS; row += 1) {
    const lat = yToLat(METRIC_FROM + row * METRIC_STEP);
    const here = trueOf(m, 0, lat);
    const east = trueOf(m, 1, lat);
    kx[row] = round6(greatCircleKm(here[0], here[1], east[0], east[1]) * m.factor);
    if (previous) total += greatCircleKm(previous[0], previous[1], here[0], here[1]) * m.factor;
    meridian[row] = round6(total);
    previous = here;
  }
  const table = Object.freeze({ type: spec.type, step: METRIC_STEP, from: METRIC_FROM, kx, m: meridian });
  if (tables.size >= MADE_MOST) tables.clear();
  tables.set(key, table);
  return table;
};

// What the land war's engine is told of the map's measure (frontApply.js puts
// it on its input's `map`): nothing for plain Mercator, so every battle there is
// worked out exactly as before;
//   flat, scale   a freeform sheet
//   factor        a world projection's scale line
//   metric        a world projection that is not Mercator (metricTableOf)
export const engineMapOf = (measure) => {
  const m = measureOrPlain(measure);
  if (m.plain) return {};
  if (m.flat) return { flat: true, scale: round6(m.scale) };
  return {
    ...(m.factor !== 1 ? { factor: round6(m.factor) } : {}),
    ...(m.type !== DEFAULT_PROJECTION ? { metric: metricTableOf(m) } : {}),
  };
};
