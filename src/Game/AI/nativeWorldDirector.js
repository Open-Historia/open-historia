import { buildCompactEconomicContext, isCompleteCountryStatSheet } from "../../runtime/countryStats.js";
import { buildBoundedDiplomaticContext } from "./nativeDiplomaticDirector.js";
import {
  buildNativeWorldExplorationSlate,
  deferredStorylineReentryHasConcreteTrigger,
  formatWorldExplorationAuditContract,
  latestCanonicalWorldEventDate,
  worldIntegrityAgeDays,
  worldActorsEquivalent,
} from "./nativeWorldIntegrity.js";

// OpenHistoria Continuum — Native World Director v0.8.7-consequence-aware
//
// Phase 6B.2: bounded multi-pass world initiative + fair persistent storyline attention.
//
// This module does NOT call AI and does NOT decide what history "must" happen.
// It only builds a bounded, current-state-first ledger so the expensive world
// simulation starts from THIS campaign instead of from the model's memorized
// historical calendar.
//
// Performance contract:
// - no network reads
// - no polling
// - no whole-map scan
// - recent history only
// - bounded candidate count
// - O(recent events + recent chats + a tiny bounded world-state sample)

export const WORLD_DIRECTOR_VERSION = "0.8.9-current-unit-ledger";

const DEFAULT_MAX_CANDIDATES = 10;
const RECENT_EVENT_WINDOW = 56;
const RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS = 180;
const RECENT_CHAT_WINDOW = 16;
const CONSOLIDATED_HISTORY_WINDOW = 6;
const TERRITORIAL_SAMPLE_LIMIT = 8;
const ACTIVE_UNIT_SAMPLE_LIMIT = 6;
const MAX_ATTENTION_STORYLINES = 8;
const MAX_PERSISTED_STORYLINES = 96;
const MAX_DEFERRED_STORYLINE_HINTS = 16;
const MAX_ECONOMIC_ACTORS = 8;
const CANDIDATE_STORYLINE_REPEAT_PENALTY = 4;
const CANDIDATE_TYPE_REPEAT_PENALTY = 0.75;
const RECENT_VISIBLE_EVENT_PENALTY_DAYS = Object.freeze([
  [21, 6],
  [45, 3],
  [75, 1],
]);

// 08.3.1 — consequence-aware liveness calibration. This is a SIGNAL, not a new
// subsystem and not an event quota. The same World Director / composition path
// uses it to notice when a busy rolling timeline has become almost entirely
// incremental. Javascript measures the recent canon; the model still decides
// whether any mature pressure has actually crossed a threshold.
const CONSEQUENCE_LOOKBACK_DAYS = 90;
const CONSEQUENCE_MIN_VISIBLE_EVENTS = 8;
const STRATEGIC_CONSEQUENCE_RE =
  /\b(annex(?:es|ed|ation)?|incorporat(?:e|es|ed|ion)|cede[sd]?|cession|independence|proclaim(?:s|ed)?\s+(?:the\s+)?(?:republic|kingdom|state|government)|abdica(?:te|tes|ted|tion)|resign(?:s|ed|ation)|assassinat(?:e|es|ed|ion)|coup|revolution|uprising|rebellion|mutiny|surrender(?:s|ed)?|armistice|ceasefire|peace treaty|declares? war|declaration of war|joins? (?:the )?war|withdraw(?:s|al)? from (?:the )?war|capture(?:s|d)?|seiz(?:e|es|ed)|occup(?:y|ies|ied)|liberat(?:e|es|ed)|breakthrough|government falls?|cabinet resign(?:s|ed)?|election results?|elected president|elected prime minister|ratif(?:y|ies|ied|ication)|signs? (?:a |the )?(?:treaty|pact|accord|agreement)|treaty (?:is )?(?:signed|concluded|ratified)|strike (?:begins|erupts|ends)|calls? off .*strike|bank(?:ing)? panic|financial crash|defaults? on|bankruptcy|martial law|state of emergency)\b/i;
const HARD_MILITARY_CONSEQUENCE_RE =
  /\b(capture(?:s|d)?|seiz(?:e|es|ed)|occup(?:y|ies|ied)|liberat(?:e|es|ed)|retreat(?:s|ed)?|withdraw(?:s|n|al)?|surrender(?:s|ed)?|ceasefire|armistice|breakthrough|encircl(?:e|es|ed)|destroy(?:s|ed)?|defeat(?:s|ed)?|repuls(?:e|es|ed)|casualt(?:y|ies)|killed|wounded|front collapses?)\b/i;

const eventConsequenceScore = (event) => {
  if (!event || typeof event !== "object") return 0;
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  let score = 0;

  if (normalizeArray(impacts.regionTransfers).length) score += 5;
  if (normalizeArray(impacts.regionControlOps).length) score += 4;
  if (normalizeArray(impacts.polityChanges).length) score += 4;

  const unitOps = normalizeArray(impacts.unitOps);
  if (unitOps.some((op) => ["attack", "remove"].includes(normalizeString(op?.op).toLowerCase()))) score += 3;
  if (normalizeString(event?.warId) && HARD_MILITARY_CONSEQUENCE_RE.test(text)) score += 3;
  if (STRATEGIC_CONSEQUENCE_RE.test(text)) score += 3;

  // Major events with a concrete durable map/capability object are meaningful,
  // but ordinary administrative completions do not become "strategic thresholds"
  // merely because they contain the word completed.
  if (normalizeString(event?.importance).toLowerCase() === "major") score += 1;
  if (normalizeArray(impacts.markerOps).length && normalizeString(event?.importance).toLowerCase() === "major") score += 1;

  return score;
};

