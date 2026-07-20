/*! Open Historia — portions (regions.geojson scenario asset + custom-map seeding) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import fs from "fs";
import path from "path";
import url from "url";
import { resolveChildPath as resolveWithinDirectory } from "./security.js";
import {
  buildOwnerRenameMap,
  migrateChat,
  migrateEvents,
  migrateGame,
  migrateRegions,
  migrateWorld as migrateOwnerWorld,
  needsMigration as needsOwnerMigration,
  rekeyOwnerMap,
} from "./ownerMigration.js";

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
// One naming scheme, and it is the COUNTRY'S NAME. Everywhere a country is
// referenced — ownership overrides, ownerCodes, polity keys, colors, the played
// country — the identifier is "Russia", not "RUS".
//
// This used to run the other way: names canonicalized DOWN to a GADM code. That
// inverted here for two reasons. The obvious one is that owners are names now, so
// the old direction silently undid every edit at the persistence boundary. The
// other is that the name->code direction could not be made correct: NAME_TO_CODE
// was built by last-write-wins over a registry where six codes share the name
// "India", so canonicalizeCountryRef("India") returned Z07 — a disputed sliver of
// Kashmir — rather than IND.
//
// A code still resolves (an old client, or a model that says "RUS"), and so does
// a polity's alias, so an author writing "Rome" still reaches "Roman Empire".
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

// Resolve one author-supplied country reference — a name, a polity alias, or a
// legacy GADM code — to the canonical NAME. `world` extends the lookup with the
// scenario's own polities.
const resolveOwnerRef = (value, world) => {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;

  const lower = raw.toLowerCase();
  const overrides = world?.polityOverrides;
  if (overrides && typeof overrides === "object") {
    for (const [key, polity] of Object.entries(overrides)) {
      const name = String(polity?.name ?? key).trim();
      // A polity that names itself after the very token we are resolving tells us
      // nothing the token didn't already say — skip it and let the registry decide.
      //
      // This is the same guard resolveOwnerName has, and it is not a nicety. Without
      // it {"MNG": {name: "MNG"}} — which is exactly what an editor export emits for
      // an owner it thinks is custom — shadows the registry, so "MNG" resolves to
      // "MNG" and can NEVER become "Mongolia". Any author or model that writes a
      // self-naming polity pins that token permanently.
      //
      // Skipping is safe for the polities that are genuinely self-named ("Votengia",
      // "Roman Empire"): they fall through to a registry miss and come back as
      // themselves — the same answer, reached honestly.
      if (name === raw) continue;
      if (name.toLowerCase() === lower) return name; // already canonical, bar case
      if (polity && Array.isArray(polity.aliases) &&
          polity.aliases.some((alias) => String(alias).trim().toLowerCase() === lower)) {
        return name; // "Rome" -> "Roman Empire"
      }
      if (key === raw) return name; // a legacy code key still maps to its polity
    }
  }

  const known = COUNTRY_NAME_REGISTRY[raw];
  if (known) return known; // legacy code, or a model still saying "RUS"

  // Unknown reference: it already IS its own identifier — a custom polity simply
  // is its name.
  return raw;
};

// Resolve every country reference inside a world payload, in place-safe copies.
// Region ids are untouched; only OWNER references translate.
//
// A LEGACY world is returned untouched. This looks like a hole and is the opposite:
// canonicalizing a code-keyed world rekeys polityOverrides from {"ROM": {...}} to
// {"Roman Empire": {...}} — which destroys the migration's rule 1, the one that
// exists to catch exactly ROM -> "Roman Empire". Every invented polity then falls
// through to feature consensus and gets named after whatever modern country it
// happens to sit on (Xiongnu -> "Mongolia", Olmec -> "Mexico"), and the
// degenerate-polity guard eats the rest because canonicalization made them
// self-named. Measured on the six published bundles: roman-117 lost 8 of 13
// polities, medieval-1200 lost 26, mongol-1300 lost 32.
//
// The migration IS the canonicaliser for that shape, and it has strictly more
// context — the scenario's countryNameOverrides and its regions. Leave the world
// alone and let it run.
const canonicalizeWorldCountryRefs = (world) => {
  if (!world || typeof world !== "object" || Array.isArray(world)) return world;
  if (needsOwnerMigration(world)) return world;
  const next = { ...world };

  if (next.regionOwnershipOverrides && typeof next.regionOwnershipOverrides === "object") {
    next.regionOwnershipOverrides = Object.fromEntries(
      Object.entries(next.regionOwnershipOverrides).map(([regionId, owner]) => [
        regionId,
        resolveOwnerRef(owner, world),
      ]),
    );
  }

  if (Array.isArray(next.ownerCodes)) {
    next.ownerCodes = [...new Set(next.ownerCodes.map((entry) => resolveOwnerRef(entry, world)))];
  }

  if (next.polityOverrides && typeof next.polityOverrides === "object") {
    // Keyed by name, and `.code` is dropped rather than rewritten: the key IS the
    // identifier now, so a `.code` beside it is the exact thing being deleted and
    // would only mislead the next reader.
    next.polityOverrides = Object.fromEntries(
      Object.entries(next.polityOverrides).map(([key, polity]) => {
        const name = resolveOwnerRef(polity?.name || key, world);
        if (!polity || typeof polity !== "object") return [name, polity];
        const { code, ...rest } = polity;
        return [name, { ...rest, name }];
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

// Colors may be keyed by a code or an alias; keys resolve like everything else.
const canonicalizeColorKeys = (colors, world) => {
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return colors;
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [resolveOwnerRef(key, world), value]),
  );
};

// The played country. `world` is REQUIRED: without it a preset's game.country
// ("ROM") can reach neither its polity nor the registry, so it stays a raw code
// while every region around it says "Roman Empire" — and the player owns nothing.
const canonicalizeGameCountry = (game, world) => {
  if (!game || typeof game !== "object" || Array.isArray(game) || !game.country) return game;
  return { ...game, country: resolveOwnerRef(game.country, world) };
};
const BUILT_IN_SCENARIO_DEFAULT_DATE = "2016-01-01";
// Bundles are files strangers swap, so the schema string is a compatibility gate
// and the ONLY one: `version` below is written and read by nobody, on either side.
//
// It changes with the owner rename because a name-keyed bundle is not safely
// readable by an older build. An old build validates the schema string, sees a
// familiar one, accepts the file, and then runs its own canonicaliser, which
// resolves names DOWN to codes — "Roman Empire" is not a code it knows, so it
// becomes its own identifier, matches no colour and no region, and the player owns
// nothing. Rejecting on an unfamiliar schema turns that into "Unsupported scenario
// bundle", which is a sentence someone can act on.
const SCENARIO_BUNDLE_SCHEMA = "pax-historia-scenario-bundle/2";
// Every schema this build can READ. v1 bundles — the six on the community release,
// and everything anyone has ever shared — import fine: they arrive unmarked and the
// migration names them on first read.
const ACCEPTED_BUNDLE_SCHEMAS = new Set([SCENARIO_BUNDLE_SCHEMA, "pax-historia-scenario-bundle"]);
const SCENARIO_BUNDLE_VERSION = 2;

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
  // Author-set country flags: owner code -> PNG data URL, written by the map editor.
  // A JSON asset rather than a field on world.json, deliberately: world is re-read
  // every 5s by the running game, and a few hundred flags is megabytes that would
  // ride every poll. Like colors, this is fetched only when the scenario changes.
  flags: "flags.json",
  // Author-set country tags: owner code -> string[] ("socialist", "anti-nato"…).
  // A JSON asset for the same reason as flags: static author data that world.json's
  // 5s poll has no business carrying. These are the starting tags — the AI's own
  // changes accumulate in world.countryTags and are merged over these on read.
  tags: "tags.json",
};

// Roll-back restore points, captured client-side each turn (see the "Roll back
// turn" cheat). A per-game runtime asset kept deliberately OUT of JSON_ASSET_FILES
// so it is never copied into new games, embedded in scenario exports, or dragged
// into the polled details bundle — a snapshot list holds full prior state and can
// be large. Read/written only through the /api/runtime/json/snapshots endpoint.
const RUNTIME_ONLY_JSON_ASSET_FILES = {
  snapshots: "storage/snapshots.json",
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
  snapshots: [],
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
  // Any write can change what the catalogs describe, so drop them. This is the
  // one choke point every meta and manifest write goes through — including
  // create and delete, which rewrite the manifest — so hooking it here is what
  // makes the cache safe without touching 43 call sites individually.
  invalidateCatalogs();
};

// ---- Catalog cache ---------------------------------------------------------
// getGameCatalog/getScenarioCatalog walk EVERY game and scenario directory and
// parse each meta file. Nothing needs that per request, but everything paid for
// it: resolving one runtime asset (the 5s poll for world.json) cost 139 sync
// file ops and ~43ms of blocked event loop, just to learn which game is active.
//
// Cache both, and drop BOTH on any write. Coarse on purpose: writes are rare and
// a rebuild is cheap, while a stale catalog is a bug that surfaces as "my save
// vanished". Correctness first — the win is in the reads.
let gameCatalogCache = null;
let scenarioCatalogCache = null;

const invalidateCatalogs = () => {
  gameCatalogCache = null;
  scenarioCatalogCache = null;
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
          JSON_ASSET_FILES[assetKey] ?? OPTIONAL_JSON_ASSET_FILES[assetKey] ?? RUNTIME_ONLY_JSON_ASSET_FILES[assetKey],
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

// Provenance for scenarios imported straight from the community hub: which post
// (issue number), which exact bundle file, and when. The bundle URL doubles as
// the update signal — GitHub mints a new attachment URL for every re-upload, so
// a post whose current bundleUrl differs from the recorded one has an update
// (the hub-cache route relies on the same immutability).
const normalizeHubOrigin = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const postId = Number(raw.postId);
  const bundleUrl = String(raw.bundleUrl ?? "").trim();
  if (!Number.isFinite(postId) || postId <= 0 || !bundleUrl) return null;
  return {
    bundleUrl,
    postId,
    syncedAt: String(raw.syncedAt ?? "").trim() || new Date().toISOString(),
  };
};

const normalizePlayCount = (raw) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
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
    hubOrigin: normalizeHubOrigin(raw?.hubOrigin),
    id: scenarioId,
    name,
    playCount: normalizePlayCount(raw?.playCount),
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
    // Hub provenance survives ONLY when a write explicitly carries it (the
    // import/update paths stamp it last). Every other meta write is a local
    // modification — a rename, an editor apply, a cover change — which turns
    // the copy into a fork, and a fork must stop offering hub updates that
    // would overwrite the player's work.
    hubOrigin: Object.prototype.hasOwnProperty.call(updates ?? {}, "hubOrigin")
      ? normalizeHubOrigin(updates.hubOrigin)
      : null,
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
    lastPlayedAt: String(raw?.lastPlayedAt ?? "").trim() || null,
    name,
    playCount: normalizePlayCount(raw?.playCount),
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

  // Already at the target: the backfill has nothing to do. Without this the
  // write below re-arms its own guard forever — it sets gameDate and startDate
  // to the SAME value, and shouldBackfillSeedDatePair treats
  // `currentGameDate === currentStartDate` as "needs backfilling". So every
  // caller rewrote an identical game.json, and since ensure* runs on the read
  // path, each 5s poll wrote this file 4 times. Idle, forever, onto the disk.
  if (
    currentGameDate === BUILT_IN_SCENARIO_DEFAULT_DATE &&
    currentStartDate === BUILT_IN_SCENARIO_DEFAULT_DATE
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
  let changed = false;
  if (!manifest.order.includes(DEFAULT_SCENARIO_ID)) {
    manifest.order.unshift(DEFAULT_SCENARIO_ID);
    changed = true;
  }
  if (!manifest.selectedScenarioId) {
    manifest.selectedScenarioId = DEFAULT_SCENARIO_ID;
    changed = true;
  }
  // Save when a guard above changed something, OR on a true first run when no
  // manifest file exists yet. That second case is not optional: getScenarioManifest
  // synthesizes a default that ALREADY lists the built-in scenario, so both guards
  // are no-ops on first run and `changed` stays false — the old unconditional save
  // was what committed that default to disk. Dropping it silently shipped an empty
  // library on a fresh install (caught only by testing a fresh install).
  //
  // Otherwise skip: ensure* runs on the read path, so an unconditional save had
  // every 5s poll rewriting an unchanged manifest 4 times, forever.
  if (changed || !fs.existsSync(SCENARIO_MANIFEST_PATH)) saveScenarioManifest(manifest);
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
  if (!scenarioCatalogCache) scenarioCatalogCache = buildScenarioCatalog();
  return scenarioCatalogCache;
};

const buildScenarioCatalog = () => {
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
  if (!gameCatalogCache) gameCatalogCache = buildGameCatalog();
  return gameCatalogCache;
};

const buildGameCatalog = () => {
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
    countryNames: { ...COUNTRY_NAME_REGISTRY },
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

// Play stamps power the main menu's "Last Played"/"Most Played" rows. They
// bypass writeGameMeta/writeScenarioMeta on purpose: those stamp updatedAt
// (which would turn "Last Updated" into "Last Played") and writeScenarioMeta
// drops hubOrigin on any write it isn't explicitly handed (which would fork a
// hub scenario off update tracking just for playing it).
const recordGamePlayed = (gameId) => {
  try {
    const metaPath = getGameMetaPath(gameId);
    const current = readJsonFile(metaPath, {});
    writeJsonFile(metaPath, {
      ...current,
      lastPlayedAt: new Date().toISOString(),
      playCount: normalizePlayCount(current?.playCount) + 1,
    });

    const scenarioId = String(current?.scenarioId ?? "").trim();
    if (scenarioId && fs.existsSync(getScenarioDirectory(scenarioId))) {
      const scenarioMetaPath = getScenarioMetaPath(scenarioId);
      const scenarioMeta = readJsonFile(scenarioMetaPath, {});
      writeJsonFile(scenarioMetaPath, {
        ...scenarioMeta,
        playCount: normalizePlayCount(scenarioMeta?.playCount) + 1,
      });
    }
  } catch {
    // Stamping is best-effort — never block activating a game over it.
  }
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
  recordGamePlayed(gameId);
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
  if (setActive) {
    recordGamePlayed(resolvedGameId);
  }

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

  // The world this update's country references resolve against: the one being
  // written in the same call if there is one, else what is already on disk. It is
  // needed even for the game write — game.country is an owner reference, and a
  // preset's "ROM" reaches "Roman Empire" only through its polityOverrides.
  const scenarioWorldContext = () =>
    (world && typeof world === "object" ? world
      : worldPatch && typeof worldPatch === "object" ? worldPatch
        : readJsonFile(getScenarioJsonPath(scenarioId, "world"), JSON_ASSET_DEFAULTS.world));

  if (game && typeof game === "object") {
    writeJsonFile(getScenarioJsonPath(scenarioId, "game"), canonicalizeGameCountry(game, scenarioWorldContext()));
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(
      getScenarioJsonPath(scenarioId, "game"),
      canonicalizeGameCountry(gamePatch, scenarioWorldContext()),
      JSON_ASSET_DEFAULTS.game,
    );
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

  // See the note in updateScenario: game.country is an owner reference and needs
  // the world to resolve a preset's polity.
  const gameWorldContext = () =>
    (world && typeof world === "object" ? world
      : worldPatch && typeof worldPatch === "object" ? worldPatch
        : readJsonFile(getGameJsonPath(gameId, "world"), JSON_ASSET_DEFAULTS.world));

  if (game && typeof game === "object") {
    writeJsonFile(getGameJsonPath(gameId, "game"), canonicalizeGameCountry(game, gameWorldContext()));
  } else if (gamePatch && typeof gamePatch === "object") {
    mergeJsonAsset(
      getGameJsonPath(gameId, "game"),
      canonicalizeGameCountry(gamePatch, gameWorldContext()),
      JSON_ASSET_DEFAULTS.game,
    );
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

// Soft-delete: move a scenario/game directory into server/data/.trash instead
// of unlinking it, so an accidental delete (or, before the traversal fix, a
// malicious one) is recoverable — the user can restore or empty .trash by hand.
const TRASH_DIR = path.join(SERVER_DATA_DIR, ".trash");
const moveDirectoryToTrash = (sourceDir, kind, id) => {
  ensureDirectory(TRASH_DIR);
  const safeId = String(id).replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "item";
  let dest = path.join(TRASH_DIR, `${kind}-${safeId}`);
  let n = 2;
  while (fs.existsSync(dest)) dest = path.join(TRASH_DIR, `${kind}-${safeId}-${n++}`);
  fs.renameSync(sourceDir, dest);
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

  moveDirectoryToTrash(resolved, "scenario", scenarioId);

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

  moveDirectoryToTrash(resolved, "game", gameId);

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

// ---------------------------------------------------------------------------
// Owner schema migration: rewrite a record whose owners are GADM codes into one
// whose owners are country names. Once per record, eagerly, on disk.
//
// Eager rather than read-time for one decisive reason: `owner` physically lives
// in regions.geojson, and that branch of readRuntimeJsonAsset returns before any
// read-side hook could touch it. A read transform would also have to re-walk a
// 55MB FeatureCollection on every poll.
//
// Detection is the MARKER, never the values. Sniffing is undecidable: "ROM" may
// be a legacy code or a polity legitimately named ROM, and "Russia" may be a name
// or a custom polity that happens to read like one.
// ---------------------------------------------------------------------------
const ownerSchemaChecked = new Set();

const migrateOwnerRecordAtPaths = (label, paths) => {
  const world = readJsonFile(paths.world, null);
  if (!world || !needsOwnerMigration(world)) return false;

  const game = paths.game ? readJsonFile(paths.game, null) : null;
  const meta = paths.meta ? readJsonFile(paths.meta, null) : null;
  const colors = paths.colors && fs.existsSync(paths.colors) ? readJsonFile(paths.colors, null) : null;
  const flags = paths.flags && fs.existsSync(paths.flags) ? readJsonFile(paths.flags, null) : null;
  const tags = paths.tags && fs.existsSync(paths.tags) ? readJsonFile(paths.tags, null) : null;
  const regions = paths.regions && fs.existsSync(paths.regions) ? readJsonFile(paths.regions, null) : null;
  const events = paths.events && fs.existsSync(paths.events) ? readJsonFile(paths.events, null) : null;
  const chat = paths.chat && fs.existsSync(paths.chat) ? readJsonFile(paths.chat, null) : null;

  const renames = buildOwnerRenameMap({
    polityOverrides: world.polityOverrides,
    countryNameOverrides: meta?.countryNameOverrides,
    registry: COUNTRY_NAME_REGISTRY,
    features: regions?.features,
    ownershipOverrides: world.regionOwnershipOverrides,
    ownerCodes: world.ownerCodes,
    colors,
    flags,
    tags,
    units: world.units,
    countryTags: world.countryTags,
    internationalReputation: world.internationalReputation,
    gameCountry: game?.country,
  });
  const warn = (message) => console.warn(`[owner-migration] ${label}: ${message}`);

  if (colors) writeJsonFile(paths.colors, rekeyOwnerMap(colors, renames, "colors", warn));
  if (flags) writeJsonFile(paths.flags, rekeyOwnerMap(flags, renames, "flags", warn));
  if (tags) writeJsonFile(paths.tags, rekeyOwnerMap(tags, renames, "tags", warn));
  // regionsReadOnly: a game borrows its scenario's regions purely as resolver
  // context. Writing them back from here would rewrite another record's map using
  // this record's renames — the scenario migrates its own map, with its own.
  if (regions && !paths.regionsReadOnly) writeJsonFile(paths.regions, migrateRegions(regions, renames));
  if (events) writeJsonFile(paths.events, migrateEvents(events, renames));
  if (chat) writeJsonFile(paths.chat, migrateChat(chat, renames));
  if (game) writeJsonFile(paths.game, migrateGame(game, renames));

  // Roll-back points hold a full nested copy of world+game+colors+chat+events and
  // are blind-written back over live state on restore, with no marker of their own
  // to catch. Rather than migrate that surface, drop them: a stale restore point
  // would re-inject every code-keyed structure at once, silently.
  if (paths.snapshots && fs.existsSync(paths.snapshots)) {
    try {
      fs.rmSync(paths.snapshots);
      warn("discarded roll-back snapshots — they predate the owner rename");
    } catch { /* best effort */ }
  }

  // World last: it carries the marker, so a crash mid-migration leaves the record
  // unmarked and the next read simply redoes it.
  writeJsonFile(paths.world, migrateOwnerWorld(world, renames, warn));
  console.log(`[owner-migration] ${label}: ${renames.size} owner(s) -> ${new Set(renames.values()).size} name(s)`);
  return true;
};

