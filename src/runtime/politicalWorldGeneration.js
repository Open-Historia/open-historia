/*! Open Historia — Political World generation contract (Phase006A) */

import {
  normalizePoliticalActorRecord,
  POLITICAL_REPRESENTATIONS,
} from "./politicalActors.js";
import { isReferenceDatePermitted } from "./scenarioHistoryAuthority.js";
import { validatePoliticalTraitPatch } from "./politicalTraitRegistry.js";

export const POLITICAL_WORLD_GENERATION_SCHEMA_VERSION = 1;

export const POLITICAL_GENERATION_DEPTHS = Object.freeze({
  MINIMAL: "minimal",
  STANDARD: "standard",
  RICH: "rich",
  FULL: "full",
});

export const POLITICAL_GENERATION_SOURCES = Object.freeze({
  GENERATED: "generated",
  CURATED: "curated",
  AUTHORED: "authored",
  CAMPAIGN_CREATED: "campaign-created",
});

export const POLITICAL_GENERATION_SOURCE_AUTHORITY = Object.freeze({
  [POLITICAL_GENERATION_SOURCES.GENERATED]: 0,
  [POLITICAL_GENERATION_SOURCES.CURATED]: 1,
  [POLITICAL_GENERATION_SOURCES.AUTHORED]: 2,
  [POLITICAL_GENERATION_SOURCES.CAMPAIGN_CREATED]: 3,
});

export const comparePoliticalGenerationAuthority = (left, right) => {
  const leftRank = POLITICAL_GENERATION_SOURCE_AUTHORITY[clean(left).toLocaleLowerCase()] ?? -1;
  const rightRank = POLITICAL_GENERATION_SOURCE_AUTHORITY[clean(right).toLocaleLowerCase()] ?? -1;
  return leftRank === rightRank ? 0 : (leftRank > rightRank ? 1 : -1);
};

export const POLITICAL_GENERATION_CONFIDENCE = Object.freeze({
  LOW: "low",
  MODERATE: "moderate",
  HIGH: "high",
  UNKNOWN: "unknown",
});

export const POLITICAL_GENERATION_NEEDS = Object.freeze({
  POLITICAL_SYSTEM: "political_system",
  GOVERNING_STRUCTURE: "governing_structure",
  REPRESENTATION_ENTITIES: "representation_entities",
  QUANTITATIVE_LANDSCAPE: "quantitative_landscape",
  LEADERSHIP_TRAITS: "structured_leadership_traits",
  RESPONSE_PROFILES: "entity_response_profiles",
  GOVERNING_ENTITY_CONTEXT: "governing_entity_context",
  STRATEGIC_CONTEXT: "strategic_context",
  PERCEPTIONS: "structured_perceptions",
  DOMESTIC_CONTEXT: "domestic_context",
});

// PWV2-007: generated electoral rosters must explain most of the political
// landscape with real named forces. A residual around a quarter of support can
// still represent genuinely diffuse micro-parties/independents; larger generated
// residuals are too politically important to remain anonymous. This gate applies
// only to generated-estimate Round-Zero landscapes, never authored/campaign state
// and never non-electoral influence systems where percentages are not comparable.
export const POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN = 75;

const DEPTH_ORDER = Object.freeze({
  [POLITICAL_GENERATION_DEPTHS.FULL]: 0,
  [POLITICAL_GENERATION_DEPTHS.RICH]: 1,
  [POLITICAL_GENERATION_DEPTHS.STANDARD]: 2,
  [POLITICAL_GENERATION_DEPTHS.MINIMAL]: 3,
});

const DEPTH_SET = new Set(Object.values(POLITICAL_GENERATION_DEPTHS));
const REPRESENTATION_SET = new Set(Object.values(POLITICAL_REPRESENTATIONS));
const CONFIDENCE_SET = new Set(Object.values(POLITICAL_GENERATION_CONFIDENCE));

const GENERATED_ACTOR_FIELDS = new Set([
  "polityKey",
  "name",
  "government",
  "leader",
  "parties",
  "powerBlocs",
  "politicalSystem",
  "goals",
  "fears",
  "ambitions",
  "domesticPressures",
  "tags",
  "traits",
  "perceptions",
]);

const GENERATED_PARTY_FIELDS = new Set([
  "id",
  "name",
  "shortName",
  "aliases",
  "support",
  "influence",
  "ideology",
  "leader",
  "goals",
  "publicPriorities",
  "publicForeignPolicy",
  "publicDescription",
  "color",
  "politicalResponse",
  "internalStrategy",
  "internalPressure",
  "privateGoal",
]);

const GENERATED_BLOC_FIELDS = new Set([
  "id",
  "name",
  "shortName",
  "aliases",
  "influence",
  "politicalResponse",
  "kind",
  "ideology",
  "status",
  "publicDescription",
  "color",
  "leader",
  "goals",
  "publicPriorities",
  "publicForeignPolicy",
  "internalStrategy",
  "internalPressure",
  "privateGoal",
]);

const GENERATED_GOVERNMENT_FIELDS = new Set([
  "form",
  "ideology",
  "status",
  "coalitionName",
  "headOfState",
  "headOfGovernment",
  "approval",
  "stability",
  "rulingPartyIds",
  "coalitionPartyIds",
]);

