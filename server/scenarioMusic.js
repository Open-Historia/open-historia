/*! Open Historia — the music a scenario asks for © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A scenario may name tracks from the community hub's music list for four
// situations of a game. It keeps only which tracks, never the music itself:
//
//   music: { loading: [ { id, version } ], game: [...], atWar: [...], battle: [...],
//            volume: { game: 35, ... } }
//
//   loading  the game is opening under its cover;
//   game     in the game;
//   atWar    in the game while the player is at war, outside the war room;
//   battle   the war room is open, or a battlefield is shown.
//
// Each list is in the order its tracks play, twelve at most. A track's name,
// its credit and where its file is always come from the hub's list when it is
// about to play (src/runtime/hubMusic.js), so a track the hub has taken down
// stops playing everywhere, and nothing here can point a game at a file. An
// empty list is the game's own music for that situation.
//
// `volume` is how loud each situation's music is, whatever plays there (the
// scenario's tracks or the game's own): a whole number from 0 to 100, a share
// of the volume the player set, never more than it. The owner (2026-10-13):
// "background music when in game and in war should be quieter. the volume
// should be tunable by scenario designers". Only a situation the author set
// to something other than the game's own figure (SCENARIO_MUSIC_VOLUMES) is
// kept, so a record says only what its author decided.
//
// A scenario that names no track and sets no volume has no `music` at all.
//
// Pure and dependency-free: the desktop store (server/libraryStore.js) and the
// web store (src/runtime/web/models.js) read and write the record through
// these functions, and so do the editor and the suggested-changes diff, so
// they never disagree.

export const SCENARIO_MUSIC_SITUATIONS = Object.freeze(["loading", "game", "atWar", "battle"]);
export const MAX_SCENARIO_MUSIC_TRACKS = 12;
// How loud each situation's music is where the scenario says nothing, out of
// 100 of the player's own volume. The music of a game being played, at peace
// or at war, is the background: half. The war room is a screen of its own,
// and a game opening is the music's moment.
export const SCENARIO_MUSIC_VOLUMES = Object.freeze({ loading: 100, game: 50, atWar: 50, battle: 75 });

// A track's id as the hub writes it ("passage-of-time"): letters, digits,
// dots, dashes and underscores. Anything else is not an id, whoever wrote it.
const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const musicTrackId = (value) => (typeof value === "string" && TRACK_ID.test(value) ? value : "");

// Which upload of the track the author chose. The hub counts them from 1; one
// that is missing or is not such a number reads as the first.
const trackVersion = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 1);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trackList = (raw) => {
  const list = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = isRecord(entry) ? musicTrackId(entry.id) : "";
    if (!id) continue;
    list.push({ id, version: trackVersion(entry.version) });
    if (list.length >= MAX_SCENARIO_MUSIC_TRACKS) break;
  }
  return list;
};

// A volume as it is kept: a whole number from 0 to 100, or null for anything
// that is not a number.
const volumeOf = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null);

// The volumes the author set that are not the game's own figures, or null.
const volumeRecord = (raw) => {
  if (!isRecord(raw)) return null;
  const volume = {};
  for (const situation of SCENARIO_MUSIC_SITUATIONS) {
    const value = volumeOf(raw[situation]);
    if (value !== null && value !== SCENARIO_MUSIC_VOLUMES[situation]) volume[situation] = value;
  }
  return Object.keys(volume).length ? volume : null;
};

// The record as it is stored and exported, or null when it names no track and
// sets no volume. Read as a stranger's: a bundle is a file anybody can write.
export const normalizeScenarioMusic = (raw) => {
  if (!isRecord(raw)) return null;
  const music = {};
  for (const situation of SCENARIO_MUSIC_SITUATIONS) music[situation] = trackList(raw[situation]);
  const volume = volumeRecord(raw.volume);
  if (volume) music.volume = volume;
  return volume || SCENARIO_MUSIC_SITUATIONS.some((situation) => music[situation].length) ? music : null;
};

// How loud each situation is for a scenario with this record (or with none):
// every situation, out of 100, the author's figure or the game's own.
export const scenarioMusicVolumes = (raw) => {
  const set = normalizeScenarioMusic(raw)?.volume ?? {};
  return Object.fromEntries(SCENARIO_MUSIC_SITUATIONS.map((situation) => [situation, set[situation] ?? SCENARIO_MUSIC_VOLUMES[situation]]));
};

// The field of a scenario's details and of a bundle's `scenario` object: there
// only while the scenario names a track, so every other scenario's record and
// file read as they always have.
export const scenarioMusicField = (raw) => {
  const music = normalizeScenarioMusic(raw);
  return music ? { music } : {};
};

// Every track a record names, once each, in the order they are first met.
export const scenarioMusicTrackIds = (raw) => {
  const music = normalizeScenarioMusic(raw);
  if (!music) return [];
  return [...new Set(SCENARIO_MUSIC_SITUATIONS.flatMap((situation) => music[situation].map((entry) => entry.id)))];
};
