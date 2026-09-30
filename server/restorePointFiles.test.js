/*! Open Historia — restore points kept one file each on the desktop © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/restorePointFiles.test.js
//
// A game's restore points (up to twelve whole worlds, 8-21 MB on a long game)
// used to be one file, storage/snapshots.json, rewritten whole every turn. They
// are now one file each under storage/snapshots/, in the order
// storage/snapshots-index.json lists them (server/restorePoints.js). What has to
// hold:
//   - an install's old snapshots.json is read, moved into files and deleted,
//     with nothing lost and the order kept;
//   - a turn writes the one restore point it adds and deletes the one that falls
//     off the end, and leaves the rest untouched; an undo deletes the newest;
//   - exports, imports and the owner-rename migration still see all of them.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";
import { planRestorePointSlots } from "./restorePoints.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const GAME = "campaign";

const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};
const readJson = (file) => JSON.parse(readFileSync(file, "utf-8"));

const snap = (round, extra = {}) => ({
  id: `snap-${round}-1000`,
  round,
  fromDate: `2016-0${round}-01`,
  toDate: `2016-0${round + 1}-01`,
  capturedAt: `2026-09-2${round}T00:00:00.000Z`,
  state: { world: { note: `before turn ${round}` } },
  ...extra,
});

// One scenario and one active game on it, with `legacy` as its old single
// restore-point file when given.
const buildDataDir = ({ legacy = null, world = { ownerSchema: OWNER_SCHEMA } } = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-restore-points-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "default");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "default", name: "Modern Day", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(scenarioDir, "game.json"), {});
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default"], selectedScenarioId: "default", version: 2 });

  const dir = path.join(root, "games", GAME);
  writeJson(path.join(dir, "game-instance.json"), { id: GAME, name: "Campaign", scenarioId: "default", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(dir, "world.json"), world);
  writeJson(path.join(dir, "game.json"), { country: "Testland", gameDate: "2016-05-01", round: 5 });
  writeJson(path.join(dir, "colors.json"), {});
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(dir, "storage", `${key}.json`), []);
  if (legacy) writeJson(path.join(dir, "storage", "snapshots.json"), legacy);
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: GAME, order: [GAME], version: 2 });
  return root;
};

const storageOf = (root) => path.join(root, "games", GAME, "storage");
const filesOf = (root) => {
  const dir = path.join(storageOf(root), "snapshots");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const at = out.lastIndexOf("\n@@");
  return at >= 0 ? JSON.parse(out.slice(at + 3)) : null;
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("an old snapshots.json is moved into one file each, in order, and deleted", () => {
  const legacy = [snap(3), snap(2), snap(1)];
  const root = buildDataDir({ legacy });
  const result = runStore(root, report(`{
    list: store.readRuntimeJsonAsset("snapshots").data,
    index: store.readRuntimeJsonAsset("snapshotsIndex").data,
  }`));

  assert.deepEqual(result.list, legacy, "every restore point, as it was, newest first");
  assert.deepEqual(result.index.entries.map((entry) => entry.id), ["snap-3-1000", "snap-2-1000", "snap-1-1000"]);
  assert.equal(Object.hasOwn(result.index.entries[0], "slot"), false, "which file holds it is the store's business");
  assert.equal(existsSync(path.join(storageOf(root), "snapshots.json")), false, "the old file is gone");
  assert.deepEqual(filesOf(root), ["snap-1-1000.json", "snap-2-1000.json", "snap-3-1000.json"]);
  assert.deepEqual(readJson(path.join(storageOf(root), "snapshots", "snap-2-1000.json")), snap(2));
});

test("a turn writes the restore point it adds and deletes the one that falls off the end", () => {
  const root = buildDataDir({ legacy: [snap(2), snap(1)] });
  runStore(root, `store.readRuntimeJsonAsset("snapshots");`);
  // Marks a stored file: a write that rewrote it would drop the mark.
  const kept = path.join(storageOf(root), "snapshots", "snap-2-1000.json");
  writeJson(kept, { ...snap(2), untouched: true });

  const result = runStore(root, `
    const before = store.readRuntimeJsonAsset("snapshots").data;
    // What captureRollbackSnapshot sends, kept to two here: the new one in front.
    store.writeRuntimeJsonAsset("snapshots", [${JSON.stringify(snap(3))}, ...before].slice(0, 2), { readBack: false });
    ${report(`{ list: store.readRuntimeJsonAsset("snapshots").data }`)}
  `);

  assert.deepEqual(result.list.map((entry) => entry.id), ["snap-3-1000", "snap-2-1000"]);
  assert.equal(readJson(kept).untouched, true, "the restore point already stored was not written again");
  assert.deepEqual(filesOf(root), ["snap-2-1000.json", "snap-3-1000.json"], "the oldest one's file is gone");
});

test("an undo deletes the newest restore point's file, and the index follows", () => {
  const root = buildDataDir({ legacy: [snap(3), snap(2), snap(1)] });
  const result = runStore(root, `
    const list = store.readRuntimeJsonAsset("snapshots").data;
    store.writeRuntimeJsonAsset("snapshots", list.slice(1));
    ${report(`{ index: store.readRuntimeJsonAsset("snapshotsIndex").data }`)}
  `);
  assert.deepEqual(result.index.entries.map((entry) => entry.id), ["snap-2-1000", "snap-1-1000"]);
  assert.deepEqual(filesOf(root), ["snap-1-1000.json", "snap-2-1000.json"]);
});

test("a restore point changed under the same id is written again", () => {
  const root = buildDataDir({ legacy: [snap(1)] });
  const changed = snap(1, { capturedAt: "2026-09-29T00:00:00.000Z", state: { world: { note: "taken again" } } });
  const result = runStore(root, `
    store.readRuntimeJsonAsset("snapshots");
    store.writeRuntimeJsonAsset("snapshots", [${JSON.stringify(changed)}]);
    ${report(`{ list: store.readRuntimeJsonAsset("snapshots").data }`)}
  `);
  assert.deepEqual(result.list, [changed]);
});

test("restore points without ids, or sharing one, each keep a file of their own", () => {
  const legacy = [{ round: 2, state: { n: 2 } }, { round: 1, state: { n: 1 } }, { id: "x/../y", round: 0, state: { n: 0 } }, { id: "dup", state: { n: -1 } }, { id: "dup", state: { n: -2 } }];
  const root = buildDataDir({ legacy });
  const result = runStore(root, report(`{ list: store.readRuntimeJsonAsset("snapshots").data }`));
  assert.deepEqual(result.list, legacy);
  assert.equal(filesOf(root).length, 5);
  assert.ok(filesOf(root).every((name) => /^[A-Za-z0-9_-]+\.json$/.test(name)), "no id reaches a file name unchecked");
});

test("a snapshots.json that does not parse reads as none and is kept aside, not deleted", () => {
  const root = buildDataDir();
  writeFileSync(path.join(storageOf(root), "snapshots.json"), "{ not json", "utf-8");
  const result = runStore(root, report(`{ list: store.readRuntimeJsonAsset("snapshots").data }`));
  assert.deepEqual(result.list, []);
  assert.equal(readFileSync(path.join(storageOf(root), "snapshots.json.unreadable"), "utf-8"), "{ not json");
});

test("an export and an import carry every restore point, into files of the new game", () => {
  const legacy = [snap(2), snap(1)];
  const root = buildDataDir({ legacy });
  const result = runStore(root, `
    const snapshots = store.readGameSnapshots("${GAME}");
    const imported = store.importGameBundle(store.exportGameBundle("${GAME}"));
    store.writeGameSnapshots(imported.game.id, snapshots);
    ${report(`{ id: imported.game.id, sent: snapshots, received: store.readGameSnapshots(imported.game.id) }`)}
  `);
  assert.deepEqual(result.sent, legacy);
  assert.deepEqual(result.received, legacy);
  const dir = path.join(root, "games", result.id, "storage", "snapshots");
  assert.deepEqual(readdirSync(dir).sort(), ["snap-1-1000.json", "snap-2-1000.json"]);
});

test("the owner-rename migration discards every restore-point file", () => {
  const root = buildDataDir({ legacy: [snap(1)] });
  runStore(root, `store.readRuntimeJsonAsset("snapshots");`);
  assert.equal(filesOf(root).length, 1);
  // A code-keyed world: the next read migrates it, and restore points taken
  // before the rename would restore code-keyed state.
  writeJson(path.join(root, "games", GAME, "world.json"), { regionOwnershipOverrides: { r1: "USA" }, ownerCodes: ["USA"] });
  const result = runStore(root, report(`{ list: store.readRuntimeJsonAsset("snapshots").data }`));
  assert.deepEqual(result.list, []);
  assert.equal(existsSync(path.join(storageOf(root), "snapshots")), false);
  assert.equal(existsSync(path.join(storageOf(root), "snapshots-index.json")), false);
});

test("the slot plan reuses what is stored and names the rest", () => {
  const slotFor = (id, attempt) => `${id || "rp"}${attempt ? `-${attempt}` : ""}`;
  const first = planRestorePointSlots([], [snap(2), snap(1)], { slotFor });
  assert.deepEqual(first.writes.map((write) => write.slot), ["snap-2-1000", "snap-1-1000"]);
  const next = planRestorePointSlots(first.entries, [snap(3), snap(2)], { slotFor });
  assert.deepEqual(next.writes.map((write) => write.slot), ["snap-3-1000"]);
  assert.deepEqual(next.drops, ["snap-1-1000"]);
  const all = planRestorePointSlots(first.entries, [snap(2), snap(1)], { slotFor, reuse: false });
  assert.equal(all.writes.length, 2, "reuse: false writes every one again");
  assert.deepEqual(all.drops, []);
});
