/*! Open Historia — web-mode library/scenario/game/runtime store © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Browser (IndexedDB) port of server/libraryStore.js. Backs /api/library,
// /api/scenarios*, /api/games*, /api/runtime/json*, /api/runtime/pmtiles* in web
// mode. Response shapes are byte-faithful to the server so the unchanged client
// (src/runtime/library.js, assets.js) works exactly as against the real server.
// Web build only.

import { STORES, idbGet, idbGetAll, idbPut, idbDelete, kvGet, kvPut } from "./idb.js";
import {
  cloneJson, nowIso, jsonResponse, errorResponse, binaryResponse, base64ToBytes, bytesToBase64,
  parseJsonValue, serializeJsonValue,
} from "./util.js";
import FALLBACK_COLORS from "./generated/fallbackColors.js";
import {
  DEFAULT_SCENARIO_ID, DEFAULT_GAME_ID, EMPTY_FEATURE_COLLECTION, COVER_IMAGE_ASSET_KEY,
  JSON_ASSET_KEYS, STORAGE_JSON_ASSET_KEYS, OPTIONAL_JSON_ASSET_KEYS, RUNTIME_ONLY_JSON_ASSET_KEYS,
  PMTILES_ASSET_KEYS, SCENARIO_GEOJSON_ASSET_KEYS, UPLOADABLE_SCENARIO_ASSET_KEYS, UPLOADABLE_GAME_ASSET_KEYS,
  JSON_ASSET_DEFAULTS, SCENARIO_BUNDLE_SCHEMA, ACCEPTED_BUNDLE_SCHEMAS, SCENARIO_BUNDLE_VERSION, SUPPORTED_IMAGE_CONTENT_TYPES,
  DEFAULT_SCENARIO_META, DEFAULT_GAME_META, canonicalizeWorldCountryRefs, canonicalizeGameCountry, canonicalizeColorKeys,
  readScenarioMeta, readGameMeta, readStoredImageContentType, resolveOrderedIds, normalizeId,
  scenarioLooksLikeRuntimeSnapshot, buildFreshGameSeedFromScenario, buildFreshWorldSeedFromScenario,
  normalizeRuntimeWorld, COUNTRY_NAME_REGISTRY, normalizeHubOrigin,
} from "./models.js";
// Imported, not mirrored: server/ownerMigration.js is pure ESM with no node
// imports, so Vite bundles it into the web build. One implementation of the
// resolver rather than two hand-kept copies that drift.
import {
  buildOwnerRenameMap,
  migrateChat,
  migrateEvents,
  migrateGame,
  migrateRegions,
  migrateWorld as migrateOwnerWorld,
  needsMigration as needsOwnerMigration,
  rekeyOwnerMap,
} from "../../../server/ownerMigration.js";
import DEFAULT_SEED from "./generated/defaultScenario.js";

const SCENARIO_MANIFEST_KEY = "scenario-manifest";
const GAME_MANIFEST_KEY = "game-manifest";
const META_KEYS = ["accentColor", "countryNameOverrides", "description", "eyebrow", "heroSubtitle", "heroTitle", "name", "subtitle"];

// --- Record accessors -----------------------------------------------------
// scenario record: { id, meta, json:{7}, colors?, geojson:{...}, pmtiles:{...}, cover?:{contentType,bytes} }
// game record:     { id, meta, json:{7}, colors?, snapshots?, cover?:{contentType,bytes} }

const getScenario = (id) => idbGet(STORES.scenarios, id);
const getGame = (id) => idbGet(STORES.games, id);
const putScenario = (record) => idbPut(STORES.scenarios, record);
const putGame = (record) => idbPut(STORES.games, record);

const listScenarioIds = async () => new Set((await idbGetAll(STORES.scenarios)).map((r) => r.id));
const listGameIds = async () => new Set((await idbGetAll(STORES.games)).map((r) => r.id));

const emptyScenarioRecord = (id) => ({ id, meta: {}, json: {}, colors: undefined, flags: undefined, geojson: {}, pmtiles: {}, cover: undefined });
const emptyGameRecord = (id) => ({ id, meta: {}, json: {}, colors: undefined, flags: undefined, snapshots: undefined, cover: undefined });

const jsonAsset = (record, key) => (record?.json?.[key] !== undefined ? record.json[key] : cloneJson(JSON_ASSET_DEFAULTS[key] ?? {}));

const coverDataUrl = (cover) =>
  cover && cover.bytes ? `data:${cover.contentType || "application/octet-stream"};base64,${bytesToBase64(cover.bytes)}` : null;

// --- Manifests ------------------------------------------------------------
const getScenarioManifest = async () => {
  const m = await kvGet(SCENARIO_MANIFEST_KEY, null);
  if (m && Array.isArray(m.order)) {
    return { order: m.order, selectedScenarioId: String(m.selectedScenarioId ?? m.activeScenarioId ?? "").trim() || DEFAULT_SCENARIO_ID };
  }
  return { order: [DEFAULT_SCENARIO_ID], selectedScenarioId: DEFAULT_SCENARIO_ID };
};
const saveScenarioManifest = (m) =>
  kvPut(SCENARIO_MANIFEST_KEY, { order: [...new Set(m.order ?? [DEFAULT_SCENARIO_ID])], selectedScenarioId: m.selectedScenarioId });

const getGameManifest = async () => {
  const m = await kvGet(GAME_MANIFEST_KEY, null);
  if (m && Array.isArray(m.order)) return { activeGameId: String(m.activeGameId ?? "").trim(), order: m.order };
  return { activeGameId: "", order: [] };
};
const saveGameManifest = (m) => kvPut(GAME_MANIFEST_KEY, { activeGameId: m.activeGameId ?? "", order: [...new Set(m.order ?? [])] });

// --- Meta writers (mirror writeScenarioMeta/writeGameMeta) ----------------
const writeScenarioMeta = (record, updates = {}) => {
  const current = readScenarioMeta(record.id, record.meta ?? {});
  const next = {
    ...current,
    ...updates,
    coverImageContentType: updates.coverImageContentType === null ? null
      : typeof updates.coverImageContentType === "string" ? readStoredImageContentType(updates.coverImageContentType)
        : current.coverImageContentType,
    countryNameOverrides: updates.countryNameOverrides && typeof updates.countryNameOverrides === "object"
      ? updates.countryNameOverrides : current.countryNameOverrides,
    // Hub provenance survives ONLY when a write explicitly carries it — any
    // other meta write is a local modification, which turns the copy into a
    // fork that must stop offering hub updates (server twin has the same rule).
    hubOrigin: Object.prototype.hasOwnProperty.call(updates, "hubOrigin")
      ? normalizeHubOrigin(updates.hubOrigin)
      : null,
    id: record.id,
    updatedAt: nowIso(),
  };
  record.meta = next;
  return next;
};

const writeGameMeta = (record, updates = {}) => {
  const current = readGameMeta(record.id, record.meta ?? {});
  const next = {
    ...current,
    ...updates,
    coverImageContentType: updates.coverImageContentType === null ? null
      : typeof updates.coverImageContentType === "string" ? readStoredImageContentType(updates.coverImageContentType)
        : current.coverImageContentType,
    scenarioId: String(updates.scenarioId ?? current.scenarioId).trim() || current.scenarioId,
    id: record.id,
    updatedAt: nowIso(),
  };
  record.meta = next;
  return next;
};

// Present-but-blank string fields are dropped so they preserve the current meta
// (server guards each with `String(x ?? cur).trim() || cur`). countryNameOverrides
// is an object and passes through.
const pickMetaUpdates = (body) => {
  const updates = {};
  for (const key of META_KEYS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (key !== "countryNameOverrides" && typeof value === "string" && value.trim() === "") continue;
    updates[key] = value;
  }
  return updates;
};

const trimmed = (value) => String(value ?? "").trim();

// --- Asset status ---------------------------------------------------------
const scenarioAssetPresent = (record, key) => {
  if (key === COVER_IMAGE_ASSET_KEY) return Boolean(record.cover);
  if (key === "colors") return record.colors !== undefined;
  if (key === "flags") return record.flags !== undefined;
  if (PMTILES_ASSET_KEYS.includes(key)) return record.pmtiles?.[key] !== undefined;
  if (SCENARIO_GEOJSON_ASSET_KEYS.includes(key)) return record.geojson?.[key] !== undefined;
  return false;
};
const getScenarioAssetStatus = (record) => {
  const status = {};
  for (const key of UPLOADABLE_SCENARIO_ASSET_KEYS) status[key] = scenarioAssetPresent(record, key);
  return status;
};
const getGameAssetStatus = (record) => ({ [COVER_IMAGE_ASSET_KEY]: Boolean(record.cover) });

const ensureUniqueId = async (requested, kind) => {
  const base = normalizeId(requested, kind);
  const existing = kind === "game" ? await listGameIds() : await listScenarioIds();
  let next = base;
  let suffix = 2;
  while (existing.has(next)) { next = `${base}-${suffix}`; suffix += 1; }
  return next;
};

// --- Catalog composition (mirror getScenarioCatalog/getGameCatalog/getLibraryCatalog) ---
const getScenarioCatalog = async () => {
  const manifest = await getScenarioManifest();
  const records = await idbGetAll(STORES.scenarios);
  const byId = new Map(records.map((r) => [r.id, r]));
  const usage = await getScenarioUsageCounts();
  const orderedIds = resolveOrderedIds(manifest.order, new Set(byId.keys()), DEFAULT_SCENARIO_ID);

  const scenarios = orderedIds.map((id) => {
    const record = byId.get(id);
    if (!record) return null;
    const meta = readScenarioMeta(id, record.meta ?? {});
    const assetStatus = getScenarioAssetStatus(record);
    const cacheToken = `${id}-${meta.updatedAt}`;
    return {
      ...meta,
      assetStatus,
      cacheToken,
      canDelete: true,
      coverImageUrl: assetStatus.cover ? coverDataUrl(record.cover) : null,
      gameCount: usage.get(id) ?? 0,
    };
  }).filter(Boolean);

  const selectedScenarioId = scenarios.some((s) => s.id === manifest.selectedScenarioId)
    ? manifest.selectedScenarioId : (scenarios[0]?.id ?? "");
  if (selectedScenarioId !== manifest.selectedScenarioId) {
    await saveScenarioManifest({ order: orderedIds, selectedScenarioId });
  }
  return { activeScenarioId: selectedScenarioId, scenarios, selectedScenarioId };
};

const getScenarioUsageCounts = async () => {
  const counts = new Map();
  for (const game of await idbGetAll(STORES.games)) {
    const scenarioId = readGameMeta(game.id, game.meta ?? {}).scenarioId;
    counts.set(scenarioId, (counts.get(scenarioId) ?? 0) + 1);
  }
  return counts;
};

const getGameCatalog = async () => {
  const scenarioCatalog = await getScenarioCatalog();
  const scenarioLookup = new Map(scenarioCatalog.scenarios.map((s) => [s.id, s]));
  const manifest = await getGameManifest();
  const records = await idbGetAll(STORES.games);
  const byId = new Map(records.map((r) => [r.id, r]));
  const orderedIds = resolveOrderedIds(manifest.order, new Set(byId.keys()), DEFAULT_GAME_ID);

  const games = orderedIds.map((id) => {
    const record = byId.get(id);
    if (!record) return null;
    const meta = readGameMeta(id, record.meta ?? {});
    const assetStatus = getGameAssetStatus(record);
    const gameData = jsonAsset(record, "game");
    const actions = jsonAsset(record, "actions");
    const events = jsonAsset(record, "events");
    const scenario = scenarioLookup.get(meta.scenarioId) ?? readScenarioMeta(meta.scenarioId, {});
    const pendingActions = Array.isArray(actions) ? actions.filter((e) => String(e?.status ?? "").trim() !== "resolved").length : 0;
    const cacheToken = `${id}-${meta.updatedAt}`;
    const ownCoverImageUrl = assetStatus.cover ? coverDataUrl(record.cover) : null;
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
      round: Number.isFinite(Number(gameData?.round)) && Number(gameData.round) > 0 ? Math.trunc(Number(gameData.round)) : 1,
      scenarioAccentColor: scenario?.accentColor ?? meta.accentColor,
      scenarioName: scenario?.name ?? meta.scenarioId,
    };
  }).filter(Boolean);

  const activeGameId = games.some((g) => g.id === manifest.activeGameId) ? manifest.activeGameId : (games[0]?.id ?? "");
  if (activeGameId !== manifest.activeGameId) await saveGameManifest({ activeGameId, order: orderedIds });
  return { activeGameId, games };
};

const getLibraryCatalog = async () => {
  const scenarioCatalog = await getScenarioCatalog();
  const gameCatalog = await getGameCatalog();
  const selectedScenario = scenarioCatalog.scenarios.find((s) => s.id === scenarioCatalog.selectedScenarioId) ?? scenarioCatalog.scenarios[0] ?? null;
  const activeGame = gameCatalog.games.find((g) => g.id === gameCatalog.activeGameId) ?? gameCatalog.games[0] ?? null;
  const runtimeScenario = activeGame && activeGame.scenarioId
    ? scenarioCatalog.scenarios.find((s) => s.id === activeGame.scenarioId) ?? null : null;
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
    token: activeGame && runtimeScenario
      ? `${activeGame.cacheToken}-${runtimeScenario.updatedAt || runtimeScenario.cacheToken || ""}`
      : activeGame?.cacheToken ?? "",
  };
};

const getScenarioSummary = async (id) => {
  const catalog = await getScenarioCatalog();
  const scenario = catalog.scenarios.find((s) => s.id === id);
  if (!scenario) throw new Error(`Scenario not found: ${id}`);
  return scenario;
};

const jsonDataBundle = (record) => {
  const data = {};
  for (const key of JSON_ASSET_KEYS) data[key] = jsonAsset(record, key);
  return data;
};

const getScenarioDetails = async (id) => {
  const record = await getScenario(id);
  if (!record) throw new Error(`Scenario not found: ${id}`);
  return { assetStatus: getScenarioAssetStatus(record), data: jsonDataBundle(record), scenario: await getScenarioSummary(id) };
};

const getGameSummary = async (id) => {
  const catalog = await getGameCatalog();
  const game = catalog.games.find((g) => g.id === id);
  if (!game) throw new Error(`Game not found: ${id}`);
  return game;
};

const getGameDetails = async (id) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);
  const meta = readGameMeta(id, record.meta ?? {});
  // Server getGameDetails calls getScenarioSummary inline (throws → 404) — no
  // graceful degradation for a game whose scenario no longer resolves.
  const scenario = await getScenarioSummary(meta.scenarioId);
  return { assetStatus: getGameAssetStatus(record), data: jsonDataBundle(record), game: await getGameSummary(id), scenario };
};

// --- Active-game / scenario resolution (runtime) --------------------------
const getActiveGameRecord = async () => {
  const catalog = await getGameCatalog();
  const id = catalog.games.find((g) => g.id === catalog.activeGameId)?.id ?? catalog.games[0]?.id;
  return id ? getGame(id) : null;
};
const getSelectedScenarioRecord = async () => {
  const catalog = await getScenarioCatalog();
  const id = catalog.scenarios.find((s) => s.id === catalog.selectedScenarioId)?.id ?? catalog.scenarios[0]?.id;
  return id ? getScenario(id) : null;
};
const getActiveRuntimeScenarioRecord = async () => {
  const activeGame = await getActiveGameRecord();
  const scenarioId = activeGame ? readGameMeta(activeGame.id, activeGame.meta).scenarioId : DEFAULT_SCENARIO_ID;
  return (await getScenario(scenarioId)) ?? (await getScenario(DEFAULT_SCENARIO_ID));
};

// The default scenario's political geometry (regions.geojson, ~12 MB) is too big
// to bundle in the web seed, so fetch it once from the content origin (the Worker
// proxy → GitHub Release) and cache it for the session. Without it the default
// scenario (customRegions: true) renders no colored countries and no labels.
const CONTENT_BASE = (import.meta.env.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "");
let defaultRegionsGeojsonPromise = null;
const fetchDefaultRegionsGeojson = () => {
  if (!defaultRegionsGeojsonPromise) {
    defaultRegionsGeojsonPromise = fetch(`${CONTENT_BASE}/default-regions.geojson`, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data) => {
        // Never pin an empty/failed result for the whole session — a transient
        // miss during the heavy first load would otherwise blank the political
        // map until reload. Clear the cache so the next read retries.
        if (!data || !Array.isArray(data.features) || data.features.length === 0) {
          defaultRegionsGeojsonPromise = null;
          return null;
        }
        return data;
      });
  }
  return defaultRegionsGeojsonPromise;
};

// --- Owner schema migration (mirror of the server's ensureOwnerSchema) ---
// Rewrites a record whose owners are GADM codes into one whose owners are country
// names. Imports server/ownerMigration.js rather than restating it: that module is
// pure ESM with no node imports, so Vite bundles it, and one implementation cannot
// drift from the other the way two hand-kept copies would.
//
// Synchronous and in-place — a web record holds world/game/colors/geojson together,
// so unlike the server there is nothing to keep in step across files. The caller
// persists the record it was already going to persist.
const migratedRecords = new Set();

const ensureOwnerSchema = (record, kind) => {
  if (!record?.id) return false;
  // `kind` is explicit rather than read off the record: a scenario and a game may
  // both be called "default", and one cache key for the two would migrate whichever
  // arrived first and mark the other done.
  const key = `${kind}:${record.id}`;
  if (migratedRecords.has(key)) return false;
  const world = record.json?.world;
  if (!world || !needsOwnerMigration(world)) {
    migratedRecords.add(key);
    return false;
  }
  try {
    // colors / flags / tags / snapshots are TOP-LEVEL on a record, not inside
    // record.json — only JSON_ASSET_KEYS live there (see runtimeValueFromRecord).
    const regions = parseJsonValue(record.geojson?.regionsGeojson, null);
    const renames = buildOwnerRenameMap({
      polityOverrides: world.polityOverrides,
      countryNameOverrides: record.meta?.countryNameOverrides,
      registry: COUNTRY_NAME_REGISTRY,
      features: regions?.features,
      ownershipOverrides: world.regionOwnershipOverrides,
      ownerCodes: world.ownerCodes,
      colors: record.colors,
      flags: record.flags,
      tags: record.tags,
      units: world.units,
      countryTags: world.countryTags,
      internationalReputation: world.internationalReputation,
      gameCountry: record.json?.game?.country,
    });
    const warn = (message) => console.warn(`[owner-migration] ${key}: ${message}`);

    if (record.colors) record.colors = rekeyOwnerMap(record.colors, renames, "colors", warn);
    if (record.flags) record.flags = rekeyOwnerMap(record.flags, renames, "flags", warn);
    if (record.tags) record.tags = rekeyOwnerMap(record.tags, renames, "tags", warn);
    if (record.json.events) record.json.events = migrateEvents(record.json.events, renames);
    if (record.json.chat) record.json.chat = migrateChat(record.json.chat, renames);
    if (record.json.game) record.json.game = migrateGame(record.json.game, renames);
    if (regions) record.geojson.regionsGeojson = migrateRegions(regions, renames);
    // Roll-back points hold a full nested copy of every owner-keyed structure and
    // are blind-written back over live state, with no marker to catch a stale one.
    if (record.snapshots) {
      delete record.snapshots;
      warn("discarded roll-back snapshots — they predate the owner rename");
    }
    // World last: it carries the marker, so a failure leaves the record unmarked
    // and the next read simply redoes it.
    record.json.world = migrateOwnerWorld(world, renames, warn);
    migratedRecords.add(key);
    console.log(`[owner-migration] ${key}: ${renames.size} owner(s) -> ${new Set(renames.values()).size} name(s)`);
    return true;
  } catch (error) {
    console.warn(`[owner-migration] ${key} failed: ${error.message}`);
    return false;
  }
};

// --- Runtime JSON read/write (mirror readRuntimeJsonAsset/writeRuntimeJsonAsset) ---
const readRuntimeJsonAsset = async (assetKey) => {
  // Above the geojson branch: it returns before anything else runs, and it is the
  // branch that serves the file `owner` physically lives in.
  const activeForMigration = await getActiveGameRecord();
  if (activeForMigration && ensureOwnerSchema(activeForMigration, "game")) {
    await idbPut(STORES.games, activeForMigration);
  }
  if (SCENARIO_GEOJSON_ASSET_KEYS.includes(assetKey)) {
    const scenario = await getActiveRuntimeScenarioRecord();
    // The scenario owns its geometry; migrate it as its OWN record.
    if (scenario && ensureOwnerSchema(scenario, "scenario")) await idbPut(STORES.scenarios, scenario);
    let value = scenario?.geojson?.[assetKey];
    if (value === undefined && assetKey === "regionsGeojson" && scenario && scenario.id !== DEFAULT_SCENARIO_ID) {
      // Borrowing the Modern Day map. Migrate it as DEFAULT'S record, never this
      // scenario's: those owners live in default's owner-space, so resolving them
      // against this world's polities would name Russia after whatever this
      // scenario calls that token. This scenario's own ownership is in its
      // world.regionOwnershipOverrides, migrated with its own record above.
      const fallback = await getScenario(DEFAULT_SCENARIO_ID);
      if (fallback && ensureOwnerSchema(fallback, "scenario")) await idbPut(STORES.scenarios, fallback);
      value = fallback?.geojson?.[assetKey];
    }
    // Web build: the default scenario's regions.geojson isn't in the seed (too
    // big), so pull it from the content origin — otherwise its political map is blank.
    if ((value === undefined || value === null) && assetKey === "regionsGeojson" && scenario && scenario.id === DEFAULT_SCENARIO_ID) {
      value = await fetchDefaultRegionsGeojson();
    }
    // geojson may be a raw uploaded string; parse-with-fallback like readJsonFile.
    return parseJsonValue(value, cloneJson(EMPTY_FEATURE_COLLECTION));
  }

  const activeGame = await getActiveGameRecord();
  const gameValue = activeGame ? runtimeValueFromRecord(activeGame, assetKey) : undefined;
  if (gameValue !== undefined) return normalizeRuntimeWorld(assetKey, coerceRuntimeValue(assetKey, gameValue));

  const scenario = await getActiveRuntimeScenarioRecord();
  const scenarioValue = scenario ? runtimeValueFromRecord(scenario, assetKey, /*scenarioScope*/ true) : undefined;
  if (scenarioValue !== undefined) return normalizeRuntimeWorld(assetKey, coerceRuntimeValue(assetKey, scenarioValue));

  if (assetKey === "colors") {
    // Server falls back to the immutable app palette (public/assets/colors.json),
    // NOT the mutable default-scenario colors. Keyed on "colors" specifically, not
    // on OPTIONAL_JSON_ASSET_KEYS: that list has more than one member now, and
    // handing the colour palette to a scenario that just has no flags.json would
    // put [102,95,86] in an <img src>. Mirrors server/libraryStore.js:1853-1868.
    return cloneJson(FALLBACK_COLORS ?? {});
  }
  if (OPTIONAL_JSON_ASSET_KEYS.includes(assetKey)) return {};
  return cloneJson(JSON_ASSET_DEFAULTS[assetKey] ?? {});
};

