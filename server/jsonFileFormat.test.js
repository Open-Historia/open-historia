/*! Open Historia - how the store lays out the files it writes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Game state is written compact: indenting worlds, events and restore points
// added a large share of whitespace to every write, fsync and parse. Only the
// small files a person might edit by hand stay indented.
//
// Runs in a child process because OH_DATA_DIR is read once, at import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("game state is written compact and the hand-editable files stay indented", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-json-format-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createGame({ id: "saga", scenarioId: "vinland", setActive: true });
    store.updateGame("saga", { world: { ownerSchema: 4, notes: { a: [1, 2] } } });
    store.writeRuntimeJsonAsset("events", [{ id: "e1", title: "Landfall" }], { readBack: false });
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const text = (...parts) => readFileSync(path.join(root, ...parts), "utf-8");

  for (const file of [["games", "saga", "world.json"], ["games", "saga", "storage", "events.json"]]) {
    const raw = text(...file);
    assert.ok(!raw.includes("\n"), `${file.join("/")} is compact`);
  }
  assert.deepEqual(JSON.parse(text("games", "saga", "world.json")).notes, { a: [1, 2] });

  for (const file of [["games", "saga", "game-instance.json"], ["scenarios", "vinland", "scenario.json"], ["game-manifest.json"], ["scenario-manifest.json"]]) {
    assert.match(text(...file), /\n {2}"/, `${file.join("/")} stays indented`);
  }
});
