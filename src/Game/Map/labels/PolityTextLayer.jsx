import { useEffect, useRef } from "react";
import { POLITY_TEXT_RENDERER_LAYER_ID } from "./polityTextCustomLayer.js";
import { createPolityTextRuntime } from "./polityTextSync.js";

export const POLITY_TEXT_PTR0_STORAGE_KEY = "oh:polityTextRendererPtr0";
export const POLITY_TEXT_PTR1_STORAGE_KEY = "oh:polityTextRendererPtr1";
export const POLITY_TEXT_PTR1_DEBUG_STORAGE_KEY = "oh:polityTextRendererPtr1Debug";

const storageFlag = (key, queryKey) => {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(queryKey) === "1") return true;
    return window.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
};

export const isPolityTextPtr0Enabled = () => storageFlag(POLITY_TEXT_PTR0_STORAGE_KEY, "ptr0PolityText");
export const isPolityTextPtr1Enabled = () => {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("legacyPolityText") === "1") return false;
    const stored = window.localStorage?.getItem(POLITY_TEXT_PTR1_STORAGE_KEY);
    if (stored === "0") return false;
    return true;
  } catch {
    return true;
  }
};
export const isPolityTextPtr1DebugEnabled = () => storageFlag(POLITY_TEXT_PTR1_DEBUG_STORAGE_KEY, "ptr1PolityTextDebug");

export default function PolityTextLayer({
  map,
  enabled,
  mode = "ptr0",
  records = [],
  fontFamilies,
  textColor,
  haloColor,
  debugBaseline = true,
  // Globe and flat maps now use the SAME polity-name renderer. The projection
  // is handed to the custom layer so it can apply projection per map projection
  isGlobe = false,
  onStatusChange,
}) {
  const runtimeRef = useRef(null);
  const latestRecordsRef = useRef(records);
  latestRecordsRef.current = records;

  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!enabled) return undefined;
    // The per-label logs are for debugging the renderer, not every mount.
    const diagnostics = mode !== "ptr1" || isPolityTextPtr1DebugEnabled();

    const requestedProbe = {
      requested: true,
      mounted: false,
      mode,
      layerId: POLITY_TEXT_RENDERER_LAYER_ID,
      fontFamilies: [...(fontFamilies ?? [])],
      recordCount: mode === "ptr1" ? records.length : 1,
      owners: mode === "ptr1" ? records.map((record) => record.owner) : ["Russian Federation"],
      isGlobe: Boolean(isGlobe),
      projection: mapInstance?.getProjection?.()?.type ?? "unknown",
    };
    const reportStatus = (patch = {}) => {
      Object.assign(requestedProbe, patch);
      globalThis.__OH_POLITY_TEXT_PTR__ = requestedProbe;
      onStatusChange?.({
        requested: Boolean(requestedProbe.requested),
        mounted: Boolean(requestedProbe.mounted),
        failed: Boolean(requestedProbe.failed),
        waitingForStyle: Boolean(requestedProbe.waitingForStyle),
        preparing: Boolean(requestedProbe.preparing),
        preparationMs: Number(requestedProbe.preparationMs) || 0,
        placementWorkerMs: Number(requestedProbe.placementWorkerMs) || 0,
        placementTaskCount: Number(requestedProbe.placementTaskCount) || 0,
        incrementalChangedRecordCount: Number(requestedProbe.incrementalChangedRecordCount) || 0,
        incrementalChangedOwnerCount: Number(requestedProbe.incrementalChangedOwnerCount) || 0,
        recordCount: Number(requestedProbe.recordCount) || 0,
        owners: Array.isArray(requestedProbe.owners) ? [...requestedProbe.owners] : [],
        lastMountError: requestedProbe.lastMountError ?? null,
      });
    };

    reportStatus();
    if (diagnostics) console.info(`[map] ${mode.toUpperCase()} mount requested`, requestedProbe);

    if (!mapInstance?.addLayer) {
      console.warn(`[map] ${mode.toUpperCase()} enabled but map instance is unavailable`);
      reportStatus({ failed: true, lastMountError: "map-unavailable" });
      return undefined;
    }

    const runtime = createPolityTextRuntime({
      mapInstance,
      mode,
      getRecords: () => latestRecordsRef.current,
      fontFamilies,
      textColor,
      haloColor,
      debugBaseline,
      isGlobe,
      diagnostics,
      requestedProbe,
      reportStatus,
    });
    runtimeRef.current = runtime;

    runtime.syncRecords({ invalidateInFlight: false });
    const onMapReady = () => {
      // Style lifecycle events only retry a missing/removed custom layer. They
      // must not cancel placement work already solving the same PTR records.
      runtime.syncRecords?.({ invalidateInFlight: false });
    };
    mapInstance.on?.("styledata", onMapReady);
    mapInstance.on?.("load", onMapReady);
    mapInstance.on?.("idle", onMapReady);
    mapInstance.on?.("projectiontransition", onMapReady);

    return () => {
      runtime.dispose();
      mapInstance.off?.("styledata", onMapReady);
      mapInstance.off?.("load", onMapReady);
      mapInstance.off?.("idle", onMapReady);
      mapInstance.off?.("projectiontransition", onMapReady);
      try {
        if (mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)) mapInstance.removeLayer(POLITY_TEXT_RENDERER_LAYER_ID);
      } catch {}
      onStatusChange?.({
        requested: false,
        mounted: false,
        failed: false,
        waitingForStyle: false,
        preparing: false,
        preparationMs: 0,
        placementWorkerMs: 0,
        placementTaskCount: 0,
        incrementalChangedRecordCount: 0,
        incrementalChangedOwnerCount: 0,
        recordCount: 0,
        owners: [],
        lastMountError: null,
      });
      if (globalThis.__OH_POLITY_TEXT_PTR__ === requestedProbe) delete globalThis.__OH_POLITY_TEXT_PTR__;
      if (globalThis.__OH_POLITY_TEXT_PTR0__ === requestedProbe) delete globalThis.__OH_POLITY_TEXT_PTR0__;
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [debugBaseline, enabled, fontFamilies, haloColor, isGlobe, map, mode, onStatusChange, textColor]);

  // Record publications are incremental. Do not make them a dependency of the
  // mount effect: that was the source of the visible PTR -> legacy -> PTR flash
  // on every territory mutation. The currently accepted layer remains mounted
  // while only changed records are prepared, then swaps atomically.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!enabled || mode !== "ptr1" || !runtime?.syncRecords) return;
    // Record publication is the ONLY wakeup allowed to invalidate an in-flight
    // solve, and syncRecords still verifies that the snapshot reference is truly
    // newer before cancelling anything.
    runtime.syncRecords({ invalidateInFlight: true });
  }, [enabled, mode, records]);

  return null;
}