// The stored value for a runtime key on a record, or undefined if "no file".
const runtimeValueFromRecord = (record, assetKey, scenarioScope = false) => {
  if (assetKey === "colors") return record.colors;
  if (assetKey === "flags") return record.flags;
  if (assetKey === "snapshots") return scenarioScope ? undefined : record.snapshots; // snapshots are game-only
  if (JSON_ASSET_KEYS.includes(assetKey)) return record.json?.[assetKey];
  return undefined;
};

// colors may be stored as raw uploaded text; parse it on read (the 7 core json
// assets and snapshots are always structured, so they pass through).
const coerceRuntimeValue = (assetKey, value) =>
  (assetKey === "colors" || assetKey === "flags" ? parseJsonValue(value, {}) : value);

const writeRuntimeJsonAsset = async (assetKey, value) => {
  if (!JSON_ASSET_KEYS.includes(assetKey) && !OPTIONAL_JSON_ASSET_KEYS.includes(assetKey) && !RUNTIME_ONLY_JSON_ASSET_KEYS.includes(assetKey)) {
    throw new Error(`Unsupported JSON asset key: ${assetKey}`);
  }
  let activeGame = await getActiveGameRecord();
  if (!activeGame) {
    const scenario = await getSelectedScenarioRecord();
    if (!scenario) throw new Error("No active game — start a game from a scenario first.");
    const details = await createGame({ name: `${readScenarioMeta(scenario.id, scenario.meta).name} Session`, scenarioId: scenario.id, setActive: true });
    activeGame = await getGame(details.game.id);
  }

  let canonical = value;
  if (assetKey === "world") canonical = canonicalizeWorldCountryRefs(value);
  else if (assetKey === "game") canonical = canonicalizeGameCountry(value);
  else if (assetKey === "colors") canonical = canonicalizeColorKeys(value, activeGame.json?.world ?? null);

  if (assetKey === "colors") activeGame.colors = canonical;
  // Flags are keyed by owner code like colors, but are NOT canonicalized:
  // canonicalizeColorKeys resolves names->codes, and a flag key is always the
  // code the editor painted with.
  else if (assetKey === "flags") activeGame.flags = canonical;
  else if (assetKey === "snapshots") activeGame.snapshots = canonical;
  else activeGame.json = { ...activeGame.json, [assetKey]: canonical };
  writeGameMeta(activeGame, {});
  await putGame(activeGame);
  return readRuntimeJsonAsset(assetKey);
};

