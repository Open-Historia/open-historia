import { useSyncExternalStore } from "react";

// Device-local UI chrome only. Never feed these colors into canonical state,
// map ownership, relations, party identities or other semantic indicators.
export const UI_THEME_STORAGE_KEY = "openhistoria:ui-theme:v1";
export const DEFAULT_UI_THEME = "default";
export const UI_THEME_PRESETS = Object.freeze([
  Object.freeze({ id: "midnight", name: "Midnight Navy", colors: Object.freeze({ background: "#111D2A", surface: "#20364A", accent: "#85CBE6" }) }),
  Object.freeze({ id: "graphite", name: "Graphite", colors: Object.freeze({ background: "#15171B", surface: "#30343B", accent: "#BAC6D2" }) }),
  Object.freeze({ id: "forest", name: "Forest", colors: Object.freeze({ background: "#121E19", surface: "#283C32", accent: "#78C8A1" }) }),
  Object.freeze({ id: "oxblood", name: "Oxblood", colors: Object.freeze({ background: "#21171B", surface: "#3D2830", accent: "#DA929E" }) }),
  Object.freeze({ id: "sepia", name: "Sepia", colors: Object.freeze({ background: "#241F19", surface: "#403528", accent: "#D6B77D" }) }),
]);

const preset = (id) => UI_THEME_PRESETS.find((item) => item.id === id);
const defaultCustom = () => ({ ...preset("midnight").colors });
const textColor = "#EEF3F7";
const entries = ["background", "surface", "accent"];

