import assert from "node:assert/strict";
import test from "node:test";
import {
  codexProgressFromNotification,
  getAvailableCodexModels,
  getAvailableChatGPTModels,
  normalizeGenerationTimeout,
  selectCodexModel,
  selectPreferredEffort,
  selectPreferredModel,
  toCodexStrictSchema,
  mergeChatGPTCatalog,
  chatgptPlanArguments,
  chatgptRuntimeCatalog,
} from "./codexAppServer.js";
import { JUMP_FORWARD_SCHEMA } from "../src/Game/AI/gameplaySchemas.js";

test("official ChatGPT catalog excludes bundled-only models and preserves dynamic reasoning options", () => {
  const merged = mergeChatGPTCatalog([
    { id: "gpt-6-sol", model: "gpt-6-sol", displayName: "GPT-6 Sol" },
    { id: "gpt-5.6-luna", model: "gpt-5.6-luna" },
  ], [model("gpt-6-sol", { efforts: ["medium", "high"] }), model("gpt-6-luna")]);
  assert.deepEqual(merged.map((m) => m.id), ["gpt-6-sol", "gpt-5.6-luna"]);
  assert.deepEqual(merged[0].supportedReasoningEfforts.map((e) => e.reasoningEffort), ["medium", "high"]);
  const args = chatgptPlanArguments().join(" ");
  assert.match(args, /https:\/\/api.openai.com\/v1/);
  assert.match(args, /requires_openai_auth=false/);
  assert.match(args, /supports_websockets=false/);
  assert.doesNotMatch(args, /backend-api|sk-/);
});

test("official model picker includes older and future account models without a generation allowlist", () => {
  const models = [model("gpt-6-astra"), model("gpt-5.6-sol"), model("gpt-5.6-luna"),
    model("gpt-5.6-terra"), model("gpt-5.5"), model("future-model"), { ...model("hidden"), hidden: true }];
  assert.deepEqual(getAvailableChatGPTModels(models).map((m) => m.id), models.slice(0, -1).map((m) => m.id));
  for (const candidate of models.slice(0, -1)) {
    assert.equal(selectCodexModel(models, candidate.id, { official: true }).id, candidate.id);
  }
});

test("official reasoning metadata overrides a stale bundled catalog", () => {
  const merged = mergeChatGPTCatalog([{ ...model("gpt-5.6-luna", { efforts: ["medium", "high"] }), defaultReasoningEffort: "medium" }],
    [model("gpt-5.6-luna", { efforts: ["low", "ultra"] })]);
  assert.deepEqual(merged[0].supportedReasoningEfforts.map((e) => e.reasoningEffort), ["medium", "high"]);
  assert.equal(merged[0].defaultReasoningEffort, "medium");
});

const model = (id, { isDefault = false, efforts = ["low", "medium", "high"] } = {}) => ({
  id,
  model: id,
  displayName: id.toUpperCase(),
  isDefault,
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })),
  defaultReasoningEffort: efforts[0] ?? null,
});

test("official runtime adapts tool discovery without filtering models or disabling web search", () => {
  const source = { models: [{ slug: "older-model", supports_search_tool: true, web_search_tool_type: "web_search",
    shell_type: "local", supported_reasoning_levels: [{ effort: "medium" }] }] };
  const adapted = chatgptRuntimeCatalog(source);
  assert.equal(adapted.models[0].supports_search_tool, false);
  assert.equal(source.models[0].supports_search_tool, true);
  assert.equal(adapted.models[0].web_search_tool_type, "web_search");
  assert.equal(adapted.models[0].shell_type, "local");
  assert.deepEqual(adapted.models[0].supported_reasoning_levels, source.models[0].supported_reasoning_levels);
  assert.match(chatgptPlanArguments("C:\\runtime\\models.json").join(" "), /model_catalog_json="C:\/runtime\/models.json"/);
});

test("Codex catalog includes all non-hidden models, preserves ordering and honors the catalog default", () => {
  const models = [model("gpt-5.5"), model("gpt-6-astra", { isDefault: true }),
    model("gpt-6-luna"), { ...model("hidden"), hidden: true }];
  assert.deepEqual(getAvailableCodexModels(models).map((m) => m.id), ["gpt-5.5", "gpt-6-astra", "gpt-6-luna"]);
  assert.equal(selectPreferredModel(models).id, "gpt-6-astra");
  assert.equal(selectPreferredModel([model("older"), model("newer")]).id, "older");
  assert.equal(selectCodexModel(models, "gpt-5.5").id, "gpt-5.5");
  assert.throws(() => selectCodexModel(models, "removed-model"), /no longer available/);
  assert.equal(selectPreferredModel([]), null);
});

test("prefers medium only when the selected model reports it", () => {
  assert.equal(selectPreferredEffort(model("with-medium")), "medium");
  assert.equal(selectPreferredEffort(model("without-medium", { efforts: ["low", "high"] })), "low");
});

test("normalizes Codex generation timeouts and preserves the no-limit value", () => {
  assert.equal(normalizeGenerationTimeout(0), 0);
  assert.equal(normalizeGenerationTimeout(12_345.9), 12_345);
  assert.equal(normalizeGenerationTimeout(undefined), 5 * 60_000);
});

test("makes nested gameplay schemas valid for Codex strict structured output", () => {
  const schema = toCodexStrictSchema(JUMP_FORWARD_SCHEMA);
  const createdChat = schema.properties.events.items.properties.impacts.properties.createdChats.items;

  assert.equal(createdChat.properties.countries.items.type, "string");
  assert.deepEqual(
    createdChat.required,
    ["title", "countries", "openingMessage", "speaker", "linkedEventId"],
  );
  assert.deepEqual(
    schema.properties.events.items.properties.impacts.required,
    ["actionIds", "createdChats", "polityChanges", "regionTransfers", "regionControlOps", "unitOps", "markerOps", "spyOps", "reports", "regionClaims"],
  );
  // The shared source schema is deliberately not mutated for other providers.
  assert.deepEqual(JUMP_FORWARD_SCHEMA.properties.events.items.properties.impacts.properties.createdChats.items
    .properties.countries.items.type, "string");
});

test("maps app-server notifications to safe UI progress events", () => {
  assert.deepEqual(
    codexProgressFromNotification({ method: "turn/started", params: {} }),
    { kind: "thinking", state: "started" },
  );
  assert.deepEqual(
    codexProgressFromNotification({
      method: "item/started",
      params: { item: { type: "webSearch", query: "Meiji restoration timeline" } },
    }),
    { kind: "web_search", state: "started", detail: "Meiji restoration timeline" },
  );
  assert.deepEqual(
    codexProgressFromNotification({
      method: "item/started",
      params: { item: { type: "commandExecution", command: "echo SECRET_VALUE" } },
    }),
    { kind: "shell", state: "started" },
  );
});

test("streams reasoning summaries but ignores raw reasoning text", () => {
  assert.deepEqual(
    codexProgressFromNotification({
      method: "item/reasoning/summaryTextDelta",
      params: { delta: "Checking historical consistency" },
    }),
    { kind: "summary", state: "streaming", delta: "Checking historical consistency" },
  );
  assert.equal(
    codexProgressFromNotification({
      method: "item/reasoning/textDelta",
      params: { delta: "private raw chain of thought" },
    }),
    null,
  );
  assert.deepEqual(
    codexProgressFromNotification({
      method: "item/agentMessage/delta",
      params: { delta: "Visible answer text" },
    }),
    { kind: "writing", state: "streaming", delta: "Visible answer text" },
  );
});
