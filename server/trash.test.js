/*! Open Historia - what delete moved to the trash © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Deleting a game or scenario moves its directory to <data dir>/.trash. Nothing
// listed, restored or emptied it: the recovery it exists for needed someone who
// knew the folder layout, and the space was never reclaimed.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time.
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

const run = (body) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-trash-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dataDir = process.env.OH_DATA_DIR;
    const gameIds = () => store.getLibraryCatalog().games.map((game) => game.id);
    ${body}
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

const report = (expr) => `process.stdout.write("\\n@@" + JSON.stringify(${expr}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a deleted game is listed with its name and restored under its id, events and all", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createGame({ id: "saga", name: "The Saga", scenarioId: "vinland", setActive: true });
    store.writeRuntimeJsonAsset("events", [{ id: "e1" }, { id: "e2" }], { readBack: false });
    store.deleteGame("saga");
    const listed = store.listTrash();
    const afterDelete = gameIds();
    const restored = store.restoreFromTrash(listed[0].entry);
    const game = store.getLibraryCatalog().games.find((entry) => entry.id === "saga");
    ${report(`{ listed, afterDelete, restored: { id: restored.id, kind: restored.kind }, game: game && { name: game.name, eventCount: game.eventCount, scenarioId: game.scenarioId }, left: store.listTrash().length, marker: fs.existsSync(path.join(dataDir, "games", "saga", ".deleted.json")) }`)}
  `);
  assert.equal(result.listed.length, 1);
  const [entry] = result.listed;
  assert.equal(entry.kind, "game");
  assert.equal(entry.id, "saga");
  assert.equal(entry.name, "The Saga");
  assert.equal(entry.scenarioId, "vinland");
  assert.ok(entry.bytes > 0);
  assert.ok(!Number.isNaN(Date.parse(entry.deletedAt)));
  assert.ok(!result.afterDelete.includes("saga"));
  assert.deepEqual(result.restored, { id: "saga", kind: "game" });
  assert.deepEqual(result.game, { name: "The Saga", eventCount: 2, scenarioId: "vinland" });
  assert.equal(result.left, 0);
  assert.equal(result.marker, false, "the trash's own note does not come back with it");
});

test("a scenario restored after its id was reused comes back beside it, not over it", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.deleteScenario("vinland");
    store.createScenario({ id: "vinland", name: "New Vinland" });
    const [entry] = store.listTrash();
    const restored = store.restoreFromTrash(entry.entry);
    const names = Object.fromEntries(store.getScenarioCatalog().scenarios.map((scenario) => [scenario.id, scenario.name]));
    ${report(`{ restoredId: restored.id, names }`)}
  `);
  assert.equal(result.restoredId, "vinland-2");
  assert.equal(result.names.vinland, "New Vinland");
  assert.equal(result.names["vinland-2"], "Vinland");
});

test("emptying the trash deletes every entry for good, and an entry outside it is refused", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createGame({ id: "one", scenarioId: "vinland" });
    store.createGame({ id: "two", scenarioId: "vinland" });
    store.deleteGame("one");
    store.deleteGame("two");
    const before = store.listTrash().length;
    const emptied = store.emptyTrash();
    let refused = "";
    try { store.restoreFromTrash("../games"); } catch (error) { refused = error.message; }
    let missing = "";
    try { store.restoreFromTrash("game-one"); } catch (error) { missing = error.message; }
    ${report(`{ before, removed: emptied.removed, bytes: emptied.bytes, after: store.listTrash().length, onDisk: fs.readdirSync(path.join(dataDir, ".trash")).length, refused, missing }`)}
  `);
  assert.equal(result.before, 2);
  assert.equal(result.removed, 2);
  assert.ok(result.bytes > 0);
  assert.equal(result.after, 0);
  assert.equal(result.onDisk, 0);
  assert.match(result.refused, /Invalid trash entry/);
  assert.match(result.missing, /Not in the trash/);
});

test("at startup what was deleted over 30 days ago goes for good, and an undated entry starts its 30 days now", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createGame({ id: "old", scenarioId: "vinland" });
    store.createGame({ id: "recent", scenarioId: "vinland" });
    store.deleteGame("old");
    store.deleteGame("recent");
    const trashDir = path.join(dataDir, ".trash");
    const day = 24 * 60 * 60 * 1000;
    const marker = (entry) => path.join(trashDir, entry, ".deleted.json");
    const stamp = (entry, at) => fs.writeFileSync(marker(entry), JSON.stringify({ ...JSON.parse(fs.readFileSync(marker(entry), "utf-8")), deletedAt: new Date(at).toISOString() }));
    stamp("game-old", Date.now() - 31 * day);
    stamp("game-recent", Date.now() - 29 * day);
    // Deleted before deletes were dated: no marker, and files last changed long ago.
    fs.mkdirSync(path.join(trashDir, "scenario-legacy"));
    fs.writeFileSync(path.join(trashDir, "scenario-legacy", "scenario.json"), JSON.stringify({ name: "Legacy" }));
    fs.utimesSync(path.join(trashDir, "scenario-legacy"), new Date(0), new Date(0));
    // Not an entry of ours: left alone.
    fs.mkdirSync(path.join(trashDir, "stray"));
    const purged = store.purgeOldTrash();
    const legacy = JSON.parse(fs.readFileSync(marker("scenario-legacy"), "utf-8"));
    const left = fs.readdirSync(trashDir).sort();
    const later = store.purgeOldTrash({ now: Date.now() + 31 * day });
    ${report(`{ purged, left, legacy, later, keepDays: store.TRASH_KEEP_DAYS, finally: fs.readdirSync(trashDir).sort() }`)}
  `);
  assert.equal(result.keepDays, 30);
  assert.equal(result.purged.removed, 1);
  assert.ok(result.purged.bytes > 0);
  assert.deepEqual(result.left, ["game-recent", "scenario-legacy", "stray"]);
  assert.equal(result.legacy.kind, "scenario");
  assert.equal(result.legacy.id, "legacy");
  assert.ok(Date.now() - Date.parse(result.legacy.deletedAt) < 60_000, "dated when first seen, not from its files' age");
  assert.equal(result.later.removed, 2);
  assert.deepEqual(result.finally, ["stray"]);
});

test("each shelf empties its own kind", () => {
  const result = run(`
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createScenario({ id: "markland", name: "Markland" });
    store.createGame({ id: "one", scenarioId: "vinland" });
    store.deleteGame("one");
    store.deleteScenario("markland");
    const listed = store.listTrash().map((entry) => entry.entry).sort();
    const emptied = store.emptyTrash({ kind: "game" });
    ${report(`{ listed, emptied: emptied.removed, left: store.listTrash().map((entry) => entry.kind) }`)}
  `);
  assert.deepEqual(result.listed, ["game-one", "scenario-markland"]);
  assert.equal(result.emptied, 1);
  assert.deepEqual(result.left, ["scenario"]);
});
