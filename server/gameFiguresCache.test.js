/*! Open Historia - a save write re-reads only the game it wrote © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every store write drops the library catalogs, and the rebuild used to parse
// game.json, actions.json and events.json of EVERY game to count events and
// pending orders — a full-library parse on the event loop after each chat
// line, order and turn commit. Those figures are now kept per game, stamped on
// the three files, so a rebuild re-reads only the game that changed.
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

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a write to the active game re-reads its figures and no other game's", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-figures-"));
  roots.push(root);
  const script = `
    const fs = (await import("node:fs")).default;
    const path = await import("node:path");
    const store = await import(${JSON.stringify(STORE_URL)});
    const dataDir = process.env.OH_DATA_DIR;
    const eventsOf = (id) => path.join(dataDir, "games", id, "storage", "events.json");

    store.createScenario({ id: "vinland", name: "Vinland" });
    store.createGame({ id: "idle", scenarioId: "vinland" });
    store.createGame({ id: "playing", scenarioId: "vinland", setActive: true });
    store.getGameCatalog();

    const reads = [];
    const readFileSync = fs.readFileSync;
    fs.readFileSync = function (target, ...rest) {
      reads.push(path.resolve(String(target)));
      return readFileSync.call(this, target, ...rest);
    };
    store.writeRuntimeJsonAsset("events", [{ id: "e1" }, { id: "e2" }], { readBack: false });
    const catalog = store.getGameCatalog();
    fs.readFileSync = readFileSync;
    const countOf = (list, id) => list.games.find((game) => game.id === id).eventCount;
    const idleReads = reads.filter((file) => file === path.resolve(eventsOf("idle"))).length;
    const playingReads = reads.filter((file) => file === path.resolve(eventsOf("playing"))).length;

    // A file changed behind the store's back is still noticed: its stamp moved.
    fs.writeFileSync(eventsOf("idle"), JSON.stringify([{ id: "x" }, { id: "y" }, { id: "z" }]));
    store.writeRuntimeJsonAsset("chat", [], { readBack: false });
    const after = store.getGameCatalog();
    process.stdout.write("\\n@@" + JSON.stringify({
      idleReads, playingReads,
      playingCount: countOf(catalog, "playing"),
      idleCountAfter: countOf(after, "idle"),
    }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
  assert.equal(result.idleReads, 0, "the game nobody wrote is not parsed again");
  assert.equal(result.playingReads, 1);
  assert.equal(result.playingCount, 2);
  assert.equal(result.idleCountAfter, 3);
});
