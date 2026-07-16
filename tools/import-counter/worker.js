/**
 * Open Historia — scenario import counter (Cloudflare Worker + KV).
 *
 * Counts how many people imported each community scenario. Deduped SERVER-SIDE by
 * (scenario id, client IP): a person can't inflate a scenario's count by
 * re-importing / button-mashing / clearing localStorage. Genuine, distinct
 * installs still add up.
 *
 * Web imports are forwarded by the registry Worker, so the real browser IP is
 * passed in X-OH-Client-IP and trusted ONLY when X-OH-Forward-Secret matches
 * FORWARD_SECRET — otherwise a Worker->Worker hop would collapse every web user
 * to the registry's single egress IP. Direct callers can only spend their own IP.
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

// What a hit dedups on. A signed-in web account (an opaque token the trusted
// registry Worker forwards with the shared secret) dedups per-ACCOUNT — so the
// same person counts once for a scenario across devices/IPs. Everyone else dedups
// per IP, exactly as before. Spoofing an account needs the FORWARD_SECRET.
async function dedupKeyFor(request, env, id) {
  const secretOk = env.FORWARD_SECRET && request.headers.get("x-oh-forward-secret") === env.FORWARD_SECRET;
  const acct = secretOk ? (request.headers.get("x-oh-account") || "").trim() : "";
  if (acct) return `h:${id}:a:${acct.slice(0, 48)}`;
  return `h:${id}:${await ipHash(clientIp(request, env), env)}`;
}

export default {
  async fetch(request, env) {
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
        const dedupKey = await dedupKeyFor(request, env, id);
        if (await env.IMPORTS.get(dedupKey)) {
          return json({ id, count, deduped: true }); // already counted this account/IP
        }
        await env.IMPORTS.put(dedupKey, "1", { expirationTtl: DEDUP_TTL });
        count += 1;
        await env.IMPORTS.put(countKey, "", { metadata: { count, title } });
        return json({ id, count });
      }

      if (request.method === "GET" && url.pathname === "/counts") {
        const out = {};
        let cursor;
        do {
          const page = await env.IMPORTS.list({ prefix: "c:", cursor });
          for (const k of page.keys) out[k.name.slice(2)] = k.metadata || { count: 0 };
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
        return json(out);
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
