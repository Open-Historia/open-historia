/*! Open Historia — alliances that bind: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/alliances.test.js
//
// "Alliances that pull members into wars, with broken treaties costing
// reputation. Alpha's prompt currently says alliances do not create
// belligerency, so this is a rule change."

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLIES_CALLED_MOST,
  CALL_STANDS_ROUNDS,
  HONOUR_RELATION_LEAST,
  HONOUR_WEARINESS_MOST,
  TREATY_BROKEN_REPUTATION,
  agreementsWithout,
  callsForTurn,
  defendersOf,
  describeBonds,
  honoursCall,
  isBoundToDefend,
  normalizeCallsToArms,
  openCallsFor,
  reputationAfterBreaking,
} from "./alliances.js";

const pact = (id, type, parties, extra = {}) => ({ id, title: `The ${id} treaty`, type, status: "active", parties, ...extra });
const body = (id, kind, members, extra = {}) => ({ id, name: `${id} Organisation`, shortName: id.toUpperCase(), kind, status: "active", members: members.map((member) => (typeof member === "string" ? { polity: member, status: "member" } : member)), ...extra });
const world = (agreements = [], institutions = []) => ({ agreements, institutions: { byId: Object.fromEntries(institutions.map((entry) => [entry.id, entry])) } });
const names = (entries) => entries.map((entry) => entry.ally).sort();

test("who is bound to defend a country: its allies, its guarantor, and the full members of its security alliance", () => {
  const state = world(
    [
      pact("entente", "alliance", ["Aland", "Borduria", "Cisland"]),
      pact("pledge", "guarantee", ["Dorland", "Aland"], { guarantor: "Dorland", beneficiary: "Aland" }),
      pact("trade", "trade_economic", ["Aland", "Eland"]),
      pact("old", "mutual_defense", ["Aland", "Fland"], { status: "ended" }),
      pact("truce", "non_aggression", ["Aland", "Gland"]),
    ],
    [
      body("nato", "security_alliance", ["Aland", "Hland", { polity: "Iland", status: "observer" }, { polity: "Jland", status: "suspended" }]),
      body("club", "economic_union", ["Aland", "Kland"]),
      body("gone", "defense_pact", ["Aland", "Lland"], { status: "dissolved" }),
    ],
  );
  assert.deepEqual(names(defendersOf(state, "aland")), ["Borduria", "Cisland", "Dorland", "Hland"]);
  // By what: the first bond found, an agreement before an institution.
  const byAlly = Object.fromEntries(defendersOf(state, "Aland").map((entry) => [entry.ally, entry.via]));
  assert.deepEqual(byAlly.Borduria, { kind: "agreement", id: "entente", title: "The entente treaty" });
  assert.deepEqual(byAlly.Hland, { kind: "institution", id: "nato", title: "NATO" });
  // A guarantee runs one way: the guaranteed owes its guarantor nothing.
  assert.deepEqual(names(defendersOf(state, "Dorland")), []);
  assert.equal(isBoundToDefend(state, "Dorland", "Aland"), true);
  assert.equal(isBoundToDefend(state, "Aland", "Dorland"), false);
  // Trade, a truce, an ended pact, an observer, a suspended member and a club that is no alliance bind nobody.
  for (const name of ["Eland", "Fland", "Gland", "Iland", "Jland", "Kland", "Lland"]) assert.equal(isBoundToDefend(state, name, "Aland"), false, name);
  assert.deepEqual(defendersOf(state, ""), []);
  assert.deepEqual(defendersOf({}, "Aland"), []);
  assert.deepEqual(describeBonds(state, ["Aland", "aland", "Eland", "Hland"]), ["Aland is defended by Borduria, Cisland, Dorland, Hland", "Hland is defended by Aland"]);
});

const WAR = { id: "war-1", status: "active", sideA: ["Xland"], sideB: ["Aland"] };
const turn = (extra = {}) => callsForTurn({
  world: world([pact("entente", "alliance", ["Aland", "Borduria", "Cisland"])]),
  wars: [WAR],
  began: ["war-1"],
  calls: [],
  players: [],
  honours: () => true,
  strengthOf: (name) => ({ Borduria: 5, Cisland: 9 })[name] ?? 1,
  round: 4,
  date: "1914-08-01",
  ...extra,
});

test("a war begun against a country calls its allies in, the strongest first, and each is called once", () => {
  const due = turn();
  assert.deepEqual(due.joins.map((join) => [join.warId, join.ally, join.defender]), [["war-1", "Cisland", "Aland"], ["war-1", "Borduria", "Aland"]]);
  assert.deepEqual(due.calls.map((call) => [call.id, call.status, call.attackers, call.round]), [["call:war-1:cisland", "honoured", ["Xland"], 4], ["call:war-1:borduria", "honoured", ["Xland"], 4]]);
  assert.deepEqual(due.broken, []);
  // The next turn, the war no longer new: nobody is called again.
  assert.deepEqual(callsForTurn({ ...turnInput(), calls: due.calls, began: [] }).joins, []);
  assert.deepEqual(turn({ calls: due.calls }).joins, [], "and a call already made is not made twice");
  // The attacker's own allies are not obliged: it is the one that began the war.
  assert.deepEqual(turn({ wars: [{ ...WAR, sideA: ["Aland"], sideB: ["Xland"] }] }).joins, []);
  // An ally already in the war is not called; one bound to both sides stands aside and breaks nothing.
  assert.deepEqual(turn({ wars: [{ ...WAR, sideB: ["Aland", "Cisland"] }] }).joins.map((join) => join.ally), ["Borduria"]);
  const both = turn({ world: world([pact("entente", "alliance", ["Aland", "Borduria"]), pact("other", "mutual_defense", ["Xland", "Borduria"])]) });
  assert.deepEqual([both.joins, both.broken, both.calls], [[], [], []]);
  // A war that is not being fought, or that did not begin this turn, calls nobody.
  assert.deepEqual(turn({ wars: [{ ...WAR, status: "ceasefire" }] }).joins, []);
  assert.deepEqual(turn({ began: [] }).joins, []);
});
function turnInput() {
  return { world: world([pact("entente", "alliance", ["Aland", "Borduria", "Cisland"])]), wars: [WAR], players: [], honours: () => true, round: 5, date: "1914-09-01" };
}

test("an ally that will not come has broken the treaty; a great alliance sends its strongest and nobody else is blamed", () => {
  const due = turn({ honours: (ally) => ally !== "Borduria" });
  assert.deepEqual(due.joins.map((join) => join.ally), ["Cisland"]);
  assert.deepEqual(due.broken.map((entry) => [entry.ally, entry.defender, entry.via.id, entry.warId]), [["Borduria", "Aland", "entente", "war-1"]]);
  assert.deepEqual(due.calls.find((call) => call.ally === "Borduria").status, "refused");
  // Whether it comes: not on bad terms, and not already spent.
  assert.equal(honoursCall({ relation: 0, weariness: 0 }), true);
  assert.equal(honoursCall({ relation: HONOUR_RELATION_LEAST, weariness: HONOUR_WEARINESS_MOST - 1 }), true);
  assert.equal(honoursCall({ relation: HONOUR_RELATION_LEAST - 1 }), false);
  assert.equal(honoursCall({ weariness: HONOUR_WEARINESS_MOST }), false);
  // Thirty members: the strongest few come in this turn, and the rest have broken nothing.
  const many = Array.from({ length: 30 }, (_, index) => `Member ${String(index).padStart(2, "0")}`);
  const great = turn({ world: world([], [body("nato", "security_alliance", ["Aland", ...many])]), strengthOf: (name) => Number(name.slice(-2)) });
  assert.equal(great.joins.length, ALLIES_CALLED_MOST);
  assert.deepEqual(great.joins.map((join) => join.ally).slice(0, 2), ["Member 29", "Member 28"]);
  assert.deepEqual(great.broken, []);
  assert.equal(great.calls.length, ALLIES_CALLED_MOST);
});

test("a person is asked, not joined; silence is an answer after a while; a war that ends lifts the call", () => {
  const due = turn({ players: ["Cisland"] });
  assert.deepEqual(due.joins.map((join) => join.ally), ["Borduria"], "nobody joins a war for a person");
  const [open] = openCallsFor(due.calls, "cisland");
  assert.deepEqual([open.ally, open.defender, open.status, open.via.title], ["Cisland", "Aland", "open", "The entente treaty"]);
  assert.deepEqual(openCallsFor(due.calls, "Borduria"), []);
  const later = (round, extra = {}) => callsForTurn({ ...turnInput(), players: ["Cisland"], calls: due.calls, began: [], round, ...extra });
  assert.equal(later(4 + CALL_STANDS_ROUNDS - 1).calls.find((call) => call.ally === "Cisland").status, "open");
  const silent = later(4 + CALL_STANDS_ROUNDS);
  assert.deepEqual([silent.calls.find((call) => call.ally === "Cisland").status, silent.broken.map((entry) => entry.ally)], ["refused", ["Cisland"]]);
  // The war over, or the country in it by its own road: nothing is owed, and nothing broken.
  for (const wars of [[{ ...WAR, status: "ended" }], [{ ...WAR, sideB: ["Aland", "Cisland"] }], []]) {
    const lifted = later(9, { wars });
    assert.deepEqual([lifted.calls.find((call) => call.ally === "Cisland").status, lifted.broken], ["lapsed", []]);
  }
  assert.deepEqual(normalizeCallsToArms([{ id: "x", warId: "w", ally: "A", defender: "A" }, { id: "", warId: "w", ally: "A", defender: "B" }, null]), []);
});

test("a treaty broken costs standing, and the breaker is out of the agreement", () => {
  assert.equal(reputationAfterBreaking(70), 70 - TREATY_BROKEN_REPUTATION);
  assert.equal(reputationAfterBreaking(undefined), 50 - TREATY_BROKEN_REPUTATION, "from the middle where none is recorded");
  assert.equal(reputationAfterBreaking(5), 0);
  const agreements = [pact("entente", "alliance", ["Aland", "Borduria", "Cisland"]), pact("pair", "mutual_defense", ["Aland", "Dorland"]), pact("pledge", "guarantee", ["Eland", "Aland"])];
  const when = { date: "1914-08-01", round: 4 };
  // One of three leaves: the other two are still bound to each other.
  const three = agreementsWithout(agreements, { kind: "agreement", id: "entente" }, "borduria", when);
  assert.deepEqual([three[0].parties, three[0].status], [["Aland", "Cisland"], "active"]);
  // One of two leaves: the agreement is over.
  const two = agreementsWithout(agreements, { kind: "agreement", id: "pair" }, "Dorland", when);
  assert.deepEqual([two[1].status, two[1].endedDate, two[1].updatedRound], ["ended", "1914-08-01", 4]);
  // A guarantee not honoured is no guarantee.
  assert.equal(agreementsWithout(agreements, { kind: "agreement", id: "pledge" }, "Eland", when)[2].status, "ended");
  // A member of an institution that will not fight keeps its seat; nothing else is touched.
  assert.equal(agreementsWithout(agreements, { kind: "institution", id: "nato" }, "Aland", when), agreements);
  assert.deepEqual(agreementsWithout(agreements, { kind: "agreement", id: "entente" }, "Nobody", when), agreements);
});
