/*! Open Historia — portions (custom regions.geojson runtime endpoint) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import mapLibreGl from "maplibre-gl";
import { PMTiles, Protocol, SharedPromiseCache } from "pmtiles";

const { addProtocol, setMaxParallelImageRequests, setWorkerCount } = mapLibreGl;

// v2: v1 could serve a stale archive forever (no freshness check), which
// left months-old map data — countries missing their names — in every
// browser even after the files on disk were updated. Bumping the name
// flushes everyone once; the HEAD check below keeps it fresh from now on.
const PRELOAD_CACHE_NAME = "open-historia-preload-v2";

// Drop caches from older versions once.
if (typeof caches !== "undefined" && caches?.keys) {
  caches
    .keys()
    .then((keys) => {
      for (const key of keys) {
        if (key !== PRELOAD_CACHE_NAME) caches.delete(key).catch(() => {});
      }
    })
    .catch(() => {});
}
const JSON_HEADERS = { "Content-Type": "application/json" };

// A Response constructed from a string gets no Content-Length, and the Cache
// Storage match returns the stored header list verbatim — so the HEAD freshness
// check (which compares the cached body length against the server's) is silently
// disabled for every URL the client has written, and a second device keeps
// serving its stale cached copy. Stamp the real UTF-8 byte length so the check
// works.
const jsonHeadersFor = (payload) => ({
  ...JSON_HEADERS,
  "Content-Length": String(new TextEncoder().encode(payload).length),
});
const FALLBACK_THREADS = 4;
const remoteValueCache = new Map();
const remoteRequestCache = new Map();
let runtimeAssetToken = "";
let countryNameResolver = (name) => name;

const origin = typeof window !== "undefined" ? window.location.origin : "";

const withRuntimeToken = (pathname) => {
  if (!runtimeAssetToken) {
    return pathname;
  }

  if (!origin) {
    return `${pathname}?v=${encodeURIComponent(runtimeAssetToken)}`;
  }

  const url = new URL(pathname, origin);
  url.searchParams.set("v", runtimeAssetToken);
  return `${url.pathname}${url.search}`;
};

const buildAbsoluteUrl = (pathname) => {
  const relativePath = withRuntimeToken(pathname);
  return origin ? new URL(relativePath, origin).toString() : relativePath;
};

export const JSON_URLS = {
  advisor: "",
  actions: "",
  chat: "",
  colors: "",
  flags: "",
  tags: "",
  events: "",
  game: "",
  prompts: "",
  regionsGeojson: "",
  citiesGeojson: "",
  backgroundData: "",
  world: "",
};

// ESRI / ArcGIS Online basemaps — all public and token-free. `service` is the
// path under .../rest/services/; `maxZoom` is that layer's deepest native level
// (past it MapLibre overscales instead of requesting tiles that 404).
export const ESRI_BASEMAPS = [
  { id: "imagery", label: "Satellite", service: "World_Imagery", maxZoom: 19 },
  { id: "streets", label: "Streets", service: "World_Street_Map", maxZoom: 19 },
  { id: "topo", label: "Topographic", service: "World_Topo_Map", maxZoom: 19 },
  { id: "terrain", label: "Terrain", service: "World_Terrain_Base", maxZoom: 13 },
  { id: "shaded", label: "Shaded Relief", service: "World_Shaded_Relief", maxZoom: 13 },
  { id: "physical", label: "Physical", service: "World_Physical_Map", maxZoom: 8 },
  { id: "natgeo", label: "National Geographic", service: "NatGeo_World_Map", maxZoom: 16 },
  { id: "ocean", label: "Ocean", service: "Ocean/World_Ocean_Base", maxZoom: 13 },
  { id: "light-gray", label: "Light Gray Canvas", service: "Canvas/World_Light_Gray_Base", maxZoom: 16 },
  { id: "dark-gray", label: "Dark Gray Canvas", service: "Canvas/World_Dark_Gray_Base", maxZoom: 16 },
];
export const DEFAULT_BASEMAP_ID = "ocean";
// Mirrors mapSettings.js's MAP_SETTING_KEYS.basemapStyle key.
const BASEMAP_STORAGE_KEY = "map_basemap_style";

const basemapById = (id) => ESRI_BASEMAPS.find((b) => b.id === id) ?? ESRI_BASEMAPS[0];
const esriServiceTemplate = (service) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;

// Direct ESRI XYZ template for a basemap id — used for the low-zoom source and
// cache-warming. The high-zoom source goes through basemapProtocolTemplate().
export const esriTileTemplate = (id) => esriServiceTemplate(basemapById(id).service);
export const basemapMaxZoom = (id) => basemapById(id).maxZoom;
// The high-res source goes through this protocol, with the basemap id baked in
// so switching styles refetches, and so ESRI's "Map Data Not Yet Available"
// placeholders can be swapped for an upscaled crop of the nearest real ancestor.
export const basemapProtocolTemplate = (id) => `ohbase://${basemapById(id).id}/{z}/{y}/{x}`;
// The picked basemap id straight from localStorage — used by preload before
// React mounts (mapSettings.js drives it reactively once mounted).
export const selectedBasemapId = () => {
  try {
    return localStorage.getItem(BASEMAP_STORAGE_KEY) || DEFAULT_BASEMAP_ID;
  } catch {
    return DEFAULT_BASEMAP_ID;
  }
};
export const TERRAIN_TILE_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const PMTILES_ARCHIVES = {
  cities: "",
  countries: "",
  regions: "",
};

export const PMTILES_PROTOCOL_URLS = {
  cities: "",
  countries: "",
  regions: "",
};

const jsonValueCache = new Map();
const jsonRequestCache = new Map();
const runtimeJsonValueCache = new Map();
const runtimeJsonRequestCache = new Map();
const binaryValueCache = new Map();
const binaryRequestCache = new Map();
const pmtilesArchives = new Map();
const pmtilesCache = new SharedPromiseCache(256);

const pmtilesProtocol = new Protocol();
let pmtilesProtocolReady = false;
let nationColorsPromise = null;
let nationColorsPromiseKey = "";
let nationFlagsPromise = null;
let nationFlagsPromiseKey = "";
let countryNamesPromise = null;
let countryNamesPromiseKey = "";
let regionCatalogPromise = null;
let regionCatalogPromiseKey = "";

// getNationColors and loadCountryNames memoize on the scenario token, which only
// changes on a scenario/library switch — never on a runtime write. So after the
// AI (or a cheat) writes new colors or creates a polity mid-game, those caches
// keep serving the pre-write value for the rest of the session. A write to the
// underlying asset must drop the derived cache so the next read recomputes.
const invalidateDerivedCachesForWrite = (url) => {
  if (url && url === JSON_URLS.colors) {
    nationColorsPromise = null;
    nationColorsPromiseKey = "";
  }
  if (url && url === JSON_URLS.flags) {
    nationFlagsPromise = null;
    nationFlagsPromiseKey = "";
  }
  if (url && url === JSON_URLS.tags) {
    nationTagsPromise = null;
    nationTagsPromiseKey = "";
  }
  if (url && url === JSON_URLS.world) {
    countryNamesPromise = null;
    countryNamesPromiseKey = "";
  }
};
let mapRuntimeConfigured = false;
let vectorTileModulesPromise = null;

export const setRuntimeAssetEndpoints = ({ token = "" } = {}) => {
  runtimeAssetToken = String(token ?? "").trim();

  JSON_URLS.advisor = withRuntimeToken("/api/runtime/json/advisor");
  JSON_URLS.actions = withRuntimeToken("/api/runtime/json/actions");
  JSON_URLS.chat = withRuntimeToken("/api/runtime/json/chat");
  JSON_URLS.colors = withRuntimeToken("/api/runtime/json/colors");
  JSON_URLS.flags = withRuntimeToken("/api/runtime/json/flags");
  JSON_URLS.tags = withRuntimeToken("/api/runtime/json/tags");
  JSON_URLS.events = withRuntimeToken("/api/runtime/json/events");
  JSON_URLS.game = withRuntimeToken("/api/runtime/json/game");
  JSON_URLS.prompts = withRuntimeToken("/api/runtime/json/prompts");
  JSON_URLS.snapshots = withRuntimeToken("/api/runtime/json/snapshots");
  JSON_URLS.regionsGeojson = withRuntimeToken("/api/runtime/json/regionsGeojson");
  JSON_URLS.citiesGeojson = withRuntimeToken("/api/runtime/json/citiesGeojson");
  JSON_URLS.backgroundData = withRuntimeToken("/api/runtime/json/backgroundData");
  JSON_URLS.world = withRuntimeToken("/api/runtime/json/world");

  PMTILES_ARCHIVES.cities = buildAbsoluteUrl("/api/runtime/pmtiles/cities");
  PMTILES_ARCHIVES.countries = buildAbsoluteUrl("/api/runtime/pmtiles/countries");
  PMTILES_ARCHIVES.regions = buildAbsoluteUrl("/api/runtime/pmtiles/regions");

  PMTILES_PROTOCOL_URLS.cities = `pmtiles://${PMTILES_ARCHIVES.cities}`;
  PMTILES_PROTOCOL_URLS.countries = `pmtiles://${PMTILES_ARCHIVES.countries}`;
  PMTILES_PROTOCOL_URLS.regions = `pmtiles://${PMTILES_ARCHIVES.regions}`;
};

export const setCountryNameResolver = (resolver) => {
  countryNameResolver = typeof resolver === "function" ? resolver : (name) => name;
};

export const resolveCountryDisplayName = (name, code) => countryNameResolver(name, code);

setRuntimeAssetEndpoints();

const cloneJson = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const getPersistentCache = async () => {
  if (typeof caches === "undefined") return null;

  try {
    return await caches.open(PRELOAD_CACHE_NAME);
  } catch {
    return null;
  }
};

const readPersistedResponse = async (url) => {
  const cache = await getPersistentCache();
  if (!cache) return null;

  try {
    return await cache.match(url);
  } catch {
    return null;
  }
};

const persistResponse = async (url, response) => {
  const cache = await getPersistentCache();
  if (!cache) return;

  try {
    await cache.put(url, response);
  } catch {
    // Ignore quota and cache write failures. Startup must stay non-blocking.
  }
};

const buildRuntimeCacheUrl = (key) =>
  `${origin || "https://pax-historia.local"}/__runtime-cache/${encodeURIComponent(key)}.json`;

const fetchWithPersistence = async (url, { signal } = {}) => {
  const cached = await readPersistedResponse(url);
  if (cached) {
    // Updates replace assets on disk; a cached copy must not outlive them.
    // Cheap freshness check: byte size against the server's copy. If the
    // server can't answer (offline), the cached copy still serves.
    try {
      const head = await fetch(url, { method: "HEAD", signal });
      const serverLength = head.ok ? head.headers.get("content-length") : null;
      const cachedLength = cached.headers.get("content-length");
      if (!serverLength || !cachedLength || serverLength === cachedLength) {
        return { response: cached, fromCache: true };
      }
      // Sizes differ: fall through and refetch the fresh copy.
    } catch {
      return { response: cached, fromCache: true };
    }
  }

  const response = await fetch(url, { cache: "force-cache", signal });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }

  persistResponse(url, response.clone());
  return { response, fromCache: false };
};

class MemorySource {
  constructor(url, buffer) {
    this.url = url;
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  getKey() {
    return this.url;
  }

  async getBytes(offset, length) {
    const end = Math.min(this.bytes.byteLength, offset + length);
    return {
      data: this.bytes.slice(offset, end).buffer,
    };
  }
}

const createPmtilesArchive = (url) => {
  const source = binaryValueCache.has(url)
    ? new MemorySource(url, binaryValueCache.get(url))
    : url;

  return new PMTiles(source, pmtilesCache);
};

const registerPmtilesArchive = (url) => {
  ensurePmtilesProtocol();
  const archive = createPmtilesArchive(url);
  pmtilesArchives.set(url, archive);
  pmtilesProtocol.add(archive);
  return archive;
};

export const configureMapRuntime = () => {
  if (mapRuntimeConfigured || typeof navigator === "undefined") return;

  const hardwareThreads = navigator.hardwareConcurrency || FALLBACK_THREADS;
  const workerCount = Math.min(6, Math.max(2, Math.ceil(hardwareThreads / 2)));
  const parallelImageRequests = Math.min(24, Math.max(16, hardwareThreads * 2));
  setWorkerCount(workerCount);
  setMaxParallelImageRequests(parallelImageRequests);
  mapRuntimeConfigured = true;
};

export const ensurePmtilesProtocol = () => {
  if (!pmtilesProtocolReady) {
    addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol));
    pmtilesProtocolReady = true;
  }

  return pmtilesProtocol;
};

// ---------------------------------------------------------------------------
// Basemap protocol: ESRI serves a "Map Data Not Yet Available" JPEG (HTTP 200)
// wherever a zoom level has no coverage — most of the world past ~level 9 on
// World_Terrain_Base. Every placeholder is the same static image, so it can be
// recognised by byte comparison and replaced with an upscaled crop of the
// nearest ancestor tile that has real data: the highest resolution available,
// with no banner.

// Levels 0-9 have global coverage; placeholders only appear above that.
const PLACEHOLDER_MIN_ZOOM = 9;
let basemapProtocolReady = false;
const placeholderRefByService = new Map();

const fetchBasemapTileBytes = async (service, z, y, x, signal) => {
  const url = buildTileUrl(esriServiceTemplate(service), { x, y, z });
  const response = await fetch(url, { cache: "force-cache", signal });
  if (!response.ok) {
    throw new Error(`Failed to load basemap tile ${z}/${y}/${x}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
};

const bytesEqual = (a, b) => {
  if (a.byteLength !== b.byteLength) return false;
  const ua = a instanceof Uint8Array ? a : new Uint8Array(a);
  const ub = b instanceof Uint8Array ? b : new Uint8Array(b);
  for (let i = 0; i < ua.length; i += 1) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
};

// Learn the placeholder's bytes from two level-13 tiles that cannot have real
// detail (Arctic ocean, remote South Pacific). Only trust the reference when
// both agree — if ESRI ever changes coverage there, detection simply turns
// itself off and deep-zoom behaves like before.
const loadPlaceholderRef = (service) => {
  if (!placeholderRefByService.has(service)) {
    placeholderRefByService.set(service, (async () => {
      try {
        const [a, b] = await Promise.all([
          fetchBasemapTileBytes(service, 13, 0, 0),
          fetchBasemapTileBytes(service, 13, 5091, 1365),
        ]);
        return bytesEqual(a, b) ? new Uint8Array(a) : null;
      } catch {
        return null;
      }
    })());
  }
  return placeholderRefByService.get(service);
};

const synthesizeFromAncestor = async (service, z, y, x, placeholderRef, signal) => {
  for (let pz = z - 1; pz >= 0; pz -= 1) {
    const shift = z - pz;
    const px = x >> shift;
    const py = y >> shift;
    let parentBytes;
    try {
      parentBytes = await fetchBasemapTileBytes(service, pz, py, px, signal);
    } catch {
      continue;
    }
    if (pz > PLACEHOLDER_MIN_ZOOM && bytesEqual(parentBytes, placeholderRef)) continue;

    const scale = 2 ** shift;
    const bitmap = await createImageBitmap(new Blob([parentBytes]));
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(256, 256)
      : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const srcSize = bitmap.width / scale;
    ctx.drawImage(
      bitmap,
      (x - px * scale) * srcSize,
      (y - py * scale) * srcSize,
      srcSize,
      srcSize,
      0,
      0,
      256,
      256,
    );
    bitmap.close?.();
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob.arrayBuffer();
  }
  return null;
};

const basemapTileLoader = async (params, abortController) => {
  const match = /^ohbase:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
  if (!match) throw new Error(`Bad basemap tile URL: ${params.url}`);
  const service = basemapById(match[1]).service;
  const z = Number(match[2]);
  const y = Number(match[3]);
  const x = Number(match[4]);
  const signal = abortController?.signal;

  const data = await fetchBasemapTileBytes(service, z, y, x, signal);
  if (z <= PLACEHOLDER_MIN_ZOOM) return { data };

  const ref = await loadPlaceholderRef(service);
  if (!ref || !bytesEqual(data, ref)) return { data };

  try {
    const synthesized = await synthesizeFromAncestor(service, z, y, x, ref, signal);
    if (synthesized) return { data: synthesized };
  } catch {
    // Fall through: the placeholder beats a missing tile.
  }
  return { data };
};

export const ensureBasemapProtocol = () => {
  if (!basemapProtocolReady) {
    addProtocol("ohbase", basemapTileLoader);
    basemapProtocolReady = true;
  }
};

export const readJson = async (url, { defaultValue, force = false, signal } = {}) => {
  if (!force && jsonValueCache.has(url)) {
    return cloneJson(jsonValueCache.get(url));
  }

  // Even with force: true, batch concurrent requests to the same URL so
  // multiple independent 5s pollers (Nations, Cities, background, units)
  // don't each fire their own network fetch.
  if (jsonRequestCache.has(url)) {
    return cloneJson(await jsonRequestCache.get(url));
  }

  const request = (async () => {
    const { response } = await fetchWithPersistence(url, { signal });
    const data = await response.json();
    jsonValueCache.set(url, data);
    return data;
  })()
    .catch((error) => {
      if (defaultValue !== undefined) {
        // Serve the fallback but do NOT cache it — a transient failure must not
        // pin the default for the rest of the session; the next read retries.
        return cloneJson(defaultValue);
      }

      throw error;
    })
    .finally(() => {
      jsonRequestCache.delete(url);
    });

  jsonRequestCache.set(url, request);
  return cloneJson(await request);
};

export const warmJson = async (url, options = {}) => {
  const data = await readJson(url, options);
  return {
    kind: "json",
    size: JSON.stringify(data).length,
    url,
  };
};

export const primeJson = (url, data) => {
  const snapshot = cloneJson(data);
  jsonValueCache.set(url, snapshot);
  jsonRequestCache.delete(url);
  return cloneJson(snapshot);
};

export const writeJson = async (url, data, { pretty = false } = {}) => {
  const payload = JSON.stringify(data, null, pretty ? 2 : 0);
  const response = await fetch(url, {
    body: payload,
    headers: JSON_HEADERS,
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`Failed to save ${url}: HTTP ${response.status}`);
  }

  primeJson(url, data);
  invalidateDerivedCachesForWrite(url);
  persistResponse(
    url,
    new Response(payload, {
      headers: jsonHeadersFor(payload),
      status: 200,
      statusText: "OK",
    }),
  );

  return cloneJson(data);
};

export const readRuntimeJson = async (
  key,
  { clone = false, defaultValue, force = false } = {},
) => {
  if (!force && runtimeJsonValueCache.has(key)) {
    const value = runtimeJsonValueCache.get(key);
    return clone ? cloneJson(value) : value;
  }

  if (!force && runtimeJsonRequestCache.has(key)) {
    const value = await runtimeJsonRequestCache.get(key);
    return clone ? cloneJson(value) : value;
  }

  const request = (async () => {
    const cached = await readPersistedResponse(buildRuntimeCacheUrl(key));
    if (!cached) {
      if (defaultValue !== undefined) {
        const fallback = cloneJson(defaultValue);
        runtimeJsonValueCache.set(key, fallback);
        return fallback;
      }

      throw new Error(`No cached runtime payload for ${key}`);
    }

    const data = await cached.json();
    runtimeJsonValueCache.set(key, data);
    return data;
  })()
    .finally(() => {
      runtimeJsonRequestCache.delete(key);
    });

  runtimeJsonRequestCache.set(key, request);
  const value = await request;
  return clone ? cloneJson(value) : value;
};

export const writeRuntimeJson = async (
  key,
  data,
  { clone = false, pretty = false } = {},
) => {
  const payload = JSON.stringify(data, null, pretty ? 2 : 0);
  runtimeJsonValueCache.set(key, clone ? cloneJson(data) : data);
  runtimeJsonRequestCache.delete(key);

  await persistResponse(
    buildRuntimeCacheUrl(key),
    new Response(payload, {
      headers: jsonHeadersFor(payload),
      status: 200,
      statusText: "OK",
    }),
  );

  return clone ? cloneJson(data) : data;
};

export const buildTileUrl = (template, { x, y, z }) =>
  template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));

export const warmRemoteResource = async (url, { signal } = {}) => {
  if (remoteValueCache.has(url)) {
    return {
      kind: "remote",
      size: remoteValueCache.get(url),
      url,
    };
  }

  if (remoteRequestCache.has(url)) {
    const size = await remoteRequestCache.get(url);
    return {
      kind: "remote",
      size,
      url,
    };
  }

  const request = fetch(url, { cache: "force-cache", signal })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to warm ${url}: HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const size = blob.size || Number(response.headers.get("content-length")) || 0;
      remoteValueCache.set(url, size);
      return size;
    })
    .finally(() => {
      remoteRequestCache.delete(url);
    });

  remoteRequestCache.set(url, request);
  const size = await request;

  return {
    kind: "remote",
    size,
    url,
  };
};

export const warmRemoteResources = async (
  urls,
  { concurrency = 6, signal } = {},
) => {
  const uniqueUrls = [...new Set(urls)];
  const results = new Array(uniqueUrls.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < uniqueUrls.length) {
      if (signal?.aborted) {
        throw signal.reason || new DOMException("Aborted", "AbortError");
      }

      const currentIndex = nextIndex;
      nextIndex += 1;
      const url = uniqueUrls[currentIndex];

      try {
        results[currentIndex] = await warmRemoteResource(url, { signal });
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }

        console.warn(`Failed to warm remote resource: ${url}`, error);
        results[currentIndex] = {
          kind: "remote",
          size: 0,
          url,
        };
      }
    }
  };

  const workerCount = Math.min(concurrency, uniqueUrls.length || 1);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return results;
};

export const getPmtilesArchive = (url) => {
  ensurePmtilesProtocol();
  return pmtilesArchives.get(url) || registerPmtilesArchive(url);
};

export const primePmtilesArchive = (url, buffer) => {
  binaryValueCache.set(url, buffer);
  binaryRequestCache.delete(url);
  return registerPmtilesArchive(url);
};

export const warmPmtilesArchive = async (url, { signal } = {}) => {
  if (binaryValueCache.has(url)) {
    return {
      fromCache: true,
      kind: "pmtiles",
      size: binaryValueCache.get(url).byteLength,
      url,
    };
  }

  if (binaryRequestCache.has(url)) {
    const buffer = await binaryRequestCache.get(url);
    return {
      fromCache: true,
      kind: "pmtiles",
      size: buffer.byteLength,
      url,
    };
  }

  const request = (async () => {
    let buffer = null;
    // Web build only: try the vetted node swarm first, verifying every byte
    // against the signed content manifest. On any miss/failure we fall through to
    // the canonical origin below, so a node outage is invisible. This whole block
    // (and the content-trust module) is stripped from the local download.
    if (import.meta.env.VITE_OH_WEB) {
      try {
        const { fetchVerifiedBuffer } = await import("./web/contentTrust.js");
        buffer = await fetchVerifiedBuffer(url, { signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        buffer = null; // fall back to the origin
      }
    }
    if (buffer == null) {
      const { response } = await fetchWithPersistence(url, { signal });
      buffer = await response.arrayBuffer();
    }
    primePmtilesArchive(url, buffer);
    return buffer;
  })().finally(() => {
    binaryRequestCache.delete(url);
  });

  binaryRequestCache.set(url, request);
  const buffer = await request;

  return {
    fromCache: false,
    kind: "pmtiles",
    size: buffer.byteLength,
    url,
  };
};

export const decodeVectorTile = async (data) => {
  if (!vectorTileModulesPromise) {
    vectorTileModulesPromise = Promise.all([
      import("@mapbox/vector-tile"),
      import("pbf"),
    ]).then(([vectorTileModule, pbfModule]) => ({
      Pbf: pbfModule.default,
      VectorTile: vectorTileModule.VectorTile,
    }));
  }

  const { Pbf, VectorTile } = await vectorTileModulesPromise;
  return new VectorTile(new Pbf(data));
};

export const getNationColors = async () => {
  const cacheKey = JSON_URLS.colors;

  if (!nationColorsPromise || nationColorsPromiseKey !== cacheKey) {
    nationColorsPromiseKey = cacheKey;
    const promise = readJson(JSON_URLS.colors).catch((error) => {
      console.warn("Failed to load nation colors (will retry):", error);
      // Drop the failed promise so the next call retries instead of serving an
      // empty palette for the rest of the session.
      if (nationColorsPromise === promise) nationColorsPromise = null;
      return {};
    });
    nationColorsPromise = promise;
  }

  return nationColorsPromise;
};

// Author-set country flags: owner code -> PNG data URL, from the scenario's
// flags.json. Memoized exactly like getNationColors — same reasoning, same
// invalidation in invalidateDerivedCachesForWrite. Most scenarios have no
// flags.json at all, in which case this resolves to {} and every caller falls
// back to the code-derived flag as before.
let nationTagsPromise = null;
let nationTagsPromiseKey = "";

// The scenario's STARTING country tags: owner code -> string[], from tags.json.
// Memoized like getNationColors/getNationFlags. Most scenarios have no tags.json,
// which resolves to {} — untagged is the normal case, not an error.
//
// These are only the author's starting position. The AI rewrites tags as the world
// changes and those land in world.countryTags, so anything DISPLAYING or PROMPTING
// tags must merge the two (see resolveCountryTags) rather than read this alone.
export const getNationTags = async () => {
  const cacheKey = JSON_URLS.tags;

  if (!nationTagsPromise || nationTagsPromiseKey !== cacheKey) {
    nationTagsPromiseKey = cacheKey;
    const promise = readJson(JSON_URLS.tags, { defaultValue: {} }).catch((error) => {
      console.warn("Failed to load nation tags (will retry):", error);
      if (nationTagsPromise === promise) nationTagsPromise = null;
      return {};
    });
    nationTagsPromise = promise;
  }

  return nationTagsPromise;
};

export const getNationFlags = async () => {
  const cacheKey = JSON_URLS.flags;

  if (!nationFlagsPromise || nationFlagsPromiseKey !== cacheKey) {
    nationFlagsPromiseKey = cacheKey;
    const promise = readJson(JSON_URLS.flags, { defaultValue: {} }).catch((error) => {
      console.warn("Failed to load nation flags (will retry):", error);
      if (nationFlagsPromise === promise) nationFlagsPromise = null;
      return {};
    });
    nationFlagsPromise = promise;
  }

  return nationFlagsPromise;
};

export const loadCountryNames = async ({ force = false } = {}) => {
  const cacheKey = PMTILES_ARCHIVES.countries;

  if (!force && countryNamesPromise && countryNamesPromiseKey === cacheKey) {
    return countryNamesPromise;
  }

  countryNamesPromiseKey = cacheKey;
  const promise = (async () => {
    try {
      const pmtiles = getPmtilesArchive(PMTILES_ARCHIVES.countries);
      const tileData = await pmtiles.getZxy(0, 0, 0);
      if (!tileData?.data) return [];

      const tile = await decodeVectorTile(tileData.data);
      const layer = tile.layers.countries;
      if (!layer) return [];

      const seen = new Map();
      for (let index = 0; index < layer.length; index += 1) {
        const props = layer.feature(index).properties;
        const code = props?.GID_0 || props?.gid_0 || props?.ISO_A3 || props?.iso_a3 || "";
        const name = resolveCountryDisplayName(
          props?.Country || props?.NAME || props?.name || props?.COUNTRY,
          code,
        );
        if (name && !seen.has(name)) {
          seen.set(name, code);
        }
      }

      const countries = Array.from(seen.entries())
        .map(([name, code]) => ({ code, name }))
        .sort((left, right) => left.name.localeCompare(right.name));

      try {
        const world = await readJson(JSON_URLS.world, { defaultValue: {} });
        const merged = new Map(countries.map((entry) => [entry.code || entry.name, entry]));

        for (const [code, polity] of Object.entries(world?.polityOverrides ?? {})) {
          const resolvedCode = polity?.code || code;
          // A nameless polity override must NOT degrade an existing proper
          // name to a bare code.
          const resolvedName = polity?.name || merged.get(resolvedCode)?.name || resolvedCode;
          if (!resolvedCode || !resolvedName) {
            continue;
          }

          merged.set(resolvedCode, {
            code: resolvedCode,
            name: resolvedName,
          });
        }

        return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
      } catch {
        return countries;
      }
    } catch (error) {
      console.error("Failed to load country names (will retry):", error);
      // Do not cache the failure — an empty name list would otherwise degrade
      // labels/pickers for the whole session even after the cause is fixed.
      if (countryNamesPromise === promise) countryNamesPromise = null;
      return [];
    }
  })();
  countryNamesPromise = promise;

  return promise;
};

export const loadRegionCatalog = async ({ force = false } = {}) => {
  // Keyed on BOTH sources: switching games/scenarios (new runtime token) must
  // refresh the custom-region names merged in below.
  const cacheKey = `${PMTILES_ARCHIVES.regions}|${JSON_URLS.regionsGeojson}`;

  if (!force && regionCatalogPromise && regionCatalogPromiseKey === cacheKey) {
    return regionCatalogPromise;
  }

  regionCatalogPromiseKey = cacheKey;
  const promise = (async () => {
    try {
      const pmtiles = getPmtilesArchive(PMTILES_ARCHIVES.regions);
      const tileData = await pmtiles.getZxy(0, 0, 0);
      if (!tileData?.data) return [];

      const tile = await decodeVectorTile(tileData.data);
      const layer = tile.layers.regions;
      if (!layer) return [];

      const seen = new Map();
      for (let index = 0; index < layer.length; index += 1) {
        const props = layer.feature(index).properties;
        const id = props?.GID_1 || props?.gid_1 || props?.HASC_1 || props?.fid;
        const name = props?.NAME_1 || props?.name_1 || props?.NAME || props?.name;
        const countryCode = props?.GID_0 || props?.gid_0 || "";
        const country = resolveCountryDisplayName(
          props?.COUNTRY || props?.Country || props?.country,
          countryCode,
        );

        if (!id || !name) {
          continue;
        }

        const key = String(id);
        if (!seen.has(key)) {
          seen.set(key, {
            country,
            countryCode,
            id: key,
            name: String(name),
          });
        }
      }

      // Regions the stock tiles don't know — shapes DRAWN in the map editor
      // (reg_* ids) and seed-only regions — get their names from the active
      // scenario's own geometry, so the AI can talk about them by name instead
      // of raw ids. Usually already in the JSON cache (the map fetched it).
      let customRegionsResolved = true;
      try {
        const custom = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null });
        // readJson returns the default WITHOUT caching on a transient failure,
        // but DOES cache a genuine "no custom geometry" result. That lets us
        // tell a dropped fetch (retry) apart from a scenario that simply has no
        // custom regions (stock names are correct) — so one failed request on a
        // custom map can't pin a blank political map for the whole session.
        customRegionsResolved = jsonValueCache.has(JSON_URLS.regionsGeojson);
        for (const feature of custom?.features ?? []) {
          const props = feature?.properties ?? {};
          const id = props.id != null ? String(props.id) : "";
          if (!id || seen.has(id)) continue;
          const countryCode = props.gid0 ? String(props.gid0) : "";
          seen.set(id, {
            country: props.country ? String(props.country) : "",
            countryCode,
            id,
            name: props.name ? String(props.name) : id,
          });
        }
      } catch {
        customRegionsResolved = false;
      }

      if (!customRegionsResolved && regionCatalogPromise === promise) {
        // Don't pin a stock-only catalog after a failed custom fetch — retry.
        regionCatalogPromise = null;
      }

      return Array.from(seen.values()).sort((left, right) => {
        const countrySort = left.country.localeCompare(right.country);
        if (countrySort !== 0) {
          return countrySort;
        }

        return left.name.localeCompare(right.name);
      });
    } catch (error) {
      console.error("Failed to load region catalog (will retry):", error);
      // One failed load used to pin an EMPTY catalog for the rest of the
      // session — every AI prompt afterwards lost all region names, so
      // briefings kept coming back with "no data" even after the cause was
      // fixed. Drop the promise so the next caller retries.
      if (regionCatalogPromise === promise) regionCatalogPromise = null;
      return [];
    }
  })();
  regionCatalogPromise = promise;

  return promise;
};