export const assessRecentWorldConsequenceLiveness = ({
  events = [],
  additionalEvents = [],
  referenceDate = "",
  lookbackDays = CONSEQUENCE_LOOKBACK_DAYS,
} = {}) => {
  const reference = parseIsoDate(referenceDate);
  if (reference == null) {
    return { level: "unknown", eventCount: 0, consequentialCount: 0, lookbackDays, examples: [] };
  }

  const seen = new Set();
  const recent = [];
  for (const event of [...normalizeArray(events), ...normalizeArray(additionalEvents)]) {
    const date = parseIsoDate(event?.date);
    if (date == null || date > reference) continue;
    const age = Math.max(0, Math.round((reference - date) / 86400000));
    if (age > lookbackDays) continue;
    const key = normalizeString(event?.id) || `${normalizeString(event?.date)}|${normalizeString(event?.title).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recent.push(event);
  }

  const consequential = recent
    .map((event) => ({ event, score: eventConsequenceScore(event) }))
    .filter((row) => row.score >= 3);
  const eventCount = recent.length;
  const consequentialCount = consequential.length;
  const lowCeiling = Math.max(1, Math.floor(eventCount * 0.18));
  const level =
    eventCount >= CONSEQUENCE_MIN_VISIBLE_EVENTS && consequentialCount <= lowCeiling
      ? "low"
      : "normal";

  return {
    level,
    eventCount,
    consequentialCount,
    lookbackDays,
    examples: consequential
      .slice(-4)
      .map(({ event }) => `${normalizeString(event?.date)} — ${normalizeString(event?.title)}`)
      .filter(Boolean),
  };
};

// Fix 07 — an active high-pressure process may be quiet, but it may not vanish
// from causal simulation for months at a time. 35 days forces a fresh endogenous
// reappraisal; 70 days adds an objective anti-stasis backstop. Neither threshold
// is an event quota or a demand for territorial movement.
const HIGH_PRESSURE_STAGNATION_THRESHOLD = 70;
const STAGNATION_REAPPRAISAL_DAYS = 35;
const STAGNATION_BACKSTOP_DAYS = 70;

let lastAnalysis = null;

const normalizeString = (value) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeArray = (value) =>
  Array.isArray(value) ? value : [];

const truncate = (value, max = 260) => {
  const text = normalizeString(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
};

const parseIsoDate = (value) => {
  const text = normalizeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
};

const addIsoDays = (value, days) => {
  const parsed = parseIsoDate(value);
  if (parsed == null) return normalizeString(value);
  const date = new Date(parsed);
  date.setUTCDate(date.getUTCDate() + Math.trunc(Number(days) || 0));
  return date.toISOString().slice(0, 10);
};

const compareIso = (a, b) => {
  const left = parseIsoDate(a);
  const right = parseIsoDate(b);
  if (left == null || right == null) return 0;
  return left === right ? 0 : left < right ? -1 : 1;
};

const clampPercent = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const ageDays = (originDate, eventDate) => {
  const origin = parseIsoDate(originDate);
  const event = parseIsoDate(eventDate);
  if (origin == null || event == null) return 99999;
  return Math.max(0, Math.round((origin - event) / 86400000));
};

const latestMessageDate = (chat) => {
  const messages = normalizeArray(chat?.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const date = normalizeString(messages[i]?.time || messages[i]?.date);
    if (date) return date;
  }
  return "";
};

const latestMemorySummary = (chat) => {
  const messages = normalizeArray(chat?.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const summary = normalizeString(messages[i]?.memorySummary);
    if (summary) return summary;
  }
  return "";
};

const importanceScore = (importance) => {
  switch (normalizeString(importance).toLowerCase()) {
    case "critical":
      return 8;
    case "major":
      return 5;
    case "moderate":
      return 3;
    case "minor":
      return 1;
    default:
      return 0;
  }
};

const recencyScore = (days) => {
  if (days <= 14) return 7;
  if (days <= 30) return 6;
  if (days <= 60) return 5;
  if (days <= 120) return 4;
  if (days <= 240) return 3;
  if (days <= 365) return 2;
  return 0;
};

const countImpactSignals = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object"
    ? event.impacts
    : {};
  let signals = 0;
  for (const key of [
    "regionTransfers",
    "regionControlOps",
    "polityChanges",
    "unitOps",
    "markerOps",
    "createdChats",
  ]) {
    if (normalizeArray(impacts[key]).length) signals += 1;
  }
  return signals;
};

const eventCandidate = (event, originDate, index) => {
  const title = normalizeString(event?.title);
  if (!title) return null;

  const days = ageDays(originDate, event?.date);
  const impactSignals = countImpactSignals(event);
  const kind = normalizeString(event?.kind).toLowerCase();

  let score =
    importanceScore(event?.importance) +
    recencyScore(days) +
    Math.min(6, impactSignals * 2);

  if (event?.notable) score += 2;
  if (kind === "military" || kind === "diplomacy") score += 1;

  // Player-related events are NOT boosted. Phase 6 explicitly avoids treating
  // the human polity as the center of gravity merely because it is human.
  return {
    id: `event:${normalizeString(event?.id) || index}`,
    sourceEventId: normalizeString(event?.id),
    type: "recent-event",
    score,
    date: normalizeString(event?.date),
    title,
    detail: truncate(event?.description || event?.summary, 280),
    ageDays: days,
    storylineIds: [...new Set(
      normalizeArray(event?.storylineIds)
        .map(normalizeString)
        .filter(Boolean),
    )].slice(0, 6),
  };
};

const chatCandidate = (chat, originDate, index) => {
  if (!chat || normalizeString(chat.status).toLowerCase() === "closed") return null;

  const memory = latestMemorySummary(chat);
  if (!memory) return null;

  const participants = normalizeArray(chat.countries)
    .map((country) => normalizeString(country?.name || country?.code))
    .filter(Boolean);

  const date = latestMessageDate(chat);
  const days = ageDays(originDate, date);
  const score = 7 + recencyScore(days);

  return {
    id: `chat:${normalizeString(chat.id) || index}`,
    type: "diplomatic-thread",
    score,
    date,
    title: participants.length
      ? `Active diplomacy: ${participants.join(", ")}`
      : "Active diplomatic thread",
    detail: truncate(memory, 320),
    ageDays: days,
  };
};

const consolidatedCandidate = (entry, index) => {
  const summary = normalizeString(entry?.summary);
  if (!summary) return null;

  return {
    id: `canon:${normalizeString(entry?.id) || index}`,
    type: "durable-canon",
    score: 7,
    date: normalizeString(entry?.date || entry?.throughDate || entry?.endDate),
    title: "Durable campaign canon",
    detail: truncate(summary, 320),
    ageDays: 99999,
  };
};

const actorSuppressedByDeferredSet = (
  actor,
  suppressedActors,
  world,
  gameCountry = "",
) =>
  [...suppressedActors].some((deferredActor) =>
    worldActorsEquivalent(actor, deferredActor, world, gameCountry)
  );

const pushTerritorialCandidates = (candidates, world, suppressedActors = new Set(), gameCountry = "") => {
  const claimants = world?.regionClaimants && typeof world.regionClaimants === "object"
    ? world.regionClaimants
    : {};
  const controllers = world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object"
    ? world.regionOwnershipOverrides
    : {};
  const sovereigns = world?.regionSovereigntyOverrides && typeof world.regionSovereigntyOverrides === "object"
    ? world.regionSovereigntyOverrides
    : {};

  let added = 0;
  for (const regionId in claimants) {
    if (added >= TERRITORIAL_SAMPLE_LIMIT) break;

    const contenderList = normalizeArray(claimants[regionId])
      .map(normalizeString)
      .filter(Boolean);
    const controller = normalizeString(controllers[regionId]);
    const sovereign = normalizeString(sovereigns[regionId]);

    if (!contenderList.length && (!controller || !sovereign || controller === sovereign)) {
      continue;
    }

    const territorialActors = [controller, sovereign, ...contenderList]
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter(Boolean);
    if (
      territorialActors.length &&
      territorialActors.every((actor) =>
        actorSuppressedByDeferredSet(actor, suppressedActors, world, gameCountry)
      )
    ) {
      continue;
    }

    candidates.push({
      id: `territory:${regionId}`,
      type: "territorial-pressure",
      score: 10,
      date: "",
      title: `Active territorial pressure: ${regionId}`,
      detail: [
        controller ? `controller ${controller}` : "",
        sovereign ? `legal sovereign ${sovereign}` : "",
        contenderList.length ? `claimants/contenders ${contenderList.join(", ")}` : "",
      ].filter(Boolean).join("; "),
      ageDays: 0,
    });
    added += 1;
  }
};

const pushActiveUnitCandidates = (candidates, world, suppressedActors = new Set(), gameCountry = "") => {
  let added = 0;
  for (const unit of normalizeArray(world?.units)) {
    if (added >= ACTIVE_UNIT_SAMPLE_LIMIT) break;

    const status = normalizeString(unit?.status).toLowerCase();
    if (!status || status === "idle") continue;

    const owner = normalizeString(unit?.ownerCode || unit?.owner);
    if (
      owner &&
      actorSuppressedByDeferredSet(owner, suppressedActors, world, gameCountry)
    ) continue;
    const name = normalizeString(unit?.name) || "Unit";
    const region = normalizeString(unit?.regionId);

    candidates.push({
      id: `unit:${normalizeString(unit?.id) || added}`,
      type: "active-military-state",
      score: 7,
      date: "",
      title: `Active military state: ${owner ? `${owner} — ` : ""}${name}`,
      detail: [status ? `status ${status}` : "", region ? `region ${region}` : ""]
        .filter(Boolean)
        .join("; "),
      ageDays: 0,
    });
    added += 1;
  }
};

const formatCurrentPersistentUnitLedger = (world) => {
  const units = normalizeArray(world?.units)
    .filter((unit) => unit && typeof unit === "object");

  if (!units.length) {
    return [
      "No persistent military units currently exist in world.units.",
      "This is an EXHAUSTIVE current-state fact: a formation mentioned only in older events/history does not currently exist.",
    ].join("\n");
  }

  const lines = units.map((unit, index) => {
    const id = normalizeString(unit?.id) || "(missing id)";
    const name = normalizeString(unit?.name) || "Unnamed unit";
    const owner = normalizeString(unit?.ownerCode || unit?.owner) || "unknown owner";
    const type = normalizeString(unit?.type) || "unknown type";
    const status = normalizeString(unit?.status) || "unknown status";
    const region = normalizeString(unit?.regionId);
    const strength = Number.isFinite(Number(unit?.strength))
      ? `strength ${Number(unit.strength)}`
      : "";

    return `${index + 1}. ${id} | ${owner} | ${name} | ${type} | ${status}` +
      `${region ? ` | region ${region}` : ""}` +
      `${strength ? ` | ${strength}` : ""}`;
  });

  return [
    `CURRENT PERSISTENT UNIT LEDGER — EXHAUSTIVE (${units.length} unit(s))`,
    ...lines,
    "",
    "Identity rule: only units listed above currently exist. Historical events, consolidated history, chats, scenario prose, and old action text may mention formations that have since been removed or disbanded; those references are historical memory only.",
    "Never describe an absent historical formation as currently operational, integrated, deployed, reinforced, reorganized, moved, attacked, or otherwise acting in the present.",
    "If a genuinely new formation is created during THIS pass, narrate that creation explicitly and use a spawn operation. Do not silently resurrect an old deleted unit by reusing its historical name.",
  ].join("\n");
};

const normalizeStorylineForDirector = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") return null;
  const title = normalizeString(entry.title);
  if (!title) return null;
  const statusRaw = normalizeString(entry.status).toLowerCase();
  const status = ["active", "dormant", "resolved"].includes(statusRaw)
    ? statusRaw
    : "active";
  return {
    id: normalizeString(entry.id) || `storyline-${index}`,
    kind: normalizeString(entry.kind) || "world",
    title,
    participants: [...new Set(normalizeArray(entry.participants).map(normalizeString).filter(Boolean))].slice(0, 12),
    status,
    pressure: clampPercent(entry.pressure),
    momentum: clampPercent(entry.momentum),
    startedDate: normalizeString(entry.startedDate),
    accountedThroughDate: normalizeString(entry.accountedThroughDate || entry.lastUpdatedDate || entry.startedDate),
    lastUpdatedDate: normalizeString(entry.lastUpdatedDate || entry.accountedThroughDate || entry.startedDate),
    lastVisibleEventDate: normalizeString(entry.lastVisibleEventDate),
    nextReviewDate: status === "resolved" ? "" : normalizeString(entry.nextReviewDate),
    state: truncate(entry.state || entry.summary || entry.description, 520),
    drivers: [...new Set(normalizeArray(entry.drivers).map(normalizeString).filter(Boolean))].slice(0, 8),
    constraints: [...new Set(normalizeArray(entry.constraints).map(normalizeString).filter(Boolean))].slice(0, 8),
    sourceEventIds: [...new Set(normalizeArray(entry.sourceEventIds).map(normalizeString).filter(Boolean))].slice(0, 16),
    createdRound: Math.max(0, Math.trunc(Number(entry.createdRound) || 0)),
    updatedRound: Math.max(0, Math.trunc(Number(entry.updatedRound) || 0)),
  };
};


const storylineParticipantsKey = (participants) =>
  [...new Set(
    normalizeArray(participants)
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter(Boolean),
  )]
    .sort()
    .join("|");

const storylineSemanticIdentityKey = (storyline) => {
  const kind = normalizeString(storyline?.kind).toLowerCase() || "world";
  const title = normalizeString(storyline?.title).toLowerCase();
  const participants = storylineParticipantsKey(storyline?.participants);
  if (!title) return "";
  return `${kind}|${title}|${participants}`;
};

const storylineFreshnessValue = (storyline) => {
  const date =
    parseIsoDate(storyline?.lastUpdatedDate) ??
    parseIsoDate(storyline?.accountedThroughDate) ??
    parseIsoDate(storyline?.startedDate);
  if (date != null) return date;
  return Math.max(0, Number(storyline?.updatedRound) || 0);
};

const canonicalWarStorylineIdForGroup = (world, group) => {
  if (!group.length || normalizeString(group[0]?.kind).toLowerCase() !== "war") return "";
  const participantsKey = storylineParticipantsKey(group[0]?.participants);
  if (!participantsKey) return "";

  const matchingWars = normalizeArray(world?.wars).filter((war) => {
    const warParticipants = [
      ...normalizeArray(war?.sideA),
      ...normalizeArray(war?.sideB),
    ];
    return storylineParticipantsKey(warParticipants) === participantsKey;
  });

  if (matchingWars.length !== 1) return "";
  const warId = normalizeString(matchingWars[0]?.id);
  if (!warId) return "";

  const preferred = `storyline-${warId}`;
  return group.some((entry) => normalizeString(entry?.id) === preferred)
    ? preferred
    : "";
};

// Fix 07.4 — canonical ACTIVE wars receive causal attention by conflict status,
// not by whether a pressure score happens to sit above an arbitrary threshold.
// Prefer exact war-id linkage, then fall back to kind+participant identity for
// compatibility saves whose storyline ids predate the canonical war id.
const activeCanonicalWarForStoryline = (storyline, worldLike) => {
  if (!storyline || normalizeString(storyline?.status).toLowerCase() !== "active") return null;
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const storylineId = normalizeString(storyline?.id);
  const kind = normalizeString(storyline?.kind).toLowerCase();
  const participantsKey = storylineParticipantsKey(storyline?.participants);

  for (const war of normalizeArray(world?.wars)) {
    if (normalizeString(war?.status).toLowerCase() !== "active") continue;
    const warId = normalizeString(war?.id);
    if (warId && storylineId === `storyline-${warId}`) return war;

    if (kind !== "war" || !participantsKey) continue;
    const warParticipants = [
      ...normalizeArray(war?.sideA),
      ...normalizeArray(war?.sideB),
    ];
    if (storylineParticipantsKey(warParticipants) === participantsKey) return war;
  }

  return null;
};

const coalesceWorldStorylines = (worldLike) => {
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const normalized = normalizeArray(world?.storylines)
    .map(normalizeStorylineForDirector)
    .filter(Boolean);

  const groups = new Map();
  for (const storyline of normalized) {
    const semanticKey = storylineSemanticIdentityKey(storyline) || `id:${storyline.id}`;
    if (!groups.has(semanticKey)) groups.set(semanticKey, []);
    groups.get(semanticKey).push(storyline);
  }

  const aliasToCanonical = new Map();
  const storylines = [];
  const duplicateGroups = [];

  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) =>
      (storylineFreshnessValue(b) - storylineFreshnessValue(a)) ||
      ((Number(b?.updatedRound) || 0) - (Number(a?.updatedRound) || 0)) ||
      (normalizeArray(b?.sourceEventIds).length - normalizeArray(a?.sourceEventIds).length) ||
      normalizeString(a?.id).localeCompare(normalizeString(b?.id))
    );

    const freshest = ordered[0];
    const canonicalId =
      canonicalWarStorylineIdForGroup(world, group) ||
      normalizeString(freshest?.id);

    for (const entry of group) {
      aliasToCanonical.set(normalizeString(entry?.id), canonicalId);
    }

    if (group.length === 1) {
      storylines.push({
        ...freshest,
        id: canonicalId,
      });
      continue;
    }

    const startedDates = group
      .map((entry) => normalizeString(entry?.startedDate))
      .filter((date) => parseIsoDate(date) != null)
      .sort();

    const lastVisibleDates = group
      .map((entry) => normalizeString(entry?.lastVisibleEventDate))
      .filter((date) => parseIsoDate(date) != null)
      .sort();

    const sourceEventIds = [...new Set(
      group.flatMap((entry) => normalizeArray(entry?.sourceEventIds))
        .map(normalizeString)
        .filter(Boolean),
    )].slice(-16);

    const drivers = [...new Set(
      group.flatMap((entry) => normalizeArray(entry?.drivers))
        .map(normalizeString)
        .filter(Boolean),
    )].slice(0, 8);

    const constraints = [...new Set(
      group.flatMap((entry) => normalizeArray(entry?.constraints))
        .map(normalizeString)
        .filter(Boolean),
    )].slice(0, 8);

    const createdRounds = group
      .map((entry) => Math.max(0, Math.trunc(Number(entry?.createdRound) || 0)))
      .filter((value) => value > 0);

    const merged = normalizeStorylineForDirector({
      ...freshest,
      id: canonicalId,
      participants: [...new Set(
        group.flatMap((entry) => normalizeArray(entry?.participants))
          .map(normalizeString)
          .filter(Boolean),
      )],
      startedDate: startedDates[0] || freshest?.startedDate,
      lastVisibleEventDate: lastVisibleDates.at(-1) || "",
      drivers,
      constraints,
      sourceEventIds,
      createdRound: createdRounds.length
        ? Math.min(...createdRounds)
        : Math.max(0, Math.trunc(Number(freshest?.createdRound) || 0)),
      updatedRound: Math.max(
        ...group.map((entry) => Math.max(0, Math.trunc(Number(entry?.updatedRound) || 0))),
      ),
    });

    if (merged) storylines.push(merged);

    duplicateGroups.push({
      canonicalId,
      ids: group.map((entry) => normalizeString(entry?.id)).filter(Boolean),
      title: normalizeString(freshest?.title),
    });
  }

  return {
    storylines,
    aliasToCanonical,
    duplicateGroups,
    mergedDuplicateCount: normalized.length - storylines.length,
  };
};

const recentEventEligibleForInitiative = (event, originDate) => {
  if (!event || typeof event !== "object") return false;

  const originParsed = parseIsoDate(originDate);
  const eventParsed = parseIsoDate(event?.date);
  if (originParsed != null && eventParsed != null) {
    if (ageDays(originDate, event?.date) > RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS) {
      return false;
    }
  }

  // A recent timeline card is not automatically a present-tense causal seed.
  if (countImpactSignals(event) > 0) return true;
  if (event?.notable === true) return true;
  if (event?.playerRelated === true) return true;
  if (normalizeArray(event?.storylineIds).length > 0) return true;

  const importance = normalizeString(event?.importance).toLowerCase();
  if (["critical", "major"].includes(importance)) return true;

  const age = eventParsed != null && originParsed != null
    ? ageDays(originDate, event?.date)
    : 99999;

  if (importance === "moderate" && age <= 60) return true;

  if (normalizeString(event?.kind).toLowerCase() === "diplomacy" && age <= 45) {
    return true;
  }

  return false;
};

const storylineStagnationAgeDays = (storyline, referenceDate) => {
  if (!storyline || parseIsoDate(referenceDate) == null) return 0;

  const anchor =
    parseIsoDate(storyline.lastVisibleEventDate) != null
      ? storyline.lastVisibleEventDate
      : parseIsoDate(storyline.lastUpdatedDate) != null
        ? storyline.lastUpdatedDate
        : parseIsoDate(storyline.accountedThroughDate) != null
          ? storyline.accountedThroughDate
          : storyline.startedDate;

  if (parseIsoDate(anchor) == null) return 0;
  return ageDays(referenceDate, anchor);
};

// Soft 35-day causal reappraisal is about time since the simulator last looked at
// the process, not time since the last visible card. This prevents an active war
// that honestly remains quiet from being selected on every one-day jump forever.
// The 70-day objective anti-stasis backstop still uses visible-stagnation age.
const storylineReviewAgeDays = (storyline, referenceDate) => {
  if (!storyline || parseIsoDate(referenceDate) == null) return 0;
  const anchor =
    parseIsoDate(storyline.lastUpdatedDate) != null
      ? storyline.lastUpdatedDate
      : parseIsoDate(storyline.accountedThroughDate) != null
        ? storyline.accountedThroughDate
        : storyline.startedDate;
  if (parseIsoDate(anchor) == null) return 0;
  return ageDays(referenceDate, anchor);
};

const storylineAttentionScore = (storyline, originDate, targetDate, world = null) => {
  if (!storyline || storyline.status === "resolved") return -Infinity;

  let score = storyline.status === "active" ? 8 : 1;
  score += storyline.pressure / 10;
  score += storyline.momentum / 8;

  const stagnationAgeAtHorizon = storylineStagnationAgeDays(storyline, targetDate);
  const reviewAgeAtHorizon = storylineReviewAgeDays(storyline, targetDate);
  const activeWar = Boolean(activeCanonicalWarForStoryline(storyline, world));
  if (activeWar) {
    if (stagnationAgeAtHorizon >= STAGNATION_BACKSTOP_DAYS) score += 24;
    else if (reviewAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS) score += 14;
  } else if (
    storyline.status === "active" &&
    storyline.pressure >= HIGH_PRESSURE_STAGNATION_THRESHOLD
  ) {
    if (stagnationAgeAtHorizon >= STAGNATION_BACKSTOP_DAYS) score += 24;
    else if (stagnationAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS) score += 14;
  }

  const nextReview = storyline.nextReviewDate;
  if (!nextReview) {
    score += storyline.status === "active" ? 12 : 3;
  } else if (parseIsoDate(nextReview) != null && parseIsoDate(targetDate) != null) {
    if (nextReview <= originDate) score += 16;
    else if (nextReview <= targetDate) score += 11;
  }

  // Starvation bonus: a lower-ranked but still unresolved process gradually
  // climbs if it has not received semantic attention. This prevents one crisis
  // from permanently monopolising the scheduler without inventing filler.
  const staleDays = ageDays(originDate, storyline.lastUpdatedDate || storyline.accountedThroughDate);
  if (staleDays >= 240) score += 8;
  else if (staleDays >= 120) score += 6;
  else if (staleDays >= 60) score += 4;
  else if (staleDays >= 30) score += 2;

  // Visible-history cooldown is deliberately separate from unresolved pressure.
  // A storyline may remain dangerous for months without deserving another card
  // every time the scheduler looks at it. Recent visibility pays a modest score
  // penalty so other due processes can compete; genuine high momentum can still win.
  if (parseIsoDate(storyline.lastVisibleEventDate) != null) {
    const visibleAge = ageDays(originDate, storyline.lastVisibleEventDate);
    for (const [maxDays, penalty] of RECENT_VISIBLE_EVENT_PENALTY_DAYS) {
      if (visibleAge <= maxDays) {
        score -= penalty;
        break;
      }
    }
  }

  return score;
};

const storylineNeedsAttentionWithin = (storyline, originDate, targetDate, world = null) => {
  if (!storyline || storyline.status === "resolved") return false;

  // Fix 07.4: every canonical ACTIVE war gets a causal reappraisal after ~35 days
  // since its last semantic review regardless of numerical pressure. This is hidden
  // simulation attention, not a demand for a battle/event. Non-war storylines keep
  // the existing high-pressure visible-stagnation override.
  const stagnationAgeAtHorizon = storylineStagnationAgeDays(storyline, targetDate);
  const reviewAgeAtHorizon = storylineReviewAgeDays(storyline, targetDate);
  const activeWar = Boolean(activeCanonicalWarForStoryline(storyline, world));
  if (activeWar && reviewAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS) {
    return true;
  }
  if (
    storyline.status === "active" &&
    storyline.pressure >= HIGH_PRESSURE_STAGNATION_THRESHOLD &&
    stagnationAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS
  ) {
    return true;
  }

  if (!storyline.nextReviewDate) return storyline.status === "active";
  if (parseIsoDate(storyline.nextReviewDate) == null || parseIsoDate(targetDate) == null) {
    return storyline.status === "active";
  }

  // Urgency is normally encoded into nextReviewDate when updates are persisted.
  // Active-war review age above is an additional compatibility guard for older
  // saves whose review date was scheduled under the pre-07.4 pressure cliff.
  return storyline.nextReviewDate <= targetDate;
};

const selectStorylineAttention = (world, originDate, targetDate) => {
  const coalesced = coalesceWorldStorylines(world);
  const normalized = coalesced.storylines
    .slice(0, MAX_PERSISTED_STORYLINES);

  const ranked = normalized
    .filter((entry) => storylineNeedsAttentionWithin(entry, originDate, targetDate, world))
    .map((entry) => ({
      ...entry,
      attentionScore: Math.round(storylineAttentionScore(entry, originDate, targetDate, world) * 10) / 10,
    }))
    .sort((a, b) =>
      (b.attentionScore - a.attentionScore) ||
      (b.momentum - a.momentum) ||
      (b.pressure - a.pressure) ||
      a.id.localeCompare(b.id)
    );

  // Greedy diversity-aware selection. A dominant war/crisis can still rank first
  // and receive attention every pass, but closely-overlapping processes pay a
  // small penalty once the same participants/kind already occupy slots. This is
  // a fairness bias, NOT a quota: genuinely urgent related processes can still win.
  const pool = [...ranked];
  const selected = [];
  const kindUse = new Map();
  const participantUse = new Map();

  while (pool.length > 0 && selected.length < MAX_ATTENTION_STORYLINES) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;

    for (let index = 0; index < pool.length; index += 1) {
      const entry = pool[index];
      const kindKey = normalizeString(entry.kind).toLowerCase() || "world";
      const overlapPenalty =
        (kindUse.get(kindKey) || 0) * 1.5 +
        normalizeArray(entry.participants).reduce(
          (sum, participant) =>
            sum + (participantUse.get(normalizeString(participant).toLowerCase()) || 0) * 1.25,
          0,
        );
      const adjusted = entry.attentionScore - overlapPenalty;
      if (
        adjusted > bestAdjusted ||
        (
          adjusted === bestAdjusted &&
          (
            entry.momentum > pool[bestIndex].momentum ||
            (
              entry.momentum === pool[bestIndex].momentum &&
              entry.pressure > pool[bestIndex].pressure
            )
          )
        )
      ) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    selected.push({
      ...picked,
      adjustedAttentionScore: Math.round(bestAdjusted * 10) / 10,
    });

    const kindKey = normalizeString(picked.kind).toLowerCase() || "world";
    kindUse.set(kindKey, (kindUse.get(kindKey) || 0) + 1);
    for (const participant of normalizeArray(picked.participants)) {
      const key = normalizeString(participant).toLowerCase();
      if (key) participantUse.set(key, (participantUse.get(key) || 0) + 1);
    }
  }

  return {
    all: normalized,
    ranked,
    selected,
    aliasToCanonical: coalesced.aliasToCanonical,
    duplicateGroups: coalesced.duplicateGroups,
    mergedDuplicateCount: coalesced.mergedDuplicateCount,
  };
};

const recommendedReviewDays = (pressure, momentum, status, { activeWar = false } = {}) => {
  if (status === "resolved") return 0;

  // Pressure is unresolved seriousness; momentum is the rate of meaningful change.
  // Fix 07.4 keeps genuinely fast processes on shorter cadence, caps every canonical
  // ACTIVE war at 35 days regardless of pressure, and keeps the same 35-day guard
  // for other active high-pressure processes. This is never a visible-card cadence.
  const p = clampPercent(pressure);
  const m = clampPercent(momentum);

  if (m >= 85) return 14;
  if (m >= 70) return 30;
  if (normalizeString(status).toLowerCase() === "active" && activeWar) {
    return STAGNATION_REAPPRAISAL_DAYS;
  }
  if (
    normalizeString(status).toLowerCase() === "active" &&
    p >= HIGH_PRESSURE_STAGNATION_THRESHOLD
  ) return STAGNATION_REAPPRAISAL_DAYS;
  if (m >= 50) return 45;
  if (m >= 30) return 60;

  if (p >= 50) return 120;
  if (p >= 30) return 180;
  return 240;
};

const clampNextReviewDate = ({ stopDate, pressure, momentum, status, requested, activeWar = false }) => {
  if (status === "resolved") return "";
  if (parseIsoDate(stopDate) == null) return normalizeString(requested);
  const latestAllowed = addIsoDays(
    stopDate,
    recommendedReviewDays(pressure, momentum, status, { activeWar }),
  );
  const requestedText = normalizeString(requested);
  if (parseIsoDate(requestedText) == null || requestedText <= stopDate || requestedText > latestAllowed) {
    return latestAllowed;
  }
  return requestedText;
};


const STORYLINE_RECORD_SEPARATOR = "~";
const MAX_STORYLINE_UPDATES_PER_JUMP = 16;

const parseStorylineRecord = (line, index = 0) => {
  const text = normalizeString(line);
  if (!text) return null;

  // Format:
  // id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventIndexesCSV~state
  // Split only the first nine separators so accidental "~" in the final state
  // can be preserved rather than corrupting the record.
  const fields = [];
  let rest = text;
  for (let cut = 0; cut < 9; cut += 1) {
    const pos = rest.indexOf(STORYLINE_RECORD_SEPARATOR);
    if (pos < 0) {
      fields.push(rest);
      rest = "";
      break;
    }
    fields.push(rest.slice(0, pos));
    rest = rest.slice(pos + 1);
  }
  while (fields.length < 9) fields.push("");
  fields.push(rest);

  const [
    idRaw,
    statusRaw,
    pressureRaw,
    momentumRaw,
    startedDateRaw,
    kindRaw,
    titleRaw,
    participantsRaw,
    eventIndexesRaw,
    stateRaw,
  ] = fields;

  let normalizedEventNumbersRaw = normalizeString(eventIndexesRaw);
  let normalizedStateRaw = normalizeString(stateRaw);

  // Native linkage means the event-number field is optional. Cheap models may
  // omit the empty positional field entirely, producing
  // ...~participantsCSV~state instead of ...~participantsCSV~~state. Detect that
  // harmless shape and recover the state rather than misreading prose as indexes.
  if (
    !normalizedStateRaw &&
    normalizedEventNumbersRaw &&
    !/^\d+(?:\s*,\s*\d+)*$/.test(normalizedEventNumbersRaw)
  ) {
    normalizedStateRaw = normalizedEventNumbersRaw;
    normalizedEventNumbersRaw = "";
  }

  const eventIndexes = normalizedEventNumbersRaw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry >= 1)
    .map((entry) => entry - 1)
    .slice(0, 12);

  return {
    id: normalizeString(idRaw) || `storyline-${index}`,
    status: normalizeString(statusRaw).toLowerCase(),
    pressure: clampPercent(pressureRaw),
    momentum: clampPercent(momentumRaw),
    startedDate: normalizeString(startedDateRaw),
    kind: normalizeString(kindRaw),
    title: normalizeString(titleRaw),
    participants: participantsRaw
      .split(",")
      .map(normalizeString)
      .filter(Boolean)
      .slice(0, 12),
    eventIndexes,
    state: normalizedStateRaw,
  };
};

export const decodeWorldStorylineUpdates = (value) => {
  // Internal/back-compat callers may already provide object records.
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry === "string") return parseStorylineRecord(entry, index);
        if (!entry || typeof entry !== "object") return null;
        return {
          ...entry,
          eventIndexes: normalizeArray(entry.eventIndexes)
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item >= 0)
            .slice(0, 12),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_STORYLINE_UPDATES_PER_JUMP);
  }

  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => parseStorylineRecord(line, index))
    .filter(Boolean)
    .slice(0, MAX_STORYLINE_UPDATES_PER_JUMP);
};

const STORYLINE_LINK_STOPWORDS = new Set([
  "about", "after", "again", "against", "among", "because", "between", "during",
  "from", "into", "over", "that", "their", "there", "these", "this", "through",
  "under", "with", "without", "storyline", "government", "empire", "kingdom",
  "republic", "state", "states", "process", "current", "continues", "continued",
]);

const storylineLinkText = (value) =>
  normalizeString(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const storylineLinkTokens = (value) =>
  [...new Set(
    storylineLinkText(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !STORYLINE_LINK_STOPWORDS.has(token))
  )];

const storylineParticipantAliases = (participant) => {
  const raw = storylineLinkText(participant);
  if (!raw) return [];
  const variants = new Set([raw]);
  const stripped = raw
    .replace(/^(the )?(kingdom|republic|empire|federation|commonwealth|union|state) of /, "")
    .replace(/ (kingdom|republic|empire|federation|commonwealth|union|state)$/, "")
    .trim();
  if (stripped) variants.add(stripped);
  return [...variants].filter((value) => value.length >= 3);
};

const storylineEventStructuredActors = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  return [
    ...normalizeArray(event?.combatants),
    ...normalizeArray(impacts?.polityChanges).flatMap((entry) => [entry?.code, entry?.name]),
    ...normalizeArray(impacts?.regionTransfers).flatMap((entry) => [entry?.fromCode, entry?.toCode]),
    ...normalizeArray(impacts?.regionControlOps).flatMap((entry) => [
      entry?.fromCode,
      entry?.toCode,
      entry?.actorCode,
      entry?.claimantCode,
    ]),
    ...normalizeArray(impacts?.createdChats).flatMap((chat) => [
      chat?.speaker,
      ...normalizeArray(chat?.countries),
    ]),
  ].map(normalizeString).filter(Boolean);
};

const scoreStorylineEventLink = (update, event, world) => {
  const eventText = storylineLinkText([
    event?.id,
    event?.title,
    event?.description,
    event?.warId,
    JSON.stringify(event?.impacts ?? {}),
  ].filter(Boolean).join(" "));
  if (!eventText) return 0;

  const structuredActors = storylineEventStructuredActors(event);
  let score = 0;

  for (const participant of normalizeArray(update?.participants).map(normalizeString).filter(Boolean)) {
    const structuredHit = structuredActors.some((actor) =>
      worldActorsEquivalent(participant, actor, world || {}, "")
    );
    if (structuredHit) {
      score += 10;
      continue;
    }

    if (
      storylineParticipantAliases(participant)
        .some((alias) => (` ${eventText} `).includes(` ${alias} `))
    ) {
      score += 6;
    }
  }

  const titleTokens = storylineLinkTokens(`${update?.id || ""} ${update?.title || ""}`);
  const stateTokens = storylineLinkTokens(update?.state);
  const eventTokens = new Set(storylineLinkTokens(eventText));
  score += Math.min(8, titleTokens.filter((token) => eventTokens.has(token)).length * 2);
  score += Math.min(4, stateTokens.filter((token) => eventTokens.has(token)).length);

  const kind = normalizeString(update?.kind).toLowerCase();
  const eventWarId = storylineLinkText(event?.warId);
  if (kind === "war" && eventWarId) {
    const warTokens = new Set(storylineLinkTokens(eventWarId));
    const storylineWarTokens = storylineLinkTokens(`${update?.id || ""} ${update?.title || ""}`);
    const warOverlap = storylineWarTokens.filter((token) => warTokens.has(token)).length;
    if (warOverlap > 0) score += Math.min(8, 4 + warOverlap * 2);
  }

  return score;
};

const inferStorylineEventIndexes = (update, events, world) => {
  const scored = normalizeArray(events)
    .map((event, index) => ({
      index,
      score: scoreStorylineEventLink(update, event, world),
    }))
    .filter((row) => row.score >= 6)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!scored.length) return [];
  const best = scored[0].score;

  // Multiple events may legitimately advance the same persistent process in one
  // pass. Keep only strong near-best matches, never a broad participant-only fanout.
  return scored
    .filter((row) => row.score >= Math.max(8, best - 2))
    .slice(0, 4)
    .map((row) => row.index);
};

export const normalizeWorldStorylineEventLinks = (
  candidate,
  {
    world = {},
  } = {},
) => {
  if (!candidate || typeof candidate !== "object") {
    return { updates: [], rebound: 0, strippedInvalid: 0 };
  }

  const events = normalizeArray(candidate?.events);
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  let rebound = 0;
  let strippedInvalid = 0;

  const normalized = updates.map((update) => {
    const supplied = normalizeArray(update?.eventIndexes)
      .map(Number)
      .filter((index) => Number.isInteger(index));
    const validSupplied = supplied.filter(
      (index) => index >= 0 && index < events.length,
    );
    strippedInvalid += Math.max(0, supplied.length - validSupplied.length);

    const inferred = inferStorylineEventIndexes(update, events, world);
    let eventIndexes = inferred;

    // If native semantic inference has no confident match, retain only supplied
    // indexes that themselves look related. This treats model numbers as hints,
    // never as authority.
    if (!eventIndexes.length && validSupplied.length) {
      eventIndexes = validSupplied.filter(
        (index) => scoreStorylineEventLink(update, events[index], world) >= 6,
      );
    }

    if (
      eventIndexes.length &&
      JSON.stringify(eventIndexes) !== JSON.stringify(validSupplied)
    ) {
      rebound += 1;
    }

    return {
      ...update,
      eventIndexes: [...new Set(eventIndexes)].slice(0, 12),
    };
  });

  candidate.storylineUpdates = normalized;

  if (rebound || strippedInvalid) {
    console.info(
      `[OH storyline native binding] ${rebound} storyline record(s) rebound from semantic event evidence; ` +
      `${strippedInvalid} invalid event reference(s) stripped.`,
    );
  }

  return { updates: normalized, rebound, strippedInvalid };
};


const storylineSemanticStateKey = (value) =>
  normalizeString(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const storylinePassDays = (originDate, stopDate) => {
  const origin = parseIsoDate(originDate);
  const stop = parseIsoDate(stopDate);
  if (origin == null || stop == null) return 0;
  return Math.max(0, Math.round((stop - origin) / 86400000));
};

const storylineMateriallyEvolved = (prior, update) => {
  if (!prior || !update) return true;
  const nextStatus = normalizeString(update.status).toLowerCase();
  if (nextStatus && nextStatus !== normalizeString(prior.status).toLowerCase()) return true;
  if (Math.abs(clampPercent(update.pressure) - clampPercent(prior.pressure)) >= 4) return true;
  if (Math.abs(clampPercent(update.momentum) - clampPercent(prior.momentum)) >= 6) return true;

  const beforeState = storylineSemanticStateKey(prior.state);
  const afterState = storylineSemanticStateKey(update.state);
  if (beforeState && afterState && beforeState !== afterState) return true;

  return normalizeArray(update.eventIndexes).length > 0;
};

// Stronger than storylineMateriallyEvolved: this deliberately ignores prose-only
// state rewording. At the 70-day anti-stasis backstop, the model must either link
// a real event, change status, or move pressure/momentum enough to represent an
// actual hidden evolution rather than paraphrasing the same stalemate.
const storylineHasObjectiveEvolution = (prior, update, candidate = null) => {
  if (!prior || !update) return true;
  const nextStatus = normalizeString(update.status).toLowerCase();
  if (nextStatus && nextStatus !== normalizeString(prior.status).toLowerCase()) return true;
  if (Math.abs(clampPercent(update.pressure) - clampPercent(prior.pressure)) >= 4) return true;
  if (Math.abs(clampPercent(update.momentum) - clampPercent(prior.momentum)) >= 6) return true;

  const eventIndexes = normalizeArray(update.eventIndexes);
  return Boolean(
    eventIndexes.length &&
    candidate &&
    deferredStorylineReentryHasConcreteTrigger(
      candidate,
      eventIndexes,
      prior,
      update,
    )
  );
};

// Fix 07.2 / 07.2B — selected-storyline motion is a LOCAL repair concern, not
// a reason to throw away an otherwise-valid whole-world simulation. This detector
// covers both objective anti-stasis failures AND a selected native-attention process
// that the main pass omitted entirely. Callers can preserve the main pass, repair
// only the affected process, and leave a failed repair overdue for the next turn
// instead of falling back the entire world.
export const findWorldStorylineAntiStasisIssues = (
  candidate,
  {
    existingStorylines = [],
    selectedStorylines = [],
    originDate = "",
    stopDate = "",
    world = null,
  } = {},
) => {
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  const updateById = new Map(
    updates
      .map((entry) => [normalizeString(entry?.id), entry])
      .filter(([id]) => Boolean(id)),
  );
  const existingById = new Map(
    normalizeArray(existingStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );

  const issues = [];
  for (const selected of normalizeArray(selectedStorylines)) {
    const id = normalizeString(selected?.id);
    if (!id) continue;
    const prior = existingById.get(id) || normalizeStorylineForDirector(selected);
    if (!prior) continue;

    // When the caller supplies the pass origin, mirror the same native-attention
    // horizon test used by strict validation. Without an origin (older callers and
    // self-tests), selectedStorylines is already treated as the due repair set.
    if (
      normalizeString(originDate) &&
      !storylineNeedsAttentionWithin(selected, originDate, stopDate, world)
    ) {
      continue;
    }

    const update = updateById.get(id);
    const stagnationAgeAtStop = storylineStagnationAgeDays(prior, stopDate);
    const activeWar = Boolean(activeCanonicalWarForStoryline(prior, world));

    if (!update) {
      issues.push({
        id,
        prior,
        update: null,
        activeWar,
        kind: "missing-update",
        stagnationAgeDays: stagnationAgeAtStop,
        reason: `Native-attention storyline ${id} was omitted from the main pass and needs a local semantic repair through ${stopDate || "the pass horizon"}.`,
      });
      continue;
    }
    const protectedProcess =
      normalizeString(prior?.status).toLowerCase() === "active" &&
      (activeWar || clampPercent(prior?.pressure) >= HIGH_PRESSURE_STAGNATION_THRESHOLD);
    if (
      protectedProcess &&
      stagnationAgeAtStop >= STAGNATION_BACKSTOP_DAYS &&
      !storylineHasObjectiveEvolution(prior, update, candidate)
    ) {
      issues.push({
        id,
        prior,
        update,
        activeWar,
        kind: "anti-stasis",
        stagnationAgeDays: stagnationAgeAtStop,
        reason: `${activeWar ? "Active-war" : "High-pressure"} storyline ${id} has gone ${stagnationAgeAtStop} day(s) without a visible milestone and still has no objective evolution.`,
      });
    }
  }

  return issues;
};

// Final-attempt salvage for a harmless model bookkeeping mistake. The model may
// occasionally echo a DEFERRED storyline as an unchanged quiet record even though
// the prompt says to leave it untouched. That must not destroy the entire world
// pass after the one retry has already been spent. Strip ONLY deferred updates with
// no linked event; material re-entry still goes through the normal trigger validator.
export const stripQuietDeferredStorylineUpdates = (
  candidate,
  deferredStorylines = [],
) => {
  if (!candidate || typeof candidate !== "object") {
    return { strippedIds: [] };
  }

  const deferredIds = new Set(
    normalizeArray(deferredStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => normalizeString(entry.id))
      .filter(Boolean),
  );

  if (!deferredIds.size) return { strippedIds: [] };

  const raw = candidate.storylineUpdates;
  const strippedIds = [];

  const shouldStrip = (entry) => {
    const parsed = typeof entry === "string"
      ? parseStorylineRecord(entry)
      : decodeWorldStorylineUpdates([entry])[0];
    if (!parsed) return false;
    const id = normalizeString(parsed.id);
    if (!deferredIds.has(id)) return false;
    if (normalizeArray(parsed.eventIndexes).length > 0) return false;
    strippedIds.push(id);
    return true;
  };

  if (Array.isArray(raw)) {
    candidate.storylineUpdates = raw.filter((entry) => !shouldStrip(entry));
  } else {
    const lines = String(raw ?? "")
      .split(/\r?\n/)
      .filter((line) => normalizeString(line));
    candidate.storylineUpdates = lines
      .filter((line) => !shouldStrip(line))
      .join("\n");
  }

  return { strippedIds: [...new Set(strippedIds)] };
};

export const validateWorldStorylinePayload = (
  candidate,
  {
    existingStorylines = [],
    selectedStorylines = [],
    deferredStorylines = [],
    originDate = "",
    stopDate = "",
    enforceAntiStasis = true,
    enforceSelectedCoverage = true,
    world = null,
  } = {},
) => {
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  const updateById = new Map();

  if (updates.length > MAX_STORYLINE_UPDATES_PER_JUMP) {
    return `$.storylineUpdates may contain at most ${MAX_STORYLINE_UPDATES_PER_JUMP} records.`;
  }

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    const id = normalizeString(update?.id);
    if (!id) return `$.storylineUpdates record ${index + 1} must have an id.`;
    if (updateById.has(id)) {
      return `$.storylineUpdates contains duplicate storyline id ${id}.`;
    }
    updateById.set(id, update);

    const status = normalizeString(update?.status).toLowerCase();
    if (!["active", "dormant", "resolved"].includes(status)) {
      return `$.storylineUpdates record ${index + 1} status must be active, dormant, or resolved.`;
    }
    if (!normalizeString(update?.state)) {
      return `$.storylineUpdates record ${index + 1} must describe the process state through ${stopDate || "the jump horizon"}.`;
    }

    const started = normalizeString(update?.startedDate);
    if (started && parseIsoDate(started) == null) {
      return `$.storylineUpdates record ${index + 1} startedDate must be YYYY-MM-DD or blank.`;
    }

    for (const eventIndex of normalizeArray(update?.eventIndexes)) {
      if (eventIndex < 0 || eventIndex >= normalizeArray(candidate?.events).length) {
        return `$.storylineUpdates record ${index + 1} references event ${eventIndex + 1}, but only ${normalizeArray(candidate?.events).length} event(s) exist.`;
      }
    }
  }

  const existingById = new Map(
    normalizeArray(existingStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );
  const passDays = storylinePassDays(originDate, stopDate);

  for (const selected of normalizeArray(selectedStorylines)) {
    if (!storylineNeedsAttentionWithin(selected, originDate, stopDate, world)) continue;
    const id = normalizeString(selected?.id);
    if (!id) continue;
    const update = updateById.get(id);
    if (!update) {
      if (enforceSelectedCoverage) {
        return `$.storylineUpdates must include native-attention storyline ${id} (${normalizeString(selected?.title) || "untitled"}) with its semantic state through ${stopDate}.`;
      }
      // Whole-world generation may preserve otherwise-valid events and hand this
      // one missing selected process to the targeted local repair seam. The strict
      // default remains unchanged for all other callers.
      continue;
    }

    // Momentum must have mechanical meaning. A high-momentum process cannot
    // claim that several weeks passed while its status, numeric trajectory,
    // visible milestones, AND semantic state all remained unchanged.
    const prior = existingById.get(id) || normalizeStorylineForDirector(selected);
    if (
      passDays >= 21 &&
      clampPercent(prior?.momentum) >= 70 &&
      !storylineMateriallyEvolved(prior, update)
    ) {
      return `High-momentum storyline ${id} (${clampPercent(prior?.momentum)}) did not materially evolve during the ${passDays}-day internal world pass. Advance it, cool its momentum, resolve/dormant it, or describe a genuinely changed state; do not silently freeze it.`;
    }

    const stagnationAgeAtStop = storylineStagnationAgeDays(prior, stopDate);
    const activeWar = Boolean(activeCanonicalWarForStoryline(prior, world));
    if (
      enforceAntiStasis &&
      normalizeString(prior?.status).toLowerCase() === "active" &&
      (activeWar || clampPercent(prior?.pressure) >= HIGH_PRESSURE_STAGNATION_THRESHOLD) &&
      stagnationAgeAtStop >= STAGNATION_BACKSTOP_DAYS &&
      !storylineHasObjectiveEvolution(prior, update, candidate)
    ) {
      return `${activeWar ? "Active-war" : "High-pressure"} storyline ${id} has gone ${stagnationAgeAtStop} day(s) without a visible milestone and reached the ${STAGNATION_BACKSTOP_DAYS}-day anti-stasis backstop. Do not copy the same equilibrium forward again: link a material endogenous/external event, materially change pressure or momentum, or move the process toward a different status.`;
    }
  }

  // Scheduler authority is native, but scheduling controls ATTENTION rather than
  // permission for history to happen. A deferred existing storyline may not receive
  // a quiet bookkeeping update merely because it exists; however, its own actors
  // and internal conditions remain autonomous. A linked MATERIAL endogenous
  // development (or external trigger) may reactivate it. Routine artillery/patrol
  // continuation and prose-only rewording still do not qualify.
  const deferredById = new Map(
    normalizeArray(deferredStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );

  for (const [id, deferred] of deferredById) {
    const update = updateById.get(id);
    if (!update) continue;

    const eventIndexes = normalizeArray(update?.eventIndexes);
    if (!eventIndexes.length) {
      return `Deferred storyline ${id} (${normalizeString(deferred?.title) || "untitled"}) is outside focused attention and may not receive a quiet bookkeeping update. Leave it untouched unless this pass produces a linked material endogenous development or external trigger.`;
    }

    if (
      !deferredStorylineReentryHasConcreteTrigger(
        candidate,
        eventIndexes,
        deferred,
        update,
      )
    ) {
      return `Deferred storyline ${id} (${normalizeString(deferred?.title) || "untitled"}) re-entered without a material development. Its actors may act autonomously, but routine artillery/patrol continuation, meetings, weather-only stasis, or fresh wording of the same state do not qualify.`;
    }
  }

  return "";
};

export const applyWorldStorylineUpdates = ({
  world,
  updates,
  events = [],
  stopDate = "",
  round = 0,
} = {}) => {
  const coalescedExisting = coalesceWorldStorylines(world);
  const existing = coalescedExisting.storylines;
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const canonicalStorylineId = (value) => {
    const id = normalizeString(value);
    return coalescedExisting.aliasToCanonical.get(id) || id;
  };

  const linkedEvents = new Map();
  for (const event of normalizeArray(events)) {
    for (const rawId of normalizeArray(event?.storylineIds).map(normalizeString).filter(Boolean)) {
      const id = canonicalStorylineId(rawId);
      if (!linkedEvents.has(id)) linkedEvents.set(id, []);
      linkedEvents.get(id).push(event);
    }
  }

  const decodedUpdates = decodeWorldStorylineUpdates(updates);
  const appliedIds = [];

  for (let index = 0; index < decodedUpdates.length; index += 1) {
    const raw = decodedUpdates[index];
    const requestedId = normalizeString(raw?.id);
    const id = canonicalStorylineId(requestedId);
    if (!id) continue;

    const prior = byId.get(id) || null;
    const statusRaw = normalizeString(raw?.status).toLowerCase();
    const status = ["active", "dormant", "resolved"].includes(statusRaw)
      ? statusRaw
      : (prior?.status || "active");
    const pressure = clampPercent(raw?.pressure, prior?.pressure || 0);
    const momentum = clampPercent(raw?.momentum, prior?.momentum || 0);
    const accountedThroughDate = normalizeString(stopDate || prior?.accountedThroughDate);

    const related = linkedEvents.get(id) || [];
    const relatedDates = related
      .map((event) => normalizeString(event?.date))
      .filter((date) => parseIsoDate(date) != null)
      .sort();
    const earliestVisible = relatedDates[0] || "";
    const newestVisible = relatedDates.at(-1) || "";

    const sourceEventIds = [...new Set([
      ...normalizeArray(prior?.sourceEventIds),
      ...related.map((event) => normalizeString(event?.id)).filter(Boolean),
    ])].slice(-16);

    const title =
      normalizeString(raw?.title) ||
      normalizeString(prior?.title) ||
      normalizeString(related[0]?.title) ||
      id.replace(/^storyline[-_:]?/i, "").replaceAll("-", " ");
    const kind =
      normalizeString(raw?.kind) ||
      normalizeString(prior?.kind) ||
      normalizeString(related[0]?.kind) ||
      "world";
    const participants = normalizeArray(raw?.participants)
      .map(normalizeString)
      .filter(Boolean);

    const rawStarted = normalizeString(raw?.startedDate);
    const validRawStarted = parseIsoDate(rawStarted) != null ? rawStarted : "";
    const nextParticipants = participants.length ? participants : normalizeArray(prior?.participants);
    const activeWar = Boolean(activeCanonicalWarForStoryline({
      ...(prior || {}),
      id,
      kind,
      participants: nextParticipants,
      status,
    }, world));

    const next = normalizeStorylineForDirector({
      ...prior,
      id,
      kind,
      title,
      participants: nextParticipants,
      status,
      pressure,
      momentum,
      startedDate: prior?.startedDate || validRawStarted || earliestVisible || accountedThroughDate,
      accountedThroughDate,
      lastUpdatedDate: accountedThroughDate || prior?.lastUpdatedDate,
      lastVisibleEventDate: newestVisible || prior?.lastVisibleEventDate || "",
      nextReviewDate: clampNextReviewDate({
        stopDate: accountedThroughDate,
        pressure,
        momentum,
        status,
        requested: "",
        activeWar,
      }),
      state: normalizeString(raw?.state) || prior?.state || title,
      drivers: normalizeArray(prior?.drivers),
      constraints: normalizeArray(prior?.constraints),
      sourceEventIds,
      createdRound: prior?.createdRound || Math.max(0, Math.trunc(Number(round) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    }, index);

    if (!next) continue;
    byId.set(id, next);
    appliedIds.push(id);
  }

  const postMerge = coalesceWorldStorylines({
    ...(world && typeof world === "object" ? world : {}),
    storylines: [...byId.values()],
  });
  const statusRank = { active: 0, dormant: 1, resolved: 2 };
  const storylines = postMerge.storylines
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      String(b.lastUpdatedDate || "").localeCompare(String(a.lastUpdatedDate || "")) ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_PERSISTED_STORYLINES);

  return {
    world: {
      ...(world && typeof world === "object" ? world : {}),
      storylines,
    },
    appliedIds,
    storylines,
  };
};


const resolveCountryStatEntry = (worldLike, token) => {
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const raw = normalizeString(token);
  if (!raw) return null;

  const countryStats = world.countryStats && typeof world.countryStats === "object"
    ? world.countryStats
    : {};
  const directKey = Object.keys(countryStats)
    .find((key) => normalizeString(key).toLowerCase() === raw.toLowerCase());
  if (directKey) return { key: directKey, sheet: countryStats[directKey] };

  const overrides = world.polityOverrides && typeof world.polityOverrides === "object"
    ? world.polityOverrides
    : {};
  for (const [key, polity] of Object.entries(overrides)) {
    const names = [
      key,
      polity?.code,
      polity?.name,
      ...normalizeArray(polity?.aliases),
    ]
      .map(normalizeString)
      .filter(Boolean);
    if (!names.some((name) => name.toLowerCase() === raw.toLowerCase())) continue;

    const statKey = Object.keys(countryStats)
      .find((candidate) => normalizeString(candidate).toLowerCase() === normalizeString(key).toLowerCase());
    if (statKey) return { key: statKey, sheet: countryStats[statKey] };
  }

  return null;
};

const buildEconomicAttentionContext = (bundle, storylineAttention, extraActors = []) => {
  const world = bundle?.world || {};
  const requested = [
    normalizeString(bundle?.game?.country),
    ...normalizeArray(storylineAttention?.selected)
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map(normalizeString),
    ...normalizeArray(extraActors).map(normalizeString),
  ].filter(Boolean);

  const seen = new Set();
  const rows = [];
  for (const actor of requested) {
    if (rows.length >= MAX_ECONOMIC_ACTORS) break;
    const key = actor.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const resolved = resolveCountryStatEntry(world, actor);
    // Partial sheets can exist after a leadership-only event. They are useful as
    // persistence scaffolding but are NOT a canonical economic baseline. Do not
    // let a stray debt/growth field masquerade as a complete national economy.
    if (!resolved?.sheet || !isCompleteCountryStatSheet(resolved.sheet)) continue;
    const summary = buildCompactEconomicContext(resolved.sheet, { name: actor });
    if (!summary) continue;

    rows.push({
      actor,
      canonicalKey: resolved.key,
      summary: truncate(summary, 620),
    });
  }

  return rows;
};

const candidateKey = (candidate) =>
  `${normalizeString(candidate?.type).toLowerCase()}|${normalizeString(candidate?.title).toLowerCase()}|${normalizeString(candidate?.detail).toLowerCase()}`;

const candidateStorylineKeys = (candidate) =>
  [...new Set(
    normalizeArray(candidate?.storylineIds)
      .map((id) => normalizeString(id).toLowerCase())
      .filter(Boolean),
  )];

const selectBoundedCandidates = (rankedCandidates, limit) => {
  const pool = normalizeArray(rankedCandidates).map((candidate) => ({ ...candidate }));
  const selected = [];
  const storylineUse = new Map();
  const typeUse = new Map();
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || DEFAULT_MAX_CANDIDATES));

  while (pool.length > 0 && selected.length < boundedLimit) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const storylinePenalty = candidateStorylineKeys(candidate)
        .reduce(
          (sum, key) =>
            sum + (storylineUse.get(key) || 0) * CANDIDATE_STORYLINE_REPEAT_PENALTY,
          0,
        );
      const typeKey = normalizeString(candidate?.type).toLowerCase() || "unknown";
      const typePenalty = Math.max(0, (typeUse.get(typeKey) || 0) - 1) *
        CANDIDATE_TYPE_REPEAT_PENALTY;
      const adjusted = (Number(candidate?.score) || 0) - storylinePenalty - typePenalty;

      if (
        adjusted > bestAdjusted ||
        (
          adjusted === bestAdjusted &&
          (
            (Number(candidate?.score) || 0) > (Number(pool[bestIndex]?.score) || 0) ||
            (
              (Number(candidate?.score) || 0) === (Number(pool[bestIndex]?.score) || 0) &&
              (
                Number.isFinite(Number(candidate?.ageDays)) ? Number(candidate.ageDays) : 99999
              ) <
              (
                Number.isFinite(Number(pool[bestIndex]?.ageDays)) ? Number(pool[bestIndex].ageDays) : 99999
              )
            )
          )
        )
      ) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    const storylineKeys = candidateStorylineKeys(picked);
    const typeKey = normalizeString(picked?.type).toLowerCase() || "unknown";
    selected.push({
      ...picked,
      adjustedSelectionScore: Math.round(bestAdjusted * 10) / 10,
    });

    for (const key of storylineKeys) {
      storylineUse.set(key, (storylineUse.get(key) || 0) + 1);
    }
    typeUse.set(typeKey, (typeUse.get(typeKey) || 0) + 1);
  }

  return selected;
};

const runWorldDirectorSelfTests = () => {
  const fixtureWorld = {
    wars: [
      {
        id: "polish-war-of-independence",
        status: "active",
        sideA: ["Poland"],
        sideB: ["Russian Empire"],
      },
      {
        id: "austro-serbian-war",
        status: "active",
        sideA: ["Austria-Hungary"],
        sideB: ["Kingdom of Serbia"],
      },
    ],
    storylines: [
      {
        id: "storyline-polish-war-of-independence",
        kind: "war",
        title: "War of Polish Independence",
        participants: ["Poland", "Russian Empire"],
        status: "active",
        pressure: 85,
        momentum: 30,
        startedDate: "1915-04-18",
        accountedThroughDate: "1916-03-13",
        lastUpdatedDate: "1916-03-13",
        state: "Older canonical-id copy.",
        sourceEventIds: ["polish-a"],
      },
      {
        id: "storyline-polish-independence",
        kind: "war",
        title: "War of Polish Independence",
        participants: ["Poland", "Russian Empire"],
        status: "active",
        pressure: 72,
        momentum: 18,
        startedDate: "1915-04-18",
        accountedThroughDate: "1916-04-12",
        lastUpdatedDate: "1916-04-12",
        state: "Newer duplicate-id copy.",
        sourceEventIds: ["polish-b"],
      },
      {
        id: "storyline-july-crisis",
        kind: "war",
        title: "Austro-Serbian War",
        participants: ["Austria-Hungary", "Kingdom of Serbia"],
        status: "active",
        pressure: 68,
        momentum: 20,
        startedDate: "1914-06-28",
        accountedThroughDate: "1916-05-12",
        lastUpdatedDate: "1916-05-12",
        state: "Freshest Austro-Serbian state.",
        sourceEventIds: ["serbia-a"],
      },
      {
        id: "storyline-austro-serbian-war",
        kind: "war",
        title: "Austro-Serbian War",
        participants: ["Austria-Hungary", "Kingdom of Serbia"],
        status: "active",
        pressure: 80,
        momentum: 25,
        startedDate: "1914-07-28",
        accountedThroughDate: "1916-03-13",
        lastUpdatedDate: "1916-03-13",
        state: "Older canonical-id Austro-Serbian copy.",
        sourceEventIds: ["serbia-b"],
      },
    ],
  };

  const merged = coalesceWorldStorylines(fixtureWorld);
  const polish = merged.storylines.find((entry) =>
    entry.id === "storyline-polish-war-of-independence"
  );
  const serbia = merged.storylines.find((entry) =>
    entry.id === "storyline-austro-serbian-war"
  );

  const cases = [
    {
      name: "semantic duplicate wars collapse",
      pass: merged.storylines.length === 2 && merged.mergedDuplicateCount === 2,
      detail: `${merged.storylines.length} storyline(s), ${merged.mergedDuplicateCount} duplicate(s) merged`,
    },
    {
      name: "canonical war storyline id survives newer alias",
      pass:
        polish?.id === "storyline-polish-war-of-independence" &&
        polish?.state === "Newer duplicate-id copy." &&
        normalizeArray(polish?.sourceEventIds).includes("polish-a") &&
        normalizeArray(polish?.sourceEventIds).includes("polish-b"),
      detail: polish?.id || "",
    },
    {
      name: "canonical Austro-Serbian id keeps freshest state",
      pass:
        serbia?.id === "storyline-austro-serbian-war" &&
        serbia?.state === "Freshest Austro-Serbian state.",
      detail: serbia?.id || "",
    },
    {
      name: "360-day event is not current initiative evidence",
      pass: !recentEventEligibleForInitiative(
        { date: "1915-04-18" },
        "1916-04-12",
      ),
      detail: "1915-04-18 → 1916-04-12",
    },
    {
      name: "30-day storyline event remains current initiative evidence",
      pass: recentEventEligibleForInitiative(
        {
          date: "1916-03-13",
          importance: "minor",
          storylineIds: ["storyline-test"],
          impacts: {},
        },
        "1916-04-12",
      ),
      detail: "1916-03-13 storyline-linked",
    },
    {
      name: "minor no-impact narrative card is not a causal seed",
      pass: !recentEventEligibleForInitiative(
        {
          date: "1916-01-29",
          importance: "minor",
          notable: false,
          playerRelated: false,
          kind: "world",
          storylineIds: [],
          impacts: {},
        },
        "1916-04-12",
      ),
      detail: "minor + no impacts + no storyline",
    },
    {
      name: "minor structured event remains a causal seed",
      pass: recentEventEligibleForInitiative(
        {
          date: "1916-03-20",
          importance: "minor",
          notable: false,
          storylineIds: [],
          impacts: { markerOps: [{ op: "build" }] },
        },
        "1916-04-12",
      ),
      detail: "minor + persistent impact",
    },
  ];

  const stagnantHighPressure = {
    id: "storyline-motion-test",
    kind: "war",
    title: "Motion Test War",
    participants: ["Poland", "Russian Empire"],
    status: "active",
    pressure: 78,
    momentum: 20,
    startedDate: "1916-01-01",
    accountedThroughDate: "1916-06-11",
    lastUpdatedDate: "1916-06-11",
    lastVisibleEventDate: "1916-04-20",
    nextReviewDate: "1916-09-01",
    state: "A high-pressure stalemate remains unchanged.",
  };

  cases.push({
    name: "35-day high-pressure stagnation overrides later review date",
    pass: storylineNeedsAttentionWithin(
      stagnantHighPressure,
      "1916-06-11",
      "1916-07-11",
    ),
    detail: `stagnation ${storylineStagnationAgeDays(stagnantHighPressure, "1916-07-11")}d`,
  });

  const stagnantError = validateWorldStorylinePayload(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 78,
        momentum: 20,
        eventIndexes: [],
        state: "A high-pressure stalemate remains unchanged.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
    },
  );

  cases.push({
    name: "70-day high-pressure anti-stasis rejects copy-forward",
    pass: /anti-stasis backstop/i.test(stagnantError),
    detail: stagnantError || "unexpectedly accepted",
  });

  const repairIssues = findWorldStorylineAntiStasisIssues(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 78,
        momentum: 20,
        eventIndexes: [],
        state: "A high-pressure stalemate remains unchanged.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      stopDate: "1916-07-11",
    },
  );

  const nonFatalStagnantError = validateWorldStorylinePayload(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 78,
        momentum: 20,
        eventIndexes: [],
        state: "A high-pressure stalemate remains unchanged.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
      enforceAntiStasis: false,
    },
  );

  cases.push({
    name: "70-day anti-stasis is detectable without invalidating whole pass",
    pass: repairIssues.length === 1 && repairIssues[0]?.id === stagnantHighPressure.id && nonFatalStagnantError === "",
    detail: `${repairIssues.length} repair issue(s); validation ${nonFatalStagnantError || "accepted"}`,
  });

  const missingSelectedCandidate = {
    events: [],
    storylineUpdates: [],
  };
  const missingSelectedStrictError = validateWorldStorylinePayload(
    missingSelectedCandidate,
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
      enforceAntiStasis: false,
    },
  );
  const missingSelectedRepairableError = validateWorldStorylinePayload(
    missingSelectedCandidate,
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
      enforceAntiStasis: false,
      enforceSelectedCoverage: false,
    },
  );
  const missingSelectedIssues = findWorldStorylineAntiStasisIssues(
    missingSelectedCandidate,
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
    },
  );

  cases.push({
    name: "missing native-attention update becomes local repair instead of whole-pass failure",
    pass:
      /must include native-attention storyline/i.test(missingSelectedStrictError) &&
      missingSelectedRepairableError === "" &&
      missingSelectedIssues.length === 1 &&
      missingSelectedIssues[0]?.kind === "missing-update" &&
      missingSelectedIssues[0]?.id === stagnantHighPressure.id,
    detail:
      `strict=${missingSelectedStrictError || "accepted"}; ` +
      `repairable=${missingSelectedRepairableError || "accepted"}; ` +
      `issues=${missingSelectedIssues.map((issue) => `${issue.kind}:${issue.id}`).join(", ") || "none"}`,
  });

  const evolvedError = validateWorldStorylinePayload(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 74,
        momentum: 28,
        eventIndexes: [],
        state: "The front remains intact, but both commands reorganize and operational tempo begins to recover.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
    },
  );

  cases.push({
    name: "70-day backstop accepts objective hidden evolution",
    pass: evolvedError === "",
    detail: evolvedError || "pressure/momentum changed",
  });

  const lowPressureActiveWar = {
    id: "storyline-polish-war-of-independence",
    kind: "war",
    title: "War of Polish Independence",
    participants: ["Poland", "Russian Empire"],
    status: "active",
    pressure: 65,
    momentum: 25,
    startedDate: "1915-04-18",
    accountedThroughDate: "1916-12-08",
    lastUpdatedDate: "1916-12-08",
    lastVisibleEventDate: "1916-11-20",
    nextReviewDate: "1917-04-07",
    state: "Winter positions hold while the active war remains unresolved.",
  };

  cases.push({
    name: "35-day active-war review overrides pressure cliff",
    pass: storylineNeedsAttentionWithin(
      lowPressureActiveWar,
      "1917-01-07",
      "1917-02-06",
      fixtureWorld,
    ),
    detail: `review age ${storylineReviewAgeDays(lowPressureActiveWar, "1917-02-06")}d at pressure ${lowPressureActiveWar.pressure}`,
  });

  const lowPressureWarAntiStasis = findWorldStorylineAntiStasisIssues(
    {
      events: [],
      storylineUpdates: [{
        ...lowPressureActiveWar,
        pressure: 65,
        momentum: 25,
        eventIndexes: [],
        state: lowPressureActiveWar.state,
      }],
    },
    {
      existingStorylines: [lowPressureActiveWar],
      selectedStorylines: [lowPressureActiveWar],
      stopDate: "1917-02-06",
      world: fixtureWorld,
    },
  );

  cases.push({
    name: "70-day active-war anti-stasis ignores pressure cliff",
    pass:
      lowPressureWarAntiStasis.length === 1 &&
      lowPressureWarAntiStasis[0]?.activeWar === true,
    detail: `${lowPressureWarAntiStasis.length} issue(s) at pressure ${lowPressureActiveWar.pressure}`,
  });

  const lowPressureNonWar = {
    ...lowPressureActiveWar,
    id: "storyline-domestic-control",
    kind: "politics",
    title: "Domestic Control Test",
    participants: ["Poland"],
    nextReviewDate: "1917-04-07",
  };

  cases.push({
    name: "non-war pressure 65 keeps ordinary review cadence",
    pass: !storylineNeedsAttentionWithin(
      lowPressureNonWar,
      "1917-01-07",
      "1917-02-06",
      fixtureWorld,
    ),
    detail: "not forced by active-war guard",
  });

  cases.push({
    name: "active-war persisted review cadence caps at 35 days",
    pass: recommendedReviewDays(65, 25, "active", { activeWar: true }) === 35,
    detail: `${recommendedReviewDays(65, 25, "active", { activeWar: true })}d`,
  });

  const deferredQuietCandidate = {
    events: [{
      title: "Independent material event",
      description: "A separate development occurs elsewhere.",
      impacts: {},
    }],
    storylineUpdates: [
      {
        id: "storyline-selected-test",
        status: "active",
        pressure: 72,
        momentum: 24,
        startedDate: "1916-01-01",
        kind: "war",
        title: "Selected Test War",
        participants: ["Poland", "Russian Empire"],
        eventIndexes: [0],
        state: "A material development changes the selected process.",
      },
      {
        id: "storyline-deferred-quiet-test",
        status: "active",
        pressure: 35,
        momentum: 15,
        startedDate: "1915-01-01",
        kind: "diplomacy",
        title: "Deferred Quiet Test",
        participants: ["German Empire", "British Empire"],
        eventIndexes: [],
        state: "The quiet detente remains unchanged.",
      },
    ],
  };
  const quietSalvage = stripQuietDeferredStorylineUpdates(
    deferredQuietCandidate,
    [{
      id: "storyline-deferred-quiet-test",
      status: "active",
      pressure: 35,
      momentum: 15,
      title: "Deferred Quiet Test",
    }],
  );
  const remainingQuietSalvageUpdates = decodeWorldStorylineUpdates(
    deferredQuietCandidate.storylineUpdates,
  );

  cases.push({
    name: "final-attempt salvage strips only quiet deferred bookkeeping",
    pass:
      quietSalvage.strippedIds.length === 1 &&
      quietSalvage.strippedIds[0] === "storyline-deferred-quiet-test" &&
      remainingQuietSalvageUpdates.length === 1 &&
      remainingQuietSalvageUpdates[0]?.id === "storyline-selected-test",
    detail: `${quietSalvage.strippedIds.join(", ") || "none"} stripped`,
  });

  const passed = cases.every((entry) => entry.pass);
  console.table(cases);
  console.info(
    `[OH Native World Director self-test] ${passed ? "PASS" : "FAIL"} — ` +
    `${cases.filter((entry) => entry.pass).length}/${cases.length}`,
  );
  return { passed, cases };
};

const installDebugApi = () => {
  if (typeof globalThis === "undefined") return;

  globalThis.__OH_NATIVE_WORLD_DIRECTOR__ = {
    version: WORLD_DIRECTOR_VERSION,
    last: () => lastAnalysis
      ? JSON.parse(JSON.stringify(lastAnalysis))
      : null,
    selfTest: () => runWorldDirectorSelfTests(),
  };
};

installDebugApi();

export const buildWorldInitiativeContext = (
  bundle,
  {
    targetDate = "",
    maxCandidates = DEFAULT_MAX_CANDIDATES,
  } = {},
) => {
  const originDate = normalizeString(bundle?.game?.gameDate);
  const horizonDate = normalizeString(targetDate) || originDate;
  const candidates = [];
  const storylineAttention = selectStorylineAttention(
    bundle?.world || {},
    originDate,
    horizonDate,
  );

  const selectedStorylineIds = new Set(
    storylineAttention.selected
      .map((storyline) => normalizeString(storyline.id))
      .filter(Boolean),
  );

  const allDeferredStorylines = storylineAttention.all
    .filter((storyline) =>
      storyline.status !== "resolved" &&
      !selectedStorylineIds.has(normalizeString(storyline.id))
    );

  const deferredStorylineIds = new Set(
    allDeferredStorylines
      .map((storyline) => normalizeString(storyline.id))
      .filter(Boolean),
  );

  const deferredSourceEventIds = new Set(
    allDeferredStorylines
      .flatMap((storyline) => normalizeArray(storyline?.sourceEventIds))
      .map(normalizeString)
      .filter(Boolean),
  );

  const selectedParticipantKeys = new Set(
    storylineAttention.selected
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter(Boolean),
  );

  const suppressedDeferredParticipantKeys = new Set(
    allDeferredStorylines
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter((actor) => actor && !selectedParticipantKeys.has(actor)),
  );

  const diplomaticAttention = buildBoundedDiplomaticContext(bundle?.world || {}, {
    playerPolity: normalizeString(bundle?.game?.country),
    selectedStorylines: storylineAttention.selected,
    maxActors: 8,
  });

  const canonicalStorylineId = (value) => {
    const id = normalizeString(value);
    return storylineAttention.aliasToCanonical?.get(id) || id;
  };

  const recentEvents = normalizeArray(bundle?.events).slice(-RECENT_EVENT_WINDOW);
  let deferredRecentEventsSuppressed = 0;
  let staleRecentEventsSuppressed = 0;
  let lowSignalRecentEventsSuppressed = 0;

  recentEvents.forEach((event, index) => {
    const eventId = normalizeString(event?.id);
    const eventStorylineIds = normalizeArray(event?.storylineIds)
      .map(canonicalStorylineId)
      .filter(Boolean);

    if (!recentEventEligibleForInitiative(event, originDate)) {
      const age = ageDays(originDate, event?.date);
      if (
        parseIsoDate(originDate) != null &&
        parseIsoDate(event?.date) != null &&
        age > RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS
      ) {
        staleRecentEventsSuppressed += 1;
      } else {
        lowSignalRecentEventsSuppressed += 1;
      }
      return;
    }

    const belongsToSelected =
      eventStorylineIds.some((id) => selectedStorylineIds.has(id));

    const belongsToDeferred =
      eventStorylineIds.some((id) => deferredStorylineIds.has(id)) ||
      (eventId && deferredSourceEventIds.has(eventId));

    // A deferred process remains canonical through its storyline state, but its
    // recent cards are not fresh initiative candidates. Otherwise the causal
    // ledger immediately re-injects the exact process the scheduler deferred.
    if (belongsToDeferred && !belongsToSelected) {
      deferredRecentEventsSuppressed += 1;
      return;
    }

    const candidate = eventCandidate(event, originDate, index);
    if (candidate) candidates.push(candidate);
  });

  const recentChats = normalizeArray(bundle?.chats).slice(-RECENT_CHAT_WINDOW);
  recentChats.forEach((chat, index) => {
    const candidate = chatCandidate(chat, originDate, index);
    if (candidate) candidates.push(candidate);
  });

  const consolidated = normalizeArray(bundle?.world?.consolidatedHistory)
    .slice(-CONSOLIDATED_HISTORY_WINDOW);
  const durableCanonExcludedFromInitiative = consolidated.length;
  // Consolidated history remains available in the ordinary world-history prompt.
  // It is chronology/continuity, not present-tense pressure, so do not inject it
  // again into CURRENT EXPLICIT EVIDENCE.

  pushTerritorialCandidates(
    candidates,
    bundle?.world || {},
    suppressedDeferredParticipantKeys,
    normalizeString(bundle?.game?.country),
  );
  pushActiveUnitCandidates(
    candidates,
    bundle?.world || {},
    suppressedDeferredParticipantKeys,
    normalizeString(bundle?.game?.country),
  );

  const activeCatalyst = bundle?.world?.activeCatalyst;
  if (activeCatalyst && typeof activeCatalyst === "object") {
    const title = normalizeString(activeCatalyst.title);
    const premise = normalizeString(activeCatalyst.premise || activeCatalyst.opening);
    if (title || premise) {
      candidates.push({
        id: "active-catalyst",
        type: "active-crisis",
        score: 11,
        date: originDate,
        title: title || "Active unresolved crisis",
        detail: truncate(premise, 320),
        ageDays: 0,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  deduped.sort((a, b) =>
    (b.score - a.score) ||
    (a.ageDays - b.ageDays) ||
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  const bounded = selectBoundedCandidates(
    deduped,
    maxCandidates,
  );

  const explorationSlate = buildNativeWorldExplorationSlate({
    bundle,
    allStorylines: storylineAttention.all,
    selectedStorylines: storylineAttention.selected,
    diplomaticActors: diplomaticAttention.actors,
    causalCandidates: bounded,
  });

  const explorationActors = explorationSlate
    .filter((slot) => slot.type === "actor-domain")
    .map((slot) => slot.actor);

  const economicAttention = buildEconomicAttentionContext(
    bundle,
    storylineAttention,
    explorationActors,
  );

  const currentUnitLedger = formatCurrentPersistentUnitLedger(bundle?.world || {});
  const currentUnitCount = normalizeArray(bundle?.world?.units).length;

  const lines = bounded.map((candidate, index) => {
    const meta = [
      candidate.type,
      candidate.date ? candidate.date : "",
      `priority ${candidate.score}`,
    ].filter(Boolean).join(" | ");

    return `${index + 1}. [${meta}] ${candidate.title}` +
      (candidate.detail ? `\n   Current causal basis: ${candidate.detail}` : "");
  });

  const deferredStorylines = allDeferredStorylines
    .slice(0, MAX_DEFERRED_STORYLINE_HINTS);
  const deferredLines = deferredStorylines.map((storyline, index) => {
    const stagnationAge = storylineStagnationAgeDays(storyline, horizonDate);
    const meta = [
      storyline.id,
      storyline.kind,
      storyline.status,
      `pressure ${storyline.pressure}`,
      `momentum ${storyline.momentum}`,
      `visible-stagnation ${stagnationAge}d`,
      storyline.nextReviewDate ? `next review ${storyline.nextReviewDate}` : "review not scheduled",
    ].join(" | ");
    return `${index + 1}. [${meta}] ${storyline.title}`;
  });

  const attentionLines = storylineAttention.selected.map((storyline, index) => {
    const visibleAge = parseIsoDate(storyline.lastVisibleEventDate) != null
      ? ageDays(originDate, storyline.lastVisibleEventDate)
      : 99999;
    const visibilityGate = visibleAge <= 45
      ? `visibility gate: a timeline card was emitted ${visibleAge} day(s) ago; another card now requires a material state change, consequence, escalation/de-escalation, new actor/geography/capability, or other genuinely newsworthy milestone`
      : visibleAge < 99999
        ? `visibility history: last visible milestone ${visibleAge} day(s) ago`
        : "visibility history: no prior visible milestone recorded";

    const stagnationAge = storylineStagnationAgeDays(storyline, horizonDate);

    const stagnationReappraisal =
      storyline.pressure >= HIGH_PRESSURE_STAGNATION_THRESHOLD &&
      stagnationAge >= STAGNATION_BACKSTOP_DAYS
        ? `ANTI-STASIS BACKSTOP: this active high-pressure process reaches ${stagnationAge} day(s) without a visible milestone by the pass horizon. Simulate its actors and internal conditions now. The border may remain unchanged, but do NOT copy the same semantic equilibrium forward: produce a material event, materially shift pressure/momentum, cool/de-escalate, or move toward dormant/resolution.`
        : storyline.pressure >= HIGH_PRESSURE_STAGNATION_THRESHOLD &&
          stagnationAge >= STAGNATION_REAPPRAISAL_DAYS
          ? `ENDOGENOUS REAPPRAISAL REQUIRED: this active high-pressure process reaches ${stagnationAge} day(s) without a visible milestone by the pass horizon. Re-simulate actor objectives, manpower/resources, supply, command, morale, politics, diplomacy, weather, tactics, and opportunities from INSIDE the process. A genuine equilibrium may still hold; do not force a card.`
          : "";

    const meta = [
      storyline.id,
      storyline.kind,
      storyline.status,
      `pressure ${storyline.pressure}`,
      `momentum ${storyline.momentum}`,
      storyline.nextReviewDate ? `next review ${storyline.nextReviewDate}` : "review overdue",
    ].join(" | ");

    const detail = [
      storyline.participants.length ? `participants: ${storyline.participants.join(", ")}` : "",
      storyline.state ? `state: ${storyline.state}` : "",
      storyline.drivers.length ? `drivers: ${storyline.drivers.join("; ")}` : "",
      storyline.constraints.length ? `constraints: ${storyline.constraints.join("; ")}` : "",
      storyline.accountedThroughDate ? `accounted through: ${storyline.accountedThroughDate}` : "",
      visibilityGate,
      stagnationReappraisal,
    ].filter(Boolean).join("\n   ");

    return `${index + 1}. [${meta}] ${storyline.title}${detail ? `\n   ${detail}` : ""}`;
  });

  const explorationLines = explorationSlate.map((slot) => {
    const deferredGuard = slot.deferredTopics.length
      ? ` Avoid routine restatement of deferred process(es): ${slot.deferredTopics.join("; ")}. Deferral does NOT freeze their actors: a genuinely material endogenous development or external trigger may reactivate one.`
      : "";

    const basis = normalizeString(slot.basis)
      ? ` Current native basis: ${normalizeString(slot.basis)}.`
      : " No specific current pressure was identified; inspect latent causes conservatively.";

    return `${slot.id}. ${slot.actor} — inspect ${slot.domain}.${basis}${deferredGuard}`;
  });

  const latestVisibleDate = latestCanonicalWorldEventDate(
    bundle?.events,
    originDate,
  );

  const visibleSilenceDays = latestVisibleDate
    ? worldIntegrityAgeDays(originDate, latestVisibleDate)
    : 99999;

  const horizonDays = originDate && horizonDate
    ? worldIntegrityAgeDays(horizonDate, originDate)
    : 0;

  const consequenceSignal = assessRecentWorldConsequenceLiveness({
    events: bundle?.events,
    referenceDate: originDate,
  });
  const consequenceLine = consequenceSignal.level === "low"
    ? `RECENT CONSEQUENCE SIGNAL: LOW — ${consequenceSignal.eventCount} visible event(s) occurred in the last ${consequenceSignal.lookbackDays} day(s), but only ${consequenceSignal.consequentialCount} crossed a material strategic/political/territorial threshold. Increase THRESHOLD SEARCH PRIORITY inside the SAME simulation pass: re-examine mature current pressures for outcomes that may now have resolved, escalated, cooled, failed, or materially changed. This is NOT a drama quota; never invent a coup, war, collapse, treaty, or crisis merely to satisfy the signal.`
    : `Recent consequence signal: ${consequenceSignal.consequentialCount}/${consequenceSignal.eventCount} visible event(s) crossed a material threshold in the last ${consequenceSignal.lookbackDays} day(s); no special threshold-search bias is required.`;

  const livenessLine =
    visibleSilenceDays >= 45 && visibleSilenceDays < 99999
      ? `LIVENESS SEARCH ESCALATION: ${visibleSilenceDays} day(s) have passed since the last canonical visible event. This increases SEARCH EFFORT, not event quota: inspect every exploration slot carefully for strategic change, ordinary consequential history, or specific human/public developments worth showing.`
      : visibleSilenceDays >= 99999
        ? "LIVENESS SEARCH ESCALATION: no prior canonical visible event is available; inspect the exploration slate carefully without manufacturing calendar filler."
        : `Recent visible-history gap: ${visibleSilenceDays} day(s).`;

  const breadthLine = horizonDays >= 21
    ? `GLOBAL BREADTH CHECK: this whole-world pass spans ${horizonDays} day(s). A final set of 0-3 visible events is unusually sparse, though not forbidden. Complete the exploration slate before finalizing: finding one or two excellent events is NOT a reason to stop searching unrelated regions and actors across ordinary politics/economics/industry, diplomacy, society, science/technology, public life/culture, accidents/disasters, and genuinely changing military situations. This is search calibration, NOT a minimum count or quota: never invent an event merely to increase the number.`
    : horizonDays >= 7
      ? `GLOBAL BREADTH CHECK: this pass spans ${horizonDays} day(s). Sparse output can be valid, but still inspect unrelated actors and both consequential and human/public lanes before concluding that little worth showing occurred.`
      : `GLOBAL BREADTH CHECK: short horizon (${horizonDays || "<1"} day(s)); zero visible events may be completely natural. Do not pad the calendar.`;

  const text = [
    `[Native World Director v${WORLD_DIRECTOR_VERSION} — persistent storyline attention + causal ledger]`,
    `Origin: ${originDate || "unknown"}`,
    `Horizon: ${horizonDate || "unknown"}`,
    "",
    "PERSISTENT STORYLINE ATTENTION",
    "These are unresolved world processes selected by the native scheduler. Every listed storyline must receive one compact storylineUpdates record describing its semantic state through the actual stopDate, even if no visible timeline event is warranted.",
    attentionLines.length
      ? attentionLines.join("\n")
      : "No persisted storyline is due for review yet. New unresolved processes created during this pass must still be persisted and carried to stopDate.",
    "",
    "DEFERRED PERSISTED STORYLINES — LOW ATTENTION, NOT FROZEN",
    deferredLines.length
      ? deferredLines.join("\n") + (allDeferredStorylines.length > deferredLines.length ? `\n... plus ${allDeferredStorylines.length - deferredLines.length} additional deferred storyline(s).` : "")
      : "None.",
    "These persisted processes are outside this pass's focused attention window, so they are NOT entitled to routine servicing, another artillery/patrol card, or a quiet bookkeeping rewrite merely because they exist.",
    "But deferral schedules ATTENTION, not causality. Their own actors, commanders, institutions, supply systems, politics, morale, objectives, and opponents remain autonomous. If those INTERNAL forces plausibly produce a genuinely material development, the storyline may reactivate itself without waiting for an unrelated external trigger. Link the material event to that existing storyline. External triggers may reactivate it too.",
    "Continuity is not novelty: another unchanged bombardment, patrol, meeting, weather slowdown, or paraphrase of the same stalemate is still forbidden. Surface what CHANGED because of the ongoing process, not the fact that it continued.",
    "",
    "ACTIVE PROCESS CAUSAL AUDIT",
    "For every selected active war/crisis/high-pressure process, actually SIMULATE the actors during this interval before deciding the state is unchanged. Ask: what is each side trying to accomplish; what can it afford; what opportunities/constraints exist; what does the opponent do; what succeeds, partially succeeds, or fails; and what military, political, economic, diplomatic, command, morale, supply, or social consequence follows?",
    "Do not treat relative country size or historical expectation as a deterministic winner. A smaller power may hold, counterattack, recover ground, exploit overextension, force negotiations, or suffer collapse depending on current capabilities and decisions. A larger power may fail locally. Branch from THIS campaign.",
    "WWI-era/trench warfare may produce long stretches with little territorial movement. That is legal. But a static border does not mean a dead process: offensives can fail, casualties/attrition can matter, commanders can change, supply can tighten, morale/politics can move, tactical adaptation can occur, negotiations can emerge, or both sides can deliberately reorganize. Only a material consequence deserves a card.",
    `At ${STAGNATION_REAPPRAISAL_DAYS}+ days without a visible milestone, a high-pressure active process gets mandatory endogenous reappraisal. At ${STAGNATION_BACKSTOP_DAYS}+ days, it may not simply copy materially the same equilibrium forward again: link a material event, materially move pressure/momentum, change status, or establish a genuinely different hidden operational/political state reflected in those fields. This is an anti-stasis rule, NOT an event quota.`,
    "",
    "WORLD ATTENTION FAIRNESS",
    "Selected storylines are priorities, NOT ownership of the whole world. A dominant war or crisis may receive more attention, but it must not erase unrelated diplomacy, domestic politics, economic developments, military modernization, regional tensions, or genuinely new initiatives elsewhere.",
    "",
    "VISIBLE HISTORY GATE",
    "Scheduler selection means REVIEW AND UPDATE THE HIDDEN STORYLINE STATE. It does NOT entitle that storyline to a visible timeline card.",
    "A visible event does NOT need to be a decade-defining milestone or something the campaign will still care about years later. Keep specific history worth showing through any of three lanes: (A) major/high-pressure change such as a breakthrough, legal/territorial change, new belligerent, severe crisis or government change; (B) ORDINARY CONSEQUENTIAL history such as a concrete policy result, appointment, industrial initiative, completed infrastructure/capability step, labor/social development, diplomatic move, scientific/technical development, or other new fact that changes what actors can do next; (C) HUMAN/PUBLIC TEXTURE such as a public appearance, ceremony, funeral, wedding, fair, sport, culture, university life, scandal, accident, disaster/public response, notable speech, popular craze, or other specific social/personality event that makes the world feel inhabited.",
    "Small-scale is NOT the same as filler. Filler means empty process churn, generic status reporting, calendar padding, or another wording of an unchanged state. A modest event with a concrete outcome, memorable human texture, or a new cause/effect is legitimate history even when it has no structured map impact.",
    "Routine continuation belongs in storylineUpdates ONLY: repeated artillery exchanges, patrols/probes/skirmishes with no operational consequence, unchanged sieges/fronts, seasonal/weather slowdowns that merely preserve the same posture, recurring intelligence reviews, routine meetings/consultations, and administrative follow-up should not consume timeline slots merely because the process remains active.",
    "High pressure is NOT novelty. A pressure-95 war may still produce zero visible events in a particular pass when the equilibrium genuinely holds. But high pressure is also not permission for suspended animation: obey the 35/70-day endogenous reappraisal rules, and cool momentum/de-escalate/dormant a process that has genuinely ceased to evolve instead of manufacturing fresh wording for the same state.",
    "",
    "INDEPENDENT WORLD SWEEP",
    "After servicing the selected storylines, independently inspect actors and causes that are NOT already represented by deferred persisted storylines. Search the whole living world, not only current wars or the player's neighborhood.",
    "Deliberately inspect three lanes: (1) consequential politics/diplomacy/economics/war/technology/social change; (2) ordinary but concrete world motion such as private industrial initiatives, appointments, local political contests, completed projects, discoveries, labor disputes, institutional decisions, and regional developments; (3) human/public texture such as rulers and personalities, culture, sport, universities, ceremonies, scandals, accidents, weather/disasters and public response, civic life, and unusual social episodes.",
    "The independent sweep is for NEW autonomous developments and genuinely new triggers. It may encounter actors who also belong to a deferred storyline: do not service that storyline routinely, but do allow a genuinely material ENDOGENOUS development from those actors/conditions to reactivate it. Recent-history salience alone is never enough.",
    `Inside the PLAYER POLITY, the world is still alive: private firms, workers, parties, opposition movements, newspapers, intellectuals, social groups, emerging political personalities, courts, local/state officials, police, officers, and other non-sovereign actors may act autonomously and may create pressure, opportunities, scandals, unrest, inventions, localized violence, or faits accomplis. They must NOT make major sovereign/executive choices on the player's behalf such as choosing national foreign policy, declaring war, signing treaties, ordering strategic mobilization, or deliberately adopting a major national programme. Create the situation; leave ${normalizeString(bundle?.game?.country) || "the player polity"}'s major sovereign choices to the player.`,
    "New personalities and movements may emerge when the campaign's conditions support them; do not require a famous historical name or a pre-existing catalog entry. Give major radicalization, coups, civil wars, and similar severe domestic crises a causal runway rather than spawning them from a normal background with no prior pressure.",
    "This sweep is an evaluation duty, NOT a diversity quota. A specific country, war, or domain may genuinely have nothing worth showing. But absence of a major geopolitical milestone is NOT evidence that an entire month across the whole world contains no history.",
    "The visible-event ceiling is a maximum, not an allocation. Do not fill every slot, do not space cards mechanically, and do not invent content to hit a count. At the same time, complete the exploration slate before finalizing: one, two, or three excellent events are not a reason to stop searching the rest of the world.",
    "New autonomous processes may begin in any pass when current interests, structures, personalities, social pressures, and capabilities justify them.",
    breadthLine,
    consequenceLine,
    consequenceSignal.level === "low"
      ? "When the consequence signal is LOW, search existing selected storylines and current causal evidence FIRST for developments that have genuinely crossed from process into outcome: a vote resolves, a cabinet changes, a strike begins/ends, a project delivers a new capability, a negotiation concludes/fails, a crisis escalates/cools, or a military operation produces a material result. Ordinary concrete history remains valid; this only changes search ordering."
      : "Do not manufacture threshold events when current causes do not support them.",
    "",
    "NATIVE WORLD EXPLORATION SLATE",
    "Named actor slots are selected only from current campaign evidence (wars, diplomacy, agreements, unresolved processes, units/territory, explicit active lifecycle, or the filtered current causal ledger). They are not sampled from the raw historical/catalog identity registry. The slate is an EVALUATION slate, not a quota and not a request to invent one event per line.",
    "For independent initiative, treat CURRENT EXPLICIT EVIDENCE and each slot's Current native basis as the present-tense causal seeds. A low-value timeline card that is absent from this current ledger is background history, not permission to manufacture another continuation of it.",
    explorationLines.length
      ? explorationLines.join("\n")
      : "No actor-specific exploration slots were available.",
    livenessLine,
    "",
    ...formatWorldExplorationAuditContract(explorationSlate),
    "",
    "CANONICAL DIPLOMATIC STATE",
    "This is a bounded slice of the persistent diplomatic ledger, not a dump of every country pair. Formal commitments, bilateral political climate, and actual wars are separate facts.",
    diplomaticAttention.text,
    "",
    "CANONICAL ECONOMIC CONSTRAINTS",
    "Only actors with an already-persisted native Stats baseline are listed here; absence means no canonical numeric baseline exists, not that the actor has infinite resources.",
    "Use these figures as causal capability/financing constraints, never as rigid action gates. A stressed polity can still mobilize, subsidize, build, or fight by borrowing, taxing, cutting elsewhere, seeking foreign finance, monetizing, or accepting inflation/debt/political consequences.",
    economicAttention.length
      ? economicAttention.map((row, index) => `${index + 1}. ${row.summary}`).join("\n")
      : "No attention/exploration actor currently has a canonical economic Stats baseline.",
    "",
    "CANONICAL CURRENT MILITARY UNIT STATE",
    "world.units is the authoritative and exhaustive ledger of named persistent military formations that exist RIGHT NOW.",
    "History may remember units that no longer exist. Absence from this ledger is authoritative negative evidence: do not resurrect a deleted/disbanded unit from Event History, consolidated history, chat, or scenario prose.",
    currentUnitLedger,
    "",
    "CURRENT EXPLICIT EVIDENCE",
    "These are current causal pressures / continuity anchors, NOT scheduled events and NOT an exhaustive list.",
    "A foreign polity may still take a genuinely new initiative when its present interests and capabilities justify it.",
    "",
    "Ranked current-state evidence:",
    lines.length
      ? lines.join("\n")
      : "No strong explicit pressure was detected by the cheap native pass.",
    "",
    "LATENT / HISTORICAL POSSIBILITY",
    "The explicit ledger is only one source of initiative. Structural conditions that have not recently produced a visible event still exist: alliances, guarantees, rivalries, nationalism, ideology, domestic instability, leadership, military doctrine, mobilization assumptions, economic pressure, colonial competition, social movements, and similar background causes.",
    "CAUSAL INERTIA IS REAL. A campaign does not become ahistorical merely because the player has not touched a process. Existing commitments, rivalries, institutions, plans, unresolved crises, movements, incentives, and fears continue to exert pressure until THIS campaign changes, exhausts, supersedes, or resolves them.",
    "Real historical developments AFTER the origin date may be considered as CANDIDATES when their important causal prerequisites remain substantially intact in THIS campaign and no simulated divergence has invalidated them.",
    "HISTORICAL CONTINUITY IS NOT A PENALTY. When the relevant causal structure has NOT materially changed, that surviving structure is itself a present-tense reason for actors to continue along a historically similar path. Prefer the development best supported by the current world even when it resembles real history; do not invent novelty merely to prove the timeline is alternate.",
    "A historical candidate is never an appointment. Historical timing must be CAUSALLY RE-EARNED: an exact historical date may survive only when the current campaign still preserves the scheduling mechanism that would put the event on that date (for example an already-planned visit, fixed election, treaty deadline, or other independently scheduled process). A date known only from memorized future chronology is not a cause.",
    "After any major shock, assassination, declaration, collapse, election, coup, mobilization, treaty, or other branch-changing development, downstream history is reset to possibilities. Recalculate every actor's next choice from current commitments, support, risk, capability, and player authorization.",
    "If circumstances HAVE materially changed, an actor taking substantially the same escalatory course as real history must be supported by a current-campaign reason. If circumstances have NOT materially changed, do not demand an artificial new trigger just because the resulting choice resembles history.",
    "Anti-railroading forbids calendar scripts and unsupported downstream assumptions; it does NOT erase historical momentum. No explicit candidate does NOT mean history is suspended, and surviving historical conditions do NOT mean history is guaranteed.",
    "",
    "WORLD CONTINUITY CONTRACT",
    "Timeline events are only visible milestones. Persistent storylines are the authoritative hidden state of ongoing processes.",
    "The tool field storylineUpdates is ONE STRING, not an array. Return either an empty string when no storyline needs persistence, or one record per line (maximum 16) using exactly: id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventNumbersCSV~state",
    "Never use ~ inside a storyline field. status = active | dormant | resolved. pressure and momentum are 0-100. startedDate is YYYY-MM-DD when known for a new process and may be blank for an existing one. For an existing storyline, kind/title/participants may be blank because runtime preserves them. eventNumbersCSV is an optional compatibility hint and may be blank because native code owns causal linkage. state must describe what is true through the actual stopDate.",
    `For every scheduler-selected storyline, return a compact storylineUpdates record whose state describes what is true through THIS PASS stopDate. High momentum must produce real semantic evolution across multi-week passes. Every canonical ACTIVE war receives endogenous reappraisal at about ${STAGNATION_REAPPRAISAL_DAYS} days regardless of pressure; other high-pressure processes use the same soft guard. Active wars and other protected high-pressure processes reach objective anti-stasis at ${STAGNATION_BACKSTOP_DAYS} days without a visible milestone. Runtime stamps accounting/review dates.`,
    "When a new event creates an unresolved multi-step process, create a compact storylineUpdates record. You MAY leave eventNumbersCSV blank: native runtime binds storyline records to causally matching events and attaches storylineIds before persistence. Do not spend reasoning effort counting event positions.",
    "pressure = seriousness/unresolved stakes. momentum = current rate of meaningful change. High pressure can coexist with low momentum (for example a frozen war).",
  ].join("\n");

  lastAnalysis = {
    version: WORLD_DIRECTOR_VERSION,
    originDate,
    targetDate: normalizeString(targetDate),
    candidateCount: bounded.length,
    storylineCount: storylineAttention.all.length,
    attentionCount: storylineAttention.selected.length,
    attentionStorylines: storylineAttention.selected,
    deferredCount: allDeferredStorylines.length,
    deferredStorylines: allDeferredStorylines,
    deferredPromptStorylines: deferredStorylines,
    explorationSlate,
    explorationSlotCount: explorationSlate.length,
    explorationActorCount: explorationSlate.filter((slot) => slot.type === "actor-domain").length,
    visibleSilenceDays,
    horizonDays,
    consequenceSignal,
    stagnationPolicy: {
      highPressure: HIGH_PRESSURE_STAGNATION_THRESHOLD,
      activeWarsRegardlessOfPressure: true,
      reappraisalDays: STAGNATION_REAPPRAISAL_DAYS,
      backstopDays: STAGNATION_BACKSTOP_DAYS,
    },
    deferredRecentEventsSuppressed,
    staleRecentEventsSuppressed,
    lowSignalRecentEventsSuppressed,
    durableCanonExcludedFromInitiative,
    mergedDuplicateStorylines: storylineAttention.mergedDuplicateCount || 0,
    duplicateStorylineGroups: storylineAttention.duplicateGroups || [],
    economicActors: economicAttention,
    currentUnitCount,
    diplomaticActors: diplomaticAttention.actors,
    diplomaticRelations: diplomaticAttention.relations,
    diplomaticAgreements: diplomaticAttention.agreements,
    scanned: {
      recentEvents: recentEvents.length,
      recentEventsSuppressedAsDeferredEvidence: deferredRecentEventsSuppressed,
      recentEventsSuppressedAsStaleInitiative: staleRecentEventsSuppressed,
      recentEventsSuppressedAsLowSignalInitiative: lowSignalRecentEventsSuppressed,
      durableCanonExcludedFromCurrentInitiative: durableCanonExcludedFromInitiative,
      mergedDuplicateStorylines: storylineAttention.mergedDuplicateCount || 0,
      recentChats: recentChats.length,
      consolidatedHistory: consolidated.length,
      storylines: storylineAttention.all.length,
    },
    candidates: bounded,
    doctrine: {
      historicalEvents: "candidates-not-appointments",
      historicalTiming: "causally-re-earned",
      historicalConsequences: "branch-recomputed",
      historicalContinuity: "causal-inertia-not-penalized",
      unchangedHistoricalStructure: "surviving-causes-are-present-tense-reason",
      unchangedHistoricalDateRequires: "surviving-scheduling-mechanism",
      playerSilence: "no-new-authorization",
      worldProcesses: "persistent-storylines-not-event-cards",
      currentUnits: "world.units-exhaustive-history-cannot-resurrect-absent-formations",
      storylineTransport: "compact-line-records",
      storylineBookkeeping: "runtime-owned",
      schedulerFairness: "diversity-aware-with-starvation-and-recent-visibility-cooldown",
      liveness: "breadth-plus-endogenous-active-war-and-high-pressure-motion-without-event-quota",
      reviewCadence: "35d-active-war-or-high-pressure-reappraisal-70d-objective-anti-stasis",
      visibleMilestones: "strategic-ordinary-consequential-or-human-texture",
      deferredStorylines: "low-attention-not-frozen-material-endogenous-reentry-allowed",
      candidateBreadth: "deferred-storyline-evidence-suppressed-plus-repeat-penalties",
      exploration: "deterministic-rotating-actor-domain-slate-with-validated-audit",
      precuration: "native-integrity-screen-before-hidden-pass-state",
      stagnation: "35d-active-war-or-high-pressure-soft-reappraisal-70d-no-copy-forward-backstop",
      scheduler: "bounded-native-attention",
      eventDensity: "state-dependent-two-stage-world-composition-post-curator-no-hard-quota",
    },
    generatedAt: new Date().toISOString(),
  };

  installDebugApi();

  console.info(
    `[OH Native World Director v${WORLD_DIRECTOR_VERSION}] ` +
    `${storylineAttention.selected.length}/${storylineAttention.all.length} storyline(s) selected, ` +
    `${explorationSlate.length} exploration slot(s), ${bounded.length} causal candidate(s), ` +
    `${economicAttention.length} economic actor baseline(s), ${currentUnitCount} current unit(s), ` +
    `${diplomaticAttention.relations.length} relation(s), ${diplomaticAttention.agreements.length} agreement(s), ` +
    `${recentEvents.length} recent event(s), ${recentChats.length} recent chat(s)`,
  );

  if (typeof globalThis !== "undefined" && globalThis.__OH_CONTEXT_DIAGNOSTICS__ === true) {
    console.groupCollapsed(
      `[OH World Exploration v${WORLD_DIRECTOR_VERSION}] ${explorationSlate.length} slot(s); ` +
      `visible silence ${visibleSilenceDays < 99999 ? `${visibleSilenceDays}d` : "unknown"}; ` +
      `${deferredRecentEventsSuppressed} deferred + ${staleRecentEventsSuppressed} stale + ${lowSignalRecentEventsSuppressed} low-signal recent event candidate(s) suppressed; ` +
      `${durableCanonExcludedFromInitiative} durable canon block(s) kept out of current initiative; ` +
      `${storylineAttention.mergedDuplicateCount || 0} duplicate storyline(s) coalesced`,
    );
    console.table(
      explorationSlate.map((slot) => ({
        id: slot.id,
        actor: slot.actor,
        relevance: slot.relevance ?? "",
        domain: slot.domain,
        basis: slot.basis || "",
        deferredTopics: slot.deferredTopics.join("; "),
      })),
    );
    console.info("selected storylines:", storylineAttention.selected.map((entry) => entry.id));
    console.info("deferred storylines:", allDeferredStorylines.map((entry) => entry.id));
    console.groupEnd();
  }

  return {
    text,
    analysis: lastAnalysis,
  };
};
