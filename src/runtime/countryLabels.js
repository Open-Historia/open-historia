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

const getPrincipalAxisAngle = (ring) => {
  if (!ring || ring.length < 3) return 0;

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

  const angleRad = Math.atan2(2 * cxy, cxx - cyy) / 2;
  let degrees = angleRad * (180 / Math.PI);

  if (degrees > 90) degrees -= 180;
  if (degrees < -90) degrees += 180;

  return degrees;
};

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

const buildCurvedLabelPath = (ring, name, { allowStraight = false } = {}) => {
  if (!ring || ring.length < 3) return null;

  const { cx, cy } = getCentroid(ring);
  const angleRad = getPrincipalAxisAngle(ring) * (Math.PI / 180);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const localRing = ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;

    return {
      s: dx * cos + dy * sin,
      t: -dx * sin + dy * cos,
    };
  });

  let minS = Infinity;
  let maxS = -Infinity;
  for (const point of localRing) {
    minS = Math.min(minS, point.s);
    maxS = Math.max(maxS, point.s);
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
    const intervals = getSliceIntervals(localRing, s);
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
    widthRatio > (allowStraight ? 0.92 : 0.22) ||
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

// Map vNext labels are generated from the same live dissolved polity surfaces
// that paint the political map. A conquest therefore changes the fill, border,
// and label geometry as one atomic presentation update. Broad polities emit one
// whole-word LINE-CENTRED symbol along an interior spine. MapLibre bends the
// complete word along that spine, so it reads as part of the landmass without
// the zoom/pan instability of separately anchored glyphs. Tiny or pathological
// shapes retain one interior point label as a safe fallback.
export const buildPolityLabelCollections = (
  politySurfaces,
  { nameResolver = (owner) => owner, extent = 4096 } = {},
) => {
  const pointFeatures = [];
  const curvedFeatures = [];
  const lineFeatures = [];
  const glyphFeatures = [];
  const features = Array.isArray(politySurfaces?.features) ? politySurfaces.features : [];

  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const feature = features[featureIndex];
    const owner = String(feature?.properties?.owner ?? "").trim();
    const name = String(nameResolver(owner, feature) ?? owner).trim();
    if (!owner || !name) continue;

    const allPolygons = feature?.geometry?.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature?.geometry?.type === "MultiPolygon"
        ? feature.geometry.coordinates
        : [];
    // Label geometry is derived from the full polity and never from the
    // currently visible slice. Viewport-clipping a continental polity caused
    // every pan to rebuild its axis, spacing and curve, producing isolated or
    // reordered glyphs at the screen edge.
    const polygons = allPolygons;

    const fullAreaLngLat = allPolygons.reduce((sum, polygon) => {
      const outer = calculateArea(polygon?.[0] ?? []);
      const holes = (polygon ?? []).slice(1).reduce((holeSum, ring) => holeSum + calculateArea(ring), 0);
      return sum + Math.max(0, outer - holes);
    }, 0);
    const priorityScale = Math.sqrt(Math.max(fullAreaLngLat, 1e-8)) * 17500;

    // One authoritative label per polity. Picking the largest live landmass
    // prevents archipelagos/colonies from printing the same country name over
    // every island while still following the polity's current shape.
    let bestPolygon = null;
    let bestOuterTile = null;
    let bestAreaTile = -1;
    for (const polygon of polygons) {
      const outerTile = ringLngLatToTile(polygon?.[0], extent);
      const areaTile = calculateArea(outerTile);
      if (outerTile.length < 4 || areaTile <= bestAreaTile) continue;
      bestPolygon = polygon;
      bestOuterTile = outerTile;
      bestAreaTile = areaTile;
    }
    if (!bestPolygon || !bestOuterTile) continue;

    const polygonTile = bestPolygon
      .map((ring) => ringLngLatToTile(ring, extent))
      .filter((ring) => ring.length >= 4);
    const outerArea = calculateArea(bestPolygon[0]);
    const holesArea = bestPolygon
      .slice(1)
      .reduce((sum, ring) => sum + calculateArea(ring), 0);
    const areaLngLat = Math.max(outerArea - holesArea, 1e-8);
    const areaScale = Math.sqrt(areaLngLat) * 17500;
    const upperName = name.toUpperCase();
    const featureId = `polity-label-${featureIndex}`;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of bestOuterTile) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
    const shapeWidth = Math.max(0, maxX - minX);
    const shapeHeight = Math.max(0, maxY - minY);
    const pathInfo = buildCurvedLabelPath(bestOuterTile, upperName, { allowStraight: true });
    if (pathInfo?.points?.length >= 4) {
      const liveGlyphs = buildCurvedLabelGlyphFeatures(
        pathInfo,
        extent,
        upperName,
        areaScale,
        `${featureId}-live`,
        { owner, priorityScale, name: upperName },
      );
      if (liveGlyphs) glyphFeatures.push(...liveGlyphs);
      const centerSample = getPointAlongPolyline(pathInfo.points, pathInfo.length / 2);
      const centerLngLat = centerSample
        ? tileToLngLat(centerSample.point[0], centerSample.point[1], extent)
        : [0, 0];
      const coordinates = pathInfo.points.map(([x, y]) => tileToLngLat(x, y, extent));
      lineFeatures.push({
        type: "Feature",
        id: `${featureId}-line`,
        geometry: { type: "LineString", coordinates },
        properties: {
          name: upperName,
          owner,
          areaScale,
          priorityScale,
          letterSpacing: labelLetterSpacing(pathInfo.length, areaScale, upperName),
          pathLength: pathInfo.length,
          pathWidth: pathInfo.width,
          anchorLng: wrapLongitude(centerLngLat[0]),
          anchorLat: centerLngLat[1],
          lat: centerLngLat[1],
          hasCurvedLabel: true,
        },
      });
      continue;
    }

    // One atomic point fallback. This only handles shapes too small or broken to
    // produce a usable interior spine; it is not used for continental polities.
    const pointTile = getInteriorLabelPoint(polygonTile);
    if (!pointTile) continue;
    const [rawLng, lat] = tileToLngLat(pointTile[0], pointTile[1], extent);
    pointFeatures.push({
      type: "Feature",
      id: `${featureId}-point`,
      geometry: { type: "Point", coordinates: [wrapLongitude(rawLng), lat] },
      properties: {
        name: upperName,
        owner,
        areaScale,
        priorityScale,
        letterSpacing: 0.08,
        shapeWidth,
        shapeHeight,
        rotation: getPrincipalAxisAngle(bestOuterTile),
        hasCurvedLabel: false,
        lat,
      },
    });
  }

  return {
    curvedLabelData: { type: "FeatureCollection", features: curvedFeatures },
    lineLabelData: { type: "FeatureCollection", features: lineFeatures },
    pointLabelData: { type: "FeatureCollection", features: pointFeatures },
    glyphLabelData: { type: "FeatureCollection", features: glyphFeatures },
  };
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