// --- Scenario mutations ---------------------------------------------------
const seedScenarioJsonFromScenario = (targetRecord, sourceRecord, baseRecord) => {
  const source = sourceRecord ?? emptyScenarioRecord(DEFAULT_SCENARIO_ID);
  const snapshot = { actions: jsonAsset(source, "actions"), chat: jsonAsset(source, "chat"), world: jsonAsset(source, "world") };
  if (!scenarioLooksLikeRuntimeSnapshot(snapshot)) {
    targetRecord.json = {};
    for (const key of JSON_ASSET_KEYS) targetRecord.json[key] = cloneJson(source.json?.[key] ?? JSON_ASSET_DEFAULTS[key]);
    copyScenarioOptionalAssets(targetRecord, source);
    return;
  }
  // Reseed a dirty source from the LIVE default scenario's clean data (server
  // reads the default's on-disk files, which reflect any edits).
  const base = baseRecord ?? defaultScenarioSeedRecord();
  targetRecord.json = {
    actions: cloneJson(base.json.actions), advisor: cloneJson(base.json.advisor),
    chat: cloneJson(base.json.chat), events: cloneJson(base.json.events),
    game: buildFreshGameSeedFromScenario({ baseGame: base.json.game, scenarioGame: source.json?.game }),
    prompts: cloneJson(source.json?.prompts && typeof source.json.prompts === "object" ? source.json.prompts : base.json.prompts),
    world: buildFreshWorldSeedFromScenario({ baseWorld: base.json.world, scenarioWorld: source.json?.world }),
  };
  copyScenarioOptionalAssets(targetRecord, source);
};