const GENERATED_POLITICAL_SYSTEM_FIELDS = new Set(["type", "representation", "regimeCharacter", "label", "notes"]);
const FORBIDDEN_GENERATED_FIELDS = new Set(["behavioralDisposition", "politicalPressures"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const hasKeys = (value) => isPlainObject(value) && Object.keys(value).length > 0;
const hasText = (value) => Boolean(clean(value));

const parseScenarioDate = (value) => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return null;
  return { year, month, day, text: match[0] };
};

const compareScenarioDates = (left, right) => {
  for (const key of ["year", "month", "day"]) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
};

export const classifyPoliticalGenerationDepth = (relevance = {}) => {
  if (
    relevance.isPlayer === true ||
    relevance.scenarioCentral === true ||
    relevance.globalPower === true ||
    relevance.activeBelligerent === true ||
    relevance.principalRival === true ||
    relevance.principalAlly === true
  ) {
    return POLITICAL_GENERATION_DEPTHS.FULL;
  }

  if (
    relevance.regionalPower === true ||
    relevance.neighborOfFull === true ||
    relevance.majorInstitutionMember === true ||
    relevance.activeCrisis === true
  ) {
    return POLITICAL_GENERATION_DEPTHS.RICH;
  }

  if (relevance.sovereign !== false) return POLITICAL_GENERATION_DEPTHS.STANDARD;
  return POLITICAL_GENERATION_DEPTHS.MINIMAL;
};

const normalizeDepth = (value) => {
  const depth = clean(value).toLocaleLowerCase();
  return DEPTH_SET.has(depth) ? depth : POLITICAL_GENERATION_DEPTHS.STANDARD;
};

const actorRepresentation = (actor) => {
  const explicit = clean(actor?.politicalSystem?.representation).toLocaleLowerCase();
  if (REPRESENTATION_SET.has(explicit)) return explicit;
  return normalizePoliticalActorRecord(actor ?? {}, actor?.polityKey ?? "")?.politicalSystem?.representation
    ?? POLITICAL_REPRESENTATIONS.NONE;
};

const hasGoverningStructure = (actor) => {
  const government = actor?.government;
  if (!isPlainObject(government)) return false;
  return [
    government.form,
    government.status,
    government.headOfState,
    government.headOfGovernment,
  ].some((value) => hasText(isPlainObject(value) ? value.name : value));
};

const representationEntities = (actor, representation) => {
  if (representation === POLITICAL_REPRESENTATIONS.NONE) return [];
  if (representation === POLITICAL_REPRESENTATIONS.ELECTORAL) {
    return Array.isArray(actor?.parties) ? actor.parties : [];
  }
  if (representation === POLITICAL_REPRESENTATIONS.PARTY_STATE) {
    return [
      ...(Array.isArray(actor?.parties) ? actor.parties : []),
      ...(Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : []),
    ];
  }
  return Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : [];
};

const residualRepresentationEntity = (entity) => {
  const id = clean(entity?.id).toLocaleLowerCase();
  const name = clean(entity?.name || entity?.shortName).toLocaleLowerCase();
  return /^(?:other|others|other-parties|other_parties|independent|independents)$/.test(id)
    || /^(?:other|others|other parties|independent|independents)$/.test(name);
};

const generatedLandscapeBasis = (entity, metric) => clean(entity?.[metric]?.basis).toLocaleLowerCase();

export const assessPoliticalRepresentationCoverage = (actor, { requireGeneratedCoverage = false } = {}) => {
  const representation = actorRepresentation(actor);
  const entities = representationEntities(actor, representation);
  if (representation === POLITICAL_REPRESENTATIONS.NONE) {
    return { complete: true, representation, namedCoverage: 100, residual: 0, generatedBaseline: false };
  }
  if (!entities.length) {
    return { complete: false, representation, namedCoverage: 0, residual: 100, generatedBaseline: false, reason: "missing-representation-entities" };
  }
  if (!requireGeneratedCoverage || representation !== POLITICAL_REPRESENTATIONS.ELECTORAL) {
    return { complete: true, representation, namedCoverage: null, residual: null, generatedBaseline: false };
  }

  const parties = Array.isArray(actor?.parties) ? actor.parties : [];
  const generatedBaseline = parties.some((party) => {
    const basis = generatedLandscapeBasis(party, "support");
    return basis === "generated-estimate" || basis === "native-fallback-estimate";
  });
  // Authored/curated/campaign support is deliberately not judged by this native
  // generator sufficiency heuristic. Scenario canon remains authoritative.
  if (!generatedBaseline) {
    return { complete: true, representation, namedCoverage: null, residual: null, generatedBaseline: false };
  }

  let namedCoverage = 0;
  let reliableNamedCoverage = 0;
  for (const party of parties) {
    if (residualRepresentationEntity(party)) continue;
    const percent = landscapePercent(party?.support);
    if (percent == null) continue;
    namedCoverage += percent;
    // Native fallback shares exist to prevent undefined quantitative state, but
    // they cannot prove that the roster itself is sufficiently broad. Only
    // provider/generated estimates (plus pre-existing authored percentages) are
    // evidence for this Round-Zero coverage gate.
    if (generatedLandscapeBasis(party, "support") !== "native-fallback-estimate") reliableNamedCoverage += percent;
  }
  namedCoverage = Math.round(Math.min(100, namedCoverage) * 10) / 10;
  reliableNamedCoverage = Math.round(Math.min(100, reliableNamedCoverage) * 10) / 10;
  const residual = Math.round(Math.max(0, 100 - namedCoverage) * 10) / 10;
  const complete = reliableNamedCoverage + 0.05 >= POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN;
  return {
    complete,
    representation,
    namedCoverage,
    reliableNamedCoverage,
    residual,
    generatedBaseline: true,
    ...(complete ? {} : { reason: "insufficient-generated-electoral-coverage" }),
  };
};

const hasRepresentationEntities = (actor, representation, { requireGeneratedCoverage = false } = {}) => {
  if (representation === POLITICAL_REPRESENTATIONS.NONE) return true;
  if (!representationEntities(actor, representation).length) return false;
  return assessPoliticalRepresentationCoverage(actor, { requireGeneratedCoverage }).complete;
};

const landscapePercent = (value) => {
  const number = Number(value?.percent ?? value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
};

const quantitativeLandscapeEntities = (actor, representation) => {
  if (representation === POLITICAL_REPRESENTATIONS.NONE) {
    const blocs = Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : [];
    return blocs.length
      ? { entities: blocs, metric: "influence", collection: "powerBlocs" }
      : { entities: [], metric: "none", collection: "" };
  }
  if (representation === POLITICAL_REPRESENTATIONS.ELECTORAL) {
    return { entities: Array.isArray(actor?.parties) ? actor.parties : [], metric: "support", collection: "parties" };
  }
  if (representation === POLITICAL_REPRESENTATIONS.PARTY_STATE) {
    const blocs = Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : [];
    if (blocs.length) return { entities: blocs, metric: "influence", collection: "powerBlocs" };
    return { entities: Array.isArray(actor?.parties) ? actor.parties : [], metric: "influence", collection: "parties" };
  }
  return { entities: Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : [], metric: "influence", collection: "powerBlocs" };
};

const hasQuantitativePoliticalLandscape = (actor, representation) => {
  const { entities, metric } = quantitativeLandscapeEntities(actor, representation);
  if (!entities.length || metric === "none") return representation === POLITICAL_REPRESENTATIONS.NONE;
  return entities.every((entity) => landscapePercent(entity?.[metric]) != null);
};

const hasResponseProfiles = (actor, representation) => {
  const entities = representationEntities(actor, representation);
  if (!entities.length) return representation === POLITICAL_REPRESENTATIONS.NONE;

  // RICH/FULL generation asks for reusable hidden response metadata for every
  // represented entity, including deliberately-unpolled coalition members.
  // Party-states may legitimately expose the ruling party, internal power blocs,
  // or both; every represented entity still needs reusable response metadata.
  return entities.every((entity) => hasKeys(entity?.politicalResponse));
};

const hasDirectionalEntityContext = (entity) => (
  hasText(entity?.ideology)
  && [entity?.goals, entity?.publicPriorities, entity?.publicForeignPolicy]
    .some((value) => Array.isArray(value) && value.some(hasText))
);

const governingRepresentationEntities = (actor, representation) => {
  if (representation === POLITICAL_REPRESENTATIONS.NONE) return [];
  const entities = representationEntities(actor, representation);
  if (!entities.length) return [];

  const governingIds = new Set([
    ...(Array.isArray(actor?.government?.rulingPartyIds) ? actor.government.rulingPartyIds : []),
    ...(Array.isArray(actor?.government?.coalitionPartyIds) ? actor.government.coalitionPartyIds : []),
  ].map(clean).filter(Boolean));
  const explicit = entities.filter((entity) => {
    const id = clean(entity?.id);
    const status = clean(entity?.status).toLocaleLowerCase();
    return (id && governingIds.has(id))
      || entity?.ruling === true
      || entity?.coalition === true
      || ["ruling", "governing", "dominant"].includes(status);
  });
  // Political Actor generation runs before the dedicated governing-alignment
  // repair. A fresh roster can therefore lack ruling ids even though its first
  // represented force is the only available current governing-force anchor.
  // Check that provisional anchor rather than deadlocking actor generation on a
  // later phase that cannot run until actor generation completes.
  return explicit.length ? explicit : entities.slice(0, 1);
};

const hasGoverningEntityContext = (actor, representation) => {
  if (representation === POLITICAL_REPRESENTATIONS.NONE) return true;
  const governing = governingRepresentationEntities(actor, representation);
  return governing.length > 0 && governing.every(hasDirectionalEntityContext);
};

const hasStrategicContext = (actor) => {
  const hasNationalStrategy = [actor?.goals, actor?.fears, actor?.ambitions]
    .some((value) => Array.isArray(value) && value.length > 0);
  const hasGovernmentIdeology = hasText(actor?.government?.ideology);
  return hasNationalStrategy && hasGovernmentIdeology;
};

const hasBehaviorallyCompleteStrategicContext = (actor) => (
  [actor?.goals, actor?.fears, actor?.ambitions]
    .every((value) => Array.isArray(value) && value.some(hasText))
  && hasText(actor?.government?.ideology)
);

const hasBehavioralDomesticContext = (actor) => (
  Array.isArray(actor?.domesticPressures) && actor.domesticPressures.some(hasText)
);

const hasDomesticContext = (actor) => (
  (Array.isArray(actor?.domesticPressures) && actor.domesticPressures.length > 0) ||
  Number.isFinite(Number(actor?.government?.approval)) ||
  Number.isFinite(Number(actor?.government?.stability))
);

export const assessPoliticalGenerationNeeds = (
  actorInput,
  depthInput = POLITICAL_GENERATION_DEPTHS.STANDARD,
  { behaviorallyCompleteStandard = false, requireRepresentationCoverage = false } = {},
) => {
  const actor = isPlainObject(actorInput) ? actorInput : {};
  const depth = normalizeDepth(depthInput);
  const representation = actorRepresentation(actor);
  const needs = [];

  const politicalSystem = actor?.politicalSystem;
  const type = clean(politicalSystem?.type).toLocaleLowerCase();
  const explicitRepresentation = clean(politicalSystem?.representation).toLocaleLowerCase();
  const systemUnknown = !type || type === "unspecified" || !REPRESENTATION_SET.has(explicitRepresentation);
  if (systemUnknown) needs.push(POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM);

  // When representation itself is unknown, downstream completeness cannot be
  // inferred from the current actor yet. Request the depth-appropriate shape in
  // the SAME bounded proposal; once the model selects the regime, a native
  // post-validation completeness pass decides which of these needs actually
  // apply (for example representation=none needs no party/bloc roster).
  if (systemUnknown || (!hasGoverningStructure(actor) && representation !== POLITICAL_REPRESENTATIONS.NONE)) {
    needs.push(POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE);
  }

  // A living political landscape is baseline state, not a richness upgrade.
  // Even MINIMAL actors need a representation roster and a numeric starting
  // distribution so campaign political dynamics have somewhere to move from.
  if (systemUnknown || !hasRepresentationEntities(actor, representation, { requireGeneratedCoverage: requireRepresentationCoverage })) {
    needs.push(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES);
  }
  if (systemUnknown || !hasQuantitativePoliticalLandscape(actor, representation)) {
    needs.push(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE);
  }
  if (depth === POLITICAL_GENERATION_DEPTHS.MINIMAL) return needs;

  const behavioralFloor = behaviorallyCompleteStandard === true && depth !== POLITICAL_GENERATION_DEPTHS.MINIMAL;
  if (depth === POLITICAL_GENERATION_DEPTHS.STANDARD && !behavioralFloor) return needs;

  if (!hasKeys(actor?.traits)) needs.push(POLITICAL_GENERATION_NEEDS.LEADERSHIP_TRAITS);
  if (depth !== POLITICAL_GENERATION_DEPTHS.STANDARD && (systemUnknown || !hasResponseProfiles(actor, representation))) {
    needs.push(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES);
  }
  if (!(behavioralFloor ? hasBehaviorallyCompleteStrategicContext(actor) : hasStrategicContext(actor))) {
    needs.push(POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT);
  }
  if (behavioralFloor && (systemUnknown || !hasGoverningEntityContext(actor, representation))) {
    needs.push(POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT);
  }
  if (behavioralFloor) {
    if (!hasKeys(actor?.perceptions)) needs.push(POLITICAL_GENERATION_NEEDS.PERCEPTIONS);
    if (!hasBehavioralDomesticContext(actor)) needs.push(POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT);
  }

  // Political World v2 treats STANDARD as a compact political organism rather
  // than an identity card. Legacy Phase006 callers keep the old STANDARD
  // contract unless they explicitly opt into behaviorallyCompleteStandard.
  if (depth === POLITICAL_GENERATION_DEPTHS.STANDARD) return needs;

  if (depth === POLITICAL_GENERATION_DEPTHS.RICH) return needs;

  if (!behavioralFloor) {
    if (!hasKeys(actor?.perceptions)) needs.push(POLITICAL_GENERATION_NEEDS.PERCEPTIONS);
    if (!hasDomesticContext(actor)) needs.push(POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT);
  }
  return needs;
};

const normalizePolityInput = (entry) => {
  if (typeof entry === "string") return { polityKey: clean(entry), sovereign: true };
  if (!isPlainObject(entry)) return null;
  const polityKey = clean(entry.polityKey ?? entry.key ?? entry.name ?? entry.id);
  if (!polityKey) return null;
  return { ...entry, polityKey };
};

export const buildPoliticalGenerationPlan = ({
  polities = [],
  politicalActors = null,
  relevanceByPolity = {},
  scenarioDate = "",
  maxBatchSize = 6,
  behaviorallyCompleteStandard = false,
  requireRepresentationCoverage = false,
} = {}) => {
  const parsedDate = parseScenarioDate(scenarioDate);
  if (!parsedDate) throw new Error("Political generation requires scenarioDate in YYYY-MM-DD form");

  const byPolity = politicalActors?.byPolity && isPlainObject(politicalActors.byPolity)
    ? politicalActors.byPolity
    : {};
  const unique = new Map();
  for (const rawEntry of polities) {
    const entry = normalizePolityInput(rawEntry);
    if (!entry || unique.has(entry.polityKey)) continue;
    unique.set(entry.polityKey, entry);
  }

  const items = [];
  for (const entry of unique.values()) {
    const relevance = {
      sovereign: entry.sovereign !== false,
      ...(isPlainObject(relevanceByPolity?.[entry.polityKey]) ? relevanceByPolity[entry.polityKey] : {}),
    };
    const depth = normalizeDepth(relevance.depth || classifyPoliticalGenerationDepth(relevance));
    const actor = byPolity[entry.polityKey] ?? null;
    const needs = assessPoliticalGenerationNeeds(actor, depth, {
      behaviorallyCompleteStandard,
      requireRepresentationCoverage,
    });
    if (!needs.length) continue;
    items.push({
      polityKey: entry.polityKey,
      depth,
      needs,
      hasExistingActor: Boolean(actor),
      // Normalization materializes an unknown sparse actor as
      // politicalSystem={type:"unspecified",representation:"none"} plus empty
      // roster/government-ref arrays. That shape is not authored closure. Carry
      // the distinction through the generation item so v2 may hydrate only
      // those placeholders without opening a real authored empty roster.
      sparsePlaceholderHydration: Boolean(actor)
        && clean(actor?.politicalSystem?.type).toLocaleLowerCase() === "unspecified"
        && clean(actor?.politicalSystem?.representation).toLocaleLowerCase() === POLITICAL_REPRESENTATIONS.NONE,
    });
  }

  items.sort((left, right) => (
    (DEPTH_ORDER[left.depth] - DEPTH_ORDER[right.depth]) || left.polityKey.localeCompare(right.polityKey)
  ));

  const batchSize = Math.max(1, Math.min(12, Math.trunc(Number(maxBatchSize)) || 6));
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return {
    schemaVersion: POLITICAL_WORLD_GENERATION_SCHEMA_VERSION,
    scenarioDate: parsedDate.text,
    items,
    batches,
  };
};

const validateKnownFields = (object, allowed, prefix, errors) => {
  if (!isPlainObject(object)) return;
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) errors.push(`${prefix}.${key} is not part of the Phase006A generation contract`);
  }
};

