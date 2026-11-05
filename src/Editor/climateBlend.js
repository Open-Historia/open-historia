/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The climate zones as the Workshop paints them: each zone's colour fading
// into its neighbours' across its blend width, worked out one cell at a time.
//
// A zone's weight at a spot is 0.5 + (how far inside its edge the spot is, in
// km) / (its blend width), held between 0 and 1: 1 deep inside, a half on the
// edge itself, nothing half a blend width outside. The colour is the mix of
// every zone by weight, and the paint's strength follows the weights too, so
// two zones that meet blend evenly into each other and a zone with nothing
// beside it fades out into the plain map.
//
// No canvas and no OpenLayers here: planar coordinates in, RGBA bytes out, so
// node can test it. warGeographyLayers.js hands it the map's Web Mercator
// plane and puts the bytes on the map; the browser's own scaling of the small
// picture to the screen smooths it. Pure; tested in climateBlend.test.js.

import { curvedRings } from "../runtime/fronts/climate.js";

// How strongly a zone holds a spot `signedKm` inside its edge (negative:
// outside), for a zone that blends over `blendKm`. A zone with no blend width
// has a hard edge.
export const blendWeight = (signedKm, blendKm) => {
  if (!(blendKm > 0)) return signedKm >= 0 ? 1 : 0;
  const weight = 0.5 + signedKm / blendKm;
  return weight < 0 ? 0 : weight > 1 ? 1 : weight;
};

const hexRgb = (value) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return [127, 140, 153];
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Each zone ready to paint: its colour, its blend width, its edges as a flat
// run of [ax, ay, bx, by] in the plane `project` takes a [lng, lat] point to,
// and the box around them. A ring is closed whether or not its last point
// repeats its first. A zone with no edge is left out.
export const prepareClimateZones = (zones, project = (point) => point) => (Array.isArray(zones) ? zones : []).map((zone) => {
  const coords = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // (Its outline rounded off, as the game reads it: runtime/fronts/climate.js curvedRings.)
  for (const ring of curvedRings(zone)) {
    const points = ring.map(project);
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a[0] < minX) minX = a[0];
      if (a[0] > maxX) maxX = a[0];
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      coords.push(a[0], a[1], b[0], b[1]);
    }
  }
  if (!coords.length) return null;
  const blendKm = Number(zone?.blendKm);
  return { rgb: hexRgb(zone?.color), blendKm: Number.isFinite(blendKm) && blendKm > 0 ? blendKm : 0, edges: Float64Array.from(coords), minX, minY, maxX, maxY };
}).filter(Boolean);

// How far (x, y) is from the nearest edge, in the plane's units: positive
// inside the zone, negative outside. Inside is by the even-odd rule, so a ring
// inside the outer one is a hole.
export const signedDistance = (edges, x, y) => {
  let inside = false;
  let nearest = Infinity;
  for (let i = 0; i < edges.length; i += 4) {
    const ax = edges[i];
    const ay = edges[i + 1];
    const bx = edges[i + 2];
    const by = edges[i + 3];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    let t = length > 0 ? ((x - ax) * dx + (y - ay) * dy) / length : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x;
    const ey = ay + t * dy - y;
    const squared = ex * ex + ey * ey;
    if (squared < nearest) nearest = squared;
  }
  const distance = Math.sqrt(nearest);
  return inside ? distance : -distance;
};

// Kilometres to a unit of the Web Mercator plane at height y: the plane
// stretches by 1 / cos(latitude), and cos(latitude) is 1 / cosh(y / R).
const EARTH = 6378137;
export const mercatorKmPerUnit = (y) => 1 / (1000 * Math.cosh(y / EARTH));

// The picture: `cols` by `rows` cells, each `cell` units square, the first
// cell's top-left corner at (x0, y0) with y growing upwards as on the map.
// Returns RGBA bytes, row by row from the top. `kmPerUnit(y)` turns the
// plane's units into km at a height (mercatorKmPerUnit for the map); `alpha`
// is the paint's strength where the zones' weights add up to 1 or more.
export const paintClimateBlend = ({ zones, cols, rows, x0, y0, cell, kmPerUnit = () => 1, alpha = 0.35 }) => {
  const out = new Uint8ClampedArray(cols * rows * 4);
  const active = new Array(zones.length);
  const reach = new Float64Array(zones.length);
  for (let row = 0; row < rows; row += 1) {
    const y = y0 - (row + 0.5) * cell;
    const scale = kmPerUnit(y);
    // The zones this row can reach: a zone holds nothing further than half its
    // blend width outside its edges.
    let count = 0;
    for (const zone of zones) {
      const pad = zone.blendKm > 0 ? zone.blendKm / 2 / scale : 0;
      if (y < zone.minY - pad || y > zone.maxY + pad) continue;
      active[count] = zone;
      reach[count] = pad;
      count += 1;
    }
    if (count === 0) continue;
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + (col + 0.5) * cell;
      let total = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let k = 0; k < count; k += 1) {
        const zone = active[k];
        if (x < zone.minX - reach[k] || x > zone.maxX + reach[k]) continue;
        const weight = blendWeight(signedDistance(zone.edges, x, y) * scale, zone.blendKm);
        if (weight <= 0) continue;
        total += weight;
        red += weight * zone.rgb[0];
        green += weight * zone.rgb[1];
        blue += weight * zone.rgb[2];
      }
      if (total <= 0) continue;
      const at = (row * cols + col) * 4;
      out[at] = red / total;
      out[at + 1] = green / total;
      out[at + 2] = blue / total;
      out[at + 3] = 255 * alpha * (total < 1 ? total : 1);
    }
  }
  return out;
};

// How many screen pixels one cell of the picture covers. Each cell measures
// its distance to every edge of every zone near it, so the more edges the
// zones have, the bigger the cells: a picture costs about `budget` edge
// measurements, never cells finer than 4 pixels or coarser than 48.
export const blendCellPixels = (edgeCount, pixels, budget = 2.5e7) => {
  const cells = budget / Math.max(1, edgeCount);
  return Math.max(4, Math.min(48, Math.ceil(Math.sqrt(Math.max(1, pixels) / cells))));
};