const copyScenarioOptionalAssets = (target, source) => {
  target.colors = source.colors !== undefined ? cloneJson(source.colors) : undefined;
  target.cover = source.cover ? { contentType: source.cover.contentType, bytes: source.cover.bytes.slice() } : undefined;
  target.geojson = {};
  for (const key of SCENARIO_GEOJSON_ASSET_KEYS) if (source.geojson?.[key] !== undefined) target.geojson[key] = cloneJson(source.geojson[key]);
  target.pmtiles = {};
  for (const key of PMTILES_ASSET_KEYS) if (source.pmtiles?.[key] !== undefined) target.pmtiles[key] = source.pmtiles[key].slice();
};

const seedGameJsonFromScenario = (targetRecord, sourceScenario, baseRecord) => {
  const snapshot = { actions: jsonAsset(sourceScenario, "actions"), chat: jsonAsset(sourceScenario, "chat"), world: jsonAsset(sourceScenario, "world") };
  if (!scenarioLooksLikeRuntimeSnapshot(snapshot)) {
    targetRecord.json = {};
    for (const key of JSON_ASSET_KEYS) targetRecord.json[key] = cloneJson(sourceScenario.json?.[key] ?? JSON_ASSET_DEFAULTS[key]);
    return;
  }
  const base = baseRecord ?? defaultScenarioSeedRecord();
  targetRecord.json = {
    actions: cloneJson(base.json.actions), advisor: cloneJson(base.json.advisor),
    chat: cloneJson(base.json.chat), events: cloneJson(base.json.events),
    game: buildFreshGameSeedFromScenario({ baseGame: base.json.game, scenarioGame: sourceScenario.json?.game }),
    prompts: cloneJson(sourceScenario.json?.prompts && typeof sourceScenario.json.prompts === "object" ? sourceScenario.json.prompts : base.json.prompts),
    world: buildFreshWorldSeedFromScenario({ baseWorld: base.json.world, scenarioWorld: sourceScenario.json?.world }),
  };
};

