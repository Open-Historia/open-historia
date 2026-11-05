import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SAVE_MOVE_MAGIC as SENDER_MAGIC, packSaves, receiverOrigin, gameBase } from "../../../public/save-move/sender.js";
import { SAVE_MOVE_MAGIC, SAVE_MOVE_STATE_KEY, mergePackedSaves, openPackedSaves, shouldTryMove } from "./saveMove.js";

// A stand-in for idb.js: stores as Maps.
const fakeDb = (seed = {}) => {
  const STORES = { scenarios: "scenarios", games: "games", mapeditorDocs: "mapeditorDocs", basemapMeta: "basemapMeta", basemapPayload: "basemapPayload", flags: "flags", kv: "kv" };
  const stores = Object.fromEntries(Object.keys(STORES).map((name) => [name, new Map()]));
  for (const [store, records] of Object.entries(seed)) for (const record of records) stores[store].set(record.id ?? record.key, record);
  return {
    STORES,
    stores,
    idbGet: async (store, id) => stores[store].get(id),
    idbGetAllKeys: async (store) => [...stores[store].keys()],
    idbPut: async (store, record) => { stores[store].set(record.id ?? record.key, record); },
    kvGet: async (key, fallback = null) => (stores.kv.has(key) ? stores.kv.get(key).value : fallback),
    kvPut: async (key, value) => { stores.kv.set(key, { key, value }); },
  };
};
const fakeStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, value), map };
};
const game = (id, updatedAt, extra = {}) => ({ id, meta: { id, scenarioId: "default", updatedAt, ...extra }, json: { world: { round: 7 } } });
const scenario = (id, updatedAt, extra = {}) => ({ id, meta: { id, updatedAt }, json: {}, ...extra });

test("the page that packs and the game that unpacks agree on the file", async () => {
  assert.equal(SENDER_MAGIC, SAVE_MOVE_MAGIC);
  const bytes = new Uint8Array([1, 2, 3, 250]);
  const record = { id: "a", when: new Date(1700000000000), cover: bytes, raw: bytes.buffer.slice(0), nested: [{ picture: new Blob(["hi"], { type: "image/png" }) }], gone: undefined, text: "Ünïcode ✓" };
  const packed = await openPackedSaves(packSaves([{ store: "games", record }, { store: "kv", record: { key: "game-manifest", value: { order: ["a"] } } }], { theme: "dark" }));
  assert.deepEqual(packed.settings, { theme: "dark" });
  assert.equal(packed.entries.length, 2);
  const back = await packed.read(packed.entries[0]);
  assert.equal(back.text, "Ünïcode ✓");
  assert.equal(back.when.getTime(), 1700000000000);
  assert.ok(back.cover instanceof Uint8Array);
  assert.deepEqual([...back.cover], [1, 2, 3, 250]);
  assert.deepEqual([...new Uint8Array(back.raw)], [1, 2, 3, 250]);
  assert.equal(back.nested[0].picture.type, "image/png");
  assert.equal(await back.nested[0].picture.text(), "hi");
  assert.equal("gone" in back, false);
  await assert.rejects(openPackedSaves(new Blob(["something else entirely"])));
});

test("saves arrive beside what is here, and nothing here is replaced", async () => {
  const here = fakeDb({
    scenarios: [scenario("default", "2026-10-09"), scenario("rome", "2026-10-01")],
    games: [game("modern-day-session", "2026-10-10", { name: "started again" })],
    kv: [{ key: "game-manifest", value: { activeGameId: "modern-day-session", order: ["modern-day-session"] } }, { key: "scenario-manifest", value: { order: ["default", "rome"], selectedScenarioId: "default" } }],
  });
  const packed = await openPackedSaves(packSaves([
    { store: "scenarios", record: scenario("default", "2026-08-01") },
    { store: "scenarios", record: scenario("rome", "2026-10-01") },
    { store: "scenarios", record: scenario("rome-mine", "2026-09-01") },
    { store: "scenarios", record: scenario("custom", "2026-09-02") },
    { store: "games", record: game("modern-day-session", "2026-09-20", { name: "forty turns in" }) },
    { store: "games", record: game("rome-run", "2026-09-21", { scenarioId: "custom" }) },
    { store: "flags", record: { id: "flag-1", bytes: new Uint8Array([9]) } },
    { store: "kv", record: { key: "game-manifest", value: { activeGameId: "rome-run", order: ["rome-run", "modern-day-session"] } } },
    { store: "kv", record: { key: "scenario-manifest", value: { order: ["default", "custom", "rome", "rome-mine"] } } },
    { store: "kv", record: { key: "ui-settings", value: { language: "de" } } },
  ], { "oh-ai-key": "theirs", theme: "light", [SAVE_MOVE_STATE_KEY]: "x" }));
  const storage = fakeStorage({ theme: "dark" });
  const moved = await mergePackedSaves(packed, here, storage);

  assert.deepEqual({ games: moved.games, scenarios: moved.scenarios, others: moved.others }, { games: 2, scenarios: 2, others: 1 });
  // The game started here since is kept; the old one arrives under a new id.
  assert.equal(here.stores.games.get("modern-day-session").meta.name, "started again");
  assert.equal(here.stores.games.get("modern-day-session-moved").meta.name, "forty turns in");
  assert.equal(here.stores.games.get("modern-day-session-moved").meta.id, "modern-day-session-moved");
  assert.equal(here.stores.games.get("rome-run").meta.scenarioId, "custom");
  // The built-in scenario and an identical download are not carried twice.
  assert.equal(here.stores.scenarios.get("default").meta.updatedAt, "2026-10-09");
  assert.deepEqual([...here.stores.scenarios.keys()].sort(), ["custom", "default", "rome", "rome-mine"]);
  assert.deepEqual(here.stores.kv.get("game-manifest").value, { activeGameId: "modern-day-session", order: ["modern-day-session", "rome-run", "modern-day-session-moved"] });
  assert.deepEqual(here.stores.kv.get("scenario-manifest").value.order, ["default", "rome", "custom", "rome-mine"]);
  assert.deepEqual(here.stores.kv.get("ui-settings").value, { language: "de" });
  assert.ok(here.stores.flags.has("flag-1"));
  // Settings: only what this address lacks, and never the mover's own note.
  assert.equal(storage.map.get("theme"), "dark");
  assert.equal(storage.map.get("oh-ai-key"), "theirs");
  assert.equal(storage.map.has(SAVE_MOVE_STATE_KEY), false);
});

