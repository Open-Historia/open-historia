import dayjs from "dayjs";
import { JSON_URLS, getNationTags, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { resolveAllCountryTags, resolveCountryTags } from "../../runtime/countryTags.js";
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
  // never moved the map. List every region as `name (id)` grouped by its current
  // owner (override ?? base country), prioritising the active theatre (the player,
  // any re-owned or tagged power) so fromCode/toCode and the region id resolve.
  const playerCode = normalizeString(bundle.game.country);
  const overrideOwnerCodes = [...new Set(
    territoryEntries.map(([, ownerCode]) => normalizeString(ownerCode)).filter(Boolean),
  )];
  const priorityCodes = [playerCode, ...overrideOwnerCodes, ...taggedCodes].filter(Boolean);
  const polityNames = Object.fromEntries(
    polities
      .filter((entry) => entry?.code)
      .map((entry) => [String(entry.code).toLowerCase(), entry.name || entry.code]),
  );
  const regionOwnershipCatalog = buildRegionOwnershipText(regions, world.regionOwnershipOverrides, {
    priorityCodes,
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
    "Full ownership map — every region as `name (id)`, grouped by the code of its "
      + "CURRENT owner. THIS is the comma-separated region list referenced above. To "
      + "move territory in a regionTransfer, copy a region's EXACT name or id from here "
      + "(never invent or translate a region name — an unlisted name will not resolve "
      + "and the map will not change) and use the owner codes shown for fromCode/toCode:",
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
  chatLimit = 8,
  chatsToConsolidate = "",
  eventLimit = 10,
  eventsToConsolidate = "",
  gameMasterRequest = "",
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
    citiesSummary,
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
    worldSummary,
    worldSummaryNoCity: worldSummary,
  };
};
