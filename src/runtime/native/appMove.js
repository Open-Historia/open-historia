/*! Open Historia — the Android app moves its games from its earlier id © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The app's id changed in November 2026. An installed Android app can never be
// updated to another id: the app under the new one is a separate app beside it,
// with a sandbox of its own, and every game, scenario, setting and AI key a
// player had stayed in the old app's storage (IndexedDB `open-historia-web` and
// localStorage, both keyed by the WebView's address, which changed with the id).
//
// So the old id gets one last build of this same code: the handover
// (mobile/android/app/build.gradle, OH_ANDROID_LEGACY_APP_ID; its page opens at
// the old address, mobile/scripts/legacy-config.mjs). Its players update to it
// as to any build, and then:
//   1. a card (appMoveCard.js) says the game has a new app, downloads it and
//      opens Android's installer on it (UpdatePlugin), which installs it beside
//      this one;
//   2. "Move my games" packs the whole library and the settings into one file,
//      in the format the website's own move uses (saveMove.js), a record at a
//      time straight into the app's cache (so a library of hundreds of MB is
//      never held in the page), and hands it to the new app
//      (SaveMovePlugin.java), which takes it only from an app signed with its
//      own key (SaveMoveActivity.java);
//   3. the new app's page merges it before anything reads the library
//      (takeMovedSaves, called from web/index.js), the old app's settings
//      winning over the ones the fresh install wrote, and starts again once.
// Nothing in the old app is deleted. A second move brings nothing twice: what a
// move brought is remembered by id and save time (saveMove.js movedKey).
//
// The new app reads its updates from update.json; latest.json, which the apps
// installed under the old id read, offers them the handover build
// (.github/workflows/android-apk.yml, web/router.js).

import { nativePlugin } from "./bridge.js";
import { createSavesWriter, mergePackedSaves, openPackedSaves } from "../web/saveMove.js";

// The new app's note of what moves brought (`seen`), and whether to say so.
export const APP_MOVE_STATE_KEY = "oh:app-move";
// The handover build's note that its games went across.
export const APP_MOVED_KEY = "oh:app-moved";
// Settings that belong to the place they are in, never carried.
const OWN_KEYS = [APP_MOVE_STATE_KEY, APP_MOVED_KEY, "oh:http-saves"];

const PLUGIN = "OhSaveMove";
// Raw bytes per call to the plugin: the bridge carries text, so each piece goes
// as base64, a third bigger.
const PIECE_BYTES = 3 * 1024 * 1024;

const plugin = () => (typeof window !== "undefined" && window.Capacitor ? nativePlugin(PLUGIN) : null);

// In a debuggable build Capacitor logs every plugin call and every answer to
// the console, data and all, and the console keeps them: moving a 350 MB
// library took the page past 1.4 GB on the emulator, all of it 3 MB pieces held
// for the log (30 calls of 4 MB: +120 MB logged, +4 MB not). The log is off while
// the move runs. A release build never logs them.
export const withQuietBridge = async (run) => {
  const bridge = typeof window !== "undefined" ? window.Capacitor : null;
  const was = bridge?.isLoggingEnabled;
  if (was) bridge.isLoggingEnabled = false;
  try {
    return await run();
  } finally {
    if (was) bridge.isLoggingEnabled = was;
  }
};

let infoPromise = null;

// { moveTo, target, incoming } from the app, or null on the website, the
// desktop, and an app without the plugin. moveTo is the new app's id in the
// handover build and "" in the app; target is "same", "other" or "none" (is the
// new app installed, signed like this one); incoming is the path of a file the
// handover build sent, waiting to be merged. `fresh` asks again.
export const appMoveInfo = (fresh = false) => {
  if (!infoPromise || fresh) {
    infoPromise = (async () => {
      const bridge = plugin();
      if (!bridge || typeof bridge.info !== "function") return null;
      try {
        const info = await bridge.info();
        return info && typeof info === "object"
          ? { moveTo: String(info.moveTo || ""), target: String(info.target || "none"), incoming: String(info.incoming || "") }
          : null;
      } catch {
        return null;
      }
    })();
  }
  return infoPromise;
};

export const isHandoverBuild = async () => Boolean((await appMoveInfo())?.moveTo);

const readJson = (storage, key) => {
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

const writeJson = (storage, key, value) => {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage full or closed */ }
};

// --- The handover build: packing and sending ---------------------------------

// What the library is made of. The lean scenarioMeta/gameMeta/mapeditorMeta
// rows are rebuilt by the game from the records; the trash stays behind.
const RECORD_STORES = ["scenarios", "games", "mapeditorDocs", "basemapMeta", "basemapPayload", "flags"];
const KV_KEYS = ["game-manifest", "scenario-manifest", "ui-settings", "basemaps-manifest", "mapeditor-manifest"];
// Rows per game (a kept time skip) and per language (text the player's AI
// translated), carried too.
const KV_PREFIXES = ["parked-turn:", "lang:"];

