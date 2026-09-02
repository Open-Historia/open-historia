/*! Open Historia — Map vNext presentation policy © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

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
    pattern: /\b(lithium|resource|basin|mine|mining|deposit|oilfield|gas field|coalfield|ore field|quarry|well)\b/,
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