export function normalizeUiColor(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (/^#[\da-f]{6}$/i.test(cleaned)) return cleaned.toUpperCase();
  if (/^#[\da-f]{3}$/i.test(cleaned)) return "#" + [...cleaned.slice(1)].map((ch) => ch + ch).join("").toUpperCase();
  return null;
}
const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const channel = (n) => {
  const value = n / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
};
export function uiContrastRatio(a, b) {
  const first = normalizeUiColor(a);
  const second = normalizeUiColor(b);
  if (!first || !second) return 0;
  const luminance = (color) => {
    const [r, g, b] = rgb(color).map(channel);
    return r * .2126 + g * .7152 + b * .0722;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}
export function validateUiPalette(colors) {
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return "Enter all three theme colors.";
  const normalized = Object.fromEntries(entries.map((name) => [name, normalizeUiColor(colors[name])]));
  if (entries.some((name) => !normalized[name])) return "Use six-digit hexadecimal colors.";
  if (uiContrastRatio(normalized.background, textColor) < 7 || uiContrastRatio(normalized.surface, textColor) < 7) {
    return "Background and surface are too bright for readable text.";
  }
  if (uiContrastRatio(normalized.accent, normalized.background) < 4.5
    || uiContrastRatio(normalized.accent, normalized.surface) < 4.5) {
    return "Accent needs more contrast against both backgrounds.";
  }
  return "";
}
export function normalizeUiTheme(value) {
  const selection = typeof value?.preset === "string" && (preset(value.preset) || value.preset === "custom" || value.preset === DEFAULT_UI_THEME)
    ? value.preset : DEFAULT_UI_THEME;
  const raw = value?.custom;
  const custom = Object.fromEntries(entries.map((name) => [name, normalizeUiColor(raw?.[name]) || defaultCustom()[name]]));
  return Object.freeze({
    preset: selection,
    custom: Object.freeze(validateUiPalette(custom) ? defaultCustom() : custom),
  });
}
export function uiThemeColors(theme) {
  return theme.preset === "custom" ? theme.custom : preset(theme.preset)?.colors || preset("midnight").colors;
}
const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0").toUpperCase();
const mix = (a, b, amount) => {
  const first = rgb(a), second = rgb(b);
  return "#" + first.map((n, index) => hex(n * (1 - amount) + second[index] * amount)).join("");
};
const translucent = (color, alpha) => `rgba(${rgb(color).join(", ")}, ${alpha})`;
export function uiThemeTokens(theme) {
  const normalized = normalizeUiTheme(theme);
  if (normalized.preset === DEFAULT_UI_THEME) return {};
  const colors = uiThemeColors(normalized);
  return {
    "--oh-ui-bg": colors.background,
    "--oh-ui-surface": colors.surface,
    "--oh-ui-accent": colors.accent,
    "--oh-ui-raised": mix(colors.surface, "#FFFFFF", .055),
    "--oh-ui-header": mix(colors.background, "#000000", .32),
    "--oh-ui-active": mix(colors.surface, colors.accent, .19),
    "--oh-ui-hover": mix(colors.surface, colors.accent, .11),
    "--oh-ui-text": textColor,
    "--oh-ui-muted": "#B4C4D0",
    "--oh-ui-line": mix(colors.surface, "#9AC0D1", .26),
    "--oh-ui-focus": colors.accent,
    // Floating panels keep the map visible under the chosen palette.
    "--oh-ui-overlay": translucent(colors.background, .86),
    "--oh-ui-overlay-strong": translucent(colors.background, .94),
    "--oh-ui-overlay-card": translucent(colors.surface, .68),
    "--oh-ui-overlay-header": translucent(colors.surface, .78),
    // Existing neutral-token consumers (Actions, Projects, authoring tools);
    // never replace HUD/map, political/relationship or military colors.
    "--oh-grey-bg": colors.background,
    "--oh-grey-surface": colors.surface,
    "--oh-grey-raised": mix(colors.surface, "#FFFFFF", .055),
    "--oh-grey-selected": mix(colors.background, "#000000", .2),
    "--oh-grey-border": mix(colors.surface, "#9AC0D1", .26),
    "--oh-grey-border-strong": mix(colors.surface, "#9AC0D1", .48),
    "--oh-grey-text": textColor,
    "--oh-grey-muted": "#B4C4D0",
    "--oh-grey-faint": "#839AAA",
    // The HUD's glass (styles.css): the menu button, the session pill and Exit
    // Game, the date widget, the dock, the search field, the Advisor button and
    // the map-mode switch, tinted by the palette and still see-through. Its
    // text and its blue/amber/red signals are not chrome and stay.
    "--oh-hud-bg": translucent(colors.background, .58),
    "--oh-hud-bg-strong": translucent(colors.background, .72),
    "--oh-hud-bg-soft": translucent(colors.surface, .5),
    "--oh-hud-border": translucent(mix(colors.surface, "#FFFFFF", .55), .2),
    "--oh-hud-border-strong": translucent(mix(colors.surface, "#FFFFFF", .6), .32),
    // Buttons on the glass: resting, hovered, chosen.
    "--oh-ui-glass-pill": translucent(colors.surface, .6),
    "--oh-ui-glass-chip": translucent(mix(colors.surface, "#FFFFFF", .08), .42),
    "--oh-ui-glass-line": translucent(mix(colors.surface, "#FFFFFF", .5), .16),
    "--oh-ui-glass-hover": translucent(mix(colors.surface, colors.accent, .3), .55),
    "--oh-ui-glass-active": translucent(colors.accent, .22),
    "--oh-ui-glass-active-line": translucent(colors.accent, .45),
    "--oh-ui-glass-active-text": mix(colors.accent, "#FFFFFF", .3),
  };
}
const base = Object.freeze(normalizeUiTheme({ preset: DEFAULT_UI_THEME }));
let current = base;
let installed = false;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());
const storage = () => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};
const readStored = () => {
  try {
    const raw = storage()?.getItem(UI_THEME_STORAGE_KEY);
    return raw ? normalizeUiTheme(JSON.parse(raw)) : base;
  } catch { return base; }
};
// Removing inline token overrides restores each panel's own authored colors,
// including existing :root neutral values. "Default" is not a new palette.
const themeTokenNames = Object.keys(uiThemeTokens({ preset: "midnight" }));
export function applyUiTheme(theme, root = typeof document !== "undefined" ? document.documentElement : null) {
  if (!root?.style) return;
  const normalized = normalizeUiTheme(theme);
  root.setAttribute("data-oh-ui-theme", normalized.preset);
  if (normalized.preset === DEFAULT_UI_THEME) {
    for (const name of themeTokenNames) root.style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(uiThemeTokens(normalized))) root.style.setProperty(name, value);
}
const update = (next, persist = true) => {
  current = normalizeUiTheme(next);
  applyUiTheme(current);
  if (persist) {
    try { storage()?.setItem(UI_THEME_STORAGE_KEY, JSON.stringify(current)); } catch { /* Works in memory when storage is unavailable. */ }
  }
  emit();
  return current;
};
export function installUiTheme() {
  if (installed) return;
  installed = true;
  update(readStored(), false);
  if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
    if (event.key === UI_THEME_STORAGE_KEY || event.key === null) update(readStored(), false);
  });
}
export const getUiTheme = () => current;
export const subscribeUiTheme = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
export const useUiTheme = () => useSyncExternalStore(subscribeUiTheme, getUiTheme, () => base);
export function selectUiTheme(id) {
  if (!preset(id) && id !== "custom" && id !== DEFAULT_UI_THEME) return false;
  update({ ...current, preset: id });
  return true;
}
export function setCustomUiThemeColor(name, value) {
  if (!entries.includes(name)) return "Unknown theme color.";
  const normalized = normalizeUiColor(value);
  if (!normalized) return "Use a hexadecimal color.";
  const custom = { ...current.custom, [name]: normalized };
  const problem = validateUiPalette(custom);
  if (problem) return problem;
  update({ preset: "custom", custom });
  return "";
}
export function resetUiTheme() {
  update({ preset: DEFAULT_UI_THEME, custom: defaultCustom() });
}
