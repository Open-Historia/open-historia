/*! Open Historia — a hub track, played from the copy kept on this device © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A hub track a scenario plays is downloaded to the device once and kept by
// what it is, its sha256 (server/keptMusic.js: the record, and the owner's two
// sentences it comes from). This is the page's side of it: the one function
// that says where a track is played from, on whichever platform this is, so
// neither the music director (ambientMusic.js) nor the scenario editor's
// preview knows a platform.
//
//   keptMusicAddress(track, { preview })   →  the address an <audio> plays
//
//   - The desktop app and the local server: /api/music/<sha256>, with the
//     track's file in the hub's releases and its id as the query. The server
//     keeps the file in a folder of its own and serves it from there
//     (server/musicLibrary.js); the first request downloads it, once.
//   - The website: a cache of its own in the browser's Cache Storage
//     ("oh-music-v1"), one entry a sha256, with the record beside them in the
//     same cache. The first play fetches the file through the hub proxy, as
//     every hub file is fetched there, checks it is the file the hub's list
//     describes (its sha256), and keeps it; that play and every later one is a
//     blob: address made from the kept copy. A blob address is given back
//     (releaseMusicAddress) when its <audio> has moved on.
//   - Where there is no Cache Storage (the Android app: its page is served
//     from an http address, which a browser gives none), or the fetch fails,
//     or the file is not the one described: the address every hub file is
//     played from today (hubMusic.js playableAddressOf), so the music still
//     plays. Nothing is kept then.
//
// A track with no sha256 on the hub's list is played from that same address.
// One the hub has taken down, or whose file is not in its releases, has no
// address at all, as before.
//
// The limit here is 300 MB (1 GB on the desktop), the tracks played longest
// ago going first. Settings → General → Sound shows how much is kept and
// clears it (keptMusicUsage, clearKeptMusic), and the website's store deletes
// what no scenario uses any more when it is told which tracks are in use
// (sweepKeptMusic; the desktop's own store does that on its side).

import { hubReleaseUrl } from "../../server/hubProvenance.js";
import {
  MUSIC_CONTENT_TYPES,
  MUSIC_TRACK_MAX_BYTES,
  keptMusicOverLimit,
  keptMusicUnused,
  keptMusicUsage as usageOf,
  musicSha256,
  musicTypeOfBytes,
  normalizeKeptMusic,
  withKeptPlay,
} from "../../server/keptMusic.js";
import { fetchHubRelease } from "./hubFiles.js";
import { playableAddressOf } from "./hubMusic.js";
import { sha256Hex } from "./sha256.js";

// Named in assets.js too, which deletes every cache it does not know when the
// page starts (a test holds the two to the same name).
export const KEPT_MUSIC_CACHE = "oh-music-v1";
export const KEPT_MUSIC_WEB_MAX_BYTES = 300 * 1024 * 1024;

// Where the kept files and their record are in the cache. Addresses of this
// page's own origin, which is all a cache takes; nothing is ever asked of them.
const keyOf = (sha256) => `/kept-music/${sha256}`;
const INDEX_KEY = "/kept-music/index.json";

const typeOfBlob = (blob) => (blob?.type === MUSIC_CONTENT_TYPES.ogg ? "ogg" : "mp3");

// The website's store. `openShelf()` resolves to the cache (match, put,
// delete), or to nothing where there is none; `fetchFile(file)` fetches a
// track's file from the hub's releases; `hash` gives a sha256 in hex;
// `makeUrl` and `revokeUrl` are the browser's own for a blob.
export const createKeptMusicStore = ({
  openShelf,
  fetchFile,
  hash = sha256Hex,
  makeUrl,
  revokeUrl,
  now = () => Date.now(),
  maxBytes = KEPT_MUSIC_WEB_MAX_BYTES,
}) => {
  // The fetches under way, by sha256: a second play of the same missing track
  // waits for the first one's.
  const pending = new Map();
  // The blob addresses handed out and not yet given back.
  const made = new Set();
  // The record is read, changed and written back, never two at once.
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  const readIndex = async (shelf) => {
    try {
      const kept = await shelf.match(INDEX_KEY);
      return kept ? normalizeKeptMusic(await kept.json()) : {};
    } catch {
      return {};
    }
  };
  const writeIndex = (shelf, index) => shelf.put(INDEX_KEY, new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }));

  // Takes `doomed` out of the cache and out of the record.
  const drop = async (shelf, index, doomed) => {
    if (!doomed.length) return index;
    const next = { ...index };
    for (const sha256 of doomed) {
      await shelf.delete(keyOf(sha256));
      delete next[sha256];
    }
    await writeIndex(shelf, next);
    return next;
  };

  // The file, fetched, checked and kept: its bytes as a blob.
  const fetchTrack = async (shelf, sha256, file) => {
    const response = await fetchFile(file);
    if (!response?.ok) throw new Error(`The track could not be downloaded (HTTP ${response?.status ?? 0}).`);
    if (Number(response.headers?.get?.("content-length")) > MUSIC_TRACK_MAX_BYTES) throw new Error("That track is too large to keep.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MUSIC_TRACK_MAX_BYTES) throw new Error("That track is too large to keep.");
    if ((await hash(bytes)) !== sha256) throw new Error("The downloaded track is not the one that was asked for.");
    const contentType = MUSIC_CONTENT_TYPES[musicTypeOfBytes(bytes)];
    const blob = new Blob([bytes], { type: contentType });
    await shelf.put(keyOf(sha256), new Response(blob, { headers: { "Content-Type": contentType, "Content-Length": String(bytes.length) } }));
    return blob;
  };

  // A blob: address of the kept copy of `track`, fetched first if it is not
  // kept yet; "" when it cannot be had this way (no cache here, no sha256, a
  // file that is not the hub's), which leaves the caller its usual address.
  // Whatever goes wrong on the way is thrown.
  const address = async (track, { preview = false } = {}) => {
    const sha256 = musicSha256(track?.sha256);
    const file = hubReleaseUrl(track?.file);
    if (!sha256 || !file || track.removed) return "";
    const shelf = await openShelf();
    if (!shelf) return "";

    const kept = await shelf.match(keyOf(sha256));
    let blob = kept ? await kept.blob() : null;
    const fetched = !blob;
    if (!blob) {
      let fetching = pending.get(sha256);
      if (!fetching) {
        fetching = fetchTrack(shelf, sha256, file).finally(() => pending.delete(sha256));
        pending.set(sha256, fetching);
      }
      blob = await fetching;
    }

    // Played now, and under which id; past the limit, the tracks played
    // longest ago make room for one that was just fetched.
    await inTurn(async () => {
      const index = withKeptPlay(await readIndex(shelf), sha256, {
        type: typeOfBlob(blob), bytes: blob.size, trackId: track.id, preview, at: now(),
      });
      await writeIndex(shelf, index);
      if (fetched) await drop(shelf, index, keptMusicOverLimit(index, maxBytes, sha256));
    });

    const url = makeUrl(blob);
    made.add(url);
    return url;
  };

  return {
    address,
    // Gives a blob address back once nothing plays from it. Any other address
    // (the server's, the hub proxy's) is not this store's and is left alone.
    release: (url) => {
      if (made.delete(url)) revokeUrl(url);
    },
    // How much is kept: { tracks, bytes }, or null where there is no cache.
    usage: async () => {
      const shelf = await openShelf();
      return shelf ? usageOf(await readIndex(shelf)) : null;
    },
    // Everything goes; it is downloaded again when a scenario plays it.
    clear: async () => {
      const shelf = await openShelf();
      if (!shelf) return null;
      return inTurn(async () => {
        const index = await readIndex(shelf);
        return usageOf(await drop(shelf, index, Object.keys(index)));
      });
    },
    // The kept music follows the scenarios that use it: every kept file that
    // was a game's and that none of the track ids in `used` names any more is
    // deleted (server/keptMusic.js keptMusicUnused). Resolves to what went.
    sweep: async (used) => {
      const shelf = await openShelf();
      if (!shelf) return [];
      return inTurn(async () => {
        const index = await readIndex(shelf);
        const doomed = keptMusicUnused(index, used);
        await drop(shelf, index, doomed);
        return doomed;
      });
    },
  };
};

// This page's store: the browser's Cache Storage, or none where a browser
// gives none (an http origin, a private window that refuses it).
let pageStore;
const storeOfThisPage = () => {
  if (pageStore !== undefined) return pageStore;
  let storage = null;
  try { storage = globalThis.caches ?? null; } catch { storage = null; }
  pageStore = typeof storage?.open === "function" && typeof URL?.createObjectURL === "function"
    ? createKeptMusicStore({
      openShelf: () => storage.open(KEPT_MUSIC_CACHE).catch(() => null),
      // Through the page's own hub route, which the website hands to the hub
      // proxy (web/router.js): the way every hub file is fetched (hubFiles.js).
      fetchFile: fetchHubRelease,
      makeUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    })
    : null;
  return pageStore;
};

// Tests only: the page's store is looked for again.
export const resetKeptMusicForTests = () => {
  pageStore = undefined;
};

const onServer = (env) => !env.VITE_OH_WEB;

// The address an <audio> plays a hub track from, on this platform: the copy
// kept on this device wherever one can be kept (see the top of this file), and
// "" for a track that must not be played at all. `preview` says the scenario
// editor is only trying the track out, which keeps it all the same but does
// not make it any scenario's. Never throws.
export const keptMusicAddress = async (track, { preview = false, env = import.meta.env ?? {} } = {}) => {
  const direct = playableAddressOf(track, env);
  if (!direct) return "";
  const sha256 = musicSha256(track.sha256);
  if (!sha256) return direct;
  if (onServer(env)) {
    const query = [
      `url=${encodeURIComponent(hubReleaseUrl(track.file))}`,
      ...(track.id ? [`track=${encodeURIComponent(track.id)}`] : []),
      ...(preview ? ["preview=1"] : []),
    ];
    return `/api/music/${sha256}?${query.join("&")}`;
  }
  try {
    return (await storeOfThisPage()?.address(track, { preview })) || direct;
  } catch {
    return direct;
  }
};

// Gives back an address keptMusicAddress handed out, once nothing plays from
// it: a blob address is revoked, any other is left alone.
export const releaseMusicAddress = (address) => {
  if (typeof address === "string" && address.startsWith("blob:")) pageStore?.release(address);
};

// How much music is kept on this device: { tracks, bytes }, or null where
// that cannot be known (no cache in this browser; a server that is asked from
// another machine, which it does not answer). Never throws.
export const keptMusicUsage = async ({ env = import.meta.env ?? {} } = {}) => {
  try {
    if (!onServer(env)) return (await storeOfThisPage()?.usage()) ?? null;
    const response = await fetch("/api/music", { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

// Deletes the music kept on this device, and answers with what is left
// ({ tracks, bytes }), or null when it could not be done. Never throws.
export const clearKeptMusic = async ({ env = import.meta.env ?? {} } = {}) => {
  try {
    if (!onServer(env)) return (await storeOfThisPage()?.clear()) ?? null;
    const response = await fetch("/api/music", { method: "DELETE" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

// The website's and the Android app's own library store calls this when a
// scenario is deleted or stops naming a track (web/libraryStore.js), with the
// track ids the scenarios left in the library name. Never throws.
export const sweepKeptMusic = async (used) => {
  try {
    return (await storeOfThisPage()?.sweep(used)) ?? [];
  } catch {
    return [];
  }
};
