// Run: node --test server/builtInScenarioSeed.test.js
//
// The built-in Modern Day scenario ships as a seed (server/seed/default) with a
// hand-drawn map of its own, and the server copies it into the data directory:
// on a first run, and again when the seed carries a newer map than the install
// (world.json `builtInMap`). The stock GADM world that every scenario without a
// map of its own renders on has its own home (server/data/stock). What has to
// hold, because each of these fails silently on a player's machine otherwise:
//   - a fresh data dir gets the whole seed;
//   - an older install keeps the campaigns started on the previous map, in a
//     forked scenario that renders on the stock world, and its stock file is
//     moved into place rather than downloaded again;
//   - an untouched older install with no campaigns is simply reset;
//   - a scenario created from scratch starts on the built-in map;
//   - a scenario without a map of its own renders on the stock world, never on
//     the built-in's map;
//   - newer content on the same map (world.json `builtInRevision`: the countries
//     renamed) refreshes the built-in in place, its campaigns staying on it with
//     copies of whatever they still read from it, and a copy the player edited is
//     kept with its campaigns first.
// Each case runs in its own child process because OH_DATA_DIR is read once, at
// import time, so one process can only ever see one data directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync, truncateSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(SERVER_DIR, "..");
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const SEED_DIR = path.join(SERVER_DIR, "seed", "default");
const readJson = (file) => JSON.parse(readFileSync(file, "utf-8"));
const seedWorld = readJson(path.join(SEED_DIR, "world.json"));
const STAMP = seedWorld.builtInMap;
const STOCK_BYTES = readJson(path.join(ROOT_DIR, "scripts", "map-assets.json")).assets.find(
  (asset) => asset.path === "server/data/stock/regions.geojson",
).bytes;
const seedRegionsBytes = statSync(path.join(SEED_DIR, "regions.geojson")).size;

const roots = [];
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};
// A file with exactly the stock world's byte size, instantly (sparse).
const writeStockSized = (file) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "");
  truncateSync(file, STOCK_BYTES);
};
const freshRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-builtin-"));
  roots.push(root);
  return root;
};

// The built-in scenario as an install from before the redraw had it: meta from
// the old first run, the stock world as its regions.geojson, the old GADM-keyed
// world, and optionally a campaign started on it.
const legacyRoot = ({ game = null, touched = false } = {}) => {
  const root = freshRoot();
  const dir = path.join(root, "scenarios", "default");
  const createdAt = "2026-06-01T00:00:00.000Z";
  writeJson(path.join(dir, "scenario.json"), {
    id: "default",
    name: "Modern Day",
    createdAt,
    updatedAt: touched ? "2026-07-01T00:00:00.000Z" : createdAt,
  });
  writeJson(path.join(dir, "world.json"), {
    ownerSchema: OWNER_SCHEMA,
    customRegions: true,
    regionOwnershipOverrides: { "RUS.3_1": "Russia" },
  });
  writeJson(path.join(dir, "game.json"), { country: "Russia", startDate: "2016-01-01", gameDate: "2016-01-01" });
  writeJson(path.join(dir, "colors.json"), { Russia: [1, 2, 3] });
  writeStockSized(path.join(dir, "regions.geojson"));
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default"], selectedScenarioId: "default", version: 2 });
  if (game) {
    const gameDir = path.join(root, "games", game);
    writeJson(path.join(gameDir, "game-instance.json"), { id: game, name: game, scenarioId: "default", createdAt, updatedAt: createdAt });
    writeJson(path.join(gameDir, "world.json"), { ownerSchema: OWNER_SCHEMA, regionOwnershipOverrides: { "RUS.3_1": "Russia", "UKR.4_1": "Russia" } });
    writeJson(path.join(gameDir, "game.json"), { country: "Russia", gameDate: "2017-03-01" });
    writeJson(path.join(root, "game-manifest.json"), { activeGameId: game, order: [game], version: 2 });
  }
  return root;
};

// Runs `body` against the store in a child process bound to `root`; the body
// prints its result after a marker so the store's own log lines never get in
// the way.
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