const createScenario = async (body = {}) => {
  const id = await ensureUniqueId(body.id || body.name || "scenario", "scenario");
  const record = emptyScenarioRecord(id);
  const sourceRecord = body.seedScenarioId ? await getScenario(body.seedScenarioId) : null;
  const sourceSummary = sourceRecord ? await getScenarioSummary(body.seedScenarioId) : null;
  const baseRecord = (await getScenario(DEFAULT_SCENARIO_ID)) ?? defaultScenarioSeedRecord();
  if (sourceRecord) {
    // Seed from another scenario: json + optional assets (+ snapshot handling).
    seedScenarioJsonFromScenario(record, sourceRecord, baseRecord);
  } else {
    // No seed: copy ONLY the 7 json assets from the default (server does not copy
    // optional assets — cover/colors/pmtiles/geojson — on this path).
    record.json = {};
    for (const key of JSON_ASSET_KEYS) record.json[key] = cloneJson(baseRecord.json?.[key] ?? JSON_ASSET_DEFAULTS[key]);
  }

  // Meta cascade + seed inheritance, byte-faithful to server createScenario (:1260).
  const createdAt = nowIso();
  record.meta = {
    accentColor: trimmed(body.accentColor) || DEFAULT_SCENARIO_META.accentColor,
    coverImageContentType: sourceSummary?.coverImageContentType ?? null,
    countryNameOverrides: body.countryNameOverrides && typeof body.countryNameOverrides === "object" ? body.countryNameOverrides : {},
    createdAt,
    description: trimmed(body.description) || trimmed(body.subtitle) || trimmed(body.name) || DEFAULT_SCENARIO_META.description,
    eyebrow: trimmed(body.eyebrow) || DEFAULT_SCENARIO_META.eyebrow,
    heroSubtitle: trimmed(body.heroSubtitle) || trimmed(body.description) || trimmed(body.subtitle) || sourceSummary?.heroSubtitle || DEFAULT_SCENARIO_META.heroSubtitle,
    heroTitle: trimmed(body.heroTitle) || trimmed(body.name) || sourceSummary?.heroTitle || DEFAULT_SCENARIO_META.heroTitle,
    id,
    name: trimmed(body.name) || "Custom Scenario",
    subtitle: trimmed(body.subtitle) || trimmed(body.description) || sourceSummary?.subtitle || DEFAULT_SCENARIO_META.subtitle,
    updatedAt: createdAt,
  };
  await putScenario(record);

  const manifest = await getScenarioManifest();
  const order = resolveOrderedIds(manifest.order, await listScenarioIds(), DEFAULT_SCENARIO_ID).filter((e) => e !== id);
  order.unshift(id);
  await saveScenarioManifest({ order, selectedScenarioId: body.setActive ? id : manifest.selectedScenarioId });
  return getScenarioDetails(id);
};

const updateScenario = async (id, body = {}) => {
  const record = await getScenario(id);
  if (!record) throw new Error(`Scenario not found: ${id}`);
  writeScenarioMeta(record, pickMetaUpdates(body));
  applyJsonMutations(record, body, /*canonicalizeCountry*/ true, "scenario");
  await putScenario(record);
  if (body.setActive) await setSelectedScenario(id);
  return getScenarioDetails(id);
};

const applyJsonMutations = (record, body, canonicalize, kind) => {
  record.json = record.json ?? {};
  // Migrate before mutating: resolving a country reference against a world whose
  // polities are still code-keyed matches none of them and quietly invents a
  // parallel country.
  ensureOwnerSchema(record, kind);
  // The world these refs resolve against: the one in this same body if there is
  // one, else what the record already holds.
  const worldContext = () =>
    (body.world && typeof body.world === "object" ? body.world
      : body.worldPatch && typeof body.worldPatch === "object" ? body.worldPatch
        : jsonAsset(record, "world"));
  // The *Patch branches used to spread raw while their full-value twins
  // canonicalized, so the same edit landed differently depending on which shape
  // the client happened to send — and differently again from the desktop.
  if (body.game !== undefined) record.json.game = canonicalize ? canonicalizeGameCountry(body.game, worldContext()) : body.game;
  else if (body.gamePatch && typeof body.gamePatch === "object") {
    const merged = { ...jsonAsset(record, "game"), ...body.gamePatch };
    record.json.game = canonicalize ? canonicalizeGameCountry(merged, worldContext()) : merged;
  }
  if (body.prompts !== undefined) record.json.prompts = body.prompts;
  else if (body.promptsPatch && typeof body.promptsPatch === "object") record.json.prompts = { ...jsonAsset(record, "prompts"), ...body.promptsPatch };
  if (body.world !== undefined) record.json.world = canonicalize ? canonicalizeWorldCountryRefs(body.world) : body.world;
  else if (body.worldPatch && typeof body.worldPatch === "object") {
    const merged = { ...jsonAsset(record, "world"), ...body.worldPatch };
    record.json.world = canonicalize ? canonicalizeWorldCountryRefs(merged) : merged;
  }
  // The world we just wrote may be a LEGACY one — importScenarioBundle replaces the
  // record's world wholesale, and the ensureOwnerSchema above ran against whatever
  // was there before it (for a new scenario, a copy of the already-migrated default).
  // That marked this record done while its real, unmigrated payload was still on its
  // way in, and every later read then short-circuits on the mark: world name-keyed,
  // colours/flags/tags/regions still code-keyed, patchwork map, no error.
  //
  // The mark has to describe what is actually PERSISTED, so re-derive it from the
  // world that ended up on the record rather than the one that happened to be there
  // when we looked.
  if (record.id && needsOwnerMigration(record.json.world)) migratedRecords.delete(`${kind}:${record.id}`);
  if (body.storage && typeof body.storage === "object") {
    for (const key of STORAGE_JSON_ASSET_KEYS) if (key in body.storage) record.json[key] = body.storage[key];
  }
};

const setSelectedScenario = async (scenarioId) => {
  const id = String(scenarioId ?? "").trim();
  if (!id || !(await getScenario(id))) throw new Error(`Scenario not found: ${id}`);
  const manifest = await getScenarioManifest();
  await saveScenarioManifest({ order: [id, ...manifest.order.filter((e) => e !== id)], selectedScenarioId: id });
  return getLibraryCatalog();
};

const deleteScenario = async (id) => {
  const usage = await getScenarioUsageCounts();
  if ((usage.get(id) ?? 0) > 0) throw new Error("This scenario is still used by one or more games.");
  await idbDelete(STORES.scenarios, id);
  const manifest = await getScenarioManifest();
  const remaining = resolveOrderedIds(manifest.order.filter((e) => e !== id), await listScenarioIds(), DEFAULT_SCENARIO_ID);
  const selectedScenarioId = manifest.selectedScenarioId === id ? (remaining[0] ?? "") : manifest.selectedScenarioId;
  await saveScenarioManifest({ order: remaining, selectedScenarioId });
  return getLibraryCatalog();
};

