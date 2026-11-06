/*! Open Historia — brings a browser's saves across from the http address © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A browser keeps http://openhistoria.com and https://openhistoria.com as two
// sites with two libraries. Players who first came over http had their games
// stored under it; once every http visit was redirected to https they opened an
// empty library, with their games untouched next door (reported 2026-10-10 as
// "saves reset after updating").
//
// This is the https half. Once per browser, as the game starts:
//   1. it sends the browser to http://<this host>/save-move/ (public/save-move/),
//      the only place the old library can be read;
//   2. that page posts the library, packed into one file, back to the game's
//      own address, where the service worker (public/sw.js) keeps it;
//   3. the game starts again, finds the file and merges it into this library.
// Nothing is ever replaced or deleted: a game or scenario whose id is taken here
// arrives under a new id, and the http library is left as it was.
//
// It only leaves the game when the round trip can work: the service worker
// answers, and the site sends https://<host>/save-move/ back to http (which is
// how a browser that upgrades http by itself is made to stay on it). Until the
// site is set up that way this does nothing at all. Web build only.
//
// The Android app moves its saves from one of its ids to another in the same
// file format (appMove.js): it writes the file with createSavesWriter below, a
// piece at a time, and merges it with mergePackedSaves, its settings winning
// over the new app's.

import { DEFAULT_SCENARIO_ID } from "./storeConstants.js";

// The same six bytes public/save-move/sender.js writes (saveMove.test.js checks).
export const SAVE_MOVE_MAGIC = "OHMV1\n";
export const SAVE_MOVE_STATE_KEY = "oh:http-saves";
const CACHE_NAME = "oh-save-move";
const MAX_TRIES = 3;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const SW_WAIT_MS = 4000;
const BIN = "\u0000bin";
const DATE = "\u0000date";
const VIEWS = {
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
};

const isLoopback = (hostname) => hostname === "localhost" || hostname === "127.0.0.1";

// --- Reading the packed file ---------------------------------------------------

// The markers are turned back as JSON.parse builds the record, rather than in
// a second copy of it afterwards: a record can be a 50 MB map.
const decodeRecord = (json, bins) => JSON.parse(json, (_key, value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  if (typeof value[DATE] === "number") return new Date(value[DATE]);
  if (typeof value[BIN] === "number") {
    const buffer = bins[value[BIN]];
    if (value.kind === "buffer") return buffer;
    if (value.kind === "blob") return new Blob([buffer], { type: value.type || "" });
    const View = VIEWS[value.kind] ?? Uint8Array;
    return View === DataView ? new DataView(buffer) : new View(buffer);
  }
  return value;
});

// The file's index, and a reader that unpacks one record at a time, so a library
// with a 100 MB map in it is never held twice.
export const openPackedSaves = async (blob) => {
  const head = SAVE_MOVE_MAGIC.length + 4;
  const start = new Uint8Array(await blob.slice(0, head).arrayBuffer());
  if (new TextDecoder().decode(start.slice(0, SAVE_MOVE_MAGIC.length)) !== SAVE_MOVE_MAGIC) throw new Error("not a saves file");
  const indexLength = new DataView(start.buffer).getUint32(SAVE_MOVE_MAGIC.length, true);
  const index = JSON.parse(await blob.slice(head, head + indexLength).text());
  const data = head + indexLength;
  const slice = ([offset, length]) => blob.slice(data + offset, data + offset + length);
  return {
    settings: index.settings ?? {},
    entries: index.entries ?? [],
    read: async (entry) => decodeRecord(
      await slice(entry.json).text(),
      await Promise.all(entry.bins.map((at) => slice(at).arrayBuffer())),
    ),
  };
};

// --- Writing one -----------------------------------------------------------------

// The file public/save-move/sender.js writes. That page imports nothing, so it
// keeps its own copy; saveMove.test.js holds the two to the same bytes. A record
// as JSON text plus the binary values taken out of it, in order.
// JSON.stringify's replacer takes the binaries and dates out as it goes, so a
// big record is not copied first; the text is the same as sender.js's.
const encodeRecord = (record) => {
  const bins = [];
  const json = JSON.stringify(record, function replace(key, value) {
    const original = this[key];
    if (original instanceof Date) return { [DATE]: original.getTime() };
    if (original === null || typeof original !== "object") return value;
    if (typeof Blob !== "undefined" && original instanceof Blob) {
      bins.push(original);
      return { [BIN]: bins.length - 1, kind: "blob", type: original.type || "" };
    }
    if (original instanceof ArrayBuffer) {
      bins.push(original);
      return { [BIN]: bins.length - 1, kind: "buffer" };
    }
    if (ArrayBuffer.isView(original)) {
      bins.push(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength));
      return { [BIN]: bins.length - 1, kind: original.constructor.name };
    }
    return value;
  });
  return { json, bins };
};

// Text as UTF-8, a slice at a time: a 50 MB record's text is never encoded
// whole. A slice never ends between the two halves of a surrogate pair.
const TEXT_SLICE = 1024 * 1024;
const textPieces = function* textPieces(text) {
  const encoder = new TextEncoder();
  for (let at = 0; at < text.length;) {
    let end = Math.min(text.length, at + TEXT_SLICE);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end += 1;
    yield encoder.encode(text.slice(at, end));
    at = end;
  }
};

// Writes the file a record at a time: each record's text and binaries go to
// `write` (a Uint8Array or a Blob, awaited) as soon as they are made, so a big
// library is never held whole. The index comes last, from head(settings): the
// magic, the index's length (4 bytes, little-endian) and the index (JSON), which
// go IN FRONT of everything written, at the offsets the index gives.
export const createSavesWriter = (write) => {
  const entries = [];
  let offset = 0;
  const place = async (part) => {
    let size = 0;
    if (typeof part === "string") {
      for (const piece of textPieces(part)) {
        size += piece.byteLength;
        await write(piece);
      }
    } else {
      const piece = part instanceof Blob ? part : new Uint8Array(part);
      size = piece instanceof Blob ? piece.size : piece.byteLength;
      await write(piece);
    }
    const at = [offset, size];
    offset += size;
    return at;
  };
  return {
    add: async (store, record) => {
      const { json, bins } = encodeRecord(record);
      const entry = { store, json: await place(json), bins: [] };
      for (const bin of bins) entry.bins.push(await place(bin));
      entries.push(entry);
    },
    get written() { return offset; },
    head: (settings = {}) => {
      const indexText = new TextEncoder().encode(JSON.stringify({ version: 1, settings, entries }));
      const head = new Uint8Array(SAVE_MOVE_MAGIC.length + 4 + indexText.byteLength);
      head.set(new TextEncoder().encode(SAVE_MOVE_MAGIC), 0);
      new DataView(head.buffer).setUint32(SAVE_MOVE_MAGIC.length, indexText.byteLength, true);
      head.set(indexText, SAVE_MOVE_MAGIC.length + 4);
      return head;
    },
  };
};

// The same file as one Blob, for tests and small libraries.
export const createSavesPacker = () => {
  const parts = [];
  const writer = createSavesWriter(async (piece) => { parts.push(piece instanceof Blob ? piece : new Blob([piece])); });
  return {
    add: writer.add,
    finish: (settings = {}) => new Blob([writer.head(settings), ...parts], { type: "application/octet-stream" }),
  };
};

// --- Merging it into this library ----------------------------------------------

const freeId = (wanted, taken) => {
  let next = `${wanted}-moved`;
  let suffix = 2;
  while (taken.has(next)) { next = `${wanted}-moved-${suffix}`; suffix += 1; }
  return next;
};

const sameSave = (a, b) => Boolean(a?.meta?.updatedAt) && a.meta.updatedAt === b?.meta?.updatedAt;

// A record as it was when it arrived, so a later move can tell it came already.
export const movedKey = (store, record) => `${store}:${record?.id ?? ""}@${record?.meta?.updatedAt ?? ""}`;

// A kept time skip (libraryStore.js parkedTurnKey) belongs to one game.
const PARKED_TURN = "parked-turn:";

// `db` is idb.js's surface (idbGet, idbGetAllKeys, idbPut, kvGet, kvPut, STORES),
// passed in so this runs under node:test against a stand-in.
// The options are for the Android app's move from one of its ids to another
// (appMove.js):
//   settingsWin  the file's settings replace the ones here, where otherwise
//                only what this place lacks is taken;
//   seen         movedKey()s of what an earlier move brought: none of it comes
//                a second time, even when the copy here has changed since;
//   keep         settings keys of this place's own that the file never writes.
// `carried` in the answer is the movedKey of every record in the file.
export const mergePackedSaves = async (packed, db, storage, { settingsWin = false, seen = null, keep = [] } = {}) => {
  const { STORES } = db;
  const moved = { games: 0, scenarios: 0, others: 0 };
  const carried = [];
  const cameBefore = (store, record) => {
    const key = movedKey(store, record);
    carried.push(key);
    return Boolean(seen?.has(key));
  };
  const scenarioIds = new Set(await db.idbGetAllKeys(STORES.scenarios));
  const gameIds = new Set(await db.idbGetAllKeys(STORES.games));
  const scenarioIdMap = new Map();
  const gameIdMap = new Map();
  const newScenarios = [];
  const newGames = [];
  const manifests = {};
  const byStore = (store) => packed.entries.filter((entry) => entry.store === store);

  for (const entry of byStore("scenarios")) {
    const record = await packed.read(entry);
    if (!record?.id || cameBefore("scenarios", record)) continue;
    if (scenarioIds.has(record.id)) {
      // The built-in scenario is this build's own, and the same download from
      // the hub is the same scenario: neither is carried a second time.
      if (record.id === DEFAULT_SCENARIO_ID || sameSave(record, await db.idbGet(STORES.scenarios, record.id))) continue;
      const id = freeId(record.id, scenarioIds);
      scenarioIdMap.set(record.id, id);
      record.id = id;
      if (record.meta) record.meta.id = id;
    }
    scenarioIds.add(record.id);
    await db.idbPut(STORES.scenarios, record);
    newScenarios.push(record.id);
    moved.scenarios += 1;
  }

  for (const entry of byStore("games")) {
    const record = await packed.read(entry);
    if (!record?.id || cameBefore("games", record)) continue;
    const from = record.id;
    if (gameIds.has(record.id)) {
      if (sameSave(record, await db.idbGet(STORES.games, record.id))) continue;
      const id = freeId(record.id, gameIds);
      record.id = id;
      if (record.meta) record.meta.id = id;
    }
    const scenarioId = record.meta?.scenarioId;
    if (scenarioId && scenarioIdMap.has(scenarioId)) record.meta.scenarioId = scenarioIdMap.get(scenarioId);
    gameIdMap.set(from, record.id);
    gameIds.add(record.id);
    await db.idbPut(STORES.games, record);
    newGames.push(record.id);
    moved.games += 1;
  }

  for (const store of ["mapeditorDocs", "basemapMeta", "basemapPayload", "flags"]) {
    if (!STORES[store]) continue;
    const have = new Set(await db.idbGetAllKeys(STORES[store]));
    for (const entry of byStore(store)) {
      const record = await packed.read(entry);
      if (!record?.id || cameBefore(store, record) || have.has(record.id)) continue;
      await db.idbPut(STORES[store], record);
      moved.others += 1;
    }
  }

  // A game's restore points, when they come as rows of their own (appMove.js):
  // its index row first, then each restore point, both under the id the game
  // has here. A game that did not come brings none of them.
  if (STORES.snapshotIndex && STORES.snapshots) {
    const slots = new Map();
    for (const entry of byStore("snapshotIndex")) {
      const row = await packed.read(entry);
      const to = gameIdMap.get(row?.id);
      if (!to || !Array.isArray(row.entries)) continue;
      const entries = row.entries.map((item) => {
        const slot = String(item?.slot ?? "");
        const moved = slot.startsWith(`${row.id}/`) ? `${to}/${slot.slice(row.id.length + 1)}` : `${to}/${slot}`;
        slots.set(slot, moved);
        return { ...item, slot: moved };
      });
      await db.idbPut(STORES.snapshotIndex, { ...row, id: to, entries });
    }
    for (const entry of byStore("snapshots")) {
      const row = await packed.read(entry);
      const slot = slots.get(String(row?.id ?? ""));
      if (!slot) continue;
      await db.idbPut(STORES.snapshots, { ...row, id: slot });
    }
  }

  const parkedTurns = [];
  for (const entry of byStore("kv")) {
    const record = await packed.read(entry);
    if (!record?.key) continue;
    if (String(record.key).startsWith(PARKED_TURN)) parkedTurns.push(record);
    else manifests[record.key] = record.value;
  }
  // A kept time skip goes with its game, under the id the game has here.
  for (const { key, value } of parkedTurns) {
    const id = gameIdMap.get(String(key).slice(PARKED_TURN.length));
    if (!id || !value || typeof value !== "object" || (await db.kvGet(`${PARKED_TURN}${id}`, null)) != null) continue;
    await db.kvPut(`${PARKED_TURN}${id}`, { ...value, campaignId: id });
  }

  // The lists the library is drawn from: what arrived goes after what is here,
  // in the order it had there.
  if (newScenarios.length) {
    const here = await db.kvGet("scenario-manifest", null);
    const order = Array.isArray(here?.order) ? [...here.order] : [DEFAULT_SCENARIO_ID];
    const theirs = (manifests["scenario-manifest"]?.order ?? []).map((id) => scenarioIdMap.get(id) ?? id);
    for (const id of [...theirs, ...newScenarios]) {
      if (newScenarios.includes(id) && !order.includes(id)) order.push(id);
    }
    await db.kvPut("scenario-manifest", { ...(here ?? {}), order, selectedScenarioId: here?.selectedScenarioId ?? DEFAULT_SCENARIO_ID });
  }
  if (newGames.length) {
    const here = await db.kvGet("game-manifest", null);
    const order = Array.isArray(here?.order) ? [...here.order] : [];
    const theirs = (manifests["game-manifest"]?.order ?? []).map((id) => gameIdMap.get(id) ?? id);
    for (const id of [...theirs, ...newGames]) {
      if (newGames.includes(id) && !order.includes(id)) order.push(id);
    }
    // The game they were playing opens again, unless one is being played here.
    const theirActive = gameIdMap.get(manifests["game-manifest"]?.activeGameId);
    const activeGameId = here?.activeGameId || theirActive || "";
    await db.kvPut("game-manifest", { activeGameId, order });
  }
  if (manifests["ui-settings"] && (settingsWin || (await db.kvGet("ui-settings", null)) == null)) {
    await db.kvPut("ui-settings", manifests["ui-settings"]);
  }
  // The basemaps' and the Workshop documents' lists: what is here first, then
  // what arrived (the lists show every one anyway; these keep the order and the
  // basemaps' duplicate check).
  for (const key of ["basemaps-manifest", "mapeditor-manifest"]) {
    const theirs = manifests[key];
    if (!theirs || typeof theirs !== "object") continue;
    const here = (await db.kvGet(key, null)) ?? {};
    const order = [...new Set([...(Array.isArray(here.order) ? here.order : []), ...(Array.isArray(theirs.order) ? theirs.order : [])])];
    const merged = { ...theirs, ...here, version: here.version ?? theirs.version ?? 1, order };
    if (theirs.byHash || here.byHash) merged.byHash = { ...(theirs.byHash ?? {}), ...(here.byHash ?? {}) };
    await db.kvPut(key, merged);
  }
  // Interface text the player's AI translated for a language without a shipped
  // pack (settingsStore.js), each language's own row.
  for (const [key, value] of Object.entries(manifests)) {
    if (!key.startsWith("lang:") || !value || typeof value !== "object") continue;
    const here = (await db.kvGet(key, null)) ?? {};
    await db.kvPut(key, settingsWin ? { ...here, ...value } : { ...value, ...here });
  }

  // Settings and the AI key: only what this address does not have yet, or with
  // settingsWin every one of them.
  let settings = 0;
  for (const [key, value] of Object.entries(packed.settings)) {
    try {
      if (key === SAVE_MOVE_STATE_KEY || keep.includes(key) || typeof value !== "string") continue;
      if (!settingsWin && storage.getItem(key) !== null) continue;
      storage.setItem(key, value);
      settings += 1;
    } catch { /* full or closed: the games are what matter */ }
  }
  return { ...moved, settings, carried };
};

