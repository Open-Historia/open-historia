/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Shared UI constants for the map editor: flat dark grey, no glass. Glass is
// for the HUD, where there is a map behind it to see; the Workshop's panels sit
// over the map the player is DRAWING, and a translucent panel over that is just
// harder to read. A selected control reads darker than its neighbours rather
// than brighter — nothing here glows to say it is chosen.

export const ACCENT = "#e7e7ea";
export const ACCENT_RGB = [231, 231, 234];

export const panelSurface = {
  backgroundColor: "#1b1b1e",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "white",
  fontFamily: "sans-serif",
  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
};

export const toolButton = (active, disabled) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  minWidth: "34px",
  height: "34px",
  padding: "0 8px",
  background: active ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.06)",
  border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: disabled ? "rgba(255,255,255,0.3)" : "white",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: "13px",
  fontWeight: 600,
  transition: "background 0.12s, border 0.12s",
});

export const pillButton = (active) => ({
  background: active ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.08)",
  border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.15)",
  borderRadius: "7px",
  color: "white",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
  padding: "5px 9px",
});

export const inputStyle = {
  width: "100%",
  padding: "0.5rem 0.6rem",
  borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.16)",
  backgroundColor: "rgba(0,0,0,0.28)",
  color: "white",
  fontSize: "0.85rem",
  outline: "none",
  boxSizing: "border-box",
};

export const labelDim = {
  color: "rgba(255,255,255,0.55)",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};
