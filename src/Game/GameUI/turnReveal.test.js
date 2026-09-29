/*! Open Historia — the Events panel's reveal, streamed cards and map-change lines: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/turnReveal.test.js
//
// The invariants: a streamed card never throws whatever the model typed; the
// reveal carried from the streamed cards to the written turn stops at the
// furthest event the player actually uncovered, and at one event when none of
// them survived; the "What changed on the map" list is one line per change.

import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_TURN_RECORD_ID,
  MAP_CHANGE_KIND_LABELS,
  buildLiveTurnRecord,
  captureRevealCarry,
  describeEventMapChanges,
  eventDisclosureKey,
  liveEventCard,
  resolveRevealCarry,
} from "./turnReveal.js";

// ---- streamed cards ----------------------------------------------------------

test("a streamed card is made once per event, under the counter's id, never the model's", () => {
  const event = { id: "model-1", title: "Riots in Lyon", impacts: {} };
  const card = liveEventCard(event);
  assert.equal(liveEventCard(event), card, "the same object comes back on the next arrival");
  assert.notEqual(card.id, "model-1");
  assert.ok(card.id.startsWith(`${LIVE_TURN_RECORD_ID}-`));
  const twin = liveEventCard({ id: "model-1", title: "Riots in Lyon" });
  assert.notEqual(twin.id, card.id, "two events the model gave one id are two cards");
});

test("whatever the model typed in place of a list, a streamed card walks as an empty one", () => {
  const card = liveEventCard({
    title: "Odd shapes",
    tags: "war",
    combatants: { a: 1 },
    impacts: { regionTransfers: "Donetsk", unitOps: null, groupOps: { op: "take" }, markerOps: [{ op: "build" }] },
  });
  assert.deepEqual(card.tags, []);
  assert.deepEqual(card.combatants, []);
  assert.deepEqual(card.impacts.regionTransfers, []);
  assert.deepEqual(card.impacts.groupOps, []);
  assert.deepEqual(card.impacts.unitOps, [], "null is no list either");
  assert.equal(card.impacts.polityChanges, undefined, "a missing list is left for `?? []`");
  assert.equal(card.impacts.markerOps.length, 1, "a real list is kept");
  assert.deepEqual(liveEventCard({ title: "No impacts", impacts: ["x"] }).impacts, {});
  assert.doesNotThrow(() => describeEventMapChanges(card));
});

test("the live record skips what is not an event and reads its title off the major one", () => {
  const record = buildLiveTurnRecord({
    events: [null, "text", { title: "A minor thing" }, { title: "The big one", importance: "Major" }],
    fromDate: "1914-06-28",
    toDate: "1914-07-28",
    round: 3,
    rangeLabel: "Jun 28, 1914 -> Jul 28, 1914",
  });
  assert.equal(record.id, LIVE_TURN_RECORD_ID);
  assert.equal(record.eventCount, 2);
  assert.equal(record.title, "The big one");
  assert.equal(record.rangeLabel, "Jun 28, 1914 -> Jul 28, 1914");
  assert.equal(buildLiveTurnRecord({ events: undefined, fromDate: "", toDate: "", round: 1 }).eventCount, 0);
});

// ---- carrying the reveal -------------------------------------------------------

const titled = (...titles) => titles.map((title, index) => ({ id: `e${index}`, title }));

test("the carry records which events were uncovered, by headline", () => {
  assert.equal(captureRevealCarry([], 3), null, "nothing streamed, nothing to carry");
  const carry = captureRevealCarry(titled("Riots in  Lyon", "A strike", "A treaty"), 2);
  assert.deepEqual(carry, { revealed: 2, streamed: 3, keys: ["riots in lyon", "a strike"] });
  assert.equal(captureRevealCarry(titled("One"), 9).revealed, 1, "clamped to what streamed");
  assert.equal(captureRevealCarry(titled("One", "Two"), 0).revealed, 1, "the first card is always showing");
});

test("an event the engine wrote in among the uncovered ones stays walked past", () => {
  const carry = captureRevealCarry(titled("A strike", "Riots in Lyon", "A treaty"), 2);
  const written = titled("A strike", "The Kaiser's telegram", "Riots in Lyon", "A treaty");
  assert.equal(resolveRevealCarry(carry, written), 3);
});

test("an uncovered event the engine dropped does not move the reveal past the others", () => {
  const carry = captureRevealCarry(titled("A strike", "Riots in Lyon", "A treaty"), 2);
  assert.equal(resolveRevealCarry(carry, titled("A strike", "A treaty")), 1);
});

test("when none of the uncovered events survived, the turn opens on its first event", () => {
  const carry = captureRevealCarry(titled("A strike", "Riots in Lyon"), 2);
  assert.equal(resolveRevealCarry(carry, titled("Something else", "And another")), 1);
  assert.equal(resolveRevealCarry(null, titled("Something else")), 1);
  assert.equal(resolveRevealCarry(carry, []), 0);
});

test("a card is opened by its headline, so it stays open when the written turn replaces it", () => {
  assert.equal(eventDisclosureKey({ id: "live-turn-4", title: "  Riots in\nLyon " }), "riots in lyon");
  assert.equal(eventDisclosureKey({ id: "e7", title: "" }), "e7");
  assert.equal(eventDisclosureKey(null), "");
});

// ---- what changed on the map ------------------------------------------------------

const lookups = {
  polityLookup: new Map([["FRA", "France"]]),
  regionLookup: new Map([["FRA.1_1", { name: "Alsace" }]]),
  unitName: (id) => (id === "u1" ? "1st Army" : ""),
};

test("one line per change, so the pill's count and the list never disagree", () => {
  const event = {
    impacts: {
      regionTransfers: [{ regionId: "FRA.1_1", fromCode: "Germany", toCode: "FRA" }],
      regionControlOps: [{ op: "contest", regionId: "FRA.1_1", actorCode: "Germany", fromCode: "FRA" }, { op: "unknown" }],
      regionClaims: [{ regionId: "FRA.1_1", claimantCode: "Germany" }],
      groupOps: [{ op: "erase", name: "Black Hand" }],
      polityChanges: [{ operation: "rename", code: "FRA", name: "French Republic" }],
      unitOps: [{ op: "strength", unitId: "u1", strength: 60 }, { op: "strength", unitId: "u2", strength: 10 }],
      markerOps: [{ op: "build", marker: { name: "Fort Douaumont", kind: "fort" } }],
    },
  };
  const lines = describeEventMapChanges(event, lookups);
  assert.deepEqual(lines.map((line) => line.kind), ["territory", "control", "claim", "group", "polity", "unit", "unit", "structure"]);
  assert.equal(lines[0].text, "Alsace: Germany → France");
  assert.equal(lines[3].text, "Black Hand: erased, with the area it controlled");
  assert.equal(lines[4].text, "French Republic: renamed (was France)");
  assert.equal(lines[5].text, "1st Army: strength 60%");
  assert.equal(lines[6].text, "unit u2: strength 10%", "a unit the map does not know is named by its id");
});

test("a destroyed structure reads as destroyed, not as updated", () => {
  // The written op (normalizeMarkerOp turns "destroy" into this) and a
  // streamed card's raw one read the same.
  const written = { impacts: { markerOps: [{ op: "update", name: "Stalingrad", changes: { status: "destroyed" } }] } };
  const streamed = { impacts: { markerOps: [{ op: "destroy", name: "Stalingrad" }] } };
  assert.deepEqual(describeEventMapChanges(written, lookups).map((line) => line.text), ["Stalingrad destroyed"]);
  assert.deepEqual(describeEventMapChanges(streamed, lookups).map((line) => line.text), ["Stalingrad destroyed"]);
});

test("a structure update says what it changed, a line each, the description on the first", () => {
  const event = {
    impacts: {
      markerOps: [
        { op: "update", name: "Brest naval base", changes: { status: "damaged", ownerCode: "FRA", note: "Shelled from the sea." } },
        { op: "update", markerId: "m-4", name: "Toulon", changes: { note: "Now the fleet's home port." } },
        { op: "update", name: "Calais", changes: { ownerCode: "" } },
        { op: "update", name: "Metz", changes: { foundedAt: "0050-01-01", lng: 6.17, lat: 49.12 } },
        { op: "update", name: "Nowhere" },
      ],
    },
  };
  assert.deepEqual(describeEventMapChanges(event, lookups).map((line) => line.text), [
    "Brest naval base is damaged — Shelled from the sea.",
    "Brest naval base: now held by France",
    "Toulon: description changed — Now the fleet's home port.",
    "Calais: no longer held by anyone",
    "Metz: moved on the map",
    "Metz: founding date set to 0050-01-01",
    "Nowhere updated",
  ]);
});

test("a population change gives the figure and its reason", () => {
  const lines = describeEventMapChanges({
    impacts: { markerOps: [
      { op: "population", name: "Lyon", population: 1250000, note: "refugees from the north" },
      { op: "population", name: "Lille", population: "many" },
    ] },
  }, lookups);
  assert.deepEqual(lines.map((line) => line.text), [
    "Lyon: population now 1,250,000 — refugees from the north",
    "Lille: population changed",
  ]);
});

test("a unit's destination is named, not given as a region id", () => {
  const [move] = describeEventMapChanges({ impacts: { unitOps: [{ op: "move", unitId: "u1", regionId: "FRA.1_1", posture: "attack" }] } }, lookups);
  assert.equal(move.text, "1st Army moves to Alsace (attack)");
  const [unknown] = describeEventMapChanges({ impacts: { unitOps: [{ op: "move", unitId: "u1", regionId: "XYZ.9_9" }] } }, lookups);
  assert.equal(unknown.text, "1st Army moves to XYZ.9_9", "a region the catalog lacks keeps its id");
});

test("every kind of line has a display label", () => {
  const event = {
    impacts: {
      regionTransfers: [{ regionId: "FRA.1_1" }],
      regionControlOps: [{ op: "control", regionId: "FRA.1_1", toCode: "FRA" }],
      regionClaims: [{ regionId: "FRA.1_1", claimantCode: "FRA" }],
      groupOps: [{ op: "create", name: "Black Hand" }],
      polityChanges: [{ operation: "create", name: "Vichy" }],
      unitOps: [{ op: "remove", unitId: "u1" }],
      markerOps: [{ op: "remove", name: "Fort" }],
    },
  };
  for (const line of describeEventMapChanges(event, lookups)) {
    assert.match(MAP_CHANGE_KIND_LABELS[line.kind] ?? "", /^[A-Z][a-z]+$/, `${line.kind} has a capitalised label`);
  }
});

test("impacts that are not lists describe nothing rather than throwing", () => {
  assert.deepEqual(describeEventMapChanges({ impacts: { regionTransfers: "x", unitOps: 4, markerOps: { op: "build" } } }), []);
  assert.deepEqual(describeEventMapChanges({ impacts: null }), []);
  assert.deepEqual(describeEventMapChanges(null), []);
});
