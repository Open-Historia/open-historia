/*! Open Historia — province outline presentation © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Provinces are local detail, not the political silhouette. Keep the overview
// free of the administrative grid, then fade it in as country labels yield to
// local detail. A zero-opacity first stop avoids a pop at the layer's minzoom.
// Share the policy between stock tiles and scenario geometry so switching map
// kinds cannot bring back the early, heavy grid. Country/frontier layers and
// the fill layers used for hit-testing deliberately do not use this policy.
// A scenario's region type may recolour or rescale its regions' strokes
// (regionTypePaint.js); every other region keeps this hairline.
import { TYPE_STROKE_STATE, withTypeStrokeWidth } from "./regionTypePaint.js";

export const PROVINCE_OUTLINE_MIN_ZOOM = 4.15;
export const PROVINCE_OUTLINE_COLOR = "rgba(205, 218, 228, 0.64)";
const PROVINCE_OUTLINE_LINE_COLOR = ["coalesce", TYPE_STROKE_STATE, PROVINCE_OUTLINE_COLOR];

const PROVINCE_OUTLINE_WIDTH = [
  "interpolate", ["linear"], ["zoom"],
  PROVINCE_OUTLINE_MIN_ZOOM, withTypeStrokeWidth(0.40),
  5.0, withTypeStrokeWidth(0.48),
  6.5, withTypeStrokeWidth(0.56),
  8.0, withTypeStrokeWidth(0.62),
  12.0, withTypeStrokeWidth(0.72),
];
const PROVINCE_OUTLINE_OPACITY = [
  "interpolate", ["linear"], ["zoom"],
  PROVINCE_OUTLINE_MIN_ZOOM, 0,
  4.45, 0.18,
  4.90, 0.30,
  5.50, 0.42,
  7.0, 0.50,
  12.0, 0.58,
];

export const buildProvinceOutlinePaint = (active) => ({
  "line-color": PROVINCE_OUTLINE_LINE_COLOR,
  // MapLibre measures line-width in CSS pixels; keep it visibly subordinate to
  // sovereign borders even after the local administrative grid is fully present.
  "line-width": PROVINCE_OUTLINE_WIDTH,
  "line-opacity": active ? PROVINCE_OUTLINE_OPACITY : 0,
});
