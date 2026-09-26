/*! Open Historia — group areas drawn from the frontier topology © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the map draws for groups (runtime/groups.js): each group's regions as one
// tinted surface, one outline around the whole area — its frontier with land
// outside the group, and its coast — and a point for its name.
//
// The outline is cut from the worker's frontier topology
// (politicalBoundaryTopology.js), the edges the sovereign borders come from, and
// never from a polygon union: a union of independently simplified neighbours
// leaves a sliver along every seam, and the worker must not run polygon-clipping
// (politicalCartographyArchitecture.test.js). An edge is on the outline when a
// region outside the group shares it, or when no region shares it at all (the
// coast) — unless it is a seam whose two sides were simplified apart, which the
// topology recovered as a run between two regions that are both in the group.
//
// Pure: the worker calls it with its caches, the tests with small fixtures.

import { stitchSegments } from "./politicalBoundaryTopology.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
export const EMPTY_GROUP_AREA_DATA = Object.freeze({
  fills: EMPTY_FEATURE_COLLECTION,
  outlines: EMPTY_FEATURE_COLLECTION,
  labels: EMPTY_FEATURE_COLLECTION,
});

// The recovery tolerance politicalBoundaryTopology.js matches drifted seams with
// (500 units at its default precision of 2e5, i.e. 0.0025°).
const seamTolerance = (precision) => Math.max(1, Math.round(Number(precision || 2e5) * 0.0025));

// Per region: the edges and the recovered seam runs that touch it. Built once
// per topology; a group's outline only ever reads its own regions' lists.
export const buildGroupAreaIndex = (topology) => {
  const count = topology?.regionIds?.length ?? 0;
  const edgesByRegion = Array.from({ length: count }, () => []);
  for (let edge = 0; edge < (topology?.a?.length ?? 0); edge += 1) {
    edgesByRegion[topology.region1[edge]]?.push(edge);
    const second = topology.region2[edge];
    if (second >= 0) edgesByRegion[second]?.push(edge);
    for (const more of topology.extra?.get(edge) ?? []) edgesByRegion[more]?.push(edge);
  }
  const runsByRegion = Array.from({ length: count }, () => []);
  for (let run = 0; run < (topology?.recoveredA?.length ?? 0); run += 1) {
    runsByRegion[topology.recoveredRegion1[run]]?.push(run);
    runsByRegion[topology.recoveredRegion2[run]]?.push(run);
  }
  return { edgesByRegion, runsByRegion };
};

// How much of segment AB the segment CD lies along, when CD is within
// `tolerance` of AB's line (the test the topology's seam recovery uses).
const coveredLength = (ax, ay, bx, by, cx, cy, dx, dy, tolerance) => {
  const ex = bx - ax;
  const ey = by - ay;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared === 0) return 0;
  const length = Math.sqrt(lengthSquared);
  const offLine = (x, y) => Math.abs(ex * (y - ay) - ey * (x - ax)) / length;
  if (offLine(cx, cy) > tolerance || offLine(dx, dy) > tolerance) return 0;
  const along = (x, y) => ((x - ax) * ex + (y - ay) * ey) / lengthSquared;
  const start = Math.max(0, Math.min(along(cx, cy), along(dx, dy)));
  const end = Math.min(1, Math.max(along(cx, cy), along(dx, dy)));
  return end > start ? (end - start) * length : 0;
};

const polygonsOf = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

// The segments of one group's outline, in the topology's snapped units.
const outlineSegments = (topology, index, members) => {
  const tolerance = seamTolerance(topology.precision);
  const segments = [];
  const seen = new Set();
  const push = (ax, ay, bx, by) => {
    const key = ax < bx || (ax === bx && ay <= by) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;
    if (seen.has(key)) return;
    seen.add(key);
    segments.push({ a: [ax, ay], b: [bx, by] });
  };
  for (const regionIndex of members) {
    const internalRuns = (index.runsByRegion[regionIndex] ?? []).filter((run) => {
      const other = topology.recoveredRegion1[run] === regionIndex ? topology.recoveredRegion2[run] : topology.recoveredRegion1[run];
      return other !== regionIndex && members.has(other);
    });
    for (const edge of index.edgesByRegion[regionIndex] ?? []) {
      const ax = topology.pointX[topology.a[edge]];
      const ay = topology.pointY[topology.a[edge]];
      const bx = topology.pointX[topology.b[edge]];
      const by = topology.pointY[topology.b[edge]];
      const second = topology.region2[edge];
      const more = topology.extra?.get(edge);
      if (second !== -1 || more) {
        const outside = !members.has(topology.region1[edge])
          || (second !== -1 && !members.has(second))
          || [...(more ?? [])].some((regionOnEdge) => !members.has(regionOnEdge));
        if (outside) push(ax, ay, bx, by);
        continue;
      }
      if (internalRuns.length) {
        const half = Math.hypot(bx - ax, by - ay) / 2;
        let covered = 0;
        for (const run of internalRuns) {
          const [cx, cy] = topology.recoveredA[run];
          const [dx, dy] = topology.recoveredB[run];
          covered += coveredLength(ax, ay, bx, by, cx, cy, dx, dy, tolerance);
          if (covered >= half) break;
        }
        if (covered >= half) continue;
      }
      push(ax, ay, bx, by);
    }
  }
  return segments;
};

// Where the name goes: the member region whose label point is nearest the
// area's weighted middle, so the name sits on the group's own land even when
// the area is a crescent or in pieces.
const labelPoint = (members, pointFor) => {
  const points = [];
  for (const regionIndex of members) {
    const point = pointFor?.(regionIndex);
    if (point && Number.isFinite(point.lng) && Number.isFinite(point.lat)) points.push(point);
  }
  if (!points.length) return null;
  let weightSum = 0;
  let lngSum = 0;
  let latSum = 0;
  for (const point of points) {
    const weight = Number.isFinite(point.weight) && point.weight > 0 ? point.weight : 1;
    weightSum += weight;
    lngSum += point.lng * weight;
    latSum += point.lat * weight;
  }
  const middle = { lng: lngSum / weightSum, lat: latSum / weightSum };
  const scale = Math.max(0.1, Math.cos((middle.lat * Math.PI) / 180));
  let best = points[0];
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = ((point.lng - middle.lng) * scale) ** 2 + (point.lat - middle.lat) ** 2;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return [best.lng, best.lat];
};

/**
 * @param topology   buildPoliticalBoundaryTopology's result for `regions`
 * @param index      buildGroupAreaIndex(topology)
 * @param regions    the FeatureCollection the topology was built from
 * @param groupAreas { [regionId]: groupName }
 * @param groups     { [groupName]: { color } }
 * @param geometryFor optional (regionId, feature) => geometry, for repaired shapes
 * @param pointFor   optional (regionIndex) => { lng, lat, weight } for the label
 */
