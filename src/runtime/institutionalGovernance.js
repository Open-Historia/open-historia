/*! Open Historia Continuum — deterministic institutional governance / voting.
 * Institution owns charter + proposals + legal ballot. Chat mirrors discussion/history.
 */

import {
  applyInstitutionCharterResolution,
  applyInstitutionMembershipResolution,
  applyInstitutionStatusResolution,
  canonicalInstitutionIdentity,
  institutionChannelParticipants,
  normalizeInstitutionProposal,
  normalizeInstitutions,
  normalizeInstitutionVotingRule,
  resolveInstitutionRecord,
} from "./institutions.js";
import {
  mutateCanonicalTurnState,
  normalizeChatEntry,
  normalizeEvents,
  reconcileChatsForPlayer,
} from "./gameState.js";
import { materializeInstitutionalChannel } from "./institutionalChannels.js";
import { getPoliticalProfile } from "./politicalActors.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const slug = (value) => lower(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 96);
const list = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const unique = (values) => [...new Set(list(values).map(clean).filter(Boolean))];

const transitionMap = Object.freeze({
  draft: new Set(["debate", "withdrawn"]),
  debate: new Set(["amendment", "formalized", "withdrawn"]),
  amendment: new Set(["debate", "formalized", "withdrawn"]),
  formalized: new Set(["voting", "withdrawn"]),
  voting: new Set(["passed", "failed", "vetoed", "withdrawn"]),
  passed: new Set(["implementation", "archived"]),
  failed: new Set(["archived"]),
  vetoed: new Set(["archived"]),
  withdrawn: new Set(["archived"]),
  implementation: new Set(["archived"]),
  archived: new Set(),
});

const proposalMap = (institution) => institution?.proposals && typeof institution.proposals === "object"
  ? institution.proposals
  : {};

