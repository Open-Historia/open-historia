/*! Open Historia - Campaign records notice chrome, AGPL-3.0-or-later (see LICENSE). */
export const RECORDS = Object.freeze({
  ground: "#25221d", panel: "#302c25", ink: "#30271d", paper: "#e9ddc5",
  soft: "#c9bca6", line: "#64533a", accent: "#dfad69", red: "#9d4a40", green: "#638467",
});
export const CAMPAIGN_RECORDS_CHROME = Object.freeze({
  button: { background: RECORDS.accent, color: RECORDS.ink, border: "1px solid " + RECORDS.accent, borderRadius: "2px", fontWeight: 800, fontFamily: "Georgia, serif" },
  arrow: { background: RECORDS.panel, color: RECORDS.accent, border: "1px solid " + RECORDS.line, borderRadius: "2px" },
  dot: { on: RECORDS.accent, off: RECORDS.line, radius: "1px" },
  skip: { color: RECORDS.soft, fontFamily: "Georgia, serif" },
});
