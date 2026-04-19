import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const SERVER_DATA_DIR = path.join(__dirname, "data");
const SCENARIOS_DIR = path.join(SERVER_DATA_DIR, "scenarios");
const MANIFEST_PATH = path.join(SERVER_DATA_DIR, "scenario-manifest.json");

const DEFAULT_BASE_SAVE_ID = "save0";
const DEFAULT_SCENARIO_ID = "default";
const DEFAULT_SCENARIO_META = {
  accentColor: "#7c3aed",
  baseSaveId: DEFAULT_BASE_SAVE_ID,
  description: "Server-backed base scenario",
  eyebrow: "Live Scenario",
  heroSubtitle: "Lightweight scenario overrides stored on the server.",
  heroTitle: "Modern Day",
  name: "Modern Day",
  subtitle: "Base save0 configuration",
};

const JSON_ASSET_FILES = {
  actions: "storage/actions.json",
  advisor: "storage/advisor.json",
  chat: "storage/chat.json",
  events: "storage/events.json",
  game: "game.json",
  prompts: "prompts.json",
  world: "world.json",
};

const OPTIONAL_JSON_ASSET_FILES = {
  colors: "colors.json",
};

const PMTILES_ASSET_FILES = {
  cities: "cities.pmtiles",
  countries: "countries.pmtiles",
  regions: "regions.pmtiles",
};

const UPLOADABLE_SCENARIO_ASSET_FILES = {
  ...OPTIONAL_JSON_ASSET_FILES,
  ...PMTILES_ASSET_FILES,
};

const JSON_ASSET_DEFAULTS = {
  actions: [],
  advisor: [],
  chat: [],
  events: [],
  game: {},
  prompts: {},
  world: {},
};

const BASE_ASSET_CANDIDATES = {
  colors: [
    path.join(DIST_DIR, "assets", "colors.json"),
    path.join(PUBLIC_DIR, "assets", "colors.json"),
  ],
};

const ensureDirectory = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
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

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

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

const normalizeScenarioId = (rawValue) => {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return value || `scenario-${Date.now().toString(36)}`;
};

const getScenarioDirectory = (scenarioId) => path.join(SCENARIOS_DIR, scenarioId);
const getScenarioMetaPath = (scenarioId) => path.join(getScenarioDirectory(scenarioId), "scenario.json");
const getScenarioJsonPath = (scenarioId, assetKey) =>
  path.join(getScenarioDirectory(scenarioId), JSON_ASSET_FILES[assetKey] ?? OPTIONAL_JSON_ASSET_FILES[assetKey]);
const getScenarioUploadPath = (scenarioId, assetKey) =>
  path.join(getScenarioDirectory(scenarioId), UPLOADABLE_SCENARIO_ASSET_FILES[assetKey]);

const getManifest = () => {
  const manifest = readJsonFile(MANIFEST_PATH, null);
  if (manifest && Array.isArray(manifest.order)) {
    return manifest;
  }

  return {
    activeScenarioId: DEFAULT_SCENARIO_ID,
    order: [DEFAULT_SCENARIO_ID],
    version: 1,
  };
};

const saveManifest = (manifest) => {
  writeJsonFile(MANIFEST_PATH, {
    activeScenarioId: manifest.activeScenarioId,
    order: Array.from(new Set(manifest.order ?? [DEFAULT_SCENARIO_ID])),
    version: 1,
  });
};

const readScenarioMeta = (scenarioId) => {
  const raw = readJsonFile(getScenarioMetaPath(scenarioId), {});
  const name = String(raw?.name ?? "").trim() || DEFAULT_SCENARIO_META.name;
  const subtitle = String(raw?.subtitle ?? "").trim() || DEFAULT_SCENARIO_META.subtitle;
  const description = String(raw?.description ?? "").trim() || subtitle || DEFAULT_SCENARIO_META.description;

  return {
    id: scenarioId,
    name,
    subtitle,
    description,
    eyebrow: String(raw?.eyebrow ?? "").trim() || DEFAULT_SCENARIO_META.eyebrow,
    heroSubtitle: String(raw?.heroSubtitle ?? "").trim() || description,
    heroTitle: String(raw?.heroTitle ?? "").trim() || name,
    accentColor: String(raw?.accentColor ?? "").trim() || DEFAULT_SCENARIO_META.accentColor,
    baseSaveId: String(raw?.baseSaveId ?? "").trim() || DEFAULT_BASE_SAVE_ID,
    countryNameOverrides:
      raw?.countryNameOverrides && typeof raw.countryNameOverrides === "object"
        ? raw.countryNameOverrides
        : {},
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
  };
};

