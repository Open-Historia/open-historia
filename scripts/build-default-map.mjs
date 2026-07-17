/*!
 * Open Historia — default scenario tier-2 map generator
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Converts the built-in "default" (modern day) scenario to a tier-2 custom map so
// the game renders it from GeoJSON like every other scenario — the old stock-pmtiles
// country fill is deprecated and no longer the primary render. Every region is owned
// by its own modern country (owner = GID_0); nothing is unclaimed on the modern map.
//
//   node scripts/build-default-map.mjs

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import COUNTRY_NAMES from "../src/runtime/generated/countryNames.js";
import { OWNER_SCHEMA } from "../server/ownerMigration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCENARIO_DIR = path.join(PROJECT_ROOT, "server", "data", "scenarios", "default");
const SEED_PATH = path.join(PROJECT_ROOT, "public", "assets", "regions-seed.geojson");
const BASE_COLORS_PATH = path.join(PROJECT_ROOT, "public", "assets", "colors.json");

const codeToColor = (code) => {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = 0.5;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.25;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

if (!existsSync(SCENARIO_DIR)) {
  console.error(`[build-default-map] default scenario not found at ${SCENARIO_DIR}`);
  process.exit(1);
}

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
const baseColors = existsSync(BASE_COLORS_PATH) ? JSON.parse(readFileSync(BASE_COLORS_PATH, "utf8")) : {};
const colors = { ...baseColors };

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
  // Keyed by NAME, hashed from the CODE. Both halves matter: the key has to match
  // what the game now looks colours up by, and the hash has to stay on gid0 or
  // every procedurally-coloured country changes colour — 171 of the 240 here have
  // no curated entry and would be re-rolled by hashing the name instead.
  if (owner && !colors[owner]) colors[owner] = codeToColor(gid0);
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

writeFileSync(
  path.join(SCENARIO_DIR, "regions.geojson"),
  JSON.stringify({ type: "FeatureCollection", features }),
  "utf8",
);
writeFileSync(path.join(SCENARIO_DIR, "colors.json"), `${JSON.stringify(colors, null, 2)}\n`, "utf8");

// Merge customRegions into the existing world.json (keep any other fields).
const worldPath = path.join(SCENARIO_DIR, "world.json");
const world = existsSync(worldPath) ? JSON.parse(readFileSync(worldPath, "utf8")) : {};
world.customRegions = true;
// Country names now, despite the field's name — renaming the key would be a second
// migration for no gain, and shipped FMG worlds already store names under it.
world.ownerCodes = [...new Set(features.map((f) => f.properties.owner).filter(Boolean))].sort();
// This map is BUILT name-keyed, so mark it migrated. Without the marker the store
// would run the migrator over a freshly-generated map on first read — harmless
// (the resolver is a fixpoint) but a pointless 55MB rewrite on every clean build.
world.ownerSchema = OWNER_SCHEMA;
// The auto-generated disputed-territory polities go with the codes that named them:
// each said {"Z01": {name: "Z01"}}, which is now both false and unreachable —
// Z01's regions are owned by "India".
if (world.polityOverrides && typeof world.polityOverrides === "object") {
  for (const key of Object.keys(world.polityOverrides)) {
    if (/^Z\d\d$/.test(key)) delete world.polityOverrides[key];
  }
}
writeFileSync(worldPath, `${JSON.stringify(world, null, 2)}\n`, "utf8");

// Cover image: the modern-era loading artwork fits the Modern Day scenario.
const coverSrc = path.join(PROJECT_ROOT, "public", "loading_screen.jpg");
if (existsSync(coverSrc)) {
  copyFileSync(coverSrc, path.join(SCENARIO_DIR, "cover-image.bin"));
  const metaPath = path.join(SCENARIO_DIR, "scenario.json");
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.coverImageContentType = "image/jpeg";
    meta.updatedAt = new Date().toISOString();
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }
}

console.log(`[build-default-map] default -> tier-2: ${features.length} regions, ${Object.keys(colors).length} colors, customRegions=true, cover set`);
