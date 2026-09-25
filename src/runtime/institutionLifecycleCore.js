/*! Open Historia Continuum — canonical live institution lifecycle (pure core).
 *
 * This module owns deterministic institution lifecycle state only. It does not
 * call providers and it does not infer consent. AI may explain/decide for AI
 * governments through the existing diplomacy request, but every resulting
 * membership mutation is validated here against an explicit lifecycle case.
 */

import {
  INSTITUTION_KINDS,
  applyInstitutionMembershipResolution,
  applyInstitutionStatusResolution,
  canonicalInstitutionIdentity,
  institutionFoundingThresholdReached,
  institutionPendingLifecycleCases,
  normalizeInstitutionLifecycleCase,
  normalizeInstitutionRecord,
  normalizeInstitutionProposal,
  normalizeInstitutionVotingRule,
  normalizeInstitutions,
  resolveInstitutionRecord,
} from "./institutions.js";
import { resolvePolityIdentity } from "./polityIdentity.js";
import { stableAsciiId } from "./stableId.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const list = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const slug = (value) => stableAsciiId(value, { maxLength: 96 });
const unique = (values, limit = 128) => {
  const out = [];
  const seen = new Set();
  for (const raw of list(values)) {
    const value = clean(raw);
    const key = lower(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

const canonicalPolity = (value, world = {}) => {
  const token = clean(value);
  if (!token) return "";
  const resolved = resolvePolityIdentity(token, world, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return clean(resolved?.resolved || token);
};

const samePolity = (a, b) => lower(a) === lower(b);
const memberByPolity = (institution, polity) => list(institution?.members).find((member) => samePolity(member?.polity, polity)) || null;
const caseMap = (institution) => institution?.lifecycleCases && typeof institution.lifecycleCases === "object" ? institution.lifecycleCases : {};

// Keep lifecycle planning pure: these mirror the deterministic governance
// eligibility/rule selection without importing the commit-bearing governance
// module (which pulls in the full runtime store).
const institutionVotingRuleForProposal = (institution = {}, proposal = {}) => {
  const proposalType = slug(proposal?.type);
  const proposalRule = institution?.charter?.proposalRules?.[proposalType];
  return normalizeInstitutionVotingRule(proposalRule || institution?.charter?.votingRule || {});
};
const institutionEligibleVoters = (institution = {}, ruleInput = {}) => {
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

const upsertHistory = (institution, entry) => {
  const id = slug(entry?.id || `${entry?.action || "history"}-${entry?.polity || "institution"}-${entry?.date || Date.now()}`);
  const next = { ...entry, id };
  const rows = list(institution.membershipHistory).filter((row) => clean(row?.id) !== id);
  rows.push(next);
  institution.membershipHistory = rows.slice(-512);
};

const lifecycleCaseId = (institutionId, kind, polity, date = "") => (
  slug(`${institutionId}-${kind}-${polity}-${date}`) || slug(`${institutionId}-${kind}-${polity}`)
);

const caseIsOpen = (entry) => ["pending", "negotiating", "pending-approval"].includes(lower(entry?.status));
const caseNeedsDiplomaticResponse = (entry) => ["pending", "negotiating"].includes(lower(entry?.status));

const setCase = (institution, entry, world) => {
  const normalized = normalizeInstitutionLifecycleCase(entry, entry?.id, world);
  if (!normalized) return null;
  institution.lifecycleCases = { ...caseMap(institution), [normalized.id]: normalized };
  return normalized;
};

const mutateInstitution = (worldInput, institutionInput, mutator) => {
  const world = clone(worldInput || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const resolved = resolveInstitutionRecord({ ...world, institutions }, institutionInput);
  if (!resolved) return { world: { ...world, institutions }, institution: null, error: `Unknown institution ${clean(institutionInput) || "<blank>"}.` };
  const institution = clone(institutions.byId[resolved.id]);
  const result = mutator(institution, world, institutions) || {};
  if (result.error) return { world: { ...world, institutions }, institution, ...result };
  institutions.byId[institution.id] = normalizeInstitutionRecord(institution, institution.id, { ...world, institutions });
  return { world: { ...world, institutions }, institution: institutions.byId[institution.id], ...result, error: "" };
};

const lifecycleEvent = ({ institution, action, polity = "", actor = "", date = "", reason = "", playerCountry = "" } = {}) => {
  const actionLabel = {
    founded: "Founded",
    joined: "Joins",
    observer: "Becomes Observer in",
    left: "Leaves",
    expelled: "Is Expelled from",
    suspended: "Is Suspended from",
    reinstated: "Returns to",
    dissolved: "Dissolved",
    rejected: "Declines",
  }[action] || action;
  const subject = polity || institution?.name || "Institution";
  const title = action === "founded"
    ? `${institution.name} Is Founded`
    : action === "dissolved"
      ? `${institution.name} Is Dissolved`
      : `${subject} ${actionLabel} ${institution.name}`;
  const description = action === "founded"
    ? `${actor || polity || "A founding government"} establishes ${institution.name}${reason ? `: ${reason}` : "."}`
    : action === "dissolved"
      ? `${institution.name} is formally dissolved${reason ? `: ${reason}` : "."}`
      : `${polity} ${actionLabel.toLocaleLowerCase()} ${institution.name}${reason ? `: ${reason}` : "."}`;
  return {
    id: `institution-lifecycle-${slug(institution?.id || institution?.name)}-${slug(action)}-${slug(polity || date || "institution")}`,
    date: clean(date),
    title: title.slice(0, 240),
    description: description.slice(0, 2400),
    importance: ["founded", "dissolved", "expelled"].includes(action) ? "major" : "minor",
    kind: "diplomacy",
    tags: ["Diplomacy", "Politics", "Institutions"],
    notable: ["founded", "joined", "left", "expelled", "dissolved"].includes(action),
    playerRelated: samePolity(polity, playerCountry) || samePolity(actor, playerCountry),
    source: "institution-lifecycle",
    agency: {
      principal: institution?.name || institution?.id || "Institution",
      principalKind: "institution",
      authority: "autonomous",
      authorityRef: "",
      sovereignPolity: "",
      sovereignActors: [],
    },
  };
};

const dedupeEvents = (events, additions) => {
  const out = [...list(events)];
  const ids = new Set(out.map((event) => clean(event?.id)).filter(Boolean));
  for (const event of list(additions)) {
    if (!event?.id || ids.has(clean(event.id))) continue;
    ids.add(clean(event.id));
    out.push(event);
  }
  return out;
};

const proposalIdForCase = (institution, lifecycleCase) => slug(`${lifecycleCase.kind}-${lifecycleCase.polity}-${lifecycleCase.id}`);

const createLifecycleProposal = (institution, lifecycleCase, world, date, { op, status = "member", title, summary } = {}) => {
  const id = proposalIdForCase(institution, lifecycleCase);
  if (institution.proposals?.[id]) return institution.proposals[id];
  const rule = institutionVotingRuleForProposal(institution, { type: lifecycleCase.kind === "application" || lifecycleCase.kind.includes("invitation") ? "accession" : lifecycleCase.kind });
  const normalizedRule = normalizeInstitutionVotingRule(
    rule?.type && rule.type !== "unspecified" ? rule : institution?.charter?.lifecycle?.approvalRule || institution?.charter?.votingRule || {},
    world,
  );
  if (!normalizedRule.type || normalizedRule.type === "unspecified") throw new Error(`${institution.name} has no usable voting rule for ${lifecycleCase.kind}.`);
  const eligibleVoters = institutionEligibleVoters(institution, normalizedRule);
  if (!eligibleVoters.length) throw new Error(`${institution.name} has no eligible voters for ${lifecycleCase.kind}.`);
  const proposal = normalizeInstitutionProposal({
    id,
    type: lifecycleCase.kind === "application" || lifecycleCase.kind.includes("invitation") ? "accession" : lifecycleCase.kind,
    title,
    summary,
    status: "voting",
    createdDate: clean(date),
    createdBy: lifecycleCase.initiatedBy || lifecycleCase.polity,
    sponsorPolities: lifecycleCase.initiatedBy ? [lifecycleCase.initiatedBy] : [],
    voting: {
      openedDate: clean(date),
      rule: normalizedRule,
      eligibleVoters,
      ballots: {},
      outcome: null,
    },
    consequences: op === "dissolve"
      ? [{ id: `${id}-status`, kind: "institution-status", institutionId: institution.id, status: "dissolved", note: summary }]
      : [{ id: `${id}-membership`, kind: "institution-membership", institutionId: institution.id, op, polity: lifecycleCase.polity, status, role: "member", note: summary }],
    lastUpdatedDate: clean(date),
    sourceEventIds: [],
    note: `Lifecycle case ${lifecycleCase.id}`,
  }, id, world);
  institution.proposals = { ...(institution.proposals || {}), [proposal.id]: proposal };
  return proposal;
};

const foundingChat = ({ institution, invitees, founder, playerCountry, caseIds, date }) => {
  const player = clean(playerCountry);
  const actor = clean(founder);
  if (!invitees.length || !player || (!samePolity(actor, player) && !invitees.some((name) => samePolity(name, player)))) return null;
  const counterparts = samePolity(actor, player)
    ? invitees.filter((name) => !samePolity(name, player))
    : unique([actor, ...invitees.filter((name) => !samePolity(name, player) && !samePolity(name, actor))], 24);
  if (!counterparts.length) return null;
  const playerFounded = samePolity(actor, player);
  return {
    id: `institution-founding-${institution.id}-${slug(date || "now")}`,
    countries: counterparts.map((name) => ({ name, code: "" })),
    messages: [{
      role: playerFounded ? "user" : "leader",
      speaker: actor,
      text: playerFounded
        ? `${actor} invites ${invitees.join(", ")} to join the founding of ${institution.name}.`
        : `${actor} invites ${player} to join the founding of ${institution.name}.`,
      time: clean(date),
    }],
    status: "open",
    source: "institution-lifecycle",
    title: `${institution.name} founding invitation`,
    lifecycleInstitutionId: institution.id,
    lifecycleCaseIds: caseIds,
  };
};

const accessionHearingChat = ({ institution, lifecycleCase, applicant = "", playerCountry = "", date = "", existingChats = [] } = {}) => {
  const player = clean(playerCountry);
  const polity = clean(applicant || lifecycleCase?.polity);
  if (!institution?.id || !lifecycleCase?.id || !polity) return null;
  const playerIsApplicant = player && samePolity(player, polity);
  const playerIsMember = player && Boolean(memberByPolity(institution, player));
  if (!playerIsApplicant && !playerIsMember) return null;
  const participantNames = unique([
    ...list(institution.members).map((entry) => clean(entry?.polity)).filter(Boolean),
    polity,
  ], 80);
  const existing = list(existingChats).find((chat) => (
    samePolity(chat?.lifecycleInstitutionId, institution.id)
    && list(chat?.lifecycleCaseIds).some((id) => clean(id) === clean(lifecycleCase.id))
  ));
  const initialMessage = {
    role: playerIsApplicant ? "user" : "leader",
    speaker: polity,
    text: lifecycleCase.kind === "application"
      ? `${polity} formally applies for ${lifecycleCase.requestedStatus || "member"} status in ${institution.name}.`
      : `${polity} accepts the invitation and seeks ${lifecycleCase.requestedStatus || "member"} status in ${institution.name}.`,
    time: clean(date),
  };
  const base = existing || {
    id: `institution-accession-${slug(institution.id)}-${slug(polity)}-${slug(lifecycleCase.id)}`,
    messages: [initialMessage],
    status: "open",
    source: "institution-lifecycle",
  };
  return {
    ...base,
    institutionId: institution.id,
    lifecycleInstitutionId: institution.id,
    lifecycleCaseIds: unique([...(base.lifecycleCaseIds || []), lifecycleCase.id], 32),
    countries: participantNames.map((name) => ({ name, code: "" })),
    title: `${institution.name} accession hearing — ${polity}`,
    status: "open",
    source: "institution-lifecycle",
  };
};


export const ensureInstitutionLifecycleNegotiationChatCore = ({
  world = {}, chats = [], institutionId = "", caseIds = [], playerCountry = "", date = "",
} = {}) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) throw new Error(`Unknown institution ${clean(institutionId) || "<blank>"}.`);
  const player = canonicalPolity(playerCountry, world);
  if (!player) throw new Error("Institution lifecycle negotiation requires the player polity.");
  const wanted = new Set(list(caseIds).map(clean).filter(Boolean));
  const cases = Object.values(caseMap(institution))
    .filter((entry) => caseIsOpen(entry))
    .filter((entry) => !wanted.size || wanted.has(clean(entry?.id)));
  if (!cases.length) throw new Error("No open institution lifecycle case is available for negotiation.");

  const openCaseIds = unique(cases.map((entry) => entry.id), 32);
  const existing = list(chats).find((chat) => (
    samePolity(chat?.lifecycleInstitutionId, institution.id)
    && list(chat?.lifecycleCaseIds).some((id) => openCaseIds.includes(clean(id)))
  ));
  if (existing) {
    const counterpartNames = unique([
      ...list(existing.countries).map((country) => clean(country?.name || country)),
      ...cases.flatMap((entry) => samePolity(entry?.initiatedBy, player) ? [entry?.polity] : [entry?.initiatedBy]),
    ], 80).filter((name) => name && !samePolity(name, player));
    const channel = {
      ...existing,
      status: "open",
      source: existing.source || "institution-lifecycle",
      lifecycleInstitutionId: institution.id,
      lifecycleCaseIds: unique([...(existing.lifecycleCaseIds || []), ...openCaseIds], 32),
      ...(counterpartNames.length ? { countries: counterpartNames.map((name) => ({ name, code: "" })) } : {}),
    };
    return {
      world,
      chats: [channel, ...list(chats).filter((chat) => clean(chat?.id) !== clean(channel.id))],
      institution,
      cases,
      channel,
      reopened: lower(existing.status) === "closed",
    };
  }

  const foundingCases = cases.filter((entry) => lower(entry?.kind) === "founding-invitation");
  let channel = null;
  if (foundingCases.length === cases.length) {
    const founder = clean(foundingCases[0]?.initiatedBy);
    const sameFounder = foundingCases.every((entry) => samePolity(entry?.initiatedBy, founder));
    if (founder && sameFounder) {
      const originalDate = clean(foundingCases.map((entry) => entry?.createdDate).filter(Boolean).sort()[0] || date);
      channel = foundingChat({
        institution,
        invitees: unique(foundingCases.map((entry) => entry?.polity), 24),
        founder,
        playerCountry: player,
        caseIds: openCaseIds,
        date: originalDate,
      });
    }
  }

  if (!channel && cases.length === 1 && lower(cases[0]?.kind) === "invitation") {
    const lifecycleCase = cases[0];
    const inviter = clean(lifecycleCase.initiatedBy);
    const target = clean(lifecycleCase.polity);
    const playerInvolved = samePolity(inviter, player) || samePolity(target, player);
    if (playerInvolved) {
      const counterpart = samePolity(inviter, player) ? target : inviter;
      const originalDate = clean(lifecycleCase.createdDate || date);
      channel = {
        id: `institution-invite-${institution.id}-${slug(target)}-${slug(originalDate || "now")}`,
        countries: counterpart ? [{ name: counterpart, code: "" }] : [],
        messages: [{
          role: samePolity(inviter, player) ? "user" : "leader",
          speaker: inviter,
          text: `${inviter} invites ${target} to seek ${lifecycleCase.requestedStatus || "member"} status in ${institution.name}.`,
          time: originalDate,
        }],
        status: "open",
        source: "institution-lifecycle",
        title: `${institution.name} invitation`,
        lifecycleInstitutionId: institution.id,
        lifecycleCaseIds: [lifecycleCase.id],
      };
    }
  }

  if (!channel) throw new Error("No visible institution lifecycle negotiation can be opened for these cases.");
  return {
    world,
    chats: [channel, ...list(chats).filter((chat) => clean(chat?.id) !== clean(channel.id))],
    institution,
    cases,
    channel,
    reopened: false,
  };
};

const lifecycleAuthority = ({ actor = "", player = "", authority = "" } = {}) => {
  const auth = lower(authority);
  const isPlayer = Boolean(player) && samePolity(actor, player);
  if (isPlayer && !["player", "admin"].includes(auth || "player")) return { allowed: false, reason: "AI/native authority cannot manufacture a sovereign player institution decision." };
  if (!isPlayer && auth === "player") return { allowed: false, reason: "Player authority cannot act for another sovereign government." };
  return { allowed: true, authority: auth || (isPlayer ? "player" : "npc") };
};

export const buildInstitutionLifecycleDecisionContext = (world = {}, {
  institutionId = "", caseIds = [], actorPolities = [], playerCountry = "",
} = {}) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) return { text: "", institution: null, cases: [] };
  const wanted = new Set(list(caseIds).map(clean).filter(Boolean));
  const cases = Object.values(institution.lifecycleCases || {})
    .filter((entry) => !wanted.size || wanted.has(clean(entry?.id)))
    .filter(caseNeedsDiplomaticResponse);
  if (!cases.length) return { text: "", institution, cases: [] };
  const actors = unique(actorPolities.map((name) => canonicalPolity(name, world))).filter(Boolean);
  const members = list(institution.members).filter((member) => lower(member.status) !== "suspended");
  const memberNames = members.map((member) => member.polity);
  const lifecycle = institution.charter?.lifecycle || {};
  const relations = list(world?.relations);
  const relationLines = [];
  for (const actor of actors) {
    const rows = [];
    for (const member of memberNames) {
      if (samePolity(actor, member)) continue;
      const relation = relations.find((entry) => (
        (samePolity(entry?.a, actor) && samePolity(entry?.b, member))
        || (samePolity(entry?.b, actor) && samePolity(entry?.a, member))
      ));
      if (!relation) continue;
      const score = Number(relation.score);
      rows.push(`${member}: ${clean(relation.status) || "tracked"}${Number.isFinite(score) ? ` ${score >= 0 ? "+" : ""}${score}` : ""}${clean(relation.summary) ? ` (${clean(relation.summary).slice(0, 160)})` : ""}`);
    }
    if (rows.length) relationLines.push(`- ${actor}: ${rows.slice(0, 8).join("; ")}`);
  }
  const caseLines = cases.map((entry) => `- case ${entry.id}: ${entry.polity} | ${entry.kind} | requested=${entry.requestedStatus || "member"} | status=${entry.status}${entry.terms ? ` | terms=${entry.terms}` : ""}`);
  const scope = lifecycle.identity || {};
  const threatModels = list(scope.primaryThreatModel);
  const actorThreatNotes = actors.filter((actor) => threatModels.some((threat) => lower(threat) === lower(actor)))
    .map((actor) => `${actor} is explicitly named in the institution's primary threat model.`);
  const text = [
    "[INSTITUTION ACCESSION / MEMBERSHIP DECISION - CANONICAL CONTEXT]",
    `Institution: ${institution.name} [${institution.id}] | ${institution.kind} | ${institution.status}.`,
    lifecycle.purpose?.length ? `Purpose: ${lifecycle.purpose.join("; ")}` : "Purpose: no structured purpose is recorded; do not invent one beyond the charter/context.",
    scope.politicalCharacter ? `Political character: ${scope.politicalCharacter}` : "",
    scope.geographicScope?.length ? `Geographic scope: ${scope.geographicScope.join(", ")}` : "",
    threatModels.length ? `Primary threat/adversary model: ${threatModels.join(", ")}` : "",
    clean(institution.charter?.note) ? `Charter / obligations: ${clean(institution.charter.note).slice(0, 1200)}` : "",
    `Current members/participants: ${members.length ? members.map((member) => `${member.polity} (${member.status}${member.role && member.role !== "member" ? `, ${member.role}` : ""})`).join(", ") : "none"}.`,
    `Accession rule: ${lifecycle.accession?.mode || "approval"}; allowed statuses: ${list(lifecycle.accession?.allowedStatuses).join(", ") || "member"}.`,
    ...actorThreatNotes.map((note) => `Compatibility warning: ${note}`),
    "Open lifecycle cases:",
    ...caseLines,
    relationLines.length ? "Canonical bilateral climate with current members:" : "",
    ...relationLines,
    "Decision discipline:",
    "- Evaluate the institution itself, not merely bilateral friendship with the player. Positive relations alone never imply that full membership makes political or strategic sense.",
    "- Consider the actor's PWv2 government, ideology, goals, fears, domestic pressure, leader disposition and current perceptions supplied elsewhere in this same request.",
    "- Consider geographic/political scope, obligations, current members, rivalries and the institution's stated threat model. A regional identity can make observer/partnership status more plausible than full accession.",
    "- If the actor itself is explicitly the institution's stated adversary/threat, full accession is ordinarily incompatible unless current canonical context clearly describes a transformation or negotiated change; do not accept just because an invitation exists.",
    "- Put membership decisions in the top-level lifecycleResponsesJson field as JSON array text. Each object must use the exact acting government and exact case id: {actorName, caseId, decision, reason?, terms?}. Valid decisions: accept, reject, seek-observer, request-terms, delay. Use [] if nobody decides now. Never act for the human player.",
    playerCountry ? `Human-controlled polity: ${playerCountry}.` : "",
  ].filter(Boolean).join("\n");
  return { text: text.slice(0, 7000), institution, cases };
};


export const institutionLifecycleConversationState = (world = {}, { institutionId = "", caseIds = [] } = {}) => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) return { institution: null, cases: [], responseCases: [], awaitingApprovalCases: [], resolvedCases: [], responseComplete: false };
  const wanted = new Set(list(caseIds).map(clean).filter(Boolean));
  const cases = Object.values(institution.lifecycleCases || {}).filter((entry) => !wanted.size || wanted.has(clean(entry?.id)));
  const responseCases = cases.filter(caseNeedsDiplomaticResponse);
  const awaitingApprovalCases = cases.filter((entry) => lower(entry?.status) === "pending-approval");
  const resolvedCases = cases.filter((entry) => !caseIsOpen(entry));
  return {
    institution,
    cases,
    responseCases,
    awaitingApprovalCases,
    resolvedCases,
    responseComplete: cases.length > 0 && responseCases.length === 0,
  };
};

