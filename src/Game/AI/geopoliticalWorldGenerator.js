/*! Open Historia Continuum — universal geopolitical substrate generator */

import { callAI } from "./main.jsx";
import { parseGeopoliticalArrayText } from "./geopoliticalJsonTransport.js";
import { resolveGeopoliticalMembershipCoverage } from "./geopoliticalMembershipCoverage.js";
import { resolveScenarioInstitutionReferenceCatalog } from "./institutionReferenceCatalogs.js";
import { applyDiplomaticUpdates } from "./nativeDiplomaticDirector.js";
import {
  applyInstitutionUpdates,
  canonicalInstitutionIdentity,
  findInstitutionIdentityMatch,
  institutionIdentityTokens,
  INSTITUTION_KINDS,
  INSTITUTION_ABSTENTION_POLICIES,
  INSTITUTION_MEMBER_STATUSES,
  INSTITUTION_VOTING_RULE_TYPES,
  normalizeInstitutionRecord,
  normalizeInstitutions,
  validateInstitutionTemporalBaseline,
} from "../../runtime/institutions.js";
import {
  isFinitePowerScore,
  POWER_MAJOR_SCORE_MIN,
  POWER_REGIONAL_SCORE_MIN,
  refreshPowerStatus,
  seedPowerBaselineScore,
} from "../../runtime/powerStatus.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import {
  applyGeopoliticalInstitutionGovernanceBaseline,
  geopoliticalInstitutionGovernanceTargets,
  normalizeGeopoliticalInstitutionGovernancePayload,
} from "./geopoliticalInstitutionGovernance.js";

