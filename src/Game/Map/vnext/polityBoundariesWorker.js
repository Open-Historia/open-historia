/*! Open Historia — Political Cartography Pipeline v2 worker © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import { toCountryName } from "../../../runtime/ownerNames.js";
import {
  affectedOwnersForRegionChanges,
  buildPoliticalBoundaryTopology,
  createPoliticalBoundaryState,
  deriveOwnerOutlines,
  politicalBoundaryStateCollection,
  updatePoliticalBoundaryState,
} from "./politicalBoundaryTopology.js";
import {
  aggregatePolityGeometry,
  aggregatePolityGeometryForOwners,
} from "./polityGeometry.js";
import { buildPolityLabelCollections } from "./polityLabels.js";
import { buildRegionRenderRepair, isExplicitAuthoredGeometry } from "./regionRenderRepair.js";

const EMPTY_FC = Object.freeze({ type: "FeatureCollection", features: [] });

let cachedRegions = EMPTY_FC;
let cachedRegionsUrl = "";
let cachedMetadata = null;
let cachedTopology = null;
let boundaryState = null;
let labelGeometryByOwner = new Map();
let labelsByOwner = new Map();
let labelChangeDebtByOwner = new Map();
let currentOwnershipOverrides = {};
let currentRegionClaimants = {};
let currentLabelNames = {};
let renderRepairGeneration = 0;
let renderRepairGeometryById = new Map();

const cancelRenderRepairBuild = () => {
  renderRepairGeneration += 1;
};

const scheduleRegionRenderRepair = ({ requestId, geometryEpoch, regions }) => {
  const generation = ++renderRepairGeneration;
  const sourceRegions = regions;

  // Repair only demonstrably malformed presentation geometry. This is NOT the
  // old whole-world display mesh: canonical region ids/ownership stay untouched,
  // and clean features never enter the repair collection at all.
  Promise.resolve().then(async () => {
    const result = await buildRegionRenderRepair(sourceRegions, {
      shouldCancel: () => generation !== renderRepairGeneration,
    });
    if (generation !== renderRepairGeneration || result?.cancelled || !result?.data) return;
    renderRepairGeometryById = new Map(
      (result.data.features ?? []).map((feature) => [String(feature?.properties?.id ?? ""), feature?.geometry]),
    );
    self.postMessage({
      messageType: "render-repair-ready",
      requestId,
      geometryEpoch,
      repairData: result.data,
      repairedIds: result.repairedIds ?? [],
      disputedData: deriveDisputedData(currentOwnershipOverrides, currentRegionClaimants),
      stats: result.stats ?? {},
    });
  }).catch((error) => {
    if (generation !== renderRepairGeneration) return;
    self.postMessage({
      messageType: "render-repair-error",
      requestId,
      geometryEpoch,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

const toStringArray = (value) => Array.isArray(value)
  ? value.map((entry) => String(entry ?? "")).filter(Boolean)
  : [];

const geometryPolygons = (geometry) => {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
};

// Directional ownership sweeps need the recipient polity's TERRITORIAL mass,
// not the count of administrative regions. Precompute a cheap equal-area-ish
// weight once per region so a heavily subdivided coast cannot outweigh a much
// larger interior simply because it contains more region records.
const ringTerritoryArea = (ring) => {
  const points = (Array.isArray(ring) ? ring : []).filter(
    (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (points.length < 3) return 0;

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const point of points) {
    minLat = Math.min(minLat, point[1]);
    maxLat = Math.max(maxLat, point[1]);
  }
  const cosLat = Math.max(0.08, Math.cos(((((minLat + maxLat) / 2) || 0) * Math.PI) / 180));

  // Unwrap longitudes locally so a dateline-crossing ring does not acquire a
  // world-sized shoelace area.
  const xs = [];
  const ys = [];
  let previousLng = Number(points[0][0]);
  for (const point of points) {
    let lng = Number(point[0]);
    while (lng - previousLng > 180) lng -= 360;
    while (lng - previousLng < -180) lng += 360;
    xs.push(lng * cosLat);
    ys.push(Number(point[1]));
    previousLng = lng;
  }

  let twiceArea = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    twiceArea += xs[previous] * ys[index] - xs[index] * ys[previous];
  }
  return Math.abs(twiceArea) / 2;
};

const geometryTerritoryWeight = (geometry) => {
  let total = 0;
  for (const polygon of geometryPolygons(geometry)) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    const outer = ringTerritoryArea(polygon[0]);
    const holes = polygon.slice(1).reduce((sum, ring) => sum + ringTerritoryArea(ring), 0);
    total += Math.max(0, outer - holes);
  }
  return total;
};

const geometryBoundsCenter = (geometry) => {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const polygon of geometryPolygons(geometry)) {
    for (const ring of polygon ?? []) {
      for (const point of ring ?? []) {
        const lng = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
  }
  return Number.isFinite(west)
    ? { lng: (west + east) / 2, lat: (south + north) / 2 }
    : null;
};

// The region's bounding box, [[west, south], [east, north]] — what the event
// camera and an event card's links fly to on a drawn map, where the stock
// outline tables (keyed by GADM id) know nothing of the region. A box wider
// than half the world has crossed the antimeridian and is measured again with
// the western longitudes wrapped east, so `east` may exceed 180 (MapLibre's
// fitBounds expects exactly that).
const geometryBox = (geometry) => {
  const longitudes = [];
  let south = Infinity;
  let north = -Infinity;
  for (const polygon of geometryPolygons(geometry)) {
    for (const ring of polygon ?? []) {
      for (const point of ring ?? []) {
        const lng = Number(point?.[0]);
        const lat = Number(point?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        longitudes.push(lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
  }
  if (!longitudes.length) return null;
  // Loops, not Math.min(...): a detailed coastline is more points than a call
  // can take as arguments.
  let west = Infinity;
  let east = -Infinity;
  for (const lng of longitudes) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  if (east - west > 180) {
    west = Infinity;
    east = -Infinity;
    for (const lng of longitudes) {
      const wrapped = lng < 0 ? lng + 360 : lng;
      if (wrapped < west) west = wrapped;
      if (wrapped > east) east = wrapped;
    }
  }
  return [[west, south], [east, north]];
};

const wrappedLongitudeDelta = (fromLng, toLng) => {
  let delta = Number(toLng) - Number(fromLng);
  if (!Number.isFinite(delta)) return 0;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

const buildMetadata = (regions) => {
  const records = [];
  const ownedCountryCodes = new Set();
  const editedStockIds = [];
  let drawnCount = 0;
  let stockCount = 0;

  const sourceFeatures = regions?.features ?? [];
  for (let index = 0; index < sourceFeatures.length; index += 1) {
    const feature = sourceFeatures[index];
    const props = feature?.properties ?? {};
    const id = props.id != null ? String(props.id) : props.GID_1 != null ? String(props.GID_1) : "";
    if (!id) continue;
    const authored = isExplicitAuthoredGeometry(feature, index);
    if (authored) drawnCount += 1;
    else stockCount += 1;
    if (props.edited === true) editedStockIds.push(id);

    const gid0 = String(props.gid0 ?? props.GID_0 ?? "").trim().toUpperCase();
    if (gid0) ownedCountryCodes.add(gid0);
    const centroid = props?.centroid?.coordinates;
    const boundsCenter = geometryBoundsCenter(feature?.geometry);
    const rawLng = Number(Array.isArray(centroid) ? centroid[0] : props?.lng ?? props?.longitude);
    const rawLat = Number(Array.isArray(centroid) ? centroid[1] : props?.lat ?? props?.latitude);
    const lng = Number.isFinite(rawLng) ? rawLng : Number(boundsCenter?.lng);
    const lat = Number.isFinite(rawLat) ? rawLat : Number(boundsCenter?.lat);
    const territoryWeight = geometryTerritoryWeight(feature?.geometry);

    records.push({
      id,
      owner: props.owner ? String(props.owner) : "",
      gid0,
      edited: props.edited === true,
      authored,
      claimants: toStringArray(props.claimants),
      country: props.country ? String(props.country) : "",
      countryCode: gid0,
      name: String(props.name ?? props.NAME_1 ?? props.name_1 ?? id),
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null,
      bounds: geometryBox(feature?.geometry),
      territoryWeight: territoryWeight > 1e-12 ? territoryWeight : 1,
      tags: toStringArray(props.tags),
      type: props.type ? String(props.type) : "",
      adjacencies: toStringArray(props.adjacencies),
    });
  }

  return {
    records,
    ownedCountryCodes: [...ownedCountryCodes],
    editedStockIds,
    featureCount: records.length,
    hasDrawnGeometry: drawnCount > 0,
    fullyAuthoredGeometry: records.length > 0 && stockCount === 0,
  };
};

const deriveDisputedData = (ownershipOverrides = {}, regionClaimants = {}) => {
  const features = [];
  for (const feature of cachedRegions?.features ?? []) {
    const props = feature?.properties ?? {};
    const id = props.id != null ? String(props.id) : props.GID_1 != null ? String(props.GID_1) : "";
    if (!id) continue;
    // The world's list is authoritative for every region it has: even an empty
    // one, a dispute it has ended (useWorldState.js withSettledClaims). Only a
    // region it never recorded shows the claimants its feature bakes in.
    const recorded = Boolean(regionClaimants) && Object.prototype.hasOwnProperty.call(regionClaimants, id);
    const claimants = toStringArray(recorded ? regionClaimants[id] : props.claimants);
    if (!claimants.length) continue;
    features.push({
      ...feature,
      geometry: renderRepairGeometryById.get(id) ?? feature?.geometry,
      properties: {
        ...props,
        id,
        _liveOwner: String(ownershipOverrides?.[id] ?? props.owner ?? ""),
        _liveClaimants: claimants,
      },
    });
  }
  return { type: "FeatureCollection", features };
};

const resetDerivedCaches = () => {
  cachedTopology = null;
  boundaryState = null;
  labelGeometryByOwner = new Map();
  labelsByOwner = new Map();
  labelChangeDebtByOwner = new Map();
  currentOwnershipOverrides = {};
  currentRegionClaimants = {};
  currentLabelNames = {};
  renderRepairGeometryById = new Map();
};

const loadRegionsFromUrl = async (url) => {
  const fetchStartedAt = performance.now();
  const response = await fetch(url, { cache: "default", credentials: "same-origin" });
  if (!response.ok) throw new Error(`regions fetch failed (${response.status})`);
  const text = await response.text();
  const fetchMs = performance.now() - fetchStartedAt;
  const parseStartedAt = performance.now();
  const parsed = JSON.parse(text);
  const parseMs = performance.now() - parseStartedAt;
  if (!parsed || !Array.isArray(parsed.features)) {
    throw new Error("regions payload is not a GeoJSON FeatureCollection");
  }
  cachedRegions = parsed;
  cachedRegionsUrl = url;
  cachedMetadata = buildMetadata(parsed);
  resetDerivedCaches();
  return { bytes: text.length, fetchMs, parseMs };
};

const labelName = (owner) => String(currentLabelNames?.[owner] ?? owner).trim() || owner;

const buildOwnerLabels = (geometryFeature) => {
  if (!geometryFeature) return null;
  const owner = toCountryName(geometryFeature?.properties?.owner ?? "");
  if (!owner) return null;
  const collections = buildPolityLabelCollections(
    { type: "FeatureCollection", features: [geometryFeature] },
    { nameResolver: () => labelName(owner) },
  );
  return {
    labelData: collections.labelData ?? EMPTY_FC,
    ptrLabelData: collections.ptrLabelData ?? EMPTY_FC,
    pointLabelData: collections.pointLabelData ?? EMPTY_FC,
    lineLabelData: collections.lineLabelData ?? EMPTY_FC,
  };
};

const setInitialLabelGeometry = (collection) => {
  labelGeometryByOwner = new Map();
  labelsByOwner = new Map();
  for (const feature of collection?.features ?? []) {
    const owner = toCountryName(feature?.properties?.owner ?? "");
    if (!owner) continue;
    labelGeometryByOwner.set(owner, feature);
    const labels = buildOwnerLabels(feature);
    if (labels) labelsByOwner.set(owner, labels);
  }
};

const patchLabelGeometryForOwners = (collection, affectedOwners) => {
  const normalized = [...new Set((affectedOwners ?? []).map(toCountryName).filter(Boolean))];
  for (const owner of normalized) {
    labelGeometryByOwner.delete(owner);
    labelsByOwner.delete(owner);
  }
  for (const feature of collection?.features ?? []) {
    const owner = toCountryName(feature?.properties?.owner ?? "");
    if (!owner) continue;
    labelGeometryByOwner.set(owner, feature);
    const labels = buildOwnerLabels(feature);
    if (labels) labelsByOwner.set(owner, labels);
  }
};

const rebuildLabelsForOwners = (owners) => {
  for (const rawOwner of owners ?? []) {
    const owner = toCountryName(rawOwner);
    if (!owner) continue;
    const geometry = labelGeometryByOwner.get(owner);
    if (!geometry) labelsByOwner.delete(owner);
    else {
      const labels = buildOwnerLabels(geometry);
      if (labels) labelsByOwner.set(owner, labels);
    }
  }
};

const combinedLabels = () => {
  const logical = [];
  const ptr = [];
  const points = [];
  const lines = [];
  for (const collections of labelsByOwner.values()) {
    logical.push(...(collections?.labelData?.features ?? []));
    ptr.push(...(collections?.ptrLabelData?.features ?? []));
    points.push(...(collections?.pointLabelData?.features ?? []));
    lines.push(...(collections?.lineLabelData?.features ?? []));
  }
  return {
    labelData: { type: "FeatureCollection", features: logical },
    ptrLabelData: { type: "FeatureCollection", features: ptr },
    pointLabelData: { type: "FeatureCollection", features: points },
    lineLabelData: { type: "FeatureCollection", features: lines },
  };
};

const fullSnapshotFromCurrentCaches = ({ ownershipOverrides = {}, regionClaimants = {}, rebuildLabels = false } = {}) => {
  ensureTopology();
  if (!boundaryState) boundaryState = createPoliticalBoundaryState(cachedTopology, ownershipOverrides);
  if (rebuildLabels) {
    // Recovery after an unpublished specialized revision must not assume the
    // renderer saw the worker's prior label cache. Rebuild the complete current
    // label set against the newest names/ownership before publishing one
    // self-contained renderer snapshot. This is rare recovery work, not the
    // ordinary incremental path.
    setInitialLabelGeometry(aggregatePolityGeometry(cachedRegions, ownershipOverrides));
  }
  return {
    boundaryPatch: {
      removeAll: true,
      upsert: politicalBoundaryStateCollection(boundaryState).features,
    },
    labels: combinedLabels(),
    disputedData: deriveDisputedData(ownershipOverrides, regionClaimants),
  };
};

const ensureTopology = () => {
  if (cachedTopology) return { elapsedMs: 0, reused: true, ...(cachedTopology.stats ?? {}) };
  const startedAt = performance.now();
  cachedTopology = buildPoliticalBoundaryTopology(cachedRegions);
  return { elapsedMs: performance.now() - startedAt, reused: false, ...(cachedTopology.stats ?? {}) };
};

const inferChangedRegionIds = (previousOverrides = {}, nextOverrides = {}) => {
  const ids = new Set([...Object.keys(previousOverrides ?? {}), ...Object.keys(nextOverrides ?? {})]);
  const changed = [];
  for (const id of ids) {
    const index = cachedTopology?.regionIndexById?.get(String(id));
    const baseOwner = index == null ? "" : cachedTopology.baseOwners[index];
    const before = toCountryName(previousOverrides?.[id] ?? baseOwner ?? "");
    const after = toCountryName(nextOverrides?.[id] ?? baseOwner ?? "");
    if (before !== after) changed.push(String(id));
  }
  return changed;
};


const LARGE_OWNER_LABEL_VERTEX_THRESHOLD = 60000;
const LARGE_OWNER_LABEL_MIN_REGIONS = 96;
const LARGE_OWNER_LABEL_REFRESH_RATIO = 0.025;
const LARGE_OWNER_LABEL_MIN_DEBT = 4;

const countOwnersInSnapshot = (owners, ownershipOverrides = {}) => {
  const requested = owners instanceof Set ? owners : new Set(owners ?? []);
  const counts = new Map([...requested].map((owner) => [owner, 0]));
  if (!requested.size || !cachedTopology?.regionIds?.length) return counts;
  for (let index = 0; index < cachedTopology.regionIds.length; index += 1) {
    const id = cachedTopology.regionIds[index];
    const owner = toCountryName(ownershipOverrides?.[id] ?? cachedTopology.baseOwners[index] ?? "");
    if (requested.has(owner)) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
};

const changedRegionCountsByOwner = (
  previousOwnershipOverrides,
  ownershipOverrides,
  changedRegionIds,
) => {
  const counts = new Map();
  for (const rawId of changedRegionIds ?? []) {
    const id = String(rawId ?? "");
    const index = cachedTopology?.regionIndexById?.get(id);
    const baseOwner = index == null ? "" : cachedTopology.baseOwners[index];
    const before = toCountryName(previousOwnershipOverrides?.[id] ?? baseOwner ?? "");
    const after = toCountryName(ownershipOverrides?.[id] ?? baseOwner ?? "");
    if (before) counts.set(before, (counts.get(before) ?? 0) + 1);
    if (after && after !== before) counts.set(after, (counts.get(after) ?? 0) + 1);
  }
  return counts;
};

const chooseOwnershipLabelRefreshOwners = ({
  ownerList,
  previousOwnershipOverrides,
  ownershipOverrides,
  exactChangedIds,
  forceFullSnapshot = false,
  forcedLabelOwners = [],
}) => {
  const requested = new Set((ownerList ?? []).map(toCountryName).filter(Boolean));
  const forced = new Set((forcedLabelOwners ?? []).map(toCountryName).filter(Boolean));
  if (!requested.size) return { refreshOwners: [], deferredOwners: [] };

  const previousCounts = countOwnersInSnapshot(requested, previousOwnershipOverrides);
  const nextCounts = countOwnersInSnapshot(requested, ownershipOverrides);
  const changedCounts = changedRegionCountsByOwner(
    previousOwnershipOverrides,
    ownershipOverrides,
    exactChangedIds,
  );
  const refreshOwners = [];
  const deferredOwners = [];

  for (const owner of requested) {
    const previousCount = previousCounts.get(owner) ?? 0;
    const nextCount = nextCounts.get(owner) ?? 0;
    const changedCount = changedCounts.get(owner) ?? 0;
    const cachedGeometry = labelGeometryByOwner.get(owner);
    const cachedVertexCount = Number(cachedGeometry?.properties?.vertexCount ?? 0);
    const cachedRegionCount = Number(cachedGeometry?.properties?.regionCount ?? previousCount);
    const largeComplexOwner = cachedVertexCount >= LARGE_OWNER_LABEL_VERTEX_THRESHOLD
      && Math.max(previousCount, nextCount, cachedRegionCount) >= LARGE_OWNER_LABEL_MIN_REGIONS;

    const previousDebt = labelChangeDebtByOwner.get(owner) ?? 0;
    const nextDebt = previousDebt + Math.max(1, changedCount);
    const debtThreshold = Math.max(
      LARGE_OWNER_LABEL_MIN_DEBT,
      Math.ceil(Math.max(previousCount, nextCount, cachedRegionCount, 1) * LARGE_OWNER_LABEL_REFRESH_RATIO),
    );

    const mustRefresh = forceFullSnapshot
      || forced.has(owner)
      || previousCount === 0
      || nextCount === 0
      || !cachedGeometry
      || !largeComplexOwner
      || nextDebt >= debtThreshold;

    if (mustRefresh) {
      refreshOwners.push(owner);
      labelChangeDebtByOwner.delete(owner);
    } else {
      labelChangeDebtByOwner.set(owner, nextDebt);
      deferredOwners.push(owner);
    }
  }

  return { refreshOwners, deferredOwners };
};

const regionOwnerAtIndex = (regionIndex, ownershipOverrides = {}) => {
  const regionId = cachedTopology?.regionIds?.[regionIndex];
  if (regionId == null) return "";
  return toCountryName(
    ownershipOverrides?.[regionId]
      ?? cachedTopology?.baseOwners?.[regionIndex]
      ?? cachedMetadata?.records?.[regionIndex]?.owner
      ?? "",
  );
};

const transitionDirectionForChange = ({
  regionId,
  toOwner,
  previousOwnershipOverrides,
  changedSet,
}) => {
  const index = cachedTopology?.regionIndexById?.get(String(regionId));
  const targetMeta = index == null ? null : cachedMetadata?.records?.[index];
  const targetLng = Number(targetMeta?.lng);
  const targetLat = Number(targetMeta?.lat);
  if (!Number.isFinite(targetLng) || !Number.isFinite(targetLat) || !toOwner) {
    return { dx: 1, dy: 0, mode: "wipe", basis: "fallback", frontierSegments: [] };
  }

  // The visual question is not merely "what is the normal of the border?".
  // That made Finland->Karelia enter almost straight from the north because a
  // short east-west frontier locally has a south-facing normal, even though the
  // overwhelming mass of Finnish territory is west / north-west of the target.
  //
  // Use the exact PRE-TRANSFER topology to find recipient territory touching
  // this region, then flood through that recipient-owned connected landmass.
  // The sweep travels FROM the area-weighted territorial mass of that landmass
  // TOWARD the transferred region. This preserves the intuitive "the colour
  // comes from where that polity actually is" rule while ignoring detached
  // colonies/exclaves that should not pull a local frontier animation sideways.
  const recipientSeeds = new Set();
  let contactWeight = 0;
  let contactLng = 0;
  let contactLat = 0;
  let inwardNormalX = 0;
  let inwardNormalY = 0;
  let inwardNormalWeight = 0;
  const sharedFrontierSegments = [];
  const precision = Number(cachedTopology?.precision ?? 0);
  const incidentSegments = boundaryState?.regionToSegments?.[index] ?? [];

  if (precision > 0 && boundaryState?.segments && incidentSegments.length) {
    for (const segmentId of incidentSegments) {
      const segment = boundaryState.segments.get(segmentId);
      if (!segment) continue;

      const recipientIndexes = (segment.regionIndexes ?? []).filter((otherIndex) => {
        if (otherIndex === index) return false;
        const otherId = String(cachedTopology?.regionIds?.[otherIndex] ?? "");
        if (!otherId || changedSet.has(otherId)) return false;
        return regionOwnerAtIndex(otherIndex, previousOwnershipOverrides) === toOwner;
      });
      if (!recipientIndexes.length) continue;
      for (const recipientIndex of recipientIndexes) recipientSeeds.add(recipientIndex);

      const ax = Number(segment.a?.[0]) / precision;
      const ay = Number(segment.a?.[1]) / precision;
      const bx = Number(segment.b?.[0]) / precision;
      const by = Number(segment.b?.[1]) / precision;
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;

      const midLng = (ax + bx) / 2;
      const midLat = (ay + by) / 2;
      const cosSegmentLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));

      // Work in the same LOCAL RENDERED/Mercator coordinate convention that
      // ownershipTransitionWorker consumes: x ~= longitude, y ~= latitude / cos(lat).
      const tangentX = bx - ax;
      const tangentY = (by - ay) / cosSegmentLat;
      const length = Math.hypot(tangentX, tangentY);
      if (!(length > 1e-9)) continue;

      sharedFrontierSegments.push({ a: [ax, ay], b: [bx, by], length });
      contactWeight += length;
      contactLng += midLng * length;
      contactLat += midLat * length;

      let normalX = -tangentY / length;
      let normalY = tangentX / length;
      const towardTargetX = wrappedLongitudeDelta(midLng, targetLng);
      const towardTargetY = (targetLat - midLat) / cosSegmentLat;
      if ((normalX * towardTargetX) + (normalY * towardTargetY) < 0) {
        normalX *= -1;
        normalY *= -1;
      }
      inwardNormalX += normalX * length;
      inwardNormalY += normalY * length;
      inwardNormalWeight += length;
    }
  }

  const recipientIndexes = new Set();
  if (recipientSeeds.size && boundaryState?.segments) {
    const queue = [...recipientSeeds];
    for (const seed of queue) recipientIndexes.add(seed);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const regionIndex = queue[cursor];
      for (const segmentId of boundaryState.regionToSegments?.[regionIndex] ?? []) {
        const segment = boundaryState.segments.get(segmentId);
        if (!segment) continue;
        for (const neighborIndex of segment.regionIndexes ?? []) {
          if (neighborIndex === regionIndex || recipientIndexes.has(neighborIndex)) continue;
          const neighborId = String(cachedTopology?.regionIds?.[neighborIndex] ?? "");
          if (!neighborId || changedSet.has(neighborId)) continue;
          if (regionOwnerAtIndex(neighborIndex, previousOwnershipOverrides) !== toOwner) continue;
          recipientIndexes.add(neighborIndex);
          queue.push(neighborIndex);
        }
      }
    }
  } else {
    // Detached acquisition: there is no touching recipient landmass, so use the
    // polity's whole pre-transfer territorial mass rather than a random/nearest
    // administrative centroid.
    for (let candidateIndex = 0; candidateIndex < (cachedMetadata?.records?.length ?? 0); candidateIndex += 1) {
      const candidateId = String(cachedTopology?.regionIds?.[candidateIndex] ?? "");
      if (!candidateId || candidateId === String(regionId) || changedSet.has(candidateId)) continue;
      if (regionOwnerAtIndex(candidateIndex, previousOwnershipOverrides) === toOwner) {
        recipientIndexes.add(candidateIndex);
      }
    }
  }

  let massX = 0;
  let massY = 0;
  let massWeight = 0;
  for (const recipientIndex of recipientIndexes) {
    const candidate = cachedMetadata?.records?.[recipientIndex];
    const lng = Number(candidate?.lng);
    const lat = Number(candidate?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const weight = Math.max(1e-9, Number(candidate?.territoryWeight) || 1);
    const meanLat = (targetLat + lat) / 2;
    const cosLat = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180));
    // target -> recipient in rendered map space
    massX += wrappedLongitudeDelta(targetLng, lng) * weight;
    massY += ((lat - targetLat) / cosLat) * weight;
    massWeight += weight;
  }

  const frontierSegments = (sharedFrontierSegments.length <= 4096
    ? sharedFrontierSegments
    : [...sharedFrontierSegments].sort((left, right) => right.length - left.length).slice(0, 4096)
  ).map((segment) => [segment.a, segment.b]);

  if (massWeight > 0) {
    // Sweep FROM recipient mass TO target: negate target->recipient pull.
    const dx = -massX / massWeight;
    const dy = -massY / massWeight;
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) {
      return {
        dx: dx / length,
        dy: dy / length,
        mode: "wipe",
        basis: recipientSeeds.size ? "recipient-landmass-mass" : "recipient-polity-mass",
        frontierSegments,
      };
    }
  }

  // If the recipient wraps around the target symmetrically, territorial mass can
  // cancel. Only then fall back to the local frontier normal/contact geometry.
  if (inwardNormalWeight > 0) {
    const length = Math.hypot(inwardNormalX, inwardNormalY);
    if (length > 1e-6) {
      return {
        dx: inwardNormalX / length,
        dy: inwardNormalY / length,
        mode: "wipe",
        basis: "shared-frontier-normal",
        frontierSegments,
      };
    }
  }

  const targetCosLat = Math.max(0.2, Math.cos((targetLat * Math.PI) / 180));
  if (contactWeight > 0) {
    const borderLng = contactLng / contactWeight;
    const borderLat = contactLat / contactWeight;
    const dx = wrappedLongitudeDelta(borderLng, targetLng);
    const dy = (targetLat - borderLat) / targetCosLat;
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) {
      return {
        dx: dx / length,
        dy: dy / length,
        mode: "wipe",
        basis: "shared-frontier-contact",
        frontierSegments,
      };
    }
  }

  // Brand-new owners with no existing territory receive a deterministic
  // direction rather than random animation.
  let hash = 2166136261;
  for (const char of String(regionId)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const angle = ((hash % 16) * Math.PI) / 8;
  return {
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    mode: "wipe",
    basis: "deterministic-fallback",
    frontierSegments,
  };
};

const buildOwnershipTransitionData = ({
  previousOwnershipOverrides,
  ownershipOverrides,
  changedRegionIds,
}) => {
  const changedSet = new Set((changedRegionIds ?? []).map(String));
  const features = [];
  for (const rawId of changedSet) {
    const id = String(rawId);
    const index = cachedTopology?.regionIndexById?.get(id);
    if (index == null) continue;
    const sourceFeature = cachedRegions?.features?.[index];
    const geometry = renderRepairGeometryById.get(id) ?? sourceFeature?.geometry;
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) continue;
    const baseOwner = cachedTopology?.baseOwners?.[index] ?? sourceFeature?.properties?.owner ?? "";
    const fromOwner = toCountryName(previousOwnershipOverrides?.[id] ?? baseOwner ?? "");
    const toOwner = toCountryName(ownershipOverrides?.[id] ?? baseOwner ?? "");
    if (!fromOwner || !toOwner || fromOwner === toOwner) continue;
    const direction = transitionDirectionForChange({
      regionId: id,
      toOwner,
      previousOwnershipOverrides,
      changedSet,
    });
    features.push({
      type: "Feature",
      id,
      geometry,
      properties: {
        id,
        fromOwner,
        toOwner,
        sweepDx: direction.dx,
        sweepDy: direction.dy,
        sweepMode: direction.mode,
        sweepBasis: direction.basis,
        frontierSegments: direction.frontierSegments ?? [],
      },
    });
  }
  return { type: "FeatureCollection", features };
};

const initializePoliticalCartography = ({ ownershipOverrides, regionClaimants }) => {
  const startedAt = performance.now();
  const topologyStats = ensureTopology();

  const boundaryStartedAt = performance.now();
  boundaryState = createPoliticalBoundaryState(cachedTopology, ownershipOverrides);
  const boundaryData = politicalBoundaryStateCollection(boundaryState);
  const boundaryMs = performance.now() - boundaryStartedAt;

  const labelGeometryStartedAt = performance.now();
  const labelGeometry = aggregatePolityGeometry(cachedRegions, ownershipOverrides);
  const labelGeometryMs = performance.now() - labelGeometryStartedAt;
  const labelStartedAt = performance.now();
  setInitialLabelGeometry(labelGeometry);
  const labels = combinedLabels();
  const labelMs = performance.now() - labelStartedAt;

  return {
    boundaryPatch: { removeAll: true, upsert: boundaryData.features },
    labels,
    disputedData: deriveDisputedData(ownershipOverrides, regionClaimants),
    stats: {
      topologyMs: topologyStats.elapsedMs,
      boundaryMs,
      boundaryGroupCount: boundaryData.features.length,
      labelGeometryMs,
      labelMs,
      elapsedMs: performance.now() - startedAt,
    },
  };
};

const updateOwnershipCartography = ({
  previousOwnershipOverrides,
  ownershipOverrides,
  regionClaimants,
  affectedOwners = [],
  changedRegionIds = [],
  forceFullSnapshot = false,
  forcedLabelOwners = [],
  onTransitionReady = null,
}) => {
  const startedAt = performance.now();
  ensureTopology();
  if (!boundaryState) boundaryState = createPoliticalBoundaryState(cachedTopology, previousOwnershipOverrides);

  // A full recovery snapshot is defined by the worker's last actual ownership
  // state versus the newest canonical ownership snapshot. Do not trust an
  // incremental changed-id hint here: intermediate UI revisions may have been
  // coalesced before they ever reached the worker.
  const exactChangedIds = forceFullSnapshot
    ? inferChangedRegionIds(previousOwnershipOverrides, ownershipOverrides)
    : changedRegionIds?.length
      ? [...new Set(changedRegionIds.map(String).filter(Boolean))]
      : inferChangedRegionIds(previousOwnershipOverrides, ownershipOverrides);

  // Ownership animation must not wait behind boundary/PTR derivation. Build
  // the cheap presentation payload from PRE-MUTATION topology and publish it
  // immediately; the main thread can start the sweep while this same worker
  // continues deriving the new borders and polity labels in parallel.
  const ownershipTransitionData = buildOwnershipTransitionData({
    previousOwnershipOverrides,
    ownershipOverrides,
    changedRegionIds: exactChangedIds,
  });
  if (typeof onTransitionReady === "function" && ownershipTransitionData.features.length) {
    onTransitionReady({ ownershipTransitionData, exactChangedIds });
  }

  const normalizedAffected = new Set(
    (affectedOwners ?? []).map(toCountryName).filter(Boolean),
  );
  for (const owner of affectedOwnersForRegionChanges(
    cachedTopology,
    previousOwnershipOverrides,
    ownershipOverrides,
    exactChangedIds,
  )) normalizedAffected.add(owner);
  const ownerList = [...normalizedAffected];
  const { refreshOwners, deferredOwners } = chooseOwnershipLabelRefreshOwners({
    ownerList,
    previousOwnershipOverrides,
    ownershipOverrides,
    exactChangedIds,
    forceFullSnapshot,
    forcedLabelOwners,
  });

  const boundaryStartedAt = performance.now();
  const boundaryResult = updatePoliticalBoundaryState(boundaryState, ownershipOverrides, exactChangedIds);
  const boundaryMs = performance.now() - boundaryStartedAt;

  const labelGeometryStartedAt = performance.now();
  const labelGeometry = aggregatePolityGeometryForOwners(cachedRegions, ownershipOverrides, refreshOwners);
  const labelGeometryMs = performance.now() - labelGeometryStartedAt;
  const labelStartedAt = performance.now();
  patchLabelGeometryForOwners(labelGeometry, refreshOwners);
  const labels = combinedLabels();
  const labelMs = performance.now() - labelStartedAt;

  return {
    boundaryPatch: boundaryResult.patch,
    labels,
    ownershipTransitionData,
    disputedData: deriveDisputedData(ownershipOverrides, regionClaimants),
    stats: {
      ...boundaryResult.stats,
      affectedOwnerCount: ownerList.length,
      refreshedLabelOwnerCount: refreshOwners.length,
      deferredLabelOwnerCount: deferredOwners.length,
      deferredLabelOwners: deferredOwners,
      changedRegionCount: exactChangedIds.length,
      boundaryMs,
      labelGeometryMs,
      labelMs,
      elapsedMs: performance.now() - startedAt,
    },
  };
};

self.onmessage = async ({ data: message }) => {
  const {
    requestId,
    type,
    ownershipOverrides = {},
    regionClaimants = {},
    regionsUrl = "",
    labelNames = {},
    affectedOwners = [],
    changedRegionIds = [],
    geometryEpoch = "",
    forceFullSnapshot = false,
  } = message ?? {};
  if (!requestId) return;

  try {
    // The puppet overlay's outlines: read-only against the topology, so it
    // neither waits on nor disturbs the cartography revisions below.
    if (type === "outline-owners") {
      if (cachedRegions?.features?.length) ensureTopology();
      self.postMessage({
        messageType: "owner-outlines",
        requestId,
        geometryEpoch,
        data: cachedTopology
          ? deriveOwnerOutlines(cachedTopology, ownershipOverrides, message.owners ?? []).data
          : EMPTY_FC,
        ready: Boolean(cachedTopology),
      });
      return;
    }

    let loadStats = null;
    if (type === "initialize") {
      cancelRenderRepairBuild();
      if (message.regions?.features) {
        cachedRegions = message.regions;
        cachedRegionsUrl = "";
        cachedMetadata = buildMetadata(cachedRegions);
        resetDerivedCaches();
      } else if (regionsUrl) {
        if (regionsUrl !== cachedRegionsUrl || !cachedRegions?.features?.length) {
          loadStats = await loadRegionsFromUrl(regionsUrl);
        }
      } else {
        cachedRegions = EMPTY_FC;
        cachedRegionsUrl = "";
        cachedMetadata = buildMetadata(cachedRegions);
        resetDerivedCaches();
      }

      // Geometry/catalog readiness is intentionally independent of political
      // cartography. Exact region identity becomes available as soon as the
      // authored GeoJSON parses; topology/labels may continue for much longer.
      self.postMessage({
        messageType: "catalog-ready",
        requestId,
        geometryEpoch,
        metadata: cachedMetadata,
        stats: loadStats ?? {},
      });
    } else if (!["update-ownership", "update-claims", "update-labels"].includes(type)) {
      return;
    }

    const previousLabelNames = currentLabelNames;
    currentLabelNames = { ...(labelNames ?? {}) };
    const forcedLabelOwners = [...new Set([
      ...Object.keys(previousLabelNames ?? {}),
      ...Object.keys(currentLabelNames ?? {}),
    ])].filter((owner) => previousLabelNames?.[owner] !== currentLabelNames?.[owner]);
    currentRegionClaimants = regionClaimants ?? {};

    if (type === "update-claims") {
      currentOwnershipOverrides = ownershipOverrides;
      const startedAt = performance.now();
      const owners = [...new Set((affectedOwners ?? []).map(toCountryName).filter(Boolean))];
      let recoverySnapshot = null;
      let labels = null;
      if (forceFullSnapshot) {
        recoverySnapshot = fullSnapshotFromCurrentCaches({
          ownershipOverrides,
          regionClaimants,
          // The superseding claim request may also carry newer display names
          // than the discarded revision, so make the recovery snapshot fully
          // current rather than merely replaying worker-local label caches.
          rebuildLabels: true,
        });
      } else if (owners.length) {
        // Claims and display-name changes can be coalesced into one React
        // revision. Rebuild only the explicitly dirty labels and publish them
        // with the new dispute state so neither domain is lost.
        rebuildLabelsForOwners(owners);
        labels = combinedLabels();
      }
      self.postMessage({
        messageType: "cartography-result",
        requestId,
        geometryEpoch,
        ...(recoverySnapshot ?? {
          disputedData: deriveDisputedData(ownershipOverrides, regionClaimants),
          ...(labels ? { labels } : {}),
        }),
        stats: {
          claimsOnly: true,
          forceFullSnapshot,
          affectedOwnerCount: owners.length,
          elapsedMs: performance.now() - startedAt,
        },
      });
      return;
    }

    if (type === "update-labels") {
      currentOwnershipOverrides = ownershipOverrides;
      const startedAt = performance.now();
      const owners = [...new Set((affectedOwners ?? []).map(toCountryName).filter(Boolean))];
      const recoverySnapshot = forceFullSnapshot
        ? fullSnapshotFromCurrentCaches({ ownershipOverrides, regionClaimants, rebuildLabels: true })
        : null;
      if (!recoverySnapshot) rebuildLabelsForOwners(owners);
      self.postMessage({
        messageType: "cartography-result",
        requestId,
        geometryEpoch,
        ...(recoverySnapshot ?? { labels: combinedLabels() }),
        stats: {
          labelsOnly: true,
          forceFullSnapshot,
          affectedOwnerCount: owners.length,
          elapsedMs: performance.now() - startedAt,
        },
      });
      return;
    }

    const previousOwnershipOverrides = currentOwnershipOverrides;
    let derived = type === "initialize"
      ? initializePoliticalCartography({ ownershipOverrides, regionClaimants })
      : updateOwnershipCartography({
          previousOwnershipOverrides,
          ownershipOverrides,
          regionClaimants,
          affectedOwners,
          changedRegionIds,
          forceFullSnapshot,
          forcedLabelOwners,
          onTransitionReady: ({ ownershipTransitionData, exactChangedIds }) => {
            self.postMessage({
              messageType: "ownership-transition-ready",
              requestId,
              geometryEpoch,
              ownershipTransitionData,
              changedRegionIds: exactChangedIds,
            });
          },
        });
    currentOwnershipOverrides = ownershipOverrides;

    // A superseded initialize still primed worker caches. The first accepted
    // ownership revision can promote a complete CURRENT boundary/label snapshot
    // without rerunning unrelated polity work.
    if (forceFullSnapshot && type !== "initialize") {
      derived = {
        ...derived,
        boundaryPatch: {
          removeAll: true,
          upsert: politicalBoundaryStateCollection(boundaryState).features,
        },
        labels: combinedLabels(),
      };
    }

    self.postMessage({
      messageType: "cartography-result",
      requestId,
      geometryEpoch,
      ...derived,
      stats: { ...derived.stats, ...(loadStats ?? {}) },
    });

    if (type === "initialize") {
      // Always publish repair settlement, even for an empty catalog. Nations
      // uses this as part of initial scenario readiness; an empty map must not
      // wait forever for a message that would otherwise never be scheduled.
      scheduleRegionRenderRepair({
        requestId,
        geometryEpoch,
        regions: cachedRegions,
      });
    }
  } catch (error) {
    self.postMessage({
      messageType: "cartography-result",
      requestId,
      geometryEpoch,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
