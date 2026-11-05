/*! Open Historia — the community hub's music list: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubMusic.test.js
//
// A scenario's music comes from one list, which only the hub's contributors can
// add to. What has to hold:
//   - the list is read as a stranger's file: a field of the wrong type or
//     length is left out, and a track's file can only be in the hub's own
//     releases, over https;
//   - a track the hub took down is never offered and never played;
//   - a list that is not there yet, or that this game cannot read, is no hub
//     music and one sentence, never an error;
//   - a track is played from the address every hub file is fetched through on
//     the platform: the local server's proxy in the desktop app, the hub proxy
//     itself on the website and in the Android app;
//   - the list is known at once on a second start, and without a connection.
//
// Everything here is tested against stand-ins: the hub publishes no music list
// yet, so nothing was read from the real one.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hubFileAddress } from "./hubFiles.js";
import {
  HUB_MUSIC_FITS,
  HUB_MUSIC_SCHEMA,
  HUB_MUSIC_TEXTS,
  HUB_MUSIC_URL,
  fetchHubMusic,
  hubMusicProblem,
  knownHubMusic,
  normalizeHubMusic,
  offeredTracks,
  playableAddressOf,
  resetHubMusicCache,
  trackById,
} from "./hubMusic.js";
import { HUB_MUSIC_TAG_KINDS, tagCounts, tracksWithTags } from "./hubMusic.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
const PASSAGE_FILE = `${RELEASES}/music/passage-of-time-v1-ab12cd34.mp3`;

// A track as the hub's list carries it (the contract's own example).
const hubTrack = (extra = {}) => ({
  id: "passage-of-time",
  name: "Passage Of Time",
  artist: "Scott Buckley",
  licence: "CC BY 4.0",
  source: "https://www.scottbuckley.com.au/library/passage-of-time/",
  credit: "'Passage Of Time' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  fits: ["menu", "loading"],
  genres: ["Orchestral", "Neoclassical"],
  moods: ["Bittersweet", "Reflective"],
  instruments: ["Piano", "Strings"],
  version: 1,
  file: PASSAGE_FILE,
  type: "mp3",
  bytes: 10857533,
  sha256: "a".repeat(64),
  seconds: 271,
  post: 260,
  postedBy: "Arkniem",
  removed: false,
  ...extra,
});
const hubList = (tracks = [hubTrack()], extra = {}) => ({ schema: "open-historia-music-index/1", updated: "2026-10-13T09:00:00.000Z", tracks, ...extra });

// localStorage, as a page has it.
const withStorage = (t, initial = {}) => {
  const held = new Map(Object.entries(initial));
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (held.has(key) ? held.get(key) : null),
      setItem: (key, value) => { held.set(key, String(value)); },
      removeItem: (key) => { held.delete(key); },
    },
  });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else delete globalThis.localStorage;
  });
  return held;
};

// fetch, answered by `answer` (a Response, an Error, or a function of the call's number); every call recorded.
const mockFetch = (t, answer) => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    const given = typeof answer === "function" ? answer(calls.length) : answer;
    if (given instanceof Error) throw given;
    return given.clone();
  };
  t.after(() => {
    globalThis.fetch = original;
    resetHubMusicCache();
  });
  resetHubMusicCache();
  return calls;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const STORED_KEY = "oh:hub-music:v1";

test("the list is read from the hub's own branch, and is the schema this game knows", () => {
  assert.equal(HUB_MUSIC_URL, "https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/music-index/music.json");
  assert.equal(HUB_MUSIC_SCHEMA, "open-historia-music-index/1");
  assert.deepEqual([...HUB_MUSIC_FITS], ["menu", "loading", "game", "atWar", "battle"]);
  assert.equal(HUB_MUSIC_TEXTS.unread, "The hub's music list cannot be read yet.");
});

test("a track is read whole, field by field", () => {
  const list = normalizeHubMusic(hubList());
  assert.equal(list.listed, true);
  assert.equal(list.updated, "2026-10-13T09:00:00.000Z");
  assert.deepEqual(list.tracks, [hubTrack()]);
  assert.equal(hubMusicProblem(list), null);
  assert.equal(trackById(list, "passage-of-time").name, "Passage Of Time");
  assert.equal(trackById(list, "nothing"), null);
  assert.equal(trackById(null, "passage-of-time"), null);
  // `seconds` may be unknown.
  assert.equal(normalizeHubMusic(hubList([hubTrack({ seconds: null })])).tracks[0].seconds, null);
});

test("a list that is not there, or not one this game reads, is no hub music and one sentence", () => {
  for (const other of [
    null, undefined, [], "text", 4, {},
    { tracks: [hubTrack()] },
    hubList([hubTrack()], { schema: "open-historia-music-index/2" }),
    hubList([hubTrack()], { schema: "open-historia-music-index/0" }),
    { schema: "open-historia-music-index/1" },
    { schema: "open-historia-music-index/1", tracks: { 0: hubTrack() } },
  ]) {
    const list = normalizeHubMusic(other);
    assert.deepEqual(list, { listed: false, updated: "", tracks: [] });
    assert.equal(hubMusicProblem(list), "The hub's music list cannot be read yet.");
    assert.deepEqual(offeredTracks(list), []);
  }
  assert.equal(hubMusicProblem(null), "The hub's music list cannot be read yet.");
  // A list with no tracks yet is a list all the same.
  assert.deepEqual(normalizeHubMusic(hubList([])), { listed: true, updated: "2026-10-13T09:00:00.000Z", tracks: [] });
});

test("everything in the list is a stranger's text: only what is the right kind is kept", () => {
  const list = normalizeHubMusic(hubList([
    hubTrack({
      id: "odd-fields",
      name: `  A   name\nwith breaks ${"x".repeat(400)}`,
      artist: 7,
      licence: ["CC0"],
      source: "javascript:alert(1)",
      credit: { text: "x" },
      fits: ["game", "nowhere", "game", 3, "battle"],
      version: "2",
      type: "exe",
      bytes: -4,
      sha256: "zz",
      seconds: "long",
      post: 1.5,
      postedBy: null,
      removed: "yes",
    }),
    // No id, an id that is none, no name: not tracks.
    hubTrack({ id: "" }),
    hubTrack({ id: "../../etc/passwd" }),
    hubTrack({ id: "has space" }),
    hubTrack({ id: 12 }),
    hubTrack({ id: "no-name", name: "   " }),
    "a string",
    null,
    // The first entry of an id wins.
    hubTrack({ id: "twice", name: "First" }),
    hubTrack({ id: "twice", name: "Second" }),
  ]));
  assert.deepEqual(list.tracks.map((track) => track.id), ["odd-fields", "twice"]);
  const [odd, twice] = list.tracks;
  assert.equal(odd.name.length, 200);
  assert.ok(odd.name.startsWith("A name with breaks x"));
  assert.deepEqual(
    { artist: odd.artist, licence: odd.licence, source: odd.source, credit: odd.credit, fits: odd.fits, version: odd.version, type: odd.type, bytes: odd.bytes, sha256: odd.sha256, seconds: odd.seconds, post: odd.post, postedBy: odd.postedBy, removed: odd.removed },
    { artist: "", licence: "", source: "", credit: "", fits: ["game", "battle"], version: 1, type: "", bytes: 0, sha256: "", seconds: null, post: null, postedBy: "", removed: false },
  );
  assert.equal(twice.name, "First");
  assert.equal(normalizeHubMusic(hubList(Array.from({ length: 2500 }, (_, index) => hubTrack({ id: `t-${index}` })))).tracks.length, 2000, "a damaged file is bounded");
  assert.equal(normalizeHubMusic(hubList([hubTrack()], { updated: "yesterday" })).updated, "");
});

test("a track's file can only be in the hub's own releases, over https: anything else is never played", () => {
  const desktop = {};
  const refused = [
    "https://evil.example/releases/download/music/x.mp3",
    "https://github.com/someone/else/releases/download/music/x.mp3",
    "http://github.com/Open-Historia/Open-historia-scenarios/releases/download/music/x.mp3",
    "https://github.com/Open-Historia/Open-historia-scenarios/raw/main/x.mp3",
    "https://github.com.evil.example/Open-Historia/Open-historia-scenarios/releases/download/music/x.mp3",
    `${PASSAGE_FILE}?then=https://evil.example/x.mp3`,
    `${PASSAGE_FILE}#x`,
    `${RELEASES}/music/${"x".repeat(700)}.mp3`,
    "/audio/passage-of-time.mp3",
    "data:audio/mpeg;base64,AAAA",
    "",
    null,
    7,
  ];
  for (const file of refused) {
    const [track] = normalizeHubMusic(hubList([hubTrack({ file })])).tracks;
    assert.equal(track.file, "", String(file));
    assert.equal(playableAddressOf(track, desktop), "", String(file));
  }
  // Even handed a track that was never read through the list, nothing else is played.
  assert.equal(playableAddressOf(hubTrack({ file: "https://evil.example/x.mp3" }), desktop), "");
  assert.equal(playableAddressOf(null, desktop), "");
  assert.equal(playableAddressOf(undefined, desktop), "");
  const [good] = normalizeHubMusic(hubList()).tracks;
  assert.equal(good.file, PASSAGE_FILE);
  assert.notEqual(playableAddressOf(good, desktop), "");
});

test("a track the hub took down is kept to say it is gone, and is never offered or played", () => {
  const list = normalizeHubMusic(hubList([
    hubTrack({ id: "taken-down", removed: true, file: "" }),
    // Taken down but its address left in: the address counts for nothing.
    hubTrack({ id: "half-removed", removed: true }),
    hubTrack({ id: "no-file", file: "" }),
    hubTrack({ id: "still-here" }),
  ]));
  assert.equal(trackById(list, "taken-down").removed, true);
  assert.equal(trackById(list, "half-removed").file, "");
  assert.deepEqual(offeredTracks(list).map((track) => track.id), ["still-here"]);
  for (const id of ["taken-down", "half-removed", "no-file"]) assert.equal(playableAddressOf(trackById(list, id), {}), "", id);
  assert.equal(playableAddressOf({ ...hubTrack(), removed: true }, {}), "", "whatever file it still names");
});

test("a track is played through the route every hub file takes on the platform", () => {
  const [track] = normalizeHubMusic(hubList()).tracks;
  const encoded = encodeURIComponent(PASSAGE_FILE);
  // The desktop app and the local server: the server's own proxy, which keeps the file in its hub cache.
  assert.equal(playableAddressOf(track, {}), `/api/hub/file?url=${encoded}`);
  assert.equal(hubFileAddress(PASSAGE_FILE, {}), `/api/hub/file?url=${encoded}`);
  // The website and the Android app: the hub proxy itself, since an <audio>'s
  // request never passes the page's fetch, where /api/hub/file lives there.
  const web = { VITE_OH_WEB: "1", VITE_OH_HUB_URL: "https://hub-proxy.example/" };
  assert.equal(playableAddressOf(track, web), `https://hub-proxy.example/hub/file?url=${encoded}`);
  assert.equal(playableAddressOf(track, { ...web, VITE_OH_NATIVE: "1" }), `https://hub-proxy.example/hub/file?url=${encoded}`);
  // No hub proxy configured: nothing to play it from.
  assert.equal(playableAddressOf(track, { VITE_OH_WEB: "1" }), "");
  // The same two addresses the game fetches a hub file from.
  assert.ok(fs.readFileSync(path.join(ROOT, "src/runtime/hubFiles.js"), "utf8").includes("const proxied = (url) => fetch(`/api/hub/file?url=${encodeURIComponent(url)}`);"));
  const router = fs.readFileSync(path.join(ROOT, "src/runtime/web/router.js"), "utf8");
  assert.ok(router.includes("const base = (import.meta.env.VITE_OH_HUB_URL || \"\").replace(/\\/$/, \"\");"));
  assert.ok(router.includes("return fetch(`${base}/hub/file${url.search}`, { method });"));
  // An address is handed to an <audio>: the one keptMusic.js answers with (the
  // copy kept on this device), or this one where no copy can be kept. None of
  // these files reads a track into memory; the website's kept copy is read
  // once, to be checked and kept, in keptMusic.js and nowhere else.
  const director = fs.readFileSync(path.join(ROOT, "src/runtime/ambientMusic.js"), "utf8");
  assert.ok(director.includes("list.audio.src = address;"));
  assert.ok(director.includes("give(list, src);"), "with nothing to ask, a track is played from its own address");
  for (const file of ["src/runtime/hubMusic.js", "src/runtime/scenarioMusic.js", "src/runtime/ambientMusic.js", "src/Game/GameUI/ScenarioMusicPanel.jsx"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(!/arrayBuffer\(|\.blob\(|createObjectURL/.test(source), `${file} reads no track into memory`);
  }
});

test("the list is fetched once, kept five minutes, and kept for the next start", async (t) => {
  const held = withStorage(t);
  const calls = mockFetch(t, json(hubList()));
  assert.equal(knownHubMusic(), null, "nothing is known before the hub is asked");
  const [first, second] = await Promise.all([fetchHubMusic(), fetchHubMusic()]);
  assert.equal(first, second);
  assert.deepEqual(calls, [HUB_MUSIC_URL], "two screens asking at once make one request");
  assert.equal(first.tracks[0].id, "passage-of-time");
  assert.equal(await fetchHubMusic(), first);
  assert.equal(calls.length, 1);
  assert.equal(knownHubMusic(), first);
  await fetchHubMusic({ force: true });
  assert.equal(calls.length, 2);
  // The copy: the list as it was read, and when.
  const kept = JSON.parse(held.get(STORED_KEY));
  assert.equal(kept.list.schema, "open-historia-music-index/1");
  assert.deepEqual(kept.list.tracks, [hubTrack()]);
  assert.ok(Math.abs(kept.at - Date.now()) < 5000);

  // The next start: known at once, before anything is asked, and with no connection at all.
  resetHubMusicCache();
  const before = calls.length;
  const known = knownHubMusic();
  assert.equal(known.listed, true);
  assert.equal(trackById(known, "passage-of-time").credit, hubTrack().credit);
  assert.equal(calls.length, before);
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  const offline = await fetchHubMusic();
  assert.equal(offline.listed, true);
  assert.equal(offline.tracks[0].name, "Passage Of Time");
});

test("no list yet (404), or another schema: no hub music, never an error, and the old copy is forgotten", async (t) => {
  const held = withStorage(t, { [STORED_KEY]: JSON.stringify({ at: Date.now() - 1000, list: hubList() }) });
  const calls = mockFetch(t, new Response("404: Not Found", { status: 404 }));
  assert.equal(knownHubMusic().listed, true, "what an earlier session read");
  const missing = await fetchHubMusic({ force: true });
  assert.equal(missing.listed, false);
  assert.deepEqual(missing.tracks, []);
  assert.equal(hubMusicProblem(missing), "The hub's music list cannot be read yet.");
  assert.equal(held.has(STORED_KEY), false, "the hub no longer stands behind the copy");
  assert.equal(knownHubMusic().listed, false);
  assert.equal(calls.length, 1);

  resetHubMusicCache();
  held.set(STORED_KEY, JSON.stringify({ at: Date.now() - 1000, list: hubList() }));
  globalThis.fetch = async () => json(hubList([hubTrack()], { schema: "open-historia-music-index/2" }));
  const newer = await fetchHubMusic();
  assert.equal(newer.listed, false);
  assert.equal(held.has(STORED_KEY), false);
});

test("a hub that cannot be asked leaves the last list known, or none; the copy is trusted for a week", async (t) => {
  const week = 7 * 24 * 60 * 60 * 1000;
  const held = withStorage(t);
  mockFetch(t, new TypeError("network down"));
  // Nothing known at all.
  const none = await fetchHubMusic();
  assert.equal(none.listed, false);
  assert.equal(none.unread, true);
  assert.equal(hubMusicProblem(none), "The hub's music list cannot be read yet.");
  // A server error, a page that is not the file, a timeout: the copy stands.
  for (const answer of [json({ message: "boom" }, 500), new Response("<html>sign in to the wifi</html>", { status: 200 }), Object.assign(new Error("timed out"), { name: "TimeoutError" })]) {
    resetHubMusicCache();
    held.set(STORED_KEY, JSON.stringify({ at: Date.now() - 60000, list: hubList() }));
    globalThis.fetch = async () => { if (answer instanceof Error) throw answer; return answer.clone(); };
    const list = await fetchHubMusic();
    assert.equal(list.listed, true);
    assert.equal(held.has(STORED_KEY), true);
  }
  // A copy older than a week, one from the future, and one that is not a list: not known.
  for (const stored of [
    JSON.stringify({ at: Date.now() - week - 60000, list: hubList() }),
    JSON.stringify({ at: Date.now() + 3600000, list: hubList() }),
    JSON.stringify({ at: Date.now(), list: { schema: "something-else/1", tracks: [hubTrack()] } }),
    JSON.stringify({ list: hubList() }),
    "{not json",
    "null",
  ]) {
    resetHubMusicCache();
    held.set(STORED_KEY, stored);
    assert.equal(knownHubMusic(), null, stored.slice(0, 40));
  }
  // The copy is read as strictly as the hub's own file.
  resetHubMusicCache();
  held.set(STORED_KEY, JSON.stringify({ at: Date.now(), list: hubList([hubTrack({ file: "https://evil.example/x.mp3" }), hubTrack({ id: "removed", removed: true })]) }));
  const known = knownHubMusic();
  assert.equal(playableAddressOf(trackById(known, "passage-of-time"), {}), "");
  assert.deepEqual(offeredTracks(known), []);
});

test("with no localStorage at all, the list is simply read from the hub each session", async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else delete globalThis.localStorage;
  });
  mockFetch(t, json(hubList()));
  assert.equal(knownHubMusic(), null);
  const list = await fetchHubMusic();
  assert.equal(list.listed, true);
  assert.equal(knownHubMusic(), list);
});

// "make it so for each of the songs, you also scrape the data of how they are
// sorted from the website ... make it so users can also pick catagories to
// easily find songs that they need for their scenario" (the owner, 2026-10-14).
test("a track's genres, moods and instruments are read as names; a list from before them has none", () => {
  assert.deepEqual([...HUB_MUSIC_TAG_KINDS], ["genres", "moods", "instruments"]);
  // A list the hub wrote before it had them.
  const { genres, moods, instruments, ...before } = hubTrack();
  const old = normalizeHubMusic(hubList([before])).tracks[0];
  assert.deepEqual([old.genres, old.moods, old.instruments], [[], [], []]);
  // A stranger's text: names only, each once, cut short; anything else dropped.
  const odd = normalizeHubMusic(hubList([hubTrack({ genres: ["Orchestral", "Orchestral", 4, null, "  Ambient  ", "x".repeat(300)], moods: "Epic", instruments: { piano: true } })])).tracks[0];
  assert.deepEqual(odd.genres, ["Orchestral", "Ambient", "x".repeat(60)]);
  assert.deepEqual([odd.moods, odd.instruments], [[], []]);
  assert.equal(normalizeHubMusic(hubList([hubTrack({ moods: Array.from({ length: 90 }, (_, index) => `Mood ${index}`) })])).tracks[0].moods.length, 40);
});

test("tracks are found by a genre, a mood and an instrument together, and each menu counts what it would find", () => {
  const tracks = [
    hubTrack({ id: "a", genres: ["Orchestral"], moods: ["Epic", "Heroic"], instruments: ["Choir", "Strings"] }),
    hubTrack({ id: "b", genres: ["Orchestral", "Ambient"], moods: ["Calm"], instruments: ["Strings"] }),
    hubTrack({ id: "c", genres: ["Ambient"], moods: ["Calm", "Dreamy"], instruments: ["Synth (Pad)"] }),
  ];
  const ids = (found) => found.map((track) => track.id);
  assert.deepEqual(ids(tracksWithTags(tracks, {})), ["a", "b", "c"]);
  assert.deepEqual(ids(tracksWithTags(tracks, { genres: "Orchestral" })), ["a", "b"]);
  assert.deepEqual(ids(tracksWithTags(tracks, { genres: "Orchestral", moods: "Calm" })), ["b"]);
  assert.deepEqual(ids(tracksWithTags(tracks, { genres: "Orchestral", moods: "Calm", instruments: "Choir" })), []);
  assert.deepEqual(ids(tracksWithTags(tracks, { genres: "", moods: "", instruments: "Strings" })), ["a", "b"]);
  // The most used first, then by name.
  assert.deepEqual(tagCounts(tracks, "genres"), [["Ambient", 2], ["Orchestral", 2]]);
  assert.deepEqual(tagCounts(tracks, "moods"), [["Calm", 2], ["Dreamy", 1], ["Epic", 1], ["Heroic", 1]]);
  assert.deepEqual(tagCounts([], "moods"), []);
});

test("the Music tab's picker narrows the hub's list by genre, mood and instrument", () => {
  const panel = fs.readFileSync(path.join(ROOT, "src", "Game", "GameUI", "ScenarioMusicPanel.jsx"), "utf8");
  const picker = panel.slice(panel.indexOf("const TrackPicker = "), panel.indexOf("const ScenarioMusicPanel = "));
  // One menu for each, each saying "any" until a name is chosen.
  assert.match(panel, /genres: Object\.freeze\(\{ label: "Genre", any: "Any genre" \}\),/);
  assert.match(panel, /moods: Object\.freeze\(\{ label: "Mood", any: "Any mood" \}\),/);
  assert.match(panel, /instruments: Object\.freeze\(\{ label: "Instrument", any: "Any instrument" \}\),/);
  assert.match(picker, /\{HUB_MUSIC_TAG_KINDS\.map\(\(kind\) => \(\s+<select\s+aria-label=\{TAG_FILTER_TEXTS\[kind\]\.label\}/);
  assert.match(picker, /<option value="">\{TAG_FILTER_TEXTS\[kind\]\.any\}<\/option>/);
  // Its choices are the names the other menus' tracks have, counted; the hub's names are never translated.
  assert.match(picker, /tagCounts\(tracksWithTags\(searched, \{ \.\.\.tags, \[kind\]: "" \}\), kind\)/);
  assert.match(picker, /<option data-no-translate key=\{name\} value=\{name\}>\{`\$\{name\} \(\$\{count\}\)`\}<\/option>/);
  // The tracks found have all three, and the search too.
  assert.match(picker, /const found = tracksWithTags\(searched, tags\);/);
  assert.match(picker, /\{narrowed \? <button className="oh-tap-row" onClick=\{\(\) => setTags\(NO_TAGS\)\} [^\n]+>\{"Clear filters"\}<\/button> : null\}/);
  assert.match(picker, /narrowed \? "No track matches the search and filters\." : "No track matches the search\."/);
  // A list with no names at all shows no menus; each track shows its genres and moods.
  assert.match(picker, /\{sorted \? \(/);
  assert.match(picker, /\{tagLineOf\(track\) \? <div data-no-translate style=\{trackDetailStyle\}>\{tagLineOf\(track\)\}<\/div> : null\}/);
});
