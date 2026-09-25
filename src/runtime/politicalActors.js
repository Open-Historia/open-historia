/*! Open Historia — political actor runtime domain */

import { resolveStockCountryCode } from "./polityIdentity.js";
import { normalizePoliticalPressureState } from "./politicalPressure.js";

export const POLITICAL_ACTORS_SCHEMA_VERSION = 6;

export const POLITICAL_REPRESENTATIONS = Object.freeze({
    ELECTORAL: "electoral",
    COURT_FACTIONS: "court_factions",
    PARTY_STATE: "party_state",
    ELITE_FACTIONS: "elite_factions",
    MILITARY_FACTIONS: "military_factions",
    REVOLUTIONARY_FACTIONS: "revolutionary_factions",
    COLONIAL: "colonial",
    NONE: "none",
});

const POLITICAL_REPRESENTATION_SET = new Set(Object.values(POLITICAL_REPRESENTATIONS));

export const POLITICAL_REGIME_CHARACTERS = Object.freeze([
    "democratic",
    "hybrid",
    "authoritarian",
    "totalitarian",
    "theocratic",
    "military",
    "colonial",
    "other",
]);
const POLITICAL_REGIME_CHARACTER_SET = new Set(POLITICAL_REGIME_CHARACTERS);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const cloneActorValue = (value) => {
    if (!value || typeof value !== "object") return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
};

const clampPercent = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
};

const normalizeLandscapeShare = (value, { allowLabel = false } = {}) => {
    const source = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : { percent: value };
    const percent = clampPercent(source.percent);
    const basis = clean(source.basis);
    const label = allowLabel ? clean(source.label) : "";
    if (percent == null && !label) return null;
    return {
        ...(percent != null ? { percent } : {}),
        ...(basis ? { basis } : {}),
        ...(label ? { label } : {}),
    };
};

const clampSignedPercent = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(-100, Math.min(100, Math.round(number * 10) / 10));
};

const POLITICAL_RESPONSE_ISSUE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const normalizePoliticalResponseIssueKey = (value) => {
    const key = clean(value).toLocaleLowerCase().replace(/[\s.]+/g, "_");
    return POLITICAL_RESPONSE_ISSUE_KEY_PATTERN.test(key) ? key : "";
};

export const normalizePoliticalResponseIssue = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = {};

    const position = clampSignedPercent(value.position ?? value.stance);
    if (position != null) out.position = position;

    const sensitivity = clampPercent(value.sensitivity ?? value.issueSensitivity);
    if (sensitivity != null) out.sensitivity = sensitivity;

    const strainResponse = clampSignedPercent(value.strainResponse ?? value.strainAffinity);
    if (strainResponse != null) out.strainResponse = strainResponse;

    return Object.keys(out).length ? out : null;
};

// Hidden canonical response metadata used by the native background political
// engine. It is deliberately separate from public ideology/priority prose: the
// simulator must not re-interpret arbitrary text every tick to rediscover an
// actor's issue position. Public/intelligence projections whitelist fields and
// therefore do not expose this profile to normal Country UI consumers.
export const normalizePoliticalResponseProfile = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = {};

    for (const key of ["organization", "credibility", "inertia", "resilience"]) {
        const number = clampPercent(value[key]);
        if (number != null) out[key] = number;
    }

    const sourceIssues = value.issues && typeof value.issues === "object" && !Array.isArray(value.issues)
        ? value.issues
        : {};
    const issues = {};
    for (const [rawKey, rawIssue] of Object.entries(sourceIssues).slice(0, 24)) {
        const key = normalizePoliticalResponseIssueKey(rawKey);
        if (!key) continue;
        const issue = normalizePoliticalResponseIssue(rawIssue);
        if (issue) issues[key] = issue;
    }
    if (Object.keys(issues).length) out.issues = issues;

    return Object.keys(out).length ? out : null;
};

export const POLITICAL_DISPOSITION_DIMENSIONS = Object.freeze([
    "assertiveness",
    "riskTolerance",
    "escalationPressure",
    "compromisePressure",
    "regimeVulnerability",
    "deterrenceSensitivity",
    "opportunityPerception",
    "threatPerception",
]);

