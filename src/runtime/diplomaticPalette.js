/*! Open Historia — the diplomatic map's colours © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every colour the diplomatic map paints a country in, one table a view.
//
// Chosen to be read apart by players who cannot tell red from green: the
// friendly side runs through blues, the hostile side through ambers and browns,
// and war is a deep red that also differs from both in lightness. None is the
// interface's Accent (#2bc1f3), none is a colour of the groups' palette
// (runtime/groups.js GROUP_PALETTE), whose tints are drawn over these, and none
// is the slate grey of unowned land (Nations.jsx NEUTRAL_LAND_COLOR): a country
// with no tie at all is a dark warm grey, never a gap in the map. No purple and
// no fades (diplomaticPalette.test.js measures all of it).

// No record at all between two countries, and the countries a view has nothing
// to say about: one colour in every view.
export const DIPLO_UNKNOWN = "#45423b";

// The Relations view: where each country stands with the focus country.
export const RELATION_COLORS = Object.freeze({
  self: "#f6f1e3",
  overlord: "#5c4630",
  puppet: "#a8835a",
  war: "#a51c1c",
  ceasefire: "#c86a5a",
  alliance: "#1d4f91",
  guarantee: "#5a74a6",
  nonAggression: "#3f7f7a",
  peace: "#8aa3c4",
  access: "#6d8a5c",
  trade: "#d6c48a",
  agreement: "#a59a73",
  friendly: "#82aac0",
  cordial: "#bcd4e2",
  neutral: "#bdb49c",
  cautious: "#e8c99a",
  strained: "#d7965a",
  hostile: "#b5612b",
  rival: "#6e2a12",
  unknown: DIPLO_UNKNOWN,
});

// The Wars view: each war's two sides, warm against cool, a pair a war in the
// order the legend lists them. Wars past the sixth share the last pair.
export const WAR_SIDE_COLORS = Object.freeze([
  Object.freeze(["#c8501e", "#2563a8"]),
  Object.freeze(["#c99a52", "#3c8a8a"]),
  Object.freeze(["#8f2d2d", "#7d9fc9"]),
  Object.freeze(["#b77b52", "#3d4f73"]),
  Object.freeze(["#e3907a", "#3f7a63"]),
  Object.freeze(["#7a4a1f", "#a9c2d6"]),
]);
export const WAR_SIDE_OVERFLOW = Object.freeze(["#9b6a5a", "#6a7f8f"]);

// The Blocs & institutions view: a member's standing in the institution shown.
export const BLOC_COLORS = Object.freeze({
  member: "#1f5a7a",
  associate: "#4d86a3",
  participant: "#79a3a6",
  candidate: "#a7c3cf",
  observer: "#c8c3ad",
  suspended: "#9a5b3c",
  none: DIPLO_UNKNOWN,
});
// The line round the whole of an institution's land.
export const BLOC_OUTLINE_COLOR = "#f6f1e3";

// The Government & spheres view, one table each thing it can colour by.
export const REGIME_COLORS = Object.freeze({
  democratic: "#2f6fa6",
  hybrid: "#7aa6a1",
  authoritarian: "#c47a3a",
  totalitarian: "#7a1f1f",
  theocratic: "#c9b46a",
  military: "#5f6b3a",
  colonial: "#8c6b54",
  other: "#a09a8a",
  unknown: DIPLO_UNKNOWN,
});
export const REPRESENTATION_COLORS = Object.freeze({
  electoral: "#2f6fa6",
  court_factions: "#b08d57",
  party_state: "#8f2d2d",
  elite_factions: "#c47a3a",
  military_factions: "#5f6b3a",
  revolutionary_factions: "#d26a4a",
  colonial: "#8c6b54",
  none: "#a09a8a",
  unknown: DIPLO_UNKNOWN,
});
export const IDEOLOGY_COLORS = Object.freeze({
  totalism: "#6e1c1c",
  syndicalism: "#a8322e",
  radicalSocialism: "#d8664a",
  socialDemocracy: "#e8a58c",
  socialLiberalism: "#dcc98e",
  marketLiberalism: "#b39a3e",
  socialConservatism: "#7f98ad",
  authoritarianDemocracy: "#2b4c7e",
  paternalAutocracy: "#857a68",
  nationalPopulism: "#5e3b22",
  unknown: DIPLO_UNKNOWN,
});
export const POWER_COLORS = Object.freeze({
  "major-power": "#284b63",
  "regional-power": "#6a8fa3",
  "minor-power": "#b9cbd6",
  unknown: DIPLO_UNKNOWN,
});

// The lines from the focus country's capital (DiplomaticLayers.jsx).
export const LINE_COLORS = Object.freeze({
  ally: "#f6f1e3",
  war: "#e05a3a",
  ceasefire: "#e8b0a0",
});

// The hatching laid over land (Nations.jsx diplomatic hatch): ceasefires,
// puppets, occupied land, and an institution's candidates and suspended members.
export const HATCH_COLORS = Object.freeze({
  ceasefire: "#f6f1e3",
  puppet: "#1b1a17",
  occupied: "#1b1a17",
  candidate: "#1f5a7a",
  suspended: "#f6f1e3",
});

// The every colour a view may paint a country in, for the palette's tests.
export const ALL_DIPLOMATIC_COLORS = Object.freeze([
  ...Object.values(RELATION_COLORS),
  ...WAR_SIDE_COLORS.flat(),
  ...WAR_SIDE_OVERFLOW,
  ...Object.values(BLOC_COLORS),
  ...Object.values(REGIME_COLORS),
  ...Object.values(REPRESENTATION_COLORS),
  ...Object.values(IDEOLOGY_COLORS),
  ...Object.values(POWER_COLORS),
]);

export const hexToRgb = (hex) => {
  const text = String(hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(text)) return null;
  return [0, 2, 4].map((at) => parseInt(text.slice(at, at + 2), 16));
};

const toHex = (rgb) => `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`;

// A puppet's shade of its overlord's colour: the same family, toward the ivory
// of the focus country, so it reads as the overlord's at a glance and as lesser.
export const puppetShade = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const toward = hexToRgb(RELATION_COLORS.self);
  return toHex(rgb.map((part, index) => part + (toward[index] - part) * 0.42));
};
