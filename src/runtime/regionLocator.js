/*! Open Historia — which region a place is in, read from the regions' own shapes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The sheet of the whole map (fronts/worldGrid.js) knows whose a place is to a
// quarter of a degree, some 28 km: along a border that is as often the wrong
// side as the right one. Where it matters to the kilometre (a fortified line
// is built only on its own country's territory: runtime/warRoomChart.js,
// fronts/fortifyOps.js; the owner, 2026-10-14: "you should only be able to
// build fortifications on your own territory") the place is looked for in the
// regions' own shapes instead.
//
//   regionLocatorOf(regions, { water, flat }) => (lng, lat) => the id of the
//   region the place lies in, or "" where it lies in none (the sea, a lake,
//   a region of a type that is water)
//
//   regions   the map's regions as the engine reads them ([{ id, geometry, typeId }])
//   water     the ids of the region types that are water (regionTypes.js
//             waterTypeIds): a region of one is no land
//   flat      the map is a flat sheet: nothing goes round the world
//
// A hole in a shape is no part of it. Each shape is filed under the whole
// degrees its bounds cover, so a place is tried only against the few shapes
// filed where it is.
//
// Pure, and runs in bare node.

const BUCKET_DEG = 1;

// A longitude as the copy of it nearest `around`: 179 seen from -179 is -181.
const unwrapLng = (lng, around = 0) => lng - Math.round((lng - around) / 360) * 360;

const polygonsOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  return [];
};

// A polygon's rings, each point's longitude followed from the one before it
// (so that a shape drawn across the date line is one shape), and its bounds.
const shapeOf = (polygon, flat) => {
  if (!Array.isArray(polygon) || !Array.isArray(polygon[0]) || polygon[0].length < 3) return null;
  const around = Number(polygon[0][0]?.[0]) || 0;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  const rings = [];
  for (const ring of polygon) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const xs = [];
    const ys = [];
    let last = around;
    for (const point of ring) {
      const rawLng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(rawLng) || !Number.isFinite(lat)) continue;
      const lng = flat ? rawLng : unwrapLng(rawLng, last);
      last = lng;
      xs.push(lng);
      ys.push(lat);
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    if (xs.length >= 3) rings.push({ xs, ys });
  }
  return rings.length > 0 ? { rings, west, east, south, north, middle: (west + east) / 2 } : null;
};

// Whether a place is inside a shape: an odd number of its rings' edges lie
// to the east of it along its parallel.
const inside = (shape, lng, lat) => {
  let odd = false;
  for (const { xs, ys } of shape.rings) {
    for (let at = 0, before = xs.length - 1; at < xs.length; before = at, at += 1) {
      const yAt = ys[at];
      const yBefore = ys[before];
      if ((yAt > lat) === (yBefore > lat)) continue;
      const x = xs[at] + ((lat - yAt) * (xs[before] - xs[at])) / (yBefore - yAt);
      if (lng < x) odd = !odd;
    }
  }
  return odd;
};

export const regionLocatorOf = (regions, { water = null, flat = false } = {}) => {
  const wet = water && typeof water.has === "function" && water.size > 0 ? water : null;
  const buckets = new Map();
  // The whole degree a longitude is filed under: within one turn of the world, unless the map is flat.
  const column = (lng) => Math.floor((flat ? lng : unwrapLng(lng, 0)) / BUCKET_DEG);
  const row = (lat) => Math.floor(lat / BUCKET_DEG);
  for (const region of Array.isArray(regions) ? regions : []) {
    const id = String(region?.id ?? "").trim();
    if (!id) continue;
    if (wet && wet.has(String(region?.typeId ?? "").trim())) continue;
    for (const polygon of polygonsOf(region.geometry)) {
      const shape = shapeOf(polygon, flat);
      if (!shape) continue;
      const entry = { id, shape };
      const columns = new Set();
      // (A shape wider than the world is filed under every column once.)
      for (let lng = Math.floor(shape.west / BUCKET_DEG) * BUCKET_DEG; lng <= shape.east && columns.size < 360 / BUCKET_DEG; lng += BUCKET_DEG) columns.add(column(lng));
      for (let lat = row(shape.south); lat <= row(shape.north); lat += 1) {
        for (const col of columns) {
          const key = `${col}|${lat}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(entry);
        }
      }
    }
  }
  return (lng, lat) => {
    const x = Number(lng);
    const y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
    for (const { id, shape } of buckets.get(`${column(x)}|${row(y)}`) ?? []) {
      const at = flat ? x : unwrapLng(x, shape.middle);
      if (at < shape.west || at > shape.east || y < shape.south || y > shape.north) continue;
      if (inside(shape, at, y)) return id;
    }
    return "";
  };
};
