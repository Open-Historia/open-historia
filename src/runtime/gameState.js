/*! Open Historia — portions (troop deployments + era troop types) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { JSON_URLS, readJson, writeJson } from "./assets.js";
import { enqueueContentStrings } from "./translator.js";
import { normalizeTagList } from "./countryTags.js";
import { mergeCountryStatPatch, normalizeCountryStatSheet } from "./countryStats.js";
import { dedupeEventLog } from "./eventDedup.js";
import { toCountryName } from "./ownerNames.js";
import { isStockPolityName, resolvePolityIdentity, resolveTerritorialPolityIdentity } from "./polityIdentity.js";
import { distanceKm, engagementRangeKm, resolveClash } from "../Game/Map/unitCombat.js";


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
  // Per-polity international reputation (0-100), evolved by the AI each turn via
  // polityChanges and fed back into prompts. Authoritative, unlike the on-demand
  // stat sheet it was first read from.
  internationalReputation: {},
  // Persisted per-country stat sheets (code -> the full sheet), seeded on first view
  // and thereafter changed ONLY by the AI (polityChanges.stats), so a country's stats
  // stop regenerating/drifting every date change.
  countryStats: {},
  // Per-country tags the AI has changed: owner code -> string[]. The scenario's
  // tags.json holds the map-maker's STARTING tags; this holds every change since,
  // and wins where present (see resolveCountryTags).
  countryTags: {},
  // AI renames of STOCK map cities (which live in PMTiles, not world.markers):
  // lowercased original city name -> new display name. world.markers cities are
  // renamed in place by applyMarkerOps; this is the override layer for the rest.
  cityRenames: {},
  // Country-label styling, set in the scenario settings. Empty = the defaults
  // (Impact, white letters, half-black outline). The font renders from the
  // PLAYER's local fonts — the style has no glyphs endpoint, so MapLibre v5
  // rasterizes every glyph client-side using the stack as a CSS font-family.
  labelFont: "",
  labelHaloColor: "",
  labelTextColor: "",
  language: "English",
  lastJumpMode: "",
  lastJumpSummary: "",
  lastJumpTargetDate: "",
  // Structures built during play (world.markers[]): free-form kinds — a city, a
  // military base, a bunker, a missile silo, an embassy — placed at coordinates
  // and rendered as map markers beside the stock cities. Stored here so they
  // share every existing read/write/poll/normalize path, exactly like units.
  markers: [],
  notes: "",
  polityOverrides: {},
  // Region id -> claimant polity names: the world-data way to mark a region
  // DISPUTED (striped in the administrator's + claimants' colors). Same effect
  // as a claimants list on the region's geojson feature, but declarable by a
  // scenario whose geometry ships as an immutable seed (the modern world), and
  // overridable per-world without touching geometry. Wins over feature props.
  regionClaimants: {},
  // Legal sovereignty is separate from de-facto map control. This ledger is
  // lazily/migrationally seeded from existing ownership overrides so old saves
  // keep their borders, while future wartime occupations stop becoming treaties.
  regionSovereigntyOverrides: {},
  regionOwnershipOverrides: {},
  simulationHistory: [],
  simulationRules: "",
  startingTimelineText: "",
  // Persistent authoritative belligerency. Storylines explain WHY a conflict
  // matters; wars say WHO is mechanically at war with whom.
  wars: [],
  // Persistent world processes (wars, crises, political movements, diplomatic
  // tracks, economic shocks, etc.). Timeline cards are only their visible
  // milestones; this ledger is what keeps the process alive between cards.
  storylines: [],
  units: [],
};

// Military units that ride along inside world state (world.units[]). Stored here
// so they share every existing read/write/poll/normalize path with no server change.
export const UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"];
const UNIT_TYPE_SET = new Set(UNIT_TYPES);
// "pending" = a player deployment awaiting AI resolution (rendered translucent).
const UNIT_STATUS_SET = new Set(["idle", "moving", "engaged", "defeated", "pending"]);
const UNIT_SOURCE_SET = new Set(["player", "ai", "scenario"]);
const POLITY_OPERATION_SET = new Set(["update", "create", "rename", "restore", "dissolve"]);
const POLITY_STATUS_SET = new Set(["active", "dormant"]);
const WORLD_STORYLINE_STATUS_SET = new Set(["active", "dormant", "resolved"]);
const WORLD_WAR_STATUS_SET = new Set(["active", "ceasefire", "ended"]);
const MAX_WORLD_STORYLINES = 96;
const MAX_WORLD_WARS = 64;

// Every caller of this parses a COORDINATE (lng/lat/toLng/toLat), which is why it
// can afford to be lenient in ways a general number parser could not.
//
// It used to be a bare Number(), and a model writing in a language that uses the
// decimal COMMA answers "37,06" — Number() returns NaN, the unit is discarded, and
// the player sees an event describing a deployment with no troops on the map. The
// same went for a coordinate carrying its unit ("37.06°N"). Recover both instead of
// throwing the deployment away.
//
// A comma is only read as a decimal point when it is the ONLY separator: "1,234.5"
// keeps its usual meaning, so a thousands separator can never silently divide a
// value by a thousand.
const finiteOrNull = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  let text = value.trim();
  if (!text) return null;

  // A trailing or leading hemisphere letter carries the sign: 37.06 S is -37.06.
  let sign = 1;
  const hemisphere = /^([NSEW])\s*|\s*([NSEW])$/i.exec(text);
  if (hemisphere) {
    const letter = (hemisphere[1] || hemisphere[2]).toUpperCase();
    if (letter === "S" || letter === "W") sign = -1;
    text = text.replace(/^[NSEW]\s*/i, "").replace(/\s*[NSEW]$/i, "");
  }

  if (text.includes(",") && !text.includes(".")) text = text.replace(",", ".");
  // Degree signs, stray spaces, anything else that is not part of a number.
  text = text.replace(/[^\d+\-.eE]/g, "");
  if (!text || !/\d/.test(text)) return null;

  const num = Number(text);
  return Number.isFinite(num) ? sign * num : null;
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

