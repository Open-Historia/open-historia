/*! Open Historia — the community download cache © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// /api/hub/file (server.js) keeps every community file it fetches — scenario
// bundles, basemaps, flag images and packs — under DATA_DIR/hub-cache, so
// opening the same one again is served from disk and never bumps its GitHub
// download count. Bundle URLs are immutable (a new version gets a new URL), so
// a cached copy cannot go stale; it can only go unused.
//
// Each entry is <sha256 of the URL>.body with a .type beside it holding the
// content type. A download in progress is a .tmp file of its own.
import fs from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

// About five of the largest bundles the hub accepts (200 MB). Past it, the
// entries used longest ago go first.
export const HUB_CACHE_MAX_BYTES = 1024 * 1024 * 1024;

export const tooLargeError = () => Object.assign(new Error("Scenario bundle is too large."), { status: 413 });

// Writes a download's body (a web ReadableStream, as fetch gives it) straight
// to `destination`, counting as it goes, and fails with a 413 error the moment
// it passes `maxBytes`. It used to be read whole with arrayBuffer() and
// measured afterwards, so a post linking a release asset of a gigabyte or two
// held all of it in the app's main process before refusing it. Nothing is left
// behind on failure.
export const saveCappedBody = async (body, destination, maxBytes) => {
  let received = 0;
  const capped = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      done(received > maxBytes ? tooLargeError() : null, chunk);
    },
  });
  try {
    await pipeline(body ? Readable.fromWeb(body) : Readable.from([]), capped, fs.createWriteStream(destination));
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
  return received;
};

const entries = (dir) => {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const filePath = path.join(dir, name);
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile() ? [{ name, filePath, size: stats.size, usedAt: stats.mtimeMs }] : [];
    } catch {
      return [];
    }
  });
};

const typePathFor = (bodyPath) => bodyPath.replace(/\.body$/, ".type");

// Marks an entry as just used, so the size cap removes it last.
export const touchEntry = (bodyPath) => {
  try {
    const now = new Date();
    fs.utimesSync(bodyPath, now, now);
  } catch { /* a cache hint, nothing more */ }
};

// What the cache holds: its entries and their total size on disk.
export const hubCacheUsage = (dir) => {
  const bodies = entries(dir).filter((entry) => entry.name.endsWith(".body"));
  return { files: bodies.length, bytes: bodies.reduce((total, entry) => total + entry.size, 0) };
};

// Removes the entries used longest ago until the cache fits in `maxBytes`,
// never `keep` (the one just written or served). An entry another request is
// still reading cannot be removed on Windows; it is skipped and goes next time.
export const pruneHubCache = (dir, maxBytes = HUB_CACHE_MAX_BYTES, { keep = "" } = {}) => {
  const bodies = entries(dir).filter((entry) => entry.name.endsWith(".body"));
  let total = bodies.reduce((sum, entry) => sum + entry.size, 0);
  const removed = [];
  for (const entry of bodies.sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= maxBytes) break;
    if (entry.filePath === keep) continue;
    try {
      fs.rmSync(entry.filePath);
      fs.rmSync(typePathFor(entry.filePath), { force: true });
      total -= entry.size;
      removed.push(entry.name);
    } catch { /* in use; next time */ }
  }
  return removed;
};

// At startup: downloads a crash or a quit cut short, and .type files whose body
// is gone, then the size cap. It runs as the server starts, so a file it cannot
// remove (held open by a virus scanner, say) is left for next time rather than
// stopping the server.
export const sweepHubCache = (dir, maxBytes = HUB_CACHE_MAX_BYTES) => {
  const all = entries(dir);
  const bodies = new Set(all.filter((entry) => entry.name.endsWith(".body")).map((entry) => entry.filePath));
  for (const entry of all) {
    const leftover = entry.name.endsWith(".tmp")
      || (entry.name.endsWith(".type") && !bodies.has(entry.filePath.replace(/\.type$/, ".body")));
    if (!leftover) continue;
    try {
      fs.rmSync(entry.filePath, { force: true });
    } catch { /* in use; next time */ }
  }
  return pruneHubCache(dir, maxBytes);
};

// Settings → Storage → "Clear download cache". Downloads still in progress are
// left alone; so is anything another request is reading right now.
export const clearHubCache = (dir) => {
  let freed = 0;
  for (const entry of entries(dir)) {
    if (entry.name.endsWith(".tmp")) continue;
    try {
      fs.rmSync(entry.filePath);
      if (entry.name.endsWith(".body")) freed += entry.size;
    } catch { /* in use */ }
  }
  return { ...hubCacheUsage(dir), freed };
};
