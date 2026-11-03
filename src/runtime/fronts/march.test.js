/*! Open Historia — battlefields and fronts: new troops march to the line from inside their country: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/march.test.js
//
// "forces shouldnt just be immediatly deployed at the front lines, they should
// need to move to the front lines from in the country. how far in should be
// calculated using population density. troop movement in your own sides
// territory should be 50% faster than if your carving through enemy territory"
// (the owner, 2026-11-02).

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MUSTER, musterTable } from "../mustering.js";
import { ADVANCE_KM_PER_DAY } from "../unitMotion.js";
import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { MARCH_DEPTH_UNKNOWN_KM, OWN_GROUND_PACE } from "./march.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
// Aland west of 24 E, Borduria east of it; a degree of longitude here is some 70 km.
const KM_A_DEGREE = 111.32 * Math.cos((50.5 * Math.PI) / 180);
const sheet = (cities = []) => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, cities, key: `march-${cities.length}` });
// A war Aland began two months into the game, fought with marching on.
const war = (extra = {}, cities = []) => frontInput(sheet(cities), {
  arenas: new Map(), troops: 1, days: 0, strengthOf: () => 4,
  wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-03-01" }],
  gameBegan: "2024-01-01",
  mechanics: { marching: true },
  ...extra,
});
// How far behind the border at 24 E a side's live troops stand, in km, on average.
const behind = (record, name) => {
  const side = record.sides.findIndex((members) => members.includes(name));
  const place = projectorOf(record.frame);
  const troops = decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0);
  const km = troops.map((troop) => Math.abs(place.toLngLat(troop.x, troop.y)[0] - 24) * KM_A_DEGREE);
  return km.reduce((sum, each) => sum + each, 0) / km.length;
};

test("a war's new troops are called up inside their country, and march to the line", () => {
  const opened = runFronts(war()).battlefields[0];
  const off = runFronts(war({ mechanics: {} })).battlefields[0];
  assert.ok(behind(off, "Aland") < 40, `without marching they stand on the line: ${behind(off, "Aland").toFixed(0)} km back`);
  // With no cities on the map, at the depth for a country whose people nobody can place.
  assert.ok(behind(opened, "Aland") > MARCH_DEPTH_UNKNOWN_KM * 0.6, `called up ${behind(opened, "Aland").toFixed(0)} km back`);
  assert.ok(behind(opened, "Borduria") > MARCH_DEPTH_UNKNOWN_KM * 0.6);
  assert.ok(opened.brief.carry.march, "where each is going is kept");
  // And they march there: the line is manned within days.
  const later = runFronts(war({ battlefields: [opened], days: 6 })).battlefields[0];
  assert.ok(behind(later, "Aland") < 45, `${behind(later, "Aland").toFixed(0)} km back after six days`);
  assert.equal(later.brief.carry.march, undefined, "and nobody is on the way any more");
});

test("a day's march over its own side's ground is half again what it carves through the other's", () => {
  const opened = runFronts(war()).battlefields[0];
  const next = runFronts(war({ battlefields: [opened], days: 1 })).battlefields[0];
  const side = opened.sides.findIndex((members) => members.includes("Aland"));
  const [before, after] = [opened, next].map((record) => {
    const place = projectorOf(record.frame);
    return decodeTroops(record.troops[side]).map((troop) => ({ kind: troop.kind, at: place.toLngLat(troop.x, troop.y) }));
  });
  // Each by its kind (infantry, armour, artillery), at the era's advance and the run's pace (1 here).
  const paces = [ADVANCE_KM_PER_DAY.infantry[3], ADVANCE_KM_PER_DAY.armor[3], ADVANCE_KM_PER_DAY.artillery[3]].map((km) => km * OWN_GROUND_PACE);
  for (let at = 0; at < before.length; at += 1) {
    const across = (after[at].at[0] - before[at].at[0]) * KM_A_DEGREE;
    const down = (after[at].at[1] - before[at].at[1]) * 111.32;
    const marched = Math.sqrt(across * across + down * down);
    const pace = paces[before[at].kind];
    assert.ok(marched > pace * 0.85 && marched < pace * 1.15, `${marched.toFixed(0)} km in a day, at ${pace} km a day`);
  }
});

// "a troop is technically always on its own ground, because its painting its own territory arround it. make sure this
// isnt an issue with the new troop speed change" (the owner, 2026-11-02).
test("a line carving into the other side's land goes no faster: the paint round a troop is not its own territory", () => {
  const old = [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2023-06-01" }];
  const opened = runFronts(war({ wars: old, mechanics: {} })).battlefields[0];
  const order = [{ day: 1, type: "order", battlefield: opened.name, side: "Aland", order: "advance", sector: "all", effort: "total", given: true, ref: 1 }];
  const east = (mechanics) => {
    const after = runFronts(war({ wars: old, battlefields: [opened], moments: order, days: 12, mechanics })).battlefields[0];
    const side = after.sides.findIndex((members) => members.includes("Aland"));
    const place = projectorOf(after.frame);
    const troops = decodeTroops(after.troops[side]).filter((troop) => troop.strength > 0);
    return troops.reduce((sum, troop) => sum + place.toLngLat(troop.x, troop.y)[0], 0) / troops.length;
  };
  const before = (() => {
    const side = opened.sides.findIndex((members) => members.includes("Aland"));
    const place = projectorOf(opened.frame);
    const troops = decodeTroops(opened.troops[side]).filter((troop) => troop.strength > 0);
    return troops.reduce((sum, troop) => sum + place.toLngLat(troop.x, troop.y)[0], 0) / troops.length;
  })();
  const plain = east({});
  const marching = east({ marching: true });
  assert.ok(plain > before + 0.3, `the advance went east: ${before.toFixed(2)} to ${plain.toFixed(2)}`);
  assert.ok(Math.abs(marching - plain) < 0.15, `as far with marching on (${marching.toFixed(2)}) as without (${plain.toFixed(2)})`);
});

test("the thinner a country's people are spread, the deeper inside it they are called up", () => {
  // Aland's people in great cities near the border, or in one small town.
  const crowded = [21.5, 22.5, 23.5].flatMap((lng) => [50.2, 51, 52].map((lat, at) => ({ name: `City ${lng} ${at}`, lng, lat, population: 4_000_000 })));
  const empty = [{ name: "Hamlet", lng: 21, lat: 51, population: 20_000 }];
  const dense = behind(runFronts(war({}, crowded)).battlefields[0], "Aland");
  const sparse = behind(runFronts(war({}, empty)).battlefields[0], "Aland");
  assert.ok(sparse > dense * 1.5, `${dense.toFixed(0)} km back where it is crowded, ${sparse.toFixed(0)} km where it is empty`);
});

test("a war under way when the game began has its armies at the line, as a scenario's own fronts do", () => {
  const old = runFronts(war({ wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2023-06-01" }] })).battlefields[0];
  assert.ok(behind(old, "Aland") < 40, `${behind(old, "Aland").toFixed(0)} km back`);
  assert.equal(old.brief.carry.march, undefined);
});

test("a border built up in peace calls its troops up inside the country, and they muster and march to it over weeks", () => {
  const curve = { table: musterTable(DEFAULT_MUSTER), head: DEFAULT_MUSTER[0][1] };
  const peace = (extra = {}) => war({
    wars: [],
    mechanics: { marching: true, muster: true },
    musterOf: () => curve,
    ...extra,
  });
  const order = [{ day: 0, type: "order", battlefield: "border: Aland / Borduria", side: "Aland", order: "dig in", effort: "major", given: true, ref: 1 }];
  const built = runFronts(peace({ moments: order })).battlefields[0];
  assert.equal(built.status, "standing");
  const side = built.sides.findIndex((members) => members.includes("Aland"));
  const first = decodeTroops(built.troops[side]).filter((troop) => troop.strength > 0).length;
  assert.ok(first > 0);
  assert.ok(behind(built, "Aland") > 30, `built up ${behind(built, "Aland").toFixed(0)} km back`);
  assert.ok(built.brief.carry.levy, "the rest are owed, and muster");
  assert.equal(decodeTroops(built.troops[1 - side]).length, 0, "Borduria raises nobody: it did not build up");
  // A month on: more of them, nearer the border, and still nobody has fought.
  const month = runFronts(peace({ battlefields: [built], days: 30 })).battlefields[0];
  assert.equal(month.status, "standing");
  const now = decodeTroops(month.troops[side]).filter((troop) => troop.strength > 0);
  assert.ok(now.length > first, `${first} at first, ${now.length} a month on`);
  assert.ok(now.every((troop) => troop.strength === 100), "nobody fought");
  assert.ok(behind(month, "Aland") < behind(built, "Aland"), "they came up to it");
});
