/*! Open Historia Continuum — exact-date institutional governance baseline
 *
 * Pure native seam shared by PWv2 provider orchestration and tests. Institution
 * identity/membership already exist before this stage. This module only fills
 * governance that is still genuinely unconfigured, and never overwrites a
 * configured charter.
 */

import {
  applyInstitutionCharterResolution,
  normalizeInstitutionCharter,
  normalizeInstitutions,
  validateInstitutionTemporalBaseline,
} from "../../runtime/institutions.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const institutionGovernanceIsConfigured = (institution) => (
  clean(institution?.charter?.votingRule?.type) !== "unspecified"
);

export const geopoliticalInstitutionGovernanceTargets = ({ world = {}, scenarioDate = "" } = {}) => Object.values(
  normalizeInstitutions(world?.institutions, world).byId,
)
  .filter((institution) => institution?.status === "active")
  .filter((institution) => validateInstitutionTemporalBaseline({ institution, scenarioDate }).valid)
  .filter((institution) => !institutionGovernanceIsConfigured(institution))
  .sort((a, b) => a.id.localeCompare(b.id));

const normalizeRow = (value, { institution, world } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || !institution) return null;
  if (clean(value.institutionId) !== institution.id) return null;
  const rawVotingRule = value.votingRule || value.defaultVotingRule || {};
  return {
    institutionId: institution.id,
    rawVotingRuleType: clean(rawVotingRule?.type || rawVotingRule?.rule || rawVotingRule?.mode),
    charter: normalizeInstitutionCharter({
      votingRule: rawVotingRule,
      proposalRules: value.proposalRules || {},
      note: value.note || "",
    }, world),
  };
};

export const normalizeGeopoliticalInstitutionGovernancePayload = ({
  world = {},
  scenarioDate = "",
  rows = [],
} = {}) => {
  const requested = geopoliticalInstitutionGovernanceTargets({ world, scenarioDate });
  const rawRows = array(rows);
  const rawById = new Map(rawRows
    .map((row) => [clean(row?.institutionId), row])
    .filter(([id]) => id));
  const warnings = [];
  const governance = requested.map((institution) => {
    const normalized = normalizeRow(rawById.get(institution.id), { institution, world });
    if (normalized) {
      if (
        normalized.rawVotingRuleType
        && clean(normalized.rawVotingRuleType).toLowerCase() !== "unspecified"
        && normalized.charter?.votingRule?.type === "unspecified"
      ) {
        warnings.push(`${institution.id}: unrecognized voting-rule type "${normalized.rawVotingRuleType}" was rejected; preserving fail-closed unspecified rule.`);
      }
      const { rawVotingRuleType: _rawVotingRuleType, ...canonical } = normalized;
      return canonical;
    }
    warnings.push(`${institution.id}: governance resolver returned no valid exact-id row; preserving fail-closed unspecified rule.`);
    return { institutionId: institution.id, charter: normalizeInstitutionCharter({}, world) };
  });
  return {
    governance,
    warnings,
    requested: requested.length,
    returned: rawRows.length,
  };
};

export const applyGeopoliticalInstitutionGovernanceBaseline = ({
  world: worldLike = {},
  governance = [],
  date = "",
} = {}) => {
  let world = clone(worldLike || {});
  const applied = [];
  const warnings = [];

  for (const resolution of array(governance)) {
    const institutionId = clean(resolution?.institutionId);
    if (!institutionId) continue;
    const institutions = normalizeInstitutions(world?.institutions, world);
    const institution = institutions.byId[institutionId];
    if (!institution || institution.status !== "active") {
      warnings.push(`${institutionId}: skipped governance baseline for missing/inactive institution.`);
      continue;
    }

    const current = institution.charter || normalizeInstitutionCharter({}, world);
    const proposed = normalizeInstitutionCharter(resolution?.charter || {}, world);
    const patch = {};

    // A configured canonical default is authoritative. PWv2 fills only the
    // absence of constitutional law; it never re-adjudicates authored law.
    if (clean(current?.votingRule?.type) === "unspecified") patch.votingRule = proposed.votingRule;

    // Proposal-specific rules are independently mergeable. Existing keys are
    // canonical and cannot be overwritten by generated baseline enrichment.
    const missingProposalRules = {};
    for (const [type, rule] of Object.entries(proposed.proposalRules || {})) {
      if (!current?.proposalRules?.[type]) missingProposalRules[type] = rule;
    }
    if (Object.keys(missingProposalRules).length) patch.proposalRules = missingProposalRules;
    if (!clean(current?.note) && clean(proposed?.note)) patch.note = proposed.note;
    if (!Object.keys(patch).length) continue;

    const merged = applyInstitutionCharterResolution({
      world,
      institutionId,
      charterPatch: patch,
      date,
      sourceProposalId: "",
    });
    if (merged.error) {
      warnings.push(`${institutionId}: ${merged.error}`);
      continue;
    }
    world = merged.world;
    applied.push(institutionId);
  }

  return { world, appliedInstitutionIds: applied, warnings };
};
