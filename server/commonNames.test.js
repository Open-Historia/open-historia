// Run: node --test server/commonNames.test.js
//
// "rename all these countries by their more common names in the scenario
// template and for modern day so they are spain and france. leave the us's name
// as it is tho" (the owner, 2026-11-09). The built-in has had the common names
// since revision 2; these are the older worlds that kept the formal ones
// (server/commonNames.js), and what bringing them across must and must not do.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import {
  COMMON_NAMES_SCHEMA,
  KEPT_FORMAL_NAMES,
  commonNameRenames,
  migrateToCommonNames,
  needsCommonNames,
  scenarioPredatesCommonNames,
} from "./commonNames.js";
import { OWNER_SCHEMA } from "./ownerMigration.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const readJson = (file) => JSON.parse(readFileSync(file, "utf-8"));
const SEED_WORLD = readJson(path.join(SERVER_DIR, "seed", "default", "world.json"));
const RENAMES = commonNameRenames(SEED_WORLD);

// An older Modern Day world: the hand-drawn map before revision 2, its
// countries under their formal names with their own colours.
const olderWorld = (extra = {}) => ({
  ownerSchema: OWNER_SCHEMA,
  builtInMap: "fault-lines-2014-v1",
  customRegions: true,
  polityOverrides: {
    "Kingdom of Spain": { name: "Kingdom of Spain", aliases: ["Kingdom of Spain"], status: "active", note: "", color: "#c1a66e" },
    "French Republic": { name: "French Republic", aliases: ["French Republic"], status: "active", note: "", color: "#4d7893" },
    "United States of America": { name: "United States of America", aliases: ["United States of America"], status: "active", note: "", color: "#557b98" },
    Algeria: { name: "Algeria", aliases: ["Algeria"], status: "active", note: "", color: "#b79a75" },
  },
  regionOwnershipOverrides: { r1: "Kingdom of Spain", r2: "French Republic", r3: "United States of America", r4: "Algeria" },
  regionClaimants: { r1: ["French Republic"] },
  relations: [{ a: "Kingdom of Spain", b: "French Republic", status: "friendly" }],
  units: [{ id: "u1", ownerCode: "French Republic" }],
  ...extra,
});
// The colours the owner's copy read: the seed's palette, keyed by common names.
const SEED_COLORS = { Spain: [193, 166, 110], France: [77, 120, 147], Algeria: [183, 154, 117] };

test("the renames are the seed's former names, less the United States'", () => {
  const table = new Map(RENAMES);
  assert.equal(table.get("Kingdom of Spain"), "Spain");
  assert.equal(table.get("French Republic"), "France");
  assert.equal(table.get("Russian Federation"), "Russia");
  assert.ok(KEPT_FORMAL_NAMES.includes("United States of America"));
  assert.equal(table.has("United States of America"), false, "the owner: leave the US's name as it is");
  assert.ok(RENAMES.length > 150, `${RENAMES.length} renames`);
  for (const [formal, common] of RENAMES) {
    assert.ok(SEED_WORLD.polityOverrides[common], `${common} is a country of the seed`);
    assert.equal(SEED_WORLD.polityOverrides[formal], undefined, `${formal} is not`);
  }
});

test("an older world takes the common names, and everything keyed by them follows", () => {
  const migrated = migrateToCommonNames({
    world: olderWorld(),
    game: { country: "Kingdom of Spain", gameDate: "2017-01-01" },
    colors: SEED_COLORS,
    flags: { "French Republic": "data:fr" },
    chat: [{ id: "c1", countries: ["Kingdom of Spain", "French Republic"] }],
    actions: [{ id: "a1", participants: ["French Republic"], invitees: [] }],
  }, RENAMES);
  const { world } = migrated;
  assert.deepEqual(Object.keys(world.polityOverrides).sort(), ["Algeria", "France", "Spain", "United States of America"]);
  assert.equal(world.polityOverrides.Spain.name, "Spain");
  assert.equal(world.polityOverrides.Spain.color, "#c1a66e", "its own colour goes with it");
  assert.ok(world.polityOverrides.Spain.formerNames.includes("Kingdom of Spain"), "the old name still resolves");
  assert.deepEqual(world.regionOwnershipOverrides, { r1: "Spain", r2: "France", r3: "United States of America", r4: "Algeria" });
  assert.deepEqual(world.regionClaimants, { r1: ["France"] });
  assert.deepEqual([world.relations[0].a, world.relations[0].b], ["Spain", "France"]);
  assert.equal(world.units[0].ownerCode, "France");
  assert.equal(world.polityOverrides["United States of America"].name, "United States of America", "the United States keep their name");
  assert.equal(world.commonNames, COMMON_NAMES_SCHEMA);
  assert.equal(migrated.game.country, "Spain", "the player's country follows");
  assert.deepEqual(migrated.flags, { France: "data:fr" });
  assert.deepEqual(migrated.chat[0].countries, ["Spain", "France"]);
  assert.deepEqual(migrated.actions[0].participants, ["France"]);
  assert.equal(migrated.colors, undefined, "colours already keyed by the common names are left exactly as they are");
  for (const owner of Object.values(world.regionOwnershipOverrides)) {
    assert.ok(SEED_COLORS[owner] || world.polityOverrides[owner]?.color, `${owner} has a colour`);
  }
  assert.deepEqual(migrated.renamed.map(({ to }) => to).sort(), ["France", "Spain"]);
});

