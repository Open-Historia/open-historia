// Open Historia — native diplomatic state director (from kernely's Continuum branch).
//
// What it owns:
// - sparse canonical bilateral relations (world.relations)
// - formal agreements / alliances / guarantees (world.agreements)
// - bounded diplomatic context for AI attention
// - compact relation/agreement update transport
// - one-time deterministic migration from explicit legacy treaty/alliance events
//
// Design rule: persistent world, bounded attention. The save may remember many
// diplomatic facts; any one AI request sees only the relevant slice.

import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { MAX_PUPPETS, PUPPET_KINDS } from "../../runtime/puppets.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { compareGameDates, isGameDate } from "../../runtime/gameDates.js";

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

export const canonicalDiplomaticPolity = (token, world, { allowUnknown = false } = {}) => {
  const raw = clean(token);
  if (!raw) return "";
  const resolved = resolvePolityIdentity(raw, world, {
    allowUnknown,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
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

export const decodeRelationUpdates = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return decodeRelationLine(entry, index);
      if (!entry || typeof entry !== "object") return null;
      const score = Number(entry.score);
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
    }).filter(Boolean).slice(0, MAX_RELATION_UPDATES_PER_PASS);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => decodeRelationLine(line, index))
    .filter((entry) => entry.a || entry.b || entry.summary)
    .slice(0, MAX_RELATION_UPDATES_PER_PASS);
};

const decodeAgreementLine = (line, index) => {
  const text = String(line ?? "");
  const rawParts = text.split(SEP);

  // Accept both legacy seven-field records and the native-linked six-field form
  // id~op~type~parties~title~terms where Javascript owns event binding.
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

export const decodeAgreementUpdates = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return decodeAgreementLine(entry, index);
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
    }).filter(Boolean).slice(0, MAX_AGREEMENT_UPDATES_PER_PASS);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => decodeAgreementLine(line, index))
    .filter((entry) => entry.id && entry.op)
    .slice(0, MAX_AGREEMENT_UPDATES_PER_PASS);
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

export const bindRelationUpdatesToEvents = (updates, events) =>
  bindEventIds(decodeRelationUpdates(updates), events);

export const bindAgreementUpdatesToEvents = (updates, events) =>
  bindEventIds(decodeAgreementUpdates(updates), events);

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

const SEARCH_STOPWORDS = new Set([
  "about", "after", "again", "against", "among", "between", "during", "from",
  "into", "over", "that", "their", "there", "these", "this", "through", "under",
  "with", "without", "government", "empire", "kingdom", "republic", "state",
  "states", "country", "countries", "event", "relation", "relations", "update",
]);

const diplomaticSearchText = (value) => String(value ?? "")
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const diplomaticSearchTokens = (value) =>
  [...new Set(diplomaticSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !SEARCH_STOPWORDS.has(token)))];

const politySearchAliases = (token, world) => {
  const aliases = new Set();
  const push = (value) => {
    const normalized = diplomaticSearchText(value);
    if (normalized) aliases.add(normalized);
  };

  const canonical = canonicalDiplomaticPolity(token, world, { allowUnknown: true });
  push(token);
  push(canonical);
  push(diplomaticDisplayName(world, canonical));

  for (const [key, record] of Object.entries(world?.polityOverrides || {})) {
    const candidates = [key, record?.code, record?.name, ...array(record?.aliases)];
    const belongs = candidates.some((candidate) =>
      lower(canonicalDiplomaticPolity(candidate, world, { allowUnknown: true })) === lower(canonical));
    if (!belongs) continue;
    candidates.forEach(push);
  }

  // Generic political-form stripping catches common prose such as "British" from
  // "British Empire" or "Denmark" from "Kingdom of Denmark" without hard-coding
  // any country. These are only search aliases; canonical identity is unchanged.
  for (const value of [...aliases]) {
    push(value
      .replace(/^(the )?(kingdom|republic|empire|federation|commonwealth|union|state) of /, "")
      .replace(/ (kingdom|republic|empire|federation|commonwealth|union|state)$/, ""));
  }

  return [...aliases].filter((value) => value.length >= 3);
};

const eventDiplomaticSearchText = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const structuredActors = [
    ...array(event?.combatants),
    ...array(impacts?.polityChanges).flatMap((entry) => [entry?.code, entry?.name]),
    ...array(impacts?.createdChats).flatMap((chat) => [chat?.speaker, ...array(chat?.countries)]),
  ];
  return diplomaticSearchText([
    event?.id,
    event?.title,
    event?.description,
    event?.summary,
    event?.quote?.text,
    event?.quote?.speaker,
    ...structuredActors,
  ].filter(Boolean).join(" "));
};

const textContainsAlias = (text, alias) =>
  Boolean(alias && (` ${text} `).includes(` ${alias} `));

const inferUniqueDiplomaticEventIndex = ({
  events,
  actorAliases = [],
  subjectText = "",
  minimumActorHits = 1,
} = {}) => {
  const normalizedEvents = normalizeEvents(events);
  if (!normalizedEvents.length) return -1;

  const subjectTokens = diplomaticSearchTokens(subjectText);
  const scored = normalizedEvents.map((event, index) => {
    const eventText = eventDiplomaticSearchText(event);
    const actorHits = actorAliases.reduce(
      (count, aliases) => count + (array(aliases).some((alias) => textContainsAlias(eventText, alias)) ? 1 : 0),
      0,
    );
    const eventTokens = new Set(diplomaticSearchTokens(eventText));
    const subjectOverlap = subjectTokens.filter((token) => eventTokens.has(token)).length;
    const score = actorHits * 8 + Math.min(subjectOverlap, 8);
    return { index, actorHits, subjectOverlap, score };
  });

  // With only one generated event, one concrete actor or subject overlap is enough
  // to establish causality; there is no competing event to mis-bind to.
  if (
    scored.length === 1 &&
    (
      scored[0].actorHits >= minimumActorHits ||
      scored[0].subjectOverlap >= 1
    )
  ) {
    return 0;
  }

  const strong = scored.filter((row) =>
    row.actorHits >= minimumActorHits &&
    (
      row.actorHits >= Math.min(2, actorAliases.length || 1) ||
      row.subjectOverlap >= 2 ||
      (actorAliases.length === 1 && row.subjectOverlap >= 1)
    ));
  const pool = strong.length
    ? strong
    : scored.filter((row) => row.subjectOverlap >= 4 && row.score >= 4);

  if (!pool.length) return -1;
  pool.sort((a, b) => b.score - a.score || b.actorHits - a.actorHits || b.subjectOverlap - a.subjectOverlap);
  const best = pool[0];
  const second = pool[1];

  // Only repair when one event is clearly the best causal match. Ambiguous
  // bookkeeping is safer to drop than to attach to the wrong canonical event.
  if (second && second.score === best.score && second.actorHits === best.actorHits && second.subjectOverlap === best.subjectOverlap) {
    return -1;
  }
  if (second && best.score - second.score < 2 && best.actorHits <= second.actorHits) {
    return -1;
  }
  return best.index;
};

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

