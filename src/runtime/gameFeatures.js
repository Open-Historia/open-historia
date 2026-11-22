/*! Open Historia — the running game's gameplay features © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useSyncExternalStore } from "react";
import {
  idleDiplomacyChancePerMinute as chancePerMinute,
  isFeatureEnabled,
  playerFocusOf,
  resolveFeatures,
  rostraLookOf,
  transportMediaOf,
  warsOf,
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
  ROSTRA_LOOKS,
  rostraLookOf,
  transportMediaOf,
  warsOf,
} from "../../server/gameFeatures.js";

// The features of the game being played: the active game's scenario under the
// game's own overrides, resolved by the library whenever its catalog lands
// (library.js syncLibraryRuntime). Everything on until a library says otherwise,
// which is also what the tests and the harness run with.
//
// In a shared game they are the host's, stated in its lobby
// (multiplayer/client/sharedGame.js): a guest's screen plays on its own copy of
// the scenario, which may switch them otherwise, and its tabs and buttons
// followed that copy (a Spy tab, a War Room or Rostra the host's game has off,
// whose every request the host then refused). The library's are kept beneath
// and come back when the shared game ends.
let libraryFeatures = resolveFeatures(null, null);
let sharedFeatures = null;
const listeners = new Set();
const current = () => sharedFeatures ?? libraryFeatures;
const tell = (before) => {
  if (current() === before) return;
  for (const listener of listeners) listener();
};
export const getActiveFeatures = () => current();
export const setActiveFeatures = (scenarioFeatures, gameFeatures) => {
  const next = resolveFeatures(scenarioFeatures, gameFeatures);
  if (JSON.stringify(next) === JSON.stringify(libraryFeatures)) return current();
  const before = current();
  libraryFeatures = next;
  tell(before);
  return current();
};
// What of a game's features its players' screens play by, as a shared game's
// host states them (multiplayer/host/engineMain.js): every switch and what
// screens draw by, without the narrator's own settings (world direction's
// priority rules and scripted events, the scenario author's plot).
export const sharedGameFeaturesOf = (features) => {
  const out = JSON.parse(JSON.stringify(features && typeof features === "object" ? features : {}));
  if (out.worldDirection && typeof out.worldDirection === "object") out.worldDirection = { enabled: out.worldDirection.enabled !== false };
  return out;
};

// The host's features, resolved as it resolved them; null when the shared
// game ends.
export const setSharedGameFeatures = (features) => {
  const next = features && typeof features === "object" ? resolveFeatures(features, null) : null;
  if (JSON.stringify(next) === JSON.stringify(sharedFeatures)) return current();
  const before = current();
  sharedFeatures = next;
  tell(before);
  return current();
};

export const subscribeToActiveFeatures = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useActiveFeatures = () =>
  useSyncExternalStore(subscribeToActiveFeatures, getActiveFeatures, getActiveFeatures);

export const isActiveFeatureEnabled = (key) => isFeatureEnabled(current(), key);

export const idleDiplomacyChancePerMinute = () => chancePerMinute(current());

// The scenario author's settings for how the world is run, or null when world
// direction is off for this game (src/Game/AI/worldDirection.js).
export const getActiveWorldDirection = () => worldDirectionOf(current());

// How much of a time skip belongs to the player (src/Game/AI/playerFocus.js):
// the scenario's default under this game's own choice. Always a level.
export const getActivePlayerFocus = () => playerFocusOf(current());

// What of its wars this game fights itself: { battlefields, air, navies } (the Wars feature).
export const activeWars = () => warsOf(current());

// What may carry troops in this game: "sea", "land" and "air", less what the Wars feature switched off.
export const activeTransportMedia = () => transportMediaOf(current());

// How Rostra is drawn in this game: "phone", "newspaper", "scroll" or "tablet" (the Social media feature).
export const useRostraLook = () => rostraLookOf(useActiveFeatures());
