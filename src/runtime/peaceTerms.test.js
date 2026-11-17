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

test("the AI writes terms and answers in the game's form, and the game reads them", () => {
  const parties = { from: "Borduria", to: "Aland" };
  assert.deepEqual(readTermsLine("as held; pay~Borduria~2~5", parties), { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } });
  assert.deepEqual(readTermsLine("restored", parties), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(readTermsLine("ground~as held", parties).territory, TERRITORY_AS_HELD, "the ground as a record too");
  assert.deepEqual(readTermsLine(" As  Held ; pay~Aland~1,5 %~3 ans", parties), { territory: TERRITORY_AS_HELD, reparations: { payer: "Aland", receiver: "Borduria", share: 0.015, years: 3 } }, "case and spacing fold; a figure is a figure");
  assert.deepEqual(readTermsLine("", parties), { territory: TERRITORY_RESTORED, reparations: null }, "no ground written is the old borders");
  assert.deepEqual(readPeaceVerdict("accept", parties), { verdict: "accept" });
  assert.deepEqual(readPeaceVerdict("Decline.", parties), { verdict: "decline" });
  assert.deepEqual(readPeaceVerdict("counter: restored", parties), { verdict: "counter", terms: { territory: TERRITORY_RESTORED, reparations: null } });
  assert.deepEqual(readPeaceVerdict("offer as held; pay~Borduria~1~4", parties).terms.reparations.years, 4);
  assert.equal(readPeaceVerdict("we will think about it", parties), null, "nothing it can read is nothing done");
  // The verdict is one of the game's four words, as it is written: no English
  // word for it is read, and no other.
  for (const off of ["accepted", "refuse", "reject", "counter-offer as held", "accepte", "acepta", "принять"]) {
    assert.equal(readPeaceVerdict(off, parties), null, off);
  }
  // The skip's peaceTreaties lines.
  assert.deepEqual(readTreatyLines("Borduria | Aland | as held; pay~Borduria~2~5\n- Eland | Fenland | restored\nnonsense"), [
    { from: "Borduria", to: "Aland", terms: { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } } },
    { from: "Eland", to: "Fenland", terms: { territory: TERRITORY_RESTORED, reparations: null } },
  ]);
  assert.deepEqual(readTreatyLines(""), []);
  assert.deepEqual(readTreatyLines(undefined), []);
});

