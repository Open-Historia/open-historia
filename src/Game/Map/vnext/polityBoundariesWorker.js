/*! Open Historia — Map vNext polity-boundary worker © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { derivePolityBoundaries } from "./polityBoundaries.js";
import { derivePolitySurfaces } from "./politySurfaces.js";

let cachedRegions = { type: "FeatureCollection", features: [] };

self.onmessage = ({ data: message }) => {
  const { requestId, type, ownershipOverrides = {} } = message ?? {};
  if (!requestId) return;

  if (type === "initialize") {
    cachedRegions = message.regions?.features
      ? message.regions
      : { type: "FeatureCollection", features: [] };
  } else if (type !== "update-ownership") {
    return;
  }

  const startedAt = performance.now();
  try {
    const { data, stats } = derivePolityBoundaries(cachedRegions, ownershipOverrides);
    const { data: polityData, stats: polityStats } = derivePolitySurfaces(
      cachedRegions,
      ownershipOverrides,
    );
    self.postMessage({
      requestId,
      data,
      polityData,
      stats: { ...stats, ...polityStats, elapsedMs: performance.now() - startedAt },
    });
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
