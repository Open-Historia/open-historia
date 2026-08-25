import dayjs from "dayjs";
import { JSON_URLS, getNationTags, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { resolveAllCountryTags, resolveCountryTags } from "../../runtime/countryTags.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  buildActionDisplayText,
  haversineKm,
  isPolityLandless,
  normalizeActionEntry,
  normalizeActions,
  normalizeChats,
  normalizeEvents,
  normalizeWorldState,
} from "../../runtime/gameState.js";
import { buildRegionOwnershipText } from "./regionVocab.js";
import { buildForcePostureText } from "./forcePosture.js";
import { describeTimeline, deriveProjectFlags } from "../../runtime/projects.js";
import { buildTerritoryIndex } from "./territoryOutlines.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

// Walks BACKWARD from a chat's last message to the first one with a usable
// `time`, mirroring chat.jsx's chatLastMessageTime (kept as a separate copy
// here rather than imported — that file is a React/UI module this AI-prompt
// layer shouldn't depend on). Returns null when nothing in the chat carries a
// parseable date, so an all-blank chat sorts as "unknown" rather than as
// artificially ancient (which would bury it) or artificially current (which
// would crowd out chats that really are active).
const chatLastMessageTimeMs = (chat) => {
  const messages = chat.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const raw = messages[i]?.time;
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
};

// Most-recently-ACTIVE first. A long-running chat with a country the player
// has kept talking to for many rounds otherwise stays parked wherever it was
// first inserted into storage (chats are only ever prepended on creation, not
// re-ordered on new messages) — so a still-open, actively-updated chat could
// silently fall outside chatHistoryLong/chatSummary's `limit` slice just
// because several OTHER chats were started more recently, even though none of
// them are as current. A chat with no usable date at all sorts to the end,
// same convention as chat.jsx's "Undated" bucket, rather than winning the
// front of the list by default.
const sortChatsByLastActivity = (chats) => [...chats].sort((a, b) => {
  const ta = chatLastMessageTimeMs(a);
  const tb = chatLastMessageTimeMs(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
});

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
    const date = lastMessage?.time ? ` [${formatDateReadable(lastMessage.time)}]` : "";
    return `- ${participants}: ${lastMessage ? `${lastMessage.speaker || lastMessage.role}${date}: ${lastMessage.text}` : "no messages yet"}`;
  }).join("\n");
};

