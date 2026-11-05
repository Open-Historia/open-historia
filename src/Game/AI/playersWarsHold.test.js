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
  assert.match(gameplay, /const playersWars = holdPlayersWars\(\{ updates: result\.warUpdates, events: curatedEvents, wars: baseWorld\?\.wars, players: humanCountriesOf\(baseGame\), orders: baseActions \}\);/);
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
