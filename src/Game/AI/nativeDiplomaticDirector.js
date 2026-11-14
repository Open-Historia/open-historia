// Open Historia — native diplomatic state director (from kernely's Continuum branch).
//
// What it owns:
// - sparse canonical bilateral relations (world.relations)
// - formal agreements / alliances / guarantees (world.agreements)
// - bounded diplomatic context for AI attention
// - compact relation/agreement update transport
//
// Design rule: persistent world, bounded attention. The save may remember many
// diplomatic facts; any one AI request sees only the relevant slice.
//
// A record is tied to its events by the numbers the model wrote, read once by
// ledgerPins.js while they still mean what the model meant, and never by what
// its words have in common with an event's: the game is written in the
// player's language, and a match on words is a match only in English. A
// record a skip tied to no event is still the skip's record: it is applied,
// dated by the skip (applyRelationUpdates, applyAgreementUpdates,
// applyPuppetUpdates).
//
// Nothing is read out of prose. A save from before the ledgers keeps the
// relations and agreements its records hold (an empty ledger is a sparse one:
// DIPLOMATIC_SLICE_RULES); its old treaty events and chats are history, not
// records.

import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { MAX_PUPPETS, PUPPET_COUP_LOYALTY, PUPPET_KINDS } from "../../runtime/puppets.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity, buildPolityIdentityIndex } from "../../runtime/polityIdentity.js";
import { compareGameDates, isGameDate } from "../../runtime/gameDates.js";
import { receiptPlayerNote } from "../../runtime/receiptPlayerNotes.js";
import { hasMalformedRelationSummary as relationSummaryHasReservedSeparator } from "../../runtime/relationSummary.js";

export const DIPLOMATIC_LEDGER_VERSION = 1;
export const DIPLOMATIC_DIRECTOR_VERSION = "0.1.7-round-zero-baseline";

const SEP = "~";
const MAX_RELATION_UPDATES_PER_PASS = 20;
const MAX_AGREEMENT_UPDATES_PER_PASS = 16;
const MAX_RELATIONS = 256;
const MAX_AGREEMENTS = 128;
const MAX_CONTEXT_ACTORS = 8;
const MAX_CONTEXT_RELATIONS = 16;
const MAX_CONTEXT_AGREEMENTS = 12;

export const RELATION_STATUS_VALUES = Object.freeze([
  "friendly",
  "cordial",
  "neutral",
  "cautious",
  "strained",
  "hostile",
  "rival",
]);

export const AGREEMENT_TYPE_VALUES = Object.freeze([
  "alliance",
  "mutual_defense",
  "guarantee",
  "non_aggression",
  "friendship_consultation",
  "trade_economic",
  "military_cooperation",
  "military_access",
  "neutrality",
  "peace_settlement",
  "other",
]);

export const AGREEMENT_STATUS_VALUES = Object.freeze([
  "active",
  "suspended",
  "ended",
  "expired",
]);

