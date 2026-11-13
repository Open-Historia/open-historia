/*! Open Historia — a scenario's own unit types, as the AI is told them and may raise them: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/unitTypesAi.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// The time skip is told the scenario's unit types where it reads the units, may name one on a unit it raises, and has
// one its owner may not field refused with a note, never a second request. A scenario without unit types sends the
// model exactly what it always did.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GAMEPLAY_SCHEMAS, GAMEPLAY_TOOLS, getGameplayTool, validateGameplayPayload, withUnitTypeNames } from "./gameplaySchemas.js";
import { buildUnitsSummaryText } from "./promptContext.js";

const DRAGON = { id: "dragon", name: "Dragon", base: "air", attack: 5, toughness: 4, speed: 2, icon: "🐉", note: "Breathes fire.", owners: ["Wessex"] };
const spawnUnitOf = (tool) => tool.schema.properties.events.items.properties.impacts.properties.unitOps.items.anyOf
  .find((branch) => branch.properties?.op?.enum?.[0] === "spawn").properties.unit;

test("a spawned unit's unitType is offered as the scenario's unit types by name, and not at all where it has none", () => {
  const jump = getGameplayTool("jumpForward");
  assert.equal(jump, GAMEPLAY_TOOLS.jumpForward);
  // The contract a skip is sent is the one it always was; the answer is read with the field.
  assert.equal("unitType" in spawnUnitOf(jump).properties, false, "a time skip is sent no unitType of itself");
  assert.ok(spawnUnitOf({ schema: GAMEPLAY_SCHEMAS.jumpForward }).properties.unitType, "the answer is read with one");
  const none = withUnitTypeNames(jump, []);
  assert.deepEqual(none.schema, jump.schema, "a scenario without unit types is sent exactly what it always was");
  const named = withUnitTypeNames(jump, ["Dragon", " Dragon ", "War Elephants", ""]);
  assert.deepEqual(spawnUnitOf(named).properties.unitType.enum, ["Dragon", "War Elephants"]);
  assert.deepEqual(Object.keys(spawnUnitOf(named).properties), [...Object.keys(spawnUnitOf(jump).properties), "unitType"]);
  assert.equal(spawnUnitOf(named).properties.type.enum.length, 6, "the kinds are left as they are");
  // The tools that carry the field of themselves (the unit director's, idle diplomacy's) are sent none without names.
  for (const key of ["unitDirector", "idleDiplomacy"]) {
    assert.ok(JSON.stringify(GAMEPLAY_TOOLS[key].schema).includes("\"unitType\""), key);
    assert.equal(JSON.stringify(withUnitTypeNames(GAMEPLAY_TOOLS[key], []).schema).includes("\"unitType\""), false, key);
  }
  // The answer is read against the full contract: a spawn naming a type is a valid answer.
  const verdict = validateGameplayPayload("jumpForward", {
    events: [{
      date: "0870-05-01",
      title: "The dragon rises",
      description: "Wessex looses its dragon over the Thames.",
      impacts: { unitOps: [{ op: "spawn", unit: { name: "Black Wing", type: "air", unitType: "Dragon", ownerCode: "Wessex", strength: 100, composition: "one dragon" } }] },
    }],
    stopDate: "0870-05-30",
    summary: "A dragon over Wessex.",
    politicalClaims: "",
  });
  assert.equal(verdict.valid, true, verdict.error);
});

test("the units are told with their type's name, and the scenario's unit types follow them; none where it has none", () => {
  const units = [
    { id: "u1", name: "Black Wing", type: "air", unitType: "dragon", ownerCode: "Wessex", strength: 80, lat: 51.1, lng: -1.3 },
    { id: "u2", name: "Fyrd", type: "infantry", ownerCode: "Wessex", strength: 100, lat: 51.2, lng: -1.2 },
  ];
  const text = buildUnitsSummaryText({ units, unitTypes: [DRAGON] }, { player: "Wessex" });
  assert.match(text, /^- Black Wing \(Dragon \(air\), owner Wessex/m);
  assert.match(text, /^- Fyrd \(infantry, owner Wessex/m);
  assert.match(text, /\n\nUnit types of this scenario[^\n]*\n- Dragon: air; attacks 5 times as hard, is 4 times as tough and moves twice as fast as an ordinary air unit; fielded only by Wessex\. Breathes fire\.$/);
  // A time skip's table of the powers in view says the same.
  const table = buildUnitsSummaryText({ units, unitTypes: [DRAGON] }, { player: "Wessex", inView: new Set(["wessex"]) });
  assert.match(table, /^- Black Wing: Dragon \(air\), 80%; /m);
  // With no unit types the list is what it always was, to the character.
  const plain = buildUnitsSummaryText({ units: units.map(({ unitType: _type, ...rest }) => rest) }, { player: "Wessex" });
  assert.equal(buildUnitsSummaryText({ units: units.map(({ unitType: _type, ...rest }) => rest), unitTypes: [] }, { player: "Wessex" }), plain);
  assert.doesNotMatch(plain, /Unit types of this scenario/);
  assert.equal(buildUnitsSummaryText({ units: [], unitTypes: [DRAGON] }), "No military units are currently deployed on the map.\n\nUnit types of this scenario (a unit of one is listed with its type's name; to raise one, give its name as unitType):\n- Dragon: air; attacks 5 times as hard, is 4 times as tough and moves twice as fast as an ordinary air unit; fielded only by Wessex. Breathes fire.");
});

// gameplay.js does not load under bare node: its wiring is pinned in its source.
test("the time skip offers the scenario's unit types, and refuses one its owner may not field with a note, never a retry", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /variables\.unitTypeNames = unitTypeNamesOf\(bundle\.world\);/, "the names ride with the task's variables");
  assert.match(source, /const featureTool = withUnitTypeNames\(forActiveFeatures\(/, "and shape every task's output function");
  assert.match(source, /const batchTool = withUnitTypeNames\(forActiveFeatures\(/, "a batched task's too");
  assert.match(source, /tool: withUnitTypeNames\(forActiveFeatures\(getGameplayTool\("jumpForward"\)\), unitTypeNamesOf\(bundle\?\.world\)\)/, "and the breadth repair's");
  assert.match(source, /schema: withUnitTypeNames\(withoutFeaturesOff\(getGameplayTool\(job\.taskKey\)\), unitTypeNamesOf\(bundle\.world\)\)\?\.schema/, "and the review's");
  // The check in validateGeneratedWorldChanges: by name, against the world's types, the owner folded like any owner.
  const at = source.indexOf("const typeRef = normalizeString(operation.unit?.unitType);");
  assert.ok(at > source.indexOf("export const validateGeneratedWorldChanges"), "the spawn check is in the world-change validation");
  const check = source.slice(at, source.indexOf("const spawnedId = normalizeString(operation.unit?.id);", at));
  assert.match(check, /findUnitType\(scenarioUnitTypes, typeRef\)/);
  assert.match(check, /mayFieldUnitType\(unitType, fielder\)/);
  assert.match(check, /drop\(path, [^\n]*"unitTypeNotFielded", \{ name: raised, owner: fielder, type: unitType\.name \}\);\n\s*continue;/, "refused with the player's note");
  assert.doesNotMatch(check, /return\s/, "never an error that asks the model again: the skip stays one request");
  assert.match(check, /operation\.unit\.type = unitType\.base;/, "a unit of a type is of its base kind");
  assert.match(source, /const scenarioUnitTypes = normalizeUnitTypes\(world\?\.unitTypes\);/);
  // And it is placed as that kind: a dragon on land or in the air, never put to sea for the kind the model wrote.
  const placing = source.slice(source.indexOf("const resolvePlacements = async"), source.indexOf("for (const op of normalizeArray(impacts.markerOps))", source.indexOf("const resolvePlacements = async")));
  assert.match(placing, /findUnitType\(scenarioUnitTypes, unit\?\.unitType\)\?\.base \|\| unit\?\.type/);
  assert.match(placing, /raisedOnLand: LAND_UNIT_TYPES\.has\(kindOf\(unit\)\), atSea: kindOf\(unit\) === "naval"/);
});
