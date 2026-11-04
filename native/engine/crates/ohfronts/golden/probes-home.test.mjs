import test from "node:test";
import { DEFAULT_MUSTER, musterTable } from "../../../../../src/runtime/mustering.js";
import { decodeTroops } from "../../../../../src/runtime/fronts/codec.js";
import { createFrontRun, runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { createFrame, normalizeFrame, projectorOf } from "../../../../../src/runtime/fronts/frame.js";
import { describeBattlefield } from "../../../../../src/runtime/fronts/brief.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { applyWarRoomOp, cleanWarRoomOp } from "../../../../../src/runtime/fronts/warRoomOps.js";
import { buildWorldGrid, distanceTo, kmBetween, measureOptions, placeAlong, planeY, wayKm } from "../../../../../src/runtime/fronts/worldGrid.js";
import { findWay } from "../../../../../src/runtime/fronts/wayfinder.js";
import { engineMapOf, mapMeasureOf, metricTableFor } from "../../../../../server/mapDistance.js";

const legend = { A: "Aland", B: "Borduria", C: "Carpania" };
const cities = [
  { name: "Westburg", lng: 20.6, lat: 51.4, population: 3_000_000 },
  { name: "Eastham", lng: 23.2, lat: 51.4, population: 600_000 },
  { name: "Ostrava", lng: 26.4, lat: 51.2, population: 900_000 },
];
const LAYOUT = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"];
const sheet = (extra = {}) => syntheticMap({ layout: LAYOUT, legend, west: 20, north: 53, step: 1, stepLat: 0.5, cities, key: "golden-home", ...extra });
const curve = { table: musterTable(DEFAULT_MUSTER), head: DEFAULT_MUSTER[0][1] };
const peace = (extra = {}, world = sheet()) => frontInput(world, {
  arenas: new Map(), troops: 1, days: 0, strengthOf: () => 4, wars: [], gameBegan: "2024-01-01",
  mechanics: { marching: true }, players: ["Aland"], goldenHome: 1,
  ...extra,
});
const callUp = (ref = 1, day = 0, side = "Aland") => ({ day, type: "order", battlefield: `home: ${side}`, side, order: "reinforce", sector: "all", given: true, ref });
const homeOf = (result, side = "Aland") => result.battlefields.find((record) => record.home === true && record.status !== "closed" && record.sides[0][0] === side);
const troopsOf = (record, side = 0) => {
  const place = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).map((troop, index) => ({ ...troop, index, lng: place.toLngLat(troop.x, troop.y)[0] })).filter((troop) => troop.strength > 0);
};

test("golden probes: a country's forces at home", () => {
  const built = runFronts(peace({ moments: [callUp(1), callUp(2), callUp(3, 0, "Borduria")] }));
  const home = homeOf(built);
  if (!home) return;
  runFronts(peace({ battlefields: built.battlefields, moments: [callUp(4, 1)], days: 2, mechanics: { marching: true, muster: true }, musterOf: () => curve }));
  runFronts(peace({ battlefields: built.battlefields, moments: [{ day: 0, type: "order", battlefield: "home: Aland", side: "Aland", order: "reinforce", count: 2, given: true, ref: 5 }], days: 1, mechanics: { marching: true, muster: true }, musterOf: () => curve }));
  const troops = troopsOf(home);
  const routed = applyWarRoomOp([home], { op: "route", battlefield: home.name, troops: troops.map((troop) => troop.index), way: [[22.6, 51.4], [23.6, 51.4]] }, { player: "Aland" });
  if (routed.record) runFronts(peace({ battlefields: [routed.record], days: 4 }));
  const near = troops.filter((troop) => troop.lng > 22.4).map((troop) => troop.index);
  if (near.length > 0) {
    const into = applyWarRoomOp([home], { op: "route", battlefield: home.name, troops: near, way: [[23.6, 51.4], [25, 51.4]] }, { player: "Aland" });
    if (into.record) {
      const war = runFronts(peace({ battlefields: [into.record], days: 2 }));
      runFronts(peace({ battlefields: war.battlefields, days: 2, wars: war.starts.map((start) => ({ id: start.warId, status: "active", sideA: [start.attacker], sideB: [start.defender], startedDate: start.date })) }));
    }
  }
  const sent = runFronts(peace({ players: [], battlefields: built.battlefields, days: 3, moments: [{ day: 1, type: "order", battlefield: "home: Aland", side: "Aland", order: "hold", objective: "country: Borduria", ref: 9 }] }));
  runFronts(peace({ players: [], battlefields: built.battlefields, days: 2, moments: [{ day: 0, type: "order", battlefield: "home: Aland", side: "Aland", order: "dig in", objective: "country: Borduria", effort: "total", ref: 10 }] }));
  runFronts(peace({ battlefields: sent.battlefields, days: 1, moments: [{ day: 0, type: "order", battlefield: "Home : Aland ", side: "Aland", order: "withdraw", ref: 11 }] }));
  runFronts(peace({ battlefields: built.battlefields, days: 1, moments: [
    { day: 0, type: "order", battlefield: "home: Aland", side: "Aland", order: "advance", ref: 12 },
    { day: 0, type: "order", battlefield: "home: Aland", side: "Aland", order: "hold", ref: 13 },
    { day: 0, type: "order", battlefield: "home: Aland", side: "Borduria", order: "hold", ref: 14 },
    { day: 0, type: "order", battlefield: "home: Nowhere", side: "Nowhere", order: "reinforce", ref: 15 },
    { day: 1, type: "order", battlefield: "home: Aland", side: "Aland", order: "hold", objective: "country: Nowhere", ref: 16 },
  ] }));
  const deployed = applyWarRoomOp([home], { op: "deploy", battlefield: home.name, way: [[21, 51.2], [22, 51.2]] }, { player: "Aland", date: "2024-03-01" });
  if (deployed.record) runFronts(peace({ battlefields: [deployed.record], days: 1 }));
  for (const op of [
    { op: "order", battlefield: home.name, troops: [troops[0]?.index ?? 0], order: "advance" },
    { op: "order", battlefield: home.name, troops: [troops[0]?.index ?? 0], order: "dig in" },
    { op: "diversion", battlefield: home.name, way: [[22, 51], [23, 51]] },
    { op: "deploy", battlefield: home.name, way: [[21, 51.2], [22, 51.2]], count: 0 },
    { op: "deploy", battlefield: home.name, way: [[21, 51.2], [22, 51.2]], count: "12" },
  ]) {
    applyWarRoomOp([home], op, { player: "Aland", date: "2024-03-01" });
    cleanWarRoomOp(op);
  }
  describeBattlefield(home);
  describeBattlefield(home, { max: 90 });
  describeBattlefield({ ...home, brief: { ...home.brief, near: 3, strength: [{ n: 4, mustering: 2 }, {}] } });
});

