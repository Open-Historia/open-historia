/*! Open Historia — web-mode store models © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Faithful browser mirror of the constants + pure helpers in
// server/libraryStore.js (meta defaults/readers, country canonicalization, seed
// builders, snapshot detection, asset-key sets). Web build only.

import COUNTRY_NAME_REGISTRY from "./generated/countryNames.js";
import { cloneJson } from "./util.js";

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
export const OPTIONAL_JSON_ASSET_KEYS = ["colors", "flags", "tags"];
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
  game: {}, prompts: {}, world: {}, snapshots: [], intercepts: {},
};

export const TEMPLATE_WORLD_OVERRIDE_KEYS = [
  "allowedUnitTypes", "author", "background", "basemap", "customCities", "customGeometry", "customRegions",
  "difficulty", "language", "mapCredit", "notes", "ownerCodes", "polityOverrides",
  "regionClaimants", "regionOwnershipOverrides", "regionSovereigntyOverrides",
  "simulationRules", "startingTimelineText",
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

// --- Country reference resolution (mirrors server/libraryStore.js) ---
// Migrated worlds use the polityOverrides KEY as stable lineage identity. The
// visible/current name may change without re-keying ownership or presentation maps.
// Legacy codes and aliases still resolve back onto one unambiguous stable key.
export { COUNTRY_NAME_REGISTRY };

export const resolveOwnerRef = (value, world) => {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;

  const lower = raw.toLowerCase();
  const overrides =
    world?.polityOverrides && typeof world.polityOverrides === "object"
      ? world.polityOverrides
      : null;
  const legacyOwnerShape = Number(world?.ownerSchema ?? 1) < 4;

  // Web mode can encounter an un-migrated imported bundle before its store has
  // normalized it. Preserve the old code -> authored/stock NAME interpretation
  // for that shape; stable-lineage semantics begin at ownerSchema 4.
  if (legacyOwnerShape) {
    const verbatimPolity = overrides?.[raw];
    if (verbatimPolity?.verbatim) {
      return String(verbatimPolity.name ?? raw).trim() || raw;
    }
    if (overrides) {
      for (const [key, polity] of Object.entries(overrides)) {
        const name = String(polity?.name ?? key).trim();
        if (name === raw) continue;
        if (name.toLowerCase() === lower) return name;
        if (
          Array.isArray(polity?.aliases) &&
          polity.aliases.some(
            (alias) => String(alias ?? "").trim().toLowerCase() === lower,
          )
        ) {
          return name;
        }
        if (key === raw) return name;
      }
    }
    return COUNTRY_NAME_REGISTRY[raw.toUpperCase()] || raw;
  }

  if (overrides) {
    // Mirrors server/libraryStore.js: polityOverrides keys are stable campaign
    // lineage IDs. record.name is presentation state and may change mid-game.
    if (Object.prototype.hasOwnProperty.call(overrides, raw)) return raw;

    const exactMatches = [];
    for (const [key, polity] of Object.entries(overrides)) {
      const tokens = [
        key,
        polity?.code,
        polity?.name,
        ...(Array.isArray(polity?.aliases) ? polity.aliases : []),
      ]
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter(Boolean);
      if (tokens.includes(lower)) exactMatches.push(key);
    }
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return raw;

    const rawUpper = raw.toUpperCase();
    const stockCodes = new Set();
    if (COUNTRY_NAME_REGISTRY[rawUpper]) stockCodes.add(rawUpper);
    for (const [code, name] of Object.entries(COUNTRY_NAME_REGISTRY)) {
      if (String(name ?? "").trim().toLowerCase() === lower) {
        stockCodes.add(code.toUpperCase());
      }
    }

    if (stockCodes.size > 0) {
      const mapRefMatches = [];
      for (const [key, polity] of Object.entries(overrides)) {
        const refs = Array.isArray(polity?.mapRefs?.gadm0)
          ? polity.mapRefs.gadm0
              .map((entry) => String(entry ?? "").trim().toUpperCase())
              .filter(Boolean)
          : [];
        if (refs.some((code) => stockCodes.has(code))) mapRefMatches.push(key);
      }
      if (mapRefMatches.length === 1) return mapRefMatches[0];
      if (mapRefMatches.length > 1) return raw;
    }
  }

  const known = COUNTRY_NAME_REGISTRY[raw.toUpperCase()];
  if (known) return known;
  return raw;
};

export const canonicalizeWorldCountryRefs = (world) => {
  if (!world || typeof world !== "object" || Array.isArray(world)) return world;
  const next = { ...world };

  const canonicalizeClaimants = (raw) => {
    const source = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? Object.keys(raw).filter((key) => raw[key])
        : [];
    return [...new Set(source.map((entry) => resolveOwnerRef(entry, world)).filter(Boolean))];
  };

  if (next.regionOwnershipOverrides && typeof next.regionOwnershipOverrides === "object") {
    next.regionOwnershipOverrides = Object.fromEntries(
      Object.entries(next.regionOwnershipOverrides).map(([regionId, owner]) => [regionId, resolveOwnerRef(owner, world)]),
    );
  }
  if (next.regionSovereigntyOverrides && typeof next.regionSovereigntyOverrides === "object") {
    next.regionSovereigntyOverrides = Object.fromEntries(
      Object.entries(next.regionSovereigntyOverrides).map(([regionId, owner]) => [regionId, resolveOwnerRef(owner, world)]),
    );
  }
  if (next.regionClaimants && typeof next.regionClaimants === "object") {
    next.regionClaimants = Object.fromEntries(
      Object.entries(next.regionClaimants)
        .map(([regionId, claimants]) => [regionId, canonicalizeClaimants(claimants)])
        .filter(([, claimants]) => claimants.length > 0),
    );
  }
  if (Array.isArray(next.ownerCodes)) {
    next.ownerCodes = [...new Set(next.ownerCodes.map((entry) => resolveOwnerRef(entry, world)))];
  }
  if (next.polityOverrides && typeof next.polityOverrides === "object") {
    // Keep the stable lineage key even when the visible/current name changes.
    next.polityOverrides = Object.fromEntries(
      Object.entries(next.polityOverrides).map(([key, polity]) => {
        const stableKey = resolveOwnerRef(key, world) || String(key ?? "").trim();
        if (!polity || typeof polity !== "object") return [stableKey, polity];
        const { code, ...rest } = polity;
        const displayName = String(polity.name ?? stableKey).trim() || stableKey;
        return [stableKey, { ...rest, name: displayName }];
      }),
    );
  }
  if (Array.isArray(next.units)) {
    next.units = next.units.map((unit) =>
      unit && typeof unit === "object" && unit.ownerCode
        ? { ...unit, ownerCode: resolveOwnerRef(unit.ownerCode, world) }
        : unit,
    );
  }
  if (next.countryTags && typeof next.countryTags === "object" && !Array.isArray(next.countryTags)) {
    next.countryTags = Object.fromEntries(
      Object.entries(next.countryTags).map(([key, value]) => [resolveOwnerRef(key, world), value]),
    );
  }
  if (next.internationalReputation && typeof next.internationalReputation === "object" && !Array.isArray(next.internationalReputation)) {
    next.internationalReputation = Object.fromEntries(
      Object.entries(next.internationalReputation).map(([key, value]) => [resolveOwnerRef(key, world), value]),
    );
  }
  return next;
};

export const canonicalizeColorKeys = (colors, world) => {
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return colors;
  return Object.fromEntries(Object.entries(colors).map(([key, value]) => [resolveOwnerRef(key, world), value]));
};

// `world` is REQUIRED so aliases/current names/legacy codes resolve back to the
// stable player polity key.
export const canonicalizeGameCountry = (game, world) => {
  if (!game || typeof game !== "object" || Array.isArray(game) || !game.country) return game;
  return { ...game, country: resolveOwnerRef(game.country, world) };
};

// --- Meta readers (server/libraryStore.js:451-519), applied to a stored raw meta ---
export const readStoredImageContentType = (value) =>
  typeof value === "string" && SUPPORTED_IMAGE_CONTENT_TYPES.has(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;

// Hub-import provenance (server/libraryStore.js normalizeHubOrigin twin): the
// post's issue number + the exact bundle URL imported. A post whose current
// bundleUrl differs from this has an update (attachment URLs are immutable —
// a new upload gets a new URL).
export const normalizeHubOrigin = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const postId = Number(raw.postId);
  const bundleUrl = String(raw.bundleUrl ?? "").trim();
  if (!Number.isFinite(postId) || postId <= 0 || !bundleUrl) return null;
  return {
    bundleUrl,
    postId,
    syncedAt: String(raw.syncedAt ?? "").trim() || nowIso(),
  };
};

export const normalizePlayCount = (raw) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
};

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
    hubOrigin: normalizeHubOrigin(raw?.hubOrigin),
    id: scenarioId,
    name,
    playCount: normalizePlayCount(raw?.playCount),
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
    lastPlayedAt: String(raw?.lastPlayedAt ?? "").trim() || null,
    name,
    playCount: normalizePlayCount(raw?.playCount),
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
export const normalizeRuntimeWorld = (assetKey, data, scenarioCustomGeometry) => {
  if (assetKey !== "world" || !data || typeof data !== "object" || Array.isArray(data)) return data;
  const normalized = data.customRegions ? data : { ...data, customRegions: true };
  return normalized.customGeometry == null && scenarioCustomGeometry != null
    ? { ...normalized, customGeometry: Boolean(scenarioCustomGeometry) }
    : normalized;
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
