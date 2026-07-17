/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Geometry operations for the editor, working directly on OpenLayers geometries
// in the map's EPSG:3857 projection via polygon-clipping (union / difference).
// No reprojection round-trips: OL Polygon/MultiPolygon coordinate arrays are the
// same shape polygon-clipping expects (Polygon = [ring...], MultiPolygon =
// [[ring...]...]).

import polygonClipping from "polygon-clipping";
import Polygon from "ol/geom/Polygon";
import MultiPolygon from "ol/geom/MultiPolygon";

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
export const subtractFrom = (target, cutter) => {
  const res = polygonClipping.difference(olToCoords(target), olToCoords(cutter));
  if (!res || res.length === 0) return null;
  return coordsToOl(res);
};

// Do these two geometries share any area at all? Cheap-ish guard so drawing a
// region only rewrites the neighbours it genuinely overlaps, instead of running a
// difference against every region on the map and marking them all edited.
export const overlaps = (a, b) => {
  const res = polygonClipping.intersection(olToCoords(a), olToCoords(b));
  return Boolean(res && res.length > 0);
};

// Build a thin ribbon polygon (MultiPolygon coords) around a polyline — used as
// a cutter: subtracting it from a region bisects the region along the line.
const bufferLine = (line, hw) => {
  const rects = [];
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    rects.push([
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
        [ax + nx, ay + ny],
      ],
    ]);
  }
  return rects.length === 1 ? rects[0] : polygonClipping.union(rects[0], ...rects.slice(1));
};

// Extend a polyline outward at both ends so it fully crosses a region.
const extendLine = (line, dist) => {
  const l = line.map((p) => p.slice());
  const push = (p, q) => {
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * dist, p[1] + (dy / len) * dist];
  };
  l[0] = push(line[0], line[1]);
  l[l.length - 1] = push(line[line.length - 1], line[line.length - 2]);
  return l;
};

const ringCentroid = (ring) => {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
    n += 1;
  }
  return n ? [x / n, y / n] : ring[0];
};

// Split an OL polygon/multipolygon by a drawn line (3857 coords). Removes a thin
// sliver along the line, then groups the resulting fragments onto the two sides
// of the cut (so islands stay with their side and a MultiPolygon region doesn't
// explode into all its parts) and unions each side into one geometry. Returns
// [{geom,area}, {geom,area}] (largest first) or null if the line doesn't bisect.
export const splitByLine = (olGeom, line, { hw = 6, extend = 2e6 } = {}) => {
  if (!line || line.length < 2) return null;
  const cutter = bufferLine(extendLine(line, extend), hw);
  const region = olToCoords(olGeom);
  let pieces;
  try {
    pieces = polygonClipping.difference(region, cutter);
  } catch {
    return null;
  }
  if (!pieces || pieces.length < 2) return null;

  // Classify each fragment by which side of the directed cut line (start->end)
  // its centroid lies on, via the sign of the 2D cross product.
  const s = line[0];
  const e = line[line.length - 1];
  const ex = e[0] - s[0];
  const ey = e[1] - s[1];
  const pos = [];
  const neg = [];
  for (const poly of pieces) {
    const c = ringCentroid(poly[0]);
    (ex * (c[1] - s[1]) - ey * (c[0] - s[0]) >= 0 ? pos : neg).push(poly);
  }

  const toSide = (group) => {
    if (!group.length) return null;
    const mp = group.length === 1 ? [group[0]] : polygonClipping.union(group[0], ...group.slice(1));
    const area = group.reduce((sum, p) => sum + polyArea(p), 0);
    return { geom: coordsToOl(mp), area };
  };

  const a = toSide(pos);
  const b = toSide(neg);
  if (a && b) return [a, b].sort((x, y) => y.area - x.area);

  // Fallback: line didn't cleanly bisect into two sides — largest piece vs rest.
  const sorted = pieces
    .map((poly) => ({ poly, area: polyArea(poly) }))
    .sort((x, y) => y.area - x.area);
  if (sorted.length < 2) return null;
  return [
    { geom: coordsToOl([sorted[0].poly]), area: sorted[0].area },
    {
      geom: coordsToOl(sorted.slice(1).map((x) => x.poly)),
      area: sorted.slice(1).reduce((sum, x) => sum + x.area, 0),
    },
  ];
};

// Translate an OL geometry by (dx, dy) in map units — used for copy/paste offset.
export const translatedClone = (olGeom, dx, dy) => {
  const g = olGeom.clone();
  g.translate(dx, dy);
  return g;
};