// How to undo a queued manual troop order if its action is deleted before the
// next jump (see unitsController): a deploy is removed again, a move snaps the
// unit back, a long-range order restores the prior status (#368).
const normalizeUnitRevert = (value) => {
  if (!value || typeof value !== "object") return null;
  const unitId = normalizeOptionalString(value.unitId);
  if (!unitId) return null;
  const lng = finiteOrNull(value.lng);
  const lat = finiteOrNull(value.lat);
  return {
    unitId,
    ...(lng !== null && lat !== null ? { lng, lat } : {}),
    ...(value.remove === true ? { remove: true } : {}),
    ...(normalizeOptionalString(value.status) ? { status: normalizeOptionalString(value.status) } : {}),
  };
};

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

  const unitRevert = normalizeUnitRevert(entry.unitRevert);

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
    ...(unitRevert ? { unitRevert } : {}),
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
        const polityKey = normalizeOptionalString(reaction.polityKey || reaction.identityKey);

        if (!emoji && !code && !polityKey) {
          return [name, null];
        }

        return [
          name,
          {
            ...(code ? { code } : {}),
            ...(emoji ? { emoji } : {}),
            ...(polityKey ? { polityKey } : {}),
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
      polityKey: "",
      reactions: {},
      role: "system",
      speaker: "",
      text,
      time: "",
      memorySummary: "",
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
    polityKey: normalizeOptionalString(message.polityKey || message.identityKey),
    reactions: normalizeReactionMap(message.reactions),
    role: normalizeOptionalString(message.role || message.sender) || "system",
    speaker: normalizeOptionalString(message.speaker || message.senderName),
    text,
    time: normalizeOptionalString(message.time || message.date),
    // Hidden rolling continuity note produced alongside a diplomatic reply.
    // It is never rendered as chat text; it exists so long-lived negotiations can
    // stay bounded without forgetting agreements, threats or unresolved proposals.
    memorySummary: normalizeOptionalString(
      message.memorySummary || message.diplomaticMemorySummary,
    ),
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
      polityKey: "",
    };
  }

  if (typeof entry !== "object") {
    return null;
  }

  const name = normalizeOptionalString(entry.name || entry.label || entry.country);
  const code = normalizeOptionalString(entry.code || entry.id);
  const polityKey = normalizeOptionalString(entry.polityKey || entry.identityKey);

  if (!name && !code && !polityKey) {
    return null;
  }

  return {
    code,
    name: name || polityKey || code,
    polityKey,
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

// ---- Save-aware diplomatic identity -----------------------------------------
//
// Chat JSON is deliberately allowed to stay a simple transport/storage shape.
// The semantic question — "which actor in THIS save does this participant mean?"
// — belongs here, beside the polity lifecycle resolver, not in four UI call sites.
//
// A stable polityOverride key is the lineage identity. Display names may change,
// but the key does not; old names/aliases can therefore follow the actor through
// regime changes without teaching chat code anything about Germany, Rome, 1201,
// 2026, or whatever cursed scenario the player loaded this time.
const CHAT_MAP_CODE_PATTERN = /^[A-Z]{2,3}$/;

const currentPolityDisplayName = (world, polityKey) => {
  const record = world?.polityOverrides?.[polityKey];
  return normalizeOptionalString(record?.name || record?.code || polityKey);
};

const resolveChatIdentityTokens = ({ code = "", name = "", polityKey = "" } = {}, world) => {
  const strongTokens = [polityKey, name]
    .map(normalizeOptionalString)
    .filter(Boolean);
  const compactMapCode = CHAT_MAP_CODE_PATTERN.test(normalizeOptionalString(code));
  const weakCodeToken = normalizeOptionalString(code);
  const resolutions = [];
  let ambiguous = false;

  const tryToken = (token) => {
    if (!token) return;
    const resolution = resolvePolityIdentity(token, world, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    if (resolution.resolved) resolutions.push(resolution);
    if (String(resolution.status || "").startsWith("ambiguous")) ambiguous = true;
  };

  for (const token of strongTokens) tryToken(token);

  // `code` is unfortunately mixed legacy data: generated chats historically used
  // full polity names here, while the UI used a 3-letter map code for flags. A
  // short map code is useful as a FALLBACK but must not contradict a perfectly good
  // lineage/name resolution (DEU must not split "German Republic" back into a
  // second stock "Germany" actor after a rename).
  if (resolutions.length === 0 || !compactMapCode) tryToken(weakCodeToken);

  const unique = new Map();
  for (const resolution of resolutions) {
    unique.set(normalizeString(resolution.resolved).toLowerCase(), resolution);
  }

  if (unique.size !== 1) {
    return {
      ambiguous: ambiguous || unique.size > 1,
      candidates: [...unique.values()].flatMap((entry) => entry.candidates || []),
      resolved: "",
      safe: false,
      status: unique.size > 1 ? "conflicting-chat-identity" : (ambiguous ? "ambiguous-chat-identity" : "unresolved-chat-identity"),
    };
  }

  const resolution = [...unique.values()][0];
  return {
    ...resolution,
    safe: true,
  };
};

export const resolveChatParticipantIdentity = (entry, world) => {
  const participant = normalizeChatCountry(entry);
  if (!participant) {
    return {
      participant: null,
      polityKey: "",
      safe: false,
      status: "empty-chat-participant",
    };
  }

  const resolution = resolveChatIdentityTokens(participant, world);
  if (!resolution.safe) {
    return {
      participant,
      polityKey: "",
      safe: false,
      status: resolution.status,
      candidates: resolution.candidates || [],
    };
  }

  const polityKey = resolution.resolved;
  return {
    participant: {
      ...participant,
      // Preserve a real map/GID code when one exists; Phase 5B can use the stable
      // key for identity while the old UI keeps its flag lookup working meanwhile.
      code: participant.code || polityKey,
      name: currentPolityDisplayName(world, polityKey) || participant.name || polityKey,
      polityKey,
    },
    polityKey,
    safe: true,
    status: resolution.status,
  };
};

const reconcileReactionMapForWorld = (reactions, world) => {
  const next = {};
  for (const [name, reaction] of Object.entries(normalizeReactionMap(reactions))) {
    const resolved = resolveChatParticipantIdentity({
      code: reaction.code,
      name,
      polityKey: reaction.polityKey,
    }, world);
    const nextName = resolved.safe ? resolved.participant.name : name;
    if (!nextName) continue;

    // If the same actor appears under an old and a current alias, one reaction slot
    // is enough. Prefer the later entry's emoji/code while preserving its lineage.
    next[nextName] = {
      ...reaction,
      ...(resolved.safe ? {
        code: reaction.code || resolved.participant.code || resolved.polityKey,
        polityKey: resolved.polityKey,
      } : {}),
    };
  }
  return next;
};

const reconcileChatMessageForWorld = (message, world) => {
  const normalized = normalizeChatMessage(message);
  if (!normalized) return null;

  const resolved = resolveChatParticipantIdentity({
    code: normalized.code,
    name: normalized.speaker,
    polityKey: normalized.polityKey,
  }, world);

  return {
    ...normalized,
    ...(resolved.safe ? {
      code: normalized.code || resolved.participant.code || resolved.polityKey,
      polityKey: resolved.polityKey,
      speaker: resolved.participant.name,
    } : {}),
    reactions: reconcileReactionMapForWorld(normalized.reactions, world),
  };
};

export const reconcileChatForWorld = (entry, world, index = 0) => {
  const chat = normalizeChatEntry(entry, index);
  if (!chat) return null;

  const countries = [];
  const seenSafeKeys = new Set();
  for (const country of chat.countries) {
    const resolved = resolveChatParticipantIdentity(country, world);
    if (!resolved.participant) continue;

    if (resolved.safe) {
      const key = normalizeString(resolved.polityKey).toLowerCase();
      if (seenSafeKeys.has(key)) continue; // same actor entered twice via aliases
      seenSafeKeys.add(key);
    }
    countries.push(resolved.participant);
  }
  if (countries.length === 0) return null;

  return {
    ...chat,
    countries,
    messages: chat.messages
      .map((message) => reconcileChatMessageForWorld(message, world))
      .filter(Boolean),
  };
};

export const chatParticipantSetKey = (entry, world) => {
  const chat = reconcileChatForWorld(entry, world);
  if (!chat || chat.countries.length === 0) return "";

  const keys = [];
  for (const country of chat.countries) {
    const resolved = resolveChatParticipantIdentity(country, world);
    if (!resolved.safe || !resolved.polityKey) return "";
    keys.push(normalizeString(resolved.polityKey).toLowerCase());
  }

  return [...new Set(keys)].sort().join("\u001f");
};

const chatMessageFingerprint = (message) => {
  const normalized = normalizeChatMessage(message);
  if (!normalized) return "";
  const reactions = Object.entries(normalized.reactions || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, reaction]) => `${name}:${reaction?.emoji || ""}:${reaction?.polityKey || reaction?.code || ""}`)
    .join("|");
  return [
    normalized.polityKey || normalized.speaker,
    normalized.role,
    normalized.text,
    normalized.time,
    reactions,
  ].map((value) => normalizeString(value).toLowerCase()).join("\u001e");
};

const mergeChatMessages = (primaryMessages, incomingMessages) => {
  const merged = normalizeArray(primaryMessages).map((entry) => normalizeChatMessage(entry)).filter(Boolean);
  const ids = new Set(merged.map((message) => normalizeString(message.id)).filter(Boolean));
  const fingerprints = new Set(merged.map(chatMessageFingerprint).filter(Boolean));

  for (const message of normalizeArray(incomingMessages).map((entry) => normalizeChatMessage(entry)).filter(Boolean)) {
    const id = normalizeString(message.id);
    const fingerprint = chatMessageFingerprint(message);
    const duplicate = (id && ids.has(id)) || (fingerprint && fingerprints.has(fingerprint));

    if (duplicate) {
      // A stale structural copy can race a richer copy of the same reply. Never let
      // reconciliation throw away the hidden continuity memory merely because the
      // visible message already exists.
      const matchIndex = merged.findIndex((existing) => {
        const existingId = normalizeString(existing.id);
        if (id && existingId === id) return true;
        return fingerprint && chatMessageFingerprint(existing) === fingerprint;
      });

      if (
        matchIndex >= 0 &&
        !normalizeOptionalString(merged[matchIndex].memorySummary) &&
        normalizeOptionalString(message.memorySummary)
      ) {
        merged[matchIndex] = {
          ...merged[matchIndex],
          memorySummary: message.memorySummary,
        };
      }
      continue;
    }

    merged.push(message);
    if (id) ids.add(id);
    if (fingerprint) fingerprints.add(fingerprint);
  }

  return merged;
};

const mergeChatRecords = (primary, incoming, world) => {
  const left = reconcileChatForWorld(primary, world);
  const right = reconcileChatForWorld(incoming, world);
  if (!left) return right;
  if (!right) return left;

  return reconcileChatForWorld({
    ...right,
    ...left,
    // The established thread owns its id/title/status. Incoming material contributes
    // history and missing metadata, never a surprise identity replacement.
    id: left.id || right.id,
    linkedEventId: left.linkedEventId || right.linkedEventId,
    messages: mergeChatMessages(left.messages, right.messages),
    source: left.source || right.source,
    status: left.status || right.status || "open",
    title: left.title || right.title,
  }, world);
};

export const reconcileChatsForWorld = (chats, world) => {
  const reconciled = normalizeArray(chats)
    .map((entry, index) => reconcileChatForWorld(entry, world, index))
    .filter(Boolean);

  const output = [];
  const openByParticipants = new Map();

  for (const chat of reconciled) {
    // Closed chats are history. Never fold them into a current negotiation merely
    // because the same countries are talking again twenty years later.
    if (normalizeString(chat.status).toLowerCase() === "closed") {
      output.push(chat);
      continue;
    }

    const key = chatParticipantSetKey(chat, world);
    if (!key) {
      // Ambiguous/unresolved actors are intentionally NOT merged. This is the civil-
      // war safety wall: uncertainty produces two threads, not one invented polity.
      output.push(chat);
      continue;
    }

    const existingIndex = openByParticipants.get(key);
    if (existingIndex == null) {
      openByParticipants.set(key, output.length);
      output.push(chat);
      continue;
    }

    output[existingIndex] = mergeChatRecords(output[existingIndex], chat, world);
  }

  return output;
};

