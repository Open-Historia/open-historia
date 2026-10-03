/*!
 * Open Historia — basemap library store.
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
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
import { hashFile, inspectTiledArchive } from "./tiledBasemaps.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
import { DATA_DIR } from "./dataDir.js";
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
// A Tiled Basemap's archive: the PMTiles file itself, never read whole.
const archivePath = (id) => resolveChildPath(BASEMAPS_DIR, `${id}.pmtiles`, "basemap id");

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

// Downloads a crash or restart cut short: nothing is ever mid-download when the
// server starts, so every temp or unregistered incoming archive is a leftover.
// So is an archive whose entry is gone (an older version of an official map,
// replaced while the map still had it open).
export const clearInterruptedDownloads = () => {
  if (!fs.existsSync(BASEMAPS_DIR)) return;
  for (const name of fs.readdirSync(BASEMAPS_DIR)) {
    const orphan = name.endsWith(".pmtiles") && !fs.existsSync(path.join(BASEMAPS_DIR, `${name.slice(0, -".pmtiles".length)}.json`));
    if (name.startsWith(".incoming-") || orphan) fs.rmSync(path.join(BASEMAPS_DIR, name), { force: true });
  }
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

const requireTiledMeta = (id) => {
  const meta = getBasemapMeta(id);
  if (meta?.kind !== "tiled") throw new Error(`Tiled basemap not found: ${id}`);
  return meta;
};

// A new entry goes first in the library, findable by its content hash.
const addToManifest = (id, contentHash) => {
  const manifest = getManifest();
  manifest.order = [id, ...manifest.order.filter((x) => x !== id)];
  manifest.byHash[contentHash] = id;
  saveManifest(manifest);
};

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

// Where a download or upload lands before it is checked: inside the library's
// own folder, so moving a finished archive into place is a rename, not a copy.
export const incomingArchivePath = () => {
  ensureBasemapStore();
  return path.join(BASEMAPS_DIR, `.incoming-${crypto.randomUUID()}.pmtiles`);
};

export const findBasemapMetaByHash = (hash) => {
  const id = findBasemapIdByHash(hash);
  return id ? getBasemapMeta(id) : null;
};

// The archive of a Tiled Basemap, for serving by byte range.
export const getBasemapArchivePath = (id) => {
  requireTiledMeta(id);
  const file = archivePath(id);
  if (!fs.existsSync(file)) throw new Error(`Tiled basemap not found: ${id}`);
  return file;
};

// Registers a checked archive (already on disk at `file`, inside the library
// folder) as a Tiled Basemap. The archive is inspected first; a file that is not
// a raster PMTiles archive is deleted and refused. An archive already in the
// library (same bytes) is not stored twice. `expectedHash`: the checksum the
// official list gives for this version; a file with other contents is refused
// (the release was replaced, or the link is wrong). `official`: { id, version }
// for a map from the official list (docs/adr/0006-official-basemap-list.md);
// installing a version replaces every other version of that map, so the
// library only ever holds one copy. `signal`: a cancel that lands while the
// archive is checked still leaves nothing installed.
export const createTiledBasemap = async ({ file, name, author, thumbnail, source, expectedHash, official, signal } = {}) => {
  ensureBasemapStore();
  let info;
  let contentHash;
  try {
    info = await inspectTiledArchive(file);
    contentHash = await hashFile(file);
    if (expectedHash && contentHash !== expectedHash) {
      throw new Error("This file is not the map it should be (its contents differ from the official list's). The release may have been replaced; tell the Open Historia team.");
    }
    if (signal?.aborted) throw new Error("Cancelled.");
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  // The same bytes already in the library (not a newer version standing in for
  // them: that is another file).
  const existingId = findBasemapIdByHash(contentHash);
  if (existingId && getBasemapMeta(existingId)?.contentHash === contentHash) {
    fs.rmSync(file, { force: true });
    const existing = getBasemapMeta(existingId);
    if (!official || existing?.kind !== "tiled") return existing;
    writeJson(metaPath(existingId), { ...existing, official: cleanOfficial(official), updatedAt: new Date().toISOString() });
    return retireOtherOfficialVersions(existingId);
  }
  const now = new Date().toISOString();
  const cleanName = String(name || "Tiled basemap").trim().slice(0, 80) || "Tiled basemap";
  const id = uniqueId(normalizeId(official ? `${official.id}-v${official.version}` : cleanName));
  fs.renameSync(file, archivePath(id));
  const meta = {
    id,
    name: cleanName,
    kind: "tiled",
    contentHash,
    bytes: fs.statSync(archivePath(id)).size,
    tileType: info.tileType,
    minzoom: info.minzoom,
    maxzoom: info.maxzoom,
    bounds: info.bounds,
    aspect: null,
    author: String(author || "").slice(0, 80),
    thumbnail: typeof thumbnail === "string" ? thumbnail : null,
    source: source && typeof source === "object" ? source : null,
    ...(official ? { official: cleanOfficial(official) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  writeJson(metaPath(id), meta);
  addToManifest(id, contentHash);
  return official ? retireOtherOfficialVersions(id) : meta;
};

const cleanOfficial = (official) => ({ id: String(official.id), version: Number(official.version) });

const listTiledMetas = () => getBasemapCatalog().filter((meta) => meta.kind === "tiled");

// The copy of an official map the player has, or null. There is only ever one
// (installing a version replaces the others), but the newest wins if not.
export const findOfficialBasemapMeta = (officialId) => listTiledMetas()
  .filter((meta) => meta.official?.id === officialId)
  .sort((a, b) => b.official.version - a.official.version)[0] || null;

// Keeps `keepId` as the only copy of its official map. Each other version's
// entry and archive go, and its checksum now finds the kept one, so a scenario
// that named the older file by checksum is drawn on the newer version rather
// than shown as missing. An archive the map still has open, if it cannot go
// now, is removed at the next start (clearInterruptedDownloads).
const retireOtherOfficialVersions = (keepId) => {
  const kept = getBasemapMeta(keepId);
  const officialId = kept?.official?.id;
  if (!officialId) return kept;
  const supersedes = new Set(kept.supersedes || []);
  const manifest = getManifest();
  for (const other of listTiledMetas()) {
    if (other.id === keepId || other.official?.id !== officialId) continue;
    for (const hash of [other.contentHash, ...(other.supersedes || [])]) {
      if (!hash) continue;
      supersedes.add(hash);
      manifest.byHash[hash] = keepId;
    }
    manifest.order = manifest.order.filter((x) => x !== other.id);
    fs.rmSync(metaPath(other.id), { force: true });
    fs.rmSync(payloadPath(other.id), { force: true });
    try { fs.rmSync(archivePath(other.id), { force: true }); } catch { /* removed at the next start */ }
  }
  supersedes.delete(kept.contentHash);
  saveManifest(manifest);
  const { supersedes: _previous, ...rest } = kept;
  const next = { ...rest, ...(supersedes.size ? { supersedes: [...supersedes] } : {}) };
  writeJson(metaPath(keepId), next);
  return next;
};