test("golden probes: troops marching to the line", () => {
  const war = (extra = {}, world = sheet()) => frontInput(world, {
    arenas: new Map(), troops: 1, days: 0, strengthOf: () => 4, goldenMarch: 1,
    wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-03-01" }],
    gameBegan: "2024-01-01", mechanics: { marching: true },
    ...extra,
  });
  const opened = runFronts(war());
  if (opened.battlefields[0]) {
    runFronts(war({ battlefields: opened.battlefields, days: 3 }));
    runFronts(war({ battlefields: opened.battlefields, days: 2, moments: [{ day: 1, type: "order", battlefield: opened.battlefields[0].name, side: "Aland", order: "reinforce", sector: "all", given: true, ref: 1 }] }));
  }
  const mustered = runFronts(war({ mechanics: { marching: true, muster: true }, musterOf: () => curve }));
  if (mustered.battlefields[0]) runFronts(war({ battlefields: mustered.battlefields, days: 3, mechanics: { marching: true, muster: true }, musterOf: () => curve }));
  runFronts(war({ wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2023-06-01" }], days: 1 }));
  const border = runFronts(war({ wars: [], days: 1, mechanics: { marching: true, muster: true }, musterOf: () => curve, moments: [{ day: 0, type: "order", battlefield: "border: Aland / Borduria", side: "Aland", order: "hold", ref: 2 }] }));
  const standing = border.battlefields.find((record) => record.status === "standing");
  if (standing) {
    runFronts(war({ wars: [], battlefields: border.battlefields, days: 3, mechanics: { marching: true, muster: true }, musterOf: () => curve }));
    const mine = troopsOf(standing, standing.sides.findIndex((members) => members.includes("Aland")));
    const leaving = applyWarRoomOp([standing], { op: "order", battlefield: standing.name, troops: mine.slice(0, 2).map((troop) => troop.index), order: "withdraw" }, { player: "Aland" });
    if (leaving.record) runFronts(war({ wars: [], battlefields: [leaving.record], days: 2 }));
    const routed = applyWarRoomOp([standing], { op: "route", battlefield: standing.name, troops: mine.map((troop) => troop.index), way: [[22, 51.4], [23.5, 51.4]] }, { player: "Aland" });
    if (routed.record) runFronts(war({ wars: [], battlefields: [routed.record], days: 3 }));
    const attack = applyWarRoomOp([standing], { op: "order", battlefield: standing.name, troops: mine.map((troop) => troop.index), order: "advance" }, { player: "Aland" });
    if (attack.record) runFronts(war({ wars: [], battlefields: [attack.record], days: 1 }));
    describeBattlefield(standing);
  }
});

test("golden probes: the war room's air strikes on the battlefields", () => {
  const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), troops: 1, days: 2, strengthOf: () => 4, goldenAir: 1, ...extra });
  runFronts(war({ moments: [
    { type: "airstrike", day: 0, ref: "air:s1", owner: "Aland", lng: 24, lat: 51, km: 120, hit: 40, at: "the line" },
    { type: "airstrike", day: 1, ref: "air:s2", owner: "Neutralia", lng: 23.5, lat: 51.5, km: 60, hit: 25, at: "" },
    { type: "airstrike", day: 1, ref: "air:s3", owner: "Borduria", lng: 60, lat: 10, km: 20, hit: 40, at: "nowhere" },
    { type: "airstrike", day: 1, ref: "air:s4", owner: "Borduria", lng: 24, lat: 51, km: 0, hit: 40, at: "zero" },
  ] }));
  runFronts(war({ mechanics: { walls: true }, days: 3, moments: [
    { day: 0, type: "order", battlefield: "war-1", side: "Borduria", order: "dig in", sector: "all", ref: 1 },
    { type: "airstrike", day: 2, ref: "air:s5", owner: "Aland", lng: 24.2, lat: 51, km: 150, hit: 60, at: "the dug-in line" },
  ] }));
});

