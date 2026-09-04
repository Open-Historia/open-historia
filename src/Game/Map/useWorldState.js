import { useEffect, useState } from "react";
import { JSON_URLS, readJson, reportPerfOperation } from "../../runtime/assets.js";
import { recordMapTrace, recordMapWork } from "../../runtime/mapPerfTrace.js";
import { buildOwnerAliasMap, createOwnerResolver } from "../../runtime/ownerNames.js";

// Map-facing world store — R5.0 event-driven edition.
//
// Canonical same-tab writes already dispatch `oh:world-updated`. The previous
// 90-second "safety" poll force-fetched + parsed world.json on the renderer
// thread and could interrupt otherwise idle map interaction. Bootstrap once from
// the already-warmed asset cache, then update only when canonical state changes.

const EMPTY_OBJECT = Object.freeze({});
const EMPTY_MARKERS = Object.freeze([]);

let sharedState = null;
let publishedState = null;
let listenersInstalled = false;
let bootstrapPromise = null;
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
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!areEqualStructured(a[index], b[index])) return false;
    }
    return true;
  }

  if (typeof a === "object") {
    if (Array.isArray(b)) return false;
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!areEqualStructured(a[key], b[key])) return false;
    }
    return true;
  }

  return Object.is(a, b);
};

// The renderer keys colours, surfaces and labels by owner token. A save from
// before owner folding, or one written by a build without it, can hold a
// polity's regions under both its token ("Russia") and its display name
// ("Russian Federation"); gameState.normalizeWorldState folds those on read,
// but the map store reads the raw world, so the map painted and labelled two
// polities. Fold the same way here. The objects are rebuilt only when a token
// actually changes, so the store's reference comparisons stay meaningful.
export const foldOwnerTokens = (state) => {
  const overrides = state?.regionOwnershipOverrides;
  const claimants = state?.regionClaimants;
  const polityOverrides = state?.polityOverrides;
  if (!polityOverrides || typeof polityOverrides !== "object") {
    return { overrides: overrides ?? EMPTY_OBJECT, claimants: claimants ?? EMPTY_OBJECT };
  }
  const aliasMap = buildOwnerAliasMap(polityOverrides);
  if (!aliasMap.size) {
    return { overrides: overrides ?? EMPTY_OBJECT, claimants: claimants ?? EMPTY_OBJECT };
  }
  const resolve = createOwnerResolver(aliasMap);

  let foldedOverrides = overrides ?? EMPTY_OBJECT;
  if (overrides && typeof overrides === "object") {
    let changed = false;
    const next = {};
    for (const [regionId, owner] of Object.entries(overrides)) {
      const folded = resolve(owner) || owner;
      if (folded !== owner) changed = true;
      next[regionId] = folded;
    }
    if (changed) foldedOverrides = next;
  }

  let foldedClaimants = claimants ?? EMPTY_OBJECT;
  if (claimants && typeof claimants === "object") {
    let changed = false;
    const next = {};
    for (const [regionId, names] of Object.entries(claimants)) {
      if (!Array.isArray(names)) {
        next[regionId] = names;
        continue;
      }
      const folded = names.map((name) => resolve(name) || name);
      if (folded.some((name, index) => name !== names[index])) {
        changed = true;
        next[regionId] = folded;
      } else {
        next[regionId] = names;
      }
    }
    if (changed) foldedClaimants = next;
  }

  return { overrides: foldedOverrides, claimants: foldedClaimants };
};

const deriveMapState = (state) => ({
  worldState: state,
  worldKnown: Boolean(state && Object.keys(state).length > 0),
  customRegions: Boolean(state?.customRegions),
  customGeometry: Boolean(
    state?.customGeometry ??
    Object.keys(state?.regionOwnershipOverrides ?? EMPTY_OBJECT).some((id) => !String(id).includes(".")),
  ),
  customCities: Boolean(state?.customCities),
  basemap: state?.basemap || null,
  background: state?.background ?? null,
  ...(() => {
    const folded = foldOwnerTokens(state);
    return { regionOwnershipOverrides: folded.overrides, regionClaimants: folded.claimants };
  })(),
  polityOverrides: state?.polityOverrides ?? EMPTY_OBJECT,
  markers: Array.isArray(state?.markers) ? state.markers : EMPTY_MARKERS,
  cityRenames: state?.cityRenames ?? EMPTY_OBJECT,
  cityPopulations: state?.cityPopulations ?? EMPTY_OBJECT,
  labelFont: state?.labelFont ?? "",
  labelHaloColor: state?.labelHaloColor ?? "",
  labelTextColor: state?.labelTextColor ?? "",
});

const sameMapState = (prev, next) =>
  Boolean(prev) &&
  prev.worldKnown === next.worldKnown &&
  prev.customRegions === next.customRegions &&
  prev.customGeometry === next.customGeometry &&
  prev.customCities === next.customCities &&
  prev.basemap === next.basemap &&
  prev.background === next.background &&
  prev.labelFont === next.labelFont &&
  prev.labelHaloColor === next.labelHaloColor &&
  prev.labelTextColor === next.labelTextColor &&
  prev.regionOwnershipOverrides === next.regionOwnershipOverrides &&
  prev.regionClaimants === next.regionClaimants &&
  prev.markers === next.markers &&
  prev.cityRenames === next.cityRenames &&
  prev.cityPopulations === next.cityPopulations &&
  prev.polityOverrides === next.polityOverrides;

