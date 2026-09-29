import { JSON_URLS } from "./assets.js";
import {
  normalizeActions,
  normalizeChats,
  normalizeEvents,
  normalizeGameData,
  normalizeWorldState,
  readActionsState,
  readChatsState,
  readEventsState,
  readGameData,
  readInterceptsState,
  readWorldState,
} from "./gameState.js";

// One store for every runtime document, one notification per slice.
//
// Ten HUD panels each ran their own 5s `force: true` interval over the same few
// documents, and every tick woke every consumer of the document it read. Here
// updates are event-driven: a canonical write in this tab is applied straight
// from the object writeJson holds, a write in another tab arrives over a
// BroadcastChannel, and a subscriber hears only its own selector's output.
//
// The timer below is a backstop, not the update path. It exists for a writer no
// event can reach, which after the channel means a save edited on disk while the
// app runs. Note that `countryStats`/`countryStatsHistory` are patched out of
// band by the stats worker (primeCountryStatsWorkerCommit) and so only become
// current here on a backstop read; read them through readCountryStatsBundle.
export const RUNTIME_BACKSTOP_MS = 60000;

const normalizeIntercepts = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const SOURCES = {
  game: { read: readGameData, normalize: normalizeGameData, empty: null },
  world: { read: readWorldState, normalize: normalizeWorldState, empty: null },
  events: { read: readEventsState, normalize: normalizeEvents, empty: [] },
  actions: { read: readActionsState, normalize: normalizeActions, empty: [] },
  chat: { read: readChatsState, normalize: normalizeChats, empty: [] },
  intercepts: { read: readInterceptsState, normalize: normalizeIntercepts, empty: {} },
};

export const RUNTIME_KEYS = Object.freeze(Object.keys(SOURCES));

const IDENTITY = Symbol("identity");
const MISSING = Symbol("missing");

const entries = new Map(
  RUNTIME_KEYS.map((key) => [key, {
    value: SOURCES[key].empty,
    loaded: false,
    stale: false,
    canonicalAt: 0,
    pending: null,
    subscribers: new Set(),
  }]),
);

export const deepEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqual(a[index], b[index])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
};

// The newest turn published, so a background read cannot revert a fresh jump.
let gameStamp = { round: 0, date: "" };

export const runtimeGameStamp = (game) => ({
  round: Number(game?.round) || 0,
  date: game?.gameDate || "",
});

// Behind the published round/date means the clock would go backwards.
export const isStaleGameRead = (game, stamp) => {
  const { round, date } = runtimeGameStamp(game);
  return round < stamp.round || (round === stamp.round && date < stamp.date);
};

const notifyOne = (sub, value) => {
  if (sub.select === IDENTITY) {
    if (Object.is(sub.slice, value)) return;
    sub.slice = value;
    sub.notify(value);
    return;
  }
  let slice;
  try {
    slice = sub.select(value);
  } catch {
    return;
  }
  if (sub.slice !== MISSING && deepEqual(sub.slice, slice)) return;
  sub.slice = slice;
  sub.notify(slice);
};

const applyValue = (key, raw, { normalize = true } = {}) => {
  const entry = entries.get(key);
  if (!entry) return false;
  const next = normalize ? SOURCES[key].normalize(raw) : raw;
  entry.stale = false;
  if (key === "game") gameStamp = runtimeGameStamp(next);
  if (entry.loaded && deepEqual(entry.value, next)) return false;
  entry.value = next;
  entry.loaded = true;
  for (const sub of [...entry.subscribers]) notifyOne(sub, next);
  return true;
};

const readOne = (key, force) => {
  const entry = entries.get(key);
  if (entry.pending) return entry.pending;
  entry.pending = SOURCES[key].read({ force })
    .then((value) => ({ key, value }), () => null)
    .finally(() => { entry.pending = null; });
  return entry.pending;
};

const refreshKeys = (keys, { force = true } = {}) => {
  const wanted = keys.filter((key) => entries.has(key));
  if (!wanted.length) return Promise.resolve();
  return Promise.all(wanted.map((key) => readOne(key, force))).then((results) => {
    // The whole batch goes, not just the game: world and events belong to that
    // same stale turn.
    const game = results.find((result) => result?.key === "game");
    if (game && isStaleGameRead(game.value, gameStamp)) return;
    for (const result of results) {
      if (result) applyValue(result.key, result.value, { normalize: false });
    }
  });
};

const activeKeys = () => RUNTIME_KEYS.filter((key) => entries.get(key).subscribers.size > 0);

const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

let timer = null;
let tickInFlight = null;

