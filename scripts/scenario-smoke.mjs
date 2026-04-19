import assert from "node:assert/strict";
import {
  createScenarioId,
  request,
  requestJson,
  startLocalServer,
} from "./smoke-helpers.mjs";

const log = (message) => {
  console.log(`[scenario-smoke] ${message}`);
};

const createJsonBody = (value) => ({
  body: JSON.stringify(value),
  headers: { "Content-Type": "application/json" },
});

const scenarioId = createScenarioId("smoke-scenario");
let server = null;
let createdScenarioId = null;

try {
  server = await startLocalServer();
  log(`server started at ${server.baseUrl}`);

  const initialCatalog = await requestJson(server.baseUrl, "/api/scenarios");
  assert.ok(Array.isArray(initialCatalog.scenarios), "Scenario catalog did not return an array.");
  assert.ok(initialCatalog.scenarios.some((scenario) => scenario.id === "default"));
  assert.equal(initialCatalog.activeScenarioId, "default");
  log("catalog endpoint is healthy");

  const createPayload = {
    baseSaveId: "save0",
    description: "Temporary smoke test scenario",
    eyebrow: "Smoke Test",
    heroSubtitle: "Local scenario API verification",
    heroTitle: "Smoke Scenario",
    id: scenarioId,
    name: "Smoke Scenario",
    seedScenarioId: "default",
    subtitle: "temporary local test",
  };

  const created = await requestJson(server.baseUrl, "/api/scenarios", {
    ...createJsonBody(createPayload),
    method: "POST",
  });
  createdScenarioId = created.scenario.id;
  assert.equal(createdScenarioId, scenarioId);
  log(`created scenario ${createdScenarioId}`);

  const updatedPrompts = {
    advisor:
      "You are the smoke advisor for ${country}. Reply with the exact token ADVISOR_SCENARIO_SMOKE and a short sentence dated ${date}.",
    leader:
      "You are the smoke diplomat for ${country}. Reply with the exact token LEADER_SCENARIO_SMOKE and one short sentence.",
  };
  const updatedGame = {
    country: "Smoke Republic",
    difficulty: "standard",
    gameDate: "2026-02-02",
    language: "English",
    round: 3,
    startDate: "2026-01-01",
  };
  const updatedWorld = {
    difficulty: "standard",
    language: "English",
    simulationRules: "Smoke rules",
    startingTimelineText: "Smoke world before round one",
  };
  const updatedScenario = await requestJson(
    server.baseUrl,
    `/api/scenarios/${encodeURIComponent(createdScenarioId)}`,
    {
      ...createJsonBody({
        accentColor: "#1d9bf0",
        countryNameOverrides: {
          USA: "United States Smoke",
        },
        description: "Updated temporary smoke test scenario",
        game: updatedGame,
        heroSubtitle: "Updated smoke subtitle",
        prompts: updatedPrompts,
        subtitle: "updated temporary local test",
        world: updatedWorld,
      }),
      method: "PUT",
    },
  );
  assert.equal(updatedScenario.data.game.country, "Smoke Republic");
  assert.equal(updatedScenario.data.prompts.advisor, updatedPrompts.advisor);
  assert.equal(updatedScenario.data.world.simulationRules, updatedWorld.simulationRules);
  log("scenario update endpoint works");

  const customColors = { SMK: [10, 20, 30] };
  const uploadedAssetDetails = await requestJson(
    server.baseUrl,
    `/api/scenarios/${encodeURIComponent(createdScenarioId)}/assets/colors`,
    {
      body: JSON.stringify(customColors),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  );
  assert.equal(uploadedAssetDetails.assetStatus.colors, true);
  log("asset upload endpoint works");

  const activatedCatalog = await requestJson(server.baseUrl, "/api/scenarios/active", {
    ...createJsonBody({ scenarioId: createdScenarioId }),
    method: "PUT",
  });
  assert.equal(activatedCatalog.activeScenarioId, createdScenarioId);
  log("scenario activation works");

  const runtimeGame = await requestJson(server.baseUrl, "/api/runtime/json/game");
  assert.equal(runtimeGame.country, "Smoke Republic");
  assert.equal(runtimeGame.gameDate, "2026-02-02");

  const runtimePrompts = await requestJson(server.baseUrl, "/api/runtime/json/prompts");
  assert.equal(runtimePrompts.advisor, updatedPrompts.advisor);
  assert.equal(runtimePrompts.leader, updatedPrompts.leader);

  const runtimeWorld = await requestJson(server.baseUrl, "/api/runtime/json/world");
  assert.equal(runtimeWorld.simulationRules, "Smoke rules");
  assert.equal(runtimeWorld.startingTimelineText, "Smoke world before round one");

  const runtimeColors = await requestJson(server.baseUrl, "/api/runtime/json/colors");
  assert.deepEqual(runtimeColors.SMK, [10, 20, 30]);
  log("runtime JSON endpoints are wired to the active scenario");

  const pmtilesHead = await request(server.baseUrl, "/api/runtime/pmtiles/countries", {
    headers: { Range: "bytes=0-63" },
  });
  assert.equal(pmtilesHead.status, 206);
  const pmtilesBytes = new Uint8Array(await pmtilesHead.arrayBuffer());
  assert.ok(pmtilesBytes.byteLength > 0, "PMTiles range request returned no bytes.");
  log("PMTiles range streaming works");

  const removedColorAsset = await requestJson(
    server.baseUrl,
    `/api/scenarios/${encodeURIComponent(createdScenarioId)}/assets/colors`,
    {
      method: "DELETE",
    },
  );
  assert.equal(removedColorAsset.assetStatus.colors, false);
  const fallbackColors = await requestJson(server.baseUrl, "/api/runtime/json/colors");
  assert.notDeepEqual(fallbackColors.SMK, [10, 20, 30]);
  log("asset reset falls back correctly");

  const finalCatalog = await requestJson(
    server.baseUrl,
    `/api/scenarios/${encodeURIComponent(createdScenarioId)}`,
  );
  assert.equal(finalCatalog.scenario.id, createdScenarioId);
  assert.equal(finalCatalog.scenario.countryNameOverrides.USA, "United States Smoke");
  log("scenario detail endpoint is healthy");

  await requestJson(server.baseUrl, `/api/scenarios/${encodeURIComponent(createdScenarioId)}`, {
    method: "DELETE",
  });
  createdScenarioId = null;

  const afterDeleteCatalog = await requestJson(server.baseUrl, "/api/scenarios");
  assert.equal(afterDeleteCatalog.activeScenarioId, "default");
  assert.ok(!afterDeleteCatalog.scenarios.some((scenario) => scenario.id === scenarioId));
  log("scenario deletion and active-scenario fallback work");

  log("all scenario smoke checks passed");
} catch (error) {
  console.error(`[scenario-smoke] FAILED: ${error.message}`);
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
}
