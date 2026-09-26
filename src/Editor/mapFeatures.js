/*!
 * Open Historia Map Editor — map features that are not cities
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A military base, a port, a landmark: the game's structures (world.markers,
// runtime/gameState.js normalizeMarkerEntry), which the AI builds and destroys
// in play and a scenario can now start with. In the Workshop they are point
// features like cities, told apart by a `kind` and no "city" tag:
//   { id, name, type: "Coordinate", symbol: "diamond", coord: [lon, lat],
//     owner, regionId, country, tags: ["feature"], kind, status, note,
//     createdAt, markerId?, markerExtra? }
// markerId / markerExtra carry a marker that came from the scenario's world:
// its id, and every field the Workshop does not edit, so a save hands it back
// as it was. Import-free, so the export and the tests share it.

import { isCityFeature } from "./cityMarkers.js";

// What the Map feature tool offers. The game draws each family with its own
// glyph from the kind's words (Game/Map/vnext/presentationPolicy.js), and any
// other kind the author types is a landmark there.
export const MAP_FEATURE_KINDS = Object.freeze([
  { id: "landmark", label: "Landmark" },
  { id: "military hq", label: "Military HQ" },
  { id: "military base", label: "Military base" },
  { id: "fortress", label: "Fortress" },
  { id: "airfield", label: "Airfield" },
  { id: "port", label: "Port" },
  { id: "mine", label: "Mine or quarry" },
  { id: "oil field", label: "Oil field" },
  { id: "industrial plant", label: "Industrial plant" },
  { id: "power plant", label: "Power plant" },
  { id: "research facility", label: "Research facility" },
  { id: "embassy", label: "Embassy" },
]);

// gameState.js MARKER_STATUSES (held equal by server/workshopAuthoring.test.js).
export const MAP_FEATURE_STATUSES = Object.freeze([
  "planned",
  "under_construction",
  "active",
  "damaged",
  "inactive",
  "abandoned",
  "destroyed",
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const isMapFeature = (feature) => Boolean(clean(feature?.kind)) && !isCityFeature(feature);

export const newMapFeature = ({ id, coord, owner = null, regionId = null, country = "", createdAt = new Date().toISOString() }) => ({
  id,
  name: "New feature",
  type: "Coordinate",
  symbol: "diamond",
  coord,
  country: country || "",
  owner: owner || null,
  regionId: regionId || null,
  tags: ["feature"],
  kind: "landmark",
  status: "active",
  note: "",
  createdAt,
});

// A marker from the scenario's world -> an editor feature. null when it cannot
// be placed.
export const markerToFeature = (marker, id) => {
  if (!marker || typeof marker !== "object") return null;
  const { name, kind, ownerCode, lng, lat, note, status, id: markerId, ...rest } = marker;
  const lon = Number(lng);
  const la = Number(lat);
  const label = clean(name);
  if (!label || !Number.isFinite(lon) || !Number.isFinite(la)) return null;
  return {
    id,
    name: label,
    type: "Coordinate",
    symbol: "diamond",
    coord: [lon, la],
    country: "",
    owner: clean(ownerCode) || null,
    regionId: null,
    tags: ["feature"],
    kind: clean(kind).toLowerCase() || "landmark",
    status: MAP_FEATURE_STATUSES.includes(clean(status)) ? clean(status) : "active",
    note: String(note ?? ""),
    createdAt: clean(rest.createdAt) || new Date().toISOString(),
    ...(clean(markerId) ? { markerId: clean(markerId) } : {}),
    ...(Object.keys(rest).length ? { markerExtra: rest } : {}),
  };
};

// The document's map features as world.markers. Each keeps a stable id (its
// own, or one made from the feature's), because the game looks markers up by
// id and gives one without an id a new random one on every read.
export const buildMarkersForGame = (features) => (Array.isArray(features) ? features : [])
  .filter(isMapFeature)
  .map((feature) => {
    const coord = Array.isArray(feature.coord) ? feature.coord.map(Number) : [];
    const name = clean(feature.name);
    if (!name || coord.length < 2 || !coord.slice(0, 2).every(Number.isFinite)) return null;
    const extra = feature.markerExtra && typeof feature.markerExtra === "object" ? feature.markerExtra : {};
    const status = clean(feature.status);
    return {
      ...extra,
      id: clean(feature.markerId) || `marker-${clean(feature.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      kind: clean(feature.kind).toLowerCase() || "landmark",
      ownerCode: clean(feature.owner),
      lng: Number(coord[0].toFixed(5)),
      lat: Number(coord[1].toFixed(5)),
      note: String(feature.note ?? "").trim(),
      status: MAP_FEATURE_STATUSES.includes(status) ? status : "active",
      createdAt: clean(extra.createdAt) || clean(feature.createdAt) || "1970-01-01T00:00:00.000Z",
    };
  })
  .filter(Boolean);