const RELATION_STATUS_SET = new Set(RELATION_STATUS_VALUES);
const AGREEMENT_TYPE_SET = new Set(AGREEMENT_TYPE_VALUES);
const AGREEMENT_STATUS_SET = new Set(AGREEMENT_STATUS_VALUES);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const lower = (value) => clean(value).toLocaleLowerCase();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const unique = (values, limit = 64) => {
  const seen = new Set();
  const out = [];
  for (const raw of array(values)) {
    const value = clean(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

// The text back when it is a game date (BC included, runtime/gameDates.js), else "".
const parseIsoDate = (value) => {
  const text = clean(value);
  return isGameDate(text) ? text : "";
};

const slug = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80);

const stableHash = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// A title as it is compared: case, accents and punctuation folded away. The
// letters, marks and digits of every script are kept. Folded to a-z0-9, a
// title written in Cyrillic, Arabic or Chinese had no key at all, so every
// such title was the same title ("Договор о дружбе…" and "Договор о создании
// Союзного государства" were both ""), and one with a year in it was that
// year. A title in ASCII has the key it always had, and so does one whose
// accents this fold takes off ("Traité de Paris").
const pregameTitleKey = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const pregameSourceIdsContain = (superset, required) => {
  const values = new Set(array(superset).map(clean).filter(Boolean));
  return array(required).map(clean).filter(Boolean).every((id) => values.has(id));
};

// `identityIndex`: the polity identity index of this same world, for a caller
// resolving many names against it (buildBoundedDiplomaticContext).
export const canonicalDiplomaticPolity = (token, world, { allowUnknown = false, identityIndex = null } = {}) => {
  const raw = clean(token);
  if (!raw) return "";
  const resolved = resolvePolityIdentity(raw, world, {
    allowUnknown,
    requireActive: false,
    allowStockBase: true,
    identityIndex,
  });
  if (resolved?.resolved) return clean(resolved.resolved);
  if (!allowUnknown) return "";
  return clean(toCountryName(raw)) || raw;
};

export const diplomaticDisplayName = (world, canonicalKey) => {
  const key = clean(canonicalKey);
  if (!key) return "";
  const direct = world?.polityOverrides?.[key];
  if (clean(direct?.name)) return clean(direct.name);
  for (const [candidateKey, polity] of Object.entries(world?.polityOverrides || {})) {
    if (lower(candidateKey) !== lower(key)) continue;
    return clean(polity?.name) || clean(candidateKey);
  }
  return key;
};

export const relationPairKey = (a, b, world = null) => {
  const left = world ? canonicalDiplomaticPolity(a, world, { allowUnknown: true }) : clean(a);
  const right = world ? canonicalDiplomaticPolity(b, world, { allowUnknown: true }) : clean(b);
  if (!left || !right || lower(left) === lower(right)) return "";
  return [left, right]
    .sort((x, y) => lower(x).localeCompare(lower(y)))
    .map((value) => lower(value))
    .join("||");
};

export const relationIdForPair = (a, b, world = null) => {
  const key = relationPairKey(a, b, world);
  return key ? `relation-${stableHash(key)}` : "";
};

// The numeric score is the canonical bilateral-climate value. Status is a
// deterministic presentation/reasoning band derived from that score, never a
// second independently authoritative opinion. This prevents contradictory
// states such as +25 / strained and +18 / cordial.
const normalizeRelationStatus = (_value, score = 0) => {
  const numeric = clamp(Math.round(Number(score) || 0), -100, 100);
  if (numeric >= 55) return "friendly";
  if (numeric >= 20) return "cordial";
  if (numeric >= -10) return "neutral";
  if (numeric >= -30) return "cautious";
  if (numeric >= -60) return "strained";
  if (numeric > -90) return "hostile";
  return "rival";
};
// The band a relation's score puts it in, for readers outside the director
// (targetDossier.js).
export const relationStatusForScore = (score) => normalizeRelationStatus("", score);

// Band order and midpoints, for comparing a DECLARED status against the band
// the score implies.
const RELATION_BAND_ORDER = ["rival", "hostile", "strained", "cautious", "neutral", "cordial", "friendly"];
const RELATION_BAND_MIDPOINT = { rival: -95, hostile: -75, strained: -45, cautious: -20, neutral: 5, cordial: 37, friendly: 77 };
const relationBandIndex = (status) => RELATION_BAND_ORDER.indexOf(lower(status));

// The model sometimes writes a magnitude ("35" beside status strained) or a
// delta where the contract asks for the absolute new score; trusting the number
// alone once flipped a hostile pair to cordial in one turn. When the declared
// status contradicts the score by two bands or more, reconcile: flip the sign
// when that agrees with the status, otherwise take the declared band's midpoint.
export const reconcileRelationScoresWithStatus = (updates) => {
  const repaired = [];
  const records = decodeRelationUpdates(updates).map((update) => {
    const declared = relationBandIndex(update.declaredStatus);
    if (declared < 0 || !Number.isFinite(update.score)) return update;
    const implied = relationBandIndex(normalizeRelationStatus("", update.score));
    if (Math.abs(declared - implied) < 2) return update;
    const flipped = -update.score;
    const flippedBand = relationBandIndex(normalizeRelationStatus("", flipped));
    const score = Math.abs(flippedBand - declared) <= 1
      ? flipped
      : RELATION_BAND_MIDPOINT[RELATION_BAND_ORDER[declared]];
    repaired.push({
      a: update.a,
      b: update.b,
      declared: RELATION_BAND_ORDER[declared],
      implied: RELATION_BAND_ORDER[implied],
      from: update.score,
      to: score,
    });
    return { ...update, score, status: normalizeRelationStatus("", score) };
  });
  return { records, repaired };
};

const normalizeAgreementType = (value) => {
  const type = lower(value).replace(/[ -]+/g, "_");
  return AGREEMENT_TYPE_SET.has(type) ? type : "other";
};

const normalizeAgreementStatus = (value, fallback = "active") => {
  const status = lower(value);
  return AGREEMENT_STATUS_SET.has(status) ? status : fallback;
};

const normalizedRelations = (world) => array(normalizeWorldState(world)?.relations)
  .map((entry) => entry && typeof entry === "object"
    ? { ...entry, status: normalizeRelationStatus(entry.status, entry.score) }
    : null)
  .filter(Boolean)
  .slice(0, MAX_RELATIONS);

const normalizedAgreements = (world) => array(normalizeWorldState(world)?.agreements)
  .map((entry) => entry && typeof entry === "object" ? entry : null)
  .filter(Boolean)
  .slice(0, MAX_AGREEMENTS);

// Pure Round-Zero constructors. The bootstrap compiler resolves identity and
// decides whether a fact reuses existing canon; these helpers own only the
// persisted diplomatic record shapes and domain-specific validation. They do
// not replay normal-turn lifecycle operations.
export const buildPregameRelationBaselineRecord = ({
  id = "",
  a = "",
  b = "",
  score = null,
  summary = "",
  sourceEventIds = [],
  observedDate = "",
  round = 1,
  world = {},
} = {}) => {
  const left = canonicalDiplomaticPolity(a, world);
  const right = canonicalDiplomaticPolity(b, world);
  const pairKey = relationPairKey(left, right);
  const numeric = Number(score);
  if (!left || !right || !pairKey) return { record: null, error: "Round-Zero relation requires two distinct current polities." };
  if (!Number.isFinite(numeric)) return { record: null, error: `Round-Zero relation ${left} ↔ ${right} requires a finite absolute score.` };
  if (relationSummaryHasReservedSeparator(summary)) return { record: null, error: `Round-Zero relation ${left} ↔ ${right} has a summary containing a reserved compact-record separator.` };
  const ordered = [left, right].sort((x, y) => lower(x).localeCompare(lower(y)));
  const clamped = clamp(Math.round(numeric), -100, 100);
  const date = clean(observedDate);
  if (date && !isGameDate(date)) return { record: null, error: `Round-Zero relation ${left} ↔ ${right} has an invalid observed date.` };
  return {
    record: {
      id: clean(id) || relationIdForPair(ordered[0], ordered[1]),
      a: ordered[0],
      b: ordered[1],
      score: clamped,
      status: normalizeRelationStatus("", clamped),
      summary: clean(summary),
      lastUpdatedDate: date,
      sourceEventIds: unique(sourceEventIds, 24),
      createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    },
    error: "",
  };
};

export const buildPregameAgreementBaselineRecord = ({
  id = "",
  type = "",
  title = "",
  parties = [],
  guarantor = "",
  beneficiary = "",
  grantor = "",
  grantee = "",
  reciprocalAccess = false,
  startedDate = "",
  terms = "",
  sourceEventIds = [],
  observedDate = "",
  round = 1,
  world = {},
} = {}) => {
  const canonicalId = clean(id);
  const agreementType = normalizeAgreementType(type);
  const start = clean(startedDate);
  const observed = clean(observedDate);
  if (!canonicalId) return { record: null, error: "Round-Zero agreement requires a native canonical id." };
  if (!clean(title)) return { record: null, error: `Round-Zero agreement ${canonicalId} requires a title.` };
  if (start && !isGameDate(start)) return { record: null, error: `Round-Zero agreement ${canonicalId} has an invalid startedDate.` };
  if (observed && !isGameDate(observed)) return { record: null, error: `Round-Zero agreement ${canonicalId} has an invalid observed date.` };

  let canonicalParties;
  let directionalFields = {};
  if (agreementType === "guarantee") {
    const g = canonicalDiplomaticPolity(guarantor, world);
    const beneficiaryPolity = canonicalDiplomaticPolity(beneficiary, world);
    if (!g || !beneficiaryPolity || lower(g) === lower(beneficiaryPolity)) {
      return { record: null, error: `Round-Zero guarantee ${canonicalId} requires distinct guarantor and beneficiary roles.` };
    }
    canonicalParties = [g, beneficiaryPolity];
    directionalFields = { guarantor: g, beneficiary: beneficiaryPolity };
  } else if (agreementType === "military_access") {
    if (reciprocalAccess === true) {
      canonicalParties = canonicalizeParties(parties, world);
      if (canonicalParties.length !== 2) {
        return { record: null, error: `Round-Zero reciprocal military access ${canonicalId} requires exactly two current parties.` };
      }
      directionalFields = { reciprocalAccess: true };
    } else {
      const accessGrantor = canonicalDiplomaticPolity(grantor, world);
      const accessGrantee = canonicalDiplomaticPolity(grantee, world);
      if (!accessGrantor || !accessGrantee || lower(accessGrantor) === lower(accessGrantee)) {
        return { record: null, error: `Round-Zero military access ${canonicalId} requires distinct grantor and grantee roles or explicit reciprocal access.` };
      }
      canonicalParties = [accessGrantor, accessGrantee];
      directionalFields = { grantor: accessGrantor, grantee: accessGrantee, reciprocalAccess: false };
    }
  } else {
    canonicalParties = canonicalizeParties(parties, world);
    if (canonicalParties.length < 2) {
      return { record: null, error: `Round-Zero agreement ${canonicalId} requires at least two current parties.` };
    }
  }

  return {
    record: {
      id: canonicalId,
      title: clean(title),
      type: agreementType,
      status: "active",
      parties: canonicalParties,
      startedDate: start,
      endedDate: "",
      lastUpdatedDate: observed || start,
      terms: clean(terms),
      ...directionalFields,
      sourceEventIds: unique(sourceEventIds, 24),
      createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    },
    error: "",
  };
};

const pregamePartySetKey = (parties, world = null) => unique(
  array(parties)
    .map((party) => world ? canonicalDiplomaticPolity(party, world, { allowUnknown: true }) : clean(party))
    .filter(Boolean),
  12,
).map(lower).sort().join("|");

export const pregameAgreementRoleKey = (agreement, world = null) => {
  const type = normalizeAgreementType(agreement?.type);
  if (type === "guarantee") {
    const guarantor = world ? canonicalDiplomaticPolity(agreement?.guarantor || agreement?.parties?.[0], world, { allowUnknown: true }) : clean(agreement?.guarantor || agreement?.parties?.[0]);
    const beneficiary = world ? canonicalDiplomaticPolity(agreement?.beneficiary || agreement?.parties?.[1], world, { allowUnknown: true }) : clean(agreement?.beneficiary || agreement?.parties?.[1]);
    return guarantor && beneficiary ? `${type}|${lower(guarantor)}>${lower(beneficiary)}` : `${type}|unknown`;
  }
  if (type === "military_access") {
    if (agreement?.reciprocalAccess === true) return `${type}|reciprocal|${pregamePartySetKey(agreement?.parties, world)}`;
    const grantor = world ? canonicalDiplomaticPolity(agreement?.grantor, world, { allowUnknown: true }) : clean(agreement?.grantor);
    const grantee = world ? canonicalDiplomaticPolity(agreement?.grantee, world, { allowUnknown: true }) : clean(agreement?.grantee);
    if (grantor && grantee) return `${type}|${lower(grantor)}>${lower(grantee)}`;
    return `${type}|legacy|${pregamePartySetKey(agreement?.parties, world)}`;
  }
  return `${type}|${pregamePartySetKey(agreement?.parties, world)}`;
};

export const resolvePregameRelationBaselineMatch = ({ records = [], a = "", b = "", world = {} } = {}) => {
  const pair = relationPairKey(a, b, world);
  if (!pair) return { match: null, error: "Round-Zero relation resolver requires two distinct current polities." };
  const matches = array(records).filter((entry) => relationPairKey(entry?.a, entry?.b, world) === pair);
  if (matches.length > 1) return { match: null, error: "Round-Zero relation pair matches multiple canonical records." };
  return { match: matches[0] || null, error: "" };
};

export const mergePregameRelationBaselineRecord = ({ existing = null, incoming = null } = {}) => {
  if (!existing || !incoming || clean(existing.id) !== clean(incoming.id)) return { record: null, error: "Round-Zero relation merge requires the same canonical id." };
  if (relationPairKey(existing.a, existing.b) !== relationPairKey(incoming.a, incoming.b)) return { record: null, error: `Round-Zero relation ${existing.id} changes canonical pair identity.` };
  if (Math.round(Number(existing.score)) !== Math.round(Number(incoming.score))) return { record: null, error: `Round-Zero relation ${existing.id} conflicts on absolute score.` };
  return {
    record: {
      ...existing,
      summary: clean(existing.summary) || clean(incoming.summary),
      lastUpdatedDate: clean(existing.lastUpdatedDate) || clean(incoming.lastUpdatedDate),
      sourceEventIds: unique([...array(existing.sourceEventIds), ...array(incoming.sourceEventIds)], 24),
      createdRound: Math.max(0, Math.trunc(Number(existing.createdRound) || Number(incoming.createdRound) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(existing.updatedRound) || 0), Math.trunc(Number(incoming.updatedRound) || 0)),
    },
    error: "",
  };
};

export const pregameRelationBaselineCompatibilityError = (expected, actual, world = {}) => {
  if (!expected || !actual) return "relation record is missing";
  if (clean(expected.id) !== clean(actual.id)) return "relation id changed";
  if (relationPairKey(expected.a, expected.b, world) !== relationPairKey(actual.a, actual.b, world)) return "relation pair changed";
  if (Math.round(Number(expected.score)) !== Math.round(Number(actual.score))) return "relation score changed";
  if (!pregameSourceIdsContain(actual.sourceEventIds, expected.sourceEventIds)) return "relation provenance was not conserved";
  return "";
};

// Which agreement on record a Round-Zero fact is. Its type, its roles and its
// date say which instrument; the title is only how that instrument is worded.
//
// ONE active agreement of the same type, among the same roles, with no
// conflicting known date, is that agreement whatever the fact calls it. A model
// that restates canon writes the title in the game's language, not in the
// record's: a treaty the world already held came back as "Договор о дружбе,
// сотрудничестве и партнерстве между Российской Федерацией и Украиной", was
// refused as "the same roles/type/date already exist under a different
// canonical title", and took the whole Round-Zero answer with it, on both
// attempts, at every open of the game (a player's log, 2026-10-05: two
// requests each time and no pre-game history, for ever). Such a fact is now
// the match, marked `restated`: the caller keeps the canonical record's own
// words and creates nothing.
//
// MORE than one such agreement is a real ambiguity and is still an error. It is
// marked `ambiguous`, which lets the caller leave that one fact out on its last
// attempt instead of losing the answer. A single one that another fact of the
// same answer has already resolved to (`claimedIds`) is ambiguous too: two
// facts of one answer are not each other's restatement. So is one that has no
// title of its own to keep.
export const resolvePregameAgreementBaselineMatch = ({ records = [], candidate = null, world = {}, claimedIds = null } = {}) => {
  if (!candidate) return { match: null, error: "Round-Zero agreement resolver requires a candidate." };
  const type = normalizeAgreementType(candidate.type);
  const roleKey = pregameAgreementRoleKey(candidate, world);
  const title = pregameTitleKey(candidate.title);
  const date = clean(candidate.startedDate);
  const active = array(records).filter((entry) => normalizeAgreementStatus(entry?.status) === "active" && normalizeAgreementType(entry?.type) === type);
  const sameRoles = active.filter((entry) => pregameAgreementRoleKey(entry, world) === roleKey);
  const dateCompatible = (entry) => !date || !clean(entry?.startedDate) || clean(entry?.startedDate) === date;
  const possible = sameRoles.filter(dateCompatible);
  const exact = possible.filter((entry) => pregameTitleKey(entry?.title) === title);
  if (exact.length > 1) return { match: null, ambiguous: true, error: "Round-Zero agreement identity matches multiple canonical instruments." };
  if (exact.length === 1) return { match: exact[0], error: "" };

  const candidateParties = pregamePartySetKey(candidate.parties, world);
  const legacyDirectional = type === "military_access" && active.filter((entry) =>
    pregamePartySetKey(entry?.parties, world) === candidateParties &&
    pregameAgreementRoleKey(entry, world).includes("|legacy|") &&
    dateCompatible(entry)
  );
  if (legacyDirectional.length) return { match: null, error: "Round-Zero military-access identity is ambiguous because existing canon does not record grant direction." };
  if (possible.length === 1 && pregameTitleKey(possible[0]?.title) && !claimedIds?.has(clean(possible[0]?.id))) {
    return { match: possible[0], restated: true, error: "" };
  }
  if (possible.length) return { match: null, ambiguous: true, error: "Round-Zero agreement identity is ambiguous: the same roles/type/date already exist under a different canonical title." };
  return { match: null, error: "" };
};

export const mergePregameAgreementBaselineRecord = ({ existing = null, incoming = null, world = {} } = {}) => {
  if (!existing || !incoming || clean(existing.id) !== clean(incoming.id)) return { record: null, error: "Round-Zero agreement merge requires the same canonical id." };
  if (pregameAgreementRoleKey(existing, world) !== pregameAgreementRoleKey(incoming, world)) return { record: null, error: `Round-Zero agreement ${existing.id} changes canonical role identity.` };
  if (pregameTitleKey(existing.title) !== pregameTitleKey(incoming.title)) return { record: null, error: `Round-Zero agreement ${existing.id} changes canonical title identity.` };
  if (normalizeAgreementStatus(existing.status) !== "active" || normalizeAgreementStatus(incoming.status) !== "active") return { record: null, error: `Round-Zero agreement ${existing.id} is not an active baseline instrument.` };
  const existingDate = clean(existing.startedDate);
  const incomingDate = clean(incoming.startedDate);
  if (existingDate && incomingDate && existingDate !== incomingDate) return { record: null, error: `Round-Zero agreement ${existing.id} conflicts on known start date.` };
  const existingTerms = clean(existing.terms);
  const incomingTerms = clean(incoming.terms);
  if (existingTerms && incomingTerms && existingTerms !== incomingTerms) return { record: null, error: `Round-Zero agreement ${existing.id} conflicts on substantive terms.` };
  return {
    record: {
      ...existing,
      startedDate: existingDate || incomingDate,
      lastUpdatedDate: clean(existing.lastUpdatedDate) || clean(incoming.lastUpdatedDate) || existingDate || incomingDate,
      terms: existingTerms || incomingTerms,
      sourceEventIds: unique([...array(existing.sourceEventIds), ...array(incoming.sourceEventIds)], 24),
      ...(normalizeAgreementType(existing.type) === "guarantee" ? { guarantor: existing.guarantor || incoming.guarantor, beneficiary: existing.beneficiary || incoming.beneficiary } : {}),
      ...(normalizeAgreementType(existing.type) === "military_access" ? {
        ...(existing.reciprocalAccess === true || incoming.reciprocalAccess === true ? { reciprocalAccess: true } : { grantor: existing.grantor || incoming.grantor, grantee: existing.grantee || incoming.grantee, reciprocalAccess: false }),
      } : {}),
      updatedRound: Math.max(0, Math.trunc(Number(existing.updatedRound) || 0), Math.trunc(Number(incoming.updatedRound) || 0)),
    },
    error: "",
  };
};

export const pregameAgreementBaselineCompatibilityError = (expected, actual, world = {}) => {
  if (!expected || !actual) return "agreement record is missing";
  if (clean(expected.id) !== clean(actual.id)) return "agreement id changed";
  if (pregameAgreementRoleKey(expected, world) !== pregameAgreementRoleKey(actual, world)) return "agreement roles changed";
  if (pregameTitleKey(expected.title) !== pregameTitleKey(actual.title)) return "agreement title identity changed";
  if (clean(expected.startedDate) !== clean(actual.startedDate)) return "agreement start date was not conserved";
  if (clean(expected.terms) !== clean(actual.terms)) return "agreement terms were not conserved";
  if (!pregameSourceIdsContain(actual.sourceEventIds, expected.sourceEventIds)) return "agreement provenance was not conserved";
  return "";
};

const relationMapFromWorld = (world) => {
  const map = new Map();
  for (const relation of normalizedRelations(world)) {
    const key = relationPairKey(relation.a, relation.b, world);
    if (key) map.set(key, relation);
  }
  return map;
};

const agreementMapFromWorld = (world) =>
  new Map(normalizedAgreements(world).map((agreement) => [clean(agreement.id), agreement]));

const splitFixedFields = (value, cuts) => {
  const fields = [];
  let rest = clean(value);
  for (let i = 0; i < cuts; i += 1) {
    const pos = rest.indexOf(SEP);
    if (pos < 0) {
      fields.push(rest);
      rest = "";
      break;
    }
    fields.push(rest.slice(0, pos));
    rest = rest.slice(pos + 1);
  }
  while (fields.length < cuts) fields.push("");
  fields.push(rest);
  return fields;
};

const parseEventNumbers = (value) => String(value ?? "")
  .split(",")
  .map((part) => Number.parseInt(part.trim(), 10))
  .filter((number) => Number.isInteger(number) && number >= 1)
  .map((number) => number - 1)
  .slice(0, 16);

// A record is fields joined by the separator, so a line with none is not one.
// It is prose a model wrote where records go, a heading or "No changes."
// (nativeWarLedger.js has the report this comes from). Read as a record it was
// a relation between that sentence and nobody, which a strict pass refuses the
// whole answer over, and the salvage pass quoted it back in the next prompt.
const isRecordLine = (line) => String(line ?? "").includes(SEP);

const parseParties = (value) => unique(
  String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean),
  12,
);

const GENERATED_RELATION_UPDATE_ID_RE = /^relation-update-\d+$/i;

const decodeRelationLine = (line, index) => {
  const text = String(line ?? "");
  let rawParts = text.split(SEP);

  // A relation's generated update id is transport bookkeeping, NOT a polity.
  //
  // The canonical prompt asks for:
  //   A~B~score~status~eventNumbersCSV~summary
  //
  // On a structured-output retry some providers can faithfully echo the
  // Javascript-generated object id back into the compact line:
  //   relation-update-0~A~B~score~status~eventNumbersCSV~summary
  //
  // Before this repair the decoder shifted every field left, making
  // "relation-update-0" polity A and producing the fatal error:
  //   Relation update could not resolve both polities:
  //   "relation-update-0" / "Russian Federation"
  //
  // Strip ONLY our exact generated-id shape. Arbitrary leading fields remain
  // invalid and continue to fail closed.
  let transportId = "";
  if (
    rawParts.length >= 6 &&
    GENERATED_RELATION_UPDATE_ID_RE.test(clean(rawParts[0]))
  ) {
    transportId = clean(rawParts[0]);
    rawParts = rawParts.slice(1);
    console.warn(
      `[OH diplomacy transport repair] stripped generated relation update id ${transportId} ` +
      "from compact relation payload.",
    );
  }

  const normalizedText = rawParts.join(SEP);

  // World-generation no longer requires the model to count event numbers.
  // Accept the natural five-field form A~B~score~status~summary as well as the
  // legacy/current six-field form with eventNumbersCSV in slot 5.
  const [a, b, scoreRaw, status, eventNumbers, summary] =
    rawParts.length === 5
      ? [rawParts[0], rawParts[1], rawParts[2], rawParts[3], "", rawParts[4]]
      : splitFixedFields(normalizedText, 5);

  const score = Number(scoreRaw);
  const normalizedScore = Number.isFinite(score) ? clamp(Math.round(score), -100, 100) : null;
  return {
    id: transportId || `relation-update-${index}`,
    a: clean(a),
    b: clean(b),
    score: normalizedScore,
    status: normalizeRelationStatus(status, normalizedScore ?? 0),
    declaredStatus: lower(status),
    eventIndexes: parseEventNumbers(eventNumbers),
    eventIds: [],
    summary: clean(summary),
  };
};

// A figure a record left blank stays blank as an object too: Number(null) is 0,
// so a record tied to its events (ledgerPins.js, which hands every record on as
// an object) read a blank score as a relation at 0 and a blank loyalty as a
// client state at 0, where the line read them as "derive it" and 50.
const figureOrBlank = (value) => (value === null || value === undefined || (typeof value === "string" && !value.trim()) ? NaN : Number(value));

export const decodeRelationUpdates = (value, { limit = MAX_RELATION_UPDATES_PER_PASS } = {}) => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return isRecordLine(entry) ? decodeRelationLine(entry, index) : null;
      if (!entry || typeof entry !== "object") return null;
      const score = figureOrBlank(entry.score);
      const normalizedScore = Number.isFinite(score) ? clamp(Math.round(score), -100, 100) : null;
      return {
        id: clean(entry.id) || `relation-update-${index}`,
        a: clean(entry.a),
        b: clean(entry.b),
        score: normalizedScore,
        status: normalizeRelationStatus(entry.status, normalizedScore ?? 0),
        declaredStatus: lower(entry.declaredStatus || entry.status),
        eventIndexes: array(entry.eventIndexes).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 16),
        eventIds: unique(entry.eventIds, 24),
        summary: clean(entry.summary),
      };
    }).filter(Boolean).slice(0, limit);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => (isRecordLine(line) ? decodeRelationLine(line, index) : null))
    .filter((entry) => entry && (entry.a || entry.b || entry.summary))
    .slice(0, limit);
};

