/*! Open Historia — the community hub's music list © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Music a scenario may play comes from one place: the list of tracks the
// community hub publishes. Only the hub's contributors can add to that list,
// which is how every track on it is one the hub may share; a scenario names
// tracks by their id (server/scenarioMusic.js) and never carries a file or an
// address of its own.
//
// The hub's workflow writes the list as music.json on the hub repository's
// `music-index` branch, and puts each track's file in the repository's
// releases:
//
//   { schema: "open-historia-music-index/1", updated, tracks: [ { id, name,
//     artist, licence, source, credit, fits[], genres[], moods[],
//     instruments[], version, file, type, bytes, sha256, seconds, post,
//     postedBy, removed } ] }
//
// A track's genres, moods and instruments are names from the hub's own lists
// (the ones Scott Buckley's library sorts its music by): what scenario makers
// find tracks by. A list written before the hub had them simply has none.
//
// It is read from raw.githubusercontent.com, which answers any origin and is
// not counted against a player's API requests, and it is read as a stranger's
// file: each field is taken only as the type it should be and cut to a length,
// and a track's file can only be in the hub's own releases. A track the hub
// took down stays on the list as `removed`, with no file: it is never offered
// and never played, and a scenario that names it shows it as gone.
//
// The list may not be there at all (the hub has published none yet), or be
// written by a newer hub than this game knows: then there is no hub music, and
// the screens that show the list say so in one sentence. Nothing here throws.
//
// It is kept in memory for five minutes, and a copy is kept in localStorage
// for a week, so the second start of the game knows the list at once and a
// start with no connection still knows the names and the credits.

import { hubReleaseUrl, HUB_OWNER, HUB_REPO } from "../../server/hubProvenance.js";
import { musicTrackId } from "../../server/scenarioMusic.js";
import { hubFileAddress } from "./hubFiles.js";

export const HUB_MUSIC_URL = `https://raw.githubusercontent.com/${HUB_OWNER}/${HUB_REPO}/music-index/music.json`;
export const HUB_MUSIC_SCHEMA = "open-historia-music-index/1";
// What a track may be said to suit: the menu, and a scenario's four situations.
export const HUB_MUSIC_FITS = Object.freeze(["menu", "loading", "game", "atWar", "battle"]);
// What a track can be found by, as the list names the fields.
export const HUB_MUSIC_TAG_KINDS = Object.freeze(["genres", "moods", "instruments"]);

// What a player reads where the list would be. In a *_TEXTS table because the
// string extractor reads those (scripts/i18n/).
export const HUB_MUSIC_TEXTS = Object.freeze({
  unread: "The hub's music list cannot be read yet.",
});

const CACHE_TTL_MS = 5 * 60 * 1000;
const LIST_TIMEOUT_MS = 8000;
const STORED_KEY = "oh:hub-music:v1";
const STORED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A copy larger than this is not kept: localStorage is small and shared.
const STORED_MAX_CHARS = 400000;

// Far above what the hub writes; they bound a damaged file.
const MAX_TRACKS = 2000;
const MAX_NAME = 200;
const MAX_LICENCE = 100;
const MAX_CREDIT = 600;
const MAX_ADDRESS = 600;
const MAX_LOGIN = 100;
const MAX_SECONDS = 24 * 60 * 60;
// Far above the hub's lists too (14 genres, 46 moods, 35 instruments).
const MAX_TAGS = 40;
const MAX_TAG = 60;
const SOURCE_ADDRESS = /^https:\/\/[^\s"'<>\\]+$/i;

const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
const cut = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const positiveWhole = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);
const dateText = (value) => (typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : "");
// A track's genres, moods or instruments: names, each once, or [] when the
// list says none (or something that is not a list of names).
const tagsOf = (value) => [...new Set((Array.isArray(value) ? value : []).map((tag) => cut(tag, MAX_TAG)).filter(Boolean))].slice(0, MAX_TAGS);

// One track of the list, or null for an entry that is none: no id, or no name
// to show it by.
const normalizeTrack = (raw) => {
  const source = record(raw);
  const id = musicTrackId(source?.id);
  const name = cut(source?.name, MAX_NAME);
  if (!id || !name) return null;
  const removed = source.removed === true;
  const page = cut(source.source, MAX_ADDRESS + 1);
  const seconds = Number.isFinite(source.seconds) && source.seconds > 0 && source.seconds <= MAX_SECONDS ? Math.round(source.seconds) : null;
  return {
    id,
    name,
    artist: cut(source.artist, MAX_NAME),
    licence: cut(source.licence, MAX_LICENCE),
    source: page.length <= MAX_ADDRESS && SOURCE_ADDRESS.test(page) ? page : "",
    credit: cut(source.credit, MAX_CREDIT),
    fits: [...new Set((Array.isArray(source.fits) ? source.fits : []).filter((fit) => HUB_MUSIC_FITS.includes(fit)))],
    genres: tagsOf(source.genres),
    moods: tagsOf(source.moods),
    instruments: tagsOf(source.instruments),
    version: positiveWhole(source.version) ?? 1,
    // In the hub's own releases, or nowhere: whatever the list says, nothing
    // else is ever played. A track taken down has no file.
    file: removed ? "" : hubReleaseUrl(source.file),
    type: source.type === "mp3" || source.type === "ogg" ? source.type : "",
    bytes: positiveWhole(source.bytes) ?? 0,
    sha256: typeof source.sha256 === "string" && /^[0-9a-f]{64}$/i.test(source.sha256) ? source.sha256.toLowerCase() : "",
    seconds,
    post: positiveWhole(source.post),
    postedBy: cut(source.postedBy, MAX_LOGIN),
    removed,
  };
};

// The list as the game uses it: { listed, updated, tracks }. `listed` is false
// for anything that is not a list this game can read (another schema, no
// tracks array): then it has no tracks either. The first entry of an id wins.
export const normalizeHubMusic = (raw) => {
  const source = record(raw);
  if (source?.schema !== HUB_MUSIC_SCHEMA || !Array.isArray(source.tracks)) return { listed: false, updated: "", tracks: [] };
  const tracks = [];
  const seen = new Set();
  for (const entry of source.tracks) {
    const track = normalizeTrack(entry);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    tracks.push(track);
    if (tracks.length >= MAX_TRACKS) break;
  }
  return { listed: true, updated: dateText(source.updated), tracks };
};

// What fetchHubMusic answers with when the list could not be had at all.
const UNREAD_LIST = Object.freeze({ listed: false, unread: true, updated: "", tracks: Object.freeze([]) });

// Why there is no hub music, as a sentence for the player, or null when the
// list was read.
export const hubMusicProblem = (list) => (list?.listed ? null : HUB_MUSIC_TEXTS.unread);

const byId = new WeakMap();
// A track of the list by its id, or null. A removed track is found too, so a
// scenario that names it can say it is gone.
export const trackById = (list, id) => {
  if (!list || !Array.isArray(list.tracks)) return null;
  let index = byId.get(list);
  if (!index) {
    index = new Map(list.tracks.map((track) => [track.id, track]));
    byId.set(list, index);
  }
  return index.get(String(id ?? "")) ?? null;
};

// The tracks a scenario's author may choose from: every one still on the hub.
export const offeredTracks = (list) => (Array.isArray(list?.tracks) ? list.tracks.filter((track) => !track.removed && track.file) : []);

// The tracks that have every one of the names asked for: `wanted` is
// { genres, moods, instruments }, each a name or "" for any.
export const tracksWithTags = (tracks, wanted = {}) => (Array.isArray(tracks) ? tracks : []).filter((track) => HUB_MUSIC_TAG_KINDS.every((kind) => !wanted[kind] || (track[kind] ?? []).includes(wanted[kind])));

// The names of one kind that `tracks` have, each with how many of them have
// it: [[name, count]], the most used first, then by name.
export const tagCounts = (tracks, kind) => {
  const counts = new Map();
  for (const track of Array.isArray(tracks) ? tracks : []) for (const tag of track?.[kind] ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en", { sensitivity: "base" }));
};

// The address an <audio> plays a track from, or "" when it must not be played:
// taken down, or its file is not in the hub's own releases. The route every
// hub file takes on this platform (hubFiles.js hubFileAddress).
export const playableAddressOf = (track, env = import.meta.env ?? {}) => {
  if (!track || track.removed) return "";
  const file = hubReleaseUrl(track.file);
  return file ? hubFileAddress(file, env) : "";
};

// ---- the copy kept between sessions --------------------------------------------

const storage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

// The list as last read from the hub on this device, or null: none kept, one
// too old to trust, or one that no longer reads as a list. Read as strictly as
// the hub's own file, since anything may be in localStorage.
const readStored = (now = Date.now()) => {
  try {
    const kept = JSON.parse(storage()?.getItem(STORED_KEY) ?? "null");
    const at = Number(kept?.at);
    if (!Number.isFinite(at) || at > now || now - at > STORED_MAX_AGE_MS) return null;
    const list = normalizeHubMusic(kept.list);
    return list.listed ? { at, list } : null;
  } catch {
    return null;
  }
};

const writeStored = (list, at) => {
  try {
    const text = JSON.stringify({ at, list: { schema: HUB_MUSIC_SCHEMA, updated: list.updated, tracks: list.tracks } });
    if (text.length <= STORED_MAX_CHARS) storage()?.setItem(STORED_KEY, text);
    else storage()?.removeItem(STORED_KEY);
  } catch { /* it is read from the hub again next time */ }
};

