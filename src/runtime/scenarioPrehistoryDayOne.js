/*! Open Historia - editable Round-Zero Day-one facts. */
import { PREGAME_BOOTSTRAP_CONTRACT_VERSION, compilePregameBootstrapCandidate, validatePregameBootstrapCandidateShape } from "../Game/AI/pregameBootstrapCompiler.js";
import { AGREEMENT_TYPE_VALUES } from "../Game/AI/nativeDiplomaticDirector.js";
import { compareGameDates, parseGameDate } from "./gameDates.js";
import { normalizeScenarioPrehistory } from "./scenarioPrehistory.js";

export const AUTHORABLE_DAY_ONE_KINDS = Object.freeze(["relation", "agreement", "storyline"]);
export const DAY_ONE_AGREEMENT_TYPES = AGREEMENT_TYPE_VALUES;
export const MAX_SEMANTIC_DAY_ONE_FACTS = 32;
const clean = (value) => String(value ?? "").trim();
const list = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(list(values).map(clean).filter(Boolean).map((value) => value.toLowerCase()))];
const inRange = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const error = (index, problem) => ({ family: "canonicalUpdates", index, problem });
const factsOf = (record) => list(record?.updates?.canonicalUpdates);

export const newManualDayOneFact = (kind, draft) => {
  if (!AUTHORABLE_DAY_ONE_KINDS.includes(kind)) throw new Error("Unsupported Day-one fact: " + kind);
  if (factsOf(draft).length >= MAX_SEMANTIC_DAY_ONE_FACTS) throw new Error("At most 32 semantic Day-one facts are supported.");
  const refs = new Set(factsOf(draft).map((fact) => clean(fact?.ref)));
  let index = 1;
  while (refs.has("manual-f" + index)) index++;
  const common = { ref: "manual-f" + index, kind };
  if (kind === "relation") return { ...common, a: "", b: "", summary: "" };
  if (kind === "agreement") return { ...common, type: "alliance", title: "", parties: [], terms: "" };
  return { ...common, processKind: "crisis", status: "active", title: "", participants: [], state: "" };
};

export const insertManualDayOneFact = (draft, kind) => {
  const record = normalizeScenarioPrehistory(draft, { draft: true });
  if (!record) throw new Error("A Pre-history record is required.");
  const fact = newManualDayOneFact(kind, record);
  return { ...record, updates: { ...record.updates, canonicalUpdates: [...record.updates.canonicalUpdates, fact] } };
};

export const updateDayOneFact = (draft, family, index, patch) => {
  const record = normalizeScenarioPrehistory(draft, { draft: true });
  if (!record || !Array.isArray(record.updates?.[family]) || !Number.isInteger(index) || index < 0 || index >= record.updates[family].length) {
    throw new Error("Day-one fact no longer exists.");
  }
  return { ...record, updates: { ...record.updates,
    [family]: record.updates[family].map((fact, at) => {
      if (at !== index) return fact;
      const changed = { ...fact, ...patch };
      for (const [key, value] of Object.entries(patch)) if (value === undefined) delete changed[key];
      return changed;
    }) } };
};

export const changeManualAccessReciprocal = (draft, index, reciprocal) => {
  const record = normalizeScenarioPrehistory(draft, { draft: true });
  const fact = record?.updates?.canonicalUpdates?.[index];
  if (fact?.kind !== "agreement" || fact.type !== "military_access") {
    throw new Error("The selected fact is not a military-access agreement.");
  }
  const { parties: _parties, grantor: _grantor, grantee: _grantee,
    guarantor: _guarantor, beneficiary: _beneficiary, reciprocal: _reciprocal, ...rest } = fact;
  const roles = reciprocal ? { reciprocal: true, parties: [] } : { grantor: "", grantee: "" };
  const changed = { ...rest, ...roles };
  return { ...record, updates: { ...record.updates,
    canonicalUpdates: record.updates.canonicalUpdates.map((row, at) => at === index ? changed : row) } };
};

