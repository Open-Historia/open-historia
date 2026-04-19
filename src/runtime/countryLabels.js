import {
  PMTILES_ARCHIVES,
  decodeVectorTile,
  getPmtilesArchive,
  readRuntimeJson,
  resolveCountryDisplayName,
  writeRuntimeJson,
} from "./assets.js";

const COUNTRY_LABELS_CACHE_KEY = "country-labels-v2";
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

const buildCurvedLabelPath = (ring, name) => {
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
  const minPathLength = Math.max(80, compactNameLength * 20);

  if (
    directLength <= 0 ||
    pathLength < minPathLength ||
    widthRatio > 0.22 ||
    (pathLength / directLength <= 1.04 && turnDegrees <= 55)
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
  };
};

const buildCurvedLabelGlyphFeatures = (
  pathInfo,
  extent,
  name,
  areaScale,
  featureId,
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
  const sizeScale = clamp(advance / 52, 0.6, 0.92);
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

    let rotation = sample.angle;
    if (rotation > 90) rotation -= 180;
    if (rotation < -90) rotation += 180;

    features.push({
      type: "Feature",
      id: `${featureId}-glyph-${glyphIndex}`,
      geometry: {
        type: "Point",
        coordinates: tileToLngLat(sample.point[0], sample.point[1], extent),
      },
      properties: {
        glyph,
        areaScale: areaScale * sizeScale,
        rotation,
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

  return `${COUNTRY_LABELS_CACHE_KEY}-${bytes.byteLength}-${(hash >>> 0).toString(36)}-${encodeURIComponent(archiveUrl)}`;
};

const buildCountryLabelCollections = async (tileData) => {
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

  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index);
    const props = feature.properties;
    const code = props?.GID_0 || props?.gid_0 || props?.ISO_A3 || props?.iso_a3 || "";
    const name = resolveCountryDisplayName(
      props?.Country || props?.NAME || props?.name || props?.COUNTRY,
      code,
    );
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

const isCountryLabelPayload = (value) =>
  value &&
  value.pointLabelData?.type === "FeatureCollection" &&
  Array.isArray(value.pointLabelData.features) &&
  value.curvedLabelData?.type === "FeatureCollection" &&
  Array.isArray(value.curvedLabelData.features);

export const loadCountryLabelCollections = async ({ force = false } = {}) => {
  const tileData = await getCountriesTileData();
  const cacheKey = tileData?.data
    ? computeCountryLabelCacheKey(tileData.data, PMTILES_ARCHIVES.countries)
    : COUNTRY_LABELS_CACHE_KEY;

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

    const built = await buildCountryLabelCollections(tileData);
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
