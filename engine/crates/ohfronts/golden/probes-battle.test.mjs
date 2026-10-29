import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { DEFAULT_MUSTER, musterTable } from "../../../../../src/runtime/mustering.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";

const legend = { A: "Aland", C: "Cland", B: "Borduria" };
const curve = { table: musterTable(DEFAULT_MUSTER), head: DEFAULT_MUSTER[0][1] };
const people = { Aland: 3e6, Cland: 8e5, Borduria: 5e6 };
const figures = { Aland: { land: 70, menPerCounter: 9000, cavalryShare: 0.3 }, Cland: { land: 40, manpowerShare: 2 }, Borduria: { land: 55, siegeShare: 0.2 } };

const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "CCCCBBBB", "CCCCBBBB"], legend, west: 20, north: 52, step: 0.6, stepLat: 0.4, cities: [{ name: "Brod", lng: 22.5, lat: 51.4, population: 300000 }], key: "golden-battle" });

const carried = (record, side) => ({
  ...record,
  brief: {
    ...record.brief,
    carry: {
      ...record.brief?.carry,
      generals: [["Marshal Ash", "General Birch"], ["General Cole"]],
      talk: [[{ who: "", text: "Hold the river.", at: "2024-03-02" }], [{ who: 0, text: "  We  push at dawn. ", at: "2024-03-03" }]],
      staff: [{ plan: "push", at: "city: Brod", since: "2024-03-02", n: 2.5 }, null],
      plans: [[{ kind: "diversion", at: [1, 1] }, { kind: "operation", id: "op-1" }], []],
      sentHome: [["unit-9", side], ["", 1], ["unit-8", 3]],
      away: [false, side === 1],
      quiet: 3,
      halts: [{ s: 0, sector: "north", days: 2.7 }, { s: 2, days: 1 }],
      anchors: [{ s: 1, x: 3.5, y: 2.25 }, { s: 0, x: "a" }],
      pockets: [{ s: 0, cell: 5, days: "2", told: true }, { s: 1, cell: 2.5 }],
    },
  },
});

test("golden probes for a battlefield raised, kept and read again", () => {
  for (const [at, extra] of [
    {},
    { mechanics: { muster: true, military: true, fatigue: true, weather: true }, gameBegan: "2024-01-01" },
    { mechanics: { muster: true }, gameBegan: "2024-01-01", warfare: "swarm" },
    { mechanics: { military: true, fatigue: true }, players: ["Cland"] },
  ].entries()) {
    const world = sheet();
    const input = frontInput(world, {
      arenas: new Map(),
      troops: 1,
      days: 4,
      seed: `battle-${at}`,
      strengthOf: (name) => (name === "Borduria" ? 4 : 2),
      wars: [{ id: "war-1", title: "aland-war", status: "active", sideA: ["Aland", "Cland"], sideB: ["Borduria"], startedDate: "2024-03-01" }],
      musterOf: () => curve,
      peopleOf: (name) => people[name],
      militaryOf: (name) => figures[name] ?? null,
      units: [
        { id: "unit-1", name: "First Guards", type: "armor", ownerCode: "Aland", strength: 80, lng: 21.9, lat: 51.5 },
        { id: "unit-2", name: "Far Rifles", type: "infantry", ownerCode: "Borduria", strength: 0, lng: 22.6, lat: 51.1 },
      ],
      moments: [
        { day: 1, type: "order", battlefield: "Aland - Borduria front", side: "Aland", order: "advance", sector: "all" },
        { day: 2, type: "order", battlefield: "Aland - Borduria front", side: "Borduria", order: "spearhead", objective: "city: Brod" },
      ],
      ...extra,
    });
    const first = runFronts(input);
    const again = runFronts({ ...input, fromDate: "2024-03-05", toDate: "2024-03-08", days: 3, battlefields: first.battlefields.map((record) => carried(record, at % 2)) });
    runFronts({ ...input, fromDate: "2024-03-08", toDate: "2024-03-10", days: 2, battlefields: again.battlefields });
  }
});