const forgetStored = () => {
  try { storage()?.removeItem(STORED_KEY); } catch { /* nothing kept, then */ }
};

// ---- reading it -----------------------------------------------------------------

// `at` is when `list` was read from the hub (0: this session has not).
let cache = { at: 0, list: null, pending: null };

// The list as this device knows it without asking: read this session, else
// the copy kept from an earlier one. null when it knows none.
export const knownHubMusic = () => {
  if (!cache.list) {
    const kept = readStored();
    if (kept) cache = { ...cache, list: kept.list };
  }
  return cache.list;
};

// The hub's music list. Never throws.
//   - The hub answered with a list: that list, kept for next time.
//   - The hub answered that there is none (the file is not there yet), or with
//     a list this game cannot read (another schema): no hub music, and the
//     copy kept from before is forgotten, since the hub no longer stands
//     behind it.
//   - The hub could not be asked (no connection, a timeout, an answer that is
//     not the file at all): the last list known, or a list of nothing.
export const fetchHubMusic = async ({ force = false } = {}) => {
  if (!force && cache.list && cache.at && Date.now() - cache.at < CACHE_TTL_MS) return cache.list;
  if (cache.pending) return cache.pending;
  const pending = (async () => {
    try {
      // no-store: raw.githubusercontent.com already holds it five minutes.
      const response = await fetch(HUB_MUSIC_URL, { cache: "no-store", signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
      const list = response.ok ? normalizeHubMusic(await response.json()) : normalizeHubMusic(null);
      cache = { at: Date.now(), list, pending: null };
      if (list.listed) writeStored(list, cache.at);
      else forgetStored();
      return list;
    } catch {
      // The last one known is better than none; a miss is asked again next time.
      const list = knownHubMusic() ?? UNREAD_LIST;
      cache = { ...cache, pending: null };
      return list;
    }
  })();
  cache = { ...cache, pending };
  return pending;
};

// Tests only.
export const resetHubMusicCache = () => {
  cache = { at: 0, list: null, pending: null };
};
