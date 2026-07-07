/*! Open Historia — portions (regions.geojson scenario asset + custom-map seeding) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const SERVER_DATA_DIR = path.join(__dirname, "data");
const SCENARIOS_DIR = path.join(SERVER_DATA_DIR, "scenarios");
const GAMES_DIR = path.join(SERVER_DATA_DIR, "games");
const SCENARIO_MANIFEST_PATH = path.join(SERVER_DATA_DIR, "scenario-manifest.json");
const GAME_MANIFEST_PATH = path.join(SERVER_DATA_DIR, "game-manifest.json");

const PMTILES_ASSETS_DIR = path.join(PUBLIC_DIR, "assets");

const DEFAULT_SCENARIO_ID = "default";
const DEFAULT_GAME_ID = "default";

// ---------------------------------------------------------------------------
// One naming scheme for authors: FULL COUNTRY NAMES work everywhere a country
// is referenced (ownership overrides, ownerCodes, polity keys, colors, the
// played country). Known names canonicalize to their internal code — flags
// and stock colors keep working — and unknown names simply ARE the
// identifier. Codes remain valid input too.
// ---------------------------------------------------------------------------
const COUNTRY_NAMES_PATH = path.join(__dirname, "country-names.json");

const loadCountryNameRegistry = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(COUNTRY_NAMES_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const COUNTRY_NAME_REGISTRY = loadCountryNameRegistry(); // code -> name
const NAME_TO_CODE = new Map(
  Object.entries(COUNTRY_NAME_REGISTRY).map(([code, name]) => [String(name).trim().toLowerCase(), code]),
);
const KNOWN_CODES = new Set(Object.keys(COUNTRY_NAME_REGISTRY));

// Resolve one author-supplied country reference (name or code) to the
// canonical identifier. `world` extends the lookup with the scenario's own
// polities (their names and aliases map to their codes).
const canonicalizeCountryRef = (value, world) => {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (KNOWN_CODES.has(raw)) return raw;

  const lower = raw.toLowerCase();
  const overrides = world?.polityOverrides;
  if (overrides && typeof overrides === "object") {
    if (overrides[raw]) return raw; // already a scenario polity code
    for (const [code, polity] of Object.entries(overrides)) {
      if (!polity || typeof polity !== "object") continue;
      if (String(polity.name ?? "").trim().toLowerCase() === lower) return polity.code || code;
      if (Array.isArray(polity.aliases) &&
          polity.aliases.some((alias) => String(alias).trim().toLowerCase() === lower)) {
        return polity.code || code;
      }
    }
  }

  const byName = NAME_TO_CODE.get(lower);
  if (byName) return byName;

  // Unknown reference: it is its own identifier (custom polities may simply
  // BE their name).
  return raw;
};

// Canonicalize every country reference inside a world payload, in place-safe
// copies. Region ids are untouched; only OWNER references translate.
const canonicalizeWorldCountryRefs = (world) => {
  if (!world || typeof world !== "object" || Array.isArray(world)) return world;
  const next = { ...world };

  if (next.regionOwnershipOverrides && typeof next.regionOwnershipOverrides === "object") {
    next.regionOwnershipOverrides = Object.fromEntries(
      Object.entries(next.regionOwnershipOverrides).map(([regionId, owner]) => [
        regionId,
        canonicalizeCountryRef(owner, world),
      ]),
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

// Colors may be keyed by name as well; keys canonicalize like everything else.
const canonicalizeColorKeys = (colors, world) => {
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return colors;
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [canonicalizeCountryRef(key, world), value]),
  );
};

// The played country may be written as a full name too.
const canonicalizeGameCountry = (game) => {
  if (!game || typeof game !== "object" || Array.isArray(game) || !game.country) return game;
  return { ...game, country: canonicalizeCountryRef(game.country, null) };
};
const BUILT_IN_SCENARIO_DEFAULT_DATE = "2016-01-01";
const SCENARIO_BUNDLE_SCHEMA = "pax-historia-scenario-bundle";
const SCENARIO_BUNDLE_VERSION = 1;

const DEFAULT_SCENARIO_META = {
  accentColor: "#7c3aed",
  description: "Server-backed base scenario",
  eyebrow: "Scenario",
  heroSubtitle: "Editable server-backed scenario template.",
  heroTitle: "Modern Day",
  name: "Modern Day",
  subtitle: "Base template",
};

const DEFAULT_GAME_META = {
  accentColor: "#7c3aed",
  description: "Active playable game",
  eyebrow: "Game",
  heroSubtitle: "Playable campaign session",
  heroTitle: "Modern Day",
  name: "Modern Day Session",
  scenarioId: DEFAULT_SCENARIO_ID,
  subtitle: "Current campaign",
};

const STORAGE_JSON_ASSET_FILES = {
  actions: "storage/actions.json",
  advisor: "storage/advisor.json",
  chat: "storage/chat.json",
  events: "storage/events.json",
};

const CORE_JSON_ASSET_FILES = {
  game: "game.json",
  prompts: "prompts.json",
  world: "world.json",
};

const JSON_ASSET_FILES = {
  ...STORAGE_JSON_ASSET_FILES,
  ...CORE_JSON_ASSET_FILES,
};

const OPTIONAL_JSON_ASSET_FILES = {
  colors: "colors.json",
};

const PMTILES_ASSET_FILES = {
  cities: "cities.pmtiles",
  countries: "countries.pmtiles",
  regions: "regions.pmtiles",
};

// Custom geometry authored in the map editor. Stored per-scenario (static map
// data, like the pmtiles), served to the runtime as JSON, and rendered by the
// game as a GeoJSON region layer when world.customRegions is set. Scenarios
// without it fall back to the stock pmtiles rendering (full backward-compat).
const SCENARIO_GEOJSON_ASSET_FILES = {
  regionsGeojson: "regions.geojson",
  // Era-accurate custom cities (points). When world.customCities is set the game
  // renders these instead of the modern cities.pmtiles labels.
  citiesGeojson: "cities.geojson",
  // A custom map background uploaded in the editor (an image placed by extent, or
  // a vector overlay). Small descriptor lives in world.background; this holds the
  // heavy payload ({ dataUrl } for images, { geojson } for vector) so world.json
  // stays light for the 5s poll. Loaded once by the game when world.background is set.
  backgroundData: "background.json",
};

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

const COVER_IMAGE_ASSET_KEY = "cover";

const SCENARIO_IMAGE_ASSET_FILES = {
  [COVER_IMAGE_ASSET_KEY]: "cover-image.bin",
};

const GAME_IMAGE_ASSET_FILES = {
  [COVER_IMAGE_ASSET_KEY]: "cover-image.bin",
};

const UPLOADABLE_SCENARIO_ASSET_FILES = {
  ...SCENARIO_IMAGE_ASSET_FILES,
  ...OPTIONAL_JSON_ASSET_FILES,
  ...PMTILES_ASSET_FILES,
  ...SCENARIO_GEOJSON_ASSET_FILES,
};

const UPLOADABLE_GAME_ASSET_FILES = {
  ...GAME_IMAGE_ASSET_FILES,
};

const JSON_ASSET_DEFAULTS = {
  actions: [],
  advisor: [],
  chat: [],
  colors: {},
  events: [],
  game: {},
  prompts: {},
  world: {},
};

const TEMPLATE_WORLD_OVERRIDE_KEYS = [
  "allowedUnitTypes",
"author",
"background",
"basemap",
"customCities",
"customRegions",
"difficulty",
"language",
"mapCredit",
"notes",
"ownerCodes",
"polityOverrides",
"regionOwnershipOverrides",
"simulationRules",
"startingTimelineText",
];

const COLORS_ASSET_CANDIDATES = [
  path.join(DIST_DIR, "assets", "colors.json"),
  path.join(PUBLIC_DIR, "assets", "colors.json"),
];

const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ensureDirectory = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const normalizeContentType = (value) =>
String(value ?? "")
.split(";")[0]
.trim()
.toLowerCase();

const readStoredImageContentType = (value) => {
  const normalized = normalizeContentType(value);
  return SUPPORTED_IMAGE_CONTENT_TYPES.has(normalized) ? normalized : null;
};

const normalizeImageContentType = (value) => {
  const normalized = normalizeContentType(value);
  if (!SUPPORTED_IMAGE_CONTENT_TYPES.has(normalized)) {
    throw new Error("Unsupported image type. Use PNG, JPEG, WEBP, GIF, or AVIF.");
  }

  return normalized;
};

const readJsonFile = (targetPath, fallback = null) => {
  if (!fs.existsSync(targetPath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
  } catch (error) {
    console.error(`Failed to parse JSON file: ${targetPath}`, error);
    return fallback;
  }
};

const writeJsonFile = (targetPath, value) => {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2), "utf-8");
};

const normalizeId = (rawValue, prefix) => {
  const value = String(rawValue ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

  return value || `${prefix}-${Date.now().toString(36)}`;
};

const normalizeScenarioId = (rawValue) => normalizeId(rawValue, "scenario");
const normalizeGameId = (rawValue) => normalizeId(rawValue, "game");

const resolveColorsAssetFile = () => {
  for (const candidate of COLORS_ASSET_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const copyFileIfPresent = (sourcePath, targetPath) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return true;
};

const copyJsonFile = (sourcePath, targetPath, fallback) => {
  if (copyFileIfPresent(sourcePath, targetPath)) {
    return;
  }

  writeJsonFile(targetPath, cloneJson(fallback));
};

const removeFileIfPresent = (targetPath) => {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
};

// Guard against path traversal. An id must resolve to a direct child of its
// base directory; anything containing ../ or a path separator (including the
// %2f Express decodes back into "/") would otherwise escape the data dir and
// let an unauthenticated request read, overwrite or delete arbitrary .json
// files. Only create paths were normalized before — read/update/delete took
// the raw id straight into path.join.
const resolveWithinDirectory = (baseDir, id, label) => {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, String(id ?? ""));
  if (path.dirname(resolved) !== base) {
    throw new Error(`Invalid ${label}: ${id}`);
  }
  return resolved;
};

const getScenarioDirectory = (scenarioId) =>
  resolveWithinDirectory(SCENARIOS_DIR, scenarioId, "scenario id");
const getScenarioMetaPath = (scenarioId) => path.join(getScenarioDirectory(scenarioId), "scenario.json");
const getScenarioJsonPath = (scenarioId, assetKey) =>
path.join(
  getScenarioDirectory(scenarioId),
          JSON_ASSET_FILES[assetKey] ?? OPTIONAL_JSON_ASSET_FILES[assetKey],
);
const getScenarioUploadPath = (scenarioId, assetKey) =>
path.join(getScenarioDirectory(scenarioId), UPLOADABLE_SCENARIO_ASSET_FILES[assetKey]);

const getGameDirectory = (gameId) => resolveWithinDirectory(GAMES_DIR, gameId, "game id");
const getGameMetaPath = (gameId) => path.join(getGameDirectory(gameId), "game-instance.json");
const getGameJsonPath = (gameId, assetKey) =>
path.join(
  getGameDirectory(gameId),
          JSON_ASSET_FILES[assetKey] ?? OPTIONAL_JSON_ASSET_FILES[assetKey],
);
const getGameUploadPath = (gameId, assetKey) =>
path.join(getGameDirectory(gameId), UPLOADABLE_GAME_ASSET_FILES[assetKey]);

const buildScenarioAssetUrl = (scenarioId, assetKey, cacheToken) =>
`/api/scenarios/${encodeURIComponent(scenarioId)}/assets/${encodeURIComponent(assetKey)}?v=${encodeURIComponent(
  cacheToken ?? "",
)}`;

const buildGameAssetUrl = (gameId, assetKey, cacheToken) =>
`/api/games/${encodeURIComponent(gameId)}/assets/${encodeURIComponent(assetKey)}?v=${encodeURIComponent(
  cacheToken ?? "",
)}`;

const getScenarioManifest = () => {
  const manifest = readJsonFile(SCENARIO_MANIFEST_PATH, null);

  if (manifest && Array.isArray(manifest.order)) {
    return {
      order: manifest.order,
      selectedScenarioId:
      String(manifest.selectedScenarioId ?? manifest.activeScenarioId ?? "").trim() ||
      DEFAULT_SCENARIO_ID,
      version: 2,
    };
  }

  return {
    order: [DEFAULT_SCENARIO_ID],
    selectedScenarioId: DEFAULT_SCENARIO_ID,
    version: 2,
  };
};

const saveScenarioManifest = (manifest) => {
  writeJsonFile(SCENARIO_MANIFEST_PATH, {
    activeScenarioId: manifest.selectedScenarioId,
    order: Array.from(new Set(manifest.order ?? [DEFAULT_SCENARIO_ID])),
                selectedScenarioId: manifest.selectedScenarioId,
                version: 2,
  });
};

const getGameManifest = () => {
  const manifest = readJsonFile(GAME_MANIFEST_PATH, null);

  if (manifest && Array.isArray(manifest.order)) {
    return {
      activeGameId: String(manifest.activeGameId ?? "").trim(),
      order: manifest.order,
      version: 2,
    };
  }

  // No games yet — nothing is created implicitly; the player starts their
  // first game from a scenario.
  return {
    activeGameId: "",
    order: [],
    version: 2,
  };
};

const saveGameManifest = (manifest) => {
  writeJsonFile(GAME_MANIFEST_PATH, {
    activeGameId: manifest.activeGameId ?? "",
    order: Array.from(new Set(manifest.order ?? [])),
                version: 2,
  });
};

const readScenarioMeta = (scenarioId) => {
  const raw = readJsonFile(getScenarioMetaPath(scenarioId), {});
  const name = String(raw?.name ?? "").trim() || DEFAULT_SCENARIO_META.name;
  const subtitle = String(raw?.subtitle ?? "").trim() || DEFAULT_SCENARIO_META.subtitle;
  const description = String(raw?.description ?? "").trim() || subtitle || DEFAULT_SCENARIO_META.description;

  return {
    accentColor: String(raw?.accentColor ?? "").trim() || DEFAULT_SCENARIO_META.accentColor,
    coverImageContentType: readStoredImageContentType(raw?.coverImageContentType),
    countryNameOverrides:
    raw?.countryNameOverrides && typeof raw.countryNameOverrides === "object"
    ? raw.countryNameOverrides
    : {},
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    description,
    eyebrow: String(raw?.eyebrow ?? "").trim() || DEFAULT_SCENARIO_META.eyebrow,
    heroSubtitle: String(raw?.heroSubtitle ?? "").trim() || description,
    heroTitle: String(raw?.heroTitle ?? "").trim() || name,
    id: scenarioId,
    name,
    subtitle,
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
  };
};

const writeScenarioMeta = (scenarioId, updates) => {
  const current = readScenarioMeta(scenarioId);
  const next = {
    ...current,
    ...updates,
    coverImageContentType:
    updates?.coverImageContentType === null
    ? null
    : typeof updates?.coverImageContentType === "string"
    ? readStoredImageContentType(updates.coverImageContentType)
    : current.coverImageContentType,
    countryNameOverrides:
    updates?.countryNameOverrides && typeof updates.countryNameOverrides === "object"
    ? updates.countryNameOverrides
    : current.countryNameOverrides,
    id: scenarioId,
    updatedAt: new Date().toISOString(),
  };

  writeJsonFile(getScenarioMetaPath(scenarioId), next);
  return next;
};

const readGameMeta = (gameId) => {
  const raw = readJsonFile(getGameMetaPath(gameId), {});
  const name = String(raw?.name ?? "").trim() || DEFAULT_GAME_META.name;
  const subtitle = String(raw?.subtitle ?? "").trim() || DEFAULT_GAME_META.subtitle;
  const description = String(raw?.description ?? "").trim() || subtitle || DEFAULT_GAME_META.description;

  return {
    accentColor: String(raw?.accentColor ?? "").trim() || DEFAULT_GAME_META.accentColor,
    coverImageContentType: readStoredImageContentType(raw?.coverImageContentType),
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    description,
    eyebrow: String(raw?.eyebrow ?? "").trim() || DEFAULT_GAME_META.eyebrow,
    heroSubtitle: String(raw?.heroSubtitle ?? "").trim() || description,
    heroTitle: String(raw?.heroTitle ?? "").trim() || name,
    id: gameId,
    name,
    scenarioId: String(raw?.scenarioId ?? "").trim() || DEFAULT_SCENARIO_ID,
    subtitle,
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
  };
};

const writeGameMeta = (gameId, updates) => {
  const current = readGameMeta(gameId);
  const next = {
    ...current,
    ...updates,
    coverImageContentType:
    updates?.coverImageContentType === null
    ? null
    : typeof updates?.coverImageContentType === "string"
    ? readStoredImageContentType(updates.coverImageContentType)
    : current.coverImageContentType,
    id: gameId,
    scenarioId: String(updates?.scenarioId ?? current.scenarioId).trim() || current.scenarioId,
    updatedAt: new Date().toISOString(),
  };

  writeJsonFile(getGameMetaPath(gameId), next);
  return next;
};

const copyScenarioOptionalAssets = (targetScenarioId, sourceScenarioId) => {
  for (const [assetKey] of Object.entries(UPLOADABLE_SCENARIO_ASSET_FILES)) {
    const sourcePath = getScenarioUploadPath(sourceScenarioId, assetKey);
    const targetPath = getScenarioUploadPath(targetScenarioId, assetKey);

    if (fs.existsSync(sourcePath)) {
      copyFileIfPresent(sourcePath, targetPath);
    } else {
      removeFileIfPresent(targetPath);
    }
  }
};

const copyGameOptionalAssets = (targetGameId, sourceGameId) => {
  for (const [assetKey] of Object.entries(UPLOADABLE_GAME_ASSET_FILES)) {
    const sourcePath = getGameUploadPath(sourceGameId, assetKey);
    const targetPath = getGameUploadPath(targetGameId, assetKey);

    if (fs.existsSync(sourcePath)) {
      copyFileIfPresent(sourcePath, targetPath);
    } else {
      removeFileIfPresent(targetPath);
    }
  }
};

const normalizeBaseSaveSeedAsset = (assetKey, value) => {
  if (assetKey in STORAGE_JSON_ASSET_FILES) {
    return Array.isArray(value) ? value : cloneJson(JSON_ASSET_DEFAULTS[assetKey]);
  }

  if (assetKey in CORE_JSON_ASSET_FILES || assetKey in OPTIONAL_JSON_ASSET_FILES) {
    return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : cloneJson(JSON_ASSET_DEFAULTS[assetKey]);
  }

  return cloneJson(JSON_ASSET_DEFAULTS[assetKey]);
};

// Reads a "clean" seed asset from the default scenario — used when resetting a
// dirty (runtime-snapshot) scenario/game back to a fresh state.
const readDefaultScenarioJsonAsset = (assetKey) =>
normalizeBaseSaveSeedAsset(
  assetKey,
  readJsonFile(
    getScenarioJsonPath(DEFAULT_SCENARIO_ID, assetKey),
               cloneJson(JSON_ASSET_DEFAULTS[assetKey]),
  ),
);

const normalizeSnapshotString = (value) => String(value ?? "").trim();

const normalizeRecordValue = (value) =>
value && typeof value === "object" && !Array.isArray(value) ? value : {};

const shouldBackfillSeedDatePair = ({
  baseGameDate,
  baseStartDate,
  currentGameDate,
  currentStartDate,
}) =>
(!currentStartDate || currentStartDate === baseStartDate) &&
(!currentGameDate || currentGameDate === baseGameDate || currentGameDate === currentStartDate);

const scenarioLooksLikeRuntimeSnapshot = ({ actions, chat, game, world }) => {
  const hasResolvedActions = Array.isArray(actions)
  ? actions.some((entry) => normalizeSnapshotString(entry?.status).toLowerCase() === "resolved")
  : false;
  const hasChatTranscript = Array.isArray(chat)
  ? chat.some((entry) => Array.isArray(entry?.messages) && entry.messages.length > 0)
  : false;
  const hasTimelineProgress =
  Boolean(normalizeSnapshotString(world?.lastJumpMode)) ||
  Boolean(normalizeSnapshotString(world?.lastJumpSummary)) ||
  Boolean(normalizeSnapshotString(world?.lastJumpTargetDate)) ||
  (Array.isArray(world?.simulationHistory) && world.simulationHistory.length > 0);

  return hasResolvedActions || hasChatTranscript || hasTimelineProgress;
};

const buildFreshGameSeedFromScenario = ({ baseGame, scenarioGame }) => {
  const baseStartDate = normalizeSnapshotString(baseGame?.startDate);
  const baseGameDate = normalizeSnapshotString(baseGame?.gameDate);
  const scenarioStartDate = normalizeSnapshotString(scenarioGame?.startDate);
  const scenarioGameDate = normalizeSnapshotString(scenarioGame?.gameDate);
  const hasCustomStartDate = Boolean(scenarioStartDate) && scenarioStartDate !== baseStartDate;
  const hasCustomGameDate = Boolean(scenarioGameDate) && scenarioGameDate !== baseGameDate;
  const nextStartDate =
  (hasCustomStartDate ? scenarioStartDate : "") ||
  (hasCustomGameDate ? scenarioGameDate : "") ||
  scenarioStartDate ||
  baseStartDate ||
  BUILT_IN_SCENARIO_DEFAULT_DATE;
  const nextGameDate =
  (hasCustomGameDate ? scenarioGameDate : "") ||
  (hasCustomStartDate ? scenarioStartDate : "") ||
  baseGameDate ||
  nextStartDate ||
  BUILT_IN_SCENARIO_DEFAULT_DATE;

  return {
    ...cloneJson(baseGame ?? {}),
    ...(normalizeSnapshotString(scenarioGame?.country)
    ? { country: normalizeSnapshotString(scenarioGame.country) }
    : {}),
    ...(normalizeSnapshotString(scenarioGame?.difficulty)
    ? { difficulty: normalizeSnapshotString(scenarioGame.difficulty) }
    : {}),
    ...(normalizeSnapshotString(scenarioGame?.language)
    ? { language: normalizeSnapshotString(scenarioGame.language) }
    : {}),
    ...(nextStartDate ? { startDate: nextStartDate } : {}),
    ...(nextGameDate ? { gameDate: nextGameDate } : {}),
    round: 1,
  };
};

const buildFreshWorldSeedFromScenario = ({ baseWorld, scenarioWorld }) => {
  const nextWorld = {
    ...cloneJson(baseWorld ?? {}),
  };

  for (const key of TEMPLATE_WORLD_OVERRIDE_KEYS) {
    if (!(key in (scenarioWorld ?? {}))) {
      continue;
    }

    nextWorld[key] = cloneJson(scenarioWorld[key]);
  }

  return nextWorld;
};

const syncBuiltInScenarioSeedDate = () => {
  const targetPath = getScenarioJsonPath(DEFAULT_SCENARIO_ID, "game");
  const baseGame = normalizeRecordValue(readDefaultScenarioJsonAsset("game"));
  const currentGame = normalizeRecordValue(readJsonFile(targetPath, {}));
  const currentStartDate = normalizeSnapshotString(currentGame?.startDate);
  const currentGameDate = normalizeSnapshotString(currentGame?.gameDate);

  if (
    !shouldBackfillSeedDatePair({
      baseGameDate: normalizeSnapshotString(baseGame?.gameDate),
                                baseStartDate: normalizeSnapshotString(baseGame?.startDate),
                                currentGameDate,
                                currentStartDate,
    })
  ) {
    return;
  }

  writeJsonFile(targetPath, {
    ...cloneJson(currentGame),
                gameDate: BUILT_IN_SCENARIO_DEFAULT_DATE,
                startDate: BUILT_IN_SCENARIO_DEFAULT_DATE,
  });
};

const seedScenarioJsonFilesFromScenario = (scenarioId, sourceScenarioId) => {
  const scenarioSnapshot = {
    actions: readJsonFile(getScenarioJsonPath(sourceScenarioId, "actions"), []),
    advisor: readJsonFile(getScenarioJsonPath(sourceScenarioId, "advisor"), []),
    chat: readJsonFile(getScenarioJsonPath(sourceScenarioId, "chat"), []),
    events: readJsonFile(getScenarioJsonPath(sourceScenarioId, "events"), []),
    game: readJsonFile(getScenarioJsonPath(sourceScenarioId, "game"), {}),
    prompts: readJsonFile(getScenarioJsonPath(sourceScenarioId, "prompts"), {}),
    world: readJsonFile(getScenarioJsonPath(sourceScenarioId, "world"), {}),
  };

  if (!scenarioLooksLikeRuntimeSnapshot(scenarioSnapshot)) {
    for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
      copyJsonFile(
        getScenarioJsonPath(sourceScenarioId, assetKey),
                   getScenarioJsonPath(scenarioId, assetKey),
                   JSON_ASSET_DEFAULTS[assetKey],
      );
    }

    copyScenarioOptionalAssets(scenarioId, sourceScenarioId);
    return;
  }

  // Source scenario has runtime state — seed from the default scenario's clean data instead
  const baseSnapshot = {
    actions: readDefaultScenarioJsonAsset("actions"),
    advisor: readDefaultScenarioJsonAsset("advisor"),
    chat: readDefaultScenarioJsonAsset("chat"),
    events: readDefaultScenarioJsonAsset("events"),
    game: readDefaultScenarioJsonAsset("game"),
    prompts: readDefaultScenarioJsonAsset("prompts"),
    world: readDefaultScenarioJsonAsset("world"),
  };

  writeJsonFile(getScenarioJsonPath(scenarioId, "actions"), cloneJson(baseSnapshot.actions));
  writeJsonFile(getScenarioJsonPath(scenarioId, "advisor"), cloneJson(baseSnapshot.advisor));
  writeJsonFile(getScenarioJsonPath(scenarioId, "chat"), cloneJson(baseSnapshot.chat));
  writeJsonFile(getScenarioJsonPath(scenarioId, "events"), cloneJson(baseSnapshot.events));
  writeJsonFile(
    getScenarioJsonPath(scenarioId, "game"),
                buildFreshGameSeedFromScenario({
                  baseGame: baseSnapshot.game,
                  scenarioGame: scenarioSnapshot.game,
                }),
  );
  writeJsonFile(
    getScenarioJsonPath(scenarioId, "prompts"),
                cloneJson(
                  scenarioSnapshot.prompts && typeof scenarioSnapshot.prompts === "object"
                  ? scenarioSnapshot.prompts
                  : baseSnapshot.prompts,
                ),
  );
  writeJsonFile(
    getScenarioJsonPath(scenarioId, "world"),
                buildFreshWorldSeedFromScenario({
                  baseWorld: baseSnapshot.world,
                  scenarioWorld: scenarioSnapshot.world,
                }),
  );

  copyScenarioOptionalAssets(scenarioId, sourceScenarioId);
};

const seedGameJsonFilesFromScenario = (gameId, scenarioId) => {
  const scenarioSnapshot = {
    actions: readJsonFile(getScenarioJsonPath(scenarioId, "actions"), []),
    advisor: readJsonFile(getScenarioJsonPath(scenarioId, "advisor"), []),
    chat: readJsonFile(getScenarioJsonPath(scenarioId, "chat"), []),
    events: readJsonFile(getScenarioJsonPath(scenarioId, "events"), []),
    game: readJsonFile(getScenarioJsonPath(scenarioId, "game"), {}),
    prompts: readJsonFile(getScenarioJsonPath(scenarioId, "prompts"), {}),
    world: readJsonFile(getScenarioJsonPath(scenarioId, "world"), {}),
  };

  if (!scenarioLooksLikeRuntimeSnapshot(scenarioSnapshot)) {
    for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
      copyJsonFile(
        getScenarioJsonPath(scenarioId, assetKey),
                   getGameJsonPath(gameId, assetKey),
                   JSON_ASSET_DEFAULTS[assetKey],
      );
    }
    return;
  }

  // Scenario has runtime state — seed game from the default scenario's clean data instead
  const baseSnapshot = {
    actions: readDefaultScenarioJsonAsset("actions"),
    advisor: readDefaultScenarioJsonAsset("advisor"),
    chat: readDefaultScenarioJsonAsset("chat"),
    events: readDefaultScenarioJsonAsset("events"),
    game: readDefaultScenarioJsonAsset("game"),
    prompts: readDefaultScenarioJsonAsset("prompts"),
    world: readDefaultScenarioJsonAsset("world"),
  };

  writeJsonFile(getGameJsonPath(gameId, "actions"), cloneJson(baseSnapshot.actions));
  writeJsonFile(getGameJsonPath(gameId, "advisor"), cloneJson(baseSnapshot.advisor));
  writeJsonFile(getGameJsonPath(gameId, "chat"), cloneJson(baseSnapshot.chat));
  writeJsonFile(getGameJsonPath(gameId, "events"), cloneJson(baseSnapshot.events));
  writeJsonFile(
    getGameJsonPath(gameId, "game"),
                buildFreshGameSeedFromScenario({
                  baseGame: baseSnapshot.game,
                  scenarioGame: scenarioSnapshot.game,
                }),
  );
  writeJsonFile(
    getGameJsonPath(gameId, "prompts"),
                cloneJson(
                  scenarioSnapshot.prompts && typeof scenarioSnapshot.prompts === "object"
                  ? scenarioSnapshot.prompts
                  : baseSnapshot.prompts,
                ),
  );
  writeJsonFile(
    getGameJsonPath(gameId, "world"),
                buildFreshWorldSeedFromScenario({
                  baseWorld: baseSnapshot.world,
                  scenarioWorld: scenarioSnapshot.world,
                }),
  );
};

const seedGameJsonFilesFromGame = (gameId, sourceGameId) => {
  for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
    copyJsonFile(
      getGameJsonPath(sourceGameId, assetKey),
                 getGameJsonPath(gameId, assetKey),
                 JSON_ASSET_DEFAULTS[assetKey],
    );
  }

  copyGameOptionalAssets(gameId, sourceGameId);
};

const ensureDefaultScenario = () => {
  ensureDirectory(SCENARIOS_DIR);
  const scenarioDir = getScenarioDirectory(DEFAULT_SCENARIO_ID);

  // The built-in scenario is deletable (like the built-in game before it) — a
  // deliberately deleted one must stay deleted across restarts. It is only
  // (re)seeded on a true first run, i.e. before any scenario manifest exists.
  if (fs.existsSync(SCENARIO_MANIFEST_PATH) && !fs.existsSync(scenarioDir)) {
    return;
  }

  ensureDirectory(scenarioDir);
  ensureDirectory(path.join(scenarioDir, "storage"));

  if (!fs.existsSync(getScenarioMetaPath(DEFAULT_SCENARIO_ID))) {
    writeJsonFile(getScenarioMetaPath(DEFAULT_SCENARIO_ID), {
      ...DEFAULT_SCENARIO_META,
      countryNameOverrides: {},
      createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
    });
  }

  syncBuiltInScenarioSeedDate();

  const manifest = getScenarioManifest();
  if (!manifest.order.includes(DEFAULT_SCENARIO_ID)) {
    manifest.order.unshift(DEFAULT_SCENARIO_ID);
  }
  if (!manifest.selectedScenarioId) {
    manifest.selectedScenarioId = DEFAULT_SCENARIO_ID;
  }
  saveScenarioManifest(manifest);
};

const ensureScenarioStore = () => {
  ensureDirectory(SERVER_DATA_DIR);
  ensureDirectory(SCENARIOS_DIR);
  ensureDefaultScenario();
};

const ensureGameStore = () => {
  ensureScenarioStore();
  ensureDirectory(GAMES_DIR);
};

const getScenarioAssetStatus = (scenarioId) => {
  const status = {};

  for (const [assetKey] of Object.entries(UPLOADABLE_SCENARIO_ASSET_FILES)) {
    status[assetKey] = fs.existsSync(getScenarioUploadPath(scenarioId, assetKey));
  }

  return status;
};

const getGameAssetStatus = (gameId) => {
  const status = {};

  for (const [assetKey] of Object.entries(UPLOADABLE_GAME_ASSET_FILES)) {
    status[assetKey] = fs.existsSync(getGameUploadPath(gameId, assetKey));
  }

  return status;
};

const ensureUniqueId = (requestedId, kind) => {
  const normalize = kind === "game" ? normalizeGameId : normalizeScenarioId;
  const getDirectory = kind === "game" ? getGameDirectory : getScenarioDirectory;
  const baseId = normalize(requestedId);
  let nextId = baseId;
  let suffix = 2;

  while (fs.existsSync(getDirectory(nextId))) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
};

const resolveOrderedIds = (manifestOrder, rootDir, defaultId) => {
  const dirs = fs.existsSync(rootDir)
  ? fs.readdirSync(rootDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  : [];

  const known = new Set(manifestOrder ?? []);
  const ordered = [];

  for (const entry of manifestOrder ?? []) {
    if (dirs.includes(entry)) {
      ordered.push(entry);
    }
  }

  for (const entry of dirs) {
    if (!known.has(entry)) {
      ordered.push(entry);
    }
  }

  if (dirs.includes(defaultId) && !ordered.includes(defaultId)) {
    ordered.unshift(defaultId);
  }

  return ordered;
};

const getScenarioUsageCountMap = () => {
  ensureGameStore();
  const counts = new Map();
  const gameOrder = resolveOrderedIds(getGameManifest().order, GAMES_DIR, DEFAULT_GAME_ID);

  for (const gameId of gameOrder) {
    const metaPath = getGameMetaPath(gameId);
    if (!fs.existsSync(metaPath)) {
      continue;
    }

    const gameMeta = readGameMeta(gameId);
    counts.set(gameMeta.scenarioId, (counts.get(gameMeta.scenarioId) ?? 0) + 1);
  }

  return counts;
};

const getScenarioCatalog = () => {
  ensureScenarioStore();
  const usageCounts = getScenarioUsageCountMap();
  const manifest = getScenarioManifest();
  const orderedScenarioIds = resolveOrderedIds(manifest.order, SCENARIOS_DIR, DEFAULT_SCENARIO_ID);

  const scenarios = orderedScenarioIds
  .map((scenarioId) => {
    const metaPath = getScenarioMetaPath(scenarioId);
    if (!fs.existsSync(metaPath)) {
      return null;
    }

    const meta = readScenarioMeta(scenarioId);
    const assetStatus = getScenarioAssetStatus(scenarioId);
    const cacheToken = `${scenarioId}-${meta.updatedAt}`;

    return {
      ...meta,
      assetStatus,
      cacheToken,
      // Every scenario is deletable, the built-in one included (usage by
      // existing games still blocks deletion in deleteScenario).
      canDelete: true,
      coverImageUrl: assetStatus.cover
      ? buildScenarioAssetUrl(scenarioId, COVER_IMAGE_ASSET_KEY, cacheToken)
      : null,
      gameCount: usageCounts.get(scenarioId) ?? 0,
    };
  })
  .filter(Boolean);

  // Fall back to the first scenario that actually exists — the built-in one
  // may have been deleted.
  const selectedScenarioId = scenarios.some((scenario) => scenario.id === manifest.selectedScenarioId)
  ? manifest.selectedScenarioId
  : (scenarios[0]?.id ?? "");

  if (selectedScenarioId !== manifest.selectedScenarioId) {
    saveScenarioManifest({
      ...manifest,
      order: orderedScenarioIds,
      selectedScenarioId,
    });
  }

  return {
    activeScenarioId: selectedScenarioId,
    scenarios,
    selectedScenarioId,
  };
};

const getGameCatalog = () => {
  ensureGameStore();
  const scenarioCatalog = getScenarioCatalog();
  const scenarioLookup = new Map(scenarioCatalog.scenarios.map((scenario) => [scenario.id, scenario]));
  const manifest = getGameManifest();
  const orderedGameIds = resolveOrderedIds(manifest.order, GAMES_DIR, DEFAULT_GAME_ID);

  const games = orderedGameIds
  .map((gameId) => {
    const metaPath = getGameMetaPath(gameId);
    if (!fs.existsSync(metaPath)) {
      return null;
    }

    const meta = readGameMeta(gameId);
    const assetStatus = getGameAssetStatus(gameId);
    const gameData = readJsonFile(getGameJsonPath(gameId, "game"), {});
    const actions = readJsonFile(getGameJsonPath(gameId, "actions"), []);
    const events = readJsonFile(getGameJsonPath(gameId, "events"), []);
    const scenario = scenarioLookup.get(meta.scenarioId) ?? readScenarioMeta(meta.scenarioId);
    const pendingActions = Array.isArray(actions)
    ? actions.filter((entry) => String(entry?.status ?? "").trim() !== "resolved").length
    : 0;
    const cacheToken = `${gameId}-${meta.updatedAt}`;
    const ownCoverImageUrl = assetStatus.cover
    ? buildGameAssetUrl(gameId, COVER_IMAGE_ASSET_KEY, cacheToken)
    : null;

    return {
      ...meta,
      assetStatus,
      cacheToken,
      canDelete: true,
      country: String(gameData?.country ?? "").trim(),
       coverImageUrl: ownCoverImageUrl ?? scenario?.coverImageUrl ?? null,
       currentDate: String(gameData?.gameDate ?? "").trim(),
       eventCount: Array.isArray(events) ? events.length : 0,
       ownCoverImageUrl,
       pendingActions,
       round:
       Number.isFinite(Number(gameData?.round)) && Number(gameData.round) > 0
       ? Math.trunc(Number(gameData.round))
       : 1,
       scenarioAccentColor: scenario?.accentColor ?? meta.accentColor,
       scenarioName: scenario?.name ?? meta.scenarioId,
    };
  })
  .filter(Boolean);

  const activeGameId = games.some((game) => game.id === manifest.activeGameId)
  ? manifest.activeGameId
  : games[0]?.id ?? "";

  if (activeGameId !== manifest.activeGameId) {
    saveGameManifest({
      ...manifest,
      activeGameId,
      order: orderedGameIds,
    });
  }

  return {
    activeGameId,
    games,
  };
};

const getLibraryCatalog = () => {
  const scenarioCatalog = getScenarioCatalog();
  const gameCatalog = getGameCatalog();
  const selectedScenario =
  scenarioCatalog.scenarios.find((scenario) => scenario.id === scenarioCatalog.selectedScenarioId) ??
  scenarioCatalog.scenarios[0] ??
  null;
  const activeGame =
  gameCatalog.games.find((game) => game.id === gameCatalog.activeGameId) ?? gameCatalog.games[0] ?? null;
  const runtimeScenario =
  activeGame && activeGame.scenarioId
  ? scenarioCatalog.scenarios.find((scenario) => scenario.id === activeGame.scenarioId) ?? null
  : null;

  return {
    activeGame,
    activeGameId: gameCatalog.activeGameId,
    activeScenarioId: scenarioCatalog.selectedScenarioId,
    games: gameCatalog.games,
    runtimeScenario,
    scenarios: scenarioCatalog.scenarios,
    selectedScenario,
    selectedScenarioId: scenarioCatalog.selectedScenarioId,
    token:
    activeGame && runtimeScenario
    ? `${activeGame.cacheToken}-${runtimeScenario.updatedAt || runtimeScenario.cacheToken || ""}`
    : activeGame?.cacheToken ?? "",
  };
};

const getScenarioSummary = (scenarioId) => {
  const catalog = getScenarioCatalog();
  const scenario = catalog.scenarios.find((entry) => entry.id === scenarioId);

  if (!scenario) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  return scenario;
};

const getGameSummary = (gameId) => {
  const catalog = getGameCatalog();
  const game = catalog.games.find((entry) => entry.id === gameId);

  if (!game) {
    throw new Error(`Game not found: ${gameId}`);
  }

  return game;
};

const getScenarioDetails = (scenarioId) => {
  const summary = getScenarioSummary(scenarioId);

  return {
    assetStatus: summary.assetStatus,
    data: {
      actions: readJsonFile(getScenarioJsonPath(scenarioId, "actions"), []),
      advisor: readJsonFile(getScenarioJsonPath(scenarioId, "advisor"), []),
      chat: readJsonFile(getScenarioJsonPath(scenarioId, "chat"), []),
      events: readJsonFile(getScenarioJsonPath(scenarioId, "events"), []),
      game: readJsonFile(getScenarioJsonPath(scenarioId, "game"), {}),
      prompts: readJsonFile(getScenarioJsonPath(scenarioId, "prompts"), {}),
      world: readJsonFile(getScenarioJsonPath(scenarioId, "world"), {}),
    },
    scenario: summary,
  };
};

const getGameDetails = (gameId) => {
  const summary = getGameSummary(gameId);

  return {
    assetStatus: summary.assetStatus,
    data: {
      actions: readJsonFile(getGameJsonPath(gameId, "actions"), []),
      advisor: readJsonFile(getGameJsonPath(gameId, "advisor"), []),
      chat: readJsonFile(getGameJsonPath(gameId, "chat"), []),
      events: readJsonFile(getGameJsonPath(gameId, "events"), []),
      game: readJsonFile(getGameJsonPath(gameId, "game"), {}),
      prompts: readJsonFile(getGameJsonPath(gameId, "prompts"), {}),
      world: readJsonFile(getGameJsonPath(gameId, "world"), {}),
    },
    game: summary,
    scenario: getScenarioSummary(summary.scenarioId),
  };
};

const setSelectedScenario = (scenarioId) => {
  ensureScenarioStore();

  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const manifest = getScenarioManifest();
  manifest.selectedScenarioId = scenarioId;
  manifest.order = resolveOrderedIds(manifest.order, SCENARIOS_DIR, DEFAULT_SCENARIO_ID).filter(
    (entry) => entry !== scenarioId,
  );
  manifest.order.unshift(scenarioId);
  saveScenarioManifest(manifest);
  return getLibraryCatalog();
};

const setActiveGame = (gameId) => {
  ensureGameStore();

  if (!fs.existsSync(getGameDirectory(gameId))) {
    throw new Error(`Game not found: ${gameId}`);
  }

  const manifest = getGameManifest();
  manifest.activeGameId = gameId;
  manifest.order = resolveOrderedIds(manifest.order, GAMES_DIR, DEFAULT_GAME_ID).filter(
    (entry) => entry !== gameId,
  );
  manifest.order.unshift(gameId);
  saveGameManifest(manifest);
  return getLibraryCatalog();
};

const mergeJsonAsset = (targetPath, patch, fallback) => {
  const current = readJsonFile(targetPath, fallback);
  const next =
  patch && typeof patch === "object" && !Array.isArray(patch)
  ? { ...current, ...patch }
  : cloneJson(patch);

  writeJsonFile(targetPath, next);
  return next;
};

const createScenario = ({
  accentColor,
  countryNameOverrides,
  description,
  eyebrow,
  heroSubtitle,
  heroTitle,
  id,
  name,
  seedScenarioId,
  setActive,
  subtitle,
} = {}) => {
  ensureScenarioStore();

  const scenarioId = ensureUniqueId(id || name || "scenario", "scenario");
  const scenarioDir = getScenarioDirectory(scenarioId);
  const sourceScenario =
  seedScenarioId && fs.existsSync(getScenarioDirectory(seedScenarioId))
  ? getScenarioSummary(seedScenarioId)
  : null;

  ensureDirectory(scenarioDir);
  ensureDirectory(path.join(scenarioDir, "storage"));

  if (sourceScenario) {
    seedScenarioJsonFilesFromScenario(scenarioId, seedScenarioId);
  } else {
    // Seed from the default scenario's committed files
    for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
      copyJsonFile(
        getScenarioJsonPath(DEFAULT_SCENARIO_ID, assetKey),
                   getScenarioJsonPath(scenarioId, assetKey),
                   JSON_ASSET_DEFAULTS[assetKey],
      );
    }
  }

  const createdAt = new Date().toISOString();
  writeJsonFile(getScenarioMetaPath(scenarioId), {
    accentColor: String(accentColor ?? "").trim() || DEFAULT_SCENARIO_META.accentColor,
                coverImageContentType: sourceScenario?.coverImageContentType ?? null,
                countryNameOverrides:
                countryNameOverrides && typeof countryNameOverrides === "object"
                ? countryNameOverrides
                : {},
                createdAt,
                description:
                String(description ?? "").trim() ||
                String(subtitle ?? "").trim() ||
                String(name ?? "").trim() ||
                DEFAULT_SCENARIO_META.description,
                eyebrow: String(eyebrow ?? "").trim() || DEFAULT_SCENARIO_META.eyebrow,
                heroSubtitle:
                String(heroSubtitle ?? "").trim() ||
                String(description ?? "").trim() ||
                String(subtitle ?? "").trim() ||
                sourceScenario?.heroSubtitle ||
                DEFAULT_SCENARIO_META.heroSubtitle,
                heroTitle:
                String(heroTitle ?? "").trim() ||
                String(name ?? "").trim() ||
                sourceScenario?.heroTitle ||
                DEFAULT_SCENARIO_META.heroTitle,
                name: String(name ?? "").trim() || "Custom Scenario",
                subtitle:
                String(subtitle ?? "").trim() ||
                String(description ?? "").trim() ||
                sourceScenario?.subtitle ||
                DEFAULT_SCENARIO_META.subtitle,
                updatedAt: createdAt,
  });

  const manifest = getScenarioManifest();
  manifest.order = resolveOrderedIds(manifest.order, SCENARIOS_DIR, DEFAULT_SCENARIO_ID).filter(
    (entry) => entry !== scenarioId,
  );
  manifest.order.unshift(scenarioId);
  if (setActive) {
    manifest.selectedScenarioId = scenarioId;
  }
  saveScenarioManifest(manifest);

  return getScenarioDetails(scenarioId);
};

const createGame = ({
  accentColor,
  description,
  eyebrow,
  heroSubtitle,
  heroTitle,
  id,
  name,
  scenarioId,
  seedGameId,
  setActive,
  subtitle,
} = {}) => {
  ensureGameStore();

  const resolvedGameId = ensureUniqueId(id || name || "game", "game");
  const gameDir = getGameDirectory(resolvedGameId);
  ensureDirectory(gameDir);
  ensureDirectory(path.join(gameDir, "storage"));

  let sourceScenario = null;
  let sourceGame = null;

  if (seedGameId && fs.existsSync(getGameDirectory(seedGameId))) {
    sourceGame = getGameSummary(seedGameId);
    seedGameJsonFilesFromGame(resolvedGameId, seedGameId);
  } else {
    const nextScenarioId = String(scenarioId ?? DEFAULT_SCENARIO_ID).trim() || DEFAULT_SCENARIO_ID;
    sourceScenario = getScenarioSummary(nextScenarioId);
    seedGameJsonFilesFromScenario(resolvedGameId, nextScenarioId);
  }

  const createdAt = new Date().toISOString();
  const scenarioSummary = sourceScenario ?? getScenarioSummary(sourceGame?.scenarioId ?? DEFAULT_SCENARIO_ID);
  const seedName = sourceGame?.name ?? scenarioSummary.name;

  writeJsonFile(getGameMetaPath(resolvedGameId), {
    accentColor:
    String(accentColor ?? "").trim() ||
    sourceGame?.accentColor ||
    scenarioSummary.accentColor ||
    DEFAULT_GAME_META.accentColor,
    createdAt,
    description:
    String(description ?? "").trim() ||
    sourceGame?.description ||
    scenarioSummary.description ||
    DEFAULT_GAME_META.description,
    eyebrow:
    String(eyebrow ?? "").trim() ||
    sourceGame?.eyebrow ||
    DEFAULT_GAME_META.eyebrow,
    heroSubtitle:
    String(heroSubtitle ?? "").trim() ||
    sourceGame?.heroSubtitle ||
    scenarioSummary.heroSubtitle ||
    DEFAULT_GAME_META.heroSubtitle,
    heroTitle:
    String(heroTitle ?? "").trim() ||
    sourceGame?.heroTitle ||
    scenarioSummary.heroTitle ||
    DEFAULT_GAME_META.heroTitle,
    name: String(name ?? "").trim() || `${seedName} Session`,
                scenarioId: scenarioSummary.id,
                coverImageContentType: sourceGame?.coverImageContentType ?? null,
                subtitle:
                String(subtitle ?? "").trim() ||
                sourceGame?.subtitle ||
                scenarioSummary.subtitle ||
                DEFAULT_GAME_META.subtitle,
                updatedAt: createdAt,
  });

  const manifest = getGameManifest();
  manifest.order = resolveOrderedIds(manifest.order, GAMES_DIR, DEFAULT_GAME_ID).filter(
    (entry) => entry !== resolvedGameId,
  );
  manifest.order.unshift(resolvedGameId);
  if (setActive) {
    manifest.activeGameId = resolvedGameId;
  }
  saveGameManifest(manifest);

  return getGameDetails(resolvedGameId);
};

const updateScenario = (
  scenarioId,
  {
    accentColor,
    countryNameOverrides,
    description,
    eyebrow,
    game,
    gamePatch,
    heroSubtitle,
    heroTitle,
    name,
    prompts,
    promptsPatch,
    setActive,
    storage,
    subtitle,
    world,
    worldPatch,
  } = {},
) => {
  ensureScenarioStore();

  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const currentMeta = readScenarioMeta(scenarioId);
  writeScenarioMeta(scenarioId, {
    accentColor: String(accentColor ?? currentMeta.accentColor).trim() || currentMeta.accentColor,
                    countryNameOverrides:
                    countryNameOverrides && typeof countryNameOverrides === "object"
                    ? countryNameOverrides
                    : currentMeta.countryNameOverrides,
                    description: String(description ?? currentMeta.description).trim() || currentMeta.description,
                    eyebrow: String(eyebrow ?? currentMeta.eyebrow).trim() || currentMeta.eyebrow,
                    heroSubtitle:
                    String(heroSubtitle ?? currentMeta.heroSubtitle).trim() || currentMeta.heroSubtitle,
                    heroTitle: String(heroTitle ?? currentMeta.heroTitle).trim() || currentMeta.heroTitle,
                    name: String(name ?? currentMeta.name).trim() || currentMeta.name,
                    subtitle: String(subtitle ?? currentMeta.subtitle).trim() || currentMeta.subtitle,
  });

  if (game && typeof game === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "game"), canonicalizeGameCountry(game));
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(getScenarioJsonPath(scenarioId, "game"), canonicalizeGameCountry(gamePatch), JSON_ASSET_DEFAULTS.game);
  }

  if (prompts && typeof prompts === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "prompts"), prompts);
  } else if (promptsPatch && typeof promptsPatch === "object") {
    mergeJsonAsset(
      getScenarioJsonPath(scenarioId, "prompts"),
                   promptsPatch,
                   JSON_ASSET_DEFAULTS.prompts,
    );
  }

  if (world && typeof world === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "world"), canonicalizeWorldCountryRefs(world));
  } else if (worldPatch && typeof worldPatch === "object") {
    mergeJsonAsset(getScenarioJsonPath(scenarioId, "world"), canonicalizeWorldCountryRefs(worldPatch), JSON_ASSET_DEFAULTS.world);
  }

  if (storage && typeof storage === "object") {
    for (const [assetKey, value] of Object.entries(storage)) {
      if (assetKey in STORAGE_JSON_ASSET_FILES) {
        writeJsonFile(getScenarioJsonPath(scenarioId, assetKey), value);
      }
    }
  }

  if (setActive) {
    setSelectedScenario(scenarioId);
  }

  return getScenarioDetails(scenarioId);
};

const updateGame = (
  gameId,
  {
    accentColor,
    description,
    eyebrow,
    game,
    gamePatch,
    heroSubtitle,
    heroTitle,
    name,
    prompts,
    promptsPatch,
    setActive,
    storage,
    subtitle,
    world,
    worldPatch,
  } = {},
) => {
  ensureGameStore();

  if (!fs.existsSync(getGameDirectory(gameId))) {
    throw new Error(`Game not found: ${gameId}`);
  }

  const currentMeta = readGameMeta(gameId);
  writeGameMeta(gameId, {
    accentColor: String(accentColor ?? currentMeta.accentColor).trim() || currentMeta.accentColor,
                description: String(description ?? currentMeta.description).trim() || currentMeta.description,
                eyebrow: String(eyebrow ?? currentMeta.eyebrow).trim() || currentMeta.eyebrow,
                heroSubtitle:
                String(heroSubtitle ?? currentMeta.heroSubtitle).trim() || currentMeta.heroSubtitle,
                heroTitle: String(heroTitle ?? currentMeta.heroTitle).trim() || currentMeta.heroTitle,
                name: String(name ?? currentMeta.name).trim() || currentMeta.name,
                subtitle: String(subtitle ?? currentMeta.subtitle).trim() || currentMeta.subtitle,
  });

  if (game && typeof game === "object") {
    writeJsonFile(getGameJsonPath(gameId, "game"), canonicalizeGameCountry(game));
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(getGameJsonPath(gameId, "game"), canonicalizeGameCountry(gamePatch), JSON_ASSET_DEFAULTS.game);
  }

  if (prompts && typeof prompts === "object") {
    writeJsonFile(getGameJsonPath(gameId, "prompts"), prompts);
  } else if (promptsPatch && typeof promptsPatch === "object") {
    mergeJsonAsset(getGameJsonPath(gameId, "prompts"), promptsPatch, JSON_ASSET_DEFAULTS.prompts);
  }

  if (world && typeof world === "object") {
    writeJsonFile(getGameJsonPath(gameId, "world"), canonicalizeWorldCountryRefs(world));
  } else if (worldPatch && typeof worldPatch === "object") {
    mergeJsonAsset(getGameJsonPath(gameId, "world"), canonicalizeWorldCountryRefs(worldPatch), JSON_ASSET_DEFAULTS.world);
  }

  if (storage && typeof storage === "object") {
    for (const [assetKey, value] of Object.entries(storage)) {
      if (assetKey in STORAGE_JSON_ASSET_FILES) {
        writeJsonFile(getGameJsonPath(gameId, assetKey), value);
      }
    }
  }

  if (setActive) {
    setActiveGame(gameId);
  }

  return getGameDetails(gameId);
};

const deleteScenario = (scenarioId) => {
  ensureScenarioStore();

  const usageCount = getScenarioUsageCountMap().get(scenarioId) ?? 0;
  if (usageCount > 0) {
    throw new Error("This scenario is still used by one or more games.");
  }

  const scenarioDir = getScenarioDirectory(scenarioId);
  const resolved = path.resolve(scenarioDir);
  const resolvedRoot = path.resolve(SCENARIOS_DIR);

  if (!resolved.startsWith(resolvedRoot) || !fs.existsSync(resolved)) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  fs.rmSync(resolved, { force: true, recursive: true });

  const manifest = getScenarioManifest();
  const nextOrder = resolveOrderedIds(manifest.order, SCENARIOS_DIR, DEFAULT_SCENARIO_ID).filter(
    (entry) => entry !== scenarioId,
  );
  // Select the first remaining scenario (the deleted one may have been the
  // built-in default — nothing resurrects it).
  const nextSelectedScenarioId =
  manifest.selectedScenarioId === scenarioId ? (nextOrder[0] ?? "") : manifest.selectedScenarioId;

  saveScenarioManifest({
    order: nextOrder,
    selectedScenarioId: nextSelectedScenarioId,
  });

  return getLibraryCatalog();
};

const deleteGame = (gameId) => {
  ensureGameStore();

  const gameDir = getGameDirectory(gameId);
  const resolved = path.resolve(gameDir);
  const resolvedRoot = path.resolve(GAMES_DIR);

  if (!resolved.startsWith(resolvedRoot) || !fs.existsSync(resolved)) {
    throw new Error(`Game not found: ${gameId}`);
  }

  fs.rmSync(resolved, { force: true, recursive: true });

  const manifest = getGameManifest();
  const nextOrder = resolveOrderedIds(manifest.order, GAMES_DIR, DEFAULT_GAME_ID).filter(
    (entry) => entry !== gameId,
  );
  // Deleting the active game hands off to the next one; deleting the LAST
  // game is fine too — the runtime falls back to the selected scenario's data.
  const nextActiveGameId =
  manifest.activeGameId === gameId ? nextOrder[0] ?? "" : manifest.activeGameId;

  saveGameManifest({
    activeGameId: nextActiveGameId,
    order: nextOrder,
  });

  return getLibraryCatalog();
};

const uploadScenarioAsset = (scenarioId, assetKey, dataBuffer, contentType = "") => {
  ensureScenarioStore();

  if (!(assetKey in UPLOADABLE_SCENARIO_ASSET_FILES)) {
    throw new Error(`Unsupported asset key: ${assetKey}`);
  }

  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const targetPath = getScenarioUploadPath(scenarioId, assetKey);
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, dataBuffer);
  writeScenarioMeta(
    scenarioId,
    assetKey === COVER_IMAGE_ASSET_KEY
    ? { coverImageContentType: normalizeImageContentType(contentType) }
    : {},
  );
  return getScenarioDetails(scenarioId);
};

const removeScenarioAsset = (scenarioId, assetKey) => {
  ensureScenarioStore();

  if (!(assetKey in UPLOADABLE_SCENARIO_ASSET_FILES)) {
    throw new Error(`Unsupported asset key: ${assetKey}`);
  }

  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  removeFileIfPresent(getScenarioUploadPath(scenarioId, assetKey));
  writeScenarioMeta(
    scenarioId,
    assetKey === COVER_IMAGE_ASSET_KEY ? { coverImageContentType: null } : {},
  );
  return getScenarioDetails(scenarioId);
};

const uploadGameAsset = (gameId, assetKey, dataBuffer, contentType = "") => {
  ensureGameStore();

  if (!(assetKey in UPLOADABLE_GAME_ASSET_FILES)) {
    throw new Error(`Unsupported asset key: ${assetKey}`);
  }

  if (!fs.existsSync(getGameDirectory(gameId))) {
    throw new Error(`Game not found: ${gameId}`);
  }

  const targetPath = getGameUploadPath(gameId, assetKey);
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, dataBuffer);
  writeGameMeta(
    gameId,
    assetKey === COVER_IMAGE_ASSET_KEY
    ? { coverImageContentType: normalizeImageContentType(contentType) }
    : {},
  );
  return getGameDetails(gameId);
};

const removeGameAsset = (gameId, assetKey) => {
  ensureGameStore();

  if (!(assetKey in UPLOADABLE_GAME_ASSET_FILES)) {
    throw new Error(`Unsupported asset key: ${assetKey}`);
  }

  if (!fs.existsSync(getGameDirectory(gameId))) {
    throw new Error(`Game not found: ${gameId}`);
  }

  removeFileIfPresent(getGameUploadPath(gameId, assetKey));
  writeGameMeta(
    gameId,
    assetKey === COVER_IMAGE_ASSET_KEY ? { coverImageContentType: null } : {},
  );
  return getGameDetails(gameId);
};

const resolveScenarioUploadAsset = (scenarioId, assetKey) => {
  ensureScenarioStore();

  if (!(assetKey in UPLOADABLE_SCENARIO_ASSET_FILES)) {
    throw new Error(`Unsupported asset key: ${assetKey}`);
  }

  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const sourcePath = getScenarioUploadPath(scenarioId, assetKey);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Asset not found: ${assetKey}`);
  }

  // JSON assets (colors, region/city geojson) download as JSON so the map
  // editor can open a scenario's own map; everything else streams as binary.
  const contentType =
    assetKey === COVER_IMAGE_ASSET_KEY
      ? readScenarioMeta(scenarioId).coverImageContentType || "application/octet-stream"
      : assetKey in OPTIONAL_JSON_ASSET_FILES || assetKey in SCENARIO_GEOJSON_ASSET_FILES
        ? "application/json; charset=utf-8"
        : "application/octet-stream";
  return { contentType, sourcePath };
};

const resolveGameUploadAsset = (gameId, assetKey) => {
  ensureGameStore();

  if (!(assetKey in UPLOADABLE_GAME_ASSET_FILES)) {
    throw new Error(`Unsupported asset key: ${assetKey}`);
  }

  if (!fs.existsSync(getGameDirectory(gameId))) {
    throw new Error(`Game not found: ${gameId}`);
  }

  const sourcePath = getGameUploadPath(gameId, assetKey);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Asset not found: ${assetKey}`);
  }

  return {
    contentType:
    assetKey === COVER_IMAGE_ASSET_KEY
    ? readGameMeta(gameId).coverImageContentType || "application/octet-stream"
    : "application/octet-stream",
    sourcePath,
  };
};

const getSelectedScenarioSummary = () => {
  const catalog = getScenarioCatalog();
  return (
    catalog.scenarios.find((scenario) => scenario.id === catalog.selectedScenarioId) ??
    catalog.scenarios[0]
  );
};

const getActiveGameSummary = () => {
  const catalog = getGameCatalog();
  return catalog.games.find((game) => game.id === catalog.activeGameId) ?? catalog.games[0];
};

const getActiveGameId = () => getGameCatalog().activeGameId;

const getActiveRuntimeScenarioSummary = () => {
  const activeGame = getActiveGameSummary();
  if (!activeGame) {
    return getScenarioSummary(DEFAULT_SCENARIO_ID);
  }

  return getScenarioSummary(activeGame.scenarioId);
};

// Every scenario renders the custom map style: worlds that never set the flag
// (fresh scenarios, old imported bundles) get it injected in the SERVED payload
// — their geometry is the Modern Day fallback in readRuntimeJsonAsset, and
// their ownership overrides recolor it. Nothing is written to disk.
const normalizeRuntimeWorld = (assetKey, data) => {
  if (assetKey !== "world" || !data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  return data.customRegions ? data : { ...data, customRegions: true };
};

const readRuntimeJsonAsset = (assetKey) => {
  ensureGameStore();

  // Custom region/city geometry is scenario-scoped (static map data). Resolve it
  // from the active game's scenario, mirroring how pmtiles overrides resolve.
  if (assetKey in SCENARIO_GEOJSON_ASSET_FILES) {
    const scenario = getActiveRuntimeScenarioSummary();
    let sourcePath = getScenarioUploadPath(scenario.id, assetKey);
    if (!fs.existsSync(sourcePath)) {
      sourcePath = null;
      // Scenarios without a map of their own use the built-in Modern Day
      // geometry, so EVERY scenario renders with the custom map style (the
      // scenario's ownership overrides still recolor it). Cities stay absent
      // unless the scenario ships its own set.
      if (assetKey === "regionsGeojson" && scenario.id !== DEFAULT_SCENARIO_ID) {
        const defaultPath = getScenarioUploadPath(DEFAULT_SCENARIO_ID, assetKey);
        if (fs.existsSync(defaultPath)) sourcePath = defaultPath;
      }
    }
    return {
      contentType: "application/json; charset=utf-8",
      data: sourcePath ? readJsonFile(sourcePath, EMPTY_FEATURE_COLLECTION) : cloneJson(EMPTY_FEATURE_COLLECTION),
      sourcePath,
    };
  }

  // No games yet — runtime data resolves from the scenario below.
  const activeGame = getActiveGameSummary();
  const gamePath =
  activeGame && (assetKey in JSON_ASSET_FILES || assetKey in OPTIONAL_JSON_ASSET_FILES)
  ? getGameJsonPath(activeGame.id, assetKey)
  : null;

  if (gamePath && fs.existsSync(gamePath)) {
    return {
      contentType: "application/json; charset=utf-8",
      data: normalizeRuntimeWorld(assetKey, readJsonFile(gamePath, JSON_ASSET_DEFAULTS[assetKey] ?? {})),
      sourcePath: gamePath,
    };
  }

  const scenario = getActiveRuntimeScenarioSummary();
  const scenarioPath =
  assetKey in JSON_ASSET_FILES || assetKey in OPTIONAL_JSON_ASSET_FILES
  ? getScenarioJsonPath(scenario.id, assetKey)
  : null;

  if (scenarioPath && fs.existsSync(scenarioPath)) {
    return {
      contentType: "application/json; charset=utf-8",
      data: normalizeRuntimeWorld(assetKey, readJsonFile(scenarioPath, JSON_ASSET_DEFAULTS[assetKey] ?? {})),
      sourcePath: scenarioPath,
    };
  }

  if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
    const fallbackPath = resolveColorsAssetFile();
    if (!fallbackPath) {
      return {
        contentType: "application/json; charset=utf-8",
        data: {},
        sourcePath: null,
      };
    }

    return {
      contentType: "application/json; charset=utf-8",
      data: readJsonFile(fallbackPath, {}),
      sourcePath: fallbackPath,
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    data: cloneJson(JSON_ASSET_DEFAULTS[assetKey] ?? {}),
    sourcePath: null,
  };
};

const writeRuntimeJsonAsset = (assetKey, value) => {
  ensureGameStore();

  if (!(assetKey in JSON_ASSET_FILES) && !(assetKey in OPTIONAL_JSON_ASSET_FILES)) {
    throw new Error(`Unsupported JSON asset key: ${assetKey}`);
  }

  let activeGameId = getActiveGameId();
  if (!activeGameId) {
    // With every game deleted, the map still renders (reads fall back to the
    // selected scenario) so play LOOKS possible — but there was nowhere to
    // save, and every AI feature died on this guard. The first stateful
    // interaction now quietly creates a real session from the selected
    // scenario instead, which is how it always felt back when a built-in
    // game guaranteed a write target.
    const scenario = getSelectedScenarioSummary();
    if (!scenario) {
      throw new Error("No active game — start a game from a scenario first.");
    }
    const details = createGame({
      name: `${scenario.name} Session`,
      scenarioId: scenario.id,
      setActive: true,
    });
    activeGameId = details.game.id;
    console.log(`No active game — created "${activeGameId}" from scenario "${scenario.id}".`);
  }
  // Authors and the AI may reference countries by full name anywhere; the
  // stored form is canonical (see canonicalizeCountryRef).
  let canonical = value;
  if (assetKey === "world") {
    canonical = canonicalizeWorldCountryRefs(value);
  } else if (assetKey === "game") {
    canonical = canonicalizeGameCountry(value);
  } else if (assetKey === "colors") {
    const worldPath = getGameJsonPath(activeGameId, "world");
    const worldContext = fs.existsSync(worldPath) ? readJsonFile(worldPath, {}) : null;
    canonical = canonicalizeColorKeys(value, worldContext);
  }

  const targetPath = getGameJsonPath(activeGameId, assetKey);
  writeJsonFile(targetPath, canonical);
  writeGameMeta(activeGameId, {});
  return readRuntimeJsonAsset(assetKey);
};

const resolveRuntimeBinaryAsset = (assetKey) => {
  ensureGameStore();

  if (!(assetKey in PMTILES_ASSET_FILES)) {
    throw new Error(`Unsupported PMTiles asset key: ${assetKey}`);
  }

  const scenario = getActiveRuntimeScenarioSummary();
  const scenarioOverridePath = getScenarioUploadPath(scenario.id, assetKey);

  if (fs.existsSync(scenarioOverridePath)) {
    return {
      contentType: "application/octet-stream",
      sourcePath: scenarioOverridePath,
    };
  }

  const fallbackPath = path.join(PMTILES_ASSETS_DIR, PMTILES_ASSET_FILES[assetKey]);
  if (!fs.existsSync(fallbackPath)) {
    throw new Error(`No PMTiles archive available for ${assetKey}.`);
  }

  return {
    contentType: "application/octet-stream",
    sourcePath: fallbackPath,
  };
};

const encodeBinaryFile = (sourcePath) => fs.readFileSync(sourcePath).toString("base64");

const buildScenarioBundleAsset = (scenarioId, assetKey, mode) => {
  if (assetKey === COVER_IMAGE_ASSET_KEY) {
    const uploadPath = getScenarioUploadPath(scenarioId, assetKey);
    if (!fs.existsSync(uploadPath)) {
      return {
        fileName: SCENARIO_IMAGE_ASSET_FILES[assetKey],
        mode: "default",
      };
    }

    return {
      contentType: readScenarioMeta(scenarioId).coverImageContentType || "application/octet-stream",
      data: encodeBinaryFile(uploadPath),
      encoding: "base64",
      fileName: SCENARIO_IMAGE_ASSET_FILES[assetKey],
      mode: "embedded",
    };
  }

  if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
    const scenarioPath = getScenarioJsonPath(scenarioId, assetKey);
    if (fs.existsSync(scenarioPath)) {
      return {
        data: readJsonFile(scenarioPath, {}),
        fileName: OPTIONAL_JSON_ASSET_FILES[assetKey],
        mode: "embedded",
      };
    }

    return {
      fileName: OPTIONAL_JSON_ASSET_FILES[assetKey],
      mode: "default",
    };
  }

  // Custom region geometry IS the map, so always embed it (even in "light"
  // mode) — a shared custom map is broken without its geometry.
  if (assetKey in SCENARIO_GEOJSON_ASSET_FILES) {
    const geojsonPath = getScenarioUploadPath(scenarioId, assetKey);
    if (!fs.existsSync(geojsonPath)) {
      return { fileName: SCENARIO_GEOJSON_ASSET_FILES[assetKey], mode: "default" };
    }

    return {
      contentType: "application/json",
      data: encodeBinaryFile(geojsonPath),
      encoding: "base64",
      fileName: SCENARIO_GEOJSON_ASSET_FILES[assetKey],
      mode: "embedded",
    };
  }

  const uploadPath = getScenarioUploadPath(scenarioId, assetKey);
  if (!fs.existsSync(uploadPath) || mode !== "full") {
    return {
      droppedOverride: fs.existsSync(uploadPath) && mode !== "full",
      fileName: PMTILES_ASSET_FILES[assetKey],
      mode: "default",
    };
  }

  return {
    contentType: "application/octet-stream",
    data: encodeBinaryFile(uploadPath),
    encoding: "base64",
    fileName: PMTILES_ASSET_FILES[assetKey],
    mode: "embedded",
  };
};

const exportScenarioBundle = (scenarioId, { mode = "light" } = {}) => {
  const summary = getScenarioSummary(scenarioId);
  const details = getScenarioDetails(scenarioId);

  return {
    assets: {
      cover: buildScenarioBundleAsset(scenarioId, "cover", mode),
      cities: buildScenarioBundleAsset(scenarioId, "cities", mode),
      colors: buildScenarioBundleAsset(scenarioId, "colors", mode),
      countries: buildScenarioBundleAsset(scenarioId, "countries", mode),
      regions: buildScenarioBundleAsset(scenarioId, "regions", mode),
      regionsGeojson: buildScenarioBundleAsset(scenarioId, "regionsGeojson", mode),
      citiesGeojson: buildScenarioBundleAsset(scenarioId, "citiesGeojson", mode),
      // The custom map background travels with the scenario (always embedded, like
      // the geometry) so a shared/imported custom map isn't blank.
      backgroundData: buildScenarioBundleAsset(scenarioId, "backgroundData", mode),
    },
    data: {
      actions: cloneJson(details.data.actions),
      advisor: cloneJson(details.data.advisor),
      chat: cloneJson(details.data.chat),
      events: cloneJson(details.data.events),
      game: cloneJson(details.data.game),
      prompts: cloneJson(details.data.prompts),
      world: cloneJson(details.data.world),
    },
    exportedAt: new Date().toISOString(),
    mode: mode === "full" ? "full" : "light",
    scenario: {
      accentColor: summary.accentColor,
      countryNameOverrides: cloneJson(summary.countryNameOverrides),
      description: summary.description,
      eyebrow: summary.eyebrow,
      heroSubtitle: summary.heroSubtitle,
      heroTitle: summary.heroTitle,
      id: summary.id,
      name: summary.name,
      subtitle: summary.subtitle,
    },
    schema: SCENARIO_BUNDLE_SCHEMA,
    version: SCENARIO_BUNDLE_VERSION,
  };
};

const importScenarioBundle = (bundle, { setSelected = true } = {}) => {
  ensureScenarioStore();

  if (!bundle || typeof bundle !== "object") {
    throw new Error("Scenario bundle must be a JSON object.");
  }

  if (bundle.schema !== SCENARIO_BUNDLE_SCHEMA) {
    throw new Error("Unsupported scenario bundle schema.");
  }

  const scenario = bundle.scenario && typeof bundle.scenario === "object" ? bundle.scenario : {};
  const data = bundle.data && typeof bundle.data === "object" ? bundle.data : {};
  const assets = bundle.assets && typeof bundle.assets === "object" ? bundle.assets : {};

  const created = createScenario({
    accentColor: scenario.accentColor,
    countryNameOverrides: scenario.countryNameOverrides,
    description: scenario.description,
    eyebrow: scenario.eyebrow,
    heroSubtitle: scenario.heroSubtitle,
    heroTitle: scenario.heroTitle,
    id: scenario.id,
    name: scenario.name,
    setActive: false,
    subtitle: scenario.subtitle,
  });

  const scenarioId = created.scenario.id;

  updateScenario(scenarioId, {
    game: data.game ?? {},
    prompts: data.prompts ?? {},
    storage: {
      actions: data.actions ?? [],
      advisor: data.advisor ?? [],
      chat: data.chat ?? [],
      events: data.events ?? [],
    },
    world: data.world ?? {},
  });

  for (const [assetKey, assetValue] of Object.entries(assets)) {
    if (!(assetKey in UPLOADABLE_SCENARIO_ASSET_FILES)) {
      continue;
    }

    if (assetKey === COVER_IMAGE_ASSET_KEY) {
      if (assetValue?.mode === "embedded") {
        const decoded = Buffer.from(String(assetValue.data ?? ""), "base64");
        fs.writeFileSync(getScenarioUploadPath(scenarioId, assetKey), decoded);
        writeScenarioMeta(scenarioId, {
          coverImageContentType: normalizeImageContentType(assetValue.contentType),
        });
      } else {
        removeFileIfPresent(getScenarioUploadPath(scenarioId, assetKey));
        writeScenarioMeta(scenarioId, { coverImageContentType: null });
      }
      continue;
    }

    if (assetValue?.mode === "embedded") {
      if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
        writeJsonFile(getScenarioJsonPath(scenarioId, assetKey), assetValue.data ?? {});
      } else {
        const decoded = Buffer.from(String(assetValue.data ?? ""), "base64");
        fs.writeFileSync(getScenarioUploadPath(scenarioId, assetKey), decoded);
      }
      continue;
    }


    if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
      removeFileIfPresent(getScenarioJsonPath(scenarioId, assetKey));
    }
    removeFileIfPresent(getScenarioUploadPath(scenarioId, assetKey));
  }

  writeScenarioMeta(scenarioId, {});

  if (setSelected) {
    setSelectedScenario(scenarioId);
  }

  return getScenarioDetails(scenarioId);
};

export {
  createGame,
  createScenario,
  deleteGame,
  deleteScenario,
  ensureGameStore,
  ensureScenarioStore,
  exportScenarioBundle,
  getActiveGameSummary,
  getGameCatalog,
  getGameDetails,
  getLibraryCatalog,
  getScenarioCatalog,
  getScenarioDetails,
  getSelectedScenarioSummary,
  importScenarioBundle,
  readRuntimeJsonAsset,
  removeGameAsset,
  removeScenarioAsset,
  resolveGameUploadAsset,
  resolveScenarioUploadAsset,
  resolveRuntimeBinaryAsset,
  setActiveGame,
  setSelectedScenario,
  updateGame,
  updateScenario,
  uploadGameAsset,
  uploadScenarioAsset,
  writeRuntimeJsonAsset,
};