// The player is implicit in every diplomatic thread. Older generated chats sometimes
// stored the player as an ordinary participant as well, producing self-chats such as
// "United Kingdom, German Empire" while the campaign player was that same German
// lineage. Strip the player ONLY when its save-aware lineage resolves unambiguously,
// then reconcile again so [Britain, player] and [Britain] collapse into one thread.
// If the player identity is ambiguous/unresolved, preserve the data rather than guess.
export const reconcileChatsForPlayer = (chats, world, playerCountry = "") => {
  const base = reconcileChatsForWorld(chats, world);
  const playerIdentity = resolveChatParticipantIdentity(
    typeof playerCountry === "object" ? playerCountry : { name: playerCountry },
    world,
  );

  if (!playerIdentity.safe || !playerIdentity.polityKey) return base;

  const playerKey = normalizeString(playerIdentity.polityKey).toLowerCase();
  const stripped = base
    .map((chat) => {
      const countries = normalizeArray(chat.countries).filter((country) => {
        const resolved = resolveChatParticipantIdentity(country, world);
        if (!resolved.safe || !resolved.polityKey) return true;
        return normalizeString(resolved.polityKey).toLowerCase() !== playerKey;
      });

      // A player-only thread is not diplomacy; it was malformed legacy/generated
      // state. Dropping it is safer than letting the UI invite the player to answer
      // themselves or letting an AI leader speak on the player's behalf.
      if (countries.length === 0) return null;
      return { ...chat, countries };
    })
    .filter(Boolean);

  return reconcileChatsForWorld(stripped, world);
};

// Merge newly generated/outreach chats onto the LIVE stored list. Existing storage
// wins identity/id/order; a new unmatched thread is prepended. This is intentionally
// separate from normalizeChats so structural parsing never starts making historical
// claims about which two actors are "really" the same country.
export const mergeIncomingChats = (existingChats, incomingChats, world, { playerCountry = "" } = {}) => {
  const reconcile = (list) => playerCountry
    ? reconcileChatsForPlayer(list, world, playerCountry)
    : reconcileChatsForWorld(list, world);
  const base = reconcile(existingChats);
  const incoming = reconcile(incomingChats);

  // Incoming lists are already newest-first. Iterate backwards when prepending so
  // their visible ordering survives.
  for (let index = incoming.length - 1; index >= 0; index -= 1) {
    const chat = incoming[index];
    const status = normalizeString(chat.status).toLowerCase();
    const key = status === "closed" ? "" : chatParticipantSetKey(chat, world);
    const existingIndex = key
      ? base.findIndex((candidate) =>
          normalizeString(candidate.status).toLowerCase() !== "closed" &&
          chatParticipantSetKey(candidate, world) === key)
      : -1;

    if (existingIndex >= 0) {
      base[existingIndex] = mergeChatRecords(base[existingIndex], chat, world);
    } else {
      base.unshift(chat);
    }
  }

  return reconcile(base);
};

const normalizeRegionTransfer = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  // Owners are stored as the FULL COUNTRY NAME. This value is written straight into
  // world.regionOwnershipOverrides, so a model that answered "ESP" out of habit would
  // otherwise mint a phantom country that paints and labels itself beside the real
  // Spain. Canonicalise on the way in, once, rather than papering over it at render.
  const toCode = toCountryName(normalizeOptionalString(entry.toCode || entry.toPolity || entry.ownerCode || entry.owner));
  const fromCode = toCountryName(normalizeOptionalString(entry.fromCode || entry.fromPolity));

  if (!regionId || !toCode) {
    return null;
  }

  return {
    fromCode,
    note: normalizeOptionalString(entry.note || entry.reason),
    regionId,
    regionName: normalizeOptionalString(entry.regionName || entry.name),
    toCode,
    ...(entry.wholeCountry === true ? { wholeCountry: true } : {}),
  };
};

const normalizeRegionControlOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;

  const op = normalizeOptionalString(entry.op).toLowerCase();
  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  const regionName = normalizeOptionalString(entry.regionName || entry.name);
  const fromCode = toCountryName(normalizeOptionalString(entry.fromCode || entry.fromPolity));
  const note = normalizeOptionalString(entry.note || entry.reason);

  if (!regionId) return null;

  if (op === "contest") {
    const actorCode = toCountryName(normalizeOptionalString(entry.actorCode || entry.claimantCode || entry.toCode));
    if (!fromCode || !actorCode || fromCode.toLowerCase() === actorCode.toLowerCase()) return null;
    return { op, regionId, regionName, fromCode, actorCode, note };
  }

  if (op === "control" || op === "control_flip") {
    const toCode = toCountryName(normalizeOptionalString(entry.toCode || entry.controllerCode || entry.ownerCode));
    if (!fromCode || !toCode || fromCode.toLowerCase() === toCode.toLowerCase()) return null;
    return {
      op: "control",
      regionId,
      regionName,
      fromCode,
      toCode,
      note,
      ...(entry.wholeCountry === true ? { wholeCountry: true } : {}),
    };
  }

  if (op === "clear_contest" || op === "clear") {
    const claimantCode = toCountryName(normalizeOptionalString(entry.claimantCode || entry.actorCode));
    const clearAll = entry.clearAll === true || normalizeOptionalString(entry.claimantCode).toLowerCase() === "all";
    if (!claimantCode && !clearAll) return null;
    return {
      op: "clear_contest",
      regionId,
      regionName,
      fromCode,
      claimantCode,
      clearAll,
      note,
    };
  }

  return null;
};

const normalizePolityChange = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const code = toCountryName(normalizeOptionalString(entry.code || entry.id || entry.polityCode));
  if (!code) {
    return null;
  }

  const rawReputation = Number(entry.reputation ?? entry.internationalReputation);
  const reputation = Number.isFinite(rawReputation)
    ? Math.max(0, Math.min(100, Math.round(rawReputation)))
    : null;

  // The AI sends the complete new list, so an empty array is meaningful ("this
  // country no longer has defining tags") while undefined means "unchanged" —
  // null keeps those distinguishable for the apply step below.
  const tags = Array.isArray(entry.tags || entry.countryTags)
    ? normalizeTagList(entry.tags || entry.countryTags)
    : null;

  // Persistent stat-sheet update: keep the partial object as-is (the merge + the Stats
  // pane tolerate missing/extra fields); null means "no stat change this period".
  const stats = entry.stats && typeof entry.stats === "object" && !Array.isArray(entry.stats)
    ? entry.stats
    : null;

  const rawOperation = normalizeOptionalString(
    entry.operation || entry.op || entry.action,
  ).toLowerCase();

  // Old saved events predate explicit lifecycle operations. Keep them readable as
  // ordinary updates; NEW AI output is required by the live tool schema to state
  // create/rename/restore/dissolve explicitly.
  const operation = POLITY_OPERATION_SET.has(rawOperation)
    ? rawOperation
    : "update";

  return {
    aliases: normalizeActionParticipants(entry.aliases || entry.additionalNames),
    code,
    color: normalizeOptionalString(entry.color),
    name: normalizeOptionalString(entry.name || entry.newName),
    note: normalizeOptionalString(entry.note || entry.reason),
    operation,
    reputation,
    stats,
    tags,
  };
};

export const normalizeUnitEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  // Full country name, never a code — same identity everywhere (see ownerNames.js).
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code));
  if (lng === null || lat === null || (lng === 0 && lat === 0) || !ownerCode) {
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

// A structure built during play: any named point on the map — city, military
// base, bunker, missile silo, embassy, port. `kind` is deliberately free-form
// (lowercased for stable styling/grouping); unknown kinds are first-class.
export const normalizeMarkerEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  const name = normalizeOptionalString(entry.name || entry.title);
  if (lng === null || lat === null || (lng === 0 && lat === 0) || !name) {
    return null;
  }

  return {
    id: normalizeOptionalString(entry.id) || generateId(`marker-${index}`),
    name,
    kind: (normalizeOptionalString(entry.kind || entry.type) || "landmark").toLowerCase(),
    ownerCode: toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code)),
    lng,
    lat,
    note: normalizeOptionalString(entry.note || entry.description),
    foundedAt: normalizeOptionalString(entry.foundedAt || entry.date),
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
  };
};

export const normalizeMarkers = (markers) =>
  normalizeArray(markers)
    .map((entry, index) => normalizeMarkerEntry(entry, index))
    .filter(Boolean);