const normalizedWorldAndInstitution = (worldInput, institutionInput) => {
  const world = clone(worldInput || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  world.institutions = institutions;
  const institution = resolveInstitutionRecord(world, institutionInput);
  if (!institution) throw new Error(`Unknown institution ${clean(institutionInput) || "<blank>"}.`);
  return { world, institutions, institution: institutions.byId[institution.id] };
};

const commitInstitution = (world, institutions, institution) => {
  institutions.byId[institution.id] = institution;
  world.institutions = institutions;
  return world;
};

const proposalRuleFor = (institution, proposal) => {
  const proposalRule = institution?.charter?.proposalRules?.[slug(proposal?.type)];
  return normalizeInstitutionVotingRule(proposalRule || institution?.charter?.votingRule || {});
};

export const institutionVotingRuleForProposal = (institution = {}, proposal = {}) => proposalRuleFor(institution, proposal);

export const INSTITUTION_GOVERNANCE_ERROR_CODES = Object.freeze({
  VOTING_RULE_UNSPECIFIED: "institution-voting-rule-unspecified",
});

const governanceError = (message, code) => Object.assign(new Error(message), { code });

const memberByPolity = (institution, polity) => list(institution?.members)
  .find((member) => lower(member?.polity) === lower(polity));

// Proposal origination is a governance right, not merely a chat-membership
// privilege. Reuse the institution's proposal-specific/default eligibility
// statuses so observers/candidates can still speak in a room without silently
// gaining the power to place business on its formal agenda. An unspecified
// charter remains conservative: normalizeInstitutionVotingRule defaults
// eligibleStatuses to ["member"].
export const institutionCanTableProposal = (institutionInput = {}, polity = "", proposalInput = {}) => {
  const institution = institutionInput || {};
  if (lower(institution.status || "active") !== "active") return false;
  const member = memberByPolity(institution, polity);
  if (!member || lower(member.status || "member") === "suspended") return false;
  const rule = proposalRuleFor(institution, { type: proposalInput?.type || "resolution" });
  const statuses = new Set(list(rule.eligibleStatuses).map(lower));
  return statuses.has(lower(member.status || "member"));
};

export const institutionCanProposeAmendment = (institutionInput = {}, polity = "", proposalInput = {}) => (
  institutionCanTableProposal(institutionInput, polity, proposalInput)
);

const proposalSponsor = (proposal = {}, polity = "") => lower(proposal?.createdBy) === lower(polity)
  || list(proposal?.sponsorPolities).some((entry) => lower(entry) === lower(polity));

const acceptedAmendments = (proposal = {}) => list(proposal?.amendments)
  .filter((entry) => lower(entry?.status) === "accepted");

export const institutionEligibleVoters = (institutionInput = {}, ruleInput = {}) => {
  const institution = institutionInput || {};
  const rule = normalizeInstitutionVotingRule(ruleInput);
  const statuses = new Set(list(rule.eligibleStatuses).map(lower));
  const out = [];
  const seen = new Set();
  for (const member of list(institution.members)) {
    const polity = clean(member?.polity);
    const key = lower(polity);
    const status = lower(member?.status || "member");
    if (!polity || seen.has(key) || status === "suspended" || !statuses.has(status)) continue;
    seen.add(key);
    out.push(polity);
  }
  return out.sort((a, b) => a.localeCompare(b));
};

const isVetoHolder = (institution, rule, polity) => {
  const key = lower(polity);
  if (list(rule?.vetoPolities).some((entry) => lower(entry) === key)) return true;
  const member = memberByPolity(institution, polity);
  return Boolean(member && list(rule?.vetoRoles).map(lower).includes(lower(member.role)));
};

const weightFor = (rule, polity) => {
  const direct = Object.entries(rule?.weightsByPolity || {}).find(([candidate]) => lower(candidate) === lower(polity));
  const value = Number(direct?.[1]);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

export const tallyInstitutionBallot = ({ institution = {}, proposal = {} } = {}) => {
  const voting = proposal?.voting;
  if (!voting) throw new Error(`Proposal ${proposal?.id || "<unknown>"} has no voting snapshot.`);
  const rule = normalizeInstitutionVotingRule(voting.rule || {});
  if (rule.type === "unspecified") throw new Error("Institution voting rule is unspecified.");
  const eligible = unique(voting.eligibleVoters);
  if (!eligible.length) throw new Error("Institutional ballot has no eligible voters.");
  const eligibleKeys = new Set(eligible.map(lower));
  const ballots = Object.values(voting.ballots || {}).filter((ballot) => eligibleKeys.has(lower(ballot?.polity)));
  const byChoice = { yes: [], no: [], abstain: [], veto: [] };
  for (const ballot of ballots) {
    const choice = lower(ballot?.choice);
    if (byChoice[choice]) byChoice[choice].push(ballot);
  }

  const participating = new Set(ballots.map((ballot) => lower(ballot.polity))).size;
  const quorumRequired = Math.ceil(eligible.length * Number(rule.quorum || 0));
  const quorumMet = participating >= quorumRequired;
  const vetoBallots = ballots.filter((ballot) => (
    lower(ballot.choice) === "veto"
    || (lower(ballot.choice) === "no" && rule.negativeVoteIsVeto === true && isVetoHolder(institution, rule, ballot.polity))
  ) && isVetoHolder(institution, rule, ballot.polity));

  const yesWeight = byChoice.yes.reduce((sum, ballot) => sum + weightFor(rule, ballot.polity), 0);
  const noWeight = byChoice.no.reduce((sum, ballot) => sum + weightFor(rule, ballot.polity), 0)
    + byChoice.veto.reduce((sum, ballot) => sum + weightFor(rule, ballot.polity), 0);
  const abstainWeight = byChoice.abstain.reduce((sum, ballot) => sum + weightFor(rule, ballot.polity), 0);
  const eligibleWeight = eligible.reduce((sum, polity) => sum + weightFor(rule, polity), 0);
  const participationWeight = ballots.reduce((sum, ballot) => sum + weightFor(rule, ballot.polity), 0);
  const denominatorWeight = yesWeight + noWeight + (rule.abstentionPolicy === "count-against" ? abstainWeight : 0);
  const denominatorCount = byChoice.yes.length + byChoice.no.length + byChoice.veto.length
    + (rule.abstentionPolicy === "count-against" ? byChoice.abstain.length : 0);
  const yesShare = denominatorCount ? byChoice.yes.length / denominatorCount : 0;
  const yesWeightShare = denominatorWeight ? yesWeight / denominatorWeight : 0;

  let status = "failed";
  let reason = "threshold-not-met";
  if (vetoBallots.length) {
    status = "vetoed";
    reason = "veto-exercised";
  } else if (!quorumMet) {
    status = "failed";
    reason = "quorum-not-met";
  } else if (rule.type === "unanimity") {
    const allYes = eligible.every((polity) => lower(voting.ballots?.[polity]?.choice) === "yes"
      || Object.values(voting.ballots || {}).some((ballot) => lower(ballot?.polity) === lower(polity) && lower(ballot?.choice) === "yes"));
    status = allYes ? "passed" : "failed";
    reason = allYes ? "unanimous" : "unanimity-not-met";
  } else if (rule.type === "consensus") {
    const opposed = byChoice.no.length + byChoice.veto.length;
    status = opposed === 0 && byChoice.yes.length > 0 ? "passed" : "failed";
    reason = status === "passed" ? "consensus" : "consensus-objection";
  } else if (rule.type === "weighted") {
    status = yesWeightShare > Number(rule.threshold) ? "passed" : "failed";
    reason = status === "passed" ? "weighted-threshold-met" : "weighted-threshold-not-met";
  } else {
    const threshold = rule.type === "two-thirds" ? (2 / 3) : Number(rule.threshold);
    const passes = rule.type === "simple-majority" ? yesShare > threshold : yesShare >= threshold;
    status = passes ? "passed" : "failed";
    reason = passes ? "threshold-met" : "threshold-not-met";
  }

  return {
    status,
    reason,
    ruleType: rule.type,
    eligible: eligible.length,
    participating,
    quorumRequired,
    quorumMet,
    yes: byChoice.yes.length,
    no: byChoice.no.length,
    abstain: byChoice.abstain.length,
    veto: vetoBallots.length,
    yesShare,
    eligibleWeight,
    participationWeight,
    yesWeight,
    noWeight,
    abstainWeight,
    yesWeightShare,
    vetoPolities: vetoBallots.map((ballot) => ballot.polity),
  };
};

export const createInstitutionProposal = ({
  world: worldInput = {}, institutionId = "", proposal: proposalInput = {}, date = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  if (institution.status !== "active") throw new Error(`${institution.name} is not active.`);
  const proposal = normalizeInstitutionProposal({
    ...proposalInput,
    id: proposalInput.id || slug(proposalInput.title),
    status: "draft",
    createdDate: proposalInput.createdDate || date,
    lastUpdatedDate: date || proposalInput.lastUpdatedDate || proposalInput.createdDate,
  }, proposalInput.id || slug(proposalInput.title), world);
  if (!proposal) throw new Error("Proposal requires a stable id and title.");
  if (proposalMap(institution)[proposal.id]) throw new Error(`Proposal ${proposal.id} already exists in ${institution.name}.`);
  institution.proposals = { ...proposalMap(institution), [proposal.id]: proposal };
  institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
  commitInstitution(world, institutions, institution);
  return { world, institution, proposal };
};


export const lodgeInstitutionProposal = ({
  world: worldInput = {}, institutionId = "", proposal: proposalInput = {}, proposer = "", date = "",
} = {}) => {
  const proposerName = clean(proposer || proposalInput.createdBy);
  if (!proposerName) throw new Error("Institutional proposal requires a proposer.");
  const currentInstitution = resolveInstitutionRecord(worldInput, institutionId);
  if (!currentInstitution) throw new Error(`Unknown institution ${clean(institutionId) || "<blank>"}.`);
  if (!institutionCanTableProposal(currentInstitution, proposerName, proposalInput)) {
    throw new Error(`${proposerName} is not eligible to table ${clean(proposalInput?.type || "resolution")} proposals in ${currentInstitution.name}.`);
  }
  const created = createInstitutionProposal({
    world: worldInput,
    institutionId,
    date,
    proposal: {
      ...proposalInput,
      createdBy: proposerName,
      sponsorPolities: unique([proposerName, ...list(proposalInput.sponsorPolities)]),
    },
  });
  const debated = transitionInstitutionProposal({
    world: created.world,
    institutionId,
    proposalId: created.proposal.id,
    status: "debate",
    date,
  });
  return { ...debated, proposal: debated.proposal };
};

export const transitionInstitutionProposal = ({
  world: worldInput = {}, institutionId = "", proposalId = "", status = "", date = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
  const nextStatus = lower(status);
  const allowed = transitionMap[lower(proposal.status)] || new Set();
  if (!allowed.has(nextStatus)) throw new Error(`Proposal ${proposal.id} cannot transition ${proposal.status} -> ${nextStatus}.`);
  proposal.status = nextStatus;
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: proposal };
  institution.lastUpdatedDate = proposal.lastUpdatedDate || institution.lastUpdatedDate || "";
  commitInstitution(world, institutions, institution);
  return { world, institution, proposal };
};

export const addInstitutionProposalAmendment = ({
  world: worldInput = {}, institutionId = "", proposalId = "", amendment = {}, proposer = "", date = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
  if (!["debate", "amendment"].includes(lower(proposal.status))) throw new Error("Amendments require debate/amendment status.");
  const requestedProposer = clean(proposer || amendment.proposedBy || amendment.sponsor);
  const member = memberByPolity(institution, requestedProposer);
  const canonicalProposer = clean(member?.polity);
  if (!canonicalProposer || !institutionCanProposeAmendment(institution, canonicalProposer, proposal)) {
    throw new Error(`${requestedProposer || "<blank>"} is not eligible to propose an amendment to ${proposal.title}.`);
  }
  const id = slug(amendment.id || `amendment-${list(proposal.amendments).length + 1}`);
  const text = clean(amendment.text || amendment.summary || amendment.description).slice(0, 4000);
  if (!id || !text) throw new Error("Amendment requires id/text.");
  if (list(proposal.amendments).some((entry) => entry.id === id)) throw new Error(`Amendment ${id} already exists.`);
  const next = {
    id,
    text,
    proposedBy: canonicalProposer,
    proposedDate: clean(amendment.proposedDate || date),
    status: "proposed",
    ...(amendment.revision && typeof amendment.revision === "object" && !Array.isArray(amendment.revision) ? { revision: clone(amendment.revision) } : {}),
  };
  proposal.amendments = [...list(proposal.amendments), next];
  proposal.status = "amendment";
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(proposal, proposal.id, world) };
  commitInstitution(world, institutions, institution);
  const normalizedAmendment = institution.proposals[proposal.id].amendments.find((entry) => entry.id === id);
  return { world, institution, proposal: institution.proposals[proposal.id], amendment: normalizedAmendment };
};

export const resolveInstitutionProposalAmendment = ({
  world: worldInput = {}, institutionId = "", proposalId = "", amendmentId = "", status = "", requester = "", date = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
  if (!["debate", "amendment"].includes(lower(proposal.status))) throw new Error("Amendments may only be resolved before formalization.");
  const nextStatus = lower(status);
  if (!["accepted", "rejected", "withdrawn"].includes(nextStatus)) throw new Error(`Unsupported amendment status ${nextStatus}.`);
  const amendmentKey = slug(amendmentId);
  const current = list(proposal.amendments).find((entry) => entry.id === amendmentKey);
  if (!current) throw new Error(`Unknown amendment ${clean(amendmentId) || "<blank>"}.`);
  if (lower(current.status) !== "proposed") throw new Error(`Amendment ${current.id} is already ${current.status}.`);
  const requestedBy = clean(requester);
  const member = memberByPolity(institution, requestedBy);
  const canonicalRequester = clean(member?.polity);
  if (!canonicalRequester) throw new Error("Amendment resolution requires a current institutional actor.");
  if (["accepted", "rejected"].includes(nextStatus)) {
    if (!proposalSponsor(proposal, canonicalRequester) || !institutionCanTableProposal(institution, canonicalRequester, proposal)) {
      throw new Error(`${canonicalRequester} is not a current sponsor authorized to resolve amendment ${current.id}.`);
    }
  } else if (lower(current.proposedBy) !== lower(canonicalRequester)) {
    throw new Error(`Only ${current.proposedBy || "the amendment proposer"} may withdraw amendment ${current.id}.`);
  }

  let revisionApplied = false;
  if (nextStatus === "accepted" && current.revision && typeof current.revision === "object") {
    if (clean(current.revision.title)) proposal.title = clean(current.revision.title).slice(0, 240);
    if (clean(current.revision.summary)) proposal.summary = clean(current.revision.summary).slice(0, 6000);
    if (Array.isArray(current.revision.consequences)) proposal.consequences = clone(current.revision.consequences);
    revisionApplied = Boolean(clean(current.revision.title) || clean(current.revision.summary) || Array.isArray(current.revision.consequences));
  }

  proposal.amendments = list(proposal.amendments).map((entry) => entry.id === amendmentKey
    ? { ...entry, status: nextStatus, resolvedBy: canonicalRequester, resolvedDate: clean(date), revisionApplied }
    : entry);
  const unresolved = proposal.amendments.some((entry) => lower(entry?.status || "proposed") === "proposed");
  proposal.status = unresolved ? "amendment" : "debate";
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(proposal, proposal.id, world) };
  commitInstitution(world, institutions, institution);
  return {
    world, institution, proposal: institution.proposals[proposal.id],
    amendment: institution.proposals[proposal.id].amendments.find((entry) => entry.id === amendmentKey),
  };
};

export const openInstitutionProposalVoting = ({
  world: worldInput = {}, institutionId = "", proposalId = "", date = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  if (institution.status !== "active") throw new Error(`${institution.name} is not active.`);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
  if (lower(proposal.status) !== "formalized") throw new Error("Proposal must be formalized before voting opens.");
  const rule = proposalRuleFor(institution, proposal);
  if (rule.type === "unspecified") {
    throw governanceError(
      `${institution.name} has no canonical voting rule for proposal type ${proposal.type}.`,
      INSTITUTION_GOVERNANCE_ERROR_CODES.VOTING_RULE_UNSPECIFIED,
    );
  }
  const eligibleVoters = institutionEligibleVoters(institution, rule);
  if (!eligibleVoters.length) throw new Error("Institutional ballot has no eligible voters.");
  proposal.status = "voting";
  proposal.voting = {
    openedDate: clean(date),
    closedDate: "",
    rule: clone(rule),
    eligibleVoters,
    ballots: {},
    outcome: null,
  };
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(proposal, proposal.id, world) };
  commitInstitution(world, institutions, institution);
  return { world, institution, proposal: institution.proposals[proposal.id] };
};


export const submitInstitutionProposalForVoting = ({
  world: worldInput = {}, institutionId = "", proposalId = "", date = "", requester = "",
} = {}) => {
  const initial = resolveInstitutionRecord(worldInput, institutionId);
  const proposal = initial?.proposals?.[slug(proposalId)];
  if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
  const requesterName = clean(requester);
  if (requesterName) {
    const isSponsor = lower(proposal.createdBy) === lower(requesterName)
      || list(proposal.sponsorPolities).some((polity) => lower(polity) === lower(requesterName));
    if (!isSponsor) throw new Error(`${requesterName} is not a sponsor of ${proposal.title}.`);
    if (!institutionCanTableProposal(initial, requesterName, proposal)) {
      throw new Error(`${requesterName} is not currently eligible to submit ${proposal.title} for voting.`);
    }
  }
  const unresolvedAmendments = list(proposal.amendments).filter((entry) => lower(entry?.status || "proposed") === "proposed");
  if (unresolvedAmendments.length) throw new Error("Proposal has unresolved amendments and cannot open voting yet.");
  let world = worldInput;
  let current = proposal;
  if (["debate", "amendment"].includes(lower(current.status))) {
    const formalized = transitionInstitutionProposal({ world, institutionId, proposalId, status: "formalized", date });
    world = formalized.world;
    current = formalized.proposal;
  }
  if (lower(current.status) !== "formalized") throw new Error("Proposal must be in debate/formalized state before voting can open.");
  return openInstitutionProposalVoting({ world, institutionId, proposalId, date });
};

export const castInstitutionProposalVote = ({
  world: worldInput = {}, institutionId = "", proposalId = "", polity = "", choice = "",
  date = "", government = "", reason = "", playerCountry = "", authority = "npc",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal || lower(proposal.status) !== "voting" || !proposal.voting) throw new Error("Proposal is not open for voting.");
  const voter = clean(polity);
  const canonicalEligible = list(proposal.voting.eligibleVoters).find((entry) => lower(entry) === lower(voter));
  if (!canonicalEligible) throw new Error(`${voter || "<blank>"} is not eligible to vote on ${proposal.id}.`);
  const auth = lower(authority || "npc");
  const isPlayer = playerCountry && lower(canonicalEligible) === lower(playerCountry);
  if (isPlayer && !["player", "admin"].includes(auth)) throw new Error("NPC/institution authority cannot cast the player's institutional vote.");
  if (!isPlayer && auth === "player") throw new Error("Player authority cannot cast another polity's institutional vote.");
  const existingBallot = Object.values(proposal.voting.ballots || {})
    .find((ballot) => lower(ballot?.polity) === lower(canonicalEligible));
  if (existingBallot) throw new Error(`${canonicalEligible} has already cast a ballot on ${proposal.id}.`);
  const normalizedChoice = lower(choice);
  if (!["yes", "no", "abstain", "veto"].includes(normalizedChoice)) throw new Error(`Unsupported vote ${choice || "<blank>"}.`);
  const rule = normalizeInstitutionVotingRule(proposal.voting.rule || {});
  if (normalizedChoice === "veto" && !isVetoHolder(institution, rule, canonicalEligible)) {
    throw new Error(`${canonicalEligible} does not hold veto authority in ${institution.name}.`);
  }
  proposal.voting.ballots = {
    ...(proposal.voting.ballots || {}),
    [canonicalEligible]: {
      polity: canonicalEligible,
      choice: normalizedChoice,
      date: clean(date),
      government: clean(government).slice(0, 240),
      reason: clean(reason).slice(0, 1200),
    },
  };
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(proposal, proposal.id, world) };
  commitInstitution(world, institutions, institution);
  return { world, institution, proposal: institution.proposals[proposal.id], ballot: institution.proposals[proposal.id].voting.ballots[canonicalEligible] };
};

// Record a model-resolved NPC ballot batch in one normalization/mutation pass.
// The caller may never supply the player ballot through this path. All rows are
// validated first; one stale/illegal row rejects the WHOLE batch so a partial AI
// result cannot become a half-legal institutional decision.
export const castInstitutionProposalVoteBatch = ({
  world: worldInput = {}, institutionId = "", proposalId = "", ballots = [],
  date = "", playerCountry = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal || lower(proposal.status) !== "voting" || !proposal.voting) throw new Error("Proposal is not open for voting.");
  const rows = list(ballots);
  if (!rows.length) throw new Error("Institutional NPC ballot batch is empty.");

  const eligible = list(proposal.voting.eligibleVoters);
  const existing = new Set(Object.values(proposal.voting.ballots || {}).map((ballot) => lower(ballot?.polity)).filter(Boolean));
  const seen = new Set();
  const validated = [];
  const rule = normalizeInstitutionVotingRule(proposal.voting.rule || {});

  for (const row of rows) {
    const requested = clean(row?.polity);
    const canonicalEligible = eligible.find((entry) => lower(entry) === lower(requested));
    if (!canonicalEligible) throw new Error(`${requested || "<blank>"} is not eligible to vote on ${proposal.id}.`);
    if (playerCountry && lower(canonicalEligible) === lower(playerCountry)) {
      throw new Error("NPC ballot batch cannot cast the player's institutional vote.");
    }
    const key = lower(canonicalEligible);
    if (seen.has(key)) throw new Error(`NPC ballot batch contains duplicate voter ${canonicalEligible}.`);
    if (existing.has(key)) throw new Error(`${canonicalEligible} has already cast a ballot on ${proposal.id}.`);
    seen.add(key);
    const choice = lower(row?.choice);
    if (!["yes", "no", "abstain", "veto"].includes(choice)) throw new Error(`Unsupported vote ${row?.choice || "<blank>"}.`);
    if (choice === "veto" && !isVetoHolder(institution, rule, canonicalEligible)) {
      throw new Error(`${canonicalEligible} does not hold veto authority in ${institution.name}.`);
    }
    validated.push({
      polity: canonicalEligible,
      choice,
      date: clean(date),
      government: institutionGovernmentSnapshot(world, canonicalEligible),
      reason: clean(row?.reason).slice(0, 1200),
    });
  }

  proposal.voting.ballots = { ...(proposal.voting.ballots || {}) };
  for (const ballot of validated) proposal.voting.ballots[ballot.polity] = ballot;
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(proposal, proposal.id, world) };
  commitInstitution(world, institutions, institution);
  return { world, institution, proposal: institution.proposals[proposal.id], ballots: validated };
};

export const closeInstitutionProposalVoting = ({
  world: worldInput = {}, institutionId = "", proposalId = "", date = "",
} = {}) => {
  const { world, institutions, institution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(institution)[slug(proposalId)]);
  if (!proposal || lower(proposal.status) !== "voting" || !proposal.voting) throw new Error("Proposal is not open for voting.");
  const outcome = tallyInstitutionBallot({ institution, proposal });
  proposal.status = outcome.status;
  proposal.voting.closedDate = clean(date);
  proposal.voting.outcome = outcome;
  proposal.lastUpdatedDate = clean(date) || proposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(proposal, proposal.id, world) };

  // Lifecycle proposals must close their canonical lifecycle case even when
  // the institution rejects/vetoes the proposal. Passed proposals resolve
  // during implementation so the actual membership/status consequence stays
  // authoritative; failed/vetoed proposals terminate the pending case here.
  if (!["passed", "implementation"].includes(lower(outcome.status))) {
    const lifecycleCase = Object.values(institution.lifecycleCases || {})
      .find((entry) => clean(entry?.proposalId) === clean(proposal.id));
    if (lifecycleCase) {
      institution.lifecycleCases = {
        ...(institution.lifecycleCases || {}),
        [lifecycleCase.id]: {
          ...lifecycleCase,
          status: "rejected",
          decision: lifecycleCase.decision || "reject",
          resolvedDate: clean(date),
          updatedDate: clean(date),
          reason: lifecycleCase.reason || clean(outcome.reason),
        },
      };
    }
  }

  commitInstitution(world, institutions, institution);
  return { world, institution, proposal: institution.proposals[proposal.id], outcome };
};

