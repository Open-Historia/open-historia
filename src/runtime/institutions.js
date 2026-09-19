/*! Open Historia Continuum — canonical institutions / membership ledger */

import { buildPolityIdentityIndex, resolvePolityIdentity } from "./polityIdentity.js";
import { normalizeInstitutionLogoUrl } from "./institutionLogos.js";

export const INSTITUTIONS_SCHEMA_VERSION = 1;
export const INSTITUTION_LEDGER_VERSION = 1;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const slug = (value) => lower(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 72);
const unique = (values, limit = 128) => {
  const out = [];
  const seen = new Set();
  for (const raw of array(values)) {
    const value = clean(raw);
    const key = lower(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

const DATEISH_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const comparableDate = (value, edge = "start") => {
  const text = clean(value);
  const match = text.match(DATEISH_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : (edge === "end" ? 12 : 1);
  if (!Number.isInteger(year) || year < 1 || month < 1 || month > 12) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const day = match[3] ? Number(match[3]) : (edge === "end" ? monthDays[month - 1] : 1);
  if (day < 1 || day > monthDays[month - 1]) return null;
  return year * 10000 + month * 100 + day;
};

export const institutionIdentityTokens = (value = {}) => [
  value?.id,
  value?.name,
  value?.shortName,
  ...(Array.isArray(value?.aliases) ? value.aliases : []),
].map(slug).filter(Boolean);

export const findInstitutionIdentityMatch = (institution = {}, candidates = []) => {
  const wanted = new Set(institutionIdentityTokens(institution));
  if (!wanted.size) return null;
  for (const candidate of array(candidates)) {
    if (!candidate || typeof candidate !== "object") continue;
    if (institutionIdentityTokens(candidate).some((token) => wanted.has(token))) return candidate;
  }
  return null;
};

const normalizeInstitutionPredecessor = (value = {}, fallbackId = "") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = slug(value.id || value.predecessorId || value.name || value.shortName || fallbackId);
  const name = clean(value.name || value.predecessorName || value.shortName || id);
  if (!id || !name) return null;
  return {
    id,
    name,
    shortName: clean(value.shortName).slice(0, 80),
    aliases: unique(value.aliases, 24),
    foundedDate: clean(value.foundedDate || value.fromDate),
    dissolvedDate: clean(value.dissolvedDate || value.untilDate),
    membershipContinuity: value.membershipContinuity === true,
    note: clean(value.note).slice(0, 600),
  };
};

export const normalizeInstitutionPredecessors = (value = {}) => {
  const raw = Array.isArray(value)
    ? value
    : array(value?.predecessors || value?.lineage || value?.institutionLineage);
  const out = [];
  const seen = new Set();
  for (let index = 0; index < raw.length; index += 1) {
    const predecessor = normalizeInstitutionPredecessor(raw[index], `predecessor-${index + 1}`);
    if (!predecessor || seen.has(predecessor.id)) continue;
    seen.add(predecessor.id);
    out.push(predecessor);
  }
  return out.slice(0, 16);
};

export const canonicalInstitutionIdentity = (institution = {}) => {
  const id = slug(institution?.id || institution?.name || institution?.shortName);
  const name = clean(institution?.name || institution?.title || institution?.shortName || id);
  return {
    id,
    name,
    shortName: clean(institution?.shortName).slice(0, 80),
    aliases: unique(institution?.aliases, 24),
    kind: lower(institution?.kind || institution?.type || "other").replace(/[\s-]+/g, "_"),
    foundedDate: clean(institution?.foundedDate),
    dissolvedDate: clean(institution?.dissolvedDate),
    predecessors: normalizeInstitutionPredecessors(institution),
    // Badge identity is explicit or abbreviation-derived. Core runtime never
    // infers a real-world organization from its storage id.
    badgeKey: slug(institution?.badgeKey || institution?.shortName),
    logoUrl: normalizeInstitutionLogoUrl(institution?.logoUrl || institution?.logo || institution?.emblemUrl || institution?.emblem),
    logoAsset: institution?.logoAsset === true,
    priority: Number.isFinite(Number(institution?.priority)) ? Number(institution.priority) : 0,
  };
};

const membershipContinuityWindows = (institution = {}) => normalizeInstitutionPredecessors(institution)
  .filter((entry) => entry.membershipContinuity === true)
  .map((entry) => ({
    ...entry,
    startKey: comparableDate(entry.foundedDate, "start"),
    endKey: comparableDate(entry.dissolvedDate, "end"),
  }))
  .filter((entry) => entry.startKey)
  .sort((a, b) => a.startKey - b.startKey);

export const validateInstitutionTemporalBaseline = ({
  institution = {},
  scenarioDate = "",
  existingInstitution = null,
  membershipDate = "",
  allowUnknownMembershipDateFallback = false,
} = {}) => {
  // Structured scenario-authored state is canonical for its universe. The core
  // validator does not compare an authored institution against any external
  // historical reference table.
  if (existingInstitution) {
    return {
      valid: true,
      foundedDate: clean(existingInstitution.foundedDate || institution.foundedDate),
      dissolvedDate: clean(existingInstitution.dissolvedDate || institution.dissolvedDate),
      membershipDate: clean(membershipDate),
      reason: "",
    };
  }

  const scenarioKey = comparableDate(scenarioDate, "start");
  const foundedDate = clean(institution.foundedDate);
  const dissolvedDate = clean(institution.dissolvedDate);
  if (!scenarioKey) return { valid: true, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: "" };

  const foundedKey = comparableDate(foundedDate, "start");
  const dissolvedKey = comparableDate(dissolvedDate, "end");
  const memberKey = comparableDate(membershipDate, "start");
  const preserveMembershipWithUnknownDate = (reason) => allowUnknownMembershipDateFallback && clean(membershipDate)
    ? {
      valid: true,
      foundedDate,
      dissolvedDate,
      membershipDate: "",
      warning: `cleared accession date ${membershipDate}; ${reason}`,
      reason: "",
    }
    : null;

  // Generated institutions must describe their own temporal truth. Optional
  // scenario/reference data or the generated catalog may also describe generic
  // predecessor lineage; no named institution is special-cased here.
  if (!foundedKey) {
    return { valid: false, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: "generated institution is missing a usable foundedDate" };
  }
  if (scenarioKey < foundedKey) {
    return { valid: false, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: `institution was not founded until ${foundedDate}` };
  }
  if (dissolvedKey && scenarioKey >= dissolvedKey) {
    return { valid: false, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: `institution was already dissolved by ${dissolvedDate}` };
  }
  if (membershipDate && !memberKey) {
    return preserveMembershipWithUnknownDate("the supplied accession date is not a usable scenario date")
      || { valid: false, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: `membership date ${membershipDate} is not a usable historical date` };
  }
  if (memberKey && memberKey > scenarioKey) {
    return preserveMembershipWithUnknownDate(`the supplied accession date is after scenario date ${scenarioDate}`)
      || { valid: false, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: `membership does not begin until ${membershipDate}` };
  }
  if (memberKey && memberKey < foundedKey) {
    const continuity = membershipContinuityWindows(institution);
    const matchingWindow = continuity.find((entry) => (
      memberKey >= entry.startKey
      && (!entry.endKey || memberKey < entry.endKey)
    ));
    if (matchingWindow) {
      return {
        valid: true,
        foundedDate,
        dissolvedDate,
        membershipDate: clean(membershipDate),
        continuityPredecessorId: matchingWindow.id,
        reason: "",
      };
    }

    // Exact accession dates near the first day of a predecessor-era lineage are
    // often false precision. If the year is right but the exact day predates the
    // earliest declared continuity window, retain membership and clear the date.
    const earliest = continuity[0] || null;
    if (
      earliest
      && clean(membershipDate).slice(0, 4)
      && clean(membershipDate).slice(0, 4) === clean(earliest.foundedDate).slice(0, 4)
    ) {
      return {
        valid: true,
        foundedDate,
        dissolvedDate,
        membershipDate: "",
        continuityPredecessorId: earliest.id,
        warning: `cleared accession date ${membershipDate}; declared predecessor continuity begins ${earliest.foundedDate}`,
        reason: "",
      };
    }

    const continuityReason = continuity.length
      ? "the supplied accession date is outside declared predecessor-continuity windows"
      : `the supplied accession date predates institution founding ${foundedDate} and no membership-continuous predecessor is declared`;
    return preserveMembershipWithUnknownDate(continuityReason) || {
      valid: false,
      foundedDate,
      dissolvedDate,
      membershipDate: clean(membershipDate),
      reason: continuity.length
        ? `membership date ${membershipDate} is outside the institution's declared predecessor-continuity windows`
        : `membership date ${membershipDate} predates institution founding ${foundedDate} and no membership-continuous predecessor is declared`,
    };
  }
  return { valid: true, foundedDate, dissolvedDate, membershipDate: clean(membershipDate), reason: "" };
};

export const INSTITUTION_STATUSES = Object.freeze([
  "provisional",
  "active",
  "dormant",
  "dissolved",
]);
const INSTITUTION_STATUS_SET = new Set(INSTITUTION_STATUSES);

export const INSTITUTION_KINDS = Object.freeze([
  "security_alliance",
  "defense_pact",
  "political_union",
  "economic_union",
  "regional_bloc",
  "international_organization",
  "consultative_group",
  "other",
]);
const INSTITUTION_KIND_SET = new Set(INSTITUTION_KINDS);

export const INSTITUTION_MEMBER_STATUSES = Object.freeze([
  "member",
  "candidate",
  "associate",
  "participant",
  "observer",
  "suspended",
]);
const MEMBER_STATUS_SET = new Set(INSTITUTION_MEMBER_STATUSES);

export const INSTITUTION_MEMBER_ROLES = Object.freeze([
  "leader",
  "leading-member",
  "member",
]);
const MEMBER_ROLE_SET = new Set(INSTITUTION_MEMBER_ROLES);

export const INSTITUTION_LIFECYCLE_CASE_KINDS = Object.freeze([
  "founding-invitation",
  "invitation",
  "application",
  "withdrawal",
  "expulsion",
  "suspension",
  "reinstate",
  "dissolution",
]);
const LIFECYCLE_CASE_KIND_SET = new Set(INSTITUTION_LIFECYCLE_CASE_KINDS);

export const INSTITUTION_LIFECYCLE_CASE_STATUSES = Object.freeze([
  "pending",
  "negotiating",
  "pending-approval",
  "accepted",
  "rejected",
  "withdrawn",
  "resolved",
  "expired",
]);
const LIFECYCLE_CASE_STATUS_SET = new Set(INSTITUTION_LIFECYCLE_CASE_STATUSES);

export const INSTITUTION_LIFECYCLE_DECISIONS = Object.freeze([
  "accept",
  "reject",
  "seek-observer",
  "request-terms",
  "delay",
]);
const LIFECYCLE_DECISION_SET = new Set(INSTITUTION_LIFECYCLE_DECISIONS);

export const INSTITUTION_VOTING_RULE_TYPES = Object.freeze([
  "unspecified",
  "unanimity",
  "consensus",
  "simple-majority",
  "two-thirds",
  "qualified-majority",
  "weighted",
]);
const VOTING_RULE_TYPE_SET = new Set(INSTITUTION_VOTING_RULE_TYPES);

export const INSTITUTION_ABSTENTION_POLICIES = Object.freeze([
  "exclude",
  "count-against",
]);
const ABSTENTION_POLICY_SET = new Set(INSTITUTION_ABSTENTION_POLICIES);

export const INSTITUTION_PROPOSAL_STATUSES = Object.freeze([
  "draft",
  "debate",
  "amendment",
  "formalized",
  "voting",
  "passed",
  "failed",
  "vetoed",
  "withdrawn",
  "implementation",
  "archived",
]);
const PROPOSAL_STATUS_SET = new Set(INSTITUTION_PROPOSAL_STATUSES);


// Institutional proposals carry semantic consequence intents, never arbitrary
// world patches. Only kinds with a native canonical owner may execute; the
// rest remain explicit authorization/implementation intents until an owner
// adapter accepts them.
export const INSTITUTION_CONSEQUENCE_KINDS = Object.freeze([
  "declaration",
  "agreement",
  "institution-membership",
  "institution-charter",
  "institution-status",
  "shared-project",
  "deployment-authorization",
  "sanctions-authorization",
  "funding-authorization",
  "policy-commitment",
  "subordinate-institution",
  "custom",
]);
const INSTITUTION_CONSEQUENCE_KIND_SET = new Set(INSTITUTION_CONSEQUENCE_KINDS);

const CONSEQUENCE_KIND_ALIASES = Object.freeze({
  membership: "institution-membership",
  "institution-membership": "institution-membership",
  charter: "institution-charter",
  "institution-charter": "institution-charter",
  status: "institution-status",
  "institution-status": "institution-status",
  project: "shared-project",
  "institution-project": "shared-project",
  "shared-project": "shared-project",
  deployment: "deployment-authorization",
  deploy: "deployment-authorization",
  unit: "deployment-authorization",
  "military-deployment": "deployment-authorization",
  "deployment-authorization": "deployment-authorization",
  sanction: "sanctions-authorization",
  sanctions: "sanctions-authorization",
  "sanctions-authorization": "sanctions-authorization",
  funding: "funding-authorization",
  fund: "funding-authorization",
  budget: "funding-authorization",
  "funding-authorization": "funding-authorization",
  policy: "policy-commitment",
  commitment: "policy-commitment",
  "policy-commitment": "policy-commitment",
  institution: "subordinate-institution",
  "create-institution": "subordinate-institution",
  "subordinate-institution": "subordinate-institution",
  declaration: "declaration",
  resolution: "declaration",
  position: "declaration",
  agreement: "agreement",
  custom: "custom",
});

const consequenceKind = (value) => {
  const raw = lower(value).replace(/[\s_]+/g, "-");
  const mapped = CONSEQUENCE_KIND_ALIASES[raw] || raw;
  return INSTITUTION_CONSEQUENCE_KIND_SET.has(mapped) ? mapped : "custom";
};

const CONSEQUENCE_PATCH_KEYS = new Set([
  "world", "worldpatch", "worldstate", "events", "eventids", "actions", "actionids", "chats",
  "politychanges", "unitops", "regiontransfers", "markerops", "oncomplete", "authorityref", "agency",
]);

const boundedPlainObject = (value, { maxKeys = 24, maxString = 1200, maxArray = 32 } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, maxKeys)) {
    const key = clean(rawKey).slice(0, 80);
    if (!key || CONSEQUENCE_PATCH_KEYS.has(lower(key).replace(/[^a-z0-9]/g, ""))) continue;
    if (typeof rawValue === "string") out[key] = clean(rawValue).slice(0, maxString);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) out[key] = rawValue;
    else if (typeof rawValue === "boolean" || rawValue == null) out[key] = rawValue;
    else if (Array.isArray(rawValue)) {
      out[key] = rawValue.slice(0, maxArray).map((entry) => {
        if (typeof entry === "string") return clean(entry).slice(0, maxString);
        if (typeof entry === "number" && Number.isFinite(entry)) return entry;
        if (typeof entry === "boolean" || entry == null) return entry;
        return boundedPlainObject(entry, { maxKeys: 12, maxString: 600, maxArray: 12 });
      });
    } else if (typeof rawValue === "object") {
      out[key] = boundedPlainObject(rawValue, { maxKeys: 12, maxString: 600, maxArray: 12 });
    }
  }
  return out;
};