// One AI-authored mutation to the built-structure list: build | remove.
const normalizeMarkerOp = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const op = normalizeOptionalString(entry.op).toLowerCase();

  if (op === "build" || op === "found") {
    const marker = normalizeMarkerEntry(entry.marker ?? entry, 0);
    if (!marker) return null;
    return { op: "build", marker };
  }

  if (op === "remove" || op === "destroy") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name);
    if (!markerId && !name) return null;
    return { op: "remove", markerId, name, note: normalizeOptionalString(entry.note) };
  }

  if (op === "rename") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name || entry.from || entry.oldName);
    const newName = normalizeOptionalString(entry.newName || entry.to);
    if ((!markerId && !name) || !newName) return null;
    return { op: "rename", markerId, name, newName, note: normalizeOptionalString(entry.note) };
  }

  return null;
};

// Apply a batch of marker ops (pure). Rebuilding under an existing name
// replaces it rather than stacking duplicates; removal matches id first, then
// exact name — the AI usually knows the name, rarely the id.
export const applyMarkerOps = (markers, ops) => {
  let next = normalizeMarkers(markers);
  for (const op of normalizeArray(ops)) {
    if (op.op === "build") {
      next = [
        ...next.filter((marker) => marker.name.toLowerCase() !== op.marker.name.toLowerCase()),
        op.marker,
      ];
    } else if (op.op === "remove") {
      next = next.filter((marker) =>
        op.markerId ? marker.id !== op.markerId : marker.name.toLowerCase() !== op.name.toLowerCase());
    } else if (op.op === "rename") {
      next = next.map((marker) =>
        (op.markerId ? marker.id === op.markerId : marker.name.toLowerCase() === (op.name || "").toLowerCase())
          ? { ...marker, name: op.newName }
          : marker);
    }
  }
  return next;
};

