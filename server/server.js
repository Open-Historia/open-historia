/*! Open Historia — portions (CORS, AI relay, shutdown endpoint, hub proxy) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import express from "express";
import fs from "fs";
import https from "https";
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

const sendError = (res, statusCode, error) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(statusCode).json({ error: message });
};

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
  if (!match) {
    res.status(416).end();
    return;
  }

  const start = match[1] ? Number.parseInt(match[1], 10) : 0;
  const end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
  const clampedStart = Number.isFinite(start) ? Math.max(0, Math.min(start, totalSize - 1)) : 0;
  const clampedEnd = Number.isFinite(end)
    ? Math.max(clampedStart, Math.min(end, totalSize - 1))
    : totalSize - 1;

  if (clampedStart >= totalSize || clampedEnd >= totalSize) {
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

app.get("/api/hub/file", async (req, res) => {
  try {
    const target = new URL(String(req.query.url ?? ""));
    if (target.protocol !== "https:" || !HUB_DOWNLOAD_HOSTS.has(target.hostname)) {
      return sendError(res, 400, new Error("Only GitHub-hosted scenario files can be fetched."));
    }

    const upstream = await fetch(target, { redirect: "follow" });
    if (!upstream.ok) {
      return sendError(res, 502, new Error(`Hub file fetch failed (HTTP ${upstream.status}).`));
    }

    const text = await upstream.text();
    if (text.length > HUB_MAX_BUNDLE_BYTES) {
      return sendError(res, 413, new Error("Scenario bundle is too large."));
    }

    res.setHeader("Cache-Control", "no-store");
    res.type("application/json");
    res.send(text);
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

app.use(express.static(distDir));

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

// A LAN address (e.g. http://192.168.1.20:3000) is not a secure context, so
// service workers — and with them, PWA install — never work on it, only on
// localhost. If `node scripts/generate-dev-cert.mjs` has been run, its cert
// is picked up here so other devices on the network can install the app too
// (each device must first be told to trust the cert once — see that script).
const certKeyPath = path.join(__dirname, "../certs/dev-key.pem");
const certPath = path.join(__dirname, "../certs/dev-cert.pem");
const hasDevCert = fs.existsSync(certKeyPath) && fs.existsSync(certPath);

let httpServer;
if (hasDevCert) {
  try {
    const options = { key: fs.readFileSync(certKeyPath), cert: fs.readFileSync(certPath) };
    httpServer = https.createServer(options, app).listen(PORT, () => {
      console.log(`Server running at https://localhost:${PORT} (dev cert active) — this port is HTTPS-only now, so use https:// everywhere, including localhost.`);
    });
  } catch (error) {
    console.error(`Dev cert at certs/ is unreadable or malformed (${error.message}) — falling back to plain HTTP. Re-run \`node scripts/generate-dev-cert.mjs\`.`);
  }
}
if (!httpServer) {
  httpServer = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

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
