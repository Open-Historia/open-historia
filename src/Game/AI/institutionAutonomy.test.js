import assert from "node:assert/strict";
import test from "node:test";
import {
  autonomousInstitutionBallotDirective,
  collectAutonomousInstitutionBallotWork,
  unresolvedNpcVotersForProposal,
} from "./institutionAutonomy.js";

const institution = {
  id: "baltic-union",
  name: "Baltic Union",
  status: "active",
  members: [
    { polity: "Republic of Latvia", status: "member" },
    { polity: "Republic of Lithuania", status: "member" },
    { polity: "Republic of Estonia", status: "member" },
  ],
  proposals: {
    p1: {
      id: "p1",
      title: "Joint intelligence framework",
      status: "voting",
      voting: {
        openedDate: "2014-08-19",
        eligibleVoters: ["Republic of Latvia", "Republic of Lithuania", "Republic of Estonia"],
        ballots: { "Republic of Latvia": { polity: "Republic of Latvia", choice: "yes" } },
      },
    },
  },
};

const world = { institutions: { schemaVersion: 1, byId: { "baltic-union": institution } } };

test("autonomous ballot work finds unresolved NPC voters but never the human", () => {
  assert.deepEqual(unresolvedNpcVotersForProposal(institution, institution.proposals.p1, "Republic of Latvia"), [
    "Republic of Lithuania",
    "Republic of Estonia",
  ]);
  const work = collectAutonomousInstitutionBallotWork(world, "Republic of Latvia");
  assert.equal(work.length, 1);
  assert.equal(work[0].proposalId, "p1");
  assert.deepEqual(work[0].actors, ["Republic of Lithuania", "Republic of Estonia"]);
});

test("recorded and suspended NPC voters are excluded", () => {
  const changed = structuredClone(institution);
  changed.members[2].status = "suspended";
  changed.proposals.p1.voting.ballots["Republic of Lithuania"] = { polity: "Republic of Lithuania", choice: "yes" };
  assert.deepEqual(unresolvedNpcVotersForProposal(changed, changed.proposals.p1, "Republic of Latvia"), []);
});

test("autonomous ballot directive requires exact native votes without unrelated chat", () => {
  const [work] = collectAutonomousInstitutionBallotWork(world, "Republic of Latvia");
  const directive = autonomousInstitutionBallotDirective(work);
  assert.match(directive, /each listed government MUST cast exactly one institution_vote/i);
  assert.match(directive, /Do not act for the human player/i);
  assert.match(directive, /prevents duplicates/i);
});
