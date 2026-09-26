/*! Open Historia — groups and the areas they control: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/groups.test.js
//
// A group is an actor that is not a country — a cartel, a militia, a zombie
// outbreak — controlling an area of regions that stay their countries'. The AI
// creates, changes, moves and erases them through impacts.groupOps; the player
// makes them in the Workshop and the GM tools.

import test from "node:test";
import assert from "node:assert/strict";

import {
  GROUP_PALETTE,
  MAX_GROUPS,
  applyGroupOps,
  defaultGroupColor,
  describeGroupsForPrompt,
  findGroupKey,
  normalizeGroupAreas,
  normalizeGroupColor,
  normalizeGroupOp,
  normalizeGroups,
} from "./groups.js";
import { applyEventImpactsToWorld, normalizeEventEntry, normalizeWorldState } from "./gameState.js";
import { GAME_MASTER_SCHEMA, GAMEPLAY_TOOLS, validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";

test("a group is its exact name, what it is, and a colour", () => {
  const groups = normalizeGroups({
    "Cartel del Norte": { description: "  Runs the border towns.\r\n\r\n\r\nTaxes the routes. ", color: "#E11" },
    "cartel del norte": { description: "a duplicate in another case" },
    Horde: { note: "The dead walk.", color: "not a colour" },
    "": { description: "nameless" },
  });
  assert.deepEqual(Object.keys(groups), ["Cartel del Norte", "Horde"]);
  assert.equal(groups["Cartel del Norte"].description, "Runs the border towns.\n\nTaxes the routes.");
  assert.equal(groups["Cartel del Norte"].color, "#ee1111");
  assert.equal(groups.Horde.description, "The dead walk.", "an older `note` reads as the description");
  assert.equal(groups.Horde.color, defaultGroupColor("Horde"), "no colour: the palette colour its name hashes to");
  assert.ok(GROUP_PALETTE.includes(defaultGroupColor("anything")));
  assert.equal(normalizeGroupColor("#ABCDEF"), "#abcdef");
  assert.equal(normalizeGroupColor("red"), "");
});

test("a name resolves exactly, then in any case, then by a former name", () => {
  const groups = normalizeGroups({ "Free Army": { formerNames: ["Liberation Front"] } });
  assert.equal(findGroupKey(groups, "Free Army"), "Free Army");
  assert.equal(findGroupKey(groups, "free army"), "Free Army");
  assert.equal(findGroupKey(groups, "Liberation Front"), "Free Army");
  assert.equal(findGroupKey(groups, "Nobody"), "");
});

test("an area row naming no group is dropped, and one region has one group", () => {
  const groups = normalizeGroups({ Cartel: {} });
  assert.deepEqual(normalizeGroupAreas({ r1: "cartel", r2: "Ghosts", r3: "Cartel" }, groups), { r1: "Cartel", r3: "Cartel" });
});

test("the model's verbs read as the five operations", () => {
  assert.equal(normalizeGroupOp({ op: "erase", name: "X" }).op, "dissolve");
  assert.equal(normalizeGroupOp({ op: "spread", name: "X", regions: ["a", "a", "b"] }).op, "take");
  assert.deepEqual(normalizeGroupOp({ op: "spread", name: "X", regions: ["a", "a", "b"] }).regionIds, ["a", "b"]);
  assert.equal(normalizeGroupOp({ op: "withdraw", group: "X", regionId: "a" }).op, "release");
  assert.equal(normalizeGroupOp({ op: "found", name: "X" }).op, "create");
  assert.equal(normalizeGroupOp({ op: "recolor", name: "X", color: "#123456" }).op, "update");
  assert.equal(normalizeGroupOp({ op: "teleport", name: "X" }), null);
  assert.equal(normalizeGroupOp({ op: "create", name: "  " }), null);
});

test("create, take, update, rename, release and dissolve do what they say", () => {
  let state = applyGroupOps({}, [
    { op: "create", name: "Horde", description: "The dead walk.", color: "#10b981", regionIds: ["r1", "r2"] },
  ]);
  assert.deepEqual(Object.keys(state.groups), ["Horde"]);
  assert.deepEqual(state.groupAreas, { r1: "Horde", r2: "Horde" });

  state = applyGroupOps(state, [{ op: "take", name: "horde", regionIds: ["r3"] }]);
  assert.deepEqual(Object.keys(state.groupAreas).sort(), ["r1", "r2", "r3"], "a name in another case is the same group");

  state = applyGroupOps(state, [{ op: "update", name: "Horde", newName: "The Grey Tide", description: "It has crossed the river." }]);
  assert.deepEqual(Object.keys(state.groups), ["The Grey Tide"]);
  assert.equal(state.groups["The Grey Tide"].description, "It has crossed the river.");
  assert.equal(state.groups["The Grey Tide"].color, "#10b981", "a change that says nothing of colour keeps it");
  assert.deepEqual(state.groups["The Grey Tide"].formerNames, ["Horde"]);
  assert.ok(Object.values(state.groupAreas).every((name) => name === "The Grey Tide"), "the area follows the rename");

  state = applyGroupOps(state, [{ op: "release", name: "Horde", regionIds: ["r1"] }]);
  assert.deepEqual(Object.keys(state.groupAreas).sort(), ["r2", "r3"], "a former name still reaches the group");

  state = applyGroupOps(state, [{ op: "create", name: "Cartel", regionIds: ["r3"] }]);
  assert.equal(state.groupAreas.r3, "Cartel", "a region taken by another group changes hands");

  state = applyGroupOps(state, [{ op: "release", name: "The Grey Tide", regionIds: [] }]);
  assert.deepEqual(state.groupAreas, { r3: "Cartel" }, "an empty release gives back the whole area");

  state = applyGroupOps(state, [{ op: "dissolve", name: "Cartel" }]);
  assert.deepEqual(state.groupAreas, {});
  assert.deepEqual(Object.keys(state.groups), ["The Grey Tide"], "erased, and only that group");
});

test("the model is taken at its word where the intent is plain, and nowhere else", () => {
  const state = applyGroupOps({}, [
    { op: "take", name: "Militia", regionIds: ["r1"] },
    { op: "release", name: "Ghosts", regionIds: ["r1"] },
    { op: "dissolve", name: "Ghosts" },
  ]);
  assert.deepEqual(Object.keys(state.groups), ["Militia"], "a take naming a new group founds it; a release or erase of nobody does nothing");
  assert.equal(state.groupAreas.r1, "Militia");

  const many = applyGroupOps({}, Array.from({ length: MAX_GROUPS + 5 }, (_, index) => ({ op: "create", name: `Group ${index}` })));
  assert.equal(Object.keys(many.groups).length, MAX_GROUPS);
});

test("the prompt names each group exactly, says what it is, and where it controls", () => {
  const world = {
    groups: { Cartel: { description: "Runs the\nborder towns.", color: "#e11d48" }, Exiles: { description: "" } },
    groupAreas: { r1: "Cartel", r2: "Cartel", r3: "Cartel" },
  };
  const text = describeGroupsForPrompt(world, { regionName: (id) => id.toUpperCase(), maxRegions: 2 });
  assert.equal(text, [
    "- Cartel — Runs the border towns. [controls 3 regions: R1 (r1), R2 (r2), +1 more]",
    "- Exiles [controls no area on the map]",
  ].join("\n"));
  assert.equal(describeGroupsForPrompt({}), "");
});

test("the world keeps its groups through every read, and an event's groupOps land on the map", () => {
  const read = normalizeWorldState({ groups: { Cartel: { description: "Smugglers." } }, groupAreas: { r1: "Cartel", r2: "Nobody" } });
  assert.deepEqual(Object.keys(read.groups), ["Cartel"]);
  assert.deepEqual(read.groupAreas, { r1: "Cartel" });
  assert.deepEqual(normalizeWorldState({}).groups, {});

  const event = normalizeEventEntry({ title: "Spread", description: "It spreads.", date: "2025-01-01", impacts: { groupOps: [{ op: "spread", name: "Horde", regions: ["r5"], note: "The outbreak crossed the border." }, { op: "??", name: "x" }] } });
  assert.equal(event.impacts.groupOps.length, 1, "a saved event keeps its groupOps, and drops what no operation reads as");

  const { world } = applyEventImpactsToWorld({
    world: read,
    round: 3,
    events: [{
      id: "e1",
      date: "2025-01-01",
      title: "Outbreak",
      description: "The dead rise in the south.",
      impacts: { groupOps: [
        { op: "create", name: "Horde", description: "The walking dead.", color: "#65a30d", regionIds: ["r5", "r6"] },
        { op: "take", name: "Cartel", regionIds: ["r6"] },
      ] },
    }],
  });
  assert.equal(world.groups.Horde.description, "The walking dead.");
  assert.deepEqual(world.groupAreas, { r1: "Cartel", r5: "Horde", r6: "Cartel" });
  assert.equal(world.regionOwnershipOverrides?.r5, undefined, "a group's area moves no border");
});

test("the jump and the Game Master can write groupOps, and the jump schema stays in budget", () => {
  const jump = {
    clearActions: true,
    events: [{
      date: "2025-02-01",
      title: "The cartel takes the highway towns",
      description: "Gunmen drove the police out of three towns.",
      impacts: { groupOps: [{ op: "take", name: "Cartel del Norte", regionIds: ["Nuevo León"], note: "The police fled." }] },
    }],
    stopDate: "2025-02-28",
    summary: "The north slips further.",
  };
  const result = validateGameplayPayload("jumpForward", jump);
  assert.equal(result.valid, true, result.error);
  const bad = validateGameplayPayload("jumpForward", { ...jump, events: [{ ...jump.events[0], impacts: { groupOps: [{ op: "annex", name: "X" }] } }] });
  assert.equal(bad.valid, false, "the op is an enum");

  const jumpSchema = GAMEPLAY_TOOLS.jumpForward?.parameters ?? GAMEPLAY_TOOLS.jumpForward;
  assert.ok(JSON.stringify(jumpSchema).includes("groupOps"));
  assert.ok(JSON.stringify(GAME_MASTER_SCHEMA).includes("groupOps") || JSON.stringify(GAME_MASTER_SCHEMA).includes("eventsJson"),
    "the GM carries events (and so their impacts) in its transaction");
});
