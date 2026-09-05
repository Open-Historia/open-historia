// What decides which save the game writes into.
//
// getGameCatalog resolves the active game, and writeRuntimeJsonAsset writes into
// whatever it resolved. When those two disagree with the player's expectation the
// failure is not cosmetic: a turn's world, events and chat land in a DIFFERENT
// save and overwrite it. That happened — a game whose game-instance.json was
// missing was dropped from the library, the manifest was silently repointed at
// the next game in the list, and writes started landing there.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time, so one process can only ever see one data directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, describe, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

// A data dir holding two complete games, `active` recorded as the active one.
const buildDataDir = ({ active, ids = ["game-alpha", "game-beta"] }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-catalog-"));
  roots.push(root);

  for (const id of ids) {
    const dir = path.join(root, "games", id);
    writeJson(path.join(dir, "game-instance.json"), {
      id,
      name: id,
      scenarioId: "new-scenario",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    // The world carries the owner-schema marker so reading it never triggers the
    // migration, which would delete files this test is watching.
    writeJson(path.join(dir, "world.json"), { ownerSchema: OWNER_SCHEMA });
    writeJson(path.join(dir, "game.json"), { country: "Testland", gameDate: "2032-11-15", round: 10 });
    writeJson(path.join(dir, "colors.json"), {});
    writeJson(path.join(dir, "prompts.json"), {});
    for (const key of ["actions", "advisor", "chat", "events", "snapshots"]) {
      writeJson(path.join(dir, "storage", `${key}.json`), []);
    }
  }

  writeJson(path.join(root, "game-manifest.json"), { activeGameId: active, order: ids, version: 2 });
  return root;
};

// Resolves the catalog and performs one runtime write, in a child process bound
// to `root`. Returns what the catalog decided and where the write actually went.
const probe = (root) => {
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const catalog = store.getGameCatalog();
    const written = store.writeRuntimeJsonAsset("snapshots", [{ id: "probe" }]);
    process.stdout.write(JSON.stringify({
      activeGameId: catalog.activeGameId,
      listed: catalog.games.map((game) => game.id),
      wroteTo: written.sourcePath,
    }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
  });
  return JSON.parse(out);
};

const manifestOf = (root) => JSON.parse(readFileSync(path.join(root, "game-manifest.json"), "utf-8"));

after(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true });
});

describe("game catalog: which save gets written", () => {
  test("a healthy library writes into the game the manifest names", () => {
    const root = buildDataDir({ active: "game-beta" });

    const result = probe(root);

    assert.equal(result.activeGameId, "game-beta");
    assert.match(result.wroteTo, /game-beta/);
    assert.equal(manifestOf(root).activeGameId, "game-beta");
  });

  test("the active game survives a missing game-instance.json", () => {
    // The regression: metadata is cosmetic, but losing it used to unlist the
    // game AND repoint the manifest, so the next write overwrote game-alpha.
    const root = buildDataDir({ active: "game-beta" });
    rmSync(path.join(root, "games", "game-beta", "game-instance.json"));

    const result = probe(root);

    assert.equal(result.activeGameId, "game-beta", "must not hand off over a missing meta file");
    assert.ok(result.listed.includes("game-beta"), "the save must stay in the library");
    assert.match(result.wroteTo, /game-beta/);
    assert.equal(manifestOf(root).activeGameId, "game-beta");
    // The bystander save must be untouched.
    const alpha = path.join(root, "games", "game-alpha", "storage", "snapshots.json");
    assert.deepEqual(JSON.parse(readFileSync(alpha, "utf-8")), []);
  });

  test("a genuinely deleted active game hands off to another save", () => {
    const root = buildDataDir({ active: "game-beta" });
    rmSync(path.join(root, "games", "game-beta"), { force: true, recursive: true });

    const result = probe(root);

    assert.equal(result.activeGameId, "game-alpha");
    assert.match(result.wroteTo, /game-alpha/);
    assert.equal(manifestOf(root).activeGameId, "game-alpha");
  });
});

// Opens the game editor's read the way the UI does, then saves an edit through
// it, in a child process bound to `root`.
const probeEditor = (root, gameId) => {
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const listed = store.getGameCatalog().games.map((game) => game.id);
    const details = store.getGameDetails(${JSON.stringify(gameId)});
    const saved = store.updateGame(${JSON.stringify(gameId)}, { name: "Renamed" });
    process.stdout.write(JSON.stringify({
      listed,
      scenarioId: details.game.scenarioId,
      scenarioMissing: details.scenario?.missing === true,
      scenarioName: details.scenario?.name ?? null,
      country: details.data.game?.country ?? null,
      savedName: saved.game.name,
    }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
  });
  return JSON.parse(out);
};

// A save is its game.json, not its scenario. getGameDetails used to hard-throw
// "Scenario not found" when the scenario a game names was gone — a ported save,
// or a scenario deleted after the games made from it — which GET
// /api/games/:gameId returned as a 404 and the Edit button swallowed. The game
// listed and played the whole time, because buildGameCatalog was already
// tolerant; only the detail read and the update path were not.
describe("game catalog: a game whose scenario is gone", () => {
  test("lists, opens in the editor, and saves an edit", () => {
    const root = buildDataDir({ active: "game-alpha" });
    // Name a scenario that certainly is not in the store.
    const metaPath = path.join(root, "games", "game-alpha", "game-instance.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    writeJson(metaPath, { ...meta, scenarioId: "scenario-that-was-deleted" });

    const result = probeEditor(root, "game-alpha");

    assert.ok(result.listed.includes("game-alpha"), "the save stays in the library");
    assert.equal(result.scenarioId, "scenario-that-was-deleted");
    assert.equal(result.scenarioMissing, true, "the editor is told the scenario is absent");
    assert.equal(result.scenarioName, "scenario-that-was-deleted", "and is shown which scenario, not a default name");
    assert.equal(result.country, "Testland", "the game's own data still reads");
    assert.equal(result.savedName, "Renamed", "and an edit saves through it");
  });
});

// The runtime geometry write, in a child process bound to `root`: whether it
// threw, and whether anything appeared under scenarios/ afterwards.
const probeGeometryWrite = (root) => {
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    let error = "";
    try {
      store.writeRuntimeJsonAsset("citiesGeojson", { type: "FeatureCollection", features: [] });
    } catch (caught) {
      error = String(caught?.message || caught);
    }
    const first = store.getGameDetails("game-alpha").scenario.cacheToken;
    const second = store.getGameDetails("game-alpha").scenario.cacheToken;
    process.stdout.write(JSON.stringify({ error, first, second }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
  });
  return JSON.parse(out);
};

describe("game catalog: a game whose scenario is gone, on the write side", () => {
  test("a geometry edit is refused rather than recreating the scenario", () => {
    // The placeholder that lets the editor open must not reach the write path:
    // writeRuntimeJsonAsset used to create scenarios/<deleted-id>/ from it and,
    // through writeScenarioMeta, a scenario.json that listed a hollow "Modern
    // Day" in the library.
    const root = buildDataDir({ active: "game-alpha", ids: ["game-alpha"] });
    const metaPath = path.join(root, "games", "game-alpha", "game-instance.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    writeJson(metaPath, { ...meta, scenarioId: "scenario-that-was-deleted" });
    const result = probeGeometryWrite(root);
    assert.match(result.error, /Scenario not found/);
    assert.equal(existsSync(path.join(root, "scenarios", "scenario-that-was-deleted")), false, "nothing is created for it");
    // The degraded summary is one value, not a fresh timestamp per read.
    assert.equal(result.first, result.second);
    assert.equal(result.first, "scenario-that-was-deleted-missing");
  });
});
