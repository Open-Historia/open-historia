/*! Open Historia — web-mode store models © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Faithful browser mirror of the constants + pure helpers in
// server/libraryStore.js (meta defaults/readers, country canonicalization, seed
// builders, snapshot detection, asset-key sets). Web build only.

import COUNTRY_NAME_REGISTRY from "./generated/countryNames.js";
import { cloneJson } from "./util.js";

export const DEFAULT_SCENARIO_ID = "default";
export const DEFAULT_GAME_ID = "default";
export const BUILT_IN_SCENARIO_DEFAULT_DATE = "2016-01-01";
export const SCENARIO_BUNDLE_SCHEMA = "pax-historia-scenario-bundle";
export const SCENARIO_BUNDLE_VERSION = 1;
export const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
export const COVER_IMAGE_ASSET_KEY = "cover";

// --- Asset-key sets (server/libraryStore.js:153-239) ---
export const STORAGE_JSON_ASSET_KEYS = ["actions", "advisor", "chat", "events"];
export const CORE_JSON_ASSET_KEYS = ["game", "prompts", "world"];
export const JSON_ASSET_KEYS = [...STORAGE_JSON_ASSET_KEYS, ...CORE_JSON_ASSET_KEYS];
export const OPTIONAL_JSON_ASSET_KEYS = ["colors", "flags"];
export const RUNTIME_ONLY_JSON_ASSET_KEYS = ["snapshots"];
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
  game: {}, prompts: {}, world: {}, snapshots: [],
};

export const TEMPLATE_WORLD_OVERRIDE_KEYS = [
  "allowedUnitTypes", "author", "background", "basemap", "customCities", "customRegions",
  "difficulty", "language", "mapCredit", "notes", "ownerCodes", "polityOverrides",
  "regionOwnershipOverrides", "simulationRules", "startingTimelineText",
];

export const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
]);

export const DEFAULT_SCENARIO_META = {
  accentColor: "#7c3aed",
  description: "Server-backed base scenario",
  eyebrow: "Scenario",
  heroSubtitle: "Editable server-backed scenario template.",
  heroTitle: "Modern Day",
  name: "Modern Day",
  subtitle: "Base template",
};

export const DEFAULT_GAME_META = {
  accentColor: "#7c3aed",
  description: "Active playable game",
  eyebrow: "Game",
  heroSubtitle: "Playable campaign session",
  heroTitle: "Modern Day",
  name: "Modern Day Session",
  scenarioId: DEFAULT_SCENARIO_ID,
  subtitle: "Current campaign",
};

// --- Country canonicalization (server/libraryStore.js:40-127) ---
export { COUNTRY_NAME_REGISTRY };
const NAME_TO_CODE = new Map(
  Object.entries(COUNTRY_NAME_REGISTRY).map(([code, name]) => [String(name).trim().toLowerCase(), code]),
);
const KNOWN_CODES = new Set(Object.keys(COUNTRY_NAME_REGISTRY));

export const canonicalizeCountryRef = (value, world) => {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (KNOWN_CODES.has(raw)) return raw;

  const lower = raw.toLowerCase();
  const overrides = world?.polityOverrides;
  if (overrides && typeof overrides === "object") {
    if (overrides[raw]) return raw;
    for (const [code, polity] of Object.entries(overrides)) {
      if (!polity || typeof polity !== "object") continue;
      if (String(polity.name ?? "").trim().toLowerCase() === lower) return polity.code || code;
      if (Array.isArray(polity.aliases) && polity.aliases.some((alias) => String(alias).trim().toLowerCase() === lower)) {
        return polity.code || code;
      }
    }
  }

  const byName = NAME_TO_CODE.get(lower);
  if (byName) return byName;
  return raw;
};

export const canonicalizeWorldCountryRefs = (world) => {
  if (!world || typeof world !== "object" || Array.isArray(world)) return world;
  const next = { ...world };

  if (next.regionOwnershipOverrides && typeof next.regionOwnershipOverrides === "object") {
    next.regionOwnershipOverrides = Object.fromEntries(
      Object.entries(next.regionOwnershipOverrides).map(([regionId, owner]) => [regionId, canonicalizeCountryRef(owner, world)]),
    );
  }
  if (Array.isArray(next.ownerCodes)) {
    next.ownerCodes = [...new Set(next.ownerCodes.map((entry) => canonicalizeCountryRef(entry, world)))];
  }
  if (next.polityOverrides && typeof next.polityOverrides === "object") {
    next.polityOverrides = Object.fromEntries(
      Object.entries(next.polityOverrides).map(([key, polity]) => {
        const code = canonicalizeCountryRef(polity?.code || key, world);
        return [code, polity && typeof polity === "object" ? { ...polity, code } : polity];
      }),
    );
  }
  if (Array.isArray(next.units)) {
    next.units = next.units.map((unit) =>
      unit && typeof unit === "object" && unit.ownerCode
        ? { ...unit, ownerCode: canonicalizeCountryRef(unit.ownerCode, world) }
        : unit,
    );
  }
  return next;
};

export const canonicalizeColorKeys = (colors, world) => {
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return colors;
  return Object.fromEntries(Object.entries(colors).map(([key, value]) => [canonicalizeCountryRef(key, world), value]));
};

export const canonicalizeGameCountry = (game) => {
  if (!game || typeof game !== "object" || Array.isArray(game) || !game.country) return game;
  return { ...game, country: canonicalizeCountryRef(game.country, null) };
};

// --- Meta readers (server/libraryStore.js:451-519), applied to a stored raw meta ---
export const readStoredImageContentType = (value) =>
  typeof value === "string" && SUPPORTED_IMAGE_CONTENT_TYPES.has(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;

export const readScenarioMeta = (scenarioId, raw = {}) => {
  const name = String(raw?.name ?? "").trim() || DEFAULT_SCENARIO_META.name;
  const subtitle = String(raw?.subtitle ?? "").trim() || DEFAULT_SCENARIO_META.subtitle;
  const description = String(raw?.description ?? "").trim() || subtitle || DEFAULT_SCENARIO_META.description;
  return {
    accentColor: String(raw?.accentColor ?? "").trim() || DEFAULT_SCENARIO_META.accentColor,
    coverImageContentType: readStoredImageContentType(raw?.coverImageContentType),
    countryNameOverrides: raw?.countryNameOverrides && typeof raw.countryNameOverrides === "object" ? raw.countryNameOverrides : {},
    createdAt: raw?.createdAt ?? nowIso(),
    description,
    eyebrow: String(raw?.eyebrow ?? "").trim() || DEFAULT_SCENARIO_META.eyebrow,
    heroSubtitle: String(raw?.heroSubtitle ?? "").trim() || description,
    heroTitle: String(raw?.heroTitle ?? "").trim() || name,
    id: scenarioId,
    name,
    subtitle,
    updatedAt: raw?.updatedAt ?? nowIso(),
  };
};

export const readGameMeta = (gameId, raw = {}) => {
  const name = String(raw?.name ?? "").trim() || DEFAULT_GAME_META.name;
  const subtitle = String(raw?.subtitle ?? "").trim() || DEFAULT_GAME_META.subtitle;
  const description = String(raw?.description ?? "").trim() || subtitle || DEFAULT_GAME_META.description;
  return {
    accentColor: String(raw?.accentColor ?? "").trim() || DEFAULT_GAME_META.accentColor,
    coverImageContentType: readStoredImageContentType(raw?.coverImageContentType),
    createdAt: raw?.createdAt ?? nowIso(),
    description,
    eyebrow: String(raw?.eyebrow ?? "").trim() || DEFAULT_GAME_META.eyebrow,
    heroSubtitle: String(raw?.heroSubtitle ?? "").trim() || description,
    heroTitle: String(raw?.heroTitle ?? "").trim() || name,
    id: gameId,
    name,
    scenarioId: String(raw?.scenarioId ?? "").trim() || DEFAULT_SCENARIO_ID,
    subtitle,
    updatedAt: raw?.updatedAt ?? nowIso(),
  };
};

// --- Seed builders + snapshot detection (server/libraryStore.js:597-673) ---
const normStr = (value) => (typeof value === "string" ? value.trim() : value ? String(value).trim() : "");

export const scenarioLooksLikeRuntimeSnapshot = ({ actions, chat, world }) => {
  const hasResolvedActions = Array.isArray(actions)
    ? actions.some((entry) => normStr(entry?.status).toLowerCase() === "resolved") : false;
  const hasChatTranscript = Array.isArray(chat)
    ? chat.some((entry) => Array.isArray(entry?.messages) && entry.messages.length > 0) : false;
  const hasTimelineProgress =
    Boolean(normStr(world?.lastJumpMode)) || Boolean(normStr(world?.lastJumpSummary)) ||
    Boolean(normStr(world?.lastJumpTargetDate)) || (Array.isArray(world?.simulationHistory) && world.simulationHistory.length > 0);
  return hasResolvedActions || hasChatTranscript || hasTimelineProgress;
};

export const buildFreshGameSeedFromScenario = ({ baseGame, scenarioGame }) => {
  const baseStartDate = normStr(baseGame?.startDate);
  const baseGameDate = normStr(baseGame?.gameDate);
  const scenarioStartDate = normStr(scenarioGame?.startDate);
  const scenarioGameDate = normStr(scenarioGame?.gameDate);
  const hasCustomStartDate = Boolean(scenarioStartDate) && scenarioStartDate !== baseStartDate;
  const hasCustomGameDate = Boolean(scenarioGameDate) && scenarioGameDate !== baseGameDate;
  const nextStartDate = (hasCustomStartDate ? scenarioStartDate : "") || (hasCustomGameDate ? scenarioGameDate : "")
    || scenarioStartDate || baseStartDate || BUILT_IN_SCENARIO_DEFAULT_DATE;
  const nextGameDate = (hasCustomGameDate ? scenarioGameDate : "") || (hasCustomStartDate ? scenarioStartDate : "")
    || baseGameDate || nextStartDate || BUILT_IN_SCENARIO_DEFAULT_DATE;
  return {
    ...cloneJson(baseGame ?? {}),
    ...(normStr(scenarioGame?.country) ? { country: normStr(scenarioGame.country) } : {}),
    ...(normStr(scenarioGame?.difficulty) ? { difficulty: normStr(scenarioGame.difficulty) } : {}),
    ...(normStr(scenarioGame?.language) ? { language: normStr(scenarioGame.language) } : {}),
    ...(nextStartDate ? { startDate: nextStartDate } : {}),
    ...(nextGameDate ? { gameDate: nextGameDate } : {}),
    round: 1,
  };
};

export const buildFreshWorldSeedFromScenario = ({ baseWorld, scenarioWorld }) => {
  const nextWorld = { ...cloneJson(baseWorld ?? {}) };
  for (const key of TEMPLATE_WORLD_OVERRIDE_KEYS) {
    if (!(key in (scenarioWorld ?? {}))) continue;
    nextWorld[key] = cloneJson(scenarioWorld[key]);
  }
  return nextWorld;
};

// Served world always carries customRegions:true (server normalizeRuntimeWorld:1786).
export const normalizeRuntimeWorld = (assetKey, data) => {
  if (assetKey !== "world" || !data || typeof data !== "object" || Array.isArray(data)) return data;
  return data.customRegions ? data : { ...data, customRegions: true };
};

// server normalizeId (:316) — no length cap for scenario/game ids.
export const normalizeId = (rawValue, prefix) => {
  const value = String(rawValue ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return value || `${prefix}-${Date.now().toString(36)}`;
};

export const nowIso = () => new Date().toISOString();

// resolveOrderedIds (server :919): keep manifest order for ids that exist, append
// existing ids not in the manifest, unshift defaultId if it exists.
export const resolveOrderedIds = (manifestOrder, existingIds, defaultId) => {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const known = new Set(manifestOrder ?? []);
  const ordered = [];
  for (const entry of manifestOrder ?? []) {
    if (existing.has(entry)) ordered.push(entry);
  }
  for (const entry of existing) {
    if (!known.has(entry)) ordered.push(entry);
  }
  if (existing.has(defaultId) && !ordered.includes(defaultId)) ordered.unshift(defaultId);
  return ordered;
};
