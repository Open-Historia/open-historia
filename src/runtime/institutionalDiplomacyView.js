/*! Open Historia Continuum — pure player-facing institutional diplomacy view.
 * Presentation only. All legal actions still flow through institutionalGovernance.
 */

import { institutionStrategicPriority, institutionsForPolity, normalizeInstitutions, resolveInstitutionRecord } from "./institutions.js";
import { institutionCanProposeAmendment, institutionCanTableProposal } from "./institutionalGovernance.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const values = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : []);

const ballotFor = (proposal, polity) => {
  const ballots = proposal?.voting?.ballots && typeof proposal.voting.ballots === "object" ? proposal.voting.ballots : {};
  const key = Object.keys(ballots).find((candidate) => lower(candidate) === lower(polity));
  return key ? ballots[key] : null;
};

const isEligible = (proposal, polity) => list(proposal?.voting?.eligibleVoters)
  .some((candidate) => lower(candidate) === lower(polity));

const playerCanVeto = (institution, proposal, playerCountry) => {
  const rule = proposal?.voting?.rule || {};
  const member = list(institution?.members).find((entry) => lower(entry?.polity) === lower(playerCountry));
  return list(rule.vetoPolities).some((entry) => lower(entry) === lower(playerCountry))
    || (member?.role && list(rule.vetoRoles).some((entry) => lower(entry) === lower(member.role)));
};

const ruleLabel = (rule = {}) => {
  const type = clean(rule.type || "unspecified").replace(/-/g, " ");
  if (type === "qualified majority" && Number.isFinite(Number(rule.threshold))) return `${type} (${Math.round(Number(rule.threshold) * 100)}%)`;
  return type;
};

const humanize = (value) => clean(value).replace(/[-_]+/g, " ");

const votingRuleView = (rule = {}) => ({
  type: lower(rule?.type || "unspecified"),
  label: ruleLabel(rule),
  threshold: Number.isFinite(Number(rule?.threshold)) ? Number(rule.threshold) : null,
  quorum: Number.isFinite(Number(rule?.quorum)) ? Number(rule.quorum) : null,
  abstentionPolicy: lower(rule?.abstentionPolicy || "exclude"),
  eligibleStatuses: list(rule?.eligibleStatuses).map(humanize),
  vetoPolities: list(rule?.vetoPolities).map(clean).filter(Boolean),
  vetoRoles: list(rule?.vetoRoles).map(humanize).filter(Boolean),
  negativeVoteIsVeto: rule?.negativeVoteIsVeto === true,
});

export const buildInstitutionProposalView = (institution, proposal, playerCountry) => {
  const voting = proposal?.voting || null;
  const eligible = voting ? isEligible(proposal, playerCountry) : false;
  const ballot = voting ? ballotFor(proposal, playerCountry) : null;
  const ballotMap = voting?.ballots && typeof voting.ballots === "object" && !Array.isArray(voting.ballots) ? voting.ballots : {};
  const recordedPolities = new Set([
    ...Object.keys(ballotMap).map(lower),
    ...values(ballotMap).map((entry) => lower(entry?.polity)),
  ].filter(Boolean));
  const unresolvedVoters = voting ? list(voting.eligibleVoters).filter((polity) => !recordedPolities.has(lower(polity))) : [];
  const unresolvedNpcVoters = unresolvedVoters.filter((polity) => !playerCountry || lower(polity) !== lower(playerCountry));
  const unresolvedAmendments = list(proposal?.amendments).filter((entry) => lower(entry?.status || "proposed") === "proposed").length;
  const playerSponsor = lower(proposal?.createdBy) === lower(playerCountry)
    || list(proposal?.sponsorPolities).some((polity) => lower(polity) === lower(playerCountry));
  const playerCanAmend = ["debate", "amendment"].includes(lower(proposal?.status))
    && institutionCanProposeAmendment(institution, playerCountry, proposal);
  const amendmentViews = list(proposal?.amendments).map((entry) => ({
    id: clean(entry?.id),
    text: clean(entry?.text),
    status: lower(entry?.status || "proposed"),
    proposedBy: clean(entry?.proposedBy),
    proposedDate: clean(entry?.proposedDate),
    resolvedBy: clean(entry?.resolvedBy),
    resolvedDate: clean(entry?.resolvedDate),
    revisionApplied: entry?.revisionApplied === true,
    playerCanWithdraw: lower(entry?.status || "proposed") === "proposed" && lower(entry?.proposedBy) === lower(playerCountry),
    playerCanResolve: lower(entry?.status || "proposed") === "proposed" && playerSponsor
      && institutionCanTableProposal(institution, playerCountry, proposal),
  }));
  return {
    id: clean(proposal?.id),
    type: clean(proposal?.type || "resolution"),
    title: clean(proposal?.title || proposal?.id || "Untitled proposal"),
    summary: clean(proposal?.summary),
    status: lower(proposal?.status || "draft"),
    ruleLabel: voting ? ruleLabel(voting.rule) : "",
    eligibleVoters: voting ? list(voting.eligibleVoters).length : 0,
    ballotsRecorded: voting?.ballots && typeof voting.ballots === "object" ? Object.keys(voting.ballots).length : 0,
    unresolvedVoters: unresolvedVoters.length,
    unresolvedNpcVoters: unresolvedNpcVoters.length,
    playerEligible: eligible,
    playerBallot: ballot ? { choice: lower(ballot.choice), reason: clean(ballot.reason), date: clean(ballot.date) } : null,
    playerCanVeto: eligible && !ballot && playerCanVeto(institution, proposal, playerCountry),
    outcome: voting?.outcome || null,
    closedBallots: voting?.outcome && lower(proposal?.status) !== "voting"
      ? values(ballotMap).map((entry) => ({
        polity: clean(entry?.polity),
        choice: lower(entry?.choice),
        reason: clean(entry?.reason),
        government: clean(entry?.government),
        date: clean(entry?.date),
      })).filter((entry) => entry.polity && entry.choice)
      : [],
    implementationStatus: clean(proposal?.implementation?.status),
    amendments: amendmentViews.length,
    amendmentItems: amendmentViews,
    unresolvedAmendments,
    playerCanAmend,
    createdBy: clean(proposal?.createdBy),
    lastUpdatedDate: clean(proposal?.lastUpdatedDate || proposal?.voting?.closedDate || proposal?.voting?.openedDate || proposal?.createdDate),
    playerSponsor,
    playerCanSubmitForVote: playerSponsor
      && ["debate", "formalized"].includes(lower(proposal?.status))
      && unresolvedAmendments === 0,
  };
};

