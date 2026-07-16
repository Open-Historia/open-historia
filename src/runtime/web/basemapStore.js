/*! Open Historia — web-mode basemap store © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Browser (IndexedDB) port of server/basemapStore.js. Backs /api/basemaps* in
// web mode. meta and payload are split across two object stores (as on disk),
// and the content hash is RECOMPUTED locally with the exact canonicalization the
// server uses (basemapStore.js hashPayload) so local + community dedup agree.

import { STORES, idbGet, idbGetAll, idbPut, idbDelete, kvGet, kvUpdate } from "./idb.js";
import { cloneJson, nowIso, normalizeId, ensureUniqueId, sha256Hex, jsonResponse, errorResponse } from "./util.js";

const MANIFEST_KEY = "basemaps-manifest";
const SUPPORTED_KINDS = new Set(["image", "vector"]);

const getManifest = async () => {
  const manifest = await kvGet(MANIFEST_KEY, null);
  if (!manifest) return { version: 1, order: [], byHash: {} };
  return {
    version: 1,
    order: Array.isArray(manifest.order) ? manifest.order : [],
    byHash: manifest.byHash && typeof manifest.byHash === "object" ? manifest.byHash : {},
  };
};

// hashPayload — basemapStore.js:109-112
const hashPayload = (payload) => {
  const canonical = payload?.dataUrl ?? JSON.stringify(payload?.geojson ?? payload ?? null);
  return sha256Hex(String(canonical));
};

const validatePayload = (kind, payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Basemap payload missing (need { dataUrl } for image or { geojson } for vector).");
  }
  if (kind === "image" && !payload.dataUrl) {
    throw new Error("Basemap payload missing (need { dataUrl } for image or { geojson } for vector).");
  }
  if (kind === "vector" && !payload.geojson) {
    throw new Error("Basemap payload missing (need { dataUrl } for image or { geojson } for vector).");
  }
};

const listBasemaps = async () => {
  const manifest = await getManifest();
  const all = await idbGetAll(STORES.basemapMeta);
  const byId = new Map(all.map((meta) => [meta.id, meta]));
  const ordered = [];
  const seen = new Set();
  for (const id of manifest.order) {
    if (byId.has(id) && !seen.has(id)) {
      ordered.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const meta of all) {
    if (!seen.has(meta.id)) ordered.push(meta);
  }
  return ordered;
};

const createBasemap = async (body = {}) => {
  const kind = SUPPORTED_KINDS.has(body.kind) ? body.kind : "image";
  const payload = body.payload;
  validatePayload(kind, payload);

  const contentHash = await hashPayload(payload);
  const manifest = await getManifest();
  const existingId = manifest.byHash[contentHash];
  if (existingId) {
    const existing = await idbGet(STORES.basemapMeta, existingId);
    if (existing) return existing; // dedup: return the existing meta, still 201
  }

  const name = String(body.name || "").trim().slice(0, 80) || "Custom basemap";
  const requested = normalizeId(name, "basemap");
  const id = await ensureUniqueId(requested, async (candidate) => Boolean(await idbGet(STORES.basemapMeta, candidate)));
  const timestamp = nowIso();
  const aspect = Number(body.aspect) > 0 ? Number(body.aspect) : null;

  const meta = {
    id,
    name,
    kind,
    contentHash,
    aspect,
    author: String(body.author || "").slice(0, 80),
    thumbnail: typeof body.thumbnail === "string" ? body.thumbnail : null,
    source: body.source && typeof body.source === "object" ? cloneJson(body.source) : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await idbPut(STORES.basemapMeta, meta);
  await idbPut(STORES.basemapPayload, { id, payload: cloneJson(payload) });
  await kvUpdate(MANIFEST_KEY, (current) => {
    const base = current && typeof current === "object" ? current : { version: 1, order: [], byHash: {} };
    const order = Array.isArray(base.order) ? base.order.filter((entry) => entry !== id) : [];
    const byHash = { ...(base.byHash || {}), [contentHash]: id };
    return { version: 1, order: [id, ...order], byHash };
  }, { version: 1, order: [], byHash: {} });

  return meta;
};

const getPayload = async (id) => {
  const record = await idbGet(STORES.basemapPayload, id);
  if (!record) throw new Error(`Basemap payload not found: ${id}`);
  return record.payload;
};

const deleteBasemap = async (id) => {
  const meta = await idbGet(STORES.basemapMeta, id);
  await idbDelete(STORES.basemapMeta, id);
  await idbDelete(STORES.basemapPayload, id);
  await kvUpdate(MANIFEST_KEY, (current) => {
    const base = current && typeof current === "object" ? current : { version: 1, order: [], byHash: {} };
    const order = Array.isArray(base.order) ? base.order.filter((entry) => entry !== id) : [];
    const byHash = { ...(base.byHash || {}) };
    if (meta && byHash[meta.contentHash] === id) delete byHash[meta.contentHash];
    return { version: 1, order, byHash };
  }, { version: 1, order: [], byHash: {} });
  return { id, deleted: true };
};

// segments are path parts after "/api/basemaps". Returns a Response or null.
export const handleBasemaps = async ({ method, segments, body }) => {
  const id = segments[0] ? decodeURIComponent(segments[0]) : null;

  try {
    if (!id) {
      if (method === "GET") return jsonResponse(await listBasemaps());
      if (method === "POST") return jsonResponse(await createBasemap(body ?? {}), 201);
      return null;
    }
    if (segments[1] === "payload" && method === "GET") {
      return jsonResponse(await getPayload(id));
    }
    if (!segments[1] && method === "DELETE") {
      return jsonResponse(await deleteBasemap(id));
    }
    return null;
  } catch (error) {
    const status = segments[1] === "payload" ? 404 : 400;
    return errorResponse(error.message, status);
  }
};
