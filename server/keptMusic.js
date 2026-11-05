/*! Open Historia — the music kept on a device: its record © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A hub track a scenario plays is downloaded to the device once and kept by
// what it is, its sha256, not by which scenario, track id or address asked for
// it (the owner, 2026-10-13: "if you already have a song downloaded from
// another scenario, it doesnt redownload it for you when another scenario uses
// the same song"). Every later play, from any scenario, on any day, is the kept
// copy.
//
// Where the copies are differs: the desktop app's server keeps files in a
// folder of its own (server/musicLibrary.js), the website and the Android app
// keep them in the browser (src/runtime/keptMusic.js). What both keep beside
// them is this record, one entry a kept file:
//
//   { [sha256]: { type, bytes, playedAt, ids, previewed } }
//
//   type       "mp3" or "ogg": what the file is, and so what it is served as;
//   bytes      its size, for the total and the limit;
//   playedAt   when it was last asked for (ms), for the limit: past it, the
//              tracks played longest ago go first;
//   ids        the hub track ids a GAME asked for it as. A scenario's `music`
//              names track ids (scenarioMusic.js), so this is how a kept file
//              is known to be a scenario's without the hub's list at hand;
//   previewed  the scenario editor's preview asked for it.
//
// The kept music follows the scenarios that use it (the owner again: "make
// sure songs arent deleted along with scenarios unless it is the only scenario
// to use the song"). When a scenario is deleted, or its music is saved with
// tracks taken out, or a hub Update replaces it, every kept file that was a
// game's and that no scenario left in the library names any more is deleted
// (keptMusicUnused). A file only ever previewed in the editor is nobody's: it
// has no ids, the sweep leaves it, and the size limit sees to it.
//
// Pure and dependency-free, like scenarioMusic.js beside it: both stores read
// and write the record through these functions, so they never disagree.

import { musicTrackId, scenarioMusicTrackIds } from "./scenarioMusic.js";

// A track is a few megabytes; the hub accepts none near this.
export const MUSIC_TRACK_MAX_BYTES = 25 * 1024 * 1024;

// What a kept file is served as.
export const MUSIC_CONTENT_TYPES = Object.freeze({ mp3: "audio/mpeg", ogg: "audio/ogg" });

// A sha256 as the hub's list writes it, lower case, or "".
export const musicSha256 = (value) => (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : "");

// "mp3" or "ogg", or "".
export const musicFileType = (value) => (value === "mp3" || value === "ogg" ? value : "");

// What a file is, by how it begins: an Ogg file says so in its first four
// bytes, and the hub's only other kind is MP3. "" when there is nothing to
// look at.
export const musicTypeOfBytes = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (view.length < 4) return "";
  return view[0] === 0x4f && view[1] === 0x67 && view[2] === 0x67 && view[3] === 0x53 ? "ogg" : "mp3";
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const wholeCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
// Far more ids than one file is ever listed under; it bounds a damaged record.
const MAX_IDS = 50;
const idList = (raw) => [...new Set((Array.isArray(raw) ? raw : []).map(musicTrackId).filter(Boolean))].slice(0, MAX_IDS);

// The record as it is kept, read as strictly as anything else found in a file
// or in the browser's storage. An entry that is not one is left out.
export const normalizeKeptMusic = (raw) => {
  const index = {};
  for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
    const sha256 = musicSha256(key);
    const type = isRecord(value) ? musicFileType(value.type) : "";
    if (!sha256 || !type) continue;
    index[sha256] = {
      type,
      bytes: wholeCount(value.bytes),
      playedAt: wholeCount(value.playedAt),
      ids: idList(value.ids),
      previewed: value.previewed === true,
    };
  }
  return index;
};

// The record after a file was asked for: kept if it was not, played now, and
// known under the id it was asked for as. A preview's id is not written down:
// the editor trying a track out does not make it a scenario's.
export const withKeptPlay = (index, sha256, { type, bytes, trackId = "", preview = false, at = 0 } = {}) => {
  const before = index[sha256];
  const id = preview ? "" : musicTrackId(trackId);
  return {
    ...index,
    [sha256]: {
      type: before?.type ?? type,
      bytes: before?.bytes ?? wholeCount(bytes),
      playedAt: Math.max(wholeCount(at), before?.playedAt ?? 0),
      ids: idList([...(before?.ids ?? []), ...(id ? [id] : [])]),
      previewed: Boolean(before?.previewed) || Boolean(preview),
    },
  };
};

// How much is kept: { tracks, bytes }.
export const keptMusicUsage = (index) => {
  const entries = Object.values(index);
  return { tracks: entries.length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0) };
};

// The files to drop for the record to fit in `maxBytes`: the ones played
// longest ago first, never `keep` (the one just fetched or being played).
export const keptMusicOverLimit = (index, maxBytes, keep = "") => {
  let total = keptMusicUsage(index).bytes;
  const dropped = [];
  for (const [sha256, entry] of Object.entries(index).sort((left, right) => left[1].playedAt - right[1].playedAt)) {
    if (total <= maxBytes) break;
    if (sha256 === keep) continue;
    total -= entry.bytes;
    dropped.push(sha256);
  }
  return dropped;
};

// Every track the scenarios of a library name: what is in use. Given each
// scenario's `music` record (or nothing, for one that has none).
export const usedMusicTrackIds = (musicRecords) => {
  const used = new Set();
  for (const music of musicRecords ?? []) for (const id of scenarioMusicTrackIds(music)) used.add(id);
  return used;
};

// Whether a scenario's music, written again, no longer names a track it named
// (`before` and `after` are its `music` record then and now): the one case in
// which a save can leave a kept file with nobody, and so the only saves after
// which a store sweeps.
export const musicTracksDropped = (before, after) => {
  const stillNamed = new Set(scenarioMusicTrackIds(after));
  return scenarioMusicTrackIds(before).some((id) => !stillNamed.has(id));
};

// The kept files no scenario uses any more: a game asked for each of them
// once (it has ids), and none of those ids is in `used`. One with no ids was
// only previewed, and is not in this list whatever is in use.
export const keptMusicUnused = (index, used) => Object.entries(index)
  .filter(([, entry]) => entry.ids.length > 0 && !entry.ids.some((id) => used.has(id)))
  .map(([sha256]) => sha256);
