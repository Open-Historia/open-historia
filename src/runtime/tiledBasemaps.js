/*! Open Historia — tiled basemaps client © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Finds, installs and tracks Tiled Basemaps in the player's library
// (docs/adr/0005-tiled-basemaps-stream-to-disk.md). The game server does the
// work: it streams the archive to disk and checks it. This only starts that job,
// follows its progress, and tells the map when a Basemap has arrived so a
// scenario waiting for it can switch from its painted fallback to the relief.

import { PMTiles } from "pmtiles";
import { runtimeAbsoluteUrl } from "./assets.js";

const API = "/api/basemaps";

// The library entry for a content hash, or null when the player does not have it.
export const findTiledBasemap = async (hash) => {
  if (!hash) return null;
  try {
    const response = await fetch(`${API}/by-hash/${encodeURIComponent(hash)}`, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

// Where the map reads a Tiled Basemap's archive (by byte range).
export const tiledBasemapArchiveUrl = (id) => runtimeAbsoluteUrl(`${API}/${encodeURIComponent(id)}/archive`);

const readError = async (response) => {
  try {
    return (await response.json())?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

// Starts an install from a GitHub release link; resolves to the job id.
// `expectedHash`: the map a scenario or hub post names; the server refuses a
// download with other contents.
export const startTiledBasemapInstall = async ({ url, name, source, expectedHash } = {}) => {
  const response = await fetch(`${API}/tiled/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, name, source, ...(/^[a-f0-9]{64}$/.test(String(expectedHash || "")) ? { expectedHash } : {}) }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()).jobId;
};

export const getTiledBasemapInstall = async (jobId) => {
  const response = await fetch(`${API}/tiled/install/${encodeURIComponent(jobId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
};

export const cancelTiledBasemapInstall = async (jobId) => {
  await fetch(`${API}/tiled/install/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => {});
};

// Adds an author's own archive from a file on their machine. The file is sent as
// the request body and streamed to disk by the server; it is never read here.
export const uploadTiledBasemap = async (file, { name } = {}) => {
  const response = await fetch(`${API}/tiled?name=${encodeURIComponent(name || file?.name || "Tiled basemap")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
};

export const setTiledBasemapFallback = async (id, geojson) => {
  const response = await fetch(`${API}/${encodeURIComponent(id)}/payload`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geojson }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
};

// Runs an install to the end, reporting progress; resolves to the new library
// entry. `signal` cancels the download on the server too.
export const installTiledBasemap = async ({ url, name, source, expectedHash, onProgress, signal, pollMs = 500 } = {}) => {
  const jobId = await startTiledBasemapInstall({ url, name, source, expectedHash });
  const cancel = () => cancelTiledBasemapInstall(jobId);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const job = await getTiledBasemapInstall(jobId);
      onProgress?.({ received: job.received || 0, total: job.total || null });
      if (job.status === "done") {
        announceTiledBasemap(job.basemap);
        return job.basemap;
      }
      if (job.status === "failed") throw new Error(job.error || "The download failed.");
      if (job.status === "cancelled") throw Object.assign(new Error("Cancelled."), { name: "AbortError" });
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
};

// Where a Tiled Basemap is published (its release download link, and the
// optional preview picture's).
export const setTiledBasemapSource = async (id, payloadUrl, previewUrl) => {
  const response = await fetch(`${API}/${encodeURIComponent(id)}/source`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payloadUrl, ...(previewUrl ? { previewUrl } : {}) }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
};

// The scenarios that name a Tiled Basemap ([{ id, name }]).
export const listTiledBasemapUsers = async (id) => {
  try {
    const response = await fetch(`${API}/${encodeURIComponent(id)}/users`);
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
};

// Tells the map a Basemap has arrived (or gone), so a scenario naming it redraws.
const listeners = new Set();
export const subscribeTiledBasemaps = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const announceTiledBasemap = (meta) => {
  for (const listener of listeners) listener(meta || null);
};

export const formatBytes = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};

// A preview picture of a Tiled Basemap: its lowest zoom, the tiles covering its
// bounds stitched together (at most 4×4, from the middle), as a PNG Blob. The
// author attaches it to the map's release, where the hub shows it as the card.
const TILE_MIME = { 2: "image/png", 3: "image/jpeg", 4: "image/webp", 5: "image/avif" };
const PREVIEW_MAX_TILES = 4;
const PREVIEW_MAX_WIDTH = 1024;
const tileX = (lon, n) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
const tileY = (lat, n) => {
  const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)));
};
const middleSpan = (from, to) => {
  const count = Math.min(PREVIEW_MAX_TILES, to - from + 1);
  const start = from + Math.floor((to - from + 1 - count) / 2);
  return Array.from({ length: count }, (_, i) => start + i);
};

export const renderTiledBasemapPreview = async (id) => {
  const archive = new PMTiles(tiledBasemapArchiveUrl(id));
  const header = await archive.getHeader();
  const mime = TILE_MIME[header.tileType];
  if (!mime) throw new Error("This map's tiles are not pictures.");
  const z = header.minZoom;
  const n = 2 ** z;
  const xs = middleSpan(tileX(header.minLon, n), tileX(header.maxLon, n));
  const ys = middleSpan(tileY(header.maxLat, n), tileY(header.minLat, n));
  const tiles = await Promise.all(ys.flatMap((y, row) => xs.map(async (x, col) => {
    const tile = await archive.getZxy(z, x, y).catch(() => null);
    if (!tile?.data?.byteLength) return null;
    const bitmap = await createImageBitmap(new Blob([tile.data], { type: mime })).catch(() => null);
    return bitmap && { bitmap, row, col };
  })));
  const drawn = tiles.filter(Boolean);
  if (!drawn.length) throw new Error("This map has no tiles at its lowest zoom.");
  const size = drawn[0].bitmap.width;
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / (size * xs.length));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size * xs.length * scale);
  canvas.height = Math.round(size * ys.length * scale);
  const context = canvas.getContext("2d");
  for (const { bitmap, row, col } of drawn) {
    context.drawImage(bitmap, col * size * scale, row * size * scale, size * scale, size * scale);
    bitmap.close?.();
  }
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("The preview could not be drawn."))),
    "image/png",
  ));
};
