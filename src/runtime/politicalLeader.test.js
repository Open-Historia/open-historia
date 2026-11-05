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
  leader: { name: "Anthony Albanese", title: "Prime Minister" },
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
  assert.deepEqual(actor.leader, { name: "Peter Dutton", title: "Prime Minister" });
  assert.deepEqual(playerAccount(world, AU), { author: "Peter Dutton", role: "Prime Minister", country: AU });
  assert.equal(nameOf(buildPublicPoliticalView(world, AU).government.headOfGovernment), "Peter Dutton");
  // A former head of state, by the title of the office.
  assert.deepEqual(leaderOfOffices({ name: "Elizabeth II", title: "Queen" }, { headOfState: "Charles III", headOfGovernment: "Peter Dutton" }), { name: "Charles III", title: "Queen" });
});

test("a leader of an office of their own stands over the formal offices, and one who holds an office is kept", () => {
  const iran = worldOf({ polityKey: "Iran", government: { form: "Islamic Republic", headOfState: "Masoud Pezeshkian", headOfGovernment: "Masoud Pezeshkian" }, leader: { name: "Ali Khamenei", title: "Supreme Leader" }, parties: [] });
  assert.deepEqual(iran.politicalActors.byPolity.Iran.leader, { name: "Ali Khamenei", title: "Supreme Leader" });
  assert.equal(playerAccount(iran, "Iran").author, "Ali Khamenei");
  const kept = { name: "Peter Dutton", title: "Prime Minister of Australia" };
  assert.equal(leaderOfOffices(kept, { headOfState: "Charles III", headOfGovernment: "Peter Dutton" }), kept);
  assert.equal(leaderOfOffices("Anthony Albanese", { headOfGovernment: "Peter Dutton" }), "Anthony Albanese", "an untitled name says no office");
});

test("the turn's own ops take the leader with the office: set-government, and replace-leader for a head of government", () => {
  const untitled = worldOf({ ...generated(), government: { ...generated().government, headOfGovernment: "Anthony Albanese" }, leader: "Anthony Albanese" });
  const set = applyPoliticalActorOperation(untitled, { op: "set-government", polityKey: AU, patch: { headOfGovernment: "Peter Dutton" } });
  assert.equal(set.applied, true);
  assert.equal(set.actor.leader, "Peter Dutton");
  // (An op writes into the world it is given: each its own.)
  const titled = () => worldOf({ ...generated(), government: { ...generated().government, headOfGovernment: { name: "Anthony Albanese", title: "Prime Minister" } } });
  const replaced = applyPoliticalActorOperation(titled(), { op: "replace-leader", polityKey: AU, office: "headOfGovernment", leader: { name: "Peter Dutton" } });
  assert.equal(replaced.applied, true);
  assert.deepEqual(replaced.actor.leader, { name: "Peter Dutton", title: "Prime Minister" });
  // A form changed with nobody new in office leaves the leader where it was.
  const reformed = applyPoliticalActorOperation(titled(), { op: "set-government", polityKey: AU, patch: { form: "Federal Parliamentary Republic" } });
  assert.deepEqual(reformed.actor.leader, { name: "Anthony Albanese", title: "Prime Minister" });
});

test("an old save's Politics card is the newer reading: its heads stand, its parties count, and the record's others count nothing", () => {
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
  assert.equal(actor.government.headOfState, "Charles III", "the same monarch, with the title the card wrote before the name");
  assert.deepEqual(actor.government.headOfGovernment, { name: "Alistair Thorne", title: "Prime Minister" });
  assert.deepEqual(actor.leader, { name: "Alistair Thorne", title: "Prime Minister" });
  assert.deepEqual(actor.government.rulingParties, ["Sovereign Progress Party"]);
  assert.deepEqual(playerAccount(world, AU), { author: "Alistair Thorne", role: "Prime Minister", country: AU });
  const figures = Object.fromEntries(actor.parties.map((party) => [party.shortName, [party.support?.percent, party.seats, party.role]]));
  assert.deepEqual(figures, {
    ALP: [0, 0, "extraParliamentary"],
    Liberal: [0, 0, "extraParliamentary"],
    SPP: [62, 112, "governing"],
    CLA: [25, 48, "opposition"],
    LSU: [8, 10, "extraParliamentary"],
  });
});
