/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Shared UI constants for the map editor: flat dark grey, no glass. Glass is
// for the HUD, where there is a map behind it to see; the Workshop's panels sit
// over the map the player is DRAWING, and a translucent panel over that is just
// harder to read.

export const ACCENT = "var(--oh-ui-accent, #e7e7ea)";
export const ACCENT_RGB = [231, 231, 234];

export const EDITOR_NAV = "var(--oh-ui-header, #0d0f14)";
export const EDITOR_PANEL = "var(--oh-ui-surface, #12141a)";
export const EDITOR_CARD = "var(--oh-ui-raised, #171a22)";

export const panelSurface = {
  backgroundColor: EDITOR_PANEL,
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.09))",
  borderRadius: "16px",
  color: "var(--oh-ui-text, white)",
  fontFamily: "sans-serif",
  boxShadow: "0 14px 32px rgba(0,0,0,0.45)",
};

export const toolButton = (active, disabled) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  minWidth: "34px",
  height: "36px",
  padding: "0 8px",
  background: active ? "var(--oh-ui-active, rgba(255,255,255,0.12))" : "var(--oh-ui-raised, rgba(255,255,255,0.04))",
  border: active ? "1px solid var(--oh-ui-focus, rgba(255,255,255,0.26))" : "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))",
  borderRadius: "10px",
  boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 6px 16px rgba(0,0,0,0.28)" : "none",
  color: disabled ? "rgba(255,255,255,0.28)" : active ? "var(--oh-ui-text, #fff)" : "var(--oh-ui-muted, rgba(236,236,240,0.78))",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: "13px",
  fontWeight: 600,
  transition: "background 0.15s, border-color 0.15s",
});

export const pillButton = (active) => ({
  background: active ? "var(--oh-ui-active, rgba(255,255,255,0.12))" : "var(--oh-ui-raised, rgba(255,255,255,0.06))",
  border: active ? "1px solid var(--oh-ui-focus, rgba(255,255,255,0.26))" : "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
  borderRadius: "9px",
  color: "var(--oh-ui-text, white)",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
  padding: "6px 11px",
});

export const navButton = (active) => ({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  minHeight: "34px",
  padding: "0 10px",
  background: active ? "var(--oh-ui-active, rgba(255,255,255,0.1))" : "transparent",
  border: active ? "1px solid var(--oh-ui-line, rgba(255,255,255,0.18))" : "1px solid transparent",
  borderRadius: "9px",
  color: active ? "var(--oh-ui-text, #fff)" : "var(--oh-ui-muted, rgba(236,236,240,0.74))",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: active ? 700 : 600,
  textAlign: "left",
});

export const sectionLabel = {
  color: "var(--oh-ui-muted, rgba(255,255,255,0.4))",
  fontSize: "10.5px",
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
};

export const inputStyle = {
  width: "100%",
  padding: "0.5rem 0.65rem",
  borderRadius: "10px",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))",
  backgroundColor: "var(--oh-ui-raised, rgba(255,255,255,0.04))",
  color: "var(--oh-ui-text, white)",
  fontSize: "0.85rem",
  outline: "none",
  boxSizing: "border-box",
};

export const labelDim = {
  color: "var(--oh-ui-muted, rgba(255,255,255,0.55))",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};
