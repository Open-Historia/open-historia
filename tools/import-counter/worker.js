/**
 * Open Historia — scenario import counter (Cloudflare Worker), retired.
 *
 * Counting moved to GitHub. A scenario's import count is now how many times its
 * file has been downloaded from the community hub's releases; a workflow in the
 * hub repository adds the downloads up and writes them to index.json on its
 * hub-index branch, and the game reads that file itself (src/runtime/hubFiles.js).
 *
 * This Worker used to keep the counts in KV, one write per import and one KV
 * list() per read of /counts, and the free plan's daily KV allowance was spent
 * within hours of every day ("KV list() limit exceeded for the day"), after
 * which every install saw no counts at all.
 *
 * Game builds from before the move still call it, so it still answers them, in
 * the shapes they expect, from the hub's index, and stores nothing:
 *
 *   GET  /counts       -> { "<post number>": { count }, ... }
 *   GET  /count/<id>   -> { id, count }
 *   POST /hit          -> { id, count }   (accepted and ignored: the download
 *                                           the import made is what counted it)
 *
 * It no longer reads or writes KV, hashes an address, or keeps anything about
 * who called. The IMPORTS binding in wrangler.toml is unused and may be removed
 * with the namespace, once nobody needs the old numbers: what they had reached
 * on 2026-10-05 is carried in the hub's counts (data/legacy-import-counts.json
 * in the hub repository).
 */

export const HUB_INDEX_URL =
  "https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/hub-index/index.json";
// raw.githubusercontent.com holds the file five minutes itself; so does the edge.
const INDEX_TTL_SECONDS = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-OH-Client-IP,X-OH-Forward-Secret,X-OH-Account",
};

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS, ...headers } });

// { "<post number>": count } from the hub's index; {} when it cannot be read
// (the game then shows no counts, as it did whenever the counter was down).
const readImports = async (ctx) => {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(HUB_INDEX_URL);
  let response = cache ? await cache.match(cacheKey) : null;
  if (!response) {
    const upstream = await fetch(HUB_INDEX_URL, { headers: { Accept: "application/json" } });
    if (!upstream.ok) return {};
    response = new Response(await upstream.text(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${INDEX_TTL_SECONDS}` },
    });
    if (cache) ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
  }
  const index = await response.json().catch(() => null);
  const imports = index && typeof index.imports === "object" && index.imports ? index.imports : {};
  const out = {};
  for (const [post, count] of Object.entries(imports)) {
    const number = Number(count);
    if (Number.isSafeInteger(number) && number >= 0) out[post] = number;
  }
  return out;
};

export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (request.method === "POST" && url.pathname === "/hit") {
        const body = await request.json().catch(() => ({}));
        const id = String(body?.id ?? "").trim().slice(0, 120);
        if (!id) return json({ error: "missing id" }, 400);
        const imports = await readImports(ctx).catch(() => ({}));
        return json({ id, count: imports[id] ?? 0, retired: true });
      }

      if (request.method === "GET" && url.pathname === "/counts") {
        const imports = await readImports(ctx);
        const out = {};
        for (const [post, count] of Object.entries(imports)) out[post] = { count };
        return json(out, 200, { "Cache-Control": `public, max-age=${INDEX_TTL_SECONDS}` });
      }

      if (request.method === "GET" && url.pathname.startsWith("/count/")) {
        const id = decodeURIComponent(url.pathname.slice("/count/".length));
        const imports = await readImports(ctx);
        return json({ id, count: imports[id] ?? 0 });
      }

      return json({ ok: true, usage: "GET /counts · GET /count/:id (POST /hit is accepted and ignored)" });
    } catch (error) {
      return json({ error: String((error && error.message) || error) }, 500);
    }
  },
};