const stabilizeMapStateReferences = (prev, next) => {
  if (!prev) return next;
  return {
    ...next,
    background: areEqualStructured(prev.background, next.background)
      ? prev.background
      : next.background,
    regionOwnershipOverrides: areEqualShallow(
      prev.regionOwnershipOverrides,
      next.regionOwnershipOverrides,
    )
      ? prev.regionOwnershipOverrides
      : next.regionOwnershipOverrides,
    regionClaimants: areEqualStructured(prev.regionClaimants, next.regionClaimants)
      ? prev.regionClaimants
      : next.regionClaimants,
    polityOverrides: areEqualStructured(prev.polityOverrides, next.polityOverrides)
      ? prev.polityOverrides
      : next.polityOverrides,
    markers: areEqualStructured(prev.markers, next.markers)
      ? prev.markers
      : next.markers,
    cityRenames: areEqualStructured(prev.cityRenames, next.cityRenames)
      ? prev.cityRenames
      : next.cityRenames,
    cityPopulations: areEqualStructured(prev.cityPopulations, next.cityPopulations)
      ? prev.cityPopulations
      : next.cityPopulations,
  };
};

const publish = ({ force = false } = {}) => {
  const state = effectiveState();
  if (!state) return;
  const rawNext = deriveMapState(state);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const next = force
    ? rawNext
    : stabilizeMapStateReferences(publishedState, rawNext);
  const unchanged = !force && sameMapState(publishedState, next);
  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
  reportPerfOperation("compare map-facing world slices", elapsed, { warnAt: 25 });
  recordMapWork("useWorldState:compare", elapsed, { force, subscribers: subscribers.size });
  if (unchanged) {
    recordMapTrace("world-store:no-op", { force, subscribers: subscribers.size });
    return;
  }

  publishedState = next;
  recordMapTrace("world-store:publish", {
    force,
    subscribers: subscribers.size,
    override: Boolean(overrideState),
    markers: next.markers?.length ?? 0,
  });
  for (const fn of subscribers) fn(next);
};

export const getWorldStateSnapshot = () => effectiveState();

export const setWorldStateOverride = (next) => {
  overrideState = next && typeof next === "object" ? next : null;
  recordMapTrace("world-store:override", { active: Boolean(overrideState) });
  publish();
};

const bootstrap = async () => {
  if (sharedState) return sharedState;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = readJson(JSON_URLS.world, {
    defaultValue: {},
    force: false,
    clone: false,
  })
    .then((world) => {
      sharedState = world && typeof world === "object" ? world : {};
      publish();
      return sharedState;
    })
    .catch(() => {
      if (!sharedState) sharedState = {};
      publish();
      return sharedState;
    })
    .finally(() => {
      bootstrapPromise = null;
    });
  return bootstrapPromise;
};

const onWorldUpdated = (event) => {
  const next = event?.detail?.world;
  if (!next || typeof next !== "object") return;
  sharedState = next;
  recordMapTrace("world-store:canonical-update", {
    override: Boolean(overrideState),
    storylines: Array.isArray(next.storylines) ? next.storylines.length : 0,
    markers: Array.isArray(next.markers) ? next.markers.length : 0,
  });
  if (!overrideState) publish();
};

// Another save became active (library.js). Everything held here belongs to the
// previous save: drop it and bootstrap again from the new save's world.json,
// which JSON_URLS.world already points at. The override is dropped too - a
// reveal staged from the old save must not be painted over the new one.
const onActiveGameChanged = () => {
  sharedState = null;
  overrideState = null;
  publishedState = null;
  bootstrapPromise = null;
  recordMapTrace("world-store:game-switch", { subscribers: subscribers.size });
  void bootstrap();
};

const installListeners = () => {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("oh:world-updated", onWorldUpdated);
  window.addEventListener("oh:active-game-changed", onActiveGameChanged);
};

export function useWorldState() {
  const [state, setState] = useState(() => {
    if (publishedState) return publishedState;
    const current = effectiveState();
    return current ? deriveMapState(current) : deriveMapState({});
  });

  useEffect(() => {
    installListeners();
    const handler = (data) => setState(data);
    subscribers.add(handler);

    if (publishedState) {
      setState(publishedState);
    } else if (effectiveState()) {
      publish({ force: true });
    } else {
      void bootstrap();
    }

    return () => {
      subscribers.delete(handler);
    };
  }, []);

  return state;
}

export function useWorldBackground() {
  const [state, setState] = useState(() => {
    const current =
      publishedState ??
      (effectiveState() ? deriveMapState(effectiveState()) : null);

    return {
      background: current?.background ?? null,
      basemap: current?.basemap || null,
    };
  });

  useEffect(() => {
    installListeners();

    const handler = (data) => {
      const background = data?.background ?? null;
      const basemap = data?.basemap || null;

      setState((prev) => {
        const backgroundSame =
          prev.background === background ||
          areEqualStructured(prev.background, background);

        if (backgroundSame && prev.basemap === basemap) {
          return prev;
        }

        return { background, basemap };
      });
    };

    subscribers.add(handler);

    if (publishedState) {
      handler(publishedState);
    } else if (effectiveState()) {
      publish({ force: true });
    } else {
      void bootstrap();
    }

    return () => {
      subscribers.delete(handler);
    };
  }, []);

  return state;
}
