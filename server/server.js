/*! Open Historia — portions (CORS, AI relay, shutdown endpoint, hub proxy) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import crypto from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import url from "url";
import {
  createGame,
  createScenario,
  deleteGame,
  deleteScenario,
  ensureGameStore,
  ensureScenarioStore,
  exportScenarioBundle,
  getGameCatalog,
  getGameDetails,
  getLibraryCatalog,
  getScenarioCatalog,
  getScenarioDetails,
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
} from "./libraryStore.js";
import {
  createMapEditorDocument,
  deleteMapEditorDocument,
  ensureMapEditorStore,
  getMapEditorCatalog,
  getMapEditorDocument,
  updateMapEditorDocument,
} from "./mapEditorStore.js";
import {
  createBasemap,
  deleteBasemap,
  ensureBasemapStore,
  getBasemapCatalog,
  getBasemapPayload,
} from "./basemapStore.js";
import { listFlags, createFlag, deleteFlag } from "./flagStore.js";
import {
  allowedCorsOrigin,
  crossOriginWriteAllowed,
  isAllowedHubUrl,
  isLoopbackAddress,
  parseByteRange,
  relayTargetAllowed,
  sanitizeRelayHeaders,
} from "./security.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
import { DATA_DIR } from "./dataDir.js";
const app = express();
const PORT = process.env.PORT || 3000;
const distDir = path.join(__dirname, "../dist");

// WHERE THIS LISTENS is the real access control. Every /api route is
// unauthenticated by design — it is a personal game server, and the app has no
// login — so anyone who can open a socket to it can read, overwrite and delete
// every game and scenario. The cross-origin guard below cannot change that: it
// keeps a *browser* on another site out, but a non-browser client just sends a
// matching Origin header (see server/security.js).
//
// So this used to be `app.listen(PORT)`, which binds every interface: on a café
// or dorm network, every device on it had full control of the player's saves.
// Now it binds loopback unless the player asks for LAN play — which they need
// for the Android client and for "play from another room", so asking has to be
// easy. Three ways, in precedence order:
//
//   1. OH_HOST, for headless boxes, Termux and anyone scripting it:
//        OH_HOST=0.0.0.0 node server/server.js     # any device on the network
//        OH_HOST=192.168.1.9 node server/server.js # one interface only
//      When set it WINS and pins the setting — the in-game toggle reports that
//      the environment owns the decision rather than fighting it.
//   2. The in-game toggle (Settings → Network → "Let other devices connect"),
//      which persists to network-settings.json and rebinds the listener live —
//      no restart, no terminal. This is what the desktop app uses, where an
//      environment variable is not a thing a player can set.
//   3. Neither: loopback. The desktop app, Termux on the same phone and a
//      browser on the same machine all arrive over loopback, so the default
//      costs them nothing.
const NETWORK_SETTINGS_FILE = path.join(DATA_DIR, "network-settings.json");
const LOOPBACK_HOST = "127.0.0.1";
const ALL_INTERFACES_HOST = "0.0.0.0";

const isLanHost = (host) => host !== LOOPBACK_HOST && host !== "localhost" && host !== "::1";

const readNetworkSettings = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(NETWORK_SETTINGS_FILE, "utf8"));
    return { lanAccess: parsed?.lanAccess === true };
  } catch {
    return { lanAccess: false };
  }
};

const writeNetworkSettings = (settings) => {
  fs.mkdirSync(path.dirname(NETWORK_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(NETWORK_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
};

// Set = the environment decides and the toggle is read-only.
const HOST_FROM_ENV = process.env.OH_HOST || "";
let HOST = HOST_FROM_ENV || (readNetworkSettings().lanAccess ? ALL_INTERFACES_HOST : LOOPBACK_HOST);
let LAN_ENABLED = isLanHost(HOST);

// The addresses a phone or another computer would actually type in. Doing this
// here is the difference between "enable LAN play" being a setting and being a
// chore: the player never has to go and find their own IP.
const lanAddresses = () =>
  Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => ({ interface: name, url: `http://${address.address}:${PORT}` })),
  );

// Body limits. These used to be 2048mb, which let a single request exhaust the
// process's memory before any handler ran. The real ceiling is a scenario bundle
// with an embedded basemap; the hub caps those at 200 MB (HUB_MAX_BUNDLE_BYTES),
// so 512 MB leaves room for a hand-built import several times that size while
// still refusing a body that exists only to OOM the server.
const jsonParser = express.json({ limit: "64mb" });
const largeJsonParser = express.json({ limit: "512mb" });
const uploadParser = express.raw({ type: () => true, limit: "512mb" });

// The Android app's connect screen lives on the WebView's own origin, so its
// probe of this server is a cross-origin request — without these headers the
// phone blocks it (CORS) and the app can never connect.
//
// This was `Access-Control-Allow-Origin: *`, on the reasoning that the API is
// open to whoever can reach it anyway so a blanket allow changes nothing. That
// holds for someone already on the network; it does NOT hold for a random
// website. Reads are "safe methods", so the write guard below never sees them —
// with `*`, any page in any tab could fetch /api/games off the player's own
// machine and read the response. An allowlist keeps the phone working and puts
// the same-origin policy back in front of everyone else.
app.use((req, res, next) => {
  const corsOrigin = allowedCorsOrigin(req.headers.origin, req.headers.host, {
    allowAll: process.env.OH_ALLOW_CROSS_ORIGIN === "1",
  });
  // Vary regardless of the outcome: the answer depends on the request's Origin,
  // so a cache must not reuse one origin's response for another.
  res.setHeader("Vary", "Origin");
  if (corsOrigin) res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // PMTiles range reads are cross-origin from the phone shell. Range is
  // CORS-safelisted so 206s work, but pmtiles' recovery path for a very small
  // archive reads Content-Range off a 416 — and a non-exposed header reads as
  // absent, which it reports as a hard error.
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  // Chrome's Private Network Access preflights loopback/LAN targets and
  // requires this opt-in on top of regular CORS. Only worth sending to an origin
  // we are already answering — offering it to everyone advertises a localhost
  // service to any page that cares to look.
  if (corsOrigin) res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Per-IP fixed-window rate limit for requests that arrive over the network, the
// same shape the content node already uses. Loopback is exempt: the game itself
// polls runtime state briskly and it is not the traffic this is here for. Only
// meaningful when OH_HOST opens the server up at all, which is exactly when an
// unauthenticated API benefits from a ceiling on how fast it can be hammered.
const RATE_LIMIT_PER_MIN = Number(process.env.OH_RATE_LIMIT) || 1200;
const rateHits = new Map();
const rateTimer = setInterval(() => rateHits.clear(), 60000);
if (typeof rateTimer.unref === "function") rateTimer.unref();

app.use((req, res, next) => {
  const address = req.socket?.remoteAddress;
  if (isLoopbackAddress(address)) return next();
  const count = (rateHits.get(address) || 0) + 1;
  rateHits.set(address, count);
  if (count > RATE_LIMIT_PER_MIN) {
    res.setHeader("Retry-After", "60");
    return sendError(res, 429, new Error("Too many requests — slow down."));
  }
  next();
});

ensureScenarioStore();
ensureGameStore();
ensureMapEditorStore();
ensureBasemapStore();

const sendError = (res, statusCode, error) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(statusCode).json({ error: message });
};

// Block cross-origin state-changing requests (CSRF / drive-by protection).
// The CORS allowlist above lets the Android connect screen (on the WebView's own
// origin) *probe* this server — a GET. Without this guard, any web page the
// player happens to be visiting could also POST/PUT/DELETE to localhost: delete
// saved maps and games, drive the AI relay, or hit /api/server/shutdown. The app
// serves its own SPA, so real gameplay writes are same-origin (Origin host ===
// Host); no-Origin writes are trusted only from loopback.
//
// This stops browsers, which is what CSRF is. It does NOT stop a non-browser
// client on the network, which sets Origin and Host itself — that is what the
// loopback default is for, not this. Set OH_ALLOW_CROSS_ORIGIN=1 to
// restore the old fully-open behavior (this guard off, CORS back to `*`).
const ALLOW_CROSS_ORIGIN_WRITES = process.env.OH_ALLOW_CROSS_ORIGIN === "1";
app.use((req, res, next) => {
  const decision = crossOriginWriteAllowed({
    method: req.method,
    origin: req.headers.origin,
    host: req.headers.host,
    remoteAddress: req.socket?.remoteAddress,
    allowAll: ALLOW_CROSS_ORIGIN_WRITES,
  });
  if (decision.allowed) {
    return next();
  }
  return sendError(
    res,
    403,
    new Error("Cross-origin write blocked. Set OH_ALLOW_CROSS_ORIGIN=1 on the server to allow it."),
  );
});

const streamBinaryFile = (req, res, sourcePath, contentType = "application/octet-stream") => {
  const stats = fs.statSync(sourcePath);
  const totalSize = stats.size;
  const rangeHeader = req.headers.range;

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");

  if (!rangeHeader) {
    res.setHeader("Content-Length", totalSize);
    fs.createReadStream(sourcePath).pipe(res);
    return;
  }

  const range = parseByteRange(rangeHeader, totalSize);
  if (range.status === 416) {
    res.status(416).setHeader("Content-Range", `bytes */${totalSize}`).end();
    return;
  }
  const { start: clampedStart, end: clampedEnd } = range;

  res.status(206);
  res.setHeader("Content-Length", clampedEnd - clampedStart + 1);
  res.setHeader("Content-Range", `bytes ${clampedStart}-${clampedEnd}/${totalSize}`);
  fs.createReadStream(sourcePath, { end: clampedEnd, start: clampedStart }).pipe(res);
};

// Global client preferences (currently the UI language) shared by every
// device that plays through this server — the phone app and desktop browser
// see the same choice, instead of each browser keeping its own.
const uiSettingsFile = path.join(DATA_DIR, "ui-settings.json");

const readUiSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(uiSettingsFile, "utf8"));
  } catch {
    return {};
  }
};

app.get("/api/ui-settings", (_req, res) => {
  res.json(readUiSettings());
});

// Language packs. Two layers merge:
//  - shipped packs (public/lang/<code>.json, arrive with updates) seed the
//    top languages so common strings never need an AI call;
//  - saved packs (server/data/lang/<code>.json) accumulate every translation
//    generated at runtime. They live under server/data, which the update
//    script never touches, so they survive updates. Saved entries win.
const shippedLangDir = fs.existsSync(path.join(distDir, "lang"))
  ? path.join(distDir, "lang")
  : path.join(__dirname, "../public/lang");
const savedLangDir = path.join(DATA_DIR, "lang");

const isLangCode = (code) => /^[a-z]{2,3}$/.test(code);

const readLangPack = (dir, code) => {
  // `code` arrives from the :code route param and is interpolated into a
  // filename below. The route handlers check it too, but this is the function
  // that actually touches the path, so it rejects anything that is not a bare
  // language code rather than trusting every future caller to have done so.
  if (!isLangCode(code)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

app.get("/api/lang/:code", (req, res) => {
  const code = String(req.params.code || "").toLowerCase();
  if (!isLangCode(code)) {
    return sendError(res, 400, "Invalid language code.");
  }
  res.json({ ...readLangPack(shippedLangDir, code), ...readLangPack(savedLangDir, code) });
});

app.put("/api/lang/:code", largeJsonParser, (req, res) => {
  try {
    const code = String(req.params.code || "").toLowerCase();
    if (!isLangCode(code)) {
      return sendError(res, 400, "Invalid language code.");
    }
    const entries = req.body?.entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return sendError(res, 400, "Body must be { entries: { source: translation } }.");
    }
    const saved = readLangPack(savedLangDir, code);
    let added = 0;
    for (const [source, translated] of Object.entries(entries)) {
      if (typeof source === "string" && typeof translated === "string" &&
          source.length <= 3000 && translated.length <= 6000) {
        if (saved[source] !== translated) {
          saved[source] = translated;
          added += 1;
        }
      }
    }
    if (added > 0) {
      fs.mkdirSync(savedLangDir, { recursive: true });
      fs.writeFileSync(path.join(savedLangDir, `${code}.json`), JSON.stringify(saved));
    }
    res.json({ saved: added, total: Object.keys(saved).length });
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.put("/api/ui-settings", jsonParser, (req, res) => {
  try {
    const next = { ...readUiSettings() };
    if (typeof req.body?.language === "string" && req.body.language.trim().length <= 16) {
      next.language = req.body.language.trim();
    }
    fs.mkdirSync(path.dirname(uiSettingsFile), { recursive: true });
    fs.writeFileSync(uiSettingsFile, JSON.stringify(next, null, 2));
    res.json(next);
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.get("/api/scenarios", (_req, res) => {
  try {
    res.json(getScenarioCatalog());
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.get("/api/library", (_req, res) => {
  try {
    res.json(getLibraryCatalog());
  } catch (error) {
    sendError(res, 500, error);
  }
});

// Native-app update check. The app polls THIS instead of hitting GitHub directly:
// the game runs at the embedded-server origin, so a client-side fetch to a GitHub
// release asset is CORS-blocked — and doing it here lets us cache the lookup so
// thousands of clients polling don't each hit GitHub. We read the tiny latest.json
// release asset (a CDN download, not the rate-limited REST API) for the app's track.
const APP_UPDATE_MANIFESTS = {
  stable: "https://github.com/Open-Historia/open-historia/releases/download/android/latest.json",
  beta: "https://github.com/Open-Historia/open-historia/releases/download/android-beta/latest.json",
  // The desktop app checks through here rather than from the page: a release asset
  // sends no CORS headers, and the GitHub API is rate limited per IP. Exactly the
  // reason the Android tracks are served this way.
  //
  // OH_DESKTOP_UPDATE_URL lets the desktop shell point this at its OWN release
  // instead (electron/main.cjs sets it for the beta/fork build). Without it a
  // fork's testers would be offered the upstream installer as an "update" and
  // quietly leave the build they signed up to test.
  desktop:
    process.env.OH_DESKTOP_UPDATE_URL ||
    "https://github.com/Open-Historia/open-historia/releases/download/desktop-stable/latest.json",
};
// The desktop app imports this server into its Electron main process
// (electron/main.cjs startServer), so the updater living there is reachable
// straight through globalThis — no IPC, and no preload on the game window. It is
// absent everywhere else, which is what makes these routes inert in the zip build
// and on the website.
const desktopUpdater = () => globalThis.__ohAutoUpdate || null;

const APP_UPDATE_TTL_MS = 3 * 60 * 1000;
const appUpdateCache = new Map(); // track -> { at, data }

app.get("/api/app-update", async (req, res) => {
  const track = String(req.query.track || "stable");
  const manifestUrl = APP_UPDATE_MANIFESTS[track];
  if (!manifestUrl) {
    res.json({}); // unknown track -> no update info, never an error
    return;
  }
  const cached = appUpdateCache.get(track);
  if (cached && Date.now() - cached.at < APP_UPDATE_TTL_MS) {
    res.json(cached.data);
    return;
  }
  try {
    const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) {
      res.json(cached ? cached.data : {}); // stale-if-error, else empty
      return;
    }
    const raw = await response.json();
    const str = (value) => (typeof value === "string" ? value : "");
    const data = {
      build: Number(raw && raw.build) || 0,
      apk: str(raw && raw.apk),
      notes: str(raw && raw.notes),
      // Desktop ids are opaque strings (a CI run id), not the ascending integer the
      // Android tracks use, so they are kept as text and compared for INEQUALITY.
      buildId: String((raw && raw.build) ?? ""),
      // Set only when this server is the one running inside the desktop app. That is
      // how the page can tell it is there at all — it is otherwise an ordinary
      // localhost page — and it is absent everywhere else, so no banner appears.
      current: String(process.env.OH_DESKTOP_BUILD || ""),
      download: str(raw && raw[{ win32: "windows", darwin: "mac", linux: "linux" }[process.platform]]),
      // True when this app can install the update itself. False on a build that
      // cannot (unsigned macOS, an unpackaged dev run), and the banner then offers
      // the download link exactly as it did before.
      autoUpdate: Boolean(desktopUpdater()),
    };
    appUpdateCache.set(track, { at: Date.now(), data });
    res.json(data);
  } catch {
    res.json(cached ? cached.data : {}); // offline / timeout -> fail-open
  }
});

// FORK-ONLY — REMOVE BEFORE ANY UPSTREAM MERGE (with ForkBuildBadge.jsx and its
// mount in src/App.jsx). What the in-app beta badge reads. Answers {} for every
// build that is not the fork's desktop beta — the website, the APK, a dev run and
// the stable desktop app all set no OH_CHANNEL — so the badge renders nothing
// there and no other surface has to know this exists.
app.get("/api/fork-build", (_req, res) => {
  const channel = String(process.env.OH_CHANNEL || "stable");
  if (channel === "stable") {
    res.json({});
    return;
  }
  res.json({
    channel,
    build: String(process.env.OH_DESKTOP_BUILD || ""),
    feedback: String(process.env.OH_FORK_FEEDBACK_URL || ""),
  });
});

app.get("/api/app-update/status", (req, res) => {
  const updater = desktopUpdater();
  res.json(updater ? { supported: true, ...updater.status() } : { supported: false });
});

app.post("/api/app-update/download", (req, res) => {
  const updater = desktopUpdater();
  if (!updater) {
    res.status(404).json({ error: "This build cannot update itself." });
    return;
  }
  // Fire-and-forget: the download takes as long as it takes, and the page follows
  // it through /status rather than holding a request open for minutes.
  updater.download();
  res.json({ started: true });
});

app.post("/api/app-update/restart", (req, res) => {
  const updater = desktopUpdater();
  if (!updater) {
    res.status(404).json({ error: "This build cannot update itself." });
    return;
  }
  if (updater.status().state !== "ready") {
    res.status(409).json({ error: "No downloaded update is ready to install." });
    return;
  }
  res.json({ restarting: true });
  updater.restart();
});

app.get("/api/scenarios/:scenarioId", (req, res) => {
  try {
    res.json(getScenarioDetails(req.params.scenarioId));
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.post("/api/scenarios", jsonParser, (req, res) => {
  try {
    res.status(201).json(createScenario(req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.put("/api/scenarios/active", jsonParser, (req, res) => {
  try {
    res.json(setSelectedScenario(req.body?.scenarioId));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.put("/api/scenarios/selected", jsonParser, (req, res) => {
  try {
    res.json(setSelectedScenario(req.body?.scenarioId));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.put("/api/scenarios/:scenarioId", jsonParser, (req, res) => {
  try {
    res.json(updateScenario(req.params.scenarioId, req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/scenarios/:scenarioId/export", (req, res) => {
  try {
    const mode = req.query?.mode === "full" ? "full" : "light";
    res.json(exportScenarioBundle(req.params.scenarioId, { mode }));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.post("/api/scenarios/import", largeJsonParser, (req, res) => {
  try {
    res.status(201).json(importScenarioBundle(req.body ?? {}, { setSelected: true }));
  } catch (error) {
    sendError(res, 400, error);
  }
});

// Replace an existing scenario's content with a fresh bundle — the community
// hub's "Update" button for scenarios imported unmodified from a post.
app.put("/api/scenarios/:scenarioId/import", largeJsonParser, (req, res) => {
  try {
    res.json(updateScenarioFromBundle(req.params.scenarioId, req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/scenarios/:scenarioId/assets/:assetKey", (req, res) => {
  try {
    const asset = resolveScenarioUploadAsset(req.params.scenarioId, req.params.assetKey);
    streamBinaryFile(req, res, asset.sourcePath, asset.contentType);
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.put("/api/scenarios/:scenarioId/assets/:assetKey", uploadParser, (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body ?? "");
    res.json(
      uploadScenarioAsset(
        req.params.scenarioId,
        req.params.assetKey,
        buffer,
        req.headers["content-type"],
      ),
    );
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/games", (_req, res) => {
  try {
    res.json(getGameCatalog());
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.get("/api/games/:gameId", (req, res) => {
  try {
    res.json(getGameDetails(req.params.gameId));
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.post("/api/games", jsonParser, (req, res) => {
  try {
    res.status(201).json(createGame(req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.put("/api/games/active", jsonParser, (req, res) => {
  try {
    res.json(setActiveGame(req.body?.gameId));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.put("/api/games/:gameId", jsonParser, (req, res) => {
  try {
    res.json(updateGame(req.params.gameId, req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/games/:gameId/assets/:assetKey", (req, res) => {
  try {
    const asset = resolveGameUploadAsset(req.params.gameId, req.params.assetKey);
    streamBinaryFile(req, res, asset.sourcePath, asset.contentType);
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.put("/api/games/:gameId/assets/:assetKey", uploadParser, (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body ?? "");
    res.json(
      uploadGameAsset(
        req.params.gameId,
        req.params.assetKey,
        buffer,
        req.headers["content-type"],
      ),
    );
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.delete("/api/games/:gameId", (req, res) => {
  try {
    res.json(deleteGame(req.params.gameId));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.delete("/api/games/:gameId/assets/:assetKey", (req, res) => {
  try {
    res.json(removeGameAsset(req.params.gameId, req.params.assetKey));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.delete("/api/scenarios/:scenarioId/assets/:assetKey", (req, res) => {
  try {
    res.json(removeScenarioAsset(req.params.scenarioId, req.params.assetKey));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.delete("/api/scenarios/:scenarioId", (req, res) => {
  try {
    res.json(deleteScenario(req.params.scenarioId));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/runtime/json/:assetKey", (req, res) => {
  try {
    const asset = readRuntimeJsonAsset(req.params.assetKey);
    res.setHeader("Cache-Control", "no-store");
    res.type("application/json");
    res.send(JSON.stringify(asset.data));
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.put("/api/runtime/json/:assetKey", jsonParser, (req, res) => {
  try {
    // express.json() hands us {} when the body was absent or unparseable, which is
    // indistinguishable from a genuine {} — and for an object-shaped asset like
    // world or game, writing that blanks the save. A real PUT always carries a
    // body, so require one rather than letting `?? {}` erase a game.
    if (!Number(req.headers["content-length"])) {
      return sendError(res, 400, new Error(`Refusing to write ${req.params.assetKey}: the request had no body.`));
    }
    const asset = writeRuntimeJsonAsset(req.params.assetKey, req.body);
    res.setHeader("Cache-Control", "no-store");
    res.type("application/json");
    res.send(JSON.stringify(asset.data));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/runtime/pmtiles/:assetKey", (req, res) => {
  try {
    const asset = resolveRuntimeBinaryAsset(req.params.assetKey);
    streamBinaryFile(req, res, asset.sourcePath, asset.contentType);
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.head("/api/runtime/pmtiles/:assetKey", (req, res) => {
  try {
    const asset = resolveRuntimeBinaryAsset(req.params.assetKey);
    const stats = fs.statSync(asset.sourcePath);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end();
  } catch (error) {
    sendError(res, 404, error);
  }
});

// ---- Scenario Hub --------------------------------------------------------
// Downloads a scenario bundle from the community hub on the browser's behalf —
// GitHub file attachments don't send CORS headers, so the client can't fetch
// them directly. Locked to GitHub hosts; nothing else is proxied.
const HUB_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "user-images.githubusercontent.com",
  "user-attachments.githubusercontent.com",
]);
const HUB_MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

// This route echoes a file that ANY member of the public can attach to a hub
// issue, and it serves it from the game's OWN origin. Without these two headers a
// crafted post could be an .html (or a scripted .svg) and a link to
// /api/hub/file?url=... would execute it as same-origin script -- with reach into
// localStorage (the player's AI keys) and every /api/* route. nosniff stops the
// browser inferring a dangerous type; the attachment disposition stops it
// rendering one it was told about. Every real consumer reads this route with
// fetch(), which ignores both headers, so nothing legitimate changes.
const setHubFileGuards = (res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "attachment");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
};

// Browser AI calls to self-hosted OpenAI-compatible endpoints (llama.cpp,
// LM Studio, NVIDIA NIM...) die on CORS — those servers rarely send the
// headers. The game server relays them instead: same-origin for the browser,
// plain server-to-server for the endpoint. The target is whatever the player
// configured in Settings — them talking to their own AI through their own
// game server.
//
// Which also makes it, structurally, a request forwarder: caller-chosen URL,
// caller-chosen headers, response body handed back. It cannot refuse private
// addresses — a model on localhost or the LAN box is the entire point — so it is
// fenced in three other ways instead:
//   1. LOOPBACK ONLY by default. A relay reachable from the network is an open
//      proxy for everyone on it. The desktop app, Termux-on-the-same-phone and a
//      browser on the host all come from loopback and are unaffected; a phone
//      talking to a desktop needs OH_ALLOW_REMOTE_RELAY=1, which is a deliberate
//      "yes, proxy for my LAN" and is stated as such.
//   2. Cloud metadata endpoints refused (relayTargetAllowed) — never an AI
//      endpoint, always credentials.
//   3. Caller headers filtered, redirects not followed, response size and time
//      bounded, so it cannot be aimed at an internal service and used to walk a
//      redirect chain or stream something unbounded back.
const ALLOW_REMOTE_RELAY = process.env.OH_ALLOW_REMOTE_RELAY === "1";
const RELAY_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const RELAY_TIMEOUT_MS = Number(process.env.OH_RELAY_TIMEOUT_MS) || 600000;

app.post("/api/ai/relay", largeJsonParser, async (req, res) => {
  const controller = new AbortController();
  let completed = false;
  const abortUpstream = () => {
    if (!completed) controller.abort();
  };
  req.once("aborted", abortUpstream);
  res.once("close", abortUpstream);
  const timeout = setTimeout(abortUpstream, RELAY_TIMEOUT_MS);

  try {
    if (!ALLOW_REMOTE_RELAY && !isLoopbackAddress(req.socket?.remoteAddress)) {
      return sendError(
        res,
        403,
        new Error(
          "The AI relay only answers this machine. Set OH_ALLOW_REMOTE_RELAY=1 to let other "
            + "devices on your network relay AI calls through this server.",
        ),
      );
    }

    const { url: targetUrl, method = "POST", headers = {}, payload } = req.body ?? {};
    let target;
    try {
      target = new URL(String(targetUrl ?? ""));
    } catch {
      return sendError(res, 400, new Error("That AI endpoint is not a valid URL."));
    }
    const verdict = relayTargetAllowed(target);
    if (!verdict.allowed) {
      return sendError(res, 400, new Error(verdict.reason));
    }

    const upstream = await fetch(target, {
      method: method === "GET" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...sanitizeRelayHeaders(headers) },
      body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
      signal: controller.signal,
      // A 302 from the configured endpoint to somewhere else is not something an
      // AI backend does; following one would re-open the target check we just
      // passed. The status comes back as-is and the client can act on it.
      redirect: "manual",
    });

    // Read with a ceiling rather than buffering whatever the endpoint sends.
    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > RELAY_MAX_RESPONSE_BYTES) {
      return sendError(res, 502, new Error("The AI endpoint's response is too large to relay."));
    }
    const text = await upstream.text();
    if (Buffer.byteLength(text) > RELAY_MAX_RESPONSE_BYTES) {
      return sendError(res, 502, new Error("The AI endpoint's response is too large to relay."));
    }

    completed = true;
    res.status(upstream.status);
    res.type(upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (error) {
    if (!controller.signal.aborted && !res.headersSent) {
      sendError(res, 502, error);
    }
  } finally {
    clearTimeout(timeout);
  }
});

// --- LAN sharing, from the UI ---------------------------------------------
// Reading it is harmless (the page shows the toggle's state); the ADDRESSES are
// only handed to a caller on this machine, since they describe the host's other
// interfaces and a phone already knows the one it used.
app.get("/api/server/network", (req, res) => {
  const local = isLoopbackAddress(req.socket?.remoteAddress);
  res.json({
    lanEnabled: LAN_ENABLED,
    host: HOST,
    port: Number(PORT),
    lockedByEnv: Boolean(HOST_FROM_ENV),
    addresses: local ? lanAddresses() : [],
  });
});

// Turn LAN sharing on or off without restarting anything.
//
// Only this machine may call it: whether the server is reachable from the
// network is a decision for the person sitting at it, not for whoever is
// already on the network. (With LAN off there is nobody else to ask; with LAN
// on, the remote caller could otherwise switch it off under the owner.)
app.post("/api/server/network", jsonParser, (req, res) => {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return sendError(res, 403, new Error("Only the machine running the server can change this."));
  }
  if (HOST_FROM_ENV) {
    return sendError(
      res,
      409,
      new Error(`OH_HOST is set to "${HOST_FROM_ENV}", so it decides who can reach this server. Unset it to use this switch.`),
    );
  }

  const lanEnabled = req.body?.lanEnabled === true;
  const nextHost = lanEnabled ? ALL_INTERFACES_HOST : LOOPBACK_HOST;
  if (nextHost === HOST) {
    return res.json({ lanEnabled: LAN_ENABLED, host: HOST, port: Number(PORT), lockedByEnv: false, addresses: lanAddresses() });
  }

  try {
    writeNetworkSettings({ lanAccess: lanEnabled });
  } catch (error) {
    return sendError(res, 500, error);
  }

  // Answer BEFORE rebinding: the reply travels over a connection this is about
  // to drop. Loopback stays reachable either way (0.0.0.0 includes it), so the
  // page that flipped the switch keeps working — only devices on the network
  // gain or lose access.
  res.json({
    lanEnabled,
    host: nextHost,
    port: Number(PORT),
    lockedByEnv: false,
    addresses: lanEnabled ? lanAddresses() : [],
  });
  setTimeout(() => rebindListener(nextHost), 250);
});

// Shut the server down from the UI (the ⏻ button in the top bar) — handy on
// phones/Termux and headless installs where no terminal is in sight. Responds
// first so the client can show its "server stopped" screen, then exits.
//
// A remote kill switch on an API with no password is worth one extra condition:
// answer this machine always, and the network only when the player has already
// said LAN play is what they want (OH_HOST). Termux on the same phone and the
// desktop app both come from loopback, so the button keeps working where it was
// most needed.
app.post("/api/server/shutdown", (req, res) => {
  if (!LAN_ENABLED && !isLoopbackAddress(req.socket?.remoteAddress)) {
    return sendError(res, 403, new Error("Only this machine can shut the server down."));
  }
  res.json({ ok: true });
  console.log("Shutdown requested from the UI — exiting.");
  setTimeout(() => process.exit(0), 300);
});

// Cache fetched bundles on disk so re-importing the same scenario doesn't keep
// bumping its GitHub download count — the second import onward is served locally
// and never touches GitHub. Bundle URLs are immutable (a new version gets a new
// URL), so a cached copy can't go stale. Keyed on the requested URL.
const HUB_CACHE_DIR = path.join(DATA_DIR, "hub-cache");
const hubCachePaths = (fileUrl) => {
  const hash = crypto.createHash("sha256").update(fileUrl).digest("hex");
  return { body: path.join(HUB_CACHE_DIR, `${hash}.body`), type: path.join(HUB_CACHE_DIR, `${hash}.type`) };
};

app.get("/api/hub/file", async (req, res) => {
  try {
    const fileUrl = String(req.query.url ?? "");
    let current = new URL(fileUrl);
    if (!isAllowedHubUrl(current, HUB_DOWNLOAD_HOSTS)) {
      return sendError(res, 400, new Error("Only GitHub-hosted scenario files can be fetched."));
    }

    // Already fetched once? Serve the cached copy without touching GitHub, so a
    // re-import by the same person doesn't bump the scenario's download count.
    const cache = hubCachePaths(fileUrl);
    if (fs.existsSync(cache.body)) {
      let cachedType = "application/octet-stream";
      try { cachedType = fs.readFileSync(cache.type, "utf8") || cachedType; } catch { /* default */ }
      res.setHeader("Cache-Control", "no-store");
      setHubFileGuards(res);
      res.setHeader("Content-Type", cachedType);
      return fs.createReadStream(cache.body).pipe(res);
    }

    // Follow redirects manually so every hop is re-checked against the host
    // allowlist. `redirect: "follow"` would chase a github.com redirect to an
    // attacker-controlled host (SSRF); GitHub's own release redirect
    // (github.com -> objects.githubusercontent.com) stays inside the allowlist.
    let upstream;
    for (let hop = 0; ; hop += 1) {
      if (hop > 5) {
        return sendError(res, 502, new Error("Too many redirects fetching scenario file."));
      }
      upstream = await fetch(current, { redirect: "manual" });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get("location");
      if (!location) break;
      const next = new URL(location, current);
      if (!isAllowedHubUrl(next, HUB_DOWNLOAD_HOSTS)) {
        return sendError(res, 400, new Error("Scenario file redirected off GitHub."));
      }
      current = next;
    }
    if (!upstream.ok) {
      return sendError(res, 502, new Error(`Hub file fetch failed (HTTP ${upstream.status}).`));
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > HUB_MAX_BUNDLE_BYTES) {
      return sendError(res, 413, new Error("Scenario bundle is too large."));
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    // Cache for next time — best-effort; a cache write failure must not fail the
    // import. Temp file + rename so a concurrent serve never sees a half-written body.
    try {
      fs.mkdirSync(HUB_CACHE_DIR, { recursive: true });
      fs.writeFileSync(`${cache.body}.tmp`, buffer);
      fs.renameSync(`${cache.body}.tmp`, cache.body);
      fs.writeFileSync(cache.type, contentType);
    } catch (cacheError) {
      console.warn("[hub] cache write failed:", cacheError.message);
    }

    res.setHeader("Cache-Control", "no-store");
    setHubFileGuards(res);
    // Pass the upstream content type through untouched. JSON bundles still parse
    // via response.json() (which ignores the header), while binary bundles (.zip)
    // and raw basemap images (.png/.jpg) arrive byte-for-byte.
    res.setHeader("Content-Type", contentType);
    res.send(buffer);
  } catch (error) {
    sendError(res, 502, error);
  }
});

// Best-effort scenario-import telemetry. On a successful import the client pings
// here; we forward it to the self-hosted counter (a Cloudflare Worker — see
// tools/import-counter/) so the hub owner can see how many people imported each
// scenario, including attachment scenarios GitHub can't count. Deduped per
// install: only the FIRST successful import of a given bundle counts, so a
// re-import never inflates the number. Points at the hub's deployed counter
// Worker (tools/import-counter); OH_IMPORT_COUNTER_URL overrides it, and an
// empty value disables the ping entirely (silent no-op).
const IMPORT_COUNTER_URL = (
  process.env.OH_IMPORT_COUNTER_URL ?? "https://oh-import-counter.nichojkrol.workers.dev"
).replace(/\/+$/, "");
const IMPORT_PING_DIR = path.join(DATA_DIR, "import-pings");
app.post("/api/hub/import-log", jsonParser, (req, res) => {
  res.json({ ok: true }); // ack at once — telemetry must never delay or fail the import
  (async () => {
    try {
      const { url: fileUrl, id, title } = req.body ?? {};
      if (!IMPORT_COUNTER_URL || (id == null && !fileUrl)) return;
      // One ping per scenario per install, EVER. Key the marker on the scenario
      // id (its hub issue number) so re-importing — an updated version, or just
      // mashing the Import button — never counts twice. The marker is created
      // atomically (wx: fails if it already exists) so even racing requests
      // can't both slip a ping through.
      const markerKey = id != null ? `id:${id}` : `url:${fileUrl}`;
      const marker = path.join(IMPORT_PING_DIR, crypto.createHash("sha256").update(markerKey).digest("hex"));
      fs.mkdirSync(IMPORT_PING_DIR, { recursive: true });
      try {
        fs.writeFileSync(marker, markerKey, { flag: "wx" });
      } catch {
        return; // marker already exists — this scenario was counted on this install
      }
      await fetch(`${IMPORT_COUNTER_URL}/hit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: String(id ?? fileUrl).slice(0, 120), title: String(title ?? "").slice(0, 200) }),
      }).catch(() => {});
    } catch {
      // best-effort telemetry — swallow everything
    }
  })();
});

