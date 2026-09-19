/*! Open Historia — interactive event offer tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/interactiveOffer.test.js
//
// Runs without node_modules: interactiveOffer.js imports only spycraft.js,
// which imports nothing.
//
// The invariant: a skip offers at most one of its own events, only one worth
// playing out, rarely, never twice in quick succession, and always the same
// one for the same turn.

import test from "node:test";
import assert from "node:assert/strict";

import {
  INTERACTIVE_OFFER_CHANCE,
  INTERACTIVE_OFFER_COOLDOWN,
  chooseInteractiveOffer,
  isOfferableEvent,
  normalizeInteractiveOffer,
  offeredEvent,
} from "./interactiveOffer.js";

const event = (id, overrides = {}) => ({
  id,
  title: `Event ${id}`,
  description: `What happened in ${id}.`,
  importance: "major",
  playerRelated: true,
  source: "ai",
  ...overrides,
});

// The rounds on which these events would be offered: from one round to the
// next, only the dice differ.
const offeredOnRounds = (events, rounds) => rounds.filter((round) => chooseInteractiveOffer({ events, round }));

test("only an event about the player, of weight, by the simulation, and not a scene already, can be offered", () => {
  assert.equal(isOfferableEvent(event("a")), true);
  assert.equal(isOfferableEvent(event("a", { importance: "critical" })), true);
  assert.equal(isOfferableEvent(event("a", { importance: "minor", notable: true })), true, "an auto-jump's stop counts");
  assert.equal(isOfferableEvent(event("a", { importance: "minor" })), false);
  assert.equal(isOfferableEvent(event("a", { playerRelated: false })), false);
  assert.equal(isOfferableEvent(event("a", { source: "fallback" })), false);
  assert.equal(isOfferableEvent(event("a", { source: "espionage" })), false);
  assert.equal(isOfferableEvent(event("a", { kind: "interactive" })), false);
  assert.equal(isOfferableEvent(event("a", { description: "" })), false);
  assert.equal(isOfferableEvent(null), false);
});

test("a skip offers rarely: about one time in three when every skip has an event worth it", () => {
  const rounds = Array.from({ length: 900 }, (_, index) => index + 2);
  const offered = rounds.filter((round) => chooseInteractiveOffer({ events: [event(`first-${round}`), event(`second-${round}`)], round }));
  const rate = offered.length / rounds.length;
  assert.ok(Math.abs(rate - INTERACTIVE_OFFER_CHANCE) < 0.06, `rate ${rate.toFixed(3)}`);
});

test("the same turn always offers the same event", () => {
  const events = [event("e1"), event("e2", { importance: "critical" }), event("e3")];
  const round = offeredOnRounds(events, Array.from({ length: 60 }, (_, index) => index + 2))[0];
  assert.ok(round, "some round offers");
  const first = chooseInteractiveOffer({ events, round });
  assert.deepEqual(chooseInteractiveOffer({ events: JSON.parse(JSON.stringify(events)), round }), first);
  assert.deepEqual(first, { eventId: "e2", round }, "the weightiest event");
});

test("the weightiest event is offered, a notable one above its peers, the latest of equals", () => {
  const always = { chance: 1 };
  assert.equal(chooseInteractiveOffer({ ...always, round: 5, events: [event("a"), event("b"), event("c", { importance: "minor" })] }).eventId, "b");
  assert.equal(chooseInteractiveOffer({ ...always, round: 5, events: [event("a", { notable: true }), event("b")] }).eventId, "a");
  assert.equal(chooseInteractiveOffer({ ...always, round: 5, events: [event("a", { importance: "critical" }), event("b", { notable: true })] }).eventId, "a");
  assert.equal(chooseInteractiveOffer({ ...always, round: 5, events: [event("a", { playerRelated: false }), event("b", { importance: "minor" })] }), null, "nothing worth it, no offer");
});

test("an Intervene that keeps the offered event keeps the offer", () => {
  const events = [event("e1", { importance: "minor" }), event("e2", { importance: "critical" }), event("e3"), event("e4")];
  const round = offeredOnRounds(events, Array.from({ length: 60 }, (_, index) => index + 2))[0];
  const whole = chooseInteractiveOffer({ events, round });
  assert.equal(whole.eventId, "e2");
  assert.deepEqual(chooseInteractiveOffer({ events: events.slice(0, 2), round }), whole, "stopped after the offered event");
  assert.equal(chooseInteractiveOffer({ events: events.slice(0, 1), round }), null, "stopped before it: nothing left worth it");
});

test("no offer within the cooldown of the last one", () => {
  const always = { chance: 1, events: [event("a")] };
  assert.equal(chooseInteractiveOffer({ ...always, round: 10, lastOfferRound: 10 - INTERACTIVE_OFFER_COOLDOWN + 1 }), null);
  assert.deepEqual(chooseInteractiveOffer({ ...always, round: 10, lastOfferRound: 10 - INTERACTIVE_OFFER_COOLDOWN }), { eventId: "a", round: 10 });
  assert.deepEqual(chooseInteractiveOffer({ ...always, round: 2, lastOfferRound: 0 }), { eventId: "a", round: 2 }, "a campaign that never had one");
});

test("a stored offer is normalized, and stands only on an event still on the record with no scene in progress", () => {
  assert.equal(normalizeInteractiveOffer(null), null);
  assert.equal(normalizeInteractiveOffer({ eventId: "  " }), null);
  assert.deepEqual(normalizeInteractiveOffer({ eventId: " e2 ", round: "7.9", extra: 1 }), { eventId: "e2", round: 7 });
  const events = [event("e1"), event("e2")];
  assert.equal(offeredEvent({ offer: { eventId: "e2", round: 7 }, events }).id, "e2");
  assert.equal(offeredEvent({ offer: { eventId: "e2", round: 7 }, events, sceneInProgress: true }), null);
  assert.equal(offeredEvent({ offer: { eventId: "gone", round: 7 }, events }), null);
  assert.equal(offeredEvent({ offer: null, events }), null);
});
