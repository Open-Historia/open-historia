/*! Open Historia — battlefields and fronts: where a side's new troops come in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/deploy.test.js
//
// "make it so you can draw a line of where reinforcements are to get deployed
// in the war room"; "the deployment tool in the war room doesnt seem to work.
// it does draw the line, but the troops are never actually deployed" (the
// owner, 2026-10-24).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { REINFORCE_MOST, REINFORCE_ORDER } from "./constants.js";
import { DEPLOY_USUAL, deployLinesOf } from "./deploy.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldForViewer } from "./view.js";
import { applyWarRoomOp, cleanWarRoomOp } from "./warRoomOps.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: "deploy" });
const run = (extra = {}) => runFronts(frontInput(sheet(), { days: 0, ...extra }));
const troopsAt = (record, side) => {
  const place = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).map((troop) => ({ ...troop, lng: place.toLngLat(troop.x, troop.y)[0] }));
};
// A line drawn far back in Aland, from north to south.
const BACK = [[20.4, 52.7], [20.4, 50.3]];

test("a country's new troops come in on the line drawn for them, and on the front where none was drawn", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  // (Drawn to call up nobody itself: here it is the order's troops that come in on it.)
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK, count: 0 }, { player: "Aland", date: "2024-03-01" });
  assert.equal(drawn.error, undefined);
  assert.deepEqual(deployLinesOf(drawn.record, side).map((line) => line.country), ["Aland"]);
  const order = [{ day: 1, type: "order", battlefield: record.name, side: "Aland", order: REINFORCE_ORDER, sector: "all", count: 4, given: true, ref: 1 }];
  const before = troopsAt(record, side).length;
  const fresh = (result) => troopsAt(result.battlefields[0], side).slice(before);
  const onLine = fresh(run({ battlefields: [drawn.record], moments: order, days: 2 }));
  const onFront = fresh(run({ battlefields: [record], moments: order, days: 2 }));
  assert.equal(onLine.length, 4);
  assert.equal(onFront.length, 4);
  // (A day and a night have passed: they may have walked a little toward the front.)
  for (const troop of onLine) assert.ok(troop.lng < 21.5, `came in at ${troop.lng.toFixed(2)}, by the line at 20.4`);
  for (const troop of onFront) assert.ok(troop.lng > 22.5, `came in at ${troop.lng.toFixed(2)}, on the front at 24`);
  // The line is kept from run to run.
  const kept = run({ battlefields: [drawn.record], days: 2 }).battlefields[0];
  assert.deepEqual(deployLinesOf(kept, side).map((line) => line.country), ["Aland"]);
});

test("a deployment line is its side's own, and an empty way takes it off", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(battlefieldForViewer(drawn, "Borduria"), side).length, 0, "the other side is not sent it");
  assert.equal(deployLinesOf(battlefieldForViewer(drawn, "Aland"), side).length, 1);
  const off = applyWarRoomOp([drawn], { op: "deploy", battlefield: record.name, way: [] }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(off, side).length, 0);
  assert.equal(off.brief.carry.deploy, undefined);
  // A line nowhere near the battlefield is refused; nobody draws one for a battlefield they are not on.
  assert.ok(applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [[100, 10], [101, 10]] }, { player: "Aland" }).error);
  assert.ok(applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Neutralia" }).error);
  // It crosses to a host as a way and nothing else: how many it calls up is not the asker's to say, only that it calls nobody.
  assert.deepEqual(cleanWarRoomOp({ op: "deploy", battlefield: record.name, way: BACK, extra: 1 }), { op: "deploy", battlefield: record.name, way: BACK });
  assert.equal(cleanWarRoomOp({ op: "deploy", battlefield: record.name, way: BACK, count: 60 }).count, undefined);
  assert.equal(cleanWarRoomOp({ op: "deploy", battlefield: record.name, way: BACK, count: 0 }).count, 0);
});

test("a deployment drawn calls up fresh formations on it when time next passes, as many as its country can, and only once", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const before = troopsAt(record, side).length;
  // Sixty asked for: "being able to just spawn 60 troops every turn is super op" (the owner, 2026-11-02).
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK, count: 60 }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(drawn, side)[0].call, DEPLOY_USUAL);
  // No order, no event of the story's: the deployment alone brings them, on its line.
  const after = run({ battlefields: [drawn], days: 2 }).battlefields[0];
  const fresh = troopsAt(after, side).slice(before);
  assert.ok(fresh.length >= 1 && fresh.length < 60, `${fresh.length} came`);
  for (const troop of fresh) assert.ok(troop.lng < 21.5, `came in at ${troop.lng.toFixed(2)}, by the line at 20.4`);
  assert.ok(after.log.some((entry) => entry.k === "drafted" && entry.at === `${fresh.length} fresh formations on its deployment line`));
  // The call is spent, and the deployment says what came of it.
  const [line] = deployLinesOf(after, side);
  assert.equal(line.call, undefined);
  assert.deepEqual([line.last.n, line.last.why], [fresh.length, ""]);
  assert.match(line.last.d, /^2024-/);
  const again = run({ battlefields: [after], days: 2 }).battlefields[0];
  assert.equal(troopsAt(again, side).length, troopsAt(after, side).length, "no more come of it");
  assert.equal(deployLinesOf(again, side)[0].last.n, fresh.length);
  // Drawn again, it calls up again; none, drawn with a call of 0.
  const usual = applyWarRoomOp([again], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(usual, side)[0].call, DEPLOY_USUAL);
  assert.equal(deployLinesOf(usual, side)[0].last, undefined, "a deployment drawn anew has called nobody up yet");
  const more = run({ battlefields: [usual], days: 2 }).battlefields[0];
  assert.ok(troopsAt(more, side).length > troopsAt(again, side).length);
  const quiet = applyWarRoomOp([again], { op: "deploy", battlefield: record.name, way: BACK, count: 0 }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(quiet, side)[0].call, undefined);
  const none = run({ battlefields: [quiet], days: 2 }).battlefields[0];
  assert.equal(troopsAt(none, side).length, troopsAt(again, side).length);
  assert.equal(deployLinesOf(none, side)[0].last, undefined);
});

test("a deployment calls up past what a draft may bring an army that is large already, up to the line's room", () => {
  const [opened] = run().battlefields;
  const side = opened.sides.findIndex((members) => members.includes("Aland"));
  // Drafts until no more may come: the army three times what its strength usually raises.
  let record = opened;
  for (let round = 0; round < 6; round += 1) record = run({ battlefields: [record], moments: [{ day: 1, type: "order", battlefield: record.name, side: "Aland", order: REINFORCE_ORDER, sector: "all", count: REINFORCE_MOST, given: true, ref: round }], days: 1 }).battlefields[0];
  const full = run({ battlefields: [record], moments: [{ day: 1, type: "order", battlefield: record.name, side: "Aland", order: REINFORCE_ORDER, sector: "all", count: 5, given: true, ref: 9 }], days: 1 });
  assert.deepEqual(full.notes.filter((note) => note.kind === "reinforce-full").map((note) => note.side), ["Aland"], "a draft may bring no more");
  const before = troopsAt(full.battlefields[0], side).length;
  const drawn = applyWarRoomOp([full.battlefields[0]], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Aland" }).record;
  const after = run({ battlefields: [drawn], days: 1 }).battlefields[0];
  const called = deployLinesOf(after, side)[0].last.n;
  assert.ok(called >= 1, "the deployment still brings its call-up");
  assert.equal(troopsAt(after, side).length, before + called);
});

test("a call-up is the country's: more over a longer time, fewer when it is short or weary, and as fast as it musters", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Aland" }).record;
  const calledIn = (extra) => deployLinesOf(run({ battlefields: [drawn], ...extra }).battlefields[0], side)[0].last.n;
  const week = calledIn({ days: 7 });
  const months = calledIn({ days: 60 });
  assert.ok(months > week, `${week} in a week, ${months} in two months`);
  // Short of supplies, weary of its war or blockaded (run.shortageOf: the three together): fewer.
  const short = calledIn({ days: 60, shortageOf: (name) => (name === "Aland" ? 0.6 : 0) });
  assert.ok(short < months, `${short} short, ${months} not`);
  // A country that calls its army up fast brings more in a week than one that takes a year.
  const curve = (days) => ({ table: Array.from({ length: days + 1 }, (_, day) => day / days), head: 0 });
  const fast = calledIn({ days: 7, mechanics: { muster: true }, musterOf: () => curve(10) });
  const slow = calledIn({ days: 7, mechanics: { muster: true }, musterOf: () => curve(365) });
  assert.ok(fast > slow, `${fast} mustering fast, ${slow} slowly`);
});

test("a deployment calls up only the men there are, and says so when there are none", () => {
  const peopleOf = (name) => ({ Aland: 300000, Borduria: 60e6 })[name] ?? 0;
  // Three hundred thousand people: three formations, all under arms from the first day.
  const [record] = run({ peopleOf }).battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK, count: 4 }, { player: "Aland" }).record;
  const result = run({ peopleOf, battlefields: [drawn], days: 2 });
  const after = result.battlefields[0];
  assert.equal(troopsAt(after, side).length, troopsAt(record, side).length);
  assert.deepEqual([deployLinesOf(after, side)[0].last.n, deployLinesOf(after, side)[0].last.why], [0, "men"]);
  assert.deepEqual(result.notes.filter((note) => note.kind === "reinforce-no-men").map((note) => note.side), ["Aland"]);
});