// Behavioral disposition is hidden, derived canonical state. Preserve unknown
// legacy extension fields for compatibility, but normalize the native dimensions
// C4 owns so future consumers can rely on a stable bounded contract.
export const normalizePoliticalBehavioralDisposition = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = cloneActorValue(value);
    let ownedFields = 0;
    for (const key of POLITICAL_DISPOSITION_DIMENSIONS) {
        const number = clampPercent(value[key]);
        if (number != null) {
            out[key] = number;
            ownedFields += 1;
        } else {
            delete out[key];
        }
    }
    const updatedAt = clean(value.updatedAt);
    if (updatedAt) out.updatedAt = updatedAt.slice(0, 32);
    else delete out.updatedAt;
    if (!ownedFields && !Object.keys(out).some((key) => key !== "updatedAt")) return null;
    return out;
};

const cleanStringArray = (value, limit = 32) => {
    const source = Array.isArray(value) ? value : (clean(value) ? [value] : []);
    const out = [];
    const seen = new Set();
    for (const entry of source) {
        const text = clean(entry);
        const key = text.toLocaleLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= limit) break;
    }
    return out;
};

const normalizeMetricRecord = (value, { depth = 0, maxDepth = 3, maxKeys = 32, clampNumeric = false } = {}) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > maxDepth) return {};
    const out = {};
    for (const [rawKey, rawValue] of Object.entries(value).slice(0, maxKeys)) {
        const key = clean(rawKey);
        if (!key) continue;
        if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
            const nested = normalizeMetricRecord(rawValue, { depth: depth + 1, maxDepth, maxKeys, clampNumeric });
            if (Object.keys(nested).length) out[key] = nested;
            continue;
        }
        if (Array.isArray(rawValue)) {
            const list = cleanStringArray(rawValue, 16);
            if (list.length) out[key] = list;
            continue;
        }
        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
            const rounded = Math.round(rawValue * 10) / 10;
            out[key] = clampNumeric ? Math.max(0, Math.min(100, rounded)) : rounded;
            continue;
        }
        if (typeof rawValue === "boolean") {
            out[key] = rawValue;
            continue;
        }
        const text = clean(rawValue);
        if (text) out[key] = text;
    }
    return out;
};

const normalizeOfficeholder = (value) => {
    if (typeof value === "string") return clean(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const name = clean(value.name || value.id);
    if (!name) return "";
    const out = {};
    if (clean(value.id)) out.id = clean(value.id);
    out.name = name;
    const title = clean(value.title || value.role);
    if (title) out.title = title;
    return out;
};

const partyTokenKey = (value) =>
    clean(value)
        .toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, "");

const asciiPartySlug = (value) =>
    clean(value)
        .toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

const stableTextHash = (value) => {
    let hash = 2166136261;
    for (const char of String(value ?? "")) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
};

const derivePartyId = (party, index = 0) => {
    const explicit = clean(party?.id);
    if (explicit) return explicit;
    for (const candidate of [
        party?.shortName,
        party?.abbreviation,
        party?.name,
        ...(Array.isArray(party?.aliases) ? party.aliases : []),
    ]) {
        const slug = asciiPartySlug(candidate);
        if (slug) return slug;
    }
    const seed = clean(party?.name || party?.shortName || party?.abbreviation) || `party-${index + 1}`;
    return `party-${stableTextHash(seed)}`;
};

const derivePoliticalEntityId = (value, index = 0, prefix = "bloc") => {
    const explicit = clean(value?.id);
    if (explicit) return explicit;
    for (const candidate of [
        value?.shortName,
        value?.abbreviation,
        value?.name,
        ...(Array.isArray(value?.aliases) ? value.aliases : []),
    ]) {
        const slug = asciiPartySlug(candidate);
        if (slug) return slug;
    }
    const seed = clean(value?.name || value?.shortName || value?.abbreviation) || `${prefix}-${index + 1}`;
    return `${prefix}-${stableTextHash(seed)}`;
};

