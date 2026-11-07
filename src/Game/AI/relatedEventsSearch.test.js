import assert from "node:assert/strict";
import test from "node:test";
import { MAP_SETTING_KEYS } from "../../runtime/mapSettings.js";
import { contentHash } from "../../runtime/embeddingModels.js";
import { LOOKUP_TOOLS, SIMILAR_EVENTS_FUNCTION, SIMILAR_EVENTS_TOOL, withSimilarEvents } from "./lookupTools.js";
import {
  findRelatedForSkip,
  indexOpenGame,
  relatedEventsOn,
  relatedEventsReady,
  setRelatedEventsDepsForTests,
  similarEventsSearch,
} from "./relatedEventsSearch.js";

// The setting lives in localStorage; node has none.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const setting = (on) => storage.set(MAP_SETTING_KEYS.relatedEvents, on ? "1" : "0");

// A fake model: a text's vector is which of three words it holds.
const WORDS = ["war", "treaty", "harvest"];
const vectorOf = (text) => {
  const hits = WORDS.map((word) => (String(text).toLowerCase().includes(word) ? 1 : 0));
  // A text with none of the words points somewhere else entirely.
  const raw = [...hits, hits.some(Boolean) ? 0 : 1];
  const norm = Math.hypot(...raw);
  return Float32Array.from(raw.map((value) => value / norm));
};
const fakeModel = ({ delayMs = 0 } = {}) => {
  const calls = [];
  return {
    calls,
    module: async () => ({
      embedTexts: async (texts) => {
        calls.push(texts);
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return texts.map(vectorOf);
      },
    }),
  };
};
const fakeStore = () => {
  const games = new Map();
  return {
    games,
    readGame: async (gameId) => new Map(games.get(gameId) ?? []),
    write: async (gameId, rows) => {
      const game = games.get(gameId) ?? new Map();
      for (const row of rows) game.set(row.eventId, { hash: row.hash, vector: row.vector });
      games.set(gameId, game);
    },
    remove: async (gameId, ids) => { for (const id of ids) games.get(gameId)?.delete(id); },
  };
};

const events = [
  { id: "e1", date: "1939-09-01", title: "The war begins", description: "Armies cross the border." },
  { id: "e2", date: "1939-10-01", title: "A treaty is signed", description: "Peace in the north." },
  { id: "e3", date: "1939-11-01", title: "A harvest festival", description: "Bread for all." },
];
const bundle = {
  game: { country: "Italy" },
  events,
  actions: [{ status: "planned", title: "Sign a treaty with France" }],
  world: { wars: [], storylines: [] },
};

test("off by default: no search, no lookup, the model never touched", async () => {
  storage.clear();
  const model = fakeModel();
  setRelatedEventsDepsForTests({ model: model.module, store: fakeStore, focusPowers: async () => [] });
  assert.equal(relatedEventsOn(), false);
  assert.equal(await findRelatedForSkip(bundle, { campaignId: "g1" }), null);
  assert.equal(similarEventsSearch(bundle, { campaignId: "g1" }), null);
  await indexOpenGame();
  assert.deepEqual(model.calls, []);
  setRelatedEventsDepsForTests(null);
});

test("the index embeds new and changed events while idle, and drops deleted ones", async () => {
  storage.clear();
  setting(true);
  const model = fakeModel();
  const store = fakeStore();
  let busy = 2;
  const slept = [];
  let readEvents = events;
  setRelatedEventsDepsForTests({
    model: model.module,
    store: () => store,
    campaign: () => "g1",
    readEvents: async () => readEvents,
    busy: () => busy > 0,
    sleep: async (ms) => { slept.push(ms); busy -= 1; },
  });
  await indexOpenGame();
  assert.equal(slept.length, 2, "it waited for the turn to finish before starting");
  assert.deepEqual(model.calls.flat().length, 3);
  assert.deepEqual([...store.games.get("g1").keys()].sort(), ["e1", "e2", "e3"]);
  assert.equal(store.games.get("g1").get("e1").hash, contentHash("The war begins. Armies cross the border."));

  // Nothing new: nothing embedded again.
  model.calls.length = 0;
  await indexOpenGame();
  assert.deepEqual(model.calls, []);

  // One changed, one deleted.
  readEvents = [{ ...events[0], description: "Armies cross the river." }, events[1]];
  await indexOpenGame();
  assert.deepEqual(model.calls, [["The war begins. Armies cross the river."]]);
  assert.deepEqual([...store.games.get("g1").keys()].sort(), ["e1", "e2"]);
  setRelatedEventsDepsForTests(null);
});