const decodeAgreementLine = (line, index) => {
  const text = String(line ?? "");
  const rawParts = text.split(SEP);

  // Accept both the seven-field record and the six-field form
  // id~op~type~parties~title~terms, which names no event (applied all the same,
  // dated by the skip: applyAgreementUpdates).
  const [id, op, type, parties, eventNumbers, title, terms] =
    rawParts.length === 6
      ? [rawParts[0], rawParts[1], rawParts[2], rawParts[3], "", rawParts[4], rawParts[5]]
      : splitFixedFields(text, 6);

  return {
    id: clean(id) || `agreement-${index}`,
    op: lower(op),
    type: normalizeAgreementType(type),
    parties: parseParties(parties),
    eventIndexes: parseEventNumbers(eventNumbers),
    eventIds: [],
    title: clean(title),
    terms: clean(terms),
  };
};

export const decodeAgreementUpdates = (value, { limit = MAX_AGREEMENT_UPDATES_PER_PASS } = {}) => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return isRecordLine(entry) ? decodeAgreementLine(entry, index) : null;
      if (!entry || typeof entry !== "object") return null;
      return {
        id: clean(entry.id) || `agreement-${index}`,
        op: lower(entry.op),
        type: normalizeAgreementType(entry.type),
        parties: unique(entry.parties, 12),
        eventIndexes: array(entry.eventIndexes).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 16),
        eventIds: unique(entry.eventIds, 24),
        title: clean(entry.title),
        terms: clean(entry.terms),
      };
    }).filter(Boolean).slice(0, limit);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => decodeAgreementLine(line, index))
    .filter((entry) => entry.id && entry.op)
    .slice(0, limit);
};

const bindEventIds = (updates, events) => {
  const normalizedEvents = normalizeEvents(events);
  return updates.map((update) => {
    const stableIds = unique(update.eventIds, 24);
    if (stableIds.length) return { ...update, eventIds: stableIds };
    return {
      ...update,
      eventIds: unique(
        array(update.eventIndexes)
          .map((index) => clean(normalizedEvents[index]?.id))
          .filter(Boolean),
        24,
      ),
    };
  });
};

export const bindRelationUpdatesToEvents = (updates, events, { limit } = {}) =>
  bindEventIds(decodeRelationUpdates(updates, { limit }), events);

export const bindAgreementUpdatesToEvents = (updates, events, { limit } = {}) =>
  bindEventIds(decodeAgreementUpdates(updates, { limit }), events);

const linkedEvents = (update, events) => {
  const byId = new Map(normalizeEvents(events).map((event) => [clean(event.id), event]));
  const result = [];
  for (const id of unique(update.eventIds, 24)) {
    const event = byId.get(id);
    if (event) result.push(event);
  }
  if (result.length) return result;
  const normalized = normalizeEvents(events);
  return array(update.eventIndexes).map((index) => normalized[index]).filter(Boolean);
};

const updateDate = (update, events, fallback = "") =>
  linkedEvents(update, events)
    .map((event) => parseIsoDate(event?.date))
    .filter(Boolean)
    .sort()[0] || parseIsoDate(fallback);

const canonicalizeParties = (parties, world) => unique(
  array(parties)
    .map((party) => canonicalDiplomaticPolity(party, world))
    .filter(Boolean),
  12,
);

const encodeRelationUpdates = (updates) => array(updates).map((update) => [
  clean(update?.a).replaceAll(SEP, "—"),
  clean(update?.b).replaceAll(SEP, "—"),
  Number.isFinite(Number(update?.score)) ? String(Math.round(Number(update.score))) : "",
  clean(update?.status).replaceAll(SEP, "—"),
  array(update?.eventIndexes).map((index) => Number(index) + 1).filter((n) => Number.isInteger(n) && n >= 1).join(","),
  clean(update?.summary).replaceAll(SEP, "—"),
].join(SEP)).join("\n");

const encodeAgreementUpdates = (updates) => array(updates).map((update) => [
  clean(update?.id).replaceAll(SEP, "—"),
  clean(update?.op).replaceAll(SEP, "—"),
  clean(update?.type).replaceAll(SEP, "—"),
  array(update?.parties).map((party) => clean(party).replaceAll(",", " ")).filter(Boolean).join(","),
  array(update?.eventIndexes).map((index) => Number(index) + 1).filter((n) => Number.isInteger(n) && n >= 1).join(","),
  clean(update?.title).replaceAll(SEP, "—"),
  clean(update?.terms).replaceAll(SEP, "—"),
].join(SEP)).join("\n");