// --- Game mutations -------------------------------------------------------
const createGame = async (body = {}) => {
  const id = await ensureUniqueId(body.id || body.name || "game", "game");
  const record = emptyGameRecord(id);
  const baseRecord = (await getScenario(DEFAULT_SCENARIO_ID)) ?? defaultScenarioSeedRecord();
  let sourceScenarioSummary = null;
  let sourceGameSummary = null;

  if (body.seedGameId && (await getGame(body.seedGameId))) {
    sourceGameSummary = await getGameSummary(body.seedGameId);
    const source = await getGame(body.seedGameId);
    record.json = {};
    for (const key of JSON_ASSET_KEYS) record.json[key] = cloneJson(source.json?.[key] ?? JSON_ASSET_DEFAULTS[key]);
    record.cover = source.cover ? { contentType: source.cover.contentType, bytes: source.cover.bytes.slice() } : undefined;
  } else {
    const nextScenarioId = trimmed(body.scenarioId) || DEFAULT_SCENARIO_ID;
    // Server calls getScenarioSummary here, which THROWS on an unknown id → 400.
    sourceScenarioSummary = await getScenarioSummary(nextScenarioId);
    seedGameJsonFromScenario(record, await getScenario(nextScenarioId), baseRecord);
  }

  // Meta cascade + seed inheritance, byte-faithful to server createGame (:1343).
  const createdAt = nowIso();
  const scenarioSummary = sourceScenarioSummary ?? await getScenarioSummary(sourceGameSummary?.scenarioId ?? DEFAULT_SCENARIO_ID);
  const seedName = sourceGameSummary?.name ?? scenarioSummary.name;
  record.meta = {
    accentColor: trimmed(body.accentColor) || sourceGameSummary?.accentColor || scenarioSummary.accentColor || DEFAULT_GAME_META.accentColor,
    createdAt,
    description: trimmed(body.description) || sourceGameSummary?.description || scenarioSummary.description || DEFAULT_GAME_META.description,
    eyebrow: trimmed(body.eyebrow) || sourceGameSummary?.eyebrow || DEFAULT_GAME_META.eyebrow,
    heroSubtitle: trimmed(body.heroSubtitle) || sourceGameSummary?.heroSubtitle || scenarioSummary.heroSubtitle || DEFAULT_GAME_META.heroSubtitle,
    heroTitle: trimmed(body.heroTitle) || sourceGameSummary?.heroTitle || scenarioSummary.heroTitle || DEFAULT_GAME_META.heroTitle,
    id,
    name: trimmed(body.name) || `${seedName} Session`,
    scenarioId: scenarioSummary.id,
    coverImageContentType: sourceGameSummary?.coverImageContentType ?? null,
    subtitle: trimmed(body.subtitle) || sourceGameSummary?.subtitle || scenarioSummary.subtitle || DEFAULT_GAME_META.subtitle,
    updatedAt: createdAt,
  };
  await putGame(record);
  const manifest = await getGameManifest();
  const order = resolveOrderedIds(manifest.order, await listGameIds(), DEFAULT_GAME_ID).filter((e) => e !== id);
  order.unshift(id);
  await saveGameManifest({ activeGameId: body.setActive ? id : manifest.activeGameId, order });
  return getGameDetails(id);
};

const updateGame = async (id, body = {}) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);
  writeGameMeta(record, pickMetaUpdates(body));
  applyJsonMutations(record, body, true, "game");
  await putGame(record);
  if (body.setActive) await setActiveGame(id);
  return getGameDetails(id);
};

const setActiveGame = async (gameId) => {
  const id = String(gameId ?? "").trim();
  if (!id || !(await getGame(id))) throw new Error(`Game not found: ${id}`);
  const manifest = await getGameManifest();
  await saveGameManifest({ activeGameId: id, order: [id, ...manifest.order.filter((e) => e !== id)] });
  return getLibraryCatalog();
};

const deleteGame = async (id) => {
  await idbDelete(STORES.games, id);
  const manifest = await getGameManifest();
  const remaining = resolveOrderedIds(manifest.order.filter((e) => e !== id), await listGameIds(), DEFAULT_GAME_ID);
  const activeGameId = manifest.activeGameId === id ? (remaining[0] ?? "") : manifest.activeGameId;
  await saveGameManifest({ activeGameId, order: remaining });
  return getLibraryCatalog();
};

// --- Uploadable assets ----------------------------------------------------
const validateImageContentType = (contentType) => {
  const normalized = String(contentType ?? "").trim().toLowerCase();
  if (!SUPPORTED_IMAGE_CONTENT_TYPES.has(normalized)) throw new Error(`Unsupported cover image type: ${contentType}`);
  return normalized;
};

const uploadScenarioAsset = async (id, key, bytes, contentType) => {
  const record = await getScenario(id);
  if (!record) throw new Error(`Scenario not found: ${id}`);
  if (!UPLOADABLE_SCENARIO_ASSET_KEYS.includes(key)) throw new Error(`Unsupported asset key: ${key}`);
  if (key === COVER_IMAGE_ASSET_KEY) {
    const ct = validateImageContentType(contentType);
    record.cover = { contentType: ct, bytes };
    writeScenarioMeta(record, { coverImageContentType: ct });
  } else if (key === "colors") {
    // Server stores upload bytes verbatim (no JSON validation) — keep the raw text.
    record.colors = new TextDecoder().decode(bytes);
    writeScenarioMeta(record, {});
  } else if (PMTILES_ASSET_KEYS.includes(key)) {
    record.pmtiles = { ...record.pmtiles, [key]: bytes };
    writeScenarioMeta(record, {});
  } else { // geojson
    record.geojson = { ...record.geojson, [key]: new TextDecoder().decode(bytes) };
    writeScenarioMeta(record, {});
  }
  await putScenario(record);
  return getScenarioDetails(id);
};

const removeScenarioAsset = async (id, key) => {
  const record = await getScenario(id);
  if (!record) throw new Error(`Scenario not found: ${id}`);
  if (key === COVER_IMAGE_ASSET_KEY) { record.cover = undefined; writeScenarioMeta(record, { coverImageContentType: null }); }
  else if (key === "colors") { record.colors = undefined; writeScenarioMeta(record, {}); }
  else if (PMTILES_ASSET_KEYS.includes(key)) { if (record.pmtiles) delete record.pmtiles[key]; writeScenarioMeta(record, {}); }
  else if (SCENARIO_GEOJSON_ASSET_KEYS.includes(key)) { if (record.geojson) delete record.geojson[key]; writeScenarioMeta(record, {}); }
  await putScenario(record);
  return getScenarioDetails(id);
};

const scenarioAssetResponse = (record, key, rangeHeader) => {
  if (key === COVER_IMAGE_ASSET_KEY) {
    if (!record.cover) throw new Error("Asset not found");
    return binaryResponse(record.cover.bytes, record.cover.contentType || "application/octet-stream", rangeHeader);
  }
  if (key === "colors") {
    if (record.colors === undefined) throw new Error("Asset not found");
    // Serve the stored value verbatim (byte-faithful like the server), not re-encoded.
    return new Response(serializeJsonValue(record.colors), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (PMTILES_ASSET_KEYS.includes(key)) {
    if (record.pmtiles?.[key] === undefined) throw new Error("Asset not found");
    return binaryResponse(record.pmtiles[key], "application/octet-stream", rangeHeader);
  }
  if (SCENARIO_GEOJSON_ASSET_KEYS.includes(key)) {
    if (record.geojson?.[key] === undefined) throw new Error("Asset not found");
    return new Response(serializeJsonValue(record.geojson[key]), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  throw new Error(`Unsupported asset key: ${key}`);
};

const uploadGameAsset = async (id, key, bytes, contentType) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);
  if (key !== COVER_IMAGE_ASSET_KEY) throw new Error(`Unsupported asset key: ${key}`);
  const ct = validateImageContentType(contentType);
  record.cover = { contentType: ct, bytes };
  writeGameMeta(record, { coverImageContentType: ct });
  await putGame(record);
  return getGameDetails(id);
};

const removeGameAsset = async (id, key) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);
  if (key === COVER_IMAGE_ASSET_KEY) { record.cover = undefined; writeGameMeta(record, { coverImageContentType: null }); }
  await putGame(record);
  return getGameDetails(id);
};

