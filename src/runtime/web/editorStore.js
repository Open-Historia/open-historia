/*! Open Historia — web-mode map-editor store © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Browser (IndexedDB) port of server/mapEditorStore.js. Backs
// /api/mapeditor/documents* in web mode. Faithful to the server's id/merge
// semantics and summary projection (see the spec in mapEditorStore.js).

import { STORES, idbGet, idbGetAllKeys, idbPutPair, idbDeletePair, kvGet, kvUpdate, reconcileMetaIndex } from "./idb.js";
import { cloneJson, nowIso, normalizeId, ensureUniqueId, jsonResponse, errorResponse } from "./util.js";
import { applyRegionDelta, isRegionDelta } from "../../../server/regionDelta.js";

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

// A document and its summary row commit together (idb.js), so the Documents menu
// lists from the summaries and never loads a whole map. The desktop store keeps a
// summary file beside each document for the same reason.
const putDocument = (doc) => idbPutPair(STORES.mapeditorDocs, doc, STORES.mapeditorMeta, summarize(doc));

const listDocuments = async () => {
  const manifest = await getManifest();
  // Summaries only. A document saved before the index existed is summarised once,
  // one at a time, and its row kept from then on.
  const all = await reconcileMetaIndex(STORES.mapeditorDocs, STORES.mapeditorMeta, summarize);
  const byId = new Map(all.map((summary) => [summary.id, summary]));
  const ordered = [];
  const seen = new Set();
  for (const id of manifest.order) {
    if (byId.has(id) && !seen.has(id)) {
      ordered.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const summary of all) {
    if (!seen.has(summary.id)) ordered.push(summary);
  }
  return ordered;
};

const createDocument = async (body = {}) => {
  const name = String(body.name || body.metadata?.name || "Untitled Map").trim() || "Untitled Map";
  const requested = normalizeId(body.id || name, "map", 48);
  const taken = new Set(await idbGetAllKeys(STORES.mapeditorDocs)); // keys only, not the maps
  const id = await ensureUniqueId(requested, async (candidate) => taken.has(candidate));
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
    ownerSchema: Number(body.ownerSchema || 1),
    colorOverrides: body.colorOverrides && typeof body.colorOverrides === "object" ? cloneJson(body.colorOverrides) : {},
    flags: body.flags && typeof body.flags === "object" ? cloneJson(body.flags) : {},
    tags: body.tags && typeof body.tags === "object" ? cloneJson(body.tags) : {},
    polities: body.polities && typeof body.polities === "object" ? cloneJson(body.polities) : {},
    units: Array.isArray(body.units) ? cloneJson(body.units) : [],
    groups: body.groups && typeof body.groups === "object" ? cloneJson(body.groups) : {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await putDocument(doc);
  await kvUpdate(MANIFEST_KEY, (current) => {
    const order = current && Array.isArray(current.order) ? current.order.filter((entry) => entry !== id) : [];
    return { version: 1, order: [id, ...order] };
  }, { version: 1, order: [] });
  // The summary, mirroring the desktop store: the editor reads only `id`, and a
  // document can be tens of MB.
  return summarize(doc);
};

const updateDocument = async (id, updates = {}) => {
  const existing = await idbGet(STORES.mapeditorDocs, id);
  if (!existing) throw new Error(`Map document not found: ${id}`);
  // The same difference the desktop store applies (server/regionDelta.js): the
  // editor sends only the regions that moved, and a difference that does not
  // agree with the stored map is refused rather than half-applied.
  const { regionsDelta, ...fields } = updates;
  let mergedRegions = null;
  let needsFullRegions = "";
  if (isRegionDelta(regionsDelta)) {
    const merged = applyRegionDelta(existing.regions, regionsDelta);
    if (merged.applied) mergedRegions = merged.regions;
    else needsFullRegions = merged.reason;
  }
  const next = {
    ...existing,
    ...fields,
    ...(mergedRegions ? { regions: mergedRegions } : {}),
    id,
    name: String(fields.name || fields.metadata?.name || existing.name || "Untitled Map"),
    metadata: { ...existing.metadata, ...(fields.metadata && typeof fields.metadata === "object" ? fields.metadata : {}) },
    updatedAt: nowIso(),
  };
  await putDocument(next);
  await kvUpdate(MANIFEST_KEY, (current) => {
    const order = current && Array.isArray(current.order) ? current.order : [];
    return order.includes(id) ? { version: 1, order } : { version: 1, order: [...order, id] };
  }, { version: 1, order: [id] });
  return needsFullRegions ? { ...summarize(next), needsFullRegions } : summarize(next);
};

const deleteDocument = async (id) => {
  await idbDeletePair(STORES.mapeditorDocs, STORES.mapeditorMeta, id);
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
