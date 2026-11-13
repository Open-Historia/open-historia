/*! Open Historia - editing canonical agreements already present in a scenario. */

import { compareGameDates, parseGameDate } from "./gameDates.js";
import { collectScenarioPoliticalPolities, createScenarioPolityResolver } from "./scenarioPolities.js";
import { AGREEMENT_STATUS_VALUES, AGREEMENT_TYPE_VALUES, pregameAgreementRoleKey } from "../Game/AI/nativeDiplomaticDirector.js";

const clean = (value) => String(value ?? "").trim();
const list = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const lower = (value) => clean(value).toLocaleLowerCase();
const FIELDS = new Set(["title", "type", "parties", "terms", "guarantor", "beneficiary", "grantor", "grantee", "reciprocalAccess", "startedDate", "endedDate"]);

export const scenarioCanonicalAgreements = (world = {}) => clone(list(world?.agreements));
export const sameScenarioCanonicalAgreements = (left, right) => JSON.stringify(list(left)) === JSON.stringify(list(right));

const findUnique = (agreements, id) => {
  const matches = list(agreements).map((row, index) => ({ row, index })).filter(({ row }) => clean(row?.id) === id);
  if (!id || matches.length !== 1) throw new Error("Agreement cannot be edited without one unique canonical ID.");
  return matches[0];
};

// Only author-facing fields may be changed. Identity, event provenance, lifecycle
// metadata and unknown legacy extensions stay owned by the original ledger.
export const editScenarioCanonicalAgreement = (agreements, id, patch) => {
  const { index } = findUnique(agreements, clean(id));
  if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
    Object.keys(patch).some((key) => !FIELDS.has(key))) throw new Error("Agreement patch contains an unsupported field.");
  return list(agreements).map((row, at) => at === index ? { ...row, ...patch } : row);
};

export const changeScenarioCanonicalAgreementType = (agreements, id, type) => {
  if (!AGREEMENT_TYPE_VALUES.includes(type)) throw new Error("Unknown canonical agreement type.");
  const { row } = findUnique(agreements, clean(id));
  const next = { ...row, type };
  for (const key of ["guarantor", "beneficiary", "grantor", "grantee", "reciprocalAccess"]) delete next[key];
  if (type === "guarantee") {
    next.guarantor = clean(row.parties?.[0]);
    next.beneficiary = clean(row.parties?.[1]);
  } else if (type === "military_access") {
    // Do not infer the direction of a new access grant from party ordering.
    next.grantor = "";
    next.grantee = "";
    next.reciprocalAccess = false;
  }
  return list(agreements).map((item) => item === row ? next : item);
};

export const changeScenarioCanonicalAccessReciprocal = (agreements, id, reciprocal) => {
  const { row } = findUnique(agreements, clean(id));
  if (row.type !== "military_access") throw new Error("Selected agreement does not grant military access.");
  const next = { ...row };
  delete next.grantor;
  delete next.grantee;
  next.reciprocalAccess = reciprocal === true;
  if (!reciprocal) {
    next.grantor = "";
    next.grantee = "";
  }
  return list(agreements).map((item) => item === row ? next : item);
};

export const removeScenarioCanonicalAgreement = (agreements, id) => {
  const { index } = findUnique(agreements, clean(id));
  return list(agreements).filter((_, at) => at !== index);
};

const prehistoryStartingAgreements = (prehistory) => [
  ...list(prehistory?.updates?.agreementUpdates).filter((row) => lower(row?.op || "start") === "start"),
  ...list(prehistory?.updates?.canonicalUpdates).filter((row) => row?.kind === "agreement"),
];

// Editing a scenario's world ledger cannot silently remove a treaty that a
// second Round-Zero source would recreate when a new campaign is opened.
const restoredByPrehistory = (agreement, prehistory, world) => {
  const type = lower(agreement?.type);
  const role = pregameAgreementRoleKey(agreement, world);
  return prehistoryStartingAgreements(prehistory).some((row) => {
    if (clean(row?.id) && clean(row.id) === clean(agreement.id)) return true;
    if (lower(row?.type) !== type) return false;
    const candidate = row?.reciprocal === true ? { ...row, reciprocalAccess: true } : row;
    return pregameAgreementRoleKey(candidate, world) === role;
  });
};

const agreementError = (id, problem) => ({ id, problem });

