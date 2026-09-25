import { useEffect, useRef } from "react";
import { enforceMapLayerOrder } from "../mapLayerOrder.js";
import {
  createPolityTextCustomLayer,
  finalizePolityTextRenderRecord,
  measurePolityTextRenderRecord,
  POLITY_TEXT_RENDERER_LAYER_ID,
} from "./polityTextCustomLayer.js";
import { waitForFontStack } from "./polityTextRasterizer.js";
import {
  diffPolityTextRecords,
  polityTextRecordKey,
} from "./polityTextContinuity.js";

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

const firstSemanticLayer = (map) => [
  "cities-shapes",
  "cities-labels",
  "markers-shapes-strategic",
  "units-fill",
].find((id) => map.getLayer?.(id));

const preparePtr1Records = async ({
  records,
  fontFamilies,
  textColor,
  haloColor,
  isCancelled,
  onWorker,
  optimizePlacement = true,
  placementTimeoutMs = 30000,
}) => {
  const startedAt = performance.now();
  const subset = Array.isArray(records) ? records : [];
  const sampleText = subset.map((record) => record.text).join(" ").slice(0, 900);
  await waitForFontStack({ families: fontFamilies, sampleText, sizePx: 128 });
  if (isCancelled()) return null;

  const plans = [];
  for (let index = 0; index < subset.length; index += 1) {
    const record = subset[index];
    const plan = measurePolityTextRenderRecord({
      record,
      fontFamilies,
      fillStyle: textColor || "rgba(250, 249, 244, 0.995)",
      haloStyle: haloColor || "rgba(3, 4, 8, 0.98)",
      haloWidthPx: 5,
      samples: 128,
    });
    if (plan) plans.push({ key: polityTextRecordKey(record), plan });
    if ((index + 1) % 12 === 0 && index + 1 < subset.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isCancelled()) return null;
    }
  }

  const tasks = plans.flatMap(({ key, plan }) => (plan.placementTask ? [{ key, args: plan.placementTask }] : []));
  const placements = new Map();
  let placementWorkerMs = 0;

  if (optimizePlacement && tasks.length && typeof Worker !== "undefined") {
    try {
      const requestId = Date.now() + Math.random();
      const response = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./polityTextPlacementWorker.js", import.meta.url), { type: "module" });
        let settled = false;
        let timeout = null;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          if (timeout != null) clearTimeout(timeout);
          worker.terminate();
          onWorker(null, null);
          callback();
        };
        const cancel = () => finish(() => reject(new Error("PTR placement worker cancelled")));
        onWorker(worker, cancel);
        timeout = setTimeout(() => {
          finish(() => reject(new Error("PTR placement worker timed out")));
        }, placementTimeoutMs);
        worker.onmessage = ({ data }) => {
          if (data?.requestId !== requestId) return;
          if (data?.type === "error") {
            finish(() => reject(new Error(data.error || "PTR placement worker failed")));
            return;
          }
          if (data?.type !== "optimized") return;
          finish(() => resolve(data));
        };
        worker.onerror = (error) => {
          finish(() => reject(error instanceof Error ? error : new Error("PTR placement worker failed")));
        };
        worker.postMessage({ type: "optimize", requestId, tasks });
      });
      placementWorkerMs = Number(response?.elapsedMs) || 0;
      for (const item of response?.results ?? []) placements.set(String(item?.key ?? ""), item?.result ?? null);
    } catch (error) {
      if (!isCancelled() && !/cancelled/i.test(String(error?.message ?? error))) {
        console.warn("[map] PTR placement worker unavailable; using fast envelope fallback:", error);
      }
    }
  } else if (optimizePlacement && tasks.length) {
    console.warn("[map] Web Workers unavailable; PTR uses fast envelope fallback instead of blocking the UI thread.");
  }

  if (isCancelled()) return null;
  const entries = plans
    .map(({ key, plan }) => ({
      key,
      entry: finalizePolityTextRenderRecord({
        plan,
        optimizedPlacement: placements.get(key) ?? null,
        placementResolved: true,
      }),
    }))
    .filter(({ entry }) => Boolean(entry));

  return {
    entries,
    preparationMs: performance.now() - startedAt,
    placementWorkerMs,
    placementTaskCount: optimizePlacement ? tasks.length : 0,
    optimizableTaskCount: tasks.length,
  };
};

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
    console.info(`[map] ${mode.toUpperCase()} mount requested`, requestedProbe);

    if (!mapInstance?.addLayer) {
      console.warn(`[map] ${mode.toUpperCase()} enabled but map instance is unavailable`);
      reportStatus({ failed: true, lastMountError: "map-unavailable" });
      return undefined;
    }

    const runtime = {
      mapInstance,
      layer: null,
      entriesByKey: new Map(),
      fingerprints: new Map(),
      generation: 0,
      placementWorker: null,
      cancelPlacement: null,
      retryTimer: null,
      cancelled: false,
      mounting: false,
      pendingSync: false,
      // Exact records snapshot currently being prepared. MapLibre emits a burst
      // of styledata/load/idle events while a fresh scenario style settles;
      // those are readiness wakeups, not political revisions, and must never
      // invalidate the placement generation already solving these same records.
      activeRecordsRef: null,
      mountAttempts: 0,
      reportStatus,
      syncRecords: null,
    };
    runtimeRef.current = runtime;

    const clearRetry = () => {
      if (runtime.retryTimer != null) {
        clearTimeout(runtime.retryTimer);
        runtime.retryTimer = null;
      }
    };

    const scheduleRetry = (delayMs = 120) => {
      if (runtime.cancelled || runtime.retryTimer != null) return;
      runtime.retryTimer = setTimeout(() => {
        runtime.retryTimer = null;
        runtime.syncRecords?.();
      }, delayMs);
    };

    const addExistingLayerIfNeeded = () => {
      // With the WebGL context lost the map has no style and getLayer throws;
      // getStyle() then says so, and the caller waits and retries.
      if (!runtime.layer || (mapInstance.style && mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID))) return true;
      const style = mapInstance.getStyle?.();
      if (!style) return false;
      try {
        mapInstance.addLayer(runtime.layer, firstSemanticLayer(mapInstance));
        enforceMapLayerOrder(mapInstance);
        mapInstance.triggerRepaint?.();
        reportStatus({ mounted: true, waitingForStyle: false, failed: false });
        return true;
      } catch (error) {
        if (/style|load|source/i.test(String(error?.message ?? error))) return false;
        throw error;
      }
    };

    const cancelPlacementSolve = () => {
      const cancel = runtime.cancelPlacement;
      runtime.cancelPlacement = null;
      if (typeof cancel === "function") cancel();
      else runtime.placementWorker?.terminate?.();
      runtime.placementWorker = null;
    };

    runtime.syncRecords = async ({ invalidateInFlight = false } = {}) => {
      if (runtime.cancelled) return;
      const requestedRecordsRef = latestRecordsRef.current;
      if (runtime.mounting) {
        // Only a genuinely newer canonical PTR record snapshot may invalidate an
        // in-flight placement solve. A fresh MapLibre style emits repeated
        // styledata/load/idle events while scenario switching; treating those
        // readiness wakeups as revisions starves the initial PTR solve forever
        // and leaves the legacy fallback on screen until a full page refresh.
        const recordsActuallyChanged = requestedRecordsRef !== runtime.activeRecordsRef;
        if (!invalidateInFlight || !recordsActuallyChanged) return;

        runtime.pendingSync = true;
        runtime.generation += 1;
        // Terminating a Worker alone does not settle the Promise awaiting its
        // response. Abort the solve itself so a rapid annexation chain cannot
        // leave PTR stuck behind the old 30-second timeout before the newest
        // political snapshot is allowed to prepare.
        cancelPlacementSolve();
        return;
      }
      runtime.mounting = true;
      runtime.activeRecordsRef = requestedRecordsRef;
      const generation = ++runtime.generation;
      cancelPlacementSolve();
      try {
        if (runtime.layer && !addExistingLayerIfNeeded()) {
          reportStatus({ waitingForStyle: true });
          scheduleRetry();
          return;
        }

        if (mode !== "ptr1") {
          if (runtime.layer) return;
          await waitForFontStack({ families: fontFamilies, sampleText: "RUSSIAN FEDERATION", sizePx: 128 });
          if (runtime.cancelled || generation !== runtime.generation) return;
          runtime.layer = createPolityTextCustomLayer({
            records: null,
            fontFamilies,
            fillStyle: "rgba(255, 48, 214, 0.98)",
            haloStyle: haloColor || "rgba(3, 4, 8, 0.98)",
            debugBaseline,
            isGlobe,
          });
          if (!addExistingLayerIfNeeded()) {
            reportStatus({ waitingForStyle: true });
            scheduleRetry();
            return;
          }
          reportStatus({ mounted: true, recordCount: 1, owners: ["Russian Federation"] });
          return;
        }

        const snapshot = [...(latestRecordsRef.current ?? [])];
        if (!snapshot.length && !runtime.layer) {
          reportStatus({ waitingForStyle: true, failed: false });
          return;
        }

        const { nextFingerprints, changedRecords, removedKeys } = diffPolityTextRecords(snapshot, runtime.fingerprints);
        if (runtime.layer && !changedRecords.length && !removedKeys.length) return;

        const changedOwners = [...new Set(changedRecords.map((record) => record.owner).filter(Boolean))];
        // Crucial continuity invariant: mounted stays TRUE while replacements are
        // prepared. Legacy fallback labels therefore never flash between the old
        // accepted PTR snapshot and the new one.
        const targetOwners = snapshot.map((record) => record.owner).filter(Boolean);
        const continuityOwners = [...new Set([
          ...(requestedProbe.owners ?? []),
          ...targetOwners,
        ])];
        reportStatus({
          preparing: true,
          mounted: Boolean(runtime.layer && mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)),
          // Keep both the accepted and incoming owners hidden from the legacy
          // fallback while preparation runs. Existing PTR labels stay frozen; a
          // newly-created polity waits blank for its first PTR label instead of
          // flashing a temporary MapLibre fallback in the middle of the update.
          owners: continuityOwners,
          incrementalChangedRecordCount: runtime.layer ? changedRecords.length : 0,
          incrementalChangedOwnerCount: runtime.layer ? changedOwners.length : 0,
        });

        const prepRecords = runtime.layer ? changedRecords : snapshot;
        const changedKeys = new Set(changedRecords.map((record) => polityTextRecordKey(record)));
        const initialMount = !runtime.layer;

        const publishPrepared = (preparedResult) => {
          const preparedByKey = new Map(
            preparedResult.entries.map(({ key, entry }) => [key, entry]),
          );
          const nextEntriesByKey = new Map();
          for (const record of snapshot) {
            const key = polityTextRecordKey(record);
            const entry = changedKeys.has(key)
              ? preparedByKey.get(key)
              : runtime.entriesByKey.get(key);
            if (entry) nextEntriesByKey.set(key, entry);
          }
          const nextEntries = snapshot
            .map((record) => nextEntriesByKey.get(polityTextRecordKey(record)))
            .filter(Boolean);

          if (!runtime.layer) {
            runtime.layer = createPolityTextCustomLayer({
              records: snapshot,
              preparedEntries: nextEntries,
              fontFamilies,
              fillStyle: textColor || "rgba(250, 249, 244, 0.995)",
              haloStyle: haloColor || "rgba(3, 4, 8, 0.98)",
              debugBaseline,
              isGlobe,
            });
            if (!addExistingLayerIfNeeded()) return null;
          } else {
            runtime.layer.replacePreparedEntries?.(nextEntries);
            enforceMapLayerOrder(mapInstance);
          }

          runtime.entriesByKey = nextEntriesByKey;
          runtime.fingerprints = nextFingerprints;
          return {
            nextEntries,
            preparedOwners: nextEntries.map((entry) => entry?.record?.owner).filter(Boolean),
          };
        };

        // Mid-campaign political mutations must become visible immediately.
        // The expensive placement optimizer is refinement, not correctness.
        // Publish the new worker-owned territorial envelope first, then optimize
        // the same changed records in the background. This keeps Germany/Poland-
        // style annexation recordings current even when the optimizer is slow.
        if (runtime.layer && changedRecords.length) {
          const provisional = await preparePtr1Records({
            records: changedRecords,
            fontFamilies,
            textColor,
            haloColor,
            isCancelled: () => runtime.cancelled || generation !== runtime.generation,
            onWorker: () => {},
            optimizePlacement: false,
          });
          if (!provisional || runtime.cancelled || generation !== runtime.generation) return;
          const published = publishPrepared(provisional);
          if (!published) {
            reportStatus({ waitingForStyle: true });
            scheduleRetry();
            return;
          }

          globalThis.__OH_MAP_SOURCE_PERF__ = {
            ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
            ptrIncrementalFirstPaintMs: Math.round(provisional.preparationMs * 10) / 10,
            ptrIncrementalChangedRecordCount: changedRecords.length,
            ptrIncrementalChangedOwnerCount: changedOwners.length,
          };
          reportStatus({
            mounted: true,
            preparing: provisional.optimizableTaskCount > 0,
            failed: false,
            waitingForStyle: false,
            incrementalChangedRecordCount: changedRecords.length,
            incrementalChangedOwnerCount: changedOwners.length,
            recordCount: published.preparedOwners.length,
            owners: published.preparedOwners,
            projection: mapInstance.getProjection?.()?.type ?? "unknown",
            lastMountError: null,
          });

          // Fast-placement records need no second pass.
          if (!provisional.optimizableTaskCount) {
            console.info(`[map] ${mode.toUpperCase()} polity text renderer updated`, {
              layerPresent: Boolean(mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)),
              recordCount: published.preparedOwners.length,
              changedRecordCount: changedRecords.length,
              changedOwnerCount: changedOwners.length,
              provisionalFirstPaint: true,
              refined: false,
            });
            return;
          }
        }

        const prepared = await preparePtr1Records({
          records: prepRecords,
          fontFamilies,
          textColor,
          haloColor,
          isCancelled: () => runtime.cancelled || generation !== runtime.generation,
          onWorker: (worker, cancel) => {
            runtime.placementWorker = worker;
            runtime.cancelPlacement = cancel;
          },
          // Initial scenario placement may legitimately be heavier. Incremental
          // refinement is optional because a correct provisional PTR snapshot is
          // already on screen; never let it linger behind a 30-second watchdog.
          placementTimeoutMs: initialMount ? 30000 : 4000,
        });
        if (!prepared || runtime.cancelled || generation !== runtime.generation) return;

        const published = publishPrepared(prepared);
        if (!published) {
          reportStatus({ waitingForStyle: true });
          scheduleRetry();
          return;
        }

        if (initialMount) {
          globalThis.__OH_MAP_SOURCE_PERF__ = {
            ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
            ptrPreparationMs: Math.round(prepared.preparationMs * 10) / 10,
            ptrPlacementWorkerMs: Math.round(prepared.placementWorkerMs * 10) / 10,
            ptrPlacementTaskCount: prepared.placementTaskCount,
            ptrPreparedLabelCount: published.nextEntries.length,
          };
        } else {
          globalThis.__OH_MAP_SOURCE_PERF__ = {
            ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
            ptrIncrementalPreparationMs: Math.round(prepared.preparationMs * 10) / 10,
            ptrIncrementalPlacementWorkerMs: Math.round(prepared.placementWorkerMs * 10) / 10,
            ptrIncrementalChangedRecordCount: changedRecords.length,
            ptrIncrementalChangedOwnerCount: changedOwners.length,
          };
        }
        reportStatus({
          mounted: true,
          preparing: false,
          failed: false,
          waitingForStyle: false,
          preparationMs: requestedProbe.preparationMs || prepared.preparationMs,
          placementWorkerMs: prepared.placementWorkerMs,
          placementTaskCount: prepared.placementTaskCount,
          recordCount: published.preparedOwners.length,
          owners: published.preparedOwners,
          projection: mapInstance.getProjection?.()?.type ?? "unknown",
          lastMountError: null,
        });
        globalThis.__OH_POLITY_TEXT_PTR0__ = requestedProbe;
        console.info(`[map] ${mode.toUpperCase()} polity text renderer ${initialMount ? "mounted" : "updated"}`, {
          layerPresent: Boolean(mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)),
          recordCount: published.preparedOwners.length,
          changedRecordCount: changedRecords.length,
          changedOwnerCount: changedOwners.length,
          provisionalFirstPaint: !initialMount,
          refined: !initialMount,
        });
      } catch (error) {
        const message = String(error?.message ?? error ?? "unknown PTR error");
        reportStatus({
          failed: !runtime.layer,
          mounted: Boolean(runtime.layer && mapInstance.style && mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)),
          preparing: false,
          lastMountError: message,
        });
        if (/style|load|source/i.test(message)) {
          scheduleRetry();
        } else {
          console.error(`[map] ${mode.toUpperCase()} polity text renderer update failed:`, error);
        }
      } finally {
        runtime.mounting = false;
        runtime.activeRecordsRef = null;
        if (runtime.pendingSync && !runtime.cancelled) {
          runtime.pendingSync = false;
          setTimeout(() => runtime.syncRecords?.({ invalidateInFlight: false }), 0);
        }
      }
    };

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
      runtime.cancelled = true;
      runtime.generation += 1;
      cancelPlacementSolve();
      clearRetry();
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
