/*! Open Historia — battlefields and fronts: the frame a battlefield is laid on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield's frame is a grid of square cells laid over it on the MAP'S OWN
// PLANE: longitude across, and up the page the height the map draws a latitude
// at (the Mercator height, in the same degrees). That is the plane every map of
// the game is stored on, a hand-drawn flat sheet as much as the real world, so
// one frame serves both and a cell is square on screen at every latitude.
//
//   frame { lng0, lat0, cell, cols, rows, km, flat?, scale?, proj?, factor? }
//
//   lng0, lat0   the south-west corner, as stored coordinates. lng0 is NOT
//                wrapped: a battlefield across the date line runs past 180.
//                But the frame's MIDDLE is always within the map's own turn
//                of the world, -180 up to 180 (homeLng0): a frame made from
//                a box told a whole turn off (a country with land across
//                the date line gives one: North America as 215 to 300
//                east) is that same frame, told in the longitudes the map
//                and everything drawn on it use. One told a turn off was
//                a picture the map would not place and troops the war
//                room's tools looked for a world away.
//   cell         a cell's side in degrees of longitude.
//   cols, rows   columns eastward, rows northward; at most 255 each.
//   km           what a cell's side was meant to measure, at the middle row.
//   flat, scale  a flat sheet: every degree is `scale` kilometres everywhere.
//   proj         a world projection that is not Mercator (server/mapDistance.js
//                metricTableFor): a row's kilometres are read from it.
//   factor       the map's scale line on a world projection: every distance times it.
//
// On the real world a degree of the plane is fewer kilometres the nearer the
// pole, by the cosine of the latitude, in every direction alike. So distance is
// reckoned a row at a time: rowKm[row] is one cell's side in kilometres there.
// A position inside the frame is in CELL units: x columns from lng0, y rows from
// lat0, a cell's centre at (column + 0.5, row + 0.5).
//
// The logarithms and tangents here run when a frame is made and when a point is
// converted, never inside the engine's daily loop.

import { CELL_STEPS_KM, MAX_CELLS, MAX_GRID_SPAN } from "./constants.js";
import { metricTableFor } from "../../../server/mapDistance.js";

export const KM_PER_DEGREE = 111.32;
const RAD = Math.PI / 180;
const MERCATOR_MAX_LAT = 85.0511287798066;

// The height the map draws a latitude at, in degrees of longitude, and back.
export const latToY = (lat) => {
  const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, Number(lat) || 0));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * RAD) / 2)) / RAD;
};
export const yToLat = (y) => (2 * Math.atan(Math.exp((Number(y) || 0) * RAD)) - Math.PI / 2) / RAD;

// A longitude as the copy of it nearest `around`: 179 seen from -179 is -181.
export const unwrapLng = (lng, around = 0) => {
  const value = Number(lng) || 0;
  return value - Math.round((value - around) / 360) * 360;
};

const round6 = (value) => Math.round(value * 1e6) / 1e6;

// A frame's west edge with its middle brought within the map's own turn of the
// world: the same edge where it is there already.
export const homeLng0 = (lng0, width) => {
  const middle = lng0 + width / 2;
  const turn = Math.floor((middle + 180) / 360);
  return turn === 0 ? lng0 : lng0 - turn * 360;
};

// Kilometres a degree of the plane measures at a height y (Mercator degrees),
// on a map that is not plain Mercator: across, and up. A table of a world
// projection (server/mapDistance.js metricTableOf) is read between its rows.
const readTable = (column, metric, y) => {
  const at = (y - metric.from) / metric.step;
  const last = column.length - 1;
  if (!(at > 0)) return column[0];
  if (at >= last) return column[last];
  const row = Math.floor(at);
  return column[row] + (column[row + 1] - column[row]) * (at - row);
};
// The side of a square a degree of the plane is worth there: the mean of across
// and up, for a projection that does not keep shapes.
const tableKmPerDegree = (metric, y) => {
  const across = readTable(metric.kx, metric, y);
  const up = (readTable(metric.m, metric, y + metric.step / 2) - readTable(metric.m, metric, y - metric.step / 2)) / metric.step;
  return Math.sqrt(Math.max(1e-9, across * up));
};

// The frame round a box of stored coordinates { west, south, east, north }.
// `east` less than `west` is a box across the date line. The cell is the finest
// of CELL_STEPS_KM the limits allow, coarser still for a box no step fits.
//   flat      a flat sheet (the map declares a projection that is not the world's)
//   scale     kilometres to a degree on a flat sheet
//   factor    the map's scale line on a world projection (server/mapDistance.js)
//   metric    a world projection that is not Mercator: its table (metricTableOf)
//   marginKm  room to leave round the box
export const createFrame = (bounds, { flat = false, scale = KM_PER_DEGREE, factor = 1, metric = null, marginKm = 0 } = {}) => {
  const west = Number(bounds?.west);
  let east = Number(bounds?.east);
  const south = Number(bounds?.south);
  const north = Number(bounds?.north);
  if (![west, east, south, north].every(Number.isFinite) || north <= south || east === west) return null;
  if (east < west) east += 360;

  const bottom = latToY(south);
  const top = latToY(north);
  const times = !flat && Number(factor) > 0 ? Number(factor) : 1;
  const table = !flat && metric && Array.isArray(metric.kx) ? metric : null;
  const kmPerDegree = flat
    ? (Number(scale) > 0 ? Number(scale) : KM_PER_DEGREE)
    : table
      ? tableKmPerDegree(table, (bottom + top) / 2)
      : KM_PER_DEGREE * Math.cos(yToLat((bottom + top) / 2) * RAD) * times;
  const margin = Math.max(0, Number(marginKm) || 0) / kmPerDegree;
  const outer = round6(west - margin);
  const lat0 = round6(yToLat(Math.max(latToY(-MERCATOR_MAX_LAT), bottom - margin)));
  const y0 = latToY(lat0);
  const width = east + margin - outer;
  const lng0 = round6(homeLng0(outer, width));
  const height = Math.min(latToY(MERCATOR_MAX_LAT), top + margin) - y0;

  const fits = (km) => {
    const cell = km / kmPerDegree;
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    return cols <= MAX_GRID_SPAN && rows <= MAX_GRID_SPAN && cols * rows <= MAX_CELLS;
  };
  let km = CELL_STEPS_KM.find(fits) ?? 0;
  if (!km) {
    const needed = Math.max(width / MAX_GRID_SPAN, height / MAX_GRID_SPAN, Math.sqrt((width * height) / MAX_CELLS)) * kmPerDegree;
    km = Math.ceil(needed / 8) * 8;
    while (!fits(km)) km += 8;
  }
  const cell = km / kmPerDegree;
  const frame = {
    lng0,
    lat0,
    cell,
    cols: Math.max(2, Math.ceil(width / cell)),
    rows: Math.max(2, Math.ceil(height / cell)),
    km,
  };
  if (flat) {
    frame.flat = true;
    frame.scale = kmPerDegree;
  } else {
    if (table && table.type) frame.proj = table.type;
    if (times !== 1) frame.factor = times;
  }
  return frame;
};

// A saved frame, checked. null for one that could not be a frame.
export const normalizeFrame = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lng0 = Number(value.lng0);
  const lat0 = Number(value.lat0);
  const cell = Number(value.cell);
  const cols = Number(value.cols);
  const rows = Number(value.rows);
  const km = Number(value.km);
  if (![lng0, lat0, cell, km].every(Number.isFinite) || !(cell > 0) || !(km > 0)) return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return null;
  if (cols > MAX_GRID_SPAN || rows > MAX_GRID_SPAN || cols * rows > MAX_CELLS) return null;
  if (lat0 < -MERCATOR_MAX_LAT || lat0 > MERCATOR_MAX_LAT || lng0 < -540 || lng0 > 540) return null;
  // (A frame saved a whole turn off, before frames were made at home, is brought home as it is read.)
  const frame = { lng0: homeLng0(lng0, cols * cell), lat0, cell, cols, rows, km };
  if (value.flat === true) {
    const scale = Number(value.scale);
    frame.flat = true;
    frame.scale = scale > 0 && Number.isFinite(scale) ? scale : KM_PER_DEGREE;
  } else {
    if (typeof value.proj === "string" && metricTableFor(value.proj)) frame.proj = value.proj;
    const factor = Number(value.factor);
    if (factor > 0 && Number.isFinite(factor) && factor !== 1) frame.factor = factor;
  }
  return frame;
};

// What turns stored coordinates into cell units and back for one frame, with
// the kilometres a cell measures on each row. Made once per frame object.
const projectors = new WeakMap();
export const projectorOf = (frame) => {
  const made = projectors.get(frame);
  if (made) return made;
  const { lng0, cell, cols, rows } = frame;
  const y0 = latToY(frame.lat0);
  const middle = lng0 + (cols * cell) / 2;
  const rowKm = new Float64Array(rows);
  const times = !frame.flat && Number(frame.factor) > 0 ? Number(frame.factor) : 1;
  const table = !frame.flat && frame.proj ? metricTableFor(frame.proj, times) : null;
  for (let row = 0; row < rows; row += 1) {
    const y = y0 + (row + 0.5) * cell;
    rowKm[row] = frame.flat
      ? cell * (frame.scale || KM_PER_DEGREE)
      : table
        ? cell * tableKmPerDegree(table, y)
        : cell * KM_PER_DEGREE * Math.cos(yToLat(y) * RAD) * times;
  }
  const projector = {
    rowKm,
    // Cell units of a stored point; outside the frame it is simply out of range.
    toCell: (lng, lat) => [(unwrapLng(lng, middle) - lng0) / cell, (latToY(lat) - y0) / cell],
    // The stored point of a place in cell units. Its longitude is not wrapped.
    toLngLat: (x, y) => [lng0 + x * cell, yToLat(y0 + y * cell)],
    // One cell's side in kilometres at height y.
    kmAt: (y) => rowKm[y < 0 ? 0 : y >= rows ? rows - 1 : Math.floor(y)],
  };
  projectors.set(frame, projector);
  return projector;
};

// The box a frame covers, as stored coordinates (east may pass 180).
export const frameBounds = (frame) => {
  const { toLngLat } = projectorOf(frame);
  const [west, south] = toLngLat(0, 0);
  const [east, north] = toLngLat(frame.cols, frame.rows);
  return { west, south, east, north };
};

export const pointInFrame = (frame, lng, lat) => {
  const [x, y] = projectorOf(frame).toCell(lng, lat);
  return x >= 0 && y >= 0 && x < frame.cols && y < frame.rows;
};

export const cellIndexAt = (frame, x, y) => {
  if (!(x >= 0) || !(y >= 0) || x >= frame.cols || y >= frame.rows) return -1;
  return Math.floor(y) * frame.cols + Math.floor(x);
};
