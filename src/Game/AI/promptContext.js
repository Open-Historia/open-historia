import dayjs from "dayjs";
import { JSON_URLS, getNationTags, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { resolveAllCountryTags, resolveCountryTags } from "../../runtime/countryTags.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  buildActionDisplayText,
  isPolityLandless,
  normalizeActionEntry,
  normalizeActions,
  normalizeChats,
  normalizeEvents,
  normalizeWorldState,
} from "../../runtime/gameState.js";
import { buildRegionOwnershipText } from "./regionVocab.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const joinWithinCharBudget = (
  items,
  {
    maxChars = 0,
    separator = "\n",
    take = "tail",
    omissionMarker = "",
  } = {},
) => {
  const rows = normalizeArray(items)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  if (rows.length === 0) return "";

  const full = rows.join(separator);
  const budget = Math.max(0, Math.trunc(Number(maxChars) || 0));
  if (!budget || full.length <= budget) return full;

  const ordered = take === "head" ? rows : [...rows].reverse();
  const selected = [];
  let used = 0;

  for (const row of ordered) {
    const separatorChars = selected.length ? separator.length : 0;
    const next = separatorChars + row.length;

    // Never corrupt one canonical record merely to hit a transport target. If one
    // record is unusually large, keep that record whole and allow this soft budget
    // to exceed its target rather than cutting an event/chat/summary mid-thought.
    if (selected.length === 0 && next > budget) {
      selected.push(row);
      used = row.length;
      break;
    }
    if (used + next > budget) break;

    selected.push(row);
    used += next;
  }

  const kept = take === "head" ? selected : selected.reverse();
  const omitted = Math.max(0, rows.length - kept.length);
  if (omitted > 0 && omissionMarker) {
    if (take === "head") kept.push(omissionMarker.replace("${count}", String(omitted)));
    else kept.unshift(omissionMarker.replace("${count}", String(omitted)));
  }
  return kept.join(separator);
};

export const renderTemplate = (template, variables) =>
  String(template ?? "").replace(/\$\{([^}]+)\}/g, (_match, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });

export const resolveHelperValues = (helperTemplates, variables) => {
  let resolved = {};

  for (let pass = 0; pass < 2; pass += 1) {
    resolved = Object.fromEntries(
      Object.entries(helperTemplates).map(([key, template]) => [
        key,
        renderTemplate(template, { ...variables, ...resolved }),
      ]),
    );
  }

  return resolved;
};

export const getUnconsolidatedEvents = (events, world) => {
  const normalizedEvents = normalizeEvents(events);
  const history = normalizeWorldState(world).consolidatedHistory;
  const throughEventId = history.at(-1)?.throughEventId;
  if (!throughEventId) return normalizedEvents;

  const boundaryIndex = normalizedEvents.findIndex((event) => event.id === throughEventId);
  return boundaryIndex >= 0 ? normalizedEvents.slice(boundaryIndex + 1) : normalizedEvents;
};

export const buildEventHistoryText = (
  events,
  {
    limit = 10,
    maxChars = 0,
    world = null,
  } = {},
) => {
  const normalizedEvents = world ? getUnconsolidatedEvents(events, world) : normalizeEvents(events);
  if (normalizedEvents.length === 0) {
    return "No unconsolidated events have been recorded yet.";
  }

  const rendered = normalizedEvents
    .slice(-limit)
    .map((event) => {
      const date = normalizeString(event.date) || "undated";
      const description = normalizeString(event.description);
      const impactNotes = [];

      if (event.impacts.regionTransfers.length > 0) {
        impactNotes.push(
          `Territorial shifts: ${event.impacts.regionTransfers
            .map((entry) => `${entry.regionName || entry.regionId} -> ${entry.toCode}`)
            .join(", ")}`,
        );
      }

      if (event.impacts.polityChanges.length > 0) {
        impactNotes.push(
          `Polity changes: ${event.impacts.polityChanges
            .map((entry) => `${entry.code}${entry.name ? ` renamed to ${entry.name}` : ""}${entry.color ? ` color ${entry.color}` : ""}`)
            .join(", ")}`,
        );
      }

      return [
        `- ${date}: ${event.title}`,
        description ? `  ${description}` : "",
        impactNotes.length > 0 ? `  ${impactNotes.join(" | ")}` : "",
      ].filter(Boolean).join("\n");
    });

  return joinWithinCharBudget(rendered, {
    maxChars,
    separator: "\n",
    take: "tail",
    omissionMarker: "- [${count} earlier event record(s) omitted from this task context; canonical save history is unchanged.]",
  });
};

const renderConsolidatedHistoryEntry = (entry) =>
  `Through ${entry.throughDate || "an earlier date"}: ${entry.summary}`;

const joinCoverageSelectedHistory = (rows, selectedIndexes) => {
  const indexes = [...selectedIndexes].sort((a, b) => a - b);
  const output = [];
  let priorIndex = -1;

  for (const index of indexes) {
    const omitted = index - priorIndex - 1;
    if (omitted > 0) {
      output.push(
        `[${omitted} consolidated-history block(s) omitted from this task context; `
        + "their canonical source history remains in the save.]",
      );
    }
    output.push(rows[index]);
    priorIndex = index;
  }

  const trailingOmitted = rows.length - priorIndex - 1;
  if (trailingOmitted > 0) {
    output.push(
      `[${trailingOmitted} newer consolidated-history block(s) omitted from this task context; `
      + "their canonical source history remains in the save.]",
    );
  }

  return output.join("\n\n");
};

