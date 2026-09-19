// Run: node --test src/Game/AI/providerConfig.test.js
//
// Connections, the Fallback list, per-task picks and recent models
// (providerConfig.js; docs/world-state.md "AI access"; ADR 0002). The module
// reads browser localStorage, so a Map-backed stand-in is installed before it is
// imported.
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
const { clearDebugLog, getDebugLogEntries } = await import("../../runtime/debugLog.js");

test.beforeEach(() => store.clear());

// What a row of the list resolves to, minus the ids, which are generated.
const resolved = () => config.getResolvedFallbackList().map(({ id, connectionId, ...rest }) => {
  assert.ok(id && connectionId);
  return rest;
});

// open-historia-harness writes exactly these into a fresh storage every run,
// then imports the engine without any UI. Nothing but the first read of the
// list can migrate them.
test("the harness's old-style settings become one Connection and one entry on first read", () => {
  store.set("api_provider", "gemini");
  store.set("gemini_api_key", "AIzaHARNESSKEY1234567890");
  store.set("gemini_model", "gemini-3.5-flash");

  assert.deepEqual(resolved(), [{
    provider: "gemini",
    connectionName: "Gemini",
    apiKey: "AIzaHARNESSKEY1234567890",
    endpoint: "",
    model: "gemini-3.5-flash",
    customParams: "",
    structuredMode: "auto",
    toolStrict: false,
    label: "gemini-3.5-flash (Gemini)",
  }]);
  assert.equal(config.isFallbackListConfigured(), true);
});

test("a player with several providers, profiles and per-task models keeps all of them", () => {
  store.set("api_provider", "openai-compatible");
  store.set("openai_compatible_endpoint", "http://localhost:1234/v1");
  store.set("openai_compatible_model", "qwen3");
  store.set("openai_compatible_custom_params", '{"max_tokens":4096}');
  store.set("openai_compatible_structured_mode", "json_object");
  store.set("openai_compatible_tool_strict", "1");
  // A key for a provider they are not using right now.
  store.set("gemini_api_key", "AIzaSPAREKEY1234567890");
  store.set("gemini_model", "gemini-3.5-pro");
  // One stock profile nobody touched, and one of their own.
  store.set("ai_provider_presets", JSON.stringify([
    { id: "default_groq", provider: "openai-compatible", name: "Groq", settings: { endpoint: "https://api.groq.com/openai/v1", apiKey: "", model: "llama-3.3-70b-versatile", customParams: "" } },
    { id: "preset_1", provider: "openai-compatible", name: "OpenRouter", settings: { endpoint: "https://openrouter.ai/api/v1", apiKey: "sk-or-v1-OWNKEY", model: "deepseek/deepseek-v4", customParams: "" } },
  ]));
  // Per-task models: two tasks on one bigger model, one on the default, and
  // one belonging to a provider that is not active (never in effect, so not
  // migrated). Note the provider is spelled with its hyphen in these keys.
  store.set("openai-compatible_model_jumpForward", "qwen3-big");
  store.set("openai-compatible_model_actions", "qwen3-big");
  store.set("openai-compatible_model_nextSpeaker", "qwen3");
  store.set("gemini_model_advisor", "gemini-3.5-flash");

  const connections = config.getConnections().map(({ id, ...rest }) => rest);
  assert.deepEqual(connections, [
    { provider: "gemini", name: "Gemini", apiKey: "AIzaSPAREKEY1234567890", endpoint: "", customParams: "", toolStrict: false, suggestedModel: "" },
    { provider: "openai-compatible", name: "OpenAI Compatible", apiKey: "", endpoint: "http://localhost:1234/v1", customParams: '{"max_tokens":4096}', toolStrict: true, suggestedModel: "" },
    { provider: "openai-compatible", name: "OpenRouter", apiKey: "sk-or-v1-OWNKEY", endpoint: "https://openrouter.ai/api/v1", customParams: "", toolStrict: false, suggestedModel: "deepseek/deepseek-v4" },
  ]);

  const list = config.getResolvedFallbackList();
  assert.deepEqual(list.map(({ label, structuredMode }) => [label, structuredMode]), [
    ["qwen3 (OpenAI Compatible)", "json_object"],
    ["qwen3-big (OpenAI Compatible)", "auto"],
  ]);
  assert.equal(config.getTaskPick("jumpForward"), list[1].id);
  assert.equal(config.getTaskPick("actions"), list[1].id);
  assert.equal(config.getTaskPick("nextSpeaker"), list[0].id);
  assert.equal(config.getTaskPick("advisor"), "");

  // Once only: the old settings are never read again.
  store.set("openai_compatible_model", "something-else");
  assert.deepEqual(config.getResolvedFallbackList().map(({ id }) => id), list.map(({ id }) => id));
  assert.equal(config.getResolvedFallbackList()[0].model, "qwen3");
  assert.equal(store.get("gemini_api_key"), "AIzaSPAREKEY1234567890", "left in storage, untouched");
});