const ensureScenarioOwnerSchema = (scenarioId) => {
  const key = `scenario:${scenarioId}`;
  if (ownerSchemaChecked.has(key)) return;
  ownerSchemaChecked.add(key);
  try {
    migrateOwnerRecordAtPaths(key, {
      world: getScenarioJsonPath(scenarioId, "world"),
      game: getScenarioJsonPath(scenarioId, "game"),
      meta: getScenarioMetaPath(scenarioId),
      colors: getScenarioJsonPath(scenarioId, "colors"),
      flags: getScenarioJsonPath(scenarioId, "flags"),
      tags: getScenarioJsonPath(scenarioId, "tags"),
      regions: getScenarioUploadPath(scenarioId, "regionsGeojson"),
    });
  } catch (error) {
    ownerSchemaChecked.delete(key); // let the next read retry rather than pin a half state
    console.warn(`[owner-migration] ${key} failed: ${error.message}`);
  }
};

const ensureGameOwnerSchema = (gameId) => {
  const key = `game:${gameId}`;
  if (ownerSchemaChecked.has(key)) return;
  ownerSchemaChecked.add(key);
  try {
    // A game MUST resolve owners with its scenario's context, not its own.
    //
    // countryNameOverrides lives on scenario meta and regions.geojson lives in the
    // scenario directory, so a game that resolves alone can reach neither rule 2
    // (the legacy label) nor rule 4 (feature consensus). It is not academic: a game
    // reads world.json from its own directory but regions.geojson and colors.json
    // from the scenario, so the two would be resolved by different rules and served
    // to one running game. wwii-1939's THA becomes "Thailand" in the save while the
    // map underneath it says "Siam" — the player's country owns nothing and 77
    // regions belong to a country no list contains. CZE splits the same way
    // ("Czechia" vs "Germany"), so this is a missing-context bug, not a Siam quirk.
    const parentId = getGameSummary(gameId)?.scenarioId || DEFAULT_SCENARIO_ID;
    // Migrate the scenario first: it is the record that owns the map, and doing it
    // here means a game can never be resolved against an unmigrated parent.
    ensureScenarioOwnerSchema(parentId);
    migrateOwnerRecordAtPaths(key, {
      world: getGameJsonPath(gameId, "world"),
      game: getGameJsonPath(gameId, "game"),
      colors: getGameJsonPath(gameId, "colors"),
      flags: getGameJsonPath(gameId, "flags"),
      tags: getGameJsonPath(gameId, "tags"),
      events: path.join(getGameDirectory(gameId), "storage", "events.json"),
      chat: path.join(getGameDirectory(gameId), "storage", "chat.json"),
      snapshots: getGameJsonPath(gameId, "snapshots"),
      // From the SCENARIO — the same two inputs the scenario resolved against, so
      // one token cannot mean two things inside one game.
      meta: getScenarioMetaPath(parentId),
      regions: getScenarioUploadPath(parentId, "regionsGeojson"),
      // The scenario's regions are read for context only; the scenario's own
      // migration already rewrote that file, and rewriting it from here would
      // resolve the map against the wrong record.
      regionsReadOnly: true,
    });
  } catch (error) {
    ownerSchemaChecked.delete(key);
    console.warn(`[owner-migration] ${key} failed: ${error.message}`);
  }
};

