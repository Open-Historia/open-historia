/*! Open Historia — web-mode UI settings + language packs © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Mirrors the server's /api/ui-settings and /api/lang endpoints (server/server.js:150-236)
// for the web build. Shipped language packs (public/lang/<code>.json — copied to the
// deployed site by Vite) are merged UNDER the browser's IndexedDB overlay of
// AI-generated translations, exactly like the server merges shipped + saved packs.
// UI settings persist in IndexedDB. Only bundled into the web build (VITE_OH_WEB).

import { kvGet, kvUpdate } from "./idb.js";
import { jsonResponse, errorResponse } from "./util.js";

const isLangCode = (code) => /^[a-z]{2,3}$/.test(code);
const langKey = (code) => `lang:${code}`;
const shippedPackCache = new Map();

// Fetch the shipped pack Vite copied to /lang/<code>.json (static, same-origin).
// This is a non-/api path, so the wrapped fetch passes it straight to the network
// (no recursion into the router). Missing packs (most languages ship none) → {}.
const loadShippedPack = async (code) => {
  if (shippedPackCache.has(code)) return shippedPackCache.get(code);
  let pack = {};
  try {
    const response = await fetch(new URL(`/lang/${code}.json`, location.origin), { cache: "force-cache" });
    if (response.ok) {
      const data = await response.json();
      if (data && typeof data === "object" && !Array.isArray(data)) pack = data;
    }
  } catch {
    // No shipped pack for this language, or a non-JSON (SPA-fallback) response.
  }
  shippedPackCache.set(code, pack);
  return pack;
};

// GET/PUT /api/lang/:code — merged shipped pack + IndexedDB overlay (GET), and
// upsert AI-generated translations into the overlay (PUT), matching the server's
// { entries } body and 3000/6000-char caps.
export const handleLang = async (ctx) => {
  const code = String(ctx.segments[0] || "").toLowerCase();
  if (!code) return null;
  if (!isLangCode(code)) return errorResponse("Invalid language code.", 400);

  if (ctx.method === "GET") {
    const [shipped, overlay] = await Promise.all([loadShippedPack(code), kvGet(langKey(code), {})]);
    return jsonResponse({ ...shipped, ...(overlay || {}) });
  }

  if (ctx.method === "PUT") {
    const entries = ctx.body?.entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return errorResponse("Body must be { entries: { source: translation } }.", 400);
    }
    let added = 0;
    const merged = await kvUpdate(langKey(code), (current) => {
      const saved = { ...(current || {}) };
      for (const [source, translated] of Object.entries(entries)) {
        if (
          typeof source === "string" && typeof translated === "string" &&
          source.length <= 3000 && translated.length <= 6000 &&
          saved[source] !== translated
        ) {
          saved[source] = translated;
          added += 1;
        }
      }
      return saved;
    }, {});
    return jsonResponse({ saved: added, total: Object.keys(merged).length });
  }

  return null;
};

// GET/PUT /api/ui-settings — the shared client prefs (currently the UI language),
// persisted per-browser in IndexedDB.
export const handleUiSettings = async (ctx) => {
  if (ctx.method === "GET") {
    return jsonResponse((await kvGet("ui-settings", {})) || {});
  }
  if (ctx.method === "PUT") {
    const next = await kvUpdate("ui-settings", (current) => {
      const merged = { ...(current || {}) };
      if (typeof ctx.body?.language === "string" && ctx.body.language.trim().length <= 16) {
        merged.language = ctx.body.language.trim();
      }
      return merged;
    }, {});
    return jsonResponse(next);
  }
  return null;
};