test("a fresh install starts with an empty Gemini Connection and the default model", () => {
  assert.deepEqual(resolved(), [{
    provider: "gemini",
    connectionName: "Gemini",
    apiKey: "",
    endpoint: "",
    model: "gemini-3.5-flash-lite",
    customParams: "",
    structuredMode: "auto",
    toolStrict: false,
    label: "gemini-3.5-flash-lite (Gemini)",
  }]);
  assert.equal(config.isFallbackListConfigured(), false, "so the start-of-game prompt still asks for a key");
});

test("Fill goes model first across the ticked Connections, appends, and never duplicates", () => {
  store.set("gemini_api_key", "AIzaFIRSTKEY1234567890");
  store.set("gemini_model", "gemini-3.7-flash");
  const [first] = config.getConnections();
  // A free key and a paid one on the same provider: ADR 0001's ordinary case.
  const second = config.addConnection({ provider: "gemini", name: "Paid Gemini", apiKey: "AIzaPAIDKEY1234567890" });

  const added = config.fillFallbackList([first.id, second], ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  assert.equal(added, 5, "the first key's 3.7 Flash was already entry #1");
  assert.deepEqual(config.getResolvedFallbackList().map(({ label }) => label), [
    "gemini-3.7-flash (Gemini)",
    "gemini-3.7-flash (Paid Gemini)",
    "gemini-3.6-flash (Gemini)",
    "gemini-3.6-flash (Paid Gemini)",
    "gemini-3.5-flash-lite (Gemini)",
    "gemini-3.5-flash-lite (Paid Gemini)",
  ]);

  assert.equal(config.fillFallbackList([first.id, second], ["gemini-3.7-flash", " gemini-3.6-flash ", ""]), 0, "pressing it twice adds nothing");
  assert.equal(config.getFallbackList().length, 6);
});

test("entry states are kept apart from the settings, and survive a reload", () => {
  const [entry] = config.getFallbackList();
  config.fallbackStateStore.set(entry.id, { spentUntil: 5000 });
  assert.deepEqual(config.fallbackStateStore.get(entry.id), { spentUntil: 5000 });
  assert.deepEqual(JSON.parse(store.get("ai_fallback_states")), { [entry.id]: { spentUntil: 5000 } });
  assert.equal(store.get("ai_fallback_list").includes("spentUntil"), false, "marking never rewrites what the player typed");

  config.resetEntryState(entry.id);
  assert.equal(config.fallbackStateStore.get(entry.id), undefined, "the reset button");
});

test("editing an Unusable entry or its Connection clears the mark, so the fix is tried at once", () => {
  store.set("gemini_api_key", "AIzaBADKEY12345678901234");
  const [entry] = config.getFallbackList();

  config.fallbackStateStore.set(entry.id, { unusable: "key rejected (401)", lastAnsweredAt: 10 });
  config.updateConnection(entry.connectionId, { apiKey: "AIzaGOODKEY1234567890123" });
  assert.deepEqual(config.fallbackStateStore.get(entry.id), { lastAnsweredAt: 10 });

  config.fallbackStateStore.set(entry.id, { unusable: "model not found (404)", spentUntil: 99 });
  config.updateEntry(entry.id, { model: "gemini-3.6-flash" });
  assert.equal(config.fallbackStateStore.get(entry.id), undefined);
});

// Accepting a structured-output suggestion edits the entry. It must not bring a
// Spent model back, or the next call wastes a request finding out again.
test("an edit that is not a new model or Connection keeps a Spent mark", () => {
  const [entry] = config.getFallbackList();
  config.fallbackStateStore.set(entry.id, { spentUntil: 99_000, unusable: "key rejected (401)" });
  config.updateEntry(entry.id, { structuredMode: "json_object" });
  assert.deepEqual(config.fallbackStateStore.get(entry.id), { spentUntil: 99_000 }, "Unusable goes, Spent stays");

  config.updateEntry(entry.id, { model: "a-different-model" });
  assert.equal(config.fallbackStateStore.get(entry.id), undefined, "a new model has an allowance of its own");
});

test("a new model starts its entry's structured-output mode at auto; other edits leave it", () => {
  const [entry] = config.getFallbackList();
  config.updateEntry(entry.id, { structuredMode: "json_object" });
  config.updateEntry(entry.id, { customParamsOverride: '{"max_tokens":20480}' });
  assert.equal(config.getFallbackList()[0].structuredMode, "json_object");
  config.updateEntry(entry.id, { model: "another-model" });
  assert.equal(config.getFallbackList()[0].structuredMode, "auto");
});

test("an entry's own custom parameters override its Connection's (issue #718)", () => {
  const [entry] = config.getFallbackList();
  config.updateConnection(entry.connectionId, { customParams: '{"max_tokens":4096}' });
  const timeSkips = config.addEntry({ connectionId: entry.connectionId, model: entry.model, customParamsOverride: '{"max_tokens":20480}' });
  const [ordinary, big] = config.getResolvedFallbackList();
  assert.equal(ordinary.customParams, '{"max_tokens":4096}');
  assert.equal(big.id, timeSkips);
  assert.equal(big.customParams, '{"max_tokens":20480}');
});

test("removing a Connection says which entries use it, then removes them and their task picks", () => {
  const [entry] = config.getFallbackList();
  const other = config.addConnection({ provider: "openai", name: "Paid", apiKey: "sk-PAIDKEY" });
  const paidEntry = config.addEntry({ connectionId: other, model: "gpt-5-mini" });
  config.setTaskPick("jumpForward", paidEntry);

  assert.deepEqual(config.entriesUsingConnection(other).map(({ id }) => id), [paidEntry]);
  config.removeConnection(other);
  assert.deepEqual(config.getFallbackList().map(({ id }) => id), [entry.id]);
  assert.equal(config.getConnections().some(({ id }) => id === other), false);
  assert.equal(config.getTaskPick("jumpForward"), "");
});

// The interactive-event tasks had other keys before (formerTaskKeys.js); a
// player's picks for them, and an old per-provider model for one, carry over.
test("a renamed task keeps the pick and the old model made under its former key", () => {
  store.set("api_provider", "gemini");
  store.set("gemini_model", "gemini-3.5-flash");
  store.set("gemini_model_catalystExecutor", "gemini-3.5-pro");
  const list = config.getResolvedFallbackList();
  assert.equal(config.getTaskPick("interactiveExecutor"), list[1].id, "the old per-provider model became an entry the task points at");
  assert.equal(list[1].model, "gemini-3.5-pro");

  store.set("ai_task_picks", JSON.stringify({ catalystSummary: list[1].id }));
  assert.equal(config.getTaskPick("interactiveSummary"), list[1].id, "a pick stored before the rename");
  config.setTaskPick("interactiveSummary", "");
  assert.equal(config.getTaskPick("interactiveSummary"), "", "clearing it clears the old key too");
  assert.deepEqual(JSON.parse(store.get("ai_task_picks")), {});
});

test("entries can be reordered and removed", () => {
  const [a] = config.getFallbackList();
  const b = config.addEntry({ connectionId: a.connectionId, model: "b" });
  const c = config.addEntry({ connectionId: a.connectionId, model: "c" });
  config.moveEntry(c, 0);
  assert.deepEqual(config.getFallbackList().map(({ id }) => id), [c, a.id, b]);
  config.fallbackStateStore.set(b, { spentUntil: 1 });
  config.setTaskPick("actions", b);
  config.removeEntry(b);
  assert.deepEqual(config.getFallbackList().map(({ id }) => id), [c, a.id]);
  assert.equal(config.fallbackStateStore.get(b), undefined);
  assert.equal(config.getTaskPick("actions"), "");
});

// For undoing a Fill that went wrong: every entry goes, with its marks and the
// task picks that pointed at it, and the Connections — the keys — stay.
test("Clear list removes every entry and keeps every Connection", () => {
  const [first] = config.getFallbackList();
  const paid = config.addConnection({ provider: "openai", name: "Paid", apiKey: "sk-PAIDKEY" });
  config.fillFallbackList([first.connectionId, paid], ["model-a", "model-b"]);
  const [, second] = config.getFallbackList();
  config.fallbackStateStore.set(second.id, { spentUntil: 5 });
  config.setTaskPick("jumpForward", second.id);

  assert.equal(config.clearFallbackList(), 5);
  assert.deepEqual(config.getFallbackList(), []);
  assert.equal(config.getConnections().length, 2, "the keys stay");
  assert.equal(config.fallbackStateStore.get(second.id), undefined);
  assert.equal(config.getTaskPick("jumpForward"), "");
  assert.equal(config.getFallbackList().length, 0, "an empty list stays empty rather than migrating again");
});

test("the rate-limit setting is one choice for the whole list, defaulting to wait", () => {
  assert.equal(config.getRateLimitPolicy(), "wait");
  config.setRateLimitPolicy("next");
  assert.equal(config.getRateLimitPolicy(), "next");
  config.setRateLimitPolicy("anything else");
  assert.equal(config.getRateLimitPolicy(), "wait");
});

// Settings changes reach the Diagnostics log once each typed value settles,
// and a key never does.
test("a Connection edit is logged once it settles, and its key only as set or cleared", () => {
  const [entry] = config.getFallbackList();
  clearDebugLog({ silent: true });
  test.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const typed of ["AIza", "AIzaSECRET", "AIzaSECRETSECRETSECRETSECRET12345"]) config.updateConnection(entry.connectionId, { apiKey: typed });
    const local = config.addConnection({ provider: "openai-compatible", name: "Home", endpoint: "http://user:pw@gateway.local:8080/v1?token=abc" });
    config.updateConnection(local, { customParams: "{\"headers\":{\"x-api-key\":\"zzzzzzzz\"}}" });
    for (const typed of ["gemini-3", "gemini-3.6-flash"]) config.updateEntry(entry.id, { model: typed });
    test.mock.timers.tick(5000);
  } finally {
    test.mock.timers.reset();
  }
  const messages = getDebugLogEntries().map((logged) => logged.message);
  assert.equal(messages.filter((message) => message === 'AI connection "Gemini": key set.').length, 1, messages.join(" | "));
  assert.ok(messages.includes('AI connection "Home" (OpenAI Compatible) added.'));
  assert.ok(messages.includes('AI connection "Home": custom parameters set (36 characters).'), "never their contents");
  assert.ok(messages.includes("Fallback list: entry 1 is now gemini-3.6-flash (Gemini)."));
  const all = JSON.stringify(getDebugLogEntries());
  for (const secret of ["AIzaSECRET", "pw@", "token=abc", "zzzzzzzz"]) assert.equal(all.includes(secret), false, secret);
  assert.ok(all.includes("gateway.local:8080"), "the endpoint by its host");
});

