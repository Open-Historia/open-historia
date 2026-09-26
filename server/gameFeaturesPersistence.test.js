/*! Open Historia — feature settings persist on scenarios and games © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/gameFeaturesPersistence.test.js
//
// A scenario's Features tab is the default for every game made from it; a game
// stores only what it overrides. Both have to survive the store (a write, a
// read back, the catalog the library shows the client) and travel in bundles,
// or the tab would look saved and the game would play with the defaults.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time, so one process only ever sees one data directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";

// A complete configuration carries every feature; these tests are about the two
// named in them, so the director rides along at its defaults.
const WORLD_DIRECTION_DEFAULTS = { enabled: true, eventPace: 100, worldShare: 35, priorityRules: "", scriptedEvents: [], territoryTempo: 0 };
const PLAYER_FOCUS_DEFAULTS = { enabled: true, level: "balanced" };
const PUPPET_STATES_DEFAULTS = { enabled: true };
const PREGAME_HISTORY_DEFAULTS = { enabled: true };

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

// One scenario of the author's own and one game played on it. Not the built-in
// "default": the store re-seeds that id on first use and moves an unfamiliar one
// aside as "modern-day-classic", repointing the game with it.
const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-features-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "hand-drawn");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "hand-drawn", name: "Hand Drawn World", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "2030-01-01" });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["hand-drawn"], selectedScenarioId: "hand-drawn", version: 2 });
  const gameDir = path.join(root, "games", "campaign");
  writeJson(path.join(gameDir, "game-instance.json"), { id: "campaign", name: "Campaign", scenarioId: "hand-drawn", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(gameDir, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(gameDir, "game.json"), { country: "Testland", gameDate: "2030-01-01", round: 1 });
  writeJson(path.join(gameDir, "colors.json"), {});
  writeJson(path.join(gameDir, "prompts.json"), {});
  for (const key of ["actions", "advisor", "chat", "events", "snapshots"]) writeJson(path.join(gameDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "campaign", order: ["campaign"], version: 2 });
  return root;
};

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

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a scenario stores a complete configuration and a game only its overrides", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    store.updateScenario("hand-drawn", { features: { espionage: { enabled: false }, idleDiplomacy: { averageMinutes: 30 }, pregameHistory: { enabled: false } } });
    store.updateGame("campaign", { features: { idleDiplomacy: { enabled: false }, nonsense: { enabled: false } } });
    const scenario = store.getScenarioDetails("hand-drawn").scenario;
    const game = store.getGameDetails("campaign");
    const catalog = store.getGameCatalog();
    ${report(`{
      scenario: scenario.features,
      game: game.game.features,
      gameScenario: game.scenario.features,
      catalog: catalog.games.find((entry) => entry.id === "campaign").features,
      untouchedName: scenario.name,
    }`)}
  `);
  assert.deepEqual(result.scenario, { espionage: { enabled: false }, idleDiplomacy: { enabled: true, averageMinutes: 30 }, puppetStates: PUPPET_STATES_DEFAULTS, pregameHistory: { enabled: false }, worldDirection: WORLD_DIRECTION_DEFAULTS, playerFocus: PLAYER_FOCUS_DEFAULTS });
  assert.deepEqual(result.game, { idleDiplomacy: { enabled: false } });
  assert.deepEqual(result.gameScenario, result.scenario);
  assert.deepEqual(result.catalog, result.game);
  assert.equal(result.untouchedName, "Hand Drawn World");
});

test("a save that does not mention features keeps them, and a fresh install reads defaults", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const before = store.getScenarioDetails("hand-drawn").scenario.features;
    store.updateScenario("hand-drawn", { features: { espionage: false } });
    store.updateScenario("hand-drawn", { name: "Renamed" });
    store.updateGame("campaign", { features: { espionage: { enabled: true } } });
    store.updateGame("campaign", { name: "Renamed campaign" });
    ${report(`{
      before,
      scenario: store.getScenarioDetails("hand-drawn").scenario.features,
      game: store.getGameDetails("campaign").game.features,
    }`)}
  `);
  assert.deepEqual(result.before, { espionage: { enabled: true }, idleDiplomacy: { enabled: true, averageMinutes: 8 }, puppetStates: PUPPET_STATES_DEFAULTS, pregameHistory: PREGAME_HISTORY_DEFAULTS, worldDirection: WORLD_DIRECTION_DEFAULTS, playerFocus: PLAYER_FOCUS_DEFAULTS });
  assert.equal(result.scenario.espionage.enabled, false);
  assert.deepEqual(result.game, { espionage: { enabled: true } });
});

test("bundles carry the configuration, and a game cloned from a game keeps its overrides", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    store.updateScenario("hand-drawn", { features: { idleDiplomacy: { enabled: false }, pregameHistory: { enabled: false } } });
    store.updateGame("campaign", { features: { espionage: { enabled: false } } });
    const scenarioBundle = store.exportScenarioBundle("hand-drawn");
    const gameBundle = store.exportGameBundle("campaign");
    const importedGame = store.importGameBundle(gameBundle);
    const cloned = store.createGame({ name: "Clone", seedGameId: "campaign" });
    const fromScenario = store.createGame({ name: "Fresh", scenarioId: "hand-drawn" });
    ${report(`{
      scenarioBundle: scenarioBundle.scenario.features,
      gameBundle: gameBundle.game.features,
      imported: store.getGameDetails(importedGame.game.id).game.features,
      cloned: store.getGameDetails(cloned.game.id).game.features,
      fromScenario: store.getGameDetails(fromScenario.game.id).game.features,
    }`)}
  `);
  assert.equal(result.scenarioBundle.idleDiplomacy.enabled, false);
  assert.equal(result.scenarioBundle.pregameHistory.enabled, false);
  assert.deepEqual(result.gameBundle, { espionage: { enabled: false } });
  assert.deepEqual(result.imported, { espionage: { enabled: false } });
  assert.deepEqual(result.cloned, { espionage: { enabled: false } });
  assert.deepEqual(result.fromScenario, {});
});

test("composable scripted-event rules survive scenario persistence with canonical ids intact", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    store.updateScenario("hand-drawn", {
      features: {
        worldDirection: {
          scriptedEvents: [{
            id: "two-of-three",
            date: "2030-03-01",
            text: "A conditional event.",
            trigger: {
              mode: "rules",
              operator: "at_least",
              requiredCount: 2,
              percent: 50,
              conditions: [
                { type: "polity_exists", polityId: "Testland" },
                { type: "institution_member_status", institutionId: "league", polityId: "Testland", status: "observer" },
                { type: "polity_subordinate_to", polityId: "Testland", overlordId: "Overlord", kind: "client" },
              ],
            },
          }],
        },
      },
    });
    ${report(`store.getScenarioDetails("hand-drawn").scenario.features.worldDirection.scriptedEvents`)}
  `);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].trigger, {
    mode: "rules",
    operator: "at_least",
    requiredCount: 2,
    conditions: [
      { type: "polity_exists", polityId: "Testland" },
      { type: "institution_member_status", polityId: "Testland", institutionId: "league", status: "observer" },
      { type: "polity_subordinate_to", polityId: "Testland", overlordId: "Overlord", kind: "client" },
    ],
    percent: 50,
  });
});
