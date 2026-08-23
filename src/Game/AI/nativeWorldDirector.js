import { buildCompactEconomicContext, isCompleteCountryStatSheet } from "../../runtime/countryStats.js";
import { buildBoundedDiplomaticContext } from "./nativeDiplomaticDirector.js";

// OpenHistoria Continuum — Native World Director v0.5.0
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

export const WORLD_DIRECTOR_VERSION = "0.6.0";

const DEFAULT_MAX_CANDIDATES = 10;
const RECENT_EVENT_WINDOW = 56;
const RECENT_CHAT_WINDOW = 16;
const CONSOLIDATED_HISTORY_WINDOW = 6;
const TERRITORIAL_SAMPLE_LIMIT = 8;
const ACTIVE_UNIT_SAMPLE_LIMIT = 6;
const MAX_ATTENTION_STORYLINES = 8;
const MAX_PERSISTED_STORYLINES = 96;
const MAX_ECONOMIC_ACTORS = 8;

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
    type: "recent-event",
    score,
    date: normalizeString(event?.date),
    title,
    detail: truncate(event?.description || event?.summary, 280),
    ageDays: days,
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

const pushTerritorialCandidates = (candidates, world) => {
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

const pushActiveUnitCandidates = (candidates, world) => {
  let added = 0;
  for (const unit of normalizeArray(world?.units)) {
    if (added >= ACTIVE_UNIT_SAMPLE_LIMIT) break;

    const status = normalizeString(unit?.status).toLowerCase();
    if (!status || status === "idle") continue;

    const owner = normalizeString(unit?.ownerCode || unit?.owner);
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

const storylineAttentionScore = (storyline, originDate, targetDate) => {
  if (!storyline || storyline.status === "resolved") return -Infinity;

  let score = storyline.status === "active" ? 8 : 1;
  score += storyline.pressure / 10;
  score += storyline.momentum / 8;

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

  return score;
};

const storylineNeedsAttentionWithin = (storyline, originDate, targetDate) => {
  if (!storyline || storyline.status === "resolved") return false;
  if (!storyline.nextReviewDate) return storyline.status === "active";
  if (parseIsoDate(storyline.nextReviewDate) == null || parseIsoDate(targetDate) == null) {
    return storyline.status === "active";
  }

  // Urgency is already encoded into nextReviewDate when updates are persisted.
  // Respect that date here so a high-pressure but frozen process does not get
  // re-reviewed on every one-day jump.
  return storyline.nextReviewDate <= targetDate;
};

const selectStorylineAttention = (world, originDate, targetDate) => {
  const normalized = normalizeArray(world?.storylines)
    .map(normalizeStorylineForDirector)
    .filter(Boolean)
    .slice(0, MAX_PERSISTED_STORYLINES);

  const ranked = normalized
    .filter((entry) => storylineNeedsAttentionWithin(entry, originDate, targetDate))
    .map((entry) => ({
      ...entry,
      attentionScore: Math.round(storylineAttentionScore(entry, originDate, targetDate) * 10) / 10,
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

  return { all: normalized, ranked, selected };
};

const recommendedReviewDays = (pressure, momentum, status) => {
  if (status === "resolved") return 0;
  const urgency = Math.max(clampPercent(pressure), clampPercent(momentum));
  if (urgency >= 85) return 14;
  if (urgency >= 70) return 30;
  if (urgency >= 50) return 60;
  if (urgency >= 30) return 120;
  return 240;
};

const clampNextReviewDate = ({ stopDate, pressure, momentum, status, requested }) => {
  if (status === "resolved") return "";
  if (parseIsoDate(stopDate) == null) return normalizeString(requested);
  const latestAllowed = addIsoDays(stopDate, recommendedReviewDays(pressure, momentum, status));
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

  const eventIndexes = eventIndexesRaw
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
    state: normalizeString(stateRaw),
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

export const validateWorldStorylinePayload = (
  candidate,
  {
    existingStorylines = [],
    selectedStorylines = [],
    originDate = "",
    stopDate = "",
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
    if (!storylineNeedsAttentionWithin(selected, originDate, stopDate)) continue;
    const id = normalizeString(selected?.id);
    if (!id) continue;
    const update = updateById.get(id);
    if (!update) {
      return `$.storylineUpdates must include native-attention storyline ${id} (${normalizeString(selected?.title) || "untitled"}) with its semantic state through ${stopDate}.`;
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
  const existing = normalizeArray(world?.storylines)
    .map(normalizeStorylineForDirector)
    .filter(Boolean);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));

  const linkedEvents = new Map();
  for (const event of normalizeArray(events)) {
    for (const id of normalizeArray(event?.storylineIds).map(normalizeString).filter(Boolean)) {
      if (!linkedEvents.has(id)) linkedEvents.set(id, []);
      linkedEvents.get(id).push(event);
    }
  }

  const decodedUpdates = decodeWorldStorylineUpdates(updates);
  const appliedIds = [];

  for (let index = 0; index < decodedUpdates.length; index += 1) {
    const raw = decodedUpdates[index];
    const id = normalizeString(raw?.id);
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

    const next = normalizeStorylineForDirector({
      ...prior,
      id,
      kind,
      title,
      participants: participants.length ? participants : normalizeArray(prior?.participants),
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

  const statusRank = { active: 0, dormant: 1, resolved: 2 };
  const storylines = [...byId.values()]
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

const buildEconomicAttentionContext = (bundle, storylineAttention) => {
  const world = bundle?.world || {};
  const requested = [
    normalizeString(bundle?.game?.country),
    ...normalizeArray(storylineAttention?.selected)
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map(normalizeString),
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

const installDebugApi = () => {
  if (typeof globalThis === "undefined") return;

  globalThis.__OH_NATIVE_WORLD_DIRECTOR__ = {
    version: WORLD_DIRECTOR_VERSION,
    last: () => lastAnalysis
      ? JSON.parse(JSON.stringify(lastAnalysis))
      : null,
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
  const storylineAttention = selectStorylineAttention(bundle?.world || {}, originDate, horizonDate);
  const economicAttention = buildEconomicAttentionContext(bundle, storylineAttention);
  const diplomaticAttention = buildBoundedDiplomaticContext(bundle?.world || {}, {
    playerPolity: normalizeString(bundle?.game?.country),
    selectedStorylines: storylineAttention.selected,
    maxActors: 8,
  });

  const recentEvents = normalizeArray(bundle?.events).slice(-RECENT_EVENT_WINDOW);
  recentEvents.forEach((event, index) => {
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
  consolidated.forEach((entry, index) => {
    const candidate = consolidatedCandidate(entry, index);
    if (candidate) candidates.push(candidate);
  });

  pushTerritorialCandidates(candidates, bundle?.world || {});
  pushActiveUnitCandidates(candidates, bundle?.world || {});

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

  const bounded = deduped.slice(
    0,
    Math.max(1, Math.min(20, Number(maxCandidates) || DEFAULT_MAX_CANDIDATES)),
  );

  const lines = bounded.map((candidate, index) => {
    const meta = [
      candidate.type,
      candidate.date ? candidate.date : "",
      `priority ${candidate.score}`,
    ].filter(Boolean).join(" | ");

    return `${index + 1}. [${meta}] ${candidate.title}` +
      (candidate.detail ? `\n   Current causal basis: ${candidate.detail}` : "");
  });

  const attentionLines = storylineAttention.selected.map((storyline, index) => {
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
    ].filter(Boolean).join("\n   ");

    return `${index + 1}. [${meta}] ${storyline.title}${detail ? `\n   ${detail}` : ""}`;
  });

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
    "WORLD ATTENTION FAIRNESS",
    "Selected storylines are priorities, NOT ownership of the whole world. A dominant war or crisis may receive more attention, but it must not erase unrelated diplomacy, domestic politics, economic developments, military modernization, regional tensions, or genuinely new initiatives elsewhere.",
    "After accounting for urgent continuity, inspect the independent causal evidence and structural background for other worthwhile developments. Do not invent filler to satisfy diversity; simply do not treat the hottest storyline as the only thing capable of happening.",
    "New autonomous processes may begin in any pass when current interests, structures, and capabilities justify them.",
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
      : "No attention-selected actor currently has a canonical economic Stats baseline.",
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
    "The explicit ledger is only one source of initiative. Structural conditions that have not recently produced a visible event still exist: alliances, rivalries, nationalism, ideology, domestic instability, leadership, military doctrine, economic pressure, colonial competition, social movements, and similar background causes.",
    "Real historical developments AFTER the origin date may be considered as CANDIDATES when their causal prerequisites remain substantially intact in THIS campaign and no simulated divergence has invalidated them.",
    "A historical candidate is never an appointment. Historical timing must be CAUSALLY RE-EARNED: an exact historical date may survive only when the current campaign still preserves the scheduling mechanism that would put the event on that date (for example an already-planned visit, fixed election, treaty deadline, or other independently scheduled process). A date known only from memorized future chronology is not a cause.",
    "After any major shock, assassination, declaration, collapse, election, coup, mobilization, treaty, or other branch-changing development, downstream history is reset to possibilities. Recalculate every actor's next choice from current commitments, support, risk, capability, and player authorization.",
    "If an actor still chooses the same course history recorded despite changed circumstances, that is allowed only when THIS campaign supplies an independent present-tense reason for the same choice.",
    "No explicit candidate does NOT mean history is suspended, and surviving historical conditions do NOT mean history is guaranteed.",
    "",
    "WORLD CONTINUITY CONTRACT",
    "Timeline events are only visible milestones. Persistent storylines are the authoritative hidden state of ongoing processes.",
    "For every scheduler-selected storyline, return a compact storylineUpdates record whose state describes what is true through THIS PASS stopDate. High momentum must produce real semantic evolution across multi-week passes; runtime stamps accounting/review dates.",
    "When a new event creates an unresolved multi-step process, create a compact storylineUpdates record and reference the relevant generated event number(s) inside that record. Runtime attaches storylineIds before persistence.",
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
    economicActors: economicAttention,
    diplomaticActors: diplomaticAttention.actors,
    diplomaticRelations: diplomaticAttention.relations,
    diplomaticAgreements: diplomaticAttention.agreements,
    scanned: {
      recentEvents: recentEvents.length,
      recentChats: recentChats.length,
      consolidatedHistory: consolidated.length,
      storylines: storylineAttention.all.length,
    },
    candidates: bounded,
    doctrine: {
      historicalEvents: "candidates-not-appointments",
      historicalTiming: "causally-re-earned",
      historicalConsequences: "branch-recomputed",
      unchangedHistoricalDateRequires: "surviving-scheduling-mechanism",
      playerSilence: "no-new-authorization",
      worldProcesses: "persistent-storylines-not-event-cards",
      storylineTransport: "compact-line-records",
      storylineBookkeeping: "runtime-owned",
      schedulerFairness: "diversity-aware-with-starvation-bonus",
      liveness: "high-momentum-must-evolve",
      scheduler: "bounded-native-attention",
      eventDensity: "state-dependent-no-global-quota",
    },
    generatedAt: new Date().toISOString(),
  };

  installDebugApi();

  console.info(
    `[OH Native World Director v${WORLD_DIRECTOR_VERSION}] ` +
    `${storylineAttention.selected.length}/${storylineAttention.all.length} storyline(s) selected, ` +
    `${bounded.length} causal candidate(s), ${economicAttention.length} economic actor baseline(s), ` +
    `${diplomaticAttention.relations.length} relation(s), ${diplomaticAttention.agreements.length} agreement(s), ` +
    `${recentEvents.length} recent event(s), ${recentChats.length} recent chat(s)`,
  );

  return {
    text,
    analysis: lastAnalysis,
  };
};