// Marks the library's copies of official maps as such: one installed or added
// from a file before it was on the official list, byte for byte one of the
// list's versions, becomes that version, so it is never downloaded again.
export const tagOfficialBasemaps = (catalog) => {
  const byHash = new Map();
  for (const entry of catalog?.basemaps || []) {
    for (const version of entry.versions) byHash.set(version.sha256, { id: entry.id, version: version.version });
  }
  for (const meta of listTiledMetas()) {
    const match = byHash.get(meta.contentHash);
    if (!match || (meta.official?.id === match.id && meta.official.version === match.version)) continue;
    writeJson(metaPath(meta.id), { ...meta, official: match, updatedAt: new Date().toISOString() });
  }
};

// A Tiled Basemap's vector fallback: drawn while its archive is missing or
// loading. Small GeoJSON, stored like a vector Basemap's payload.
export const setTiledBasemapFallback = (id, geojson) => {
  const meta = requireTiledMeta(id);
  if (!geojson || typeof geojson !== "object" || !Array.isArray(geojson.features)) {
    throw new Error("A fallback must be a GeoJSON FeatureCollection.");
  }
  writeJson(payloadPath(id), { geojson });
  writeJson(metaPath(id), { ...meta, hasFallback: true, updatedAt: new Date().toISOString() });
  return getBasemapMeta(id);
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
  addToManifest(id, contentHash);
  return meta;
};

export const deleteBasemap = (id) => {
  const meta = getBasemapMeta(id);
  if (fs.existsSync(metaPath(id))) fs.rmSync(metaPath(id));
  if (fs.existsSync(payloadPath(id))) fs.rmSync(payloadPath(id));
  if (fs.existsSync(archivePath(id))) fs.rmSync(archivePath(id));
  const manifest = getManifest();
  manifest.order = manifest.order.filter((x) => x !== id);
  for (const [hash, holder] of Object.entries(manifest.byHash)) if (holder === id) delete manifest.byHash[hash];
  saveManifest(manifest);
  return { id, deleted: true };
};
