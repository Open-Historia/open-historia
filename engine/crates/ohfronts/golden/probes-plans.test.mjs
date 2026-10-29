import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { describePlans, hasDoubleAgent, keptPlansOf, knownPlans, operationsOn, plansOf, readPlans, withDiversion, withOperationOrders, withProjectPlan, withWatch, withoutPlan } from "../../../../../src/runtime/fronts/plans.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../../../../src/runtime/fronts/testKit.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.4, lat: 50, population: 300000 },
  { name: "Arda", lng: 20.5, lat: 49.25, population: 80000 },
  { name: "Brod", lng: 22.6, lat: 50, population: 900000 },
  { name: "Nová Bród", lng: 24.2, lat: 50.6, population: 200000 },
  { name: "Cetin", lng: 23.4, lat: 49.4, population: 500000, capital: true },
  { name: "Zed", lng: 25.4, lat: 49.4, population: 500000 },
];
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));

test("golden probes for plans, operations and what agents send", () => {
  const world = syntheticMap({ layout: ["ABBBBB", "ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.65, cities });
  const orders = [
    { s: 0, sector: "all", order: "spearhead", objective: "city: Brod", since: "2024-02-20" },
    { s: 1, sector: "all", order: "encircle", objective: "city: Alba", since: "2024-02-20" },
    { s: 1, sector: "north", order: "flank", objective: "city: Arda", since: "2024-02-20" },
    { s: 1, sector: "south", order: "hold", since: "2024-02-20" },
  ];
  const opened = runFronts(frontInput(world, { battlefields: [battlefieldOn(world, { troops: [row(20.9, 49.1, 50.9, 30), row(21.1, 49.1, 50.9, 24)], orders })], days: 2, steering: { even: true, wander: 0 } })).battlefields[0];
  const projects = [
    { id: "p1", name: "Operation Kingfisher", kind: "operation", ownerCode: "", status: "active", summary: "Three corps encircle and cut off Brod.", secrecy: "covert", targetDate: "2024-05-01" },
    { id: "p2", name: "Lightning attack on Nova Brod", kind: "operation", ownerCode: "Aland", status: "proposed", summary: "", ongoing: true },
    { id: "p3", name: "Thrust", kind: "operation", ownerCode: "Aland", status: "active", focus: { lng: 22.5, lat: 49.9 }, verification: "doubted" },
    { id: "p4", name: "Outflanking Cetin", kind: "operation", ownerCode: "Borduria", status: "active", summary: "armoured thrust" },
    { id: "p5", name: "Quiet", kind: "operation", status: "active", linkedSpyIds: ["s1"], summary: "Brod" },
    { id: "p6", name: "Done", kind: "operation", status: "done", summary: "Brod" },
  ];
  for (const player of ["Aland", "Borduria", ""]) {
    const context = { projects, cities, player };
    for (const side of [0, 1, 2]) {
      operationsOn({ record: opened, side, projects, cities, player });
      plansOf(opened, side, context);
      keptPlansOf(opened, side);
    }
    const sent = withOperationOrders(opened, { sides: [0, 1], projects, cities, player, since: "2024-03-02" });
    plansOf(sent, 0, context);
    withOperationOrders(sent, { sides: [0], projects: projects.map((entry) => ({ ...entry, status: "paused" })), cities, player });
  }
  let record = withDiversion(opened, 1, { way: [[24, 50], [21.5, 50.2], [20.6, 50.1]], troops: 7, at: "2024-03-01" });
  record = withDiversion(record, 1, { way: [[24, 49.5], [21, 49.3]] });
  record = withDiversion(record, 0, { way: [[1, 2]] });
  record = withProjectPlan(record, 0, { project: "p1", way: [[20.8, 50], [21.9, 49.9], [22.6, 50]], at: "2024-03-01" });
  record = withProjectPlan(record, 0, { project: "p3", off: true });
  record = withProjectPlan(record, 0, { project: "p3", off: false, sent: true });
  record = withProjectPlan(record, 0, { project: "p1", way: [] });
  record = withoutPlan(record, 1, "d1");
  readPlans(record.brief?.carry?.plans);
  readPlans([[{ kind: "diversion", id: "x", way: [[1, 2], [3, 4]], troops: -0.4 }, null, "text", { kind: "project", project: "q", sent: true }], [{ kind: "project", project: "" }]]);
  const spies = [
    { id: "s1", owner: "Aland", target: "Borduria", status: "active" },
    { id: "s2", owner: "Aland", target: "Borduria", status: "turned" },
    { id: "s3", owner: "Borduria", target: "Aland", status: "turned" },
  ];
  for (const known of [spies, spies.slice(1, 2), spies.slice(2), []]) {
    for (const played of [[], ["Borduria"]]) {
      for (const base of [opened, record]) {
        const told = knownPlans({ record: base, side: 0, spies: known, projects, cities, player: "Aland", played });
        knownPlans({ record: base, side: 1, spies: known, projects, cities, player: "Borduria", played });
        hasDoubleAgent({ record: base, side: 0, spies: known });
        hasDoubleAgent({ record: base, side: 1, spies: known });
        describePlans(base, told.plans, { cities });
        describePlans(base, plansOf(base, 1, { projects, cities, player: "Aland" }), { cities, most: 3 });
        withWatch(base, 0, told.plans, { since: "2024-03-03" });
        withWatch(base, 1, plansOf(base, 0, { projects, cities, player: "Aland" }));
      }
    }
  }
});
