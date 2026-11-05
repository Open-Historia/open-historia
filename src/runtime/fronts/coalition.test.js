/*! Open Historia — battlefields and fronts: a side of several countries: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/coalition.test.js
//
// "Make it so there can be wars where multiple countries are on the same side
// but they each command their own forces." On a side of several countries an
// order is for the troops of the country that gives it. The order of a side's
// first country also moves an ally that nobody plays and that has no order of
// its own; a person's troops are never moved by anybody else's order. No
// general commands two countries' troops, and nobody picks an ally's troops
// in the war room.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeTroops } from "./codec.js";
import { generalsOf, ownTroopsOf } from "./command.js";
import { describeBattlefield } from "./brief.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { applyWarRoomOp } from "./warRoomOps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the north-west and Cisland in the south-west, allies, with Borduria all along their east.
const legend = { A: "Aland", C: "Cisland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "CCCCBBBB", "CCCCBBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "coalition" });
const WARS = [{ id: "war-1", title: "The Coalition War", status: "active", sideA: ["Aland", "Cisland"], sideB: ["Borduria"] }];
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The Front", side, order: word, sector: "all", ...extra });
const run = (world, extra = {}) => runFronts(frontInput(world, { wars: WARS, days: 8, ...extra }));
// The living troops of a side's member, as the record has them: [{ x, y, state, index }].
const troopsOf = (record, side, member) => {
  const owner = record.sides[side].indexOf(member);
  return decodeTroops(record.troops[side]).map((troop, index) => ({ ...troop, index })).filter((troop) => troop.strength > 0 && troop.owner === owner);
};
const meanX = (troops) => troops.reduce((sum, troop) => sum + troop.x, 0) / Math.max(1, troops.length);
const STATE_DUG_IN = 4;

test("each country of a side commands its own: an ally's order moves the ally's troops and nobody else's", () => {
  const world = sheet();
  const quiet = run(world);
  const [still] = quiet.battlefields;
  assert.deepEqual(still.sides, [["Aland", "Cisland"], ["Borduria"]]);
  const aland = troopsOf(still, 0, "Aland");
  const cisland = troopsOf(still, 0, "Cisland");
  assert.ok(aland.length >= 6 && cisland.length >= 6, `${aland.length} of Aland's and ${cisland.length} of Cisland's`);
  // Each stands on its own stretch of the line: Aland's in the north, Cisland's in the south.
  const { toLngLat } = projectorOf(still.frame);
  const latOf = (troop) => toLngLat(troop.x, troop.y)[1];
  const southmost = aland.reduce((least, troop) => Math.min(least, latOf(troop)), Infinity);
  assert.ok(cisland.every((troop) => latOf(troop) < southmost + 0.15), "Cisland's stand south of Aland's");
  assert.ok(aland.every((troop) => latOf(troop) > 50.9) && cisland.every((troop) => latOf(troop) < 51.1));

  // Cisland is told to advance. Its troops go forward; Aland's hold where they stood.
  const [moved] = run(world, { moments: [order(0, "Cisland", "advance")] }).battlefields;
  assert.ok(meanX(troopsOf(moved, 0, "Cisland")) > meanX(cisland) + 1.5, "Cisland's have gone east");
  assert.ok(Math.abs(meanX(troopsOf(moved, 0, "Aland")) - meanX(aland)) < 0.6, "Aland's have not");
  assert.deepEqual(moved.orders.map((entry) => [entry.s, entry.order, entry.by]), [[0, "advance", "Cisland"]]);
  // The story is told whose order it is.
  assert.match(describeBattlefield(moved), /Standing orders: Aland: all advance \(Cisland's troops\) \(major\)\. Borduria: all hold\./);
  assert.match(describeBattlefield(moved), /Strength: Aland \d+ formations \(\d+%\) \(Aland \d+, Cisland \d+\), reserves/);
  assert.deepEqual(moved.brief.strength[0].members.map((entry) => entry.name), ["Aland", "Cisland"]);
  assert.equal(moved.brief.strength[1].members, undefined, "a side of one says nothing of it");
});

test("the first country's order also moves an ally nobody plays that has none of its own, and never a person's troops", () => {
  const world = sheet();
  const before = run(world).battlefields[0];
  const stoodAt = { aland: meanX(troopsOf(before, 0, "Aland")), cisland: meanX(troopsOf(before, 0, "Cisland")) };
  const went = (record, member, from) => meanX(troopsOf(record, 0, member)) > from + 1.5;

  // Aland leads the side: with one line for it, the coalition moves together.
  const [together] = run(world, { moments: [order(0, "Aland", "advance")] }).battlefields;
  assert.deepEqual([went(together, "Aland", stoodAt.aland), went(together, "Cisland", stoodAt.cisland)], [true, true]);
  // Cisland has an order of its own: it keeps to that, and Aland's line moves Aland alone.
  const [apart] = run(world, { moments: [order(0, "Cisland", "dig in"), order(0, "Aland", "advance")] }).battlefields;
  assert.equal(went(apart, "Aland", stoodAt.aland), true);
  assert.equal(went(apart, "Cisland", stoodAt.cisland), false);
  assert.ok(troopsOf(apart, 0, "Cisland").every((troop) => troop.state === STATE_DUG_IN), "Cisland's are dug in");
  assert.deepEqual(apart.orders.map((entry) => [entry.order, entry.by]), [["dig in", "Cisland"], ["advance", "Aland"]], "one country's order does not replace another's");
  // The same country's next order does replace its last.
  const [changed] = run(world, { moments: [order(0, "Cisland", "dig in"), order(2, "Cisland", "hold")] }).battlefields;
  assert.deepEqual(changed.orders.map((entry) => [entry.order, entry.by]), [["hold", "Cisland"]]);
  // Cisland is played by a person: the lead's order is not its order, whatever else is so.
  const [played] = run(world, { players: ["Cisland"], moments: [order(0, "Aland", "advance")] }).battlefields;
  assert.deepEqual([went(played, "Aland", stoodAt.aland), went(played, "Cisland", stoodAt.cisland)], [true, false]);
  // And the other way: Aland is played, and its ally's order moves the ally alone.
  const [led] = run(world, { players: ["Aland"], moments: [order(0, "Cisland", "advance")] }).battlefields;
  assert.deepEqual([went(led, "Aland", stoodAt.aland), went(led, "Cisland", stoodAt.cisland)], [false, true]);
});

test("no general commands two countries' troops, and a country's war room has its own generals", () => {
  const world = sheet();
  const [record] = run(world).battlefields;
  const troops = decodeTroops(record.troops[0]);
  const commands = record.brief.carry.command[0];
  const owners = new Map();
  troops.forEach((troop, index) => {
    if (!(troop.strength > 0)) return;
    assert.ok(commands[index] >= 0, "every living troop is under a general");
    owners.set(commands[index], (owners.get(commands[index]) ?? new Set()).add(troop.owner));
  });
  assert.ok(owners.size >= 2, `${owners.size} generals`);
  assert.ok([...owners.values()].every((set) => set.size === 1), "each general's troops are one country's");
  // The generals a country's war room lists are its own, with its own troops under them.
  const alands = generalsOf(record, 0, { member: "Aland" });
  const cislands = generalsOf(record, 0, { member: "Cisland" });
  const mine = new Set(ownTroopsOf(record, 0, "Aland"));
  assert.ok(alands.length >= 1 && cislands.length >= 1);
  assert.ok(alands.every((general) => general.troops.every((index) => mine.has(index))));
  assert.equal(alands.reduce((sum, general) => sum + general.n, 0), mine.size);
  assert.equal(new Set([...alands, ...cislands].map((general) => general.command)).size, alands.length + cislands.length, "and no general is in both lists");
  // Asked for the whole side, as before, all of them.
  assert.equal(generalsOf(record, 0).length, alands.length + cislands.length);
  // A side of one country is commanded as it always was.
  const theirs = generalsOf(record, 1);
  assert.deepEqual(generalsOf(record, 1, { member: "Borduria" }), theirs);
});

test("in the war room a country picks and orders its own troops, and never an ally's", () => {
  const world = sheet();
  const [record] = run(world).battlefields;
  const mine = ownTroopsOf(record, 0, "Aland");
  const theirs = ownTroopsOf(record, 0, "Cisland");
  assert.ok(mine.length > 0 && theirs.length > 0);
  assert.equal(mine.some((index) => theirs.includes(index)), false);
  // An order for both countries' troops reaches Aland's alone.
  const asked = applyWarRoomOp([record], { op: "order", battlefield: record.name, troops: [...mine, ...theirs], order: "dig in" }, { player: "Aland", date: "2024-03-09" });
  assert.equal(asked.error, undefined);
  const served = asked.record.brief.carry.under[0];
  assert.ok(mine.every((index) => served[index] >= 0));
  assert.ok(theirs.every((index) => served[index] < 0), "Cisland's troops serve no order of Aland's");
  // An order for an ally's troops alone is an order for nobody.
  for (const op of [{ op: "order", order: "advance" }, { op: "route", way: [[23.5, 51.5], [26, 51.5]] }, { op: "order", order: "withdraw" }]) {
    const refused = applyWarRoomOp([record], { ...op, battlefield: record.name, troops: theirs }, { player: "Aland", date: "2024-03-09" });
    assert.equal(refused.error, "None of those troops are yours to order.", op.order ?? op.op);
  }
  // Cisland, played by somebody else in the same game, orders its own the same way.
  const other = applyWarRoomOp([record], { op: "order", battlefield: record.name, troops: [...mine, ...theirs], order: "advance" }, { player: "Cisland", date: "2024-03-09" });
  assert.ok(theirs.every((index) => other.record.brief.carry.under[0][index] >= 0) && mine.every((index) => other.record.brief.carry.under[0][index] < 0));
  // Carried out: Aland's dig in where they stand, picked by hand, and Cisland's are not touched.
  const [after] = run(world, { battlefields: asked.battlefields, fromDate: "2024-03-09", days: 3 }).battlefields;
  assert.ok(troopsOf(after, 0, "Aland").every((troop) => troop.state === STATE_DUG_IN));
  assert.ok(troopsOf(after, 0, "Cisland").every((troop) => troop.state !== STATE_DUG_IN));
});

test("the war room lists the player's allies and leads to their leaders, and the map lets only its own troops be picked", () => {
  const room = read("../../Game/GameUI/warRoom.jsx");
  assert.match(room, /generalsOf\(record, side, \{ member: game\.country \}\)/);
  assert.match(room, /<Heading style=\{\{ marginTop: "0\.8rem" \}\}>Allies<\/Heading>/);
  assert.match(room, /Each ally commands its own troops here\. Agree a plan with its leader, and its troops carry it out when time passes\./);
  assert.match(room, /const talkTo = \(ally\) => \{\s*onClose\?\.\(\);\s*requestDiplomaticChat\(\{ name: ally \}\);\s*\};/);
  assert.match(room, /<button type="button" onClick=\{\(\) => talkTo\(ally\.name\)\} style=\{linkStyle\}>Talk strategy with its leader<\/button>/);
  const tools = read("../../Game/Map/WarRoomTools.jsx");
  assert.match(tools, /const own = useMemo\(\(\) => new Set\(record && \(side === 0 \|\| side === 1\) \? ownTroopsOf\(record, side, country\) : \[\]\), \[record, side, country\]\);/);
  assert.match(tools, /const mine = \(\) => \(standingRef\.current\[side\] \?\? \[\]\)\.map\(\(point, index\) => \(ownRef\.current\.has\(index\) \? point : null\)\);/);
  // While the war room is open the planet does not turn by itself under the player's hand.
  const globe = read("../../Game/Map/GlobeEffects.jsx");
  assert.match(globe, /const warRoomOpen = useWarRoom\(\(state\) => state\.open\);/);
  assert.match(globe, /const autoRotateDisabled = useMotionSetting\(MAP_SETTING_KEYS\.disableIdleRotation\) \|\| warRoomOpen;/);
});
