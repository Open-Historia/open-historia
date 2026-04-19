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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const distDir = path.join(__dirname, "../dist");

const jsonParser = express.json({ limit: "64mb" });
const largeJsonParser = express.json({ limit: "2048mb" });
const uploadParser = express.raw({ type: () => true, limit: "2048mb" });

ensureScenarioStore();
ensureGameStore();

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

app.use(express.static(distDir));

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
