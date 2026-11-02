/*! Open Historia — war weariness, alliances coming due, and peace on terms: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warAndPeace.test.js
//
// "A peace offer the player accepts or declines, with war weariness." "Also
// have war weariness, wars that end with terms and reparations." "Alliances
// that pull members into wars, with broken treaties costing reputation."
//
// Needs node_modules: gameState.js reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TREATY_BROKEN_REPUTATION } from "../../runtime/alliances.js";
import { normalizeWorldState } from "../../runtime/gameState.js";
import { TERRITORY_AS_HELD, TERRITORY_RESTORED } from "../../runtime/peaceTerms.js";
import { WEARINESS_A_YEAR, wearinessOf } from "../../runtime/warWeariness.js";
import { PUBLIC_WORLD_KEYS } from "../../multiplayer/host/projection.js";
import { playerFronts } from "../GameUI/warRoomData.js";
import {
  acceptPeaceOffer,
  answerCallToArms,
  answerPeaceProposal,
  declinePeaceOffer,
  groundReader,
  makePeace,
  offerPeace,
  peaceImpacts,
  playerDiplomacy,
  proposePeace,
  regionHoldingsFromWorld,
  turnDays,
  turnWarAndPeace,
  withReputation,
} from "./warAndPeace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").split("\r\n").join("\n");

// Aland (ten regions) and Borduria (ten) at war since the spring; Aland has taken three of Borduria's.
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "1914-03-01", lastUpdatedDate: "1914-03-01" };
const regions = (prefix, owner, count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}${index + 1}`, owner]));
const world = (extra = {}) => normalizeWorldState({
  customRegions: true,
  regionOwnershipOverrides: { ...regions("a", "Aland", 10), ...regions("b", "Borduria", 7), b8: "Aland", b9: "Aland", b10: "Aland", ...regions("c", "Cisland", 4) },
  regionSovereigntyOverrides: { b8: "Borduria", b9: "Borduria", b10: "Borduria" },
  polityOverrides: Object.fromEntries(["Aland", "Borduria", "Cisland"].map((name) => [name, { code: name, name, aliases: [], color: "", note: "" }])),
  countryStats: {
    Aland: { population: { total: 20e6 }, economy: { gdp: 4e11, publicDebt: 50 }, indices: { internationalReputation: 60 } },
    Borduria: { population: { total: 20e6 }, economy: { gdp: 2e11, publicDebt: 40 } },
  },
  wars: [WAR],
  ...extra,
});
const holder = (state, id) => state.regionOwnershipOverrides[id];
const sovereign = (state, id) => state.regionSovereigntyOverrides[id] ?? state.regionOwnershipOverrides[id];
const war = (state) => state.wars.find((entry) => entry.id === "war-1");

test("how a war stands on the ground is read from who holds what of whose", () => {
  const state = world();
  const held = regionHoldingsFromWorld(state);
  assert.deepEqual([held.get("aland"), held.get("borduria"), held.get("cisland")], [13, 7, 4]);
  const ground = groundReader(state, held);
  // Borduria has lost three of its ten regions; Aland holds three of Borduria's ten.
  assert.deepEqual(ground("war-1", "Borduria"), { lost: 0.3, taken: 0 });
  assert.deepEqual(ground("war-1", "Aland"), { lost: 0, taken: 0.3 });
  assert.deepEqual(ground("war-1", "Cisland"), { lost: 0, taken: 0 }, "no part of that war");
  assert.deepEqual(ground("no-such-war", "Aland"), { lost: 0, taken: 0 });
});

test("a peace that leaves each side what it holds cedes the ground taken; one that restores the borders gives it back", () => {
  const state = world();
  assert.deepEqual(peaceImpacts(state, WAR, TERRITORY_AS_HELD).regionTransfers.map((entry) => [entry.regionId, entry.fromCode, entry.toCode, entry.basis]), [["b8", "Borduria", "Aland", "treaty"], ["b9", "Borduria", "Aland", "treaty"], ["b10", "Borduria", "Aland", "treaty"]]);
  const ceded = makePeace(state, { warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } }, date: "1915-01-10", round: 9, by: "offer" });
  // The war is over, on that date, and says on what terms.
  assert.deepEqual([war(ceded).status, war(ceded).endedDate], ["ended", "1915-01-10"]);
  assert.ok(war(ceded).note.startsWith("Peace: each side keeps the ground it holds; Borduria pays Aland reparations of 2% of its economy a year for 5 years"));
  // The three regions are Aland's now, in law as in fact, and nobody disputes them.
  for (const id of ["b8", "b9", "b10"]) assert.deepEqual([holder(ceded, id), sovereign(ceded, id)], ["Aland", "Aland"], id);
  assert.deepEqual(ceded.regionSovereigntyOverrides, {});
  assert.equal(holder(ceded, "b1"), "Borduria");
  // Reparations begin, and the peace is kept for the story to tell.
  assert.deepEqual(ceded.reparations.map((entry) => [entry.payer, entry.receiver, entry.share, entry.days, entry.paidDays]), [["Borduria", "Aland", 0.02, 1825, 0]]);
  assert.deepEqual(ceded.peaceTreaties.map((entry) => [entry.warId, entry.title, entry.date, entry.round, entry.from, entry.to, entry.terms.territory, entry.by]), [["war-1", "The Border War", "1915-01-10", 9, "Borduria", "Aland", TERRITORY_AS_HELD, "offer"]]);

  // A white peace: the regions go back, and nothing is owed.
  const restored = makePeace(state, { warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_RESTORED }, date: "1915-01-10", round: 9, by: "settled" });
  for (const id of ["b8", "b9", "b10"]) assert.deepEqual([holder(restored, id), sovereign(restored, id)], ["Borduria", "Borduria"], id);
  assert.deepEqual([restored.regionSovereigntyOverrides, restored.reparations, war(restored).status, restored.peaceTreaties[0].by], [{}, [], "ended", "settled"]);
  assert.deepEqual(restored.regionClaimants ?? {}, {}, "and nobody is left claiming them");
  // A third country's land is no part of it; a war that is not being fought is not ended twice.
  assert.equal(holder(restored, "c1"), "Cisland");
  assert.equal(makePeace(restored, { warId: "war-1", terms: {}, date: "1915-02-01", round: 10 }), restored);
  assert.equal(makePeace(state, { warId: "no-such-war", terms: {} }), state);
});

test("an offer of peace is taken or turned down by the country it was made to", () => {
  const offer = { id: "peace:war-1:borduria:8", warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD }, date: "1915-01-01", round: 8, status: "open" };
  const state = world({ peaceOffers: [offer] });
  const taken = acceptPeaceOffer(state, offer.id, { date: "1915-01-10", round: 8 });
  assert.deepEqual([war(taken).status, taken.peaceOffers[0].status, holder(taken, "b9"), sovereign(taken, "b9")], ["ended", "accepted", "Aland", "Aland"]);
  const refused = declinePeaceOffer(state, offer.id, { round: 8 });
  assert.deepEqual([war(refused).status, refused.peaceOffers[0].status, refused.peaceOffers[0].answeredRound], ["active", "declined", 8]);
  // Answered once: a second answer changes nothing.
  assert.equal(acceptPeaceOffer(taken, offer.id, { date: "1915-01-11", round: 8 }), taken);
  assert.equal(declinePeaceOffer(refused, offer.id, { round: 9 }), refused);
  // Through the one door a person's answer comes in by, whoever's screen it is.
  const act = (op, country, ref = offer.id) => playerDiplomacy(state, { op, ref, country, players: ["Aland"], date: "1915-01-10", round: 8 });
  assert.deepEqual([act("accept", "Aland").error, act("accept", "Aland").accepted, act("accept", "Aland").to], ["", true, "Borduria"]);
  assert.equal(war(act("accept", "Aland").world).status, "ended");
  assert.deepEqual([act("decline", "Aland").error, act("decline", "Aland").accepted], ["", false]);
  assert.equal(act("accept", "Cisland").error, "not-yours", "nobody answers for another country");
  assert.equal(act("accept", "Aland", "no-such-offer").error, "not-open");
  assert.equal(act("dance", "Aland").error, "unknown");
  assert.equal(act("accept", "").error, "nobody");
  assert.equal(act("accept", "Cisland").world, state);
});

test("a person puts terms of their own, and they wait, open, for the enemy's leader to answer in the chat", () => {
  const put = (terms, players = ["Aland"]) => proposePeace(world(), { warId: "war-1", from: "Aland", terms, players, date: "1915-01-10", round: 8, chatId: "chat-b", messageId: "msg-terms" });
  const cede = { territory: TERRITORY_AS_HELD };
  const waiting = put(cede);
  assert.deepEqual([waiting.reason, waiting.to, war(waiting.world).status], ["", "Borduria", "active"], "nothing is decided by the numbers");
  assert.deepEqual(waiting.offer, { id: "peace:war-1:aland:8", warId: "war-1", from: "Aland", to: "Borduria", terms: { territory: TERRITORY_AS_HELD, reparations: null }, date: "1915-01-10", round: 8, status: "open", source: "player", chatId: "chat-b", messageId: "msg-terms" });
  // An enemy a person plays is theirs to answer, and is not answered here.
  assert.equal(put(cede, ["Aland", "Borduria"]).reason, "played");
  assert.equal(proposePeace(world(), { warId: "war-1", from: "Cisland", terms: cede }).reason, "not-in-war");
  assert.equal(proposePeace(world({ wars: [{ ...WAR, status: "ended" }] }), { warId: "war-1", from: "Aland", terms: cede }).reason, "no-war");
  const door = playerDiplomacy(world({ warWeariness: [{ country: "Borduria", value: 99 }] }), { op: "propose", ref: "war-1", terms: cede, country: "Aland", players: ["Aland"], date: "1915-01-10", round: 8 });
  assert.deepEqual([door.error, door.accepted, door.offerId, war(door.world).status], ["", false, "peace:war-1:aland:8", "active"], "however spent the enemy, it is its leader who answers");

  // Its leader's reply: accept, and the war ends on the player's terms.
  const answer = (verdict, state = waiting.world) => answerPeaceProposal(state, { from: "Borduria", to: "Aland", verdict, players: ["Aland"], date: "1915-01-12", round: 8, chatId: "chat-b", messageId: "msg-reply" });
  const yes = answer({ verdict: "accept" });
  assert.deepEqual([yes.outcome, war(yes.world).status, yes.world.peaceOffers[0].status, yes.world.peaceTreaties[0].by, holder(yes.world, "b9"), sovereign(yes.world, "b9")], ["peace", "ended", "accepted", "proposal", "Aland", "Aland"]);
  // Decline: the war goes on, and the terms are answered.
  const no = answer({ verdict: "decline" });
  assert.deepEqual([no.outcome, war(no.world).status, no.world.peaceOffers[0].status], ["declined", "active", "declined"]);
  // Counter: the player's terms are turned down, and its own put before the player, on its reply.
  const counter = answer({ verdict: "counter", terms: { territory: TERRITORY_RESTORED } });
  assert.deepEqual([counter.outcome, war(counter.world).status], ["offered", "active"]);
  assert.deepEqual(counter.world.peaceOffers.map((offer) => [offer.from, offer.to, offer.status, offer.source ?? "", offer.messageId ?? ""]), [["Aland", "Borduria", "declined", "player", "msg-terms"], ["Borduria", "Aland", "open", "counter", "msg-reply"]]);
  // A reply that says nothing of the terms leaves them open; an accept with nothing put does nothing.
  assert.equal(answer(null).outcome, "");
  assert.equal(answer({ verdict: "accept" }, world()).outcome, "");
  assert.equal(war(answer({ verdict: "accept" }, world()).world).status, "active");
  // Unasked, a leader may offer peace itself in its reply.
  const offered = answer({ verdict: "offer", terms: { territory: TERRITORY_AS_HELD } }, world());
  assert.deepEqual(offered.world.peaceOffers.map((offer) => [offer.from, offer.to, offer.source]), [["Borduria", "Aland", "chat"]]);
});

const turn = (state, extra = {}) => turnWarAndPeace({ world: state, baseWorld: state, days: 30, date: "1915-02-01", round: 9, players: ["Aland"], fronts: null, ...extra });

test("a turn moves weariness, and nobody offers peace or settles a war unless the skip says so", () => {
  const quiet = turn(world());
  assert.ok(wearinessOf(quiet.warWeariness, "Aland") > 0 && wearinessOf(quiet.warWeariness, "Borduria") > 0, "a month at war");
  // Weariness 90, a third of its country lost: still no offer. That is the AI's to make.
  const spent = turn(world({ warWeariness: [{ country: "Borduria", value: 90 }] }));
  assert.deepEqual(spent.peaceOffers, []);
  assert.equal(war(spent).status, "active");
  // What the turn did to it is counted: men called up, ground lost, a blockade.
  const level = { regionOwnershipOverrides: { ...regions("a", "Aland", 10), ...regions("b", "Borduria", 10) }, regionSovereigntyOverrides: {} };
  const hard = turn(world(level), { fronts: { manpower: [{ name: "Borduria", drawn: 400000, returned: 0 }], flips: [{ kind: "control", regionId: "b1", from: "Borduria", to: "Aland" }], sea: { blockades: [{ country: "Borduria", pressure: 0.8 }] } } });
  assert.ok(wearinessOf(hard.warWeariness, "Borduria") > wearinessOf(quiet.warWeariness, "Borduria") + 10, String(wearinessOf(hard.warWeariness, "Borduria")));
  // The same turn applied twice is the same world.
  assert.deepEqual(turn(world()), quiet);
  // A war nobody plays in, both sides spent: it goes on until the skip reports a treaty.
  const worn = world({ warWeariness: [{ country: "Aland", value: 95 }, { country: "Borduria", value: 95 }] });
  assert.equal(war(turn(worn, { players: ["Cisland"] })).status, "active", "no formula settles it");
  const refused = [];
  const settled = turn(worn, { players: ["Cisland"], treaties: [{ from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", share: 0.02, years: 5 } } }], onRefused: (entry) => refused.push(entry) });
  assert.deepEqual([war(settled).status, settled.peaceTreaties.map((entry) => [entry.from, entry.to, entry.by]), settled.reparations.map((entry) => [entry.payer, entry.receiver])], ["ended", [["Borduria", "Aland", "settled"]], [["Borduria", "Aland"]]]);
  assert.deepEqual([holder(settled, "b9"), sovereign(settled, "b9")], ["Aland", "Aland"]);
  // A treaty in a war a person is in, or between countries not at war, is refused and said why.
  const mine = turn(worn, { treaties: [{ from: "Borduria", to: "Aland", terms: {} }, { from: "Cisland", to: "Aland", terms: {} }], onRefused: (entry) => refused.push(entry) });
  assert.equal(war(mine).status, "active");
  assert.deepEqual(refused.map((entry) => entry.reason), ["a person is in that war: their peace is theirs to make", "Cisland and Aland are not at war"]);
  assert.equal(turnDays({ gameDate: "1915-01-02" }, { gameDate: "1915-02-01" }), 30);
  assert.equal(turnDays({}, { gameDate: "1915-02-01" }), 0);
});

test("a skip's letter offering a player peace is kept with the war, on the letter's own message", () => {
  const sent = offerPeace(world(), { from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", share: 0.02, years: 5 } }, players: ["Aland"], date: "1915-02-01", round: 9, source: "skip", chatId: "chat-b", messageId: "msg-peace-9-borduria" });
  assert.deepEqual(sent.offer, { id: "peace:war-1:borduria:9", warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } }, date: "1915-02-01", round: 9, status: "open", source: "skip", chatId: "chat-b", messageId: "msg-peace-9-borduria" });
  // Accepted from the chat, the war ends; declined, it goes on.
  const accepted = playerDiplomacy(sent.world, { op: "accept", ref: sent.offer.id, country: "Aland", players: ["Aland"], date: "1915-02-03", round: 9 });
  assert.deepEqual([accepted.error, war(accepted.world).status, accepted.world.reparations.length], ["", "ended", 1]);
  const declined = playerDiplomacy(sent.world, { op: "decline", ref: sent.offer.id, country: "Aland", players: ["Aland"], date: "1915-02-03", round: 9 });
  assert.deepEqual([declined.error, war(declined.world).status, declined.world.peaceOffers[0].status], ["", "active", "declined"]);
  // To a country nobody plays, or by one not at war with it: not kept.
  assert.equal(offerPeace(world(), { from: "Borduria", to: "Aland", players: [] }).offer, null);
  assert.equal(offerPeace(world(), { from: "Cisland", to: "Aland", players: ["Aland"] }).offer, null);
});

test("a country goes to war as weary as its own military figures say, where the game holds none for it yet", () => {
  const own = (extra = {}) => world({
    polityOverrides: Object.fromEntries(["Aland", "Borduria", "Cisland"].map((name) => [name, { code: name, name, aliases: [], color: "", note: "", ...(name === "Borduria" ? { military: { weariness: 70 } } : {}) }])),
    ...extra,
  });
  const month = (from) => Math.round((from + (WEARINESS_A_YEAR * 30) / 365) * 10) / 10;
  assert.equal(wearinessOf(turn(own()).warWeariness, "Borduria"), month(70));
  // The game's own figure, once it has one, is what counts.
  assert.equal(wearinessOf(turn(own({ warWeariness: [{ country: "Borduria", value: 20 }] })).warWeariness, "Borduria"), month(20));
  // A scenario that does not weigh its countries' military figures sends them to war fresh.
  assert.equal(wearinessOf(turn(own({ warSettings: { mechanics: { military: false } } })).warWeariness, "Borduria"), month(0));
  // And the land war weighs it from the period it goes to war in (frontTurn.js).
  assert.ok(read("frontTurn.js").includes("for (const entry of wearinessGoingIn(world?.warWeariness, { wars: stages.flat(), startOf: mechanics?.military === true ? (name) => readers.militaryOf(name)?.weariness ?? null : null })) {"));
});

test("reparations are paid every turn: the payer owes more and the receiver less, until they have run", () => {
  const owed = { id: "reparations:war-1:borduria:1915-01-10", warId: "war-1", payer: "Borduria", receiver: "Aland", share: 0.0365, since: "1915-01-10", days: 60, paidDays: 0 };
  const state = world({ wars: [{ ...WAR, status: "ended", endedDate: "1915-01-10" }], reparations: [owed] });
  const paid = turn(state);
  // A month of 3.65% a year is 0.3% of Borduria's economy: 0.3 points more owed by it, and half that off Aland's, whose economy is twice the size.
  assert.equal(paid.countryStats.Borduria.economy.publicDebt, 40.3);
  assert.equal(paid.countryStats.Aland.economy.publicDebt, 49.85);
  assert.equal(paid.reparations[0].paidDays, 30);
  const done = turn(paid);
  assert.deepEqual([done.reparations, done.countryStats.Borduria.economy.publicDebt], [[], 40.6]);
  assert.equal(turn(done).countryStats.Borduria.economy.publicDebt, 40.6, "and then no more");
  // The world handed in is not written to.
  assert.equal(state.countryStats.Borduria.economy.publicDebt, 40);
});

const ALLIANCE = { id: "pact-1", title: "The Northern Pact", type: "mutual_defense", status: "active", parties: ["Borduria", "Cisland"], startedDate: "1910-01-01", lastUpdatedDate: "1910-01-01", terms: "Each defends the other." };
// A war that begins this turn: it is in the world as the turn ends, and was not as it began.
const attacked = (extra = {}, base = {}) => {
  const before = world({ wars: [], agreements: [ALLIANCE], regionSovereigntyOverrides: {}, regionOwnershipOverrides: { ...regions("a", "Aland", 10), ...regions("b", "Borduria", 10), ...regions("c", "Cisland", 4) }, ...base });
  return { before, after: normalizeWorldState({ ...before, wars: [WAR], ...extra }) };
};

test("a war begun against a country brings in those bound to defend it, and one that will not come pays for it", () => {
  const { before, after } = attacked();
  const joined = turnWarAndPeace({ world: after, baseWorld: before, days: 30, date: "1914-04-01", round: 3, players: ["Aland"] });
  assert.deepEqual([war(joined).sideA, war(joined).sideB], [["Aland"], ["Borduria", "Cisland"]], "the ally is in the war, on the defender's side");
  assert.deepEqual(joined.callsToArms.map((call) => [call.ally, call.defender, call.status, call.via.title]), [["Cisland", "Borduria", "honoured", "The Northern Pact"]]);
  assert.equal(war(joined).note, WAR.note ?? "", "the war's own note is the story's");
  // On bad terms with the country it is bound to, it breaks the treaty: its standing falls and it is out of the pact.
  const sour = attacked({ relations: [{ id: "r1", a: "Borduria", b: "Cisland", score: -60, status: "strained", summary: "", lastUpdatedDate: "1914-01-01" }] });
  const broke = turnWarAndPeace({ world: sour.after, baseWorld: sour.before, days: 30, date: "1914-04-01", round: 3, players: ["Aland"] });
  assert.deepEqual(war(broke).sideB, ["Borduria"]);
  assert.deepEqual(broke.callsToArms.map((call) => call.status), ["refused"]);
  assert.equal(broke.internationalReputation.Cisland, 50 - TREATY_BROKEN_REPUTATION);
  assert.deepEqual(broke.agreements.map((entry) => [entry.id, entry.status, entry.endedDate]), [["pact-1", "ended", "1914-04-01"]]);
  // A war that was already being fought calls on nobody new, and one applied twice calls once.
  const old = attacked({}, { wars: [WAR] });
  assert.deepEqual(turnWarAndPeace({ world: old.after, baseWorld: old.before, days: 30, date: "1914-04-01", round: 3, players: [] }).callsToArms, []);
  assert.deepEqual(turnWarAndPeace({ world: after, baseWorld: before, days: 30, date: "1914-04-01", round: 3, players: ["Aland"] }), joined);
  // The story ended the pact in the same turn the war began: that is a treaty broken, and the breaker pays.
  const ended = attacked({ agreements: [{ ...ALLIANCE, status: "ended", endedDate: "1914-03-20" }] });
  const dropped = turnWarAndPeace({ world: ended.after, baseWorld: ended.before, days: 30, date: "1914-04-01", round: 3, players: ["Aland"] });
  assert.deepEqual([war(dropped).sideB, dropped.internationalReputation.Cisland], [["Borduria"], 50 - TREATY_BROKEN_REPUTATION]);
});

test("a person bound to defend a country is asked, and nobody joins a war for them", () => {
  const { before, after } = attacked();
  const asked = turnWarAndPeace({ world: after, baseWorld: before, days: 30, date: "1914-04-01", round: 3, players: ["Cisland"] });
  assert.deepEqual(war(asked).sideB, ["Borduria"], "not in the war until they say so");
  const [call] = asked.callsToArms;
  assert.deepEqual([call.ally, call.defender, call.attackers, call.status, call.round], ["Cisland", "Borduria", ["Aland"], "open", 3]);
  // Honoured: in the war beside the country it is bound to.
  const honoured = answerCallToArms(asked, call.id, true, { date: "1914-04-05", round: 3 });
  assert.deepEqual([war(honoured).sideB, honoured.callsToArms[0].status], [["Borduria", "Cisland"], "honoured"]);
  // Refused: the treaty is broken. Its standing falls, on its sheet too where its sheet has the figure, and it is out of the pact.
  const sheet = { ...asked, countryStats: { ...asked.countryStats, Cisland: { population: { total: 5e6 }, indices: { internationalReputation: 70 } } } };
  const refused = answerCallToArms(sheet, call.id, false, { date: "1914-04-05", round: 3 });
  assert.deepEqual([war(refused).sideB, refused.callsToArms[0].status], [["Borduria"], "refused"]);
  assert.equal(refused.internationalReputation.Cisland, 70 - TREATY_BROKEN_REPUTATION);
  assert.equal(refused.countryStats.Cisland.indices.internationalReputation, 70 - TREATY_BROKEN_REPUTATION);
  assert.equal(refused.agreements[0].status, "ended");
  // Through the one door: only the country called may answer, and once.
  const act = (op, country) => playerDiplomacy(asked, { op, ref: call.id, country, players: ["Cisland"], date: "1914-04-05", round: 3 });
  assert.deepEqual([act("honour", "Cisland").error, act("honour", "Cisland").accepted, act("honour", "Cisland").to], ["", true, "Borduria"]);
  assert.equal(act("refuse", "Aland").error, "not-yours");
  assert.equal(answerCallToArms(honoured, call.id, false, { round: 4 }), honoured);
  // Left unanswered, it is a treaty broken two turns on.
  const later = turnWarAndPeace({ world: asked, baseWorld: asked, days: 30, date: "1914-05-01", round: 4, players: ["Cisland"] });
  assert.equal(later.callsToArms[0].status, "open");
  const lapsed = turnWarAndPeace({ world: later, baseWorld: later, days: 30, date: "1914-06-01", round: 5, players: ["Cisland"] });
  assert.deepEqual([lapsed.callsToArms[0].status, lapsed.internationalReputation.Cisland], ["refused", 50 - TREATY_BROKEN_REPUTATION]);
});

test("a standing is set on the world and on a sheet that carries the figure", () => {
  const state = world();
  const next = withReputation(state, "aland", 41.6);
  assert.deepEqual([next.internationalReputation.Aland, next.countryStats.Aland.indices.internationalReputation], [42, 42]);
  assert.equal(state.countryStats.Aland.indices.internationalReputation, 60, "the world handed in is not written to");
  const bare = withReputation(state, "Borduria", 130);
  assert.deepEqual([bare.internationalReputation.Borduria, bare.countryStats.Borduria.indices?.internationalReputation], [100, undefined]);
  assert.equal(withReputation(state, "", 10), state);
});

test("the world keeps all of it, every player is shown it, and the turn and a person's answer reach it", () => {
  const kept = normalizeWorldState({});
  assert.deepEqual([kept.warWeariness, kept.peaceOffers, kept.reparations, kept.peaceTreaties, kept.callsToArms], [[], [], [], [], []]);
  for (const key of ["warWeariness", "peaceOffers", "reparations", "peaceTreaties", "callsToArms"]) assert.ok(PUBLIC_WORLD_KEYS.includes(key), key);
  const gameplay = read("gameplay.js");
  assert.ok(gameplay.includes("worldWithImpacts = turnWarAndPeace({\n    world: worldWithImpacts,\n    baseWorld,\n    days: turnDays(baseGame, nextGame),"));
  assert.ok(gameplay.indexOf("worldWithImpacts = turnWarAndPeace({") < gameplay.indexOf("const pruned = pruneWarUnits({"), "before the units of a war that has ended leave the map");
  assert.ok(gameplay.indexOf("worldWithImpacts = turnWarAndPeace({") > gameplay.indexOf("const diplomaticMerge = applyDiplomaticUpdates({"), "after the agreements the story wrote");
  const answer = gameplay.slice(gameplay.indexOf("export const answerDiplomacy = "), gameplay.indexOf("// What a leader nobody plays decided of peace with the player"));
  assert.ok(answer.includes("if (isSimulationBusy()) throw new Error(\"A turn is being generated; wait for it to finish.\");"), "never while a turn is being written: the turn would overwrite it");
  assert.ok(answer.includes("await mutateWorldState((world) => {"));
  assert.equal(answer.includes("callAI"), false, "no model is asked");
  // A country weary of its war keeps its armies up no better than one cut off.
  assert.ok(read("frontTurn.js").includes("if (weary > 0) short.set(fold(entry.country), shortagesTogether(short.get(fold(entry.country)) ?? 0, weary));"));
});

test("a war under an armistice can still be settled, and the ground it leaves each side passes in law", () => {
  const truce = world({ wars: [{ ...WAR, status: "ceasefire" }] });
  const ceded = makePeace(truce, { warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD }, date: "1915-01-10", round: 9, by: "offer" });
  assert.equal(war(ceded).status, "ended");
  for (const id of ["b8", "b9", "b10"]) assert.deepEqual([holder(ceded, id), sovereign(ceded, id)], ["Aland", "Aland"], id);
  const put = proposePeace(truce, { warId: "war-1", from: "Aland", terms: { territory: TERRITORY_AS_HELD }, players: ["Aland"], date: "1915-01-10", round: 8 });
  assert.notEqual(put.reason, "no-war");
  assert.equal(proposePeace(world({ wars: [{ ...WAR, status: "ended" }] }), { warId: "war-1", from: "Aland", terms: { territory: TERRITORY_AS_HELD } }).reason, "no-war");
});

test("a peace made lapses its war's open calls to arms and leaves its battlefields to the engine, and the war room no longer counts them", () => {
  const battlefield = { name: "The Border", warId: "war-1", status: "active", sides: [["Aland"], ["Borduria"]] };
  const call = { id: "call:war-1:Cobaltia", warId: "war-1", ally: "Cobaltia", defender: "Aland", status: "open", round: 1 };
  const base = world({ battlefields: [battlefield], callsToArms: [call] });
  const peace = makePeace(base, { warId: "war-1", from: "Borduria", to: "Aland", date: "1914-09-01", round: 3 });
  assert.equal(peace.callsToArms.find((entry) => entry.id === call.id)?.status, "lapsed");
  assert.deepEqual(peace.battlefields, base.battlefields);
  assert.equal(peace.wars.find((war) => war.id === "war-1")?.status, "ended");
  assert.equal(playerFronts([battlefield], "Aland", base.wars).length, 1);
  assert.equal(playerFronts([battlefield], "Aland", peace.wars).length, 0);
  assert.equal(playerFronts([battlefield], "Aland").length, 1);
});

test("countries are matched in diplomacy by their one name only", () => {
  const base = world({ peaceOffers: [{ id: "off-1", warId: "war-1", from: "Borduria", to: "Aland", status: "open", terms: { territory: TERRITORY_RESTORED, reparations: null } }] });
  assert.equal(playerDiplomacy(base, { op: "accept", ref: "off-1", country: "ALD", date: "1914-09-01", round: 3 }).error, "not-yours");
  assert.equal(proposePeace(base, { warId: "war-1", from: "ALD", terms: { territory: TERRITORY_RESTORED } }).reason, "not-in-war");
  assert.equal(playerDiplomacy(base, { op: "accept", ref: "off-1", country: "Aland", date: "1914-09-01", round: 3 }).error, "");
});