test("the seed is a complete scenario whose world matches its map", () => {
  assert.ok(STAMP, "world.json carries a builtInMap stamp");
  const regions = readJson(path.join(SEED_DIR, "regions.geojson"));
  const cities = readJson(path.join(SEED_DIR, "cities.geojson"));
  assert.ok(regions.features.length > 4000, `regions: ${regions.features.length}`);
  assert.ok(cities.features.length > 2000, `cities: ${cities.features.length}`);
  assert.ok(seedRegionsBytes < 20 * 1024 * 1024, "the map has to stay small enough to ship in the app and on the website");
  const owners = new Set(regions.features.map((feature) => feature.properties.owner).filter(Boolean));
  const overrides = seedWorld.regionOwnershipOverrides;
  for (const feature of regions.features) {
    const { id, owner } = feature.properties;
    if (owner) assert.equal(overrides[id], owner, `region ${id} is owned by ${owner} in both files`);
  }
  for (const owner of owners) {
    assert.ok(seedWorld.ownerCodes.includes(owner), `${owner} is a playable faction`);
    assert.ok(seedWorld.polityOverrides[owner], `${owner} has a polity record`);
  }
  assert.equal(seedWorld.customRegions, true);
  assert.equal(seedWorld.customCities, true);
  assert.ok(owners.has(readJson(path.join(SEED_DIR, "game.json")).country), "the seed's starting country is on the map");
  const meta = readJson(path.join(SEED_DIR, "scenario.json"));
  assert.equal(meta.createdAt, meta.updatedAt, "the seed is an untouched scenario");
  assert.ok(existsSync(path.join(SEED_DIR, "colors.json")));
  assert.ok(Number.isInteger(seedWorld.builtInRevision) && seedWorld.builtInRevision >= 2, "the seed carries the revision its renamed countries shipped in");
});

test("a fresh data directory gets the whole seed", () => {
  const root = freshRoot();
  const result = runStore(root, `store.ensureScenarioStore(); ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id) }")}`);
  assert.deepEqual(result.catalog, ["default"]);
  const dir = path.join(root, "scenarios", "default");
  assert.equal(readJson(path.join(dir, "world.json")).builtInMap, STAMP);
  assert.equal(statSync(path.join(dir, "regions.geojson")).size, seedRegionsBytes);
  assert.equal(readJson(path.join(dir, "cities.geojson")).features.length, readJson(path.join(SEED_DIR, "cities.geojson")).features.length);
  assert.ok(existsSync(path.join(dir, "colors.json")));
  assert.ok(existsSync(path.join(dir, "cover-image.bin")));
  assert.ok(!existsSync(path.join(dir, "prompts.json")), "prompts are the code's current defaults, not the seed's snapshot");
  const meta = readJson(path.join(dir, "scenario.json"));
  assert.equal(meta.createdAt, meta.updatedAt, "seeded is untouched");
});

test("an older install keeps its campaigns on the previous map and moves the stock file into place", () => {
  const root = legacyRoot({ game: "old-campaign" });
  const result = runStore(root, `
    store.ensureScenarioStore();
    const runtime = store.readRuntimeJsonAsset("regionsGeojson");
    ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id), runtimeSource: runtime.sourcePath }")}
  `);
  assert.deepEqual([...result.catalog].sort(), ["default", "modern-day-classic"]);
  assert.equal(readJson(path.join(root, "games", "old-campaign", "game-instance.json")).scenarioId, "modern-day-classic");

  const classic = path.join(root, "scenarios", "modern-day-classic");
  assert.deepEqual(readJson(path.join(classic, "world.json")).regionOwnershipOverrides, { "RUS.3_1": "Russia" });
  assert.deepEqual(readJson(path.join(classic, "colors.json")), { Russia: [1, 2, 3] });
  assert.ok(!existsSync(path.join(classic, "regions.geojson")), "the fork renders on the stock world; it carries no copy");
  assert.equal(readJson(path.join(classic, "scenario.json")).name, "Modern Day (classic map)");

  const stock = path.join(root, "stock", "regions.geojson");
  assert.equal(statSync(stock).size, STOCK_BYTES, "the old built-in file IS the stock world: moved, not downloaded again");
  assert.equal(path.resolve(result.runtimeSource), path.resolve(stock), "the campaign's geometry is the stock world");

  const dir = path.join(root, "scenarios", "default");
  assert.equal(readJson(path.join(dir, "world.json")).builtInMap, STAMP);
  assert.equal(statSync(path.join(dir, "regions.geojson")).size, seedRegionsBytes);
  assert.deepEqual(readJson(path.join(root, "scenario-manifest.json")).order, ["default", "modern-day-classic"]);
});

