/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The region clipboard: pieces of one map, pasted into another.
//
// Copy takes the selected regions of the map that is open (as GeoJSON, lon/lat)
// together with everything those regions need to make sense somewhere else:
// for every country they name as owner or claimant, that country's registry
// record, colour, flag and tags from the source map, the region types they
// use, and the record (what it is, its colour) of every group whose area they
// are in. Paste puts them into whatever map is open then, taking their land out of
// the regions already there (OlMap.pasteRegions does the carving; this module
// decides what travels and what the target keeps).
//
// The clipboard outlives the editor: it is kept in IndexedDB, so an author can
// open the built-in map, copy a country, close the Workshop, open their own
// scenario's map and paste. Everything in here except the persistence is pure
// and unit-tested (regionClipboard.test.js).

import { findGroupKey } from "../runtime/groups.js";

export const CLIPBOARD_VERSION = 1;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

export const isRegionClipboard = (value) =>
  isRecord(value) &&
  value.version === CLIPBOARD_VERSION &&
  isRecord(value.regions) &&
  Array.isArray(value.regions.features);

// What a copy carries. `regions` is the GeoJSON FeatureCollection OlMap
// exported (properties: id, name, owner, typeId, claimants, edited, gid0…);
// `doc` is the source document and `colors` the palette it painted with.
export const buildClipboardPayload = ({ regions, doc, colors = {}, sourceName = "", sourceId = null, now = new Date() } = {}) => {
  const features = Array.isArray(regions?.features) ? regions.features.filter((f) => isRecord(f) && isRecord(f.geometry)) : [];
  const owners = new Set();
  const typeIds = new Set();
  const groupNames = new Set();
  for (const feature of features) {
    const props = isRecord(feature.properties) ? feature.properties : {};
    if (props.owner) owners.add(String(props.owner));
    if (props.group) groupNames.add(String(props.group));
    for (const claimant of Array.isArray(props.claimants) ? props.claimants : []) {
      if (claimant) owners.add(String(claimant));
    }
    if (props.typeId) typeIds.add(String(props.typeId));
  }
  const polities = {};
  for (const key of owners) {
    const record = doc?.polities?.[key];
    const rgb = colors?.[key];
    const flag = doc?.flags?.[key];
    const tags = doc?.tags?.[key];
    polities[key] = {
      ...(isRecord(record) ? clone(record) : {}),
      name: String(record?.name || key),
      ...(Array.isArray(rgb) && rgb.length >= 3 ? { rgb: rgb.slice(0, 3).map(Number) } : {}),
      ...(typeof flag === "string" && flag ? { flag } : {}),
      ...(Array.isArray(tags) && tags.length ? { tags: tags.map((t) => String(t)) } : {}),
    };
  }
  const types = (Array.isArray(doc?.types) ? doc.types : [])
    .filter((type) => isRecord(type) && typeIds.has(String(type.id)))
    .map((type) => clone(type));
  // A group named on a region but missing from the registry has no record to
  // carry; the target's export gives it a default one, as the source's did.
  const groups = {};
  for (const name of groupNames) {
    const key = findGroupKey(doc?.groups, name);
    if (key && isRecord(doc.groups[key])) groups[key] = clone(doc.groups[key]);
  }
  return {
    version: CLIPBOARD_VERSION,
    copiedAt: now.toISOString(),
    source: { name: String(sourceName || "Untitled Map"), id: sourceId ?? null },
    regions: { type: "FeatureCollection", features: features.map((f) => clone(f)) },
    polities,
    types,
    groups,
  };
};

