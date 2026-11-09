// Run: node --test src/Game/AI/playersWarsHold.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { holdPlayersWars } from "./playersWarsHold.js";

const wars = [
  { id: "war-russia-ukraine", sideA: ["Russian Federation"], sideB: ["Ukraine"], status: "active" },
  { id: "war-france-belgium", sideA: ["France"], sideB: ["Belgium"], status: "active" },
];
const events = [
  { id: "evt-1", title: "Russo-Ukrainian peace treaty concluded in Geneva", warId: "war-russia-ukraine", impacts: { regionTransfers: [{ regionId: "UKR.25_1", toCode: "Ukraine" }] } },
  { id: "evt-2", title: "Fighting around Bakhmut", warId: "war-russia-ukraine" },
  { id: "evt-3", title: "France and Belgium sign an armistice", warId: "war-france-belgium" },
];

test("a skip that ends a player's war is refused, with the event that told it", () => {
  const updates = [{ id: "war-russia-ukraine", op: "end", actors: ["Russian Federation"], opponents: ["Ukraine"], eventIds: ["evt-1"] }];
  const held = holdPlayersWars({ updates, events, wars, players: ["Ukraine"] });
  assert.deepEqual(held.refused.map((update) => update.op), ["end"]);
  assert.deepEqual(held.updates, []);
  assert.deepEqual(held.events.map((event) => event.id), ["evt-2", "evt-3"], "the peace and its map changes go; the war's other events stay");
});

test("so is a ceasefire in it, and the player's country leaving it", () => {
  const updates = [
    { id: "war-russia-ukraine", op: "ceasefire", actors: [], opponents: [], eventIds: [] },
    { id: "war-russia-ukraine", op: "leave", actors: ["ukraine"], opponents: [], eventIds: [] },
  ];
  const held = holdPlayersWars({ updates, events, wars, players: ["Ukraine"] });
  assert.equal(held.refused.length, 2);
  assert.equal(held.events.length, 3);
});

test("a war between countries nobody plays may still end, and an ally may still leave the player's war", () => {
  const updates = [
    { id: "war-france-belgium", op: "end", actors: ["France"], opponents: ["Belgium"], eventIds: ["evt-3"] },
    { id: "war-russia-ukraine", op: "leave", actors: ["Belarus"], opponents: [], eventIds: [] },
    { id: "war-russia-ukraine", op: "join-b", actors: ["Poland"], opponents: [], eventIds: [] },
  ];
  const held = holdPlayersWars({ updates, events, wars, players: ["Ukraine"] });
  assert.deepEqual(held.refused, []);
  assert.equal(held.updates.length, 3);
  assert.equal(held.events.length, 3);
});

test("a war that is not in the ledger yet is left to the ledger", () => {
  const updates = [{ id: "war-new", op: "end", actors: ["Ukraine"], opponents: ["Moldova"], eventIds: [] }];
  assert.deepEqual(holdPlayersWars({ updates, events, wars, players: ["Ukraine"] }).refused, []);
});

test("the turn holds a player's wars before it keeps the ledger records, and the skip is told the rule", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /const playersWars = holdPlayersWars\(\{ updates: result\.warUpdates, events: curatedEvents, wars: baseWorld\?\.wars, players: humanCountriesOf\(baseGame\), orders: baseActions, offers: baseWorld\?\.peaceOffers \}\);/);
  assert.match(gameplay, /filterBoundLedgerUpdatesToKeptEvents\(playersWars\.updates, dedupedEvents, curatedEvents\)/);
  const prompt = fs.readFileSync(new URL("./peacePrompt.js", import.meta.url), "utf8");
  assert.match(prompt, /A player's order to end their war is their offer of peace/);
});

// "an action shouldnt inherently be able to end a war, but it offers peace to the opponent" (the owner, 2026-11-03).
test("an ending the player's own order brought about is refused too, and handed back as their offer of peace", () => {
  const ordered = [
    ...events,
    { id: "evt-4", title: "Ukraine offers to end the war", impacts: { actionIds: ["action-end"] } },
    { id: "evt-5", title: "Ukraine signs the Geneva peace", impacts: { actionIds: ["action-other"] } },
  ];
  const orders = [{ id: "action-end", text: "the war is over, bring the troops home" }, { id: "action-other", country: "Moldova", text: "a trade deal" }];
  const update = { id: "war-russia-ukraine", op: "end", actors: [], opponents: [], eventIds: ["evt-4"] };
  const held = holdPlayersWars({ updates: [update], events: ordered, wars, players: ["Ukraine"], orders });
  assert.deepEqual(held.updates, []);
  assert.equal(held.refused.length, 1);
  assert.deepEqual(held.proposals, [{ warId: "war-russia-ukraine", from: "Ukraine", update }]);
  const theirs = holdPlayersWars({ updates: [{ ...update, eventIds: ["evt-5"] }], events: ordered, wars, players: ["Ukraine"], orders });
  assert.deepEqual(theirs.proposals, [], "an order given for a country that is not in the war offers nothing");
  assert.deepEqual(holdPlayersWars({ updates: [{ ...update, eventIds: ["evt-1"] }], events: ordered, wars, players: ["Ukraine"], orders }).proposals, []);
});

