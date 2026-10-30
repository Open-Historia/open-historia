/*! Open Historia — peace: offers, terms and reparations: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/peaceTerms.test.js
//
// "A peace offer the player accepts or declines, with war weariness." "Also
// have war weariness, wars that end with terms and reparations."

import test from "node:test";
import assert from "node:assert/strict";

import {
  PEACE_OFFER_STANDS_ROUNDS,
  REPARATIONS_SHARE_CAP,
  REPARATIONS_SHARE_MOST,
  REPARATIONS_YEARS_CAP,
  REPARATIONS_YEARS_LEAST,
  REPARATIONS_YEARS_MOST,
  TERRITORY_AS_HELD,
  TERRITORY_RESTORED,
  clampTerms,
  describeReparation,
  describeTerms,
  normalizePeaceOffers,
  normalizeReparations,
  normalizeTerms,
  offerFromAi,
  openOfferBetween,
  openOffersFor,
  readPeaceVerdict,
  readTermsLine,
  readTreatyLines,
  reparationsDue,
  reparationsOf,
  standingOf,
  termsOffered,
  termsWorth,
  treatyFromSkip,
  warBetween,
  withOffer,
  withTurnPeaceOffers,
  wouldAccept,
} from "./peaceTerms.js";

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} against ${expected}`);
const WAR = { id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria", "Cisland"] };

test("how a war stands for a country is what it holds of the enemy's less what the enemy holds of its own", () => {
  assert.equal(standingOf({ lost: 0, taken: 0 }), 0);
  assert.equal(standingOf({ lost: 0.4, taken: 0.1 }), 0.1 - 0.4);
  assert.equal(standingOf({ lost: 1, taken: 0 }), -1);
  assert.equal(standingOf({ lost: 0, taken: 9 }), 1);
  assert.equal(standingOf(), 0);
});

test("what a country offers goes by how it stands: the old borders when even, what it holds when ahead, land and money when beaten", () => {
  const offer = (standing, weariness = 60) => termsOffered({ offerer: "Borduria", receiver: "Aland", standing, weariness });
  assert.deepEqual(offer(0), { territory: TERRITORY_RESTORED, reparations: null }, "a white peace");
  assert.deepEqual(offer(0.05), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(offer(0.4), { territory: TERRITORY_AS_HELD, reparations: null }, "winning and weary: it keeps what it holds and asks nothing more");
  // Beaten: it cedes what it lost and pays, the more and the longer the worse it stands.
  const bad = offer(-0.3);
  const worse = offer(-0.9, 95);
  assert.equal(bad.territory, TERRITORY_AS_HELD);
  assert.deepEqual([bad.reparations.payer, bad.reparations.receiver], ["Borduria", "Aland"]);
  assert.ok(worse.reparations.share > bad.reparations.share && worse.reparations.years > bad.reparations.years);
  assert.ok(worse.reparations.share <= REPARATIONS_SHARE_MOST && worse.reparations.years <= REPARATIONS_YEARS_MOST);
  assert.ok(bad.reparations.years >= REPARATIONS_YEARS_LEAST);
  // Losing only a little, and fresh: it cedes the ground, and the sum is too small to write down.
  assert.deepEqual(termsOffered({ offerer: "Borduria", receiver: "Aland", standing: -0.1, weariness: 0 }), { territory: TERRITORY_AS_HELD, reparations: null });
  // Terms nobody can read are a white peace with nobody paying.
  assert.deepEqual(normalizeTerms({ territory: "everything", reparations: { payer: "A", receiver: "A", share: 0.02, years: 5 } }), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(normalizeTerms(null), { territory: TERRITORY_RESTORED, reparations: null });
});

test("terms are told in a line", () => {
  assert.equal(describeTerms({ territory: TERRITORY_RESTORED }), "every region goes back to whose it was before the war; nobody pays reparations");
  assert.equal(describeTerms({ territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.025, years: 6 } }), "each side keeps the ground it holds; Borduria pays Aland reparations of 2.5% of its economy a year for 6 years");
  assert.ok(describeTerms({ territory: TERRITORY_AS_HELD, reparations: { payer: "B", receiver: "A", share: 0.01, years: 1 } }).endsWith("for 1 year"));
});

// No longer what decides: what the game reckons, told to the model (AI/warStatsPrompt.js).
test("a country nobody plays takes terms no worse than the war promises it, and the wearier it is the worse it takes", () => {
  const cede = { territory: TERRITORY_AS_HELD, reparations: null };
  const white = { territory: TERRITORY_RESTORED, reparations: null };
  // Winning and fresh: it will not hand back what it has taken, nor stop at it. It expects more.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0.5, weariness: 0 }), false);
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: 0.5, weariness: 0 }), false);
  // Half-weary, it expects the war to end as it stands, and keeping what it holds will do.
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: 0.5, weariness: 50 }), true);
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0.5, weariness: 90 }), false, "however worn, it does not hand back half a country");
  // Only a little ahead and worn out: the old borders will do.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0.1, weariness: 90 }), true);
  // Level and fresh, it does not want peace at all yet; level and weary, it does.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0, weariness: 0 }), false);
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0, weariness: 50 }), true);
  // Losing: a white peace is a gift, and ceding what it lost is what the war promises anyway.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: -0.4, weariness: 20 }), true);
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: -0.4, weariness: 20 }), false, "fresh, it fights on rather than sign the ground away");
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: -0.4, weariness: 70 }), true, "spent, it signs");
  // Money counts: being paid makes terms better, paying makes them worse.
  const paid = { territory: TERRITORY_RESTORED, reparations: { payer: "Aland", receiver: "Borduria", share: 0.04, years: 12 } };
  assert.ok(termsWorth(paid, "Borduria", 0) > 0 && termsWorth(paid, "Aland", 0) < 0);
  assert.equal(termsWorth(paid, "Cisland", 0), 0, "nothing to a country it is not about");
  assert.equal(wouldAccept({ terms: paid, country: "Aland", standing: 0, weariness: 0 }), false);
  assert.equal(wouldAccept({ terms: paid, country: "Aland", standing: -0.6, weariness: 80 }), true);
});

const stand = (table) => (warId, name) => table[name] ?? { lost: 0, taken: 0 };

// "make it so it only happens when the simulation says the country sends a
// peace treaty, it should not be fully deterministic anymore" (the owner, 2026-10-30).
test("a turn offers nobody peace by itself, however weary a country is: open offers only lapse", () => {
  const open = { id: "peace:war-1:borduria:7", warId: "war-1", from: "Borduria", to: "Aland", terms: {}, round: 7, status: "open", source: "skip", chatId: "chat-1", messageId: "msg-peace-7-borduria" };
  assert.deepEqual(withTurnPeaceOffers([], { wars: [WAR], round: 9 }), [], "no offer is made: the AI makes them");
  const kept = withTurnPeaceOffers([open], { wars: [WAR], round: 7 + PEACE_OFFER_STANDS_ROUNDS - 1 });
  assert.deepEqual(kept, [{ ...open, date: "", terms: { territory: TERRITORY_RESTORED, reparations: null } }], "where it was made is kept with it");
  assert.deepEqual(withTurnPeaceOffers([open], { wars: [WAR], round: 7 + PEACE_OFFER_STANDS_ROUNDS }).map((offer) => offer.status), ["lapsed"]);
  assert.deepEqual(withTurnPeaceOffers([open], { wars: [{ ...WAR, status: "ended" }], round: 8 }).map((offer) => offer.status), ["lapsed"]);
  // What the world keeps is checked: an offer with nobody in it is none.
  assert.deepEqual(normalizePeaceOffers([{ id: "x", warId: "w", from: "A", to: "A" }, { id: "", warId: "w", from: "A", to: "B" }, null]), []);
  assert.deepEqual(openOffersFor([open], "aland").length, 1);
  assert.deepEqual(openOffersFor([open], "Borduria"), []);
  assert.equal(openOfferBetween([open], "aland", "BORDURIA").id, open.id, "either way round");
});

test("an AI's offer to a person is checked: their war, the person's country played, the AI's side nobody's", () => {
  const made = offerFromAi({ from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", share: 0.5, years: 99 } }, wars: [WAR], players: ["Aland"], round: 7, date: "1915-03-01", chatId: "chat-1", messageId: "m1" });
  assert.deepEqual(made.offer, {
    id: "peace:war-1:borduria:7", warId: "war-1", from: "Borduria", to: "Aland",
    terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: REPARATIONS_SHARE_CAP, years: REPARATIONS_YEARS_CAP } },
    date: "1915-03-01", round: 7, status: "open", source: "skip", chatId: "chat-1", messageId: "m1",
  }, "the terms are held to what the game allows, and the receiver is the other side");
  assert.match(offerFromAi({ from: "Borduria", to: "Aland", wars: [WAR], players: [] }).reason, /played by nobody/);
  assert.match(offerFromAi({ from: "Dorland", to: "Aland", wars: [WAR], players: ["Aland"] }).reason, /not at war/);
  assert.match(offerFromAi({ from: "Borduria", to: "Aland", wars: [WAR], players: ["Aland", "Cisland"] }).reason, /led by a person/);
  assert.match(offerFromAi({ from: "Borduria", to: "Aland", wars: [{ ...WAR, status: "ended" }], players: ["Aland"] }).reason, /not at war/);
  // Reparations by somebody outside the peace are dropped, never guessed onto a side.
  assert.equal(clampTerms({ territory: TERRITORY_RESTORED, reparations: { payer: "Dorland", receiver: "Aland", share: 0.02, years: 5 } }, { from: "Borduria", to: "Aland" }).reparations, null);
  // A new offer between the same two in the same war takes the place of the last.
  const first = made.offer;
  const second = offerFromAi({ from: "Borduria", to: "Aland", terms: {}, wars: [WAR], players: ["Aland"], round: 8 }).offer;
  assert.deepEqual(withOffer([first], second).map((offer) => [offer.id, offer.status]), [[first.id, "lapsed"], [second.id, "open"]]);
});

test("the AI writes terms and answers in words, and the game reads them", () => {
  const parties = { from: "Borduria", to: "Aland" };
  assert.deepEqual(readTermsLine("as held; Borduria pays 2% for 5 years", parties), { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } });
  assert.deepEqual(readTermsLine("restored; none", parties), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(readTermsLine("each side keeps what it holds; Aland pays 1.5% of its economy a year for 3 years", parties).reparations, { payer: "Aland", receiver: "Borduria", share: 0.015, years: 3 });
  assert.deepEqual(readTermsLine("the old borders", parties), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(readPeaceVerdict("accept", parties), { verdict: "accept" });
  assert.deepEqual(readPeaceVerdict("Declined.", parties), { verdict: "decline" });
  assert.deepEqual(readPeaceVerdict("refuse", parties), { verdict: "decline" });
  assert.deepEqual(readPeaceVerdict("counter: restored; none", parties), { verdict: "counter", terms: { territory: TERRITORY_RESTORED, reparations: null } });
  assert.deepEqual(readPeaceVerdict("offer as held; Borduria pays 1% for 4 years", parties).terms.reparations.years, 4);
  assert.equal(readPeaceVerdict("we will think about it", parties), null, "nothing it can read is nothing done");
  // The skip's peaceTreaties lines.
  assert.deepEqual(readTreatyLines("Borduria | Aland | as held; Borduria pays 2% for 5 years\n- Eland | Fenland | restored\nnonsense"), [
    { from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } } },
    { from: "Eland", to: "Fenland", terms: { territory: TERRITORY_RESTORED, reparations: null } },
  ]);
  assert.deepEqual(readTreatyLines(""), []);
  assert.deepEqual(readTreatyLines(undefined), []);
});

test("two countries nobody plays make peace only when the skip says so, and never in a war a person is in", () => {
  assert.deepEqual(treatyFromSkip({ from: "Borduria", to: "Aland", terms: { territory: TERRITORY_RESTORED }, wars: [WAR], players: [] }).treaty, { warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_RESTORED, reparations: null } });
  assert.match(treatyFromSkip({ from: "Borduria", to: "Aland", wars: [WAR], players: ["Cisland"] }).reason, /person is in that war/);
  assert.match(treatyFromSkip({ from: "Borduria", to: "Cisland", wars: [WAR], players: [] }).reason, /not at war/, "two on the same side are not at war with each other");
  assert.equal(warBetween([WAR], "cisland", "ALAND").id, "war-1");
  assert.equal(warBetween([{ ...WAR, status: "ceasefire" }], "Borduria", "Aland").id, "war-1", "a war under an armistice can still be settled");
  void stand;
});

test("reparations are paid a period at a time out of the payer's economy, until they have run their years", () => {
  const terms = { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 2 } };
  const begun = reparationsOf(terms, { warId: "war-1", date: "1916-01-01" });
  assert.deepEqual(begun, [{ id: "reparations:war-1:borduria:1916-01-01", warId: "war-1", payer: "Borduria", receiver: "Aland", share: 0.02, since: "1916-01-01", days: 730, paidDays: 0 }]);
  assert.deepEqual(reparationsOf({ territory: TERRITORY_RESTORED }), []);
  const gdpOf = (name) => (name === "Borduria" ? 1e11 : 0);
  const year = reparationsDue(begun, { days: 365, gdpOf });
  near(year.payments[0].amount, 2e9, "2% of its economy in a year");
  near(year.payments[0].share, 0.02);
  assert.deepEqual([year.payments[0].payer, year.payments[0].receiver, year.reparations[0].paidDays], ["Borduria", "Aland", 365]);
  // A month of it.
  near(reparationsDue(begun, { days: 30, gdpOf }).payments[0].amount, (1e11 * 0.02 * 30) / 365);
  // The last stretch pays only the days that are left, and then they are done.
  const last = reparationsDue(year.reparations, { days: 900, gdpOf });
  near(last.payments[0].share, 0.02);
  assert.deepEqual(last.reparations, []);
  assert.deepEqual(reparationsDue([], { days: 365, gdpOf }), { reparations: [], payments: [] });
  // A payer with no economy on its sheet pays in the story only: the days still count.
  const silent = reparationsDue(begun, { days: 100, gdpOf: () => 0 });
  assert.deepEqual([silent.payments, silent.reparations[0].paidDays], [[], 100]);
  assert.equal(describeReparation(begun[0]), "Borduria pays Aland 2% of its economy a year in reparations, for 2 more years");
  assert.equal(describeReparation(last.reparations[0]), "");
  assert.ok(describeReparation({ ...begun[0], paidDays: 700 }).endsWith("for 1 more month"));
  assert.deepEqual(normalizeReparations([{ ...begun[0], paidDays: 730 }, { id: "x", payer: "A", receiver: "A", share: 1, days: 9 }, null]), [], "paid off, or owed to oneself: not kept");
});