// One AI-authored mutation to the unit list: spawn | move | attack | strength | remove.
// Why normalizeUnitOp refused an entry, in words a player can paste into a bug
// report. Mirrors the checks below — keep the two in step.
const describeUnitOpRejection = (entry) => {
  if (!entry || typeof entry !== "object") return "not an object";
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (!op) return "no op (expected spawn, move, attack, strength or remove)";
  if (op === "spawn") {
    const unit = entry.unit ?? entry;
    if (!unit || typeof unit !== "object") return "spawn without a unit";
    const lng = finiteOrNull(unit.lng ?? unit.lon ?? unit.longitude);
    const lat = finiteOrNull(unit.lat ?? unit.latitude);
    if (lng === null || lat === null) {
      // The usual cause: a non-numeric coordinate ("37,06", "37.06°N") that JSON
      // carried through as a string and Number() turned into NaN.
      return `spawn has unusable coordinates (lng=${JSON.stringify(unit.lng)}, lat=${JSON.stringify(unit.lat)})`;
    }
    if (lng === 0 && lat === 0) return "spawn at 0,0 — the output template's placeholder, not a real position";
    if (!normalizeOptionalString(unit.ownerCode || unit.owner || unit.code)) return "spawn has no owner";
    return "spawn rejected";
  }
  if (!normalizeOptionalString(entry.unitId || entry.id)) return `${op} without a unitId`;
  if (op === "move") {
    const toLng = finiteOrNull(entry.toLng ?? entry.lng);
    const toLat = finiteOrNull(entry.toLat ?? entry.lat);
    if (toLng === null || toLat === null) return `move has unusable destination (toLng=${JSON.stringify(entry.toLng)}, toLat=${JSON.stringify(entry.toLat)})`;
    if (toLng === 0 && toLat === 0) return "move to 0,0 — the output template's placeholder, not a real position";
  }
  if (op === "attack" && !normalizeOptionalString(entry.targetUnitId || entry.targetId)) {
    return "attack without a targetUnitId";
  }
  return `unknown op "${op}"`;
};

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
    if (toLng === null || toLat === null || (toLng === 0 && toLat === 0)) return null;
    return {
      op,
      unitId,
      toLng,
      toLat,
      regionId: normalizeOptionalString(entry.regionId),
      note: normalizeOptionalString(entry.note),
    };
  }

  if (op === "attack") {
    const targetUnitId = normalizeOptionalString(entry.targetUnitId || entry.targetId);
    if (!targetUnitId || targetUnitId === unitId) return null;
    return { op, unitId, targetUnitId, note: normalizeOptionalString(entry.note) };
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
export const applyUnitOps = (units, ops, { gameDate = "", combatSeed = "event" } = {}) => {
  let next = normalizeUnits(units);
  let attackSequence = 0;

  for (const op of normalizeArray(ops)) {
    if (op.op === "spawn") {
      // Idempotent: skip a spawn whose unit id is already present, so a re-applied
      // op batch can't duplicate a unit (mirrors the event-restatement de-dup).
      const spawnId = op.unit?.id;
      if (!spawnId || !next.some((unit) => unit.id === spawnId)) next.push(op.unit);
      continue;
    }

    if (op.op === "move") {
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
      continue;
    }

    if (op.op === "attack") {
      const attacker = next.find((unit) => unit.id === op.unitId);
      const defender = next.find((unit) => unit.id === op.targetUnitId);

      if (!attacker || !defender || attacker.id === defender.id) {
        console.warn("[unit combat] attack ignored because attacker/defender could not be resolved.", op);
        continue;
      }
      if (attacker.ownerCode === defender.ownerCode) {
        console.warn("[unit combat] friendly-fire attack ignored.", op);
        continue;
      }

      const distance = distanceKm(attacker, defender);
      const range = engagementRangeKm(attacker.type, gameDate);
      if (distance > range) {
        console.warn(
          `[unit combat] ${attacker.name} cannot engage ${defender.name}: ${Math.round(distance)} km away, ` +
          `beyond ~${range} km ${attacker.type} engagement range.`,
        );
        continue;
      }

      // resolveClash only needs a deterministic seed token in its third argument.
      // include event + sequence so two real clashes between the same pair in one
      // round do not reuse the exact same random roll forever.
      attackSequence += 1;
      const clashSeed = `${combatSeed}:${attackSequence}`;
      const result = resolveClash(attacker, defender, clashSeed);
      const timestamp = new Date().toISOString();

      next = next
        .map((unit) => {
          if (unit.id === attacker.id) {
            const survives = result.attackerStrength > 0;
            return {
              ...unit,
              strength: result.attackerStrength,
              status: survives ? "engaged" : "defeated",
              lng: survives && result.captured ? defender.lng : unit.lng,
              lat: survives && result.captured ? defender.lat : unit.lat,
              regionId: survives && result.captured ? (defender.regionId || unit.regionId) : unit.regionId,
              updatedAt: timestamp,
            };
          }
          if (unit.id === defender.id) {
            return {
              ...unit,
              strength: result.defenderStrength,
              status: result.defenderStrength > 0 ? "engaged" : "defeated",
              updatedAt: timestamp,
            };
          }
          return unit;
        })
        .filter((unit) => unit.strength > 0 && unit.status !== "defeated");

      console.info(
        `[unit combat] ${attacker.name} vs ${defender.name}: ` +
        `${attacker.strength}->${result.attackerStrength}, ${defender.strength}->${result.defenderStrength}` +
        `${result.captured ? "; attacker holds the field" : ""}.`,
      );
      continue;
    }

    if (op.op === "strength") {
      next = next.map((unit) =>
        unit.id === op.unitId
          ? {
              ...unit,
              strength: op.strength,
              status: op.strength <= 0 ? "defeated" : unit.status,
              updatedAt: new Date().toISOString(),
            }
          : unit,
      );
      continue;
    }

    if (op.op === "remove") {
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
      markerOps: [],
      polityChanges: [],
      regionTransfers: [],
      regionControlOps: [],
      unitOps: [],
    };
  }

  return {
    actionIds: normalizeActionParticipants(value.actionIds),
    createdChats: normalizeChats(value.createdChats),
    markerOps: normalizeArray(value.markerOps).map(normalizeMarkerOp).filter(Boolean),
    polityChanges: normalizeArray(value.polityChanges).map(normalizePolityChange).filter(Boolean),
    regionTransfers: normalizeArray(value.regionTransfers).map(normalizeRegionTransfer).filter(Boolean),
    regionControlOps: normalizeArray(value.regionControlOps).map(normalizeRegionControlOp).filter(Boolean),
    // Say WHY a unit op was thrown away. A dropped op is the difference between an
    // event that narrates a deployment and troops that actually appear on the map,
    // and it used to vanish into .filter(Boolean) without a word — leaving no way
    // to tell "the model never emitted one" from "it emitted one we rejected".
    // Region transfers have logged their drops for a while; units now match.
    unitOps: normalizeArray(value.unitOps)
      .map((entry, index) => {
        const normalized = normalizeUnitOp(entry);
        if (!normalized) {
          console.warn(
            `[ai] unitOps[${index}] dropped — ${describeUnitOpRejection(entry)}:`,
            entry,
          );
        }
        return normalized;
      })
      .filter(Boolean),
  };
};

const stripWrappingQuoteMarks = (value) => {
  const text = normalizeOptionalString(value);
  if (!text || text.length < 2) return text;

  const pairs = [
    ['"', '"'],
    ["“", "”"],
    ["‘", "’"],
    ["'", "'"],
  ];

  for (const [open, close] of pairs) {
    if (text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }

  return text;
};

const normalizeEventQuote = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const text = stripWrappingQuoteMarks(value.text || value.quote || value.content);
  if (!text) return null;

  const speaker = normalizeOptionalString(
    value.speaker || value.attribution || value.author,
  );
  const role = normalizeOptionalString(value.role || value.title);

  return {
    text,
    ...(speaker ? { speaker } : {}),
    ...(role ? { role } : {}),
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
      storylineIds: [],
      warId: "",
      combatants: [],
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

  const quote = normalizeEventQuote(entry.quote);

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
    storylineIds: [...new Set(normalizeActionParticipants(entry.storylineIds))].slice(0, 6),
    warId: normalizeOptionalString(entry.warId),
    combatants: [...new Set(
      normalizeActionParticipants(entry.combatants)
        .map((name) => toCountryName(normalizeOptionalString(name)) || normalizeOptionalString(name))
        .filter(Boolean),
    )].slice(0, 8),
    ...(quote ? { quote } : {}),
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

  const status = normalizeOptionalString(value.status).toLowerCase();

  const rawMapRefs = value.mapRefs && typeof value.mapRefs === "object" && !Array.isArray(value.mapRefs)
    ? value.mapRefs
    : {};
  const gadm0 = [...new Set(
    normalizeArray(rawMapRefs.gadm0)
      .map((entry) => normalizeOptionalString(entry).toUpperCase())
      .filter(Boolean),
  )];

  return {
    aliases: normalizeActionParticipants(value.aliases || value.additionalNames),
    code,
    color: normalizeOptionalString(value.color),
    ...(gadm0.length ? { mapRefs: { ...rawMapRefs, gadm0 } } : {}),
    name: normalizeOptionalString(value.name || value.label),
    note: normalizeOptionalString(value.note),
    ...(POLITY_STATUS_SET.has(status) ? { status } : {}),
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
      // Ids of the resolved player orders folded into this summary. Without it the
      // same orders would be re-summarised every consolidation, and — because this
      // object is a fixed whitelist — an actionIds written by the consolidator
      // would be dropped on the next read and the tracking would never stick.
      actionIds: normalizeActionParticipants(entry.actionIds),
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

const clampWorldStorylinePercent = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const normalizeWorldStoryline = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const title = normalizeOptionalString(entry.title || entry.name);
  if (!title) return null;

  const id = normalizeOptionalString(entry.id) || `storyline-${index}`;
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  const status = WORLD_STORYLINE_STATUS_SET.has(rawStatus) ? rawStatus : "active";
  const uniqueStrings = (value, limit) =>
    [...new Set(normalizeActionParticipants(value))].slice(0, limit);

  return {
    id,
    kind: normalizeOptionalString(entry.kind) || "world",
    title,
    participants: uniqueStrings(entry.participants, 12),
    status,
    pressure: clampWorldStorylinePercent(entry.pressure),
    momentum: clampWorldStorylinePercent(entry.momentum),
    startedDate: canonicalizeDateString(entry.startedDate),
    accountedThroughDate: canonicalizeDateString(
      entry.accountedThroughDate || entry.lastUpdatedDate || entry.startedDate,
    ),
    lastUpdatedDate: canonicalizeDateString(
      entry.lastUpdatedDate || entry.accountedThroughDate || entry.startedDate,
    ),
    lastVisibleEventDate: canonicalizeDateString(entry.lastVisibleEventDate),
    nextReviewDate:
      status === "resolved" ? "" : canonicalizeDateString(entry.nextReviewDate),
    state: normalizeTextLike(entry.state || entry.summary || entry.description),
    drivers: uniqueStrings(entry.drivers, 8),
    constraints: uniqueStrings(entry.constraints, 8),
    sourceEventIds: uniqueStrings(entry.sourceEventIds, 16),
    createdRound:
      Number.isFinite(Number(entry.createdRound)) && Number(entry.createdRound) > 0
        ? Math.trunc(Number(entry.createdRound))
        : 0,
    updatedRound:
      Number.isFinite(Number(entry.updatedRound)) && Number(entry.updatedRound) > 0
        ? Math.trunc(Number(entry.updatedRound))
        : 0,
  };
};

const normalizeWorldStorylines = (value) => {
  const deduped = new Map();

  normalizeArray(value).forEach((entry, index) => {
    const normalized = normalizeWorldStoryline(entry, index);
    if (!normalized) return;
    // Last occurrence wins so a write can intentionally replace an earlier copy.
    deduped.set(normalized.id, normalized);
  });

  const statusRank = { active: 0, dormant: 1, resolved: 2 };
  return [...deduped.values()]
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      String(b.lastUpdatedDate || b.accountedThroughDate || "").localeCompare(
        String(a.lastUpdatedDate || a.accountedThroughDate || ""),
      ) ||
      a.id.localeCompare(b.id),
    )
    .slice(0, MAX_WORLD_STORYLINES);
};

const normalizeWorldWar = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const canonicalPolity = (value) => {
    const raw = normalizeOptionalString(value);
    return raw ? (toCountryName(raw) || raw) : "";
  };
  const uniquePolities = (value, limit = 12) => {
    const seen = new Set();
    const result = [];
    for (const raw of normalizeArray(value)) {
      const polity = canonicalPolity(raw);
      const key = polity.toLocaleLowerCase();
      if (!polity || seen.has(key)) continue;
      seen.add(key);
      result.push(polity);
      if (result.length >= limit) break;
    }
    return result;
  };

  const id = normalizeOptionalString(entry.id) || `war-${index}`;
  const sideA = uniquePolities(entry.sideA);
  const sideAKeys = new Set(sideA.map((name) => name.toLocaleLowerCase()));
  const sideB = uniquePolities(entry.sideB)
    .filter((name) => !sideAKeys.has(name.toLocaleLowerCase()));
  if (!sideA.length || !sideB.length) return null;

  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  const status = WORLD_WAR_STATUS_SET.has(rawStatus) ? rawStatus : "active";
  const sourceEventIds = [...new Set(normalizeActionParticipants(entry.sourceEventIds))].slice(-24);
  const storylineIds = [...new Set(normalizeActionParticipants(entry.storylineIds))].slice(-12);
  const title = normalizeOptionalString(entry.title) || `${sideA[0]}–${sideB[0]} War`;

  return {
    id,
    title,
    status,
    sideA,
    sideB,
    startedDate: canonicalizeDateString(entry.startedDate),
    endedDate: status === "ended" ? canonicalizeDateString(entry.endedDate || entry.lastUpdatedDate) : "",
    lastUpdatedDate: canonicalizeDateString(entry.lastUpdatedDate || entry.startedDate),
    cause: normalizeTextLike(entry.cause),
    note: normalizeTextLike(entry.note),
    sourceEventIds,
    storylineIds,
    createdRound: Number.isFinite(Number(entry.createdRound)) && Number(entry.createdRound) > 0 ? Math.trunc(Number(entry.createdRound)) : 0,
    updatedRound: Number.isFinite(Number(entry.updatedRound)) && Number(entry.updatedRound) > 0 ? Math.trunc(Number(entry.updatedRound)) : 0,
  };
};

const normalizeWorldWars = (value) => {
  const deduped = new Map();
  normalizeArray(value).forEach((entry, index) => {
    const normalized = normalizeWorldWar(entry, index);
    if (!normalized) return;
    deduped.set(normalized.id, normalized);
  });
  const statusRank = { active: 0, ceasefire: 1, ended: 2 };
  return [...deduped.values()]
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      String(b.lastUpdatedDate || b.startedDate || "").localeCompare(String(a.lastUpdatedDate || a.startedDate || "")) ||
      a.id.localeCompare(b.id),
    )
    .slice(0, MAX_WORLD_WARS);
};

