/*! Open Historia — worker-safe live polity label geometry © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
// Pure geometry/text layout for the live polity labels. This module intentionally
// has no MapLibre, PMTiles, DOM, storage, or translation dependencies so it can
// run inside the political-cartography worker.

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

// Keep an antimeridian-crossing ring locally continuous. Owner aggregation normally
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

// ---- Checkpoint 4: validated territorial placement -------------------------
// The label solver remains intentionally lightweight and worker-owned.  We keep
// the proven scanline spine, but its final placement must now be demonstrably
// inside the selected owner component. Straight labels and curved labels share
// this same territorial solution.
const pointOnSegmentTile = (point, a, b, epsilon = 1e-5) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const px = point[0] - a[0];
  const py = point[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  // GeoJSON rings normally repeat their first coordinate at the end. Treat that
  // zero-length closing edge as a point, not as a segment containing everything.
  if (lengthSquared <= epsilon * epsilon) {
    return px * px + py * py <= epsilon * epsilon;
  }
  const cross = dx * py - dy * px;
  if (Math.abs(cross) > epsilon * Math.max(1, Math.sqrt(lengthSquared))) return false;
  const dot = px * dx + py * dy;
  if (dot < -epsilon) return false;
  return dot <= lengthSquared + epsilon;
};

// 1 = inside, 0 = boundary, -1 = outside.
const pointInRingStateTile = (point, ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return -1;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[previous];
    const b = ring[index];
    if (pointOnSegmentTile(point, a, b)) return 0;
    if ((a[1] > point[1]) === (b[1] > point[1])) continue;
    const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (x > point[0]) inside = !inside;
  }
  return inside ? 1 : -1;
};

const pointInPolygonTile = (point, polygonRings) => {
  if (pointInRingStateTile(point, polygonRings?.[0]) < 0) return false;
  for (const hole of polygonRings?.slice(1) ?? []) {
    // Hole interiors are excluded; their exact boundary is accepted to avoid
    // numerical seam failures on authored/admin geometry.
    if (pointInRingStateTile(point, hole) > 0) return false;
  }
  return true;
};

const pointInComponentTile = (point, componentPolygons) => (
  (componentPolygons ?? []).some((polygon) => pointInPolygonTile(point, polygon))
);

// PTR-1.6: publish a compact occupancy mask so the browser-side typography
// optimizer can score the ACTUAL warped label footprint against owned territory.
// This stays deliberately coarse/bounded: it is a placement field, not canonical
// geometry, and avoids shipping every administrative polygon to the main thread.
const tilePolygonBounds = (polygon) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon?.[0] ?? []) {
    if (!Array.isArray(point)) continue;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return { minX, minY, maxX, maxY };
};

const buildComponentTileSpatialIndex = ({
  componentPolygons,
  minX,
  minY,
  maxX,
  maxY,
  gridSize = 32,
}) => {
  const size = clamp(Math.floor(Number(gridSize) || 32), 8, 64);
  const width = Math.max(1e-9, maxX - minX);
  const height = Math.max(1e-9, maxY - minY);
  const cells = Array.from({ length: size * size }, () => []);
  const entries = (componentPolygons ?? []).map((polygon) => ({
    polygon,
    bounds: tilePolygonBounds(polygon),
  })).filter(({ bounds }) => Number.isFinite(bounds.minX));

  for (const entry of entries) {
    const { bounds } = entry;
    const c0 = clamp(Math.floor(((bounds.minX - minX) / width) * size), 0, size - 1);
    const c1 = clamp(Math.floor(((bounds.maxX - minX) / width) * size), 0, size - 1);
    const r0 = clamp(Math.floor(((bounds.minY - minY) / height) * size), 0, size - 1);
    const r1 = clamp(Math.floor(((bounds.maxY - minY) / height) * size), 0, size - 1);
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) cells[row * size + column].push(entry);
    }
  }

  const contains = (point) => {
    const x = Number(point?.[0]);
    const y = Number(point?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const column = clamp(Math.floor(((x - minX) / width) * size), 0, size - 1);
    const row = clamp(Math.floor(((y - minY) / height) * size), 0, size - 1);
    for (const { polygon, bounds } of cells[row * size + column]) {
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
      if (pointInPolygonTile([x, y], polygon)) return true;
    }
    return false;
  };

  return { contains, entries, size, cells, minX, minY, maxX, maxY };
};

const buildPtrCoverageGrid = ({
  componentPolygons,
  minX,
  minY,
  maxX,
  maxY,
  extent,
  resolution = 48,
  spatialIndex = null,
}) => {
  const size = clamp(Math.floor(Number(resolution) || 48), 24, 64);
  const width = Math.max(1e-9, maxX - minX);
  const height = Math.max(1e-9, maxY - minY);
  const index = spatialIndex ?? buildComponentTileSpatialIndex({
    componentPolygons,
    minX,
    minY,
    maxX,
    maxY,
    gridSize: size,
  });

  const rows = [];
  for (let row = 0; row < size; row += 1) {
    let values = "";
    const y = minY + ((row + 0.5) / size) * height;
    for (let column = 0; column < size; column += 1) {
      const x = minX + ((column + 0.5) / size) * width;
      values += index.contains([x, y]) ? "1" : "0";
    }
    rows.push(values);
  }
  return {
    resolution: size,
    bounds: [minX / extent, minY / extent, maxX / extent, maxY / extent]
      .map((value) => Number(value.toFixed(8))),
    rows,
  };
};

const polylineInsideComponentTile = (points, componentPolygons, spatialIndex = null) => {
  if (!Array.isArray(points) || points.length < 2) return false;
  const contains = spatialIndex?.contains
    ? spatialIndex.contains
    : (point) => pointInComponentTile(point, componentPolygons);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = clamp(Math.ceil(length / 2.5), 2, 80);
    for (let sample = 0; sample <= steps; sample += 1) {
      const fraction = sample / steps;
      const point = [
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
      ];
      if (!contains(point)) return false;
    }
  }
  return true;
};

const componentInteriorPoint = (componentPolygons, preferredPoint = null, spatialIndex = null) => {
  const contains = spatialIndex?.contains
    ? spatialIndex.contains
    : (point) => pointInComponentTile(point, componentPolygons);
  if (preferredPoint && contains(preferredPoint)) return preferredPoint;

  let best = null;
  for (const polygon of componentPolygons ?? []) {
    const point = getInteriorLabelPoint(polygon);
    if (!point || !pointInPolygonTile(point, polygon)) continue;
    const outerArea = calculateArea(polygon?.[0] ?? []);
    const holesArea = (polygon ?? []).slice(1).reduce((sum, ring) => sum + calculateArea(ring), 0);
    const area = Math.max(0, outerArea - holesArea);
    const distancePenalty = preferredPoint
      ? Math.hypot(point[0] - preferredPoint[0], point[1] - preferredPoint[1]) * 0.04
      : 0;
    const score = Math.sqrt(Math.max(area, 1)) - distancePenalty;
    if (!best || score > best.score) best = { point, score };
  }
  return best?.point ?? null;
};

const pathBendMetrics = (points) => {
  if (!Array.isArray(points) || points.length < 2) {
    return { directLength: 0, detourRatio: 1, maxDeviation: 0, bendRatio: 0 };
  }
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const directLength = Math.hypot(dx, dy);
  if (!(directLength > 0)) return { directLength: 0, detourRatio: 1, maxDeviation: 0, bendRatio: 0 };
  let maxDeviation = 0;
  for (const point of points) {
    const cross = Math.abs(dx * (start[1] - point[1]) - (start[0] - point[0]) * dy);
    maxDeviation = Math.max(maxDeviation, cross / directLength);
  }
  const pathLength = getPolylineLength(points);
  return {
    directLength,
    detourRatio: pathLength / directLength,
    maxDeviation,
    bendRatio: maxDeviation / directLength,
  };
};

const meaningfulTerritorialCurve = (pathInfo, { world = false } = {}) => {
  if (!pathInfo?.points?.length) return false;
  const bend = pathBendMetrics(pathInfo.points);
  const turn = getTotalTurnDegrees(pathInfo.points);
  return turn >= (world ? 6 : 9)
    && (bend.bendRatio >= (world ? 0.008 : 0.012) || bend.detourRatio >= (world ? 1.003 : 1.006));
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
// nearly touch. Authored administrative polygons routinely leave a mainland in adjacent pieces
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

const buildCurvedLabelPath = (ring, { allowStraight = false, center = null, angleDeg = null, extraRings = [] } = {}) => {
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

  let rawSamples = samples
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

  // A narrow neck followed by a distant interval is usually a peninsula,
  // detached lobe, or administrative sliver rather than part of the useful text
  // corridor. Following it is what previously sent China's baseline climbing
  // through Manchuria. Keep the best continuous high-clearance run instead.
  const sortedWidths = rawSamples.map((sample) => sample.width).sort((a, b) => a - b);
  const medianWidth = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? 0;
  const minimumCorridorWidth = Math.max(3, medianWidth * 0.18);
  const runs = [];
  let run = [];
  const flushRun = () => {
    if (run.length >= 4) runs.push(run);
    run = [];
  };
  for (const sample of rawSamples) {
    const previous = run[run.length - 1];
    const continuityLimit = previous
      ? Math.max(18, Math.min(previous.width, sample.width) * 0.72)
      : Infinity;
    const usable = sample.width >= minimumCorridorWidth
      && (!previous || Math.abs(sample.t - previous.t) <= continuityLimit);
    if (!usable) {
      flushRun();
      if (sample.width >= minimumCorridorWidth) run = [sample];
      continue;
    }
    run.push(sample);
  }
  flushRun();

  if (runs.length) {
    const scoreRun = (candidate) => {
      const span = candidate[candidate.length - 1].s - candidate[0].s;
      const average = candidate.reduce((sum, sample) => sum + sample.width, 0) / candidate.length;
      const containsCenter = candidate[0].s <= 0 && candidate[candidate.length - 1].s >= 0;
      return span * Math.sqrt(Math.max(average, 1)) * (containsCenter ? 1.12 : 1);
    };
    rawSamples = runs.reduce((best, candidate) => (
      !best || scoreRun(candidate) > scoreRun(best) ? candidate : best
    ), null) ?? rawSamples;
  }

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
  // Geometry fitting is deliberately text-agnostic. The same territory must
  // produce the same candidate spine whether its display name is CHINA,
  // PEOPLE'S REPUBLIC OF CHINA, or a localized equivalent. Typography decides
  // how that fixed placement is used later; it never changes the geometry.
  const minPathLength = allowStraight ? 36 : 80;

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

const getPathFlowMetrics = (points) => {
  if (!Array.isArray(points) || points.length < 3) {
    return { totalTurnDegrees: 0, maxSegmentTurnDegrees: 0, wiggleDegrees: 0, turnReversals: 0 };
  }
  const signedTurns = [];
  let totalTurnDegrees = 0;
  let maxSegmentTurnDegrees = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const a = Math.atan2(current[1] - previous[1], current[0] - previous[0]);
    const b = Math.atan2(next[1] - current[1], next[0] - current[0]);
    let delta = (b - a) * (180 / Math.PI);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    signedTurns.push(delta);
    totalTurnDegrees += Math.abs(delta);
    maxSegmentTurnDegrees = Math.max(maxSegmentTurnDegrees, Math.abs(delta));
  }
  let wiggleDegrees = 0;
  let turnReversals = 0;
  for (let index = 1; index < signedTurns.length; index += 1) {
    wiggleDegrees += Math.abs(signedTurns[index] - signedTurns[index - 1]);
    if (
      Math.abs(signedTurns[index - 1]) >= 2.5
      && Math.abs(signedTurns[index]) >= 2.5
      && Math.sign(signedTurns[index - 1]) !== Math.sign(signedTurns[index])
    ) turnReversals += 1;
  }
  return { totalTurnDegrees, maxSegmentTurnDegrees, wiggleDegrees, turnReversals };
};

const limitPolylineBend = (points, maxBendRatio, validatePath = null) => {
  if (!Array.isArray(points) || points.length < 3) return points;
  const bend = pathBendMetrics(points);
  if (!(bend.bendRatio > maxBendRatio) || !(bend.directLength > 0)) return points;
  const start = points[0];
  const end = points[points.length - 1];
  const targetFactor = clamp(maxBendRatio / bend.bendRatio, 0.18, 1);
  const factors = [
    targetFactor,
    targetFactor + (1 - targetFactor) * 0.25,
    targetFactor + (1 - targetFactor) * 0.50,
    targetFactor + (1 - targetFactor) * 0.75,
    1,
  ];
  for (const factor of factors) {
    const candidate = points.map((point, index) => {
      if (index === 0 || index === points.length - 1) return point;
      const t = index / (points.length - 1);
      const chord = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
      return [
        chord[0] + (point[0] - chord[0]) * factor,
        chord[1] + (point[1] - chord[1]) * factor,
      ];
    });
    if (!validatePath || validatePath(candidate)) return candidate;
  }
  return points;
};

// CP4.3: MapLibre lays a whole word over only the centered span that its
// glyphs actually occupy. A country-wide baseline can therefore be strongly
// curved in its tails while the rendered name still sits on an almost straight
// middle section. Measure and, where necessary, gently shape the text-bearing
// support window itself rather than scoring only the complete polyline.
const centeredPolylineWindow = (points, fraction = 0.7, sampleCount = 21) => {
  if (!Array.isArray(points) || points.length < 2) return [];
  const totalLength = getPolylineLength(points);
  if (!(totalLength > 0)) return [...points];
  const safeFraction = clamp(Number(fraction) || 0.7, 0.2, 1);
  const startDistance = totalLength * (1 - safeFraction) * 0.5;
  const endDistance = totalLength - startDistance;
  const count = clamp(Math.round(sampleCount), 5, 41);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const distance = startDistance + ((endDistance - startDistance) * index) / (count - 1);
    const sample = getPointAlongPolyline(points, distance);
    if (sample?.point) result.push(sample.point);
  }
  return result;
};

const cartographicSupportMetrics = (points, fraction = 0.7) => {
  const support = centeredPolylineWindow(points, fraction);
  const bend = pathBendMetrics(support);
  const flow = getPathFlowMetrics(support);
  return {
    fraction: clamp(Number(fraction) || 0.7, 0.2, 1),
    points: support,
    bendRatio: Number(bend?.bendRatio ?? 0),
    totalTurnDegrees: Number(flow?.totalTurnDegrees ?? 0),
    maxSegmentTurnDegrees: Number(flow?.maxSegmentTurnDegrees ?? 0),
  };
};

const calmPathForRenderer = (pathInfo, maxTurnDegrees, validatePath = null) => {
  if (!pathInfo?.points?.length || pathInfo.points.length < 3) return pathInfo;
  let points = pathInfo.points;
  let flow = getPathFlowMetrics(points);
  if (flow.maxSegmentTurnDegrees <= maxTurnDegrees) {
    return { ...pathInfo, ...flow };
  }

  for (let pass = 0; pass < 5; pass += 1) {
    const candidate = points.map((point, index) => {
      if (index === 0 || index === points.length - 1) return point;
      return [
        points[index - 1][0] * 0.16 + point[0] * 0.68 + points[index + 1][0] * 0.16,
        points[index - 1][1] * 0.16 + point[1] * 0.68 + points[index + 1][1] * 0.16,
      ];
    });
    if (validatePath && !validatePath(candidate)) break;
    points = candidate;
    flow = getPathFlowMetrics(points);
    if (flow.maxSegmentTurnDegrees <= maxTurnDegrees) break;
  }

  const length = getPolylineLength(points);
  const directLength = Math.hypot(
    points[points.length - 1][0] - points[0][0],
    points[points.length - 1][1] - points[0][1],
  );
  return {
    ...pathInfo,
    points,
    length,
    ...flow,
    detourRatio: directLength > 0 ? length / directLength : pathInfo.detourRatio,
  };
};

const ensureCartographicSupportBend = (
  pathInfo,
  validatePath = null,
  {
    supportFraction = 0.7,
    targetBendRatio = 0.018,
    minimumSeedBendRatio = 0.006,
    maxSegmentTurnDegrees = 44,
    maxDetourRatio = 1.24,
  } = {},
) => {
  if (!pathInfo?.points?.length || pathInfo.points.length < 3) return pathInfo;

  const originalMetrics = cartographicSupportMetrics(pathInfo.points, supportFraction);
  // Do not paint decorative curvature onto geometry that is genuinely straight.
  // The atlas target preserves and clarifies territorial flow; it does not bend a
  // perfect rectangle merely because curved labels are fashionable.
  if (originalMetrics.bendRatio < minimumSeedBendRatio || originalMetrics.bendRatio >= targetBendRatio) {
    return {
      ...pathInfo,
      supportFraction,
      supportBendRatio: originalMetrics.bendRatio,
      supportTurnDegrees: originalMetrics.totalTurnDegrees,
    };
  }

  const points = pathInfo.points;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const directLength = Math.hypot(dx, dy);
  const totalLength = getPolylineLength(points);
  if (!(directLength > 0) || !(totalLength > 0)) return pathInfo;

  const nx = -dy / directLength;
  const ny = dx / directLength;
  const progress = [0];
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    travelled += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
    progress.push(clamp(travelled / totalLength, 0, 1));
  }

  // A single sine arch adds only low-frequency cartographic flow. Both sides of
  // the baseline are tried and full polygon containment remains mandatory, so
  // the solver never invents a bow that escapes the polity merely to look nice.
  const amplitudeRatios = [0.012, 0.025, 0.045, 0.065];
  const candidates = [];
  for (const amplitudeRatio of amplitudeRatios) {
    const amplitude = directLength * amplitudeRatio;
    for (const sign of [-1, 1]) {
      const candidatePoints = points.map((point, index) => {
        if (index === 0 || index === points.length - 1) return point;
        const envelope = Math.sin(Math.PI * progress[index]);
        return [
          point[0] + nx * amplitude * envelope * sign,
          point[1] + ny * amplitude * envelope * sign,
        ];
      });
      if (validatePath && !validatePath(candidatePoints)) continue;

      const length = getPolylineLength(candidatePoints);
      const detourRatio = length / directLength;
      const flow = getPathFlowMetrics(candidatePoints);
      if (
        flow.maxSegmentTurnDegrees > maxSegmentTurnDegrees
        || flow.turnReversals > 4
        || flow.wiggleDegrees > 220
        || detourRatio > maxDetourRatio
      ) continue;

      const support = cartographicSupportMetrics(candidatePoints, supportFraction);
      candidates.push({
        points: candidatePoints,
        amplitudeRatio,
        support,
        length,
        detourRatio,
        flow,
      });
    }
  }

  if (!candidates.length) {
    return {
      ...pathInfo,
      supportFraction,
      supportBendRatio: originalMetrics.bendRatio,
      supportTurnDegrees: originalMetrics.totalTurnDegrees,
    };
  }

  const meetingTarget = candidates.filter((candidate) => candidate.support.bendRatio >= targetBendRatio);
  const pool = meetingTarget.length ? meetingTarget : candidates;
  const best = pool.reduce((winner, candidate) => {
    if (!winner) return candidate;
    if (meetingTarget.length) {
      // Once the visible glyph support bends enough, prefer the smallest calm
      // intervention. Curvature should be perceptible, not ornamental excess.
      if (candidate.amplitudeRatio !== winner.amplitudeRatio) {
        return candidate.amplitudeRatio < winner.amplitudeRatio ? candidate : winner;
      }
      if (candidate.flow.maxSegmentTurnDegrees !== winner.flow.maxSegmentTurnDegrees) {
        return candidate.flow.maxSegmentTurnDegrees < winner.flow.maxSegmentTurnDegrees ? candidate : winner;
      }
      return candidate.support.bendRatio < winner.support.bendRatio ? candidate : winner;
    }
    return candidate.support.bendRatio > winner.support.bendRatio ? candidate : winner;
  }, null);

  return {
    ...pathInfo,
    points: best.points,
    length: best.length,
    totalTurnDegrees: best.flow.totalTurnDegrees,
    maxSegmentTurnDegrees: best.flow.maxSegmentTurnDegrees,
    wiggleDegrees: best.flow.wiggleDegrees,
    turnReversals: best.flow.turnReversals,
    detourRatio: best.detourRatio,
    supportFraction,
    supportBendRatio: best.support.bendRatio,
    supportTurnDegrees: best.support.totalTurnDegrees,
  };
};

// MapLibre's native whole-word line renderer is much stricter than our
// geometric spine builder. R6 could therefore classify a polity as "hybrid",
// switch its guaranteed point label off, and then have MapLibre reject the
// detailed line at the exact same zoom. R7 creates a deliberately small,
// gently-bending spine and admits a handoff ONLY when that simplified path is
// safe enough for the native renderer. Unsafe shapes stay point-mode forever.
const buildSafeMapLibreWarpPath = (pathInfo, validatePath = null) => {
  if (!pathInfo?.points?.length || pathInfo.points.length < 4) return null;

  const sampleCount = pathInfo.length >= 280 ? 7 : 5;
  const points = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = getPointAlongPolyline(
      pathInfo.points,
      (pathInfo.length * index) / (sampleCount - 1),
    );
    if (!sample?.point) return null;
    points.push(sample.point);
  }

  // Only damp high-frequency movement. Broad monotonic curvature is desirable;
  // alternating short bends are not.
  const smoothed = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    return [
      points[index - 1][0] * 0.12 + point[0] * 0.76 + points[index + 1][0] * 0.12,
      points[index - 1][1] * 0.12 + point[1] * 0.76 + points[index + 1][1] * 0.12,
    ];
  });

  let safePoints = !validatePath || validatePath(smoothed) ? smoothed : points;
  if (validatePath && !validatePath(safePoints)) return null;
  safePoints = limitPolylineBend(safePoints, 0.105, validatePath);

  const length = getPolylineLength(safePoints);
  const directLength = Math.hypot(
    safePoints[safePoints.length - 1][0] - safePoints[0][0],
    safePoints[safePoints.length - 1][1] - safePoints[0][1],
  );
  if (directLength <= 0) return null;

  const flow = getPathFlowMetrics(safePoints);
  const detourRatio = length / directLength;

  if (
    length < 42
    || flow.totalTurnDegrees > 165
    || flow.maxSegmentTurnDegrees > 46
    || flow.wiggleDegrees > 220
    || flow.turnReversals > 4
    || detourRatio > 1.25
  ) return null;

  return {
    ...pathInfo,
    points: safePoints,
    length,
    ...flow,
    detourRatio,
  };
};

// Overview typography uses a simplified sample of the same validated territorial
// spine. It must not invent curvature, and it must not flatten a real bend back
// into a generic chord. No polity name is special-cased: scale + geometry decide.
const buildGentleWorldWarpPath = (pathInfo, validatePath = null) => {
  if (!pathInfo?.points?.length || pathInfo.points.length < 3) return null;

  const sampleCount = pathInfo.length >= 650 ? 7 : 5;
  const points = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = getPointAlongPolyline(
      pathInfo.points,
      (pathInfo.length * index) / (sampleCount - 1),
    );
    if (!sample?.point) return null;
    points.push(sample.point);
  }

  const smoothed = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    return [
      points[index - 1][0] * 0.03 + point[0] * 0.94 + points[index + 1][0] * 0.03,
      points[index - 1][1] * 0.03 + point[1] * 0.94 + points[index + 1][1] * 0.03,
    ];
  });
  let safePoints = !validatePath || validatePath(smoothed) ? smoothed : points;
  if (validatePath && !validatePath(safePoints)) return null;
  safePoints = limitPolylineBend(safePoints, 0.12, validatePath);

  const length = getPolylineLength(safePoints);
  const directLength = Math.hypot(
    safePoints[safePoints.length - 1][0] - safePoints[0][0],
    safePoints[safePoints.length - 1][1] - safePoints[0][1],
  );
  if (directLength <= 0) return null;

  const flow = getPathFlowMetrics(safePoints);
  const detourRatio = length / directLength;
  if (
    length < 120
    || flow.totalTurnDegrees > 155
    || flow.maxSegmentTurnDegrees > 42
    || flow.wiggleDegrees > 200
    || flow.turnReversals > 4
    || detourRatio > 1.22
  ) return null;

  return {
    ...pathInfo,
    points: safePoints,
    length,
    ...flow,
    detourRatio,
  };
};

// --- Map vNext polity label policy + worker-owned canonical-owner geometry ---

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
  // CP4.2: the territorial baseline is the normal cartographic presentation,
  // not a late "curve upgrade". Enter shortly after the polity itself becomes
  // eligible so the point fallback is only a renderer safety net.
  const lead = band === "world" ? 0.05 : band === "early" ? 0.10 : 0.15;
  return Math.max(tier.minZoom + lead, band === "world" ? 0.85 : tier.minZoom);
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
  // Atlas-style point labels spend territory on larger glyphs first and tracking
  // second. R3/R4 did the opposite on many states, producing delicate labels
  // with too much empty air between letters.
  if (letters <= 5) return line ? 0.50 : 0.36;
  if (letters <= 7) return line ? 0.38 : 0.28;
  if (letters <= 10) return line ? 0.28 : 0.20;
  if (letters <= 14) return line ? 0.20 : 0.14;
  if (letters <= 20) return line ? 0.13 : 0.10;
  return line ? 0.08 : 0.07;
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
  if (letters <= 5) return 0.78;
  if (letters <= 7) return 0.62;
  if (letters <= 10) return 0.46;
  if (letters <= 14) return 0.34;
  if (letters <= 20) return 0.22;
  return 0.13;
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

  // CP4.2: line typography fits TO the baseline. Diagnostics proved that the
  // production USA spine rendered correctly at 18px but disappeared around
  // 20px, even though the geometry itself was valid. Leave deliberate renderer
  // headroom instead of asking MapLibre to solve the same near-limit fit again.
  // CP4.3: the relevant quantity is not how curved the whole support line is,
  // but how much of that curvature sits under the centered glyph footprint.
  // ~50% occupancy let USA/Poland use an almost ruler-straight middle even when
  // their full baselines bent strongly in the tails. Let the name occupy most of
  // the validated support while retaining MapLibre headroom.
  const supportBendRatio = Number(
    pathInfo.supportBendRatio
      ?? cartographicSupportMetrics(pathInfo.points, 0.7).bendRatio
      ?? 0,
  );
  const bendExposureBoost = supportBendRatio < 0.022
    ? 0.05
    : supportBendRatio < 0.04
      ? 0.025
      : 0;
  const targetOccupancy = clamp(
    0.69
      + Math.log2(Math.max(priorityScale, 26000) / 52000) * 0.012
      + bendExposureBoost,
    0.66,
    0.76,
  );
  const targetWidth = pathPixels * targetOccupancy;
  const preferredSpacing = preferredLetterSpacing(name, "line");
  const maxSpacing = maxLetterSpacing(name, "line");
  const heightCap = clamp(corridorPixels * 0.46, 10, 220);
  const absoluteCap = 220;

  let fontPx = targetWidth / Math.max(0.1, estimatedTextWidthEm(name, preferredSpacing));
  fontPx = clamp(fontPx, 6, Math.min(heightCap, absoluteCap));

  const gaps = textGapCount(name);
  let letterSpacing = preferredSpacing;
  if (gaps > 0) {
    letterSpacing = clamp(
      (targetWidth / Math.max(fontPx, 1) - textBaseWidthEm(name)) / gaps,
      0.04,
      maxSpacing,
    );
  }

  fontPx = clamp(
    targetWidth / Math.max(0.1, estimatedTextWidthEm(name, letterSpacing)),
    6,
    Math.min(heightCap, absoluteCap),
  );

  const actualWidth = estimatedTextWidthEm(name, letterSpacing) * fontPx;
  return {
    fitScale: fitScaleFromFontPx(fontPx),
    fontPxAtZoom4: Number(fontPx.toFixed(2)),
    letterSpacing: Number(letterSpacing.toFixed(3)),
    targetOccupancy: Number(targetOccupancy.toFixed(3)),
    estimatedOccupancy: Number(clamp(actualWidth / pathPixels, 0, 2).toFixed(3)),
    supportBendRatio: Number(supportBendRatio.toFixed(4)),
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
  // bounding box. That is the key atlas behaviour: Germany/UK may use their
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

  // R5 deliberately overshot the atlas target to prove that dominant-axis fitting
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
// A detached landmass carries the owner's name when it has at least this much
// ground (cos-scaled square degrees; three is roughly 37,000 km², Taiwan-sized)
// and at least this share of the core landmass.
const MIN_PART_AREA_LOCAL = 3;
const MIN_PART_FRACTION = 0.03;
// Polygons whose bounding boxes come within this many degrees of one another
// are one landmass for labelling: a mainland authored as adjacent region pieces,
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
// homeFlags marks, index for index, the polygons on the polity's home ground; a
// landmass holding any of them is `home`.
const landmassClusters = (polygons, homeFlags = null) => {
  const items = [];
  (polygons ?? []).forEach((polygon, polygonIndex) => {
    const area = polygonAreaLocal(polygon);
    if (!(area > PART_CLUSTER_MIN_AREA_LOCAL)) return;
    const bounds = polygonBoundsLngLat(polygon);
    if (!Number.isFinite(bounds.west)) return;
    items.push({ polygon, area, bounds, home: Boolean(homeFlags?.[polygonIndex]) });
  });
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
      cluster.home = cluster.home || item.home;
    } else {
      clusters.set(root, { polygons: [item.polygon], area: item.area, home: item.home });
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


const polygonSetAreaLngLat = (polygons) => (polygons ?? []).reduce((sum, polygon) => {
  const outer = calculateArea(polygon?.[0] ?? []);
  const holes = (polygon ?? []).slice(1)
    .reduce((holeSum, ring) => holeSum + calculateArea(ring), 0);
  return sum + Math.max(0, outer - holes);
}, 0);

// A sovereign owner may hold a detached dependency much larger than its own
// country - Greenland is far larger than Denmark - so area alone cannot find the
// political core. The regions say where the polity is at home: the stock country
// most of them came from (the aggregation's first gadm0). Its polygons are
// flagged here, and the core is the largest landmass holding any of them. A
// polity whose regions carry no stock country keeps the largest landmass.
// No polity name is special-cased; the dependency is labelled like any other
// landmass of consequence.
const homePolygonFlags = (feature, allPolygons) => {
  const properties = feature?.properties ?? {};
  const home = String(properties.gadm0?.[0] ?? "").trim();
  const codes = properties.polygonGadm0;
  if (!home || !Array.isArray(codes) || codes.length !== allPolygons.length) return null;
  return codes.map((code) => code === home);
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

// Checkpoint 2/3: solve the cartographic geometry before typography sees a
// display name. The complete selected component participates in the solution;
// administrative fragmentation is never simplified by dropping polygons.
//
// The geometry result below remains a pure function of territory. CP4 keeps the
// bounded scanline spine, but validates its final interior path and replaces the
// old hard horizontal mode with a soft cartographic preference.
const rotationDistance = (left, right) => {
  let delta = Math.abs(normalizeRotation(left) - normalizeRotation(right));
  if (delta > 90) delta = 180 - delta;
  return Math.abs(delta);
};

const buildValidatedPlacementCandidate = ({
  angle,
  centerTile,
  bestOuterTile,
  extraRings,
  componentPolygons,
  spatialIndex = null,
}) => {
  const rawPathInfo = buildCurvedLabelPath(bestOuterTile, {
    allowStraight: true,
    center: centerTile,
    angleDeg: angle,
    extraRings,
  });
  if (!rawPathInfo?.points?.length) return null;
  if (!polylineInsideComponentTile(rawPathInfo.points, componentPolygons, spatialIndex)) return null;

  const bend = pathBendMetrics(rawPathInfo.points);
  const flow = getPathFlowMetrics(rawPathInfo.points);
  const clearanceFactor = clamp((rawPathInfo.clearance ?? rawPathInfo.width * 0.25) / Math.max(rawPathInfo.width, 1), 0.08, 0.5);
  // Broad curvature is cheap. Only high-frequency direction changes and abrupt
  // local turns reduce the candidate's cartographic score.
  const flowPenalty = 1
    + flow.wiggleDegrees / 240
    + flow.turnReversals * 0.16
    + Math.max(0, flow.maxSegmentTurnDegrees - 30) / 140;
  return {
    angle: normalizeRotation(angle),
    rawPathInfo: {
      ...rawPathInfo,
      ...flow,
      ...bend,
    },
    score: (
      rawPathInfo.length
      * Math.sqrt(Math.max(rawPathInfo.width, 1))
      * (0.72 + clearanceFactor * 0.56)
    ) / flowPenalty,
  };
};

const chooseValidatedPlacementCandidate = ({
  momentAngle,
  elongation,
  centerTile,
  bestOuterTile,
  extraRings,
  componentPolygons,
}) => {
  // Compact territories often have a useful direction between their raw moment
  // axis and horizontal (France is a representative real fixture). Test only a
  // few deterministic directions; this remains bounded enough for worker use.
  const temperedAngle = normalizeRotation(momentAngle * 0.48);
  const angles = [
    normalizeRotation(momentAngle),
    temperedAngle,
    0,
  ];
  if (Math.abs(momentAngle) >= 58) angles.push(momentAngle > 0 ? 90 : -90);

  const candidates = [];
  for (const angle of angles) {
    if (candidates.some((candidate) => rotationDistance(candidate.angle, angle) < 1.5)) continue;
    const candidate = buildValidatedPlacementCandidate({
      angle,
      centerTile,
      bestOuterTile,
      extraRings,
      componentPolygons,
    });
    if (candidate) candidates.push(candidate);
  }
  if (!candidates.length) return null;

  let best = candidates.reduce((winner, candidate) => {
    const distance = rotationDistance(candidate.angle, momentAngle);
    // Strongly directional geometry receives a modest axis preference. Compact
    // geometry is allowed to choose the corridor that actually fits best.
    const axisPreference = 1 + Math.max(0, elongation - 1.25) * (1 - distance / 90) * 0.055;
    const ranked = candidate.score * axisPreference;
    return !winner || ranked > winner.ranked ? { candidate, ranked } : winner;
  }, null)?.candidate;

  const moment = candidates.find((candidate) => rotationDistance(candidate.angle, momentAngle) < 1.5);
  const horizontal = candidates.find((candidate) => Math.abs(candidate.angle) < 1.5);

  if (moment && elongation >= 1.65 && moment.score >= best.score * 0.78) best = moment;

  // Horizontal remains a tiny readability preference only for genuinely
  // directionless shapes; it no longer flattens Germany/Belarus/Poland-class
  // territories merely because they are not extremely elongated.
  if (horizontal && best !== horizontal && elongation < 1.12 && horizontal.score >= best.score * 0.95) {
    best = horizontal;
  }
  return best;
};

// Checkpoint 4: one validated territorial placement feeds both straight and
// curved presentations. Compact states may remain straight/horizontal, but only
// as a soft cartographic preference; elongated/diagonal states follow geometry.
const buildLandmassGeometryLayout = ({
  polygons,
  extent,
  areaLngLat,
}) => {
  const priorityScale = Math.sqrt(Math.max(areaLngLat, 1e-8)) * 17500;

  const pieces = (Array.isArray(polygons) ? polygons : [])
    .map((polygon) => ({
      polygon,
      areaLocal: polygonAreaLocal(polygon),
      tilePolygon: (polygon ?? [])
        .map((ring) => ringLngLatToTile(ring, extent))
        .filter((ring) => ring.length >= 4),
    }))
    .filter((piece) => piece.areaLocal > 0 && piece.tilePolygon[0]?.length >= 4)
    .sort((left, right) => right.areaLocal - left.areaLocal);
  if (!pieces.length) return null;

  const componentPieces = pieces;
  const componentAreaLocal = componentPieces.reduce((sum, piece) => sum + piece.areaLocal, 0);
  const componentPolygons = componentPieces.map((piece) => piece.tilePolygon);
  const bestOuterTile = componentPieces[0].tilePolygon[0];
  const extraRings = componentPieces.slice(1).map((piece) => piece.tilePolygon[0]);
  const allOuterPoints = componentPieces.flatMap((piece) => piece.tilePolygon[0]);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of allOuterPoints) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  const shapeWidth = Math.max(0, maxX - minX);
  const shapeHeight = Math.max(0, maxY - minY);
  const shortSide = Math.max(1, Math.min(shapeWidth, shapeHeight));
  const longSide = Math.max(shapeWidth, shapeHeight);
  const aspectRatio = longSide / shortSide;

  const moments = clusterMomentsLocal(componentPieces.map((piece) => piece.polygon[0]));
  const momentAngle = moments ? normalizeRotation(-moments.angleDeg) : 0;
  const elongation = moments?.elongation ?? 1;
  const centerTile = moments
    ? lngLatToTile(moments.lng, moments.lat, extent)
    : [(minX + maxX) / 2, (minY + maxY) / 2];

  // PTR owns final typography and is allowed to use the polity envelope more
  // boldly than the legacy fully-contained MapLibre corridor. Publish a stable
  // typography axis separately from the legacy placement path. Directional
  // shapes keep their moment axis; near-square shapes with an extreme PCA axis
  // are tempered toward a readable diagonal instead of collapsing horizontal.
  let ptrPreferredAngle = momentAngle;
  if (elongation < 1.35 && Math.abs(momentAngle) > 55) {
    ptrPreferredAngle = Math.sign(momentAngle || 1)
      * clamp(Math.abs(momentAngle) * 0.55, 30, 48);
  }
  ptrPreferredAngle = normalizeRotation(ptrPreferredAngle);
  const ptrAxisMetrics = projectedAxisMetrics(allOuterPoints, ptrPreferredAngle);
  const componentSpatialIndex = buildComponentTileSpatialIndex({
    componentPolygons,
    minX,
    minY,
    maxX,
    maxY,
    gridSize: 32,
  });
  const ptrCoverageGrid = buildPtrCoverageGrid({
    componentPolygons,
    minX,
    minY,
    maxX,
    maxY,
    extent,
    resolution: 48,
    spatialIndex: componentSpatialIndex,
  });

  const placement = chooseValidatedPlacementCandidate({
    momentAngle,
    elongation,
    centerTile,
    bestOuterTile,
    extraRings,
    componentPolygons,
    spatialIndex: componentSpatialIndex,
  });

  const fallbackPoint = componentInteriorPoint(componentPolygons, centerTile, componentSpatialIndex);
  const rawPathInfo = placement?.rawPathInfo ?? null;
  let rotation = placement?.angle ?? (elongation >= 1.12 ? momentAngle : 0);

  // If a very elongated state somehow selected a nearly perpendicular corridor,
  // retain its actual territorial direction. This is a fallback, not a separate
  // horizontal/vertical mode.
  if (elongation >= 2.6 && rotationDistance(rotation, momentAngle) > 32) {
    rotation = momentAngle;
  }

  const axisMetrics = projectedAxisMetrics(allOuterPoints, rotation);
  const axisAspectRatio = axisMetrics.axisSpan / Math.max(1, axisMetrics.crossSpan);
  const validatePath = (points) => polylineInsideComponentTile(points, componentPolygons, componentSpatialIndex);
  const pathMatchesPresentationAxis = !placement || rotationDistance(rotation, placement.angle) <= 32;
  let safeWarpPath = rawPathInfo && pathMatchesPresentationAxis
    ? buildSafeMapLibreWarpPath(rawPathInfo, validatePath)
    : null;
  let worldWarpPath = rawPathInfo && pathMatchesPresentationAxis
    ? buildGentleWorldWarpPath(rawPathInfo, validatePath)
    : null;

  // CP4.3: optimize the centered support that the glyphs actually occupy. The
  // broad-path solver remains territory-first; this final low-frequency bow is
  // only allowed inside the validated component and is deliberately weaker for
  // very slender states where a near-straight axis is often the truthful shape.
  const slenderFlowFactor = clamp(2.8 / Math.max(1, elongation), 0.55, 1);
  const detailSupportTarget = (
    priorityScale >= 65000 ? 0.032
      : priorityScale >= 22000 ? 0.024
        : 0.018
  ) * slenderFlowFactor;
  const worldSupportTarget = 0.050 * slenderFlowFactor;

  if (safeWarpPath) {
    safeWarpPath = calmPathForRenderer(safeWarpPath, 40, validatePath);
    safeWarpPath = ensureCartographicSupportBend(safeWarpPath, validatePath, {
      supportFraction: 0.7,
      targetBendRatio: detailSupportTarget,
      maxSegmentTurnDegrees: 40,
      maxDetourRatio: 1.25,
    });
  }
  if (worldWarpPath && priorityScale >= 350000) {
    // The live world layer uses text-max-angle=38. Keep deterministic headroom
    // in the geometry itself instead of asking MapLibre to make the final call.
    worldWarpPath = calmPathForRenderer(worldWarpPath, 32, validatePath);
    worldWarpPath = ensureCartographicSupportBend(worldWarpPath, validatePath, {
      supportFraction: 0.7,
      targetBendRatio: worldSupportTarget,
      maxSegmentTurnDegrees: 32,
      maxDetourRatio: 1.22,
    });
  }

  // CP4.2: a territorial baseline is the normal presentation for any polity
  // large enough to support one. Curvature is continuous — a nearly straight
  // baseline is still a baseline. Scale decides which simplified version is
  // used, not whether the territory is "curved enough" to qualify.
  const worldPath = priorityScale >= 350000 ? (worldWarpPath ?? safeWarpPath) : null;
  const worldBaseline = Boolean(
    worldPath
    && worldPath.length >= 110
    && worldPath.width >= 18
  );
  const detailBaseline = Boolean(
    safeWarpPath
    && priorityScale >= 6000
    && safeWarpPath.length >= 42
    && safeWarpPath.width >= 8
  );
  const lineEligible = worldBaseline || detailBaseline;
  const linePathInfo = worldBaseline ? worldPath : detailBaseline ? safeWarpPath : null;
  const curveBand = worldBaseline
    ? "world"
    : lineEligible && (axisAspectRatio >= 1.65 || elongation >= 1.8)
      ? "early"
      : lineEligible
        ? "standard"
        : "none";

  const rawPathCenter = rawPathInfo?.points?.length >= 2
    ? getPointAlongPolyline(rawPathInfo.points, rawPathInfo.length / 2)?.point
    : null;
  const linePathCenter = linePathInfo?.points?.length >= 2
    ? getPointAlongPolyline(linePathInfo.points, linePathInfo.length / 2)?.point
    : null;
  const pointTile = linePathCenter && pointInComponentTile(linePathCenter, componentPolygons)
    ? linePathCenter
    : rawPathCenter && pointInComponentTile(rawPathCenter, componentPolygons)
      ? rawPathCenter
      : fallbackPoint;
  if (!pointTile) return null;

  const lineBend = linePathInfo ? pathBendMetrics(linePathInfo.points) : null;
  const rawBend = rawPathInfo ? pathBendMetrics(rawPathInfo.points) : null;
  const turnDegrees = linePathInfo?.totalTurnDegrees
    ?? rawPathInfo?.totalTurnDegrees
    ?? 0;
  const baselineBendRatio = lineBend?.bendRatio ?? rawBend?.bendRatio ?? 0;
  const baselineKind = !lineEligible
    ? "point"
    : baselineBendRatio >= 0.055 || turnDegrees >= 24
      ? "flowing"
      : baselineBendRatio >= 0.012 || turnDegrees >= 6
        ? "gentle"
        : "near-straight";

  const [rawLng, lat] = tileToLngLat(pointTile[0], pointTile[1], extent);
  const anchorLng = wrapLongitude(rawLng);

  return {
    priorityScale,
    componentPieceCount: componentPieces.length,
    componentAreaLocal,
    fittedPieceCount: componentPieces.length,
    fittedAreaShare: 1,
    shapeWidth,
    shapeHeight,
    aspectRatio,
    axisMetrics,
    axisAspectRatio,
    rawPathInfo,
    safeWarpPath,
    worldWarpPath,
    lineEligible,
    linePathInfo,
    curveBand,
    turnDegrees,
    baselineKind,
    rotation,
    placementInside: true,
    placementBendRatio: baselineBendRatio,
    geometryElongation: elongation,
    geometryMomentAngle: momentAngle,
    ptrPreferredAngle,
    ptrAxisSpanWorld: ptrAxisMetrics.axisSpan / extent,
    ptrCrossSpanWorld: ptrAxisMetrics.crossSpan / extent,
    ptrCoverageGrid,
    anchorLng,
    lat,
  };
};

// One landmass's label: consume one name-independent geometry solution, then
// fit the current display name onto it. This keeps translation/formal-name
// changes from moving the polity or changing whether a territorial spine exists.
const buildLandmassLabelRecords = ({
  polygons,
  owner,
  name,
  featureId,
  extent,
  areaLngLat,
  labelKind = "polity",
  sourceOwner = owner,
  labelSiteRole = labelKind === "polity" ? "sovereign-primary" : "sovereign-secondary",
}) => {
  const upperName = name;
  const geometryLayout = buildLandmassGeometryLayout({ polygons, extent, areaLngLat });
  if (!geometryLayout) return null;

  const {
    priorityScale,
    componentPieceCount,
    fittedPieceCount,
    fittedAreaShare,
    shapeWidth,
    shapeHeight,
    aspectRatio,
    axisMetrics,
    axisAspectRatio,
    rawPathInfo,
    safeWarpPath,
    lineEligible,
    linePathInfo,
    curveBand,
    turnDegrees,
    baselineKind,
    rotation,
    placementInside,
    placementBendRatio,
    geometryElongation,
    geometryMomentAngle,
    ptrPreferredAngle,
    ptrAxisSpanWorld,
    ptrCrossSpanWorld,
    ptrCoverageGrid,
    anchorLng,
    lat,
  } = geometryLayout;

  // Typography still determines screen-space visibility and glyph fit. It no
  // longer participates in the geometry solve or line eligibility decision.
  const visibilityScale = visibilityScaleFor(priorityScale, upperName);
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
  const visibleTextSupport = lineEligible && lineTypography
    ? cartographicSupportMetrics(
      linePathInfo.points,
      clamp(lineTypography.estimatedOccupancy, 0.2, 1),
    )
    : null;
  const curveMinZoom = lineEligible
    ? curveMinZoomForPolityLabelTier(tier, curveBand)
    : null;

  // PTR-1+ consumes one canonical geographic baseline per polity directly
  // from the worker-owned logical record. This is intentionally independent
  // of the legacy MapLibre line-label eligibility decision: even a polity that
  // the old renderer would present as a point can still have a valid territorial
  // corridor for the replacement typography engine. Prefer the validated safe
  // path when available, then fall back to the raw validated path.
  const rendererBaselineInfo = safeWarpPath ?? rawPathInfo ?? linePathInfo;
  const cartographicBaseline = rendererBaselineInfo?.points?.length >= 2
    ? rendererBaselineInfo.points.map(([x, y]) => tileToLngLat(x, y, extent))
    : [];

  const common = {
    name: upperName,
    owner,
    labelKind,
    labelSiteRole,
    sourceOwner,
    tier: tier.id,
    minZoom: tier.minZoom,
    curveMinZoom,
    curveBand,
    baselineKind,
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
    placementInside: Boolean(placementInside),
    placementBendRatio: Number(Number(placementBendRatio ?? 0).toFixed(4)),
    geometryElongation: Number(Number(geometryElongation ?? 1).toFixed(3)),
    geometryMomentAngle: Number(Number(geometryMomentAngle ?? 0).toFixed(2)),
    ptrPreferredAngle: Number(Number(ptrPreferredAngle ?? rotation ?? 0).toFixed(2)),
    ptrAxisSpanWorld: Number(Number(ptrAxisSpanWorld ?? 0).toFixed(8)),
    ptrCrossSpanWorld: Number(Number(ptrCrossSpanWorld ?? 0).toFixed(8)),
    ptrCoverageGrid,
    pathLength: linePathInfo?.length ?? rawPathInfo?.length ?? 0,
    pathWidth: linePathInfo?.width ?? rawPathInfo?.width ?? 0,
    pathTurnDegrees: Number(turnDegrees.toFixed(2)),
    warpPointCount: linePathInfo?.points?.length ?? 0,
    warpMaxSegmentTurnDegrees: Number(Number(linePathInfo?.maxSegmentTurnDegrees ?? 0).toFixed(2)),
    warpDetourRatio: Number(Number(linePathInfo?.detourRatio ?? 0).toFixed(3)),
    pathSupportFraction: Number(Number(linePathInfo?.supportFraction ?? 0.7).toFixed(3)),
    pathSupportBendRatio: Number(Number(linePathInfo?.supportBendRatio ?? 0).toFixed(4)),
    visibleTextBendRatio: Number(Number(visibleTextSupport?.bendRatio ?? 0).toFixed(4)),
    visibleTextTurnDegrees: Number(Number(visibleTextSupport?.totalTurnDegrees ?? 0).toFixed(2)),
    safeWarp: lineEligible,
    hasCurvedLabel: lineEligible,
    anchorLng,
    anchorLat: lat,
    lat,
    geometryPieceCount: componentPieceCount,
    fittedPieceCount,
    fittedAreaShare,
  };

  return {
    // PTR consumes explicit sovereign label sites rather than inferring them
    // from the legacy point/line presentation collections. A polity can have
    // several meaningful disconnected sites (metropole + large overseas
    // holdings) while still retaining one logical polity record.
    ptr: {
      type: "Feature",
      id: `${featureId}-ptr`,
      geometry: { type: "Point", coordinates: [anchorLng, lat] },
      properties: {
        ...common,
        mode: "ptr",
        fitScale: pointTypography.fitScale,
        fontPxAtZoom4: pointTypography.fontPxAtZoom4,
        letterSpacing: pointTypography.letterSpacing,
        targetOccupancy: pointTypography.targetOccupancy,
        estimatedOccupancy: pointTypography.estimatedOccupancy,
        cartographicBaseline,
        cartographicBaselineKind: safeWarpPath
          ? "safe"
          : rawPathInfo
            ? "raw"
            : linePathInfo
              ? "line"
              : "none",
      },
    },
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
        cartographicBaseline,
        cartographicBaselineKind: safeWarpPath
          ? "safe"
          : rawPathInfo
            ? "raw"
            : linePathInfo
              ? "line"
              : "none",
      },
    },
    // Guaranteed overview renderer. For line-capable polities Nations.jsx shows
    // this until the native line is confirmed rendered.
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

// Map vNext live labels are generated inside the cartography worker from a
// read-only aggregation of the canonical regions currently owned by each polity.
// The aggregation is label input only and is never rendered as political truth.
// There is ONE canonical logical record per owner.
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

  // Hard invariant: malformed/upstream input may repeat an aggregated owner, but
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
  const ptrFeatures = [];
  const pointFeatures = [];
  const lineFeatures = [];
  const entries = [...ownerRegistry.values()]
    .sort((left, right) => left.owner.localeCompare(right.owner));

  for (const entry of entries) {
    const { feature, owner, allPolygons, fullAreaLngLat } = entry;
    const name = String(nameResolver(owner, feature) ?? owner).trim();
    if (!name || !allPolygons.length) continue;

    const clusters = landmassClusters(allPolygons, homePolygonFlags(feature, allPolygons));
    if (!clusters.length) continue;
    const upperName = name.toUpperCase();
    const featureId = ownerFeatureId(owner);

    // The political core is the home landmass with the most ground; its label is
    // the polity's one logical record.
    const coreIndex = Math.max(0, clusters.findIndex((cluster) => cluster.home));
    const core = clusters[coreIndex];
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
    ptrFeatures.push(coreRecords.ptr);
    pointFeatures.push(coreRecords.point);
    if (coreRecords.line) lineFeatures.push(coreRecords.line);

    // Every other landmass of consequence carries the owner's name too - Alaska,
    // a colony, the far half of an archipelago - so the map says who holds it
    // without a colour key. They are supplemental cartographic labels, not
    // polity records: the one-polity/one-logical-label invariant stands, and
    // each has a pseudo owner so the curve/point handoff treats it on its own.
    for (let index = 0; index < clusters.length; index += 1) {
      if (index === coreIndex) continue;
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
        labelSiteRole: "sovereign-secondary",
      });
      if (!partRecords) continue;
      ptrFeatures.push(partRecords.ptr);
      pointFeatures.push(partRecords.point);
      if (partRecords.line) lineFeatures.push(partRecords.line);
    }
  }

  return {
    labelData: { type: "FeatureCollection", features: logicalFeatures },
    ptrLabelData: { type: "FeatureCollection", features: ptrFeatures },
    curvedLabelData: { type: "FeatureCollection", features: [] },
    lineLabelData: { type: "FeatureCollection", features: lineFeatures },
    pointLabelData: { type: "FeatureCollection", features: pointFeatures },
    glyphLabelData: { type: "FeatureCollection", features: [] },
  };
};

// One row per logical polity label, for the map's debug probe and the tests.
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
      baselineKind: props.baselineKind,
      placementBendRatio: Number(Number(props.placementBendRatio ?? 0).toFixed(4)),
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
