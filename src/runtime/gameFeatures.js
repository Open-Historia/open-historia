/*! Open Historia — the running game's gameplay features © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useSyncExternalStore } from "react";
import { setPuppetStatesEnabled } from "./puppets.js";
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
  normalizeScriptedEvents,
  SCRIPTED_EVENT_CONDITION_OPERATORS,
  SCRIPTED_EVENT_CONDITION_TYPES,
  SCRIPTED_EVENT_TRIGGER_MODES,
  resolveFeatures,
} from "../../server/gameFeatures.js";

// The features of the game being played: the active game's scenario under the
// game's own overrides, resolved by the library whenever its catalog lands
// (library.js syncLibraryRuntime). Everything on until a library says otherwise,
// which is also what the tests and the harness run with.
let activeFeatures = resolveFeatures(null, null);
const listeners = new Set();

// runtime/puppets.js is deliberately import-free, so the one feature that
// decides whether a whole ledger exists at all is pushed into it from here —
// the single place resolved features land. Done on load as well as on every
// change, so a surface that reads the ledger before a library syncs is already
// answering with this game's setting rather than the built-in default.
const publishFeatures = () => {
  setPuppetStatesEnabled(isFeatureEnabled(activeFeatures, "puppetStates"));
};
publishFeatures();

export const getActiveFeatures = () => activeFeatures;

export const setActiveFeatures = (scenarioFeatures, gameFeatures) => {
  const next = resolveFeatures(scenarioFeatures, gameFeatures);
  if (JSON.stringify(next) === JSON.stringify(activeFeatures)) return activeFeatures;
  activeFeatures = next;
  publishFeatures();
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
// the scenario's default under this game's own choice. Always a level.
export const getActivePlayerFocus = () => playerFocusOf(activeFeatures);
