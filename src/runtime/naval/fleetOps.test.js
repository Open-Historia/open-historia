/*! Open Historia — what the war room tells a fleet: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/naval/fleetOps.test.js
//
// "The war room should also be able to command fleets": only the asker's own,
// under the postures the war at sea knows, to places at sea in the water the
// fleet is in; and what is written is what the game carries out when time
// passes (gameState.js advanceStandingOrders).

import test from "node:test";
import assert from "node:assert/strict";

import { syntheticMap } from "../fronts/syntheticMap.js";
import { buildWorldGrid, kmBetween } from "../fronts/worldGrid.js";
import { advanceStandingOrders, normalizeWorldState } from "../gameState.js";
import { chartOf } from "../warRoomChart.js";
import {
  FLEET_OPS,
  FLEET_PATROL_KM,
  FLEET_POSTURES,
  applyFleetOp,
  blockadeStationFor,
  cleanFleetOp,
  convoysOf,
  enemiesOf,
  escortStationFor,
  fleetsOf,
} from "./fleetOps.js";

// Aland in the west with a lake inside it, Borduria in the east, the sea between.
const map = syntheticMap({
  layout: ["AAAA~~~BBBBB", "A~AA~~~BBBBB", "AAAA~~~BBBBB", "AAAABBBBBBBB"],
  legend: { A: "Aland", B: "Borduria", N: "Neutralia", "~": null },
  west: 0,
  north: 54,
  step: 1,
  key: "the fleets' sea",
});
const chart = chartOf({ grid: buildWorldGrid(map.regions, { step: 0.5 }), controllerOf: map.controllerOf });
const SEA = [5.5, 52.5];
const LAKE = [1.5, 52.5];
const fleet = (id, ownerCode, [lng, lat], extra = {}) => ({ id, name: `${ownerCode} ${id}`, type: "naval", ownerCode, strength: 80, lng, lat, status: "idle", posture: "patrol", ...extra });
const world = (extra = {}) => ({
  units: [
    fleet("u1", "Aland", SEA),
    fleet("u2", "Borduria", [6.2, 53.5]),
    { id: "u3", name: "First Army", type: "infantry", ownerCode: "Aland", strength: 100, lng: 2.5, lat: 53.5, status: "idle" },
    fleet("u4", "Aland", [5.2, 53.6], { status: "pending" }),
    fleet("u5", "Aland", LAKE, { name: "Lake Flotilla" }),
  ],
  pendingUnitOrders: [{ id: "o1", unitId: "u1", kind: "patrol", toLng: 5.5, toLat: 52.5, radiusKm: 250, untilRound: 20 }],
  wars: [
    { id: "w1", status: "active", sideA: ["Aland"], sideB: ["Borduria"] },
    { id: "w0", status: "ended", sideA: ["Aland"], sideB: ["Neutralia"] },
  ],
  transports: [
    { id: "t1", medium: "sea", kind: "troopships", owner: "Aland", status: "moving", to: { lng: 5.5, lat: 51.4, name: "Southport" }, way: [[5.2, 53.8], [5.5, 51.4]], km: 268, gone: 68, speed: 400 },
    { id: "t2", medium: "sea", kind: "troopships", owner: "Borduria", status: "moving", to: { lng: 6.5, lat: 51.4 }, way: [[6.3, 53.8], [6.5, 51.4]], km: 268, gone: 0 },
    { id: "t3", medium: "sea", kind: "troopships", owner: "Aland", status: "ordered", to: { lng: 5.5, lat: 51.4 } },
    { id: "t4", medium: "air", kind: "transport aircraft", owner: "Aland", status: "moving", to: { lng: 9, lat: 52 }, way: [[2, 53], [9, 52]], km: 480 },
  ],
  ...extra,
});
const DATE = "1914-08-01";
const as = (player, extra = {}) => ({ player, date: DATE, round: 7, chart, at: "2026-10-14T12:00:00.000Z", ...extra });
const command = (op, who = "Aland", extra = {}, base = world()) => applyFleetOp(base, op, as(who, extra));
const orderOf = (result, unitId = "u1") => result.world.pendingUnitOrders.find((entry) => entry.unitId === unitId) ?? null;
const unitOf = (result, unitId = "u1") => result.world.units.find((entry) => entry.id === unitId);

test("the war room lists the asker's own fleets, with the standing order of each, and nobody else's", () => {
  const listed = fleetsOf(world(), " aland ");
  assert.deepEqual(listed.map((entry) => entry.id), ["u1", "u4", "u5"], "its fleets, and not its army or another's fleet");
  assert.deepEqual([listed[0].strength, listed[0].posture, listed[0].pending, listed[0].order.kind, listed[0].order.radiusKm], [80, "patrol", false, "patrol", 250]);
  assert.equal(listed[1].pending, true);
  assert.equal(listed[2].order, null);
  assert.deepEqual(fleetsOf(world(), ""), []);
  assert.deepEqual(enemiesOf(world(), "Aland"), ["Borduria"], "at war by the ledger, and not in a war that has ended");
  assert.deepEqual(enemiesOf(world(), "Borduria"), ["Aland"]);
  assert.deepEqual(enemiesOf(world(), "Neutralia"), []);
  assert.deepEqual(convoysOf(world(), "Aland").map((entry) => entry.id), ["t1"], "its convoys under way by sea");
});

test("only the asker's own fleets take orders", () => {
  assert.match(command({ op: "posture", unit: "u2", posture: "holding" }).error, /not a fleet of yours/, "another country's fleet");
  assert.match(command({ op: "posture", unit: "u3", posture: "holding" }).error, /not a fleet of yours/, "an army is no fleet");
  assert.match(command({ op: "posture", unit: "u9", posture: "holding" }).error, /not a fleet of yours/);
  assert.match(command({ op: "posture", unit: "", posture: "holding" }).error, /not a fleet of yours/);
  assert.match(command({ op: "posture", unit: "u4", posture: "holding" }).error, /not in your order of battle yet/);
  assert.match(command({ op: "posture", unit: "u1", posture: "holding" }, "").error, /no country/);
  const committed = world();
  committed.units[0] = { ...committed.units[0], committedTo: "The Baltic Front" };
  assert.match(command({ op: "posture", unit: "u1", posture: "holding" }, "Aland", {}, committed).error, /fighting on a battlefield/);
  // The same fleet asked for by its own country.
  assert.equal(command({ op: "posture", unit: "u2", posture: "holding" }, "Borduria").error, undefined);
  assert.match(command({ op: "sink", unit: "u1" }).error, /Nothing was asked/);
});

test("a fleet takes the six postures the war room gives, and keeps or loses its standing order by what they mean", () => {
  assert.deepEqual(FLEET_POSTURES, ["patrol", "blockade", "assaulting", "holding", "withdrawing", "transit"]);
  for (const posture of ["massing", "exercise", "attack", ""]) assert.match(command({ op: "posture", unit: "u1", posture }).error, /do not know that order/, posture);
  // Seeking battle, holding and withdrawing: the fleet is no longer on a station.
  for (const posture of ["assaulting", "holding", "withdrawing"]) {
    const done = command({ op: "posture", unit: "u1", posture: posture.toUpperCase() });
    assert.equal(unitOf(done).posture, posture);
    assert.equal(orderOf(done), null, `${posture}: its patrol called off`);
    assert.equal(done.order, null);
  }
  // A fleet blockading, or escorting, is not on a patrol's station: the game would make it patrol again.
  assert.equal(orderOf(command({ op: "posture", unit: "u1", posture: "blockade" })), null);
  assert.equal(orderOf(command({ op: "posture", unit: "u1", posture: "transit" })), null);
  // Told to patrol with no station: it works one where it is.
  const idle = command({ op: "posture", unit: "u5", posture: "patrol" });
  assert.deepEqual(orderOf(idle, "u5"), { id: "warroom-u5", unitId: "u5", kind: "patrol", toLng: 1.5, toLat: 52.5, radiusKm: FLEET_PATROL_KM, untilRound: 0, targetLabel: "", issuedAt: DATE, issuedRound: 7 });
  // The other fleets' orders stand, and the fleet is stamped so the map sees it changed.
  const sent = command({ op: "station", unit: "u1", to: [5.2, 51.4], order: "move" });
  const blockading = command({ op: "posture", unit: "u1", posture: "blockade" }, "Aland", {}, sent.world);
  assert.equal(orderOf(blockading).kind, "move", "on its way, it goes on to blockade there");
  assert.equal(unitOf(blockading).updatedAt, "2026-10-14T12:00:00.000Z");
});

test("a fleet is sent only to the sea, in the water it is in, and works a station there or sails to it", () => {
  assert.match(command({ op: "station", unit: "u1", to: [2.5, 53.5] }).error, /not at sea/);
  assert.match(command({ op: "station", unit: "u1", to: LAKE }).error, /No sea leads there/, "a lake is no water of the sea's");
  assert.match(command({ op: "station", unit: "u5", to: SEA }).error, /No sea leads there/, "nor the sea a lake's");
  assert.match(command({ op: "station", unit: "u1", to: [5.2, 51.4] }, "Aland", { chart: null }).error, /could not be read/);
  assert.match(command({ op: "station", unit: "u1" }).error, /Say where/);
  assert.match(command({ op: "station", unit: "u1", to: [5.2, 95] }).error, /Say where/);
  // Sailing to a place: a move order, in transit, under way.
  const sail = command({ op: "station", unit: "u1", to: [-1.5, 52.5], order: "move" });
  assert.equal(sail.error, undefined);
  assert.deepEqual(orderOf(sail), { id: "warroom-u1", unitId: "u1", kind: "move", toLng: -1.5, toLat: 52.5, radiusKm: 0, untilRound: 0, targetLabel: "", issuedAt: DATE, issuedRound: 7 });
  assert.deepEqual([unitOf(sail).posture, unitOf(sail).status], ["transit", "moving"]);
  assert.equal(sail.world.pendingUnitOrders.length, 1, "its patrol order is replaced, not added to");
  // A blockading fleet sent elsewhere goes on blockading there.
  const blockading = world();
  blockading.units[0] = { ...blockading.units[0], posture: "blockade" };
  assert.equal(unitOf(command({ op: "station", unit: "u1", to: [5.2, 51.4] }, "Aland", {}, blockading)).posture, "blockade");
  // A station near enough is worked at once: a patrol order of FLEET_PATROL_KM.
  const near = command({ op: "station", unit: "u1", to: [5.2, 51.6], order: "patrol" });
  assert.ok(kmBetween(...SEA, 5.2, 51.6) < FLEET_PATROL_KM);
  assert.deepEqual([orderOf(near).kind, orderOf(near).radiusKm, unitOf(near).posture, unitOf(near).status], ["patrol", FLEET_PATROL_KM, "patrol", "idle"]);
  // A station far off is sailed to under the posture "patrol", and worked when it is reached.
  const far = command({ op: "station", unit: "u1", to: [-1.5, 55.5], order: "patrol" });
  assert.ok(kmBetween(...SEA, -1.5, 55.5) > FLEET_PATROL_KM);
  assert.deepEqual([orderOf(far).kind, orderOf(far).targetLabel, unitOf(far).posture, unitOf(far).status], ["move", "a patrol station at sea", "patrol", "moving"]);
});

test("a blockade is laid on a country the asker is at war with, from the water off its coast nearest the fleet", () => {
  const done = command({ op: "blockade", unit: "u1", country: " borduria " });
  assert.equal(done.error, undefined);
  const order = orderOf(done);
  const station = blockadeStationFor(chart, "Borduria", SEA);
  assert.deepEqual(station, chart.coastOff("Borduria", SEA));
  assert.equal(blockadeStationFor(null, "Borduria", SEA), null);
  assert.deepEqual([order.kind, order.toLng, order.toLat, order.targetLabel], ["move", station[0], station[1], "a blockade station off Borduria"]);
  assert.equal(unitOf(done).posture, "blockade");
  assert.match(command({ op: "blockade", unit: "u1", country: "Neutralia" }).error, /at war with no such country/, "a war that has ended");
  assert.match(command({ op: "blockade", unit: "u1", country: "Atlantis" }).error, /at war with no such country/);
  assert.match(command({ op: "blockade", unit: "u5", country: "Borduria" }).error, /No coast of theirs/, "from a lake");
  assert.match(command({ op: "blockade", unit: "u1", country: "Borduria" }, "Aland", { chart: null }).error, /could not be read/);
});

test("a fleet covers a convoy of the asker's at sea from the middle of what is left of its way", () => {
  const [convoy] = convoysOf(world(), "Aland");
  const station = escortStationFor(convoy);
  // 68 of 268 km gone: the middle of the 200 left is 168 km along.
  assert.ok(Math.abs(kmBetween(5.2, 53.8, station[0], station[1]) - 168) < 2, String(station));
  assert.equal(escortStationFor({ ...convoy, status: "ordered" }), null);
  assert.equal(escortStationFor({ ...convoy, medium: "air" }), null);
  assert.equal(escortStationFor(null), null);
  const done = command({ op: "escort", unit: "u1", transport: "t1" });
  assert.equal(done.error, undefined);
  assert.deepEqual([orderOf(done).kind, orderOf(done).toLng, orderOf(done).toLat, orderOf(done).targetLabel], ["move", station[0], station[1], "a station covering the troopships bound for Southport"]);
  assert.equal(unitOf(done).posture, "transit");
  for (const transport of ["t2", "t3", "t4", "t9"]) assert.match(command({ op: "escort", unit: "u1", transport }).error, /no convoy of yours at sea/, transport);
  assert.match(command({ op: "escort", unit: "u5", transport: "t1" }).error, /No sea leads there/, "a flotilla on a lake");
});

test("a standing order is called off, and a fleet patrolling nothing holds where it is", () => {
  const done = command({ op: "stand", unit: "u1" });
  assert.deepEqual([orderOf(done), unitOf(done).posture], [null, "holding"]);
  const sent = command({ op: "station", unit: "u1", to: [-1.5, 52.5] });
  const called = command({ op: "stand", unit: "u1" }, "Aland", {}, sent.world);
  assert.deepEqual([orderOf(called), unitOf(called).posture, unitOf(called).status], [null, "transit", "idle"]);
});

test("what the war room writes is what the game carries out when time passes", () => {
  // (Under sail, some 200 km a day: unitMotion.js.)
  const passing = (written, days, round = 8) => normalizeWorldState(advanceStandingOrders(normalizeWorldState(written), { fromDate: "1700-08-01", toDate: `1700-08-${String(1 + days).padStart(2, "0")}`, round }));
  const at = (state, unitId = "u1") => state.units.find((entry) => entry.id === unitId);
  // A fleet sent 450 km away sails toward it, a day's sailing at a time, and arrives.
  const sent = command({ op: "station", unit: "u1", to: [-1.5, 52.5] }).world;
  const before = kmBetween(...SEA, -1.5, 52.5);
  const day = passing(sent, 1);
  assert.ok(kmBetween(at(day).lng, at(day).lat, -1.5, 52.5) < before - 100, "it has sailed toward it");
  assert.equal(day.pendingUnitOrders.find((entry) => entry.unitId === "u1")?.kind, "move", "and is still under way");
  const week = passing(sent, 7);
  assert.ok(kmBetween(at(week).lng, at(week).lat, -1.5, 52.5) < 1, "and is there");
  assert.equal(week.pendingUnitOrders.some((entry) => entry.unitId === "u1"), false, "its order is done with");
  assert.deepEqual([at(week).posture, at(week).status], ["transit", "idle"]);
  // A blockade: the fleet keeps its posture all the way to its station.
  const blockade = passing(command({ op: "blockade", unit: "u1", country: "Borduria" }).world, 7);
  assert.equal(at(blockade).posture, "blockade");
  assert.ok(kmBetween(at(blockade).lng, at(blockade).lat, ...chart.coastOff("Borduria", SEA)) < 1);
  // A station near enough is worked where it is, within its radius, turn after turn.
  const near = passing(command({ op: "station", unit: "u1", to: [5.2, 51.6], order: "patrol" }).world, 7);
  assert.ok(kmBetween(at(near).lng, at(near).lat, 5.2, 51.6) <= FLEET_PATROL_KM + 1);
  assert.equal(near.pendingUnitOrders.find((entry) => entry.unitId === "u1")?.kind, "patrol");
  // One far off is sailed to, and becomes a station of its own when it is reached.
  const far = passing(command({ op: "station", unit: "u1", to: [-1.5, 55.5], order: "patrol" }).world, 7);
  assert.equal(far.pendingUnitOrders.find((entry) => entry.unitId === "u1")?.kind, "patrol");
  assert.equal(at(far).posture, "patrol");
});

test("an op is cut to its own fields and sizes before it crosses the wire", () => {
  assert.deepEqual(FLEET_OPS, ["posture", "station", "blockade", "escort", "stand"]);
  assert.equal(cleanFleetOp(null), null);
  assert.equal(cleanFleetOp({ op: "sink", unit: "u1" }), null);
  assert.deepEqual(cleanFleetOp({ op: "posture", unit: " u1 ", posture: " Holding ", to: [1, 2] }), { op: "posture", unit: "u1", posture: "holding" });
  assert.deepEqual(cleanFleetOp({ op: "station", unit: "u1", to: [5.123456, "52.5"], order: "patrol", country: "Borduria" }), { op: "station", unit: "u1", to: [5.1235, 52.5], order: "patrol" });
  assert.deepEqual(cleanFleetOp({ op: "station", unit: "u1", to: [NaN, 1], order: "sail" }), { op: "station", unit: "u1", order: "move" }, "no place that is no place");
  assert.deepEqual(cleanFleetOp({ op: "blockade", unit: "u1", country: "  Borduria " }), { op: "blockade", unit: "u1", country: "Borduria" });
  assert.deepEqual(cleanFleetOp({ op: "escort", unit: "u1", transport: "t1", posture: "patrol" }), { op: "escort", unit: "u1", transport: "t1" });
  assert.deepEqual(cleanFleetOp({ op: "stand", unit: "u1" }), { op: "stand", unit: "u1" });
});
