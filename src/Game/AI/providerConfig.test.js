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

// Every test starts AFTER the one-time reset to the default Gemini list has
// run (resetToGeminiDefaultChain), the way an installed game has once it has
// been opened once on this update; the two tests of the reset itself clear the
// marker to see it fire.
test.beforeEach(() => { store.clear(); store.set("ai_gemini_default_chain_v2", "1"); });

// A one-entry list to start from, for the tests about how the list is worked:
// a model the player chose is theirs alone. (With none — or with the old
// default, gemini-3.5-flash-lite — Gemini starts on its default list, tested
// below.)
const startWithOneEntry = () => store.set("gemini_model", "gemini-3.5-flash");

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

test("a fresh install starts with an empty Gemini Connection and the default Gemini list", () => {
  const list = resolved();
  assert.deepEqual(list.map(({ model }) => model), [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ], "the newest Flash first, each older one its backup");
  assert.deepEqual(config.GEMINI_DEFAULT_CHAIN, list.map(({ model }) => model));
  assert.deepEqual(list[0], {
    provider: "gemini",
    connectionName: "Gemini",
    apiKey: "",
    endpoint: "",
    model: "gemini-3.8-flash",
    customParams: "",
    structuredMode: "auto",
    toolStrict: false,
    label: "gemini-3.8-flash (Gemini)",
  });
  assert.equal(new Set(config.getFallbackList().map(({ connectionId }) => connectionId)).size, 1, "all on the one Gemini Connection");
  assert.equal(config.getConnections().length, 1);
  assert.equal(config.isFallbackListConfigured(), false, "so the start-of-game prompt still asks for a key");
});

// OpenAI serves dozens of models and used to be asked which one to use. The
// game names one instead: it is what a blank OpenAI model means, and what a
// player who was on OpenAI carries over.
test("OpenAI has a default model of its own", () => {
  assert.equal(config.OPENAI_DEFAULT_MODEL, "gpt-5.6-luna");
  store.set("api_provider", "openai");
  store.set("openai_api_key", "sk-oldsettings");
  assert.deepEqual(resolved().map(({ provider, model }) => [provider, model]), [["openai", "gpt-5.6-luna"]]);
});

// A list as a first launch set it up before the default list existed: one
// Gemini entry on the old default model, or on a blank one, which meant it.
const storeFormerDefault = (model) => {
  store.set("ai_connections", JSON.stringify([{ id: "conn_g", provider: "gemini", name: "Gemini", apiKey: "AIzaOLDDEFAULT" }]));
  store.set("ai_fallback_list", JSON.stringify([{ id: "entry_old", connectionId: "conn_g", model, structuredMode: "auto" }]));
  store.set("ai_task_picks", JSON.stringify({ actions: "entry_old" }));
};

test("an untouched default list becomes the default Gemini list once, keeping its entry, pick and mark", () => {
  storeFormerDefault("gemini-3.5-flash-lite");
  store.set("ai_fallback_states", JSON.stringify({ entry_old: { spentUntil: 9e15 } }));
  const list = config.getFallbackList();
  assert.deepEqual(list.map(({ model }) => model), [...config.GEMINI_DEFAULT_CHAIN]);
  const kept = list.find(({ model }) => model === "gemini-3.5-flash-lite");
  assert.equal(kept.id, "entry_old", "the old entry keeps its place in the list and its id");
  assert.equal(config.getTaskPick("actions"), "entry_old", "so a task's pick still points at it");
  assert.equal(config.fallbackStateStore.get("entry_old").spentUntil, 9e15, "and its mark stays with it");
  assert.ok(list.every(({ connectionId }) => connectionId === "conn_g"));

  // Once only: a list the player cuts back to one entry stays as they left it.
  config.clearFallbackList();
  config.addEntry({ connectionId: "conn_g", model: "gemini-3.5-flash-lite" });
  assert.equal(config.getFallbackList().length, 1);
});

test("an untouched default with a blank model becomes the list too, its model written out", () => {
  storeFormerDefault("");
  const list = config.getFallbackList();
  assert.deepEqual(list.map(({ model }) => model), [...config.GEMINI_DEFAULT_CHAIN]);
  assert.equal(list.find(({ id }) => id === "entry_old").model, "gemini-3.5-flash-lite", "blank meant the old default, and still means it for this entry");
});

// This update resets every Gemini player's list to the default Gemini list —
// the owner's call, so that a list shaped before calls fell through the list
// on a spent allowance gets that behaviour too. Once; the old list is kept.
test("with this update a Gemini list the player shaped becomes the default list once, keeping what it can", () => {
  store.delete("ai_gemini_default_chain_v2");
  storeFormerDefault("gemini-3.6-flash");
  store.set("ai_task_picks", JSON.stringify({ actions: "entry_old" }));
  const list = config.getFallbackList();
  assert.deepEqual(list.map(({ model }) => model), [...config.GEMINI_DEFAULT_CHAIN], "a model they chose is replaced by the list");
  assert.equal(list.find(({ model }) => model === "gemini-3.6-flash").id, "entry_old", "an entry already on a chain model keeps its id");
  assert.ok(list.every(({ connectionId }) => connectionId === "conn_g"));
  assert.equal(config.getTaskPick("actions"), "", "the per-task picks are cleared: every task starts at the top");
  assert.deepEqual(JSON.parse(store.get("ai_fallback_list_before_gemini_reset")).map(({ model }) => model), ["gemini-3.6-flash"], "the old list is kept");

  // Once only: cut back to one entry afterwards, it stays as they left it.
  config.clearFallbackList();
  config.addEntry({ connectionId: "conn_g", model: "gemini-3.6-flash" });
  assert.equal(config.getFallbackList().length, 1);
});

