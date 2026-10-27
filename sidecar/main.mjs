import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import util from "node:util";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installShims } from "./shims.js";
import { installWorkerShim } from "./workers.js";
import { installStandInModel } from "./standin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

for (const method of ["log", "info", "debug", "warn"]) {
  console[method] = (...args) => process.stderr.write(`${util.format(...args)}\n`);
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const emit = (event, data = null) => send({ event, data });

const appData = process.env.APPDATA
  || (process.platform === "darwin" ? path.join(process.env.HOME ?? "", "Library", "Application Support") : path.join(process.env.HOME ?? "", ".config"));
const dataRoot = path.resolve(process.env.OH_NATIVE_ROOT || path.join(appData, "Open Historia Native"));
const dataDir = path.join(dataRoot, "server", "data");
const nativeDir = path.join(dataRoot, "native");
const cacheDir = path.join(dataRoot, "native-cache");
const stableAssets = path.join(appData, "open-historia", "public", "assets");
const assetsDir = path.resolve(process.env.OH_NATIVE_ASSETS || (fs.existsSync(stableAssets) ? stableAssets : path.join(dataRoot, "public", "assets")));
for (const dir of [dataDir, nativeDir, cacheDir]) fs.mkdirSync(dir, { recursive: true });

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const serverWorker = new Worker(path.join(here, "serverWorker.mjs"), {
  workerData: { repo, dataDir, assetsDir, channel: process.env.OH_CHANNEL || "native", port, discord: process.env.OH_STANDIN_MODEL !== "1" && process.env.OH_DISCORD_PRESENCE !== "0" },
  stdout: true,
  stderr: true,
});
serverWorker.stdout.on("data", (chunk) => process.stderr.write(chunk));
serverWorker.stderr.on("data", (chunk) => process.stderr.write(chunk));
serverWorker.on("error", (error) => {
  emit("sidecar.fatal", { message: `The game's server stopped: ${error?.message ?? error}` });
  process.exit(1);
});

const waitForServer = async () => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/library`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("The game's server did not start within a minute.");
};
await waitForServer();

const { storage, setVisible } = installShims({ origin, storageFile: path.join(nativeDir, "local-storage.json") });
if (process.env.OH_NATIVE_WORKERS !== "0") installWorkerShim({ origin });
let expectedJump = { origin: "", target: "", country: "" };
if (process.env.OH_STANDIN_MODEL === "1") {
  installStandInModel({ expected: () => expectedJump });
  storage.setItem("api_provider", "gemini");
  storage.setItem("gemini_api_key", "stand-in");
}

const enginePath = path.join(here, "dist", "engine.mjs");
const engine = await import(pathToFileURL(enginePath).href);
engine.setDebugLogPersistence(true);
engine.debugLog.installDebugLogCapture();
engine.debugLog.setDebugLogContext({ build: "native", language: String(globalThis.navigator?.language ?? "") });
engine.debugLog.logDebugEvent("app", "Open Historia started.");
engine.subscribeToDebugLog?.((entry) => {
  if (entry && (entry.problem || entry.category === "turn")) emit("log", { category: entry.category, message: entry.message });
});
await engine.refreshLibraryCatalog({ force: true });

const api = async (route, { method = "GET", body } = {}) => {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(parsed?.error || parsed?.message || `${route} answered ${response.status}`);
  return parsed;
};

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

const PROVIDERS = {
  gemini: "gemini_api_key",
  openai: "openai_api_key",
  anthropic: "anthropic_api_key",
};

let regionCache = { sha: "", features: [] };

const loadRegions = async () => {
  const response = await fetch(engine.JSON_URLS.regionsGeojson || "/api/runtime/json/regionsGeojson");
  if (!response.ok) throw new Error(`The map's regions could not be read (${response.status}).`);
  const text = await response.text();
  const sha = crypto.createHash("sha256").update(text).digest("hex");
  const file = path.join(cacheDir, "regions", `${sha}.geojson`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
  }
  if (regionCache.sha !== sha) {
    const parsed = JSON.parse(text);
    regionCache = { sha, features: list(parsed?.features) };
  }
  return { sha, file, count: regionCache.features.length };
};

const regionIdOf = (feature) => clean(feature?.id ?? feature?.properties?.id);

const flagFileFor = (code, flagsDir) => {
  const url = engine.flagImageUrlFromGid(clean(code));
  const alpha2 = /\/([a-z]{2}(?:-[a-z]{2,3})?)\.svg$/i.exec(String(url ?? ""))?.[1]?.toLowerCase();
  if (!alpha2) return "";
  const file = path.join(flagsDir, `${alpha2}.svg`);
  return fs.existsSync(file) ? file : "";
};

