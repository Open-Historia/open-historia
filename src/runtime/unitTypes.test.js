/*! Open Historia — a scenario's own unit types: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/unitTypes.test.js
//
// "add custom units types that have their own custom stats for scenarios so like a dragon troop that is an air troop
// and super strong and very tough" (the owner, 2026-11-13). What a scenario's unit types are as a world keeps them,
// what a unit of one is, who may raise one, and that a new game inherits them.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import { WORLD_DEFAULTS, UNIT_TYPES as STATE_UNIT_TYPES, applyUnitOpBatch, advanceStandingOrders, normalizeUnitEntry, normalizeWorldState } from "./gameState.js";
import {
  FIGURE_MOST,
  ORDINARY,
  SPEED_MOST,
  UNIT_TYPES,
  UNIT_TYPES_MOST,
  describeUnitTypesForPrompt,
  findUnitType,
  mayFieldUnitType,
  normalizeUnitTypes,
  unitFigures,
} from "./unitTypes.js";
import { TEMPLATE_WORLD_OVERRIDE_KEYS } from "./web/storeConstants.js";
import { buildFreshWorldSeedFromScenario } from "./web/models.js";
import { renamePolityInWorld } from "../../server/polityRename.js";
import { RECEIPT_PLAYER_TEXTS, receiptPlayerNote } from "./receiptPlayerNotes.js";

const DRAGON = { id: "dragon", name: "Dragon", base: "air", attack: 5, toughness: 4, speed: 2, icon: "🐉", note: "Breathes fire.", owners: ["Wessex"] };
const ELEPHANTS = { id: "war-elephants", name: "War Elephants", base: "armor", attack: 3, toughness: 2, speed: 0.5, icon: "🐘", note: "", owners: [] };
const unit = (extra = {}) => ({ id: "u1", name: "Black Wing", type: "air", ownerCode: "Wessex", strength: 80, lng: -1.3, lat: 51.1, ...extra });

test("the kinds of unit are one list, and a scenario that names no unit types holds none", () => {
  assert.equal(STATE_UNIT_TYPES, UNIT_TYPES, "gameState.js re-exports the one list");
  assert.deepEqual(UNIT_TYPES, ["infantry", "armor", "air", "naval", "artillery", "garrison"]);
  assert.deepEqual(WORLD_DEFAULTS.unitTypes, []);
  assert.deepEqual(normalizeWorldState({}).unitTypes, []);
  for (const nothing of [undefined, null, {}, "dragons", [null, 7, "x", {}]]) assert.deepEqual(normalizeUnitTypes(nothing), [], JSON.stringify(nothing));
});

test("a unit type is kept within its bounds: a base of the kinds, figures held to their range, a short icon and note", () => {
  const [kept] = normalizeUnitTypes([{ name: "  Red   Dragon ", base: "AIR", attack: 50, toughness: "0.01", speed: 9, icon: "🐉🔥🐲⚡✨", note: "x".repeat(500), owners: ["Wessex", "wessex", " Mercia "] }]);
  assert.deepEqual(kept, {
    id: "red-dragon",
    name: "Red Dragon",
    base: "air",
    attack: FIGURE_MOST,
    toughness: 0.1,
    speed: SPEED_MOST,
    icon: "🐉🔥🐲⚡",
    note: "x".repeat(240),
    owners: ["Wessex", "Mercia"],
  });
  // What it says nothing of is an ordinary unit's: infantry, and 1 for each figure.
  const [plain] = normalizeUnitTypes([{ name: "Levy", attack: "", toughness: "nonsense", base: "cavalry" }]);
  assert.deepEqual([plain.base, plain.attack, plain.toughness, plain.speed, plain.icon, plain.owners], ["infantry", 1, 1, 1, "", []]);
  // Ids are unique; a name typed with a comma for a point is read as a figure.
  const twins = normalizeUnitTypes([{ name: "Dragon" }, { name: "dragon" }, { id: "dragon", name: "Wyrm", attack: "2,5" }]);
  assert.deepEqual(twins.map((type) => type.id), ["dragon", "dragon-2", "dragon-3"]);
  assert.equal(twins[2].attack, 2.5);
  // At most UNIT_TYPES_MOST.
  assert.equal(normalizeUnitTypes(Array.from({ length: 40 }, (_, index) => ({ name: `Type ${index}` }))).length, UNIT_TYPES_MOST);
  // Normalizing again changes nothing.
  assert.deepEqual(normalizeUnitTypes(twins), twins);
});

test("a unit keeps the unit type it names when the scenario has it, and is of that type's base kind; one it lacks is dropped", () => {
  assert.equal(normalizeUnitEntry(unit({ unitType: " dragon " })).unitType, "dragon", "a unit keeps the name of its type");
  assert.equal("unitType" in normalizeUnitEntry(unit()), false, "an ordinary unit has none");

  const world = normalizeWorldState({
    unitTypes: [DRAGON],
    units: [
      unit({ unitType: "dragon", type: "infantry" }),
      unit({ id: "u2", name: "Lost Wyrm", unitType: "wyvern", type: "naval" }),
      unit({ id: "u3", name: "Second Wing", unitType: "Dragon" }),
      unit({ id: "u4", name: "Spearmen", type: "infantry" }),
    ],
  });
  const byId = Object.fromEntries(world.units.map((entry) => [entry.id, entry]));
  assert.equal(byId.u1.unitType, "dragon");
  assert.equal(byId.u1.type, "air", "a dragon is an air unit, whatever kind it was written with");
  assert.equal("unitType" in byId.u2, false, "a type the scenario does not have is no type");
  assert.equal(byId.u2.type, "naval", "and the unit keeps its own kind");
  assert.equal(byId.u3.unitType, "dragon", "a type named by its name is kept by its id");
  assert.equal("unitType" in byId.u4, false);
  // Without unit types every unit's type is dropped, and normalizing again changes nothing.
  assert.equal(normalizeWorldState({ units: [unit({ unitType: "dragon" })] }).units[0].unitType, undefined);
  assert.deepEqual(normalizeWorldState(world).units, world.units);
  assert.deepEqual(normalizeWorldState(world).unitTypes, world.unitTypes);
});

test("a unit's figures are its type's, and exactly an ordinary unit's without one", () => {
  const types = normalizeUnitTypes([DRAGON]);
  assert.deepEqual(unitFigures(types, { unitType: "dragon" }), { attack: 5, toughness: 4, speed: 2 });
  assert.equal(unitFigures(types, { type: "air" }), ORDINARY);
  assert.equal(unitFigures(types, { unitType: "wyvern" }), ORDINARY);
  assert.equal(unitFigures([], { unitType: "dragon" }), ORDINARY);
  assert.equal(unitFigures(undefined, { unitType: "dragon" }), ORDINARY);
  assert.equal(findUnitType(types, "DRAGON")?.id, "dragon", "found by its name as anyone writes it");
  assert.equal(mayFieldUnitType(types[0], "wessex"), true);
  assert.equal(mayFieldUnitType(types[0], "Mercia"), false);
  assert.equal(mayFieldUnitType(normalizeUnitTypes([ELEPHANTS])[0], "Anyone at all"), true, "a type that names nobody is anyone's");
});

test("a spawn naming a type its owner may not field is refused; one it may is raised of the type's base kind", () => {
  const context = { unitTypes: [DRAGON, ELEPHANTS], gameDate: "0870-05-01" };
  const spawn = (extra) => ({ op: "spawn", unit: { name: "Black Wing", type: "infantry", ownerCode: "Wessex", strength: 100, lng: -1.3, lat: 51.1, ...extra } });
  const refused = applyUnitOpBatch([], [], [spawn({ ownerCode: "Mercia", unitType: "Dragon" })], context);
  assert.deepEqual(refused.units, [], "Mercia may not field dragons");
  const raised = applyUnitOpBatch([], [], [spawn({ unitType: "Dragon" })], context).units;
  assert.equal(raised.length, 1);
  assert.equal(raised[0].unitType, "dragon");
  assert.equal(raised[0].type, "air");
  const anyone = applyUnitOpBatch([], [], [spawn({ ownerCode: "Mercia", name: "Tuskers", unitType: "war elephants" })], context).units;
  assert.deepEqual([anyone[0].unitType, anyone[0].type], ["war-elephants", "armor"]);
  const unknown = applyUnitOpBatch([], [], [spawn({ unitType: "Wyvern" })], context).units;
  assert.equal(unknown.length, 1, "a type the scenario lacks raises an ordinary unit");
  assert.deepEqual([unknown[0].unitType, unknown[0].type], [undefined, "infantry"]);
  // Without the scenario's types nothing is a type.
  assert.equal(applyUnitOpBatch([], [], [spawn({ unitType: "Dragon" })], { gameDate: "0870-05-01" }).units[0].unitType, undefined);
});

test("a unit of a type moves its type's speed times as far on the map", () => {
  const world = {
    unitTypes: [DRAGON],
    units: [unit({ id: "fast", unitType: "dragon", lng: 0, lat: 10 }), unit({ id: "slow", lng: 0, lat: 10 })],
    pendingUnitOrders: [
      { id: "o1", unitId: "fast", kind: "move", toLng: 60, toLat: 10 },
      { id: "o2", unitId: "slow", kind: "move", toLng: 60, toLat: 10 },
    ],
  };
  const moved = advanceStandingOrders(world, { fromDate: "1940-01-01", toDate: "1940-01-02" });
  const fast = moved.units.find((entry) => entry.id === "fast");
  const slow = moved.units.find((entry) => entry.id === "slow");
  assert.ok(Math.abs(fast.lng / slow.lng - 2) < 0.02, `twice as far: ${fast.lng} against ${slow.lng}`);
  // And by an event's move, within the time it had.
  const op = { op: "move", unitId: "fast", toLng: 60, toLat: 10 };
  const ordinary = applyUnitOpBatch([unit({ id: "fast", lng: 0, lat: 10 })], [], [op], { gameDate: "1940-01-02", elapsedDays: 1 }).units[0];
  const typed = applyUnitOpBatch([unit({ id: "fast", unitType: "dragon", lng: 0, lat: 10 })], [], [op], { gameDate: "1940-01-02", elapsedDays: 1, unitTypes: [DRAGON] }).units[0];
  assert.ok(Math.abs(typed.lng / ordinary.lng - 2) < 0.02, `${typed.lng} against ${ordinary.lng}`);
});

test("the AI is told each type: its name, its base, its figures in words, who may field it and its note", () => {
  const text = describeUnitTypesForPrompt(normalizeUnitTypes([DRAGON, ELEPHANTS]));
  assert.match(text, /^Unit types of this scenario/);
  assert.match(text, /- Dragon: air; attacks 5 times as hard, is 4 times as tough and moves twice as fast as an ordinary air unit; fielded only by Wessex\. Breathes fire\./);
  assert.match(text, /- War Elephants: armor; attacks 3 times as hard, is twice as tough and moves half as fast as an ordinary armor unit; any country may field it/);
  assert.equal(describeUnitTypesForPrompt([]), "");
});

test("the countries that may field a type follow a rename, and the player is told of a type refused in their words", () => {
  const renamed = renamePolityInWorld({ polityOverrides: { Wessex: { name: "Wessex" } }, unitTypes: [DRAGON] }, "Wessex", "England").world;
  assert.deepEqual(renamed.unitTypes[0].owners, ["England"]);
  assert.ok(RECEIPT_PLAYER_TEXTS.unitTypeNotFielded);
  assert.deepEqual(receiptPlayerNote("unitTypeNotFielded", { name: "Black Wing", owner: "Mercia", type: "Dragon" }, "Raid"), {
    text: "Black Wing was not raised: Mercia cannot field the unit type Dragon.",
    event: "Raid",
  });
});

test("a scenario's unit types reach a new game made from it, on the web and on the desktop", () => {
  assert.ok(TEMPLATE_WORLD_OVERRIDE_KEYS.includes("unitTypes"));
  const web = buildFreshWorldSeedFromScenario({ baseWorld: { units: [] }, scenarioWorld: { unitTypes: [DRAGON], somethingElse: 1 } });
  assert.deepEqual(web.unitTypes, [DRAGON]);
  assert.equal(web.somethingElse, undefined);

  const root = mkdtempSync(path.join(os.tmpdir(), "oh-unit-types-"));
  try {
    const store = url.pathToFileURL(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..", "server", "libraryStore.js")).href;
    const script = `
      const store = await import(${JSON.stringify(store)});
      const fs = await import("node:fs");
      const path = await import("node:path");
      store.createScenario({ id: "wyrms", name: "Wyrms", setActive: true });
      store.updateScenario("wyrms", { worldPatch: { unitTypes: ${JSON.stringify([DRAGON])} } });
      store.createGame({ id: "played", name: "Played", scenarioId: "wyrms" });
      const world = JSON.parse(fs.readFileSync(path.join(process.env.OH_DATA_DIR, "games", "played", "world.json"), "utf8"));
      process.stdout.write("\\n@@" + JSON.stringify(world.unitTypes ?? null));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, OH_DATA_DIR: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.deepEqual(JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3)), [DRAGON]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