export const institutionLifecycleCasesForPolity = (world = {}, polityInput = "", { pendingOnly = true } = {}) => {
  const polity = canonicalPolity(polityInput, world);
  if (!polity) return [];
  const institutions = normalizeInstitutions(world.institutions, world);
  const rows = [];
  for (const institution of Object.values(institutions.byId)) {
    for (const entry of Object.values(institution.lifecycleCases || {})) {
      if (!samePolity(entry.polity, polity) && !samePolity(entry.initiatedBy, polity)) continue;
      if (pendingOnly && !caseIsOpen(entry)) continue;
      rows.push({ institution, case: entry });
    }
  }
  return rows.sort((a, b) => clean(b.case.updatedDate || b.case.createdDate).localeCompare(clean(a.case.updatedDate || a.case.createdDate)));
};

export const institutionPortfolioForPolity = (world = {}, polityInput = "", { viewerPolity = "", includePrivate = false } = {}) => {
  const polity = canonicalPolity(polityInput, world);
  const viewer = canonicalPolity(viewerPolity, world);
  if (!polity) return [];
  const institutions = normalizeInstitutions(world.institutions, world);
  const rows = [];
  const publicHistoryActions = new Set(["founded", "activated", "joined", "observer", "left", "withdrawn", "expelled", "suspended", "reinstated", "dissolved"]);
  for (const institution of Object.values(institutions.byId)) {
    const member = memberByPolity(institution, polity);
    const viewerMember = viewer ? memberByPolity(institution, viewer) : null;
    const maySeePrivate = includePrivate || !viewer || samePolity(viewer, polity) || Boolean(viewerMember);
    const history = list(institution.membershipHistory)
      .filter((entry) => samePolity(entry.polity, polity))
      .filter((entry) => maySeePrivate || publicHistoryActions.has(lower(entry.action)));
    const cases = maySeePrivate
      ? Object.values(institution.lifecycleCases || {}).filter((entry) => samePolity(entry.polity, polity) || samePolity(entry.initiatedBy, polity))
      : [];
    if (!member && !history.length && !cases.length) continue;
    rows.push({ institution, member, history, cases });
  }
  return rows.sort((a, b) => clean(a.institution.name).localeCompare(clean(b.institution.name)));
};

