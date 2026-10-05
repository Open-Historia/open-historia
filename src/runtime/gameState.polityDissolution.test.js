/*! Open Historia — a dissolved polity leaves its institutions and subordinations © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.polityDissolution.test.js
//
// applyPolityAndTerritoryImpacts ends a dissolved polity's agreements; its
// institution seats, open ballots, open membership cases and puppet rows end
// with them, so no prompt or panel goes on treating it as alive.

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld } from "./gameState.js";

const event = (impacts) => ({ id: "evt-dissolve", date: "2016-05-01", title: "Test", description: "test", impacts });

const council = () => ({
  id: "council",
  name: "Northern Council",
  status: "active",
  charter: { votingRule: { type: "simple-majority", eligibleStatuses: ["member"], quorum: 0.5 } },
  members: [
    { polity: "Alpha", status: "member", role: "leader" },
    { polity: "Beta", status: "member" },
    { polity: "Gamma", status: "member" },
  ],
  leaders: ["Alpha"],
  proposals: {
    "open-vote": {
      id: "open-vote", title: "Open vote", status: "voting",
      voting: { openedDate: "2016-04-01", rule: { type: "simple-majority" }, eligibleVoters: ["Alpha", "Beta", "Gamma"], ballots: {} },
    },
    "cast-vote": {
      id: "cast-vote", title: "Cast vote", status: "voting",
      voting: { openedDate: "2016-04-01", rule: { type: "simple-majority" }, eligibleVoters: ["Alpha", "Beta", "Gamma"], ballots: { Alpha: { polity: "Alpha", choice: "yes" } } },
    },
    "alpha-application": {
      id: "alpha-application", title: "Delta accession", status: "voting",
      voting: { openedDate: "2016-04-01", rule: { type: "simple-majority" }, eligibleVoters: ["Beta", "Gamma"], ballots: {} },
    },
  },
  lifecycleCases: {
    "delta-invite": { id: "delta-invite", kind: "application", status: "pending-approval", polity: "Delta", initiatedBy: "Alpha", proposalId: "alpha-application", createdDate: "2016-04-01" },
  },
});

const world = () => ({
  polityOverrides: {
    Alpha: { code: "Alpha", name: "Alpha", aliases: [], color: "#111111" },
    Beta: { code: "Beta", name: "Beta", aliases: [], color: "#222222" },
    Gamma: { code: "Gamma", name: "Gamma", aliases: [], color: "#333333" },
    Delta: { code: "Delta", name: "Delta", aliases: [], color: "#444444" },
  },
  regionOwnershipOverrides: { r1: "Alpha", r2: "Beta" },
  institutions: { byId: { council: council() } },
  puppets: [
    { id: "p1", overlord: "Alpha", puppet: "Gamma", kind: "satellite", secrecy: "open", status: "active", startedDate: "2010-01-01" },
    { id: "p2", overlord: "Beta", puppet: "Alpha", kind: "client", secrecy: "open", status: "active", startedDate: "2010-01-01" },
    { id: "p3", overlord: "Gamma", puppet: "Delta", kind: "client", secrecy: "open", status: "active", startedDate: "2010-01-01" },
  ],
});

test("a dissolved polity leaves its institutions: seat, leadership, unvoted ballots and open cases", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({
      regionTransfers: [{ regionId: "r1", fromCode: "Alpha", toCode: "Beta" }],
      polityChanges: [{ code: "Alpha", operation: "dissolve" }],
    })],
  });
  assert.equal(next.polityOverrides.Alpha.status, "dissolved");
  const institution = next.institutions.byId.council;
  assert.deepEqual(institution.members.map((member) => member.polity), ["Beta", "Gamma"]);
  assert.deepEqual(institution.leaders, []);
  const history = institution.membershipHistory.at(-1);
  assert.equal(history.action, "dissolved");
  assert.equal(history.polity, "Alpha");
  assert.equal(history.date, "2016-05-01");
  assert.deepEqual(institution.proposals["open-vote"].voting.eligibleVoters, ["Beta", "Gamma"]);
  assert.deepEqual(institution.proposals["cast-vote"].voting.eligibleVoters, ["Alpha", "Beta", "Gamma"], "a ballot it already cast still counts");
  assert.equal(institution.lifecycleCases["delta-invite"].status, "withdrawn");
  assert.equal(institution.proposals["alpha-application"].status, "withdrawn");
});

test("its subordinations end: released as Overlord, annexed as a Puppet whose land went to the Overlord", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({
      regionTransfers: [{ regionId: "r1", fromCode: "Alpha", toCode: "Beta" }],
      polityChanges: [{ code: "Alpha", operation: "dissolve" }],
    })],
  });
  const byId = Object.fromEntries(next.puppets.map((row) => [row.id, row]));
  assert.equal(byId.p1.status, "released");
  assert.equal(byId.p1.endedDate, "2016-05-01");
  assert.equal(byId.p2.status, "annexed");
  assert.equal(byId.p2.endedDate, "2016-05-01");
  assert.equal(byId.p3.status, "active", "an arrangement it was not party to is untouched");
});

test("a Puppet dissolved without its land going to the Overlord is released", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({
      regionTransfers: [{ regionId: "r1", fromCode: "Alpha", toCode: "Gamma" }],
      polityChanges: [{ code: "Alpha", operation: "dissolve" }],
    })],
  });
  assert.equal(next.puppets.find((row) => row.id === "p2").status, "released");
});

test("a polity that still holds land is not dissolved and keeps its seat", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    world: world(),
    events: [event({ polityChanges: [{ code: "Alpha", operation: "dissolve" }] })],
  });
  assert.notEqual(next.polityOverrides.Alpha.status, "dissolved");
  assert.equal(next.institutions.byId.council.members.some((member) => member.polity === "Alpha"), true);
  assert.equal(next.puppets.every((row) => row.status === "active"), true);
});
