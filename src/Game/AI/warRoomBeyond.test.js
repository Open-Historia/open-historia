/*! Open Historia — a place beyond a battlefield's edge can be named, ordered at and reached: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warRoomBeyond.test.js
//
// A player, fighting Mexico along the border, told his generals to send the
// eastern armies down to encircle Mexico City, and was answered: "Mexico City
// isn't on our operational maps, Commander." "We cannot encircle a city that
// does not exist on our maps." And asked: "why do they not see Mexico City".
//
// A battlefield's places were the cities inside its frame, which is the box
// round its line; the generals were told that a place not in that list is not
// on the battlefield; and an order aimed at one found nothing.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orderTroops } from "../../runtime/fronts/command.js";
import { OBJECTIVE_BEYOND_KM } from "../../runtime/fronts/constants.js";
import { runFronts } from "../../runtime/fronts/engine.js";
import { pointInFrame } from "../../runtime/fronts/frame.js";
import { frontInput, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../runtime/fronts/testKit.js";
import { describePlaces, placesBeyond, readWarRoomAnswer, warRoomVariables } from "./warRoomContext.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const legend = { A: "Aland", B: "Borduria", "~": null };
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));

// ---- what the generals are told ---------------------------------------------------------

// A battlefield on a sheet of six degrees; the map goes on past it on every side.
const cities = [
  { name: "Alba", lng: 20.4, lat: 50, population: 300000, capital: true },
  { name: "Brod", lng: 22.6, lat: 50, population: 900000 },
  // Past the eastern edge, behind Borduria's ground: its capital, and a town.
  { name: "Bordograd", lng: 29, lat: 50, population: 4e6, capital: true },
  { name: "Ostrov", lng: 27.2, lat: 49.6, population: 80000 },
  // Past the western edge, behind Aland's own.
  { name: "Homeburg", lng: 17.5, lat: 50, population: 2e6 },
  // And the other end of the world.
  { name: "Faraway", lng: 80, lat: 10, population: 9e6 },
];
const opened = () => {
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities });
  return runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 30)] })], days: 0, steering: { even: true, wander: 0 } })).battlefields[0];
};

test("the generals are told the places past the battlefield's edge too: the other side's first, each with how far and which way", () => {
  const record = opened();
  for (const name of ["Bordograd", "Ostrov", "Homeburg", "Faraway"]) assert.equal(pointInFrame(record.frame, cities.find((city) => city.name === name).lng, 50), false, name);
  const beyond = placesBeyond(record, cities, { side: 0 });
  // Borduria's capital, then its town, then Aland's own rear; the far side of the world is no objective.
  assert.deepEqual(beyond.map((city) => [city.name, city.capital, city.way, city.holder]), [["Bordograd", true, "east", 1], ["Ostrov", false, "east", 1], ["Homeburg", false, "west", 0]]);
  assert.ok(beyond[0].km > beyond[1].km && beyond[0].km > 100 && beyond[0].km <= OBJECTIVE_BEYOND_KM, `${beyond[0].km} km`);
  // From Borduria's war room it is Aland's rear that an advance would be aimed at.
  assert.deepEqual(placesBeyond(record, cities, { side: 1 }).map((city) => city.name), ["Homeburg", "Bordograd", "Ostrov"]);

  const told = describePlaces(record, cities, { side: 0 }).split("\n");
  assert.equal(told[0], "city: Alba (held by Aland); city: Brod (held by Borduria)");
  assert.match(told[1], /^Beyond its present edge, where the battlefield grows to when troops are sent there: city: Bordograd \(a capital, about \d+ km east of the battlefield's edge, beyond the ground Borduria holds\); city: Ostrov \(about \d+ km east of the battlefield's edge, beyond the ground Borduria holds\); city: Homeburg \(about \d+ km west of the battlefield's edge, beyond the ground Aland holds\)$/);
  assert.equal(warRoomVariables({ record, side: 0, player: "Aland", cities }).warRoomPlaces, told.join("\n"));
  // With nothing past the edge it is what it was.
  assert.equal(describePlaces(record, cities.slice(0, 2), { side: 0 }), told[0]);
  assert.doesNotMatch(told.join(" "), /\d\.\d|lng|lat/, "no coordinate");
});

test("an order a general takes for such a place is kept, and a place nobody knows is still left out", () => {
  const record = opened();
  const answer = (objective) => readWarRoomAnswer({
    lines: [{ speaker: "1st Army", text: "We go.", stance: "accepts" }],
    orders: [{ command: "1st Army", order: "encircle", objective }],
  }, { record, side: 0, cities }).orders;
  assert.deepEqual(answer("city: Bordograd"), [{ command: 0, order: "encircle", objective: "city: Bordograd" }]);
  assert.deepEqual(answer("bordograd"), [{ command: 0, order: "encircle", objective: "city: Bordograd" }]);
  // (An order aimed at nothing the map has is a plain advance, as it always was.)
  assert.deepEqual(answer("city: Atlantis"), [{ command: 0, order: "advance", objective: "" }]);
  assert.deepEqual(answer("city: Faraway"), [{ command: 0, order: "advance", objective: "" }]);
});

test("the generals' prompt no longer says that a place past the edge does not exist", () => {
  const prompt = JSON.parse(fs.readFileSync(path.join(here, "defaultPrompts.json"), "utf8")).tasks.warRoom;
  assert.equal(prompt.includes("A place the commander names that is not in the list below is not on this battlefield"), false);
  assert.match(prompt, /An objective is a place from the list below: one on the battlefield, or one beyond its present edge, which the battlefield grows to hold when troops are sent at it\./);
  assert.match(prompt, /Only a place that is in neither part of the list is unknown to him: he says so, and no order is written for it\. Never put another place in its stead\./);
});

// ---- what the engine does with it ---------------------------------------------------------

// Aland in the west of a long country; Borduria's capital far to the east of the border.
const far = [
  { name: "Alba", lng: 20.5, lat: 50.5, capital: true },
  { name: "Brod", lng: 23.5, lat: 50.5 },
  { name: "Bordograd", lng: 34.5, lat: 50.5, capital: true },
];
const long = () => syntheticMap({ layout: ["AAABBBBBBBBBBBBBBBBB", "AAABBBBBBBBBBBBBBBBB", "AAABBBBBBBBBBBBBBBBB"], legend, west: 20, north: 52, step: 1, stepLat: 1, cities: far, key: "long" });
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The front", side, order: word, sector: "all", ...extra });

test("an order aimed at a city past the frame's edge grows the battlefield to hold it, and the order stands with its objective", () => {
  const world = long();
  const [before] = runFronts(frontInput(world, { days: 0 })).battlefields;
  assert.equal(pointInFrame(before.frame, 34.5, 50.5), false, "the capital is past the edge of the battlefield as it opens");
  assert.equal(pointInFrame(before.frame, 23.5, 50.5), true);

  const run = runFronts(frontInput(world, { battlefields: [before], days: 3, moments: [order(1, "Aland", "spearhead", { battlefield: before.name, objective: "city: Bordograd", ref: 7 })] }));
  const [after] = run.battlefields;
  assert.deepEqual(run.notes, [], "no objective that could not be found");
  assert.equal(pointInFrame(after.frame, 34.5, 50.5), true, "the battlefield has grown to hold it");
  assert.ok(after.frame.cols * after.frame.cell > before.frame.cols * before.frame.cell, "eastwards");
  assert.deepEqual(after.orders.filter((entry) => entry.s === 0).map((entry) => [entry.order, entry.objective]), [["spearhead", "city: Bordograd"]]);
  // Nobody was lost or moved by the growing: the line is where it was.
  assert.equal(after.troops.length, 2);
  assert.equal(after.status, "active");
});

test("an order a general wrote onto the record for such a city is read the same when the next run begins", () => {
  const world = long();
  const [before] = runFronts(frontInput(world, { days: 0 })).battlefields;
  const told = orderTroops(before, { side: 0, troops: [0, 1, 2, 3, 4, 5], order: "encircle", objective: "city: Bordograd", by: "Aland" });
  const [after] = runFronts(frontInput(world, { battlefields: [told], days: 2 })).battlefields;
  assert.equal(pointInFrame(after.frame, 34.5, 50.5), true);
  assert.ok(after.orders.some((entry) => entry.chosen && entry.objective === "city: Bordograd"));
});

test("a city too far past the edge, or one the map does not have, is not an objective: the frame stays, and the run says so", () => {
  const world = syntheticMap({ layout: ["AAABBBBB", "AAABBBBB", "AAABBBBB"], legend, west: 20, north: 52, step: 1, stepLat: 1, cities: [...far.slice(0, 2), { name: "Antipodes", lng: 70, lat: 50.5 }], key: "short" });
  const [before] = runFronts(frontInput(world, { days: 0 })).battlefields;
  for (const objective of ["city: Antipodes", "city: Atlantis"]) {
    const run = runFronts(frontInput(world, { battlefields: [before], days: 2, moments: [order(1, "Aland", "spearhead", { battlefield: before.name, objective, ref: 3 })] }));
    assert.deepEqual([run.battlefields[0].frame.cols, run.battlefields[0].frame.rows], [before.frame.cols, before.frame.rows], objective);
    assert.deepEqual(run.notes.map((note) => [note.kind, note.detail]), [["objective-not-found", objective]]);
  }
});
