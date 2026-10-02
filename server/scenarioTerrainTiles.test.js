/*! Open Historia — a scenario names its Tiled Basemap, and never carries one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioTerrainTiles.test.js
//
// Detailed terrain is a Tiled Basemap that Scenarios name
// (docs/adr/0005-tiled-basemaps-stream-to-disk.md). The first cut of this
// feature shipped the archive INSIDE the scenario (a `terrain.pmtiles` asset,
// with `world.background.terrain`). A scenario or game still in that shape is
// migrated: its archive moves into the Basemap library, and its background names
// the Tiled Basemap instead. A scenario that never had relief is untouched.
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
import { buildPmtiles } from "./testPmtiles.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const BASEMAPS_URL = url.pathToFileURL(path.join(SERVER_DIR, "basemapStore.js")).href;
const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

const FALLBACK = { type: "FeatureCollection", features: [{ type: "Feature", properties: { fill: "#4a6" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] } }] };

const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-terrain-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "painted");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "painted", name: "Painted World", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA, customRegions: true, background: { kind: "vector" } });
  writeJson(path.join(scenarioDir, "background.json"), { geojson: FALLBACK });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "0298-06-01" });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["painted"], selectedScenarioId: "painted", version: 2 });
  return root;
};

const runStore = (root, body) => {
  const script = [
    `const fs = await import("node:fs");`,
    `const path = (await import("node:path")).default;`,
    `const store = await import(${JSON.stringify(STORE_URL)});`,
    `const basemaps = await import(${JSON.stringify(BASEMAPS_URL)});`,
    `const ROOT = ${JSON.stringify(root)};`,
    body,
  ].join("\n");
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

const ARCHIVE = buildPmtiles({
  minzoom: 0,
  maxzoom: 1,
  bounds: [0, -40, 90, 50],
  tiles: [
    { z: 0, x: 0, y: 0, bytes: Buffer.from("tile 0/0/0") },
    { z: 1, x: 1, y: 0, bytes: Buffer.from("tile 1/1/0") },
    { z: 1, x: 1, y: 1, bytes: Buffer.from("tile 1/1/1") },
  ],
}).toString("base64");

// A bundle in the first cut's shape: the archive rides inside it.
const LEGACY_BUNDLE = `
  const bundle = store.exportScenarioBundle("painted");
  bundle.scenario = { ...bundle.scenario, id: "relief", name: "Relief World" };
  bundle.data.world = { ...bundle.data.world, background: { kind: "vector", terrain: { minzoom: 0, maxzoom: 8, fillOpacity: [[2, 0.4], [10, 0.25]] } } };
  bundle.assets.terrain = { contentType: "application/octet-stream", data: ${JSON.stringify(ARCHIVE)}, encoding: "base64", fileName: "terrain.pmtiles", mode: "embedded" };
`;

test("a scenario that carried its relief becomes one that names a Tiled Basemap", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    ${LEGACY_BUNDLE}
    const imported = store.importScenarioBundle(bundle);
    await store.migrateEmbeddedTiledArchives();
    const id = imported.scenario.id;
    const world = store.getScenarioDetails(id).data.world;
    const meta = basemaps.findBasemapMetaByHash(world.background?.tiled?.hash);
    const exported = store.exportScenarioBundle(id);
    ${report(`{
      background: world.background,
      meta,
      fallback: meta ? basemaps.getBasemapPayload(meta.id) : null,
      archiveBytes: meta ? fs.readFileSync(basemaps.getBasemapArchivePath(meta.id)).toString("base64") === ${JSON.stringify(ARCHIVE)} : false,
      scenarioStillHasArchive: fs.existsSync(path.join(ROOT, "scenarios", id, "terrain.pmtiles")),
      exportedTerrain: exported.assets.terrain ?? null,
      exportedBackground: exported.data.world.background,
      exportedFallback: exported.assets.backgroundData?.data ?? null,
    }`)}
  `);
  assert.equal(result.background.kind, "vector", "the painted background stays, as the fallback");
  assert.equal(result.background.terrain, undefined, "the old terrain block is gone");
  assert.match(result.background.tiled.hash, /^[a-f0-9]{64}$/);
  assert.equal(result.background.tiled.name, "Relief World");
  assert.deepEqual(result.background.fillOpacity, [[2, 0.4], [10, 0.25]], "the scenario keeps its own fill ramp");
  assert.equal(result.meta.kind, "tiled");
  assert.equal(result.meta.maxzoom, 1, "the zoom range comes from the archive, not the old descriptor");
  assert.equal(result.archiveBytes, true, "the archive moved into the library byte-exact");
  assert.deepEqual(result.fallback, { geojson: FALLBACK }, "the Basemap takes the scenario's painted background as its fallback");
  assert.equal(result.scenarioStillHasArchive, false, "the scenario no longer carries the archive");
  assert.equal(result.exportedTerrain, null, "an export never carries a tiled archive");
  assert.deepEqual(result.exportedBackground, result.background, "an export names the Tiled Basemap");
  assert.deepEqual(result.exportedFallback, { geojson: FALLBACK }, "an export still carries the painted fallback");
});

test("a game made from the old shape is migrated to name the same Tiled Basemap", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    ${LEGACY_BUNDLE}
    const imported = store.importScenarioBundle(bundle);
    const game = store.createGame({ scenarioId: imported.scenario.id, setActive: true });
    await store.migrateEmbeddedTiledArchives();
    ${report(`{
      scenario: store.getScenarioDetails(imported.scenario.id).data.world.background,
      game: store.getGameDetails(game.game.id).data.world.background,
    }`)}
  `);
  assert.ok(result.game.tiled?.hash);
  assert.deepEqual(result.game, result.scenario);
});

test("migration is idempotent, and a scenario without relief is untouched", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    ${LEGACY_BUNDLE}
    store.importScenarioBundle(bundle);
    await store.migrateEmbeddedTiledArchives();
    const first = store.getScenarioDetails("relief").data.world.background;
    await store.migrateEmbeddedTiledArchives();
    ${report(`{
      first,
      second: store.getScenarioDetails("relief").data.world.background,
      painted: store.getScenarioDetails("painted").data.world.background,
      library: basemaps.getBasemapCatalog().length,
    }`)}
  `);
  assert.deepEqual(result.second, result.first);
  assert.deepEqual(result.painted, { kind: "vector" });
  assert.equal(result.library, 1);
});

test("an export names the official map its file is, by id and version; a map not on the list stays named by checksum", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    ${LEGACY_BUNDLE}
    store.importScenarioBundle(bundle);
    await store.migrateEmbeddedTiledArchives();
    const hash = store.getScenarioDetails("relief").data.world.background.tiled.hash;
    const before = store.exportScenarioBundle("relief").data.world.background.tiled;
    basemaps.tagOfficialBasemaps({ basemaps: [{ id: "relief-world", versions: [{ version: 3, sha256: hash }] }] });
    const after = store.exportScenarioBundle("relief").data.world.background.tiled;
    const meta = basemaps.findOfficialBasemapMeta("relief-world");
    ${report(`{ hash, before, after, official: meta?.official ?? null, users: store.listScenariosNamingTiledBasemap(meta) }`)}
  `);
  assert.equal(result.before.hash, result.hash, "not on the official list: named by its checksum");
  assert.equal(result.before.id, undefined);
  assert.deepEqual(result.official, { id: "relief-world", version: 3 }, "the library's copy is that official version");
  assert.equal(result.after.id, "relief-world");
  assert.equal(result.after.version, 3, "the version the author has is the lowest the scenario needs");
  assert.equal(result.after.hash, undefined, "named by id, not by file");
  assert.equal(result.after.name, "Relief World");
  assert.deepEqual(result.users, [{ id: "relief", name: "Relief World" }], "a scenario naming it by checksum still counts as using it");
});