const tick = () => {
  if (tickInFlight || !isVisible()) return;
  const now = Date.now();
  const active = activeKeys();
  // A document a write already delivered does not need fetching back.
  const due = active.filter((key) => entries.get(key).stale
    || now - entries.get(key).canonicalAt >= RUNTIME_BACKSTOP_MS);
  if (!due.length) return;
  // The guard reads the round off game.json, so game rides along with any batch.
  if (!due.includes("game") && active.includes("game")) due.push("game");
  tickInFlight = refreshKeys(due).finally(() => { tickInFlight = null; });
};

const syncTimer = () => {
  const shouldRun = isVisible() && activeKeys().length > 0;
  if (shouldRun && !timer) {
    timer = setInterval(tick, RUNTIME_BACKSTOP_MS);
    timer?.unref?.(); // node (tests, SSR) must not be held open by the cadence
  } else if (!shouldRun && timer) {
    clearInterval(timer);
    timer = null;
  }
};

const keyForUrl = (url) => (url ? RUNTIME_KEYS.find((key) => JSON_URLS[key] === url) : undefined);

// Other tabs of this origin share one save, and their writes raise no event
// here. Only the key travels: posting the value would structured-clone a
// multi-megabyte world into every listening tab on every write.
const CHANNEL_NAME = "oh:runtime-json";
let channel = null;

const openChannel = () => {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const key = event?.data?.key;
    if (!entries.has(key)) return;
    // Marked before the read so a tab that cannot act now (hidden, or nothing
    // subscribed to this document yet) still refuses to serve what it holds.
    entries.get(key).stale = true;
    if (isVisible() && activeKeys().includes(key)) void refreshKeys([key]);
  };
};

// Authoritative on arrival: take the object writeJson holds, skip the fetch.
const onRuntimeJsonUpdated = (event) => {
  const key = keyForUrl(event?.detail?.url);
  if (!key) return;
  entries.get(key).canonicalAt = Date.now();
  applyValue(key, event.detail.value);
  // BroadcastChannel never echoes to its own sender, so this cannot loop.
  channel?.postMessage({ key });
};

// The one write that legitimately moves the clock backwards.
const onRolledBack = () => {
  gameStamp = { round: 0, date: "" };
  void refreshKeys(activeKeys());
};

const onActiveGameChanged = () => {
  gameStamp = { round: 0, date: "" };
  for (const [key, entry] of entries) {
    entry.value = SOURCES[key].empty;
    entry.loaded = false;
    entry.stale = false;
    entry.canonicalAt = 0;
  }
  void refreshKeys(activeKeys());
};

const onVisibilityChange = () => {
  syncTimer();
  if (isVisible()) void refreshKeys(activeKeys());
};

let listenersInstalled = false;

const installListeners = () => {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  openChannel();
  window.addEventListener("oh:runtime-json-updated", onRuntimeJsonUpdated);
  window.addEventListener("oh:rolled-back", onRolledBack);
  window.addEventListener("oh:active-game-changed", onActiveGameChanged);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
};

const getRuntimeValue = (key) => (entries.has(key) ? entries.get(key).value : undefined);

export const getRuntimeSlice = (key, select) => {
  const value = getRuntimeValue(key);
  return typeof select === "function" ? select(value) : value;
};

// `seed` is the slice the caller last rendered, so a change landing between that
// render and this subscription is not swallowed.
export const subscribeRuntime = (key, notify, { select, seed = MISSING } = {}) => {
  const entry = entries.get(key);
  if (!entry) return () => {};
  installListeners();

  const sub = {
    notify,
    select: typeof select === "function" ? select : IDENTITY,
    slice: seed,
  };
  entry.subscribers.add(sub);
  syncTimer();

  if (entry.loaded && !entry.stale) {
    notifyOne(sub, entry.value);
  } else {
    void refreshKeys([key]);
  }

  return () => {
    entry.subscribers.delete(sub);
    syncTimer();
  };
};

// State the caller already holds (a finished turn, a restored snapshot).
export const primeRuntimeValue = (key, value) => {
  if (!entries.has(key)) return;
  entries.get(key).canonicalAt = Date.now();
  applyValue(key, value);
};

export const refreshRuntimeState = (keys = activeKeys(), options) =>
  refreshKeys(Array.isArray(keys) ? keys : [keys], options);

export const __resetRuntimeStoreForTests = () => {
  for (const [key, entry] of entries) {
    entry.value = SOURCES[key].empty;
    entry.loaded = false;
    entry.stale = false;
    entry.canonicalAt = 0;
    entry.pending = null;
    entry.subscribers.clear();
  }
  gameStamp = { round: 0, date: "" };
  tickInFlight = null;
  syncTimer();
};
