/*! Open Historia — local polity label visibility © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
export const POLITY_LABEL_DEFAULT_MAX_ZOOM = 6.2;
export const POLITY_LABEL_DEFAULT_FADE_START = 5;
export const POLITY_LABEL_MIN_ZOOM = 5;
export const POLITY_LABEL_MAX_ZOOM = 9;
export const POLITY_LABEL_ZOOM_STEP = 0.1;

// One normalization policy for persisted strings, slider values and paint.
// Missing, empty or malformed input uses the exact existing default.
export const normalizePolityLabelMaxZoom = (value) => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return POLITY_LABEL_DEFAULT_MAX_ZOOM;
  const n = Number(value);
  if (!Number.isFinite(n)) return POLITY_LABEL_DEFAULT_MAX_ZOOM;
  return Math.round(Math.max(POLITY_LABEL_MIN_ZOOM, Math.min(POLITY_LABEL_MAX_ZOOM, n)) * 10) / 10;
};

export const polityLabelVisibilityFor = (value) => {
  const maxZoom = normalizePolityLabelMaxZoom(value);
  const fadeSpan = POLITY_LABEL_DEFAULT_MAX_ZOOM - POLITY_LABEL_DEFAULT_FADE_START;
  return { maxZoom, fadeOutStartZoom: Math.round((maxZoom - fadeSpan) * 10) / 10 };
};