export const normalizeInstitutionProposalConsequence = (value = {}, index = 0, world = {}, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const requestedKind = lower(value.kind || value.type).replace(/[\s_]+/g, "-");
  const kind = consequenceKind(requestedKind);
  const id = slug(value.id || `${kind || "consequence"}-${index + 1}`) || `consequence-${index + 1}`;
  const note = clean(value.note || value.summary || value.description).slice(0, 1200);
  const base = { id, kind, ...(note ? { note } : {}) };

  if (kind === "institution-membership") {
    return {
      ...base,
      institutionId: slug(value.institutionId),
      op: lower(value.op),
      polity: canonicalPolity(value.polity || value.country || value.member, world, identityIndex),
      status: MEMBER_STATUS_SET.has(lower(value.status)) ? lower(value.status) : clean(value.status),
      role: MEMBER_ROLE_SET.has(lower(value.role)) ? lower(value.role) : clean(value.role),
    };
  }
  if (kind === "institution-charter") {
    const patch = value.charterPatch || value.patch || value.payload || {};
    return { ...base, institutionId: slug(value.institutionId), charterPatch: boundedPlainObject(patch, { maxKeys: 12, maxString: 800, maxArray: 24 }) };
  }
  if (kind === "institution-status") {
    const status = lower(value.status);
    return { ...base, institutionId: slug(value.institutionId), status: INSTITUTION_STATUS_SET.has(status) ? status : clean(value.status) };
  }
  if (kind === "agreement") {
    const source = value.payload && typeof value.payload === "object" && !Array.isArray(value.payload) ? { ...value, ...value.payload } : value;
    return {
      ...base,
      payload: {
        id: clean(source.agreementId || source.payload?.id || (value.payload ? "" : source.id)).slice(0, 160),
        op: lower(source.op),
        type: lower(source.type || source.agreementType).replace(/[\s_]+/g, "-").slice(0, 80),
        parties: unique(source.parties, 24).map((polity) => canonicalPolity(polity, world, identityIndex)).filter(Boolean),
        title: clean(source.title || source.name).slice(0, 240),
        terms: clean(source.terms || source.summary || source.description).slice(0, 6000),
      },
    };
  }
  if (kind === "shared-project") {
    const source = value.payload && typeof value.payload === "object" && !Array.isArray(value.payload) ? { ...value, ...value.payload } : value;
    return {
      ...base,
      payload: {
        id: clean(source.projectId || source.payload?.id || (value.payload ? "" : source.id)).slice(0, 160),
        op: lower(source.op || "create"),
        name: clean(source.name || source.title).slice(0, 240),
        kind: lower(source.projectKind || (source.kind === "operation" ? "operation" : "project")).slice(0, 80),
        summary: clean(source.summary || source.description).slice(0, 6000),
        ongoing: source.ongoing === true,
        targetDate: clean(source.targetDate || source.dueDate).slice(0, 40),
        tags: unique(source.tags, 24),
        milestones: array(source.milestones).slice(0, 32).map((entry) => boundedPlainObject(entry, { maxKeys: 12, maxString: 600, maxArray: 12 })),
      },
    };
  }

  // Authorization/intent kinds intentionally carry only bounded semantic data.
  // They are NOT executable patches. Unknown/custom data is retained solely so
  // the implementation ledger can report what still needs a canonical owner.
  const semanticPayload = value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)
    ? value.payload
    : Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "kind", "type", "note", "summary", "description"].includes(key)));
  return {
    ...base,
    ...(kind === "custom" && requestedKind ? { requestedKind: requestedKind.slice(0, 80) } : {}),
    payload: boundedPlainObject(semanticPayload, { maxKeys: 20, maxString: 1200, maxArray: 24 }),
  };
};

const hasExactPolityKey = (world, token) => Boolean(
  Object.prototype.hasOwnProperty.call(world?.polityOverrides || {}, token)
  || Object.prototype.hasOwnProperty.call(world?.politicalActors?.byPolity || {}, token)
  || Object.prototype.hasOwnProperty.call(world?.countryStats || {}, token)
  || Object.prototype.hasOwnProperty.call(world?.powerStatus?.byPolity || {}, token)
);