export const buildInstitutionDiplomacyView = ({ world = {}, institutionId = "", playerCountry = "" } = {}) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) return null;
  const member = list(institution.members).find((entry) => lower(entry?.polity) === lower(playerCountry)) || null;
  const proposals = values(institution.proposals)
    .filter(Boolean)
    .map((proposal) => buildInstitutionProposalView(institution, proposal, playerCountry))
    .sort((a, b) => {
      const attentionRank = (proposal) => {
        if (proposal.status === "voting" && proposal.playerEligible && !proposal.playerBallot) return 0;
        if (proposal.amendmentItems?.some((entry) => entry.playerCanResolve)) return 1;
        if (proposal.status === "voting") return 2;
        if (["debate", "amendment", "formalized"].includes(proposal.status)) return 3;
        if (["passed", "implementation"].includes(proposal.status)) return 4;
        if (proposal.status === "draft") return 5;
        return 6;
      };
      const rank = attentionRank(a) - attentionRank(b);
      if (rank) return rank;
      const date = String(b.lastUpdatedDate || "").localeCompare(String(a.lastUpdatedDate || ""));
      return date || a.title.localeCompare(b.title);
    });
  const canParticipate = lower(institution.status || "active") !== "dissolved"
    && Boolean(member)
    && lower(member.status || "member") !== "suspended";
  const canTableProposal = canParticipate
    && institutionCanTableProposal(institution, playerCountry, { type: "resolution" });
  const activeStatuses = new Set(["draft", "debate", "amendment", "formalized", "voting"]);
  const decisionStatuses = new Set(["passed", "failed", "vetoed", "implementation", "archived"]);
  const proposalRuleEntries = Object.entries(institution?.charter?.proposalRules || {}).map(([type, rule]) => ({
    type,
    label: humanize(type),
    rule: votingRuleView(rule),
  }));
  const members = list(institution.members).map((entry) => ({
    polity: clean(entry?.polity),
    role: humanize(entry?.role || "member"),
    status: humanize(entry?.status || "member"),
    since: clean(entry?.sinceDate || entry?.joinedDate || entry?.accessionDate),
  })).filter((entry) => entry.polity);
  return {
    institution,
    member,
    canParticipate,
    canTableProposal,
    proposals,
    activeProposals: proposals.filter((proposal) => activeStatuses.has(proposal.status)),
    decisionHistory: proposals.filter((proposal) => decisionStatuses.has(proposal.status)).slice(0, 12),
    openBallots: proposals.filter((proposal) => proposal.status === "voting"),
    members,
    memberSummary: {
      total: members.length,
      active: members.filter((entry) => entry.status !== "suspended").length,
      suspended: members.filter((entry) => entry.status === "suspended").length,
    },
    charterView: {
      defaultRule: votingRuleView(institution?.charter?.votingRule || {}),
      proposalRules: proposalRuleEntries,
      note: clean(institution?.charter?.note),
      lastUpdatedDate: clean(institution?.charter?.lastUpdatedDate),
    },
  };
};


