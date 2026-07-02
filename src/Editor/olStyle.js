/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Region -> OpenLayers Style mapping for the map editor.
//
// One VectorLayer + one style function for all regions (not one layer per type):
// required so Snap/Select bind to a single source, and so styles can be cached.
// Fill comes from the region's owner color (colors.json) or the type's override
// color; opacity switches on owned vs unowned; stroke + draw order come from the
// region's type. Styles are memoised per (typeId|owner|selected|band) — there are
// only dozens of distinct combinations even across thousands of regions.

import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import { ACCENT_RGB } from "./editorStyles.js";

const NEUTRAL = [130, 130, 138];

const asRgb = (v) => (Array.isArray(v) ? v : NEUTRAL);
const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

// Deterministic pleasant color for owners missing from the palette — the same
// hash the game/exporter use, so EVERY owner is visually distinct on the map
// (no more shared neutral gray for uncurated codes or custom polities).
const fallbackColorCache = new Map();
const codeToColor = (code) => {
  const hit = fallbackColorCache.get(code);
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = 0.5;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.25;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const rgb = [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  fallbackColorCache.set(code, rgb);
  return rgb;
};

export const FALLBACK_TYPE = {
  id: "land",
  opacity: 0.55,
  unownedOpacity: 0.25,
  zIndex: 1,
  strokeWidth: 1.5,
  strokeColor: [0, 0, 0],
  strokeOpacity: 1,
  overrideColor: null,
  zoomSettings: [{ minZoom: 0, maxZoom: 24 }],
};

// Pick the active zoom band for a type at the given zoom (or null if hidden).
export const pickZoomBand = (type, zoom) => {
  const bands = type?.zoomSettings;
  if (!Array.isArray(bands) || bands.length === 0) return {};
  for (const band of bands) {
    const min = band.minZoom ?? 0;
    const max = band.maxZoom ?? 24;
    if (zoom >= min && zoom <= max) return band;
  }
  return null; // outside every band -> hidden
};

// Returns an OL style function. Dependencies are read through getters so the same
// function stays valid as the document/colors/selection change (call
// layer.changed() to restyle). getSelectedIds/getZoom are optional.
export const makeRegionStyle = ({ getTypesById, getColors, getSelectedIds, getZoom }) => {
  const cache = new Map();
  let cachedPalette = null;
  return (feature, resolution) => {
    // Styles are memoised per owner, so a palette swap (e.g. a scenario's own
    // colors.json arriving after load) must drop the cache or fills go stale.
    const palette = getColors();
    if (palette !== cachedPalette) {
      cachedPalette = palette;
      cache.clear();
    }
    const typeId = feature.get("typeId") || "land";
    const type = getTypesById()[typeId] || FALLBACK_TYPE;
    const owner = feature.get("owner") || null;
    const selected = getSelectedIds ? getSelectedIds().has(feature.getId()) : false;

    let band = {};
    let bandKey = "b";
    if (getZoom) {
      const zoom = getZoom(resolution);
      band = pickZoomBand(type, zoom);
      if (band === null) return null; // hidden at this zoom
      bandKey = `${band.minZoom ?? 0}-${band.maxZoom ?? 24}`;
    }

    const key = `${typeId}|${owner || "-"}|${selected ? 1 : 0}|${bandKey}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const fillRgb = type.overrideColor
      ? asRgb(type.overrideColor)
      : owner
        ? asRgb(palette[owner] || codeToColor(owner))
        : NEUTRAL;
    const baseAlpha = owner ? (band.opacity ?? type.opacity) : type.unownedOpacity;
    const alpha = selected ? Math.min(1, baseAlpha + 0.22) : baseAlpha;

    const strokeRgb = selected ? ACCENT_RGB : asRgb(type.strokeColor);
    const strokeWidth = selected
      ? Math.max(2.25, (band.strokeWidth ?? type.strokeWidth) + 1)
      : band.strokeWidth ?? type.strokeWidth;

    const style = new Style({
      zIndex: selected ? 999 : type.zIndex ?? 1,
      fill: new Fill({ color: rgba(fillRgb, alpha) }),
      stroke: new Stroke({
        color: rgba(strokeRgb, type.strokeOpacity ?? 1),
        width: strokeWidth,
      }),
    });
    cache.set(key, style);
    return style;
  };
};