export const normalizePoliticalParty = (value, { index = 0 } = {}) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const name = clean(value.name || value.shortName || value.abbreviation || value.id);
    if (!name) return null;

    // Preserve unrecognized extension data for forward compatibility, but normalize
    // every field the runtime itself owns. Unknown fields remain inert unless a
    // specific consumer explicitly understands them.
    const out = cloneActorValue(value);
    out.id = derivePartyId(value, index);
    out.name = name;

    const shortName = clean(value.shortName || value.abbreviation);
    if (shortName) out.shortName = shortName;
    else delete out.shortName;
    delete out.abbreviation;

    const aliases = cleanStringArray(value.aliases, 24)
        .filter((alias) => partyTokenKey(alias) !== partyTokenKey(name));
    if (aliases.length) out.aliases = aliases;
    else delete out.aliases;

    const support = normalizeLandscapeShare(value.support);
    if (support) out.support = support;
    else delete out.support;

    // Party-state systems may expose a ruling/state party as a political power
    // actor rather than pretending its percentage is electoral support. Keep
    // this metric distinct so the Country panel and simulation can label it as
    // influence/control.
    const influence = normalizeLandscapeShare(value.influence, { allowLabel: true });
    if (influence) out.influence = influence;
    else delete out.influence;

    const politicalResponse = normalizePoliticalResponseProfile(value.politicalResponse || value.responseProfile);
    if (politicalResponse) out.politicalResponse = politicalResponse;
    else delete out.politicalResponse;
    delete out.responseProfile;

    const ideology = clean(value.ideology);
    if (ideology) out.ideology = ideology;
    else delete out.ideology;

    const leader = normalizeOfficeholder(value.leader);
    if (leader) out.leader = leader;
    else delete out.leader;

    for (const key of ["goals", "publicPriorities", "publicForeignPolicy"]) {
        const list = cleanStringArray(value[key], 16);
        if (list.length) out[key] = list;
        else delete out[key];
    }

    for (const key of ["publicDescription", "color", "internalStrategy", "internalPressure", "privateGoal"]) {
        const text = clean(value[key]);
        if (text) out[key] = text;
        else delete out[key];
    }

    if (value.ruling === true) out.ruling = true;
    else delete out.ruling;
    if (value.coalition === true) out.coalition = true;
    else delete out.coalition;

    return out;
};

export const normalizePoliticalPowerBloc = (value, { index = 0 } = {}) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const name = clean(value.name || value.shortName || value.abbreviation || value.id);
    if (!name) return null;

    const out = cloneActorValue(value);
    out.id = derivePoliticalEntityId(value, index, "bloc");
    out.name = name;

    const shortName = clean(value.shortName || value.abbreviation);
    if (shortName) out.shortName = shortName;
    else delete out.shortName;
    delete out.abbreviation;

    const aliases = cleanStringArray(value.aliases, 24)
        .filter((alias) => partyTokenKey(alias) !== partyTokenKey(name));
    if (aliases.length) out.aliases = aliases;
    else delete out.aliases;

    const influenceSource = value?.influence && typeof value.influence === "object" && !Array.isArray(value.influence)
        ? { ...value.influence, ...(clean(value.influenceLabel) && !clean(value.influence?.label) ? { label: clean(value.influenceLabel) } : {}) }
        : (typeof value.influence === "number" ? { percent: value.influence, ...(clean(value.influenceLabel) ? { label: clean(value.influenceLabel) } : {}) } : { ...(clean(value.influenceLabel) ? { label: clean(value.influenceLabel) } : {}) });
    const influence = normalizeLandscapeShare(influenceSource, { allowLabel: true });
    if (influence) out.influence = influence;
    else delete out.influence;
    delete out.influenceLabel;

    const politicalResponse = normalizePoliticalResponseProfile(value.politicalResponse || value.responseProfile);
    if (politicalResponse) out.politicalResponse = politicalResponse;
    else delete out.politicalResponse;
    delete out.responseProfile;

    for (const key of ["kind", "ideology", "status", "publicDescription", "color", "internalStrategy", "internalPressure", "privateGoal"]) {
        const text = clean(value[key]);
        if (text) out[key] = text;
        else delete out[key];
    }

    const leader = normalizeOfficeholder(value.leader);
    if (leader) out.leader = leader;
    else delete out.leader;

    for (const key of ["goals", "publicPriorities", "publicForeignPolicy"]) {
        const list = cleanStringArray(value[key], 16);
        if (list.length) out[key] = list;
        else delete out[key];
    }

    return out;
};

const powerBlocTokens = (bloc) => [
    bloc?.id,
    bloc?.name,
    bloc?.shortName,
    ...(Array.isArray(bloc?.aliases) ? bloc.aliases : []),
].map(clean).filter(Boolean);

export const resolvePoliticalPowerBloc = (actorOrWorld, polityOrToken, maybeToken) => {
    const actor = maybeToken === undefined
        ? actorOrWorld
        : getPoliticalProfile(actorOrWorld, polityOrToken);
    const token = maybeToken === undefined ? polityOrToken : maybeToken;
    if (!actor || !Array.isArray(actor.powerBlocs)) return null;
    const target = partyTokenKey(token);
    if (!target) return null;
    return actor.powerBlocs.find((bloc) =>
        powerBlocTokens(bloc).some((candidate) => partyTokenKey(candidate) === target),
    ) || null;
};

