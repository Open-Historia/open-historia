/*! Open Historia — Political World generation AI orchestration (Phase006B core) */

import {
  POLITICAL_GENERATION_CONFIDENCE,
  POLITICAL_GENERATION_DEPTHS,
  POLITICAL_GENERATION_NEEDS,
  POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN,
  POLITICAL_WORLD_GENERATION_SCHEMA_VERSION,
  assessPoliticalGenerationNeeds,
  buildPoliticalGenerationPlan,
  completeGeneratedPoliticalLandscapePatch,
  validatePoliticalGenerationProposal,
} from "../../runtime/politicalWorldGeneration.js";

export const POLITICAL_WORLD_GENERATOR_RESULT_VERSION = 1;
export const POLITICAL_WORLD_GENERATOR_MAX_ATTEMPTS = 2;
export const POLITICAL_WORLD_HISTORICAL_VERIFICATION_MAX_ATTEMPTS = 2;
export const POLITICAL_WORLD_HISTORICAL_VERIFICATION_BATCH_SIZE = 4;
export const POLITICAL_WORLD_TEMPORAL_SENTINEL_BATCH_SIZE = 12;
export const POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE = 48;
export const POLITICAL_WORLD_LANDSCAPE_FAST_MAX_ATTEMPTS = 2;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const historyAuthorityPromptContract = (historyAuthority, scenarioDate) => {
  const targetDate = clean(scenarioDate);
  if (!historyAuthority || typeof historyAuthority !== "object") {
    return {
      targetDate,
      mode: "legacy",
      referenceRule: `External/reference chronology may be used only through the target start-world date ${targetDate}.`,
      targetRule: `Describe political state ON ${targetDate}; never import developments from after that date.`,
      exactDateReferenceAuthoritative: true,
    };
  }

  const cutoff = clean(historyAuthority.cutoffDate);
  if (historyAuthority.referenceAllowed && cutoff) {
    if (historyAuthority.cutoffInclusive) {
      return {
        targetDate,
        mode: "inclusive",
        referenceRule: `External/reference canon is admissible only THROUGH ${cutoff}.`,
        targetRule: `Describe political state ON ${targetDate}. Scenario-authored canon still outranks conflicting external/reference material.`,
        exactDateReferenceAuthoritative: cutoff === targetDate,
      };
    }
    return {
      targetDate,
      mode: "exclusive",
      referenceRule: `External/reference canon is admissible only BEFORE ${cutoff}. The date ${cutoff} itself and everything after it belong to scenario/derived canon, not external chronology.`,
      targetRule: `Describe political state ON ${targetDate} from scenario canon, authored/derived pregame history, explicit current world state, and only pre-boundary reference evidence. Never snap the target world toward remembered post-boundary reference history.`,
      exactDateReferenceAuthoritative: false,
    };
  }

  return {
    targetDate,
    mode: "none",
    referenceRule: "External/reference chronology has NO authority for this scenario.",
    targetRule: `Describe political state ON ${targetDate} only from scenario canon, authored/derived pregame history, and explicit current world state.`,
    exactDateReferenceAuthoritative: false,
  };
};

const historyAuthorityPromptBlock = (historyAuthority, scenarioDate) => {
  const contract = historyAuthorityPromptContract(historyAuthority, scenarioDate);
  return [
    `TARGET START-WORLD DATE: ${contract.targetDate}.`,
    `REFERENCE AUTHORITY: ${contract.referenceRule}`,
    `TARGET-WORLD AUTHORITY: ${contract.targetRule}`,
  ].join("\n");
};

// Provider transports occasionally normalize a requested polity key into a
// slug/case variant (for example "Republic of Austria" ->
// "republic-of-austria"). Exact canonical identity remains authoritative, but
// the temporal sentinel may safely recover a transport-only variant when it
// maps to exactly one requested polity in the current batch. Ambiguous matches
// deliberately fail closed.
const normalizedPolityTransportKey = (value) => clean(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const buildRequestedPolityTransportResolver = (entries = []) => {
  const exact = new Set();
  const byNormalized = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const canonical = clean(entry?.item?.polityKey);
    if (!canonical) continue;
    exact.add(canonical);
    const normalized = normalizedPolityTransportKey(canonical);
    if (!normalized) continue;
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, new Set());
    byNormalized.get(normalized).add(canonical);
  }
  return (value) => {
    const raw = clean(value);
    if (!raw) return "";
    if (exact.has(raw)) return raw;
    const matches = byNormalized.get(normalizedPolityTransportKey(raw));
    return matches?.size === 1 ? [...matches][0] : "";
  };
};

// A clear sentinel result is allowed to carry harmless affirmative prose even
// though the prompt asks for an empty issue. Gemini has repeatedly returned
// values such as "None" or "All ... are verified and correct". Those are not
// contradictions and must not manufacture an expensive adjudication. We still
// fail closed on any non-trivial/ambiguous text so a sentence such as "clear,
// but NPAD formed four days later" cannot be waved through.
const benignTemporalClearIssue = (value) => {
  const text = clean(value);
  if (!text) return true;
  const normalized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[.!]+$/g, "")
    .trim();
  if (/^(?:none|n\/?a|not applicable|no issues?|no issue found|no issues found|clear|all clear)$/.test(normalized)) return true;

  // `issue` is commentary for a structured `verdict=clear`; Gemini often fills it
  // with affirmative prose instead of leaving it blank. Treat that prose as
  // harmless when it contains no contradiction signal. The structured verdict,
  // complete FACT attestation, and empty challengedFactIds remain authoritative.
  // We still fail closed when the prose itself says a supplied identity is wrong
  // or temporally displaced.
  if (/\b(?:but|however|except|although|incorrect|wrong|mismatch|contradiction|challenge|challenged|anachron(?:ism|istic)?|future history|not yet|not active|not valid|invalid|did not exist|does not exist|was not|were not)\b/.test(normalized)) return false;
  if (/\b(?:after|before) the scenario date\b/.test(normalized)) return false;
  if (/\b(?:founded|formed|created|established|appointed|assumed office|took office|left office|resigned|dissolved|merged|renamed)\b.{0,80}\b(?:after|before)\b/.test(normalized)) return false;

  if (/^(?:all|every)\b/.test(normalized)) return true;
  if (/\b(?:verified|correct|accurate|accurately reflect|valid|temporally valid|match|matches|reflects?|consistent|incumbent|remains|serving|active on|holds? office|held office)\b/.test(normalized)) return true;
  if (/\bis (?:currently )?(?:prime minister|president|king|queen|monarch|chancellor|chairman|chairwoman|head of state|head of government)\b/.test(normalized)) return true;
  return false;
};


// The provider-facing generation tool deliberately transports actorPatch as a
// JSON string (see POLITICAL_WORLD_GENERATION_TOOL below). Keep the executable
// canonical contract in the requested-scope projector + runtime Political Actor
// validator instead of maintaining a second, unused nested JSON schema that can
// drift from what native code actually accepts.

const canonicalIssueKey = (value) => clean(value).toLocaleLowerCase().replace(/[\s.]+/g, "_");

const canonicalizeWirePoliticalResponseIssue = (value) => {
  if (!isPlainObject(value)) return value;
  const out = {};
  const position = Number(value.position ?? value.stance);
  const sensitivity = Number(value.sensitivity ?? value.issueSensitivity);
  const strainResponse = Number(value.strainResponse ?? value.strainAffinity);
  if (Number.isFinite(position)) out.position = position;
  if (Number.isFinite(sensitivity)) out.sensitivity = sensitivity;
  if (Number.isFinite(strainResponse)) out.strainResponse = strainResponse;
  return out;
};

const canonicalizeWirePoliticalResponse = (value) => {
  if (!isPlainObject(value)) return value;
  const out = clone(value);
  if (Array.isArray(out.issues)) {
    const issues = {};
    for (const entry of out.issues.slice(0, 24)) {
      if (!isPlainObject(entry)) continue;
      const key = canonicalIssueKey(entry.issue);
      if (!key) continue;
      const issue = canonicalizeWirePoliticalResponseIssue(entry);
      if (Object.keys(issue).length) issues[key] = issue;
    }
    if (Object.keys(issues).length) out.issues = issues;
    else delete out.issues;
  } else if (isPlainObject(out.issues)) {
    const issues = {};
    for (const [rawKey, rawIssue] of Object.entries(out.issues).slice(0, 24)) {
      const key = canonicalIssueKey(rawKey);
      if (!key) continue;
      // Preserve malformed shorthand values so the native shape validator can
      // reject them explicitly instead of silently degrading C2 semantics.
      issues[key] = isPlainObject(rawIssue)
        ? canonicalizeWirePoliticalResponseIssue(rawIssue)
        : clone(rawIssue);
    }
    if (Object.keys(issues).length) out.issues = issues;
    else delete out.issues;
  }
  return out;
};

const politicalSystemDisplayForm = (value) => {
  if (typeof value === "string") return clean(value);
  if (!isPlainObject(value)) return "";
  const label = clean(value.label);
  if (label) return label;
  const type = clean(value.type).replace(/[_-]+/g, " ");
  return type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : "";
};

const GENERATED_REPRESENTATIONS = Object.freeze({
  ELECTORAL: "electoral",
  COURT_FACTIONS: "court_factions",
  PARTY_STATE: "party_state",
  ELITE_FACTIONS: "elite_factions",
  MILITARY_FACTIONS: "military_factions",
  REVOLUTIONARY_FACTIONS: "revolutionary_factions",
  COLONIAL: "colonial",
  NONE: "none",
});
const GENERATED_REPRESENTATION_SET = new Set(Object.values(GENERATED_REPRESENTATIONS));

const generatedToken = (value) => clean(value)
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const generatedSystemTypeSlug = (rawType) => {
  const original = clean(rawType);
  // System type and representation are independent canonical dimensions. Never
  // let representation=party_state manufacture type=one_party_state (or any
  // other regime type) when the provider actually supplied a different type.
  const joined = original.toLocaleLowerCase();
  // Preserve dominant-party semantics before constitutional-form normalization so
  // the strict party_state evidence gate can still see a provider's attempted
  // "one-party dominant" evasion after canonicalization.
  if (/(?:dominant[ _-]*party|(?:one|single)[ _-]*party[ _-]*dominant)/.test(joined)) {
    return /republic/.test(joined) ? "dominant_party_republic" : "dominant_party_system";
  }
  if (/absolute[ _-]*monarch|emirate|sultanate/.test(joined)) return "absolute_monarchy";
  if (/constitutional[ _-]*monarch/.test(joined)) return "constitutional_monarchy";
  if (/semi[ _-]*presidential/.test(joined)) return "semi_presidential_republic";
  if (/parliamentary.*republic/.test(joined)) return "parliamentary_republic";
  if (/presidential.*republic|federal.*presidential/.test(joined)) return "presidential_republic";
  if (/one[ _-]*party|single[ _-]*party|party[ _-]*state/.test(joined)) return "one_party_state";
  if (/military[ _-]*(junta|regime)/.test(joined)) return "military_regime";
  if (/personalist/.test(joined)) return "personalist_regime";
  if (/revolutionary/.test(joined)) return "revolutionary_government";
  if (/colonial|colony|protectorate|mandate/.test(joined)) return "colonial_administration";
  return original
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "unspecified";
};

const inferGeneratedRepresentation = ({ rawRepresentation = "", rawType = "", governmentForm = "", parties = [], powerBlocs = [] } = {}) => {
  const explicit = clean(rawRepresentation).toLocaleLowerCase().replace(/[ -]+/g, "_");
  if (GENERATED_REPRESENTATION_SET.has(explicit)) return explicit;
  const joined = `${clean(rawRepresentation)} ${clean(rawType)} ${clean(governmentForm)}`.toLocaleLowerCase();
  if (/single[- ]party|one[- ]party|party[- ]state|vanguard party|party bureaucracy|non[- ]competitive.*party/.test(joined)) {
    return GENERATED_REPRESENTATIONS.PARTY_STATE;
  }
  if (/absolute monarch|royal autocracy|hereditary|emirate|sultanate|ruling families|federal national council/.test(joined)) {
    return GENERATED_REPRESENTATIONS.COURT_FACTIONS;
  }
  if (/military[- ]backed|military junta|military regime|armed forces.*rule/.test(joined)) {
    return GENERATED_REPRESENTATIONS.MILITARY_FACTIONS;
  }
  if (/revolutionary/.test(joined)) return GENERATED_REPRESENTATIONS.REVOLUTIONARY_FACTIONS;
  if (/colonial|colony|protectorate|mandate/.test(joined)) return GENERATED_REPRESENTATIONS.COLONIAL;
  if (/elite|executive[- ]dominated|authoritarian|clerical|theocrat|oligarch|personalist|state[- ]dominated|loyalist|conglomerate/.test(joined)) {
    return GENERATED_REPRESENTATIONS.ELITE_FACTIONS;
  }
  if (!/non[- ]competitive/.test(joined) && /competitive|multi[- ]party|representative democracy|parliamentary democracy|congressional democracy|electoral democracy|bicameral.*democracy/.test(joined)) {
    return GENERATED_REPRESENTATIONS.ELECTORAL;
  }
  if (Array.isArray(parties) && parties.length && !(Array.isArray(powerBlocs) && powerBlocs.length)) {
    return GENERATED_REPRESENTATIONS.ELECTORAL;
  }
  if (Array.isArray(powerBlocs) && powerBlocs.length) return GENERATED_REPRESENTATIONS.ELITE_FACTIONS;
  return GENERATED_REPRESENTATIONS.NONE;
};

const canonicalizeGeneratedPoliticalSystem = (value, actorPatch) => {
  const source = typeof value === "string" ? { type: value } : (isPlainObject(value) ? clone(value) : {});
  const representation = inferGeneratedRepresentation({
    rawRepresentation: source.representation,
    rawType: source.type,
    governmentForm: actorPatch?.government?.form,
    parties: actorPatch?.parties,
    powerBlocs: actorPatch?.powerBlocs,
  });
  const rawType = clean(source.type);
  const rawTypeToken = generatedToken(rawType);
  // Representation enums describe HOW political competition/power is organized,
  // not WHAT constitutional/regime system the polity has. If a live model puts a
  // representation enum in politicalSystem.type, derive the system type from the
  // human-readable government form instead of persisting a second misuse of the
  // representation vocabulary (for example type=elite_factions).
  const typeSource = GENERATED_REPRESENTATION_SET.has(rawTypeToken)
    ? clean(actorPatch?.government?.form)
    : (rawType || clean(actorPatch?.government?.form));
  const out = {
    ...source,
    type: generatedSystemTypeSlug(typeSource),
    representation,
  };
  return out;
};

const canonicalizeGovernmentAliases = (government, politicalSystem) => {
  const source = isPlainObject(government) ? clone(government) : {};
  if (!clean(source.form)) {
    const aliasForm = clean(source.type || source.system || source.regime || source.governmentForm);
    const derivedForm = aliasForm || politicalSystemDisplayForm(politicalSystem);
    if (derivedForm) source.form = derivedForm;
  }
  if (source.headOfState == null) {
    const candidate = source.president || source.monarch || source.sovereign || source.king || source.queen || source.emperor || source.emir || source.sultan;
    if (candidate != null) source.headOfState = candidate;
  }
  if (source.headOfGovernment == null) {
    const candidate = source.primeMinister || source.premier || source.chancellor || source.chiefMinister || source.headOfCabinet || source.leader;
    if (candidate != null) source.headOfGovernment = candidate;
  }
  return source;
};

const generatedPartyRefId = (token, parties) => {
  const target = clean(token).toLocaleLowerCase();
  if (!target) return "";
  const match = (Array.isArray(parties) ? parties : []).find((party) => [party?.id, party?.name, party?.shortName]
    .map((value) => clean(value).toLocaleLowerCase())
    .includes(target));
  return clean(match?.id);
};

const appendUniqueGeneratedEntities = (existing, additions) => {
  const out = Array.isArray(existing) ? clone(existing) : [];
  const ids = new Set(out.map((entity) => clean(entity?.id)).filter(Boolean));
  for (const entity of additions) {
    const id = clean(entity?.id);
    if (id && ids.has(id)) continue;
    out.push(clone(entity));
    if (id) ids.add(id);
  }
  return out;
};

const topLevelRepresentationEntityCollection = (entity, representation) => {
  if (representation === GENERATED_REPRESENTATIONS.ELECTORAL) return "parties";
  const hint = [entity?.type, entity?.role, entity?.kind, entity?.powerType, entity?.id, entity?.name]
    .map((value) => clean(value).toLocaleLowerCase())
    .join(" ");
  if (representation === GENERATED_REPRESENTATIONS.PARTY_STATE) {
    if (/party|vanguard|ruling[_ -]?party|communist/.test(hint)) return "parties";
  }
  return "powerBlocs";
};

const canonicalizeTopLevelRepresentationEntities = (actorPatch) => {
  if (!Array.isArray(actorPatch?.representation)) return actorPatch;
  const source = actorPatch.representation.filter(isPlainObject);
  const representation = inferGeneratedRepresentation({
    rawRepresentation: actorPatch?.politicalSystem?.representation,
    rawType: actorPatch?.politicalSystem?.type,
    governmentForm: actorPatch?.government?.form,
    parties: actorPatch?.parties,
    powerBlocs: actorPatch?.powerBlocs,
  });
  const parties = [];
  const powerBlocs = [];
  for (const entity of source) {
    const collection = topLevelRepresentationEntityCollection(entity, representation);
    const next = clone(entity);
    if (collection === "parties") {
      const role = generatedToken(next.role);
      if (role === "ruling_party" || role === "ruling") next.ruling = true;
      if (role === "coalition_partner" || role === "coalition") next.coalition = true;
      delete next.type;
      delete next.powerType;
      delete next.role;
      parties.push(next);
    } else {
      if (!clean(next.kind)) {
        const kind = clean(next.powerType || next.type || next.role);
        if (kind) next.kind = kind;
      }
      delete next.type;
      delete next.powerType;
      delete next.role;
      powerBlocs.push(next);
    }
  }
  if (parties.length) actorPatch.parties = appendUniqueGeneratedEntities(actorPatch.parties, parties);
  if (powerBlocs.length) actorPatch.powerBlocs = appendUniqueGeneratedEntities(actorPatch.powerBlocs, powerBlocs);
  delete actorPatch.representation;
  return actorPatch;
};

const generatedEstimateShare = (primaryValue, estimateValue, { allowLabel = false } = {}) => {
  const source = isPlainObject(primaryValue) ? primaryValue : {};
  const rawPercent = estimateValue ?? source.percent ?? (typeof primaryValue === "number" ? primaryValue : undefined);
  const number = Number(rawPercent);
  const percent = Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 10) / 10)) : null;
  const label = allowLabel ? clean(source.label) : "";
  if (percent == null && !label) return null;
  return {
    ...(percent != null ? { percent, basis: "generated-estimate" } : {}),
    ...(label ? { label } : {}),
  };
};

const canonicalizeRepresentationAliases = (actorPatch) => {
  const out = actorPatch;
  const hasParties = Array.isArray(out.parties);
  const parties = hasParties ? out.parties : [];
  const hasGovernment = isPlainObject(out.government);
  const government = hasGovernment ? out.government : {};
  const rulingIds = new Set(Array.isArray(government.rulingPartyIds) ? government.rulingPartyIds.map(clean).filter(Boolean) : []);
  const coalitionIds = new Set(Array.isArray(government.coalitionPartyIds) ? government.coalitionPartyIds.map(clean).filter(Boolean) : []);

  for (const token of [
    ...(Array.isArray(government.rulingParties) ? government.rulingParties : []),
    ...(government.rulingParty != null ? [government.rulingParty] : []),
  ]) {
    const id = generatedPartyRefId(token, parties);
    if (id) rulingIds.add(id);
  }
  if (Array.isArray(government.coalition)) {
    for (const token of government.coalition) {
      const id = generatedPartyRefId(token, parties);
      if (id) coalitionIds.add(id);
    }
  } else if (clean(government.coalition) && !clean(government.coalitionName)) {
    government.coalitionName = clean(government.coalition);
  }

  if (hasParties) out.parties = parties.map((party) => {
    if (!isPlainObject(party)) return party;
    const next = clone(party);
    const role = generatedToken(next.role);
    if ((next.ruling === true || role === "ruling_party" || role === "ruling") && clean(next.id)) rulingIds.add(clean(next.id));
    if ((next.coalition === true || role === "coalition_partner" || role === "coalition") && clean(next.id)) coalitionIds.add(clean(next.id));
    delete next.role;
    delete next.ruling;
    delete next.coalition;
    // Phase006D owns a Round-Zero quantitative baseline. Provider numbers are
    // never promoted to measured polling: native code stamps them explicitly as
    // generated estimates so the UI can say Approximate and later campaign
    // mutations can replace that basis with campaign-derived state.
    const support = generatedEstimateShare(next.support, next.supportEstimate);
    if (support) next.support = support;
    else delete next.support;
    const influence = generatedEstimateShare(next.influence, next.influenceEstimate, { allowLabel: true });
    if (influence) next.influence = influence;
    else delete next.influence;
    delete next.supportEstimate;
    delete next.influenceEstimate;
    return next;
  });

  if (rulingIds.size) government.rulingPartyIds = [...rulingIds];
  if (coalitionIds.size) government.coalitionPartyIds = [...coalitionIds];
  delete government.rulingParties;
  delete government.rulingParty;
  delete government.coalition;
  if (hasGovernment || Object.keys(government).length) out.government = government;

  if (Array.isArray(out.powerBlocs)) {
    out.powerBlocs = out.powerBlocs.map((bloc) => {
      if (!isPlainObject(bloc)) return bloc;
      const next = clone(bloc);
      if (!clean(next.kind)) {
        const kind = clean(next.role || next.powerType);
        if (kind) next.kind = kind;
      }
      if (next.ruling === true && !clean(next.status)) next.status = "ruling";
      const influence = generatedEstimateShare(next.influence, next.influenceEstimate, { allowLabel: true });
      if (influence) next.influence = influence;
      else delete next.influence;
      delete next.influenceEstimate;
      delete next.role;
      delete next.powerType;
      delete next.ruling;
      return next;
    });
  }
  return out;
};

const canonicalizeGeneratedLeaderAliases = (actorPatch) => {
  if (!isPlainObject(actorPatch?.leader)) return actorPatch;
  const leader = clone(actorPatch.leader);

  // Live Gemini retries sometimes nest the requested leadership profile under
  // leader.traits even though Political Actors own traits at the actor root.
  // Promote only when the canonical root is absent; authored/explicit root
  // traits always win. Keep the remaining officeholder identity intact.
  if ((!isPlainObject(actorPatch.traits) || !Object.keys(actorPatch.traits).length)
      && isPlainObject(leader.traits)
      && Object.keys(leader.traits).length) {
    actorPatch.traits = clone(leader.traits);
  }
  delete leader.traits;

  if (Object.keys(leader).length) actorPatch.leader = leader;
  else delete actorPatch.leader;
  return actorPatch;
};

const canonicalizeDomesticContextAlias = (actorPatch) => {
  if (!isPlainObject(actorPatch) || actorPatch.domesticContext == null) return actorPatch;
  const alias = actorPatch.domesticContext;

  // Live providers sometimes satisfy the requested domestic_context need under
  // a descriptive domesticContext wrapper instead of canonical Political Actor
  // fields. Normalize only the known semantic payload before scope projection.
  // Explicit canonical fields always win.
  if (!Array.isArray(actorPatch.domesticPressures) || !actorPatch.domesticPressures.length) {
    const pressures = Array.isArray(alias)
      ? alias
      : (isPlainObject(alias)
        ? (Array.isArray(alias.domesticPressures) ? alias.domesticPressures : alias.pressures)
        : null);
    if (Array.isArray(pressures) && pressures.length) actorPatch.domesticPressures = clone(pressures);
  }

  if (isPlainObject(alias)) {
    const government = isPlainObject(actorPatch.government) ? clone(actorPatch.government) : {};
    for (const key of ["approval", "stability"]) {
      if (Number.isFinite(Number(government[key]))) continue;
      const metric = Number(alias[key]);
      if (Number.isFinite(metric)) government[key] = metric;
    }
    if (Object.keys(government).length) actorPatch.government = government;
  }

  delete actorPatch.domesticContext;
  return actorPatch;
};

const canonicalizeGeneratedEntityCollectionMap = (value) => {
  if (value == null || Array.isArray(value) || !isPlainObject(value)) return value;
  const out = [];
  for (const [rawKey, rawEntity] of Object.entries(value)) {
    const key = clean(rawKey);
    if (!key || !isPlainObject(rawEntity)) return value;
    const explicitId = clean(rawEntity.id);
    // A keyed-object transport is recoverable only when the key and explicit id
    // agree. Conflicts are ambiguous political identity and must fail closed.
    if (explicitId && explicitId !== key) return value;
    out.push({ ...clone(rawEntity), id: explicitId || key });
  }
  return out;
};