const canonicalPolity = (value, world, identityIndex = null) => {
  const token = clean(value);
  if (!token) return "";
  if (hasExactPolityKey(world || {}, token)) return token;
  const identity = resolvePolityIdentity(token, world || {}, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
    identityIndex,
  });
  return clean(identity?.resolved || token);
};

const boundedFraction = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
};

const normalizeInstitutionVotingRuleType = (value) => {
  const raw = lower(value || "unspecified").replace(/[\s_]+/g, "-");
  if (VOTING_RULE_TYPE_SET.has(raw)) return raw;
  const aliases = {
    "qmv": "qualified-majority",
    "qualified-majority-vote": "qualified-majority",
    "qualified-majority-voting": "qualified-majority",
    "simple-majority-vote": "simple-majority",
    "simple-majority-voting": "simple-majority",
    "majority": "simple-majority",
    "two-thirds-majority": "two-thirds",
    "two-third-majority": "two-thirds",
    "supermajority-two-thirds": "two-thirds",
    "unanimous": "unanimity",
    "unanimous-consent": "unanimity",
    "consensus-based": "consensus",
    "consensus-decision": "consensus",
    "weighted-vote": "weighted",
    "weighted-voting": "weighted",
  };
  return aliases[raw] || "unspecified";
};

export const normalizeInstitutionVotingRule = (value = {}, world = {}, identityIndex = null) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = normalizeInstitutionVotingRuleType(source.type || source.rule || source.mode || "unspecified");
  const defaultThreshold = type === "two-thirds" ? (2 / 3)
    : type === "qualified-majority" ? 0.55
      : 0.5;
  const eligibleStatuses = unique(source.eligibleStatuses?.length ? source.eligibleStatuses : ["member"], 16)
    .map(lower)
    .filter((status) => MEMBER_STATUS_SET.has(status) && status !== "suspended");
  const vetoRoles = unique(source.vetoRoles, 16).map(lower).filter((role) => MEMBER_ROLE_SET.has(role));
  const vetoPolities = unique(source.vetoPolities, 64)
    .map((polity) => canonicalPolity(polity, world, identityIndex))
    .filter(Boolean);
  const weightsByPolity = {};
  const rawWeights = source.weightsByPolity && typeof source.weightsByPolity === "object" && !Array.isArray(source.weightsByPolity)
    ? source.weightsByPolity
    : {};
  for (const [rawPolity, rawWeight] of Object.entries(rawWeights)) {
    const polity = canonicalPolity(rawPolity, world, identityIndex);
    const weight = Number(rawWeight);
    if (!polity || !Number.isFinite(weight) || weight <= 0) continue;
    weightsByPolity[polity] = Math.min(1_000_000, weight);
  }
  const abstentionRaw = lower(source.abstentionPolicy || source.abstentions || "exclude").replace(/[\s_]+/g, "-");
  return {
    type,
    threshold: boundedFraction(source.threshold, defaultThreshold),
    quorum: boundedFraction(source.quorum, type === "unanimity" ? 1 : 0.5),
    abstentionPolicy: ABSTENTION_POLICY_SET.has(abstentionRaw) ? abstentionRaw : "exclude",
    eligibleStatuses: eligibleStatuses.length ? eligibleStatuses : ["member"],
    vetoPolities: unique(vetoPolities, 64),
    vetoRoles: unique(vetoRoles, 16),
    negativeVoteIsVeto: source.negativeVoteIsVeto === true,
    weightsByPolity,
  };
};

const normalizeInstitutionLifecycleRule = (value = {}, { defaultMode = "approval", defaultStatuses = ["member"] } = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const modeRaw = lower(source.mode || source.type || defaultMode).replace(/[\s_]+/g, "-");
  const modeAliases = {
    vote: "approval",
    ballot: "approval",
    direct: "direct",
    unilateral: "unilateral",
    notice: "notice",
    "notice-required": "notice",
    forbidden: "not-permitted",
    closed: "not-permitted",
  };
  const mode = ["approval", "direct", "unilateral", "notice", "not-permitted"].includes(modeRaw)
    ? modeRaw
    : (modeAliases[modeRaw] || defaultMode);
  const statuses = unique(source.allowedStatuses?.length ? source.allowedStatuses : defaultStatuses, 12)
    .map(lower)
    .filter((status) => MEMBER_STATUS_SET.has(status) && status !== "suspended");
  const noticeDays = Number(source.noticeDays ?? source.noticePeriodDays ?? 0);
  return {
    mode,
    allowedStatuses: statuses.length ? statuses : [...defaultStatuses],
    noticeDays: Number.isFinite(noticeDays) ? Math.max(0, Math.min(3650, Math.trunc(noticeDays))) : 0,
    note: clean(source.note || source.summary).slice(0, 800),
  };
};

export const normalizeInstitutionLifecycleRules = (value = {}, world = {}, identityIndex = null) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const identitySource = source.identity && typeof source.identity === "object" && !Array.isArray(source.identity) ? source.identity : {};
  const minimum = Number(source.minimumFoundingMembers ?? source.minimumMembers ?? 1);
  return {
    minimumFoundingMembers: Number.isFinite(minimum) ? Math.max(1, Math.min(64, Math.trunc(minimum))) : 1,
    purpose: unique(source.purpose || source.purposes, 16).slice(0, 16),
    identity: {
      geographicScope: unique(identitySource.geographicScope || source.geographicScope, 24),
      politicalCharacter: clean(identitySource.politicalCharacter || source.politicalCharacter).slice(0, 500),
      primaryThreatModel: unique(identitySource.primaryThreatModel || source.primaryThreatModel, 24),
    },
    accession: normalizeInstitutionLifecycleRule(source.accession, { defaultMode: "approval", defaultStatuses: ["member", "observer"] }),
    withdrawal: normalizeInstitutionLifecycleRule(source.withdrawal, { defaultMode: "unilateral", defaultStatuses: ["member"] }),
    expulsion: normalizeInstitutionLifecycleRule(source.expulsion, { defaultMode: "approval", defaultStatuses: ["member"] }),
    dissolution: normalizeInstitutionLifecycleRule(source.dissolution, { defaultMode: "approval", defaultStatuses: ["member"] }),
    approvalRule: normalizeInstitutionVotingRule(source.approvalRule || source.membershipVotingRule || {}, world, identityIndex),
    note: clean(source.note).slice(0, 1200),
  };
};

export const normalizeInstitutionLifecycleCase = (value = {}, fallbackId = "", world = {}, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = slug(value.id || fallbackId || `${value.kind || "case"}-${value.polity || value.targetPolity || "polity"}-${value.createdDate || "date"}`);
  const kind = lower(value.kind || value.type).replace(/[\s_]+/g, "-");
  const status = lower(value.status || "pending").replace(/[\s_]+/g, "-");
  const decision = lower(value.decision || value.response).replace(/[\s_]+/g, "-");
  const polity = canonicalPolity(value.polity || value.targetPolity || value.applicant || value.member, world, identityIndex);
  const initiatedBy = canonicalPolity(value.initiatedBy || value.invitedBy || value.requestedBy || value.proposer, world, identityIndex);
  if (!id || !LIFECYCLE_CASE_KIND_SET.has(kind)) return null;
  return {
    id,
    kind,
    status: LIFECYCLE_CASE_STATUS_SET.has(status) ? status : "pending",
    polity,
    initiatedBy,
    requestedStatus: MEMBER_STATUS_SET.has(lower(value.requestedStatus || value.memberStatus)) ? lower(value.requestedStatus || value.memberStatus) : "member",
    decision: LIFECYCLE_DECISION_SET.has(decision) ? decision : "",
    createdDate: clean(value.createdDate || value.date),
    updatedDate: clean(value.updatedDate || value.resolvedDate || value.createdDate || value.date),
    resolvedDate: clean(value.resolvedDate),
    effectiveDate: clean(value.effectiveDate),
    proposalId: slug(value.proposalId),
    chatId: clean(value.chatId).slice(0, 160),
    reason: clean(value.reason || value.note).slice(0, 1200),
    terms: clean(value.terms || value.requestedTerms).slice(0, 2400),
    sourceEventIds: unique(value.sourceEventIds, 24),
  };
};

export const normalizeInstitutionLifecycleCases = (value = {}, world = {}, identityIndex = null) => {
  const source = Array.isArray(value)
    ? Object.fromEntries(value.map((entry, index) => [entry?.id || `case-${index + 1}`, entry]))
    : (value && typeof value === "object" ? value : {});
  const out = {};
  for (const [rawId, rawCase] of Object.entries(source)) {
    const lifecycleCase = normalizeInstitutionLifecycleCase(rawCase, rawId, world, identityIndex);
    if (lifecycleCase) out[lifecycleCase.id] = lifecycleCase;
  }
  return out;
};

export const normalizeInstitutionMembershipHistoryEntry = (value = {}, index = 0, world = {}, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = lower(value.action || value.kind || value.type).replace(/[\s_]+/g, "-");
  if (!["founded", "invited", "applied", "joined", "observer", "associate", "left", "withdrawn", "expelled", "suspended", "reinstated", "rejected", "dissolved", "activated", "reactivated", "role-changed"].includes(action)) return null;
  const polity = canonicalPolity(value.polity || value.member || value.country, world, identityIndex);
  const actor = canonicalPolity(value.actor || value.by || value.initiatedBy, world, identityIndex);
  const id = slug(value.id || `${action}-${polity || "institution"}-${value.date || index + 1}`) || `history-${index + 1}`;
  return {
    id,
    action,
    polity,
    actor,
    date: clean(value.date || value.effectiveDate),
    status: MEMBER_STATUS_SET.has(lower(value.status)) ? lower(value.status) : "",
    role: MEMBER_ROLE_SET.has(lower(value.role)) ? lower(value.role) : "",
    sourceCaseId: slug(value.sourceCaseId),
    sourceProposalId: slug(value.sourceProposalId),
    reason: clean(value.reason || value.note).slice(0, 1200),
  };
};