const sameCanonicalPartySet = (left, right, world) => {
  const a = canonicalizeParties(left, world).map(lower).sort();
  const b = canonicalizeParties(right, world).map(lower).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

// World-generation models occasionally re-emit `start` for an agreement that is
// already canonical and active. That is a lifecycle bookkeeping mistake, not a
// reason to erase an otherwise-valid month. Repair ONLY when the stable id, the
// parties and the type are the existing instrument's. A truly conflicting reuse
// of an id remains fatal.
//
// The title is not compared. A model restating a pact writes its title in the
// game's language and in its own words, and an instrument is the same
// instrument whatever it is called this time: the record keeps its own title
// (applyAgreementUpdates). Titles were matched by the words they shared, and
// two wordings of one treaty shared none in a language that is not written in
// spaced words, or none at all once translated.
const normalizeDuplicateAgreementStarts = (candidate, world) => {
  if (!candidate || typeof candidate !== "object") return { repaired: 0, dropped: 0 };

  const wasString = typeof candidate?.agreementUpdates === "string";
  const existing = agreementMapFromWorld(world);
  const output = [];
  let repaired = 0;
  let dropped = 0;

  for (const update of decodeAgreementUpdates(candidate?.agreementUpdates)) {
    const prior = existing.get(clean(update?.id)) || null;
    if (update?.op !== "start" || !prior || ["ended", "expired"].includes(prior.status)) {
      output.push(update);
      continue;
    }

    const partiesCompatible = !array(update?.parties).length ||
      sameCanonicalPartySet(update.parties, prior.parties, world);
    const typeCompatible = !clean(update?.type) || update.type === "other" || update.type === prior.type;

    // Same id but other parties or another type is not safe to infer. Leave it
    // untouched so normal validation rejects the collision.
    if (!partiesCompatible || !typeCompatible) {
      output.push(update);
      continue;
    }

    if (prior.status === "suspended") {
      output.push({
        ...update,
        op: "resume",
        type: update.type === "other" ? prior.type : update.type,
        parties: array(update.parties).length ? update.parties : array(prior.parties),
        title: update.title || prior.title,
        terms: update.terms || prior.terms,
      });
      repaired += 1;
      console.warn(
        `[OH diplomacy lifecycle repair] normalized duplicate start for suspended agreement ${update.id} to resume.`,
      );
      continue;
    }

    const termsChanged = Boolean(clean(update?.terms)) && lower(update.terms) !== lower(prior.terms);
    if (termsChanged) {
      output.push({
        ...update,
        op: "update",
        type: update.type === "other" ? prior.type : update.type,
        parties: array(update.parties).length ? update.parties : array(prior.parties),
        title: update.title || prior.title,
      });
      repaired += 1;
      console.warn(
        `[OH diplomacy lifecycle repair] normalized duplicate start for active agreement ${update.id} to update.`,
      );
      continue;
    }

    // A re-announcement of an already-active pact with no new terms carries no
    // canonical lifecycle delta. Keep the event, drop only the redundant ledger row.
    dropped += 1;
    console.warn(
      `[OH diplomacy lifecycle repair] dropped duplicate start for active agreement ${update.id}; ` +
      "the canonical agreement already exists and no formal terms changed.",
    );
  }

  candidate.agreementUpdates = wasString ? encodeAgreementUpdates(output) : output;
  return { repaired, dropped };
};

// Which current statuses each lifecycle verb can act on. An ended or expired
// instrument is never a candidate: it can only be started again.
const LIFECYCLE_OPS_BY_STATUS = {
  update: ["active", "suspended"],
  suspend: ["active"],
  resume: ["suspended"],
  end: ["active", "suspended"],
  expire: ["active", "suspended"],
};

// The mirror of normalizeDuplicateAgreementStarts: a lifecycle change aimed at
// an agreement id the ledger has never recorded. The model writes the id from
// the story — a round that evicted the United States from Bahrain went on to
// "end" us-bahrain-security-pact-2026, a pact no turn had ever started — and
// the bounded diplomatic context usually could not have shown it the real id
// anyway (it lists the player's own agreements). Rejecting the row threw the
// whole three-month turn to the canned fallback, over a pact that was never
// on the books.
//
// Ending the WRONG treaty is worse than any fallback, so the id is rewritten
// only when exactly one recorded agreement passes every check:
// - every named party resolves to a polity (canonicalizeParties silently drops
//   an unresolved name, which would let "US, Bahrain, Qatarr" shrink to match a
//   two-party pact, so the count is compared before and after);
// - the party set is identical — no more, no fewer;
// - the row names a real type (blank or unknown decodes to "other") and it is
//   the recorded agreement's type; a guarantee also keeps its direction;
// - the agreement's status allows the verb (LIFECYCLE_OPS_BY_STATUS).
// The title is deliberately NOT compared: a lifecycle row's title describes the
// change ("Termination of Bilateral Security Cooperation"), not the instrument.
// Anything else — no candidate, two candidates, any doubt — drops the row and
// keeps the turn: an agreement that was never recorded has nothing to end, and
// the event and the relation update still carry what happened. A row whose id a
// `start` in the same response creates is not unknown to the model and is left
// for validation as before; it must never be re-aimed at an older instrument.
const normalizeUnknownAgreementLifecycle = (candidate, world) => {
  if (!candidate || typeof candidate !== "object") return { rewritten: 0, dropped: 0, droppedUpdates: [] };

  const wasString = typeof candidate?.agreementUpdates === "string";
  const updates = decodeAgreementUpdates(candidate?.agreementUpdates);
  const existing = agreementMapFromWorld(world);
  const startedHere = new Set(updates.filter((update) => update.op === "start").map((update) => clean(update.id)));
  const output = [];
  const droppedUpdates = [];
  let rewritten = 0;
  let dropped = 0;

  for (const update of updates) {
    const id = clean(update?.id);
    const allowedStatuses = LIFECYCLE_OPS_BY_STATUS[update?.op];
    if (!allowedStatuses || existing.has(id) || startedHere.has(id)) {
      output.push(update);
      continue;
    }

    const named = array(update?.parties);
    const parties = canonicalizeParties(named, world);
    const type = update?.type;
    const matches = parties.length >= 2 && parties.length === named.length && type !== "other"
      ? [...existing.values()].filter((agreement) =>
        allowedStatuses.includes(agreement?.status) &&
        agreement?.type === type &&
        sameCanonicalPartySet(parties, agreement?.parties, world) &&
        (type !== "guarantee" || (
          lower(parties[0]) === lower(agreement?.guarantor) &&
          lower(parties[1]) === lower(agreement?.beneficiary)
        )))
      : [];

    if (matches.length === 1) {
      output.push({ ...update, id: clean(matches[0].id) });
      rewritten += 1;
      console.warn(
        `[OH diplomacy lifecycle repair] ${update.op} named unknown agreement ${id}; ` +
        `re-aimed at ${matches[0].id}, the only recorded ${type} between ${parties.join(", ")}.`,
      );
      continue;
    }

    dropped += 1;
    droppedUpdates.push(update);
    console.warn(
      `[OH diplomacy lifecycle repair] dropped ${update.op} for unknown agreement ${id}: ` +
      (matches.length > 1
        ? `${matches.length} recorded agreements fit it equally, and guessing could change the wrong one.`
        : "no recorded agreement matches its exact parties and type, so there is nothing to change.") +
      " The turn and its events stand.",
    );
  }

  candidate.agreementUpdates = wasString ? encodeAgreementUpdates(output) : output;
  return { rewritten, dropped, droppedUpdates };
};

// A malformed ledger row on the SALVAGE pass: dropped, and said, instead of
// costing the whole answer. Field report (beta, 2026-09-21): a three-month
// jump's first answer - 34 s on 3.7-flash, twenty events - was rejected over
// ONE agreement start whose second party was not a polity on the map
// ("requires at least two resolvable parties"), and the retry landed on an
// overloaded 3.8-flash for 191 s; the turn took 272 s and a request it did not
// need. The row is a bookkeeping mistake; the month it came with is not.
// Under salvage-first (gameplay.js runJsonTask) there is no strict retry to
// correct it, so everything validateDiplomaticLedgerPayload would reject as
// fatal is removed here first and the application receipt tells the model at
// the top of the next turn. The strict pass, and the GM preview, still reject.
//
// Returns one line per dropped row, for the receipt. The candidate is rewritten
// in place, in whichever form it arrived (compact lines or objects). A
// `playerNotes` array, when given, gets the player's sentence for each line at
// the same index (runtime/receiptPlayerNotes.js).
export const salvageDiplomaticLedgerPayload = (candidate, { world, playerNotes = null } = {}) => {
  const notes = [];
  const drop = (text, key, params = {}) => {
    notes.push(text);
    playerNotes?.push(receiptPlayerNote(key, params));
  };
  if (!candidate || typeof candidate !== "object") return notes;

  const relationsWereString = typeof candidate.relationUpdates === "string";
  const relations = decodeRelationUpdates(candidate.relationUpdates);
  const keptRelations = [];
  for (const update of relations) {
    const a = canonicalDiplomaticPolity(update.a, world);
    const b = canonicalDiplomaticPolity(update.b, world);
    let why = "";
    let key = "relationIncomplete";
    if (!a || !b) { why = `"${!a ? update.a : update.b}" is not a polity on this map`; key = "relationUnknownCountry"; }
    else if (lower(a) === lower(b)) { why = "both sides are the same polity"; key = "relationSameCountry"; }
    else if (!Number.isFinite(update.score)) why = "it carries no score from -100 to 100";
    else if (!RELATION_STATUS_SET.has(update.status)) why = `"${update.status}" is not a relation status`;
    else if (relationSummaryHasReservedSeparator(update.summary)) {
      why = "its summary contains a reserved compact-record separator";
      key = "relationIncomplete";
    }
    // A side the model left blank has no name to show the player.
    if (key === "relationUnknownCountry" && (!clean(update.a) || !clean(update.b))) key = "relationUnnamed";
    if (why) {
      drop(`Relation update ${update.a || "?"} ↔ ${update.b || "?"} was dropped: ${why}.`, key, { a: update.a, b: update.b, name: !a ? update.a : update.b });
      continue;
    }
    keptRelations.push(update);
  }
  if (keptRelations.length !== relations.length) {
    candidate.relationUpdates = relationsWereString ? encodeRelationUpdates(keptRelations) : keptRelations;
  }

  // The validator's lifecycle repairs first, exactly as on the strict pass: a
  // start re-signing a suspended pact becomes resume, one restating an active
  // pact with new terms becomes update, and an end aimed at an invented id is
  // re-aimed at the one recorded pact it fits. Salvage runs before the
  // validator, so dropping these rows first threw the repairs' work away: the
  // pact the story ended stayed active. Only what they cannot place goes below.
  // They work on a copy, adopted only when they changed something, so a clean
  // answer is left exactly as it arrived.
  const lifecycle = { agreementUpdates: candidate.agreementUpdates };
  const duplicateStarts = normalizeDuplicateAgreementStarts(lifecycle, world);
  const unknownIds = normalizeUnknownAgreementLifecycle(lifecycle, world);
  if (duplicateStarts.repaired || duplicateStarts.dropped || unknownIds.rewritten || unknownIds.dropped) {
    candidate.agreementUpdates = lifecycle.agreementUpdates;
  }
  for (const update of unknownIds.droppedUpdates) {
    drop(`Agreement ${clean(update.id)} ${clean(update.op)} was dropped: no agreement "${clean(update.id)}" exists to ${clean(update.op)}.`,
      "agreementMissing", { name: clean(update.title) || clean(update.id) });
  }

  const agreementsWereString = typeof candidate.agreementUpdates === "string";
  const existing = agreementMapFromWorld(world);
  const agreements = decodeAgreementUpdates(candidate.agreementUpdates);
  const keptAgreements = [];
  for (const update of agreements) {
    const id = clean(update?.id);
    const op = clean(update?.op);
    let why = "";
    let key = "agreementIncomplete";
    if (!id) why = "it names no agreement";
    else if (!["start", "update", "suspend", "resume", "end", "expire"].includes(op)) why = `"${op}" is not an agreement operation`;
    else if (op === "start") {
      const prior = existing.get(id);
      if (prior && !["ended", "expired"].includes(prior.status)) { why = "it already exists - update, suspend, resume or end it instead"; key = "agreementAlreadyInForce"; }
      else if (canonicalizeParties(update.parties, world).length < 2) { why = "fewer than two of its parties are polities on this map"; key = "agreementTooFewParties"; }
      else if (!clean(update.title)) { why = "it has no title"; key = "agreementUntitled"; }
    } else if (!existing.has(id)) { why = `no agreement "${id}" exists to ${op}`; key = "agreementMissing"; }
    if (why) {
      drop(`Agreement ${id || "(no id)"} ${op || ""} was dropped: ${why}.`.replace(/\s+/g, " "), key, { name: clean(update?.title) || id });
      continue;
    }
    keptAgreements.push(update);
  }
  if (keptAgreements.length !== agreements.length) {
    candidate.agreementUpdates = agreementsWereString ? encodeAgreementUpdates(keptAgreements) : keptAgreements;
  }

  return notes;
};

// The relation and agreement records of an answer, checked before they are
// applied. `authority` is who wrote them, as for the war ledger
// (nativeWarLedger.js settleWarLedger):
//   "skip"   a time skip's own pass. Redundant lifecycle verbs and a status
//            that contradicts its score are repaired, and a record tied to no
//            event is kept: it is the skip's, and is dated by the skip when it
//            is applied. Its events are the ones ledgerPins.js tied it to.
//   "gm"     the Game Master's preview, and the default: fail-closed. Every
//            record names the event that causes it, so the administrator sees
//            what the preview would write and why.
export const validateDiplomaticLedgerPayload = (
  candidate,
  {
    world = {},
    authority = "gm",
  } = {},
) => {
  const events = normalizeEvents(candidate?.events);
  const skip = authority === "skip";

  // Ordinary world simulation is allowed to repair redundant lifecycle verbs
  // before structural validation. GM/admin preview remains fail-closed.
  if (skip) {
    const lifecycleRepair = normalizeDuplicateAgreementStarts(candidate, world);
    if (lifecycleRepair.repaired || lifecycleRepair.dropped) {
      console.info(
        `[OH diplomacy lifecycle repair] ${lifecycleRepair.repaired} duplicate start(s) normalized, ` +
        `${lifecycleRepair.dropped} redundant start(s) dropped.`,
      );
    }
    // The GM/admin preview stays fail-closed: an administrator naming an
    // agreement that does not exist should be told so.
    normalizeUnknownAgreementLifecycle(candidate, world);
  }

  // Summaries are one pair's plain-text reason, not additional packed relation
  // records. Check before score/binding repairs can give malformed text authority.
  for (const update of decodeRelationUpdates(candidate?.relationUpdates)) {
    if (relationSummaryHasReservedSeparator(update.summary)) {
      return `Relation update ${update.a} ↔ ${update.b} has a summary containing a reserved compact-record separator (~).`;
    }
  }

  // A declared status that contradicts the absolute score is the model writing
  // a magnitude or a delta. Ordinary simulation repairs it (and says so); a GM
  // preview stays fail-closed so the administrator sees the contradiction.
  const reconciled = reconcileRelationScoresWithStatus(candidate?.relationUpdates);
  if (reconciled.repaired.length) {
    const first = reconciled.repaired[0];
    if (!skip) {
      return `Relation update ${first.a} ↔ ${first.b} declares status "${first.declared}" but its score ${first.from} means "${first.implied}". ` +
        "The score is the ABSOLUTE new value from -100 (worst) to 100 (best), not a change; make the score and status agree.";
    }
    console.info(
      "[OH diplomacy score repair] " +
      reconciled.repaired.map((entry) => `${entry.a} ↔ ${entry.b}: ${entry.from} (${entry.implied}) → ${entry.to} (${entry.declared})`).join("; "),
    );
    candidate.relationUpdates = reconciled.records;
  }

  const relations = bindRelationUpdatesToEvents(candidate?.relationUpdates, events);
  const agreements = bindAgreementUpdatesToEvents(candidate?.agreementUpdates, events);

  // Structural/canonical errors remain fatal: a malformed polity, status or
  // agreement operation is a real state error and must not be papered over.
  for (const update of relations) {
    const a = canonicalDiplomaticPolity(update.a, world);
    const b = canonicalDiplomaticPolity(update.b, world);
    if (!a || !b) return `Relation update could not resolve both polities: "${update.a}" / "${update.b}".`;
    if (lower(a) === lower(b)) return `Relation update cannot target the same polity twice: ${a}.`;
    if (!Number.isFinite(update.score)) return `Relation update ${a} ↔ ${b} requires an absolute score from -100 to 100.`;
    if (!RELATION_STATUS_SET.has(update.status)) return `Relation update ${a} ↔ ${b} has unsupported status "${update.status}".`;
  }

  const existing = agreementMapFromWorld(world);
  for (const update of agreements) {
    if (!["start", "update", "suspend", "resume", "end", "expire"].includes(update.op)) {
      return `Agreement ${update.id} has unsupported operation "${update.op}".`;
    }
    if (update.op === "start") {
      if (existing.has(update.id) && existing.get(update.id)?.status !== "ended" && existing.get(update.id)?.status !== "expired") {
        return `Agreement ${update.id} already exists; use update/suspend/resume/end instead of start.`;
      }
      const parties = canonicalizeParties(update.parties, world);
      if (parties.length < 2) return `Agreement ${update.id} start requires at least two resolvable parties.`;
      if (!update.title) return `Agreement ${update.id} start requires a nonblank title.`;
    } else if (!existing.has(update.id)) {
      return `Agreement ${update.id} does not exist; ${update.op} cannot occur before start.`;
    }
  }

  // A skip's record stays tied to the events it named, and to none when it
  // named none: it is applied all the same, dated by the skip. (Records were
  // tied here by the words they shared with an event's title and description,
  // which overrode the event the model had named, and one that matched none was
  // dropped: in any language but English nearly every one, every skip.)
  if (skip) return "";

  for (const update of relations) {
    const a = canonicalDiplomaticPolity(update.a, world);
    const b = canonicalDiplomaticPolity(update.b, world);
    if (!update.eventIds.length && !update.eventIndexes.length) {
      return `Relation update ${a} ↔ ${b} must reference a causal event.`;
    }
    if (!linkedEvents(update, events).length) {
      return `Relation update ${a} ↔ ${b} does not resolve to a valid causal event in this response.`;
    }
  }

  for (const update of agreements) {
    if (!update.eventIds.length && !update.eventIndexes.length) {
      return `Agreement ${update.id} ${update.op} must reference a causal event.`;
    }
    if (!linkedEvents(update, events).length) {
      return `Agreement ${update.id} ${update.op} does not resolve to a valid causal event in this response.`;
    }
  }

  return "";
};

// The ids of the events a record is tied to that are among `events`: what it
// cites as its source. A record tied to none cites none.
const citedEventIds = (causalEvents) => unique(causalEvents.map((event) => clean(event?.id)).filter(Boolean), 24);

// A record tied to no event of the answer is applied all the same, dated by
// `stopDate` (the skip's, the GM's game date): the answer said it, and the
// numbers it was written with are what was missing, not the change. It cites no
// event. A record is never tied to an event by what its words share with one.
export const applyRelationUpdates = ({ world, updates, events = [], stopDate = "", round = 0, limit } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = relationMapFromWorld(nextWorld);
  const decoded = bindRelationUpdatesToEvents(updates, events, { limit });
  const applied = [];

  for (const update of decoded) {
    const causalEvents = linkedEvents(update, events);
    const a = canonicalDiplomaticPolity(update.a, nextWorld);
    const b = canonicalDiplomaticPolity(update.b, nextWorld);
    const key = relationPairKey(a, b);
    if (!a || !b || !key || !Number.isFinite(update.score) || !RELATION_STATUS_SET.has(update.status) || relationSummaryHasReservedSeparator(update.summary)) {
      console.warn(`[OH diplomacy] dropped invalid relation update ${update.a} ↔ ${update.b}.`);
      continue;
    }
    const prior = map.get(key) || null;
    const date = updateDate(update, events, stopDate);
    const eventIds = unique([
      ...array(prior?.sourceEventIds),
      ...citedEventIds(causalEvents),
    ], 24);
    const ordered = [a, b].sort((x, y) => lower(x).localeCompare(lower(y)));
    const relation = {
      id: prior?.id || relationIdForPair(ordered[0], ordered[1]),
      a: ordered[0],
      b: ordered[1],
      score: clamp(Math.round(update.score), -100, 100),
      status: normalizeRelationStatus(update.status, update.score),
      summary: clean(update.summary) || clean(prior?.summary),
      lastUpdatedDate: date || clean(prior?.lastUpdatedDate),
      sourceEventIds: eventIds,
      createdRound: Number.isFinite(Number(prior?.createdRound))
        ? Math.max(0, Math.trunc(Number(prior.createdRound)))
        : Math.max(0, Math.trunc(Number(round) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    };
    map.set(key, relation);
    applied.push(relation.id);
  }

  const relations = [...map.values()]
    .sort((a, b) => Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0) || lower(a.id).localeCompare(lower(b.id)))
    .slice(0, MAX_RELATIONS);

  return { world: { ...nextWorld, relations }, relations, appliedIds: applied };
};

// As applyRelationUpdates: a record tied to no event is dated by `stopDate`.
// `allowUnboundBaseline` is a Round-Zero baseline's: an instrument with no
// signing event in the bounded timeline started at some date the game does not
// know, so it is observed on `stopDate` and given no start date, rather than
// claiming it began the day the campaign did.
export const applyAgreementUpdates = ({ world, updates, events = [], stopDate = "", round = 0, allowUnboundBaseline = false, limit } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = agreementMapFromWorld(nextWorld);
  const decoded = bindAgreementUpdatesToEvents(updates, events, { limit });
  const applied = [];

  for (const update of decoded) {
    const causalEvents = linkedEvents(update, events);
    const prior = map.get(update.id) || null;
    const date = causalEvents.length || !allowUnboundBaseline ? updateDate(update, events, stopDate) : "";
    const observedDate = date || parseIsoDate(stopDate);
    const eventIds = unique([
      ...array(prior?.sourceEventIds),
      ...citedEventIds(causalEvents),
    ], 24);

    if (update.op === "start") {
      const parties = canonicalizeParties(update.parties, nextWorld);
      if (parties.length < 2 || !update.title) {
        console.warn(`[OH diplomacy] dropped invalid agreement start ${update.id}.`);
        continue;
      }
      const type = normalizeAgreementType(update.type);
      const agreement = {
        id: update.id,
        title: update.title,
        type,
        status: "active",
        parties,
        startedDate: date,
        endedDate: "",
        lastUpdatedDate: observedDate,
        terms: update.terms,
        ...(type === "guarantee" && parties.length >= 2
          ? { guarantor: parties[0], beneficiary: parties[1] }
          : {}),
        sourceEventIds: eventIds,
        createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
        updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
      };
      map.set(update.id, agreement);
      applied.push(update.id);
      continue;
    }

    if (!prior) {
      console.warn(`[OH diplomacy] dropped ${update.op} for missing agreement ${update.id}.`);
      continue;
    }

    const parties = update.parties.length ? canonicalizeParties(update.parties, nextWorld) : array(prior.parties);
    const type = update.type && update.type !== "other" ? normalizeAgreementType(update.type) : prior.type;
    let status = prior.status;
    if (update.op === "suspend") status = "suspended";
    else if (update.op === "resume") status = "active";
    else if (update.op === "end") status = "ended";
    else if (update.op === "expire") status = "expired";

    const agreement = {
      ...prior,
      // The agreement title is canonical identity metadata, not the title of the
      // event that changed its lifecycle. Suspend/resume/end/expire/update events
      // may describe the mutation with their own titles, but they must not rename
      // the persisted agreement. A genuinely superseding/renamed instrument should
      // end the old agreement and start a new canonical agreement instead.
      title: prior.title,
      type,
      parties,
      status,
      endedDate: ["ended", "expired"].includes(status) ? (date || prior.endedDate) : "",
      lastUpdatedDate: observedDate || prior.lastUpdatedDate,
      terms: update.terms || prior.terms,
      sourceEventIds: eventIds,
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    };
    if (type === "guarantee" && parties.length >= 2) {
      agreement.guarantor = parties[0];
      agreement.beneficiary = parties[1];
    } else {
      delete agreement.guarantor;
      delete agreement.beneficiary;
    }
    map.set(update.id, agreement);
    applied.push(update.id);
  }

  const statusRank = { active: 0, suspended: 1, ended: 2, expired: 3 };
  const agreements = [...map.values()]
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      compareGameDates(b.lastUpdatedDate || b.startedDate || "", a.lastUpdatedDate || a.startedDate || "") ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_AGREEMENTS);

  return { world: { ...nextWorld, agreements }, agreements, appliedIds: applied };
};

// ---------------------------------------------------------------------------
// Puppets — subordination between two polities.
//
// Directional, unlike a relation; partly secret, unlike an agreement. That is
// why it is its own ledger rather than a new agreement type — see
// docs/adr/0004-puppet-ledger-and-secrecy.md. What a given viewer may SEE of a
// row is not decided here: that is runtime/puppets.js, which every surface asks.
//
// Transport, like the relation and agreement lines above:
//   op~overlord~puppet~kind~loyalty~secrecy~eventNumbersCSV~note
//
// The verbs are deliberately not a degree scale. `kind` states WHICH POWERS the
// Overlord holds — a protectorate keeps internal rule and surrenders foreign
// policy, a satellite the reverse — so "tighten" and "loosen" would be lies
// about what is changing. `reclassify` says it plainly instead.
// ---------------------------------------------------------------------------

const PUPPET_OP_VALUES = Object.freeze([
  "install", "reclassify", "loyalty", "reveal", "release", "annex", "revolt", "suppress",
]);
const PUPPET_OP_SET = new Set(PUPPET_OP_VALUES);
const PUPPET_ENDING_OPS = new Set(["release", "annex", "revolt"]);
const PUPPET_KIND_SET = new Set(PUPPET_KINDS);
const MAX_PUPPET_UPDATES_PER_PASS = 24;

export const buildPregamePuppetBaselineRecord = ({
  id = "",
  overlord = "",
  puppet = "",
  kind = "client",
  loyalty = 50,
  secrecy = "open",
  startedDate = "",
  sourceEventIds = [],
  observedDate = "",
  round = 1,
  world = {},
} = {}) => {
  const canonicalId = clean(id);
  const canonicalOverlord = canonicalDiplomaticPolity(overlord, world);
  const canonicalPuppet = canonicalDiplomaticPolity(puppet, world);
  const puppetKind = lower(kind);
  const secrecyMode = lower(secrecy);
  const start = clean(startedDate);
  const observed = clean(observedDate);
  const numericLoyalty = Number(loyalty);

  if (!canonicalId) return { record: null, error: "Round-Zero puppet baseline requires a native canonical id." };
  if (!canonicalOverlord || !canonicalPuppet || lower(canonicalOverlord) === lower(canonicalPuppet)) {
    return { record: null, error: `Round-Zero puppet ${canonicalId} requires distinct current overlord and puppet polities.` };
  }
  if (!PUPPET_KIND_SET.has(puppetKind)) return { record: null, error: `Round-Zero puppet ${canonicalId} has unsupported kind ${kind || "<blank>"}.` };
  if (!["open", "covert"].includes(secrecyMode)) return { record: null, error: `Round-Zero puppet ${canonicalId} secrecy must be open or covert.` };
  if (!Number.isFinite(numericLoyalty)) return { record: null, error: `Round-Zero puppet ${canonicalId} requires finite loyalty.` };
  if (start && !isGameDate(start)) return { record: null, error: `Round-Zero puppet ${canonicalId} has an invalid startedDate.` };
  if (observed && !isGameDate(observed)) return { record: null, error: `Round-Zero puppet ${canonicalId} has an invalid observed date.` };

  const knownDate = start || observed;
  return {
    record: {
      id: canonicalId,
      overlord: canonicalOverlord,
      puppet: canonicalPuppet,
      kind: puppetKind,
      loyalty: clamp(Math.round(numericLoyalty), 0, 100),
      secrecy: secrecyMode,
      knownTo: [
        { polity: canonicalOverlord, learnedDate: knownDate },
        { polity: canonicalPuppet, learnedDate: knownDate },
      ],
      status: "active",
      startedDate: start,
      endedDate: "",
      lastUpdatedDate: observed || start,
      sourceEventIds: unique(sourceEventIds, 24),
      createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    },
    error: "",
  };
};

export const resolvePregamePuppetBaselineMatch = ({ records = [], overlord = "", puppet = "" } = {}) => {
  const key = `${lower(overlord)}>${lower(puppet)}`;
  const matches = array(records).filter((entry) =>
    lower(entry?.status) === "active" && `${lower(entry?.overlord)}>${lower(entry?.puppet)}` === key
  );
  if (matches.length > 1) return { match: null, error: "Round-Zero puppet identity matches multiple active canonical records." };
  return { match: matches[0] || null, error: "" };
};

export const mergePregamePuppetBaselineRecord = ({ existing = null, incoming = null } = {}) => {
  if (!existing || !incoming || clean(existing.id) !== clean(incoming.id)) return { record: null, error: "Round-Zero puppet merge requires the same canonical id." };
  if (lower(existing.overlord) !== lower(incoming.overlord) || lower(existing.puppet) !== lower(incoming.puppet)) return { record: null, error: `Round-Zero puppet ${existing.id} changes canonical subordination identity.` };
  if (lower(existing.kind) !== lower(incoming.kind) || Math.round(Number(existing.loyalty)) !== Math.round(Number(incoming.loyalty)) || lower(existing.secrecy) !== lower(incoming.secrecy)) {
    return { record: null, error: `Round-Zero puppet ${existing.id} conflicts on kind, loyalty, or secrecy.` };
  }
  const existingDate = clean(existing.startedDate);
  const incomingDate = clean(incoming.startedDate);
  if (existingDate && incomingDate && existingDate !== incomingDate) return { record: null, error: `Round-Zero puppet ${existing.id} conflicts on known start date.` };
  return {
    record: {
      ...existing,
      startedDate: existingDate || incomingDate,
      lastUpdatedDate: clean(existing.lastUpdatedDate) || clean(incoming.lastUpdatedDate) || existingDate || incomingDate,
      sourceEventIds: unique([...array(existing.sourceEventIds), ...array(incoming.sourceEventIds)], 24),
      knownTo: unique([
        ...array(existing.knownTo).map((row) => JSON.stringify(row)),
        ...array(incoming.knownTo).map((row) => JSON.stringify(row)),
      ], 24).map((row) => { try { return JSON.parse(row); } catch { return null; } }).filter(Boolean),
      updatedRound: Math.max(0, Math.trunc(Number(existing.updatedRound) || 0), Math.trunc(Number(incoming.updatedRound) || 0)),
    },
    error: "",
  };
};

export const pregamePuppetBaselineCompatibilityError = (expected, actual) => {
  if (!expected || !actual) return "puppet record is missing";
  if (clean(expected.id) !== clean(actual.id)) return "puppet id changed";
  if (lower(expected.overlord) !== lower(actual.overlord) || lower(expected.puppet) !== lower(actual.puppet)) return "puppet identity changed";
  if (lower(expected.kind) !== lower(actual.kind) || Math.round(Number(expected.loyalty)) !== Math.round(Number(actual.loyalty)) || lower(expected.secrecy) !== lower(actual.secrecy)) return "puppet state changed";
  if (clean(expected.startedDate) !== clean(actual.startedDate)) return "puppet start date was not conserved";
  if (!pregameSourceIdsContain(actual.sourceEventIds, expected.sourceEventIds)) return "puppet provenance was not conserved";
  return "";
};

export const validatePregamePuppetGraph = (rows = []) => {
  const parentByPuppet = new Map();
  for (const row of array(rows).filter((entry) => lower(entry?.status) === "active")) {
    const overlord = clean(row?.overlord);
    const puppet = clean(row?.puppet);
    if (!overlord || !puppet || lower(overlord) === lower(puppet)) return "Round-Zero puppet canon contains an invalid self/blank subordination.";
    const key = lower(puppet);
    const prior = parentByPuppet.get(key);
    if (prior && lower(prior) !== lower(overlord)) return `Round-Zero puppet ${puppet} has more than one active overlord.`;
    parentByPuppet.set(key, overlord);
  }
  for (const [puppetKey, overlord] of parentByPuppet) {
    if (parentByPuppet.has(lower(overlord))) return `Round-Zero puppet chain is forbidden: ${overlord} is itself a puppet while directing ${puppetKey}.`;
  }
  return "";
};

// How many subordinations the bounded prompt slice may carry. Its own bound:
// borrowing the agreements cap made the number lie about what it limited.
const MAX_CONTEXT_PUPPETS = 24;

// The ONE deterministic engine rule on Loyalty. Everything else — mistreatment,
// a good decade, a humiliation — is the model's judgement, moved by a `loyalty`
// line. This exists because a refused demand is the single interaction the
// PLAYER directly drives, and it must cost the same every time rather than
// depending on whether the model remembered to emit a line for it. The
// precedent is the exposed spy ring that sours a relation by a fixed 20.
export const REFUSED_DEMAND_LOYALTY_COST = 10;

// A revolt does not merely end the arrangement: it leaves the two bitter. The
// score is forced down rather than nudged, because a satellite that has just
// thrown off its Overlord is not "strained".
const REVOLT_RELATION_SCORE = -60;

// A coup that FAILED. The Overlord held on, so loyalty is forced up — obedience
// bought at gunpoint, not affection — and the prompt asks for the reputation
// drop that watching a government crush its client's rising costs you. Without
// this verb low Loyalty is a countdown the player can only watch; with it, a
// brewing revolt is a crisis they can answer, badly and at a price.
const SUPPRESSED_COUP_LOYALTY_GAIN = 25;

// Below this, resentment is a situation rather than a mood, and the world
// director is given something to ripen. Not a trigger: the Storyline decides
// WHEN, and may decide never. Shared with the Workshop (runtime/puppets.js).
const COUP_STORYLINE_LOYALTY = PUPPET_COUP_LOYALTY;

// Swallowing a client costs standing, and costs more the more openly it was a
// client — the world watched a country disappear. Deterministic rather than left
// to the prompt, because a cost the model only sometimes remembers is a cost
// players learn to ignore, and then a Puppet is just free territory with a
// waiting period. That is the one thing this whole subsystem exists to prevent.
const ANNEXED_PUPPET_REPUTATION_COST = 8;
const ANNEXED_OPEN_PUPPET_REPUTATION_COST = 16;
export const puppetCoupStorylineId = (row) => `storyline-puppet-${slug(row?.puppet)}`;

const decodePuppetLine = (line, index) => {
  const text = String(line ?? "");
  const [op, overlord, puppet, kind, loyaltyRaw, secrecy, eventNumbers, note] = splitFixedFields(text, 7);
  const loyalty = Number(loyaltyRaw);
  return {
    id: `puppet-update-${index}`,
    op: lower(op),
    overlord: clean(overlord),
    puppet: clean(puppet),
    kind: lower(kind),
    loyalty: Number.isFinite(loyalty) && clean(loyaltyRaw) ? clamp(Math.round(loyalty), 0, 100) : null,
    secrecy: lower(secrecy),
    eventIndexes: parseEventNumbers(eventNumbers),
    eventIds: [],
    note: clean(note),
  };
};

export const decodePuppetUpdates = (value, { limit = MAX_PUPPET_UPDATES_PER_PASS } = {}) => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return isRecordLine(entry) ? decodePuppetLine(entry, index) : null;
      if (!entry || typeof entry !== "object") return null;
      const loyalty = figureOrBlank(entry.loyalty);
      return {
        id: clean(entry.id) || `puppet-update-${index}`,
        op: lower(entry.op),
        overlord: clean(entry.overlord),
        puppet: clean(entry.puppet),
        kind: lower(entry.kind),
        loyalty: Number.isFinite(loyalty) ? clamp(Math.round(loyalty), 0, 100) : null,
        secrecy: lower(entry.secrecy),
        eventIndexes: array(entry.eventIndexes).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 16),
        eventIds: unique(entry.eventIds, 24),
        note: clean(entry.note),
      };
    }).filter(Boolean).slice(0, limit);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => (isRecordLine(line) ? decodePuppetLine(line, index) : null))
    .filter((entry) => entry && (entry.op || entry.overlord || entry.puppet))
    .slice(0, limit);
};