test("OpenCode Zen is a separate, key-required provider with free-only defaults", () => {
  assert.equal(config.normalizeProvider("opencode-zen"), "opencode-zen");
  assert.equal(config.getProviderMeta("opencode-zen").label, "OpenCode Zen");
  assert.equal(config.providerSupportsModelDiscovery("opencode-zen"), true);
  assert.equal(config.providerSetupRequirement("opencode-zen"), "apiKey");
  const first = config.addConnection({ provider: "opencode-zen", apiKey: "test-only-key" });
  const second = config.addConnection({ provider: "opencode-zen", apiKey: "other-test-key" });
  const firstEntry = config.addEntry({ connectionId: first, model: "big-pickle" });
  const secondEntry = config.addEntry({ connectionId: second, model: "deepseek-v4-flash" });
  const entries = () => config.getResolvedFallbackList().filter((entry) => entry.provider === "opencode-zen");
  assert.deepEqual(entries().map((entry) => entry.allowPaid), [false, false]);
  config.updateConnection(first, { allowPaid: true, customParams: '{"top_p":0.9}' });
  assert.deepEqual(entries().map((entry) => entry.allowPaid), [true, false]);
  assert.deepEqual(entries().map((entry) => entry.apiKey), ["test-only-key", "other-test-key"]);
  config.updateEntry(firstEntry, { structuredMode: "json_object" });
  config.updateEntry(firstEntry, { model: "mimo-v2.5-free" });
  assert.equal(entries()[0].structuredMode, "auto");
  config.setTaskPick("advisor", secondEntry);
  assert.equal(config.getTaskPick("advisor"), secondEntry);
  assert.equal(entries()[1].allowPaid, false);
  config.updateEntry(firstEntry, { customParamsOverride: '{"model":"deepseek-v4-flash"}' });
  config.updateConnection(first, { allowPaid: false });
  assert.equal(entries()[0].allowPaid, false);
  assert.equal(entries()[0].customParams, '{"model":"deepseek-v4-flash"}');
  // A provider switch cannot carry an earlier paid opt-in into a new Zen connection.
  config.updateConnection(first, { provider: "gemini" });
  config.updateConnection(first, { provider: "opencode-zen" });
  assert.equal(entries()[0].allowPaid, false);
});