test("the reset leaves a list on another provider alone, and a list already on the default untouched", () => {
  store.delete("ai_gemini_default_chain_v2");
  store.set("ai_connections", JSON.stringify([{ id: "conn_o", provider: "openai-compatible", name: "Local", endpoint: "http://localhost:1234/v1" }]));
  store.set("ai_fallback_list", JSON.stringify([{ id: "entry_local", connectionId: "conn_o", model: "" }]));
  assert.equal(config.getFallbackList().length, 1, "another provider");
  assert.equal(store.get("ai_fallback_list_before_gemini_reset"), undefined, "nothing was backed up because nothing was changed");

  store.clear();
  store.delete("ai_gemini_default_chain_v2");
  storeFormerDefault("gemini-3.5-flash-lite");
  store.set("ai_task_picks", JSON.stringify({ actions: "entry_old" }));
  config.getFallbackList();
  assert.equal(config.getTaskPick("actions"), "entry_old", "a list the old upgrade already made the default keeps its picks");
  assert.equal(store.get("ai_fallback_list_before_gemini_reset"), undefined);
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
  startWithOneEntry();
  const [entry] = config.getFallbackList();
  config.updateConnection(entry.connectionId, { customParams: '{"max_tokens":4096}' });
  const timeSkips = config.addEntry({ connectionId: entry.connectionId, model: entry.model, customParamsOverride: '{"max_tokens":20480}' });
  const [ordinary, big] = config.getResolvedFallbackList();
  assert.equal(ordinary.customParams, '{"max_tokens":4096}');
  assert.equal(big.id, timeSkips);
  assert.equal(big.customParams, '{"max_tokens":20480}');
});

test("removing a Connection says which entries use it, then removes them and their task picks", () => {
  startWithOneEntry();
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
  startWithOneEntry();
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
  startWithOneEntry();
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

test("the rate-limit setting is one choice for the whole list, defaulting to the next model", () => {
  assert.equal(config.getRateLimitPolicy(), "next");
  config.setRateLimitPolicy("wait");
  assert.equal(config.getRateLimitPolicy(), "wait");
  config.setRateLimitPolicy("anything else");
  assert.equal(config.getRateLimitPolicy(), "next");
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
  store.set("api_provider", "gemini"); // migrated: one Gemini connection, no key, the default list
  assert.equal(config.getResolvedFallbackList().length, 6);
  assert.equal(config.isFallbackListConfigured(), false);

  const { connectionId, entryId } = config.applyQuickAiSetup({ provider: "gemini", apiKey: " AIzaQUICK123 ", model: " gemini-3.5-flash " });

  assert.equal(config.getConnections().length, 1, "completed, not duplicated");
  assert.equal(config.getConnections()[0].id, connectionId);
  const list = config.getResolvedFallbackList();
  assert.equal(list[0].id, entryId);
  assert.ok(list.every(({ apiKey }) => apiKey === "AIzaQUICK123"), "the key reaches every entry of the Connection");
  assert.deepEqual(list.map(({ model }) => model), [
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ], "the typed model goes first, the rest stay behind it, and it is not asked twice");
  assert.equal(config.isFallbackListConfigured(), true);
});

test("quick setup with no model keeps the whole default list, the key on all of it", () => {
  store.set("api_provider", "gemini");
  config.applyQuickAiSetup({ provider: "gemini", apiKey: "AIzaBLANK" });
  const list = config.getResolvedFallbackList();
  assert.deepEqual(list.map(({ model }) => model), [...config.GEMINI_DEFAULT_CHAIN]);
  assert.ok(list.every(({ apiKey }) => apiKey === "AIzaBLANK"));
});

test("quick setup that adds a new Gemini connection gives it the default list, at the top", () => {
  startWithOneEntry();
  store.set("gemini_api_key", "AIzaFIRSTKEY"); // the migrated Gemini connection already has a key
  const [before] = config.getFallbackList();
  const { connectionId, entryId } = config.applyQuickAiSetup({ provider: "gemini", apiKey: "AIzaSECONDKEY" });
  const list = config.getResolvedFallbackList();
  assert.equal(config.getConnections().length, 2, "a second Gemini connection");
  assert.equal(list[0].id, entryId);
  assert.deepEqual(list.slice(0, 6).map(({ model, connectionId: id }) => `${model}@${id === connectionId ? "new" : "old"}`), config.GEMINI_DEFAULT_CHAIN.map((model) => `${model}@new`));
  assert.equal(list[6].id, before.id, "the old entry follows the new list");
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
  assert.equal(list.length, 1 + config.GEMINI_DEFAULT_CHAIN.length);
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