// Read the self-hosted import counts back for the Community tab. Proxied (not
// fetched from the Worker in the browser) so the client stays URL-agnostic and
// same-origin. Lightly cached so a hub refresh doesn't hammer the Worker.
let importCountsCache = { at: 0, data: null };
app.get("/api/hub/import-counts", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!IMPORT_COUNTER_URL) return res.json({});
  if (importCountsCache.data && Date.now() - importCountsCache.at < 60000) {
    return res.json(importCountsCache.data);
  }
  try {
    const upstream = await fetch(`${IMPORT_COUNTER_URL}/counts`);
    const data = upstream.ok ? await upstream.json() : {};
    importCountsCache = { at: Date.now(), data };
    res.json(data);
  } catch {
    res.json(importCountsCache.data || {});
  }
});

// ---- Map editor documents ------------------------------------------------
app.get("/api/mapeditor/documents", (_req, res) => {
  try {
    res.json(getMapEditorCatalog());
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.post("/api/mapeditor/documents", largeJsonParser, (req, res) => {
  try {
    res.status(201).json(createMapEditorDocument(req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/mapeditor/documents/:id", (req, res) => {
  try {
    res.json(getMapEditorDocument(req.params.id));
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.put("/api/mapeditor/documents/:id", largeJsonParser, (req, res) => {
  try {
    res.json(updateMapEditorDocument(req.params.id, req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.delete("/api/mapeditor/documents/:id", (req, res) => {
  try {
    res.json(deleteMapEditorDocument(req.params.id));
  } catch (error) {
    sendError(res, 400, error);
  }
});

// ---- Flag library ("My flags") -------------------------------------------
// Flags are small (a 256px PNG), so there's no payload split: the catalog IS the
// data. jsonParser, not largeJsonParser, for the same reason.
app.get("/api/flags", (_req, res) => {
  try {
    res.json(listFlags());
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.post("/api/flags", jsonParser, (req, res) => {
  try {
    res.status(201).json(createFlag(req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.delete("/api/flags/:id", (req, res) => {
  try {
    res.json(deleteFlag(req.params.id));
  } catch (error) {
    sendError(res, 400, error);
  }
});

// ---- Basemap library ("Your basemaps") -----------------------------------
app.get("/api/basemaps", (_req, res) => {
  try {
    res.json(getBasemapCatalog());
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.post("/api/basemaps", largeJsonParser, (req, res) => {
  try {
    res.status(201).json(createBasemap(req.body ?? {}));
  } catch (error) {
    sendError(res, 400, error);
  }
});

app.get("/api/basemaps/:id/payload", (req, res) => {
  try {
    res.json(getBasemapPayload(req.params.id));
  } catch (error) {
    sendError(res, 404, error);
  }
});

app.delete("/api/basemaps/:id", (req, res) => {
  try {
    res.json(deleteBasemap(req.params.id));
  } catch (error) {
    sendError(res, 400, error);
  }
});

// Vendored Fantasy Map Generator (Azgaar, MIT), built to ../fmg/dist by the
// updater (scripts/fetch-fmg.mjs) and served same-origin so the map editor's
// "Generate" console can run it in a hidden iframe and read its data. Present
// only after it's been vendored — otherwise /fmg 404s and the editor says so.
// Mounted before the SPA fallback so /fmg/* isn't swallowed by index.html.
const fmgDistDir = path.join(__dirname, "../fmg/dist");
if (fs.existsSync(fmgDistDir)) app.use("/fmg", express.static(fmgDistDir));

// FORK-ONLY — REMOVE BEFORE ANY UPSTREAM MERGE (with the beta-assets folder and
// the OH_BETA_ASSETS_DIR line in electron/main.cjs). Swaps the app's compass for
// the BETA-badged one everywhere the page asks for it — the library header, the
// startup screen, the window's favicon — so a screenshot from a tester is
// self-identifying. Serving them here rather than editing the artwork in public/
// keeps ONE set of source assets and one client bundle: an unstamped build asks
// for the same URLs and gets the originals from dist.
//
// Registered before the static mount, which is what makes it a replacement rather
// than an addition.
const betaAssetsDir = process.env.OH_BETA_ASSETS_DIR;
if (betaAssetsDir) {
  const betaBranding = {
    "/logo.png": "logo-beta.png",
    "/icon-192.png": "icon-192-beta.png",
    "/icon-512.png": "icon-beta.png",
  };
  for (const [route, file] of Object.entries(betaBranding)) {
    const replacement = path.join(betaAssetsDir, file);
    // Checked once at startup: a missing file must fall through to the real asset,
    // not 500 the favicon on every page load.
    if (!fs.existsSync(replacement)) continue;
    app.get(route, (_req, res) => res.sendFile(replacement));
  }
}

app.use(express.static(distDir));

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const describeBinding = () => {
  if (LAN_ENABLED) {
    console.log(`Reachable from your network on ${HOST}:${PORT}. This API has no password:`);
    console.log("anyone who can reach that address can read, change and delete your games.");
    for (const { url } of lanAddresses()) console.log(`  ${url}`);
    console.log(
      HOST_FROM_ENV
        ? "Unset OH_HOST to go back to this machine only."
        : "Turn it off in Settings → Network, or unset it there when you're done.",
    );
  } else {
    console.log("Listening on 127.0.0.1 only (this machine).");
    console.log(
      HOST_FROM_ENV
        ? "OH_HOST pins this. Set OH_HOST=0.0.0.0 to let other devices connect."
        : "To play from your phone or another device, turn on Settings → Network → \"Let other devices connect\".",
    );
  }
};

// Exported so a test can shut the listener down; nothing else imports it (the
// app and the launchers import this module purely for its side effects).
export const httpServer = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  describeBinding();
});

// Move the listener to a different interface in place, so the LAN toggle takes
// effect immediately instead of asking the player to restart a game they are in
// the middle of. Node lets a closed server listen() again; if the new bind
// fails (something else already holds the port on that interface) we go back to
// the one that was working rather than leaving the player with no server.
// True while a LAN-toggle rebind is in flight. The startup error handler below
// must stand aside for it: that handler exits the process on EADDRINUSE, it was
// registered first, and Node runs "error" listeners in REGISTRATION ORDER — so
// without this flag it fired before the recovery handler here ever ran, and a
// rebind that could not take the new interface killed the game server out from
// under a player mid-campaign instead of falling back to the interface that was
// working. The rollback below was unreachable code.
let rebinding = false;

const rebindListener = (nextHost) => {
  const previousHost = HOST;

  // Registered explicitly rather than passed to listen() as its callback, because
  // a callback handed to listen() becomes a one-shot "listening" listener the
  // moment listen() is called and a FAILED bind does not take it back off. It
  // then fired on the fallback bind below, and the server reported itself
  // shared — host 0.0.0.0, lanEnabled true — while the socket was actually back
  // on loopback. The Settings panel and the addresses it tells the player to
  // type into their phone were both wrong, with nothing listening on them.
  const onListening = () => {
    httpServer.removeListener("error", onError);
    HOST = nextHost;
    LAN_ENABLED = isLanHost(HOST);
    rebinding = false;
    console.log(`Rebound to ${HOST}:${PORT}.`);
    describeBinding();
  };

  const onError = (error) => {
    console.error(`Could not rebind to ${nextHost}:${PORT} (${error.message}); staying on ${previousHost}.`);
    httpServer.removeListener("listening", onListening);
    httpServer.removeListener("error", onError);
    HOST = previousHost;
    LAN_ENABLED = isLanHost(HOST);
    try {
      writeNetworkSettings({ lanAccess: LAN_ENABLED });
    } catch { /* the binding is what matters; the file is a hint for next boot */ }
    // Cleared BEFORE the fallback bind, deliberately. If even the interface that
    // was working a moment ago will not take the port there is nothing left to
    // fall back to, and the fatal handler below saying so beats leaving a live
    // process with no listener on it at all.
    rebinding = false;
    httpServer.listen(PORT, previousHost);
  };

  rebinding = true;
  // Keep-alive connections would hold close() open indefinitely, and one of them
  // is the page that just flipped the switch.
  httpServer.closeAllConnections?.();
  httpServer.close(() => {
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(PORT, nextHost);
  });
};

// A taken port used to crash with a raw EADDRINUSE stack, which the launchers
// then reported as a bare "Server stopped." — say what actually happened.
//
// Startup only. A failure during a rebind is rebindListener's to recover from,
// and exiting there would turn "that interface is busy" into "your game server is
// gone"; the listener it registers puts the previous binding back instead.
httpServer.on("error", (error) => {
  if (rebinding) return;
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — Open Historia is probably already running.`);
    console.error("Close the other instance (the ⏻ button in the game stops it), or set the");
    console.error(`PORT environment variable to run this one on a different port.`);
    process.exit(1);
  }
  throw error;
});