export const validateScenarioCanonicalAgreementEdits = ({
  original = [], draft = [], world = {}, prehistory = null, startDate = "",
} = {}) => {
  const source = list(original);
  const edited = list(draft);
  const errors = [];
  const ids = new Set();
  const originalById = new Map();
  const sourceCounts = new Map();
  for (const row of source) {
    const id = clean(row?.id);
    if (id) {
      sourceCounts.set(id, (sourceCounts.get(id) || 0) + 1);
      originalById.set(id, row);
    }
  }
  // Native code caps world.agreements at 128. Never rely on its truncation
  // to mask invalid edits or erase the tail of an authored baseline.
  if (edited.length > 128 && !sameScenarioCanonicalAgreements(source, edited)) {
    errors.push(agreementError("", "A scenario may contain at most 128 canonical agreements."));
  }

  // Opaque legacy rows with no unique ID must survive any other edit unchanged.
  const protectedRows = source.filter((row) => !clean(row?.id) || sourceCounts.get(clean(row.id)) !== 1);
  for (const row of protectedRows) {
    const matchCount = (rows) => rows.filter((item) => JSON.stringify(item) === JSON.stringify(row)).length;
    if (matchCount(edited) !== matchCount(source)) {
      errors.push(agreementError(clean(row?.id), "Legacy agreements without unique IDs cannot be changed or removed here."));
      break;
    }
  }

  const roster = new Map(collectScenarioPoliticalPolities(world).map(({ polityKey }) => [lower(polityKey), polityKey]));
  const resolveAlias = createScenarioPolityResolver(world);

  for (const [index, entry] of edited.entries()) {
    const id = clean(entry?.id);
    // Legacy malformed rows are preserved, not rewritten or silently dropped.
    // They cannot be edited or removed without first receiving valid identity.
    if ((!id || sourceCounts.get(id) !== 1) &&
      JSON.stringify(entry) === JSON.stringify(source[index])) continue;
    if (!id || !originalById.has(id) || ids.has(id) || sourceCounts.get(id) !== 1) {
      errors.push(agreementError(id, "Agreements must retain their unique existing canonical IDs."));
      continue;
    }
    ids.add(id);
    const originalRow = originalById.get(id);
    const changed = JSON.stringify(entry) !== JSON.stringify(originalRow);
    if (!changed) continue;
    const fail = (message) => errors.push(agreementError(id, message));
    for (const key of new Set([...Object.keys(originalRow), ...Object.keys(entry)])) {
      if (!FIELDS.has(key) && JSON.stringify(originalRow[key]) !== JSON.stringify(entry[key])) {
        fail("Cannot change canonical IDs, lifecycle metadata or event provenance.");
        break;
      }
    }
    if (!clean(entry.title) || clean(entry.title).length > 180) fail("Title must contain 1 to 180 characters.");
    if (clean(entry.terms).length > 600) fail("Terms cannot exceed 600 characters.");
    if (!AGREEMENT_TYPE_VALUES.includes(entry.type)) fail("Choose a supported canonical agreement type.");
    if (!AGREEMENT_STATUS_VALUES.includes(entry.status)) fail("Agreement has an unsupported lifecycle status.");
    const dates = [clean(entry.startedDate), clean(entry.endedDate)];
    for (const date of dates) if (date && !parseGameDate(date)) fail("Agreement dates must use YYYY-MM-DD.");
    if (parseGameDate(startDate)) {
      for (const date of dates) if (parseGameDate(date) && compareGameDates(date, startDate) > 0) fail("Agreement dates cannot be later than the scenario start.");
    }
    if (dates.every(parseGameDate) && compareGameDates(dates[0], dates[1]) > 0) fail("Agreement end date cannot precede its start.");
    if (["active", "suspended"].includes(entry.status) && dates[1]) fail("A standing agreement cannot have an end date.");

    // Original canonical parties remain valid editing references even if this
    // legacy scenario no longer lists them in its active polity roster.
    const originalNames = new Map([
      ...list(originalRow?.parties), originalRow?.guarantor, originalRow?.beneficiary,
      originalRow?.grantor, originalRow?.grantee,
    ].map((value) => [lower(value), clean(value)]).filter(([key]) => key));
    const canonical = (value) => {
      const token = clean(value);
      const resolved = resolveAlias(token);
      return roster.get(lower(resolved)) || originalNames.get(lower(token)) || originalNames.get(lower(resolved)) || "";
    };
    const parties = [];
    const addParty = (value) => {
      const name = canonical(value);
      if (!name) fail("Agreement references an unknown scenario country.");
      else if (parties.some((existing) => lower(existing) === lower(name))) fail("Agreement parties and directional roles must be distinct.");
      else parties.push(name);
    };
    const legacyUndirectedAccess = entry.type === "military_access" && originalRow.type === "military_access" &&
      !clean(originalRow.grantor) && !clean(originalRow.grantee) && originalRow.reciprocalAccess !== true &&
      !clean(entry.grantor) && !clean(entry.grantee) && entry.reciprocalAccess !== true;
    if (entry.type === "guarantee") {
      addParty(entry.guarantor);
      addParty(entry.beneficiary);
    } else if (entry.type === "military_access" && entry.reciprocalAccess !== true && !legacyUndirectedAccess) {
      addParty(entry.grantor);
      addParty(entry.grantee);
    } else {
      if (!Array.isArray(entry.parties) || entry.parties.length < 2 || entry.parties.length > 12) {
        fail("An agreement must have 2 to 12 participating countries.");
      } else for (const party of entry.parties) addParty(party);
      if (entry.type === "military_access" && parties.length !== 2) fail("Reciprocal military access requires exactly two countries.");
    }
    if (parties.length < 2 || parties.length > 12) fail("An agreement needs at least two different countries.");
    if (errors.some((error) => error.id === id)) continue;
  }

  for (const originalRow of source) {
    const id = clean(originalRow?.id);
    if (id && sourceCounts.get(id) === 1 && !ids.has(id) &&
      restoredByPrehistory(originalRow, prehistory, world)) {
      errors.push(agreementError(id, "This agreement also exists in Pre-history. Remove its Day-one fact before removing this canonical agreement."));
    }
  }
  if (errors.length) return { agreements: null, errors };

  const canon = list(edited).map((row) => {
    const id = clean(row?.id);
    if (!id || sourceCounts.get(id) !== 1) return row;
    const originalRow = originalById.get(id);
    if (JSON.stringify(row) === JSON.stringify(originalRow)) return row;
    const canonical = (value) => {
      const alias = resolveAlias(clean(value));
      return roster.get(lower(alias)) ||
        [...list(originalRow.parties), originalRow.guarantor, originalRow.beneficiary, originalRow.grantor, originalRow.grantee]
          .map(clean).find((name) => lower(name) === lower(value) || lower(name) === lower(alias));
    };
    const next = { ...row };
    // The historical generator sometimes recorded access without a direction.
    // Editing its wording must not fabricate a grantor or reciprocal agreement.
    const legacyUndirectedAccess = row.type === "military_access" && originalRow.type === "military_access" &&
      !clean(originalRow.grantor) && !clean(originalRow.grantee) && originalRow.reciprocalAccess !== true &&
      !clean(row.grantor) && !clean(row.grantee) && row.reciprocalAccess !== true;
    if (row.type === "guarantee") {
      next.guarantor = canonical(row.guarantor);
      next.beneficiary = canonical(row.beneficiary);
      next.parties = [next.guarantor, next.beneficiary];
      delete next.grantor; delete next.grantee; delete next.reciprocalAccess;
    } else if (row.type === "military_access" && row.reciprocalAccess !== true && !legacyUndirectedAccess) {
      next.grantor = canonical(row.grantor);
      next.grantee = canonical(row.grantee);
      next.parties = [next.grantor, next.grantee];
      next.reciprocalAccess = false;
      delete next.guarantor; delete next.beneficiary;
    } else {
      next.parties = row.parties.map(canonical);
      for (const key of ["guarantor", "beneficiary", "grantor", "grantee"]) delete next[key];
      if (row.type !== "military_access") delete next.reciprocalAccess;
    }
    return next;
  });
  // A canonical ledger cannot hold two IDs for the same instrument identity.
  const signatures = new Map();
  for (const row of canon) {
    if (lower(row.status) !== "active") continue;
    const signature = pregameAgreementRoleKey(row, world) + "|" + lower(row.title);
    const old = signatures.get(signature);
    const touched = (entry) => sourceCounts.get(clean(entry?.id)) === 1 &&
      JSON.stringify(entry) !== JSON.stringify(originalById.get(clean(entry.id)));
    if (old && old !== row.id &&
      (touched(row) || touched(canon.find((entry) => entry.id === old)))) {
      errors.push(agreementError(row.id, "Another active canonical agreement already has the same type, roles and title."));
    }
    signatures.set(signature, row.id);
  }
  return errors.length ? { agreements: null, errors } : { agreements: canon, errors: [] };
};
