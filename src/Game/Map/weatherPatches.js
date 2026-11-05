/*! Open Historia — the weather of a scenario's climate zones, as patches on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The thing showing that its winter shouldnt just be a circle, think of the
// shapes more like minecraft biomes, where the biomes are all dynamic shapes
// that are connected to each other and are smoothed out", and "the weather
// patches should be drawn by scenario designers who can choose the climate
// regions" (the owner, 2026-10-14).
//
// Each climate zone a designer painted (runtime/warGeography.js climateZones)
// has one weather at a time (runtime/zoneWeather.js). The map draws it as a
// patch in the zone's own shape. Each zone's share of each place, a half at
// its edge, the whole blendKm / 2 inside it and nothing as far outside
// (seasonTint.js zoneWeightGrid, as the season's tint has it), is summed for
// the zones of each weather; the patch's outline is traced at five levels of
// that sum, a tenth to nine tenths (marching squares), and rounded off
// (Chaikin). The five are laid one over another, so a patch's weather is full
// in its middle and thins evenly across its edge into the next: where two zones meet, their
// patches meet, each fading into the other, and zones of one weather that
// touch are one patch. Nothing is drawn where no zone is, and no word is
// written: the patterns say the weather, the advisor when asked
// (Game/AI/advisorWeather.js).
//
// Pure: features out of the zones and their weather. The layers are
// FrontWeatherLayers.jsx.

import { KM_PER_DEGREE, latToY, yToLat } from "../../runtime/fronts/frame.js";
import { WEATHER_STATES } from "../../runtime/fronts/weather.js";
import { normalizeClimateZones, normalizeZoneWeather } from "../../runtime/warGeography.js";
import { weatherOverlayOf } from "./frontWeatherFeatures.js";
import { MERCATOR_TOP_LAT, seasonTintHeight, tintGrid, zoneWeightGrid } from "./seasonTint.js";

// Where a patch's outline is traced, and how strongly each is drawn: laid one
// over another they come to a fifth, two fifths, three, four and all of the
// weather, in even steps from the edge of its blend to the middle.
export const PATCH_BANDS = Object.freeze([
  Object.freeze([0.1, 0.2]),
  Object.freeze([0.3, 0.25]),
  Object.freeze([0.5, 1 / 3]),
  Object.freeze([0.7, 0.5]),
  Object.freeze([0.9, 1]),
]);
// How fine the picture the outlines are traced on is: a pixel no finer than
// this many degrees, and about this many pixels for all the zones together.
const STEP_LEAST_DEG = 0.06;
const PIXELS_AIM = 360000;
const WIDTH_MOST = 6000;
const SMOOTHING_ROUNDS = 2;
// How far toward the poles a patch's outline reaches. An outline along the
// map's very edge (85.05°) was cut into by triangles where the map draws it.
export const PATCH_EDGE_LAT = 85;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const round6 = (value) => Math.round(value * 1e6) / 1e6;

// ---- the outlines ------------------------------------------------------------------------

// The outlines where a field (values, width x height, row by row) crosses a
// level, as closed rings of [x, y] in the field's own pixels (a pixel's middle
// at its whole number). The field is taken as nothing past its edges, so every
// ring closes; a hole in a patch is a ring of its own (ringsToPolygons).
export const contourRings = (values, width, height, level) => {
  // The field with a border of nothing round it.
  const W = width + 2;
  const H = height + 2;
  const at = (x, y) => (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1 ? 0 : values[(y - 1) * width + (x - 1)]);
  // Where the outline crosses an edge between two pixels, kept by the edge.
  const points = new Map();
  const crossing = (key, x0, y0, x1, y1) => {
    if (points.has(key)) return key;
    const a = at(x0, y0);
    const b = at(x1, y1);
    const share = b === a ? 0.5 : (level - a) / (b - a);
    points.set(key, [x0 + (x1 - x0) * share - 1, y0 + (y1 - y0) * share - 1]);
    return key;
  };
  const top = (x, y) => crossing(`h${x},${y}`, x, y, x + 1, y);
  const bottom = (x, y) => crossing(`h${x},${y + 1}`, x, y + 1, x + 1, y + 1);
  const left = (x, y) => crossing(`v${x},${y}`, x, y, x, y + 1);
  const right = (x, y) => crossing(`v${x + 1},${y}`, x + 1, y, x + 1, y + 1);
  // Each square of four pixels gives one or two pieces of outline, each between two edges.
  const ends = new Map();
  const pieces = [];
  const piece = (a, b) => {
    const index = pieces.push([a, b]) - 1;
    for (const key of [a, b]) {
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push(index);
    }
  };
  for (let y = 0; y < H - 1; y += 1) {
    for (let x = 0; x < W - 1; x += 1) {
      const tl = at(x, y) >= level ? 8 : 0;
      const tr = at(x + 1, y) >= level ? 4 : 0;
      const br = at(x + 1, y + 1) >= level ? 2 : 0;
      const bl = at(x, y + 1) >= level ? 1 : 0;
      const square = tl | tr | br | bl;
      if (square === 0 || square === 15) continue;
      if (square === 5 || square === 10) {
        // Two corners across from each other: whether they join through the middle.
        const middle = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= level;
        if ((square === 5) === middle) {
          piece(top(x, y), left(x, y));
          piece(right(x, y), bottom(x, y));
        } else {
          piece(top(x, y), right(x, y));
          piece(left(x, y), bottom(x, y));
        }
        continue;
      }
      const edges = [];
      if (Boolean(tl) !== Boolean(tr)) edges.push(top(x, y));
      if (Boolean(tr) !== Boolean(br)) edges.push(right(x, y));
      if (Boolean(bl) !== Boolean(br)) edges.push(bottom(x, y));
      if (Boolean(tl) !== Boolean(bl)) edges.push(left(x, y));
      if (edges.length === 2) piece(edges[0], edges[1]);
    }
  }
  // The pieces joined end to end into rings.
  const used = new Uint8Array(pieces.length);
  const rings = [];
  for (let first = 0; first < pieces.length; first += 1) {
    if (used[first]) continue;
    used[first] = 1;
    const [start, next] = pieces[first];
    const ring = [points.get(start)];
    let key = next;
    while (key !== start) {
      ring.push(points.get(key));
      const following = (ends.get(key) ?? []).find((index) => !used[index]);
      if (following === undefined) break;
      used[following] = 1;
      const [a, b] = pieces[following];
      key = a === key ? b : a;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
};

// A closed ring with its corners cut, round by round (Chaikin): each side
// keeps its middle half, so the outline rounds off and never grows.
export const smoothRing = (ring, rounds = SMOOTHING_ROUNDS) => {
  let points = ring;
  for (let round = 0; round < rounds && points.length >= 3; round += 1) {
    const next = [];
    for (let index = 0; index < points.length; index += 1) {
      const [ax, ay] = points[index];
      const [bx, by] = points[(index + 1) % points.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    points = next;
  }
  return points;
};

const signedArea = (ring) => {
  let sum = 0;
  for (let index = 0, back = ring.length - 1; index < ring.length; back = index, index += 1) sum += (ring[back][0] - ring[index][0]) * (ring[back][1] + ring[index][1]);
  return sum / 2;
};
const insideRing = (ring, [x, y]) => {
  let odd = false;
  for (let index = 0, back = ring.length - 1; index < ring.length; back = index, index += 1) {
    const [ax, ay] = ring[back];
    const [bx, by] = ring[index];
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) odd = !odd;
  }
  return odd;
};

// Rings sorted into polygons: a ring inside an even number of others is an
// outline, one inside an odd number a hole in the smallest outline round it.
// [[outline, ...holes]].
export const ringsToPolygons = (rings) => {
  const kept = list(rings).filter((ring) => ring.length >= 3).map((ring) => ({ ring, area: Math.abs(signedArea(ring)) }));
  const depth = kept.map((entry, index) => kept.reduce((count, other, at) => count + (at !== index && other.area > entry.area && insideRing(other.ring, entry.ring[0]) ? 1 : 0), 0));
  const polygons = [];
  const holder = new Map();
  kept.forEach((entry, index) => {
    if (depth[index] % 2 === 0) holder.set(index, polygons.push([entry.ring]) - 1);
  });
  kept.forEach((entry, index) => {
    if (depth[index] % 2 === 0) return;
    let best = -1;
    kept.forEach((other, at) => {
      if (depth[at] !== depth[index] - 1 || !insideRing(other.ring, entry.ring[0])) return;
      if (best < 0 || other.area < kept[best].area) best = at;
    });
    if (best >= 0) polygons[holder.get(best)].push(entry.ring);
  });
  return polygons;
};

// ---- the patches --------------------------------------------------------------------

// Each zone's weather today: world.zoneWeather where it is of this date, else
// what is given in its place (runtime/zoneWeather.js zoneWeatherFor, worked
// out by the page). Map of zone id to { state, season }.
export const zoneWeatherById = (recorded, date, fallback = null) => {
  const kept = normalizeZoneWeather(recorded);
  const chosen = kept && kept.date === clean(date) ? kept : normalizeZoneWeather(fallback);
  return new Map((chosen?.zones ?? []).map((entry) => [entry.id, { state: entry.state, season: entry.season }]));
};

// The picture the outlines are traced on: its pixels as fine as the zones are
// small, and no finer than a few kilometres; and coarse enough that the
// widest blend of any zone fits in what seasonTint.js reaches past a zone (it
// stops BLEND_PIXELS_MOST out), or the patch would be cut square there.
const BLEND_PIXELS_MOST = 88;
const gridFor = (zones) => {
  let area = 0;
  let blendMost = 0;
  let farthest = 0;
  for (const zone of zones) {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const [lng, lat] of zone.rings[0] ?? []) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    if (!(east > west && north > south)) continue;
    area += (east - west + 2) * (north - south + 2);
    blendMost = Math.max(blendMost, Number(zone.blendKm) || 0);
    farthest = Math.max(farthest, Math.abs(south), Math.abs(north));
  }
  const step = Math.max(STEP_LEAST_DEG, Math.sqrt(area / PIXELS_AIM));
  const kmAcross = 360 * KM_PER_DEGREE * Math.cos((Math.min(MERCATOR_TOP_LAT, farthest) * Math.PI) / 180);
  const fits = blendMost > 0 ? Math.floor((kmAcross * BLEND_PIXELS_MOST) / (blendMost / 2)) : WIDTH_MOST;
  const width = Math.max(360, Math.min(WIDTH_MOST, Math.max(720, Math.round(360 / step)), fits));
  return tintGrid(width, seasonTintHeight(width, MERCATOR_TOP_LAT), MERCATOR_TOP_LAT);
};

const overlaps = (a, b) => a.x0 < b.x0 + b.width && b.x0 < a.x0 + a.width && a.y0 < b.y0 + b.height && b.y0 < a.y0 + a.height;

// The patches of weather.
//   zones     world.climateZones
//   weather   Map of zone id to { state, season } (zoneWeatherById)
// Returns { areas }: the patches (polygons, each with its weather, its
// strength, and its picture and wash where it has them).
export const weatherPatchFeatures = ({ zones = [], weather = new Map() } = {}) => {
  const areas = [];
  const kept = normalizeClimateZones(zones);
  const known = kept.filter((zone) => weather.get(zone.id) && WEATHER_STATES.includes(weather.get(zone.id).state));
  if (known.length === 0) return { areas: { type: "FeatureCollection", features: areas } };
  const grid = gridFor(known);
  const top = latToY(grid.topLat);
  // Never past the date line: a sliver over it is wrapped round to the other side
  // of the map as a ring of its own, which is read as a hole in the patch there.
  const lngOf = (x) => round6(Math.max(-180, Math.min(180, ((x + 0.5) / grid.width) * 360 - 180)));
  const latOf = (y) => round6(Math.max(-PATCH_EDGE_LAT, Math.min(PATCH_EDGE_LAT, yToLat(top - ((y + 0.5) * 2 * top) / grid.height))));
  const placed = known.map((zone) => ({ zone, ...weather.get(zone.id), cells: zoneWeightGrid(zone, grid) })).filter((entry) => entry.cells);

  // The zones of one weather that touch, taken together.
  const drawn = placed.filter((entry) => weatherOverlayOf(entry.state)?.pattern || weatherOverlayOf(entry.state)?.wash);
  const group = drawn.map((_, index) => index);
  const find = (index) => (group[index] === index ? index : (group[index] = find(group[index])));
  for (let a = 0; a < drawn.length; a += 1) {
    for (let b = a + 1; b < drawn.length; b += 1) {
      if (drawn[a].state === drawn[b].state && overlaps(drawn[a].cells, drawn[b].cells)) group[find(a)] = find(b);
    }
  }
  const clusters = new Map();
  drawn.forEach((entry, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(entry);
  });

  for (const members of clusters.values()) {
    const { state } = members[0];
    const overlay = weatherOverlayOf(state);
    const x0 = Math.min(...members.map((entry) => entry.cells.x0));
    const y0 = Math.min(...members.map((entry) => entry.cells.y0));
    const width = Math.max(...members.map((entry) => entry.cells.x0 + entry.cells.width)) - x0;
    const height = Math.max(...members.map((entry) => entry.cells.y0 + entry.cells.height)) - y0;
    const box = { x0, y0, width, height };
    // Every zone's share there, to share out the places where zones overlap; this weather's own.
    const total = new Float32Array(width * height);
    const own = new Float32Array(width * height);
    for (const entry of placed) {
      const { cells } = entry;
      if (!overlaps(cells, box)) continue;
      const mine = members.includes(entry);
      for (let row = 0; row < cells.height; row += 1) {
        const y = cells.y0 + row - y0;
        if (y < 0 || y >= height) continue;
        for (let col = 0; col < cells.width; col += 1) {
          const x = cells.x0 + col - x0;
          if (x < 0 || x >= width) continue;
          const weight = cells.weights[row * cells.width + col];
          if (!(weight > 0)) continue;
          total[y * width + x] += weight;
          if (mine) own[y * width + x] += weight;
        }
      }
    }
    const field = new Float32Array(width * height);
    for (let at = 0; at < field.length; at += 1) field[at] = total[at] > 1 ? own[at] / total[at] : own[at];

    for (const [level, strength] of PATCH_BANDS) {
      const polygons = ringsToPolygons(contourRings(field, width, height, level).map((ring) => smoothRing(ring)));
      if (polygons.length === 0) continue;
      const coordinates = polygons.map((rings) => rings.map((ring, index) => {
        const placedRing = ring.map(([x, y]) => [lngOf(x0 + x), latOf(y0 + y)]);
        // An outline one way round, a hole the other (as GeoJSON has them: outlines anticlockwise).
        if ((signedArea(placedRing) < 0) === (index === 0)) placedRing.reverse();
        placedRing.push([...placedRing[0]]);
        return placedRing;
      }));
      areas.push({
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates },
        properties: {
          weather: state,
          level,
          strength,
          ...(overlay.pattern ? { pattern: overlay.pattern } : {}),
          ...(overlay.wash ? { wash: overlay.wash.color, washOpacity: overlay.wash.opacity } : {}),
        },
      });
    }
  }
  return { areas: { type: "FeatureCollection", features: areas } };
};
