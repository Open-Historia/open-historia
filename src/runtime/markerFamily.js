/*! Open Historia — what family a structure on the map belongs to © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A structure (world.markers) is drawn by its FAMILY: its glyph and how far
// out it shows (Map/vnext/presentationPolicy.js), the emoji on its card
// (Selection/Features.jsx), and which structures a strike can set off from
// (runtime/strikes.js). Its family is said, never read from its words:
//   - the time skip says it when it builds one (markerSchema `family`), and
//     whether the structure is of strategic weight (`strategic`);
//   - each kind the game itself offers has one (KIND_FAMILIES): the
//     Workshop's Map feature tool and the Game Master's tools offer these ids,
//     and they are looked up exactly, as ids;
//   - a kind an author types takes the family the author picks for it.
// A structure with none of these is a landmark, the neutral family: an old
// one the AI built with a kind of its own words included. "военная база" used
// to be a local landmark and "military base" a strategic base, by English
// words in the kind and the name.
//
// Import-free, so the map, the schema, the Workshop and node all read it.

export const MARKER_FAMILIES = Object.freeze([
  "settlement",
  "military",
  "resource",
  "infrastructure",
  "industry-science",
  "diplomatic",
  "landmark",
]);

// What a structure is when nothing says otherwise.
export const NEUTRAL_MARKER_FAMILY = "landmark";

// The families the time skip is offered: saying none is saying the neutral one.
export const SAID_MARKER_FAMILIES = Object.freeze(MARKER_FAMILIES.filter((family) => family !== NEUTRAL_MARKER_FAMILY));

const FAMILY_SET = new Set(MARKER_FAMILIES);

// A family as kept: one of MARKER_FAMILIES, or "" for anything else.
export const normalizeMarkerFamily = (value) => {
  const family = String(value ?? "").trim().toLowerCase();
  return FAMILY_SET.has(family) ? family : "";
};

// The kinds the game offers and the family of each: the Workshop's
// (Editor/mapFeatures.js MAP_FEATURE_KINDS) and the Game Master's city
// (GameUI/mapFeatureKinds.js). Held equal to those lists by markerFamily.test.js.
export const KIND_FAMILIES = Object.freeze({
  city: "settlement",
  landmark: "landmark",
  "military hq": "military",
  "military base": "military",
  fortress: "military",
  airfield: "military",
  port: "infrastructure",
  mine: "resource",
  "oil field": "resource",
  "industrial plant": "industry-science",
  "power plant": "industry-science",
  "research facility": "industry-science",
  embassy: "diplomatic",
});

// A kind as an id: lowercase, and its spacing, written as spaces, underscores
// or hyphens, made one space ("oil_field" is how a model writes "oil field").
const kindKey = (kind) => String(kind ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

// The family of one of the game's own kinds, or "" for a kind it does not offer.
export const kindFamily = (kind) => {
  const key = kindKey(kind);
  return Object.hasOwn(KIND_FAMILIES, key) ? KIND_FAMILIES[key] : "";
};

// The family of each kind on the structure director's closed list
// (Game/AI/gameplaySchemas.js STRUCTURE_KINDS, held equal to it by
// markerFamily.test.js), said on what the director builds
// (nativeStructureDirector.js). Only there: a structure saved with no family is
// never read by these, since a kind an AI wrote freely may be the same English
// words ("missile silo") that no other language's kind ever is.
export const STRUCTURE_KIND_FAMILIES = Object.freeze({
  "military hq": "military",
  "military base": "military",
  "naval base": "military",
  airfield: "military",
  fortress: "military",
  "missile silo": "military",
  "radar station": "military",
  port: "infrastructure",
  shipyard: "industry-science",
  depot: "infrastructure",
  "pipeline terminal": "infrastructure",
  infrastructure: "infrastructure",
  "launch site": "industry-science",
  "ground station": "industry-science",
  "industrial plant": "industry-science",
  "power plant": "industry-science",
  refinery: "industry-science",
  mine: "resource",
  "oil field": "resource",
  "research facility": "industry-science",
  "data centre": "industry-science",
  embassy: "diplomatic",
  landmark: "landmark",
});

// The family a structure the director builds is drawn as: its kind's, by id.
export const structureKindFamily = (kind) => {
  const key = kindKey(kind);
  return Object.hasOwn(STRUCTURE_KIND_FAMILIES, key) ? STRUCTURE_KIND_FAMILIES[key] : NEUTRAL_MARKER_FAMILY;
};

// A structure's family: the one it was given, else its kind's when that is one
// of the game's own, else the neutral one.
export const markerFamilyOf = (marker) => normalizeMarkerFamily(marker?.family)
  || kindFamily(marker?.kind)
  || NEUTRAL_MARKER_FAMILY;

// A structure an AI answer builds, as the map will keep it: drawn as the family
// the answer said, or as a landmark when it said none, written on it so that its
// kind is never consulted. That kind is free words: in English they may be one
// of the game's own kinds ("military base") and draw as one, in no other
// language ever (the owner, 2026-11-13: no keywording anywhere).
export const withSaidFamily = (marker) => (marker && typeof marker === "object" && !Array.isArray(marker)
  ? { ...marker, family: normalizeMarkerFamily(marker.family) || NEUTRAL_MARKER_FAMILY }
  : marker);

// Whether a structure is of strategic weight: only when it was said to be.
export const isStrategicMarker = (marker) => marker?.strategic === true;
