/*! Open Historia — the world's towns, for a place the map does not carry © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario's map carries the cities its author put on it: the built-in one
// has 2,527. A model writing a time skip knows many more and places things at
// them. A real skip (2026-10-05) opened a depot at "Grand Forks, North Dakota";
// that map has no Grand Forks, and the depot was not built.
//
// The game ships a list that does have it: public/assets/cities-seed.json,
// seventy thousand of the world's towns, each
// { name, coord: [lng, lat], population, capital, tags }. The editor imports
// cities from it (citiesImport.js) and the prompt takes the capitals from it
// (promptContext.js).
//
// It is 7.9 MB, on phones that have run out of memory before. So:
//   - it is read only when it is asked for (gameplay.js asks when a placement
//     phrase has named a place its map does not carry), at most once a session;
//   - it is never parsed whole. Parsed in one go it is, for a moment, the
//     bytes, the same text as fifteen megabytes of string and nineteen of
//     objects, all at once. It is walked one entry at a time instead
//     (eachWorldCity), so the most that is ever held is the bytes and the
//     index being built: about half the memory, for half as long again;
//   - what is kept is where the towns of each name stand and nothing else
//     about them: three and a half megabytes.
// (All measured under node, on the list as shipped.)
//
// WHICH town a name means is not decided here. The list has sixteen
// Springfields and no country on any of them; placement.js takes a town only
// when the map itself says which one it must be.
//
// Imports only the name folding and the distance, so it runs under bare node.

import { distanceKm } from "./placement.js";
import { foldRegionKey, foldRegionKeyOnce } from "./regionMatch.js";

// Where the prompt's city catalog reads it from (promptContext.js
// CITY_SEED_URL): the content node on web builds, same-origin /assets
// otherwise. import.meta.env is Vite's; the optional chain keeps this module
// importable under bare node.
const WORLD_CITIES_URL = `${(import.meta.env?.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "")}/cities-seed.json`;

// One town is on the list up to four times. The list was swept from map tiles
// at four zoom levels (scripts/extract-cities.mjs), and each level rounds a
// point to its own grid: Grand Forks is there twice, a kilometre apart, and
// Kharkiv three times. Counted as written, the only Grand Forks in the world
// would be two towns of one name, and a name two towns share is never placed.
//
// Entries of one name and one population this close together are one town.
// Two readings of one point are never more than seven kilometres apart (half
// a step of the coarsest grid each way, at the equator), and on the list as
// shipped no two entries of one name and population stand between seven and
// ten. The later entry's point is kept: the sweep goes from the coarsest tiles
// to the finest.
//
// Two towns of one name that really are this close have different populations
// (Niagara Falls either side of its river, Nogales either side of its border)
// and stay two.
export const SAME_TOWN_KM = 8;

// The list as it is kept, built an entry at a time: `find(name)` gives where
// each town of that name stands, as [lng, lat], and [] for a name the list
// does not have. Names are folded as the map's own are (regionMatch.js), and a
// name is found only as the list spells it: no near misses, because the caller
// is deciding where to put something.
//
// Packed, because seventy thousand small arrays cost more than the numbers in
// them: one run of 32-bit floats (about a metre) holds every point, the towns
// of one name side by side; `firstOf` says where a name's run begins and
// `counts`, at that place, how many towns are in it.
const createWorldCityIndex = () => {
  // Folded name -> its towns so far, three numbers each: lng, lat, population.
  const byName = new Map();
  const add = (city) => {
    const [lng, lat] = Array.isArray(city?.coord) ? city.coord : [];
    // Some entries have no point; and (0, 0) is no town.
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90 || (lng === 0 && lat === 0)) return;
    const key = foldRegionKeyOnce(city.name);
    if (!key) return;
    const population = Number(city.population) || 0;
    const towns = byName.get(key);
    if (!towns) {
      byName.set(key, [lng, lat, population]);
      return;
    }
    let same = -1;
    for (let at = 0; at < towns.length && same < 0; at += 3) {
      if (towns[at + 2] === population && distanceKm([towns[at], towns[at + 1]], [lng, lat]) <= SAME_TOWN_KM) same = at;
    }
    if (same < 0) towns.push(lng, lat, population);
    else {
      towns[same] = lng;
      towns[same + 1] = lat;
    }
  };
  const finish = () => {
    let total = 0;
    for (const towns of byName.values()) total += towns.length / 3;
    const points = new Float32Array(total * 2);
    const counts = new Uint8Array(total);
    const firstOf = new Map();
    let next = 0;
    for (const [key, towns] of byName) {
      firstOf.set(key, next);
      // Never fewer than there are, short of 255: one town must mean one.
      counts[next] = Math.min(255, towns.length / 3);
      for (let at = 0; at < towns.length; at += 3) {
        points[next * 2] = towns[at];
        points[next * 2 + 1] = towns[at + 1];
        next += 1;
      }
    }
    byName.clear();
    return {
      names: firstOf.size,
      towns: total,
      find: (name) => {
        const first = firstOf.get(foldRegionKey(name));
        if (first === undefined) return [];
        return Array.from({ length: counts[first] }, (_unused, index) => [points[(first + index) * 2], points[(first + index) * 2 + 1]]);
      },
    };
  };
  return { add, finish };
};

// From the list already parsed (a test's, or a caller that has it anyway).
export const indexWorldCities = (seed) => {
  const index = createWorldCityIndex();
  for (const city of Array.isArray(seed) ? seed : []) index.add(city);
  return index.finish();
};

// The file's entries, one at a time, from its bytes. Only brackets and strings
// have to be followed to find where an entry starts and ends, and UTF-8 never
// spells a bracket, a quote or a backslash inside a longer character, so the
// bytes are read as they are. Each entry is then JSON.parse's to judge, and an
// entry that is not well-formed throws there. What is not a list (the app's
// own page, served where the file is missing) has no entries. A list that
// stops before it closes throws: half a list would make the one Springfield it
// reached look like the only one.
const QUOTE = 34; // "
const BACKSLASH = 92;
const OPEN_SQUARE = 91;
const CLOSE_SQUARE = 93;
const OPEN_CURLY = 123;
const CLOSE_CURLY = 125;
export const eachWorldCity = (bytes, visit) => {
  const decoder = new TextDecoder();
  let depth = 0; // 1 inside the list, 2 inside an entry
  let quoted = false;
  let escaped = false;
  let from = -1;
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === BACKSLASH) escaped = true;
      else if (byte === QUOTE) quoted = false;
    } else if (byte === QUOTE) quoted = true;
    else if (byte === OPEN_SQUARE || byte === OPEN_CURLY) {
      if (depth === 0 && byte !== OPEN_SQUARE) return;
      depth += 1;
      if (depth === 2) from = at;
    } else if (byte === CLOSE_SQUARE || byte === CLOSE_CURLY) {
      depth -= 1;
      if (depth === 1) visit(JSON.parse(decoder.decode(bytes.subarray(from, at + 1))));
    }
  }
  if (depth !== 0 || quoted) throw new Error("the list stops before it closes");
};

export const indexWorldCityBytes = (bytes) => {
  const index = createWorldCityIndex();
  eachWorldCity(bytes, index.add);
  return index.finish();
};

let index = null;
let reading = null;

// The index, or null when the list could not be read. Only a list that arrived
// is kept: a failure (offline for a moment, an error status, the app's own
// page served with 200 where the file is missing) is asked for again by the
// next caller. Callers that ask at once share one download.
export const loadWorldCities = () => {
  if (index) return Promise.resolve(index);
  reading ??= (async () => {
    try {
      const response = await fetch(WORLD_CITIES_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const built = indexWorldCityBytes(new Uint8Array(await response.arrayBuffer()));
      if (!built.towns) throw new Error("not a list of cities");
      index = built;
    } catch (error) {
      console.warn("[placement] the world city list could not be read; a place this map does not carry stays unplaced.", error);
    }
    return index;
  })().finally(() => {
    reading = null;
  });
  return reading;
};
