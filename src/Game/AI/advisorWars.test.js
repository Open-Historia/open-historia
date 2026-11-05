// Run: node --test src/Game/AI/advisorWars.test.js
//
// "Advisors do not comperehend or acknowledge war fronts, the advisor should
// know everything thats going on with conflicts and wars" (the owner,
// 2026-11-03).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { runFronts } from "../../runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../runtime/fronts/testKit.js";
import { ADVISOR_WARS_HEADING, describeWarsForAdvisor } from "./advisorWars.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.5, lat: 50.6 },
  { name: "Brod", lng: 22.1, lat: 50 },
  { name: "Northgate", lng: 21.2, lat: 50.9 },
  { name: "Southwick", lng: 21.2, lat: 49.1 },
  { name: "Midford", lng: 21.3, lat: 50.05 },
];
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The front", side, order: word, sector: "all", ...extra });

// A period of Aland's war with Borduria, fought by the front engine itself.
const foughtFront = () => {
  const sheet = syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, cities });
  const record = battlefieldOn(sheet, { troops: [row(20.9, 49, 51, 12), row(21.1, 49, 51, 5, { strength: 45 })], pool: [400, 20] });
  const moments = [
    order(0, "Aland", "spearhead", { sector: "centre", objective: "city: Brod", effort: "total" }),
    order(0, "Borduria", "dig in"),
  ];
  return runFronts(frontInput(sheet, { battlefields: [record], days: 6, moments, steering: { even: true, wander: 0 } })).battlefields[0];
};

const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-01-01" };

test("the advisor of a country at war knows its war, its fronts and its enemy, and not the enemy's orders", () => {
  const front = foughtFront();
  // Someone else's war, elsewhere.
  const elsewhere = { ...front, name: "The Far Front", warId: "war-2", sides: [["Cisland"], ["Dorland"]] };
  const world = {
    wars: [WAR, { id: "war-2", title: "The Far War", status: "active", sideA: ["Cisland"], sideB: ["Dorland"] }],
    battlefields: [front, elsewhere],
    warWeariness: [{ country: "Aland", value: 22 }, { country: "Borduria", value: 61 }],
  };
  const text = describeWarsForAdvisor({ world, player: "Aland", date: "2024-03-07" });
  assert.ok(text.startsWith(`${ADVISOR_WARS_HEADING} (as of 2024-03-07)`));
  assert.match(text, /Never say you do not know how a war or a front is going/);
  // Its war, from its government's side.
  assert.match(text, /Our wars:\n- The Border War: against Borduria, alone; .*weariness 22.*Borduria's 61/);
  // Its front, as the engine tells it: the line, each side's strength, what moved, its own standing orders.
  const ours = text.slice(text.indexOf("Our fronts and our forces:"), text.indexOf("Our enemies"));
  assert.match(ours, /- The front: Aland against Borduria, open since 2024-01-01, line \d+ km/);
  assert.match(ours, /Strength: Aland 12 formations/);
  assert.match(ours, /Line: north: /);
  assert.match(ours, /Since 2024-03-01: Aland advanced \d+ km/);
  assert.match(ours, /Standing orders: Aland: centre spearhead toward city: Brod \(total\)/);
  assert.doesNotMatch(ours, /Borduria: all dig in/, "the enemy's orders are its own");
  assert.doesNotMatch(text, /Sectors:/, "the sector words are for whoever writes orders");
  // Its enemy's figures, and the fronts of other wars, a line each.
  assert.match(text, /Our enemies, as far as is known:\nBorduria:\n- The Border War: against Aland/);
  assert.match(text, /Fronts elsewhere in the world \(not ours\):\n- The Far Front: Cisland against Dorland, open since 2024-01-01, line \d+ km$/);
  assert.equal(text.split("The Far Front").length, 2, "another country's front is told once, in one line");
});

test("an advisor at peace hears of the fronts elsewhere; in a world with no war it hears nothing", () => {
  const front = foughtFront();
  const world = { wars: [WAR], battlefields: [front] };
  const peaceful = describeWarsForAdvisor({ world, player: "Cisland", date: "2024-03-07" });
  assert.match(peaceful, /The country is at war with nobody\./);
  assert.match(peaceful, /Fronts elsewhere in the world \(not ours\):\n- The front: Aland against Borduria/);
  assert.equal(describeWarsForAdvisor({ world: {}, player: "Cisland" }), "");
  assert.equal(describeWarsForAdvisor({ world, player: "" }), "");
});

test("the advisor's prompt carries the country's wars and fronts", () => {
  const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("async function buildAdvisorSystemPrompt("), main.indexOf("export async function buildDiplomaticSystemPrompt("));
  assert.match(body, /describeWarsForAdvisor\(\{ world: worldData, player: gameData\?\.country \|\| "", date: gameData\?\.gameDate \|\| "" \}\)/);
});
