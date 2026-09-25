/*! Open Historia Continuum — Political World v2 reference bootstrap
 *
 * Universe/reference knowledge is data. This module only materializes the
 * reference packs explicitly selected by the scenario's saved Canon Context.
 * Core institution mechanics remain universe-agnostic.
 */

import { applyInstitutionUpdates, findInstitutionIdentityMatch, normalizeInstitutions } from "../../../runtime/institutions.js";
import {
  resolveScenarioInstitutionMembershipCoverage,
  resolveScenarioInstitutionMembershipHistory,
  resolveScenarioInstitutionReferenceCatalog,
  resolveScenarioReferencePacks,
} from "../../../runtime/canonReferencePacks.js";
import { resolvePolityIdentity } from "../../../runtime/polityIdentity.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const unique = (values) => [...new Set(array(values).map(clean).filter(Boolean))];
const dateKey = (value) => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Number(`${match[1]}${match[2]}${match[3]}`) : null;
};

const activePolityKeys = (polities = []) => array(polities)
  .filter((entry) => typeof entry === "string" || entry?.active !== false)
  .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
  .filter(Boolean);

const resolveReferencePolity = (token, world, allowed) => {
  const exact = allowed.get(clean(token).toLocaleLowerCase());
  if (exact) return exact;
  const resolved = resolvePolityIdentity(token, world, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return allowed.get(clean(resolved?.resolved).toLocaleLowerCase()) || "";
};

const referenceInstitutionIdMap = (world, scenarioDate, references = null) => {
  const existing = normalizeInstitutions(world?.institutions, world);
  const existingList = Object.values(existing.byId);
  const catalog = references || resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate });
  const out = new Map();
  for (const reference of array(catalog)) {
    const direct = existing.byId[reference.id];
    const match = direct || findInstitutionIdentityMatch(reference, existingList);
    if (match?.id) out.set(clean(reference.id), clean(match.id));
  }
  return out;
};

const seedReferenceInstitutions = (world, scenarioDate, references) => {
  if (!references.length) return { world: clone(world), seededInstitutions: 0 };
  const existing = normalizeInstitutions(world?.institutions, world);
  const existingList = Object.values(existing.byId);
  const updates = references
    .filter((institution) => !existing.byId[institution.id] && !findInstitutionIdentityMatch(institution, existingList))
    .map((institution) => ({
      id: institution.id,
      op: "create",
      name: institution.name,
      shortName: institution.shortName,
      aliases: institution.aliases,
      kind: institution.kind,
      badgeKey: institution.badgeKey,
      priority: institution.priority,
      foundedDate: institution.foundedDate,
      dissolvedDate: institution.dissolvedDate,
      predecessors: institution.predecessors,
      eventIds: [],
      eventIndexes: [],
      note: "Seeded from scenario-selected Round-Zero reference knowledge.",
    }));
  if (!updates.length) return { world: { ...clone(world), institutions: existing }, seededInstitutions: 0 };
  const applied = applyInstitutionUpdates({
    world,
    updates,
    events: [],
    stopDate: scenarioDate,
    round: 0,
    allowUnboundBaseline: true,
    enforceTemporalBaseline: true,
  });
  if (applied.error) throw new Error(`Reference institution staging failed: ${applied.error}`);
  return { world: applied.world, seededInstitutions: applied.appliedIds.length };
};

const seedReferenceMemberships = (world, scenarioDate, polities) => {
  const history = resolveScenarioInstitutionMembershipHistory(world, { scenarioDate });
  const scenarioKey = dateKey(scenarioDate);
  if (!scenarioKey || !history || typeof history !== "object") return { world: clone(world), seededMemberships: 0 };
  const polityKeys = activePolityKeys(polities);
  const allowed = new Map(polityKeys.map((key) => [key.toLocaleLowerCase(), key]));
  const institutionIdMap = referenceInstitutionIdMap(world, scenarioDate);
  const updates = [];

  for (const [institutionId, polityHistory] of Object.entries(history)) {
    const canonicalInstitutionId = clean(institutionIdMap.get(clean(institutionId)) || institutionId);
    for (const [polityToken, intervals] of Object.entries(polityHistory || {})) {
      const polity = resolveReferencePolity(polityToken, world, allowed);
      if (!polity) continue;
      const active = array(intervals).find((interval) => {
        const from = dateKey(interval?.from || interval?.joinedAt);
        const to = dateKey(interval?.to || interval?.leftAt);
        return from && from <= scenarioKey && (!to || (interval?.referenceSnapshot ? scenarioKey <= to : scenarioKey < to));
      });
      if (!active) continue;
      updates.push({
        id: canonicalInstitutionId,
        op: "join",
        polity,
        status: clean(active.status) || "member",
        role: clean(active.role) || "member",
        sinceDate: clean(active.joinedAt || (active.referenceSnapshot ? "" : active.from)),
        eventIds: [],
        eventIndexes: [],
        note: "Seeded from scenario-selected Round-Zero reference membership history.",
      });
    }
  }

  if (!updates.length) return { world: clone(world), seededMemberships: 0 };
  const applied = applyInstitutionUpdates({
    world,
    updates,
    events: [],
    stopDate: scenarioDate,
    round: 0,
    allowUnboundBaseline: true,
    enforceTemporalBaseline: true,
  });
  if (applied.error) throw new Error(`Reference membership staging failed: ${applied.error}`);
  return { world: applied.world, seededMemberships: applied.appliedIds.length };
};

export const reconcilePoliticalWorldV2ReferenceState = ({ world: worldLike = {}, scenarioDate = "", polities = [] } = {}) => {
  let world = clone(worldLike || {});
  const packs = resolveScenarioReferencePacks(world);
  const activeReferencePackIds = unique(packs.map((pack) => pack?.id));
  const references = resolveScenarioInstitutionReferenceCatalog(world, { scenarioDate });
  const expectedReferenceInstitutionIds = unique(references.map((institution) => institution?.id));

  const institutionSeed = seedReferenceInstitutions(world, scenarioDate, references);
  world = institutionSeed.world;
  const membershipSeed = seedReferenceMemberships(world, scenarioDate, polities);
  world = membershipSeed.world;

  const idMap = referenceInstitutionIdMap(world, scenarioDate, references);
  const materializedReferenceInstitutionIds = unique(expectedReferenceInstitutionIds.map((id) => idMap.get(id)).filter(Boolean));
  const missingReferenceInstitutionIds = expectedReferenceInstitutionIds.filter((id) => !idMap.get(id));
  const coverage = resolveScenarioInstitutionMembershipCoverage(world, { scenarioDate });
  const referenceCoveredInstitutionIds = unique(array(coverage?.institutionIds)
    .map((id) => idMap.get(clean(id)))
    .filter(Boolean));

  return {
    world,
    activeReferencePackIds,
    expectedReferenceInstitutionIds,
    materializedReferenceInstitutionIds,
    missingReferenceInstitutionIds,
    referenceCoveredInstitutionIds,
    seededInstitutions: institutionSeed.seededInstitutions,
    seededMemberships: membershipSeed.seededMemberships,
  };
};