export const GEOPOLITICAL_WORLD_BATCH_SIZE = 24;
export const GEOPOLITICAL_WORLD_SCHEMA_VERSION = 2;
export const GEOPOLITICAL_REGIME_CHARACTERS = Object.freeze([
  "democratic",
  "hybrid",
  "authoritarian",
  "totalitarian",
  "theocratic",
  "military",
  "colonial",
  "other",
]);
const REGIME_CHARACTER_SET = new Set(GEOPOLITICAL_REGIME_CHARACTERS);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const geopoliticalHistoryAuthorityBlock = (historyAuthority, scenarioDate) => {
  const target = clean(scenarioDate);
  const cutoff = clean(historyAuthority?.cutoffDate);
  if (!historyAuthority || typeof historyAuthority !== "object") {
    return `TARGET WORLD DATE: ${target}. External/reference chronology may be used only through that target date; later external chronology has zero authority.`;
  }
  if (historyAuthority.referenceAllowed && cutoff) {
    if (historyAuthority.cutoffInclusive) {
      return `TARGET WORLD DATE: ${target}. EXTERNAL/REFERENCE AUTHORITY: admissible only THROUGH ${cutoff}. Scenario-authored/derived canon and explicit current world state outrank conflicting reference material.`;
    }
    return `TARGET WORLD DATE: ${target}. EXTERNAL/REFERENCE AUTHORITY: admissible only BEFORE ${cutoff}; ${cutoff} itself and everything after it belong to scenario/derived canon. Never reconstruct the target world from remembered post-boundary reference chronology.`;
  }
  return `TARGET WORLD DATE: ${target}. EXTERNAL/REFERENCE AUTHORITY: NONE. Use only scenario-authored/derived canon and explicit current world state; do not import another timeline or universe.`;
};
const slug = (value) => lower(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const shallowTool = (name, description, properties, required) => Object.freeze({
  name,
  description,
  schema: Object.freeze({ type: "object", properties, required, additionalProperties: false }),
});

export const GEOPOLITICAL_INSTITUTION_CATALOG_TOOL = shallowTool(
  "submit_geopolitical_institution_catalog",
  "Submit the exact-date global catalog of strategically relevant formal institutions. Nested records travel as JSON text.",
  { institutionsJson: { type: "string", description: "JSON array text of active/relevant institutions; no memberships." } },
  ["institutionsJson"],
);

export const GEOPOLITICAL_INSTITUTION_GOVERNANCE_TOOL = shallowTool(
  "submit_geopolitical_institution_governance",
  "Submit exact-date decision rules for the requested canonical institutions. Native code preserves already-authored governance and fails closed on uncertainty.",
  { governanceJson: { type: "string", description: "JSON array text: institutionId, votingRule, proposalRules, note. Return one row per requested institution." } },
  ["governanceJson"],
);

export const GEOPOLITICAL_POWER_CALIBRATION_TOOL = shallowTool(
  "submit_geopolitical_power_calibration",
  "Submit one era-relative strategic baseline score for every requested polity. Native code, not the model, converts scores into power tiers.",
  { powerJson: { type: "string", description: "JSON array text: polityKey, strategicWeight (0-100), note." } },
  ["powerJson"],
);

// A one-polity recovery should not force the provider through the brittle
// "JSON array serialized inside a string field" transport used by normal
// batches. Providers routinely collapse a one-element array to an object or
// decorate the string despite a required tool call. Give singleton recovery a
// scalar structured tool instead; the semantic contract is identical and
// native code still owns the final tier.
export const GEOPOLITICAL_POWER_SINGLETON_TOOL = shallowTool(
  "submit_geopolitical_power_record",
  "Submit the era-relative strategic baseline score for exactly one requested canonical polity. Native code, not the model, converts the score into a power tier.",
  {
    polityKey: { type: "string", description: "Exact requested canonical polity key." },
    strategicWeight: { type: "number", description: "Era-relative strategic weight from 0 to 100." },
    note: { type: "string", description: "Brief basis for the score." },
  },
  ["polityKey", "strategicWeight"],
);

export const GEOPOLITICAL_MEMBERSHIP_TOOL = shallowTool(
  "submit_geopolitical_memberships",
  "Submit exact-date formal memberships referencing only the fixed institution catalog, plus regimeCharacter only where canonical Political Actors do not already provide it.",
  { politiesJson: { type: "string", description: "JSON array text: one record per requested polity with memberships[] and regimeCharacter when not already canonical." } },
  ["politiesJson"],
);

export const GEOPOLITICAL_INSTITUTION_MEMBERS_TOOL = shallowTool(
  "submit_geopolitical_institution_members",
  "Submit the complete exact-date positive member set for one fixed canonical institution. Omitted active polities are treated as non-members for this institution only.",
  { membersJson: { type: "string", description: "JSON array text of positive members only: polityKey, status, role, joinedDate, note." } },
  ["membersJson"],
);

export const GEOPOLITICAL_AGREEMENTS_TOOL = shallowTool(
  "submit_geopolitical_agreements",
  "Submit strategically important active formal agreements not already represented by institution membership.",
  { agreementsJson: { type: "string", description: "JSON array text of active formal agreements." } },
  ["agreementsJson"],
);

const parseArrayText = (value) => parseGeopoliticalArrayText(value);

const toolSource = (response) => response?.toolInput && typeof response.toolInput === "object"
  ? response.toolInput
  : response && typeof response === "object" && !Array.isArray(response) ? response : null;

const canonicalPolity = (value, world, allowedByLower) => {
  const token = clean(value);
  if (!token) return "";
  const direct = allowedByLower.get(lower(token));
  if (direct) return direct;
  const resolved = resolvePolityIdentity(token, world || {}, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  const canonical = clean(resolved?.resolved);
  return allowedByLower.get(lower(canonical)) || "";
};

const dateKey = (value, edge = "start") => {
  const text = clean(value);
  const match = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
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

const actorSummary = (world, polity) => {
  const actor = world?.politicalActors?.byPolity?.[polity] || {};
  const system = clean(actor?.politicalSystem?.type || actor?.government?.form);
  const representation = clean(actor?.politicalSystem?.representation);
  const regimeCharacter = lower(actor?.politicalSystem?.regimeCharacter);
  const legacyTags = array(world?.countryTags?.[polity]).join(", ");
  return `${polity}${system ? ` | system: ${system}` : ""}${representation ? ` | representation: ${representation}` : ""}${REGIME_CHARACTER_SET.has(regimeCharacter) ? ` | canonical regimeCharacter: ${regimeCharacter}` : ""}${legacyTags ? ` | authored descriptors: ${legacyTags}` : ""}`;
};

const lineageSummary = (institution) => array(institution?.predecessors)
  .filter((entry) => entry?.membershipContinuity === true)
  .map((entry) => `${clean(entry.name || entry.id)}${entry.foundedDate ? ` ${entry.foundedDate}` : ""}${entry.dissolvedDate ? `→${entry.dissolvedDate}` : ""}`)
  .filter(Boolean)
  .join("; ");

const existingInstitutionSummary = (world) => Object.values(normalizeInstitutions(world?.institutions, world).byId)
  .slice(0, 64)
  .map((institution) => `- ${institution.name} [${institution.id}] | ${institution.kind}${institution.foundedDate ? ` | founded ${institution.foundedDate}` : ""}${institution.dissolvedDate ? ` | dissolved ${institution.dissolvedDate}` : ""}${lineageSummary(institution) ? ` | predecessor continuity: ${lineageSummary(institution)}` : ""}`)
  .join("\n")
  .slice(0, 11000);

const catalogSummary = (catalog) => array(catalog)
  .map((institution) => `- [${institution.id}] ${institution.name}${institution.shortName ? ` (${institution.shortName})` : ""} | ${institution.kind}${institution.foundedDate ? ` | founded ${institution.foundedDate}` : ""}${institution.dissolvedDate ? ` | dissolved ${institution.dissolvedDate}` : ""}${lineageSummary(institution) ? ` | membership continuity via: ${lineageSummary(institution)}` : ""}`)
  .join("\n")
  .slice(0, 18000);

const callTool = async ({ callModel, systemPrompt, userMessage, tool, signal, logLabel }) => {
  const response = await callModel(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
    signal,
    reasoningEnabled: false,
    taskKey: "politicalWorldGeneration",
    logLabel,
    tool,
  });
  const source = toolSource(response);
  if (!source) throw new Error(`${logLabel} returned no tool payload`);
  return source;
};

const mergeInstitutionReference = (generated = {}, reference = null) => {
  if (!reference) return generated;
  return {
    ...generated,
    id: reference.id || generated.id,
    name: reference.name || generated.name,
    shortName: reference.shortName || generated.shortName,
    aliases: [...new Set([...array(reference.aliases), ...array(generated.aliases)])],
    kind: reference.kind || generated.kind,
    foundedDate: reference.foundedDate || generated.foundedDate,
    dissolvedDate: reference.dissolvedDate || generated.dissolvedDate,
    predecessors: array(reference.predecessors).length ? reference.predecessors : generated.predecessors,
    badgeKey: reference.badgeKey || generated.badgeKey,
    priority: Number.isFinite(Number(reference.priority)) && Number(reference.priority) > 0
      ? Number(reference.priority)
      : generated.priority,
  };
};

const normalizeCatalogInstitution = (value, {
  world = {},
  scenarioDate = "",
  warnings = [],
  existingInstitutions = null,
  references = [],
} = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawIdentityText = lower([value.id, value.name, value.shortName, ...array(value.aliases)].filter(Boolean).join(" "));
  // A formal institution is one canonical global entity, never a generated
  // country/member slice. This is a structural rule and is universe-agnostic.
  if (/(^|[-\s])(membership|memberships|member-state|member-states|member)([-\s]|$)/.test(rawIdentityText)) {
    warnings.push(`${clean(value.name || value.id || "Institution")}: rejected membership-shaped institution identity.`);
    return null;
  }

  const existingLedger = existingInstitutions || normalizeInstitutions(world?.institutions, world);
  const existingMatch = findInstitutionIdentityMatch(value, Object.values(existingLedger.byId));
  if (existingMatch) return existingMatch;

  const referenceMatch = findInstitutionIdentityMatch(value, references);
  const merged = mergeInstitutionReference(value, referenceMatch);
  const identity = canonicalInstitutionIdentity(merged);
  if (!identity.id || !identity.name) return null;
  const temporal = validateInstitutionTemporalBaseline({
    institution: { ...merged, ...identity },
    scenarioDate,
  });
  if (!temporal.valid) {
    warnings.push(`${identity.name}: dropped temporally invalid catalog entry for ${scenarioDate}: ${temporal.reason}.`);
    return null;
  }
  return normalizeInstitutionRecord({
    ...merged,
    ...identity,
    foundedDate: temporal.foundedDate,
    dissolvedDate: temporal.dissolvedDate,
    members: [],
    leaders: [],
    status: "active",
  }, identity.id, world);
};

const buildCatalogIdentityIndex = (catalog = []) => {
  const byToken = new Map();
  for (const institution of array(catalog)) {
    for (const token of institutionIdentityTokens(institution)) {
      if (!byToken.has(token)) byToken.set(token, institution);
      else if (byToken.get(token)?.id !== institution.id) byToken.set(token, null);
    }
  }
  return byToken;
};

const normalizeMembership = (value, { catalogById, catalogByToken, scenarioDate, warnings, polityKey } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawId = slug(value.institutionId || value.id || value.name);
  let institution = catalogById.get(rawId) || null;
  if (!institution && rawId) institution = catalogByToken?.get(rawId) || null;
  if (!institution) {
    warnings.push(`${polityKey}: rejected membership referencing institution outside fixed catalog: ${rawId || "<blank>"}.`);
    return null;
  }
  if (rawId && rawId !== institution.id) {
    warnings.push(`${polityKey}: normalized unique institution alias ${rawId} to canonical catalog id ${institution.id}.`);
  }
  const status = lower(value.status || "member");
  const role = lower(value.role || "member");
  if (!INSTITUTION_MEMBER_STATUSES.includes(status)) return null;
  if (!["leader", "leading-member", "member"].includes(role)) return null;
  const joinedDate = clean(value.joinedDate || value.sinceDate || value.statusSinceDate);
  const temporal = validateInstitutionTemporalBaseline({
    institution,
    scenarioDate,
    membershipDate: joinedDate,
    allowUnknownMembershipDateFallback: true,
  });
  if (!temporal.valid) {
    warnings.push(`${polityKey}: dropped ${institution.name} membership: ${temporal.reason}.`);
    return null;
  }
  if (temporal.warning) warnings.push(`${polityKey}: ${institution.name} membership: ${temporal.warning}.`);
  return {
    institutionId: institution.id,
    status,
    role,
    joinedDate: clean(temporal.membershipDate ?? joinedDate),
    note: clean(value.note).slice(0, 300),
  };
};

const normalizeAgreement = (value, world, allowedByLower, scenarioDate, warnings = []) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parties = array(value.parties).map((entry) => canonicalPolity(entry, world, allowedByLower)).filter(Boolean);
  const uniqueParties = [...new Set(parties)];
  if (uniqueParties.length < 2) return null;
  const type = lower(value.type).replace(/[\s-]+/g, "_");
  const allowedTypes = ["alliance", "mutual_defense", "guarantee", "non_aggression", "friendship_consultation", "trade_economic", "military_cooperation", "military_access", "neutrality", "peace_settlement", "other"];
  const id = slug(value.id || value.title || uniqueParties.join("-"));
  if (!id || !allowedTypes.includes(type)) return null;
  const startedDate = clean(value.startedDate || value.startDate || value.effectiveDate);
  const endedDate = clean(value.endedDate || value.endDate || value.expiredDate);
  const scenarioKey = dateKey(scenarioDate, "start");
  const startedKey = dateKey(startedDate, "start");
  const endedKey = dateKey(endedDate, "end");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedDate) || !startedKey) {
    warnings.push(`${clean(value.title || id)}: dropped generated agreement without an exact YYYY-MM-DD startedDate.`);
    return null;
  }
  if (endedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endedDate) || !endedKey)) {
    warnings.push(`${clean(value.title || id)}: dropped generated agreement with unusable endedDate ${endedDate}.`);
    return null;
  }
  if (scenarioKey && startedKey > scenarioKey) {
    warnings.push(`${clean(value.title || id)}: dropped generated agreement that starts after ${scenarioDate}.`);
    return null;
  }
  if (scenarioKey && endedKey && scenarioKey >= endedKey) {
    warnings.push(`${clean(value.title || id)}: dropped generated agreement already ended by ${scenarioDate}.`);
    return null;
  }
  return {
    id,
    op: "start",
    type,
    parties: uniqueParties,
    eventIndexes: [],
    eventIds: [],
    title: clean(value.title || id).slice(0, 180),
    terms: clean(value.terms || value.note).slice(0, 600),
    startedDate,
    endedDate,
  };
};

