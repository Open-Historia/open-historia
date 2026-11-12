import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { findPockets, markPockets, settlePockets, surrenderPocket } from "../../../../../src/runtime/fronts/supply.js";

test("golden probes for mornings, supply and pockets with every mechanic", () => {
  const legend2 = { A: "Aland", B: "Borduria" };
  const layouts = [
    ["AAAAAAAA", "AAAABBBB", "AAAABBBB", "AAAAAAAA"],
    ["AAAAAA", "ABBBBA", "ABBBBA", "AAAAAA"],
    ["ABBBBB", "ABBBBB"],
  ];
  const all = { fatigue: true, weather: true, terrain: true, walls: true, muster: false, military: true, air: true, supply: true, attrition: true };
  layouts.forEach((layout, at) => {
    const world = syntheticMap({ layout, legend: legend2, west: 20, north: 51, step: 0.35, stepLat: 0.22, key: `golden-dawn-${at}`, cities: [{ name: "Brod", lng: 20 + 0.35 * (layout[0].length - 1.5), lat: 51 - 0.22 * (layout.length / 2) }] });
    const east = 20 + 0.35 * layout[0].length;
    const policy = (battle, side) => (battle.sides[side][0] === "Aland"
      ? (at === 2 ? { order: "encircle", sector: "all", objective: "city: Brod" } : { order: "advance", sector: "all" })
      : { order: at === 1 ? "dig in" : "hold", sector: "all" });
    const wing = (id, ownerCode, lng) => ({ id, name: id, type: "air", ownerCode, strength: 100, lng, lat: 50.6 });
    runFronts(frontInput(world, {
      arenas: new Map(), staff: true, troops: 0.5, days: 18, era: 3, strengthOf: (name) => (name === "Aland" ? 3 : 1), staffPolicy: policy,
      mechanics: at === 1 ? { ...all, military: false, air: false } : all,
      steering: at === 0 ? { readiness: { punch: [1.2, 0.9], guard: [1, "x"], legs: [0.8] } } : {},
      militaryOf: (name) => (name === "Aland" ? { land: 1.2, air: 1 } : { land: 0.8, air: 0.5 }),
      units: [wing("a1", "Aland", 20.4), wing("a2", "Aland", 20.5), wing("b1", "Borduria", east - 0.3)],
      fortifications: [{ id: "wall", name: "The Wall", owner: "Borduria", level: 4, points: [[east - 0.5, 51.1], [east - 0.5, 50]], breaches: [], wear: [] }],
    }));
  });
});
