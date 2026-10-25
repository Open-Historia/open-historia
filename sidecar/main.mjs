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
    return {
      activeGameId: clean(catalog?.activeGameId),
      games: list(catalog?.games).map((game) => ({
        id: clean(game?.id),
        name: clean(game?.name),
        scenarioName: clean(game?.scenarioName ?? game?.scenario?.name),
        country: clean(game?.country),
        gameDate: clean(game?.gameDate),
        updatedAt: clean(game?.updatedAt),
      })),
      scenarios: list(catalog?.scenarios).map((scenario) => ({ id: clean(scenario?.id), name: clean(scenario?.name) })),
    };
  },
  "game.create": async ({ scenarioId = "default", name = "" } = {}) => {
    const created = await api("/api/games", { method: "POST", body: { name: clean(name) || undefined, scenarioId, setActive: true } });
    await engine.refreshLibraryCatalog({ force: true });
    regionCache = { sha: "", features: [] };
    return { id: clean(created?.id ?? created?.game?.id) };
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
