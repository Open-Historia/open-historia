/*! Open Historia Continuum — optional universe/reference knowledge packs
 *
 * Packs are DATA. Loading one is a scenario-author choice stored in
 * world.canonContext.referencePacks. Core canon/institution mechanics never
 * infer a pack from institution names or from a scenario date.
 */

import { EARTH_HISTORY_INSTITUTION_REFERENCE_PACK } from "../data/institutionReferencePacks/earthHistory.js";
import { activeReferencePackIds, enabledReferencePackIds, normalizeCanonContext, readScenarioCanon } from "./scenarioCanon.js";
import { resolveScenarioHistoryAuthority } from "./scenarioHistoryAuthority.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const array = (value) => Array.isArray(value) ? value : [];

const BUILTIN_REFERENCE_PACKS = Object.freeze({
  [EARTH_HISTORY_INSTITUTION_REFERENCE_PACK.id]: EARTH_HISTORY_INSTITUTION_REFERENCE_PACK,
});

const dateKey = (value, edge = "start") => {
  const text = clean(value);
  const match = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : (edge === "end" ? 12 : 1);
  if (!Number.isInteger(year) || year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const day = match[3] ? Number(match[3]) : (edge === "end" ? days[month - 1] : 1);
  if (day < 1 || day > days[month - 1]) return null;
  return year * 10000 + month * 100 + day;
};

export const listCanonReferencePacks = () => Object.values(BUILTIN_REFERENCE_PACKS).map((pack) => ({
  id: clean(pack.id),
  version: clean(pack.version),
  label: clean(pack.label || pack.id),
  description: clean(pack.description),
  universeHints: array(pack.universeHints).map(clean).filter(Boolean),
  defaultUniverse: pack?.defaultUniverse && typeof pack.defaultUniverse === "object"
    ? { id: clean(pack.defaultUniverse.id), type: clean(pack.defaultUniverse.type) }
    : null,
  defaultReferenceAuthority: clean(pack.defaultReferenceAuthority),
  domains: array(pack.domains).map(clean).filter(Boolean),
}));

export const getCanonReferencePack = (packId) => {
  const pack = BUILTIN_REFERENCE_PACKS[clean(packId)] || null;
  return pack ? clone(pack) : null;
};



export const canonReferencePackDomains = (packId) => {
  const pack = getCanonReferencePack(packId);
  return pack ? array(pack.domains).map(clean).filter(Boolean) : [];
};

export const updateCanonContextReferencePackSelection = (canonContext = {}, packId = "", selected = true) => {
  const context = normalizeCanonContext(canonContext);
  const pack = getCanonReferencePack(packId);
  if (!pack) return context;

  const byId = new Map(
    context.referencePacks
      .filter((entry) => entry?.id)
      .map((entry) => [entry.id, { ...entry }]),
  );

  if (selected) {
    byId.set(pack.id, { id: pack.id, version: clean(pack.version), enabled: true });
  } else {
    byId.delete(pack.id);
  }

  let referenceAuthority = context.referenceAuthority;
  let universe = { ...(context.universe || {}) };

  if (selected && referenceAuthority === "none") {
    referenceAuthority = clean(pack.defaultReferenceAuthority) || "round-zero-only";
  }

  // A pristine legacy/custom context has no universe identity yet. In that one
  // case a selected pack may supply its own data-defined default. Explicit
  // author universe choices are never overwritten merely because a pack was
  // selected.
  if (selected && !clean(universe.id) && pack.defaultUniverse && typeof pack.defaultUniverse === "object") {
    universe = {
      id: clean(pack.defaultUniverse.id),
      type: clean(pack.defaultUniverse.type) || universe.type || "custom",
    };
  }

  return normalizeCanonContext({
    ...context,
    universe,
    referenceAuthority,
    referencePacks: [...byId.values()],
  });
};

export const resolveScenarioReferencePacks = (world = {}) => {
  const canon = readScenarioCanon(world);
  if (!canon.initialized || canon.canonContext.referenceAuthority === "none") return [];
  return activeReferencePackIds(canon.canonContext)
    .map((id) => getCanonReferencePack(id))
    .filter(Boolean);
};

export const resolveScenarioReferenceAuthorityHorizon = (world = {}, scenarioDate = "") => {
  const canon = readScenarioCanon(world);
  if (!canon.initialized) return "";
  return resolveScenarioHistoryAuthority({ world, scenarioDate }).referenceHorizonDate;
};

const referenceInstitutionAtHorizon = (institution, horizon) => {
  const horizonKey = dateKey(horizon, "start");
  if (!horizonKey) return null;
  const foundedKey = dateKey(institution?.foundedDate, "start");
  const dissolvedKey = dateKey(institution?.dissolvedDate, "end");
  if (!foundedKey || foundedKey > horizonKey) return null;
  if (dissolvedKey && dissolvedKey <= horizonKey) return null;

  const next = clone(institution);
  // Reference-canon facts after the allowed horizon are not evidence. Preserve
  // the institution identity/existence as known at the horizon but strip later
  // dissolution knowledge and later predecessor facts.
  if (dissolvedKey && dissolvedKey > horizonKey) next.dissolvedDate = "";
  next.predecessors = array(next.predecessors).filter((entry) => {
    const predecessorFounded = dateKey(entry?.foundedDate, "start");
    return predecessorFounded && predecessorFounded <= horizonKey;
  }).map((entry) => {
    const predecessor = clone(entry);
    const predecessorDissolved = dateKey(predecessor?.dissolvedDate, "end");
    if (predecessorDissolved && predecessorDissolved > horizonKey) predecessor.dissolvedDate = "";
    return predecessor;
  });
  next.referenceValidThrough = clean(horizon);
  return next;
};

export const resolveScenarioInstitutionReferenceCatalog = (world = {}, { scenarioDate = "" } = {}) => {
  const horizon = resolveScenarioReferenceAuthorityHorizon(world, scenarioDate);
  if (!horizon) return [];
  const byId = new Map();
  for (const pack of resolveScenarioReferencePacks(world)) {
    for (const institution of array(pack?.institutions)) {
      const bounded = referenceInstitutionAtHorizon(institution, horizon);
      const id = clean(bounded?.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, bounded);
    }
  }
  return [...byId.values()];
};

const snapshotCoversDate = (snapshot, horizon) => {
  const target = dateKey(horizon, "start");
  if (!target) return false;
  const from = dateKey(snapshot?.validFrom || snapshot?.from || snapshot?.asOf, "start");
  const through = dateKey(snapshot?.validThrough || snapshot?.to || snapshot?.asOf, "end");
  if (!from || target < from) return false;
  return !through || target <= through;
};

const activeMembershipSnapshots = (world = {}, { scenarioDate = "" } = {}) => {
  const horizon = resolveScenarioReferenceAuthorityHorizon(world, scenarioDate);
  if (!horizon) return [];
  const snapshots = [];
  for (const pack of resolveScenarioReferencePacks(world)) {
    for (const snapshot of array(pack?.membershipSnapshots)) {
      if (!snapshotCoversDate(snapshot, horizon)) continue;
      snapshots.push({ packId: clean(pack.id), snapshot: clone(snapshot), horizon });
    }
  }
  return snapshots;
};

export const resolveScenarioInstitutionMembershipCoverage = (world = {}, { scenarioDate = "" } = {}) => {
  const institutionIds = new Set();
  const snapshots = [];
  for (const entry of activeMembershipSnapshots(world, { scenarioDate })) {
    const ids = array(entry?.snapshot?.completeInstitutionIds).map(clean).filter(Boolean);
    if (!ids.length) continue;
    for (const id of ids) institutionIds.add(id);
    snapshots.push({
      packId: entry.packId,
      snapshotId: clean(entry?.snapshot?.id),
      completeInstitutionIds: ids,
      validFrom: clean(entry?.snapshot?.validFrom || entry?.snapshot?.from || entry?.snapshot?.asOf),
      validThrough: clean(entry?.snapshot?.validThrough || entry?.snapshot?.to || entry?.snapshot?.asOf),
    });
  }
  return { institutionIds: [...institutionIds], snapshots };
};

export const resolveScenarioInstitutionMembershipHistory = (world = {}, { scenarioDate = "" } = {}) => {
  const horizon = resolveScenarioReferenceAuthorityHorizon(world, scenarioDate);
  const horizonKey = dateKey(horizon, "start");
  if (!horizonKey) return {};
  const merged = {};

  const pushInterval = (institutionId, polityId, interval) => {
    const inst = clean(institutionId);
    const polity = clean(polityId);
    if (!inst || !polity || !interval || typeof interval !== "object") return;
    merged[inst] = merged[inst] || {};
    merged[inst][polity] = array(merged[inst][polity]);
    merged[inst][polity].push(clone(interval));
  };

  for (const pack of resolveScenarioReferencePacks(world)) {
    const history = pack?.membershipHistory;
    if (!history || typeof history !== "object" || Array.isArray(history)) continue;
    for (const [institutionId, polityHistory] of Object.entries(history)) {
      if (!institutionId || !polityHistory || typeof polityHistory !== "object") continue;
      for (const [polityId, intervals] of Object.entries(polityHistory)) {
        for (const interval of array(intervals)) {
          const from = dateKey(interval?.from || interval?.joinedAt, "start");
          const to = dateKey(interval?.to || interval?.leftAt, "end");
          if (!from || from > horizonKey || (to && to <= from)) continue;
          const next = clone(interval);
          if (to && to > horizonKey) {
            if (Object.prototype.hasOwnProperty.call(next, "to")) next.to = "";
            if (Object.prototype.hasOwnProperty.call(next, "leftAt")) next.leftAt = "";
          }
          next.referenceValidThrough = horizon;
          pushInterval(institutionId, polityId, next);
        }
      }
    }
  }

  for (const entry of activeMembershipSnapshots(world, { scenarioDate })) {
    const snapshot = entry.snapshot;
    const from = clean(snapshot?.validFrom || snapshot?.from || snapshot?.asOf);
    const to = clean(snapshot?.validThrough || snapshot?.to || snapshot?.asOf);
    const memberships = snapshot?.memberships;
    if (!memberships || typeof memberships !== "object" || Array.isArray(memberships)) continue;
    for (const [institutionId, polityMemberships] of Object.entries(memberships)) {
      if (!polityMemberships || typeof polityMemberships !== "object" || Array.isArray(polityMemberships)) continue;
      for (const [polityId, rawMembership] of Object.entries(polityMemberships)) {
        const membership = rawMembership && typeof rawMembership === "object" && !Array.isArray(rawMembership) ? rawMembership : {};
        pushInterval(institutionId, polityId, {
          from,
          to,
          joinedAt: clean(membership.joinedAt),
          status: clean(membership.status) || "member",
          role: clean(membership.role) || "member",
          referenceSnapshot: true,
          referenceSnapshotId: clean(snapshot?.id),
          referencePackId: entry.packId,
          referenceValidThrough: horizon,
        });
      }
    }
  }

  return merged;
};

