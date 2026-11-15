/*! Open Historia — what the diplomatic map shows, kept for each game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The diplomatic map's choices: the map mode (political or diplomatic), the
// view (diplomaticViews.js), the Relations view's focus country, the Blocs
// view's institution, what the Government view colours by, and whether the
// legend is open. They are kept for each game, on this device, like a game's
// basemap pick (runtime/basemapPick.js): a game opened again shows the map as
// it was left, and a new game opens on the political map (the owner,
// 2026-10-16). Never sent to the other players of a shared game.
//
// What lasts only while a game is open: the legend entry or war picked out on
// the map, and the country under the pointer.
//
// The live map mode stays the sitting-only setting every map layer reads
// (mapSettings.js MAP_SETTING_KEYS.mapMode); this sets it when a game opens
// and keeps it per game when it changes.

import { normalizeDiplomaticView, normalizeGovernmentAxis } from "./diplomaticViews.js";

export const DIPLOMATIC_SETTINGS_PREFIX = "map_diplomatic:";

export const DEFAULT_DIPLOMATIC_SETTINGS = Object.freeze({
  mode: "political",
  view: "relations",
  focus: "",
  institution: "",
  axis: "regime",
  legendOpen: true,
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

// A stored record as the map reads it; anything unknown falls back.
export const normalizeDiplomaticSettings = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: source.mode === "diplomatic" ? "diplomatic" : "political",
    view: normalizeDiplomaticView(source.view),
    focus: clean(source.focus),
    institution: clean(source.institution),
    axis: normalizeGovernmentAxis(source.axis),
    legendOpen: source.legendOpen !== false,
  };
};

export const diplomaticSettingsKey = (gameId) => `${DIPLOMATIC_SETTINGS_PREFIX}${clean(gameId) || "current"}`;

// `storage`: getItem/setItem, as localStorage (a Map-backed one in the tests).
export const readDiplomaticSettings = (storage, gameId) => {
  try {
    const raw = storage?.getItem?.(diplomaticSettingsKey(gameId));
    return normalizeDiplomaticSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeDiplomaticSettings(null);
  }
};

export const writeDiplomaticSettings = (storage, gameId, settings) => {
  const record = normalizeDiplomaticSettings(settings);
  try {
    storage?.setItem?.(diplomaticSettingsKey(gameId), JSON.stringify(record));
  } catch {
    // Storage that will not be written keeps the choice for this sitting.
  }
  return record;
};

// ---- the live store ---------------------------------------------------------

const browserStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

let state = {
  gameId: "",
  ...DEFAULT_DIPLOMATIC_SETTINGS,
  // Sitting only.
  highlight: null, // { id, colors: [] } of a legend entry
  focusWar: "",
};
const listeners = new Set();
const emit = () => {
  for (const listener of listeners) listener();
};

export const getDiplomaticMapState = () => state;
export const subscribeDiplomaticMapState = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const PERSISTED = ["mode", "view", "focus", "institution", "axis", "legendOpen"];

// Changes what the map shows; what is kept for the game is written at once.
export const setDiplomaticMapState = (patch, { storage = browserStorage() } = {}) => {
  const next = { ...state, ...patch };
  if (PERSISTED.every((key) => next[key] === state[key])
    && next.highlight === state.highlight && next.focusWar === state.focusWar) return state;
  // A highlight belongs to the legend it was picked from.
  if ((patch.view && patch.view !== state.view) || (patch.axis && patch.axis !== state.axis)
    || (patch.institution !== undefined && patch.institution !== state.institution)
    || (patch.focus !== undefined && patch.focus !== state.focus)) {
    if (!("highlight" in patch)) next.highlight = null;
  }
  if (patch.view && patch.view !== "wars" && !("focusWar" in patch)) next.focusWar = "";
  state = next;
  if (PERSISTED.some((key) => patch[key] !== undefined) && state.gameId) {
    writeDiplomaticSettings(storage, state.gameId, state);
  }
  emit();
  return state;
};

// A game opened: its own choices, or the defaults for a game never shown.
export const loadDiplomaticMapStateForGame = (gameId, { storage = browserStorage() } = {}) => {
  const id = clean(gameId);
  if (id === state.gameId) return state;
  state = { ...state, gameId: id, ...readDiplomaticSettings(storage, id), highlight: null, focusWar: "" };
  emit();
  setDiplomaticHover(null);
  return state;
};

// The country under the pointer on the diplomatic map, { owner, x, y } or
// null: a store of its own, so a pointer moving redraws the tooltip alone.
let hover = null;
const hoverListeners = new Set();
export const getDiplomaticHover = () => hover;
export const subscribeDiplomaticHover = (listener) => {
  hoverListeners.add(listener);
  return () => hoverListeners.delete(listener);
};
export const setDiplomaticHover = (next) => {
  if (next === hover || (next && hover && next.owner === hover.owner && next.x === hover.x && next.y === hover.y)) return;
  hover = next;
  for (const listener of hoverListeners) listener();
};
