/*! Pax Historia — portions (custom regions.geojson runtime endpoint) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import mapLibreGl from "maplibre-gl";
import { PMTiles, Protocol, SharedPromiseCache } from "pmtiles";

const { addProtocol, setMaxParallelImageRequests, setWorkerCount } = mapLibreGl;

const PRELOAD_CACHE_NAME = "pax-historia-preload-v1";
const JSON_HEADERS = { "Content-Type": "application/json" };
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
  events: "",
  game: "",
  prompts: "",
  regionsGeojson: "",
  citiesGeojson: "",
  world: "",
};

export const SATELLITE_TILE_TEMPLATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
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
let countryNamesPromise = null;
let countryNamesPromiseKey = "";
let regionCatalogPromise = null;
let regionCatalogPromiseKey = "";
let mapRuntimeConfigured = false;
let vectorTileModulesPromise = null;

export const setRuntimeAssetEndpoints = ({ token = "" } = {}) => {
  runtimeAssetToken = String(token ?? "").trim();

  JSON_URLS.advisor = withRuntimeToken("/api/runtime/json/advisor");
  JSON_URLS.actions = withRuntimeToken("/api/runtime/json/actions");
  JSON_URLS.chat = withRuntimeToken("/api/runtime/json/chat");
  JSON_URLS.colors = withRuntimeToken("/api/runtime/json/colors");
  JSON_URLS.events = withRuntimeToken("/api/runtime/json/events");
  JSON_URLS.game = withRuntimeToken("/api/runtime/json/game");
  JSON_URLS.prompts = withRuntimeToken("/api/runtime/json/prompts");
  JSON_URLS.regionsGeojson = withRuntimeToken("/api/runtime/json/regionsGeojson");
  JSON_URLS.citiesGeojson = withRuntimeToken("/api/runtime/json/citiesGeojson");
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
    return { response: cached, fromCache: true };
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

export const readJson = async (url, { defaultValue, force = false, signal } = {}) => {
  if (!force && jsonValueCache.has(url)) {
    return cloneJson(jsonValueCache.get(url));
  }

  if (!force && jsonRequestCache.has(url)) {
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
  persistResponse(
    url,
    new Response(payload, {
      headers: JSON_HEADERS,
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
      headers: JSON_HEADERS,
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
    const { response } = await fetchWithPersistence(url, { signal });
    const buffer = await response.arrayBuffer();
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
          const resolvedName = polity?.name || code;
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
      try {
        const custom = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null });
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
        // No custom geometry (or fetch hiccup) — stock names only.
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
