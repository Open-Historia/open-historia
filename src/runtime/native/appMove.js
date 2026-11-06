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
//      in the format the website's own move uses (saveMove.js), writes it into
//      the app's cache and hands it to the new app (SaveMovePlugin.java), which
//      takes it only from an app signed with its own key (SaveMoveActivity.java);
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
import { createSavesPacker, mergePackedSaves, openPackedSaves } from "../web/saveMove.js";

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
const KV_KEYS = ["game-manifest", "scenario-manifest", "ui-settings"];
const PARKED_TURN = "parked-turn:";

// A scenario's or game's own rows go inside it, the way a record written before
// covers and restore points had stores of their own carried them (idb.js
// version 5): the cover's bytes, and a game's restore points as `snapshots`,
// newest first. The game reads that layout and moves it into the stores again
// (libraryStore.js readCover, readRestorePoints, migrateStoreLayout), and a
// game whose id is taken in the new app arrives under another one with its
// restore points still its own.
export const inlineRecordRows = async (db, kind, record) => {
  const { STORES } = db;
  const cover = record.cover;
  if (cover && !cover.bytes && STORES.covers) {
    const row = await db.idbGet(STORES.covers, cover.key || `${kind}:${record.id}`);
    if (row?.bytes) record.cover = { contentType: row.contentType || cover.contentType || "application/octet-stream", bytes: row.bytes };
    else delete record.cover;
  }
  if (kind === "game" && STORES.snapshotIndex && !Array.isArray(record.snapshots) && !Array.isArray(record.json?.snapshots)) {
    const entries = (await db.idbGet(STORES.snapshotIndex, record.id))?.entries ?? [];
    if (entries.length) {
      const rows = await db.idbGetMany(STORES.snapshots, entries.map((entry) => entry.slot));
      record.snapshots = rows.filter((row) => row?.snapshot && typeof row.snapshot === "object").map((row) => row.snapshot);
    }
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

// The whole library and the settings as one file (saveMove.js format), read one
// record at a time.
export const packLibraryForMove = async (db, storage) => {
  const { STORES } = db;
  const packer = createSavesPacker();
  const counts = { games: 0, scenarios: 0 };
  for (const store of RECORD_STORES) {
    if (!STORES[store]) continue;
    for (const key of await db.idbGetAllKeys(STORES[store])) {
      const record = await db.idbGet(STORES[store], key);
      if (!record) continue;
      if (store === "games" || store === "scenarios") {
        await inlineRecordRows(db, store === "games" ? "game" : "scenario", record);
        counts[store] += 1;
      }
      packer.add(store, record);
    }
  }
  for (const key of await db.idbGetAllKeys(STORES.kv)) {
    if (!KV_KEYS.includes(key) && !String(key).startsWith(PARKED_TURN)) continue;
    const record = await db.idbGet(STORES.kv, key);
    if (record) packer.add("kv", record);
  }
  return { file: packer.finish(readSettingsForMove(storage)), ...counts };
};

// Bytes as base64, a slice at a time (String.fromCharCode takes only so many
// arguments).
export const bytesToBase64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

// Writes the file into the app's cache through the plugin, `onProgress(0..1)`
// as it goes, and hands it to the new app. Resolves once the new app has kept
// its copy; it then opens itself and merges it.
export const sendFileToApp = async (file, { bridge = plugin(), onProgress } = {}) => {
  if (!bridge) throw new Error("This app cannot move its games.");
  await bridge.begin();
  for (let at = 0; at < file.size; at += PIECE_BYTES) {
    const piece = new Uint8Array(await file.slice(at, at + PIECE_BYTES).arrayBuffer());
    await bridge.append({ data: bytesToBase64(piece) });
    onProgress?.(Math.min(1, (at + piece.length) / file.size));
  }
  await bridge.send();
};

export const moveGamesToApp = async ({ db, storage = localStorage, onProgress } = {}) => {
  const { file, games, scenarios } = await packLibraryForMove(db, storage);
  await sendFileToApp(file, { onProgress });
  writeJson(storage, APP_MOVED_KEY, { at: Date.now(), games, scenarios });
  return { games, scenarios };
};

export const gamesWereMoved = (storage = localStorage) => Boolean(readJson(storage, APP_MOVED_KEY).at);

export const openApp = async () => {
  await plugin()?.open?.();
};

// --- The app: taking what arrived --------------------------------------------

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
    const read = fetchFile ?? (async (path) => {
      const response = await fetch(window.Capacitor.convertFileSrc(path), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    });
    const moved = await mergePackedSaves(await openPackedSaves(await read(about.incoming)), db, storage, { settingsWin: true, seen, keep: OWN_KEYS });
    writeJson(storage, APP_MOVE_STATE_KEY, {
      at: Date.now(),
      seen: [...new Set([...seen, ...moved.carried])],
      notice: "arrived",
      games: moved.games,
      scenarios: moved.scenarios,
    });
    // What arrived carries its covers and restore points inside the records:
    // the store layout pass moves them into their own stores once more.
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