test("the index stops when the player switches games", async () => {
  storage.clear();
  setting(true);
  const model = fakeModel();
  const store = fakeStore();
  const many = Array.from({ length: 40 }, (_, at) => ({ id: `e${at}`, title: `War ${at}`, description: "x" }));
  let campaign = "g1";
  let reads = 0;
  setRelatedEventsDepsForTests({
    model: async () => ({ embedTexts: async (texts) => { campaign = "g2"; return texts.map(vectorOf); } }),
    store: () => store,
    campaign: () => campaign,
    readEvents: async () => { reads += 1; return reads === 1 ? many : []; },
    busy: () => false,
  });
  await indexOpenGame();
  assert.equal(store.games.get("g1").size, 4, "one batch, then it stopped");
  assert.equal(model.calls.length, 0);
  setRelatedEventsDepsForTests(null);
});

test("a skip gets ranked candidates, quickly, or nothing", async () => {
  storage.clear();
  setting(true);
  const store = fakeStore();
  await store.write("g1", events.map((event) => ({ eventId: event.id, hash: "h", vector: vectorOf(`${event.title} ${event.description}`) })));
  setRelatedEventsDepsForTests({ model: fakeModel().module, store: () => store, focusPowers: async () => ["France"] });
  const ranked = await findRelatedForSkip(bundle, { campaignId: "g1" });
  assert.equal(ranked[0].id, "e2", "the treaty the order is about comes first");
  assert.ok(!ranked.some((row) => row.id === "e3"), "the harvest is not related");

  // A model that is not ready in time: the skip goes without, and does not wait.
  setRelatedEventsDepsForTests({ model: fakeModel({ delayMs: 400 }).module, store: () => store, focusPowers: async () => [] });
  const started = Date.now();
  assert.equal(await findRelatedForSkip(bundle, { campaignId: "g1", timeoutMs: 50 }), null);
  assert.ok(Date.now() - started < 300);

  // A model that fails: the skip goes without.
  setRelatedEventsDepsForTests({ model: async () => { throw new Error("no wasm"); }, store: () => store, focusPowers: async () => [] });
  assert.equal(await findRelatedForSkip(bundle, { campaignId: "g1" }), null);

  // Nothing indexed yet: nothing, and no model needed.
  const model = fakeModel();
  setRelatedEventsDepsForTests({ model: model.module, store: fakeStore, focusPowers: async () => [] });
  assert.equal(await findRelatedForSkip(bundle, { campaignId: "g1" }), null);
  assert.deepEqual(model.calls, []);
  setRelatedEventsDepsForTests(null);
});

test("similar_events is offered only with the setting on and the model loaded, and answers from this game", async () => {
  storage.clear();
  setting(true);
  const store = fakeStore();
  await store.write("g1", events.map((event) => ({ eventId: event.id, hash: "h", vector: vectorOf(`${event.title} ${event.description}`) })));
  setRelatedEventsDepsForTests({ model: fakeModel().module, store: () => store, focusPowers: async () => [] });
  assert.equal(relatedEventsReady(), false, "not before the model has answered once");
  assert.equal(similarEventsSearch(bundle, { campaignId: "g1" }), null);
  await findRelatedForSkip(bundle, { campaignId: "g1" });
  assert.equal(relatedEventsReady(), true);
  const search = similarEventsSearch(bundle, { campaignId: "g1" });
  assert.equal(typeof search, "function");

  const base = { tools: LOOKUP_TOOLS, maxRounds: 2, execute: async (name) => `answered ${name}` };
  const lookups = withSimilarEvents(base, search);
  assert.equal(lookups.tools.length, LOOKUP_TOOLS.length + 1);
  assert.equal(lookups.tools.at(-1), SIMILAR_EVENTS_TOOL);
  assert.equal(lookups.maxRounds, 2);
  assert.equal(await lookups.execute("war_ledger", {}), "answered war_ledger");
  const answer = await lookups.execute(SIMILAR_EVENTS_FUNCTION, { query: "the war at the border", limit: 1 });
  assert.deepEqual(answer.events.map((event) => event.title), ["The war begins"]);
  assert.ok((await lookups.execute(SIMILAR_EVENTS_FUNCTION, {})).error, "a query is required");

  // Off again: not offered.
  setting(false);
  assert.equal(similarEventsSearch(bundle, { campaignId: "g1" }), null);
  assert.equal(withSimilarEvents(base, null), base);
  assert.equal(withSimilarEvents(null, search), null, "no lookups at all (Save AI requests), nothing added");
  setRelatedEventsDepsForTests(null);
});

test("the tool has the lookup shape: a name, a description and an object schema needing a query", () => {
  assert.equal(SIMILAR_EVENTS_TOOL.name, "similar_events");
  assert.equal(SIMILAR_EVENTS_TOOL.schema.type, "object");
  assert.deepEqual(SIMILAR_EVENTS_TOOL.schema.required, ["query"]);
  assert.equal(SIMILAR_EVENTS_TOOL.schema.additionalProperties, false);
  assert.ok(!LOOKUP_TOOLS.some((tool) => tool.name === "similar_events"), "never declared unless the setting is on");
});
