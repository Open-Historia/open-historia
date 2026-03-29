import { addProtocol, setMaxParallelImageRequests, setWorkerCount } from "maplibre-gl";
import { PMTiles, Protocol, SharedPromiseCache } from "pmtiles";

const PRELOAD_CACHE_NAME = "pax-historia-preload-v1";
const JSON_HEADERS = { "Content-Type": "application/json" };
const FALLBACK_THREADS = 4;
const remoteValueCache = new Map();
const remoteRequestCache = new Map();

export const JSON_URLS = {
  advisor: "/saves/save0/storage/advisor.json",
  actions: "/saves/save0/storage/actions.json",
  chat: "/saves/save0/storage/chat.json",
  colors: "/assets/colors.json",
  events: "/saves/save0/storage/events.json",
  game: "/saves/save0/game.json",
  prompts: "/saves/save0/prompts.json",
};

const origin = typeof window !== "undefined" ? window.location.origin : "";

export const SATELLITE_TILE_TEMPLATE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const TERRAIN_TILE_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const PMTILES_ARCHIVES = {
  cities: `${origin}/saves/save0/cities.pmtiles`,
  countries: `${origin}/saves/save0/countries.pmtiles`,
  regions: `${origin}/saves/save0/regions.pmtiles`,
};

export const PMTILES_PROTOCOL_URLS = Object.fromEntries(
  Object.entries(PMTILES_ARCHIVES).map(([key, url]) => [key, `pmtiles://${url}`]),
);

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
let countryNamesPromise = null;
let mapRuntimeConfigured = false;
let vectorTileModulesPromise = null;

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
        const fallback = cloneJson(defaultValue);
        jsonValueCache.set(url, fallback);
        return fallback;
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
  if (!nationColorsPromise) {
    nationColorsPromise = readJson(JSON_URLS.colors, { defaultValue: {} });
  }

  return nationColorsPromise;
};

export const loadCountryNames = async ({ force = false } = {}) => {
  if (!force && countryNamesPromise) {
    return countryNamesPromise;
  }

  countryNamesPromise = (async () => {
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
        const name = props?.Country || props?.NAME || props?.name || props?.COUNTRY;
        const code = props?.GID_0 || props?.gid_0 || props?.ISO_A3 || props?.iso_a3 || "";
        if (name && !seen.has(name)) {
          seen.set(name, code);
        }
      }

      return Array.from(seen.entries())
        .map(([name, code]) => ({ code, name }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      console.error("Failed to load country names:", error);
      return [];
    }
  })();

  return countryNamesPromise;
};
