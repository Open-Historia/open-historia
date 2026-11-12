import test from "node:test";
import { DEFAULT_MUSTER, musterTable } from "../../../../../src/runtime/mustering.js";
import { decodeTroops } from "../../../../../src/runtime/fronts/codec.js";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { projectorOf } from "../../../../../src/runtime/fronts/frame.js";
import { describeBattlefield } from "../../../../../src/runtime/fronts/brief.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { applyWarRoomOp, cleanWarRoomOp } from "../../../../../src/runtime/fronts/warRoomOps.js";

const legend = { A: "Aland", B: "Borduria" };
const cities = [
  { name: "Westburg", lng: 20.6, lat: 51.4, population: 3_000_000 },
  { name: "Eastham", lng: 23.2, lat: 51.4, population: 600_000 },
  { name: "Ostrava", lng: 26.4, lat: 51.2, population: 900_000 },
];
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, cities, key: "golden-home" });
const curve = { table: musterTable(DEFAULT_MUSTER), head: DEFAULT_MUSTER[0][1] };
const peace = (probe, extra = {}) => frontInput(sheet(), {
  arenas: new Map(), troops: 1, days: 0, strengthOf: () => 4, wars: [], gameBegan: "2024-01-01",
  mechanics: { marching: true }, players: ["Aland"], [probe]: 1,
  ...extra,
});
const callUp = (ref = 1, day = 0, side = "Aland") => ({ day, type: "order", battlefield: `home: ${side}`, side, order: "reinforce", sector: "all", given: true, ref });
const homeOf = (result, side = "Aland") => result.battlefields.find((record) => record.home === true && record.status !== "closed" && record.sides[0][0] === side);
const troopsOf = (record, side = 0) => {
  const place = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).map((troop, index) => ({ ...troop, index, lng: place.toLngLat(troop.x, troop.y)[0] })).filter((troop) => troop.strength > 0);
};

test("golden probes: a country's forces at home", () => {
  const built = runFronts(peace("goldenHomeCall", { moments: [callUp(1), callUp(2), callUp(3, 0, "Borduria")] }));
  const home = homeOf(built);
  if (!home) return;
  const troops = troopsOf(home);
  const near = troops.filter((troop) => troop.lng > 22.4).map((troop) => troop.index);
  const into = near.length > 0 ? applyWarRoomOp([home], { op: "route", battlefield: home.name, troops: near, way: [[23.6, 51.4], [25, 51.4]] }, { player: "Aland" }) : {};
  if (into.record) runFronts(peace("goldenHomeWar", { battlefields: [into.record], days: 2 }));
  const routed = applyWarRoomOp([home], { op: "route", battlefield: home.name, troops: troops.map((troop) => troop.index), way: [[22.6, 51.4], [23.6, 51.4]] }, { player: "Aland" });
  if (routed.record) runFronts(peace("goldenHomeRoute", { battlefields: [routed.record], days: 3 }));
  const sent = runFronts(peace("goldenHomeStation", { players: [], battlefields: built.battlefields, days: 3, moments: [{ day: 1, type: "order", battlefield: "home: Aland", side: "Aland", order: "hold", objective: "country: Borduria", ref: 9 }] }));
  runFronts(peace("goldenHomeMuster", { battlefields: built.battlefields, moments: [callUp(4, 1), { day: 0, type: "order", battlefield: "home: Borduria", side: "Borduria", order: "reinforce", count: 2, given: true, ref: 5 }], days: 2, mechanics: { marching: true, muster: true }, musterOf: () => curve }));
  runFronts(peace("goldenHomeOrders", { battlefields: sent.battlefields, days: 1, moments: [
    { day: 0, type: "order", battlefield: "home: Aland", side: "Aland", order: "advance", ref: 12 },
    { day: 0, type: "order", battlefield: "home: Aland", side: "Aland", order: "hold", ref: 13 },
    { day: 0, type: "order", battlefield: "home: Aland", side: "Borduria", order: "hold", ref: 14 },
    { day: 0, type: "order", battlefield: "home: Nowhere", side: "Nowhere", order: "reinforce", ref: 15 },
    { day: 0, type: "order", battlefield: "home: Borduria", side: "Borduria", order: "dig in", objective: "country: Nowhere", effort: "total", ref: 16 },
    { day: 1, type: "order", battlefield: "Home : Aland ", side: "Aland", order: "withdraw", ref: 11 },
  ] }));
  const deployed = applyWarRoomOp([home], { op: "deploy", battlefield: home.name, way: [[21, 51.2], [22, 51.2]] }, { player: "Aland", date: "2024-03-01" });
  if (deployed.record) runFronts(peace("goldenHomeDeploy", { battlefields: [deployed.record], days: 1 }));
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
