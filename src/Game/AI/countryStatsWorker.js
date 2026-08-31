import {
  prepareCountryStatsKernel,
  projectCountryStatsScenarioCatalog,
} from "./countryStatsWorkerKernel.js";
import {
  appendCountryStatHistorySample,
  mergeCountryStatPatch,
} from "../../runtime/countryStats.js";

let cachedRegionUrl = "";
let cachedScenarioCatalog = null;

const fetchRuntimeJson = async (url, { allowMissing = false } = {}) => {
  if (!url) {
    if (allowMissing) return null;
    throw new Error("Stats worker runtime URL is missing.");
  }

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (!response.ok) {
    if (allowMissing) return null;
    throw new Error(`Stats worker failed to load ${url}: HTTP ${response.status}`);
  }

  return response.json();
};

const persistRuntimeJson = async (url, value) => {
  const serializeStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const body = JSON.stringify(value);
  const serializedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const response = await fetch(url, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Stats worker failed to save ${url}: HTTP ${response.status}`);
  }

  const savedText = await response.text();
  const responseReadAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const saved = savedText ? JSON.parse(savedText) : value;
  const parsedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    saved,
    timings: {
      stringify: Math.max(0, serializedAt - serializeStartedAt),
      putAndRead: Math.max(0, responseReadAt - serializedAt),
      echoParse: Math.max(0, parsedAt - responseReadAt),
      total: Math.max(0, parsedAt - serializeStartedAt),
    },
  };
};

const persistCountryStats = async (payload = {}) => {
  const urls = payload?.urls || {};
  const country = String(payload?.code || "").trim();
  if (!country) throw new Error("Stats worker persistence country is missing.");

  // Re-fetch immediately before committing. AI generation may have taken seconds;
  // using the pre-AI worker snapshot here could overwrite unrelated world changes.
  const world = await fetchRuntimeJson(urls.world);
  if (!world || typeof world !== "object") {
    throw new Error("Stats worker persistence could not load canonical world state.");
  }
  if (!world.countryStats || typeof world.countryStats !== "object") {
    world.countryStats = {};
  }

  const nextSheet = mergeCountryStatPatch(
    world.countryStats[country],
    payload?.sheet || {},
    {
      replaceComponents: true,
      continuity:
        payload?.continuity && typeof payload.continuity === "object"
          ? payload.continuity
          : null,
    },
  );
  if (!nextSheet || typeof nextSheet !== "object") {
    throw new Error(`Stats worker could not merge the canonical sheet for ${country}.`);
  }

  world.countryStats[country] = nextSheet;
  world.countryStatsHistory = appendCountryStatHistorySample(
    world.countryStatsHistory,
    country,
    nextSheet,
    {
      date: String(payload?.date || ""),
      round: Math.max(0, Math.trunc(Number(payload?.round) || 0)),
    },
  );

  const persisted = await persistRuntimeJson(urls.world, world);
  const savedWorld =
    persisted.saved && typeof persisted.saved === "object"
      ? persisted.saved
      : world;
  const savedSheet =
    savedWorld?.countryStats?.[country] &&
    typeof savedWorld.countryStats[country] === "object"
      ? savedWorld.countryStats[country]
      : nextSheet;
  const historySeries = Array.isArray(savedWorld?.countryStatsHistory?.[country])
    ? savedWorld.countryStatsHistory[country]
    : Array.isArray(world?.countryStatsHistory?.[country])
      ? world.countryStatsHistory[country]
      : [];

  return {
    sheet: savedSheet,
    historySeries,
    timings: persisted.timings,
  };
};

const loadScenarioCatalog = async (url) => {
  if (cachedScenarioCatalog && cachedRegionUrl === url) {
    return cachedScenarioCatalog;
  }

  const geojson = await fetchRuntimeJson(url, { allowMissing: true });
  if (!geojson || !Array.isArray(geojson?.features) || geojson.features.length === 0) {
    return null;
  }

  const catalog = projectCountryStatsScenarioCatalog(geojson);

  // Scenario geometry is static for the lifetime of a runtime-token URL. Keep only
  // the compact metadata projection; release the giant GeoJSON object after this
  // function returns so the worker can GC the polygon coordinates.
  cachedRegionUrl = url;
  cachedScenarioCatalog = catalog;
  return catalog;
};

self.onmessage = async (event) => {
  const id = Number(event?.data?.id);
  const type = String(event?.data?.type || "");
  if (!["prepare", "persist"].includes(type)) return;

  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  try {
    const payload = event?.data?.payload || {};

    if (type === "persist") {
      const result = await persistCountryStats(payload);
      const endedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      self.postMessage({
        id,
        result,
        timings: {
          ...(result?.timings || {}),
          totalWall: Math.max(0, endedAt - startedAt),
        },
      });
      return;
    }

    const urls = payload?.urls || {};

    // R2.39: the worker owns its own loading. These network waits, JSON.parse calls,
    // giant regions.geojson parse, and region-catalog projection all happen on THIS
    // thread instead of being prepared/cloned by the React/MapLibre thread.
    const [world, events, game, scenarioCatalog] = await Promise.all([
      fetchRuntimeJson(urls.world),
      fetchRuntimeJson(urls.events),
      fetchRuntimeJson(urls.game),
      loadScenarioCatalog(urls.regionsGeojson),
    ]);

    if (!scenarioCatalog?.length) {
      const error = new Error(
        "Stats worker could not resolve the active scenario region catalog."
      );
      error.code = "STATS_WORKER_REGION_CATALOG_UNAVAILABLE";
      throw error;
    }

    const loadedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const result = prepareCountryStatsKernel({
      code: payload.code || "",
      bundle: {
        events: Array.isArray(events) ? events : [],
        game: game && typeof game === "object" ? game : {},
        world: world && typeof world === "object" ? world : {},
      },
      scenarioCatalog,
      fallbackCatalog: [],
      forceReassess: Boolean(payload.forceReassess),
    });

    const endedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    self.postMessage({
      id,
      result,
      timings: {
        load: Math.max(0, loadedAt - startedAt),
        compute: Math.max(0, endedAt - loadedAt),
        total: Math.max(0, endedAt - startedAt),
      },
    });
  } catch (error) {
    self.postMessage({
      id,
      error: String(error?.message || error || "Country Stats worker failed."),
      errorCode: String(error?.code || ""),
    });
  }
};
