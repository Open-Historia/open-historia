/*! Open Historia — a scenario's other basemaps of its own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Beside its main basemap (doc.metadata.customBackground), a scenario can carry
// more maps of its own that players may switch to in Settings → Map: a
// political map and a terrain map, say. The Map Editor keeps them in
// doc.metadata.ownBasemaps as [{ id, name, background }], `background` saved
// the way customBackground is ({ kind: "image", dataUrl } or
// { kind: "vector", geojson }). The game gets a light list in world.ownBasemaps
// and the payloads in the ownBasemapsData asset (runtime/assets.js).

import { convertDisplayPoint, moveBasemapPayload, sameProjection } from "../../server/mapProjection.js";
import { normalizeOwnBasemaps } from "../runtime/assets.js";

const savedBackgroundOf = (background) => {
  if (background?.kind === "image" && typeof background.dataUrl === "string" && background.dataUrl) {
    return { kind: "image", dataUrl: background.dataUrl };
  }
  if (background?.kind === "vector" && Array.isArray(background.geojson?.features)) {
    return { kind: "vector", geojson: background.geojson };
  }
  return null;
};

// Checked as the game checks its list (runtime/assets.js normalizeOwnBasemaps),
// keeping each payload beside its entry.
export const normalizeEditorOwnBasemaps = (value) => (Array.isArray(value) ? value : [])
  .map((entry) => {
    const background = savedBackgroundOf(entry?.background);
    const [own] = background ? normalizeOwnBasemaps([{ ...entry, kind: background.kind }]) : [];
    return own ? { id: own.id, name: own.name, background } : null;
  })
  .filter(Boolean);

// A basemap from Your basemaps (basemapLibrary.js) as one of the scenario's
// own: named by its checksum when it has one, so adding it twice is a no-op.
export const ownBasemapIdOfLibrary = (bm) => String(bm?.contentHash || bm?.id || "").replace(/[^\w-]+/g, "").slice(0, 40);
export const ownBasemapFromLibrary = (bm, payload) => {
  const background = savedBackgroundOf(bm?.kind === "vector"
    ? { kind: "vector", geojson: payload?.geojson }
    : { kind: "image", dataUrl: payload?.dataUrl });
  if (!background) return null;
  const [own] = normalizeOwnBasemaps([{ id: ownBasemapIdOfLibrary(bm), name: bm.name, kind: background.kind }]);
  return own ? { id: own.id, name: own.name, background } : null;
};

// What the game gets: the light list for world.ownBasemaps and the payloads
// for the ownBasemapsData asset (null when there are none, so the asset is
// cleared).
export const buildOwnBasemapsForGame = (value) => {
  const list = normalizeEditorOwnBasemaps(value);
  if (!list.length) return { ownBasemaps: null, ownBasemapsData: null };
  return {
    ownBasemaps: normalizeOwnBasemaps(list.map(({ id, name, background }) => ({ id, name, kind: background.kind }))),
    ownBasemapsData: Object.fromEntries(list.map(({ id, background }) => [
      id,
      background.kind === "image" ? { dataUrl: background.dataUrl } : { geojson: background.geojson },
    ])),
  };
};

// And back, when the Workshop opens a scenario: an entry whose payload did not
// come is dropped rather than saved back empty.
export const ownBasemapsFromGame = (descriptors, data) => normalizeEditorOwnBasemaps(
  normalizeOwnBasemaps(descriptors).map(({ id, name, kind }) => ({
    id,
    name,
    background: { kind, ...(data && typeof data === "object" ? data[id] : null) },
  })),
);

// The drawn ones moved into another projection with the rest of the map
// (MapEditor convertProjection); a picture fills the sheet and stays. null
// when there is nothing to move.
export const moveOwnBasemapsBetween = (value, from, to) => {
  const list = normalizeEditorOwnBasemaps(value);
  if (!list.length || sameProjection(from, to) || !list.some((entry) => entry.background.kind === "vector")) return null;
  const move = (lon, lat) => convertDisplayPoint(from, to, lon, lat);
  return list.map((entry) => ({ ...entry, background: moveBasemapPayload(entry.background, move) }));
};
