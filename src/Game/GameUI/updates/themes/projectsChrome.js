/*! Open Historia — Projects That Build: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the projects update's banners are dressed (Projects.jsx): a drafting
// table at night, its paper lines pale, and the builder's yellow of a site
// sign for what moves. Square corners like a ruled sheet, a drafting hand.

export const PLAN_GROUND = "#11181c";
export const PLAN_GRID = "#1b252b";
export const PLAN_LINE = "#d6e2e6";
export const PLAN_SOFT = "rgba(214,226,230,0.72)";
export const PLAN_FAINT = "rgba(214,226,230,0.3)";
export const PLAN_YELLOW = "#f2b33d";
export const PLAN_COIN = "#e8c35a";
export const PLAN_RED = "#e2604a";
export const PLAN_FACE = "\"Bahnschrift\", \"DIN Alternate\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif";

export const PROJECTS_CHROME = Object.freeze({
  button: {
    background: PLAN_YELLOW,
    border: `1px solid ${PLAN_YELLOW}`,
    borderRadius: "2px",
    color: "#15130c",
    fontFamily: PLAN_FACE,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  arrow: {
    background: "rgba(242,179,61,0.08)",
    border: `1px solid ${PLAN_YELLOW}`,
    borderRadius: "2px",
    color: PLAN_YELLOW,
  },
  dot: { on: PLAN_YELLOW, off: "rgba(214,226,230,0.28)", radius: "1px" },
  skip: { color: PLAN_SOFT, fontFamily: PLAN_FACE, letterSpacing: "0.08em", textTransform: "uppercase" },
});
