/*! Open Historia — playing as a group: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/playAsGroup.test.js
//
// The player can lead a group instead of a country (the picker's "Play as a
// group"). The game's polity is then a landless polity and the group of the same
// name. These pin what keeps the two one actor: the rename that moves both, the
// model that may not dissolve it, and what every task about the player is told.

import test from "node:test";
import assert from "node:assert/strict";

import { PLAYER_GROUP_JUMP_RULE, describePlayerGroupForPrompt, playerGroupKey } from "./groups.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "./gameState.js";
import { renamePolityInWorld } from "../../server/polityRename.js";
import { buildPlayerPolityRegionsText } from "../Game/AI/promptContext.js";

const PLAYER = "Cartel del Norte";
const world = () => normalizeWorldState({
  polityOverrides: {
    [PLAYER]: { name: PLAYER, aliases: [], color: "#e11d48", note: "A drug cartel that runs the border towns." },
    Mexico: { name: "Mexico", aliases: [], color: "#15803d", note: "" },
  },
  regionOwnershipOverrides: { r1: "Mexico", r2: "Mexico", r3: "Mexico" },
  groups: { [PLAYER]: { name: PLAYER, description: "A drug cartel that runs the border towns.", color: "#e11d48" }, Horde: { description: "The walking dead." } },
  groupAreas: { r1: PLAYER, r2: PLAYER, r3: "Horde" },
});
const event = (groupOps) => ({ id: "e1", date: "2025-01-01", title: "News", description: "Things happen.", impacts: { groupOps } });

test("the player leads a group when their polity's name is a group's", () => {
  assert.equal(playerGroupKey(world(), "cartel del norte"), PLAYER);
  assert.equal(playerGroupKey(world(), "Mexico"), "", "a country is not a group");
  assert.equal(playerGroupKey({ groups: { New: { formerNames: [PLAYER] } } }, PLAYER), "", "a former name is not the player");
});

test("every task about the player is told it is a group, what it is and where it holds", () => {
  const text = describePlayerGroupForPrompt(world(), PLAYER, { regionName: (id) => ({ r1: "Sonora", r2: "Chihuahua" })[id] || id });
  assert.match(text, /^\[Cartel del Norte Is a Group, Not a Country\]/);
  assert.match(text, /is a group, not a state: A drug cartel that runs the border towns\./);
  assert.match(text, /It owns no land/);
  assert.match(text, /It controls 2 regions: Sonora \(r1\), Chihuahua \(r2\)\./);
  assert.equal(describePlayerGroupForPrompt(world(), "Mexico"), "", "nothing for a country");
  assert.match(PLAYER_GROUP_JUMP_RULE, /groupOps take/);
});

test("renaming the player's polity renames its group and the area follows", () => {
  const { world: renamed } = renamePolityInWorld(world(), PLAYER, "Cartel del Pacífico");
  assert.ok(renamed.polityOverrides["Cartel del Pacífico"]);
  assert.equal(renamed.groups[PLAYER], undefined);
  assert.equal(renamed.groups["Cartel del Pacífico"].description, "A drug cartel that runs the border towns.");
  assert.deepEqual(renamed.groups["Cartel del Pacífico"].formerNames, [PLAYER]);
  assert.deepEqual(renamed.groupAreas, { r1: "Cartel del Pacífico", r2: "Cartel del Pacífico", r3: "Horde" });
  const { world: plain } = renamePolityInWorld(world(), "Mexico", "United Mexican States");
  assert.deepEqual(plain.groups, world().groups, "a country that is no group leaves the groups alone");
});

test("the model may not dissolve the player's group; it can take its area away", () => {
  const { world: next } = applyEventImpactsToWorld({
    world: world(),
    round: 2,
    events: [event([
      { op: "dissolve", name: PLAYER },
      { op: "release", name: PLAYER, regionIds: ["r1"] },
      { op: "dissolve", name: "Horde" },
    ])],
  });
  assert.ok(next.groups[PLAYER], "the player's group stays");
  assert.deepEqual(next.groupAreas, { r2: PLAYER }, "it lost r1; the Horde, no polity, was dissolved");
  assert.equal(next.groups.Horde, undefined);
});

test("a rename of the player's group renames the polity with it, so the game's polity follows", () => {
  const result = applyEventImpactsToWorld({
    world: world(),
    round: 2,
    events: [event([{ op: "update", name: PLAYER, newName: "Los Norteños", regionIds: [] }, { op: "take", name: "Los Norteños", regionIds: ["r3"] }])],
  });
  assert.ok(result.world.polityOverrides["Los Norteños"], "the polity was re-keyed");
  assert.equal(result.world.polityOverrides[PLAYER], undefined);
  assert.ok(result.world.groups["Los Norteños"]);
  assert.deepEqual(result.world.groupAreas, { r1: "Los Norteños", r2: "Los Norteños", r3: "Los Norteños" });
  assert.deepEqual(result.renamedPolities.map(({ from, to }) => [from, to]), [[PLAYER, "Los Norteños"]]);
});

test("the player's group can be renamed back to its former name", () => {
  const renamed = applyEventImpactsToWorld({
    world: world(),
    events: [event([{ op: "update", name: PLAYER, newName: "Los Norteños" }])],
  }).world;
  const reverted = applyEventImpactsToWorld({
    world: renamed,
    events: [event([{ op: "update", name: "Los Norteños", newName: PLAYER }])],
  });
  assert.ok(reverted.world.polityOverrides[PLAYER], "the polity took its old name back");
  assert.equal(reverted.world.polityOverrides["Los Norteños"], undefined);
  assert.deepEqual(Object.keys(reverted.world.groups).sort(), [PLAYER, "Horde"]);
  assert.deepEqual(reverted.world.groups[PLAYER].formerNames, ["Los Norteños"]);
  assert.deepEqual(reverted.renamedPolities.map(({ from, to }) => [from, to]), [["Los Norteños", PLAYER]]);
});

test("the advisor reads that the player owns nothing and leads a group", async () => {
  const text = await buildPlayerPolityRegionsText({ game: { country: PLAYER }, world: world() }, [{ id: "r1", name: "Sonora" }]);
  assert.match(text, /^None — Cartel del Norte is a group, not a country\./);
  assert.match(text, /Sonora \(r1\)/);
});
