/**
 * Open Historia — scenario import counter (Cloudflare Worker).
 *
 * "lets find a way so people cant manually download scenarios from the workshop
 * in github to inflate import counts" (the owner, 2026-11-09).
 *
 * From 2026-10-05 a scenario's import count was how many times its file had
 * been downloaded from the community hub's releases, as GitHub counts it, and
 * anyone could raise it by downloading that address again and again. Now a
 * download counts nothing. The game reports a post's FIRST import on an
 * install here (src/runtime/hubImportCount.js), and this Worker keeps the
 * counts, in D1:
 *
 *   POST /import  { post, token }  -> { post, counted, reason? }
 *   GET  /counts                   -> { "<post number>": { count }, ... }
 *   GET  /count/<post>             -> { id, count }
 *   POST /hit                      -> { id, count, retired: true }  (the oldest
 *                                     builds; accepted, never counted)
 *
 * An import is counted only when all of these hold:
 *   - it comes from one of the game's own pages (the Origin header: the
 *     website, the desktop app on localhost, the Android app), so another
 *     website cannot make its visitors' browsers count for it;
 *   - the post is a scenario the hub has released (its index.json);
 *   - this token has not counted this post before. The token is a hash of the
 *     install's own random key and the post's number, so an install counts a
 *     post once, and its tokens for two posts cannot be matched;
 *   - this internet address has not counted this post today (UTC), and has
 *     counted fewer than MAX_POSTS_PER_ADDRESS_PER_DAY posts today. An IPv6
 *     address is taken as its whole /64 (addressBucket), the block one home or
 *     phone is given. The address is kept only as an HMAC of it and the day
 *     under the COUNT_KEY secret, so yesterday's rows cannot be matched with
 *     today's, and the cron trigger deletes them the next day. The address's
 *     row is taken before anything else, by one statement, so requests sent
 *     together cannot all pass it;
 *   - the LIMITER binding (Cloudflare's rate limiting, keyed by address and kept
 *     by Cloudflare in memory only) lets it through.
 * Fresh tokens are free to make, so it is the address rules that bound what one
 * person can add: one count per post per address per day.
 *
 * What a post had before this counter (the hub index's `imports`: the
 * downloads, with the first counter's numbers added in) is frozen once, the
 * first time this Worker runs with its database, as the post's `legacy`
 * count; the count shown is legacy + counted. Downloads after that are never
 * read again.
 *
 * What it costs, for Cloudflare's free plan ("optimize it to use as little
 * resources and bandwith and everything as possible so my cloudflare freeplan
 * can keep up", the owner, 2026-11-09):
 *   - every read (/counts, /count/<post>, /hit) is the one /counts answer, kept
 *     five minutes in the isolate (and ten minutes by the browser): D1 is read
 *     at most once per five minutes per isolate, never per player. The Cache
 *     API does nothing on workers.dev, where this Worker is; on a custom domain
 *     the answer would be kept an hour at the edge as well;
 *   - the hub's index is kept in the isolate as the set of released scenario
 *     posts, an hour at a time; a post it does not know reads it again, past
 *     every cache, at most every five minutes, so a scenario released this
 *     minute still counts (and the game asks once more a while later);
 *   - an import is three statements, three rows written: the address's row
 *     (which reads at most that address's rows of the day), the token, the
 *     count. A refusal by address writes nothing; a repeated token gives its
 *     address's row back;
 *   - the tables are made at deploy (README), so a fresh isolate reads one row
 *     (the legacy marker) and nothing more.
 *
 * When the free plan runs out ("make sure the import counter worker falls back
 * to the old method if my usage runs out", the owner, 2026-11-09):
 *   - D1's day used up (5M rows read, 100k written) or D1 failing: the reads
 *     answer the hub index's `imports`, the old method, kept at the edge only
 *     FALLBACK_TTL_SECONDS so D1 is tried again soon; an import answers 503
 *     { counted: false, reason: "over limit" }. The legacy counts are never
 *     frozen again from such an error (ensureReady, and the freeze's own SQL);
 *   - the Workers day used up (100k requests): Cloudflare answers for this
 *     Worker with an error page and it never runs, so the game falls back to
 *     the index itself (src/runtime/hubImportCount.js fetchImportCounts).
 *
 * Bindings (wrangler.toml): DB (D1), COUNT_KEY (a secret: `wrangler secret put
 * COUNT_KEY`), LIMITER (rate limiting; optional). Without DB it answers the
 * counts from the hub's index as the retired Worker did and counts nothing;
 * without COUNT_KEY it counts nothing.
 */