const validateGeneratedEntities = (entities, { kind, allowedFields, errors, existingIds = new Set() }) => {
  if (entities === undefined) return;
  if (!Array.isArray(entities)) {
    errors.push(`${kind} must be an array when generated`);
    return;
  }
  const seen = new Set();
  for (const [index, entity] of entities.entries()) {
    if (!isPlainObject(entity)) {
      errors.push(`${kind}[${index}] must be an object`);
      continue;
    }
    validateKnownFields(entity, allowedFields, `${kind}[${index}]`, errors);
    const id = clean(entity.id);
    const name = clean(entity.name);
    if (!id) errors.push(`${kind}[${index}] requires an explicit stable id`);
    if (!name && (!id || !existingIds.has(id))) errors.push(`${kind}[${index}] requires a display name`);
    if (id) {
      if (seen.has(id)) errors.push(`${kind} contains duplicate id ${id}`);
      seen.add(id);
    }
  }
};

const validateCrossCollectionEntityIds = ({
  parties,
  powerBlocs,
  existingPartyIds = new Set(),
  existingPowerBlocIds = new Set(),
  errors,
}) => {
  const generatedPartyIds = new Set((Array.isArray(parties) ? parties : [])
    .map((entity) => clean(entity?.id)).filter(Boolean));
  const generatedPowerBlocIds = new Set((Array.isArray(powerBlocs) ? powerBlocs : [])
    .map((entity) => clean(entity?.id)).filter(Boolean));

  for (const id of generatedPartyIds) {
    if (generatedPowerBlocIds.has(id) || existingPowerBlocIds.has(id)) {
      errors.push(`Political Actor entity id ${id} may not exist in both parties and powerBlocs`);
    }
  }
  for (const id of generatedPowerBlocIds) {
    if (existingPartyIds.has(id)) {
      errors.push(`Political Actor entity id ${id} may not exist in both parties and powerBlocs`);
    }
  }
};