test("an empty library opens the game they were playing, and a second run adds nothing", async () => {
  const here = fakeDb({ scenarios: [scenario("default", "2026-10-09")] });
  const entries = [
    { store: "scenarios", record: scenario("mine", "2026-09-01") },
    { store: "games", record: game("a", "2026-09-20", { scenarioId: "mine" }) },
    { store: "kv", record: { key: "game-manifest", value: { activeGameId: "a", order: ["a"] } } },
  ];
  await mergePackedSaves(await openPackedSaves(packSaves(entries)), here, fakeStorage());
  assert.deepEqual(here.stores.kv.get("game-manifest").value, { activeGameId: "a", order: ["a"] });
  const again = await mergePackedSaves(await openPackedSaves(packSaves(entries)), here, fakeStorage());
  assert.deepEqual({ games: again.games, scenarios: again.scenarios }, { games: 0, scenarios: 0 });
  assert.deepEqual([...here.stores.games.keys()], ["a"]);
});

test("a scenario whose id is taken by another one takes its games with it", async () => {
  const here = fakeDb({ scenarios: [scenario("default", "x"), scenario("custom", "2026-10-05")] });
  await mergePackedSaves(await openPackedSaves(packSaves([
    { store: "scenarios", record: scenario("custom", "2026-09-01") },
    { store: "games", record: game("g", "2026-09-02", { scenarioId: "custom" }) },
  ])), here, fakeStorage());
  assert.equal(here.stores.scenarios.get("custom").meta.updatedAt, "2026-10-05");
  assert.equal(here.stores.scenarios.get("custom-moved").meta.id, "custom-moved");
  assert.equal(here.stores.games.get("g").meta.scenarioId, "custom-moved");
});

test("the trip is made a few times at most, hours apart, and never after an answer", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldTryMove({}, now), true);
  assert.equal(shouldTryMove({ done: "moved" }, now), false);
  assert.equal(shouldTryMove({ done: "none" }, now), false);
  assert.equal(shouldTryMove({ tries: 1, at: now - 60_000 }, now), false);
  assert.equal(shouldTryMove({ tries: 1, at: now - 7 * 3600_000 }, now), true);
  assert.equal(shouldTryMove({ tries: 3, at: now - 48 * 3600_000 }, now), false);
});

test("the saves can only be sent to the same host over https", () => {
  assert.equal(receiverOrigin({ hostname: "openhistoria.com", host: "openhistoria.com", search: "?to=https://evil.example" }), "https://openhistoria.com");
  assert.equal(receiverOrigin({ hostname: "localhost", host: "localhost:5001", search: "?to=http://localhost:5002" }), "http://localhost:5002");
  assert.equal(receiverOrigin({ hostname: "localhost", host: "localhost:5001", search: "?to=https://evil.example" }), "");
  assert.equal(gameBase("?back=/play/"), "/play/");
  assert.equal(gameBase("?back=//evil.example/"), "/play/");
  assert.equal(gameBase("?back=https://evil.example/"), "/play/");
  assert.equal(gameBase(""), "/play/");
});

test("the pieces are wired: the worker keeps the file, the game looks for it first, the site ships the page", () => {
  const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const worker = read("../../../public/sw.js");
  assert.match(worker, /\/save-move\/receive/);
  assert.match(worker, /caches\.open\("oh-save-move"\)/);
  assert.match(worker, /oh-save-move-1/);
  const boot = read("./index.js");
  assert.ok(boot.indexOf("bringHttpSavesAcross({ db: idb })") < boot.indexOf("await ensureSeeded()"), "saves come across before the library is seeded and read");
  assert.match(read("../../../scripts/assemble-site.mjs"), /"save-move"/);
  // The game drops every cache it does not know as it loads; the arriving saves must not be one of them.
  // (Beside the kept music's cache, which the sweep spares too: runtime/keptMusic.js.)
  assert.match(read("../assets.js"), /const KEPT_CACHE_NAMES = new Set\(\[[^\]]*\bSAVE_MOVE_CACHE_NAME,/);
  assert.match(read("../assets.js"), /if \(!KEPT_CACHE_NAMES\.has\(key\)\) caches\.delete\(key\)/);
  assert.match(read("../assets.js"), /SAVE_MOVE_CACHE_NAME = "oh-save-move"/);
  assert.match(read("../../../public/save-move/index.html"), /data-save-move="sender"/);
});
