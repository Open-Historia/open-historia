/*! Open Historia — polity-label presentation © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import { POLITY_LABEL_DEFAULT_MAX_ZOOM, polityLabelVisibilityFor } from "../../../runtime/polityLabelVisibility.js";
import { polityTextOpacityAtZoom } from "./polityTextLayout.js";

// Globe projection renders a label's own high-latitude countries oversized
// relative to their outline — confirmed (issue #6) to be text-only (fills
// stay correctly scaled) and tied to each FEATURE's own latitude, not the
// camera's. cos(lat) undoes it; only applied in globe mode; flat/mercator
// keeps the exact same sizing it always has (this factor is 1 at lat 0 and
// visibly wrong in mercator at high latitude, so never enable it there).
const GLOBE_LAT_CORRECTION = ["cos", ["*", ["coalesce", ["get", "lat"], 0], Math.PI / 180]];

// How a country label is sized, and why its opacity is tied to that size.
//
// MapLibre draws a label from two sizes per tile — this expression evaluated at
// the tile's zoom and at one level above — mixed by the zoom in between, and it
// packs each of those sizes into 8 bits: 255 px is the most a glyph is ever
// drawn at (symbol_size.ts MAX_GLYPH_ICON_SIZE). Two things follow.
//
// 1. The stops are every integer zoom, each the uncapped size at that zoom, so
//    the two sizes the engine mixes are exactly one level and exactly 2× apart
//    and a label doubles with the map, as if painted on it. The first version
//    had stops four levels apart with a pixel cap inside them; the engine then
//    mixed an honest z4 size toward a clamped z8 one across the whole interval,
//    and every label crept while the map doubled — the field report "labels
//    shrink as you zoom in". Dropping the app's cap changed nothing, because the
//    engine's own 255 px clamp did the same to the z8 stop.
//
// 2. A label has to be GONE before its size reaches that clamp, or the clamp
//    reappears as the same creep in its last level. So buildCountryTextOpacity
//    ties text-opacity to the size this expression yields: a label fades out
//    between LABEL_FADE_START_PX and LABEL_FADE_END_PX at whatever zoom it gets
//    there, on top of each layer's own zoom ramp (which is how the small
//    labels, which never grow that big, leave). Fading, never shrinking.
const LABEL_FADE_START_PX = 140;
const LABEL_FADE_END_PX = 230;
const LABEL_SIZE_STOP_ZOOMS = Array.from({ length: 25 }, (_, zoom) => zoom);
// Opacity is read by the engine at the tile's zoom and one above, so half-level
// stops are as fine as it can use; each ramp's own stops are merged in by the
// builder so no ramp corner is skipped.
const labelOpacityStopZooms = (maxZoom) => Array.from({ length: Math.ceil((Math.max(8, maxZoom) - 2) * 2) + 1 }, (_, index) => 2 + index * 0.5);

const countryTextScale = (multiplier, correctForGlobe) =>
  (correctForGlobe ? ["*", multiplier, GLOBE_LAT_CORRECTION] : multiplier);

// The size at one zoom, as an expression over the feature's own scale property.
const countryTextSizeAt = (zoom, multiplier, correctForGlobe, scaleProperty, { safe = false } = {}) => [
  "*",
  countryTextScale(multiplier, correctForGlobe),
  ["*", safe ? ["coalesce", ["get", scaleProperty], 0] : ["get", scaleProperty], 2 ** (zoom - 16)],
];

export const buildCountryTextSize = (
  multiplier = 1,
  correctForGlobe = false,
  scaleProperty = "areaScale",
) => [
  "interpolate", ["exponential", 2], ["zoom"],
  ...LABEL_SIZE_STOP_ZOOMS.flatMap((zoom) => [zoom, countryTextSizeAt(zoom, multiplier, correctForGlobe, scaleProperty)]),
];

// A [zoom, value, zoom, value, …] ramp read at one zoom: piecewise-linear, held
// flat beyond its ends.
const rampValueAt = (ramp, zoom) => {
  if (zoom <= ramp[0]) return ramp[1];
  for (let index = 2; index < ramp.length; index += 2) {
    if (zoom <= ramp[index]) {
      const fromZoom = ramp[index - 2];
      const fromValue = ramp[index - 1];
      const toZoom = ramp[index];
      const toValue = ramp[index + 1];
      return fromValue + ((toValue - fromValue) * (zoom - fromZoom)) / (toZoom - fromZoom);
    }
  }
  return ramp[ramp.length - 1];
};

// text-opacity for a label layer: the layer's zoom ramp times a fade keyed to
// the label's own size — the same expression as its text-size, so the two agree
// — which has it transparent before the engine would clamp it.
export const buildCountryTextOpacity = (
  ramp,
  multiplier = 1,
  correctForGlobe = false,
  scaleProperty = "areaScale",
  cutoff = POLITY_LABEL_DEFAULT_MAX_ZOOM,
) => {
  const visibility = polityLabelVisibilityFor(cutoff);
  const { maxZoom, fadeOutStartZoom } = visibility;
  const rampZooms = ramp.filter((_, index) => index % 2 === 0);
  const zooms = [...new Set([...labelOpacityStopZooms(maxZoom), ...rampZooms, fadeOutStartZoom, maxZoom])].sort((left, right) => left - right);
  // The shipped legacy ramp ended abruptly at its layer ceiling, unlike PTR.
  // Preserve its exact sampled alpha below the default cutoff. Customized
  // cutoffs smoothly fade using the shared policy, with the safety fade intact.
  const gateAt = (zoom) => maxZoom === POLITY_LABEL_DEFAULT_MAX_ZOOM
    ? (zoom <= ramp[ramp.length - 2] ? 1 : 0)
    : polityTextOpacityAtZoom({ zoom, minZoom: 0, fadeInZoomSpan: 0, ...visibility });
  const fadeAt = (zoom) => [
    "min", 1,
    ["max", 0, [
      "/",
      ["-", LABEL_FADE_END_PX, countryTextSizeAt(zoom, multiplier, correctForGlobe, scaleProperty, { safe: true })],
      LABEL_FADE_END_PX - LABEL_FADE_START_PX,
    ]],
  ];
  return [
    "interpolate", ["linear"], ["zoom"],
    ...zooms.flatMap((zoom) => [zoom, ["*", Number((rampValueAt(ramp, zoom) * gateAt(zoom)).toFixed(4)), fadeAt(zoom)]]),
  ];
};

// These are ascending base ramps. The cutoff is applied separately; the old
// 6.2 endpoint following 7.0 (or 6.95) was not a valid final ramp segment.
export const STOCK_LABEL_RAMP = Object.freeze([4, 0.98, 5.8, 0.90, 7.0, 0.52]);
export const CUSTOM_CURVED_LABEL_RAMP = Object.freeze([3.85, 0, 4.15, 0.98, 5.8, 0.90, 7.0, 0.52]);
export const LIVE_LABEL_RAMP = Object.freeze([2.0, 0.90, 3.2, 0.985, 5.8, 0.96, 6.95, 0.72]);