export const HUB_INDEX_URL =
  "https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/hub-index/index.json";
// How long the released posts are kept, and how soon a post they do not know may read the index again.
const INDEX_TTL_SECONDS = 3600;
const INDEX_RETRY_MS = 5 * 60 * 1000;
// How long the edge keeps the answer to /counts, and the browser.
export const COUNTS_TTL_SECONDS = 3600;
const COUNTS_BROWSER_SECONDS = 600;
// How long an isolate keeps the counts it read from D1 (on workers.dev, where the edge keeps nothing, the only copy).
export const COUNTS_MEMORY_SECONDS = 300;
// How long the index's answer is kept, at the edge and by the browser, when D1 could not be read: then D1 is tried again.
export const FALLBACK_TTL_SECONDS = 300;
const SOURCE_HEADER = "X-Counts-Source";
// How many different posts one address can count in a UTC day.
export const MAX_POSTS_PER_ADDRESS_PER_DAY = 20;
const DAY_MS = 86_400_000;
const MAX_BODY_BYTES = 2048;

// The game's own pages: the website (and the Pages previews of it), the
// Android app (capacitor.config.json: http://app.openhistoria) and the desktop
// app, which is served from http://localhost:<port>.
const GAME_ORIGIN =
  /^(?:https:\/\/(?:www\.)?openhistoria\.com|https:\/\/(?:[a-z0-9-]+\.)?open-historia\.pages\.dev|http:\/\/app\.openhistoria|https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?)$/i;

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS counts (post INTEGER PRIMARY KEY, legacy INTEGER NOT NULL DEFAULT 0, counted INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS installs (post INTEGER NOT NULL, token TEXT NOT NULL, PRIMARY KEY (post, token)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS addresses (day INTEGER NOT NULL, who TEXT NOT NULL, post INTEGER NOT NULL, PRIMARY KEY (day, who, post)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

const READ_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

// Reads are public; /import answers only the game's own pages.
const corsFor = (request, path) => {
  if (path !== "/import") return READ_CORS;
  const origin = request.headers.get("Origin") || "";
  return GAME_ORIGIN.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
    : { Vary: "Origin" };
};

const json = (obj, status, cors, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors, ...headers } });

const postNumber = (value) => {
  const number = typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 && number < 1e9 ? number : null;
};

// The hub's index, kept at the edge; null when it cannot be read. `fresh` skips every copy on the way: the edge's
// (Cache API), Cloudflare's copy of the fetch (cacheTtl 0) and, by an address of its own, GitHub's (raw files are
// kept five minutes there), so a scenario released since the last read is seen.
const readIndex = async (ctx, { fresh = false } = {}) => {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(HUB_INDEX_URL);
  let response = cache && !fresh ? await cache.match(cacheKey) : null;
  if (!response) {
    const upstream = await fetch(fresh ? `${HUB_INDEX_URL}?fresh=${Date.now()}` : HUB_INDEX_URL, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: fresh ? 0 : INDEX_TTL_SECONDS },
    });
    if (!upstream.ok) return null;
    response = new Response(await upstream.text(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${INDEX_TTL_SECONDS}` },
    });
    if (cache) ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
  }
  const index = await response.json().catch(() => null);
  return index && typeof index === "object" ? index : null;
};

// { "<post>": count } of the index's `imports` (downloads): whole, non-negative.
const indexImports = (index) => {
  const out = {};
  const imports = index && typeof index.imports === "object" && index.imports ? index.imports : {};
  for (const [post, count] of Object.entries(imports)) {
    const number = Number(count);
    if (postNumber(post) && Number.isSafeInteger(number) && number >= 0) out[post] = number;
  }
  return out;
};

// Whether the index lists `post` as a released scenario post.
const releasedScenario = (index, post) =>
  Array.isArray(index?.posts) &&
  index.posts.some((entry) =>
    entry?.number === post &&
    (entry.kind === "scenario" || (Array.isArray(entry.labels) && entry.labels.some((label) => (label?.name ?? label) === "scenario"))));

// The released scenario posts, kept in the isolate per database: { posts: Set, at, tried }. A post it does not know
// reads the index again, at most every INDEX_RETRY_MS, so a scenario released since is counted.
const releasedBy = new WeakMap();
const isReleasedScenario = async (env, ctx, post) => {
  const holder = env.DB ?? env;
  let released = releasedBy.get(holder) ?? { posts: null, at: 0, tried: 0 };
  const now = Date.now();
  const stale = !released.posts || now - released.at > INDEX_TTL_SECONDS * 1000;
  const unknown = released.posts && !released.posts.has(post) && now - released.tried > INDEX_RETRY_MS;
  if (stale || unknown) {
    released = { ...released, tried: now };
    // (Marked tried before the read, so unknown posts reported meanwhile do not read it again too.)
    releasedBy.set(holder, released);
    const index = await readIndex(ctx, { fresh: unknown && !stale });
    if (index) {
      const posts = new Set();
      for (const entry of Array.isArray(index.posts) ? index.posts : []) {
        if (releasedScenario({ posts: [entry] }, entry?.number)) posts.add(entry.number);
      }
      released = { posts, at: now, tried: now };
    }
    releasedBy.set(holder, released);
  }
  return released.posts ? released.posts.has(post) : null;
};

// The tables, made once per database per isolate, and the legacy counts frozen
// once per database for good. Rejects (and is tried again next time) when the
// index cannot be read for the freeze (an error marked `hubUnreadable`), or
// when D1 fails (its day used up, or down).
const ready = new WeakMap();
const ensureReady = (env, ctx) => {
  if (!ready.has(env.DB)) {
    const pending = (async () => {
      // Made at deploy (README); made here only when they are not there yet. Any other error (D1 over its day's
      // limits, or down) is no answer at all: never taken for "not frozen yet", which would freeze them again.
      const frozen = await env.DB.prepare("SELECT value FROM meta WHERE key = 'legacy'").first().catch(async (error) => {
        if (!/no such table/i.test(String(error?.message ?? error))) throw error;
        await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
        return null;
      });
      if (frozen) return;
      const index = await readIndex(ctx);
      if (!index) throw Object.assign(new Error("the hub's index could not be read to freeze the old counts"), { hubUnreadable: true });
      const legacy = indexImports(index);
      await env.DB.batch([
        // (Only while no freeze is recorded: a second one, whatever led to it, changes nothing.)
        env.DB.prepare(
          "INSERT INTO counts (post, legacy) SELECT CAST(key AS INTEGER), value FROM json_each(?1) " +
          "WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'legacy') " +
          "ON CONFLICT(post) DO UPDATE SET legacy = excluded.legacy",
        ).bind(JSON.stringify(legacy)),
        env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('legacy', ?1)")
          .bind(JSON.stringify({ frozenAt: new Date().toISOString(), indexGeneratedAt: index.generatedAt ?? null, posts: Object.keys(legacy).length })),
      ]);
    })();
    ready.set(env.DB, pending);
    pending.catch(() => ready.delete(env.DB));
  }
  return ready.get(env.DB);
};

// An IPv6 address as its eight 16-bit groups, or null when it is none.
const ipv6Groups = (text) => {
  let body = text;
  let tail = [];
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(body);
  if (dotted) {
    const bytes = dotted.slice(2).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    tail = [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
    body = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = body.split("::");
  if (halves.length > 2) return null;
  const groups = (part) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const width = 8 - tail.length;
  if (![...head, ...rest].every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  if (halves.length === 2 ? head.length + rest.length >= width : head.length !== width) return null;
  const zeros = Array(width - head.length - rest.length).fill("0");
  return [...head, ...zeros, ...rest].map((group) => parseInt(group, 16)).concat(tail);
};

// What the address rules (the day's posts, the cap, the rate limiter) are kept by. An IPv4 address is itself. An
// IPv6 address is its /64: a home or a phone is given a whole /64, so each of its 2^64 addresses is the same player
// (one person rotating through them counted 25 times in 25 reports). An IPv4 address written as IPv6
// (::ffff:a.b.c.d) is that IPv4 address. Anything else is kept as it came; it is only ever hashed.
export const addressBucket = (address) => {
  const text = String(address ?? "").trim().toLowerCase().replace(/%.*$/, "");
  if (!text.includes(":")) return text;
  const groups = ipv6Groups(text);
  if (!groups) return text;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
};

// The day's key for an address: HMAC-SHA256 under COUNT_KEY of the day and the
// address (addressBucket), 32 hex digits. The address itself is never stored.
const addressKey = async (secret, day, address) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}|${address}`));
  return [...new Uint8Array(mac)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

// { counts: { "<post>": count }, fallback }: D1's, or the hub index's `imports` (the old method, `fallback`) when D1
// fails. Throws only when neither can be read.
const readCounts = async (env, ctx) => {
  if (!env.DB) {
    // Not set up yet: the retired Worker's answer.
    const index = await readIndex(ctx).catch(() => null);
    return { counts: index ? indexImports(index) : {}, fallback: false };
  }
  try {
    await ensureReady(env, ctx);
    const { results } = await env.DB.prepare("SELECT post, legacy + counted AS count FROM counts").all();
    const out = {};
    for (const row of results ?? []) out[String(row.post)] = Number(row.count);
    return { counts: out, fallback: false };
  } catch (error) {
    const index = await readIndex(ctx).catch(() => null);
    if (!index) throw error;
    return { counts: indexImports(index), fallback: true };
  }
};

// The counts kept in the isolate, per database: { counts, fallback, at, pending }. The Cache API does nothing on a
// workers.dev address (Cloudflare: cache operations work only on a custom domain), which is where this Worker is
// (oh-import-counter.nichojkrol.workers.dev), so without this every /counts, /count/<post> and /hit read the whole
// counts table from D1. An isolate serves many requests, so each reads D1 at most once per COUNTS_MEMORY_SECONDS
// (and requests that find it out of date together share the one read).
const countsInMemory = new WeakMap();

// An import counted in this isolate goes into its copy at once, so its own answers never lag behind it. (A copy of
// the index's counts is dropped instead: D1 is answering again.)
const countedInMemory = (env, post) => {
  const holder = env.DB ?? env;
  const held = countsInMemory.get(holder);
  if (!held?.counts) return;
  if (held.fallback) {
    countsInMemory.delete(holder);
    return;
  }
  const key = String(post);
  held.counts = { ...held.counts, [key]: { count: (held.counts[key]?.count ?? 0) + 1 } };
};

// { counts: { "<post>": { count } }, fallback }, the one read every endpoint answers from: kept in the isolate
// COUNTS_MEMORY_SECONDS, and at the edge for COUNTS_TTL_SECONDS (on a custom domain only; harmless elsewhere), so D1
// is read at most once an hour per Cloudflare location there; the index's answer when D1 failed only
// FALLBACK_TTL_SECONDS, in either.
const cachedCounts = async (url, env, ctx) => {
  const holder = env.DB ?? env;
  const held = countsInMemory.get(holder);
  if (held?.counts && Date.now() - held.at < (held.fallback ? FALLBACK_TTL_SECONDS : COUNTS_MEMORY_SECONDS) * 1000) {
    return { counts: held.counts, fallback: held.fallback };
  }
  if (held?.pending) return held.pending;
  const pending = (async () => {
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(`${url.origin}/counts`);
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) {
      const kept = await cached.json().catch(() => null);
      if (kept && typeof kept === "object") return { counts: kept, fallback: cached.headers.get(SOURCE_HEADER) === "index" };
    }
    const { counts, fallback } = await readCounts(env, ctx);
    const out = {};
    for (const [post, count] of Object.entries(counts)) out[post] = { count };
    if (cache) {
      ctx?.waitUntil?.(cache.put(cacheKey, new Response(JSON.stringify(out), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${fallback ? FALLBACK_TTL_SECONDS : COUNTS_TTL_SECONDS}`,
          ...(fallback ? { [SOURCE_HEADER]: "index" } : {}),
        },
      })));
    }
    return { counts: out, fallback };
  })();
  countsInMemory.set(holder, { ...held, pending });
  try {
    const result = await pending;
    countsInMemory.set(holder, { counts: result.counts, fallback: result.fallback, at: Date.now(), pending: null });
    return result;
  } catch (error) {
    countsInMemory.set(holder, { ...held, pending: null });
    throw error;
  }
};

// What the browser may keep a read for.
const browserCache = (fallback) => ({ "Cache-Control": `public, max-age=${fallback ? FALLBACK_TTL_SECONDS : COUNTS_BROWSER_SECONDS}` });

const countImport = async (request, env, ctx, cors) => {
  const origin = request.headers.get("Origin") || "";
  if (!GAME_ORIGIN.test(origin)) return json({ counted: false, reason: "origin" }, 403, cors);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ counted: false, reason: "body" }, 413, cors);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const post = postNumber(body?.post);
  const token = typeof body?.token === "string" && /^[0-9a-f]{64}$/.test(body.token) ? body.token : null;
  if (!post || !token) return json({ counted: false, reason: "malformed" }, 400, cors);
  if (!env.DB || typeof env.COUNT_KEY !== "string" || env.COUNT_KEY.length < 16) {
    return json({ post, counted: false, reason: "not set up" }, 503, cors);
  }
  const address = addressBucket(request.headers.get("CF-Connecting-IP"));
  if (!address) return json({ post, counted: false, reason: "address" }, 400, cors);
  if (env.LIMITER && typeof env.LIMITER.limit === "function") {
    const { success } = await env.LIMITER.limit({ key: address });
    if (!success) return json({ post, counted: false, reason: "slow down" }, 429, cors, { "Retry-After": "60" });
  }
  const scenario = await isReleasedScenario(env, ctx, post);
  if (scenario === null) return json({ post, counted: false, reason: "hub unreadable" }, 503, cors);
  if (!scenario) return json({ post, counted: false, reason: "not a released scenario" }, 404, cors);
  // (The old counts are frozen the first time; until the index can be read for that, nothing is counted.)
  const readiness = await ensureReady(env, ctx).then(() => null, (error) => error);
  if (readiness) return json({ post, counted: false, reason: readiness.hubUnreadable ? "hub unreadable" : "over limit" }, 503, cors);

  const day = Math.floor(Date.now() / DAY_MS);
  const who = await addressKey(env.COUNT_KEY, day, address);
  try {
    // The address's row for the post is the gate, taken by one statement: it goes in only when the address has no
    // row for the post today and fewer than MAX_POSTS_PER_ADDRESS_PER_DAY rows in all. D1 runs one statement at a
    // time, so of a burst of requests from one address (each with a fresh token) exactly one gets past it; a read
    // first and an insert after let all of them through (10 of 10 in a parallel burst).
    const gate = await env.DB.prepare(
      "INSERT OR IGNORE INTO addresses (day, who, post) SELECT ?1, ?2, ?3 " +
      "WHERE (SELECT COUNT(*) FROM addresses WHERE day = ?1 AND who = ?2) < ?4",
    ).bind(day, who, post, MAX_POSTS_PER_ADDRESS_PER_DAY).run();
    if (!Number(gate?.meta?.changes)) {
      // Refused; which rule refused it is read only now, on this path.
      const same = await env.DB.prepare("SELECT 1 AS same FROM addresses WHERE day = ?1 AND who = ?2 AND post = ?3")
        .bind(day, who, post)
        .first()
        .catch(() => null);
      return json({ post, counted: false, reason: same ? "address" : "address limit" }, 200, cors);
    }

    // Then the token: its key is what makes one install's import count once,
    // however many of its requests arrive together, from however many addresses.
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO installs (post, token) VALUES (?1, ?2)").bind(post, token).run();
    if (!Number(inserted?.meta?.changes)) {
      // Counted before: the address's row just taken is given back, so a repeat uses up nothing of its day. (Only
      // ever fewer counts: a request it refused meanwhile is refused for good.)
      await env.DB.prepare("DELETE FROM addresses WHERE day = ?1 AND who = ?2 AND post = ?3").bind(day, who, post).run().catch(() => {});
      return json({ post, counted: false, reason: "again" }, 200, cors);
    }
    await env.DB.prepare("INSERT INTO counts (post, counted) VALUES (?1, 1) ON CONFLICT(post) DO UPDATE SET counted = counted + 1").bind(post).run();
  } catch {
    // D1's day used up (or D1 down): this import is not counted.
    return json({ post, counted: false, reason: "over limit" }, 503, cors);
  }
  countedInMemory(env, post);
  return json({ post, counted: true }, 200, cors);
};

export default {
  async fetch(request, env = {}, ctx) {
    const url = new URL(request.url);
    const cors = corsFor(request, url.pathname);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method === "POST" && url.pathname === "/import") return await countImport(request, env, ctx, cors);

      // The oldest builds (before 2026-10-05) still send this; it never counts.
      if (request.method === "POST" && url.pathname === "/hit") {
        const body = await request.json().catch(() => ({}));
        const id = String(body?.id ?? "").trim().slice(0, 120);
        if (!id) return json({ error: "missing id" }, 400, cors);
        const { counts } = await cachedCounts(url, env, ctx).catch(() => ({ counts: {} }));
        return json({ id, count: counts[id]?.count ?? 0, retired: true }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/counts") {
        const { counts, fallback } = await cachedCounts(url, env, ctx);
        return json(counts, 200, cors, browserCache(fallback));
      }

      if (request.method === "GET" && url.pathname.startsWith("/count/")) {
        const id = decodeURIComponent(url.pathname.slice("/count/".length));
        const { counts, fallback } = await cachedCounts(url, env, ctx);
        return json({ id, count: counts[id]?.count ?? 0 }, 200, cors, browserCache(fallback));
      }

      return json({ ok: true, usage: "POST /import (the game only) · GET /counts · GET /count/:id" }, 200, cors);
    } catch (error) {
      return json({ error: String((error && error.message) || error) }, 500, cors, { "Cache-Control": "no-store" });
    }
  },

  // Daily (wrangler.toml [triggers]): the address rows of days before yesterday go.
  async scheduled(_event, env, ctx) {
    if (!env?.DB) return;
    const work = (async () => {
      await env.DB.prepare("DELETE FROM addresses WHERE day < ?1").bind(Math.floor(Date.now() / DAY_MS) - 1).run();
    })();
    ctx?.waitUntil?.(work);
    await work;
  },
};
