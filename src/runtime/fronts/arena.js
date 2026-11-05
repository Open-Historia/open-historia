/*! Open Historia — battlefields and fronts: the ground a frame lies on © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The arena is the part of a battlefield that never moves: which region lies
// under each cell of its frame, and how fast that ground is to cross. It is
// drawn once from the map's own shapes and kept for the session; nothing of it
// is saved, because the regions file can always draw it again.
//
//   arena {
//     key                 names this ground: a saved field made on another is rebuilt
//     frame, cols, rows, size
//     region              Uint16Array, a cell -> index into the lists below (0: none)
//     ids, names          the regions with a cell here; entry 0 is "no region"
//     indexOf             Map, a region's id -> its index
//     cells               how many cells of the frame each region has
//     area                each region's WHOLE area, in cells
//     outside             the part of that area the frame does not hold
//     speed               the ground's speed under each cell (0: impassable)
//     regionSpeed         the same, a region at a time
//     centreX, centreY    the middle of each region's cells, in cell units
//     cities              the map's cities inside the frame, in cell units
//   }
//
// A region is filled a scan line at a time from the edges that cross each row,
// never by asking of every cell which shape it is in: the stock world has
// regions of thousands of vertices and frames of tens of thousands of cells.
// The arena keeps no shape: the regions file is tens of megabytes, and a turn
// that only needs arenas it already has is run without reading it.

import { hashKey } from "./codec.js";
import { ICE_SPEED, TERRAIN_SPEED_MAX, TERRAIN_SPEED_MIN } from "./constants.js";
import { cellIndexAt, latToY, projectorOf } from "./frame.js";
import { isWaterType } from "../regionTypes.js";

const text = (value) => String(value ?? "").trim();

// The rings of a region's shape as lists of polygons, each a list of rings.
const polygonsOf = (geometry) => {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  if (geometry.type === "Polygon") return [coordinates];
  if (geometry.type === "MultiPolygon") return coordinates;
  return [];
};

// A ring's longitudes as one unbroken run, the copy of it nearest `middle`.
// A ring stored across the date line jumps from 179 to -179 between two
// neighbours: such a ring is first read as continuous, then the whole ring is
// moved by whole turns. Moving each vertex on its own would tear a wide
// country in two wherever one end of it is more than half a world from the frame.
const ringLongitudes = (ring, middle) => {
  const count = ring.length;
  const longitudes = new Float64Array(count);
  let west = Infinity;
  let east = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const lng = Number(ring[index]?.[0]) || 0;
    longitudes[index] = lng;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  if (east - west > 180) {
    let runWest = longitudes[0];
    let runEast = longitudes[0];
    const run = new Float64Array(count);
    run[0] = longitudes[0];
    for (let index = 1; index < count; index += 1) {
      const step = longitudes[index] - longitudes[index - 1];
      run[index] = run[index - 1] + step - Math.round(step / 360) * 360;
      if (run[index] < runWest) runWest = run[index];
      if (run[index] > runEast) runEast = run[index];
    }
    if (runEast - runWest < east - west) {
      longitudes.set(run);
      west = runWest;
      east = runEast;
    }
  }
  const turn = Math.round(((west + east) / 2 - middle) / 360) * 360;
  if (turn !== 0) for (let index = 0; index < count; index += 1) longitudes[index] -= turn;
  return longitudes;
};

// A region's rings in the frame's cell units: [[ring, ring], ...], each ring a
// flat list x0, y0, x1, y1, ... Its box too, to tell what the frame cuts.
export const projectRegion = (frame, region) => {
  const { lng0, cell, cols } = frame;
  const y0 = latToY(frame.lat0);
  const middle = lng0 + (cols * cell) / 2;
  const polygons = [];
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const polygon of polygonsOf(region?.geometry)) {
    const rings = [];
    for (const ring of Array.isArray(polygon) ? polygon : []) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const longitudes = ringLongitudes(ring, middle);
      const flat = new Float64Array(ring.length * 2);
      for (let index = 0; index < ring.length; index += 1) {
        const x = (longitudes[index] - lng0) / cell;
        const y = (latToY(ring[index]?.[1]) - y0) / cell;
        flat[index * 2] = x;
        flat[index * 2 + 1] = y;
        if (x < west) west = x;
        if (x > east) east = x;
        if (y < south) south = y;
        if (y > north) north = y;
      }
      rings.push(flat);
    }
    if (rings.length > 0) polygons.push(rings);
  }
  return { polygons, west, east, south, north };
};

// Whether a region's stated box can reach the frame at all, so the shapes of
// the rest of the world are never walked. A box across the date line has its
// east below its west.
const boxMayReach = (frame, bbox) => {
  if (!Array.isArray(bbox) || bbox.length < 4) return true;
  const west = Number(bbox[0]);
  let east = Number(bbox[2]);
  const south = Number(bbox[1]);
  const north = Number(bbox[3]);
  if (![west, east, south, north].every(Number.isFinite)) return true;
  if (east < west) east += 360;
  const y0 = latToY(frame.lat0);
  if ((latToY(north) - y0) / frame.cell < 0 || (latToY(south) - y0) / frame.cell > frame.rows) return false;
  const width = frame.cols * frame.cell;
  const middle = frame.lng0 + width / 2;
  const turn = Math.round(((west + east) / 2 - middle) / 360) * 360;
  return east - turn >= frame.lng0 && west - turn <= frame.lng0 + width;
};

// The area of a polygon's rings in cell units: the outer ring less its holes.
const areaOfRings = (rings) => {
  let total = 0;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const flat = rings[ringIndex];
    const count = flat.length / 2;
    let twice = 0;
    for (let index = 0; index < count; index += 1) {
      const next = index + 1 === count ? 0 : index + 1;
      twice += flat[index * 2] * flat[next * 2 + 1] - flat[next * 2] * flat[index * 2 + 1];
    }
    total += (ringIndex === 0 ? 1 : -1) * Math.abs(twice) / 2;
  }
  return Math.max(0, total);
};

// Fills one polygon into a grid of `width` by `height` samples laid `scale` to
// a cell from (originX, originY), giving `value` to every sample whose centre
// is inside it and that nothing has claimed yet. Every edge leaves a crossing
// on each scan line it passes; a line's crossings, in order, are where the
// shape begins and ends along it (holes included, by the even-odd rule).
export const fillPolygon = (rings, grid, width, height, originX, originY, scale, value) => {
  const lines = new Map();
  let lowest = height;
  let highest = -1;
  for (const flat of rings) {
    const count = flat.length / 2;
    for (let index = 0; index < count; index += 1) {
      const next = index + 1 === count ? 0 : index + 1;
      const fromX = (flat[index * 2] - originX) * scale;
      const fromY = (flat[index * 2 + 1] - originY) * scale;
      const toX = (flat[next * 2] - originX) * scale;
      const toY = (flat[next * 2 + 1] - originY) * scale;
      if (fromY === toY) continue;
      const low = fromY < toY ? fromY : toY;
      const high = fromY < toY ? toY : fromY;
      const first = Math.max(0, Math.ceil(low - 0.5));
      const last = Math.min(height - 1, Math.ceil(high - 0.5) - 1);
      const slope = (toX - fromX) / (toY - fromY);
      for (let line = first; line <= last; line += 1) {
        let crossings = lines.get(line);
        if (!crossings) {
          crossings = [];
          lines.set(line, crossings);
          if (line < lowest) lowest = line;
          if (line > highest) highest = line;
        }
        crossings.push(fromX + (line + 0.5 - fromY) * slope);
      }
    }
  }
  let filled = 0;
  for (let line = lowest; line <= highest; line += 1) {
    const crossings = lines.get(line);
    if (!crossings || crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    const base = line * width;
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const first = Math.max(0, Math.ceil(crossings[pair] - 0.5));
      const last = Math.min(width - 1, Math.ceil(crossings[pair + 1] - 0.5) - 1);
      for (let sample = first; sample <= last; sample += 1) {
        if (grid[base + sample] !== 0) continue;
        grid[base + sample] = value;
        filled += 1;
      }
    }
  }
  return filled;
};

// A region type's speed as the engine reads it: the Workshop's Pathfinding
// Speed held to a range a front can live with, and nothing at all for ground
// no unit may enter. Water is such ground: a sea drawn as regions is crossed
// aboard a transporter and by nothing on foot.
const speedOfType = (type) => {
  if (!type) return 1;
  const speed = Number(type.pathfindingSpeed);
  if (type.passable === false || speed === 0 || isWaterType(type)) return 0;
  if (!Number.isFinite(speed)) return 1;
  return Math.min(TERRAIN_SPEED_MAX, Math.max(TERRAIN_SPEED_MIN, speed));
};

// The map's cities that stand inside a frame, in its cell units, in the order
// the map lists them.
export const citiesInFrame = (frame, cities) => {
  const { toCell } = projectorOf(frame);
  const placed = [];
  for (const city of Array.isArray(cities) ? cities : []) {
    const name = text(city?.name);
    const lng = Number(city?.lng);
    const lat = Number(city?.lat);
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const [x, y] = toCell(lng, lat);
    const cell = cellIndexAt(frame, x, y);
    if (cell < 0) continue;
    placed.push({ name, x, y, cell, population: Math.max(0, Number(city.population) || 0), capital: city.capital === true });
  }
  return placed;
};

// Ground a scenario made harder to cross (map.terrain = { key, areas }:
// runtime/warGeography.js terrainAreas; mechanics.js "terrain"): each area's
// level, 1 to 10, the highest where areas overlap, cell by cell. null for none.
const terrainLevels = (frame, terrain) => {
  const areas = (Array.isArray(terrain?.areas) ? terrain.areas : []).filter((area) => Number(area?.level) > 0 && Array.isArray(area.rings)).sort((a, b) => b.level - a.level);
  if (areas.length === 0) return null;
  const { cols, rows } = frame;
  const levels = new Uint8Array(cols * rows);
  let filled = 0;
  for (const area of areas) {
    const shape = projectRegion(frame, { geometry: { type: "Polygon", coordinates: area.rings } });
    if (shape.polygons.length === 0 || shape.east < 0 || shape.west > cols || shape.north < 0 || shape.south > rows) continue;
    for (const rings of shape.polygons) filled += fillPolygon(rings, levels, cols, rows, 0, 0, 1, Math.min(10, Math.round(area.level)));
  }
  return filled > 0 ? levels : null;
};

export const rasterizeArena = (frame, regions, { regionTypes = [], cities = [], terrain = null, frozen = null } = {}) => {
  const { cols, rows } = frame;
  const size = cols * rows;
  const speedByType = new Map();
  for (const type of Array.isArray(regionTypes) ? regionTypes : []) {
    const id = text(type?.id);
    if (id && !speedByType.has(id)) speedByType.set(id, speedOfType(type));
  }

  const region = new Uint16Array(size);
  const ids = [""];
  const names = [""];
  const indexOf = new Map();
  const cells = [0];
  const area = [0];
  const outside = [0];
  const regionSpeed = [0];

  for (const source of Array.isArray(regions) ? regions : []) {
    const id = text(source?.id);
    if (!id || indexOf.has(id) || ids.length > 65535 || !boxMayReach(frame, source.bbox)) continue;
    const shape = projectRegion(frame, source);
    if (shape.polygons.length === 0 || shape.east < 0 || shape.west > cols || shape.north < 0 || shape.south > rows) continue;
    const value = ids.length;
    let filled = 0;
    let whole = 0;
    for (const rings of shape.polygons) {
      filled += fillPolygon(rings, region, cols, rows, 0, 0, 1, value);
      whole += areaOfRings(rings);
    }
    if (filled === 0) continue;
    const cut = shape.west < 0 || shape.south < 0 || shape.east > cols || shape.north > rows;
    indexOf.set(id, value);
    ids.push(id);
    names.push(text(source.name) || id);
    cells.push(filled);
    // A region the frame cuts keeps the rest of itself on the books; one that is
    // whole inside it is exactly its cells, whatever its outline rounds to.
    area.push(cut ? Math.max(whole, filled) : filled);
    outside.push(cut ? Math.max(0, whole - filled) : 0);
    const typeId = text(source.typeId);
    regionSpeed.push(speedByType.has(typeId) ? speedByType.get(typeId) : 1);
  }

  const count = ids.length;
  const speed = new Float32Array(size);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  // Ground a scenario made harder to cross: its speed scaled by (10 - level) / 10, so that level 10
  // is a wall. A cell made impassable is no part of its region any more (it can never be held, and a
  // region is taken by what of it can be), but a city's cell keeps a way in.
  const levels = terrainLevels(frame, terrain);
  const placed = citiesInFrame(frame, cities);
  const cityCells = levels ? new Set(placed.map((city) => city.cell)) : null;
  // Water a scenario lets freeze, frozen this turn (`frozen`, a list of its region ids: climate.js): ground
  // troops may cross, slowly; whose it is, cell by cell, is the side whose ground is nearest (battle.js iceSides).
  const frozenIds = Array.isArray(frozen) && frozen.length > 0 ? new Set(frozen) : null;
  const iced = frozenIds ? new Uint8Array(size) : null;
  let icy = 0;
  let rough = 0;
  let fingerprint = 0;
  for (let index = 0; index < size; index += 1) {
    let value = region[index];
    let level = levels && value !== 0 ? levels[index] : 0;
    if (level >= 10 && cityCells.has(index)) level = 9;
    if (level >= 10 && regionSpeed[value] > 0) {
      cells[value] -= 1;
      area[value] -= 1;
      region[index] = 0;
      value = 0;
    }
    if (level > 0) rough = Math.imul(rough ^ (index * 16 + level), 2246822507) + 1;
    fingerprint = Math.imul(fingerprint ^ value, 2246822507) + index;
    fingerprint = (fingerprint << 13) | (fingerprint >>> 19);
    if (value === 0) continue;
    if (iced && regionSpeed[value] === 0 && frozenIds.has(ids[value])) {
      iced[index] = 1;
      icy = Math.imul(icy ^ index, 2246822507) + 7;
      speed[index] = ICE_SPEED;
      sumX[value] += (index % cols) + 0.5;
      sumY[value] += Math.floor(index / cols) + 0.5;
      continue;
    }
    speed[index] = level > 0 ? (regionSpeed[value] * (10 - level)) / 10 : regionSpeed[value];
    sumX[value] += (index % cols) + 0.5;
    sumY[value] += Math.floor(index / cols) + 0.5;
  }
  const centreX = new Float64Array(count);
  const centreY = new Float64Array(count);
  for (let value = 1; value < count; value += 1) {
    centreX[value] = cells[value] > 0 ? sumX[value] / cells[value] : 0;
    centreY[value] = cells[value] > 0 ? sumY[value] / cells[value] : 0;
  }

  return {
    // (Its rough ground is in the key only where there is some: an arena without any is the one it always was.)
    key: hashKey([cols, rows, fingerprint >>> 0, ids.join("\u0002"), regionSpeed.join(","), ...(levels ? [rough >>> 0] : []), ...(icy !== 0 ? [`ice${icy >>> 0}`] : [])]),
    // The cells of frozen water (1), where any water is frozen this turn.
    iced: icy !== 0 ? iced : null,
    frame,
    cols,
    rows,
    size,
    region,
    ids,
    names,
    indexOf,
    cells: Int32Array.from(cells),
    area: Float64Array.from(area),
    outside: Float64Array.from(outside),
    speed,
    regionSpeed: Float64Array.from(regionSpeed),
    centreX,
    centreY,
    cities: placed,
  };
};

// The region under each of `scale` by `scale` samples a cell, for the cells of
// a box { col0, row0, col1, row1 } (inclusive): what places a new line to a
// fraction of a cell. Drawn from the map's shapes again, in the arena's own
// order, and only for the regions `wanted(regionIndex)` picks.
export const sampleRegions = (arena, regions, box, scale, wanted) => {
  const width = (box.col1 - box.col0 + 1) * scale;
  const height = (box.row1 - box.row0 + 1) * scale;
  const grid = new Uint16Array(Math.max(0, width * height));
  const drawn = new Uint8Array(arena.ids.length);
  for (const source of Array.isArray(regions) ? regions : []) {
    const value = arena.indexOf.get(text(source?.id)) ?? 0;
    if (value === 0 || drawn[value] || !wanted(value)) continue;
    drawn[value] = 1;
    const shape = projectRegion(arena.frame, source);
    if (shape.east < box.col0 || shape.west > box.col1 + 1 || shape.north < box.row0 || shape.south > box.row1 + 1) continue;
    for (const rings of shape.polygons) fillPolygon(rings, grid, width, height, box.col0, box.row0, scale, value);
  }
  return { grid, width, height, scale };
};

// What names one frame on one map, for the caller's cache of arenas.
const cacheKey = (map, frame, regionTypes) => [
  text(map?.key),
  frame.lng0,
  frame.lat0,
  frame.cell,
  frame.cols,
  frame.rows,
  frame.flat ? frame.scale : "",
  hashKey((Array.isArray(regionTypes) ? regionTypes : []).map((type) => `${text(type?.id)}:${speedOfType(type)}`)),
  // (And its rough ground, where the scenario drew some: runtime/warGeography.js terrainAreas; and its frozen water.)
  text(map?.terrain?.key),
  Array.isArray(map?.frozen) && map.frozen.length > 0 ? hashKey(map.frozen.slice().sort()) : "",
].join("|");

// The arena of a frame, drawn once: `cache` is the Map the caller keeps
// between runs. A map with no key is drawn afresh each time, since nothing
// says it is the same map. null when it is not in the cache and the map came
// without its shapes: the caller then asks for them, and never guesses.
export const arenaFor = (cache, map, frame, regionTypes) => {
  const key = text(map?.key) && cache instanceof Map ? cacheKey(map, frame, regionTypes) : "";
  const known = key ? cache.get(key) : null;
  if (known) return known;
  if (!Array.isArray(map?.regions)) return null;
  const arena = rasterizeArena(frame, map.regions, { regionTypes, cities: map.cities, terrain: map.terrain ?? null, frozen: map.frozen ?? null });
  if (key) cache.set(key, arena);
  return arena;
};