// A player's offer of peace waiting in the war is the peace it may end by: a
// skip that ends the war over it is the other side saying yes (a player's 1973
// game, 2026-11-08: North Vietnam's end refused twice over the US's own offer).
test("a skip's end of a player's war over that player's open offer of peace accepts the offer, and its events stay", () => {
  const offers = [{ id: "peace:war-russia-ukraine:ukraine:3", warId: "war-russia-ukraine", from: "Ukraine", to: "Russian Federation", terms: { territory: "restored", reparations: null }, status: "open" }];
  const update = { id: "war-russia-ukraine", op: "end", actors: ["Russian Federation"], opponents: ["Ukraine"], eventIds: ["evt-1"] };
  const held = holdPlayersWars({ updates: [update], events, wars, players: ["Ukraine"], offers });
  assert.deepEqual(held.updates, [], "the game ends the war by the peace, not by the record");
  assert.deepEqual(held.accepted, [{ warId: "war-russia-ukraine", from: "Ukraine", to: "Russian Federation", update }]);
  assert.deepEqual(held.proposals, []);
  assert.deepEqual(held.events.map((event) => event.id), ["evt-1", "evt-2", "evt-3"], "the event that tells the peace stays");

  // A ceasefire is not the peace offered, and an offer already answered, made by the other side or in another war accepts nothing.
  assert.deepEqual(holdPlayersWars({ updates: [{ ...update, op: "ceasefire" }], events, wars, players: ["Ukraine"], offers }).accepted, []);
  for (const other of [{ ...offers[0], status: "declined" }, { ...offers[0], from: "Russian Federation", to: "Ukraine" }, { ...offers[0], warId: "war-france-belgium" }]) {
    const none = holdPlayersWars({ updates: [update], events, wars, players: ["Ukraine"], offers: [other] });
    assert.deepEqual(none.accepted, []);
    assert.deepEqual(none.events.map((event) => event.id), ["evt-2", "evt-3"]);
  }
});

test("the turn makes the accepted peace beside the skip's own treaties", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /\.\.\.playersWars\.accepted\.filter\(\(entry\) => !toldTreaties\.some\(\(line\) => samePair\(line, entry\)\)\)\.map\(\(\{ from, to \}\) => \(\{ from, to, terms: null \}\)\)/);
  assert.match(gameplay, /treaties: turnTreaties,/);
});

// "an action shouldnt inherently be able to end a war, but it offers peace to the opponent" (the owner): peace
// needs the other side. The player's own order to end the war while their offer waits stays their proposal, and
// the battle the player loses that carries the war's end (the ledger's rule) is no yes to the player's terms.
test("with the player's offer open, their own order's end stays a proposal, and only the other side's end accepts", () => {
  const offers = [{ id: "peace:war-russia-ukraine:ukraine:3", warId: "war-russia-ukraine", from: "Ukraine", to: "Russian Federation", terms: { territory: "restored", reparations: null }, status: "open" }];
  const told = [
    ...events,
    { id: "evt-4", title: "Ukraine declares the war over", impacts: { actionIds: ["action-end"] } },
    { id: "evt-6", title: "Kyiv falls", warId: "war-russia-ukraine", combatants: ["Russian Federation", "Ukraine"] },
  ];
  const orders = [{ id: "action-end", text: "END THE WAR RIGHT NOW" }];
  const ordered = { id: "war-russia-ukraine", op: "end", actors: ["Russian Federation"], opponents: ["Ukraine"], eventIds: ["evt-4"] };
  const held = holdPlayersWars({ updates: [ordered], events: told, wars, players: ["Ukraine"], orders, offers });
  assert.deepEqual(held.accepted, [], "the player's own order is not the enemy accepting");
  assert.deepEqual(held.proposals, [{ warId: "war-russia-ukraine", from: "Ukraine", update: ordered }]);

  const battle = { id: "war-russia-ukraine", op: "end", actors: ["Russian Federation"], opponents: ["Ukraine"], eventIds: ["evt-6"] };
  const lost = holdPlayersWars({ updates: [battle], events: told, wars, players: ["Ukraine"], orders, offers });
  assert.deepEqual(lost.accepted, [], "a battle the player loses accepts nothing");
  assert.ok(!lost.events.some((event) => event.id === "evt-6"), "and is refused with the event that told it");

  const theirs = { id: "war-russia-ukraine", op: "end", actors: ["Ukraine"], opponents: ["Russian Federation"], eventIds: ["evt-1"] };
  assert.deepEqual(holdPlayersWars({ updates: [theirs], events: told, wars, players: ["Ukraine"], orders, offers }).accepted, [], "an end the other side is not the doer of accepts nothing");
});