test("a copy the player edited is kept as the classic scenario even without campaigns", () => {
  const root = legacyRoot({ touched: true });
  const result = runStore(root, `store.ensureScenarioStore(); ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id) }")}`);
  assert.deepEqual([...result.catalog].sort(), ["default", "modern-day-classic"]);
});

test("an untouched older install with no campaigns is simply reset", () => {
  const root = legacyRoot();
  const result = runStore(root, `store.ensureScenarioStore(); ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id) }")}`);
  assert.deepEqual(result.catalog, ["default"]);
  assert.equal(statSync(path.join(root, "stock", "regions.geojson")).size, STOCK_BYTES);
  const dir = path.join(root, "scenarios", "default");
  assert.equal(readJson(path.join(dir, "world.json")).builtInMap, STAMP);
  assert.equal(statSync(path.join(dir, "regions.geojson")).size, seedRegionsBytes);
});

test("a second start does nothing more", () => {
  const root = legacyRoot({ game: "old-campaign" });
  runStore(root, `store.ensureScenarioStore(); ${report("{}")}`);
  const before = readJson(path.join(root, "scenario-manifest.json"));
  runStore(root, `store.ensureScenarioStore(); ${report("{}")}`);
  assert.deepEqual(readJson(path.join(root, "scenario-manifest.json")), before);
  assert.ok(!existsSync(path.join(root, "scenarios", "modern-day-classic-2")), "no second fork");
});

test("a scenario created from scratch starts on the built-in map", () => {
  const root = freshRoot();
  const result = runStore(root, `
    store.ensureScenarioStore();
    const details = store.createScenario({ name: "Blank slate" });
    ${report("{ id: details.scenario.id }")}
  `);
  const dir = path.join(root, "scenarios", result.id);
  assert.equal(statSync(path.join(dir, "regions.geojson")).size, seedRegionsBytes, "its own copy of the built-in map");
  assert.equal(readJson(path.join(dir, "cities.geojson")).features.length, readJson(path.join(SEED_DIR, "cities.geojson")).features.length);
  assert.ok(existsSync(path.join(dir, "colors.json")));
  assert.equal(readJson(path.join(dir, "world.json")).builtInMap, STAMP);
  assert.ok(!existsSync(path.join(dir, "cover-image.bin")), "not the built-in's cover");
});

test("a scenario without a map of its own renders on the stock world, never on the built-in's map", () => {
  const root = freshRoot();
  writeStockSized(path.join(root, "stock", "regions.geojson"));
  const preset = path.join(root, "scenarios", "hub-preset");
  writeJson(path.join(preset, "scenario.json"), { id: "hub-preset", name: "WWII", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" });
  writeJson(path.join(preset, "world.json"), { ownerSchema: OWNER_SCHEMA, customRegions: true, regionOwnershipOverrides: { "POL.1_1": "Germany" } });
  writeJson(path.join(preset, "game.json"), { country: "Germany", startDate: "1939-09-01", gameDate: "1939-09-01" });
  const result = runStore(root, `
    store.ensureScenarioStore();
    const onPreset = store.createGame({ name: "Blitz", scenarioId: "hub-preset", setActive: true });
    const presetSource = store.readRuntimeJsonAsset("regionsGeojson").sourcePath;
    const onBuiltIn = store.createGame({ name: "Modern", scenarioId: "default", setActive: true });
    const builtInSource = store.readRuntimeJsonAsset("regionsGeojson").sourcePath;
    ${report("{ presetSource, builtInSource, games: [onPreset.game.id, onBuiltIn.game.id] }")}
  `);
  assert.equal(path.resolve(result.presetSource), path.resolve(path.join(root, "stock", "regions.geojson")));
  assert.equal(path.resolve(result.builtInSource), path.resolve(path.join(root, "scenarios", "default", "regions.geojson")));
});

test("a built-in that already holds the seed's map but lost its record is completed in place, not forked", () => {
  const root = freshRoot();
  const dir = path.join(root, "scenarios", "default");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "regions.geojson"), readFileSync(path.join(SEED_DIR, "regions.geojson")));
  // What ensureDefaultScenario writes when it finds no meta: a bare, untouched one.
  const createdAt = "2026-09-07T12:00:00.000Z";
  writeJson(path.join(dir, "scenario.json"), { id: "default", name: "Modern Day", createdAt, updatedAt: createdAt });
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default"], selectedScenarioId: "default", version: 2 });
  const gameDir = path.join(root, "games", "new-campaign");
  writeJson(path.join(gameDir, "game-instance.json"), { id: "new-campaign", name: "new", scenarioId: "default", createdAt, updatedAt: createdAt });
  writeJson(path.join(gameDir, "world.json"), { ownerSchema: OWNER_SCHEMA, builtInMap: STAMP, regionOwnershipOverrides: { 0: "United States of America" } });
  writeJson(path.join(gameDir, "game.json"), { country: "United States of America", gameDate: "2016-02-01" });
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "new-campaign", order: ["new-campaign"], version: 2 });

  const result = runStore(root, `store.ensureScenarioStore(); ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id), world: store.getScenarioDetails('default').data.world }")}`);
  assert.deepEqual(result.catalog, ["default"], "no classic fork: the map was already the seed's");
  assert.equal(result.world.builtInMap, STAMP);
  assert.equal(result.world.customRegions, true);
  assert.ok(result.world.ownerCodes.length > 100, "the world came back with its owners");
  assert.equal(readJson(path.join(gameDir, "game-instance.json")).scenarioId, "default", "the campaign stays on the built-in");
  assert.ok(existsSync(path.join(dir, "colors.json")));
  assert.equal(readJson(path.join(dir, "cities.geojson")).features.length, readJson(path.join(SEED_DIR, "cities.geojson")).features.length);
});