const inferPoliticalSystemType = (governmentForm) => {
    const form = clean(governmentForm).toLocaleLowerCase();
    if (!form) return "unspecified";
    if (/absolute monarchy|absolute monarch/.test(form)) return "absolute_monarchy";
    if (/constitutional monarchy|constitutional monarch/.test(form)) return "constitutional_monarchy";
    if (/semi[- ]presidential republic/.test(form)) return "semi_presidential_republic";
    if (/parliamentary republic/.test(form)) return "parliamentary_republic";
    if (/presidential republic/.test(form)) return "presidential_republic";
    if (/one[- ]party|single[- ]party|party[- ]state/.test(form)) return "one_party_state";
    if (/military junta|military regime/.test(form)) return "military_regime";
    if (/personalist/.test(form)) return "personalist_regime";
    if (/revolutionary/.test(form)) return "revolutionary_government";
    if (/colonial|colony|protectorate|mandate/.test(form)) return "colonial_administration";
    return "unspecified";
};

const inferPoliticalRepresentation = ({ type = "", governmentForm = "", parties = [], powerBlocs = [] } = {}) => {
    const joined = `${clean(type)} ${clean(governmentForm)}`.toLocaleLowerCase();
    if (/absolute_monarchy|absolute monarchy|emirate|sultanate/.test(joined)) return POLITICAL_REPRESENTATIONS.COURT_FACTIONS;
    if (/one_party_state|one[- ]party|single[- ]party|party[- ]state/.test(joined)) return POLITICAL_REPRESENTATIONS.PARTY_STATE;
    if (/military_regime|military junta|military regime/.test(joined)) return POLITICAL_REPRESENTATIONS.MILITARY_FACTIONS;
    if (/revolutionary_government|revolutionary/.test(joined)) return POLITICAL_REPRESENTATIONS.REVOLUTIONARY_FACTIONS;
    if (/personalist_regime|personalist/.test(joined)) return POLITICAL_REPRESENTATIONS.ELITE_FACTIONS;
    if (/colonial_administration|colonial|colony|protectorate|mandate/.test(joined)) return POLITICAL_REPRESENTATIONS.COLONIAL;
    if (Array.isArray(parties) && parties.length) return POLITICAL_REPRESENTATIONS.ELECTORAL;
    if (Array.isArray(powerBlocs) && powerBlocs.length) return POLITICAL_REPRESENTATIONS.ELITE_FACTIONS;
    return POLITICAL_REPRESENTATIONS.NONE;
};

export const normalizePoliticalSystem = (value, { government = {}, parties = [], powerBlocs = [] } = {}) => {
    const source = typeof value === "string"
        ? { type: value }
        : (value && typeof value === "object" && !Array.isArray(value) ? value : {});
    const out = cloneActorValue(source);

    const explicitType = clean(source.type).toLocaleLowerCase().replace(/[ -]+/g, "_");
    const type = explicitType || inferPoliticalSystemType(government?.form);
    out.type = type || "unspecified";

    const explicitRepresentation = clean(source.representation).toLocaleLowerCase().replace(/[ -]+/g, "_");
    out.representation = POLITICAL_REPRESENTATION_SET.has(explicitRepresentation)
        ? explicitRepresentation
        : inferPoliticalRepresentation({ type: out.type, governmentForm: government?.form, parties, powerBlocs });

    const regimeCharacter = clean(source.regimeCharacter).toLocaleLowerCase().replace(/[ -]+/g, "_");
    if (POLITICAL_REGIME_CHARACTER_SET.has(regimeCharacter)) out.regimeCharacter = regimeCharacter;
    else delete out.regimeCharacter;

    for (const key of ["label", "notes"]) {
        const text = clean(source[key]);
        if (text) out[key] = text;
        else delete out[key];
    }

    return out;
};

const partyTokens = (party) => [
    party?.id,
    party?.name,
    party?.shortName,
    ...(Array.isArray(party?.aliases) ? party.aliases : []),
].map(clean).filter(Boolean);

export const resolvePoliticalParty = (actorOrWorld, polityOrToken, maybeToken) => {
    const actor = maybeToken === undefined
        ? actorOrWorld
        : getPoliticalProfile(actorOrWorld, polityOrToken);
    const token = maybeToken === undefined ? polityOrToken : maybeToken;
    if (!actor || !Array.isArray(actor.parties)) return null;
    const target = partyTokenKey(token);
    if (!target) return null;
    return actor.parties.find((party) =>
        partyTokens(party).some((candidate) => partyTokenKey(candidate) === target),
    ) || null;
};

