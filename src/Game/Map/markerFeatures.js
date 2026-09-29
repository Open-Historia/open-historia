/*! Open Historia — built-structure map features © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// world.markers -> the GeoJSON MarkersLayer.jsx draws. Import-light (no React,
// no MapLibre) so node --test runs it.
import { toCountryName } from "../../runtime/ownerNames.js";
import { parseColorToRgb } from "./cssColor.js";
import { getMarkerPresentation } from "./vnext/presentationPolicy.js";

export const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const MARKER_STATUS_LABEL = {
  planned: "Planned",
  under_construction: "Under construction",
  active: "Active",
  damaged: "Damaged",
  inactive: "Inactive",
  abandoned: "Abandoned",
  destroyed: "Destroyed",
};

const normalizeMarkerStatus = (status) => {
  const key = String(status || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MARKER_STATUS_LABEL, key) ? key : "active";
};

const markerStatusOpacity = (status) => ({
  planned: 0.76,
  under_construction: 0.86,
  active: 1,
  damaged: 0.95,
  inactive: 0.68,
  abandoned: 0.64,
  destroyed: 0.62,
}[normalizeMarkerStatus(status)]);

// Unowned / unknown-owner structures read as neutral parchment, not an error.
export const UNOWNED_MARKER_COLOR = "rgb(226, 222, 205)";

// The owner's colour as the region fills resolve it (Nations.jsx
// resolveOwnerRgb): an owner CODE is read as the name the palette is keyed by,
// colors.json first, then the live polity registry — a polity the AI founded
// mid-game, or one a scenario coloured only in polityOverrides, has its colour
// there and nowhere else. Names are exact keys; nothing is folded.
export const markerOwnerColor = (code, { colorMap = {}, polityOverrides = {} } = {}) => {
  const owner = toCountryName(code);
  if (!owner) return UNOWNED_MARKER_COLOR;
  const rgb = colorMap?.[owner];
  if (Array.isArray(rgb)) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const registry = parseColorToRgb(polityOverrides?.[owner]?.color);
  if (registry) return `rgb(${registry[0]}, ${registry[1]}, ${registry[2]})`;
  return UNOWNED_MARKER_COLOR;
};

export const buildMarkerFeatureCollection = (markers, { colorMap = {}, polityOverrides = {} } = {}) => {
  if (!markers?.length) return EMPTY_FEATURE_COLLECTION;
  return {
    type: "FeatureCollection",
    features: markers
      .filter((marker) => Number.isFinite(marker.lng) && Number.isFinite(marker.lat) && marker.name)
      .map((marker) => {
        const status = normalizeMarkerStatus(marker.status);
        const statusLabel = MARKER_STATUS_LABEL[status];
        const presentation = getMarkerPresentation(marker);
        return {
          type: "Feature",
          id: marker.id,
          geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
          properties: {
            id: marker.id,
            name: marker.name,
            // Lifecycle is encoded by opacity and remains fully described in
            // the feature popup, so the map label stays the plain name.
            displayName: marker.name,
            kind: marker.kind || "landmark",
            ownerCode: marker.ownerCode || "",
            status,
            statusLabel,
            statusOpacity: markerStatusOpacity(status),
            family: presentation.family,
            priority: presentation.priority,
            sortKey: presentation.sortKey,
            visibilityTier: presentation.visibilityTier,
            glyph: presentation.glyph,
            rgb: markerOwnerColor(marker.ownerCode, { colorMap, polityOverrides }),
          },
        };
      }),
  };
};
