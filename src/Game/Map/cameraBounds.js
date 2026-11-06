/*! Open Historia — how far the game's camera may go: © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game camera's maxBounds ([[west, south], [east, north]]), import-light so
// it can be tested without MapLibre.
//
// - The real Earth stops at 80°S (nothing south of Antarctica's coast is worth
//   the space) and 85°N.
// - A scenario's own map is cut off at its edges: a picture at the picture's
//   own bounds (a freeform sheet, or any picture laid on part of the square),
//   drawn shapes at the square's ±85.05°. MapLibre then also zooms in so the
//   view never shows past those edges: the picture fills the screen, top to
//   bottom (and side to side when it does not repeat).
// - A map that does not repeat (world.projection.wrap === false) stops at its
//   left and right edges too. Infinite longitudes there would switch off
//   MapLibre's own single-world hold (it only applies with no lngRange at all),
//   which is how the camera could pan sideways for ever.
// - On the 3D globe nothing changes: no longitude bounds, the square's
//   latitudes for a scenario's own map.

import { MERCATOR_MAX_LAT, normalizeImageBounds } from "../../../server/mapProjection.js";

// MapLibre's own figure for a world that does not repeat: exactly ±180 wraps
// to the same pixel and makes the span zero (an infinite zoom in its constrain).
export const ALMOST_180 = 180 - 1e-10;

export const cameraMaxBounds = ({ customBg = null, noWrap = false, globe = false } = {}) => {
  const ownMap = customBg?.kind === "image" || customBg?.kind === "vector";
  let south = ownMap ? -MERCATOR_MAX_LAT : -80;
  let north = ownMap ? MERCATOR_MAX_LAT : 85;
  if (globe) return [[-Infinity, south], [Infinity, north]];
  let west = noWrap ? -ALMOST_180 : -Infinity;
  let east = noWrap ? ALMOST_180 : Infinity;
  const picture = customBg?.kind === "image" ? normalizeImageBounds(customBg.bounds) : null;
  if (picture) {
    south = picture.south;
    north = picture.north;
    // A picture's sides bound the camera only where the map is one world; a
    // frame reaching past ±180 is held at the world's edges.
    if (noWrap) {
      west = Math.max(picture.west, -ALMOST_180);
      east = Math.min(picture.east, ALMOST_180);
      if (!(east - west > 1e-6)) { west = -ALMOST_180; east = ALMOST_180; }
    }
  }
  return [[west, south], [east, north]];
};
