/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Persistence for map-editor documents (the maps authored in /?editor=1).
// Mirrors the scenario-store idioms in libraryStore.js but is fully self-contained
// so libraryStore stays untouched. Each document is a single JSON file under
// server/data/mapeditor-documents/, tracked by server/data/mapeditor-manifest.json.

import fs from "fs";
import path from "path";
import url from "url";
import { resolveChildPath } from "./security.js";
import { applyRegionDelta, isRegionDelta } from "./regionDelta.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
import { DATA_DIR } from "./dataDir.js";
const DOCS_DIR = path.join(DATA_DIR, "mapeditor-documents");
const MANIFEST_PATH = path.join(DATA_DIR, "mapeditor-manifest.json");

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const readJson = (target, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return fallback;
  }
};

const writeJson = (target, value) => {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(value));
};

const normalizeId = (raw, fallback = "map") => {
  const base = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || fallback;
};

// Read/update/delete pass the raw route :id here (only create normalizes), so
// the shared containment guard keeps ..%2f..%2f from escaping DOCS_DIR.
const docPath = (id) => resolveChildPath(DOCS_DIR, `${id}.json`, "map id");

const getManifest = () => {
  const m = readJson(MANIFEST_PATH, null);
  return m && Array.isArray(m.order) ? { version: 1, order: m.order } : { version: 1, order: [] };
};

const saveManifest = (manifest) => {
  writeJson(MANIFEST_PATH, { version: 1, order: Array.from(new Set(manifest.order ?? [])) });
};

const uniqueId = (desired) => {
  let id = desired;
  let n = 2;
  while (fs.existsSync(docPath(id))) id = `${desired}-${n++}`;
  return id;
};

export const ensureMapEditorStore = () => {
  ensureDir(DOCS_DIR);
  if (!fs.existsSync(MANIFEST_PATH)) saveManifest({ order: [] });
};

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

// The catalog used to JSON.parse every document to read eight fields off it.
// One shipped map is 54 MB, so opening the documents menu blocked the server for
// seconds. Keep a summary beside each document instead, stamped on the source's
// size and mtime so an externally edited file regenerates it.
const summaryPath = (id) => `${docPath(id)}.summary.json`;

const docStamp = (target) => {
  const stat = fs.statSync(target);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
};

const writeSummary = (id, doc) => {
  try {
    writeJson(summaryPath(id), { stamp: docStamp(docPath(id)), summary: summarize(doc) });
  } catch {
    // Best effort: a missing summary costs a reparse, never correctness.
  }
};

const readSummary = (id) => {
  const target = docPath(id);
  if (!fs.existsSync(target)) return null;
  let stamp = "";
  try {
    stamp = docStamp(target);
  } catch {
    return null;
  }
  const cached = readJson(summaryPath(id), null);
  if (cached?.stamp === stamp && cached.summary) return cached.summary;

  // Cold or stale: pay the parse once, then leave the summary behind.
  const doc = readJson(target, null);
  if (!doc) return null;
  const summary = summarize(doc);
  try {
    writeJson(summaryPath(id), { stamp, summary });
  } catch {
    // As above.
  }
  return summary;
};

export const getMapEditorCatalog = () => {
  const manifest = getManifest();
  return manifest.order.map((id) => readSummary(id)).filter(Boolean);
};

export const getMapEditorDocument = (id) => {
  const doc = readJson(docPath(id), null);
  if (!doc) throw new Error(`Map document not found: ${id}`);
  return doc;
};

export const createMapEditorDocument = (body = {}) => {
  ensureMapEditorStore();
  const now = new Date().toISOString();
  const name = String(body.name || body.metadata?.name || "Untitled Map").trim() || "Untitled Map";
  const id = uniqueId(normalizeId(body.id || name));
  const doc = {
    id,
    name,
    version: 1,
    metadata: { ...(body.metadata || {}), name },
    types: body.types || [],
    regions: body.regions || { type: "FeatureCollection", features: [] },
    features: body.features || [],
    // The map-maker's own palette and flags. Listed explicitly because this record
    // is built field by field — anything not named here is dropped on create, with
    // no error, and only shows up as "my colours vanished when I reopened the map".
    colorOverrides: body.colorOverrides || {},
    flags: body.flags || {},
    // The rest of what the Workshop saves, as the website's store keeps it
    // (src/runtime/web/editorStore.js); the first save of a map creates it.
    ownerSchema: Number(body.ownerSchema || 1),
    tags: body.tags || {},
    polities: body.polities || {},
    units: Array.isArray(body.units) ? body.units : [],
    groups: body.groups && typeof body.groups === "object" ? body.groups : {},
    createdAt: now,
    updatedAt: now,
  };
  writeJson(docPath(id), doc);
  writeSummary(id, doc);
  const manifest = getManifest();
  manifest.order = [id, ...manifest.order.filter((x) => x !== id)];
  saveManifest(manifest);
  // The summary, not the document: echoing it back stringified the same 54 MB a
  // third time for a caller that reads `id`.
  return summarize(doc);
};

export const updateMapEditorDocument = (id, updates = {}) => {
  const existing = getMapEditorDocument(id);
  // A save may carry only the regions that moved (server/regionDelta.js). It is
  // applied against what is on disk and refused whole when the two do not agree
  // about the map, in which case the stored geometry is left exactly as it was
  // and the editor is told to send the lot.
  const { regionsDelta, ...fields } = updates;
  let mergedRegions = null;
  let needsFullRegions = "";
  if (isRegionDelta(regionsDelta)) {
    const merged = applyRegionDelta(existing.regions, regionsDelta);
    if (merged.applied) mergedRegions = merged.regions;
    else needsFullRegions = merged.reason;
  }
  const doc = {
    ...existing,
    ...fields,
    ...(mergedRegions ? { regions: mergedRegions } : {}),
    id,
    name: String(fields.name || fields.metadata?.name || existing.name).trim() || existing.name,
    metadata: { ...existing.metadata, ...(fields.metadata || {}) },
    updatedAt: new Date().toISOString(),
  };
  writeJson(docPath(id), doc);
  writeSummary(id, doc);
  const manifest = getManifest();
  if (!manifest.order.includes(id)) {
    manifest.order = [id, ...manifest.order];
    saveManifest(manifest);
  }
  return needsFullRegions ? { ...summarize(doc), needsFullRegions } : summarize(doc);
};

export const deleteMapEditorDocument = (id) => {
  if (fs.existsSync(docPath(id))) fs.rmSync(docPath(id));
  if (fs.existsSync(summaryPath(id))) fs.rmSync(summaryPath(id));
  const manifest = getManifest();
  manifest.order = manifest.order.filter((x) => x !== id);
  saveManifest(manifest);
  return { id, deleted: true };
};
