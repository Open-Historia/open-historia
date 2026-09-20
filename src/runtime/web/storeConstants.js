/*! Open Historia — web-mode store constants © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The plain constants of the web store: ids, bundle schemas, asset-key sets and
// meta defaults, mirroring server/libraryStore.js. models.js re-exports all of
// them, so callers keep importing from there.
//
// They live apart from models.js because this file imports nothing. models.js
// imports ./generated/countryNames.js, which only exists once
// scripts/seed-web-defaults.mjs has run, and CI runs the tests before any build.
// A Node test that needs these values imports them from here; one that imported
// models.js passed on any machine that had done a web build and failed on a
// clean checkout. Keep it import-free (gameBundleParity.test.js checks).

export const DEFAULT_SCENARIO_ID = "default";
export const DEFAULT_GAME_ID = "default";
export const BUILT_IN_SCENARIO_DEFAULT_DATE = "2016-01-01";
// Mirrors server/libraryStore.js — see there for why the schema string moves with
// the owner rename. In short: it is the ONLY compatibility gate on a file strangers
// swap, and an old build would otherwise accept a name-keyed bundle and resolve its
// names down to codes, leaving the player owning nothing.
export const SCENARIO_BUNDLE_SCHEMA = "pax-historia-scenario-bundle/2";
export const ACCEPTED_BUNDLE_SCHEMAS = new Set([SCENARIO_BUNDLE_SCHEMA, "pax-historia-scenario-bundle"]);
export const SCENARIO_BUNDLE_VERSION = 2;
export const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
export const COVER_IMAGE_ASSET_KEY = "cover";

// --- Asset-key sets (server/libraryStore.js:153-239) ---
export const STORAGE_JSON_ASSET_KEYS = ["actions", "advisor", "chat", "events"];
export const CORE_JSON_ASSET_KEYS = ["game", "prompts", "world"];
export const JSON_ASSET_KEYS = [...STORAGE_JSON_ASSET_KEYS, ...CORE_JSON_ASSET_KEYS];
export const OPTIONAL_JSON_ASSET_KEYS = ["colors", "flags", "tags", "stats"];
export const RUNTIME_ONLY_JSON_ASSET_KEYS = ["snapshots", "intercepts"];
export const PMTILES_ASSET_KEYS = ["cities", "countries", "regions"];
export const SCENARIO_GEOJSON_ASSET_KEYS = ["regionsGeojson", "citiesGeojson", "backgroundData"];
// Order matters for assetStatus (Object.keys(UPLOADABLE_SCENARIO_ASSET_FILES)).
export const UPLOADABLE_SCENARIO_ASSET_KEYS = [
  COVER_IMAGE_ASSET_KEY,
  ...OPTIONAL_JSON_ASSET_KEYS,
  ...PMTILES_ASSET_KEYS,
  ...SCENARIO_GEOJSON_ASSET_KEYS,
];
export const UPLOADABLE_GAME_ASSET_KEYS = [COVER_IMAGE_ASSET_KEY];

export const JSON_ASSET_DEFAULTS = {
  actions: [], advisor: [], chat: [], colors: {}, events: [],
  game: {}, prompts: {}, stats: {}, world: {}, snapshots: [], intercepts: {},
};

// This project's name, deliberately. The scenario schema below is a frozen wire
// format kept for the bundles players already hold — not a pattern to copy.
export const GAME_BUNDLE_SCHEMA = "open-historia-game-bundle/1";
export const ACCEPTED_GAME_BUNDLE_SCHEMAS = new Set([GAME_BUNDLE_SCHEMA]);
// Everything a game holds except its restore points (their own zip entry, moved
// as text) and its cover image.
export const GAME_BUNDLE_DATA_KEYS = [...JSON_ASSET_KEYS, ...OPTIONAL_JSON_ASSET_KEYS, "intercepts"];
export const OPTIONAL_GAME_BUNDLE_KEYS = new Set([...OPTIONAL_JSON_ASSET_KEYS, "intercepts"]);
// Scenarios every install ships, so a game played on one never carries a map.
export const CLASSIC_SCENARIO_ID = "modern-day-classic";
export const BUILT_IN_SCENARIO_IDS = new Set([DEFAULT_SCENARIO_ID, CLASSIC_SCENARIO_ID]);


// Mirrors TEMPLATE_WORLD_OVERRIDE_KEYS in server/libraryStore.js; held to it by
// src/runtime/gameBundleParity.test.js. (It had drifted: a duplicated five-key run,
// and customGeometry on this side only.)
export const TEMPLATE_WORLD_OVERRIDE_KEYS = [
  "allowedUnitTypes",
  "author",
  "background",
  "basemap",
  "customCities",
  "customGeometry",
  "customRegions",
  "difficulty",
  "language",
  "mapCredit",
  "notes",
  "ownerCodes",
  "polityOverrides",
  "units",
  "regionClaimants",
  "regionOwnershipOverrides",
  "regionSovereigntyOverrides",
  "simulationRules",
  "startingTimelineText",
];

export const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
]);

// The app's old default accent was a purple. It is retired: anything still
// carrying it reads as the current default, so a library made before the change
// does not keep a colour the app no longer uses. Mirrors server/libraryStore.js.
export const RETIRED_ACCENT_COLOR = "#7c3aed";
export const accentOrDefault = (raw, fallback) => {
  const value = String(raw ?? "").trim();
  return !value || value.toLowerCase() === RETIRED_ACCENT_COLOR ? fallback : value;
};

export const DEFAULT_SCENARIO_META = {
  accentColor: "#2bc1f3",
  description: "Server-backed base scenario",
  eyebrow: "Scenario",
  heroSubtitle: "Editable server-backed scenario template.",
  heroTitle: "Modern Day",
  name: "Modern Day",
  subtitle: "Base template",
};

export const DEFAULT_GAME_META = {
  accentColor: "#2bc1f3",
  description: "Active playable game",
  eyebrow: "Game",
  heroSubtitle: "Playable campaign session",
  heroTitle: "Modern Day",
  name: "Modern Day Session",
  scenarioId: DEFAULT_SCENARIO_ID,
  subtitle: "Current campaign",
};