const salvageUnboundRelationUpdates = (
  updates,
  events,
  world,
  { retainUnbound = false } = {},
) => {
  const normalizedEvents = normalizeEvents(events);
  const kept = [];
  let repaired = 0;
  let dropped = 0;
  let retainedUnbound = 0;

  for (const update of bindRelationUpdatesToEvents(updates, normalizedEvents)) {
    if (linkedEvents(update, normalizedEvents).length) {
      kept.push(update);
      continue;
    }

    const a = canonicalDiplomaticPolity(update?.a, world);
    const b = canonicalDiplomaticPolity(update?.b, world);
    const inferredIndex = inferUniqueDiplomaticEventIndex({
      events: normalizedEvents,
      actorAliases: [
        politySearchAliases(a || update?.a, world),
        politySearchAliases(b || update?.b, world),
      ],
      subjectText: update?.summary,
      minimumActorHits: 1,
    });

    if (inferredIndex >= 0) {
      const eventId = clean(normalizedEvents[inferredIndex]?.id);
      kept.push({
        ...update,
        eventIndexes: [inferredIndex],
        eventIds: eventId ? [eventId] : [],
      });
      repaired += 1;
      console.warn(
        `[OH diplomacy native binding] bound relation ${a || update?.a} ↔ ${b || update?.b} ` +
        `to event${inferredIndex + 1} from native causal evidence.`,
      );
      continue;
    }

    if (retainUnbound) {
      // Round Zero is an as-of baseline, not a claim that one event in the bounded
      // pregame timeline "caused" the entire bilateral climate. Preserve the
      // structurally valid relation as initial political memory when no unique
      // event anchor exists. Ordinary turn-to-turn relation mutations still fail
      // closed unless they can be tied to a causal event.
      kept.push({
        ...update,
        eventIndexes: [],
        eventIds: [],
      });
      retainedUnbound += 1;
      console.info(
        `[OH diplomacy baseline] retained initial relation ${a || update?.a} ↔ ${b || update?.b} ` +
        "without forcing a false unique-event attribution.",
      );
      continue;
    }

    dropped += 1;
    console.warn(
      `[OH diplomacy native binding] dropped relation ${a || update?.a} ↔ ${b || update?.b}; ` +
      "no unique causal event could be identified.",
    );
  }

  return { updates: kept, repaired, dropped, retainedUnbound };
};

const salvageUnboundAgreementUpdates = (
  updates,
  events,
  world,
  { retainUnbound = false } = {},
) => {
  const normalizedEvents = normalizeEvents(events);
  const kept = [];
  let repaired = 0;
  let dropped = 0;
  let retainedUnbound = 0;
  const existingAgreements = agreementMapFromWorld(world);

  for (const update of bindAgreementUpdatesToEvents(updates, normalizedEvents)) {
    if (linkedEvents(update, normalizedEvents).length) {
      kept.push(update);
      continue;
    }

    // Lifecycle updates may intentionally omit unchanged parties/title/terms. Reuse
    // the existing canonical agreement as inference context rather than making the
    // model restate redundant bookkeeping just so native code can find its event.
    const prior = existingAgreements.get(clean(update?.id)) || null;
    const canonicalParties = canonicalizeParties(
      array(update?.parties).length ? update.parties : prior?.parties,
      world,
    );
    const inferredIndex = inferUniqueDiplomaticEventIndex({
      events: normalizedEvents,
      actorAliases: canonicalParties.map((party) => politySearchAliases(party, world)),
      subjectText: `${
        update?.title || prior?.title || ""
      } ${
        update?.terms || prior?.terms || ""
      } ${update?.op || ""}`,
      minimumActorHits: canonicalParties.length >= 2 ? 2 : 1,
    });

    if (inferredIndex >= 0) {
      const eventId = clean(normalizedEvents[inferredIndex]?.id);
      kept.push({
        ...update,
        eventIndexes: [inferredIndex],
        eventIds: eventId ? [eventId] : [],
      });
      repaired += 1;
      console.warn(
        `[OH diplomacy native binding] bound agreement ${update?.id || "<missing id>"} ${update?.op || ""} ` +
        `to event${inferredIndex + 1} from native causal evidence.`,
      );
      continue;
    }

    if (retainUnbound) {
      // A standing agreement that predates Round One is baseline state. The bounded
      // timeline is not required to contain its original signing/ratification card.
      // Preserve the valid instrument rather than deleting real Day-1 diplomacy.
      kept.push({
        ...update,
        eventIndexes: [],
        eventIds: [],
      });
      retainedUnbound += 1;
      console.info(
        `[OH diplomacy baseline] retained initial agreement ${update?.id || "<missing id>"} ${update?.op || ""} ` +
        "without requiring its historical signing event to be present in the bounded pregame timeline.",
      );
      continue;
    }

    dropped += 1;
    console.warn(
      `[OH diplomacy native binding] dropped agreement ${update?.id || "<missing id>"} ${update?.op || ""}; ` +
      "no unique causal event could be identified.",
    );
  }

  return { updates: kept, repaired, dropped, retainedUnbound };
};

export const bindDiplomaticLedgerToCausalEvents = (
  candidate,
  {
    world = {},
    dropAmbiguous = true,
    retainUnbound = false,
  } = {},
) => {
  if (!candidate || typeof candidate !== "object") {
    return {
      relationUpdates: [],
      agreementUpdates: [],
      repairedRelations: 0,
      droppedRelations: 0,
      retainedUnboundRelations: 0,
      repairedAgreements: 0,
      droppedAgreements: 0,
      retainedUnboundAgreements: 0,
    };
  }

  const events = normalizeEvents(candidate?.events);

  // AI-supplied indexes/ids are hints only on world-generation paths. Strip them
  // before inference so a perfectly valid but WRONG number cannot silently bind a
  // canonical relation/agreement to an unrelated event.
  const relationInputs = decodeRelationUpdates(candidate?.relationUpdates)
    .map((update) => ({ ...update, eventIndexes: [], eventIds: [] }));
  const agreementInputs = decodeAgreementUpdates(candidate?.agreementUpdates)
    .map((update) => ({ ...update, eventIndexes: [], eventIds: [] }));

  const relationBinding = salvageUnboundRelationUpdates(
    relationInputs,
    events,
    world,
    { retainUnbound },
  );
  const agreementBinding = salvageUnboundAgreementUpdates(
    agreementInputs,
    events,
    world,
    { retainUnbound },
  );

  const relationUpdates = (dropAmbiguous || retainUnbound)
    ? relationBinding.updates
    : relationInputs;
  const agreementUpdates = (dropAmbiguous || retainUnbound)
    ? agreementBinding.updates
    : agreementInputs;

  candidate.relationUpdates = relationUpdates;
  candidate.agreementUpdates = agreementUpdates;

  return {
    relationUpdates,
    agreementUpdates,
    repairedRelations: relationBinding.repaired,
    droppedRelations: relationBinding.dropped,
    retainedUnboundRelations: relationBinding.retainedUnbound || 0,
    repairedAgreements: agreementBinding.repaired,
    droppedAgreements: agreementBinding.dropped,
    retainedUnboundAgreements: agreementBinding.retainedUnbound || 0,
  };
};