let boundsCache = { sha: "", records: [] };

const extendRing = (box, ring) => {
  for (const point of list(ring)) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < box[0]) box[0] = lon;
    if (lat < box[1]) box[1] = lat;
    if (lon > box[2]) box[2] = lon;
    if (lat > box[3]) box[3] = lat;
  }
};

const regionRecords = async () => {
  if (!regionCache.sha) await loadRegions();
  if (boundsCache.sha === regionCache.sha) return boundsCache.records;
  const records = [];
  for (const feature of regionCache.features) {
    const id = regionIdOf(feature);
    const geometry = feature?.geometry;
    if (!id || !geometry) continue;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? list(geometry.coordinates) : [];
    for (const polygon of polygons) extendRing(box, list(polygon)[0]);
    if (!Number.isFinite(box[0])) continue;
    records.push({ id, name: clean(feature?.properties?.name), bounds: [[box[0], box[1]], [box[2], box[3]]] });
  }
  boundsCache = { sha: regionCache.sha, records };
  return records;
};

const mapState = async (worldOverride = null) => {
  if (!regionCache.sha) await loadRegions();
  const bundle = await engine.readGameStateBundle({ force: true });
  const world = worldOverride ?? bundle.world ?? {};
  const colors = await engine.readJson(engine.JSON_URLS.colors, { defaultValue: {}, force: true });
  const resolve = engine.createOwnerRgbResolver(colors, world.polityOverrides);
  const overrides = world.regionOwnershipOverrides ?? {};
  const ownerNames = [];
  const ownerIndex = new Map();
  const owners = new Array(regionCache.features.length);
  for (let index = 0; index < regionCache.features.length; index += 1) {
    const feature = regionCache.features[index];
    const id = regionIdOf(feature);
    const owner = clean(Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : feature?.properties?.owner);
    if (!owner) {
      owners[index] = -1;
      continue;
    }
    if (!ownerIndex.has(owner)) {
      ownerIndex.set(owner, ownerNames.length);
      ownerNames.push(owner);
    }
    owners[index] = ownerIndex.get(owner);
  }
  const ownerColors = ownerNames.map((name) => {
    const rgb = resolve(name);
    return Array.isArray(rgb) ? rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)))) : [120, 120, 120];
  });
  return { sha: regionCache.sha, owners, ownerNames, ownerColors, player: clean(bundle.game?.country) };
};

const eventView = (event) => ({
  id: clean(event?.id),
  date: clean(event?.date),
  title: clean(event?.title),
  description: clean(event?.description),
  importance: clean(event?.importance),
  playerRelated: event?.playerRelated === true,
});

const gameView = async () => {
  const bundle = await engine.readGameStateBundle({ force: true });
  const library = engine.getLibraryState();
  const activeId = clean(library?.activeGameId ?? library?.activeGame?.id);
  return {
    id: activeId,
    country: clean(bundle.game?.country),
    gameDate: clean(bundle.game?.gameDate),
    round: Number(bundle.game?.round) || 0,
    events: list(bundle.events).slice(-40).map(eventView),
  };
};

const running = new Map();

const INVOKABLE = {
  gameplay: [
    "simulateTimelineJump", "simulateAutoJump", "retryPendingJumpSegment", "retryPendingProjectsJump", "retryPendingChecksJump",
    "retryHeldPlayerEvents", "heldSkipToRerun", "applyParkedTurn", "loadParkedTurn", "discardKeptTurn", "maybeGeneratePregameHistory",
    "maybeOpenScenarioFronts", "rollBackToSnapshot", "canInterveneInLastTurn", "interveneAfterEvent", "createInteractive",
    "declineInteractiveOffer", "answerDiplomacy", "advanceActiveInteractive", "rewindActiveInteractive", "endActiveInteractive",
    "setAsideActiveInteractive", "runChatActionBatch", "checkDemandReply", "ensureCountryAssessed", "processPendingEventOutreach",
    "generateActionSuggestions", "refinePlayerAction", "previewGameMasterCommand", "applyGameMasterPreview", "consolidateHistoryNow",
    "ensureIntelligenceRated", "ensureMilitaryFigures", "readOpenedIntercepts", "generateCountryStatSheet", "pendingCountryStatSheet",
    "generateCountryStats", "generateListenInFeed", "generateWarRoomReply", "warRoomRouteAttacks", "warRoomTransportWays", "warRoomChart",
    "maybeSendIdleDiplomacy", "maybeGatherIntelligence", "prethinkFronts", "warRoomRehearse",
  ],
  gameState: [
    "readWorldStateView", "readWorldState", "readActionsState", "readEventsState", "readInterceptsState", "readChatsState", "readGameStateBundle",
  ],
  assets: ["loadRollbackSnapshotIndex", "loadRollbackSnapshot"],
  simulationStatus: ["getHeldTurn", "discardHeldTurn", "discardParkedTurn", "isSimulationBusy", "isGenerating", "isChatGenerationLikely", "getParkedTurn"],
  requestBudget: ["requestDay", "savingRequests", "describeJumpCost", "backgroundAiAllowance"],
  turnCommit: ["undoableTurns"],
  diplomaticStance: ["buildDiplomaticStanceMap"],
  providerConfig: ["applyQuickAiSetup", "describeEntry", "connectionDisplayName", "getEntryStatus"],
  unitsController: ["requestUnitOrders", "disbandUnit"],
  playerTurnFailures: ["describePlayerTurnFailures"],
  aiMain: ["sendMessage", "loadHistory", "startChat", "sendDiplomaticMessage"],
};

