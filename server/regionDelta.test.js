/*! Open Historia — applying a map-editor difference © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/regionDelta.test.js
//
// A save that carries only the regions that moved (src/Editor/regionChanges.js)
// is applied here. Every test below is about the same thing: a difference that
// cannot be trusted must be refused WHOLE, leaving the stored map untouched, so
// the editor can send it again in full. A half-applied difference is a map the
// author silently loses.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

import { applyRegionDelta, isRegionDelta } from "./regionDelta.js";

const region = (id, x = Number(id)) => ({
  type: "Feature",
  id: String(id),
  properties: { id: String(id), owner: "Testland", name: `Region ${id}` },
  geometry: { type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
});
const collection = (ids) => ({ type: "FeatureCollection", features: ids.map((id) => region(id)) });
const ids = (regions) => regions.features.map((feature) => feature.properties.id);

test("changed regions land in place, new ones on the end, removed ones go", () => {
  const stored = collection(["1", "2", "3"]);
  const moved = { ...region("2"), properties: { id: "2", owner: "Otherland", name: "Region 2" } };
  const result = applyRegionDelta(stored, { changed: [moved, region("9")], removed: ["3"], count: 3 });
  assert.equal(result.applied, true);
  assert.deepEqual(ids(result.regions), ["1", "2", "9"]);
  assert.equal(result.regions.features[1].properties.owner, "Otherland");
  assert.deepEqual(ids(stored), ["1", "2", "3"], "the stored collection is not mutated");
});

test("a difference that does not add up is refused whole", () => {
  const stored = collection(["1", "2", "3"]);
  const wrong = applyRegionDelta(stored, { changed: [region("4")], removed: [], count: 3 });
  assert.equal(wrong.applied, false);
  assert.match(wrong.reason, /expected 3 regions, merge made 4/);
  assert.equal(wrong.regions, undefined, "nothing to write means nothing is written");
});

test("a difference with nothing to apply it to is refused", () => {
  assert.equal(applyRegionDelta(null, { changed: [region("1")], count: 1 }).applied, false);
  assert.equal(applyRegionDelta({}, { changed: [region("1")], count: 1 }).reason, "no geometry stored");
});

test("a region with no id is refused rather than guessed at", () => {
  const stored = collection(["1", "2"]);
  const nameless = { type: "Feature", properties: { owner: "Testland" }, geometry: null };
  const result = applyRegionDelta(stored, { changed: [nameless], count: 2 });
  assert.equal(result.applied, false);
  assert.match(result.reason, /no id/);
});

test("only a real difference is treated as one", () => {
  assert.equal(isRegionDelta({ changed: [] }), true);
  assert.equal(isRegionDelta({ removed: [] }), true);
  assert.equal(isRegionDelta({ type: "FeatureCollection", features: [] }), false);
  assert.equal(isRegionDelta(null), false);
  assert.equal(isRegionDelta("changed"), false);
});

// --- and the same thing through the document store ---------------------------

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "mapEditorStore.js")).href;
const roots = [];
const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;
const docPath = (root, id) => path.join(root, "mapeditor-documents", `${id}.json`);

const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-delta-"));
  roots.push(root);
  mkdirSync(path.join(root, "mapeditor-documents"), { recursive: true });
  writeFileSync(docPath(root, "world"), JSON.stringify({
    id: "world", name: "World", version: 1, metadata: { name: "World" }, types: [], features: [],
    regions: collection(["1", "2", "3"]),
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  }), "utf-8");
  writeFileSync(path.join(root, "mapeditor-manifest.json"), JSON.stringify({ version: 1, order: ["world"] }), "utf-8");
  return root;
};

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("the store applies a save that carries only what moved", () => {
  const root = buildDataDir();
  const moved = JSON.stringify({ ...region("2"), properties: { id: "2", owner: "Otherland", name: "Region 2" } });
  const summary = runStore(root, `
    const saved = store.updateMapEditorDocument("world", { name: "World", regionsDelta: { changed: [${moved}], removed: [], count: 3 } });
    ${report("saved")}
  `);
  assert.equal(summary.needsFullRegions, undefined);
  const stored = JSON.parse(readFileSync(docPath(root, "world"), "utf-8"));
  assert.deepEqual(ids(stored.regions), ["1", "2", "3"]);
  assert.equal(stored.regions.features[1].properties.owner, "Otherland");
  assert.equal(stored.regionsDelta, undefined, "the difference is applied, not stored");
});

test("a difference the store cannot trust leaves the map alone and asks for all of it", () => {
  const root = buildDataDir();
  const summary = runStore(root, `
    const saved = store.updateMapEditorDocument("world", { name: "Renamed", regionsDelta: { changed: [], removed: ["nope"], count: 99 } });
    ${report("saved")}
  `);
  assert.match(summary.needsFullRegions, /expected 99 regions/);
  const stored = JSON.parse(readFileSync(docPath(root, "world"), "utf-8"));
  assert.deepEqual(ids(stored.regions), ["1", "2", "3"], "the map is exactly as it was");
  assert.equal(stored.name, "Renamed", "the rest of the save still landed");
});

test("a save that carries the whole map still replaces it", () => {
  const root = buildDataDir();
  runStore(root, `
    store.updateMapEditorDocument("world", { regions: ${JSON.stringify(collection(["7", "8"]))} });
    ${report("true")}
  `);
  const stored = JSON.parse(readFileSync(docPath(root, "world"), "utf-8"));
  assert.deepEqual(ids(stored.regions), ["7", "8"]);
});
