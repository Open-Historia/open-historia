/*! Open Historia — battlefields on the map: the ground their own layer draws in place of the map's fills © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While a battlefield is on the map its sides' regions in its frame are drawn
// by its own layer (frontGroundLayer.js): each region in its owner's colour,
// the colour of whoever holds the ground laid in where the picture is painted,
// and the border drawn where the holders meet. The map's own fill of those
// regions is hidden meanwhile, as the hand-over sweep hides a region it is
// sweeping (Nations.jsx), and the map's borders between them are left out
// (vnext/politicalBoundaryTopology.js), since the battlefield draws its own.
//
// Four things pass between the battlefield layers (FrontLayers.jsx) and the
// political map (Nations.jsx), and this is where they meet:
//
//   areas   FrontLayers -> Nations   each battlefield's frame and sides, while
//                                    its layer can draw it
//   meshes  Nations -> FrontLayers   which regions each draws and their
//                                    triangles, as the regions worker found
//   wanted  FrontLayers -> Nations   the regions the layer means to draw
//   held    Nations -> FrontLayers   those whose fill the map has hidden: a
//                                    battlefield is drawn once all of its are,
//                                    so a region is never drawn twice over
//
// Nothing here is saved.

const NONE = Object.freeze([]);
const NO_IDS = Object.freeze(new Set());

const channel = (initial) => {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          console.error("A listener for a battlefield's ground failed:", error);
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      value = initial;
      listeners.clear();
    },
  };
};

const areas = channel(NONE);
const meshes = channel(NONE);
const wanted = channel(NO_IDS);
const held = channel(NO_IDS);

const sameIds = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));
const areaKey = (list) => JSON.stringify(list.map((area) => [area.key, area.bounds, area.members]));

// [{ key, bounds: [west, south, east, north], members: [names] }], one a
// battlefield. The same again tells nobody.
export const getGroundAreas = areas.get;
export const subscribeGroundAreas = areas.subscribe;
export const setGroundAreas = (list) => {
  const next = (Array.isArray(list) ? list : []).filter((area) => area?.key && Array.isArray(area.bounds) && area.bounds.length === 4);
  if (areaKey(next) === areaKey(areas.get())) return false;
  areas.set(next.length ? Object.freeze(next) : NONE);
  return true;
};

// [{ key, regionIds, owners, meshId, positions, regionOf }], one a battlefield.
export const getGroundMeshes = meshes.get;
export const subscribeGroundMeshes = meshes.subscribe;
export const setGroundMeshes = (list) => {
  const next = Array.isArray(list) && list.length ? Object.freeze([...list]) : NONE;
  if (next === NONE && meshes.get() === NONE) return false;
  meshes.set(next);
  return true;
};

const idChannel = (target) => ({
  get: target.get,
  subscribe: target.subscribe,
  set: (ids) => {
    const next = new Set([...(ids ?? [])].map(String).filter(Boolean));
    if (sameIds(next, target.get())) return false;
    target.set(next.size ? next : NO_IDS);
    return true;
  },
});
const wantedIds = idChannel(wanted);
const heldIds = idChannel(held);
export const getGroundWantedIds = wantedIds.get;
export const subscribeGroundWantedIds = wantedIds.subscribe;
export const setGroundWantedIds = wantedIds.set;
export const getGroundHeldIds = heldIds.get;
export const subscribeGroundHeldIds = heldIds.subscribe;
export const setGroundHeldIds = heldIds.set;

// ---- the map's fills hidden, by whoever asks ------------------------------------
//
// The hand-over sweep and the battlefields both hide regions' fills, with the
// one feature-state `ownershipTransitionHidden`, and either may let go of a
// region the other still holds. So neither writes it: each says which regions
// it holds, and what is written is the two together.

export const CUSTOM_FILL_SOURCE = "custom-regions-source";
export const REPAIR_FILL_SOURCE = "custom-regions-repair-source";
export const TILE_FILL_SOURCE = "regions-source";
export const TILE_FILL_SOURCE_LAYER = "regions";

// Where each held region's fill is to be hidden: { key -> target }, a target
// being what MapLibre's setFeatureState is given. A region is drawn by the
// map's GeoJSON and, when its shape was mended, by the repair source too; a
// battlefield's region also by the stock tiles, which draw it close in (the
// sweep's flood is laid over those and leaves them be, as it always has).
export const hiddenFillTargets = ({ sweep = [], ground = [], repaired = NO_IDS, tiles = false } = {}) => {
  const out = new Map();
  const add = (source, id, sourceLayer = null) => {
    out.set(`${source}\u001f${id}`, sourceLayer ? { source, sourceLayer, id } : { source, id });
  };
  const hide = (ids, alsoTiles) => {
    for (const raw of ids ?? []) {
      const id = String(raw ?? "");
      if (!id) continue;
      add(CUSTOM_FILL_SOURCE, id);
      if (repaired?.has?.(id)) add(REPAIR_FILL_SOURCE, id);
      if (alsoTiles) add(TILE_FILL_SOURCE, id, TILE_FILL_SOURCE_LAYER);
    }
  };
  hide(sweep, false);
  hide(ground, tiles);
  return out;
};

// What to write to go from what is written to what is wanted: the targets to
// hide, and those to show again.
export const hiddenFillChanges = (written, wantedTargets) => {
  const hide = [];
  const show = [];
  for (const [key, target] of wantedTargets) if (!written.has(key)) hide.push([key, target]);
  for (const [key, target] of written) if (!wantedTargets.has(key)) show.push([key, target]);
  return { hide, show };
};

export const resetFrontGroundForTest = () => {
  areas.reset();
  meshes.reset();
  wanted.reset();
  held.reset();
};
