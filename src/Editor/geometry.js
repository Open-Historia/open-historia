/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Geometry operations for the editor, working directly on OpenLayers geometries
// in the map's EPSG:3857 projection via polygon-clipping (union / difference).
// No reprojection round-trips: OL Polygon/MultiPolygon coordinate arrays are the
// same shape polygon-clipping expects (Polygon = [ring...], MultiPolygon =
// [[ring...]...]).

import polygonClipping from "polygon-clipping";
import Polygon from "ol/geom/Polygon.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import { BORDER_CLEANUP } from "./topologySweep.js";

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
};
const polyArea = (poly) => ringArea(poly[0]) - poly.slice(1).reduce((s, r) => s + ringArea(r), 0);

const olToCoords = (g) => g.getCoordinates(); // Polygon or MultiPolygon coordinate array
const coordsToOl = (mp) => (mp.length === 1 ? new Polygon(mp[0]) : new MultiPolygon(mp));

// Union of N OpenLayers polygon geometries into a single OL geometry.
export const unionGeoms = (geoms) => {
  const inputs = geoms.map(olToCoords);
  const res = polygonClipping.union(inputs[0], ...inputs.slice(1));
  return coordsToOl(res);
};

// `target` minus `cutter`. Returns:
//   - an OL geometry for what survives,
//   - null when the cutter swallows the target whole (caller deletes it),
//   - the target unchanged when they don't actually overlap.
//
// A region drawn inside another must take that land OUT of the one beneath it,
// or the two overlap: the map then has one place owned twice, whichever renders
// last wins, and the exported ownership map disagrees with what the author sees.
// difference() also handles the interesting case for free — a region drawn in the
// middle of another leaves a hole (an interior ring) rather than a bitten edge.
//
// Only the part of the cutter inside the target's own box can take anything
// out of it, so that is all polygon-clipping is handed (see "Keeping the work
// local" below).
export const subtractFrom = (target, cutter) => {
  const cut = clipCoordsToBox(cutter, paddedExtent(target));
  if (!cut) return target.clone();
  const res = polygonClipping.difference(olToCoords(target), cut);
  if (!res || res.length === 0) return null;
  return coordsToOl(res);
};

// Do these two geometries share any area at all? Cheap-ish guard so drawing a
// region only rewrites the neighbours it genuinely overlaps, instead of running a
// difference against every region on the map and marking them all edited.
export const overlaps = (a, b) => Boolean(intersectionCoords(a, b));

// Translate an OL geometry by (dx, dy) in map units — used for copy/paste offset.
export const translatedClone = (olGeom, dx, dy) => {
  const g = olGeom.clone();
  g.translate(dx, dy);
  return g;
};


// ---------------------------------------------------------------------------
// Scenario Workshop topology helpers
// ---------------------------------------------------------------------------

const asMultiPolygonCoords = (geom) => {
  if (!geom) return [];
  const type = geom.getType?.();
  const coords = geom.getCoordinates?.();
  if (!coords) return [];
  return type === "Polygon" ? [coords] : type === "MultiPolygon" ? coords : [];
};

const ringPerimeter = (ring) => {
  let length = 0;
  for (let i = 1; i < (ring?.length || 0); i += 1) {
    const a = ring[i - 1];
    const b = ring[i];
    length += Math.hypot((b?.[0] || 0) - (a?.[0] || 0), (b?.[1] || 0) - (a?.[1] || 0));
  }
  return length;
};

export const planarGeometryArea = (geom) =>
  asMultiPolygonCoords(geom).reduce(
    (sum, poly) => sum + Math.max(0, polyArea(poly)),
    0,
  );

// ---------------------------------------------------------------------------
// Keeping the work local.
//
// polygon-clipping sweeps every segment of both inputs wherever they lie, so an
// intersection or a difference against a large region costs as much as that
// region: a coastal province checked against a 40,000-vertex sea zone takes as
// long as a union of a continent, and the save-time border cleanup asks that
// question once per neighbouring pair, thousands of times a pass. Yet what two
// regions share can only lie inside the box both their extents cover, and what
// a cutter takes out of a target only inside the target's box. So both inputs
// are first clipped to that box — Sutherland–Hodgman against an axis-aligned
// rectangle, one linear pass per side and no sweep — which leaves the answer
// exactly as it was and makes the cost that of the neighbourhood, not of the
// region. The box is padded by a metre so no clip edge lies on the other input.

const CLIP_MARGIN = 1;

const paddedExtent = (geom) => {
  const [minX, minY, maxX, maxY] = geom.getExtent();
  return [minX - CLIP_MARGIN, minY - CLIP_MARGIN, maxX + CLIP_MARGIN, maxY + CLIP_MARGIN];
};

// The box both extents cover, padded; null when they are apart.
const sharedBox = (a, b) => {
  const ea = a.getExtent();
  const eb = b.getExtent();
  const box = [
    Math.max(ea[0], eb[0]) - CLIP_MARGIN,
    Math.max(ea[1], eb[1]) - CLIP_MARGIN,
    Math.min(ea[2], eb[2]) + CLIP_MARGIN,
    Math.min(ea[3], eb[3]) + CLIP_MARGIN,
  ];
  return box[0] <= box[2] && box[1] <= box[3] ? box : null;
};

