/*! Open Historia — Espionage, Part 2: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

export const SPY_NIGHT = "#0c1115";
export const SPY_STREET = "#1a252d";
export const SPY_BLOCK = "#131b21";
export const SPY_PAPER = "#e8e2d0";
export const SPY_PAPER_SOFT = "rgba(232,226,208,0.74)";
export const SPY_RED = "#c8483a";
export const SPY_LAMP = "#e0a83a";
export const SPY_TYPE = "ui-monospace, \"Courier New\", Consolas, monospace";

export const ESPIONAGE_2_CHROME = Object.freeze({
  button: {
    background: SPY_RED,
    border: `1px solid ${SPY_RED}`,
    borderRadius: "2px",
    color: SPY_PAPER,
    fontFamily: SPY_TYPE,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  arrow: {
    background: "rgba(232,226,208,0.05)",
    border: `1px solid ${SPY_PAPER}`,
    borderRadius: "2px",
    color: SPY_PAPER,
  },
  dot: { on: SPY_RED, off: "rgba(232,226,208,0.28)", radius: "1px" },
  skip: { color: SPY_PAPER, fontFamily: SPY_TYPE, letterSpacing: "0.06em" },
});
