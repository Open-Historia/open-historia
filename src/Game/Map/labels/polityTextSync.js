/*! Open Historia — PTR record sync © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
// Keeps the polity-name renderer's custom layer in step with the canonical
// label records: measure, place (in a worker), publish, and on later snapshots
// re-prepare only what changed. PolityTextLayer.jsx owns the React side; this
// module is plain JavaScript so the tests can drive it with a fake map.
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

const firstSemanticLayer = (map) => [
  "cities-shapes",
  "cities-labels",
  "markers-shapes-strategic",
  "units-fill",
].find((id) => map.getLayer?.(id));

export const preparePtr1Records = async ({
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

// One mounted renderer. getRecords returns the newest published record array;
// its identity is what tells a real revision from a style wakeup. The prepare,
// layer, font and layer-order steps can be swapped out by the tests.
export const createPolityTextRuntime = ({
  mapInstance,
  mode = "ptr1",
  getRecords,
  fontFamilies,
  textColor,
  haloColor,
  debugBaseline = true,
  isGlobe = false,
  diagnostics = false,
  requestedProbe = {},
  reportStatus = () => {},
  prepareRecords = preparePtr1Records,
  createLayer = createPolityTextCustomLayer,
  waitForFonts = waitForFontStack,
  enforceLayerOrder = enforceMapLayerOrder,
}) => {
  const runtime = {
    mapInstance,
    layer: null,
    entriesByKey: new Map(),
    fingerprints: new Map(),
    // Keys published with the quick provisional placement whose refinement has
    // not been published yet. Their fingerprints already count as current, so
    // without this a refinement cancelled by a newer snapshot never ran again.
    unrefinedKeys: new Set(),
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
    dispose: null,
  };

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
      enforceLayerOrder(mapInstance);
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
    const requestedRecordsRef = getRecords();
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
        await waitForFonts({ families: fontFamilies, sampleText: "RUSSIAN FEDERATION", sizePx: 128 });
        if (runtime.cancelled || generation !== runtime.generation) return;
        runtime.layer = createLayer({
          records: null,
          fontFamilies,
          fillStyle: "rgba(255, 48, 214, 0.98)",
          haloStyle: haloColor || "rgba(3, 4, 8, 0.98)",
          debugBaseline,
          diagnostics,
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

      const snapshot = [...(getRecords() ?? [])];
      if (!snapshot.length && !runtime.layer) {
        reportStatus({ waitingForStyle: true, failed: false });
        return;
      }

      const { nextFingerprints, changedRecords, removedKeys } = diffPolityTextRecords(snapshot, runtime.fingerprints);
      const changedKeys = new Set(changedRecords.map((record) => polityTextRecordKey(record)));
      // Labels still on their provisional placement are refined on this pass
      // too, although their records have not changed since.
      const unrefinedRecords = runtime.layer
        ? snapshot.filter((record) => {
          const key = polityTextRecordKey(record);
          return runtime.unrefinedKeys.has(key) && !changedKeys.has(key);
        })
        : [];
      if (runtime.layer && !changedRecords.length && !removedKeys.length && !unrefinedRecords.length) return;

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

      const prepRecords = runtime.layer ? [...changedRecords, ...unrefinedRecords] : snapshot;
      const prepKeys = new Set(prepRecords.map((record) => polityTextRecordKey(record)));
      const initialMount = !runtime.layer;

      // preparedKeys are the records this result was prepared for; every other
      // record keeps the entry already on screen.
      const publishPrepared = (preparedResult, preparedKeys) => {
        const preparedByKey = new Map(
          preparedResult.entries.map(({ key, entry }) => [key, entry]),
        );
        const nextEntriesByKey = new Map();
        for (const record of snapshot) {
          const key = polityTextRecordKey(record);
          const entry = preparedKeys.has(key)
            ? preparedByKey.get(key)
            : runtime.entriesByKey.get(key);
          if (entry) nextEntriesByKey.set(key, entry);
        }
        const nextEntries = snapshot
          .map((record) => nextEntriesByKey.get(polityTextRecordKey(record)))
          .filter(Boolean);

        if (!runtime.layer) {
          runtime.layer = createLayer({
            records: snapshot,
            preparedEntries: nextEntries,
            fontFamilies,
            fillStyle: textColor || "rgba(250, 249, 244, 0.995)",
            haloStyle: haloColor || "rgba(3, 4, 8, 0.98)",
            debugBaseline,
            diagnostics,
            isGlobe,
          });
          if (!addExistingLayerIfNeeded()) return null;
        } else {
          runtime.layer.replacePreparedEntries?.(nextEntries);
          enforceLayerOrder(mapInstance);
        }

        runtime.entriesByKey = nextEntriesByKey;
        runtime.fingerprints = nextFingerprints;
        for (const key of runtime.unrefinedKeys) {
          if (!nextFingerprints.has(key)) runtime.unrefinedKeys.delete(key);
        }
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
        const provisional = await prepareRecords({
          records: changedRecords,
          fontFamilies,
          textColor,
          haloColor,
          isCancelled: () => runtime.cancelled || generation !== runtime.generation,
          onWorker: () => {},
          optimizePlacement: false,
        });
        if (!provisional || runtime.cancelled || generation !== runtime.generation) return;
        const published = publishPrepared(provisional, changedKeys);
        if (!published) {
          reportStatus({ waitingForStyle: true });
          scheduleRetry();
          return;
        }
        if (provisional.optimizableTaskCount) {
          for (const key of changedKeys) runtime.unrefinedKeys.add(key);
        }

        globalThis.__OH_MAP_SOURCE_PERF__ = {
          ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
          ptrIncrementalFirstPaintMs: Math.round(provisional.preparationMs * 10) / 10,
          ptrIncrementalChangedRecordCount: changedRecords.length,
          ptrIncrementalChangedOwnerCount: changedOwners.length,
        };
        reportStatus({
          mounted: true,
          preparing: provisional.optimizableTaskCount > 0 || unrefinedRecords.length > 0,
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
        if (!provisional.optimizableTaskCount && !unrefinedRecords.length) {
          if (diagnostics) {
            console.info(`[map] ${mode.toUpperCase()} polity text renderer updated`, {
              layerPresent: Boolean(mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)),
              recordCount: published.preparedOwners.length,
              changedRecordCount: changedRecords.length,
              changedOwnerCount: changedOwners.length,
              provisionalFirstPaint: true,
              refined: false,
            });
          }
          return;
        }
      }

      const prepared = await prepareRecords({
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

      const published = publishPrepared(prepared, prepKeys);
      if (!published) {
        reportStatus({ waitingForStyle: true });
        scheduleRetry();
        return;
      }
      for (const key of prepKeys) runtime.unrefinedKeys.delete(key);

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
      if (diagnostics) {
        console.info(`[map] ${mode.toUpperCase()} polity text renderer ${initialMount ? "mounted" : "updated"}`, {
          layerPresent: Boolean(mapInstance.getLayer?.(POLITY_TEXT_RENDERER_LAYER_ID)),
          recordCount: published.preparedOwners.length,
          changedRecordCount: changedRecords.length,
          changedOwnerCount: changedOwners.length,
          provisionalFirstPaint: !initialMount,
          refined: !initialMount,
        });
      }
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

  runtime.dispose = () => {
    runtime.cancelled = true;
    runtime.generation += 1;
    cancelPlacementSolve();
    clearRetry();
  };

  return runtime;
};
