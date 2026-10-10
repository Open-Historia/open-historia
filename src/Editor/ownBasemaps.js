/*! Open Historia — a scenario's other basemaps of its own © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Beside its main basemap (doc.metadata.customBackground), a scenario can carry
// more maps of its own that players may switch to in Settings → Map: a
// political map and a terrain map, say. The Map Editor keeps them in
// doc.metadata.ownBasemaps as [{ id, name, background }], `background` saved
// the way customBackground is ({ kind: "image", dataUrl } or
// { kind: "vector", geojson }). The game gets a light list in world.ownBasemaps
// and the payloads in the ownBasemapsData asset (runtime/assets.js).

import { convertDisplayPoint, moveBasemapPayload, sameProjection } from "../../server/mapProjection.js";
import { normalizeOwnBasemap, normalizeOwnBasemaps } from "../runtime/assets.js";

const savedBackgroundOf = (background) => {
  // A picture keeps where it lies and its shape, so it can be the starting map
  // again just as it was (scenarioMaps.js).
  if (background?.kind === "image" && typeof background.dataUrl === "string" && background.dataUrl) {
    return {
      kind: "image",
      dataUrl: background.dataUrl,
      ...(background.bounds ? { bounds: background.bounds } : {}),
      ...(Number.isFinite(background.aspect) ? { aspect: background.aspect } : {}),
    };
  }
  if (background?.kind === "vector" && Array.isArray(background.geojson?.features)) {
    return { kind: "vector", geojson: background.geojson };
  }
  return null;
};

// Checked as the game checks its list (runtime/assets.js normalizeOwnBasemaps),
// keeping each payload beside its entry. A detailed map (docs/adr/0007) has no
// payload: { id, name, detailed: { id, version } | { hash }, fillOpacity?,
// over }, shown over another entry's drawing (`over`, its id) or the starting
// map's ("").
export const normalizeEditorOwnBasemaps = (value) => (Array.isArray(value) ? value : [])
  .map((entry) => {
    if (entry?.detailed) {
      const own = normalizeOwnBasemap({ ...entry, kind: "tiled", tiled: entry.detailed });
      if (!own) return null;
      return {
        id: own.id,
        name: own.name,
        detailed: own.tiled,
        ...(own.fillOpacity ? { fillOpacity: own.fillOpacity } : {}),
        over: own.over,
      };
    }
    const background = savedBackgroundOf(entry?.background);
    const own = background ? normalizeOwnBasemap({ ...entry, kind: background.kind }) : null;
    return own ? { id: own.id, name: own.name, background } : null;
  })
  .filter(Boolean)
  .filter((entry, _, list) => !entry.detailed || entry.over === "" || list.some((other) => other.id === entry.over && other.background?.kind === "vector"));

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
    ownBasemaps: normalizeOwnBasemaps(list.map(({ id, name, background, detailed, fillOpacity, over }) => (detailed
      ? { id, name, kind: "tiled", tiled: detailed, ...(fillOpacity ? { fillOpacity } : {}), over }
      : { id, name, kind: background.kind }))),
    ownBasemapsData: Object.fromEntries(list.filter((entry) => entry.background).map(({ id, background }) => [
      id,
      background.kind === "image" ? { dataUrl: background.dataUrl } : { geojson: background.geojson },
    ])),
  };
};

// And back, when the Workshop opens a scenario: an entry whose payload did not
// come is dropped rather than saved back empty (and a detailed map shown over
// it with it).
export const ownBasemapsFromGame = (descriptors, data) => normalizeEditorOwnBasemaps(
  normalizeOwnBasemaps(descriptors).map(({ id, name, kind, tiled, fillOpacity, over }) => (kind === "tiled"
    ? { id, name, detailed: tiled, ...(fillOpacity ? { fillOpacity } : {}), over }
    : { id, name, background: { kind, ...(data && typeof data === "object" ? data[id] : null) } })),
);

// The drawn ones moved into another projection with the rest of the map
// (MapEditor convertProjection); a picture fills the sheet and stays. null
// when there is nothing to move.
export const moveOwnBasemapsBetween = (value, from, to) => {
  const list = normalizeEditorOwnBasemaps(value);
  if (!list.length || sameProjection(from, to) || !list.some((entry) => entry.background?.kind === "vector")) return null;
  const move = (lon, lat) => convertDisplayPoint(from, to, lon, lat);
  return list.map((entry) => (entry.background ? { ...entry, background: moveBasemapPayload(entry.background, move) } : entry));
};
