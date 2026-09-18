import test from "node:test";
import assert from "node:assert/strict";
import { buildInstitutionDiplomaticContext } from "./institutionalDiplomaticContext.js";

const world = {
  institutions: {
    byId: {
      council: {
        id: "council", name: "Northern Council", kind: "council", status: "active",
        members: [
          { polity: "Latvia", status: "member", role: "member" },
          { polity: "Estonia", status: "member", role: "chair" },
          { polity: "Lithuania", status: "member", role: "member" },
        ],
        charter: { votingRule: { type: "simple-majority", quorum: 0.5, abstentionPolicy: "exclude" } },
        proposals: {
          p1: {
            id: "p1", type: "resolution", title: "Joint Readiness", summary: "Coordinate a common readiness package.", status: "voting",
            voting: {
              rule: { type: "simple-majority", quorum: 0.5, abstentionPolicy: "exclude" },
              eligibleVoters: ["Latvia", "Estonia", "Lithuania"],
              ballots: {
                Lithuania: { polity: "Lithuania", choice: "no", reason: "Cost concerns" },
              },
            },
          },
        },
      },
    },
  },
};

test("institutional diplomacy context exposes canon but not other open ballot choices", () => {
  const result = buildInstitutionDiplomaticContext({ world, institutionId: "council", speakingAs: "Estonia", playerCountry: "Latvia" });
  assert.match(result.text, /Northern Council/);
  assert.match(result.text, /Joint Readiness/);
  assert.match(result.text, /your ballot: NOT CAST/i);
  assert.match(result.text, /player ballot \(Latvia\): NOT CAST/i);
  assert.doesNotMatch(result.text, /Cost concerns/);
  assert.doesNotMatch(result.text, /Lithuania.*no/i);
  assert.deepEqual(result.eligibleUncastVoteProposalIds, ["p1"]);
  assert.equal(result.canTableProposal, true);
});

test("institutional diplomacy context exposes speaker's own recorded ballot only", () => {
  const w = structuredClone(world);
  w.institutions.byId.council.proposals.p1.voting.ballots.Estonia = { polity: "Estonia", choice: "yes", reason: "We support readiness" };
  const result = buildInstitutionDiplomaticContext({ world: w, institutionId: "council", speakingAs: "Estonia", playerCountry: "Latvia" });
  assert.match(result.text, /your ballot: yes — We support readiness/i);
  assert.doesNotMatch(result.text, /Cost concerns/);
  assert.deepEqual(result.eligibleUncastVoteProposalIds, []);
});

test("institutional diplomacy context is bounded under custom-world verbosity", () => {
  const w = structuredClone(world);
  for (let i = 0; i < 40; i += 1) {
    w.institutions.byId.council.proposals[`p${i + 2}`] = {
      id: `p${i + 2}`, title: `Proposal ${i} ${"x".repeat(300)}`, summary: "y".repeat(900), status: "debate",
    };
  }
  const result = buildInstitutionDiplomaticContext({ world: w, institutionId: "council", speakingAs: "Estonia", playerCountry: "Latvia" });
  assert.ok(result.text.length <= 9000);
  assert.ok(result.activeProposalIds.length <= 6);
});

test("missing institution returns no invented context", () => {
  const result = buildInstitutionDiplomaticContext({ world, institutionId: "missing", speakingAs: "Estonia", playerCountry: "Latvia" });
  assert.equal(result.text, "");
  assert.equal(result.institution, null);
});


test("institutional context distinguishes speaking rights from agenda-setting rights", () => {
  const w = structuredClone(world);
  w.institutions.byId.council.members.find((member) => member.polity === "Estonia").status = "observer";
  const result = buildInstitutionDiplomaticContext({ world: w, institutionId: "council", speakingAs: "Estonia", playerCountry: "Latvia" });
  assert.equal(result.canTableProposal, false);
  assert.match(result.text, /not currently entitled to place a new formal resolution/i);
});
