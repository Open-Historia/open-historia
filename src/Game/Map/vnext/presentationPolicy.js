/*! Open Historia — Map vNext presentation policy © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import { isStrategicMarker, markerFamilyOf } from "../../../runtime/markerFamily.js";

// Map vNext keeps canonical world objects independent from their cartographic
// representation. These categories are intentionally few: shape communicates
// what an object is, while ownership/status remain separate visual channels.
// The family is a structure's own field (runtime/markerFamily.js), never read
// from the words of its kind or name.
export const MARKER_FAMILY = Object.freeze({
  settlement: "settlement",
  military: "military",
  resource: "resource",
  infrastructure: "infrastructure",
  industryScience: "industry-science",
  diplomatic: "diplomatic",
  landmark: "landmark",
});

export const MARKER_VISIBILITY_TIER = Object.freeze({
  strategic: "strategic",
  regional: "regional",
  local: "local",
});

export const V_NEXT_MARKER_SHAPE_LAYER_IDS = Object.freeze([
  "markers-shapes-strategic",
  "markers-shapes-regional",
  "markers-shapes-local",
]);

// Physical geography should be part of the political map rather than hidden
// beneath it. Keep the far/continental wash translucent enough for relief and
// bathymetry to read, then progressively strengthen ownership color as the
// player zooms toward province/city detail. One list for the fills (Nations.jsx
// builds its MapLibre ramp from it) and the conquest flood
// (ownershipFloodCustomLayer.js), which hands off to the fill seamlessly only
// while both draw at the same strength.
export const POLITICAL_FILL_OPACITY_STOPS = Object.freeze([
  // World view: terrain remains visible while political ownership is readable.
  [1.5, 0.46],
  [2.5, 0.50],
  [3.75, 0.56],

  // Regional view: political colours become the primary map layer.
  // This avoids countries fading into the physical basemap during normal play.
  [5.0, 0.62],
  [6.5, 0.68],
  [8.0, 0.72],

  // Close play: maintain strong polity identity while showing terrain detail.
  [10.0, 0.78],
  [12.0, 0.82],
  [14.0, 0.84],
].map((stop) => Object.freeze(stop)));

// The borders between polities (Nations.jsx polity-boundaries and its shadow),
// in px by zoom: one list for those lines and the border a battlefield's ground
// draws where its holders meet (frontGroundLayer.js), which carries them on
// across the battlefield.
export const POLITY_BOUNDARY_WIDTH_STOPS = Object.freeze([[1, 0.58], [3, 0.92], [6, 1.34], [9, 1.72], [12, 2.08]].map((stop) => Object.freeze(stop)));
export const POLITY_BOUNDARY_SHADOW_WIDTH_STOPS = Object.freeze([[1, 1.8], [3, 2.5], [6, 3.6], [9, 4.7], [12, 5.8]].map((stop) => Object.freeze(stop)));
export const POLITY_BOUNDARY_SHADOW_BLUR_STOPS = Object.freeze([[1, 0.7], [6, 1.15], [12, 1.5]].map((stop) => Object.freeze(stop)));

// A value at a zoom, as MapLibre's linear interpolate reads its stops (clamped
// to the end stops outside them), for a layer that draws it by hand.
export const zoomStopValue = (stops, zoom) => {
  const z = Number(zoom) || 0;
  if (z <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [z1, a1] = stops[index];
    const [z0, a0] = stops[index - 1];
    if (z <= z1) {
      const t = (z - z0) / Math.max(1e-9, z1 - z0);
      return a0 + ((a1 - a0) * t);
    }
  }
  return stops.at(-1)[1];
};

// The fill strength at a zoom, as MapLibre's linear interpolate reads the stops
// (clamped to the end stops outside them), for a layer that draws it by hand.
export const politicalFillOpacityAtZoom = (zoom) => {
  const stops = POLITICAL_FILL_OPACITY_STOPS;
  const z = Number(zoom) || 0;
  if (z <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [z1, a1] = stops[index];
    const [z0, a0] = stops[index - 1];
    if (z <= z1) {
      const t = (z - z0) / Math.max(1e-9, z1 - z0);
      return a0 + ((a1 - a0) * t);
    }
  }
  return stops.at(-1)[1];
};

// Each family's glyph and how much it matters on the map before its status.
const FAMILY_PRESENTATION = Object.freeze({
  [MARKER_FAMILY.settlement]: Object.freeze({ glyph: "●", priority: 92 }),
  [MARKER_FAMILY.military]: Object.freeze({ glyph: "▲", priority: 84 }),
  [MARKER_FAMILY.resource]: Object.freeze({ glyph: "◆", priority: 70 }),
  [MARKER_FAMILY.infrastructure]: Object.freeze({ glyph: "■", priority: 68 }),
  [MARKER_FAMILY.industryScience]: Object.freeze({ glyph: "✦", priority: 64 }),
  [MARKER_FAMILY.diplomatic]: Object.freeze({ glyph: "◇", priority: 58 }),
  [MARKER_FAMILY.landmark]: Object.freeze({ glyph: "•", priority: 46 }),
});

// What a structure of strategic weight (its `strategic` flag) adds.
const STRATEGIC_PRIORITY = 7;

const STATUS_PRIORITY_DELTA = Object.freeze({
  planned: -10,
  under_construction: -4,
  active: 0,
  damaged: 4,
  inactive: -12,
  abandoned: -18,
  destroyed: -24,
});

const clampPriority = (value) => Math.max(0, Math.min(100, Math.round(value)));

export const visibilityTierForPriority = (priority) => {
  if (priority >= 82) return MARKER_VISIBILITY_TIER.strategic;
  if (priority >= 62) return MARKER_VISIBILITY_TIER.regional;
  return MARKER_VISIBILITY_TIER.local;
};

// How a structure is drawn: its family's glyph, and a priority from its family,
// its strategic weight and its lifecycle status (an enum: gameState.js
// MARKER_STATUSES), which sets its zoom tier and its place in a crowd.
export const getMarkerPresentation = (marker = {}) => {
  const family = markerFamilyOf(marker);
  const { glyph, priority: base } = FAMILY_PRESENTATION[family];
  const status = String(marker.status || "active").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const priority = clampPriority(
    base + (isStrategicMarker(marker) ? STRATEGIC_PRIORITY : 0) + (STATUS_PRIORITY_DELTA[status] ?? 0),
  );

  return {
    family,
    glyph,
    priority,
    sortKey: -priority,
    visibilityTier: visibilityTierForPriority(priority),
  };
};