// A scenario's or game's cover goes inside it, the way a record written before
// covers had a store of their own carried it (idb.js version 5); the game reads
// that layout and moves it out again (libraryStore.js readCover,
// migrateStoreLayout). A game's restore points do not: they can be most of a
// library, so each goes as a row of its own after the game (packLibraryForMove),
// and the merge files them under the id the game gets in the new app.
export const inlineCover = async (db, kind, record) => {
  const { STORES } = db;
  const cover = record.cover;
  if (cover && !cover.bytes && STORES.covers) {
    const row = await db.idbGet(STORES.covers, cover.key || `${kind}:${record.id}`);
    if (row?.bytes) record.cover = { contentType: row.contentType || cover.contentType || "application/octet-stream", bytes: row.bytes };
    else delete record.cover;
  }
  return record;
};

// Every setting the page keeps, but the diagnostics log (big, and this app's
// own sessions) and the notes about moves.
export const readSettingsForMove = (storage) => {
  const settings = {};
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      const value = storage.getItem(key);
      if (key == null || value == null || key.startsWith("oh_debug_log") || OWN_KEYS.includes(key) || value.length > 200000) continue;
      settings[key] = value;
    }
  } catch { /* storage closed to this page: the games still go */ }
  return settings;
};

// The whole library and the settings as one file (saveMove.js format), read
// one record and written one record at a time: `write` gets every piece as it
// is made, and the answer's `head` goes in front of them all. `onRecord(done,
// total)` counts the records.
export const packLibraryForMove = async (db, storage, write, { onRecord } = {}) => {
  const { STORES } = db;
  const writer = createSavesWriter(write);
  const counts = { games: 0, scenarios: 0 };
  const keys = [];
  for (const store of RECORD_STORES) {
    if (!STORES[store]) continue;
    for (const key of await db.idbGetAllKeys(STORES[store])) keys.push([store, key]);
  }
  const kvKeys = (await db.idbGetAllKeys(STORES.kv)).filter((key) => KV_KEYS.includes(key) || KV_PREFIXES.some((prefix) => String(key).startsWith(prefix)));
  const total = keys.length + kvKeys.length;
  let done = 0;
  for (const [store, key] of keys) {
    const record = await db.idbGet(STORES[store], key);
    onRecord?.(++done, total);
    if (!record) continue;
    if (store === "games" || store === "scenarios") {
      await inlineCover(db, store === "games" ? "game" : "scenario", record);
      counts[store] += 1;
    }
    await writer.add(store, record);
    // A game's restore points, one row at a time, after the game.
    if (store === "games" && STORES.snapshotIndex && !Array.isArray(record.snapshots) && !Array.isArray(record.json?.snapshots)) {
      const index = await db.idbGet(STORES.snapshotIndex, record.id);
      if (!Array.isArray(index?.entries) || !index.entries.length) continue;
      await writer.add("snapshotIndex", index);
      for (const entry of index.entries) {
        const row = await db.idbGet(STORES.snapshots, entry.slot);
        if (row) await writer.add("snapshots", row);
      }
    }
  }
  for (const key of kvKeys) {
    const record = await db.idbGet(STORES.kv, key);
    onRecord?.(++done, total);
    if (record) await writer.add("kv", record);
  }
  return { head: writer.head(readSettingsForMove(storage)), size: writer.written, ...counts };
};

// Bytes as base64, a slice at a time (String.fromCharCode takes only so many
// arguments).
export const bytesToBase64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

// What the page writes goes to the plugin in pieces of PIECE_BYTES: small
// records are gathered into one piece, a big one is cut into several, a Blob is
// read a slice at a time. Nothing bigger than a piece is held for the bridge.
export const createPieceSender = (bridge) => {
  let held = [];
  let heldBytes = 0;
  const send = async (bytes) => { await bridge.append({ data: bytesToBase64(bytes) }); };
  const flush = async () => {
    if (!heldBytes) return;
    const piece = new Uint8Array(heldBytes);
    let at = 0;
    for (const part of held) { piece.set(part, at); at += part.byteLength; }
    held = [];
    heldBytes = 0;
    await send(piece);
  };
  const write = async (part) => {
    if (part instanceof Blob) {
      for (let at = 0; at < part.size; at += PIECE_BYTES) await write(new Uint8Array(await part.slice(at, at + PIECE_BYTES).arrayBuffer()));
      return;
    }
    if (heldBytes + part.byteLength <= PIECE_BYTES) {
      held.push(part);
      heldBytes += part.byteLength;
      if (heldBytes === PIECE_BYTES) await flush();
      return;
    }
    await flush();
    for (let at = 0; at < part.byteLength; at += PIECE_BYTES) {
      const slice = part.subarray(at, at + PIECE_BYTES);
      if (slice.byteLength === PIECE_BYTES) await send(slice);
      else { held.push(slice); heldBytes += slice.byteLength; }
    }
  };
  return { write, flush };
};

