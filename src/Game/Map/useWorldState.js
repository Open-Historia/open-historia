import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";

// Singleton: all consumers share one poll interval and one set of results,
// eliminating the 4 redundant world.json requests the app used to fire.

const POLL_MS = 5000;
let sharedState = null;
let pollTimer = null;
const subscribers = new Set();

// Visual override for the staged event reveal (see time.jsx): while a turn's
// events are revealed one by one, the map renders the world as of the last
// revealed event instead of the final post-jump state. The poll keeps running
// underneath — world.json stays authoritative — and clearing the override
// (null) snaps consumers back to the live state.
let overrideState = null;

const effectiveState = () => overrideState ?? sharedState;

// The state the map is currently rendering (override during a staged reveal,
// else the live polled world). Read-only peer of unitsController.getUnits.
export const getWorldStateSnapshot = () => effectiveState();

export const setWorldStateOverride = (next) => {
  overrideState = next && typeof next === "object" ? next : null;
  const state = effectiveState();
  if (state) for (const fn of subscribers) fn(state);
};

const poll = async () => {
  try {
    sharedState = await readJson(JSON_URLS.world, { defaultValue: {}, force: true });
  } catch {
    sharedState = {};
  }
  for (const fn of subscribers) fn(effectiveState());
};

const startPolling = () => {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, POLL_MS);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

// Stable [] so a world with no markers doesn't churn the memo every poll.
const EMPTY_MARKERS = [];

const areEqualShallow = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (a[keysA[i]] !== b[keysA[i]]) return false;
  }
  return true;
};

export function useWorldState() {
  const [state, setState] = useState(() => effectiveState() || {});
  const prevRef = useRef(null);

  useEffect(() => {
    startPolling();
    const handler = (data) => setState(data);
    subscribers.add(handler);
    if (effectiveState()) setState(effectiveState());
    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  const derived = {
    worldState: state,
    worldKnown: Boolean(state && Object.keys(state).length > 0),
    customRegions: Boolean(state?.customRegions),
    customCities: Boolean(state?.customCities),
    basemap: state?.basemap || null,
    background: state?.background ?? null,
    regionOwnershipOverrides: state?.regionOwnershipOverrides ?? {},
    regionClaimants: state?.regionClaimants ?? {},
    polityOverrides: state?.polityOverrides ?? {},
    markers: Array.isArray(state?.markers) ? state.markers : EMPTY_MARKERS,
    cityRenames: state?.cityRenames ?? {},
    labelFont: state?.labelFont ?? "",
    labelHaloColor: state?.labelHaloColor ?? "",
    labelTextColor: state?.labelTextColor ?? "",
  };

  const prev = prevRef.current;
  const output =
    prev &&
    prev.worldKnown === derived.worldKnown &&
    prev.customRegions === derived.customRegions &&
    prev.customCities === derived.customCities &&
    prev.basemap === derived.basemap &&
    prev.background === derived.background &&
    prev.labelFont === derived.labelFont &&
    prev.labelHaloColor === derived.labelHaloColor &&
    prev.labelTextColor === derived.labelTextColor &&
    areEqualShallow(prev.regionOwnershipOverrides, derived.regionOwnershipOverrides) &&
    // Claimant values are ARRAYS (fresh objects every poll), so reference
    // equality would churn every 5s — compare content. The map is tiny.
    JSON.stringify(prev.regionClaimants) === JSON.stringify(derived.regionClaimants) &&
    // Markers are an array of small objects; same content-compare reasoning.
    JSON.stringify(prev.markers) === JSON.stringify(derived.markers) &&
    JSON.stringify(prev.cityRenames) === JSON.stringify(derived.cityRenames) &&
    areEqualShallow(prev.polityOverrides, derived.polityOverrides)
      ? prev
      : derived;

  useLayoutEffect(() => {
    prevRef.current = output;
  }, [output]);

  return output;
}
