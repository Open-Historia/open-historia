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
import { parseGameDate } from "../../runtime/gameDates.js";
import {
  buildPregameWarBaselineRecord,
} from "./nativeWarLedger.js";
import {
  AGREEMENT_TYPE_VALUES,
  buildPregameAgreementBaselineRecord,
  buildPregamePuppetBaselineRecord,
  buildPregameRelationBaselineRecord,
  relationPairKey,
} from "./nativeDiplomaticDirector.js";
import {
  buildPregameStorylineBaselineRecord,
  buildPregameWarStorylineMirrorRecord,
  mergePregameStorylineBaselines,
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
  agreement: new Set([...COMMON_FACT_FIELDS, "type", "title", "parties", "guarantor", "beneficiary", "startedDate", "terms"]),
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

const titleKey = (value) => lower(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
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
        if (fact.parties !== undefined) return factError(index, "guarantee must use directional guarantor/beneficiary roles, not parties.");
      } else {
        if (fact.guarantor !== undefined || fact.beneficiary !== undefined) return factError(index, "non-guarantee agreement may not supply guarantor/beneficiary roles.");
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

const warMatch = (fact, war) => {
  if (!war || !WAR_STATUSES.has(lower(war.status))) return false;
  if (sidePairKey(fact.sideA, fact.sideB) !== sidePairKey(war.sideA, war.sideB)) return false;
  const candidateDate = clean(fact.startedDate);
  const existingDate = clean(war.startedDate);
  if (candidateDate && existingDate) return candidateDate === existingDate;
  return titleKey(fact.title) && titleKey(fact.title) === titleKey(war.title);
};

const agreementRoleKey = (agreement) => {
  const type = lower(agreement?.type).replace(/[ -]+/g, "_");
  if (type === "guarantee") {
    const guarantor = clean(agreement?.guarantor || agreement?.parties?.[0]);
    const beneficiary = clean(agreement?.beneficiary || agreement?.parties?.[1]);
    return `${type}|${lower(guarantor)}>${lower(beneficiary)}`;
  }
  return `${type}|${listKey(agreement?.parties)}`;
};

const agreementMatch = (fact, agreement) => {
  if (!agreement || lower(agreement.status) !== "active") return false;
  if (agreementRoleKey(fact) !== agreementRoleKey(agreement)) return false;
  const candidateDate = clean(fact.startedDate);
  const existingDate = clean(agreement.startedDate);
  if (candidateDate && existingDate) return candidateDate === existingDate;
  return titleKey(fact.title) && titleKey(fact.title) === titleKey(agreement.title);
};

const storylineMatch = (fact, storyline) => {
  if (!storyline || lower(storyline.kind) !== lower(fact.processKind)) return false;
  if (participantKey(storyline.participants) !== participantKey(fact.participants)) return false;
  const candidateDate = clean(fact.startedDate);
  const existingDate = clean(storyline.startedDate);
  if (candidateDate && existingDate) return candidateDate === existingDate;
  return titleKey(fact.title) && titleKey(fact.title) === titleKey(storyline.title);
};

const puppetMatch = (fact, row) =>
  lower(row?.status) === "active" &&
  lower(row?.overlord) === lower(fact.overlord) &&
  lower(row?.puppet) === lower(fact.puppet);

const existingArray = (world, key) => array(world?.[key]).filter((entry) => entry && typeof entry === "object");
const uniqueMatch = (matches, label) => {
  if (matches.length <= 1) return { match: matches[0] || null, error: "" };
  return { match: null, error: `${label} matches multiple existing canonical records; identity is ambiguous.` };
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

const canonicalIdsByFamily = (world) => ({
  war: new Set(existingArray(world, "wars").map((entry) => clean(entry.id)).filter(Boolean)),
  relation: new Set(existingArray(world, "relations").map((entry) => clean(entry.id)).filter(Boolean)),
  agreement: new Set(existingArray(world, "agreements").map((entry) => clean(entry.id)).filter(Boolean)),
  puppet: new Set(existingArray(world, "puppets").map((entry) => clean(entry.id)).filter(Boolean)),
  storyline: new Set(existingArray(world, "storylines").map((entry) => clean(entry.id)).filter(Boolean)),
});

const validatePuppetGraph = (rows) => {
  const parentByPuppet = new Map();
  for (const row of rows.filter((entry) => lower(entry?.status) === "active")) {
    const overlord = clean(row?.overlord);
    const puppet = clean(row?.puppet);
    if (!overlord || !puppet || lower(overlord) === lower(puppet)) return "Round-Zero puppet canon contains an invalid self/blank subordination.";
    const puppetKey = lower(puppet);
    const prior = parentByPuppet.get(puppetKey);
    if (prior && lower(prior) !== lower(overlord)) return `Round-Zero puppet ${puppet} has more than one active overlord.`;
    parentByPuppet.set(puppetKey, overlord);
  }
  for (const [puppetKey, overlord] of parentByPuppet) {
    if (parentByPuppet.has(lower(overlord))) {
      return `Round-Zero puppet chain is forbidden: ${overlord} is itself a puppet while directing ${puppetKey}.`;
    }
  }
  return "";
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
  const candidateIdentity = new Set();
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
      const semantic = {
        ...raw,
        status: lower(raw.status),
        sideA,
        sideB,
        title: clean(raw.title),
        startedDate: clean(raw.startedDate),
      };
      const allocationKey = `${sidePairKey(sideA, sideB)}|${titleKey(raw.title)}|${clean(raw.startedDate) || "unknown"}`;
      const duplicateKey = `war|${allocationKey}`;
      if (candidateIdentity.has(duplicateKey)) return reject(candidate, receipt, raw, factError(index, "duplicates another candidate war identity."));
      candidateIdentity.add(duplicateKey);

      const existingWars = existingArray(baseWorld, "wars");
      let matched = uniqueMatch(existingWars.filter((war) => warMatch(semantic, war)), `$.facts[${index}] war`);
      if (matched.error) return reject(candidate, receipt, raw, matched.error);
      if (!matched.match) {
        const unknownDateSideMatches = existingWars.filter((war) =>
          WAR_STATUSES.has(lower(war?.status)) &&
          sidePairKey(war?.sideA, war?.sideB) === sidePairKey(sideA, sideB) &&
          (!clean(war?.startedDate) || !clean(raw.startedDate))
        );
        const fallback = uniqueMatch(unknownDateSideMatches, `$.facts[${index}] war with unknown-date identity`);
        if (fallback.error) return reject(candidate, receipt, raw, fallback.error);
        matched = fallback;
      }
      let warRecord;
      if (matched.match) {
        if (lower(matched.match.status) !== semantic.status) {
          return reject(candidate, receipt, raw, factError(index, `conflicts with existing war ${matched.match.id} status ${matched.match.status}.`));
        }
        warRecord = matched.match;
        receipt.facts.push(receiptOutcome(raw, "merged", matched.match.id, "Existing authoritative war baseline retained."));
      } else {
        const sameLiveSidesAndTitle = existingWars.filter((war) =>
          WAR_STATUSES.has(lower(war.status)) &&
          sidePairKey(war.sideA, war.sideB) === sidePairKey(sideA, sideB) &&
          titleKey(war.title) === titleKey(raw.title)
        );
        if (sameLiveSidesAndTitle.length && clean(raw.startedDate) && sameLiveSidesAndTitle.some((war) => clean(war.startedDate) && clean(war.startedDate) !== clean(raw.startedDate))) {
          return reject(candidate, receipt, raw, factError(index, "conflicts with an existing live war having the same sides/title but a different known start date."));
        }
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
        compiled.wars.push(warRecord);
        receipt.facts.push(receiptOutcome(raw, "applied", id));
      }
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
      const pair = relationPairKey(a, b, baseWorld);
      const duplicateKey = `relation|${pair}`;
      if (candidateIdentity.has(duplicateKey)) return reject(candidate, receipt, raw, factError(index, "duplicates another candidate relation pair."));
      candidateIdentity.add(duplicateKey);
      const matches = existingArray(baseWorld, "relations").filter((entry) => relationPairKey(entry.a, entry.b, baseWorld) === pair);
      const matched = uniqueMatch(matches, `$.facts[${index}] relation`);
      if (matched.error) return reject(candidate, receipt, raw, matched.error);
      if (matched.match) {
        if (Math.round(Number(matched.match.score)) !== Math.round(Number(raw.score))) {
          return reject(candidate, receipt, raw, factError(index, `conflicts with existing authoritative relation ${matched.match.id} score ${matched.match.score}.`));
        }
        receipt.facts.push(receiptOutcome(raw, "merged", matched.match.id, "Existing authoritative relation baseline retained."));
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
        compiled.relations.push(built.record);
        receipt.facts.push(receiptOutcome(raw, "applied", built.record.id));
      }
      continue;
    }

    if (kind === "agreement") {
      const type = lower(raw.type).replace(/[ -]+/g, "_");
      let guarantor = "";
      let beneficiary = "";
      let parties = [];
      if (type === "guarantee") {
        guarantor = resolvePolity(raw.guarantor, baseWorld);
        beneficiary = resolvePolity(raw.beneficiary, baseWorld);
        if (!guarantor || !beneficiary || lower(guarantor) === lower(beneficiary)) {
          return reject(candidate, receipt, raw, factError(index, "guarantee roles contain unresolved or identical current polity identities."));
        }
        parties = [guarantor, beneficiary];
      } else {
        parties = resolvePolityList(raw.parties, baseWorld);
        if (parties.length !== unique(raw.parties).length || parties.length < 2) {
          return reject(candidate, receipt, raw, factError(index, "agreement parties contain unresolved current polity identity or fewer than two distinct parties."));
        }
      }
      const semantic = { ...raw, type, parties, guarantor, beneficiary };
      const roleKey = agreementRoleKey(semantic);
      const allocationKey = `${roleKey}|${titleKey(raw.title)}|${clean(raw.startedDate) || "unknown"}`;
      const duplicateKey = `agreement|${allocationKey}`;
      if (candidateIdentity.has(duplicateKey)) return reject(candidate, receipt, raw, factError(index, "duplicates another candidate agreement identity."));
      candidateIdentity.add(duplicateKey);
      const existingAgreements = existingArray(baseWorld, "agreements")
        .filter((entry) => lower(entry?.status) === "active");
      let matched = uniqueMatch(existingAgreements.filter((entry) => agreementMatch(semantic, entry)), `$.facts[${index}] agreement`);
      if (matched.error) return reject(candidate, receipt, raw, matched.error);
      if (!matched.match) {
        const unknownDateRoleMatches = existingAgreements.filter((entry) =>
          agreementRoleKey(entry) === roleKey &&
          (!clean(entry?.startedDate) || !clean(raw.startedDate))
        );
        if (unknownDateRoleMatches.length) {
          return reject(
            candidate,
            receipt,
            raw,
            factError(index, `has ${unknownDateRoleMatches.length} active agreement candidate(s) with the same roles/type but incomplete date identity; a renamed agreement cannot be merged or duplicated safely.`),
          );
        }
      }
      if (matched.match) {
        receipt.facts.push(receiptOutcome(raw, "merged", matched.match.id, "Existing authoritative agreement baseline retained."));
      } else {
        const id = allocatePregameCanonicalId("agreement", allocationKey, occupiedIds);
        occupiedIds.add(id);
        const built = buildPregameAgreementBaselineRecord({
          id,
          type,
          title: raw.title,
          parties,
          guarantor,
          beneficiary,
          startedDate: raw.startedDate,
          terms: raw.terms,
          sourceEventIds: sources.ids,
          observedDate: startDate,
          round,
          world: baseWorld,
        });
        if (built.error) return reject(candidate, receipt, raw, factError(index, built.error));
        compiled.agreements.push(built.record);
        receipt.facts.push(receiptOutcome(raw, "applied", id));
      }
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
      const allocationKey = `${semantic.processKind}|${participantKey(participants)}|${titleKey(raw.title)}|${clean(raw.startedDate) || "unknown"}`;
      const duplicateKey = `storyline|${allocationKey}`;
      if (candidateIdentity.has(duplicateKey)) return reject(candidate, receipt, raw, factError(index, "duplicates another candidate storyline identity."));
      candidateIdentity.add(duplicateKey);
      const matched = uniqueMatch(existingArray(baseWorld, "storylines").filter((entry) => storylineMatch(semantic, entry)), `$.facts[${index}] storyline`);
      if (matched.error) return reject(candidate, receipt, raw, matched.error);
      if (matched.match) {
        if (lower(matched.match.status) !== semantic.status || Number(matched.match.pressure) !== Number(raw.pressure) || Number(matched.match.momentum) !== Number(raw.momentum)) {
          return reject(candidate, receipt, raw, factError(index, `conflicts with existing authoritative storyline ${matched.match.id} state.`));
        }
        receipt.facts.push(receiptOutcome(raw, "merged", matched.match.id, "Existing authoritative storyline baseline retained."));
      } else {
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
        compiled.storylines.push(built.record);
        receipt.facts.push(receiptOutcome(raw, "applied", id));
      }
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
      const duplicateKey = `puppet|${lower(overlord)}>${lower(puppet)}`;
      if (candidateIdentity.has(duplicateKey)) return reject(candidate, receipt, raw, factError(index, "duplicates another candidate puppet identity."));
      candidateIdentity.add(duplicateKey);
      const semantic = { ...raw, overlord, puppet };
      const matched = uniqueMatch(existingArray(baseWorld, "puppets").filter((entry) => puppetMatch(semantic, entry)), `$.facts[${index}] puppet`);
      if (matched.error) return reject(candidate, receipt, raw, matched.error);
      if (matched.match) {
        const sameState = lower(matched.match.kind) === lower(raw.puppetKind) &&
          Number(matched.match.loyalty) === Math.max(0, Math.min(100, Math.round(Number(raw.loyalty)))) &&
          lower(matched.match.secrecy) === lower(raw.secrecy);
        if (!sameState) return reject(candidate, receipt, raw, factError(index, `conflicts with existing authoritative puppet ${matched.match.id} state.`));
        receipt.facts.push(receiptOutcome(raw, "merged", matched.match.id, "Existing authoritative puppet baseline retained."));
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
        compiled.puppets.push(built.record);
        receipt.facts.push(receiptOutcome(raw, "applied", id));
      }
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

  // War scheduler mirrors are derived native records, not model facts. Exact id
  // compatibility is accepted; participant-based legacy matching is deliberately
  // not used because it can collapse distinct conflicts.
  for (const warMeta of warMetaByRef.values()) {
    const war = warMeta.war;
    const mirrorId = `storyline-${clean(war?.id)}`;
    const exact = existingArray(baseWorld, "storylines").find((entry) => clean(entry?.id) === mirrorId) ||
      compiled.storylines.find((entry) => clean(entry?.id) === mirrorId) || null;
    const warParticipants = participantKey([...(war?.sideA || []), ...(war?.sideB || [])]);
    if (exact) {
      if (lower(exact.kind) !== "war" || participantKey(exact.participants) !== warParticipants) {
        return reject(candidate, receipt, null, `Derived war mirror ${mirrorId} conflicts with an existing storyline id.`);
      }
      receipt.derived.push({ kind: "war-storyline", sourceFactRef: warMeta.ref, outcome: "merged", canonicalId: mirrorId });
      continue;
    }
    const legacyPotential = existingArray(baseWorld, "storylines").filter((entry) =>
      lower(entry?.kind) === "war" && participantKey(entry?.participants) === warParticipants
    );
    if (legacyPotential.length) {
      return reject(candidate, receipt, null, `War ${war.id} has ${legacyPotential.length} participant-matched legacy war storyline(s) but no exact ${mirrorId}; automatic participant-based reconciliation is forbidden.`);
    }
    const builtMirror = buildPregameWarStorylineMirrorRecord({
      war,
      assessment: warMeta.assessment,
      observedDate: startDate,
      round,
    });
    if (builtMirror.error) return reject(candidate, receipt, null, builtMirror.error);
    if (occupiedIds.has(builtMirror.record.id)) return reject(candidate, receipt, null, `Derived war mirror id ${builtMirror.record.id} collides with unrelated canonical state.`);
    occupiedIds.add(builtMirror.record.id);
    compiled.storylines.push(builtMirror.record);
    receipt.derived.push({ kind: "war-storyline", sourceFactRef: warMeta.ref, outcome: "applied", canonicalId: builtMirror.record.id });
  }

  const puppetRows = [...existingArray(baseWorld, "puppets"), ...compiled.puppets];
  const puppetError = validatePuppetGraph(puppetRows);
  if (puppetError) return reject(candidate, receipt, null, puppetError);

  let projectedWorld = projectWorld(baseWorld, compiled);
  const storylineMerge = mergePregameStorylineBaselines({ world: projectedWorld, records: compiled.storylines });
  if (storylineMerge.error) return reject(candidate, receipt, null, storylineMerge.error);

  // Project through the real persisted-world normalizer before declaring the
  // receipt conserved. This catches capacity eviction, pair/id dedupe and any
  // other save-shape normalization that would otherwise make a successful
  // compiler result lossy at publication time. Existing authoritative canon is
  // conserved too: Round Zero may add or merge, never evict unrelated records.
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
    const familyIds = finalIds[outcome.kind];
    if (!outcome.canonicalId || !familyIds?.has(outcome.canonicalId)) {
      return reject(candidate, receipt, null, `Round-Zero receipt lost ${outcome.kind} fact ${outcome.ref}: canonical id ${outcome.canonicalId || "<blank>"} is absent from projected final state.`);
    }
  }
  for (const derived of receipt.derived) {
    const familyIds = derived.kind === "war-storyline" ? finalIds.storyline : null;
    if (!derived.canonicalId || !familyIds?.has(derived.canonicalId)) {
      return reject(candidate, receipt, null, `Round-Zero receipt lost derived ${derived.kind}: canonical id ${derived.canonicalId || "<blank>"} is absent from projected final state.`);
    }
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
