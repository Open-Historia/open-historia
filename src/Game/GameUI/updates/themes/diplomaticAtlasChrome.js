/*! Open Historia — the Diplomatic Atlas: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the Diplomatic Atlas's banners are dressed (DiplomaticAtlas.jsx): a
// chart-room's dark ink, the ivory the map draws its focus country in, and the
// brass of an old atlas's rules, in a serif hand.

export const ATLAS_INK = "#10171e";
export const ATLAS_SEA = "#16222c";
export const ATLAS_IVORY = "#f6f1e3";
export const ATLAS_IVORY_SOFT = "rgba(246,241,227,0.74)";
export const ATLAS_BRASS = "#c9a45a";
export const ATLAS_RULE = "rgba(246,241,227,0.18)";
export const ATLAS_FACE = "Georgia, \"Palatino Linotype\", \"Book Antiqua\", serif";

export const DIPLOMATIC_ATLAS_CHROME = Object.freeze({
  button: {
    background: ATLAS_IVORY,
    border: `1px solid ${ATLAS_IVORY}`,
    borderRadius: "3px",
    color: ATLAS_INK,
    fontFamily: ATLAS_FACE,
    fontWeight: 700,
    letterSpacing: "0.06em",
  },
  arrow: {
    background: "rgba(201,164,90,0.08)",
    border: `1px solid ${ATLAS_BRASS}`,
    borderRadius: "3px",
    color: ATLAS_BRASS,
  },
  dot: { on: ATLAS_BRASS, off: "rgba(246,241,227,0.26)", radius: "1px" },
  skip: { color: ATLAS_IVORY_SOFT, fontFamily: ATLAS_FACE, letterSpacing: "0.04em" },
});
