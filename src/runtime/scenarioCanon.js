/*! Open Historia Continuum — Scenario Canon Model v2 compatibility boundary
 *
 * Two persisted schema states exist:
 *   - legacy: world.canonModelVersion is absent
 *   - current: world.canonModelVersion === 2
 *
 * Reading legacy state MUST NOT materialize Continuum canon fields. Callers get
 * a safe compatibility view in memory and must explicitly opt into
 * materializeScenarioCanon() before the scenario is upgraded.
 */

import { normalizeInstitutions } from "./institutions.js";

export const CANON_MODEL_VERSION = 2;
export const CANON_SCHEMA_MODES = Object.freeze({ LEGACY: "legacy", CURRENT: "current" });

export const CANON_UNIVERSE_TYPES = Object.freeze([
  "historical",
  "alternate",
  "fictional",
  "custom",
]);

export const CANON_REFERENCE_AUTHORITIES = Object.freeze([
  "none",
  "round-zero-only",
  "pre-divergence-only",
]);


const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const cleanMultiline = (value) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => line.replace(/[\t ]+$/g, ""))
  .join("\n")
  .trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const array = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const unique = (values, limit = 32) => {
  const out = [];
  const seen = new Set();
  for (const raw of array(values)) {
    const value = clean(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

const normalizeReferencePack = (value = {}) => {
  if (typeof value === "string") {
    const id = clean(value);
    return id ? { id, version: "", enabled: true } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = clean(value.id || value.referencePackId);
  if (!id) return null;
  return {
    id,
    version: clean(value.version),
    enabled: value.enabled !== false,
  };
};

export const createLegacyCanonContext = () => ({
  universe: {
    id: "",
    type: "custom",
  },
  referencePacks: [],
  referenceAuthority: "none",
  divergence: null,
  source: "legacy-uninitialized",
});

export const normalizeCanonContext = (value = {}) => {
  const source = object(value);
  const universeSource = object(source.universe);
  const universeType = CANON_UNIVERSE_TYPES.includes(clean(universeSource.type))
    ? clean(universeSource.type)
    : "custom";
  const referenceAuthority = CANON_REFERENCE_AUTHORITIES.includes(clean(source.referenceAuthority))
    ? clean(source.referenceAuthority)
    : "none";

  const referencePacks = [];
  const seenPacks = new Set();
  for (const rawPack of array(source.referencePacks)) {
    const pack = normalizeReferencePack(rawPack);
    if (!pack || seenPacks.has(pack.id)) continue;
    seenPacks.add(pack.id);
    referencePacks.push(pack);
  }

  const divergenceSource = object(source.divergence);
  const divergenceDate = clean(divergenceSource.date);
  const divergenceDescription = cleanMultiline(divergenceSource.description).slice(0, 12000);
  const divergence = divergenceDate || divergenceDescription
    ? {
      date: divergenceDate,
      // Keep author-entered chronology line breaks intact. These lines are scenario
      // canon, not disposable helper text, and the editor intentionally teaches
      // authors to enter one dated divergence event per line.
      description: divergenceDescription,
    }
    : null;

  return {
    universe: {
      id: clean(universeSource.id),
      type: universeType,
    },
    referencePacks,
    referenceAuthority,
    divergence,
  };
};

export const isCurrentCanonWorld = (world = {}) => Number(world?.canonModelVersion) === CANON_MODEL_VERSION;

export const scenarioCanonMode = (world = {}) => isCurrentCanonWorld(world)
  ? CANON_SCHEMA_MODES.CURRENT
  : CANON_SCHEMA_MODES.LEGACY;

/**
 * Return a read-only-ish normalized compatibility view without changing the
 * supplied world. Legacy absence is represented as uninitialized, not as an
 * empty canonical truth ledger.
 */
export const readScenarioCanon = (world = {}) => {
  const sourceWorld = object(world);
  const current = isCurrentCanonWorld(sourceWorld);
  const canonContext = current
    ? normalizeCanonContext(sourceWorld.canonContext)
    : createLegacyCanonContext();

  return {
    mode: current ? CANON_SCHEMA_MODES.CURRENT : CANON_SCHEMA_MODES.LEGACY,
    version: current ? CANON_MODEL_VERSION : null,
    initialized: current,
    canonContext,
    // These are runtime views. Their presence here does NOT imply that a legacy
    // scenario authored canonical Continuum data.
    institutions: normalizeInstitutions(sourceWorld.institutions, sourceWorld),
    agreements: array(sourceWorld.agreements).map(clone),
    politicalActors: clone(sourceWorld.politicalActors || {}),
    powerStatus: clone(sourceWorld.powerStatus || {}),
    wars: array(sourceWorld.wars).map(clone),
    relations: array(sourceWorld.relations).map(clone),
  };
};

export const enabledReferencePackIds = (canonContext = {}) => unique(
  normalizeCanonContext(canonContext).referencePacks
    .filter((entry) => entry.enabled !== false)
    .map((entry) => entry.id),
);

// Selected packs are author configuration; active packs are the subset the
// current authority policy actually permits the runtime to consult. Keeping
// those concepts separate lets an author temporarily disable reference
// knowledge without losing their pack selection.
export const activeReferencePackIds = (canonContext = {}) => {
  const context = normalizeCanonContext(canonContext);
  if (context.referenceAuthority === "none") return [];
  return enabledReferencePackIds(context);
};

/**
 * Explicit upgrade boundary. This is the ONLY helper in this module that
 * writes canonModelVersion. It is intended for an author action or final
 * Political World Apply, never ordinary scenario reads/saves.
 */
export const materializeScenarioCanon = (world = {}, {
  canonContext,
  institutions,
  agreements,
  politicalActors,
  powerStatus,
  wars,
  relations,
} = {}) => {
  const next = clone(object(world));
  next.canonModelVersion = CANON_MODEL_VERSION;
  next.canonContext = normalizeCanonContext(canonContext ?? next.canonContext ?? {});

  // Only replace owning ledgers explicitly provided by the caller. Existing
  // state survives the upgrade, and absent legacy fields are not synthesized
  // merely because the world became current.
  if (institutions !== undefined) next.institutions = clone(institutions);
  if (agreements !== undefined) next.agreements = clone(agreements);
  if (politicalActors !== undefined) next.politicalActors = clone(politicalActors);
  if (powerStatus !== undefined) next.powerStatus = clone(powerStatus);
  if (wars !== undefined) next.wars = clone(wars);
  if (relations !== undefined) next.relations = clone(relations);

  return next;
};

export const updateScenarioCanonContext = (world = {}, canonContext = {}) => materializeScenarioCanon(world, {
  canonContext,
});

const actorRecordCount = (world = {}) => Object.keys(object(world?.politicalActors?.byPolity)).length;
const institutionCount = (world = {}) => Object.keys(normalizeInstitutions(world?.institutions, world).byId).length;
const powerRecordCount = (world = {}) => Object.keys(object(world?.powerStatus?.byPolity)).length;

export const summarizeScenarioCanon = (world = {}) => {
  const view = readScenarioCanon(world);
  return {
    mode: view.mode,
    version: view.version,
    initialized: view.initialized,
    universeId: clean(view.canonContext?.universe?.id),
    universeType: clean(view.canonContext?.universe?.type),
    referencePackIds: enabledReferencePackIds(view.canonContext),
    politicalActors: actorRecordCount(world),
    institutions: institutionCount(world),
    agreements: array(world?.agreements).length,
    wars: array(world?.wars).length,
    relations: array(world?.relations).length,
    powerStatus: powerRecordCount(world),
  };
};