const buildCatalogPrompt = ({
  scenarioDate,
  historyAuthority = null,
  world,
  scenarioContext,
  allPolityKeys,
  references = [],
  acceptedCatalog = [],
  completenessPass = false,
}) => ({
  systemPrompt: `You build OpenHistoria's GLOBAL FORMAL-INSTITUTION CATALOG at Round Zero.

${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Include only strategically relevant formal institutions/blocs active on the TARGET WORLD DATE. Never project a current institution name backward onto a predecessor era or otherwise project an external/reference institution identity across the permitted reference boundary. Structured scenario-authored institutions are authoritative.

UNIVERSE RULE: infer institutions from THIS scenario's canon. Do not assume modern Earth if the scenario is alternate, fictional, future, or otherwise divergent. Core OpenHistoria logic is universe-agnostic; your catalog must describe the institutions that actually exist in this world.

${completenessPass ? "COMPLETENESS PASS: an initial catalog already exists. Return ONLY materially relevant active institutions missing from that catalog. Do not repeat an existing identity or alias. Return an empty array if nothing material is missing." : "This is the initial catalog pass. Return each institution exactly once."}

Do NOT encode a membership or geographic/member subgroup in an institution id. Invalid patterns include ids ending in member, membership, member-state, regional-members, or a member polity name. One institution must have one canonical identity.

SUCCESSOR / PREDECESSOR RULE: when an institution active on ${scenarioDate} is the legal/organizational successor of an earlier institution and membership genuinely carried forward, describe that history in predecessors[]. Each predecessor is data, never a special case. Use membershipContinuity=false when succession did NOT automatically preserve membership. Keep predecessor data concise; omit speculative lineage rather than inventing it.

Include security alliances, defense pacts, political/economic unions and regional blocs that materially shape geopolitical behavior. Do not return memberships in this phase.

kind must be one of ${INSTITUTION_KINDS.join(" | ")}. Every generated institution needs a valid foundedDate when known and dissolvedDate when applicable. Use a concise canonical id derived from the institution itself, never from a member country. No prose outside the tool.`,
  userMessage: `Scenario context:
${clean(scenarioContext).slice(0, 6000) || "(none)"}

Existing structured institutions (authoritative; do not duplicate):
${existingInstitutionSummary(world) || "(none)"}

Scenario-selected institution reference data (advisory; never override structured scenario canon):
${catalogSummary(references) || "(none)"}

${acceptedCatalog.length ? `Already accepted catalog identities — DO NOT repeat these:
${catalogSummary(acceptedCatalog)}

` : ""}Active polity vocabulary:
${allPolityKeys.join(" | ").slice(0, 16000)}

Return institutionsJson as a JSON array of {"id":"canonical institution id","name":"canonical name","shortName":"common abbreviation or blank","aliases":[],"kind":"...","foundedDate":"...","dissolvedDate":"","predecessors":[{"id":"...","name":"...","shortName":"","aliases":[],"foundedDate":"...","dissolvedDate":"...","membershipContinuity":true}],"badgeKey":"short token or blank","priority":0-100,"note":"short purpose"}. No members.`,
});

const buildPowerPrompt = ({ scenarioDate, historyAuthority = null, world, scenarioContext, requestedPolities, allPolityKeys, accepted = [], singleton = false }) => ({
  systemPrompt: `You provide ERA-RELATIVE STRATEGIC BASELINE EVIDENCE for OpenHistoria. Native code owns and computes the final major-power/regional-power/minor-power tier; you MUST NOT return a tier.\n\n${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Compare actors against the other active polities in THIS scenario and THIS era, not thresholds remembered from another canon. strategicWeight is an integer 0-100 estimate of underlying sovereign capacity/reach at Round Zero, before bonuses from formal-institution leadership or campaign events. Native score boundaries are ${POWER_MAJOR_SCORE_MIN}+ for major-power candidacy and ${POWER_REGIONAL_SCORE_MIN}-${POWER_MAJOR_SCORE_MIN - 1} for regional-power candidacy, so calibrate the evidence to those boundaries rather than using a conflicting prose scale. Reserve ${POWER_MAJOR_SCORE_MIN}+ for actors with genuinely major, independently system-shaping or sustained cross-regional/global sovereign reach; ordinary regional importance, alliance membership, diplomatic activism, or being a strong local state is NOT enough by itself. Roughly 85-100 should remain the tiny handful of exceptional system-shaping powers. Use ${POWER_REGIONAL_SCORE_MIN}-${POWER_MAJOR_SCORE_MIN - 1} for meaningful regional powers and below ${POWER_REGIONAL_SCORE_MIN} for smaller/local actors. Do not make every country cluster around the middle.\n\nUse political/military/economic/diplomatic capacity appropriate to the era. This is an approximate Round-Zero prior, not a permanent truth. No prose outside the tool.`,
  userMessage: `Scenario context:\n${clean(scenarioContext).slice(0, 5000) || "(none)"}\n\nFull active polity vocabulary for relative comparison:\n${allPolityKeys.join(" | ").slice(0, 16000)}\n\n${accepted.length ? `Already accepted calibration anchors from earlier accepted batches:\n${accepted.map((entry) => `${entry.polityKey}:${entry.strategicWeight}`).join(" | ").slice(0, 8000)}\n\n` : ""}Return exactly one record for each requested polity below:\n${requestedPolities.map((polity) => `- ${actorSummary(world, polity)}`).join("\n")}\n\n${singleton ? "This is a ONE-POLITY recovery. Submit the direct tool fields polityKey, strategicWeight, and note. Do not serialize them into powerJson and do not wrap them in an array." : 'powerJson = [{"polityKey":"exact key","strategicWeight":0-100,"note":"brief basis"}].'}`,
});

const compactMembershipCatalogSummary = (catalog) => array(catalog)
  .map((institution) => `[${institution.id}] ${institution.shortName || institution.name}`)
  .join(" | ")
  .slice(0, 9000);

const existingInstitutionMembers = (institution) => Object.entries(institution?.members || {})
  .filter(([, membership]) => membership && membership.status !== "left")
  .map(([polity]) => clean(polity))
  .filter(Boolean);

const buildInstitutionMembersPrompt = ({ scenarioDate, historyAuthority = null, institution, world, scenarioContext, allPolityKeys }) => ({
  systemPrompt: `You resolve the COMPLETE positive formal membership set for exactly ONE canonical institution in OpenHistoria.

${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Structured scenario canon outranks external/reference material.

UNIVERSE RULE: resolve only the institution supplied below and only against the supplied active polity vocabulary. The scenario may be historical, alternate-history, future, or fictional. Do not import other institutions or another universe.

OUTPUT SEMANTICS: return ONLY positive members/participants/observers/etc. of this one institution on ${scenarioDate}. Every active polity omitted from membersJson is interpreted as a NON-MEMBER of this institution on this date, so completeness matters. Do not omit a real member just because the exact accession date is uncertain; leave joinedDate blank instead.

status must be ${INSTITUTION_MEMBER_STATUSES.join(" | ")}; role leader|leading-member|member. No prose outside the tool.`,
  userMessage: `Scenario context:
${clean(scenarioContext).slice(0, 5000) || "(none)"}

Canonical institution:
[${institution.id}] ${institution.name}${institution.shortName ? ` (${institution.shortName})` : ""} | ${institution.kind}${institution.foundedDate ? ` | founded ${institution.foundedDate}` : ""}${institution.dissolvedDate ? ` | dissolved ${institution.dissolvedDate}` : ""}${lineageSummary(institution) ? ` | predecessor continuity: ${lineageSummary(institution)}` : ""}

Already staged positive members (preserve these unless scenario canon itself says otherwise):
${existingInstitutionMembers(institution).join(" | ") || "(none)"}

Active polity vocabulary (${allPolityKeys.length}):
${allPolityKeys.join(" | ").slice(0, 20000)}

membersJson = [{"polityKey":"EXACT active polity key","status":"member","role":"member","joinedDate":"YYYY-MM-DD or blank","note":"brief/blank"}]. Return [] if this institution truly has no positive members among the active polities.`,
});

