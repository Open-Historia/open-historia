/*! Open Historia — worker-backed region seed loader © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Loads the scenario's regions.geojson WITHOUT ever parsing it on the main
// thread: the raw payload (bytes, or the web store's own string) is handed to a
// Web Worker that runs the JSON.parse + single-pass index (regionSeedCore.js)
// and returns only the small seed. This removes the last big main-thread stall
// and its ~500 MB transient parsed-object peak (measured on Medieval-1200).
//
// Data sources, in order:
//  - web build: the IndexedDB store hands over the RAW stored value
//    (readRuntimeGeojsonRaw) — no JSON.stringify/json() round-trip at all;
//  - desktop/dev: a plain fetch of the runtime URL, read as bytes;
//  - fallback when workers are unavailable or crash: parse inline, the old cost.

import { indexRegionFeatureCollection, emptyRegionSeed } from "./regionSeedCore.js";

export { emptyRegionSeed };

let currentUrl = "";
let currentPromise = null;
let jobCounter = 0;

const terminateWorker = (worker) => {
  try {
    worker?.terminate();
  } catch {
    // Already gone.
  }
};

const runInWorker = (input) =>
  new Promise((resolve, reject) => {
    let worker = null;
    let settled = false;
    const jobId = (jobCounter += 1);
    try {
      worker = new Worker(new URL("./regionSeedWorker.js", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error);
      return;
    }
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      terminateWorker(worker);
      fn(value);
    };
    worker.onmessage = (event) => {
      const data = event.data ?? {};
      if (data.jobId !== jobId) return;
      if (data.ok) finish(resolve, data.seed);
      else finish(reject, new Error(data.error || "region seed worker failed"));
    };
    worker.onerror = () => finish(reject, new Error("region seed worker crashed"));
    worker.postMessage({ jobId, kind: input.kind, payload: input.payload });
  });

const fetchUrlBytes = async (url) => {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
};

const parseInline = async (input) => {
  if (input.kind === "object") return indexRegionFeatureCollection(input.payload);
  const text = input.kind === "text"
    ? input.payload
    : new TextDecoder().decode(input.payload);
  return indexRegionFeatureCollection(JSON.parse(text));
};

export const loadRegionSeed = (url) => {
  if (currentUrl === url && currentPromise) return currentPromise;
  currentUrl = url;
  const request = (async () => {
    let input = null;
    if (import.meta.env.VITE_OH_WEB) {
      // Web mode serves /api/runtime/json/* from IndexedDB through the fetch
      // interceptor — go around it and take the RAW stored value so neither a
      // stringify nor a parse happens on the main thread. Dead-code-eliminated
      // from the desktop build (VITE_OH_WEB is a compile-time false).
      try {
        const { readRuntimeGeojsonRaw } = await import("../../../runtime/web/libraryStore.js");
        const raw = await readRuntimeGeojsonRaw("regionsGeojson");
        if (raw) input = raw;
      } catch {
        // Fall through to the fetch path.
      }
    }
    if (!input) {
      if (!url) return emptyRegionSeed();
      input = { kind: "bytes", payload: await fetchUrlBytes(url) };
    }
    try {
      return await runInWorker(input);
    } catch {
      // Workers unavailable (CSP, crashed, OOM): the old main-thread cost.
      return parseInline(input);
    }
  })();
  // A failed load must not memoize: the next call retries, matching the
  // jsonLoadedUrls retry semantics this replaces in loadRegionCatalog.
  currentPromise = request.catch((error) => {
    if (currentPromise === request) {
      currentUrl = "";
      currentPromise = null;
    }
    throw error;
  });
  return currentPromise;
};