const joinConsolidatedCoverageWithinCharBudget = (rows, { maxChars = 0 } = {}) => {
  const normalizedRows = normalizeArray(rows)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  if (normalizedRows.length === 0) return "";

  const full = normalizedRows.join("\n\n");
  const budget = Math.max(0, Math.trunc(Number(maxChars) || 0));
  if (!budget || full.length <= budget) return full;

  // Phase 9.3B: older campaign memory should plateau without becoming a pure
  // "latest N summaries" window. Preserve the campaign foundation, preserve the
  // newest continuity most heavily, then use deterministic farthest-point sampling
  // across the middle so decades of history keep broad chronological coverage.
  // Whole summary blocks are always kept intact; this is a soft transport budget.
  const selected = new Set();
  let used = 0;
  const markerReserve = Math.min(2000, Math.max(512, Math.floor(budget * 0.08)));
  const rowBudget = Math.max(1, budget - markerReserve);

  const tryAdd = (index, { force = false } = {}) => {
    if (selected.has(index) || index < 0 || index >= normalizedRows.length) return false;
    const row = normalizedRows[index];
    const separatorChars = selected.size > 0 ? 2 : 0;
    const next = row.length + separatorChars;
    if (!force && selected.size > 0 && used + next > rowBudget) return false;
    selected.add(index);
    used += next;
    return true;
  };

  const recentTarget = Math.max(1, Math.floor(rowBudget * 0.60));
  const foundationTarget = Math.max(1, Math.floor(rowBudget * 0.15));

  let recentUsed = 0;
  for (let index = normalizedRows.length - 1; index >= 0 && recentUsed < recentTarget; index -= 1) {
    const before = used;
    if (tryAdd(index, { force: selected.size === 0 })) {
      recentUsed += used - before;
    }
  }

  let foundationUsed = 0;
  for (let index = 0; index < normalizedRows.length && foundationUsed < foundationTarget; index += 1) {
    const row = normalizedRows[index];
    const separatorChars = selected.size > 0 ? 2 : 0;
    const next = row.length + separatorChars;
    if (foundationUsed > 0 && foundationUsed + next > foundationTarget) break;

    const before = used;
    if (tryAdd(index)) {
      foundationUsed += used - before;
    }
  }

  const fitCandidates = () => normalizedRows
    .map((_row, index) => index)
    .filter((index) => {
      if (selected.has(index)) return false;
      const separatorChars = selected.size > 0 ? 2 : 0;
      return used + separatorChars + normalizedRows[index].length <= rowBudget;
    });

  // Repeatedly take the candidate furthest from anything already selected. This
  // creates even temporal coverage without semantic guessing, language assumptions,
  // or turning compressed summaries into a new source of truth.
  while (true) {
    const candidates = fitCandidates();
    if (candidates.length === 0) break;

    let bestIndex = -1;
    let bestDistance = -1;
    for (const index of candidates) {
      const distance = selected.size === 0
        ? normalizedRows.length
        : Math.min(...[...selected].map((selectedIndex) => Math.abs(index - selectedIndex)));
      if (distance > bestDistance || (distance === bestDistance && index > bestIndex)) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    if (bestIndex < 0 || !tryAdd(bestIndex)) break;
  }

  // If uneven block sizes leave a little capacity, spend it on the newest remaining
  // continuity first. That biases the final envelope toward what can still cause the
  // next turn while retaining the broad historical anchors selected above.
  for (let index = normalizedRows.length - 1; index >= 0; index -= 1) {
    tryAdd(index);
  }

  return joinCoverageSelectedHistory(normalizedRows, selected);
};

export const buildConsolidatedHistoryText = (
  world,
  {
    maxChars = 0,
    selection = "tail",
  } = {},
) => {
  const entries = normalizeWorldState(world).consolidatedHistory;
  if (entries.length === 0) return "No earlier campaign history has been consolidated yet.";

  const rendered = entries.map(renderConsolidatedHistoryEntry);
  if (selection === "coverage") {
    return joinConsolidatedCoverageWithinCharBudget(rendered, { maxChars });
  }

  return joinWithinCharBudget(rendered, {
    maxChars,
    separator: "\n\n",
    take: "tail",
    omissionMarker:
      "[${count} older consolidated-history block(s) omitted from this task context; "
      + "their canonical source history remains in the save.]",
  });
};

export const buildCampaignHistoryText = (
  events,
  world,
  {
    consolidatedMaxChars = 0,
    consolidatedSelection = "tail",
    eventMaxChars = 0,
    limit = 24,
  } = {},
) => [
  "STORY SO FAR:",
  buildConsolidatedHistoryText(world, {
    maxChars: consolidatedMaxChars,
    selection: consolidatedSelection,
  }),
  "",
  "RECENT EVENTS:",
  buildEventHistoryText(events, { limit, maxChars: eventMaxChars, world }),
].join("\n");


const compactHistoricalAnchorText = (value, maxChars = 260) => {
  const text = normalizeString(value).replace(/\s+/g, " ");
  const limit = Math.max(40, Math.trunc(Number(maxChars) || 260));
  if (text.length <= limit) return text;

  const preview = text.slice(0, limit + 1);
  const boundaries = [preview.lastIndexOf(". "), preview.lastIndexOf("; "), preview.lastIndexOf(", ")]
    .filter((index) => index >= Math.floor(limit * 0.6));
  const cutAt = boundaries.length > 0 ? Math.max(...boundaries) + 1 : limit;
  return `${text.slice(0, cutAt).trim()}…`;
};

const hasDurableStructuralEventImpact = (event) => {
  const lifecycleChange = normalizeArray(event?.impacts?.polityChanges)
    .some((change) => ["create", "restore", "rename", "dissolve"]
      .includes(normalizeString(change?.operation).toLowerCase()));
  if (lifecycleChange) return true;

  return normalizeArray(event?.impacts?.regionTransfers).some((transfer) => {
    const from = normalizeString(transfer?.fromCode).toLowerCase();
    const to = normalizeString(transfer?.toCode).toLowerCase();
    return Boolean(to && (!from || from !== to));
  });
};

const buildHistoricallyLinkedEventIds = (worldLike) => {
  const world = normalizeWorldState(worldLike);
  const ids = new Set();
  const addOrigin = (entry) => {
    const first = normalizeArray(entry?.sourceEventIds)
      .map(normalizeString)
      .find(Boolean);
    if (first) ids.add(first);
  };

  normalizeArray(world.storylines)
    .filter((entry) => ["active", "dormant"].includes(normalizeString(entry?.status).toLowerCase()))
    .forEach(addOrigin);
  normalizeArray(world.wars)
    .filter((entry) => ["active", "ceasefire"].includes(normalizeString(entry?.status).toLowerCase()))
    .forEach(addOrigin);
  normalizeArray(world.agreements)
    .filter((entry) => ["active", "suspended"].includes(normalizeString(entry?.status).toLowerCase()))
    .forEach(addOrigin);

  return ids;
};

const historicalAnchorCandidateScore = (event, linkedEventIds) => {
  const importance = normalizeString(event?.importance).toLowerCase();
  const id = normalizeString(event?.id);
  const linked = Boolean(id && linkedEventIds.has(id));
  const structural = hasDurableStructuralEventImpact(event);

  let score = importance === "critical" ? 1200 : importance === "major" ? 360 : 40;
  if (linked) score += 1000;
  if (structural) score += 520;
  if (event?.notable) score += 220;
  if (event?.playerRelated) score += 100;
  return { linked, structural, score };
};

const renderHistoricalAnchorEvent = (event) => {
  const date = normalizeString(event?.date) || "undated";
  const title = normalizeString(event?.title) || "Untitled historical event";
  const description = compactHistoricalAnchorText(event?.description, 260);
  return `- ${date}: ${title}${description ? ` — ${description}` : ""}`;
};

export const buildHistoricalAnchorText = (
  events,
  worldLike,
  {
    maxAnchors = 18,
    maxChars = 6000,
  } = {},
) => {
  const world = normalizeWorldState(worldLike);
  const history = normalizeArray(world.consolidatedHistory);
  const throughEventId = normalizeString(history.at(-1)?.throughEventId);
  if (!throughEventId) return "";

  const normalizedEvents = normalizeEvents(events);
  const boundaryIndex = normalizedEvents.findIndex((event) => normalizeString(event?.id) === throughEventId);
  if (boundaryIndex < 0) return "";

  const historicalEvents = normalizedEvents.slice(0, boundaryIndex + 1);
  if (historicalEvents.length === 0) return "";

  const linkedEventIds = buildHistoricallyLinkedEventIds(world);
  const candidates = historicalEvents
    .map((event, eventIndex) => {
      const assessment = historicalAnchorCandidateScore(event, linkedEventIds);
      const importance = normalizeString(event?.importance).toLowerCase();
      const eligible = assessment.linked || assessment.structural || importance === "critical" ||
        (importance === "major" && Boolean(event?.notable));
      if (!eligible) return null;
      return {
        event,
        eventIndex,
        row: renderHistoricalAnchorEvent(event),
        ...assessment,
        critical: importance === "critical",
      };
    })
    .filter(Boolean);
  if (candidates.length === 0) return "";

  const charBudget = Math.max(1, Math.trunc(Number(maxChars) || 6000));
  const anchorLimit = Math.max(1, Math.trunc(Number(maxAnchors) || 18));
  const selected = new Map();
  let used = 0;

  const tryAdd = (candidate, { force = false } = {}) => {
    if (!candidate || selected.has(candidate.eventIndex) || selected.size >= anchorLimit) return false;
    const separatorChars = selected.size > 0 ? 1 : 0;
    const next = candidate.row.length + separatorChars;
    if (!force && selected.size > 0 && used + next > charBudget) return false;
    selected.set(candidate.eventIndex, candidate);
    used += next;
    return true;
  };

  // First protect the rare events whose absence is most likely to make a long
  // campaign contradict itself: critical turning points and the origin events of
  // currently active storylines/wars/agreements. This is provenance-driven, not
  // keyword-driven, and current hard-state ledgers still outrank old event prose.
  const forcedLimit = Math.max(1, Math.ceil(anchorLimit * 0.5));
  const forced = candidates
    .filter((candidate) => candidate.critical || candidate.linked)
    .sort((a, b) =>
      (Number(b.critical) - Number(a.critical)) ||
      (Number(b.linked) - Number(a.linked)) ||
      (b.score - a.score) ||
      (b.eventIndex - a.eventIndex)
    );
  for (const candidate of forced) {
    if (selected.size >= forcedLimit) break;
    tryAdd(candidate, { force: selected.size === 0 });
  }

  // Spend the remaining slots across the entire consolidated era. Each bucket gets
  // its strongest canonical event, so a century-long campaign does not turn into
  // "the latest few years plus one founding paragraph". Structured lifecycle/map
  // changes naturally outrank routine narrative churn through the candidate score.
  const remainingSlots = Math.max(0, anchorLimit - selected.size);
  if (remainingSlots > 0) {
    const bucketCount = remainingSlots;
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = Math.floor((bucket * historicalEvents.length) / bucketCount);
      const end = Math.max(start + 1, Math.floor(((bucket + 1) * historicalEvents.length) / bucketCount));
      const bucketCandidates = candidates
        .filter((candidate) =>
          candidate.eventIndex >= start &&
          candidate.eventIndex < end &&
          !selected.has(candidate.eventIndex)
        )
        .sort((a, b) => (b.score - a.score) || (b.eventIndex - a.eventIndex));
      if (bucketCandidates.length > 0) tryAdd(bucketCandidates[0]);
    }
  }

  // Uneven event density / row length can leave budget behind. Use it on the
  // strongest remaining anchors, with newer events winning only exact score ties.
  const remaining = candidates
    .filter((candidate) => !selected.has(candidate.eventIndex))
    .sort((a, b) => (b.score - a.score) || (b.eventIndex - a.eventIndex));
  for (const candidate of remaining) {
    if (selected.size >= anchorLimit) break;
    tryAdd(candidate);
  }

  return [...selected.values()]
    .sort((a, b) => a.eventIndex - b.eventIndex)
    .map((candidate) => candidate.row)
    .join("\n");
};

