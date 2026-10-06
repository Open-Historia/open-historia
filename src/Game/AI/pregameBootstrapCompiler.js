// Open Historia — Round-Zero semantic baseline compiler (CP2 foundation).
//
// This module is deliberately NOT wired into WBR1 generation yet. It defines the
// native contract that CP2.2 can cut over to after the identity/conservation
// behavior is proven in isolation.
//
// Model/candidate responsibility: semantic Day-One facts + candidate-local refs.
// Native responsibility: current polity identity, persistent ids, persisted
// ledger shapes, war mirrors, reference binding and conservation accounting.

import { normalizeWorldState } from "../../runtime/gameState.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { compareGameDates, parseGameDate } from "../../runtime/gameDates.js";
import {
  buildPregameWarBaselineRecord,
  mergePregameWarBaselineRecord,
  pregameWarBaselineCompatibilityError,
  resolvePregameWarBaselineMatch,
} from "./nativeWarLedger.js";
import {
  AGREEMENT_TYPE_VALUES,
  buildPregameAgreementBaselineRecord,
  buildPregamePuppetBaselineRecord,
  buildPregameRelationBaselineRecord,
  mergePregameAgreementBaselineRecord,
  mergePregamePuppetBaselineRecord,
  mergePregameRelationBaselineRecord,
  pregameAgreementBaselineCompatibilityError,
  pregameAgreementRoleKey,
  pregamePuppetBaselineCompatibilityError,
  pregameRelationBaselineCompatibilityError,
  relationPairKey,
  resolvePregameAgreementBaselineMatch,
  resolvePregamePuppetBaselineMatch,
  resolvePregameRelationBaselineMatch,
  validatePregamePuppetGraph,
} from "./nativeDiplomaticDirector.js";
import {
  buildPregameStorylineBaselineRecord,
  buildPregameWarStorylineMirrorRecord,
  mergePregameStorylineBaselineRecord,
  mergePregameStorylineBaselines,
  pregameStorylineBaselineCompatibilityError,
  resolvePregameStorylineBaselineMatch,
} from "./nativeWorldDirector.js";

export const PREGAME_BOOTSTRAP_CONTRACT_VERSION = 1;

const MAX_FACTS = 32;
const MAX_SOURCE_EVENT_REFS = 16;
const MAX_POLITIES_PER_SIDE = 12;
const MAX_AGREEMENT_PARTIES = 12;
const MAX_STORYLINE_PARTICIPANTS = 12;
const FACT_KINDS = new Set(["war", "relation", "agreement", "storyline", "puppet"]);
const AGREEMENT_TYPES = new Set(AGREEMENT_TYPE_VALUES);
const WAR_STATUSES = new Set(["active", "ceasefire"]);
const STORYLINE_STATUSES = new Set(["active", "dormant"]);
const PUPPET_KINDS = new Set(["protectorate", "satellite", "client"]);
const PUPPET_SECRECY = new Set(["open", "covert"]);

