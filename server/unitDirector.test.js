import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUnitDirectorInput,
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

test("valid unit objectives, narrated casualties and new formations are attached; invalid identities and unsupported ops are dropped", async () => {
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
  assert.equal(advance.length, 2, "valid long-distance objectives survive for the unit engine to advance over time; only the unknown unit is dropped");
  assert.equal(advance[0].unitId, "u1");
  assert.equal(advance[0].posture, "massing", "posture rides with the move for the unit engine");
  assert.equal(advance[1].unitId, "u2", "distance alone no longer deletes a director objective");

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

test("Punic relocation prose reaches the actual director candidate set without turning ordinary politics into unit work", () => {
  const input = buildUnitDirectorInput({
    world: {
      units: [{
        id: "hannibal",
        name: "Army of Hannibal Barca",
        type: "infantry",
        ownerCode: "Carthaginian Empire",
        strength: 80,
        lng: 9.23,
        lat: 45.46,
      }],
    },
    events: [
      {
        date: "-0217-05-02",
        title: "Hannibal Barca Crosses the Apennines into Etruria",
        description: "Carthaginian commander Hannibal Barca leads his veteran army across the Apennine passes into Etruria.",
        impacts: { unitOps: [] },
      },
      {
        date: "-0217-09-01",
        title: "Hannibal Barca Establishes Camp in Apulia Following Coastal March",
        description: "Hannibal establishes encampments across Apulia, resting veteran troops after the coastal march.",
        impacts: { unitOps: [] },
      },
      {
        date: "-0217-09-02",
        title: "Senate Talks Reach Agreement on Grain Taxes",
        description: "Civilian negotiators conclude a fiscal compromise after a long political debate.",
        impacts: { unitOps: [] },
      },
    ],
  });

  assert.ok(input, "the relocation events should require Unit Director");
  assert.deepEqual(
    input.candidates.map((candidate) => candidate.eventIndex),
    [0, 1],
    "only the military relocation events should be offered",
  );
});

test("explicit story relocations from the Punic campaign are offered to the director", () => {
  const relocations = [
    "Hannibal Barca Crosses the Apennines into Etruria",
    "Carthaginian Army Completes Alpine Crossing and Enters Po Valley",
    "Hannibal Barca Marches Toward the Adriatic Coast",
    "Hannibal Barca Establishes Camp in Apulia Following Coastal March",
    "Hannibal Barca Reaches the Pyrenees Passes",
  ];
  for (const title of relocations) {
    assert.equal(
      eventNeedsNativeUnitDirector({ title, description: "" }),
      true,
      `expected a location-changing event to reach Unit Director: ${title}`,
    );
  }
});

test("a distant narrative objective is kept for the unit engine instead of being dropped by the director", async () => {
  const hannibal = {
    id: "hannibal",
    name: "Army of Hannibal Barca",
    type: "infantry",
    ownerCode: "Carthaginian Empire",
    strength: 80,
    lng: 9.23,
    lat: 45.46,
  };
  const [event] = [{
    id: "punic-march",
    date: "-0217-05-05",
    title: "Hannibal Barca Marches Southward Toward Central Italy",
    description: "Hannibal leads the veteran Carthaginian army south from Cisalpine Gaul toward Apulia.",
    impacts: { unitOps: [] },
  }];

  const directed = await directGeneratedUnitOps({
    events: [event],
    game: { gameDate: "-0217-05-05", round: 16 },
    world: { units: [hannibal] },
    analyzeBatch: async () => ({
      payload: {
        eventOrders: [{
          eventIndex: 0,
          unitOps: [{
            op: "move",
            unitId: "hannibal",
            toLng: 15.55,
            toLat: 41.45,
            posture: "transit",
            note: "Marching toward Apulia.",
          }],
          reason: "The event explicitly relocates Hannibal's army.",
        }],
        summary: "Hannibal's army receives its canonical southward objective.",
      },
    }),
  });

  assert.equal(directed[0].impacts.unitOps.length, 1, "the long objective must reach the canonical unit engine");
  assert.equal(directed[0].impacts.unitOps[0].op, "move");
  assert.equal(directed[0].impacts.unitOps[0].unitId, "hannibal");
  assert.equal(directed[0].impacts.unitOps[0].toLng, 15.55);
  assert.equal(directed[0].impacts.unitOps[0].toLat, 41.45);
});

// Seen in a live game (2026-09-19): an empire commissioning frigates, taking
// delivery of submarines and standing up squadrons for three game years never
// gained a single counter. Such an event was never offered to the director, and
// a spawn for a power that already had units needed army wording ("new corps").
const commissioning = [
  { title: "Royal Navy commissions two Type 45 destroyers into the fleet", description: "HMS Dauntless and HMS Diamond are commissioned at Portsmouth." },
  { title: "RAF stands up a new F-35 squadron at Marham", description: "No. 617 Squadron is formed with its first twelve aircraft." },
  { title: "Admiralty takes delivery of the first Astute-class submarine", description: "The boat enters service with the Clyde flotilla." },
  { title: "Carrier strike group formed around HMS Queen Elizabeth", description: "The task group is activated at Portsmouth." },
];
const notFormations = [
  { title: "British Admiralty Standardizes Global Shipyard Blueprints", description: "Shipyard construction standards are unified across imperial yards." },
  { title: "Ministry commissions a review of defence procurement", description: "An independent panel will report on procurement costs." },
  { title: "Tehran launches a diplomatic campaign at the UN", description: "Iranian envoys lobby member states over Gulf shipping." },
];

test("a warship commissioned or a squadron stood up is offered to the director; paperwork is not", () => {
  for (const event of commissioning) assert.equal(eventNeedsNativeUnitDirector(event), true, event.title);
  for (const event of notFormations) assert.equal(eventNeedsNativeUnitDirector(event), false, event.title);
});

test("a commissioned ship or a new squadron may spawn for a power that already has units", async () => {
  const fleet = [{ id: "n1", name: "Home Fleet", type: "naval", ownerCode: "British Empire", strength: 100, lng: -1, lat: 50.8 }];
  const directed = await directGeneratedUnitOps({
    events: commissioning.map((event, index) => ({ ...event, id: `c${index}`, date: "2016-08-01", kind: "military", impacts: { unitOps: [] } })),
    game: { gameDate: "2016-08-04", round: 20 },
    world: { units: fleet },
    analyzeBatch: async () => ({ payload: { eventOrders: [
      { eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "Type 45 Destroyer Group", type: "naval", ownerCode: "British Empire", strength: 100, lng: -1.1, lat: 50.8 } }] },
      { eventIndex: 1, unitOps: [{ op: "spawn", unit: { name: "No. 617 Squadron", type: "air", ownerCode: "British Empire", strength: 100, lng: 0.5, lat: 52.6 } }] },
    ], summary: "" } }),
  });
  assert.equal(directed[0].impacts.unitOps.length, 1, "a destroyer commissioned into the fleet is a new formation");
  assert.equal(directed[1].impacts.unitOps.length, 1, "a squadron stood up is a new formation");
});

test("a power with units still gains none from an event that forms nothing", async () => {
  const fleet = [{ id: "n1", name: "Home Fleet", type: "naval", ownerCode: "British Empire", strength: 100, lng: -1, lat: 50.8 }];
  const directed = await directGeneratedUnitOps({
    events: [{ id: "x", date: "2016-08-01", kind: "military", title: "Home Fleet sails to the Western Approaches", description: "The fleet redeploys for exercises.", impacts: { unitOps: [] } }],
    game: { gameDate: "2016-08-04", round: 20 },
    world: { units: fleet },
    analyzeBatch: async () => ({ payload: { eventOrders: [
      { eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "Second Home Fleet", type: "naval", ownerCode: "British Empire", strength: 100, lng: -6, lat: 49 } }] },
    ], summary: "" } }),
  });
  assert.deepEqual(directed[0].impacts.unitOps, [], "a fleet that is merely moving does not duplicate itself");
});
