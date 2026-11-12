import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { engineerLines, frontLineFor } from "../../../../../src/runtime/fronts/engineer.js";
import { holderAt } from "../../../../../src/runtime/fronts/record.js";
import { battlefieldForViewer, battlefieldsForViewer } from "../../../../../src/runtime/fronts/view.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const chartOf = (record) => ({
  holds: (owner, lng, lat) => {
    const side = record.sides.findIndex((members) => members.includes(owner));
    const holder = holderAt(record, lng, lat);
    return holder === 0 || holder === 1 ? holder === side : null;
  },
});

test("golden probes for an engineer and what a viewer is sent", () => {
  for (const [at, step] of [0.25, 0.4].entries()) {
    const world = syntheticMap({ layout: Array.from({ length: 6 }, () => "AAAAAABBBBBB"), legend, west: 20, north: 54, step, stepLat: step * 0.8, key: `golden-engineer-${at}` });
    const { battlefields } = runFronts(frontInput(world, { arenas: new Map(), staff: true, troops: 1, days: 8, strengthOf: (name) => (name === "Aland" ? 6 : 2) }));
    const slim = battlefields.map((record) => ({ ...record, replay: null, contested: [], log: [], brief: { strength: record.brief.strength, carry: record.brief.carry, commands: record.brief.commands } }));
    const [record] = slim;
    for (const side of [0, 1]) {
      frontLineFor(record, side);
      frontLineFor(record, side, { behindKm: 60, mostKm: 80 });
    }
    frontLineFor({ ...record, frame: null }, 0);
    const chart = chartOf(record);
    const base = { battlefields: slim, fortifications: [], countryStats: { Aland: { population: { total: 6e7 } }, Borduria: { population: { total: at === 0 ? 2e7 : 4e5 } } } };
    const first = engineerLines(base, { date: "2024-03-15", chart });
    engineerLines(first.world, { date: "2024-03-20", chart });
    engineerLines(base, { date: "2024-03-15", chart, players: ["Borduria"] });
    engineerLines(base, { date: "2024-03-15", chart: null });
    engineerLines({ ...base, battlefields: slim.map((entry) => ({ ...entry, status: "frozen" })) }, { date: "2024-03-15", chart });
    for (const viewer of ["Aland", "borduria", "Neutralia", ""]) battlefieldForViewer(slim[0], viewer);
    battlefieldsForViewer([...slim, null, "text"], "Aland");
  }
});
