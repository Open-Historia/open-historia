/*! Open Historia — the world files fetched by name © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The two world files a build fetches by NAME rather than through the map
// server: the editor's default world ("New: world map") and the stock world
// every scenario without a map of its own renders on.
//
// The desktop and the Android app read each from their own /assets folder under
// one stable name; which bytes are behind that name is decided where the file is
// pinned (scripts/map-assets.json, mobile/map-assets.android.json). The website
// has no such folder. It asks the content origin (VITE_OH_PMTILES_URL, the
// registry Worker's /content proxy), and that proxy serves only the names in its
// own table, so there the NAME is what picks the bytes.
//
// So a new edition of a file gets a new name, and the website asks for the
// names in order: the deep-cleaned edition first, then the name the origin has
// always answered to. An origin that does not know the newer name yet answers
// 404 and the site goes on working with the edition before, exactly as it did;
// once the origin's table has the name, the site serves the newer file with no
// build of its own. Neither order of the two deploys can leave the site without
// a map. (The older name is the LAST one: it is also the stable local name.)
export const WORLD_FILES = Object.freeze({
  // The editor's default world, web-sized. -clean: the Workshop's own border
  // cleanup at 1.5 km run to the end over regions-seed.geojson.
  seed: Object.freeze(["regions-seed-clean.geojson", "regions-seed.geojson"]),
  // The stock world. The origin answers "default-regions.geojson" with the z8
  // world keyed by country names (default-regions-names.geojson on the release);
  // the first name is that same file deep-cleaned.
  stock: Object.freeze(["default-regions-names-clean.geojson", "default-regions.geojson"]),
});

const CONTENT_ORIGIN = String(import.meta.env?.VITE_OH_PMTILES_URL || "").replace(/\/$/, "");

// Where a file is asked for, in order. `base` is the content origin; without
// one the file is this build's own /assets copy, under its stable name.
export const worldFileUrls = (file, { base = CONTENT_ORIGIN } = {}) => {
  const names = WORLD_FILES[file];
  if (!names) throw new Error(`unknown world file "${file}"`);
  const origin = String(base || "").replace(/\/$/, "");
  return origin ? names.map((name) => `${origin}/${name}`) : [`/assets/${names[names.length - 1]}`];
};

// The first of those the origin has. An answer that is not OK moves on to the
// next name, and so does a request that fails outright: the registry Worker
// answers an unknown name with a 404 a page may read, but a self-hosted origin
// (a bucket, a plain file server) often sends its 404 without the CORS headers,
// and the browser reports that as a failed request. The last name's outcome is
// the caller's, as it always was: its answer handed back whatever its status,
// its failure thrown. A request the caller called off is thrown at once.
export const fetchWorldFile = async (file, init, { base, fetchImpl = fetch } = {}) => {
  const urls = worldFileUrls(file, { base });
  let response = null;
  for (const [index, url] of urls.entries()) {
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (index === urls.length - 1 || error?.name === "AbortError" || init?.signal?.aborted) throw error;
      response = null;
      continue;
    }
    if (response?.ok) return response;
  }
  return response;
};
