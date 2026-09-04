// Run: node --test src/Game/AI/providerConfig.test.js
//
// Per-task model routing, configuration profiles and recent models
// (providerConfig.js). The module reads browser localStorage, so a Map-backed
// stand-in is installed before it is imported.
//
// The routing promise: a task without an override runs on the provider's
// default model, so nobody who never opened the advanced section sees a change;
// an override wins for its task only; and camelCase task keys (every prompt-pack
// key is one) round-trip through storage — the fork this was ported from matched
// lowercase keys only, so its overrides were silently never stored.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};

const config = await import("./providerConfig.js");

test.beforeEach(() => store.clear());

test("a task without an override runs on the provider default", () => {
  config.setProviderField("gemini", "model", "gemini-default");
  assert.equal(config.getModelForTask("gemini", "jumpForward"), "gemini-default");
  assert.equal(config.getModelForTask("gemini", ""), "gemini-default");
  assert.equal(config.getModelForTask("gemini", undefined), "gemini-default");
});

test("an override wins for its own task only and camelCase keys round-trip", () => {
  config.setProviderField("gemini", "model", "gemini-default");
  config.setProviderField("gemini", "model_jumpForward", "gemini-pro");
  assert.equal(config.getModelForTask("gemini", "jumpForward"), "gemini-pro");
  assert.equal(config.getModelForTask("gemini", "nextSpeaker"), "gemini-default");
  assert.equal(store.get("gemini_model_jumpForward"), "gemini-pro");
  assert.equal(config.getProviderField("gemini", "model_jumpForward"), "gemini-pro");
});

test("a blank or malformed override falls through to the default", () => {
  config.setProviderField("openai", "model", "gpt-default");
  config.setProviderField("openai", "model_actions", "   ");
  assert.equal(config.getModelForTask("openai", "actions"), "gpt-default");
  assert.equal(config.getModelForTask("openai", "../etc"), "gpt-default");
  assert.equal(config.getProviderField("openai", "model_../etc"), "");
});

test("task overrides are per provider and leave the structured-output choice alone", () => {
  config.setProviderField("openai-compatible", "model", "local-a");
  config.setProviderField("openai-compatible", "structuredMode", "json");
  config.setProviderField("openai-compatible", "model_jumpForward", "local-big");
  assert.equal(config.getProviderField("openai-compatible", "structuredMode"), "json");
  assert.equal(config.getModelForTask("anthropic", "jumpForward"), config.getProviderField("anthropic", "model"));
  // Changing the base model still retires the choice, as before (back to the
  // ladder's "auto" default).
  config.setProviderField("openai-compatible", "model", "local-b");
  assert.equal(config.getProviderField("openai-compatible", "structuredMode"), "auto");
});

test("profiles: stock entries are seeded once, then saved, updated and deleted like any other", () => {
  const seeded = config.getSavedPresets();
  assert.equal(seeded.length, 3);
  assert.ok(seeded.every((preset) => preset.provider === "openai-compatible"));
  assert.ok(store.has("ai_provider_presets"));

  const id = config.savePreset("openai-compatible", "  Mine ", { endpoint: "http://x/v1", model: "m" });
  const saved = config.getSavedPresets().find((preset) => preset.id === id);
  assert.deepEqual(saved, {
    id,
    provider: "openai-compatible",
    name: "Mine",
    settings: { endpoint: "http://x/v1", apiKey: "", model: "m", customParams: "" },
  });

  assert.equal(config.updatePreset(id, "Mine 2", { endpoint: "http://y/v1", apiKey: "k", model: "", customParams: "{}" }), true);
  const updated = config.getSavedPresets().find((preset) => preset.id === id);
  assert.equal(updated.name, "Mine 2");
  assert.deepEqual(updated.settings, { endpoint: "http://y/v1", apiKey: "k", model: "", customParams: "{}" });
  assert.equal(config.updatePreset("missing", "x"), false);

  assert.equal(config.deletePreset(id), true);
  assert.equal(config.deletePreset(id), false);
  assert.equal(config.getSavedPresets().length, 3);

  // A deleted stock entry stays deleted: the seed happens only on an empty store.
  assert.equal(config.deletePreset("default_groq"), true);
  assert.equal(config.getSavedPresets().length, 2);
});

test("recent models: newest first, no duplicates, capped at ten", () => {
  config.saveRecentModel("openai", "a");
  config.saveRecentModel("openai", "b");
  config.saveRecentModel("openai", "a");
  assert.deepEqual(config.getRecentModels("openai"), ["a", "b"]);
  config.saveRecentModel("openai", "  ");
  assert.deepEqual(config.getRecentModels("openai"), ["a", "b"]);
  for (let index = 0; index < 12; index += 1) config.saveRecentModel("openai", `model-${index}`);
  const recent = config.getRecentModels("openai");
  assert.equal(recent.length, 10);
  assert.equal(recent[0], "model-11");
  assert.deepEqual(config.getRecentModels("gemini"), []);
});