const buildDiplomaticMessageLine = (message) => {
  const speaker = normalizeString(message?.speaker || message?.role || "message");
  const text = normalizeString(message?.text);
  const date = normalizeString(message?.time);
  const dateLabel = date ? formatDateReadable(date) : "";
  return `${dateLabel ? `[${dateLabel}] ` : ""}${speaker}: ${text}`;
};

const getLatestDiplomaticMemory = (chat) => {
  const messages = normalizeArray(chat?.messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const summary = normalizeString(messages[index]?.memorySummary);
    if (!summary) continue;
    return {
      summary,
      time: normalizeString(messages[index]?.time),
    };
  }
  return null;
};

const buildDiplomaticMemoryLine = (chat, { maxChars = 1400 } = {}) => {
  const memory = getLatestDiplomaticMemory(chat);
  if (!memory) return "";
  const dateLabel = memory.time ? formatDateReadable(memory.time) : "an earlier point";
  const summary = memory.summary.length > maxChars
    ? `${memory.summary.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
    : memory.summary;
  return `Durable diplomatic memory through ${dateLabel}: ${summary}`;
};

const diplomaticChatActivityKey = (chat) => {
  const messages = normalizeArray(chat?.messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const time = normalizeString(messages[index]?.time);
    if (time) return time;
  }
  return "";
};

const sortDiplomaticChatsByRecentActivity = (chats) =>
  normalizeChats(chats)
    .map((chat, index) => ({
      chat,
      index,
      activity: diplomaticChatActivityKey(chat),
      hasMemory: Boolean(getLatestDiplomaticMemory(chat)),
    }))
    .sort((left, right) => {
      const byActivity = right.activity.localeCompare(left.activity);
      if (byActivity !== 0) return byActivity;

      // On the same in-game date, prefer a thread that already carries durable
      // continuity memory. This keeps explicit agreements/commitments visible to
      // world-generation context instead of letting a routine note crowd them out.
      if (left.hasMemory !== right.hasMemory) {
        return left.hasMemory ? -1 : 1;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.chat);

const buildSingleChatHistoryText = (chat, { messageLimit = 10 } = {}) => {
  if (!chat) return "No chat history.";

  const memoryLine = buildDiplomaticMemoryLine(chat);
  const recentMessages = normalizeArray(chat.messages)
    .slice(-messageLimit)
    .map(buildDiplomaticMessageLine)
    .join("\n");

  return [
    memoryLine,
    recentMessages || "No messages yet.",
  ].filter(Boolean).join("\n");
};

export const buildChatSummaryText = (chats, { limit = 4 } = {}) => {
  const normalizedChats = sortDiplomaticChatsByRecentActivity(chats);
  if (normalizedChats.length === 0) return "No diplomatic chats are currently recorded.";

  return normalizedChats.slice(0, limit).map((chat) => {
    const participants = chat.countries.map((country) => country.name).join(", ");
    const lastMessage = chat.messages.at(-1);
    const memoryLine = buildDiplomaticMemoryLine(chat, { maxChars: 700 });
    return [
      `- ${participants}:`,
      memoryLine ? `  ${memoryLine}` : "",
      `  Latest: ${lastMessage ? buildDiplomaticMessageLine(lastMessage) : "no messages yet"}`,
    ].filter(Boolean).join("\n");
  }).join("\n");
};

export const buildDetailedChatHistoryText = (
  chats,
  {
    limit = 8,
    maxChars = 0,
    messageLimit = 10,
  } = {},
) => {
  const normalizedChats = sortDiplomaticChatsByRecentActivity(chats);
  if (normalizedChats.length === 0) return "No chats occurred in these rounds.";

  const rendered = normalizedChats.slice(0, limit).map((chat, index) => {
    const header = `Chat ${index + 1}: ${chat.countries.map((country) => country.name).join(", ")}`;
    return `${header}\n${buildSingleChatHistoryText(chat, { messageLimit })}`;
  });

  return joinWithinCharBudget(rendered, {
    maxChars,
    separator: "\n\n",
    take: "head",
    omissionMarker:
      "[${count} additional lower-priority diplomatic thread(s) omitted from this task context; "
      + "their canonical chat records remain in the save.]",
  });
};

// Compact diplomatic continuity ledger for the world simulator. Long-term meaning
// comes from rolling memory, while a tiny recent verbatim tail preserves exact
// actor attribution and modal force when summaries paraphrase too aggressively.
export const buildDiplomaticContinuityText = (
  chats,
  {
    limit = 12,
    maxCharsPerThread = 1000,
    evidenceMessageLimit = 4,
    maxEvidenceCharsPerThread = 1800,
    maxTotalChars = 12000,
  } = {},
) => {
  const rows = [];
  let usedChars = 0;

  for (const chat of sortDiplomaticChatsByRecentActivity(chats)) {
    const memory = getLatestDiplomaticMemory(chat);
    if (!memory?.summary) continue;

    const participants = normalizeArray(chat?.countries)
      .map((country) => normalizeString(country?.name || country?.code))
      .filter(Boolean)
      .join(", ") || "Unknown participants";
    const updated = memory.time ? formatDateReadable(memory.time) : "unknown date";
    const clippedSummary = memory.summary.length > maxCharsPerThread
      ? `${memory.summary.slice(0, Math.max(0, maxCharsPerThread - 1)).trimEnd()}…`
      : memory.summary;

    const recentEvidenceRaw = normalizeArray(chat?.messages)
      .filter((message) => ["user", "leader"].includes(normalizeString(message?.role)))
      .slice(-evidenceMessageLimit)
      .map(buildDiplomaticMessageLine)
      .join("\n");
    const recentEvidence = recentEvidenceRaw.length > maxEvidenceCharsPerThread
      ? `…${recentEvidenceRaw.slice(-Math.max(0, maxEvidenceCharsPerThread - 1)).trimStart()}`
      : recentEvidenceRaw;

    const row = [
      `Participants: ${participants}`,
      `Memory updated: ${updated}`,
      `Standing diplomatic memory: ${clippedSummary}`,
      recentEvidence
        ? `Recent verbatim diplomatic evidence (authoritative for exact wording and modality):\n${recentEvidence}`
        : "",
    ].filter(Boolean).join("\n");

    if (rows.length >= limit) break;
    if (usedChars + row.length > maxTotalChars && rows.length > 0) break;

    rows.push(row);
    usedChars += row.length;
  }

  return rows.length > 0
    ? rows.join("\n\n")
    : "No durable diplomatic commitments, positions, threats, or unresolved matters are currently recorded.";
};

export const buildAdvisorHistoryText = (messages, { limit = 18 } = {}) => {
  const normalizedMessages = normalizeArray(messages).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const role = normalizeString(entry.role || entry.speaker || "message");
    const text = normalizeString(entry.text || entry.content || entry.message);
    return role && text ? `${role}: ${text}` : null;
  }).filter(Boolean);

  return normalizedMessages.length > 0
    ? normalizedMessages.slice(-limit).join("\n")
    : "No advisor messages are currently recorded.";
};

// Resolved actions accumulate for the whole campaign, and every one of them used
// to be re-sent on every turn. On a long save that is the bulk of the prompt — a
// player measured 700k of their 803k characters as nothing but old resolved
// actions — and because this history is interpolated into the prompt more than
// once, it was pasted in repeatedly. Events were always capped (eventLimit /
// longEventLimit); actions simply never were. Matching longEventLimit here.
export const ACTION_HISTORY_LIMIT = 24;

export const buildActionHistoryText = (actions, { includeResolved = false, limit = ACTION_HISTORY_LIMIT } = {}) => {
  const normalizedActions = normalizeActions(actions);
  const renderAction = (action) => {
    const kindLabel = action.kind === "chat" ? "chat" : "action";
    const statusLabel = action.status !== "planned" ? ` [${action.status}]` : "";
    return `- (${kindLabel}) ${action.title}${statusLabel}: ${buildActionDisplayText(action)}`;
  };

  if (!includeResolved) {
    const planned = normalizedActions.filter((action) => action.status === "planned");
    if (planned.length === 0) return "No planned actions are currently queued.";
    return planned.map(renderAction).join("\n");
  }

  if (normalizedActions.length === 0) return "No actions have been recorded yet.";

  // Every PLANNED action survives — those are live orders the model must act on —
  // while only the most recent `limit` finished ones are quoted. The number of
  // dropped entries is stated so the model knows the campaign runs deeper than
  // the excerpt, rather than reading it as a short history.
  const past = normalizedActions.filter((action) => action.status !== "planned");
  const kept = new Set(limit > 0 ? past.slice(-limit) : []);
  const omitted = past.length - kept.size;
  const lines = normalizedActions
    .filter((action) => action.status === "planned" || kept.has(action))
    .map(renderAction);
  if (omitted > 0) {
    lines.unshift(`- (${omitted} earlier resolved action${omitted === 1 ? "" : "s"} omitted from this excerpt)`);
  }
  return lines.join("\n");
};

export const formatActionsForPrompt = (actions) => normalizeArray(actions)
  .map((entry) => {
    if (typeof entry === "string") return entry.trim();
    const normalized = normalizeActionEntry(entry);
    return normalized ? `- ${normalized.title}: ${buildActionDisplayText(normalized)}` : "";
  })
  .filter(Boolean)
  .join("\n");

export const formatDateReadable = (value) => {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMMM YYYY") : normalizeString(value);
};

export const buildDifficultyGuidance = (difficulty, mode = "general") => {
  const normalized = normalizeString(difficulty).toLowerCase().replace(/[\s_]+/g, "-");
  const intro = mode === "chats"
    ? "Diplomatic concessions and cooperation should scale with the difficulty."
    : "Long-term success and geopolitical leverage should scale with the difficulty.";

  switch (normalized) {
    case "very-easy": return `${intro} The player can turn even modest preparation into results, and setbacks should stay forgiving.`;
    case "easy": return `${intro} The player can convert reasonable preparation into results relatively easily.`;
    case "hard": return `${intro} The player should need stronger leverage, preparation, and credibility before major outcomes stick.`;
    case "very-hard":
    case "extreme": return `${intro} Major outcomes should require overwhelming preparation, sustained leverage, or unusually favorable conditions.`;
    case "impossible": return `${intro} Outcomes should almost never break the player's way without extraordinary, sustained, multi-front effort.`;
    default: return `${intro} Outcomes should feel plausible and earned without becoming static.`;
  }
};

