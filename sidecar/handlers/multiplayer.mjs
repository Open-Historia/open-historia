import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAME_KEY = "oh:mp:name";
const NO_WEBRTC = "This device cannot make WebRTC connections.";
const DESKTOP_ONLY = "Only the desktop app can host a shared game.";
const HOSTING_HOLDS_THE_GAME = "This computer is hosting a shared game, and the game it hosts stays its open game. Stop sharing first.";
const ENGINE_FLAG = "OH_SHARED_GAME_ENGINE";
const GEMINI = "generativelanguage.googleapis.com";
const ENGINE_STOP_GRACE_MS = 120_000;
const VIEW_KEYS = new Set(["world", "game", "events", "chat", "actions", "intercepts", "colors", "flags"]);
const sidecarDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const rawUrlOf = (input) => (typeof input === "string" || input instanceof URL ? String(input) : String(input?.url ?? ""));

const routeOf = (input, init) => {
  const base = globalThis.location?.href;
  if (!base) return null;
  let url;
  try {
    url = new URL(rawUrlOf(input), base);
  } catch {
    return null;
  }
  if (url.origin !== globalThis.location.origin) return null;
  const method = String(init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input?.method : "") ?? "GET").toUpperCase() || "GET";
  return { pathname: url.pathname, method };
};

const bodyOf = (init) => {
  try {
    return typeof init?.body === "string" && init.body ? JSON.parse(init.body) : {};
  } catch {
    return {};
  }
};

const tell = (message) => {
  try {
    process.send?.(message);
  } catch {
    return;
  }
};

const runEngine = async ({ origin, storageFile, standIn, workers, days }) => {
  process.on("disconnect", () => process.exit(0));
  for (const method of ["log", "info", "debug"]) {
    console[method] = (...args) => process.stderr.write(`${util.format(...args)}\n`);
  }
  const { installShims } = await import(pathToFileURL(path.join(sidecarDir, "shims.js")).href);
  const { storage } = installShims({ origin, storageFile });
  const setItem = storage.setItem.bind(storage);
  const removeItem = storage.removeItem.bind(storage);
  storage.setItem = (key, value) => {
    setItem(key, value);
    tell({ type: "storage", key: String(key), value: String(value) });
  };
  storage.removeItem = (key) => {
    removeItem(key);
    tell({ type: "storage", key: String(key), value: null });
  };
  if (workers) {
    const { installWorkerShim } = await import(pathToFileURL(path.join(sidecarDir, "workers.js")).href);
    installWorkerShim({ origin });
  }
  let engine = null;
  if (standIn) {
    const { installStandInModel } = await import(pathToFileURL(path.join(sidecarDir, "standin.js")).href);
    let expected = { origin: "", target: "", country: "" };
    installStandInModel({ expected: () => expected });
    const standInFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = undefined) => {
      if (engine && rawUrlOf(input).includes(GEMINI)) {
        const bundle = await engine.readGameStateBundle({ force: true }).catch(() => null);
        const from = String(bundle?.game?.gameDate ?? "").trim();
        expected = { origin: from, target: from ? engine.jumpTargetDate(from, days) : "", country: String(bundle?.game?.country ?? "").trim() };
      }
      return standInFetch(input, init);
    };
  }
  const engineFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = undefined) => {
    const route = routeOf(input, init);
    if (route?.pathname === "/api/multiplayer/engine/close") {
      tell({ type: "close" });
      return json({ open: false });
    }
    if (route?.pathname === "/api/multiplayer/engine") return json({ supported: true, open: true });
    return engineFetch(input, init);
  };
  engine = await import(pathToFileURL(path.join(sidecarDir, "dist", "engine.mjs")).href);
  const loopback = new BroadcastChannel(engine.mpLoopback.LOOPBACK_CHANNEL);
  loopback.onmessage = (event) => tell({ type: "loopback", data: event.data });
  process.on("message", (message) => {
    if (message?.type === "loopback") loopback.postMessage(message.data);
  });
  await engine.mpLoadEngineMain();
  tell({ type: "ready" });
};

if (process.env[ENGINE_FLAG] && typeof process.send === "function") {
  try {
    await runEngine(JSON.parse(process.env[ENGINE_FLAG]));
  } catch (error) {
    tell({ type: "failed", message: String(error?.message ?? error) });
    process.stderr.write(`[shared game] the engine could not start: ${error?.stack ?? error}\n`);
    process.exit(1);
  }
}

