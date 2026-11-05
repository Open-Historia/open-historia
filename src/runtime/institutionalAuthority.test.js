/*! Open Historia Continuum — open institutional mandates: listed, carried out once, shown to the skip */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstitutionResolutionAuthorityContext,
  buildOpenInstitutionalMandatesBlock,
  consumeEventInstitutionMandates,
  consumeInstitutionResolutionAuthority,
  institutionResolutionAuthorityRef,
  listInstitutionResolutionAuthorities,
} from "./institutionalAuthority.js";
import {
  applyInstitutionGovernanceCommand,
  castInstitutionProposalVote,
  closeInstitutionProposalVoting,
  createInstitutionProposal,
  openInstitutionProposalVoting,
  transitionInstitutionProposal,
} from "./institutionalGovernance.js";

const makeWorld = () => ({
  polityOverrides: {
    A: { code: "A", name: "Player Republic", status: "active", aliases: [] },
    B: { code: "B", name: "B Republic", status: "active", aliases: [] },
    C: { code: "C", name: "C Republic", status: "active", aliases: [] },
    E: { code: "E", name: "E Republic", status: "active", aliases: [] },
  },
  politicalActors: { schemaVersion: 1, byPolity: {} },
  countryStats: {},
  powerStatus: { schemaVersion: 1, byPolity: {} },
  institutions: {
    schemaVersion: 1,
    ledgerVersion: 1,
    byId: {
      council: {
        id: "council",
        name: "Continental Council",
        status: "active",
        charter: { votingRule: { type: "simple-majority", quorum: 0.5, eligibleStatuses: ["member"] } },
        members: [
          { polity: "A", status: "member", role: "member" },
          { polity: "B", status: "member", role: "leader" },
          { polity: "C", status: "member", role: "member" },
        ],
      },
    },
  },
});

// A resolution taken through the real governance path: tabled, voted, passed
// and implemented, leaving what no native owner could carry out pending.
const passedResolution = (consequences, world = makeWorld()) => {
  const at = (date) => ({ institutionId: "council", proposalId: "p1", date });
  let result = createInstitutionProposal({
    world, institutionId: "council", date: "2000-01-01",
    proposal: { id: "p1", title: "Northern Stabilisation", type: "resolution", createdBy: "A", consequences },
  });
  result = transitionInstitutionProposal({ world: result.world, ...at("2000-01-02"), status: "debate" });
  result = transitionInstitutionProposal({ world: result.world, ...at("2000-01-03"), status: "formalized" });
  result = openInstitutionProposalVoting({ world: result.world, ...at("2000-01-04") });
  for (const polity of ["A", "B", "C"]) {
    result = castInstitutionProposalVote({
      world: result.world, ...at("2000-01-05"), polity, choice: "yes", government: "Gov", playerCountry: "A",
      authority: polity === "A" ? "player" : "npc",
    });
  }
  result = closeInstitutionProposalVoting({ world: result.world, ...at("2000-01-06") });
  return applyInstitutionGovernanceCommand({
    world: result.world, chats: [], institutionId: "council", playerCountry: "A", date: "2000-01-07",
    command: { type: "implement", proposalId: "p1" },
  }).world;
};

const mandateWorld = () => passedResolution([
  { id: "deploy-north", kind: "deployment-authorization", note: "Deploy a stabilisation force to the northern border" },
  { id: "freeze-assets", kind: "sanctions-authorization", note: "Freeze the junta's assets" },
  { id: "statement", kind: "declaration", note: "Condemn the coup" },
]);

const ref = (consequenceId) => institutionResolutionAuthorityRef("council", "p1", consequenceId);

const proposalOf = (world) => world.institutions.byId.council.proposals.p1;

const eventCiting = (id, authorityRef, date = "2000-02-01") => ({
  id,
  date,
  title: "The Council's force crosses the border",
  agency: { principal: "Continental Council", principalKind: "institution", authority: "canonical-process", authorityRef, sovereignActors: [] },
});

test("only operational mandates are listed as open", () => {
  const listed = listInstitutionResolutionAuthorities(mandateWorld());
  assert.deepEqual(listed.map((entry) => entry.consequenceKind).sort(), ["deployment-authorization", "sanctions-authorization"]);
  assert.deepEqual(listed.map((entry) => entry.id).sort(), [ref("deploy-north"), ref("freeze-assets")]);
});

test("a blocked consequence is never listed as a mandate", () => {
  const world = mandateWorld();
  const pending = proposalOf(world).implementation.pending.map((entry) => (
    entry.id === "freeze-assets" ? { ...entry, blockedReason: "The member states refused the reconciliation." } : entry
  ));
  const blocked = {
    ...world,
    institutions: {
      ...world.institutions,
      byId: {
        council: {
          ...world.institutions.byId.council,
          proposals: { p1: { ...proposalOf(world), implementation: { ...proposalOf(world).implementation, pending } } },
        },
      },
    },
  };
  assert.deepEqual(listInstitutionResolutionAuthorities(blocked).map((entry) => entry.id), [ref("deploy-north")]);
});

