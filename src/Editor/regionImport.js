/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Loads seeded region geometry into an OpenLayers vector source.
//
// The seed (public/assets/regions-seed.geojson) is produced offline by
// scripts/extract-regions.mjs (a tile stitch of regions.pmtiles). It is WGS84
// lon/lat; we reproject into the editor's Web-Mercator view on read. Each region
// starts owned by its own country — owner = the country's NAME ("Russia"), not
// its GADM code — so an imported world renders exactly like the game's political
// map; the user re-owns/edits from there.

import GeoJSON from "ol/format/GeoJSON";
import COUNTRY_NAMES from "../runtime/generated/countryNames.js";

// Web build hosts the big seeds on the registry Worker /content proxy
// (VITE_OH_PMTILES_URL); local/desktop leaves it unset → same-origin /assets
// (public/assets/, fetched by scripts/fetch-map-assets.mjs). Mirrors
// runtime/web/libraryStore.js. On Cloudflare Pages /assets/*.geojson would return
// the SPA-fallback HTML (the seed isn't hosted there), which parses to zero regions.
const CONTENT_BASE = (import.meta.env.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "");
export const SEED_URL = `${CONTENT_BASE}/regions-seed.geojson`;

// Fetch + parse the seed FeatureCollection into OL features (EPSG:3857).
// Returns [] and warns if the seed asset is missing (run the extract script).
export const loadSeedFeatures = async ({ signal } = {}) => {
  let res;
  try {
    res = await fetch(SEED_URL, { signal });
  } catch (err) {
    console.warn("[editor] failed to fetch region seed:", err);
    return [];
  }
  if (!res.ok) {
    console.warn(
      `[editor] ${SEED_URL} not found (${res.status}). ` +
        "Run: node scripts/extract-regions.mjs",
    );
    return [];
  }
  const fc = await res.json();
  const fmt = new GeoJSON();
  const opts = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" };

  // One feature at a time, dropping each raw one as it is converted — NOT
  // readFeatures(fc), which is the same work but holds two entire worlds in
  // memory at once: the parsed GeoJSON (every coordinate its own [lon,lat] JS
  // array) and OpenLayers' flat-coordinate copy of the same thing. At the seed's
  // ~4M vertices that peak is what ran the editor out of memory. Releasing each
  // raw feature here lets the parsed half be collected while the OL half is
  // still being built, so the peak is roughly one copy instead of two.
  const raw = fc.features || [];
  fc.features = null; // the array is reachable via `raw` alone from here
  const features = [];
  for (let i = 0; i < raw.length; i += 1) {
    const feature = fmt.readFeature(raw[i], opts);
    raw[i] = null; // this one is converted; let it go now, not at the end
    const props = feature.getProperties();
    if (props.id != null) feature.setId(String(props.id));
    // Owner is the country's NAME, resolved from the seed's gid0 through the
    // registry — not the seed's own `country` string, which disagrees with it
    // ("México" vs "Mexico", and "United States Minor Outlying Isl" truncated at
    // 32 chars). Trusting `country` here forks a second country that no palette,
    // flag or tag will ever match. Falls back to the code so an unknown gid0 still
    // identifies its regions rather than silently unowning them.
    if (feature.get("owner") == null) {
      feature.set("owner", props.gid0 ? COUNTRY_NAMES[props.gid0] || props.gid0 : null);
    }
    // The seed's `country` is provenance for the resolution above and nothing
    // more: once owner IS the name, a second copy beside it can only drift.
    feature.unset("country", true);
    if (feature.get("typeId") == null) feature.set("typeId", "land");
    features.push(feature);
  }
  return features;
};