export const deriveGroupAreas = ({
  topology,
  index,
  regions,
  groupAreas = {},
  groups = {},
  geometryFor = null,
  pointFor = null,
} = {}) => {
  if (!topology?.regionIds?.length || !index) return EMPTY_GROUP_AREA_DATA;
  const membersByGroup = new Map();
  for (const [regionId, name] of Object.entries(groupAreas ?? {})) {
    if (!groups?.[name]) continue;
    const regionIndex = topology.regionIndexById?.get(String(regionId));
    if (regionIndex == null) continue;
    if (!membersByGroup.has(name)) membersByGroup.set(name, new Set());
    membersByGroup.get(name).add(regionIndex);
  }

  const fills = [];
  const outlines = [];
  const labels = [];
  for (const [name, members] of membersByGroup) {
    const color = String(groups[name]?.color || "#e11d48");
    const properties = { group: name, color };

    const polygons = [];
    for (const regionIndex of members) {
      const feature = regions?.features?.[regionIndex];
      const geometry = geometryFor ? geometryFor(topology.regionIds[regionIndex], feature) : feature?.geometry;
      polygons.push(...polygonsOf(geometry));
    }
    if (polygons.length) {
      fills.push({ type: "Feature", properties, geometry: { type: "MultiPolygon", coordinates: polygons } });
    }

    const coordinates = stitchSegments(outlineSegments(topology, index, members), topology.precision);
    if (coordinates.length) {
      outlines.push({ type: "Feature", properties, geometry: { type: "MultiLineString", coordinates } });
    }

    const at = labelPoint(members, pointFor);
    if (at) {
      labels.push({ type: "Feature", properties: { ...properties, regions: members.size }, geometry: { type: "Point", coordinates: at } });
    }
  }

  return {
    fills: { type: "FeatureCollection", features: fills },
    outlines: { type: "FeatureCollection", features: outlines },
    labels: { type: "FeatureCollection", features: labels },
  };
};