const plain = (value) => {
  const holders = [];
  const sources = [];
  return JSON.parse(JSON.stringify(value ?? null, function (_key, raw) {
    if (typeof raw === "function" || typeof raw === "symbol") return undefined;
    if (typeof raw === "bigint") return Number(raw);
    const item = raw instanceof Map ? Object.fromEntries(raw) : raw instanceof Set ? [...raw] : raw;
    if (item && typeof item === "object") {
      while (holders.length > 0 && holders[holders.length - 1] !== this) {
        holders.pop();
        sources.pop();
      }
      if (sources.includes(raw)) return undefined;
      holders.push(item);
      sources.push(raw);
    }
    return item;
  }) ?? "null");
};

const reviveArgs = (args, { id, signal }) => (Array.isArray(args) ? args : []).map((arg) => {
  const swap = (value) => {
    if (!value || typeof value !== "object") return value;
    if (value.$signal === true) return signal;
    if (typeof value.$callback === "string") {
      const name = value.$callback;
      return (...payload) => emit("callback", { call: id, name, args: plain(payload) });
    }
    if (Array.isArray(value)) return value.map(swap);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
  };
  return swap(arg);
});

const methods = {
  hello: async () => ({ dataRoot, assetsDir, origin, standIn: process.env.OH_STANDIN_MODEL === "1" }),
  "library.list": async () => {
    const catalog = await api("/api/library");
    const scenarios = list(catalog?.scenarios);
    const games = list(catalog?.games);
    const scenarioName = new Map(scenarios.map((scenario) => [clean(scenario?.id), clean(scenario?.name)]));
    return {
      activeGameId: clean(catalog?.activeGameId),
      games: games.map((game) => ({
        id: clean(game?.id),
        name: clean(game?.name),
        scenarioId: clean(game?.scenarioId),
        scenarioName: scenarioName.get(clean(game?.scenarioId)) || clean(game?.scenarioName) || clean(game?.heroTitle),
        country: clean(game?.country),
        gameDate: clean(game?.currentDate ?? game?.gameDate),
        round: Number(game?.round ?? game?.currentRound) || 1,
        description: clean(game?.description),
        eventCount: Number(game?.eventCount) || 0,
        pendingActions: Number(game?.pendingActions) || 0,
        coverImageUrl: clean(game?.ownCoverImageUrl || game?.coverImageUrl),
        accentColor: clean(game?.accentColor) || "#2bc1f3",
        archived: game?.archived === true,
        lastPlayedAt: clean(game?.lastPlayedAt),
        importedAt: clean(game?.importedAt),
        updatedAt: clean(game?.updatedAt),
        createdAt: clean(game?.createdAt),
        playCount: Number(game?.playCount) || 0,
        heroTitle: clean(game?.heroTitle),
        eyebrow: clean(game?.eyebrow),
        canDelete: game?.canDelete === true,
        scenarioMissing: game?.scenarioMissing === true,
        importedScenarioName: clean(game?.importedScenarioName),
        importedScenarioOrigin: game?.importedScenarioOrigin && typeof game.importedScenarioOrigin === "object" ? game.importedScenarioOrigin : null,
      })),
      scenarios: scenarios.map((scenario) => ({
        id: clean(scenario?.id),
        name: clean(scenario?.name),
        description: clean(scenario?.description),
        heroSubtitle: clean(scenario?.heroSubtitle),
        subtitle: clean(scenario?.subtitle),
        coverImageUrl: clean(scenario?.coverImageUrl),
        accentColor: clean(scenario?.accentColor) || "#2bc1f3",
        builtIn: clean(scenario?.id) === "default" || scenario?.builtIn === true,
        fromHub: Boolean(scenario?.hubOrigin),
        games: games.filter((game) => clean(game?.scenarioId) === clean(scenario?.id)).length,
        updatedAt: clean(scenario?.updatedAt),
        createdAt: clean(scenario?.createdAt),
        heroTitle: clean(scenario?.heroTitle),
        gameCount: Number(scenario?.gameCount) || 0,
        playCount: Number(scenario?.playCount) || 0,
        hubEdited: Boolean(scenario?.hubOrigin?.editedAt),
      })),
    };
  },
  "countries.list": async () => {
    const catalog = await api("/api/library");
    const flagsDir = path.join(repo, "public", "flags");
    const seen = new Set();
    const countries = [];
    for (const [code, name] of Object.entries(catalog?.countryNames ?? {})) {
      const label = clean(name);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      countries.push({ name: label, flag: flagFileFor(code, flagsDir) });
    }
    countries.sort((a, b) => a.name.localeCompare(b.name));
    return { countries, difficulties: engine.DIFFICULTY_LEVELS.map((level) => ({ id: level.id, label: level.label, emoji: level.emoji, blurb: level.blurb })) };
  },
  "game.create": async ({ scenarioId = "default", name = "", country = "", difficulty = "" } = {}) => {
    const gamePatch = {};
    if (clean(country)) gamePatch.country = clean(country);
    if (clean(difficulty)) gamePatch.difficulty = clean(difficulty);
    const created = await api("/api/games", { method: "POST", body: { name: clean(name) || undefined, scenarioId, setActive: true, ...(Object.keys(gamePatch).length ? { gamePatch } : {}) } });
    await engine.refreshLibraryCatalog({ force: true });
    regionCache = { sha: "", features: [] };
    return { id: clean(created?.id ?? created?.game?.id) };
  },
  "game.update": async ({ id, country = "", difficulty = "" }) => {
    const gamePatch = {};
    if (clean(country)) gamePatch.country = clean(country);
    if (clean(difficulty)) gamePatch.difficulty = clean(difficulty);
    await api(`/api/games/${encodeURIComponent(id)}`, { method: "PUT", body: { gamePatch } });
    await engine.refreshLibraryCatalog({ force: true });
    return gameView();
  },
  "game.delete": async ({ id }) => {
    await api(`/api/games/${encodeURIComponent(id)}`, { method: "DELETE" });
    await engine.refreshLibraryCatalog({ force: true });
    return true;
  },
  "game.flag": async ({ country = "" } = {}) => {
    const catalog = await api("/api/library");
    const wanted = clean(country);
    const entry = Object.entries(catalog?.countryNames ?? {}).find(([, name]) => clean(name) === wanted);
    return { flag: entry ? flagFileFor(entry[0], path.join(repo, "public", "flags")) : "" };
  },
  "map.cities": async () => {
    const response = await fetch(engine.JSON_URLS.citiesGeojson || "/api/runtime/json/citiesGeojson");
    if (!response.ok) return { cities: [] };
    const parsed = await response.json().catch(() => null);
    const cities = [];
    for (const feature of list(parsed?.features)) {
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const props = feature?.properties ?? {};
      const name = clean(props.name ?? props.NAME ?? props.city);
      if (!name) continue;
      const capital = clean(props.capital).toLowerCase() === "primary" || props.capital === true;
      const population = Number(props.population ?? props.POP_MAX ?? props.pop_max ?? props.pop) || 0;
      cities.push([name, Number(coordinates[0]), Number(coordinates[1]), capital ? 1 : 0, population, Number(props.tier) || 3]);
    }
    return { cities };
  },
  "game.open": async ({ id }) => {
    await api("/api/games/active", { method: "PUT", body: { gameId: id } });
    await engine.refreshLibraryCatalog({ force: true });
    regionCache = { sha: "", features: [] };
    return gameView();
  },
  "game.view": async () => gameView(),
  "map.regions": async () => loadRegions(),
  "map.state": async () => mapState(),
  skip: async ({ days }, { signal, id }) => {
    const bundle = await engine.readGameStateBundle({ force: true });
    const originDate = clean(bundle.game?.gameDate);
    expectedJump = { origin: originDate, target: engine.jumpTargetDate(originDate, Number(days) || 0), country: clean(bundle.game?.country) };
    const result = await engine.simulateTimelineJump({
      days: Number(days) || 0,
      signal,
      onProgress: (progress) => emit("turn.progress", { call: id, progress: JSON.parse(JSON.stringify(progress ?? null)) }),
      onEvents: (events) => emit("turn.events", { call: id, events: list(events).map(eventView) }),
    });
    const view = await gameView();
    return { summary: clean(result?.summary), view };
  },
  "skip.auto": async (_args, { signal, id }) => {
    const bundle = await engine.readGameStateBundle({ force: true });
    const originDate = clean(bundle.game?.gameDate);
    expectedJump = { origin: originDate, target: engine.jumpTargetDate(originDate, 30), country: clean(bundle.game?.country) };
    const result = await engine.simulateAutoJump({
      signal,
      onProgress: (progress) => emit("turn.progress", { call: id, progress: JSON.parse(JSON.stringify(progress ?? null)) }),
      onEvents: (events) => emit("turn.events", { call: id, events: list(events).map(eventView) }),
    });
    const view = await gameView();
    return { summary: clean(result?.summary), view };
  },
  "settings.ai.get": async () => {
    const provider = clean(storage.getItem("api_provider")) || "gemini";
    return { provider, hasKey: Boolean(clean(storage.getItem(PROVIDERS[provider] ?? ""))), providers: Object.keys(PROVIDERS) };
  },
  "settings.ai.set": async ({ provider, key }) => {
    if (!PROVIDERS[provider]) throw new Error(`Unknown AI provider: ${provider}`);
    storage.setItem("api_provider", provider);
    if (clean(key)) storage.setItem(PROVIDERS[provider], clean(key));
    storage.flush();
    return methods["settings.ai.get"]();
  },
  invoke: async ({ module, fn, args = [] }, { signal, id }) => {
    if (!INVOKABLE[module]?.includes(fn)) throw new Error(`Not callable from the native app: ${module}.${fn}`);
    const target = engine[module]?.[fn];
    if (typeof target !== "function") throw new Error(`The engine has no ${module}.${fn}.`);
    return plain(await target(...reviveArgs(args, { id, signal })));
  },
  "doc.read": async ({ key, view = false }) => {
    if (key === "world" && view) return plain(await engine.gameState.readWorldStateView({ force: true }));
    const url = engine.JSON_URLS[key];
    if (!url) throw new Error(`Unknown document: ${key}`);
    return plain(await engine.readJson(url, { defaultValue: null, force: true }));
  },
  presence: async ({ visible }) => {
    setVisible(visible !== false);
    return true;
  },
  cancel: async ({ call }) => {
    running.get(Number(call))?.abort();
    return true;
  },
};

