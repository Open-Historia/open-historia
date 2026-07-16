/*! Open Historia — web-mode API router (fetch interceptor) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// In the web build there is no Express server. This installs a fetch()
// interceptor that answers the client's same-origin /api/* calls from the
// IndexedDB stores, so all the existing client code (library.js, assets.js,
// documentIO.js, basemapLibrary.js) runs UNCHANGED. Everything that is not
// /api/* (AI providers, GitHub, ESRI tiles, static assets) passes straight
// through to the real fetch.

import { errorResponse } from "./util.js";
import { handleMapEditor } from "./editorStore.js";
import { handleBasemaps } from "./basemapStore.js";
import { handleFlags } from "./flagStore.js";
import { handleLibrary, handleScenarios, handleGames, handleRuntimeJson, getScenarioPmtilesOverride } from "./libraryStore.js";

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

// Route an /api/* request to the right store handler. Returns a Response.
const route = async (request, url) => {
  const parts = url.pathname.replace(/^\/+/, "").split("/"); // ["api", domain, ...]
  const domain = parts[1];
  const segments = parts.slice(2).filter((part) => part !== "");
  const { method } = request;

  const rangeHeader = request.headers.get("Range");

  // Runtime map tiles: a scenario may override the shared archive; otherwise
  // serve the static archive from the origin (Phase 0 pulls pmtiles from there).
  if (domain === "runtime" && segments[0] === "pmtiles") {
    const key = segments[1];
    const override = await getScenarioPmtilesOverride(key, rangeHeader);
    if (override) return method === "HEAD" ? new Response(null, { status: 200, headers: override.headers }) : override;
    return fetch(new Request(`/assets/${encodeURIComponent(key)}.pmtiles`, {
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

  // UI settings + language packs are cosmetic; degrade to empty locally.
  if (domain === "ui-settings") return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  if (domain === "lang") return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });

  // The GitHub CORS proxy has no server in web mode; a signed Worker proxy
  // replaces it in a later phase. Fail clearly rather than silently.
  if (domain === "hub") return errorResponse("Community hub proxy is unavailable in web mode.", 502);

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
