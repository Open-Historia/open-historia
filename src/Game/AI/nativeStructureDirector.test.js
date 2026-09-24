/*! Open Historia — native structure director tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { eventNeedsStructureDirector, sanitizeStructureOrders } from "./nativeStructureDirector.js";

// Seen in a live game (2026-09-21): Egypt had been absorbed into the British
// Empire years before, the model still wrote Egypt's canal authority building a
// traffic control centre at Port Said, and it went on the map as Egypt's.
const event = {
  date: "2019-02-11",
  title: "Egyptian Suez Canal Authority Reorganizes Traffic Control Command at Port Said",
  description: "Egyptian maritime authorities opened new radar coordination facilities at the Port Said canal entrance.",
};
const structure = (over = {}) => ({
  name: "Port Said Traffic Control Centre", kind: "control centre", ownerCode: "Egypt",
  status: "active", lng: 32.3, lat: 31.26, ...over,
});
const run = (over, playerCountry = "British Empire") => {
  let next = 0;
  return sanitizeStructureOrders({
    events: [event],
    orders: [{ eventIndex: 0, structures: [structure(over)] }],
    world: {},
    playerCountry,
    makeId: () => `m${next += 1}`,
  });
};
const builtOwner = (result) => result.acceptedByEvent.get(0)?.[0]?.marker?.ownerCode;

test("the event is one the structure director reads", () => {
  assert.ok(eventNeedsStructureDirector(event));
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
