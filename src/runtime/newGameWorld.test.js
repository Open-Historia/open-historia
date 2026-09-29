/*! Open Historia — the world a new game starts from tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/newGameWorld.test.js
//
// A faction or group game starts by merging the player's polity into the
// world its scenario seeded and writing that world back whole. A merge that
// dropped anything would wipe every other country from the campaign's first
// save, so what has to hold:
//   - every other polity, owner, group and area is kept;
//   - a landless faction or group is still playable (ownerCodes);
//   - a scenario's own group is found without case and keeps its area;
//   - the country list offers what the scenario holds, and nothing technical.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScenarioCountryOptions, worldWithFaction, worldWithPlayerGroup } from "./newGameWorld.js";

const seeded = () => ({
  ownerCodes: ["Japan", "Korea"],
  polityOverrides: {
    Japan: { name: "Japan", aliases: ["Nippon"], color: "#ff0000", note: "" },
    Korea: { name: "Korea", aliases: [], color: "#0000ff", note: "" },
  },
  regionOwnershipOverrides: { r1: "Japan", r2: "Japan", r3: "Korea" },
  groups: { "Red Army": { name: "Red Army", description: "Insurgents", color: "#aa0000" } },
  groupAreas: { r3: "Red Army" },
  customRegions: false,
  background: { kind: "image" },
});

test("a faction joins the world and takes the regions it claimed, and nothing else moves", () => {
  const world = seeded();
  const { world: next, name, color } = worldWithFaction(world, {
    name: "Ezo Republic",
    color: "#22c55e",
    lore: "Rebels of the north",
    regionIds: ["r2"],
  });
  assert.equal(name, "Ezo Republic");
  assert.equal(color, "#22c55e");
  assert.deepEqual(next.polityOverrides["Ezo Republic"], { name: "Ezo Republic", aliases: [], color: "#22c55e", note: "Rebels of the north" });
  assert.deepEqual(next.polityOverrides.Japan, world.polityOverrides.Japan, "every other polity is kept");
  assert.deepEqual(next.polityOverrides.Korea, world.polityOverrides.Korea);
  assert.deepEqual(next.regionOwnershipOverrides, { r1: "Japan", r2: "Ezo Republic", r3: "Korea" });
  assert.deepEqual(next.ownerCodes, ["Ezo Republic", "Japan", "Korea"]);
  assert.equal(next.customRegions, true, "claimed regions paint through the custom renderer");
  assert.deepEqual(next.groups, world.groups, "groups and their areas are kept");
  assert.deepEqual(next.groupAreas, world.groupAreas);
  assert.deepEqual(next.background, world.background);
  assert.deepEqual(world, seeded(), "the world handed in is not changed");
});

test("a landless faction is still playable, and a bad colour falls back", () => {
  const { world: next, color } = worldWithFaction(seeded(), { name: "Government in Exile", color: "red", regionIds: [] });
  assert.equal(color, "#a1a1aa");
  assert.ok(next.ownerCodes.includes("Government in Exile"));
  assert.equal(next.customRegions, false, "no regions: the renderer flag is left as it was");
  assert.deepEqual(next.regionOwnershipOverrides, seeded().regionOwnershipOverrides);
});

test("a faction named like a polity already there takes over that polity's record", () => {
  const { world: next } = worldWithFaction(seeded(), { name: "Korea", color: "#123456", regionIds: ["r1"] });
  assert.deepEqual(next.polityOverrides.Korea, { name: "Korea", aliases: [], color: "#123456", note: "" });
  assert.deepEqual(next.ownerCodes, ["Japan", "Korea"], "listed once");
  assert.equal(next.regionOwnershipOverrides.r1, "Korea");
  assert.equal(next.regionOwnershipOverrides.r3, "Korea", "and keeps what it held");
});

test("leading one of the scenario's groups finds it without case and keeps its area and colour", () => {
  const { world: next, key, color } = worldWithPlayerGroup(seeded(), { name: "red army", existing: true, regionIds: ["r1"] });
  assert.equal(key, "Red Army", "the registry's own spelling, not the one typed");
  assert.equal(color, "#aa0000");
  assert.deepEqual(next.groupAreas, { r3: "Red Army" }, "an existing group's area is not redrawn");
  assert.deepEqual(next.groups["Red Army"], { name: "Red Army", description: "Insurgents", color: "#aa0000" });
  assert.deepEqual(next.polityOverrides["Red Army"], { name: "Red Army", aliases: [], color: "#aa0000", note: "Insurgents" });
  assert.deepEqual(next.ownerCodes, ["Japan", "Korea", "Red Army"], "a group owns nothing, so it is named playable here");
  assert.deepEqual(next.regionOwnershipOverrides, seeded().regionOwnershipOverrides, "the regions stay their countries'");
  assert.deepEqual(next.polityOverrides.Japan, seeded().polityOverrides.Japan);
});

test("a new group is added with the area it was given; an empty area adds none", () => {
  const { world: next, key } = worldWithPlayerGroup(seeded(), { name: "Cartel", color: "#00ff00", lore: "Smugglers", existing: false, regionIds: ["r1", "r2"] });
  assert.equal(key, "Cartel");
  assert.deepEqual(next.groupAreas, { r3: "Red Army", r1: "Cartel", r2: "Cartel" });
  assert.equal(next.groups.Cartel.description, "Smugglers");
  assert.ok(next.groups["Red Army"], "the scenario's groups are kept");

  const landless = worldWithPlayerGroup(seeded(), { name: "Movement", existing: false, regionIds: [] }).world;
  assert.deepEqual(landless.groupAreas, { r3: "Red Army" });
  assert.equal(landless.groups.Movement.color, "#a1a1aa");
});

test("a group's polity record already in the world wins over the defaults", () => {
  const world = { ...seeded(), polityOverrides: { ...seeded().polityOverrides, "Red Army": { name: "Red Army", aliases: ["RA"], color: "#bb0000", note: "Old note" } } };
  const { world: next } = worldWithPlayerGroup(world, { name: "Red Army", existing: true });
  assert.deepEqual(next.polityOverrides["Red Army"], { name: "Red Army", aliases: ["RA"], color: "#bb0000", note: "Old note" });
});

test("the country list offers the scenario's owners and polities, landless ones too, and nothing technical", () => {
  const world = {
    ownerCodes: ["Japan", "Korea", "Z01"],
    polityOverrides: { Japan: { name: "Japan" }, "Government in Exile": { name: "Government in Exile" } },
  };
  const options = buildScenarioCountryOptions(world, [{ code: "Korea", name: "Korea" }, { code: "NA", name: "No data" }], { Korea: "Joseon" });
  assert.deepEqual(options, [
    { code: "Government in Exile", name: "Government in Exile" },
    { code: "Japan", name: "Japan" },
    { code: "Korea", name: "Joseon" },
  ]);
});

test("a scenario with no owner list offers every country it is given", () => {
  const options = buildScenarioCountryOptions({}, [{ code: "FRA", name: "France" }, { code: "DEU", name: "DEU" }, { code: "DEU", name: "Germany" }, { code: "XCA", name: "Caspian" }]);
  assert.deepEqual(options, [{ code: "FRA", name: "France" }, { code: "DEU", name: "Germany" }]);
  assert.deepEqual(buildScenarioCountryOptions(null, null, null), []);
});