const buildMembershipPrompt = ({ scenarioDate, historyAuthority = null, batch, world, scenarioContext, catalog, recovery = false }) => {
  if (recovery) {
    return {
      systemPrompt: `OpenHistoria membership COVERAGE RECOVERY for ${scenarioDate}. ${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Return EXACTLY one row for every requested polity. Do not omit a polity because it has no memberships or because an accession date is uncertain. Use only exact institution ids from the closed catalog. If membership exists but the exact joinedDate is uncertain, leave joinedDate blank. Keep notes blank/minimal. Preserve an already supplied canonical regimeCharacter; otherwise classify it. No prose outside the tool.`,
      userMessage: `Closed institution ids:
${compactMembershipCatalogSummary(catalog) || "(none)"}

Requested polities (${batch.length}) — return all ${batch.length} rows:
${batch.map((polity) => `- ${actorSummary(world, polity)}`).join("\n")}

politiesJson = [{"polityKey":"EXACT requested key","regimeCharacter":"canonical/generated/blank","memberships":[{"institutionId":"EXACT catalog id","status":"member","role":"member","joinedDate":"YYYY-MM-DD or blank","note":""}]}].`,
    };
  }

  return {
    systemPrompt: `You assign exact-date FORMAL MEMBERSHIPS and, only where canonical Political Actors do not already provide it, political regime-character classification to OpenHistoria polities.

${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Structured scenario canon outranks external/reference material.

UNIVERSE RULE: use only the institutions in the fixed catalog supplied below. The scenario may be historical, alternate-history, future, or fictional; never import institutions from another universe or timeline.

CRITICAL IDENTITY RULE: the institution catalog below is CLOSED. memberships[].institutionId MUST be one of those exact ids. You cannot create, rename, split, regionalize or duplicate institutions. Never invent a member-specific institution id.

Membership is formal legal/organizational status, not fuzzy alignment. status must be ${INSTITUTION_MEMBER_STATUSES.join(" | ")}; role leader|leading-member|member. For historical baselines, provide the actual accession/status date when confidently known. An active successor institution may legitimately have a joinedDate in a membership-continuous predecessor window declared in the catalog. If membership definitely exists on ${scenarioDate} but the exact accession date is not trustworthy, leave joinedDate blank rather than inventing the scenario start date.

If a requested polity summary already contains canonical regimeCharacter, do NOT reclassify it. Return that exact value unchanged or leave regimeCharacter blank; native code preserves the canonical Political Actor value. Only classify regimeCharacter when canonical Political Actors do not already own the fact. Valid values are democratic | hybrid | authoritarian | totalitarian | theocratic | military | colonial | other.

Return one record for every requested polity even when memberships is empty. No prose outside the tool.`,
    userMessage: `Scenario context:
${clean(scenarioContext).slice(0, 4000) || "(none)"}

FIXED institution catalog:
${catalogSummary(catalog) || "(no strategically relevant formal institutions exist in this scenario/date)"}

Requested polities (${batch.length}):
${batch.map((polity) => `- ${actorSummary(world, polity)}`).join("\n")}

politiesJson = [{"polityKey":"exact key","regimeCharacter":"canonical value, generated value, or blank when canonical supplied","memberships":[{"institutionId":"EXACT catalog id","status":"member","role":"member","joinedDate":"YYYY-MM-DD or blank","note":""}]}].`,
  };
};

const governanceInstitutionSummary = (institution) => {
  const members = array(institution?.members)
    .filter((member) => member?.status !== "suspended")
    .map((member) => `${member.polity}${member.role && member.role !== "member" ? `(${member.role})` : ""}${member.status && member.status !== "member" ? `:${member.status}` : ""}`)
    .join(", ");
  return `[${institution.id}] ${institution.name}${institution.shortName ? ` (${institution.shortName})` : ""} | kind=${institution.kind}${institution.foundedDate ? ` | founded=${institution.foundedDate}` : ""} | members=${members || "(none)"}`;
};

const buildInstitutionGovernancePrompt = ({ scenarioDate, historyAuthority = null, scenarioContext, institutions }) => ({
  systemPrompt: `You resolve the exact-date FORMAL DECISION PROCESS for a closed set of canonical OpenHistoria institutions.

${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Structured scenario canon outranks external/reference material.

UNIVERSE RULE: reason only about the supplied institutions as they exist in THIS scenario on ${scenarioDate}. Historical, alternate, future, fictional, and custom institutions are equally valid. Never import another timeline's rules.

OWNERSHIP RULE: you are filling governance only where native canon currently has no configured default voting rule. You cannot rename/create institutions, change membership, or cast votes. Use institutionId EXACTLY as supplied.

LEGAL UNCERTAINTY RULE: do NOT infer a voting rule mechanically from institution kind, membership size, or a vaguely similar real-world body. If the formal decision rule cannot be established confidently from admissible canon/reference knowledge, return type=unspecified. Native runtime deliberately fails closed rather than invent constitutional law.

DEFAULT VS EXCEPTIONS: a complex institution may have a genuine general/default decision rule plus narrower constitutional exceptions. Do NOT return unspecified merely because exceptions exist. When admissible canon establishes a general/default rule, put that rule in votingRule and put only established materially different cases in proposalRules. Use unspecified only when no defensible general/default rule can be established.

ENUM CONTRACT: votingRule.type must be exactly one of ${INSTITUTION_VOTING_RULE_TYPES.join(" | ")}. Do not add words such as "voting", abbreviations, parenthetical labels, or alternate spellings to the type value.

A votingRule may use type=${INSTITUTION_VOTING_RULE_TYPES.join(" | ")}; abstentionPolicy=${INSTITUTION_ABSTENTION_POLICIES.join(" | ")}; quorum/threshold are fractions 0..1; eligibleStatuses use the institution's membership status vocabulary; vetoRoles/vetoPolities and weightsByPolity are optional. proposalRules is an object keyed by stable generic proposal type ONLY when a materially different rule is actually established (for example accession or charter amendment); otherwise {}.

Return EXACTLY one row for every requested institution. Keep notes brief and describe the decision-process basis, not political advocacy. No prose outside the tool.`,
  userMessage: `Scenario context:
${clean(scenarioContext).slice(0, 6000) || "(none)"}

Requested canonical institutions (${institutions.length}):
${institutions.map(governanceInstitutionSummary).join("\n").slice(0, 30000)}

governanceJson = [{"institutionId":"EXACT id","votingRule":{"type":"unspecified|unanimity|consensus|simple-majority|two-thirds|qualified-majority|weighted","threshold":0.5,"quorum":0.5,"abstentionPolicy":"exclude|count-against","eligibleStatuses":["member"],"vetoPolities":[],"vetoRoles":[],"negativeVoteIsVeto":false,"weightsByPolity":{}},"proposalRules":{},"note":"brief basis"}].`,
});

const buildAgreementsPrompt = ({ scenarioDate, historyAuthority = null, scenarioContext, allPolityKeys, catalog }) => ({
  systemPrompt: `You initialize strategically important ACTIVE FORMAL AGREEMENTS at OpenHistoria Round Zero.\n\n${geopoliticalHistoryAuthorityBlock(historyAuthority, scenarioDate)} Do not include agreements not yet effective or already ended on the TARGET WORLD DATE. Do not duplicate anything represented by formal institution membership in the fixed institution catalog. Include only agreements that materially constrain defense, military access, guarantees, non-aggression, peace, or major economic/strategic behavior; omit routine low-impact treaties.\n\nEvery agreement requires exact YYYY-MM-DD startedDate. endedDate is blank if still active. Use exact canonical polity keys. No prose outside the tool.`,
  userMessage: `Scenario context:\n${clean(scenarioContext).slice(0, 5000) || "(none)"}\n\nFixed formal institutions (do not duplicate as agreements):\n${catalogSummary(catalog) || "(none)"}\n\nCanonical polity keys:\n${allPolityKeys.join(" | ").slice(0, 16000)}\n\nagreementsJson = [{"id":"stable id","type":"alliance|mutual_defense|guarantee|non_aggression|friendship_consultation|trade_economic|military_cooperation|military_access|neutrality|peace_settlement|other","parties":["exact keys"],"title":"","terms":"","startedDate":"YYYY-MM-DD","endedDate":""}]. Use [] if none qualify.`,
});

const canonicalPoliticalActorRegimeCharacter = (world, polity) => {
  const explicit = lower(world?.politicalActors?.byPolity?.[polity]?.politicalSystem?.regimeCharacter);
  return REGIME_CHARACTER_SET.has(explicit) ? explicit : "";
};

const legacyRegimeCharacter = (world, polity) => {
  const tags = [...array(world?.countryTags?.[polity]), ...array(world?.politicalActors?.byPolity?.[polity]?.tags)].map(lower);
  if (tags.includes("totalitarian")) return "totalitarian";
  if (tags.includes("authoritarian")) return "authoritarian";
  if (tags.includes("democratic")) return "democratic";
  if (tags.includes("military-junta")) return "military";
  if (tags.includes("theocratic")) return "theocratic";
  return "";
};

