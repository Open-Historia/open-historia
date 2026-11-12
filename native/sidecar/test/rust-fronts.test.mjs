import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFrontRun } from "../../../src/runtime/fronts/engine.js";
import { runFrontTurn } from "../../../src/Game/AI/frontTurn.js";
import { frontInput, syntheticMap } from "../../../src/runtime/fronts/syntheticMap.js";
import * as planner from "../../../src/runtime/fronts/mind/planner.js";
import * as policies from "../../../src/runtime/fronts/mind/policy.js";
import { labStaffPolicy, shippedPlannerParams } from "../../../src/runtime/fronts/mind/trained.js";
import { commanderOf } from "../../../src/runtime/fronts/mind/commanders.js";
import { createFrontsHost, decode as decodeWire, encode, firstDifference, frontsHostPath, ruledBy, rustRunMaker } from "../rustFronts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const host = frontsHostPath();
const fixture = path.join(here, "..", "..", "engine", "crates", "ohfronts", "tests", "golden", "engine.json");
const READERS = ["controllerOf", "sovereignOf", "isGroup", "strengthOf", "shortageOf", "militaryOf", "musterOf", "peopleOf", "groupOwnerOf"];

const labStaff = (config = {}) => {
  const lead = { trained: planner.createPlanner({ params: shippedPlannerParams() }), plainer: planner.createPlainerPlanner(), thorough: planner.createPlanner({ params: shippedPlannerParams(), replies: true }) };
  const leadOf = (battle, side) => lead[commanderOf({ sides: battle?.sides, side, outcomes: config.outcomes ?? [], difficulty: config.difficulty ?? "medium", players: config.players ?? [] })];
  const policy = (battle, side, context, run) => leadOf(battle, side)(battle, side, context, run);
  policy.steps = function* steps(battle, side, context, run) {
    return yield* leadOf(battle, side).steps(battle, side, context, run);
  };
  policy.often = true;
  return policy;
};
const MADE = {
  "mindPlanner.createPlanner": (options) => planner.createPlanner({ ...(options ?? {}), memo: null }),
  "mindPlanner.createPlainerPlanner": (options) => planner.createPlainerPlanner({ ...(options ?? {}), memo: null }),
  "mindTrained.labStaffPolicy": labStaff,
  "mindTrained.trainedStaffPolicy": () => planner.createPlanner({ params: shippedPlannerParams() }),
  "mindPolicy.createStaffPolicy": policies.createStaffPolicy,
  "mindPolicy.createTroopPolicy": policies.createTroopPolicy,
};
const TYPED = { U8: Uint8Array, U8C: Uint8ClampedArray, I8: Int8Array, U16: Uint16Array, I16: Int16Array, U32: Uint32Array, I32: Int32Array, F32: Float32Array, F64: Float64Array };

const recorded = () => {
  const file = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const raw = (node) => (node && node.$ === "ref" ? raw(file.blobs[node.k]) : node);
  const decode = (node, ids) => {
    if (Array.isArray(node)) return node.map((item) => decode(item, ids));
    if (!node || typeof node !== "object") return node;
    if (typeof node.$ !== "string") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, decode(value, ids)]));
    switch (node.$) {
      case "u": return undefined;
      case "NaN": return NaN;
      case "Inf": return Infinity;
      case "-Inf": return -Infinity;
      case "-0": return -0;
      case "fn": {
        if (!node.by || !MADE[node.by]) return () => undefined;
        const args = decode(node.a ?? [], ids) ?? [];
        return ruledBy(MADE[node.by](...args), node.by, args);
      }
      case "cyc": return null;
      case "S16": return String.fromCharCode(...node.v);
      case "ref": return decode(file.blobs[node.k], ids);
      case "id": {
        const value = decode(node.v, ids);
        ids.set(node.n, value);
        return value;
      }
      case "same": return ids.get(node.n);
      case "made":
      case "O": return decode(node.v, ids);
      case "Map": return new Map(raw(node.v).map((pair) => raw(pair)).map(([key, value]) => [decode(key, ids), decode(value, ids)]));
      case "Set": return new Set(raw(node.v).map((value) => decode(value, ids)));
      default: {
        const Type = TYPED[node.$];
        if (node.v) return Type.from(node.v.map((value) => decode(value, ids)));
        if (node.r) {
          const out = [];
          for (let at = 0; at < node.r.length; at += 2) for (let count = 0; count < node.r[at + 1]; count += 1) out.push(decode(node.r[at], ids));
          return Type.from(out);
        }
        const bytes = Buffer.from(node.b, "base64");
        return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
    }
  };
  return (file.cases.runFronts ?? []).map((item) => () => {
    const input = decode(item.a, new Map())[0];
    const kept = input.arenas instanceof Map && [...input.arenas.values()].some((value) => value !== true && !Array.isArray(value));
    const by = raw(raw(raw(item.a)?.[0])?.staffPolicy);
    const led = Boolean(by && by.$ === "fn" && by.by && MADE[by.by]);
    if ((typeof input.staffPolicy === "function" && !led) || (kept && !Array.isArray(input.map?.regions))) return null;
    for (const key of Object.keys(input)) if (typeof input[key] === "function" && key !== "staffPolicy") delete input[key];
    delete input.rehearsers;
    if (input.arenas instanceof Map) input.arenas = new Map([...input.arenas].filter(([, value]) => value === true || Array.isArray(value)));
    for (const reader of READERS) {
      const calls = item.cb?.[`0.${reader}`];
      if (!calls) continue;
      const table = new Map();
      for (const [args, result] of calls) {
        const key = String(decode(args, new Map())[0]);
        if (!table.has(key)) table.set(key, decode(result, new Map()));
      }
      input[reader] = (asked) => table.get(String(asked));
    }
    return input;
  });
};

