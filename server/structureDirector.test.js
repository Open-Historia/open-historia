/*! Open Historia — portions (tests for the native structure director's rules) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  STRUCTURE_BUILDS_PER_TURN,
  buildStructureDirectorInput,
  directGeneratedStructureOps,
  eventNeedsStructureDirector,
} from "../src/Game/AI/nativeStructureDirector.js";
import { linkStructuresToProjects } from "../src/runtime/gameState.js";

// The director names the structures events built; these rules decide which of
// them reach the map. Placement has already turned `at` into coordinates by the
// time the rules run, so the fixtures carry coordinates.

const event = (id, title, description = "", impacts = {}) => ({ id, date: "2016-05-01", title, description, impacts: { markerOps: [], ...impacts } });

const events = [
  event("e0", "Cabinet reviews the defence budget", "Ministers met to discuss spending."),
  event("e1", "GCHQ opens a quantum data centre in Ottawa", "The new data centre went online this week as part of Project Turing."),
  event("e2", "Second batch of Project Argus satellites launched", "Six satellites reached orbit and the new ground station at Ascension began operations."),
];

const world = {
  markers: [{ id: "m1", name: "Faslane Naval Base", kind: "naval base", ownerCode: "British Empire", lng: -4.8, lat: 56.07 }],
  projects: [
    { id: "p-turing", name: "Project Turing", status: "active", progress: 80, linkedMarkerIds: [] },
    { id: "p-argus", name: "Project Argus", status: "active", progress: 70, linkedMarkerIds: [] },
  ],
};

let serial = 0;
const makeId = () => `s${++serial}`;
const structure = (fields) => ({ kind: "data centre", ownerCode: "British Empire", status: "active", lng: -75.7, lat: 45.4, ...fields });
const run = (orders, extra = {}) => directGeneratedStructureOps({
  events,
  world,
  playerCountry: "British Empire",
  makeId,
  analyzeBatch: async () => ({ payload: { eventOrders: orders, summary: "" } }),
  ...extra,
});

test("only an event that says something was built or opened asks the director", () => {
  assert.equal(eventNeedsStructureDirector(events[0]), false);
  assert.equal(eventNeedsStructureDirector(events[1]), true);
  assert.equal(eventNeedsStructureDirector(events[2]), true);
  const input = buildStructureDirectorInput({ events, world, playerCountry: "British Empire" });
  assert.deepEqual(input.candidates.map((candidate) => candidate.eventIndex), [1, 2]);
  assert.equal(input.budget, STRUCTURE_BUILDS_PER_TURN);
  assert.deepEqual(input.projects.map((project) => project.id), ["p-turing", "p-argus"]);
  assert.equal(buildStructureDirectorInput({ events: [events[0]], world }), null);
});

test("a structure the event built lands on that event, linked to its Project", async () => {
  const { events: next, links } = await run([{ eventIndex: 1, structures: [structure({ name: "Ottawa Quantum Data Centre", projectId: "p-turing" })] }]);
  const [op] = next[1].impacts.markerOps;
  assert.equal(op.op, "build");
  assert.equal(op.marker.name, "Ottawa Quantum Data Centre");
  assert.equal(op.marker.foundedAt, "2016-05-01");
  assert.deepEqual(links, [{ markerId: op.marker.id, projectId: "p-turing" }]);
  assert.equal(next[0], events[0], "events the director did not build on are untouched");
});

test("a satellite gets no marker, but its ground station does", async () => {
  const { events: next } = await run([{
    eventIndex: 2,
    structures: [
      structure({ name: "Argus-7 Satellite", kind: "reconnaissance satellite" }),
      structure({ name: "Argus Constellation", kind: "satellite constellation" }),
      structure({ name: "Ascension Island Ground Station", kind: "satellite ground station", lng: -14.4, lat: -7.9 }),
    ],
  }]);
  assert.deepEqual(next[2].impacts.markerOps.map((op) => op.marker.name), ["Ascension Island Ground Station"]);
});

test("no duplicates, no unplaced structures, nothing that is not a place, and no builds on a paperwork event", async () => {
  const { events: next } = await run([
    { eventIndex: 0, structures: [structure({ name: "Budget Office" })] },
    {
      eventIndex: 1,
      structures: [
        structure({ name: "faslane naval base", kind: "naval base" }),
        structure({ name: "Nowhere Data Centre", lng: undefined, lat: undefined }),
        structure({ name: "Project Turing", kind: "research programme" }),
        structure({ name: "Ottawa Quantum Data Centre" }),
        structure({ name: "Ottawa Quantum Data Centre" }),
      ],
    },
  ]);
  assert.equal(next[0].impacts.markerOps.length, 0);
  assert.deepEqual(next[1].impacts.markerOps.map((op) => op.marker.name), ["Ottawa Quantum Data Centre"]);
});

test("at most five new structures a turn, counting the simulator's own", async () => {
  const busy = [
    ...events.slice(0, 2),
    event("e3", "Shipyard opens at Rosyth", "The new shipyard was completed.", {
      markerOps: [{ op: "build", marker: { name: "Rosyth Yard", kind: "shipyard", lng: -3.4, lat: 56.03 } }],
    }),
  ];
  const input = buildStructureDirectorInput({ events: busy, world });
  assert.equal(input.budget, STRUCTURE_BUILDS_PER_TURN - 1);
  const { events: next } = await run(
    [{ eventIndex: 1, structures: Array.from({ length: 7 }, (_, index) => structure({ name: `Site ${index}` })) }],
    { events: busy },
  );
  assert.equal(next[1].impacts.markerOps.length, STRUCTURE_BUILDS_PER_TURN - 1);
});

test("a failed analysis leaves the events as they were", async () => {
  const { events: next, links } = await run(null, { analyzeBatch: async () => { throw new Error("offline"); } });
  assert.equal(next, events);
  assert.deepEqual(links, []);
});

test("links join the Project only for a structure that reached the map", () => {
  const built = {
    ...world,
    markers: [...world.markers, { id: "s-new", name: "Ottawa Quantum Data Centre", kind: "data centre", lng: -75.7, lat: 45.4 }],
  };
  const linked = linkStructuresToProjects(built, [
    { markerId: "s-new", projectId: "p-turing" },
    { markerId: "s-missing", projectId: "p-argus" },
    { markerId: "s-new", projectId: "p-gone" },
  ]);
  assert.deepEqual(linked.projects.find((project) => project.id === "p-turing").linkedMarkerIds, ["s-new"]);
  assert.deepEqual(linked.projects.find((project) => project.id === "p-argus").linkedMarkerIds, []);
  assert.equal(linkStructuresToProjects(built, []), built);
});