test("colours kept under the old name move to the new one", () => {
  const migrated = migrateToCommonNames({
    world: olderWorld(),
    colors: { "Kingdom of Spain": [1, 2, 3], Spain: [9, 9, 9], Algeria: [4, 5, 6] },
    tags: { "French Republic": ["republic"] },
  }, RENAMES);
  assert.deepEqual(migrated.colors, { Spain: [1, 2, 3], Algeria: [4, 5, 6] }, "the country's own colour, where the old one stood");
  assert.deepEqual(migrated.tags, { France: ["republic"] });
});

test("two countries are never made one", () => {
  const both = olderWorld();
  both.polityOverrides.Spain = { name: "Spain", aliases: [], color: "#ff0000" };
  both.regionOwnershipOverrides.r5 = "Spain";
  const { world, renamed } = migrateToCommonNames({ world: both }, RENAMES);
  assert.ok(world.polityOverrides["Kingdom of Spain"], "the formal one stays when the common name is a country of its own");
  assert.ok(world.polityOverrides.Spain);
  assert.equal(world.regionOwnershipOverrides.r1, "Kingdom of Spain");
  assert.equal(world.regionOwnershipOverrides.r5, "Spain");
  assert.deepEqual(renamed.map(({ to }) => to), ["France"], "the others still go");
});

test("once a world is brought across it is never touched again", () => {
  const { world } = migrateToCommonNames({ world: olderWorld() }, RENAMES);
  assert.equal(needsCommonNames(world), false);
  // The story names a country formally later on: it stays so.
  const later = { ...world, polityOverrides: { ...world.polityOverrides, "Kingdom of Portugal": { name: "Kingdom of Portugal" } } };
  assert.equal(needsCommonNames(later), false);
});

test("only worlds that took the formal names from the built-in are brought across", () => {
  assert.equal(needsCommonNames(olderWorld()), true, "the hand-drawn map before revision 2");
  assert.equal(needsCommonNames(olderWorld({ builtInRevision: 2 })), false, "made after the countries were renamed");
  assert.equal(needsCommonNames(olderWorld({ builtInMap: "modern-day-world-2026-10-v1" })), false, "the current map never had the formal names");
  const unstamped = olderWorld({ builtInMap: undefined });
  assert.equal(needsCommonNames(unstamped, { scenarioId: "wwii-1939" }), false, "a community scenario keeps its names");
  assert.equal(needsCommonNames(unstamped, { scenarioId: "my-modern-day" }), false);
  assert.equal(needsCommonNames(unstamped, { scenarioId: "modern-day-edited" }), true, "a kept copy of Modern Day");
  assert.equal(needsCommonNames(unstamped, { scenarioId: "modern-day-classic-2" }), true);
  assert.equal(needsCommonNames(unstamped, { parentPredates: true }), true, "a game on such a copy");
  assert.equal(needsCommonNames(unstamped, { parentPredates: false }), false);
  assert.equal(scenarioPredatesCommonNames("modern-day-edited", olderWorld()), true);
  assert.equal(scenarioPredatesCommonNames("default", SEED_WORLD), false);
});

// The desktop store, end to end: the owner's case on disk.
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