test("a packaged install from before the redraw — meta and the stock map, no world.json — keeps its campaign on the stock world", () => {
  const root = freshRoot();
  const dir = path.join(root, "scenarios", "default");
  const createdAt = "2026-08-01T00:00:00.000Z";
  writeJson(path.join(dir, "scenario.json"), { id: "default", name: "Modern Day", createdAt, updatedAt: createdAt });
  writeJson(path.join(dir, "game.json"), { country: "Russia", startDate: "2016-01-01", gameDate: "2016-01-01" });
  writeStockSized(path.join(dir, "regions.geojson"));
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default"], selectedScenarioId: "default", version: 2 });
  const gameDir = path.join(root, "games", "desktop-campaign");
  writeJson(path.join(gameDir, "game-instance.json"), { id: "desktop-campaign", name: "desktop", scenarioId: "default", createdAt, updatedAt: createdAt });
  writeJson(path.join(gameDir, "world.json"), { ownerSchema: OWNER_SCHEMA, regionOwnershipOverrides: { "RUS.3_1": "Russia" } });
  writeJson(path.join(gameDir, "game.json"), { country: "Russia", gameDate: "2016-04-01" });
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "desktop-campaign", order: ["desktop-campaign"], version: 2 });

  const result = runStore(root, `
    store.ensureScenarioStore();
    const runtime = store.readRuntimeJsonAsset("regionsGeojson");
    ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id), runtimeSource: runtime.sourcePath }")}
  `);
  assert.deepEqual([...result.catalog].sort(), ["default", "modern-day-classic"]);
  assert.equal(readJson(path.join(gameDir, "game-instance.json")).scenarioId, "modern-day-classic");
  assert.equal(path.resolve(result.runtimeSource), path.resolve(path.join(root, "stock", "regions.geojson")));
  assert.equal(readJson(path.join(dir, "world.json")).builtInMap, STAMP);
});

test("a running server whose built-in loses its record completes it on the next read", () => {
  const root = freshRoot();
  const result = runStore(root, `
    store.ensureScenarioStore();
    const fs = await import("node:fs");
    const dir = ${JSON.stringify(path.join(root, "scenarios", "default"))};
    for (const f of ["world.json", "scenario.json", "colors.json", "game.json"]) fs.rmSync(dir + "/" + f, { force: true });
    store.ensureScenarioStore();
    ${report("{ world: store.getScenarioDetails('default').data.world, catalog: store.getScenarioCatalog().scenarios.map((s) => s.id) }")}
  `);
  assert.deepEqual(result.catalog, ["default"]);
  assert.equal(result.world.builtInMap, STAMP);
  assert.equal(result.world.customRegions, true);
  assert.ok(existsSync(path.join(root, "scenarios", "default", "colors.json")));
});

