/*! Open Historia — the music kept on this machine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A hub track a scenario plays is downloaded once and kept under DATA_DIR/music
// by what it is, <sha256>.mp3 or <sha256>.ogg, with one index.json beside the
// files (keptMusic.js: the record, and why it is kept by sha256). Every later
// play, from any scenario, is served from here with no request to the hub.
//
// It is the server's own folder and not the hub cache (hubCache.js): that one
// is capped as a whole and drops what was used longest ago, so a few scenario
// bundles would throw the songs away. It is not keyed by address either: the
// same recording listed twice, or moved to another release, is one file.
//
// GET /api/music/:sha256 (server.js) asks keep() for a track and streams what
// it answers with, byte ranges and all, so an <audio> can seek and start at
// once. A track not kept yet is downloaded to a temporary name, its sha256 is
// compared with the one asked for, and only then is it moved into place: a
// wrong file or a failed download leaves nothing behind. Two requests for the
// same missing track share one download.
//
// The limit is 1 GB, the tracks played longest ago going first; and the kept
// music follows the scenarios that use it (sweepMusicLibrary, called by
// libraryStore.js when a scenario is deleted or stops naming a track).
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { DATA_DIR } from "./dataDir.js";
import { hubReleaseUrl } from "./hubProvenance.js";
import {
  MUSIC_CONTENT_TYPES,
  MUSIC_TRACK_MAX_BYTES,
  keptMusicOverLimit,
  keptMusicUnused,
  keptMusicUsage,
  musicSha256,
  musicTypeOfBytes,
  normalizeKeptMusic,
  withKeptPlay,
} from "./keptMusic.js";

export const MUSIC_LIBRARY_DIR = path.join(DATA_DIR, "music");
export const MUSIC_LIBRARY_MAX_BYTES = 1024 * 1024 * 1024;

const INDEX_FILE = "index.json";
const TRACK_FILE = /^([0-9a-f]{64})\.(mp3|ogg)$/;
// One play of a track is several requests (an <audio> asks for ranges): the
// index is not rewritten for each of them.
const PLAYED_AGAIN_MS = 60_000;

const failure = (status, message) => Object.assign(new Error(message), { status });

const indexPathOf = (dir) => path.join(dir, INDEX_FILE);
const trackPathOf = (dir, sha256, type) => path.join(dir, `${sha256}.${type}`);

const readIndex = (dir) => {
  try {
    return normalizeKeptMusic(JSON.parse(fs.readFileSync(indexPathOf(dir), "utf8")));
  } catch {
    return {};
  }
};

// Written beside itself and renamed, so a crash never leaves half an index.
const writeIndex = (dir, index) => {
  fs.mkdirSync(dir, { recursive: true });
  const temporary = `${indexPathOf(dir)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(index));
  fs.renameSync(temporary, indexPathOf(dir));
};

const removeTrack = (dir, sha256, type) => {
  try {
    fs.rmSync(trackPathOf(dir, sha256, type), { force: true });
    return true;
  } catch {
    // Being played (Windows will not remove an open file): it goes next time.
    return false;
  }
};

// Drops `doomed` from the index and from the disk, and writes the index if
// anything went. A file that could not be removed keeps its entry.
const drop = (dir, index, doomed) => {
  const removed = [];
  const next = { ...index };
  for (const sha256 of doomed) {
    const entry = next[sha256];
    if (!entry || !removeTrack(dir, sha256, entry.type)) continue;
    delete next[sha256];
    removed.push(sha256);
  }
  if (removed.length) writeIndex(dir, next);
  return { index: next, removed };
};

const sha256OfFile = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash("sha256");
  fs.createReadStream(filePath)
    .on("error", reject)
    .on("data", (chunk) => hash.update(chunk))
    .on("end", () => resolve(hash.digest("hex")));
});

const firstBytesOf = (filePath, count = 4) => {
  const handle = fs.openSync(filePath, "r");
  try {
    const bytes = Buffer.alloc(count);
    return bytes.subarray(0, fs.readSync(handle, bytes, 0, count, 0));
  } finally {
    fs.closeSync(handle);
  }
};

// What the library holds: { tracks, bytes }.
export const musicLibraryUsage = (dir = MUSIC_LIBRARY_DIR) => keptMusicUsage(readIndex(dir));

// Settings → General → Sound → Clear: every kept track goes, and is
// downloaded again when a scenario plays it. A download in progress is left
// alone; a track being played right now stays until the next clear.
export const clearMusicLibrary = (dir = MUSIC_LIBRARY_DIR) => {
  const index = readIndex(dir);
  const { index: left } = drop(dir, index, Object.keys(index));
  return keptMusicUsage(left);
};

// The kept music follows the scenarios that use it: every kept file that was
// a game's and that none of the track ids in `used` names any more is deleted
// (keptMusic.js keptMusicUnused). Returns the sha256 of what went.
export const sweepMusicLibrary = (used, dir = MUSIC_LIBRARY_DIR) => {
  const index = readIndex(dir);
  const doomed = keptMusicUnused(index, used);
  return doomed.length ? drop(dir, index, doomed).removed : [];
};

// At startup: downloads a crash or a quit cut short go, the index is made to
// agree with the folder (an entry whose file is gone is forgotten; a track
// file with no entry is taken in as nobody's, left to the limit), and the
// limit is applied. It runs as the server starts, so a file it cannot remove
// is left for next time rather than stopping the server.
export const tidyMusicLibrary = (dir = MUSIC_LIBRARY_DIR, maxBytes = MUSIC_LIBRARY_MAX_BYTES) => {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const index = readIndex(dir);
  const next = {};
  for (const name of names) {
    const filePath = path.join(dir, name);
    if (name.endsWith(".tmp")) {
      try { fs.rmSync(filePath, { force: true }); } catch { /* in use; next time */ }
      continue;
    }
    const match = TRACK_FILE.exec(name);
    if (!match) continue;
    try {
      const stats = fs.statSync(filePath);
      const known = index[match[1]];
      next[match[1]] = known?.type === match[2]
        ? { ...known, bytes: stats.size }
        : { type: match[2], bytes: stats.size, playedAt: Math.round(stats.mtimeMs), ids: [], previewed: false };
    } catch { /* gone meanwhile */ }
  }
  if (JSON.stringify(next) !== JSON.stringify(index)) writeIndex(dir, next);
  return drop(dir, next, keptMusicOverLimit(next, maxBytes)).removed;
};

