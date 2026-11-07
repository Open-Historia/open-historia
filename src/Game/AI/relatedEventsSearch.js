/*! Open Historia — related past events: the index and the search © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The runtime side of Find related past events (relatedEvents.js says what it
// is for). Three jobs:
//
// - INDEX. Every event of the open game gets a vector, kept on this device
//   (runtime/eventVectorStore.js). Filled while the game is idle: when a game
//   is opened (so a game started before the setting gets all of its events
//   once), after each turn, and when the setting is turned on. Like every
//   piece of work outside a turn it waits for the simulation to be idle
//   (simulationStatus.js) before each batch, and stops when the player
//   switches games; the model runs in a worker, so the page never waits for it.
// - SEARCH for a skip (findRelatedForSkip): the turn's queries embedded and
//   ranked against the vectors. Given a short time and no more: a model that
//   is not loaded yet, or a device that is slow, leaves the skip as it was.
// - LOOKUP (similarEventsSearch): the similar_events function
//   (lookupTools.js), offered while the setting is on and the model has loaded
//   this session.

import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { contentHash } from "../../runtime/embeddingModels.js";
import { eventVectorStore } from "../../runtime/eventVectorStore.js";
import { loadRegionCatalog } from "../../runtime/assets.js";
import { getLibraryState } from "../../runtime/library.js";
import { hasEnteredGame, subscribeGameEntry } from "../../runtime/gameEntry.js";
import { normalizeWorldState, readEventsState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { rankFocusPowers } from "./promptContext.js";
import { isGenerating, isSimulationBusy } from "./simulationStatus.js";
import {
  SIMILAR_EVENTS_DEFAULT,
  SIMILAR_EVENTS_MAX,
  buildRelatedQueries,
  embeddableEvents,
  relatedScores,
  similarEventsAnswer,
} from "./relatedEvents.js";

// How long a skip gives the search, the model's load from the device included.
export const SKIP_SEARCH_TIMEOUT_MS = 1500;
// A lookup is a model round anyway: it may wait for a load.
export const LOOKUP_SEARCH_TIMEOUT_MS = 8000;
// Events a message to the worker: a fraction of a second of its time, so a skip
// that starts meanwhile waits behind at most that for its own search.
const INDEX_BATCH = 4;
const IDLE_POLL_MS = 3000;
const INDEX_DELAY_MS = 2500;

const defaultDeps = () => ({
  model: () => import("../../runtime/embeddingModel.js"),
  store: () => eventVectorStore(),
  busy: () => isSimulationBusy() || isGenerating(),
  // The open game's id and its events, from the library and the runtime
  // endpoints that follow it.
  campaign: () => String(getLibraryState()?.activeGameId ?? "").trim(),
  readEvents: () => readEventsState({ force: true }),
  // The powers the prompt lists in full (promptContext.js rankFocusPowers),
  // from the region catalog the skip loads anyway.
  focusPowers: async (bundle) => {
    const regions = await loadRegionCatalog().catch(() => []);
    const playerName = toCountryName(String(bundle?.game?.country ?? "").trim());
    return rankFocusPowers(regions, normalizeWorldState(bundle?.world), bundle, { playerName }).slice(0, 6);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
let deps = defaultDeps();
// Tests only.
export const setRelatedEventsDepsForTests = (overrides) => {
  deps = overrides ? { ...defaultDeps(), ...overrides } : defaultDeps();
  modelLoaded = false;
  indexing = null;
};

export const relatedEventsOn = () => getMapSetting(MAP_SETTING_KEYS.relatedEvents);

// The model answered once this session. The lookup is offered from then on
// (not only while the worker happens to be warm), so the skip's list of
// functions stays the same from one skip to the next.
let modelLoaded = false;
export const relatedEventsReady = () => relatedEventsOn() && modelLoaded;

const embed = async (texts) => {
  const vectors = await (await deps.model()).embedTexts(texts);
  modelLoaded = true;
  return vectors;
};

const TIMED_OUT = Symbol("timed out");
const within = async (promise, ms) => {
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Search.

// The ranked candidates for a skip ([{ id, score }], best first), or null:
// the setting off, nothing indexed yet, the model not ready within the time.
// Never throws.
export const findRelatedForSkip = async (bundle, { campaignId, timeoutMs = SKIP_SEARCH_TIMEOUT_MS } = {}) => {
  if (!relatedEventsOn() || !campaignId) return null;
  const started = Date.now();
  const search = (async () => {
    const focusPowers = await Promise.resolve().then(() => deps.focusPowers(bundle)).catch(() => []);
    const queries = buildRelatedQueries(bundle, { focusPowers });
    if (!queries.length) return null;
    const stored = await deps.store()?.readGame(campaignId);
    if (!stored?.size) return null;
    return relatedScores(await embed(queries), stored);
  })().catch((error) => {
    logDebugEvent("ai-call", `Related past events: the search failed (${error?.message || "unknown"}); the skip goes without them.`);
    return null;
  });
  const result = await within(search, timeoutMs);
  if (result === TIMED_OUT) {
    logDebugEvent("ai-call", `Related past events: not ready within ${timeoutMs} ms; the skip goes without them.`);
    return null;
  }
  if (result?.length) logDebugEvent("ai-call", `Related past events: ${result.length} candidate(s) in ${Date.now() - started} ms.`, null, { verbose: true });
  return result;
};

// The similar_events lookup for the open game: a function of the model's
// arguments, or null when it is not offered.
export const similarEventsSearch = (bundle, { campaignId } = {}) => {
  if (!relatedEventsReady() || !campaignId) return null;
  return async (args = {}) => {
    const query = String(args?.query ?? "").trim();
    if (!query) return { error: "Say what to look for: query is required." };
    const limit = Math.min(SIMILAR_EVENTS_MAX, Math.max(1, Math.floor(Number(args?.limit) || SIMILAR_EVENTS_DEFAULT)));
    const result = await within((async () => {
      const stored = await deps.store()?.readGame(campaignId);
      if (!stored?.size) return null;
      return relatedScores(await embed([query.slice(0, 1000)]), stored, { limit });
    })().catch(() => null), LOOKUP_SEARCH_TIMEOUT_MS);
    if (result === TIMED_OUT || result === null) return { events: [], note: "The search on this device is not available right now; use recent_events." };
    return similarEventsAnswer(result, bundle?.events, { limit });
  };
};

// ---------------------------------------------------------------------------
// Index.

let indexing = null;
let again = false;

const waitForIdle = async () => {
  while (deps.busy()) await deps.sleep(IDLE_POLL_MS);
};

// Brings the open game's vectors up to date: new and changed events embedded,
// those of deleted events dropped. Resolves when done, stopped or failed.
export const indexOpenGame = () => {
  if (indexing) {
    again = true;
    return indexing;
  }
  indexing = (async () => {
    do {
      again = false;
      if (!relatedEventsOn()) return;
      await waitForIdle();
      const campaignId = await deps.campaign();
      const store = deps.store();
      if (!campaignId || !store) return;
      const events = await deps.readEvents();
      if ((await deps.campaign()) !== campaignId) {
        again = true;
        continue;
      }
      const wanted = embeddableEvents(events).map((entry) => ({ ...entry, hash: contentHash(entry.text) }));
      const ids = new Set(wanted.map((entry) => entry.id));
      const have = await store.readGame(campaignId);
      const gone = [...have.keys()].filter((id) => !ids.has(id));
      if (gone.length) await store.remove(campaignId, gone);
      const todo = wanted.filter((entry) => have.get(entry.id)?.hash !== entry.hash);
      if (!todo.length) continue;
      const started = Date.now();
      let done = 0;
      for (let at = 0; at < todo.length; at += INDEX_BATCH) {
        await waitForIdle();
        // The player left this game, or turned the setting off: stop; the
        // next opening or turn picks up where this left off.
        if (!relatedEventsOn() || (await deps.campaign()) !== campaignId) break;
        const batch = todo.slice(at, at + INDEX_BATCH);
        const vectors = await embed(batch.map((entry) => entry.text));
        await store.write(campaignId, batch.map((entry, index) => ({ eventId: entry.id, hash: entry.hash, vector: vectors[index] })));
        done += batch.length;
      }
      logDebugEvent("ai-call", `Related past events: ${done} event(s) indexed on this device in ${Date.now() - started} ms.`, { indexed: done, waiting: todo.length - done });
    } while (again);
  })()
    .catch((error) => {
      logDebugEvent("ai-call", `Related past events: indexing stopped (${error?.message || "unknown"}); the next turn tries again.`);
    })
    .finally(() => {
      indexing = null;
    });
  return indexing;
};

let scheduled = null;
// After a moment, so a turn's own follow-up writes land first.
export const scheduleRelatedIndexing = ({ delayMs = INDEX_DELAY_MS } = {}) => {
  if (!relatedEventsOn() || scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    void indexOpenGame();
  }, delayMs);
};

// Wired once, by gameplay.js: the turns, the game being opened or switched,
// and the setting turned on.
let installed = false;
export const installRelatedEventsIndexer = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const kick = () => {
    if (hasEnteredGame()) scheduleRelatedIndexing();
  };
  window.addEventListener("oh:turn-complete", kick);
  window.addEventListener("oh:active-game-changed", kick);
  window.addEventListener("mapSettings:updated", kick);
  subscribeGameEntry(kick);
  kick();
};