// --- The trip ------------------------------------------------------------------

const readState = (storage) => {
  try { return JSON.parse(storage.getItem(SAVE_MOVE_STATE_KEY) || "{}") || {}; } catch { return {}; }
};
const writeState = (storage, state) => {
  try { storage.setItem(SAVE_MOVE_STATE_KEY, JSON.stringify(state)); } catch { /* decided again next visit */ }
};

// Whether to try the trip now. "moved" and "none" are final; a failed or
// unanswered trip is tried again, a few times, hours apart.
export const shouldTryMove = (state, now) => {
  if (state.done) return false;
  if ((state.tries ?? 0) >= MAX_TRIES) return false;
  return !state.at || now - state.at >= RETRY_AFTER_MS;
};

const showNotice = (text) => {
  try {
    const note = document.createElement("div");
    note.setAttribute("role", "status");
    note.textContent = text;
    Object.assign(note.style, {
      position: "fixed", left: "50%", top: "1rem", transform: "translateX(-50%)", zIndex: "2147483000",
      maxWidth: "min(32rem, calc(100vw - 2rem))", padding: "0.75rem 1rem", borderRadius: "12px",
      background: "#1d1d20", color: "#f6f6f7", border: "1px solid rgba(240,240,242,0.29)",
      font: "400 0.9rem/1.45 system-ui, 'Segoe UI', sans-serif", boxShadow: "0 0.75rem 2rem rgba(0,0,0,0.5)",
    });
    note.addEventListener("click", () => note.remove());
    document.body.append(note);
    setTimeout(() => note.remove(), 15000);
  } catch { /* the games are there either way */ }
};

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// The service worker that keeps the posted file must be answering for this page
// before the browser leaves: without it the post would reach the web server.
const receiverReady = async (base) => {
  if (!("serviceWorker" in navigator) || typeof caches === "undefined") return false;
  await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  if (!(await within(navigator.serviceWorker.ready, SW_WAIT_MS))) return false;
  if (!navigator.serviceWorker.controller) {
    await within(new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })), SW_WAIT_MS);
  }
  if (!navigator.serviceWorker.controller) return false;
  const ping = await fetch(`${base}save-move/ping`, { cache: "no-store" });
  return ping.ok && (await ping.text()).startsWith("oh-save-move");
};

