/*! Open Historia — a battlefield's ground as the map draws it: which regions, and their mesh © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While a battlefield is on the map its sides' regions in its frame are drawn
// by the battlefield's own layer (frontGroundLayer.js), not by the map's fills:
// each region in its owner's colour, and over it, where the battlefield's
// picture is painted, the colour of whoever holds that ground. These are the
// pure parts the political cartography worker answers with
// (polityBoundariesWorker.js "battlefield-ground"): which regions each
// battlefield draws, and those regions cut into triangles on the map's flat
// sheet. Loads in plain Node.

import earcut from "earcut";

const TWO_PI = Math.PI * 2;
const clean = (value) => String(value ?? "").trim().toLowerCase();

const polygonsOf = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

// A region's box: [west, south, east, north].
export const regionBox = (geometry) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon ?? []) {
      for (const point of ring ?? []) {
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
  return Number.isFinite(west) ? [west, south, east, north] : null;
};

// Whether two boxes meet; the second's longitudes may be a whole turn off.
const boxesMeet = (box, bounds) => {
  if (!box || box[1] > bounds[3] || box[3] < bounds[1]) return false;
  return [0, -360, 360].some((shift) => box[0] + shift <= bounds[2] && box[2] + shift >= bounds[0]);
};

// The regions each battlefield draws: those of its sides' members (by whose
// they are now: `ownerOf(id)`) that reach into its frame. `areas` are
// [{ key, bounds: [west, south, east, north], members: [names] }]; `regions`
// are [{ id, geometry }] (or a FeatureCollection's features). A region two
// battlefields reach is drawn by the first only.
export const regionsInAreas = ({ regions = [], areas = [], ownerOf = () => "", boxOf = null } = {}) => {
  const taken = new Set();
  const box = typeof boxOf === "function" ? boxOf : (region) => regionBox(region.geometry);
  return areas.map((area) => {
    const bounds = Array.isArray(area?.bounds) ? area.bounds.map(Number) : [];
    const members = new Set((area?.members ?? []).map(clean).filter(Boolean));
    const regionIds = [];
    if (bounds.length === 4 && bounds.every(Number.isFinite) && members.size) {
      for (const region of regions) {
        const id = String(region?.id ?? region?.properties?.id ?? "");
        if (!id || taken.has(id)) continue;
        if (!members.has(clean(ownerOf(id)))) continue;
        if (!boxesMeet(box(region), bounds)) continue;
        taken.add(id);
        regionIds.push(id);
      }
    }
    return { key: String(area?.key ?? ""), regionIds };
  });
};

export const mercatorX = (lng) => (lng + 180) / 360;
export const mercatorY = (lat) => {
  const held = Math.max(-85.05, Math.min(85.05, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (held * Math.PI) / 360)) / TWO_PI;
};
// A longitude moved by whole turns to lie nearest `anchor`.
const near = (lng, anchor) => lng + 360 * Math.round((anchor - lng) / 360);

// On a globe a triangle is drawn flat, a chord under the curve, and a long one
// would sink away from the map's own shapes beside it: none is left longer than
// this on the flat sheet (about a degree) or split more than this many times.
export const GROUND_MESH_LONGEST = 1 / 360;
const MOST_SPLITS = 6;

const putTriangle = (out, regionOf, regionIndex, ax, ay, bx, by, cx, cy, longest, depth) => {
  const ab = (bx - ax) ** 2 + (by - ay) ** 2;
  const bc = (cx - bx) ** 2 + (cy - by) ** 2;
  const ca = (ax - cx) ** 2 + (ay - cy) ** 2;
  if (depth < MOST_SPLITS && Math.max(ab, bc, ca) > longest * longest) {
    const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
    const [nx, ny] = [(bx + cx) / 2, (by + cy) / 2];
    const [ox, oy] = [(cx + ax) / 2, (cy + ay) / 2];
    putTriangle(out, regionOf, regionIndex, ax, ay, mx, my, ox, oy, longest, depth + 1);
    putTriangle(out, regionOf, regionIndex, mx, my, bx, by, nx, ny, longest, depth + 1);
    putTriangle(out, regionOf, regionIndex, ox, oy, nx, ny, cx, cy, longest, depth + 1);
    putTriangle(out, regionOf, regionIndex, mx, my, nx, ny, ox, oy, longest, depth + 1);
    return;
  }
  out.push(ax, ay, bx, by, cx, cy);
  regionOf.push(regionIndex, regionIndex, regionIndex);
};

// The regions cut into triangles on the map's flat sheet, near `anchorLng` (the
// battlefield's middle, so a region across the date line is one piece):
// `positions` two numbers a corner, three corners a triangle; `regionOf` the
// region (its place in `regionIds`) each corner belongs to.
export const groundMesh = ({ regions = [], regionIds = [], anchorLng = 0, longest = GROUND_MESH_LONGEST } = {}) => {
  const byId = new Map(regions.map((region) => [String(region?.id ?? region?.properties?.id ?? ""), region]));
  const positions = [];
  const regionOf = [];
  regionIds.forEach((id, regionIndex) => {
    const region = byId.get(String(id));
    for (const polygon of polygonsOf(region?.geometry)) {
      const flat = [];
      const holes = [];
      for (const ring of polygon ?? []) {
        const points = (ring ?? []).filter((point) => Number.isFinite(Number(point?.[0])) && Number.isFinite(Number(point?.[1])));
        // A closed ring's last point is its first: earcut wants it once.
        const open = points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1] ? points.slice(0, -1) : points;
        if (open.length < 3) continue;
        if (flat.length) holes.push(flat.length / 2);
        for (const point of open) flat.push(mercatorX(near(Number(point[0]), anchorLng)), mercatorY(Number(point[1])));
      }
      if (flat.length < 6) continue;
      const triangles = earcut(flat, holes.length ? holes : undefined, 2);
      for (let at = 0; at < triangles.length; at += 3) {
        const [a, b, c] = [triangles[at] * 2, triangles[at + 1] * 2, triangles[at + 2] * 2];
        putTriangle(positions, regionOf, regionIndex, flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1], longest, 0);
      }
    }
  });
  return { positions: new Float32Array(positions), regionOf: new Float32Array(regionOf) };
};
