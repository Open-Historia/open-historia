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
import { humanCountriesOf, isSharedGame, orderOwner, setHostingSharedGame } from "../../runtime/humanPolities.js";
import { normalizeActionEntry } from "../../runtime/gameState.js";

// These run as the host's engine does while it shares a game.
setHostingSharedGame(true);

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
const screen = (game, events, { actions = [], chats = [], agreementUpdates = [], warUpdates = [] } = {}) =>
  screenGeneratedWorldEvents({ events, world, game, actions, chats, agreementUpdates, warUpdates });
// The answer's records, tied to an event by its id: who starts a war by it,
// who are the parties of an agreement it starts. What an event carries, never
// its wording, says whose choice it was.
const warStart = (eventId, actors, opponents) => [{ id: "war", op: "start", actors, opponents, eventIds: [eventId], eventIndexes: [] }];
const agreementStart = (eventId, parties) => [{ id: "treaty", op: "start", type: "other", parties, eventIds: [eventId], eventIndexes: [], title: "Treaty" }];
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
  for (const [title, description] of [
    ["Russia declares war on Estonia", "The Russian government declares war on the Republic of Estonia."],
    ["Россия объявляет войну Эстонии", "Правительство России объявляет войну Эстонской Республике."],
  ]) {
    const war = event(title, description);
    const warUpdates = warStart(war.id, [RUSSIA], ["Republic of Estonia"]);
    const screened = screen(shared, [war], { warUpdates });
    assert.equal(screened.events.length, 0, title);
    assert.match(refusedFor(screened)[0]?.reason ?? "", /Russian Federation is played by a person/);

    // Ordered by the person who plays Russia, and the event cites that order: it stands.
    const ordered = screen(shared, [event(title, description, { impacts: { actionIds: ["b-war"] } })], { warUpdates, actions: [order("b-war", "Declare war on Estonia", RUSSIA)] });
    assert.equal(ordered.events.length, 1, title);
    assert.deepEqual(ordered.events[0].impacts.actionIds, ["b-war"]);
    assert.equal(ordered.events[0].agency.authority, "player-order");

    // In single player Russia is the AI's, and the same event is the world's to write.
    assert.equal(screen(solo, [war], { warUpdates }).events.length, 1);
  }
});

// The host never refuses an event for want of proof from its prose: an order
// counts when the event cites it, whatever either says, and an event that
// names no person's country as deciding is the world's.
test("a person's ordered event stands on its citation alone, in any language", () => {
  const sanctions = (title) => event(title, "", { actors: [RUSSIA], impacts: { actionIds: ["b-sanctions"] } });
  const actions = [order("b-sanctions", "Impose sanctions on Estonia", RUSSIA)];
  for (const title of ["Russia imposes sanctions on Estonia", "Россия вводит санкции против Эстонии", "俄罗斯对爱沙尼亚实施制裁"]) {
    const screened = screen(shared, [sanctions(title)], { actions });
    assert.equal(screened.events.length, 1, title);
    assert.deepEqual(refusedFor(screened), []);
    assert.equal(screened.events[0].agency.sovereignActors[0].authorityRef, "b-sanctions");
  }
});

// A player's report: a world event was filed "Not recorded: the game could
// not tell it was your government's order". It named a person's country beside
// words that sound like a decision and carried nothing of that country's.
test("a world event naming a person's country with decision-sounding words is recorded", () => {
  const events = [
    event("Estonian Parliament Approves Air Policing Over Latvia", "The Estonian government approves a new bilateral defence agreement and orders fighter aircraft to patrol Latvian airspace; the Russian government is said to recall its ambassador."),
    event("Russia's Neighbours Sign Sanctions Pact", "Estonia signs an agreement imposing new sanctions; the Russian cabinet declares a national state of emergency, observers say."),
  ];
  const screened = screen(shared, events);
  assert.deepEqual(refusedFor(screened), []);
  assert.equal(screened.events.length, 2);
});