export const register = (ctx) => {
  const { engine, emit, plain, storage, clean, list, api, dataRoot, gameView } = ctx;
  const shared = engine.mpShared;
  const progress = engine.mpJoin;
  const hostSettings = engine.mpSettings;
  const bridge = engine.mpBridge;

  const rememberedName = () => {
    try {
      return storage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  };
  const rememberName = (name) => {
    try {
      storage.setItem(NAME_KEY, String(name ?? ""));
    } catch {
      return;
    }
  };

  const webrtc = () => typeof globalThis.RTCPeerConnection === "function";

  let worker = null;
  let workerReady = null;
  let hostedGameId = "";
  let engineGame = false;
  let hostDays = 30;
  let retireTimer = null;

  const hostOpen = () => worker !== null;

  let bridgeChannel = null;

  const stopEngine = () => {
    const leaving = worker;
    worker = null;
    workerReady = null;
    hostedGameId = "";
    engineGame = false;
    clearTimeout(retireTimer);
    retireTimer = null;
    try {
      bridgeChannel?.close();
    } catch {
      bridgeChannel = null;
    }
    bridgeChannel = null;
    if (leaving && leaving.exitCode === null && !leaving.killed) {
      try {
        leaving.kill();
      } catch {
        return;
      }
    }
  };

  process.on("exit", () => {
    if (worker && worker.exitCode === null) {
      try {
        worker.kill();
      } catch {
        return;
      }
    }
  });

  const retireEngine = () => {
    if (!worker) return;
    if (!engineGame) {
      stopEngine();
      return;
    }
    clearTimeout(retireTimer);
    const leaving = worker;
    retireTimer = setTimeout(() => {
      if (worker === leaving) stopEngine();
    }, ENGINE_STOP_GRACE_MS);
    retireTimer.unref?.();
  };

  const storageSnapshot = () => {
    const items = {};
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null || key === undefined) continue;
      const value = storage.getItem(key);
      if (value !== null && value !== undefined) items[key] = value;
    }
    return items;
  };

  const startEngine = () => {
    if (worker) return workerReady;
    engine.mpIdentity.loadDeviceIdentity(storage);
    const dir = path.join(dataRoot, "native", "shared-game-engine");
    const storageFile = path.join(dir, "local-storage.json");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${storageFile}.tmp`, JSON.stringify(storageSnapshot()));
    fs.renameSync(`${storageFile}.tmp`, storageFile);
    hostedGameId = clean(engine.getLibraryState()?.activeGameId);
    engineGame = false;
    const config = {
      origin: globalThis.location.origin,
      storageFile,
      standIn: ctx.standIn === true,
      workers: process.env.OH_NATIVE_WORKERS !== "0",
      days: hostDays,
    };
    const started = fork(fileURLToPath(import.meta.url), [], {
      cwd: sidecarDir,
      execArgv: [],
      env: { ...process.env, [ENGINE_FLAG]: JSON.stringify(config) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "advanced",
      windowsHide: true,
    });
    worker = started;
    started.stdout.on("data", (chunk) => process.stderr.write(chunk));
    started.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const channel = new BroadcastChannel(engine.mpLoopback.LOOPBACK_CHANNEL);
    bridgeChannel = channel;
    channel.onmessage = (event) => {
      if (worker !== started || !started.connected) return;
      try {
        started.send({ type: "loopback", data: event.data });
      } catch {
        return;
      }
    };
    workerReady = new Promise((resolve, reject) => {
      started.on("message", (message) => {
        if (message?.type === "ready") resolve();
        else if (message?.type === "failed") reject(new Error(clean(message.message) || "The engine window did not open."));
        else if (worker !== started) return;
        else if (message?.type === "loopback") channel.postMessage(message.data);
        else if (message?.type === "storage") {
          if (message.value === null) storage.removeItem(message.key);
          else storage.setItem(message.key, message.value);
        } else if (message?.type === "close") stopEngine();
      });
      started.on("error", (error) => {
        process.stderr.write(`[sidecar] the shared game's engine stopped: ${error?.stack ?? error}\n`);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      started.on("exit", (code) => {
        reject(new Error("The engine window did not open."));
        if (worker === started) {
          process.stderr.write(`[sidecar] the shared game's engine exited (${code}).\n`);
          stopEngine();
        }
      });
    });
    workerReady.catch(() => {});
    return workerReady;
  };

  const holdRefusal = (pathname, method, init) => {
    if (!hostOpen() || !hostedGameId) return false;
    const match = /^\/api\/games\/([^/]+)$/.exec(pathname);
    if (pathname === "/api/games/active" && method === "PUT") return clean(bodyOf(init).gameId) !== hostedGameId;
    if (pathname === "/api/games" && method === "POST") return Boolean(bodyOf(init).setActive);
    if (!match) return false;
    const gameId = decodeURIComponent(match[1]);
    if (method === "PUT") return Boolean(bodyOf(init).setActive) && gameId !== hostedGameId;
    if (method === "DELETE") return gameId === hostedGameId;
    return false;
  };

  const withSharedEntry = async (response) => {
    if (!response.ok || !bridge.inSharedGame()) return response;
    const library = engine.getLibraryState();
    const id = clean(library?.activeGameId);
    const entry = list(library?.games).find((game) => clean(game?.id) === id);
    if (!entry) return response;
    let catalog;
    try {
      catalog = await response.clone().json();
    } catch {
      return response;
    }
    if (!Array.isArray(catalog?.games)) return response;
    let changed = false;
    catalog.games = catalog.games.map((game) => {
      if (clean(game?.id) !== id) return game;
      const currentDate = entry.currentDate || game.currentDate;
      if (game.country === entry.country && game.currentDate === currentDate) return game;
      changed = true;
      return { ...game, country: entry.country, currentDate };
    });
    if (!changed) return response;
    return new Response(JSON.stringify(catalog), { status: response.status, statusText: response.statusText, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };

  const pageFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = undefined) => {
    const route = routeOf(input, init);
    if (route) {
      const { pathname, method } = route;
      if (pathname === "/api/library" && method === "GET") return withSharedEntry(await pageFetch(input, init));
      if (pathname === "/api/multiplayer/engine") return json(webrtc() ? { supported: true, open: hostOpen() } : { supported: false });
      if (pathname === "/api/multiplayer/engine/open" && method === "POST") {
        if (!webrtc()) return json({ error: DESKTOP_ONLY }, 404);
        try {
          await startEngine();
          return json({ open: true });
        } catch (error) {
          stopEngine();
          return json({ error: clean(error?.message ?? error) || "The engine window did not open." }, 500);
        }
      }
      if (pathname === "/api/multiplayer/engine/close" && method === "POST") {
        if (!webrtc()) return json({ error: DESKTOP_ONLY }, 404);
        stopEngine();
        return json({ open: false });
      }
      if (holdRefusal(pathname, method, init)) return json({ error: HOSTING_HOLDS_THE_GAME }, 400);
    }
    return pageFetch(input, init);
  };
  engine.mpRemote.installRemoteRuntime();

  let viewReady = false;

  const hostEngine = async () => {
    try {
      const answer = await api("/api/multiplayer/engine");
      return Boolean(answer?.supported);
    } catch {
      return false;
    }
  };

  const sharedView = (state = shared.getSharedGame()) => {
    const lobby = state?.lobby ?? null;
    const me = list(lobby?.seats).find((seat) => seat?.you && seat?.status !== "ai")?.country ?? "";
    return {
      ...plain(state),
      me,
      active: bridge.inSharedGame(),
      viewReady: viewReady && bridge.inSharedGame(),
      stage: lobby ? "" : progress.joinStage(state ?? {}),
      people: state?.role === "host" ? plain(progress.hostLines(state?.engine)) : [],
      ownMapNote: progress.OWN_MAP_NOTE,
      remainingMs: Number(shared.sharedRemainingMs()) || 0,
    };
  };

  let toldRevealed = "";

  shared.subscribeSharedGame((state) => {
    if (state?.role === "host" && state?.engine) engineGame = Boolean(state.engine.open);
    if (state?.mode === "off") {
      viewReady = false;
      toldRevealed = "";
    }
    emit("multiplayer.shared", sharedView(state));
  });

  const tellHostRevealed = async () => {
    if (!bridge.inSharedGame()) return false;
    const [world, events] = await Promise.all([
      engine.gameState.readWorldStateView({ force: true }),
      engine.gameState.readEventsState({ force: true }),
    ]);
    const entry = list(world?.simulationHistory)[0];
    if (!entry) return false;
    const id = clean(engine.turnReveal.turnRecordId(entry, 0));
    if (!id || id === toldRevealed) return false;
    const known = new Set(list(events).map((event) => event?.id).filter(Boolean));
    const ids = list(entry.eventIds).filter((eventId) => known.has(eventId));
    if (engine.unseenEvents.unseenEvents.unseenInTurn(ids).size > 0) return false;
    toldRevealed = id;
    const round = Number(entry.round) || 0;
    void shared.sharedRequest("revealed", { round });
    emit("multiplayer.revealed", { round, turn: id });
    return true;
  };

  let viewTimer = null;
  let viewKeys = new Set();
  const viewChanged = (key) => {
    if (!bridge.inSharedGame() || !VIEW_KEYS.has(key)) return;
    viewKeys.add(key);
    if (!viewReady && key === "game") {
      viewReady = true;
      emit("multiplayer.shared", sharedView());
    }
    if (viewTimer) return;
    viewTimer = setTimeout(async () => {
      viewTimer = null;
      const keys = [...viewKeys];
      viewKeys = new Set();
      if (!bridge.inSharedGame()) return;
      const view = await gameView().catch(() => null);
      if (view) emit("multiplayer.view", { keys, view });
    }, 150);
  };
  globalThis.addEventListener("oh:runtime-json-updated", (event) => viewChanged(clean(event?.detail?.key)));
  globalThis.addEventListener("oh:game-updated", () => viewChanged("game"));
  globalThis.addEventListener("oh:world-updated", () => viewChanged("world"));
  globalThis.addEventListener(bridge.SHARED_ROUND_LANDED, (event) => {
    const detail = event?.detail ?? {};
    void gameView().catch(() => null).then((view) => emit("multiplayer.round", {
      round: Number(detail.round) || 0,
      events: Number(detail.events) || 0,
      view,
    }));
  });

  const activeGameView = () => {
    const game = engine.getLibraryState()?.activeGame ?? null;
    return game ? { id: clean(game.id), name: String(game.name ?? "") } : null;
  };

  return {
    "multiplayer.state": async () => {
      await engine.refreshLibraryCatalog({ force: true }).catch(() => {});
      return {
        webrtc: webrtc(),
        hostEngine: await hostEngine(),
        name: rememberedName(),
        activeGame: activeGameView(),
        defaults: plain(hostSettings.DEFAULT_SETTINGS),
        maxSeats: hostSettings.MAX_SEATS,
        seatsNow: hostSettings.SEATS_AVAILABLE_NOW,
        publicServer: engine.mpPublic.configuredServer(),
        shared: sharedView(),
      };
    },
    "multiplayer.active": async () => ({ active: bridge.inSharedGame(), role: bridge.sharedGameRole(), viewReady: viewReady && bridge.inSharedGame() }),
    "multiplayer.revealed": async () => ({ told: await tellHostRevealed().catch(() => false) }),
    "multiplayer.join": async ({ token = "", name = "" } = {}) => {
      if (!webrtc()) throw new Error(NO_WEBRTC);
      rememberName(name);
      await shared.joinSharedGame({ token: String(token), name: clean(name) || "Player" });
      return sharedView();
    },
    "multiplayer.host": async ({ settings = {}, name = "" } = {}) => {
      if (!webrtc()) throw new Error(NO_WEBRTC);
      rememberName(name);
      const checked = hostSettings.normalizeSettings(settings ?? {});
      hostDays = checked.ok ? Number(checked.settings.daysPerRound) || 30 : 30;
      try {
        await shared.hostSharedGame({ settings, name: clean(name) || "Host" });
      } catch (error) {
        retireEngine();
        throw error;
      }
      const view = sharedView();
      emit("multiplayer.shared", view);
      return view;
    },
    "multiplayer.request": async ({ t = "", fields = {}, timeoutMs = 0 } = {}) => plain(await shared.sharedRequest(
      String(t),
      fields ?? {},
      Number(timeoutMs) > 0 ? { timeoutMs: Number(timeoutMs) } : {},
    )),
    "multiplayer.control": async ({ action = "", args = null } = {}) => {
      shared.hostControl(String(action), args);
      return true;
    },
    "multiplayer.remaining": async () => Number(shared.sharedRemainingMs()) || 0,
    "multiplayer.leave": async () => {
      const hosting = shared.getSharedGame()?.role === "host";
      await shared.leaveSharedGame();
      if (hosting) retireEngine();
      return sharedView();
    },
  };
};
