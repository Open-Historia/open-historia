/*! Open Historia — battlefields and fronts: withdrawing: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/withdraw.test.js
//
// "Troops should be able to withdraw. I should be able to do an action saying
// I withdraw my troops or just use a tool in the war room." And: "withdraw
// should not revert territory." Troops told to withdraw go back from the line
// and leave the battlefield; the ground stays whose it is. A side with nobody
// left there is away until it is told anything else, and then it comes back.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeTroops } from "./codec.js";
import { orderTroops, ownTroopsOf, returnTroops } from "./command.js";
import { FRONT_ORDERS, WAR_ROOM_ORDERS, WITHDRAW_DAYS_MOST, WITHDRAW_KM } from "./constants.js";
import { runFronts } from "./engine.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";
import { applyWarRoomOp } from "./warRoomOps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "withdraw" });
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "The Front", side, order: word, sector: "all", ...extra });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).length;
// A world, and runs on it one after another: each leaves the world as the game would.
const campaign = () => {
  const world = sheet();
  const arenas = new Map();
  return {
    world,
    run: (extra) => {
      const result = runFronts(frontInput(world, { arenas, ...extra }));
      applyFlips(world, result.flips);
      return result;
    },
    held: (record) => readBattlefield(record, world).held,
  };
};
// Ten days of Aland advancing into Borduria: it holds ground that is not its own.
const advanced = () => {
  const game = campaign();
  const [record] = game.run({ days: 10, moments: [order(0, "Aland", "advance")] }).battlefields;
  return { ...game, record };
};

test("withdraw is an order of its own: the troops leave the battlefield, and the ground stays whose it is", () => {
  assert.ok(FRONT_ORDERS.includes("withdraw") && WAR_ROOM_ORDERS.includes("withdraw"));
  const { run, held, record } = advanced();
  const before = held(record);
  assert.ok(before[0] > before[1], `Aland holds more than it began with: ${before}`);
  assert.equal(live(record, 0), 24);

  const out = run({ battlefields: [record], fromDate: "2024-03-11", days: 12, moments: [order(0, "Aland", "withdraw")] });
  const [left] = out.battlefields;
  // Every troop of Aland's is gone from it, in the days it takes to march clear; Borduria's are where they were.
  assert.deepEqual([live(left, 0), live(left, 1)], [0, 24]);
  const told = left.log.find((entry) => entry.k === "withdrew");
  assert.deepEqual([told.s, told.at], [0, ""]);
  assert.ok(told.d >= "2024-03-13" && told.d <= "2024-03-18", `the last of them left on ${told.d}`);
  assert.ok(WITHDRAW_KM >= 40 && WITHDRAW_DAYS_MOST >= 7);
  // The ground is as it was: no region changes hands, and nobody is given back what was taken.
  assert.deepEqual(out.flips, []);
  const after = held(left);
  assert.ok(Math.abs(after[0] - before[0]) <= before[0] * 0.02, `Aland held ${before[0]} cells and holds ${after[0]}`);
  assert.equal(left.status, "active", "the war goes on: only the troops have gone");
  // Its side stands under an order to withdraw, and is away: the record says so for the next run.
  assert.deepEqual(left.orders.map((entry) => [entry.s, entry.order, entry.sector]), [[0, "withdraw", "all"]]);
  assert.deepEqual(left.brief.carry.away, [true, false]);
  // Nobody is cut down on the way out, and the other side does not come after them unless it is told to.
  assert.equal(left.log.some((entry) => entry.k === "overrun"), false);

  // A week later nothing has changed: nobody comes back by themselves, and nobody takes the empty ground.
  const quiet = run({ battlefields: [left], fromDate: "2024-03-23", days: 7 });
  assert.deepEqual([live(quiet.battlefields[0], 0), live(quiet.battlefields[0], 1), quiet.flips.length], [0, 24, 0]);
  assert.deepEqual(held(quiet.battlefields[0]), after);
  assert.deepEqual(quiet.battlefields[0].brief.carry.away, [true, false]);
});

test("the ground a side left unguarded is the other side's to take, if it is ordered forward", () => {
  const { run, record } = advanced();
  const [left] = run({ battlefields: [record], fromDate: "2024-03-11", days: 12, moments: [order(0, "Aland", "withdraw")] }).battlefields;
  const taken = run({ battlefields: [left], fromDate: "2024-03-23", days: 6, moments: [order(0, "Borduria", "advance")] });
  assert.ok(taken.flips.length > 0 && taken.flips.every((flip) => flip.to === "Borduria"), `${taken.flips.length} regions walked into`);
  assert.equal(live(taken.battlefields[0], 0), 0, "and nobody of Aland's is there to stop it");
});

test("a side that withdrew and is given another order comes back onto the ground it holds", () => {
  const { run, held, record } = advanced();
  const [left] = run({ battlefields: [record], fromDate: "2024-03-11", days: 12, moments: [order(0, "Aland", "withdraw")] }).battlefields;
  const ground = held(left);
  // By the story: an order for it, of any kind but to withdraw.
  const back = run({ battlefields: [left], fromDate: "2024-03-23", days: 3, moments: [order(1, "Aland", "hold")] });
  const [again] = back.battlefields;
  assert.ok(live(again, 0) >= 12, `${live(again, 0)} formations stand to again`);
  assert.deepEqual(again.orders.map((entry) => [entry.s, entry.order]), [[0, "hold"]]);
  assert.equal(again.brief.carry.away, undefined);
  assert.deepEqual(again.log.filter((entry) => entry.k === "returned").map((entry) => [entry.s, entry.d]), [[0, "2024-03-24"]]);
  assert.deepEqual(held(again), ground, "on the ground it held, which nobody had taken");
  // By the war room: "send them back" takes the order to withdraw off, and they are there when time next passes.
  const sent = applyWarRoomOp([left], { op: "return", battlefield: "The Front" }, { player: "Aland", date: "2024-03-23" });
  assert.equal(sent.error, undefined);
  assert.deepEqual(sent.record.orders.map((entry) => [entry.s, entry.order, entry.by]), [[0, "hold", "Aland"]]);
  const returned = run({ battlefields: sent.battlefields, fromDate: "2024-03-23", days: 2 });
  assert.ok(live(returned.battlefields[0], 0) >= 12);
  // A side that has not withdrawn has nobody to send back; nor has the other side, for the first one.
  assert.equal(applyWarRoomOp([record], { op: "return", battlefield: "The Front" }, { player: "Aland", date: "2024-03-11" }).error, "Your troops have not withdrawn from that battlefield.");
  assert.equal(applyWarRoomOp([left], { op: "return", battlefield: "The Front" }, { player: "Borduria", date: "2024-03-23" }).error, "Your troops have not withdrawn from that battlefield.");
  assert.equal(returnTroops(record, { side: 0 }), record);
});

test("troops picked out in the war room withdraw by themselves, and a formation of the world goes home as a unit", () => {
  const game = campaign();
  const units = [{ id: "u1", name: "1st Guards", type: "armor", ownerCode: "Aland", lng: 23.6, lat: 51.2, strength: 90 }];
  const [record] = game.run({ days: 3, units }).battlefields;
  assert.equal(live(record, 0), 25, "the formation is on the battlefield with the troops raised for it");
  const named = record.named.find((entry) => entry.unitId === "u1");
  const mine = ownTroopsOf(record, 0, "Aland");
  assert.equal(mine.length, 25);
  assert.deepEqual(ownTroopsOf(record, 0, "Borduria"), mine, "on a side of one member they are all that member's");
  const picked = [...new Set([...mine.filter((index) => index % 2 === 0), named.i])];
  const before = game.held(record);

  // The op the war room sends.
  const asked = applyWarRoomOp([record], { op: "order", battlefield: record.name, troops: picked, order: "withdraw" }, { player: "Aland", date: "2024-03-04" });
  assert.equal(asked.error, undefined);
  assert.deepEqual(asked.record.orders.map((entry) => [entry.order, entry.chosen, entry.by]), [["withdraw", true, "Aland"]]);
  assert.deepEqual(orderTroops(record, { side: 0, troops: picked, order: "withdraw", by: "Aland", since: "2024-03-04" }).orders, asked.record.orders);

  const out = game.run({ battlefields: asked.battlefields, fromDate: "2024-03-04", days: 12, units: units.map((unit) => ({ ...unit, committedTo: record.name })) });
  const [left] = out.battlefields;
  assert.equal(live(left, 0), 25 - picked.length, "the rest hold the line");
  assert.equal(live(left, 1), 24);
  // The formation is a unit of the world again, where it left the battlefield from, on its own side's ground.
  assert.equal(out.unitChanges.length, 1);
  const [home] = out.unitChanges;
  assert.deepEqual([home.unitId, home.committedTo], ["u1", ""]);
  assert.ok(home.lng < 23.6 && home.lng > 21.5 && home.strength >= 85, JSON.stringify(home));
  // The order is done with, the side is not away, and the ground has not moved.
  assert.deepEqual(left.orders, []);
  assert.equal(left.brief.carry.away, undefined);
  assert.deepEqual(out.flips, []);
  assert.ok(Math.abs(game.held(left)[0] - before[0]) <= before[0] * 0.02);
  // It is not taken in again while its side fights on without it.
  const next = game.run({ battlefields: [left], fromDate: "2024-03-16", days: 5, units });
  assert.deepEqual(next.unitChanges, []);
  assert.equal(live(next.battlefields[0], 0), 25 - picked.length);
  // Nobody may withdraw troops that are not there, or with a word the generals do not know.
  assert.equal(applyWarRoomOp([record], { op: "order", battlefield: record.name, troops: [], order: "withdraw" }, { player: "Aland", date: "2024-03-04" }).error, "None of those troops are yours to order.");
});

test("on a border fortified in peace, to withdraw is to stand down", () => {
  const world = sheet();
  const peace = (overrides) => frontInput(world, { wars: [], days: 5, ...overrides });
  const border = (day, side, word) => ({ day, type: "order", battlefield: "border: Aland / Borduria", side, order: word, sector: "all" });
  const opened = runFronts(peace({ moments: [border(0, "Aland", "dig in")] }));
  assert.equal(opened.battlefields[0].status, "standing");
  const stood = runFronts(peace({ battlefields: opened.battlefields, fromDate: "2024-03-06", moments: [border(1, "Aland", "withdraw")] }));
  assert.equal(stood.battlefields[0].status, "closed");
  assert.deepEqual(stood.starts, [], "and it is no attack on anybody");
});

test("the war room has the key, and the story and the generals the word", () => {
  const rail = read("../../Game/GameUI/warRoomRail.jsx");
  assert.match(rail, /<RailKey label="Withdraw" title="Withdraw: these troops leave the battlefield and go home\. With none picked out, all of yours do" disabled=\{locked \|\| \(none && own === 0\)\} onClick=\{onWithdraw\}>/);
  assert.match(rail, /<RailKey label="Send back" title="Send your troops back onto this battlefield" disabled=\{locked\} onClick=\{onReturn\}>/);
  const room = read("../../Game/GameUI/warRoom.jsx");
  assert.match(room, /const troops = selected\.length > 0 \? selected : ownTroops;/);
  assert.match(room, /act\(\{ op: "order", battlefield: name, troops, order: "withdraw" \}\)/);
  assert.match(room, /const sendBack = \(\) => act\(\{ op: "return", battlefield: name \}\);/);
  assert.match(room, /own=\{ownTroops\.length\}\s+away=\{away\}\s+onWithdraw=\{withdrawPicked\}\s+onReturn=\{sendBack\}/);
  assert.match(room, /if \(order === "withdraw"\) return <>Withdraw<\/>;/);
  // The enemy does not come after troops that are leaving: only after troops that fall back.
  assert.match(read("./move.js"), /const falling = battle\.views\[other\]\.filter\(\(view\) => view\.word === "fall back"\);/);
});
