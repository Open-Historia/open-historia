/*!
 * Open Historia — stock world map generator
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Builds the STOCK world: the GADM level-1 regions of public/assets/regions-seed.geojson
// with each region owned by its own modern country (owner = the country's NAME,
// resolved from GID_0; nothing is unclaimed on the modern map). It is what every
// scenario without a map of its own renders on — the hub's re-ownership presets
// key their ownership by these GADM ids — and what the `map-data` release ships as
// `default-regions-names.geojson` (scripts/map-assets.json).
//
// It used to be the built-in Modern Day scenario's own map and this script wrote
// that scenario's files. Modern Day has since been redrawn: its map is authored in
// the Scenario Workshop and lives in the repo as server/seed/default/regions.geojson,
// which the server seeds into the data directory (server/libraryStore.js). This
// script no longer touches the built-in scenario at all.
//
//   node scripts/build-default-map.mjs
//   (then upload the result to the map-data release under a new versioned name and
//    update scripts/map-assets.json — see docs/assets-and-data.md §3)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import COUNTRY_NAMES from "../src/runtime/generated/countryNames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SEED_PATH = path.join(PROJECT_ROOT, "public", "assets", "regions-seed.geojson");
const OUT_DIR = path.join(PROJECT_ROOT, "server", "data", "stock");
const OUT_PATH = path.join(OUT_DIR, "regions.geojson");

if (!existsSync(SEED_PATH)) {
  console.error(`[build-default-map] region seed not found at ${SEED_PATH} — run node scripts/fetch-map-assets.mjs first`);
  process.exit(1);
}

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));

const features = [];
for (const feature of seed.features ?? []) {
  const props = feature.properties ?? {};
  const gid1 = props.id != null ? String(props.id) : "";
  if (!gid1 || !feature.geometry) continue;
  const gid0 = props.gid0 ? String(props.gid0) : "";
  // The owner is the country's NAME, resolved through the registry rather than
  // taken from the seed's own `country` field: the seed says "México" where
  // everything else says "Mexico", and truncates "United States Minor Outlying
  // Isl" at 32 characters. Falls back to the code so an unknown gid0 still
  // identifies its regions instead of silently unowning them.
  const owner = gid0 ? COUNTRY_NAMES[gid0] || gid0 : "";
  features.push({
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      id: gid1,
      owner,
      // GADM provenance. Stays a code — the tiles are keyed on it and the preset
      // grants resolve through it.
      gid0,
      name: props.name ? String(props.name) : "",
      // No `country`: owner IS the country's name.
      typeId: "land",
    },
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({ type: "FeatureCollection", features }), "utf8");

console.log(`[build-default-map] stock world -> ${path.relative(PROJECT_ROOT, OUT_PATH)}: ${features.length} regions, ${new Set(features.map((f) => f.properties.owner).filter(Boolean)).size} owners`);