// What the target document takes from a paste. The target's own choices win:
// a country it already knows keeps its record, colour, flag and tags, and only
// the missing pieces arrive; a region type it lacks is added, and so is a
// group's record where the target has no group by that name (in any case).
// Pure, so the caller applies the patches with the document's setters.
export const planClipboardMerge = (payload, { polities = {}, colors = {}, flags = {}, tags = {}, types = [], groups = {} } = {}) => {
  const upserts = {};
  const colorOverrides = {};
  const flagAdds = {};
  const tagAdds = {};
  for (const [key, record] of Object.entries(isRecord(payload?.polities) ? payload.polities : {})) {
    if (!isRecord(record)) continue;
    const { rgb, flag, tags: recordTags, ...rest } = record;
    if (!isRecord(polities?.[key])) upserts[key] = { ...rest, name: String(rest.name || key) };
    if (!Array.isArray(colors?.[key]) && Array.isArray(rgb) && rgb.length >= 3) colorOverrides[key] = rgb.slice(0, 3).map(Number);
    if (!flags?.[key] && typeof flag === "string" && flag) flagAdds[key] = flag;
    const has = Array.isArray(tags?.[key]) && tags[key].length > 0;
    if (!has && Array.isArray(recordTags) && recordTags.length) tagAdds[key] = recordTags.map((t) => String(t));
  }
  const have = new Set((Array.isArray(types) ? types : []).map((type) => String(type?.id)));
  const typeAdds = (Array.isArray(payload?.types) ? payload.types : [])
    .filter((type) => isRecord(type) && type.id != null && !have.has(String(type.id)))
    .map((type) => clone(type));
  const groupAdds = {};
  for (const [key, record] of Object.entries(isRecord(payload?.groups) ? payload.groups : {})) {
    if (!isRecord(record) || findGroupKey(groups, key) || findGroupKey(groupAdds, key)) continue;
    groupAdds[key] = clone(record);
  }
  return { upserts, colorOverrides, flags: flagAdds, tags: tagAdds, types: typeAdds, groups: groupAdds };
};

// Ids for pasted regions: a region keeps its id when the target has no region
// by that id (a stock-world id keeps its tile linkage), otherwise it gets a
// fresh one. `taken` is the ids on the target once the carving is done, so a
// region the paste removed entirely frees its id for its replacement. One id
// per incoming region, in order: two pasted regions with the same id (or none)
// still get one each. OlMap.pasteRegions uses it.
export const resolvePastedIds = (ids, taken, mint) => {
  const used = new Set([...taken].map((id) => String(id)));
  return [...ids].map((id) => {
    const wanted = id == null ? null : String(id);
    let next = wanted && !used.has(wanted) ? wanted : String(mint());
    while (used.has(next)) next = String(mint());
    used.add(next);
    return next;
  });
};

// A summary for the panel: how many regions, from where, whose they are.
export const describeClipboard = (payload) => {
  if (!isRegionClipboard(payload)) return null;
  const byOwner = new Map();
  for (const feature of payload.regions.features) {
    const owner = feature?.properties?.owner ? String(feature.properties.owner) : "";
    byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
  }
  const owners = [...byOwner.entries()]
    .map(([key, count]) => ({ key, name: key ? String(payload.polities?.[key]?.name || key) : "No owner", count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    count: payload.regions.features.length,
    owners,
    source: String(payload.source?.name || "Untitled Map"),
    copiedAt: payload.copiedAt || null,
  };
};

// The day a clipboard was copied (a real date, not a game date), written the
// way the game writes its dates in English ("Jan 8, 2026") whatever the
// browser's locale, so the translator puts it into the player's language
// (runtime/localDates.js). The browser's own "8/1/2026" was read month first
// there, and shown as the wrong day.
export const formatCopiedDay = (time) => {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// ---- persistence: one slot in IndexedDB, mirrored in memory ------------------

const DB_NAME = "oh-workshop";
const STORE = "clipboard";
const KEY = "regions";

let cache = null;
let hydrated = false;
let hydrating = null;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

const withStore = (mode, run) =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(undefined);
      return;
    }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      let request;
      try {
        const tx = db.transaction(STORE, mode);
        request = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request?.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });

export const getRegionClipboard = () => cache;

export const subscribeRegionClipboard = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Load the stored clipboard once; later calls return what is in memory.
export const readRegionClipboard = async () => {
  if (hydrated) return cache;
  if (!hydrating) {
    hydrating = withStore("readonly", (store) => store.get(KEY))
      .then((stored) => {
        if (!hydrated) cache = isRegionClipboard(stored) ? stored : cache;
      })
      .catch((error) => console.warn("[editor] region clipboard not read:", error))
      .finally(() => {
        hydrated = true;
        hydrating = null;
        notify();
      });
  }
  await hydrating;
  return cache;
};

export const writeRegionClipboard = async (payload) => {
  cache = isRegionClipboard(payload) ? payload : null;
  hydrated = true;
  notify();
  try {
    if (cache) await withStore("readwrite", (store) => store.put(cache, KEY));
    else await withStore("readwrite", (store) => store.delete(KEY));
  } catch (error) {
    console.warn("[editor] region clipboard not persisted:", error);
  }
  return cache;
};

export const clearRegionClipboard = () => writeRegionClipboard(null);

// Test seam: forget the in-memory slot without touching IndexedDB.
export const resetRegionClipboardCache = () => {
  cache = null;
  hydrated = false;
  hydrating = null;
};
