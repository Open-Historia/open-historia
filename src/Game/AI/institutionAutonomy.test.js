import assert from "node:assert/strict";
import test from "node:test";
import {
  autonomousInstitutionBallotDirective,
  collectAutonomousInstitutionBallotWork,
  institutionBallotWorkForProposal,
  interactiveInstitutionBallotDirective,
  routeAutonomousBallotVotes,
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

const twoCouncils = () => {
  const baltic = structuredClone(institution);
  baltic.proposals.p2 = {
    id: "p2",
    title: "Energy grid",
    status: "voting",
    voting: {
      openedDate: "2014-09-01",
      eligibleVoters: ["Republic of Latvia", "Republic of Lithuania", "Republic of Estonia"],
      ballots: {},
      asked: { "Republic of Estonia": 2 },
    },
  };
  const nordic = {
    id: "nordic-council",
    name: "Nordic Council",
    status: "active",
    members: [
      { polity: "Republic of Latvia", status: "member" },
      { polity: "Kingdom of Sweden", status: "member" },
    ],
    proposals: {
      p1: { id: "p1", title: "Fisheries", status: "voting", voting: { openedDate: "2014-07-01", eligibleVoters: ["Republic of Latvia", "Kingdom of Sweden"], ballots: {} } },
    },
  };
  return { institutions: { schemaVersion: 1, byId: { "baltic-union": baltic, "nordic-council": nordic } } };
};

test("post-turn work covers every open ballot in every institution, minus seats asked enough", () => {
  const work = collectAutonomousInstitutionBallotWork(twoCouncils(), "Republic of Latvia");
  const rows = work.map((item) => [item.institutionId, item.proposalId, item.actors]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find(([id, proposalId]) => id === "baltic-union" && proposalId === "p1"), ["baltic-union", "p1", ["Republic of Lithuania", "Republic of Estonia"]]);
  assert.deepEqual(rows.find(([id, proposalId]) => id === "baltic-union" && proposalId === "p2"), ["baltic-union", "p2", ["Republic of Lithuania"]], "Estonia was asked twice already");
  assert.deepEqual(rows.find(([id]) => id === "nordic-council"), ["nordic-council", "p1", ["Kingdom of Sweden"]]);
  const capped = collectAutonomousInstitutionBallotWork(twoCouncils(), "Republic of Latvia", { maxBallots: 2 });
  assert.equal(capped.reduce((sum, item) => sum + item.actors.length, 0), 2);
});

test("a ballot whose AI voters have all been asked enough leaves the work list", () => {
  const world = twoCouncils();
  world.institutions.byId["nordic-council"].proposals.p1.voting.asked = { "Kingdom of Sweden": 2 };
  const work = collectAutonomousInstitutionBallotWork(world, "Republic of Latvia");
  assert.equal(work.some((item) => item.institutionId === "nordic-council"), false);
});

test("one directive lists every ballot, and each vote is routed back to its institution", () => {
  const work = collectAutonomousInstitutionBallotWork(twoCouncils(), "Republic of Latvia");
  const directive = autonomousInstitutionBallotDirective(work);
  assert.match(directive, /Proposal p1 in Baltic Union/);
  assert.match(directive, /Proposal p2 in Baltic Union/);
  assert.match(directive, /Proposal p1 in Nordic Council/);
  const routed = routeAutonomousBallotVotes(work, [
    { type: "institution_vote", actorName: "Kingdom of Sweden", proposalId: "p1", voteChoice: "yes" },
    { type: "institution_vote", actorName: "Republic of Lithuania", proposalId: "p1", voteChoice: "no" },
    { type: "institution_vote", actorName: "Republic of Lithuania", proposalId: "P2", voteChoice: "abstain" },
    { type: "institution_vote", actorName: "Republic of Estonia", proposalId: "p2", voteChoice: "yes" },
    { type: "institution_vote", actorName: "Republic of Latvia", proposalId: "p1", voteChoice: "yes" },
  ]);
  assert.deepEqual(routed.byInstitution.get("nordic-council").map((vote) => vote.actorName), ["Kingdom of Sweden"]);
  assert.deepEqual(routed.byInstitution.get("baltic-union").map((vote) => [vote.actorName, vote.proposalId]), [
    ["Republic of Lithuania", "p1"],
    ["Republic of Lithuania", "p2"],
  ]);
  assert.equal(routed.unmatched.length, 2, "an unlisted seat and the player are applied nowhere");
});
