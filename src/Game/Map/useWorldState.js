import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";

// Singleton: all consumers share one poll interval and one set of results,
// eliminating the 4 redundant world.json requests the app used to fire.

const POLL_MS = 5000;
let sharedState = null;
let pollTimer = null;
const subscribers = new Set();

const poll = async () => {
  try {
    sharedState = await readJson(JSON_URLS.world, { defaultValue: {}, force: true });
  } catch {
    sharedState = {};
  }
  for (const fn of subscribers) fn(sharedState);
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
  const [state, setState] = useState(() => sharedState || {});
  const prevRef = useRef(null);

  useEffect(() => {
    startPolling();
    const handler = (data) => setState(data);
    subscribers.add(handler);
    if (sharedState) setState(sharedState);
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
    polityOverrides: state?.polityOverrides ?? {},
  };

  const prev = prevRef.current;
  const output =
    prev &&
    prev.worldKnown === derived.worldKnown &&
    prev.customRegions === derived.customRegions &&
    prev.customCities === derived.customCities &&
    prev.basemap === derived.basemap &&
    prev.background === derived.background &&
    areEqualShallow(prev.regionOwnershipOverrides, derived.regionOwnershipOverrides) &&
    areEqualShallow(prev.polityOverrides, derived.polityOverrides)
      ? prev
      : derived;

  useLayoutEffect(() => {
    prevRef.current = output;
  }, [output]);

  return output;
}
