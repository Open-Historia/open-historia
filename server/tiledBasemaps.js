/*!
 * Open Historia — tiled basemaps: streamed downloads, archive checks, install jobs.
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A Tiled Basemap is a PMTiles archive of raster map tiles, often hundreds of
// megabytes (docs/adr/0005-tiled-basemaps-stream-to-disk.md). Nothing here ever
// holds one in memory: a download is piped to a temporary file as it arrives and
// counted as it goes, so it is stopped the moment it passes its cap, and only a
// complete, checked file is moved into the library.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { PMTiles } from "pmtiles";

const STALL_MS = 60_000;

export class TooLargeError extends Error {
  constructor(cap) {
    super(`The file is too large (over ${Math.round(cap / (1024 * 1024))} MB).`);
    this.name = "TooLargeError";
    this.status = 413;
  }
}

// Pipes `streams` into `dest` through a temp file of its own (two writers of the
// same destination never share one), renamed into place only when complete and
// removed on any failure.
const writeToFile = async (streams, dest, signal) => {
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await pipeline(...streams, fs.createWriteStream(tmp), ...(signal ? [{ signal }] : []));
    fs.renameSync(tmp, dest);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
};

// Follows redirects by hand so every hop is re-checked (`isAllowed`), then pipes
// the body to `dest` through a byte counter. `fetchHop(url, signal)` makes one
// request with redirects off. On any failure the partial file is removed.
export const downloadToFile = async ({ url, dest, cap, isAllowed, fetchHop, onProgress, signal }) => {
  let current = new URL(url);
  let response;
  for (let hop = 0; ; hop += 1) {
    if (hop > 5) throw new Error("Too many redirects fetching the file.");
    response = await fetchHop(current, signal);
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, current);
    if (!isAllowed(next)) {
      response.body?.cancel?.().catch?.(() => {});
      throw Object.assign(new Error("The file redirected off GitHub."), { status: 400 });
    }
    current = next;
  }
  if (!response.ok) throw Object.assign(new Error(`Download failed (HTTP ${response.status}).`), { status: 502 });

  const declared = Number(response.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (total !== null && total > cap) {
    response.body?.cancel?.().catch?.(() => {});
    throw new TooLargeError(cap);
  }

  let received = 0;
  const counted = Readable.fromWeb(response.body);
  // A body that stops arriving is abandoned rather than waited on for ever (the
  // request's own timeout only covered the wait for its headers).
  let idle = null;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => counted.destroy(new Error("The download stalled.")), STALL_MS);
  };
  armIdle();
  counted.on("data", (chunk) => {
    armIdle();
    received += chunk.length;
    if (received > cap) counted.destroy(new TooLargeError(cap));
    else onProgress?.({ received, total });
  });
  counted.on("close", () => clearTimeout(idle));
  await writeToFile([counted], dest, signal);
  return { bytes: received, total, contentType: response.headers.get("content-type") || "application/octet-stream" };
};

// Pipes an incoming request body (an author's local archive) to `dest`, capped.
export const receiveToFile = async (req, dest, cap) => {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > cap) {
    req.resume();
    throw new TooLargeError(cap);
  }
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > cap) callback(new TooLargeError(cap));
      else callback(null, chunk);
    },
  });
  await writeToFile([req, counter], dest);
  return { bytes: received };
};

// SHA-256 of a file, read as a stream.
export const hashFile = async (file) => {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
};

// pmtiles' Source over a file on disk (range reads, never the whole file).
const MAX_READ_BYTES = 64 * 1024 * 1024;
const fileSource = (file) => ({
  getKey: () => file,
  getBytes: async (offset, length) => {
    const handle = await fs.promises.open(file, "r");
    try {
      const { size } = await handle.stat();
      if (!(offset >= 0) || offset > size || !(length >= 0) || length > MAX_READ_BYTES) {
        throw new Error("This PMTiles archive points outside itself.");
      }
      const buffer = Buffer.alloc(Math.min(length, size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const bytes = buffer.subarray(0, bytesRead);
      return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    } finally {
      await handle.close();
    }
  },
});

const RASTER_TILE_TYPES = new Map([[2, "png"], [3, "jpeg"], [4, "webp"], [5, "avif"]]);

// What a Tiled Basemap is, read from the archive itself: its zoom range, bounds
// and tile type. Throws a plain-language reason when the file is not a raster
// PMTiles archive, or its directory does not lead to a tile.
export const inspectTiledArchive = async (file) => {
  const handle = await fs.promises.open(file, "r");
  const magic = Buffer.alloc(8);
  try {
    await handle.read(magic, 0, 8, 0);
  } finally {
    await handle.close();
  }
  if (magic.subarray(0, 7).toString("latin1") !== "PMTiles") throw new Error("This file is not a PMTiles archive.");
  if (magic[7] !== 3) throw new Error(`This PMTiles archive is version ${magic[7]}; only version 3 is supported.`);

  const archive = new PMTiles(fileSource(file));
  let header;
  try {
    header = await archive.getHeader();
  } catch (error) {
    throw new Error(`This PMTiles archive could not be read (${error.message}).`);
  }
  const tileType = RASTER_TILE_TYPES.get(header.tileType);
  if (!tileType) throw new Error("This archive holds vector tiles; a Tiled Basemap needs raster tiles (PNG, JPEG, WebP or AVIF).");
  const { size } = fs.statSync(file);
  if (header.tileDataOffset + header.tileDataLength > size || header.rootDirectoryOffset + header.rootDirectoryLength > size) {
    throw new Error("This PMTiles archive is incomplete (it ends before its own tiles do).");
  }
  if (!(header.minZoom <= header.maxZoom)) throw new Error("This PMTiles archive has no valid zoom range.");

  // Probe: the tile covering the archive's centre at its lowest zoom must exist.
  const lon = (header.minLon + header.maxLon) / 2, lat = (header.minLat + header.maxLat) / 2;
  const z = header.minZoom;
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const rad = (lat * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)));
  let probe = null;
  try {
    probe = await archive.getZxy(z, x, y);
  } catch (error) {
    throw new Error(`This PMTiles archive's directory could not be read (${error.message}).`);
  }
  if (!probe?.data?.byteLength) throw new Error("This PMTiles archive has no tile where its own bounds say it should.");

  const round = (v) => Math.round(v * 1e6) / 1e6;
  return {
    tileType,
    minzoom: header.minZoom,
    maxzoom: header.maxZoom,
    bounds: [round(header.minLon), round(header.minLat), round(header.maxLon), round(header.maxLat)],
  };
};

// ---- Install jobs --------------------------------------------------------
// One per download. Polled for progress; cancellable; kept for a while after it
// ends so the client can read the outcome.
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

// `key`: the same download asked for again while it runs (two scenarios on one
// map, installed one after the other) joins the running job instead of
// fetching the file twice.
export const startInstallJob = ({ run, key = null }) => {
  if (key) {
    for (const job of jobs.values()) if (job.key === key && job.status === "running") return job.id;
  }
  const id = crypto.randomUUID();
  const controller = new AbortController();
  const job = { id, key, status: "running", received: 0, total: null, error: null, basemap: null, controller, endedAt: 0 };
  jobs.set(id, job);
  (async () => {
    try {
      job.basemap = await run({
        signal: controller.signal,
        onProgress: ({ received, total }) => {
          job.received = received;
          if (total) job.total = total;
        },
      });
      job.status = "done";
    } catch (error) {
      if (controller.signal.aborted) job.status = "cancelled";
      else {
        job.status = "failed";
        job.error = error?.message || String(error);
      }
    } finally {
      job.endedAt = Date.now();
      for (const [key, old] of jobs) if (old.endedAt && Date.now() - old.endedAt > JOB_TTL_MS) jobs.delete(key);
    }
  })();
  return id;
};

export const getInstallJob = (id) => {
  const job = jobs.get(id);
  if (!job) return null;
  const { controller: _controller, endedAt: _endedAt, key: _key, ...visible } = job;
  return visible;
};

export const cancelInstallJob = (id) => {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "running") job.controller.abort();
  return getInstallJob(id);
};