// The address the old library is under, or "" when there is no trip to make.
const senderAddress = async (base, storage) => {
  if (isLoopback(location.hostname)) {
    // Two ports of this machine stand in for the two addresses in tests.
    const from = storage.getItem("oh:save-move-test-from") || "";
    return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(from)
      ? `${from}/save-move/?back=${encodeURIComponent(base)}&to=${encodeURIComponent(location.origin)}`
      : "";
  }
  if (location.protocol !== "https:") return "";
  // Only when the site sends this same path back to http: that is what keeps a
  // browser that upgrades http by itself on the http address, and it is the
  // sign that the http address is being served at all.
  const probe = await fetch("/save-move/", { redirect: "manual", cache: "no-store" });
  if (probe.type !== "opaqueredirect") return "";
  return `http://${location.host}/save-move/?back=${encodeURIComponent(base)}`;
};

// Called before the library is first read. Resolves when the game should go on
// starting; when the browser is leaving for the http address it does not resolve.
export const bringHttpSavesAcross = async ({ base = import.meta.env.BASE_URL, db, storage = localStorage } = {}) => {
  try {
    const state = readState(storage);
    const params = new URLSearchParams(location.search);
    const answer = params.get("saves-moved");
    if (answer) {
      params.delete("saves-moved");
      const query = params.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    }

    // The file the http page posted, kept by the service worker.
    if (typeof caches !== "undefined" && (answer === "arrived" || await caches.has(CACHE_NAME))) {
      const cache = await caches.open(CACHE_NAME);
      const key = `${base}save-move/payload`;
      const kept = await cache.match(key);
      if (kept) {
        const moved = await mergePackedSaves(await openPackedSaves(await kept.blob()), db, storage);
        await cache.delete(key);
        await caches.delete(CACHE_NAME);
        writeState(storage, { done: "moved", at: Date.now(), ...moved });
        if (moved.games || moved.scenarios || moved.others) {
          showNotice(`Your saved games from before are back: ${count(moved.games, "game", "games")} and ${count(moved.scenarios, "scenario", "scenarios")} were brought across from the site's old address.`);
        }
        return;
      }
    }
    if (answer === "none") { writeState(storage, { done: "none", at: Date.now() }); return; }
    if (answer) { writeState(storage, { ...state, at: Date.now(), last: answer }); return; }

    if (!shouldTryMove(state, Date.now())) return;
    const address = await senderAddress(base, storage);
    if (!address) return;
    if (!(await receiverReady(base))) return;
    writeState(storage, { ...state, tries: (state.tries ?? 0) + 1, at: Date.now() });
    location.replace(address);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } catch (error) {
    console.warn("Saves from the site's old address were not brought across:", error);
  }
};