test("carrying out one mandate leaves the others open and the resolution partly implemented", () => {
  const result = consumeInstitutionResolutionAuthority(mandateWorld(), { authorityRef: ref("deploy-north"), eventId: "e1", date: "2000-02-01" });
  assert.equal(result.consumed, true);
  assert.deepEqual(listInstitutionResolutionAuthorities(result.world).map((entry) => entry.id), [ref("freeze-assets")]);
  const proposal = proposalOf(result.world);
  assert.equal(proposal.implementation.status, "partial");
  const applied = proposal.implementation.applied.find((entry) => entry.id === "deploy-north");
  assert.deepEqual(applied.sourceEventIds, ["e1"]);
  assert.equal(applied.authorityRef, ref("deploy-north"));
  assert.ok(proposal.sourceEventIds.includes("e1"));
});

test("a mandate is carried out once: a second use is refused", () => {
  const first = consumeInstitutionResolutionAuthority(mandateWorld(), { authorityRef: ref("deploy-north"), eventId: "e1", date: "2000-02-01" });
  const second = consumeInstitutionResolutionAuthority(first.world, { authorityRef: ref("deploy-north"), eventId: "e2", date: "2000-02-02" });
  assert.equal(second.consumed, false);
  assert.equal(second.reason, "unknown-or-completed-authority");
  assert.equal(second.world, first.world);
});

test("a resolution whose last mandate is carried out is complete", () => {
  const world = passedResolution([{ id: "fund-relief", kind: "funding-authorization", note: "Fund the relief corridor" }]);
  assert.equal(proposalOf(world).implementation.status, "blocked", "before: nothing native could carry it out");
  const result = consumeInstitutionResolutionAuthority(world, { authorityRef: ref("fund-relief"), eventId: "e1", date: "2000-02-01" });
  assert.equal(proposalOf(result.world).implementation.status, "complete");
  assert.deepEqual(listInstitutionResolutionAuthorities(result.world), []);
});

test("a skip's accepted events use each cited mandate once, the first citation winning", () => {
  const events = [
    { id: "e0", date: "2000-01-20", title: "A storyline beat", agency: { principal: "B", principalKind: "polity", authority: "canonical-process", authorityRef: "storyline-northern-crisis", sovereignActors: [] } },
    eventCiting("e1", ref("deploy-north"), "2000-02-01"),
    eventCiting("e2", ref("deploy-north"), "2000-02-09"),
    { id: "e3", date: "2000-02-10", title: "No agency" },
  ];
  const result = consumeEventInstitutionMandates(mandateWorld(), events, { date: "2000-03-01" });
  assert.deepEqual(result.consumed, [{ authorityRef: ref("deploy-north"), eventId: "e1" }]);
  assert.deepEqual(result.skipped, [{ authorityRef: ref("deploy-north"), eventId: "e2", reason: "unknown-or-completed-authority" }]);
  const applied = proposalOf(result.world).implementation.applied.find((entry) => entry.id === "deploy-north");
  assert.equal(applied.date, "2000-02-01", "the event's own date, not the skip's");
  assert.deepEqual(listInstitutionResolutionAuthorities(result.world).map((entry) => entry.id), [ref("freeze-assets")]);
});

test("a mandate cited by a sovereign row is carried out too", () => {
  const event = {
    id: "e1",
    date: "2000-02-01",
    agency: {
      principal: "B", principalKind: "polity", authority: "autonomous", authorityRef: "",
      sovereignActors: [{ polity: "B", authority: "canonical-process", authorityRef: ref("freeze-assets") }],
    },
  };
  const result = consumeEventInstitutionMandates(mandateWorld(), [event]);
  assert.deepEqual(result.consumed.map((entry) => entry.authorityRef), [ref("freeze-assets")]);
});

test("a skip with no cited mandates changes nothing", () => {
  const world = mandateWorld();
  const result = consumeEventInstitutionMandates(world, [{ id: "e1", title: "Quiet month" }]);
  assert.equal(result.world, world);
  assert.deepEqual(result.consumed, []);
  assert.deepEqual(result.skipped, []);
});

test("the skip is shown the open mandates, and nothing when there are none", () => {
  const block = buildOpenInstitutionalMandatesBlock(mandateWorld());
  assert.match(block, /^\[Open Institutional Mandates\]/);
  assert.match(block, /Continental Council: Northern Stabilisation \[deployment-authorization\] — Deploy a stabilisation force/);
  assert.match(block, /\[sanctions-authorization\]/);
  assert.doesNotMatch(block, /declaration/);
  assert.equal(buildOpenInstitutionalMandatesBlock(makeWorld()), "");
  const done = consumeEventInstitutionMandates(mandateWorld(), [eventCiting("e1", ref("deploy-north")), eventCiting("e2", ref("freeze-assets"))]);
  assert.equal(buildOpenInstitutionalMandatesBlock(done.world), "");
});

test("a focus limits the mandates to institutions a focus polity belongs to", () => {
  assert.notEqual(buildInstitutionResolutionAuthorityContext(mandateWorld(), ["A"]), "");
  assert.equal(buildInstitutionResolutionAuthorityContext(mandateWorld(), ["E"]), "");
});