const writeScenarioMeta = (scenarioId, updates) => {
  const current = readScenarioMeta(scenarioId);
  const next = {
    ...current,
    ...updates,
    id: scenarioId,
    updatedAt: new Date().toISOString(),
  };

  writeJsonFile(getScenarioMetaPath(scenarioId), next);
  return next;
};

const copyJsonFile = (sourcePath, targetPath, fallback) => {
  if (sourcePath && fs.existsSync(sourcePath)) {
    ensureDirectory(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    return;
  }

  writeJsonFile(targetPath, cloneJson(fallback));
};

const seedScenarioJsonFilesFromBaseSave = (scenarioId, baseSaveId) => {
  for (const [assetKey, relativePath] of Object.entries(JSON_ASSET_FILES)) {
    const sourcePath = resolveBaseSaveFile(baseSaveId, relativePath);
    const targetPath = getScenarioJsonPath(scenarioId, assetKey);
    copyJsonFile(sourcePath, targetPath, JSON_ASSET_DEFAULTS[assetKey]);
  }
};

const seedScenarioJsonFilesFromScenario = (scenarioId, sourceScenarioId) => {
  for (const [assetKey] of Object.entries(JSON_ASSET_FILES)) {
    const sourcePath = getScenarioJsonPath(sourceScenarioId, assetKey);
    const targetPath = getScenarioJsonPath(scenarioId, assetKey);
    copyJsonFile(sourcePath, targetPath, JSON_ASSET_DEFAULTS[assetKey]);
  }
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

  const manifest = getManifest();
  if (!manifest.order.includes(DEFAULT_SCENARIO_ID)) {
    manifest.order.unshift(DEFAULT_SCENARIO_ID);
  }
  if (!manifest.activeScenarioId) {
    manifest.activeScenarioId = DEFAULT_SCENARIO_ID;
  }
  saveManifest(manifest);
};

const ensureScenarioStore = () => {
  ensureDirectory(SERVER_DATA_DIR);
  ensureDirectory(SCENARIOS_DIR);
  ensureDefaultScenario();
};

const getScenarioAssetStatus = (scenarioId) => {
  const status = {};

  for (const [assetKey] of Object.entries(UPLOADABLE_SCENARIO_ASSET_FILES)) {
    status[assetKey] = fs.existsSync(getScenarioUploadPath(scenarioId, assetKey));
  }

  return status;
};

const resolveScenarioOrder = (manifest) => {
  const known = new Set(manifest.order ?? []);
  const dirs = fs.existsSync(SCENARIOS_DIR)
    ? fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

  const ordered = [];

  for (const scenarioId of manifest.order ?? []) {
    if (dirs.includes(scenarioId)) {
      ordered.push(scenarioId);
    }
  }

  for (const scenarioId of dirs) {
    if (!known.has(scenarioId)) {
      ordered.push(scenarioId);
    }
  }

  if (!ordered.includes(DEFAULT_SCENARIO_ID) && dirs.includes(DEFAULT_SCENARIO_ID)) {
    ordered.unshift(DEFAULT_SCENARIO_ID);
  }

  return ordered;
};

const getScenarioCatalog = () => {
  ensureScenarioStore();

  const manifest = getManifest();
  const orderedScenarioIds = resolveScenarioOrder(manifest);
  const scenarios = orderedScenarioIds
    .map((scenarioId) => {
      const metaPath = getScenarioMetaPath(scenarioId);
      if (!fs.existsSync(metaPath)) {
        return null;
      }

      const meta = readScenarioMeta(scenarioId);
      return {
        ...meta,
        assetStatus: getScenarioAssetStatus(scenarioId),
        cacheToken: `${scenarioId}-${meta.updatedAt}`,
        canDelete: scenarioId !== DEFAULT_SCENARIO_ID,
      };
    })
    .filter(Boolean);

  const activeScenarioId = scenarios.some((scenario) => scenario.id === manifest.activeScenarioId)
    ? manifest.activeScenarioId
    : DEFAULT_SCENARIO_ID;

  if (activeScenarioId !== manifest.activeScenarioId) {
    saveManifest({
      ...manifest,
      activeScenarioId,
      order: orderedScenarioIds,
    });
  }

  return {
    activeScenarioId,
    baseSaves: listBaseSaveIds(),
    scenarios,
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

const getScenarioDetails = (scenarioId) => {
  const summary = getScenarioSummary(scenarioId);
  const prompts = readJsonFile(getScenarioJsonPath(scenarioId, "prompts"), {});
  const game = readJsonFile(getScenarioJsonPath(scenarioId, "game"), {});
  const world = readJsonFile(getScenarioJsonPath(scenarioId, "world"), {});

  return {
    scenario: summary,
    assetStatus: summary.assetStatus,
    data: {
      game,
      prompts,
      world,
    },
  };
};

const updateManifestOrder = (scenarioId) => {
  const manifest = getManifest();
  const nextOrder = manifest.order.filter((entry) => entry !== scenarioId);
  nextOrder.push(scenarioId);
  saveManifest({ ...manifest, order: nextOrder });
};

const ensureUniqueScenarioId = (requestedId) => {
  const baseId = normalizeScenarioId(requestedId);
  let nextId = baseId;
  let suffix = 2;

  while (fs.existsSync(getScenarioDirectory(nextId))) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
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

  const scenarioId = ensureUniqueScenarioId(id || name || "scenario");
  const scenarioDir = getScenarioDirectory(scenarioId);

  ensureDirectory(scenarioDir);
  ensureDirectory(path.join(scenarioDir, "storage"));

  if (seedScenarioId && fs.existsSync(getScenarioDirectory(seedScenarioId))) {
    seedScenarioJsonFilesFromScenario(scenarioId, seedScenarioId);
  } else {
    const resolvedBaseSaveId = String(baseSaveId ?? DEFAULT_BASE_SAVE_ID).trim() || DEFAULT_BASE_SAVE_ID;
    seedScenarioJsonFilesFromBaseSave(scenarioId, resolvedBaseSaveId);
  }

  const createdAt = new Date().toISOString();
  writeJsonFile(getScenarioMetaPath(scenarioId), {
    accentColor: String(accentColor ?? "").trim() || DEFAULT_SCENARIO_META.accentColor,
    baseSaveId: String(baseSaveId ?? DEFAULT_BASE_SAVE_ID).trim() || DEFAULT_BASE_SAVE_ID,
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
      DEFAULT_SCENARIO_META.heroSubtitle,
    heroTitle:
      String(heroTitle ?? "").trim() ||
      String(name ?? "").trim() ||
      DEFAULT_SCENARIO_META.heroTitle,
    name: String(name ?? "").trim() || "Custom Scenario",
    subtitle:
      String(subtitle ?? "").trim() ||
      String(description ?? "").trim() ||
      DEFAULT_SCENARIO_META.subtitle,
    updatedAt: createdAt,
  });

  updateManifestOrder(scenarioId);

  if (setActive) {
    setActiveScenario(scenarioId);
  }

  return getScenarioDetails(scenarioId);
};

const mergeJsonAsset = (scenarioId, assetKey, patch) => {
  if (!(assetKey in JSON_ASSET_FILES)) {
    return null;
  }

  const current = readJsonFile(getScenarioJsonPath(scenarioId, assetKey), JSON_ASSET_DEFAULTS[assetKey]);
  const next =
    patch && typeof patch === "object" && !Array.isArray(patch)
      ? { ...current, ...patch }
      : cloneJson(patch);

  writeJsonFile(getScenarioJsonPath(scenarioId, assetKey), next);
  return next;
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
  const nextMeta = {
    ...currentMeta,
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
  };

  writeScenarioMeta(scenarioId, nextMeta);

  if (game && typeof game === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "game"), game);
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(scenarioId, "game", gamePatch);
  }

  if (prompts && typeof prompts === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "prompts"), prompts);
  } else if (promptsPatch && typeof promptsPatch === "object") {
    mergeJsonAsset(scenarioId, "prompts", promptsPatch);
  }

  if (world && typeof world === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "world"), world);
  } else if (worldPatch && typeof worldPatch === "object") {
    mergeJsonAsset(scenarioId, "world", worldPatch);
  }

  if (setActive) {
    setActiveScenario(scenarioId);
  }

  return getScenarioDetails(scenarioId);
};