// The terms were read as English sentences: "Borduria cède Klow à Syldavia"
// was a mere condition, its ground went back, and a French "accepte" made no
// peace; in English, "Syldavia keeps its army" read as the ground as held.
// What a term does is now what its record says, in every language alike, and
// words in any language are a condition, which never moves the ground.
test("terms written by a model playing in French are read exactly as their English twin", () => {
  const two = { from: "Syldavia", to: "Borduria" };
  const english = readTermsLine("as held; cede~Klow~Syldavia; cede~Szohod~Syldavia; puppet~Borduria~client; pay~Borduria~2~5; condition~the border forts are razed", two);
  const french = readTermsLine("as held; cede~Klow~Syldavia; cede~Szohod~Syldavia; puppet~Borduria~client; pay~Borduria~2~5; condition~les forts frontaliers sont rasés", two);
  const { conditions: frenchConditions, ...frenchTerms } = french;
  const { conditions: englishConditions, ...englishTerms } = english;
  assert.deepEqual(frenchTerms, englishTerms);
  assert.deepEqual(frenchTerms.cessions, [{ region: "Klow", to: "Syldavia" }, { region: "Szohod", to: "Syldavia" }]);
  assert.deepEqual([englishConditions, frenchConditions], [["the border forts are razed"], ["les forts frontaliers sont rasés"]]);
  // A region named as the map names it, in its own script.
  assert.deepEqual(readTermsLine("cede~Île-de-France~Syldavia; cede~region: Москва~Borduria", two).cessions, [{ region: "Île-de-France", to: "Syldavia" }, { region: "Москва", to: "Borduria" }]);
  // Words are a condition, in any language: they never decide the ground.
  for (const words of ["Borduria cède Klow à Syldavia", "Borduria cedes Klow to Syldavia", "Syldavia keeps its army", "each side keeps what it holds"]) {
    assert.deepEqual(readTermsLine(words, two), { territory: TERRITORY_RESTORED, reparations: null, conditions: [words] }, words);
  }
  // A French acceptance is the game's word, as an English one is.
  assert.deepEqual(readPeaceVerdict("accept", two), readPeaceVerdict("ACCEPT.", two));
  assert.deepEqual(readPeaceVerdict("counter as held; condition~les ponts sont rendus", two).terms, { territory: TERRITORY_AS_HELD, reparations: null, conditions: ["les ponts sont rendus"] });
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

test("terms beyond the ground and the money: read from a line, from a letter, held to the two, and weighed", async () => {
  const { describeTerms, offerFromAi, readTermsLine, termsOfLetter, termsWorth } = await import("./peaceTerms.js");
  const two = { from: "Syldavia", to: "Borduria" };
  const read = readTermsLine("as held; cede~Klow~Syldavia; cede~Szohod~Syldavia; puppet~Borduria~client; pay~Syldavia~1~3; condition~no army on the river", two);
  assert.deepEqual(read, {
    territory: "as held",
    reparations: { payer: "Syldavia", receiver: "Borduria", share: 0.01, years: 3 },
    cessions: [{ region: "Klow", to: "Syldavia" }, { region: "Szohod", to: "Syldavia" }],
    puppet: { subject: "Borduria", overlord: "Syldavia", kind: "client" },
    conditions: ["no army on the river"],
  });
  assert.equal(describeTerms(read), "each side keeps the ground it holds; Klow and Szohod pass to Syldavia; Borduria becomes Syldavia's client state; Syldavia pays Borduria reparations of 1% of its economy a year for 3 years; and: no army on the river");
  assert.deepEqual(readTermsLine("annex~Borduria", two).annexed, { country: "Borduria", by: "Syldavia" });
  assert.deepEqual(readTermsLine("annex~Syldavia", two).annexed, { country: "Syldavia", by: "Borduria" });
  assert.deepEqual(readTermsLine("puppet~Borduria~protectorate", two).puppet, { subject: "Borduria", overlord: "Syldavia", kind: "protectorate" });
  assert.deepEqual(readTermsLine("puppet~Borduria", two).puppet, { subject: "Borduria", overlord: "Syldavia", kind: "satellite" }, "no kind written: a satellite");
  // A record missing a field is no term, and no condition either.
  assert.deepEqual(readTermsLine("cede~Klow; annex~; pay~Borduria", two), { territory: "restored", reparations: null });
  // A country is one of the two by its own name: a third, or a name the game does not use for either, is no part of it.
  const third = readTermsLine("annex~Ruritania; cede~Klow~Ruritania; puppet~the Kingdom of Borduria~client", two);
  assert.deepEqual([third.annexed, third.cessions, third.puppet], [undefined, undefined, undefined]);
  // A letter's moreTerms, read between the two when the offer is made.
  const letter = termsOfLetter({ territory: "as held", reparationsPayer: "", moreTerms: "annex~Borduria" });
  assert.equal(letter.more, "annex~Borduria");
  const made = offerFromAi({ from: "Syldavia", to: "Borduria", terms: letter, wars: [{ id: "w", status: "active", sideA: ["Syldavia"], sideB: ["Borduria"] }], players: ["Borduria"], round: 3 });
  assert.deepEqual(made.offer.terms.annexed, { country: "Borduria", by: "Syldavia" });
  // Weighed: annexed is everything, a puppet much, a region a little.
  assert.equal(termsWorth(made.offer.terms, "Borduria", 0), -1);
  assert.equal(termsWorth(made.offer.terms, "Syldavia", 0), 1);
  assert.ok(termsWorth(read, "Syldavia", 0) > 0.5 && termsWorth(read, "Borduria", 0) < -0.5);
});

// A ledger that started the war twice: the player's offer waits in the twin warBetween does not find first, and the
// skip's line accepting it was refused, "a person is in that war" (ff199dc1 meant the twins to settle together).
test("a person's open offer is accepted in whichever of two twin wars it waits in", () => {
  const twin = { ...WAR, id: "war-1b" };
  const offers = [{ id: "peace:war-1b:cisland:4", warId: "war-1b", from: "Cisland", to: "Aland", terms: { territory: TERRITORY_RESTORED, reparations: null }, status: "open" }];
  const checked = treatyFromSkip({ from: "Aland", to: "Cisland", wars: [WAR, twin], players: ["Cisland"], offers });
  assert.equal(checked.treaty?.warId, "war-1b");
  assert.equal(checked.treaty?.accepts, "peace:war-1b:cisland:4");
  assert.match(treatyFromSkip({ from: "Aland", to: "Cisland", wars: [WAR, { ...twin, status: "ended" }], players: ["Cisland"], offers }).reason, /person is in that war/, "not in a war already settled");
});
