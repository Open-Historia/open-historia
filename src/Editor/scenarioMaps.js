/*! Open Historia — the scenario's maps in the Map Editor © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario offers one list of maps (CONTEXT.md, docs/adr/0007): its starting
// map and the ones players may switch to, built-in maps, the author's own
// basemaps and detailed maps alike. The document keeps them where they always
// were, so a scenario saved now still opens on its starting map in an older
// game:
//   - the starting map: doc.metadata.customBackground (a picture or a drawn
//     map), else the built-in doc.metadata.basemap; a detailed starting map is
//     doc.metadata.tiledBasemap, shown over the drawn customBackground;
//     doc.metadata.startingMapName names it;
//   - the built-in maps players may switch to: doc.metadata.allowedBasemaps
//     (null: all of them on a real-world scenario, none on a made-up one);
//   - the others: doc.metadata.ownBasemaps (ownBasemaps.js), a detailed one
//     shown `over` another of them, or "" for the starting map's drawing.
//
// Each map in the list has a key: "start" (the starting map), "start:drawn"
// (the drawn map under a detailed starting map), "builtin:<id>", "own:<id>".
// The operations answer { patch } for d.patchMetadata, or { refused } with
// the reason to show the author.

import { DEFAULT_BASEMAP_ID, ESRI_BASEMAPS, builtinBasemapChoices } from "../runtime/assets.js";
import { STARTING_DRAWN_PICK } from "../runtime/basemapPick.js";
import { editorBasemapById } from "./basemaps.js";
import { normalizeEditorOwnBasemaps } from "./ownBasemaps.js";
import { DETAILED_MAP_PROJECTION_MESSAGE, detailedMapFits } from "./projectionConvert.js";
import { DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE } from "./exportPreset.js";

export const STARTING_MAP_KEY = "start";
export const STARTING_DRAWN_KEY = STARTING_DRAWN_PICK; // the same key in the game (runtime/basemapPick.js)
const BUILTIN = "builtin:";
const OWN = "own:";

const builtinName = (id) => ESRI_BASEMAPS.find((basemap) => basemap.id === id)?.label || editorBasemapById(id)?.label || id;
const isDrawn = (background) => background?.kind === "vector" && Array.isArray(background.geojson?.features);
const startingBackgroundOf = (metadata) => {
  const background = metadata?.customBackground;
  return background && typeof background === "object" && background.kind ? background : null;
};
const startingDetailedOf = (metadata) => {
  const tiled = metadata?.tiledBasemap;
  return tiled && (tiled.id || tiled.hash) && isDrawn(startingBackgroundOf(metadata)) ? tiled : null;
};
const startingNameOf = (metadata, scenarioName) => String(metadata?.startingMapName || "").trim()
  || (String(scenarioName || "").trim() ? `${String(scenarioName).trim()} map` : "Scenario map");
const detailedNameOf = (tiled) => String(tiled?.name || "").trim() || "Detailed map";

// The built-in maps offered beside the starting map, as ids.
const offeredBuiltinIds = (metadata) => builtinBasemapChoices(
  Array.isArray(metadata?.allowedBasemaps) ? metadata.allowedBasemaps : null,
  { scenarioHasOwnMap: Boolean(startingBackgroundOf(metadata)) },
).map((basemap) => basemap.id);

// What "allowedBasemaps" to save for a set of offered built-in maps: null when
// that is what null already means (every one, on a real-world scenario).
const allowedFor = (ids, { ownMap, startingBuiltin }) => {
  const offered = ESRI_BASEMAPS.map((basemap) => basemap.id).filter((id) => ids.includes(id) && id !== startingBuiltin);
  const every = ESRI_BASEMAPS.every((basemap) => basemap.id === startingBuiltin || offered.includes(basemap.id));
  return !ownMap && every ? null : offered;
};

// The detailed map as the document names it: an official map by id and
// version, the author's own by checksum.
const namingOf = (detailed) => (detailed?.id ? { id: detailed.id, version: detailed.version } : detailed?.hash ? { hash: detailed.hash } : null);
const sameNaming = (a, b) => Boolean(a && b) && (a.id ? a.id === b.id : Boolean(a.hash) && a.hash === b.hash);

export const scenarioMaps = (metadata, { scenarioName = "" } = {}) => {
  const background = startingBackgroundOf(metadata);
  const tiled = startingDetailedOf(metadata);
  const own = normalizeEditorOwnBasemaps(metadata?.ownBasemaps);
  const startingDrawnKey = tiled ? STARTING_DRAWN_KEY : STARTING_MAP_KEY;
  const overKey = (over) => (over ? `${OWN}${over}` : startingDrawnKey);
  const maps = [];
  if (tiled) {
    maps.push({ key: STARTING_MAP_KEY, kind: "detailed", name: detailedNameOf(tiled), starting: true, detailed: namingOf(tiled), over: STARTING_DRAWN_KEY });
    maps.push({ key: STARTING_DRAWN_KEY, kind: "vector", name: startingNameOf(metadata, scenarioName), starting: false, background });
  } else if (background) {
    maps.push({ key: STARTING_MAP_KEY, kind: background.kind, name: startingNameOf(metadata, scenarioName), starting: true, background });
  } else {
    const id = metadata?.basemap || DEFAULT_BASEMAP_ID;
    maps.push({ key: STARTING_MAP_KEY, kind: "builtin", name: builtinName(id), starting: true, builtinId: id });
  }
  for (const entry of own) {
    maps.push(entry.detailed
      ? { key: `${OWN}${entry.id}`, kind: "detailed", name: entry.name, starting: false, detailed: entry.detailed, over: overKey(entry.over) }
      : { key: `${OWN}${entry.id}`, kind: entry.background.kind, name: entry.name, starting: false, background: entry.background });
  }
  const startingBuiltin = background ? "" : metadata?.basemap || DEFAULT_BASEMAP_ID;
  for (const id of offeredBuiltinIds(metadata)) {
    if (id !== startingBuiltin) maps.push({ key: `${BUILTIN}${id}`, kind: "builtin", name: builtinName(id), starting: false, builtinId: id });
  }
  return maps;
};

// ---- editing --------------------------------------------------------------
// The document's map fields, read once, changed, and written back whole.
const stateOf = (metadata) => ({
  basemap: metadata?.basemap || DEFAULT_BASEMAP_ID,
  customBackground: startingBackgroundOf(metadata),
  tiledBasemap: startingDetailedOf(metadata),
  startingMapName: String(metadata?.startingMapName || "").trim() || null,
  builtin: offeredBuiltinIds(metadata),
  own: normalizeEditorOwnBasemaps(metadata?.ownBasemaps),
});
const patchOf = (state) => ({
  patch: {
    basemap: state.basemap,
    customBackground: state.customBackground,
    tiledBasemap: state.tiledBasemap,
    startingMapName: state.startingMapName,
    allowedBasemaps: allowedFor(state.builtin, { ownMap: Boolean(state.customBackground), startingBuiltin: state.customBackground ? "" : state.basemap }),
    ownBasemaps: state.own.length ? state.own : null,
  },
});
const refused = (reason) => ({ refused: reason });

// A fresh id for a map moved into ownBasemaps, from its name.
const freshId = (state, name) => {
  const base = String(name || "map").toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "map";
  const taken = new Set(state.own.map((entry) => entry.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
};
const repoint = (state, from, to) => {
  state.own = state.own.map((entry) => (entry.detailed && (entry.over || "") === from ? { ...entry, over: to } : entry));
};
// Where a detailed map can be shown: the starting map's drawing, else the
// first drawn map in the list ("" for the starting one).
const firstDrawn = (state, { except = null } = {}) => {
  if (except !== "" && isDrawn(state.customBackground)) return "";
  return state.own.find((entry) => entry.id !== except && isDrawn(entry.background))?.id ?? null;
};

export const addBuiltinMap = (metadata, id) => {
  const state = stateOf(metadata);
  if (!ESRI_BASEMAPS.some((basemap) => basemap.id === id)) return refused("That is not one of the built-in maps.");
  if (!state.builtin.includes(id)) state.builtin = [...state.builtin, id];
  return patchOf(state);
};

// `entry`: { id, name, background } (ownBasemapFromLibrary), or a detailed
// map { id, name, detailed: { id, version } | { hash }, fillOpacity? }.
export const addOwnMap = (metadata, entry) => {
  const state = stateOf(metadata);
  if (entry?.detailed) {
    if (!detailedMapFits(metadata?.projection)) return refused(DETAILED_MAP_PROJECTION_MESSAGE);
    const named = namingOf(entry.detailed);
    if (sameNaming(named, state.tiledBasemap) || state.own.some((own) => sameNaming(named, own.detailed))) return patchOf(state);
    const over = firstDrawn(state);
    if (over === null) return refused(DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE);
    const id = state.own.some((own) => own.id === entry.id) ? freshId(state, entry.name) : entry.id;
    state.own = normalizeEditorOwnBasemaps([...state.own, { ...entry, id, over }]);
    return patchOf(state);
  }
  const [own] = normalizeEditorOwnBasemaps([entry]);
  if (!own) return refused("It has no picture or drawn map in it.");
  if (!state.own.some((existing) => existing.id === own.id)) state.own = [...state.own, own];
  return patchOf(state);
};

// The starting map moved into the list, so making another map the starting
// one never loses it. Answers the id its drawing got ("" for none).
const demoteStartingMap = (state, scenarioName) => {
  if (!state.customBackground) {
    if (!state.builtin.includes(state.basemap)) state.builtin = [...state.builtin, state.basemap];
    return "";
  }
  const [drawnOrPicture] = normalizeEditorOwnBasemaps([{ id: "x", name: startingNameOf(state, scenarioName), background: state.customBackground }]);
  let id = "";
  if (drawnOrPicture) {
    id = freshId(state, drawnOrPicture.name);
    state.own = [...state.own, { ...drawnOrPicture, id }];
    repoint(state, "", id);
  }
  if (state.tiledBasemap && id) {
    const { fillOpacity, name } = state.tiledBasemap;
    state.own = [...state.own, {
      id: freshId(state, detailedNameOf(state.tiledBasemap)),
      name: detailedNameOf({ name }),
      detailed: namingOf(state.tiledBasemap),
      ...(Array.isArray(fillOpacity) ? { fillOpacity } : {}),
      over: id,
    }];
  }
  state.customBackground = null;
  state.tiledBasemap = null;
  state.startingMapName = null;
  return id;
};
// One of the list's drawn or picture maps made the starting map's.
const promoteOwn = (state, id) => {
  const entry = state.own.find((own) => own.id === id);
  state.own = state.own.filter((own) => own.id !== id);
  state.customBackground = entry.background;
  state.startingMapName = entry.name;
  repoint(state, id, "");
};

export const makeStartingMap = (metadata, key, { scenarioName = "" } = {}) => {
  if (key === STARTING_MAP_KEY) return patchOf(stateOf(metadata));
  const state = stateOf(metadata);
  if (key.startsWith(BUILTIN)) {
    const id = key.slice(BUILTIN.length);
    if (!ESRI_BASEMAPS.some((basemap) => basemap.id === id)) return refused("That is not one of the built-in maps.");
    demoteStartingMap(state, scenarioName);
    state.basemap = id;
    state.builtin = state.builtin.filter((other) => other !== id);
    return patchOf(state);
  }
  // The drawn map under a detailed starting map: the detailed map moves into
  // the list, shown over it as before.
  if (key === STARTING_DRAWN_KEY && !state.customBackground) return patchOf(stateOf(metadata));
  const demotedDrawn = key === STARTING_DRAWN_KEY ? demoteStartingMap(state, scenarioName) : null;
  const id = demotedDrawn ?? (key.startsWith(OWN) ? key.slice(OWN.length) : "");
  if (demotedDrawn === "") return patchOf(stateOf(metadata));
  if (demotedDrawn !== null) {
    promoteOwn(state, id);
    return patchOf(state);
  }
  const entry = state.own.find((own) => own.id === id);
  if (!entry) return refused("That map is not in this scenario's maps.");
  if (entry.detailed && !detailedMapFits(metadata?.projection)) return refused(DETAILED_MAP_PROJECTION_MESSAGE);
  demoteStartingMap(state, scenarioName);
  if (!entry.detailed) {
    promoteOwn(state, id);
    return patchOf(state);
  }
  const moved = state.own.find((own) => own.id === id);
  promoteOwn(state, moved.over);
  state.own = state.own.filter((own) => own.id !== id);
  state.tiledBasemap = { ...entry.detailed, name: entry.name, ...(Array.isArray(entry.fillOpacity) ? { fillOpacity: entry.fillOpacity } : {}) };
  return patchOf(state);
};

const dependentsOn = (state, over) => state.own.filter((entry) => entry.detailed && (entry.over || "") === over);
const cannotRemove = (dependents) => {
  const names = dependents.map((entry) => entry.name).join(", ");
  return `${names} ${dependents.length > 1 ? "are" : "is"} shown over this map, and this scenario has no other drawn map to show ${dependents.length > 1 ? "them" : "it"} over. Remove ${names} first, or add another drawn map.`;
};

export const removeMap = (metadata, key) => {
  const state = stateOf(metadata);
  if (key === STARTING_MAP_KEY) return refused("Make another map the starting map first.");
  if (key.startsWith(BUILTIN)) {
    const id = key.slice(BUILTIN.length);
    state.builtin = state.builtin.filter((other) => other !== id);
    return patchOf(state);
  }
  if (key === STARTING_DRAWN_KEY) {
    const next = firstDrawn(state, { except: "" });
    if (next === null) return refused(cannotRemove([{ name: detailedNameOf(state.tiledBasemap) }, ...dependentsOn(state, "")]));
    promoteOwn(state, next);
    return patchOf(state);
  }
  const id = key.slice(OWN.length);
  const entry = state.own.find((own) => own.id === id);
  if (!entry) return patchOf(state);
  const dependents = entry.detailed ? [] : dependentsOn(state, id);
  if (dependents.length) {
    const next = firstDrawn(state, { except: id });
    if (next === null) return refused(cannotRemove(dependents));
    repoint(state, id, next);
  }
  state.own = state.own.filter((own) => own.id !== id);
  return patchOf(state);
};

// Which drawn map a detailed map is shown over. For the detailed starting
// map, the chosen drawing comes under it and the old one goes into the list.
export const setShownOver = (metadata, key, overKey, { scenarioName = "" } = {}) => {
  const state = stateOf(metadata);
  const drawnStarting = isDrawn(state.customBackground);
  const overId = overKey === STARTING_MAP_KEY || overKey === STARTING_DRAWN_KEY
    ? (drawnStarting ? "" : null)
    : overKey.startsWith(OWN) && isDrawn(state.own.find((own) => own.id === overKey.slice(OWN.length))?.background) ? overKey.slice(OWN.length) : null;
  if (overId === null) return refused("A detailed map can only be shown over one of this scenario's drawn maps.");
  if (key === STARTING_MAP_KEY) {
    if (!state.tiledBasemap || overId === "") return patchOf(state);
    const old = { name: startingNameOf(state, scenarioName), background: state.customBackground };
    const oldId = freshId(state, old.name);
    state.own = [...state.own, { id: oldId, ...old }];
    repoint(state, "", oldId);
    const tiled = state.tiledBasemap;
    promoteOwn(state, overId);
    state.tiledBasemap = tiled;
    return patchOf(state);
  }
  const id = key.startsWith(OWN) ? key.slice(OWN.length) : "";
  if (!state.own.some((own) => own.id === id && own.detailed)) return refused("That is not one of this scenario's detailed maps.");
  state.own = state.own.map((own) => (own.id === id ? { ...own, over: overId } : own));
  return patchOf(state);
};
