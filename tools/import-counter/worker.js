/**
 * Open Historia — scenario import counter (Cloudflare Worker + KV).
 *
 * Counts how many people imported each community scenario, deduped SERVER-SIDE so
 * a person can't inflate a scenario's count by re-importing / button-mashing /
 * clearing localStorage. Genuine, distinct installs still add up.
 *
 * Dedup axes per scenario id:
 *   - Website (import forwarded by the registry Worker): per ACCOUNT *and* per IP.
 *     A signed-in import marks both; a later hit is ignored if EITHER the account
 *     OR the IP was already seen — so the same person counts once whether they
 *     toggle sign-in or move networks, and a shared IP counts once.
 *   - App / anonymous web: per IP only (there is no account).
 *
 * Web imports are forwarded by the registry Worker, so the real browser IP is
 * passed in X-OH-Client-IP and the account token in X-OH-Account — both trusted
 * ONLY when X-OH-Forward-Secret matches FORWARD_SECRET (otherwise a Worker->
 * Worker hop would collapse every web user to the registry's single egress IP,
 * and anyone could spoof an account). Direct callers can only spend their own IP.
 *
 * Routes:
 *   POST /hit          body {id, title?}  -> increment for `id` (once per IP)
 *   GET  /counts                          -> { "<id>": {count, title}, ... }
 *   GET  /count/<id>                       -> { id, count }
 *
 * Bindings: KV 'IMPORTS'; secrets FORWARD_SECRET (shared with the registry Worker)
 * and HASH_SALT (so raw IPs are never stored). Counts live in each c:<id> key's
 * metadata; the h:<id>:<ipHash> dedup markers self-expire so GET /counts is
 * unaffected and KV stays bounded.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-OH-Client-IP,X-OH-Forward-Secret,X-OH-Account",
};

const DEDUP_TTL = 60 * 60 * 24 * 365; // 1 year; bounded so KV self-cleans + recycled IPs eventually recount

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function ipHash(ip, env) {
  const salt = env.HASH_SALT || "oh-import-counter";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// The forwarder proves it's the registry Worker with the shared secret; only then
// do we trust the real end-user IP it passes. Everyone else spends their own IP.
function clientIp(request, env) {
  const fwd = request.headers.get("x-oh-client-ip");
  const secretOk = env.FORWARD_SECRET && request.headers.get("x-oh-forward-secret") === env.FORWARD_SECRET;
  if (secretOk && fwd) return fwd.trim();
  return request.headers.get("cf-connecting-ip") || "unknown";
}

// The dedup markers a hit consumes for scenario `id`. Everyone gets an IP marker;
// a signed-in web account (an opaque token the trusted registry Worker forwards
// with the shared secret) adds an account marker too. The hit is counted only
// when NONE of its markers already exist, so a website user is deduped by account
// AND IP, and the app / anonymous web by IP alone. The key formats are unchanged
// from the account-only / IP-only versions, so existing markers still dedup (an
// account marker always carries ":a:", an IP hash never does — they can't collide).
async function dedupMarkersFor(request, env, id) {
  const markers = [`h:${id}:${await ipHash(clientIp(request, env), env)}`];
  const secretOk = env.FORWARD_SECRET && request.headers.get("x-oh-forward-secret") === env.FORWARD_SECRET;
  const acct = secretOk ? (request.headers.get("x-oh-account") || "").trim() : "";
  if (acct) markers.push(`h:${id}:a:${acct.slice(0, 48)}`);
  return markers;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.IMPORTS) return json({ error: "KV namespace binding 'IMPORTS' is not configured" }, 500);

    try {
      if (request.method === "POST" && url.pathname === "/hit") {
        const body = await request.json().catch(() => ({}));
        const id = String(body.id ?? "").trim().slice(0, 120);
        if (!id) return json({ error: "missing id" }, 400);
        const countKey = `c:${id}`;
        const existing = await env.IMPORTS.getWithMetadata(countKey, "text");
        const meta = existing.metadata || {};
        let count = Number(meta.count) || 0;
        const title = String(body.title ?? meta.title ?? "").slice(0, 200);
        const markers = await dedupMarkersFor(request, env, id);
        // Already counted if ANY axis (this account, or this IP) has been seen.
        const seen = await Promise.all(markers.map((marker) => env.IMPORTS.get(marker)));
        if (seen.some(Boolean)) {
          return json({ id, count, deduped: true });
        }
        await Promise.all(
          markers.map((marker) => env.IMPORTS.put(marker, "1", { expirationTtl: DEDUP_TTL })),
        );
        count += 1;
        await env.IMPORTS.put(countKey, "", { metadata: { count, title } });
        return json({ id, count });
      }

      if (request.method === "GET" && url.pathname === "/counts") {
        // Edge-cache the whole map for a minute. The community tab is read FAR more
        // than scenarios are imported, and each uncached read is a KV list() over
        // every counter key — so without this a busy hub could burn through the KV
        // read allowance on refreshes alone. A ≤60s-stale install number is fine; a
        // fresh /hit still lands immediately, it just shows on the next cache cycle.
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/counts`);
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        const out = {};
        let cursor;
        do {
          const page = await env.IMPORTS.list({ prefix: "c:", cursor });
          for (const k of page.keys) out[k.name.slice(2)] = k.metadata || { count: 0 };
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
        const resp = new Response(JSON.stringify(out), {
          headers: { "Content-Type": "application/json", ...CORS, "Cache-Control": "public, max-age=60" },
        });
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
        return resp;
      }

      if (request.method === "GET" && url.pathname.startsWith("/count/")) {
        const id = decodeURIComponent(url.pathname.slice("/count/".length));
        const r = await env.IMPORTS.getWithMetadata(`c:${id}`, "text");
        return json({ id, count: Number(r.metadata?.count) || 0 });
      }

      return json({ ok: true, usage: "POST /hit {id,title?} · GET /counts · GET /count/:id" });
    } catch (error) {
      return json({ error: String((error && error.message) || error) }, 500);
    }
  },
};
