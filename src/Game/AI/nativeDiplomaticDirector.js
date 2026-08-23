// OpenHistoria Continuum — Native Diplomatic State Director v0.1.2
//
// Phase 7B:
// - sparse canonical bilateral relations (world.relations)
// - formal agreements / alliances / guarantees (world.agreements)
// - bounded diplomatic context for AI attention
// - compact relation/agreement update transport
// - one-time deterministic migration from explicit legacy treaty/alliance events
//
// Design rule: persistent world, bounded attention. The save may remember many
// diplomatic facts; any one AI request sees only the relevant slice.

import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";

export const DIPLOMATIC_LEDGER_VERSION = 1;
export const DIPLOMATIC_DIRECTOR_VERSION = "0.1.3";

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

const parseIsoDate = (value) => {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) ? text : "";
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

const decodeRelationLine = (line, index) => {
  const [a, b, scoreRaw, status, eventNumbers, summary] = splitFixedFields(line, 5);
  const score = Number(scoreRaw);
  return {
    id: `relation-update-${index}`,
    a: clean(a),
    b: clean(b),
    score: Number.isFinite(score) ? clamp(Math.round(score), -100, 100) : null,
    status: lower(status),
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
      return {
        id: clean(entry.id) || `relation-update-${index}`,
        a: clean(entry.a),
        b: clean(entry.b),
        score: Number.isFinite(score) ? clamp(Math.round(score), -100, 100) : null,
        status: lower(entry.status),
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
  const [id, op, type, parties, eventNumbers, title, terms] = splitFixedFields(line, 6);
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

export const validateDiplomaticLedgerPayload = (candidate, { world = {} } = {}) => {
  const events = normalizeEvents(candidate?.events);
  const relations = bindRelationUpdatesToEvents(candidate?.relationUpdates, events);
  const agreements = bindAgreementUpdatesToEvents(candidate?.agreementUpdates, events);

  for (const update of relations) {
    const a = canonicalDiplomaticPolity(update.a, world);
    const b = canonicalDiplomaticPolity(update.b, world);
    if (!a || !b) return `Relation update could not resolve both polities: "${update.a}" / "${update.b}".`;
    if (lower(a) === lower(b)) return `Relation update cannot target the same polity twice: ${a}.`;
    if (!Number.isFinite(update.score)) return `Relation update ${a} ↔ ${b} requires an absolute score from -100 to 100.`;
    if (!RELATION_STATUS_SET.has(update.status)) return `Relation update ${a} ↔ ${b} has unsupported status "${update.status}".`;
    if (!update.eventIds.length && !update.eventIndexes.length) return `Relation update ${a} ↔ ${b} must reference the event number that caused the change.`;
    if (!linkedEvents(update, events).length) return `Relation update ${a} ↔ ${b} does not reference a valid event in this response.`;
  }

  const existing = agreementMapFromWorld(world);
  for (const update of agreements) {
    if (!["start", "update", "suspend", "resume", "end", "expire"].includes(update.op)) {
      return `Agreement ${update.id} has unsupported operation "${update.op}".`;
    }
    if (!update.eventIds.length && !update.eventIndexes.length) return `Agreement ${update.id} ${update.op} must reference the event number that establishes the change.`;
    if (!linkedEvents(update, events).length) return `Agreement ${update.id} ${update.op} does not reference a valid event in this response.`;
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

  return "";
};

export const applyRelationUpdates = ({ world, updates, events = [], stopDate = "", round = 0 } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = relationMapFromWorld(nextWorld);
  const decoded = bindRelationUpdatesToEvents(updates, events);
  const applied = [];

  for (const update of decoded) {
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

export const applyAgreementUpdates = ({ world, updates, events = [], stopDate = "", round = 0 } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = agreementMapFromWorld(nextWorld);
  const decoded = bindAgreementUpdatesToEvents(updates, events);
  const applied = [];

  for (const update of decoded) {
    const prior = map.get(update.id) || null;
    const date = updateDate(update, events, stopDate);
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
        lastUpdatedDate: date,
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
      lastUpdatedDate: date || prior.lastUpdatedDate,
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
      String(b.lastUpdatedDate || b.startedDate || "").localeCompare(String(a.lastUpdatedDate || a.startedDate || "")) ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_AGREEMENTS);

  return { world: { ...nextWorld, agreements }, agreements, appliedIds: applied };
};

export const applyDiplomaticUpdates = ({ world, relationUpdates, agreementUpdates, events = [], stopDate = "", round = 0 } = {}) => {
  const relationMerge = applyRelationUpdates({ world, updates: relationUpdates, events, stopDate, round });
  const agreementMerge = applyAgreementUpdates({ world: relationMerge.world, updates: agreementUpdates, events, stopDate, round });
  return {
    world: agreementMerge.world,
    relations: relationMerge.relations,
    agreements: agreementMerge.agreements,
    appliedRelationIds: relationMerge.appliedIds,
    appliedAgreementIds: agreementMerge.appliedIds,
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
    "Sparse-ledger rule: an untracked pair is NOT secretly hostile and is NOT a numeric score of zero. It only means no material bilateral state has yet been canonically recorded.",
    "Formal commitments and bilateral warmth are different facts. An alliance may be strained; friendly countries may have no alliance.",
    "world.wars remains the sole authority for actual belligerency. A hostile relation or alliance does not itself start a war.",
  ].join("\n");

  return { actors, relations, agreements, text };
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
    if (!closedAlliance && priorDate && eventDate && eventDate < priorDate) continue;
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
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

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
      String(b.lastUpdatedDate || b.startedDate || "").localeCompare(String(a.lastUpdatedDate || a.startedDate || "")) ||
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