const canonicalizeGeneratedEntityCollectionShapes = (actorPatch) => {
  if (!isPlainObject(actorPatch)) return actorPatch;
  for (const collection of ["parties", "powerBlocs"]) {
    actorPatch[collection] = canonicalizeGeneratedEntityCollectionMap(actorPatch[collection]);
    if (actorPatch[collection] === undefined) delete actorPatch[collection];
  }
  return actorPatch;
};

const canonicalizeWireActorPatch = (value) => {
  if (!isPlainObject(value)) return value;
  const out = clone(value);

  canonicalizeGeneratedLeaderAliases(out);
  canonicalizeDomesticContextAlias(out);
  // Gemini occasionally serializes entity collections as id-keyed JSON maps
  // even though the canonical Political Actor schema requires arrays. Normalize
  // this transport-only shape before representation inference/scope validation.
  canonicalizeGeneratedEntityCollectionShapes(out);

  // Common live-provider alias: keep the semantic payload but move it to the
  // actual Phase006A canonical locations before requested-scope projection.
  if (isPlainObject(out.strategicContext)) {
    for (const key of ["goals", "fears", "ambitions"]) {
      if ((!Array.isArray(out[key]) || !out[key].length) && Array.isArray(out.strategicContext[key])) {
        out[key] = clone(out.strategicContext[key]);
      }
    }
    delete out.strategicContext;
  }

  if (typeof out.politicalSystem === "string") {
    const type = clean(out.politicalSystem);
    out.politicalSystem = type ? { type } : {};
  }
  if (isPlainObject(out.government)) {
    out.government = canonicalizeGovernmentAliases(out.government, out.politicalSystem);
  } else if (out.politicalSystem != null) {
    const form = politicalSystemDisplayForm(out.politicalSystem);
    if (form) out.government = { form };
  }
  if (clean(out.ideology) && !clean(out.government?.ideology)) {
    out.government = { ...(isPlainObject(out.government) ? out.government : {}), ideology: clean(out.ideology) };
    delete out.ideology;
  }

  canonicalizeTopLevelRepresentationEntities(out);
  canonicalizeRepresentationAliases(out);
  if (out.politicalSystem != null) out.politicalSystem = canonicalizeGeneratedPoliticalSystem(out.politicalSystem, out);

  for (const collection of ["parties", "powerBlocs"]) {
    if (!Array.isArray(out[collection])) continue;
    out[collection] = out[collection].map((entity) => {
      if (!isPlainObject(entity)) return entity;
      const next = clone(entity);
      if (isPlainObject(next.politicalResponse)) {
        next.politicalResponse = canonicalizeWirePoliticalResponse(next.politicalResponse);
      }
      return next;
    });
  }
  if (isPlainObject(out.perceptions) && Array.isArray(out.perceptions.entries)) {
    const perceptions = {};
    for (const entry of out.perceptions.entries.slice(0, 32)) {
      if (!isPlainObject(entry)) continue;
      const target = clean(entry.target);
      if (!target) continue;
      const { target: _target, ...metrics } = entry;
      if (Object.keys(metrics).length) perceptions[target] = metrics;
    }
    out.perceptions = perceptions;
  }
  return out;
};

const truncate = (value, maxChars) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n...[bounded context truncated]`;
};

const stripDerivedPoliticalState = (actor) => {
  if (!isPlainObject(actor)) return null;
  const out = clone(actor);
  delete out.behavioralDisposition;
  delete out.politicalPressures;
  return out;
};

const TOP_LEVEL_FIELDS_BY_NEED = Object.freeze({
  [POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM]: new Set(["politicalSystem"]),
  [POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE]: new Set(["government", "leader"]),
  [POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES]: new Set(["parties", "powerBlocs", "government"]),
  [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE]: new Set(["parties", "powerBlocs"]),
  [POLITICAL_GENERATION_NEEDS.LEADERSHIP_TRAITS]: new Set(["traits"]),
  [POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES]: new Set(["parties", "powerBlocs"]),
  [POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT]: new Set(["parties", "powerBlocs"]),
  [POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT]: new Set(["goals", "fears", "ambitions", "government"]),
  [POLITICAL_GENERATION_NEEDS.PERCEPTIONS]: new Set(["perceptions"]),
  [POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT]: new Set(["domesticPressures", "government"]),
});

const allowedTopLevelFields = (needs) => {
  const out = new Set();
  for (const need of Array.isArray(needs) ? needs : []) {
    for (const field of TOP_LEVEL_FIELDS_BY_NEED[need] ?? []) out.add(field);
  }
  return out;
};

const allowedGovernmentFields = (needs) => {
  const set = new Set();
  if (needs.includes(POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE)) {
    for (const key of ["form", "status", "headOfState", "headOfGovernment"]) set.add(key);
  }
  if (needs.includes(POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT)) set.add("ideology");
  if (needs.includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES)) {
    for (const key of ["rulingPartyIds", "coalitionPartyIds", "coalitionName"]) set.add(key);
  }
  if (needs.includes(POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT)) {
    for (const key of ["approval", "stability"]) set.add(key);
  }
  return set;
};

const representationEntityFieldScope = (needs, collection) => {
  const fields = new Set(["id", "name"]);
  if (needs.includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES)) {
    const common = [
      "shortName", "aliases", "ideology", "leader", "goals",
      "publicPriorities", "publicForeignPolicy", "publicDescription", "color",
    ];
    for (const key of common) fields.add(key);
    if (collection === "powerBlocs") {
      for (const key of ["influence", "kind", "status"]) fields.add(key);
    }
  }
  if (needs.includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE)) {
    if (collection === "parties") {
      fields.add("support");
      fields.add("influence");
    } else if (collection === "powerBlocs") {
      fields.add("influence");
    }
  }
  if (needs.includes(POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT)) {
    for (const key of [
      "ideology", "goals", "publicPriorities", "publicForeignPolicy",
      "publicDescription", "internalStrategy", "internalPressure", "privateGoal",
    ]) fields.add(key);
  }
  if (needs.includes(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES)) fields.add("politicalResponse");
  return fields;
};

const projectKnownObjectFields = (value, allowedFields, path, droppedPaths) => {
  if (!isPlainObject(value)) return clone(value);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (!allowedFields.has(key)) {
      droppedPaths.push(`${path}.${key}`);
      continue;
    }
    out[key] = clone(child);
  }
  return out;
};

const projectActorPatchToRequestedScope = (actorPatch, needsInput) => {
  if (!isPlainObject(actorPatch)) return { actorPatch: null, droppedPaths: [] };
  const needs = Array.isArray(needsInput) ? needsInput : [];
  const allowed = allowedTopLevelFields(needs);
  const governmentAllowed = allowedGovernmentFields(needs);
  const politicalSystemAllowed = new Set(["type", "representation", "regimeCharacter", "label", "notes"]);
  const out = {};
  const droppedPaths = [];

  for (const [key, value] of Object.entries(actorPatch)) {
    if (!allowed.has(key)) {
      droppedPaths.push(`actorPatch.${key}`);
      continue;
    }

    if (key === "politicalSystem") {
      out.politicalSystem = projectKnownObjectFields(value, politicalSystemAllowed, "actorPatch.politicalSystem", droppedPaths);
      continue;
    }

    if (key === "government" && isPlainObject(value)) {
      const government = projectKnownObjectFields(value, governmentAllowed, "actorPatch.government", droppedPaths);
      if (Object.keys(government).length) out.government = government;
      continue;
    }

    if ((key === "parties" || key === "powerBlocs") && Array.isArray(value)) {
      const entityAllowed = representationEntityFieldScope(needs, key);
      out[key] = value.map((entity, index) => {
        if (!isPlainObject(entity)) return clone(entity);
        return projectKnownObjectFields(entity, entityAllowed, `actorPatch.${key}[${index}]`, droppedPaths);
      });
      continue;
    }

    out[key] = clone(value);
  }

  return { actorPatch: out, droppedPaths };
};

const validateGeneratedPoliticalResponseShapes = (actorPatch) => {
  const errors = [];
  for (const collection of ["parties", "powerBlocs"]) {
    for (const [index, entity] of (Array.isArray(actorPatch?.[collection]) ? actorPatch[collection] : []).entries()) {
      const response = entity?.politicalResponse;
      if (!isPlainObject(response) || response.issues === undefined) continue;
      if (!isPlainObject(response.issues)) {
        errors.push(`actorPatch.${collection}[${index}].politicalResponse.issues must be an object of issue profiles`);
        continue;
      }
      for (const [issueKey, issue] of Object.entries(response.issues)) {
        const path = `actorPatch.${collection}[${index}].politicalResponse.issues.${issueKey}`;
        if (!isPlainObject(issue)) {
          errors.push(`${path} must be an object with position, sensitivity, and strainResponse; numeric shorthand is not accepted`);
          continue;
        }
        const metrics = {
          position: Number(issue.position),
          sensitivity: Number(issue.sensitivity),
          strainResponse: Number(issue.strainResponse),
        };
        const missing = Object.entries(metrics).filter(([, number]) => !Number.isFinite(number)).map(([key]) => key);
        if (missing.length) {
          errors.push(`${path} must include finite ${missing.join(", ")}`);
          continue;
        }
        if (metrics.position < -100 || metrics.position > 100) errors.push(`${path}.position must be between -100 and 100`);
        if (metrics.sensitivity < 0 || metrics.sensitivity > 100) errors.push(`${path}.sensitivity must be between 0 and 100`);
        if (metrics.strainResponse < -100 || metrics.strainResponse > 100) errors.push(`${path}.strainResponse must be between -100 and 100`);
      }
    }
  }
  return errors;
};

const normalizeConfidence = (value) => {
  const confidence = clean(value).toLocaleLowerCase();
  return Object.values(POLITICAL_GENERATION_CONFIDENCE).includes(confidence)
    ? confidence
    : POLITICAL_GENERATION_CONFIDENCE.UNKNOWN;
};

const parseResponseObject = (response) => {
  if (isPlainObject(response?.toolInput)) return response.toolInput;
  if (isPlainObject(response) && (Array.isArray(response.proposals) || Array.isArray(response.verifications))) return response;
  const raw = typeof response === "string" ? response : String(response?.rawText ?? "");
  if (!raw) return null;
  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch {
      return null;
    }
  }
};

const generatedAtValue = (generatedAt) => {
  const value = typeof generatedAt === "function" ? generatedAt() : generatedAt;
  const text = clean(value);
  return text || new Date().toISOString();
};

const compactExistingActor = (actor) => {
  const stripped = stripDerivedPoliticalState(actor);
  if (!stripped) return null;
  return stripped;
};

const responseProfileInstruction = (item, existing) => {
  if (!item?.needs?.includes(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES)) return "";
  const representation = clean(existing?.politicalSystem?.representation).toLocaleLowerCase();
  const collections = representation === GENERATED_REPRESENTATIONS.ELECTORAL
    ? ["parties"]
    : (representation === GENERATED_REPRESENTATIONS.PARTY_STATE ? ["parties", "powerBlocs"] : ["powerBlocs"]);
  const targetGroups = collections.map((collection) => {
    const targets = (Array.isArray(existing?.[collection]) ? existing[collection] : [])
      .filter((entity) => !isPlainObject(entity?.politicalResponse) || !Object.keys(entity.politicalResponse).length)
      .map((entity) => clean(entity?.id))
      .filter(Boolean);
    return targets.length ? `${collection} -> ${targets.join(", ")}` : "";
  }).filter(Boolean);
  if (targetGroups.length) {
    return `RESPONSE PROFILE TARGET IDS: ${targetGroups.join("; ")}. Return the exact stable id plus politicalResponse for EVERY listed target id; the existing canonical display name does not need to be repeated.`;
  }
  return `RESPONSE PROFILE RULE: every party/power bloc generated by this proposal must include a non-empty politicalResponse object.`;
};

const governingStructureInstruction = (item, existing) => {
  if (!item?.needs?.includes(POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE)) return "";
  const hasForm = Boolean(clean(existing?.government?.form));
  const hasHead = Boolean(clean(existing?.government?.headOfState?.name || existing?.government?.headOfState || existing?.government?.headOfGovernment?.name || existing?.government?.headOfGovernment));
  if (hasForm || hasHead) return "";
  return "GOVERNING STRUCTURE REQUIRED: include government.form as a non-empty human-readable form. Include headOfState/headOfGovernment when known. If politicalSystem already states the regime, repeat that regime as government.form rather than omitting government.";
};

const strategicContextInstruction = (item, existing) => {
  if (!item?.needs?.includes(POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT)) return "";
  const parts = [];
  if (!clean(existing?.government?.ideology)) parts.push("government.ideology must be a non-empty string describing the CURRENT government/coalition worldview");
  if (item?.depth === POLITICAL_GENERATION_DEPTHS.STANDARD) {
    const missing = ["goals", "fears", "ambitions"].filter((field) => !(Array.isArray(existing?.[field]) && existing[field].length));
    if (missing.length) parts.push(`include concise non-empty ${missing.join(", ")} entries; STANDARD v2 needs all three motive classes so the actor can reason forward without historical autocomplete`);
  } else {
    const hasStrategy = [existing?.goals, existing?.fears, existing?.ambitions].some((value) => Array.isArray(value) && value.length);
    if (!hasStrategy) parts.push("include at least one non-empty goals, fears, or ambitions entry for the polity's current strategic agenda");
  }
  return parts.length ? `STRATEGIC CONTEXT REQUIRED: ${parts.join("; ")}.` : "";
};

const governingEntityContextInstruction = (item, existing) => {
  if (!item?.needs?.includes(POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT)) return "";
  const rulingIds = [
    ...(Array.isArray(existing?.government?.rulingPartyIds) ? existing.government.rulingPartyIds : []),
    ...(Array.isArray(existing?.government?.coalitionPartyIds) ? existing.government.coalitionPartyIds : []),
  ].map(clean).filter(Boolean);
  const targetHint = rulingIds.length
    ? ` Target existing governing stable ids first: ${rulingIds.join(", ")}.`
    : " Target the current governing/dominant represented force; if governing alignment is not yet resolved, enrich the first canonical represented force without inventing a new entity id.";
  const depthRule = item?.depth === POLITICAL_GENERATION_DEPTHS.STANDARD
    ? " STANDARD is compact but behavior-complete: give each targeted governing force a short ideology plus at least one concise goals/publicPriorities/publicForeignPolicy direction. Do not write essays."
    : " Include ideology plus concise goals/priorities/foreign-policy direction; RICH/FULL may also include a compact privateGoal/internalStrategy/internalPressure when useful.";
  return `GOVERNING FORCE CONTEXT REQUIRED.${targetHint}${depthRule}`;
};

const isRetryPoliticalSystemLock = (value) => {
  if (!isPlainObject(value)) return false;
  const hasType = Boolean(clean(value.type));
  const hasRepresentation = GENERATED_REPRESENTATION_SET.has(clean(value.representation).toLocaleLowerCase());
  return hasType || hasRepresentation;
};

const hasValidRetrySystemType = (value) => {
  const type = clean(value);
  if (!type || type.toLocaleLowerCase() === "unspecified") return false;
  return !GENERATED_REPRESENTATION_SET.has(type.toLocaleLowerCase());
};

const politicalSystemFieldFailures = (errors = []) => {
  const list = Array.isArray(errors) ? errors.map((error) => String(error ?? "")) : [];
  const genericSystemFailure = list.some((error) => /proposal did not satisfy requested need political_system/i.test(error));
  return {
    type: genericSystemFailure || list.some((error) => /actorPatch\.politicalSystem\.type/i.test(error)),
    representation: genericSystemFailure || list.some((error) => /actorPatch\.politicalSystem\.representation/i.test(error)),
  };
};

const retryPoliticalSystemLockFromDiagnostic = (diagnostic) => {
  if (!diagnostic || diagnostic.status !== "failed") return null;
  const system = diagnostic?.projectedActorPatch?.politicalSystem;
  if (!isPlainObject(system)) return null;
  const failed = politicalSystemFieldFailures(diagnostic.errors);
  const lock = {};
  if (!failed.type && hasValidRetrySystemType(system.type)) lock.type = clean(system.type);
  const representation = clean(system.representation).toLocaleLowerCase();
  if (!failed.representation && GENERATED_REPRESENTATION_SET.has(representation)) lock.representation = representation;
  return isRetryPoliticalSystemLock(lock) ? lock : null;
};

const politicalSystemRetryInstruction = (item, politicalSystemLocks) => {
  const lock = politicalSystemLocks?.[item?.polityKey];
  if (!isRetryPoliticalSystemLock(lock)) return "";
  const locked = [
    ...(clean(lock.type) ? [`type=${clean(lock.type)}`] : []),
    ...(GENERATED_REPRESENTATION_SET.has(clean(lock.representation).toLocaleLowerCase())
      ? [`representation=${clean(lock.representation).toLocaleLowerCase()}`]
      : []),
  ];
  const unlocked = [
    ...(!clean(lock.type) ? ["type"] : []),
    ...(!GENERATED_REPRESENTATION_SET.has(clean(lock.representation).toLocaleLowerCase()) ? ["representation"] : []),
  ];
  const fieldRule = unlocked.length
    ? ` Only ${locked.join(" and ")} passed field-level validation and ${locked.length === 1 ? "is" : "are"} locked. ${unlocked.join(" and ")} ${unlocked.length === 1 ? "is" : "are"} NOT locked and must be corrected when named by the validation errors.`
    : ` These values already passed native political-system validation and MUST NOT change on this retry.`;
  const representationRepair = !GENERATED_REPRESENTATION_SET.has(clean(lock.representation).toLocaleLowerCase())
    ? ` If party_state semantic validation failed, do NOT rewrite a valid dominant-party regime into one_party_state; keep the locked type and choose the accurate representation (usually electoral or an appropriate factional representation). REPRESENTATION REPAIR IS ATOMIC: in the same retry, reshape the representation roster to match the newly chosen representation exactly: electoral -> parties; party_state -> parties and/or powerBlocs; court_factions/elite_factions/military_factions/revolutionary_factions/colonial -> powerBlocs; none -> no roster required. Do not keep entities in the previous or wrong collection.`
    : ` If representation_entities failed, keep the locked representation and repair the representation entity collection/shape: electoral -> parties; party_state -> parties and/or powerBlocs; court_factions/elite_factions/military_factions/revolutionary_factions/colonial -> powerBlocs; none -> no roster required.`;
  return `CORRECTIVE RETRY POLITICAL SYSTEM LOCK (FIELD LEVEL): ${locked.join("; ")}.${fieldRule}${representationRepair}`;
};

const CORRECTIVE_BLOC_REPRESENTATIONS = new Set([
  GENERATED_REPRESENTATIONS.COURT_FACTIONS,
  GENERATED_REPRESENTATIONS.ELITE_FACTIONS,
  GENERATED_REPRESENTATIONS.MILITARY_FACTIONS,
  GENERATED_REPRESENTATIONS.REVOLUTIONARY_FACTIONS,
  GENERATED_REPRESENTATIONS.COLONIAL,
]);

const stripEntityFieldsForCorrectiveCollection = (entity, collection) => {
  if (!isPlainObject(entity)) return entity;
  const next = clone(entity);
  if (collection === "parties") {
    delete next.influence;
    delete next.kind;
    delete next.status;
  } else {
    delete next.support;
  }
  return next;
};

const canonicalizeUnlockedRepresentationRetryRoster = (actorPatch, item, politicalSystemLock) => {
  if (!isPlainObject(actorPatch)
      || !Array.isArray(item?.needs)
      || !item.needs.includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES)
      || !isRetryPoliticalSystemLock(politicalSystemLock)) {
    return { actorPatch, moved: null };
  }

  // This fallback is deliberately narrower than normal wire canonicalization. It
  // runs only on a corrective retry where representation was the field that
  // failed previously (therefore type may be locked, representation is not). The
  // model still gets the first opportunity to repair semantics itself. If it
  // chooses a new canonical representation but places the intended roster in the
  // opposite collection, relocate that sole roster rather than losing an
  // otherwise valid final retry to a collection-name mistake.
  const lockedRepresentation = clean(politicalSystemLock.representation).toLocaleLowerCase();
  if (GENERATED_REPRESENTATION_SET.has(lockedRepresentation)) return { actorPatch, moved: null };

  const representation = clean(actorPatch?.politicalSystem?.representation).toLocaleLowerCase();
  if (!GENERATED_REPRESENTATION_SET.has(representation)
      || representation === GENERATED_REPRESENTATIONS.PARTY_STATE
      || representation === GENERATED_REPRESENTATIONS.NONE) {
    return { actorPatch, moved: null };
  }

  const parties = Array.isArray(actorPatch.parties) ? actorPatch.parties : [];
  const powerBlocs = Array.isArray(actorPatch.powerBlocs) ? actorPatch.powerBlocs : [];

  if (representation === GENERATED_REPRESENTATIONS.ELECTORAL && !parties.length && powerBlocs.length) {
    actorPatch.parties = powerBlocs.map((entity) => stripEntityFieldsForCorrectiveCollection(entity, "parties"));
    delete actorPatch.powerBlocs;
    return { actorPatch, moved: { from: "powerBlocs", to: "parties", representation } };
  }

  if (CORRECTIVE_BLOC_REPRESENTATIONS.has(representation) && !powerBlocs.length && parties.length) {
    actorPatch.powerBlocs = parties.map((entity) => stripEntityFieldsForCorrectiveCollection(entity, "powerBlocs"));
    delete actorPatch.parties;
    if (isPlainObject(actorPatch.government)) {
      delete actorPatch.government.rulingPartyIds;
      delete actorPatch.government.coalitionPartyIds;
    }
    return { actorPatch, moved: { from: "parties", to: "powerBlocs", representation } };
  }

  return { actorPatch, moved: null };
};

const requestedActorPatchScopeInstruction = (needsInput) => {
  const needs = Array.isArray(needsInput) ? needsInput : [];
  const topLevel = [...allowedTopLevelFields(needs)].sort();
  const parts = [`top-level keys: ${topLevel.join(", ") || "(none)"}`];
  if (topLevel.includes("politicalSystem")) parts.push("politicalSystem keys: type, representation, label, notes");
  if (topLevel.includes("government")) {
    const government = [...allowedGovernmentFields(needs)].sort();
    parts.push(`government keys: ${government.join(", ") || "(none)"}`);
  }
  if (topLevel.includes("parties")) parts.push(`party keys: ${[...representationEntityFieldScope(needs, "parties")].sort().join(", ")}`);
  if (topLevel.includes("powerBlocs")) parts.push(`powerBloc keys: ${[...representationEntityFieldScope(needs, "powerBlocs")].sort().join(", ")}`);
  return `ACTORPATCH SCOPE THIS CALL — output ONLY these canonical paths; omit every other field entirely: ${parts.join("; ")}.`;
};

const itemBlock = (item, { politicalActors, contextByPolity, previousErrors, allowEntityExpansionByPolity, politicalSystemLocks }) => {
  const existing = compactExistingActor(politicalActors?.byPolity?.[item.polityKey]);
  const localContext = contextByPolity?.[item.polityKey];
  const errors = previousErrors?.[item.polityKey] ?? [];
  const hasAuthoredRoster = Array.isArray(existing?.parties) || Array.isArray(existing?.powerBlocs);
  const profileInstruction = responseProfileInstruction(item, existing);
  const governingInstruction = governingStructureInstruction(item, existing);
  const strategicInstruction = strategicContextInstruction(item, existing);
  const governingEntityInstruction = governingEntityContextInstruction(item, existing);
  const politicalSystemRetryRule = politicalSystemRetryInstruction(item, politicalSystemLocks);
  return [
    `POLITY: ${item.polityKey}`,
    `DEPTH: ${item.depth}`,
    `GENERATE ONLY THESE MISSING NEEDS: ${item.needs.join(", ")}`,
    requestedActorPatchScopeInstruction(item.needs),
    hasAuthoredRoster
      ? (allowEntityExpansionByPolity?.[item.polityKey] === true
          ? `ROSTER REVIEW AUTHORIZATION / EXPANSION: this roster may ADD missing party/power-bloc ids when representation_entities remains incomplete; preserve every existing field on existing entities and add only politically meaningful missing forces.`
          : `ROSTER AUTHORITY: existing authored party/power-bloc membership is closed. Do not add new entity ids.`)
      : `ROSTER AUTHORITY: no existing Political Actor roster exists; generate only the representation entities required by this polity's requested needs.`,
    ...(profileInstruction ? [profileInstruction] : []),
    ...(governingInstruction ? [governingInstruction] : []),
    ...(strategicInstruction ? [strategicInstruction] : []),
    ...(governingEntityInstruction ? [governingEntityInstruction] : []),
    ...(item.depth === POLITICAL_GENERATION_DEPTHS.STANDARD && item.needs.some((need) => [
      POLITICAL_GENERATION_NEEDS.LEADERSHIP_TRAITS,
      POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT,
      POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT,
      POLITICAL_GENERATION_NEEDS.PERCEPTIONS,
      POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT,
    ].includes(need)) ? [
      "BEHAVIORAL STANDARD BOUNDS: keep this a compact starting organism, not a dossier: roughly 3-5 useful traits; 2-3 goals; 1-2 fears; 1-2 ambitions; 1-3 domestic pressures; and 1-2 strategically relevant perceptions. Existing non-empty fields are authoritative and must not be rewritten.",
    ] : []),
    ...(politicalSystemRetryRule ? [politicalSystemRetryRule] : []),
    `EXISTING CANONICAL POLITICAL STATE (preserve it; do not repeat fields unless needed to complete a requested nested structure):`,
    existing ? truncate(existing, 4500) : "(none)",
    `POLITY-SPECIFIC SCENARIO CONTEXT:`,
    localContext ? truncate(localContext, 3000) : "(none supplied)",
    ...(errors.some((error) => /actorPatch\.(?:parties|powerBlocs) must be an array when generated/i.test(error)) ? [
      `STRICT RETRY COLLECTION SHAPE: actorPatch.parties and actorPatch.powerBlocs MUST be JSON arrays of entity objects. Do NOT use an id-keyed object/map/dictionary. Put the stable id inside each entity object.`,
    ] : []),
    ...(errors.length ? [
      `PREVIOUS ATTEMPT VALIDATION ERRORS — correct these exactly:`,
      errors.slice(0, 12).map((error) => `- ${error}`).join("\n"),
    ] : []),
  ].join("\n");
};