const normalizePartyReferenceList = (value, parties, { deriveFromFlags = null } = {}) => {
    const source = cleanStringArray(value, 32);
    const ids = [];
    const unresolvedNames = [];
    const seen = new Set();

    for (const token of source) {
        const match = resolvePoliticalParty({ parties }, token);
        if (match) {
            if (!seen.has(match.id)) {
                seen.add(match.id);
                ids.push(match.id);
            }
        } else {
            const key = partyTokenKey(token);
            if (key && !seen.has(`name:${key}`)) {
                seen.add(`name:${key}`);
                unresolvedNames.push(token);
            }
        }
    }

    if (!ids.length && !unresolvedNames.length && deriveFromFlags) {
        for (const party of parties.filter((entry) => entry?.[deriveFromFlags] === true)) {
            if (!seen.has(party.id)) {
                seen.add(party.id);
                ids.push(party.id);
            }
        }
    }

    return { ids, unresolvedNames };
};

const partyDisplayNamesFromRefs = (ids, unresolvedNames, parties) => {
    const out = [];
    const seen = new Set();
    for (const id of ids) {
        const party = parties.find((entry) => entry.id === id);
        const name = clean(party?.name || id);
        const key = partyTokenKey(name);
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    for (const name of unresolvedNames) {
        const key = partyTokenKey(name);
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
};

export const normalizePoliticalGovernment = (value, parties = []) => {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const out = cloneActorValue(source);

    for (const key of ["form", "ideology", "status", "coalitionName"]) {
        const text = clean(source[key]);
        if (text) out[key] = text;
        else delete out[key];
    }

    const headOfState = normalizeOfficeholder(source.headOfState || source.headOfStateId);
    const headOfGovernment = normalizeOfficeholder(source.headOfGovernment || source.headOfGovernmentId);
    if (headOfState) out.headOfState = headOfState;
    else delete out.headOfState;
    if (headOfGovernment) out.headOfGovernment = headOfGovernment;
    else delete out.headOfGovernment;
    delete out.headOfStateId;
    delete out.headOfGovernmentId;

    for (const key of ["approval", "stability"]) {
        const number = clampPercent(source[key]);
        if (number != null) out[key] = number;
        else delete out[key];
    }

    const hasExplicitRulingRefs =
        Object.prototype.hasOwnProperty.call(source, "rulingPartyIds") ||
        Object.prototype.hasOwnProperty.call(source, "rulingParties") ||
        Object.prototype.hasOwnProperty.call(source, "rulingParty");
    const hasExplicitCoalitionRefs =
        Object.prototype.hasOwnProperty.call(source, "coalitionPartyIds") ||
        Object.prototype.hasOwnProperty.call(source, "coalition");

    const rulingTokens = [
        ...(Array.isArray(source.rulingPartyIds) ? source.rulingPartyIds : []),
        ...(Array.isArray(source.rulingParties) ? source.rulingParties : []),
        ...(clean(source.rulingParty) ? [source.rulingParty] : []),
    ];
    const coalitionTokens = [
        ...(Array.isArray(source.coalitionPartyIds) ? source.coalitionPartyIds : []),
        ...(Array.isArray(source.coalition) ? source.coalition : []),
    ];

    const ruling = normalizePartyReferenceList(rulingTokens, parties, {
        deriveFromFlags: hasExplicitRulingRefs ? null : "ruling",
    });
    const coalition = normalizePartyReferenceList(coalitionTokens, parties, {
        deriveFromFlags: hasExplicitCoalitionRefs ? null : "coalition",
    });

    out.rulingPartyIds = ruling.ids;
    out.coalitionPartyIds = coalition.ids;
    out.rulingParties = partyDisplayNamesFromRefs(ruling.ids, ruling.unresolvedNames, parties);
    out.coalition = partyDisplayNamesFromRefs(coalition.ids, coalition.unresolvedNames, parties);
    delete out.rulingParty;

    return out;
};

const officeholderIdentityKey = (value) => {
    const normalized = normalizeOfficeholder(value);
    const name = typeof normalized === "string" ? normalized : normalized?.name;
    return clean(name)
        .toLocaleLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, "");
};

const sameOfficeholder = (left, right) => {
    const leftKey = officeholderIdentityKey(left);
    const rightKey = officeholderIdentityKey(right);
    return Boolean(leftKey && rightKey && leftKey === rightKey);
};

// Formal office and operative political authority are not interchangeable.
// This native resolver deliberately uses regime structure rather than country
// names: parliamentary executives normally center the head of government;
// presidential and dynastic executives center the head of state; a distinct
// canonical supreme leader overrides either formal office. Semi-presidential
// systems retain both officeholders as participants while exposing one primary
// decision-maker for bounded AI context.
export const derivePoliticalDecisionAuthority = (actorLike) => {
    const actor = actorLike && typeof actorLike === "object" && !Array.isArray(actorLike)
        ? actorLike
        : {};
    const government = actor.government && typeof actor.government === "object" && !Array.isArray(actor.government)
        ? actor.government
        : {};
    const headOfState = normalizeOfficeholder(government.headOfState);
    const headOfGovernment = normalizeOfficeholder(government.headOfGovernment);
    const leader = normalizeOfficeholder(actor.leader);
    const systemText = `${clean(actor?.politicalSystem?.type)} ${clean(actor?.politicalSystem?.representation)} ${clean(government.form)}`
        .toLocaleLowerCase()
        .replace(/[ -]+/g, "_");
    const distinctLeader = Boolean(
        leader &&
        !sameOfficeholder(leader, headOfState) &&
        !sameOfficeholder(leader, headOfGovernment)
    );
    const parliamentaryExecutive = /parliamentary|constitutional_monarchy/.test(systemText)
        && !/absolute_monarchy/.test(systemText);
    const semiPresidentialExecutive = /semi_presidential/.test(systemText);
    const presidentialExecutive = /presidential/.test(systemText) && !semiPresidentialExecutive;
    const centralizedExecutive = /one_party|party_state|personalist|military|absolute_monarchy|theocratic/.test(systemText);

    let primary = "";
    let role = "";
    let model = "unspecified-executive";
    let basis = "fallback";
    let confidence = "low";

    if (distinctLeader) {
        primary = leader;
        role = "supreme-political-leader";
        model = centralizedExecutive ? "centralized-executive" : "supreme-leader-over-formal-offices";
        basis = "distinct-canonical-leader";
        confidence = "high";
    } else if (parliamentaryExecutive && headOfGovernment) {
        primary = headOfGovernment;
        role = "head-of-government";
        model = "parliamentary-executive";
        basis = "political-system";
        confidence = "high";
    } else if (semiPresidentialExecutive) {
        primary = leader || headOfState || headOfGovernment;
        role = sameOfficeholder(primary, headOfGovernment) ? "head-of-government" : "head-of-state";
        model = headOfState && headOfGovernment && !sameOfficeholder(headOfState, headOfGovernment)
            ? "shared-semi-presidential-executive"
            : "semi-presidential-executive";
        basis = leader ? "canonical-leader-with-system" : "political-system";
        confidence = leader ? "high" : "moderate";
    } else if (presidentialExecutive) {
        primary = headOfState || leader || headOfGovernment;
        role = sameOfficeholder(primary, headOfGovernment) && !sameOfficeholder(primary, headOfState)
            ? "head-of-government"
            : "head-of-state";
        model = "presidential-executive";
        basis = "political-system";
        confidence = "high";
    } else if (centralizedExecutive) {
        primary = leader || headOfState || headOfGovernment;
        role = sameOfficeholder(primary, headOfState)
            ? "head-of-state"
            : (sameOfficeholder(primary, headOfGovernment) ? "head-of-government" : "supreme-political-leader");
        model = "centralized-executive";
        basis = leader ? "canonical-leader-with-system" : "political-system";
        confidence = leader ? "high" : "moderate";
    } else {
        primary = leader || headOfGovernment || headOfState;
        role = sameOfficeholder(primary, headOfGovernment)
            ? "head-of-government"
            : (sameOfficeholder(primary, headOfState) ? "head-of-state" : "political-leader");
        basis = leader ? "canonical-leader" : "available-formal-office";
        confidence = leader ? "moderate" : "low";
    }

    if (!primary) return null;

    const participants = [];
    const addParticipant = (officeholder, participantRole) => {
        if (!officeholder) return;
        if (participants.some((entry) => sameOfficeholder(entry.officeholder, officeholder))) return;
        participants.push({ officeholder: cloneActorValue(officeholder), role: participantRole });
    };
    addParticipant(primary, role);
    if (semiPresidentialExecutive) {
        addParticipant(headOfState, "head-of-state");
        addParticipant(headOfGovernment, "head-of-government");
    }

    return {
        primary: cloneActorValue(primary),
        role,
        model,
        basis,
        confidence,
        participants,
    };
};

export const normalizePoliticalActorRecord = (value, fallbackPolityKey = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = cloneActorValue(value);
    const polityKey = clean(value.polityKey || fallbackPolityKey);
    if (polityKey) out.polityKey = polityKey;

    const parties = [];
    const seenIds = new Set();
    for (const [index, rawParty] of (Array.isArray(value.parties) ? value.parties : []).entries()) {
        const party = normalizePoliticalParty(rawParty, { index });
        if (!party) continue;
        let id = party.id;
        if (seenIds.has(id)) {
            id = `${id}-${stableTextHash(`${party.name}:${index}`)}`;
            party.id = id;
        }
        seenIds.add(id);
        parties.push(party);
    }

    const governmentSource = value.government && typeof value.government === "object" && !Array.isArray(value.government)
        ? value.government
        : {};
    // A few very early experiments put ideology at actor root. Fold it into the
    // government layer without treating national interests as government ideology.
    const government = normalizePoliticalGovernment(
        governmentSource.ideology || !clean(value.ideology)
            ? governmentSource
            : { ...governmentSource, ideology: value.ideology },
        parties,
    );

    const rulingIds = new Set(government.rulingPartyIds || []);
    const coalitionIds = new Set(government.coalitionPartyIds || []);
    for (const party of parties) {
        if (rulingIds.has(party.id)) party.ruling = true;
        else delete party.ruling;
        if (coalitionIds.has(party.id)) party.coalition = true;
        else delete party.coalition;
    }

    const powerBlocs = [];
    const seenBlocIds = new Set();
    for (const [index, rawBloc] of (Array.isArray(value.powerBlocs) ? value.powerBlocs : []).entries()) {
        const bloc = normalizePoliticalPowerBloc(rawBloc, { index });
        if (!bloc) continue;
        let id = bloc.id;
        if (seenBlocIds.has(id)) {
            id = `${id}-${stableTextHash(`${bloc.name}:${index}`)}`;
            bloc.id = id;
        }
        seenBlocIds.add(id);
        powerBlocs.push(bloc);
    }

    out.government = government;
    out.parties = parties;
    out.powerBlocs = powerBlocs;
    out.politicalSystem = normalizePoliticalSystem(value.politicalSystem, {
        government,
        parties,
        powerBlocs,
    });

    const leader = normalizeOfficeholder(value.leader || government.headOfState);
    if (leader) out.leader = leader;
    else delete out.leader;

    for (const key of ["goals", "fears", "ambitions", "domesticPressures", "tags"]) {
        const list = cleanStringArray(value[key], key === "tags" ? 24 : 32);
        if (list.length) out[key] = list;
        else delete out[key];
    }

    for (const key of ["traits", "perceptions"]) {
        const record = normalizeMetricRecord(value[key], {
            clampNumeric: key !== "perceptions",
        });
        if (Object.keys(record).length) out[key] = record;
        else delete out[key];
    }

    const behavioralDisposition = normalizePoliticalBehavioralDisposition(value.behavioralDisposition);
    if (behavioralDisposition) out.behavioralDisposition = behavioralDisposition;
    else delete out.behavioralDisposition;

    const politicalPressures = normalizePoliticalPressureState(value.politicalPressures);
    if (Object.keys(politicalPressures.issues).length || politicalPressures.updatedAt) {
        out.politicalPressures = politicalPressures;
    } else {
        delete out.politicalPressures;
    }

    const name = clean(value.name);
    if (name) out.name = name;
    else delete out.name;

    // Top-level ideology is an old compatibility input, never a second owner.
    delete out.ideology;

    return out;
};

export function normalizePoliticalActors(input) {
    const source = input && typeof input === "object" ? input : {};
    const byPolity = {};
    if (source.byPolity && typeof source.byPolity === "object" && !Array.isArray(source.byPolity)) {
        for (const [rawKey, rawActor] of Object.entries(source.byPolity)) {
            const key = clean(rawKey);
            if (!key || !rawActor || typeof rawActor !== "object" || Array.isArray(rawActor)) continue;
            const actor = normalizePoliticalActorRecord(rawActor, key);
            if (actor) byPolity[key] = actor;
        }
    }
    return {
        schemaVersion: POLITICAL_ACTORS_SCHEMA_VERSION,
        byPolity,
    };
}

function candidatesForPolity(world, key) {
    if (!key) return [];
    const out = [key];
    const override = world?.polityOverrides?.[key];
    if (override?.name) out.push(override.name);
    for (const [candidateKey, candidate] of Object.entries(world?.polityOverrides || {})) {
        if (candidateKey === key || candidate?.name === key || candidate?.aliases?.includes?.(key)) {
            out.push(candidateKey, candidate?.name, ...(candidate?.aliases || []));
        }
    }
    return [...new Set(out.filter(Boolean))];
}

export function getPoliticalProfile(world, polityKey) {
    const byPolity = world?.politicalActors?.byPolity;
    if (!byPolity) return null;

    const normalizeActorKey = (value) =>
        String(value ?? "")
            .trim()
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\p{L}\p{N}]+/gu, "");

    for (const candidate of candidatesForPolity(world, polityKey)) {
        if (byPolity[candidate]) return byPolity[candidate];
    }

    const normalizedTargetKeys = new Set(
        candidatesForPolity(world, polityKey).map(normalizeActorKey).filter(Boolean),
    );

    for (const [actorKey, actor] of Object.entries(byPolity)) {
        if (normalizedTargetKeys.has(normalizeActorKey(actorKey))) return actor;
        if (actor?.polityKey && normalizedTargetKeys.has(normalizeActorKey(actor.polityKey))) return actor;
        if (actor?.name && normalizedTargetKeys.has(normalizeActorKey(actor.name))) return actor;
    }

    const candidates = new Set(candidatesForPolity(world, polityKey));
    for (const actor of Object.values(byPolity)) {
        if (!actor || typeof actor !== "object") continue;
        if (actor.polityKey && candidates.has(actor.polityKey)) return actor;
    }

    for (const [actorKey, actor] of Object.entries(byPolity)) {
        if (candidates.has(actorKey)) return actor;
    }

    const stockCode = resolveStockCountryCode(polityKey);
    if (stockCode) {
        for (const [actorKey, actor] of Object.entries(byPolity)) {
            const actorTokens = [actorKey, actor?.polityKey, actor?.name].filter(Boolean);
            if (actorTokens.some((token) => resolveStockCountryCode(token) === stockCode)) return actor;
        }
    }

    return null;
}

