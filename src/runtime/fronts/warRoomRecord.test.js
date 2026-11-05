/*! Open Historia — battlefields and fronts: what a record keeps for the War Room and the war's report: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/warRoomRecord.test.js
//
// The owner's list of 2026-10-16: the weather ahead in the War Room, its
// supply on the map, the other side's plan found out, aircraft on the map, and
// a report of the war once it is over. Each reads the battlefield's record:
// here is what the record keeps for them.

import test from "node:test";
import assert from "node:assert/strict";

import { runFronts } from "./engine.js";
import { CHRONICLE_KINDS, chronicleAfter, readChronicle } from "./chronicle.js";
import { decodeFourMask, decodeMask } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { normalizeBattlefield } from "./record.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { FORECAST_DAYS, WEATHER_STATES } from "./weather.js";
import { PLAN_NAMES, createPlanner } from "./mind/planner.js";

const legend = { A: "Aland", B: "Borduria" };
const CITIES = [
  { name: "Westburg", lng: 21.4, lat: 51.2, population: 300000, capital: true },
  { name: "Eastholm", lng: 26.6, lat: 50.8, population: 250000, capital: true },
  { name: "Midford", lng: 23.5, lat: 51.4, population: 80000 },
];
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities: CITIES, key: "war-room-record" });
const WALL = { id: "wall", name: "The Wall", owner: "Borduria", level: 3, points: [[24.4, 52.2], [24.4, 49.8]], breaches: [], wear: [] };
const MECHANICS = { weather: true, walls: true, air: true, supply: true, fatigue: true };
const input = (extra = {}) => frontInput(sheet(), {
  arenas: new Map(),
  staff: true,
  troops: 1,
  days: 12,
  strengthOf: (name) => (name === "Aland" ? 9 : 3),
  staffPolicy: createPlanner({ ahead: 2 }),
  mechanics: MECHANICS,
  fortifications: [WALL],
  airArms: true,
  climateSeed: "war-room-record",
  ...extra,
});

test("a record keeps the weather of the days ahead, and the next period has that weather", () => {
  const first = runFronts(input());
  const [record] = first.battlefields;
  const forecast = record.brief.forecast;
  assert.equal(forecast.length, FORECAST_DAYS);
  for (const day of forecast) assert.ok(WEATHER_STATES.includes(day.w), day.w);
  assert.equal(forecast[0].d, "2024-03-14", "the day after the run's last");
  // The next run fights in just that weather, day for day.
  const next = runFronts(input({ battlefields: first.battlefields, fromDate: record.asOf, days: FORECAST_DAYS, fortifications: [WALL] }));
  const counted = {};
  for (const day of forecast) counted[day.w] = (counted[day.w] ?? 0) + 1;
  assert.deepEqual(next.battlefields[0].brief.weather.days, counted);
});

test("a record keeps how its ground is supplied, what each side's staff means to do, and what its aircraft were sent to do", () => {
  const { battlefields: [record] } = runFronts(input());
  const { cols, rows } = record.frame;
  const holders = decodeMask(record.field.mask, cols * rows);
  const supply = decodeFourMask(record.brief.supply, cols * rows);
  let held = 0;
  for (let cell = 0; cell < holders.length; cell += 1) {
    const sided = holders[cell] === HOLDER_SIDE_A || holders[cell] === HOLDER_SIDE_B;
    assert.equal(supply[cell] > 0, sided, `cell ${cell}`);
    if (sided) held += 1;
  }
  assert.ok(held > 0);
  // The plan each staff that looks ahead last gave, and where it aimed.
  const plans = record.brief.carry.staff;
  assert.ok(Array.isArray(plans) && plans.some(Boolean));
  for (const plan of plans.filter(Boolean)) {
    assert.ok(PLAN_NAMES.includes(plan.plan), plan.plan);
    assert.ok(plan.since >= "2024-03-01" && plan.since <= record.asOf);
  }
  // The aircraft over it, and what each side's were sent to do.
  assert.ok(record.brief.air, "both sides fly their air arms");
  assert.equal(record.brief.air.missions.length, 2);
});

// Aland advances along its whole line, Borduria holds behind its wall (as walls.test.js has them): the wall breaks.
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });

test("a record keeps what its war came to, run by run, and a wall broken through is told", () => {
  const first = runFronts(input({ days: 15, staffPolicy: fixed, mechanics: { walls: true } }));
  const [record] = first.battlefields;
  const chronicle = normalizeBattlefield(record).chronicle;
  assert.ok(chronicle, "kept as the record is read");
  assert.equal(chronicle.strength.length, 1);
  assert.equal(chronicle.strength[0][0], record.asOf);
  for (const moment of chronicle.moments) assert.ok(CHRONICLE_KINDS.includes(moment.k), moment.k);
  assert.ok(chronicle.moments.some((moment) => moment.k === "breached" && moment.at === "wall: The Wall" && moment.s === 0), JSON.stringify(chronicle.moments));
  assert.ok(first.news.some((entry) => entry.k === "breached"), "and the story is told of it");
  // The next run adds to it.
  const next = runFronts(input({ battlefields: first.battlefields, fromDate: record.asOf, days: 6, staffPolicy: fixed, mechanics: { walls: true }, fortifications: [{ ...WALL, breaches: first.fortifications[0].breaches }] }));
  const after = normalizeBattlefield(next.battlefields[0]).chronicle;
  assert.equal(after.strength.length, 2);
  assert.ok(after.moments.length >= chronicle.moments.length);
});

test("a chronicle is kept within bounds: the war's opening and its latest moments, its strength thinned out", () => {
  const troops = [[{ strength: 80, x: 1, y: 1 }], [{ strength: 60, x: 2, y: 1 }]];
  let chronicle = null;
  for (let run = 0; run < 90; run += 1) {
    const log = Array.from({ length: 30 }, (_, at) => ({ d: `2024-01-${String(1 + (at % 28)).padStart(2, "0")}`, k: "offensive", s: 0, at: `place ${run}-${at}` }));
    chronicle = chronicleAfter({ chronicle, log, logFrom: 0, troops, arena: { cities: [] } }, `2024-${String(1 + (run % 12)).padStart(2, "0")}-${String(1 + run % 28).padStart(2, "0")}x${run}`);
  }
  const read = readChronicle(chronicle);
  assert.ok(read.moments.length <= 120);
  assert.equal(read.moments[0].at, "place 0-0", "the war's opening is kept");
  assert.equal(read.moments.at(-1).at, "place 89-15", "and the latest, sixteen a run at most");
  assert.ok(read.strength.length <= 60);
  assert.deepEqual(read.strength.at(-1).slice(1), [1, 1, 80, 60]);
  assert.equal(readChronicle({ moments: [{ k: "nonsense" }], strength: [] }), null);
});
