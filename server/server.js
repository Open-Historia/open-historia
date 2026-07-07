/*! Open Historia — portions (CORS, AI relay, shutdown endpoint, hub proxy) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import express from "express";
import fs from "fs";
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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const distDir = path.join(__dirname, "../dist");

const jsonParser = express.json({ limit: "64mb" });
const largeJsonParser = express.json({ limit: "2048mb" });
const uploadParser = express.raw({ type: () => true, limit: "2048mb" });

// The Android app's connect screen lives on the WebView's own origin, so its
// probe of this server is a cross-origin request — without these headers the
// phone blocks it (CORS) and the app can never connect. This is a personal
// game server whose whole API is open to whoever can reach it, so a blanket
// allow changes nothing security-wise.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Chrome's Private Network Access preflights loopback/LAN targets and
  // requires this opt-in on top of regular CORS.
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
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
// The blanket CORS above is needed so the Android connect screen (on the
// WebView's own origin) can *probe* this server — a GET. But it also let any
// web page the user happens to be visiting POST/PUT/DELETE to localhost:
// delete saved maps and games, drive the AI relay at internal hosts, or hit
// /api/server/shutdown. The app serves its own SPA, so real gameplay writes
// are same-origin (Origin absent, or Origin host === Host); a foreign Origin
// on a write is rejected. Set OH_ALLOW_CROSS_ORIGIN=1 to restore the old
// fully-open behavior if a client setup genuinely needs cross-origin writes.
const ALLOW_CROSS_ORIGIN_WRITES = process.env.OH_ALLOW_CROSS_ORIGIN === "1";
const CROSS_ORIGIN_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
app.use((req, res, next) => {
  if (ALLOW_CROSS_ORIGIN_WRITES || CROSS_ORIGIN_SAFE_METHODS.has(req.method)) {
    return next();
  }
  const origin = req.headers.origin;
  if (!origin) {
    // No Origin header: same-origin non-CORS request or a native (non-browser)
    // client. Browsers always attach Origin to cross-site writes.
    return next();
  }
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return sendError(res, 403, new Error("Cross-origin request blocked (invalid Origin)."));
  }
  if (originHost === req.headers.host) {
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

  const match = /bytes=(\d*)-(\d*)/i.exec(rangeHeader);
  if (!match || (!match[1] && !match[2])) {
    res.status(416).setHeader("Content-Range", `bytes */${totalSize}`).end();
    return;
  }

  let clampedStart;
  let clampedEnd;
  if (!match[1]) {
    // Suffix range "bytes=-N": the final N bytes of the file, not the first N.
    const suffix = Number.parseInt(match[2], 10);
    clampedStart = Math.max(0, totalSize - suffix);
    clampedEnd = totalSize - 1;
  } else {
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
    clampedStart = Math.max(0, Math.min(start, totalSize - 1));
    clampedEnd = Math.max(clampedStart, Math.min(end, totalSize - 1));
  }

  if (clampedStart >= totalSize) {
    res.status(416).setHeader("Content-Range", `bytes */${totalSize}`).end();
    return;
  }

  res.status(206);
  res.setHeader("Content-Length", clampedEnd - clampedStart + 1);
  res.setHeader("Content-Range", `bytes ${clampedStart}-${clampedEnd}/${totalSize}`);
  fs.createReadStream(sourcePath, { end: clampedEnd, start: clampedStart }).pipe(res);
};

// Global client preferences (currently the UI language) shared by every
// device that plays through this server — the phone app and desktop browser
// see the same choice, instead of each browser keeping its own.
const uiSettingsFile = path.join(__dirname, "data", "ui-settings.json");

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
const savedLangDir = path.join(__dirname, "data", "lang");

const readLangPack = (dir, code) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const isLangCode = (code) => /^[a-z]{2,3}$/.test(code);

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
    const asset = writeRuntimeJsonAsset(req.params.assetKey, req.body ?? {});
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

// Browser AI calls to self-hosted OpenAI-compatible endpoints (llama.cpp,
// LM Studio, NVIDIA NIM...) die on CORS — those servers rarely send the
// headers. The game server relays them instead: same-origin for the browser,
// plain server-to-server for the endpoint. The target is whatever the player
// configured in Settings — them talking to their own AI through their own
// game server.
app.post("/api/ai/relay", largeJsonParser, async (req, res) => {
  try {
    const { url: targetUrl, method = "POST", headers = {}, payload } = req.body ?? {};
    const target = new URL(String(targetUrl ?? ""));
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return sendError(res, 400, new Error("Only http(s) AI endpoints can be relayed."));
    }
    const upstream = await fetch(target, {
      method: method === "GET" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.type(upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (error) {
    sendError(res, 502, error);
  }
});

// Shut the server down from the UI (the ⏻ button in the top bar) — handy on
// phones/Termux and headless installs where no terminal is in sight. Responds
// first so the client can show its "server stopped" screen, then exits.
app.post("/api/server/shutdown", (_req, res) => {
  res.json({ ok: true });
  console.log("Shutdown requested from the UI — exiting.");
  setTimeout(() => process.exit(0), 300);
});

const isAllowedHubUrl = (candidate) =>
  candidate.protocol === "https:" && HUB_DOWNLOAD_HOSTS.has(candidate.hostname);

app.get("/api/hub/file", async (req, res) => {
  try {
    let current = new URL(String(req.query.url ?? ""));
    if (!isAllowedHubUrl(current)) {
      return sendError(res, 400, new Error("Only GitHub-hosted scenario files can be fetched."));
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
      if (!isAllowedHubUrl(next)) {
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

    res.setHeader("Cache-Control", "no-store");
    // Pass the upstream content type through untouched. JSON bundles still parse
    // via response.json() (which ignores the header), while binary bundles (.zip)
    // and raw basemap images (.png/.jpg) arrive byte-for-byte — the old text()
    // path UTF-8-decoded them and corrupted every non-text byte.
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    res.send(buffer);
  } catch (error) {
    sendError(res, 502, error);
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

app.use(express.static(distDir));

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const httpServer = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// A taken port used to crash with a raw EADDRINUSE stack, which the launchers
// then reported as a bare "Server stopped." — say what actually happened.
httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — Open Historia is probably already running.`);
    console.error("Close the other instance (the ⏻ button in the game stops it), or set the");
    console.error(`PORT environment variable to run this one on a different port.`);
    process.exit(1);
  }
  throw error;
});