export const buildPublicInstitutionDiplomacyView = ({ world = {}, institutionId = "", playerCountry = "" } = {}) => {
  const view = buildInstitutionDiplomacyView({ world, institutionId, playerCountry });
  if (!view) return null;
  const publicHistoryActions = new Set([
    "founded", "activated", "reactivated", "joined", "observer", "associate",
    "left", "withdrawn", "expelled", "suspended", "reinstated", "dissolved",
  ]);
  // A non-member can inspect public institutional history, but pending accession
  // negotiations, invitations, counterterms and their private rationale remain
  // member/participant knowledge. Public history is deliberately reason-light: the
  // visible fact of joining/leaving is canon; private diplomatic reasoning is not.
  const publicInstitution = {
    ...view.institution,
    lifecycleCases: {},
    membershipHistory: list(view.institution?.membershipHistory)
      .filter((entry) => publicHistoryActions.has(lower(entry?.action)))
      .map((entry) => ({
        id: clean(entry?.id),
        action: lower(entry?.action),
        polity: clean(entry?.polity),
        actor: clean(entry?.actor),
        date: clean(entry?.date),
        status: clean(entry?.status),
        role: clean(entry?.role),
        sourceProposalId: clean(entry?.sourceProposalId),
      })),
  };
  return {
    ...view,
    institution: publicInstitution,
    canParticipate: false,
    canTableProposal: false,
    proposals: [],
    activeProposals: [],
    decisionHistory: [],
    openBallots: [],
  };
};

export const listInstitutionDiplomacyViews = (world = {}, playerCountry = "") =>
  institutionsForPolity(world, playerCountry, { includeSuspended: true, includeDissolved: true }).map(({ institution, member }) => {
    const view = buildInstitutionDiplomacyView({ world, institutionId: institution.id, playerCountry });
    return {
      institution: view?.institution || institution,
      member: view?.member || member,
      canParticipate: view?.canParticipate ?? lower(member?.status) !== "suspended",
      canTableProposal: view?.canTableProposal ?? false,
      activeProposalCount: view?.activeProposals?.length || 0,
      openBallotCount: view?.openBallots?.length || 0,
      playerPendingBallotCount: view?.openBallots?.filter((proposal) => proposal.playerEligible && !proposal.playerBallot).length || 0,
      playerPendingAmendmentReviewCount: view?.proposals?.reduce((sum, proposal) => (
        sum + list(proposal?.amendmentItems).filter((amendment) => amendment.playerCanResolve).length
      ), 0) || 0,
    };
  });

// World browser view: unlike listInstitutionDiplomacyViews(), this intentionally
// enumerates the canonical institution ledger rather than treating membership as
// existence. Non-members receive the same read-only presentation projection, but
// no participation/proposal authority. Dissolved institutions are historical and
// stay out of the default "currently in the world" browser.
export const listAllInstitutionDiplomacyViews = (world = {}, playerCountry = "", { includeDissolved = false } = {}) => {
  const ledger = normalizeInstitutions(world?.institutions, world);
  const rows = Object.values(ledger.byId)
    .filter((institution) => includeDissolved || lower(institution?.status || "active") !== "dissolved")
    .map((institution) => {
      const view = buildInstitutionDiplomacyView({ world: { ...world, institutions: ledger }, institutionId: institution.id, playerCountry });
      const member = view?.member || null;
      return {
        institution: view?.institution || institution,
        member,
        canParticipate: member ? (view?.canParticipate ?? false) : false,
        canTableProposal: member ? (view?.canTableProposal ?? false) : false,
        // Without a first-class institution visibility policy, non-members see
        // that an organization exists but do not receive its live internal
        // agenda/ballot metadata merely by opening the world directory.
        activeProposalCount: member ? (view?.activeProposals?.length || 0) : 0,
        openBallotCount: member ? (view?.openBallots?.length || 0) : 0,
        playerPendingBallotCount: member ? (view?.openBallots?.filter((proposal) => proposal.playerEligible && !proposal.playerBallot).length || 0) : 0,
        playerPendingAmendmentReviewCount: member ? (view?.proposals?.reduce((sum, proposal) => (
          sum + list(proposal?.amendmentItems).filter((amendment) => amendment.playerCanResolve).length
        ), 0) || 0) : 0,
      };
    });
  return rows.sort((a, b) => (
    Number(Boolean(b.member)) - Number(Boolean(a.member))
    || institutionStrategicPriority(b.institution) - institutionStrategicPriority(a.institution)
    || String(a.institution?.name || a.institution?.id || "").localeCompare(String(b.institution?.name || b.institution?.id || ""))
  ));
};