export const POLITICAL_WORLD_GENERATION_TOOL = Object.freeze({
  name: "submit_political_world_generation",
  description: "Submit bounded missing Political Actor patches for only the requested canonical polities. The tool envelope is deliberately shallow for provider compatibility; actorPatchJson contains the proposed canonical Political Actor patch as JSON text and is parsed/validated natively before review.",
  schema: Object.freeze({
    type: "object",
    properties: {
      proposals: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            polityKey: { type: "string", description: "Exact requested canonical polity name/key." },
            confidence: { type: "string", enum: ["low", "moderate", "high", "unknown"] },
            sourceAsOf: { type: "string", description: "YYYY-MM-DD external/reference source-as-of date, or an empty string when none was used. It must obey the scenario's supplied reference-authority cutoff; scenario-authored/derived canon is not an external reference date." },
            referenceDates: {
              type: "array",
              maxItems: 16,
              items: { type: "string" },
              description: "Historical dates actually relied upon; use an empty array when none. Never later than scenario start.",
            },
            actorPatchJson: {
              type: "string",
              description: "JSON object text containing ONLY the requested canonical Political Actor fields. Never empty or {} while needs are listed. parties and powerBlocs MUST be JSON arrays of entity objects, never id-keyed maps/dictionaries. Do not wrap it in markdown fences.",
            },
          },
          required: ["polityKey", "confidence", "sourceAsOf", "referenceDates", "actorPatchJson"],
          additionalProperties: false,
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  }),
});

// Phase006D support/influence-only backfills use a deliberately tiny provider
// contract. Forty-eight existing Political Actors can share one request because
// the model is not allowed to regenerate identity: it only maps stable roster
// ids to approximate integer percentages. Each polity carries its own JSON
// string so one malformed item can be discarded and repaired natively without
// poisoning or retrying the rest of the batch.
export const POLITICAL_WORLD_LANDSCAPE_FAST_TOOL = Object.freeze({
  name: "submit_political_world_quantitative_landscapes",
  description: "Submit approximate Round-Zero support/influence percentages for existing Political Actor roster ids only. Each landscapeJson is parsed independently so malformed individual polities can fall back natively without retrying the batch.",
  schema: Object.freeze({
    type: "object",
    properties: {
      landscapes: {
        type: "array",
        maxItems: POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE,
        items: {
          type: "object",
          properties: {
            polityKey: { type: "string", description: "Exact requested canonical polity name/key." },
            landscapeJson: {
              type: "string",
              description: "JSON object mapping ONLY supplied stable entity ids to approximate integer percentages, e.g. {\"cdu-csu\":36,\"spd\":27}. Do not wrap it in markdown fences.",
            },
          },
          required: ["polityKey", "landscapeJson"],
          additionalProperties: false,
        },
      },
    },
    required: ["landscapes"],
    additionalProperties: false,
  }),
});

const HISTORICAL_CORRECTION_SCOPES = Object.freeze({
  OFFICEHOLDERS: "officeholders",
  GOVERNMENT_STRUCTURE: "government_structure",
  POLITICAL_SYSTEM: "political_system",
  REPRESENTATION_ROSTER: "representation_roster",
  STRATEGIC_SEMANTICS: "strategic_semantics",
  GOVERNING_SEMANTICS: "governing_semantics",
  PERCEPTIONS: "perceptions",
  DOMESTIC_SEMANTICS: "domestic_semantics",
});
const HISTORICAL_CORRECTION_SCOPE_SET = new Set(Object.values(HISTORICAL_CORRECTION_SCOPES));

export const POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL = Object.freeze({
  name: "submit_political_world_historical_verification",
  description: "Verify exact-date Round-Zero political identity and generated political semantics. Confirm admissible candidates or return a narrowly corrected generated-state patch; native code revalidates every correction before review.",
  schema: Object.freeze({
    type: "object",
    properties: {
      verifications: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            polityKey: { type: "string", description: "Exact requested canonical polity name/key." },
            verdict: { type: "string", enum: ["confirmed", "corrected"] },
            confidence: { type: "string", enum: ["low", "moderate", "high", "unknown"] },
            issue: { type: "string", description: "Short exact-date explanation. Empty when confirmed." },
            correctionScopes: {
              type: "array",
              maxItems: 8,
              items: {
                type: "string",
                enum: ["officeholders", "government_structure", "political_system", "representation_roster", "strategic_semantics", "governing_semantics", "perceptions", "domestic_semantics"],
              },
              description: "Empty when confirmed. For corrected verdicts, list only the concrete temporal identity/semantic categories being corrected.",
            },
            replaceRepresentationEntities: {
              type: "boolean",
              description: "True only when the correction changes the political representation/system enough that the generated parties/powerBlocs must be replaced as a set.",
            },
            correctedIdentityJson: {
              type: "string",
              description: "For corrected verdicts only: JSON object text containing ONLY the generated fields that require exact-date correction. May contain identity fields plus goals/fears/ambitions/domesticPressures/perceptions, government.ideology, or semantic fields on existing generated party/powerBloc ids. Never include runtime-derived C4/pressures. Empty string when confirmed.",
            },
          },
          required: ["polityKey", "verdict", "confidence", "issue", "correctionScopes", "replaceRepresentationEntities", "correctedIdentityJson"],
          additionalProperties: false,
        },
      },
    },
    required: ["verifications"],
    additionalProperties: false,
  }),
});


export const POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL = Object.freeze({
  name: "submit_political_world_temporal_sentinel",
  description: "Adversarial exact-date temporal audit of already-valid political identity. The provider transport is deliberately shallow for Gemini compatibility: checksJson is JSON array text, parsed and validated natively before any result is trusted.",
  schema: Object.freeze({
    type: "object",
    properties: {
      checksJson: {
        type: "string",
        description: "JSON array text. One object per requested polity with polityKey, verdict (clear|challenge), confidence, issue, checkedFactIds[], and challengedFactIds[]. Do not use markdown fences.",
      },
    },
    required: ["checksJson"],
    additionalProperties: false,
  }),
});

const HISTORICAL_SEMANTIC_ENTITY_FIELDS = Object.freeze([
  "ideology",
  "goals",
  "publicPriorities",
  "publicForeignPolicy",
  "publicDescription",
  "politicalResponse",
  "internalStrategy",
  "internalPressure",
  "privateGoal",
]);

const historicalVerificationIdentity = (actorPatch) => {
  if (!isPlainObject(actorPatch)) return {};
  const out = {};
  if (isPlainObject(actorPatch.politicalSystem)) out.politicalSystem = clone(actorPatch.politicalSystem);
  if (isPlainObject(actorPatch.government)) {
    const government = {};
    for (const key of ["form", "status", "coalitionName", "headOfState", "headOfGovernment", "rulingPartyIds", "coalitionPartyIds", "ideology"]) {
      if (actorPatch.government[key] !== undefined) government[key] = clone(actorPatch.government[key]);
    }
    if (Object.keys(government).length) out.government = government;
  }
  if (actorPatch.leader !== undefined) out.leader = clone(actorPatch.leader);
  for (const key of ["goals", "fears", "ambitions", "domesticPressures", "perceptions"]) {
    if (actorPatch[key] !== undefined) out[key] = clone(actorPatch[key]);
  }
  for (const collection of ["parties", "powerBlocs"]) {
    if (!Array.isArray(actorPatch[collection])) continue;
    out[collection] = actorPatch[collection].slice(0, 24).map((entity) => {
      if (!isPlainObject(entity)) return clone(entity);
      const next = {};
      for (const key of ["id", "name", "shortName", "status", "kind", "leader", ...HISTORICAL_SEMANTIC_ENTITY_FIELDS]) {
        if (entity[key] !== undefined) next[key] = clone(entity[key]);
      }
      return next;
    });
  }
  return out;
};

const historicalVerificationGeneratedPaths = (actorPatch) => {
  const paths = [];
  if (!isPlainObject(actorPatch)) return paths;
  if (isPlainObject(actorPatch.politicalSystem)) {
    for (const key of ["type", "representation", "label", "notes"]) {
      if (actorPatch.politicalSystem[key] !== undefined) paths.push(`politicalSystem.${key}`);
    }
  }
  if (isPlainObject(actorPatch.government)) {
    for (const key of ["form", "status", "coalitionName", "headOfState", "headOfGovernment", "rulingPartyIds", "coalitionPartyIds", "ideology"]) {
      if (actorPatch.government[key] !== undefined) paths.push(`government.${key}`);
    }
  }
  if (actorPatch.leader !== undefined) paths.push("leader");
  for (const key of ["goals", "fears", "ambitions", "domesticPressures", "perceptions"]) {
    if (actorPatch[key] !== undefined) paths.push(key);
  }
  for (const collection of ["parties", "powerBlocs"]) {
    if (!Array.isArray(actorPatch[collection])) continue;
    actorPatch[collection].forEach((entity, index) => {
      if (!isPlainObject(entity)) return;
      const identityFields = ["id", "name", "shortName", "status", "kind", "leader"];
      if (identityFields.some((key) => entity[key] !== undefined)) paths.push(`${collection}[${index}].identity`);
      for (const key of HISTORICAL_SEMANTIC_ENTITY_FIELDS) {
        if (entity[key] !== undefined) paths.push(`${collection}[${index}].${key}`);
      }
    });
  }
  return paths;
};

const officeholderDisplayText = (value) => {
  if (typeof value === "string") return clean(value);
  if (isPlainObject(value)) return clean(value.name);
  return "";
};

const looksLikeCompoundOfficeholder = (value) => {
  const text = officeholderDisplayText(value);
  if (!text) return false;
  return /[()\/]|\b(?:and|co[- ]?(?:president|prince|head)|governor[- ]general|regent|acting|collective presidency|presidency of)\b/i.test(text);
};

const historicalCompoundOfficeholderChecks = (actorPatch) => {
  if (!isPlainObject(actorPatch)) return [];
  const checks = [];
  for (const [path, value] of [
    ["government.headOfState", actorPatch?.government?.headOfState],
    ["government.headOfGovernment", actorPatch?.government?.headOfGovernment],
    ["leader", actorPatch?.leader],
  ]) {
    if (!looksLikeCompoundOfficeholder(value)) continue;
    checks.push(`${path}: ${officeholderDisplayText(value)}`);
  }
  return checks;
};

export const buildPoliticalWorldHistoricalVerificationPrompt = ({
  scenarioDate,
  historyAuthority = null,
  entries = [],
  scenarioContext = "",
  contextByPolity = {},
  previousErrors = {},
  reviewContextByPolity = {},
  correctionRequiredPolities = new Set(),
} = {}) => {
  const authority = historyAuthorityPromptContract(historyAuthority, scenarioDate);
  const systemPrompt = `You are the conservative Round-Zero political TEMPORAL AUTHORITY verifier for a scenario-driven living-world simulator.\n\n`
    + `${historyAuthorityPromptBlock(historyAuthority, scenarioDate)}\n`
    + `Your job is NOT to regenerate politics. Your job is to catch temporal identity OR hindsight/reference-canon leaks in already-valid generated starting state.\n\n`
    + `HARD RULES:\n`
    + `- Verify facts that must already be true ON the target start-world date according to CURRENT SCENARIO CANON: current officeholders, government/system/roster identity, AND generated political semantics that claim what actors wanted, feared, prioritized, perceived, or called a strategy/doctrine/policy on that date.\n`
    + `- government.headOfState and government.headOfGovernment mean the FORMAL current officeholders for those offices on the scenario date. Do not substitute a supreme leader, paramount party leader, de facto strongman, military patron, or other politically dominant figure unless that person formally occupies the office. When the supreme political leader is a different person, preserve/correct the formal officeholder here and use top-level leader for the de facto/supreme political leader when that field is generated.\n`
    + `- Scenario-authored canon/backstory is stronger authority than external/reference canon. Authored/derived Round-Zero history and explicit current world state share that stronger scenario authority. Preserve divergences and fictional/custom canon exactly where supplied.\n`
    + `- ${authority.referenceRule} Never use reference developments outside that boundary to correct, complete, or reinterpret the target world.\n`
    + `${authority.mode === "legacy" || authority.mode === "inclusive" ? "- External/reference developments AFTER the scenario date have zero authority unless stronger scenario canon explicitly establishes them.\n" : ""}`
    + `- ${authority.mode === "exclusive" || authority.mode === "none" ? "A disagreement with remembered external/reference history on the target date is NOT evidence of an error. Challenge only when the candidate conflicts with supplied scenario canon or demonstrably imports post-boundary reference knowledge." : "Where external/reference canon is valid on the target date, exact-date reference facts may verify generated identity only when they do not conflict with stronger scenario-authored canon."}\n`
    + `- SEMANTIC AS-OF TEST: ask whether this actor could plausibly have held, known, articulated, or publicly prioritized the generated semantic state ON ${scenarioDate} using only supplied scenario canon plus external/reference information permitted by the authority boundary. Generic motives may be plausible even if another canon later resembled them; named concepts, outcomes, or hindsight framing imported from outside the permitted boundary are not admissible. Do not challenge merely because you would choose different wording or a different subjective numeric estimate.\n`
    + `- Be conservative. Do not rewrite a candidate merely because you prefer different terminology or taxonomy. Spelling, demonym, translation, romanization, abbreviation, ideology-label, or display-name preferences are NOT temporal contradictions and MUST be confirmed unchanged.\n`
    + `- Verify ONLY fields listed under GENERATED TEMPORAL PATHS. Existing authored fields are not yours to correct.\n`
    + `- Independently verify EVERY named officeholder embedded in a generated officeholder field. A sovereign plus governor-general, regent, acting official, co-head, collective presidency, slash-separated officeholders, or parenthetical representative is not one fact: each named person and role must be correct on the exact scenario date.\n`
    + `- If FOCUSED REVIEW CONTEXT is supplied for a polity, treat it as mandatory additional verification context. If it describes a same-date cross-polity officeholder collision, resolve the collision by verifying the formal officeholders in every named polity. If it describes consensus disagreement, independently adjudicate the exact-date contradiction rather than choosing a prior pass by preference.\n`
    + `- If TEMPORAL CORRECTION OBLIGATION is supplied for a polity, a previous verifier attempt already established a concrete date contradiction. verdict=confirmed is forbidden for that polity until a valid scoped correction is returned. Do not rescind or forget the earlier finding because correctionScopes or correctedIdentityJson were malformed.\n`
    + `- If all generated temporal fields are admissible on the exact date, verdict=confirmed, correctionScopes=[], and correctedIdentityJson="".\n`
    + `- If any generated field is temporally wrong, verdict=corrected. correctionScopes must list only the concrete temporal categories being changed. correctedIdentityJson must contain ONLY the generated field(s) that require correction; do not rewrite unrelated generated state. Runtime-derived behavioralDisposition/politicalPressures are always forbidden.\n`
    + `- Scope meanings: officeholders = headOfState/headOfGovernment/leader; government_structure = government form/status/coalition identity; political_system = politicalSystem type/representation; representation_roster = date-sensitive party/faction membership, governing references, leaders, status, or kind; strategic_semantics = top-level goals/fears/ambitions; governing_semantics = government.ideology plus ideology/goals/priorities/foreign-policy/strategy semantics on already-generated party/powerBloc ids; perceptions = top-level perceptions; domestic_semantics = top-level domesticPressures. A display-only rename is not representation_roster correction.\n`
    + `- If correcting politicalSystem.representation, include political_system AND representation_roster in correctionScopes, include the accurate representation entities, and set replaceRepresentationEntities=true so stale generated parties/powerBlocs can be replaced. Otherwise keep replaceRepresentationEntities=false.\n`
    + `- Do not invent exact polling/support. Do not create events. Do not simulate anything after the start date.\n`
    + `- confidence is confidence in this verification decision, not confidence in the original generator.\n\n`
    + `OUTPUT: use the supplied verification tool. Return exactly one verification for every requested polity.`;

  const blocks = entries.map((entry, index) => {
    const polityKey = entry?.item?.polityKey ?? entry?.proposal?.polityKey ?? "";
    const generatedPatch = entry?.proposal?.actorPatch ?? {};
    const finalActor = entry?.validation?.actor ?? generatedPatch;
    const compoundOfficeholders = historicalCompoundOfficeholderChecks(finalActor);
    return [
      `=== ${index + 1} ===`,
      `POLITY: ${polityKey}`,
      `GENERATED TEMPORAL PATHS: ${historicalVerificationGeneratedPaths(generatedPatch).join(", ") || "(none)"}`,
      `GENERATED TEMPORAL CANDIDATE:`,
      truncate(historicalVerificationIdentity(generatedPatch), 7000),
      `FINAL TEMPORAL CANDIDATE AFTER EXISTING CANON IS PRESERVED:`,
      truncate(historicalVerificationIdentity(finalActor), 7000),
      `COMPOUND OFFICEHOLDER CHECKS:`,
      compoundOfficeholders.length
        ? compoundOfficeholders.map((value) => `- ${value} — verify every named person/role independently on ${scenarioDate}`).join("\n")
        : "(none)",
      `POLITY-SPECIFIC SCENARIO CONTEXT:`,
      contextByPolity?.[polityKey] ? truncate(contextByPolity[polityKey], 2500) : "(none supplied)",
      `FOCUSED REVIEW CONTEXT:`,
      reviewContextByPolity?.[polityKey] ? truncate(reviewContextByPolity[polityKey], 2500) : "(none)",
      `TEMPORAL CORRECTION OBLIGATION:`,
      correctionRequiredPolities instanceof Set && correctionRequiredPolities.has(polityKey)
        ? `ESTABLISHED — a previous verifier attempt identified a concrete temporal contradiction for ${polityKey}. You MUST return verdict=corrected with valid correctionScopes and correctedIdentityJson; verdict=confirmed is forbidden.`
        : "(none)",
      ...((previousErrors?.[polityKey] ?? []).length ? [
        `PREVIOUS VERIFICATION VALIDATION ERRORS — correct these exactly:`,
        (previousErrors[polityKey] ?? []).slice(0, 8).map((error) => `- ${error}`).join("\n"),
      ] : []),
    ].join("\n");
  });

  const userMessage = [
    `SCENARIO DATE: ${scenarioDate}`,
    "",
    "GLOBAL SCENARIO CANON / BACKSTORY (authoritative when supplied):",
    scenarioContext ? truncate(scenarioContext, 9000) : "(none supplied)",
    "",
    "VERIFY THESE GENERATED ROUND-ZERO IDENTITIES:",
    ...blocks,
  ].join("\n");

  return { systemPrompt, userMessage };
};

const temporalSentinelFactsForEntry = (entry) => {
  const actorPatch = entry?.proposal?.actorPatch ?? {};
  const facts = [];
  const push = (path, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && !value.length) return;
    if (isPlainObject(value) && !Object.keys(value).length) return;
    const display = typeof value === "string" ? clean(value) : clean(JSON.stringify(value));
    if (!display) return;
    facts.push({ id: `F${facts.length + 1}`, path, display });
  };
  if (isPlainObject(actorPatch.politicalSystem)) {
    push("politicalSystem.type", actorPatch.politicalSystem.type);
    push("politicalSystem.representation", actorPatch.politicalSystem.representation);
  }
  if (isPlainObject(actorPatch.government)) {
    push("government.form", actorPatch.government.form);
    push("government.status", actorPatch.government.status);
    push("government.coalitionName", actorPatch.government.coalitionName);
    push("government.headOfState", officeholderDisplayText(actorPatch.government.headOfState));
    push("government.headOfGovernment", officeholderDisplayText(actorPatch.government.headOfGovernment));
    if (Array.isArray(actorPatch.government.rulingPartyIds) && actorPatch.government.rulingPartyIds.length) {
      push("government.rulingPartyIds", actorPatch.government.rulingPartyIds);
    }
    if (Array.isArray(actorPatch.government.coalitionPartyIds) && actorPatch.government.coalitionPartyIds.length) {
      push("government.coalitionPartyIds", actorPatch.government.coalitionPartyIds);
    }
    push("government.ideology", actorPatch.government.ideology);
  }
  push("leader", officeholderDisplayText(actorPatch.leader));
  for (const key of ["goals", "fears", "ambitions", "domesticPressures"]) push(key, actorPatch[key]);
  push("perceptions", actorPatch.perceptions);
  for (const collection of ["parties", "powerBlocs"]) {
    if (!Array.isArray(actorPatch[collection])) continue;
    actorPatch[collection].forEach((entity, index) => {
      if (!isPlainObject(entity)) return;
      const identity = {
        id: clean(entity.id),
        name: clean(entity.name),
        ...(clean(entity.shortName) ? { shortName: clean(entity.shortName) } : {}),
        ...(clean(entity.status) ? { status: clean(entity.status) } : {}),
        ...(clean(entity.kind) ? { kind: clean(entity.kind) } : {}),
        ...(officeholderDisplayText(entity.leader) ? { leader: officeholderDisplayText(entity.leader) } : {}),
      };
      if (Object.values(identity).some((value) => clean(value))) push(`${collection}[${index}].identity`, identity);
      const semantics = {};
      for (const field of HISTORICAL_SEMANTIC_ENTITY_FIELDS) {
        if (entity[field] !== undefined) semantics[field] = clone(entity[field]);
      }
      push(`${collection}[${index}].semantics`, semantics);
    });
  }
  // Top-level semantic collections are one fact each and each representation
  // entity contributes at most identity + semantics. Even a 24-entity FULL
  // actor therefore remains bounded without silently dropping generated fields.
  return facts.slice(0, 96);
};