export const bindPuppetUpdatesToEvents = (updates, events, { limit } = {}) =>
  bindEventIds(decodePuppetUpdates(updates, { limit }), events);

const livePuppetRow = (rows, overlord, puppet) => rows.find((row) =>
  row.status === "active" && lower(row.overlord) === lower(overlord) && lower(row.puppet) === lower(puppet));

const livePuppetByPuppet = (rows, puppet) => rows.find((row) =>
  row.status === "active" && lower(row.puppet) === lower(puppet));

// A revolt leaves the two at each other's throats and voids what they had
// signed. The relation goes through applyRelationUpdates — the ORDINARY path,
// bound to the revolt's own event — rather than being written onto the ledger
// behind its back, so a thrown-off satellite reads in history exactly like any
// other collapse in relations.
const applyRevoltFallout = (world, overlord, puppet, causalEventIds, events, date, round) => {
  const score = REVOLT_RELATION_SCORE;
  const merged = applyRelationUpdates({
    world,
    updates: [{
      id: `relation-revolt-${slug(puppet)}`,
      a: overlord,
      b: puppet,
      score,
      status: normalizeRelationStatus("", score),
      eventIds: causalEventIds,
      summary: `${puppet} threw off ${overlord}.`,
    }],
    events,
    stopDate: date,
    round,
  });

  const both = [lower(overlord), lower(puppet)];
  const agreements = array(merged.world.agreements).map((agreement) => {
    const parties = array(agreement.parties).map(lower);
    const between = both.every((name) => parties.includes(name));
    if (!between || ["ended", "expired"].includes(lower(agreement.status))) return agreement;
    return {
      ...agreement,
      status: "ended",
      endedDate: date || clean(agreement.lastUpdatedDate),
      lastUpdatedDate: date || clean(agreement.lastUpdatedDate),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    };
  });

  return { ...merged.world, agreements };
};