export const normalizeInstitutionMembershipHistory = (value = [], world = {}, identityIndex = null) => {
  const out = [];
  const seen = new Set();
  for (let index = 0; index < array(value).length; index += 1) {
    const entry = normalizeInstitutionMembershipHistoryEntry(array(value)[index], index, world, identityIndex);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.slice(-512);
};

export const normalizeInstitutionCharter = (value = {}, world = {}, identityIndex = null) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const proposalRules = {};
  const rawProposalRules = source.proposalRules && typeof source.proposalRules === "object" && !Array.isArray(source.proposalRules)
    ? source.proposalRules
    : {};
  for (const [rawType, rawRule] of Object.entries(rawProposalRules)) {
    const type = slug(rawType);
    if (!type) continue;
    proposalRules[type] = normalizeInstitutionVotingRule(rawRule, world, identityIndex);
  }
  return {
    votingRule: normalizeInstitutionVotingRule(source.votingRule || source.defaultVotingRule || source, world, identityIndex),
    proposalRules,
    lifecycle: normalizeInstitutionLifecycleRules(source.lifecycle || source.membership || {}, world, identityIndex),
    note: clean(source.note || source.summary).slice(0, 1200),
    lastUpdatedDate: clean(source.lastUpdatedDate || source.updatedDate),
    sourceEventIds: unique(source.sourceEventIds, 24),
  };
};

const normalizeProposalAmendment = (value = {}, index = 0, world = {}, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = slug(value.id || `amendment-${index + 1}`);
  const text = clean(value.text || value.summary || value.description).slice(0, 4000);
  if (!id || !text) return null;
  const revisionSource = value.revision && typeof value.revision === "object" && !Array.isArray(value.revision)
    ? value.revision
    : {};
  const revision = {};
  if (clean(revisionSource.title)) revision.title = clean(revisionSource.title).slice(0, 240);
  if (clean(revisionSource.summary)) revision.summary = clean(revisionSource.summary).slice(0, 6000);
  if (Array.isArray(revisionSource.consequences)) {
    revision.consequences = revisionSource.consequences
      .map((entry, revisionIndex) => normalizeInstitutionProposalConsequence(entry, revisionIndex, world, identityIndex))
      .filter(Boolean)
      .slice(0, 64);
  }
  return {
    id,
    text,
    proposedBy: canonicalPolity(value.proposedBy || value.sponsor, world, identityIndex),
    proposedDate: clean(value.proposedDate || value.date),
    status: ["proposed", "accepted", "rejected", "withdrawn"].includes(lower(value.status)) ? lower(value.status) : "proposed",
    resolvedBy: canonicalPolity(value.resolvedBy, world, identityIndex),
    resolvedDate: clean(value.resolvedDate),
    ...(Object.keys(revision).length ? { revision } : {}),
    revisionApplied: value.revisionApplied === true,
  };
};

const normalizeProposalBallot = (value = {}, polity = "", world = {}, identityIndex = null) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : { choice: value };
  const voter = canonicalPolity(source.polity || polity, world, identityIndex);
  const choice = lower(source.choice || source.vote);
  if (!voter || !["yes", "no", "abstain", "veto"].includes(choice)) return null;
  return {
    polity: voter,
    choice,
    date: clean(source.date || source.castDate),
    government: clean(source.government || source.governmentLabel).slice(0, 240),
    reason: clean(source.reason).slice(0, 1200),
  };
};

export const normalizeInstitutionProposal = (value = {}, fallbackId = "", world = {}, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = slug(value.id || fallbackId || value.title);
  const title = clean(value.title || value.name || id).slice(0, 240);
  if (!id || !title) return null;
  const statusRaw = lower(value.status || "draft");
  const ballotSource = value?.voting?.ballots && typeof value.voting.ballots === "object" && !Array.isArray(value.voting.ballots)
    ? value.voting.ballots
    : {};
  const ballots = {};
  for (const [rawPolity, rawBallot] of Object.entries(ballotSource)) {
    const ballot = normalizeProposalBallot(rawBallot, rawPolity, world, identityIndex);
    if (ballot) ballots[ballot.polity] = ballot;
  }
  const voting = value.voting && typeof value.voting === "object" && !Array.isArray(value.voting)
    ? {
      openedDate: clean(value.voting.openedDate),
      closedDate: clean(value.voting.closedDate),
      rule: normalizeInstitutionVotingRule(value.voting.rule, world, identityIndex),
      eligibleVoters: unique(value.voting.eligibleVoters, 256).map((polity) => canonicalPolity(polity, world, identityIndex)).filter(Boolean),
      ballots,
      outcome: value.voting.outcome && typeof value.voting.outcome === "object" && !Array.isArray(value.voting.outcome)
        ? clone(value.voting.outcome)
        : null,
    }
    : null;
  return {
    id,
    type: slug(value.type || value.proposalType || "general") || "general",
    title,
    summary: clean(value.summary || value.description).slice(0, 6000),
    status: PROPOSAL_STATUS_SET.has(statusRaw) ? statusRaw : "draft",
    createdDate: clean(value.createdDate || value.date),
    createdBy: canonicalPolity(value.createdBy || value.proposedBy || value.sponsor, world, identityIndex),
    sponsorPolities: unique(value.sponsorPolities || value.sponsors, 64).map((polity) => canonicalPolity(polity, world, identityIndex)).filter(Boolean),
    amendments: array(value.amendments).map((entry, index) => normalizeProposalAmendment(entry, index, world, identityIndex)).filter(Boolean).slice(0, 64),
    voting,
    consequences: array(value.consequences).map((entry, index) => normalizeInstitutionProposalConsequence(entry, index, world, identityIndex)).filter(Boolean).slice(0, 64),
    implementation: value.implementation && typeof value.implementation === "object" && !Array.isArray(value.implementation)
      ? {
        status: ["pending", "partial", "complete", "blocked"].includes(lower(value.implementation.status)) ? lower(value.implementation.status) : "pending",
        applied: array(value.implementation.applied).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).map(clone).slice(0, 64),
        pending: array(value.implementation.pending).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).map(clone).slice(0, 64),
        lastUpdatedDate: clean(value.implementation.lastUpdatedDate || value.implementation.date),
        note: clean(value.implementation.note).slice(0, 1200),
      }
      : null,
    lastUpdatedDate: clean(value.lastUpdatedDate || value.updatedDate || value.createdDate || value.date),
    sourceEventIds: unique(value.sourceEventIds, 24),
    note: clean(value.note).slice(0, 1200),
  };
};

export const normalizeInstitutionProposals = (value = {}, world = {}, identityIndex = null) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  for (const [rawId, rawProposal] of Object.entries(source)) {
    const proposal = normalizeInstitutionProposal(rawProposal, rawId, world, identityIndex);
    if (proposal) out[proposal.id] = proposal;
  }
  return out;
};

const normalizeInstitutionGovernanceActivity = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const round = Number(source.lastAgendaRound);
  const empty = Number(source.consecutiveEmptyAgendaChecks);
  const outcome = lower(source.lastAgendaOutcome);
  return {
    lastAgendaDate: clean(source.lastAgendaDate).slice(0, 40),
    lastAgendaRound: Number.isFinite(round) ? Math.max(0, Math.trunc(round)) : 0,
    lastAgendaOutcome: ["proposal", "amendment", "advanced", "none"].includes(outcome) ? outcome : "",
    consecutiveEmptyAgendaChecks: Number.isFinite(empty) ? Math.max(0, Math.min(12, Math.trunc(empty))) : 0,
    sourceEventIds: unique(source.sourceEventIds, 24),
  };
};

const normalizeMember = (value, world, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const polity = canonicalPolity(value.polity || value.country || value.member, world, identityIndex);
  if (!polity) return null;
  const statusRaw = lower(value.status || "member");
  const roleRaw = lower(value.role || "member");
  return {
    polity,
    status: MEMBER_STATUS_SET.has(statusRaw) ? statusRaw : "member",
    role: MEMBER_ROLE_SET.has(roleRaw) ? roleRaw : "member",
    sinceDate: clean(value.sinceDate || value.joinedDate),
    lastUpdatedDate: clean(value.lastUpdatedDate || value.sinceDate || value.joinedDate),
    sourceEventIds: unique(value.sourceEventIds, 24),
    sourceProposalIds: unique(value.sourceProposalIds, 24),
    note: clean(value.note).slice(0, 600),
  };
};

