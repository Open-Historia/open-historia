import assert from "node:assert/strict";
import test from "node:test";
import {
  autonomousInstitutionBallotDirective,
  collectAutonomousInstitutionBallotWork,
  institutionBallotWorkForProposal,
  interactiveInstitutionBallotDirective,
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

test("interactive ballot work targets one exact proposal even when the player is only the applicant", () => {
  const applicantWorld = {
    institutions: {
      schemaVersion: 1,
      byId: {
        "baltic-union": {
          ...structuredClone(institution),
          proposals: {
            older: {
              ...structuredClone(institution.proposals.p1),
              id: "older",
              title: "Older ballot",
            },
            accession: {
              ...structuredClone(institution.proposals.p1),
              id: "accession",
              title: "Romania accession",
              voting: {
                ...structuredClone(institution.proposals.p1.voting),
                ballots: {},
              },
            },
          },
        },
      },
    },
  };
  const work = institutionBallotWorkForProposal(applicantWorld, "baltic-union", "accession", "Romania");
  assert.equal(work?.proposalId, "accession");
  assert.deepEqual(work?.actors, ["Republic of Latvia", "Republic of Lithuania", "Republic of Estonia"]);
});


test("interactive ballot work uses the full 48-action formal batch before deferring overflow", () => {
  const voters = Array.from({ length: 52 }, (_, index) => `Government ${index + 1}`);
  const largeInstitution = {
    ...structuredClone(institution),
    members: voters.map((polity) => ({ polity, status: "member" })),
    proposals: {
      bigVote: {
        id: "bigVote",
        title: "Large council ballot",
        status: "voting",
        voting: { openedDate: "2014-08-19", eligibleVoters: voters, ballots: {} },
      },
    },
  };
  const largeWorld = { institutions: { schemaVersion: 1, byId: { "baltic-union": largeInstitution } } };
  const work = institutionBallotWorkForProposal(largeWorld, "baltic-union", "bigVote", "Applicant");
  assert.equal(work?.actors.length, 48);
  assert.deepEqual(work?.actors, voters.slice(0, 48));
  assert.match(interactiveInstitutionBallotDirective(work), /fully reserved for the required ballots/i);
});

test("interactive ballot directive allows a few short statements but still requires every NPC ballot", () => {
  const [work] = collectAutonomousInstitutionBallotWork(world, "Republic of Latvia");
  const directive = interactiveInstitutionBallotDirective(work);
  assert.match(directive, /Each listed government MUST cast exactly one institution_vote/);
  assert.match(directive, /up to THREE governments/i);
  assert.match(directive, /send_message/);
  assert.match(directive, /Do not act for the human player/);
});