const sameCanonicalPartySet = (left, right, world) => {
  const a = canonicalizeParties(left, world).map(lower).sort();
  const b = canonicalizeParties(right, world).map(lower).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const agreementTitleLooksCompatible = (left, right) => {
  const a = lower(left);
  const b = lower(right);
  if (!a || !b || a === b || a.includes(b) || b.includes(a)) return true;
  const tokens = (value) => [...new Set(value.split(/[^a-z0-9]+/).filter((token) => token.length >= 4))];
  const aTokens = tokens(a);
  const bTokens = new Set(tokens(b));
  if (!aTokens.length || !bTokens.size) return false;
  const overlap = aTokens.filter((token) => bTokens.has(token)).length;
  return overlap / Math.min(aTokens.length, bTokens.size) >= 0.6;
};

// World-generation models occasionally re-emit `start` for an agreement that is
// already canonical and active. That is a lifecycle bookkeeping mistake, not a
// reason to erase an otherwise-valid month. Repair ONLY when the stable id,
// parties, type and title are compatible with the existing instrument. A truly
// conflicting reuse of an id remains fatal.
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
    const titleCompatible = !clean(update?.title) || agreementTitleLooksCompatible(update.title, prior.title);

    // Same id but different instrument details is not safe to infer. Leave it
    // untouched so normal validation rejects the collision.
    if (!partiesCompatible || !typeCompatible || !titleCompatible) {
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

    // Exact/near-exact re-announcement of an already-active pact carries no
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
  if (!candidate || typeof candidate !== "object") return { rewritten: 0, dropped: 0 };

  const wasString = typeof candidate?.agreementUpdates === "string";
  const updates = decodeAgreementUpdates(candidate?.agreementUpdates);
  const existing = agreementMapFromWorld(world);
  const startedHere = new Set(updates.filter((update) => update.op === "start").map((update) => clean(update.id)));
  const output = [];
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
    console.warn(
      `[OH diplomacy lifecycle repair] dropped ${update.op} for unknown agreement ${id}: ` +
      (matches.length > 1
        ? `${matches.length} recorded agreements fit it equally, and guessing could change the wrong one.`
        : "no recorded agreement matches its exact parties and type, so there is nothing to change.") +
      " The turn and its events stand.",
    );
  }

  candidate.agreementUpdates = wasString ? encodeAgreementUpdates(output) : output;
  return { rewritten, dropped };
};

export const validateDiplomaticLedgerPayload = (
  candidate,
  {
    world = {},
    allowNativeBinding = false,
    allowUnboundBaseline = false,
  } = {},
) => {
  const events = normalizeEvents(candidate?.events);

  // Ordinary world simulation is allowed to repair redundant lifecycle verbs
  // before structural validation. GM/admin preview remains fail-closed.
  if (allowNativeBinding) {
    const lifecycleRepair = normalizeDuplicateAgreementStarts(candidate, world);
    if (lifecycleRepair.repaired || lifecycleRepair.dropped) {
      console.info(
        `[OH diplomacy lifecycle repair] ${lifecycleRepair.repaired} duplicate start(s) normalized, ` +
        `${lifecycleRepair.dropped} redundant start(s) dropped.`,
      );
    }
    // The GM/admin preview (allowNativeBinding false) stays fail-closed: an
    // administrator naming an agreement that does not exist should be told so.
    normalizeUnknownAgreementLifecycle(candidate, world);
  }

  // A declared status that contradicts the absolute score is the model writing
  // a magnitude or a delta. Ordinary simulation repairs it (and says so); a GM
  // preview stays fail-closed so the administrator sees the contradiction.
  const reconciled = reconcileRelationScoresWithStatus(candidate?.relationUpdates);
  if (reconciled.repaired.length) {
    const first = reconciled.repaired[0];
    if (!allowNativeBinding) {
      return `Relation update ${first.a} ↔ ${first.b} declares status "${first.declared}" but its score ${first.from} means "${first.implied}". ` +
        "The score is the ABSOLUTE new value from -100 (worst) to 100 (best), not a change; make the score and status agree.";
    }
    console.info(
      "[OH diplomacy score repair] " +
      reconciled.repaired.map((entry) => `${entry.a} ↔ ${entry.b}: ${entry.from} (${entry.implied}) → ${entry.to} (${entry.declared})`).join("; "),
    );
    candidate.relationUpdates = reconciled.records;
  }

  let relations = bindRelationUpdatesToEvents(candidate?.relationUpdates, events);
  let agreements = bindAgreementUpdatesToEvents(candidate?.agreementUpdates, events);

  // Structural/canonical errors remain fatal. Event linkage itself is native on
  // ordinary world-generation passes, but a malformed polity/status/agreement
  // operation is still a real state error and must not be papered over.
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

  if (allowNativeBinding) {
    const binding = bindDiplomaticLedgerToCausalEvents(candidate, {
      world,
      dropAmbiguous: true,
      retainUnbound: allowUnboundBaseline,
    });

    if (
      binding.repairedRelations ||
      binding.droppedRelations ||
      binding.repairedAgreements ||
      binding.droppedAgreements ||
      binding.retainedUnboundRelations ||
      binding.retainedUnboundAgreements
    ) {
      console.info(
        `[OH diplomacy native binding] relations ${binding.repairedRelations} bound / ${binding.retainedUnboundRelations || 0} baseline-retained / ${binding.droppedRelations} dropped; ` +
        `agreements ${binding.repairedAgreements} bound / ${binding.retainedUnboundAgreements || 0} baseline-retained / ${binding.droppedAgreements} dropped.`,
      );
    }

    relations = bindRelationUpdatesToEvents(candidate?.relationUpdates, events);
    agreements = bindAgreementUpdatesToEvents(candidate?.agreementUpdates, events);
  }

  for (const update of relations) {
    const a = canonicalDiplomaticPolity(update.a, world);
    const b = canonicalDiplomaticPolity(update.b, world);
    if (!update.eventIds.length && !update.eventIndexes.length) {
      if (allowUnboundBaseline) continue;
      return `Relation update ${a} ↔ ${b} must reference a causal event.`;
    }
    if (!linkedEvents(update, events).length) {
      if (allowUnboundBaseline) continue;
      return `Relation update ${a} ↔ ${b} does not resolve to a valid causal event in this response.`;
    }
  }

  for (const update of agreements) {
    if (!update.eventIds.length && !update.eventIndexes.length) {
      if (allowUnboundBaseline) continue;
      return `Agreement ${update.id} ${update.op} must reference a causal event.`;
    }
    if (!linkedEvents(update, events).length) {
      if (allowUnboundBaseline) continue;
      return `Agreement ${update.id} ${update.op} does not resolve to a valid causal event in this response.`;
    }
  }

  return "";
};

