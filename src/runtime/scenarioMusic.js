/*! Open Historia — a scenario's music, from its record to what plays © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A scenario names tracks of the community hub's music list for four
// situations (server/scenarioMusic.js: the record, shared with both stores).
// This is the page's side of it: the names the editor gives the situations,
// the record turned into what the music director plays (ambientMusic.js), by
// way of the hub's list (hubMusic.js), and the credits its tracks' licences
// ask for.
//
// A track is only ever what the hub's list says it is now. One the list no
// longer has, or has taken down, or whose file is not in the hub's own
// releases, is left out of what plays: the situation goes on with the rest of
// its list, or with the game's own music.

import {
  MAX_SCENARIO_MUSIC_TRACKS,
  SCENARIO_MUSIC_SITUATIONS,
  SCENARIO_MUSIC_VOLUMES,
  normalizeScenarioMusic,
  scenarioMusicTrackIds,
  scenarioMusicVolumes,
} from "../../server/scenarioMusic.js";
import { musicEnabled, setMusicLevels, setMusicPlaylists } from "./ambientMusic.js";
import { fetchHubMusic, knownHubMusic, playableAddressOf, trackById } from "./hubMusic.js";

export { MAX_SCENARIO_MUSIC_TRACKS, SCENARIO_MUSIC_SITUATIONS, SCENARIO_MUSIC_VOLUMES, normalizeScenarioMusic, scenarioMusicTrackIds, scenarioMusicVolumes };

// The four situations as the scenario editor's Music tab and a suggestion's
// list of changes name them.
export const MUSIC_SITUATION_LABELS = Object.freeze({
  loading: "While the game opens",
  game: "In the game",
  atWar: "At war",
  battle: "In the war room",
});

// What a track's licence asks to be said of it: the hub's own credit line, or,
// for a track listed without one, its name, composer and licence.
export const trackCredit = (track) => (track
  ? track.credit || [track.name, track.artist, track.licence].filter(Boolean).join(" · ")
  : "");

// Where a credit's link leads, as it is shown beside the credit: the site's
// name, not the whole address. "" for anything that is not an https address,
// which is then not linked at all.
export const creditSiteOf = (address) => {
  try {
    const url = new URL(String(address ?? ""));
    return url.protocol === "https:" ? url.hostname : "";
  } catch {
    return "";
  }
};

// The record as the director plays it: for each situation, its tracks that the
// hub's list still has and that may be played, in order, each with the address
// every hub file is fetched from (`src`: which track it is, and what it is
// played from where no copy can be kept) and what its kept copy is known by
// (`file`, `sha256`: keptMusic.js keptMusicAddress, asked when the track is
// about to play). null when nothing of it can be played (no record, no list,
// or no track left).
export const resolveScenarioPlaylists = (music, list, addressOf = playableAddressOf) => {
  const wanted = normalizeScenarioMusic(music);
  if (!wanted || !list?.listed) return null;
  // (How loud each situation is does not wait for the hub's list: the
  // follower below tells the director at once.)
  const lists = {};
  for (const situation of SCENARIO_MUSIC_SITUATIONS) {
    lists[situation] = wanted[situation].flatMap((entry) => {
      const track = trackById(list, entry.id);
      const src = track ? addressOf(track) : "";
      return src ? [{
        id: track.id, src, name: track.name, artist: track.artist, licence: track.licence, credit: trackCredit(track), source: track.source,
        file: track.file, sha256: track.sha256,
      }] : [];
    });
  }
  return SCENARIO_MUSIC_SITUATIONS.some((situation) => lists[situation].length) ? lists : null;
};

// The credits of every track a scenario names that the hub still has, once
// each: [{ id, credit, source }].
export const scenarioMusicCredits = (music, list) => scenarioMusicTrackIds(music).flatMap((id) => {
  const track = trackById(list, id);
  return track && !track.removed ? [{ id, credit: trackCredit(track), source: track.source }] : [];
});

// Keeps the director's lists those of the open game's scenario. `play` is
// handed the resolved lists (or null), `enabled` says whether the music is on,
// `known` gives the hub's list as this device already has it and `ask` reads
// it from the hub. `level` is handed how loud each situation is (the record's
// volumes, the game's own where it sets none; scenarioMusicVolumes), at once:
// it needs nothing of the hub.
//
// The list this device already knows is used at once, so the first note of a
// game opening is the right one. The hub is asked only while the music is on:
// a player who turned it off downloads nothing, the list included.
export const createScenarioMusicFollower = ({ play, enabled, known, ask, level = null }) => {
  let followed = null;
  let key = "null";
  let wasEnabled = enabled();
  // Which asking of the hub is the newest: an older answer is dropped.
  let turn = 0;

  const apply = () => {
    turn += 1;
    const mine = turn;
    if (!followed) { play(null); return; }
    const have = known();
    play(have?.listed ? resolveScenarioPlaylists(followed, have) : null);
    if (!enabled()) return;
    Promise.resolve(ask()).then((list) => {
      if (mine === turn && list !== have) play(resolveScenarioPlaylists(followed, list));
    }).catch(() => { /* fetchHubMusic does not throw; a stand-in might */ });
  };

  return {
    // The music of the open game's scenario (its record), or null for none.
    follow: (music) => {
      const next = normalizeScenarioMusic(music);
      const nextKey = JSON.stringify(next);
      if (nextKey === key) return;
      followed = next;
      key = nextKey;
      level?.(scenarioMusicVolumes(next));
      apply();
    },
    // A setting changed. Only the music being switched on matters: the hub is
    // asked for what was not asked while it was off.
    settingsChanged: () => {
      const on = enabled();
      if (on === wasEnabled) return;
      wasEnabled = on;
      if (on && followed) apply();
    },
  };
};

let follower = null;
// Tells the music which scenario's lists to play (GameUI/main.jsx, whenever
// the open game or its scenario changes): its `music` record, or null.
export const followScenarioMusic = (music) => {
  if (!follower) {
    follower = createScenarioMusicFollower({ play: setMusicPlaylists, level: setMusicLevels, enabled: musicEnabled, known: knownHubMusic, ask: fetchHubMusic });
    if (typeof window !== "undefined") window.addEventListener("mapSettings:updated", () => follower.settingsChanged());
  }
  follower.follow(music);
};
