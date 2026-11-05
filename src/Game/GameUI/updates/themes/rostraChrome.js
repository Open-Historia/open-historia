/*! Open Historia — Rostra: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// As Rostra's banners are dressed (Rostra.jsx): the app's own slate and its
// accent, round pills like its Post button, and a plain sans hand.

export const ROSTRA_GROUND = "#0e1418";
export const ROSTRA_CARD = "#151d22";
export const ROSTRA_ACCENT = "#2bc1f3";
export const ROSTRA_INK = "#eef3f5";
export const ROSTRA_SOFT = "rgba(238,243,245,0.7)";
export const ROSTRA_FAINT = "rgba(238,243,245,0.32)";
export const ROSTRA_FACE = "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif";

export const ROSTRA_CHROME = Object.freeze({
  button: {
    background: ROSTRA_ACCENT,
    border: `1px solid ${ROSTRA_ACCENT}`,
    borderRadius: "999px",
    color: "#06171d",
    fontFamily: ROSTRA_FACE,
    fontWeight: 800,
    letterSpacing: "0.01em",
  },
  arrow: {
    background: "rgba(43,193,243,0.08)",
    border: `1px solid ${ROSTRA_ACCENT}`,
    borderRadius: "999px",
    color: ROSTRA_ACCENT,
  },
  dot: { on: ROSTRA_ACCENT, off: "rgba(238,243,245,0.26)", radius: "999px" },
  skip: { color: ROSTRA_SOFT, fontFamily: ROSTRA_FACE, letterSpacing: "0.01em" },
});
