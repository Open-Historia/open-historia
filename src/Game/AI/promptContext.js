import dayjs from "dayjs";
import { loadRegionCatalog } from "../../runtime/assets.js";
import { getActiveRegionCatalog } from "./regionOwnershipValidation.js";
import {
  buildActionDisplayText,
  normalizeActionEntry,
  normalizeActions,
  normalizeChats,
  normalizeEvents,
  normalizeWorldState,
} from "../../runtime/gameState.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

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

export const buildEventHistoryText = (events, { limit = 10, world = null } = {}) => {
  const normalizedEvents = world ? getUnconsolidatedEvents(events, world) : normalizeEvents(events);
  if (normalizedEvents.length === 0) {
    return "No unconsolidated events have been recorded yet.";
  }

  return normalizedEvents
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
    })
    .join("\n");
};

export const buildConsolidatedHistoryText = (world) => {
  const entries = normalizeWorldState(world).consolidatedHistory;
  if (entries.length === 0) return "No earlier campaign history has been consolidated yet.";

  return entries
    .map((entry) => `Through ${entry.throughDate || "an earlier date"}: ${entry.summary}`)
    .join("\n\n");
};

export const buildCampaignHistoryText = (events, world, { limit = 24 } = {}) => [
  "STORY SO FAR:",
  buildConsolidatedHistoryText(world),
  "",
  "RECENT EVENTS:",
  buildEventHistoryText(events, { limit, world }),
].join("\n");

export const buildChatSummaryText = (chats, { limit = 4 } = {}) => {
  const normalizedChats = normalizeChats(chats);
  if (normalizedChats.length === 0) return "No diplomatic chats are currently recorded.";

  return normalizedChats.slice(0, limit).map((chat) => {
    const participants = chat.countries.map((country) => country.name).join(", ");
    const lastMessage = chat.messages.at(-1);
    return `- ${participants}: ${lastMessage ? `${lastMessage.speaker || lastMessage.role}: ${lastMessage.text}` : "no messages yet"}`;
  }).join("\n");
};