// One ring clipped to the box: the part inside, closed, or null when fewer than
// three points are left. A ring that leaves and re-enters the box comes back
// joined along the box edge, which polygon-clipping reads as the same area.
const clipRingToBox = (ring, [minX, minY, maxX, maxY]) => {
  const last = ring.length - 1;
  let output = last > 0 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1] ? ring.slice(0, last) : ring;
  const sides = [
    [(p) => p[0] >= minX, (p, q) => [minX, p[1] + ((minX - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]],
    [(p) => p[0] <= maxX, (p, q) => [maxX, p[1] + ((maxX - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]],
    [(p) => p[1] >= minY, (p, q) => [p[0] + ((minY - p[1]) / (q[1] - p[1])) * (q[0] - p[0]), minY]],
    [(p) => p[1] <= maxY, (p, q) => [p[0] + ((maxY - p[1]) / (q[1] - p[1])) * (q[0] - p[0]), maxY]],
  ];
  for (const [inside, crossing] of sides) {
    if (output.length < 3) return null;
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousInside = inside(previous);
    for (const point of input) {
      const pointInside = inside(point);
      if (pointInside) {
        if (!previousInside) output.push(crossing(previous, point));
        output.push(point);
      } else if (previousInside) {
        output.push(crossing(previous, point));
      }
      previous = point;
      previousInside = pointInside;
    }
  }
  if (output.length < 3) return null;
  output.push(output[0]);
  return output;
};

// The part of an OL polygon geometry inside `box` (an OL extent), as
// polygon-clipping MultiPolygon coordinates; the geometry as it is when its
// extent already lies within the box, null when nothing of it is inside.
export const clipCoordsToBox = (geom, box) => {
  const [minX, minY, maxX, maxY] = geom.getExtent();
  if (minX >= box[0] && minY >= box[1] && maxX <= box[2] && maxY <= box[3]) return asMultiPolygonCoords(geom);
  if (maxX < box[0] || minX > box[2] || maxY < box[1] || minY > box[3]) return null;
  const out = [];
  for (const poly of asMultiPolygonCoords(geom)) {
    const outer = clipRingToBox(poly[0], box);
    if (!outer) continue;
    const rings = [outer];
    for (let i = 1; i < poly.length; i += 1) {
      const hole = clipRingToBox(poly[i], box);
      if (hole) rings.push(hole);
    }
    out.push(rings);
  }
  return out.length ? out : null;
};

// What a and b share, as polygon-clipping coordinates; null for nothing.
const intersectionCoords = (a, b) => {
  const box = sharedBox(a, b);
  if (!box) return null;
  const aa = clipCoordsToBox(a, box);
  const bb = clipCoordsToBox(b, box);
  if (!aa || !bb) return null;
  const res = polygonClipping.intersection(aa, bb);
  return res && res.length ? res : null;
};

export const intersectionGeom = (a, b) => {
  const res = intersectionCoords(a, b);
  return res ? coordsToOl(res) : null;
};

export const unionAllGeoms = (geoms) => {
  const inputs = (geoms || []).filter(Boolean).map(olToCoords);
  if (!inputs.length) return null;
  const res = polygonClipping.union(inputs[0], ...inputs.slice(1));
  return res?.length ? coordsToOl(res) : null;
};

// Return enclosed holes in the UNION of the supplied regions. These are the
// safest automatic "gap" class: because the void is fully enclosed by the
// regions, filling it cannot accidentally pave over an open coastline/ocean inlet.
// `width` is a conservative narrowness proxy (2A/P); long hairline cracks remain
// eligible even when their total area is not tiny. `maxWidth` is the save-time
// sweep's unless the caller gives its own (the Shared border tool's check
// looks at 100 m).
export const enclosedGapGeoms = (geoms, options) => enclosedGapsOfUnion(unionAllGeoms(geoms), options);

// The same for a union already computed: the save-time sweep builds the whole
// map's union in stages (topologySweep.js) and reads its holes once.
export const enclosedGapsOfUnion = (unioned, { maxWidth = BORDER_CLEANUP.maxWidth, minWidth = 0 } = {}) => {
  if (!unioned) return [];
  const out = [];
  for (const poly of asMultiPolygonCoords(unioned)) {
    for (const ring of poly.slice(1)) {
      const area = ringArea(ring);
      const perimeter = ringPerimeter(ring);
      const width = perimeter > 0 ? (2 * area) / perimeter : Infinity;
      if (!Number.isFinite(width) || width > maxWidth || width < minWidth) continue;
      out.push({ geom: new Polygon([ring.map((pt) => pt.slice())]), area, width });
    }
  }
  return out.sort((a, b) => a.width - b.width || a.area - b.area);
};

// Split a pairwise overlap into its separate pieces, so each can be marked on
// the map (the Shared border tool's check) or trimmed (the save-time sweep).
// The caller decides which region wins; the rule is deliberately deterministic
// rather than a guess at campaign semantics. `minWidth` (the sweep's 2 m) drops
// defects too narrow to be anything but coordinate-rounding noise; the default
// of 0 keeps everything. Each piece also carries `shared`, the area of ALL the
// two regions share, pieces of any width included: a trim takes all of it, so
// that is what says whether it is a sliver (topologySweep.js isSliver).
export const overlapGeoms = (a, b, { maxWidth = BORDER_CLEANUP.maxWidth, minWidth = 0 } = {}) => {
  const hit = intersectionGeom(a, b);
  if (!hit) return [];
  const polys = asMultiPolygonCoords(hit);
  const shared = polys.reduce((sum, poly) => sum + Math.max(0, polyArea(poly)), 0);
  const out = [];
  for (const poly of polys) {
    const area = Math.max(0, polyArea(poly));
    const perimeter = ringPerimeter(poly[0]);
    const width = perimeter > 0 ? (2 * area) / perimeter : Infinity;
    if (!Number.isFinite(width) || width > maxWidth || width < minWidth) continue;
    out.push({ geom: new Polygon(poly.map((ring) => ring.map((pt) => pt.slice()))), area, width, shared });
  }
  return out.sort((a, b) => a.width - b.width || a.area - b.area);
};
