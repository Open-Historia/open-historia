/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// What changing a map's projection does to each part of it, as plain rules
// the Projection panel and MapEditor share (server/mapProjection.js has the
// arithmetic). The regions, the cities and features, and the starting units
// always move together, by convertPlane. What becomes of the basemap depends
// on what it is:
//
//   - a picture, between two WORLD projections, is drawn again in the new one
//     (projectionImage.js), unless the author says it is already drawn for it
//     (`keepPicture`): then it is only laid on the new sheet. That is the fix
//     for a map whose places were written as longitude and latitude for a
//     picture the game stretched as Mercator;
//   - a picture, to or from FREEFORM, is never redrawn: it is laid on the new
//     sheet's bounds, which is the whole point of freeform (give the picture
//     any shape, and the map follows it);
//   - a vector basemap is geometry and moves with the regions;
//   - a built-in basemap is tiles of the real Earth in Mercator, which no
//     other projection can show: away from Mercator the map gets a plain sea
//     ("plain"), and back at Mercator the tiles return.

import { DEFAULT_PROJECTION, FREEFORM, convertBounds, convertDisplayPoint, movePlaces, normalizeProjection, sameProjection, sheetBounds } from "../../server/mapProjection.js";

// What to do with the basemap: { kind } is one of
//   "none"    leave it as it is
//   "bounds"  the same picture on `bounds`
//   "redraw"  the picture drawn again for `to`
//   "vector"  its geometry moved with the map
//   "plain"   a plain sea in place of the built-in tiles
//   "tiles"   the built-in tiles again
//   "blocked" not converted at all, and `reason` says why
//
// A detailed map (doc.metadata.tiledBasemap) is a Mercator tile archive the
// editor cannot move (docs/adr/0005): converting would move the regions and
// the basemap under it and leave it where it was, out of line with both.
export const DETAILED_MAP_CONVERSION_MESSAGE = "This map has a detailed map, which is always drawn in the Mercator projection and cannot be converted with the rest of the map. To change the projection, take its detailed maps out of This scenario's maps first (Basemap → My Maps, the ✕ beside each; for the starting map, make another map the starting map first). The drawn maps under them stay.";
// The other way round: a detailed map put on a map already in another
// projection would lie under regions drawn for that one.
export const DETAILED_MAP_PROJECTION_MESSAGE = "A detailed map is always drawn in the Mercator projection, and this map is in another one. To use a detailed map, convert the map back to Mercator first (Projection, in the bottom bar).";
// Whether the map names a detailed map: its starting one
// (doc.metadata.tiledBasemap), or another in the scenario's maps
// (doc.metadata.ownBasemaps, scenarioMaps.js).
export const hasDetailedMap = (doc) => Boolean(doc?.metadata?.tiledBasemap)
  || (Array.isArray(doc?.metadata?.ownBasemaps) && doc.metadata.ownBasemaps.some((entry) => entry?.detailed));
export const detailedMapFits = (projection) => normalizeProjection(projection).type === DEFAULT_PROJECTION;
export const planBasemapChange = ({ from, to, background = null, keepPicture = false, detailedMap = false }) => {
  const source = normalizeProjection(from);
  const target = normalizeProjection(to);
  if (sameProjection(source, target)) return { kind: "none" };
  if (detailedMap) return { kind: "blocked", reason: DETAILED_MAP_CONVERSION_MESSAGE };
  const kind = background?.kind ?? null;
  if (kind === "image") {
    if (source.type === FREEFORM || target.type === FREEFORM) {
      // Laid on the new sheet when it was the old sheet (or said to fit the
      // new one); otherwise its own rectangle is stretched with the map.
      return { kind: "bounds", bounds: keepPicture ? sheetBounds(target) : convertBounds(source, target, background.bounds ?? null) };
    }
    return keepPicture ? { kind: "bounds", bounds: sheetBounds(target) } : { kind: "redraw" };
  }
  if (kind === "vector") return { kind: keepPicture ? "none" : "vector" };
  if (kind === "plain") return { kind: target.type === DEFAULT_PROJECTION ? "tiles" : "none" };
  // Session-only rasters (GeoTIFF, PMTiles) are a reference, not the map's.
  if (kind) return { kind: "none" };
  return { kind: target.type === DEFAULT_PROJECTION ? "none" : "plain" };
};

// The document's cities and map features, each at its new place.
export const moveFeatureCoords = (features, from, to) => (Array.isArray(features) ? features : []).map((feature) => {
  const coord = feature?.coord;
  if (!Array.isArray(coord) || coord.length < 2 || !Number.isFinite(Number(coord[0])) || !Number.isFinite(Number(coord[1]))) return feature;
  return { ...feature, coord: [...convertDisplayPoint(from, to, Number(coord[0]), Number(coord[1])), ...coord.slice(2)] };
});

// The starting units (and anything else kept as { lng, lat }).
export const moveUnits = (units, from, to) => movePlaces(Array.isArray(units) ? units : [], (lon, lat) => convertDisplayPoint(from, to, lon, lat));

// A shape typed as "16:9", "16 x 9", "1.78" or "2" as width / height, or null.
export const parseAspect = (text) => {
  const value = String(text ?? "").trim().replace(",", ".");
  const pair = value.match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i);
  const ratio = pair ? Number(pair[1]) / Number(pair[2]) : /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(ratio) && ratio >= 0.05 && ratio <= 20 ? ratio : null;
};

// A shape as the panel shows it: "2:1", "16:9", or two decimals to one.
export const formatAspect = (aspect) => {
  const ratio = Number(aspect);
  if (!Number.isFinite(ratio) || ratio <= 0) return "";
  for (const height of [1, 2, 3, 4, 5, 9, 10]) {
    const width = ratio * height;
    if (Math.abs(width - Math.round(width)) < 0.005 && Math.round(width) > 0) return `${Math.round(width)}:${height}`;
  }
  return `${ratio.toFixed(2)}:1`;
};

// The projection a panel choice names: the type, and for freeform its shape.
export const projectionChoice = (type, aspect) => normalizeProjection(type === FREEFORM ? { type, aspect } : { type });
