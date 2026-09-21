/*! Open Historia — web-mode library/scenario/game/runtime store © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Browser (IndexedDB) port of server/libraryStore.js. Backs /api/library,
// /api/scenarios*, /api/games*, /api/runtime/json*, /api/runtime/pmtiles* in web
// mode. Response shapes are byte-faithful to the server so the unchanged client
// (src/runtime/library.js, assets.js) works exactly as against the real server.
// Web build only.

import { STORES, idbGet, idbGetAll, idbGetAllKeys, idbPut, idbPutPair, idbDelete, kvGet, kvPut } from "./idb.js";
import { serializeWrite } from "./writeQueue.js";
import { coarsenFeatureCollection } from "../../../server/coarseGeometry.js";
import {
  cloneJson, nowIso, jsonResponse, errorResponse, binaryResponse, base64ToBytes, bytesToBase64,
  parseJsonValue, serializeJsonValue,
} from "./util.js";
import FALLBACK_COLORS from "./generated/fallbackColors.js";
import { builtInMap as BUILT_IN_MAP, builtInRevision as BUILT_IN_REVISION, regionsUrl as BUILT_IN_REGIONS_URL } from "./generated/defaultScenarioMeta.js";
import {
  DEFAULT_SCENARIO_ID, DEFAULT_GAME_ID, EMPTY_FEATURE_COLLECTION, COVER_IMAGE_ASSET_KEY,
  JSON_ASSET_KEYS, STORAGE_JSON_ASSET_KEYS, OPTIONAL_JSON_ASSET_KEYS, RUNTIME_ONLY_JSON_ASSET_KEYS,
  PMTILES_ASSET_KEYS, SCENARIO_GEOJSON_ASSET_KEYS, UPLOADABLE_SCENARIO_ASSET_KEYS, UPLOADABLE_GAME_ASSET_KEYS,
  JSON_ASSET_DEFAULTS, SCENARIO_BUNDLE_SCHEMA, ACCEPTED_BUNDLE_SCHEMAS, SCENARIO_BUNDLE_VERSION, SUPPORTED_IMAGE_CONTENT_TYPES,
  DEFAULT_SCENARIO_META, DEFAULT_GAME_META, canonicalizeWorldCountryRefs, canonicalizeGameCountry, canonicalizeColorKeys,
  readScenarioMeta, readGameMeta, readStoredImageContentType, resolveOrderedIds, normalizeId, normalizePlayCount,
  scenarioLooksLikeRuntimeSnapshot, buildFreshGameSeedFromScenario, buildFreshWorldSeedFromScenario,
  normalizeRuntimeWorld, COUNTRY_NAME_REGISTRY, normalizeHubOrigin,
  GAME_BUNDLE_SCHEMA, ACCEPTED_GAME_BUNDLE_SCHEMAS, GAME_BUNDLE_DATA_KEYS,
  OPTIONAL_GAME_BUNDLE_KEYS, BUILT_IN_SCENARIO_IDS,
} from "./models.js";
import { normalizeFeatureOverrides, normalizeFeatureSettings } from "../../../server/gameFeatures.js";
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

const SCENARIO_MANIFEST_KEY = "scenario-manifest";
const GAME_MANIFEST_KEY = "game-manifest";
const META_KEYS = ["accentColor", "countryNameOverrides", "description", "eyebrow", "features", "heroSubtitle", "heroTitle", "name", "subtitle"];

// --- Record accessors -----------------------------------------------------
// scenario record: { id, meta, json:{7}, colors?, geojson:{...}, pmtiles:{...}, cover?:{contentType,bytes} }
// game record:     { id, meta, json:{7}, colors?, snapshots?, cover?:{contentType,bytes} }

const getScenario = (id) => idbGet(STORES.scenarios, id);
const getGame = (id) => idbGet(STORES.games, id);
// Lean catalog projections — everything a menu card needs, and NONE of the embedded
// pmtiles/geojson (scenarios) or snapshots/full json (games). Written beside every
// record so getLibraryCatalog builds the menu from these instead of structured-
// cloning the full ~100MB records into memory (the reported laptop menu OOM).
// jsonAsset / getScenarioAssetStatus / getGameAssetStatus resolve at call time.
const projectScenarioMeta = (record) => ({
  id: record.id,
  meta: record.meta ?? {},
  cover: record.cover ?? null,
  assetStatus: getScenarioAssetStatus(record),
});
const projectGameMeta = (record) => {
  const game = jsonAsset(record, "game");
  const actions = jsonAsset(record, "actions");
  const events = jsonAsset(record, "events");
  return {
    id: record.id,
    meta: record.meta ?? {},
    cover: record.cover ?? null,
    assetStatus: getGameAssetStatus(record),
    country: String(game?.country ?? "").trim(),
    currentDate: String(game?.gameDate ?? "").trim(),
    round: Number.isFinite(Number(game?.round)) && Number(game.round) > 0 ? Math.trunc(Number(game.round)) : 1,
    eventCount: Array.isArray(events) ? events.length : 0,
    pendingActions: Array.isArray(actions)
      ? actions.filter((e) => String(e?.status ?? "").trim() !== "resolved").length : 0,
  };
};

// Record + its lean index row commit atomically, so the menu index is never stale.
const putScenario = (record) => idbPutPair(STORES.scenarios, record, STORES.scenarioMeta, projectScenarioMeta(record));
const putGame = (record) => idbPutPair(STORES.games, record, STORES.gameMeta, projectGameMeta(record));

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
      features: updates.features !== undefined ? normalizeFeatureSettings(updates.features) : current.features,
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
    features: updates.features !== undefined ? normalizeFeatureOverrides(updates.features) : current.features,
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
  if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) return record[key] !== undefined;
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

// Reconcile a lean *Meta index against its real store WITHOUT structured-cloning the
// records: getAllKeys is keys-only (cheap even for rows embedding 100MB binaries).
// Backfill any record missing from the index — an existing library on its first build
// after this ships, or a record written by sync (which bypasses putScenario/putGame) —
// by loading it ONE AT A TIME (peak = a single record, not the whole store at once,
// which is the OOM), and drop index rows whose record was deleted out-of-band. After
// the first build the index is populated, so the menu loads NO full records at all.
const reconcileMeta = async (recordStore, metaStore, project) => {
  const [keys, metas] = await Promise.all([idbGetAllKeys(recordStore), idbGetAll(metaStore)]);
  const byId = new Map(metas.map((m) => [m.id, m]));
  const live = new Set(keys);
  for (const id of keys) {
    if (byId.has(id)) continue;
    const record = await idbGet(recordStore, id); // released before the next iteration
    if (!record) continue;
    const proj = project(record);
    try { await idbPut(metaStore, proj); } catch { /* self-heals next build */ }
    byId.set(id, proj);
  }
  for (const m of metas) {
    if (live.has(m.id)) continue;
    try { await idbDelete(metaStore, m.id); } catch { /* self-heals next build */ }
    byId.delete(m.id);
  }
  return [...byId.values()];
};
const readScenarioMetas = () => reconcileMeta(STORES.scenarios, STORES.scenarioMeta, projectScenarioMeta);
const readGameMetas = () => reconcileMeta(STORES.games, STORES.gameMeta, projectGameMeta);