export const normalizeInstitutionRecord = (value, fallbackId = "", world = {}, identityIndex = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity = canonicalInstitutionIdentity({ ...value, id: value.id || fallbackId });
  const id = identity.id;
  const name = identity.name;
  if (!id || !name) return null;
  const kindRaw = lower(value.kind || identity.kind || value.type || "other").replace(/[\s-]+/g, "_");
  const status = lower(value.status || "active");
  const memberMap = new Map();
  for (const rawMember of array(value.members)) {
    const member = normalizeMember(rawMember, world, identityIndex);
    if (!member) continue;
    memberMap.set(lower(member.polity), member);
  }
  const leaders = unique([
    ...array(value.leaders),
    ...[...memberMap.values()].filter((member) => ["leader", "leading-member"].includes(member.role)).map((member) => member.polity),
  ], 24).map((polity) => canonicalPolity(polity, world, identityIndex)).filter(Boolean);
  const leaderKeys = new Set(leaders.map(lower));
  for (const member of memberMap.values()) {
    if (leaderKeys.has(lower(member.polity)) && member.role === "member") member.role = "leading-member";
  }
  return {
    id,
    name,
    shortName: clean(value.shortName || identity.shortName).slice(0, 80),
    aliases: unique([...(identity.aliases || []), ...array(value.aliases)], 24),
    badgeKey: slug(value.badgeKey || identity.badgeKey),
    logoUrl: normalizeInstitutionLogoUrl(value.logoUrl || value.logo || value.emblemUrl || value.emblem || identity.logoUrl),
    logoAsset: value?.logoAsset === true || identity.logoAsset === true,
    priority: Number.isFinite(Number(value.priority)) ? Number(value.priority) : Number(identity.priority || 0),
    // Stable link to the persistent diplomatic channel. Membership remains
    // institution-owned; the channel materializes that membership for UI/history.
    channelId: clean(value.channelId || value.institutionalChannelId).slice(0, 160),
    kind: INSTITUTION_KIND_SET.has(kindRaw) ? kindRaw : "other",
    status: INSTITUTION_STATUS_SET.has(status) ? status : "active",
    members: [...memberMap.values()].sort((a, b) => a.polity.localeCompare(b.polity)),
    leaders,
    foundedDate: clean(value.foundedDate || identity.foundedDate),
    dissolvedDate: clean(value.dissolvedDate || identity.dissolvedDate),
    predecessors: normalizeInstitutionPredecessors(value?.predecessors?.length ? value.predecessors : identity.predecessors),
    charter: normalizeInstitutionCharter(value.charter || value.governance || {}, world, identityIndex),
    proposals: normalizeInstitutionProposals(value.proposals || value.resolutions || {}, world, identityIndex),
    lifecycleCases: normalizeInstitutionLifecycleCases(value.lifecycleCases || value.membershipCases || {}, world, identityIndex),
    membershipHistory: normalizeInstitutionMembershipHistory(value.membershipHistory || value.lifecycleHistory || [], world, identityIndex),
    governanceActivity: normalizeInstitutionGovernanceActivity(value.governanceActivity || value.agendaActivity || {}),
    lastUpdatedDate: clean(value.lastUpdatedDate),
    note: clean(value.note).slice(0, 1000),
    sourceEventIds: unique(value.sourceEventIds, 24),
    sourceProposalIds: unique(value.sourceProposalIds, 24),
  };
};

export const normalizeInstitutions = (input, world = {}) => {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const byIdSource = source.byId && typeof source.byId === "object" && !Array.isArray(source.byId)
    ? source.byId
    : source;
  // Institution ledgers can contain hundreds of memberships. Build save identity
  // metadata at most once per normalization instead of once per member.
  const identityIndex = buildPolityIdentityIndex(world || {});
  const byId = {};
  for (const [rawId, rawInstitution] of Object.entries(byIdSource)) {
    if (rawId === "schemaVersion" || rawId === "ledgerVersion") continue;
    const institution = normalizeInstitutionRecord(rawInstitution, rawId, world, identityIndex);
    if (institution) byId[institution.id] = institution;
  }
  return {
    schemaVersion: INSTITUTIONS_SCHEMA_VERSION,
    ledgerVersion: Math.max(0, Math.trunc(Number(source.ledgerVersion) || 0)),
    byId,
  };
};


export const institutionLifecycleCases = (institution = {}) => Object.values(institution?.lifecycleCases || {});

export const institutionPendingLifecycleCases = (institution = {}) => institutionLifecycleCases(institution)
  .filter((entry) => ["pending", "negotiating", "pending-approval"].includes(lower(entry?.status)));

export const institutionMembershipHistoryForPolity = (institution = {}, polityInput = "") => {
  const wanted = lower(polityInput);
  if (!wanted) return [];
  return array(institution?.membershipHistory).filter((entry) => lower(entry?.polity) === wanted);
};

export const institutionLifecycleCaseForPolity = (institution = {}, polityInput = "", { pendingOnly = false } = {}) => {
  const wanted = lower(polityInput);
  if (!wanted) return [];
  return institutionLifecycleCases(institution).filter((entry) => (
    lower(entry?.polity) === wanted
    && (!pendingOnly || ["pending", "negotiating", "pending-approval"].includes(lower(entry?.status)))
  ));
};


export const recordInstitutionAgendaCheck = ({
  world: worldLike = {}, institutionId = "", date = "", round = 0, outcome = "none", sourceEventIds = [],
} = {}) => {
  const world = clone(worldLike || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const id = canonicalInstitutionIdentity({ id: institutionId }).id;
  const institution = institutions.byId[id];
  if (!institution) return { world: { ...world, institutions }, institution: null, error: `Unknown institution ${clean(institutionId) || "<blank>"}.` };
  const previous = normalizeInstitutionGovernanceActivity(institution.governanceActivity);
  const nextOutcome = ["proposal", "amendment", "advanced"].includes(lower(outcome)) ? lower(outcome) : "none";
  institution.governanceActivity = normalizeInstitutionGovernanceActivity({
    lastAgendaDate: clean(date) || previous.lastAgendaDate,
    lastAgendaRound: Number.isFinite(Number(round)) ? Number(round) : previous.lastAgendaRound,
    lastAgendaOutcome: nextOutcome,
    consecutiveEmptyAgendaChecks: nextOutcome === "none" ? previous.consecutiveEmptyAgendaChecks + 1 : 0,
    sourceEventIds: unique(sourceEventIds, 24),
  });
  institutions.byId[id] = normalizeInstitutionRecord(institution, id, world);
  return { world: { ...world, institutions }, institution: institutions.byId[id], error: "" };
};

export const resolveInstitutionRecord = (world = {}, institutionInput = "") => {
  const institutions = world?.institutions && typeof world.institutions === "object" ? world.institutions : {};
  const byId = institutions.byId && typeof institutions.byId === "object" && !Array.isArray(institutions.byId)
    ? institutions.byId
    : institutions;
  const token = clean(typeof institutionInput === "object" ? (institutionInput.id || institutionInput.name || institutionInput.shortName) : institutionInput);
  if (!token) return null;
  const directId = canonicalInstitutionIdentity({ id: token }).id;
  if (directId && byId[directId] && typeof byId[directId] === "object") {
    return { ...byId[directId], id: directId };
  }
  const match = findInstitutionIdentityMatch(
    typeof institutionInput === "object" ? institutionInput : { id: token, name: token },
    Object.entries(byId)
      .filter(([id]) => id !== "schemaVersion" && id !== "ledgerVersion")
      .map(([id, value]) => ({ ...value, id: value?.id || id })),
  );
  return match || null;
};

// Institutional chat participation is a VIEW of canonical membership, never a
// second membership ledger. Suspended members do not receive the active channel;
// all other recorded membership statuses remain visible unless a future charter
// explicitly narrows channel access. The player is stripped later by the existing
// save-aware chat reconciler because the player is implicit in every thread.
export const institutionChannelParticipants = (world = {}, institutionInput = "") => {
  const institution = resolveInstitutionRecord(world, institutionInput);
  if (!institution) return [];
  const identityIndex = buildPolityIdentityIndex(world || {});
  const out = [];
  const seen = new Set();
  for (const member of array(institution.members)) {
    if (lower(member?.status || "member") === "suspended") continue;
    const polityKey = canonicalPolity(member?.polity, world, identityIndex);
    const key = lower(polityKey);
    if (!polityKey || seen.has(key)) continue;
    seen.add(key);
    const polity = world?.polityOverrides?.[polityKey];
    out.push({
      polityKey,
      code: clean(polity?.code || polityKey),
      name: clean(polity?.name || polity?.code || polityKey),
    });
  }
  return out;
};

const parseCsv = (value) => clean(value).split(",").map(clean).filter(Boolean);
const parseEventNumbers = (value) => parseCsv(value)
  .map((entry) => Number(entry))
  .filter((entry) => Number.isInteger(entry) && entry > 0)
  .map((entry) => entry - 1);

export const decodeInstitutionUpdates = (value) => {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object").map(clone);
  const text = clean(value);
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id, op, polity, status, role, eventNumbers, name, kind, note] = line.split("~");
    return {
      id: clean(id),
      op: lower(op),
      polity: clean(polity),
      status: lower(status),
      role: lower(role),
      eventIndexes: parseEventNumbers(eventNumbers),
      eventIds: [],
      name: clean(name),
      kind: lower(kind).replace(/[\s-]+/g, "_"),
      note: clean(note),
    };
  });
};

export const bindInstitutionUpdatesToEvents = (updatesInput, eventsInput) => {
  const events = array(eventsInput);
  return decodeInstitutionUpdates(updatesInput).map((update) => {
    const eventIds = unique([
      ...array(update.eventIds),
      ...array(update.eventIndexes)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length)
        .map((index) => clean(events[index]?.id))
        .filter(Boolean),
    ], 24);
    return { ...update, eventIds };
  });
};

