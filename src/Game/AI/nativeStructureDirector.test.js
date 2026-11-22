/*! Open Historia — native structure director tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { eventNeedsStructureDirector, sanitizeStructureOrders, structureKind } from "./nativeStructureDirector.js";
import { STRUCTURE_KINDS } from "./gameplaySchemas.js";

// Seen in a live game (2026-09-21): Egypt had been absorbed into the British
// Empire years before, the model still wrote Egypt's canal authority building a
// traffic control centre at Port Said, and it went on the map as Egypt's.
// The event answers the player's order (mapConsequences.js marks it `ordered`).
const event = {
  date: "2019-02-11",
  title: "Egyptian Suez Canal Authority Reorganizes Traffic Control Command at Port Said",
  description: "Egyptian maritime authorities opened new radar coordination facilities at the Port Said canal entrance.",
  ordered: { forces: true, build: true },
};
const structure = (over = {}) => ({
  name: "Port Said Traffic Control Centre", kind: "port", ownerCode: "Egypt",
  status: "active", lng: 32.3, lat: 31.26, ...over,
});
const run = (over, playerCountry = "British Empire", events = [event]) => {
  let next = 0;
  return sanitizeStructureOrders({
    events,
    orders: [{ eventIndex: 0, structures: [structure(over)] }],
    world: {},
    playerCountry,
    makeId: () => `m${next += 1}`,
  });
};
const builtOwner = (result) => result.acceptedByEvent.get(0)?.[0]?.marker?.ownerCode;

test("the director reads an event that answers an order or a Scene, and no other, in any language", () => {
  assert.ok(eventNeedsStructureDirector(event));
  // The same event with no order behind it is not read, whether its words say
  // something was built (English) or say it in French.
  const { ordered: _ordered, ...unordered } = event;
  assert.equal(eventNeedsStructureDirector(unordered), false);
  assert.equal(eventNeedsStructureDirector({ ...unordered, title: "Ouverture d'un centre de contrôle à Port-Saïd", description: "Les autorités ont inauguré de nouvelles installations radar." }), false);
  assert.equal(eventNeedsStructureDirector({ ...unordered, title: "Ouverture d'un centre de contrôle à Port-Saïd", ordered: { forces: true, build: true } }), true);
  // And a build on an event it does not read is dropped, never kept by its words.
  assert.equal(builtOwner(run({}, "British Empire", [unordered])), undefined);
});

test("a structure's kind is one of the listed kinds, case and spacing aside, or it is no structure", () => {
  assert.equal(structureKind("Ground  Station"), "ground station");
  assert.equal(structureKind("data centre"), "data centre");
  // In orbit, or no place at all: none of them is a kind, in English or French.
  for (const kind of ["reconnaissance satellite", "satellite constellation", "research programme", "frigate", "satellite de reconnaissance", "programme de recherche", ""]) {
    assert.equal(structureKind(kind), "", kind);
  }
  // A word that is not one of the kinds is left out, in English as in French.
  assert.equal(builtOwner(run({ kind: "satellite ground station" })), undefined);
  assert.equal(builtOwner(run({ kind: "station au sol" })), undefined);
  assert.equal(builtOwner(run({ kind: "Ground Station" })), "Egypt");
  assert.equal(run({ kind: "Ground Station" }).acceptedByEvent.get(0)[0].marker.kind, "ground station");
  // The Workshop's own kinds are among them, spelled as it spells them.
  for (const kind of ["landmark", "military hq", "military base", "fortress", "airfield", "port", "mine", "oil field", "industrial plant", "power plant", "research facility", "embassy"]) {
    assert.ok(STRUCTURE_KINDS.includes(kind), kind);
  }
});

test("a structure credited to a polity with no land goes to whoever holds the ground", () => {
  const result = run({ groundOwner: "British Empire", ownerHoldsLand: false });
  assert.equal(builtOwner(result), "British Empire");
  assert.match(result.diagnostics[0].reason, /Egypt holds no land/);
});

test("a polity that holds land keeps its structure on someone else's ground", () => {
  // An embassy or a base abroad is the owner's, not the host's.
  assert.equal(builtOwner(run({ groundOwner: "British Empire", ownerHoldsLand: true })), "Egypt");
});

test("a landless player keeps what it builds", () => {
  assert.equal(builtOwner(run({ ownerCode: "Free Egypt", groundOwner: "British Empire", ownerHoldsLand: false }, "Free Egypt")), "Free Egypt");
});

test("with nothing known about the ground, the owner stands as written", () => {
  assert.equal(builtOwner(run({})), "Egypt");
  assert.equal(builtOwner(run({ ownerHoldsLand: false })), "Egypt");
});

test("a structure placed approximately keeps its mark through the director's rules", () => {
  const approximate = { asked: "Djibo, Burkina Faso", country: "Burkina Faso", near: "Ouagadougou" };
  const { acceptedByEvent } = sanitizeStructureOrders({
    events: [{ title: "Burkina Faso Establishes a Forward Operating Base at Djibo", description: "Engineers build the base.", date: "2026-03-14", ordered: { forces: true, build: true } }],
    orders: [{ eventIndex: 0, structures: [{ name: "Djibo Forward Operating Base", kind: "military base", ownerCode: "Burkina Faso", lng: -1.2, lat: 12.5, approximate }] }],
    world: { markers: [] },
    playerCountry: "Burkina Faso",
    makeId: () => "structure-1",
  });
  assert.deepEqual(acceptedByEvent.get(0)?.[0]?.marker?.approximate, approximate);
});

test("no word list is left to read an event or a kind by", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./nativeStructureDirector.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /_PATTERN\b|eventText|orderBuildsStructure|isOrbital/);
});