const readRuntimeJsonAsset = (assetKey) => {
  ensureGameStore();
  // Above the geojson branch deliberately: that branch returns before anything
  // else runs, and it is the branch that serves the file `owner` lives in.
  const activeGame = getActiveGameSummary();
  if (activeGame?.id) ensureGameOwnerSchema(activeGame.id);

  // Custom region/city geometry is scenario-scoped (static map data). Resolve it
  // from the active game's scenario, mirroring how pmtiles overrides resolve.
  if (assetKey in SCENARIO_GEOJSON_ASSET_FILES) {
    const scenario = getActiveRuntimeScenarioSummary();
    ensureScenarioOwnerSchema(scenario.id);
    let sourcePath = getScenarioUploadPath(scenario.id, assetKey);
    if (!fs.existsSync(sourcePath)) {
      sourcePath = null;
      // Scenarios without a map of their own use the built-in Modern Day
      // geometry, so EVERY scenario renders with the custom map style (the
      // scenario's ownership overrides still recolor it). Cities stay absent
      // unless the scenario ships its own set.
      if (assetKey === "regionsGeojson" && scenario.id !== DEFAULT_SCENARIO_ID) {
        // Borrowing the Modern Day map. Migrate it as DEFAULT'S record, not this
        // scenario's: the file's owners live in default's owner-space, so
        // resolving them against this scenario's polities would name Russia after
        // whatever this world calls that token. This scenario's own ownership is
        // in its world.regionOwnershipOverrides and migrated with its own record.
        ensureScenarioOwnerSchema(DEFAULT_SCENARIO_ID);
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

  // No games yet — runtime data resolves from the scenario below. (activeGame is
  // resolved at the top of this function, above the geojson branch, so the
  // migration hook can see it.)
  const gamePath =
  activeGame && (assetKey in JSON_ASSET_FILES || assetKey in OPTIONAL_JSON_ASSET_FILES || assetKey in RUNTIME_ONLY_JSON_ASSET_FILES)
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
    // Only colors has a built-in fallback (the app palette every stock country is
    // painted from). This branch predates there being a second optional asset and
    // used to call resolveColorsAssetFile() for whatever key arrived — so adding
    // one made a scenario with no flags.json serve the 293-country COLOUR palette
    // as its flags. Anything without its own fallback is simply absent: {}.
    const fallbackPath = assetKey === "colors" ? resolveColorsAssetFile() : null;
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

  if (!(assetKey in JSON_ASSET_FILES) && !(assetKey in OPTIONAL_JSON_ASSET_FILES) && !(assetKey in RUNTIME_ONLY_JSON_ASSET_FILES)) {
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
  // Authors and the AI may reference a country by an alias or a legacy code
  // anywhere; the stored form is the country's name (see resolveOwnerRef).
  //
  // The world is read through readRuntimeJsonAsset rather than readJsonFile so it
  // arrives migrated — resolving a name against a still-code-keyed world would
  // match none of its polities and quietly invent a parallel one.
  const activeWorld = () => {
    if (assetKey === "world" && value && typeof value === "object") return value;
    try {
      return readRuntimeJsonAsset("world")?.data ?? null;
    } catch {
      return null;
    }
  };

  let canonical = value;
  if (assetKey === "world") {
    canonical = canonicalizeWorldCountryRefs(value);
  } else if (assetKey === "game") {
    canonical = canonicalizeGameCountry(value, activeWorld());
  } else if (assetKey === "colors") {
    canonical = canonicalizeColorKeys(value, activeWorld());
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
      // Author-set flags travel with the scenario for the same reason the colours
      // and the background do: a shared map that loses them looks broken, and the
      // whole point of setting one is that other people see it.
      flags: buildScenarioBundleAsset(scenarioId, "flags", mode),
      // Tags travel with the scenario for the same reason: they are the map-maker's
      // characterisation of every country and the model reads them as context, so a
      // shared map that loses them plays differently than its author intended.
      tags: buildScenarioBundleAsset(scenarioId, "tags", mode),
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

  // Accept every schema we can read, not just the one we write — a v1 bundle is
  // still perfectly importable, it just arrives unmarked and gets named by the
  // migration on first read.
  if (!ACCEPTED_BUNDLE_SCHEMAS.has(bundle.schema)) {
    throw new Error("Unsupported scenario bundle schema.");
  }

  const scenario = bundle.scenario && typeof bundle.scenario === "object" ? bundle.scenario : {};
  const data = bundle.data && typeof bundle.data === "object" ? bundle.data : {};
  const assets = bundle.assets && typeof bundle.assets === "object" ? bundle.assets : {};
  // Provenance the community hub attaches to a direct import (bundle.hubOrigin
  // rides alongside the schema fields; absent on file imports). Stamped LAST so
  // the import's own meta writes don't clear it.
  const hubOrigin = normalizeHubOrigin(bundle.hubOrigin);

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
    applyScenarioBundleAsset(scenarioId, assetKey, assetValue);
  }

  writeScenarioMeta(scenarioId, hubOrigin ? { hubOrigin } : {});

  if (setSelected) {
    setSelectedScenario(scenarioId);
  }

  return getScenarioDetails(scenarioId);
};

// Write one bundle asset slot onto a scenario: embedded content lands on disk,
// anything else clears the slot. Shared by import (which visits the keys the
// bundle carries) and update-in-place (which visits EVERY key, so an asset the
// new version dropped doesn't linger from the old one).
const applyScenarioBundleAsset = (scenarioId, assetKey, assetValue) => {
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
    return;
  }

  if (assetValue?.mode === "embedded") {
    if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
      writeJsonFile(getScenarioJsonPath(scenarioId, assetKey), assetValue.data ?? {});
    } else {
      const decoded = Buffer.from(String(assetValue.data ?? ""), "base64");
      fs.writeFileSync(getScenarioUploadPath(scenarioId, assetKey), decoded);
    }
    return;
  }

  if (assetKey in OPTIONAL_JSON_ASSET_FILES) {
    removeFileIfPresent(getScenarioJsonPath(scenarioId, assetKey));
  }
  removeFileIfPresent(getScenarioUploadPath(scenarioId, assetKey));
};

// The "Update" path for a hub-imported scenario: replace an EXISTING scenario's
// content with a fresh bundle. Keeps the local id (games reference scenarios by
// id, so their link survives) and createdAt; the name, description, world, and
// assets all come from the new bundle, and every uploadable asset the bundle
// doesn't carry is cleared. The new hubOrigin is stamped last, so the card's
// Update button reverts to New Game once the catalog refreshes.
const updateScenarioFromBundle = (scenarioId, bundle) => {
  ensureScenarioStore();

  if (!bundle || typeof bundle !== "object") {
    throw new Error("Scenario bundle must be a JSON object.");
  }
  if (!ACCEPTED_BUNDLE_SCHEMAS.has(bundle.schema)) {
    throw new Error("Unsupported scenario bundle schema.");
  }
  if (!fs.existsSync(getScenarioMetaPath(scenarioId))) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const scenario = bundle.scenario && typeof bundle.scenario === "object" ? bundle.scenario : {};
  const data = bundle.data && typeof bundle.data === "object" ? bundle.data : {};
  const assets = bundle.assets && typeof bundle.assets === "object" ? bundle.assets : {};
  const hubOrigin = normalizeHubOrigin(bundle.hubOrigin);

  const metaPatch = {};
  for (const key of ["accentColor", "name", "subtitle", "description", "eyebrow", "heroTitle", "heroSubtitle"]) {
    if (scenario[key] != null) metaPatch[key] = scenario[key];
  }
  if (scenario.countryNameOverrides && typeof scenario.countryNameOverrides === "object") {
    metaPatch.countryNameOverrides = scenario.countryNameOverrides;
  }
  writeScenarioMeta(scenarioId, metaPatch);

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

  for (const assetKey of Object.keys(UPLOADABLE_SCENARIO_ASSET_FILES)) {
    applyScenarioBundleAsset(scenarioId, assetKey, assets[assetKey]);
  }

  writeScenarioMeta(scenarioId, hubOrigin ? { hubOrigin } : {});

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
  updateScenarioFromBundle,
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