// The built-in as an install had it before the countries were renamed: the same
// map (stamp) with the first revision of its content, and two campaigns started
// on it — one with its own colours, one old enough to still read the scenario's.
const revisionOneRoot = ({ touched = false } = {}) => {
  const root = freshRoot();
  const dir = path.join(root, "scenarios", "default");
  const createdAt = "2026-09-07T12:00:00.000Z";
  writeJson(path.join(dir, "scenario.json"), { id: "default", name: "Modern Day", createdAt, updatedAt: touched ? "2026-09-10T08:00:00.000Z" : createdAt });
  writeJson(path.join(dir, "world.json"), {
    ownerSchema: OWNER_SCHEMA,
    builtInMap: STAMP,
    customRegions: true,
    polityOverrides: { "Kingdom of Spain": { code: "Kingdom of Spain", name: "Kingdom of Spain", aliases: [], color: "", note: "" } },
    regionOwnershipOverrides: { 0: "Kingdom of Spain" },
  });
  writeJson(path.join(dir, "game.json"), { country: "Kingdom of Spain", startDate: "2016-01-01", gameDate: "2016-01-01" });
  writeJson(path.join(dir, "colors.json"), { "Kingdom of Spain": [1, 2, 3] });
  writeJson(path.join(dir, "flags.json"), { "Kingdom of Spain": "data:flag" });
  writeFileSync(path.join(dir, "regions.geojson"), readFileSync(path.join(SEED_DIR, "regions.geojson")));
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default"], selectedScenarioId: "default", version: 2 });
  for (const [game, colors] of [["own-copies", { "Kingdom of Spain": [7, 7, 7] }], ["reads-scenario", null]]) {
    const gameDir = path.join(root, "games", game);
    writeJson(path.join(gameDir, "game-instance.json"), { id: game, name: game, scenarioId: "default", createdAt, updatedAt: createdAt });
    writeJson(path.join(gameDir, "world.json"), { ownerSchema: OWNER_SCHEMA, builtInMap: STAMP, regionOwnershipOverrides: { 0: "Kingdom of Spain" } });
    writeJson(path.join(gameDir, "game.json"), { country: "Kingdom of Spain", gameDate: "2016-05-01" });
    if (colors) writeJson(path.join(gameDir, "colors.json"), colors);
  }
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "own-copies", order: ["own-copies", "reads-scenario"], version: 2 });
  return root;
};
const catalogOf = (root) => runStore(root, `store.ensureScenarioStore(); ${report("store.getScenarioCatalog().scenarios.map((s) => s.id)")}`);

test("newer content on the same map refreshes the built-in in place, and its campaigns stay on it", () => {
  const root = revisionOneRoot();
  assert.deepEqual(catalogOf(root), ["default"], "nothing forked: the map is the same");
  const dir = path.join(root, "scenarios", "default");
  const world = readJson(path.join(dir, "world.json"));
  assert.equal(world.builtInMap, STAMP);
  assert.equal(world.builtInRevision, seedWorld.builtInRevision);
  assert.ok(world.polityOverrides.Spain, "the built-in has the seed's names");
  assert.equal(world.polityOverrides["Kingdom of Spain"], undefined);
  assert.deepEqual(readJson(path.join(dir, "colors.json")), readJson(path.join(SEED_DIR, "colors.json")));
  assert.ok(!existsSync(path.join(dir, "flags.json")), "the seed has no flags file");
  assert.equal(statSync(path.join(dir, "regions.geojson")).size, seedRegionsBytes);
  for (const game of ["own-copies", "reads-scenario"]) {
    assert.equal(readJson(path.join(root, "games", game, "game-instance.json")).scenarioId, "default", `${game} stays on the built-in`);
    assert.deepEqual(readJson(path.join(root, "games", game, "world.json")).regionOwnershipOverrides, { 0: "Kingdom of Spain" }, `${game}'s own world is untouched`);
  }
  assert.deepEqual(readJson(path.join(root, "games", "own-copies", "colors.json")), { "Kingdom of Spain": [7, 7, 7] }, "its own colours are its own");
  assert.deepEqual(readJson(path.join(root, "games", "own-copies", "flags.json")), { "Kingdom of Spain": "data:flag" }, "the flags it still read from the scenario are its own now");
  assert.deepEqual(readJson(path.join(root, "games", "reads-scenario", "colors.json")), { "Kingdom of Spain": [1, 2, 3] }, "the colours it was reading are now its own copy");
  assert.deepEqual(readJson(path.join(root, "games", "reads-scenario", "flags.json")), { "Kingdom of Spain": "data:flag" }, "and the flags");
});