const normalizeConsequenceKind = (value) => lower(value).replace(/[\s_]+/g, "-");

export const implementInstitutionProposal = ({
  world: worldInput = {},
  institutionId = "",
  proposalId = "",
  date = "",
  playerCountry = "",
  externalConsequenceApplier = null,
} = {}) => {
  const { world: baseWorld, institutions: baseInstitutions, institution: baseInstitution } = normalizedWorldAndInstitution(worldInput, institutionId);
  const proposal = clone(proposalMap(baseInstitution)[slug(proposalId)]);
  if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
  if (![["passed"], ["implementation"]].flat().includes(lower(proposal.status))) {
    throw new Error(`Proposal ${proposal.id} must be passed before implementation.`);
  }

  let world = baseWorld;
  const applied = list(proposal.implementation?.applied).map(clone);
  const alreadyApplied = new Set(applied.map((entry) => clean(entry?.id)).filter(Boolean));
  const pending = [];
  const consequences = list(proposal.consequences);
  const ambiguousAcceptedAmendments = acceptedAmendments(proposal)
    .filter((entry) => entry?.revisionApplied !== true);
  if (consequences.length && ambiguousAcceptedAmendments.length) {
    const amendmentIds = ambiguousAcceptedAmendments.map((entry) => entry.id).filter(Boolean).join(", ");
    const institutions = normalizeInstitutions(world.institutions, world);
    const institution = institutions.byId[baseInstitution.id];
    const currentProposal = clone(proposalMap(institution)[proposal.id] || proposal);
    currentProposal.status = "implementation";
    currentProposal.implementation = {
      status: "blocked",
      applied,
      pending: consequences.map((entry, index) => ({
        ...clone(entry),
        id: clean(entry?.id) || `consequence-${index + 1}`,
        blockedReason: `Accepted textual amendment${ambiguousAcceptedAmendments.length === 1 ? "" : "s"} ${amendmentIds || "(unspecified)"} require explicit consequence reconciliation before external execution.`,
      })),
      lastUpdatedDate: clean(date),
      note: "Accepted amendment text changed the legal proposal without an explicit structured consequence revision; external execution is fail-closed.",
    };
    currentProposal.lastUpdatedDate = clean(date) || currentProposal.lastUpdatedDate || "";
    institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(currentProposal, proposal.id, world) };
    institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
    institutions.byId[institution.id] = institution;
    world = { ...world, institutions };
    return { world, institution, proposal: institution.proposals[proposal.id], implementation: institution.proposals[proposal.id].implementation };
  }

  for (let index = 0; index < consequences.length; index += 1) {
    const consequence = consequences[index] && typeof consequences[index] === "object" ? consequences[index] : {};
    const id = clean(consequence.id) || `consequence-${index + 1}`;
    if (alreadyApplied.has(id)) continue;
    const kind = normalizeConsequenceKind(consequence.kind || consequence.type);
    let result = null;

    if (kind === "declaration" || kind === "policy-commitment") {
      // A declaratory resolution or institution-level policy commitment is fully
      // materialized by the canonical proposal and its outcome event. Neither is
      // reusable execution authority for a later sovereign/world mutation.
      result = { world };
    } else if (["institution-membership", "membership"].includes(kind)) {
      const membershipOp = lower(consequence.op);
      const targetPolity = clean(consequence.polity);
      const targetsPlayerAccession = playerCountry && lower(targetPolity) === lower(playerCountry)
        && ["join", "restore"].includes(membershipOp);
      const playerAffirmed = targetsPlayerAccession && (
        lower(proposal.createdBy) === lower(playerCountry)
        || list(proposal.sponsorPolities).some((polity) => lower(polity) === lower(playerCountry))
        || Object.values(proposal?.voting?.ballots || {}).some((ballot) => (
          lower(ballot?.polity) === lower(playerCountry) && lower(ballot?.choice) === "yes"
        ))
      );
      if (targetsPlayerAccession && !playerAffirmed) {
        result = { world, error: "Player accession/restore requires explicit player sponsorship/application or an affirmative player ballot." };
      } else result = applyInstitutionMembershipResolution({
        world,
        institutionId: consequence.institutionId || institutionId,
        op: consequence.op,
        polity: consequence.polity,
        status: consequence.status,
        role: consequence.role,
        date,
        sourceProposalId: proposal.id,
        note: consequence.note || proposal.title,
      });
    } else if (["institution-charter", "charter"].includes(kind)) {
      result = applyInstitutionCharterResolution({
        world,
        institutionId: consequence.institutionId || institutionId,
        charterPatch: consequence.charterPatch || consequence.patch || {},
        date,
        sourceProposalId: proposal.id,
      });
    }
    else if (["institution-status", "status"].includes(kind)) {
      result = applyInstitutionStatusResolution({
        world,
        institutionId: consequence.institutionId || institutionId,
        status: consequence.status,
        date,
        sourceProposalId: proposal.id,
        note: consequence.note || proposal.title,
      });
    }

    if (!result && typeof externalConsequenceApplier === "function") {
      result = externalConsequenceApplier({
        world,
        consequence: { ...clone(consequence), id, kind: kind || "unknown" },
        institution: resolveInstitutionRecord(world, institutionId),
        proposal: clone(proposal),
        date: clean(date),
      });
    }

    if (result && !result.error && result.world) {
      world = result.world;
      applied.push({ id, kind, date: clean(date) });
      alreadyApplied.add(id);
    } else {
      pending.push({
        ...clone(consequence),
        id,
        kind: kind || "unknown",
        ...(result?.error ? { blockedReason: clean(result.error) } : {}),
      });
    }
  }

  const institutions = normalizeInstitutions(world.institutions, world);
  const institution = institutions.byId[baseInstitution.id];
  const currentProposal = clone(proposalMap(institution)[proposal.id] || proposal);
  currentProposal.status = "implementation";
  currentProposal.implementation = {
    status: pending.length ? (applied.length ? "partial" : "blocked") : "complete",
    applied,
    pending,
    lastUpdatedDate: clean(date),
    note: pending.length ? "One or more consequences require another canonical owner or could not be applied safely." : "Institution-owned consequences materialized.",
  };
  currentProposal.lastUpdatedDate = clean(date) || currentProposal.lastUpdatedDate || "";
  institution.proposals = { ...proposalMap(institution), [proposal.id]: normalizeInstitutionProposal(currentProposal, proposal.id, world) };
  institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
  institutions.byId[institution.id] = institution;
  world = { ...world, institutions };
  return { world, institution, proposal: institution.proposals[proposal.id], implementation: institution.proposals[proposal.id].implementation };
};

