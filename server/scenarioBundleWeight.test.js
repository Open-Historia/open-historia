/*! Open Historia — what a shared map weighs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioBundleWeight.test.js
//
// A scenario bundle used to base64 every asset, including the ones that are
// already JSON. On a real hub map that made the region geometry 17.1 MB of an
// 18.1 MB file — a third of the download for nothing. Geometry now travels as
// JSON, and a bundle written the old way still imports, because seven of them
// are already on the community hub.
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

// Enough regions that the geometry, not the scaffolding, is what the bundle
// weighs — the same relationship a real map has.
const REGIONS = {
  type: "FeatureCollection",
  features: Array.from({ length: 500 }, (_, index) => ({
    type: "Feature",
    properties: { id: String(index), owner: "Testland", gid0: "TST", name: `Region ${index}`, typeId: "land" },
    geometry: { type: "Polygon", coordinates: [[[index / 10, 0], [index / 10 + 0.1, 0], [index / 10 + 0.1, 0.1], [index / 10, 0.1], [index / 10, 0]]] },
  })),
};

const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-bundle-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "hand-drawn");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "hand-drawn", name: "Hand Drawn World", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA, customRegions: true });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "2030-01-01" });
  writeJson(path.join(scenarioDir, "regions.geojson"), REGIONS);
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["hand-drawn"], selectedScenarioId: "hand-drawn", version: 2 });
  return root;
};

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a shared map's geometry travels as JSON, and the bundle is a third lighter for it", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const bundle = store.exportScenarioBundle("hand-drawn");
    const asset = bundle.assets.regionsGeojson;
    const asBase64 = { ...asset, data: Buffer.from(JSON.stringify(asset.data)).toString("base64"), encoding: "base64" };
    ${report(`{
      encoding: asset.encoding ?? null,
      mode: asset.mode,
      fileName: asset.fileName,
      features: asset.data.features.length,
      firstProps: asset.data.features[0].properties,
      bundleBytes: JSON.stringify(bundle).length,
      oldBundleBytes: JSON.stringify({ ...bundle, assets: { ...bundle.assets, regionsGeojson: asBase64 } }).length,
    }`)}
  `);
  assert.equal(result.encoding, null, "no base64 wrapper around JSON");
  assert.equal(result.mode, "embedded");
  assert.equal(result.fileName, "regions.geojson");
  assert.equal(result.features, 500);
  assert.equal(result.firstProps.owner, "Testland");
  assert.ok(
    result.bundleBytes < result.oldBundleBytes * 0.8,
    `bundle is ${result.bundleBytes} bytes against ${result.oldBundleBytes} the old way`,
  );
});

test("a bundle written either way imports to the same map on disk", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const fs = await import("node:fs");
    const bundle = store.exportScenarioBundle("hand-drawn");
    const asBase64 = JSON.parse(JSON.stringify(bundle));
    asBase64.assets.regionsGeojson = {
      ...asBase64.assets.regionsGeojson,
      data: Buffer.from(JSON.stringify(bundle.assets.regionsGeojson.data)).toString("base64"),
      encoding: "base64",
    };
    const fresh = store.importScenarioBundle({ ...bundle, scenario: { ...bundle.scenario, id: "as-json" } });
    const legacy = store.importScenarioBundle({ ...asBase64, scenario: { ...asBase64.scenario, id: "as-base64" } });
    const path = await import("node:path");
    const read = (id) => JSON.parse(fs.readFileSync(path.join(process.env.OH_DATA_DIR, "scenarios", id, "regions.geojson"), "utf-8"));
    ${report(`{
      fresh: read(fresh.scenario.id).features.length,
      legacy: read(legacy.scenario.id).features.length,
      same: JSON.stringify(read(fresh.scenario.id)) === JSON.stringify(read(legacy.scenario.id)),
      firstName: read(fresh.scenario.id).features[0].properties.name,
    }`)}
  `);
  assert.equal(result.fresh, 500);
  assert.equal(result.legacy, 500, "the seven bundles already on the hub still import");
  assert.equal(result.same, true);
  assert.equal(result.firstName, "Region 0");
});
