/*! Open Historia - duplicating a game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// createGame with seedGameId copies a save. It used to copy the files first and
// look the source's scenario up afterwards, which throws when the scenario is
// gone (a game imported without its map): the clone failed, and the half-made
// directory — game.json and all — then listed as a "Modern Day Session".
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
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-clone-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dataDir = process.env.OH_DATA_DIR;
    const gameIds = () => fs.readdirSync(path.join(dataDir, "games")).sort();
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

test("a game whose scenario is gone duplicates, keeping its scenario and the name its sender gave it", () => {
  const result = run(`
    store.createScenario({ id: "lost", name: "Lost Lands" });
    store.createGame({ id: "source", name: "Campaign", scenarioId: "lost" });
    const metaPath = path.join(dataDir, "games", "source", "game-instance.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, importedScenarioName: "Lost Lands" }));
    fs.rmSync(path.join(dataDir, "scenarios", "lost"), { recursive: true, force: true });
    // Any store write drops the catalogs, which cached the files as they were.
    store.updateGame("source", { name: "Campaign" });
    const before = gameIds();
    const clone = store.createGame({ id: "copy", seedGameId: "source" });
    const listed = store.getLibraryCatalog().games.map((game) => ({
      id: game.id, name: game.name, scenarioId: game.scenarioId, scenarioName: game.scenarioName, scenarioMissing: game.scenarioMissing,
    }));
    ${report(`{ before, after: gameIds(), cloneId: clone.game.id, listed }`)}
  `);
  assert.equal(result.cloneId, "copy");
  assert.deepEqual(result.after, [...result.before, "copy"].sort());
  const copy = result.listed.find((game) => game.id === "copy");
  assert.deepEqual(copy, {
    id: "copy",
    name: "Campaign Session",
    scenarioId: "lost",
    scenarioName: "Lost Lands",
    scenarioMissing: true,
  });
  assert.equal(result.listed.filter((game) => game.name === "Modern Day Session").length, 0);
});

test("a create that is refused leaves no directory behind", () => {
  const result = run(`
    store.getLibraryCatalog();
    const before = gameIds();
    let error = "";
    try {
      store.createGame({ id: "orphan", scenarioId: "no-such-scenario" });
    } catch (caught) {
      error = caught.message;
    }
    ${report(`{ before, after: gameIds(), error, listed: store.getLibraryCatalog().games.map((game) => game.id) }`)}
  `);
  assert.match(result.error, /Scenario not found/);
  assert.deepEqual(result.after, result.before);
  assert.ok(!result.listed.includes("orphan"));
});