export const normalizeWorldState = (world) => {
  const nextWorld = world && typeof world === "object" ? world : {};
  const polityOverrides = Object.fromEntries(
    Object.entries(nextWorld.polityOverrides ?? {})
      .map(([key, value]) => [key, normalizePolityOverride(key, value)])
      .filter(([, value]) => value),
  );

  const regionOwnershipOverrides = Object.fromEntries(
    Object.entries(nextWorld.regionOwnershipOverrides ?? {})
      // Canonicalise on READ too, so a save written before this migrated still
      // resolves to the same owner identity as everything computed now.
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), toCountryName(normalizeOptionalString(ownerCode))])
      .filter(([regionId, ownerCode]) => regionId && ownerCode),
  );

  // old saves only had regionOwnershipOverrides. that's enough as a fallback
  // because a control flip anchors sovereignty BEFORE changing the controller.
  // do not persist controller === sovereign everywhere; that just bloats the save
  // with thousands of entries saying "yes, normal territory is still normal".
  const suppliedSovereignty = nextWorld.regionSovereigntyOverrides && typeof nextWorld.regionSovereigntyOverrides === "object"
    ? nextWorld.regionSovereigntyOverrides
    : null;
  const rawSovereignty = suppliedSovereignty && Object.keys(suppliedSovereignty).length > 0
    ? suppliedSovereignty
    : regionOwnershipOverrides;
  const regionSovereigntyOverrides = Object.fromEntries(
    Object.entries(rawSovereignty ?? {})
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), toCountryName(normalizeOptionalString(ownerCode))])
      .filter(([regionId, ownerCode]) => {
        if (!regionId || !ownerCode) return false;
        const controller = normalizeOptionalString(regionOwnershipOverrides[regionId]);
        return !controller || controller.toLowerCase() !== ownerCode.toLowerCase();
      }),
  );

  const regionClaimants = Object.fromEntries(
    Object.entries(nextWorld.regionClaimants ?? {})
      .map(([regionId, claimants]) => [
        normalizeOptionalString(regionId),
        [...new Set(normalizeArray(claimants)
          .map((name) => toCountryName(normalizeOptionalString(name)))
          .filter(Boolean))].slice(0, 4),
      ])
      .filter(([regionId, claimants]) => regionId && claimants.length),
  );

  const internationalReputation = Object.fromEntries(
    Object.entries(nextWorld.internationalReputation ?? {})
      .map(([polityCode, value]) => [normalizeOptionalString(polityCode), Number(value)])
      .filter(([polityCode, value]) => polityCode && Number.isFinite(value))
      .map(([polityCode, value]) => [polityCode, Math.max(0, Math.min(100, Math.round(value)))]),
  );

  // Keyed by country NAME, verbatim — same namespace as internationalReputation
  // above, polityOverrides and colors. This used to uppercase while its neighbours
  // did not, so one applyEventImpacts change.code landed under two different keys
  // (countryTags["RUSSIA"] but internationalReputation["Russia"]). Harmless while
  // owners were uppercase GADM codes; a silent desync the moment they are names.
  const countryTags = Object.fromEntries(
    Object.entries(nextWorld.countryTags ?? {})
      .map(([country, list]) => [normalizeOptionalString(country), normalizeTagList(list)])
      .filter(([country, list]) => country && list.length),
  );

  // Persisted per-country stat sheets. Normalize every record through the native
  // Stats compatibility boundary: legacy sheets remain readable, while v1 component
  // ledgers deterministically recompute population/GDP aggregates on every read.
  const countryStats = Object.fromEntries(
    Object.entries(nextWorld.countryStats ?? {})
      .map(([code, sheet]) => [normalizeOptionalString(code), normalizeCountryStatSheet(sheet)])
      .filter(([code, sheet]) => code && sheet && typeof sheet === "object"),
  );

  return {
    ...WORLD_DEFAULTS,
    ...nextWorld,
    countryTags,
    countryStats,
    actionSuggestions: normalizeActionSuggestions(nextWorld.actionSuggestions),
    activeCatalyst: normalizeCatalyst(nextWorld.activeCatalyst),
    consolidatedHistory: normalizeConsolidatedHistory(nextWorld.consolidatedHistory),
    internationalReputation,
    labelFont: normalizeOptionalString(nextWorld.labelFont),
    labelHaloColor: normalizeOptionalString(nextWorld.labelHaloColor),
    labelTextColor: normalizeOptionalString(nextWorld.labelTextColor),
    language: normalizeOptionalString(nextWorld.language) || WORLD_DEFAULTS.language,
    lastJumpMode: normalizeOptionalString(nextWorld.lastJumpMode),
    lastJumpSummary: normalizeOptionalString(nextWorld.lastJumpSummary),
    lastJumpTargetDate: normalizeOptionalString(nextWorld.lastJumpTargetDate),
    notes: normalizeOptionalString(nextWorld.notes),
    polityOverrides,
    regionClaimants,
    regionSovereigntyOverrides,
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
    markers: normalizeMarkers(nextWorld.markers),
    // Explicit (not via the ...WORLD_DEFAULTS spread) so this new field survives every
    // write path — the documented new-world-field trap.
    cityRenames: Object.fromEntries(
      Object.entries(nextWorld.cityRenames && typeof nextWorld.cityRenames === "object" ? nextWorld.cityRenames : {})
        .map(([key, value]) => [normalizeString(key).toLowerCase(), normalizeString(value)])
        .filter(([key, value]) => key && value),
    ),
    simulationRules: normalizeOptionalString(nextWorld.simulationRules),
    startingTimelineText: normalizeOptionalString(nextWorld.startingTimelineText),
    wars: normalizeWorldWars(nextWorld.wars),
    storylines: normalizeWorldStorylines(nextWorld.storylines),
    units: normalizeUnits(nextWorld.units),
  };
};

// Does a polity currently hold no territory? A stateless actor — a
// government-in-exile, a movement, or a person with no country of their own.
// Single source of truth for "landless", used by both the AI prompt
// (buildPlayerPolityRegionsText) and the UI flag resolvers: a landless polity
// with no flag of its own must NOT borrow the code-derived country flag (a
// "stateless person in Japan" is not Japan), so the flag shows neutral instead.
//
// The distinction that matters: owning a region via an override = has land; but
// a scenario that ships NO override list at all means the polity owns its country
// through the base map tiles (a stock modern map), which is NOT landless.
export const isPolityLandless = (world, code) => {
  const polityCode = normalizeString(code);
  if (!polityCode) return false;
  const normalized = normalizeWorldState(world);
  const entries = Object.entries(normalized.regionOwnershipOverrides);
  const owns = entries.some(
    ([, ownerCode]) => normalizeString(ownerCode).toLowerCase() === polityCode.toLowerCase(),
  );
  if (owns) return false;
  const isKnownPolity = Boolean(normalized.polityOverrides?.[polityCode]);
  // No override list AND not a declared polity = stock map, owns via base tiles.
  if (entries.length === 0 && !isKnownPolity) return false;
  return true;
};