const pause = async () => {};
const inJs = (input) => runFrontTurn({ createFrontRun, input, pause });
const inRust = async (engine, input) => {
  const maker = rustRunMaker(engine);
  try {
    return await runFrontTurn({ createFrontRun: maker.createFrontRun, input, pause });
  } finally {
    maker.release();
  }
};

test("the wire carries what JavaScript has and Rust gives back the same", { skip: !host && "no ohfronts-host build" }, async () => {
  const value = { a: undefined, b: [1, -0, NaN, Infinity, -Infinity, null, undefined], c: new Map([["k", true], ["l", [1, 2]]]), d: new Set(["x"]), e: new Uint8Array([1, 2, 255]), f: new Float64Array([0.1, -2.5e-300]), g: { $: "dollar", h: "é \n\"" }, "10": 1, "2": 2 };
  assert.equal(firstDifference(decodeWire(encode(value)), value), "");
});

test("recorded front runs come out the same through the Rust host as in JavaScript", { skip: !host && "no ohfronts-host build" }, async () => {
  const engine = createFrontsHost({ file: host });
  try {
    let compared = 0;
    let led = 0;
    for (const [index, make] of recorded().entries()) {
      if (!make()) continue;
      const want = await inJs(make());
      const input = make();
      const got = await inRust(engine, input);
      assert.equal(firstDifference(got, want), "", `runFronts#${index}`);
      compared += 1;
      if (typeof input.staffPolicy === "function") led += 1;
    }
    assert.ok(compared >= 20, `${compared} runs compared`);
    assert.ok(led >= 3, `${led} led runs compared`);
  } finally {
    engine.close();
  }
});

const legend = { A: "Aland", B: "Borduria" };
const CITIES = [
  { name: "Aland Capital", lng: 21.5, lat: 51.25, population: 900000, capital: true },
  { name: "Westford", lng: 23.5, lat: 50.75, population: 60000 },
  { name: "Borduria Capital", lng: 26.5, lat: 51.25, population: 800000, capital: true },
  { name: "Eastmarch", lng: 24.5, lat: 50.25, population: 150000 },
];
const wide = () => syntheticMap({
  layout: ["AAAAAAABBBBBBB", "AAAAAABBBBBBBB", "AAAAAAABBBBBBB", "AAAAABBBBBBBBB", "AAAAAAABBBBBBB", "AAAAAABBBBBBBB"],
  legend,
  west: 14,
  north: 53,
  step: 1,
  stepLat: 0.5,
  cities: [...CITIES, { name: "Northgate", lng: 16.5, lat: 52.75, population: 220000 }, { name: "Southmere", lng: 30.5, lat: 50.25, population: 120000 }],
  key: "planner-wide",
});
const MECHANICS = { fatigue: true, weather: true, supply: true, attrition: true };

test("a heavy war led by the staff that looks ahead comes out the same in Rust, and the cache it keeps between runs changes nothing", { skip: !host && "no ohfronts-host build" }, async () => {
  const engine = createFrontsHost({ file: host });
  try {
    const world = wide();
    const config = { difficulty: "hard", players: ["Borduria"] };
    const war = (arenas) => frontInput(world, { arenas, staff: true, troops: 1, days: 30, strengthOf: () => 4, mechanics: MECHANICS, climateSeed: "planner", seed: "heavy-hard", players: ["Borduria"], staffPolicy: ruledBy(labStaffPolicy(config), "mindTrained.labStaffPolicy", [config]) });
    const jsArenas = new Map();
    const startedJs = performance.now();
    const want = await inJs(war(jsArenas));
    const jsMs = performance.now() - startedJs;
    const startedRust = performance.now();
    const got = await inRust(engine, war(new Map()));
    const rustMs = performance.now() - startedRust;
    assert.equal(firstDifference(got, want), "");
    assert.ok(Array.isArray(want?.battlefields) && want.battlefields.length > 0);
    const again = await inRust(engine, { ...war(new Map()), map: { ...world.map, regions: null } });
    const wantAgain = await inJs({ ...war(jsArenas), map: { ...world.map, regions: null } });
    assert.equal(firstDifference(again, wantAgain), "");
    console.log(`heavy led war: JavaScript ${jsMs.toFixed(0)} ms, Rust host ${rustMs.toFixed(0)} ms`);
  } finally {
    engine.close();
  }
});

test("a run called off stops the Rust host's run", { skip: !host && "no ohfronts-host build" }, async () => {
  const engine = createFrontsHost({ file: host });
  try {
    const world = wide();
    const maker = rustRunMaker(engine, { slice: 5 });
    let pauses = 0;
    const input = frontInput(world, { staff: true, troops: 1, days: 60, strengthOf: () => 4, mechanics: MECHANICS, seed: "called-off", staffPolicy: ruledBy(planner.createPlanner(), "mindPlanner.createPlanner", [{}]) });
    const stopping = async () => {
      pauses += 1;
      if (pauses === 2) maker.cancel();
    };
    await assert.rejects(runFrontTurn({ createFrontRun: maker.createFrontRun, input, pause: stopping }), (error) => error?.name === "AbortError");
    maker.release();
    const after = await inRust(engine, frontInput(world, { days: 3, seed: "after" }));
    assert.equal(firstDifference(after, await inJs(frontInput(world, { days: 3, seed: "after" }))), "");
  } finally {
    engine.close();
  }
});
