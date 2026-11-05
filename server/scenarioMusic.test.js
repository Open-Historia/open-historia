/*! Open Historia — the music a scenario asks for, and that it survives the store © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioMusic.test.js
//
// A scenario names tracks of the community hub's music list for four
// situations, by id and version and nothing else. The record has to be read
// the same way wherever it comes from (a bundle is a file anybody can write),
// written in exactly one shape, left out altogether when it names no track,
// and carried by every path a scenario's details take through the desktop
// store: a save, an export, an import, a clone and a hub Update. The web
// store's half is in src/runtime/web/libraryStore.test.js.
//
// Each store case runs in its own child process because OH_DATA_DIR is read
// once, at import time, so one process only ever sees one data directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";
import {
  MAX_SCENARIO_MUSIC_TRACKS,
  SCENARIO_MUSIC_SITUATIONS,
  SCENARIO_MUSIC_VOLUMES,
  musicTrackId,
  normalizeScenarioMusic,
  scenarioMusicField,
  scenarioMusicTrackIds,
  scenarioMusicVolumes,
} from "./scenarioMusic.js";

const MUSIC = {
  loading: [{ id: "passage-of-time", version: 1 }],
  game: [{ id: "quiet-fields", version: 2 }, { id: "long-road", version: 1 }],
  atWar: [],
  battle: [{ id: "legionnaire", version: 3 }],
};

test("the record is four lists of { id, version }, and nothing at all when they are empty", () => {
  assert.deepEqual([...SCENARIO_MUSIC_SITUATIONS], ["loading", "game", "atWar", "battle"]);
  assert.equal(MAX_SCENARIO_MUSIC_TRACKS, 12);
  assert.deepEqual(normalizeScenarioMusic(MUSIC), MUSIC);
  // Written in one shape: every situation, in order, whatever was given.
  const partial = normalizeScenarioMusic({ battle: [{ id: "legionnaire", version: 3 }] });
  assert.deepEqual(partial, { loading: [], game: [], atWar: [], battle: [{ id: "legionnaire", version: 3 }] });
  assert.deepEqual(Object.keys(partial), ["loading", "game", "atWar", "battle"]);
  for (const none of [null, undefined, "", 0, [], "music", {}, { loading: [], game: [], atWar: [], battle: [] }, { menu: [{ id: "x", version: 1 }] }]) {
    assert.equal(normalizeScenarioMusic(none), null);
    assert.deepEqual(scenarioMusicField(none), {});
  }
  assert.deepEqual(scenarioMusicField(MUSIC), { music: MUSIC });
  assert.deepEqual(scenarioMusicTrackIds(MUSIC), ["passage-of-time", "quiet-fields", "long-road", "legionnaire"]);
  assert.deepEqual(scenarioMusicTrackIds({ game: [{ id: "a" }, { id: "b" }, { id: "a" }], battle: [{ id: "b" }] }), ["a", "b"]);
  assert.deepEqual(scenarioMusicTrackIds(null), []);
});

// "Background music when in game and in war should be quieter. The volume
// should be tunable by scenario designers."
test("a scenario sets how loud each situation is: whole numbers out of 100, and only those that are its own", () => {
  assert.deepEqual({ ...SCENARIO_MUSIC_VOLUMES }, { loading: 100, game: 50, atWar: 50, battle: 75 });
  // With nothing set every situation is the game's own figure.
  assert.deepEqual(scenarioMusicVolumes(null), { loading: 100, game: 50, atWar: 50, battle: 75 });
  assert.deepEqual(scenarioMusicVolumes({ game: [{ id: "theme", version: 1 }] }), { loading: 100, game: 50, atWar: 50, battle: 75 });
  // A volume is a record of its own beside the lists, and a scenario may set one with no track at all.
  const quiet = normalizeScenarioMusic({ volume: { game: 20, battle: 100 } });
  assert.deepEqual(quiet, { loading: [], game: [], atWar: [], battle: [], volume: { game: 20, battle: 100 } });
  assert.deepEqual(scenarioMusicVolumes(quiet), { loading: 100, game: 20, atWar: 50, battle: 100 });
  assert.deepEqual(scenarioMusicField({ volume: { game: 20 } }), { music: { loading: [], game: [], atWar: [], battle: [], volume: { game: 20 } } });
  assert.deepEqual(scenarioMusicTrackIds(quiet), []);
  // A figure that is the game's own is not kept, so a record says only what its author decided;
  // and one that sets nothing of its own is no record.
  assert.equal(normalizeScenarioMusic({ volume: { game: 50, atWar: 50, battle: 75, loading: 100 } }), null);
  assert.deepEqual(normalizeScenarioMusic({ game: [{ id: "theme", version: 1 }], volume: { game: 50, atWar: 30 } }).volume, { atWar: 30 });
  assert.equal("volume" in normalizeScenarioMusic({ game: [{ id: "theme", version: 1 }], volume: { game: 50 } }), false);
  // Read as a stranger's: held between 0 and 100, rounded, and anything that is not a number dropped.
  assert.deepEqual(normalizeScenarioMusic({ volume: { game: 400, atWar: -5, battle: 33.6, loading: "70", menu: 10, other: 1 } }).volume, { game: 100, atWar: 0, battle: 34 });
  assert.equal(normalizeScenarioMusic({ volume: { game: NaN, atWar: null, battle: "loud", loading: Infinity } }), null);
  assert.equal(normalizeScenarioMusic({ volume: [20, 30] }), null);
  assert.equal(normalizeScenarioMusic({ volume: 20 }), null);
  // Written in one shape: read again it is itself.
  assert.deepEqual(normalizeScenarioMusic(quiet), quiet);
});

test("it is read tolerantly: anything malformed is dropped, and a list holds twelve at most", () => {
  const read = normalizeScenarioMusic({
    loading: [
      { id: "kept", version: 2, name: "A name it carries", file: "https://evil.example/x.mp3", credit: "x" },
      { id: "no-version" },
      { id: "odd-version", version: "7" },
      { id: "zero-version", version: 0 },
      { id: "" },
      { id: "has space", version: 1 },
      { id: "../up", version: 1 },
      { id: 7, version: 1 },
      { version: 1 },
      "passage-of-time",
      null,
      ["passage-of-time", 1],
    ],
    game: "passage-of-time",
    atWar: { 0: { id: "x", version: 1 } },
    battle: Array.from({ length: 30 }, (_, index) => ({ id: `t-${index}`, version: 1 })),
    menu: [{ id: "never", version: 1 }],
    extra: true,
  });
  // Only the id and the version are kept: no name, no address, no credit.
  assert.deepEqual(read.loading, [
    { id: "kept", version: 2 },
    { id: "no-version", version: 1 },
    { id: "odd-version", version: 1 },
    { id: "zero-version", version: 1 },
  ]);
  assert.deepEqual(read.game, []);
  assert.deepEqual(read.atWar, []);
  assert.equal(read.battle.length, 12);
  assert.deepEqual(read.battle.map((entry) => entry.id), Array.from({ length: 12 }, (_, index) => `t-${index}`), "the first twelve, in order");
  assert.deepEqual(Object.keys(read), ["loading", "game", "atWar", "battle"]);
  // A track may be named twice: a list is the order it plays.
  assert.deepEqual(normalizeScenarioMusic({ game: [{ id: "a", version: 1 }, { id: "b", version: 1 }, { id: "a", version: 1 }] }).game.map((entry) => entry.id), ["a", "b", "a"]);
  assert.equal(musicTrackId("passage-of-time"), "passage-of-time");
  assert.equal(musicTrackId("Track_2.v1"), "Track_2.v1");
  for (const bad of ["", " ", "-leading", "a/b", "a b", "a?b", "x".repeat(101), null, 4, {}]) assert.equal(musicTrackId(bad), "", String(bad));
});

// ---- the desktop store -----------------------------------------------------------

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

// One scenario of the author's own. Not the built-in "default": the store
// re-seeds that id on first use.
const buildDataDir = (meta = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-music-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "hand-drawn");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "hand-drawn", name: "Hand Drawn World", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...meta });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "2030-01-01" });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["hand-drawn"], selectedScenarioId: "hand-drawn", version: 2 });
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "", order: [], version: 2 });
  return root;
};

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\nconst MUSIC = ${JSON.stringify(MUSIC)};\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a save keeps the music, a save that does not mention it leaves it, and null takes it away", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const before = store.getScenarioDetails("hand-drawn").scenario;
    const saved = store.updateScenario("hand-drawn", { music: { ...MUSIC, loading: [{ id: "passage-of-time", version: 1, file: "https://evil.example/x.mp3" }, { id: "bad id" }] } }).scenario;
    const renamed = store.updateScenario("hand-drawn", { name: "Renamed" }).scenario;
    const catalog = store.getScenarioCatalog().scenarios.find((entry) => entry.id === "hand-drawn");
    const game = store.createGame({ name: "Campaign", scenarioId: "hand-drawn", setActive: true });
    const library = store.getLibraryCatalog();
    const onDisk = JSON.parse((await import("node:fs")).readFileSync(${JSON.stringify(path.join(root, "scenarios", "hand-drawn", "scenario.json"))}, "utf-8"));
    const emptied = store.updateScenario("hand-drawn", { music: { loading: [], game: [], atWar: [], battle: [] } }).scenario;
    store.updateScenario("hand-drawn", { music: MUSIC });
    const cleared = store.updateScenario("hand-drawn", { music: null }).scenario;
    const clearedOnDisk = JSON.parse((await import("node:fs")).readFileSync(${JSON.stringify(path.join(root, "scenarios", "hand-drawn", "scenario.json"))}, "utf-8"));
    ${report(`{
      before: "music" in before,
      saved: saved.music,
      renamed: renamed.music,
      catalog: catalog.music,
      gameScenario: game.scenario.music,
      runtimeScenario: library.runtimeScenario.music,
      onDisk: onDisk.music,
      emptied: "music" in emptied,
      cleared: "music" in cleared,
      clearedOnDisk: "music" in clearedOnDisk,
      edited: saved.updatedAt !== before.updatedAt,
    }`)}
  `);
  assert.equal(result.before, false, "a scenario that never had music has no such field");
  assert.deepEqual(result.saved, MUSIC, "written in the one shape, the stranger's fields and entries dropped");
  assert.deepEqual(result.renamed, MUSIC);
  assert.deepEqual(result.catalog, MUSIC, "the library's card carries it");
  assert.deepEqual(result.gameScenario, MUSIC);
  assert.deepEqual(result.runtimeScenario, MUSIC, "and so does the open game's scenario, which is what the music reads");
  assert.deepEqual(result.onDisk, MUSIC);
  assert.equal(result.emptied, false, "four empty lists are no music at all");
  assert.equal(result.cleared, false);
  assert.equal(result.clearedOnDisk, false);
  assert.equal(result.edited, true, "choosing music is an edit of the scenario");
});

test("a bundle carries the music out and back in, a clone keeps it, and a bundle without any has no such field", () => {
  const root = buildDataDir({ music: MUSIC });
  const result = runStore(root, `
    const bundle = store.exportScenarioBundle("hand-drawn");
    const imported = store.importScenarioBundle(JSON.parse(JSON.stringify(bundle))).scenario;
    const roundTrip = store.exportScenarioBundle(imported.id).scenario.music;
    const cloned = store.createScenario({ name: "Clone", seedScenarioId: "hand-drawn" }).scenario;
    const fresh = store.createScenario({ name: "Fresh" }).scenario;
    store.updateScenario("hand-drawn", { music: null });
    const plain = store.exportScenarioBundle("hand-drawn");
    const importedPlain = store.importScenarioBundle(JSON.parse(JSON.stringify(plain))).scenario;
    const hostile = store.importScenarioBundle({ ...JSON.parse(JSON.stringify(plain)), scenario: { ...plain.scenario, music: { game: [{ id: "x", version: 1, file: "https://evil.example/x.mp3" }, "y", { id: "bad id" }], menu: [{ id: "m" }] } } }).scenario;
    ${report(`{
      bundle: bundle.scenario.music,
      bundleKeys: Object.keys(bundle.scenario).sort(),
      imported: imported.music,
      differentId: imported.id !== "hand-drawn",
      roundTrip,
      cloned: cloned.music,
      fresh: "music" in fresh,
      plain: "music" in plain.scenario,
      importedPlain: "music" in importedPlain,
      hostile: hostile.music,
    }`)}
  `);
  assert.deepEqual(result.bundle, MUSIC);
  assert.ok(result.bundleKeys.includes("music") && result.bundleKeys.includes("features") && result.bundleKeys.includes("name"));
  assert.equal(result.differentId, true);
  assert.deepEqual(result.imported, MUSIC);
  assert.deepEqual(result.roundTrip, MUSIC, "export, import, export again: the same record");
  assert.deepEqual(result.cloned, MUSIC, "a clone is a copy of the scenario, its music with it");
  assert.equal(result.fresh, false, "a scenario made from scratch has none");
  assert.equal(result.plain, false, "omitted from the file altogether when every list is empty");
  assert.equal(result.importedPlain, false);
  assert.deepEqual(result.hostile, { loading: [], game: [{ id: "x", version: 1 }], atWar: [], battle: [] }, "a bundle's music is read as a stranger's");
});

test("a hub Update takes the new version's music, and takes the old away when the new version has none", () => {
  const root = buildDataDir();
  const post = { postId: 42, bundleUrl: "https://github.com/user-attachments/files/1/hand-drawn.zip" };
  const result = runStore(root, `
    const source = store.exportScenarioBundle("hand-drawn");
    const version = (name, music, file) => ({
      ...JSON.parse(JSON.stringify(source)),
      scenario: { ...source.scenario, name, ...(music ? { music } : {}) },
      hubOrigin: { postId: 42, bundleUrl: ${JSON.stringify(post.bundleUrl)}.replace("/1/", "/" + file + "/") },
    });
    const copy = store.importScenarioBundle(version("Hub Map", MUSIC, 1)).scenario;
    const second = store.updateScenarioFromBundle(copy.id, version("Hub Map v2", { game: [{ id: "new-theme", version: 4 }] }, 2)).scenario;
    const third = store.updateScenarioFromBundle(copy.id, version("Hub Map v3", null, 3)).scenario;
    const exported = store.exportScenarioBundle(copy.id).scenario;
    ${report(`{
      copy: copy.music,
      second: second.music,
      secondName: second.name,
      secondLinked: second.hubOrigin.bundleUrl.includes("/2/") && !second.hubOrigin.editedAt,
      third: "music" in third,
      thirdName: third.name,
      exported: "music" in exported,
    }`)}
  `);
  assert.deepEqual(result.copy, MUSIC);
  assert.deepEqual(result.second, { loading: [], game: [{ id: "new-theme", version: 4 }], atWar: [], battle: [] }, "the new version's lists, none of the old");
  assert.equal(result.secondName, "Hub Map v2");
  assert.equal(result.secondLinked, true, "still the post's copy, unedited");
  assert.equal(result.third, false, "a version that dropped its music does not go on playing the old one's");
  assert.equal(result.thirdName, "Hub Map v3");
  assert.equal(result.exported, false);
});

test("both stores read and write the record through the one module", () => {
  const desktop = readFileSync(path.join(SERVER_DIR, "libraryStore.js"), "utf-8");
  const web = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "libraryStore.js"), "utf-8");
  const models = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "models.js"), "utf-8");
  assert.ok(desktop.includes("import { scenarioMusicField } from \"./scenarioMusic.js\";"));
  assert.ok(models.includes("import { scenarioMusicField } from \"../../../server/scenarioMusic.js\";"));
  // Read, written, exported, and taken from a bundle on import and on Update, in each.
  for (const [name, source] of [["desktop", desktop], ["web", `${web}\n${models}`]]) {
    assert.ok(source.includes("...scenarioMusicField(raw?.music),"), `${name}: read`);
    assert.ok(/scenarioMusicField\(updates\??\.music !== undefined \? updates\.music : current\.music\)/.test(source), `${name}: written`);
    assert.ok(/\.\.\.scenarioMusicField\((?:summary|meta)\.music\)/.test(source), `${name}: exported`);
    assert.ok(source.includes("metaPatch.music = scenario.music ?? null;"), `${name}: hub Update`);
  }
  assert.ok(desktop.includes("music: scenario.music ?? null,"), "desktop: import");
  assert.ok(web.includes("music: bundle.scenario?.music ?? null,"), "web: import");
  // The page's side never reaches the server's files the other way round.
  assert.ok(!/from "\.\.\/src\//.test(readFileSync(path.join(SERVER_DIR, "scenarioMusic.js"), "utf-8")));
  assert.ok(!/^import /m.test(readFileSync(path.join(SERVER_DIR, "scenarioMusic.js"), "utf-8")), "dependency-free");
});
