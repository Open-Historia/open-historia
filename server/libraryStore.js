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

const DEFAULT_BASE_SAVE_ID = "save0";
const DEFAULT_SCENARIO_ID = "default";
const DEFAULT_GAME_ID = "default";
const BUILT_IN_SCENARIO_DEFAULT_DATE = "2016-01-01";
const SCENARIO_BUNDLE_SCHEMA = "pax-historia-scenario-bundle";
const SCENARIO_BUNDLE_VERSION = 1;

const DEFAULT_SCENARIO_META = {
  accentColor: "#7c3aed",
  baseSaveId: DEFAULT_BASE_SAVE_ID,
  description: "Server-backed base scenario",
  eyebrow: "Scenario",
  heroSubtitle: "Editable server-backed scenario template.",
  heroTitle: "Modern Day",
  name: "Modern Day",
  subtitle: "Base template",
};

const DEFAULT_GAME_META = {
  accentColor: "#7c3aed",
  baseSaveId: DEFAULT_BASE_SAVE_ID,
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
  "difficulty",
  "language",
  "notes",
  "polityOverrides",
  "regionOwnershipOverrides",
  "simulationRules",
  "startingTimelineText",
];

const BASE_ASSET_CANDIDATES = {
  colors: [
    path.join(DIST_DIR, "assets", "colors.json"),
    path.join(PUBLIC_DIR, "assets", "colors.json"),
  ],
};

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

const listBaseSaveIds = () => {
  const candidates = [path.join(DIST_DIR, "saves"), path.join(PUBLIC_DIR, "saves")];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        seen.add(entry.name);
      }
    }
  }

  return Array.from(seen).sort((left, right) => left.localeCompare(right));
};