const institutionEventText = (event = {}) => clean(`${event?.title || ""} ${event?.description || ""}`);
const textToken = (value) => clean(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const containsSemanticToken = (text, value) => {
  const token = textToken(value);
  if (!token) return false;
  return textToken(text).includes(token);
};
const CREATE_EVENT_RE = /\b(?:establish(?:es|ed|ing)?|create(?:s|d|ing)?|form(?:s|ed|ing)?|found(?:s|ed|ing)?|constitut(?:e|es|ed|ing)|charter(?:s|ed|ing)?|launch(?:es|ed|ing)?)\b/i;
const JOIN_EVENT_RE = /\b(?:join(?:s|ed|ing)?|admit(?:s|ted|ting)?|accession|accede(?:s|d)?|becomes?\s+(?:a\s+)?member|enters?\s+(?:the\s+)?(?:alliance|union|organization|organisation|council|bloc|pact))\b/i;
const LEAVE_EVENT_RE = /\b(?:withdraw(?:s|n|al)?|leave(?:s|ft|ing)?|exit(?:s|ed|ing)?|resign(?:s|ed|ing)?\s+(?:from\s+)?(?:membership|the\s+organization|the\s+organisation|the\s+alliance|the\s+union))\b/i;
const SUSPEND_EVENT_RE = /\bsuspend(?:s|ed|ing|sion)?\b/i;
const RESTORE_EVENT_RE = /\b(?:restore(?:s|d|ing)?|reinstate(?:s|d|ing)?|readmit(?:s|ted|ting)?)\b/i;
const ROLE_EVENT_RE = /\b(?:elect(?:s|ed|ing)?|appoint(?:s|ed|ing)?|select(?:s|ed|ing)?|name(?:s|d|ing)?|chair(?:s|ed|ing)?|lead(?:s|ing)?|leadership)\b/i;
const DISSOLVE_EVENT_RE = /\b(?:dissolv(?:e|es|ed|ing)|disband(?:s|ed|ing)?|abolish(?:es|ed|ing)?|wind(?:s|ing)?\s+up|terminate(?:s|d|ing)?)\b/i;

const operationEventPattern = (op) => ({
  create: CREATE_EVENT_RE,
  join: JOIN_EVENT_RE,
  leave: LEAVE_EVENT_RE,
  suspend: SUSPEND_EVENT_RE,
  restore: RESTORE_EVENT_RE,
  role: ROLE_EVENT_RE,
  dissolve: DISSOLVE_EVENT_RE,
}[lower(op)] || null);

const eventMentionsInstitution = (event, update) => {
  const text = institutionEventText(event);
  return [update?.name, update?.shortName, update?.id]
    .map((value) => clean(value).replace(/[-_]+/g, " "))
    .filter(Boolean)
    .some((value) => containsSemanticToken(text, value));
};

const eventMentionsPolity = (event, polity, world) => {
  const canonical = canonicalPolity(polity, world);
  if (!canonical) return false;
  const actorTokens = array(event?.actors).map((value) => canonicalPolity(value, world)).filter(Boolean);
  if (actorTokens.some((value) => lower(value) === lower(canonical))) return true;
  const identity = world?.polityOverrides?.[canonical] || {};
  const aliases = unique([canonical, identity?.name, identity?.code, ...array(identity?.aliases)], 24);
  const text = institutionEventText(event);
  return aliases.some((alias) => containsSemanticToken(text, alias));
};

// Live world generation may omit an event number even when the semantic event
// makes the institution lifecycle cause completely unambiguous. Native code owns
// that foreign-key binding. This helper only fills a missing link when there is
// exactly one strong semantic match; it never guesses among multiple events.
// Founding-member joins may inherit the uniquely bound creation event when that
// event names the polity as an actor/participant in the founding.
export const bindInstitutionUpdatesToCausalEvents = (candidate, { world = {} } = {}) => {
  if (!candidate || typeof candidate !== "object") return { bound: 0, ambiguous: 0, unresolved: 0 };
  const events = array(candidate.events);
  let updates = bindInstitutionUpdatesToEvents(candidate.institutionUpdates, events);
  let bound = 0;
  let ambiguous = 0;
  let unresolved = 0;

  const createEventIdsByInstitution = new Map();
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (lower(update?.op) !== "create") continue;
    const id = canonicalInstitutionIdentity({ id: update?.id, name: update?.name }).id;
    if (!id) continue;
    if (array(update?.eventIds).length) {
      createEventIdsByInstitution.set(id, array(update.eventIds));
      continue;
    }
    const matches = events.filter((event) =>
      clean(event?.id) &&
      eventMentionsInstitution(event, update) &&
      CREATE_EVENT_RE.test(institutionEventText(event))
    );
    if (matches.length === 1) {
      const eventId = clean(matches[0].id);
      updates[index] = { ...update, eventIds: [eventId] };
      createEventIdsByInstitution.set(id, [eventId]);
      bound += 1;
    } else if (matches.length > 1) {
      ambiguous += 1;
    } else {
      unresolved += 1;
    }
  }

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (lower(update?.op) === "create" || array(update?.eventIds).length) continue;
    const id = canonicalInstitutionIdentity({ id: update?.id, name: update?.name }).id;
    const pattern = operationEventPattern(update?.op);
    if (!id || !pattern) {
      unresolved += 1;
      continue;
    }

    let matches = events.filter((event) => {
      const text = institutionEventText(event);
      return clean(event?.id) && eventMentionsInstitution(event, update) && pattern.test(text)
        && (!clean(update?.polity) || eventMentionsPolity(event, update.polity, world));
    });

    // A newly created institution's founding members are often expressed by the
    // same semantic founding event instead of separate "joins" prose. Reuse that
    // exact creation cause only when the joining polity is actually a named actor
    // or participant in the founding event.
    if (!matches.length && lower(update?.op) === "join") {
      const createIds = createEventIdsByInstitution.get(id) || [];
      if (createIds.length === 1) {
        const foundingEvent = events.find((event) => clean(event?.id) === createIds[0]);
        if (foundingEvent && eventMentionsPolity(foundingEvent, update.polity, world)) matches = [foundingEvent];
      }
    }

    if (matches.length === 1) {
      updates[index] = { ...update, eventIds: [clean(matches[0].id)] };
      bound += 1;
    } else if (matches.length > 1) {
      ambiguous += 1;
    } else {
      unresolved += 1;
    }
  }

  candidate.institutionUpdates = updates;
  return { bound, ambiguous, unresolved };
};

export const validateInstitutionUpdates = (updatesInput, {
  world = {},
  events = [],
  allowUnboundBaseline = false,
  enforceTemporalBaseline = false,
  baselineDate = "",
} = {}) => {
  const institutions = normalizeInstitutions(world?.institutions, world);
  const updates = bindInstitutionUpdatesToEvents(updatesInput, events);
  const known = new Set(Object.keys(institutions.byId));
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    const op = lower(update.op);
    const id = canonicalInstitutionIdentity({ id: update.id, name: update.name, aliases: update.aliases }).id;
    if (!id) return `$.institutionUpdates record ${index + 1} requires an institution id.`;
    if (!["create", "join", "leave", "suspend", "restore", "role", "dissolve"].includes(op)) {
      return `$.institutionUpdates record ${index + 1} has unsupported op ${op || "<blank>"}.`;
    }
    if (!["create", "dissolve"].includes(op)) {
      const polity = canonicalPolity(update.polity, world);
      if (!polity) return `$.institutionUpdates record ${index + 1} requires a polity.`;
    }
    if (op === "create" && !clean(update.name)) return `$.institutionUpdates record ${index + 1} create requires name.`;
    if (enforceTemporalBaseline && op === "create" && !institutions.byId[id]) {
      const temporal = validateInstitutionTemporalBaseline({
        institution: { id, name: update.name, aliases: update.aliases, foundedDate: update.foundedDate, dissolvedDate: update.dissolvedDate, predecessors: update.predecessors },
        scenarioDate: clean(baselineDate),
      });
      if (!temporal.valid) return `$.institutionUpdates record ${index + 1} is temporally invalid for ${clean(baselineDate)}: ${temporal.reason}.`;
    }
    if (enforceTemporalBaseline && op === "join" && clean(update.sinceDate)) {
      const joined = comparableDate(update.sinceDate, "start");
      const baseline = comparableDate(baselineDate, "start");
      if (!joined || (baseline && joined > baseline)) {
        return `$.institutionUpdates record ${index + 1} has membership date ${clean(update.sinceDate) || "<blank>"} after/invalid for baseline ${clean(baselineDate)}.`;
      }
    }
    if (!allowUnboundBaseline && !array(update.eventIds).length) {
      return `$.institutionUpdates record ${index + 1} must bind to a causal event.`;
    }
    if (op === "join" && update.status && !MEMBER_STATUS_SET.has(lower(update.status))) {
      return `$.institutionUpdates record ${index + 1} has unsupported member status ${update.status}.`;
    }
    if (op === "role" && !MEMBER_ROLE_SET.has(lower(update.role))) {
      return `$.institutionUpdates record ${index + 1} has unsupported role ${update.role || "<blank>"}.`;
    }
    if (op === "create" || clean(update.name)) known.add(id);
    if (!["create", "join"].includes(op) && !known.has(id)) {
      return `$.institutionUpdates record ${index + 1} references unknown institution ${id}.`;
    }
  }
  return "";
};

const upsertMember = (institution, member) => {
  const members = array(institution.members).filter((entry) => lower(entry.polity) !== lower(member.polity));
  members.push(member);
  institution.members = members.sort((a, b) => a.polity.localeCompare(b.polity));
  institution.leaders = unique([
    ...array(institution.leaders).filter((polity) => lower(polity) !== lower(member.polity)),
    ...(["leader", "leading-member"].includes(member.role) ? [member.polity] : []),
  ], 24);
};

const appendInstitutionMembershipHistory = (institution, entry, world = {}) => {
  const history = normalizeInstitutionMembershipHistory([...(institution?.membershipHistory || []), entry], world);
  institution.membershipHistory = history;
  return history.at(-1) || null;
};

