/*! Open Historia - the coarse regions copy is built where the regions are written © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The country picker draws a coarse copy of a scenario's regions
// (?coarse=1). It used to be built inside the first such request after every
// map save — Apply & Play asks for it right after saving — which parsed the
// whole regions file on the event loop while the picker waited. It is now built
// when the regions are uploaded or imported, and the request only builds it
// when the regions changed some other way.
//
// Runs in a child process because OH_DATA_DIR is read once, at import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

// One square region drawn with far more points than the coarse copy keeps.
const square = (id, size) => {
  const ring = [];
  for (let step = 0; step <= 40; step += 1) ring.push([(size * step) / 40, 0]);
  for (let step = 0; step <= 40; step += 1) ring.push([size, (size * step) / 40]);
  for (let step = 40; step >= 0; step -= 1) ring.push([(size * step) / 40, size]);
  for (let step = 40; step >= 0; step -= 1) ring.push([0, (size * step) / 40]);
  return { type: "Feature", id, properties: { id, owner: "Vinland" }, geometry: { type: "Polygon", coordinates: [ring] } };
};
const COLLECTION = { type: "FeatureCollection", features: [square("r1", 2)] };

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("an upload and an import leave a fresh coarse copy, and a hand-changed map is rebuilt on request", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-coarse-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const collection = ${JSON.stringify(COLLECTION)};
    const coarseOf = (id) => path.join(process.env.OH_DATA_DIR, "scenarios", id, "regions.coarse.geojson");
    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

    store.createScenario({ id: "vinland", name: "Vinland" });
    fs.rmSync(coarseOf("vinland"), { force: true });
    store.uploadScenarioAsset("vinland", "regionsGeojson", Buffer.from(JSON.stringify(collection)));
    const uploaded = read(coarseOf("vinland"));
    // A fresh copy is served as it is: mark it and see the mark come back.
    fs.writeFileSync(coarseOf("vinland"), "marked");
    const served = read(store.resolveScenarioCoarseRegionsAsset("vinland").sourcePath);

    store.importScenarioBundle({
      schema: "pax-historia-scenario-bundle/2",
      scenario: { id: "markland", name: "Markland" },
      data: { world: { ownerSchema: 4 } },
      assets: { regionsGeojson: { mode: "embedded", data: collection } },
    });
    const imported = read(coarseOf("markland"));

    // Changed by hand: the stamp no longer matches, so the request builds it.
    const regionsPath = path.join(process.env.OH_DATA_DIR, "scenarios", "vinland", "regions.geojson");
    fs.writeFileSync(regionsPath, JSON.stringify({ ...collection, features: [...collection.features, { ...collection.features[0], id: "r2", properties: { id: "r2" } }] }));
    const rebuilt = read(store.resolveScenarioCoarseRegionsAsset("vinland").sourcePath);
    process.stdout.write("\\n@@" + JSON.stringify({ uploaded, served, imported, rebuilt }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));

  const uploaded = JSON.parse(result.uploaded);
  assert.equal(uploaded.features.length, 1);
  assert.equal(uploaded.features[0].properties.id, "r1");
  assert.ok(uploaded.features[0].geometry.coordinates[0].length < COLLECTION.features[0].geometry.coordinates[0].length);
  assert.equal(result.served, "marked", "a copy built at upload is not built again");
  assert.equal(JSON.parse(result.imported).features.length, 1);
  assert.deepEqual(JSON.parse(result.rebuilt).features.map((feature) => feature.properties.id), ["r1", "r2"]);
});
