/*! Open Historia — Map vNext polity-boundary derivation © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { toCountryName } from "../../../runtime/ownerNames.js";

const DEFAULT_PRECISION = 1e6;
// Region seeds are independently simplified. Shared frontiers can therefore
// drift by a few thousandths of a degree even though the canonical provinces
// have no gap. Six quantized units (0.000006°) only matched byte-identical
// edges; 0.0025° is still local enough to avoid bridging real straits while
// recovering those visually contiguous frontiers.
const DEFAULT_MATCH_TOLERANCE = 2500;
const DEFAULT_MATCH_GRID_SIZE = 0.25;
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

const pointKey = (point) => `${point[0]},${point[1]}`;

const comparePoints = (left, right) => {
  if (left[0] !== right[0]) return left[0] - right[0];
  return left[1] - right[1];
};

const edgeKey = (left, right) => (
  comparePoints(left, right) <= 0
    ? `${pointKey(left)}|${pointKey(right)}`
    : `${pointKey(right)}|${pointKey(left)}`
);

const polygonsOf = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

const quantizePoint = (coordinate, precision) => {
  const lng = Number(coordinate?.[0]);
  const lat = Number(coordinate?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [Math.round(lng * precision), Math.round(lat * precision)];
};

const coordinateOf = (point, precision) => [point[0] / precision, point[1] / precision];

const overlappingRun = (left, right, tolerance) => {
  const dx = left.b[0] - left.a[0];
  const dy = left.b[1] - left.a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= tolerance * tolerance) return null;
  const length = Math.sqrt(lengthSquared);
  const distanceFromLine = (point) => Math.abs(
    dx * (point[1] - left.a[1]) - dy * (point[0] - left.a[0]),
  ) / length;
  if (distanceFromLine(right.a) > tolerance || distanceFromLine(right.b) > tolerance) return null;

  const project = (point) => (
    ((point[0] - left.a[0]) * dx + (point[1] - left.a[1]) * dy) / lengthSquared
  );
  const rightA = project(right.a);
  const rightB = project(right.b);
  const start = Math.max(0, Math.min(rightA, rightB));
  const end = Math.min(1, Math.max(rightA, rightB));
  if ((end - start) * length <= tolerance) return null;

  const at = (position) => [
    Math.round(left.a[0] + dx * position),
    Math.round(left.a[1] + dy * position),
  ];
  return { a: at(start), b: at(end) };
};

// The editor seed is stitched region-by-region. A shared frontier can therefore
// be encoded as one long segment on one side and several short ones on the other.
// Exact edge cancellation treats those pieces as coastline and leaves visible
// holes. This spatial pass nodes those collinear overlaps without altering the
// canonical polygons or requiring a brittle polygon union.
const recoverSegmentedBoundaries = (
  candidates,
  precision,
  tolerance,
  gridSizeDegrees,
  addBoundary,
) => {
  const gridSize = Math.max(tolerance * 4, Math.round(gridSizeDegrees * precision));
  const grid = new Map();
  const cellsOf = (segment) => {
    const minX = Math.floor((Math.min(segment.a[0], segment.b[0]) - tolerance) / gridSize);
    const maxX = Math.floor((Math.max(segment.a[0], segment.b[0]) + tolerance) / gridSize);
    const minY = Math.floor((Math.min(segment.a[1], segment.b[1]) - tolerance) / gridSize);
    const maxY = Math.floor((Math.max(segment.a[1], segment.b[1]) + tolerance) / gridSize);
    // Dateline/coastline closure edges can span most of the planet. They cannot
    // be a useful local shared frontier and would otherwise flood the grid.
    if ((maxX - minX + 1) * (maxY - minY + 1) > 2048) return [];
    const keys = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) keys.push(`${x},${y}`);
    }
    return keys;
  };

  for (let index = 0; index < candidates.length; index += 1) {
    for (const key of cellsOf(candidates[index])) {
      const entries = grid.get(key);
      if (entries) entries.push(index);
      else grid.set(key, [index]);
    }
  }

  const compared = new Set();
  let recovered = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const left = candidates[index];
    for (const cellKey of cellsOf(left)) {
      for (const otherIndex of grid.get(cellKey) ?? []) {
        if (otherIndex <= index) continue;
        const pairKey = `${index}|${otherIndex}`;
        if (compared.has(pairKey)) continue;
        compared.add(pairKey);
        const right = candidates[otherIndex];
        if (left.regionId === right.regionId) continue;
        const overlap = overlappingRun(left, right, tolerance);
        if (!overlap) continue;
        if (left.owner !== right.owner && addBoundary([left.owner, right.owner], overlap.a, overlap.b)) {
          recovered += 1;
        }
      }
    }
  }
  return recovered;
};

// Joins two-point edges into the longest unambiguous runs. Grouping happens by
// owner pair before this function is called, so a tripoint can never splice one
// international boundary into an unrelated one.
const stitchSegments = (segments, precision) => {
  const touching = new Map();
  const addTouch = (key, index) => {
    const entries = touching.get(key);
    if (entries) entries.push(index);
    else touching.set(key, [index]);
  };

  for (let index = 0; index < segments.length; index += 1) {
    addTouch(pointKey(segments[index].a), index);
    addTouch(pointKey(segments[index].b), index);
  }

  const visited = new Uint8Array(segments.length);
  const chains = [];
  const walk = (startIndex, startKey) => {
    const line = [];
    let segmentIndex = startIndex;
    let currentKey = startKey;

    while (segmentIndex !== undefined && !visited[segmentIndex]) {
      const segment = segments[segmentIndex];
      visited[segmentIndex] = 1;
      const aKey = pointKey(segment.a);
      const from = aKey === currentKey ? segment.a : segment.b;
      const to = aKey === currentKey ? segment.b : segment.a;
      if (line.length === 0) line.push(coordinateOf(from, precision));
      line.push(coordinateOf(to, precision));
      currentKey = pointKey(to);

      const candidates = (touching.get(currentKey) ?? []).filter((index) => !visited[index]);
      // Stop at branches. Choosing arbitrarily would create a visual kink at a
      // tripoint and makes later hit-testing report a misleading owner pair.
      segmentIndex = candidates.length === 1 ? candidates[0] : undefined;
    }

    if (line.length >= 2) chains.push(line);
  };

  // Open chains first; this gives them deterministic endpoints and leaves only
  // closed rings for the second pass.
  for (let index = 0; index < segments.length; index += 1) {
    if (visited[index]) continue;
    const segment = segments[index];
    const aKey = pointKey(segment.a);
    const bKey = pointKey(segment.b);
    const aDegree = touching.get(aKey)?.length ?? 0;
    const bDegree = touching.get(bKey)?.length ?? 0;
    if (aDegree !== 2 || bDegree !== 2) {
      walk(index, aDegree !== 2 ? aKey : bKey);
    }
  }

  for (let index = 0; index < segments.length; index += 1) {
    if (!visited[index]) walk(index, pointKey(segments[index].a));
  }
  return chains;
};

export const derivePolityBoundaries = (
  regions,
  ownershipOverrides = {},
  {
    precision = DEFAULT_PRECISION,
    matchTolerance = DEFAULT_MATCH_TOLERANCE,
    matchGridSize = DEFAULT_MATCH_GRID_SIZE,
  } = {},
) => {
  const features = Array.isArray(regions?.features) ? regions.features : [];
  if (features.length === 0) {
    return {
      data: EMPTY_FEATURE_COLLECTION,
      stats: {
        regionCount: 0,
        edgeCount: 0,
        boundarySegmentCount: 0,
        boundaryChainCount: 0,
        boundaryGroupCount: 0,
        recoveredBoundarySegmentCount: 0,
        skippedFeatureCount: 0,
      },
    };
  }

  const edges = new Map();
  let skippedFeatureCount = 0;

  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const feature = features[featureIndex];
    const polygons = polygonsOf(feature?.geometry);
    if (polygons.length === 0) {
      skippedFeatureCount += 1;
      continue;
    }

    const properties = feature?.properties ?? {};
    const regionId = String(properties.id ?? properties.GID_1 ?? feature?.id ?? featureIndex);
    const owner = toCountryName(ownershipOverrides?.[regionId] ?? properties.owner ?? "");

    for (const polygon of polygons) {
      for (const ring of polygon ?? []) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        for (let vertex = 1; vertex < ring.length; vertex += 1) {
          const a = quantizePoint(ring[vertex - 1], precision);
          const b = quantizePoint(ring[vertex], precision);
          if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
          const key = edgeKey(a, b);
          const existing = edges.get(key);
          if (existing) {
            existing.owners.add(owner);
            existing.regionIds.add(regionId);
          } else {
            edges.set(key, {
              a,
              b,
              owner,
              regionId,
              owners: new Set([owner]),
              regionIds: new Set([regionId]),
            });
          }
        }
      }
    }
  }

  const byOwnerGroup = new Map();
  const boundaryKeys = new Set();
  const addBoundary = (rawOwners, a, b) => {
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return false;
    const owners = [...new Set(rawOwners)].sort();
    if (owners.length < 2) return false;
    const key = owners.join("\u001f");
    const uniqueKey = `${key}\u001e${edgeKey(a, b)}`;
    if (boundaryKeys.has(uniqueKey)) return false;
    boundaryKeys.add(uniqueKey);
    const group = byOwnerGroup.get(key);
    if (group) group.segments.push({ a, b });
    else byOwnerGroup.set(key, { owners, segments: [{ a, b }] });
    return true;
  };

  for (const edge of edges.values()) {
    if (edge.owners.size < 2) continue;
    addBoundary([...edge.owners], edge.a, edge.b);
  }

  const segmentedCandidates = [];
  for (const edge of edges.values()) {
    if (edge.regionIds.size !== 1) continue;
    segmentedCandidates.push({
      a: edge.a,
      b: edge.b,
      owner: edge.owner,
      regionId: edge.regionId,
    });
  }
  const recoveredBoundarySegmentCount = recoverSegmentedBoundaries(
    segmentedCandidates,
    precision,
    matchTolerance,
    matchGridSize,
    addBoundary,
  );

  let boundaryChainCount = 0;
  const boundaryFeatures = [];
  const orderedGroups = [...byOwnerGroup.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [key, group] of orderedGroups) {
    const coordinates = stitchSegments(group.segments, precision);
    boundaryChainCount += coordinates.length;
    boundaryFeatures.push({
      type: "Feature",
      id: `polity-boundary-${boundaryFeatures.length}`,
      properties: {
        class: "polity-boundary",
        ownerKey: key,
        owners: group.owners.join(" | "),
      },
      geometry: { type: "MultiLineString", coordinates },
    });
  }

  return {
    data: { type: "FeatureCollection", features: boundaryFeatures },
    stats: {
      regionCount: features.length,
      edgeCount: edges.size,
      boundarySegmentCount: boundaryKeys.size,
      boundaryChainCount,
      boundaryGroupCount: boundaryFeatures.length,
      recoveredBoundarySegmentCount,
      skippedFeatureCount,
    },
  };
};
