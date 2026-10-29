import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { findPockets, markPockets, settlePockets, surrenderPocket } from "../../../../../src/runtime/fronts/supply.js";

test("golden probes for a small fight", () => {
  const legend2 = { A: "Aland", B: "Borduria" };
  for (const [at, mechanics] of [{}, { fatigue: true, walls: true, weather: true, supply: true, attrition: true }].entries()) {
    const world = syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB"], legend: legend2, west: 20, north: 51, step: 0.06, stepLat: 0.04, key: `golden-fight-${at}` });
    const policy = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: at === 1 ? "dig in" : "hold", sector: "all" });
    runFronts(frontInput(world, {
      arenas: new Map(), staff: true, troops: 1, days: 8, era: 2, strengthOf: (name) => (name === "Aland" ? 3 : 1), staffPolicy: policy, mechanics,
      fortifications: [{ id: "wall", name: "The Wall", owner: "Borduria", level: 3, points: [[20.37, 51.01], [20.37, 50.87]], breaches: [], wear: [] }],
    }));
  }
});
