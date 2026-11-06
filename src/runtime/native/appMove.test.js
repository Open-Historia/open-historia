/*! Open Historia — moving the Android app's games to its new id: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/native/appMove.test.js
import assert from "node:assert/strict";
import test from "node:test";

import { packSaves as senderPack } from "../../../public/save-move/sender.js";
import { createSavesPacker, openPackedSaves } from "../web/saveMove.js";
import {
  APP_MOVE_STATE_KEY, APP_MOVED_KEY, bytesToBase64, createPieceSender, inlineCover, moveGamesToApp,
  packLibraryForMove, readSettingsForMove, takeMoveNotice, takeMovedSaves,
} from "./appMove.js";
import { APP_MOVE_TEXTS, cardStage, fallbackAppApk, newAppApk } from "./appMoveCard.js";

const STORE_NAMES = ["scenarios", "games", "mapeditorDocs", "basemapMeta", "basemapPayload", "flags", "kv", "scenarioMeta", "gameMeta", "covers", "snapshots", "snapshotIndex", "trash", "trashMeta"];

// A stand-in for idb.js: stores as Maps.
const fakeDb = (seed = {}) => {
  const STORES = Object.fromEntries(STORE_NAMES.map((name) => [name, name]));
  const stores = Object.fromEntries(STORE_NAMES.map((name) => [name, new Map()]));
  for (const [store, records] of Object.entries(seed)) for (const record of records) stores[store].set(record.id ?? record.key, record);
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  return {
    STORES,
    stores,
    idbGet: async (store, id) => clone(stores[store].get(id)),
    idbGetMany: async (store, ids) => ids.map((id) => clone(stores[store].get(id))),
    idbGetAllKeys: async (store) => [...stores[store].keys()],
    idbPut: async (store, record) => { stores[store].set(record.id ?? record.key, clone(record)); },
    kvGet: async (key, fallback = null) => (stores.kv.has(key) ? clone(stores.kv.get(key).value) : fallback),
    kvPut: async (key, value) => { stores.kv.set(key, { key, value: clone(value) }); },
  };
};
const fakeStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
};
const game = (id, updatedAt, extra = {}) => ({ id, meta: { id, scenarioId: "default", updatedAt, name: id }, json: { world: { round: 7 } }, ...extra });
const scenario = (id, updatedAt, extra = {}) => ({ id, meta: { id, updatedAt }, json: {}, ...extra });

// The old app: a game with a cover and two restore points in their own stores,
// a scenario of the player's, a flag, a kept time skip, settings.
const oldApp = () => ({
  db: fakeDb({
    scenarios: [scenario("default", "2026-11-01"), scenario("mine", "2026-10-02", { cover: { contentType: "image/png", byteLength: 2, key: "scenario:mine" } })],
    games: [game("rome", "2026-11-03", { cover: { contentType: "image/webp", byteLength: 3, key: "game:rome" } })],
    covers: [{ id: "game:rome", contentType: "image/webp", bytes: new Uint8Array([7, 8, 9]) }, { id: "scenario:mine", contentType: "image/png", bytes: new Uint8Array([1, 2]) }],
    snapshotIndex: [{ id: "rome", entries: [{ id: "s2", slot: "rome/s2", round: 2 }, { id: "s1", slot: "rome/s1", round: 1 }] }],
    snapshots: [{ id: "rome/s1", snapshot: { id: "s1", round: 1 } }, { id: "rome/s2", snapshot: { id: "s2", round: 2 } }],
    flags: [{ id: "flag-1", bytes: new Uint8Array([5]) }],
    kv: [
      { key: "game-manifest", value: { activeGameId: "rome", order: ["rome"] } },
      { key: "scenario-manifest", value: { order: ["default", "mine"], selectedScenarioId: "mine" } },
      { key: "ui-settings", value: { language: "fr", theme: "slate" } },
      { key: "parked-turn:rome", value: { campaignId: "rome", round: 8 } },
      { key: "basemaps-manifest", value: { version: 1, order: ["relief"], byHash: { h1: "relief" } } },
      { key: "lang:eo", value: { Hello: "Saluton" } },
      { key: "seeded", value: true },
    ],
  }),
  storage: fakeStorage({ "oh-ai-key": "sk-old", "oh-theme": "slate", oh_debug_log_v1: "x".repeat(10), [APP_MOVED_KEY]: "{}" }),
});

// The file as the plugin assembles it: the head, then every piece written.
const packFile = async (db, storage) => {
  const parts = [];
  const packed = await packLibraryForMove(db, storage, async (piece) => { parts.push(piece); });
  return { ...packed, file: new Blob([packed.head, ...parts]) };
};

const moveOnce = async (from, to, toStorage) => {
  const { file } = await packFile(from.db, from.storage);
  return takeMovedSaves({ db: to, storage: toStorage, info: { moveTo: "", target: "none", incoming: "/data/x/incoming.ohmv" }, fetchFile: async () => file });
};

test("the packer writes the bytes the website's sender writes", async () => {
  const record = { id: "a", when: new Date(1700000000000), cover: new Uint8Array([1, 2, 3]), blob: new Blob(["hi"], { type: "image/png" }), text: "Ünïcode ✓", gone: undefined };
  const entries = [{ store: "games", record }, { store: "kv", record: { key: "game-manifest", value: { order: ["a"] } } }];
  const packer = createSavesPacker();
  for (const { store, record: item } of entries) await packer.add(store, item);
  const mine = new Uint8Array(await packer.finish({ theme: "dark" }).arrayBuffer());
  const theirs = new Uint8Array(await senderPack(entries, { theme: "dark" }).arrayBuffer());
  assert.deepEqual(mine, theirs);
});

test("a game's cover travels inside it, its restore points as rows after it", async () => {
  const { db, storage } = oldApp();
  const record = await inlineCover(db, "game", await db.idbGet("games", "rome"));
  assert.deepEqual([...record.cover.bytes], [7, 8, 9]);
  assert.equal(record.cover.contentType, "image/webp");
  const bare = await inlineCover(db, "game", game("plain", "x", { cover: { key: "game:missing" } }));
  assert.equal("cover" in bare, false, "a marker whose bytes are gone is dropped");
  const { file } = await packFile(db, storage);
  const packed = await openPackedSaves(file);
  const order = packed.entries.map((entry) => entry.store);
  const at = order.indexOf("games");
  assert.deepEqual(order.slice(at, at + 4), ["games", "snapshotIndex", "snapshots", "snapshots"]);
  assert.equal("snapshots" in (await packed.read(packed.entries[at])), false, "the game record carries none");
});

test("settings go but the diagnostics log and the notes about moves", () => {
  const { storage } = oldApp();
  assert.deepEqual(readSettingsForMove(storage), { "oh-ai-key": "sk-old", "oh-theme": "slate" });
});

test("everything arrives in the new app, its settings win, and a second move brings nothing twice", async () => {
  const from = oldApp();
  // The fresh install: the built-in scenario, its own settings, a game started already.
  const to = fakeDb({
    scenarios: [scenario("default", "2026-11-05")],
    games: [game("fresh", "2026-11-05")],
    kv: [{ key: "game-manifest", value: { activeGameId: "fresh", order: ["fresh"] } }, { key: "ui-settings", value: { language: "en" } }, { key: "store-layout", value: 5 },
      { key: "basemaps-manifest", value: { version: 1, order: ["mine"], byHash: { h2: "mine" } } }, { key: "lang:eo", value: { Hello: "Saluton!", Yes: "Jes" } }],
  });
  const toStorage = fakeStorage({ "oh-theme": "default", "oh-new-only": "1" });
  assert.equal(await moveOnce(from, to, toStorage), true, "the page starts again");

  assert.deepEqual([...to.stores.games.keys()].sort(), ["fresh", "rome"]);
  const rome = to.stores.games.get("rome");
  assert.deepEqual([...rome.cover.bytes], [7, 8, 9]);
  assert.deepEqual(to.stores.snapshotIndex.get("rome").entries.map((entry) => entry.slot), ["rome/s2", "rome/s1"]);
  assert.deepEqual(to.stores.snapshots.get("rome/s1").snapshot, { id: "s1", round: 1 });
  assert.deepEqual([...to.stores.scenarios.get("mine").cover.bytes], [1, 2]);
  assert.equal(to.stores.scenarios.get("default").meta.updatedAt, "2026-11-05", "the built-in scenario is the new app's own");
  assert.ok(to.stores.flags.has("flag-1"));
  assert.deepEqual(to.stores.kv.get("parked-turn:rome").value, { campaignId: "rome", round: 8 });
  assert.deepEqual(to.stores.kv.get("basemaps-manifest").value, { version: 1, order: ["mine", "relief"], byHash: { h1: "relief", h2: "mine" } });
  assert.deepEqual(to.stores.kv.get("lang:eo").value, { Hello: "Saluton", Yes: "Jes" });
  assert.deepEqual(to.stores.kv.get("ui-settings").value, { language: "fr", theme: "slate" }, "the old app's settings win");
  assert.equal(to.stores.kv.get("store-layout").value, 0, "the layout pass moves covers and restore points out again");
  assert.deepEqual(to.stores.kv.get("game-manifest").value, { activeGameId: "fresh", order: ["fresh", "rome"] });
  assert.equal(toStorage.getItem("oh-theme"), "slate");
  assert.equal(toStorage.getItem("oh-ai-key"), "sk-old");
  assert.equal(toStorage.getItem("oh-new-only"), "1", "nothing of the new app's own is removed");
  assert.equal(toStorage.getItem(APP_MOVED_KEY), null, "the old app's note stays there");
  assert.equal(takeMoveNotice(toStorage), "arrived");
  assert.equal(takeMoveNotice(toStorage), "", "said once");

  // Played in the new app since: a second move does not bring the old copy again.
  to.stores.games.set("rome", { ...to.stores.games.get("rome"), meta: { ...rome.meta, updatedAt: "2026-11-06" } });
  await moveOnce(from, to, toStorage);
  assert.deepEqual([...to.stores.games.keys()].sort(), ["fresh", "rome"]);
  assert.deepEqual([...to.stores.scenarios.keys()].sort(), ["default", "mine"]);
  assert.deepEqual(to.stores.kv.get("game-manifest").value.order, ["fresh", "rome"]);
  const state = JSON.parse(toStorage.getItem(APP_MOVE_STATE_KEY));
  assert.ok(state.seen.includes("games:rome@2026-11-03"));
});

test("a game whose id is taken arrives beside it, with its own restore points and kept turn", async () => {
  const from = oldApp();
  const to = fakeDb({ scenarios: [scenario("default", "x")], games: [game("rome", "2026-11-04")] });
  await moveOnce(from, to, fakeStorage());
  const moved = to.stores.games.get("rome-moved");
  assert.equal(moved.meta.id, "rome-moved");
  assert.deepEqual(to.stores.snapshotIndex.get("rome-moved").entries.map((entry) => entry.slot), ["rome-moved/s2", "rome-moved/s1"]);
  assert.deepEqual(to.stores.snapshots.get("rome-moved/s2").snapshot, { id: "s2", round: 2 });
  assert.equal(to.stores.snapshotIndex.has("rome"), false, "the game here keeps its own restore points");
  assert.deepEqual(to.stores.kv.get("parked-turn:rome-moved").value, { campaignId: "rome-moved", round: 8 });
  assert.equal(to.stores.kv.has("parked-turn:rome"), false);
});

test("a file that cannot be read is dropped and said so; no file, nothing happens", async () => {
  const storage = fakeStorage();
  let done = 0;
  globalThis.window = { Capacitor: { Plugins: { OhSaveMove: { done: async () => { done += 1; } } } } };
  try {
    const db = fakeDb();
    assert.equal(await takeMovedSaves({ db, storage, info: { moveTo: "", target: "none", incoming: "/x" }, fetchFile: async () => new Blob(["junk"]) }), true);
    assert.equal(done, 1, "the file is deleted");
    assert.equal(takeMoveNotice(storage), "failed");
    assert.equal(await takeMovedSaves({ db, storage, info: { moveTo: "", target: "none", incoming: "" } }), false);
    assert.equal(await takeMovedSaves({ db, storage, info: { moveTo: "io.example.app", target: "same", incoming: "/x" } }), false, "the handover build takes nothing");
    assert.equal(await takeMovedSaves({ db, storage, info: null }), false);
  } finally {
    delete globalThis.window;
  }
});

test("the library goes to the plugin in pieces as it is packed, and the head goes in front", async () => {
  const from = oldApp();
  // A big binary (a basemap's bytes) among small records.
  const big = new Uint8Array(7 * 1024 * 1024 + 5).map((_, i) => (i * 31) % 251);
  from.db.stores.basemapPayload.set("big", { id: "big", bytes: big });
  const pieces = [];
  const calls = [];
  let head = null;
  const bridge = {
    begin: async () => calls.push("begin"),
    append: async ({ data }) => { calls.push("append"); pieces.push(Buffer.from(data, "base64")); },
    send: async (options) => { calls.push("send"); head = Buffer.from(options.head, "base64"); },
  };
  const progress = [];
  const storage = from.storage;
  assert.deepEqual(await moveGamesToApp({ db: from.db, storage, bridge, onProgress: (share) => progress.push(share) }), { games: 1, scenarios: 2 });
  assert.equal(calls[0], "begin");
  assert.equal(calls.at(-1), "send");
  assert.ok(pieces.every((piece) => piece.length <= 3 * 1024 * 1024), "no piece is bigger than a piece");
  assert.ok(pieces.length >= 3);
  assert.equal(progress.at(-1), 1);
  assert.ok(JSON.parse(storage.getItem(APP_MOVED_KEY)).at);
  // What the plugin assembles opens, and the big record is whole.
  const packed = await openPackedSaves(new Blob([head, ...pieces]));
  const entry = packed.entries.find((item) => item.store === "basemapPayload");
  assert.deepEqual(new Uint8Array((await packed.read(entry)).bytes), big);
  assert.equal(bytesToBase64(new Uint8Array([0, 255, 10])), "AP8K");
  await assert.rejects(moveGamesToApp({ db: from.db, storage, bridge: null }));
});

test("the piece sender gathers small writes and cuts big ones", async () => {
  const sent = [];
  const sender = createPieceSender({ append: async ({ data }) => { sent.push(Buffer.from(data, "base64")); } });
  const MB = 1024 * 1024;
  await sender.write(new Uint8Array(10).fill(1));
  await sender.write(new Uint8Array(20).fill(2));
  assert.equal(sent.length, 0, "small writes wait");
  await sender.write(new Uint8Array(7 * MB).fill(3));
  await sender.write(new Blob([new Uint8Array(4 * MB).fill(4)]));
  await sender.flush();
  assert.deepEqual(sent.map((piece) => piece.length), [30, 3 * MB, 3 * MB, MB, 3 * MB, MB]);
  assert.equal(Buffer.concat(sent).length, 30 + 11 * MB);
});

test("what the card shows, and where it gets the new app", async () => {
  assert.equal(cardStage({ moveTo: "a.b", target: "none" }, false), "install");
  assert.equal(cardStage({ moveTo: "a.b", target: "other" }, false), "other");
  assert.equal(cardStage({ moveTo: "a.b", target: "same" }, false), "ready");
  assert.equal(cardStage({ moveTo: "a.b", target: "same" }, true), "moved");
  const answer = (body, ok = true) => async () => ({ ok, json: async () => body });
  assert.equal(await newAppApk("stable", answer({ apk: "https://example.org/a.apk" })), "https://example.org/a.apk");
  assert.equal(await newAppApk("stable", answer({ apk: "http://example.org/a.apk" })), fallbackAppApk("stable"));
  assert.equal(await newAppApk("beta", answer({}, false)), fallbackAppApk("beta"));
  assert.match(fallbackAppApk("stable"), /\/android\/open-historia\.apk$/);
  assert.match(fallbackAppApk("beta"), /\/android-beta\/open-historia-beta\.apk$/);
});

test("the player's words are short and never name anything but Open Historia", () => {
  for (const [key, text] of Object.entries(APP_MOVE_TEXTS)) {
    assert.ok(text.length <= 140, `${key} is short`);
    assert.doesNotMatch(text.replaceAll("Open Historia", ""), /historia/i, key);
  }
});

test("the packed file opens like any other", async () => {
  const { db, storage } = oldApp();
  const { file, games, scenarios } = await packFile(db, storage);
  assert.deepEqual({ games, scenarios }, { games: 1, scenarios: 2 });
  const packed = await openPackedSaves(file);
  assert.deepEqual(packed.entries.map((entry) => entry.store).sort(), ["flags", "games", "kv", "kv", "kv", "kv", "kv", "kv", "scenarios", "scenarios", "snapshotIndex", "snapshots", "snapshots"]);
  assert.equal(packed.settings["oh-ai-key"], "sk-old");
});

test("the app reads the file that arrived from the plugin, a piece at a time", async () => {
  const from = oldApp();
  from.db.stores.basemapPayload.set("big", { id: "big", bytes: new Uint8Array(5 * 1024 * 1024).fill(9) });
  const bytes = new Uint8Array(await (await packFile(from.db, from.storage)).file.arrayBuffer());
  const reads = [];
  let done = 0;
  const bridge = {
    read: async ({ offset, length }) => {
      reads.push(length);
      return { data: Buffer.from(bytes.subarray(offset, offset + length)).toString("base64") };
    },
    done: async () => { done += 1; },
  };
  globalThis.window = { Capacitor: { Plugins: { OhSaveMove: bridge } } };
  try {
    const to = fakeDb({ scenarios: [scenario("default", "x")] });
    assert.equal(await takeMovedSaves({ db: to, storage: fakeStorage(), info: { moveTo: "", target: "none", incoming: "/data/x/incoming.ohmv" } }), true);
    assert.equal(done, 1);
    assert.ok(to.stores.games.has("rome"));
    assert.equal(to.stores.basemapPayload.get("big").bytes.byteLength, 5 * 1024 * 1024);
    assert.ok(Math.max(...reads) <= 3 * 1024 * 1024, "never more than a piece per read");
  } finally {
    delete globalThis.window;
  }
});
