/**
 * Open Historia — scenario import counter (Cloudflare Worker + KV).
 *
 * Records how many times each community scenario is imported, so the hub owner
 * can see real import numbers even for scenarios GitHub can't count (issue
 * attachments). The game server pings POST /hit on the FIRST successful import
 * of a bundle per install (it dedupes locally), so repeats don't inflate it.
 *
 * Routes:
 *   POST /hit          body {id, title?}  -> increment the counter for `id`
 *   GET  /counts                          -> { "<id>": {count, title}, ... }
 *   GET  /count/<id>                       -> { id, count }
 *
 * The count lives in each key's KV metadata, so GET /counts is a single list()
 * call (no per-key reads) and stays within the free-tier subrequest limit.
 *
 * Note: this is an anonymous, unauthenticated counter — like any client-side
 * metric it can be inflated by someone hitting /hit directly. The per-install
 * dedupe on the game server covers ordinary repeat-imports; treat the numbers
 * as "roughly how many people imported", not audited figures.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

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
        const key = `c:${id}`;
        const existing = await env.IMPORTS.getWithMetadata(key, "text");
        const meta = existing.metadata || {};
        const count = (Number(meta.count) || 0) + 1;
        const title = String(body.title ?? meta.title ?? "").slice(0, 200);
        await env.IMPORTS.put(key, "", { metadata: { count, title } });
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
