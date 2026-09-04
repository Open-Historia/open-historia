/*! Open Historia — Map vNext live polity-surface dissolve © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import polygonClipping from "polygon-clipping";
import { toCountryName } from "../../../runtime/ownerNames.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
// Removes narrow boolean-operation pinholes (often 1e-8–1e-4 deg²) without
// filling meaningful lakes or enclosed foreign territory. This is presentation
// cleanup only; canonical region geometry remains untouched and clickable.
const MIN_DISPLAY_HOLE_AREA = 0.005;

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

const cleanDisplayHoles = (coordinates) => coordinates
  .filter(usablePolygon)
  .map((polygon) => [
    polygon[0],
    ...polygon.slice(1).filter((hole) => ringArea(hole) >= MIN_DISPLAY_HOLE_AREA),
  ]);

const incrementalDissolve = (polygons) => {
  let result = [];
  let failedPartCount = 0;
  for (const polygon of polygons) {
    try {
      result = result.length > 0
        ? polygonClipping.union(result, polygon)
        : [polygon];
    } catch {
      // Preserve malformed pieces rather than deleting canonical territory.
      // They remain a separate polygon in this one polity's MultiPolygon; the
      // rest of the owner still benefits from a clean dissolve.
      result.push(polygon);
      failedPartCount += 1;
    }
  }
  return { coordinates: result, failedPartCount };
};

export const derivePolitySurfaces = (regions, ownershipOverrides = {}) => {
  const features = Array.isArray(regions?.features) ? regions.features : [];
  if (features.length === 0) {
    return {
      data: EMPTY_FEATURE_COLLECTION,
      stats: { polityCount: 0, dissolvedPolityCount: 0, fallbackPolityCount: 0, failedPartCount: 0 },
    };
  }

  const groups = new Map();
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    const properties = feature?.properties ?? {};
    const regionId = String(properties.id ?? properties.GID_1 ?? feature?.id ?? index);
    const owner = toCountryName(ownershipOverrides?.[regionId] ?? properties.owner ?? "");
    const polygons = polygonsOf(feature?.geometry).filter(usablePolygon);
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

  for (const [owner, group] of groups) {
    let coordinates;
    let failedParts = 0;
    try {
      coordinates = group.polygons.length === 1
        ? [group.polygons[0]]
        : polygonClipping.union(...group.polygons);
      dissolvedPolityCount += 1;
    } catch {
      const fallback = incrementalDissolve(group.polygons);
      coordinates = fallback.coordinates;
      failedParts = fallback.failedPartCount;
      fallbackPolityCount += 1;
      failedPartCount += failedParts;
    }

    coordinates = cleanDisplayHoles(coordinates ?? []);
    if (coordinates.length === 0) continue;
    surfaceFeatures.push({
      type: "Feature",
      id: `polity-surface-${surfaceFeatures.length}`,
      properties: {
        owner,
        regionCount: group.regionCount,
        gadm0: [...group.gadm0Counts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([code]) => code),
        dissolveFallback: failedParts > 0,
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
    },
  };
};
