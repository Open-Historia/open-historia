/*! Open Historia — Map vNext polity-boundary derivation © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { toCountryName } from "../../../runtime/ownerNames.js";

// Coordinates are quantized to 0.000005° (about half a metre). That is finer than
// any source drift the matching below reconciles, and small enough that a
// quantized point fits ONE safe integer (see pointKeyOf), which is what lets a
// full-resolution world map (2.6M vertices, 2.1M edges) be indexed in a few
// hundred megabytes. The previous 0.000001° grid needed string keys and one
// object with two Sets per edge, well over 2 GB on the same map: the worker
// died silently and every border on the map went with it.
const DEFAULT_PRECISION = 2e5;
// Region seeds are independently simplified. Shared frontiers can therefore
// drift by a few thousandths of a degree even though the canonical provinces
// have no gap. 0.0025° is still local enough to avoid bridging real straits
// while recovering those visually contiguous frontiers.
const DEFAULT_MATCH_TOLERANCE = 500;
const DEFAULT_MATCH_GRID_SIZE = 0.25;
// 64800 · precision² must stay below 2^53 for the numeric point key.
const MAX_NUMERIC_KEY_PRECISION = 370000;
// Point ids are packed two to an edge key: lo · 2^26 + hi.
const POINT_ID_SPAN = 2 ** 26;
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

const coordinateOf = (point, precision) => [point[0] / precision, point[1] / precision];

// Collinear overlap of two quantized segments (ax,ay)-(bx,by) and (cx,cy)-(dx,dy)
// within `tolerance` units, as the run of the first segment the second covers.
const overlappingRun = (ax, ay, bx, by, cx, cy, dx, dy, tolerance) => {
  const ex = bx - ax;
  const ey = by - ay;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared <= tolerance * tolerance) return null;
  const length = Math.sqrt(lengthSquared);
  const distanceFromLine = (x, y) => Math.abs(ex * (y - ay) - ey * (x - ax)) / length;
  if (distanceFromLine(cx, cy) > tolerance || distanceFromLine(dx, dy) > tolerance) return null;

  const project = (x, y) => ((x - ax) * ex + (y - ay) * ey) / lengthSquared;
  const rightA = project(cx, cy);
  const rightB = project(dx, dy);
  const start = Math.max(0, Math.min(rightA, rightB));
  const end = Math.min(1, Math.max(rightA, rightB));
  if ((end - start) * length <= tolerance) return null;

  const at = (position) => [
    Math.round(ax + ex * position),
    Math.round(ay + ey * position),
  ];
  return { a: at(start), b: at(end) };
};

// The editor seed is stitched region-by-region. A shared frontier can therefore
// be encoded as one long segment on one side and several short ones on the other.
// Exact edge cancellation treats those pieces as coastline and leaves visible
// holes. This spatial pass nodes those collinear overlaps without altering the
// canonical polygons or requiring a brittle polygon union.
//
// `candidates` are edge indexes with exactly one adjacent region; `edges` reads
// their endpoints, owner and region. A pair of segments meets in every grid
// cell both of them cover and is compared ONCE, in the lowest cell of that
// overlap, which every other shared cell can recognise without a memo (the old
// Set of "pairs already compared" grew past the engine's 2^24-entry ceiling on
// a full-resolution world map).
const recoverSegmentedBoundaries = (candidates, edges, precision, tolerance, gridSizeDegrees, addBoundary) => {
  const gridSize = Math.max(tolerance * 4, Math.round(gridSizeDegrees * precision));
  // Dateline/coastline closure edges can span most of the planet. They cannot
  // be a useful local shared frontier and would otherwise flood the grid.
  const MAX_CELLS_PER_SEGMENT = 2048;
  // Cells are keyed numerically: the world is at most 1440 × 720 cells of 0.25°,
  // and the tolerance margin adds one cell on each side.
  const CELL_OFFSET = 4096;
  const CELL_SPAN = 8192;

  const count = candidates.length;
  const minXs = new Int32Array(count);
  const maxXs = new Int32Array(count);
  const minYs = new Int32Array(count);
  const maxYs = new Int32Array(count);
  const usable = new Uint8Array(count);
  const grid = new Map();

  for (let slot = 0; slot < count; slot += 1) {
    const edge = candidates[slot];
    const ax = edges.pointX[edges.a[edge]];
    const ay = edges.pointY[edges.a[edge]];
    const bx = edges.pointX[edges.b[edge]];
    const by = edges.pointY[edges.b[edge]];
    const minX = Math.floor((Math.min(ax, bx) - tolerance) / gridSize);
    const maxX = Math.floor((Math.max(ax, bx) + tolerance) / gridSize);
    const minY = Math.floor((Math.min(ay, by) - tolerance) / gridSize);
    const maxY = Math.floor((Math.max(ay, by) + tolerance) / gridSize);
    if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS_PER_SEGMENT) continue;
    minXs[slot] = minX;
    maxXs[slot] = maxX;
    minYs[slot] = minY;
    maxYs[slot] = maxY;
    usable[slot] = 1;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = (x + CELL_OFFSET) * CELL_SPAN + (y + CELL_OFFSET);
        const entries = grid.get(key);
        if (entries) entries.push(slot);
        else grid.set(key, [slot]);
      }
    }
  }

  let recovered = 0;
  for (const [key, entries] of grid) {
    if (entries.length < 2) continue;
    const cellX = Math.floor(key / CELL_SPAN) - CELL_OFFSET;
    const cellY = (key % CELL_SPAN) - CELL_OFFSET;
    for (let i = 0; i < entries.length; i += 1) {
      const slot = entries[i];
      const edge = candidates[slot];
      const owner = edges.owner1[edge];
      const region = edges.region1[edge];
      const ax = edges.pointX[edges.a[edge]];
      const ay = edges.pointY[edges.a[edge]];
      const bx = edges.pointX[edges.b[edge]];
      const by = edges.pointY[edges.b[edge]];
      for (let j = i + 1; j < entries.length; j += 1) {
        const otherSlot = entries[j];
        const other = candidates[otherSlot];
        if (edges.region1[other] === region || edges.owner1[other] === owner) continue;
        if (!usable[slot] || !usable[otherSlot]) continue;
        if (Math.max(minXs[slot], minXs[otherSlot]) !== cellX) continue;
        if (Math.max(minYs[slot], minYs[otherSlot]) !== cellY) continue;
        const overlap = overlappingRun(
          ax, ay, bx, by,
          edges.pointX[edges.a[other]], edges.pointY[edges.a[other]],
          edges.pointX[edges.b[other]], edges.pointY[edges.b[other]],
          tolerance,
        );
        if (!overlap) continue;
        if (addBoundary([owner, edges.owner1[other]], overlap.a, overlap.b)) recovered += 1;
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

// Every vertex of every region, quantized and interned once; every edge once,
// with the (at most two) regions on either side of it. Parallel arrays rather
// than objects: this is the structure that has to fit a worker's heap on the
// largest maps. An edge that three or more regions claim (a malformed seam)
// keeps its extra adjacencies in `extra`, so nothing is silently dropped.
const indexEdges = (features, ownershipOverrides, precision) => {
  const X_OFFSET = 180 * precision;
  const Y_OFFSET = 90 * precision;
  const Y_SPAN = 180 * precision + 1;
  const numericKeys = precision <= MAX_NUMERIC_KEY_PRECISION;
  const pointKeyOf = (x, y) => (numericKeys ? (x + X_OFFSET) * Y_SPAN + (y + Y_OFFSET) : `${x},${y}`);

  const pointIds = new Map();
  const pointX = [];
  const pointY = [];
  const internPoint = (coordinate) => {
    const lng = Number(coordinate?.[0]);
    const lat = Number(coordinate?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return -1;
    const x = Math.max(-X_OFFSET, Math.min(X_OFFSET, Math.round(lng * precision)));
    const y = Math.max(-Y_OFFSET, Math.min(Y_OFFSET, Math.round(lat * precision)));
    const key = pointKeyOf(x, y);
    const existing = pointIds.get(key);
    if (existing !== undefined) return existing;
    const id = pointX.length;
    pointIds.set(key, id);
    pointX.push(x);
    pointY.push(y);
    return id;
  };

  const ownerIds = new Map();
  const ownerNames = [];
  const internOwner = (name) => {
    const existing = ownerIds.get(name);
    if (existing !== undefined) return existing;
    ownerIds.set(name, ownerNames.length);
    ownerNames.push(name);
    return ownerNames.length - 1;
  };

  const edgeIds = new Map();
  const a = [];
  const b = [];
  const owner1 = [];
  const region1 = [];
  const owner2 = [];
  const region2 = [];
  const extra = new Map();
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
    const owner = internOwner(toCountryName(ownershipOverrides?.[regionId] ?? properties.owner ?? ""));
    const region = featureIndex;

    for (const polygon of polygons) {
      for (const ring of polygon ?? []) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        let previous = internPoint(ring[0]);
        for (let vertex = 1; vertex < ring.length; vertex += 1) {
          const current = internPoint(ring[vertex]);
          if (previous < 0 || current < 0 || previous === current) {
            previous = current;
            continue;
          }
          const lo = Math.min(previous, current);
          const hi = Math.max(previous, current);
          const key = lo * POINT_ID_SPAN + hi;
          const existing = edgeIds.get(key);
          if (existing === undefined) {
            edgeIds.set(key, a.length);
            a.push(lo);
            b.push(hi);
            owner1.push(owner);
            region1.push(region);
            owner2.push(-1);
            region2.push(-1);
          } else if (region1[existing] !== region && region2[existing] !== region) {
            if (region2[existing] === -1) {
              owner2[existing] = owner;
              region2[existing] = region;
            } else {
              const more = extra.get(existing);
              if (more) {
                more.owners.add(owner);
                more.regions.add(region);
              } else {
                extra.set(existing, { owners: new Set([owner]), regions: new Set([region]) });
              }
            }
          }
          previous = current;
        }
      }
    }
  }

  return {
    pointX,
    pointY,
    a,
    b,
    owner1,
    region1,
    owner2,
    region2,
    extra,
    ownerNames,
    edgeCount: a.length,
    skippedFeatureCount,
  };
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

  const edges = indexEdges(features, ownershipOverrides, precision);
  const { ownerNames } = edges;

  const byOwnerGroup = new Map();
  let boundarySegmentCount = 0;
  const addBoundary = (rawOwnerIds, pointA, pointB) => {
    if (!pointA || !pointB || (pointA[0] === pointB[0] && pointA[1] === pointB[1])) return false;
    const owners = [...new Set(rawOwnerIds)].map((id) => ownerNames[id]).sort();
    if (owners.length < 2) return false;
    const key = owners.join("");
    let group = byOwnerGroup.get(key);
    if (!group) {
      group = { owners, segments: [], seen: new Set() };
      byOwnerGroup.set(key, group);
    }
    const uniqueKey = edgeKey(pointA, pointB);
    if (group.seen.has(uniqueKey)) return false;
    group.seen.add(uniqueKey);
    group.segments.push({ a: pointA, b: pointB });
    boundarySegmentCount += 1;
    return true;
  };

  const candidates = [];
  for (let edge = 0; edge < edges.edgeCount; edge += 1) {
    const more = edges.extra.get(edge);
    if (edges.region2[edge] === -1 && !more) {
      candidates.push(edge);
      continue;
    }
    const owners = [edges.owner1[edge], edges.owner2[edge]];
    if (more) owners.push(...more.owners);
    if (new Set(owners).size < 2) continue;
    addBoundary(
      owners,
      [edges.pointX[edges.a[edge]], edges.pointY[edges.a[edge]]],
      [edges.pointX[edges.b[edge]], edges.pointY[edges.b[edge]]],
    );
  }

  const recoveredBoundarySegmentCount = recoverSegmentedBoundaries(
    candidates,
    edges,
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
      edgeCount: edges.edgeCount,
      boundarySegmentCount,
      boundaryChainCount,
      boundaryGroupCount: boundaryFeatures.length,
      recoveredBoundarySegmentCount,
      skippedFeatureCount: edges.skippedFeatureCount,
    },
  };
};