const hasExplicitPartyStateStructure = (patch) => {
  const systemType = clean(patch?.politicalSystem?.type).toLocaleLowerCase().replace(/[_-]+/g, " ");
  const governmentForm = clean(patch?.government?.form).toLocaleLowerCase().replace(/[_-]+/g, " ");
  const joined = `${systemType} ${governmentForm}`.replace(/\s+/g, " ").trim();

  // "Dominant-party" describes an incumbent advantage inside a broader political
  // field; it is not evidence that the party and state are structurally fused.
  // Reject both normal wording (dominant party) and the model's observed retry
  // evasion (one party dominant ...) before checking true party-state markers.
  if (/\bdominant party\b|\bparty dominant\b/.test(joined)) return false;

  // This field is already restricted to politicalSystem.type / government.form,
  // so once dominant-party wording has been excluded, an explicit one-party or
  // single-party marker is itself sufficient structural evidence. Do not require
  // the next noun to be exactly "state/system/regime/rule/government": real forms
  // such as "one-party presidential republic", "one-party socialist republic",
  // and "single-party communist state" are equally explicit party-state claims.
  return /\b(?:one|single) party\b|\bvanguard party\b|\bparty state\b|\bparty led\b|\bparty rule\b|\bparty supremacy\b/.test(joined);
};

