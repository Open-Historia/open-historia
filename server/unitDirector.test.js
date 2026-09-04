import test from "node:test";
import assert from "node:assert/strict";

import {
  directGeneratedUnitOps,
  eventNeedsNativeUnitDirector,
} from "../src/Game/AI/nativeUnitDirector.js";

// The director only decides intent for existing formations; the unit engine
// moves them. These tests pin the deterministic gate between the two: what a
// proposed operation must satisfy before it may ride on an event.

const units = [
  { id: "u1", name: "1st Army", type: "infantry", ownerCode: "Ruritania", strength: 100, lng: 10, lat: 50 },
  { id: "u2", name: "Guards Corps", type: "armor", ownerCode: "Borduria", strength: 90, lng: 10.6, lat: 50.3 },
];

const events = [
  {
    id: "e0",
    date: "1930-05-01",
    title: "Parliament passes the budget",
    description: "The finance bill clears both chambers after a short debate.",
    impacts: { unitOps: [] },
  },
  {
    id: "e1",
    date: "1930-05-04",
    title: "Ruritanian 1st Army advances toward the frontier",
    description: "The army redeploys forward and establishes positions facing Borduria.",
    impacts: { unitOps: [] },
  },
  {
    id: "e2",
    date: "1930-05-09",
    title: "Border clash at the Zenda crossing",
    description: "Ruritanian and Bordurian forces exchange fire for two days; the 1st Army takes heavy casualties before both sides pull back.",
    impacts: { unitOps: [] },
  },
  {
    id: "e3",
    date: "1930-05-12",
    title: "Ruritania raises a new army corps",
    description: "The government mobilizes its reserves and a new corps forms at Strelsau.",
    impacts: { unitOps: [] },
  },
];

const run = async (eventOrders, options = {}) => {
  let seen = null;
  const directed = await directGeneratedUnitOps({
    events,
    game: { gameDate: "1930-05-12", round: 4 },
    world: { units },
    analyzeBatch: async (batch) => {
      seen = batch;
      return { payload: { eventOrders, summary: "test" } };
    },
    ...options,
  });
  return { directed, seen };
};

test("only operational military events are offered to the director", async () => {
  const { seen } = await run([]);
  assert.deepEqual(seen.candidates.map((candidate) => candidate.eventIndex), [1, 2, 3]);
  assert.deepEqual(seen.units.map((unit) => unit.id), ["u1", "u2"]);

  assert.equal(eventNeedsNativeUnitDirector({
    title: "Allied Commands Reinforce Missile-Defense Readiness",
    description: "Commands improve surveillance and radar data-sharing while maintaining heightened readiness.",
  }), false);
  assert.equal(eventNeedsNativeUnitDirector({
    title: "Army Redeploys Two Brigades to the Border",
    description: "Two brigades redeploy toward the frontier and establish forward positions.",
  }), true);
});

test("plausible moves, narrated casualties and new formations are attached; the rest is dropped", async () => {
  const { directed } = await run([
    { eventIndex: 0, unitOps: [{ op: "move", unitId: "u1", toLng: 10.2, toLat: 50.1 }] },
    {
      eventIndex: 1,
      unitOps: [
        { op: "move", unitId: "u1", toLng: 10.4, toLat: 50.2, posture: "massing", note: "forward positions" },
        { op: "move", unitId: "u2", toLng: 60, toLat: 20, note: "a continent away" },
        { op: "move", unitId: "ghost", toLng: 10.4, toLat: 50.2 },
      ],
    },
    {
      eventIndex: 2,
      unitOps: [
        { op: "strength", unitId: "u1", strength: 70, note: "heavy casualties at the crossing" },
        { op: "attack", unitId: "u1", targetUnitId: "u2" },
        { op: "remove", unitId: "u2", note: "pulled back" },
      ],
    },
    {
      eventIndex: 3,
      unitOps: [
        { op: "spawn", unit: { name: "2nd Corps", type: "infantry", ownerCode: "Ruritania", strength: 80, composition: "reservists", lng: 11, lat: 49.5 } },
        { op: "spawn", unit: { name: "Bordurian Reserve", type: "infantry", ownerCode: "Borduria", strength: 60, composition: "reserve", lng: 12, lat: 51 } },
      ],
    },
  ]);

  assert.deepEqual(directed[0].impacts.unitOps, [], "a political event never receives unit operations");

  const advance = directed[1].impacts.unitOps;
  assert.equal(advance.length, 1, "the local move survives; the intercontinental move and the unknown unit do not");
  assert.equal(advance[0].unitId, "u1");
  assert.equal(advance[0].posture, "massing", "posture rides with the move for the unit engine");

  const clash = directed[2].impacts.unitOps;
  assert.deepEqual(clash.map((op) => op.op), ["strength"], "narrated casualties pass; attack is not an op on this build; a pull-back is not destruction");
  assert.equal(clash[0].strength, 70);

  const spawns = directed[3].impacts.unitOps;
  assert.equal(spawns.length, 2, "an explicit new formation cue admits the spawns");
  assert.equal(spawns[0].unit.name, "2nd Corps");
});

test("existing simulator operations are kept and never duplicated, and a silent director changes nothing", async () => {
  const withOps = events.map((event, index) => index === 1
    ? { ...event, impacts: { unitOps: [{ op: "move", unitId: "u1", toLng: 10.4, toLat: 50.2 }] } }
    : event);
  const directed = await directGeneratedUnitOps({
    events: withOps,
    game: { gameDate: "1930-05-12", round: 4 },
    world: { units },
    analyzeBatch: async () => ({ payload: { eventOrders: [
      { eventIndex: 1, unitOps: [{ op: "move", unitId: "u1", toLng: 10.4, toLat: 50.2 }] },
    ], summary: "" } }),
  });
  assert.equal(directed[1].impacts.unitOps.length, 1, "the same move proposed twice stays one operation");

  const untouched = await directGeneratedUnitOps({
    events,
    game: { gameDate: "1930-05-12", round: 4 },
    world: { units },
    analyzeBatch: async () => { throw new Error("provider down"); },
  });
  assert.deepEqual(untouched, events, "a failed analysis preserves the events exactly");

  const noAnalyzer = await directGeneratedUnitOps({ events, game: {}, world: { units } });
  assert.deepEqual(noAnalyzer, events);
});