export const applyInstitutionLifecycleCommandCore = ({
  world: worldInput = {}, chats: chatsInput = [], events: eventsInput = [], playerCountry = "", date = "", command = {},
} = {}) => {
  const type = lower(command.type).replace(/[\s_]+/g, "-");
  const player = canonicalPolity(playerCountry, worldInput);
  let world = clone(worldInput || {});
  let chats = clone(chatsInput || []);
  let events = clone(eventsInput || []);

  if (type === "found") {
    const name = clean(command.name);
    const id = canonicalInstitutionIdentity({ id: command.id, name, shortName: command.shortName }).id;
    const founder = canonicalPolity(command.founder || command.initiatedBy || player, world);
    if (!founder) throw new Error("Founding an institution requires a canonical founding polity.");
    const authority = lifecycleAuthority({ actor: founder, player, authority: command.authority });
    if (!authority.allowed) throw new Error(authority.reason);
    if (!name || !id) throw new Error("Institution name is required.");
    const institutions = normalizeInstitutions(world.institutions, world);
    if (institutions.byId[id]) throw new Error(`Institution ${name} already exists.`);
    const invitees = unique(list(command.invitees).map((entry) => canonicalPolity(entry, world)).filter((entry) => entry && !samePolity(entry, founder)), 24);
    const minimumFoundingMembers = Math.max(1, Math.min(64, Number(command.minimumFoundingMembers) || (invitees.length ? 2 : 1)));
    const votingType = clean(command.votingRule || command.decisionRule || "simple-majority").toLowerCase().replace(/[\s_]+/g, "-");
    const institution = normalizeInstitutionRecord({
      id,
      name,
      shortName: clean(command.shortName),
      kind: INSTITUTION_KINDS.includes(command.kind) ? command.kind : "other",
      status: minimumFoundingMembers > 1 ? "provisional" : "active",
      foundedDate: clean(date),
      badgeKey: clean(command.badgeKey || command.shortName),
      logoUrl: clean(command.logoUrl),
      members: [{ polity: founder, status: "member", role: "leader", sinceDate: clean(date), lastUpdatedDate: clean(date) }],
      leaders: [founder],
      charter: {
        votingRule: { type: votingType, eligibleStatuses: ["member"], quorum: votingType === "unanimity" ? 1 : 0.5 },
        lifecycle: {
          minimumFoundingMembers,
          purpose: unique(command.purpose || [], 16),
          identity: {
            geographicScope: unique(command.geographicScope || [], 24),
            politicalCharacter: clean(command.politicalCharacter),
            primaryThreatModel: unique(command.primaryThreatModel || [], 24),
          },
          accession: {
            mode: ["approval", "direct"].includes(lower(command.accessionMode)) ? lower(command.accessionMode) : "approval",
            allowedStatuses: command.allowObserver === false ? ["member"] : ["member", "observer"],
          },
          withdrawal: {
            mode: ["unilateral", "notice", "approval", "not-permitted"].includes(lower(command.withdrawalMode)) ? lower(command.withdrawalMode) : "unilateral",
            noticeDays: Math.max(0, Math.min(3650, Number(command.withdrawalNoticeDays) || 0)),
          },
          expulsion: {
            mode: ["approval", "not-permitted"].includes(lower(command.expulsionMode)) ? lower(command.expulsionMode) : "approval",
          },
          dissolution: {
            mode: ["approval", "not-permitted"].includes(lower(command.dissolutionMode)) ? lower(command.dissolutionMode) : "approval",
          },
          approvalRule: { type: votingType, eligibleStatuses: ["member"], quorum: votingType === "unanimity" ? 1 : 0.5 },
        },
        note: clean(command.charterNote),
      },
      lifecycleCases: {},
      membershipHistory: [{ action: "founded", polity: founder, actor: founder, date: clean(date), status: "member", role: "leader", reason: clean(command.purposeText || list(command.purpose).join("; ")) }],
      note: clean(command.note),
      lastUpdatedDate: clean(date),
    }, id, { ...world, institutions });
    const caseIds = [];
    for (const invitee of invitees) {
      const caseId = lifecycleCaseId(id, "founding-invitation", invitee, date);
      const lifecycleCase = setCase(institution, {
        id: caseId,
        kind: "founding-invitation",
        status: "pending",
        polity: invitee,
        initiatedBy: founder,
        requestedStatus: "member",
        createdDate: date,
        updatedDate: date,
      }, world);
      if (lifecycleCase) {
        caseIds.push(lifecycleCase.id);
        upsertHistory(institution, { action: "invited", polity: invitee, actor: founder, date: clean(date), sourceCaseId: lifecycleCase.id, reason: `Founding invitation to ${institution.name}` });
      }
    }
    institutions.byId[id] = normalizeInstitutionRecord(institution, id, { ...world, institutions });
    world = { ...world, institutions };
    const chat = foundingChat({ institution: institutions.byId[id], invitees, founder, playerCountry: player, caseIds, date });
    if (chat) chats = [chat, ...chats];
    events = dedupeEvents(events, [lifecycleEvent({ institution: institutions.byId[id], action: "founded", polity: founder, actor: founder, date, reason: list(command.purpose).join("; "), playerCountry: player })]);
    return { world, chats, events, institution: institutions.byId[id], createdChat: chat, caseIds, action: "founded" };
  }

  const institutionId = clean(command.institutionId);
  if (!institutionId) throw new Error("Institution lifecycle command requires institutionId.");
  const baseInstitution = resolveInstitutionRecord(world, institutionId);
  if (!baseInstitution) throw new Error(`Unknown institution ${institutionId}.`);

  if (type === "apply") {
    const applicant = canonicalPolity(command.polity || player, world);
    if (!applicant) throw new Error("Membership application requires a polity.");
    if (player && command.polity && !samePolity(applicant, player) && !clean(command.authority)) {
      throw new Error("The player cannot submit an accession application for another sovereign government.");
    }
    const authority = lifecycleAuthority({ actor: applicant, player, authority: command.authority });
    if (!authority.allowed) throw new Error(authority.reason);
    if (memberByPolity(baseInstitution, applicant)) throw new Error(`${applicant} is already represented in ${baseInstitution.name}.`);
    const requestedStatus = ["member", "observer", "associate", "participant"].includes(lower(command.requestedStatus)) ? lower(command.requestedStatus) : "member";
    const accessionMode = lower(baseInstitution.charter?.lifecycle?.accession?.mode || "approval");
    if (accessionMode === "not-permitted") throw new Error(`${baseInstitution.name} charter does not permit accession applications.`);
    const allowed = new Set(list(baseInstitution.charter?.lifecycle?.accession?.allowedStatuses));
    if (allowed.size && !allowed.has(requestedStatus)) throw new Error(`${baseInstitution.name} does not accept ${requestedStatus} applications under its current charter.`);
    const caseId = lifecycleCaseId(baseInstitution.id, "application", applicant, date);
    const result = mutateInstitution(world, baseInstitution.id, (institution, localWorld) => {
      const existing = Object.values(caseMap(institution)).find((entry) => samePolity(entry.polity, applicant) && caseIsOpen(entry));
      if (existing) return { error: `${applicant} already has an open lifecycle case in ${institution.name}.` };
      let lifecycleCase = setCase(institution, {
        id: caseId, kind: "application", status: accessionMode === "direct" ? "accepted" : "pending-approval", polity: applicant, initiatedBy: applicant,
        requestedStatus, createdDate: date, updatedDate: date, resolvedDate: accessionMode === "direct" ? clean(date) : "", reason: clean(command.reason), terms: clean(command.terms),
      }, localWorld);
      upsertHistory(institution, { action: "applied", polity: applicant, actor: applicant, date: clean(date), status: requestedStatus, sourceCaseId: lifecycleCase.id, reason: clean(command.reason) });
      if (accessionMode === "direct") {
        const membership = applyInstitutionMembershipResolution({
          world: { ...localWorld, institutions: { ...normalizeInstitutions(localWorld.institutions, localWorld), byId: { ...normalizeInstitutions(localWorld.institutions, localWorld).byId, [institution.id]: institution } } },
          institutionId: institution.id, op: "join", polity: applicant, status: requestedStatus, role: "member",
          date, note: clean(command.reason) || "Direct accession under charter",
        });
        if (membership.error) return { error: membership.error };
        Object.assign(institution, clone(resolveInstitutionRecord(membership.world, institution.id)));
        lifecycleCase = { ...lifecycleCase, status: "accepted", decision: "accept", resolvedDate: clean(date), updatedDate: clean(date) };
        setCase(institution, lifecycleCase, membership.world);
        return { lifecycleCase, directMembership: true };
      }
      const proposal = createLifecycleProposal(institution, lifecycleCase, localWorld, date, {
        op: "join", status: requestedStatus,
        title: `${applicant} application for ${requestedStatus} status`,
        summary: clean(command.reason) || `${applicant} requests ${requestedStatus} status in ${institution.name}.`,
      });
      lifecycleCase.proposalId = proposal.id;
      setCase(institution, lifecycleCase, localWorld);
      upsertHistory(institution, { action: "applied", polity: applicant, actor: applicant, date: clean(date), status: requestedStatus, sourceCaseId: lifecycleCase.id, sourceProposalId: proposal.id, reason: clean(command.reason) });
      return { lifecycleCase, proposal };
    });
    if (result.error) throw new Error(result.error);
    world = result.world;
    const hearing = result.proposal ? accessionHearingChat({
      institution: result.institution, lifecycleCase: result.lifecycleCase, applicant,
      playerCountry: player, date, existingChats: chats,
    }) : null;
    if (hearing) {
      chats = [hearing, ...chats.filter((chat) => clean(chat?.id) !== clean(hearing.id))];
    }
    if (result.directMembership) {
      events = dedupeEvents(events, [lifecycleEvent({ institution: result.institution, action: requestedStatus === "observer" ? "observer" : "joined", polity: applicant, actor: applicant, date, reason: clean(command.reason), playerCountry: player })]);
    }
    return { world, chats, events, institution: result.institution, lifecycleCase: result.lifecycleCase, proposal: result.proposal, createdChat: hearing, action: result.directMembership ? (requestedStatus === "observer" ? "observer" : "joined") : "applied" };
  }

  if (type === "invite") {
    const inviter = canonicalPolity(command.initiatedBy || command.actorPolity || player, world);
    const target = canonicalPolity(command.polity || command.targetPolity, world);
    if (!inviter || !target) throw new Error("Institution invitation requires inviter and target polity.");
    const authority = lifecycleAuthority({ actor: inviter, player, authority: command.authority });
    if (!authority.allowed) throw new Error(authority.reason);
    const inviterMember = memberByPolity(baseInstitution, inviter);
    if (!inviterMember || lower(inviterMember.status) === "suspended") throw new Error(`${inviter} is not an active participant in ${baseInstitution.name}.`);
    if (lower(baseInstitution.charter?.lifecycle?.accession?.mode) === "not-permitted") throw new Error(`${baseInstitution.name} charter does not permit accession invitations.`);
    if (memberByPolity(baseInstitution, target)) throw new Error(`${target} is already represented in ${baseInstitution.name}.`);
    const caseId = lifecycleCaseId(baseInstitution.id, "invitation", target, date);
    const result = mutateInstitution(world, baseInstitution.id, (institution, localWorld) => {
      const lifecycleCase = setCase(institution, {
        id: caseId, kind: "invitation", status: "pending", polity: target, initiatedBy: inviter,
        requestedStatus: lower(command.requestedStatus) || "member", createdDate: date, updatedDate: date,
        reason: clean(command.reason), terms: clean(command.terms),
      }, localWorld);
      upsertHistory(institution, { action: "invited", polity: target, actor: inviter, date: clean(date), status: lifecycleCase.requestedStatus, sourceCaseId: lifecycleCase.id, reason: clean(command.reason) });
      return { lifecycleCase };
    });
    if (result.error) throw new Error(result.error);
    world = result.world;
    const playerInvolved = player && (samePolity(inviter, player) || samePolity(target, player));
    const chat = playerInvolved ? {
      id: `institution-invite-${baseInstitution.id}-${slug(target)}-${slug(date || "now")}`,
      countries: [{ name: samePolity(inviter, player) ? target : inviter, code: "" }],
      messages: [{
        role: samePolity(inviter, player) ? "user" : "leader",
        speaker: inviter,
        text: `${inviter} invites ${target} to seek ${result.lifecycleCase.requestedStatus} status in ${baseInstitution.name}.`,
        time: clean(date),
      }],
      status: "open", source: "institution-lifecycle", title: `${baseInstitution.name} invitation`,
      lifecycleInstitutionId: baseInstitution.id, lifecycleCaseIds: [result.lifecycleCase.id],
    } : null;
    if (chat) chats = [chat, ...chats];
    return { world, chats, events, institution: result.institution, lifecycleCase: result.lifecycleCase, createdChat: chat, action: "invited" };
  }

  if (type === "respond") {
    const actor = canonicalPolity(command.actorPolity, world);
    const caseId = clean(command.caseId);
    const decision = lower(command.decision).replace(/[\s_]+/g, "-");
    if (!actor || !caseId) throw new Error("Lifecycle response requires actorPolity and caseId.");
    const authority = lifecycleAuthority({ actor, player, authority: command.authority });
    if (!authority.allowed) throw new Error(authority.reason);
    if (!["accept", "reject", "seek-observer", "request-terms", "delay"].includes(decision)) throw new Error(`Unsupported lifecycle decision ${decision || "<blank>"}.`);
    const result = mutateInstitution(world, baseInstitution.id, (institution, localWorld) => {
      const current = caseMap(institution)[caseId];
      if (!current || !caseIsOpen(current)) return { error: `Lifecycle case ${caseId} is not open.` };
      if (!samePolity(current.polity, actor)) return { error: `${actor} is not the subject of lifecycle case ${caseId}.` };
      let lifecycleCase = { ...current, decision, updatedDate: clean(date), reason: clean(command.reason) || current.reason || "", terms: clean(command.terms) || current.terms || "" };
      if (decision === "reject") {
        lifecycleCase = { ...lifecycleCase, status: "rejected", resolvedDate: clean(date) };
        setCase(institution, lifecycleCase, localWorld);
        upsertHistory(institution, { action: "rejected", polity: actor, actor, date: clean(date), status: current.requestedStatus, sourceCaseId: current.id, reason: lifecycleCase.reason });
        return { lifecycleCase, resolutionAction: "rejected" };
      }
      if (["request-terms", "delay"].includes(decision)) {
        lifecycleCase = { ...lifecycleCase, status: "negotiating" };
        setCase(institution, lifecycleCase, localWorld);
        return { lifecycleCase, resolutionAction: decision };
      }
      const requestedStatus = decision === "seek-observer" ? "observer" : (current.requestedStatus || "member");
      const provisional = lower(institution.status) === "provisional" && current.kind === "founding-invitation";
      const accessionMode = lower(institution.charter?.lifecycle?.accession?.mode || "approval");
      if (!provisional && accessionMode === "not-permitted") return { error: `${institution.name} charter does not permit accession.` };
      const allowed = new Set(list(institution.charter?.lifecycle?.accession?.allowedStatuses));
      if (allowed.size && !allowed.has(requestedStatus)) return { error: `${institution.name} charter does not permit ${requestedStatus} accession.` };
      const direct = provisional || accessionMode === "direct";
      if (direct) {
        const membership = applyInstitutionMembershipResolution({
          world: { ...localWorld, institutions: { ...normalizeInstitutions(localWorld.institutions, localWorld), byId: { ...normalizeInstitutions(localWorld.institutions, localWorld).byId, [institution.id]: institution } } },
          institutionId: institution.id, op: "join", polity: actor, status: requestedStatus, role: current.kind === "founding-invitation" ? "leading-member" : "member",
          date, note: lifecycleCase.reason || `Accepted ${current.kind}`,
        });
        if (membership.error) return { error: membership.error };
        const joined = resolveInstitutionRecord(membership.world, institution.id);
        Object.assign(institution, clone(joined));
        lifecycleCase = { ...lifecycleCase, requestedStatus, status: "accepted", resolvedDate: clean(date) };
        setCase(institution, lifecycleCase, membership.world);
        // applyInstitutionMembershipResolution owns the founding-threshold
        // transition so direct founding joins and later approved accessions share
        // one canonical activation rule. Keep this assertion local to catch any
        // future regression in that ownership boundary.
        if (lower(institution.status) === "provisional" && institutionFoundingThresholdReached(institution)) {
          return { error: `${institution.name} reached its founding threshold but remained provisional.` };
        }
        return { lifecycleCase, resolutionAction: requestedStatus === "observer" ? "observer" : "joined", directMembership: true };
      }
      lifecycleCase = { ...lifecycleCase, requestedStatus, status: "pending-approval" };
      const proposal = createLifecycleProposal(institution, lifecycleCase, localWorld, date, {
        op: "join", status: requestedStatus,
        title: `${actor} accession to ${institution.name}`,
        summary: lifecycleCase.reason || `${actor} accepts the invitation and seeks ${requestedStatus} status in ${institution.name}.`,
      });
      lifecycleCase.proposalId = proposal.id;
      setCase(institution, lifecycleCase, localWorld);
      return { lifecycleCase, proposal, resolutionAction: "pending-approval" };
    });
    if (result.error) throw new Error(result.error);
    world = result.world;
    const action = result.resolutionAction || decision;
    if (["joined", "observer", "rejected"].includes(action)) {
      events = dedupeEvents(events, [lifecycleEvent({ institution: result.institution, action: action === "observer" ? "observer" : action, polity: actor, actor, date, reason: result.lifecycleCase?.reason, playerCountry: player })]);
    }
    const hearing = result.proposal ? accessionHearingChat({
      institution: result.institution, lifecycleCase: result.lifecycleCase, applicant: actor,
      playerCountry: player, date, existingChats: chats,
    }) : null;
    if (hearing) chats = [hearing, ...chats.filter((chat) => clean(chat?.id) !== clean(hearing.id))];
    return { world, chats, events, institution: result.institution, lifecycleCase: result.lifecycleCase, proposal: result.proposal, createdChat: hearing, action };
  }

  if (type === "withdraw") {
    const polity = canonicalPolity(command.polity || player, world);
    const member = memberByPolity(baseInstitution, polity);
    if (!member) throw new Error(`${polity} is not a member of ${baseInstitution.name}.`);
    const authority = lifecycleAuthority({ actor: polity, player, authority: command.authority });
    if (!authority.allowed) throw new Error(authority.reason);
    const mode = lower(baseInstitution.charter?.lifecycle?.withdrawal?.mode || "unilateral");
    if (mode === "not-permitted") throw new Error(`${baseInstitution.name} charter does not permit unilateral withdrawal.`);
    if (mode === "approval") {
      const caseId = lifecycleCaseId(baseInstitution.id, "withdrawal", polity, date);
      const result = mutateInstitution(world, baseInstitution.id, (institution, localWorld) => {
        const lifecycleCase = setCase(institution, { id: caseId, kind: "withdrawal", status: "pending-approval", polity, initiatedBy: polity, requestedStatus: member.status, createdDate: date, updatedDate: date, reason: clean(command.reason) }, localWorld);
        const proposal = createLifecycleProposal(institution, lifecycleCase, localWorld, date, { op: "leave", status: member.status, title: `${polity} withdrawal from ${institution.name}`, summary: clean(command.reason) || `${polity} requests withdrawal from ${institution.name}.` });
        lifecycleCase.proposalId = proposal.id; setCase(institution, lifecycleCase, localWorld);
        return { lifecycleCase, proposal };
      });
      if (result.error) throw new Error(result.error);
      return { world: result.world, chats, events, institution: result.institution, lifecycleCase: result.lifecycleCase, proposal: result.proposal, action: "withdrawal-pending" };
    }
    const noticeDays = mode === "notice" ? Number(baseInstitution.charter?.lifecycle?.withdrawal?.noticeDays || 0) : 0;
    if (noticeDays > 0) {
      const effective = new Date(`${clean(date)}T00:00:00Z`);
      if (!Number.isNaN(effective.getTime())) effective.setUTCDate(effective.getUTCDate() + noticeDays);
      const effectiveDate = Number.isNaN(effective.getTime()) ? clean(date) : effective.toISOString().slice(0, 10);
      const result = mutateInstitution(world, baseInstitution.id, (institution, localWorld) => {
        const lifecycleCase = setCase(institution, { id: lifecycleCaseId(institution.id, "withdrawal", polity, date), kind: "withdrawal", status: "pending", polity, initiatedBy: polity, requestedStatus: member.status, createdDate: date, updatedDate: date, effectiveDate, reason: clean(command.reason) }, localWorld);
        return { lifecycleCase };
      });
      if (result.error) throw new Error(result.error);
      return { world: result.world, chats, events, institution: result.institution, lifecycleCase: result.lifecycleCase, action: "withdrawal-notice" };
    }
    const membership = applyInstitutionMembershipResolution({ world, institutionId: baseInstitution.id, op: "leave", polity, date, note: clean(command.reason) || "Voluntary withdrawal" });
    if (membership.error) throw new Error(membership.error);
    world = membership.world;
    events = dedupeEvents(events, [lifecycleEvent({ institution: membership.institution, action: "left", polity, actor: polity, date, reason: clean(command.reason), playerCountry: player })]);
    return { world, chats, events, institution: membership.institution, action: "withdrawn" };
  }

  if (["expel", "suspend", "reinstate", "dissolve"].includes(type)) {
    if (type === "expel" && lower(baseInstitution.charter?.lifecycle?.expulsion?.mode) === "not-permitted") {
      throw new Error(`${baseInstitution.name} charter does not permit expulsion.`);
    }
    if (type === "dissolve" && lower(baseInstitution.charter?.lifecycle?.dissolution?.mode) === "not-permitted") {
      throw new Error(`${baseInstitution.name} charter does not permit dissolution.`);
    }
    const target = type === "dissolve" ? "" : canonicalPolity(command.polity || command.targetPolity, world);
    if (type !== "dissolve" && !memberByPolity(baseInstitution, target)) throw new Error(`${target} is not represented in ${baseInstitution.name}.`);
    const initiator = canonicalPolity(command.initiatedBy || command.actorPolity || player, world);
    const initiatorMember = memberByPolity(baseInstitution, initiator);
    if (!initiatorMember || lower(initiatorMember.status) === "suspended") throw new Error(`${initiator} is not an active participant in ${baseInstitution.name}.`);
    const authority = lifecycleAuthority({ actor: initiator, player, authority: command.authority });
    if (!authority.allowed) throw new Error(authority.reason);
    const kind = type === "expel" ? "expulsion" : type === "suspend" ? "suspension" : type === "reinstate" ? "reinstate" : "dissolution";
    const caseId = lifecycleCaseId(baseInstitution.id, kind, target || baseInstitution.id, date);
    const result = mutateInstitution(world, baseInstitution.id, (institution, localWorld) => {
      const lifecycleCase = setCase(institution, { id: caseId, kind, status: "pending-approval", polity: target, initiatedBy: initiator, requestedStatus: memberByPolity(institution, target)?.status || "member", createdDate: date, updatedDate: date, reason: clean(command.reason) }, localWorld);
      const op = type === "expel" ? "leave" : type === "suspend" ? "suspend" : type === "reinstate" ? "restore" : "dissolve";
      const proposal = createLifecycleProposal(institution, lifecycleCase, localWorld, date, {
        op,
        status: memberByPolity(institution, target)?.status || "member",
        title: type === "dissolve" ? `Dissolve ${institution.name}` : `${type === "expel" ? "Expel" : type === "suspend" ? "Suspend" : "Reinstate"} ${target}`,
        summary: clean(command.reason) || (type === "dissolve" ? `Proposal to dissolve ${institution.name}.` : `Proposal to ${type} ${target} in ${institution.name}.`),
      });
      lifecycleCase.proposalId = proposal.id; setCase(institution, lifecycleCase, localWorld);
      return { lifecycleCase, proposal };
    });
    if (result.error) throw new Error(result.error);
    return { world: result.world, chats, events, institution: result.institution, lifecycleCase: result.lifecycleCase, proposal: result.proposal, action: `${kind}-pending` };
  }

  throw new Error(`Unsupported institution lifecycle command ${command.type || "<blank>"}.`);
};

