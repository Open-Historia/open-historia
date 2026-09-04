/*! Open Historia — intelligence-rating pipeline tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/intelligenceRating.test.js
//
// Reported: a player built spy training academies and researched the tech for a
// dozen turns and the 🕵 Intelligence service bar never moved. Every link below
// was already sound — the model was simply never shown the current rating, so it
// never emitted a change (gameplay.js buildPlayerPolityIntelligenceText now does
// for intelligence what the reputation block has always done for reputation).
// These tests pin the mechanical chain that fix depends on, end to end: the tool
// schema must accept the field, the normalizer must keep it, applying the event
// must store it, and the espionage maths must read it back.

import assert from "node:assert/strict";
import test from "node:test";

import { validateGameplayPayload } from "./gameplaySchemas.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "../../runtime/gameState.js";
import { DEFAULT_INTELLIGENCE, intelligenceOf } from "../../runtime/spycraft.js";

const jumpPayload = (polityChanges) => ({
  events: [{
    date: "2014-04-01",
    title: "The academy opens",
    description: "The first class is sworn in at the new intelligence academy.",
    impacts: { polityChanges },
  }],
  stopDate: "2014-04-30",
  summary: "A quarter of quiet institution-building.",
  clearActions: true,
});

const event = (impacts) => ({
  date: "2014-04-01",
  title: "The academy opens",
  description: "The first class is sworn in.",
  impacts,
});

// A polity change carries an `operation` discriminator on some branches and not
// on others, and every version of the schema rejects unknown fields — so ask
// this build which shape it takes rather than hard-coding one and failing for a
// reason that has nothing to do with the rating under test.
const OPERATION = validateGameplayPayload("jumpForward", jumpPayload([
  { operation: "update", code: "United States of America" },
])).valid ? { operation: "update" } : {};

test("the tool schema accepts an intelligence rating on a polity change", () => {
  const result = validateGameplayPayload("jumpForward", jumpPayload([
    { ...OPERATION, code: "United States of America", intelligence: 72, note: "New academy" },
  ]));
  assert.equal(result.valid, true, result.error);
});

test("an emitted rating reaches world.intelligence and the espionage maths", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: {}, intelligence: {} },
    events: [event({ polityChanges: [{ code: "United States of America", intelligence: 72 }] })],
  });

  assert.equal(world.intelligence["United States of America"], 72);
  assert.equal(intelligenceOf(world, "United States of America"), 72);
});

test("the rating survives the save round trip that persists it", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: {}, intelligence: {} },
    events: [event({ polityChanges: [{ code: "United States of America", intelligence: 72 }] })],
  });

  // What writeWorldState/readWorldState do to it between turns.
  const reloaded = normalizeWorldState(JSON.parse(JSON.stringify(world)));
  assert.equal(intelligenceOf(reloaded, "United States of America"), 72);
});

test("a rating addressed to a polity's display name lands on the polity", () => {
  // The turn after a rename the model answers with the new name; the rating must
  // follow the token like every other owner-keyed field (see ownerNames.js).
  const { world } = applyEventImpactsToWorld({
    world: {
      polityOverrides: { Russia: { code: "Russia", name: "Russian Federation" } },
      intelligence: {},
    },
    events: [event({ polityChanges: [{ code: "Russian Federation", intelligence: 80 }] })],
  });

  assert.deepEqual(world.intelligence, { Russia: 80 });
});

test("an unrated polity is ordinary rather than absent", () => {
  // The prompt block reports this number, so it may never read as 0/100 for a
  // country the AI has simply never had a reason to rate.
  const world = normalizeWorldState({ intelligence: {} });
  assert.equal(intelligenceOf(world, "Ukraine"), DEFAULT_INTELLIGENCE);
  assert.ok(DEFAULT_INTELLIGENCE > 0);
});

test("a polity change that says nothing about intelligence leaves the rating alone", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: {}, intelligence: { "United States of America": 72 } },
    events: [event({ polityChanges: [{ code: "United States of America", reputation: 40 }] })],
  });

  assert.equal(intelligenceOf(world, "United States of America"), 72);
});
