/*! Open Historia Continuum — bounded autonomous institutional formal-business work. */
import {
  INSTITUTION_BALLOT_MAX_ASKS,
  institutionBallotAskCount,
  institutionsForPolity,
  resolveInstitutionRecord,
} from "../../runtime/institutions.js";

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
    .filter((polity) => !recorded.has(lower(polity)))
    // Asked enough times already: no more requests are spent on that seat.
    .filter((polity) => institutionBallotAskCount(proposal, polity) < INSTITUTION_BALLOT_MAX_ASKS);
};

export const institutionBallotWorkForProposal = (world = {}, institutionId = "", proposalId = "", playerCountry = "", {
  maxVoters = 48,
} = {}) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution || lower(institution?.status || "active") === "dissolved") return null;
  const proposal = values(institution?.proposals).find((entry) => lower(entry?.id) === lower(proposalId));
  if (!proposal || lower(proposal?.status) !== "voting" || !proposal?.voting) return null;
  const actors = unresolvedNpcVotersForProposal(institution, proposal, playerCountry).slice(0, maxVoters);
  if (!actors.length) return null;
  return {
    institutionId: clean(institution.id),
    institutionName: clean(institution.name || institution.id),
    proposalId: clean(proposal.id),
    proposalTitle: clean(proposal.title || proposal.id),
    actors,
  };
};

// Every open ballot in the player's institutions that still has an AI
// government to ask, oldest first within each institution, for the ONE
// post-turn ballot request. A ballot whose remaining voters have all been asked
// enough drops out, so it can neither cost a request every turn nor hold up the
// ballots behind it. `maxBallots` bounds the request as a whole; what does not
// fit waits for the next turn.
export const collectAutonomousInstitutionBallotWork = (world = {}, playerCountry = "", {
  maxInstitutions = 4,
  maxVotersPerInstitution = 32,
  maxBallots = 48,
} = {}) => {
  const work = [];
  let institutions = 0;
  let ballots = 0;
  for (const entry of institutionsForPolity(world, playerCountry, { includeSuspended: false, includeDissolved: false })) {
    if (institutions >= maxInstitutions || ballots >= maxBallots) break;
    const institution = entry?.institution || entry;
    if (lower(institution?.status || "active") === "dissolved") continue;
    const votingProposals = values(institution?.proposals)
      .filter((proposal) => lower(proposal?.status) === "voting" && proposal?.voting)
      .sort((a, b) => clean(a?.voting?.openedDate || a?.createdDate).localeCompare(clean(b?.voting?.openedDate || b?.createdDate)));
    let counted = false;
    for (const proposal of votingProposals) {
      const room = Math.min(maxVotersPerInstitution, maxBallots - ballots);
      if (room <= 0) break;
      const actors = unresolvedNpcVotersForProposal(institution, proposal, playerCountry).slice(0, room);
      if (!actors.length) continue;
      work.push({
        institutionId: clean(institution.id),
        institutionName: clean(institution.name || institution.id),
        proposalId: clean(proposal.id),
        proposalTitle: clean(proposal.title || proposal.id),
        proposalSummary: clean(proposal.summary).slice(0, 600),
        actors,
      });
      ballots += actors.length;
      counted = true;
    }
    if (counted) institutions += 1;
  }
  return work;
};