const resolveBaseSaveFile = (baseSaveId, relativePath) => {
  const candidates = [
    path.join(DIST_DIR, "saves", baseSaveId, relativePath),
    path.join(PUBLIC_DIR, "saves", baseSaveId, relativePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveBaseAssetFile = (assetKey) => {
  const candidates = BASE_ASSET_CANDIDATES[assetKey] ?? [];

  for (const candidate of candidates) {
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

const getScenarioDirectory = (scenarioId) => path.join(SCENARIOS_DIR, scenarioId);
const getScenarioMetaPath = (scenarioId) => path.join(getScenarioDirectory(scenarioId), "scenario.json");
const getScenarioJsonPath = (scenarioId, assetKey) =>
  path.join(
    getScenarioDirectory(scenarioId),
    JSON_ASSET_FILES[assetKey] ?? OPTIONAL_JSON_ASSET_FILES[assetKey],
  );
const getScenarioUploadPath = (scenarioId, assetKey) =>
  path.join(getScenarioDirectory(scenarioId), UPLOADABLE_SCENARIO_ASSET_FILES[assetKey]);

const getGameDirectory = (gameId) => path.join(GAMES_DIR, gameId);
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
      activeGameId: String(manifest.activeGameId ?? "").trim() || DEFAULT_GAME_ID,
      order: manifest.order,
      version: 2,
    };
  }

  return {
    activeGameId: DEFAULT_GAME_ID,
    order: [DEFAULT_GAME_ID],
    version: 2,
  };
};

const saveGameManifest = (manifest) => {
  writeJsonFile(GAME_MANIFEST_PATH, {
    activeGameId: manifest.activeGameId,
    order: Array.from(new Set(manifest.order ?? [DEFAULT_GAME_ID])),
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
    baseSaveId: String(raw?.baseSaveId ?? "").trim() || DEFAULT_BASE_SAVE_ID,
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
    baseSaveId: String(updates?.baseSaveId ?? current.baseSaveId).trim() || current.baseSaveId,
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
    baseSaveId: String(raw?.baseSaveId ?? "").trim() || DEFAULT_BASE_SAVE_ID,
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
    baseSaveId: String(updates?.baseSaveId ?? current.baseSaveId).trim() || current.baseSaveId,
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

const readBaseSaveJsonAsset = (baseSaveId, assetKey) =>
  normalizeBaseSaveSeedAsset(
    assetKey,
    readJsonFile(
      resolveBaseSaveFile(baseSaveId, JSON_ASSET_FILES[assetKey]),
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
    baseStartDate;
  const nextGameDate =
    (hasCustomGameDate ? scenarioGameDate : "") ||
    (hasCustomStartDate ? scenarioStartDate : "") ||
    baseGameDate ||
    nextStartDate;

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
  const baseGame = normalizeRecordValue(readBaseSaveJsonAsset(DEFAULT_BASE_SAVE_ID, "game"));
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

const syncBuiltInDefaultGameDate = () => {
  const gameDataPath = getGameJsonPath(DEFAULT_GAME_ID, "game");
  const currentGame = normalizeRecordValue(readJsonFile(gameDataPath, {}));
  const snapshot = {
    actions: readJsonFile(getGameJsonPath(DEFAULT_GAME_ID, "actions"), []),
    chat: readJsonFile(getGameJsonPath(DEFAULT_GAME_ID, "chat"), []),
    events: readJsonFile(getGameJsonPath(DEFAULT_GAME_ID, "events"), []),
    game: currentGame,
    world: readJsonFile(getGameJsonPath(DEFAULT_GAME_ID, "world"), {}),
  };

  if (
    scenarioLooksLikeRuntimeSnapshot(snapshot) ||
    (Array.isArray(snapshot.events) && snapshot.events.length > 0) ||
    Number(currentGame?.round ?? 1) > 1
  ) {
    return;
  }

  const baseGame = normalizeRecordValue(readBaseSaveJsonAsset(DEFAULT_BASE_SAVE_ID, "game"));
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

  const scenarioGame = normalizeRecordValue(readJsonFile(getScenarioJsonPath(DEFAULT_SCENARIO_ID, "game"), {}));
  const startDate =
    normalizeSnapshotString(scenarioGame?.startDate) || BUILT_IN_SCENARIO_DEFAULT_DATE;
  const gameDate = normalizeSnapshotString(scenarioGame?.gameDate) || startDate;

  writeJsonFile(gameDataPath, {
    ...cloneJson(currentGame),
    ...(gameDate ? { gameDate } : {}),
    ...(startDate ? { startDate } : {}),
  });
};

const seedScenarioJsonFilesFromBaseSave = (scenarioId, baseSaveId) => {
  for (const [assetKey, relativePath] of Object.entries(JSON_ASSET_FILES)) {
    const sourcePath = resolveBaseSaveFile(baseSaveId, relativePath);
    copyJsonFile(sourcePath, getScenarioJsonPath(scenarioId, assetKey), JSON_ASSET_DEFAULTS[assetKey]);
  }
};

const seedScenarioJsonFilesFromScenario = (scenarioId, sourceScenarioId) => {
  const scenarioMeta = readScenarioMeta(sourceScenarioId);
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

  const baseSaveId = normalizeSnapshotString(scenarioMeta.baseSaveId) || DEFAULT_BASE_SAVE_ID;
  const baseSnapshot = {
    actions: readBaseSaveJsonAsset(baseSaveId, "actions"),
    advisor: readBaseSaveJsonAsset(baseSaveId, "advisor"),
    chat: readBaseSaveJsonAsset(baseSaveId, "chat"),
    events: readBaseSaveJsonAsset(baseSaveId, "events"),
    game: readBaseSaveJsonAsset(baseSaveId, "game"),
    prompts: readBaseSaveJsonAsset(baseSaveId, "prompts"),
    world: readBaseSaveJsonAsset(baseSaveId, "world"),
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
  const scenarioMeta = readScenarioMeta(scenarioId);
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

  const baseSaveId = normalizeSnapshotString(scenarioMeta.baseSaveId) || DEFAULT_BASE_SAVE_ID;
  const baseSnapshot = {
    actions: readBaseSaveJsonAsset(baseSaveId, "actions"),
    advisor: readBaseSaveJsonAsset(baseSaveId, "advisor"),
    chat: readBaseSaveJsonAsset(baseSaveId, "chat"),
    events: readBaseSaveJsonAsset(baseSaveId, "events"),
    game: readBaseSaveJsonAsset(baseSaveId, "game"),
    prompts: readBaseSaveJsonAsset(baseSaveId, "prompts"),
    world: readBaseSaveJsonAsset(baseSaveId, "world"),
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

  for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
    const targetPath = getScenarioJsonPath(DEFAULT_SCENARIO_ID, assetKey);
    if (!fs.existsSync(targetPath)) {
      seedScenarioJsonFilesFromBaseSave(DEFAULT_SCENARIO_ID, DEFAULT_BASE_SAVE_ID);
      break;
    }
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

const ensureDefaultGame = () => {
  ensureDirectory(GAMES_DIR);
  const gameDir = getGameDirectory(DEFAULT_GAME_ID);

  ensureDirectory(gameDir);
  ensureDirectory(path.join(gameDir, "storage"));

  const scenarioMeta = readScenarioMeta(DEFAULT_SCENARIO_ID);

  if (!fs.existsSync(getGameMetaPath(DEFAULT_GAME_ID))) {
    writeJsonFile(getGameMetaPath(DEFAULT_GAME_ID), {
      ...DEFAULT_GAME_META,
      accentColor: scenarioMeta.accentColor,
      baseSaveId: scenarioMeta.baseSaveId,
      createdAt: new Date().toISOString(),
      heroSubtitle: scenarioMeta.heroSubtitle,
      heroTitle: scenarioMeta.heroTitle,
      name: `${scenarioMeta.name} Session`,
      scenarioId: DEFAULT_SCENARIO_ID,
      subtitle: scenarioMeta.subtitle,
      updatedAt: new Date().toISOString(),
    });
  }

  for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
    const targetPath = getGameJsonPath(DEFAULT_GAME_ID, assetKey);
    if (!fs.existsSync(targetPath)) {
      seedGameJsonFilesFromScenario(DEFAULT_GAME_ID, DEFAULT_SCENARIO_ID);
      break;
    }
  }

  if (readGameMeta(DEFAULT_GAME_ID).scenarioId === DEFAULT_SCENARIO_ID) {
    syncBuiltInDefaultGameDate();
  }

  const manifest = getGameManifest();
  if (!manifest.order.includes(DEFAULT_GAME_ID)) {
    manifest.order.unshift(DEFAULT_GAME_ID);
  }
  if (!manifest.activeGameId) {
    manifest.activeGameId = DEFAULT_GAME_ID;
  }
  saveGameManifest(manifest);
};

const ensureScenarioStore = () => {
  ensureDirectory(SERVER_DATA_DIR);
  ensureDirectory(SCENARIOS_DIR);
  ensureDefaultScenario();
};

const ensureGameStore = () => {
  ensureScenarioStore();
  ensureDirectory(GAMES_DIR);
  ensureDefaultGame();
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
        canDelete: scenarioId !== DEFAULT_SCENARIO_ID,
        coverImageUrl: assetStatus.cover
          ? buildScenarioAssetUrl(scenarioId, COVER_IMAGE_ASSET_KEY, cacheToken)
          : null,
        gameCount: usageCounts.get(scenarioId) ?? 0,
      };
    })
    .filter(Boolean);

  const selectedScenarioId = scenarios.some((scenario) => scenario.id === manifest.selectedScenarioId)
    ? manifest.selectedScenarioId
    : DEFAULT_SCENARIO_ID;

  if (selectedScenarioId !== manifest.selectedScenarioId) {
    saveScenarioManifest({
      ...manifest,
      order: orderedScenarioIds,
      selectedScenarioId,
    });
  }

  return {
    activeScenarioId: selectedScenarioId,
    baseSaves: listBaseSaveIds(),
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
        canDelete: gameId !== DEFAULT_GAME_ID,
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
    : DEFAULT_GAME_ID;

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
    baseSaves: scenarioCatalog.baseSaves,
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
  baseSaveId,
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
  const resolvedBaseSaveId = String(baseSaveId ?? DEFAULT_BASE_SAVE_ID).trim() || DEFAULT_BASE_SAVE_ID;
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
    seedScenarioJsonFilesFromBaseSave(scenarioId, resolvedBaseSaveId);
  }

  const createdAt = new Date().toISOString();
  writeJsonFile(getScenarioMetaPath(scenarioId), {
    accentColor: String(accentColor ?? "").trim() || DEFAULT_SCENARIO_META.accentColor,
    baseSaveId: resolvedBaseSaveId,
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
    baseSaveId: scenarioSummary.baseSaveId,
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
    writeJsonFile(getScenarioJsonPath(scenarioId, "game"), game);
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(getScenarioJsonPath(scenarioId, "game"), gamePatch, JSON_ASSET_DEFAULTS.game);
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
    writeJsonFile(getScenarioJsonPath(scenarioId, "world"), world);
  } else if (worldPatch && typeof worldPatch === "object") {
    mergeJsonAsset(getScenarioJsonPath(scenarioId, "world"), worldPatch, JSON_ASSET_DEFAULTS.world);
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
    writeJsonFile(getGameJsonPath(gameId, "game"), game);
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(getGameJsonPath(gameId, "game"), gamePatch, JSON_ASSET_DEFAULTS.game);
  }

  if (prompts && typeof prompts === "object") {
    writeJsonFile(getGameJsonPath(gameId, "prompts"), prompts);
  } else if (promptsPatch && typeof promptsPatch === "object") {
    mergeJsonAsset(getGameJsonPath(gameId, "prompts"), promptsPatch, JSON_ASSET_DEFAULTS.prompts);
  }

  if (world && typeof world === "object") {
    writeJsonFile(getGameJsonPath(gameId, "world"), world);
  } else if (worldPatch && typeof worldPatch === "object") {
    mergeJsonAsset(getGameJsonPath(gameId, "world"), worldPatch, JSON_ASSET_DEFAULTS.world);
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

  if (scenarioId === DEFAULT_SCENARIO_ID) {
    throw new Error("The default scenario cannot be deleted.");
  }

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
  const nextSelectedScenarioId =
    manifest.selectedScenarioId === scenarioId ? DEFAULT_SCENARIO_ID : manifest.selectedScenarioId;

  saveScenarioManifest({
    order: nextOrder.length > 0 ? nextOrder : [DEFAULT_SCENARIO_ID],
    selectedScenarioId: nextSelectedScenarioId,
  });

  return getLibraryCatalog();
};

const deleteGame = (gameId) => {
  ensureGameStore();

  if (gameId === DEFAULT_GAME_ID) {
    throw new Error("The default game cannot be deleted.");
  }

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
  const nextActiveGameId =
    manifest.activeGameId === gameId ? DEFAULT_GAME_ID : manifest.activeGameId;

  saveGameManifest({
    activeGameId: nextActiveGameId,
    order: nextOrder.length > 0 ? nextOrder : [DEFAULT_GAME_ID],
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

  if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
    throw new Error(`Asset ${assetKey} is not a binary download.`);
  }

  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const sourcePath = getScenarioUploadPath(scenarioId, assetKey);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Asset not found: ${assetKey}`);
  }

  return {
    contentType:
      assetKey === COVER_IMAGE_ASSET_KEY
        ? readScenarioMeta(scenarioId).coverImageContentType || "application/octet-stream"
        : "application/octet-stream",
    sourcePath,
  };
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

const readRuntimeJsonAsset = (assetKey) => {
  ensureGameStore();

  const activeGame = getActiveGameSummary();
  const gamePath =
    assetKey in JSON_ASSET_FILES || assetKey in OPTIONAL_JSON_ASSET_FILES
      ? getGameJsonPath(activeGame.id, assetKey)
      : null;

  if (gamePath && fs.existsSync(gamePath)) {
    return {
      contentType: "application/json; charset=utf-8",
      data: readJsonFile(gamePath, JSON_ASSET_DEFAULTS[assetKey] ?? {}),
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
      data: readJsonFile(scenarioPath, JSON_ASSET_DEFAULTS[assetKey] ?? {}),
      sourcePath: scenarioPath,
    };
  }

  if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
    const fallbackPath = resolveBaseAssetFile(assetKey);
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

  const activeGameId = getActiveGameId();
  const targetPath = getGameJsonPath(activeGameId, assetKey);
  writeJsonFile(targetPath, value);
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

  const activeGame = getActiveGameSummary();
  const fallbackPath = resolveBaseSaveFile(activeGame.baseSaveId, PMTILES_ASSET_FILES[assetKey]);
  if (!fallbackPath) {
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
      baseSaveId: summary.baseSaveId,
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
    baseSaveId: scenario.baseSaveId,
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

    removeFileIfPresent(getScenarioJsonPath(scenarioId, assetKey));
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