export const buildPoliticalWorldTemporalSentinelPrompt = ({
  scenarioDate,
  historyAuthority = null,
  entries = [],
  scenarioContext = "",
  contextByPolity = {},
} = {}) => {
  const authority = historyAuthorityPromptContract(historyAuthority, scenarioDate);
  const systemPrompt = `You are the INDEPENDENT CONSENSUS PASS B / TEMPORAL RED-TEAM SENTINEL for Round-Zero political identity AND semantic authority.\n\n`
    + `${historyAuthorityPromptBlock(historyAuthority, scenarioDate)}\n`
    + `Do not regenerate politics and do not author corrections. Your only job is to attack temporal validity and unauthorized reference-canon leakage.\n\n`
    + `For EVERY supplied FACT id, independently ask whether it is admissible ON ${scenarioDate} under the supplied authority contract. Identity facts must be consistent with scenario canon/current world on that target date. Semantic facts must be plausible actor knowledge/intention/priority/perception then without importing reference knowledge outside the permitted boundary.\n`
    + `Pay special attention to date-sensitive appointments, resignations, acting/caretaker tenures, coups, election transitions, party foundations/dissolutions/mergers/renames, coalition formations, representation-system changes, named doctrines/programs, later outcomes, and hindsight-only strategic framing — but only use external/reference chronology when the supplied authority contract permits it.\n`
    + `${authority.mode === "exclusive" || authority.mode === "none" ? "Do NOT challenge a target-date identity merely because remembered external/reference canon had a different officeholder, party, institution, or outcome after the cutoff. That remembered chronology has no authority here." : "When exact-date external/reference canon is permitted, a party or coalition that existed later in the same month or year is WRONG if it did not yet exist under that identity on the exact target date; likewise a successor officeholder or later-created organization is wrong if not yet valid, unless stronger scenario canon explicitly says otherwise."}\n`
    + `Scenario-authored canon/backstory, authored/derived Round-Zero history, and explicit current world state outrank conflicting external/reference material. A named doctrine/program coined or adopted later in an external canon cannot be imported across the reference boundary merely because it resembles a plausible target-world policy.\n`
    + `Do not challenge spelling, translation, romanization, taxonomy, subjective numeric estimates, or generic political wording unless there is a concrete temporal contradiction or post-boundary hindsight leak.\n`
    + `If you cannot establish exact-date validity for a supplied FACT with enough confidence to defend it, challenge that FACT for focused adjudication rather than guessing clear.\n`
    + `verdict=clear is allowed ONLY after you individually checked EVERY supplied FACT id and returned every id in checkedFactIds. If even one supplied fact was not checked, do not claim clear.\n`
    + `verdict=challenge requires a short concrete exact-date issue and the implicated challengedFactIds. Do NOT provide a correction; the focused adjudicator will do that.\n`
    + `TOOL TRANSPORT: checksJson is a JSON STRING containing the complete array of check objects. Do not return a nested checks array to the tool and do not use markdown fences.\n`
    + `Each checksJson object must use ONLY polityKey, verdict, confidence, issue, checkedFactIds, and challengedFactIds. No comments, _comment fields, duplicate keys, or extra prose are allowed.\n`
    + `Return exactly one check for every requested polity using the supplied tool.`;

  const blocks = (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const polityKey = clean(entry?.item?.polityKey);
    const facts = temporalSentinelFactsForEntry(entry);
    return [
      `=== ${index + 1} ===`,
      `POLITY: ${polityKey}`,
      `TEMPORAL FACTS — every FACT id must be checked:`,
      ...(facts.length ? facts.map((fact) => `${fact.id} [${fact.path}] ${fact.display}`) : ["(none)"]),
      `POLITY-SPECIFIC SCENARIO CONTEXT:`,
      contextByPolity?.[polityKey] ? truncate(contextByPolity[polityKey], 1500) : "(none supplied)",
    ].join("\n");
  });

  const userMessage = [
    `SCENARIO DATE: ${scenarioDate}`,
    "INDEPENDENT CONSENSUS PASS B — TEMPORAL RED-TEAM SENTINEL",
    "",
    "GLOBAL SCENARIO CANON / BACKSTORY (authoritative when supplied):",
    scenarioContext ? truncate(scenarioContext, 5000) : "(none supplied)",
    "",
    "RED-TEAM THESE RESULTING ROUND-ZERO POLITICAL FACTS FOR TEMPORAL/HINDSIGHT LEAKAGE:",
    ...blocks,
  ].join("\n");
  return { systemPrompt, userMessage };
};

export const buildPoliticalWorldGenerationPrompt = ({
  scenarioDate,
  historyAuthority = null,
  items,
  politicalActors,
  scenarioContext = "",
  contextByPolity = {},
  previousErrors = {},
  allowEntityExpansionByPolity = {},
  politicalSystemLocks = {},
} = {}) => {
  const authority = historyAuthorityPromptContract(historyAuthority, scenarioDate);
  const systemPrompt = `You generate MISSING starting political state for a scenario-driven living-world simulator.\n\n`
    + `${historyAuthorityPromptBlock(historyAuthority, scenarioDate)}\n`
    + `HARD AUTHORITY RULES:\n`
    + `- Generate the actor state for the TARGET START-WORLD DATE ${scenarioDate}. The target date and the external/reference evidence cutoff are separate concepts.\n`
    + `- ${authority.referenceRule} sourceAsOf/referenceDates refer ONLY to external/reference evidence and must obey that boundary. Scenario-authored or derived canon dates are not external reference dates and must not be reported as provenance.referenceDates.\n`
    + `- TEMPORAL SEMANTIC AUTHORITY: EVERY generated goal, fear, ambition, domestic pressure, perception, ideology, party/bloc priority, foreign-policy tendency, private goal, internal strategy, named doctrine, named policy initiative, and response issue must be admissible AS OF ${scenarioDate} under supplied scenario canon plus only permitted external/reference evidence. Do not import later-coined names, later-adopted programs, post-boundary outcomes, or hindsight from an external canon. Generic motives independently plausible in this scenario are allowed.\n`
    + `- Scenario-authored canon, authored/derived Round-Zero history, and explicit current world state are the world. Never snap them back toward a remembered external timeline.\n`
    + `- Existing canonical political state is stronger authority than you. Fill gaps only.\n`
    + `- Return only requested missing needs. actorPatch MUST contain concrete canonical fields that satisfy every listed need; never return actorPatch={} while needs are listed. Native code discards harmless unrequested extras before validation, but those extras never become canon.\n`
    + `- politicalSystem should be an object with type and representation when known; government should use canonical form/headOfState/headOfGovernment/ideology fields rather than inventing alternate schema keys.\n`
    + `- government.headOfState and government.headOfGovernment MUST name the FORMAL current officeholders on ${scenarioDate}, not merely the supreme leader, paramount party leader, de facto strongman, military patron, or other politically dominant figure. If a different person is the supreme/de facto political leader, put that person in top-level leader when relevant while keeping the formal officeholders correct.\n`
    + `- DECISION AUTHORITY: top-level leader and top-level traits describe the operative primary political decision-maker, not automatically the ceremonial head of state. In parliamentary republics and constitutional monarchies this is normally the head of government; in presidential systems it is normally the president; in semi-presidential systems identify the actually dominant/shared executive; in party-states, juntas, absolute monarchies and personalist systems use the supreme operative leader. Apply this structural rule even when enriching a legacy actor whose leader field merely duplicates a ceremonial head of state. Never use country-name hardcodes.\n`
    + `- QUANTITATIVE ROUND-ZERO LANDSCAPE: when quantitative_landscape is requested, provide approximate integer starting percentages so the campaign has a numeric political baseline. These are estimates, NOT claimed polling measurements. Native code marks them generated-estimate and repairs bad totals/missing values without retrying.\n`
    + `- For electoral representation, put supportEstimate (0-100 integer) on each represented party. Other/unlisted support is allowed ONLY as a genuinely diffuse residual: never use a synthetic party named Other/Independents to satisfy roster coverage. For generated competitive electoral rosters, named meaningful parties should together explain at least ${POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN}% of estimated support; if they do not, materialize additional real significant forces instead of hiding them in Other. Do not use false decimal precision.\n`
    + `- For party_state representation, prefer influenceEstimate (0-100 integer) on powerBlocs when powerBlocs are present; if the party-state is represented only by parties, put influenceEstimate on those parties. This is political influence/control, NOT voter support.\n`
    + `- For court_factions, elite_factions, military_factions, revolutionary_factions, or colonial representation, put influenceEstimate (0-100 integer) on each powerBloc. If representation=none but the existing canonical actor already contains powerBlocs, estimate influence for those existing blocs without changing representation. Never invent electoral polling for non-electoral systems.\n`
    + `- If quantitative_landscape is the ONLY requested need, keep the response tiny: return only the existing stable entity ids (names optional for existing ids) plus supportEstimate/influenceEstimate. Do not rewrite officeholders, ideology, party identity, or other already-canonical state.\n`
    + `- Need mapping is canonical: political_system -> politicalSystem; governing_structure -> government/leader; representation_entities -> parties for electoral systems, parties and/or powerBlocs for true party_state systems, and powerBlocs for other non-electoral systems; quantitative_landscape -> party supportEstimate for electoral systems or influenceEstimate for non-electoral/party-state power actors; structured_leadership_traits -> traits; entity_response_profiles -> entity politicalResponse; governing_entity_context -> current governing/dominant entity ideology plus concise goals/publicPriorities/publicForeignPolicy (and optional private/internal strategy at richer depths); strategic_context -> goals/fears/ambitions plus government.ideology; structured_perceptions -> perceptions; domestic_context -> domesticPressures and/or government approval/stability.\n`
    + `- For domestic_context, use ONLY top-level domesticPressures (an array of pressure strings) and/or government.approval/government.stability. Never create an actorPatch.domesticContext wrapper; it is not canonical Political Actor state.\n`
    + `- TOOL TRANSPORT: actorPatchJson is a JSON STRING containing the actorPatch object. Put the canonical political object inside that string; do not return actorPatch as a nested tool object and do not use markdown fences.\n`
    + `- Inside actorPatchJson, strategic context must be top-level goals/fears/ambitions plus government.ideology. A nested strategicContext object is tolerated and normalized natively, but top-level canonical fields are preferred.\n`
    + `- politicalResponse.issues may be either a canonical issue-key map or an array of {issue, position, sensitivity, strainResponse}. EVERY issue profile must contain all three numeric metrics position, sensitivity, and strainResponse; never use numeric shorthand such as {security: 90}. Perceptions may be either a canonical target-key map or {entries:[{target, threat, opportunity, weakness, cohesionEstimate}]}. Native code canonicalizes the array forms before validation.\n`
    + `- Determine the political system before choosing its representation. Competitive elections are NOT the default. Use canonical representation values only: electoral, court_factions, party_state, elite_factions, military_factions, revolutionary_factions, colonial, or none. Native code normalizes common provider synonyms, but canonical values are preferred.\n`
    + `- politicalSystem.regimeCharacter is required whenever political_system is generated: democratic, hybrid, authoritarian, totalitarian, theocratic, military, colonial, or other. Classify actual political contestation and authority on the scenario date, not just constitutional wording. A presidential/parliamentary republic or electoral representation can still be authoritarian or hybrid.\n`
    + `- party_state is reserved for genuine one-party/vanguard-party state structures. Do NOT use party_state merely as shorthand for an authoritarian or dominant-party republic that still has meaningful opposition parties; use electoral or the appropriate factional representation based on how power actually works. If you choose party_state, politicalSystem.type or government.form must explicitly describe a one-party, single-party, vanguard-party, party-led, or party-state structure; generic/dominant-party republic wording will be rejected. Wording such as dominant-party state, dominant party, or one-party dominant is NOT party-state evidence.\n`
    + `- On a corrective retry, if a POLITICAL SYSTEM LOCK is supplied for a polity, do not change the field(s) explicitly listed as locked. A field omitted from the lock is intentionally repairable and should be corrected when validation names it. A representation_entities failure with representation locked means repair parties/powerBlocs to match that representation; a party_state semantic failure with only type locked means change representation rather than rewriting the regime type. When representation is changed, the representation roster MUST be reshaped in the same response to the canonical collection for the new representation; representation and roster shape are one atomic repair.\n`
    + `- Non-electoral systems use power blocs/court/elite/military/revolutionary/colonial structures as appropriate. Their quantitative_landscape percentages mean estimated political influence/control, never electoral polling.\n`
    + `- COLLECTION SHAPE IS STRICT: actorPatch.parties and actorPatch.powerBlocs MUST ALWAYS be JSON arrays of entity objects, including on corrective retries. NEVER return a keyed object/map/dictionary such as {"democratic-party": {...}}. Every entity object carries its own stable id field.\n`
    + `- Parties and power blocs require stable lowercase slug-like ids that survive renames. Government party references use those exact ids.\n`
    + `- For competitive electoral systems, political significance—not a fixed party count—controls roster breadth. ALWAYS materialize every ruling/governing/formal coalition or confidence-support force needed to explain the current government, even when small. Then include individually significant opposition forces and continue until the named modeled parties explain at least ${POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN}% of estimated support. Only the genuinely diffuse remainder belongs in Other. Set government.rulingPartyIds/coalitionPartyIds to the stable ids you generated when those roles are known. When quantitative_landscape is requested, provide supportEstimate for EVERY represented party so native coverage validation does not mistake fallback arithmetic for evidence that the roster is broad enough.\n`
    + `- behavioralDisposition and politicalPressures are native runtime-derived state and MUST NEVER appear in actorPatch.\n`
    + `- Structured leader traits belong in top-level actorPatch.traits, not nested under leader, and describe the operative primary political decision-maker defined above. If leader is an object, keep it to officeholder identity fields such as id/name/title. Traits should use bounded 0-100 values when justified. Useful native keys include riskTolerance, recklessness, caution, opportunism, militarism, conciliatory, pragmatism, paranoia, vindictiveness, consensusDriven. Do not force every key.\n`
    + `- Hidden politicalResponse profiles may use organization/credibility/inertia/resilience 0-100 and sparse issues. Issue position/strainResponse are -100..100; sensitivity is 0-100. Only encode issues that materially distinguish the entity.\n`
    + `- Structured perceptions should describe beliefs, not truth. Useful bounded keys include threat, opportunity, weakness, cohesionEstimate.\n`
    + `- Never create extra polities. Never generate events. Never simulate future campaign outcomes.\n\n`
    + `OUTPUT: use the supplied tool. One proposal per requested polity. polityKey must match exactly.`;

  const userMessage = [
    `SCENARIO DATE: ${scenarioDate}`,
    "",
    "GLOBAL SCENARIO CANON / BACKSTORY (authoritative when supplied):",
    scenarioContext ? truncate(scenarioContext, 9000) : "(none supplied)",
    "",
    "REQUESTED POLITIES:",
    ...(Array.isArray(items) ? items : []).map((item, index) => `\n=== ${index + 1} ===\n${itemBlock(item, { politicalActors, contextByPolity, previousErrors, allowEntityExpansionByPolity, politicalSystemLocks })}`),
  ].join("\n");

  return { systemPrompt, userMessage };
};

const wrapRawProposal = (rawProposal, item, { scenarioDate, generatedAt }) => ({
  schemaVersion: POLITICAL_WORLD_GENERATION_SCHEMA_VERSION,
  polityKey: item.polityKey,
  scenarioDate,
  depth: item.depth,
  provenance: {
    source: "generated",
    confidence: normalizeConfidence(rawProposal?.confidence),
    generatedAt,
  },
  ...(clean(rawProposal?.sourceAsOf) ? { sourceAsOf: clean(rawProposal.sourceAsOf) } : {}),
  ...(Array.isArray(rawProposal?.referenceDates) ? { referenceDates: rawProposal.referenceDates.slice(0, 32) } : {}),
  actorPatch: isPlainObject(rawProposal?.actorPatch) ? clone(rawProposal.actorPatch) : rawProposal?.actorPatch,
});

const decodeJsonEscapesOneLayer = (value) => {
  const text = typeof value === "string" ? value : "";
  if (!text.includes("\\")) return null;
  let out = "";
  let changed = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    if (index + 1 >= text.length) return null;
    const escaped = text[index + 1];
    if (escaped === '"' || escaped === "\\" || escaped === "/") {
      out += escaped;
      index += 1;
      changed = true;
      continue;
    }
    const controls = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    if (Object.prototype.hasOwnProperty.call(controls, escaped)) {
      out += controls[escaped];
      index += 1;
      changed = true;
      continue;
    }
    if (escaped === "u") {
      const hex = text.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return null;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      changed = true;
      continue;
    }
    return null;
  }
  return changed ? out : null;
};

const parseConservativeJsonObjectText = (value) => {
  const rawJson = typeof value === "string" ? value.trim() : "";
  if (!rawJson) return null;
  const pending = [{ text: rawJson, depth: 0 }];
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    const unfenced = current.text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const candidates = [unfenced];
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(unfenced.slice(first, last + 1));
    for (const candidate of candidates) {
      if (!candidate || seen.has(`${current.depth}:${candidate}`)) continue;
      seen.add(`${current.depth}:${candidate}`);
      try {
        const parsed = JSON.parse(candidate);
        if (isPlainObject(parsed)) return parsed;
        if (typeof parsed === "string" && current.depth < 1 && parsed.trim()) {
          pending.push({ text: parsed, depth: current.depth + 1 });
        }
      } catch {
        // Fall through to one conservative transport-unescape pass below.
      }
      if (current.depth < 1) {
        const decoded = decodeJsonEscapesOneLayer(candidate);
        if (decoded && decoded !== candidate) pending.push({ text: decoded, depth: current.depth + 1 });
      }
    }
  }
  return null;
};

const salvageFlatJsonObjectArrayMembers = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first < 0 || last <= first) return null;
  const body = text.slice(first + 1, last).trim();
  if (!body) return [];

  // Sentinel check objects are intentionally flat (scalar fields plus string
  // arrays). If one provider-invented field makes one object invalid JSON, do
  // not throw away the other eleven valid polity checks. Split only at flat
  // object boundaries, parse each member conservatively, and let the normal
  // omitted-polity path fail closed for the malformed member.
  const pieces = body.split(/}\s*,\s*{/g);
  const parsed = [];
  for (let index = 0; index < pieces.length; index += 1) {
    let candidate = pieces[index].trim();
    if (!candidate) continue;
    if (index > 0) candidate = `{${candidate}`;
    if (index < pieces.length - 1) candidate = `${candidate}}`;
    const object = parseConservativeJsonObjectText(candidate);
    if (object) parsed.push(object);
  }
  return parsed.length ? parsed : null;
};

const parseConservativeJsonArrayText = (value) => {
  const rawJson = typeof value === "string" ? value.trim() : "";
  if (!rawJson) return null;
  const pending = [{ text: rawJson, depth: 0 }];
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    const unfenced = current.text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const candidates = [unfenced];
    const first = unfenced.indexOf("[");
    const last = unfenced.lastIndexOf("]");
    if (first >= 0 && last > first) candidates.push(unfenced.slice(first, last + 1));
    for (const candidate of candidates) {
      if (!candidate || seen.has(`${current.depth}:${candidate}`)) continue;
      seen.add(`${current.depth}:${candidate}`);
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string" && current.depth < 1 && parsed.trim()) {
          pending.push({ text: parsed, depth: current.depth + 1 });
        }
      } catch {
        const salvaged = salvageFlatJsonObjectArrayMembers(candidate);
        if (Array.isArray(salvaged) && salvaged.length) return salvaged;
        // Fall through to one conservative transport-unescape pass below.
      }
      if (current.depth < 1) {
        const decoded = decodeJsonEscapesOneLayer(candidate);
        if (decoded && decoded !== candidate) pending.push({ text: decoded, depth: current.depth + 1 });
      }
    }
  }
  return null;
};

const parseActorPatchFromWireProposal = (rawProposal) => {
  if (isPlainObject(rawProposal?.actorPatch)) return canonicalizeWireActorPatch(rawProposal.actorPatch);
  const parsed = parseConservativeJsonObjectText(rawProposal?.actorPatchJson);
  return parsed ? canonicalizeWireActorPatch(parsed) : null;
};

const parseHistoricalIdentityJson = (value) => parseConservativeJsonObjectText(value);

const jsonEquivalent = (left, right) => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonEquivalent(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!jsonEquivalent(leftKeys, rightKeys)) return false;
    return leftKeys.every((key) => jsonEquivalent(left[key], right[key]));
  }
  return false;
};

const normalizeHistoricalCorrectionScopes = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => clean(entry).toLocaleLowerCase()).filter((entry) => HISTORICAL_CORRECTION_SCOPE_SET.has(entry)))];
};

const scopeHistoricalIdentityEntityCorrections = (entities) => {
  if (!Array.isArray(entities)) return undefined;
  return entities.filter(isPlainObject).map((entity) => {
    const out = {};
    for (const key of ["id", "name", "shortName", "ideology", "status", "kind", "leader"]) {
      if (entity[key] !== undefined) out[key] = clone(entity[key]);
    }
    return out;
  }).filter((entity) => Object.keys(entity).length);
};

const scopeHistoricalSemanticEntityCorrections = (entities, originalEntities) => {
  if (!Array.isArray(entities) || !Array.isArray(originalEntities)) return undefined;
  const out = [];
  for (const entity of entities.filter(isPlainObject)) {
    const previous = originalEntities.find((candidate) => historicalEntityIdentityMatch(candidate, entity));
    if (!previous) continue;
    const scoped = {};
    if (clean(previous.id)) scoped.id = clone(previous.id);
    else if (clean(previous.name)) scoped.name = clone(previous.name);
    let semanticFields = 0;
    for (const key of HISTORICAL_SEMANTIC_ENTITY_FIELDS) {
      if (entity[key] === undefined || previous[key] === undefined) continue;
      scoped[key] = clone(entity[key]);
      semanticFields += 1;
    }
    if (semanticFields) out.push(scoped);
  }
  return out.length ? out : undefined;
};

const mergeScopedHistoricalEntities = (...collections) => {
  const out = [];
  for (const entities of collections) {
    for (const entity of Array.isArray(entities) ? entities : []) {
      const index = out.findIndex((candidate) => historicalEntityIdentityMatch(candidate, entity));
      if (index >= 0) out[index] = { ...out[index], ...clone(entity) };
      else out.push(clone(entity));
    }
  }
  return out.length ? out : undefined;
};

const historicalIdentityCorrectionScope = (correction, originalPatch, item, correctionScopes = []) => {
  if (!isPlainObject(correction) || !isPlainObject(originalPatch)) return null;
  const scopes = new Set(correctionScopes);
  const out = {};
  if (scopes.has(HISTORICAL_CORRECTION_SCOPES.POLITICAL_SYSTEM)
    && isPlainObject(correction.politicalSystem)
    && isPlainObject(originalPatch.politicalSystem)) {
    out.politicalSystem = {};
    for (const key of ["type", "representation", "label", "notes"]) {
      if (correction.politicalSystem[key] !== undefined && originalPatch.politicalSystem[key] !== undefined) {
        out.politicalSystem[key] = clone(correction.politicalSystem[key]);
      }
    }
    if (!Object.keys(out.politicalSystem).length) delete out.politicalSystem;
  }
  if (isPlainObject(correction.government) && isPlainObject(originalPatch.government)) {
    out.government = {};
    if (scopes.has(HISTORICAL_CORRECTION_SCOPES.GOVERNMENT_STRUCTURE)) {
      for (const key of ["form", "status", "coalitionName"]) {
        if (correction.government[key] !== undefined && originalPatch.government[key] !== undefined) out.government[key] = clone(correction.government[key]);
      }
    }
    if (scopes.has(HISTORICAL_CORRECTION_SCOPES.OFFICEHOLDERS)) {
      for (const key of ["headOfState", "headOfGovernment"]) {
        if (correction.government[key] !== undefined && originalPatch.government[key] !== undefined) out.government[key] = clone(correction.government[key]);
      }
    }
    if (scopes.has(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER)) {
      for (const key of ["rulingPartyIds", "coalitionPartyIds"]) {
        if (correction.government[key] !== undefined && originalPatch.government[key] !== undefined) out.government[key] = clone(correction.government[key]);
      }
    }
    if (scopes.has(HISTORICAL_CORRECTION_SCOPES.GOVERNING_SEMANTICS)
      && correction.government.ideology !== undefined
      && originalPatch.government.ideology !== undefined) {
      out.government.ideology = clone(correction.government.ideology);
    }
    if (!Object.keys(out.government).length) delete out.government;
  }
  if (scopes.has(HISTORICAL_CORRECTION_SCOPES.OFFICEHOLDERS)
    && correction.leader !== undefined
    && originalPatch.leader !== undefined) out.leader = clone(correction.leader);

  if (scopes.has(HISTORICAL_CORRECTION_SCOPES.STRATEGIC_SEMANTICS)) {
    for (const key of ["goals", "fears", "ambitions"]) {
      if (correction[key] !== undefined && originalPatch[key] !== undefined) out[key] = clone(correction[key]);
    }
  }
  if (scopes.has(HISTORICAL_CORRECTION_SCOPES.PERCEPTIONS)
    && correction.perceptions !== undefined
    && originalPatch.perceptions !== undefined) out.perceptions = clone(correction.perceptions);
  if (scopes.has(HISTORICAL_CORRECTION_SCOPES.DOMESTIC_SEMANTICS)
    && correction.domesticPressures !== undefined
    && originalPatch.domesticPressures !== undefined) out.domesticPressures = clone(correction.domesticPressures);

  const generatedRepresentationEntities = Array.isArray(item?.needs) && item.needs.includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES);
  for (const collection of ["parties", "powerBlocs"]) {
    const identity = scopes.has(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER)
      ? scopeHistoricalIdentityEntityCorrections(correction[collection])
      : undefined;
    const semantics = scopes.has(HISTORICAL_CORRECTION_SCOPES.GOVERNING_SEMANTICS)
      ? scopeHistoricalSemanticEntityCorrections(correction[collection], originalPatch[collection])
      : undefined;
    const merged = mergeScopedHistoricalEntities(identity, semantics);
    if (merged && ((scopes.has(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER) && generatedRepresentationEntities)
      || Array.isArray(originalPatch[collection]))) out[collection] = merged;
  }
  return out;
};