export const applyRelationUpdates = ({ world, updates, events = [], stopDate = "", round = 0, allowUnboundBaseline = false } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = relationMapFromWorld(nextWorld);
  const decoded = bindRelationUpdatesToEvents(updates, events);
  const applied = [];

  for (const update of decoded) {
    const causalEvents = linkedEvents(update, events);
    if (!causalEvents.length && !allowUnboundBaseline) {
      console.warn(
        `[OH diplomacy] dropped unbound relation update ${update?.a || "?"} ↔ ${update?.b || "?"}; ` +
        "a relation change may not persist without a causal event.",
      );
      continue;
    }

    const a = canonicalDiplomaticPolity(update.a, nextWorld);
    const b = canonicalDiplomaticPolity(update.b, nextWorld);
    const key = relationPairKey(a, b);
    if (!a || !b || !key || !Number.isFinite(update.score) || !RELATION_STATUS_SET.has(update.status)) {
      console.warn(`[OH diplomacy] dropped invalid relation update ${update.a} ↔ ${update.b}.`);
      continue;
    }
    const prior = map.get(key) || null;
    const date = updateDate(update, events, stopDate);
    const eventIds = unique([
      ...array(prior?.sourceEventIds),
      ...unique(update.eventIds, 24),
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

export const applyAgreementUpdates = ({ world, updates, events = [], stopDate = "", round = 0, allowUnboundBaseline = false } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = agreementMapFromWorld(nextWorld);
  const decoded = bindAgreementUpdatesToEvents(updates, events);
  const applied = [];

  for (const update of decoded) {
    const causalEvents = linkedEvents(update, events);
    if (!causalEvents.length && !allowUnboundBaseline) {
      console.warn(
        `[OH diplomacy] dropped unbound agreement update ${update?.id || "?"} ${update?.op || ""}; ` +
        "an agreement lifecycle change may not persist without a causal event.",
      );
      continue;
    }

    const prior = map.get(update.id) || null;
    // For a Round-Zero baseline with no signing event in the bounded timeline,
    // do not falsely claim the agreement started on the campaign start date.
    const date = causalEvents.length ? updateDate(update, events, stopDate) : "";
    const observedDate = date || (allowUnboundBaseline ? parseIsoDate(stopDate) : "");
    const eventIds = unique([
      ...array(prior?.sourceEventIds),
      ...unique(update.eventIds, 24),
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
// docs/adr/0003-puppet-ledger-and-secrecy.md. What a given viewer may SEE of a
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
// WHEN, and may decide never.
const COUP_STORYLINE_LOYALTY = 35;

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

export const decodePuppetUpdates = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return decodePuppetLine(entry, index);
      if (!entry || typeof entry !== "object") return null;
      const loyalty = Number(entry.loyalty);
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
    }).filter(Boolean).slice(0, MAX_PUPPET_UPDATES_PER_PASS);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => decodePuppetLine(line, index))
    .filter((entry) => entry.op || entry.overlord || entry.puppet)
    .slice(0, MAX_PUPPET_UPDATES_PER_PASS);
};

export const bindPuppetUpdatesToEvents = (updates, events) =>
  bindEventIds(decodePuppetUpdates(updates), events);

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
    // The revolt's event is already bound; this keeps the merge from refusing
    // the line when the caller is replaying a baseline turn.
    allowUnboundBaseline: true,
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

export const applyPuppetUpdates = ({
  world,
  updates,
  events = [],
  stopDate = "",
  round = 0,
  allowUnboundBaseline = false,
  refusedDemands = [],
} = {}) => {
  let nextWorld = normalizeWorldState(world);
  let rows = array(nextWorld.puppets).map((row) => ({ ...row }));
  const decoded = bindPuppetUpdatesToEvents(updates, events);
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

    const causalEvents = linkedEvents(update, events);
    if (!causalEvents.length && !allowUnboundBaseline) {
      drop(index, update, `${update.op} ${update.overlord || "?"} -> ${update.puppet || "?"} is tied to no event; a subordination may not persist without one.`);
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
    const eventIds = unique(update.eventIds, 24);
    const existing = livePuppetRow(rows, overlord, puppet);

    if (update.op === "install") {
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
  allowUnboundBaseline = false,
} = {}) => {
  const relationMerge = applyRelationUpdates({
    world,
    updates: relationUpdates,
    events,
    stopDate,
    round,
    allowUnboundBaseline,
  });
  const agreementMerge = applyAgreementUpdates({
    world: relationMerge.world,
    updates: agreementUpdates,
    events,
    stopDate,
    round,
    allowUnboundBaseline,
  });
  // Puppets merge LAST, so a revolt's fallout lands on the relation and the
  // agreements this same pass has already written rather than under them.
  const puppetMerge = applyPuppetUpdates({
    world: agreementMerge.world,
    updates: puppetUpdates,
    refusedDemands,
    events,
    stopDate,
    round,
    allowUnboundBaseline,
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
    (clean(agreement.terms) ? ` | terms: ${clean(agreement.terms).slice(0, 280)}` : "");
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
  const requested = [
    playerPolity,
    ...array(focusActors),
    ...array(selectedStorylines).flatMap((storyline) => array(storyline?.participants)),
  ].map((actor) => canonicalDiplomaticPolity(actor, world)).filter(Boolean);

  const actorKeys = new Set();
  const actors = [];
  const pushActor = (actor) => {
    const canonical = canonicalDiplomaticPolity(actor, world);
    const key = politySetKey(canonical);
    if (!canonical || actorKeys.has(key) || actors.length >= maxActors) return;
    actorKeys.add(key);
    actors.push(canonical);
  };
  requested.forEach(pushActor);

  // Freeze the caller-selected attention set before one-hop expansion. Actors
  // pulled in by a commitment or war may be shown, but they must not recursively
  // pull in their own diplomatic graph.
  const seedActorKeys = new Set(actorKeys);

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
      .map((party) => canonicalDiplomaticPolity(party, world))
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

  // Subordinations among the attention actors, as the TRUTH — loyalty, secrecy
  // and who else has found out. This context reaches the jump, the idle
  // diplomacy pass and next-speaker, all of which reason about the whole world.
  // It does NOT reach a leader or a group turn, and must not: a leader speaks as
  // one country and is briefed on what that country knows instead
  // (runtime/puppets.js puppetBriefingFor). An earlier comment here said the chat
  // task read this block; it never did, and believing so hid that a covert
  // Puppet in conversation did not know it was one.
  const puppets = array(world.puppets)
    .filter((row) => row.status === "active")
    .filter((row) => actorKeys.has(politySetKey(row.overlord)) || actorKeys.has(politySetKey(row.puppet)))
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
    "A Puppet is a SEPARATE COUNTRY: it holds its own territory and its own sovereignty, and only its will is directed. A COVERT subordination is known only to the two parties and anyone listed; a covert Puppet speaking to anyone else must present itself as fully independent. Loyalty is never public knowledge, not even for an open arrangement.",
    "Sparse-ledger rule: an untracked pair is NOT secretly hostile and is NOT a numeric score of zero. It only means no material bilateral state has yet been canonically recorded.",
    "Formal commitments and bilateral warmth are different facts. An alliance may be strained; friendly countries may have no alliance.",
    "world.wars remains the sole authority for actual belligerency. A hostile relation or alliance does not itself start a war.",
  ].join("\n");

  return { actors, relations, agreements, puppets, text };
};

const migrationAliasesForPolity = (canonical, polity) => {
  const values = new Set([
    canonical,
    clean(polity?.name),
    clean(polity?.code),
    ...array(polity?.aliases).map(clean),
  ].filter(Boolean));

  const seed = [...values];
  const irregular = {
    "german empire": ["germany", "german", "anglo-german", "franco-german"],
    "british empire": ["britain", "british", "united kingdom", "anglo"],
    "french republic": ["france", "french", "franco"],
    "russian empire": ["russia", "russian"],
    "austrian empire": ["austria", "austrian", "austro-hungarian", "austro"],
    "kingdom of italy": ["italy", "italian"],
    "kingdom of serbia": ["serbia", "serbian"],
    "kingdom of bulgaria": ["bulgaria", "bulgarian"],
    "kingdom of greece": ["greece", "greek", "greco"],
    "ottoman empire": ["ottoman", "sublime porte"],
    "kingdom of romania": ["romania", "romanian"],
    "kingdom of montenegro": ["montenegro", "montenegrin"],
  };
  for (const item of seed) {
    for (const alias of irregular[lower(item)] || []) values.add(alias);
    const plain = lower(item)
      .replace(/^the\s+/, "")
      .replace(/^(kingdom|republic|empire|state|grand duchy|duchy|principality) of\s+/, "")
      .replace(/\s+(kingdom|republic|empire|state)$/, "")
      .trim();
    if (plain.length >= 4) values.add(plain);
  }
  return [...values].filter(Boolean);
};

const buildMigrationRoster = (world) => {
  const owned = new Set([
    ...Object.values(world?.regionOwnershipOverrides || {}),
    ...Object.values(world?.regionSovereigntyOverrides || {}),
  ].map(lower).filter(Boolean));
  return Object.entries(world?.polityOverrides || {})
    .filter(([canonical, polity]) => {
      const mapRefs = array(polity?.mapRefs?.gadm0).filter(Boolean);
      return lower(polity?.status) === "active" || owned.has(lower(canonical)) || mapRefs.length > 0;
    })
    .map(([canonical, polity]) => ({
      canonical: clean(canonical),
      aliases: migrationAliasesForPolity(canonical, polity),
    }))
    .filter((entry) => entry.canonical);
};

const textMentionsAlias = (text, alias) => {
  const haystack = lower(text);
  const needle = lower(alias);
  if (!needle || needle.length < 4) return false;
  if (haystack.includes(needle)) return true;
  return false;
};

const findMigrationPartiesInText = (text, world, roster) => {
  const haystack = lower(text);
  const matches = [];
  for (const candidate of roster) {
    for (const alias of candidate.aliases) {
      const needle = lower(alias);
      if (!needle || needle.length < 4) continue;
      let from = 0;
      while (from < haystack.length) {
        const start = haystack.indexOf(needle, from);
        if (start < 0) break;
        matches.push({
          canonical: candidate.canonical,
          start,
          end: start + needle.length,
          length: needle.length,
        });
        from = start + Math.max(1, needle.length);
      }
    }
  }

  // Prefer the longest polity phrase at an overlapping occurrence. Without this,
  // "Austria-Hungary" also falsely matches a separate "Kingdom of Hungary" just
  // because the substring Hungary appears inside the compound name. A genuinely
  // separate Hungary mention elsewhere still survives as its own occurrence.
  const usable = matches.filter((match, index) => !matches.some((other, otherIndex) =>
    otherIndex !== index &&
    lower(other.canonical) !== lower(match.canonical) &&
    other.length > match.length &&
    other.start <= match.start &&
    other.end >= match.end
  ));

  usable.sort((a, b) => a.start - b.start || b.length - a.length || lower(a.canonical).localeCompare(lower(b.canonical)));
  return unique(usable.map((match) => match.canonical), 12);
};

const inferMigrationParties = (event, world, roster) => {
  const title = clean(event?.title);
  const description = clean(event?.description);
  const titleParties = findMigrationPartiesInText(title, world, roster);
  if (titleParties.length >= 2) return titleParties;

  // Legacy prose often mentions treaty targets/opponents after the signatories.
  // Prefer the grammatical signatory clause immediately before sign/conclude/etc.
  // Example: "delegates from Serbia and Bulgaria formally sign ..." should not
  // accidentally add the British chair or the Ottoman target later in the text.
  const verbMatch = /\b(?:sign(?:s|ed)?|conclud(?:e|es|ed)|ratif(?:y|ies|ied)|finaliz(?:e|es|ed))\b/i.exec(description);
  let scope = description;
  if (verbMatch) {
    const before = description.slice(0, verbMatch.index);
    const subjectPattern = /\b(?:delegates? from|delegations? from|representatives? of|representatives? from|plenipotentiaries from|governments? of|leaders? of)\b/ig;
    let subject = null;
    for (const match of before.matchAll(subjectPattern)) subject = match;
    if (subject) scope = before.slice(subject.index + subject[0].length);
    else scope = before.slice(Math.max(0, before.length - 240));
  } else {
    scope = description.split(/[.!?]/)[0] || description;
  }

  const scoped = findMigrationPartiesInText(scope, world, roster);
  if (scoped.length >= 2) return scoped;

  const direct = unique(event?.combatants, 8)
    .map((actor) => canonicalDiplomaticPolity(actor, world))
    .filter(Boolean);
  return unique([...titleParties, ...scoped, ...direct], 12);
};

const LEGACY_FORMAL_PAIR = /\b(?:sign(?:s|ed)?|conclud(?:e|es|ed)|ratif(?:y|ies|ied)|finaliz(?:e|es|ed))\b.{0,100}\b(?:treaty|alliance|mutual defense|defence pact|pact|accord|agreement|protocol|convention|guarantee|non[- ]aggression)\b|\b(?:treaty|alliance|mutual defense|defence pact|pact|accord|agreement|protocol|convention|guarantee|non[- ]aggression)\b.{0,100}\b(?:sign(?:s|ed)?|conclud(?:e|es|ed)|ratif(?:y|ies|ied)|finaliz(?:e|es|ed))\b/i;
const LEGACY_NEGOTIATION_ONLY = /\b(?:talks?|negotiations?|proposal|draft|preliminary meeting|exploratory|considers?|discuss(?:es|ed|ion)|seeks?|calls? for)\b/i;
const LEGACY_REJECTION = /\b(?:reject(?:s|ed|ion)?|declin(?:e|es|ed)|refus(?:e|es|ed)|collapse(?:s|d)?|breaks? down|fails?)\b/i;

const isLegacyFormalAgreementEvent = (title, description) => {
  const text = `${title} ${description}`;
  if (LEGACY_REJECTION.test(text)) return false;
  if (/\bnegotiations? to (?:finalize|conclude|sign|ratify)\b/i.test(text)) return false;
  if (/\bpreliminary framework\b/i.test(text) && !/\b(?:officially|formally) sign|\bratif/i.test(text)) return false;
  if (LEGACY_FORMAL_PAIR.test(title)) return true;
  // Description must contain the formal act itself, not merely mention an older
  // treaty whose provisions are now being implemented.
  return LEGACY_FORMAL_PAIR.test(description);
};

const inferLegacyAgreementType = (textValue) => {
  const text = lower(textValue);
  // Settlement language wins before generic military/accord vocabulary. A border
  // accord concluding a shooting crisis is not continuing military cooperation.
  if (/\bpeace treaty\b|\bpeace settlement\b|\bformally concludes? .*war\b|\bborder accord\b|\barmistice\b|\bceasefire agreement\b|\btruce accord\b/.test(text)) return "peace_settlement";
  if (/\bmutual defen[cs]e\b/.test(text)) return "mutual_defense";
  if (/\balliance\b/.test(text)) return "alliance";
  if (/\bguarantee\b/.test(text)) return "guarantee";
  if (/\bnon[- ]aggression\b/.test(text)) return "non_aggression";
  if (/\btrade\b|\bcommercial\b|\brailway\b|\bcustoms\b|\beconomic\b/.test(text)) return "trade_economic";
  if (/\bnaval\b|\bmilitary\b|\bgeneral staffs?\b|\bstrategic protocol\b|\bmobilization\b/.test(text)) return "military_cooperation";
  if (/\bfriendship\b|\bconsultation\b|\bconsultative\b/.test(text)) return "friendship_consultation";
  return "other";
};

const legacyRelationSeedForType = (type) => {
  switch (type) {
    case "alliance": return { score: 72, status: "friendly" };
    case "mutual_defense": return { score: 78, status: "friendly" };
    case "guarantee": return { score: 50, status: "cordial" };
    case "friendship_consultation": return { score: 48, status: "cordial" };
    case "military_cooperation": return { score: 42, status: "cordial" };
    case "trade_economic": return { score: 32, status: "cordial" };
    case "non_aggression": return { score: 8, status: "neutral" };
    case "peace_settlement": return { score: -5, status: "neutral" };
    default: return { score: 18, status: "cordial" };
  }
};

const legacyAgreementId = (event, type, parties) => {
  const base = slug(clean(event?.title)) || slug(`${type}-${parties.join("-")}`) || "legacy-agreement";
  return `agreement-${base}-${stableHash(clean(event?.id) || `${event?.date}|${event?.title}`)}`.slice(0, 120);
};

const writeLegacyRelation = (map, a, b, { score, status, summary, date, eventId } = {}) => {
  const key = relationPairKey(a, b);
  if (!key) return null;
  const prior = map.get(key);
  const ordered = [a, b].sort((x, y) => lower(x).localeCompare(lower(y)));
  const nextScore = clamp(Math.round(Number(score) || 0), -100, 100);
  const next = {
    id: prior?.id || relationIdForPair(ordered[0], ordered[1]),
    a: ordered[0],
    b: ordered[1],
    score: nextScore,
    status: normalizeRelationStatus(status, nextScore),
    summary: clean(summary) || clean(prior?.summary),
    lastUpdatedDate: parseIsoDate(date) || clean(prior?.lastUpdatedDate),
    sourceEventIds: unique([...(array(prior?.sourceEventIds)), clean(eventId)], 24),
    createdRound: Number(prior?.createdRound) || 0,
    updatedRound: Number(prior?.updatedRound) || 0,
  };
  map.set(key, next);
  return next;
};

const seedRelationFromAgreement = (map, world, parties, type, event) => {
  // Peace settlements are handled chronologically after hostility detection. For a
  // multilateral peace, co-victors/signatories are NOT automatically reset to
  // neutral merely because they signed the same conference treaty.
  if (type === "peace_settlement") return;
  const seed = legacyRelationSeedForType(type);
  for (let i = 0; i < parties.length; i += 1) {
    for (let j = i + 1; j < parties.length; j += 1) {
      const a = parties[i];
      const b = parties[j];
      const key = relationPairKey(a, b);
      if (!key) continue;
      const prior = map.get(key);
      const score = prior && Number(prior.score) >= 0 && seed.score >= 0
        ? Math.max(Number(prior.score), seed.score)
        : seed.score;
      writeLegacyRelation(map, a, b, {
        score,
        status: seed.status,
        summary: `Legacy migration: ${clean(event?.title)}`,
        date: event?.date,
        eventId: event?.id,
      });
    }
  }
};


const inferLegacyDirectedHostilities = (event, world, roster) => {
  const title = clean(event?.title);
  const patterns = [
    /\b(?:launch(?:es|ed)?|opens?|begins?)\b[^.]{0,70}\b(?:offensive|offensives|attack|attacks)\b[^.]{0,40}\bagainst\b/i,
    /\bdeclares? war on\b/i,
    /\binvades?\b/i,
  ];
  let pivot = -1;
  let pivotLength = 0;
  for (const rx of patterns) {
    const match = rx.exec(title);
    if (!match) continue;
    if (/against/i.test(match[0])) {
      const local = match[0].toLowerCase().lastIndexOf("against");
      pivot = match.index + local;
      pivotLength = "against".length;
    } else if (/declares? war on/i.test(match[0])) {
      const phrase = /declares? war on/i.exec(match[0]);
      pivot = match.index + phrase.index;
      pivotLength = phrase[0].length;
    } else {
      const phrase = /invades?/i.exec(match[0]);
      pivot = match.index + phrase.index;
      pivotLength = phrase[0].length;
    }
    break;
  }
  if (pivot < 0) return [];
  const left = findMigrationPartiesInText(title.slice(0, pivot), world, roster);
  const right = findMigrationPartiesInText(title.slice(pivot + pivotLength), world, roster);
  const pairs = [];
  for (const a of left) for (const b of right) {
    if (lower(a) !== lower(b)) pairs.push([a, b]);
  }
  return pairs;
};

const closeActiveLegacyAllianceForPair = (agreementMap, a, b, event) => {
  const date = parseIsoDate(event?.date);
  let closed = false;
  for (const agreement of agreementMap.values()) {
    if (!['alliance', 'mutual_defense'].includes(agreement.type) || agreement.status !== 'active') continue;
    const keys = new Set(array(agreement.parties).map(lower));
    if (!keys.has(lower(a)) || !keys.has(lower(b))) continue;
    const knownSince = parseIsoDate(agreement.startedDate || agreement.migratedEvidenceDate || agreement.lastUpdatedDate);
    if (knownSince && date && date <= knownSince) continue;
    agreement.status = 'ended';
    agreement.endedDate = date || agreement.lastUpdatedDate || agreement.startedDate || '';
    agreement.lastUpdatedDate = agreement.endedDate;
    agreement.terms = `${clean(agreement.terms)} Legacy migration note: superseded by later direct hostilities between signatories (${clean(event?.title)}).`.trim().slice(0, 900);
    agreement.sourceEventIds = unique([...array(agreement.sourceEventIds), clean(event?.id)], 24);
    closed = true;
  }
  return closed;
};

const applyLegacyHostilityEvent = (agreementMap, relationMap, event, world, roster) => {
  const pairs = inferLegacyDirectedHostilities(event, world, roster);
  for (const [a, b] of pairs) {
    const key = relationPairKey(a, b);
    const prior = relationMap.get(key);
    const eventDate = parseIsoDate(event?.date);
    const priorDate = parseIsoDate(prior?.lastUpdatedDate);
    const closedAlliance = closeActiveLegacyAllianceForPair(agreementMap, a, b, event);
    // When re-checking history after a later standing-alliance chat seed, an older
    // clash must not overwrite newer canonical evidence that the relationship had
    // already recovered. Chronological first-pass processing is unaffected.
    if (!closedAlliance && priorDate && eventDate && compareGameDates(eventDate, priorDate) < 0) continue;
    // Legacy migration is intentionally sparse. Historical combat does not by
    // itself create a permanent present-day relation row for every belligerent.
    // Preserve it only when the pair was already tracked (for example by a treaty)
    // or when the fighting is what broke a migrated alliance. Active wars are
    // seeded separately from the canonical world.wars ledger below.
    if (!closedAlliance && !relationMap.has(key)) continue;
    writeLegacyRelation(relationMap, a, b, {
      score: -70,
      status: 'hostile',
      summary: `Legacy migration: ${clean(event?.title)}`,
      date: event?.date,
      eventId: event?.id,
    });
  }
};

const applyLegacyPeaceAgreementRelation = (relationMap, agreement, event) => {
  const parties = array(agreement?.parties);
  const bilateral = parties.length === 2;
  for (let i = 0; i < parties.length; i += 1) {
    for (let j = i + 1; j < parties.length; j += 1) {
      const a = parties[i];
      const b = parties[j];
      const key = relationPairKey(a, b);
      if (!key) continue;
      const prior = relationMap.get(key);
      // A bilateral settlement establishes at least a tracked neutral post-war
      // relationship. In a multilateral settlement, only repair an already-negative
      // pair; do not invent neutral relations between co-signatories/co-victors.
      if (!bilateral && !(Number(prior?.score) < 0)) continue;
      writeLegacyRelation(relationMap, a, b, {
        score: -5,
        status: 'neutral',
        summary: `Legacy migration: ${clean(event?.title)}`,
        date: event?.date,
        eventId: event?.id,
      });
    }
  }
};


const LEGACY_CHAT_STANDING_ALLIANCE = /\b(?:under the\s+[A-Z][A-Za-z -]{1,45}\s+Alliance|our alliance\s+(?:remains|is|continues|stands|has)|our existing alliance|existing alliance between|mutual defen[cs]e\s+(?:treaty|alliance|pact))\b/i;

const chatCountryToken = (entry) => clean(
  entry && typeof entry === "object"
    ? entry.polityKey || entry.name || entry.code
    : entry,
);

const chatMessagePolity = (message, world) => canonicalDiplomaticPolity(
  message?.polityKey || message?.speaker || message?.code,
  world,
  { allowUnknown: false },
);

const namedAllianceTitleFromText = (textValue) => {
  const text = clean(textValue);
  const match = /\b(?:under the\s+)?([A-Z][A-Za-z -]{1,45}\s+Alliance)\b/.exec(text);
  return clean(match?.[1]);
};

const migrateLegacyStandingAlliancesFromChats = ({ agreementMap, relationMap, chats, game, world, roster }) => {
  const player = canonicalDiplomaticPolity(game?.country, world, { allowUnknown: false });
  if (!player) return 0;
  const playerRoster = roster.find((entry) => lower(entry.canonical) === lower(player));
  const playerAliases = unique([
    player,
    ...(array(playerRoster?.aliases)),
    clean(world?.countryStats?.[player]?.capital),
  ], 32);
  let added = 0;

  for (const chat of array(chats)) {
    const foreign = unique(array(chat?.countries)
      .map(chatCountryToken)
      .map((token) => canonicalDiplomaticPolity(token, world, { allowUnknown: false }))
      .filter((actor) => actor && lower(actor) !== lower(player)), 8);
    if (!foreign.length) continue;

    for (const message of array(chat?.messages)) {
      if (lower(message?.role) === "user") continue;
      const text = clean(message?.text);
      if (!text || !LEGACY_CHAT_STANDING_ALLIANCE.test(text)) continue;
      const speaker = chatMessagePolity(message, world);
      if (!speaker || lower(speaker) === lower(player) || !foreign.some((actor) => lower(actor) === lower(speaker))) continue;

      // Bilateral correspondence is unambiguous. In a group thread, require the
      // message itself to point back to the player by name/alias/capital so "our
      // alliance" cannot accidentally bind the speaker to every other participant.
      if (foreign.length > 1 && !playerAliases.some((alias) => textMentionsAlias(text, alias))) continue;

      const pairKey = relationPairKey(player, speaker);
      if (!pairKey) continue;
      const existingFormal = [...agreementMap.values()].some((agreement) =>
        ["active", "suspended"].includes(lower(agreement?.status)) &&
        ["alliance", "mutual_defense"].includes(lower(agreement?.type)) &&
        array(agreement?.parties).some((party) => lower(party) === lower(player)) &&
        array(agreement?.parties).some((party) => lower(party) === lower(speaker))
      );
      if (existingFormal) continue;

      const evidenceDate = parseIsoDate(message?.time);
      const type = /mutual defen[cs]e/i.test(text) ? "mutual_defense" : "alliance";
      const named = namedAllianceTitleFromText(text);
      const id = `agreement-legacy-standing-${stableHash(pairKey)}`;
      agreementMap.set(id, {
        id,
        title: named || `Standing alliance: ${diplomaticDisplayName(world, player)}–${diplomaticDisplayName(world, speaker)}`,
        type,
        status: "active",
        parties: [player, speaker],
        startedDate: "",
        endedDate: "",
        lastUpdatedDate: evidenceDate,
        terms: `Legacy migration from explicit standing-alliance language in diplomatic correspondence: ${text}`.slice(0, 800),
        sourceEventIds: [],
        createdRound: 0,
        updatedRound: 0,
        migratedLegacy: true,
        // Internal migration-only lower bound; gameState normalization intentionally
        // drops it after we have checked later event chronology.
        migratedEvidenceDate: evidenceDate,
      });
      const seed = legacyRelationSeedForType(type);
      const prior = relationMap.get(pairKey);
      seedRelationFromAgreement(relationMap, world, [player, speaker], type, {
        title: named || "Standing alliance explicitly referenced in diplomatic correspondence",
        date: evidenceDate,
        id: "",
      });
      // Do not let a generic chat seed weaken a stronger already-recorded positive
      // relationship created by a formal event.
      if (prior && Number(prior.score) > seed.score) relationMap.set(pairKey, prior);
      added += 1;
    }
  }
  return added;
};

const seedWarHostility = (relationMap, world) => {
  for (const war of array(world?.wars)) {
    if (!["active", "ceasefire"].includes(lower(war?.status))) continue;
    const sideA = canonicalizeParties(war?.sideA, world);
    const sideB = canonicalizeParties(war?.sideB, world);
    for (const a of sideA) {
      for (const b of sideB) {
        const key = relationPairKey(a, b);
        if (!key) continue;
        const prior = relationMap.get(key);
        const ordered = [a, b].sort((x, y) => lower(x).localeCompare(lower(y)));
        relationMap.set(key, {
          id: prior?.id || relationIdForPair(ordered[0], ordered[1]),
          a: ordered[0],
          b: ordered[1],
          score: Math.min(Number(prior?.score ?? -80), -70),
          status: "hostile",
          summary: `Active belligerency in ${clean(war?.title) || clean(war?.id) || "a canonical war"}.`,
          lastUpdatedDate: parseIsoDate(war?.lastUpdatedDate || war?.startedDate),
          sourceEventIds: unique([...(array(prior?.sourceEventIds)), ...array(war?.sourceEventIds)], 24),
          createdRound: Number(prior?.createdRound) || Number(war?.createdRound) || 0,
          updatedRound: Number(war?.updatedRound) || 0,
        });
      }
    }
  }
};

export const migrateLegacyDiplomaticState = ({ world: worldLike, events = [], chats = [], game = {} } = {}) => {
  const world = normalizeWorldState(worldLike);
  if (Number(world.diplomaticLedgerVersion) >= DIPLOMATIC_LEDGER_VERSION) {
    return { world, migrated: false, agreementsAdded: 0, relationsAdded: 0, scannedEvents: 0 };
  }

  const roster = buildMigrationRoster(world);
  const relationMap = relationMapFromWorld(world);
  const agreementMap = agreementMapFromWorld(world);
  const beforeRelations = relationMap.size;
  const beforeAgreements = agreementMap.size;
  const normalizedEvents = normalizeEvents(events)
    .slice()
    .sort((a, b) => compareGameDates(a?.date || "", b?.date || ""));

  for (const event of normalizedEvents) {
    const title = clean(event?.title);
    const description = clean(event?.description);
    const text = `${title} ${description}`;

    if (isLegacyFormalAgreementEvent(title, description) &&
        !(LEGACY_NEGOTIATION_ONLY.test(title) && !LEGACY_FORMAL_PAIR.test(title))) {
      const parties = inferMigrationParties(event, world, roster);
      if (parties.length >= 2) {
        const type = inferLegacyAgreementType(text);
        const id = legacyAgreementId(event, type, parties);
        let agreement = agreementMap.get(id);
        if (!agreement) {
          agreement = {
            id,
            title,
            type,
            status: "active",
            parties,
            startedDate: parseIsoDate(event?.date),
            endedDate: "",
            lastUpdatedDate: parseIsoDate(event?.date),
            terms: description.slice(0, 600),
            ...(type === "guarantee" && parties.length >= 2
              ? { guarantor: parties[0], beneficiary: parties[1] }
              : {}),
            sourceEventIds: unique([clean(event?.id)], 24),
            createdRound: 0,
            updatedRound: 0,
            migratedLegacy: true,
          };
          agreementMap.set(id, agreement);
          seedRelationFromAgreement(relationMap, world, parties, type, event);
        }
        if (type === "peace_settlement") {
          applyLegacyPeaceAgreementRelation(relationMap, agreement, event);
        }
      }
    }

    // Process explicit directed hostilities in the same chronological stream.
    // This lets a later peace repair hostility while a still-later clash can make
    // the pair hostile again; it also ends an obsolete alliance at the right date.
    applyLegacyHostilityEvent(agreementMap, relationMap, event, world, roster);
  }

  // Some formal commitments predate the campaign start and therefore never had a
  // treaty-signing event. Seed ONLY explicit standing-alliance language from
  // diplomatic correspondence, conservatively bound to the speaker/player pair.
  const chatAgreementsAdded = migrateLegacyStandingAlliancesFromChats({
    agreementMap,
    relationMap,
    chats,
    game,
    world,
    roster,
  });

  // Re-check only for hostilities later than those chat evidence dates. This can
  // close a stale standing-alliance reference if the event ledger subsequently
  // records direct war between the same parties. Older clashes cannot overwrite
  // newer explicit standing-alliance evidence because applyLegacyHostilityEvent is
  // date-aware.
  if (chatAgreementsAdded > 0) {
    for (const event of normalizedEvents) {
      applyLegacyHostilityEvent(agreementMap, relationMap, event, world, roster);
    }
  }

  // Existing active wars are stronger evidence than any old migrated settlement.
  seedWarHostility(relationMap, world);

  const statusRank = { active: 0, suspended: 1, ended: 2, expired: 3 };
  const agreements = [...agreementMap.values()]
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      compareGameDates(b.lastUpdatedDate || b.startedDate || "", a.lastUpdatedDate || a.startedDate || "") ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_AGREEMENTS);
  const relations = [...relationMap.values()]
    .sort((a, b) => Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_RELATIONS);

  const nextWorld = normalizeWorldState({
    ...world,
    diplomaticLedgerVersion: DIPLOMATIC_LEDGER_VERSION,
    relations,
    agreements,
  });

  return {
    world: nextWorld,
    migrated: true,
    agreementsAdded: Math.max(0, agreements.length - beforeAgreements),
    relationsAdded: Math.max(0, relations.length - beforeRelations),
    scannedEvents: normalizedEvents.length,
    scannedChats: array(chats).length,
    chatAgreementsAdded,
    migratedAtDate: clean(game?.gameDate),
  };
};