export const buildRecentRoundsWithDates = (bundle) => {
  const history = normalizeArray(bundle.world?.simulationHistory);
  if (history.length === 0) return `Current round only: ${bundle.game.gameDate || "unknown date"}`;
  return history.slice(0, 8)
    .map((entry) => `${entry.fromDate || "unknown"} -> ${entry.toDate || entry.date || "unknown"}`)
    .join("; ");
};

export const buildUnitsSummaryText = (world) => {
  const units = normalizeArray(world?.units);
  if (units.length === 0) return "No military units are currently deployed on the map.";
  return units.slice(0, 60).map((unit) => {
    const lat = Number(unit.lat);
    const lng = Number(unit.lng);
    const coords = Number.isFinite(lat) && Number.isFinite(lng)
      ? `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}`
      : "unknown location";
    return `- ${unit.name} [id ${unit.id}] (${unit.type}, owner ${unit.ownerCode}, strength ${unit.strength}, status ${unit.status}) at ${coords}${unit.regionId ? `, region ${unit.regionId}` : ""}`;
  }).join("\n");
};

// Structures founded during play (world.markers): cities, military bases,
// bunkers, missile silos, embassies. Listed with coordinates so the model can
// reference, defend, target, or expand them — and knows their names are taken.
export const buildMarkersSummaryText = (world) => {
  const markers = normalizeArray(world?.markers);
  if (markers.length === 0) return "No structures have been built during play yet.";
  return markers.slice(0, 60).map((marker) => {
    const lat = Number(marker.lat);
    const lng = Number(marker.lng);
    const coords = Number.isFinite(lat) && Number.isFinite(lng)
      ? `lat ${lat.toFixed(2)}, lng ${lng.toFixed(2)}`
      : "unknown location";
    return `- ${marker.name} [id ${marker.id}] (${marker.kind}${marker.ownerCode ? `, owner ${marker.ownerCode}` : ""}) at ${coords}${marker.note ? ` — ${marker.note}` : ""}`;
  }).join("\n");
};