const knownRegimeCharacter = (world, polity) => canonicalPoliticalActorRegimeCharacter(world, polity) || legacyRegimeCharacter(world, polity);


// Political World v2 one-request domain seams. Each helper performs at most one
// provider request so the resumable scheduler can budget/checkpoint every call.
// They deliberately reuse the same normalizers/validators as the legacy
// monolithic baseline rather than creating a second geopolitical truth model.
const geopoliticalJobPolityKeys = (polities = []) => array(polities)
  .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
  .filter(Boolean);

export const generateGeopoliticalInstitutionCatalogJob = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  world = {},
  scenarioContext = "",
  acceptedCatalog = [],
  completenessPass = false,
  callModel = callAI,
  signal,
} = {}) => {
  const allPolityKeys = geopoliticalJobPolityKeys(polities);
  const warnings = [];
  const existingInstitutions = normalizeInstitutions(world?.institutions, world);
  const references = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate })
    .map((entry) => normalizeInstitutionRecord(entry, entry?.id, world))
    .filter(Boolean);
  const catalogMap = new Map(Object.values(existingInstitutions.byId).map((entry) => [entry.id, entry]));
  for (const entry of array(acceptedCatalog)) {
    const normalized = normalizeInstitutionRecord(entry, entry?.id, world);
    if (normalized && !catalogMap.has(normalized.id)) catalogMap.set(normalized.id, normalized);
  }

  const prompt = buildCatalogPrompt({
    scenarioDate,
    historyAuthority,
    world,
    scenarioContext,
    allPolityKeys,
    references,
    acceptedCatalog: [...catalogMap.values()],
    completenessPass,
  });
  const source = await callTool({
    callModel,
    ...prompt,
    tool: GEOPOLITICAL_INSTITUTION_CATALOG_TOOL,
    signal,
    logLabel: completenessPass ? "geopolitical institution catalog completeness" : "geopolitical institution catalog",
  });
  const rows = parseArrayText(source.institutionsJson ?? source.institutions);
  const accepted = [];
  for (const raw of rows) {
    const institution = normalizeCatalogInstitution(raw, {
      world,
      scenarioDate,
      warnings,
      existingInstitutions,
      references,
    });
    if (!institution) continue;
    const identityMatch = findInstitutionIdentityMatch(institution, [...catalogMap.values()]);
    if (identityMatch) continue;
    catalogMap.set(institution.id, institution);
    accepted.push(institution);
  }
  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    phase: completenessPass ? "institution-catalog-completeness" : "institution-catalog",
    institutions: accepted,
    catalog: [...catalogMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    returned: rows.length,
    accepted: accepted.length,
  };
};

export const generateGeopoliticalInstitutionGovernanceJob = async ({
  scenarioDate,
  historyAuthority = null,
  world = {},
  scenarioContext = "",
  callModel = callAI,
  signal,
} = {}) => {
  const requested = geopoliticalInstitutionGovernanceTargets({ world, scenarioDate });
  if (!requested.length) {
    return {
      schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
      phase: "institution-governance",
      governance: [],
      warnings: [],
      requested: 0,
      returned: 0,
      skippedModelCall: true,
    };
  }
  const prompt = buildInstitutionGovernancePrompt({ scenarioDate, historyAuthority, scenarioContext, institutions: requested });
  const source = await callTool({
    callModel,
    ...prompt,
    tool: GEOPOLITICAL_INSTITUTION_GOVERNANCE_TOOL,
    signal,
    logLabel: "geopolitical institution governance",
  });
  const rawRows = parseArrayText(source.governanceJson ?? source.governance);
  const normalized = normalizeGeopoliticalInstitutionGovernancePayload({ world, scenarioDate, rows: rawRows });
  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    phase: "institution-governance",
    ...normalized,
    skippedModelCall: false,
  };
};

export { applyGeopoliticalInstitutionGovernanceBaseline };

export const generateGeopoliticalMembershipJob = async ({
  scenarioDate,
  historyAuthority = null,
  targets = [],
  polities = [],
  world = {},
  scenarioContext = "",
  recovery = false,
  excludeInstitutionIds = [],
  callModel = callAI,
  signal,
} = {}) => {
  const allPolityKeys = geopoliticalJobPolityKeys(polities);
  const requested = geopoliticalJobPolityKeys(targets).filter((key) => allPolityKeys.includes(key));
  const allowedByLower = new Map(allPolityKeys.map((key) => [lower(key), key]));
  const warnings = [];
  const excluded = new Set(array(excludeInstitutionIds).map(clean).filter(Boolean));
  const catalog = Object.values(normalizeInstitutions(world?.institutions, world).byId)
    .filter((entry) => !excluded.has(clean(entry?.id)));
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const catalogByToken = buildCatalogIdentityIndex(catalog);
  if (!requested.length || !catalog.length) {
    return {
      schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
      phase: recovery ? "memberships-recovery" : "memberships",
      records: [],
      acceptedPolities: [...requested],
      unresolvedPolities: [],
      warnings,
      returned: 0,
      skippedModelCall: true,
    };
  }
  const prompt = buildMembershipPrompt({ scenarioDate, historyAuthority, batch: requested, world, scenarioContext, catalog, recovery });
  const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_MEMBERSHIP_TOOL, signal, logLabel: recovery ? "geopolitical membership recovery" : "geopolitical memberships" });
  const rows = parseArrayText(source.politiesJson ?? source.polities);
  const records = [];
  const acceptedKeys = new Set();
  for (const raw of rows) {
    const polityKey = canonicalPolity(raw?.polityKey, world, allowedByLower);
    if (!polityKey || acceptedKeys.has(polityKey) || !requested.includes(polityKey)) continue;
    const canonicalRegime = knownRegimeCharacter(world, polityKey);
    const candidateRegime = lower(raw?.regimeCharacter || raw?.regime);
    const regimeCharacter = canonicalRegime || (REGIME_CHARACTER_SET.has(candidateRegime) ? candidateRegime : "");
    if (!regimeCharacter) continue;
    const memberships = [];
    let invalidMembership = false;
    for (const membershipRaw of array(raw?.memberships)) {
      const membership = normalizeMembership(membershipRaw, { catalogById, catalogByToken, scenarioDate, warnings, polityKey });
      if (!membership) {
        invalidMembership = true;
        break;
      }
      if (!memberships.some((entry) => entry.institutionId === membership.institutionId)) memberships.push(membership);
    }
    if (invalidMembership) continue;
    acceptedKeys.add(polityKey);
    records.push({ polityKey, regimeCharacter, memberships: memberships.slice(0, 16) });
  }
  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    phase: recovery ? "memberships-recovery" : "memberships",
    records,
    acceptedPolities: [...acceptedKeys],
    unresolvedPolities: requested.filter((polity) => !acceptedKeys.has(polity)),
    warnings,
    returned: rows.length,
  };
};

export const generateGeopoliticalInstitutionMembersJob = async ({
  scenarioDate,
  historyAuthority = null,
  institutionId = "",
  polities = [],
  world = {},
  scenarioContext = "",
  callModel = callAI,
  signal,
} = {}) => {
  const allPolityKeys = geopoliticalJobPolityKeys(polities);
  const allowedByLower = new Map(allPolityKeys.map((key) => [lower(key), key]));
  const catalog = Object.values(normalizeInstitutions(world?.institutions, world).byId);
  const institution = catalog.find((entry) => clean(entry?.id) === clean(institutionId));
  if (!institution?.id) throw new Error(`Unknown canonical institution ${clean(institutionId) || "(blank)"}.`);
  const catalogById = new Map([[institution.id, institution]]);
  const catalogByToken = buildCatalogIdentityIndex([institution]);
  const warnings = [];
  const prompt = buildInstitutionMembersPrompt({ scenarioDate, historyAuthority, institution, world, scenarioContext, allPolityKeys });
  const source = await callTool({
    callModel,
    ...prompt,
    tool: GEOPOLITICAL_INSTITUTION_MEMBERS_TOOL,
    signal,
    logLabel: `geopolitical institution members ${institution.id}`,
  });
  const rows = parseArrayText(source.membersJson ?? source.members);
  const records = [];
  const seen = new Set();
  let invalidRows = 0;
  for (const raw of rows) {
    const polityKey = canonicalPolity(raw?.polityKey, world, allowedByLower);
    if (!polityKey) {
      invalidRows += 1;
      continue;
    }
    // Duplicate positive rows do not make an exhaustive member list
    // incomplete; they are transport noise. Canonicalize to one member instead
    // of throwing away the entire institution and paying for another call.
    if (seen.has(polityKey)) {
      warnings.push(`${institution.name}: ignored duplicate positive-member row for ${polityKey}.`);
      continue;
    }
    const membership = normalizeMembership({
      institutionId: institution.id,
      status: raw?.status,
      role: raw?.role,
      joinedDate: raw?.joinedDate,
      note: raw?.note,
    }, { catalogById, catalogByToken, scenarioDate, warnings, polityKey });
    if (!membership) {
      invalidRows += 1;
      continue;
    }
    seen.add(polityKey);
    records.push({ polityKey, regimeCharacter: "", memberships: [membership] });
  }
  if (invalidRows) {
    throw new Error(`${institution.name}: institution-centric membership result contained ${invalidRows} invalid/duplicate row(s); refusing incomplete positive-member canon.`);
  }
  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    phase: "institution-membership-resolution",
    institutionId: institution.id,
    records,
    acceptedInstitutionIds: [institution.id],
    unresolvedInstitutionIds: [],
    warnings,
    returned: rows.length,
  };
};

