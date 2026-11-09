// Run: node --test src/runtime/fronts/groupWars.test.js
// "it looks like there are alot of issues involving wars with groups including issues with the dynamic borders and
// duel occupied territory" (the owner, 2026-11-05). A group holds an area drawn over countries' regions; in a war
// it is in, that area is its side's ground, and in a war it is not in, the area is its country's.
import test from "node:test";
import assert from "node:assert/strict";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

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
