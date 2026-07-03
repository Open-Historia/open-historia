/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Shared dark-glass UI constants for the map editor, matching the game's GameUI
// look (rgba(17,24,39,.9) surfaces, blur, white text, blue accent #3b82f6).

export const ACCENT = "#3b82f6";
export const ACCENT_RGB = [59, 130, 246];

export const panelSurface = {
  backgroundColor: "rgba(17, 24, 39, 0.92)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.12)",
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
  background: active ? "rgba(59,130,246,0.55)" : "rgba(255,255,255,0.06)",
  border: active ? "1px solid rgba(59,130,246,0.9)" : "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: disabled ? "rgba(255,255,255,0.3)" : "white",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: "13px",
  fontWeight: 600,
  transition: "background 0.12s, border 0.12s",
});

export const pillButton = (active) => ({
  background: active ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
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
