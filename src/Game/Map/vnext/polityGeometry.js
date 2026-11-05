/*! Open Historia — worker-safe polity geometry aggregation © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import { toCountryName } from "../../../runtime/ownerNames.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

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

const stableFeatureId = (prefix, value) => {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
};

const buildGroups = (regions, ownershipOverrides = {}, ownerFilter = null) => {
  const groups = new Map();
  const features = Array.isArray(regions?.features) ? regions.features : [];

  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    const properties = feature?.properties ?? {};
    const regionId = String(properties.id ?? properties.GID_1 ?? feature?.id ?? index);
    const owner = toCountryName(ownershipOverrides?.[regionId] ?? properties.owner ?? "");
    if (!owner || (ownerFilter && !ownerFilter.has(owner))) continue;

    const polygons = polygonsOf(feature?.geometry).filter(usablePolygon);
    if (!polygons.length) continue;

    const gadm0 = String(properties.gid0 ?? properties.GID_0 ?? "").trim().toUpperCase();
    const group = groups.get(owner);
    if (group) {
      // Do not deep-clone millions of coordinates. The worker's cached source
      // geometry is immutable for a geometry epoch and label fitting is read-only.
      group.polygons.push(...polygons);
      group.regionCount += 1;
      group.polygonCount += polygons.length;
      for (const polygon of polygons) {
        for (const ring of polygon ?? []) group.vertexCount += Array.isArray(ring) ? ring.length : 0;
      }
      if (gadm0) group.gadm0Counts.set(gadm0, (group.gadm0Counts.get(gadm0) || 0) + 1);
      for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) group.polygonGadm0.push(gadm0);
    } else {
      let vertexCount = 0;
      for (const polygon of polygons) {
        for (const ring of polygon ?? []) vertexCount += Array.isArray(ring) ? ring.length : 0;
      }
      groups.set(owner, {
        polygons: [...polygons],
        regionCount: 1,
        polygonCount: polygons.length,
        vertexCount,
        gadm0Counts: new Map(gadm0 ? [[gadm0, 1]] : []),
        polygonGadm0: polygons.map(() => gadm0),
      });
    }
  }

  return groups;
};

const collectionFromGroups = (groups) => ({
  type: "FeatureCollection",
  features: [...groups.entries()].map(([owner, group]) => ({
    type: "Feature",
    id: stableFeatureId("polity-label-geometry", owner),
    properties: {
      owner,
      regionCount: group.regionCount,
      polygonCount: group.polygonCount,
      vertexCount: group.vertexCount,
      gadm0: [...group.gadm0Counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([code]) => code),
      // The stock country each polygon came from, index for index with the
      // coordinates: the label engine keeps the polity's name on its home ground.
      polygonGadm0: group.polygonGadm0,
    },
    geometry: { type: "MultiPolygon", coordinates: group.polygons },
  })),
});

export const aggregatePolityGeometry = (regions, ownershipOverrides = {}) => {
  const features = Array.isArray(regions?.features) ? regions.features : [];
  if (!features.length) return EMPTY_FEATURE_COLLECTION;
  return collectionFromGroups(buildGroups(regions, ownershipOverrides));
};

export const aggregatePolityGeometryForOwners = (
  regions,
  ownershipOverrides = {},
  affectedOwners = [],
) => {
  const requested = new Set(
    [...affectedOwners].map((owner) => toCountryName(owner)).filter(Boolean),
  );
  if (!requested.size || !Array.isArray(regions?.features) || !regions.features.length) {
    return EMPTY_FEATURE_COLLECTION;
  }
  return collectionFromGroups(buildGroups(regions, ownershipOverrides, requested));
};
