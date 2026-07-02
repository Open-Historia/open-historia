/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Loads seeded region geometry into an OpenLayers vector source.
//
// The seed (public/assets/regions-seed.geojson) is produced offline by
// scripts/extract-regions.mjs (z5 tile stitch of regions.pmtiles). It is WGS84
// lon/lat; we reproject into the editor's Web-Mercator view on read. Each region
// starts owned by its own country (owner = GID_0) so an imported world renders
// exactly like the game's political map; the user re-owns/edits from there.

import GeoJSON from "ol/format/GeoJSON";

export const SEED_URL = "/assets/regions-seed.geojson";

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
  const features = fmt.readFeatures(fc, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
  for (const feature of features) {
    const props = feature.getProperties();
    if (props.id != null) feature.setId(String(props.id));
    if (feature.get("owner") == null) feature.set("owner", props.gid0 || null);
    if (feature.get("typeId") == null) feature.set("typeId", "land");
  }
  return features;
};
