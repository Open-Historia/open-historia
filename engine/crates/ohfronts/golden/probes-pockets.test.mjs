import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { findPockets, markPockets, settlePockets, surrenderPocket } from "../../../../../src/runtime/fronts/supply.js";

test("golden probes for pockets that are settled and given up", () => {
  const legend2 = { A: "Aland", B: "Borduria" };
  const world = syntheticMap({ layout: Array.from({ length: 10 }, () => "AAAAAAAABBBBBBBB"), legend: legend2, west: 20, north: 52, step: 0.25, stepLat: 0.15, key: "golden-pockets" });
  let settled = 0;
  const policy = (battle, side) => {
    if (battle.pockets.length > 0 && settled < 10 && side === 0) {
      settled += 1;
      markPockets(battle);
      if (settled % 3 === 0) surrenderPocket(battle, battle.pockets.length - 1, "2024-03-09");
      else settlePockets(battle, "2024-03-09");
      findPockets(battle);
    }
    if (battle.sides[side][0] !== "Aland") return undefined;
    const middle = battle.field.rows / 2;
    const live = battle.troops[side].map((troop, index) => (troop.strength > 0 ? index : -1)).filter((index) => index >= 0);
    const going = live.filter((index) => Math.abs(battle.troops[side][index].y - middle) < battle.field.rows / 4);
    const holding = live.filter((index) => !going.includes(index));
    return { troops: [{ order: "advance", picked: going, way: [[23.9, 51.25]] }, ...(holding.length > 0 ? [{ order: "hold", picked: holding }] : [])] };
  };
  policy.often = true;
  runFronts(frontInput(world, { arenas: new Map(), staff: true, troops: 1, days: 30, strengthOf: (name) => (name === "Aland" ? 6 : 2), era: 1, mechanics: { supply: true }, staffPolicy: policy }));
});
