/*! Open Historia Continuum — bounded institutional diplomacy projection.
 * Canonical institution/governance state is projected for negotiation; chat
 * prose never becomes legal state and open-ballot choices stay private.
 */

import { resolveInstitutionRecord } from "./institutions.js";
import { institutionCanProposeAmendment, institutionCanTableProposal } from "./institutionalGovernance.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const values = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : []);

const fmtRule = (rule = {}) => {
  const type = clean(rule.type) || "unspecified";
  const parts = [type];
  if (Number.isFinite(Number(rule.threshold))) parts.push(`threshold ${Number(rule.threshold)}`);
  if (Number.isFinite(Number(rule.quorum))) parts.push(`quorum ${Number(rule.quorum)}`);
  if (clean(rule.abstentionPolicy)) parts.push(`abstentions ${clean(rule.abstentionPolicy)}`);
  if (list(rule.vetoPolities).length || list(rule.vetoRoles).length) parts.push("veto rights configured");
  return parts.join("; ");
};

const proposalList = (institution) => values(institution?.proposals)
  .filter(Boolean)
  .sort((a, b) => clean(b.lastUpdatedDate || b.createdDate).localeCompare(clean(a.lastUpdatedDate || a.createdDate)));

const isLiveProposal = (proposal) => !["archived", "withdrawn"].includes(lower(proposal?.status));

const ownBallot = (proposal, speakingAs) => {
  const ballots = proposal?.voting?.ballots && typeof proposal.voting.ballots === "object" ? proposal.voting.ballots : {};
  const key = Object.keys(ballots).find((entry) => lower(entry) === lower(speakingAs));
  return key ? ballots[key] : null;
};

const eligibleEntry = (proposal, polity) => list(proposal?.voting?.eligibleVoters)
  .find((entry) => lower(entry) === lower(polity));

const proposalLine = (proposal, { speakingAs = "", playerCountry = "" } = {}) => {
  const id = clean(proposal?.id);
  const status = clean(proposal?.status) || "draft";
  const title = clean(proposal?.title) || id || "Untitled proposal";
  const summary = clean(proposal?.summary).slice(0, 520);
  const parts = [`- [${id}] ${title} — ${status}${summary ? `: ${summary}` : ""}`];
  const amendments = list(proposal?.amendments).filter((entry) => clean(entry?.text));
  if (amendments.length) {
    parts.push(`  amendments: ${amendments.slice(0, 4).map((entry) => `[${clean(entry.id)}] ${clean(entry.status || "proposed")}: ${clean(entry.text).slice(0, 260)}`).join(" | ")}`);
  }
  if (status === "voting" && proposal?.voting) {
    const eligible = list(proposal.voting.eligibleVoters);
    const ballots = proposal.voting.ballots && typeof proposal.voting.ballots === "object" ? proposal.voting.ballots : {};
    const mine = ownBallot(proposal, speakingAs);
    const speakingEligible = Boolean(eligibleEntry(proposal, speakingAs));
    const playerEligible = Boolean(eligibleEntry(proposal, playerCountry));
    const playerBallot = ownBallot(proposal, playerCountry);
    parts.push(`  voting rule: ${fmtRule(proposal.voting.rule)}; ballots recorded ${Object.keys(ballots).length}/${eligible.length}.`);
    parts.push(`  your ballot: ${speakingEligible ? (mine ? `${mine.choice}${clean(mine.reason) ? ` — ${clean(mine.reason).slice(0, 260)}` : ""}` : "NOT CAST") : "not eligible"}.`);
    if (playerCountry) parts.push(`  player ballot (${playerCountry}): ${playerEligible ? (playerBallot ? "CAST" : "NOT CAST") : "not eligible"}.`);
  } else if (proposal?.voting?.outcome) {
    const outcome = proposal.voting.outcome;
    parts.push(`  recorded outcome: ${clean(outcome.status || proposal.status)}${clean(outcome.reason) ? ` — ${clean(outcome.reason).slice(0, 320)}` : ""}.`);
  }
  if (proposal?.implementation?.status) {
    parts.push(`  implementation: ${clean(proposal.implementation.status)}.`);
  }
  return parts.join("\n");
};

