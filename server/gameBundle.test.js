/*! Open Historia — game export and import tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/gameBundle.test.js
//
// Exporting one Game as a portable record and importing it back. What has to
// hold, because each of these is silent damage on a player's machine otherwise:
//   - everything a game holds survives the round trip, and restore points do
//     too even though they travel outside the bundle;
//   - an import is always a NEW game and never the active one, so importing
//     cannot overwrite a campaign or yank a player out of the one they are in;
//   - the sender's name for the game survives, disambiguated only on a real
//     collision;
//   - the bundle says whether the map has to travel with it — and a game whose
//     scenario this install does not have still imports, still opens in the
//     library, and still remembers what to go and ask for;
//   - no API key and no home-folder path ever reaches a bundle. That one is a
//     drift guard: nothing puts them there today, and this test is what says so
//     the day something starts to.
//
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time, so one process only ever sees one data directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;

const roots = [];
const TEST_STATS_DEFINITION = { version: 2, sections: [{ key: "resources", label: "Resources", icon: "🧰", stats: [{ key: "timber", label: "Timber", kind: "number", icon: "🪵", color: "#22c55e", description: "Usable timber supply.", prefix: "", suffix: "tonnes", decimals: 0, compact: true, minimum: 0 }] }] };
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};

// A data dir holding one scenario and one game played on it. `scenarioId` is
// written onto the game whether or not that scenario exists, which is how the
// missing-map cases are set up.
const buildDataDir = ({
  gameId = "test-campaign",
  gameName = "Test Campaign",
  scenarioId = "default",
  scenarioExists = true,
  hubOrigin = null,
  extraGames = [],
  snapshots = null,
} = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-gamebundle-"));
  roots.push(root);

  if (scenarioExists) {
    const dir = path.join(root, "scenarios", scenarioId);
    writeJson(path.join(dir, "scenario.json"), {
      id: scenarioId,
      name: scenarioId === "default" ? "Modern Day" : "Hand Drawn World",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      ...(hubOrigin ? { hubOrigin } : {}),
    });
    writeJson(path.join(dir, "world.json"), { ownerSchema: OWNER_SCHEMA });
    writeJson(path.join(dir, "game.json"), {});
    writeJson(path.join(dir, "stats.json"), TEST_STATS_DEFINITION);
    for (const key of ["actions", "advisor", "chat", "events"]) {
      writeJson(path.join(dir, "storage", `${key}.json`), []);
    }
    writeJson(path.join(root, "scenario-manifest.json"), {
      order: [scenarioId],
      selectedScenarioId: scenarioId,
      version: 2,
    });
  }

  const ids = [gameId, ...extraGames.map((entry) => entry.id)];
  for (const entry of [{ id: gameId, name: gameName, scenarioId }, ...extraGames]) {
    const dir = path.join(root, "games", entry.id);
    writeJson(path.join(dir, "game-instance.json"), {
      id: entry.id,
      name: entry.name,
      scenarioId: entry.scenarioId ?? scenarioId,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    writeJson(path.join(dir, "world.json"), {
      ownerSchema: OWNER_SCHEMA,
      countryTags: { Testland: ["socialist"] },
    });
    writeJson(path.join(dir, "game.json"), {
      country: "Testland",
      difficulty: "hard",
      gameDate: "2032-11-15",
      language: "English",
      round: 10,
    });
    writeJson(path.join(dir, "colors.json"), { Testland: [1, 2, 3] });
    writeJson(path.join(dir, "stats.json"), TEST_STATS_DEFINITION);
    writeJson(path.join(dir, "prompts.json"), { gameMaster: "be terse" });
    for (const key of ["actions", "advisor", "chat", "events"]) {
      writeJson(path.join(dir, "storage", `${key}.json`), [{ id: `${key}-1` }]);
    }
    writeJson(path.join(dir, "storage", "intercepts.json"), { Testland: ["a cable"] });
    writeJson(path.join(dir, "storage", "snapshots.json"), snapshots ?? []);
  }

  writeJson(path.join(root, "game-manifest.json"), { activeGameId: gameId, order: ids, version: 2 });
  return root;
};

const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
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

test("everything a game holds survives the round trip, and the copy is a new, inactive game", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const bundle = store.exportGameBundle("test-campaign");
    const imported = store.importGameBundle(bundle);
    const details = store.getGameDetails(imported.game.id);
    const catalog = store.getGameCatalog();
    const bundleStats = bundle.data.stats;
    store.setActiveGame(imported.game.id);
    const importedStats = store.readRuntimeJsonAsset("stats").data;
    store.setActiveGame("test-campaign");
    ${report(`{
      schema: bundle.schema,
      sameId: imported.game.id === "test-campaign",
      name: imported.game.name,
      activeGameId: catalog.activeGameId,
      gameCount: catalog.games.length,
      bundleStats,
      importedStats,
      data: details.data,
      world: details.data.world,
    }`)}
  `);

  assert.equal(result.schema, "open-historia-game-bundle/1");
  assert.equal(result.sameId, false, "an import is a new record, never an overwrite");
  assert.equal(result.gameCount, 2);
  assert.equal(result.activeGameId, "test-campaign", "importing must not switch the active game");
  // Round-tripping into the SAME library is a genuine collision: the original is
  // still sitting there. Two cards reading "Test Campaign" is the case the
  // suffix exists for.
  assert.equal(result.name, "Test Campaign (Imported)");
  assert.equal(result.data.game.country, "Testland");
  assert.equal(result.data.game.difficulty, "hard");
  assert.equal(result.data.game.round, 10);
  assert.equal(result.data.prompts.gameMaster, "be terse");
  const expectedStats = TEST_STATS_DEFINITION;
  assert.deepEqual(result.bundleStats, expectedStats, "custom Stats definitions travel inside the game bundle");
  assert.deepEqual(result.importedStats, expectedStats, "the imported campaign serves its frozen Stats definition at runtime");
  assert.deepEqual(result.data.events, [{ id: "events-1" }]);
  assert.deepEqual(result.world.countryTags, { Testland: ["socialist"] });
});

test("restore points travel beside the bundle, not inside it", () => {
  const root = buildDataDir({ snapshots: [{ round: 9, world: { note: "before the war" } }] });
  const result = runStore(root, `
    const bundle = store.exportGameBundle("test-campaign");
    const snapshots = store.readGameSnapshots("test-campaign");
    const imported = store.importGameBundle(bundle);
    const beforeRestore = store.readGameSnapshots(imported.game.id);
    store.writeGameSnapshots(imported.game.id, snapshots);
    ${report(`{
      inBundle: Object.hasOwn(bundle.data, "snapshots"),
      sent: snapshots,
      beforeRestore,
      afterRestore: store.readGameSnapshots(imported.game.id),
    }`)}
  `);

  assert.equal(result.inBundle, false, "snapshots stay out of the bundle — they are ~40x the rest");
  assert.deepEqual(result.sent, [{ round: 9, world: { note: "before the war" } }]);
  assert.deepEqual(result.beforeRestore, [], "a fresh import starts with none");
  assert.deepEqual(result.afterRestore, result.sent, "and gets them back verbatim");
});

test("a name already in the library gains (imported); a free one does not", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const bundle = store.exportGameBundle("test-campaign");
    const first = store.importGameBundle(bundle);
    const second = store.importGameBundle(bundle);
    const renamed = store.importGameBundle({ ...bundle, game: { ...bundle.game, name: "Something Else" } });
    ${report(`{ first: first.game.name, second: second.game.name, renamed: renamed.game.name }`)}
  `);

  // The source game is still in the library, so even the first import collides.
  assert.equal(result.first, "Test Campaign (Imported)");
  assert.equal(result.second, "Test Campaign (Imported 2)", "and the suffix keeps counting");
  assert.equal(result.renamed, "Something Else", "a name nobody else holds is left alone");
});

test("a bundle whose schema is not ours is refused, and says so", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const reject = (bundle) => { try { store.importGameBundle(bundle); return null; } catch (error) { return error.message; } };
    ${report(`{
      wrongSchema: reject({ schema: "pax-historia-scenario-bundle/2", data: {}, game: {} }),
      noSchema: reject({ data: {}, game: {} }),
      notAnObject: reject("nope"),
      count: store.getGameCatalog().games.length,
    }`)}
  `);

  assert.match(result.wrongSchema, /Unsupported game bundle schema/);
  assert.match(result.noSchema, /Unsupported game bundle schema/);
  assert.match(result.notAnObject, /must be a JSON object/);
  assert.equal(result.count, 1, "a refused import writes nothing");
});

test("the bundle says whether the map has to travel with it", () => {
  const builtIn = runStore(buildDataDir({ scenarioId: "default" }), `
    ${report(`store.exportGameBundle("test-campaign").scenarioRef`)}
  `);
  assert.equal(builtIn.builtIn, true, "every install has the built-in map");
  assert.equal(builtIn.hubOrigin, null);

  const fromHub = runStore(
    buildDataDir({
      scenarioId: "shared-world",
      hubOrigin: { postId: 42, bundleUrl: "https://example.invalid/world.zip", syncedAt: "2026-08-01T00:00:00.000Z" },
    }),
    `${report(`store.exportGameBundle("test-campaign").scenarioRef`)}`,
  );
  assert.equal(fromHub.builtIn, false);
  assert.equal(fromHub.hubOrigin.bundleUrl, "https://example.invalid/world.zip", "still downloadable, so it need not ride along");
  assert.equal(fromHub.scenarioName, "Hand Drawn World");

  const homemade = runStore(buildDataDir({ scenarioId: "my-own-map" }), `
    ${report(`store.exportGameBundle("test-campaign").scenarioRef`)}
  `);
  assert.equal(homemade.builtIn, false);
  assert.equal(homemade.hubOrigin, null, "nowhere to fetch it from, so the caller must embed the map");
});

test("a game whose scenario this install lacks still imports, and remembers what to ask for", () => {
  const root = buildDataDir({ scenarioId: "someone-elses-map", scenarioExists: false });
  const result = runStore(root, `
    const imported = store.importGameBundle({
      schema: "open-historia-game-bundle/1",
      game: { name: "Borrowed Campaign" },
      data: { game: { country: "Testland" }, world: {} },
      scenarioRef: {
        builtIn: false,
        hubOrigin: { postId: 7, bundleUrl: "https://example.invalid/map.zip", syncedAt: "2026-08-01T00:00:00.000Z" },
        scenarioId: "someone-elses-map",
        scenarioName: "Someone Else's Map",
      },
    });
    const card = store.getGameCatalog().games.find((entry) => entry.id === imported.game.id);
    ${report(`{
      scenarioMissing: card.scenarioMissing,
      scenarioId: card.scenarioId,
      importedScenarioName: card.importedScenarioName,
      importedScenarioOrigin: card.importedScenarioOrigin,
    }`)}
  `);

  assert.equal(result.scenarioMissing, true, "the card has to be able to say the map is not here");
  assert.equal(result.scenarioId, "someone-elses-map");
  assert.equal(
    result.importedScenarioName,
    "Someone Else's Map",
    "the scenario id is not a name a player can go and ask anyone for",
  );
  assert.equal(result.importedScenarioOrigin.bundleUrl, "https://example.invalid/map.zip");
});

test("the sender's scenario hints survive an ordinary meta write", () => {
  const root = buildDataDir({ scenarioId: "someone-elses-map", scenarioExists: false });
  const result = runStore(root, `
    const imported = store.importGameBundle({
      schema: "open-historia-game-bundle/1",
      game: { name: "Borrowed Campaign" },
      data: {},
      scenarioRef: { scenarioId: "someone-elses-map", scenarioName: "Someone Else's Map" },
    });
    // Archiving is the smallest ordinary meta write there is; readGameMeta
    // round-trips through it, so a field it does not name is a field this loses.
    store.updateGame(imported.game.id, { archived: true });
    const card = store.getGameCatalog().games.find((entry) => entry.id === imported.game.id);
    ${report(`{ importedScenarioName: card.importedScenarioName }`)}
  `);

  assert.equal(result.importedScenarioName, "Someone Else's Map");
});

test("no API key and no home-folder path ever reaches a bundle", () => {
  // The drift guard. Nothing writes a key or a path into a game today — settings
  // live in localStorage, not in the game — so this passes on an ordinary save.
  // It is here to fail loudly on the day something starts writing one.
  const root = buildDataDir();
  const serialised = runStore(root, `
    ${report(`JSON.stringify(store.exportGameBundle("test-campaign"))`)}
  `);

  const forbidden = [
    [/sk-[A-Za-z0-9]{16,}/, "an OpenAI-style key"],
    [/AIza[A-Za-z0-9_-]{20,}/, "a Google-style key"],
    [/sk-ant-[A-Za-z0-9-]{16,}/, "an Anthropic-style key"],
    [/"apiKey"/, "a field literally called apiKey"],
    [/[A-Za-z]:\\\\Users\\\\[^\\\\"]+/, "a Windows home folder"],
    [/\/(?:home|Users)\/[^/"]+\//, "a POSIX home folder"],
  ];
  for (const [pattern, what] of forbidden) {
    assert.equal(pattern.test(serialised), false, `a game bundle must never carry ${what}`);
  }
});

test("a game whose own map is already gone still exports, and passes the name on", () => {
  // Found by running the app: a real save pointed at a scenario that had been
  // deleted, and the export tried to embed a map that was not there — which
  // fails the whole export rather than the one part that cannot work. A game in
  // that state must still be exportable, as a pointer, and must hand on whatever
  // name it knows so the map does not become an id at the first hop.
  const root = buildDataDir({ scenarioId: "long-gone", scenarioExists: false });
  const result = runStore(root, `
    const imported = store.importGameBundle({
      schema: "open-historia-game-bundle/1",
      game: { name: "Passed Along" },
      data: {},
      scenarioRef: { scenarioId: "long-gone", scenarioName: "Someone Else's Map" },
    });
    const reExported = store.exportGameBundle(imported.game.id);
    const direct = store.exportGameBundle("test-campaign");
    ${report(`{ reExported: reExported.scenarioRef, direct: direct.scenarioRef }`)}
  `);

  assert.equal(result.direct.missing, true, "the bundle says this install has no map to embed");
  assert.equal(result.direct.builtIn, false);
  assert.equal(result.reExported.missing, true);
  assert.equal(
    result.reExported.scenarioName,
    "Someone Else's Map",
    "the name the last sender knew is handed on, not the id",
  );
});

test("an imported game records when it arrived, so the library can place it", () => {
  // Last Played ranks a game by when the player last touched it, and importing
  // counts. It cannot use createdAt: readGameMeta mints a fresh one on every read
  // for a game that has none on disk — real saves exist in that state — so such a
  // game would read as newer than everything, forever, and push every import past
  // it. importedAt is written once, by the import, and never minted.
  const root = buildDataDir();
  const result = runStore(root, `
    const before = new Date().toISOString();
    const bundle = store.exportGameBundle("test-campaign");
    const imported = store.importGameBundle(bundle);
    const card = () => store.getGameCatalog().games.find((entry) => entry.id === imported.game.id);
    const first = card().importedAt;
    // Any ordinary meta write must not lose it, and must not move it either.
    store.updateGame(imported.game.id, { archived: true });
    ${report(`{
      before,
      first,
      afterWrite: card().importedAt,
      source: store.getGameCatalog().games.find((entry) => entry.id === "test-campaign").importedAt,
    }`)}
  `);

  assert.ok(result.first, "an imported game is stamped with its arrival");
  assert.ok(result.first >= result.before, "and the stamp is the moment it arrived, not the sender's clock");
  assert.equal(result.afterWrite, result.first, "an ordinary meta write neither drops nor moves it");
  assert.equal(result.source, null, "a game that was never imported has none");
});

test("the bundle reports what the map would weigh, and only when that matters", () => {
  // The client has to decide whether it can carry a map BEFORE downloading it:
  // fetching a 297 MB scenario bundle to discover it is too big is the crash this
  // number exists to avoid. Measured on a real hub map, a 220 MB scenario folder
  // bundles to 297 MB, because a bundle embeds every asset as base64.
  const embeddable = runStore(buildDataDir({ scenarioId: "my-own-map" }), `
    ${report(`store.exportGameBundle("test-campaign").scenarioRef`)}
  `);
  assert.equal(embeddable.hubOrigin, null);
  assert.ok(embeddable.scenarioBytes > 0, "a map that must travel is measured");

  const builtIn = runStore(buildDataDir({ scenarioId: "default" }), `
    ${report(`store.exportGameBundle("test-campaign").scenarioRef`)}
  `);
  assert.equal(builtIn.scenarioBytes, 0, "the built-in map never travels, so it is not weighed");

  const fromHub = runStore(
    buildDataDir({
      scenarioId: "shared-world",
      hubOrigin: { postId: 42, bundleUrl: "https://example.invalid/world.zip", syncedAt: "2026-08-01T00:00:00.000Z" },
    }),
    `${report(`store.exportGameBundle("test-campaign").scenarioRef`)}`,
  );
  assert.equal(fromHub.scenarioBytes, 0, "a map that can be re-downloaded never travels either");

  const gone = runStore(buildDataDir({ scenarioId: "long-gone", scenarioExists: false }), `
    ${report(`store.exportGameBundle("test-campaign").scenarioRef`)}
  `);
  assert.equal(gone.scenarioBytes, 0, "a map this install does not have cannot be weighed or carried");
});

test("the campaign's own dates travel, and arrival is recorded separately", () => {
  // createdAt is when the campaign began. Minting a new one on import would tell
  // the receiver it started the moment the file landed, which is the one thing
  // they can already see. When it arrived is importedAt's job, not createdAt's.
  const root = buildDataDir();
  const result = runStore(root, `
    const bundle = store.exportGameBundle("test-campaign");
    const imported = store.importGameBundle(bundle);
    const card = store.getGameCatalog().games.find((entry) => entry.id === imported.game.id);
    ${report(`{
      sentCreatedAt: bundle.game.createdAt,
      sentUpdatedAt: bundle.game.updatedAt,
      landedCreatedAt: card.createdAt,
      landedImportedAt: card.importedAt,
    }`)}
  `);

  assert.equal(result.sentCreatedAt, "2026-08-01T00:00:00.000Z", "the bundle carries the sender's createdAt");
  assert.ok(result.sentUpdatedAt, "and its updatedAt");
  assert.equal(result.landedCreatedAt, result.sentCreatedAt, "which the import keeps rather than minting its own");
  assert.ok(result.landedImportedAt > result.sentCreatedAt, "arrival is recorded separately, and is later");
});

test("an optional file the game does not have stays out of the bundle, so the scenario's shows through", () => {
  // The game has its own colours but no flags file: it reads the scenario's
  // flags. Exported as {}, the flags became the imported game's own and hid them.
  const root = buildDataDir();
  writeJson(path.join(root, "scenarios", "default", "flags.json"), { Testland: "data:image/png;base64,AAAA" });
  const result = runStore(root, `
    const bundle = store.exportGameBundle("test-campaign");
    const imported = store.importGameBundle(bundle);
    store.setActiveGame(imported.game.id);
    ${report(`{
      keys: Object.keys(bundle.data),
      colors: bundle.data.colors,
      flags: store.readRuntimeJsonAsset("flags").data,
    }`)}
  `);

  assert.deepEqual(result.colors, { Testland: [1, 2, 3] }, "a file the game has travels");
  for (const key of ["flags", "tags", "institutionLogos"]) {
    assert.equal(result.keys.includes(key), false, `${key} is not exported as an empty object`);
  }
  assert.deepEqual(result.flags, { Testland: "data:image/png;base64,AAAA" }, "the imported game reads the scenario's flags");
});
