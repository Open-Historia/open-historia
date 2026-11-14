/*! Open Historia — what the territory director is shown of the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nativeTerritoryDirector.state.test.js
//
// Runs without node_modules: nativeTerritoryDirector.js imports nothing.
//
// A live 30-day jump on the built-in scenario sent this narrow pass 215,000
// characters, five times (every lookup round re-sends the request): about a
// million characters, 40% of what the whole jump spent. Nearly all of it was
// regionOwnershipOverrides, which on a hand-drawn world has a row for EVERY
// region — 4,848 of `"2014": "Ukraine"`, a numeric id and an owner, no name,
// nothing a model can reason from. The pass needs the map's non-normal state,
// and the controller of each place its events name. These pin what it gets, that
// a quiet map costs almost nothing, and that it is never told to go and ask for
// something — asking is a request, and requests are what a free key runs out of.

import test from "node:test";
import assert from "node:assert/strict";

import {
  TERRITORIAL_STATE_ROW_CAP,
  buildTerritoryDirectorInput,
  directGeneratedTerritoryOps,
  summarizeTerritorialState,
  territoryCandidateText,
} from "./nativeTerritoryDirector.js";

const handDrawnWorld = (regionCount) => {
  const regionOwnershipOverrides = {};
  for (let id = 1; id <= regionCount; id += 1) regionOwnershipOverrides[String(id)] = id % 2 ? "Ukraine" : "Russian Federation";
  return { regionOwnershipOverrides, regionSovereigntyOverrides: {}, regionClaimants: {} };
};

test("a map at peace costs almost nothing, however many regions it has", () => {
  const world = handDrawnWorld(4848);
  const before = JSON.stringify({
    regionOwnershipOverrides: world.regionOwnershipOverrides,
    regionSovereigntyOverrides: world.regionSovereigntyOverrides,
    regionClaimants: world.regionClaimants,
  }, null, 2).length;
  const state = summarizeTerritorialState(world, []);
  const after = JSON.stringify(state).length;
  assert.deepEqual(state.regionOwnershipOverrides, {});
  assert.ok(after < 400, `a quiet map should be a few hundred characters, was ${after}`);
  assert.ok(before > 100000, `the old dump of the same world was ${before}`);
});

test("an occupied region keeps its controller, its sovereign and its claimants", () => {
  const world = handDrawnWorld(100);
  world.regionOwnershipOverrides["7"] = "Russian Federation";
  world.regionSovereigntyOverrides["7"] = "Ukraine";
  world.regionClaimants["7"] = ["Ukraine"];
  world.regionClaimants["9"] = ["Poland"]; // disputed, not occupied
  const state = summarizeTerritorialState(world, []);
  assert.deepEqual(state.regionOwnershipOverrides, { 7: "Russian Federation", 9: "Ukraine" });
  assert.deepEqual(state.regionSovereigntyOverrides, { 7: "Ukraine" });
  assert.deepEqual(state.regionClaimants, { 7: ["Ukraine"], 9: ["Poland"] });
  assert.equal("omittedRegions" in state, false);
});

test("the state never sends the analyzer off to ask for something: asking is a request", () => {
  const world = handDrawnWorld(20);
  world.regionSovereigntyOverrides["3"] = "Ukraine";
  for (const state of [
    summarizeTerritorialState(world, []),
    summarizeTerritorialState(world, [], { placesNamed: [] }),
    summarizeTerritorialState(world, [], { placesNamed: [{ place: "Crimea", kind: "region", regionId: "9", controller: "Russian Federation" }] }),
  ]) {
    assert.doesNotMatch(JSON.stringify(state), /find_region|region_info|look ?up|lookup/i);
  }
});

test("the places the events name are handed over with who controls them", () => {
  const places = [{ place: "Mariupol", kind: "city", regionId: "r-donetsk", region: "Donetsk Oblast", controller: "Ukraine" }];
  const state = summarizeTerritorialState(handDrawnWorld(4), [], { placesNamed: places });
  assert.deepEqual(state.placesTheseEventsName, places);
  assert.match(state.scope, /every place the events name with who controls it now/);
  // A copy, like the stores.
  state.placesTheseEventsName[0].controller = "Nobody";
  assert.equal(places[0].controller, "Ukraine");
  // Without a reader the state is what it always was: no empty field to puzzle over.
  assert.equal("placesTheseEventsName" in summarizeTerritorialState(handDrawnWorld(4), []), false);
});

test("the stores are copies, so the analyzer cannot reach back into the world", () => {
  const world = handDrawnWorld(4);
  world.regionClaimants["1"] = ["Poland"];
  const state = summarizeTerritorialState(world, []);
  state.regionClaimants["1"].push("Spain");
  assert.deepEqual(world.regionClaimants["1"], ["Poland"]);
});

test("when the cap bites, the front the events concern is what survives it, by their combatants and operations, in any language", () => {
  const world = handDrawnWorld(10);
  const total = TERRITORIAL_STATE_ROW_CAP + 50;
  // A long list of someone else's disputes first...
  for (let index = 0; index < total; index += 1) {
    world.regionOwnershipOverrides[`far-${index}`] = "Brazil";
    world.regionClaimants[`far-${index}`] = ["Argentina"];
  }
  // ...and the one this jump's events are actually about, last.
  world.regionOwnershipOverrides.donbas = "Russian Federation";
  world.regionClaimants.donbas = ["Ukraine"];
  const survives = (candidates) => "donbas" in summarizeTerritorialState(world, candidates).regionClaimants;
  // Who fights in an event says which front it concerns, whatever language it is told in.
  const combatants = ["Ukraine", "Russian Federation"];
  assert.equal(survives([{ title: "Ukraine counter-attacks", description: "Ukrainian forces push east.", combatants }]), true);
  assert.equal(survives([{ title: "L'Ukraine contre-attaque", description: "Les forces ukrainiennes avancent vers l'est.", combatants }]), true);
  // So do the sides of the operations it carries.
  assert.equal(survives([{ title: "x", existingControlOps: [{ op: "contest", regionId: "Donbas", fromCode: "Russian Federation", actorCode: "Ukraine" }] }]), true);
  // Its words never do: a name in the prose, in English or French, moves nothing up.
  assert.equal(survives([{ title: "Ukraine counter-attacks", description: "Ukrainian forces push east." }]), false);
  assert.equal(survives([{ title: "L'Ukraine contre-attaque", description: "Les forces ukrainiennes avancent." }]), false);
  const state = summarizeTerritorialState(world, [{ title: "x", combatants }]);
  assert.equal(Object.keys(state.regionClaimants).length, TERRITORIAL_STATE_ROW_CAP);
  assert.equal(state.omittedRegions, 51);
});

test("the same world gives the same prompt, byte for byte", () => {
  const world = handDrawnWorld(50);
  world.regionClaimants["3"] = ["Poland"];
  world.regionSovereigntyOverrides["5"] = "Ukraine";
  const candidates = [{ title: "Poland protests", description: "A note is delivered." }];
  assert.equal(JSON.stringify(summarizeTerritorialState(world, candidates)), JSON.stringify(summarizeTerritorialState(world, candidates)));
});

test("a world with no stores at all is an empty state, not a crash", () => {
  for (const world of [null, undefined, {}, { regionOwnershipOverrides: "nope" }]) {
    const state = summarizeTerritorialState(world, null);
    assert.deepEqual(state.regionOwnershipOverrides, {});
    assert.deepEqual(state.regionClaimants, {});
  }
});

// --- What the director would be asked, worked out before anyone is asked ---

const EVENTS = [
  { title: "Grain prices ease in Odessa", description: "A good harvest brings bread prices down.", impacts: {} },
  {
    title: "Separatists capture Sloviansk",
    description: "Militia columns seize the town hall in Sloviansk after a night of fighting.",
    impacts: { regionControlOps: [{ op: "control", regionId: "Sloviansk", fromCode: "Ukraine", toCode: "Donetsk People's Republic" }] },
  },
];

test("the text read for place names is the candidates' words and the places their operations point at", () => {
  const text = territoryCandidateText([{
    title: "Separatists capture Sloviansk",
    description: "Militia columns seize the town hall.",
    existingLegalTransfers: [{ regionId: "r-1", regionName: "Kramatorsk" }],
    existingControlOps: [{ regionId: "Sloviansk" }],
  }]);
  for (const word of ["Separatists capture Sloviansk", "Militia columns", "Kramatorsk", "r-1"]) assert.ok(text.includes(word), word);
  assert.equal(territoryCandidateText(null), "");
});

test("no territorial event means nothing to ask, and the place reader is never run", async () => {
  let read = 0;
  const input = await buildTerritoryDirectorInput({ events: [EVENTS[0]], world: handDrawnWorld(4), findPlaces: () => { read += 1; return []; } });
  assert.equal(input, null);
  assert.equal(read, 0);
});

test("a territorial event is asked about under its own position, with the places it names", async () => {
  const seen = [];
  const input = await buildTerritoryDirectorInput({
    events: EVENTS,
    world: handDrawnWorld(4),
    findPlaces: async (text) => { seen.push(text); return [{ place: "Sloviansk", kind: "city", regionId: "r-donetsk", controller: "Ukraine" }]; },
  });
  assert.deepEqual(input.candidates.map((row) => row.eventIndex), [1]);
  assert.equal(input.candidates[0].existingControlOps.length, 1);
  assert.ok(seen[0].includes("Sloviansk"));
  assert.equal(input.territorialState.placesTheseEventsName[0].controller, "Ukraine");
});

test("a place reader that fails costs the places, never the pass", async () => {
  const input = await buildTerritoryDirectorInput({
    events: EVENTS, world: handDrawnWorld(4), findPlaces: async () => { throw new Error("catalog unavailable"); },
  });
  assert.equal(input.candidates.length, 1);
  assert.equal("placesTheseEventsName" in input.territorialState, false);
});

test("the director asks its analyzer exactly what buildTerritoryDirectorInput says it would", async () => {
  const world = handDrawnWorld(4);
  const findPlaces = async () => [{ place: "Sloviansk", kind: "city", regionId: "r-donetsk", controller: "Ukraine" }];
  const expected = await buildTerritoryDirectorInput({ events: EVENTS, world, findPlaces });
  let asked = null;
  await directGeneratedTerritoryOps({
    events: EVENTS,
    world,
    findPlaces,
    analyzeBatch: async (input) => { asked = input; return { eventOrders: [], summary: "" }; },
  });
  assert.deepEqual(asked, expected);
});