test("the desktop store brings an edited copy and its campaign across when the campaign is opened", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-common-names-"));
  roots.push(root);
  const createdAt = "2026-09-20T00:00:00.000Z";
  const scenarioDir = path.join(root, "scenarios", "modern-day-edited");
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "modern-day-edited", name: "Modern Day (your edited copy)", createdAt, updatedAt: createdAt });
  writeJson(path.join(scenarioDir, "world.json"), olderWorld());
  writeJson(path.join(scenarioDir, "game.json"), { country: "Kingdom of Spain", startDate: "2016-01-01", gameDate: "2016-01-01" });
  writeJson(path.join(scenarioDir, "colors.json"), SEED_COLORS);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default", "modern-day-edited"], selectedScenarioId: "default", version: 2 });
  const gameDir = path.join(root, "games", "modern-day-session");
  writeJson(path.join(gameDir, "game-instance.json"), { id: "modern-day-session", name: "Modern Day Session", scenarioId: "modern-day-edited", createdAt, updatedAt: createdAt });
  writeJson(path.join(gameDir, "world.json"), olderWorld());
  writeJson(path.join(gameDir, "game.json"), { country: "United States of America", gameDate: "2016-03-01" });
  writeJson(path.join(gameDir, "storage", "chat.json"), [{ id: "c1", countries: ["United States of America", "French Republic"] }]);
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "modern-day-session", order: ["modern-day-session"], version: 2 });

  const read = `const world = store.readRuntimeJsonAsset("world").data; const game = store.readRuntimeJsonAsset("game").data; const colors = store.readRuntimeJsonAsset("colors").data; const chat = store.readRuntimeJsonAsset("chat").data;`;
  const result = runStore(root, `${read} ${`process.stdout.write("\\n@@" + JSON.stringify({ polities: Object.keys(world.polityOverrides).sort(), owners: world.regionOwnershipOverrides, country: game.country, colors, chat }));`}`);
  assert.deepEqual(result.polities, ["Algeria", "France", "Spain", "United States of America"]);
  assert.deepEqual(result.owners, { r1: "Spain", r2: "France", r3: "United States of America", r4: "Algeria" });
  assert.equal(result.country, "United States of America", "the player's United States stay as they were");
  assert.deepEqual(result.colors, SEED_COLORS, "the game reads its copy's colours, which now name its countries");
  assert.deepEqual(result.chat[0].countries, ["United States of America", "France"]);
  const scenarioWorld = readJson(path.join(scenarioDir, "world.json"));
  assert.ok(scenarioWorld.polityOverrides.Spain && !scenarioWorld.polityOverrides["Kingdom of Spain"], "the copy itself is brought across too");
  assert.equal(readJson(path.join(scenarioDir, "game.json")).country, "Spain", "and its starting country");

  const before = readFileSync(path.join(gameDir, "world.json"), "utf-8");
  runStore(root, `store.readRuntimeJsonAsset("world"); process.stdout.write("\\n@@true");`);
  assert.equal(readFileSync(path.join(gameDir, "world.json"), "utf-8"), before, "a second opening does nothing more");
});

test("the desktop store leaves a community scenario's formal names alone", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-common-names-"));
  roots.push(root);
  const createdAt = "2026-09-20T00:00:00.000Z";
  const scenarioDir = path.join(root, "scenarios", "europe-1900");
  const { builtInMap: _stamp, ...world } = olderWorld();
  writeJson(path.join(scenarioDir, "scenario.json"), { id: "europe-1900", name: "Europe 1900", createdAt, updatedAt: createdAt });
  writeJson(path.join(scenarioDir, "world.json"), world);
  writeJson(path.join(scenarioDir, "game.json"), { country: "French Republic", startDate: "1900-01-01", gameDate: "1900-01-01" });
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["default", "europe-1900"], selectedScenarioId: "europe-1900", version: 2 });
  const gameDir = path.join(root, "games", "belle-epoque");
  writeJson(path.join(gameDir, "game-instance.json"), { id: "belle-epoque", name: "Belle Epoque", scenarioId: "europe-1900", createdAt, updatedAt: createdAt });
  writeJson(path.join(gameDir, "world.json"), world);
  writeJson(path.join(gameDir, "game.json"), { country: "French Republic", gameDate: "1900-03-01" });
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "belle-epoque", order: ["belle-epoque"], version: 2 });

  const result = runStore(root, `const world = store.readRuntimeJsonAsset("world").data; process.stdout.write("\\n@@" + JSON.stringify(Object.keys(world.polityOverrides).sort()));`);
  assert.deepEqual(result, ["Algeria", "French Republic", "Kingdom of Spain", "United States of America"]);
  assert.deepEqual(readJson(path.join(scenarioDir, "world.json")), world);
});