const handlersDir = path.join(here, "handlers");
if (fs.existsSync(handlersDir)) {
  const { addStandIn } = await import("./standin.js");
  const standIn = process.env.OH_STANDIN_MODEL === "1";
  const context = { engine, api, emit, plain, storage, clean, list, repo, dataRoot, cacheDir, gameView, mapState, regionRecords, setVisible, addStandIn, standIn, expectJump: (value) => { expectedJump = value; } };
  for (const file of fs.readdirSync(handlersDir).filter((name) => name.endsWith(".mjs")).sort()) {
    try {
      const module = await import(pathToFileURL(path.join(handlersDir, file)).href);
      Object.assign(methods, await module.register(context));
    } catch (error) {
      process.stderr.write(`[sidecar] ${file} was not loaded: ${error?.stack ?? error}\n`);
      emit("sidecar.handlerFailed", { file, message: clean(error?.message) });
    }
  }
}

const handle = async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const id = Number(message?.id);
  const run = methods[clean(message?.method)];
  if (!run) {
    send({ id, ok: false, error: `Unknown method: ${message?.method}` });
    return;
  }
  const controller = new AbortController();
  running.set(id, controller);
  try {
    const result = await run(message.args ?? {}, { signal: controller.signal, id });
    send({ id, ok: true, result: result ?? null });
  } catch (error) {
    send({ id, ok: false, error: clean(error?.message ?? error) || "Something went wrong.", heldKind: clean(error?.heldKind), failures: plain(error?.playerFailures ?? null), aborted: error?.name === "AbortError" });
  } finally {
    running.delete(id);
  }
};

const shutdown = () => {
  try {
    storage.flush();
  } finally {
    process.exit(0);
  }
};

readline.createInterface({ input: process.stdin }).on("line", (line) => void handle(line));
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => emit("log", { category: "crash", message: clean(reason?.message ?? reason) }));
emit("ready", { origin, dataRoot });
