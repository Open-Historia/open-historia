/*! Open Historia — portions (custom-region owner labels) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import {
  PMTILES_ARCHIVES,
  decodeVectorTile,
  getPmtilesArchive,
  readRuntimeJson,
  resolveCountryDisplayName,
  writeRuntimeJson,
} from "./assets.js";
import { getStoredLanguage } from "./i18n.js";
import { translateLabel } from "./translator.js";

// v3: label features now carry `lat` (globe text-size correction, issue #6) —
// bumped so returning users' persisted v2 cache (no `lat`) doesn't silently
// serve pre-fix data forever.
const COUNTRY_LABELS_CACHE_KEY = "country-labels-v3";
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const EMPTY_COUNTRY_LABELS = {
  curvedLabelData: EMPTY_FEATURE_COLLECTION,
  pointLabelData: EMPTY_FEATURE_COLLECTION,
};

let countryLabelsPromise = null;
let countryLabelsPromiseKey = null;
let countryLabelsValue = null;
let countryLabelsValueKey = null;
let regionLabelGeometryPromise = null;
let regionLabelGeometryKey = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const calculateArea = (ring) => {
  let area = 0;
  if (!ring || ring.length < 3) return 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }

  return Math.abs(area / 2);
};

const getCentroid = (ring) => {
  let x = 0;
  let y = 0;
  let area = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p1 = ring[i];
    const p2 = ring[j];
    const factor = p1[0] * p2[1] - p2[0] * p1[1];
    area += factor;
    x += (p1[0] + p2[0]) * factor;
    y += (p1[1] + p2[1]) * factor;
  }

  const scale = (area * 3) || 1;
  return { cx: x / scale, cy: y / scale };
};

const getPrincipalAxisMetrics = (ring) => {
  if (!ring || ring.length < 3) {
    return { angle: 0, axisSpan: 0, crossSpan: 0 };
  }

  let mx = 0;
  let my = 0;
  for (const point of ring) {
    mx += point[0];
    my += point[1];
  }
  mx /= ring.length;
  my /= ring.length;

  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
  for (const point of ring) {
    const dx = point[0] - mx;
    const dy = point[1] - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }

  let angleRad = Math.atan2(2 * cxy, cxx - cyy) / 2;
  const projectedSpan = (angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minAxis = Infinity;
    let maxAxis = -Infinity;
    let minCross = Infinity;
    let maxCross = -Infinity;

    for (const point of ring) {
      const dx = point[0] - mx;
      const dy = point[1] - my;
      const axis = dx * cos + dy * sin;
      const cross = -dx * sin + dy * cos;
      minAxis = Math.min(minAxis, axis);
      maxAxis = Math.max(maxAxis, axis);
      minCross = Math.min(minCross, cross);
      maxCross = Math.max(maxCross, cross);
    }

    return {
      axisSpan: Math.max(0, maxAxis - minAxis),
      crossSpan: Math.max(0, maxCross - minCross),
    };
  };

  let spans = projectedSpan(angleRad);
  // Principal covariance occasionally picks the visually shorter dimension for
  // near-square/coast-heavy shapes. A country label should follow the dominant
  // cartographic span, so rotate 90° when the projected cross span is longer.
  if (spans.crossSpan > spans.axisSpan) {
    angleRad += Math.PI / 2;
    spans = projectedSpan(angleRad);
  }

  let degrees = angleRad * (180 / Math.PI);
  while (degrees > 90) degrees -= 180;
  while (degrees < -90) degrees += 180;

  return {
    angle: degrees,
    axisSpan: spans.axisSpan,
    crossSpan: spans.crossSpan,
  };
};

const getPrincipalAxisAngle = (ring) => getPrincipalAxisMetrics(ring).angle;

const tileToLngLat = (px, py, extent = 4096) => {
  const lng = (px / extent) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / extent)));
  const lat = latRad * (180 / Math.PI);
  return [lng, lat];
};

const ringToLngLat = (ring, extent = 4096) =>
  ring.map(([px, py]) => tileToLngLat(px, py, extent));

const lngLatToTile = (lng, lat, extent = 4096) => {
  const safeLat = clamp(Number(lat) || 0, -85.05112878, 85.05112878);
  const latRad = safeLat * (Math.PI / 180);
  return [
    ((Number(lng) + 180) / 360) * extent,
    ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * extent,
  ];
};

// Keep an antimeridian-crossing ring locally continuous. The dissolve normally
// splits there, but author-drawn scenarios are allowed to use an unwrapped
// polygon and a 358-degree edge would make its principal axis meaningless.
const ringLngLatToTile = (ring, extent = 4096) => {
  const points = [];
  let previousLng = null;
  let longitudeOffset = 0;

  for (const coordinate of ring ?? []) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
    let lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    if (previousLng !== null) {
      const shifted = lng + longitudeOffset;
      if (shifted - previousLng > 180) longitudeOffset -= 360;
      if (shifted - previousLng < -180) longitudeOffset += 360;
    }
    lng += longitudeOffset;
    previousLng = lng;
    points.push(lngLatToTile(lng, lat, extent));
  }

  return points;
};

const wrapLongitude = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

const compactNameUnits = (name) => Array.from(String(name ?? "")).reduce(
  (sum, glyph) => sum + (glyph === " " ? 0.48 : 1),
  0,
);

// Estimate how much of the live shape the word can occupy at the reference
// strategy zoom. MapLibre scales both geometry and text exponentially after
// that point, so this remains visually stable through the atlas zoom range.
const labelLetterSpacing = (pathLength, areaScale, name) => {
  const units = compactNameUnits(name);
  if (!Number.isFinite(pathLength) || pathLength <= 0 || units <= 1) return 0.12;
  const fontPixelsAtZoom4 = Math.max(7, Math.min(72, areaScale * 0.74 / 4096));
  const pathPixelsAtZoom4 = pathLength * 2;
  const availableEms = pathPixelsAtZoom4 * 0.76 / fontPixelsAtZoom4;
  const baseTextEms = units * 0.56;
  return Number(clamp((availableEms - baseTextEms) / Math.max(1, units - 1), 0.06, 0.26).toFixed(3));
};

// A polygon centroid can sit outside a concave polity. Search several central
// scanlines and use the midpoint of the widest inside interval instead; this
// keeps point-label fallbacks on land without bringing a heavyweight polylabel
// pass onto the render thread.
const getInteriorLabelPoint = (polygonRings) => {
  const outer = polygonRings?.[0];
  if (!outer?.length) return null;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of outer) {
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) return null;

  const centroid = getCentroid(outer);
  const span = maxY - minY;
  const centerY = clamp(centroid.cy, minY, maxY);
  const candidates = [
    centerY,
    minY + span * 0.5,
    minY + span * 0.38,
    minY + span * 0.62,
    minY + span * 0.26,
    minY + span * 0.74,
  ];
  let best = null;

  for (const rawY of candidates) {
    // Avoid a scanline lying exactly on a horizontal vertex/edge.
    const y = rawY + span * 1e-7;
    const intersections = [];
    for (const ring of polygonRings) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const a = ring[previous];
        const b = ring[index];
        if (!((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))) continue;
        intersections.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index];
      const right = intersections[index + 1];
      const width = right - left;
      const centerPenalty = Math.abs(y - centerY) / span;
      const score = width * (1 - centerPenalty * 0.12);
      if (!best || score > best.score) {
        best = { point: [(left + right) / 2, y], score };
      }
    }
  }

  return best?.point ?? [centroid.cx, centroid.cy];
};

const getPolylineLength = (points) => {
  let length = 0;

  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    length += Math.hypot(dx, dy);
  }

  return length;
};

const getTotalTurnDegrees = (points) => {
  let total = 0;

  for (let i = 1; i + 1 < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];

    const a1 = Math.atan2(current[1] - previous[1], current[0] - previous[0]);
    const a2 = Math.atan2(next[1] - current[1], next[0] - current[0]);
    let delta = a2 - a1;

    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    total += Math.abs(delta);
  }

  return total * (180 / Math.PI);
};

const getPointAlongPolyline = (points, distance) => {
  if (!points.length) return null;
  if (points.length === 1) {
    return { point: points[0], angle: 0 };
  }

  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength <= 0) continue;

    if (travelled + segmentLength >= distance) {
      const ratio = (distance - travelled) / segmentLength;
      return {
        point: [
          start[0] + dx * ratio,
          start[1] + dy * ratio,
        ],
        angle: Math.atan2(dy, dx) * (180 / Math.PI),
      };
    }

    travelled += segmentLength;
  }

  const tailStart = points[points.length - 2];
  const tailEnd = points[points.length - 1];
  return {
    point: tailEnd,
    angle: Math.atan2(
      tailEnd[1] - tailStart[1],
      tailEnd[0] - tailStart[0],
    ) * (180 / Math.PI),
  };
};

const getSliceIntervals = (ring, s0) => {
  const intersections = [];

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p1 = ring[j];
    const p2 = ring[i];
    const crossesSlice =
      (p1.s <= s0 && p2.s > s0) ||
      (p2.s <= s0 && p1.s > s0);

    if (!crossesSlice) continue;

    const factor = (s0 - p1.s) / (p2.s - p1.s);
    intersections.push(p1.t + factor * (p2.t - p1.t));
  }

  intersections.sort((a, b) => a - b);

  const intervals = [];
  for (let i = 0; i + 1 < intersections.length; i += 2) {
    const minT = intersections[i];
    const maxT = intersections[i + 1];
    const width = maxT - minT;

    if (width <= 1) continue;

    intervals.push({
      minT,
      maxT,
      midT: (minT + maxT) / 2,
      width,
    });
  }

  return intervals;
};

// Cross-sections of several rings on one slice, merged where they touch or
// nearly touch. The dissolve routinely leaves a mainland in adjacent pieces
// separated by hairline seams; for the label they are one body.
const mergeSliceIntervals = (intervals, gap = 2) => {
  const sorted = [...intervals].sort((left, right) => left.minT - right.minT);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.minT <= last.maxT + gap) {
      last.maxT = Math.max(last.maxT, interval.maxT);
    } else {
      merged.push({ minT: interval.minT, maxT: interval.maxT });
    }
  }
  return merged
    .map((interval) => ({
      minT: interval.minT,
      maxT: interval.maxT,
      midT: (interval.minT + interval.maxT) / 2,
      width: interval.maxT - interval.minT,
    }))
    .filter((interval) => interval.width > 1);
};

const chooseSeedInterval = (intervals) => {
  if (!intervals.length) return null;

  const centered = intervals.find(
    (interval) => interval.minT <= 0 && interval.maxT >= 0,
  );
  if (centered) return centered;

  return intervals.reduce((best, interval) =>
    interval.width > best.width ? interval : best
  );
};

const chooseFollowInterval = (intervals, targetT) => {
  if (!intervals.length) return null;

  let best = null;
  let bestScore = Infinity;

  for (const interval of intervals) {
    const continuity = Math.abs(interval.midT - targetT);
    const score = continuity - interval.width * 0.2;

    if (score < bestScore) {
      best = interval;
      bestScore = score;
    }
  }

  return best;
};

const smoothSamples = (samples, passes = 2) => {
  let current = samples;

  for (let pass = 0; pass < passes; pass += 1) {
    const source = current;
    current = source.map((sample, index) => {
      if (index === 0 || index === source.length - 1) return sample;

      return {
        ...sample,
        t:
          source[index - 1].t * 0.25 +
          source[index].t * 0.5 +
          source[index + 1].t * 0.25,
      };
    });
  }

  return current;
};

const buildCurvedLabelPath = (ring, name, { allowStraight = false, center = null, angleDeg = null, extraRings = [] } = {}) => {
  if (!ring || ring.length < 3) return null;

  // Map vNext hands in the equal-area centre and axis (ringAreaMomentsLocal);
  // the stock-map path keeps the tile-space centroid and vertex axis it had.
  const { cx, cy } = Array.isArray(center) && center.length >= 2
    ? { cx: center[0], cy: center[1] }
    : getCentroid(ring);
  const angleRad = (Number.isFinite(angleDeg) ? angleDeg : getPrincipalAxisAngle(ring)) * (Math.PI / 180);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const toLocal = (points) => points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;

    return {
      s: dx * cos + dy * sin,
      t: -dx * sin + dy * cos,
    };
  });
  const localRings = [ring, ...(Array.isArray(extraRings) ? extraRings : [])]
    .filter((entry) => Array.isArray(entry) && entry.length >= 3)
    .map(toLocal);

  let minS = Infinity;
  let maxS = -Infinity;
  for (const localRing of localRings) {
    for (const point of localRing) {
      minS = Math.min(minS, point.s);
      maxS = Math.max(maxS, point.s);
    }
  }

  const span = maxS - minS;
  if (span <= 1) return null;

  const padding = span * 0.12;
  const usableMinS = minS + padding;
  const usableMaxS = maxS - padding;
  const usableSpan = usableMaxS - usableMinS;
  if (usableSpan <= 1) return null;

  const sampleCount = clamp(Math.round(usableSpan / 24), 9, 19);
  const samples = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const s = usableMinS + (usableSpan * i) / (sampleCount - 1);
    const intervals = localRings.length === 1
      ? getSliceIntervals(localRings[0], s)
      : mergeSliceIntervals(localRings.flatMap((localRing) => getSliceIntervals(localRing, s)));
    if (!intervals.length) continue;
    samples.push({ s, intervals });
  }

  if (samples.length < 4) return null;

  let centerIndex = 0;
  let centerDistance = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const distance = Math.abs(samples[i].s);
    if (distance < centerDistance) {
      centerDistance = distance;
      centerIndex = i;
    }
  }

  const chosen = new Array(samples.length).fill(null);
  chosen[centerIndex] = chooseSeedInterval(samples[centerIndex].intervals);
  if (!chosen[centerIndex]) return null;

  for (let i = centerIndex + 1; i < samples.length; i += 1) {
    chosen[i] = chooseFollowInterval(samples[i].intervals, chosen[i - 1]?.midT ?? 0);
  }

  for (let i = centerIndex - 1; i >= 0; i -= 1) {
    chosen[i] = chooseFollowInterval(samples[i].intervals, chosen[i + 1]?.midT ?? 0);
  }

  const rawSamples = samples
    .map((sample, index) => {
      const interval = chosen[index];
      if (!interval) return null;

      return {
        s: sample.s,
        t: interval.midT,
        width: interval.width,
      };
    })
    .filter(Boolean);

  if (rawSamples.length < 4) return null;

  const smoothed = smoothSamples(rawSamples);
  let tilePath = smoothed.map(({ s, t }) => [
    cx + s * cos - t * sin,
    cy + s * sin + t * cos,
  ]);

  const pathLength = getPolylineLength(tilePath);
  const directLength = Math.hypot(
    tilePath[tilePath.length - 1][0] - tilePath[0][0],
    tilePath[tilePath.length - 1][1] - tilePath[0][1],
  );
  const turnDegrees = getTotalTurnDegrees(tilePath);
  const averageWidth =
    rawSamples.reduce((sum, sample) => sum + sample.width, 0) / rawSamples.length;
  const widthRatio = averageWidth / usableSpan;
  const compactNameLength = name.replace(/\s+/g, "").length;
  const minPathLength = allowStraight
    ? Math.max(36, compactNameLength * 4)
    : Math.max(80, compactNameLength * 20);

  if (
    directLength <= 0 ||
    pathLength < minPathLength ||
    // With an exact (untilted) axis a straight run across a wide, compact shape
    // is the territory-following text: only a shape wider across than along
    // the run by a clear margin is rejected here.
    widthRatio > (allowStraight ? 1.15 : 0.22) ||
    (!allowStraight && pathLength / directLength <= 1.04 && turnDegrees <= 55)
  ) {
    return null;
  }

  const overallAngle =
    Math.atan2(
      tilePath[tilePath.length - 1][1] - tilePath[0][1],
      tilePath[tilePath.length - 1][0] - tilePath[0][0],
    ) *
    (180 / Math.PI);

  if (overallAngle > 90 || overallAngle < -90) {
    tilePath = [...tilePath].reverse();
  }

  return {
    points: tilePath,
    length: pathLength,
    width: averageWidth,
  };
};


const getMaxSegmentTurnDegrees = (points) => {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let maxTurn = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const a = Math.atan2(current[1] - previous[1], current[0] - previous[0]);
    const b = Math.atan2(next[1] - current[1], next[0] - current[0]);
    let delta = Math.abs((b - a) * (180 / Math.PI));
    while (delta > 180) delta = Math.abs(delta - 360);
    maxTurn = Math.max(maxTurn, delta);
  }

  return maxTurn;
};

// MapLibre's native whole-word line renderer is much stricter than our
// geometric spine builder. R6 could therefore classify a polity as "hybrid",
// switch its guaranteed point label off, and then have MapLibre reject the
// detailed line at the exact same zoom. R7 creates a deliberately small,
// gently-bending spine and admits a handoff ONLY when that simplified path is
// safe enough for the native renderer. Unsafe shapes stay point-mode forever.
const buildSafeMapLibreWarpPath = (pathInfo, name) => {
  if (!pathInfo?.points?.length || pathInfo.points.length < 4) return null;

  const compactNameLength = Math.max(1, String(name ?? "").replace(/\s+/g, "").length);
  const sampleCount = pathInfo.length >= 300 ? 7 : 5;
  const points = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = getPointAlongPolyline(
      pathInfo.points,
      (pathInfo.length * index) / (sampleCount - 1),
    );
    if (!sample?.point) return null;
    points.push(sample.point);
  }

  // One light pass removes tiny coastal/scanline kinks while preserving the
  // broad territorial arc users actually want to see.
  const smoothed = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    return [
      points[index - 1][0] * 0.18 + point[0] * 0.64 + points[index + 1][0] * 0.18,
      points[index - 1][1] * 0.18 + point[1] * 0.64 + points[index + 1][1] * 0.18,
    ];
  });

  const length = getPolylineLength(smoothed);
  const directLength = Math.hypot(
    smoothed[smoothed.length - 1][0] - smoothed[0][0],
    smoothed[smoothed.length - 1][1] - smoothed[0][1],
  );
  if (directLength <= 0) return null;

  const totalTurnDegrees = getTotalTurnDegrees(smoothed);
  const maxSegmentTurnDegrees = getMaxSegmentTurnDegrees(smoothed);
  const detourRatio = length / directLength;
  const minLength = Math.max(88, compactNameLength * 10.5);

  if (
    length < minLength
    || totalTurnDegrees > 96
    || maxSegmentTurnDegrees > 34
    || detourRatio > 1.18
  ) {
    return null;
  }

  return {
    ...pathInfo,
    points: smoothed,
    length,
    totalTurnDegrees,
    maxSegmentTurnDegrees,
    detourRatio,
  };
};

// Whole-world typography wants only a hint of territorial shape, not the more
// expressive close-zoom spine. Sample the already interior-biased path at three
// points and pull the midpoint toward the chord so giant states get a subtle,
// stable arc. No polity name is special-cased: scale + geometry decide.
const buildGentleWorldWarpPath = (pathInfo, name) => {
  if (!pathInfo?.points?.length || pathInfo.points.length < 3) return null;

  const compactNameLength = Math.max(1, String(name ?? "").replace(/\s+/g, "").length);
  const points = [];

  for (const fraction of [0, 0.5, 1]) {
    const sample = getPointAlongPolyline(pathInfo.points, pathInfo.length * fraction);
    if (!sample?.point) return null;
    points.push(sample.point);
  }

  const chordMid = [
    (points[0][0] + points[2][0]) / 2,
    (points[0][1] + points[2][1]) / 2,
  ];
  points[1] = [
    points[1][0] * 0.62 + chordMid[0] * 0.38,
    points[1][1] * 0.62 + chordMid[1] * 0.38,
  ];

  const length = getPolylineLength(points);
  const directLength = Math.hypot(
    points[2][0] - points[0][0],
    points[2][1] - points[0][1],
  );
  if (directLength <= 0) return null;

  const totalTurnDegrees = getTotalTurnDegrees(points);
  const maxSegmentTurnDegrees = getMaxSegmentTurnDegrees(points);
  const detourRatio = length / directLength;
  const minLength = Math.max(150, compactNameLength * 15);

  if (
    length < minLength
    || totalTurnDegrees > 42
    || maxSegmentTurnDegrees > 42
    || detourRatio > 1.10
  ) {
    return null;
  }

  return {
    ...pathInfo,
    points,
    length,
    totalTurnDegrees,
    maxSegmentTurnDegrees,
    detourRatio,
  };
};


const buildCurvedLabelGlyphFeatures = (
  pathInfo,
  extent,
  name,
  areaScale,
  featureId,
  extraProperties = {},
) => {
  if (!pathInfo?.points?.length) return null;

  const glyphs = Array.from(name.toUpperCase());
  const totalUnits = glyphs.reduce(
    (sum, glyph) => sum + (glyph === " " ? 0.55 : 1),
    0,
  );
  if (totalUnits <= 0) return null;

  const pathPadding = pathInfo.length * 0.08;
  const usableLength = pathInfo.length - pathPadding * 2;
  if (usableLength <= 0) return null;

  const advance = usableLength / totalUnits;
  // Curved spines need a little more breathing room than straight ones. A mild
  // size reduction keeps edge cases such as France and Spain inside their live
  // shapes without making broad, gently curved labels look timid.
  const totalTurn = getTotalTurnDegrees(pathInfo.points);
  const curvatureScale = clamp(1 - Math.max(0, totalTurn - 42) / 520, 0.84, 1);
  const sizeScale = clamp(advance / 52, 0.6, 0.92) * curvatureScale;
  const anchorSample = getPointAlongPolyline(pathInfo.points, pathInfo.length / 2);
  if (!anchorSample) return null;

  // Keep every glyph attached to one geographic anchor and express the curve
  // in font-relative offsets. Separate geographic glyph anchors looked correct
  // at their reference zoom, but zooming closer enlarged the distance between
  // them even after text-size reached its cap, tearing CHINA into C H I N A.
  // Em offsets scale with the glyphs and stop when the glyphs stop, preserving
  // both the word and its live-shape curve at every camera zoom.
  const offsetUnit = Math.max(advance, 1);
  const [anchorLng, anchorLat] = tileToLngLat(
    anchorSample.point[0],
    anchorSample.point[1],
    extent,
  );
  const features = [];

  let cursorUnits = 0;
  let glyphIndex = 0;
  for (const glyph of glyphs) {
    const unitWidth = glyph === " " ? 0.55 : 1;
    const centerDistance = pathPadding + (cursorUnits + unitWidth / 2) * advance;
    cursorUnits += unitWidth;

    if (glyph === " ") continue;

    const sample = getPointAlongPolyline(pathInfo.points, centerDistance);
    if (!sample) continue;

    // Average the tangent around each letter instead of inheriting the angle of
    // one short spine segment. This removes sharp per-letter kinks while the
    // label remains fully map-native and therefore camera-synchronous.
    const tangentSpan = Math.max(advance * 0.72, pathInfo.length * 0.012);
    const before = getPointAlongPolyline(
      pathInfo.points,
      Math.max(0, centerDistance - tangentSpan),
    );
    const after = getPointAlongPolyline(
      pathInfo.points,
      Math.min(pathInfo.length, centerDistance + tangentSpan),
    );
    let rotation = before && after
      ? Math.atan2(
          after.point[1] - before.point[1],
          after.point[0] - before.point[0],
        ) * (180 / Math.PI)
      : sample.angle;
    if (rotation > 90) rotation -= 180;
    if (rotation < -90) rotation += 180;

    const textOffset = [
      Number(((sample.point[0] - anchorSample.point[0]) / offsetUnit).toFixed(3)),
      Number(((sample.point[1] - anchorSample.point[1]) / offsetUnit).toFixed(3)),
    ];

    features.push({
      type: "Feature",
      id: `${featureId}-glyph-${glyphIndex}`,
      geometry: {
        type: "Point",
        coordinates: [anchorLng, anchorLat],
      },
      properties: {
        ...extraProperties,
        glyph,
        areaScale: areaScale * sizeScale,
        rotation,
        textOffset,
        // All glyphs now share the label anchor, so the same globe correction
        // applies to the entire word instead of subtly resizing its letters.
        lat: anchorLat,
      },
    });

    glyphIndex += 1;
  }

  return features.length ? features : null;
};

const getCountriesTileData = async () => {
  const pmtiles = getPmtilesArchive(PMTILES_ARCHIVES.countries);
  return pmtiles.getZxy(0, 0, 0);
};

// Owner labels only need coarse region shapes. Reading the z0 PMTiles tile keeps
// startup in the hundreds of kilobytes instead of loading the editor's ~55 MB
// full-resolution GeoJSON and walking millions of vertices on the main thread.
export const loadRegionLabelGeometry = async () => {
  const archiveUrl = PMTILES_ARCHIVES.regions;
  if (regionLabelGeometryPromise && regionLabelGeometryKey === archiveUrl) {
    return regionLabelGeometryPromise;
  }

  regionLabelGeometryKey = archiveUrl;
  const request = (async () => {
    const pmtiles = getPmtilesArchive(archiveUrl);
    const tileData = await pmtiles.getZxy(0, 0, 0);
    if (!tileData?.data) throw new Error("Regional z0 tile is unavailable.");

    const tile = await decodeVectorTile(tileData.data);
    const layer = tile.layers.regions;
    if (!layer) throw new Error("Regional z0 tile has no regions layer.");

    const features = [];
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const props = feature.properties ?? {};
      const id = props.GID_1 || props.gid_1 || props.HASC_1 || props.fid;
      if (!id) continue;
      const geojson = feature.toGeoJSON(0, 0, 0);
      if (!geojson?.geometry) continue;
      const gid0 = props.GID_0 || props.gid_0 || "";
      const country = resolveCountryDisplayName(
        props.COUNTRY || props.Country || props.country,
        gid0,
      );
      features.push({
        type: "Feature",
        geometry: geojson.geometry,
        properties: {
          id: String(id),
          gid0: String(gid0),
          country,
          owner: country,
        },
      });
    }

    return { type: "FeatureCollection", features };
  })();
  const handled = request.catch((error) => {
    if (regionLabelGeometryPromise === handled) regionLabelGeometryPromise = null;
    console.error("Failed to load regional label geometry:", error);
    return EMPTY_FEATURE_COLLECTION;
  });
  regionLabelGeometryPromise = handled;

  return regionLabelGeometryPromise;
};

const computeCountryLabelCacheKey = (buffer, archiveUrl) => {
  const bytes = new Uint8Array(buffer);
  let hash = 2166136261;

  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }

  // Language in the key: labels are baked with translated names, so caches
  // must never leak across UI languages.
  return `${COUNTRY_LABELS_CACHE_KEY}-${bytes.byteLength}-${(hash >>> 0).toString(36)}-${encodeURIComponent(archiveUrl)}-${getStoredLanguage()}`;
};

const buildCountryLabelCollections = async (tileData, ownedCodes = null) => {
  if (!tileData?.data) {
    return EMPTY_COUNTRY_LABELS;
  }

  const tile = await decodeVectorTile(tileData.data);
  const layer = tile.layers.countries;
  if (!layer) {
    return EMPTY_COUNTRY_LABELS;
  }

  const extent = layer.extent || 4096;
  const registry = new Map();
  const filterByOwners = ownedCodes instanceof Set && ownedCodes.size > 0;

  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index);
    const props = feature.properties;
    const code = props?.GID_0 || props?.gid_0 || props?.ISO_A3 || props?.iso_a3 || "";
    // Skip countries that own no territory in this scenario, so nonexistent-era
    // nations don't float their modern names over unclaimed land.
    if (filterByOwners && !ownedCodes.has(code)) continue;
    // Map labels are drawn from these features, not the DOM — run the name
    // through the translator so country labels follow the UI language.
    const name = translateLabel(resolveCountryDisplayName(
      props?.Country || props?.NAME || props?.name || props?.COUNTRY,
      code,
    ));
    if (!name) continue;

    const geometry = feature.loadGeometry();
    let bestRingTile = null;
    let bestAreaTile = -1;

    for (const ring of geometry) {
      const ringPoints = ring.map((point) => [point.x, point.y]);
      const area = calculateArea(ringPoints);
      if (area > bestAreaTile) {
        bestAreaTile = area;
        bestRingTile = ringPoints;
      }
    }

    if (!bestRingTile) continue;

    const bestRingLngLat = ringToLngLat(bestRingTile, extent);
    const areaLngLat = calculateArea(bestRingLngLat);

    const existing = registry.get(name);
    if (existing && areaLngLat <= existing.areaLngLat) continue;

    const { cx, cy } = getCentroid(bestRingTile);
    const [lng, lat] = tileToLngLat(cx, cy, extent);
    const areaScale = Math.sqrt(areaLngLat) * 17500;
    const rotation = getPrincipalAxisAngle(bestRingTile);
    const curvedLabelPath = buildCurvedLabelPath(bestRingTile, name);
    const curvedGlyphFeatures = buildCurvedLabelGlyphFeatures(
      curvedLabelPath,
      extent,
      name,
      areaScale,
      index,
    );

    registry.set(name, {
      areaLngLat,
      curvedGlyphFeatures,
      pointFeature: curvedGlyphFeatures
        ? null
        : {
            type: "Feature",
            id: `${index}-point`,
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              areaScale,
              name: name.toUpperCase(),
              rotation,
              // See the glyph-feature branch above — same globe text-size fix.
              lat,
            },
          },
    });
  }

  const pointFeatures = [];
  const curvedFeatures = [];

  for (const entry of registry.values()) {
    if (entry.curvedGlyphFeatures) {
      curvedFeatures.push(...entry.curvedGlyphFeatures);
    } else if (entry.pointFeature) {
      pointFeatures.push(entry.pointFeature);
    }
  }

  return {
    curvedLabelData: {
      type: "FeatureCollection",
      features: curvedFeatures,
    },
    pointLabelData: {
      type: "FeatureCollection",
      features: pointFeatures,
    },
  };
};

// Map vNext label policy is intentionally centralized here. Geometry, sizing,
// visibility and diagnostics all consume the SAME decision so we cannot fix one
// layer and accidentally leave another with stale thresholds.
export const POLITY_LABEL_TIERS = Object.freeze([
  // R6 freezes the successful R4/R5 overview coverage, but adds a separate
  // close-zoom guarantee. Collision management may defer a small neighbour at
  // regional zoom; once the camera is close enough, the label is allowed to
  // overlap rather than vanish forever. Visibility, warping and collision are
  // therefore three independent policies instead of one overloaded threshold.
  { id: "continental", minZoom: 0.80, curveMinZoom: 3.85, forceOverlapZoom: 0.80, minScale: 170000, maxScale: Infinity, allowOverlap: true },
  { id: "major", minZoom: 1.15, curveMinZoom: 4.05, forceOverlapZoom: 1.15, minScale: 65000, maxScale: 170000, allowOverlap: true },
  { id: "regional", minZoom: 1.75, curveMinZoom: 4.40, forceOverlapZoom: 4.80, minScale: 22000, maxScale: 65000, allowOverlap: false },
  { id: "small", minZoom: 2.45, curveMinZoom: 4.75, forceOverlapZoom: 5.20, minScale: 7500, maxScale: 22000, allowOverlap: false },
  { id: "local", minZoom: 3.25, curveMinZoom: 5.10, forceOverlapZoom: 5.65, minScale: 0, maxScale: 7500, allowOverlap: false },
]);

export const curveMinZoomForPolityLabelTier = (tier, band = "standard") => {
  if (!tier) return null;
  if (band === "world") {
    return Math.max(tier.minZoom + 0.15, 0.95);
  }
  if (band === "early") {
    return Math.max(tier.minZoom + 0.75, tier.curveMinZoom - 0.55);
  }
  return tier.curveMinZoom;
};

const REFERENCE_ZOOM = 4;
const REFERENCE_PIXELS_PER_TILE_UNIT = (512 * (2 ** REFERENCE_ZOOM)) / 4096; // 2 px

const nameGlyphWidthEm = (glyph) => {
  if (glyph === " ") return 0.34;
  if ("MW@%".includes(glyph)) return 0.82;
  if ("IJLT1".includes(glyph)) return 0.40;
  if ("ABCDEFGHKNOPQRSTUVXYZ023456789".includes(glyph)) return 0.60;
  return 0.56;
};

const textBaseWidthEm = (name) => Array.from(String(name ?? "").toUpperCase())
  .reduce((sum, glyph) => sum + nameGlyphWidthEm(glyph), 0);

const textGapCount = (name) => Math.max(0, Array.from(String(name ?? "")).length - 1);

const estimatedTextWidthEm = (name, letterSpacing = 0) =>
  textBaseWidthEm(name) + textGapCount(name) * Math.max(0, Number(letterSpacing) || 0);

const preferredLetterSpacing = (name, mode = "point") => {
  const letters = Math.max(1, String(name ?? "").replace(/\s+/g, "").length);
  const line = mode === "line";
  // Pax-style point labels spend territory on larger glyphs first and tracking
  // second. R3/R4 did the opposite on many states, producing delicate labels
  // with too much empty air between letters.
  if (letters <= 5) return line ? 0.70 : 0.36;
  if (letters <= 7) return line ? 0.55 : 0.28;
  if (letters <= 10) return line ? 0.40 : 0.20;
  if (letters <= 14) return line ? 0.28 : 0.14;
  if (letters <= 20) return line ? 0.18 : 0.10;
  return line ? 0.10 : 0.07;
};

const maxLetterSpacing = (name, mode = "point") => {
  const letters = Math.max(1, String(name ?? "").replace(/\s+/g, "").length);
  if (mode !== "line") {
    if (letters <= 5) return 0.62;
    if (letters <= 7) return 0.48;
    if (letters <= 10) return 0.34;
    if (letters <= 14) return 0.24;
    if (letters <= 20) return 0.15;
    return 0.10;
  }
  if (letters <= 5) return 1.10;
  if (letters <= 7) return 0.90;
  if (letters <= 10) return 0.68;
  if (letters <= 14) return 0.46;
  if (letters <= 20) return 0.28;
  return 0.16;
};

const pointMaxLetterSpacing = (name, priorityScale) => {
  const letters = Math.max(1, String(name ?? "").replace(/\s+/g, "").length);
  // Giant continental names need some atlas-style tracking to span a continent,
  // but only short names receive it. Normal states stay typographically cohesive.
  if (priorityScale >= 170000) {
    if (letters <= 5) return 1.15;
    if (letters <= 7) return 1.00;
    if (letters <= 10) return 0.72;
    if (letters <= 14) return 0.42;
    return 0.20;
  }
  return maxLetterSpacing(name, "point");
};

const fitScaleFromFontPx = (fontPxAtZoom4) => Math.max(1, fontPxAtZoom4 * 4096);


const visibilityScaleFor = (priorityScale, name) => {
  const units = Math.max(1, textBaseWidthEm(name));
  // Long official names need more screen space. Penalizing only visibility (not
  // territorial importance) keeps DEMOCRATIC REPUBLIC OF THE CONGO from becoming
  // the sole African overview label while short names such as CHINA/RUSSIA enter
  // exactly when their territory warrants it.
  const lengthPenalty = clamp(Math.sqrt(units / 4.0), 1, 2.40);
  return priorityScale / lengthPenalty;
};

const tierForVisibilityScale = (visibilityScale) =>
  POLITY_LABEL_TIERS.find((tier) => (
    visibilityScale >= tier.minScale && visibilityScale < tier.maxScale
  )) ?? POLITY_LABEL_TIERS[POLITY_LABEL_TIERS.length - 1];

const fitLineTypography = ({ pathInfo, name, priorityScale }) => {
  const pathPixels = Math.max(1, pathInfo.length * REFERENCE_PIXELS_PER_TILE_UNIT);
  const corridorPixels = Math.max(1, pathInfo.width * REFERENCE_PIXELS_PER_TILE_UNIT);
  const targetOccupancy = clamp(
    0.59 + Math.log2(Math.max(priorityScale, 26000) / 52000) * 0.022,
    0.56,
    0.68,
  );
  const targetWidth = pathPixels * targetOccupancy;
  const preferredSpacing = preferredLetterSpacing(name, "line");
  const maxSpacing = maxLetterSpacing(name, "line");
  const heightCap = clamp(corridorPixels * 0.52, 14, 260);
  const absoluteCap = 260;

  let fontPx = targetWidth / Math.max(0.1, estimatedTextWidthEm(name, preferredSpacing));
  fontPx = clamp(fontPx, 9, Math.min(heightCap, absoluteCap));

  // If corridor thickness caps font size, spend the remaining width on spacing.
  // This is the strategy-map effect missing from R1: RUSSIA/CANADA/CHINA can
  // occupy their territory without making each individual glyph absurdly tall.
  const gaps = textGapCount(name);
  let letterSpacing = preferredSpacing;
  if (gaps > 0) {
    letterSpacing = clamp(
      (targetWidth / Math.max(fontPx, 1) - textBaseWidthEm(name)) / gaps,
      0.05,
      maxSpacing,
    );
  }

  // Re-solve font size after spacing. This makes target occupancy the objective,
  // rather than the old areaScale being merely capped by available path width.
  fontPx = clamp(
    targetWidth / Math.max(0.1, estimatedTextWidthEm(name, letterSpacing)),
    9,
    Math.min(heightCap, absoluteCap),
  );

  const actualWidth = estimatedTextWidthEm(name, letterSpacing) * fontPx;
  return {
    fitScale: fitScaleFromFontPx(fontPx),
    fontPxAtZoom4: Number(fontPx.toFixed(2)),
    letterSpacing: Number(letterSpacing.toFixed(3)),
    targetOccupancy: Number(targetOccupancy.toFixed(3)),
    estimatedOccupancy: Number(clamp(actualWidth / pathPixels, 0, 2).toFixed(3)),
  };
};

const fitPointTypography = ({
  shapeWidth,
  shapeHeight,
  axisSpan,
  crossSpan,
  name,
  priorityScale,
}) => {
  // R5 fits against the territory's ROTATED dominant axis, not its axis-aligned
  // bounding box. That is the key Pax-like behaviour: Germany/UK may use their
  // north-south span, France/Poland their diagonal span, and Ukraine its east-west
  // span instead of all being sized as if the label were horizontal.
  const widthPixels = Math.max(
    1,
    (Number.isFinite(axisSpan) && axisSpan > 0 ? axisSpan : Math.max(shapeWidth, shapeHeight))
      * REFERENCE_PIXELS_PER_TILE_UNIT,
  );
  const heightPixels = Math.max(
    1,
    (Number.isFinite(crossSpan) && crossSpan > 0 ? crossSpan : Math.min(shapeWidth, shapeHeight))
      * REFERENCE_PIXELS_PER_TILE_UNIT,
  );

  // R5 deliberately overshot the Pax target to prove that dominant-axis fitting
  // worked. R6 pulls the whole system back by roughly one visual step while
  // keeping the same hierarchy. A shape-slenderness dampener is applied only to
  // extreme long/thin territories (Norway is the canonical regression case), so
  // their long axis cannot turn one label into a continent-sized banner.
  const baseTargetOccupancy = priorityScale >= 170000
    ? 0.62
    : priorityScale >= 65000
      ? 0.76
      : priorityScale >= 22000
        ? 0.73
        : priorityScale >= 7500
          ? 0.68
          : 0.64;
  const crossFraction = priorityScale >= 170000
    ? 0.46
    : priorityScale >= 65000
      ? 0.56
      : priorityScale >= 22000
        ? 0.62
        : priorityScale >= 7500
          ? 0.68
          : 0.74;
  const maxFont = priorityScale >= 170000
    ? 220
    : priorityScale >= 65000
      ? 138
      : priorityScale >= 22000
        ? 116
        : priorityScale >= 7500
          ? 84
          : 64;

  const slenderness = widthPixels / Math.max(heightPixels, 1);
  const slenderPenalty = clamp(
    1 - Math.max(0, slenderness - 2.15) * 0.16,
    0.52,
    1,
  );
  const targetOccupancy = baseTargetOccupancy * slenderPenalty;

  const preferredSpacing = preferredLetterSpacing(name, "point");
  const targetWidth = widthPixels * targetOccupancy;
  const heightCap = Math.max(0.35, heightPixels * crossFraction);

  // Preserve proportional microstates: readability is allowed to overflow a
  // border naturally as the camera zooms, but a forced reference-size floor may
  // never turn Liechtenstein/San Marino into regional banners.
  const minimumReferenceFont = 0.35;
  let fontPx = clamp(
    Math.min(
      targetWidth / Math.max(0.1, estimatedTextWidthEm(name, preferredSpacing)),
      heightCap,
      maxFont,
    ),
    minimumReferenceFont,
    maxFont,
  );

  const gaps = textGapCount(name);
  let letterSpacing = preferredSpacing;
  if (gaps > 0) {
    letterSpacing = clamp(
      (targetWidth / Math.max(fontPx, 1) - textBaseWidthEm(name)) / gaps,
      0.04,
      pointMaxLetterSpacing(name, priorityScale),
    );
  }

  fontPx = clamp(
    Math.min(
      targetWidth / Math.max(0.1, estimatedTextWidthEm(name, letterSpacing)),
      heightCap,
      maxFont,
    ),
    minimumReferenceFont,
    maxFont,
  );

  const actualWidth = estimatedTextWidthEm(name, letterSpacing) * fontPx;

  return {
    fitScale: fitScaleFromFontPx(fontPx),
    fontPxAtZoom4: Number(fontPx.toFixed(2)),
    letterSpacing: Number(letterSpacing.toFixed(3)),
    targetOccupancy: Number(targetOccupancy.toFixed(3)),
    estimatedOccupancy: Number(clamp(actualWidth / widthPixels, 0, 2).toFixed(3)),
  };
};

// ---- Equal-area placement geometry -------------------------------------------
// Where a polity's label goes is decided in a locally equal-area frame
// (X = lng·cos φ0, Y = lat) and from moments of the polygon's AREA, not in tile
// space from its vertices. Both of the old choices misplaced labels on the
// modern world map: mercator inflates the far north, so Ellesmere Island out-
// measured the Canadian mainland and Alaska the contiguous United States; and a
// covariance taken over ring vertices is owned by whichever coast has the most
// of them, which is how China and Australia came out diagonal.
const HORIZONTAL_ELONGATION = 1.8;
// Pieces below this share of a landmass's area do not shape its label path.
const PATH_PIECE_MIN_SHARE = 0.005;
const PATH_PIECE_LIMIT = 64;
// A detached landmass carries the owner's name when it has at least this much
// ground (cos-scaled square degrees; three is roughly 37,000 km², Taiwan-sized)
// and at least this share of the core landmass.
const MIN_PART_AREA_LOCAL = 3;
const MIN_PART_FRACTION = 0.03;
// Polygons whose bounding boxes come within this many degrees of one another
// are one landmass for labelling: a mainland the dissolve left in two pieces,
// or an archipelago's main islands.
const PART_CLUSTER_GAP_DEGREES = 0.35;
// Every polygon with any area at all takes part: a microstate is one polygon
// and must keep its label.
const PART_CLUSTER_MIN_AREA_LOCAL = 0;

const ringLatitudeCosine = (ringLngLat) => {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const point of Array.isArray(ringLngLat) ? ringLngLat : []) {
    if (!Array.isArray(point) || !Number.isFinite(point[1])) continue;
    minLat = Math.min(minLat, point[1]);
    maxLat = Math.max(maxLat, point[1]);
  }
  if (!Number.isFinite(minLat)) return 1;
  return Math.max(0.08, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
};

const ringAreaMomentsLocal = (ringLngLat, cosLatOverride = null) => {
  const points = Array.isArray(ringLngLat)
    ? ringLngLat.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    : [];
  if (points.length < 3) return null;

  const cosLat = Number.isFinite(cosLatOverride) && cosLatOverride > 0
    ? cosLatOverride
    : ringLatitudeCosine(points);
  const xs = points.map((point) => point[0] * cosLat);
  const ys = points.map((point) => point[1]);

  let twiceArea = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const cross = xs[j] * ys[i] - xs[i] * ys[j];
    twiceArea += cross;
    sumX += (xs[j] + xs[i]) * cross;
    sumY += (ys[j] + ys[i]) * cross;
    sumXX += (xs[j] * xs[j] + xs[j] * xs[i] + xs[i] * xs[i]) * cross;
    sumYY += (ys[j] * ys[j] + ys[j] * ys[i] + ys[i] * ys[i]) * cross;
    sumXY += (xs[j] * ys[i] + 2 * xs[j] * ys[j] + 2 * xs[i] * ys[i] + xs[i] * ys[j]) * cross;
  }
  const area = twiceArea / 2;
  if (!(Math.abs(area) > 1e-12)) return null;

  const cx = sumX / (6 * area);
  const cy = sumY / (6 * area);
  const varX = sumXX / (12 * area) - cx * cx;
  const varY = sumYY / (12 * area) - cy * cy;
  const cov = sumXY / (24 * area) - cx * cy;
  const mean = (varX + varY) / 2;
  const spread = Math.sqrt(((varX - varY) / 2) ** 2 + cov * cov);
  const major = Math.max(1e-12, mean + spread);
  const minor = Math.max(1e-12, mean - spread);

  return {
    area: Math.abs(area),
    lng: cx / cosLat,
    lat: cy,
    cosLat,
    localX: cx,
    localY: cy,
    varX,
    varY,
    cov,
    // Counter-clockwise from east, in the equal-area frame (north is up).
    angleDeg: (0.5 * Math.atan2(2 * cov, varX - varY) * 180) / Math.PI,
    elongation: Math.sqrt(major / minor),
  };
};

// The moments of a whole landmass: its pieces' moments in one shared frame,
// combined area-weighted about the common centroid.
const clusterMomentsLocal = (ringsLngLat) => {
  const rings = (Array.isArray(ringsLngLat) ? ringsLngLat : []).filter((ring) => Array.isArray(ring) && ring.length >= 3);
  if (!rings.length) return null;
  const cosLat = ringLatitudeCosine(rings.flat());
  const parts = rings.map((ring) => ringAreaMomentsLocal(ring, cosLat)).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];

  const total = parts.reduce((sum, part) => sum + part.area, 0);
  if (!(total > 0)) return null;
  const cx = parts.reduce((sum, part) => sum + part.area * part.localX, 0) / total;
  const cy = parts.reduce((sum, part) => sum + part.area * part.localY, 0) / total;
  let varX = 0;
  let varY = 0;
  let cov = 0;
  for (const part of parts) {
    const dx = part.localX - cx;
    const dy = part.localY - cy;
    varX += part.area * (part.varX + dx * dx);
    varY += part.area * (part.varY + dy * dy);
    cov += part.area * (part.cov + dx * dy);
  }
  varX /= total;
  varY /= total;
  cov /= total;
  const mean = (varX + varY) / 2;
  const spread = Math.sqrt(((varX - varY) / 2) ** 2 + cov * cov);
  const major = Math.max(1e-12, mean + spread);
  const minor = Math.max(1e-12, mean - spread);
  return {
    area: total,
    lng: cx / cosLat,
    lat: cy,
    cosLat,
    localX: cx,
    localY: cy,
    varX,
    varY,
    cov,
    angleDeg: (0.5 * Math.atan2(2 * cov, varX - varY) * 180) / Math.PI,
    elongation: Math.sqrt(major / minor),
  };
};

const polygonAreaLocal = (polygon) => {
  const rings = Array.isArray(polygon) ? polygon : [];
  const outer = ringAreaMomentsLocal(rings[0])?.area ?? 0;
  const holes = rings.slice(1).reduce((sum, ring) => sum + (ringAreaMomentsLocal(ring)?.area ?? 0), 0);
  return Math.max(0, outer - holes);
};

const normalizeRotation = (degrees) => {
  let value = Number(degrees) || 0;
  while (value > 90) value -= 180;
  while (value <= -90) value += 180;
  return value;
};

// Extents of a tile-space ring along a given screen angle and across it.
const projectedAxisMetrics = (ring, angleDeg) => {
  if (!ring || ring.length < 3) return { angle: 0, axisSpan: 0, crossSpan: 0 };
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  let minAxis = Infinity;
  let maxAxis = -Infinity;
  let minCross = Infinity;
  let maxCross = -Infinity;
  for (const point of ring) {
    const axis = point[0] * cos + point[1] * sin;
    const cross = -point[0] * sin + point[1] * cos;
    minAxis = Math.min(minAxis, axis);
    maxAxis = Math.max(maxAxis, axis);
    minCross = Math.min(minCross, cross);
    maxCross = Math.max(maxCross, cross);
  }
  return {
    angle: angleDeg,
    axisSpan: Math.max(0, maxAxis - minAxis),
    crossSpan: Math.max(0, maxCross - minCross),
  };
};

const polygonBoundsLngLat = (polygon) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of polygon?.[0] ?? []) {
    if (!Array.isArray(point)) continue;
    west = Math.min(west, point[0]);
    east = Math.max(east, point[0]);
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  return { west, south, east, north };
};

// Groups an owner's polygons into landmasses, largest first. Specks below
// PART_CLUSTER_MIN_AREA_LOCAL never get a label and are left out entirely.
const landmassClusters = (polygons) => {
  const items = [];
  for (const polygon of polygons ?? []) {
    const area = polygonAreaLocal(polygon);
    if (!(area > PART_CLUSTER_MIN_AREA_LOCAL)) continue;
    const bounds = polygonBoundsLngLat(polygon);
    if (!Number.isFinite(bounds.west)) continue;
    items.push({ polygon, area, bounds });
  }
  if (!items.length) return [];

  const parent = items.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Sweep by western edge so each pair is examined once and only while the
  // boxes can still overlap.
  const order = items.map((_, index) => index).sort((a, b) => items[a].bounds.west - items[b].bounds.west);
  const gap = PART_CLUSTER_GAP_DEGREES;
  for (let i = 0; i < order.length; i += 1) {
    const left = items[order[i]].bounds;
    for (let j = i + 1; j < order.length; j += 1) {
      const right = items[order[j]].bounds;
      if (right.west > left.east + gap) break;
      if (right.south > left.north + gap || right.north < left.south - gap) continue;
      union(order[i], order[j]);
    }
  }

  const clusters = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    const cluster = clusters.get(root);
    if (cluster) {
      cluster.polygons.push(item.polygon);
      cluster.area += item.area;
    } else {
      clusters.set(root, { polygons: [item.polygon], area: item.area });
    }
  });
  return [...clusters.values()].sort((a, b) => b.area - a.area);
};

const ownerFeatureId = (owner) => {
  const raw = String(owner ?? "").trim().toLocaleLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "polity";
  return `polity-label-${slug}-${(hash >>> 0).toString(36)}`;
};


const polygonOuterCentroidLngLat = (polygon) => {
  const outer = Array.isArray(polygon?.[0]) ? polygon[0] : [];
  if (!outer.length) return { lng: 0, lat: 0 };
  const { cx, cy } = getCentroid(outer);
  return { lng: cx, lat: cy };
};

const polygonSetAreaLngLat = (polygons) => (polygons ?? []).reduce((sum, polygon) => {
  const outer = calculateArea(polygon?.[0] ?? []);
  const holes = (polygon ?? []).slice(1)
    .reduce((holeSum, ring) => holeSum + calculateArea(ring), 0);
  return sum + Math.max(0, outer - holes);
}, 0);

// A sovereign owner may contain a very large detached dependency. Geometry alone
// cannot infer the political core: Kingdom of Denmark is the canonical modern-map
// case, where Greenland is physically much larger than Denmark. Keep the polity
// label on the core and emit GREENLAND separately as a geographic territory label.
const cartographicPolygonSetsForOwner = (owner, allPolygons) => {
  const normalized = String(owner ?? "").toLocaleLowerCase();
  if (!normalized.includes("denmark")) {
    return { primary: allPolygons, detached: [] };
  }

  const primary = [];
  const greenland = [];
  for (const polygon of allPolygons ?? []) {
    const { lng, lat } = polygonOuterCentroidLngLat(polygon);
    if (lng < -10 && lat > 58) greenland.push(polygon);
    else if (lng > 5 && lng < 16 && lat > 53 && lat < 59) primary.push(polygon);
  }

  return {
    primary: primary.length ? primary : allPolygons,
    detached: greenland.length
      ? [{ id: "greenland", name: "GREENLAND", polygons: greenland }]
      : [],
  };
};

export const selectPolityPointFallbacks = (pointLabelData, renderedWarpOwners = new Set()) => {
  const features = Array.isArray(pointLabelData?.features) ? pointLabelData.features : [];
  const visibleWarpOwners = renderedWarpOwners instanceof Set
    ? renderedWarpOwners
    : new Set(renderedWarpOwners ?? []);
  return {
    type: "FeatureCollection",
    features: features.filter((feature) => {
      const props = feature?.properties ?? {};
      if (props.presentation !== "overview") return true;
      return !visibleWarpOwners.has(String(props.owner ?? ""));
    }),
  };
};

// One landmass's label: the logical record, the guaranteed point presentation
// and, when the shape can carry it, the curved line. `polygons` are the
// landmass's polygons in lng/lat; `areaLngLat` sets its size class.
const buildLandmassLabelRecords = ({
  polygons,
  owner,
  name,
  featureId,
  extent,
  areaLngLat,
  labelKind = "polity",
  sourceOwner = owner,
}) => {
  const upperName = name;
  const priorityScale = Math.sqrt(Math.max(areaLngLat, 1e-8)) * 17500;

  // The label is fitted to the whole landmass. The dissolve routinely leaves
  // a mainland in several adjacent pieces (on the modern world map Canada's
  // largest piece is a seventh of its land), and a label fitted to the largest
  // piece alone ended up vertical along Quebec. Pieces are measured on the
  // ground, not in tile space, where an Arctic island out-measures a mainland.
  const pieces = (Array.isArray(polygons) ? polygons : [])
    .map((polygon) => ({
      polygon,
      areaLocal: polygonAreaLocal(polygon),
      outerTile: ringLngLatToTile(polygon?.[0], extent),
    }))
    .filter((piece) => piece.areaLocal > 0 && piece.outerTile.length >= 4)
    .sort((left, right) => right.areaLocal - left.areaLocal);
  if (!pieces.length) return null;
  const clusterAreaLocal = pieces.reduce((sum, piece) => sum + piece.areaLocal, 0);
  const bestOuterTile = pieces[0].outerTile;
  const pathPieces = pieces
    .slice(0, PATH_PIECE_LIMIT)
    .filter((piece, index) => index === 0 || piece.areaLocal >= clusterAreaLocal * PATH_PIECE_MIN_SHARE);
  const extraRings = pathPieces.slice(1).map((piece) => piece.outerTile);

  const polygonTile = pathPieces
    .flatMap((piece) => piece.polygon.map((ring) => ringLngLatToTile(ring, extent)))
    .filter((ring) => ring.length >= 4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const allOuterPoints = [];
  for (const piece of pathPieces) {
    for (const point of piece.outerTile) {
      allOuterPoints.push(point);
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  const shapeWidth = Math.max(0, maxX - minX);
  const shapeHeight = Math.max(0, maxY - minY);
  const shortSide = Math.max(1, Math.min(shapeWidth, shapeHeight));
  const longSide = Math.max(shapeWidth, shapeHeight);
  const aspectRatio = longSide / shortSide;

  // Centre and axis from the polygon's area in an equal-area frame. A compact
  // shape reads horizontally, as an atlas would set it; only a clearly long
  // shape (Chile, Norway, Japan) follows its own axis. Tile y points down, so
  // the frame's counter-clockwise angle becomes a clockwise screen rotation.
  const moments = clusterMomentsLocal(pathPieces.map((piece) => piece.polygon[0]));
  const preferHorizontal = !moments || moments.elongation < HORIZONTAL_ELONGATION;
  const angleTile = preferHorizontal ? 0 : normalizeRotation(-moments.angleDeg);
  const centerTile = moments ? lngLatToTile(moments.lng, moments.lat, extent) : null;
  const axisMetrics = projectedAxisMetrics(allOuterPoints, angleTile);
  const axisAspectRatio = axisMetrics.axisSpan / Math.max(1, axisMetrics.crossSpan);
  const rawPathInfo = buildCurvedLabelPath(bestOuterTile, upperName, {
    allowStraight: true,
    center: centerTile,
    angleDeg: angleTile,
    extraRings,
  });
  const safeWarpPath = buildSafeMapLibreWarpPath(rawPathInfo, upperName);
  const worldWarpPath = buildGentleWorldWarpPath(rawPathInfo, upperName);
  const compactNameLength = Math.max(1, upperName.replace(/\s+/g, "").length);
  const turnDegrees = safeWarpPath?.totalTurnDegrees
    ?? (rawPathInfo ? getTotalTurnDegrees(rawPathInfo.points) : 0);

  // R7 never hands a polity over to MapLibre's line renderer merely because a
  // geometric spine exists. The path must survive a second renderer-safety
  // pass first. If it does not, the polity remains on the point presentation
  // at every zoom, which makes a one-click zoom incapable of deleting a name.
  const visibilityScale = visibilityScaleFor(priorityScale, upperName);
  // World-scale bending is deliberately rare and gentle. Only very large
  // labels qualify; ordinary countries keep the fitted/rotated point form
  // until the existing regional/detail warp thresholds.
  const worldCurve = Boolean(
    visibilityScale >= 400000
    && worldWarpPath?.points?.length === 3
    && worldWarpPath.length >= Math.max(170, compactNameLength * 16)
    && worldWarpPath.width >= Math.max(48, compactNameLength * 3.25)
    && worldWarpPath.totalTurnDegrees <= 42
    && worldWarpPath.maxSegmentTurnDegrees <= 42
  );
  const continentalCurve = Boolean(
    visibilityScale >= 170000
    && safeWarpPath?.points?.length >= 5
    && safeWarpPath.length >= Math.max(120, compactNameLength * 12)
    && safeWarpPath.width >= Math.max(38, compactNameLength * 3.0)
    && safeWarpPath.totalTurnDegrees <= 92
    && safeWarpPath.maxSegmentTurnDegrees <= 32
    && aspectRatio >= 1.18
  );
  const elongatedCurve = Boolean(
    visibilityScale >= 22000
    && safeWarpPath?.points?.length >= 5
    && safeWarpPath.length >= Math.max(104, compactNameLength * 11)
    && safeWarpPath.width >= Math.max(24, compactNameLength * 2.25)
    && safeWarpPath.totalTurnDegrees <= 82
    && safeWarpPath.maxSegmentTurnDegrees <= 30
    && axisAspectRatio >= 1.9
  );
  const lineEligible = worldCurve || continentalCurve || elongatedCurve;
  const linePathInfo = worldCurve ? worldWarpPath : lineEligible ? safeWarpPath : null;

  const anchorPath = linePathInfo ?? rawPathInfo;
  const centerSample = anchorPath?.points?.length >= 4
    ? getPointAlongPolyline(anchorPath.points, anchorPath.length / 2)
    : null;
  const pointTile = centerSample?.point ?? getInteriorLabelPoint(polygonTile);
  if (!pointTile) return null;
  const [rawLng, lat] = tileToLngLat(pointTile[0], pointTile[1], extent);
  const anchorLng = wrapLongitude(rawLng);
  const tier = tierForVisibilityScale(visibilityScale);
  const pointTypography = fitPointTypography({
    shapeWidth,
    shapeHeight,
    axisSpan: axisMetrics.axisSpan,
    crossSpan: axisMetrics.crossSpan,
    name: upperName,
    priorityScale,
  });
  const lineTypography = lineEligible
    ? fitLineTypography({ pathInfo: linePathInfo, name: upperName, priorityScale })
    : null;
  const rotation = axisMetrics.angle;
  // Strongly elongated states benefit from their territory-following form
  // earlier than generic continental curves. This specifically prevents the
  // point fallback from becoming a giant NORWAY/CHILE banner just before the
  // warped label would otherwise take over.
  const curveBand = worldCurve
    ? "world"
    : lineEligible && elongatedCurve && !continentalCurve
      ? "early"
      : lineEligible
        ? "standard"
        : "none";
  const curveMinZoom = lineEligible
    ? curveMinZoomForPolityLabelTier(tier, curveBand)
    : null;

  const common = {
    name: upperName,
    owner,
    labelKind,
    sourceOwner,
    tier: tier.id,
    minZoom: tier.minZoom,
    curveMinZoom,
    curveBand,
    forceOverlapZoom: tier.forceOverlapZoom,
    allowOverlap: tier.allowOverlap,
    areaScale: priorityScale,
    priorityScale,
    visibilityScale: Number(visibilityScale.toFixed(2)),
    shapeWidth,
    shapeHeight,
    axisSpan: Number(axisMetrics.axisSpan.toFixed(3)),
    crossSpan: Number(axisMetrics.crossSpan.toFixed(3)),
    aspectRatio: Number(aspectRatio.toFixed(3)),
    axisAspectRatio: Number(axisAspectRatio.toFixed(3)),
    rotation,
    pathLength: linePathInfo?.length ?? rawPathInfo?.length ?? 0,
    pathWidth: linePathInfo?.width ?? rawPathInfo?.width ?? 0,
    pathTurnDegrees: Number(turnDegrees.toFixed(2)),
    warpPointCount: linePathInfo?.points?.length ?? 0,
    warpMaxSegmentTurnDegrees: Number(Number(linePathInfo?.maxSegmentTurnDegrees ?? 0).toFixed(2)),
    warpDetourRatio: Number(Number(linePathInfo?.detourRatio ?? 0).toFixed(3)),
    safeWarp: lineEligible,
    hasCurvedLabel: lineEligible,
    anchorLng,
    anchorLat: lat,
    lat,
  };

  return {
    // Canonical logical record: always one point geometry per owner so camera
    // framing / diagnostics never depend on MapLibre's line renderer.
    logical: {
      type: "Feature",
      id: featureId,
      geometry: { type: "Point", coordinates: [anchorLng, lat] },
      properties: {
        ...common,
        mode: lineEligible ? "hybrid" : "point",
        fitScale: pointTypography.fitScale,
        fontPxAtZoom4: pointTypography.fontPxAtZoom4,
        letterSpacing: pointTypography.letterSpacing,
        targetOccupancy: pointTypography.targetOccupancy,
        estimatedOccupancy: pointTypography.estimatedOccupancy,
        lineFontPxAtZoom4: lineTypography?.fontPxAtZoom4 ?? null,
        lineLetterSpacing: lineTypography?.letterSpacing ?? null,
        lineTargetOccupancy: lineTypography?.targetOccupancy ?? null,
        lineEstimatedOccupancy: lineTypography?.estimatedOccupancy ?? null,
      },
    },
    // Guaranteed overview renderer. For line-capable polities Nations.jsx shows
    // this only below curveMinZoom; point-only polities keep it through z7.1.
    point: {
      type: "Feature",
      id: `${featureId}-point`,
      geometry: { type: "Point", coordinates: [anchorLng, lat] },
      properties: {
        ...common,
        mode: "point",
        presentation: lineEligible ? "overview" : "persistent",
        fitScale: pointTypography.fitScale,
        fontPxAtZoom4: pointTypography.fontPxAtZoom4,
        letterSpacing: pointTypography.letterSpacing,
        targetOccupancy: pointTypography.targetOccupancy,
        estimatedOccupancy: pointTypography.estimatedOccupancy,
      },
    },
    line: lineEligible
      ? {
        type: "Feature",
        id: `${featureId}-line`,
        geometry: {
          type: "LineString",
          coordinates: linePathInfo.points.map(([x, y]) => tileToLngLat(x, y, extent)),
        },
        properties: {
          ...common,
          mode: "line",
          presentation: "detail",
          fitScale: lineTypography.fitScale,
          fontPxAtZoom4: lineTypography.fontPxAtZoom4,
          letterSpacing: lineTypography.letterSpacing,
          targetOccupancy: lineTypography.targetOccupancy,
          estimatedOccupancy: lineTypography.estimatedOccupancy,
        },
      }
      : null,
  };
};

// Map vNext labels are generated from the same live dissolved polity surfaces
// that paint the political map. There is ONE canonical logical record per owner.
// Rendering derives a guaranteed overview point plus an optional curved detail
// line from that record; their zoom ranges are disjoint in Nations.jsx. This is
// deliberately different from R2's one-geometry-only model, because diagnostics
// proved every missing world/regional label was a line-mode polity while every
// visible peer was point-mode.
export const buildPolityLabelCollections = (
  politySurfaces,
  { nameResolver = (owner) => owner, extent = 4096 } = {},
) => {
  const rawFeatures = Array.isArray(politySurfaces?.features) ? politySurfaces.features : [];
  const ownerRegistry = new Map();

  // Hard invariant: malformed/upstream input may repeat a dissolved owner, but
  // the canonical label registry never can.
  for (const feature of rawFeatures) {
    const owner = String(feature?.properties?.owner ?? "").trim();
    if (!owner) continue;
    const allPolygons = feature?.geometry?.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature?.geometry?.type === "MultiPolygon"
        ? feature.geometry.coordinates
        : [];
    const fullAreaLngLat = allPolygons.reduce((sum, polygon) => {
      const outer = calculateArea(polygon?.[0] ?? []);
      const holes = (polygon ?? []).slice(1)
        .reduce((holeSum, ring) => holeSum + calculateArea(ring), 0);
      return sum + Math.max(0, outer - holes);
    }, 0);
    const existing = ownerRegistry.get(owner);
    if (!existing || fullAreaLngLat > existing.fullAreaLngLat) {
      ownerRegistry.set(owner, { feature, owner, allPolygons, fullAreaLngLat });
    }
  }

  const logicalFeatures = [];
  const pointFeatures = [];
  const lineFeatures = [];
  const entries = [...ownerRegistry.values()]
    .sort((left, right) => left.owner.localeCompare(right.owner));

  for (const entry of entries) {
    const { feature, owner, allPolygons, fullAreaLngLat } = entry;
    const name = String(nameResolver(owner, feature) ?? owner).trim();
    if (!name || !allPolygons.length) continue;

    const cartographicSets = cartographicPolygonSetsForOwner(owner, allPolygons);
    const clusters = landmassClusters(cartographicSets.primary);
    if (!clusters.length) continue;
    const upperName = name.toUpperCase();
    const featureId = ownerFeatureId(owner);

    // The political core is the landmass with the most ground; its label is the
    // polity's one logical record.
    const core = clusters[0];
    const coreRecords = buildLandmassLabelRecords({
      polygons: core.polygons,
      owner,
      name: upperName,
      featureId,
      extent,
      areaLngLat: polygonSetAreaLngLat(core.polygons) || fullAreaLngLat,
    });
    if (!coreRecords) continue;
    logicalFeatures.push(coreRecords.logical);
    pointFeatures.push(coreRecords.point);
    if (coreRecords.line) lineFeatures.push(coreRecords.line);

    // Every other landmass of consequence carries the owner's name too - Alaska,
    // a colony, the far half of an archipelago - so the map says who holds it
    // without a colour key. They are supplemental cartographic labels, not
    // polity records: the one-polity/one-logical-label invariant stands, and
    // each has a pseudo owner so the curve/point handoff treats it on its own.
    for (let index = 1; index < clusters.length; index += 1) {
      const part = clusters[index];
      if (part.area < MIN_PART_AREA_LOCAL || part.area < core.area * MIN_PART_FRACTION) break;
      const partRecords = buildLandmassLabelRecords({
        polygons: part.polygons,
        owner: `__part_${featureId}_${index}__`,
        name: upperName,
        featureId: `${featureId}-part-${index}`,
        extent,
        areaLngLat: polygonSetAreaLngLat(part.polygons),
        labelKind: "territory",
        sourceOwner: owner,
      });
      if (!partRecords) continue;
      pointFeatures.push(partRecords.point);
      if (partRecords.line) lineFeatures.push(partRecords.line);
    }

    // Detached geographic territories are supplemental cartographic labels, not
    // additional polity records. This keeps the one-polity/one-logical-label
    // invariant while allowing GREENLAND to exist alongside DENMARK.
    for (const territory of cartographicSets.detached) {
      const territoryArea = polygonSetAreaLngLat(territory.polygons);
      if (!(territoryArea > 0)) continue;
      const territoryCloud = [];
      let territoryMinX = Infinity;
      let territoryMinY = Infinity;
      let territoryMaxX = -Infinity;
      let territoryMaxY = -Infinity;
      for (const polygon of territory.polygons) {
        const outerTile = ringLngLatToTile(polygon?.[0], extent);
        if (outerTile.length < 4) continue;
        for (const point of outerTile) {
          territoryCloud.push(point);
          territoryMinX = Math.min(territoryMinX, point[0]);
          territoryMinY = Math.min(territoryMinY, point[1]);
          territoryMaxX = Math.max(territoryMaxX, point[0]);
          territoryMaxY = Math.max(territoryMaxY, point[1]);
        }
      }
      if (territoryCloud.length < 4) continue;
      const territoryShapeWidth = Math.max(0, territoryMaxX - territoryMinX);
      const territoryShapeHeight = Math.max(0, territoryMaxY - territoryMinY);
      const territoryAxis = getPrincipalAxisMetrics(territoryCloud);
      // Detached territories are already a geographic grouping rather than one
      // polygon. Anchor against the dissolved group's visual centre instead of
      // whichever administrative region happens to be the single largest.
      const territoryPoint = [
        (territoryMinX + territoryMaxX) / 2,
        (territoryMinY + territoryMaxY) / 2,
      ];
      const [territoryRawLng, territoryLat] = tileToLngLat(territoryPoint[0], territoryPoint[1], extent);
      const territoryName = String(territory.name).toUpperCase();
      const territoryPriority = Math.sqrt(Math.max(territoryArea, 1e-8)) * 17500;
      const territoryVisibility = visibilityScaleFor(territoryPriority, territoryName);
      const territoryTier = tierForVisibilityScale(territoryVisibility);
      const territoryTypography = fitPointTypography({
        shapeWidth: territoryShapeWidth,
        shapeHeight: territoryShapeHeight,
        axisSpan: territoryAxis.axisSpan,
        crossSpan: territoryAxis.crossSpan,
        name: territoryName,
        priorityScale: territoryPriority,
      });

      pointFeatures.push({
        type: "Feature",
        id: `territory-label-${territory.id}`,
        geometry: { type: "Point", coordinates: [wrapLongitude(territoryRawLng), territoryLat] },
        properties: {
          name: territoryName,
          owner: `__territory_${territory.id}__`,
          labelKind: "territory",
          tier: territoryTier.id,
          minZoom: territoryTier.minZoom,
          curveMinZoom: null,
          curveBand: "none",
          forceOverlapZoom: territoryTier.forceOverlapZoom,
          allowOverlap: true,
          areaScale: territoryPriority,
          priorityScale: territoryPriority,
          visibilityScale: Number(territoryVisibility.toFixed(2)),
          shapeWidth: territoryShapeWidth,
          shapeHeight: territoryShapeHeight,
          axisSpan: Number(territoryAxis.axisSpan.toFixed(3)),
          crossSpan: Number(territoryAxis.crossSpan.toFixed(3)),
          rotation: territoryAxis.angle,
          lat: territoryLat,
          anchorLng: wrapLongitude(territoryRawLng),
          anchorLat: territoryLat,
          mode: "point",
          presentation: "persistent",
          safeWarp: false,
          fitScale: territoryTypography.fitScale,
          fontPxAtZoom4: territoryTypography.fontPxAtZoom4,
          letterSpacing: territoryTypography.letterSpacing,
          targetOccupancy: territoryTypography.targetOccupancy,
          estimatedOccupancy: territoryTypography.estimatedOccupancy,
        },
      });
    }
  }

  return {
    labelData: { type: "FeatureCollection", features: logicalFeatures },
    curvedLabelData: { type: "FeatureCollection", features: [] },
    lineLabelData: { type: "FeatureCollection", features: lineFeatures },
    pointLabelData: { type: "FeatureCollection", features: pointFeatures },
    glyphLabelData: { type: "FeatureCollection", features: [] },
  };
};

export const summarizePolityLabelDiagnostics = (collections) => {
  const features = Array.isArray(collections?.labelData?.features)
    ? collections.labelData.features
    : [
        ...(collections?.lineLabelData?.features ?? []),
        ...(collections?.pointLabelData?.features ?? []),
      ];
  const counts = new Map();
  for (const feature of features) {
    const owner = String(feature?.properties?.owner ?? "");
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return features.map((feature) => {
    const props = feature?.properties ?? {};
    return {
      owner: props.owner,
      name: props.name,
      labelCount: counts.get(String(props.owner ?? "")) ?? 0,
      mode: props.mode,
      tier: props.tier,
      minZoom: props.minZoom,
      curveMinZoom: props.curveMinZoom,
      curveBand: props.curveBand,
      safeWarp: props.safeWarp,
      forceOverlapZoom: props.forceOverlapZoom,
      visibilityScale: props.visibilityScale,
      fontPxAtZoom4: props.fontPxAtZoom4,
      letterSpacing: props.letterSpacing,
      targetOccupancy: props.targetOccupancy,
      estimatedOccupancy: props.estimatedOccupancy,
      lineFontPxAtZoom4: props.lineFontPxAtZoom4,
      lineLetterSpacing: props.lineLetterSpacing,
      lineEstimatedOccupancy: props.lineEstimatedOccupancy,
      shapeWidth: Number(Number(props.shapeWidth ?? 0).toFixed(1)),
      shapeHeight: Number(Number(props.shapeHeight ?? 0).toFixed(1)),
      axisSpan: Number(Number(props.axisSpan ?? 0).toFixed(1)),
      crossSpan: Number(Number(props.crossSpan ?? 0).toFixed(1)),
      pathLength: Number(Number(props.pathLength ?? 0).toFixed(1)),
      pathWidth: Number(Number(props.pathWidth ?? 0).toFixed(1)),
      pathTurnDegrees: props.pathTurnDegrees,
      warpPointCount: props.warpPointCount,
      warpMaxSegmentTurnDegrees: props.warpMaxSegmentTurnDegrees,
      warpDetourRatio: props.warpDetourRatio,
      rotation: Number(Number(props.rotation ?? 0).toFixed(2)),
      anchorLng: Number(Number(props.anchorLng ?? 0).toFixed(3)),
      anchorLat: Number(Number(props.anchorLat ?? 0).toFixed(3)),
    };
  });
};

const isCountryLabelPayload = (value) =>
  value &&
  value.pointLabelData?.type === "FeatureCollection" &&
  Array.isArray(value.pointLabelData.features) &&
  value.curvedLabelData?.type === "FeatureCollection" &&
  Array.isArray(value.curvedLabelData.features);

export const loadCountryLabelCollections = async ({ force = false, ownedCodes = null } = {}) => {
  const tileData = await getCountriesTileData();
  const baseKey = tileData?.data
    ? computeCountryLabelCacheKey(tileData.data, PMTILES_ARCHIVES.countries)
    : COUNTRY_LABELS_CACHE_KEY;

  // A distinct owner set (scenario-specific label filtering) caches separately.
  let ownersSuffix = "";
  if (ownedCodes instanceof Set && ownedCodes.size > 0) {
    const joined = [...ownedCodes].sort().join(",");
    let hash = 2166136261;
    for (let i = 0; i < joined.length; i += 1) {
      hash ^= joined.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    ownersSuffix = `-own${ownedCodes.size}-${(hash >>> 0).toString(36)}`;
  }
  const cacheKey = `${baseKey}${ownersSuffix}`;

  if (!force && countryLabelsValue && countryLabelsValueKey === cacheKey) {
    return countryLabelsValue;
  }

  if (
    !force &&
    countryLabelsPromise &&
    countryLabelsPromiseKey === cacheKey
  ) {
    return countryLabelsPromise;
  }

  const request = (async () => {
    if (!force) {
      try {
        const cached = await readRuntimeJson(cacheKey);
        if (isCountryLabelPayload(cached)) {
          countryLabelsValue = cached;
          countryLabelsValueKey = cacheKey;
          return countryLabelsValue;
        }
      } catch {
        // Cache miss falls through to live generation.
      }
    }

    const built = await buildCountryLabelCollections(tileData, ownedCodes);

    // An empty result is almost always a degraded z0 read (a missing or garbled
    // tile resolves to undefined rather than throwing), not a genuinely
    // label-less world. Persisting it is unrecoverable: the payload validator
    // accepts an empty FeatureCollection, so every later boot serves the empty
    // cache and the country labels stay gone across reloads. Serve it once,
    // memoize nothing, and let the next call rebuild.
    const isEmpty =
      !built?.pointLabelData?.features?.length && !built?.curvedLabelData?.features?.length;
    if (isEmpty) {
      console.warn("Country labels came back empty — not caching, will rebuild.");
      return built;
    }

    countryLabelsValue = built;
    countryLabelsValueKey = cacheKey;

    try {
      await writeRuntimeJson(cacheKey, built);
    } catch {
      // Runtime cache persistence is best-effort only.
    }

    return countryLabelsValue;
  })()
    .catch((error) => {
      console.error("Failed to build country label collections:", error);
      countryLabelsValue = EMPTY_COUNTRY_LABELS;
      countryLabelsValueKey = cacheKey;
      return countryLabelsValue;
    })
    .finally(() => {
      countryLabelsPromise = null;
      countryLabelsPromiseKey = null;
    });

  countryLabelsPromise = request;
  countryLabelsPromiseKey = cacheKey;
  return request;
};

export const warmCountryLabelCollections = async (options = {}) => {
  const collections = await loadCountryLabelCollections(options);
  return {
    kind: "json",
    size: JSON.stringify(collections).length,
    url: countryLabelsValueKey || COUNTRY_LABELS_CACHE_KEY,
  };
};
