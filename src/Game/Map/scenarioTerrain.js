/*! Open Historia — scenario relief tiles over a vector background © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario with a vector background can also ship raster relief tiles
// (terrain.pmtiles): painted terrain that stays sharp when zoomed in, where the
// vector shapes can only be flat colour. The world declares them on its
// background descriptor:
//
//   world.background = { kind: "vector", terrain: { minzoom: 0, maxzoom: 8, bounds: [w, s, e, n] } }
//
// The vector background is always the base and always loads; the tiles draw on
// top of it. So a game that predates this feature, a scenario whose archive is
// missing or unreadable, and a player who picked "Painted" in Settings → Map all
// see the same thing: the vector background, never a blank map.

// Settings → Map. Empty (the default) shows a scenario's relief tiles when it has
// them; "painted" keeps its vector background only.
export const SCENARIO_TERRAIN_PAINTED = "painted";

const clampZoom = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(22, Math.round(n))) : fallback;
};

const validBounds = (value) => Array.isArray(value)
  && value.length === 4
  && value.every((n) => Number.isFinite(Number(n)))
  && Number(value[0]) < Number(value[2])
  && Number(value[1]) < Number(value[3]);

// How strongly owners' colours cover the relief, by zoom: [[zoom, opacity], …].
// Relief is detail, and the default ramp (Nations.jsx) thickens the political
// fill to ~0.8 up close, which buries it. A scenario may ask for a lighter ramp;
// it applies only while its relief is on screen. At least two stops, zooms
// strictly rising, opacities 0.05–1; anything else is ignored.
const normalizeFillOpacityStops = (value) => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) return null;
  const stops = [];
  for (const stop of value) {
    const zoom = Number(stop?.[0]), opacity = Number(stop?.[1]);
    if (!Number.isFinite(zoom) || !Number.isFinite(opacity) || zoom < 0 || zoom > 24) return null;
    if (stops.length && zoom <= stops[stops.length - 1][0]) return null;
    stops.push([zoom, Math.max(0.05, Math.min(1, opacity))]);
  }
  return stops;
};

// The descriptor's terrain block as the map needs it, or null when the scenario
// declares none. Only a vector background can carry relief tiles: an image
// background already replaces the whole map.
export const normalizeScenarioTerrain = (descriptor) => {
  const terrain = descriptor?.kind === "vector" ? descriptor.terrain : null;
  if (!terrain || typeof terrain !== "object" || Array.isArray(terrain)) return null;
  const minzoom = clampZoom(terrain.minzoom, 0);
  const maxzoom = Math.max(minzoom, clampZoom(terrain.maxzoom, 8));
  const fillOpacity = normalizeFillOpacityStops(terrain.fillOpacity);
  return {
    minzoom,
    maxzoom,
    ...(validBounds(terrain.bounds) ? { bounds: terrain.bounds.map(Number) } : {}),
    ...(fillOpacity ? { fillOpacity } : {}),
  };
};

// The relief the map is showing right now (World.jsx publishes it once the
// archive has opened; null when none, or Painted), so the political layers
// (Nations.jsx) can use the scenario's lighter fill ramp only while it shows.
let shownRelief = null;
const reliefListeners = new Set();
export const publishShownRelief = (terrain) => {
  const next = terrain || null;
  if (JSON.stringify(next) === JSON.stringify(shownRelief)) return;
  shownRelief = next;
  for (const listener of reliefListeners) listener();
};
export const subscribeShownRelief = (listener) => {
  reliefListeners.add(listener);
  return () => reliefListeners.delete(listener);
};
export const getShownRelief = () => shownRelief;

// Whether this player wants relief tiles at all (the Settings → Map choice).
export const wantsScenarioTerrain = (setting) => setting !== SCENARIO_TERRAIN_PAINTED;

// ohrelief:// is pmtiles:// for relief tiles, except that a tile the archive
// does not have comes back transparent. pmtiles answers a missing raster tile
// with no data, and MapLibre leaves such a tile "loading" forever: the map never
// goes idle and the game's loading screen never clears. An archive with gaps —
// open sea is the obvious one — must show the vector background there instead.
export const RELIEF_PROTOCOL = "ohrelief";
const TRANSPARENT_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const transparentPng = () => {
  const text = atob(TRANSPARENT_PNG_BASE64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
};

// MapLibre protocol handler over the pmtiles one (Protocol#tilev4).
export const createReliefTileLoader = (pmtilesTile) => async (params, abortController) => {
  const response = await pmtilesTile({ ...params, url: String(params.url).replace(`${RELIEF_PROTOCOL}://`, "pmtiles://") }, abortController);
  return response?.data ? response : { data: transparentPng() };
};

// Source + layer for the style's vector-background branch. Past maxzoom MapLibre
// overzooms the deepest tiles, so close play stays covered. The tile template is
// given directly: the declared zooms and bounds make a TileJSON round trip
// unnecessary.
export const buildScenarioTerrainStyle = (terrain, url) => {
  if (!terrain || !url) return { sources: {}, layers: [] };
  return {
    sources: {
      "custom-bg-terrain": {
        type: "raster",
        tiles: [`${String(url).replace(/^pmtiles:\/\//, `${RELIEF_PROTOCOL}://`)}/{z}/{x}/{y}`],
        tileSize: 256,
        minzoom: terrain.minzoom,
        maxzoom: terrain.maxzoom,
        ...(terrain.bounds ? { bounds: terrain.bounds } : {}),
      },
    },
    layers: [
      { id: "custom-bg-terrain", type: "raster", source: "custom-bg-terrain", paint: { "raster-fade-duration": 0 } },
    ],
  };
};