const systemTextForCommand = (institution, proposal, command, detail = {}) => {
  const title = proposal?.title || proposal?.id || "Proposal";
  if (command === "create") return `${institution.name}: proposal opened — ${title}.`;
  if (command === "lodge-proposal") return `${detail.proposer || proposal?.createdBy || "A member"} tabled ${title} for debate in ${institution.name}.`;
  if (command === "submit-for-vote") return `${institution.name}: ${title} was formally submitted and voting opened.`;
  if (command === "status") return `${institution.name}: ${title} moved to ${proposal.status}.`;
  if (command === "amendment") return `${institution.name}: amendment proposed for ${title}.`;
  if (command === "amendment-status") return `${institution.name}: amendment ${detail.amendmentId || ""} ${detail.status}.`;
  if (command === "open-voting") return `${institution.name}: voting opened on ${title}.`;
  if (command === "vote") return `${detail.polity} cast a recorded ballot on ${title}.`;
  if (command === "vote-batch") {
    const count = Number(detail.ballotCount) || 0;
    const outcome = detail.outcome;
    return outcome
      ? `${institution.name}: ${count} member ballot${count === 1 ? "" : "s"} recorded; ${title} ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}.`
      : `${institution.name}: ${count} member ballot${count === 1 ? "" : "s"} recorded on ${title}.`;
  }
  if (command === "close-voting") return `${institution.name}: ${title} ${proposal.status}${detail.outcome?.reason ? ` (${detail.outcome.reason})` : ""}.`;
  if (command === "implement") return `${institution.name}: implementation updated for ${title} — ${proposal.implementation?.status || "pending"}.`;
  return `${institution.name}: ${title} updated.`;
};