const setActiveScenario = (scenarioId) => {
  ensureScenarioStore();
  if (!fs.existsSync(getScenarioDirectory(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const manifest = getManifest();
  manifest.activeScenarioId = scenarioId;
  manifest.order = resolveScenarioOrder(manifest).filter((entry) => entry !== scenarioId);
  manifest.order.unshift(scenarioId);
  saveManifest(manifest);
  return getScenarioCatalog();
};

const deleteScenario = (scenarioId) => {
  ensureScenarioStore();

  if (scenarioId === DEFAULT_SCENARIO_ID) {
    throw new Error("The default scenario cannot be deleted.");
  }

  const scenarioDir = getScenarioDirectory(scenarioId);
  const resolved = path.resolve(scenarioDir);
  const resolvedRoot = path.resolve(SCENARIOS_DIR);

  if (!resolved.startsWith(resolvedRoot) || !fs.existsSync(resolved)) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  fs.rmSync(resolved, { force: true, recursive: true });

  const manifest = getManifest();
  const nextOrder = manifest.order.filter((entry) => entry !== scenarioId);
  const nextActiveScenarioId =
    manifest.activeScenarioId === scenarioId ? DEFAULT_SCENARIO_ID : manifest.activeScenarioId;

  saveManifest({
    ...manifest,
    activeScenarioId: nextActiveScenarioId,
    order: nextOrder.length > 0 ? nextOrder : [DEFAULT_SCENARIO_ID],
  });

  return getScenarioCatalog();
};

const uploadScenarioAsset = (scenarioId, assetKey, dataBuffer) => {
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
  writeScenarioMeta(scenarioId, {});
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

  const targetPath = getScenarioUploadPath(scenarioId, assetKey);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
  writeScenarioMeta(scenarioId, {});
  return getScenarioDetails(scenarioId);
};

const getActiveScenarioSummary = () => {
  const catalog = getScenarioCatalog();
  return (
    catalog.scenarios.find((scenario) => scenario.id === catalog.activeScenarioId) ??
    catalog.scenarios[0]
  );
};

const getActiveScenarioId = () => getScenarioCatalog().activeScenarioId;

const readRuntimeJsonAsset = (assetKey) => {
  ensureScenarioStore();

  const activeScenario = getActiveScenarioSummary();
  const scenarioPath =
    JSON_ASSET_FILES[assetKey] || OPTIONAL_JSON_ASSET_FILES[assetKey]
      ? getScenarioJsonPath(activeScenario.id, assetKey)
      : null;

  if (scenarioPath && fs.existsSync(scenarioPath)) {
    return {
      contentType: "application/json; charset=utf-8",
      data: readJsonFile(scenarioPath, assetKey === "colors" ? {} : JSON_ASSET_DEFAULTS[assetKey]),
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
  ensureScenarioStore();

  if (!(assetKey in JSON_ASSET_FILES) && !(assetKey in OPTIONAL_JSON_ASSET_FILES)) {
    throw new Error(`Unsupported JSON asset key: ${assetKey}`);
  }

  const activeScenarioId = getActiveScenarioId();
  const targetPath = getScenarioJsonPath(activeScenarioId, assetKey);
  writeJsonFile(targetPath, value);
  writeScenarioMeta(activeScenarioId, {});
  return readRuntimeJsonAsset(assetKey);
};

const resolveRuntimeBinaryAsset = (assetKey) => {
  ensureScenarioStore();

  if (!(assetKey in PMTILES_ASSET_FILES)) {
    throw new Error(`Unsupported PMTiles asset key: ${assetKey}`);
  }

  const activeScenario = getActiveScenarioSummary();
  const scenarioOverridePath = getScenarioUploadPath(activeScenario.id, assetKey);

  if (fs.existsSync(scenarioOverridePath)) {
    return {
      contentType: "application/octet-stream",
      sourcePath: scenarioOverridePath,
    };
  }

  const fallbackPath = resolveBaseSaveFile(activeScenario.baseSaveId, PMTILES_ASSET_FILES[assetKey]);
  if (!fallbackPath) {
    throw new Error(`No PMTiles archive available for ${assetKey}.`);
  }

  return {
    contentType: "application/octet-stream",
    sourcePath: fallbackPath,
  };
};

export {
  createScenario,
  deleteScenario,
  ensureScenarioStore,
  getActiveScenarioSummary,
  getScenarioCatalog,
  getScenarioDetails,
  readRuntimeJsonAsset,
  removeScenarioAsset,
  resolveRuntimeBinaryAsset,
  setActiveScenario,
  updateScenario,
  uploadScenarioAsset,
  writeRuntimeJsonAsset,
};