export const INSTITUTION_LIFECYCLE_IMPACT_OPS = Object.freeze([
  "found",
  "invite",
  "apply",
  "respond",
  "withdraw",
  "expel",
  "suspend",
  "reinstate",
  "dissolve",
]);

export const normalizeInstitutionLifecycleImpactOp = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const op = lower(entry.op || entry.type).replace(/[\s_]+/g, "-");
  if (!INSTITUTION_LIFECYCLE_IMPACT_OPS.includes(op)) return null;
  const actorPolity = clean(entry.actorPolity || entry.actor || entry.initiatedBy || entry.founder || entry.polity);
  const institutionId = clean(entry.institutionId || entry.institution);
  const targetPolity = clean(entry.targetPolity || entry.target || (op === "invite" || ["expel", "suspend", "reinstate"].includes(op) ? entry.polity : ""));
  const requestedStatus = lower(entry.requestedStatus || entry.status);
  const decision = lower(entry.decision).replace(/[\s_]+/g, "-");
  const out = {
    op,
    ...(actorPolity ? { actorPolity } : {}),
    ...(institutionId ? { institutionId } : {}),
    ...(targetPolity ? { targetPolity } : {}),
    ...(clean(entry.caseId) ? { caseId: clean(entry.caseId) } : {}),
    ...(requestedStatus ? { requestedStatus } : {}),
    ...(decision ? { decision } : {}),
    ...(clean(entry.reason) ? { reason: clean(entry.reason) } : {}),
    ...(clean(entry.terms) ? { terms: clean(entry.terms) } : {}),
  };
  if (op === "found") {
    const name = clean(entry.name);
    if (!name || !actorPolity) return null;
    Object.assign(out, {
      name,
      ...(clean(entry.shortName) ? { shortName: clean(entry.shortName) } : {}),
      kind: INSTITUTION_KINDS.includes(clean(entry.kind)) ? clean(entry.kind) : "other",
      purpose: unique(entry.purpose, 16),
      geographicScope: unique(entry.geographicScope, 24),
      primaryThreatModel: unique(entry.primaryThreatModel, 24),
      politicalCharacter: clean(entry.politicalCharacter),
      votingRule: clean(entry.votingRule || entry.decisionRule || "simple-majority"),
      minimumFoundingMembers: Math.max(1, Math.min(64, Number(entry.minimumFoundingMembers) || 1)),
      accessionMode: ["approval", "direct"].includes(lower(entry.accessionMode)) ? lower(entry.accessionMode) : "approval",
      allowObserver: entry.allowObserver !== false,
      withdrawalMode: ["unilateral", "notice", "approval", "not-permitted"].includes(lower(entry.withdrawalMode)) ? lower(entry.withdrawalMode) : "unilateral",
      withdrawalNoticeDays: Math.max(0, Math.min(3650, Number(entry.withdrawalNoticeDays) || 0)),
      expulsionMode: ["approval", "not-permitted"].includes(lower(entry.expulsionMode)) ? lower(entry.expulsionMode) : "approval",
      dissolutionMode: ["approval", "not-permitted"].includes(lower(entry.dissolutionMode)) ? lower(entry.dissolutionMode) : "approval",
      invitees: unique(entry.invitees, 24),
      charterNote: clean(entry.charterNote),
    });
  }
  if (op !== "found" && !institutionId) return null;
  if (["invite", "expel", "suspend", "reinstate"].includes(op) && !targetPolity) return null;
  if (["apply", "withdraw"].includes(op) && !actorPolity) return null;
  if (op === "respond" && (!actorPolity || !out.caseId || !decision)) return null;
  if (["invite", "found", "expel", "suspend", "reinstate", "dissolve"].includes(op) && !actorPolity) return null;
  return out;
};

