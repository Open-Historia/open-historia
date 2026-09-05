/*! Open Historia — Map vNext live polity-surface dissolve © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import polygonClipping from "polygon-clipping";
import { toCountryName } from "../../../runtime/ownerNames.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
// Removes narrow boolean-operation pinholes (often 1e-8–1e-4 deg²) without
// filling meaningful lakes or enclosed foreign territory. This is presentation
// cleanup only; canonical region geometry remains untouched and clickable.
const MIN_DISPLAY_HOLE_AREA = 0.005;
// Coordinates are snapped to 0.000005° before the union, the same grid the
// boundary derivation uses. Nearly-coincident vertices from independently
// simplified seeds are what make the sweep throw "unable to complete output
// ring" on a big polity (Russia, on the Fault Lines map).
const SNAP = 2e5;
// Drift seams — neighbours whose independently simplified borders sit a few
// thousandths of a degree apart — are NOT welded before the union, on purpose.
// A pre-union weld (projecting the drifted vertices onto the neighbour's line,
// 0.0025° tolerance, the boundary derivation's) was measured in September
// 2026 on the Modern Day map: it moved 56,823 vertices, merged 27 of 103,922
// surface pieces (the rest are islands), and the moved vertices broke the sweep
// for one polity, which then fell back to raw pieces. Overlapping drift already
// merges in the union and the sliver holes it leaves are removed below, so
// the label fitting, which merges hairline-separated slices itself, sees one
// body either way.
// Polygons are unioned a few dozen at a time, as a tree. One union over a
// polity's thousands of polygons holds every edge of the sweep at once, and
// when it fails the old fallback re-ran the union once per polygon - O(n²),
// which on that same map never finished, so the worker never answered.
const DEFAULT_UNION_CHUNK = 64;

const polygonsOf = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

const usablePolygon = (polygon) => (
  Array.isArray(polygon)
  && Array.isArray(polygon[0])
  && polygon[0].length >= 4
);

const ringArea = (ring) => {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return Math.abs(area / 2);
};

const snapRing = (ring) => {
  const out = [];
  for (const point of Array.isArray(ring) ? ring : []) {
    const x = Math.round(Number(point?.[0]) * SNAP) / SNAP;
    const y = Math.round(Number(point?.[1]) * SNAP) / SNAP;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    out.push([x, y]);
  }
  if (out.length < 2) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out.length >= 4 ? out : null;
};

const snapPolygon = (polygon) => {
  const rings = polygon.map(snapRing);
  if (!rings[0]) return null;
  return rings.filter(Boolean);
};

const cleanDisplayHoles = (coordinates) => coordinates
  .filter(usablePolygon)
  .map((polygon) => [
    polygon[0],
    ...polygon.slice(1).filter((hole) => ringArea(hole) >= MIN_DISPLAY_HOLE_AREA),
  ]);

const bboxMinX = (polygon) => {
  let min = Infinity;
  for (const point of polygon[0]) if (point[0] < min) min = point[0];
  return min;
};

// Union of a small batch. A batch the sweep cannot complete is bisected until
// the offending piece stands alone; that piece is kept raw rather than deleted,
// so canonical territory is never lost from the map.
const unionBatch = (polygons, stats) => {
  if (polygons.length <= 1) return polygons;
  try {
    return polygonClipping.union(...polygons);
  } catch {
    if (polygons.length === 2) {
      stats.failedPartCount += 1;
      return polygons;
    }
    const middle = polygons.length >> 1;
    const left = unionBatch(polygons.slice(0, middle), stats);
    const right = unionBatch(polygons.slice(middle), stats);
    try {
      return polygonClipping.union(left, right);
    } catch {
      stats.failedPartCount += 1;
      return [...left, ...right];
    }
  }
};

// Tree union: neighbouring polygons (sorted by their western edge) are unioned
// in batches, the results re-batched, until a level merges nothing more. A
// polity made of thousands of islands ends after one level; a contiguous one
// collapses in a few.
const unionAll = (input, stats, chunk = DEFAULT_UNION_CHUNK) => {
  let polygons = [...input].sort((left, right) => bboxMinX(left) - bboxMinX(right));
  while (polygons.length > 1) {
    const merged = [];
    for (let index = 0; index < polygons.length; index += chunk) {
      merged.push(...unionBatch(polygons.slice(index, index + chunk), stats));
    }
    if (merged.length >= polygons.length) return merged;
    polygons = merged.sort((left, right) => bboxMinX(left) - bboxMinX(right));
  }
  return polygons;
};

export const derivePolitySurfaces = (regions, ownershipOverrides = {}, { unionChunk = DEFAULT_UNION_CHUNK } = {}) => {
  const features = Array.isArray(regions?.features) ? regions.features : [];
  if (features.length === 0) {
    return {
      data: EMPTY_FEATURE_COLLECTION,
      stats: {
        polityCount: 0,
        dissolvedPolityCount: 0,
        fallbackPolityCount: 0,
        failedPartCount: 0,
        emptyUnionPolityCount: 0,
        droppedPolityCount: 0,
      },
    };
  }

  const groups = new Map();
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    const properties = feature?.properties ?? {};
    const regionId = String(properties.id ?? properties.GID_1 ?? feature?.id ?? index);
    const owner = toCountryName(ownershipOverrides?.[regionId] ?? properties.owner ?? "");
    const polygons = polygonsOf(feature?.geometry).filter(usablePolygon).map(snapPolygon).filter(Boolean);
    if (polygons.length === 0) continue;
    const gadm0 = String(properties.gid0 ?? properties.GID_0 ?? "").trim().toUpperCase();
    const group = groups.get(owner);
    if (group) {
      group.polygons.push(...polygons);
      group.regionCount += 1;
      if (gadm0) group.gadm0Counts.set(gadm0, (group.gadm0Counts.get(gadm0) || 0) + 1);
    } else {
      groups.set(owner, {
        polygons: [...polygons],
        regionCount: 1,
        gadm0Counts: new Map(gadm0 ? [[gadm0, 1]] : []),
      });
    }
  }

  const surfaceFeatures = [];
  let dissolvedPolityCount = 0;
  let fallbackPolityCount = 0;
  let failedPartCount = 0;
  let emptyUnionPolityCount = 0;
  let droppedPolityCount = 0;

  for (const [owner, group] of groups) {
    const stats = { failedPartCount: 0 };
    let coordinates = cleanDisplayHoles(unionAll(group.polygons, stats, unionChunk));
    // A union that collapses to nothing used to skip the polity outright. The
    // labels are built from these surfaces, so that removed the polity's fill,
    // its frontier line and its name together - it was simply not on the map,
    // and nothing said so. Fall back to the raw pieces instead: an undissolved
    // surface shows its internal seams, an absent one shows nothing. This is
    // the total-failure case; unionBatch's bisection covers a partial one.
    let emptyUnion = false;
    if (coordinates.length === 0) {
      emptyUnion = true;
      coordinates = cleanDisplayHoles(group.polygons);
    }
    // Let the batch structures go before the next polity starts. Russia is
    // ~5,800 polygons and that ceiling is why they are freed at all, so the
    // free stays - it just happens after the fallback has read them.
    group.polygons = null;
    if (emptyUnion) emptyUnionPolityCount += 1;
    if (stats.failedPartCount > 0 || emptyUnion) {
      fallbackPolityCount += 1;
      failedPartCount += stats.failedPartCount;
    } else {
      dissolvedPolityCount += 1;
    }

    if (coordinates.length === 0) {
      droppedPolityCount += 1;
      continue;
    }
    surfaceFeatures.push({
      type: "Feature",
      id: `polity-surface-${surfaceFeatures.length}`,
      properties: {
        owner,
        regionCount: group.regionCount,
        gadm0: [...group.gadm0Counts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([code]) => code),
        dissolveFallback: stats.failedPartCount > 0 || emptyUnion,
      },
      geometry: { type: "MultiPolygon", coordinates },
    });
  }

  return {
    data: { type: "FeatureCollection", features: surfaceFeatures },
    stats: {
      polityCount: groups.size,
      dissolvedPolityCount,
      fallbackPolityCount,
      failedPartCount,
      emptyUnionPolityCount,
      droppedPolityCount,
    },
  };
};
