/*! Open Historia — a hub Update keeps a basemap it could not replace © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioUpdateBackground.test.js
//
// A hub scenario's newer version can reference a community basemap instead of
// carrying it. When the game cannot download that basemap (offline, a 502, a
// moved file) the bundle reaches Update still holding the reference. Update
// used to treat that as "no basemap" and delete the one the scenario had, so a
// temporary failure wiped a basemap that worked. It now keeps it — and the
// world's note of what kind it is — while a bundle that truly has no basemap
// still clears it.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const BACKGROUND = { dataUrl: "data:image/png;base64,T0xE" };
const IMAGE_DESCRIPTOR = { kind: "image", extent: [-180, -85, 180, 85] };

const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-update-bg-"));
  roots.push(root);
  const dir = path.join(root, "scenarios", "hub-copy");
  writeJson(path.join(dir, "scenario.json"), {
    id: "hub-copy",
    name: "Hub Copy",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    hubOrigin: { postId: 7, bundleUrl: "https://github.com/user-attachments/files/1/old.zip", syncedAt: "2026-08-01T00:00:00.000Z" },
  });
  writeJson(path.join(dir, "world.json"), { ownerSchema: OWNER_SCHEMA, background: IMAGE_DESCRIPTOR });
  writeJson(path.join(dir, "game.json"), { country: "Testland", gameDate: "2030-01-01" });
  writeJson(path.join(dir, "background.json"), BACKGROUND);
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(dir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["hub-copy"], selectedScenarioId: "hub-copy", version: 2 });
  return { root, dir };
};

const update = (root, bundle) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\nstore.updateScenarioFromBundle("hub-copy", ${JSON.stringify(bundle)});`;
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const newVersion = (backgroundData) => ({
  schema: "pax-historia-scenario-bundle/2",
  scenario: { name: "Hub Copy v2" },
  data: { world: { ownerSchema: OWNER_SCHEMA, background: { kind: "vector" } }, game: { country: "Testland", gameDate: "2030-01-01" } },
  assets: backgroundData ? { backgroundData } : {},
  hubOrigin: { postId: 7, bundleUrl: "https://github.com/user-attachments/files/2/new.zip" },
});

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("an Update whose community basemap could not be downloaded keeps the basemap the scenario had", () => {
  const { root, dir } = buildDataDir();
  update(root, newVersion({ mode: "communityRef", via: "dataFile", url: "https://github.com/user-attachments/files/3/v.zip", missingReason: "Download failed (HTTP 502)." }));
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "background.json"), "utf-8")), BACKGROUND);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "world.json"), "utf-8")).background, IMAGE_DESCRIPTOR, "the kept file is still read as an image");
  assert.equal(JSON.parse(readFileSync(path.join(dir, "scenario.json"), "utf-8")).name, "Hub Copy v2", "the rest of the update lands");
});

test("an Update whose new version has no basemap still clears the old one", () => {
  const { root, dir } = buildDataDir();
  update(root, newVersion(null));
  assert.equal(existsSync(path.join(dir, "background.json")), false);
});

// ---- the reference is kept, and the basemap put in place when it arrives -------
const COMMUNITY_REF = { mode: "communityRef", via: "image", hash: "abc", url: "https://github.com/user-attachments/assets/basemap.png", fileName: "background.json" };

const inStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\nconst out = await (async () => { ${body} })();\nprocess.stdout.write("\\n@@" + JSON.stringify(out));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

test("an import whose basemap could not be downloaded keeps the reference, exports it, and takes the basemap later without counting as an edit", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-missing-bg-"));
  roots.push(root);
  const bundle = newVersion({ ...COMMUNITY_REF, missingReason: "Download failed (HTTP 502)." });
  bundle.data.world.background = IMAGE_DESCRIPTOR;
  const result = inStore(root, `
    const imported = store.importScenarioBundle(${JSON.stringify(bundle)});
    const id = imported.scenario.id;
    const listed = store.getScenarioCatalog().scenarios.find((scenario) => scenario.id === id);
    const exported = store.exportScenarioBundle(id).assets.backgroundData;
    const restored = store.restoreScenarioBasemap(id, { dataUrl: ${JSON.stringify(BACKGROUND.dataUrl)} });
    let again = "";
    try { store.restoreScenarioBasemap(id, { dataUrl: ${JSON.stringify(BACKGROUND.dataUrl)} }); } catch (error) { again = error.message; }
    return { id, hadFile: imported.assetStatus.backgroundData, missing: listed.missingBasemap, exported, restored: { file: restored.assetStatus.backgroundData, missing: restored.scenario.missingBasemap ?? null, editedAt: restored.scenario.hubOrigin?.editedAt ?? null, background: restored.data.world.background }, again };
  `);
  assert.equal(result.hadFile, false);
  assert.deepEqual(result.missing, { reference: COMMUNITY_REF, background: IMAGE_DESCRIPTOR, reason: "Download failed (HTTP 502)." });
  assert.deepEqual(result.exported, COMMUNITY_REF, "the next import tries the download too");
  assert.equal(result.restored.file, true);
  assert.equal(result.restored.missing, null);
  assert.equal(result.restored.editedAt, null, "the copy still follows its post");
  assert.deepEqual(result.restored.background, IMAGE_DESCRIPTOR);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "scenarios", result.id, "background.json"), "utf-8")), BACKGROUND);
  assert.match(result.again, /not waiting for a basemap/);
});

test("an Update records the new version's missing basemap, and one that brings it clears the record", () => {
  const { root } = buildDataDir();
  const missing = inStore(root, `
    store.updateScenarioFromBundle("hub-copy", ${JSON.stringify(newVersion({ ...COMMUNITY_REF, missingReason: "Not found on the hub." }))});
    return store.getScenarioCatalog().scenarios.find((scenario) => scenario.id === "hub-copy").missingBasemap;
  `);
  assert.equal(missing.reference.url, COMMUNITY_REF.url);
  assert.equal(missing.reason, "Not found on the hub.");
  const cleared = inStore(root, `
    store.updateScenarioFromBundle("hub-copy", ${JSON.stringify(newVersion({ mode: "embedded", data: BACKGROUND, contentType: "application/json", fileName: "background.json" }))});
    return store.getScenarioCatalog().scenarios.find((scenario) => scenario.id === "hub-copy").missingBasemap ?? null;
  `);
  assert.equal(cleared, null);
});

test("a basemap the player sets themselves replaces the one still missing", () => {
  const { root } = buildDataDir();
  const missing = inStore(root, `
    store.updateScenarioFromBundle("hub-copy", ${JSON.stringify(newVersion({ ...COMMUNITY_REF, missingReason: "Not found on the hub." }))});
    const before = Boolean(store.getScenarioDetails("hub-copy").scenario.missingBasemap);
    store.uploadScenarioAsset("hub-copy", "backgroundData", Buffer.from(JSON.stringify({ dataUrl: "data:image/png;base64,T0xE" })));
    return { before, after: store.getScenarioDetails("hub-copy").scenario.missingBasemap ?? null };
  `);
  assert.deepEqual(missing, { before: true, after: null });
});
