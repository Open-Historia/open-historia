/*! Open Historia — Map vNext polity-boundary worker © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { derivePolityBoundaries } from "./polityBoundaries.js";
import { derivePolitySurfaces } from "./politySurfaces.js";

const EMPTY_FC = { type: "FeatureCollection", features: [] };
let cachedRegions = EMPTY_FC;
let cachedRegionsUrl = "";
let cachedMetadata = null;

const toStringArray = (value) =>
  Array.isArray(value) ? value.map((entry) => String(entry ?? "")).filter(Boolean) : [];

const buildMetadata = (regions) => {
  const records = [];
  const ownedCountryCodes = new Set();
  const editedStockIds = [];
  let drawnCount = 0;
  let stockCount = 0;

  for (const feature of regions?.features ?? []) {
    const props = feature?.properties ?? {};
    const id = props.id != null
      ? String(props.id)
      : props.GID_1 != null
        ? String(props.GID_1)
        : "";
    if (!id) continue;

    const dotted = id.includes(".");
    if (dotted) stockCount += 1;
    else drawnCount += 1;
    if (props.edited === true && dotted) editedStockIds.push(id);

    const gid0 = props.gid0 != null
      ? String(props.gid0)
      : props.GID_0 != null
        ? String(props.GID_0)
        : "";
    if (props.owner && gid0) ownedCountryCodes.add(gid0);

    const centroid = props?.centroid?.coordinates;
    const lng = Number(Array.isArray(centroid) ? centroid[0] : props?.lng ?? props?.longitude);
    const lat = Number(Array.isArray(centroid) ? centroid[1] : props?.lat ?? props?.latitude);

    records.push({
      id,
      owner: props.owner ? String(props.owner) : "",
      gid0,
      edited: props.edited === true,
      claimants: toStringArray(props.claimants),
      country: props.country ? String(props.country) : "",
      countryCode: gid0,
      name: String(props.name ?? props.NAME_1 ?? props.name_1 ?? id),
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null,
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
    // A fully authored map does not need the stock GADM regions PMTiles at all.
    fullyAuthoredGeometry: records.length > 0 && stockCount === 0,
  };
};

const deriveDisputedData = (ownershipOverrides = {}, regionClaimants = {}) => {
  const features = [];
  for (const feature of cachedRegions?.features ?? []) {
    const props = feature?.properties ?? {};
    const id = props.id != null
      ? String(props.id)
      : props.GID_1 != null
        ? String(props.GID_1)
        : "";
    if (!id) continue;
    const claimants = toStringArray(regionClaimants?.[id]).length
      ? toStringArray(regionClaimants[id])
      : toStringArray(props.claimants);
    if (!claimants.length) continue;
    features.push({
      ...feature,
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
  return {
    bytes: text.length,
    fetchMs,
    parseMs,
  };
};

const derive = ({ ownershipOverrides = {}, regionClaimants = {} } = {}) => {
  const startedAt = performance.now();
  const { data, stats } = derivePolityBoundaries(cachedRegions, ownershipOverrides);
  const { data: polityData, stats: polityStats } = derivePolitySurfaces(
    cachedRegions,
    ownershipOverrides,
  );
  const disputedData = deriveDisputedData(ownershipOverrides, regionClaimants);
  return {
    data,
    polityData,
    disputedData,
    stats: {
      ...stats,
      ...polityStats,
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
  } = message ?? {};
  if (!requestId) return;

  try {
    let loadStats = null;
    if (type === "initialize") {
      if (message.regions?.features) {
        // Legacy/test compatibility. R5.0 production sends only regionsUrl.
        cachedRegions = message.regions;
        cachedRegionsUrl = "";
        cachedMetadata = buildMetadata(cachedRegions);
      } else if (regionsUrl) {
        if (regionsUrl !== cachedRegionsUrl || !cachedRegions?.features?.length) {
          loadStats = await loadRegionsFromUrl(regionsUrl);
        }
      } else {
        cachedRegions = EMPTY_FC;
        cachedRegionsUrl = "";
        cachedMetadata = buildMetadata(cachedRegions);
      }
    } else if (type !== "update-ownership") {
      return;
    }

    const derived = derive({ ownershipOverrides, regionClaimants });
    self.postMessage({
      requestId,
      ...derived,
      metadata: type === "initialize" ? cachedMetadata : undefined,
      stats: {
        ...derived.stats,
        ...(loadStats ?? {}),
      },
    });
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
