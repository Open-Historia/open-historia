/*! Open Historia — a scenario's relief tiles travel with it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioTerrainTiles.test.js
//
// A scenario can ship terrain.pmtiles, raster relief drawn over its vector
// background (src/Game/Map/scenarioTerrain.js). The archive must survive a
// bundle round trip like the geometry does, and a scenario WITHOUT one must not
// be served anything: there is no stock relief to fall back to, and the game
// reads the missing archive as "keep the painted background".
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-terrain-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "painted");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "painted", name: "Painted World", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA, customRegions: true, background: { kind: "vector" } });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "0298-06-01" });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["painted"], selectedScenarioId: "painted", version: 2 });
  return root;
};

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root, OH_ASSETS_DIR: path.join(root, "no-stock-assets") },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Stand-in archive bytes: the store moves them, it never parses them.
const TILES = Buffer.from("PMTiles\u0003 relief stand-in").toString("base64");

test("a scenario's relief tiles survive a bundle round trip and are served to its games", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const fs = await import("node:fs");
    const bundle = store.exportScenarioBundle("painted");
    bundle.scenario = { ...bundle.scenario, id: "relief", name: "Relief World" };
    bundle.data.world = { ...bundle.data.world, background: { kind: "vector", terrain: { minzoom: 0, maxzoom: 8 } } };
    bundle.assets.terrain = { contentType: "application/octet-stream", data: ${JSON.stringify(TILES)}, encoding: "base64", fileName: "terrain.pmtiles", mode: "embedded" };
    const imported = store.importScenarioBundle(bundle);
    const again = store.exportScenarioBundle(imported.scenario.id);
    const game = store.createGame({ scenarioId: imported.scenario.id, setActive: true });
    const served = store.resolveRuntimeBinaryAsset("terrain");
    ${report(`{
      exportedMode: again.assets.terrain.mode,
      exportedFile: again.assets.terrain.fileName,
      sameBytes: again.assets.terrain.data === ${JSON.stringify(TILES)},
      servedBytes: fs.readFileSync(served.sourcePath).toString("base64") === ${JSON.stringify(TILES)},
      gameTerrain: store.getGameDetails(game.game.id).data.world.background?.terrain ?? null,
    }`)}
  `);
  assert.equal(result.exportedMode, "embedded");
  assert.equal(result.exportedFile, "terrain.pmtiles");
  assert.equal(result.sameBytes, true, "the archive travels byte-exact");
  assert.equal(result.servedBytes, true, "the active game is served its scenario's archive");
  assert.deepEqual(result.gameTerrain, { minzoom: 0, maxzoom: 8 }, "the game inherits the terrain descriptor");
});

test("a scenario without relief tiles exports none and serves none", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const bundle = store.exportScenarioBundle("painted");
    store.createGame({ scenarioId: "painted", setActive: true });
    let served = null;
    try { served = store.resolveRuntimeBinaryAsset("terrain").sourcePath; } catch (error) { served = "error: " + error.message; }
    ${report(`{ mode: bundle.assets.terrain.mode, served }`)}
  `);
  assert.equal(result.mode, "default");
  assert.match(result.served, /^error: /, "no stock relief exists to fall back to");
});
