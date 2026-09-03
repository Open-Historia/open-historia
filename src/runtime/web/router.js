/*! Open Historia — web-mode API router (fetch interceptor) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// In the web build there is no Express server. This installs a fetch()
// interceptor that answers the client's same-origin /api/* calls from the
// IndexedDB stores, so all the existing client code (library.js, assets.js,
// documentIO.js, basemapLibrary.js) runs UNCHANGED. Everything that is not
// /api/* (AI providers, GitHub, ESRI tiles, static assets) passes straight
// through to the real fetch.

import { errorResponse, jsonResponse } from "./util.js";
import { handleMapEditor } from "./editorStore.js";
import { handleBasemaps } from "./basemapStore.js";
import { handleFlags } from "./flagStore.js";
import { handleLibrary, handleScenarios, handleGames, handleRuntimeJson, getScenarioPmtilesOverride } from "./libraryStore.js";
import { handleLang, handleUiSettings } from "./settingsStore.js";
import { getConnected } from "./nodeConnect.js";
import { getSession } from "./account.js";

let installed = false;

const readBody = async (request, forceRaw) => {
  if (request.method === "GET" || request.method === "HEAD") return { body: undefined, rawBody: undefined };
  const contentType = request.headers.get("Content-Type") || "";
  // Asset uploads are raw bytes regardless of Content-Type (colors/geojson come
  // in as application/json but must NOT be parsed here — the server's
  // express.raw stores the bytes verbatim).
  if (forceRaw || !contentType.includes("application/json")) {
    const buffer = await request.arrayBuffer();
    return { body: undefined, rawBody: new Uint8Array(buffer), contentType };
  }
  const text = await request.text();
  return { body: text ? JSON.parse(text) : {}, rawBody: undefined };
};

const isAssetUpload = (domain, segments, method) =>
  (domain === "scenarios" || domain === "games") && segments.includes("assets") && method === "PUT";

// Same manifests the desktop server proxies (server/server.js APP_UPDATE_MANIFESTS).
const APP_UPDATE_MANIFESTS = {
  stable: "https://github.com/Open-Historia/open-historia/releases/download/android/latest.json",
  beta: "https://github.com/Open-Historia/open-historia/releases/download/android-beta/latest.json",
};

// Native HTTP when Capacitor provides it — the WebView's own fetch is subject to
// CORS and this is a cross-origin GitHub asset. Falls back to fetch elsewhere.
const fetchJsonUnrestricted = async (target) => {
  const native = window.Capacitor?.Plugins?.CapacitorHttp;
  if (native) {
    const res = await native.request({ url: target, method: "GET", connectTimeout: 6000, readTimeout: 6000 });
    if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status}`);
    return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  }
  const res = await fetch(target, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// Normalized exactly like the server's route, so AppUpdateBanner cannot tell the
// two apart. `current` is omitted: that field means "a desktop app is asking",
// and this build is never that.
const readAppUpdateManifest = async (target) => {
  const raw = await fetchJsonUnrestricted(target);
  const str = (value) => (typeof value === "string" ? value : "");
  return {
    build: Number(raw && raw.build) || 0,
    apk: str(raw && raw.apk),
    notes: str(raw && raw.notes),
  };
};

// Route an /api/* request to the right store handler. Returns a Response.
const route = async (request, url) => {
  const parts = url.pathname.replace(/^\/+/, "").split("/"); // ["api", domain, ...]
  const domain = parts[1];
  const segments = parts.slice(2).filter((part) => part !== "");
  const { method } = request;

  const rangeHeader = request.headers.get("Range");

  // Runtime map tiles: a scenario may override the shared archive; otherwise
  // serve the static archive from the canonical content origin. Defaults to
  // same-origin /assets (local dev), but the hosted site sets VITE_OH_PMTILES_URL
  // to the registry Worker's CORS+range proxy (Cloudflare Pages can't host the
  // 60-100 MB pmtiles itself, so same-origin would 404 to the SPA fallback).
  if (domain === "runtime" && segments[0] === "pmtiles") {
    const key = segments[1];
    const override = await getScenarioPmtilesOverride(key, rangeHeader);
    if (override) return method === "HEAD" ? new Response(null, { status: 200, headers: override.headers }) : override;
    const base = (import.meta.env.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "");
    return fetch(new Request(`${base}/${encodeURIComponent(key)}.pmtiles`, {
      method: method === "HEAD" ? "HEAD" : "GET",
      headers: request.headers,
    }));
  }

  const ctx = { method, url, segments, query: url.searchParams, rangeHeader, ...(await readBody(request, isAssetUpload(domain, segments, method))) };

  if (domain === "mapeditor") {
    const response = await handleMapEditor(ctx);
    if (response) return response;
  }
  if (domain === "basemaps") {
    const response = await handleBasemaps(ctx);
    if (response) return response;
  }
  if (domain === "flags") {
    const response = await handleFlags(ctx);
    if (response) return response;
  }
  if (domain === "library") {
    const response = await handleLibrary(ctx);
    if (response) return response;
  }
  if (domain === "scenarios") {
    const response = await handleScenarios(ctx);
    if (response) return response;
  }
  if (domain === "games") {
    const response = await handleGames(ctx);
    if (response) return response;
  }
  if (domain === "runtime" && segments[0] === "json") {
    const response = await handleRuntimeJson(ctx);
    if (response) return response;
  }

  // UI settings + language packs: persisted in IndexedDB; shipped packs merged
  // from the static /lang/*.json Vite copies to the site.
  if (domain === "ui-settings") {
    const response = await handleUiSettings(ctx);
    if (response) return response;
  }
  if (domain === "lang") {
    const response = await handleLang(ctx);
    if (response) return response;
  }

  // Community hub: forward /api/hub/* to the registry Worker's SSRF-guarded
  // GitHub proxy (GitHub attachments/release assets send no CORS headers, so the
  // browser can't download bundles directly). Listing still hits api.github.com
  // directly (it sends CORS) and passes through the interceptor untouched.
  // The Android app is this same web build packaged with Capacitor, so it has no
  // on-device server to answer /api/app-update — but it is the ONE build that can
  // actually self-update (it ships as an APK). Answer it here instead.
  //
  // Straight to the release manifest rather than through the registry Worker: a
  // Capacitor WebView can issue native HTTP that is not subject to CORS, and the
  // manifest is a CDN asset with no rate limit. Everywhere else this is a plain
  // fetch, which is why the reply is fail-open — a browser that CORS-blocks it
  // simply sees no update, exactly as it does today.
  if (domain === "app-update") {
    const track = url.searchParams.get("track") || "stable";
    const manifest = APP_UPDATE_MANIFESTS[track];
    if (!manifest) return jsonResponse({});
    try {
      return jsonResponse(await readAppUpdateManifest(manifest));
    } catch {
      return jsonResponse({}); // offline, blocked, or malformed -> no banner
    }
  }

  if (domain === "hub") {
    const base = (import.meta.env.VITE_OH_HUB_URL || "").replace(/\/$/, "");
    // Community bundle downloads (/api/hub/file?url=…): prefer the connected
    // content node — it fetches the GitHub-hosted bundle server-side and returns
    // it with CORS, offloading the central hub proxy — and fall back to the Worker
    // if there's no node or it can't serve it. Other hub calls (import-counts,
    // import-log) stay on the Worker.
    if (segments[0] === "file" && method === "GET") {
      const node = getConnected();
      if (node && node.url && !node.origin) {
        try {
          const r = await fetch(`${node.url.replace(/\/$/, "")}/oh/v1/hub${url.search}`);
          if (r.ok) return r;
        } catch { /* node down/unsupported → fall through to the Worker */ }
      }
    }
    if (!base) return errorResponse("Community hub proxy is not configured.", 502);
    const target = `${base}/hub/${segments.join("/")}${url.search}`;
    if (method !== "POST") return fetch(target, { method });
    // Attach the account session (when signed in) so the import counter can dedup a
    // signed-in user's import by their account — stable across devices/IPs — instead
    // of by IP. Anonymous users still fall back to IP dedup on the Worker.
    const headers = { "Content-Type": "application/json" };
    try { const s = await getSession(); if (s) headers.Authorization = `Bearer ${s}`; } catch { /* not signed in */ }
    return fetch(target, { method, headers, body: JSON.stringify(ctx.body ?? {}) });
  }

  return errorResponse(`Unknown web-mode endpoint: ${url.pathname}`, 404);
};

export const installWebApiRouter = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    let url;
    try {
      const raw = typeof input === "string" ? input : input?.url ?? "";
      url = new URL(raw, window.location.href);
    } catch {
      return originalFetch(input, init);
    }

    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const request = new Request(input, init);
    try {
      return await route(request, url);
    } catch (error) {
      // Malformed JSON body → 400 (Express body-parser behavior); else 500.
      const status = error instanceof SyntaxError ? 400 : 500;
      return errorResponse(error?.message || "Web-mode request failed", status);
    }
  };
};
