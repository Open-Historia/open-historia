/*! Open Historia — Swarms: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As the swarms' banner is dressed (Swarms.jsx): a general's map table, its
// green felt and the parchment map laid on it, brass for what is pressed, an
// old book face.

export const SWARMS_TABLE = "#16211a";
export const SWARMS_PAPER = "#eadfc4";
export const SWARMS_PAPER_SOFT = "rgba(234,223,196,0.76)";
export const SWARMS_BRASS = "#d6a83c";
export const SWARMS_SERIF = "Georgia, \"Times New Roman\", serif";

export const SWARMS_CHROME = Object.freeze({
  button: {
    background: SWARMS_BRASS,
    border: `1px solid ${SWARMS_BRASS}`,
    borderRadius: "4px",
    color: SWARMS_TABLE,
    fontFamily: SWARMS_SERIF,
    fontWeight: 700,
    letterSpacing: "0.04em",
  },
  arrow: {
    background: "rgba(234,223,196,0.06)",
    border: `1px solid ${SWARMS_PAPER}`,
    color: SWARMS_PAPER,
  },
  dot: { on: SWARMS_BRASS, off: "rgba(234,223,196,0.3)" },
  skip: { color: SWARMS_PAPER, fontFamily: SWARMS_SERIF, fontStyle: "italic" },
});
