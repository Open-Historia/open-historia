/*! Open Historia — a country's leader is one person © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/politicalLeader.test.js
//
// "head of state (prime minister) showing 3 different people" (a player's
// report, 2026-11-03), Australia in 2053: the Politics card's Prime Minister
// Alistair Thorne, the Political World's Peter Dutton, and Rostra posting as
// Anthony Albanese, Prime Minister, the leader the world was generated with.

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorldState } from "./gameState.js";
import { applyPoliticalActorOperation } from "./politicalActorOps.js";
import { leaderOfOffices } from "./politicalActors.js";
import { buildPublicPoliticalView } from "./politicalKnowledge.js";
import { playerAccount } from "./socialFeed.js";

const AU = "Commonwealth of Australia";
const generated = () => ({
  polityKey: AU,
  government: { form: "Federal Parliamentary Constitutional Monarchy", headOfState: "Charles III", headOfGovernment: "Peter Dutton", rulingParties: ["Liberal Party of Australia"] },
  leader: { name: "Anthony Albanese", title: "Prime Minister", office: "headOfGovernment" },
  parties: [
    { id: "alp", name: "Australian Labor Party", shortName: "ALP", support: { percent: 38 } },
    { id: "lib", name: "Liberal Party of Australia", shortName: "Liberal", support: { percent: 35 } },
  ],
});
const worldOf = (actor, extra = {}) => normalizeWorldState({ politicalActors: { byPolity: { [actor.polityKey]: actor } }, ...extra });
const nameOf = (holder) => (typeof holder === "string" ? holder : holder?.name);

test("a leader left behind when a turn gave their office to someone else follows it, and Rostra posts as its holder", () => {
  const world = worldOf(generated());
  const actor = world.politicalActors.byPolity[AU];
  assert.deepEqual(actor.leader, { name: "Peter Dutton", title: "Prime Minister", office: "headOfGovernment" });
  assert.deepEqual(playerAccount(world, AU), { author: "Peter Dutton", role: "Prime Minister", country: AU });
  assert.equal(nameOf(buildPublicPoliticalView(world, AU).government.headOfGovernment), "Peter Dutton");
  // A former head of state, by the office.
  assert.deepEqual(
    leaderOfOffices({ name: "Elizabeth II", title: "Queen", office: "headOfState" }, { headOfState: "Charles III", headOfGovernment: "Peter Dutton" }),
    { name: "Charles III", title: "Queen", office: "headOfState" },
  );
});

// Which office a leader holds was read from English title words: "Prime
// Minister" followed the head of government, "Premier ministre" or "Премьер-
// министр" did not. It is the leader's own field now, in every language alike.
test("a leader follows the office the record says they hold, whatever language the title is in", () => {
  for (const title of ["Prime Minister", "Premier ministre", "Премьер-министр", "総理大臣"]) {
    const world = worldOf({ ...generated(), leader: { name: "Anthony Albanese", title, office: "headOfGovernment" } });
    assert.deepEqual(world.politicalActors.byPolity[AU].leader, { name: "Peter Dutton", title, office: "headOfGovernment" }, title);
  }
});

// A leader saved before leaders carried their office has none, and stands as
// written: the office is never guessed from the words of the title.
test("a leader with no office of record stands, in English as in any language", () => {
  for (const title of ["Prime Minister", "Premier ministre"]) {
    const leader = { name: "Anthony Albanese", title };
    assert.equal(leaderOfOffices(leader, { headOfState: "Charles III", headOfGovernment: "Peter Dutton" }), leader, title);
  }
});

test("a leader of an office of their own stands over the formal offices, and one who holds an office is kept", () => {
  const iran = worldOf({ polityKey: "Iran", government: { form: "Islamic Republic", headOfState: "Masoud Pezeshkian", headOfGovernment: "Masoud Pezeshkian" }, leader: { name: "Ali Khamenei", title: "Supreme Leader", office: "other" }, parties: [] });
  assert.deepEqual(iran.politicalActors.byPolity.Iran.leader, { name: "Ali Khamenei", title: "Supreme Leader", office: "other" });
  assert.equal(playerAccount(iran, "Iran").author, "Ali Khamenei");
  const kept = { name: "Peter Dutton", title: "Prime Minister of Australia", office: "headOfGovernment" };
  assert.equal(leaderOfOffices(kept, { headOfState: "Charles III", headOfGovernment: "Peter Dutton" }), kept);
  assert.equal(leaderOfOffices("Anthony Albanese", { headOfGovernment: "Peter Dutton" }), "Anthony Albanese", "a bare name says no office");
});

test("the turn's own ops take the leader with the office: set-government, and replace-leader for a head of government", () => {
  const untitled = worldOf({ ...generated(), government: { ...generated().government, headOfGovernment: "Anthony Albanese" }, leader: "Anthony Albanese" });
  const set = applyPoliticalActorOperation(untitled, { op: "set-government", polityKey: AU, patch: { headOfGovernment: "Peter Dutton" } });
  assert.equal(set.applied, true);
  assert.deepEqual(set.actor.leader, { name: "Peter Dutton", office: "headOfGovernment" });
  // (An op writes into the world it is given: each its own.)
  const titled = () => worldOf({ ...generated(), government: { ...generated().government, headOfGovernment: { name: "Anthony Albanese", title: "Prime Minister" } } });
  const replaced = applyPoliticalActorOperation(titled(), { op: "replace-leader", polityKey: AU, office: "headOfGovernment", leader: { name: "Peter Dutton" } });
  assert.equal(replaced.applied, true);
  assert.deepEqual(replaced.actor.leader, { name: "Peter Dutton", title: "Prime Minister", office: "headOfGovernment" });
  // A form changed with nobody new in office leaves the leader where it was.
  const reformed = applyPoliticalActorOperation(titled(), { op: "set-government", polityKey: AU, patch: { form: "Federal Parliamentary Republic" } });
  assert.deepEqual(reformed.actor.leader, { name: "Anthony Albanese", title: "Prime Minister", office: "headOfGovernment" });
});

// The old Politics card wrote a head as one text, title and all. It was split
// by English title words ("Prime Minister Alistair Thorne" became Alistair
// Thorne, "Premier ministre Jean Dupont" the name "ministre Jean Dupont"). Such
// a text is now kept whole; a reading compiled since gives name and title apart.
test("an old save's Politics card is the newer reading: its heads stand as written, its parties count, and the record's others count nothing", () => {
  const politics = {
    [AU]: {
      government: "Federal Parliamentary Constitutional Monarchy", headOfState: "King Charles III", headOfGovernment: "Prime Minister Alistair Thorne",
      legislature: "House of Representatives", legislatureSeats: 175, nextElection: "2055-05-12", asOf: "2053-12-16",
      parties: [
        { nameEn: "Sovereign Progress Party", abbrEn: "SPP", ideology: "Social Liberalism", leader: "Alistair Thorne", role: "governing", seats: 112, support: 62 },
        { nameEn: "Commonwealth Liberal Alliance", abbrEn: "CLA", ideology: "Market Liberalism", leader: "Julian Vane", role: "opposition", seats: 48, support: 25 },
        { nameEn: "Labor-Syndicate Union", abbrEn: "LSU", ideology: "Syndicalism", leader: "Sarah Jenkins", role: "extraParliamentary", seats: 10, support: 8 },
      ],
    },
  };
  const world = worldOf(generated(), { politics });
  const actor = world.politicalActors.byPolity[AU];
  assert.equal(actor.government.headOfState, "King Charles III", "a head written as one text is kept whole");
  assert.equal(actor.government.headOfGovernment, "Prime Minister Alistair Thorne");
  // The record's leader held the head of government's office, so it follows it.
  assert.deepEqual(actor.leader, { name: "Prime Minister Alistair Thorne", title: "Prime Minister", office: "headOfGovernment" });
  assert.deepEqual(actor.government.rulingParties, ["Sovereign Progress Party"]);
  const figures = Object.fromEntries(actor.parties.map((party) => [party.shortName, [party.support?.percent, party.seats, party.role]]));
  assert.deepEqual(figures, {
    ALP: [0, 0, "extraParliamentary"],
    Liberal: [0, 0, "extraParliamentary"],
    SPP: [62, 112, "governing"],
    CLA: [25, 48, "opposition"],
    LSU: [8, 10, "extraParliamentary"],
  });
});

test("a reading compiled since gives each head's name and title apart, in any language", () => {
  for (const [name, title] of [["Alistair Thorne", "Prime Minister"], ["Jean Dupont", "Premier ministre"], ["Иван Петров", "Председатель правительства"]]) {
    const world = worldOf(generated(), { politics: { [AU]: { government: "Monarchy", headOfState: { name: "Charles III", title: "King" }, headOfGovernment: { name, title }, parties: [] } } });
    const actor = world.politicalActors.byPolity[AU];
    assert.deepEqual(actor.government.headOfGovernment, { name, title }, title);
    assert.equal(actor.government.headOfState, "Charles III", "the same person: the record's own stands");
    assert.deepEqual(actor.leader, { name, title, office: "headOfGovernment" }, "the record's leader is the office's new holder, by their own title");
  }
});
