/*! Open Historia — The AI overhaul: the way between its banners © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The update that made the AI leaner and longer of memory is drawn as a signal
// desk at night: a slate ground, hairline circuits, the game's own cyan as the
// signal, and a monospaced hand for the read-outs. Square-cornered keys like a
// console's, the markers as small lit diodes.

export const AI_GROUND = "#0c1317";
export const AI_PANEL = "#121c22";
export const AI_SIGNAL = "#2bc1f3";
export const AI_WARM = "#f2b84b";
export const AI_INK = "#eef4f7";
export const AI_SOFT = "rgba(238,244,247,0.72)";
export const AI_FAINT = "rgba(238,244,247,0.22)";
export const AI_LINE = "rgba(43,193,243,0.28)";
export const AI_FACE = "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif";
export const AI_MONO = "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, \"Liberation Mono\", monospace";

export const AI_OVERHAUL_CHROME = Object.freeze({
  button: {
    background: AI_SIGNAL,
    border: `1px solid ${AI_SIGNAL}`,
    borderRadius: "4px",
    color: "#03141c",
    fontFamily: AI_MONO,
    fontWeight: 800,
    letterSpacing: "0.06em",
  },
  arrow: {
    background: "rgba(43,193,243,0.08)",
    border: `1px solid ${AI_LINE}`,
    borderRadius: "4px",
    color: AI_SIGNAL,
  },
  dot: { on: AI_SIGNAL, off: "rgba(238,244,247,0.22)", radius: "2px" },
  skip: { color: AI_SOFT, fontFamily: AI_MONO, letterSpacing: "0.06em" },
});