// Which polities still hold land. A Puppet keeps its own territory — that is
// what makes it a Puppet and not a province — so a country with none left (an
// annexed Ireland) has no state to subordinate. A region counts for whoever
// administers it and for its lawful sovereign, so an occupied homeland is still
// a homeland; a stock region nobody has overridden belongs to its map country.
// With no region list to consult it cannot tell, so it answers null and nothing
// is refused on its account.
export const landedPolityCheck = (world, regionCatalog) => {
  const regions = array(regionCatalog);
  if (!regions.length) return null;
  const control = world?.regionOwnershipOverrides || {};
  const sovereignty = world?.regionSovereigntyOverrides || {};
  const holders = new Set([...Object.values(control), ...Object.values(sovereignty)].map(clean));
  for (const region of regions) {
    if (clean(control[region?.id])) continue;
    holders.add(clean(region?.country) || clean(toCountryName(clean(region?.countryCode))));
  }
  const landed = new Set([...holders]
    .filter(Boolean)
    .map((name) => lower(canonicalDiplomaticPolity(name, world, { allowUnknown: true }))));
  return (polity) => landed.has(lower(polity));
};

// A line tied to no event is applied as applyRelationUpdates applies one: dated
// by `stopDate`, citing no event. (A skip's install with no event number was
// tied to the one event whose words named both countries, and thrown away when
// none or two did: an accession the timeline told three times never happened
// on the ledger.)
export const applyPuppetUpdates = ({
  world,
  updates,
  events = [],
  stopDate = "",
  round = 0,
  refusedDemands = [],
  regionCatalog = [],
  limit,
} = {}) => {
  let nextWorld = normalizeWorldState(world);
  const holdsLand = landedPolityCheck(nextWorld, regionCatalog);
  let rows = array(nextWorld.puppets).map((row) => ({ ...row }));
  const decoded = bindPuppetUpdatesToEvents(updates, events, { limit });
  const applied = [];
  const settledStorylines = new Set();
  // What was NOT applied, and why. A skip can shrug a bad line off, but the GM
  // console must not: a player who asks it for a puppet and gets nothing is the
  // bug this list exists to prevent, so the GM refuses its preview and says why.
  const dropped = [];
  const drop = (index, update, reason) => {
    console.warn(`[OH puppets] ${reason}`);
    dropped.push({ index, op: update.op, overlord: update.overlord, puppet: update.puppet, reason });
  };

  for (const [index, update] of decoded.entries()) {
    if (!PUPPET_OP_SET.has(update.op)) {
      drop(index, update, `"${update.op || "(none)"}" is not a subordination change.`);
      continue;
    }

    const namedOverlord = canonicalDiplomaticPolity(update.overlord, nextWorld);
    const puppet = canonicalDiplomaticPolity(update.puppet, nextWorld);
    // NO CHAINS, from either direction. Reparenting below handles the case where
    // the new Puppet already holds Puppets; this handles the mirror image, where
    // the new OVERLORD is itself held. A satellite that subjugates its neighbour
    // does not acquire a Puppet of its own — the neighbour answers to whoever
    // answers for the satellite, directly. Only `install` may redirect: the other
    // verbs must act on the row exactly as it stands.
    const heldOverlord = update.op === "install" ? livePuppetByPuppet(rows, namedOverlord) : null;
    const overlord = heldOverlord && lower(heldOverlord.overlord) !== lower(puppet)
      ? heldOverlord.overlord
      : namedOverlord;
    if (!overlord || !puppet || lower(overlord) === lower(puppet)) {
      // Say WHICH name is the problem. A GM that named "Republic of Ireland" for a
      // country the player had already annexed was told only that the two were
      // "not two different countries this world knows" — true, and no help to a
      // retry or a player trying to see what went wrong.
      const unknown = [
        !namedOverlord ? `"${update.overlord}"` : "",
        !puppet ? `"${update.puppet}"` : "",
      ].filter(Boolean);
      drop(index, update, unknown.length
        ? `${update.op}: ${unknown.join(" and ")} ${unknown.length === 1 ? "is not a country" : "are not countries"} this world knows — ${unknown.length === 1 ? "it may have been annexed, renamed, or never existed" : "they may have been annexed, renamed, or never existed"}. Use the name the world uses now.`
        : `${update.op}: "${update.overlord}" cannot be its own puppet.`);
      continue;
    }

    const date = updateDate(update, events, stopDate);
    const eventIds = citedEventIds(linkedEvents(update, events));
    const existing = livePuppetRow(rows, overlord, puppet);

    if (update.op === "install") {
      if (holdsLand && !holdsLand(puppet)) {
        drop(index, update, `install: ${puppet} holds no territory — it has been annexed or has lost all its land, so there is no state left to make a puppet. A puppet keeps its own land; restore some first if that is the story.`);
        continue;
      }
      // One Overlord per Puppet. A condominium is a curiosity this deliberately
      // does not model, so a second claimant loses to the one in possession.
      const heldByAnother = livePuppetByPuppet(rows, puppet);
      if (heldByAnother && heldByAnother !== existing) {
        drop(index, update, `${puppet} is already the ${heldByAnother.kind} of ${heldByAnother.overlord}; a country has one overlord at a time, so release it first.`);
        continue;
      }
      if (livePuppetRow(rows, puppet, overlord)) {
        drop(index, update, `${overlord} is itself a puppet of ${puppet}, so it cannot also direct it.`);
        continue;
      }

      if (existing) {
        rows = rows.map((row) => row !== existing ? row : {
          ...row,
          kind: PUPPET_KIND_SET.has(update.kind) ? update.kind : row.kind,
          loyalty: update.loyalty === null ? row.loyalty : update.loyalty,
          // Reveal is one-way: a secret that is out stays out, so an install
          // restating an open arrangement as covert changes nothing.
          secrecy: row.secrecy === "open" ? "open" : (update.secrecy === "open" ? "open" : row.secrecy),
          lastUpdatedDate: date || row.lastUpdatedDate,
          sourceEventIds: unique([...array(row.sourceEventIds), ...eventIds], 24),
          updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
        });
        applied.push(existing.id);
        continue;
      }

      // NO CHAINS. If the new Puppet already holds Puppets of its own, they are
      // reparented one hop up, in this same event — they keep their own kind and
      // their own Loyalty, because they did not choose this. Permanent: letting
      // the middle party go later does not give them back.
      rows = rows.map((row) => row.status === "active" && lower(row.overlord) === lower(puppet)
        ? {
          ...row,
          overlord,
          lastUpdatedDate: date || row.lastUpdatedDate,
          sourceEventIds: unique([...array(row.sourceEventIds), ...eventIds], 24),
          updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
        }
        : row);

      const secrecy = update.secrecy === "covert" ? "covert" : "open";
      rows.push({
        id: `puppet-${slug(overlord)}-${slug(puppet)}-${rows.length}`,
        overlord,
        puppet,
        kind: PUPPET_KIND_SET.has(update.kind) ? update.kind : "client",
        loyalty: update.loyalty === null ? 50 : update.loyalty,
        secrecy,
        // Both parties know what they agreed to. Everyone else has to find out.
        knownTo: [
          { polity: overlord, learnedDate: date },
          { polity: puppet, learnedDate: date },
        ],
        status: "active",
        startedDate: date,
        endedDate: "",
        lastUpdatedDate: date,
        sourceEventIds: eventIds,
        createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
        updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
      });
      applied.push(rows[rows.length - 1].id);
      continue;
    }

    // Every other verb acts on a subordination that is already on the books. An
    // unrecorded one has nothing to reclassify, reveal or end, and inventing the
    // row from the verb is how a ledger fills with relationships nobody formed.
    if (!existing) {
      drop(index, update, `${update.op}: ${overlord} does not direct ${puppet}, so there is nothing to ${update.op}.`);
      continue;
    }

    const patch = {
      lastUpdatedDate: date || existing.lastUpdatedDate,
      sourceEventIds: unique([...array(existing.sourceEventIds), ...eventIds], 24),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    };
    if (update.op === "reclassify" && PUPPET_KIND_SET.has(update.kind)) patch.kind = update.kind;
    if (update.op === "loyalty" && update.loyalty !== null) patch.loyalty = update.loyalty;
    if (update.op === "reveal") patch.secrecy = "open";
    if (update.op === "suppress") {
      patch.loyalty = clamp(Math.round(Number(existing.loyalty) || 0) + SUPPRESSED_COUP_LOYALTY_GAIN, 0, 100);
    }
    if (PUPPET_ENDING_OPS.has(update.op)) {
      patch.status = update.op === "release" ? "released" : update.op === "annex" ? "annexed" : "revolted";
      patch.endedDate = date || existing.lastUpdatedDate;
    }
    if (update.op === "annex") {
      const cost = existing.secrecy === "covert" ? ANNEXED_PUPPET_REPUTATION_COST : ANNEXED_OPEN_PUPPET_REPUTATION_COST;
      const reputation = { ...(nextWorld.internationalReputation || {}) };
      const before = Number.isFinite(Number(reputation[overlord])) ? Number(reputation[overlord]) : 50;
      reputation[overlord] = clamp(Math.round(before - cost), 0, 100);
      nextWorld = { ...nextWorld, internationalReputation: reputation };
    }

    rows = rows.map((row) => row === existing ? { ...row, ...patch } : row);
    // The resentment played out, one way or another: it revolted, it was put
    // down, or the arrangement it was about is over. Either way the Storyline
    // has nothing left to ripen, and leaving it active would also block the
    // seeder from ever opening a fresh one for the next arrangement.
    if (PUPPET_ENDING_OPS.has(update.op) || update.op === "suppress") settledStorylines.add(puppetCoupStorylineId(existing));
    if (update.op === "revolt") nextWorld = applyRevoltFallout(nextWorld, overlord, puppet, eventIds, events, date, round);
    applied.push(existing.id);
  }

  // The one deterministic Loyalty rule, applied after the model's own lines so
  // a turn that both narrated the refusal and scored it does not double-count:
  // the model's score is the baseline, this is the cost on top.
  let refusedDemandCount = 0;
  for (const demand of array(refusedDemands)) {
    const overlord = canonicalDiplomaticPolity(demand?.overlord, nextWorld);
    const puppet = canonicalDiplomaticPolity(demand?.puppet, nextWorld);
    if (!overlord || !puppet) continue;
    const row = livePuppetRow(rows, overlord, puppet);
    if (!row) continue;
    rows = rows.map((entry) => entry === row ? {
      ...entry,
      loyalty: clamp(Math.round(Number(entry.loyalty) || 0) - REFUSED_DEMAND_LOYALTY_COST, 0, 100),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    } : entry);
    refusedDemandCount += 1;
  }

  // Handed over WHOLE: normalizeWorldPuppets evicts finished rows before live
  // ones. Truncating here would drop whatever happened to be last, and a new
  // install is pushed to the end — so a full ledger would silently swallow the
  // subordination this very turn created.
  const merged = normalizeWorldState({ ...nextWorld, puppets: rows });

  // A Puppet whose Loyalty has fallen far enough gets a hidden Storyline, once,
  // and the world director ripens it from there like any other ongoing
  // situation. The ENGINE opens it rather than the model, for the same reason
  // the refused demand is an engine rule: a turn that forgot to open one would
  // mean a decade of mistreatment silently never happened. What it never does is
  // fire the coup — pressure and momentum decide that, and may decide never.
  const existingStorylineIds = new Set(array(merged.storylines).map((entry) => lower(entry?.id)));
  const liveStorylineIds = new Set(array(merged.storylines)
    .filter((entry) => lower(entry?.status) !== "resolved")
    .map((entry) => lower(entry?.id)));

  // Closing lines first, so a Puppet that revolted and whose Storyline is now
  // settled cannot also be re-seeded by the pass that follows.
  const storylineResolutions = [...settledStorylines]
    .filter((id) => liveStorylineIds.has(lower(id)))
    .map((id) => [id, "resolved", "0", "0", "", "", "", "", "", "It played out."].join(SEP));

  const storylineSeeds = array(merged.puppets)
    .filter((row) => row.status === "active" && Number(row.loyalty) < COUP_STORYLINE_LOYALTY)
    .filter((row) => !existingStorylineIds.has(lower(puppetCoupStorylineId(row))))
    .filter((row) => !settledStorylines.has(puppetCoupStorylineId(row)))
    .map((row) => {
      const pressure = clamp(Math.round(100 - (Number(row.loyalty) || 0) * 2), 20, 100);
      return [
        puppetCoupStorylineId(row),
        "active",
        String(pressure),
        "35",
        row.lastUpdatedDate || "",
        "unrest",
        `Resentment in ${row.puppet}`,
        `${row.puppet},${row.overlord}`,
        "",
        `${row.puppet} chafes under ${row.overlord}. Whether this ripens into a coup, a negotiated loosening or nothing at all is unsettled.`,
      ].join(SEP);
    });
  return { world: merged, puppets: merged.puppets, appliedIds: applied, dropped, refusedDemandCount, storylineSeeds: [...storylineResolutions, ...storylineSeeds] };
};