const appendInstitutionSystemMessage = (chats, channelId, text, date) => chats.map((chat) => {
  if (clean(chat?.id) !== clean(channelId)) return chat;
  const message = {
    role: "system",
    speaker: "System",
    text: clean(text),
    time: clean(date),
  };
  return normalizeChatEntry({ ...chat, messages: [...list(chat.messages), message] }) || chat;
});

const proposalOutcomeEventId = (institution, proposal) => `institution-resolution-${slug(institution?.id || institution?.name)}-${slug(proposal?.id)}`;

// Ballot `reason` is the deliberately public rationale stored on the legal
// institution record. It is safe to surface in institutional history; private
// PWv2 decision context never enters this function. Keep the selection tiny and
// deterministic so outcome events remain useful without becoming a second
// transcript of the entire vote.
const publicBallotHighlights = (proposal = {}, outcome = {}, limit = 3) => {
  const ballots = Object.values(proposal?.voting?.ballots || {})
    .map((ballot) => ({
      polity: clean(ballot?.polity),
      choice: lower(ballot?.choice),
      reason: clean(ballot?.reason).slice(0, 240),
    }))
    .filter((ballot) => ballot.polity && ballot.reason && ["yes", "no", "abstain", "veto"].includes(ballot.choice));
  if (!ballots.length) return [];

  const preferred = lower(outcome?.status) === "vetoed"
    ? ["veto", "no", "yes", "abstain"]
    : lower(outcome?.status) === "passed"
      ? ["yes", "no", "veto", "abstain"]
      : ["no", "veto", "yes", "abstain"];
  const picked = [];
  const used = new Set();
  for (const choice of preferred) {
    const ballot = ballots.find((entry) => entry.choice === choice && !used.has(lower(entry.polity)));
    if (!ballot) continue;
    picked.push(ballot);
    used.add(lower(ballot.polity));
    if (picked.length >= limit) return picked;
  }
  for (const ballot of ballots) {
    if (used.has(lower(ballot.polity))) continue;
    picked.push(ballot);
    used.add(lower(ballot.polity));
    if (picked.length >= limit) break;
  }
  return picked;
};

// An outcome's headline and line, whole sentences, so a language pack can
// translate each (the game's own English; the shipped packs carry it).
const outcomeEventTitle = (status, name, title) => {
  if (status === "passed") return `${name} Approves ${title}`;
  if (status === "vetoed") return `${name} Vote on ${title} Is Vetoed`;
  return `${name} Rejects ${title}`;
};

const outcomeEventDescription = (status, { name, title, yes, no, abstain, veto, participating, eligible, rest }) => {
  if (status === "passed") return `${name} formally approved ${title}. Recorded ballot: ${yes} yes, ${no} no, ${abstain} abstain${veto ? `, ${veto} veto` : ""}; ${participating}/${eligible} eligible members participated.${rest ? ` ${rest}` : ""}`;
  if (status === "vetoed") return `${name} formally vetoed ${title}. Recorded ballot: ${yes} yes, ${no} no, ${abstain} abstain${veto ? `, ${veto} veto` : ""}; ${participating}/${eligible} eligible members participated.${rest ? ` ${rest}` : ""}`;
  return `${name} formally rejected ${title}. Recorded ballot: ${yes} yes, ${no} no, ${abstain} abstain${veto ? `, ${veto} veto` : ""}; ${participating}/${eligible} eligible members participated.${rest ? ` ${rest}` : ""}`;
};

const proposalOutcomeEvent = ({ institution, proposal, outcome, date = "", playerCountry = "" } = {}) => {
  if (!institution || !proposal || !outcome) return null;
  const status = lower(outcome.status || proposal.status);
  const title = outcomeEventTitle(status, institution.name, proposal.title);
  const acceptedClauses = acceptedAmendments(proposal)
    .map((entry) => clean(entry?.text).slice(0, 320))
    .filter(Boolean)
    .slice(0, 3);
  const summary = [
    clean(proposal.summary).slice(0, 700),
    acceptedClauses.length ? `Accepted amendments: ${acceptedClauses.join("; ")}` : "",
  ].filter(Boolean).join(" ").slice(0, 1200);
  const highlights = publicBallotHighlights(proposal, outcome);
  const publicPositions = highlights.length
    ? ` Public positions: ${highlights.map((ballot) => `${ballot.polity} (${ballot.choice}) — ${ballot.reason}`).join("; ")}.`
    : "";
  const description = outcomeEventDescription(status, {
    name: institution.name,
    title: proposal.title,
    yes: Number(outcome.yes) || 0,
    no: Number(outcome.no) || 0,
    abstain: Number(outcome.abstain) || 0,
    veto: Number(outcome.veto) || 0,
    participating: Number(outcome.participating) || 0,
    eligible: Number(outcome.eligible) || 0,
    rest: `${summary}${publicPositions}`.trim(),
  });
  const typeText = `${proposal.type} ${proposal.title} ${proposal.summary}`.toLocaleLowerCase();
  const military = /military|defen[cs]e|deploy|war|security|force|troop|weapon|sanction/.test(typeText);
  const playerBallot = Object.values(proposal?.voting?.ballots || {}).some((ballot) => lower(ballot?.polity) === lower(playerCountry));
  return {
    id: proposalOutcomeEventId(institution, proposal),
    date: clean(date || proposal?.voting?.closedDate),
    title: title.slice(0, 240),
    description: description.trim().slice(0, 2400),
    importance: military || ["charter-amendment", "accession", "agreement", "treaty"].includes(lower(proposal.type)) ? "major" : "minor",
    kind: "diplomacy",
    tags: military ? ["Diplomacy", "Politics", "Military"] : ["Diplomacy", "Politics"],
    notable: status === "passed" || status === "vetoed",
    playerRelated: playerBallot,
    source: "institutional-governance",
    agency: {
      principal: institution.name,
      principalKind: "institution",
      authority: "autonomous",
      authorityRef: "",
      sovereignPolity: "",
      sovereignActors: [],
    },
  };
};