// The post-turn pass's directive: one request records every listed ballot,
// across institutions and proposals. Takes one work item or a list of them.
export const autonomousInstitutionBallotDirective = (workInput) => {
  const items = (Array.isArray(workInput) ? workInput : [workInput])
    .filter((work) => work?.proposalId && list(work?.actors).length);
  if (!items.length) return "";
  return [
    "[AUTONOMOUS POST-TURN INSTITUTION BALLOT]",
    items.length === 1
      ? `The completed turn has left a formal ballot open in ${items[0].institutionName || items[0].institutionId}.`
      : "The completed turn has left formal ballots open in the institutions below.",
    ...items.map((work) => [
      `- Proposal ${work.proposalId} in ${work.institutionName || work.institutionId}: ${work.proposalTitle || "formal business"}.`,
      work.proposalSummary ? `  Summary: ${work.proposalSummary}` : "",
      `  AI-controlled eligible governments that have not yet recorded a ballot: ${work.actors.join(", ")}.`,
    ].filter(Boolean).join("\n")),
    "For THIS pass, each listed government MUST cast exactly one institution_vote on each proposal it is listed under, using its own PWv2 political context, relations, that institution's identity/obligations, and the proposal itself.",
    'Exact raw-JSON vote shape: {"type":"institution_vote","actorName":"<exact AI polity>","proposalId":"<exact proposal id>","voteChoice":"yes|no|abstain|veto","reason":"<concise rationale>"}. Use actorName and voteChoice exactly; do not use polity, vote, choice, or institutionId aliases. The proposalId says which ballot the vote is on.',
    "Choose yes, no, abstain, or veto only where the charter permits it. Do not act for the human player. Do not lodge unrelated proposals, amendments, polls, or ordinary chat messages in this maintenance pass.",
    "Return an object with an actions array containing only the formal institution_vote actions needed to record those ballots. Native governance independently validates every ballot and prevents duplicates.",
  ].join("\n");
};

// Sorts the post-turn request's votes back to their institutions: a vote
// belongs to the listed ballot with its proposal id on which its government
// was listed. Anything else (another action, an unlisted government or
// proposal) is returned as unmatched and applied nowhere.
export const routeAutonomousBallotVotes = (workInput, actions = []) => {
  const items = list(workInput);
  const byInstitution = new Map();
  const unmatched = [];
  for (const action of list(actions)) {
    const item = action?.type === "institution_vote"
      ? items.find((work) => lower(work.proposalId) === lower(action.proposalId)
        && list(work.actors).some((actor) => lower(actor) === lower(action.actorName)))
      : null;
    if (!item) {
      unmatched.push(action);
      continue;
    }
    if (!byInstitution.has(item.institutionId)) byInstitution.set(item.institutionId, []);
    byInstitution.get(item.institutionId).push({ ...action, proposalId: item.proposalId });
  }
  return { byInstitution, unmatched };
};

export const interactiveInstitutionBallotDirective = (work) => {
  if (!work?.proposalId || !list(work?.actors).length) return "";
  const statementSlots = Math.max(0, Math.min(3, 48 - list(work.actors).length));
  const statementRule = statementSlots > 0
    ? `To make the Council feel alive, up to ${statementSlots === 3 ? "THREE" : statementSlots} government${statementSlots === 1 ? "" : "s"} with a useful public position may also send one short send_message statement about this vote in the same action batch. Keep those statements concise. A government may vote without speaking.`
    : "Do not add public statements in this batch; the bounded action batch is fully reserved for the required ballots.";
  return [
    "[LIVE INSTITUTION BALLOT]",
    `A formal vote has just opened in ${work.institutionName || work.institutionId}.`,
    `Proposal: ${work.proposalId} - ${work.proposalTitle || "formal business"}.`,
    `The following AI-controlled eligible governments have not yet recorded a ballot: ${work.actors.join(", ")}.`,
    "Each listed government MUST cast exactly one institution_vote on that exact proposal using its own Political World context, relations, the institution's identity and obligations, and the proposal itself.",
    'Exact raw-JSON vote shape: {"type":"institution_vote","actorName":"<exact AI polity>","proposalId":"<exact proposal id>","voteChoice":"yes|no|abstain|veto","reason":"<concise rationale>"}. Use actorName and voteChoice exactly; do not substitute polity/vote/choice or repeat institutionId.',
    "Do not act for the human player. Do not lodge unrelated proposals, amendments or polls.",
    statementRule,
    "Return one actions array containing the required formal votes plus any optional short public statements. Native governance independently validates every ballot and prevents duplicates.",
  ].join("\n");
};
