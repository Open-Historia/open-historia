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
import { isConstrainedDevice, mapRuntimeLimits } from "../../runtime/deviceProfile.js";

const { addProtocol, setMaxParallelImageRequests, setWorkerCount } = mapLibreGl;

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
};

// pmtiles:// URLs. Archives are added to the protocol by runtime/assets.js,
// before or after this runs.
export const ensurePmtilesProtocol = () => {
  if (!pmtilesRegistered) {
    addProtocol("pmtiles", pmtilesProtocol.tile.bind(pmtilesProtocol));
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
