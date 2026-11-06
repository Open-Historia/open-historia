// Open Historia — what MapLibre is told before the first map is made.
//
// Its own module so that only the map imports maplibre-gl. These used to live
// in runtime/assets.js, which nearly every file imports, so the 1 MB library
// was part of the page's first download and parse: before the startup screen
// could draw, and in the Scenario Workshop, which never shows a MapLibre map.
// World.jsx, Nations.jsx and Cities.jsx call these as they load, before any
// map exists; each is idempotent.
import mapLibreGl from "maplibre-gl";
import { basemapTileLoader, pmtilesProtocol } from "../../runtime/assets.js";
import { RELIEF_PROTOCOL, createReliefTileLoader } from "./scenarioTerrain.js";
import { SEASON_TINT_PROTOCOL, seasonTintTileLoader } from "./seasonTintTiles.js";
import { isConstrainedDevice, mapRuntimeLimits } from "../../runtime/deviceProfile.js";
import { workerCopySweepScript } from "./regionsSourceMemory.js";
// Arabic, Persian and Urdu labels (a country's name in the player's language,
// runtime/translator.js translateLabel, or a scenario's own) need MapLibre's
// right-to-left plugin: without it their letters are drawn unjoined and in the
// wrong order. The plugin's own file from the package (its WebAssembly is inside
// it), served by the game with the rest of its files, never from a CDN. By its
// path: the package's "exports" names only its source, not this built file.
import rtlTextPluginUrl from "../../../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url";

const { addProtocol, getRTLTextPluginStatus, importScriptInWorkers, setMaxParallelImageRequests, setRTLTextPlugin, setWorkerCount } = mapLibreGl;

let runtimeConfigured = false;
let pmtilesRegistered = false;
let basemapRegistered = false;

// Before the first map: the worker pool is made with it.
export const configureMapRuntime = () => {
  if (runtimeConfigured || typeof navigator === "undefined") return;
  const { workerCount, parallelImageRequests } = mapRuntimeLimits({
    hardwareThreads: navigator.hardwareConcurrency,
    constrained: isConstrainedDevice(),
  });
  setWorkerCount(workerCount);
  setMaxParallelImageRequests(parallelImageRequests);
  runtimeConfigured = true;
  // Lazy: fetched only once a label in a right-to-left script is drawn, so a
  // game that has none never loads it. MapLibre takes it once per page.
  if (typeof setRTLTextPlugin === "function" && getRTLTextPluginStatus?.() === "unavailable") {
    Promise.resolve(setRTLTextPlugin(rtlTextPluginUrl, true)).catch(() => {});
  }
};

// Drops the copies of a URL source's file MapLibre's workers keep beside its
// tile index (regionsSourceMemory.js WORKER_COPY_SWEEP). Resolves false where it
// cannot run; nothing drawn depends on it.
export const forgetWorkerSourceCopies = (sourceId) => {
  if (typeof importScriptInWorkers !== "function" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") return Promise.resolve(false);
  let url = "";
  try {
    url = URL.createObjectURL(new Blob([workerCopySweepScript(sourceId)], { type: "text/javascript" }));
    return Promise.resolve(importScriptInWorkers(url))
      .then(() => true, () => false)
      .finally(() => URL.revokeObjectURL(url));
  } catch {
    if (url) URL.revokeObjectURL(url);
    return Promise.resolve(false);
  }
};

// pmtiles:// URLs. Archives are added to the protocol by runtime/assets.js,
// before or after this runs.
export const ensurePmtilesProtocol = () => {
  if (!pmtilesRegistered) {
    addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol));
    // A scenario's relief tiles: the same archives, gaps answered transparent
    // (Map/scenarioTerrain.js).
    addProtocol(RELIEF_PROTOCOL, createReliefTileLoader(pmtilesProtocol.tilev4.bind(pmtilesProtocol)));
    pmtilesRegistered = true;
  }
  return pmtilesProtocol;
};

// ohbase:// URLs: the ESRI basemap without its "no data" placeholder tiles.
export const ensureBasemapProtocol = () => {
  if (!basemapRegistered) {
    addProtocol("ohbase", basemapTileLoader);
    basemapRegistered = true;
  }
};

// ohtint:// URLs: the season's tint, cut into tiles (Map/seasonTintTiles.js).
let seasonTintRegistered = false;
export const ensureSeasonTintProtocol = () => {
  if (!seasonTintRegistered) {
    addProtocol(SEASON_TINT_PROTOCOL, seasonTintTileLoader);
    seasonTintRegistered = true;
  }
};