// STARTING PUPPETS. The pregame bootstrap answers in one flat canonicalUpdates
// list (canonicalUpdateSchema), not in per-ledger lines, so its subordinations
// arrive as entries like any other day-one fact. At the start of a game the only
// thing to say of one is that it stands, so the operation slot carries its
// secrecy instead of a verb: puppet:open or puppet:covert. The shared fields do
// the rest — polities is [overlord, puppet], category the kind, score the
// loyalty. Lives here rather than beside the other families in gameplay.js
// because this module is the one that can be tested.
export const puppetUpdatesFromCanonical = (canonicalUpdates) => array(canonicalUpdates)
  .filter((raw) => raw && typeof raw === "object" && !Array.isArray(raw))
  .map((raw) => {
    const [family = "", secrecy = ""] = lower(raw.kind).split(":").map((part) => part.trim());
    if (family !== "puppet") return null;
    const [overlord = "", puppet = ""] = array(raw.polities).map(clean);
    if (!overlord || !puppet) return null;
    const loyalty = Number(raw.score);
    return {
      op: "install",
      overlord,
      puppet,
      kind: lower(raw.category),
      loyalty: Number.isFinite(loyalty) && loyalty > 0 ? clamp(Math.round(loyalty), 0, 100) : null,
      secrecy: secrecy === "covert" ? "covert" : "open",
      eventIndexes: [],
      eventIds: [],
      note: clean(raw.detail),
    };
  })
  .filter(Boolean);

