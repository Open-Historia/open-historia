// Run: node --test src/runtime/fronts/groupWars.test.js
// "it looks like there are alot of issues involving wars with groups including issues with the dynamic borders and
// duel occupied territory" (the owner, 2026-11-05). A group holds an area drawn over countries' regions; in a war
// it is in, that area is its side's ground, and in a war it is not in, the area is its country's.
import test from "node:test";
import assert from "node:assert/strict";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [{ name: "Alba", lng: 21.5, lat: 50.5, capital: true }, { name: "Brod", lng: 24.5, lat: 50.5, capital: true }];
const sheet = () => syntheticMap({ layout: ["AAABBB", "AAABBB", "NNNNNN"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities });
// The Free Hills hold Borduria's side of its border with Aland, and are in nobody's war.
const hills = (world) => Object.fromEntries(world.regions.filter((region) => region.id.startsWith("r3-")).map((region) => [region.id, "Free Hills"]));
const order = (battlefield, extra = {}) => ({ day: 1, type: "order", battlefield, side: "Aland", order: "advance", sector: "all", effort: "major", ...extra });
const peace = (world, moments) => frontInput(world, { wars: [], groupAreas: hills(world), isGroup: (name) => name === "Free Hills", moments, days: 3 });

test("a country may attack another across a border a group outside the war holds", () => {
  const world = sheet();
  // Across the border, and at a place beyond it.
  for (const moment of [order("border: Aland / Borduria"), order("The march on Brod", { objective: "city: Brod" })]) {
    const result = runFronts(peace(world, [moment]));
    assert.deepEqual(result.notes, [], moment.battlefield);
    assert.deepEqual(result.starts.map((start) => [start.attacker, start.defender]), [["Aland", "Borduria"]], "the war begins");
    assert.equal(result.battlefields.filter((record) => record.status === "active").length, 1, "and is fought across that border");
  }
});

test("a battlefield is named for the side's member holding most of it, whatever group's area lies over its land", () => {
  // Borduria holds most of the eastern side; the Free Hills hold much of it and are in no war.
  const world = syntheticMap({ layout: ["AABBBB", "AABBBB", "AANNNN"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities });
  const groupAreas = Object.fromEntries(world.regions.filter((region) => world.controllerOf(region.id) === "Borduria" && !region.id.startsWith("r5-")).map((region) => [region.id, "Free Hills"]));
  const wars = [{ id: "war-1", title: "w", status: "active", sideA: ["Aland"], sideB: ["Neutralia", "Borduria"] }];
  const [record] = runFronts(frontInput(world, { wars, groupAreas, isGroup: (name) => name === "Free Hills", days: 0 })).battlefields;
  assert.equal(record.name, "Aland - Borduria front");
});

// The Free East rise against Borduria in its east; Aland is at peace.
const rising = () => syntheticMap({ layout: ["AAABBBBBB", "AAABBBBBB", "AAABBBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities });
const eastOf = (world, col) => world.regions.filter((region) => Number(region.id.slice(1).split("-")[0]) >= col).map((region) => region.id);
const freeEast = { id: "war-2", title: "The Rising", status: "active", sideA: ["Free East"], sideB: ["Borduria"] };
const groupInput = (world, extra) => frontInput(world, { wars: [freeEast], isGroup: (name) => name === "Free East", days: 0, arenas: new Map(), ...extra });

test("a region the story gives a group on a battlefield is the group's on the battlefield that day, its troops walking in", () => {
  const world = rising();
  const groupAreas = Object.fromEntries(eastOf(world, 7).map((id) => [id, "Free East"]));
  const [record] = runFronts(groupInput(world, { groupAreas })).battlefields;
  assert.equal(record.name, "Free East - Borduria front");
  // The story: the Free East take the next column of regions, behind Borduria's line.
  const taken = eastOf(world, 6).filter((id) => !groupAreas[id]);
  const moments = taken.map((regionId) => ({ day: 0, type: "group", regionId, group: "Free East", ref: "e1" }));
  const after = runFronts(groupInput(world, { groupAreas, battlefields: [record], moments, fromDate: "2024-03-02" }));
  const seen = readBattlefield(after.battlefields[0], world);
  for (const id of taken) {
    const region = world.regions.find((entry) => entry.id === id);
    const [west, south, east, north] = region.bbox;
    assert.equal(seen.holderAt((west + east) / 2, (south + north) / 2), 0, `${id} is the Free East's on the field`);
  }
  // Their troops stand in it: a region taken with nobody there would be won back the first night.
  assert.ok(seen.troops[0].some((troop) => troop.lng >= 26 && troop.lng < 27), "the Free East stand in what they took");
  // And a release gives it back to Borduria on the field.
  const released = runFronts(groupInput(world, { groupAreas: { ...groupAreas, ...Object.fromEntries(taken.map((id) => [id, "Free East"])) }, battlefields: after.battlefields, fromDate: "2024-03-03",
    moments: taken.map((regionId) => ({ day: 0, type: "group", regionId, group: "", from: "Free East", ref: "e2" })) }));
  const back = readBattlefield(released.battlefields[0], world);
  for (const id of taken) {
    const [west, south, east, north] = world.regions.find((entry) => entry.id === id).bbox;
    assert.equal(back.holderAt((west + east) / 2, (south + north) / 2), 1, `${id} is Borduria's again`);
  }
});

test("a group whose first ground the story gives it during the run has its battlefield that run", () => {
  const world = rising();
  // The war begins with the group holding nothing; the story founds it in the east on the first day.
  const moments = eastOf(world, 7).map((regionId) => ({ day: 0, type: "group", regionId, group: "Free East", ref: "e1" }));
  const result = runFronts(groupInput(world, { groupAreas: {}, moments, days: 0 }));
  assert.deepEqual(result.battlefields.map((record) => [record.name, record.status]), [["Free East - Borduria front", "active"]]);
});