// The keeper the route asks. `download(url, destination, maxBytes)` fetches a
// hub file to `destination` and fails rather than write more than `maxBytes`
// (server.js gives it the same guarded download /api/hub/file uses; a test
// gives it a stand-in).
export const createMusicLibrary = ({
  dir = MUSIC_LIBRARY_DIR,
  download,
  maxBytes = MUSIC_LIBRARY_MAX_BYTES,
  now = () => Date.now(),
}) => {
  // The downloads under way, by sha256: a second request for the same missing
  // track waits for the first one's.
  const pending = new Map();

  const kept = (sha256) => {
    const entry = readIndex(dir)[sha256];
    if (!entry) return null;
    const filePath = trackPathOf(dir, sha256, entry.type);
    return fs.existsSync(filePath) ? { entry, filePath } : null;
  };

  // Writes down that the track was asked for: played now, and under which id.
  const note = (sha256, { type, bytes, trackId, preview }) => {
    const index = readIndex(dir);
    const before = index[sha256];
    const next = withKeptPlay(index, sha256, { type, bytes, trackId, preview, at: now() });
    const after = next[sha256];
    const told = !before
      || after.ids.length !== before.ids.length
      || after.previewed !== before.previewed
      || after.playedAt - before.playedAt >= PLAYED_AGAIN_MS;
    if (told) writeIndex(dir, next);
    return told ? next : index;
  };

  const fetchTrack = async (sha256, url) => {
    fs.mkdirSync(dir, { recursive: true });
    const temporary = path.join(dir, `${sha256}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const bytes = await download(url, temporary, MUSIC_TRACK_MAX_BYTES);
      const actual = await sha256OfFile(temporary);
      if (actual !== sha256) throw failure(502, "The downloaded track is not the one that was asked for.");
      const type = musicTypeOfBytes(firstBytesOf(temporary));
      if (!type) throw failure(502, "The downloaded track is empty.");
      fs.renameSync(temporary, trackPathOf(dir, sha256, type));
      return { type, bytes };
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  };

  // The kept copy of a track, downloaded first if it is not here yet:
  // { filePath, contentType, bytes, downloaded }. `url` is the track's file in
  // the hub's own releases (anything else is refused before any request);
  // `trackId` is the hub track it is asked for as, and `preview` says the
  // scenario editor is only trying it out.
  const keep = async ({ sha256: wanted, url = "", trackId = "", preview = false } = {}) => {
    const sha256 = musicSha256(wanted);
    if (!sha256) throw failure(400, "That is not a track's sha256.");
    let found = kept(sha256);
    let downloaded = false;
    if (!found) {
      const source = hubReleaseUrl(url);
      if (!source) throw failure(400, "Only a track in the community hub's releases can be kept.");
      let fetching = pending.get(sha256);
      if (!fetching) {
        fetching = fetchTrack(sha256, source).finally(() => pending.delete(sha256));
        pending.set(sha256, fetching);
        downloaded = true;
      }
      const fetched = await fetching;
      const index = note(sha256, { ...fetched, trackId, preview });
      // Past the limit, the tracks played longest ago make room for this one.
      if (downloaded) drop(dir, index, keptMusicOverLimit(index, maxBytes, sha256));
      found = kept(sha256);
      if (!found) throw failure(502, "The track could not be kept.");
    } else {
      note(sha256, { type: found.entry.type, bytes: found.entry.bytes, trackId, preview });
    }
    return {
      filePath: found.filePath,
      contentType: MUSIC_CONTENT_TYPES[found.entry.type],
      bytes: found.entry.bytes,
      downloaded,
    };
  };

  return { keep };
};
