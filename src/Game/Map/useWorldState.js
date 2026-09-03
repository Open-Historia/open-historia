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

  const prev = prevRef.current;

  // Preserve sub-object referential identity when content has not changed.
  // This prevents consumer useMemos (such as in Nations.jsx) from re-evaluating
  // when an unrelated field (e.g. markers or units) changes.
  const regionOwnershipOverrides =
    prev && areEqualShallow(prev.regionOwnershipOverrides, state?.regionOwnershipOverrides ?? {})
      ? prev.regionOwnershipOverrides
      : state?.regionOwnershipOverrides ?? {};

  const regionClaimants =
    prev && JSON.stringify(prev.regionClaimants) === JSON.stringify(state?.regionClaimants ?? {})
      ? prev.regionClaimants
      : state?.regionClaimants ?? {};

  const polityOverrides =
    prev && areEqualShallow(prev.polityOverrides, state?.polityOverrides ?? {})
      ? prev.polityOverrides
      : state?.polityOverrides ?? {};

  const markers =
    prev && JSON.stringify(prev.markers) === JSON.stringify(state?.markers ?? EMPTY_MARKERS)
      ? prev.markers
      : Array.isArray(state?.markers) ? state.markers : EMPTY_MARKERS;

  const cityRenames =
    prev && JSON.stringify(prev.cityRenames) === JSON.stringify(state?.cityRenames ?? {})
      ? prev.cityRenames
      : state?.cityRenames ?? {};

  // AI population overrides (main) — same content-compare, same identity rule.
  const cityPopulations =
    prev && JSON.stringify(prev.cityPopulations) === JSON.stringify(state?.cityPopulations ?? {})
      ? prev.cityPopulations
      : state?.cityPopulations ?? {};

  const derived = {
    worldState: state,
    worldKnown: Boolean(state && Object.keys(state).length > 0),
    customRegions: Boolean(state?.customRegions),
    customGeometry: Boolean(
      state?.customGeometry ??
      Object.keys(regionOwnershipOverrides).some((id) => !String(id).includes(".")),
    ),
    customCities: Boolean(state?.customCities),
    basemap: state?.basemap || null,
    background: state?.background ?? null,
    regionOwnershipOverrides,
    regionClaimants,
    polityOverrides,
    markers,
    cityRenames,
    cityPopulations,
    labelFont: state?.labelFont ?? "",
    labelHaloColor: state?.labelHaloColor ?? "",
    labelTextColor: state?.labelTextColor ?? "",
  };

  const output =
    prev &&
    prev.worldKnown === derived.worldKnown &&
    prev.customRegions === derived.customRegions &&
    prev.customGeometry === derived.customGeometry &&
    prev.customCities === derived.customCities &&
    prev.basemap === derived.basemap &&
    prev.background === derived.background &&
    prev.labelFont === derived.labelFont &&
    prev.labelHaloColor === derived.labelHaloColor &&
    prev.labelTextColor === derived.labelTextColor &&
    prev.regionOwnershipOverrides === derived.regionOwnershipOverrides &&
    prev.regionClaimants === derived.regionClaimants &&
    prev.markers === derived.markers &&
    prev.cityRenames === derived.cityRenames &&
    prev.cityPopulations === derived.cityPopulations &&
    prev.polityOverrides === derived.polityOverrides
      ? prev
      : derived;

  useLayoutEffect(() => {
    prevRef.current = output;
  }, [output]);

  return output;
}

export function useWorldMarkers() {
  const [markers, setMarkers] = useState(() => {
    const s = effectiveState();
    return Array.isArray(s?.markers) ? s.markers : EMPTY_MARKERS;
  });
  const prevRef = useRef(markers);

  useEffect(() => {
    startPolling();
    const handler = (data) => {
      const next = Array.isArray(data?.markers) ? data.markers : EMPTY_MARKERS;
      if (JSON.stringify(prevRef.current) !== JSON.stringify(next)) {
        prevRef.current = next;
        setMarkers(next);
      }
    };
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  return markers;
}

export function useWorldCities() {
  const [citiesState, setCitiesState] = useState(() => {
    const s = effectiveState();
    return {
      customCities: Boolean(s?.customCities),
      cityRenames: s?.cityRenames ?? {},
      cityPopulations: s?.cityPopulations ?? {},
    };
  });
  const prevRef = useRef(citiesState);

  useEffect(() => {
    startPolling();
    const handler = (data) => {
      const customCities = Boolean(data?.customCities);
      const cityRenames = data?.cityRenames ?? {};
      const cityPopulations = data?.cityPopulations ?? {};
      const prev = prevRef.current;
      if (
        prev.customCities !== customCities ||
        JSON.stringify(prev.cityRenames) !== JSON.stringify(cityRenames) ||
        JSON.stringify(prev.cityPopulations) !== JSON.stringify(cityPopulations)
      ) {
        const next = { customCities, cityRenames, cityPopulations };
        prevRef.current = next;
        setCitiesState(next);
      }
    };
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  return citiesState;
}

export function useWorldBackground() {
  const [bgState, setBgState] = useState(() => {
    const s = effectiveState();
    return {
      background: s?.background ?? null,
      basemap: s?.basemap || null,
    };
  });
  const prevRef = useRef(bgState);

  useEffect(() => {
    startPolling();
    const handler = (data) => {
      const background = data?.background ?? null;
      const basemap = data?.basemap || null;
      const prev = prevRef.current;
      const bgSame =
        prev.background === background ||
        JSON.stringify(prev.background) === JSON.stringify(background);
      if (!bgSame || prev.basemap !== basemap) {
        const next = { background, basemap };
        prevRef.current = next;
        setBgState(next);
      }
    };
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  return bgState;
}
