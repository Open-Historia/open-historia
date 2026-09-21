/*! Open Historia Continuum — bounded autonomous institutional formal-business work. */
import { institutionsForPolity } from "../../runtime/institutions.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const values = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : []);

const recordedBallotPolities = (proposal) => new Set([
  ...Object.keys(proposal?.voting?.ballots || {}).map(lower),
  ...values(proposal?.voting?.ballots).map((ballot) => lower(ballot?.polity)),
].filter(Boolean));

export const unresolvedNpcVotersForProposal = (institution, proposal, playerCountry = "") => {
  if (lower(proposal?.status) !== "voting" || !proposal?.voting) return [];
  const recorded = recordedBallotPolities(proposal);
  const activeMembers = new Set(
    list(institution?.members)
      .filter((member) => lower(member?.status || "member") !== "suspended")
      .map((member) => lower(member?.polity))
      .filter(Boolean),
  );
  return list(proposal.voting.eligibleVoters)
    .map(clean)
    .filter(Boolean)
    .filter((polity) => lower(polity) !== lower(playerCountry))
    .filter((polity) => activeMembers.has(lower(polity)))
    .filter((polity) => !recorded.has(lower(polity)));
};

// One formal ballot per institution per completed turn. This keeps the request
// count bounded while ensuring a player-created institution cannot stall forever
// merely because its Council was not open during the time skip.
export const collectAutonomousInstitutionBallotWork = (world = {}, playerCountry = "", {
  maxInstitutions = 4,
  maxVotersPerInstitution = 32,
} = {}) => {
  const work = [];
  for (const entry of institutionsForPolity(world, playerCountry, { includeSuspended: false, includeDissolved: false })) {
    const institution = entry?.institution || entry;
    if (lower(institution?.status || "active") === "dissolved") continue;
    const votingProposals = values(institution?.proposals)
      .filter((proposal) => lower(proposal?.status) === "voting" && proposal?.voting)
      .sort((a, b) => clean(a?.voting?.openedDate || a?.createdDate).localeCompare(clean(b?.voting?.openedDate || b?.createdDate)));
    for (const proposal of votingProposals) {
      const actors = unresolvedNpcVotersForProposal(institution, proposal, playerCountry).slice(0, maxVotersPerInstitution);
      if (!actors.length) continue;
      work.push({
        institutionId: clean(institution.id),
        institutionName: clean(institution.name || institution.id),
        proposalId: clean(proposal.id),
        proposalTitle: clean(proposal.title || proposal.id),
        actors,
      });
      break;
    }
    if (work.length >= maxInstitutions) break;
  }
  return work;
};

export const autonomousInstitutionBallotDirective = (work) => {
  if (!work?.proposalId || !list(work?.actors).length) return "";
  return [
    "[AUTONOMOUS POST-TURN INSTITUTION BALLOT]",
    `The completed turn has left a formal ballot open in ${work.institutionName || work.institutionId}.`,
    `Proposal: ${work.proposalId} - ${work.proposalTitle || "formal business"}.`,
    `The following AI-controlled eligible governments have not yet recorded a ballot: ${work.actors.join(", ")}.`,
    "For THIS pass, each listed government MUST cast exactly one institution_vote on that exact proposal using its own PWv2 political context, relations, the institution's identity/obligations, and the proposal itself.",
    'Exact raw-JSON vote shape: {"type":"institution_vote","actorName":"<exact AI polity>","proposalId":"<exact proposal id>","voteChoice":"yes|no|abstain|veto","reason":"<concise rationale>"}. Use actorName and voteChoice exactly; do not use polity, vote, choice, or institutionId aliases.',
    "Choose yes, no, abstain, or veto only where the charter permits it. Do not act for the human player. Do not lodge unrelated proposals, amendments, polls, or ordinary chat messages in this maintenance pass.",
    "Return an object with an actions array containing only the formal institution_vote actions needed to record those ballots. Native governance independently validates every ballot and prevents duplicates.",
  ].join("\n");
};
