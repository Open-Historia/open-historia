/*! Open Historia — the consent guard with several human players: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/sharedGameAgency.test.js
//
// The world may act ON a country a person plays, never choose FOR it: its
// government's choices come only from that person's own orders and messages.
// With several people in one game that has to hold for each of them, and one
// person's orders must never stand in for another's. Single player is the same
// game with one person, and must not change at all.

import test from "node:test";
import assert from "node:assert/strict";

import {
  playerAgencyViolationReason,
  screenGeneratedWorldEvents,
} from "./nativeWorldIntegrity.js";
import { humanCountriesOf, isSharedGame, orderOwner } from "../../runtime/humanPolities.js";
import { normalizeActionEntry } from "../../runtime/gameState.js";

const LATVIA = "Republic of Latvia";
const RUSSIA = "Russian Federation";
const polity = (name, alias) => ({ code: name, name, aliases: [alias], status: "active" });
const world = {
  polityOverrides: {
    [LATVIA]: polity(LATVIA, "Latvia"),
    [RUSSIA]: polity(RUSSIA, "Russia"),
    "Republic of Estonia": polity("Republic of Estonia", "Estonia"),
  },
};
// Latvia is the host's own seat; Russia is played by a second person.
const shared = { country: LATVIA, humanCountries: [LATVIA, RUSSIA], gameDate: "2014-04-01", round: 3 };
const solo = { country: LATVIA, gameDate: "2014-04-01", round: 3 };

const order = (id, text, ownerCode) => ({ id, kind: "action", status: "planned", title: text, text, rawInput: text, ...(ownerCode ? { ownerCode } : {}) });
const event = (title, description, extra = {}) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  date: "2014-04-10",
  title,
  description,
  importance: "major",
  impacts: { actionIds: [] },
  ...extra,
});
const screen = (game, events, { actions = [], chats = [] } = {}) =>
  screenGeneratedWorldEvents({ events, world, game, actions, chats });
const refusedFor = (screened) => screened.dropped.filter((row) => row.route === "PLAYER_AGENCY_AUTHORITY");

test("who plays: the player first, then every other seat a person holds, once each", () => {
  assert.deepEqual(humanCountriesOf(solo), [LATVIA]);
  assert.deepEqual(humanCountriesOf({ ...shared, humanCountries: [RUSSIA, " Republic of  Latvia ", "", RUSSIA] }), [LATVIA, RUSSIA]);
  assert.equal(isSharedGame(solo), false);
  assert.equal(isSharedGame(shared), true);
  assert.equal(orderOwner(order("o1", "Hold talks"), shared), LATVIA);
  assert.equal(orderOwner(order("o2", "Hold talks", RUSSIA), shared), RUSSIA);
});

test("an order keeps the polity that gave it through the game's normalizer; single player's orders gain nothing", () => {
  assert.equal(normalizeActionEntry(order("o1", "Hold talks", RUSSIA)).ownerCode, RUSSIA);
  assert.equal("ownerCode" in normalizeActionEntry(order("o2", "Hold talks")), false);
});

test("a second person's country never makes a sovereign choice they did not order", () => {
  const war = event("Russia declares war on Estonia", "The Russian government declares war on the Republic of Estonia.");
  const screened = screen(shared, [war]);
  assert.equal(screened.events.length, 0);
  assert.match(refusedFor(screened)[0]?.reason ?? "", /Russian Federation is played by a person/);

  // Ordered by the person who plays Russia, it stands.
  const ordered = screen(shared, [war], { actions: [order("b-war", "Declare war on Estonia", RUSSIA)] });
  assert.equal(ordered.events.length, 1);
  assert.deepEqual(ordered.events[0].impacts.actionIds, ["b-war"]);

  // In single player Russia is the AI's, and the same event is the world's to write.
  assert.equal(screen(solo, [war]).events.length, 1);
});

test("one person's order never stands in for another's choice", () => {
  const sanctions = event("Russia imposes sanctions on Estonia", "The Russian government imposes new sanctions on Estonian exports.");
  // Latvia's player ordered it, not Russia's.
  const screened = screen(shared, [sanctions], { actions: [order("a-sanctions", "Get Russia to impose sanctions on Estonia")] });
  assert.equal(screened.events.length, 0);
  assert.equal(refusedFor(screened).length, 1);

  // Named as Latvia's authority by the model, Russia's order is turned away too.
  const claimed = event("Latvia imposes sanctions on Estonia", "Riga imposes new sanctions.", {
    agency: {
      principal: LATVIA,
      principalKind: "polity",
      sovereignPolity: LATVIA,
      authority: "player-order",
      authorityRef: "b-order",
      sovereignActors: [{ polity: LATVIA, authority: "player-order", authorityRef: "b-order" }],
    },
    impacts: { actionIds: ["b-order"] },
  });
  const actions = [order("b-order", "Impose sanctions on Estonia", RUSSIA)];
  assert.match(
    playerAgencyViolationReason(claimed, { world, gameCountry: LATVIA, humanCountries: shared.humanCountries, actions }),
    /another player's order, not one Republic of Latvia gave/,
  );
  // Single player's orders name no owner: they are the player's, and the same
  // claim is sound.
  assert.equal(playerAgencyViolationReason(claimed, { world, gameCountry: LATVIA, actions: [order("b-order", "Impose sanctions on Estonia")] }), "");
});

test("a treaty between two people's countries needs each of them to have agreed", () => {
  const treaty = event("Latvia and Russia sign a border treaty", "Latvia and Russia sign a treaty fixing the Latgale border.");
  const latviaOrder = order("a-treaty", "Sign a border treaty with Russia fixing the Latgale border");
  const refused = screen(shared, [treaty], { actions: [latviaOrder] });
  assert.equal(refused.events.length, 0);
  assert.match(refusedFor(refused)[0].reason, /Russian Federation is played by a person/);

  // Russia's player said yes in the negotiation: now both sides chose it.
  const chats = [{
    id: "chat-border",
    countries: [RUSSIA],
    messages: [{ id: "msg-russia-yes", role: "user", speaker: RUSSIA, text: "We will sign the border treaty with Latvia fixing the Latgale border." }],
  }];
  const agreed = screen(shared, [treaty], { actions: [latviaOrder], chats });
  assert.equal(agreed.events.length, 1);
  const rows = agreed.events[0].agency.sovereignActors;
  assert.deepEqual(rows.map((row) => [row.polity, row.authority, row.authorityRef]), [
    [LATVIA, "player-order", "a-treaty"],
    [RUSSIA, "player-commitment", "msg-russia-yes"],
  ]);
  assert.deepEqual(agreed.events[0].impacts.actionIds, ["a-treaty"]);
});

test("a message counts only for its speaker; with several people a bare user role is nobody's word", () => {
  const unsigned = [{ id: "chat", countries: [RUSSIA], messages: [{ id: "msg-anon", role: "user", text: "We will hold the meeting next week." }] }];
  const signed = [{ id: "chat", countries: [RUSSIA], messages: [{ id: "msg-latvia", role: "user", speaker: LATVIA, text: "We will hold the meeting next week." }] }];
  const meeting = (ref) => event("Latvia holds the agreed meeting", "The government holds the meeting it agreed to.", {
    agency: {
      principal: LATVIA,
      principalKind: "polity",
      sovereignPolity: LATVIA,
      authority: "player-commitment",
      authorityRef: ref,
    },
  });
  const options = { world, gameCountry: LATVIA, humanCountries: shared.humanCountries, actions: [] };
  assert.match(playerAgencyViolationReason(meeting("msg-anon"), { ...options, chats: unsigned }), /player-authored diplomatic message/);
  assert.equal(playerAgencyViolationReason(meeting("msg-latvia"), { ...options, chats: signed }), "");
  // Single player reads the bare role as the player's, as it always has.
  assert.equal(playerAgencyViolationReason(meeting("msg-anon"), { world, gameCountry: LATVIA, actions: [], chats: unsigned }), "");
});

test("the world still acts on people's countries: an AI's choice against one, and one person's ordered choice against another", () => {
  const aiSanctions = event("Estonia imposes sanctions on Russia", "The Estonian government imposes new sanctions on Russian exports.");
  assert.equal(screen(shared, [aiSanctions]).events.length, 1);

  const annexation = event("Russia annexes the Latgale border districts of Latvia", "Moscow annexes the Latgale border districts of Latvia.");
  const screened = screen(shared, [annexation], { actions: [order("b-annex", "Annex the Latgale border districts of Latvia", RUSSIA)] });
  assert.equal(screened.events.length, 1);
  assert.deepEqual(screened.events[0].impacts.actionIds, ["b-annex"]);
  assert.equal(screened.events[0].agency.sovereignPolity, RUSSIA);
});

test("no person's country is granted autonomous (AI) sovereignty, nor its government rewritten without its own authority", () => {
  const options = { world, gameCountry: LATVIA, humanCountries: shared.humanCountries, actions: [] };
  const autonomous = event("Russia chooses a new doctrine", "The government chooses a new doctrine.", {
    agency: { principal: RUSSIA, principalKind: "polity", sovereignPolity: RUSSIA, authority: "autonomous", authorityRef: "" },
  });
  assert.match(playerAgencyViolationReason(autonomous, options), /Russian Federation is human-controlled/);
  assert.equal(playerAgencyViolationReason(autonomous, { world, gameCountry: LATVIA, actions: [] }), "");

  const rewritten = event("Russian Cabinet Adopts a New National Security Doctrine", "The government adopts a new national security policy.", {
    agency: { principal: "Coalition Working Group", principalKind: "domestic-actor", sovereignPolity: "", authority: "independent", authorityRef: "" },
    impacts: {
      actionIds: [],
      politicalActorOps: [{ op: "set-strategic-goals", polityKey: RUSSIA, argsJson: JSON.stringify({ goals: ["A doctrine nobody ordered"] }) }],
    },
  });
  assert.match(playerAgencyViolationReason(rewritten, options), /human-controlled polity Russian Federation without player-order or player-commitment/);
});

test("a person's country is known to the guard even when no ledger names it yet", () => {
  const bare = { polityOverrides: { [LATVIA]: polity(LATVIA, "Latvia") } };
  const game = { ...shared, humanCountries: [LATVIA, "Grand Duchy of Lithuania"] };
  const screened = screenGeneratedWorldEvents({
    events: [event("Grand Duchy of Lithuania declares war on Latvia", "The Grand Duchy of Lithuania declares war.")],
    world: bare,
    game,
  });
  assert.equal(screened.events.length, 0);
  assert.match(refusedFor(screened)[0].reason, /Grand Duchy of Lithuania is played by a person/);
});
