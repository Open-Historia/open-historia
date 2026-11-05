/*! Open Historia — battlefields and fronts: a staff's rehearsals touch nothing of the war: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/mind/isolation.test.js
//
// The staff that looks ahead (planner.js) tries each of its plans out on a COPY
// of the battle before it gives any orders (engine.js rehearsal). Nothing of the
// real battle or of the real run may change while it does. The walls did: the
// copy kept the real run as the run of its walls, and the first day of every
// rehearsal wore and broke the real lines, so walls fell many times faster in a
// war the planner led (found 2026-10-15). This looks at everything reachable
// from the battle and the run before and after each of its looks, with every
// mechanic of the engine on, walls and air among them.

import test from "node:test";
import assert from "node:assert/strict";

import { runFronts } from "../engine.js";
import { frontInput, syntheticMap } from "../syntheticMap.js";
import { createPlanner } from "./planner.js";

const legend = { A: "Aland", B: "Borduria" };
const CITIES = [
  { name: "Westburg", lng: 21.4, lat: 51.2, population: 300000, capital: true },
  { name: "Eastholm", lng: 26.6, lat: 50.8, population: 250000, capital: true },
  { name: "Midford", lng: 23.5, lat: 51.4, population: 80000 },
  { name: "Lowmarsh", lng: 24.6, lat: 50.3, population: 60000 },
];
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities: CITIES, key: "isolation" });
const EVERY_MECHANIC = { fatigue: true, weather: true, terrain: true, walls: true, muster: true, military: true, air: true, supply: true, attrition: true };
// Borduria's wall a little inside its border, low enough for Aland's pushes, rehearsed or not, to wear it.
const WALL = { id: "wall", name: "The Wall", owner: "Borduria", level: 3, points: [[24.4, 52.2], [24.4, 49.8]], breaches: [], wear: [] };

// Everything reachable from a value, as path -> a print of what is there (functions left out, cycles cut).
const printOf = (root, label) => {
  const out = new Map();
  const seen = new Map();
  const walk = (value, path, depth) => {
    if (value === null || typeof value !== "object") {
      if (typeof value !== "function") out.set(path, typeof value === "number" && Number.isNaN(value) ? "NaN" : String(value));
      return;
    }
    if (seen.has(value)) {
      out.set(path, `@${seen.get(value)}`);
      return;
    }
    seen.set(value, path);
    if (depth > 8) return;
    if (ArrayBuffer.isView(value)) {
      let hash = 0;
      for (let at = 0; at < value.length; at += 1) hash = (Math.imul(hash, 31) + Math.round(Number(value[at]) * 1000)) | 0;
      out.set(path, `${value.constructor.name}(${value.length})#${hash}`);
      return;
    }
    if (value instanceof Map) {
      out.set(`${path}.size`, String(value.size));
      for (const [key, item] of value) walk(item, `${path}<${typeof key === "object" ? "object" : String(key)}>`, depth + 1);
      return;
    }
    if (value instanceof Set) {
      out.set(path, `Set(${value.size}):${[...value].filter((item) => typeof item !== "object").join(",")}`);
      return;
    }
    for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`, depth + 1);
  };
  walk(root, label, 0);
  return out;
};
const changesBetween = (before, after) => {
  const changed = [];
  for (const [path, value] of after) if (before.get(path) !== value) changed.push(`${path}: ${before.get(path)} -> ${value}`);
  for (const path of before.keys()) if (!after.has(path)) changed.push(`${path}: gone`);
  return changed;
};

test("a look of the staff that looks ahead changes nothing of the real battle or run, with every mechanic on", () => {
  const planner = createPlanner({ ahead: 3 });
  let looks = 0;
  const changed = [];
  const watching = (battle, side, context, run) => {
    const before = [printOf(battle, "battle"), printOf(run, "run")];
    const said = planner(battle, side, context, run);
    looks += 1;
    const after = [printOf(battle, "battle"), printOf(run, "run")];
    for (const line of [...changesBetween(before[0], after[0]), ...changesBetween(before[1], after[1])]) changed.push(`day ${battle.daysRun}, side ${side}: ${line}`);
    return said;
  };
  watching.often = true;
  const result = runFronts(frontInput(sheet(), {
    arenas: new Map(),
    staff: true,
    troops: 1,
    days: 20,
    // (Aland far the stronger: its staff's plans push, and pushes reach the wall.)
    strengthOf: (name) => (name === "Aland" ? 9 : 3),
    staffPolicy: watching,
    mechanics: EVERY_MECHANIC,
    fortifications: [WALL],
    airArms: true,
    climateSeed: "isolation",
  }));
  assert.ok(result.battlefields.length > 0);
  assert.ok((result.fortifications ?? []).length > 0, "the wall is worn in the war itself, so that a rehearsal would wear it too");
  assert.ok(looks >= 6, `${looks} looks`);
  assert.deepEqual(changed.slice(0, 20), [], `${changed.length} change(s) made by looking`);
});