export const generateGeopoliticalPowerEvidenceJob = async ({
  scenarioDate,
  historyAuthority = null,
  targets = [],
  polities = [],
  world = {},
  scenarioContext = "",
  callModel = callAI,
  signal,
} = {}) => {
  const allPolityKeys = geopoliticalJobPolityKeys(polities);
  const requested = geopoliticalJobPolityKeys(targets).filter((key) => allPolityKeys.includes(key));
  const allowedByLower = new Map(allPolityKeys.map((key) => [lower(key), key]));
  // Previously accepted baseline scores are calibration anchors for later
  // deterministic worklist batches. This keeps a 202-polity world on one
  // relative scale instead of asking each 24-polity batch to reinvent the
  // scale independently. Only explicit baselineScore evidence is used here; a
  // fallback/current tier is never promoted into an anchor.
  const acceptedAnchors = Object.entries(world?.powerStatus?.byPolity || {})
    .filter(([, record]) => isFinitePowerScore(record?.baselineScore))
    .map(([rawPolityKey, record]) => ({
      polityKey: canonicalPolity(rawPolityKey, world, allowedByLower),
      strategicWeight: Number(record.baselineScore),
    }))
    // Only actors in the exact active vocabulary for THIS calibration may act
    // as scale anchors. Legacy/derived power rows from stock Stats or an older
    // scenario must never influence the relative scale of the current world.
    .filter((entry) => entry.polityKey && allPolityKeys.includes(entry.polityKey))
    .map((entry) => ({ ...entry, strategicWeight: Math.round(clamp(entry.strategicWeight, 0, 100)) }));
  const singleton = requested.length === 1;
  const prompt = buildPowerPrompt({
    scenarioDate,
    historyAuthority,
    world,
    scenarioContext,
    requestedPolities: requested,
    allPolityKeys,
    accepted: acceptedAnchors,
    singleton,
  });
  const source = await callTool({
    callModel,
    ...prompt,
    tool: singleton ? GEOPOLITICAL_POWER_SINGLETON_TOOL : GEOPOLITICAL_POWER_CALIBRATION_TOOL,
    signal,
    logLabel: singleton ? "geopolitical power singleton recovery" : "geopolitical power calibration",
  });
  // Singleton recovery uses direct structured fields, avoiding the nested JSON
  // string transport entirely. Keep a compatibility fallback for providers
  // that still answer with the old powerJson field despite the scalar tool.
  const directSingleton = singleton
    && clean(source?.polityKey)
    && Number.isFinite(Number(source?.strategicWeight ?? source?.weight ?? source?.score))
    ? [source]
    : null;
  let rows;
  if (directSingleton) {
    rows = directSingleton;
  } else if (singleton) {
    // Compatibility only: a provider may ignore the scalar tool schema and
    // answer with the old powerJson field. Salvage it when complete, but a
    // malformed legacy field must not abort the bounded singleton recovery.
    // Returning zero accepted rows keeps the attempt fail-closed and lets the
    // coverage helper perform its next bounded retry.
    try {
      rows = parseGeopoliticalArrayText(source?.powerJson ?? source?.power, { allowSingletonObject: true });
    } catch {
      rows = [];
    }
  } else {
    rows = parseGeopoliticalArrayText(source?.powerJson ?? source?.power);
  }
  const accepted = [];
  const acceptedKeys = new Set();
  for (const raw of rows) {
    const polityKey = canonicalPolity(raw?.polityKey, world, allowedByLower);
    const strategicWeight = Number(raw?.strategicWeight ?? raw?.weight ?? raw?.score);
    if (!polityKey || acceptedKeys.has(polityKey) || !requested.includes(polityKey) || !Number.isFinite(strategicWeight)) continue;
    acceptedKeys.add(polityKey);
    accepted.push({ polityKey, strategicWeight: Math.round(clamp(strategicWeight, 0, 100)), note: clean(raw?.note).slice(0, 300) });
  }
  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    phase: "power-calibration",
    powerCalibration: accepted,
    acceptedPolities: [...acceptedKeys],
    unresolvedPolities: requested.filter((polity) => !acceptedKeys.has(polity)),
    returned: rows.length,
  };
};

export const generateGeopoliticalAgreementsJob = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  world = {},
  scenarioContext = "",
  callModel = callAI,
  signal,
} = {}) => {
  const allPolityKeys = geopoliticalJobPolityKeys(polities);
  const allowedByLower = new Map(allPolityKeys.map((key) => [lower(key), key]));
  const catalog = Object.values(normalizeInstitutions(world?.institutions, world).byId);
  const warnings = [];
  const prompt = buildAgreementsPrompt({ scenarioDate, historyAuthority, scenarioContext, allPolityKeys, catalog });
  const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_AGREEMENTS_TOOL, signal, logLabel: "geopolitical agreements" });
  const rows = parseArrayText(source.agreementsJson ?? source.agreements);
  const agreements = new Map();
  for (const raw of rows) {
    const agreement = normalizeAgreement(raw, world, allowedByLower, scenarioDate, warnings);
    if (agreement) agreements.set(agreement.id, agreement);
  }
  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    phase: "agreements",
    agreements: [...agreements.values()],
    warnings,
    returned: rows.length,
    accepted: agreements.size,
  };
};

