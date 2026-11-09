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
 *     counted fewer than MAX_POSTS_PER_ADDRESS_PER_DAY posts today. The address
 *     is kept only as an HMAC of it and the day under the COUNT_KEY secret, so
 *     yesterday's rows cannot be matched with today's, and the cron trigger
 *     deletes them the next day;
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
 *     an hour at the edge (and ten minutes by the browser): D1 is read at most
 *     once an hour per Cloudflare location, never per player;
 *   - the hub's index is kept in the isolate as the set of released scenario
 *     posts, an hour at a time; a post it does not know reads it again, at most
 *     every five minutes, so a scenario released this minute still counts;
 *   - an import is one D1 read (the address's day) and one write round of
 *     three rows; a repeat is told by the insert itself, not by a read first;
 *   - the tables are made at deploy (README), so a fresh isolate reads one row
 *     (the legacy marker) and nothing more.
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

// The hub's index, kept at the edge; null when it cannot be read. `fresh` skips the edge's copy.
const readIndex = async (ctx, { fresh = false } = {}) => {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(HUB_INDEX_URL);
  let response = cache && !fresh ? await cache.match(cacheKey) : null;
  if (!response) {
    const upstream = await fetch(HUB_INDEX_URL, { headers: { Accept: "application/json" }, cf: { cacheTtl: INDEX_TTL_SECONDS } });
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
// index cannot be read for the freeze.
const ready = new WeakMap();
const ensureReady = (env, ctx) => {
  if (!ready.has(env.DB)) {
    const pending = (async () => {
      // Made at deploy (README); made here only when they are not there yet.
      const frozen = await env.DB.prepare("SELECT value FROM meta WHERE key = 'legacy'").first().catch(async () => {
        await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
        return null;
      });
      if (frozen) return;
      const index = await readIndex(ctx);
      if (!index) throw new Error("the hub's index could not be read to freeze the old counts");
      const legacy = indexImports(index);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO counts (post, legacy) SELECT CAST(key AS INTEGER), value FROM json_each(?1) WHERE true " +
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

// The day's key for an address: HMAC-SHA256 under COUNT_KEY of the day and the
// address, 32 hex digits. The address itself is never stored.
const addressKey = async (secret, day, address) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}|${address}`));
  return [...new Uint8Array(mac)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const readCounts = async (env, ctx) => {
  if (!env.DB) {
    // Not set up yet: the retired Worker's answer.
    const index = await readIndex(ctx).catch(() => null);
    return index ? indexImports(index) : {};
  }
  await ensureReady(env, ctx);
  const { results } = await env.DB.prepare("SELECT post, legacy + counted AS count FROM counts").all();
  const out = {};
  for (const row of results ?? []) out[String(row.post)] = Number(row.count);
  return out;
};

// { "<post>": { count } }, the one read every endpoint answers from: kept at the edge for COUNTS_TTL_SECONDS, so
// D1 is read at most once an hour per Cloudflare location.
const cachedCounts = async (url, env, ctx) => {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${url.origin}/counts`);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) {
    const kept = await cached.json().catch(() => null);
    if (kept && typeof kept === "object") return kept;
  }
  const out = {};
  for (const [post, count] of Object.entries(await readCounts(env, ctx))) out[post] = { count };
  if (cache) {
    ctx?.waitUntil?.(cache.put(cacheKey, new Response(JSON.stringify(out), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${COUNTS_TTL_SECONDS}` },
    })));
  }
  return out;
};

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
  const address = request.headers.get("CF-Connecting-IP") || "";
  if (!address) return json({ post, counted: false, reason: "address" }, 400, cors);
  if (env.LIMITER && typeof env.LIMITER.limit === "function") {
    const { success } = await env.LIMITER.limit({ key: address });
    if (!success) return json({ post, counted: false, reason: "slow down" }, 429, cors, { "Retry-After": "60" });
  }
  const scenario = await isReleasedScenario(env, ctx, post);
  if (scenario === null) return json({ post, counted: false, reason: "hub unreadable" }, 503, cors);
  if (!scenario) return json({ post, counted: false, reason: "not a released scenario" }, 404, cors);
  // (The old counts are frozen the first time; until the index can be read for that, nothing is counted.)
  if (!(await ensureReady(env, ctx).then(() => true, () => false))) return json({ post, counted: false, reason: "hub unreadable" }, 503, cors);

  // (A repeat from the same install is told by the insert below, not by a read first.)
  const day = Math.floor(Date.now() / DAY_MS);
  const who = await addressKey(env.COUNT_KEY, day, address);
  const seen = await env.DB.prepare("SELECT COUNT(*) AS posts, COALESCE(SUM(post = ?3), 0) AS same FROM addresses WHERE day = ?1 AND who = ?2")
    .bind(day, who, post)
    .first();
  if (Number(seen?.same) > 0) return json({ post, counted: false, reason: "address" }, 200, cors);
  if (Number(seen?.posts) >= MAX_POSTS_PER_ADDRESS_PER_DAY) return json({ post, counted: false, reason: "address limit" }, 200, cors);

  // The token first: its key is what makes one install's import count once,
  // however many of its requests arrive together.
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO installs (post, token) VALUES (?1, ?2)").bind(post, token).run();
  if (!Number(inserted?.meta?.changes)) return json({ post, counted: false, reason: "again" }, 200, cors);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO addresses (day, who, post) VALUES (?1, ?2, ?3)").bind(day, who, post),
    env.DB.prepare("INSERT INTO counts (post, counted) VALUES (?1, 1) ON CONFLICT(post) DO UPDATE SET counted = counted + 1").bind(post),
  ]);
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
        const counts = await cachedCounts(url, env, ctx).catch(() => ({}));
        return json({ id, count: counts[id]?.count ?? 0, retired: true }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/counts") {
        const counts = await cachedCounts(url, env, ctx);
        return json(counts, 200, cors, { "Cache-Control": `public, max-age=${COUNTS_BROWSER_SECONDS}` });
      }

      if (request.method === "GET" && url.pathname.startsWith("/count/")) {
        const id = decodeURIComponent(url.pathname.slice("/count/".length));
        const counts = await cachedCounts(url, env, ctx);
        return json({ id, count: counts[id]?.count ?? 0 }, 200, cors, { "Cache-Control": `public, max-age=${COUNTS_BROWSER_SECONDS}` });
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
