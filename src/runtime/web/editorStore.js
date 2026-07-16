/*! Open Historia — web-mode map-editor store © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Browser (IndexedDB) port of server/mapEditorStore.js. Backs
// /api/mapeditor/documents* in web mode. Faithful to the server's id/merge
// semantics and summary projection (see the spec in mapEditorStore.js).

import { STORES, idbGet, idbGetAll, idbPut, idbDelete, kvGet, kvUpdate } from "./idb.js";
import { cloneJson, nowIso, normalizeId, ensureUniqueId, jsonResponse, errorResponse } from "./util.js";

const MANIFEST_KEY = "mapeditor-manifest";

const getManifest = async () => {
  const manifest = await kvGet(MANIFEST_KEY, null);
  return manifest && Array.isArray(manifest.order) ? manifest : { version: 1, order: [] };
};

// summarize() — mapEditorStore.js:73-82
const summarize = (doc) => ({
  id: doc.id,
  name: doc.name || doc.metadata?.name || "Untitled Map",
  kind: doc.metadata?.kind || "import-world",
  regionCount: doc.regions?.features?.length ?? 0,
  featureCount: doc.features?.length ?? 0,
  typeCount: doc.types?.length ?? 0,
  updatedAt: doc.updatedAt,
  createdAt: doc.createdAt,
});

const listDocuments = async () => {
  const manifest = await getManifest();
  const all = await idbGetAll(STORES.mapeditorDocs);
  const byId = new Map(all.map((doc) => [doc.id, doc]));
  const ordered = [];
  const seen = new Set();
  for (const id of manifest.order) {
    if (byId.has(id) && !seen.has(id)) {
      ordered.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const doc of all) {
    if (!seen.has(doc.id)) ordered.push(doc);
  }
  return ordered.map(summarize);
};

const createDocument = async (body = {}) => {
  const name = String(body.name || body.metadata?.name || "Untitled Map").trim() || "Untitled Map";
  const requested = normalizeId(body.id || name, "map", 48);
  const id = await ensureUniqueId(requested, async (candidate) => Boolean(await idbGet(STORES.mapeditorDocs, candidate)));
  const timestamp = nowIso();
  const doc = {
    id,
    name,
    version: 1,
    metadata: { name, ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}), createdAt: timestamp, updatedAt: timestamp },
    types: Array.isArray(body.types) ? cloneJson(body.types) : [],
    regions: body.regions && typeof body.regions === "object" ? cloneJson(body.regions) : { type: "FeatureCollection", features: [] },
    features: Array.isArray(body.features) ? cloneJson(body.features) : [],
    // Mirrors server/mapEditorStore.js:105-118 — the map-maker's palette and flags.
    // Both stores build the record field by field, so a field added to one and not
    // the other silently survives on desktop and vanishes on the website.
    colorOverrides: body.colorOverrides && typeof body.colorOverrides === "object" ? cloneJson(body.colorOverrides) : {},
    flags: body.flags && typeof body.flags === "object" ? cloneJson(body.flags) : {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await idbPut(STORES.mapeditorDocs, doc);
  await kvUpdate(MANIFEST_KEY, (current) => {
    const order = current && Array.isArray(current.order) ? current.order.filter((entry) => entry !== id) : [];
    return { version: 1, order: [id, ...order] };
  }, { version: 1, order: [] });
  return doc;
};

const updateDocument = async (id, updates = {}) => {
  const existing = await idbGet(STORES.mapeditorDocs, id);
  if (!existing) throw new Error(`Map document not found: ${id}`);
  const next = {
    ...existing,
    ...updates,
    id,
    name: String(updates.name || updates.metadata?.name || existing.name || "Untitled Map"),
    metadata: { ...existing.metadata, ...(updates.metadata && typeof updates.metadata === "object" ? updates.metadata : {}) },
    updatedAt: nowIso(),
  };
  await idbPut(STORES.mapeditorDocs, next);
  await kvUpdate(MANIFEST_KEY, (current) => {
    const order = current && Array.isArray(current.order) ? current.order : [];
    return order.includes(id) ? { version: 1, order } : { version: 1, order: [...order, id] };
  }, { version: 1, order: [id] });
  return next;
};

const deleteDocument = async (id) => {
  await idbDelete(STORES.mapeditorDocs, id);
  await kvUpdate(MANIFEST_KEY, (current) => {
    const order = current && Array.isArray(current.order) ? current.order.filter((entry) => entry !== id) : [];
    return { version: 1, order };
  }, { version: 1, order: [] });
  return { id, deleted: true };
};

// segments are the path parts after "/api/mapeditor". Returns a Response or null.
export const handleMapEditor = async ({ method, segments, body }) => {
  if (segments[0] !== "documents") return null;
  const id = segments[1] ? decodeURIComponent(segments[1]) : null;

  try {
    if (!id) {
      if (method === "GET") return jsonResponse(await listDocuments());
      if (method === "POST") return jsonResponse(await createDocument(body ?? {}), 201);
      return null;
    }
    if (method === "GET") {
      const doc = await idbGet(STORES.mapeditorDocs, id);
      if (!doc) return errorResponse(`Map document not found: ${id}`, 404);
      return jsonResponse(doc);
    }
    if (method === "PUT") return jsonResponse(await updateDocument(id, body ?? {}));
    if (method === "DELETE") return jsonResponse(await deleteDocument(id));
    return null;
  } catch (error) {
    // Not-found on GET is 404; every other failure is 400 (matches server.js).
    const status = method === "GET" ? 404 : 400;
    return errorResponse(error.message, status);
  }
};
