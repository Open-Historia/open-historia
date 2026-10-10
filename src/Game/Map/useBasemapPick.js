/*! Open Historia — the basemap pick of the game on screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A player's basemap pick is kept for each game, on this device, and never sent
// to the other players of a shared game; their default basemap, set in the main
// menu's Settings, applies to every game that has no pick of its own and offers
// that map (runtime/basemapPick.js basemapShownFor).
import { useCallback } from "react";
import {
  DEFAULT_BASEMAP_KEY,
  DEFAULT_BASEMAP_ON_KEY,
  GAME_BASEMAP_PICK_PREFIX,
  migrateBasemapSettings,
} from "../../runtime/basemapPick.js";
import { MAP_SETTING_KEYS, setMapSettingValue, useMapSetting, useMapSettingValue } from "../../runtime/mapSettings.js";
import { useLibraryState } from "../../runtime/library.js";
import { SCENARIO_TERRAIN_PAINTED } from "./scenarioTerrain.js";

// A stored value can't be empty (an empty setting is removed), so the game's
// choice of its starting map is kept as this.
const STARTING_PICK_STORED = "start";

// Once, before any pick is read: the one pick every game shared becomes the
// default basemap.
const localStorageStore = {
  has: (key) => localStorage.getItem(key) !== null,
  get: (key) => localStorage.getItem(key),
  set: (key, value) => localStorage.setItem(key, value),
  delete: (key) => localStorage.removeItem(key),
};
try {
  if (typeof localStorage !== "undefined") migrateBasemapSettings(localStorageStore);
} catch {
  // Storage that will not be read keeps the shipped defaults.
}

export const gameBasemapPickKey = (gameId) => `${GAME_BASEMAP_PICK_PREFIX}${gameId || "current"}`;

export function useGameBasemapPick() {
  const { activeGame } = useLibraryState();
  const key = gameBasemapPickKey(String(activeGame?.id || ""));
  const stored = useMapSettingValue(key, "");
  const gamePick = stored === "" ? null : stored === STARTING_PICK_STORED ? "" : stored;
  const setGamePick = useCallback((pick) => setMapSettingValue(key, pick === "" ? STARTING_PICK_STORED : pick), [key]);
  const defaultBasemap = useMapSettingValue(DEFAULT_BASEMAP_KEY, "");
  const useDefault = useMapSetting(DEFAULT_BASEMAP_ON_KEY);
  const showDetailed = useMapSettingValue(MAP_SETTING_KEYS.scenarioTerrain) !== SCENARIO_TERRAIN_PAINTED;
  return { gamePick, setGamePick, defaultBasemap, useDefault, showDetailed };
}
