/*! Open Historia — the map files a build reads from its own folder © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Every build reads its map data from its own /assets folder, under the same
// stable names. What differs is only how the files got there:
//
//   the desktop app   fetched from the map-data GitHub Release at first launch
//                     (scripts/fetch-map-assets.mjs, scripts/map-assets.json)
//   the Android app   laid into the APK when it is built
//   the website       laid into the site when it is built
//                     (both: scripts/stage-map-assets.mjs, scripts/map-assets.web.json)
//
// Which bytes are behind a name is decided by those two pinned lists and by
// nothing at run time. The website used to ask a content origin instead (a
// proxy in front of the release, and community nodes in front of that), because
// a browser cannot read a release asset itself: GitHub sends no CORS header on
// the download. Carrying its own copy, as the app does, needs none of it.
//
// The folder hangs off the build's base path: "/" everywhere but on
// openhistoria.com, where the game is served under /play/.
const BASE = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/";
export const ASSETS_BASE = `${BASE.replace(/\/?$/, "/")}assets`;

export const WORLD_FILES = Object.freeze({
  // The editor's default world ("New: world map").
  seed: "regions-seed.geojson",
  // The stock world every scenario without a map of its own renders on. The web
  // build fetches this file; the desktop's server reads its own copy from its
  // data folder (server/data/stock/regions.geojson).
  stock: "default-regions.geojson",
  // The world's cities: the editor's importer and the prompt's city catalog.
  cities: "cities-seed.json",
});

export const worldFileUrl = (file) => {
  const name = WORLD_FILES[file];
  if (!name) throw new Error(`unknown world file "${file}"`);
  return `${ASSETS_BASE}/${name}`;
};

// A map archive (regions, countries, cities) as the web build's router fetches
// it; the desktop's server answers /api/runtime/pmtiles/<key> from the same
// folder itself.
export const mapArchiveUrl = (key) => `${ASSETS_BASE}/${encodeURIComponent(key)}.pmtiles`;
