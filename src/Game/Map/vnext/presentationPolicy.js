/*! Open Historia — Map vNext presentation policy © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Map vNext keeps canonical world objects independent from their cartographic
// representation. These categories are intentionally few: shape communicates
// what an object is, while ownership/status remain separate visual channels.
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

const FAMILY_RULES = [
  {
    family: MARKER_FAMILY.settlement,
    pattern: /\b(capital|city|town|settlement|metropolis|municipality)\b/,
    glyph: "●",
    priority: 92,
  },
  {
    family: MARKER_FAMILY.military,
    pattern: /\b(military|army|naval|defen[cs]e|command|headquarters|hq|base|fort|fortress|bunker|silo|garrison|missile|radar|airfield|airbase|barracks|outpost|citadel|arsenal|testing range)\b/,
    glyph: "▲",
    priority: 84,
  },
  {
    family: MARKER_FAMILY.resource,
    // "<x>field" in one word or two: the Workshop's kind is "oil field", and
    // normalizeText reads the AI's "oil_field" the same way.
    pattern: /\b(lithium|resource|basin|mine|mining|deposit|oil ?field|gas ?field|coal ?field|ore ?field|quarry|well)\b/,
    glyph: "◆",
    priority: 70,
  },
  {
    family: MARKER_FAMILY.infrastructure,
    pattern: /\b(port|harbou?r|terminal|logistics|rail|railway|station|airport|bridge|canal|corridor|transit|pipeline|grid|storage|hub)\b/,
    glyph: "■",
    priority: 68,
  },
  {
    family: MARKER_FAMILY.industryScience,
    pattern: /\b(factory|plant|works|industrial|manufactur|laborator|laboratory|research|science|scientific|technology|institute|university|energy|power|reactor)\b/,
    glyph: "✦",
    priority: 64,
  },
  {
    family: MARKER_FAMILY.diplomatic,
    pattern: /\b(embassy|consulate|mission|secretariat|liaison|administration|diplomatic)\b/,
    glyph: "◇",
    priority: 58,
  },
];

const DEFAULT_PRESENTATION = Object.freeze({
  family: MARKER_FAMILY.landmark,
  glyph: "•",
  priority: 46,
});

const STATUS_PRIORITY_DELTA = Object.freeze({
  planned: -10,
  under_construction: -4,
  active: 0,
  damaged: 4,
  inactive: -12,
  abandoned: -18,
  destroyed: -24,
});

const STRATEGIC_LANGUAGE = /\b(national|central|strategic|international|major|supreme|joint|command|capital|nuclear)\b/;

const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const clampPriority = (value) => Math.max(0, Math.min(100, Math.round(value)));

export const visibilityTierForPriority = (priority) => {
  if (priority >= 82) return MARKER_VISIBILITY_TIER.strategic;
  if (priority >= 62) return MARKER_VISIBILITY_TIER.regional;
  return MARKER_VISIBILITY_TIER.local;
};

export const getMarkerPresentation = (marker = {}) => {
  const kind = normalizeText(marker.kind || "landmark");
  const name = normalizeText(marker.name);
  const searchable = `${kind} ${name}`.trim();
  const matched = FAMILY_RULES.find((rule) => rule.pattern.test(searchable)) ?? DEFAULT_PRESENTATION;
  const status = normalizeText(marker.status || "active").replace(/\s+/g, "_");
  const strategicBonus = STRATEGIC_LANGUAGE.test(searchable) ? 7 : 0;
  const priority = clampPriority(
    matched.priority + strategicBonus + (STATUS_PRIORITY_DELTA[status] ?? 0),
  );

  return {
    family: matched.family,
    glyph: matched.glyph,
    priority,
    sortKey: -priority,
    visibilityTier: visibilityTierForPriority(priority),
  };
};
