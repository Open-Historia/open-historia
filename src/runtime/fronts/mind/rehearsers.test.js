/*! Open Historia — battlefields and fronts: a staff's plans fought on other cores: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/mind/rehearsers.test.js
//
// "do the multi-core rehearsals too" (the owner, 2026-10-16). The staff that
// looks ahead (planner.js) may have its plans fought on other cores
// (rehearsers.js): each is sent the battle and the run as data
// (engine.js rehearsalPacket), rebuilds them (rehearsalBase) and fights a plan
// on a copy exactly as the staff would. The promise is that it is the same war:
// a run whose plans were weighed on other cores comes out as one whose plans
// were weighed on its own core, to the last character. The cores here are of
// the test's own making, every message copied as a worker's would be.

import test from "node:test";
import assert from "node:assert/strict";

import { createFrontRun, runFronts } from "../engine.js";
import { frontInput, syntheticMap } from "../syntheticMap.js";
import { createPlanner } from "./planner.js";
import { REHEARSERS_MOST, answerRehearsal, createRehearsers, rehearserCount } from "./rehearsers.js";

const legend = { A: "Aland", B: "Borduria" };
const CITIES = [
  { name: "Westburg", lng: 21.4, lat: 51.2, population: 300000, capital: true },
  { name: "Eastholm", lng: 26.6, lat: 50.8, population: 250000, capital: true },
  { name: "Midford", lng: 23.5, lat: 51.4, population: 80000 },
  { name: "Lowmarsh", lng: 24.6, lat: 50.3, population: 60000 },
];
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities: CITIES, key: "rehearsers" });
const EVERY_MECHANIC = { fatigue: true, weather: true, terrain: true, walls: true, muster: true, military: true, air: true, supply: true, attrition: true };
const WALL = { id: "wall", name: "The Wall", owner: "Borduria", level: 3, points: [[24.4, 52.2], [24.4, 49.8]], breaches: [], wear: [] };
const FIGURES = { Aland: { quality: 65, technology: 60, land: 70, sea: 40, air: 60 }, Borduria: { quality: 45, technology: 55, land: 55, sea: 50, air: 45 } };
// A war with every mechanic on: walls to wear, air arms to send, each side's own figures.
const war = (extra = {}) => frontInput(sheet(), {
  arenas: new Map(),
  staff: true,
  troops: 1,
  days: 16,
  strengthOf: (name) => (name === "Aland" ? 9 : 4),
  mechanics: EVERY_MECHANIC,
  fortifications: [WALL],
  airArms: true,
  climateSeed: "rehearsers",
  militaryOf: (name) => FIGURES[name] ?? null,
  ...extra,
});

// A core of the test's own: answers as a worker does (rehearserWorker.js), a turn of the event loop later, every
// message copied there and back. `fail` makes it fail at its first plan.
const testCore = ({ fail = false } = {}) => {
  const state = { look: null };
  const core = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    gone: false,
    postMessage(message) {
      const sent = structuredClone(message);
      setImmediate(() => {
        if (core.gone) return;
        if (fail && sent.kind === "job") {
          core.onerror?.(new Error("the core failed"));
          return;
        }
        const reply = answerRehearsal(state, sent);
        if (reply) core.onmessage?.({ data: structuredClone(reply) });
      });
    },
    terminate() {
      core.gone = true;
    },
  };
  return core;
};

// A run taken a step at a time, waiting where a step is to be waited for, as Game/AI/frontTurn.js advanceIn does.
const fightWaiting = async (input) => {
  const run = createFrontRun(input);
  const steps = run.steps(Infinity);
  let reply;
  let waits = 0;
  for (let step = steps.next(); !step.done; step = steps.next(reply)) {
    reply = undefined;
    if (typeof step.value?.wait === "function") {
      waits += 1;
      reply = await step.value.wait();
    }
  }
  return { result: run.finish(), waits };
};

test("a war whose staff's plans are fought on other cores is the same war, to the last character", async () => {
  const alone = runFronts(war({ staffPolicy: createPlanner({ ahead: 3 }) }));
  const weighed = [];
  const pool = createRehearsers({ size: 3, spawn: () => testCore(), idleMs: 0 });
  const counted = { weigh: async (look, jobs) => {
    const values = await pool.weigh(look, jobs);
    weighed.push(...values);
    return values;
  } };
  const { result, waits } = await fightWaiting(war({ staffPolicy: createPlanner({ ahead: 3 }), rehearsers: counted }));
  pool.close();
  assert.ok(alone.battlefields.length > 0);
  assert.equal(JSON.stringify(result), JSON.stringify(alone));
  assert.ok(waits >= 4, `${waits} looks' plans sent away`);
  assert.ok(weighed.length >= 20, `${weighed.length} plans fought on the other cores`);
  assert.deepEqual(weighed.filter((value) => typeof value !== "number"), [], "every one of them had there");
});

test("a run taken without waiting fights every plan on its own core, and it is the same war", () => {
  let asked = 0;
  const never = { weigh: async () => { asked += 1; return []; } };
  const alone = runFronts(war({ staffPolicy: createPlanner({ ahead: 2 }) }));
  assert.equal(JSON.stringify(runFronts(war({ staffPolicy: createPlanner({ ahead: 2 }), rehearsers: never }))), JSON.stringify(alone));
  assert.equal(asked, 0, "nothing is sent where nobody waits for it");
});

test("plans the cores do not have are fought on the run's own core: the same war whatever they could do", async () => {
  const alone = runFronts(war({ staffPolicy: createPlanner({ ahead: 2 }) }));
  // Cores that fail, cores that cannot be made, cores that answer nothing: every plan is fought here instead.
  for (const pool of [
    createRehearsers({ size: 2, spawn: () => testCore({ fail: true }), idleMs: 0 }),
    createRehearsers({ size: 2, spawn: () => { throw new Error("no workers here"); }, idleMs: 0 }),
    { weigh: async (look, jobs) => jobs.map(() => null) },
  ]) {
    const { result } = await fightWaiting(war({ staffPolicy: createPlanner({ ahead: 2 }), rehearsers: pool }));
    pool.close?.();
    assert.equal(JSON.stringify(result), JSON.stringify(alone));
  }
});

test("the pool gives each free core the next plan, answers in the order asked, and has nothing of a core that failed", async () => {
  const sent = [];
  let made = 0;
  const pool = createRehearsers({
    size: 2,
    idleMs: 0,
    spawn: () => {
      made += 1;
      const failing = made === 2;
      const core = { onmessage: null, onerror: null, postMessage(message) {
        sent.push([failing ? "second" : "first", message.kind, message.at ?? -1]);
        if (message.kind !== "job") return;
        setImmediate(() => (failing ? core.onerror?.() : core.onmessage?.({ data: { kind: "value", id: message.id, at: message.at, value: message.job.value } })));
      }, terminate() {} };
      return core;
    },
  });
  const values = await pool.weigh({ packet: null }, [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]);
  // The second core failed at its first plan: that one is not had; the first core takes every other.
  assert.deepEqual(values, [1, null, 3, 4]);
  assert.deepEqual(sent.filter(([, kind]) => kind === "look").map(([core]) => core), ["first", "second"], "each core is sent the look once");
  assert.deepEqual(sent.filter(([core, kind]) => core === "first" && kind === "job").map(([, , at]) => at), [0, 2, 3]);
  // Looks asked together are weighed one after the other, each answered in its own order.
  const [a, b] = await Promise.all([pool.weigh({}, [{ value: 5 }]), pool.weigh({}, [{ value: 6 }, { value: 7 }])]);
  assert.deepEqual([a, b], [[5], [6, 7]]);
  // Closed, it has nothing.
  pool.close();
  assert.deepEqual(await pool.weigh({}, [{ value: 8 }]), [null]);
});

test("how many cores: two are left to the page and the run, none on a machine of fewer than four", () => {
  assert.equal(rehearserCount(16), REHEARSERS_MOST);
  assert.equal(rehearserCount(8), 6);
  assert.equal(rehearserCount(4), 2);
  assert.equal(rehearserCount(3), 0);
  assert.equal(rehearserCount(undefined), 0);
});
