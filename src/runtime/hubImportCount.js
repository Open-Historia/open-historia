/*! Open Historia — counting a hub scenario's imports © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// "lets find a way so people cant manually download scenarios from the workshop
// in github to inflate import counts" (the owner, 2026-11-09).
//
// A scenario's import count used to be how many times its file had been
// downloaded from the hub's releases, as GitHub counts it. Anyone could raise
// it by downloading the file's address over and over, by hand or in a loop.
// Now downloads count nothing: the count is kept by our own counter
// (tools/import-counter/worker.js), and only the game adds to it, once, when a
// player imports a post for the first time (hubPosts.js downloadHubScenario).
//
// What the game sends for an import is the post's number and a token: a hash
// of this install's own random key (server/hubImported.js hubCountKey, never
// sent) and that number. The counter counts a post once per token, so an
// install counts each post once, and since every post's token is a different
// hash it cannot tell that two imports came from the same install. It also
// counts a post at most once a day from one internet address, and only so many
// posts a day from one address, and only a scenario the hub has released, sent
// from the game's own pages; see the Worker for all of it.
//
// The counts are read from the counter too (fetchImportCounts). The download
// counts the hub's index still carries are shown only when the counter cannot
// be read ("make sure the import counter worker falls back to the old method if
// my usage runs out", the owner, 2026-11-09): when the counter's free plan is
// used up for the day, Cloudflare answers for it with an error page.

import { HUB_COUNT_KEY, normalizeHubCountKey, normalizeHubImported } from "../../server/hubImported.js";
import { fetchHubIndex } from "./hubFiles.js";

export const IMPORT_COUNTER_URL = "https://oh-import-counter.nichojkrol.workers.dev";
// Kept 30 minutes, and between sessions (localStorage): the counter keeps them an hour anyway, and every read is a
// request on its free plan ("optimize it to use as little resources and bandwith ... as possible", the owner, 2026-11-09).
const CACHE_TTL_MS = 30 * 60 * 1000;
// How long the hub index's counts stand in for a counter that could not be read, before it is asked again.
const FALLBACK_TTL_MS = 5 * 60 * 1000;
const STORED_COUNTS_KEY = "oh-hub-import-counts";
const storedCounts = () => {
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(STORED_COUNTS_KEY) ?? "null");
    return kept && typeof kept.at === "number" && kept.counts && typeof kept.counts === "object" ? kept : null;
  } catch {
    return null;
  }
};
const storeCounts = (at, counts) => {
  try {
    globalThis.localStorage?.setItem(STORED_COUNTS_KEY, JSON.stringify({ at, counts }));
  } catch {
    // Not kept: read again next session.
  }
};
const TIMEOUT_MS = 15_000;
// The Community tab's list waits for the counts (hubPosts.js fetchHubPosts), so
// a counter that does not answer is given up on sooner.
const COUNTS_TIMEOUT_MS = 6_000;

// The counter's address: the build's own (VITE_OH_IMPORT_COUNTER_URL) or ours.
export const importCounterUrl = (env = import.meta.env ?? {}) =>
  String(env.VITE_OH_IMPORT_COUNTER_URL || IMPORT_COUNTER_URL).replace(/\/+$/, "");

const timeout = (ms = TIMEOUT_MS) => (typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ms) : undefined);

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// This install's counting key, made and stored the first time one is needed;
// null where the settings cannot be read or written, or there is no crypto.
// The store keeps the first key it was given (hubImported.js keepHubCountKey),
// so what it answers is the key to use.
export const installCountKey = async () => {
  try {
    const response = await fetch("/api/ui-settings");
    if (!response.ok) return null;
    const stored = normalizeHubCountKey((await response.json())?.[HUB_COUNT_KEY]);
    if (stored) return stored;
    if (typeof globalThis.crypto?.getRandomValues !== "function") return null;
    const fresh = hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const saved = await fetch("/api/ui-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [HUB_COUNT_KEY]: fresh }),
    });
    if (!saved.ok) return null;
    return normalizeHubCountKey((await saved.json())?.[HUB_COUNT_KEY]);
  } catch {
    return null;
  }
};

// The token an import of `postId` is counted under: SHA-256 of the install's
// key and the post's number, as 64 hex digits. null without WebCrypto.
export const importToken = async (key, postId) => {
  const post = normalizeHubImported([postId])[0];
  if (!normalizeHubCountKey(key) || !post || typeof globalThis.crypto?.subtle?.digest !== "function") return null;
  return hex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`open-historia-import/${key}/${post}`)));
};

// The counts the page has read (fetchImportCounts); `fallback` when they are the hub index's.
let cache = { at: 0, counts: null, pending: null, fallback: false };
const inflight = new Set();

// Tells the counter that this install has imported `postId` for the first
// time. Never throws and never holds the import up: a count that cannot be
// sent (offline, no settings, the counter down) is a count lost, never an
// error. Resolves to the counter's answer ({ counted, reason? }) or null.
export const countHubImport = (postId) => {
  const sending = (async () => {
    try {
      const post = normalizeHubImported([postId])[0];
      if (!post) return null;
      const token = await importToken(await installCountKey(), post);
      if (!token) return null;
      const response = await fetch(`${importCounterUrl()}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post, token }),
        signal: timeout(),
      });
      const answer = await response.json().catch(() => null);
      // The next read of the counts asks the counter again.
      if (answer?.counted) cache = { ...cache, at: 0 };
      return answer && typeof answer === "object" ? answer : null;
    } catch {
      return null;
    }
  })();
  inflight.add(sending);
  sending.finally(() => inflight.delete(sending));
  return sending;
};

// For tests: resolves once every count sent so far has had its answer; and
// forgets the counts read.
export const hubImportCountsSettled = () => Promise.all([...inflight]);
export const resetImportCountsCache = () => {
  cache = { at: 0, counts: null, pending: null, fallback: false };
};

// The old method: the hub index's `imports` (its files' downloads, summed by the
// hub), or null when the index could not be read either. The Community tab reads
// the index at the same time (hubPosts.js fetchHubPosts), so this is the same
// request, not another.
const indexImportCounts = async () => {
  const index = await fetchHubIndex().catch(() => null);
  return index && !index.unread && index.imports && typeof index.imports === "object" ? index.imports : null;
};

// { "<post number>": count } as the counter keeps them, or null when they
// could not be read (the Community tab then shows no counts, as it did when the
// old counter was down). The counter answers { "<post>": { count } }, the shape
// the oldest builds read; a bare number is read too. Kept 30 minutes, one
// request shared between callers. When the counter cannot be read (an error
// page, not JSON, no answer in time, offline) the last good read stays while it
// is under 30 minutes old; past that the hub index's counts stand in, kept in
// memory only and FALLBACK_TTL_MS, until the counter answers again.
export const fetchImportCounts = async ({ force = false } = {}) => {
  if (!force && !cache.counts) {
    const kept = storedCounts();
    if (kept) cache = { ...cache, at: kept.at, counts: kept.counts, fallback: false };
  }
  const ttl = cache.fallback ? FALLBACK_TTL_MS : CACHE_TTL_MS;
  if (!force && cache.counts && Date.now() - cache.at < ttl) return cache.counts;
  if (cache.pending) return cache.pending;
  const pending = (async () => {
    try {
      // (The browser's own copy is fine but for a Refresh: the counter keeps them an hour anyway.)
      const response = await fetch(`${importCounterUrl()}/counts`, { cache: force ? "no-cache" : "default", signal: timeout(COUNTS_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not the counts");
      const counts = {};
      for (const [post, entry] of Object.entries(raw)) {
        const count = typeof entry === "number" ? entry : entry?.count;
        if (/^\d{1,15}$/.test(post) && Number.isSafeInteger(count) && count >= 0) counts[post] = count;
      }
      cache = { at: Date.now(), counts, pending: null, fallback: false };
      storeCounts(cache.at, counts);
      return counts;
    } catch {
      const good = cache.counts && !cache.fallback && Date.now() - cache.at < CACHE_TTL_MS;
      if (!good) {
        const imports = await indexImportCounts();
        if (imports) {
          cache = { at: Date.now(), counts: imports, pending: null, fallback: true };
          return imports;
        }
      }
      cache = { ...cache, pending: null };
      return cache.counts;
    }
  })();
  cache = { ...cache, pending };
  return pending;
};

// A post's count in what fetchImportCounts read, or null when it has none.
export const importCountIn = (counts, postId) => {
  const count = counts && typeof counts === "object" && Object.hasOwn(counts, String(postId)) ? counts[String(postId)] : null;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};