const validatePoliticalSystemSemantics = (patch, errors) => {
  const representation = clean(patch?.politicalSystem?.representation).toLocaleLowerCase().replace(/[ -]+/g, "_");
  if (representation !== POLITICAL_REPRESENTATIONS.PARTY_STATE) return;
  if (hasExplicitPartyStateStructure(patch)) return;
  errors.push(
    "actorPatch.politicalSystem.representation=party_state requires explicit one-party/vanguard-party structural evidence in politicalSystem.type or government.form; dominant-party or generic republic systems must use electoral or an appropriate factional representation",
  );
};

const validateReferenceList = (value, knownIds, path, errors) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of stable party ids`);
    return;
  }
  for (const rawId of value) {
    const id = clean(rawId);
    if (!id || !knownIds.has(id)) errors.push(`${path} references unknown party id ${id || "<blank>"}`);
  }
};

const mergeEntityArray = (existing, generated, path, appliedPaths, { allowEntityExpansion, fillSparseActorPlaceholders }) => {
  if (!Array.isArray(existing) || (fillSparseActorPlaceholders === true && existing.length === 0 && generated.length > 0)) {
    appliedPaths.push(path);
    return clone(generated);
  }
  const out = clone(existing);
  const byId = new Map(out.map((entry, index) => [clean(entry?.id), { entry, index }]).filter(([id]) => id));
  for (const generatedEntity of generated) {
    const id = clean(generatedEntity?.id);
    const match = id ? byId.get(id) : null;
    if (match) {
      out[match.index] = mergeMissingValue(match.entry, generatedEntity, `${path}[${id}]`, appliedPaths, { allowEntityExpansion });
      continue;
    }
    if (allowEntityExpansion) {
      out.push(clone(generatedEntity));
      appliedPaths.push(`${path}[${id || out.length - 1}]`);
    }
  }
  return out;
};

const EMPTY_GOVERNMENT_PARTY_REF_PATHS = new Set(["government.rulingPartyIds", "government.coalitionPartyIds"]);
const SPARSE_POLITICAL_SYSTEM_PLACEHOLDERS = Object.freeze({
  "politicalSystem.type": new Set(["", "unspecified"]),
  "politicalSystem.representation": new Set(["", POLITICAL_REPRESENTATIONS.NONE]),
});

const mergeMissingValue = (existing, generated, path, appliedPaths, options) => {
  if (!isPlainObject(generated)) return existing;
  const out = isPlainObject(existing) ? clone(existing) : {};
  for (const [key, generatedValue] of Object.entries(generated)) {
    const nextPath = path ? `${path}.${key}` : key;
    const sparsePlaceholders = SPARSE_POLITICAL_SYSTEM_PLACEHOLDERS[nextPath];
    if (
      options?.fillSparseActorPlaceholders === true
      && sparsePlaceholders
      && sparsePlaceholders.has(clean(out[key]).toLocaleLowerCase())
      && clean(generatedValue)
    ) {
      out[key] = clone(generatedValue);
      appliedPaths.push(nextPath);
      continue;
    }
    if (!hasOwn(out, key)) {
      out[key] = clone(generatedValue);
      appliedPaths.push(nextPath);
      continue;
    }
    // Native fallback percentages are explicitly provisional generator-owned
    // placeholders. A later provider estimate may upgrade that one metric to a
    // generated-estimate, but authored/campaign percentages remain immutable.
    if (
      (key === "support" || key === "influence")
      && isPlainObject(out[key])
      && clean(out[key].basis).toLocaleLowerCase() === "native-fallback-estimate"
      && isPlainObject(generatedValue)
      && clean(generatedValue.basis).toLocaleLowerCase() === "generated-estimate"
    ) {
      out[key] = clone(generatedValue);
      appliedPaths.push(nextPath);
      continue;
    }
    // Phase006D.1 governing-alignment repair is the one narrow exception to
    // ordinary missing-only merge semantics: Political Actor normalization
    // materializes absent government party references as empty arrays. During
    // an explicit repair review only, those normalized empty arrays may be
    // filled from an already-existing party roster. Non-empty canonical refs
    // remain immutable and all other empty authored arrays stay closed.
    if (
      (options?.fillEmptyGovernmentPartyRefs === true || options?.fillSparseActorPlaceholders === true)
      && EMPTY_GOVERNMENT_PARTY_REF_PATHS.has(nextPath)
      && Array.isArray(out[key])
      && out[key].length === 0
      && Array.isArray(generatedValue)
      && generatedValue.length > 0
    ) {
      out[key] = clone(generatedValue);
      appliedPaths.push(nextPath);
      continue;
    }
    if ((key === "parties" || key === "powerBlocs") && Array.isArray(generatedValue)) {
      out[key] = mergeEntityArray(out[key], generatedValue, nextPath, appliedPaths, options);
      continue;
    }
    if (isPlainObject(out[key]) && isPlainObject(generatedValue)) {
      out[key] = mergeMissingValue(out[key], generatedValue, nextPath, appliedPaths, options);
    }
  }
  return out;
};

export const mergeMissingPoliticalActor = (
  existingActor,
  generatedPatch,
  { allowEntityExpansion = false, fillEmptyGovernmentPartyRefs = false, fillSparseActorPlaceholders = false } = {},
) => {
  const appliedPaths = [];
  const actor = mergeMissingValue(
    isPlainObject(existingActor) ? existingActor : {},
    isPlainObject(generatedPatch) ? generatedPatch : {},
    "",
    appliedPaths,
    {
      allowEntityExpansion: allowEntityExpansion === true,
      fillEmptyGovernmentPartyRefs: fillEmptyGovernmentPartyRefs === true,
      fillSparseActorPlaceholders: fillSparseActorPlaceholders === true,
    },
  );
  return { actor, appliedPaths };
};

const landscapeEntityKey = (entity) => clean(entity?.id || entity?.name).toLocaleLowerCase();

const politicalLandscapeFallbackWeight = (entity, actor, { collection, metric }) => {
  const id = clean(entity?.id);
  const government = isPlainObject(actor?.government) ? actor.government : {};
  const ruling = new Set([
    ...(Array.isArray(government.rulingPartyIds) ? government.rulingPartyIds : []),
  ].map(clean));
  const coalition = new Set([
    ...(Array.isArray(government.coalitionPartyIds) ? government.coalitionPartyIds : []),
  ].map(clean));

  if (collection === "parties") {
    if (entity?.ruling === true || (id && ruling.has(id))) return metric === "influence" ? 5 : 3;
    if (entity?.coalition === true || (id && coalition.has(id))) return 2;
    return 1;
  }

  const status = clean(entity?.status || entity?.influence?.label).toLocaleLowerCase().replace(/[ -]+/g, "_");
  const rank = { dominant: 5, ruling: 5, very_strong: 4, strong: 3, moderate: 2, weak: 1, marginal: 0.5 };
  return rank[status] ?? 1;
};

const roundedLandscapeShares = (weights, total) => {
  const boundedTotal = Math.max(0, Math.min(100, Number(total) || 0));
  const safeWeights = weights.map((value) => Math.max(0, Number(value) || 0));
  const weightTotal = safeWeights.reduce((sum, value) => sum + value, 0) || safeWeights.length || 1;
  const shares = safeWeights.map((weight) => Math.round((boundedTotal * (weight || 1) / weightTotal) * 10) / 10);
  const roundedTotal = shares.reduce((sum, value) => sum + value, 0);
  const delta = Math.round((boundedTotal - roundedTotal) * 10) / 10;
  if (shares.length && Math.abs(delta) >= 0.05) {
    const index = shares.reduce((best, value, candidate) => value > shares[best] ? candidate : best, 0);
    shares[index] = Math.max(0, Math.round((shares[index] + delta) * 10) / 10);
  }
  return shares;
};

const setGeneratedLandscapeMetric = (patch, targetEntity, { collection, metric, percent, basis }) => {
  if (!Array.isArray(patch[collection])) patch[collection] = [];
  const key = landscapeEntityKey(targetEntity);
  let entity = patch[collection].find((candidate) => landscapeEntityKey(candidate) === key);
  if (!entity) {
    entity = {
      ...(clean(targetEntity?.id) ? { id: clean(targetEntity.id) } : {}),
      ...(clean(targetEntity?.name) ? { name: clean(targetEntity.name) } : {}),
    };
    patch[collection].push(entity);
  }
  const current = isPlainObject(entity[metric]) ? clone(entity[metric]) : {};
  entity[metric] = {
    ...current,
    percent: Math.max(0, Math.min(100, Math.round(Number(percent) * 10) / 10)),
    basis: clean(basis) || "native-fallback-estimate",
  };
};

// Complete only the quantitative starting landscape. This is a deterministic
// safety net around AI estimates: it never changes authored percentages, never
// adds model calls/retries, and never rewrites political identity. Generated
// estimates are scaled down when they oversubscribe the remaining 100%; omitted
// estimates get a bounded native fallback so no represented actor silently lands
// at an undefined/0% starting state.
export const completeGeneratedPoliticalLandscapePatch = (existingActor, generatedPatch, { allowEntityExpansion = false, fillSparseActorPlaceholders = false } = {}) => {
  if (!isPlainObject(generatedPatch)) return { patch: generatedPatch, warnings: [] };
  const out = clone(generatedPatch);
  const merged = mergeMissingPoliticalActor(existingActor, out, { allowEntityExpansion, fillSparseActorPlaceholders }).actor;
  const polityKey = clean(existingActor?.polityKey || merged?.polityKey);
  const actor = normalizePoliticalActorRecord({ ...merged, ...(polityKey ? { polityKey } : {}) }, polityKey);
  const representation = actorRepresentation(actor);
  const target = quantitativeLandscapeEntities(actor, representation);
  if (!target.entities.length || target.metric === "none") {
    return { patch: out, warnings: [] };
  }

  const existingCollection = Array.isArray(existingActor?.[target.collection]) ? existingActor[target.collection] : [];
  const existingByKey = new Map(existingCollection.map((entity) => [landscapeEntityKey(entity), entity]).filter(([key]) => Boolean(key)));
  const mutable = [];
  let fixedTotal = 0;

  for (const entity of target.entities) {
    const key = landscapeEntityKey(entity);
    const existingEntity = existingByKey.get(key);
    const fixed = landscapePercent(existingEntity?.[target.metric]);
    if (fixed != null) {
      fixedTotal += fixed;
      continue;
    }
    mutable.push({
      entity,
      percent: landscapePercent(entity?.[target.metric]),
      basis: clean(entity?.[target.metric]?.basis),
    });
  }

  const remainingCapacity = Math.max(0, 100 - fixedTotal);
  const known = mutable.filter((entry) => entry.percent != null);
  const missing = mutable.filter((entry) => entry.percent == null);
  let knownTotal = known.reduce((sum, entry) => sum + entry.percent, 0);
  const warnings = [];

  if (knownTotal > remainingCapacity + 0.05 && known.length) {
    const scaled = roundedLandscapeShares(known.map((entry) => entry.percent), remainingCapacity);
    known.forEach((entry, index) => {
      entry.percent = scaled[index];
      setGeneratedLandscapeMetric(out, entry.entity, {
        collection: target.collection,
        metric: target.metric,
        percent: entry.percent,
        basis: entry.basis || "generated-estimate",
      });
    });
    knownTotal = known.reduce((sum, entry) => sum + entry.percent, 0);
    warnings.push(`Normalized generated ${target.metric} estimates to fit the remaining political landscape capacity`);
  }

  if (missing.length) {
    const remainingAfterKnown = Math.max(0, remainingCapacity - knownTotal);
    const fallbackPool = target.entities.length === 1
      ? remainingAfterKnown
      : (known.length === 0
        ? Math.min(remainingAfterKnown, remainingAfterKnown * 0.9)
        : Math.min(remainingAfterKnown, Math.max(5 * missing.length, Math.min(30, remainingAfterKnown * 0.5))));
    const shares = roundedLandscapeShares(
      missing.map((entry) => politicalLandscapeFallbackWeight(entry.entity, actor, target)),
      fallbackPool,
    );
    missing.forEach((entry, index) => {
      setGeneratedLandscapeMetric(out, entry.entity, {
        collection: target.collection,
        metric: target.metric,
        percent: shares[index] ?? 0,
        basis: "native-fallback-estimate",
      });
    });
    warnings.push(`Filled ${missing.length} missing ${target.metric} estimate${missing.length === 1 ? "" : "s"} with native bounded fallback values`);
  }

  return { patch: out, warnings };
};

const proposalReferenceDates = (proposal) => {
  const dates = [];
  if (hasText(proposal?.sourceAsOf)) dates.push(clean(proposal.sourceAsOf));
  if (Array.isArray(proposal?.referenceDates)) {
    for (const value of proposal.referenceDates.slice(0, 32)) if (hasText(value)) dates.push(clean(value));
  }
  return dates;
};

export const validatePoliticalGenerationProposal = (proposal, {
  polityKey,
  scenarioDate,
  depth = POLITICAL_GENERATION_DEPTHS.STANDARD,
  existingActor = null,
  allowEntityExpansion = false,
  fillEmptyGovernmentPartyRefs = false,
  fillSparseActorPlaceholders = false,
  historyAuthority = null,
} = {}) => {
  const errors = [];
  const warnings = [];
  const expectedPolityKey = clean(polityKey);
  const expectedDate = parseScenarioDate(scenarioDate);
  const expectedDepth = normalizeDepth(depth);

  if (!expectedPolityKey) errors.push("A canonical polityKey is required");
  if (!expectedDate) errors.push("A canonical scenarioDate in YYYY-MM-DD form is required");
  if (!isPlainObject(proposal)) {
    return { ok: false, errors: [...errors, "Political generation proposal must be an object"], warnings };
  }

  if (Number(proposal.schemaVersion) !== POLITICAL_WORLD_GENERATION_SCHEMA_VERSION) {
    errors.push(`proposal.schemaVersion must equal ${POLITICAL_WORLD_GENERATION_SCHEMA_VERSION}`);
  }
  if (clean(proposal.polityKey) !== expectedPolityKey) errors.push("proposal.polityKey must match the canonical requested polity");
  if (clean(proposal.scenarioDate) !== expectedDate?.text) errors.push("proposal.scenarioDate must exactly match the scenario start date");
  if (normalizeDepth(proposal.depth) !== expectedDepth || !DEPTH_SET.has(clean(proposal.depth).toLocaleLowerCase())) {
    errors.push("proposal.depth must exactly match the requested generation depth");
  }

  const source = clean(proposal?.provenance?.source).toLocaleLowerCase();
  if (source !== POLITICAL_GENERATION_SOURCES.GENERATED) {
    errors.push("AI political generation proposals must declare provenance.source=generated");
  }
  const confidenceRaw = clean(proposal?.provenance?.confidence).toLocaleLowerCase();
  const confidence = CONFIDENCE_SET.has(confidenceRaw) ? confidenceRaw : POLITICAL_GENERATION_CONFIDENCE.UNKNOWN;
  if (confidenceRaw && !CONFIDENCE_SET.has(confidenceRaw)) warnings.push("Unknown confidence label was normalized to unknown");

  if (expectedDate) {
    for (const rawDate of proposalReferenceDates(proposal)) {
      const parsed = parseScenarioDate(rawDate);
      if (!parsed) {
        errors.push(`reference date ${rawDate} is not a valid YYYY-MM-DD date`);
        continue;
      }
      if (historyAuthority && typeof historyAuthority === "object") {
        if (!isReferenceDatePermitted(parsed.text, historyAuthority)) {
          const cutoff = clean(historyAuthority?.cutoffDate);
          const relation = historyAuthority?.cutoffInclusive ? "through" : "before";
          errors.push(cutoff
            ? `reference date ${rawDate} crosses the external-reference boundary (${relation} ${cutoff})`
            : `reference date ${rawDate} is not permitted because this scenario grants no external-reference authority`);
        }
      } else if (compareScenarioDates(parsed, expectedDate) > 0) {
        // Legacy compatibility for callers that have not yet supplied the
        // universal history-authority object.
        errors.push(`reference date ${rawDate} crosses the scenario-date boundary ${expectedDate.text}`);
      }
    }
  }

  const patch = proposal.actorPatch;
  if (!isPlainObject(patch)) {
    errors.push("proposal.actorPatch must be an object");
    return { ok: false, errors, warnings };
  }

  for (const forbidden of FORBIDDEN_GENERATED_FIELDS) {
    if (hasOwn(patch, forbidden)) errors.push(`actorPatch.${forbidden} is runtime-derived state and may not be AI-authored`);
  }
  validateKnownFields(patch, GENERATED_ACTOR_FIELDS, "actorPatch", errors);
  if (hasOwn(patch, "polityKey") && clean(patch.polityKey) !== expectedPolityKey) {
    errors.push("actorPatch.polityKey must match the canonical requested polity");
  }
  validateKnownFields(patch.government, GENERATED_GOVERNMENT_FIELDS, "actorPatch.government", errors);
  validateKnownFields(patch.politicalSystem, GENERATED_POLITICAL_SYSTEM_FIELDS, "actorPatch.politicalSystem", errors);
  const existingPartyIds = new Set((Array.isArray(existingActor?.parties) ? existingActor.parties : [])
    .map((entity) => clean(entity?.id)).filter(Boolean));
  const existingPowerBlocIds = new Set((Array.isArray(existingActor?.powerBlocs) ? existingActor.powerBlocs : [])
    .map((entity) => clean(entity?.id)).filter(Boolean));
  validateGeneratedEntities(patch.parties, {
    kind: "actorPatch.parties",
    allowedFields: GENERATED_PARTY_FIELDS,
    errors,
    existingIds: existingPartyIds,
  });
  validateGeneratedEntities(patch.powerBlocs, {
    kind: "actorPatch.powerBlocs",
    allowedFields: GENERATED_BLOC_FIELDS,
    errors,
    existingIds: existingPowerBlocIds,
  });
  validateCrossCollectionEntityIds({
    parties: patch.parties,
    powerBlocs: patch.powerBlocs,
    existingPartyIds,
    existingPowerBlocIds,
    errors,
  });
  validatePoliticalSystemSemantics(patch, errors);
  if (patch.traits !== undefined) {
    const traitValidation = validatePoliticalTraitPatch(patch.traits);
    if (traitValidation.error) errors.push(`actorPatch.traits ${traitValidation.error}`);
  }

  const mergedPreview = mergeMissingPoliticalActor(existingActor, patch, {
    allowEntityExpansion,
    fillEmptyGovernmentPartyRefs,
    fillSparseActorPlaceholders,
  });
  const normalizedActor = normalizePoliticalActorRecord(
    { ...mergedPreview.actor, polityKey: expectedPolityKey },
    expectedPolityKey,
  );
  const representation = normalizedActor?.politicalSystem?.representation ?? POLITICAL_REPRESENTATIONS.NONE;

  if (Array.isArray(patch.parties)) {
    for (const party of patch.parties) {
      if (representation !== POLITICAL_REPRESENTATIONS.ELECTORAL && party?.support !== undefined) {
        errors.push("Generated non-electoral political systems may not invent party polling/support percentages");
        break;
      }
      if (representation === POLITICAL_REPRESENTATIONS.ELECTORAL && party?.influence !== undefined) {
        errors.push("Generated electoral political systems must use party support, not party influence percentages");
        break;
      }
      if (representation !== POLITICAL_REPRESENTATIONS.PARTY_STATE && representation !== POLITICAL_REPRESENTATIONS.ELECTORAL && party?.influence !== undefined) {
        errors.push("Generated party influence percentages are reserved for party_state representation");
        break;
      }
    }
  }

  const knownPartyIds = new Set((normalizedActor?.parties ?? []).map((party) => clean(party.id)).filter(Boolean));
  validateReferenceList(patch?.government?.rulingPartyIds, knownPartyIds, "actorPatch.government.rulingPartyIds", errors);
  validateReferenceList(patch?.government?.coalitionPartyIds, knownPartyIds, "actorPatch.government.coalitionPartyIds", errors);

  if (errors.length) return { ok: false, errors, warnings };

  return {
    ok: true,
    errors: [],
    warnings,
    actor: normalizedActor,
    appliedPaths: mergedPreview.appliedPaths,
    provenance: {
      source: POLITICAL_GENERATION_SOURCES.GENERATED,
      scenarioDate: expectedDate.text,
      depth: expectedDepth,
      confidence,
      ...(hasText(proposal?.provenance?.generatedAt) ? { generatedAt: clean(proposal.provenance.generatedAt).slice(0, 40) } : {}),
      ...(hasText(proposal?.sourceAsOf) ? { sourceAsOf: clean(proposal.sourceAsOf) } : {}),
      appliedPaths: [...mergedPreview.appliedPaths],
    },
  };
};
