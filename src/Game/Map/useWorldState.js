import { useEffect, useState } from "react";
import { JSON_URLS, readJson, reportPerfOperation } from "../../runtime/assets.js";

// Map-facing world store.
//
// R2.27: local world writes push updates immediately through "oh:world-updated".
// The network poll is now only a safety net for external/device writes, rather
// than reparsing the entire campaign every five seconds while the player is idle.

const POLL_MS = 90000;
const RETRY_BUSY_MS = 2500;
const IDLE_TIMEOUT_MS = 4000;
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_MARKERS = Object.freeze([]);

let sharedState = null;
let publishedState = null;
let pollTimer = null;
let idleHandle = null;
let listenersInstalled = false;
let pollInFlight = false;
let mapMoving = false;
let lastPollAt = 0;
const subscribers = new Set();

let overrideState = null;

const effectiveState = () => overrideState ?? sharedState;

const areEqualShallow = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (let i = 0; i < keysA.length; i += 1) {
    const key = keysA[i];
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const areEqualStructured = (a, b) => {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
};

const deriveMapState = (state) => ({
  // Kept for compatibility with existing consumers. As before, this is a
  // map-facing snapshot: non-map-only changes do not force a publication.
  worldState: state,
  worldKnown: Boolean(state && Object.keys(state).length > 0),
  customRegions: Boolean(state?.customRegions),
  customCities: Boolean(state?.customCities),
  basemap: state?.basemap || null,
  background: state?.background ?? null,
  regionOwnershipOverrides: state?.regionOwnershipOverrides ?? EMPTY_OBJECT,
  regionClaimants: state?.regionClaimants ?? EMPTY_OBJECT,
  polityOverrides: state?.polityOverrides ?? EMPTY_OBJECT,
  markers: Array.isArray(state?.markers) ? state.markers : EMPTY_MARKERS,
  cityRenames: state?.cityRenames ?? EMPTY_OBJECT,
  labelFont: state?.labelFont ?? "",
  labelHaloColor: state?.labelHaloColor ?? "",
  labelTextColor: state?.labelTextColor ?? "",
});

const sameMapState = (prev, next) =>
  Boolean(prev) &&
  prev.worldKnown === next.worldKnown &&
  prev.customRegions === next.customRegions &&
  prev.customCities === next.customCities &&
  prev.basemap === next.basemap &&
  areEqualStructured(prev.background, next.background) &&
  prev.labelFont === next.labelFont &&
  prev.labelHaloColor === next.labelHaloColor &&
  prev.labelTextColor === next.labelTextColor &&
  areEqualShallow(prev.regionOwnershipOverrides, next.regionOwnershipOverrides) &&
  areEqualStructured(prev.regionClaimants, next.regionClaimants) &&
  areEqualStructured(prev.markers, next.markers) &&
  areEqualStructured(prev.cityRenames, next.cityRenames) &&
  areEqualStructured(prev.polityOverrides, next.polityOverrides);

const publish = ({ force = false } = {}) => {
  const state = effectiveState();
  if (!state) return;
  const next = deriveMapState(state);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const unchanged = !force && sameMapState(publishedState, next);
  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
  reportPerfOperation("compare map-facing world slices", elapsed, { warnAt: 25 });
  if (unchanged) return;
  publishedState = next;
  for (const fn of subscribers) fn(next);
};

// The raw world the map runtime most recently received. Use this for click-time
// identity lookups instead of issuing a new world.json fetch.
export const getWorldStateSnapshot = () => effectiveState();

export const setWorldStateOverride = (next) => {
  overrideState = next && typeof next === "object" ? next : null;
  publish({ force: true });
};

const poll = async () => {
  if (pollInFlight || mapMoving || document.visibilityState === "hidden") return;
  pollInFlight = true;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    sharedState = await readJson(JSON_URLS.world, {
      defaultValue: {},
      force: true,
      clone: false,
    });
    lastPollAt = Date.now();
  } catch {
    if (!sharedState) sharedState = {};
  } finally {
    pollInFlight = false;
  }

  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
  reportPerfOperation("world external safety poll", elapsed, { warnAt: 75 });
  publish();
};

const cancelScheduledPoll = () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (idleHandle != null && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(idleHandle);
  }
  idleHandle = null;
};

const scheduleIdlePoll = (delay = POLL_MS) => {
  if (typeof window === "undefined" || subscribers.size === 0) return;
  cancelScheduledPoll();

  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    if (subscribers.size === 0) return;
    if (document.visibilityState !== "visible" || mapMoving) {
      scheduleIdlePoll(RETRY_BUSY_MS);
      return;
    }

    const run = () => {
      idleHandle = null;
      if (document.visibilityState !== "visible" || mapMoving) {
        scheduleIdlePoll(RETRY_BUSY_MS);
        return;
      }
      poll().finally(() => scheduleIdlePoll(POLL_MS));
    };

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    } else {
      pollTimer = window.setTimeout(() => {
        pollTimer = null;
        run();
      }, 250);
    }
  }, Math.max(0, delay));
};

const onWorldUpdated = (event) => {
  const next = event?.detail?.world;
  if (!next || typeof next !== "object") return;
  sharedState = next;
  if (!overrideState) publish();
};

const onMapMotion = (event) => {
  mapMoving = Boolean(event?.detail?.active);
  if (!mapMoving && subscribers.size > 0 && !pollInFlight) {
    scheduleIdlePoll(POLL_MS);
  }
};

const onVisibilityChange = () => {
  if (document.visibilityState !== "visible" || subscribers.size === 0) return;
  const staleFor = Date.now() - lastPollAt;
  scheduleIdlePoll(staleFor >= 15000 ? 800 : POLL_MS);
};

const installListeners = () => {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("oh:world-updated", onWorldUpdated);
  window.addEventListener("oh:map-motion", onMapMotion);
  document.addEventListener("visibilitychange", onVisibilityChange);
};

const startPolling = () => {
  installListeners();
  if (!sharedState && !pollInFlight) {
    poll().finally(() => scheduleIdlePoll(POLL_MS));
    return;
  }
  scheduleIdlePoll(POLL_MS);
};

const stopPolling = () => {
  cancelScheduledPoll();
};

export function useWorldState() {
  const [state, setState] = useState(() => {
    if (publishedState) return publishedState;
    const current = effectiveState();
    return current ? deriveMapState(current) : deriveMapState({});
  });

  useEffect(() => {
    startPolling();
    const handler = (data) => setState(data);
    subscribers.add(handler);

    if (publishedState) {
      setState(publishedState);
    } else if (effectiveState()) {
      publish({ force: true });
    }

    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  return state;
}