// Recover a Gregorian date stored in a loose format back to strict YYYY-MM-DD.
// Older builds wrote the model's stopDate verbatim, so real saves hold values
// like "2016-12-31T00:00:00.000Z" or "December 31, 2016" — the header displays
// them fine, but date math (addIsoDays) rejects them, so every jump silently
// computes target == origin and the game clock freezes forever while the model
// re-simulates the past. Deliberately non-Gregorian scenario dates ("1200 BCE")
// don't parse and pass through untouched.
const canonicalizeDateString = (value) => {
  const text = normalizeOptionalString(value);
  if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // An ISO date prefix (datetime forms) is authoritative — slicing it avoids
  // the timezone day-shift of parsing "...T00:00:00Z" into local time.
  const prefix = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(text);
  if (prefix) return prefix[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    if (year >= 1 && year <= 9999) {
      return `${String(year).padStart(4, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
  }
  return text;
};

export const normalizeGameData = (game) => {
  const nextGame = game && typeof game === "object" ? game : {};

  return {
    ...GAME_DEFAULTS,
    ...nextGame,
    country: normalizeOptionalString(nextGame.country),
    difficulty: normalizeOptionalString(nextGame.difficulty) || GAME_DEFAULTS.difficulty,
    gameDate: canonicalizeDateString(nextGame.gameDate),
    language: normalizeOptionalString(nextGame.language) || GAME_DEFAULTS.language,
    round:
      Number.isFinite(Number(nextGame.round)) && Number(nextGame.round) > 0
        ? Math.trunc(Number(nextGame.round))
        : GAME_DEFAULTS.round,
    startDate: canonicalizeDateString(nextGame.startDate),
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
  // Choke-point safety net: no writer can persist a log that already contains
  // exact-duplicate events (the AI restating its own timeline). See eventDedup.js.
  const normalized = dedupeEventLog(normalizeEvents(events));
  // New/edited event text follows the UI language immediately (see above).
  enqueueContentStrings(normalized);
  return writeJson(JSON_URLS.events, normalized, { pretty: true, ...options });
};

export const readChatsState = async ({ force = false, world = null, playerCountry = "" } = {}) => {
  const chats = normalizeChats(await readJson(JSON_URLS.chat, { defaultValue: [], force }));
  if (!world) return chats;
  return playerCountry
    ? reconcileChatsForPlayer(chats, world, playerCountry)
    : reconcileChatsForWorld(chats, world);
};

// All chat writers share one queue. The UI can emit a player-message save followed
// milliseconds later by an NPC-reply save; without serialization the older request
// can finish last and overwrite the newer history. Serializing at the storage choke
// point preserves call order for EVERY writer, not just the React panel.
let chatWriteQueue = Promise.resolve();

export const writeChatsState = (chats, { world = null, playerCountry = "", ...options } = {}) => {
  const normalized = world
    ? (playerCountry
      ? reconcileChatsForPlayer(chats, world, playerCountry)
      : reconcileChatsForWorld(chats, world))
    : normalizeChats(chats);
  const snapshot = cloneValue(normalized);

  const write = () => writeJson(JSON_URLS.chat, snapshot, { pretty: true, ...options });
  const pending = chatWriteQueue.then(write, write);
  chatWriteQueue = pending.then(() => undefined, () => undefined);
  return pending;
};

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
    chats: reconcileChatsForPlayer(chats, world, game.country),
    events,
    game,
    world,
  };
};

const normalizedPolityName = (value) =>
  normalizeString(value).toLowerCase();

const findPolityOverrideEntry = (world, polityName) => {
  const target = normalizedPolityName(polityName);
  if (!target) return null;

  return Object.entries(world?.polityOverrides || {})
    .find(([key, record]) => {
      const names = [
        key,
        record?.code,
        record?.name,
        ...normalizeArray(record?.aliases),
      ]
        .map(normalizedPolityName)
        .filter(Boolean);

      return names.includes(target);
    }) || null;
};

const polityOwnsMappedOverride = (world, polityName) => {
  const target = normalizedPolityName(polityName);
  if (!target) return false;

  return [
    ...Object.values(world?.regionOwnershipOverrides || {}),
    ...Object.values(world?.regionSovereigntyOverrides || {}),
  ].some(
    (owner) =>
      normalizedPolityName(owner) === target,
  );
};

const mergePolityMetadata = ({ change, current = {}, canonicalName }) => ({
  ...current,
  aliases: [
    ...new Set([
      ...normalizeArray(current.aliases),
      ...normalizeArray(change.aliases),
      canonicalName,
      current.name,
      change.name,
    ]
      .map(normalizeOptionalString)
      .filter(Boolean)),
  ],
  code: canonicalName,
  ...(change.color ? { color: change.color } : {}),
  ...(change.name ? { name: change.name } : {}),
  ...(change.note ? { note: change.note } : {}),
});

// Public native mutation seam used by normal simulation today and intended for
// the expanded GM/editor later. All writers go through the same compatibility +
// deterministic aggregation path instead of directly editing UI-shaped fields.
export const applyCountryStatPatchToWorld = (world, canonicalName, patch, options = {}) => {
  if (!world || typeof world !== "object" || !canonicalName) return null;
  if (!world.countryStats || typeof world.countryStats !== "object") world.countryStats = {};

  const next = mergeCountryStatPatch(world.countryStats[canonicalName], patch, options);
  if (next && typeof next === "object") world.countryStats[canonicalName] = next;
  return next;
};

const applyPolityMetadataStores = (world, change, canonicalName) => {
  if (Number.isFinite(change.reputation)) {
    world.internationalReputation[canonicalName] = change.reputation;

    if (world.countryStats?.[canonicalName]) {
      applyCountryStatPatchToWorld(world, canonicalName, {
        indices: { internationalReputation: change.reputation },
      });
    }
  }

  if (change.stats && typeof change.stats === "object") {
    const merged = applyCountryStatPatchToWorld(world, canonicalName, change.stats);

    const rep = Number(
      merged?.indices?.internationalReputation,
    );

    if (Number.isFinite(rep)) {
      world.internationalReputation[canonicalName] =
        Math.max(0, Math.min(100, Math.round(rep)));
    }
  }

  if (Array.isArray(change.tags)) {
    if (!world.countryTags || typeof world.countryTags !== "object") {
      world.countryTags = {};
    }

    if (change.tags.length) {
      world.countryTags[canonicalName] = change.tags;
    } else {
      delete world.countryTags[canonicalName];
    }
  }
};

const applyPolityColor = (colors, change, canonicalName) => {
  if (!change.color) return;

  const normalizedColor = normalizeOptionalString(change.color);
  const hexMatch = /^#?([a-f0-9]{6})$/i.exec(normalizedColor);
  if (!hexMatch) return;

  const hex = hexMatch[1];
  colors[canonicalName] = [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

const applyPolityChangeToWorld = ({ change, colors, phase, world }) => {
  const operation = change.operation || "update";

  if (operation === "dissolve" && phase !== "post") return null;
  if (operation !== "dissolve" && phase === "post") return null;

  if (operation === "create") {
    // Exact existing names/aliases are collisions. A bare stock/base name is also
    // blocked when it already maps cleanly onto one active regime identity (the
    // Greece -> Kingdom of Greece case). More specific new names remain creatable.
    let collision = resolvePolityIdentity(
      change.code,
      world,
      {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: false,
        allowStockBase: true,
      },
    );

    if (!collision.resolved && isStockPolityName(change.code)) {
      collision = resolvePolityIdentity(
        change.code,
        world,
        {
          allowUnknown: false,
          requireActive: true,
          allowCoreMatch: true,
          allowStockBase: true,
        },
      );
    }

    if (collision.resolved) {
      console.warn(
        `[polity lifecycle] create ignored: "${change.code}" already resolves to ` +
        `"${collision.resolved}" (${collision.status}).`,
      );
      return null;
    }

    const canonicalName = toCountryName(change.code);
    if (!canonicalName) return null;

    world.polityOverrides[canonicalName] = {
      ...mergePolityMetadata({
        change,
        current: {},
        canonicalName,
      }),
      name: change.name || canonicalName,
      status: "active",
    };

    applyPolityMetadataStores(world, change, canonicalName);
    applyPolityColor(colors, change, canonicalName);

    console.info(`[polity lifecycle] created "${canonicalName}".`);
    return canonicalName;
  }

  if (operation === "restore") {
    // Exact historical identity if known; otherwise explicit RESTORE is enough to
    // create it. no global encyclopedia of every regime needs to live in each save.
    let target = resolvePolityIdentity(
      change.code,
      world,
      {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: false,
        allowStockBase: true,
      },
    );

    if (!target.resolved && isStockPolityName(change.code)) {
      target = resolvePolityIdentity(
        change.code,
        world,
        {
          allowUnknown: false,
          requireActive: true,
          allowCoreMatch: true,
          allowStockBase: true,
        },
      );
    }

    const canonicalName = target.resolved || toCountryName(change.code);
    if (!canonicalName) return null;

    const found = findPolityOverrideEntry(world, canonicalName);
    const current = found?.[1] || {};

    world.polityOverrides[canonicalName] = {
      ...mergePolityMetadata({
        change,
        current,
        canonicalName,
      }),
      name: change.name || current.name || canonicalName,
      status: "active",
    };

    applyPolityMetadataStores(world, change, canonicalName);
    applyPolityColor(colors, change, canonicalName);

    console.info(`[polity lifecycle] restored "${canonicalName}" as a current polity.`);
    return canonicalName;
  }

  if (operation === "rename") {
    const source = resolvePolityIdentity(
      change.code,
      world,
      {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: true,
        allowStockBase: true,
      },
    );

    const newName = normalizeOptionalString(change.name);

    if (!source.resolved || !newName) {
      console.warn(
        `[polity lifecycle] rename ignored: source="${change.code}" target="${change.name}" could not be resolved.`,
        source,
      );
      return null;
    }

    const collision = resolvePolityIdentity(
      newName,
      world,
      {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: false,
        allowStockBase: false,
      },
    );

    if (
      collision.resolved &&
      normalizedPolityName(collision.resolved) !== normalizedPolityName(source.resolved)
    ) {
      console.warn(
        `[polity lifecycle] rename ignored: target "${newName}" already belongs to ` +
        `"${collision.resolved}".`,
      );
      return null;
    }

    const found = findPolityOverrideEntry(world, source.resolved);
    const current = found?.[1] || {
      aliases: [],
      code: source.resolved,
      color: "",
      name: source.resolved,
      note: "",
    };

    world.polityOverrides[source.resolved] = {
      ...mergePolityMetadata({
        change: { ...change, name: newName },
        current,
        canonicalName: source.resolved,
      }),
      aliases: [
        ...new Set([
          ...normalizeArray(current.aliases),
          ...normalizeArray(change.aliases),
          source.resolved,
          current.name,
          newName,
        ]
          .map(normalizeOptionalString)
          .filter(Boolean)),
      ],
      code: source.resolved,
      name: newName,
      status: "active",
    };

    applyPolityMetadataStores(world, change, source.resolved);
    applyPolityColor(colors, change, source.resolved);

    console.info(
      `[polity lifecycle] renamed "${source.resolved}" display/current identity to "${newName}" ` +
      "without changing its stable campaign key.",
    );
    return source.resolved;
  }

  if (operation === "dissolve") {
    const source = resolvePolityIdentity(
      change.code,
      world,
      {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: true,
        allowStockBase: true,
      },
    );

    if (!source.resolved) {
      console.warn(
        `[polity lifecycle] dissolve ignored: "${change.code}" is not an established polity.`,
        source,
      );
      return null;
    }

    // Refuse dissolution while the polity still appears as either de-facto
    // controller OR legal sovereign in mapped runtime state. Occupation alone is
    // not a magic delete-country button; sovereignty must be settled separately.
    if (polityOwnsMappedOverride(world, source.resolved)) {
      console.warn(
        `[polity lifecycle] refusing to dissolve "${source.resolved}": it still owns mapped override territory. ` +
        "transfer/settle that territory in the same event first.",
      );
      return null;
    }

    const found = findPolityOverrideEntry(world, source.resolved);
    if (found) delete world.polityOverrides[found[0]];

    for (const field of ["countryStats", "countryTags", "internationalReputation"]) {
      const store = world[field];
      if (!store || typeof store !== "object" || Array.isArray(store)) continue;
      delete store[source.resolved];
    }

    delete colors[source.resolved];

    console.info(`[polity lifecycle] dissolved "${source.resolved}".`);
    return source.resolved;
  }

  // ordinary update: NEVER create an unknown identity. this is the safety wall
  // between a typo/stale base name and a brand-new country.
  const target = resolvePolityIdentity(
    change.code,
    world,
    {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    },
  );

  if (!target.resolved) {
    console.warn(
      `[polity lifecycle] update ignored: "${change.code}" could not safely resolve to an established polity. ` +
      "Use operation=create/restore only when the event explicitly establishes a new/current state.",
      target,
    );
    return null;
  }

  const found = findPolityOverrideEntry(world, target.resolved);
  const current = found?.[1] || {
    aliases: [],
    code: target.resolved,
    color: "",
    name: target.resolved,
    note: "",
  };

  world.polityOverrides[target.resolved] = mergePolityMetadata({
    change,
    current,
    canonicalName: target.resolved,
  });

  applyPolityMetadataStores(world, change, target.resolved);
  applyPolityColor(colors, change, target.resolved);

  return target.resolved;
};

const samePolity = (a, b) =>
  normalizeString(a).toLowerCase() === normalizeString(b).toLowerCase();

const resolveTerritorialNameForWorld = (token, world) => {
  const raw = toCountryName(normalizeOptionalString(token));
  if (!raw) return "";
  const resolution = resolveTerritorialPolityIdentity(raw, world);
  return resolution.resolved || "";
};

const writeClaimants = (world, regionId, values) => {
  const deduped = [...new Set(normalizeArray(values)
    .map((name) => resolveTerritorialNameForWorld(name, world) || toCountryName(normalizeOptionalString(name)))
    .filter(Boolean))]
    .slice(0, 4);

  if (deduped.length > 0) world.regionClaimants[regionId] = deduped;
  else delete world.regionClaimants[regionId];
};

const ensureSovereigntyAnchor = (world, regionId, fallbackOwner) => {
  if (world.regionSovereigntyOverrides[regionId]) return world.regionSovereigntyOverrides[regionId];
  const resolved = resolveTerritorialNameForWorld(fallbackOwner, world);
  if (resolved) world.regionSovereigntyOverrides[regionId] = resolved;
  return resolved;
};

const applyLegalRegionTransfer = (world, transfer) => {
  const toCode = resolveTerritorialNameForWorld(transfer.toCode, world);
  if (!toCode) {
    console.warn(
      `[polity identity] legal region transfer "${transfer.regionId}" could not safely resolve ` +
      `"${transfer.toCode}" — sovereignty change ignored.`,
    );
    return;
  }

  const fromCode = resolveTerritorialNameForWorld(transfer.fromCode, world);
  const previousSovereign = ensureSovereigntyAnchor(world, transfer.regionId, fromCode);
  const currentController =
    resolveTerritorialNameForWorld(world.regionOwnershipOverrides[transfer.regionId], world) ||
    fromCode ||
    previousSovereign;

  world.regionSovereigntyOverrides[transfer.regionId] = toCode;

  // A legal hand-over normally moves administration too when the old sovereign
  // still holds the ground. A genuine third-party occupier is preserved.
  if (!currentController || samePolity(currentController, previousSovereign) || samePolity(currentController, toCode)) {
    world.regionOwnershipOverrides[transfer.regionId] = toCode;
  }

  const effectiveController =
    resolveTerritorialNameForWorld(world.regionOwnershipOverrides[transfer.regionId], world) ||
    toCode;
  const existing = normalizeArray(world.regionClaimants[transfer.regionId]);
  let claimants = existing.filter((name) => !samePolity(name, toCode) && !samePolity(name, previousSovereign));

  // If somebody else still physically controls the region after the legal title
  // changes, the lawful sovereign remains visibly present as a claimant.
  if (!samePolity(effectiveController, toCode)) claimants.push(toCode);
  writeClaimants(world, transfer.regionId, claimants);
};

const applyRegionControlOpToWorld = (world, rawOp) => {
  const op = normalizeRegionControlOp(rawOp);
  if (!op) return;

  const regionId = op.regionId;
  const currentController =
    resolveTerritorialNameForWorld(world.regionOwnershipOverrides[regionId], world) ||
    resolveTerritorialNameForWorld(op.fromCode, world);
  const legalSovereign = ensureSovereigntyAnchor(world, regionId, op.fromCode || currentController);
  const existing = normalizeArray(world.regionClaimants[regionId]);

  if (op.op === "contest") {
    const actor = resolveTerritorialNameForWorld(op.actorCode, world);
    if (!actor || samePolity(actor, currentController)) return;
    const claimants = [...existing, actor];
    if (legalSovereign && currentController && !samePolity(legalSovereign, currentController)) claimants.push(legalSovereign);
    writeClaimants(world, regionId, claimants.filter((name) => !samePolity(name, currentController)));
    return;
  }

  if (op.op === "control") {
    const toCode = resolveTerritorialNameForWorld(op.toCode, world);
    if (!toCode) return;
    const previousController = currentController || resolveTerritorialNameForWorld(op.fromCode, world);
    world.regionOwnershipOverrides[regionId] = toCode;

    const claimants = existing.filter((name) => !samePolity(name, toCode));
    if (previousController && !samePolity(previousController, toCode)) claimants.push(previousController);
    if (legalSovereign && !samePolity(legalSovereign, toCode)) claimants.push(legalSovereign);
    writeClaimants(world, regionId, claimants);
    return;
  }

  if (op.op === "clear_contest") {
    let claimants = op.clearAll
      ? []
      : existing.filter((name) => !samePolity(name, op.claimantCode));

    // Clearing a battlefield dispute must not erase the legal sovereign while a
    // foreign controller still occupies the region. That stripe is the whole point.
    const controller =
      resolveTerritorialNameForWorld(world.regionOwnershipOverrides[regionId], world) ||
      currentController;
    if (legalSovereign && controller && !samePolity(legalSovereign, controller)) claimants.push(legalSovereign);
    writeClaimants(world, regionId, claimants.filter((name) => !samePolity(name, controller)));
  }
};

export const applyEventImpactsToWorld = ({ colors = {}, events = [], game = {}, world }) => {
  const nextColors = cloneValue(colors) ?? {};
  const nextWorld = normalizeWorldState(world);

  for (const event of normalizeEvents(events)) {
    // create/restore/rename/update first. a newborn or restored polity therefore
    // exists before THIS SAME EVENT's territory is resolved — a lesson already
    // proven by the old devtools territory engine.
    for (const change of event.impacts.polityChanges) {
      applyPolityChangeToWorld({
        change,
        colors: nextColors,
        phase: "pre",
        world: nextWorld,
      });
    }

    // regionTransfers now mean LEGAL SOVEREIGNTY. Wartime occupation/control is
    // regionControlOps and leaves the legal ledger intact.
    for (const transfer of event.impacts.regionTransfers) {
      applyLegalRegionTransfer(nextWorld, transfer);
    }

    for (const controlOp of event.impacts.regionControlOps ?? []) {
      applyRegionControlOpToWorld(nextWorld, controlOp);
    }

    // dissolution comes last so the same event can settle/transfer the polity's
    // remaining territory before we decide whether it is actually gone.
    for (const change of event.impacts.polityChanges) {
      applyPolityChangeToWorld({
        change,
        colors: nextColors,
        phase: "post",
        world: nextWorld,
      });
    }

    if (event.impacts.unitOps?.length) {
      nextWorld.units = applyUnitOps(nextWorld.units, event.impacts.unitOps, {
        gameDate: event.date || game.gameDate || game.startDate || "",
        combatSeed: event.id || event.title || event.date || "event",
      });
    }

    if (event.impacts.markerOps?.length) {
      const before = normalizeMarkers(nextWorld.markers);
      nextWorld.markers = applyMarkerOps(nextWorld.markers, event.impacts.markerOps);
      // A rename that matched no existing structure is a STOCK-map city rename (stock
      // cities live in PMTiles, not world.markers) — record it as an override layer so
      // the label layer can show the new name (see Cities.jsx / cityRenames).
      for (const raw of normalizeArray(event.impacts.markerOps)) {
        const op = normalizeMarkerOp(raw);
        if (!op || op.op !== "rename" || !op.name) continue;
        const matched = before.some((m) =>
          op.markerId ? m.id === op.markerId : m.name.toLowerCase() === op.name.toLowerCase());
        if (!matched) {
          nextWorld.cityRenames = { ...(nextWorld.cityRenames || {}), [op.name.toLowerCase()]: op.newName };
        }
      }
    }
  }

  return {
    colors: nextColors,
    world: nextWorld,
  };
};