// ESPIONAGE UNCOVERS COVERT ARRANGEMENTS. An agent working inside either party
// to a covert subordination tells its owner of it; this is the one door by which
// a third party joins knownTo. Deterministic on presence: the roll that matters
// already happened in spycraft, when the agent got in and stayed undiscovered.
//
// Only an ACTIVE agent. A turned one reports what its captors choose, and they
// would not hand over their own secret; a discovered one reports nothing.
//
// Each knownTo entry records the status its polity LAST SAW (seenStatus). An
// agent still in place refreshes it, which is how a lapsed arrangement is ever
// learned to have lapsed; with no agent, the old belief stands. That is the
// staleness the design wants, now with a way out of it.
export const revealPuppetsToSpies = (world, date = "") => {
  const spies = array(world?.spies).filter((spy) => lower(spy?.status) === "active");
  if (!spies.length || !array(world?.puppets).length) return world;
  const stamp = clean(date);
  const puppets = array(world.puppets).map((row) => {
    if (lower(row?.secrecy) !== "covert") return row;
    const party = [lower(row.overlord), lower(row.puppet)];
    const learners = [...new Set(spies
      .filter((spy) => party.includes(lower(spy?.target)) && !party.includes(lower(spy?.owner)))
      .map((spy) => clean(spy.owner))
      .filter(Boolean))];
    if (!learners.length) return row;
    const knownTo = array(row.knownTo).map((entry) => (typeof entry === "string" ? { polity: entry, learnedDate: "" } : { ...entry }));
    const seenStatus = lower(row.status) || "active";
    for (const learner of learners) {
      const existing = knownTo.find((entry) => lower(entry?.polity) === lower(learner));
      if (existing) {
        existing.learnedDate = stamp || existing.learnedDate;
        existing.seenStatus = seenStatus;
      } else if (seenStatus === "active") {
        // A past arrangement nobody told you of is not news worth an agent's
        // cable; only a standing one is uncovered for the first time.
        knownTo.push({ polity: learner, learnedDate: stamp, seenStatus });
      }
    }
    return { ...row, knownTo };
  });
  return { ...world, puppets };
};

export const applyDiplomaticUpdates = ({
  world,
  relationUpdates,
  agreementUpdates,
  puppetUpdates,
  refusedDemands = [],
  events = [],
  stopDate = "",
  round = 0,
  // A Round-Zero baseline: an agreement with no signing event has no known
  // start (applyAgreementUpdates).
  allowUnboundBaseline = false,
  regionCatalog = [],
  // How many records of each kind to read. A single model answer is held to
  // the per-answer caps (the default); a merged turn passes Infinity, since
  // every segment's answer was already held to them.
  limit,
} = {}) => {
  const relationMerge = applyRelationUpdates({
    world,
    updates: relationUpdates,
    events,
    stopDate,
    round,
    limit,
  });
  const agreementMerge = applyAgreementUpdates({
    world: relationMerge.world,
    updates: agreementUpdates,
    events,
    stopDate,
    round,
    allowUnboundBaseline,
    limit,
  });
  // Puppets merge LAST, so a revolt's fallout lands on the relation and the
  // agreements this same pass has already written rather than under them.
  const puppetMerge = applyPuppetUpdates({
    world: agreementMerge.world,
    updates: puppetUpdates,
    refusedDemands,
    regionCatalog,
    events,
    stopDate,
    round,
    limit,
  });
  return {
    world: puppetMerge.world,
    relations: relationMerge.relations,
    agreements: agreementMerge.agreements,
    puppets: puppetMerge.puppets,
    appliedRelationIds: relationMerge.appliedIds,
    appliedAgreementIds: agreementMerge.appliedIds,
    appliedPuppetIds: puppetMerge.appliedIds,
    droppedPuppetUpdates: puppetMerge.dropped,
    refusedDemandCount: puppetMerge.refusedDemandCount,
    puppetStorylineSeeds: puppetMerge.storylineSeeds,
  };
};

const agreementDisplay = (agreement, world) => {
  const parties = array(agreement.parties).map((party) => diplomaticDisplayName(world, party));
  const role = agreement.type === "guarantee" && agreement.guarantor && agreement.beneficiary
    ? ` | guarantor ${diplomaticDisplayName(world, agreement.guarantor)} → ${diplomaticDisplayName(world, agreement.beneficiary)}`
    : "";
  return `- ${agreement.id} | ${String(agreement.status || "active").toUpperCase()} | ${agreement.type} | ${agreement.title} | parties: ${parties.join(", ")}${role}` +
    (clean(agreement.terms) ? ` | terms: ${clean(agreement.terms).slice(0, 600)}` : "");
};

const puppetDisplay = (row, world) => {
  const overlord = diplomaticDisplayName(world, row.overlord);
  const puppet = diplomaticDisplayName(world, row.puppet);
  const secrecy = row.secrecy === "covert" ? "COVERT" : "open";
  const knownTo = array(row.knownTo)
    .map((entry) => diplomaticDisplayName(world, entry?.polity || entry))
    .filter((name) => lower(name) !== lower(overlord) && lower(name) !== lower(puppet));
  // Whether the Overlord could plausibly SEE trouble coming inside its own
  // Puppet. The engine owns that fact, the model owns the fiction — the same
  // line the projects board draws between whether a question can honestly be
  // asked and what the answer is. Without it the model simply invented whether
  // foreknowledge was earned, which made "warning is bought with espionage"
  // untrue whenever it guessed generously.
  const watching = array(world.spies).some((spy) =>
    lower(spy?.owner) === lower(row.overlord) && lower(spy?.target) === lower(row.puppet) && lower(spy?.status) === "active");
  const service = Number(world.intelligence?.[row.overlord]);
  const eyes = watching
    ? " | the overlord has an agent inside: unrest there is visible to it"
    : Number.isFinite(service) && service >= 70
      ? " | the overlord's services are strong: it may catch word of unrest there"
      : " | the overlord has no eyes inside: unrest there would take it by surprise";

  return `- ${overlord} directs ${puppet} | ${row.kind} | ${secrecy} | loyalty ${row.loyalty}${eyes}` +
    (row.startedDate ? ` | since ${row.startedDate}` : "") +
    (row.secrecy === "covert" ? ` | also known to: ${knownTo.length ? knownTo.join(", ") : "nobody else"}` : "");
};

const relationDisplay = (relation, world) =>
  `- ${diplomaticDisplayName(world, relation.a)} ↔ ${diplomaticDisplayName(world, relation.b)} | ${relation.status} ${Number(relation.score) >= 0 ? "+" : ""}${relation.score}` +
  (clean(relation.summary) ? ` | ${clean(relation.summary).slice(0, 240)}` : "");

const politySetKey = (value) => lower(value);

// How the slice is read, the same under every slice: a time skip states it
// once, in the part of its prompt that never changes (gameplay.js
// buildJumpStaticRules), and takes it out of the slice it is sent.
export const DIPLOMATIC_SLICE_RULES = [
  "A Puppet is a SEPARATE COUNTRY: it holds its own territory and its own sovereignty, and only its will is directed. A COVERT subordination is known only to the two parties and anyone listed; a covert Puppet speaking to anyone else must present itself as fully independent. Loyalty is never public knowledge, not even for an open arrangement.",
  "Sparse-ledger rule: an untracked pair is NOT secretly hostile and is NOT a numeric score of zero. It only means no material bilateral state has yet been canonically recorded.",
  "Formal commitments and bilateral warmth are different facts. An alliance may be strained; friendly countries may have no alliance.",
  "world.wars remains the sole authority for actual belligerency. A hostile relation does not itself start a war. An alliance, a mutual defence agreement or a guarantee binds: when a party is attacked the game itself enters the others in that war, and one that will not come has broken the treaty and pays for it in reputation.",
].join("\n");

export const buildBoundedDiplomaticContext = (
  worldLike,
  {
    playerPolity = "",
    focusActors = [],
    selectedStorylines = [],
    maxActors = MAX_CONTEXT_ACTORS,
  } = {},
) => {
  const world = normalizeWorldState(worldLike);
  // Its own copy of the world, only read here: one identity index for every name
  // below, where each name built the index again (2026-10-24).
  const identityIndex = buildPolityIdentityIndex(world);
  const requested = [
    playerPolity,
    ...array(focusActors),
    ...array(selectedStorylines).flatMap((storyline) => array(storyline?.participants)),
  ].map((actor) => canonicalDiplomaticPolity(actor, world, { identityIndex })).filter(Boolean);

  const actorKeys = new Set();
  const actors = [];
  const pushActor = (actor) => {
    const canonical = canonicalDiplomaticPolity(actor, world, { identityIndex });
    const key = politySetKey(canonical);
    if (!canonical || actorKeys.has(key) || actors.length >= maxActors) return;
    actorKeys.add(key);
    actors.push(canonical);
  };
  requested.forEach(pushActor);

  // Freeze the caller-selected attention set before one-hop expansion. Actors
  // pulled in by a subordination, commitment or war may be shown, but they must
  // not recursively pull in their own diplomatic graph.
  const seedActorKeys = new Set(actorKeys);

  // A live Puppet relationship is a direct canonical dependency, not a generic
  // bilateral mood. Pull the counterpart into the same bounded attention slice
  // before looser agreement/war expansion so a seed actor never appears without
  // the polity that currently directs it (or whose will it currently directs).
  // This is whole-world simulator context, so canonical truth is intentional;
  // actor-relative chat/Advisor surfaces continue to use runtime/puppets.js.
  for (const row of array(world.puppets)) {
    if (lower(row?.status || "active") !== "active") continue;
    const overlord = canonicalDiplomaticPolity(row?.overlord, world, { identityIndex });
    const puppet = canonicalDiplomaticPolity(row?.puppet, world, { identityIndex });
    if (!overlord || !puppet) continue;
    const overlordSeed = seedActorKeys.has(politySetKey(overlord));
    const puppetSeed = seedActorKeys.has(politySetKey(puppet));
    if (!overlordSeed && !puppetSeed) continue;
    if (overlordSeed) pushActor(puppet);
    if (puppetSeed) pushActor(overlord);
    if (actors.length >= maxActors) break;
  }

  // Formal commitments and current wars can pull in a directly connected actor,
  // but the whole context remains bounded.
  for (const agreement of normalizedAgreements(world)) {
    if (!["active", "suspended"].includes(agreement.status)) continue;
    if (!array(agreement.parties).some((party) => seedActorKeys.has(politySetKey(party)))) continue;
    array(agreement.parties).forEach(pushActor);
    if (actors.length >= maxActors) break;
  }
  for (const war of array(world.wars)) {
    if (!["active", "ceasefire"].includes(lower(war?.status))) continue;
    const parties = [...array(war?.sideA), ...array(war?.sideB)]
      .map((party) => canonicalDiplomaticPolity(party, world, { identityIndex }))
      .filter(Boolean);
    if (!parties.some((party) => seedActorKeys.has(politySetKey(party)))) continue;
    parties.forEach(pushActor);
    if (actors.length >= maxActors) break;
  }

  const relations = normalizedRelations(world)
    .filter((relation) => actorKeys.has(politySetKey(relation.a)) && actorKeys.has(politySetKey(relation.b)))
    .sort((a, b) => Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0))
    .slice(0, MAX_CONTEXT_RELATIONS);

  const agreements = normalizedAgreements(world)
    .filter((agreement) => ["active", "suspended"].includes(agreement.status))
    .filter((agreement) => {
      const parties = array(agreement.parties);
      return parties.length > 0 && parties.every((party) => actorKeys.has(politySetKey(party)));
    })
    .slice(0, MAX_CONTEXT_AGREEMENTS);

  // Every standing subordination up to MAX_CONTEXT_PUPPETS, the attention
  // actors' first, as the TRUTH — loyalty, secrecy and who else has found out.
  // Not only the attention actors': a covert Puppet left out of the slice is a
  // country the simulator narrates as independent. This context reaches the
  // jump, the idle
  // diplomacy pass and next-speaker, all of which reason about the whole world.
  // It does NOT reach a leader or a group turn, and must not: a leader speaks as
  // one country and is briefed on what that country knows instead
  // (runtime/puppets.js puppetBriefingFor). An earlier comment here said the chat
  // task read this block; it never did, and believing so hid that a covert
  // Puppet in conversation did not know it was one.
  const inAttention = (row) => actorKeys.has(politySetKey(row.overlord)) || actorKeys.has(politySetKey(row.puppet));
  const puppets = array(world.puppets)
    .filter((row) => row.status === "active")
    .sort((a, b) => Number(inAttention(b)) - Number(inAttention(a)))
    .slice(0, MAX_CONTEXT_PUPPETS);

  const text = [
    `[Canonical Diplomatic State v${DIPLOMATIC_DIRECTOR_VERSION} — bounded relevant slice]`,
    `Attention actors (${actors.length}/${maxActors} max): ${actors.length ? actors.map((actor) => diplomaticDisplayName(world, actor)).join(", ") : "none"}`,
    "",
    "BILATERAL RELATIONS",
    relations.length ? relations.map((relation) => relationDisplay(relation, world)).join("\n") : "No tracked bilateral relation among these attention actors.",
    "",
    "FORMAL AGREEMENTS / COMMITMENTS",
    agreements.length ? agreements.map((agreement) => agreementDisplay(agreement, world)).join("\n") : "No active/suspended formal agreement among these attention actors.",
    "",
    "SUBORDINATIONS (who directs whom)",
    puppets.length ? puppets.map((row) => puppetDisplay(row, world)).join("\n") : "No polity here directs another.",
    DIPLOMATIC_SLICE_RULES,
  ].join("\n");

  return { actors, relations, agreements, puppets, text };
};