// Event-path lifecycle operations. The simulator may act only for AI polities;
// a foreign institution may INVITE or discipline the player, but it may never
// invent the player's acceptance, application, founding act or withdrawal.
// Every accepted operation still passes through the exact same native lifecycle
// command core used by the UI and diplomacy chat path.
export const applyInstitutionLifecycleImpactBatchCore = ({
  world = {}, chats = [], playerCountry = "", date = "", ops = [], authority = "npc",
} = {}) => {
  let nextWorld = world;
  let nextChats = chats;
  const applied = [];
  const rejected = [];
  const createdChats = [];
  const impactAuthority = ["npc", "admin"].includes(lower(authority)) ? lower(authority) : "npc";
  for (const raw of list(ops)) {
    const op = normalizeInstitutionLifecycleImpactOp(raw);
    if (!op) {
      rejected.push({ op: raw, reason: "not a valid institution lifecycle impact operation" });
      continue;
    }
    try {
      const command = op.op === "found"
        ? {
          type: "found", founder: op.actorPolity, authority: impactAuthority, name: op.name, shortName: op.shortName,
          kind: op.kind, purpose: op.purpose, geographicScope: op.geographicScope,
          primaryThreatModel: op.primaryThreatModel, politicalCharacter: op.politicalCharacter,
          votingRule: op.votingRule, minimumFoundingMembers: op.minimumFoundingMembers,
          accessionMode: op.accessionMode, allowObserver: op.allowObserver,
          withdrawalMode: op.withdrawalMode, withdrawalNoticeDays: op.withdrawalNoticeDays,
          expulsionMode: op.expulsionMode, dissolutionMode: op.dissolutionMode,
          invitees: op.invitees, charterNote: op.charterNote,
        }
        : op.op === "invite"
          ? { type: "invite", institutionId: op.institutionId, initiatedBy: op.actorPolity, polity: op.targetPolity, requestedStatus: op.requestedStatus, reason: op.reason, terms: op.terms, authority: impactAuthority }
          : op.op === "apply"
            ? { type: "apply", institutionId: op.institutionId, polity: op.actorPolity, requestedStatus: op.requestedStatus, reason: op.reason, terms: op.terms, authority: impactAuthority }
            : op.op === "respond"
              ? { type: "respond", institutionId: op.institutionId, actorPolity: op.actorPolity, caseId: op.caseId, decision: op.decision, reason: op.reason, terms: op.terms, authority: impactAuthority }
              : op.op === "withdraw"
                ? { type: "withdraw", institutionId: op.institutionId, polity: op.actorPolity, reason: op.reason, authority: impactAuthority }
                : { type: op.op, institutionId: op.institutionId, initiatedBy: op.actorPolity, polity: op.targetPolity, reason: op.reason, authority: impactAuthority };
      const result = applyInstitutionLifecycleCommandCore({
        world: nextWorld,
        chats: nextChats,
        events: [],
        playerCountry,
        date,
        command,
      });
      nextWorld = result.world;
      nextChats = result.chats;
      if (result.createdChat) createdChats.push(result.createdChat);
      applied.push({ op, action: result.action, lifecycleCase: result.lifecycleCase || null, proposal: result.proposal || null });
    } catch (error) {
      rejected.push({ op, reason: clean(error?.message || error) || "institution lifecycle impact was refused" });
    }
  }
  return { world: nextWorld, chats: nextChats, createdChats, applied, rejected };
};