const historicalCorrectionScopesFromScoped = (scoped, declaredScopes = []) => {
  const scopes = new Set();
  const declared = new Set(declaredScopes);
  if (!isPlainObject(scoped)) return scopes;
  if (isPlainObject(scoped.politicalSystem) && Object.keys(scoped.politicalSystem).length) scopes.add(HISTORICAL_CORRECTION_SCOPES.POLITICAL_SYSTEM);
  if (isPlainObject(scoped.government)) {
    if (["form", "status", "coalitionName"].some((key) => scoped.government[key] !== undefined)) scopes.add(HISTORICAL_CORRECTION_SCOPES.GOVERNMENT_STRUCTURE);
    if (["headOfState", "headOfGovernment"].some((key) => scoped.government[key] !== undefined)) scopes.add(HISTORICAL_CORRECTION_SCOPES.OFFICEHOLDERS);
    if (["rulingPartyIds", "coalitionPartyIds"].some((key) => scoped.government[key] !== undefined)) scopes.add(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER);
    if (scoped.government.ideology !== undefined) scopes.add(HISTORICAL_CORRECTION_SCOPES.GOVERNING_SEMANTICS);
  }
  if (scoped.leader !== undefined) scopes.add(HISTORICAL_CORRECTION_SCOPES.OFFICEHOLDERS);
  if (["goals", "fears", "ambitions"].some((key) => scoped[key] !== undefined)) scopes.add(HISTORICAL_CORRECTION_SCOPES.STRATEGIC_SEMANTICS);
  if (scoped.perceptions !== undefined) scopes.add(HISTORICAL_CORRECTION_SCOPES.PERCEPTIONS);
  if (scoped.domesticPressures !== undefined) scopes.add(HISTORICAL_CORRECTION_SCOPES.DOMESTIC_SEMANTICS);
  for (const collection of ["parties", "powerBlocs"]) {
    for (const entity of Array.isArray(scoped[collection]) ? scoped[collection] : []) {
      if (!isPlainObject(entity)) continue;
      const keys = Object.keys(entity).filter((key) => key !== "id");
      const hasIdentity = keys.some((key) => ["name", "shortName", "status", "kind", "leader"].includes(key));
      const semanticKeys = keys.filter((key) => HISTORICAL_SEMANTIC_ENTITY_FIELDS.includes(key));
      const hasSemantic = semanticKeys.length > 0;
      if (hasIdentity && (declared.has(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER) || !declared.has(HISTORICAL_CORRECTION_SCOPES.GOVERNING_SEMANTICS))) {
        scopes.add(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER);
      }
      if (hasSemantic && (declared.has(HISTORICAL_CORRECTION_SCOPES.GOVERNING_SEMANTICS) || semanticKeys.some((key) => key !== "ideology"))) {
        scopes.add(HISTORICAL_CORRECTION_SCOPES.GOVERNING_SEMANTICS);
      }
      if (!hasIdentity && !hasSemantic && keys.length) scopes.add(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER);
    }
  }
  return scopes;
};

const historicalCorrectionMeaningfullyChangesCandidate = (scoped, originalPatch, { replaceRepresentationEntities = false } = {}) => {
  if (!isPlainObject(scoped) || !isPlainObject(originalPatch)) return false;
  for (const [key, value] of Object.entries(scoped)) {
    if ((key === "parties" || key === "powerBlocs") && Array.isArray(value)) {
      const existing = Array.isArray(originalPatch[key]) ? originalPatch[key] : [];
      if (replaceRepresentationEntities && value.length !== existing.length) return true;
      for (const correction of value) {
        if (!isPlainObject(correction)) return true;
        const previous = existing.find((entity) => historicalEntityIdentityMatch(entity, correction));
        if (!previous) return true;
        for (const [field, fieldValue] of Object.entries(correction)) {
          if (!jsonEquivalent(fieldValue, previous[field])) return true;
        }
      }
      continue;
    }
    if (isPlainObject(value)) {
      const original = isPlainObject(originalPatch[key]) ? originalPatch[key] : {};
      for (const [field, fieldValue] of Object.entries(value)) {
        if (!jsonEquivalent(fieldValue, original[field])) return true;
      }
      continue;
    }
    if (!jsonEquivalent(value, originalPatch[key])) return true;
  }
  return false;
};

const historicalDisplayOnlyRosterCorrection = (scoped, originalPatch, { replaceRepresentationEntities = false } = {}) => {
  if (replaceRepresentationEntities || !isPlainObject(scoped) || !isPlainObject(originalPatch)) return false;
  const keys = Object.keys(scoped);
  if (!keys.length || keys.some((key) => key !== "parties" && key !== "powerBlocs")) return false;
  let changed = false;
  for (const collection of keys) {
    const incoming = scoped[collection];
    const existing = Array.isArray(originalPatch[collection]) ? originalPatch[collection] : [];
    if (!Array.isArray(incoming) || !incoming.length) return false;
    for (const correction of incoming) {
      const previous = existing.find((entity) => historicalEntityIdentityMatch(entity, correction));
      if (!previous) return false;
      for (const [field, value] of Object.entries(correction)) {
        if (field === "id") continue;
        if (jsonEquivalent(value, previous[field])) continue;
        changed = true;
        if (!["name", "shortName", "ideology"].includes(field)) return false;
      }
    }
  }
  return changed;
};

const clearlyNonTemporalVerificationIssue = (value) => {
  const issue = clean(value).toLocaleLowerCase();
  if (!issue) return false;
  const terminology = /\b(?:demonym|spelling|translation|transliteration|romanization|terminology|wording|capitalization|hyphenation|display name|preferred name|label)\b/.test(issue);
  const temporal = /\b(?:before|after|later|until|since|postdate(?:s|d)?|on the scenario date|as of|took office|resigned|appointed|elected|sworn|effective|transition|coup|election|coined|adopted|introduced|hindsight|future|19\d{2}|20\d{2})\b/.test(issue);
  return terminology && !temporal;
};

const clearlyTemporalVerificationIssue = (value) => {
  const issue = clean(value).toLocaleLowerCase();
  if (!issue || clearlyNonTemporalVerificationIssue(issue)) return false;
  return /\b(?:before|after|later|until|since|postdate(?:s|d)?|on the scenario date|as of|took office|left office|resigned|appointed|elected|sworn|effective|transition|coup|election|formed|founded|created|established|dissolved|merged|renamed|coined|adopted|introduced|hindsight|future|did not exist|didn't exist|not yet|19\d{2}|20\d{2})\b/.test(issue);
};

const historicalEntityIdentityMatch = (left, right) => {
  const leftId = clean(left?.id).toLocaleLowerCase();
  const rightId = clean(right?.id).toLocaleLowerCase();
  if (leftId && rightId && leftId === rightId) return true;
  const leftName = clean(left?.name).toLocaleLowerCase();
  const rightName = clean(right?.name).toLocaleLowerCase();
  return Boolean(leftName && rightName && leftName === rightName);
};

const mergeHistoricalEntityCollection = (existing, corrections, { replaceSet = false } = {}) => {
  const current = Array.isArray(existing) ? clone(existing) : [];
  const incoming = Array.isArray(corrections) ? corrections.filter(isPlainObject) : [];
  if (replaceSet) {
    return incoming.map((identity) => {
      const previous = current.find((entity) => historicalEntityIdentityMatch(entity, identity));
      return previous ? { ...previous, ...clone(identity) } : clone(identity);
    });
  }
  const out = current;
  for (const identity of incoming) {
    const index = out.findIndex((entity) => historicalEntityIdentityMatch(entity, identity));
    if (index >= 0) out[index] = { ...out[index], ...clone(identity) };
    else out.push(clone(identity));
  }
  return out;
};

const mergeHistoricalIdentityCorrection = (originalPatch, correction, { replaceRepresentationEntities = false } = {}) => {
  const out = clone(originalPatch);
  if (isPlainObject(correction?.politicalSystem)) {
    out.politicalSystem = { ...(isPlainObject(out.politicalSystem) ? out.politicalSystem : {}), ...clone(correction.politicalSystem) };
  }
  if (isPlainObject(correction?.government)) {
    out.government = { ...(isPlainObject(out.government) ? out.government : {}), ...clone(correction.government) };
  }
  if (correction?.leader !== undefined) out.leader = clone(correction.leader);
  for (const key of ["goals", "fears", "ambitions", "domesticPressures", "perceptions"]) {
    if (correction?.[key] !== undefined) out[key] = clone(correction[key]);
  }
  if (replaceRepresentationEntities) {
    if (Array.isArray(correction?.parties)) out.parties = mergeHistoricalEntityCollection(out.parties, correction.parties, { replaceSet: true });
    else delete out.parties;
    if (Array.isArray(correction?.powerBlocs)) out.powerBlocs = mergeHistoricalEntityCollection(out.powerBlocs, correction.powerBlocs, { replaceSet: true });
    else delete out.powerBlocs;
  } else {
    if (Array.isArray(correction?.parties)) out.parties = mergeHistoricalEntityCollection(out.parties, correction.parties);
    if (Array.isArray(correction?.powerBlocs)) out.powerBlocs = mergeHistoricalEntityCollection(out.powerBlocs, correction.powerBlocs);
  }
  return canonicalizeWireActorPatch(out);
};

const shouldHistoricallyVerifyEntry = (entry) => {
  const needs = entry?.item?.needs ?? [];
  return needs.some((need) => [
    POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM,
    POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE,
    POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES,
    POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES,
    POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT,
    POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT,
    POLITICAL_GENERATION_NEEDS.PERCEPTIONS,
    POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT,
  ].includes(need));
};

const scenarioDateIsNotFuture = (scenarioDate, generatedAt) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(clean(scenarioDate)) ? clean(scenarioDate) : "";
  const generated = clean(generatedAt).slice(0, 10);
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(generated)) return true;
  return start <= generated;
};

const temporalAuthorityVerificationAllowed = (scenarioDate, generatedAt, historyAuthority) => {
  const contract = historyAuthorityPromptContract(historyAuthority, scenarioDate);
  // An exclusive pre-divergence contract is safe to audit even when the target
  // start-world date is in the future: the verifier is explicitly forbidden
  // from snapping target-date state to remembered post-boundary chronology.
  if (contract.mode === "exclusive") return true;
  // No-reference worlds are normally not scheduled for this expensive pass at
  // all. If a legacy/manual caller requests it, keep the old future safeguard.
  return scenarioDateIsNotFuture(scenarioDate, generatedAt);
};

