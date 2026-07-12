/*! Open Historia — portions (troop deployments + era troop types) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { JSON_URLS, readJson, writeJson } from "./assets.js";
import { enqueueContentStrings } from "./translator.js";

export const GAME_DEFAULTS = {
  country: "",
  difficulty: "standard",
  gameDate: "",
  language: "English",
  round: 1,
  startDate: "",
};

export const WORLD_DEFAULTS = {
  actionSuggestions: [],
  activeCatalyst: null,
  consolidatedHistory: [],
  language: "English",
  lastJumpMode: "",
  lastJumpSummary: "",
  lastJumpTargetDate: "",
  notes: "",
  polityOverrides: {},
  regionOwnershipOverrides: {},
  simulationHistory: [],
  simulationRules: "",
  startingTimelineText: "",
  units: [],
};

// Military units that ride along inside world state (world.units[]). Stored here
// so they share every existing read/write/poll/normalize path with no server change.
export const UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"];
const UNIT_TYPE_SET = new Set(UNIT_TYPES);
// "pending" = a player deployment awaiting AI resolution (rendered translucent).
const UNIT_STATUS_SET = new Set(["idle", "moving", "engaged", "defeated", "pending"]);
const UNIT_SOURCE_SET = new Set(["player", "ai", "scenario"]);

const finiteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const clampUnitStrength = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  return Math.max(0, Math.min(1000, Math.round(num)));
};

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => String(value ?? "").trim();

const normalizeOptionalString = (value) => {
  const nextValue = normalizeString(value);
  return nextValue || "";
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeTextLike = (value) => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalizeOptionalString(value);
  }

  if (value && typeof value === "object") {
    return normalizeOptionalString(
      value.text ??
        value.title ??
        value.label ??
        value.name ??
        value.summary ??
        value.description ??
        value.content ??
        value.result,
    );
  }

  return "";
};

const generateId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const normalizeActionParticipants = (value) =>
  normalizeArray(value)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);

export const normalizeActionEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const text = normalizeString(entry);
    if (!text) return null;

    return {
      createdAt: new Date().toISOString(),
      id: generateId(`action-${index}`),
      kind: "action",
      participants: [],
      rawInput: text,
      source: "manual",
      status: "planned",
      text,
      title: text.length > 64 ? `${text.slice(0, 61)}...` : text,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const rawInput = normalizeTextLike(entry.rawInput || entry.input || entry.text || entry.content);
  const text = normalizeTextLike(entry.text || entry.content || entry.body || rawInput);
  const title =
    normalizeTextLike(entry.title || entry.name) ||
    (text.length > 64 ? `${text.slice(0, 61)}...` : text);

  if (!title && !text && !rawInput) {
    return null;
  }

  const kind =
    normalizeString(entry.kind || entry.type).toLowerCase() === "chat"
      ? "chat"
      : "action";

  return {
    chatStarter: normalizeOptionalString(entry.chatStarter || entry.openingMessage),
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    id: normalizeOptionalString(entry.id) || generateId(`action-${index}`),
    invitees: normalizeActionParticipants(entry.invitees),
    kind,
    participants: normalizeActionParticipants(entry.participants),
    rawInput: rawInput || text || title,
    source: normalizeOptionalString(entry.source) || "manual",
    status: normalizeOptionalString(entry.status) || "planned",
    suggestionTopic: normalizeOptionalString(entry.suggestionTopic || entry.topic),
    text: text || rawInput || title,
    title: title || rawInput || text,
  };
};

export const normalizeActions = (actions) =>
  normalizeArray(actions)
    .map((entry, index) => normalizeActionEntry(entry, index))
    .filter(Boolean);

const normalizeCatalystChoice = (entry, index = 0) => {
  if (typeof entry === "string") {
    const text = normalizeString(entry);
    if (!text) {
      return null;
    }

    return {
      id: generateId(`catalyst-choice-${index}`),
      result: "",
      text,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const text = normalizeTextLike(entry.text || entry.title || entry.label || entry.name);
  if (!text) {
    return null;
  }

  return {
    ...cloneValue(entry),
    id: normalizeOptionalString(entry.id) || generateId(`catalyst-choice-${index}`),
    result: normalizeTextLike(entry.result || entry.summary || entry.outcome || entry.effect || entry.description),
    text,
  };
};

const normalizeCatalystHistoryEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const summary = normalizeString(entry);
    if (!summary) {
      return null;
    }

    return {
      choice: `Step ${index + 1}`,
      summary,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const choice = normalizeTextLike(entry.choice || entry.text || entry.title || entry.name);
  const summary = normalizeTextLike(entry.summary || entry.result || entry.outcome || entry.description);

  if (!choice && !summary) {
    return null;
  }

  return {
    ...cloneValue(entry),
    choice: choice || `Step ${index + 1}`,
    summary,
  };
};

const normalizeCatalyst = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const title = normalizeTextLike(value.title || value.name);
  const premise = normalizeTextLike(value.premise || value.summary || value.description);
  const opening = normalizeTextLike(value.opening || value.text || premise);
  const choices = normalizeArray(value.choices)
    .map((entry, index) => normalizeCatalystChoice(entry, index))
    .filter(Boolean);
  const history = normalizeArray(value.history)
    .map((entry, index) => normalizeCatalystHistoryEntry(entry, index))
    .filter(Boolean);

  if (!title && !premise && !opening && choices.length === 0 && history.length === 0) {
    return null;
  }

  return {
    ...cloneValue(value),
    choices,
    history,
    opening,
    premise,
    title,
  };
};

const normalizeReactionMap = (value) => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([name, reaction]) => {
        if (!reaction || typeof reaction !== "object") {
          return [name, null];
        }

        const emoji = normalizeOptionalString(reaction.emoji);
        const code = normalizeOptionalString(reaction.code);

        if (!emoji && !code) {
          return [name, null];
        }

        return [
          name,
          {
            ...(code ? { code } : {}),
            ...(emoji ? { emoji } : {}),
          },
        ];
      })
      .filter(([, reaction]) => reaction),
  );
};

const normalizeChatMessage = (message, index = 0) => {
  if (typeof message === "string") {
    const text = normalizeString(message);
    if (!text) return null;

    return {
      code: "",
      id: generateId(`message-${index}`),
      reactions: {},
      role: "system",
      speaker: "",
      text,
      time: "",
    };
  }

  if (!message || typeof message !== "object") {
    return null;
  }

  const text = normalizeOptionalString(message.text || message.message || message.content);
  if (!text) {
    return null;
  }

  return {
    code: normalizeOptionalString(message.code),
    id: normalizeOptionalString(message.id) || generateId(`message-${index}`),
    reactions: normalizeReactionMap(message.reactions),
    role: normalizeOptionalString(message.role || message.sender) || "system",
    speaker: normalizeOptionalString(message.speaker || message.senderName),
    text,
    time: normalizeOptionalString(message.time || message.date),
  };
};

const normalizeChatCountry = (entry) => {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    const name = normalizeString(entry);
    if (!name) return null;

    return {
      code: "",
      name,
    };
  }

  if (typeof entry !== "object") {
    return null;
  }

  const name = normalizeOptionalString(entry.name || entry.label || entry.country);
  const code = normalizeOptionalString(entry.code || entry.id);

  if (!name && !code) {
    return null;
  }

  return {
    code,
    name: name || code,
  };
};

export const normalizeChatEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const countries = normalizeArray(entry.countries || entry.participants)
    .map((country) => normalizeChatCountry(country))
    .filter(Boolean);
  if (countries.length === 0) return null;

  return {
    countries,
    id: normalizeOptionalString(entry.id) || generateId(`chat-${index}`),
    linkedEventId: normalizeOptionalString(entry.linkedEventId || entry.eventId),
    messages: normalizeArray(entry.messages)
      .map((message, messageIndex) => normalizeChatMessage(message, messageIndex))
      .filter(Boolean),
    source: normalizeOptionalString(entry.source) || "manual",
    status: normalizeOptionalString(entry.status) || "open",
    title: normalizeOptionalString(entry.title),
  };
};

export const normalizeChats = (chats) =>
  normalizeArray(chats)
    .map((entry, index) => normalizeChatEntry(entry, index))
    .filter(Boolean);

const normalizeRegionTransfer = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  const toCode = normalizeOptionalString(entry.toCode || entry.toPolity || entry.ownerCode || entry.owner);
  const fromCode = normalizeOptionalString(entry.fromCode || entry.fromPolity);

  if (!regionId || !toCode) {
    return null;
  }

  return {
    fromCode,
    note: normalizeOptionalString(entry.note || entry.reason),
    regionId,
    regionName: normalizeOptionalString(entry.regionName || entry.name),
    toCode,
  };
};

const normalizePolityChange = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const code = normalizeOptionalString(entry.code || entry.id || entry.polityCode);
  if (!code) {
    return null;
  }

  return {
    aliases: normalizeActionParticipants(entry.aliases || entry.additionalNames),
    code,
    color: normalizeOptionalString(entry.color),
    name: normalizeOptionalString(entry.name || entry.newName),
    note: normalizeOptionalString(entry.note || entry.reason),
  };
};

export const normalizeUnitEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  const ownerCode = normalizeOptionalString(entry.ownerCode || entry.owner || entry.code);
  if (lng === null || lat === null || !ownerCode) {
    return null;
  }

  const type = normalizeOptionalString(entry.type).toLowerCase();
  const status = normalizeOptionalString(entry.status).toLowerCase();
  const source = normalizeOptionalString(entry.source).toLowerCase();
  const timestamp = new Date().toISOString();

  return {
    id: normalizeOptionalString(entry.id) || generateId(`unit-${index}`),
    name: normalizeOptionalString(entry.name) || "Unit",
    type: UNIT_TYPE_SET.has(type) ? type : "infantry",
    ownerCode,
    strength: clampUnitStrength(entry.strength ?? 100),
    lng,
    lat,
    regionId: normalizeOptionalString(entry.regionId),
    status: UNIT_STATUS_SET.has(status) ? status : "idle",
    note: normalizeOptionalString(entry.note),
    source: UNIT_SOURCE_SET.has(source) ? source : "scenario",
    orderId: normalizeOptionalString(entry.orderId),
    createdAt: normalizeOptionalString(entry.createdAt) || timestamp,
    updatedAt: normalizeOptionalString(entry.updatedAt) || timestamp,
  };
};

export const normalizeUnits = (units) =>
  normalizeArray(units)
    .map((entry, index) => normalizeUnitEntry(entry, index))
    .filter(Boolean);

// One AI-authored mutation to the unit list: spawn | move | strength | remove.
const normalizeUnitOp = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const op = normalizeOptionalString(entry.op).toLowerCase();
  const unitId = normalizeOptionalString(entry.unitId || entry.id);

  if (op === "spawn") {
    const unit = normalizeUnitEntry(entry.unit ?? entry, 0);
    if (!unit) return null;
    unit.source = "ai";
    return { op, unit };
  }

  if (!unitId) {
    return null;
  }

  if (op === "move") {
    const toLng = finiteOrNull(entry.toLng ?? entry.lng);
    const toLat = finiteOrNull(entry.toLat ?? entry.lat);
    if (toLng === null || toLat === null) return null;
    return {
      op,
      unitId,
      toLng,
      toLat,
      regionId: normalizeOptionalString(entry.regionId),
      note: normalizeOptionalString(entry.note),
    };
  }

  if (op === "strength") {
    return { op, unitId, strength: clampUnitStrength(entry.strength ?? 0), note: normalizeOptionalString(entry.note) };
  }

  if (op === "remove") {
    return { op, unitId, note: normalizeOptionalString(entry.note) };
  }

  return null;
};

// Apply a batch of unit ops to a unit list (pure). Ops referencing unknown ids
// are silently ignored; units reduced to <=0 strength are dropped.
export const applyUnitOps = (units, ops) => {
  let next = normalizeUnits(units);
  for (const op of normalizeArray(ops)) {
    if (op.op === "spawn") {
      next.push(op.unit);
    } else if (op.op === "move") {
      next = next.map((unit) =>
        unit.id === op.unitId
          ? {
              ...unit,
              lng: op.toLng,
              lat: op.toLat,
              regionId: op.regionId || unit.regionId,
              status: "moving",
              updatedAt: new Date().toISOString(),
            }
          : unit,
      );
    } else if (op.op === "strength") {
      next = next.map((unit) =>
        unit.id === op.unitId
          ? { ...unit, strength: op.strength, status: op.strength <= 0 ? "defeated" : unit.status, updatedAt: new Date().toISOString() }
          : unit,
      );
    } else if (op.op === "remove") {
      next = next.filter((unit) => unit.id !== op.unitId);
    }
  }
  return next.filter((unit) => unit.strength > 0 && unit.status !== "defeated");
};

const normalizeEventImpacts = (value) => {
  if (!value || typeof value !== "object") {
    return {
      actionIds: [],
      createdChats: [],
      polityChanges: [],
      regionTransfers: [],
      unitOps: [],
    };
  }

  return {
    actionIds: normalizeActionParticipants(value.actionIds),
    createdChats: normalizeChats(value.createdChats),
    polityChanges: normalizeArray(value.polityChanges).map(normalizePolityChange).filter(Boolean),
    regionTransfers: normalizeArray(value.regionTransfers).map(normalizeRegionTransfer).filter(Boolean),
    unitOps: normalizeArray(value.unitOps).map(normalizeUnitOp).filter(Boolean),
  };
};

export const normalizeEventEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const title = normalizeString(entry);
    if (!title) return null;

    return {
      createdAt: new Date().toISOString(),
      date: "",
      description: "",
      id: generateId(`event-${index}`),
      impacts: normalizeEventImpacts(null),
      importance: "minor",
      kind: "world",
      notable: false,
      playerRelated: false,
      source: "scenario",
      title,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const title =
    normalizeOptionalString(entry.title || entry.headline || entry.name) ||
    normalizeOptionalString(entry.description || entry.summary);

  if (!title) {
    return null;
  }

  return {
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    date: normalizeOptionalString(entry.date),
    description: normalizeOptionalString(entry.description || entry.summary || entry.text),
    id: normalizeOptionalString(entry.id) || generateId(`event-${index}`),
    impacts: normalizeEventImpacts(entry.impacts),
    importance: normalizeOptionalString(entry.importance) || "minor",
    kind: normalizeOptionalString(entry.kind) || "world",
    notable: Boolean(entry.notable),
    playerRelated: Boolean(entry.playerRelated),
    source: normalizeOptionalString(entry.source) || "scenario",
    title,
  };
};

export const normalizeEvents = (events) => {
  if (Array.isArray(events)) {
    return events
      .map((entry, index) => normalizeEventEntry(entry, index))
      .filter(Boolean);
  }

  if (events && typeof events === "object") {
    if (Array.isArray(events.events)) {
      return normalizeEvents(events.events);
    }

    return Object.values(events)
      .map((entry, index) => normalizeEventEntry(entry, index))
      .filter(Boolean);
  }

  return [];
};

const normalizePolityOverride = (key, value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const code = normalizeOptionalString(value.code) || normalizeOptionalString(key);
  if (!code) {
    return null;
  }

  return {
    aliases: normalizeActionParticipants(value.aliases || value.additionalNames),
    code,
    color: normalizeOptionalString(value.color),
    name: normalizeOptionalString(value.name || value.label),
    note: normalizeOptionalString(value.note),
  };
};

const normalizeActionSuggestions = (value) =>
  normalizeArray(value).map((topic) => {
    if (!topic || typeof topic !== "object") {
      return null;
    }

    const title = normalizeOptionalString(topic.title || topic.name);
    if (!title) {
      return null;
    }

    return {
      actions: normalizeArray(topic.actions).map((entry, index) => normalizeActionEntry(entry, index)).filter(Boolean),
      description: normalizeOptionalString(topic.description),
      id: normalizeOptionalString(topic.id) || generateId("topic"),
      title,
    };
  }).filter(Boolean);

const normalizeConsolidatedHistory = (value) => normalizeArray(value)
  .map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const summary = normalizeTextLike(entry.summary);
    if (!summary) return null;
    return {
      chatIds: normalizeActionParticipants(entry.chatIds),
      createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
      source: normalizeOptionalString(entry.source) || "ai",
      summary,
      throughDate: normalizeOptionalString(entry.throughDate),
      throughEventId: normalizeOptionalString(entry.throughEventId),
      throughRound: Number.isFinite(Number(entry.throughRound))
        ? Math.max(0, Math.trunc(Number(entry.throughRound)))
        : 0,
    };
  })
  .filter(Boolean);

export const normalizeWorldState = (world) => {
  const nextWorld = world && typeof world === "object" ? world : {};
  const polityOverrides = Object.fromEntries(
    Object.entries(nextWorld.polityOverrides ?? {})
      .map(([key, value]) => [key, normalizePolityOverride(key, value)])
      .filter(([, value]) => value),
  );

  const regionOwnershipOverrides = Object.fromEntries(
    Object.entries(nextWorld.regionOwnershipOverrides ?? {})
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), normalizeOptionalString(ownerCode)])
      .filter(([regionId, ownerCode]) => regionId && ownerCode),
  );

  return {
    ...WORLD_DEFAULTS,
    ...nextWorld,
    actionSuggestions: normalizeActionSuggestions(nextWorld.actionSuggestions),
    activeCatalyst: normalizeCatalyst(nextWorld.activeCatalyst),
    consolidatedHistory: normalizeConsolidatedHistory(nextWorld.consolidatedHistory),
    language: normalizeOptionalString(nextWorld.language) || WORLD_DEFAULTS.language,
    lastJumpMode: normalizeOptionalString(nextWorld.lastJumpMode),
    lastJumpSummary: normalizeOptionalString(nextWorld.lastJumpSummary),
    lastJumpTargetDate: normalizeOptionalString(nextWorld.lastJumpTargetDate),
    notes: normalizeOptionalString(nextWorld.notes),
    polityOverrides,
    regionOwnershipOverrides,
    simulationHistory: normalizeArray(nextWorld.simulationHistory)
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        return {
          ...cloneValue(entry),
          catalyst: normalizeCatalyst(entry.catalyst),
          date: normalizeOptionalString(entry.date),
          eventIds: normalizeActionParticipants(entry.eventIds),
          fallbackReason: normalizeOptionalString(entry.fallbackReason),
          fromDate: normalizeOptionalString(entry.fromDate || entry.startDate),
          mode: normalizeOptionalString(entry.mode),
          plannedActions: normalizeActions(entry.plannedActions || entry.actions),
          round:
            Number.isFinite(Number(entry.round)) && Number(entry.round) > 0
              ? Math.trunc(Number(entry.round))
              : 0,
          summary: normalizeTextLike(entry.summary),
          source: normalizeOptionalString(entry.source) || "ai",
          toDate: normalizeOptionalString(entry.toDate || entry.endDate || entry.date),
        };
      })
      .filter(Boolean),
    simulationRules: normalizeOptionalString(nextWorld.simulationRules),
    startingTimelineText: normalizeOptionalString(nextWorld.startingTimelineText),
    units: normalizeUnits(nextWorld.units),
  };
};

export const normalizeGameData = (game) => {
  const nextGame = game && typeof game === "object" ? game : {};

  return {
    ...GAME_DEFAULTS,
    ...nextGame,
    country: normalizeOptionalString(nextGame.country),
    difficulty: normalizeOptionalString(nextGame.difficulty) || GAME_DEFAULTS.difficulty,
    gameDate: normalizeOptionalString(nextGame.gameDate),
    language: normalizeOptionalString(nextGame.language) || GAME_DEFAULTS.language,
    round:
      Number.isFinite(Number(nextGame.round)) && Number(nextGame.round) > 0
        ? Math.trunc(Number(nextGame.round))
        : GAME_DEFAULTS.round,
    startDate: normalizeOptionalString(nextGame.startDate),
  };
};

export const buildActionDisplayText = (action) => {
  const normalized = normalizeActionEntry(action);
  if (!normalized) {
    return "";
  }

  return normalized.kind === "chat" && normalized.chatStarter
    ? `${normalized.title}: ${normalized.chatStarter}`
    : normalized.text;
};

export const readWorldState = async ({ force = false } = {}) =>
  normalizeWorldState(await readJson(JSON_URLS.world, { defaultValue: WORLD_DEFAULTS, force }));

export const writeWorldState = async (world, options = {}) => {
  const normalized = normalizeWorldState(world);
  // Edited/AI-written polity names, aliases and notes get translated (and
  // saved to the server language pack) the moment they're written, not when
  // they first happen to be rendered somewhere.
  enqueueContentStrings(normalized.polityOverrides);
  return writeJson(JSON_URLS.world, normalized, { pretty: true, ...options });
};

export const readGameData = async ({ force = false } = {}) =>
  normalizeGameData(await readJson(JSON_URLS.game, { defaultValue: GAME_DEFAULTS, force }));

export const writeGameData = async (game, options = {}) =>
  writeJson(JSON_URLS.game, normalizeGameData(game), { pretty: true, ...options });

export const readActionsState = async ({ force = false } = {}) =>
  normalizeActions(await readJson(JSON_URLS.actions, { defaultValue: [], force }));

export const writeActionsState = async (actions, options = {}) =>
  writeJson(JSON_URLS.actions, normalizeActions(actions), { pretty: true, ...options });

export const readEventsState = async ({ force = false } = {}) =>
  normalizeEvents(await readJson(JSON_URLS.events, { defaultValue: [], force }));

export const writeEventsState = async (events, options = {}) => {
  const normalized = normalizeEvents(events);
  // New/edited event text follows the UI language immediately (see above).
  enqueueContentStrings(normalized);
  return writeJson(JSON_URLS.events, normalized, { pretty: true, ...options });
};

export const readChatsState = async ({ force = false } = {}) =>
  normalizeChats(await readJson(JSON_URLS.chat, { defaultValue: [], force }));

export const writeChatsState = async (chats, options = {}) =>
  writeJson(JSON_URLS.chat, normalizeChats(chats), { pretty: true, ...options });

export const readGameStateBundle = async ({ force = false } = {}) => {
  const [actions, chats, events, game, world] = await Promise.all([
    readActionsState({ force }),
    readChatsState({ force }),
    readEventsState({ force }),
    readGameData({ force }),
    readWorldState({ force }),
  ]);

  return {
    actions,
    chats,
    events,
    game,
    world,
  };
};

export const applyEventImpactsToWorld = ({ colors = {}, events = [], world }) => {
  const nextColors = cloneValue(colors) ?? {};
  const nextWorld = normalizeWorldState(world);

  for (const event of normalizeEvents(events)) {
    for (const transfer of event.impacts.regionTransfers) {
      nextWorld.regionOwnershipOverrides[transfer.regionId] = transfer.toCode;
    }

    for (const change of event.impacts.polityChanges) {
      nextWorld.polityOverrides[change.code] = {
        ...(nextWorld.polityOverrides[change.code] ?? {
          aliases: [],
          code: change.code,
          color: "",
          name: "",
          note: "",
        }),
        ...(change.aliases?.length > 0 ? { aliases: change.aliases } : {}),
        ...(change.color ? { color: change.color } : {}),
        ...(change.name ? { name: change.name } : {}),
        ...(change.note ? { note: change.note } : {}),
      };

      if (change.color) {
        const normalizedColor = normalizeOptionalString(change.color);
        const hexMatch = /^#?([a-f0-9]{6})$/i.exec(normalizedColor);
        if (hexMatch) {
          const hex = hexMatch[1];
          nextColors[change.code] = [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
          ];
        }
      }
    }

    if (event.impacts.unitOps?.length) {
      nextWorld.units = applyUnitOps(nextWorld.units, event.impacts.unitOps);
    }
  }

  return {
    colors: nextColors,
    world: nextWorld,
  };
};
