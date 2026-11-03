/*! Open Historia — the season the map is tinted by © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Add visuals for seasons and weather so you can tell what it is" (the
// owner); and of a scenario's climate zones, "it should look like a blend of
// colors where they blend into each other with effects that transition
// smoothly between areas on the map".
//
// Every place on the map is tinted by the season it is in on the game's date:
// winter a cold blue-white, spring green, summer a warm yellow, autumn amber.
//
//   the world's own   the season by the month and the latitude, as the front
//                     engine reads it (fronts/weather.js seasonOf): the other
//                     way round south of the equator. It fades out toward the
//                     equator, where there is no winter to speak of, so the
//                     turn of the seasons at the equator is never a line.
//   a climate zone    a scenario's own (runtime/warGeography.js climateZones,
//                     fronts/climate.js): each of its seasons tints in its own
//                     colour where the designer gave one, else by its name
//                     ("Winter", "Late Autumn"), else by the weather it brings
//                     (snow white, rain blue, heat orange...), else in the
//                     zone's colour. In a gap between its seasons it is the
//                     world's own.
//
// Nothing changes at a line or on a day. Over time a zone's seasons fade into
// each other over its transitionDays (climate.js seasonMixOn, the very mix
// zoneMixOn names its season from), and the world's own over four weeks round
// each turn of the month. Across the map a zone's share of a place is a half at
// its edge, rising to the whole blendKm / 2 inside it and falling to nothing as
// far outside (warGeography.js zoneWeightAt); where zones meet they share, and
// what they leave is the world's own. A blend is never narrower than a few
// pixels of the picture, so even a zone with no blend of its own melts into
// the next.
//
// The picture is one canvas over the whole map, laid out as the map lays out
// a picture: evenly between its corners on the map's own plane (Mercator), so
// each row is given the latitude it is drawn at, and as many rows as keep its
// pixels square on that plane. The flat map ends at 85° from the equator; the
// globe is drawn on to its poles, as the game's own background picture is
// (server/mapProjection.js imageQuad), or a cap round each pole would be left
// untinted. It is worked out pixel by pixel in flat colours: each zone's share
// of each pixel from the distance to its edge (a 3-4 chamfer over the pixels
// near it, in kilometres by the row), then the colours mixed by those shares.
//
// Pure: { width, height, topLat, data } out of the zones and a date. The
// layer is SeasonLayers.jsx.

import { curvedRings, dayOfYear, seasonMixOn } from "../../runtime/fronts/climate.js";
import { KM_PER_DEGREE, yToLat } from "../../runtime/fronts/frame.js";
import { seasonOf } from "../../runtime/fronts/weather.js";
import { parseGameDate } from "../../runtime/gameDates.js";
import { normalizeClimateZones } from "../../runtime/warGeography.js";

// How far toward the poles the picture reaches: the flat map's edge, and the globe's.
export const MERCATOR_TOP_LAT = 85.0511287798066;
export const GLOBE_TOP_LAT = 89.9;
const RAD = Math.PI / 180;
// The height the map's plane draws a latitude at, in its own degrees: past
// the flat map's edge too, as far as the globe's picture goes.
const planeY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-89.99, Math.min(89.99, Number(lat) || 0)) * RAD) / 2)) / RAD;
// The picture's four corners as the map takes them.
export const seasonTintCorners = (topLat = MERCATOR_TOP_LAT) => [[-180, topLat], [180, topLat], [180, -topLat], [-180, -topLat]];
// The rows a picture `width` across needs to keep its pixels square, reaching to `topLat`.
export const seasonTintHeight = (width, topLat = MERCATOR_TOP_LAT) => Math.round((width * 2 * planeY(topLat)) / 360);

export const SEASON_TINTS = Object.freeze({
  winter: Object.freeze([222, 236, 255]),
  spring: Object.freeze([118, 204, 104]),
  summer: Object.freeze([255, 214, 74]),
  autumn: Object.freeze([226, 136, 44]),
});
// The colour a season of a designer's brings by its weather, where it has no
// colour or name of its own to go by. Clear weather says nothing.
export const WEATHER_TINTS = Object.freeze({
  rain: Object.freeze([96, 160, 206]),
  storm: Object.freeze([72, 108, 152]),
  mud: Object.freeze([146, 108, 64]),
  snow: Object.freeze([228, 239, 255]),
  blizzard: Object.freeze([240, 246, 255]),
  frost: Object.freeze([198, 224, 246]),
  heat: Object.freeze([255, 184, 70]),
  fog: Object.freeze([186, 192, 200]),
});
// The world's own seasons turn over this many days round each first of the month they begin.
export const WORLD_TRANSITION_DAYS = 28;
// The fewest pixels of the picture a zone's edge is blended over.
export const MIN_BLEND_PIXELS = 3;
// The most pixels a zone's blend is looked for beyond its edge.
const PAD_MOST = 96;

const within = (value, least, most) => (value < least ? least : value > most ? most : value);
const hexRgb = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
};

// The world season a name says, "" for none: "Winter", "deep winter", "The Fall".
const SEASON_WORDS = Object.freeze({ winter: "winter", spring: "spring", summer: "summer", autumn: "autumn", fall: "autumn" });
export const seasonWordOf = (name) => {
  for (const word of String(name ?? "").toLowerCase().split(/[^a-z]+/)) if (Object.hasOwn(SEASON_WORDS, word)) return SEASON_WORDS[word];
  return "";
};

// The colour a season of a designer's zone tints in, or null where nothing
// says: its own colour, else its name's, else its weather's.
export const seasonTintOf = (season) => {
  if (!season || typeof season !== "object") return null;
  const own = hexRgb(season.color);
  if (own) return own;
  const word = seasonWordOf(season.name);
  if (word) return [...SEASON_TINTS[word]];
  let total = 0;
  const sum = [0, 0, 0];
  for (const [state, weight] of Object.entries(season.weather ?? {})) {
    const tint = Object.hasOwn(WEATHER_TINTS, state) ? WEATHER_TINTS[state] : null;
    if (!tint || !(Number(weight) > 0)) continue;
    total += Number(weight);
    for (let part = 0; part < 3; part += 1) sum[part] += Number(weight) * tint[part];
  }
  return total > 0 ? sum.map((part) => Math.round(part / total)) : null;
};

// How strongly the world's own season shows at a latitude: nothing within 15
// degrees of the equator, all of it from 40.
export const worldStrengthAt = (lat) => within((Math.abs(Number(lat) || 0) - 15) / 25, 0, 1);

// The days of the year the world's seasons turn on (the first of March, June,
// September and December, fronts/weather.js seasonOf), and what turns into
// what there north of the equator.
const TURNS = [[dayOfYear(3, 1), "winter", "spring"], [dayOfYear(6, 1), "spring", "summer"], [dayOfYear(9, 1), "summer", "autumn"], [dayOfYear(12, 1), "autumn", "winter"]];
const SOUTH = Object.freeze({ winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" });

// The world's own season on a date at a latitude, as shares: [{ season, weight }],
// the weights adding to 1. Half and half on the first day of a season, all of
// the one a fortnight either side. [] for a date the calendar cannot read.
export const worldSeasonMix = (date, lat) => {
  const parsed = parseGameDate(date);
  if (!parsed) return [];
  const day = dayOfYear(parsed.month, parsed.day);
  const named = (season) => (lat < 0 ? SOUTH[season] : season);
  const half = WORLD_TRANSITION_DAYS / 2;
  for (const [first, before, after] of TURNS) {
    // Days from the turn, -182 to 182.
    const from = ((((day - first) % 365) + 365 + 182) % 365) - 182;
    if (from < -half || from >= half) continue;
    const weight = within(0.5 + (from + 0.5) / (2 * half), 0, 1);
    return [{ season: named(after), weight }, { season: named(before), weight: 1 - weight }];
  }
  return [{ season: seasonOf(parsed.month, lat), weight: 1 }];
};

// The world's own tint on a date at a latitude: { rgb, strength }.
export const worldTintAt = (date, lat) => {
  const mix = worldSeasonMix(date, lat);
  if (mix.length === 0) return { rgb: [0, 0, 0], strength: 0 };
  const rgb = [0, 0, 0];
  for (const { season, weight } of mix) for (let part = 0; part < 3; part += 1) rgb[part] += weight * SEASON_TINTS[season][part];
  return { rgb: rgb.map(Math.round), strength: worldStrengthAt(lat) };
};

// A zone's seasons on a date as tints: [{ weight, rgb }], rgb null for the
// world's own (a gap between its seasons, or a zone with none).
const zoneTints = (zone, date) => seasonMixOn(zone, date).map(({ season, weight }) => {
  if (!(season >= 0)) return { weight, rgb: null };
  return { weight, rgb: seasonTintOf(zone.seasons[season]) ?? hexRgb(zone.color) ?? [127, 140, 153] };
});

// A zone's tint on a date at a latitude: { rgb, strength }. Its own seasons
// show whole; where the world's own is in, it shows as the world's would there.
export const zoneTintOn = (zone, date, lat) => {
  const world = worldTintAt(date, lat);
  let strength = 0;
  const sum = [0, 0, 0];
  for (const { weight, rgb } of zoneTints(zone, date)) {
    const share = weight * (rgb ? 1 : world.strength);
    for (let part = 0; part < 3; part += 1) sum[part] += share * (rgb ?? world.rgb)[part];
    strength += share;
  }
  return strength > 0 ? { rgb: sum.map((part) => Math.round(part / strength)), strength } : { rgb: [0, 0, 0], strength: 0 };
};

// ---- across the map ------------------------------------------------------------

// Distances on a grid by the 3-4 chamfer, in thirds of a pixel, from every
// pixel to the nearest that is `target` in `mask` (as fronts/climate.js measures a battlefield's cells).
// With `wrap` the grid is the whole world round: its left edge is the right
// one's neighbour, and the passes run twice so a distance crosses the date line.
const FAR = 1 << 29;
const chamfer = (mask, width, height, target, wrap = false) => {
  const distance = new Int32Array(width * height);
  for (let at = 0; at < distance.length; at += 1) distance[at] = mask[at] === target ? 0 : FAR;
  const west = (x) => (x > 0 ? x - 1 : wrap ? width - 1 : -1);
  const east = (x) => (x < width - 1 ? x + 1 : wrap ? 0 : -1);
  for (let round = 0; round < (wrap ? 2 : 1); round += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        const w = west(x);
        const e = east(x);
        let best = distance[at];
        if (w >= 0 && distance[y * width + w] + 3 < best) best = distance[y * width + w] + 3;
        if (y > 0) {
          if (distance[at - width] + 3 < best) best = distance[at - width] + 3;
          if (w >= 0 && distance[(y - 1) * width + w] + 4 < best) best = distance[(y - 1) * width + w] + 4;
          if (e >= 0 && distance[(y - 1) * width + e] + 4 < best) best = distance[(y - 1) * width + e] + 4;
        }
        distance[at] = best;
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const at = y * width + x;
        const w = west(x);
        const e = east(x);
        let best = distance[at];
        if (e >= 0 && distance[y * width + e] + 3 < best) best = distance[y * width + e] + 3;
        if (y < height - 1) {
          if (distance[at + width] + 3 < best) best = distance[at + width] + 3;
          if (e >= 0 && distance[(y + 1) * width + e] + 4 < best) best = distance[(y + 1) * width + e] + 4;
          if (w >= 0 && distance[(y + 1) * width + w] + 4 < best) best = distance[(y + 1) * width + w] + 4;
        }
        distance[at] = best;
      }
    }
  }
  return distance;
};

// How near the date line a zone's outline must come on both sides for the zone
// to be taken as running round the world (a designer cannot draw on it exactly:
// Antarctica is drawn from 179.5° W to 179.5° E).
export const ROUND_THE_WORLD_DEG = 2;

// The picture's grid, reaching to `topLat`: where a place falls on it (a
// pixel's middle is a whole number), and the latitude and the kilometres a
// pixel measures each row.
export const tintGrid = (width, height, topLat = MERCATOR_TOP_LAT) => {
  const top = planeY(topLat);
  const rowLat = new Float64Array(height);
  const rowKm = new Float64Array(height);
  for (let row = 0; row < height; row += 1) {
    rowLat[row] = yToLat(top - ((row + 0.5) * 2 * top) / height);
    rowKm[row] = Math.max(0.5, (360 / width) * KM_PER_DEGREE * Math.cos(rowLat[row] * RAD));
  }
  return {
    width,
    height,
    topLat,
    rowLat,
    rowKm,
    toX: (lng) => ((lng + 180) / 360) * width - 0.5,
    toY: (lat) => ((top - planeY(lat)) / (2 * top)) * height - 0.5,
  };
};

// A zone's share of each pixel near it, 0 to 1: { x0, y0, width, height,
// weights }, its columns counted on from x0 as they are (a zone across the
// date line runs past the picture's edge, and is drawn on the other side of
// it). null where it reaches no pixel.
export const zoneWeightGrid = (zone, grid) => {
  // (Its outline rounded off, as the engine reads it: fronts/climate.js curvedRings.)
  const rings = curvedRings(zone).map((ring) => ring.map(([lng, lat]) => [grid.toX(lng), grid.toY(lat)]));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const blendKm = Number(zone.blendKm) || 0;
  let leastKm = Infinity;
  for (let row = within(Math.floor(minY), 0, grid.height - 1); row <= within(Math.ceil(maxY), 0, grid.height - 1); row += 1) leastKm = Math.min(leastKm, grid.rowKm[row]);
  const pad = Math.min(PAD_MOST, Math.ceil(Math.max(MIN_BLEND_PIXELS, blendKm / leastKm) / 2) + 2);
  let x0 = Math.floor(minX) - pad;
  let x1 = Math.ceil(maxX) + pad + 1;
  if (x1 - x0 > grid.width) {
    x0 = 0;
    x1 = grid.width;
  }
  const y0 = Math.max(0, Math.floor(minY) - pad);
  const y1 = Math.min(grid.height, Math.ceil(maxY) + pad + 1);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;
  // A zone that reaches the date line on both sides runs round the world: the
  // strip it leaves across the line is its own, and its share is measured
  // round the world, not cut at the picture's edge. Else Antarctica's snow
  // thinned to nothing in a wedge either side of the line.
  const seam = (ROUND_THE_WORLD_DEG / 360) * grid.width;
  const roundTheWorld = x0 === 0 && width === grid.width && minX <= grid.toX(-180) + seam && maxX >= grid.toX(180) - seam;
  // Inside or out by its rings, each pixel's middle (as zoneWeightAt tells it: across all its rings, odd is in).
  const mask = new Uint8Array(width * height);
  let filled = 0;
  const crossings = [];
  for (let row = 0; row < height; row += 1) {
    const y = y0 + row;
    crossings.length = 0;
    for (const ring of rings) {
      for (let at = 0, back = ring.length - 1; at < ring.length; back = at, at += 1) {
        const [ax, ay] = ring[back];
        const [bx, by] = ring[at];
        if ((ay > y) !== (by > y)) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const from = Math.max(x0, Math.ceil(crossings[pair]));
      const to = Math.min(x1 - 1, Math.ceil(crossings[pair + 1]) - 1);
      for (let x = from; x <= to; x += 1) {
        mask[row * width + x - x0] = 1;
        filled += 1;
      }
    }
    // Across the date line: the row's first and last pixels inside, each near its edge, are one stretch.
    if (roundTheWorld && crossings.length >= 2 && crossings[0] <= seam && crossings[crossings.length - 1] >= width - 1 - seam) {
      for (let x = 0; x < width && mask[row * width + x] === 0; x += 1) {
        mask[row * width + x] = 1;
        filled += 1;
      }
      for (let x = width - 1; x >= 0 && mask[row * width + x] === 0; x -= 1) {
        mask[row * width + x] = 1;
        filled += 1;
      }
    }
  }
  if (filled === 0) return null;
  const inside = chamfer(mask, width, height, 0, roundTheWorld);
  const outside = chamfer(mask, width, height, 1, roundTheWorld);
  const weights = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const km = grid.rowKm[y0 + row];
    const blend = Math.max(blendKm, MIN_BLEND_PIXELS * km);
    for (let col = 0; col < width; col += 1) {
      const at = row * width + col;
      // (A pixel's middle is half a pixel from the edge between it and the next.)
      const into = mask[at] === 1 ? inside[at] / 3 - 0.5 : 0.5 - outside[at] / 3;
      weights[at] = within(0.5 + (into * km) / blend, 0, 1);
    }
  }
  return { x0, y0, width, height, weights };
};

// The tint over the whole map on a date: { width, height, topLat, data }
// (RGBA, its alpha how strongly each pixel is tinted), or null for a date the
// calendar cannot read. `zones` as the world keeps them; `topLat` how far
// toward the poles the picture reaches, and `height` by default the rows that
// keep its pixels square.
export const seasonTintField = ({ zones = [], date = "", width = 512, topLat = MERCATOR_TOP_LAT, height = seasonTintHeight(width, topLat) } = {}) => {
  const parsed = parseGameDate(date);
  if (!parsed) return null;
  const grid = tintGrid(width, height, topLat);
  // The world's own, premultiplied, row by row: a hemisphere's tint, faded by the latitude.
  const north = worldTintAt(date, 45).rgb;
  const south = worldTintAt(date, -45).rgb;
  const worldRow = new Float32Array(height * 4);
  for (let row = 0; row < height; row += 1) {
    const lat = grid.rowLat[row];
    const strength = worldStrengthAt(lat);
    const rgb = lat < 0 ? south : north;
    worldRow.set([rgb[0] * strength, rgb[1] * strength, rgb[2] * strength, strength], row * 4);
  }
  const placed = [];
  for (const zone of normalizeClimateZones(zones)) {
    const weights = zoneWeightGrid(zone, grid);
    if (!weights) continue;
    // Its own seasons' tint, premultiplied, and how much of it is the world's own.
    const own = [0, 0, 0, 0];
    let worldShare = 0;
    for (const { weight, rgb } of zoneTints(zone, date)) {
      if (!rgb) {
        worldShare += weight;
        continue;
      }
      own[0] += weight * rgb[0];
      own[1] += weight * rgb[1];
      own[2] += weight * rgb[2];
      own[3] += weight;
    }
    placed.push({ ...weights, own, worldShare });
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const total = new Float32Array(width);
  const sum = new Float32Array(width * 4);
  const column = (x) => ((x % width) + width) % width;
  for (let row = 0; row < height; row += 1) {
    const world = worldRow.subarray(row * 4, row * 4 + 4);
    const live = placed.filter((zone) => row >= zone.y0 && row < zone.y0 + zone.height);
    total.fill(0);
    for (const zone of live) {
      const base = (row - zone.y0) * zone.width;
      for (let col = 0; col < zone.width; col += 1) {
        const weight = zone.weights[base + col];
        if (weight > 0) total[column(zone.x0 + col)] += weight;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const rest = 1 - Math.min(1, total[x]);
      for (let part = 0; part < 4; part += 1) sum[x * 4 + part] = rest * world[part];
    }
    for (const zone of live) {
      const tint = [0, 1, 2, 3].map((part) => zone.own[part] + zone.worldShare * world[part]);
      const base = (row - zone.y0) * zone.width;
      for (let col = 0; col < zone.width; col += 1) {
        const weight = zone.weights[base + col];
        if (!(weight > 0)) continue;
        const x = column(zone.x0 + col);
        // (Where zones overlap they share the place, adding to no more than all of it.)
        const share = weight / Math.max(1, total[x]);
        for (let part = 0; part < 4; part += 1) sum[x * 4 + part] += share * tint[part];
      }
    }
    for (let x = 0; x < width; x += 1) {
      const alpha = sum[x * 4 + 3];
      if (!(alpha > 0.002)) continue;
      const at = (row * width + x) * 4;
      data[at] = sum[x * 4] / alpha;
      data[at + 1] = sum[x * 4 + 1] / alpha;
      data[at + 2] = sum[x * 4 + 2] / alpha;
      data[at + 3] = Math.min(255, alpha * 255);
    }
  }
  return { width, height, topLat, data };
};

// The pixel of a tint picture a place falls on: { rgb, alpha (0 to 1) }.
export const tintPixelAt = (field, lng, lat) => {
  const grid = tintGrid(field.width, field.height, field.topLat);
  const x = ((Math.round(grid.toX(lng)) % field.width) + field.width) % field.width;
  const y = within(Math.round(grid.toY(lat)), 0, field.height - 1);
  const at = (y * field.width + x) * 4;
  return { rgb: [field.data[at], field.data[at + 1], field.data[at + 2]], alpha: field.data[at + 3] / 255 };
};