export const buildDetailedChatHistoryText = (chats, { limit = 8, messageLimit = 10 } = {}) => {
  const normalizedChats = normalizeChats(chats);
  if (normalizedChats.length === 0) return "No chats occurred in these rounds.";

  return normalizedChats.slice(0, limit).map((chat, index) => {
    const header = `Chat ${index + 1}: ${chat.countries.map((country) => country.name).join(", ")}`;
    const body = chat.messages.length > 0
      ? chat.messages.slice(-messageLimit).map((message) => `${message.speaker || message.role}: ${message.text}`).join("\n")
      : "No messages yet.";
    return `${header}\n${body}`;
  }).join("\n\n");
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

export const buildActionHistoryText = (actions, { includeResolved = false } = {}) => {
  const normalizedActions = normalizeActions(actions);
  const filteredActions = includeResolved
    ? normalizedActions
    : normalizedActions.filter((action) => action.status === "planned");
  if (filteredActions.length === 0) {
    return includeResolved ? "No actions have been recorded yet." : "No planned actions are currently queued.";
  }

  return filteredActions.map((action) => {
    const kindLabel = action.kind === "chat" ? "chat" : "action";
    const statusLabel = action.status !== "planned" ? ` [${action.status}]` : "";
    return `- (${kindLabel}) ${action.title}${statusLabel}: ${buildActionDisplayText(action)}`;
  }).join("\n");
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

const loadRegions = async () => loadRegionCatalog().catch(() => []);

export const buildPlayerPolityRegionsText = async (bundle, regionCatalog = null) => {
  const playerCode = normalizeString(bundle.game.country);
  if (!playerCode) return "No player polity is currently set.";
  const entries = Object.entries(normalizeWorldState(bundle.world).regionOwnershipOverrides);
  if (entries.length === 0) return "No explicit player region override list is currently recorded.";
  const regions = regionCatalog ?? await loadRegions();
  const lookup = new Map(regions.map((region) => [region.id, region]));
  const names = entries
    .filter(([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === playerCode.toLowerCase())
    .slice(0, 24)
    .map(([regionId]) => lookup.get(regionId)?.name || regionId);
  return names.length > 0 ? names.join(", ") : "No explicit player region override list is currently recorded.";
};

const buildRegionReferenceFocusText = (bundle, gameMasterRequest = "") => {
  const actionText = normalizeActions(bundle.actions)
    .slice(-24)
    .flatMap((action) => [action.title, action.text, action.rawInput, ...action.participants]);
  const eventText = normalizeEvents(bundle.events)
    .slice(-24)
    .flatMap((event) => [
      event.title,
      event.description,
      ...event.impacts.regionTransfers.flatMap((transfer) => [
        transfer.regionId,
        transfer.regionName,
        transfer.fromCode,
        transfer.toCode,
      ]),
    ]);
  const unitText = normalizeArray(bundle.world?.units)
    .flatMap((unit) => [unit.name, unit.ownerCode, unit.regionId]);

  return [gameMasterRequest, bundle.game?.country, ...actionText, ...eventText, ...unitText]
    .map(normalizeString)
    .filter(Boolean)
    .join("\n");
};

export const buildRegionOwnershipReference = (world, regionCatalog = [], {
  focusText = "",
  maxCharacters = 8000,
  maxRegions = 180,
  playerCode = "",
} = {}) => {
  const normalizedWorld = normalizeWorldState(world);
  const overrides = normalizedWorld.regionOwnershipOverrides;
  const seenRegionIds = new Set();
  const catalog = normalizeArray(regionCatalog);
  // A custom scenario may contain a mixture of author-drawn regions and a
  // selected subset of stock GADM regions. Once the active geometry has been
  // identified, stock regions absent from it are not part of this map and must
  // never be presented to the model as valid transfer targets.
  const visibleCatalog = getActiveRegionCatalog(normalizedWorld, catalog);
  const visibleRegionIds = new Set(visibleCatalog.map((region) => normalizeString(region?.id)).filter(Boolean));
  const entries = [];

  const addRegion = ({ country = "", countryCode = "", id, name, ownerCode }) => {
    const regionId = normalizeString(id);
    if (!regionId || seenRegionIds.has(regionId)) return;

    entries.push({
      country: normalizeString(country),
      countryCode: normalizeString(countryCode),
      id: regionId,
      name: normalizeString(name) || regionId,
      ownerCode: normalizeString(ownerCode) || "UNCLAIMED",
    });
    seenRegionIds.add(regionId);
  };

  for (const region of visibleCatalog) {
    const regionId = normalizeString(region?.id);
    if (!regionId) continue;
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, regionId);
    addRegion({
      country: region?.country,
      countryCode: region?.countryCode,
      id: regionId,
      name: region?.name,
      ownerCode: hasOverride
        ? overrides[regionId]
        : region?.ownerCode ?? region?.countryCode,
    });
  }

  for (const [regionId, ownerCode] of Object.entries(overrides)) {
    if (visibleRegionIds.size > 0 && !visibleRegionIds.has(regionId)) continue;
    addRegion({ id: regionId, name: regionId, ownerCode });
  }

  if (entries.length === 0) {
    return "Authoritative region ownership reference: no exact region identifiers are available.";
  }

  const normalizedFocus = normalizeString(focusText).toLocaleLowerCase();
  const focusWords = new Set(normalizedFocus.toLocaleUpperCase().match(/[A-Z0-9][A-Z0-9_-]+/g) ?? []);
  const player = normalizeString(playerCode).toLocaleUpperCase();
  const unitRegionIds = new Set(
    normalizeArray(normalizedWorld.units).map((unit) => normalizeString(unit?.regionId)).filter(Boolean),
  );
  const contextualCodes = new Set(player ? [player] : []);
  const explicitFocusCodes = new Set();
  for (const unit of normalizeArray(normalizedWorld.units)) {
    const ownerCode = normalizeString(unit?.ownerCode).toLocaleUpperCase();
    if (ownerCode) contextualCodes.add(ownerCode);
  }
  for (const [code, polity] of Object.entries(normalizedWorld.polityOverrides)) {
    const names = [code, polity?.code, polity?.name, ...normalizeArray(polity?.aliases)]
      .map((value) => normalizeString(value).toLocaleLowerCase())
      .filter(Boolean);
    if (names.some((name) => normalizedFocus.includes(name))) {
      explicitFocusCodes.add(normalizeString(code).toLocaleUpperCase());
    }
  }

  const scoredEntries = entries.map((entry) => {
    const ownerCode = entry.ownerCode.toLocaleUpperCase();
    const countryCode = entry.countryCode.toLocaleUpperCase();
    let score = 0;
    if (normalizedFocus.includes(entry.id.toLocaleLowerCase())) score += 5000;
    if (entry.name.length >= 3 && normalizedFocus.includes(entry.name.toLocaleLowerCase())) score += 4500;
    if (entry.country.length >= 3 && normalizedFocus.includes(entry.country.toLocaleLowerCase())) score += 4000;
    if ((ownerCode !== player && focusWords.has(ownerCode)) ||
      (countryCode !== player && focusWords.has(countryCode))) score += 3500;
    if (explicitFocusCodes.has(ownerCode) || explicitFocusCodes.has(countryCode)) score += 3000;
    if (unitRegionIds.has(entry.id)) score += 1200;
    if (contextualCodes.has(ownerCode) || contextualCodes.has(countryCode)) score += 300;
    if (player && ownerCode === player) score += 200;
    return { ...entry, score };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const safeRegionLimit = Math.max(1, Math.min(500, Math.trunc(Number(maxRegions)) || 180));
  const safeCharacterLimit = Math.max(1000, Math.trunc(Number(maxCharacters)) || 8000);
  let selected = scoredEntries.slice(0, safeRegionLimit);
  const renderReference = (regions) => {
    const regionsByOwner = new Map();
    for (const region of regions) {
      const ownerRegions = regionsByOwner.get(region.ownerCode) ?? [];
      ownerRegions.push(region);
      regionsByOwner.set(region.ownerCode, ownerRegions);
    }
    const ownershipLines = [...regionsByOwner.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ownerCode, ownerRegions]) => {
        const ownerEntries = ownerRegions
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((region) => `${region.id}=${region.name}`)
          .join("; ");
        return `- ${ownerCode}: ${ownerEntries}`;
      });

    return [
      `Authoritative region ownership reference for this turn (showing ${regions.length} of ${entries.length} visible regions; current owner code: exact-region-id=display name):`,
      "Use only exact region ids listed below. If a required region is not listed, leave its ownership unchanged instead of guessing.",
      ...ownershipLines,
    ].join("\n");
  };

  let reference = renderReference(selected);
  while (reference.length > safeCharacterLimit && selected.length > 1) {
    selected = selected.slice(0, -1);
    reference = renderReference(selected);
  }

  return reference;
};

export const buildWorldSummary = async (bundle, regionCatalog = null) => {
  const world = normalizeWorldState(bundle.world);
  const regions = regionCatalog ?? await loadRegions();
  const regionLookup = new Map(regions.map((region) => [region.id, region]));
  const territoryEntries = Object.entries(world.regionOwnershipOverrides);
  const territorySummary = territoryEntries.length === 0
    ? "No territorial overrides from the base scenario are currently recorded."
    : territoryEntries.slice(0, 24).map(([regionId, ownerCode]) => {
      const region = regionLookup.get(regionId);
      return `- ${region?.name || regionId} [${regionId}]${region?.country ? ` (${region.country})` : ""} -> ${ownerCode}`;
    }).join("\n");
  const polities = Object.values(world.polityOverrides);
  const politySummary = polities.length === 0
    ? "No dynamic polity overrides are currently recorded."
    : polities.slice(0, 16).map((entry) =>
      `- ${entry.code}: ${entry.name || entry.code}${entry.color ? ` (${entry.color})` : ""}${entry.aliases.length > 0 ? ` aliases ${entry.aliases.join(", ")}` : ""}`,
    ).join("\n");

  return [
    `Player polity: ${bundle.game.country || "Unknown polity"}`,
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
    "Dynamic polity overrides:",
    politySummary,
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
  chatLimit = 8,
  chatsToConsolidate = "",
  eventLimit = 10,
  eventsToConsolidate = "",
  gameMasterRequest = "",
  includeRegionOwnershipReference = false,
  longEventLimit = 24,
  respondingPolityName = "",
  targetDate = "",
} = {}) => {
  const normalizedChat = chat && typeof chat === "object" ? normalizeChats([chat])[0] : null;
  const regionCatalog = await loadRegions();
  const date = bundle.game.gameDate || "";
  const target = targetDate || date;
  const worldSummary = await buildWorldSummary(bundle, regionCatalog);
  const recentEvents = buildEventHistoryText(bundle.events, { limit: eventLimit, world: bundle.world });
  const campaignHistory = buildCampaignHistoryText(bundle.events, bundle.world, { limit: longEventLimit });
  const allActions = buildActionHistoryText(bundle.actions, { includeResolved: true });
  const actionText = formatActionsForPrompt(bundle.actions);
  const consolidatedChatIds = new Set(
    normalizeWorldState(bundle.world).consolidatedHistory.flatMap((entry) => entry.chatIds),
  );
  const unconsolidatedChats = normalizeChats(bundle.chats)
    .filter((entry) => !consolidatedChatIds.has(entry.id));
  const currentChat = normalizedChat ?? unconsolidatedChats[0] ?? null;

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
    chat: JSON.stringify(unconsolidatedChats),
    chatHistory: currentChat?.messages?.map((message) => `${message.speaker || message.role}: ${message.text}`).join("\n") || "No chat history.",
    chatHistoryLong: buildDetailedChatHistoryText(unconsolidatedChats, { limit: chatLimit }),
    chatParticipants: currentChat?.countries?.map((country) => country.name).join(", ") || "",
    chatSummary: buildChatSummaryText(unconsolidatedChats),
    chatsToConsolidate: chatsToConsolidate || buildDetailedChatHistoryText(unconsolidatedChats, { limit: 12, messageLimit: 50 }),
    consolidatedHistory: buildConsolidatedHistoryText(bundle.world),
    date,
    dateReadable: formatDateReadable(date),
    difficulty: bundle.game.difficulty || "standard",
    difficultyGuidanceChats: buildDifficultyGuidance(bundle.game.difficulty, "chats"),
    difficultyGuidanceJumpForward: buildDifficultyGuidance(bundle.game.difficulty, "jump"),
    eventsToConsolidate: eventsToConsolidate || buildEventHistoryText(bundle.events, { limit: 12 }),
    gameMasterRequest,
    language: bundle.world.language || bundle.game.language || "English",
    lastSpeaker: currentChat?.messages?.at(-1)?.speaker || "",
    numberOfRegions: String(getActiveRegionCatalog(bundle.world, regionCatalog).length),
    plannedActions: buildActionHistoryText(bundle.actions),
    playerBattalionSummaries: buildUnitsSummaryText(bundle.world),
    playerPolity: bundle.game.country || "Unknown polity",
    playerPolityRegions: await buildPlayerPolityRegionsText(bundle, regionCatalog),
    recentEvents,
    recentEventsLong: campaignHistory,
    recentRoundsWithDates: buildRecentRoundsWithDates(bundle),
    respondingPolityName: respondingPolityName || currentChat?.countries.find((country) => country.name !== bundle.game.country)?.name || "",
    regionOwnershipReference: includeRegionOwnershipReference
      ? buildRegionOwnershipReference(bundle.world, regionCatalog, {
          focusText: buildRegionReferenceFocusText(bundle, gameMasterRequest),
          playerCode: bundle.game.country,
        })
      : "",
    round: String(bundle.game.round || 1),
    simulationRules: normalizeString(bundle.world.simulationRules) || "No extra simulation rules were provided.",
    startDate: bundle.game.startDate || "",
    targetDate: target,
    targetDateReadable: formatDateReadable(target),
    unitsSummary: buildUnitsSummaryText(bundle.world),
    worldBeforeRoundOne: normalizeString(bundle.world.startingTimelineText) || "No pre-game world briefing was provided.",
    worldSummary,
    worldSummaryNoCity: worldSummary,
  };
};
