/*! Open Historia — related past events: the index and the search © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The runtime side of related past events (relatedEvents.js says what it is
// for). Always on: the model ships with the game (runtime/embeddingModels.js).
// Three jobs:
//
// - INDEX. Every event of the open game gets a vector, kept on this device
//   (runtime/eventVectorStore.js). Filled while the game is idle: when a game
//   is opened (so a game played before this gets all of its events once) and
//   after each turn. Like every piece of work outside a turn it waits for the
//   simulation to be idle (simulationStatus.js) before each batch, and stops
//   when the player switches games; the model runs in a worker, so the page
//   never waits for it.
// - SEARCH for a skip (findRelatedForSkip): the turn's queries embedded and
//   ranked against the vectors. Given a short time and no more: a model that
//   is not loaded yet, or a device that is slow, leaves the skip as it was.
// - LOOKUP (similarEventsSearch): the similar_events function
//   (lookupTools.js), offered once the model has loaded this session.
//
// The same three for the older conversations kept on file (chatArchive.js):
// the archived chats' chunks indexed after the events (indexArchivedChats),
// found for a skip, a leader's reply or the advisor (findPastTalks), and the
// past_talks lookup (pastTalksSearch).

import { logDebugEvent } from "../../runtime/debugLog.js";
import { CHAT_CHUNK_MAX_TOKENS, OLD_EMBEDDING_MODEL_CACHE, contentHash } from "../../runtime/embeddingModels.js";
import { chatVectorStore, eventVectorStore } from "../../runtime/eventVectorStore.js";
import { clearOpenConversation, openConversationId } from "../../runtime/openConversation.js";
import { loadRegionCatalog } from "../../runtime/assets.js";
import { getLibraryState } from "../../runtime/library.js";
import { hasEnteredGame, subscribeGameEntry } from "../../runtime/gameEntry.js";
import { normalizeChats, normalizeWorldState, readChatsState, readEventsState, readGameData, readWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { rankFocusPowers, sortDiplomaticChatsByRecentActivity } from "./promptContext.js";
import {
  PAST_TALKS_CANDIDATES,
  PAST_TALKS_DEFAULT,
  PAST_TALKS_MAX,
  archivedChunkRows,
  buildPastTalksQueries,
  chatArchiveContext,
  partitionChats,
  pastTalksAnswer,
  unfoldedChats,
} from "./chatArchive.js";
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
// A chunk of an older conversation is about three events' reading.
const CHAT_INDEX_BATCH = 2;
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
  // The archived chats' store, and what eligibility reads: the chats, the
  // game's date and round, the world's skips, wars and peace offers.
  chatStore: () => chatVectorStore(),
  readChatBundle: async () => {
    const [chats, game, world] = await Promise.all([
      readChatsState({ force: true }),
      readGameData({ force: true }),
      readWorldState({ force: true }),
    ]);
    return { chats, game, world };
  },
  openChat: () => openConversationId(),
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

// The model answered once this session. The lookup is offered from then on
// (not only while the worker happens to be warm), so the skip's list of
// functions stays the same from one skip to the next.
let modelLoaded = false;
export const relatedEventsReady = () => modelLoaded;

const embed = async (texts, options) => {
  const vectors = await (await deps.model()).embedTexts(texts, options);
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
// nothing indexed yet, the model not ready within the time.
// Never throws.
export const findRelatedForSkip = async (bundle, { campaignId, timeoutMs = SKIP_SEARCH_TIMEOUT_MS } = {}) => {
  if (!campaignId) return null;
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
// Older conversations kept on file (chatArchive.js).

// The chats as a prompt splits them: { active, archived }, the active newest first.
const splitChats = (bundle, openChatId) => partitionChats(
  sortDiplomaticChatsByRecentActivity(unfoldedChats(normalizeChats(bundle?.chats), bundle?.world)),
  chatArchiveContext(bundle, { openChatId }),
);

// The archived chunks nearest to what a skip, a reply or an answer is about
// ([{ id: "chatId:chunk", score }], best first), or null: no chat archived,
// nothing indexed, the model not ready within the time. Never throws.
//   bundle      { game, world, chats, actions }: for a leader, the chats it was in
//   openChatId  the conversation on screen (never archived)
//   addressed   the leaders being addressed
//   about       the request's own words (the thread's last lines, a question)
//   focus       rank the powers in view into the query (a skip)
export const findPastTalks = async (bundle, {
  openChatId = deps.openChat(),
  addressed = [],
  about = [],
  focus = true,
  timeoutMs = SKIP_SEARCH_TIMEOUT_MS,
} = {}) => {
  const started = Date.now();
  const search = (async () => {
    const campaignId = await deps.campaign();
    if (!campaignId) return null;
    const { active, archived } = splitChats(bundle, openChatId);
    if (!archived.length) return null;
    const focusPowers = focus ? await Promise.resolve().then(() => deps.focusPowers(bundle)).catch(() => []) : [];
    const queries = buildPastTalksQueries(bundle, { focusPowers, activeChats: active, addressed, about });
    if (!queries.length) return null;
    const stored = await deps.chatStore()?.readGame(campaignId);
    if (!stored?.size) return null;
    const ids = new Set(archived.map((chat) => String(chat.id)));
    const vectors = new Map([...stored].filter(([, row]) => ids.has(String(row.chatId))));
    if (!vectors.size) return null;
    return relatedScores(await embed(queries), vectors, { limit: PAST_TALKS_CANDIDATES });
  })().catch((error) => {
    logDebugEvent("ai-call", `Older conversations: the search failed (${error?.message || "unknown"}); the prompt goes without excerpts.`);
    return null;
  });
  const result = await within(search, timeoutMs);
  if (result === TIMED_OUT) {
    logDebugEvent("ai-call", `Older conversations: not ready within ${timeoutMs} ms; the prompt goes without excerpts.`);
    return null;
  }
  if (result?.length) logDebugEvent("ai-call", `Older conversations: ${result.length} candidate chunk(s) in ${Date.now() - started} ms.`, null, { verbose: true });
  return result;
};

// The past_talks lookup for the open game: a function of the model's
// arguments, or null when it is not offered (the model not loaded this
// session, or no chat kept on file).
export const pastTalksSearch = (bundle, { campaignId, openChatId = deps.openChat() } = {}) => {
  if (!relatedEventsReady() || !campaignId) return null;
  const { archived } = splitChats(bundle, openChatId);
  if (!archived.length) return null;
  const player = String(bundle?.game?.country ?? "");
  return async (args = {}) => {
    const query = String(args?.query ?? "").trim();
    if (!query) return { error: "Say what to look for: query is required." };
    const limit = Math.min(PAST_TALKS_MAX, Math.max(1, Math.floor(Number(args?.limit) || PAST_TALKS_DEFAULT)));
    const ids = new Set(archived.map((chat) => String(chat.id)));
    const result = await within((async () => {
      const stored = await deps.chatStore()?.readGame(campaignId);
      const vectors = new Map([...(stored ?? [])].filter(([, row]) => ids.has(String(row.chatId))));
      if (!vectors.size) return null;
      return relatedScores(await embed([query.slice(0, 1000)]), vectors, { limit: PAST_TALKS_CANDIDATES });
    })().catch(() => null), LOOKUP_SEARCH_TIMEOUT_MS);
    if (result === TIMED_OUT || result === null) return { talks: [], note: "The search on this device is not available right now; use chat_history." };
    return pastTalksAnswer(result, archived, { player, limit, withPower: String(args?.with ?? "") });
  };
};

// ---------------------------------------------------------------------------
// Index.

let indexing = null;
let again = false;

const waitForIdle = async () => {
  while (deps.busy()) await deps.sleep(IDLE_POLL_MS);
};

const SWITCHED = Symbol("switched games");

// The open game's events: new and changed ones embedded, those of deleted
// events dropped. SWITCHED when the player opened another game meanwhile.
const indexEvents = async (campaignId) => {
  const store = deps.store();
  if (!store) return null;
  const events = await deps.readEvents();
  if ((await deps.campaign()) !== campaignId) return SWITCHED;
  const wanted = embeddableEvents(events).map((entry) => ({ ...entry, hash: contentHash(entry.text) }));
  const ids = new Set(wanted.map((entry) => entry.id));
  const have = await store.readGame(campaignId);
  const gone = [...have.keys()].filter((id) => !ids.has(id));
  if (gone.length) await store.remove(campaignId, gone);
  const todo = wanted.filter((entry) => have.get(entry.id)?.hash !== entry.hash);
  if (!todo.length) return null;
  const started = Date.now();
  let done = 0;
  for (let at = 0; at < todo.length; at += INDEX_BATCH) {
    await waitForIdle();
    // The player left this game: stop; the next opening or turn picks up
    // where this left off.
    if ((await deps.campaign()) !== campaignId) break;
    const batch = todo.slice(at, at + INDEX_BATCH);
    const vectors = await embed(batch.map((entry) => entry.text));
    await store.write(campaignId, batch.map((entry, index) => ({ eventId: entry.id, hash: entry.hash, vector: vectors[index] })));
    done += batch.length;
  }
  logDebugEvent("ai-call", `Related past events: ${done} event(s) indexed on this device in ${Date.now() - started} ms.`, { indexed: done, waiting: todo.length - done });
  return null;
};

// The chats kept on file (chatArchive.js), as eligibility stands now: each
// archived chat's chunks embedded (again when the chat changed), and the
// chunks of a chat no longer archived (used again, or deleted) dropped, so a
// chat that comes back into use leaves the archive by itself.
const indexArchivedChats = async (campaignId) => {
  const store = deps.chatStore();
  if (!store) return null;
  const bundle = await deps.readChatBundle();
  if ((await deps.campaign()) !== campaignId) return SWITCHED;
  const { archived } = partitionChats(
    unfoldedChats(normalizeChats(bundle?.chats), bundle?.world),
    chatArchiveContext(bundle, { openChatId: deps.openChat() }),
  );
  const wanted = archivedChunkRows(archived, { player: bundle?.game?.country });
  const keys = new Set(wanted.map((row) => row.key));
  const have = await store.readGame(campaignId);
  const gone = [...have.keys()].filter((key) => !keys.has(key));
  if (gone.length) await store.remove(campaignId, gone);
  const todo = wanted.filter((row) => have.get(row.key)?.hash !== row.hash);
  if (!todo.length) return null;
  const started = Date.now();
  let done = 0;
  for (let at = 0; at < todo.length; at += CHAT_INDEX_BATCH) {
    await waitForIdle();
    if ((await deps.campaign()) !== campaignId) return SWITCHED;
    const batch = todo.slice(at, at + CHAT_INDEX_BATCH);
    const vectors = await embed(batch.map((row) => row.text), { maxTokens: CHAT_CHUNK_MAX_TOKENS });
    await store.write(campaignId, batch.map((row, index) => ({ chatId: row.chatId, chunk: row.chunk, hash: row.hash, vector: vectors[index] })));
    done += batch.length;
  }
  logDebugEvent("ai-call", `Older conversations: ${done} chunk(s) of ${archived.length} chat(s) kept on file indexed on this device in ${Date.now() - started} ms.`, { indexed: done, waiting: todo.length - done });
  return null;
};

// Brings the open game's vectors up to date: its events', then its archived
// chats'. Resolves when done, stopped or failed.
export const indexOpenGame = () => {
  if (indexing) {
    again = true;
    return indexing;
  }
  indexing = (async () => {
    do {
      again = false;
      await waitForIdle();
      const campaignId = await deps.campaign();
      if (!campaignId) return;
      if (await indexEvents(campaignId) === SWITCHED) {
        again = true;
        continue;
      }
      if (await indexArchivedChats(campaignId) === SWITCHED) again = true;
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
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    void indexOpenGame();
  }, delayMs);
};

// Before 2026-11-07 the feature was a setting, off by default, and turning it
// on downloaded the model from Hugging Face into a store of its own. The model
// ships with the game now: the old setting's key goes, and with it the copy
// downloaded then (Cache Storage, or IndexedDB in the Android app; assets.js
// sweeps the former anyway). Only where the key is found, so once.
export const OLD_SETTING_KEY = "ai_related_events";
export const forgetOldDownload = async ({
  storage = globalThis.localStorage,
  deleteCache = async (name) => (await import("../../runtime/modelStore.js")).deleteModelCache(name),
} = {}) => {
  try {
    const stored = storage?.getItem?.(OLD_SETTING_KEY);
    if (stored === null || stored === undefined) return false;
    storage.removeItem(OLD_SETTING_KEY);
    await deleteCache(OLD_EMBEDDING_MODEL_CACHE);
    return true;
  } catch {
    return false;
  }
};

// Wired once, by gameplay.js: the turns, and the game being opened or switched.
let installed = false;
export const installRelatedEventsIndexer = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;
  void forgetOldDownload();
  const kick = () => {
    if (hasEnteredGame()) scheduleRelatedIndexing();
  };
  window.addEventListener("oh:turn-complete", kick);
  window.addEventListener("oh:active-game-changed", kick);
  // Another game's open thread means nothing in this one.
  window.addEventListener("oh:active-game-changed", clearOpenConversation);
  subscribeGameEntry(kick);
  kick();
};
