// Listeners World.jsx puts on each MapLibre instance it mounts. A basemap or
// background change remounts the map, so World attaches these again for every
// new instance and detaches them from the old one (the returned cleanup).
import { recordMapTrace } from "../../runtime/mapPerfTrace.js";

// A tile starting to load in one of the basemap's own sources: the style's
// sources, not the polity, city, unit or region sources the map's React tree
// adds. MapLibre fires `sourcedataloading` with the tile for each tile request
// and without one for a source's metadata.
export const isBasemapTileLoading = (event, basemapSourceIds) => Boolean(
  event?.dataType === "source"
  && event.tile
  && basemapSourceIds?.has?.(String(event.sourceId ?? "")),
);

// `perf` is World's per-pan counter object; its counters only move while
// `perf.active` (a pan being sampled). The WebGL context listeners are always
// on: a lost context is rare, and when it happens the trace is what explains a
// grey map. Everything else fires on every frame or tile, so it is attached
// only when `verbose` (isMapPerfVerbose()).
export const attachMapInstrumentation = ({
  map,
  canvas,
  perf,
  verbose = false,
  onSourceLoaded = null,
  onBasemapTileLoading = null,
  basemapSourceIds = null,
}) => {
  const listeners = [];
  const listen = (type, handler) => {
    map.on?.(type, handler);
    listeners.push([type, handler]);
  };

  const onLost = (event) => {
    // map.remove() loses its own context on purpose — every game switch and
    // every unmount does — and MapLibre marks the map removed only after.
    // That is teardown, not the GPU dropping the map, and it was logged as a
    // warning for every game a player opened. Decided a task later, once the
    // removal has finished.
    const status = event?.statusMessage ?? "";
    setTimeout(() => {
      if (map?._removed || !canvas.isConnected) {
        recordMapTrace("gpu:webgl-released", { status });
        return;
      }
      if (perf.active) perf.webglLosses += 1;
      recordMapTrace("gpu:webgl-lost", { status });
      console.warn(`[OH PERF GPU] WebGL context lost${status ? ` · ${status}` : ""}`);
    }, 0);
  };
  const onRestored = () => {
    recordMapTrace("gpu:webgl-restored");
    console.warn("[OH PERF GPU] WebGL context restored");
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  if (typeof onBasemapTileLoading === "function") {
    listen("sourcedataloading", (event) => {
      if (isBasemapTileLoading(event, basemapSourceIds?.())) onBasemapTileLoading(event);
    });
  }

  if (verbose) {
    listen("sourcedata", (event) => {
      if (perf.active) {
        perf.sourceEvents += 1;
        if (event?.sourceDataType === "content" || event?.sourceDataType === "metadata") {
          perf.sourceLoads += 1;
        }
        if (event?.isSourceLoaded === true) perf.sourceLoaded += 1;
      }
      const sourceId = String(event?.sourceId ?? "");
      if (!sourceId) return;
      recordMapTrace("map:source-event", {
        sourceId,
        sourceDataType: event?.sourceDataType ?? "",
        loaded: event?.isSourceLoaded === true,
      });
      if (event?.isSourceLoaded === true) onSourceLoaded?.(sourceId);
    });
    listen("data", () => {
      if (perf.active) perf.dataEvents += 1;
    });
    listen("styledata", () => {
      if (perf.active) perf.styleEvents += 1;
      recordMapTrace("map:styledata");
    });
    listen("styledataloading", () => {
      if (perf.active) perf.styleLoadingEvents += 1;
      recordMapTrace("map:styledataloading");
    });
    listen("render", () => {
      if (perf.active) perf.renders += 1;
    });
    listen("idle", () => {
      if (perf.active) perf.idles += 1;
      recordMapTrace("map:idle-event");
    });
    listen("zoomstart", () => {
      if (perf.active) perf.zoomStarts += 1;
      recordMapTrace("camera:zoom-start", { zoom: map.getZoom?.() ?? 0 });
    });
    listen("zoomend", () => {
      if (perf.active) perf.zoomEnds += 1;
      recordMapTrace("camera:zoom-end", { zoom: map.getZoom?.() ?? 0 });
    });
  }

  recordMapTrace("map:instrumentation-attached", { verbose });

  return () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    for (const [type, handler] of listeners) map?.off?.(type, handler);
    listeners.length = 0;
  };
};