export const buildInstitutionDiplomaticContext = ({
  world = {}, institutionId = "", speakingAs = "", playerCountry = "", maxActiveProposals = 6, maxRecentResolved = 3,
} = {}) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) return { text: "", institution: null, activeProposalIds: [], openVoteProposalIds: [], eligibleUncastVoteProposalIds: [], amendableProposalIds: [], canTableProposal: false };

  const members = list(institution.members);
  const speakerMember = members.find((member) => lower(member?.polity) === lower(speakingAs));
  const playerMember = members.find((member) => lower(member?.polity) === lower(playerCountry));
  const proposals = proposalList(institution);
  const active = proposals.filter(isLiveProposal).slice(0, Math.max(1, Number(maxActiveProposals) || 6));
  const resolved = proposals.filter((proposal) => !isLiveProposal(proposal)).slice(0, Math.max(0, Number(maxRecentResolved) || 0));
  const openVotes = active.filter((proposal) => lower(proposal.status) === "voting");
  const canTableProposal = institutionCanTableProposal(institution, speakingAs, { type: "resolution" });
  const amendableProposalIds = active
    .filter((proposal) => ["debate", "amendment"].includes(lower(proposal?.status)))
    .filter((proposal) => institutionCanProposeAmendment(institution, speakingAs, proposal))
    .map((proposal) => clean(proposal?.id))
    .filter(Boolean);

  const charter = institution.charter || {};
  const proposalRules = charter.proposalRules && typeof charter.proposalRules === "object" ? charter.proposalRules : {};
  const ruleLines = Object.entries(proposalRules).slice(0, 8).map(([type, rule]) => `  ${type}: ${fmtRule(rule)}`);

  const lines = [
    "[Institutional Channel State — canonical native state; this outranks conversation prose]",
    `${clean(institution.name) || clean(institution.id)} (${clean(institution.id)}) — ${clean(institution.kind || institution.type) || "institution"}; status ${clean(institution.status) || "active"}.`,
    `Your membership (${clean(speakingAs) || "speaker"}): ${speakerMember ? `${clean(speakerMember.status) || "member"}${clean(speakerMember.role) ? ` / ${clean(speakerMember.role)}` : ""}` : "not a current member"}.`,
    playerCountry ? `Player membership (${clean(playerCountry)}): ${playerMember ? `${clean(playerMember.status) || "member"}${clean(playerMember.role) ? ` / ${clean(playerMember.role)}` : ""}` : "not a current member"}.` : "",
    `Default voting rule: ${fmtRule(charter.votingRule || {})}.`,
    ...(ruleLines.length ? ["Proposal-specific rules:", ...ruleLines] : []),
  ].filter(Boolean);

  if (active.length) {
    lines.push("Current agenda:");
    for (const proposal of active) lines.push(proposalLine(proposal, { speakingAs, playerCountry }));
  } else {
    lines.push("Current agenda: no active formal proposals.");
  }
  if (resolved.length) {
    lines.push("Recent resolved/archived proposals:");
    for (const proposal of resolved) lines.push(proposalLine(proposal, { speakingAs, playerCountry }));
  }

  lines.push(
    "Authority rules:",
    "- The institution, charter, proposals, ballots and legal outcomes above are canonical. Do not invent a vote, membership change, legal resolution or implementation from chat prose.",
    "- You may negotiate, argue, propose compromises and explain your own position. Native code records/counts formal ballots and determines legal outcomes.",
    "- Never cast or imply a ballot for the player polity. Player silence, discussion or attendance is not consent.",
    "- During an open ballot you may disclose only your own ballot choice/reason from the state above. Do not claim knowledge of other secret/open-ballot choices that are not explicitly provided.",
    canTableProposal
      ? "- You are currently entitled to table a new resolution for debate. Doing so creates an agenda item only; it grants no legal outcome or implementation authority."
      : "- You may participate in discussion, but you are not currently entitled to place a new formal resolution on this institution's agenda.",
    amendableProposalIds.length
      ? `- You may propose amendments to these debate items: ${amendableProposalIds.join(", ")}. Amendments remain pending until resolved by canonical governance.`
      : "- You have no current amendment-proposal authority on the live agenda.",
  );

  const voteDirective = openVotes
    .filter((proposal) => eligibleEntry(proposal, speakingAs) && !ownBallot(proposal, speakingAs))
    .map((proposal) => clean(proposal.id))
    .filter(Boolean);
  if (voteDirective.length) {
    lines.push(
      `You are eligible and have NOT CAST a ballot on: ${voteDirective.join(", ")}.`,
      "If, and only if, you decide to cast a firm formal ballot during this reply, append one hidden INSTITUTION_VOTE JSON trailer as instructed by the turn envelope. Negotiation does not require voting.",
    );
  }

  // Hard bound for prompt hygiene even if a custom scenario creates unusually
  // verbose names/notes. The most decision-relevant material is deliberately
  // ordered first.
  const text = lines.join("\n").slice(0, 9000).trim();
  return {
    text,
    institution,
    activeProposalIds: active.map((proposal) => clean(proposal.id)).filter(Boolean),
    openVoteProposalIds: openVotes.map((proposal) => clean(proposal.id)).filter(Boolean),
    eligibleUncastVoteProposalIds: voteDirective,
    amendableProposalIds,
    canTableProposal,
  };
};
