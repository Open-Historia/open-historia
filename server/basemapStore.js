/*!
 * Open Historia — basemap library store.
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Persistence for the user's basemap library ("Your basemaps" in the editor's
// basemap picker). Mirrors the mapEditorStore idioms and is fully self-contained.
// Each basemap is split into a light metadata file (listed in the picker — it
// carries a small thumbnail data URL) and a heavy payload file (the full image
// data URL or vector GeoJSON, fetched only when a basemap is applied). A
// content hash dedupes identical uploads (and later lets a scenario reference a
// community basemap instead of re-embedding it).

import crypto from "crypto";
import fs from "fs";
import path from "path";
import url from "url";
import { resolveChildPath } from "./security.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const BASEMAPS_DIR = path.join(DATA_DIR, "basemaps");
const MANIFEST_PATH = path.join(DATA_DIR, "basemaps-manifest.json");

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

const normalizeId = (raw, fallback = "basemap") => {
  const base = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || fallback;
};

// get/delete pass the raw route :id here (only create normalizes), so the
// shared containment guard keeps ..%2f..%2f from escaping BASEMAPS_DIR.
const metaPath = (id) => resolveChildPath(BASEMAPS_DIR, `${id}.json`, "basemap id");
const payloadPath = (id) => resolveChildPath(BASEMAPS_DIR, `${id}.payload.json`, "basemap id");

const getManifest = () => {
  const m = readJson(MANIFEST_PATH, null);
  return m && Array.isArray(m.order)
    ? { version: 1, order: m.order, byHash: m.byHash || {} }
    : { version: 1, order: [], byHash: {} };
};

const saveManifest = (manifest) => {
  writeJson(MANIFEST_PATH, {
    version: 1,
    order: Array.from(new Set(manifest.order ?? [])),
    byHash: manifest.byHash ?? {},
  });
};

const uniqueId = (desired) => {
  let id = desired;
  let n = 2;
  while (fs.existsSync(metaPath(id))) id = `${desired}-${n++}`;
  return id;
};

export const ensureBasemapStore = () => {
  ensureDir(BASEMAPS_DIR);
  if (!fs.existsSync(MANIFEST_PATH)) saveManifest({ order: [], byHash: {} });
};

// The catalog is the light metadata files in manifest order (no heavy payloads).
export const getBasemapCatalog = () => {
  const manifest = getManifest();
  return manifest.order.map((id) => readJson(metaPath(id), null)).filter(Boolean);
};

export const getBasemapMeta = (id) => readJson(metaPath(id), null);

export const getBasemapPayload = (id) => {
  const payload = readJson(payloadPath(id), null);
  if (!payload) throw new Error(`Basemap payload not found: ${id}`);
  return payload;
};

export const findBasemapIdByHash = (hash) => {
  if (!hash) return null;
  const manifest = getManifest();
  const id = manifest.byHash[hash];
  return id && fs.existsSync(metaPath(id)) ? id : null;
};

// Hash the payload so identical basemaps dedupe. Always compute it server-side:
// trusting a client-supplied hash (even shape-checked) let a caller store a
// basemap under an arbitrary hash and poison the dedup index, so a later
// genuine upload that hashed to the same value was silently discarded.
const hashPayload = (payload) => {
  const canonical = payload?.dataUrl ?? JSON.stringify(payload?.geojson ?? payload ?? null);
  return crypto.createHash("sha256").update(String(canonical)).digest("hex");
};

export const createBasemap = (body = {}) => {
  ensureBasemapStore();
  const kind = body.kind === "vector" ? "vector" : "image";
  const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
  if (!payload || (kind === "image" && !payload.dataUrl) || (kind === "vector" && !payload.geojson)) {
    throw new Error("Basemap payload missing (need { dataUrl } for image or { geojson } for vector).");
  }
  const contentHash = hashPayload(payload);

  // Dedup: an identical basemap already in the library is reused, not duplicated.
  const existingId = findBasemapIdByHash(contentHash);
  if (existingId) return getBasemapMeta(existingId);

  const now = new Date().toISOString();
  const name = String(body.name || "Custom basemap").trim().slice(0, 80) || "Custom basemap";
  const id = uniqueId(normalizeId(body.id || name));
  const meta = {
    id,
    name,
    kind,
    contentHash,
    aspect: Number(body.aspect) > 0 ? Number(body.aspect) : null,
    author: String(body.author || "").slice(0, 80),
    thumbnail: typeof body.thumbnail === "string" ? body.thumbnail : null,
    // A community basemap this was installed from (set later by the community
    // import flow) so re-publishing a scenario can reference it instead of re-upload.
    source: body.source && typeof body.source === "object" ? body.source : null,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(metaPath(id), meta);
  writeJson(payloadPath(id), kind === "image" ? { dataUrl: payload.dataUrl } : { geojson: payload.geojson });

  const manifest = getManifest();
  manifest.order = [id, ...manifest.order.filter((x) => x !== id)];
  manifest.byHash[contentHash] = id;
  saveManifest(manifest);
  return meta;
};

export const deleteBasemap = (id) => {
  const meta = getBasemapMeta(id);
  if (fs.existsSync(metaPath(id))) fs.rmSync(metaPath(id));
  if (fs.existsSync(payloadPath(id))) fs.rmSync(payloadPath(id));
  const manifest = getManifest();
  manifest.order = manifest.order.filter((x) => x !== id);
  if (meta?.contentHash && manifest.byHash[meta.contentHash] === id) delete manifest.byHash[meta.contentHash];
  saveManifest(manifest);
  return { id, deleted: true };
};
