/*! Open Historia — metric-preserving PTR layout math © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */

export const PTR_REFERENCE_ZOOM = 4;

// Final visual scale for modern territory-fitted polity typography. Placement,
// territory fit, bend, collision/coverage search and zoom fading are resolved
// first; this only contracts the finished support ribbon around its chosen
// center so labels read a little quieter without changing where they belong.
export const POLITY_TEXT_VISUAL_SCALE = 0.88;

export const scalePolityTextSupportPoints = ({
  points,
  center,
  scale = POLITY_TEXT_VISUAL_SCALE,
} = {}) => {
  const source = Array.isArray(points) ? points : [];
  if (source.length < 2) return source;
  const factor = Math.max(0.1, Math.min(1, Number(scale) || POLITY_TEXT_VISUAL_SCALE));
  const cx = Number(center?.[0]);
  const cy = Number(center?.[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return source;
  return source.map(([x, y]) => [
    cx + (Number(x) - cx) * factor,
    cy + (Number(y) - cy) * factor,
  ]);
};
export const PTR_WORLD_PIXELS_AT_REFERENCE_ZOOM = 512 * (2 ** PTR_REFERENCE_ZOOM);

export const planMetricTextSupport = ({
  rasterWidthPx,
  rasterFontSizePx,
  requestedFontPxAtZoom4,
  baselineLength,
  minSupportFraction = 0.86,
  maxSupportFraction = 0.97,
  maxUpscaleFactor = 3.5,
}) => {
  const width = Math.max(1, Number(rasterWidthPx) || 1);
  const rasterFont = Math.max(1, Number(rasterFontSizePx) || 1);
  const requestedFont = Math.max(1, Number(requestedFontPxAtZoom4) || 1);
  const available = Math.max(0, Number(baselineLength) || 0);
  const minFraction = Math.max(0, Math.min(1, Number(minSupportFraction) || 0));
  const maxFraction = Math.max(minFraction, Math.min(1, Number(maxSupportFraction) || 0.97));
  const minSupport = available * minFraction;
  const maxSupport = available * maxFraction;
  const upscaleCap = Math.max(1, Number(maxUpscaleFactor) || 1);

  const requestedWorldUnitsPerRasterPixel = (
    requestedFont / rasterFont
  ) / PTR_WORLD_PIXELS_AT_REFERENCE_ZOOM;
  const naturalSupportLength = width * requestedWorldUnitsPerRasterPixel;

  // PTR-1.4: labels should occupy the polity rather than timidly floating in
  // a small central pocket. Treat the worker font size as a starting point,
  // then expand under-filled labels toward a large share of the legal baseline.
  // The expansion is uniformly metric-preserving and capped so pathological
  // one-character/custom-font names cannot become absurdly huge.
  let supportLength = naturalSupportLength;
  if (available > 0) {
    const largestExpandedSupport = naturalSupportLength * upscaleCap;
    const desiredFloor = Math.min(minSupport, largestExpandedSupport);
    supportLength = Math.max(supportLength, desiredFloor);
    supportLength = Math.min(supportLength, maxSupport);
  }

  const worldUnitsPerRasterPixel = supportLength / width;

  return {
    worldUnitsPerRasterPixel,
    supportLength,
    effectiveFontPxAtZoom4: (
      worldUnitsPerRasterPixel
      * PTR_WORLD_PIXELS_AT_REFERENCE_ZOOM
      * rasterFont
    ),
    naturalSupportLength,
    supportFraction: available > 0 ? supportLength / available : 0,
    naturalSupportFraction: available > 0 ? naturalSupportLength / available : 0,
  };
};


// PTR-1.5: once the worker publishes the polity's actual cartographic envelope,
// typography is sized from territory rather than from the old point-label font
// estimate. The requested name should use most of the available axis, while a
// cross-axis height cap keeps very short names from becoming absurdly huge.
export const planTerritorialTextSupport = ({
  rasterWidthPx,
  rasterHeightPx,
  rasterFontSizePx,
  axisSpanWorld,
  crossSpanWorld,
  targetSpanFraction = 0.93,
  maxHeightFraction = 0.42,
}) => {
  const width = Math.max(1, Number(rasterWidthPx) || 1);
  const height = Math.max(1, Number(rasterHeightPx) || 1);
  const rasterFont = Math.max(1, Number(rasterFontSizePx) || 1);
  const axisSpan = Math.max(0, Number(axisSpanWorld) || 0);
  const crossSpan = Math.max(0, Number(crossSpanWorld) || 0);
  const spanFraction = Math.max(0.5, Math.min(0.995, Number(targetSpanFraction) || 0.93));
  const heightFraction = Math.max(0.1, Math.min(0.8, Number(maxHeightFraction) || 0.42));
  const aspectRatio = width / height;

  const desiredByAxis = axisSpan * spanFraction;
  const maxHeightWorld = crossSpan * heightFraction;
  const maxByHeight = maxHeightWorld > 0 ? maxHeightWorld * aspectRatio : desiredByAxis;
  const supportLength = Math.max(0, Math.min(desiredByAxis, maxByHeight));
  const worldUnitsPerRasterPixel = supportLength / width;

  return {
    supportLength,
    supportFraction: axisSpan > 0 ? supportLength / axisSpan : 0,
    worldUnitsPerRasterPixel,
    effectiveFontPxAtZoom4: (
      worldUnitsPerRasterPixel
      * PTR_WORLD_PIXELS_AT_REFERENCE_ZOOM
      * rasterFont
    ),
    maxHeightWorld,
    aspectRatio,
  };
};

// Where polity text stops as the player zooms in — the same ceiling the
// MapLibre label layers use (LABEL_MAX_ZOOM in Nations.jsx) — and where the
// fade toward it begins. Past the ceiling the map is provinces and cities.
export const POLITY_TEXT_MAX_ZOOM = 6.20;
export const POLITY_TEXT_FADE_OUT_START_ZOOM = 5.00;

export const polityTextOpacityAtZoom = ({
  zoom,
  minZoom = 0,
  maxZoom = POLITY_TEXT_MAX_ZOOM,
  fadeInZoomSpan = 0.18,
  fadeOutStartZoom = POLITY_TEXT_FADE_OUT_START_ZOOM,
} = {}) => {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 0;
  const min = Number.isFinite(Number(minZoom)) ? Number(minZoom) : 0;
  const max = Number.isFinite(Number(maxZoom)) ? Number(maxZoom) : POLITY_TEXT_MAX_ZOOM;
  if (z < min || z > max) return 0;

  const smooth = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };

  const inSpan = Math.max(0, Number(fadeInZoomSpan) || 0);
  const outStart = Math.min(max, Number.isFinite(Number(fadeOutStartZoom))
    ? Number(fadeOutStartZoom)
    : max);

  let opacity = 1;
  if (inSpan > 0 && z < min + inSpan) {
    opacity *= smooth((z - min) / inSpan);
  }
  if (max > outStart && z > outStart) {
    opacity *= 1 - smooth((z - outStart) / (max - outStart));
  }
  return Math.max(0, Math.min(1, opacity));
};