// --- Export / import ------------------------------------------------------
const exportScenarioBundle = async (id, mode = "light") => {
  const record = await getScenario(id);
  if (!record) throw new Error(`Scenario not found: ${id}`);
  const meta = readScenarioMeta(id, record.meta ?? {});
  const full = mode === "full";
  const data = {};
  for (const key of JSON_ASSET_KEYS) data[key] = cloneJson(jsonAsset(record, key));

  const assets = {};
  assets.cover = record.cover
    ? { contentType: record.cover.contentType, data: bytesToBase64(record.cover.bytes), encoding: "base64", fileName: "cover-image.bin", mode: "embedded" }
    : { fileName: "cover-image.bin", mode: "default" };
  assets.colors = record.colors !== undefined
    ? { data: parseJsonValue(record.colors, {}), fileName: "colors.json", mode: "embedded" }
    : { fileName: "colors.json", mode: "default" };
  for (const [key, fileName] of [["regionsGeojson", "regions.geojson"], ["citiesGeojson", "cities.geojson"], ["backgroundData", "background.json"]]) {
    assets[key] = record.geojson?.[key] !== undefined
      ? { contentType: "application/json", data: bytesToBase64(new TextEncoder().encode(serializeJsonValue(record.geojson[key]))), encoding: "base64", fileName, mode: "embedded" }
      : { fileName, mode: "default" };
  }
  for (const [key, fileName] of [["cities", "cities.pmtiles"], ["countries", "countries.pmtiles"], ["regions", "regions.pmtiles"]]) {
    const present = record.pmtiles?.[key] !== undefined;
    assets[key] = present && full
      ? { contentType: "application/octet-stream", data: bytesToBase64(record.pmtiles[key]), encoding: "base64", fileName, mode: "embedded" }
      : { droppedOverride: present, fileName, mode: "default" };
  }
  return {
    schema: SCENARIO_BUNDLE_SCHEMA, version: SCENARIO_BUNDLE_VERSION, mode: full ? "full" : "light", exportedAt: nowIso(),
    scenario: { accentColor: meta.accentColor, countryNameOverrides: meta.countryNameOverrides, description: meta.description,
      eyebrow: meta.eyebrow, heroSubtitle: meta.heroSubtitle, heroTitle: meta.heroTitle, id: meta.id, name: meta.name, subtitle: meta.subtitle },
    data, assets,
  };
};

const importScenarioBundle = async (bundle) => {
  // Accept every schema we can read, not just the one we write — a v1 bundle
  // imports fine, arriving unmarked and named by the migration on first read.
  if (!bundle || typeof bundle !== "object" || !ACCEPTED_BUNDLE_SCHEMAS.has(bundle.schema)) throw new Error("Unsupported scenario bundle.");
  // Hub provenance the community tab attaches to a direct import — stamped
  // LAST so the import's own meta writes don't clear it.
  const hubOrigin = normalizeHubOrigin(bundle.hubOrigin);
  const created = await createScenario({ ...(bundle.scenario ?? {}), setActive: false });
  const newId = created.scenario.id;
  // Server coerces missing bundle data to empty ({} / []) which then OVERWRITES
  // the seeded default (updateScenario's `game && typeof===object` guard), so a
  // partial bundle yields empty assets, not the default-scenario content.
  const data = bundle.data ?? {};
  await updateScenario(newId, {
    game: data.game ?? {}, prompts: data.prompts ?? {}, world: data.world ?? {},
    storage: { actions: data.actions ?? [], advisor: data.advisor ?? [], chat: data.chat ?? [], events: data.events ?? [] },
  });
  for (const [key, descriptor] of Object.entries(bundle.assets ?? {})) {
    if (!UPLOADABLE_SCENARIO_ASSET_KEYS.includes(key)) continue;
    const embedded = descriptor?.mode === "embedded";
    if (key === COVER_IMAGE_ASSET_KEY) {
      if (embedded && descriptor.data) await uploadScenarioAsset(newId, key, base64ToBytes(descriptor.data), descriptor.contentType);
      else await removeScenarioAsset(newId, key);
    } else if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) {
      // colors / flags / tags are JSON descriptor assets: `descriptor.data` is the
      // object itself, NOT base64. Store it verbatim on the record. Passing it to
      // base64ToBytes (as the binary branch below does) makes atob throw
      // "string to be decoded is not correctly encoded" — which made EVERY scenario
      // carrying tags or flags (e.g. the WWII preset) fail to import on the web build.
      const r = await getScenario(newId);
      if (embedded && descriptor.data !== undefined) r[key] = descriptor.data;
      else delete r[key];
      writeScenarioMeta(r, {});
      await putScenario(r);
    } else if (embedded && typeof descriptor.data === "string") {
      // geojson / pmtiles: base64-encoded binary. The typeof guard keeps any stray
      // non-string payload from reaching atob and crashing the whole import.
      await uploadScenarioAsset(newId, key, base64ToBytes(descriptor.data), descriptor.contentType);
    } else {
      await removeScenarioAsset(newId, key);
    }
  }
  if (hubOrigin) {
    const record = await getScenario(newId);
    writeScenarioMeta(record, { hubOrigin });
    await putScenario(record);
  }
  await setSelectedScenario(newId);
  return getScenarioDetails(newId);
};

// The "Update" path for a hub-imported scenario: replace an EXISTING scenario's
// content with a fresh bundle, keeping the local id (games reference scenarios
// by id) and createdAt. Every uploadable asset the new bundle doesn't carry is
// cleared so a dropped basemap or cover doesn't linger; the new hubOrigin is
// stamped last (server twin: updateScenarioFromBundle).
const updateScenarioFromBundle = async (scenarioId, bundle) => {
  if (!bundle || typeof bundle !== "object" || !ACCEPTED_BUNDLE_SCHEMAS.has(bundle.schema)) throw new Error("Unsupported scenario bundle.");
  const existing = await getScenario(scenarioId);
  if (!existing) throw new Error(`Scenario not found: ${scenarioId}`);
  const scenario = bundle.scenario && typeof bundle.scenario === "object" ? bundle.scenario : {};
  const data = bundle.data ?? {};
  const hubOrigin = normalizeHubOrigin(bundle.hubOrigin);

  const metaPatch = {};
  for (const key of ["accentColor", "name", "subtitle", "description", "eyebrow", "heroTitle", "heroSubtitle"]) {
    if (scenario[key] != null) metaPatch[key] = scenario[key];
  }
  if (scenario.countryNameOverrides && typeof scenario.countryNameOverrides === "object") {
    metaPatch.countryNameOverrides = scenario.countryNameOverrides;
  }
  writeScenarioMeta(existing, metaPatch);
  await putScenario(existing);

  await updateScenario(scenarioId, {
    game: data.game ?? {}, prompts: data.prompts ?? {}, world: data.world ?? {},
    storage: { actions: data.actions ?? [], advisor: data.advisor ?? [], chat: data.chat ?? [], events: data.events ?? [] },
  });

  for (const key of UPLOADABLE_SCENARIO_ASSET_KEYS) {
    const descriptor = (bundle.assets ?? {})[key];
    const embedded = descriptor?.mode === "embedded";
    if (key === COVER_IMAGE_ASSET_KEY) {
      if (embedded && descriptor.data) await uploadScenarioAsset(scenarioId, key, base64ToBytes(descriptor.data), descriptor.contentType);
      else await removeScenarioAsset(scenarioId, key);
    } else if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) {
      // JSON descriptor assets carry the object itself, not base64 (see the
      // matching branch in importScenarioBundle above).
      const r = await getScenario(scenarioId);
      if (embedded && descriptor.data !== undefined) r[key] = descriptor.data;
      else delete r[key];
      writeScenarioMeta(r, {});
      await putScenario(r);
    } else if (embedded && typeof descriptor.data === "string") {
      await uploadScenarioAsset(scenarioId, key, base64ToBytes(descriptor.data), descriptor.contentType);
    } else {
      await removeScenarioAsset(scenarioId, key);
    }
  }

  if (hubOrigin) {
    const record = await getScenario(scenarioId);
    writeScenarioMeta(record, { hubOrigin });
    await putScenario(record);
  }
  return getScenarioDetails(scenarioId);
};