const appendProposalOutcomeEvent = (events, payload) => {
  const event = proposalOutcomeEvent(payload);
  if (!event) return normalizeEvents(events);
  const normalized = normalizeEvents(events);
  if (normalized.some((entry) => clean(entry.id) === clean(event.id))) return normalized;
  return normalizeEvents([...normalized, event]);
};

export const applyInstitutionGovernanceCommand = ({
  world: worldInput = {}, chats: chatsInput = [], events: eventsInput = [], institutionId = "", playerCountry = "", date = "", command = {},
  externalConsequenceApplier = null,
} = {}) => {
  const materialized = materializeInstitutionalChannel({
    world: worldInput,
    chats: chatsInput,
    institutionId,
    playerCountry,
    date,
  });
  let result;
  const type = lower(command.type);
  const common = { world: materialized.world, institutionId, date };
  if (type === "create") result = createInstitutionProposal({ ...common, proposal: command.proposal || command });
  else if (type === "lodge-proposal") result = lodgeInstitutionProposal({ ...common, proposal: command.proposal || command, proposer: command.proposer });
  else if (type === "submit-for-vote") result = submitInstitutionProposalForVoting({ ...common, proposalId: command.proposalId, requester: command.requester });
  else if (type === "status") result = transitionInstitutionProposal({ ...common, proposalId: command.proposalId, status: command.status });
  else if (type === "amendment") result = addInstitutionProposalAmendment({ ...common, proposalId: command.proposalId, amendment: command.amendment || command, proposer: command.proposer });
  else if (type === "amendment-status") result = resolveInstitutionProposalAmendment({ ...common, proposalId: command.proposalId, amendmentId: command.amendmentId, status: command.status, requester: command.requester });
  else if (type === "open-voting") result = openInstitutionProposalVoting({ ...common, proposalId: command.proposalId });
  else if (type === "vote") result = castInstitutionProposalVote({
    ...common,
    proposalId: command.proposalId,
    polity: command.polity,
    choice: command.choice,
    government: institutionGovernmentSnapshot(materialized.world, command.polity),
    reason: command.reason,
    playerCountry,
    authority: command.authority || "npc",
  });
  else if (type === "vote-batch") result = castInstitutionProposalVoteBatch({
    ...common,
    proposalId: command.proposalId,
    ballots: command.ballots,
    playerCountry,
  });
  else if (type === "close-voting") result = closeInstitutionProposalVoting({ ...common, proposalId: command.proposalId });
  else if (type === "implement") result = implementInstitutionProposal({ ...common, proposalId: command.proposalId, playerCountry, externalConsequenceApplier });
  else throw new Error(`Unsupported institutional governance command ${command.type || "<blank>"}.`);

  let outcome = result.outcome || null;
  let closedThisCommand = type === "close-voting";
  let implementation = result.implementation || null;
  if (type === "close-voting" && outcome?.status === "passed" && command.implementWhenPassed === true) {
    const implemented = implementInstitutionProposal({
      world: result.world, institutionId, proposalId: result.proposal.id, date, playerCountry, externalConsequenceApplier,
    });
    result = { ...result, ...implemented, outcome };
    implementation = implemented.implementation;
  }
  if (["vote", "vote-batch"].includes(type) && command.finalizeWhenComplete === true && lower(result.proposal?.status) === "voting") {
    const voting = result.proposal.voting || {};
    const recorded = new Set(Object.values(voting.ballots || {}).map((ballot) => lower(ballot?.polity)).filter(Boolean));
    const complete = list(voting.eligibleVoters).every((polity) => recorded.has(lower(polity)));
    if (complete) {
      const closed = closeInstitutionProposalVoting({ world: result.world, institutionId, proposalId: result.proposal.id, date });
      result = { ...result, ...closed, ballots: result.ballots, ballot: result.ballot };
      outcome = closed.outcome;
      closedThisCommand = true;
      if (outcome.status === "passed" && command.implementWhenPassed === true) {
        const implemented = implementInstitutionProposal({
          world: result.world, institutionId, proposalId: result.proposal.id, date, playerCountry, externalConsequenceApplier,
        });
        result = { ...result, ...implemented, outcome };
        implementation = implemented.implementation;
      }
    }
  }

  const institution = resolveInstitutionRecord(result.world, institutionId);
  const proposal = result.proposal;
  const text = systemTextForCommand(institution, proposal, type, {
    ...command,
    ballotCount: result.ballots?.length,
    outcome,
  });
  const chats = reconcileChatsForPlayer(
    appendInstitutionSystemMessage(materialized.chats, materialized.channel.id, text, date),
    result.world,
    playerCountry,
  );
  const events = closedThisCommand
    ? appendProposalOutcomeEvent(eventsInput, { institution, proposal, outcome, date, playerCountry })
    : normalizeEvents(eventsInput);
  return {
    ...result, outcome, implementation, events, chats,
    channel: chats.find((chat) => lower(chat.institutionId) === lower(institution.id)) || materialized.channel,
  };
};


const activeInstitutionalMemberForPlayer = (world, institutionId, playerCountry) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution || lower(institution.status || "active") !== "active") {
    throw new Error("Institution is not active.");
  }
  const member = memberByPolity(institution, playerCountry);
  if (!member || lower(member.status || "member") === "suspended") {
    throw new Error("Your polity is not an active participant in this institution.");
  }
  return { institution, member };
};

const isProposalSponsor = (proposal, polity) => lower(proposal?.createdBy) === lower(polity)
  || list(proposal?.sponsorPolities).some((entry) => lower(entry) === lower(polity));