// City coordinates for the model, so troop deployments and events land on the
// actual city instead of a guess. Two sources, mirroring the map's own layer:
// custom-city scenarios use their era set; everything else uses the significant
// slice of the stock database (capitals + metropolises). Only the stock slice is
// cached — it's a static asset, while the custom set changes with the scenario.
const CITY_CATALOG_LIMIT = 200;
let _stockCityCatalogCache = null;

// Same resolution the editor's city importer uses: the seed rides the content
// node on web builds and same-origin /assets locally.
const CITY_SEED_URL = `${(import.meta.env.VITE_OH_PMTILES_URL || "/assets").replace(/\/$/, "")}/cities-seed.json`;

const formatCityLine = (name, country, lat, lng, extra = "") =>
  `- ${name}${country ? ` (${country})` : ""}: lat ${Number(lat).toFixed(2)}, lng ${Number(lng).toFixed(2)}${extra}`;

export const buildCityCatalogText = async (world) => {
  try {
    if (world?.customCities) {
      const geojson = await readJson(JSON_URLS.citiesGeojson, { defaultValue: null, force: true });
      const features = normalizeArray(geojson?.features)
        .filter((feature) => Array.isArray(feature?.geometry?.coordinates))
        .sort((a, b) =>
          (b.properties?.tier ?? 0) - (a.properties?.tier ?? 0)
          || (b.properties?.population ?? 0) - (a.properties?.population ?? 0))
        .slice(0, CITY_CATALOG_LIMIT);
      if (features.length) {
        return features.map((feature) => {
          const props = feature.properties ?? {};
          const [lng, lat] = feature.geometry.coordinates;
          return formatCityLine(props.city || props.name || "Unnamed", "", lat, lng, props.capital === "primary" ? " (capital)" : "");
        }).join("\n");
      }
      return "No city coordinate catalog is available.";
    }

    if (_stockCityCatalogCache) return _stockCityCatalogCache;
    const response = await fetch(CITY_SEED_URL);
    const seed = response.ok ? await response.json() : [];
    const significant = normalizeArray(seed)
      .filter((city) => Array.isArray(city?.coord)
        && (city.capital === "primary" || (city.population ?? 0) >= 2000000))
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
      .slice(0, CITY_CATALOG_LIMIT);
    if (significant.length) {
      _stockCityCatalogCache = significant.map((city) =>
        formatCityLine(city.name, city.country, city.coord[1], city.coord[0], city.capital === "primary" ? " (capital)" : ""),
      ).join("\n");
      return _stockCityCatalogCache;
    }
    return "No city coordinate catalog is available.";
  } catch {
    // A missing catalog degrades to the old behavior (model guesses), never breaks a jump.
    return "No city coordinate catalog is available.";
  }
};

