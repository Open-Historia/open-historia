/*! Open Historia — Themes: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The update about themes is dressed in the player's own: its accent is the
// interface theme's (runtime/uiTheme.js --oh-ui-accent), and without one a
// painter's ochre. A painter's studio otherwise: charcoal ground, round
// pills like paint chips, a plain sans hand.

export const THEMES_GROUND = "#121418";
export const THEMES_CARD = "#1a1d23";
export const THEMES_OCHRE = "#E8B04B";
export const THEMES_ACCENT = `var(--oh-ui-accent, ${THEMES_OCHRE})`;
export const THEMES_INK = "#f3f1ec";
export const THEMES_SOFT = "rgba(243,241,236,0.72)";
export const THEMES_FAINT = "rgba(243,241,236,0.3)";
export const THEMES_FACE = "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif";

export const THEMES_CHROME = Object.freeze({
  button: {
    background: THEMES_ACCENT,
    border: `1px solid ${THEMES_ACCENT}`,
    borderRadius: "999px",
    color: "#14110b",
    fontFamily: THEMES_FACE,
    fontWeight: 800,
    letterSpacing: "0.01em",
  },
  arrow: {
    background: "rgba(243,241,236,0.06)",
    border: `1px solid ${THEMES_ACCENT}`,
    borderRadius: "999px",
    color: THEMES_ACCENT,
  },
  dot: { on: THEMES_ACCENT, off: "rgba(243,241,236,0.26)", radius: "999px" },
  skip: { color: THEMES_SOFT, fontFamily: THEMES_FACE, letterSpacing: "0.01em" },
});