// Every message line carries its own in-game date (when the message has one),
// and every chat header states when that chat last saw activity. Without
// these, the ONLY signal for "which message is most recent" was a message's
// position in the transcript — fine for a human skimming top-to-bottom, but a
// weak, implicit cue for the model to reason about explicitly (especially
// with several same-named countries' chats in view, or a country the player
// has talked to across many separate rounds). An explicit date lets the model
// answer "the recent message from Algeria" by actually comparing dates
// instead of guessing from list position.
export const buildDetailedChatHistoryText = (chats, { limit = 8, messageLimit = 10 } = {}) => {
  const normalizedChats = normalizeChats(chats);
  if (normalizedChats.length === 0) return "No chats occurred in these rounds.";

  return normalizedChats.slice(0, limit).map((chat, index) => {
    const lastActivityMs = chatLastMessageTimeMs(chat);
    const lastActivity = lastActivityMs !== null ? ` (most recent activity: ${formatDateReadable(lastActivityMs)})` : "";
    const header = `Chat ${index + 1}: ${chat.countries.map((country) => country.name).join(", ")}${lastActivity}`;
    const body = chat.messages.length > 0
      ? chat.messages.slice(-messageLimit).map((message) => {
        const date = message.time ? ` [${formatDateReadable(message.time)}]` : "";
        return `${message.speaker || message.role}${date}: ${message.text}`;
      }).join("\n")
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

// Planned actions WITH their ids — every other action-history text is written
// for the simulation model, which never references an action by id, so ids
// would just be clutter there. The advisor is different: it needs a stable
// handle to EDIT or REMOVE a specific queued action the player asks it to
// amend, and copying the id verbatim is the only way to do that precisely
// (matching by title/text is fragile — titles can collide or get reworded).
export const buildPlannedActionsWithIdsText = (actions) => {
  const planned = normalizeActions(actions).filter((action) => action.status === "planned");
  if (planned.length === 0) return "No planned actions are currently queued.";
  return planned
    .map((action) => `- [id ${action.id}] (${action.kind === "chat" ? "chat" : "action"}) ${action.title}: ${buildActionDisplayText(action)}`)
    .join("\n");
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
    const detail = [
      `${unit.type}`,
      `owner ${unit.ownerCode}`,
      `${unit.strength}% of established strength`,
      unit.posture ? `posture ${unit.posture}` : `status ${unit.status}`,
    ].join(", ");
    return `- ${unit.name} [id ${unit.id}] (${detail})${unit.composition ? ` — ${unit.composition}` : ""}` +
      `${unit.covert ? " [unconfirmed]" : ""} at ${coords}${unit.regionId ? `, region ${unit.regionId}` : ""}`;
  }).join("\n");
};

// Standing orders the ENGINE is advancing (world.pendingUnitOrders): a move still
// under way, or a patrol working its station. Kept separate from the actions
// queue and its clearActions flag entirely (see gameState.js), so they re-surface
// every jump until the unit arrives or the order lapses. The model is shown these
// as CONTEXT — advanceStandingOrders already moves them, so a move op for one of
// these units would advance it twice (see the [Standing Unit Orders] directive).
export const buildPendingUnitOrdersText = (world) => {
  const orders = normalizeArray(world?.pendingUnitOrders);
  if (orders.length === 0) {
    return "No units currently have a standing order.";
  }
  const unitById = new Map(normalizeArray(world?.units).map((unit) => [unit.id, unit]));
  return orders.map((order) => {
    const unit = unitById.get(order.unitId);
    if (!unit) return null;
    const remaining = Math.round(haversineKm(unit.lat, unit.lng, order.toLat, order.toLng));
    if (order.kind === "patrol") {
      return `- ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is working a ` +
        `${Math.round(order.radiusKm)} km station centred on lat ${order.toLat.toFixed(2)}, lng ${order.toLng.toFixed(2)}.`;
    }
    const destination = order.targetLabel || `lat ${order.toLat.toFixed(2)}, lng ${order.toLng.toFixed(2)}`;
    return `- ${unit.name} (${unit.type}, id ${unit.id}, owner ${unit.ownerCode}) is en route to ${destination} — ` +
      `currently at lat ${unit.lat.toFixed(2)}, lng ${unit.lng.toFixed(2)}, about ${remaining} km still to go.`;
  }).filter(Boolean).join("\n");
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

// The Projects & Operations board (world.projects), written out for the model.
//
// Ids are printed with every entry, and the directives insist they be copied
// verbatim, because the alternative is the model inventing one and its update
// landing on nothing (applyProjectOps drops an op whose target does not exist —
// far better than spawning a phantom project from a typo).
//
// Also prints what the ENGINE derived rather than what the model last said:
// overdue, and rounds since the last update. That is the nudge that gets a
// neglected programme moved along, and it cannot be argued with — it is a
// function of the calendar, not of anyone's memory.
export const buildProjectsSummaryText = (world, game) => {
  const projects = normalizeArray(world?.projects);
  if (projects.length === 0) {
    return "No projects or operations are being tracked yet.";
  }

  const gameDate = normalizeString(game?.gameDate);
  const round = Number(game?.round) || 0;
  const player = normalizeString(game?.country);

  return projects.map((project) => {
    const flags = deriveProjectFlags(project, gameDate, round);
    const owner = normalizeString(project.ownerCode);
    // Do not label it twice: half of these are already called "Operation X" or
    // "Project Y", and "Operation \"Operation Kingfisher\"" reads like a mistake.
    const label = project.kind === "operation" ? "Operation" : "Project";
    const titled = project.name.toLowerCase().startsWith(`${label.toLowerCase()} `)
      ? `"${project.name}"`
      : `${label} "${project.name}"`;
    const head = [
      `${titled} [id ${project.id}]`,
      owner && owner !== player ? `run by ${owner}` : "ours",
      project.status,
      `${project.progress}% complete`,
    ].filter(Boolean).join(", ");

    const timeline = describeTimeline(project, gameDate);
    const next = flags.nextMilestone
      ? `Next: ${flags.nextMilestone.title}${flags.nextMilestone.date ? ` (${flags.nextMilestone.date})` : ""}.`
      : "";
    // Only the flags that are actually raised, so the common case stays short.
    const warnings = [
      flags.overdue ? "OVERDUE" : "",
      flags.milestoneMissed ? "a milestone has slipped" : "",
      flags.stale ? "no progress reported recently" : "",
      project.secrecy !== "public" ? project.secrecy : "",
    ].filter(Boolean);
    const roundsSince = round > 0 && project.updatedRound > 0 ? round - project.updatedRound : 0;

    return [
      `- ${head}.`,
      project.summary,
      project.tags.length ? `Tags: ${project.tags.join(", ")}.` : "",
      timeline ? `${timeline}.` : "",
      next,
      project.lastUpdate ? `Last reported: ${project.lastUpdate}` : "",
      roundsSince > 0 ? `Last updated ${roundsSince} round${roundsSince === 1 ? "" : "s"} ago.` : "",
      warnings.length ? `[${warnings.join("; ")}]` : "",
    ].filter(Boolean).join(" ");
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
  // Every power fielding forces, plus the player and whoever they are talking to
  // — the set the "are X's units near Y's border?" question could be about.
  // Bounded deliberately: indexing all ~200 countries' geometry would decode a
  // lot of coastline nobody is going to ask about.
  const forcePosture = await (async () => {
    const world = normalizeWorldState(bundle.world);
    const owners = [
      normalizeString(bundle.game?.country),
      ...normalizeArray(world.units).map((unit) => normalizeString(unit.ownerCode)),
      ...normalizeChats(bundle.chats).flatMap((chat) =>
        normalizeArray(chat.countries).map((country) => normalizeString(country?.name))),
    ].filter(Boolean);
    let territories = null;
    try {
      territories = await buildTerritoryIndex(world, { owners: [...new Set(owners)] });
    } catch (error) {
      // Border proximity is colour on top; never let it break a prompt build.
      console.warn("[ai] force posture fell back to positions only:", error);
    }
    return buildForcePostureText(
      world.units,
      world.pendingUnitOrders,
      territories,
      normalizeString(bundle.game?.country),
    );
  })();
  const citiesSummary = await buildCityCatalogText(bundle.world);
  const recentEvents = buildEventHistoryText(bundle.events, { limit: eventLimit, world: bundle.world });
  const campaignHistory = buildCampaignHistoryText(bundle.events, bundle.world, { limit: longEventLimit });
  const allActions = buildActionHistoryText(bundle.actions, { includeResolved: true });
  const actionText = formatActionsForPrompt(bundle.actions);
  const consolidatedChatIds = new Set(
    normalizeWorldState(bundle.world).consolidatedHistory.flatMap((entry) => entry.chatIds),
  );
  const unconsolidatedChats = sortChatsByLastActivity(
    normalizeChats(bundle.chats).filter((entry) => !consolidatedChatIds.has(entry.id)),
  );
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
    forcePosture,
    difficultyGuidanceChats: buildDifficultyGuidance(bundle.game.difficulty, "chats"),
    difficultyGuidanceJumpForward: buildDifficultyGuidance(bundle.game.difficulty, "jump"),
    eventsToConsolidate: eventsToConsolidate || buildEventHistoryText(bundle.events, { limit: 12 }),
    gameMasterRequest,
    language: bundle.world.language || bundle.game.language || "English",
    lastSpeaker: currentChat?.messages?.at(-1)?.speaker || "",
    markersSummary: buildMarkersSummaryText(bundle.world),
    numberOfRegions: String(regionCatalog.length),
    pendingUnitOrders: buildPendingUnitOrdersText(bundle.world),
    plannedActions: buildActionHistoryText(bundle.actions),
    plannedActionsWithIds: buildPlannedActionsWithIdsText(bundle.actions),
    playerBattalionSummaries: buildUnitsSummaryText(bundle.world),
    playerPolity: bundle.game.country || "Unknown polity",
    playerPolityRegions: await buildPlayerPolityRegionsText(bundle, regionCatalog),
    projectsSummary: buildProjectsSummaryText(bundle.world, bundle.game),
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