test("one person's order never stands in for another's choice", () => {
  // The event lists Russia as the one acting, and cites the order it answers.
  const sanctions = event("Russia imposes sanctions on Estonia", "The Russian government imposes new sanctions on Estonian exports.", { actors: [RUSSIA], impacts: { actionIds: ["a-sanctions"] } });
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
  const treaty = (actionIds) => event("Latvia and Russia sign a border treaty", "Latvia and Russia sign a treaty fixing the Latgale border.", { impacts: { actionIds } });
  const latviaOrder = order("a-treaty", "Sign a border treaty with Russia fixing the Latgale border");
  const russiaOrder = order("b-treaty", "Accept Latvia's border treaty", RUSSIA);
  const agreementUpdates = agreementStart(treaty([]).id, [LATVIA, RUSSIA]);
  const refused = screen(shared, [treaty(["a-treaty"])], { actions: [latviaOrder, russiaOrder], agreementUpdates });
  assert.equal(refused.events.length, 0);
  assert.match(refusedFor(refused)[0].reason, /Russian Federation is played by a person/);

  // Russia's player agreed by an order of their own, which the event cites:
  // now both sides chose it.
  const agreed = screen(shared, [treaty(["a-treaty", "b-treaty"])], { actions: [latviaOrder, russiaOrder], agreementUpdates });
  assert.equal(agreed.events.length, 1);
  const rows = agreed.events[0].agency.sovereignActors;
  assert.deepEqual(rows.map((row) => [row.polity, row.authority, row.authorityRef]), [
    [LATVIA, "player-order", "a-treaty"],
    [RUSSIA, "player-order", "b-treaty"],
  ]);
  assert.deepEqual(agreed.events[0].impacts.actionIds, ["a-treaty", "b-treaty"]);

  // A person's message is their word to the governments they wrote to: a
  // thread is one person's with governments the AI plays, so it never speaks
  // to another person's country.
  const chats = [{
    id: "chat-border",
    player: RUSSIA,
    countries: [{ name: "Republic of Estonia" }],
    messages: [{ id: "msg-russia-yes", role: "user", speaker: RUSSIA, text: "We will sign the border treaty with Latvia." }],
  }];
  assert.equal(screen(shared, [treaty(["a-treaty"])], { actions: [latviaOrder], chats, agreementUpdates }).events.length, 0);
});

// A treaty with a government the AI plays, agreed in the person's own thread
// with that government: the person wrote to every other party, which is the
// word the engine reads. What the message said is the model's to have read
// when it wrote the treaty, in any language.
test("a person's message to the other party of a treaty is their consent to it", () => {
  const estonia = "Republic of Estonia";
  const thread = (country, speaker, text) => [{
    id: "chat-tallinn",
    player: speaker === LATVIA ? "" : speaker,
    countries: [{ name: country }],
    messages: [{ id: "msg-yes", role: "user", speaker, text }],
  }];
  for (const [title, words] of [
    ["Latvia and Estonia sign a border treaty", "We will sign the border treaty."],
    ["Latvija un Igaunija paraksta robežlīgumu", "Mēs parakstīsim robežlīgumu."],
  ]) {
    const treaty = event(title, "");
    const agreementUpdates = agreementStart(treaty.id, [LATVIA, estonia]);
    const agreed = screen(shared, [treaty], { chats: thread(estonia, LATVIA, words), agreementUpdates });
    assert.equal(agreed.events.length, 1, title);
    assert.deepEqual(agreed.events[0].agency.sovereignActors.map((row) => [row.polity, row.authority, row.authorityRef]), [
      [LATVIA, "player-commitment", "msg-yes"],
      [estonia, "autonomous", ""],
    ]);
    // Without a word to Estonia, the treaty is not Latvia's to have signed.
    assert.equal(screen(shared, [treaty], { agreementUpdates }).events.length, 0, title);
    assert.equal(screen(shared, [treaty], { chats: thread(RUSSIA, LATVIA, words), agreementUpdates }).events.length, 0, `${title}: written to another government`);
    // Russia's player writing to Estonia is no word of Latvia's.
    assert.equal(screen(shared, [treaty], { chats: thread(estonia, RUSSIA, words), agreementUpdates }).events.length, 0, `${title}: another person's message`);
  }
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

  const annexation = event("Russia annexes the Latgale border districts of Latvia", "Moscow annexes the Latgale border districts of Latvia.", { actors: [RUSSIA], impacts: { actionIds: ["b-annex"] } });
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
      politicalActorOps: [{ op: "set-strategy", polityKey: RUSSIA, argsJson: JSON.stringify({ goals: ["A doctrine nobody ordered"] }) }],
    },
  });
  assert.match(playerAgencyViolationReason(rewritten, options), /human-controlled polity Russian Federation without player-order or player-commitment/);
});

test("a person's country is known to the guard even when no ledger names it yet", () => {
  const bare = { polityOverrides: { [LATVIA]: polity(LATVIA, "Latvia") } };
  const game = { ...shared, humanCountries: [LATVIA, "Grand Duchy of Lithuania"] };
  const war = event("Grand Duchy of Lithuania declares war on Latvia", "The Grand Duchy of Lithuania declares war.");
  const screened = screenGeneratedWorldEvents({
    events: [war],
    world: bare,
    game,
    warUpdates: warStart(war.id, ["Grand Duchy of Lithuania"], [LATVIA]),
  });
  assert.equal(screened.events.length, 0);
  assert.match(refusedFor(screened)[0].reason, /Grand Duchy of Lithuania is played by a person/);
});
