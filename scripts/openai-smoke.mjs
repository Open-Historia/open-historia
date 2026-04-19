import assert from "node:assert/strict";
import {
  createScenarioId,
  readKeyFile,
  requestJson,
  startLocalServer,
} from "./smoke-helpers.mjs";

const OPENAI_API_ROOT = "https://api.openai.com/v1/";

const log = (message) => {
  console.log(`[openai-smoke] ${message}`);
};

const preferredModelOrder = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4.1",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5",
];

const excludedModelHints = [
  /audio/i,
  /image/i,
  /embedding/i,
  /moderation/i,
  /tts/i,
  /whisper/i,
  /transcribe/i,
  /search/i,
  /realtime/i,
];

const extractAssistantText = (payload) => {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry?.text === "string") return entry.text;
        return "";
      })
      .join("")
      .trim();
  }

  return "";
};

const getOpenAIHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

const fetchOpenAIJson = async (pathname, apiKey, options = {}) => {
  const response = await fetch(new URL(pathname, OPENAI_API_ROOT), {
    ...options,
    headers: {
      ...getOpenAIHeaders(apiKey),
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `OpenAI ${pathname} failed: ${
        payload?.error?.message || payload?.message || `HTTP ${response.status}`
      }`,
    );
  }

  return payload;
};

const pickModel = (models) => {
  const ids = (models ?? [])
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string" && id.trim())
    .filter((id) => !excludedModelHints.some((pattern) => pattern.test(id)));

  for (const preferred of preferredModelOrder) {
    if (ids.includes(preferred)) {
      return preferred;
    }
  }

  return ids.find((id) => /^gpt/i.test(id)) || ids[0] || "";
};

const createJsonBody = (value) => ({
  body: JSON.stringify(value),
  headers: { "Content-Type": "application/json" },
});

const applyPromptVariables = (template, game, actions, chat) =>
  String(template ?? "")
    .replace(/\$\{country\}/g, game.country ?? "")
    .replace(/\$\{startdate\}/g, game.startDate ?? "")
    .replace(/\$\{date\}/g, game.gameDate ?? "")
    .replace(/\$\{actions\}/g, Array.isArray(actions) ? actions.join("\n") : "")
    .replace(/\$\{chat\}/g, JSON.stringify(chat ?? []));

const scenarioId = createScenarioId("smoke-openai");
let server = null;
let createdScenarioId = null;

try {
  const apiKey = await readKeyFile(".key");
  server = await startLocalServer({ port: 4701 });
  log(`server started at ${server.baseUrl}`);

  const created = await requestJson(server.baseUrl, "/api/scenarios", {
    ...createJsonBody({
      baseSaveId: "save0",
      description: "Temporary OpenAI smoke test scenario",
      eyebrow: "OpenAI Smoke",
      heroSubtitle: "Temporary local OpenAI verification",
      heroTitle: "OpenAI Smoke",
      id: scenarioId,
      name: "OpenAI Smoke",
      seedScenarioId: "default",
      setActive: true,
      subtitle: "temporary openai test",
    }),
    method: "POST",
  });
  createdScenarioId = created.scenario.id;

  const prompts = {
    advisor:
      "You are the smoke advisor for ${country}. Reply with the token ADVISOR_OPENAI_SMOKE exactly once, then one short sentence mentioning ${date}. No markdown.",
    descriptionToAction:
      "Reply with the token ACTION_OPENAI_SMOKE exactly once, then one short JSON object string mentioning ${country}. No markdown.",
    jumpForward:
      "Reply with the token JUMP_OPENAI_SMOKE exactly once, then one short JSON object string mentioning ${date}. No markdown.",
    leader:
      "You are the smoke diplomat for ${country}. Reply with the token LEADER_OPENAI_SMOKE exactly once, then one short sentence. No markdown.",
  };
  const game = {
    country: "Smoke Republic",
    gameDate: "2026-03-03",
    startDate: "2026-01-01",
  };

  await requestJson(server.baseUrl, `/api/scenarios/${encodeURIComponent(createdScenarioId)}`, {
    ...createJsonBody({
      game,
      prompts,
    }),
    method: "PUT",
  });

  await requestJson(server.baseUrl, "/api/scenarios/active", {
    ...createJsonBody({ scenarioId: createdScenarioId }),
    method: "PUT",
  });

  await requestJson(server.baseUrl, "/api/runtime/json/actions", {
    ...createJsonBody([]),
    method: "PUT",
  });
  await requestJson(server.baseUrl, "/api/runtime/json/chat", {
    ...createJsonBody([]),
    method: "PUT",
  });

  const runtimeGame = await requestJson(server.baseUrl, "/api/runtime/json/game");
  const runtimePrompts = await requestJson(server.baseUrl, "/api/runtime/json/prompts");
  const runtimeActions = await requestJson(server.baseUrl, "/api/runtime/json/actions");
  const runtimeChat = await requestJson(server.baseUrl, "/api/runtime/json/chat");

  const modelsPayload = await fetchOpenAIJson("models", apiKey);
  const model = pickModel(modelsPayload.data);
  assert.ok(model, "Could not pick a usable OpenAI chat model.");
  log(`selected OpenAI model ${model}`);

  const advisorSystemPrompt = applyPromptVariables(
    runtimePrompts.advisor,
    runtimeGame,
    runtimeActions,
    runtimeChat,
  );
  const advisorPayload = await fetchOpenAIJson("chat/completions", apiKey, {
    body: JSON.stringify({
      messages: [
        { role: "system", content: advisorSystemPrompt },
        { role: "user", content: "Smoke test status check." },
      ],
      model,
    }),
    method: "POST",
  });
  const advisorReply = extractAssistantText(advisorPayload);
  assert.ok(advisorReply.includes("ADVISOR_OPENAI_SMOKE"), "Advisor reply did not include the smoke token.");
  log("advisor call succeeded");

  const leaderSystemPrompt = applyPromptVariables(
    runtimePrompts.leader,
    runtimeGame,
    runtimeActions,
    runtimeChat,
  );
  const leaderPayload = await fetchOpenAIJson("chat/completions", apiKey, {
    body: JSON.stringify({
      messages: [
        { role: "system", content: leaderSystemPrompt },
        { role: "user", content: "Diplomacy smoke test." },
      ],
      model,
    }),
    method: "POST",
  });
  const leaderReply = extractAssistantText(leaderPayload);
  assert.ok(leaderReply.includes("LEADER_OPENAI_SMOKE"), "Leader reply did not include the smoke token.");
  log("leader call succeeded");

  const actionSystemPrompt = applyPromptVariables(
    runtimePrompts.descriptionToAction,
    runtimeGame,
    runtimeActions,
    runtimeChat,
  );
  const actionPayload = await fetchOpenAIJson("chat/completions", apiKey, {
    body: JSON.stringify({
      messages: [
        { role: "system", content: actionSystemPrompt },
        { role: "user", content: "Open talks with France about steel." },
      ],
      model,
    }),
    method: "POST",
  });
  const actionReply = extractAssistantText(actionPayload);
  assert.ok(actionReply.includes("ACTION_OPENAI_SMOKE"), "Description-to-action reply did not include the smoke token.");
  log("description-to-action call succeeded");

  const jumpSystemPrompt = applyPromptVariables(
    runtimePrompts.jumpForward,
    runtimeGame,
    runtimeActions,
    runtimeChat,
  );
  const jumpPayload = await fetchOpenAIJson("chat/completions", apiKey, {
    body: JSON.stringify({
      messages: [
        { role: "system", content: jumpSystemPrompt },
        { role: "user", content: "Simulate a short jump." },
      ],
      model,
    }),
    method: "POST",
  });
  const jumpReply = extractAssistantText(jumpPayload);
  assert.ok(jumpReply.includes("JUMP_OPENAI_SMOKE"), "Jump-forward reply did not include the smoke token.");
  log("jump-forward call succeeded");

  await requestJson(server.baseUrl, `/api/scenarios/${encodeURIComponent(createdScenarioId)}`, {
    method: "DELETE",
  });
  createdScenarioId = null;

  log("OpenAI smoke test passed");
} catch (error) {
  console.error(`[openai-smoke] FAILED: ${error.message}`);
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
