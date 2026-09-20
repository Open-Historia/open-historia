/*! Open Historia — the running game's gameplay features © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useSyncExternalStore } from "react";
import {
  idleDiplomacyChancePerMinute as chancePerMinute,
  isFeatureEnabled,
  playerFocusOf,
  resolveFeatures,
  worldDirectionOf,
} from "../../server/gameFeatures.js";

export {
  FEATURE_DEFINITIONS,
  FEATURE_KEYS,
  featureDefaults,
  isFeatureEnabled,
  normalizeFeatureOverrides,
  normalizeFeatureSettings,
  resolveFeatures,
} from "../../server/gameFeatures.js";

// The features of the game being played: the active game's scenario under the
// game's own overrides, resolved by the library whenever its catalog lands
// (library.js syncLibraryRuntime). Everything on until a library says otherwise,
// which is also what the tests and the harness run with.
let activeFeatures = resolveFeatures(null, null);
const listeners = new Set();

export const getActiveFeatures = () => activeFeatures;

export const setActiveFeatures = (scenarioFeatures, gameFeatures) => {
  const next = resolveFeatures(scenarioFeatures, gameFeatures);
  if (JSON.stringify(next) === JSON.stringify(activeFeatures)) return activeFeatures;
  activeFeatures = next;
  for (const listener of listeners) listener();
  return activeFeatures;
};

export const subscribeToActiveFeatures = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useActiveFeatures = () =>
  useSyncExternalStore(subscribeToActiveFeatures, getActiveFeatures, getActiveFeatures);

export const isActiveFeatureEnabled = (key) => isFeatureEnabled(activeFeatures, key);

export const idleDiplomacyChancePerMinute = () => chancePerMinute(activeFeatures);

// The scenario author's settings for how the world is run, or null when world
// direction is off for this game (src/Game/AI/worldDirection.js).
export const getActiveWorldDirection = () => worldDirectionOf(activeFeatures);

// How much of a time skip belongs to the player (src/Game/AI/playerFocus.js):
// the scenario's default under this game's own choice, or null when the feature
// is off and no share is asked for.
export const getActivePlayerFocus = () => playerFocusOf(activeFeatures);