export const applyInstitutionLifecycleChatBatchCore = ({
  world = {}, chats = [], events = [], playerCountry = "", date = "", institutionId = "", lifecycleActions = [],
} = {}) => {
  let nextWorld = world;
  let nextChats = chats;
  let nextEvents = events;
  const applied = [];
  const rejected = [];
  for (const action of list(lifecycleActions)) {
    try {
      const result = applyInstitutionLifecycleCommandCore({
        world: nextWorld, chats: nextChats, events: nextEvents, playerCountry, date,
        command: { type: "respond", institutionId, caseId: action.caseId, actorPolity: action.actorName, decision: action.decision, reason: action.reason, terms: action.terms, authority: "npc" },
      });
      nextWorld = result.world;
      nextChats = result.chats;
      nextEvents = result.events;
      applied.push({ action, lifecycleCase: result.lifecycleCase, proposal: result.proposal || null, result: result.action });
    } catch (error) {
      rejected.push({ action, reason: clean(error?.message || error) || "institution lifecycle response was refused" });
    }
  }
  return { world: nextWorld, chats: nextChats, events: nextEvents, applied, rejected };
};

export const advanceInstitutionLifecycleCore = ({ world: worldInput = {}, date = "", playerCountry = "" } = {}) => {
  let world = clone(worldInput || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const applied = [];
  for (const institution of Object.values(institutions.byId)) {
    for (const lifecycleCase of institutionPendingLifecycleCases(institution)) {
      if (lifecycleCase.kind !== "withdrawal" || !lifecycleCase.effectiveDate || clean(lifecycleCase.effectiveDate) > clean(date)) continue;
      const result = applyInstitutionMembershipResolution({ world: { ...world, institutions }, institutionId: institution.id, op: "leave", polity: lifecycleCase.polity, date: lifecycleCase.effectiveDate, note: lifecycleCase.reason || "Withdrawal notice became effective." });
      if (result.error) continue;
      world = result.world;
      const refreshed = resolveInstitutionRecord(world, institution.id);
      const cases = { ...(refreshed.lifecycleCases || {}) };
      cases[lifecycleCase.id] = { ...lifecycleCase, status: "resolved", resolvedDate: lifecycleCase.effectiveDate, updatedDate: lifecycleCase.effectiveDate };
      const nextInstitutions = normalizeInstitutions(world.institutions, world);
      nextInstitutions.byId[institution.id] = normalizeInstitutionRecord({ ...refreshed, lifecycleCases: cases }, institution.id, world);
      world = { ...world, institutions: nextInstitutions };
      applied.push({ institutionId: institution.id, caseId: lifecycleCase.id, polity: lifecycleCase.polity, action: "withdrawn" });
    }
  }
  return { world, applied, playerCountry };
};