test("legacy Zen settings migrate once with paid opt-in, structured mode and task picks", () => {
  for (const paid of [null, "", "1"]) {
    store.clear();
    store.set("api_provider", "opencode-zen");
    store.set("opencode_zen_api_key", "test-only-key");
    store.set("opencode_zen_model", "big-pickle");
    store.set("opencode_zen_custom_params", '{"top_p":0.9}');
    store.set("opencode_zen_structured_mode", "json_object");
    store.set("opencode-zen_model_advisor", "mimo-v2.5-free");
    if (paid !== null) store.set("opencode_zen_allow_paid", paid);
    const list = config.getResolvedFallbackList();
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((entry) => entry.model), ["big-pickle", "mimo-v2.5-free"]);
    assert.ok(list.every((entry) => entry.allowPaid === (paid === "1")));
    assert.equal(list[0].structuredMode, "json_object");
    assert.equal(list[0].customParams, '{"top_p":0.9}');
    assert.equal(config.getTaskPick("advisor"), list[1].id);
    store.set("opencode_zen_allow_paid", paid === "1" ? "" : "1");
    assert.deepEqual(config.getResolvedFallbackList(), list, "old settings stop controlling migrated entries");
  }
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

// ---- the start-of-game prompt's one-step setup (applyQuickAiSetup) ----------

test("quick setup completes the migrated key-less connection and its entry answers first", () => {
  store.set("api_provider", "gemini"); // migrated: one Gemini connection, no key
  assert.equal(config.getResolvedFallbackList().length, 1);
  assert.equal(config.isFallbackListConfigured(), false);

  const { connectionId, entryId } = config.applyQuickAiSetup({ provider: "gemini", apiKey: " AIzaQUICK123 ", model: " gemini-3.5-flash " });

  assert.equal(config.getConnections().length, 1, "completed, not duplicated");
  assert.equal(config.getConnections()[0].id, connectionId);
  const list = config.getResolvedFallbackList();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, entryId);
  assert.equal(list[0].apiKey, "AIzaQUICK123");
  assert.equal(list[0].model, "gemini-3.5-flash", "the typed model replaces the migrated default");
  assert.equal(config.isFallbackListConfigured(), true);
});