// Packs the library straight into the app's cache through the plugin and hands
// the file to the new app. Resolves once the new app has kept its copy; it then
// opens itself and merges it. `onProgress(0..1)` follows the records.
export const moveGamesToApp = (options = {}) => withQuietBridge(() => packAndSend(options));

const packAndSend = async ({ db, storage = localStorage, bridge = plugin(), onProgress } = {}) => {
  if (!bridge) throw new Error("This app cannot move its games.");
  await bridge.begin();
  const sender = createPieceSender(bridge);
  const { head, games, scenarios } = await packLibraryForMove(db, storage, sender.write, {
    onRecord: (done, total) => onProgress?.(total ? done / total : 1),
  });
  await sender.flush();
  await bridge.send({ head: bytesToBase64(head) });
  writeJson(storage, APP_MOVED_KEY, { at: Date.now(), games, scenarios });
  return { games, scenarios };
};

export const gamesWereMoved = (storage = localStorage) => Boolean(readJson(storage, APP_MOVED_KEY).at);

export const openApp = async () => {
  await plugin()?.open?.();
};

// --- The app: taking what arrived --------------------------------------------

export const base64ToBytes = (text) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// The file that arrived, read where it lies: openPackedSaves asks for one
// record's bytes at a time (slice), and the plugin reads them from the file in
// pieces, so the page never holds the whole file, as it would as a Blob.
export const nativeFileSource = (bridge, path) => ({
  slice: (start, end) => {
    const bytes = async () => {
      const out = new Uint8Array(Math.max(0, end - start));
      let at = 0;
      while (at < out.length) {
        const { data } = await bridge.read({ path, offset: start + at, length: Math.min(PIECE_BYTES, out.length - at) });
        const piece = base64ToBytes(String(data ?? ""));
        if (!piece.length) throw new Error("The file that arrived is shorter than its index says.");
        out.set(piece, at);
        at += piece.length;
      }
      return out;
    };
    return {
      arrayBuffer: async () => (await bytes()).buffer,
      text: async () => new TextDecoder().decode(await bytes()),
    };
  },
});

// Merges the file the handover build sent, if one is waiting, and says whether
// the page should start again (it then holds the old app's settings, and
// everything that read the old ones at load has to read them again). Called
// before the library is seeded or read (web/index.js).
export const takeMovedSaves = async ({ db, storage = localStorage, info = null, fetchFile = null } = {}) => {
  const about = info ?? (await appMoveInfo());
  if (!about || about.moveTo || !about.incoming) return false;
  const bridge = plugin();
  const state = readJson(storage, APP_MOVE_STATE_KEY);
  const seen = new Set(Array.isArray(state.seen) ? state.seen : []);
  try {
    const source = fetchFile ? await fetchFile(about.incoming) : nativeFileSource(bridge, about.incoming);
    const moved = await withQuietBridge(async () => mergePackedSaves(await openPackedSaves(source), db, storage, { settingsWin: true, seen, keep: OWN_KEYS }));
    writeJson(storage, APP_MOVE_STATE_KEY, {
      at: Date.now(),
      seen: [...new Set([...seen, ...moved.carried])],
      notice: "arrived",
      games: moved.games,
      scenarios: moved.scenarios,
    });
    // What arrived carries its covers inside the records: the store layout
    // pass moves them into their own store once more.
    try { await db.kvPut("store-layout", 0); } catch { /* read in place meanwhile */ }
  } catch (error) {
    console.warn("The games from the app's earlier id could not be merged:", error);
    writeJson(storage, APP_MOVE_STATE_KEY, { ...state, notice: "failed", failedAt: Date.now() });
  }
  try { await bridge?.done?.(); } catch { /* deleted next time */ }
  return true;
};

// The note to show once, after the page started again: "arrived", "failed" or "".
export const takeMoveNotice = (storage = localStorage) => {
  const state = readJson(storage, APP_MOVE_STATE_KEY);
  if (!state.notice) return "";
  const { notice, ...rest } = state;
  writeJson(storage, APP_MOVE_STATE_KEY, rest);
  return notice;
};

// The handover build hands the games over while this page is open: start again,
// and merge them on the way up.
export const listenForMovedSaves = () => {
  if (typeof window === "undefined") return;
  window.addEventListener("oh:saves-arrived", () => window.location.reload());
};
