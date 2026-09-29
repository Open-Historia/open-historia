/*! Open Historia - the owner-schema check follows the world on disk © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The store migrates a code-keyed (v1) world to name keys on first read and
// remembers, per record, that it checked. That memory used to outlive the
// world it described: a hub Update, or a delete and re-import under the same
// id, wrote a legacy world the store then never migrated until a restart, so
// the player owned nothing on the map.
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
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

// A v1 bundle: no ownerSchema marker, owners named by code.
const LEGACY_BUNDLE = {
  schema: "pax-historia-scenario-bundle",
  scenario: { id: "hub", name: "Hub World" },
  data: {
    game: { country: "ROM", gameDate: "0100-01-01", round: 1 },
    world: { polityOverrides: { ROM: { name: "Roman Empire" } } },
  },
  assets: {},
};

const run = (body) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-owner-cache-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dataDir = process.env.OH_DATA_DIR;
    const legacy = ${JSON.stringify(LEGACY_BUNDLE)};
    const scenarioSchema = () =>
      JSON.parse(fs.readFileSync(path.join(dataDir, "scenarios", "hub", "world.json"), "utf8")).ownerSchema ?? null;
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

test("a hub Update that brings a legacy world is migrated on the next read", () => {
  const result = run(`
    store.importScenarioBundle({ ...legacy, schema: "pax-historia-scenario-bundle/2", data: { ...legacy.data, world: { ownerSchema: ${OWNER_SCHEMA} } } });
    store.createGame({ id: "campaign", scenarioId: "hub", setActive: true });
    store.readRuntimeJsonAsset("world");
    store.readRuntimeJsonAsset("regionsGeojson");
    const beforeUpdate = scenarioSchema();
    store.updateScenarioFromBundle("hub", legacy);
    const afterUpdate = scenarioSchema();
    store.readRuntimeJsonAsset("world");
    store.readRuntimeJsonAsset("regionsGeojson");
    ${report(`{ beforeUpdate, afterUpdate, afterRead: scenarioSchema() }`)}
  `);
  assert.equal(result.beforeUpdate, OWNER_SCHEMA);
  assert.equal(result.afterUpdate, null, "the update wrote the legacy world");
  assert.equal(result.afterRead, OWNER_SCHEMA);
});

test("a scenario deleted and imported again under the same id is migrated on the next read", () => {
  const result = run(`
    store.importScenarioBundle(legacy);
    store.createGame({ id: "campaign", scenarioId: "hub", setActive: true });
    store.readRuntimeJsonAsset("world");
    store.readRuntimeJsonAsset("regionsGeojson");
    const firstRead = scenarioSchema();
    store.deleteGame("campaign");
    store.deleteScenario("hub");
    store.importScenarioBundle(legacy);
    const reimported = scenarioSchema();
    store.createGame({ id: "campaign", scenarioId: "hub", setActive: true });
    store.readRuntimeJsonAsset("world");
    store.readRuntimeJsonAsset("regionsGeojson");
    const game = JSON.parse(fs.readFileSync(path.join(dataDir, "games", "campaign", "world.json"), "utf8"));
    ${report(`{ firstRead, reimported, afterRead: scenarioSchema(), game: game.ownerSchema ?? null }`)}
  `);
  assert.equal(result.firstRead, OWNER_SCHEMA);
  assert.equal(result.reimported, null, "the re-import wrote the legacy world");
  assert.equal(result.afterRead, OWNER_SCHEMA);
  assert.equal(result.game, OWNER_SCHEMA);
});