test("quick setup with no model keeps the entry's model", () => {
  store.set("api_provider", "gemini");
  store.set("gemini_model", "gemini-3.7-flash");
  config.applyQuickAiSetup({ provider: "gemini", apiKey: "AIzaKEEP" });
  assert.equal(config.getResolvedFallbackList()[0].model, "gemini-3.7-flash");
});

test("quick setup for another provider adds a connection whose entry goes to the top", () => {
  store.set("api_provider", "gemini"); // a key-less Gemini entry sits at the top
  const { entryId } = config.applyQuickAiSetup({ provider: "anthropic", apiKey: "sk-ant-quick" });
  const list = config.getResolvedFallbackList();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, entryId);
  assert.equal(list[0].provider, "anthropic");
  assert.equal(list[0].apiKey, "sk-ant-quick");
  assert.equal(list[1].provider, "gemini");
  assert.equal(config.getConnections().length, 2);
  assert.equal(config.isFallbackListConfigured(), true);
});

test("quick setup needs the provider's requirement, and a self-hosted one needs only its endpoint", () => {
  assert.throws(() => config.applyQuickAiSetup({ provider: "gemini", apiKey: "   " }), /API key/);
  assert.throws(() => config.applyQuickAiSetup({ provider: "openai-compatible", endpoint: "" }), /endpoint/);
  const { entryId } = config.applyQuickAiSetup({ provider: "openai-compatible", endpoint: "http://localhost:11434/v1" });
  const [top] = config.getResolvedFallbackList();
  assert.equal(top.id, entryId);
  assert.equal(top.endpoint, "http://localhost:11434/v1");
  assert.equal(config.isFallbackListConfigured(), true);
});