test("a copy the player edited is kept with its campaigns before the content is refreshed", () => {
  const root = revisionOneRoot({ touched: true });
  assert.deepEqual([...catalogOf(root)].sort(), ["default", "modern-day-edited"]);
  const edited = path.join(root, "scenarios", "modern-day-edited");
  assert.ok(readJson(path.join(edited, "world.json")).polityOverrides["Kingdom of Spain"], "the edited copy keeps its content");
  assert.deepEqual(readJson(path.join(edited, "colors.json")), { "Kingdom of Spain": [1, 2, 3] });
  assert.equal(statSync(path.join(edited, "regions.geojson")).size, seedRegionsBytes, "and its map");
  assert.equal(readJson(path.join(edited, "scenario.json")).name, "Modern Day (your edited copy)");
  for (const game of ["own-copies", "reads-scenario"]) {
    assert.equal(readJson(path.join(root, "games", game, "game-instance.json")).scenarioId, "modern-day-edited", `${game} goes with the copy it was started on`);
  }
  const world = readJson(path.join(root, "scenarios", "default", "world.json"));
  assert.equal(world.builtInRevision, seedWorld.builtInRevision);
  assert.ok(world.polityOverrides.Spain);
  assert.deepEqual(readJson(path.join(root, "scenario-manifest.json")).order, ["default", "modern-day-edited"]);
});

test("a second start after the refresh does nothing more", () => {
  const root = revisionOneRoot({ touched: true });
  catalogOf(root);
  const manifest = readJson(path.join(root, "scenario-manifest.json"));
  const world = readFileSync(path.join(root, "scenarios", "default", "world.json"), "utf-8");
  assert.deepEqual([...catalogOf(root)].sort(), ["default", "modern-day-edited"]);
  assert.deepEqual(readJson(path.join(root, "scenario-manifest.json")), manifest);
  assert.equal(readFileSync(path.join(root, "scenarios", "default", "world.json"), "utf-8"), world);
  assert.ok(!existsSync(path.join(root, "scenarios", "modern-day-edited-2")), "no second copy");
});

// Seen on a player's install (2026-09-29): the built-in carried the new map's
// stamp but the old stock world as its regions.geojson — written by an older
// build run against the same data directory. The stamp matched, so nothing ever
// replaced the file: a new campaign's owners named regions the map did not
// have, the map drew no colours, and nothing could be placed on it.
test("a built-in stamped with the seed's map but holding the stock world gets the seed's map back", () => {
  const root = freshRoot();
  runStore(root, `store.ensureScenarioStore(); ${report("true")}`);
  const dir = path.join(root, "scenarios", "default");
  writeStockSized(path.join(dir, "regions.geojson"));
  writeFileSync(path.join(dir, "regions.coarse.geojson"), "{}");
  writeFileSync(path.join(dir, "regions.coarse.geojson.stamp"), "old");

  const result = runStore(root, `store.ensureScenarioStore(); ${report("{ catalog: store.getScenarioCatalog().scenarios.map((s) => s.id) }")}`);
  assert.equal(statSync(path.join(dir, "regions.geojson")).size, seedRegionsBytes, "the seed's map is back");
  assert.equal(existsSync(path.join(dir, "regions.coarse.geojson.stamp")), false, "the coarse copy of the old map is gone");
  assert.deepEqual(result.catalog, ["default"], "no fork: nothing was started on the stale file");
  assert.equal(readJson(path.join(dir, "world.json")).builtInMap, STAMP);
});

test("a map of the player's own in a stamped built-in is left alone", () => {
  const root = freshRoot();
  runStore(root, `store.ensureScenarioStore(); ${report("true")}`);
  const own = path.join(root, "scenarios", "default", "regions.geojson");
  writeFileSync(own, JSON.stringify({ type: "FeatureCollection", features: [] }));
  runStore(root, `store.ensureScenarioStore(); ${report("true")}`);
  assert.equal(readFileSync(own, "utf-8"), JSON.stringify({ type: "FeatureCollection", features: [] }));
});
