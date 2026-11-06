/*! Open Historia — the game's music: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/ambientMusic.test.js
//
// "Add this as ambient music in game." "Make this song play in loading screen
// then become super dramatic when you start a game and its loading then it
// dramatically stops the music at certain points in the song and a different
// song plays ingame." "When in the war room or looking at a battlefield it
// should play this." "Make it not be as dramatic when idle in the main menu
// and ramp up dramaticism when loading." "Scenario creators should be able to
// add different tracks and songs for different situations." And, of the first
// version: "its abruptly cutting to another part of the song when you open a
// new game"; "if you're in the menu for like 30 seconds it just fades out and
// resets"; "if the game loads too fast it just abruptly stops the music".
//
// What is pinned: which piece sounds in which scene; that the menu plays to
// the lull before the build, levelled, and never into the build; that a game
// opening is a crossing of two elements and never a cut on one; where the
// build comes in, from how long games take to open here, and how its loudness
// grows; that the music always reaches the big hit, unless that is far off,
// when it fades out instead; a scenario's lists in the place of the game's own
// pieces, track after track, and the game's own piece back when none of a
// list can be played; that a file is only asked for when it is about to play
// (but for the build, made ready on the menu); and that Settings says whose
// music it is, which is what the pieces' licence (CC BY 4.0) asks for.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADDRESS_WAIT_MS,
  CLEAR_SKIES_DRAMA,
  DEFAULT_MUSIC_VOLUME,
  LOAD_SECONDS_KEY,
  MUSIC_CHANNEL,
  MUSIC_CREDIT,
  MUSIC_GAME_PIECES,
  MUSIC_MENU_PIECES,
  MUSIC_SCENES,
  MUSIC_SWELL,
  MUSIC_TRACKS,
  MUSIC_WAR_PIECES,
  PASSAGE_CALM,
  PASSAGE_DRAMA,
  PASSAGE_LOADS,
  boostAt,
  calmGainAt,
  createMusicDirector,
  createMusicHolds,
  createMusicTurn,
  cutTimeAfter,
  entryFor,
  exitAfter,
  expectedLoadSeconds,
  getNowPlaying,
  holdMusic,
  loadSecondsMemory,
  musicAddress,
  musicSceneOf,
  musicVolumeOf,
  setMusicPlaylists,
  setMusicScene,
  startMusic,
  subscribeNowPlaying,
} from "./ambientMusic.js";
import { MAP_SETTING_KEYS } from "./mapSettings.js";
import { SCENARIO_MUSIC_VOLUMES, scenarioMusicVolumes } from "../../server/scenarioMusic.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Every situation as loud as the player's own volume.
const FULL_VOLUMES = Object.freeze({ loading: 100, game: 100, atWar: 100, battle: 100 });

// A clock the test moves, and timers that fire as it passes them.
const clock = () => {
  let now = 0;
  let nextId = 1;
  // How many timers were asked for: how busy the director keeps the page.
  let asked = 0;
  const pending = new Map();
  const listeners = [];
  return {
    get now() { return now; },
    get asked() { return asked; },
    onAdvance: (listener) => listeners.push(listener),
    timers: {
      set: (fn, ms) => { const id = nextId; nextId += 1; asked += 1; pending.set(id, { fn, at: now + ms }); return id; },
      clear: (id) => pending.delete(id),
    },
    // Moves time on in small steps, so that timers armed by timers fire too.
    advance(ms) {
      const end = now + ms;
      while (now < end) {
        const step = Math.min(5, end - now);
        now += step;
        for (const listener of listeners) listener(step);
        for (const [id, entry] of [...pending]) {
          if (entry.at <= now && pending.delete(id)) entry.fn();
        }
      }
    },
  };
};

// An <audio> whose time moves with the clock while it plays. `lengths` says
// how long a file is (by its address; any other never ends), and `broken`
// which addresses cannot be played: such a file fails as a browser's does,
// its element saying so before play() does.
const stage = ({ enabled = true, volume = 25, refuse = null, tracks = MUSIC_TRACKS, memory = null, lengths = {}, broken = [], onNowPlaying = null, trackAddress = null, releaseAddress = null, menuPieces = undefined, gamePieces = [], random = () => 0, volumes = FULL_VOLUMES } = {}) => {
  const time = clock();
  const settings = { enabled, volume };
  const made = [];
  const unplayable = new Set(broken);
  const makeAudio = () => {
    const listeners = {};
    let src = "";
    const audio = {
      paused: true, loop: false, preload: "auto", volume: 1, currentTime: 0, duration: Infinity, ended: false, error: null, plays: 0, pauses: 0, loads: 0,
      get src() { return src; },
      // Another file: from its start, with nothing held against it.
      set src(value) { src = value; audio.loads += 1; audio.currentTime = 0; audio.ended = false; audio.error = null; audio.duration = lengths[value] ?? Infinity; },
      addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
      emit(type) { for (const listener of listeners[type] ?? []) listener(); },
      play() {
        audio.plays += 1;
        if (refuse) return Promise.reject(Object.assign(new Error("refused"), { name: refuse }));
        if (unplayable.has(src)) {
          audio.paused = false;
          audio.error = { code: 4 };
          return new Promise((_resolve, reject) => queueMicrotask(() => {
            audio.emit("error");
            reject(Object.assign(new Error("no supported source"), { name: "NotSupportedError" }));
          }));
        }
        if (audio.ended) { audio.currentTime = 0; audio.ended = false; }
        audio.paused = false;
        return Promise.resolve();
      },
      pause() { audio.pauses += 1; audio.paused = true; },
    };
    made.push(audio);
    return audio;
  };
  time.onAdvance((ms) => {
    for (const audio of made) {
      if (audio.paused || audio.error) continue;
      audio.currentTime += ms / 1000;
      if (!audio.loop && audio.currentTime >= audio.duration) {
        audio.currentTime = audio.duration;
        audio.paused = true;
        audio.ended = true;
        audio.emit("ended");
      }
    }
  });
  const director = createMusicDirector({
    makeAudio,
    addressOf: (file) => `/${file}`,
    read: () => ({ ...settings }),
    timers: time.timers,
    now: () => time.now,
    memory,
    onNowPlaying,
    trackAddress,
    releaseAddress,
    tracks,
    // Undefined is the game's own (MUSIC_MENU_PIECES); [] is a menu with Passage Of Time alone.
    menuPieces,
    // Most of these tests are about something else: a game with no music of
    // its own, and every pick the first of its choices, unless they say.
    gamePieces,
    random,
    // And every situation at the player's whole volume, so that a volume read
    // off an element is the thing the test is about. The game's own figures
    // (SCENARIO_MUSIC_VOLUMES) are for the tests of them.
    volumes,
  });
  const of = (name) => director.channels[name].audio;
  const list = (key) => director.lists[key];
  const audibly = (ch) => ch.audio && !ch.audio.paused && ch.audio.volume > 0;
  // The game's own pieces by name, a scenario's lists as "scenario:<situation>".
  const sounding = () => [
    ...Object.entries(director.channels).filter(([, ch]) => audibly(ch)).map(([name]) => name),
    ...Object.entries(director.lists).filter(([, ch]) => audibly(ch)).map(([key]) => `scenario:${key}`),
  ];
  return { director, made, settings, time, of, list, sounding };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// The numbers a director's random picks are given, in order; the last again after that.
const rolls = (...values) => {
  let next = 0;
  return () => { const value = values[Math.min(next, values.length - 1)]; next += 1; return value; };
};
const near = (actual, expected, by = 0.006) => assert.ok(Math.abs(actual - expected) <= by, `${actual} is not within ${by} of ${expected}`);
// How long games took to open, as the director keeps it between sessions.
const remembering = (seconds = []) => {
  const memory = { kept: [...seconds], read: () => [...memory.kept], write: (next) => { memory.kept = [...next]; } };
  return memory;
};
// A hub track as the director is handed it (scenarioMusic.js resolveScenarioPlaylists).
const hubTrack = (id) => ({ id, src: `/hub/${id}.mp3`, name: `Track ${id}`, credit: `Track ${id} by Somebody (CC BY 4.0)`, source: `https://example.org/${id}` });

test("the menu: nothing is made or fetched before the first click, then Passage Of Time from its start, with the build held ready", () => {
  const { director, made, time, of, sounding } = stage();
  director.sync();
  director.setHidden(false);
  time.advance(2000);
  assert.equal(made.length, 0, "no element, so no request for a file");
  director.unlock();
  // Two elements of the one file: the menu's, playing, and the build's, ready.
  assert.equal(made.length, 2);
  const audio = of("calm");
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.paused], ["/audio/passage-of-time.mp3", true, "none", false]);
  // The build: loaded, silent and paused at the entry the next game opening
  // would use. With no game timed yet that is six seconds' worth: 161.20.
  const ready = of("drama");
  assert.notEqual(ready, audio);
  assert.deepEqual([ready.src, ready.preload, ready.paused, ready.volume, ready.currentTime, ready.plays], ["/audio/passage-of-time.mp3", "auto", true, 0, 161.2, 0]);
  assert.equal(director.readyAt, 161.2);
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  // The opening is nearly inaudible as recorded: the menu turns it up.
  near(audio.volume, 0.25 * PASSAGE_CALM.most, 1e-9);
  assert.ok(audio.currentTime < 5, "from the opening");
  assert.deepEqual([ready.paused, ready.volume, ready.currentTime, ready.plays], [true, 0, 161.2, 0], "and the build has not moved");
  // A second click does not start it again.
  director.unlock();
  assert.equal(audio.plays, 1);
  assert.equal(made.length, 2);
});

test("the menu levels the piece: the gain follows its own loudness, gliding, between a least and a most", () => {
  assert.ok(Object.isFrozen(PASSAGE_CALM) && Object.isFrozen(PASSAGE_CALM.rms));
  assert.deepEqual({ ...PASSAGE_CALM, rms: null }, { fadeFrom: 141.5, end: 143.5, limit: 144.5, fadeIn: 2500, step: 5, rms: null, level: 0.065, power: 0.75, least: 0.5, most: 1.6 });
  // The piece's loudness for every five seconds from 0 to 140.
  assert.deepEqual([...PASSAGE_CALM.rms], [
    0.029, 0.033, 0.034, 0.035, 0.027, 0.050, 0.065, 0.044, 0.065, 0.051,
    0.064, 0.063, 0.058, 0.079, 0.100, 0.103, 0.113, 0.093, 0.128, 0.135,
    0.135, 0.132, 0.145, 0.127, 0.147, 0.104, 0.051, 0.066, 0.033,
  ]);
  // The opening (0.029) is turned up as far as it goes; a stretch as loud as
  // the level is left alone; the plateau (0.145) is brought down to about half.
  assert.equal(calmGainAt(2.5), 1.6);
  near(calmGainAt(32.5), 1, 1e-12);
  near(calmGainAt(112.5), (0.065 / 0.145) ** 0.75, 1e-12);
  near(calmGainAt(112.5), 0.548, 0.001);
  // Each figure stands for the middle of its five seconds, and the gain glides between them.
  near(calmGainAt(40), (0.065 / ((0.044 + 0.065) / 2)) ** 0.75, 1e-12);
  near(calmGainAt(68.75), (0.065 / (0.079 + (0.100 - 0.079) * 0.25)) ** 0.75, 1e-12);
  // Before the middle of the first stretch and after the middle of the last, theirs.
  assert.equal(calmGainAt(0), calmGainAt(2.5));
  assert.equal(calmGainAt(-3), calmGainAt(2.5));
  assert.equal(calmGainAt(143.5), calmGainAt(142.5));
  assert.equal(calmGainAt(500), calmGainAt(142.5));
  assert.equal(calmGainAt(Number.NaN), calmGainAt(0));
  // The clamps: never over the most, never under the least.
  const extremes = { ...PASSAGE_CALM, rms: [0.0001, 5] };
  assert.equal(calmGainAt(2.5, extremes), 1.6);
  assert.equal(calmGainAt(7.5, extremes), 0.5);
  let least = 9;
  let most = 0;
  let steepest = 0;
  for (let at = 0; at < PASSAGE_CALM.end; at += 0.2) {
    const gain = calmGainAt(at);
    least = Math.min(least, gain);
    most = Math.max(most, gain);
    steepest = Math.max(steepest, Math.abs(calmGainAt(at + 0.2) - gain) / gain);
  }
  assert.equal(most, 1.6);
  assert.ok(least >= 0.5 && least < 0.56, `the loudest stretch is brought down to ${least}`);
  // No audible steps: a look every 200 ms moves the gain by a few percent at most
  // (3.5% is under a third of a decibel).
  assert.ok(steepest < 0.035, `at most ${steepest} of itself a look`);
});

test("the menu plays to the lull before the build and, with no other piece, starts again there, never fading in between", () => {
  const { director, time, of } = stage({ menuPieces: [] });
  director.unlock();
  const audio = of("calm");
  const volumeAt = (at) => 0.25 * calmGainAt(at);
  // Past the first minute and on, with no fade and no restart: only the levelling moves the volume.
  let steepest = 0;
  let before = audio.volume;
  for (let ms = 0; ms < 141000; ms += 200) {
    time.advance(200);
    assert.equal(audio.paused, false);
    if (ms >= 3000) {
      near(audio.volume, volumeAt(audio.currentTime), 0.012);
      steepest = Math.max(steepest, Math.abs(audio.volume - before) / before);
    }
    before = audio.volume;
  }
  near(audio.currentTime, 141, 0.02);
  assert.ok(steepest < 0.045, `the volume moves by ${steepest} of itself a look at most`);
  assert.equal(audio.plays, 1);
  // The seam: from 141.5 it fades, by 143.5 it is silent.
  time.advance(1500);
  near(audio.currentTime, 142.5, 0.02);
  near(audio.volume, volumeAt(142.5) / 2, 0.01);
  time.advance(950);
  assert.ok(audio.volume < 0.02, `all but silent at ${audio.currentTime}: ${audio.volume}`);
  assert.ok(audio.currentTime < PASSAGE_CALM.end);
  // From the top again, coming back in over two and a half seconds.
  time.advance(100);
  assert.ok(audio.currentTime < 0.1, `started again: ${audio.currentTime}`);
  assert.ok(audio.volume < 0.02, "from silence");
  assert.equal(audio.paused, false);
  const startedAgain = time.now - audio.currentTime * 1000;
  time.advance(startedAgain + 1250 - time.now);
  near(audio.volume, volumeAt(1.25) / 2, 0.01);
  time.advance(1300);
  near(audio.volume, volumeAt(2.55), 1e-9);
  assert.equal(audio.plays, 1, "the same element, never started twice");

  // Left idling for a quarter of an hour it goes round, silent at each seam,
  // and is never found past the end of its part: the build starts at 145.45.
  let latest = 0;
  let rounds = 0;
  let last = audio.currentTime;
  for (let ms = 0; ms < 15 * 60 * 1000; ms += 5) {
    time.advance(5);
    latest = Math.max(latest, audio.currentTime);
    if (audio.currentTime < last) {
      rounds += 1;
      assert.equal(audio.volume, 0, "silent as it goes back to the start");
    }
    last = audio.currentTime;
  }
  assert.ok(latest > PASSAGE_CALM.end - 0.02 && latest < PASSAGE_CALM.end + 0.02, `to the end of its part and no further: ${latest}`);
  assert.ok(latest < PASSAGE_CALM.limit);
  assert.ok(PASSAGE_CALM.limit < 145.45);
  assert.equal(rounds, 6);
  assert.equal(audio.paused, false);
  assert.equal(director.inDrama, false);
  // The build was held ready the whole time, and never sounded.
  assert.deepEqual([of("drama").paused, of("drama").plays, of("drama").currentTime], [true, 0, 161.2]);
});

test("the menu is watched slowly, and a changed volume is followed at once", () => {
  const { director, settings, time, of } = stage();
  director.unlock();
  time.advance(5000);
  // A look about every 200 ms, not every 25: under 6 a second.
  const before = time.asked;
  time.advance(50000);
  assert.ok(time.asked - before < 300, `${time.asked - before} timers in 50 seconds`);
  assert.ok(time.asked - before > 200);
  // The volume slider moved: followed at once, at the level of where the music is.
  time.advance(9500);
  near(of("calm").currentTime, 64.5, 0.02);
  settings.volume = 50;
  director.sync();
  near(of("calm").volume, 0.5 * calmGainAt(64.5), 0.01);
});

test("where a game opening comes into the build: the latest phrase that still leaves the game time to be drawn", () => {
  // Phrase starts, each just before an accent, with their lead to the big hit.
  // Never later than 164.70: even a game that opens at once has four seconds of build.
  assert.deepEqual([...PASSAGE_DRAMA.entries], [145.3, 149.75, 157.3, 161.2, 164.7]);
  assert.equal(PASSAGE_DRAMA.hit, 168.6);
  assert.deepEqual(PASSAGE_DRAMA.entries.map((entry) => Math.round((PASSAGE_DRAMA.hit - entry) * 100) / 100), [23.3, 18.85, 11.3, 7.4, 3.9]);
  for (const [expected, entry] of [[0, 164.7], [1, 164.7], [3, 164.7], [6, 161.2], [10, 157.3], [15, 149.75], [20, 145.3], [35, 145.3], [400, 145.3]]) {
    assert.equal(entryFor(expected), entry, `a game expected to take ${expected} s`);
  }
  // The lead is the load time and half a second: exactly enough is enough.
  assert.equal(entryFor(3.4), 164.7);
  assert.equal(entryFor(3.41), 161.2);
  assert.equal(entryFor(6.9), 161.2);
  assert.equal(entryFor(6.91), 157.3);
  assert.equal(entryFor(22.8), 145.3);
  assert.equal(entryFor(22.81), 145.3);
  // Nothing is known of the load: as six seconds.
  assert.equal(entryFor(Number.NaN), 161.2);
  assert.equal(entryFor(undefined), 161.2);
});

test("the build grows louder by where the music is: as the menu at the entry, the full boost at the big hit", () => {
  assert.equal(boostAt(161.2, 161.2), 1);
  assert.equal(boostAt(160.3, 161.2), 1, "and no louder while it is still coming in under the menu's music");
  near(boostAt((161.2 + 168.6) / 2, 161.2), 1.3, 1e-9);
  near(boostAt(145.3 + (168.6 - 145.3) / 4, 145.3), 1.15, 1e-9);
  assert.equal(boostAt(168.6, 161.2), PASSAGE_DRAMA.boost);
  assert.equal(boostAt(200, 161.2), PASSAGE_DRAMA.boost);
  // No entry (the loud stretch gone round again): the full boost.
  assert.equal(boostAt(170, null), PASSAGE_DRAMA.boost);
  assert.equal(boostAt(168.45, null), PASSAGE_DRAMA.boost);
  assert.equal(PASSAGE_DRAMA.boost, 1.6);
});

test("a game opening: the build comes in under the menu's music and the two cross, with no silence between", () => {
  assert.deepEqual([PASSAGE_DRAMA.crossfade, PASSAGE_DRAMA.lead], [1800, 0.9]);
  const { director, made, time, of, sounding } = stage({ menuPieces: [] });
  director.unlock();
  time.advance(5000);
  const calm = of("calm");
  const drama = of("drama");
  const calmLevel = 0.25 * calmGainAt(5);
  near(calm.volume, calmLevel, 1e-9);
  assert.deepEqual([drama.paused, drama.volume, drama.currentTime], [true, 0, 161.2]);

  director.setScene("loading");
  // The build starts 0.9 s before its entry, silent, with the menu's music still playing as it was.
  near(drama.currentTime, 161.2 - 0.9, 1e-9);
  assert.deepEqual([drama.paused, drama.volume, drama.plays], [false, 0, 1]);
  assert.equal(calm.paused, false);
  near(calm.volume, calmLevel, 1e-9);
  assert.equal(director.inDrama, true);
  // Through the crossing both are heard, and together they are as loud as
  // either alone: one follows a sine, the other a cosine.
  let quietest = 1;
  for (let ms = 40; ms < 1800; ms += 40) {
    time.advance(40);
    assert.deepEqual(sounding(), ["calm", "drama"], `at ${ms} ms`);
    const power = (calm.volume / calmLevel) ** 2 + (drama.volume / (0.25 * boostAt(drama.currentTime, 161.2))) ** 2;
    near(power, 1, 0.02);
    quietest = Math.min(quietest, calm.volume + drama.volume);
    if (ms === 880) {
      // The middle of it is the entry, and each is at seven tenths.
      near(drama.currentTime, 161.2, 0.03);
      near(drama.volume, 0.25 * Math.SQRT1_2, 0.01);
      near(calm.volume, calmLevel * Math.SQRT1_2, 0.01);
    }
  }
  assert.ok(quietest > 0.24, `never a dip: the two never fall under ${quietest}`);
  // After it only the build sounds; the menu's music is paused, back at its start.
  time.advance(60);
  assert.deepEqual(sounding(), ["drama"]);
  assert.deepEqual([calm.paused, calm.currentTime], [true, 0]);
  near(drama.volume, 0.25 * boostAt(drama.currentTime, 161.2), 0.002);
  assert.ok(drama.volume < 0.27, "no louder than the menu yet");
  // Halfway to the hit, halfway to the boost.
  time.advance((164.9 - drama.currentTime) * 1000);
  near(drama.currentTime, 164.9, 0.011);
  near(drama.volume, 0.25 * 1.3, 0.002);
  // At the hit and after it: the full boost.
  time.advance((168.6 - drama.currentTime) * 1000 + 30);
  near(drama.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(5000);
  near(drama.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  assert.deepEqual([calm.plays, drama.plays, made.length], [1, 1, 2]);

  // Given up for the menu: the menu's music comes in from its start over two
  // and a half seconds while the build goes out, and the build is made ready again.
  director.setScene("menu");
  time.advance(450);
  assert.deepEqual(sounding(), ["calm", "drama"]);
  time.advance(2100);
  assert.deepEqual(sounding(), ["calm"]);
  near(calm.volume, 0.25 * PASSAGE_CALM.most, 1e-9);
  near(calm.currentTime, 2.55, 0.02);
  assert.deepEqual([drama.paused, drama.volume, drama.currentTime], [true, 0, 161.2]);
});

test("a game opened as the menu's music nears its seam: the menu's element still never plays past its part", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  time.advance(143000);
  const calm = of("calm");
  near(calm.currentTime, 143, 0.02);
  director.setScene("loading");
  let latest = 0;
  for (let ms = 0; ms < 2000; ms += 5) {
    time.advance(5);
    latest = Math.max(latest, calm.currentTime);
  }
  assert.ok(latest < PASSAGE_CALM.end + 0.03, `stopped at the end of its part: ${latest}`);
  assert.ok(latest < PASSAGE_CALM.limit);
  assert.deepEqual([calm.paused, calm.currentTime], [true, 0]);
  assert.deepEqual(sounding(), ["drama"]);
});

test("how long games take to open is learned: the last five, their median, kept between sessions", () => {
  assert.deepEqual({ ...PASSAGE_LOADS }, { kept: 5, shortest: 0.5, least: 1, most: 40, unknown: 6, margin: 0.5 });
  assert.equal(expectedLoadSeconds([]), 6);
  assert.equal(expectedLoadSeconds(undefined), 6);
  assert.equal(expectedLoadSeconds([2, 3, 4]), 3);
  assert.equal(expectedLoadSeconds([2, 4]), 3);
  assert.equal(expectedLoadSeconds([0.6]), 1, "never under a second");
  assert.equal(expectedLoadSeconds([100, 120, 90]), 40, "never over forty");
  assert.equal(expectedLoadSeconds([9, 9, 1, 2, 3, 4, 5]), 3, "only the last five");
  assert.equal(expectedLoadSeconds([0.2, "3", null, Number.NaN, 7]), 7, "only numbers of at least half a second");

  const memory = remembering();
  const first = stage({ memory, enabled: false });
  assert.equal(first.director.expectedLoad, 6);
  // Timed with the music off and before any click: it is about the device.
  const open = (director, time, ms, into) => {
    director.setScene("loading");
    time.advance(ms);
    director.setScene(into);
    director.setScene("menu");
  };
  open(first.director, first.time, 2000, "game");
  open(first.director, first.time, 3000, "war");
  open(first.director, first.time, 4000, "atWar");
  assert.deepEqual(memory.kept, [2, 3, 4]);
  assert.equal(first.director.expectedLoad, 3);
  assert.equal(first.made.length, 0, "and nothing was played to learn it");
  // Not a loading: one given up for the menu, and one too short to be one.
  first.director.setScene("loading");
  first.time.advance(9000);
  first.director.setScene("menu");
  open(first.director, first.time, 300, "game");
  assert.deepEqual(memory.kept, [2, 3, 4]);

  // The next session expects what the last one learned: three seconds, so
  // the build is held ready at 164.70, and comes in there.
  const second = stage({ memory });
  assert.equal(second.director.expectedLoad, 3);
  second.director.unlock();
  assert.equal(second.of("drama").currentTime, 164.7);
  second.time.advance(4000);
  second.director.setScene("loading");
  near(second.of("drama").currentTime, 164.7 - 0.9, 1e-9);
  second.time.advance(1000);
  near(second.of("drama").currentTime, 164.7 + 0.1, 0.011);
  // Only the last five are kept.
  second.director.setScene("game");
  for (const ms of [5000, 6000, 7000, 8000]) open(second.director, second.time, ms, "game");
  assert.deepEqual(memory.kept.slice(-4), [5, 6, 7, 8]);
  assert.equal(memory.kept.length, 5);
  assert.equal(second.director.expectedLoad, 6);
  // Back on the menu with another load time expected: the build is aimed again.
  second.time.advance(1500);
  assert.deepEqual(second.sounding(), ["calm"]);
  assert.deepEqual([second.of("drama").paused, second.of("drama").volume, second.of("drama").currentTime], [true, 0, 161.2]);
  assert.equal(second.director.readyAt, 161.2);

  // A memory that cannot be read or written is no error: six seconds, learned again.
  const broken = stage({ memory: { read: () => { throw new Error("blocked"); }, write: () => { throw new Error("full"); } } });
  assert.equal(broken.director.expectedLoad, 6);
  open(broken.director, broken.time, 2000, "game");
  assert.equal(broken.director.expectedLoad, 2);
});

test("the page keeps the load times in localStorage, and does without it when it is refused", () => {
  assert.equal(LOAD_SECONDS_KEY, "audio_load_seconds");
  const held = new Map();
  const win = { localStorage: { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) } };
  const memory = loadSecondsMemory(win);
  assert.deepEqual(memory.read(), []);
  memory.write([2, 3.5]);
  assert.equal(held.get("audio_load_seconds"), "[2,3.5]");
  assert.deepEqual(memory.read(), [2, 3.5]);
  held.set("audio_load_seconds", "{not json");
  assert.deepEqual(memory.read(), []);
  held.set("audio_load_seconds", "\"3\"");
  assert.deepEqual(memory.read(), []);
  const refused = loadSecondsMemory({ get localStorage() { throw new Error("denied"); } });
  assert.deepEqual(refused.read(), []);
  refused.write([1]);
  assert.ok(read("src/runtime/ambientMusic.js").includes("memory: loadSecondsMemory(win),"));
});

test("how the loading music ends: on the big hit or a later one, or, with the hit far off, a fade on the build's next accent", () => {
  // The big hit and the loud stretch's hits: never a stop before the big hit.
  assert.deepEqual([...PASSAGE_DRAMA.cuts], [168.6, 174.3, 177.6, 186.4, 193.8, 198.1, 201.55, 206.9, 214.45, 222.05]);
  assert.deepEqual([...PASSAGE_DRAMA.cuts].sort((a, b) => a - b), [...PASSAGE_DRAMA.cuts]);
  assert.equal(PASSAGE_DRAMA.cuts[0], PASSAGE_DRAMA.hit);
  assert.ok(PASSAGE_DRAMA.cuts.every((cut) => cut + PASSAGE_DRAMA.ring < PASSAGE_DRAMA.wrapAt));
  // A hit rings half a second at full, and then the music dies away over 3.2 s.
  assert.deepEqual([PASSAGE_DRAMA.ring, PASSAGE_DRAMA.stopFade], [0.5, 3200]);
  const stop = PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring;
  for (const entry of PASSAGE_DRAMA.entries) assert.ok(cutTimeAfter(entry - PASSAGE_DRAMA.lead) >= stop, `from ${entry}`);
  assert.equal(cutTimeAfter(145.3), stop);
  assert.equal(cutTimeAfter(165.2), stop);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.enter), stop);
  assert.equal(cutTimeAfter(168.8), stop, "its ring is still to come");
  assert.equal(cutTimeAfter(169.05), 174.3 + PASSAGE_DRAMA.ring);
  assert.equal(cutTimeAfter(PASSAGE_DRAMA.cuts.at(-1) + 1), PASSAGE_DRAMA.wrapAt);

  // The exception, for a guess that was badly wrong: the big hit more than 12 s away.
  assert.deepEqual([...PASSAGE_DRAMA.accents], [149.9, 157.45]);
  assert.deepEqual([PASSAGE_DRAMA.softBeyond, PASSAGE_DRAMA.softFade], [12, 1500]);
  assert.deepEqual(exitAfter(144.4), { at: 149.9, soft: true });
  assert.deepEqual(exitAfter(145.5), { at: 149.9, soft: true });
  assert.deepEqual(exitAfter(149.9), { at: 149.9, soft: true });
  assert.deepEqual(exitAfter(149.95), { at: 157.45, soft: true }, "the accent has passed: the next one");
  assert.deepEqual(exitAfter(156.5), { at: 157.45, soft: true });
  // Twelve seconds or less to the hit: it runs on to it.
  assert.deepEqual(exitAfter(156.6), { at: stop, soft: false });
  assert.deepEqual(exitAfter(157.5), { at: stop, soft: false });
  assert.deepEqual(exitAfter(160.3), { at: stop, soft: false });
  assert.deepEqual(exitAfter(165.2), { at: stop, soft: false });
  assert.deepEqual(exitAfter(170), { at: 174.3 + PASSAGE_DRAMA.ring, soft: false });
  assert.deepEqual(exitAfter(225), { at: PASSAGE_DRAMA.wrapAt, soft: false });
  // Never a long wait either way: the music has begun to end within twelve and a half seconds.
  for (let at = PASSAGE_DRAMA.entries[0] - PASSAGE_DRAMA.lead; at < PASSAGE_DRAMA.wrapAt; at += 0.05) assert.ok(exitAfter(at).at - at < 12.5, `from ${at}`);
});

test("the game is drawn: the music runs on to the big hit, lets it ring, and stops without a click", () => {
  const { director, time, of, sounding } = stage();
  director.unlock();
  director.setScene("loading");
  // Loading takes 4 seconds: the build is at 165.2 by then.
  time.advance(4000);
  const audio = of("drama");
  const drawnAt = audio.currentTime;
  near(drawnAt, 165.2, 0.011);
  director.setScene("game");
  const stop = PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring;
  assert.deepEqual([director.cutAt, director.softExit], [stop, false]);
  assert.equal(audio.paused, false, "still playing: it does not stop the moment the game is drawn");
  // Up to the hit, and into its ring; still growing louder on the way.
  time.advance((stop - drawnAt) * 1000 - 100);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  // Then it dies away over 3.2 s, fast at first and then a long tail: an
  // ending, not the piece cut off "at some point in the song".
  const full = 0.25 * PASSAGE_DRAMA.boost;
  time.advance(100 + 800);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume > full * 0.45 && audio.volume < full * 0.65, `a quarter of the way: ${audio.volume}`);
  time.advance(800);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume > full * 0.15 && audio.volume < full * 0.35, `half way: ${audio.volume}`);
  time.advance(1300);
  assert.equal(audio.paused, false, "still dying away after 2.9 s");
  assert.ok(audio.volume > 0 && audio.volume < full * 0.05, `almost gone: ${audio.volume}`);
  time.advance(450);
  assert.equal(audio.paused, true, "gone");
  assert.deepEqual(sounding(), []);
  assert.deepEqual([director.cutAt, director.inDrama], [null, false]);
  // This stage has no in-game pieces: its game is quiet.
  time.advance(10000);
  assert.deepEqual(sounding(), []);
});

test("a game that opens fast is not cut off as the music began: the build carries on under it to the big hit", () => {
  // Games open in a second here, so the build comes in at its last entry.
  const { director, time, of, sounding } = stage({ memory: remembering([1, 1, 1]) });
  director.unlock();
  time.advance(4000);
  const audio = of("drama");
  assert.equal(audio.currentTime, 164.7);
  director.setScene("loading");
  // Drawn half a second after the entry, while the menu's music is still going out.
  time.advance(1400);
  near(audio.currentTime, 164.7 + 0.5, 0.011);
  director.setScene("game");
  const stop = PASSAGE_DRAMA.hit + PASSAGE_DRAMA.ring;
  assert.deepEqual([director.cutAt, director.softExit], [stop, false]);
  // It keeps playing, all the way to the hit and its ring: three and a half more seconds.
  let heardUntil = 0;
  while (audio.currentTime < stop - 0.02) {
    time.advance(20);
    assert.equal(audio.paused, false, `still playing at ${audio.currentTime}`);
    assert.ok(audio.volume > 0.2, `and heard: ${audio.volume}`);
    heardUntil = audio.currentTime;
  }
  assert.ok(heardUntil > PASSAGE_DRAMA.hit + 0.3, `to ${heardUntil}`);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  time.advance(3400);
  assert.equal(audio.paused, true);
  assert.ok(audio.currentTime >= stop + 3 && audio.currentTime < stop + 3.5, `died away by ${audio.currentTime}`);
  assert.deepEqual(sounding(), []);
});

test("a game drawn while the big hit is still far off: the build fades out on its next accent instead", () => {
  // Games take long here, so this one came in at the start of the build.
  const { director, time, of, sounding } = stage({ memory: remembering([25, 25, 25]), gamePieces: MUSIC_GAME_PIECES });
  director.unlock();
  director.setScene("loading");
  time.advance(200);
  const audio = of("drama");
  near(audio.currentTime, 145.5, 0.011);
  director.setScene("atWar");
  assert.deepEqual([director.cutAt, director.softExit], [149.9, true]);
  // Up to the accent it plays on as it was.
  time.advance((149.9 - audio.currentTime) * 1000 - 50);
  assert.equal(audio.paused, false);
  const full = 0.25 * boostAt(149.85, 145.3);
  near(audio.volume, full, 0.002);
  // Then a second and a half of fading: half gone at the middle of it, never a stop.
  time.advance(50 + 750);
  assert.equal(audio.paused, false);
  near(audio.volume, full / 2, 0.02);
  time.advance(700);
  assert.equal(audio.paused, false);
  assert.ok(audio.volume > 0 && audio.volume < 0.03);
  time.advance(100);
  assert.equal(audio.paused, true);
  assert.deepEqual(sounding(), []);
  assert.deepEqual([director.cutAt, director.softExit, director.inDrama], [null, false, false]);
  assert.ok(audio.currentTime > 151.3 && audio.currentTime < 151.6, `gone by ${audio.currentTime}, long before the big hit`);
  // The breath, and then the music of a game at war, as after a stop.
  time.advance(1300);
  assert.deepEqual(sounding(), []);
  time.advance(400);
  assert.deepEqual(sounding(), ["war"]);
});

// "Add these new tracks to play in the background ingame."
// And then: "have frankincense and discovery be the only 2 game songs, get rid of the other two".
const FRANKINCENSE = "/audio/frankincense-and-myrrh.mp3";
const DISCOVERY = "/audio/discovery.mp3";
const HOPE = "/audio/a-kind-of-hope.mp3";
const GAME_LENGTHS = { [FRANKINCENSE]: 192.2, [DISCOVERY]: 235.3, "/audio/honour-among-thieves.mp3": 240, [HOPE]: 342.6 };
const levelOf = (name, at) => calmGainAt(at, { ...PASSAGE_CALM, ...MUSIC_TRACKS[name].loud });

test("in a game the game's own music plays in the background: after a breath of silence, one piece and then the other, levelled", () => {
  assert.deepEqual(MUSIC_GAME_PIECES, ["frankincenseAndMyrrh", "discovery", "honourAmongThieves", "aKindOfHope"]);
  // "For this one dont actually flatten the loudness, let it be": no table, so it is never levelled.
  assert.equal(MUSIC_TRACKS.aKindOfHope.loud, undefined);
  assert.equal(fs.existsSync(path.join(root, "public", "audio", "a-kind-of-hope.mp3")), true);
  assert.equal(MUSIC_TRACKS.hourOfTheWitch, undefined);
  assert.equal(fs.existsSync(path.join(root, "public", "audio", "hour-of-the-witch.mp3")), false);
  assert.equal(fs.existsSync(path.join(root, "public", "audio", "honour-among-thieves.mp3")), true);
  assert.equal(MUSIC_TRACKS.honourAmongThieves.loud.rms.length, Math.ceil(240 / 5));
  // Each was measured for the whole of it, five seconds at a time.
  assert.equal(MUSIC_TRACKS.frankincenseAndMyrrh.loud.rms.length, Math.ceil(192.2 / 5));
  assert.equal(MUSIC_TRACKS.discovery.loud.rms.length, Math.ceil(235.3 / 5));
  const { director, time, of, sounding } = stage({ gamePieces: MUSIC_GAME_PIECES, lengths: GAME_LENGTHS });
  director.unlock();
  director.setScene("loading");
  time.advance(1000);
  assert.equal(of("game"), null, "nothing of it is made while the game opens");
  director.setScene("game");
  // Run to the hit, through its dying away and the breath after it.
  time.advance(14000);
  assert.equal(of("drama").paused, true);
  assert.deepEqual(sounding(), ["game"]);
  const audio = of("game");
  assert.equal(audio.src, FRANKINCENSE);
  assert.equal(audio.loop, false);
  assert.ok(audio.currentTime < 2.5, `from its start: ${audio.currentTime}`);
  // It comes in slowly, to its own level.
  assert.ok(audio.volume < 0.25 * levelOf("frankincenseAndMyrrh", audio.currentTime));
  time.advance(4000);
  near(audio.volume, 0.25 * levelOf("frankincenseAndMyrrh", audio.currentTime), 0.01);
  // In its loud stretch it is brought down: it is the background.
  time.advance(100000 - audio.currentTime * 1000);
  near(audio.volume, 0.25 * levelOf("frankincenseAndMyrrh", audio.currentTime), 0.004);
  assert.ok(audio.volume < 0.25 * 0.65, `under the game: ${audio.volume}`);
  // "When in war, it doesnt play the war song": at war the war pieces take
  // its place, and it waits where it was for the peace.
  const heldAt = audio.currentTime;
  director.setScene("atWar");
  time.advance(2000);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(of("war").src, "/audio/legionnaire.mp3");
  assert.equal(audio.paused, true);
  // Into the war room and out of it, still at war: the same piece, never broken off.
  const war = of("war");
  const [plays, pauses] = [war.plays, war.pauses];
  director.setScene("war");
  time.advance(3000);
  director.setScene("atWar");
  time.advance(3000);
  assert.deepEqual(sounding(), ["war"]);
  assert.deepEqual([war.plays, war.pauses, war.volume], [plays, pauses, 0.25]);
  near(war.currentTime, 8, 0.1);
  // Peace: the game's own piece again, from where it was.
  director.setScene("game");
  time.advance(4000);
  assert.deepEqual(sounding(), ["game"]);
  near(audio.currentTime, heldAt + 0.9 + 4, 0.2);
  // It ends, and the other piece follows from its start, at its own level.
  time.advance((192.2 - audio.currentTime) * 1000 + 600);
  assert.equal(audio.src, DISCOVERY);
  assert.ok(audio.currentTime < 1, `from its start: ${audio.currentTime}`);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * levelOf("discovery", audio.currentTime), 0.01);
  // Then the third.
  time.advance(235300 + 600);
  assert.equal(audio.src, "/audio/honour-among-thieves.mp3");
  assert.ok(audio.currentTime < 2.5, `from its start: ${audio.currentTime}`);
  // Then the fourth, as recorded: the game's level whole, wherever it is.
  time.advance(240000 + 600);
  assert.equal(audio.src, HOPE);
  assert.ok(audio.currentTime < 2.5, `from its start: ${audio.currentTime}`);
  time.advance(200000);
  near(audio.volume, 0.25, 0.001);
  // And round: the first again after it, from its start.
  time.advance((342.6 - audio.currentTime) * 1000 + 600);
  assert.equal(audio.src, FRANKINCENSE);
  assert.ok(audio.currentTime < 2.5, `from its start: ${audio.currentTime}`);
  assert.deepEqual(sounding(), ["game"]);
});

test("the war room takes the game's music's place, and the game's carries on from where it was", () => {
  const { director, time, of, sounding } = stage({ gamePieces: MUSIC_GAME_PIECES, lengths: GAME_LENGTHS });
  director.unlock();
  director.setScene("game");
  time.advance(30000);
  const audio = of("game");
  assert.deepEqual(sounding(), ["game"]);
  director.setScene("war");
  time.advance(2000);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(audio.paused, true);
  const held = audio.currentTime;
  time.advance(20000);
  director.setScene("game");
  time.advance(4000);
  assert.deepEqual(sounding(), ["game"]);
  assert.equal(audio.src, FRANKINCENSE);
  near(audio.currentTime, held + 4, 0.1);
  // A scenario's own music for the game takes its place altogether.
  director.setPlaylists({ game: [hubTrack("a")] });
  time.advance(2000);
  assert.deepEqual(sounding(), ["scenario:game"]);
  director.setPlaylists(null);
  time.advance(4000);
  assert.deepEqual(sounding(), ["game"]);
  // On the menu it is silent, and it is never the menu's music.
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
});

// "Have it randomly pick one track or the other, make it do the same for the war room."
test("each game starts on one of the game's pieces, picked at random, from its start", () => {
  // The rolls: the menu the game opens on, the first game's piece, the menu come back to, the second game's piece.
  const { director, time, of, sounding } = stage({ gamePieces: MUSIC_GAME_PIECES, lengths: GAME_LENGTHS, random: rolls(0, 0.3, 0, 0.1) });
  director.unlock();
  director.setScene("game");
  time.advance(40000);
  const audio = of("game");
  assert.equal(audio.src, DISCOVERY);
  near(audio.currentTime, 40, 0.1);
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  director.setScene("game");
  time.advance(5000);
  assert.equal(audio.src, FRANKINCENSE);
  near(audio.currentTime, 5, 0.1);
  // The same piece picked again for the next game: from its start, not from where it was left.
  time.advance(60000);
  director.setScene("menu");
  time.advance(3000);
  director.setScene("game");
  time.advance(5000);
  assert.equal(audio.src, FRANKINCENSE);
  near(audio.currentTime, 5, 0.1);
});

test("each game's war room starts on one of its two pieces, picked at random, and carries on with it", () => {
  // The rolls: the menu, the first game's war room, the menu again, the second game's war room.
  const { director, time, of, sounding } = stage({ random: rolls(0, 0.9, 0, 0.2) });
  director.unlock();
  director.setScene("game");
  time.advance(1000);
  director.setScene("war");
  time.advance(10000);
  const audio = of("war");
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(audio.src, "/audio/vanguard.mp3");
  // Left and come back to in the same game: the same piece, from where it was.
  director.setScene("game");
  time.advance(5000);
  director.setScene("war");
  time.advance(3000);
  assert.equal(audio.src, "/audio/vanguard.mp3");
  near(audio.currentTime, 13.9, 0.2);
  // Another game: picked afresh, from its start.
  director.setScene("menu");
  time.advance(3000);
  director.setScene("game");
  time.advance(1000);
  director.setScene("war");
  time.advance(4000);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  near(audio.currentTime, 4, 0.1);
  // The top of the range is still the last piece, never past it.
  const edge = stage({ random: rolls(0, 0.999999) });
  edge.director.unlock();
  edge.director.setScene("war");
  edge.time.advance(2000);
  assert.equal(edge.of("war").src, "/audio/vanguard.mp3");
});

test("a game still loading at the end of the loud stretch goes round it again, as loud, and never into the build", () => {
  const { director, time, of } = stage();
  director.unlock();
  director.setScene("loading");
  time.advance((PASSAGE_DRAMA.wrapAt - 161.2 + 2) * 1000);
  const audio = of("drama");
  // Back to just before the big hit: the loud stretch only, and as loud.
  assert.deepEqual([PASSAGE_DRAMA.enter, PASSAGE_DRAMA.wrapAt], [168.45, 226.4]);
  assert.ok(audio.currentTime >= PASSAGE_DRAMA.enter && audio.currentTime < PASSAGE_DRAMA.enter + 3, `went round: ${audio.currentTime}`);
  assert.equal(audio.paused, false);
  near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  let earliest = 999;
  let latest = 0;
  for (let ms = 0; ms < 3 * 60 * 1000; ms += 20) {
    time.advance(20);
    earliest = Math.min(earliest, audio.currentTime);
    latest = Math.max(latest, audio.currentTime);
    near(audio.volume, 0.25 * PASSAGE_DRAMA.boost, 1e-9);
  }
  assert.ok(earliest >= PASSAGE_DRAMA.enter, `never before the loud stretch: ${earliest}`);
  assert.ok(latest <= PASSAGE_DRAMA.wrapAt + 0.05, `never past it: ${latest}`);
  // Drawn at last: it stops on the next hit, as ever.
  director.setScene("game");
  assert.equal(director.cutAt, cutTimeAfter(audio.currentTime));
  assert.equal(director.softExit, false);
});

test("a build found playing the piece's opening is put back where it belongs, and one that cannot be moved is left alone", () => {
  // Some browsers do not keep where an element that has never played was told to start.
  const { director, time, of } = stage({ menuPieces: [] });
  director.unlock();
  time.advance(3000);
  director.setScene("loading");
  const audio = of("drama");
  audio.currentTime = 0;
  time.advance(60);
  assert.ok(audio.currentTime >= 161.2 && audio.currentTime < 161.3, `back at its entry: ${audio.currentTime}`);
  // Three times at most in one loading: after that it plays from where it is.
  for (const expected of [true, true, false]) {
    audio.currentTime = 1;
    time.advance(60);
    assert.equal(audio.currentTime > 161, expected);
  }
  assert.equal(audio.paused, false);
  // The next game opening starts the count again.
  director.setScene("menu");
  time.advance(3000);
  director.setScene("loading");
  audio.currentTime = 0;
  time.advance(60);
  assert.ok(audio.currentTime > 161);
});

test("the war room, or a battlefield shown: Legionnaire; back in the game it stops", () => {
  const { director, time, of, sounding } = stage({ menuPieces: [] });
  director.unlock();
  director.setScene("game");
  time.advance(3000);
  assert.deepEqual(sounding(), [], "the menu's music has faded");
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(of("war").src, "/audio/legionnaire.mp3");
  assert.equal(of("war").volume, 0.25);
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  // And back from it into a game at war: the war pieces carry on.
  director.setScene("war");
  time.advance(1500);
  director.setScene("atWar");
  time.advance(1500);
  assert.deepEqual(sounding(), ["war"]);
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  // Opened while the loading music is still running to its hit: that music
  // stops now, hit or no hit.
  director.setScene("loading");
  time.advance(1000);
  director.setScene("game");
  assert.notEqual(director.cutAt, null);
  director.setScene("war");
  assert.equal(director.cutAt, null);
  // It does not wait for a hit: it goes out as Legionnaire comes in.
  time.advance(1000);
  assert.equal(of("drama").paused, true, "at once");
  time.advance(500);
  assert.deepEqual(sounding(), ["war"]);
  // Opened straight from a game still opening, in the middle of the crossing: both elements stop.
  director.setScene("menu");
  time.advance(4000);
  director.setScene("loading");
  time.advance(900);
  assert.deepEqual(sounding(), ["calm", "drama"]);
  director.setScene("war");
  time.advance(1000);
  assert.deepEqual([of("calm").paused, of("drama").paused], [true, true]);
  assert.equal(director.inDrama, false);
  time.advance(500);
  assert.deepEqual(sounding(), ["war"]);
  // And the menu takes over from anything.
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  assert.ok(of("calm").currentTime < 5);
});

test("the war room's music is a list of the game's own: Legionnaire, then Vanguard, then Legionnaire again", () => {
  assert.deepEqual([...MUSIC_WAR_PIECES], ["war", "vanguard"]);
  assert.deepEqual(MUSIC_WAR_PIECES.map((name) => MUSIC_TRACKS[name].file), ["audio/legionnaire.mp3", "audio/vanguard.mp3"]);
  const lengths = { "/audio/legionnaire.mp3": 190, "/audio/vanguard.mp3": 235 };
  const { director, made, time, of, sounding } = stage({ lengths });
  director.unlock();
  director.setScene("game");
  time.advance(3000);
  director.setScene("war");
  time.advance(1500);
  // A session starts on Legionnaire, and nothing of Vanguard has been asked for.
  assert.deepEqual(sounding(), ["war"]);
  const audio = of("war");
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.volume], ["/audio/legionnaire.mp3", false, "none", 0.25]);
  assert.equal(audio.loads, 1);
  assert.ok(!made.some((element) => element.src === "/audio/vanguard.mp3"), "only the piece about to play has been requested");
  // Up to the last second of Legionnaire: still only that file.
  time.advance(187000);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  assert.equal(audio.loads, 1);
  // It ends: Vanguard, at once and at the same level.
  time.advance(2500);
  assert.equal(audio.src, "/audio/vanguard.mp3");
  assert.deepEqual([audio.paused, audio.volume, audio.loads], [false, 0.25, 2]);
  assert.ok(audio.currentTime < 2);
  // Leaving the war room fades it out where it is, and coming back carries on with the piece it was on.
  time.advance(60000);
  const leftAt = audio.currentTime;
  director.setScene("game");
  time.advance(400);
  assert.ok(audio.volume > 0 && audio.volume < 0.25, "fading, not cut");
  time.advance(1100);
  assert.deepEqual(sounding(), [], "at peace outside the war room there are no war pieces");
  assert.equal(audio.paused, true);
  time.advance(30000);
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(audio.src, "/audio/vanguard.mp3");
  near(audio.currentTime, leftAt + 0.9 + 1.5, 0.05);
  assert.equal(audio.loads, 2, "the same file, not asked for again");
  // Vanguard ends: round again, Legionnaire from its start.
  time.advance((235 - audio.currentTime) * 1000 + 500);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  assert.equal(audio.paused, false);
  assert.ok(audio.currentTime < 1);
  assert.equal(made.filter((element) => /legionnaire|vanguard/.test(element.src)).length, 1, "one element for the two pieces");
  // The menu and a new game do not start it over: the list is the session's.
  director.setScene("menu");
  time.advance(3000);
  director.setScene("war");
  time.advance(1500);
  assert.equal(audio.src, "/audio/legionnaire.mp3");
  assert.ok(audio.currentTime > 1);
});

test("a war piece that cannot be played is passed over; with neither, the war room is silent and nothing breaks", async () => {
  const one = stage({ broken: ["/audio/legionnaire.mp3"] });
  one.director.unlock();
  one.director.setScene("war");
  await settle();
  one.time.advance(1500);
  assert.deepEqual(one.sounding(), ["war"]);
  assert.equal(one.of("war").src, "/audio/vanguard.mp3");
  const neither = stage({ broken: ["/audio/legionnaire.mp3", "/audio/vanguard.mp3"] });
  neither.director.unlock();
  neither.director.setScene("war");
  await settle();
  await settle();
  neither.time.advance(3000);
  assert.deepEqual(neither.sounding(), []);
  assert.equal(neither.of("war").plays, 2, "each was tried once, and then it is left alone");
  neither.director.setScene("game");
  neither.director.setScene("war");
  neither.time.advance(1500);
  assert.equal(neither.of("war").plays, 2);
  assert.deepEqual(neither.sounding(), []);
});

test("switched off, it downloads nothing; the switch, the volume and a hidden page are followed at once", () => {
  const off = stage({ enabled: false });
  off.director.unlock();
  off.time.advance(3000);
  assert.equal(off.made.length, 0, "on the menu with the music off, not even the build is made ready");
  off.director.setScene("loading");
  off.director.setScene("game");
  off.director.setScene("war");
  off.time.advance(5000);
  assert.equal(off.made.length, 0);
  // Turned on in the war room: that scene's piece, and only that one.
  off.settings.enabled = true;
  off.director.sync();
  assert.deepEqual(off.sounding(), ["war"]);
  assert.equal(off.made.length, 1);

  const on = stage({ volume: 50 });
  on.director.unlock();
  on.time.advance(3000);
  // The opening is turned up by the levelling: 50% times 1.6.
  near(on.of("calm").volume, 0.8, 1e-9);
  on.settings.volume = 10;
  on.director.sync();
  near(on.of("calm").volume, 0.16, 1e-9);
  assert.equal(on.of("calm").plays, 1, "a change of volume does not start it again");
  // Never past full volume, whatever the levelling asks.
  on.settings.volume = 80;
  on.director.sync();
  assert.equal(on.of("calm").volume, 1);
  on.settings.volume = 0;
  on.director.sync();
  assert.equal(on.of("calm").paused, true);
  on.settings.volume = 40;
  on.director.sync();
  assert.equal(on.of("calm").paused, false);
  on.director.setHidden(true);
  assert.equal(on.of("calm").paused, true);
  on.director.setHidden(false);
  assert.equal(on.of("calm").paused, false);
  // While something else is listened to (a track tried out in the editor) it waits, and carries on after.
  on.director.setHeld(true);
  assert.equal(on.of("calm").paused, true);
  on.director.setHeld(false);
  assert.equal(on.of("calm").paused, false);
  // The build held ready stayed silent and still through all of it.
  assert.deepEqual([on.of("drama").paused, on.of("drama").plays, on.of("drama").volume, on.of("drama").currentTime], [true, 0, 0, 161.2]);

  // A hidden page pauses both elements in the middle of their crossing, and both carry on after.
  on.director.setScene("loading");
  on.time.advance(900);
  assert.deepEqual(on.sounding(), ["calm", "drama"]);
  on.director.setHidden(true);
  assert.deepEqual([on.of("calm").paused, on.of("drama").paused], [true, true]);
  on.time.advance(100);
  on.director.setHidden(false);
  assert.deepEqual([on.of("calm").paused, on.of("drama").paused], [false, false]);
  near(on.of("drama").currentTime, 161.2, 0.011);
  // The loud stretch never goes past full volume.
  on.settings.volume = 80;
  on.director.sync();
  on.time.advance(1100);
  assert.deepEqual(on.sounding(), ["drama"]);
  assert.ok(on.of("drama").volume > 0.79 && on.of("drama").volume < 0.9, `little louder than the player's volume near the entry: ${on.of("drama").volume}`);
  on.time.advance(8000);
  assert.equal(on.of("drama").volume, 1);
});

test("a game opened before the first click starts in the right place at that click", () => {
  const loading = stage();
  loading.director.setScene("loading");
  assert.equal(loading.made.length, 0);
  loading.director.unlock();
  // The build could not be made ready, and there is no menu music to cross
  // with: it comes in from the entry itself, over the same 1.8 seconds.
  assert.equal(loading.made.length, 1);
  assert.deepEqual([loading.of("drama").currentTime, loading.of("drama").volume, loading.of("drama").paused], [161.2, 0, false]);
  loading.time.advance(300);
  near(loading.of("drama").currentTime, 161.2 + 0.3, 0.011);
  assert.equal(loading.director.inDrama, true);
  assert.ok(loading.of("drama").volume > 0.03 && loading.of("drama").volume < 0.1, `coming in: ${loading.of("drama").volume}`);
  loading.time.advance(1550);
  near(loading.of("drama").volume, 0.25 * boostAt(loading.of("drama").currentTime, 161.2), 0.002);
  assert.deepEqual(loading.sounding(), ["drama"]);
  assert.equal(loading.of("calm"), null, "the menu's element was never needed");
  // A click late in the loading: the entry is for what is left of it. 5.5 of
  // the expected 6 seconds are gone, and the last entry is the latest there is.
  const lateClick = stage();
  lateClick.director.setScene("loading");
  lateClick.time.advance(5500);
  lateClick.director.unlock();
  lateClick.time.advance(100);
  near(lateClick.of("drama").currentTime, 164.7 + 0.1, 0.011);
  // Already in the game by the first click: no loading music at all.
  const late = stage();
  late.director.setScene("loading");
  late.director.setScene("game");
  late.director.unlock();
  late.time.advance(3000);
  assert.deepEqual(late.sounding(), []);
  assert.equal(late.made.length, 0);
});

test("a browser that still refuses is asked again at the next click; a file that cannot play is left alone", async () => {
  const refused = stage({ refuse: "NotAllowedError" });
  refused.director.unlock();
  await settle();
  assert.equal(refused.director.unlocked, false);
  refused.director.unlock();
  assert.equal(refused.of("calm").plays, 2);
  const broken = stage({ refuse: "NotSupportedError" });
  broken.director.unlock();
  await settle();
  assert.equal(broken.director.unlocked, true);
});

test("the scene is where the player is", () => {
  assert.deepEqual([...MUSIC_SCENES], ["menu", "loading", "game", "atWar", "war"]);
  assert.equal(musicSceneOf({ inMenu: true, loading: true, atWar: true, war: true }), "menu");
  assert.equal(musicSceneOf({ loading: true, atWar: true, war: true }), "loading");
  assert.equal(musicSceneOf({ atWar: true, war: true }), "war");
  assert.equal(musicSceneOf({ war: true }), "war");
  assert.equal(musicSceneOf({ atWar: true }), "atWar");
  assert.equal(musicSceneOf({}), "game");
  const screen = read("src/Game/GameUI/main.jsx");
  assert.ok(screen.includes("const battlefieldShown = useWarRoom((room) => room.open || Boolean(room.battlefield));"));
  // At war is what puts the war room's button on the screen: the player's troops on a battlefield.
  // (Battlefields being on is the Wars feature's Fronts switch.)
  assert.ok(screen.includes("const atWar = hasFronts && fightingIn(warFronts);"));
  assert.ok(screen.includes("musicSceneOf({ inMenu: mainMenuOpen || hasNoGames, loading: showGameLoading, atWar: atWar || inWar, war: battlefieldShown })"));
  assert.ok(screen.includes("useEffect(() => { setMusicScene(musicScene); }, [musicScene]);"));
  // The open game's scenario's own music, told before the scene it is for.
  // Of the OPEN game: the game last played has no say before the player opens one (gameEntry.js).
  assert.ok(screen.includes("const scenarioMusicKey = JSON.stringify((gameEntered && activeGame?.id && runtimeScenario?.music) || null);"));
  assert.ok(screen.includes("useEffect(() => { followScenarioMusic(JSON.parse(scenarioMusicKey)); }, [scenarioMusicKey]);"));
  assert.ok(screen.indexOf("followScenarioMusic(JSON.parse(scenarioMusicKey))") < screen.indexOf("setMusicScene(musicScene)"));
  // Started once, for every build, where the page starts; and no page, no music, no error.
  assert.ok(read("src/main.jsx").includes("startMusic({ env: import.meta.env });"));
  assert.equal(startMusic({ win: null, doc: null }), null);
  setMusicScene("war");
  setMusicPlaylists({ game: [hubTrack("a")] });
  holdMusic(true);
  assert.equal(getNowPlaying(), null);
  assert.equal(typeof subscribeNowPlaying(() => {}), "function");
});

test("the stored volume is a whole number from 0 to 100, and the default when it is not one", () => {
  assert.equal(musicVolumeOf("40"), 40);
  assert.equal(musicVolumeOf("0"), 0);
  assert.equal(musicVolumeOf("250"), 100);
  assert.equal(musicVolumeOf("-3"), 0);
  assert.equal(musicVolumeOf("12.6"), 13);
  for (const none of ["", null, undefined, "loud", "NaN"]) assert.equal(musicVolumeOf(none), DEFAULT_MUSIC_VOLUME);
});

test("the files are the game's own, beside the page in every build", () => {
  assert.equal(musicAddress("audio/x.mp3", "/"), "/audio/x.mp3");
  assert.equal(musicAddress("audio/x.mp3", "/play/"), "/play/audio/x.mp3");
  assert.equal(musicAddress("audio/x.mp3", "./"), "./audio/x.mp3");
  assert.equal(musicAddress("audio/x.mp3", undefined), "/audio/x.mp3");
  for (const track of Object.values(MUSIC_TRACKS).filter(Boolean)) {
    const file = path.join(root, "public", track.file);
    assert.ok(fs.existsSync(file), track.file);
    // An MP3, by its first bytes: an ID3 tag, or a frame.
    const head = fs.readFileSync(file).subarray(0, 3);
    assert.ok(head.toString("latin1") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0), track.file);
  }
});

test("it is on unless the player turns it off, and Settings says whose music it is", () => {
  const settings = read("src/Game/GameUI/settings.jsx");
  assert.ok(settings.includes("ambientMusic: getMapSettingDefaultOn(MAP_SETTING_KEYS.ambientMusic),"));
  assert.ok(read("src/runtime/ambientMusic.js").includes("export const musicEnabled = () => getMapSettingDefaultOn(MAP_SETTING_KEYS.ambientMusic);"));
  assert.equal(typeof MAP_SETTING_KEYS.ambientMusic, "string");
  assert.equal(typeof MAP_SETTING_KEYS.musicVolume, "string");
  // The licence's condition: the titles, the author, the licence, and where they are from.
  // The sentence is one for any number of pieces: the names are read from
  // MUSIC_TRACKS, so a piece added there is credited, and are never translated.
  assert.ok(settings.includes("<span>{\"Music by Scott Buckley, released under CC BY 4.0:\"}</span>"));
  assert.ok(settings.includes("<span data-no-translate>{MUSIC_WORKS}</span>"));
  assert.ok(settings.includes("const MUSIC_WORKS = Object.values(MUSIC_TRACKS).filter(Boolean).map((track) => `“${track.work}”`).join(\", \");"));
  assert.ok(!settings.includes("“Passage Of Time”"), "no sentence that names the pieces one by one is left");
  assert.ok(settings.includes("href={MUSIC_CREDIT.siteUrl}"));
  assert.deepEqual([MUSIC_CREDIT.artist, MUSIC_CREDIT.licence, MUSIC_CREDIT.site], ["Scott Buckley", "CC BY 4.0", "www.scottbuckley.com.au"]);
  // Every piece has its composer's name for it, and the sentence names each of them.
  assert.deepEqual([MUSIC_TRACKS.passage.work, MUSIC_TRACKS.war.work, MUSIC_TRACKS.vanguard.work, MUSIC_TRACKS.clearSkies.work], ["Passage Of Time", "Legionnaire (2022 Remaster)", "Vanguard", "Clear Skies"]);
  assert.deepEqual([MUSIC_TRACKS.frankincenseAndMyrrh.work, MUSIC_TRACKS.discovery.work], ["Frankincense and Myrrh", "Discovery"]);
  // Every levelled piece was measured for the whole of it, and no figure is nothing (it is divided by).
  for (const piece of Object.values(MUSIC_TRACKS).filter((track) => track.loud)) {
    assert.ok(piece.loud.rms.length >= 30, piece.work);
    assert.ok(piece.loud.rms.every((figure) => figure > 0), piece.work);
  }
  const pieces = Object.values(MUSIC_TRACKS).filter(Boolean);
  assert.equal(pieces.length, 8);
  for (const piece of pieces) {
    assert.deepEqual([piece.artist, piece.licence], ["Scott Buckley", "CC BY 4.0"]);
  }
  const credits = read("public/audio/CREDITS.txt");
  for (const part of ["Passage Of Time", "Clear Skies", "Frankincense and Myrrh", "Discovery", "Legionnaire (2022 Remaster)", "Vanguard", "Scott Buckley", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "scottbuckley.com.au"]) assert.ok(credits.includes(part), part);
  // The licence asks that a change be said: the files are re-encoded, and nothing else.
  assert.ok(credits.includes("re-encoded at a lower"));
  assert.ok(credits.includes("Nothing else about them is changed"));
  assert.ok(!credits.includes("The files are the composer's own, unchanged."));
  // Each says so in itself too, with its piece, its composer and the licence.
  for (const piece of pieces) {
    const tags = fs.readFileSync(path.join(root, "public", piece.file)).subarray(0, 2048).toString("latin1");
    assert.ok(tags.startsWith("ID3"), piece.file);
    const change = piece === MUSIC_TRACKS.aKindOfHope ? "As released by the composer, not re-encoded" : "Re-encoded at a lower bitrate for Open Historia";
    for (const part of [piece.work, "Scott Buckley", "CC BY 4.0", change]) assert.ok(tags.includes(part), `${piece.file}: ${part}`);
  }
  // A piece the game is put at a time in, part of the way through, is constant
  // bitrate: a browser lands about 0.3 s off in a variable-bitrate MP3, and
  // every hit the loading music stops on would move. An encoder marks a
  // constant-bitrate file "Info" and a variable one "Xing", in its first frame.
  const kindOf = (piece) => {
    const head = fs.readFileSync(path.join(root, "public", piece.file)).subarray(0, 8192).toString("latin1");
    return head.includes("Info") ? "constant" : head.includes("Xing") ? "variable" : "unmarked";
  };
  for (const piece of [MUSIC_TRACKS.passage, ...pieces.filter((entry) => entry.drama)]) assert.equal(kindOf(piece), "constant", piece.file);
  assert.equal(kindOf(MUSIC_TRACKS.clearSkies), "constant");
  // And they are small: the eight together under 50 MB ("A Kind Of Hope" is the composer's own 320 kbps file, at the owner's word).
  const total = pieces.reduce((sum, piece) => sum + fs.statSync(path.join(root, "public", piece.file)).size, 0);
  assert.ok(total < 50 * 1024 * 1024, `${Math.round(total / 1048576)} MB`);
  // Each file by its name, its piece, where it is from, and where it plays.
  const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const piece of pieces) {
    assert.match(credits, new RegExp(`${literally(path.basename(piece.file))}\\r?\\n {4}"${literally(piece.work)}" by Scott Buckley\\r?\\n {4}https://www\\.scottbuckley\\.com\\.au/library/`), piece.file);
  }
  assert.match(credits, /vanguard\.mp3\r?\n {4}"Vanguard" by Scott Buckley\r?\n {4}https:\/\/www\.scottbuckley\.com\.au\/library\/vanguard\/\r?\n {4}Plays in the war room and while a battlefield is shown\./);
  const readme = read("README.md");
  assert.ok(readme.includes("\"Passage Of Time\", \"Clear Skies\", \"Frankincense and Myrrh\", \"Discovery\", \"Honour Among Thieves\", \"A Kind Of Hope\", \"Legionnaire (2022 Remaster)\" and \"Vanguard\", all released under [CC BY 4.0]"));
  for (const gone of ["Hour Of The Witch"]) assert.ok(!credits.includes(gone) && !readme.includes(gone), gone);
  assert.ok(readme.includes("re-encoded at a lower bitrate to make the game smaller and otherwise unchanged"));
  assert.ok(credits.includes("a-kind-of-hope.mp3 is the composer's own file"));
  for (const file of ["frankincense-and-myrrh", "discovery", "honour-among-thieves", "a-kind-of-hope"]) {
    assert.match(credits, new RegExp(`${file}\\.mp3\\r?\\n {4}"[^"]+" by Scott Buckley\\r?\\n {4}https://www\\.scottbuckley\\.com\\.au/library/${file}/\\r?\\n {4}Plays in a game, in the background\\.`), file);
  }
  assert.match(credits, /clear-skies\.mp3\r?\n {4}"Clear Skies" by Scott Buckley\r?\n {4}https:\/\/www\.scottbuckley\.com\.au\/library\/clear-skies\/\r?\n {4}Plays on the menu, in turn with Passage Of Time, and from its own build\r?\n {4}on while a game opened under it loads\./);
  // A scenario's own track is the hub's, and its licence asks the same: the
  // one sounding is credited in the hub's words, which are never translated,
  // with where it is from.
  assert.ok(settings.includes("const nowPlaying = useSyncExternalStore(subscribeNowPlaying, getNowPlaying, getNowPlaying);"));
  assert.ok(settings.includes("<span>{\"Now playing:\"}</span>"));
  assert.ok(settings.includes("<span data-no-translate>{nowPlaying.credit}</span>"));
  assert.ok(settings.includes("<a data-no-translate href={nowPlaying.source} target=\"_blank\" rel=\"noopener noreferrer\""));
});

// ---- the menu's other pieces -------------------------------------------------------
// "Add these as main menu themes too ... actually, add clearskies not viktor lux."

const CLEAR = "/audio/clear-skies.mp3";
const clearLevel = (at) => calmGainAt(at, { ...PASSAGE_CALM, ...MUSIC_TRACKS.clearSkies.loud });

test("the menu has a second piece: after Passage Of Time's part, Clear Skies whole, then Passage Of Time again", () => {
  assert.deepEqual(MUSIC_MENU_PIECES, ["clearSkies"]);
  // Its loudness was measured for the whole of it: 195 seconds, five at a time.
  assert.equal(MUSIC_TRACKS.clearSkies.loud.rms.length * MUSIC_TRACKS.clearSkies.loud.step, 195);
  const { director, time, of, sounding } = stage({ lengths: { [CLEAR]: 195 } });
  director.unlock();
  time.advance(60000);
  assert.deepEqual(sounding(), ["calm"]);
  // Nothing of the second piece is made or fetched while the first plays.
  assert.equal(of("themes"), null);
  // Passage Of Time reaches the end of its part, in silence, and Clear Skies begins.
  time.advance(83700);
  const calm = of("calm");
  const clear = of("themes");
  assert.deepEqual([calm.paused, calm.currentTime], [true, 0]);
  assert.equal(clear.src, CLEAR);
  assert.equal(clear.paused, false);
  assert.equal(clear.loop, false);
  assert.ok(clear.currentTime < 0.4, `from its start: ${clear.currentTime}`);
  assert.deepEqual(sounding(), ["themes"]);
  // Levelled as the first is, from its own loudness: its faint opening turned
  // up to the most, its loud stretch brought down.
  time.advance(10000);
  near(clear.volume, 0.25 * clearLevel(clear.currentTime), 0.004);
  near(clear.volume, 0.25 * PASSAGE_CALM.most, 0.004);
  time.advance(130000);
  near(clear.volume, 0.25 * clearLevel(clear.currentTime), 0.004);
  near(clear.volume, 0.25 * PASSAGE_CALM.least, 0.004);
  // Its OWN build is held ready under it, at the entry a game opening would use.
  assert.deepEqual([of("clearSkiesDrama").paused, of("clearSkiesDrama").plays, of("clearSkiesDrama").currentTime], [true, 0, 89.45]);
  assert.equal(of("clearSkiesDrama").src, CLEAR);
  assert.deepEqual([of("drama").paused, of("drama").plays], [true, 0]);
  // It plays to its own end, whole, and Passage Of Time starts again.
  time.advance(54000);
  assert.ok(clear.currentTime > 194, `to its end: ${clear.currentTime}`);
  assert.equal(clear.paused, false);
  time.advance(1500);
  assert.equal(clear.paused, true);
  assert.equal(calm.paused, false);
  assert.ok(calm.currentTime < 1.2, `Passage Of Time from its start: ${calm.currentTime}`);
  assert.deepEqual(sounding(), ["calm"]);
  // And round: Clear Skies again after it, from its start, the same element.
  time.advance(144000);
  assert.deepEqual(sounding(), ["themes"]);
  assert.ok(clear.currentTime < 2, `from its start again: ${clear.currentTime}`);
  assert.equal(clear.loads, 1, "its file was asked for once");
  // Never the two at once, at any look of a long idle.
  for (let ms = 0; ms < 12 * 60 * 1000; ms += 250) {
    time.advance(250);
    assert.ok(sounding().length <= 1, `${sounding().join(" + ")} at ${time.now}`);
  }
});

// "Why do they both crossfade into the same song, they should crossfade into
// their own song for the loading."
test("Clear Skies has a build of its own, measured from its file", () => {
  assert.equal(MUSIC_TRACKS.clearSkies.drama, CLEAR_SKIES_DRAMA);
  assert.equal(MUSIC_TRACKS.passage.drama, undefined, "Passage Of Time's is the director's own");
  const d = CLEAR_SKIES_DRAMA;
  // The same shape as Passage Of Time's: entries before the big hit, the hits after it, in order.
  assert.deepEqual(Object.keys(d).sort(), Object.keys(PASSAGE_DRAMA).sort());
  assert.deepEqual([...d.entries].sort((x, y) => x - y), [...d.entries]);
  assert.ok(d.entries.every((entry) => entry < d.hit));
  assert.equal(d.cuts[0], d.hit);
  assert.deepEqual([...d.cuts].sort((x, y) => x - y), [...d.cuts]);
  assert.ok(d.enter < d.hit && d.hit - d.enter < 0.3);
  assert.ok(d.cuts.at(-1) + d.ring < d.wrapAt, "the last hit rings before the stretch goes round");
  assert.ok(d.wrapAt < 195);
  assert.ok(d.accents.every((accent) => d.entries.some((entry) => accent > entry && accent - entry < 0.4)), "each accent just after an entry");
  // A game that opens at once still has four seconds of build; a slow one, the whole of it.
  assert.equal(entryFor(0, d), 93.6);
  assert.equal(entryFor(6, d), 89.45);
  assert.equal(entryFor(60, d), 70.85);
  // The loud stretch is where the file is loud: every hit stands in a stretch
  // at least twice as loud as the piece's first minute.
  const { rms, step } = MUSIC_TRACKS.clearSkies.loud;
  for (const cut of d.cuts) assert.ok(rms[Math.floor(cut / step)] > 0.1, `${cut}: ${rms[Math.floor(cut / step)]}`);
});

test("a game opened early in Clear Skies crosses into Clear Skies' own build, not Passage Of Time's", () => {
  const { director, time, of, sounding } = stage({ lengths: { [CLEAR]: 195 } });
  director.unlock();
  time.advance(143700 + 30000);
  const clear = of("themes");
  assert.deepEqual(sounding(), ["themes"]);
  const before = clear.currentTime;
  assert.ok(before > 29 && before < 31);
  const passageBuildPlays = of("drama").plays;
  director.setScene("loading");
  const build = of("clearSkiesDrama");
  assert.equal(build.src, CLEAR);
  // The two cross: its build comes in a little before the entry, under the menu's element.
  time.advance(900);
  assert.deepEqual(sounding().sort(), ["clearSkiesDrama", "themes"]);
  near(build.currentTime, 89.45, 0.05);
  time.advance(1100);
  assert.deepEqual(sounding(), ["clearSkiesDrama"]);
  assert.equal(clear.paused, true);
  assert.equal(of("drama").plays, passageBuildPlays, "Passage Of Time's build never sounds");
  assert.equal(of("drama").paused, true);
  assert.equal(director.inDrama, true);
  // It grows on the way to its big hit.
  const early = build.volume;
  time.advance(4000);
  assert.ok(build.volume > early);
  // The game is drawn: on to the big hit, which rings, and then it dies away.
  director.setScene("game");
  near(director.cutAt, CLEAR_SKIES_DRAMA.hit + CLEAR_SKIES_DRAMA.ring, 1e-9);
  time.advance((CLEAR_SKIES_DRAMA.hit - build.currentTime) * 1000 + 100);
  assert.equal(build.paused, false);
  near(build.volume, 0.25 * CLEAR_SKIES_DRAMA.boost, 0.01);
  time.advance(CLEAR_SKIES_DRAMA.ring * 1000 + CLEAR_SKIES_DRAMA.stopFade + 300);
  assert.deepEqual(sounding(), []);
  assert.equal(build.paused, true);
});

test("a game opened while Clear Skies is already in its loud stretch: the same element carries on, and swells", () => {
  // The rolls: the menu the game opens on (Passage Of Time), and the two menus come back to further down.
  const { director, made, time, of, sounding } = stage({ lengths: { [CLEAR]: 195 }, random: rolls(0, 0, 0.9) });
  director.unlock();
  time.advance(143700 + 110000);
  const clear = of("themes");
  assert.deepEqual(sounding(), ["themes"]);
  const at = clear.currentTime;
  assert.ok(at > 109 && at < 111);
  const menuLevel = clear.volume;
  near(menuLevel, 0.25 * clearLevel(at), 0.004);
  const elements = made.length;
  const plays = clear.plays;
  director.setScene("loading");
  // Nothing crosses and nothing jumps: no other element sounds at any look,
  // the piece is where it was, and it was never paused or started again.
  let last = clear.currentTime;
  let before = clear.volume;
  for (let ms = 0; ms < 7000; ms += 100) {
    time.advance(100);
    assert.deepEqual(sounding(), ["themes"]);
    near(clear.currentTime, last + 0.1, 0.02);
    assert.ok(clear.volume >= before - 1e-9, "only ever louder");
    last = clear.currentTime;
    before = clear.volume;
  }
  assert.equal(clear.plays, plays);
  assert.equal(made.length, elements, "no element was made for it");
  assert.equal(of("clearSkiesDrama").plays, 0);
  // From the menu's level to the full boost over the next six seconds of the music.
  near(clear.volume, 0.25 * CLEAR_SKIES_DRAMA.boost, 0.005);
  assert.equal(MUSIC_SWELL.seconds, 6);
  assert.equal(director.inDrama, true);
  // The game is drawn: it stops on the next hit of its own loud stretch.
  director.setScene("game");
  const next = CLEAR_SKIES_DRAMA.cuts.find((cut) => cut + CLEAR_SKIES_DRAMA.ring > clear.currentTime + 0.1);
  near(director.cutAt, next + CLEAR_SKIES_DRAMA.ring, 1e-9);
  time.advance((director.cutAt - clear.currentTime) * 1000 + CLEAR_SKIES_DRAMA.stopFade + 300);
  assert.deepEqual(sounding(), []);
  assert.equal(clear.paused, true);
  // Back on the menu Passage Of Time is picked; and for the visit after that, Clear Skies, from its start.
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  director.setScene("game");
  time.advance(3000);
  director.setScene("menu");
  time.advance(2000);
  assert.deepEqual(sounding(), ["themes"]);
  near(clear.currentTime, 2, 0.1);
  near(clear.volume, 0.25 * clearLevel(2), 0.004);
});

test("a game still loading at the end of Clear Skies' loud stretch goes round it again, and a game given up goes back to the menu", () => {
  const { director, time, of, sounding } = stage({ lengths: { [CLEAR]: 195 } });
  director.unlock();
  time.advance(143700 + 140000);
  const clear = of("themes");
  director.setScene("loading");
  let latest = 0;
  for (let ms = 0; ms < 40000; ms += 25) {
    time.advance(25);
    latest = Math.max(latest, clear.currentTime);
    assert.ok(sounding().length <= 1);
  }
  assert.ok(latest < CLEAR_SKIES_DRAMA.wrapAt + 0.05, `never into its quiet ending: ${latest}`);
  assert.ok(clear.currentTime > CLEAR_SKIES_DRAMA.enter && clear.currentTime < CLEAR_SKIES_DRAMA.wrapAt);
  assert.equal(clear.paused, false);
  // Given up: the menu, and a piece picked afresh (here Passage Of Time).
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  assert.equal(clear.paused, true);
});

test("Passage Of Time still goes into its own build, and each visit's game into the build of that visit's piece", () => {
  // The rolls: Passage Of Time, then Clear Skies, then Passage Of Time.
  const { director, time, of, sounding } = stage({ lengths: { [CLEAR]: 195 }, random: rolls(0, 0.9, 0.1) });
  director.unlock();
  time.advance(10000);
  director.setScene("loading");
  time.advance(2500);
  assert.deepEqual(sounding(), ["drama"]);
  assert.equal(of("clearSkiesDrama"), null);
  director.setScene("game");
  time.advance(20000);
  // The second visit is Clear Skies: its game opens into Clear Skies' build.
  director.setScene("menu");
  time.advance(10000);
  assert.deepEqual(sounding(), ["themes"]);
  const passagePlays = of("drama").plays;
  director.setScene("loading");
  time.advance(2500);
  assert.deepEqual(sounding(), ["clearSkiesDrama"]);
  assert.equal(of("drama").plays, passagePlays);
  director.setScene("game");
  time.advance(20000);
  assert.deepEqual(sounding(), []);
  // The third is Passage Of Time again.
  director.setScene("menu");
  time.advance(10000);
  assert.deepEqual(sounding(), ["calm"]);
  director.setScene("loading");
  time.advance(2500);
  assert.deepEqual(sounding(), ["drama"]);
});

// "its always playing passage of time": nobody idles on a menu for the two
// minutes and more the first piece's part takes. And then: "have it randomly
// pick one track or the other".
test("which piece a visit to the menu plays is picked at random: back from a game, from the piece's start", () => {
  // The rolls: Clear Skies to open on, Clear Skies again, Passage Of Time, Clear Skies.
  const { director, time, of, sounding } = stage({ lengths: { [CLEAR]: 195 }, random: rolls(0.9, 0.9, 0.1, 0.6) });
  director.unlock();
  time.advance(20000);
  const clear = of("themes");
  assert.deepEqual(sounding(), ["themes"]);
  near(clear.currentTime, 20, 0.1);
  assert.equal(of("calm"), null, "Passage Of Time is not even made");
  // Its own build is held ready under it.
  assert.deepEqual([of("clearSkiesDrama").paused, of("clearSkiesDrama").plays], [true, 0]);
  assert.equal(of("drama"), null);
  // A game is opened, played, and left.
  director.setScene("loading");
  time.advance(6000);
  director.setScene("game");
  time.advance(40000);
  assert.deepEqual(sounding(), []);
  director.setScene("menu");
  time.advance(1500);
  // The same piece can be picked twice running: from its start, not from where it was left.
  assert.deepEqual(sounding(), ["themes"]);
  near(clear.currentTime, 1.5, 0.1);
  near(clear.volume, 0.25 * clearLevel(clear.currentTime), 0.004);
  time.advance(60000);
  director.setScene("loading");
  time.advance(6000);
  director.setScene("game");
  time.advance(40000);
  director.setScene("menu");
  time.advance(3000);
  // Passage Of Time, from its start.
  assert.deepEqual(sounding(), ["calm"]);
  near(of("calm").currentTime, 3, 0.1);
  assert.equal(clear.paused, true);
  // And Clear Skies again, from its start.
  director.setScene("game");
  time.advance(5000);
  director.setScene("menu");
  time.advance(2000);
  assert.deepEqual(sounding(), ["themes"]);
  near(clear.currentTime, 2, 0.1);
  // Never two at once through any of it.
  for (const to of ["loading", "menu", "game", "menu", "war", "menu"]) {
    director.setScene(to);
    for (let ms = 0; ms < 8000; ms += 250) {
      time.advance(250);
      if (ms >= 2500) assert.ok(sounding().length <= 1, `${sounding().join(" + ")} in ${to}`);
    }
  }
});

test("which piece the game opens on is picked at random, evenly between the menu's pieces", () => {
  for (const [roll, piece] of [[0, "calm"], [0.49, "calm"], [0.5, "themes"], [0.99, "themes"]]) {
    const { director, time, sounding } = stage({ lengths: { [CLEAR]: 195 }, random: rolls(roll) });
    director.unlock();
    time.advance(3000);
    assert.deepEqual(sounding(), [piece], `a roll of ${roll}`);
  }
  // With no other piece the menu is always Passage Of Time.
  const alone = stage({ menuPieces: [], random: rolls(0.99) });
  alone.director.unlock();
  alone.time.advance(3000);
  assert.deepEqual(alone.sounding(), ["calm"]);
  // The page's own director rolls for itself, and keeps nothing about it between sessions.
  const source = read("src/runtime/ambientMusic.js");
  assert.ok(source.includes("  random = Math.random,"));
  assert.ok(!/audio_menu_piece|menuMemory/.test(source));
});

test("with Clear Skies unplayable the menu is Passage Of Time's alone, round and round as it was", async () => {
  const { director, time, of, sounding } = stage({ broken: [CLEAR] });
  director.unlock();
  time.advance(143700);
  await settle();
  time.advance(600);
  assert.deepEqual(sounding(), ["calm"]);
  assert.ok(of("calm").currentTime < 1, `from the top again: ${of("calm").currentTime}`);
  // Not tried again at every seam: once is enough until a game has been played.
  const tried = of("themes").plays;
  time.advance(144000);
  await settle();
  time.advance(600);
  assert.deepEqual(sounding(), ["calm"]);
  assert.equal(of("themes").plays, tried);
});

test("with the music off, or before the first click, the second piece is never fetched", () => {
  const off = stage({ enabled: false, lengths: { [CLEAR]: 195 } });
  off.director.unlock();
  off.time.advance(300000);
  assert.equal(off.made.length, 0);
  const waiting = stage({ lengths: { [CLEAR]: 195 } });
  waiting.time.advance(300000);
  assert.equal(waiting.made.length, 0);
});

// ---- how loud each situation is ------------------------------------------------------
// "Background music when in game and in war should be quieter. The volume
// should be tunable by scenario designers."

test("the music of a game being played is the background: half the player's volume, at peace and at war", () => {
  assert.deepEqual({ ...SCENARIO_MUSIC_VOLUMES }, { loading: 100, game: 50, atWar: 50, battle: 75 });
  const { director, time, of, sounding } = stage({ gamePieces: MUSIC_GAME_PIECES, lengths: GAME_LENGTHS, volumes: SCENARIO_MUSIC_VOLUMES });
  assert.deepEqual(director.levels, { loading: 1, game: 0.5, atWar: 0.5, battle: 0.75 });
  director.unlock();
  // The menu is the whole.
  time.advance(4000);
  near(of("calm").volume, 0.25 * calmGainAt(of("calm").currentTime), 0.01);
  director.setScene("game");
  time.advance(8000);
  const audio = of("game");
  assert.deepEqual(sounding(), ["game"]);
  near(audio.volume, 0.25 * 0.5 * levelOf("frankincenseAndMyrrh", audio.currentTime), 0.006);
  // At war: the war pieces, as quiet.
  director.setScene("atWar");
  time.advance(2000);
  assert.deepEqual(sounding(), ["war"]);
  near(of("war").volume, 0.25 * 0.5, 1e-9);
  // The war room is a screen of its own: louder, and the same piece glides up to it, never restarted.
  const [plays, at] = [of("war").plays, of("war").currentTime];
  director.setScene("war");
  time.advance(450);
  assert.ok(of("war").volume > 0.25 * 0.5 && of("war").volume < 0.25 * 0.75, "gliding");
  time.advance(600);
  near(of("war").volume, 0.25 * 0.75, 1e-9);
  assert.equal(of("war").plays, plays);
  near(of("war").currentTime, at + 1.05, 0.05);
  // And down again, out of it.
  director.setScene("atWar");
  time.advance(1000);
  near(of("war").volume, 0.25 * 0.5, 1e-9);
  // A game opening is the music's moment: the whole.
  director.setScene("menu");
  time.advance(3000);
  director.setScene("loading");
  time.advance(2500);
  near(of("drama").volume, 0.25 * boostAt(of("drama").currentTime, 161.2), 0.01);
});

test("a scenario sets how loud each situation is, for whatever plays there, and the game's own figures come back after it", () => {
  const { director, time, of, list, sounding } = stage({ gamePieces: MUSIC_GAME_PIECES, lengths: GAME_LENGTHS, volumes: SCENARIO_MUSIC_VOLUMES });
  director.unlock();
  director.setScene("game");
  time.advance(8000);
  const audio = of("game");
  near(audio.volume, 0.25 * 0.5 * levelOf("frankincenseAndMyrrh", audio.currentTime), 0.006);
  // The scenario's figures, as its record gives them: the game quieter still, the war room at the whole.
  director.setLevels(scenarioMusicVolumes({ volume: { game: 20, battle: 100 } }));
  assert.deepEqual(director.levels, { loading: 1, game: 0.2, atWar: 0.5, battle: 1 });
  // What is sounding glides to it; nothing is restarted.
  const plays = audio.plays;
  time.advance(400);
  assert.ok(audio.volume > 0.25 * 0.2 * 0.5 && audio.volume < 0.25 * 0.5 * 1.6);
  time.advance(800);
  near(audio.volume, 0.25 * 0.2 * levelOf("frankincenseAndMyrrh", audio.currentTime), 0.004);
  assert.equal(audio.plays, plays);
  director.setScene("war");
  time.advance(1500);
  near(of("war").volume, 0.25, 1e-9);
  // It is the situation's, not the piece's: the scenario's own tracks there are as loud.
  director.setPlaylists({ game: [hubTrack("a")] });
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  near(list("game").audio.volume, 0.25 * 0.2, 1e-9);
  // Silence is a figure too.
  director.setLevels({ game: 0 });
  time.advance(1200);
  assert.equal(list("game").audio.volume, 0);
  // Never more than the player's own volume, and nonsense is the game's own figure.
  director.setLevels({ game: 400, atWar: "loud", battle: -3, loading: NaN });
  assert.deepEqual(director.levels, { loading: 1, game: 1, atWar: 0.5, battle: 0 });
  // Another scenario with nothing to say, or no game: the game's own figures again.
  director.setLevels(null);
  assert.deepEqual(director.levels, { loading: 1, game: 0.5, atWar: 0.5, battle: 0.75 });
  time.advance(1200);
  near(list("game").audio.volume, 0.25 * 0.5, 1e-9);
});

test("a scenario's loading volume is the loading music's, the build's included, and the menu is never a scenario's", () => {
  const { director, time, of } = stage({ volumes: SCENARIO_MUSIC_VOLUMES });
  director.unlock();
  director.setLevels({ loading: 40 });
  time.advance(4000);
  // The menu: the whole, whatever the scenario says.
  near(of("calm").volume, 0.25 * calmGainAt(of("calm").currentTime), 0.01);
  director.setScene("loading");
  time.advance(2500);
  const build = of("drama");
  near(build.volume, 0.25 * 0.4 * boostAt(build.currentTime, 161.2), 0.006);
  // It still stops on its hit and dies away.
  director.setScene("game");
  time.advance(14000);
  assert.equal(build.paused, true);
});

test("the page's music is told the levels through setMusicLevels, with the record and not after the hub's list", () => {
  const source = read("src/runtime/ambientMusic.js");
  assert.ok(source.includes("export const setMusicLevels = (levels) => { started?.setLevels(levels); };"));
  const follower = read("src/runtime/scenarioMusic.js");
  assert.ok(follower.includes("level?.(scenarioMusicVolumes(next));"));
  assert.ok(follower.includes("createScenarioMusicFollower({ play: setMusicPlaylists, level: setMusicLevels, enabled: musicEnabled, known: knownHubMusic, ask: fetchHubMusic })"));
  assert.ok(follower.indexOf("level?.(scenarioMusicVolumes(next));") < follower.indexOf("      apply();\n    },") || follower.includes("level?.(scenarioMusicVolumes(next));\r\n      apply();"));
});

// ---- a scenario's own lists ------------------------------------------------------

test("a scenario's list plays in the place of the game's piece: in order, the next when one ends, round again", () => {
  const said = [];
  const lengths = { "/hub/a.mp3": 30, "/hub/b.mp3": 20, "/hub/c.mp3": 10 };
  const { director, made, time, list, sounding } = stage({ lengths, onNowPlaying: (track) => said.push(track?.id ?? null) });
  director.setPlaylists({ game: [hubTrack("a"), hubTrack("b"), hubTrack("c")] });
  director.unlock();
  time.advance(2000);
  // The menu is never a scenario's.
  assert.deepEqual(sounding(), ["calm"]);
  assert.ok(made.every((element) => element.src === "/audio/passage-of-time.mp3"), "and none of the scenario's files has been asked for");
  assert.deepEqual(said, []);

  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  const audio = list("game").audio;
  assert.deepEqual([audio.src, audio.loop, audio.preload, audio.volume], ["/hub/a.mp3", false, "none", 0.25]);
  assert.equal(audio.loads, 1, "only the track that is playing has been asked for");
  assert.deepEqual(said, ["a"]);
  // It ends: the next, at once and at the list's level.
  time.advance(29000);
  assert.equal(audio.src, "/hub/b.mp3");
  assert.deepEqual([audio.paused, audio.volume], [false, 0.25]);
  assert.ok(audio.currentTime < 1);
  time.advance(20000);
  assert.equal(audio.src, "/hub/c.mp3");
  // Round again at the end.
  time.advance(10000);
  assert.equal(audio.src, "/hub/a.mp3");
  assert.equal(audio.paused, false);
  assert.deepEqual(said, ["a", "b", "c", "a"]);
  assert.equal(made.filter((element) => element.src.startsWith("/hub/")).length, 1, "one element for the list, whatever its length");
  assert.equal(director.nowPlaying.id, "a");

  // One track alone goes round by itself.
  const alone = stage({ lengths: { "/hub/a.mp3": 5 } });
  alone.director.setPlaylists({ game: [hubTrack("a")] });
  alone.director.unlock();
  alone.director.setScene("game");
  alone.time.advance(12500);
  assert.equal(alone.list("game").audio.paused, false);
  near(alone.list("game").audio.currentTime, 2.5, 0.02);
  assert.equal(alone.list("game").audio.loads, 1, "the same file, not asked for again");
});

test("leaving a situation fades its list out where it is, and coming back carries on from there", () => {
  const { director, time, of, list, sounding } = stage({ menuPieces: [], lengths: { "/hub/a.mp3": 30, "/hub/b.mp3": 600 } });
  director.setPlaylists({ game: [hubTrack("a"), hubTrack("b")] });
  director.unlock();
  director.setScene("game");
  // Into the second track.
  time.advance(40000);
  const audio = list("game").audio;
  assert.equal(audio.src, "/hub/b.mp3");
  const leftAt = audio.currentTime;
  // The war room: Legionnaire, since the scenario has nothing for it.
  director.setScene("war");
  time.advance(400);
  assert.ok(audio.volume > 0 && audio.volume < 0.25, "fading, not cut");
  time.advance(1100);
  assert.deepEqual(sounding(), ["war"]);
  assert.equal(audio.paused, true);
  near(audio.currentTime, leftAt + 0.9, 0.05);
  time.advance(60000);
  // Back in the game: the same track, from where it was.
  const heldAt = audio.currentTime;
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  assert.equal(audio.src, "/hub/b.mp3");
  near(audio.currentTime, heldAt + 1.5, 0.02);
  assert.equal(of("war").paused, true);
  // The menu and back again, the same.
  director.setScene("menu");
  time.advance(3000);
  assert.deepEqual(sounding(), ["calm"]);
  const menuAt = audio.currentTime;
  director.setScene("game");
  time.advance(1500);
  assert.equal(audio.src, "/hub/b.mp3");
  near(audio.currentTime, menuAt + 1.5, 0.02);
});

test("a scenario's loading tracks replace the loading music altogether: no build, no stop on a hit", () => {
  const memory = remembering();
  const { director, time, of, list, sounding } = stage({ memory, lengths: { "/hub/intro.mp3": 400 } });
  director.setPlaylists({ loading: [hubTrack("intro")] });
  director.unlock();
  time.advance(3000);
  director.setScene("loading");
  assert.equal(director.inDrama, false);
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:loading"]);
  assert.deepEqual([of("calm").paused, of("calm").currentTime], [true, 0], "the menu's music faded out");
  assert.deepEqual([of("drama").paused, of("drama").plays], [true, 0], "and the build, held ready on the menu, was never played");
  time.advance(2500);
  // The game is drawn: it fades out, with no hit to wait for; and a game is quiet.
  director.setScene("game");
  assert.equal(director.cutAt, null);
  time.advance(450);
  assert.ok(list("loading").audio.volume > 0 && list("loading").audio.volume < 0.25);
  time.advance(600);
  assert.deepEqual(sounding(), []);
  assert.equal(list("loading").audio.paused, true);
  // The loading was timed all the same.
  assert.deepEqual(memory.kept, [4]);

  // With a list for the game too, that comes in as the loading's goes out.
  const both = stage();
  both.director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a")] });
  both.director.unlock();
  both.director.setScene("loading");
  both.time.advance(2000);
  assert.deepEqual(both.sounding(), ["scenario:loading"]);
  both.director.setScene("game");
  both.time.advance(1500);
  assert.deepEqual(both.sounding(), ["scenario:game"]);
  // A scenario with lists but none for loading keeps the game's own loading music.
  const none = stage();
  none.director.setPlaylists({ game: [hubTrack("a")] });
  none.director.unlock();
  none.director.setScene("loading");
  none.time.advance(500);
  assert.deepEqual(none.sounding(), ["drama"]);
  assert.equal(none.director.inDrama, true);
  // And when its stop on a hit has landed and the breath is over, the game's list comes in.
  none.director.setScene("game");
  none.time.advance(14000);
  assert.deepEqual(none.sounding(), ["scenario:game"]);
});

test("at war plays its own list, or the game's when it has none; the war room plays the scenario's battle list", () => {
  const lists = { game: [hubTrack("a")], atWar: [hubTrack("w")], battle: [hubTrack("b")] };
  const { director, time, of, list, sounding } = stage();
  director.setPlaylists(lists);
  director.unlock();
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  director.setScene("atWar");
  time.advance(450);
  assert.deepEqual(sounding(), ["scenario:game", "scenario:atWar"], "one fades into the other");
  time.advance(1050);
  assert.deepEqual(sounding(), ["scenario:atWar"]);
  assert.equal(list("atWar").audio.src, "/hub/w.mp3");
  // The war room or a battlefield shown: the battle list, not Legionnaire.
  director.setScene("war");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:battle"]);
  assert.equal(of("war"), null, "Legionnaire was never asked for");
  director.setScene("atWar");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:atWar"]);
  director.setScene("game");
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);

  // No list for at war: the game's list goes on, untouched.
  const plain = stage();
  plain.director.setPlaylists({ game: [hubTrack("a")] });
  plain.director.unlock();
  plain.director.setScene("game");
  plain.time.advance(5000);
  const audio = plain.list("game").audio;
  const [plays, pauses] = [audio.plays, audio.pauses];
  plain.director.setScene("atWar");
  plain.time.advance(2000);
  assert.deepEqual(plain.sounding(), ["scenario:game"]);
  assert.deepEqual([audio.volume, audio.plays, audio.pauses], [0.25, plays, pauses]);
  near(audio.currentTime, 7, 0.02);
  assert.equal(plain.list("atWar").audio, null);
  // And no battle list: Legionnaire, as in any game.
  plain.director.setScene("war");
  plain.time.advance(1500);
  assert.deepEqual(plain.sounding(), ["war"]);
  // Only an at-war list: a game at peace is as quiet as any, and at war it plays.
  const onlyWar = stage();
  onlyWar.director.setPlaylists({ atWar: [hubTrack("w")] });
  onlyWar.director.unlock();
  onlyWar.director.setScene("game");
  onlyWar.time.advance(3000);
  assert.deepEqual(onlyWar.sounding(), []);
  onlyWar.director.setScene("atWar");
  onlyWar.time.advance(1500);
  assert.deepEqual(onlyWar.sounding(), ["scenario:atWar"]);
  onlyWar.director.setScene("game");
  onlyWar.time.advance(1500);
  assert.deepEqual(onlyWar.sounding(), []);
});

test("a track that cannot be played is passed over; a list none of whose tracks can gives way to the game's own piece", async () => {
  // The second of three cannot be played.
  const skipping = stage({ lengths: { "/hub/a.mp3": 10, "/hub/c.mp3": 10 }, broken: ["/hub/b.mp3"] });
  skipping.director.setPlaylists({ game: [hubTrack("a"), hubTrack("b"), hubTrack("c")] });
  skipping.director.unlock();
  skipping.director.setScene("game");
  skipping.time.advance(10500);
  await settle();
  assert.equal(skipping.list("game").audio.src, "/hub/c.mp3", "straight on to the third");
  assert.equal(skipping.list("game").audio.paused, false);
  assert.equal(skipping.list("game").dead, false);
  skipping.time.advance(10000);
  await settle();
  assert.equal(skipping.list("game").audio.src, "/hub/a.mp3");
  assert.deepEqual(skipping.sounding(), ["scenario:game"]);

  // None of the battle list can be played: Legionnaire, as if the scenario had none.
  const said = [];
  const dead = stage({ broken: ["/hub/x.mp3", "/hub/y.mp3"], onNowPlaying: (track) => said.push(track?.id ?? null) });
  dead.director.setPlaylists({ battle: [hubTrack("x"), hubTrack("y"), hubTrack("x")], game: [hubTrack("a")] });
  dead.director.unlock();
  dead.director.setScene("war");
  await settle();
  await settle();
  assert.equal(dead.list("battle").dead, true);
  assert.equal(dead.list("battle").audio.plays, 3, "each was tried once");
  dead.time.advance(1500);
  assert.deepEqual(dead.sounding(), ["war"]);
  assert.equal(dead.of("war").src, "/audio/legionnaire.mp3");
  assert.equal(said.at(-1) ?? null, null, "and nothing of the hub's is said to be playing");
  // The rest of the scenario's music is untouched.
  dead.director.setScene("game");
  dead.time.advance(1500);
  assert.deepEqual(dead.sounding(), ["scenario:game"]);
  // Left alone until the player has been back to the menu, then tried again.
  dead.director.setScene("war");
  dead.time.advance(1500);
  assert.deepEqual(dead.sounding(), ["war"]);
  assert.equal(dead.list("battle").audio.plays, 3);
  dead.director.setScene("menu");
  assert.equal(dead.list("battle").dead, false);

  // A loading list that cannot be played: the game's own loading music, at its entry.
  const loading = stage({ broken: ["/hub/intro.mp3"] });
  loading.director.setPlaylists({ loading: [hubTrack("intro")] });
  loading.director.unlock();
  loading.director.setScene("loading");
  await settle();
  loading.time.advance(700);
  assert.deepEqual(loading.sounding(), ["drama"]);
  assert.equal(loading.director.inDrama, true);
  assert.ok(loading.of("drama").currentTime > 161 && loading.of("drama").currentTime < 163);
  // At war, with its own list unplayable: the game's list.
  const war = stage({ broken: ["/hub/w.mp3"] });
  war.director.setPlaylists({ game: [hubTrack("a")], atWar: [hubTrack("w")] });
  war.director.unlock();
  war.director.setScene("atWar");
  await settle();
  war.time.advance(1500);
  assert.deepEqual(war.sounding(), ["scenario:game"]);
});

test("a scenario's music is asked for only when it is about to play, and never while the music is off", () => {
  const off = stage({ enabled: false });
  off.director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a")], atWar: [hubTrack("w")], battle: [hubTrack("b")] });
  off.director.unlock();
  for (const scene of ["loading", "game", "atWar", "war"]) {
    off.director.setScene(scene);
    off.time.advance(3000);
  }
  assert.equal(off.made.length, 0, "no element, so no request for any file");
  // Turned on in the war room: its list, and only that.
  off.settings.enabled = true;
  off.director.sync();
  assert.equal(off.made.length, 1);
  assert.equal(off.list("battle").audio.src, "/hub/b.mp3");
  assert.equal(off.list("battle").audio.preload, "none");
  // A hidden page, and a track being tried out elsewhere: it waits and carries on.
  off.time.advance(1500);
  off.director.setHidden(true);
  assert.equal(off.list("battle").audio.paused, true);
  off.director.setHidden(false);
  assert.equal(off.list("battle").audio.paused, false);
  off.director.setHeld(true);
  assert.equal(off.list("battle").audio.paused, true);
  off.director.setHeld(false);
  assert.equal(off.list("battle").audio.paused, false);
  // The volume is followed.
  off.settings.volume = 80;
  off.director.sync();
  assert.equal(off.list("battle").audio.volume, 0.8);
  // Before the first click nothing is made either.
  const waiting = stage();
  waiting.director.setPlaylists({ game: [hubTrack("a")] });
  waiting.director.setScene("game");
  waiting.time.advance(3000);
  assert.equal(waiting.made.length, 0);
  waiting.director.unlock();
  waiting.time.advance(1500);
  assert.deepEqual(waiting.sounding(), ["scenario:game"]);
});

test("the lists can arrive, change and go while a game is open", () => {
  const said = [];
  const { director, time, of, list, sounding } = stage({ onNowPlaying: (track) => said.push(track?.id ?? null) });
  director.unlock();
  // The hub's list was not known when the game began to open: the game's own
  // loading music started, and gives way when the scenario's arrives.
  director.setScene("loading");
  time.advance(1000);
  assert.deepEqual(sounding(), ["drama"]);
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a"), hubTrack("b")] });
  assert.equal(director.inDrama, false);
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:loading"]);
  assert.equal(of("drama").paused, true);
  director.setScene("game");
  time.advance(5000);
  assert.deepEqual(sounding(), ["scenario:game"]);
  const audio = list("game").audio;
  const at = audio.currentTime;
  // The same lists again (the hub's list was read afresh): nothing starts over.
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a"), hubTrack("b")] });
  time.advance(1000);
  near(audio.currentTime, at + 1, 0.02);
  assert.deepEqual([audio.src, audio.volume, audio.plays], ["/hub/a.mp3", 0.25, 1]);
  // The hub took the first track down: the list is what is left of it.
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("b")] });
  time.advance(1500);
  assert.deepEqual(sounding(), ["scenario:game"]);
  assert.equal(audio.src, "/hub/b.mp3");
  assert.equal(said.at(-1), "b");
  // Another game, whose scenario has no music: the game's own (none in a game).
  director.setPlaylists(null);
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  assert.equal(audio.paused, true);
  assert.equal(said.at(-1), null);
  assert.equal(director.nowPlaying, null);
  // Entries with no address to play from are not tracks.
  director.setPlaylists({ game: [{ id: "x", src: "" }, null, { id: "y" }] });
  time.advance(1500);
  assert.deepEqual(sounding(), []);
  assert.equal(list("game").tracks.length, 0);
});

// ---- a scenario's track, played from the copy kept on this device ----------------------
//
// "If you already have a song downloaded from another scenario, it doesnt
// redownload it for you when another scenario uses the same song": the director
// asks one function where a track is played from (keptMusic.js keptMusicAddress,
// which knows the platform), when the track is about to play, and gives its
// element the answer when it comes.

// An asking that the test answers when it chooses to.
const asking = () => {
  const asks = [];
  const answers = new Map();
  return {
    asks,
    trackAddress: (track) => {
      asks.push(track.id);
      return new Promise((resolve, reject) => answers.set(track.id, { resolve, reject }));
    },
    answer: (id, address) => answers.get(id).resolve(address),
    fail: (id) => answers.get(id).reject(new Error("no copy")),
  };
};

test("a scenario's track is asked for when it is about to play, and started from the kept copy when the answer comes", async () => {
  const kept = asking();
  const released = [];
  const lengths = { "kept:a": 30, "kept:b": 20 };
  const said = [];
  const { director, made, time, list, sounding } = stage({ lengths, trackAddress: kept.trackAddress, releaseAddress: (address) => released.push(address), onNowPlaying: (track) => said.push(track?.id ?? null) });
  director.setPlaylists({ loading: [hubTrack("intro")], game: [hubTrack("a"), hubTrack("b")] });
  director.unlock();
  time.advance(2000);
  await settle();
  assert.deepEqual(kept.asks, [], "nothing is asked for on the menu: a file is fetched only when it is about to play");

  director.setScene("game");
  time.advance(1500);
  await settle();
  assert.deepEqual(kept.asks, ["a"], "the track that is about to play, and only that one");
  const audio = list("game").audio;
  assert.deepEqual([audio.src, audio.plays, audio.paused], ["", 0, true], "while its copy is on its way nothing is played, least of all from another address");
  assert.deepEqual(said, [], "and nothing is credited as sounding yet");
  kept.answer("a", "kept:a");
  await settle();
  assert.deepEqual([audio.src, audio.paused, audio.plays], ["kept:a", false, 1]);
  assert.deepEqual(sounding(), ["scenario:game"]);
  assert.deepEqual(said, ["a"]);

  // It ends: the next one is asked for, and the first one's address is given back once the element has the next.
  time.advance(30500);
  await settle();
  assert.deepEqual(kept.asks, ["a", "b"]);
  assert.deepEqual(released, []);
  assert.equal(audio.plays, 1, "not started again on the file that has just ended");
  kept.answer("b", "kept:b");
  await settle();
  assert.deepEqual([audio.src, audio.paused, audio.plays], ["kept:b", false, 2]);
  assert.deepEqual(released, ["kept:a"]);
  assert.equal(made.filter((element) => element === audio).length, 1, "one element for the list");
});

test("a copy that cannot be had, or does not come, is the track's own address: the music still plays", async () => {
  // The asking fails, or answers with nothing.
  for (const outcome of ["fail", "nothing"]) {
    const kept = asking();
    const { director, time, list } = stage({ trackAddress: kept.trackAddress });
    director.setPlaylists({ game: [hubTrack("a")] });
    director.unlock();
    director.setScene("game");
    time.advance(1500);
    await settle();
    if (outcome === "fail") kept.fail("a");
    else kept.answer("a", "");
    await settle();
    assert.deepEqual([list("game").audio.src, list("game").audio.paused], ["/hub/a.mp3", false], outcome);
  }

  // It does not come at all: after ADDRESS_WAIT_MS the track's own address, and a late answer is given back unused.
  const kept = asking();
  const released = [];
  const { director, time, list } = stage({ trackAddress: kept.trackAddress, releaseAddress: (address) => released.push(address) });
  director.setPlaylists({ game: [hubTrack("a")] });
  director.unlock();
  director.setScene("game");
  time.advance(ADDRESS_WAIT_MS - 200);
  await settle();
  const audio = list("game").audio;
  assert.deepEqual([audio.src, audio.plays], ["", 0]);
  time.advance(400);
  assert.deepEqual([audio.src, audio.paused, audio.plays], ["/hub/a.mp3", false, 1]);
  kept.answer("a", "kept:late");
  await settle();
  assert.deepEqual([audio.src, audio.plays], ["/hub/a.mp3", 1], "it is not started over on a copy that came too late");
  assert.deepEqual(released, ["kept:late"]);
  assert.equal(ADDRESS_WAIT_MS, 20000);
});

test("an answer for a track the list has left is given back, and the game's own pieces are never asked for", async () => {
  const kept = asking();
  const released = [];
  const { director, time, list, of } = stage({ trackAddress: kept.trackAddress, releaseAddress: (address) => released.push(address) });
  director.setPlaylists({ game: [hubTrack("a")] });
  director.unlock();
  director.setScene("game");
  time.advance(1500);
  await settle();
  // Another game's scenario, before the first track's copy arrived.
  director.setPlaylists({ game: [hubTrack("z")] });
  time.advance(1500);
  await settle();
  assert.deepEqual(kept.asks, ["a", "z"]);
  kept.answer("a", "kept:a");
  await settle();
  assert.equal(list("game").audio.src, "", "the element is still waiting for the track it is on");
  assert.deepEqual(released, ["kept:a"]);
  kept.answer("z", "kept:z");
  await settle();
  assert.deepEqual([list("game").audio.src, list("game").audio.paused], ["kept:z", false]);

  // The war room's own pieces are the game's files, beside the page: played at once, with nothing asked.
  director.setScene("war");
  time.advance(1500);
  await settle();
  assert.equal(of("war").src, "/audio/legionnaire.mp3");
  assert.equal(of("war").paused, false);
  assert.deepEqual(kept.asks, ["a", "z"]);

  // Without the function (a stand-in director), a track is played from its own address, as it always was.
  const plain = stage();
  plain.director.setPlaylists({ game: [hubTrack("a")] });
  plain.director.unlock();
  plain.director.setScene("game");
  plain.time.advance(1500);
  assert.deepEqual([plain.list("game").audio.src, plain.list("game").audio.paused], ["/hub/a.mp3", false]);
});

// ---- one page of the game sounds at a time ----------------------------------------------
//
// "Why is it playing the song 2 times rn": two windows of the game were open,
// and each played the music. The pages of one browser profile share a channel;
// the one the player turns to says so, and the others hold their music until
// the player turns to them again (createMusicTurn, wired in startMusic).

// A BroadcastChannel standing in: what one end posts, every other end hears.
const sharedChannel = () => {
  const ends = [];
  return () => {
    const listeners = [];
    const end = {
      listeners,
      addEventListener: (type, listener) => { if (type === "message") listeners.push(listener); },
      postMessage: (data) => { for (const other of ends) if (other !== end) for (const listener of other.listeners) listener({ data }); },
    };
    ends.push(end);
    return end;
  };
};

// A page of the game: its own director, its holds, and its turn on `channel`.
// `click()` is what startMusic does on a pointerdown, a keydown or a touchend.
const page = (id, channel, { wanted = () => true } = {}) => {
  const { director, time, sounding } = stage();
  const holdFor = createMusicHolds((held) => director.setHeld(held));
  const turn = createMusicTurn({ channel, id, hold: (held) => holdFor("elsewhere", held), wanted });
  return {
    director, sounding, turn, holdFor,
    click: () => { turn.claim(); director.unlock(); time.advance(3000); },
    focus: () => { turn.claim(); time.advance(3000); },
    wait: () => time.advance(3000),
  };
};

test("two pages of the game: the one the player turns to plays, and the other falls silent", () => {
  const open = sharedChannel();
  const first = page("first", open());
  const second = page("second", open());

  first.click();
  assert.deepEqual(first.sounding(), ["calm"]);
  assert.deepEqual(second.sounding(), [], "the second has not been touched: no browser lets it sound yet");

  // The second to be clicked plays, and the first falls silent.
  second.click();
  first.wait();
  assert.deepEqual(second.sounding(), ["calm"]);
  assert.deepEqual(first.sounding(), []);
  assert.equal(first.turn.elsewhere, true);

  // Clicking the first again swaps them.
  first.click();
  second.wait();
  assert.deepEqual(first.sounding(), ["calm"]);
  assert.deepEqual(second.sounding(), []);
  assert.equal(first.turn.elsewhere, false);
  assert.equal(second.turn.elsewhere, true);

  // Focus alone (the window brought to the front) takes the music back too.
  second.focus();
  first.wait();
  assert.deepEqual(second.sounding(), ["calm"]);
  assert.deepEqual(first.sounding(), []);
  // A page that says it again changes nothing for one already silent.
  second.click();
  first.wait();
  assert.deepEqual(first.sounding(), []);
});

test("a third page takes the music from both; a page with its music off claims nothing and silences nobody", () => {
  const open = sharedChannel();
  const first = page("first", open());
  const second = page("second", open());
  let thirdOn = false;
  const third = page("third", open(), { wanted: () => thirdOn });
  first.click();
  second.click();
  first.wait();
  // The third page's music is switched off: clicking in it leaves the second playing.
  third.click();
  second.wait();
  assert.deepEqual(second.sounding(), ["calm"]);
  // Switched on, it is the one the player is using.
  thirdOn = true;
  third.click();
  first.wait();
  second.wait();
  assert.deepEqual([first.sounding(), second.sounding(), third.sounding()], [[], [], ["calm"]]);
});

test("with no channel every page plays, as it always did", () => {
  const first = page("first", null);
  const second = page("second", null);
  first.click();
  second.click();
  first.wait();
  assert.deepEqual(first.sounding(), ["calm"]);
  assert.deepEqual(second.sounding(), ["calm"]);
  // And a channel that throws when spoken on is no channel.
  const broken = page("broken", { addEventListener() {}, postMessage() { throw new Error("closed"); } });
  broken.click();
  assert.deepEqual(broken.sounding(), ["calm"]);
});

test("silent for another page and silent for a preview are two reasons: letting go of one keeps the other", () => {
  const open = sharedChannel();
  const first = page("first", open());
  const second = page("second", open());
  first.click();
  // A track is tried out in the first page's scenario editor.
  first.holdFor("preview", true);
  first.wait();
  assert.deepEqual(first.sounding(), []);
  // Meanwhile the player clicks the other page.
  second.click();
  first.wait();
  // The preview ends: the first page stays silent, for the other page is playing.
  first.holdFor("preview", false);
  first.wait();
  assert.deepEqual(first.sounding(), []);
  assert.deepEqual(second.sounding(), ["calm"]);
  // Back in the first page with a preview running: it takes the music back, and still waits for the preview.
  first.holdFor("preview", true);
  first.click();
  second.wait();
  assert.deepEqual(first.sounding(), []);
  assert.deepEqual(second.sounding(), []);
  first.holdFor("preview", false);
  first.wait();
  assert.deepEqual(first.sounding(), ["calm"]);
});

test("the page's music is wired to the channel beside its other listeners, not into the director", () => {
  const source = read("src/runtime/ambientMusic.js");
  assert.equal(MUSIC_CHANNEL, "oh-music");
  assert.ok(source.includes("channel = typeof win.BroadcastChannel === \"function\" ? new win.BroadcastChannel(MUSIC_CHANNEL) : null;"));
  assert.ok(source.includes("win.addEventListener(type, () => { turn.claim(); director.unlock(); }, { capture: true, passive: true });"));
  assert.ok(source.includes("win.addEventListener(\"focus\", () => turn.claim());"));
  assert.ok(source.includes("hold: (held) => holdFor(\"elsewhere\", held),"));
  assert.ok(source.includes("wanted: () => musicEnabled() && musicVolume() > 0,"));
  assert.ok(source.includes("export const holdMusic = (held) => { holdFor?.(\"preview\", Boolean(held)); };"));
  // The director's core knows nothing of other pages.
  const core = source.slice(source.indexOf("export const createMusicDirector"), source.indexOf("// The scene, from what the game's screen knows"));
  assert.ok(!/BroadcastChannel|createMusicTurn|elsewhere/.test(core));
  // Before the page's music has started there is nothing to hold.
  holdMusic(true);
  holdMusic(false);
});