// --- pmtiles override (runtime binary) ------------------------------------
export const getScenarioPmtilesOverride = async (key, rangeHeader) => {
  if (!PMTILES_ASSET_KEYS.includes(key)) return null;
  const scenario = await getActiveRuntimeScenarioRecord();
  const bytes = scenario?.pmtiles?.[key];
  if (bytes === undefined) return null;
  return binaryResponse(bytes, "application/octet-stream", rangeHeader);
};

// --- Seeding --------------------------------------------------------------
const defaultScenarioSeedRecord = () => {
  const record = emptyScenarioRecord(DEFAULT_SCENARIO_ID);
  record.meta = { ...DEFAULT_SCENARIO_META, ...(DEFAULT_SEED.meta ?? {}), countryNameOverrides: {}, createdAt: nowIso(), updatedAt: nowIso() };
  record.json = {
    actions: cloneJson(DEFAULT_SEED.data?.actions ?? []), advisor: cloneJson(DEFAULT_SEED.data?.advisor ?? []),
    chat: cloneJson(DEFAULT_SEED.data?.chat ?? []), events: cloneJson(DEFAULT_SEED.data?.events ?? []),
    game: cloneJson(DEFAULT_SEED.data?.game ?? {}), prompts: cloneJson(DEFAULT_SEED.data?.prompts ?? {}),
    world: cloneJson(DEFAULT_SEED.data?.world ?? {}),
  };
  record.colors = DEFAULT_SEED.colors !== undefined ? cloneJson(DEFAULT_SEED.colors) : undefined;
  record.cover = DEFAULT_SEED.cover ? { contentType: DEFAULT_SEED.cover.contentType, bytes: base64ToBytes(DEFAULT_SEED.cover.base64) } : undefined;
  return record;
};

export const ensureSeeded = async () => {
  if (await kvGet("seeded", false)) return;
  if (!(await getScenario(DEFAULT_SCENARIO_ID))) {
    await putScenario(defaultScenarioSeedRecord());
    const manifest = await getScenarioManifest();
    if (!manifest.order.includes(DEFAULT_SCENARIO_ID)) manifest.order.unshift(DEFAULT_SCENARIO_ID);
    await saveScenarioManifest({ order: manifest.order, selectedScenarioId: manifest.selectedScenarioId || DEFAULT_SCENARIO_ID });
  }
  await kvPut("seeded", true);
};

// --- Router handlers ------------------------------------------------------
export const handleLibrary = async ({ method }) => {
  if (method !== "GET") return null;
  try { return jsonResponse(await getLibraryCatalog()); }
  catch (error) { return errorResponse(error.message, 500); }
};

export const handleScenarios = async ({ method, segments, body, rawBody, contentType, query, rangeHeader }) => {
  const id = segments[0] ? decodeURIComponent(segments[0]) : null;
  try {
    if (!id) {
      if (method === "POST") return jsonResponse(await createScenario(body ?? {}), 201);
      if (method === "GET") return jsonResponse(await getScenarioCatalog());
      return null;
    }
    // /api/scenarios/selected|active
    if ((id === "selected" || id === "active") && method === "PUT") return jsonResponse(await setSelectedScenario(body?.scenarioId));
    if (id === "import" && method === "POST") return jsonResponse(await importScenarioBundle(body ?? {}), 201);

    const sub = segments[1];
    if (!sub) {
      if (method === "GET") return jsonResponse(await getScenarioDetails(id));
      if (method === "PUT") return jsonResponse(await updateScenario(id, body ?? {}));
      if (method === "DELETE") return jsonResponse(await deleteScenario(id));
      return null;
    }
    if (sub === "import" && method === "PUT") return jsonResponse(await updateScenarioFromBundle(id, body ?? {}));
    if (sub === "export" && method === "GET") return jsonResponse(await exportScenarioBundle(id, query?.get("mode") || "light"));
    if (sub === "assets" && segments[2]) {
      const key = decodeURIComponent(segments[2]);
      if (method === "GET") { const record = await getScenario(id); if (!record) throw new Error(`Scenario not found: ${id}`); return scenarioAssetResponse(record, key, rangeHeader); }
      if (method === "PUT") return jsonResponse(await uploadScenarioAsset(id, key, rawBody, contentType));
      if (method === "DELETE") return jsonResponse(await removeScenarioAsset(id, key));
    }
    return null;
  } catch (error) {
    // Reads (GET details/asset) → 404; every mutation → 400 (mirrors server.js).
    return errorResponse(error.message, method === "GET" ? 404 : 400);
  }
};

export const handleGames = async ({ method, segments, body, rawBody, contentType, rangeHeader }) => {
  const id = segments[0] ? decodeURIComponent(segments[0]) : null;
  try {
    if (!id) {
      if (method === "POST") return jsonResponse(await createGame(body ?? {}), 201);
      if (method === "GET") return jsonResponse(await getGameCatalog());
      return null;
    }
    if (id === "active" && method === "PUT") return jsonResponse(await setActiveGame(body?.gameId));

    const sub = segments[1];
    if (!sub) {
      if (method === "GET") return jsonResponse(await getGameDetails(id));
      if (method === "PUT") return jsonResponse(await updateGame(id, body ?? {}));
      if (method === "DELETE") return jsonResponse(await deleteGame(id));
      return null;
    }
    if (sub === "assets" && segments[2]) {
      const key = decodeURIComponent(segments[2]);
      if (method === "GET") {
        const record = await getGame(id);
        if (!record || key !== COVER_IMAGE_ASSET_KEY || !record.cover) throw new Error("Asset not found");
        return binaryResponse(record.cover.bytes, record.cover.contentType || "application/octet-stream", rangeHeader);
      }
      if (method === "PUT") return jsonResponse(await uploadGameAsset(id, key, rawBody, contentType));
      if (method === "DELETE") return jsonResponse(await removeGameAsset(id, key));
    }
    return null;
  } catch (error) {
    const status = method === "GET" ? 404 : 400;
    return errorResponse(error.message, status);
  }
};

export const handleRuntimeJson = async ({ method, segments, body }) => {
  const key = segments[1] ? decodeURIComponent(segments[1]) : null;
  if (!key) return null;
  try {
    if (method === "GET") return jsonResponse(await readRuntimeJsonAsset(key));
    if (method === "PUT") return jsonResponse(await writeRuntimeJsonAsset(key, body ?? {}));
    return null;
  } catch (error) {
    return errorResponse(error.message, method === "GET" ? 404 : 400);
  }
};
