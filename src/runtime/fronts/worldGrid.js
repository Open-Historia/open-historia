/*! Open Historia — battlefields and fronts: the whole map as a sheet of land and sea © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield's ground is drawn fine, inside its own frame (arena.js). What
// crosses the world to reach one (a transporter: transports.js) needs the whole
// map, coarsely: where there is land, where there is sea, and whose region
// lies where. This is that sheet: cells a quarter of a degree a side on the
// world's own map (finer on a smaller one), each saying how much of it is land
// and which region it lies in.
//
// A cell is sampled at four points. One that is partly land and partly sea is
// BOTH: a ship may pass it (so a strait a few kilometres wide is open, though
// no sample fell in its water) and troops may come ashore in it.
//
// Drawn once from the map's shapes and kept with the arenas while the same map
// is played. Pure.

import { KM_PER_DEGREE, unwrapLng } from "./frame.js";

// A cell's side in degrees on a map as wide as the world, and the most cells a sheet has.
export const WORLD_STEP_DEG = 0.25;
export const WORLD_CELLS_AIM = 700000;
const STEP_LEAST_DEG = 0.01;
// The samples a side of a cell.
const SUB = 2;
// The latitudes a world-wide sheet runs between: past them nothing sails or lands.
const SOUTH_MOST = -78;
const NORTH_MOST = 86;
const PI = 3.141592653589793;
const HALF_PI = PI / 2;
const RAD = PI / 180;
const EARTH_KM = 6371.0088;

// ---- the globe's arithmetic -------------------------------------------------------------
// The engine's files use only what every machine works out alike: +, -, *, /
// and the square root (engine.test.js). A sine or an arctangent from the
// machine's own library may differ in its last digit from one browser to the
// next, and a way found over a hundred thousand cells would then differ with
// it. So they are worked out here, by their series, to the last digit a number
// holds: the same sum of the same terms in the same order, everywhere.

// Sine and cosine of an angle no larger than an eighth of a turn: the terms of each series, summed from the smallest.
const SINE_TERMS = [1, -1 / 6, 1 / 120, -1 / 5040, 1 / 362880, -1 / 39916800, 1 / 6227020800, -1 / 1307674368000, 1 / 355687428096000];
const COSINE_TERMS = [1, -1 / 2, 1 / 24, -1 / 720, 1 / 40320, -1 / 3628800, 1 / 479001600, -1 / 87178291200, 1 / 20922789888000];
const seriesOf = (terms, square) => {
  let sum = 0;
  for (let at = terms.length - 1; at >= 0; at -= 1) sum = terms[at] + square * sum;
  return sum;
};
const sineOfSmall = (x) => x * seriesOf(SINE_TERMS, x * x);
const cosineOfSmall = (x) => seriesOf(COSINE_TERMS, x * x);
// Sine and cosine of an angle in radians (a few turns at most: what a map has).
export const sine = (angle) => {
  const quarter = Math.round(angle / HALF_PI);
  const rest = angle - quarter * HALF_PI;
  const turn = ((quarter % 4) + 4) % 4;
  return turn === 0 ? sineOfSmall(rest) : turn === 1 ? cosineOfSmall(rest) : turn === 2 ? -sineOfSmall(rest) : -cosineOfSmall(rest);
};
export const cosine = (angle) => sine(angle + HALF_PI);
// The angle whose tangent is y / x, in radians, in the right quarter.
const arcTanOfSmall = (x) => {
  // Halved twice (the angle whose tangent is t is twice that whose tangent is t / (1 + sqrt(1 + t t))), then its series.
  let t = x;
  t /= 1 + Math.sqrt(1 + t * t);
  t /= 1 + Math.sqrt(1 + t * t);
  const s = t * t;
  let sum = 0;
  for (let odd = 27; odd >= 1; odd -= 2) sum = 1 / odd - s * sum;
  return 4 * t * sum;
};
export const arcTan2 = (y, x) => {
  if (x === 0 && y === 0) return 0;
  const ay = y < 0 ? -y : y;
  const ax = x < 0 ? -x : x;
  // The angle from the nearer axis, which is at most an eighth of a turn.
  const angle = ax >= ay ? arcTanOfSmall(ay / ax) : HALF_PI - arcTanOfSmall(ax / ay);
  const turned = x < 0 ? PI - angle : angle;
  return y < 0 ? -turned : turned;
};

// The height the map draws a latitude at, in degrees (Web Mercator: the angle
// whose hyperbolic tangent is the latitude's sine), in the engine's arithmetic:
// that angle halved until small (atanh s = 2 atanh(s / (1 + √(1 − s²)))), then
// its series. A flat sheet is measured on this height (server/mapDistance.js).
const MERCATOR_MOST_LAT = 85.0511287798066;
export const planeY = (lat) => {
  const value = Number(lat) || 0;
  const clamped = value > MERCATOR_MOST_LAT ? MERCATOR_MOST_LAT : value < -MERCATOR_MOST_LAT ? -MERCATOR_MOST_LAT : value;
  let s = sine(clamped * RAD);
  let doublings = 1;
  for (let halving = 0; halving < 8 && (s > 0.05 || s < -0.05); halving += 1) {
    s /= 1 + Math.sqrt(1 - s * s);
    doublings *= 2;
  }
  const square = s * s;
  let sum = 0;
  for (let odd = 21; odd >= 1; odd -= 2) sum = 1 / odd + square * sum;
  return (doublings * s * sum) / RAD;
};

// A map's measure as the engine is told it (server/mapDistance.js engineMapOf
// puts it on the input's `map`): what every distance here is taken with.
//   flat, scale   a freeform sheet: straight across, `scale` km a degree of it
//   factor        a world projection's scale line: every great circle times it
//   metric        a world projection that is not Mercator: kilometres by the map's height
// Nothing for plain Mercator, which is measured as it always was.
export const measureOptions = (map) => ({
  flat: map?.flat === true,
  scale: map?.scale,
  ...(Number(map?.factor) > 0 && map.factor !== 1 ? { factor: Number(map.factor) } : {}),
  ...(map?.metric && Array.isArray(map.metric.kx) ? { metric: map.metric } : {}),
});

// A world projection's table read at a height y (metric: kx and m by the map's
// height, every `step` from `from`), a straight line between its rows.
const metricAt = (column, metric, y) => {
  const at = (y - metric.from) / metric.step;
  const last = column.length - 1;
  if (!(at > 0)) return column[0];
  if (at >= last) return column[last];
  const row = Math.floor(at);
  return column[row] + (column[row + 1] - column[row]) * (at - row);
};

// The kilometres between two points: along the great circle on a globe, and
// straight across a flat sheet at its own scale (measured on the height the map
// draws it at, so a degree of the sheet is as long at its top as in its middle).
// On a world projection that is not Mercator the places are where it draws
// them: across, a degree of longitude at their middle height; up and down,
// the meridian between their heights.
export const kmBetween = (lngA, latA, lngB, latB, { flat = false, scale = KM_PER_DEGREE, factor = 1, metric = null } = {}) => {
  if (flat) {
    const dy = planeY(latB) - planeY(latA);
    return Math.sqrt((lngB - lngA) * (lngB - lngA) + dy * dy) * (Number(scale) > 0 ? scale : KM_PER_DEGREE);
  }
  if (metric) {
    const yA = planeY(latA);
    const yB = planeY(latB);
    const across = (unwrapLng(lngB, lngA) - lngA) * metricAt(metric.kx, metric, (yA + yB) / 2);
    const up = metricAt(metric.m, metric, yB) - metricAt(metric.m, metric, yA);
    return Math.sqrt(across * across + up * up);
  }
  const a = latA * RAD;
  const b = latB * RAD;
  const down = sine((b - a) / 2);
  const across = sine(((lngB - lngA) * RAD) / 2);
  const h = Math.min(1, Math.max(0, down * down + cosine(a) * cosine(b) * across * across));
  // (Twice the angle whose sine is the root of h.)
  const km = 2 * EARTH_KM * arcTan2(Math.sqrt(h), Math.sqrt(1 - h));
  return factor === 1 ? km : km * factor;
};

// The point a share of the way from one place to another along the great
// circle between them, as [lng, lat].
export const greatPoint = (lngA, latA, lngB, latB, share) => {
  const a = [cosine(latA * RAD) * cosine(lngA * RAD), cosine(latA * RAD) * sine(lngA * RAD), sine(latA * RAD)];
  const b = [cosine(latB * RAD) * cosine(lngB * RAD), cosine(latB * RAD) * sine(lngB * RAD), sine(latB * RAD)];
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const sineOfAngle = Math.sqrt(Math.max(0, 1 - dot * dot));
  const angle = arcTan2(sineOfAngle, dot);
  if (!(angle > 1e-9)) return [lngA, latA];
  // (Two places opposite each other have no one short way between them: the line on the sheet stands in.)
  if (!(sineOfAngle > 1e-9)) return [lngA + (unwrapLng(lngB, lngA) - lngA) * share, latA + (latB - latA) * share];
  const ka = sine((1 - share) * angle) / sineOfAngle;
  const kb = sine(share * angle) / sineOfAngle;
  const x = ka * a[0] + kb * b[0];
  const y = ka * a[1] + kb * b[1];
  const z = ka * a[2] + kb * b[2];
  return [arcTan2(y, x) / RAD, arcTan2(z, Math.sqrt(x * x + y * y)) / RAD];
};

const ringsOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  return [];
};

// The box round every region, [west, south, east, north], and whether the
// regions go all the way round the world.
const boundsOf = (regions) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const region of regions) {
    for (const polygon of ringsOf(region?.geometry)) {
      for (const point of Array.isArray(polygon?.[0]) ? polygon[0] : []) {
        const lng = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
};

// What a sheet is kept under: the map it is of, and which of its region types
// are water (a type switched to water, or back, is another sheet).
export const worldSheetKey = (mapKey, water = null) => {
  const types = water && typeof water[Symbol.iterator] === "function" ? [...water].map((id) => String(id)).sort() : [];
  return `world|${String(mapKey ?? "")}${types.length ? `|water:${types.join("\u0002")}` : ""}`;
};

// The sheet for a map's regions ([{ id, geometry, typeId }]), or null when
// they have no land at all.
//   flat    the map is a flat sheet: nothing wraps and a degree is `scale` km both ways
//   step    a cell's side in degrees, where the sheet's own choice is not wanted (a test)
//   water   the ids of the region types that are water (regionTypes.js
//           waterTypeIds): a region of one is sea on the sheet, like the sea
//           no region covers. The sheet still reaches as far as they do.
export const buildWorldGrid = (regions, { flat = false, scale = KM_PER_DEGREE, factor = 1, metric = null, step: asked = 0, water = null } = {}) => {
  const measure = { flat, scale, factor, metric };
  const list = Array.isArray(regions) ? regions : [];
  const box = boundsOf(list);
  if (!box) return null;
  const wrap = !flat && box.east - box.west > 300;
  // Sea is left round the land for whatever goes round it by sea.
  const pad = Math.max(1, Math.max(box.east - box.west, box.north - box.south) * 0.2);
  const west = wrap ? -180 : box.west - pad;
  const east = wrap ? 180 : box.east + pad;
  const south = flat ? box.south - pad : Math.max(SOUTH_MOST, box.south - pad);
  const north = flat ? box.north + pad : Math.min(NORTH_MOST, box.north + pad);
  if (!(east > west) || !(north > south)) return null;
  const aimed = Math.sqrt(((east - west) * (north - south)) / WORLD_CELLS_AIM);
  const step = asked > 0 ? Math.max(STEP_LEAST_DEG, Number(asked)) : Math.min(WORLD_STEP_DEG, Math.max(STEP_LEAST_DEG, aimed));
  const cols = Math.max(1, wrap ? Math.round(360 / step) : Math.ceil((east - west) / step));
  const rows = Math.max(1, Math.ceil((north - south) / step));
  const sub = step / SUB;
  const subCols = cols * SUB;
  const subRows = rows * SUB;

  // Each sample: 0 for sea, else the region there (its place in `ids`, from 1).
  const samples = new Int32Array(subCols * subRows);
  const ids = [""];
  const wet = water && typeof water.has === "function" && water.size > 0 ? water : null;
  for (const region of list) {
    const id = String(region?.id ?? "").trim();
    if (!id) continue;
    // A region of water is left as the sea it is.
    if (wet && wet.has(String(region?.typeId ?? "").trim())) continue;
    const mark = ids.push(id) - 1;
    for (const polygon of ringsOf(region.geometry)) {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0]) || polygon[0].length < 3) continue;
      // A polygon's longitudes are followed from its first point, so that one
      // drawn across the date line is one shape and not a band round the world.
      const around = Number(polygon[0][0]?.[0]) || 0;
      let top = -Infinity;
      let bottom = Infinity;
      for (const point of polygon[0]) {
        const lat = Number(point?.[1]);
        if (lat > top) top = lat;
        if (lat < bottom) bottom = lat;
      }
      const first = Math.max(0, Math.ceil((north - top) / sub - 0.5));
      const last = Math.min(subRows - 1, Math.floor((north - bottom) / sub - 0.5));
      if (!(last >= first)) continue;
      const crossings = Array.from({ length: last - first + 1 }, () => []);
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        // (Each point from the one before it: a ring may go a long way round.)
        let x2 = unwrapLng(Number(ring[0]?.[0]), around);
        let y2 = Number(ring[0]?.[1]);
        for (let at = 0; at + 1 < ring.length; at += 1) {
          const x1 = x2;
          const y1 = y2;
          x2 = unwrapLng(Number(ring[at + 1]?.[0]), x1);
          y2 = Number(ring[at + 1]?.[1]);
          if (!(y1 !== y2) || !Number.isFinite(x1 + x2 + y1 + y2)) continue;
          const high = Math.max(y1, y2);
          const low = Math.min(y1, y2);
          const from = Math.max(first, Math.ceil((north - high) / sub - 0.5));
          const to = Math.min(last, Math.floor((north - low) / sub - 0.5));
          for (let row = from; row <= to; row += 1) {
            const lat = north - (row + 0.5) * sub;
            // An edge owns its lower end and not its upper, so a vertex is crossed once.
            if (lat < low || lat >= high) continue;
            crossings[row - first].push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
          }
        }
      }
      for (let row = first; row <= last; row += 1) {
        const hits = crossings[row - first];
        if (hits.length < 2) continue;
        hits.sort((a, b) => a - b);
        for (let pair = 0; pair + 1 < hits.length; pair += 2) {
          const begin = Math.ceil((hits[pair] - west) / sub - 0.5);
          const end = Math.floor((hits[pair + 1] - west) / sub - 0.5);
          for (let col = begin; col <= end; col += 1) {
            const across = wrap ? ((col % subCols) + subCols) % subCols : col;
            if (across < 0 || across >= subCols) continue;
            samples[row * subCols + across] = mark;
          }
        }
      }
    }
  }

  // A cell: how many of its samples are land, and a region that lies in it.
  const land = new Uint8Array(cols * rows);
  const region = new Int32Array(cols * rows);
  let any = false;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let count = 0;
      let found = 0;
      for (let dy = 0; dy < SUB; dy += 1) {
        for (let dx = 0; dx < SUB; dx += 1) {
          const mark = samples[(row * SUB + dy) * subCols + col * SUB + dx];
          if (!mark) continue;
          count += 1;
          if (!found) found = mark;
        }
      }
      if (!count) continue;
      any = true;
      land[row * cols + col] = count;
      region[row * cols + col] = found;
    }
  }
  if (!any) return null;

  const grid = { cols, rows, west, north, step, wrap, flat, scale, factor, metric, land, region, ids, full: SUB * SUB };
  // The cell a point lies in, or -1 when it is off the sheet.
  grid.cellOf = (lng, lat) => {
    const row = Math.floor((north - lat) / step);
    let col = Math.floor(((wrap ? unwrapLng(lng, 0) : lng) - west) / step);
    if (wrap) col = ((col % cols) + cols) % cols;
    return row < 0 || row >= rows || col < 0 || col >= cols ? -1 : row * cols + col;
  };
  // The middle of a cell, as [lng, lat].
  grid.centreOf = (cell) => [west + ((cell % cols) + 0.5) * step, north - (Math.floor(cell / cols) + 0.5) * step];
  grid.km = (lngA, latA, lngB, latB) => kmBetween(lngA, latA, lngB, latB, measure);
  // How long a step from a cell to the next is, by the row it is made in:
  // along the row, aslant to the row below, and down to it. (On a globe down a
  // column is the same everywhere; on a flat sheet or another projection it is
  // not: a degree of latitude is drawn taller toward the top and bottom.)
  const along = new Float64Array(rows);
  const aslant = new Float64Array(rows);
  const downRow = new Float64Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const lat = north - (row + 0.5) * step;
    along[row] = kmBetween(0, lat, step, lat, measure);
    aslant[row] = kmBetween(0, lat, step, lat - step, measure);
    downRow[row] = kmBetween(0, lat, 0, lat - step, measure);
  }
  grid.stepKm = { along, aslant, down: kmBetween(0, north - step * 0.5, 0, north - step * 1.5, measure), downRow: flat || metric ? downRow : null };
  // The cosine of each row's latitude, for the distances a search guesses by.
  grid.rowCosine = Float64Array.from({ length: rows }, (_, row) => cosine((north - (row + 0.5) * step) * RAD));
  return grid;
};

// What a search needs to guess how far a cell is from one cell it is making
// for, without a sine a cell: the part of the distance each row adds, and each
// number of columns apart. Returns (cell) => kilometres.
export const distanceTo = (grid, goal) => {
  const { cols, rows, step, flat, scale, wrap, metric } = grid;
  const goalRow = Math.floor(goal / cols);
  const goalCol = goal % cols;
  if (flat || metric) {
    // Each row's height as the map draws it: rows of the sheet are not all as tall.
    const height = new Float64Array(rows);
    for (let row = 0; row < rows; row += 1) height[row] = planeY(grid.north - (row + 0.5) * step);
    if (flat) {
      const perDegree = Number(scale) > 0 ? scale : KM_PER_DEGREE;
      return (cell) => {
        const dx = ((cell % cols) - goalCol) * step;
        const dy = height[Math.floor(cell / cols)] - height[goalRow];
        return Math.sqrt(dx * dx + dy * dy) * perDegree;
      };
    }
    const upTo = Float64Array.from(height, (y) => metricAt(metric.m, metric, y));
    return (cell) => {
      const row = Math.floor(cell / cols);
      let apart = (cell % cols) - goalCol;
      if (apart < 0) apart = -apart;
      if (wrap && apart > cols - apart) apart = cols - apart;
      const across = apart * step * metricAt(metric.kx, metric, (height[row] + height[goalRow]) / 2);
      const up = upTo[row] - upTo[goalRow];
      return Math.sqrt(across * across + up * up);
    };
  }
  const down = new Float64Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const half = sine(((row - goalRow) * step * RAD) / 2);
    down[row] = half * half;
  }
  const across = new Float64Array(cols);
  for (let apart = 0; apart < cols; apart += 1) {
    const half = sine((apart * step * RAD) / 2);
    across[apart] = half * half;
  }
  const goalCosine = grid.rowCosine[goalRow];
  const earthTimes = Number(grid.factor) > 0 ? grid.factor : 1;
  return (cell) => {
    const row = Math.floor(cell / cols);
    let apart = (cell % cols) - goalCol;
    if (apart < 0) apart = -apart;
    if (wrap && apart > cols - apart) apart = cols - apart;
    const h = Math.min(1, down[row] + grid.rowCosine[row] * goalCosine * across[apart]);
    return 2 * EARTH_KM * arcTan2(Math.sqrt(h), Math.sqrt(1 - h)) * earthTimes;
  };
};

// The seas of a sheet, each numbered: a cell a ship may pass (not wholly land)
// carries the number of the water it is part of, and 0 on dry land. Two cells
// with the same number can be sailed between. Worked out once a sheet.
export const seasOf = (grid) => {
  if (grid.seas) return grid.seas;
  const { cols, rows, land, full, wrap } = grid;
  const seas = new Int32Array(cols * rows);
  const stack = [];
  let count = 0;
  for (let start = 0; start < seas.length; start += 1) {
    if (seas[start] || land[start] >= full) continue;
    count += 1;
    seas[start] = count;
    stack.push(start);
    while (stack.length > 0) {
      const cell = stack.pop();
      const row = Math.floor(cell / cols);
      const col = cell % cols;
      for (let dy = -1; dy <= 1; dy += 1) {
        const y = row + dy;
        if (y < 0 || y >= rows) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          let x = col + dx;
          if (wrap) x = (x + cols) % cols;
          else if (x < 0 || x >= cols) continue;
          const next = y * cols + x;
          if (seas[next] || land[next] >= full) continue;
          seas[next] = count;
          stack.push(next);
        }
      }
    }
  }
  grid.seas = seas;
  grid.seaCount = count;
  return seas;
};

// The cells within `reach` cells of one, nearest first: for finding the
// nearest cell of some kind to a point. Calls `visit(cell, rings)` until it
// returns true; returns that cell, or -1.
export const nearestCell = (grid, cell, reach, visit) => {
  if (cell < 0) return -1;
  const { cols, rows, wrap } = grid;
  const row = Math.floor(cell / cols);
  const col = cell % cols;
  if (visit(cell, 0)) return cell;
  for (let ring = 1; ring <= reach; ring += 1) {
    let best = -1;
    let least = Infinity;
    for (let dy = -ring; dy <= ring; dy += 1) {
      const y = row + dy;
      if (y < 0 || y >= rows) continue;
      const edge = Math.abs(dy) === ring;
      for (let dx = -ring; dx <= ring; dx += edge ? 1 : 2 * ring) {
        let x = col + dx;
        if (wrap) x = ((x % cols) + cols) % cols;
        else if (x < 0 || x >= cols) continue;
        const next = y * cols + x;
        const far = dx * dx + dy * dy;
        if (far < least && visit(next, ring)) {
          least = far;
          best = next;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
};

// The place a given distance along a way ([[lng, lat]...]), as
// { lng, lat, leg, bearing }: `leg` is the stretch it is on and `bearing` the
// way it faces there, in degrees clockwise from north.
export const placeAlong = (way, km, options = {}) => {
  const points = Array.isArray(way) ? way : [];
  if (points.length === 0) return null;
  let left = Math.max(0, Number(km) || 0);
  for (let leg = 0; leg + 1 < points.length; leg += 1) {
    const [lngA, latA] = points[leg];
    const [lngB, latB] = points[leg + 1];
    const length = kmBetween(lngA, latA, lngB, latB, options);
    if (left <= length || leg + 2 === points.length) {
      const share = length > 0 ? Math.min(1, left / length) : 1;
      const across = unwrapLng(lngB, lngA) - lngA;
      const bearing = (arcTan2(options.flat ? across : across * cosine(((latA + latB) / 2) * RAD), latB - latA) / RAD + 360) % 360;
      return { lng: unwrapLng(lngA + across * share, 0), lat: latA + (latB - latA) * share, leg, bearing };
    }
    left -= length;
  }
  return { lng: points[0][0], lat: points[0][1], leg: 0, bearing: 0 };
};

// How long a way is, in kilometres.
export const wayKm = (way, options = {}) => {
  let total = 0;
  for (let leg = 0; leg + 1 < (Array.isArray(way) ? way.length : 0); leg += 1) total += kmBetween(way[leg][0], way[leg][1], way[leg + 1][0], way[leg + 1][1], options);
  return total;
};