export const changeManualAgreementType = (draft, index, type) => {
  if (!DAY_ONE_AGREEMENT_TYPES.includes(type)) throw new Error("Unknown agreement type: " + type);
  const record = normalizeScenarioPrehistory(draft, { draft: true });
  const fact = record?.updates?.canonicalUpdates?.[index];
  if (fact?.kind !== "agreement") throw new Error("The selected fact is not an agreement.");
  // Replace, rather than merge, to remove mutually exclusive directional fields.
  const { parties: _parties, guarantor: _guarantor, beneficiary: _beneficiary,
    grantor: _grantor, grantee: _grantee, reciprocal: _reciprocal, ...rest } = fact;
  const roles = type === "guarantee" ? { guarantor: "", beneficiary: "" }
    : type === "military_access" ? { grantor: "", grantee: "" } : { parties: [] };
  const changed = { ...rest, type, ...roles };
  return { ...record, updates: { ...record.updates,
    canonicalUpdates: record.updates.canonicalUpdates.map((row, at) => at === index ? changed : row) } };
};

export const dayOneEditorProblems = (draft, { startDate = "", world = {}, verifyWorld = false } = {}) => {
  const facts = factsOf(draft);
  const errors = [];
  if (facts.length > MAX_SEMANTIC_DAY_ONE_FACTS) errors.push(error(-1, "At most 32 semantic Day-one facts are supported."));
  const refs = new Set();
  const requireNames = (values, min, label, index) => {
    if (!Array.isArray(values) || unique(values).length < min) errors.push(error(index, label + " must name at least " + min + " distinct polities."));
    if (list(values).length > 12 || list(values).some((value) => !clean(value))) errors.push(error(index, label + " may have at most 12 non-empty polities."));
  };
  facts.forEach((fact, index) => {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
      errors.push(error(index, "This Day-one fact must be a record."));
      return;
    }
    const ref = clean(fact.ref);
    if (!ref || refs.has(ref)) errors.push(error(index, "A unique internal fact reference is required."));
    refs.add(ref);
    if (fact.kind === "relation") {
      if (!clean(fact.a) || !clean(fact.b) || clean(fact.a).toLowerCase() === clean(fact.b).toLowerCase()) {
        errors.push(error(index, "Name two different countries in this relationship."));
      }
      if (!inRange(fact.score, -100, 100)) errors.push(error(index, "Relationship score must be a number from -100 to 100."));
    } else if (fact.kind === "agreement") {
      if (!clean(fact.title)) errors.push(error(index, "Give this agreement a title."));
      if (!DAY_ONE_AGREEMENT_TYPES.includes(fact.type)) errors.push(error(index, "Choose a recognized agreement type."));
      if (fact.type === "guarantee") {
        if (!clean(fact.guarantor) || !clean(fact.beneficiary) || clean(fact.guarantor).toLowerCase() === clean(fact.beneficiary).toLowerCase()) {
          errors.push(error(index, "Name different guarantor and beneficiary countries."));
        }
      } else if (fact.type === "military_access" && fact.reciprocal !== true) {
        if (!clean(fact.grantor) || !clean(fact.grantee) || clean(fact.grantor).toLowerCase() === clean(fact.grantee).toLowerCase()) {
          errors.push(error(index, "Name different access grantor and grantee countries."));
        }
      } else {
        requireNames(fact.parties, 2, "Agreement parties", index);
        if (fact.type === "military_access" && unique(fact.parties).length !== 2) errors.push(error(index, "Reciprocal military access needs exactly two countries."));
      }
    } else if (fact.kind === "storyline") {
      if (!clean(fact.title)) errors.push(error(index, "Give this storyline a title."));
      if (!clean(fact.processKind) || clean(fact.processKind).toLowerCase() === "war") errors.push(error(index, "Choose a non-war process kind."));
      if (!["active", "dormant"].includes(fact.status)) errors.push(error(index, "Choose active or dormant."));
      requireNames(fact.participants, 1, "Storyline participants", index);
      for (const field of ["pressure", "momentum"]) {
        if (!inRange(fact[field], 0, 100)) errors.push(error(index, "Storyline " + field + " must be a number from 0 to 100."));
      }
    }
    if (clean(fact.startedDate) && (!parseGameDate(fact.startedDate) ||
      (parseGameDate(startDate) && compareGameDates(fact.startedDate, startDate) >= 0))) {
      errors.push(error(index, "This fact must start before the scenario start date."));
    }
  });
  // Older generated records are edited in place. Check their editable inputs,
  // but do not reclassify them as semantic facts or delete native event links.
  for (const [index, relation] of list(draft?.updates?.relationUpdates).entries()) {
    const a = clean(relation?.a);
    const b = clean(relation?.b);
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) {
      errors.push({ family: "relationUpdates", index, problem: "A relationship needs two different countries." });
    }
    if (typeof relation?.score !== "number" || !Number.isFinite(relation.score)
      || relation.score < -100 || relation.score > 100) {
      errors.push({ family: "relationUpdates", index, problem: "Relationship score must be between -100 and 100." });
    }
  }
  for (const [index, agreement] of list(draft?.updates?.agreementUpdates).entries()) {
    if (clean(agreement?.op).toLowerCase() === "start") {
      if (!clean(agreement?.title)) {
        errors.push({ family: "agreementUpdates", index, problem: "A starting agreement needs a title." });
      }
      if (unique(agreement?.parties).length < 2) {
        errors.push({ family: "agreementUpdates", index, problem: "A starting agreement needs at least two countries." });
      }
    }
  }
  for (const [index, storyline] of list(draft?.updates?.storylineUpdates).entries()) {
    if (!clean(storyline?.title)) {
      errors.push({ family: "storylineUpdates", index, problem: "An ongoing storyline needs a title." });
    }
    if (!unique(storyline?.participants).length) {
      errors.push({ family: "storylineUpdates", index, problem: "An ongoing storyline needs at least one participant." });
    }
    for (const field of ["pressure", "momentum"]) {
      const value = storyline?.[field];
      if (value !== undefined && value !== null && value !== ""
        && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) {
        errors.push({ family: "storylineUpdates", index, problem: "Storyline " + field + " must be between 0 and 100." });
      }
    }
  }
  if (errors.length || !facts.length) return errors;
  const reportError = (text) => {
    const match = /^\$\.facts\[(\d+)\]/.exec(text);
    return [error(match ? Number(match[1]) : -1, text)];
  };
  const candidate = { contractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION, facts };
  const shapeError = validatePregameBootstrapCandidateShape(candidate);
  if (shapeError) return reportError(shapeError);
  if (!verifyWorld) return [];

  const activeEvents = list(draft?.events).filter((event) => clean(event?.ref)
    && parseGameDate(event?.date)
    && (!parseGameDate(startDate) || compareGameDates(event.date, startDate) < 0));
  const eventIdsByRef = new Map(activeEvents.map((event) => [clean(event.ref), clean(event.id)]));
  const warRefs = new Set(facts.filter((fact) => fact?.kind === "war").map((fact) => clean(fact.ref)));
  // A removed source event does not invalidate the fact it once supported:
  // game-start bootstrap drops the stale sourceEventRef as well.
  const candidateFacts = facts.map((fact) => {
    const cleaned = { ...fact };
    if (Array.isArray(cleaned.sourceEventRefs)) {
      cleaned.sourceEventRefs = cleaned.sourceEventRefs.filter((ref) => eventIdsByRef.has(clean(ref)));
    }
    if (cleaned.distinctFromWarRef && !warRefs.has(clean(cleaned.distinctFromWarRef))) delete cleaned.distinctFromWarRef;
    return cleaned;
  });
  const compiled = compilePregameBootstrapCandidate({
    candidate: { contractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION, facts: candidateFacts },
    world, startDate, eventIdsByRef,
  });
  return compiled.ok ? [] : reportError(compiled.error);
};
