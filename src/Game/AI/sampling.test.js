/*! Open Historia — per-task temperature tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/sampling.test.js
//
// sampling.js is import-free. The key check reads the task registry in
// providerConfig.js, which reads browser localStorage, so a Map-backed stand-in
// is installed before it is imported (as providerConfig.test.js does).
//
// A key that names no task is silently inert, and a broken refusal memory
// spends one refused request on every call to a reasoning model, so both are
// pinned here (docs/ai-overview.md "Per-task sampling temperature").

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_TEMPERATURE,
  TASK_TEMPERATURES,
  TEMPERATURE_REFUSAL_KEY,
  TEMPERATURE_REFUSAL_TTL_MS,
  createTemperatureMemory,
  temperatureBody,
  temperatureForTask,
  temperatureRefusalKey,
} from "./sampling.js";

const localStore = new Map();
globalThis.localStorage = {
  getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
  setItem: (key, value) => { localStore.set(key, String(value)); },
  removeItem: (key) => { localStore.delete(key); },
  clear: () => { localStore.clear(); },
  key: (index) => [...localStore.keys()][index] ?? null,
  get length() { return localStore.size; },
};
const { AI_TASK_ROUTING } = await import("./providerConfig.js");
const defaultPrompts = JSON.parse(readFileSync(new URL("./defaultPrompts.json", import.meta.url), "utf8"));

// A Storage-shaped object over a Map, for the refusal memory.
const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
};

// ---------------------------------------------------------------------------
// The table

test("every temperature key names a real task", () => {
  // A call names either a routed task (turnReview is one, and has no prompt of
  // its own) or a prompt-pack task (demandCheck and intelligenceAssessment are
  // prompts without a player pick). Anything else would never be looked up.
  const known = new Set([
    ...AI_TASK_ROUTING.map(({ key }) => key),
    ...Object.keys(defaultPrompts.tasks ?? {}),
  ]);
  const unknown = Object.keys(TASK_TEMPERATURES).filter((key) => !known.has(key));
  assert.deepEqual(unknown, []);
  assert.ok(known.has("turnReview"));
});

test("every temperature in the table is a number from 0 to 1", () => {
  for (const [key, value] of Object.entries(TASK_TEMPERATURES)) {
    assert.equal(typeof value, "number", key);
    assert.ok(value >= 0 && value <= 1, `${key} is ${value}`);
    assert.equal(temperatureForTask(key), value, key);
  }
  assert.ok(Object.isFrozen(TASK_TEMPERATURES));
});

test("a task not in the table, or no task at all, sends no temperature", () => {
  assert.equal(temperatureForTask("jumpForward"), NO_TEMPERATURE);
  assert.equal(temperatureForTask("advisor"), NO_TEMPERATURE);
  assert.equal(temperatureForTask("no such task"), NO_TEMPERATURE);
  assert.equal(temperatureForTask(""), NO_TEMPERATURE);
  assert.equal(temperatureForTask(undefined), NO_TEMPERATURE);
  assert.equal(temperatureForTask(null), NO_TEMPERATURE);
  // Keys off Object.prototype are not tasks.
  assert.equal(temperatureForTask("toString"), NO_TEMPERATURE);
  assert.equal(temperatureForTask("constructor"), NO_TEMPERATURE);
  assert.equal(temperatureForTask("__proto__"), NO_TEMPERATURE);
});

test("a task key is read trimmed", () => {
  assert.equal(temperatureForTask("  geographyResolver "), TASK_TEMPERATURES.geographyResolver);
});

test("temperatureBody gives the field to merge, or nothing", () => {
  assert.deepEqual(temperatureBody("geographyResolver"), { temperature: 0.1 });
  assert.deepEqual(temperatureBody("turnReview", { field: "temp" }), { temp: 0.3 });
  assert.deepEqual(temperatureBody("jumpForward"), {});
  // enabled: false is a model that cannot take one.
  assert.deepEqual(temperatureBody("geographyResolver", { enabled: false }), {});
});

// ---------------------------------------------------------------------------
// Remembering a refusal

test("the refusal key is per provider, endpoint and model, trimmed and lower-cased", () => {
  assert.equal(
    temperatureRefusalKey({ provider: "OpenAI ", endpoint: "https://API.example/v1", model: "O3" }),
    "openai|https://api.example/v1|o3",
  );
  assert.notEqual(
    temperatureRefusalKey({ provider: "openai", endpoint: "e", model: "o3" }),
    temperatureRefusalKey({ provider: "openai", endpoint: "e", model: "o4-mini" }),
  );
  assert.equal(temperatureRefusalKey(), "||");
});

test("a learned refusal holds for that key only, and is written to storage", () => {
  const storage = memoryStorage();
  let clock = 1_000;
  const memory = createTemperatureMemory(storage, { now: () => clock });
  const o3 = temperatureRefusalKey({ provider: "openai", endpoint: "e", model: "o3" });
  const gpt = temperatureRefusalKey({ provider: "openai", endpoint: "e", model: "gpt-4.1" });
  assert.equal(memory.refuses(o3), false);
  memory.learn(o3);
  assert.equal(memory.refuses(o3), true);
  assert.equal(memory.refuses(gpt), false);
  assert.deepEqual(JSON.parse(storage.map.get(TEMPERATURE_REFUSAL_KEY)), { [o3]: 1_000 });
  // An empty key is never remembered.
  memory.learn("");
  assert.equal(memory.refuses(""), false);
});

test("a refusal goes stale after the TTL and is dropped from storage", () => {
  const storage = memoryStorage();
  let clock = 5_000;
  const memory = createTemperatureMemory(storage, { now: () => clock });
  memory.learn("k");
  clock += TEMPERATURE_REFUSAL_TTL_MS - 1;
  assert.equal(memory.refuses("k"), true);
  clock += 1;
  assert.equal(memory.refuses("k"), false);
  assert.deepEqual(JSON.parse(storage.map.get(TEMPERATURE_REFUSAL_KEY)), {});
  assert.equal(TEMPERATURE_REFUSAL_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test("a new session reads what an earlier one learned", () => {
  const storage = memoryStorage();
  createTemperatureMemory(storage, { now: () => 10 }).learn("k");
  const later = createTemperatureMemory(storage, { now: () => 20 });
  assert.equal(later.refuses("k"), true);
});

test("bad or missing storage still remembers within the session", () => {
  const throwing = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  for (const storage of [throwing, null, memoryStorage({ [TEMPERATURE_REFUSAL_KEY]: "not json" })]) {
    const memory = createTemperatureMemory(storage, { now: () => 1 });
    assert.equal(memory.refuses("k"), false);
    memory.learn("k");
    assert.equal(memory.refuses("k"), true);
  }
  // Entries with no usable time are ignored.
  const junk = memoryStorage({ [TEMPERATURE_REFUSAL_KEY]: JSON.stringify({ a: "soon", b: 3 }) });
  const memory = createTemperatureMemory(junk, { now: () => 4 });
  assert.equal(memory.refuses("a"), false);
  assert.equal(memory.refuses("b"), true);
});