export const generateGeopoliticalWorldBaseline = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  world = {},
  scenarioContext = "",
  callModel = callAI,
  signal,
  onBatch,
} = {}) => {
  const allPolityKeys = array(polities)
    .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
    .filter(Boolean);
  const requestedPolities = array(polities)
    .map((entry) => typeof entry === "string" ? { polityKey: clean(entry), active: true } : entry)
    .filter((entry) => entry?.active !== false && clean(entry?.polityKey))
    .map((entry) => clean(entry.polityKey));
  const allowedByLower = new Map(allPolityKeys.map((key) => [lower(key), key]));
  const warnings = [];
  const blockingErrors = [];
  const diagnostics = [];
  let modelCalls = 0;

  if (!requestedPolities.length) {
    return { schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION, scenarioDate: clean(scenarioDate), generatedAt: new Date().toISOString(), institutionCatalog: [], records: [], powerCalibration: [], agreements: [], warnings, blockingErrors, diagnostics, unresolvedMembershipPolities: [], unresolvedPowerPolities: [], requestedPolities: 0, modelCalls: 0 };
  }

  // Phase 1: one global institution catalog. Existing authored institutions are
  // canonical for their universe. Optional scenario-supplied reference data may
  // enrich generated records, but it never overrides authored state and core
  // runtime code contains no knowledge of named institutions.
  const existingInstitutions = normalizeInstitutions(world?.institutions, world);
  const institutionReferences = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate })
    .map((entry) => normalizeInstitutionRecord(entry, entry?.id, world))
    .filter(Boolean);
  const catalogMap = new Map(Object.values(existingInstitutions.byId).map((entry) => [entry.id, entry]));
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const prompt = buildCatalogPrompt({ scenarioDate, historyAuthority, world, scenarioContext, allPolityKeys, references: institutionReferences });
      modelCalls += 1;
      const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_INSTITUTION_CATALOG_TOOL, signal, logLabel: "geopolitical institution catalog" });
      const rawInstitutions = parseArrayText(source.institutionsJson ?? source.institutions);
      let accepted = 0;
      for (const raw of rawInstitutions) {
        const institution = normalizeCatalogInstitution(raw, {
          world,
          scenarioDate,
          warnings,
          existingInstitutions,
          references: institutionReferences,
        });
        if (!institution) continue;
        const identityMatch = findInstitutionIdentityMatch(institution, [...catalogMap.values()]);
        if (identityMatch) {
          if (!existingInstitutions.byId[identityMatch.id]) warnings.push(`${institution.name}: duplicate generated catalog identity collapsed to canonical id ${identityMatch.id}.`);
          continue;
        }
        catalogMap.set(institution.id, institution);
        accepted += 1;
      }
      diagnostics.push({ phase: "institution-catalog", attempt, returned: rawInstitutions.length, accepted, referenceEntries: institutionReferences.length });
      break;
    } catch (error) {
      diagnostics.push({ phase: "institution-catalog", attempt, error: clean(error?.message || error) });
      if (attempt === 2) blockingErrors.push(`Institution catalog failed: ${clean(error?.message || error)}`);
    }
  }

  // Large worlds get one generic completeness pass. This is universe-agnostic:
  // it does not know or expect any named organization; it only asks whether the
  // first model pass omitted strategically material institutions for THIS world.
  // A second shallow pass is much cheaper than discovering missing institutions
  // later through broken memberships, and duplicates collapse through identity.
  if (requestedPolities.length >= 64 && !blockingErrors.some((entry) => entry.startsWith("Institution catalog failed:"))) {
    try {
      const prompt = buildCatalogPrompt({
        scenarioDate,
        world,
        scenarioContext,
        allPolityKeys,
        references: institutionReferences,
        acceptedCatalog: [...catalogMap.values()],
        completenessPass: true,
      });
      modelCalls += 1;
      const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_INSTITUTION_CATALOG_TOOL, signal, logLabel: "geopolitical institution catalog completeness" });
      const rawInstitutions = parseArrayText(source.institutionsJson ?? source.institutions);
      let accepted = 0;
      for (const raw of rawInstitutions) {
        const institution = normalizeCatalogInstitution(raw, {
          world,
          scenarioDate,
          warnings,
          existingInstitutions,
          references: institutionReferences,
        });
        if (!institution) continue;
        const identityMatch = findInstitutionIdentityMatch(institution, [...catalogMap.values()]);
        if (identityMatch) continue;
        catalogMap.set(institution.id, institution);
        accepted += 1;
      }
      diagnostics.push({
        phase: "institution-catalog-completeness",
        attempt: 1,
        returned: rawInstitutions.length,
        accepted,
        acceptedTotal: catalogMap.size,
        referenceEntries: institutionReferences.length,
      });
    } catch (error) {
      diagnostics.push({ phase: "institution-catalog-completeness", attempt: 1, error: clean(error?.message || error) });
      warnings.push(`Institution catalog completeness pass failed non-fatally: ${clean(error?.message || error)}`);
    }
  }

  const institutionCatalog = [...catalogMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const catalogById = new Map(institutionCatalog.map((entry) => [entry.id, entry]));
  const catalogByToken = buildCatalogIdentityIndex(institutionCatalog);

  // Phase 2: global relative power evidence. Native code owns the actual tiers.
  const powerMap = new Map();
  let unresolvedPower = [...requestedPolities];
  for (let attempt = 1; attempt <= 2 && unresolvedPower.length; attempt += 1) {
    try {
      const prompt = buildPowerPrompt({ scenarioDate, historyAuthority, world, scenarioContext, requestedPolities: unresolvedPower, allPolityKeys, accepted: [...powerMap.values()] });
      modelCalls += 1;
      const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_POWER_CALIBRATION_TOOL, signal, logLabel: "geopolitical power calibration" });
      const rows = parseArrayText(source.powerJson ?? source.power);
      for (const raw of rows) {
        const polityKey = canonicalPolity(raw?.polityKey, world, allowedByLower);
        const strategicWeight = Number(raw?.strategicWeight ?? raw?.weight ?? raw?.score);
        if (!polityKey || powerMap.has(polityKey) || !unresolvedPower.includes(polityKey) || !Number.isFinite(strategicWeight)) continue;
        powerMap.set(polityKey, { polityKey, strategicWeight: Math.round(clamp(strategicWeight, 0, 100)), note: clean(raw?.note).slice(0, 300) });
      }
      unresolvedPower = unresolvedPower.filter((polity) => !powerMap.has(polity));
      diagnostics.push({ phase: "power-calibration", attempt, returned: rows.length, unresolved: unresolvedPower.length });
    } catch (error) {
      diagnostics.push({ phase: "power-calibration", attempt, error: clean(error?.message || error) });
    }
  }
  if (unresolvedPower.length) blockingErrors.push(`Power calibration incomplete for ${unresolvedPower.length} polity/polities: ${unresolvedPower.slice(0, 12).join(", ")}${unresolvedPower.length > 12 ? "…" : ""}.`);

  // Phase 3: membership/regime profiles. Each normal bounded batch runs once.
  // Every valid row is salvaged; only the final unresolved set is retried.
  // This prevents one omitted polity from causing a whole large batch to rerun.
  const normalizeMembershipRows = async (targets, meta = {}) => {
    const prompt = buildMembershipPrompt({
      scenarioDate,
      batch: targets,
      world,
      scenarioContext,
      catalog: institutionCatalog,
      recovery: meta.phase && meta.phase !== "memberships",
    });
    modelCalls += 1;
    const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_MEMBERSHIP_TOOL, signal, logLabel: "geopolitical memberships" });
    const rows = parseArrayText(source.politiesJson ?? source.polities);
    const accepted = [];
    const acceptedKeys = new Set();
    for (const raw of rows) {
      const polityKey = canonicalPolity(raw?.polityKey, world, allowedByLower);
      if (!polityKey || acceptedKeys.has(polityKey) || !targets.includes(polityKey)) continue;
      const canonicalRegime = knownRegimeCharacter(world, polityKey);
      const candidateRegime = lower(raw?.regimeCharacter || raw?.regime);
      const regimeCharacter = canonicalRegime || (REGIME_CHARACTER_SET.has(candidateRegime) ? candidateRegime : "");
      if (!regimeCharacter) continue;
      const memberships = [];
      let invalidMembership = false;
      for (const membershipRaw of array(raw?.memberships)) {
        const membership = normalizeMembership(membershipRaw, { catalogById, catalogByToken, scenarioDate, warnings, polityKey });
        if (!membership) {
          invalidMembership = true;
          break;
        }
        if (!memberships.some((entry) => entry.institutionId === membership.institutionId)) memberships.push(membership);
      }
      if (invalidMembership) continue;
      acceptedKeys.add(polityKey);
      accepted.push({ polityKey, regimeCharacter, memberships: memberships.slice(0, 16) });
    }
    return accepted;
  };

  const membershipCoverage = await resolveGeopoliticalMembershipCoverage({
    requestedPolities,
    batchSize: GEOPOLITICAL_WORLD_BATCH_SIZE,
    requestProfiles: normalizeMembershipRows,
    signal,
    onProgress: ({ phase, batchIndex, totalBatches, resolvedPolities, totalPolities, unresolvedBatchPolities = [], unresolvedPolities }) => {
      const unresolvedForWarning = phase === "memberships" ? unresolvedBatchPolities : unresolvedPolities;
      onBatch?.({
        phase,
        batchIndex,
        totalBatches,
        resolvedPolities,
        totalPolities,
        warning: unresolvedForWarning.length ? `${unresolvedForWarning.length} unresolved in this ${phase === "memberships" ? "batch" : "rescue pass"}` : "",
      });
    },
  });
  const records = membershipCoverage.records;
  diagnostics.push(...membershipCoverage.diagnostics);
  const unresolvedMembershipPolities = membershipCoverage.unresolvedPolities;
  if (unresolvedMembershipPolities.length) {
    blockingErrors.push(`Membership/regime profile incomplete for ${unresolvedMembershipPolities.length} polity/polities after unresolved-only rescue: ${unresolvedMembershipPolities.slice(0, 24).join(", ")}${unresolvedMembershipPolities.length > 24 ? "…" : ""}.`);
  }

  // Phase 4: one global agreement pass, avoiding cross-batch duplication.
  const agreements = new Map();
  if (!blockingErrors.length || records.length) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const prompt = buildAgreementsPrompt({ scenarioDate, historyAuthority, scenarioContext, allPolityKeys, catalog: institutionCatalog });
        modelCalls += 1;
        const source = await callTool({ callModel, ...prompt, tool: GEOPOLITICAL_AGREEMENTS_TOOL, signal, logLabel: "geopolitical agreements" });
        const rows = parseArrayText(source.agreementsJson ?? source.agreements);
        for (const raw of rows) {
          const agreement = normalizeAgreement(raw, world, allowedByLower, scenarioDate, warnings);
          if (agreement) agreements.set(agreement.id, agreement);
        }
        diagnostics.push({ phase: "agreements", attempt, returned: rows.length, accepted: agreements.size });
        break;
      } catch (error) {
        diagnostics.push({ phase: "agreements", attempt, error: clean(error?.message || error) });
        if (attempt === 2) warnings.push(`Standing-agreement pass failed after retry: ${clean(error?.message || error)}.`);
      }
    }
  }

  return {
    schemaVersion: GEOPOLITICAL_WORLD_SCHEMA_VERSION,
    scenarioDate: clean(scenarioDate),
    generatedAt: new Date().toISOString(),
    institutionCatalog,
    records,
    powerCalibration: [...powerMap.values()],
    agreements: [...agreements.values()],
    warnings,
    blockingErrors,
    diagnostics,
    unresolvedMembershipPolities,
    unresolvedPowerPolities: [...unresolvedPower],
    requestedPolities: requestedPolities.length,
    modelCalls,
  };
};

