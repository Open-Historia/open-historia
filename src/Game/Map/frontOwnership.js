/*! Open Historia — battlefields on the map: whose a region is drawn as while it is being taken © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A region changes hands twice on a battlefield (runtime/fronts/replay.js).
// IN NAME, when the side that does not hold it has more than six tenths of it:
// from that day the world says it is the taker's, and every rule of the game
// goes by that. IN FULL, only when the taker holds all of it: then the map
// switches it over, colour, border and labels.
//
// Between the two the map must go on drawing the region as its old holder's:
// the paint over it already shows who holds which part, and a border that
// jumped to the far side of a region still being fought over would say the
// opposite of what is happening. This is where the map is told whose each
// such region is DRAWN as. The battlefield layers set it as they play
// (FrontLayers.jsx); the political map lays it over the world's owners
// (Nations.jsx), so fills, borders and labels all follow it.
//
// Nothing here is saved, and nothing else reads it: a region clicked on is
// still told as whose it really is.

import { buildOwnerAliasMap, createOwnerResolver } from "../../runtime/ownerNames.js";
import { shownOwnersAt } from "../../runtime/fronts/replay.js";

const NONE = Object.freeze({});
let shown = NONE;
const listeners = new Set();

export const getFrontShownOwners = () => shown;

export const subscribeFrontShownOwners = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Whose each region is drawn as, from every battlefield on the map: a list of
// { regionId: name } (one a battlefield; null for one that has none). Says
// whether anything changed. The same content twice changes nothing and tells
// nobody: the political map works a change of ownership out in a worker, and
// must not be asked to for nothing.
let lastGiven = [];
export const setFrontShownOwners = (maps) => {
  const given = (Array.isArray(maps) ? maps : []).filter(Boolean);
  if (given.length === lastGiven.length && given.every((map, index) => map === lastGiven[index])) return false;
  lastGiven = given;
  const next = {};
  for (const map of given) {
    for (const [id, name] of Object.entries(map)) {
      if (typeof name === "string" && name) next[id] = name;
    }
  }
  const ids = Object.keys(next);
  if (ids.length === Object.keys(shown).length && ids.every((id) => shown[id] === next[id])) return false;
  shown = ids.length > 0 ? Object.freeze(next) : NONE;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error("A listener for the regions a battlefield draws failed:", error);
    }
  }
  return true;
};

// The world's owners with those laid over them. The world's own object comes
// back when there is nothing to lay over it, or nothing that differs, so that
// whoever goes by "has it changed" is not told it has. A name is put the way
// the map keys its polities (`polityOverrides`, as useWorldState.js folds them).
export const withShownOwners = (world, shownOwners, polityOverrides = null) => {
  if (!shownOwners || shownOwners === NONE) return world;
  const ids = Object.keys(shownOwners);
  if (ids.length === 0) return world;
  const aliases = polityOverrides && typeof polityOverrides === "object" ? buildOwnerAliasMap(polityOverrides) : null;
  const resolve = aliases?.size ? createOwnerResolver(aliases) : null;
  let merged = null;
  for (const id of ids) {
    const name = shownOwners[id];
    const token = resolve ? resolve(name) || name : name;
    if (world?.[id] === token) continue;
    if (!merged) merged = { ...(world ?? {}) };
    merged[id] = token;
  }
  return merged ?? world;
};

// The regions a change of what is drawn may touch: those either of two
// settings speaks of.
export const shownOwnerIds = (before, after) => new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

// A change of ownership is swept across the map as it happens. Not for these
// regions: the paint over them has already shown them changing hands. `data`
// is the sweep's features (each with the region's id); what is given back has
// those regions left out, and is `data` itself when none of them is in it.
export const withoutShownTransitions = (data, quietIds) => {
  const features = data?.features;
  if (!Array.isArray(features) || features.length === 0 || !quietIds || quietIds.size === 0) return data;
  const kept = features.filter((feature) => !quietIds.has(String(feature?.properties?.id ?? feature?.id ?? "")));
  return kept.length === features.length ? data : { ...data, features: kept };
};

// A record's list of regions taken in name and not in full, as { regionId: name }.
const contestedMaps = new WeakMap();
export const contestedOwnersOf = (record) => {
  const list = record?.contested;
  if (!Array.isArray(list) || list.length === 0) return null;
  let made = contestedMaps.get(list);
  if (!made) {
    made = {};
    for (const entry of list) if (Array.isArray(entry) && entry[0] && typeof entry[1] === "string" && entry[1]) made[entry[0]] = entry[1];
    Object.freeze(made);
    contestedMaps.set(list, made);
  }
  return made;
};

// Whose each region a battlefield draws as, on a day of its last run: what its
// replay says, else the regions its record lists. A battlefield standing in
// peace (a country's forces at home, a border built up) draws none: nothing is
// fought there, so no region is being taken. A save from before the engine
// knew that can list regions the story handed over, an annexed country's,
// which the map would go on drawing as the old country's for good.
export const drawnOwnersOf = (record, day) => {
  if (!record || record.status === "standing") return null;
  return shownOwnersAt(record.replay, day) ?? contestedOwnersOf(record);
};

export const resetFrontShownOwnersForTest = () => {
  shown = NONE;
  lastGiven = [];
  listeners.clear();
};
