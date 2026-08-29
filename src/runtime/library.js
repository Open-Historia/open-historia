/*! Open Historia — portions (scenario-map editor seeding) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useSyncExternalStore } from "react";
import {
  JSON_URLS,
  readJson,
  setCountryNameResolver,
  setRuntimeAssetEndpoints,
} from "./assets.js";
import { logDebugEvent, setDebugLogContext } from "./debugLog.js";
import { applySaveBetaUnits } from "./mapSettings.js";
import { enqueueContentStrings } from "./translator.js";

const LIBRARY_API_ROOT = "/api/library";
const SCENARIOS_API_ROOT = "/api/scenarios";
const GAMES_API_ROOT = "/api/games";

const INITIAL_LIBRARY_STATE = {
  activeGame: null,
  activeGameId: null,
  baseSaves: [],
  countryNames: {},
  error: null,
  games: [],
  loaded: false,
  loading: false,
  runtimeScenario: null,
  scenarios: [],
  selectedScenario: null,
  selectedScenarioId: null,
  token: "",
};

let libraryState = INITIAL_LIBRARY_STATE;
let libraryCatalogRequest = null;
const listeners = new Set();

const emitLibraryState = () => {
  for (const listener of listeners) {
    listener();
  }
};

const normalizeLookupKey = (value) => String(value ?? "").trim().toUpperCase();

const resolveCountryNameOverride = (overrides, name, code) => {
  if (!overrides || typeof overrides !== "object") {
    return name;
  }

  const codeKey = normalizeLookupKey(code);
  if (codeKey && typeof overrides[codeKey] === "string" && overrides[codeKey].trim()) {
    return overrides[codeKey].trim();
  }

  const exactName = String(name ?? "").trim();
  if (exactName && typeof overrides[exactName] === "string" && overrides[exactName].trim()) {
    return overrides[exactName].trim();
  }

  const normalizedName = normalizeLookupKey(name);
  if (
    normalizedName &&
    typeof overrides[normalizedName] === "string" &&
    overrides[normalizedName].trim()
  ) {
    return overrides[normalizedName].trim();
  }

  return name;
};

const syncLibraryRuntime = () => {
  const token = libraryState.token ?? libraryState.activeGame?.cacheToken ?? "";
  setRuntimeAssetEndpoints({ token });
  setCountryNameResolver((name, code) =>
    resolveCountryNameOverride(libraryState.runtimeScenario?.countryNameOverrides, name, code),
  );
};

const setLibraryState = (nextState) => {
  libraryState = nextState;
  syncLibraryRuntime();
  emitLibraryState();
};

const parseApiResponse = async (response) => {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return payload;
  }

  const message =
    payload?.error ||
    payload?.message ||
    `Request failed with HTTP ${response.status}`;
  throw new Error(message);
};

const requestJson = async (pathname, { body, method = "GET" } = {}) => {
  const startedAt = Date.now();
  const response = await fetch(pathname, {
    body: body == null ? undefined : JSON.stringify(body),
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    method,
  });

  try {
    const parsed = await parseApiResponse(response);
    // Detailed mode records the calls that WORKED too. A save that silently
    // never fired, one that took nine seconds, an autosave running twice a
    // second — none of those raise an error, and all of them are diagnosed from
    // the shape of this stream rather than from any single entry. The request
    // body stays out at both levels: it is a whole campaign.
    // The duration only goes in when it is worth seeing. The game polls the
    // active game and the actions queue every five seconds, so a per-call
    // millisecond figure would make every poll a unique entry and defeat the
    // repeat collapsing — hundreds of near-identical lines burning the size
    // budget. Identical fast calls now fold into one `(×120)` line, and a call
    // slow enough to matter breaks out of the fold by itself, which is exactly
    // when you want to see it.
    const elapsed = Date.now() - startedAt;
    logDebugEvent("api", `${method} ${pathname} → ${response.status}`,
      elapsed >= 1000 ? { slowMs: elapsed } : undefined,
      { verbose: true });
    return parsed;
  } catch (error) {
    // Every library call — load, save, activate, delete, every asset upload —
    // funnels through here, so this one line puts "the save failed and here is
    // what the server said" in the diagnostics log for all of them. Several
    // callers swallow the throw or surface it only as a toast that is gone by
    // the time a bug is reported.
    //
    // The path, not the body: a request body is a whole campaign and the log is
    // meant to be pasteable.
    logDebugEvent("api", `${method} ${pathname} failed`, error);
    throw error;
  }
};

const applyLibraryCatalog = (catalog) => {
  const games = Array.isArray(catalog?.games) ? catalog.games : [];
  const scenarios = Array.isArray(catalog?.scenarios) ? catalog.scenarios : [];
  const activeGameId = catalog?.activeGameId ?? games[0]?.id ?? null;
  const selectedScenarioId = catalog?.selectedScenarioId ?? scenarios[0]?.id ?? null;
  const activeGame = games.find((entry) => entry.id === activeGameId) ?? null;
  const selectedScenario = scenarios.find((entry) => entry.id === selectedScenarioId) ?? null;
  const runtimeScenario =
    scenarios.find((entry) => entry.id === catalog?.runtimeScenario?.id) ??
    catalog?.runtimeScenario ??
    (activeGame
      ? scenarios.find((entry) => entry.id === activeGame.scenarioId) ?? null
      : null);

  // The report header's campaign block, refreshed wherever the catalog lands:
  // creating, saving, activating and deleting a game all pass through here, so
  // a log pasted after switching saves names the save it is actually about.
  if (activeGameId !== libraryState.activeGameId) {
    logDebugEvent(
      "game",
      activeGame ? `Active game switched to "${activeGame.name || activeGameId}".` : "No active game.",
      activeGameId ? { gameId: activeGameId, scenarioId: activeGame?.scenarioId || "" } : undefined,
    );
  }
  setDebugLogContext({
    gameId: activeGameId || "",
    gameName: activeGame?.name || "",
    scenario: runtimeScenario?.name || activeGame?.scenarioId || "",
  });

  const activeGameChanged = activeGameId !== libraryState.activeGameId;

  setLibraryState({
    activeGame,
    activeGameId,
    baseSaves: Array.isArray(catalog?.baseSaves) ? catalog.baseSaves : [],
    countryNames:
      catalog?.countryNames && typeof catalog.countryNames === "object"
        ? catalog.countryNames
        : {},
    error: null,
    games,
    loaded: true,
    loading: false,
    runtimeScenario,
    scenarios,
    selectedScenario,
    selectedScenarioId,
    token: catalog?.token ?? activeGame?.cacheToken ?? "",
  });

  // After setLibraryState, never before: syncLibraryRuntime() inside it is what
  // repoints JSON_URLS.game at the newly active save.
  if (activeGameChanged) {
    loadActiveSaveBetaUnits().catch((error) => {
      console.warn("Failed to read the save's unit-system setting:", error);
    });
  }

  return libraryState;
};

// The beta unit system is stored per save, in game.json — see the block above
// MAP_SETTING_KEYS.betaUnits in mapSettings.js for why. That file cannot read it
// itself (the value arrives over fetch, and mapSettings.js is imported by modules
// that must load without a save), so the load lives here, next to the only place
// that knows when the active save changed.
//
// Guarded by the id it was started for: activating two saves in quick succession
// leaves two reads in flight, and the slower one must not land its answer on the
// campaign that is now open.
let betaUnitsRequest = null;
export const loadActiveSaveBetaUnits = async () => {
  const gameId = libraryState.activeGameId;
  if (!gameId) {
    applySaveBetaUnits("", null);
    return null;
  }

  betaUnitsRequest = (async () => {
    // Not forced: the startup preload and every catalog refresh warm this URL,
    // and the URL itself carries the runtime token, so switching saves is
    // already a different key rather than a stale hit.
    const game = await readJson(JSON_URLS.game, { defaultValue: {} }).catch(() => ({}));
    return game?.betaUnits;
  })();

  const request = betaUnitsRequest;
  const value = await request;
  if (request !== betaUnitsRequest || libraryState.activeGameId !== gameId) return null;
  applySaveBetaUnits(gameId, value);
  return value ?? null;
};

export const getLibraryState = () => libraryState;

export const subscribeToLibraryState = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLibraryState = () =>
  useSyncExternalStore(subscribeToLibraryState, getLibraryState, getLibraryState);

export const refreshLibraryCatalog = async ({ force = false } = {}) => {
  if (libraryCatalogRequest && !force) {
    return libraryCatalogRequest;
  }

  setLibraryState({
    ...libraryState,
    error: null,
    loading: true,
  });

  libraryCatalogRequest = requestJson(LIBRARY_API_ROOT)
    .then((catalog) => applyLibraryCatalog(catalog))
    .catch((error) => {
      setLibraryState({
        ...libraryState,
        error: error.message,
        loaded: true,
        loading: false,
      });
      throw error;
    })
    .finally(() => {
      libraryCatalogRequest = null;
    });

  return libraryCatalogRequest;
};

export const ensureLibraryCatalog = async () => {
  if (libraryState.loaded) {
    return libraryState;
  }

  return refreshLibraryCatalog();
};

export const loadScenarioDetails = async (scenarioId) =>
  requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}`);

export const createScenario = async (payload) => {
  const details = await requestJson(SCENARIOS_API_ROOT, {
    body: payload,
    method: "POST",
  });
  // Edited names/descriptions translate (and reach the server language pack)
  // the moment they're saved, not when first rendered.
  enqueueContentStrings(payload);
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const saveScenario = async (scenarioId, payload) => {
  const details = await requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}`, {
    body: payload,
    method: "PUT",
  });
  enqueueContentStrings(payload);
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const selectScenario = async (scenarioId) => {
  const catalog = await requestJson(`${SCENARIOS_API_ROOT}/selected`, {
    body: { scenarioId },
    method: "PUT",
  });
  return applyLibraryCatalog(catalog);
};

export const removeScenario = async (scenarioId) => {
  const catalog = await requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}`, {
    method: "DELETE",
  });
  return applyLibraryCatalog(catalog);
};

const toUploadBuffer = async (file) => {
  if (file instanceof Blob) {
    return file.arrayBuffer();
  }

  if (file instanceof ArrayBuffer) {
    return file;
  }

  if (ArrayBuffer.isView(file)) {
    return file.buffer;
  }

  return new TextEncoder().encode(String(file ?? "")).buffer;
};

// Fetch a scenario's JSON asset (regions/cities geojson, colors). Returns null
// when the scenario has no such asset (404) instead of throwing — callers treat
// a missing asset as "use the default".
export const downloadScenarioJsonAsset = async (scenarioId, assetKey) => {
  try {
    const response = await fetch(
      `${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/assets/${encodeURIComponent(assetKey)}`,
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

export const uploadScenarioAsset = async (scenarioId, assetKey, file) => {
  const response = await fetch(
    `${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/assets/${encodeURIComponent(assetKey)}`,
    {
      body: await toUploadBuffer(file),
      headers: {
        "Content-Type": file?.type || "application/octet-stream",
      },
      method: "PUT",
    },
  );

  const details = await parseApiResponse(response);
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const clearScenarioAsset = async (scenarioId, assetKey) => {
  const details = await requestJson(
    `${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/assets/${encodeURIComponent(assetKey)}`,
    {
      method: "DELETE",
    },
  );
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const uploadGameAsset = async (gameId, assetKey, file) => {
  const response = await fetch(
    `${GAMES_API_ROOT}/${encodeURIComponent(gameId)}/assets/${encodeURIComponent(assetKey)}`,
    {
      body: await toUploadBuffer(file),
      headers: {
        "Content-Type": file?.type || "application/octet-stream",
      },
      method: "PUT",
    },
  );

  const details = await parseApiResponse(response);
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const clearGameAsset = async (gameId, assetKey) => {
  const details = await requestJson(
    `${GAMES_API_ROOT}/${encodeURIComponent(gameId)}/assets/${encodeURIComponent(assetKey)}`,
    {
      method: "DELETE",
    },
  );
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const exportScenarioBundle = async (scenarioId, mode = "light") =>
  requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/export?mode=${encodeURIComponent(mode)}`);

export const importScenarioBundle = async (bundle) => {
  const details = await requestJson(`${SCENARIOS_API_ROOT}/import`, {
    body: bundle,
    method: "POST",
  });
  await refreshLibraryCatalog({ force: true });
  return details;
};

// Replace an existing scenario's content with a fresh bundle — the hub's
// "Update" button. Keeps the local scenario id, so games that reference it
// keep working.
export const updateScenarioFromBundle = async (scenarioId, bundle) => {
  const details = await requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/import`, {
    body: bundle,
    method: "PUT",
  });
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const loadGameDetails = async (gameId) =>
  requestJson(`${GAMES_API_ROOT}/${encodeURIComponent(gameId)}`);

export const createGame = async (payload) => {
  const details = await requestJson(GAMES_API_ROOT, {
    body: payload,
    method: "POST",
  });
  logDebugEvent("game", `New game created: "${payload?.name || details?.id || "untitled"}".`, {
    scenarioId: payload?.scenarioId || "",
    country: payload?.country || "",
    difficulty: payload?.difficulty || "",
  });
  // Card text edits translate (and reach the server language pack) right away.
  enqueueContentStrings(payload);
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const saveGame = async (gameId, payload) => {
  const details = await requestJson(`${GAMES_API_ROOT}/${encodeURIComponent(gameId)}`, {
    body: payload,
    method: "PUT",
  });
  enqueueContentStrings(payload);
  await refreshLibraryCatalog({ force: true });
  return details;
};

export const activateGame = async (gameId) => {
  const catalog = await requestJson(`${GAMES_API_ROOT}/active`, {
    body: { gameId },
    method: "PUT",
  });
  return applyLibraryCatalog(catalog);
};

export const removeGame = async (gameId) => {
  // Logged before the request, not after: "they deleted a save and then it
  // broke" is the report this line exists for, and a delete that throws
  // half-way is exactly the case where the after-the-fact line never runs.
  logDebugEvent("game", "Deleting a save.", { gameId });
  const catalog = await requestJson(`${GAMES_API_ROOT}/${encodeURIComponent(gameId)}`, {
    method: "DELETE",
  });
  return applyLibraryCatalog(catalog);
};

export const resolveScenarioCountryName = (name, code) =>
  resolveCountryNameOverride(libraryState.runtimeScenario?.countryNameOverrides, name, code);

syncLibraryRuntime();
