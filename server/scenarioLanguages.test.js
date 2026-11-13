/*! Open Historia — a scenario's own language packs, and that they survive the store © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/scenarioLanguages.test.js
//
// "add a feature to ship high quality api generated language packs with
// scenarios" (the owner, 2026-11-06). A scenario may carry its own text in
// other languages: { <code>: { <English>: <translation> } }. The record has to
// be read the same way wherever it comes from (a bundle is a file anybody can
// write), left out altogether when it has no translation, kept out of the
// library's listings (which carry only the codes), and carried by every path a
// scenario's details take through the desktop store: a save, an export, an
// import, a clone and a hub Update. The web store's half is in
// src/runtime/web/libraryStore.test.js.
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
  MAX_SCENARIO_LANGUAGE_ENTRIES,
  MAX_SCENARIO_LANGUAGES,
  MAX_SCENARIO_LANGUAGES_BYTES,
  MAX_SCENARIO_LANGUAGE_SOURCE,
  normalizeScenarioLanguages,
  scenarioLanguageCode,
  scenarioLanguageCodes,
  scenarioLanguagePack,
  scenarioLanguagesField,
  withoutScenarioLanguages,
} from "./scenarioLanguages.js";

const LANGUAGES = {
  de: { "Kingdom of Bohemia": "Königreich Böhmen", "The Defenestration of Prague": "Der Prager Fenstersturz" },
  fr: { "Kingdom of Bohemia": "Royaume de Bohême" },
};

test("the record is a pack of strings per language, and nothing at all when it has none", () => {
  assert.deepEqual(normalizeScenarioLanguages(LANGUAGES), LANGUAGES);
  assert.deepEqual(scenarioLanguagesField(LANGUAGES), { languages: LANGUAGES });
  assert.deepEqual(scenarioLanguageCodes(LANGUAGES), ["de", "fr"]);
  assert.deepEqual(scenarioLanguagePack(LANGUAGES, "de"), LANGUAGES.de);
  assert.deepEqual(scenarioLanguagePack(LANGUAGES, "ja"), {});
  for (const none of [null, undefined, "", 0, [], "de", {}, { de: {} }, { de: { a: "" } }, { de: [] }, { en: { a: "b" } }]) {
    assert.equal(normalizeScenarioLanguages(none), null, JSON.stringify(none));
    assert.deepEqual(scenarioLanguagesField(none), {});
    assert.deepEqual(scenarioLanguageCodes(none), []);
  }
  // Codes in order, whatever order they were written in, so two copies compare equal.
  assert.deepEqual(Object.keys(normalizeScenarioLanguages({ zh: { a1: "x" }, de: { a1: "y" }, fil: { a1: "z" } })), ["de", "fil", "zh"]);
});

test("it is read as a stranger's: only strings, only language codes, no prototype keys, nothing too long", () => {
  const read = normalizeScenarioLanguages({
    " de ": { "  Bohemia ": " Böhmen ", Empty: "  ", Number: 4, Nested: { a: "b" }, __proto__: "x", constructor: "y", prototype: "z" },
    "../etc": { a1: "b" },
    "de-AT": { Bohemia: "Böhmen" },
    EN: { a1: "b" },
    en: { Bohemia: "Bohemia" },
    xx_YY: { a1: "b" },
    ja: "not a pack",
    fr: { ["x".repeat(MAX_SCENARIO_LANGUAGE_SOURCE + 1)]: "long", Bohemia: "y".repeat(9000) },
  });
  assert.deepEqual(read, { de: { Bohemia: "Böhmen" }, "de-AT": { Bohemia: "Böhmen" } });
  assert.equal(Object.getPrototypeOf(read.de), Object.prototype, "a plain record, its prototype untouched");
  // A key written as an own property (JSON.parse makes one) is refused too.
  const parsed = normalizeScenarioLanguages(JSON.parse('{"de":{"__proto__":"x","Bohemia":"Böhmen"},"__proto__":{"a1":"b"}}'));
  assert.deepEqual(parsed, { de: { Bohemia: "Böhmen" } });
  for (const bad of ["", "en", "e", "deutsch", "DE", "__proto__", "constructor", "de_DE", null, 4]) assert.equal(scenarioLanguageCode(bad), "", String(bad));
  for (const good of ["de", "fil", "zh-Hant", "pt-BR"]) assert.equal(scenarioLanguageCode(good), good);
});

test("it is capped: languages, entries per language, and the whole record's size", () => {
  const many = Object.fromEntries(Array.from({ length: MAX_SCENARIO_LANGUAGES + 5 }, (_, index) => [
    `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`, { Name: "Nom" },
  ]).filter(([code]) => code !== "en"));
  assert.equal(Object.keys(normalizeScenarioLanguages(many)).length, MAX_SCENARIO_LANGUAGES);
  const big = Object.fromEntries(Array.from({ length: MAX_SCENARIO_LANGUAGE_ENTRIES + 10 }, (_, index) => [`String ${index}`, `Chaîne ${index}`]));
  const pack = normalizeScenarioLanguages({ fr: big }).fr;
  assert.equal(Object.keys(pack).length, MAX_SCENARIO_LANGUAGE_ENTRIES);
  assert.equal(pack["String 0"], "Chaîne 0", "the first ones are kept, in order");
  // Long strings in many languages: what goes past the whole record's size is left out, from the end.
  const long = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`Event ${index} ${"text ".repeat(300)}`, "t".repeat(4000)]));
  const heavy = normalizeScenarioLanguages({ de: long, es: long, fr: long, it: long });
  assert.ok(JSON.stringify(heavy).length <= MAX_SCENARIO_LANGUAGES_BYTES + 100_000);
  assert.equal(Object.keys(heavy.de).length, 600, "the first language whole");
  assert.ok(!heavy.it || Object.keys(heavy.it).length < 600, "the last cut short or left out");
});

test("a listing carries only which languages a scenario has", () => {
  const meta = { id: "s", name: "Thirty Years", languages: LANGUAGES };
  assert.deepEqual(withoutScenarioLanguages(meta), { id: "s", name: "Thirty Years", languageCodes: ["de", "fr"] });
  assert.deepEqual(withoutScenarioLanguages({ id: "s", name: "Plain" }), { id: "s", name: "Plain" });
  assert.deepEqual(withoutScenarioLanguages({ id: "s", languages: { de: {} } }), { id: "s" });
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
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-languages-"));
  roots.push(root);
  const scenarioDir = path.join(root, "scenarios", "thirty-years");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "thirty-years", name: "Thirty Years", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", ...meta });
  writeJson(path.join(scenarioDir, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(scenarioDir, "game.json"), { country: "Testland", gameDate: "1618-05-23" });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(scenarioDir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["thirty-years"], selectedScenarioId: "thirty-years", version: 2 });
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "", order: [], version: 2 });
  return root;
};

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\nconst LANGUAGES = ${JSON.stringify(LANGUAGES)};\n${body}`;
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

test("a save keeps the packs, a save that does not mention them leaves them, null takes them away, and a listing carries only the codes", () => {
  const root = buildDataDir();
  const metaFile = JSON.stringify(path.join(root, "scenarios", "thirty-years", "scenario.json"));
  const result = runStore(root, `
    const fs = await import("node:fs");
    const before = store.getScenarioDetails("thirty-years").scenario;
    const saved = store.updateScenario("thirty-years", { languages: { ...LANGUAGES, ja: "junk", en: { a1: "b" }, de: { ...LANGUAGES.de, Number: 4 } } }).scenario;
    const renamed = store.updateScenario("thirty-years", { name: "Renamed" });
    const details = store.getScenarioDetails("thirty-years").scenario;
    const catalog = store.getScenarioCatalog().scenarios.find((entry) => entry.id === "thirty-years");
    const game = store.createGame({ name: "Campaign", scenarioId: "thirty-years", setActive: true });
    const library = store.getLibraryCatalog();
    const de = store.readScenarioLanguagePack("thirty-years", "de");
    const ja = store.readScenarioLanguagePack("thirty-years", "ja");
    const bad = store.readScenarioLanguagePack("thirty-years", "__proto__");
    let missing = "";
    try { store.readScenarioLanguagePack("nowhere", "de"); } catch (error) { missing = error.message; }
    const onDisk = JSON.parse(fs.readFileSync(${metaFile}, "utf-8"));
    const cleared = store.updateScenario("thirty-years", { languages: null }).scenario;
    const clearedOnDisk = JSON.parse(fs.readFileSync(${metaFile}, "utf-8"));
    ${report(`{
      before: "languages" in before,
      saved: saved.languages,
      renamed: renamed.scenario.languages,
      details: details.languages,
      catalogPacks: "languages" in catalog,
      catalogCodes: catalog.languageCodes,
      gameScenario: game.scenario.languageCodes,
      runtimeScenario: library.runtimeScenario.languageCodes,
      runtimePacks: "languages" in library.runtimeScenario,
      de, ja, bad, missing,
      onDisk: onDisk.languages,
      onDiskCodes: "languageCodes" in onDisk,
      cleared: "languages" in cleared,
      clearedOnDisk: "languages" in clearedOnDisk,
      edited: saved.updatedAt !== before.updatedAt,
    }`)}
  `);
  assert.equal(result.before, false, "a scenario that never had a pack has no such field");
  assert.deepEqual(result.saved, LANGUAGES, "written strictly: the stranger's languages and values dropped");
  assert.deepEqual(result.renamed, LANGUAGES, "a save that does not mention them keeps them");
  assert.deepEqual(result.details, LANGUAGES, "the editor's details carry them");
  assert.equal(result.catalogPacks, false, "a listing never carries the packs");
  assert.deepEqual(result.catalogCodes, ["de", "fr"], "only which languages");
  assert.deepEqual(result.gameScenario, ["de", "fr"]);
  assert.deepEqual(result.runtimeScenario, ["de", "fr"], "the open game's scenario says which, for the game to fetch one");
  assert.equal(result.runtimePacks, false);
  assert.deepEqual(result.de, LANGUAGES.de, "a game fetches one language at a time");
  assert.deepEqual(result.ja, {});
  assert.deepEqual(result.bad, {});
  assert.match(result.missing, /not found/);
  assert.deepEqual(result.onDisk, LANGUAGES);
  assert.equal(result.onDiskCodes, false, "the codes are a listing's, never stored");
  assert.equal(result.cleared, false);
  assert.equal(result.clearedOnDisk, false);
  assert.equal(result.edited, true, "a pack is an edit of the scenario");
});

test("a bundle carries the packs out and back in, a clone keeps them, and a bundle without any has no such field", () => {
  const root = buildDataDir({ languages: LANGUAGES });
  const result = runStore(root, `
    const bundle = store.exportScenarioBundle("thirty-years");
    const imported = store.importScenarioBundle(JSON.parse(JSON.stringify(bundle))).scenario;
    const importedDetails = store.getScenarioDetails(imported.id).scenario;
    const roundTrip = store.exportScenarioBundle(imported.id).scenario.languages;
    const cloned = store.createScenario({ name: "Clone", seedScenarioId: "thirty-years" }).scenario;
    const clonedDetails = store.getScenarioDetails(cloned.id).scenario;
    const fresh = store.getScenarioDetails(store.createScenario({ name: "Fresh" }).scenario.id).scenario;
    store.updateScenario("thirty-years", { languages: null });
    const plain = store.exportScenarioBundle("thirty-years");
    const importedPlain = store.getScenarioDetails(store.importScenarioBundle(JSON.parse(JSON.stringify(plain))).scenario.id).scenario;
    const hostile = store.getScenarioDetails(store.importScenarioBundle({ ...JSON.parse(JSON.stringify(plain)), scenario: { ...plain.scenario, languages: { de: { Bohemia: "Böhmen", Bad: { x: 1 } }, "../x": { a1: "b" } } } }).scenario.id).scenario;
    ${report(`{
      bundle: bundle.scenario.languages,
      imported: importedDetails.languages,
      importedCodes: imported.languageCodes,
      roundTrip,
      cloned: clonedDetails.languages,
      fresh: "languages" in fresh,
      plain: "languages" in plain.scenario,
      importedPlain: "languages" in importedPlain,
      hostile: hostile.languages,
    }`)}
  `);
  assert.deepEqual(result.bundle, LANGUAGES);
  assert.deepEqual(result.imported, LANGUAGES);
  assert.deepEqual(result.importedCodes, ["de", "fr"]);
  assert.deepEqual(result.roundTrip, LANGUAGES, "export, import, export again: the same record");
  assert.deepEqual(result.cloned, LANGUAGES, "a clone is a copy of the scenario, its packs with it");
  assert.equal(result.fresh, false, "a scenario made from scratch has none");
  assert.equal(result.plain, false, "omitted from the file altogether when there is none");
  assert.equal(result.importedPlain, false);
  assert.deepEqual(result.hostile, { de: { Bohemia: "Böhmen" } }, "a bundle's packs are read as a stranger's");
});

test("a hub Update takes the new version's packs, and takes the old away when the new version has none", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const source = store.exportScenarioBundle("thirty-years");
    const version = (name, languages, file) => ({
      ...JSON.parse(JSON.stringify(source)),
      scenario: { ...source.scenario, name, ...(languages ? { languages } : {}) },
      hubOrigin: { postId: 42, bundleUrl: "https://github.com/user-attachments/files/" + file + "/thirty-years.zip" },
    });
    const copy = store.importScenarioBundle(version("Hub Map", LANGUAGES, 1)).scenario;
    const second = store.updateScenarioFromBundle(copy.id, version("Hub Map v2", { es: { "Kingdom of Bohemia": "Reino de Bohemia" } }, 2)).scenario;
    const secondDetails = store.getScenarioDetails(copy.id).scenario;
    const third = store.updateScenarioFromBundle(copy.id, version("Hub Map v3", null, 3)).scenario;
    const thirdDetails = store.getScenarioDetails(copy.id).scenario;
    ${report(`{
      second: secondDetails.languages,
      secondLinked: second.hubOrigin.bundleUrl.includes("/2/") && !second.hubOrigin.editedAt,
      third: "languages" in thirdDetails,
      thirdCodes: "languageCodes" in third,
    }`)}
  `);
  assert.deepEqual(result.second, { es: { "Kingdom of Bohemia": "Reino de Bohemia" } }, "the new version's packs, none of the old");
  assert.equal(result.secondLinked, true, "still the post's copy, unedited");
  assert.equal(result.third, false, "a version that dropped its packs does not keep the old ones");
  assert.equal(result.thirdCodes, false);
});

test("both stores read and write the record through the one module, and both answer a game's request for one language", () => {
  const desktop = readFileSync(path.join(SERVER_DIR, "libraryStore.js"), "utf-8");
  const web = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "libraryStore.js"), "utf-8");
  const models = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "models.js"), "utf-8");
  const server = readFileSync(path.join(SERVER_DIR, "server.js"), "utf-8");
  for (const [name, source] of [["desktop", desktop], ["web", `${web}\n${models}`]]) {
    assert.ok(source.includes("...scenarioLanguagesField(raw?.languages),"), `${name}: read`);
    assert.ok(/scenarioLanguagesField\(updates\??\.languages !== undefined \? updates\.languages : current\.languages\)/.test(source), `${name}: written`);
    assert.ok(source.includes("metaPatch.languages = scenario.languages ?? null;"), `${name}: hub Update`);
    assert.ok(source.includes("withoutScenarioLanguages("), `${name}: kept out of a listing`);
  }
  assert.ok(server.includes("app.get(\"/api/scenarios/:scenarioId/languages/:code\""));
  assert.ok(web.includes("sub === \"languages\""));
});