test("golden probes: distances by the map's projection", () => {
  const robinson = engineMapOf(mapMeasureOf("robinson"));
  const scaled = engineMapOf(mapMeasureOf({ type: "equal-earth", scale: { from: [20, 50], to: [24, 50], km: 450 } }));
  const sized = engineMapOf(mapMeasureOf({ type: "mercator", scale: { from: [20, 50], to: [24, 50], km: 380 } }));
  const flat = engineMapOf(mapMeasureOf({ type: "freeform", scale: { from: [20, 50], to: [24, 50], km: 300 } }));
  for (const [type, factor] of [["robinson", 1], ["robinson"], ["Robinson"], ["equal-earth"], ["equal-earth", scaled.factor], ["equal-earth", 1.25], ["no-such"], ["mercator", 2.5]]) metricTableFor(type, factor);
  const maps = [robinson, scaled, sized, flat, {}];
  for (const extra of maps) {
    measureOptions({ ...sheet().map, ...extra });
    const options = measureOptions(extra);
    for (const [a, b] of [[[20, 50], [24, 51]], [[-170, 10], [175, -12]], [[0, 80], [10, -70]], [[5, 0], [5, 0.01]]]) kmBetween(a[0], a[1], b[0], b[1], options);
    const frame = createFrame({ west: 20, south: 50, east: 24, north: 53 }, { ...options, marginKm: 40 });
    if (frame) {
      projectorOf(frame);
      normalizeFrame(JSON.parse(JSON.stringify(frame)));
    }
    const grid = buildWorldGrid(sheet().regions, { ...options, water: null });
    if (grid) {
      const far = distanceTo(grid, Math.floor(grid.cols * grid.rows / 2));
      for (let cell = 0; cell < grid.cols * grid.rows; cell += 97) far(cell);
      grid.km(20, 50, 23, 52);
      findWay(grid, { medium: "land", from: [20.5, 52.5], to: [23.5, 50.5], holderOf: () => "Aland" });
    }
    placeAlong([[20, 50], [22, 51], [24, 52]], 120, options);
    wayKm([[20, 50], [22, 51], [24, 52]], options);
  }
  for (const value of [{ lng0: 20, lat0: 50, cell: 0.1, cols: 40, rows: 30, km: 8, proj: "Robinson" }, { lng0: 20, lat0: 50, cell: 0.1, cols: 40, rows: 30, km: 8, proj: "no-such", factor: 1 }, { lng0: 20, lat0: 50, cell: 0.1, cols: 40, rows: 30, km: 8, proj: "mercator", factor: 2.5 }, { lng0: 20, lat0: 50, cell: 0.1, cols: 40, rows: 30, km: 8, flat: true, proj: "robinson" }]) {
    const frame = normalizeFrame(value);
    if (frame) projectorOf(frame);
  }
  for (const lat of [-90, -85.06, -60, -1e-9, 0, 0.04, 33.3, 85.06, 90, NaN]) planeY(lat);
  metricTableFor("equal-earth", 1.25);
  for (const extra of [robinson, scaled, flat, sized]) {
    const world = { ...sheet({ key: `golden-measure-${maps.indexOf(extra)}` }), };
    world.map = { ...world.map, ...extra };
    const opened = runFronts(frontInput(world, { arenas: new Map(), troops: 1, days: 0, strengthOf: () => 4, goldenMeasure: 1, mechanics: { walls: true, air: true }, fortifications: [{ id: "w1", name: "Line", points: [[23, 50.2], [23.2, 52.8]], level: 4 }] }));
    if (opened.battlefields[0]) runFronts(frontInput(world, { arenas: new Map(), troops: 1, days: 2, strengthOf: () => 4, goldenMeasure: 1, battlefields: opened.battlefields }));
  }
});

test("golden probes: a run of a war with marching, taken in steps", () => {
  const run = createFrontRun(frontInput(sheet(), { arenas: new Map(), troops: 1, days: 3, strengthOf: () => 4, goldenSteps: 1, gameBegan: "2024-01-01", mechanics: { marching: true }, wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-03-01" }] }));
  while (!run.advance(1));
  run.finish();
});
