/*! Open Historia — the war room: what the generals are told and what they answer: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warRoomContext.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nameGenerals, orderTroops, withTalk } from "../../runtime/fronts/command.js";
import { WAR_ROOM_ORDERS } from "../../runtime/fronts/constants.js";
import { runFronts } from "../../runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../runtime/fronts/testKit.js";
import { GAMEPLAY_SCHEMAS, GAMEPLAY_TOOLS } from "./gameplaySchemas.js";
import {
  commandOfSpeaker,
  commandTitle,
  describeGenerals,
  describePlaces,
  describeTalk,
  namingText,
  readWarRoomAnswer,
  warRoomRequest,
  warRoomStanding,
  warRoomVariables,
} from "./warRoomContext.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.4, lat: 50, population: 300000, capital: true },
  { name: "Brod", lng: 22.6, lat: 50, population: 900000 },
  { name: "Cetin", lng: 23.4, lat: 49.4, population: 500000 },
  { name: "Faraway", lng: 80, lat: 10, population: 9e6 },
];
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));
const opened = () => {
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities });
  return runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 45), row(21.1, 49.1, 50.9, 30)] })], days: 0, steering: { even: true, wander: 0 } })).battlefields[0];
};

test("the generals are told of by their armies, with what each has and has been told", () => {
  const record = opened();
  assert.deepEqual([0, 1, 4].map(commandTitle), ["1st Army", "2nd Army", "5th Army"]);
  const plain = describeGenerals(record, 0).split("\n");
  assert.equal(plain.length, 3);
  assert.match(plain[0], /^- 1st Army, \(unnamed\): 15 formations at 100% strength, about city: (Alba|Brod), holding its line\.$/);
  assert.match(namingText(record, 0, "Aland"), /^Some generals below are listed as \(unnamed\)\. In `generals`, give every general of the list a rank and a name, in the order listed, fitting Aland/);

  let told = nameGenerals(record, 0, ["Gen. Orlov", "Gen. Petrov", "Gen. Sidorov"]);
  // (The northernmost body is the 1st Army: the last troops of the row.)
  told = orderTroops(told, { side: 0, troops: [42, 43, 44], order: "spearhead", objective: "city: Brod", by: "Aland" });
  told = orderTroops(told, { side: 0, troops: [0, 1], way: [[21.2, 49.2], [22.4, 49.3]], by: "Aland" });
  const lines = describeGenerals(told, 0).split("\n");
  assert.match(lines[0], /^- 1st Army, Gen\. Orlov: .*ordered and not yet carried out: spearhead toward city: Brod\.$/);
  assert.doesNotMatch(lines[1], /ordered and not yet/);
  assert.match(lines[2], /^- 3rd Army, Gen\. Sidorov: .*ordered and not yet carried out: a route drawn for some of them\.$/);
  assert.equal(namingText(told, 0, "Aland"), "Every general has a name: leave `generals` out of the answer.");
  assert.equal(describeGenerals(record, 2), "(none)");
});

test("the places of the battlefield are its own cities, the largest first, each with its holder; what was said is told in order", () => {
  const record = opened();
  assert.equal(describePlaces(record, cities), "city: Alba (held by Aland); city: Brod (held by Borduria); city: Cetin (held by Borduria)");
  assert.equal(describePlaces(record, cities, { most: 1 }), "city: Alba (held by Aland)");
  assert.equal(describePlaces(record, []), "(no named place on this battlefield)");

  assert.match(describeTalk(record, 0), /^\(nothing yet/);
  const talked = withTalk(nameGenerals(record, 0, ["", "Gen. Petrov"]), 0, [
    { who: "", text: "Take Brod.", at: "2024-03-01" },
    { who: 1, text: "At first light.", at: "2024-03-01" },
    { who: 0, text: "My flank is open.", at: "2024-03-01" },
  ]);
  assert.equal(describeTalk(talked, 0), "The commander: Take Brod.\n2nd Army, Gen. Petrov: At first light.\n1st Army: My flank is open.");
  assert.match(describeTalk(talked, 1), /^\(nothing yet/, "the other side heard none of it");

  const variables = warRoomVariables({ record: talked, side: 0, player: "Aland", cities, intel: "" });
  assert.deepEqual(Object.keys(variables).sort(), ["warRoomBattlefield", "warRoomBattlefieldBrief", "warRoomGenerals", "warRoomIntel", "warRoomNaming", "warRoomPlaces", "warRoomTranscript"]);
  assert.equal(variables.warRoomBattlefield, record.name);
  assert.equal(variables.warRoomIntel, "Nothing beyond what the battlefield shows.");
  assert.equal(warRoomVariables({ record, side: 0, player: "Aland", cities, intel: " Borduria: a spearhead toward city: Alba " }).warRoomIntel, "Borduria: a spearhead toward city: Alba");
  assert.equal(warRoomRequest("  Hold   the line. "), "The commander says: Hold the line.");
});

test("a general is known by his army or his name, however the model writes it", () => {
  const generals = [{ command: 0, name: "Gen. Mykola Orlov" }, { command: 1, name: "Gen. Petrov" }, { command: 2, name: "" }];
  const who = (text) => commandOfSpeaker(text, generals);
  assert.deepEqual(["1st Army", "2ND ARMY", "3rd army", "Second Army", "army 2", "the 3rd", "2nd"].map(who), [0, 1, 2, 1, 1, 2, 1]);
  assert.deepEqual(["Gen. Mykola Orlov", "General Orlov", "Petrov", "Orlov"].map(who), [0, -1, 1, 0]);
  assert.deepEqual(["", "4th Army", "the commander", "Gen. Nobody", "9"].map(who), [-1, -1, -1, -1, -1]);
});

test("the answer is read against the generals there are: who spoke, the orders they took, and their names", () => {
  const record = opened();
  const answer = readWarRoomAnswer({
    lines: [
      { speaker: "2nd Army", text: " We go at first light.  " },
      { speaker: "7th Army", text: "Nobody commands a seventh army." },
      { speaker: "1st Army", text: "" },
      { speaker: "3rd Army", text: "South is quiet." },
      { speaker: "1st Army", text: "North too." },
      { speaker: "2nd Army", text: "Agreed." },
      { speaker: "3rd Army", text: "A fifth line is one too many." },
    ],
    orders: [
      { command: "2nd Army", order: "Spearhead", objective: "Brod" },
      { command: "2nd Army", order: "hold" },
      { command: "1st Army", order: "entrench", objective: "" },
      { command: "3rd Army", order: "retreat", objective: "city: Alba" },
      { command: "1st Army", order: "nuke" },
      { command: "9th Army", order: "hold" },
    ],
    generals: ["  Gen.  Haig ", "Gen. Rawlinson", "x".repeat(200)],
  }, { record, side: 0 });
  assert.deepEqual(answer.lines, [
    { who: 1, text: "We go at first light." },
    { who: 2, text: "South is quiet." },
    { who: 0, text: "North too." },
    { who: 1, text: "Agreed." },
  ], "four lines at most, each from a general there is");
  assert.deepEqual(answer.orders, [
    { command: 1, order: "spearhead", objective: "city: Brod" },
    { command: 0, order: "dig in", objective: "" },
    { command: 2, order: "fall back", objective: "city: Alba" },
  ], "one order a general, in the engine's words, a bare place taken for a city");
  assert.deepEqual(answer.names.map((name) => name.length), [9, 14, 60]);
  assert.equal(answer.names[0], "Gen. Haig");
  for (const order of answer.orders) assert.ok(WAR_ROOM_ORDERS.includes(order.order));
  assert.deepEqual(readWarRoomAnswer({}, { record, side: 0 }), { lines: [], orders: [], names: [] });
  assert.deepEqual(readWarRoomAnswer(null, { record, side: 0 }), { lines: [], orders: [], names: [] });
});

test("a general who objects has taken no order, and an order is aimed only at a place of the battlefield", () => {
  const record = opened();
  const answer = readWarRoomAnswer({
    lines: [
      { speaker: "1st Army", text: "This is madness. If you insist, we will march.", stance: "objects" },
      { speaker: "2nd Army", text: "We go at first light.", stance: "accepts" },
      { speaker: "3rd Army", text: "The south is quiet.", stance: "speaks" },
    ],
    // The model wrote an order for the general who is still arguing: it is not one.
    orders: [
      { command: "1st Army", order: "spearhead", objective: "city: Brod" },
      { command: "2nd Army", order: "encircle", objective: "brod" },
      { command: "3rd Army", order: "spearhead", objective: "city: Faraway" },
    ],
  }, { record, side: 0, cities });
  assert.deepEqual(answer.lines.map((line) => line.who), [0, 1, 2], "what he said is still said");
  assert.deepEqual(answer.orders, [
    { command: 1, order: "encircle", objective: "city: Brod" },
    // A place that is not on this battlefield is left off, nothing is put in
    // its stead, and a thrust at nothing is an advance.
    { command: 2, order: "advance", objective: "" },
  ]);
  // An objection in a fifth line, past the four that are kept, still counts.
  const late = readWarRoomAnswer({
    lines: [
      { speaker: "2nd Army", text: "a", stance: "speaks" }, { speaker: "3rd Army", text: "b", stance: "speaks" },
      { speaker: "2nd Army", text: "c", stance: "speaks" }, { speaker: "3rd Army", text: "d", stance: "speaks" },
      { speaker: "1st Army", text: "No.", stance: "Objects" },
    ],
    orders: [{ command: "1st Army", order: "advance" }],
  }, { record, side: 0, cities });
  assert.deepEqual([late.lines.length, late.orders], [4, []]);
  // A name is the rank and the name: the army a model hangs on it is taken off again.
  const named = readWarRoomAnswer({
    lines: [{ speaker: "1st Army", text: "Present.", stance: "speaks" }],
    generals: ["Colonel-General Andrey Lapin, 1st Army", "2nd Army: Major-General Mikhail Teplinsky", "Lieutenant-General Alexander Chaiko (3rd Army)"],
  }, { record, side: 0, cities });
  assert.deepEqual(named.names, ["Colonel-General Andrey Lapin", "Major-General Mikhail Teplinsky", "Lieutenant-General Alexander Chaiko"]);
  // Orders that stay put need no place, and a place that is there is written as the map writes it.
  assert.deepEqual(readWarRoomAnswer({ lines: [{ speaker: "1st Army", text: "Yes.", stance: "accepts" }], orders: [{ command: "1st Army", order: "fall back", objective: "ALBA" }] }, { record, side: 0, cities }).orders, [{ command: 0, order: "fall back", objective: "city: Alba" }]);
  assert.deepEqual(readWarRoomAnswer({ lines: [{ speaker: "1st Army", text: "Yes." }], orders: [{ command: "1st Army", order: "dig in", objective: "region: Nowhere" }] }, { record, side: 0, cities }).orders, [{ command: 0, order: "dig in", objective: "" }]);
});

test("the war room stands on an open battlefield the player's troops are on", () => {
  const record = opened();
  const world = { battlefields: [record, { ...record, name: "Elsewhere", status: "closed" }] };
  const standing = warRoomStanding({ world, game: { country: "borduria" }, battlefield: record.name.toUpperCase() });
  assert.deepEqual([standing.side, standing.player, standing.record.name], [1, "borduria", record.name]);
  assert.match(warRoomStanding({ world, game: { country: "Syldavia" }, battlefield: record.name }).error, /not on that battlefield/);
  assert.match(warRoomStanding({ world, game: { country: "Aland" }, battlefield: "Elsewhere" }).error, /no longer open/);
  assert.match(warRoomStanding({ world, game: { country: "Aland" }, battlefield: "Nowhere" }).error, /no longer open/);
});

test("the war room is a task of its own: one request, a prompt that says what it must, and a tool Gemini accepts", () => {
  const prompt = JSON.parse(read("defaultPrompts.json")).tasks.warRoom;
  for (const variable of ["PLAYER_POLITY", "ORIGIN_ROUND_DATE", "warRoomBattlefield", "warRoomGenerals", "warRoomNaming", "warRoomBattlefieldBrief", "warRoomPlaces", "warRoomIntel", "warRoomTranscript", "warRoomLanguage"]) {
    assert.ok(prompt.includes(`\${${variable}}`), `the prompt has no \${${variable}}`);
  }
  for (const word of WAR_ROOM_ORDERS) assert.ok(prompt.includes(word), `the prompt does not say what "${word}" is`);
  assert.match(prompt, /orders are carried out when time next passes/);
  assert.match(prompt, /An order a general has argued against, and the commander has not repeated, is NOT written\./);
  assert.doesNotMatch(prompt, /\b(regionId|unitId|id:)\b/, "names, never ids");

  const schema = GAMEPLAY_SCHEMAS.warRoom;
  assert.deepEqual(schema.required, ["lines"]);
  assert.deepEqual(schema.properties.orders.items.properties.order.enum, [...WAR_ROOM_ORDERS]);
  // Gemini refuses a bound on a list of objects.
  for (const key of ["lines", "orders"]) {
    assert.equal(schema.properties[key].minItems, undefined);
    assert.equal(schema.properties[key].maxItems, undefined);
  }
  assert.equal(GAMEPLAY_TOOLS.warRoom.name, "submit_war_room_reply");
  assert.equal(GAMEPLAY_TOOLS.warRoom.schema, schema);

  const gameplay = read("gameplay.js");
  const start = gameplay.indexOf("export const generateWarRoomReply = ");
  assert.notEqual(start, -1);
  const body = gameplay.slice(start, gameplay.indexOf("\n};", start));
  assert.equal(body.split("runJsonTask(").length - 1, 1, "one request a message");
  assert.doesNotMatch(body, /lookups|mutate[A-Z]|write[A-Z]\w*State/, "no lookup functions, and nothing written: the caller writes");
  assert.match(body, /if \(!frontsOn\(\)\) throw new Error/);
  assert.match(read("gameplayLazy.js"), /export const generateWarRoomReply = async \(\.\.\.args\) => \(await gameplay\(\)\)\.generateWarRoomReply\(\.\.\.args\);/);
});
