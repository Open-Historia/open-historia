/*! Open Historia — a scenario's music, from its record to what plays: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioMusic.test.js
//
// "Scenario creators should be able to add different tracks and songs for
// different situations", from a list "only uploadable by contributors for
// copyright reasons". What is pinned here, on the page's side:
//   - a scenario's record becomes what plays only through the hub's list: a
//     track the list no longer has, has taken down, or names a file outside
//     the hub's releases for, is left out;
//   - the credits its tracks' licences ask for are the hub's own words;
//   - the hub is asked for its list only while the music is on, and what this
//     device already knows of it is used at once;
//   - a suggestion carries the music as one change an author can accept or
//     refuse, read as strictly as a bundle's;
//   - the editor has its Music tab, saved by the editor's own Save, and the
//     credits are shown before a game is started.
//
// The hub's list here is a stand-in: the hub publishes none yet.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeHubMusic } from "./hubMusic.js";
import { diffScenarioBundles, buildScenarioSnapshot, summarizeChangesForComment } from "./scenarioChanges.js";
import {
  MAX_SCENARIO_MUSIC_TRACKS,
  MUSIC_SITUATION_LABELS,
  SCENARIO_MUSIC_SITUATIONS,
  createScenarioMusicFollower,
  creditSiteOf,
  followScenarioMusic,
  normalizeScenarioMusic,
  resolveScenarioPlaylists,
  scenarioMusicCredits,
  trackCredit,
} from "./scenarioMusic.js";
import { normalizeSuggestion, SUGGESTION_SCHEMA } from "./scenarioSuggestion.js";
import { applyToSnapshot, buildDetailSave, detailChangeStatus, detailValueIn, inverseOf } from "./suggestionApply.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";

const track = (id, extra = {}) => ({
  id,
  name: `Name of ${id}`,
  artist: "A Composer",
  licence: "CC BY 4.0",
  source: `https://composer.example/${id}`,
  credit: `'Name of ${id}' by A Composer - released under CC-BY 4.0.`,
  fits: ["game"],
  version: 1,
  file: `${RELEASES}/music/${id}-v1-0a1b2c3d.mp3`,
  type: "mp3",
  bytes: 1000,
  sha256: "b".repeat(64),
  seconds: 120,
  post: 7,
  postedBy: "someone",
  removed: false,
  ...extra,
});
const LIST = normalizeHubMusic({
  schema: "open-historia-music-index/1",
  updated: "2026-10-13T09:00:00.000Z",
  tracks: [
    track("intro"),
    track("theme"),
    track("march"),
    track("taken-down", { removed: true, file: "" }),
    track("elsewhere", { file: "https://evil.example/elsewhere.mp3" }),
    track("no-credit", { credit: "", source: "" }),
  ],
});
const UNREAD = normalizeHubMusic(null);
const addressOf = (entry) => (entry.removed || !entry.file ? "" : `/play?file=${entry.file}`);
const entry = (id, version = 1) => ({ id, version });

test("the four situations have the names the editor shows", () => {
  assert.deepEqual([...SCENARIO_MUSIC_SITUATIONS], ["loading", "game", "atWar", "battle"]);
  assert.deepEqual({ ...MUSIC_SITUATION_LABELS }, {
    loading: "While the game opens",
    game: "In the game",
    atWar: "At war",
    battle: "In the war room",
  });
  assert.equal(MAX_SCENARIO_MUSIC_TRACKS, 12);
});

test("a record becomes what plays only through the hub's list", () => {
  const music = {
    loading: [entry("intro")],
    game: [entry("theme", 3), entry("taken-down"), entry("gone-from-the-list"), entry("elsewhere"), entry("march"), entry("theme")],
    atWar: [entry("taken-down")],
    battle: [],
  };
  const lists = resolveScenarioPlaylists(music, LIST, addressOf);
  assert.deepEqual(Object.keys(lists), ["loading", "game", "atWar", "battle"]);
  // In the scenario's order, with what cannot be played left out, and a track named twice played twice.
  assert.deepEqual(lists.game.map((item) => item.id), ["theme", "march", "theme"]);
  assert.deepEqual(lists.loading, [{
    id: "intro",
    src: `/play?file=${RELEASES}/music/intro-v1-0a1b2c3d.mp3`,
    name: "Name of intro",
    artist: "A Composer",
    licence: "CC BY 4.0",
    credit: "'Name of intro' by A Composer - released under CC-BY 4.0.",
    source: "https://composer.example/intro",
    // What its kept copy is known by (keptMusic.js): the hub's file and its sha256.
    file: `${RELEASES}/music/intro-v1-0a1b2c3d.mp3`,
    sha256: "b".repeat(64),
  }]);
  assert.deepEqual(lists.atWar, [], "a list of nothing but a track taken down is no list");
  assert.deepEqual(lists.battle, []);
  // The name, the credit and the address are the hub's, whatever the scenario's file says of them.
  const forged = resolveScenarioPlaylists({ game: [{ id: "theme", version: 1, src: "https://evil.example/x.mp3", name: "Forged", credit: "Forged" }] }, LIST, addressOf);
  assert.deepEqual(forged.game.map((item) => [item.name, item.src]), [["Name of theme", `/play?file=${RELEASES}/music/theme-v1-0a1b2c3d.mp3`]]);
  // Nothing to play: no record, no list, or none of its tracks left.
  assert.equal(resolveScenarioPlaylists(null, LIST, addressOf), null);
  assert.equal(resolveScenarioPlaylists(music, UNREAD, addressOf), null);
  assert.equal(resolveScenarioPlaylists(music, null, addressOf), null);
  assert.equal(resolveScenarioPlaylists({ game: [entry("taken-down"), entry("nowhere")] }, LIST, addressOf), null);
  // By default a track plays from where every hub file is fetched (hubMusic.js playableAddressOf).
  const real = resolveScenarioPlaylists({ game: [entry("theme"), entry("elsewhere")] }, LIST);
  assert.deepEqual(real.game.map((item) => item.src), [`/api/hub/file?url=${encodeURIComponent(`${RELEASES}/music/theme-v1-0a1b2c3d.mp3`)}`]);
});

test("the credits are the hub's own words, once for each track the hub still has", () => {
  const music = { loading: [entry("intro")], game: [entry("theme"), entry("intro"), entry("taken-down"), entry("unknown"), entry("no-credit")] };
  assert.deepEqual(scenarioMusicCredits(music, LIST), [
    { id: "intro", credit: "'Name of intro' by A Composer - released under CC-BY 4.0.", source: "https://composer.example/intro" },
    { id: "theme", credit: "'Name of theme' by A Composer - released under CC-BY 4.0.", source: "https://composer.example/theme" },
    // Listed without a credit line: its name, composer and licence.
    { id: "no-credit", credit: "Name of no-credit · A Composer · CC BY 4.0", source: "" },
  ]);
  assert.deepEqual(scenarioMusicCredits(null, LIST), []);
  assert.deepEqual(scenarioMusicCredits(music, UNREAD), []);
  assert.equal(trackCredit(null), "");
  // A credit links to its source by the site's name, and only an https one.
  assert.equal(creditSiteOf("https://www.scottbuckley.com.au/library/passage-of-time/"), "www.scottbuckley.com.au");
  for (const none of ["", null, undefined, "javascript:alert(1)", "http://plain.example/x", "not an address"]) assert.equal(creditSiteOf(none), "", String(none));
});

// The follower's four needs, each a stand-in a test can watch.
const followerRig = ({ on = true, known = null } = {}) => {
  const rig = { on, known, asked: 0, answer: LIST, played: [], waiting: [] };
  rig.levels = [];
  rig.follower = createScenarioMusicFollower({
    level: (levels) => rig.levels.push(levels),
    play: (lists) => rig.played.push(lists ? Object.fromEntries(Object.entries(lists).map(([key, items]) => [key, items.map((item) => item.id)])) : null),
    enabled: () => rig.on,
    known: () => rig.known,
    ask: () => { rig.asked += 1; return new Promise((resolve) => rig.waiting.push(() => resolve(rig.answer))); },
  });
  // Lets the hub answer whoever is waiting, and what follows from it happen.
  rig.answerAll = async () => {
    for (const release of rig.waiting.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return rig;
};
const idsOf = (music) => ({ loading: [], game: [], atWar: [], battle: [], ...music });

test("the open game's scenario music follows the hub's list: what is known at once, then what the hub answers", async () => {
  const music = { game: [entry("theme"), entry("march")] };
  // First start: nothing known, so nothing of the scenario's until the hub answers.
  const first = followerRig();
  first.follower.follow(music);
  assert.deepEqual(first.played, [null]);
  assert.equal(first.asked, 1);
  await first.answerAll();
  assert.deepEqual(first.played, [null, idsOf({ game: ["theme", "march"] })]);
  // The same record again (the library hands out a new object every refresh): nothing is told or asked twice.
  first.follower.follow({ game: [entry("theme"), entry("march")] });
  first.follower.follow({ battle: [], game: [{ id: "theme", version: 1 }, { id: "march", version: 1 }] });
  assert.equal(first.asked, 1);
  assert.equal(first.played.length, 2);

  // A later start: the list is known, so the right music from the first note.
  const second = followerRig({ known: LIST });
  second.follower.follow(music);
  assert.deepEqual(second.played, [idsOf({ game: ["theme", "march"] })]);
  // The hub's answer is the same list: nothing changes. A newer one is followed.
  second.answer = LIST;
  await second.answerAll();
  assert.equal(second.played.length, 1);
  second.follower.follow({ game: [entry("theme"), entry("march"), entry("intro")] });
  second.answer = normalizeHubMusic({ schema: "open-historia-music-index/1", tracks: [track("theme"), track("march", { removed: true, file: "" }), track("intro")] });
  await second.answerAll();
  assert.deepEqual(second.played.at(-1), idsOf({ game: ["theme", "intro"] }), "a track taken down since stops being played");

  // Another game, with no music of its own; and no game at all.
  second.follower.follow(null);
  assert.equal(second.played.at(-1), null);
  const asked = second.asked;
  second.follower.follow(undefined);
  second.follower.follow({ loading: [], game: [] });
  assert.equal(second.asked, asked, "nothing is asked for a scenario that names no track");

  // An answer for a game the player has left is dropped.
  const switching = followerRig();
  switching.follower.follow({ game: [entry("theme")] });
  switching.follower.follow({ game: [entry("march")] });
  await switching.answerAll();
  assert.deepEqual(switching.played, [null, null, idsOf({ game: ["march"] })]);
  // A hub that cannot be read: the game's own music, and no error.
  const unread = followerRig();
  unread.answer = UNREAD;
  unread.follower.follow(music);
  await unread.answerAll();
  assert.deepEqual(unread.played, [null, null]);
});

test("how loud each situation is goes to the music with the record, at once, and needs nothing of the hub", async () => {
  // No list known yet, and the hub slow to answer: the levels are told anyway.
  const rig = followerRig();
  rig.follower.follow({ game: [entry("theme")], volume: { game: 20, battle: 100 } });
  assert.deepEqual(rig.levels, [{ loading: 100, game: 20, atWar: 50, battle: 100 }]);
  assert.deepEqual(rig.played, [null]);
  // The same record again says nothing twice.
  rig.follower.follow({ game: [entry("theme")], volume: { game: 20, battle: 100 } });
  assert.equal(rig.levels.length, 1);
  // Only the volume changed: told, though the tracks are the same.
  rig.follower.follow({ game: [entry("theme")], volume: { game: 35 } });
  assert.deepEqual(rig.levels.at(-1), { loading: 100, game: 35, atWar: 50, battle: 75 });
  // A scenario that sets volumes and names no track is a record too.
  rig.follower.follow({ volume: { atWar: 10 } });
  assert.deepEqual(rig.levels.at(-1), { loading: 100, game: 50, atWar: 10, battle: 75 });
  // No scenario music at all: the game's own figures.
  rig.follower.follow(null);
  assert.deepEqual(rig.levels.at(-1), { loading: 100, game: 50, atWar: 50, battle: 75 });
  await rig.answerAll();
  // With the music off they are still told: they cost nothing, and the switch may be turned on.
  const off = followerRig({ on: false });
  off.follower.follow({ volume: { game: 5 } });
  assert.deepEqual(off.levels, [{ loading: 100, game: 5, atWar: 50, battle: 75 }]);
  assert.equal(off.asked, 0);
});

test("the editor's Music tab has a volume for each situation, and a suggestion shows the ones it changes", () => {
  const panel = read("src/Game/GameUI/ScenarioMusicPanel.jsx");
  assert.ok(panel.includes("const volumes = scenarioMusicVolumes(music);"));
  // Changing the tracks keeps the volumes, and changing a volume keeps the tracks.
  assert.ok(panel.includes("const write = (situation, entries) => onChange(normalizeScenarioMusic({ ...record(), [situation]: entries }));"));
  assert.ok(panel.includes("const writeVolume = (situation, value) => onChange(normalizeScenarioMusic({ ...record(), volume: { ...volumes, [situation]: value } }));"));
  assert.match(panel, /aria-label="Volume"\s+max="100"\s+min="0"\s+onChange=\{\(event\) => writeVolume\(situation, Number\(event\.target\.value\)\)\}/);
  assert.ok(panel.includes("value={volumes[situation]}"));
  // Back to the game's own figure, which is then not kept in the record.
  assert.ok(panel.includes("onClick={() => writeVolume(situation, SCENARIO_MUSIC_VOLUMES[situation])}"));
  // Grey, like every control on these screens.
  assert.ok(panel.includes("style={{ accentColor: \"#d4d4d8\", width: \"9rem\" }}"));
  assert.ok(panel.includes("{\"A situation's volume is a share of the volume the player set, for whatever plays there.\"}"));
  // At war with no tracks is no longer "the music does not change".
  assert.ok(!panel.includes("the music does not change when the player is at war"));
  assert.ok(panel.includes("\"No tracks chosen: at war, the tracks chosen for the game play, and with none of those the game's own war music.\""));

  const suggestions = read("src/Game/GameUI/ScenarioSuggestions.jsx");
  assert.ok(suggestions.includes("const [volumeBefore, volumeAfter] = [scenarioMusicVolumes(before), scenarioMusicVolumes(after)];"));
  assert.ok(suggestions.includes("const louder = SCENARIO_MUSIC_SITUATIONS.filter((situation) => volumeBefore[situation] !== volumeAfter[situation]);"));
  assert.ok(suggestions.includes("{`${volumeBefore[situation]}%`}"));
  assert.ok(suggestions.includes("{`${volumeAfter[situation]}%`}"));
});

test("a volume travels with the music through a suggestion: one change, accepted or refused as a whole", () => {
  const base = { music: normalizeScenarioMusic({ game: [entry("theme")] }) };
  const next = { music: normalizeScenarioMusic({ game: [entry("theme")], volume: { game: 20 } }) };
  // Only the volume differs, and that is a change.
  assert.notEqual(JSON.stringify(base.music), JSON.stringify(next.music));
  assert.deepEqual(next.music.volume, { game: 20 });
  // What reaches the author's scenario is read as a file's.
  assert.deepEqual(normalizeScenarioMusic({ ...next.music, volume: { game: 20, src: "https://example.org/x.mp3", atWar: "9" } }).volume, { game: 20 });
});

test("with the music off the hub is not asked, and is asked when it is switched on", async () => {
  const music = { game: [entry("theme")] };
  const off = followerRig({ on: false });
  off.follower.follow(music);
  assert.equal(off.asked, 0, "a player who turned the music off downloads nothing, the list included");
  assert.deepEqual(off.played, [null]);
  // A setting that is not the switch changes nothing.
  off.follower.settingsChanged();
  assert.equal(off.asked, 0);
  off.on = true;
  off.follower.settingsChanged();
  assert.equal(off.asked, 1);
  await off.answerAll();
  assert.deepEqual(off.played.at(-1), idsOf({ game: ["theme"] }));
  // Off and on again asks once more; the volume moving does not.
  off.follower.settingsChanged();
  off.on = false;
  off.follower.settingsChanged();
  off.on = true;
  off.follower.settingsChanged();
  assert.equal(off.asked, 2);
  // What an earlier session read is used all the same, with nothing asked.
  const known = followerRig({ on: false, known: LIST });
  known.follower.follow(music);
  assert.equal(known.asked, 0);
  assert.deepEqual(known.played, [idsOf({ game: ["theme"] })]);
  // With no page (a test, a worker) following is nothing, and no error.
  followScenarioMusic(null);
});

// ---- a suggestion carries it ---------------------------------------------------

const bundleWith = (music) => ({
  scenario: { name: "A World", ...(music ? { music } : {}) },
  data: { game: { country: "Alpha" }, world: {}, prompts: {} },
  assets: {},
});
const musicChanges = (base, next) => diffScenarioBundles(bundleWith(base), bundleWith(next)).filter((change) => change.kind === "music");

test("a scenario's music is one change in a suggestion, whichever situations it touches", () => {
  const before = { loading: [entry("intro")], game: [entry("theme")] };
  const after = { loading: [], game: [entry("theme"), entry("march")], battle: [entry("march")] };
  const [change, ...rest] = musicChanges(before, after);
  assert.deepEqual(rest, []);
  assert.deepEqual(change, {
    id: "music",
    area: "details",
    kind: "music",
    from: { loading: [entry("intro")], game: [entry("theme")], atWar: [], battle: [] },
    to: { loading: [], game: [entry("theme"), entry("march")], atWar: [], battle: [entry("march")] },
  });
  // Music added to a scenario that had none, and taken away from one that had.
  assert.deepEqual(musicChanges(null, before).map((entryOf) => [entryOf.from, entryOf.to.game]), [[null, [entry("theme")]]]);
  assert.deepEqual(musicChanges(before, null).map((entryOf) => entryOf.to), [null]);
  // No change: the same lists however they were written, the order of a list being the only order that counts.
  assert.deepEqual(musicChanges(before, { game: [{ version: 1, id: "theme" }], loading: [entry("intro")], atWar: [], battle: [] }), []);
  assert.deepEqual(musicChanges(null, { loading: [], game: [] }), []);
  assert.deepEqual(musicChanges(null, null), []);
  assert.equal(musicChanges({ game: [entry("theme"), entry("march")] }, { game: [entry("march"), entry("theme")] }).length, 1, "another order is another list");
  assert.equal(musicChanges({ game: [entry("theme", 1)] }, { game: [entry("theme", 2)] }).length, 1, "and so is another version");
  // A change that is not about music leaves it alone.
  const otherCountry = { ...bundleWith(before), data: { game: { country: "Beta" }, world: {}, prompts: {} } };
  assert.deepEqual(diffScenarioBundles(bundleWith(before), otherCountry).map((entryOf) => entryOf.id), ["game:country"]);
  assert.deepEqual(summarizeChangesForComment([change]), ["Music changed"]);
  assert.deepEqual(buildScenarioSnapshot(bundleWith(null)).music, null);
});

test("an author accepts or refuses the music as a whole, and Undo puts theirs back", () => {
  const posted = { game: [entry("theme")] };
  const suggested = { game: [entry("theme"), entry("march")], battle: [entry("march")] };
  const [change] = musicChanges(posted, suggested);
  const read = normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes: [change] });
  assert.deepEqual(read.changes, [change], "it survives the file");

  // Open while the author's music is still the post's; a conflict once they changed it; applied once it is theirs.
  const author = buildScenarioSnapshot(bundleWith(posted));
  assert.equal(detailChangeStatus(change, author), "open");
  assert.equal(detailChangeStatus(change, buildScenarioSnapshot(bundleWith({ game: [entry("intro")] }))), "conflict");
  assert.equal(detailChangeStatus(change, buildScenarioSnapshot(bundleWith(suggested))), "applied");

  const before = detailValueIn(author, change);
  const { patch, uploads, clears } = buildDetailSave([change], { scenario: { music: posted }, data: {} });
  assert.deepEqual(patch, { music: normalizeScenarioMusic(suggested) }, "part of the scenario's own save, like its features");
  assert.deepEqual([uploads, clears], [[], []]);
  applyToSnapshot(author, change);
  assert.equal(detailChangeStatus(change, author), "applied");
  // Undo: the author's own lists again.
  const undo = inverseOf(change, before);
  assert.deepEqual(buildDetailSave([undo], { scenario: {}, data: {} }).patch, { music: normalizeScenarioMusic(posted) });
  applyToSnapshot(author, undo);
  assert.deepEqual(author.music, normalizeScenarioMusic(posted));

  // A suggestion to have no music: null, which takes the author's away when accepted.
  const [removal] = musicChanges(posted, null);
  assert.deepEqual(buildDetailSave([removal], { scenario: { music: posted }, data: {} }).patch, { music: null });
  applyToSnapshot(author, removal);
  assert.equal(author.music, null);
});

test("a suggestion's music is a file's: only lists of track ids ever reach the author's scenario", () => {
  const hostile = {
    id: "music",
    area: "details",
    kind: "music",
    from: null,
    to: {
      game: [{ id: "theme", version: 1, file: "https://evil.example/x.mp3", name: "Forged" }, { id: "bad id" }, "text"],
      menu: [{ id: "never" }],
      __proto__: { polluted: true },
      hubOrigin: { postId: 1 },
    },
  };
  const read = normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes: [hostile] });
  assert.equal(read.changes.length, 1);
  assert.deepEqual(buildDetailSave(read.changes, { scenario: {}, data: {} }).patch, { music: { loading: [], game: [entry("theme")], atWar: [], battle: [] } });
  // Compared as it would be kept: already the author's, whatever else the file carried.
  assert.equal(detailChangeStatus(hostile, buildScenarioSnapshot(bundleWith({ game: [entry("theme")] }))), "applied");
  // Music that is not a record of lists is no change at all.
  for (const to of ["passage-of-time", 7, [entry("theme")], true]) {
    assert.deepEqual(normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes: [{ ...hostile, to }] }).changes, [], JSON.stringify(to));
  }
  assert.equal(({}).polluted, undefined);
});

// ---- the editor, and the credits before a game ----------------------------------

test("the scenario editor has a Music tab, saved by the editor's own Save", () => {
  const library = read("src/Game/GameUI/libraryBar.jsx");
  assert.ok(library.includes("  music: \"Music\","), "the tab's name");
  // (The War tab is under Wars in the Features tab since 2026-11-01.)
  assert.match(library, /\? \["overview", "world", "history", "politics", "stats", "features", "prompts", "assets", "music", "bundles"\]/);
  assert.match(library, /: \["overview", "world", "features", "prompts", "assets"\];/, "a game's editor has none: the music is its scenario's");
  assert.ok(library.includes("{editorSection === \"music\" && kind === \"scenario\" && ("));
  assert.ok(library.includes("music: normalizeScenarioMusic(scenario.music),"), "part of the form, so closing with unsaved lists asks first");
  assert.ok(library.includes("music: editorState.music ?? null,"), "and written by Save with the rest");
  const panel = read("src/Game/GameUI/ScenarioMusicPanel.jsx");
  // What the tab says of where the music comes from, and when the list cannot be read.
  assert.ok(panel.includes("{\"Scenario music comes from the community hub's list, which only its contributors can add to, so that every track is one the hub may share.\"}"));
  assert.ok(panel.includes("{HUB_MUSIC_TEXTS.unread}"));
  for (const sentence of ["Add a track", "No longer on the hub", "Search by name or composer", "Play a preview", "Stop the preview"]) assert.ok(panel.includes(`"${sentence}"`), sentence);
  // No upload and no address to type: a track is chosen from the hub's list or not at all.
  assert.ok(!/type="file"|<textarea|type="url"/.test(panel));
  assert.ok(panel.includes("onAdd={(track) => write(situation, [...entries, { id: track.id, version: track.version }])}"), "the scenario keeps the id and the version, nothing else");
  // A preview plays from the address the game plays the track from (the copy kept on this
  // device, so a track tried out is kept too: keptMusic.js), and the game's music waits.
  assert.ok(panel.includes("keptMusicAddress(track, { preview: true }).then((src) => {"));
  assert.ok(!panel.includes("playableAddressOf"), "no second way to an address");
  assert.ok(panel.includes("holdMusic(true);") && panel.includes("holdMusic(false);"));
  // The tracks said to suit the situation come first.
  assert.ok(panel.includes("return [...found.filter((track) => track.fits.includes(situation)), ...found.filter((track) => !track.fits.includes(situation))];"));
});

test("names, composers, licences and credits are never translated", () => {
  const panel = read("src/Game/GameUI/ScenarioMusicPanel.jsx");
  for (const shown of ["{track.name}", "{there ? track.name : entry.id}", "{detailOf(track)}", "{entry.credit}", "{site}"]) {
    const at = panel.indexOf(`>${shown}<`);
    assert.ok(at > 0, shown);
    const tag = panel.slice(panel.lastIndexOf("<", at), at);
    assert.ok(tag.includes("data-no-translate"), `${shown} sits in ${tag}`);
  }
  // The credits before a game is started, under the scenario's name.
  const library = read("src/Game/GameUI/libraryBar.jsx");
  assert.ok(library.includes("<ScenarioMusicCredits music={countryPicker.music}"));
  assert.ok(panel.includes("<div>{\"Music:\"}</div>"));
  // The list is asked for only when there is a track to credit.
  assert.ok(panel.includes("const named = scenarioMusicTrackIds(music).length > 0;") && panel.includes("const list = useHubMusic(named);"));
  // A suggestion's music is shown by its track ids, which are not prose either.
  const review = read("src/Game/GameUI/ScenarioSuggestions.jsx");
  assert.ok(review.includes("if (change.kind === \"music\") return { tab: \"Music\", title: \"Scenario music\", detail: \"\" };"));
  assert.ok(review.includes("<span data-no-translate style={{ color: \"#bbf7d0\" }}>{idsOf(after, situation) || \"—\"}</span>"));
});