export const commitInstitutionalPlayerProposal = async ({
  institutionId = "", playerCountry = "", date = "", expectedGameId = "", proposal = {},
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    const player = clean(playerCountry || game?.country);
    const { institution } = activeInstitutionalMemberForPlayer(world, institutionId, player);
    if (!institutionCanTableProposal(institution, player, proposal)) {
      throw new Error(`${player} is not eligible to table this proposal under the institution's current charter.`);
    }
    result = applyInstitutionGovernanceCommand({
      world, chats, events, institutionId, playerCountry: player, date: date || game?.gameDate || "",
      command: {
        type: "lodge-proposal",
        proposer: player,
        proposal: {
          ...clone(proposal),
          createdBy: player,
          sponsorPolities: unique([player, ...list(proposal?.sponsorPolities)]),
        },
      },
    });
    return { world: result.world, chats: result.chats, events: result.events };
  }, { playerCountry, expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institutional proposal was not committed.");
  return { ...result, world: committed.world, chats: committed.chat || result.chats, events: committed.events || result.events };
};

export const commitInstitutionalPlayerVoteRequest = async ({
  institutionId = "", proposalId = "", playerCountry = "", date = "", expectedGameId = "",
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    const player = clean(playerCountry || game?.country);
    const { institution } = activeInstitutionalMemberForPlayer(world, institutionId, player);
    const proposal = institution?.proposals?.[slug(proposalId)];
    if (!proposal) throw new Error(`Unknown proposal ${clean(proposalId) || "<blank>"}.`);
    if (!isProposalSponsor(proposal, player)) throw new Error("Only a current sponsor may submit this proposal for a formal vote.");
    result = applyInstitutionGovernanceCommand({
      world, chats, events, institutionId, playerCountry: player, date: date || game?.gameDate || "",
      command: { type: "submit-for-vote", proposalId, requester: player },
    });
    return { world: result.world, chats: result.chats, events: result.events };
  }, { playerCountry, expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institutional vote request was not committed.");
  return { ...result, world: committed.world, chats: committed.chat || result.chats, events: committed.events || result.events };
};

export const commitInstitutionGovernanceCommand = async ({
  institutionId = "", playerCountry = "", date = "", command = {}, expectedGameId = "",
  expectedGameDate = "", expectedRound = null, externalConsequenceApplier = null,
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    if (clean(expectedGameDate) && clean(game?.gameDate) !== clean(expectedGameDate)) {
      throw new Error("Campaign date changed while institutional governance reasoning was in flight.");
    }
    if (expectedRound !== null && expectedRound !== undefined && Number.isFinite(Number(expectedRound))
        && Number(game?.round || 0) !== Number(expectedRound)) {
      throw new Error("Campaign round changed while institutional governance reasoning was in flight.");
    }
    result = applyInstitutionGovernanceCommand({
      world,
      chats,
      events,
      institutionId,
      playerCountry: playerCountry || game?.country || "",
      date: date || game?.gameDate || "",
      command,
      externalConsequenceApplier,
    });
    return { world: result.world, chats: result.chats, events: result.events };
  }, { playerCountry, expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institutional governance command was not committed.");
  return { ...result, world: committed.world, chats: committed.chat || result.chats, events: committed.events || result.events };
};


const institutionGovernmentSnapshot = (world, polity) => {
  const actor = getPoliticalProfile(world, polity);
  if (!actor) return "";
  const government = actor.government || {};
  const parties = list(actor.parties);
  const governingIds = unique([
    ...list(government.rulingPartyIds),
    ...list(government.coalitionPartyIds),
  ]);
  const governingNames = governingIds.map((id) => {
    const party = parties.find((entry) => lower(entry?.id) === lower(id) || lower(entry?.name) === lower(id));
    return clean(party?.name || id);
  }).filter(Boolean);
  const officeholderName = (value) => clean(typeof value === "string" ? value : value?.name || value?.id);
  const head = officeholderName(government.headOfGovernment) || officeholderName(government.headOfState);
  return [governingNames.join(" + "), head, clean(government.form)].filter(Boolean).join(" | ").slice(0, 240);
};

const appendInstitutionLeaderReply = ({ chats, channelId, speakingAs, code = "", reply = "", memorySummary = "", reaction = "", date = "" }) => {
  const visibleReply = clean(reply);
  if (!visibleReply) throw new Error("Institutional diplomatic reply is blank.");
  return list(chats).map((chat) => {
    if (clean(chat?.id) !== clean(channelId)) return chat;
    const messages = list(chat.messages).map(clone);
    if (clean(reaction)) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (lower(messages[index]?.role) !== "user") continue;
        messages[index] = {
          ...messages[index],
          reactions: {
            ...(messages[index].reactions || {}),
            [clean(speakingAs)]: { emoji: clean(reaction), code: clean(code) },
          },
        };
        break;
      }
    }
    messages.push({
      role: "leader",
      speaker: clean(speakingAs),
      code: clean(code),
      text: visibleReply,
      time: clean(date),
      ...(clean(memorySummary) ? { memorySummary: clean(memorySummary) } : {}),
    });
    return normalizeChatEntry({ ...chat, messages }) || chat;
  });
};


const institutionMemberForPolity = (institution, polity) => list(institution?.members)
  .find((member) => lower(member?.polity) === lower(polity));

export const applyInstitutionalPlayerMessage = ({
  world: worldInput = {}, chats: chatsInput = [], institutionId = "", playerCountry = "", text = "", date = "",
} = {}) => {
  const messageText = clean(text);
  if (!messageText) throw new Error("Institutional diplomatic message is blank.");
  const materialized = materializeInstitutionalChannel({
    world: worldInput, chats: chatsInput, institutionId, playerCountry, date,
  });
  const institution = resolveInstitutionRecord(materialized.world, institutionId);
  if (!institution || lower(institution.status || "active") === "dissolved") {
    throw new Error("This institution is not active.");
  }
  const membership = institutionMemberForPolity(institution, playerCountry);
  if (!membership || lower(membership.status || "member") === "suspended") {
    throw new Error(`${clean(playerCountry) || "The player polity"} is not an active participant in ${institution.name}.`);
  }
  const chats = materialized.chats.map((chat) => {
    if (clean(chat.id) !== clean(materialized.channel.id)) return chat;
    return normalizeChatEntry({
      ...chat,
      messages: [...list(chat.messages), {
        role: "user", speaker: clean(playerCountry), text: messageText, time: clean(date),
      }],
    }) || chat;
  });
  const reconciled = reconcileChatsForPlayer(chats, materialized.world, playerCountry);
  return {
    world: materialized.world,
    chats: reconciled,
    institution,
    channel: reconciled.find((chat) => lower(chat?.institutionId) === lower(institution.id)) || materialized.channel,
  };
};

export const commitInstitutionalPlayerMessage = async ({
  institutionId = "", playerCountry = "", text = "", date = "", expectedGameId = "",
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, game }) => {
    result = applyInstitutionalPlayerMessage({
      world, chats, institutionId,
      playerCountry: playerCountry || game?.country || "",
      text,
      date: date || game?.gameDate || "",
    });
    return { world: result.world, chats: result.chats };
  }, { playerCountry, expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institutional player message was not committed.");
  const committedChats = committed.chat || committed.chats || result.chats;
  return {
    ...result,
    world: committed.world,
    chats: committedChats,
    channel: list(committedChats).find((chat) => lower(chat?.institutionId) === lower(result.channel?.institutionId)) || result.channel,
  };
};

// One native publication for an institutional leader reply and its optional
// formal ballot. The model may propose only its OWN ballot metadata; this seam
// derives voter identity/government from native state, validates eligibility,
// and records the legal ballot before the generation is published. Invalid or
// stale ballot metadata is ignored without losing the visible diplomatic reply.
export const applyInstitutionalDiplomaticReply = ({
  world: worldInput = {}, chats: chatsInput = [], events: eventsInput = [], institutionId = "", playerCountry = "",
  speakingAs = "", code = "", reply = "", memorySummary = "", reaction = "",
  institutionVote = null, institutionProposal = null, institutionAmendment = null, date = "", externalConsequenceApplier = null,
} = {}) => {
  const materialized = materializeInstitutionalChannel({
    world: worldInput, chats: chatsInput, institutionId, playerCountry, date,
  });
  const speaker = clean(speakingAs);
  const participant = list(materialized.channel?.countries).find((entry) =>
    [entry?.name, entry?.code, entry?.polityKey].some((value) => lower(value) === lower(speaker)));
  if (!participant) throw new Error(`${speaker || "<blank>"} is not a current participant in this institutional channel.`);

  let world = materialized.world;
  let events = normalizeEvents(eventsInput);
  // Visible speech is committed first in conversational order. Any native
  // governance system rows created from hidden metadata follow it in the same
  // atomic generation. Speech itself remains legally inert.
  let chats = appendInstitutionLeaderReply({
    chats: materialized.chats, channelId: materialized.channel.id, speakingAs: speaker,
    code: clean(code || participant?.code), reply, memorySummary, reaction, date,
  });

  let createdAmendment = null;
  let amendmentError = "";
  if (institutionAmendment && typeof institutionAmendment === "object") {
    try {
      const amendmentResult = applyInstitutionGovernanceCommand({
        world, chats, events, institutionId, playerCountry, date,
        command: {
          type: "amendment",
          proposalId: clean(institutionAmendment.proposalId),
          proposer: speaker,
          amendment: { text: clean(institutionAmendment.text).slice(0, 4000) },
        },
      });
      world = amendmentResult.world;
      chats = amendmentResult.chats;
      events = amendmentResult.events;
      createdAmendment = amendmentResult.amendment || null;
    } catch (error) {
      amendmentError = clean(error?.message || error);
    }
  }

  let createdProposal = null;
  let proposalError = "";
  if (institutionProposal && typeof institutionProposal === "object") {
    try {
      const proposalResult = applyInstitutionGovernanceCommand({
        world, chats, events, institutionId, playerCountry, date,
        command: {
          type: "lodge-proposal",
          proposer: speaker,
          // Provider metadata may table only a plain resolution. It cannot
          // smuggle implementation/consequence objects into native canon.
          proposal: {
            type: "resolution",
            title: clean(institutionProposal.title).slice(0, 240),
            summary: clean(institutionProposal.summary).slice(0, 2400),
          },
        },
      });
      world = proposalResult.world;
      chats = proposalResult.chats;
      events = proposalResult.events;
      createdProposal = proposalResult.proposal || null;
    } catch (error) {
      proposalError = clean(error?.message || error);
    }
  }

  let ballot = null;
  let voteError = "";
  let votedProposal = null;
  let outcome = null;
  let implementation = null;
  if (institutionVote && typeof institutionVote === "object") {
    try {
      const voteResult = applyInstitutionGovernanceCommand({
        world, chats, events, institutionId, playerCountry, date, externalConsequenceApplier,
        command: {
          type: "vote",
          proposalId: institutionVote.proposalId,
          polity: speaker,
          choice: institutionVote.choice,
          reason: institutionVote.reason,
          authority: "npc",
          finalizeWhenComplete: true,
          implementWhenPassed: true,
        },
      });
      world = voteResult.world;
      chats = voteResult.chats;
      events = voteResult.events;
      ballot = voteResult.ballot || null;
      votedProposal = voteResult.proposal || null;
      outcome = voteResult.outcome || null;
      implementation = voteResult.implementation || null;
    } catch (error) {
      voteError = clean(error?.message || error);
    }
  }

  chats = reconcileChatsForPlayer(chats, world, playerCountry);
  const institution = resolveInstitutionRecord(world, institutionId);
  return {
    world, chats, events, ballot, voteError, votedProposal, outcome, implementation,
    createdProposal, proposalError, createdAmendment, amendmentError, institution,
    channel: chats.find((chat) => lower(chat?.institutionId) === lower(canonicalInstitutionIdentity(institution || materialized.institution).id)) || materialized.channel,
  };
};

export const commitInstitutionalDiplomaticReply = async ({
  institutionId = "", playerCountry = "", speakingAs = "", code = "", reply = "",
  memorySummary = "", reaction = "", institutionVote = null, institutionProposal = null, institutionAmendment = null, date = "", expectedGameId = "",
  externalConsequenceApplier = null,
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    result = applyInstitutionalDiplomaticReply({
      world, chats, events, institutionId,
      playerCountry: playerCountry || game?.country || "",
      speakingAs, code, reply, memorySummary, reaction, institutionVote, institutionProposal, institutionAmendment,
      date: date || game?.gameDate || "", externalConsequenceApplier,
    });
    return { world: result.world, chats: result.chats, events: result.events };
  }, { playerCountry, expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institutional diplomatic reply was not committed.");
  const committedChats = committed.chat || committed.chats || result.chats;
  return {
    ...result,
    world: committed.world,
    chats: committedChats,
    events: committed.events || result.events,
    channel: list(committedChats).find((chat) => lower(chat?.institutionId) === lower(result.channel?.institutionId)) || result.channel,
  };
};



// Apply the formal-governance subset of Beta's one-request group-chat action
// batch. Conversation remains conversation; only explicit institution_* actions
// may touch the institution ledger. Each action is grounded and applied on its
// own so one bad proposal/ballot never poisons its siblings.
export const applyInstitutionalChatGovernanceBatch = ({
  world: worldInput = {}, chats: chatsInput = [], events: eventsInput = [], institutionId = "",
  playerCountry = "", date = "", chatEvents = [], formalActions = [], cursors = null,
  externalConsequenceApplier = null,
} = {}) => {
  let materialized = materializeInstitutionalChannel({
    world: worldInput, chats: chatsInput, institutionId, playerCountry, date,
  });
  let world = materialized.world;
  let chats = materialized.chats;
  let events = normalizeEvents(eventsInput);

  if (list(chatEvents).length) {
    chats = chats.map((chat) => {
      if (clean(chat.id) !== clean(materialized.channel.id)) return chat;
      const existing = list(chat.events);
      return normalizeChatEntry({ ...chat, events: [...existing, ...list(chatEvents)] }) || chat;
    });
  }

  const institution = resolveInstitutionRecord(world, institutionId);
  const participantRows = institutionChannelParticipants(world, institutionId);
  const actorByFold = new Map();
  for (const row of participantRows) {
    const polity = clean(row?.polityKey || row?.code || row?.name);
    if (!polity) continue;
    for (const token of [row?.polityKey, row?.code, row?.name]) {
      if (clean(token)) actorByFold.set(lower(token), polity);
    }
  }
  const playerTokens = new Set([lower(playerCountry)]);
  for (const row of participantRows) {
    if ([row?.polityKey, row?.code, row?.name].some((value) => lower(value) === lower(playerCountry))) {
      [row?.polityKey, row?.code, row?.name].forEach((value) => { if (clean(value)) playerTokens.add(lower(value)); });
    }
  }

  const applied = [];
  const rejected = [];
  for (const action of list(formalActions)) {
    const actorToken = clean(action?.actorName);
    const polity = actorByFold.get(lower(actorToken));
    if (!polity) {
      rejected.push({ action, reason: `${actorToken || "<blank>"} is not a current member of this institution.` });
      continue;
    }
    if (playerTokens.has(lower(actorToken)) || lower(polity) === lower(playerCountry)) {
      rejected.push({ action, reason: `${actorToken} is human-controlled; the model cannot exercise formal institutional authority for the player.` });
      continue;
    }

    let command = null;
    if (action.type === "institution_lodge_proposal") {
      command = {
        type: "lodge-proposal", proposer: polity,
        proposal: { type: clean(action.proposalType || "resolution"), title: clean(action.title), summary: clean(action.summary) },
      };
    } else if (action.type === "institution_submit_proposal") {
      command = { type: "submit-for-vote", proposalId: action.proposalId, requester: polity };
    } else if (action.type === "institution_amendment") {
      command = { type: "amendment", proposalId: action.proposalId, proposer: polity, amendment: { text: action.amendmentText } };
    } else if (action.type === "institution_resolve_amendment") {
      command = {
        type: "amendment-status", proposalId: action.proposalId, amendmentId: action.amendmentId,
        status: action.amendmentStatus, requester: polity,
      };
    } else if (action.type === "institution_vote") {
      command = {
        type: "vote", proposalId: action.proposalId, polity, choice: action.voteChoice,
        reason: action.reason || "", authority: "npc", finalizeWhenComplete: true, implementWhenPassed: true,
      };
    }
    if (!command) {
      rejected.push({ action, reason: `Unsupported formal institutional action ${clean(action?.type) || "<blank>"}.` });
      continue;
    }

    try {
      const result = applyInstitutionGovernanceCommand({
        world, chats, events, institutionId, playerCountry, date, command, externalConsequenceApplier,
      });
      world = result.world;
      chats = result.chats;
      events = result.events;
      applied.push({ action, command, proposal: result.proposal || null, ballot: result.ballot || null, outcome: result.outcome || null });
    } catch (error) {
      rejected.push({ action, reason: clean(error?.message || error) || "formal institutional action was refused" });
    }
  }

  if (cursors && typeof cursors === "object" && Object.keys(cursors).length) {
    world = { ...world, chatKnowledgeCursors: { ...(world.chatKnowledgeCursors || {}), ...cursors } };
  }
  chats = reconcileChatsForPlayer(chats, world, playerCountry);
  const finalInstitution = resolveInstitutionRecord(world, institutionId) || institution;
  const channel = chats.find((chat) => lower(chat?.institutionId) === lower(canonicalInstitutionIdentity(finalInstitution).id)) || materialized.channel;
  return { world, chats, events, institution: finalInstitution, channel, applied, rejected };
};

export const commitInstitutionalChatGovernanceBatch = async ({
  institutionId = "", playerCountry = "", date = "", chatEvents = [], formalActions = [], cursors = null,
  expectedGameId = "", externalConsequenceApplier = null,
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    result = applyInstitutionalChatGovernanceBatch({
      world, chats, events, institutionId,
      playerCountry: playerCountry || game?.country || "",
      date: date || game?.gameDate || "",
      chatEvents, formalActions, cursors, externalConsequenceApplier,
    });
    return { world: result.world, chats: result.chats, events: result.events };
  }, { expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institutional chat turn was not committed.");
  const committedChats = committed.chat || committed.chats || result.chats;
  return {
    ...result,
    world: committed.world,
    chats: committedChats,
    events: committed.events || result.events,
    channel: list(committedChats).find((chat) => lower(chat?.institutionId) === lower(result.channel?.institutionId)) || result.channel,
  };
};
