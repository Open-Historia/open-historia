import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import util from "node:util";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installShims } from "./shims.js";
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
  workerData: { repo, dataDir, assetsDir, channel: process.env.OH_CHANNEL || "native", port, discord: false },
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
let expectedJump = { origin: "", target: "", country: "" };
if (process.env.OH_STANDIN_MODEL === "1") {
  installStandInModel({ expected: () => expectedJump });
  storage.setItem("api_provider", "gemini");
  storage.setItem("gemini_api_key", "stand-in");
}

const enginePath = path.join(here, "dist", "engine.mjs");
const engine = await import(pathToFileURL(enginePath).href);
engine.setDebugLogPersistence(false);
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

const mapState = async () => {
  if (!regionCache.sha) await loadRegions();
  const bundle = await engine.readGameStateBundle({ force: true });
  const world = bundle.world ?? {};
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
        scenarioName: scenarioName.get(clean(game?.scenarioId)) || clean(game?.heroTitle),
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
  presence: async ({ visible }) => {
    setVisible(visible !== false);
    return true;
  },
  cancel: async ({ call }) => {
    running.get(Number(call))?.abort();
    return true;
  },
};

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
    send({ id, ok: false, error: clean(error?.message ?? error) || "Something went wrong." });
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
