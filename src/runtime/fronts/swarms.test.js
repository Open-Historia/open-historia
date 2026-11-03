/*! Open Historia — battlefields and fronts: swarms: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/swarms.test.js
//
// "make it so you can also deploy "armies" which are just groups of troops not
// arranged in a front", "a group should also be run by a single general. using
// the deploy tool should give the option to do a front or swarm", "troops
// should move independantly like they do in fronts" (the owner, 2026-10-16).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { generalsOf } from "./command.js";
import { FRONT_COMMANDS_MOST, MAX_COMMANDS, REINFORCE_ORDER, SWARM_TROOPS_EACH } from "./constants.js";
import { DEPLOY_USUAL, deployLinesOf } from "./deploy.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { authoredForms, normalizeScenarioFronts } from "./scenarioFronts.js";
import { blockSteps, readSwarms, swarmsOfRecord } from "./swarms.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { applyWarRoomOp, cleanWarRoomOp } from "./warRoomOps.js";
import { normalizeWarSettings, warfareOf } from "../warSettings.js";
import { planFeatures } from "../../Game/Map/warRoomGeometry.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: "swarms" });
const run = (extra = {}) => runFronts(frontInput(sheet(), { days: 0, ...extra }));
// A place far back in Aland, some 200 km from the border at 24 E.
const PLACE = [21, 51.5];
const kmApart = (a, b) => {
  const across = (a.lng - b.lng) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const down = (a.lat - b.lat) * 111.32;
  return Math.sqrt(across * across + down * down);
};
// A side's troops as they stand, with where on the map and under which general.
const troopsOf = (record, side) => {
  const place = projectorOf(record.frame);
  const commands = record.brief?.carry?.command?.[side] ?? [];
  return decodeTroops(record.troops[side]).map((troop, index) => {
    const [lng, lat] = place.toLngLat(troop.x, troop.y);
    return { ...troop, index, lng, lat, command: commands[index] ?? -1 };
  });
};
const reinforce = (record, count, day = 1) => [{ day, type: "order", battlefield: record.name, side: "Aland", order: REINFORCE_ORDER, sector: "all", count, given: true, ref: day }];
// A country that calls its whole army up in two days: a deployment's call-up (engine.js callUpSize) brings a body of them.
const FAST = { mechanics: { muster: true }, musterOf: () => ({ table: [0, 0.5, 1], head: 0 }) };

test("a block's places are its middle, then ring after ring, never two the same", () => {
  const steps = blockSteps(25);
  assert.deepEqual(steps[0], [0, 0]);
  assert.equal(new Set(steps.map((step) => step.join(","))).size, 25);
  // The first ring's eight, then the second's sixteen: a whole five by five.
  assert.ok(steps.slice(1, 9).every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) === 1));
  assert.ok(steps.slice(9).every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) === 2));
  // A ring not yet whole is not lopsided: its first four are one on each side.
  assert.deepEqual(steps.slice(1, 5), [[1, 0], [0, 1], [-1, 0], [0, -1]]);
});

test("a swarm deployment brings a country's new troops in as a group at one place, under one general of its own", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  // Those it calls up when time next passes (deploy.js): with no order, no event.
  const placed = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [PLACE], form: "swarm" }, { player: "Aland", date: "2024-03-01" });
  assert.equal(placed.error, undefined);
  assert.deepEqual(deployLinesOf(placed.record, side), [{ country: "Aland", way: [PLACE], form: "swarm", call: DEPLOY_USUAL }]);
  const before = troopsOf(record, side).length;
  const after = run({ ...FAST, battlefields: [placed.record], days: 2 }).battlefields[0];
  const fresh = troopsOf(after, side).slice(before);
  assert.ok(fresh.length >= 3, `${fresh.length} came`);
  assert.equal(deployLinesOf(after, side)[0].last.n, fresh.length);
  assert.ok(after.log.some((entry) => entry.k === "drafted" && entry.at === `${fresh.length} fresh formations where its swarm gathers`));
  // One general, and he is a swarm's: the first number after the line's own generals.
  const commands = new Set(fresh.map((troop) => troop.command));
  assert.equal(commands.size, 1);
  const [command] = commands;
  assert.equal(command, FRONT_COMMANDS_MOST);
  assert.deepEqual(swarmsOfRecord(after)[side], [command]);
  const general = generalsOf(after, side).find((one) => one.command === command);
  assert.equal(general.n, fresh.length, "one general, and they are his alone");
  // Together, at the place: not strung along the front 200 km away.
  const at = { lng: PLACE[0], lat: PLACE[1] };
  for (const troop of fresh) assert.ok(kmApart(troop, at) < 90, `came in ${kmApart(troop, at).toFixed(0)} km from the place`);
  // Nobody of the line is under the swarm's general, nor any line general under a swarm's number.
  for (const troop of troopsOf(after, side).slice(0, before)) assert.ok(troop.command !== command && troop.command < FRONT_COMMANDS_MOST);
});

test("new troops join the swarm at their place, and gather as a new one once it has gone on", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const placed = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [PLACE], form: "swarm" }, { player: "Aland" }).record;
  const first = run({ ...FAST, battlefields: [placed], days: 2 }).battlefields[0];
  const [command] = swarmsOfRecord(first)[side];
  const count = troopsOf(first, side).length;
  // More of them while the swarm is still there, by an order for them (the deployment's own call spent): the same general.
  const second = run({ battlefields: [first], moments: reinforce(first, 3), days: 2 }).battlefields[0];
  const joined = troopsOf(second, side).slice(count);
  assert.equal(joined.length, 3);
  assert.ok(joined.every((troop) => troop.command === command));
  assert.deepEqual(swarmsOfRecord(second)[side], [command]);
  // The swarm told to go elsewhere (its place moved away under it): the next ones are a swarm of their own.
  const away = applyWarRoomOp([second], { op: "deploy", battlefield: second.name, way: [[21, 50.4]], form: "swarm" }, { player: "Aland" }).record;
  const third = run({ ...FAST, battlefields: [away], days: 2 }).battlefields[0];
  const others = troopsOf(third, side).slice(troopsOf(second, side).length);
  assert.ok(others.length >= 2, `${others.length} came`);
  assert.equal(deployLinesOf(third, side)[0].last.n, others.length);
  const fresh = new Set(others.map((troop) => troop.command));
  assert.equal(fresh.size, 1);
  assert.ok(!fresh.has(command));
  assert.deepEqual(swarmsOfRecord(third)[side], [command, ...fresh].sort((a, b) => a - b));
});

test("a swarm's troops move by themselves, as the line's do: told to advance, each goes its own way", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const placed = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [PLACE], form: "swarm" }, { player: "Aland" }).record;
  const formed = run({ ...FAST, battlefields: [placed], days: 2 }).battlefields[0];
  const [command] = swarmsOfRecord(formed)[side];
  const swarm = troopsOf(formed, side).filter((troop) => troop.command === command);
  const told = applyWarRoomOp([formed], { op: "order", battlefield: formed.name, troops: swarm.map((troop) => troop.index), order: "advance" }, { player: "Aland" });
  assert.equal(told.error, undefined);
  // The order is for those picked out, as any order is: nothing more is made of it for a swarm.
  const serving = told.record.brief.carry.under[side];
  assert.ok(swarm.every((troop) => serving[troop.index] >= 0));
  const later = run({ battlefields: [told.record], days: 6 }).battlefields[0];
  const moved = troopsOf(later, side).filter((troop) => troop.command === command);
  assert.equal(moved.length, swarm.length);
  const went = moved.map((troop, at) => kmApart(troop, swarm[at]));
  assert.ok(moved.reduce((sum, troop) => sum + troop.lng, 0) / moved.length > swarm.reduce((sum, troop) => sum + troop.lng, 0) / swarm.length + 0.3, "they went east, toward the other side");
  assert.ok(Math.max(...went) - Math.min(...went) > 1, `each its own way: ${went.map((km) => km.toFixed(1)).join(", ")} km`);
  // ... and they are still the swarm's: the same general.
  assert.deepEqual(swarmsOfRecord(later)[side], [command]);
});

test("a war fought in swarms raises each side's troops as swarms behind the line, each under a general of its own", () => {
  const [record] = run({ warfare: "swarm" }).battlefields;
  const swarms = swarmsOfRecord(record);
  for (const side of [0, 1]) {
    const troops = troopsOf(record, side).filter((troop) => troop.strength > 0);
    assert.ok(troops.length > 0);
    assert.equal(swarms[side].length, Math.min(MAX_COMMANDS, Math.max(1, Math.round(troops.length / SWARM_TROOPS_EACH))));
    assert.ok(troops.every((troop) => swarms[side].includes(troop.command)), "every troop is a swarm's");
    // Behind the line, on their own side's ground: none along the border at 24 E.
    const member = record.sides[side][0];
    for (const troop of troops) assert.ok(member === "Aland" ? troop.lng < 23.8 : troop.lng > 24.2, `${member} troop at ${troop.lng.toFixed(2)}`);
  }
  // A run told nothing, or told fronts, is the run there was before swarms.
  const plain = JSON.stringify(run().battlefields);
  assert.equal(JSON.stringify(run({ warfare: "front" }).battlefields), plain);
  assert.equal(run().battlefields[0].brief.carry.swarms, undefined);
});

test("a front a scenario begins with may have a side deployed as swarms", () => {
  const fronts = normalizeScenarioFronts([{ name: "The Border", sides: [["Aland"], ["Borduria"]], war: true, troops: [0, 0], stance: ["hold", "hold"], forms: ["swarm", ""] }]);
  assert.deepEqual(fronts[0].forms, ["swarm", ""]);
  assert.equal(normalizeScenarioFronts([{ sides: [["Aland"], ["Borduria"]] }])[0].forms, undefined, "kept only where a side says");
  assert.deepEqual(normalizeScenarioFronts([{ sides: [["Aland"], ["Borduria"]], forms: ["column", "front"] }])[0].forms, ["", "front"]);
  assert.deepEqual(authoredForms(fronts, [["Borduria"], ["Aland"]]), ["", "swarm"]);
  assert.equal(authoredForms(fronts, [["Neutralia"], ["Aland"]]), null);
  const [record] = run({ authored: fronts }).battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const swarms = swarmsOfRecord(record);
  assert.ok(swarms[side].length > 0);
  assert.deepEqual(swarms[1 - side], []);
  assert.ok(troopsOf(record, side).filter((troop) => troop.strength > 0).every((troop) => swarms[side].includes(troop.command)));
  // The other side, told nothing, fights as the scenario's wars are fought: along a front, as a run with no warfare does.
  const swarmWar = swarmsOfRecord(run({ authored: fronts, warfare: "swarm" }).battlefields[0]);
  assert.ok(swarmWar[0].length > 0 && swarmWar[1].length > 0);
});

test("how a game's wars are fought: as the scenario says, else in swarms before 1900", () => {
  assert.equal(warfareOf({}, "1899-12-31"), "swarm");
  assert.equal(warfareOf({}, "1900-01-01"), "front");
  assert.equal(warfareOf({}, "-0480-08-20"), "swarm");
  assert.equal(warfareOf({ warSettings: { warfare: "front" } }, "1805-12-02"), "front");
  assert.equal(warfareOf({ warSettings: { warfare: "swarm" } }, "2024-03-01"), "swarm");
  // A calendar of its own goes by the era the scenario set, and is the present's with none.
  assert.equal(warfareOf({ warSettings: { era: 0 } }, "Year 12"), "swarm");
  assert.equal(warfareOf({ warSettings: { era: 3 } }, "Year 12"), "front");
  assert.equal(warfareOf({}, "Year 12"), "front");
  assert.equal(normalizeWarSettings({ warfare: "swarm" }).warfare, "swarm");
  assert.equal(normalizeWarSettings({ warfare: "column" }).warfare, undefined);
});

test("a swarm deployment crosses to a host with its form, is its side's own, and is drawn as a place", () => {
  assert.deepEqual(cleanWarRoomOp({ op: "deploy", battlefield: "The Border", way: [PLACE], form: "swarm" }), { op: "deploy", battlefield: "The Border", way: [PLACE], form: "swarm" });
  assert.equal(cleanWarRoomOp({ op: "deploy", battlefield: "The Border", way: [PLACE], form: "column" }).form, "");
  const [record] = run().battlefields;
  // A swarm's place is its first point; a line's needs two.
  const one = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [PLACE, [21.5, 51]], form: "swarm" }, { player: "Aland" }).record;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  assert.deepEqual(deployLinesOf(one, side)[0].way, [PLACE]);
  assert.ok(applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [PLACE] }, { player: "Aland" }).error, "a line of one point is no line");
  assert.deepEqual(readSwarms([[5, 5, 9, -1, "6"], "x"]), [[5, 6], []]);
  const drawn = planFeatures({ plans: [{ id: "deploy", kind: "deploy", form: "swarm", ways: [[PLACE]] }] }).features;
  assert.deepEqual(drawn.map((feature) => [feature.geometry.type, feature.properties.what]), [["Point", "spot"]]);
});
