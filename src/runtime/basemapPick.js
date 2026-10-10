/*! Open Historia — the scenario's maps in a game, and the one a player sees © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a game, Settings → Map lists the scenario's maps (CONTEXT.md, ADR 0007):
// its starting map and every map players may switch to, read from the world
// the way the Map Editor wrote it (Editor/scenarioMaps.js):
//   - the starting map: world.background (a picture or a drawn map, named by
//     its `name`), else the built-in world.basemap; a detailed starting map is
//     world.background.tiled, over the drawn background;
//   - the built-in maps offered: world.allowedBasemaps (null: every one on a
//     real-world scenario, none on a made-up one);
//   - the others: world.ownBasemaps, a detailed one shown `over` another's
//     drawing or the starting map's ("").
//
// Each map has a pick, what a player's choice stores: "" for the starting map,
// STARTING_DRAWN_PICK for the drawn map under a detailed starting map, a
// built-in map's id, or "own:<id>".

import { DEFAULT_BASEMAP_ID, ESRI_BASEMAPS, builtinBasemapChoices, isBuiltinBasemapId, normalizeOwnBasemaps, ownBasemapPick } from "./assets.js";
import { MAP_SETTING_KEYS } from "./mapSettings.js";

export const STARTING_DRAWN_PICK = "start:drawn";
export const STARTING_MAP_FALLBACK_NAME = "Scenario map";
export const DETAILED_MAP_FALLBACK_NAME = "Detailed map";

const builtinName = (id) => ESRI_BASEMAPS.find((basemap) => basemap.id === id)?.label || id;
const OFFICIAL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHECKSUM = /^[a-f0-9]{64}$/;
// The detailed map world.background names (Game/Map/scenarioTerrain.js
// scenarioTiledBasemap reads it the same way).
const startingDetailedOf = (background) => {
  const tiled = background?.kind === "vector" ? background.tiled : null;
  if (!tiled || typeof tiled !== "object") return null;
  if (OFFICIAL_ID.test(String(tiled.id || ""))) {
    const version = Number(tiled.version);
    return { id: String(tiled.id), version: Number.isInteger(version) && version >= 1 ? version : 1 };
  }
  return CHECKSUM.test(String(tiled.hash || "")) ? { hash: String(tiled.hash) } : null;
};

// `world`: { background, basemap, allowedBasemaps, ownBasemaps }, the lists
// as arrays.
export const scenarioMapsOfWorld = ({ background = null, basemap = null, allowedBasemaps = null, ownBasemaps = null } = {}) => {
  const ownMap = Boolean(background?.kind);
  const startingName = String(background?.name || "").trim() || STARTING_MAP_FALLBACK_NAME;
  const detailed = startingDetailedOf(background);
  const maps = [];
  if (detailed) {
    maps.push({ pick: "", kind: "detailed", name: String(background.tiled.name || "").trim() || DETAILED_MAP_FALLBACK_NAME, starting: true, detailed, fillOpacity: background.fillOpacity ?? null, over: STARTING_DRAWN_PICK });
    maps.push({ pick: STARTING_DRAWN_PICK, kind: "vector", name: startingName, starting: false });
  } else if (ownMap) {
    maps.push({ pick: "", kind: background.kind, name: startingName, starting: true });
  } else {
    const id = isBuiltinBasemapId(basemap) ? basemap : DEFAULT_BASEMAP_ID;
    maps.push({ pick: "", kind: "builtin", name: builtinName(id), starting: true, builtinId: id });
  }
  const drawnStarting = background?.kind === "vector";
  for (const entry of normalizeOwnBasemaps(ownBasemaps)) {
    if (entry.kind !== "tiled") {
      maps.push({ pick: ownBasemapPick(entry.id), kind: entry.kind, name: entry.name, starting: false });
      continue;
    }
    if (entry.over === "" && !drawnStarting) continue;
    maps.push({
      pick: ownBasemapPick(entry.id),
      kind: "detailed",
      name: entry.name,
      starting: false,
      detailed: entry.tiled,
      fillOpacity: entry.fillOpacity ?? null,
      over: entry.over ? ownBasemapPick(entry.over) : detailed ? STARTING_DRAWN_PICK : "",
    });
  }
  const startingBuiltin = ownMap ? "" : maps[0].builtinId;
  for (const choice of builtinBasemapChoices(Array.isArray(allowedBasemaps) ? allowedBasemaps : null, { scenarioHasOwnMap: ownMap })) {
    if (choice.id !== startingBuiltin) maps.push({ pick: choice.id, kind: "builtin", name: choice.label, starting: false, builtinId: choice.id });
  }
  return maps;
};

// The map a player sees: the game's own pick (null when the game has none),
// else their default basemap where the scenario offers it and they turned it
// on, else the starting map. A detailed map with detailed maps turned off on
// this device is the drawn map under it. Answers the map's { pick, kind,
// name, builtinId?, detailed, fillOpacity, over } (`detailed` and `over` null
// unless it is a detailed map) and the scenario's other detailed maps, which
// the download offer mentions.
export const basemapShownFor = ({ maps, gamePick = null, defaultBasemap = "", useDefault = false, showDetailed = true }) => {
  const byPick = (pick) => maps.find((map) => map.pick === pick) || null;
  let map = (gamePick != null && byPick(gamePick))
    || (useDefault && isBuiltinBasemapId(defaultBasemap) && byPick(defaultBasemap))
    || maps[0];
  if (map.kind === "detailed" && !showDetailed) map = byPick(map.over) || maps[0];
  return {
    ...map,
    detailed: map.kind === "detailed" ? map.detailed : null,
    fillOpacity: map.kind === "detailed" ? map.fillOpacity : null,
    over: map.kind === "detailed" ? map.over : null,
    otherDetailed: maps.filter((other) => other.kind === "detailed" && other.pick !== map.pick),
  };
};

// ---- where the picks are kept --------------------------------------------
// A game's own pick, on this device (never sent to other players), and the
// player's default basemap for every game, set in the main menu's Settings.
export const GAME_BASEMAP_PICK_PREFIX = "map_basemap_pick:";
export const DEFAULT_BASEMAP_KEY = MAP_SETTING_KEYS.defaultBasemap;
export const DEFAULT_BASEMAP_ON_KEY = MAP_SETTING_KEYS.defaultBasemapOn;
// Before picks were kept per game, one pick applied to every game.
const LEGACY_BASEMAP_KEY = "map_basemap_style";

// `store`: get/set/has/delete, as a Map (localStorageStore below in the game).
export const migrateBasemapSettings = (store) => {
  if (!store.has(LEGACY_BASEMAP_KEY)) return;
  const legacy = store.get(LEGACY_BASEMAP_KEY);
  if (isBuiltinBasemapId(legacy) && !store.has(DEFAULT_BASEMAP_KEY)) {
    store.set(DEFAULT_BASEMAP_KEY, legacy);
    store.set(DEFAULT_BASEMAP_ON_KEY, "1");
  }
  store.delete(LEGACY_BASEMAP_KEY);
};