const getScenarioCatalog = async (scenarioMetas, gameMetas) => {
  const manifest = await getScenarioManifest();
  const metas = scenarioMetas ?? await readScenarioMetas();
  const byId = new Map(metas.map((r) => [r.id, r]));
  const usage = await getScenarioUsageCounts(gameMetas);
  const orderedIds = resolveOrderedIds(manifest.order, new Set(byId.keys()), DEFAULT_SCENARIO_ID);

  const scenarios = orderedIds.map((id) => {
    const proj = byId.get(id);
    if (!proj) return null;
    const meta = readScenarioMeta(id, proj.meta ?? {});
    const assetStatus = proj.assetStatus ?? {};
    const cacheToken = `${id}-${meta.updatedAt}`;
    return {
      ...meta,
      assetStatus,
      cacheToken,
      canDelete: true,
      coverImageUrl: assetStatus.cover ? coverDataUrl(proj.cover) : null,
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

const getScenarioUsageCounts = async (gameMetas) => {
  const counts = new Map();
  for (const proj of gameMetas ?? await readGameMetas()) {
    const scenarioId = readGameMeta(proj.id, proj.meta ?? {}).scenarioId;
    counts.set(scenarioId, (counts.get(scenarioId) ?? 0) + 1);
  }
  return counts;
};

const getGameCatalog = async (scenarioCatalog, gameMetas) => {
  const catalog = scenarioCatalog ?? await getScenarioCatalog();
  const scenarioLookup = new Map(catalog.scenarios.map((s) => [s.id, s]));
  const manifest = await getGameManifest();
  const metas = gameMetas ?? await readGameMetas();
  const byId = new Map(metas.map((r) => [r.id, r]));
  const orderedIds = resolveOrderedIds(manifest.order, new Set(byId.keys()), DEFAULT_GAME_ID);

  const games = orderedIds.map((id) => {
    const proj = byId.get(id);
    if (!proj) return null;
    const meta = readGameMeta(id, proj.meta ?? {});
    const assetStatus = proj.assetStatus ?? {};
    const scenario = scenarioLookup.get(meta.scenarioId) ?? readScenarioMeta(meta.scenarioId, {});
    const cacheToken = `${id}-${meta.updatedAt}`;
    const ownCoverImageUrl = assetStatus.cover ? coverDataUrl(proj.cover) : null;
    return {
      ...meta,
      assetStatus,
      cacheToken,
      canDelete: true,
      country: proj.country ?? "",
      coverImageUrl: ownCoverImageUrl ?? scenario?.coverImageUrl ?? null,
      currentDate: proj.currentDate ?? "",
      eventCount: proj.eventCount ?? 0,
      ownCoverImageUrl,
      pendingActions: proj.pendingActions ?? 0,
      round: proj.round ?? 1,
      scenarioAccentColor: scenario?.accentColor ?? meta.accentColor,
      // Server twin: the first client reader of `missing` is the Play button.
      scenarioMissing: Boolean(scenario?.missing),
      // And a missing map shows the name the sender knew, not a bare id.
      scenarioName: scenario?.missing
        ? meta.importedScenarioName || scenario?.name || meta.scenarioId
        : scenario?.name ?? meta.scenarioId,
    };
  }).filter(Boolean);

  const activeGameId = games.some((g) => g.id === manifest.activeGameId) ? manifest.activeGameId : (games[0]?.id ?? "");
  if (activeGameId !== manifest.activeGameId) await saveGameManifest({ activeGameId, order: orderedIds });
  return { activeGameId, games };
};

const getLibraryCatalog = async () => {
  // Build the menu from the LEAN meta indexes (reconciled cheaply via getAllKeys) so it
  // NEVER structured-clones the full ~100MB scenario/game records into memory — the
  // reported laptop menu OOM. Read each index once and thread it through both builders.
  const [scenarioMetas, gameMetas] = await Promise.all([readScenarioMetas(), readGameMetas()]);
  const scenarioCatalog = await getScenarioCatalog(scenarioMetas, gameMetas);
  const gameCatalog = await getGameCatalog(scenarioCatalog, gameMetas);
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

// A game names a scenario that may be gone — a synced game whose scenario record
// never arrived, or a scenario deleted after the games made from it. The same
// degradation as the server store's getGameScenarioSummary: the catalog entry
// when there is one, else the metadata read defensively in the same shape,
// marked `missing` so a caller can tell. getScenarioSummary above keeps throwing
// for the scenario routes, where asking for a missing scenario is a genuine miss.
const getGameScenarioSummary = async (scenarioId) => {
  const catalog = await getScenarioCatalog();
  const scenario = catalog.scenarios.find((s) => s.id === scenarioId);
  if (scenario) return scenario;
  const meta = readScenarioMeta(scenarioId, {});
  return {
    ...meta,
    assetStatus: {},
    cacheToken: `${scenarioId}-missing`,
    canDelete: false,
    coverImageUrl: null,
    gameCount: 0,
    missing: true,
    // Named by its id, not the "Modern Day" the defaults fill in (the editor
    // header and new-game names read scenario.name).
    name: scenarioId,
    heroTitle: scenarioId,
    subtitle: "No longer in the library",
    heroSubtitle: "No longer in the library",
    description: "This game's scenario is no longer in the library.",
  };
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
  // Mirrors the server store: a game whose scenario is gone still opens in the
  // editor (getGameScenarioSummary) instead of a 404 that the Edit button
  // swallows into nothing.
  const scenario = await getGameScenarioSummary(meta.scenarioId);
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

// The built-in scenario's own map — Modern Day was redrawn — ships as a static
// asset of the web build (scripts/seed-web-defaults.mjs); fetched once per
// session. A scenario carries this map when its world bears the seed's
// `builtInMap` stamp: the built-in itself, a clone of it, a scenario created
// from scratch (all copy world.json). Everything else without a map of its own
// renders on the STOCK world from the content origin below, as before.
const usesBuiltInMap = (record) =>
  Boolean(BUILT_IN_MAP && BUILT_IN_REGIONS_URL) && record?.json?.world?.builtInMap === BUILT_IN_MAP;
let builtInRegionsPromise = null;
const fetchBuiltInRegionsBytes = () => {
  if (!builtInRegionsPromise) {
    builtInRegionsPromise = fetch(BUILT_IN_REGIONS_URL, { cache: "force-cache" })
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null)
      .then((bytes) => {
        if (!bytes || bytes.byteLength === 0) { builtInRegionsPromise = null; return null; }
        return bytes;
      });
  }
  return builtInRegionsPromise;
};
let builtInRegionsTextPromise = null;
const fetchBuiltInRegionsText = () => {
  if (!builtInRegionsTextPromise) {
    builtInRegionsTextPromise = fetchBuiltInRegionsBytes().then((bytes) => (bytes ? new TextDecoder().decode(bytes) : null));
  }
  return builtInRegionsTextPromise;
};
const fetchBuiltInRegionsGeojson = async () => {
  const text = await fetchBuiltInRegionsText();
  return text ? parseJsonValue(text, null) : null;
};
let builtInCoarseTextPromise = null;
const builtInCoarseRegionsText = () => {
  if (!builtInCoarseTextPromise) {
    builtInCoarseTextPromise = fetchBuiltInRegionsGeojson().then((data) => (data ? serializeJsonValue(coarsenFeatureCollection(data)) : null));
  }
  return builtInCoarseTextPromise;
};

// The STOCK world (the GADM regions the hub's re-ownership presets key their
// ownership by) is too big to bundle, so fetch it once from the content origin
// (the Worker proxy → GitHub Release) and cache it for the session. It is what
// a scenario without a map of its own — and without the built-in stamp — renders on.
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


const inferRecordCustomGeometry = (record) => {
  const value = record?.geojson?.regionsGeojson;
  if (typeof value === "string") {
    return /"edited"\s*:\s*true|"id"\s*:\s*"reg_/i.test(value);
  }
  return Array.isArray(value?.features) && value.features.some((feature) => {
    const props = feature?.properties ?? {};
    return props.edited === true || String(props.id ?? feature?.id ?? "").startsWith("reg_");
  });
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
    if (value === undefined && assetKey === "regionsGeojson" && scenario && usesBuiltInMap(scenario)) {
      value = await fetchBuiltInRegionsGeojson();
    }
    if (value === undefined && assetKey === "regionsGeojson" && scenario && scenario.id !== DEFAULT_SCENARIO_ID) {
      // Borrowing the stock world's record. Migrate it as DEFAULT'S record, never this
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
    //
    // NOT gated on being the default scenario. A CLONE of Modern Day has its own
    // id and no geometry of its own, so it fell through the borrow branch above
    // into default's record — which, in the web build, is exactly the record that
    // does not carry the file. The clone then rendered an empty FeatureCollection
    // and showed no political map at all, while the scenario it was copied from
    // looked fine. This is the last resort for ANY scenario that has ended up
    // without region geometry, which is precisely the case the borrow was for.
    if ((value === undefined || value === null) && assetKey === "regionsGeojson" && scenario) {
      value = await fetchDefaultRegionsGeojson();
    }
    // geojson may be a raw uploaded string; parse-with-fallback like readJsonFile.
    return parseJsonValue(value, cloneJson(EMPTY_FEATURE_COLLECTION));
  }

  const activeGame = await getActiveGameRecord();

  // Scenario-authored Stats sheet definitions are canonical while the linked
  // scenario exists. Games own the generated VALUES (world.countryStats and
  // customStats), not the schema that says which rows the scenario tracks.
  // Keep a game-level stats snapshot only as a fallback for imported/orphaned
  // campaigns whose source scenario is genuinely unavailable.
  if (assetKey === "stats" && activeGame) {
    const scenarioId = readGameMeta(activeGame.id, activeGame.meta ?? {}).scenarioId;
    const exactScenario = scenarioId ? await getScenario(scenarioId) : null;
    if (exactScenario) {
      const scenarioValue = runtimeValueFromRecord(exactScenario, assetKey, /*scenarioScope*/ true);
      return scenarioValue === undefined ? {} : coerceRuntimeValue(assetKey, scenarioValue);
    }
  }

  const gameValue = activeGame ? runtimeValueFromRecord(activeGame, assetKey) : undefined;
  if (gameValue !== undefined) {
    const value = coerceRuntimeValue(assetKey, gameValue);
    let scenarioCustomGeometry;
    if (assetKey === "world" && value?.customGeometry == null) {
      const scenario = await getActiveRuntimeScenarioRecord();
      scenarioCustomGeometry = scenario?.json?.world?.customGeometry ?? inferRecordCustomGeometry(scenario);
    }
    return normalizeRuntimeWorld(assetKey, value, scenarioCustomGeometry);
  }

  const scenario = await getActiveRuntimeScenarioRecord();
  const scenarioValue = scenario ? runtimeValueFromRecord(scenario, assetKey, /*scenarioScope*/ true) : undefined;
  if (scenarioValue !== undefined) {
    const value = coerceRuntimeValue(assetKey, scenarioValue);
    const scenarioCustomGeometry = assetKey === "world" && value?.customGeometry == null
      ? inferRecordCustomGeometry(scenario)
      : undefined;
    return normalizeRuntimeWorld(assetKey, value, scenarioCustomGeometry);
  }

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
  if (OPTIONAL_JSON_ASSET_KEYS.includes(assetKey)) return record[assetKey];
  if (assetKey === "snapshots") return scenarioScope ? undefined : record.snapshots; // snapshots are game-only
  // Derived, read-only: the same projection the desktop server keeps on disk.
  if (assetKey === "snapshotsIndex") {
    if (scenarioScope) return undefined;
    const list = Array.isArray(record.snapshots) ? record.snapshots : [];
    return {
      entries: list.map((snap) => ({
        id: snap?.id ?? "",
        round: snap?.round ?? null,
        fromDate: snap?.fromDate ?? "",
        toDate: snap?.toDate ?? "",
        capturedAt: snap?.capturedAt ?? "",
      })),
    };
  }
  if (assetKey === "intercepts") return scenarioScope ? undefined : record.json?.intercepts; // spy reports: game-only, plain json slot
  if (JSON_ASSET_KEYS.includes(assetKey)) return record.json?.[assetKey];
  return undefined;
};

// colors may be stored as raw uploaded text; parse it on read (the 7 core json
// assets and snapshots are always structured, so they pass through).
const coerceRuntimeValue = (assetKey, value) =>
  (OPTIONAL_JSON_ASSET_KEYS.includes(assetKey) ? parseJsonValue(value, {}) : value);

const TURN_COMMIT_ASSET_KEYS = ["actions", "chat", "events", "game", "colors", "world"];

const validateTurnCommitShape = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Turn commit must be an object.");
  }
  for (const key of TURN_COMMIT_ASSET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`Turn commit is missing ${key}.`);
    }
    const expectsArray = ["actions", "chat", "events"].includes(key);
    const value = payload[key];
    const ok = expectsArray
      ? Array.isArray(value)
      : Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (!ok) throw new Error(`Turn commit ${key} must be ${expectsArray ? "an array" : "an object"}.`);
  }
};

// Web mode already stores every runtime domain inside ONE IndexedDB game record.
// Publishing a turn therefore becomes one record transaction instead of six
// independent read-modify-writes. putGame writes the game and its lean catalog
// row in one IndexedDB transaction, so readers see old or new, never a mixture.
const writeRuntimeTurnState = (payload) => serializeWrite(async () => {
  validateTurnCommitShape(payload);
  let activeGame = await getActiveGameRecord();
  if (!activeGame) {
    const scenario = await getSelectedScenarioRecord();
    if (!scenario) throw new Error("No active game — start a game from a scenario first.");
    const details = await createGame({
      name: `${readScenarioMeta(scenario.id, scenario.meta).name} Session`,
      scenarioId: scenario.id,
      setActive: true,
    });
    activeGame = await getGame(details.game.id);
  }

  const expectedGameId = String(payload?.expectedGameId ?? "").trim();
  if (expectedGameId && expectedGameId !== activeGame.id) {
    throw new Error(`Turn commit belongs to game "${expectedGameId}", but "${activeGame.id}" is active.`);
  }

  const world = canonicalizeWorldCountryRefs(payload.world);
  const assets = {
    actions: payload.actions,
    chat: payload.chat,
    events: payload.events,
    game: canonicalizeGameCountry(payload.game, world),
    colors: canonicalizeColorKeys(payload.colors, world),
    world,
  };

  activeGame = {
    ...activeGame,
    colors: assets.colors,
    json: {
      ...activeGame.json,
      actions: assets.actions,
      chat: assets.chat,
      events: assets.events,
      game: assets.game,
      world: assets.world,
    },
  };
  writeGameMeta(activeGame, {});
  await putGame(activeGame);
  return { transactionId: `web-turn-${Date.now()}`, assets };
});

// Serialized: this is a read-modify-write of the WHOLE game record (every runtime
// JSON asset lives in one), and the end of a turn fires six of these at once. Run
// concurrently they each read the record before any has written, and the last to
// finish restores its stale copy of the other five — which is how the new game
// date got reverted on the website but never in the app. See writeQueue.js.
const writeRuntimeJsonAsset = (assetKey, value) =>
  serializeWrite(() => writeRuntimeJsonAssetLocked(assetKey, value));

const writeRuntimeJsonAssetLocked = async (assetKey, value) => {
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

  if (OPTIONAL_JSON_ASSET_KEYS.includes(assetKey)) activeGame[assetKey] = canonical;
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
  const base = baseRecord;
  targetRecord.json = {
    actions: cloneJson(base.json.actions), advisor: cloneJson(base.json.advisor),
    chat: cloneJson(base.json.chat), events: cloneJson(base.json.events),
    game: buildFreshGameSeedFromScenario({ baseGame: base.json.game, scenarioGame: source.json?.game }),
    prompts: cloneJson(source.json?.prompts && typeof source.json.prompts === "object" ? source.json.prompts : base.json.prompts),
    world: buildFreshWorldSeedFromScenario({ baseWorld: base.json.world, scenarioWorld: source.json?.world }),
  };
  copyScenarioOptionalAssets(targetRecord, source);
};

const copyOptionalJsonAssets = (target, source) => {
  for (const key of OPTIONAL_JSON_ASSET_KEYS) {
    target[key] = source?.[key] !== undefined ? cloneJson(source[key]) : undefined;
  }
};

const copyScenarioOptionalAssets = (target, source) => {
  copyOptionalJsonAssets(target, source);
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
  const base = baseRecord;
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
  const baseRecord = (await getScenario(DEFAULT_SCENARIO_ID)) ?? await defaultScenarioSeedRecord();
  if (sourceRecord) {
    // Seed from another scenario: json + optional assets (+ snapshot handling).
    seedScenarioJsonFromScenario(record, sourceRecord, baseRecord);
  } else {
    // No seed: the 7 json assets from the built-in scenario, plus its map — a
    // scenario made from scratch starts as the built-in world (colours, flags,
    // cities; the regions follow the world's builtInMap stamp, see usesBuiltInMap).
    // Not the cover.
    record.json = {};
    for (const key of JSON_ASSET_KEYS) record.json[key] = cloneJson(baseRecord.json?.[key] ?? JSON_ASSET_DEFAULTS[key]);
    copyOptionalJsonAssets(record, baseRecord);
    record.geojson = { ...(baseRecord.geojson ?? {}) };
  }

  // Meta cascade + seed inheritance, byte-faithful to server createScenario (:1260).
  const createdAt = nowIso();
  record.meta = {
    accentColor: trimmed(body.accentColor) || DEFAULT_SCENARIO_META.accentColor,
    coverImageContentType: sourceSummary?.coverImageContentType ?? null,
    features: normalizeFeatureSettings(body.features ?? sourceSummary?.features),
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
  try { await idbDelete(STORES.scenarioMeta, id); } catch { /* reconcile drops it next build */ }
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
  const baseRecord = (await getScenario(DEFAULT_SCENARIO_ID)) ?? await defaultScenarioSeedRecord();
  let sourceScenarioSummary = null;
  let sourceGameSummary = null;

  if (body.seedGameId && (await getGame(body.seedGameId))) {
    sourceGameSummary = await getGameSummary(body.seedGameId);
    const source = await getGame(body.seedGameId);
    record.json = {};
    for (const key of JSON_ASSET_KEYS) record.json[key] = cloneJson(source.json?.[key] ?? JSON_ASSET_DEFAULTS[key]);
    copyOptionalJsonAssets(record, source);
    record.cover = source.cover ? { contentType: source.cover.contentType, bytes: source.cover.bytes.slice() } : undefined;
  } else {
    const nextScenarioId = trimmed(body.scenarioId) || DEFAULT_SCENARIO_ID;
    // Server calls getScenarioSummary here, which THROWS on an unknown id → 400.
    sourceScenarioSummary = await getScenarioSummary(nextScenarioId);
    const sourceScenario = await getScenario(nextScenarioId);
    seedGameJsonFromScenario(record, sourceScenario, baseRecord);
    copyOptionalJsonAssets(record, sourceScenario);
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
    features: normalizeFeatureOverrides(body.features ?? sourceGameSummary?.features),
    subtitle: trimmed(body.subtitle) || sourceGameSummary?.subtitle || scenarioSummary.subtitle || DEFAULT_GAME_META.subtitle,
    updatedAt: createdAt,
  };
  await putGame(record);
  const manifest = await getGameManifest();
  const order = resolveOrderedIds(manifest.order, await listGameIds(), DEFAULT_GAME_ID).filter((e) => e !== id);
  order.unshift(id);
  await saveGameManifest({ activeGameId: body.setActive ? id : manifest.activeGameId, order });
  if (body.setActive) await recordGamePlayed(id);
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

// Play stamps for the main menu's "Last Played"/"Most Played" rows — patches
// record.meta directly (NOT writeGameMeta/writeScenarioMeta, which stamp
// updatedAt and drop hubOrigin; server twin has the same rule).
const recordGamePlayed = async (gameId) => {
  try {
    const record = await getGame(gameId);
    if (!record) return;
    record.meta = {
      ...(record.meta ?? {}),
      lastPlayedAt: nowIso(),
      playCount: normalizePlayCount(record.meta?.playCount) + 1,
    };
    await putGame(record);

    const scenarioId = String(record.meta?.scenarioId ?? "").trim();
    const scenario = scenarioId ? await getScenario(scenarioId) : null;
    if (scenario) {
      scenario.meta = {
        ...(scenario.meta ?? {}),
        playCount: normalizePlayCount(scenario.meta?.playCount) + 1,
      };
      await putScenario(scenario);
    }
  } catch {
    // Stamping is best-effort — never block activating a game over it.
  }
};

const setActiveGame = async (gameId) => {
  const id = String(gameId ?? "").trim();
  if (!id || !(await getGame(id))) throw new Error(`Game not found: ${id}`);
  const manifest = await getGameManifest();
  await saveGameManifest({ activeGameId: id, order: [id, ...manifest.order.filter((e) => e !== id)] });
  await recordGamePlayed(id);
  return getLibraryCatalog();
};

const deleteGame = async (id) => {
  await idbDelete(STORES.games, id);
  try { await idbDelete(STORES.gameMeta, id); } catch { /* reconcile drops it next build */ }
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
  } else if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) {
    // Optional JSON assets are scenario-owned author data. Store the uploaded
    // text byte-faithfully, matching desktop; runtime reads parse it lazily.
    record[key] = new TextDecoder().decode(bytes);
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
  else if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) { delete record[key]; writeScenarioMeta(record, {}); }
  else if (PMTILES_ASSET_KEYS.includes(key)) { if (record.pmtiles) delete record.pmtiles[key]; writeScenarioMeta(record, {}); }
  else if (SCENARIO_GEOJSON_ASSET_KEYS.includes(key)) { if (record.geojson) delete record.geojson[key]; writeScenarioMeta(record, {}); }
  await putScenario(record);
  return getScenarioDetails(id);
};

// The coarse regions copy the desktop server keeps beside the upload, here
// computed on demand and cached against the stored value, so a re-upload
// (a new value) rebuilds it and the same value never does twice.
const coarseRegionsCache = new Map(); // scenario id -> { source, text }
const coarseRegionsText = (record) => {
  const source = record.geojson?.regionsGeojson;
  const cached = coarseRegionsCache.get(record.id);
  if (cached && cached.source === source) return cached.text;
  const text = serializeJsonValue(coarsenFeatureCollection(parseJsonValue(source, null)));
  coarseRegionsCache.set(record.id, { source, text });
  return text;
};

const scenarioAssetResponse = async (record, key, rangeHeader, { coarse = false } = {}) => {
  if (key === COVER_IMAGE_ASSET_KEY) {
    if (!record.cover) throw new Error("Asset not found");
    return binaryResponse(record.cover.bytes, record.cover.contentType || "application/octet-stream", rangeHeader);
  }
  if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) {
    if (record[key] === undefined) throw new Error("Asset not found");
    // Serve raw uploaded JSON text byte-faithfully when present; structured
    // values (imports/seeds) are serialized normally.
    const stored = record[key];
    const text = typeof stored === "string" ? stored : serializeJsonValue(stored);
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (PMTILES_ASSET_KEYS.includes(key)) {
    if (record.pmtiles?.[key] === undefined) throw new Error("Asset not found");
    return binaryResponse(record.pmtiles[key], "application/octet-stream", rangeHeader);
  }
  if (SCENARIO_GEOJSON_ASSET_KEYS.includes(key)) {
    const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (record.geojson?.[key] === undefined && key === "regionsGeojson" && usesBuiltInMap(record)) {
      // The built-in map is not stored in the record (it is a bundled asset), but
      // the Workshop and the country picker open a scenario's map through this
      // route, and this scenario's map is that one.
      const text = coarse ? await builtInCoarseRegionsText() : await fetchBuiltInRegionsText();
      if (!text) throw new Error("Asset not found");
      return new Response(text, { status: 200, headers: jsonHeaders });
    }
    if (record.geojson?.[key] === undefined) throw new Error("Asset not found");
    const text = coarse && key === "regionsGeojson" ? coarseRegionsText(record) : serializeJsonValue(record.geojson[key]);
    return new Response(text, { status: 200, headers: jsonHeaders });
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
// Every export is full: custom tile archives travel with the scenario like
// the geometry does. There is no light mode any more.
const exportScenarioBundle = async (id) => {
  const record = await getScenario(id);
  if (!record) throw new Error(`Scenario not found: ${id}`);
  const meta = readScenarioMeta(id, record.meta ?? {});
  const data = {};
  for (const key of JSON_ASSET_KEYS) data[key] = cloneJson(jsonAsset(record, key));

  const assets = {};
  assets.cover = record.cover
    ? { contentType: record.cover.contentType, data: bytesToBase64(record.cover.bytes), encoding: "base64", fileName: "cover-image.bin", mode: "embedded" }
    : { fileName: "cover-image.bin", mode: "default" };
  const optionalJsonFileNames = { colors: "colors.json", flags: "flags.json", tags: "tags.json", stats: "stats.json" };
  for (const key of OPTIONAL_JSON_ASSET_KEYS) {
    const fileName = optionalJsonFileNames[key] || `${key}.json`;
    assets[key] = record[key] !== undefined
      ? { data: parseJsonValue(record[key], {}), fileName, mode: "embedded" }
      : { fileName, mode: "default" };
  }
  // JSON assets travel as JSON, not base64: the geometry is most of a shared
  // map's weight, and base64 added a third to it for nothing. The desktop
  // exporter writes the same shape (server/libraryStore.js encodeJsonFile).
  for (const [key, fileName] of [["regionsGeojson", "regions.geojson"], ["citiesGeojson", "cities.geojson"], ["backgroundData", "background.json"]]) {
    assets[key] = record.geojson?.[key] !== undefined
      ? { contentType: "application/json", data: parseJsonValue(record.geojson[key], null), fileName, mode: "embedded" }
      : { fileName, mode: "default" };
  }
  for (const [key, fileName] of [["cities", "cities.pmtiles"], ["countries", "countries.pmtiles"], ["regions", "regions.pmtiles"]]) {
    assets[key] = record.pmtiles?.[key] !== undefined
      ? { contentType: "application/octet-stream", data: bytesToBase64(record.pmtiles[key]), encoding: "base64", fileName, mode: "embedded" }
      : { fileName, mode: "default" };
  }
  return {
    schema: SCENARIO_BUNDLE_SCHEMA, version: SCENARIO_BUNDLE_VERSION, mode: "full", exportedAt: nowIso(),
    scenario: { accentColor: meta.accentColor, countryNameOverrides: meta.countryNameOverrides, features: meta.features, description: meta.description,
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
    } else if (embedded && descriptor.data !== undefined && descriptor.data !== null) {
      // A JSON asset that travelled as JSON — the shape exports write now. Without
      // this branch a current bundle would import with no geometry at all.
      await uploadScenarioAsset(newId, key, new TextEncoder().encode(serializeJsonValue(descriptor.data)), descriptor.contentType || "application/json");
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
  if (scenario.features && typeof scenario.features === "object") {
    metaPatch.features = normalizeFeatureSettings(scenario.features);
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

// Whether the active scenario serves its own archive under
// /api/runtime/pmtiles/<key> — bytes the signed content manifest cannot vouch
// for, so contentTrust.js neither fetches them from the swarm nor holds them
// to the manifest.
export const hasScenarioPmtilesOverride = async (key) => {
  if (!PMTILES_ASSET_KEYS.includes(key)) return false;
  const scenario = await getActiveRuntimeScenarioRecord();
  return scenario?.pmtiles?.[key] !== undefined;
};

// --- Seeding --------------------------------------------------------------
// The 871 KB default-scenario seed is only needed on a first-ever boot (ensureSeeded)
// or when creating from a missing default. Load it on demand so returning users never
// pay for it in the eager web bundle; the promise memoizes the one-time cost.
let _defaultSeedPromise = null;
const loadDefaultSeed = () => (_defaultSeedPromise ??= import("./generated/defaultScenario.js").then((m) => m.default));
const defaultScenarioSeedRecord = async () => {
  const DEFAULT_SEED = await loadDefaultSeed();
  const record = emptyScenarioRecord(DEFAULT_SCENARIO_ID);
  record.meta = { ...DEFAULT_SCENARIO_META, ...(DEFAULT_SEED.meta ?? {}), countryNameOverrides: {}, createdAt: nowIso(), updatedAt: nowIso() };
  record.json = {
    actions: cloneJson(DEFAULT_SEED.data?.actions ?? []), advisor: cloneJson(DEFAULT_SEED.data?.advisor ?? []),
    chat: cloneJson(DEFAULT_SEED.data?.chat ?? []), events: cloneJson(DEFAULT_SEED.data?.events ?? []),
    game: cloneJson(DEFAULT_SEED.data?.game ?? {}), prompts: cloneJson(DEFAULT_SEED.data?.prompts ?? {}),
    world: cloneJson(DEFAULT_SEED.data?.world ?? {}),
  };
  record.colors = DEFAULT_SEED.colors !== undefined ? cloneJson(DEFAULT_SEED.colors) : undefined;
  // The scenario's authored cities; its regions are the bundled asset (usesBuiltInMap).
  record.geojson = DEFAULT_SEED.geojson?.citiesGeojson ? { citiesGeojson: cloneJson(DEFAULT_SEED.geojson.citiesGeojson) } : {};
  record.cover = DEFAULT_SEED.cover ? { contentType: DEFAULT_SEED.cover.contentType, bytes: base64ToBytes(DEFAULT_SEED.cover.base64) } : undefined;
  return record;
};

// The stored built-in scenario predates the map the seed carries (Modern Day
// was redrawn). Mirrors the server's syncBuiltInScenarioFromSeed: the campaigns
// started on the old map — and a copy the player edited — keep it in a fork,
// then the built-in becomes the seed. The old record never held the stock
// geometry (it came from the content origin), and the fork keeps not holding it,
// so it goes on rendering the stock world exactly as before.
// Which edition of the built-in's content a world carries on its map; 1 when
// unstamped. Mirrors the server's builtInRevisionOf.
const builtInRevisionOf = (world) => {
  const value = Number(world?.builtInRevision);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

// The seed carries newer content on the same map (its countries renamed, say).
// Mirrors the server's refreshBuiltInContent: every campaign keeps its own world,
// colours, flags and tags and reads only the geometry from the built-in, which a
// revision never changes, so the built-in is brought up to date and its campaigns
// stay on it — each given copies of the colours, flags, tags or stats sheet it
// was still reading from the scenario. A copy the player edited is kept, with the
// campaigns started on it; its world keeps the map's stamp, so it keeps the map.
const refreshBuiltInContent = async (current) => {
  const games = (await idbGetAll(STORES.games)).filter(
    (game) => readGameMeta(game.id, game.meta ?? {}).scenarioId === DEFAULT_SCENARIO_ID,
  );
  if (current.meta?.updatedAt !== current.meta?.createdAt) {
    const forkId = await ensureUniqueId("modern-day-edited", "scenario");
    const name = current.meta?.name || DEFAULT_SCENARIO_META.name;
    const now = nowIso();
    const blurb = `Your edited copy of ${name}, kept with the campaigns started on it when the built-in scenario was updated.`;
    await putScenario({
      ...current,
      id: forkId,
      meta: {
        ...current.meta,
        id: forkId,
        name: `${name} (your edited copy)`,
        heroTitle: `${current.meta?.heroTitle || name} (your edited copy)`,
        subtitle: "Your edits to the built-in scenario",
        description: blurb,
        heroSubtitle: blurb,
        hubOrigin: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    for (const game of games) {
      writeGameMeta(game, { scenarioId: forkId });
      await putGame(game);
    }
    const manifest = await getScenarioManifest();
    const order = manifest.order.filter((entry) => entry !== forkId);
    const at = order.indexOf(DEFAULT_SCENARIO_ID);
    order.splice(at >= 0 ? at + 1 : order.length, 0, forkId);
    await saveScenarioManifest({ order, selectedScenarioId: manifest.selectedScenarioId });
    console.info(`[built-in scenario] kept the player's edited Modern Day as "${forkId}" for ${games.length} campaign(s)`);
  } else {
    for (const game of games) {
      const missing = OPTIONAL_JSON_ASSET_KEYS.filter((key) => game[key] === undefined && current[key] !== undefined);
      if (!missing.length) continue;
      for (const key of missing) game[key] = cloneJson(current[key]);
      await putGame(game);
    }
  }
  await putScenario(await defaultScenarioSeedRecord());
  console.info(`[built-in scenario] Modern Day content updated to revision ${BUILT_IN_REVISION} (${BUILT_IN_MAP})`);
};

const syncBuiltInScenarioFromSeed = async () => {
  if (!BUILT_IN_MAP) return;
  const current = await getScenario(DEFAULT_SCENARIO_ID);
  if (!current) return; // deleted on purpose: stays deleted
  if (current.json?.world?.builtInMap === BUILT_IN_MAP) {
    if (builtInRevisionOf(current.json?.world) < (BUILT_IN_REVISION ?? 1)) await refreshBuiltInContent(current);
    return;
  }

  const games = (await idbGetAll(STORES.games)).filter(
    (game) => readGameMeta(game.id, game.meta ?? {}).scenarioId === DEFAULT_SCENARIO_ID,
  );
  const touched = current.meta?.updatedAt !== current.meta?.createdAt;
  if (games.length || touched) {
    const forkId = await ensureUniqueId("modern-day-classic", "scenario");
    const name = current.meta?.name || DEFAULT_SCENARIO_META.name;
    const now = nowIso();
    const blurb = `The world map ${name} used before it was redrawn. Kept for the campaigns that were started on it.`;
    const fork = {
      ...current,
      id: forkId,
      meta: {
        ...current.meta,
        id: forkId,
        name: `${name} (classic map)`,
        heroTitle: `${current.meta?.heroTitle || name} (classic map)`,
        subtitle: "The map before the built-in scenario was redrawn",
        description: blurb,
        heroSubtitle: blurb,
        hubOrigin: null,
        createdAt: now,
        updatedAt: now,
      },
    };
    await putScenario(fork);
    for (const game of games) {
      writeGameMeta(game, { scenarioId: forkId });
      await putGame(game);
    }
    const manifest = await getScenarioManifest();
    const order = manifest.order.filter((entry) => entry !== forkId);
    const at = order.indexOf(DEFAULT_SCENARIO_ID);
    order.splice(at >= 0 ? at + 1 : order.length, 0, forkId);
    await saveScenarioManifest({ order, selectedScenarioId: manifest.selectedScenarioId });
    console.info(`[built-in scenario] kept the previous Modern Day as "${forkId}" for ${games.length} campaign(s)${touched ? " and the player's edits" : ""}`);
  }
  const fresh = await defaultScenarioSeedRecord();
  await putScenario(fresh);
  console.info(`[built-in scenario] Modern Day updated to ${BUILT_IN_MAP}`);
};

export const ensureSeeded = async () => {
  if (!(await kvGet("seeded", false))) {
    if (!(await getScenario(DEFAULT_SCENARIO_ID))) {
      await putScenario(await defaultScenarioSeedRecord());
      const manifest = await getScenarioManifest();
      if (!manifest.order.includes(DEFAULT_SCENARIO_ID)) manifest.order.unshift(DEFAULT_SCENARIO_ID);
      await saveScenarioManifest({ order: manifest.order, selectedScenarioId: manifest.selectedScenarioId || DEFAULT_SCENARIO_ID });
    }
    await kvPut("seeded", true);
  }
  await syncBuiltInScenarioFromSeed();
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
    if (sub === "export" && method === "GET") return jsonResponse(await exportScenarioBundle(id));
    if (sub === "assets" && segments[2]) {
      const key = decodeURIComponent(segments[2]);
      if (method === "GET") { const record = await getScenario(id); if (!record) throw new Error(`Scenario not found: ${id}`); return scenarioAssetResponse(record, key, rangeHeader, { coarse: query?.get("coarse") === "1" }); }
      if (method === "PUT") return jsonResponse(await uploadScenarioAsset(id, key, rawBody, contentType));
      if (method === "DELETE") return jsonResponse(await removeScenarioAsset(id, key));
    }
    return null;
  } catch (error) {
    // Reads (GET details/asset) → 404; every mutation → 400 (mirrors server.js).
    return errorResponse(error.message, method === "GET" ? 404 : 400);
  }
};

// --- Game bundles ----------------------------------------------------------
// The twin of exportGameBundle/importGameBundle in server/libraryStore.js. Same
// schema, same field names, same rules, so a Game exported from the web build
// imports into the desktop one and back. Restore points stay OUT of the bundle
// here too: they get their own endpoint so the caller can move them without
// parsing them.
// Server twin of scenarioBundleBytes: what this scenario would weigh once
// bundled, so the caller can decide whether it can carry it before building it.
const scenarioBundleBytes = async (scenarioId) => {
  const record = await getScenario(scenarioId);
  if (!record) return 0;
  let total = 0;
  try { total += JSON.stringify(record.json ?? {}).length; } catch { /* unserialisable */ }
  for (const asset of Object.values(record.assets ?? {})) {
    const bytes = asset?.bytes;
    if (bytes && typeof bytes.byteLength === "number") total += Math.round(bytes.byteLength * 1.34);
  }
  if (record.cover?.bytes?.byteLength) total += Math.round(record.cover.bytes.byteLength * 1.34);
  return total;
};

const exportGameBundle = async (id) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);

  const game = await getGameSummary(id);
  const meta = readGameMeta(id, record.meta ?? {});
  const scenario = await getGameScenarioSummary(meta.scenarioId);
  const data = {};

  for (const key of GAME_BUNDLE_DATA_KEYS) data[key] = jsonAsset(record, key);

  // Same ownership rule as the desktop store: while the linked scenario exists,
  // its Stats definition is canonical. The game copy is only an orphan/import
  // fallback and must not freeze an older Scenario Editor definition into an
  // export.
  const scenarioRecord = await getScenario(meta.scenarioId);
  if (scenarioRecord) {
    if (scenarioRecord.stats !== undefined) data.stats = parseJsonValue(scenarioRecord.stats, {});
    else delete data.stats;
  }

  return {
    data,
    exportedAt: nowIso(),
    game: {
      accentColor: game.accentColor,
      features: game.features,
      // Server twin: the sender's dates travel with the record.
      createdAt: meta.createdAt,
      description: game.description,
      eyebrow: game.eyebrow,
      heroSubtitle: game.heroSubtitle,
      heroTitle: game.heroTitle,
      name: game.name,
      subtitle: game.subtitle,
      updatedAt: meta.updatedAt,
    },
    schema: GAME_BUNDLE_SCHEMA,
    scenarioRef: {
      builtIn: BUILT_IN_SCENARIO_IDS.has(meta.scenarioId),
      hubOrigin: scenario?.hubOrigin ?? null,
      // Server twin: nothing to embed when this store lacks the map either.
      missing: Boolean(scenario?.missing),
      scenarioId: meta.scenarioId,
      // Server twin. This store holds the scenario as an object rather than files,
      // so measure what a bundle of it would serialise to.
      scenarioBytes:
        scenario?.missing || BUILT_IN_SCENARIO_IDS.has(meta.scenarioId) || scenario?.hubOrigin
          ? 0
          : await scenarioBundleBytes(meta.scenarioId),
      // Server twin: a map's name must not decay to an id when a game carrying no
      // map is handed on again.
      scenarioName: scenario?.missing
        ? meta.importedScenarioName || meta.scenarioId
        : scenario?.name || meta.scenarioId,
    },
  };
};

// Keep the sender's name; disambiguate only on an exact match. Server twin:
// uniqueGameName in server/libraryStore.js.
const uniqueGameName = async (requested) => {
  const name = trimmed(requested) || "Imported Game";
  const catalog = await getGameCatalog();
  const taken = new Set(catalog.games.map((entry) => entry.name));

  if (!taken.has(name)) return name;

  let candidate = `${name} (Imported)`;
  let attempt = 2;
  while (taken.has(candidate)) {
    candidate = `${name} (Imported ${attempt})`;
    attempt += 1;
  }
  return candidate;
};

// Not createGame: that seeds from a scenario and throws on an unknown id, and an
// imported game brings its own data and may name a scenario this browser has
// never held. Never activates, for the same reason the server twin does not.
const importGameBundle = async (bundle) => {
  if (!bundle || typeof bundle !== "object") throw new Error("Game bundle must be a JSON object.");
  if (!ACCEPTED_GAME_BUNDLE_SCHEMAS.has(bundle.schema)) throw new Error("Unsupported game bundle schema.");

  const metaIn = bundle.game && typeof bundle.game === "object" ? bundle.game : {};
  const data = bundle.data && typeof bundle.data === "object" ? bundle.data : {};
  const ref = bundle.scenarioRef && typeof bundle.scenarioRef === "object" ? bundle.scenarioRef : {};
  const scenarioId = trimmed(ref.scenarioId) || DEFAULT_SCENARIO_ID;

  const id = await ensureUniqueId(metaIn.name || scenarioId || "game", "game");
  const record = emptyGameRecord(id);
  record.json = {};
  for (const key of GAME_BUNDLE_DATA_KEYS) {
    const value = data[key];
    if (value === undefined && OPTIONAL_GAME_BUNDLE_KEYS.has(key)) continue;
    const canonical = cloneJson(value ?? JSON_ASSET_DEFAULTS[key] ?? {});
    if (OPTIONAL_JSON_ASSET_KEYS.includes(key)) record[key] = canonical;
    else record.json[key] = canonical;
  }

  const arrivedAt = nowIso();
  // Server twin: the sender's dates travel, so an imported campaign does not
  // report itself as having begun the moment it arrived. importedAt is arrival.
  const createdAt = trimmed(metaIn.createdAt) || arrivedAt;
  record.meta = {
    accentColor: trimmed(metaIn.accentColor) || DEFAULT_GAME_META.accentColor,
    features: normalizeFeatureOverrides(metaIn.features),
    createdAt,
    description: trimmed(metaIn.description) || DEFAULT_GAME_META.description,
    eyebrow: trimmed(metaIn.eyebrow) || DEFAULT_GAME_META.eyebrow,
    heroSubtitle: trimmed(metaIn.heroSubtitle) || DEFAULT_GAME_META.heroSubtitle,
    heroTitle: trimmed(metaIn.heroTitle) || DEFAULT_GAME_META.heroTitle,
    id,
    importedScenarioName: trimmed(ref.scenarioName) || null,
    importedScenarioOrigin: normalizeHubOrigin(ref.hubOrigin),
    importedAt: arrivedAt,
    name: await uniqueGameName(metaIn.name),
    scenarioId,
    subtitle: trimmed(metaIn.subtitle) || DEFAULT_GAME_META.subtitle,
    updatedAt: trimmed(metaIn.updatedAt) || arrivedAt,
  };

  await putGame(record);
  const manifest = await getGameManifest();
  const order = resolveOrderedIds(manifest.order, await listGameIds(), DEFAULT_GAME_ID).filter((e) => e !== id);
  order.unshift(id);
  await saveGameManifest({ activeGameId: manifest.activeGameId, order });
  return getGameDetails(id);
};

const readGameSnapshots = async (id) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);
  return jsonAsset(record, "snapshots");
};

const writeGameSnapshots = async (id, snapshots) => {
  const record = await getGame(id);
  if (!record) throw new Error(`Game not found: ${id}`);
  record.json = { ...record.json, snapshots: Array.isArray(snapshots) ? snapshots : [] };
  await putGame(record);
  return { ok: true };
};

const INSTITUTION_LOGO_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i;
const MAX_INSTITUTION_LOGO_BYTES = 512 * 1024;

const institutionLogoResponse = (dataUrl) => {
  const match = INSTITUTION_LOGO_DATA_URL.exec(String(dataUrl || ""));
  if (!match) throw new Error("Institution logo is missing or invalid.");
  const bytes = base64ToBytes(match[2]);
  if (!bytes.byteLength || bytes.byteLength > MAX_INSTITUTION_LOGO_BYTES) {
    throw new Error("Institution logo is empty or exceeds the size limit.");
  }
  const subtype = match[1].toLowerCase();
  return binaryResponse(bytes, subtype === "jpg" ? "image/jpeg" : `image/${subtype}`);
};

export const handleScenarioInstitutionLogo = async ({ method, segments }) => {
  if (method !== "GET") return null;
  const scenarioId = segments[0] ? decodeURIComponent(segments[0]) : "";
  const institutionId = segments[2] ? decodeURIComponent(segments[2]) : "";
  if (!scenarioId || segments[1] !== "institution-logo" || !institutionId) return null;
  try {
    const record = await getScenario(scenarioId);
    if (!record) throw new Error(`Scenario not found: ${scenarioId}`);
    const logos = coerceRuntimeValue("institutionLogos", runtimeValueFromRecord(record, "institutionLogos", true)) || {};
    return institutionLogoResponse(logos?.[institutionId]);
  } catch (error) {
    return errorResponse(error.message, 404);
  }
};

export const handleRuntimeInstitutionLogo = async ({ method, segments }) => {
  if (method !== "GET") return null;
  const institutionId = segments[1] ? decodeURIComponent(segments[1]) : "";
  if (segments[0] !== "institution-logo" || !institutionId) return null;
  try {
    const logos = await readRuntimeJsonAsset("institutionLogos");
    return institutionLogoResponse(logos?.[institutionId]);
  } catch (error) {
    return errorResponse(error.message, 404);
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
    if (id === "import" && method === "POST") return jsonResponse(await importGameBundle(body ?? {}), 201);

    const sub = segments[1];
    if (!sub) {
      if (method === "GET") return jsonResponse(await getGameDetails(id));
      if (method === "PUT") return jsonResponse(await updateGame(id, body ?? {}));
      if (method === "DELETE") return jsonResponse(await deleteGame(id));
      return null;
    }
    if (sub === "export" && method === "GET") return jsonResponse(await exportGameBundle(id));
    if (sub === "snapshots") {
      if (method === "GET") return jsonResponse(await readGameSnapshots(id));
      if (method === "PUT") return jsonResponse(await writeGameSnapshots(id, body));
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

export const handleRuntimeTurnCommit = async ({ method, body }) => {
  if (method !== "PUT") return null;
  try {
    return jsonResponse(await writeRuntimeTurnState(body ?? {}));
  } catch (error) {
    return errorResponse(error.message, 400);
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
