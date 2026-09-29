/*! Open Historia — a scenario's Tiled Basemap over its vector background © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario with a vector background can name a Tiled Basemap: raster relief
// tiles in a PMTiles archive, painted terrain that stays sharp when zoomed in,
// where the vector shapes can only be flat colour. The archive lives in the
// player's Basemap library, downloaded once and shared by every scenario that
// names it (docs/adr/0005-tiled-basemaps-stream-to-disk.md); the scenario only
// names it, by the hash of its bytes:
//
//   world.background = { kind: "vector", tiled: { hash, name, bytes, hubUrl }, fillOpacity? }
//
// The vector background is always the base and always loads; the tiles draw on
// top of it. So a game that predates this feature, a player who has not
// downloaded the Basemap yet, an archive that will not open, and a player who
// picked "Painted" in Settings → Map all see the same thing: the vector
// background, never a blank map.

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

// The Tiled Basemap a scenario names, or null. Only a vector background can
// name one (an image background already replaces the whole map), and only by a
// SHA-256 content hash; a hub link is kept only when it is https.
export const scenarioTiledBasemap = (descriptor) => {
  const tiled = descriptor?.kind === "vector" ? descriptor.tiled : null;
  if (!tiled || typeof tiled !== "object" || !/^[a-f0-9]{64}$/.test(String(tiled.hash || ""))) return null;
  const bytes = Number(tiled.bytes);
  const hubUrl = /^https:\/\//i.test(String(tiled.hubUrl || "")) ? String(tiled.hubUrl) : "";
  return {
    hash: tiled.hash,
    ...(tiled.name ? { name: String(tiled.name).slice(0, 80) } : {}),
    ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
    ...(hubUrl ? { hubUrl } : {}),
  };
};

// What the map draws of a scenario's Tiled Basemap: its tiles (zooms and bounds
// read from the Basemap's own archive, the fill ramp the scenario's), or, when
// the named Basemap is not in the library, none, plus the Basemap to offer for
// download. `basemap` is the library entry found for the hash, if any;
// `archiveUrl` is where its archive is served.
export const resolveTiledBasemap = ({ descriptor, setting, basemap, archiveUrl }) => {
  const named = wantsScenarioTerrain(setting) ? scenarioTiledBasemap(descriptor) : null;
  if (!named) return { tiles: null, missing: null };
  if (basemap?.kind !== "tiled" || basemap.contentHash !== named.hash || !archiveUrl) return { tiles: null, missing: named };
  const minzoom = clampZoom(basemap.minzoom, 0);
  const maxzoom = Math.max(minzoom, clampZoom(basemap.maxzoom, minzoom));
  const fillOpacity = normalizeFillOpacityStops(descriptor.fillOpacity);
  return {
    tiles: {
      minzoom,
      maxzoom,
      ...(validBounds(basemap.bounds) ? { bounds: basemap.bounds.map(Number) } : {}),
      ...(fillOpacity ? { fillOpacity } : {}),
      url: `pmtiles://${archiveUrl}`,
    },
    missing: null,
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
// does not have is never answered empty. pmtiles answers a missing raster tile
// with no data, and MapLibre leaves such a tile "loading" forever: the map never
// goes idle and the game's loading screen never clears.
//
// A missing tile is drawn from its nearest ancestor instead (cropped and scaled
// up), so an archive may be sparse at its deepest zooms — a scenario can ship
// extra detail only around its cities — and still cover everywhere else with
// the best tile it has. With no ancestor either (open sea), the tile is
// transparent and the vector background shows.
export const RELIEF_PROTOCOL = "ohrelief";
const MAX_ANCESTOR_LEVELS = 6;
const TRANSPARENT_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const transparentPng = () => {
  const text = atob(TRANSPARENT_PNG_BASE64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
};

// The part of an ancestor tile that covers a descendant `levels` below it, at
// (ox, oy) among its 2^levels × 2^levels children, scaled up to a full tile.
// Browser-only (createImageBitmap + OffscreenCanvas); null where unavailable.
export const upscaleAncestorTile = async (bytes, levels, ox, oy) => {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return null;
  const image = await createImageBitmap(new Blob([bytes]));
  try {
    const span = image.width / 2 ** levels;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, ox * span, oy * span, span, span, 0, 0, image.width, image.height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    image.close?.();
  }
};

// MapLibre protocol handler over the pmtiles one (Protocol#tilev4).
export const createReliefTileLoader = (pmtilesTile, { upscale = upscaleAncestorTile } = {}) => async (params, abortController) => {
  const url = String(params.url).replace(`${RELIEF_PROTOCOL}://`, "pmtiles://");
  const response = await pmtilesTile({ ...params, url }, abortController);
  if (response?.data) return response;
  const match = url.match(/^(pmtiles:\/\/.+)\/(\d+)\/(\d+)\/(\d+)$/);
  if (match) {
    const [, archive, z, x, y] = match;
    for (let levels = 1; levels <= MAX_ANCESTOR_LEVELS && Number(z) - levels >= 0; levels += 1) {
      const ax = Number(x) >> levels, ay = Number(y) >> levels;
      const ancestor = await pmtilesTile({ ...params, url: `${archive}/${Number(z) - levels}/${ax}/${ay}` }, abortController);
      if (!ancestor?.data) continue;
      const data = await upscale(ancestor.data, levels, Number(x) - (ax << levels), Number(y) - (ay << levels)).catch(() => null);
      if (data) return { data };
      break;
    }
  }
  return { data: transparentPng() };
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