const COMMON_FACT_FIELDS = new Set(["ref", "kind", "sourceEventRefs"]);
const FACT_FIELDS = {
  war: new Set([...COMMON_FACT_FIELDS, "title", "status", "sideA", "sideB", "startedDate", "note", "assessment"]),
  relation: new Set([...COMMON_FACT_FIELDS, "a", "b", "score", "summary"]),
  agreement: new Set([...COMMON_FACT_FIELDS, "type", "title", "parties", "guarantor", "beneficiary", "grantor", "grantee", "reciprocal", "startedDate", "terms"]),
  storyline: new Set([...COMMON_FACT_FIELDS, "processKind", "status", "title", "participants", "startedDate", "pressure", "momentum", "state", "distinctFromWarRef"]),
  puppet: new Set([...COMMON_FACT_FIELDS, "overlord", "puppet", "puppetKind", "loyalty", "secrecy", "startedDate"]),
};
const WAR_ASSESSMENT_FIELDS = new Set(["pressure", "momentum", "state"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase();
const array = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => {
  const seen = new Set();
  const out = [];
  for (const raw of array(values)) {
    const value = clean(raw);
    const key = lower(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

// A fact's title as it is compared: the letters, marks and digits of every
// script. Folded to a-z0-9, a title in Cyrillic, Arabic or Chinese had no key
// at all, so a storyline among a war's participants was always "ambiguous
// with" that war, whatever either was called, and the whole Round-Zero answer
// was refused for it. The key also seeds the id a NEW record is given
// (allocatePregameCanonicalId); a record already in a save keeps the id it
// has, which is stored and never worked out again. ASCII titles are unchanged.
const titleKey = (value) => lower(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const listKey = (values) => unique(values).map(lower).sort().join("|");
const participantKey = listKey;
const sidePairKey = (sideA, sideB) => [listKey(sideA), listKey(sideB)].sort().join("<>");
const validDate = (value) => !clean(value) || parseGameDate(clean(value)) != null;
const inRange = (value, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

const stableHash = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const allocatePregameCanonicalId = (prefix, allocationKey, occupiedIds = new Set()) => {
  const base = `${clean(prefix)}-r0v${PREGAME_BOOTSTRAP_CONTRACT_VERSION}-${stableHash(allocationKey)}`;
  if (!occupiedIds.has(base)) return base;
  // Never assume equal hashes imply equal semantic identity. Matching is done
  // before allocation; an occupied hash slot is therefore a collision and gets
  // a deterministic suffix rather than overwriting or reusing unrelated canon.
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!occupiedIds.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a collision-free Round-Zero id for ${prefix}.`);
};

const factError = (index, message) => `$.facts[${index}] ${message}`;

const validateRefList = (value, path) => {
  if (value === undefined) return "";
  if (!Array.isArray(value)) return `${path} must be an array of candidate-local event refs.`;
  if (value.length > MAX_SOURCE_EVENT_REFS) return `${path} may contain at most ${MAX_SOURCE_EVENT_REFS} refs.`;
  const refs = value.map(clean);
  if (refs.some((ref) => !ref)) return `${path} may not contain blank refs.`;
  if (new Set(refs).size !== refs.length) return `${path} must contain distinct refs.`;
  return "";
};

export const validatePregameBootstrapCandidateShape = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return "Round-Zero semantic bootstrap candidate must be an object.";
  }
  if (Number(candidate.contractVersion) !== PREGAME_BOOTSTRAP_CONTRACT_VERSION) {
    return `$.contractVersion must equal ${PREGAME_BOOTSTRAP_CONTRACT_VERSION}.`;
  }
  if (!Array.isArray(candidate.facts)) return "$.facts must be an array.";
  if (candidate.facts.length > MAX_FACTS) return `$.facts may contain at most ${MAX_FACTS} baseline facts.`;

  const refs = new Set();
  for (let index = 0; index < candidate.facts.length; index += 1) {
    const fact = candidate.facts[index];
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) return factError(index, "must be an object.");
    const ref = clean(fact.ref);
    const kind = lower(fact.kind);
    if (!ref) return factError(index, "requires a non-blank candidate-local ref.");
    if (refs.has(ref)) return factError(index, `duplicates candidate-local ref ${ref}.`);
    refs.add(ref);
    if (!FACT_KINDS.has(kind)) return factError(index, `has unsupported kind ${kind || "<blank>"}.`);
    const allowedFields = FACT_FIELDS[kind];
    const unknownFields = Object.keys(fact).filter((key) => !allowedFields.has(key));
    if (unknownFields.length) {
      return factError(index, `contains unsupported field(s): ${unknownFields.join(", ")}. Persistent ids, lifecycle verbs and engine bookkeeping are native-owned.`);
    }
    const refsError = validateRefList(fact.sourceEventRefs, `$.facts[${index}].sourceEventRefs`);
    if (refsError) return refsError;

    if (kind === "war") {
      if (!clean(fact.title)) return factError(index, "war requires title.");
      if (!WAR_STATUSES.has(lower(fact.status))) return factError(index, "war status must be active or ceasefire.");
      if (!Array.isArray(fact.sideA) || !Array.isArray(fact.sideB)) return factError(index, "war requires sideA and sideB arrays.");
      if (unique(fact.sideA).length > MAX_POLITIES_PER_SIDE || unique(fact.sideB).length > MAX_POLITIES_PER_SIDE) {
        return factError(index, `war sides may contain at most ${MAX_POLITIES_PER_SIDE} distinct polities each.`);
      }
      if (unique([...fact.sideA, ...fact.sideB]).length > MAX_STORYLINE_PARTICIPANTS) {
        return factError(index, `war may contain at most ${MAX_STORYLINE_PARTICIPANTS} total belligerents because its canonical scheduler mirror must preserve every participant.`);
      }
      if (!validDate(fact.startedDate)) return factError(index, "war startedDate must be a valid game date or blank.");
      if (fact.assessment !== undefined) {
        if (!fact.assessment || typeof fact.assessment !== "object" || Array.isArray(fact.assessment)) return factError(index, "war assessment must be an object.");
        const unknownAssessmentFields = Object.keys(fact.assessment).filter((key) => !WAR_ASSESSMENT_FIELDS.has(key));
        if (unknownAssessmentFields.length) return factError(index, `war assessment contains unsupported field(s): ${unknownAssessmentFields.join(", ")}.`);
        for (const field of ["pressure", "momentum"]) {
          if (fact.assessment[field] !== undefined && !inRange(fact.assessment[field], 0, 100)) {
            return factError(index, `war assessment.${field} must be between 0 and 100 when supplied.`);
          }
        }
      }
      continue;
    }

    if (kind === "relation") {
      if (!clean(fact.a) || !clean(fact.b)) return factError(index, "relation requires a and b.");
      if (!inRange(fact.score, -100, 100)) return factError(index, "relation score must be between -100 and 100.");
      continue;
    }

    if (kind === "agreement") {
      const type = lower(fact.type).replace(/[ -]+/g, "_");
      if (!AGREEMENT_TYPES.has(type)) return factError(index, `agreement has unsupported type ${type || "<blank>"}.`);
      if (!clean(fact.title)) return factError(index, "agreement requires title.");
      if (!validDate(fact.startedDate)) return factError(index, "agreement startedDate must be a valid game date or blank.");
      if (type === "guarantee") {
        if (!clean(fact.guarantor) || !clean(fact.beneficiary)) return factError(index, "guarantee requires explicit guarantor and beneficiary roles.");
        if (fact.parties !== undefined || fact.grantor !== undefined || fact.grantee !== undefined || fact.reciprocal !== undefined) {
          return factError(index, "guarantee must use directional guarantor/beneficiary roles only.");
        }
      } else if (type === "military_access") {
        const reciprocal = fact.reciprocal === true;
        if (reciprocal) {
          if (!Array.isArray(fact.parties) || unique(fact.parties).length !== 2) return factError(index, "reciprocal military access requires exactly two parties.");
          if (fact.grantor !== undefined || fact.grantee !== undefined || fact.guarantor !== undefined || fact.beneficiary !== undefined) {
            return factError(index, "reciprocal military access must use parties, not directional roles.");
          }
        } else {
          if (!clean(fact.grantor) || !clean(fact.grantee)) return factError(index, "directional military access requires explicit grantor and grantee roles, or reciprocal=true.");
          if (fact.parties !== undefined || fact.guarantor !== undefined || fact.beneficiary !== undefined) return factError(index, "directional military access must use grantor/grantee roles, not parties.");
        }
      } else {
        if (fact.guarantor !== undefined || fact.beneficiary !== undefined || fact.grantor !== undefined || fact.grantee !== undefined || fact.reciprocal !== undefined) {
          return factError(index, "this agreement type may not supply directional access/guarantee roles.");
        }
        if (!Array.isArray(fact.parties)) return factError(index, "agreement requires parties array.");
        if (unique(fact.parties).length > MAX_AGREEMENT_PARTIES) {
          return factError(index, `agreement may contain at most ${MAX_AGREEMENT_PARTIES} distinct parties.`);
        }
      }
      continue;
    }

    if (kind === "storyline") {
      const processKind = lower(fact.processKind);
      if (!processKind || processKind === "war") return factError(index, "storyline must describe a non-war processKind.");
      if (!STORYLINE_STATUSES.has(lower(fact.status))) return factError(index, "storyline status must be active or dormant.");
      if (!clean(fact.title)) return factError(index, "storyline requires title.");
      if (!Array.isArray(fact.participants)) return factError(index, "storyline requires participants array.");
      if (unique(fact.participants).length > MAX_STORYLINE_PARTICIPANTS) {
        return factError(index, `storyline may contain at most ${MAX_STORYLINE_PARTICIPANTS} distinct participants.`);
      }
      if (!inRange(fact.pressure, 0, 100) || !inRange(fact.momentum, 0, 100)) {
        return factError(index, "storyline pressure and momentum must each be between 0 and 100.");
      }
      if (!validDate(fact.startedDate)) return factError(index, "storyline startedDate must be a valid game date or blank.");
      continue;
    }

    if (kind === "puppet") {
      if (!clean(fact.overlord) || !clean(fact.puppet)) return factError(index, "puppet requires overlord and puppet.");
      if (!PUPPET_KINDS.has(lower(fact.puppetKind))) return factError(index, "puppetKind must be protectorate, satellite, or client.");
      if (!PUPPET_SECRECY.has(lower(fact.secrecy))) return factError(index, "puppet secrecy must be open or covert.");
      if (!inRange(fact.loyalty, 0, 100)) return factError(index, "puppet loyalty must be between 0 and 100.");
      if (!validDate(fact.startedDate)) return factError(index, "puppet startedDate must be a valid game date or blank.");
    }
  }
  return "";
};

const resolvePolity = (token, world) => {
  const raw = clean(token);
  if (!raw) return "";
  const resolved = resolvePolityIdentity(raw, world, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return clean(resolved?.resolved);
};

const resolvePolityList = (values, world) => {
  const out = [];
  const seen = new Set();
  for (const token of array(values)) {
    const resolved = resolvePolity(token, world);
    const key = lower(resolved);
    if (!resolved || seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
};

const eventIdForRef = (eventIdsByRef, ref) => {
  if (eventIdsByRef instanceof Map) return clean(eventIdsByRef.get(ref));
  return clean(eventIdsByRef?.[ref]);
};

const resolveSourceEventIds = (fact, eventIdsByRef) => {
  const ids = [];
  for (const ref of array(fact?.sourceEventRefs).map(clean).filter(Boolean)) {
    const id = eventIdForRef(eventIdsByRef, ref);
    if (!id) return { ids: [], error: `candidate-local event ref ${ref} does not resolve to a generated event id.` };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, error: "" };
};

const receiptOutcome = (fact, outcome, canonicalId, reason = "") => ({
  ref: clean(fact.ref),
  kind: lower(fact.kind),
  outcome,
  canonicalId: clean(canonicalId),
  ...(reason ? { reason } : {}),
});

const reject = (candidate, receipt, fact, error) => {
  const rejectedRef = clean(fact?.ref);
  const priorFacts = rejectedRef
    ? receipt.facts.filter((entry) => clean(entry?.ref) !== rejectedRef)
    : [...receipt.facts];
  return {
    ok: false,
    error,
    contractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION,
    compiled: null,
    projectedWorld: null,
    receipt: {
      facts: [...priorFacts, ...(fact ? [receiptOutcome(fact, "rejected", "", error)] : [])],
      derived: [...receipt.derived],
    },
    candidate,
  };
};

const existingArray = (world, key) => array(world?.[key]).filter((entry) => entry && typeof entry === "object");

const canonicalIdsByFamily = (world) => ({
  war: new Set(existingArray(world, "wars").map((entry) => clean(entry.id)).filter(Boolean)),
  relation: new Set(existingArray(world, "relations").map((entry) => clean(entry.id)).filter(Boolean)),
  agreement: new Set(existingArray(world, "agreements").map((entry) => clean(entry.id)).filter(Boolean)),
  puppet: new Set(existingArray(world, "puppets").map((entry) => clean(entry.id)).filter(Boolean)),
  storyline: new Set(existingArray(world, "storylines").map((entry) => clean(entry.id)).filter(Boolean)),
});

const overlayRecords = (base, staged) => {
  const byId = new Map();
  for (const entry of [...array(base), ...array(staged)]) {
    const id = clean(entry?.id);
    if (!id) continue;
    byId.set(id, entry);
  }
  return [...byId.values()];
};

const projectWorld = (world, compiled) => {
  const normalized = normalizeWorldState(world);
  return {
    ...normalized,
    wars: [...existingArray(normalized, "wars"), ...compiled.wars],
    relations: [...existingArray(normalized, "relations"), ...compiled.relations],
    agreements: [...existingArray(normalized, "agreements"), ...compiled.agreements],
    puppets: [...existingArray(normalized, "puppets"), ...compiled.puppets],
  };
};

const baselineDateError = (value, startDate, label) => {
  const date = clean(value);
  const horizon = clean(startDate);
  if (!date || !horizon) return "";
  if (compareGameDates(date, horizon) > 0) return `${label} date ${date} is after the Round-One campaign start ${horizon}.`;
  return "";
};

const claimCanonicalId = (claims, kind, id, ref) => {
  const key = `${kind}|${clean(id)}`;
  const prior = claims.get(key);
  if (prior && prior !== clean(ref)) return `candidate facts ${prior} and ${clean(ref)} resolve to the same canonical ${kind} id ${id}.`;
  claims.set(key, clean(ref));
  return "";
};

const familyRecordById = (world, kind, id) => {
  const key = kind === "war" ? "wars"
    : kind === "relation" ? "relations"
      : kind === "agreement" ? "agreements"
        : kind === "puppet" ? "puppets"
          : kind === "storyline" ? "storylines"
            : "";
  return key ? existingArray(world, key).find((entry) => clean(entry?.id) === clean(id)) || null : null;
};

const semanticConservationError = (kind, expected, actual, world) => {
  if (kind === "war") return pregameWarBaselineCompatibilityError(expected, actual);
  if (kind === "relation") return pregameRelationBaselineCompatibilityError(expected, actual, world);
  if (kind === "agreement") return pregameAgreementBaselineCompatibilityError(expected, actual, world);
  if (kind === "puppet") return pregamePuppetBaselineCompatibilityError(expected, actual);
  if (kind === "storyline") return pregameStorylineBaselineCompatibilityError(expected, actual);
  return `unsupported receipt family ${kind}`;
};

export const compilePregameBootstrapCandidate = ({
  candidate,
  world = {},
  eventIdsByRef = {},
  startDate = "",
  round = 1,
  puppetStates = true,
} = {}) => {
  const shapeError = validatePregameBootstrapCandidateShape(candidate);
  const receipt = { facts: [], derived: [] };
  if (shapeError) return reject(candidate, receipt, null, shapeError);
  if (clean(startDate) && !validDate(startDate)) return reject(candidate, receipt, null, `Round-Zero start date ${startDate} is invalid.`);

  const baseWorld = normalizeWorldState(world);
  const compiled = { wars: [], relations: [], agreements: [], puppets: [], storylines: [] };
  const occupiedIds = new Set([
    ...existingArray(baseWorld, "wars"),
    ...existingArray(baseWorld, "relations"),
    ...existingArray(baseWorld, "agreements"),
    ...existingArray(baseWorld, "puppets"),
    ...existingArray(baseWorld, "storylines"),
  ].map((entry) => clean(entry.id)).filter(Boolean));
  const canonicalClaims = new Map();
  const expectedByRef = new Map();
  const expectedDerived = new Map();
  const warMetaByRef = new Map();
  const storylineMetaByRef = new Map();
  const warFactRefs = new Set(
    candidate.facts
      .filter((fact) => lower(fact?.kind) === "war")
      .map((fact) => clean(fact?.ref))
      .filter(Boolean),
  );

  for (let index = 0; index < candidate.facts.length; index += 1) {
    const raw = candidate.facts[index];
    const kind = lower(raw.kind);
    const sources = resolveSourceEventIds(raw, eventIdsByRef);
    if (sources.error) return reject(candidate, receipt, raw, factError(index, sources.error));
    const horizonError = baselineDateError(raw.startedDate, startDate, `$.facts[${index}].startedDate`);
    if (horizonError) return reject(candidate, receipt, raw, factError(index, horizonError));

    if (kind === "war") {
      const sideA = resolvePolityList(raw.sideA, baseWorld);
      const sideB = resolvePolityList(raw.sideB, baseWorld);
      if (sideA.length !== unique(raw.sideA).length || sideB.length !== unique(raw.sideB).length) {
        return reject(candidate, receipt, raw, factError(index, "war contains unresolved current polity identity."));
      }
      const overlap = new Set(sideA.map(lower));
      if (sideB.some((name) => overlap.has(lower(name))) || !sideA.length || !sideB.length) {
        return reject(candidate, receipt, raw, factError(index, "war requires two non-empty disjoint canonical sides."));
      }
      if (unique([...sideA, ...sideB]).length > MAX_STORYLINE_PARTICIPANTS) {
        return reject(candidate, receipt, raw, factError(index, `war has more than ${MAX_STORYLINE_PARTICIPANTS} total belligerents; its canonical scheduler mirror would be lossy.`));
      }
      const semantic = {
        ...raw,
        status: lower(raw.status),
        sideA,
        sideB,
        title: clean(raw.title),
        startedDate: clean(raw.startedDate),
      };
      const currentWars = overlayRecords(existingArray(baseWorld, "wars"), compiled.wars);
      const matched = resolvePregameWarBaselineMatch({ records: currentWars, candidate: semantic });
      if (matched.error) return reject(candidate, receipt, raw, factError(index, matched.error));

      let warRecord;
      let outcome;
      if (matched.match) {
        const incoming = buildPregameWarBaselineRecord({
          id: matched.match.id,
          title: raw.title,
          status: raw.status,
          sideA,
          sideB,
          startedDate: raw.startedDate,
          note: raw.note,
          sourceEventIds: sources.ids,
          round,
        });
        if (incoming.error) return reject(candidate, receipt, raw, factError(index, incoming.error));
        const merged = mergePregameWarBaselineRecord({ existing: matched.match, incoming: incoming.record });
        if (merged.error) return reject(candidate, receipt, raw, factError(index, merged.error));
        warRecord = merged.record;
        outcome = "merged";
      } else {
        const allocationKey = `${sidePairKey(sideA, sideB)}|${titleKey(raw.title)}|${clean(raw.startedDate) || "unknown"}`;
        const id = allocatePregameCanonicalId("war", allocationKey, occupiedIds);
        occupiedIds.add(id);
        const built = buildPregameWarBaselineRecord({
          id,
          title: raw.title,
          status: raw.status,
          sideA,
          sideB,
          startedDate: raw.startedDate,
          note: raw.note,
          sourceEventIds: sources.ids,
          round,
        });
        if (built.error) return reject(candidate, receipt, raw, factError(index, built.error));
        warRecord = built.record;
        outcome = "applied";
      }
      const claimError = claimCanonicalId(canonicalClaims, "war", warRecord.id, raw.ref);
      if (claimError) return reject(candidate, receipt, raw, factError(index, claimError));
      compiled.wars.push(warRecord);
      receipt.facts.push(receiptOutcome(raw, outcome, warRecord.id, outcome === "merged" ? "Compatible authoritative war baseline enriched and retained." : ""));
      expectedByRef.set(clean(raw.ref), { kind: "war", record: warRecord });
      warMetaByRef.set(clean(raw.ref), {
        ref: clean(raw.ref),
        war: warRecord,
        titleKey: titleKey(raw.title),
        participantsKey: participantKey([...sideA, ...sideB]),
        assessment: raw.assessment || null,
      });
      continue;
    }

    if (kind === "relation") {
      const a = resolvePolity(raw.a, baseWorld);
      const b = resolvePolity(raw.b, baseWorld);
      if (!a || !b || lower(a) === lower(b)) return reject(candidate, receipt, raw, factError(index, "relation contains unresolved or identical current polity identities."));
      const currentRelations = overlayRecords(existingArray(baseWorld, "relations"), compiled.relations);
      const matched = resolvePregameRelationBaselineMatch({ records: currentRelations, a, b, world: baseWorld });
      if (matched.error) return reject(candidate, receipt, raw, factError(index, matched.error));
      let relationRecord;
      let outcome;
      if (matched.match) {
        const incoming = buildPregameRelationBaselineRecord({
          id: matched.match.id,
          a,
          b,
          score: raw.score,
          summary: raw.summary,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (incoming.error) return reject(candidate, receipt, raw, factError(index, incoming.error));
        const merged = mergePregameRelationBaselineRecord({ existing: matched.match, incoming: incoming.record });
        if (merged.error) return reject(candidate, receipt, raw, factError(index, merged.error));
        relationRecord = merged.record;
        outcome = "merged";
      } else {
        const built = buildPregameRelationBaselineRecord({
          a,
          b,
          score: raw.score,
          summary: raw.summary,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (built.error) return reject(candidate, receipt, raw, factError(index, built.error));
        if (occupiedIds.has(built.record.id)) return reject(candidate, receipt, raw, factError(index, `native relation id ${built.record.id} collides with another canonical record.`));
        occupiedIds.add(built.record.id);
        relationRecord = built.record;
        outcome = "applied";
      }
      const claimError = claimCanonicalId(canonicalClaims, "relation", relationRecord.id, raw.ref);
      if (claimError) return reject(candidate, receipt, raw, factError(index, claimError));
      compiled.relations.push(relationRecord);
      receipt.facts.push(receiptOutcome(raw, outcome, relationRecord.id, outcome === "merged" ? "Compatible authoritative relation baseline enriched and retained." : ""));
      expectedByRef.set(clean(raw.ref), { kind: "relation", record: relationRecord });
      continue;
    }

    if (kind === "agreement") {
      const type = lower(raw.type).replace(/[ -]+/g, "_");
      let guarantor = "";
      let beneficiary = "";
      let grantor = "";
      let grantee = "";
      let reciprocalAccess = false;
      let parties = [];
      if (type === "guarantee") {
        guarantor = resolvePolity(raw.guarantor, baseWorld);
        beneficiary = resolvePolity(raw.beneficiary, baseWorld);
        if (!guarantor || !beneficiary || lower(guarantor) === lower(beneficiary)) {
          return reject(candidate, receipt, raw, factError(index, "guarantee roles contain unresolved or identical current polity identities."));
        }
        parties = [guarantor, beneficiary];
      } else if (type === "military_access") {
        reciprocalAccess = raw.reciprocal === true;
        if (reciprocalAccess) {
          parties = resolvePolityList(raw.parties, baseWorld);
          if (parties.length !== 2 || parties.length !== unique(raw.parties).length) {
            return reject(candidate, receipt, raw, factError(index, "reciprocal military-access parties contain unresolved identities or are not exactly two distinct polities."));
          }
        } else {
          grantor = resolvePolity(raw.grantor, baseWorld);
          grantee = resolvePolity(raw.grantee, baseWorld);
          if (!grantor || !grantee || lower(grantor) === lower(grantee)) {
            return reject(candidate, receipt, raw, factError(index, "military-access grantor/grantee contain unresolved or identical current polity identities."));
          }
          parties = [grantor, grantee];
        }
      } else {
        parties = resolvePolityList(raw.parties, baseWorld);
        if (parties.length !== unique(raw.parties).length || parties.length < 2) {
          return reject(candidate, receipt, raw, factError(index, "agreement parties contain unresolved current polity identity or fewer than two distinct parties."));
        }
      }
      const semantic = { ...raw, type, parties, guarantor, beneficiary, grantor, grantee, reciprocalAccess };
      const currentAgreements = overlayRecords(existingArray(baseWorld, "agreements"), compiled.agreements);
      const matched = resolvePregameAgreementBaselineMatch({ records: currentAgreements, candidate: semantic, world: baseWorld });
      if (matched.error) return reject(candidate, receipt, raw, factError(index, matched.error));

      let agreementRecord;
      let outcome;
      if (matched.match) {
        const incoming = buildPregameAgreementBaselineRecord({
          id: matched.match.id,
          type,
          title: raw.title,
          parties,
          guarantor,
          beneficiary,
          grantor,
          grantee,
          reciprocalAccess,
          startedDate: raw.startedDate,
          terms: raw.terms,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (incoming.error) return reject(candidate, receipt, raw, factError(index, incoming.error));
        const merged = mergePregameAgreementBaselineRecord({ existing: matched.match, incoming: incoming.record, world: baseWorld });
        if (merged.error) return reject(candidate, receipt, raw, factError(index, merged.error));
        agreementRecord = merged.record;
        outcome = "merged";
      } else {
        const roleKey = pregameAgreementRoleKey(semantic, baseWorld);
        const allocationKey = `${roleKey}|${titleKey(raw.title)}|${clean(raw.startedDate) || "unknown"}`;
        const id = allocatePregameCanonicalId("agreement", allocationKey, occupiedIds);
        occupiedIds.add(id);
        const built = buildPregameAgreementBaselineRecord({
          id,
          type,
          title: raw.title,
          parties,
          guarantor,
          beneficiary,
          grantor,
          grantee,
          reciprocalAccess,
          startedDate: raw.startedDate,
          terms: raw.terms,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (built.error) return reject(candidate, receipt, raw, factError(index, built.error));
        agreementRecord = built.record;
        outcome = "applied";
      }
      const claimError = claimCanonicalId(canonicalClaims, "agreement", agreementRecord.id, raw.ref);
      if (claimError) return reject(candidate, receipt, raw, factError(index, claimError));
      compiled.agreements.push(agreementRecord);
      receipt.facts.push(receiptOutcome(raw, outcome, agreementRecord.id, outcome === "merged" ? "Compatible authoritative agreement baseline enriched and retained." : ""));
      expectedByRef.set(clean(raw.ref), { kind: "agreement", record: agreementRecord });
      continue;
    }

    if (kind === "storyline") {
      const participants = resolvePolityList(raw.participants, baseWorld);
      if (participants.length !== unique(raw.participants).length || participants.length < 1) {
        return reject(candidate, receipt, raw, factError(index, "storyline participants contain unresolved current polity identity."));
      }
      const distinctFromWarRef = clean(raw.distinctFromWarRef);
      if (distinctFromWarRef && !warFactRefs.has(distinctFromWarRef)) {
        return reject(candidate, receipt, raw, factError(index, `distinctFromWarRef ${distinctFromWarRef} must reference a war fact in this candidate.`));
      }
      const semantic = {
        ...raw,
        processKind: lower(raw.processKind),
        status: lower(raw.status),
        participants,
      };
      const currentStorylines = overlayRecords(existingArray(baseWorld, "storylines"), compiled.storylines);
      const matched = resolvePregameStorylineBaselineMatch({ records: currentStorylines, candidate: semantic });
      if (matched.error) return reject(candidate, receipt, raw, factError(index, matched.error));

      let storylineRecord;
      let outcome;
      if (matched.match) {
        const incoming = buildPregameStorylineBaselineRecord({
          id: matched.match.id,
          processKind: raw.processKind,
          title: raw.title,
          participants,
          status: raw.status,
          pressure: raw.pressure,
          momentum: raw.momentum,
          startedDate: raw.startedDate,
          state: raw.state,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
        });
        if (incoming.error) return reject(candidate, receipt, raw, factError(index, incoming.error));
        const merged = mergePregameStorylineBaselineRecord({ existing: matched.match, incoming: incoming.record });
        if (merged.error) return reject(candidate, receipt, raw, factError(index, merged.error));
        storylineRecord = merged.record;
        outcome = "merged";
      } else {
        const allocationKey = `${semantic.processKind}|${participantKey(participants)}|${titleKey(raw.title)}|${clean(raw.startedDate) || "unknown"}`;
        const id = allocatePregameCanonicalId("storyline", allocationKey, occupiedIds);
        occupiedIds.add(id);
        const built = buildPregameStorylineBaselineRecord({
          id,
          processKind: raw.processKind,
          title: raw.title,
          participants,
          status: raw.status,
          pressure: raw.pressure,
          momentum: raw.momentum,
          startedDate: raw.startedDate,
          state: raw.state,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
        });
        if (built.error) return reject(candidate, receipt, raw, factError(index, built.error));
        storylineRecord = built.record;
        outcome = "applied";
      }
      const claimError = claimCanonicalId(canonicalClaims, "storyline", storylineRecord.id, raw.ref);
      if (claimError) return reject(candidate, receipt, raw, factError(index, claimError));
      compiled.storylines.push(storylineRecord);
      receipt.facts.push(receiptOutcome(raw, outcome, storylineRecord.id, outcome === "merged" ? "Compatible authoritative storyline baseline enriched, adopted, and retained." : ""));
      expectedByRef.set(clean(raw.ref), { kind: "storyline", record: storylineRecord });
      storylineMetaByRef.set(clean(raw.ref), {
        ref: clean(raw.ref),
        titleKey: titleKey(raw.title),
        participantsKey: participantKey(participants),
        distinctFromWarRef,
      });
      continue;
    }

    if (kind === "puppet") {
      if (!puppetStates) return reject(candidate, receipt, raw, factError(index, "cannot persist puppet state while the Puppet states feature is disabled."));
      const overlord = resolvePolity(raw.overlord, baseWorld);
      const puppet = resolvePolity(raw.puppet, baseWorld);
      if (!overlord || !puppet || lower(overlord) === lower(puppet)) {
        return reject(candidate, receipt, raw, factError(index, "puppet contains unresolved or identical current polity identities."));
      }
      const currentPuppets = overlayRecords(existingArray(baseWorld, "puppets"), compiled.puppets);
      const matched = resolvePregamePuppetBaselineMatch({ records: currentPuppets, overlord, puppet });
      if (matched.error) return reject(candidate, receipt, raw, factError(index, matched.error));

      let puppetRecord;
      let outcome;
      if (matched.match) {
        const incoming = buildPregamePuppetBaselineRecord({
          id: matched.match.id,
          overlord,
          puppet,
          kind: raw.puppetKind,
          loyalty: raw.loyalty,
          secrecy: raw.secrecy,
          startedDate: raw.startedDate,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (incoming.error) return reject(candidate, receipt, raw, factError(index, incoming.error));
        const merged = mergePregamePuppetBaselineRecord({ existing: matched.match, incoming: incoming.record });
        if (merged.error) return reject(candidate, receipt, raw, factError(index, merged.error));
        puppetRecord = merged.record;
        outcome = "merged";
      } else {
        const allocationKey = `${lower(overlord)}>${lower(puppet)}|${lower(raw.puppetKind)}|${clean(raw.startedDate) || "unknown"}`;
        const id = allocatePregameCanonicalId("puppet", allocationKey, occupiedIds);
        occupiedIds.add(id);
        const built = buildPregamePuppetBaselineRecord({
          id,
          overlord,
          puppet,
          kind: raw.puppetKind,
          loyalty: raw.loyalty,
          secrecy: raw.secrecy,
          startedDate: raw.startedDate,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (built.error) return reject(candidate, receipt, raw, factError(index, built.error));
        puppetRecord = built.record;
        outcome = "applied";
      }
      const claimError = claimCanonicalId(canonicalClaims, "puppet", puppetRecord.id, raw.ref);
      if (claimError) return reject(candidate, receipt, raw, factError(index, claimError));
      compiled.puppets.push(puppetRecord);
      receipt.facts.push(receiptOutcome(raw, outcome, puppetRecord.id, outcome === "merged" ? "Compatible authoritative puppet baseline enriched and retained." : ""));
      expectedByRef.set(clean(raw.ref), { kind: "puppet", record: puppetRecord });
    }
  }

  for (const storylineMeta of storylineMetaByRef.values()) {
    for (const warMeta of warMetaByRef.values()) {
      const looksLikeWarDuplicate =
        storylineMeta.titleKey === warMeta.titleKey &&
        storylineMeta.participantsKey === warMeta.participantsKey;
      if (looksLikeWarDuplicate && storylineMeta.distinctFromWarRef !== warMeta.ref) {
        return reject(
          candidate,
          receipt,
          candidate.facts.find((fact) => clean(fact?.ref) === storylineMeta.ref) || null,
          `Storyline fact ${storylineMeta.ref} is ambiguous with war fact ${warMeta.ref}; put scheduler assessment on the war fact or explicitly mark the independent process with distinctFromWarRef.`,
        );
      }
    }
  }

  // War scheduler mirrors are native-derived. Existing explicit war->storyline
  // linkage wins; otherwise only the exact native mirror id is eligible. Mere
  // participant similarity is never enough to adopt a legacy storyline.
  for (const warMeta of warMetaByRef.values()) {
    const war = warMeta.war;
    const currentStorylines = overlayRecords(existingArray(baseWorld, "storylines"), compiled.storylines);
    const warParticipants = participantKey([...(war?.sideA || []), ...(war?.sideB || [])]);
    const linkedIds = unique(war?.storylineIds).filter(Boolean);
    const linkedMatches = linkedIds
      .map((id) => currentStorylines.find((entry) => clean(entry?.id) === id) || null)
      .filter(Boolean);
    if (linkedIds.length > 1) return reject(candidate, receipt, null, `War ${war.id} links to multiple canonical storyline ids; Round-Zero mirror identity is ambiguous.`);
    if (linkedIds.length && linkedMatches.length !== linkedIds.length) return reject(candidate, receipt, null, `War ${war.id} contains a dangling canonical storyline linkage; Round-Zero will not invent a replacement identity.`);

    const preferredId = `storyline-${clean(war?.id)}`;
    let exact = linkedMatches[0] || currentStorylines.find((entry) => clean(entry?.id) === preferredId) || null;
    let mirrorId = clean(exact?.id) || preferredId;
    if (exact) {
      if (lower(exact.kind) !== "war" || participantKey(exact.participants) !== warParticipants) {
        return reject(candidate, receipt, null, `Derived war mirror ${mirrorId} conflicts with the canonical war linkage for ${war.id}.`);
      }
      const assessment = {
        pressure: warMeta.assessment?.pressure ?? exact.pressure,
        momentum: warMeta.assessment?.momentum ?? exact.momentum,
        state: warMeta.assessment?.state ?? exact.state,
      };
      const incoming = buildPregameWarStorylineMirrorRecord({ id: mirrorId, war, assessment, observedDate: startDate, round });
      if (incoming.error) return reject(candidate, receipt, null, incoming.error);
      const merged = mergePregameStorylineBaselineRecord({ existing: exact, incoming: incoming.record });
      if (merged.error) return reject(candidate, receipt, null, merged.error);
      compiled.storylines.push(merged.record);
      expectedDerived.set(`war-storyline|${warMeta.ref}`, merged.record);
      receipt.derived.push({ kind: "war-storyline", sourceFactRef: warMeta.ref, outcome: "merged", canonicalId: mirrorId });
    } else {
      const legacyPotential = currentStorylines.filter((entry) =>
        lower(entry?.kind) === "war" && participantKey(entry?.participants) === warParticipants
      );
      if (legacyPotential.length) {
        return reject(candidate, receipt, null, `War ${war.id} has ${legacyPotential.length} participant-matched legacy war storyline(s) but no explicit or exact canonical linkage; automatic participant-based reconciliation is forbidden.`);
      }
      const builtMirror = buildPregameWarStorylineMirrorRecord({ id: mirrorId, war, assessment: warMeta.assessment, observedDate: startDate, round });
      if (builtMirror.error) return reject(candidate, receipt, null, builtMirror.error);
      if (occupiedIds.has(builtMirror.record.id)) return reject(candidate, receipt, null, `Derived war mirror id ${builtMirror.record.id} collides with unrelated canonical state.`);
      occupiedIds.add(builtMirror.record.id);
      compiled.storylines.push(builtMirror.record);
      expectedDerived.set(`war-storyline|${warMeta.ref}`, builtMirror.record);
      receipt.derived.push({ kind: "war-storyline", sourceFactRef: warMeta.ref, outcome: "applied", canonicalId: builtMirror.record.id });
    }

    const linkedWar = {
      ...war,
      storylineIds: unique([...array(war.storylineIds), mirrorId]),
    };
    warMeta.war = linkedWar;
    for (let index = compiled.wars.length - 1; index >= 0; index -= 1) {
      if (clean(compiled.wars[index]?.id) === clean(war.id)) {
        compiled.wars[index] = linkedWar;
        break;
      }
    }
    const expected = expectedByRef.get(warMeta.ref);
    if (expected?.kind === "war") expected.record = linkedWar;
  }

  const puppetRows = overlayRecords(existingArray(baseWorld, "puppets"), compiled.puppets);
  const puppetError = validatePregamePuppetGraph(puppetRows);
  if (puppetError) return reject(candidate, receipt, null, puppetError);

  let projectedWorld = projectWorld(baseWorld, compiled);
  const storylineMerge = mergePregameStorylineBaselines({ world: projectedWorld, records: compiled.storylines });
  if (storylineMerge.error) return reject(candidate, receipt, null, storylineMerge.error);

  projectedWorld = normalizeWorldState(storylineMerge.world);

  const finalIds = canonicalIdsByFamily(projectedWorld);
  const baseIds = canonicalIdsByFamily(baseWorld);
  for (const family of ["war", "relation", "agreement", "puppet", "storyline"]) {
    for (const id of baseIds[family]) {
      if (!finalIds[family].has(id)) {
        return reject(candidate, receipt, null, `Round-Zero compilation would evict existing authoritative ${family} record ${id}; publication is refused.`);
      }
    }
  }

  for (const outcome of receipt.facts) {
    const expected = expectedByRef.get(outcome.ref);
    const actual = expected ? familyRecordById(projectedWorld, expected.kind, outcome.canonicalId) : null;
    if (!expected || !actual) {
      return reject(candidate, receipt, null, `Round-Zero receipt lost ${outcome.kind} fact ${outcome.ref}: canonical id ${outcome.canonicalId || "<blank>"} is absent from projected final state.`);
    }
    const semanticError = semanticConservationError(expected.kind, expected.record, actual, projectedWorld);
    if (semanticError) {
      return reject(candidate, receipt, null, `Round-Zero receipt changed ${outcome.kind} fact ${outcome.ref} (${outcome.canonicalId}): ${semanticError}.`);
    }
  }
  for (const derived of receipt.derived) {
    const expected = expectedDerived.get(`${derived.kind}|${derived.sourceFactRef}`);
    const actual = derived.kind === "war-storyline" ? familyRecordById(projectedWorld, "storyline", derived.canonicalId) : null;
    if (!expected || !actual) {
      return reject(candidate, receipt, null, `Round-Zero receipt lost derived ${derived.kind}: canonical id ${derived.canonicalId || "<blank>"} is absent from projected final state.`);
    }
    const semanticError = pregameStorylineBaselineCompatibilityError(expected, actual);
    if (semanticError) return reject(candidate, receipt, null, `Round-Zero receipt changed derived ${derived.kind} ${derived.canonicalId}: ${semanticError}.`);
  }
  if (receipt.facts.length !== candidate.facts.length) {
    return reject(candidate, receipt, null, `Round-Zero receipt accounted for ${receipt.facts.length}/${candidate.facts.length} candidate facts.`);
  }

  return {
    ok: true,
    error: "",
    contractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION,
    compiled,
    projectedWorld,
    receipt: {
      facts: receipt.facts,
      derived: receipt.derived,
      counts: {
        candidateFacts: candidate.facts.length,
        applied: receipt.facts.filter((entry) => entry.outcome === "applied").length,
        merged: receipt.facts.filter((entry) => entry.outcome === "merged").length,
        derived: receipt.derived.length,
      },
    },
    candidate,
  };
};
