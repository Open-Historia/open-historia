import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createScenarioId,
  requestJson,
  startLocalServer,
} from "./smoke-helpers.mjs";

const log = (message) => {
  console.log(`[gameplay-smoke] ${message}`);
};

const createJsonBody = (value) => ({
  body: JSON.stringify(value),
  headers: { "Content-Type": "application/json" },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameplaySourcePath = path.resolve(__dirname, "..", "src", "Game", "AI", "gameplay.js");
const gameplayTempPath = path.resolve(__dirname, "..", "src", "Game", "AI", ".gameplay-smoke-temp.mjs");

const createLocalStorage = () => {
  const store = new Map();

  return {
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => store.set(key, String(value)),
  };
};

const scenarioId = createScenarioId("smoke-gameplay");
let server = null;
let createdScenarioId = null;

try {
  server = await startLocalServer({ port: 4702 });
  log(`server started at ${server.baseUrl}`);

  const created = await requestJson(server.baseUrl, "/api/scenarios", {
    ...createJsonBody({
      baseSaveId: "save0",
      description: "Temporary gameplay smoke test scenario",
      eyebrow: "Gameplay Smoke",
      heroSubtitle: "Local gameplay AI verification",
      heroTitle: "Gameplay Smoke",
      id: scenarioId,
      name: "Gameplay Smoke",
      seedScenarioId: "default",
      setActive: true,
      subtitle: "temporary gameplay test",
    }),
    method: "POST",
  });
  createdScenarioId = created.scenario.id;

  await requestJson(server.baseUrl, `/api/scenarios/${encodeURIComponent(createdScenarioId)}`, {
    ...createJsonBody({
      game: {
        country: "Germany",
        difficulty: "standard",
        gameDate: "2026-04-01",
        language: "English",
        round: 1,
        startDate: "2026-01-01",
      },
      world: {
        difficulty: "standard",
        language: "English",
        simulationRules: "Polities should behave logically and react to visible preparations.",
        startingTimelineText: "Europe is tense, but no general war has yet begun.",
      },
    }),
    method: "PUT",
  });

  await requestJson(server.baseUrl, "/api/runtime/json/actions", {
    ...createJsonBody([]),
    method: "PUT",
  });
  await requestJson(server.baseUrl, "/api/runtime/json/advisor", {
    ...createJsonBody([]),
    method: "PUT",
  });
  await requestJson(server.baseUrl, "/api/runtime/json/chat", {
    ...createJsonBody([]),
    method: "PUT",
  });
  await requestJson(server.baseUrl, "/api/runtime/json/events", {
    ...createJsonBody([]),
    method: "PUT",
  });

  globalThis.window = { location: { origin: server.baseUrl } };
  globalThis.localStorage = createLocalStorage();
  globalThis.caches = undefined;
  if (!globalThis.URL) {
    globalThis.URL = class URLShim {};
  }
  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = () => "blob:smoke";
  }
  if (!globalThis.URL.revokeObjectURL) {
    globalThis.URL.revokeObjectURL = () => {};
  }
  globalThis.window.URL = globalThis.URL;
  globalThis.window.webkitURL = globalThis.URL;

  const assets = await import("../src/runtime/assets.js");
  assets.setRuntimeAssetEndpoints({ token: "" });
  const absoluteUrl = (pathname) => new URL(pathname, server.baseUrl).toString();
  assets.JSON_URLS.actions = absoluteUrl("/api/runtime/json/actions");
  assets.JSON_URLS.advisor = absoluteUrl("/api/runtime/json/advisor");
  assets.JSON_URLS.chat = absoluteUrl("/api/runtime/json/chat");
  assets.JSON_URLS.colors = absoluteUrl("/api/runtime/json/colors");
  assets.JSON_URLS.events = absoluteUrl("/api/runtime/json/events");
  assets.JSON_URLS.game = absoluteUrl("/api/runtime/json/game");
  assets.JSON_URLS.prompts = absoluteUrl("/api/runtime/json/prompts");
  assets.JSON_URLS.world = absoluteUrl("/api/runtime/json/world");
  assets.PMTILES_ARCHIVES.cities = absoluteUrl("/api/runtime/pmtiles/cities");
  assets.PMTILES_ARCHIVES.countries = absoluteUrl("/api/runtime/pmtiles/countries");
  assets.PMTILES_ARCHIVES.regions = absoluteUrl("/api/runtime/pmtiles/regions");
  assets.PMTILES_PROTOCOL_URLS.cities = `pmtiles://${assets.PMTILES_ARCHIVES.cities}`;
  assets.PMTILES_PROTOCOL_URLS.countries = `pmtiles://${assets.PMTILES_ARCHIVES.countries}`;
  assets.PMTILES_PROTOCOL_URLS.regions = `pmtiles://${assets.PMTILES_ARCHIVES.regions}`;

  const gameplaySource = await readFile(gameplaySourcePath, "utf-8");
  await writeFile(
    gameplayTempPath,
    gameplaySource.replace(
      'import { callAI } from "./main.jsx";',
      'const callAI = async () => { throw new Error("offline smoke"); };',
    ),
    "utf-8",
  );
  const gameplay = await import(`${pathToFileURL(gameplayTempPath).href}?t=${Date.now()}`);

  const refined = await gameplay.refinePlayerAction(
    "Open talks with France about steel tariffs and Rhine shipping.",
  );
  assert.equal(refined.kind, "chat");
  log("description-to-action flow works");

  const storedActions = await requestJson(server.baseUrl, "/api/runtime/json/actions");
  assert.ok(Array.isArray(storedActions));
  assert.equal(storedActions.length, 1);
  assert.equal(storedActions[0].kind, "chat");

  const suggestions = await gameplay.generateActionSuggestions();
  assert.ok(Array.isArray(suggestions));
  assert.ok(suggestions.length > 0);
  log("action suggestion generation works");

  const worldAfterSuggestions = await requestJson(server.baseUrl, "/api/runtime/json/world");
  assert.ok(Array.isArray(worldAfterSuggestions.actionSuggestions));
  assert.ok(worldAfterSuggestions.actionSuggestions.length > 0);

  const jumpResult = await gameplay.simulateTimelineJump({ days: 30 });
  assert.equal(jumpResult.game.gameDate, "2026-05-01");
  assert.equal(jumpResult.game.round, 2);
  assert.ok(Array.isArray(jumpResult.events));
  assert.ok(jumpResult.events.length > 0);
  log("timeline simulation writes game and event state");

  const longJumpResult = await gameplay.simulateTimelineJump({ days: 90 });
  assert.equal(longJumpResult.game.gameDate, "2026-07-30");
  assert.equal(longJumpResult.game.round, 3);
  assert.ok(Array.isArray(longJumpResult.events));
  assert.ok(longJumpResult.events.length > 0);
  assert.ok(typeof longJumpResult.world?.activeCatalyst?.choices?.[0]?.text === "string");
  log("long timeline simulation stays responsive and normalizes catalyst choices");

  const runtimeEvents = await requestJson(server.baseUrl, "/api/runtime/json/events");
  assert.ok(Array.isArray(runtimeEvents));
  assert.ok(runtimeEvents.length > 0);

  const runtimeChats = await requestJson(server.baseUrl, "/api/runtime/json/chat");
  assert.ok(Array.isArray(runtimeChats));
  assert.ok(runtimeChats.length > 0);
  assert.equal(runtimeChats[0].source, "invitation");
  log("timeline simulation can create follow-up diplomacy");

  const runtimeActions = await requestJson(server.baseUrl, "/api/runtime/json/actions");
  assert.equal(runtimeActions[0].status, "resolved");

  const runtimeWorld = await requestJson(server.baseUrl, "/api/runtime/json/world");
  assert.equal(runtimeWorld.lastJumpMode, "jump");
  assert.ok(runtimeWorld.lastJumpSummary);
  assert.ok(Array.isArray(runtimeWorld.simulationHistory));
  assert.ok(runtimeWorld.simulationHistory.length > 0);
  assert.equal(runtimeWorld.simulationHistory[0].fromDate, "2026-05-01");
  assert.ok(Array.isArray(runtimeWorld.simulationHistory[0].plannedActions));
  assert.ok(typeof runtimeWorld.activeCatalyst?.choices?.[0]?.text === "string");
  log("world state records jump summaries and history");

  await requestJson(server.baseUrl, `/api/scenarios/${encodeURIComponent(createdScenarioId)}`, {
    method: "DELETE",
  });
  createdScenarioId = null;

  log("gameplay smoke test passed");
} catch (error) {
  console.error(`[gameplay-smoke] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (server && createdScenarioId) {
    try {
      await requestJson(server.baseUrl, `/api/scenarios/${encodeURIComponent(createdScenarioId)}`, {
        method: "DELETE",
      });
    } catch {
      // Best-effort cleanup only.
    }
  }

  if (server) {
    await server.stop();
  }

  try {
    await rm(gameplayTempPath, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}
