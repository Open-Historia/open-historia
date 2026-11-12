import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { memberOf, servingOf, takesOrder } from "../../../../../src/runtime/fronts/orders.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";

const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "Aland - Borduria front", side, order: word, sector: "all", ...extra });

test("golden probes for orders on a side of several countries", () => {
  const legend = { A: "Aland", C: "Cland", B: "Borduria" };
  const cities = [
    { name: "Brod", lng: 21.4, lat: 50.6, population: 300000 },
    { name: "Ost", lng: 20.6, lat: 50.4, population: 200000, capital: true },
  ];
  const world = syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "CCCCBBBB", "CCCCBBBB"], legend, west: 20, north: 51, step: 0.2, stepLat: 0.15, cities, key: "golden-orders" });
  for (const [at, players] of [[], ["Cland"]].entries()) {
    let asked = 0;
    const policy = (battle, side, context, run) => {
      asked += 1;
      if (asked > 6) return undefined;
      for (const name of ["Aland", "cland", "Borduria", "Nobody", ""]) memberOf(battle, name);
      for (const troop of battle.troops[side].slice(0, 6)) servingOf(battle, troop);
      const today = { day: 2, line: context.today?.line, sectors: context.today?.sectors };
      for (const standing of battle.orders.slice(0, 4)) {
        if (!today.line) break;
        const takes = takesOrder(battle, run, standing, today);
        for (const troop of battle.troops[standing.s].slice(0, 8)) takes(troop);
      }
      return undefined;
    };
    policy.often = true;
    runFronts(frontInput(world, {
      wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland", "Cland"], sideB: ["Borduria"] }],
      players,
      staff: true,
      troops: 1,
      days: 6,
      strengthOf: (name) => (name === "Borduria" ? 3 : 2),
      staffPolicy: policy,
      moments: [
        order(0, "Aland", "advance", { sector: "north" }),
        order(0, "Cland", "dig in", { sector: "south" }),
        order(1, "Cland", "spearhead", { objective: "city: Brod" }),
        order(2, "Aland", "assault", { objective: "city: Brod" }),
        order(3, "Borduria", "encircle", { objective: "city: Ost" }),
        order(4, "Cland", "fall back", { objective: "city: Ost" }),
        order(5, "Aland", "withdraw", { sector: "south" }),
      ],
    }));
  }
});
