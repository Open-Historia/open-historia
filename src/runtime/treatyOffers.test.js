/*! Open Historia — treaties people sign: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { TREATY_OFFER_STANDS_ROUNDS, answerTreaty, normalizeTreatyOffers, proposeTreaty, withTurnTreatyOffers } from "./treatyOffers.js";
import { defendersOf } from "./alliances.js";
import { normalizeWorldState } from "./gameState.js";

const PEOPLE = ["Aland", "Borduria", "Cisland"];
const base = (extra = {}) => ({ wars: [], agreements: [], treatyOffers: [], ...extra });
const put = (world, extra = {}) => proposeTreaty(world, { from: "Aland", to: "Borduria", type: "mutual_defense", title: "The Northern Pact", terms: "Each defends the other.\nFor ten years.", players: PEOPLE, date: "1915-01-10", round: 8, ...extra });

// "Treaties and alliances between people: a sign action both must accept, which becomes a record the map, wars and AI
// governments all see" (the owner, 2026-11-15).
test("a treaty one player puts to another waits for their signature, and signed is an agreement of the world's", () => {
  const offered = put(base());
  assert.equal(offered.reason, "");
  assert.deepEqual([offered.offer.from, offered.offer.to, offered.offer.type, offered.offer.status, offered.offer.terms], ["Aland", "Borduria", "mutual_defense", "open", "Each defends the other.\nFor ten years."]);
  // Only the one it was put to signs or declines it; only the one who put it withdraws it.
  assert.equal(answerTreaty(offered.world, { op: "sign", ref: offered.offer.id, country: "Aland" }).error, "not-yours");
  assert.equal(answerTreaty(offered.world, { op: "withdraw", ref: offered.offer.id, country: "Borduria" }).error, "not-yours");
  const signed = answerTreaty(offered.world, { op: "sign", ref: offered.offer.id, country: "Borduria", date: "1915-01-12", round: 8 });
  assert.equal(signed.error, "");
  assert.deepEqual([signed.agreement.type, signed.agreement.status, signed.agreement.parties, signed.agreement.startedDate], ["mutual_defense", "active", ["Aland", "Borduria"], "1915-01-12"]);
  assert.deepEqual(signed.world.treatyOffers.map((offer) => [offer.status, offer.agreementId]), [["signed", signed.agreement.id]]);
  // The world keeps it as any agreement, and the alliance binds as any: each is bound to defend the other.
  const kept = normalizeWorldState({ ...signed.world, polityOverrides: Object.fromEntries(PEOPLE.map((name) => [name, { code: name, name, aliases: [], color: "", note: "" }])) });
  assert.deepEqual(kept.agreements.map((agreement) => [agreement.title, agreement.type, agreement.status, agreement.parties]), [["The Northern Pact", "mutual_defense", "active", ["Aland", "Borduria"]]]);
  assert.deepEqual(defendersOf(kept, "Aland").map((entry) => entry.ally), ["Borduria"]);
  // Answered once.
  assert.equal(answerTreaty(signed.world, { op: "decline", ref: offered.offer.id, country: "Borduria" }).error, "not-open");
  const declined = answerTreaty(offered.world, { op: "decline", ref: offered.offer.id, country: "Borduria", round: 8 });
  assert.deepEqual([declined.error, declined.world.treatyOffers[0].status, declined.world.agreements], ["", "declined", []]);
  const withdrawn = answerTreaty(offered.world, { op: "withdraw", ref: offered.offer.id, country: "Aland", round: 8 });
  assert.equal(withdrawn.world.treatyOffers[0].status, "withdrawn");
});

test("a treaty is put only between two players not at war with each other, one at a time, of a kind they may sign", () => {
  assert.equal(put(base(), { to: "Dorland" }).reason, "not-played", "a country the AI plays makes its agreements in the story");
  assert.equal(put(base(), { to: "Aland" }).reason, "nobody");
  assert.equal(put(base(), { type: "guarantee" }).reason, "type");
  assert.equal(put(base(), { type: "peace_settlement" }).reason, "type");
  const war = { id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria"] };
  assert.equal(put(base({ wars: [war] })).reason, "at-war");
  const first = put(base());
  assert.equal(put(first.world, { from: "Borduria", to: "Aland", type: "trade_economic" }).reason, "open", "one waits between the two already");
  assert.equal(put(first.world, { to: "Cisland" }).reason, "", "another pair is another treaty");
  // Signed after the two went to war, it lapses.
  const atWar = answerTreaty({ ...first.world, wars: [war] }, { op: "sign", ref: first.offer.id, country: "Borduria", round: 9 });
  assert.deepEqual([atWar.error, atWar.world.treatyOffers[0].status, atWar.world.agreements], ["at-war", "lapsed", []]);
});

test("an offer nobody answers lapses with time, or when the two go to war; the list keeps every open one", () => {
  const first = put(base());
  assert.equal(withTurnTreatyOffers(first.world.treatyOffers, { round: 8 + TREATY_OFFER_STANDS_ROUNDS - 1 })[0].status, "open");
  assert.equal(withTurnTreatyOffers(first.world.treatyOffers, { round: 8 + TREATY_OFFER_STANDS_ROUNDS })[0].status, "lapsed");
  const war = { id: "war-1", status: "active", sideA: ["Borduria"], sideB: ["Aland"] };
  assert.equal(withTurnTreatyOffers(first.world.treatyOffers, { wars: [war], round: 9 })[0].status, "lapsed");
  const many = Array.from({ length: 60 }, (_, at) => ({ id: `o${at}`, from: "Aland", to: "Borduria", type: "other", status: at === 5 ? "open" : "declined", round: at }));
  const kept = normalizeTreatyOffers(many);
  assert.equal(kept.length, 40);
  assert.ok(kept.some((offer) => offer.id === "o5"), "an open one is never trimmed away");
  assert.equal(kept.at(-1).id, "o59", "the latest answered stay");
  assert.deepEqual(normalizeTreatyOffers([{ id: "x", from: "Aland", to: "Aland", type: "other" }, { id: "y", from: "Aland", to: "Borduria", type: "nonsense" }]), []);
});