export const applyInstitutionStatusResolution = ({
  world: worldLike = {}, institutionId = "", status = "", date = "", sourceProposalId = "", note = "",
} = {}) => {
  const world = clone(worldLike || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const id = canonicalInstitutionIdentity({ id: institutionId }).id;
  const institution = institutions.byId[id];
  if (!institution) return { world: { ...world, institutions }, institution: null, error: `Unknown institution ${clean(institutionId) || "<blank>"}.` };
  const nextStatus = lower(status);
  if (!INSTITUTION_STATUS_SET.has(nextStatus)) return { world: { ...world, institutions }, institution, error: `Unsupported institution status ${status || "<blank>"}.` };
  const matchingLifecycleCase = sourceProposalId
    ? Object.values(institution.lifecycleCases || {}).find((entry) => clean(entry?.proposalId) === clean(sourceProposalId)) || null
    : null;
  institution.status = nextStatus;
  institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
  institution.sourceProposalIds = unique([...(institution.sourceProposalIds || []), sourceProposalId], 24);
  if (matchingLifecycleCase) institution.lifecycleCases = { ...(institution.lifecycleCases || {}), [matchingLifecycleCase.id]: { ...matchingLifecycleCase, status: "resolved", resolvedDate: clean(date), updatedDate: clean(date) } };
  if (nextStatus === "dissolved") institution.dissolvedDate = clean(date) || institution.dissolvedDate || "";
  if (nextStatus === "active" && lower(institution.status) !== "dissolved") institution.dissolvedDate = "";
  appendInstitutionMembershipHistory(institution, {
    action: nextStatus === "dissolved" ? "dissolved" : nextStatus === "active" ? "reactivated" : "role-changed",
    actor: matchingLifecycleCase?.initiatedBy || "", date: clean(date), sourceCaseId: matchingLifecycleCase?.id || "", sourceProposalId, reason: clean(note),
  }, world);
  institutions.byId[id] = normalizeInstitutionRecord(institution, id, world);
  return { world: { ...world, institutions }, institution: institutions.byId[id], error: "" };
};

export const applyInstitutionMembershipResolution = ({
  world: worldLike = {},
  institutionId = "",
  op = "",
  polity: polityInput = "",
  status = "member",
  role = "member",
  date = "",
  sourceProposalId = "",
  note = "",
} = {}) => {
  const world = clone(worldLike || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const id = canonicalInstitutionIdentity({ id: institutionId }).id;
  const institution = institutions.byId[id];
  if (!institution) return { world: { ...world, institutions }, institution: null, error: `Unknown institution ${clean(institutionId) || "<blank>"}.` };
  const operation = lower(op);
  if (!["join", "leave", "suspend", "restore", "role"].includes(operation)) {
    return { world: { ...world, institutions }, institution, error: `Unsupported institution membership resolution ${operation || "<blank>"}.` };
  }
  const polity = canonicalPolity(polityInput, world);
  if (!polity) return { world: { ...world, institutions }, institution, error: "Institution membership resolution requires a polity." };
  const existingMember = array(institution.members).find((entry) => lower(entry.polity) === lower(polity));
  const matchingLifecycleCase = sourceProposalId
    ? Object.values(institution.lifecycleCases || {}).find((entry) => clean(entry?.proposalId) === clean(sourceProposalId)) || null
    : null;
  const proposalIds = unique([...(existingMember?.sourceProposalIds || []), sourceProposalId], 24);

  if (operation === "join" || operation === "restore") {
    const nextStatus = operation === "restore" ? "member" : (MEMBER_STATUS_SET.has(lower(status)) ? lower(status) : "member");
    const nextRole = MEMBER_ROLE_SET.has(lower(role)) ? lower(role) : (existingMember?.role || "member");
    upsertMember(institution, {
      polity,
      status: nextStatus,
      role: nextRole,
      sinceDate: existingMember?.sinceDate || clean(date),
      lastUpdatedDate: clean(date),
      sourceEventIds: unique(existingMember?.sourceEventIds, 24),
      sourceProposalIds: proposalIds,
      note: clean(note) || existingMember?.note || "",
    });
    appendInstitutionMembershipHistory(institution, {
      action: operation === "restore" ? "reinstated" : (nextStatus === "observer" ? "observer" : nextStatus === "associate" ? "associate" : "joined"),
      polity, actor: matchingLifecycleCase?.initiatedBy || "", date: clean(date), status: nextStatus, role: nextRole,
      sourceCaseId: matchingLifecycleCase?.id || "", sourceProposalId, reason: clean(note),
    }, world);
    if (matchingLifecycleCase) {
      institution.lifecycleCases = {
        ...(institution.lifecycleCases || {}),
        [matchingLifecycleCase.id]: { ...matchingLifecycleCase, status: "resolved", decision: matchingLifecycleCase.decision || "accept", resolvedDate: clean(date), updatedDate: clean(date) },
      };
    }
  } else if (operation === "suspend") {
    if (!existingMember) return { world: { ...world, institutions }, institution, error: `${polity} is not a current member of ${institution.name}.` };
    upsertMember(institution, { ...existingMember, status: "suspended", lastUpdatedDate: clean(date), sourceProposalIds: proposalIds, note: clean(note) || existingMember.note || "" });
    appendInstitutionMembershipHistory(institution, { action: "suspended", polity, actor: matchingLifecycleCase?.initiatedBy || "", date: clean(date), sourceCaseId: matchingLifecycleCase?.id || "", sourceProposalId, reason: clean(note) }, world);
    if (matchingLifecycleCase) institution.lifecycleCases = { ...(institution.lifecycleCases || {}), [matchingLifecycleCase.id]: { ...matchingLifecycleCase, status: "resolved", resolvedDate: clean(date), updatedDate: clean(date) } };
  } else if (operation === "role") {
    if (!existingMember) return { world: { ...world, institutions }, institution, error: `${polity} is not a current member of ${institution.name}.` };
    const nextRole = MEMBER_ROLE_SET.has(lower(role)) ? lower(role) : "";
    if (!nextRole) return { world: { ...world, institutions }, institution, error: `Unsupported institution member role ${role || "<blank>"}.` };
    upsertMember(institution, { ...existingMember, role: nextRole, lastUpdatedDate: clean(date), sourceProposalIds: proposalIds, note: clean(note) || existingMember.note || "" });
    appendInstitutionMembershipHistory(institution, { action: "role-changed", polity, date: clean(date), role: nextRole, sourceProposalId, reason: clean(note) }, world);
  } else if (operation === "leave") {
    if (!existingMember) return { world: { ...world, institutions }, institution, error: `${polity} is not a current member of ${institution.name}.` };
    institution.members = array(institution.members).filter((entry) => lower(entry.polity) !== lower(polity));
    institution.leaders = array(institution.leaders).filter((entry) => lower(entry) !== lower(polity));
    const historyAction = matchingLifecycleCase?.kind === "expulsion" ? "expelled" : matchingLifecycleCase?.kind === "withdrawal" ? "withdrawn" : "left";
    appendInstitutionMembershipHistory(institution, { action: historyAction, polity, actor: matchingLifecycleCase?.initiatedBy || polity, date: clean(date), sourceCaseId: matchingLifecycleCase?.id || "", sourceProposalId, reason: clean(note) }, world);
    if (matchingLifecycleCase) institution.lifecycleCases = { ...(institution.lifecycleCases || {}), [matchingLifecycleCase.id]: { ...matchingLifecycleCase, status: "resolved", resolvedDate: clean(date), updatedDate: clean(date) } };
  }

  institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
  institution.sourceProposalIds = unique([...(institution.sourceProposalIds || []), sourceProposalId], 24);
  institutions.byId[id] = normalizeInstitutionRecord(institution, id, world);
  return { world: { ...world, institutions }, institution: institutions.byId[id], error: "" };
};

export const applyInstitutionCharterResolution = ({
  world: worldLike = {},
  institutionId = "",
  charterPatch = {},
  date = "",
  sourceProposalId = "",
} = {}) => {
  const world = clone(worldLike || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const id = canonicalInstitutionIdentity({ id: institutionId }).id;
  const institution = institutions.byId[id];
  if (!institution) return { world: { ...world, institutions }, institution: null, error: `Unknown institution ${clean(institutionId) || "<blank>"}.` };
  const current = institution.charter || normalizeInstitutionCharter({}, world);
  const patch = charterPatch && typeof charterPatch === "object" && !Array.isArray(charterPatch) ? charterPatch : {};
  institution.charter = normalizeInstitutionCharter({
    ...current,
    ...patch,
    votingRule: patch.votingRule ? { ...current.votingRule, ...patch.votingRule } : current.votingRule,
    proposalRules: patch.proposalRules ? { ...current.proposalRules, ...patch.proposalRules } : current.proposalRules,
    lastUpdatedDate: clean(date) || current.lastUpdatedDate || "",
    sourceEventIds: unique(current.sourceEventIds, 24),
  }, world);
  institution.lastUpdatedDate = clean(date) || institution.lastUpdatedDate || "";
  institution.sourceProposalIds = unique([...(institution.sourceProposalIds || []), sourceProposalId], 24);
  institutions.byId[id] = normalizeInstitutionRecord(institution, id, world);
  return { world: { ...world, institutions }, institution: institutions.byId[id], error: "" };
};

export const applyInstitutionUpdates = ({
  world: worldLike,
  updates: updatesInput,
  events = [],
  stopDate = "",
  round = 0,
  allowUnboundBaseline = false,
  enforceTemporalBaseline = false,
} = {}) => {
  const world = clone(worldLike || {});
  const institutions = normalizeInstitutions(world.institutions, world);
  const updates = bindInstitutionUpdatesToEvents(updatesInput, events);
  const error = validateInstitutionUpdates(updates, {
    world: { ...world, institutions },
    events,
    allowUnboundBaseline,
    enforceTemporalBaseline,
    baselineDate: stopDate,
  });
  if (error) return { world: { ...world, institutions }, institutions, appliedIds: [], error };
  const appliedIds = [];
  const eventById = new Map(array(events).map((event) => [clean(event?.id), event]));

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    const id = canonicalInstitutionIdentity({ id: update.id, name: update.name, aliases: update.aliases }).id;
    const op = lower(update.op);
    const sourceEventIds = unique(update.eventIds, 24);
    const sourceDates = sourceEventIds.map((eventId) => clean(eventById.get(eventId)?.date)).filter(Boolean).sort();
    const updateDate = sourceDates.at(-1) || clean(stopDate);
    let institution = institutions.byId[id] || normalizeInstitutionRecord({ id, name: clean(update.name) || id, kind: update.kind || "other" }, id, world);

    if (op === "create") {
      institution = normalizeInstitutionRecord({
        ...institution,
        id,
        name: clean(update.name) || institution?.name || id,
        shortName: clean(update.shortName) || institution?.shortName || "",
        aliases: unique([...(institution?.aliases || []), ...array(update.aliases)], 24),
        badgeKey: clean(update.badgeKey) || institution?.badgeKey || "",
        logoUrl: normalizeInstitutionLogoUrl(update.logoUrl || update.logo || update.emblemUrl || update.emblem) || institution?.logoUrl || "",
        priority: Number.isFinite(Number(update.priority)) ? Number(update.priority) : institution?.priority,
        kind: update.kind || institution?.kind || "other",
        status: "active",
        foundedDate: clean(update.foundedDate) || institution?.foundedDate || updateDate,
        dissolvedDate: clean(update.dissolvedDate) || institution?.dissolvedDate || "",
        predecessors: normalizeInstitutionPredecessors(update?.predecessors?.length ? update.predecessors : institution?.predecessors),
        lastUpdatedDate: updateDate,
        note: clean(update.note) || institution?.note,
        sourceEventIds: unique([...(institution?.sourceEventIds || []), ...sourceEventIds], 24),
      }, id, world);
      institutions.byId[id] = institution;
      appliedIds.push(`${id}:create`);
      continue;
    }

    if (!institution) continue;
    if (!institutions.byId[id]) institutions.byId[id] = institution;
    const polity = canonicalPolity(update.polity, world);
    const existingMember = array(institution.members).find((entry) => lower(entry.polity) === lower(polity));

    if (op === "join" || op === "restore") {
      const status = op === "restore" ? "member" : (MEMBER_STATUS_SET.has(lower(update.status)) ? lower(update.status) : "member");
      const role = MEMBER_ROLE_SET.has(lower(update.role)) ? lower(update.role) : (existingMember?.role || "member");
      upsertMember(institution, {
        polity,
        status,
        role,
        // Historical baseline membership may be known to exist on the scenario
        // date without a trustworthy accession date. Do not lie by stamping the
        // scenario start as the join date; live/event-driven joins still use the
        // causal event date when no explicit date is supplied.
        sinceDate: existingMember?.sinceDate || clean(update.sinceDate) || (allowUnboundBaseline ? "" : updateDate),
        lastUpdatedDate: updateDate,
        sourceEventIds: unique([...(existingMember?.sourceEventIds || []), ...sourceEventIds], 24),
        note: clean(update.note) || existingMember?.note || "",
      });
    } else if (op === "suspend") {
      if (!existingMember) continue;
      upsertMember(institution, { ...existingMember, status: "suspended", lastUpdatedDate: updateDate, sourceEventIds: unique([...(existingMember.sourceEventIds || []), ...sourceEventIds], 24), note: clean(update.note) || existingMember.note || "" });
    } else if (op === "role") {
      if (!existingMember) continue;
      upsertMember(institution, { ...existingMember, role: lower(update.role), lastUpdatedDate: updateDate, sourceEventIds: unique([...(existingMember.sourceEventIds || []), ...sourceEventIds], 24), note: clean(update.note) || existingMember.note || "" });
    } else if (op === "leave") {
      institution.members = array(institution.members).filter((entry) => lower(entry.polity) !== lower(polity));
      institution.leaders = array(institution.leaders).filter((entry) => lower(entry) !== lower(polity));
    } else if (op === "dissolve") {
      institution.status = "dissolved";
      institution.dissolvedDate = updateDate;
    }

    institution.lastUpdatedDate = updateDate || institution.lastUpdatedDate || "";
    institution.sourceEventIds = unique([...(institution.sourceEventIds || []), ...sourceEventIds], 24);
    institution.note = clean(update.note) || institution.note || "";
    institutions.byId[id] = normalizeInstitutionRecord(institution, id, world);
    appliedIds.push(`${id}:${op}${polity ? `:${polity}` : ""}`);
  }

  institutions.ledgerVersion = Math.max(Number(institutions.ledgerVersion) || 0, INSTITUTION_LEDGER_VERSION);
  return { world: { ...world, institutions }, institutions, appliedIds, error: "" };
};

export const removePolityFromInstitutions = (institutionsInput, polityInput, world = {}, date = "") => {
  const institutions = normalizeInstitutions(institutionsInput, world);
  const polity = canonicalPolity(polityInput, world);
  if (!polity) return institutions;
  for (const [id, institution] of Object.entries(institutions.byId)) {
    const members = array(institution.members).filter((member) => lower(member.polity) !== lower(polity));
    const leaders = array(institution.leaders).filter((leader) => lower(leader) !== lower(polity));
    if (members.length === institution.members.length && leaders.length === institution.leaders.length) continue;
    institutions.byId[id] = { ...institution, members, leaders, lastUpdatedDate: clean(date) || institution.lastUpdatedDate || "" };
  }
  return institutions;
};

export const institutionsForPolity = (world, polityInput, { includeSuspended = true, includeDissolved = false } = {}) => {
  const polity = canonicalPolity(polityInput, world);
  if (!polity) return [];
  const wanted = lower(polity);
  const source = world?.institutions && typeof world.institutions === "object" ? world.institutions : {};
  const byIdSource = source.byId && typeof source.byId === "object" && !Array.isArray(source.byId)
    ? source.byId
    : source;
  const out = [];
  let identityIndex = null;

  // Hot read path: the applied ledger is already canonical. Do not normalize the
  // entire institution ledger for every country badge / prompt-summary lookup.
  for (const [rawId, rawInstitution] of Object.entries(byIdSource)) {
    if (rawId === "schemaVersion" || rawId === "ledgerVersion") continue;
    if (!rawInstitution || typeof rawInstitution !== "object" || Array.isArray(rawInstitution)) continue;
    if (!includeDissolved && lower(rawInstitution.status || "active") === "dissolved") continue;
    let member = array(rawInstitution.members).find((entry) => lower(entry?.polity || entry?.country || entry?.member) === wanted);
    if (!member) {
      const candidates = array(rawInstitution.members).filter((entry) => entry && typeof entry === "object");
      for (const candidate of candidates) {
        const rawPolity = clean(candidate?.polity || candidate?.country || candidate?.member);
        if (!rawPolity) continue;
        if (!identityIndex) identityIndex = buildPolityIdentityIndex(world || {});
        if (lower(canonicalPolity(rawPolity, world, identityIndex)) === wanted) {
          member = candidate;
          break;
        }
      }
    }
    if (!member) continue;
    const statusRaw = lower(member.status || "member");
    const normalizedMember = {
      ...member,
      polity,
      status: MEMBER_STATUS_SET.has(statusRaw) ? statusRaw : "member",
      role: MEMBER_ROLE_SET.has(lower(member.role || "member")) ? lower(member.role || "member") : "member",
    };
    if (!includeSuspended && normalizedMember.status === "suspended") continue;
    const institution = {
      ...rawInstitution,
      id: slug(rawInstitution.id || rawId || rawInstitution.name),
      name: clean(rawInstitution.name || rawInstitution.title || rawId),
      kind: INSTITUTION_KIND_SET.has(lower(rawInstitution.kind || rawInstitution.type || "other").replace(/[\s-]+/g, "_"))
        ? lower(rawInstitution.kind || rawInstitution.type || "other").replace(/[\s-]+/g, "_")
        : "other",
      status: lower(rawInstitution.status || "active"),
    };
    out.push({ institution, member: normalizedMember });
  }
  return out.sort((a, b) => institutionStrategicPriority(b.institution) - institutionStrategicPriority(a.institution) || a.institution.name.localeCompare(b.institution.name));
};

export const institutionStrategicPriority = (institution) => {
  const identity = canonicalInstitutionIdentity(institution || {});
  const byId = Number(identity.priority || institution?.priority || 0);
  const kind = lower(institution?.kind || identity.kind);
  const byKind = kind === "security_alliance" ? 85
    : kind === "defense_pact" ? 82
      : kind === "political_union" ? 78
        : kind === "economic_union" ? 70
          : kind === "regional_bloc" ? 60
            : kind === "consultative_group" ? 45
              : 30;
  return Math.max(byId, byKind);
};

const canonicalBadgeRoot = (institution) => {
  const identity = canonicalInstitutionIdentity(institution || {});
  // Never leak storage/provider ids into the header. Known institutions receive
  // a curated short key; alternate-history institutions may opt in with an
  // explicit badgeKey and otherwise remain visible in the Diplomacy panel only.
  return slug(institution?.badgeKey || identity.badgeKey);
};

export const institutionMembershipBadge = (institution, member) => {
  const root = canonicalBadgeRoot(institution);
  if (!root || !member) return "";
  const status = lower(member.status || "member");
  if (status === "member") return `${root}-member`;
  if (status === "candidate") return `${root}-candidate`;
  if (status === "associate") return `${root}-associate`;
  if (status === "participant") return `${root}-participant`;
  if (status === "observer") return `${root}-observer`;
  if (status === "suspended") return `${root}-suspended`;
  return "";
};

export const buildInstitutionContext = (world, focusPolities = [], { maxInstitutions = 14 } = {}) => {
  const focus = new Set(array(focusPolities).map((polity) => lower(canonicalPolity(polity, world))).filter(Boolean));
  const institutions = normalizeInstitutions(world?.institutions, world);
  const rows = Object.values(institutions.byId)
    .filter((institution) => institution.status !== "dissolved")
    .filter((institution) => !focus.size || array(institution.members).some((member) => focus.has(lower(member.polity))))
    .sort((a, b) => institutionStrategicPriority(b) - institutionStrategicPriority(a))
    .slice(0, Math.max(1, maxInstitutions));
  return rows.map((institution) => {
    const members = array(institution.members)
      .filter((member) => !focus.size || focus.has(lower(member.polity)))
      .map((member) => `${member.polity} (${member.status}${member.role !== "member" ? `, ${member.role}` : ""})`);
    return `- ${institution.name} [${institution.id}; ${institution.kind}]${members.length ? `: ${members.join(", ")}` : ""}`;
  }).join("\n");
};