const loadRegions = async () => loadRegionCatalog().catch(() => []);

// The land the player's polity holds — or an explicit statement that it holds none.
// A landless player is a deliberate scenario, not missing data (a government in
// exile, a stateless movement leading a campaign to take a nation back), so it must
// read to the model as an intentional condition rather than an empty field, or the
// model tries to run a normal territorial power and invents holdings.
const LANDLESS_PLAYER_TEXT =
  "This polity is LANDLESS — it currently holds no territory. It is a stateless "
  + "actor (a government-in-exile, a movement, or a power that has lost its land), "
  + "and its story is about influence, alliances, insurgency, and the fight to gain "
  + "or retake territory — not about administering provinces it does not have.";

export const buildPlayerPolityRegionsText = async (bundle, regionCatalog = null) => {
  const playerCode = normalizeString(bundle.game.country);
  if (!playerCode) return "No player polity is currently set.";
  const world = normalizeWorldState(bundle.world);
  const entries = Object.entries(world.regionOwnershipOverrides);
  const owns = entries.some(([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === playerCode.toLowerCase());
  // Zero regions AND the polity exists = deliberately landless. Distinguish that
  // from a scenario that simply ships no override list (a stock modern map, where
  // the player owns their country through the base tiles, not an override).
  // isPolityLandless is the shared source of truth for that line (see gameState).
  if (!owns) {
    return isPolityLandless(world, playerCode)
      ? LANDLESS_PLAYER_TEXT
      : "No explicit player region override list is currently recorded.";
  }
  const regions = regionCatalog ?? await loadRegions();
  const lookup = new Map(regions.map((region) => [region.id, region]));
  const names = entries
    .filter(([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === playerCode.toLowerCase())
    .slice(0, 24)
    .map(([regionId]) => lookup.get(regionId)?.name || regionId);
  return names.join(", ");
};

export const buildWorldSummary = async (bundle, regionCatalog = null) => {
  const world = normalizeWorldState(bundle.world);
  const regions = regionCatalog ?? await loadRegions();
  const regionLookup = new Map(regions.map((region) => [region.id, region]));
  const territoryEntries = Object.entries(world.regionOwnershipOverrides);
  const territorySummary = territoryEntries.length === 0
    ? "No territorial overrides from the base scenario are currently recorded."
    : territoryEntries.slice(0, 60).map(([regionId, ownerCode]) => {
      const region = regionLookup.get(regionId);
      return `- ${region?.name || regionId}${region?.country ? ` (${region.country})` : ""} -> ${ownerCode}`;
    }).join("\n");
  const polities = Object.values(world.polityOverrides);
  const politySummary = polities.length === 0
    ? "No dynamic polity overrides are currently recorded."
    : polities.slice(0, 16).map((entry) =>
      // `note` is the polity's lore — the author's (or the faction creator's) own
      // description of who this power is. It was persisted but never reached the
      // model, so a player-written backstory did nothing. It steers the story now.
      `- ${entry.code}: ${entry.name || entry.code}${entry.color ? ` (${entry.color})` : ""}${entry.aliases.length > 0 ? ` aliases ${entry.aliases.join(", ")}` : ""}${entry.note ? ` — ${entry.note}` : ""}`,
    ).join("\n");

  // What each country IS: the map-maker's tags with the AI's own changes layered
  // over them. This is the whole reason tags exist — the model reads it for every
  // task, so "socialist, anti-nato" steers what the Soviet Union plausibly does
  // without any rule saying so. Capped at 40 countries for prompt budget; drop
  // whole countries rather than truncate one list, since "- SOV: socialist," reads
  // as corrupt data to the model.
  const baseTags = await getNationTags().catch(() => ({}));
  const tagged = resolveAllCountryTags(baseTags, world);
  const taggedCodes = Object.keys(tagged);
  const tagSummary = taggedCodes.length === 0
    ? "No countries have defining tags."
    : taggedCodes.slice(0, 40).map((code) => `- ${code}: ${tagged[code].join(", ")}`).join("\n")
      + (taggedCodes.length > 40 ? `\n(+${taggedCodes.length - 40} more tagged countries not listed)` : "");
  const playerTags = resolveCountryTags(baseTags, world, bundle.game.country);

  // The region vocabulary the jump prompt promises ("every ... region ... separated
  // by a comma ... ANALYZE THIS INCREDIBLY CAREFULLY"). Until now nothing filled it,
  // so on a stock map the model saw ZERO region names and invented ones that then
  // failed resolveRegionTransfers and got silently dropped — a narrated capture that
  // never moved the map. buildRegionOwnershipText is TIERED so we hand names where
  // they are needed without dumping all ~3000 provinces every jump: FULL `name (id)`
  // lists only for the powers IN PLAY (the "focus" set below), and codes-only for
  // everyone else (the model names their regions on demand and the retry resolves
  // them). Focus = the player, anyone already re-owned, scenario-defined actors, and
  // the player's active chat partners — the likely belligerents.
  // Every focus token is a FULL COUNTRY NAME, because that is what the vocabulary is
  // keyed by (regionOwnerName). A legacy override still holding "ESP" is canonicalised
  // so it matches "Spain" — otherwise that power silently drops out of the enumerated
  // section and the model is left inventing its region names again.
  const playerName = toCountryName(normalizeString(bundle.game.country));
  const overrideOwnerNames = [...new Set(
    territoryEntries.map(([, owner]) => toCountryName(normalizeString(owner))).filter(Boolean),
  )];
  const actorNames = polities.map((entry) => toCountryName(normalizeString(entry?.code))).filter(Boolean);
  const chatNames = normalizeArray(bundle.chats).flatMap((chat) =>
    normalizeArray(chat?.countries).map((country) => toCountryName(normalizeString(country?.code))).filter(Boolean));
  const focusCodes = [playerName, ...overrideOwnerNames, ...actorNames, ...chatNames].filter(Boolean);
  // Owner name -> display name for both sections: base country names from the catalog,
  // with dynamic polity overrides layered on top (a re-owned/renamed power wins).
  const polityNames = {};
  for (const region of regions) {
    const name = String(region.country || toCountryName(region.countryCode) || "").toLowerCase();
    if (name && !polityNames[name]) polityNames[name] = region.country || toCountryName(region.countryCode);
  }
  for (const entry of polities) {
    if (entry?.code) polityNames[toCountryName(String(entry.code)).toLowerCase()] = entry.name || toCountryName(entry.code);
  }
  const regionOwnershipCatalog = buildRegionOwnershipText(regions, world.regionOwnershipOverrides, {
    focusCodes,
    polityNames,
  });

  return [
    `Player polity: ${bundle.game.country || "Unknown polity"}${playerTags.length ? ` (${playerTags.join(", ")})` : ""}`,
    `Current round: ${bundle.game.round || 1}`,
    `Current date: ${bundle.game.gameDate || "unknown"}`,
    `Language: ${world.language || bundle.game.language || "English"}`,
    `Difficulty: ${bundle.game.difficulty || "standard"}`,
    `World before round one: ${world.startingTimelineText || "No world briefing provided."}`,
    `Simulation rules: ${world.simulationRules || "No extra simulation rules were provided."}`,
    "",
    "Territorial changes from the base scenario:",
    territorySummary,
    "",
    "Map ownership (this IS the comma-separated region list referenced above — the "
      + "region vocabulary for regionTransfers):",
    regionOwnershipCatalog,
    "",
    "Dynamic polity overrides:",
    politySummary,
    "",
    "What each country is (ideology, alignment, posture). Treat these as binding "
      + "characterisation: act, speak and react in keeping with them, and only change "
      + "them via polityChanges when events genuinely reshape a country.",
    tagSummary,
    "",
    world.activeCatalyst
      ? `Active catalyst: ${world.activeCatalyst.title || "untitled"} - ${world.activeCatalyst.premise || world.activeCatalyst.opening || ""}`
      : "No active catalyst scene.",
  ].join("\n");
};

export const buildPromptContext = async (bundle, {
  actionInput = "",
  advisorLimit = 18,
  catalystChoice = "",
  catalystHistory = "",
  catalystOpening = "",
  catalystPremise = "",
  chat = null,
  chatHistoryLongMaxChars = 0,
  chatLimit = 8,
  chatsToConsolidate = "",
  consolidatedHistoryMaxChars = 0,
  consolidatedHistorySelection = "tail",
  historicalAnchorActivationChars = 0,
  historicalAnchorMaxChars = 0,
  historicalAnchorMaxItems = 18,
  eventHistoryMaxChars = 0,
  eventLimit = 10,
  eventsToConsolidate = "",
  gameMasterRequest = "",
  longEventHistoryMaxChars = 0,
  longEventLimit = 24,
  respondingPolityName = "",
  targetDate = "",
} = {}) => {
  const normalizedChat = chat && typeof chat === "object" ? normalizeChats([chat])[0] : null;
  const regionCatalog = await loadRegions();
  const date = bundle.game.gameDate || "";
  const target = targetDate || date;
  const worldSummary = await buildWorldSummary(bundle, regionCatalog);
  const citiesSummary = await buildCityCatalogText(bundle.world);
  const recentEvents = buildEventHistoryText(bundle.events, {
    limit: eventLimit,
    maxChars: eventHistoryMaxChars,
    world: bundle.world,
  });
  const fullConsolidatedHistory = buildConsolidatedHistoryText(bundle.world);
  const historicalAnchorThreshold = Math.max(0, Math.trunc(Number(historicalAnchorActivationChars) || 0));
  const historicalAnchorBudget = Math.max(0, Math.trunc(Number(historicalAnchorMaxChars) || 0));
  const historicalAnchorThresholdReached = Boolean(
    historicalAnchorThreshold &&
    historicalAnchorBudget &&
    fullConsolidatedHistory.length > historicalAnchorThreshold
  );
  const candidateHistoricalAnchors = historicalAnchorThresholdReached
    ? buildHistoricalAnchorText(bundle.events, bundle.world, {
        maxAnchors: historicalAnchorMaxItems,
        maxChars: historicalAnchorBudget,
      })
    : "";
  // Do not reserve space for an anchor tier that could not be built (for example,
  // an older imported save whose consolidation boundary id cannot be resolved). In
  // that compatibility case, keep the full 24k summary allowance instead of silently
  // throwing away 6k of useful history.
  const historicalAttentionActive = Boolean(candidateHistoricalAnchors);
  const effectiveConsolidatedHistoryMaxChars = historicalAttentionActive && consolidatedHistoryMaxChars
    ? Math.max(1, Math.max(0, Math.trunc(Number(consolidatedHistoryMaxChars) || 0)) - historicalAnchorBudget)
    : consolidatedHistoryMaxChars;
  const consolidatedHistory = effectiveConsolidatedHistoryMaxChars
    ? buildConsolidatedHistoryText(bundle.world, {
        maxChars: effectiveConsolidatedHistoryMaxChars,
        selection: consolidatedHistorySelection,
      })
    : fullConsolidatedHistory;
  const historicalAnchors = historicalAttentionActive ? candidateHistoricalAnchors : "";
  const campaignRecentEvents = buildEventHistoryText(bundle.events, {
    limit: longEventLimit,
    maxChars: longEventHistoryMaxChars,
    world: bundle.world,
  });
  const campaignHistory = [
    "STORY SO FAR:",
    consolidatedHistory,
    ...(historicalAnchors
      ? [
          "",
          "PERMANENT HISTORICAL ANCHORS:",
          "Selected directly from older canonical event records to preserve major divergences and origins across long campaigns. Current hard-state ledgers and newer canon override any superseded old wording.",
          historicalAnchors,
        ]
      : []),
    "",
    "RECENT EVENTS:",
    campaignRecentEvents,
  ].join("\n");
  const allActions = buildActionHistoryText(bundle.actions, { includeResolved: true });
  const actionText = formatActionsForPrompt(bundle.actions);
  const consolidatedChatIds = new Set(
    normalizeWorldState(bundle.world).consolidatedHistory.flatMap((entry) => entry.chatIds),
  );
  const unconsolidatedChats = normalizeChats(bundle.chats)
    .filter((entry) => !consolidatedChatIds.has(entry.id));
  const promptChats = sortDiplomaticChatsByRecentActivity(unconsolidatedChats);
  const currentChat = normalizedChat ?? promptChats[0] ?? null;

  return {
    actionInput,
    actions: actionText,
    advisorMessages: buildAdvisorHistoryText(bundle.advisor || [], { limit: advisorLimit }),
    allActions,
    catalystChoice,
    catalystDate: date,
    catalystHistory,
    catalystOpening,
    catalystPercent: normalizeArray(bundle.world?.activeCatalyst?.history).length > 0
      ? `${Math.min(100, normalizeArray(bundle.world.activeCatalyst.history).length * 50)}%`
      : "0%",
    catalystPremise,
    citiesSummary,
    chat: JSON.stringify(promptChats),
    chatHistory: currentChat
      ? buildSingleChatHistoryText(currentChat, { messageLimit: 18 })
      : "No chat history.",
    chatHistoryLong: buildDetailedChatHistoryText(promptChats, { limit: chatLimit, maxChars: chatHistoryLongMaxChars }),
    chatParticipants: currentChat?.countries?.map((country) => country.name).join(", ") || "",
    chatSummary: buildChatSummaryText(promptChats),
    diplomaticContinuity: buildDiplomaticContinuityText(promptChats),
    chatsToConsolidate: chatsToConsolidate || buildDetailedChatHistoryText(promptChats, { limit: 12, messageLimit: 50 }),
    consolidatedHistory,
    date,
    dateReadable: formatDateReadable(date),
    difficulty: bundle.game.difficulty || "standard",
    difficultyGuidanceChats: buildDifficultyGuidance(bundle.game.difficulty, "chats"),
    difficultyGuidanceJumpForward: buildDifficultyGuidance(bundle.game.difficulty, "jump"),
    eventsToConsolidate: eventsToConsolidate || buildEventHistoryText(bundle.events, { limit: 12 }),
    gameMasterRequest,
    historicalAnchors,
    historicalAttentionStatus: historicalAttentionActive
      ? `active: ${effectiveConsolidatedHistoryMaxChars || 0} consolidated chars + up to ${historicalAnchorBudget} canonical-anchor chars`
      : historicalAnchorThresholdReached
        ? `fallback: long history detected (${fullConsolidatedHistory.length} chars) but no canonical anchor set was resolvable; retaining ${consolidatedHistoryMaxChars || 0}-char summary allowance`
        : `inactive: full consolidated history ${fullConsolidatedHistory.length} chars${historicalAnchorThreshold ? ` <= ${historicalAnchorThreshold} activation chars` : ""}`,
    language: bundle.world.language || bundle.game.language || "English",
    lastSpeaker: currentChat?.messages?.at(-1)?.speaker || "",
    markersSummary: buildMarkersSummaryText(bundle.world),
    numberOfRegions: String(regionCatalog.length),
    plannedActions: buildActionHistoryText(bundle.actions),
    playerBattalionSummaries: buildUnitsSummaryText(bundle.world),
    playerPolity: bundle.game.country || "Unknown polity",
    playerPolityRegions: await buildPlayerPolityRegionsText(bundle, regionCatalog),
    recentEvents,
    recentEventsLong: campaignHistory,
    recentRoundsWithDates: buildRecentRoundsWithDates(bundle),
    respondingPolityName: respondingPolityName || currentChat?.countries.find((country) => country.name !== bundle.game.country)?.name || "",
    round: String(bundle.game.round || 1),
    simulationRules: normalizeString(bundle.world.simulationRules) || "No extra simulation rules were provided.",
    startDate: bundle.game.startDate || "",
    targetDate: target,
    targetDateReadable: formatDateReadable(target),
    unitsSummary: buildUnitsSummaryText(bundle.world),
    worldBeforeRoundOne: normalizeString(bundle.world.startingTimelineText) || "No pre-game world briefing was provided.",
    // Compatibility alias for older/frozen prompt packs that referenced the pre-game
    // briefing by its former variable name. Keep both names pointed at the same
    // canonical save field so legacy campaigns do not silently lose their starting lore.
    worldBeforeRoundOneText: normalizeString(bundle.world.startingTimelineText) || "No pre-game world briefing was provided.",
    worldSummary,
    worldSummaryNoCity: worldSummary,
  };
};