export const applyGeopoliticalWorldBaseline = ({ world: worldLike = {}, result, date = "" } = {}) => {
  if (array(result?.blockingErrors).length) throw new Error(`Geopolitical baseline is incomplete and cannot be applied: ${result.blockingErrors.join(" ")}`);
  let world = clone(worldLike || {});
  const applied = [];
  const existingInstitutions = normalizeInstitutions(world.institutions, world);
  const institutionUpdates = [];

  for (const institution of array(result?.institutionCatalog)) {
    if (!institution?.id || existingInstitutions.byId[institution.id]) continue;
    institutionUpdates.push({
      id: institution.id,
      op: "create",
      polity: "",
      status: "",
      role: "",
      eventIds: [],
      eventIndexes: [],
      name: institution.name,
      kind: institution.kind,
      aliases: institution.aliases,
      badgeKey: institution.badgeKey,
      priority: institution.priority,
      foundedDate: institution.foundedDate,
      dissolvedDate: institution.dissolvedDate,
      predecessors: array(institution.predecessors),
      note: institution.note || "Generated exact-date geopolitical institution baseline.",
    });
  }

  for (const record of array(result?.records)) {
    const polity = clean(record?.polityKey);
    if (!polity) continue;
    const actor = world?.politicalActors?.byPolity?.[polity];
    if (actor) {
      const explicit = lower(actor?.politicalSystem?.regimeCharacter);
      if (!REGIME_CHARACTER_SET.has(explicit) && REGIME_CHARACTER_SET.has(lower(record.regimeCharacter))) {
        actor.politicalSystem = { ...(actor.politicalSystem || {}), regimeCharacter: lower(record.regimeCharacter) };
        applied.push(`${polity}:regimeCharacter`);
      }
    }
    for (const membership of array(record?.memberships)) {
      institutionUpdates.push({
        id: membership.institutionId,
        op: "join",
        polity,
        status: membership.status || "member",
        role: membership.role || "member",
        sinceDate: membership.joinedDate || "",
        eventIds: [],
        eventIndexes: [],
        note: membership.note || "Generated exact-date institutional membership baseline.",
      });
    }
  }

  const institutionMerge = applyInstitutionUpdates({
    world,
    updates: institutionUpdates,
    events: [],
    stopDate: date,
    round: 0,
    allowUnboundBaseline: true,
    enforceTemporalBaseline: true,
  });
  if (institutionMerge.error) throw new Error(institutionMerge.error);
  world = institutionMerge.world;
  applied.push(...institutionMerge.appliedIds.map((id) => `institution:${id}`));

  const knownAgreements = new Set(array(world.agreements).map((entry) => clean(entry?.id)).filter(Boolean));
  const agreementUpdates = array(result?.agreements).filter((entry) => !knownAgreements.has(clean(entry?.id)));
  const diplomaticMerge = applyDiplomaticUpdates({ world, relationUpdates: [], agreementUpdates, events: [], stopDate: date, round: 0, allowUnboundBaseline: true });
  world = diplomaticMerge.world;
  applied.push(...diplomaticMerge.appliedAgreementIds.map((id) => `agreement:${id}`));

  const powerByPolity = new Map(array(result?.powerCalibration).map((entry) => [clean(entry?.polityKey), entry]));
  for (const [polity, entry] of powerByPolity) {
    if (!polity || !Number.isFinite(Number(entry?.strategicWeight))) continue;
    const existing = world?.powerStatus?.byPolity?.[polity];
    if (lower(existing?.basis) === "authored") continue;
    world = seedPowerBaselineScore(world, polity, entry.strategicWeight, {
      basis: "generated-relative-baseline",
      date,
      round: 0,
      reasons: entry.note ? [entry.note] : [],
    });
    applied.push(`${polity}:powerBaseline`);
  }
  world = refreshPowerStatus(world, { date, round: 0, immediate: true });

  return { world, applied, warnings: array(result?.warnings) };
};

export const buildGeopoliticalBaselineDiagnostic = ({
  result,
  world = {},
  scenario = {},
} = {}) => {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Geopolitical baseline result is required.");
  const blockingErrors = array(result.blockingErrors);
  let finalNativePowerTiers = [];
  let powerTierPreviewError = "";

  if (!blockingErrors.length) {
    try {
      const preview = applyGeopoliticalWorldBaseline({ world, result, date: result.scenarioDate });
      finalNativePowerTiers = Object.entries(preview?.world?.powerStatus?.byPolity || {})
        .map(([polityKey, entry]) => ({
          polityKey,
          tier: clean(entry?.tier || entry?.powerTier),
          score: isFinitePowerScore(entry?.score) ? Number(entry.score) : null,
          basis: clean(entry?.basis),
          reasons: array(entry?.reasons).map(clean).filter(Boolean),
        }))
        .filter((entry) => entry.tier)
        .sort((a, b) => a.polityKey.localeCompare(b.polityKey));
    } catch (error) {
      powerTierPreviewError = clean(error?.message || error);
    }
  } else {
    powerTierPreviewError = `Unavailable while Apply is blocked: ${blockingErrors.join(" ")}`;
  }

  const warnings = array(result.warnings);
  const temporalCanonicalizationDrops = warnings.filter((entry) => /\b(dropped|rejected|collapsed)\b/i.test(clean(entry)));
  const diagnostics = array(result.diagnostics);
  const callCountsByPhase = diagnostics.reduce((counts, entry) => {
    const phase = clean(entry?.phase || "unknown");
    counts[phase] = (counts[phase] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    kind: "geopolitical-baseline-diagnostic",
    scenario: {
      id: clean(scenario?.id),
      name: clean(scenario?.name),
      scenarioDate: clean(result.scenarioDate),
    },
    run: {
      generatedAt: clean(result.generatedAt) || new Date().toISOString(),
      requestedPolities: Number(result.requestedPolities) || 0,
      membershipProfiles: array(result.records).length,
      institutionCount: array(result.institutionCatalog).length,
      powerInputs: array(result.powerCalibration).length,
      agreementCount: array(result.agreements).length,
      modelCalls: Number(result.modelCalls) || 0,
      callCountsByPhase,
      applyBlocked: blockingErrors.length > 0,
      applyBlockReason: blockingErrors.join(" "),
    },
    institutionCatalog: clone(array(result.institutionCatalog)),
    membershipRegimeProfiles: clone(array(result.records)),
    powerCalibrationEvidence: clone(array(result.powerCalibration)),
    finalNativePowerTiers,
    powerTierPreviewError,
    agreements: clone(array(result.agreements)),
    warnings: clone(warnings),
    unresolvedPolities: [...new Set([...array(result.unresolvedMembershipPolities), ...array(result.unresolvedPowerPolities)])],
    unresolvedBreakdown: {
      memberships: clone(array(result.unresolvedMembershipPolities)),
      powerCalibration: clone(array(result.unresolvedPowerPolities)),
    },
    temporalCanonicalizationDrops: clone(temporalCanonicalizationDrops),
    blockingErrors: clone(blockingErrors),
    diagnostics: clone(diagnostics),
  };
};