export const getPoliticalProfileKey = (world, polityKey) => {
    const byPolity = world?.politicalActors?.byPolity;
    if (!byPolity) return "";
    const actor = getPoliticalProfile(world, polityKey);
    if (!actor) return "";
    for (const [key, candidate] of Object.entries(byPolity)) {
        if (candidate === actor) return key;
    }
    return clean(actor.polityKey || polityKey);
};

export const ensurePoliticalProfile = (world, polityKey) => {
    if (!world || typeof world !== "object") return null;
    const key = clean(polityKey);
    if (!key) return null;
    const normalized = normalizePoliticalActors(world.politicalActors);
    world.politicalActors = normalized;
    const existing = getPoliticalProfile(world, key);
    if (existing) return existing;
    normalized.byPolity[key] = normalizePoliticalActorRecord({ polityKey: key, government: {}, parties: [] }, key);
    return normalized.byPolity[key];
};

// Legacy migration/helper only. New event impacts MUST mutate political reality
// through politicalActorOps (see politicalActorOps.js), never by guessing an office
// from Stats metadata. Kept for explicit old-save/data migrations that already
// encoded a single ambiguous `leader` field. Normal event application does not call
// this seam.
export function applyPoliticalActorMetadataPatch(world, polityKey, patch) {
    if (!world || !patch || typeof patch !== "object" || Array.isArray(patch)) return null;
    const actor = getPoliticalProfile(world, polityKey);
    if (!actor || typeof actor !== "object") return null;

    const leader = clean(patch.leader);
    const government = clean(patch.government);

    if (leader) {
        actor.leader = leader;
        actor.government = normalizePoliticalGovernment({
            ...(actor.government && typeof actor.government === "object" ? actor.government : {}),
            headOfState: leader,
        }, actor.parties || []);
    }

    if (government) {
        actor.government = normalizePoliticalGovernment({
            ...(actor.government && typeof actor.government === "object" ? actor.government : {}),
            form: government,
        }, actor.parties || []);
    }

    return actor;
}

// One-way compatibility projection for legacy Stats consumers. Political Actors
// remain the write authority; this helper merely exposes the canonical government
// form and head of state in the old sheet vocabulary when such a sheet already
// exists. Head of government is intentionally NOT collapsed into `leader`: the old
// field is singular and therefore cannot safely represent both offices.
export function buildPoliticalActorLegacyStatsProjection(world, polityKey) {
    const actor = getPoliticalProfile(world, polityKey);
    if (!actor || typeof actor !== "object") return {};
    const government = actor.government && typeof actor.government === "object"
        ? actor.government
        : {};
    const officeholderName = (value) => {
        if (typeof value === "string") return clean(value);
        if (!value || typeof value !== "object" || Array.isArray(value)) return "";
        return clean(value.name || value.id);
    };
    const projection = {};
    const form = clean(government.form);
    const headOfState = officeholderName(government.headOfState || actor.leader);
    if (form) projection.government = form;
    if (headOfState) projection.leader = headOfState;
    return projection;
}