export const validateHistoricalVerificationPayload = ({ payload, entries, context }) => {
  const rawVerifications = Array.isArray(payload?.verifications) ? payload.verifications : [];
  const byKey = new Map(entries.map((entry) => [entry.item.polityKey, entry]));
  const counts = new Map();
  for (const raw of rawVerifications) {
    const polityKey = clean(raw?.polityKey);
    if (byKey.has(polityKey)) counts.set(polityKey, (counts.get(polityKey) ?? 0) + 1);
  }
  const confirmed = [];
  const corrected = [];
  const unresolved = [];
  const warnings = [];
  const diagnostics = [];
  const seen = new Set();

  for (const raw of rawVerifications) {
    const polityKey = clean(raw?.polityKey);
    if (!byKey.has(polityKey)) {
      warnings.push(`Ignored unrequested historical verification for ${polityKey || "<blank>"}`);
      continue;
    }
    seen.add(polityKey);
    const entry = byKey.get(polityKey);
    const diagnostic = {
      polityKey,
      verdict: clean(raw?.verdict).toLocaleLowerCase(),
      confidence: normalizeConfidence(raw?.confidence),
      issue: clean(raw?.issue),
      correctionScopes: normalizeHistoricalCorrectionScopes(raw?.correctionScopes),
      replaceRepresentationEntities: raw?.replaceRepresentationEntities === true,
      correctedIdentity: null,
      temporalCorrectionEstablished: false,
      status: "failed",
      errors: [],
    };
    if ((counts.get(polityKey) ?? 0) > 1) {
      diagnostic.errors.push("Temporal verifier returned duplicate entries for this polity");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    if (diagnostic.verdict === "confirmed") {
      if (diagnostic.correctionScopes.length) {
        diagnostic.errors.push("Temporal verifier confirmed this polity but returned non-empty correctionScopes");
        unresolved.push({ entry, errors: [...diagnostic.errors] });
        diagnostics.push(diagnostic);
        continue;
      }
      if (context?.correctionRequiredPolities instanceof Set && context.correctionRequiredPolities.has(polityKey)) {
        diagnostic.errors.push("A previous verification attempt identified a temporal correction; retry must return a valid corrected identity instead of confirming the unchanged candidate");
        unresolved.push({ entry, errors: [...diagnostic.errors] });
        diagnostics.push(diagnostic);
        continue;
      }
      diagnostic.status = "confirmed";
      confirmed.push(entry);
      diagnostics.push(diagnostic);
      continue;
    }
    if (diagnostic.verdict !== "corrected") {
      diagnostic.errors.push("Temporal verifier verdict must be confirmed or corrected");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    if (clearlyNonTemporalVerificationIssue(diagnostic.issue)) {
      diagnostic.verdict = "confirmed";
      diagnostic.correctionScopes = [];
      diagnostic.status = "confirmed";
      warnings.push(`Ignored non-temporal temporal-verifier correction for ${polityKey}: ${diagnostic.issue}`);
      confirmed.push(entry);
      diagnostics.push(diagnostic);
      continue;
    }
    // A clear date contradiction establishes a sticky correction obligation BEFORE
    // transport metadata is validated. This prevents a malformed correctionScopes
    // or correctedIdentityJson payload from letting a later retry rescind a real
    // temporal finding by simply returning CONFIRMED.
    if (clearlyTemporalVerificationIssue(diagnostic.issue)) {
      diagnostic.temporalCorrectionEstablished = true;
    }
    if (!diagnostic.correctionScopes.length) {
      diagnostic.errors.push("Temporal verifier marked this polity corrected but returned no correctionScopes");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    // Valid declared temporal scopes preserve the existing fail-closed behavior
    // even when the issue wording itself is terse or ambiguous.
    diagnostic.temporalCorrectionEstablished = true;
    const parsed = parseHistoricalIdentityJson(raw?.correctedIdentityJson);
    const scoped = historicalIdentityCorrectionScope(parsed, entry.proposal.actorPatch, entry.item, diagnostic.correctionScopes);
    diagnostic.correctedIdentity = clone(scoped);
    if (!isPlainObject(scoped) || !Object.keys(scoped).length) {
      diagnostic.errors.push("Temporal verifier marked this polity corrected but returned no usable generated identity fields for its declared correctionScopes");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    const actualScopes = historicalCorrectionScopesFromScoped(scoped, diagnostic.correctionScopes);
    const undeclaredScopes = [...actualScopes].filter((scope) => !diagnostic.correctionScopes.includes(scope));
    if (undeclaredScopes.length) {
      diagnostic.errors.push(`Historical correction changed undeclared scope(s): ${undeclaredScopes.join(", ")}`);
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    if (!historicalCorrectionMeaningfullyChangesCandidate(scoped, entry.proposal.actorPatch, { replaceRepresentationEntities: diagnostic.replaceRepresentationEntities })) {
      diagnostic.errors.push("Historical correction did not change the generated candidate identity");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    if (diagnostic.correctionScopes.length === 1
      && diagnostic.correctionScopes[0] === HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER
      && historicalDisplayOnlyRosterCorrection(scoped, entry.proposal.actorPatch, { replaceRepresentationEntities: diagnostic.replaceRepresentationEntities })) {
      diagnostic.verdict = "confirmed";
      diagnostic.correctionScopes = [];
      diagnostic.correctedIdentity = null;
      diagnostic.status = "confirmed";
      warnings.push(`Ignored display-only historical roster correction for ${polityKey}; exact-date verification does not rewrite terminology-only labels`);
      confirmed.push(entry);
      diagnostics.push(diagnostic);
      continue;
    }
    const originalRepresentation = clean(entry.proposal.actorPatch?.politicalSystem?.representation).toLocaleLowerCase();
    const correctedRepresentation = clean(scoped?.politicalSystem?.representation).toLocaleLowerCase();
    if (correctedRepresentation && correctedRepresentation !== originalRepresentation
      && !diagnostic.correctionScopes.includes(HISTORICAL_CORRECTION_SCOPES.REPRESENTATION_ROSTER)) {
      diagnostic.errors.push("Historical correction changed politicalSystem.representation without declaring representation_roster correction scope");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    if (correctedRepresentation && correctedRepresentation !== originalRepresentation && raw?.replaceRepresentationEntities !== true) {
      diagnostic.errors.push("Historical correction changed politicalSystem.representation without replaceRepresentationEntities=true");
      unresolved.push({ entry, errors: [...diagnostic.errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    let mergedPatch = mergeHistoricalIdentityCorrection(entry.proposal.actorPatch, scoped, {
      replaceRepresentationEntities: raw?.replaceRepresentationEntities === true,
    });
    if (entry.item.needs.includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE)) {
      const completedLandscape = completeGeneratedPoliticalLandscapePatch(
        context.politicalActors?.byPolity?.[entry.item.polityKey] ?? null,
        mergedPatch,
        { allowEntityExpansion: context.allowEntityExpansionByPolity?.[entry.item.polityKey] === true },
      );
      mergedPatch = completedLandscape.patch;
      for (const warning of completedLandscape.warnings) warnings.push(`${polityKey}: ${warning}`);
    }
    const envelope = { ...clone(entry.proposal), actorPatch: mergedPatch };
    const validation = validatePoliticalGenerationProposal(envelope, {
      polityKey: entry.item.polityKey,
      scenarioDate: context.scenarioDate,
      depth: entry.item.depth,
      existingActor: context.politicalActors?.byPolity?.[entry.item.polityKey] ?? null,
      allowEntityExpansion: context.allowEntityExpansionByPolity?.[entry.item.polityKey] === true,
      historyAuthority: context.historyAuthority || null,
    });
    const errors = [...(validation.errors ?? [])];
    if (!errors.length) {
      const remainingNeeds = assessPoliticalGenerationNeeds(validation.actor, entry.item.depth);
      for (const need of entry.item.needs) {
        if (remainingNeeds.includes(need)) errors.push(`historical correction no longer satisfies requested need ${need}`);
      }
    }
    if (errors.length) {
      diagnostic.errors = errors;
      unresolved.push({ entry, errors: [...errors] });
      diagnostics.push(diagnostic);
      continue;
    }
    const correctedEntry = {
      ...entry,
      proposal: envelope,
      validation,
      historicalVerification: {
        verdict: "corrected",
        confidence: diagnostic.confidence,
        issue: diagnostic.issue,
      },
    };
    diagnostic.status = "corrected";
    corrected.push(correctedEntry);
    diagnostics.push(diagnostic);
  }

  for (const entry of entries) {
    const polityKey = entry.item.polityKey;
    if (seen.has(polityKey)) continue;
    const errors = ["Temporal verifier omitted this polity"];
    unresolved.push({ entry, errors });
    diagnostics.push({ polityKey, verdict: "", confidence: "unknown", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentity: null, temporalCorrectionEstablished: false, status: "failed", errors });
  }
  return { confirmed, corrected, unresolved, warnings, diagnostics };
};

const normalizedOfficeholderCollisionKey = (value, role) => {
  if (looksLikeCompoundOfficeholder(value)) return "";
  let text = officeholderDisplayText(value);
  if (!text) return "";
  text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  text = text.replace(/^(?:acting|caretaker|interim)\s+/i, "");
  if (role === "headOfGovernment") {
    text = text.replace(/^(?:prime minister|premier|chancellor|president|chairman|chief minister|first minister)\s+/i, "");
  } else if (role === "headOfState") {
    text = text.replace(/^(?:president|king|queen|emperor|sultan|emir|prince|grand duke|chairman)\s+/i, "");
  }
  return text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const crossPolityOfficeholderCollisions = (entries = []) => {
  const byPerson = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const polityKey = clean(entry?.item?.polityKey ?? entry?.proposal?.polityKey);
    if (!polityKey) continue;
    const actor = entry?.validation?.actor ?? entry?.proposal?.actorPatch ?? {};
    for (const role of ["headOfState", "headOfGovernment"]) {
      const value = actor?.government?.[role];
      const key = normalizedOfficeholderCollisionKey(value, role);
      if (!key) continue;
      const record = {
        polityKey,
        role,
        display: officeholderDisplayText(value),
      };
      if (!byPerson.has(key)) byPerson.set(key, []);
      byPerson.get(key).push(record);
    }
  }

  const collisions = [];
  for (const [personKey, records] of byPerson.entries()) {
    const polityKeys = [...new Set(records.map((record) => record.polityKey))];
    if (polityKeys.length < 2) continue;
    // Shared heads of state can be legitimate (for example, a monarch shared by
    // multiple realms). A same-date collision becomes suspicious only when at
    // least one assignment claims the person as a head of government.
    if (!records.some((record) => record.role === "headOfGovernment")) continue;
    collisions.push({
      personKey,
      display: records[0]?.display || personKey,
      records,
      polityKeys,
    });
  }
  return collisions;
};

const collisionReviewContextByPolity = (collisions = [], scenarioDate = "") => {
  const out = {};
  for (const collision of collisions) {
    const assignments = collision.records
      .map((record) => `${record.polityKey}: government.${record.role}=${JSON.stringify(record.display)}`)
      .join("; ");
    const message = `MANDATORY SAME-DATE OFFICEHOLDER COLLISION on ${scenarioDate}: ${assignments}. `
      + `At least one assignment may be wrong because the same named person appears across different polities and at least one assignment is headOfGovernment. `
      + `Re-check the FORMAL officeholder for every listed polity on the exact scenario date. Correct the wrong officeholder(s); do not confirm unchanged merely because the repeated name is plausible.`;
    for (const polityKey of collision.polityKeys) {
      out[polityKey] = [out[polityKey], message].filter(Boolean).join("\n");
    }
  }
  return out;
};

const runHistoricalIdentityVerificationPass = async ({
  entries,
  scenarioDate,
  historyAuthority = null,
  politicalActors,
  scenarioContext,
  contextByPolity,
  allowEntityExpansionByPolity,
  callModel,
  signal,
  onBatch,
  reviewContextByPolity = {},
  initialCorrectionRequiredPolities = [],
  pass = "initial",
} = {}) => {
  const batches = [];
  const diagnostics = [];
  const warnings = [];
  const finalEntries = [];
  const failures = [];
  let confirmedCount = 0;
  let correctedCount = 0;
  let resolvedCount = 0;
  const chunks = [];
  for (let index = 0; index < entries.length; index += POLITICAL_WORLD_HISTORICAL_VERIFICATION_BATCH_SIZE) {
    chunks.push(entries.slice(index, index + POLITICAL_WORLD_HISTORICAL_VERIFICATION_BATCH_SIZE));
  }

  for (const [batchIndex, initialEntries] of chunks.entries()) {
    let unresolvedEntries = [...initialEntries];
    let previousErrors = {};
    const resolvedKeys = new Set();
    const correctionRequiredPolities = new Set(
      [...(initialCorrectionRequiredPolities instanceof Set ? initialCorrectionRequiredPolities : initialCorrectionRequiredPolities ?? [])]
        .map((value) => clean(value))
        .filter(Boolean),
    );
    let attempts = 0;
    while (unresolvedEntries.length && attempts < POLITICAL_WORLD_HISTORICAL_VERIFICATION_MAX_ATTEMPTS) {
      if (signal?.aborted) throw signal.reason || new DOMException("Political world historical verification cancelled.", "AbortError");
      attempts += 1;
      const { systemPrompt, userMessage } = buildPoliticalWorldHistoricalVerificationPrompt({
        scenarioDate,
        historyAuthority,
        entries: unresolvedEntries,
        scenarioContext,
        contextByPolity,
        previousErrors,
        reviewContextByPolity,
        correctionRequiredPolities,
      });
      const response = await callModel(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
        signal,
        reasoningEnabled: false,
        taskKey: "politicalWorldVerification",
        logLabel: pass === "collision-recheck"
          ? "political world exact-date collision recheck"
          : pass === "consensus-adjudication"
            ? "political world exact-date consensus adjudication"
            : pass === "consensus-b"
              ? "political world exact-date independent verification B"
              : pass === "consensus-a"
                ? "political world exact-date independent verification A"
                : "political world exact-date verification",
        tool: POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL,
      });
      const payload = parseResponseObject(response);
      if (!payload) {
        previousErrors = Object.fromEntries(unresolvedEntries.map((entry) => [
          entry.item.polityKey,
          ["Historical verification response was not parseable structured output"],
        ]));
        diagnostics.push({
          pass,
          batchIndex,
          attempt: attempts,
          requested: unresolvedEntries.map((entry) => entry.item.polityKey),
          providerResponse: typeof response === "string" ? truncate(response, 40000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
          parsedPayload: null,
          warnings: [],
          polities: unresolvedEntries.map((entry) => ({ polityKey: entry.item.polityKey, status: "failed", errors: ["Historical verification response was not parseable structured output"] })),
        });
      } else {
        const checked = validateHistoricalVerificationPayload({
          payload,
          entries: unresolvedEntries,
          context: { scenarioDate, historyAuthority, politicalActors, allowEntityExpansionByPolity, correctionRequiredPolities },
        });
        for (const diagnostic of checked.diagnostics) {
          if (diagnostic.temporalCorrectionEstablished === true && diagnostic.status === "failed") {
            correctionRequiredPolities.add(diagnostic.polityKey);
          }
        }
        warnings.push(...checked.warnings);
        diagnostics.push({
          pass,
          batchIndex,
          attempt: attempts,
          requested: unresolvedEntries.map((entry) => entry.item.polityKey),
          providerResponse: typeof response === "string" ? truncate(response, 40000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
          parsedPayload: clone(payload),
          warnings: [...checked.warnings],
          polities: clone(checked.diagnostics),
        });
        const verificationDiagnosticByKey = new Map(checked.diagnostics.map((diagnostic) => [diagnostic.polityKey, diagnostic]));
        for (const entry of checked.confirmed) {
          if (resolvedKeys.has(entry.item.polityKey)) continue;
          resolvedKeys.add(entry.item.polityKey);
          const verificationDiagnostic = verificationDiagnosticByKey.get(entry.item.polityKey);
          finalEntries.push({
            ...entry,
            historicalVerification: {
              verdict: "confirmed",
              confidence: verificationDiagnostic?.confidence ?? "unknown",
              issue: verificationDiagnostic?.issue ?? "",
            },
          });
          confirmedCount += 1;
        }
        for (const entry of checked.corrected) {
          if (resolvedKeys.has(entry.item.polityKey)) continue;
          resolvedKeys.add(entry.item.polityKey);
          finalEntries.push(entry);
          correctedCount += 1;
        }
        const unresolvedKeys = new Set(checked.unresolved.map(({ entry }) => entry.item.polityKey));
        previousErrors = Object.fromEntries(checked.unresolved.map(({ entry, errors }) => [entry.item.polityKey, [...errors]]));
        unresolvedEntries = unresolvedEntries.filter((entry) => unresolvedKeys.has(entry.item.polityKey));
      }
      if (attempts >= POLITICAL_WORLD_HISTORICAL_VERIFICATION_MAX_ATTEMPTS && unresolvedEntries.length) {
        for (const entry of unresolvedEntries) {
          failures.push({
            polityKey: entry.item.polityKey,
            depth: entry.item.depth,
            needs: [...entry.item.needs],
            errors: [...(previousErrors[entry.item.polityKey] ?? ["Exact-date Round-Zero historical verification did not produce a valid confirmation/correction"])],
          });
        }
      }
      resolvedCount = confirmedCount + correctedCount + failures.length;
      if (typeof onBatch === "function") {
        onBatch({
          phase: "historical-verification",
          verificationPass: pass,
          batchIndex,
          totalBatches: chunks.length,
          attempt: attempts,
          maxAttempts: POLITICAL_WORLD_HISTORICAL_VERIFICATION_MAX_ATTEMPTS,
          accepted: [],
          unresolved: unresolvedEntries.map((entry) => entry.item.polityKey),
          resolvedPolities: resolvedCount,
          totalPolities: entries.length,
          acceptedTotal: confirmedCount + correctedCount,
          failedTotal: failures.length,
          verifiedTotal: confirmedCount,
          correctedTotal: correctedCount,
          sampleError: null,
        });
      }
    }
    batches.push({
      pass,
      batchIndex,
      requested: initialEntries.map((entry) => entry.item.polityKey),
      attempts,
      confirmed: initialEntries.filter((entry) => finalEntries.some((candidate) => candidate.item.polityKey === entry.item.polityKey && candidate.historicalVerification?.verdict === "confirmed")).map((entry) => entry.item.polityKey),
      corrected: initialEntries.filter((entry) => finalEntries.some((candidate) => candidate.item.polityKey === entry.item.polityKey && candidate.historicalVerification?.verdict === "corrected")).map((entry) => entry.item.polityKey),
      failed: initialEntries.filter((entry) => failures.some((failure) => failure.polityKey === entry.item.polityKey)).map((entry) => entry.item.polityKey),
    });
  }

  return {
    entries: finalEntries,
    failures,
    warnings,
    diagnostics,
    batches,
    confirmed: confirmedCount,
    corrected: correctedCount,
  };
};

export const validateTemporalSentinelPayload = ({ payload, entries = [] } = {}) => {
  const requested = Array.isArray(entries) ? entries : [];
  const byKey = new Map(requested.map((entry) => [clean(entry?.item?.polityKey), entry]).filter(([key]) => Boolean(key)));
  const expectedFactsByKey = new Map(requested.map((entry) => [clean(entry?.item?.polityKey), temporalSentinelFactsForEntry(entry)]));
  const resolvePolityKey = buildRequestedPolityTransportResolver(requested);
  let rawChecks = Array.isArray(payload?.checks) ? payload.checks : null;
  if (!rawChecks && typeof payload?.checksJson === "string") {
    rawChecks = parseConservativeJsonArrayText(payload.checksJson);
  }

  // Defensive compatibility for providers/tests that ignore the requested sentinel
  // tool and answer with the older verifier envelope. Production providers should
  // use `checksJson`; this fallback prevents transport mismatch from silently clearing a
  // polity and always preserves a correction as a challenge.
  if (!rawChecks && Array.isArray(payload?.verifications)) {
    rawChecks = payload.verifications.map((raw) => {
      const polityKey = resolvePolityKey(raw?.polityKey) || clean(raw?.polityKey);
      const factIds = (expectedFactsByKey.get(polityKey) ?? []).map((fact) => fact.id);
      const corrected = clean(raw?.verdict).toLocaleLowerCase() === "corrected";
      return {
        polityKey,
        verdict: corrected ? "challenge" : "clear",
        confidence: raw?.confidence,
        issue: corrected ? clean(raw?.issue) : "",
        checkedFactIds: factIds,
        challengedFactIds: corrected ? factIds : [],
      };
    });
  }
  if (!Array.isArray(rawChecks)) rawChecks = [];

  const counts = new Map();
  for (const raw of rawChecks) {
    const polityKey = resolvePolityKey(raw?.polityKey);
    if (byKey.has(polityKey)) counts.set(polityKey, (counts.get(polityKey) ?? 0) + 1);
  }

  const clearPolities = new Set();
  const challenges = new Map();
  const diagnostics = [];
  const warnings = [];
  const seen = new Set();

  const challenge = (polityKey, diagnostic, issue, { established = false } = {}) => {
    diagnostic.verdict = "challenge";
    diagnostic.status = "challenge";
    diagnostic.issue = clean(issue) || "Temporal sentinel could not safely clear this polity.";
    diagnostic.temporalCorrectionEstablished = established === true;
    challenges.set(polityKey, diagnostic);
  };

  for (const raw of rawChecks) {
    const rawPolityKey = clean(raw?.polityKey);
    const polityKey = resolvePolityKey(rawPolityKey);
    if (!byKey.has(polityKey)) {
      warnings.push(`Ignored unrequested temporal sentinel result for ${rawPolityKey || "<blank>"}`);
      continue;
    }
    if (seen.has(polityKey)) continue;
    seen.add(polityKey);
    const expectedFacts = expectedFactsByKey.get(polityKey) ?? [];
    const expectedIds = expectedFacts.map((fact) => fact.id);
    const expectedIdSet = new Set(expectedIds);
    const factById = new Map(expectedFacts.map((fact) => [fact.id, fact]));
    const checkedFactIds = [...new Set((Array.isArray(raw?.checkedFactIds) ? raw.checkedFactIds : []).map(clean).filter(Boolean))];
    const challengedFactIds = [...new Set((Array.isArray(raw?.challengedFactIds) ? raw.challengedFactIds : []).map(clean).filter(Boolean))];
    const challengedFacts = challengedFactIds.map((id) => factById.get(id)).filter(Boolean).map(clone);
    const invalidChecked = checkedFactIds.filter((id) => !expectedIdSet.has(id));
    const invalidChallenged = challengedFactIds.filter((id) => !expectedIdSet.has(id));
    const missingFactIds = expectedIds.filter((id) => !checkedFactIds.includes(id));
    const diagnostic = {
      polityKey,
      verdict: clean(raw?.verdict).toLocaleLowerCase(),
      confidence: normalizeConfidence(raw?.confidence),
      issue: clean(raw?.issue),
      checkedFactIds,
      challengedFactIds,
      challengedFacts,
      missingFactIds,
      temporalCorrectionEstablished: false,
      status: "failed",
      errors: [],
    };

    if ((counts.get(polityKey) ?? 0) > 1) diagnostic.errors.push("Temporal sentinel returned duplicate entries for this polity");
    if (invalidChecked.length) diagnostic.errors.push(`Temporal sentinel returned unknown checked FACT ids: ${invalidChecked.join(", ")}`);
    if (invalidChallenged.length) diagnostic.errors.push(`Temporal sentinel returned unknown challenged FACT ids: ${invalidChallenged.join(", ")}`);
    if (missingFactIds.length) diagnostic.errors.push(`Temporal sentinel did not individually attest every supplied FACT id; missing: ${missingFactIds.join(", ")}`);

    if (diagnostic.errors.length) {
      challenge(polityKey, diagnostic, `${diagnostic.errors.join("; ")} Focused exact-date adjudication is required.`);
      diagnostics.push(diagnostic);
      continue;
    }

    if (diagnostic.verdict === "clear") {
      if (diagnostic.issue && !benignTemporalClearIssue(diagnostic.issue)) diagnostic.errors.push("Temporal sentinel returned a substantive/ambiguous issue for a clear verdict");
      if (challengedFactIds.length) diagnostic.errors.push("Temporal sentinel returned challenged FACT ids for a clear verdict");
      if (diagnostic.errors.length) {
        challenge(polityKey, diagnostic, `${diagnostic.errors.join("; ")} Focused exact-date adjudication is required.`);
      } else {
        diagnostic.status = "clear";
        if (diagnostic.issue) diagnostic.issue = "";
        clearPolities.add(polityKey);
      }
      diagnostics.push(diagnostic);
      continue;
    }

    if (diagnostic.verdict === "challenge") {
      if (!diagnostic.issue) diagnostic.errors.push("Temporal sentinel challenged this polity without a concrete issue");
      if (!challengedFactIds.length) diagnostic.errors.push("Temporal sentinel challenged this polity without identifying challenged FACT ids");
      challenge(polityKey, diagnostic, diagnostic.issue || diagnostic.errors.join("; "), {
        established: !clearlyNonTemporalVerificationIssue(diagnostic.issue),
      });
      diagnostics.push(diagnostic);
      continue;
    }

    diagnostic.errors.push(`Temporal sentinel verdict must be clear or challenge, got ${JSON.stringify(diagnostic.verdict)}`);
    challenge(polityKey, diagnostic, `${diagnostic.errors.join("; ")} Focused exact-date adjudication is required.`);
    diagnostics.push(diagnostic);
  }

  for (const [polityKey, entry] of byKey) {
    if (seen.has(polityKey)) continue;
    const expectedIds = (expectedFactsByKey.get(polityKey) ?? []).map((fact) => fact.id);
    const diagnostic = {
      polityKey,
      verdict: "challenge",
      confidence: "unknown",
      issue: "Temporal sentinel omitted this requested polity; focused exact-date adjudication is required.",
      checkedFactIds: [],
      challengedFactIds: [],
      challengedFacts: [],
      missingFactIds: expectedIds,
      temporalCorrectionEstablished: false,
      status: "challenge",
      errors: ["Temporal sentinel omitted this requested polity"],
    };
    challenges.set(polityKey, diagnostic);
    diagnostics.push(diagnostic);
  }

  return { clearPolities, challenges, diagnostics, warnings };
};

const runTemporalIdentitySentinel = async ({
  entries,
  scenarioDate,
  historyAuthority = null,
  scenarioContext,
  contextByPolity,
  callModel,
  signal,
  onBatch,
} = {}) => {
  const requested = Array.isArray(entries) ? entries : [];
  const chunks = [];
  for (let index = 0; index < requested.length; index += POLITICAL_WORLD_TEMPORAL_SENTINEL_BATCH_SIZE) {
    chunks.push(requested.slice(index, index + POLITICAL_WORLD_TEMPORAL_SENTINEL_BATCH_SIZE));
  }
  const clearPolities = new Set();
  const challenges = new Map();
  const diagnostics = [];
  const warnings = [];
  const batches = [];

  for (const [batchIndex, batchEntries] of chunks.entries()) {
    if (signal?.aborted) throw signal.reason || new DOMException("Political world temporal sentinel cancelled.", "AbortError");
    const { systemPrompt, userMessage } = buildPoliticalWorldTemporalSentinelPrompt({
      scenarioDate,
      historyAuthority,
      entries: batchEntries,
      scenarioContext,
      contextByPolity,
    });
    const response = await callModel(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
      signal,
      reasoningEnabled: false,
      taskKey: "politicalWorldVerification",
      logLabel: "political world exact-date temporal red-team sentinel",
      tool: POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL,
    });
    const payload = parseResponseObject(response);
    const checked = validateTemporalSentinelPayload({ payload, entries: batchEntries });
    for (const polityKey of checked.clearPolities) clearPolities.add(polityKey);
    for (const [polityKey, finding] of checked.challenges) challenges.set(polityKey, finding);
    warnings.push(...checked.warnings);
    diagnostics.push({
      pass: "temporal-sentinel",
      batchIndex,
      attempt: 1,
      requested: batchEntries.map((entry) => entry.item.polityKey),
      providerResponse: typeof response === "string" ? truncate(response, 40000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
      parsedPayload: payload ? clone(payload) : null,
      warnings: [...checked.warnings],
      polities: clone(checked.diagnostics),
    });
    batches.push({
      pass: "temporal-sentinel",
      batchIndex,
      requested: batchEntries.map((entry) => entry.item.polityKey),
      attempts: 1,
      confirmed: batchEntries.filter((entry) => clearPolities.has(entry.item.polityKey)).map((entry) => entry.item.polityKey),
      corrected: [],
      failed: batchEntries.filter((entry) => challenges.has(entry.item.polityKey)).map((entry) => entry.item.polityKey),
    });
    if (typeof onBatch === "function") {
      const sampleChallengeEntry = batchEntries.find((entry) => challenges.has(entry.item.polityKey));
      const sampleChallenge = sampleChallengeEntry ? challenges.get(sampleChallengeEntry.item.polityKey) : null;
      onBatch({
        phase: "historical-verification",
        verificationPass: "temporal-sentinel",
        batchIndex,
        totalBatches: chunks.length,
        attempt: 1,
        maxAttempts: 1,
        accepted: [],
        unresolved: batchEntries.filter((entry) => challenges.has(entry.item.polityKey)).map((entry) => entry.item.polityKey),
        resolvedPolities: clearPolities.size + challenges.size,
        totalPolities: requested.length,
        acceptedTotal: clearPolities.size,
        failedTotal: challenges.size,
        verifiedTotal: clearPolities.size,
        correctedTotal: 0,
        sampleError: sampleChallengeEntry ? {
          polityKey: sampleChallengeEntry.item.polityKey,
          errors: [clean(sampleChallenge?.issue) || "Temporal sentinel challenged this polity."],
        } : null,
      });
    }
  }

  return {
    clearPolities,
    challenges,
    warnings: [...new Set(warnings)],
    diagnostics,
    batches,
  };
};

const preservePriorCorrectionMetadata = (previousEntry, recheckedEntry) => {
  if (previousEntry?.historicalVerification?.verdict !== "corrected") return recheckedEntry;
  if (recheckedEntry?.historicalVerification?.verdict !== "confirmed") return recheckedEntry;
  return {
    ...recheckedEntry,
    historicalVerification: clone(previousEntry.historicalVerification),
  };
};

const historicalPassEntryByPolity = (passResult) => new Map(
  (Array.isArray(passResult?.entries) ? passResult.entries : [])
    .map((entry) => [clean(entry?.item?.polityKey), entry])
    .filter(([polityKey]) => Boolean(polityKey)),
);

const historicalPassFailureByPolity = (passResult) => new Map(
  (Array.isArray(passResult?.failures) ? passResult.failures : [])
    .map((failure) => [clean(failure?.polityKey), failure])
    .filter(([polityKey]) => Boolean(polityKey)),
);

const temporalFindingsForPolity = (passResult, polityKey) => {
  const out = [];
  for (const batch of Array.isArray(passResult?.diagnostics) ? passResult.diagnostics : []) {
    for (const diagnostic of Array.isArray(batch?.polities) ? batch.polities : []) {
      if (clean(diagnostic?.polityKey) !== polityKey) continue;
      if (diagnostic?.temporalCorrectionEstablished !== true) continue;
      const issue = clean(diagnostic?.issue);
      if (issue && !out.includes(issue)) out.push(issue);
    }
  }
  return out;
};

const consensusOutcomeSummary = (label, passResult, polityKey) => {
  const entry = historicalPassEntryByPolity(passResult).get(polityKey);
  const failure = historicalPassFailureByPolity(passResult).get(polityKey);
  const temporalIssues = temporalFindingsForPolity(passResult, polityKey);
  const lines = [`${label}:`];
  if (entry?.historicalVerification?.verdict) {
    lines.push(`verdict=${entry.historicalVerification.verdict}; confidence=${entry.historicalVerification.confidence ?? "unknown"}; issue=${JSON.stringify(clean(entry.historicalVerification.issue))}`);
    if (entry.historicalVerification.verdict === "corrected") {
      lines.push(`suggested corrected identity=${truncate(historicalVerificationIdentity(entry.proposal?.actorPatch), 4500)}`);
    }
  } else if (failure) {
    lines.push(`failed=${JSON.stringify(failure.errors ?? [])}`);
  } else {
    lines.push("no valid final verdict");
  }
  if (temporalIssues.length) lines.push(`temporal finding(s)=${JSON.stringify(temporalIssues)}`);
  return lines.join(" ");
};

const temporalSentinelOutcomeSummary = (sentinel, polityKey) => {
  if (sentinel?.clearPolities instanceof Set && sentinel.clearPolities.has(polityKey)) return "TEMPORAL SENTINEL: verdict=clear";
  const finding = sentinel?.challenges instanceof Map ? sentinel.challenges.get(polityKey) : null;
  if (!finding) return "TEMPORAL SENTINEL: no valid result";
  const challengedFacts = Array.isArray(finding.challengedFacts)
    ? finding.challengedFacts.map((fact) => `${fact.id}[${fact.path}]=${fact.display}`).slice(0, 12)
    : [];
  return `TEMPORAL SENTINEL: verdict=challenge; confidence=${finding.confidence ?? "unknown"}; issue=${JSON.stringify(clean(finding.issue))}; challengedFacts=${JSON.stringify(challengedFacts)}`;
};

const consensusAdjudicationContextByPolity = ({ entries = [], passA, sentinel, scenarioDate = "" } = {}) => Object.fromEntries(
  (Array.isArray(entries) ? entries : []).map((entry) => {
    const polityKey = clean(entry?.item?.polityKey);
    const message = `CONSENSUS ADJUDICATION REQUIRED for ${polityKey} on ${scenarioDate}. The correction-capable verifier and the independent temporal red-team sentinel did not jointly clear the resulting candidate. `
      + `Review the ORIGINAL generated candidate independently. PASS A may contain a validated proposed correction; the temporal sentinel may identify a separate exact-date contradiction. `
      + `If either summary identifies a concrete date contradiction, resolve it with a valid scoped correction; do not erase it by merely confirming unchanged state.\n`
      + `${consensusOutcomeSummary("PASS A", passA, polityKey)}\n`
      + `${temporalSentinelOutcomeSummary(sentinel, polityKey)}`;
    return [polityKey, message];
  }).filter(([polityKey]) => Boolean(polityKey)),
);

const passHasStickyTemporalFinding = (passResult, polityKey) => {
  const entry = historicalPassEntryByPolity(passResult).get(polityKey);
  if (entry?.historicalVerification?.verdict === "corrected") return true;
  return temporalFindingsForPolity(passResult, polityKey).length > 0;
};

const runHistoricalIdentityVerification = async ({
  entries,
  scenarioDate,
  historyAuthority = null,
  politicalActors,
  scenarioContext,
  contextByPolity,
  allowEntityExpansionByPolity,
  callModel,
  signal,
  onBatch,
  reusePriorHistoricalVerification = false,
} = {}) => {
  const requestedEntries = Array.isArray(entries) ? entries : [];

  // Pass A owns corrections. During History-only recheck we reuse its already
  // persisted verdict/correction and only call Pass A for candidates that have
  // never received a valid historical decision. This prevents a recheck from
  // replaying ~50 expensive correction-capable batches unnecessarily.
  let passA;
  const reusedPriorHistoricalVerificationKeys = new Set();
  if (reusePriorHistoricalVerification) {
    const priorEntries = requestedEntries.filter((entry) => ["confirmed", "corrected"].includes(entry?.historicalVerification?.verdict));
    for (const entry of priorEntries) {
      const polityKey = clean(entry?.item?.polityKey);
      if (polityKey) reusedPriorHistoricalVerificationKeys.add(polityKey);
    }
    const unverifiedEntries = requestedEntries.filter((entry) => !["confirmed", "corrected"].includes(entry?.historicalVerification?.verdict));
    const freshPass = unverifiedEntries.length
      ? await runHistoricalIdentityVerificationPass({
        entries: unverifiedEntries,
        scenarioDate,
        historyAuthority,
        politicalActors,
        scenarioContext,
        contextByPolity,
        allowEntityExpansionByPolity,
        callModel,
        signal,
        onBatch,
        pass: "consensus-a",
      })
      : { entries: [], failures: [], warnings: [], diagnostics: [], batches: [], confirmed: 0, corrected: 0 };
    passA = {
      entries: [...priorEntries, ...freshPass.entries],
      failures: [...freshPass.failures],
      warnings: [...freshPass.warnings],
      diagnostics: [...freshPass.diagnostics],
      batches: [...freshPass.batches],
      confirmed: priorEntries.filter((entry) => entry.historicalVerification?.verdict === "confirmed").length + (freshPass.confirmed ?? 0),
      corrected: priorEntries.filter((entry) => entry.historicalVerification?.verdict === "corrected").length + (freshPass.corrected ?? 0),
    };
  } else {
    passA = await runHistoricalIdentityVerificationPass({
      entries: requestedEntries,
      scenarioDate,
      historyAuthority,
      politicalActors,
      scenarioContext,
      contextByPolity,
      allowEntityExpansionByPolity,
      callModel,
      signal,
      onBatch,
      pass: "consensus-a",
    });
  }

  const passAByKey = historicalPassEntryByPolity(passA);
  const passAFailures = historicalPassFailureByPolity(passA);

  // Pass B is intentionally a DIFFERENT task. It does not regenerate or correct
  // identity. It audits the resulting Pass-A candidate fact-by-fact for temporal
  // existence/tenure leakage. This removes the correlated "two generic verifiers
  // both say looks plausible" failure that allowed Korea's NPAD roster through.
  const sentinelEntries = requestedEntries.map((original) => passAByKey.get(clean(original?.item?.polityKey)) ?? original);
  const sentinel = await runTemporalIdentitySentinel({
    entries: sentinelEntries,
    scenarioDate,
    historyAuthority,
    scenarioContext,
    contextByPolity,
    callModel,
    signal,
    onBatch,
  });

  const agreedEntries = [];
  const disputedEntries = [];
  const stickyAdjudicationPolities = new Set();

  for (const original of requestedEntries) {
    const polityKey = clean(original?.item?.polityKey);
    if (!polityKey) continue;
    const a = passAByKey.get(polityKey);
    const passAFailed = passAFailures.has(polityKey);
    const sentinelClear = sentinel.clearPolities.has(polityKey);
    const sentinelFinding = sentinel.challenges.get(polityKey);

    if (!passAFailed && a && sentinelClear) {
      agreedEntries.push(a);
      continue;
    }

    disputedEntries.push(original);
    const freshPassATemporalFinding = !reusedPriorHistoricalVerificationKeys.has(polityKey)
      && passHasStickyTemporalFinding(passA, polityKey);
    if (freshPassATemporalFinding || sentinelFinding?.temporalCorrectionEstablished === true) {
      stickyAdjudicationPolities.add(polityKey);
    }
  }

  const adjudicated = disputedEntries.length
    ? await runHistoricalIdentityVerificationPass({
      entries: disputedEntries,
      scenarioDate,
      historyAuthority,
      politicalActors,
      scenarioContext,
      contextByPolity,
      allowEntityExpansionByPolity,
      callModel,
      signal,
      onBatch,
      reviewContextByPolity: consensusAdjudicationContextByPolity({ entries: disputedEntries, passA, sentinel, scenarioDate }),
      initialCorrectionRequiredPolities: stickyAdjudicationPolities,
      pass: "consensus-adjudication",
    })
    : { entries: [], failures: [], warnings: [], diagnostics: [], batches: [], confirmed: 0, corrected: 0 };

  const requestedEntryByKey = new Map(
    requestedEntries.map((entry) => [clean(entry?.item?.polityKey), entry]),
  );
  const consensusByKey = new Map(
    [...agreedEntries, ...adjudicated.entries].map((entry) => {
      const polityKey = clean(entry?.item?.polityKey);
      const prior = requestedEntryByKey.get(polityKey);
      const preserved = reusePriorHistoricalVerification && reusedPriorHistoricalVerificationKeys.has(polityKey)
        ? preservePriorCorrectionMetadata(prior, entry)
        : entry;
      return [polityKey, preserved];
    }),
  );
  let finalEntries = requestedEntries
    .map((entry) => consensusByKey.get(clean(entry?.item?.polityKey)))
    .filter(Boolean);
  const failures = [...adjudicated.failures];
  const warnings = [...new Set([
    ...(passA.warnings ?? []),
    ...(sentinel.warnings ?? []),
    ...(adjudicated.warnings ?? []),
  ])];
  const diagnostics = [
    ...(passA.diagnostics ?? []),
    ...(sentinel.diagnostics ?? []),
    ...(adjudicated.diagnostics ?? []),
  ];
  const batches = [
    ...(passA.batches ?? []),
    ...(sentinel.batches ?? []),
    ...(adjudicated.batches ?? []),
  ];
  const consensus = {
    enabled: true,
    strategy: "verifier-plus-temporal-sentinel",
    independentPasses: 2,
    passA: { confirmed: passA.confirmed ?? 0, corrected: passA.corrected ?? 0, failed: passA.failures?.length ?? 0 },
    // Keep the old passB summary shape for diagnostic/backward compatibility:
    // sentinel clear == confirmed; challenge/invalid == failed; it never corrects.
    passB: { confirmed: sentinel.clearPolities.size, corrected: 0, failed: sentinel.challenges.size },
    agreedConfirmed: agreedEntries.filter((entry) => entry.historicalVerification?.verdict === "confirmed").length,
    agreedCorrected: agreedEntries.filter((entry) => entry.historicalVerification?.verdict === "corrected").length,
    disputedPolities: disputedEntries.map((entry) => entry.item.polityKey),
    stickyAdjudicationPolities: [...stickyAdjudicationPolities],
    adjudicatedPolities: adjudicated.entries.map((entry) => entry.item.polityKey),
    failedPolities: adjudicated.failures.map((failure) => failure.polityKey),
    temporalSentinel: {
      batchSize: POLITICAL_WORLD_TEMPORAL_SENTINEL_BATCH_SIZE,
      batches: sentinel.batches.length,
      cleared: sentinel.clearPolities.size,
      challenged: sentinel.challenges.size,
    },
  };

  const initialCollisions = crossPolityOfficeholderCollisions(finalEntries);
  const collisionRechecks = {
    groups: initialCollisions.length,
    requestedPolities: [...new Set(initialCollisions.flatMap((collision) => collision.polityKeys))],
    resolvedPolities: [],
    failedPolities: [],
  };

  if (initialCollisions.length) {
    const collisionKeys = new Set(collisionRechecks.requestedPolities);
    const collisionEntries = finalEntries.filter((entry) => collisionKeys.has(entry.item.polityKey));
    const previousByKey = new Map(collisionEntries.map((entry) => [entry.item.polityKey, entry]));
    const rechecked = await runHistoricalIdentityVerificationPass({
      entries: collisionEntries,
      scenarioDate,
      historyAuthority,
      politicalActors,
      scenarioContext,
      contextByPolity,
      allowEntityExpansionByPolity,
      callModel,
      signal,
      onBatch,
      reviewContextByPolity: collisionReviewContextByPolity(initialCollisions, scenarioDate),
      pass: "collision-recheck",
    });

    warnings.push(...rechecked.warnings);
    diagnostics.push(...rechecked.diagnostics);
    batches.push(...rechecked.batches);
    failures.push(...rechecked.failures);

    const failedRecheckKeys = new Set(rechecked.failures.map((failure) => failure.polityKey));
    const recheckedByKey = new Map(rechecked.entries.map((entry) => [entry.item.polityKey, entry]));
    finalEntries = finalEntries
      .filter((entry) => !collisionKeys.has(entry.item.polityKey) || (!failedRecheckKeys.has(entry.item.polityKey) && recheckedByKey.has(entry.item.polityKey)))
      .map((entry) => {
        if (!collisionKeys.has(entry.item.polityKey)) return entry;
        const next = recheckedByKey.get(entry.item.polityKey);
        return next ? preservePriorCorrectionMetadata(previousByKey.get(entry.item.polityKey), next) : entry;
      });

    const unresolvedCollisions = crossPolityOfficeholderCollisions(finalEntries)
      .filter((collision) => collision.polityKeys.some((polityKey) => collisionKeys.has(polityKey)));
    const unresolvedKeys = new Set(unresolvedCollisions.flatMap((collision) => collision.polityKeys));
    if (unresolvedKeys.size) {
      finalEntries = finalEntries.filter((entry) => !unresolvedKeys.has(entry.item.polityKey));
      for (const polityKey of unresolvedKeys) {
        if (failures.some((failure) => failure.polityKey === polityKey)) continue;
        const source = previousByKey.get(polityKey);
        failures.push({
          polityKey,
          depth: source?.item?.depth,
          needs: [...(source?.item?.needs ?? [])],
          errors: ["Cross-polity officeholder collision remained after focused exact-date re-verification; failed closed rather than accepting ambiguous historical canon"],
        });
      }
      warnings.push(`Historical officeholder collision sentinel failed closed for: ${[...unresolvedKeys].join(", ")}`);
    }

    collisionRechecks.failedPolities = [...new Set([
      ...failedRecheckKeys,
      ...unresolvedKeys,
    ])];
    collisionRechecks.resolvedPolities = collisionRechecks.requestedPolities
      .filter((polityKey) => !collisionRechecks.failedPolities.includes(polityKey));
  }

  const confirmed = finalEntries.filter((entry) => entry.historicalVerification?.verdict === "confirmed").length;
  const corrected = finalEntries.filter((entry) => entry.historicalVerification?.verdict === "corrected").length;
  return {
    entries: finalEntries,
    failures,
    warnings: [...new Set(warnings)],
    diagnostics,
    batches,
    confirmed,
    corrected,
    consensus,
    collisionRechecks,
  };
};

const diagnosticRawProposal = (raw) => {
  if (!isPlainObject(raw)) return raw;
  const out = clone(raw);
  if (typeof out.actorPatchJson === "string" && out.actorPatchJson.length > 30000) {
    out.actorPatchJson = `${out.actorPatchJson.slice(0, 30000)}\n...[diagnostic actorPatchJson truncated]`;
  }
  return out;
};

const validateBatchResponse = (payload, items, context) => {
  const rawProposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const requestedByKey = new Map(items.map((item) => [item.polityKey, item]));
  const seen = new Set();
  const valid = [];
  const errorsByPolity = {};
  const warnings = [];
  const diagnostics = [];
  const counts = new Map();
  for (const raw of rawProposals) {
    const polityKey = clean(raw?.polityKey);
    if (requestedByKey.has(polityKey)) counts.set(polityKey, (counts.get(polityKey) ?? 0) + 1);
  }

  for (const raw of rawProposals) {
    const polityKey = clean(raw?.polityKey);
    if (!requestedByKey.has(polityKey)) {
      warnings.push(`Ignored unrequested generated polity ${polityKey || "<blank>"}`);
      diagnostics.push({ polityKey, status: "ignored", rawProposal: diagnosticRawProposal(raw), errors: ["Unrequested polity"] });
      continue;
    }
    const item = requestedByKey.get(polityKey);
    const diagnostic = {
      polityKey,
      depth: item.depth,
      needs: [...item.needs],
      rawProposal: diagnosticRawProposal(raw),
      parsedActorPatch: null,
      projectedActorPatch: null,
      droppedPaths: [],
      politicalSystemLock: null,
      errors: [],
      status: "failed",
    };
    if ((counts.get(polityKey) ?? 0) > 1) {
      seen.add(polityKey);
      errorsByPolity[polityKey] = ["AI returned duplicate proposals for this polity"];
      diagnostic.errors = [...errorsByPolity[polityKey]];
      diagnostics.push(diagnostic);
      continue;
    }
    seen.add(polityKey);
    const parsedActorPatch = parseActorPatchFromWireProposal(raw);
    diagnostic.parsedActorPatch = clone(parsedActorPatch);
    if (!isPlainObject(parsedActorPatch)) {
      errorsByPolity[polityKey] = ["AI proposal actorPatchJson did not contain a parseable JSON object"];
      diagnostic.errors = [...errorsByPolity[polityKey]];
      diagnostics.push(diagnostic);
      continue;
    }
    const { actorPatch: projectedActorPatch, droppedPaths } = projectActorPatchToRequestedScope(parsedActorPatch, item.needs);
    let actorPatch = clone(projectedActorPatch);
    const politicalSystemLock = context.politicalSystemLocks?.[polityKey];
    if (isRetryPoliticalSystemLock(politicalSystemLock) && item.needs.includes(POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM)) {
      const proposedSystem = isPlainObject(actorPatch?.politicalSystem) ? actorPatch.politicalSystem : {};
      const lockedType = clean(politicalSystemLock.type);
      const lockedRepresentation = GENERATED_REPRESENTATION_SET.has(clean(politicalSystemLock.representation).toLocaleLowerCase())
        ? clean(politicalSystemLock.representation).toLocaleLowerCase()
        : "";
      const mutatedLockedFields = [];
      if (lockedType && clean(proposedSystem.type) !== lockedType) mutatedLockedFields.push(`type=${lockedType}`);
      if (lockedRepresentation && clean(proposedSystem.representation).toLocaleLowerCase() !== lockedRepresentation) {
        mutatedLockedFields.push(`representation=${lockedRepresentation}`);
      }
      if (mutatedLockedFields.length) {
        warnings.push(`Ignored corrective retry politicalSystem mutation for ${polityKey}; kept locked ${mutatedLockedFields.join(", ")}`);
      }
      actorPatch.politicalSystem = {
        ...proposedSystem,
        ...(lockedType ? { type: lockedType } : {}),
        ...(lockedRepresentation ? { representation: lockedRepresentation } : {}),
      };
      diagnostic.politicalSystemLock = clone(politicalSystemLock);
    }
    const retryRoster = canonicalizeUnlockedRepresentationRetryRoster(actorPatch, item, politicalSystemLock);
    if (retryRoster.moved) {
      warnings.push(
        `Canonicalized corrective retry representation roster for ${polityKey}: moved ${retryRoster.moved.from} -> ${retryRoster.moved.to} to match representation=${retryRoster.moved.representation}`,
      );
    }
    if (item.needs.includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE)) {
      const completedLandscape = completeGeneratedPoliticalLandscapePatch(
        context.politicalActors?.byPolity?.[item.polityKey] ?? null,
        actorPatch,
        { allowEntityExpansion: context.allowEntityExpansionByPolity?.[item.polityKey] === true },
      );
      actorPatch = completedLandscape.patch;
      for (const warning of completedLandscape.warnings) warnings.push(`${polityKey}: ${warning}`);
    }
    diagnostic.projectedActorPatch = clone(actorPatch);
    diagnostic.droppedPaths = [...droppedPaths];
    const responseShapeErrors = validateGeneratedPoliticalResponseShapes(actorPatch);
    if (responseShapeErrors.length) {
      errorsByPolity[polityKey] = responseShapeErrors;
      diagnostic.errors = [...responseShapeErrors];
      diagnostics.push(diagnostic);
      continue;
    }
    const normalizedRaw = { ...raw, actorPatch };
    delete normalizedRaw.actorPatchJson;
    const envelope = wrapRawProposal(normalizedRaw, item, context);
    const validation = validatePoliticalGenerationProposal(envelope, {
      polityKey: item.polityKey,
      scenarioDate: context.scenarioDate,
      depth: item.depth,
      existingActor: context.politicalActors?.byPolity?.[item.polityKey] ?? null,
      allowEntityExpansion: context.allowEntityExpansionByPolity?.[item.polityKey] === true,
      historyAuthority: context.historyAuthority || null,
    });
    const errors = [...(validation.errors ?? [])];
    if (!errors.length) {
      const remainingNeeds = assessPoliticalGenerationNeeds(validation.actor, item.depth, {
        behaviorallyCompleteStandard: context.behaviorallyCompleteStandard === true,
        requireRepresentationCoverage: context.requireRepresentationCoverage === true,
      });
      for (const need of item.needs) {
        if (!remainingNeeds.includes(need)) continue;
        if (need === POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE) {
          errors.push("proposal did not satisfy requested need governing_structure: include government.form or a recognized current headOfState/headOfGovernment");
        } else if (need === POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT) {
          errors.push(item.depth === POLITICAL_GENERATION_DEPTHS.STANDARD
            ? "proposal did not satisfy requested need strategic_context: include government.ideology AND non-empty goals, fears, and ambitions (STANDARD v2 requires all three motive classes)"
            : "proposal did not satisfy requested need strategic_context: include government.ideology AND at least one goals/fears/ambitions entry");
        } else if (need === POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT) {
          errors.push("proposal did not satisfy requested need governing_entity_context: the current governing/dominant represented force needs ideology plus at least one goals/publicPriorities/publicForeignPolicy direction");
        } else if (need === POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES && context.requireRepresentationCoverage === true) {
          errors.push(`proposal did not satisfy requested need representation_entities: generated electoral rosters must materialize all governing/coalition forces plus enough individually meaningful named parties to cover at least ${POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN}% of estimated support; a large anonymous Other residual is not a political actor`);
        } else if (need === POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES) {
          errors.push("proposal did not satisfy requested need entity_response_profiles: every requested/generated party or power bloc must include a non-empty politicalResponse");
        } else {
          errors.push(`proposal did not satisfy requested need ${need}`);
        }
      }
    }
    if (errors.length) {
      errorsByPolity[polityKey] = errors;
      diagnostic.errors = [...errors];
      diagnostics.push(diagnostic);
      continue;
    }
    diagnostic.status = "accepted";
    diagnostic.errors = [];
    diagnostics.push(diagnostic);
    valid.push({ item, proposal: envelope, validation });
  }

  const droppedDiagnostics = diagnostics.filter((entry) => Array.isArray(entry?.droppedPaths) && entry.droppedPaths.length);
  if (droppedDiagnostics.length) {
    const uniqueDropped = [...new Set(droppedDiagnostics.flatMap((entry) => entry.droppedPaths))];
    warnings.push(`Dropped out-of-scope generated fields for ${droppedDiagnostics.length}/${items.length} requested polities; see per-polity diagnostics. Sample paths: ${uniqueDropped.slice(0, 12).join(", ")}`);
  }

  for (const item of items) {
    if (!seen.has(item.polityKey)) {
      errorsByPolity[item.polityKey] = ["AI omitted this requested polity from the batch response"];
      diagnostics.push({
        polityKey: item.polityKey,
        depth: item.depth,
        needs: [...item.needs],
        rawProposal: null,
        parsedActorPatch: null,
        projectedActorPatch: null,
        droppedPaths: [],
        politicalSystemLock: null,
        status: "failed",
        errors: [...errorsByPolity[item.polityKey]],
      });
    }
  }

  return { valid, errorsByPolity, warnings, diagnostics };
};


const isQuantitativeLandscapeOnlyItem = (item) => (
  Array.isArray(item?.needs)
  && item.needs.length === 1
  && item.needs[0] === POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE
);

const QUANTITATIVE_LANDSCAPE_FAST_BLOCKING_NEEDS = new Set([
  POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM,
  POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE,
  POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES,
]);

const prioritizedQuantitativeLandscapeFastItem = (item, enabled = false) => {
  if (isQuantitativeLandscapeOnlyItem(item)) return item;
  if (!enabled) return null;
  const needs = Array.isArray(item?.needs) ? item.needs : [];
  if (item?.hasExistingActor !== true || !needs.includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE)) return null;
  if (needs.some((need) => QUANTITATIVE_LANDSCAPE_FAST_BLOCKING_NEEDS.has(need))) return null;

  // Normal Scenario Editor generation can explicitly prioritize the missing
  // Round-Zero numeric baseline for already-canonical actors. Optional RICH/FULL
  // enrichment is deferred to a later run rather than inflating a migration into
  // dozens of heavyweight calls. Direct core callers and the fixed 15-polity
  // stress test keep the original all-needs behavior unless they opt in.
  return {
    ...item,
    needs: [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE],
    deferredNeeds: needs.filter((need) => need !== POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE),
  };
};

const chunkPoliticalWorldItems = (items, size) => {
  const out = [];
  const batchSize = Math.max(1, Math.trunc(Number(size)) || 1);
  for (let index = 0; index < items.length; index += batchSize) out.push(items.slice(index, index + batchSize));
  return out;
};

const quantitativeFastTarget = (actor) => {
  const representation = clean(actor?.politicalSystem?.representation).toLocaleLowerCase();
  if (representation === GENERATED_REPRESENTATIONS.ELECTORAL) {
    return { representation, collection: "parties", metric: "support", entities: Array.isArray(actor?.parties) ? actor.parties : [] };
  }
  if (representation === GENERATED_REPRESENTATIONS.PARTY_STATE) {
    const powerBlocs = Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : [];
    if (powerBlocs.length) return { representation, collection: "powerBlocs", metric: "influence", entities: powerBlocs };
    return { representation, collection: "parties", metric: "influence", entities: Array.isArray(actor?.parties) ? actor.parties : [] };
  }
  const powerBlocs = Array.isArray(actor?.powerBlocs) ? actor.powerBlocs : [];
  return { representation, collection: "powerBlocs", metric: "influence", entities: powerBlocs };
};

const compactOfficeholderName = (value) => clean(isPlainObject(value) ? value.name : value);

const landscapeFastPolityBlock = (item, { politicalActors, contextByPolity }) => {
  const actor = politicalActors?.byPolity?.[item.polityKey] ?? {};
  const target = quantitativeFastTarget(actor);
  const government = isPlainObject(actor?.government) ? actor.government : {};
  const rulingIds = new Set(Array.isArray(government.rulingPartyIds) ? government.rulingPartyIds.map(clean).filter(Boolean) : []);
  const coalitionIds = new Set(Array.isArray(government.coalitionPartyIds) ? government.coalitionPartyIds.map(clean).filter(Boolean) : []);
  const entities = target.entities.map((entity) => {
    const id = clean(entity?.id);
    const name = clean(entity?.name || entity?.shortName || id);
    const ideology = clean(entity?.ideology);
    const role = rulingIds.has(id) ? "ruling" : (coalitionIds.has(id) ? "coalition" : "represented");
    return `- ${id || "<missing-id>"} | ${name || "<unnamed>"} | ${role}${ideology ? ` | ${truncate(ideology, 120)}` : ""}`;
  });
  const governmentBits = [
    clean(government.form),
    compactOfficeholderName(government.headOfState) ? `HoS=${compactOfficeholderName(government.headOfState)}` : "",
    compactOfficeholderName(government.headOfGovernment) ? `HoG=${compactOfficeholderName(government.headOfGovernment)}` : "",
    rulingIds.size ? `ruling=${[...rulingIds].join(",")}` : "",
    coalitionIds.size ? `coalition=${[...coalitionIds].join(",")}` : "",
  ].filter(Boolean);
  const localContext = clean(contextByPolity?.[item.polityKey]);
  return [
    `POLITY: ${item.polityKey}`,
    `REPRESENTATION: ${target.representation || "unknown"}`,
    `METRIC: ${target.metric}`,
    `GOVERNMENT: ${governmentBits.join(" | ") || "(no compact government metadata)"}`,
    `EXISTING ROSTER IDS — estimate ONLY these ids:`,
    ...(entities.length ? entities : ["(none)"]),
    ...(localContext ? [`SCENARIO-SPECIFIC CONTEXT: ${truncate(localContext, 700)}`] : []),
  ].join("\n");
};

export const buildPoliticalWorldLandscapeFastPrompt = ({
  scenarioDate,
  historyAuthority = null,
  items = [],
  politicalActors = null,
  scenarioContext = "",
  contextByPolity = {},
} = {}) => {
  const systemPrompt = `You estimate ONLY the Round-Zero quantitative political landscape for already-existing Political Actors.\n\n`
    + `${historyAuthorityPromptBlock(historyAuthority, scenarioDate)}\n`
    + `This is a lightweight support/influence backfill, NOT political-world generation. Never regenerate or correct political identity.\n`
    + `Use only the supplied existing roster ids. Do not add, rename, remove, merge, or replace parties/power blocs. Do not return leaders, government fields, ideology, goals, traits, perceptions, or prose patches.\n`
    + `For representation=electoral, estimate approximate CURRENT political support percentages on the scenario date. For non-electoral/party-state structures, estimate approximate political influence/control percentages instead of fake voter polling.\n`
    + `Values are approximate starting baselines, not claimed exact polls. Use integer 0-100 values and avoid false precision. Named entities may sum below 100 when a plausible remainder belongs to Other/unrepresented support.\n`
    + `Respect scenario-authored/derived canon and the supplied reference-authority boundary. Never import post-boundary facts from an external/reference canon merely because they precede the target world date.\n`
    + `TOOL TRANSPORT: return exactly one landscape object per requested polity. landscapeJson is a JSON STRING whose object maps supplied stable entity ids directly to integer percentages, e.g. {"party-a":40,"party-b":30}. No markdown fences, comments, names as keys, or extra fields.`;
  const userMessage = [
    `SCENARIO DATE: ${scenarioDate}`,
    "",
    "GLOBAL SCENARIO CANON / BACKSTORY (authoritative when supplied):",
    scenarioContext ? truncate(scenarioContext, 4000) : "(none supplied)",
    "",
    "QUANTITATIVE LANDSCAPES TO ESTIMATE:",
    ...(Array.isArray(items) ? items : []).map((item, index) => `\n=== ${index + 1} ===\n${landscapeFastPolityBlock(item, { politicalActors, contextByPolity })}`),
  ].join("\n");
  return { systemPrompt, userMessage };
};

const parseLandscapeFastResponseObject = (response) => {
  if (isPlainObject(response?.toolInput)) return response.toolInput;
  if (isPlainObject(response) && Array.isArray(response.landscapes)) return response;
  return parseResponseObject(response);
};

const parseLandscapeFastEstimateMap = (value) => {
  let parsed = value;
  if (typeof parsed === "string") {
    const text = parsed
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    if (!text) return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const out = new Map();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!isPlainObject(entry)) continue;
      const id = clean(entry.id);
      const number = Number(entry.percent ?? entry.value ?? entry.support ?? entry.influence);
      if (!id || !Number.isFinite(number) || number < 0 || number > 100) continue;
      out.set(id, Math.round(number));
    }
    return out;
  }
  if (!isPlainObject(parsed)) return null;
  const source = isPlainObject(parsed.estimates) ? parsed.estimates : parsed;
  for (const [rawId, rawValue] of Object.entries(source)) {
    const id = clean(rawId);
    const number = Number(isPlainObject(rawValue) ? (rawValue.percent ?? rawValue.value) : rawValue);
    if (!id || !Number.isFinite(number) || number < 0 || number > 100) continue;
    out.set(id, Math.round(number));
  }
  return out;
};

const buildLandscapeFastSeedPatch = (actor, estimates) => {
  const target = quantitativeFastTarget(actor);
  const rows = [];
  for (const entity of target.entities) {
    const id = clean(entity?.id);
    if (!id || !estimates?.has(id)) continue;
    const percent = estimates.get(id);
    rows.push({
      id,
      [target.metric]: { percent, basis: "generated-estimate" },
    });
  }
  return rows.length ? { [target.collection]: rows } : {};
};

const finalizeLandscapeFastItem = (item, {
  politicalActors,
  scenarioDate,
  generatedAt,
  estimates,
  allowEntityExpansionByPolity,
} = {}) => {
  const existingActor = politicalActors?.byPolity?.[item.polityKey] ?? null;
  const seedPatch = buildLandscapeFastSeedPatch(existingActor, estimates);
  const completed = completeGeneratedPoliticalLandscapePatch(existingActor, seedPatch, {
    allowEntityExpansion: allowEntityExpansionByPolity?.[item.polityKey] === true,
  });
  const envelope = {
    schemaVersion: POLITICAL_WORLD_GENERATION_SCHEMA_VERSION,
    polityKey: item.polityKey,
    scenarioDate,
    depth: item.depth,
    provenance: {
      source: "generated",
      confidence: POLITICAL_GENERATION_CONFIDENCE.UNKNOWN,
      generatedAt,
    },
    actorPatch: completed.patch,
  };
  const validation = validatePoliticalGenerationProposal(envelope, {
    polityKey: item.polityKey,
    scenarioDate,
    depth: item.depth,
    existingActor,
    allowEntityExpansion: allowEntityExpansionByPolity?.[item.polityKey] === true,
  });
  const errors = [...(validation.errors ?? [])];
  if (!errors.length && assessPoliticalGenerationNeeds(validation.actor, item.depth).includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE)) {
    errors.push("native quantitative-landscape completion did not produce a complete baseline");
  }
  return {
    entry: errors.length ? null : { item, proposal: envelope, validation },
    errors,
    warnings: completed.warnings ?? [],
    usedNativeFallback: !(estimates instanceof Map) || estimates.size === 0 || (completed.warnings ?? []).some((warning) => /Filled .* missing .* estimate/i.test(warning)),
  };
};

export const generatePoliticalWorldProposalsCore = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  politicalActors = null,
  relevanceByPolity = {},
  scenarioContext = "",
  contextByPolity = {},
  allowEntityExpansionByPolity = {},
  maxBatchSize = 6,
  maxAttempts = 2,
  prioritizeQuantitativeLandscapeBackfill = false,
  verifyHistoricalIdentity = false,
  behaviorallyCompleteStandard = false,
  requireRepresentationCoverage = false,
  // v2 may deliberately perform one provider call per resumable work item.
  // Carry native validation feedback across those external attempts so a retry
  // is actually corrective instead of asking the model the same question again.
  retryErrorsByPolity = {},
  callModel,
  generatedAt = () => new Date().toISOString(),
  signal,
  onBatch,
} = {}) => {
  if (typeof callModel !== "function") throw new Error("Phase006B requires a callModel function");
  const plan = buildPoliticalGenerationPlan({
    polities,
    politicalActors,
    relevanceByPolity,
    scenarioDate,
    maxBatchSize,
    behaviorallyCompleteStandard,
    requireRepresentationCoverage,
  });
  const runTimestamp = generatedAtValue(generatedAt);
  const attemptsLimit = Math.max(1, Math.min(POLITICAL_WORLD_GENERATOR_MAX_ATTEMPTS, Math.trunc(Number(maxAttempts)) || 1));
  const accepted = [];
  const failures = [];
  const warnings = [];
  const batchResults = [];
  const diagnostics = [];

  const fastItems = plan.items
    .map((item) => prioritizedQuantitativeLandscapeFastItem(item, prioritizeQuantitativeLandscapeBackfill))
    .filter(Boolean);
  const fastKeys = new Set(fastItems.map((item) => item.polityKey));
  const regularItems = plan.items.filter((item) => !fastKeys.has(item.polityKey));
  const regularBatches = plan.batches
    .map((batch) => batch.filter((item) => !fastKeys.has(item.polityKey)))
    .filter((batch) => batch.length);
  const fastBatches = chunkPoliticalWorldItems(fastItems, POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE);
  const totalGenerationBatches = regularBatches.length + fastBatches.length;
  const fastNativeFallbackPolities = new Set();
  let fastModelCalls = 0;

  for (const [batchIndex, initialItems] of regularBatches.entries()) {
    let unresolved = [...initialItems];
    let previousErrors = Object.fromEntries(initialItems
      .map((item) => [item.polityKey, Array.isArray(retryErrorsByPolity?.[item.polityKey])
        ? retryErrorsByPolity[item.polityKey].map((error) => clean(error)).filter(Boolean).slice(0, 8)
        : []])
      .filter(([, errors]) => errors.length));
    const politicalSystemLocks = {};
    const acceptedKeys = new Set();
    let attempts = 0;

    while (unresolved.length && attempts < attemptsLimit) {
      if (signal?.aborted) throw signal.reason || new DOMException("Political world generation cancelled.", "AbortError");
      attempts += 1;
      const { systemPrompt, userMessage } = buildPoliticalWorldGenerationPrompt({
        scenarioDate: plan.scenarioDate,
        historyAuthority,
        items: unresolved,
        politicalActors,
        scenarioContext,
        contextByPolity,
        previousErrors,
        allowEntityExpansionByPolity,
        politicalSystemLocks,
        behaviorallyCompleteStandard,
        requireRepresentationCoverage,
      });
      const response = await callModel(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
        signal,
        reasoningEnabled: false,
        taskKey: "politicalWorldGeneration",
        logLabel: "political world generation",
        tool: POLITICAL_WORLD_GENERATION_TOOL,
      });
      const payload = parseResponseObject(response);
      if (!payload) {
        previousErrors = Object.fromEntries(unresolved.map((item) => [item.polityKey, ["AI response did not contain parseable structured output"]]));
        diagnostics.push({
          batchIndex,
          attempt: attempts,
          requested: unresolved.map((item) => ({ polityKey: item.polityKey, depth: item.depth, needs: [...item.needs] })),
          providerResponse: typeof response === "string" ? truncate(response, 40000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
          parsedPayload: null,
          warnings: [],
          polities: unresolved.map((item) => ({ polityKey: item.polityKey, status: "failed", errors: [...previousErrors[item.polityKey]] })),
        });
        continue;
      }
      const checked = validateBatchResponse(payload, unresolved, {
        scenarioDate: plan.scenarioDate,
        historyAuthority,
        politicalActors,
        generatedAt: runTimestamp,
        allowEntityExpansionByPolity,
        politicalSystemLocks,
        behaviorallyCompleteStandard,
        requireRepresentationCoverage,
      });
      warnings.push(...checked.warnings);
      diagnostics.push({
        batchIndex,
        attempt: attempts,
        requested: unresolved.map((item) => ({ polityKey: item.polityKey, depth: item.depth, needs: [...item.needs] })),
        providerResponse: typeof response === "string" ? truncate(response, 40000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
        parsedPayload: clone(payload),
        warnings: [...checked.warnings],
        polities: clone(checked.diagnostics),
      });
      for (const entry of checked.valid) {
        if (acceptedKeys.has(entry.item.polityKey)) continue;
        acceptedKeys.add(entry.item.polityKey);
        accepted.push(entry);
      }
      for (const diagnostic of checked.diagnostics) {
        const polityKey = clean(diagnostic?.polityKey);
        if (!polityKey || politicalSystemLocks[polityKey]) continue;
        const lock = retryPoliticalSystemLockFromDiagnostic(diagnostic);
        if (lock) politicalSystemLocks[polityKey] = lock;
      }
      previousErrors = checked.errorsByPolity;
      unresolved = unresolved.filter((item) => !acceptedKeys.has(item.polityKey));
      if (typeof onBatch === "function") {
        const completedBeforeBatch = regularBatches
          .slice(0, batchIndex)
          .reduce((sum, batch) => sum + batch.length, 0);
        const finalAttempt = attempts >= attemptsLimit;
        const resolvedPolities = completedBeforeBatch
          + acceptedKeys.size
          + (finalAttempt ? unresolved.length : 0);
        const firstRejected = unresolved.find((item) => (checked.errorsByPolity?.[item.polityKey] ?? []).length);
        onBatch({
          phase: "generation",
          batchIndex,
          totalBatches: totalGenerationBatches,
          attempt: attempts,
          maxAttempts: attemptsLimit,
          accepted: checked.valid.map((entry) => entry.item.polityKey),
          unresolved: unresolved.map((item) => item.polityKey),
          resolvedPolities,
          totalPolities: plan.items.length,
          acceptedTotal: accepted.length,
          failedTotal: failures.length + (finalAttempt ? unresolved.length : 0),
          sampleError: firstRejected ? {
            polityKey: firstRejected.polityKey,
            errors: [...(checked.errorsByPolity[firstRejected.polityKey] ?? [])].slice(0, 4),
          } : null,
        });
      }
    }

    for (const item of unresolved) {
      failures.push({
        polityKey: item.polityKey,
        depth: item.depth,
        needs: [...item.needs],
        errors: [...(previousErrors[item.polityKey] ?? ["Political generation did not produce a valid proposal"])],
      });
    }
    batchResults.push({
      phase: "generation",
      batchIndex,
      requested: initialItems.map((item) => item.polityKey),
      attempts,
      accepted: initialItems.filter((item) => acceptedKeys.has(item.polityKey)).map((item) => item.polityKey),
      failed: unresolved.map((item) => item.polityKey),
    });
  }

  const fastAttemptsLimit = Math.max(1, Math.min(
    POLITICAL_WORLD_LANDSCAPE_FAST_MAX_ATTEMPTS,
    attemptsLimit,
  ));
  for (const [fastBatchIndex, initialItems] of fastBatches.entries()) {
    const batchIndex = regularBatches.length + fastBatchIndex;
    let attempts = 0;
    let response = null;
    let payload = null;
    const transportDiagnostics = [];

    // Retry only a completely unusable transport. Once we have a landscapes
    // array, individual malformed/omitted polities are repaired natively below
    // rather than burning another request for the whole 48-polity batch.
    while (attempts < fastAttemptsLimit && !Array.isArray(payload?.landscapes)) {
      if (signal?.aborted) throw signal.reason || new DOMException("Political landscape backfill cancelled.", "AbortError");
      attempts += 1;
      const { systemPrompt, userMessage } = buildPoliticalWorldLandscapeFastPrompt({
        scenarioDate: plan.scenarioDate,
        historyAuthority,
        items: initialItems,
        politicalActors,
        scenarioContext,
        contextByPolity,
      });
      response = await callModel(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
        signal,
        reasoningEnabled: false,
        taskKey: "politicalWorldGeneration",
        logLabel: "political landscape backfill",
        tool: POLITICAL_WORLD_LANDSCAPE_FAST_TOOL,
      });
      fastModelCalls += 1;
      payload = parseLandscapeFastResponseObject(response);
      if (!Array.isArray(payload?.landscapes)) {
        transportDiagnostics.push(`Attempt ${attempts}: provider response did not contain a usable landscapes array`);
        if (typeof onBatch === "function" && attempts < fastAttemptsLimit) {
          const completedFastBeforeBatch = fastBatches.slice(0, fastBatchIndex).reduce((sum, batch) => sum + batch.length, 0);
          onBatch({
            phase: "generation",
            batchIndex,
            totalBatches: totalGenerationBatches,
            attempt: attempts,
            maxAttempts: fastAttemptsLimit,
            accepted: [],
            unresolved: initialItems.map((item) => item.polityKey),
            resolvedPolities: regularItems.length + completedFastBeforeBatch,
            totalPolities: plan.items.length,
            acceptedTotal: accepted.length,
            failedTotal: failures.length,
            sampleError: { polityKey: initialItems[0]?.polityKey ?? "", errors: [transportDiagnostics.at(-1)] },
          });
        }
      }
    }

    const resolver = buildRequestedPolityTransportResolver(initialItems.map((item) => ({ item })));
    const rowsByPolity = new Map();
    const duplicatePolities = new Set();
    const unrequestedRows = [];
    if (Array.isArray(payload?.landscapes)) {
      for (const rawRow of payload.landscapes) {
        const canonical = resolver(rawRow?.polityKey);
        if (!canonical) {
          unrequestedRows.push(clean(rawRow?.polityKey) || "<blank>");
          continue;
        }
        if (rowsByPolity.has(canonical)) {
          duplicatePolities.add(canonical);
          continue;
        }
        rowsByPolity.set(canonical, rawRow);
      }
    }

    const acceptedThisBatch = [];
    const failedThisBatch = [];
    const polityDiagnostics = [];
    let fallbackCount = 0;
    for (const item of initialItems) {
      const rawRow = duplicatePolities.has(item.polityKey) ? null : rowsByPolity.get(item.polityKey);
      const estimates = rawRow ? parseLandscapeFastEstimateMap(rawRow.landscapeJson) : null;
      const finalized = finalizeLandscapeFastItem(item, {
        politicalActors,
        scenarioDate: plan.scenarioDate,
        generatedAt: runTimestamp,
        estimates,
        allowEntityExpansionByPolity,
      });
      const malformedOrMissing = duplicatePolities.has(item.polityKey) || !rawRow || !(estimates instanceof Map) || estimates.size === 0;
      const usedFallback = malformedOrMissing || finalized.usedNativeFallback;
      if (usedFallback) {
        fallbackCount += 1;
        fastNativeFallbackPolities.add(item.polityKey);
      }
      if (finalized.entry) {
        accepted.push(finalized.entry);
        acceptedThisBatch.push(item.polityKey);
      } else {
        const failure = {
          polityKey: item.polityKey,
          depth: item.depth,
          needs: [...item.needs],
          errors: finalized.errors.length ? finalized.errors : ["Native quantitative-landscape completion failed"],
        };
        failures.push(failure);
        failedThisBatch.push(item.polityKey);
      }
      polityDiagnostics.push({
        polityKey: item.polityKey,
        status: finalized.entry ? "accepted" : "failed",
        source: usedFallback ? "native-fallback" : "provider-estimate",
        providerRow: rawRow ? clone(rawRow) : null,
        errors: [...finalized.errors],
        warnings: [...finalized.warnings],
      });
    }

    if (fallbackCount) {
      warnings.push(`Quantitative landscape fast path used native fallback for ${fallbackCount}/${initialItems.length} polities in batch ${fastBatchIndex + 1}`);
    }
    if (unrequestedRows.length) {
      warnings.push(`Quantitative landscape fast path ignored ${unrequestedRows.length} unrequested/ambiguous provider row(s) in batch ${fastBatchIndex + 1}`);
    }
    if (!Array.isArray(payload?.landscapes)) {
      warnings.push(`Quantitative landscape fast path exhausted ${attempts} transport attempt${attempts === 1 ? "" : "s"} for batch ${fastBatchIndex + 1}; used native fallback instead of retrying political identity generation`);
    }

    diagnostics.push({
      phase: "quantitative-landscape-fast",
      batchIndex,
      fastBatchIndex,
      attempt: attempts,
      requested: initialItems.map((item) => ({ polityKey: item.polityKey, depth: item.depth, needs: [...item.needs] })),
      providerResponse: typeof response === "string" ? truncate(response, 40000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
      parsedPayload: Array.isArray(payload?.landscapes) ? clone(payload) : null,
      warnings: [...transportDiagnostics],
      polities: polityDiagnostics,
    });
    batchResults.push({
      phase: "quantitative-landscape-fast",
      batchIndex,
      requested: initialItems.map((item) => item.polityKey),
      attempts,
      accepted: acceptedThisBatch,
      failed: failedThisBatch,
      nativeFallback: polityDiagnostics.filter((entry) => entry.source === "native-fallback").map((entry) => entry.polityKey),
    });

    if (typeof onBatch === "function") {
      const completedFast = fastBatches.slice(0, fastBatchIndex + 1).reduce((sum, batch) => sum + batch.length, 0);
      onBatch({
        phase: "generation",
        generationMode: "quantitative-landscape-fast",
        batchIndex,
        totalBatches: totalGenerationBatches,
        attempt: attempts || 1,
        maxAttempts: fastAttemptsLimit,
        accepted: acceptedThisBatch,
        unresolved: [],
        resolvedPolities: regularItems.length + completedFast,
        totalPolities: plan.items.length,
        acceptedTotal: accepted.length,
        failedTotal: failures.length,
        sampleError: failedThisBatch.length ? {
          polityKey: failedThisBatch[0],
          errors: failures.find((failure) => failure.polityKey === failedThisBatch[0])?.errors?.slice(0, 4) ?? [],
        } : null,
      });
    }
  }

  let finalAccepted = accepted;
  let finalFailures = failures;
  let historicalVerification = {
    enabled: false,
    skippedReason: "disabled",
    requested: 0,
    confirmed: 0,
    corrected: 0,
    failed: 0,
    batches: [],
    diagnostics: [],
    consensus: { enabled: false, independentPasses: 0, passA: { confirmed: 0, corrected: 0, failed: 0 }, passB: { confirmed: 0, corrected: 0, failed: 0 }, agreedConfirmed: 0, agreedCorrected: 0, disputedPolities: [], stickyAdjudicationPolities: [], adjudicatedPolities: [], failedPolities: [] },
    collisionRechecks: { groups: 0, requestedPolities: [], resolvedPolities: [], failedPolities: [] },
  };

  const verificationCandidates = accepted.filter(shouldHistoricallyVerifyEntry);
  if (verifyHistoricalIdentity && verificationCandidates.length && temporalAuthorityVerificationAllowed(plan.scenarioDate, runTimestamp, historyAuthority)) {
    const verified = await runHistoricalIdentityVerification({
      entries: verificationCandidates,
      scenarioDate: plan.scenarioDate,
      historyAuthority,
      politicalActors,
      scenarioContext,
      contextByPolity,
      allowEntityExpansionByPolity,
      callModel,
      signal,
      onBatch,
    });
    const verifiedByKey = new Map(verified.entries.map((entry) => [entry.item.polityKey, entry]));
    const failedKeys = new Set(verified.failures.map((failure) => failure.polityKey));
    finalAccepted = accepted
      .filter((entry) => !failedKeys.has(entry.item.polityKey))
      .map((entry) => verifiedByKey.get(entry.item.polityKey) ?? entry);
    finalFailures = [...failures, ...verified.failures];
    warnings.push(...verified.warnings);
    for (const entry of verified.entries) {
      if (entry.historicalVerification?.verdict === "corrected") {
        warnings.push(`Temporal authority verification corrected ${entry.item.polityKey}${entry.historicalVerification.issue ? `: ${entry.historicalVerification.issue}` : ""}`);
      }
    }
    historicalVerification = {
      enabled: true,
      skippedReason: "",
      requested: verificationCandidates.length,
      confirmed: verified.confirmed,
      corrected: verified.corrected,
      failed: verified.failures.length,
      batches: verified.batches,
      diagnostics: verified.diagnostics,
      consensus: verified.consensus,
      collisionRechecks: verified.collisionRechecks,
    };
  } else if (verifyHistoricalIdentity && !verificationCandidates.length) {
    historicalVerification = { ...historicalVerification, skippedReason: "no generated date-sensitive identity fields" };
  } else if (verifyHistoricalIdentity && !temporalAuthorityVerificationAllowed(plan.scenarioDate, runTimestamp, historyAuthority)) {
    historicalVerification = { ...historicalVerification, skippedReason: "future scenario date with inclusive reference authority; authored/future canon must not be snapped to external chronology" };
  }

  return {
    schemaVersion: POLITICAL_WORLD_GENERATOR_RESULT_VERSION,
    scenarioDate: plan.scenarioDate,
    generatedAt: runTimestamp,
    plan,
    proposals: finalAccepted,
    failures: finalFailures,
    warnings,
    batches: batchResults,
    diagnostics,
    historicalVerification,
    quantitativeLandscapeFastPath: {
      enabled: fastItems.length > 0,
      requested: fastItems.length,
      batchSize: POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE,
      batches: fastBatches.length,
      modelCalls: fastModelCalls,
      nativeFallbackPolities: [...fastNativeFallbackPolities],
      deferredEnrichmentNeedsByPolity: Object.fromEntries(
        fastItems
          .filter((item) => Array.isArray(item.deferredNeeds) && item.deferredNeeds.length)
          .map((item) => [item.polityKey, [...item.deferredNeeds]]),
      ),
    },
    generatedPolities: finalAccepted.length,
    failedPolities: finalFailures.length,
  };
};

export const reverifyPoliticalWorldProposalsCore = async ({
  result,
  scenarioDate,
  historyAuthority = null,
  politicalActors = null,
  scenarioContext = "",
  contextByPolity = {},
  allowEntityExpansionByPolity = {},
  callModel,
  generatedAt = () => new Date().toISOString(),
  signal,
  onBatch,
} = {}) => {
  if (typeof callModel !== "function") throw new Error("Political World historical re-check requires a callModel function");
  if (!isPlainObject(result) || !Array.isArray(result.proposals)) throw new Error("Historical re-check requires an existing Political World generation result");
  const startDate = clean(scenarioDate || result.scenarioDate);
  if (!startDate) throw new Error("Historical re-check requires the canonical scenario date");
  if (clean(result.scenarioDate) && clean(result.scenarioDate) !== startDate) {
    throw new Error(`Historical re-check scenario date mismatch: result=${clean(result.scenarioDate)} current=${startDate}`);
  }
  const runTimestamp = generatedAtValue(generatedAt);
  if (!temporalAuthorityVerificationAllowed(startDate, runTimestamp, historyAuthority)) {
    return {
      ...result,
      generatedAt: runTimestamp,
      historicalVerification: {
        enabled: false,
        recheckOnly: true,
        skippedReason: "future scenario date with inclusive reference authority; authored/future canon must not be snapped to external chronology",
        requested: 0,
        confirmed: 0,
        corrected: 0,
        failed: 0,
        batches: [],
        diagnostics: [],
        consensus: { enabled: false, independentPasses: 0, passA: { confirmed: 0, corrected: 0, failed: 0 }, passB: { confirmed: 0, corrected: 0, failed: 0 }, agreedConfirmed: 0, agreedCorrected: 0, disputedPolities: [], stickyAdjudicationPolities: [], adjudicatedPolities: [], failedPolities: [] },
        collisionRechecks: { groups: 0, requestedPolities: [], resolvedPolities: [], failedPolities: [] },
      },
    };
  }

  const candidates = result.proposals.filter(shouldHistoricallyVerifyEntry);
  if (!candidates.length) {
    return {
      ...result,
      generatedAt: runTimestamp,
      historicalVerification: {
        enabled: true,
        recheckOnly: true,
        skippedReason: "no generated date-sensitive identity fields",
        requested: 0,
        confirmed: 0,
        corrected: 0,
        failed: 0,
        batches: [],
        diagnostics: [],
        consensus: { enabled: false, independentPasses: 0, passA: { confirmed: 0, corrected: 0, failed: 0 }, passB: { confirmed: 0, corrected: 0, failed: 0 }, agreedConfirmed: 0, agreedCorrected: 0, disputedPolities: [], stickyAdjudicationPolities: [], adjudicatedPolities: [], failedPolities: [] },
        collisionRechecks: { groups: 0, requestedPolities: [], resolvedPolities: [], failedPolities: [] },
      },
    };
  }

  const verified = await runHistoricalIdentityVerification({
    entries: candidates,
    scenarioDate: startDate,
    historyAuthority,
    politicalActors,
    scenarioContext,
    contextByPolity,
    allowEntityExpansionByPolity,
    callModel,
    signal,
    onBatch,
    reusePriorHistoricalVerification: true,
  });
  const verifiedByKey = new Map(verified.entries.map((entry) => [entry.item.polityKey, entry]));
  const failedKeys = new Set(verified.failures.map((failure) => failure.polityKey));
  const candidateKeys = new Set(candidates.map((entry) => entry.item.polityKey));
  const proposals = result.proposals
    .filter((entry) => !failedKeys.has(entry.item.polityKey))
    .map((entry) => candidateKeys.has(entry.item.polityKey) ? (verifiedByKey.get(entry.item.polityKey) ?? entry) : entry);
  const priorFailures = Array.isArray(result.failures) ? result.failures.filter((failure) => !candidateKeys.has(clean(failure?.polityKey))) : [];
  const warnings = (Array.isArray(result.warnings) ? result.warnings : [])
    .filter((warning) => !clean(warning).startsWith("Temporal authority verification corrected "));
  warnings.push(...verified.warnings);
  for (const entry of verified.entries) {
    if (entry.historicalVerification?.verdict === "corrected") {
      warnings.push(`Temporal authority verification corrected ${entry.item.polityKey}${entry.historicalVerification.issue ? `: ${entry.historicalVerification.issue}` : ""}`);
    }
  }
  const failures = [...priorFailures, ...verified.failures];

  return {
    ...result,
    scenarioDate: startDate,
    generatedAt: runTimestamp,
    proposals,
    failures,
    warnings,
    historicalVerification: {
      enabled: true,
      recheckOnly: true,
      skippedReason: "",
      requested: candidates.length,
      confirmed: verified.confirmed,
      corrected: verified.corrected,
      failed: verified.failures.length,
      batches: verified.batches,
      diagnostics: verified.diagnostics,
      consensus: verified.consensus,
      collisionRechecks: verified.collisionRechecks,
    },
    generatedPolities: proposals.length,
    failedPolities: failures.length,
  };
};
