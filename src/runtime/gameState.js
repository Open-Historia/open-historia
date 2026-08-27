/*! Open Historia — portions (troop deployments + era troop types) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { JSON_URLS, readJson, writeJson } from "./assets.js";
import { enqueueContentStrings } from "./translator.js";
import { normalizeTagList } from "./countryTags.js";
import { advanceRecurringDate, normalizeMilestoneRepeat } from "./projects.js";
import { dedupeEventLog } from "./eventDedup.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";
import {
  DEFAULT_PATROL_RADIUS_KM,
  daysBetweenDates,
  haversineKm,
  maxTravelKm,
  patrolPoint,
  stepToward,
} from "./unitMotion.js";

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
  // Bumped by every idle world pulse (see gameplay.js). It is the third component
  // of a patrolling unit's position seed, which is what lets a fleet on station
  // visibly reposition between pulses even though no game time has passed. Listed
  // in the normalizeWorldState return too — this spread is overwritten by the
  // incoming world, so a field declared only here never survives a round trip.
  idlePulseTick: 0,
  notes: "",
  // Standing multi-turn orders the ENGINE advances: {id, unitId, kind, toLng,
  // toLat, radiusKm, untilRound, targetId, targetLabel, note, issuedAt,
  // issuedRound}. kind is "move" (travel to a destination) or "patrol" (work a
  // station centred on it). Independent of the actions queue (which a jump's
  // single clearActions flag wipes wholesale), so a unit ordered across an ocean
  // keeps advancing every turn until it arrives — see advanceStandingOrders and
  // pruneSatisfiedUnitOrders below.
  pendingUnitOrders: [],
  polityOverrides: {},
  // Long-running efforts the player is pursuing or has learned of: research
  // programmes, construction projects, military and political operations. Only
  // the AI writes these -- events via impacts.projectOps, the advisor via its
  // ```projects block -- because a hand-editable board would drift out of step
  // with the narrative that is supposed to be driving it. Listed in the
  // normalizeWorldState return too: this spread is overwritten by the incoming
  // world, so a field declared only here never survives a round trip.
  projects: [],
  // Region id -> claimant polity names: the world-data way to mark a region
  // DISPUTED (striped in the administrator's + claimants' colors). Same effect
  // as a claimants list on the region's geojson feature, but declarable by a
  // scenario whose geometry ships as an immutable seed (the modern world), and
  // overridable per-world without touching geometry. Wins over feature props.
  regionClaimants: {},
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
// What a formation is DOING, as distinct from `status`, which is its lifecycle.
// Posture is what makes the map readable at a glance — "massing" on a border and
// "exercise" on the same border are the same counter and a completely different
// message. Deliberately NOT "garrison": that would collide with the unit TYPE of
// the same name and make `posture === "garrison"` checks ambiguous.
export const UNIT_POSTURES = [
  "holding",
  "massing",
  "patrol",
  "transit",
  "exercise",
  "blockade",
  "withdrawing",
];
const UNIT_POSTURE_SET = new Set(UNIT_POSTURES);

// Units the map may hold for A.I. polities. The player's own forces are exempt
// from both caps and are filtered out before counting (see enforceUnitVolume) —
// they can disband their own, so neither cap should apply to them nor should
// their units eat another power's headroom.
export const MAX_UNITS_GLOBAL = 80;
export const MAX_UNITS_PER_POLITY = 12;

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

// Strength is a PERCENTAGE of the formation's established strength, 0-100.
//
// It used to be an abstract 1-1000 the model picked freely, which is exactly why
// it read as random: nothing anchored it, so "340" meant whatever the model felt
// that turn. As a percentage it has a fixed referent — 78 means three quarters of
// what this formation should have — and `composition` carries what it actually is
// ("1 aircraft carrier, 2 frigates"). Attrition finally means something.
//
// Saves on the old scale are coerced rather than migrated: anything over 100 is
// divided by 10. The old default of 100 lands on 100%, which is the correct
// reading of a freshly-raised unit anyway.
export const clampUnitStrength = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  const percent = num > 100 ? num / 10 : num;
  return Math.max(0, Math.min(100, Math.round(percent)));
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
    // The standing multi-turn order (world.pendingUnitOrders) this move/attack
    // created, if any — so deleting the queued action also cancels the order
    // instead of leaving an orphaned "keep advancing this unit" entry behind.
    ...(normalizeOptionalString(value.pendingOrderId) ? { pendingOrderId: normalizeOptionalString(value.pendingOrderId) } : {}),
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
  };
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

  return {
    aliases: normalizeActionParticipants(entry.aliases || entry.additionalNames),
    code,
    color: normalizeOptionalString(entry.color),
    name: normalizeOptionalString(entry.name || entry.newName),
    note: normalizeOptionalString(entry.note || entry.reason),
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
  const posture = normalizeOptionalString(entry.posture).toLowerCase();
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
    // What the formation is made of, in words — "1 aircraft carrier, 2 frigates".
    // Together with `note` this is what turns a coloured dot into something the
    // player can actually reason about.
    composition: normalizeOptionalString(entry.composition),
    // One present-tense sentence: "Patrolling the North Atlantic approaches".
    note: normalizeOptionalString(entry.note),
    // Intent, not lifecycle. Unknown values fall back to "" rather than a default,
    // so an absent posture stays absent instead of asserting something untrue.
    posture: UNIT_POSTURE_SET.has(posture) ? posture : "",
    // "No confirmed line of support" — a covert insertion OR a presence the player
    // has only just detected. Engine-assigned (see applyUnitOpBatch); never taken
    // from the model, or it would claim covert whenever convenient.
    covert: entry.covert === true,
    // The event that created or last moved this unit, so the popup can say what
    // put it there and click through to it.
    eventId: normalizeOptionalString(entry.eventId),
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

// Great-circle distance in km. The implementation now lives in unitMotion.js —
// which is import-free, so its tests run without a full install — and is
// re-exported here because promptContext.js and the order pruning below have
// always imported it from this module. There used to be two copies of this
// function (here and unitCombat.js's `distanceKm`); now there is one.
export { haversineKm };

const PENDING_ORDER_KIND_SET = new Set(["move", "patrol"]);

// A standing multi-turn order the engine advances every turn: "move" travels to
// a destination, "patrol" works a station centred on it. Independent of the
// actions queue. See applyUnitOpBatch (mints them), advanceStandingOrders
// (advances them) and pruneSatisfiedUnitOrders (clears them once satisfied).
const normalizePendingUnitOrderEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") return null;
  const unitId = normalizeOptionalString(entry.unitId);
  const toLng = finiteOrNull(entry.toLng);
  const toLat = finiteOrNull(entry.toLat);
  if (!unitId || toLng === null || toLat === null) return null;
  const rawKind = normalizeOptionalString(entry.kind).toLowerCase();
  // Saves from before player-issued attacks were removed carry kind "attack".
  // Coerce rather than drop: the destination and targetLabel are still good, so
  // the unit simply keeps advancing on the same objective and the AI narrates
  // what happens when it gets there — which is how combat always resolved anyway.
  const kind = rawKind === "attack" ? "move" : rawKind;
  const numberOr = (value, fallback) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;

  return {
    id: normalizeOptionalString(entry.id) || generateId(`unitorder-${index}`),
    unitId,
    kind: PENDING_ORDER_KIND_SET.has(kind) ? kind : "move",
    toLng,
    toLat,
    // Station radius for a patrol order; 0 (and meaningless) for a move order.
    radiusKm: Math.min(2000, numberOr(entry.radiusKm, 0)),
    // Round after which the order lapses; 0 means it never does. Patrols get a
    // finite life so a fleet does not circle the same station forever.
    untilRound: numberOr(entry.untilRound, 0),
    targetId: normalizeOptionalString(entry.targetId),
    targetLabel: normalizeOptionalString(entry.targetLabel),
    note: normalizeOptionalString(entry.note),
    issuedAt: normalizeOptionalString(entry.issuedAt),
    issuedRound: numberOr(entry.issuedRound, 0),
  };
};

export const normalizePendingUnitOrders = (orders) =>
  normalizeArray(orders)
    .map((entry, index) => normalizePendingUnitOrderEntry(entry, index))
    .filter(Boolean);

// A unit is considered to have arrived once it's within this of its ordered
// destination — roughly a garrison's engagement range, "close enough that the
// order has plainly been carried out" rather than an exact coordinate match,
// which the AI's own incremental moves would rarely land on precisely.
const PENDING_ORDER_ARRIVAL_KM = 60;

// Drop any order whose unit no longer exists (destroyed/removed) or has
// arrived (within PENDING_ORDER_ARRIVAL_KM of its destination). Runs on every
// normalizeWorldState call — every read AND every write — so an order clears
// itself the moment a move actually lands it, with no separate cleanup call
// needed anywhere else, and player deletes of stale units never leave orphans.
export const pruneSatisfiedUnitOrders = (units, orders) => {
  const byId = new Map(normalizeArray(units).map((unit) => [unit.id, unit]));
  return normalizeArray(orders).filter((order) => {
    const unit = byId.get(order.unitId);
    if (!unit) return false;
    // A patrol order is never "satisfied" by proximity — its destination IS the
    // station the unit is meant to be sitting on, so the arrival test below would
    // delete every patrol the instant it was created. It ends by expiry
    // (untilRound, in advanceStandingOrders) or when its unit goes away.
    if (order.kind === "patrol") return true;
    return haversineKm(unit.lat, unit.lng, order.toLat, order.toLng) > PENDING_ORDER_ARRIVAL_KM;
  });
};

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

// Projects & Operations: the long-running efforts board (world.projects[]).
//
// A project is anything that spans rounds and has a state worth tracking — a
// research programme, a shipbuilding project, a covert operation, a diplomatic
// campaign. It is deliberately NOT the actions queue: an action is one thing the
// player does this round and a jump resolves it, while a project persists across
// many rounds and accumulates milestones.
//
// Enums are closed where the UI switches on the value and open where the
// vocabulary is a judgement call the model makes every turn. `status` is closed
// because the panel colour-codes it; `tags` is wide open (normalizeTagList, the
// same rule country tags use) because "which categories exist" is exactly the
// thing the AI should be free to invent per campaign.
export const PROJECT_STATUSES = [
  "proposed",
  "active",
  "stalled",
  "paused",
  "complete",
  "failed",
  "cancelled",
];
const PROJECT_STATUS_SET = new Set(PROJECT_STATUSES);
// Statuses that are still running: they can go overdue and belong on the default
// board view. Exported because the panel and the derived-flag helpers both need
// the same answer, and two copies of this list would drift apart.
export const PROJECT_OPEN_STATUSES = new Set(["proposed", "active", "stalled", "paused"]);
const PROJECT_KIND_SET = new Set(["project", "operation"]);
const PROJECT_SECRECY_SET = new Set(["public", "restricted", "covert"]);
const PROJECT_MILESTONE_STATUS_SET = new Set(["pending", "done", "missed"]);

// Synonyms a model actually writes for these, mapped onto the closed vocabulary.
// Observed in the field: a real backfill came back with "status":"completed" on
// a finished operation, which fell through to the "active" default and put a
// concluded op back on the running board. The op-name aliases above exist for
// the same reason; the values need them just as much as the verbs do.
const PROJECT_STATUS_ALIASES = {
  completed: "complete", finished: "complete", done: "complete", delivered: "complete",
  canceled: "cancelled", abandoned: "cancelled", dropped: "cancelled", shelved: "cancelled",
  ongoing: "active", "in progress": "active", inprogress: "active", running: "active", underway: "active",
  planned: "proposed", proposal: "proposed", pending: "proposed",
  suspended: "paused", halted: "paused", onhold: "paused", "on hold": "paused",
  blocked: "stalled", delayed: "stalled", stalling: "stalled",
};

const resolveProjectStatus = (value) => {
  const raw = normalizeOptionalString(value).toLowerCase();
  if (PROJECT_STATUS_SET.has(raw)) return raw;
  return PROJECT_STATUS_ALIASES[raw] || "active";
};

// world.json is force-re-read every 5 seconds by TWO pollers (useWorldState and
// unitsController), so everything riding inside it is on a bandwidth budget.
//
// Sized against a real campaign rather than guessed: a forty-round game came back
// with 44 live projects, and one project measures ~1 KB (milestones are 39% of
// that, hence their own tighter cap). 120 leaves that campaign roughly 2.5x of
// headroom for ~120 KB worst case, against a world.json whose startingTimelineText
// and consolidatedHistory are already ~105 KB each. If a board ever genuinely
// needs more than this, the answer is not a bigger number — it is moving projects
// out to their own runtime asset, which is a real piece of work because rollback
// snapshots and the staged event reveal both get world.projects for free today.
const MAX_PROJECTS = 120;
const MAX_PROJECT_MILESTONES = 8;
const MAX_PROJECT_EVENT_IDS = 12;

const normalizeProjectMilestone = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    // A bare string is a title. Models reach for that shorthand constantly, and
    // an undated milestone still tells the player what comes next.
    if (typeof entry !== "string") return null;
    const title = normalizeString(entry);
    return title
      ? { id: generateId(`milestone-${index}`), title, date: "", status: "pending", note: "" }
      : null;
  }

  const title = normalizeOptionalString(entry.title || entry.name || entry.label);
  if (!title) return null;

  const status = normalizeOptionalString(entry.status).toLowerCase();
  const completedCount = Number(entry.completedCount);
  return {
    id: normalizeOptionalString(entry.id) || generateId(`milestone-${index}`),
    title,
    date: canonicalizeDateString(entry.date || entry.due || entry.targetDate),
    status: PROJECT_MILESTONE_STATUS_SET.has(status) ? status : "pending",
    note: normalizeOptionalString(entry.note || entry.description),
    // A standing commitment that comes round again — an annual drill, a
    // quarterly review. Marking one done rolls it to its next occurrence rather
    // than retiring it (see applyProjectOps), so the board keeps showing when
    // the next one falls due instead of going blank.
    repeat: normalizeMilestoneRepeat(entry.repeat || entry.recurrence || entry.cadence),
    completedCount: Number.isFinite(completedCount) && completedCount > 0 ? Math.trunc(completedCount) : 0,
    lastCompletedAt: canonicalizeDateString(entry.lastCompletedAt),
  };
};

const normalizeProjectMilestones = (list) =>
  normalizeArray(list)
    .map((entry, index) => normalizeProjectMilestone(entry, index))
    .filter(Boolean)
    .slice(0, MAX_PROJECT_MILESTONES);

// The soonest milestone still outstanding. Derived rather than trusted: the model
// is given both a milestone list and a nextMilestone field, and the two drift the
// moment it marks one done without restating the other. The list wins where there
// is one; the stored value is a fallback for a project that carries no list.
const deriveNextMilestoneFrom = (milestones, stored) => {
  const pending = normalizeArray(milestones).filter((entry) => entry.status === "pending");
  if (pending.length > 0) {
    // Dated milestones first, earliest wins. An undated one is a "next, whenever"
    // and only surfaces when nothing dated is outstanding.
    const dated = pending.filter((entry) => entry.date).sort((a, b) => a.date.localeCompare(b.date));
    const next = dated[0] || pending[0];
    // Carries the recurrence through, so the card can mark it ↻ and show the
    // tally. projects.js has the same derivation for the live view; if you add a
    // field to one, add it to the other — the panel reads whichever is present.
    return {
      title: next.title,
      date: next.date,
      note: next.note,
      repeat: next.repeat || "",
      completedCount: Number(next.completedCount) || 0,
    };
  }

  if (!stored || typeof stored !== "object") return null;
  const title = normalizeOptionalString(stored.title || stored.name);
  if (!title) return null;
  return {
    title,
    date: canonicalizeDateString(stored.date || stored.due),
    note: normalizeOptionalString(stored.note || stored.description),
  };
};

const normalizeProjectCoords = (value) => {
  if (!value || typeof value !== "object") return null;
  const lng = finiteOrNull(value.lng ?? value.lon ?? value.longitude);
  const lat = finiteOrNull(value.lat ?? value.latitude);
  // 0,0 is open ocean off Africa — the coordinate a model emits when it does not
  // actually know where something is. Same guard normalizeMarkerEntry uses.
  if (lng === null || lat === null || (lng === 0 && lat === 0)) return null;
  return { lng, lat };
};

const normalizeIdList = (value, limit) =>
  normalizeArray(value)
    .map((entry) => normalizeOptionalString(entry))
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, limit);

export const normalizeProjectEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") return null;

  // The name IS the identity here, exactly as it is for markers and polities: it
  // is what the player reads, what the advisor says out loud, and what an op
  // targets when it does not know the id. A nameless project is unaddressable.
  const name = normalizeOptionalString(entry.name || entry.title || entry.project);
  if (!name) return null;

  const kind = normalizeOptionalString(entry.kind || entry.type).toLowerCase();
  const secrecy = normalizeOptionalString(entry.secrecy || entry.classification).toLowerCase();
  const progress = Number(entry.progress);
  const milestones = normalizeProjectMilestones(entry.milestones);
  // A standing effort with no planned end: a permanent patrol, a continuous
  // intelligence programme, an alliance kept in good repair. Distinct from
  // merely having no targetDate yet, which is what an entry the model has not
  // dated looks like — the flag says the absence is DELIBERATE, so the board can
  // show it as ongoing rather than as an oversight, and the model knows it is
  // allowed to leave the date off instead of inventing one.
  const ongoing = entry.ongoing === true || entry.ongoing === "true";
  const updatedRound = Number(entry.updatedRound);

  return {
    id: normalizeOptionalString(entry.id) || generateId(`project-${index}`),
    name,
    kind: PROJECT_KIND_SET.has(kind) ? kind : "project",
    // Same owner namespace as units, markers and every other polity-keyed field:
    // a country NAME, verbatim. Blank means the player — an operation the model
    // reports without naming an owner is one of theirs, and making it restate the
    // player's own name on every entry is how that field ends up wrong.
    ownerCode: toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code)),
    summary: normalizeTextLike(entry.summary || entry.description),
    status: resolveProjectStatus(entry.status),
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0,
    tags: normalizeTagList(entry.tags),
    secrecy: PROJECT_SECRECY_SET.has(secrecy) ? secrecy : "public",
    startedAt: canonicalizeDateString(entry.startedAt || entry.startDate || entry.began),
    ongoing,
    // An ongoing effort has no end date by definition; drop any the model sent
    // alongside the flag rather than showing a deadline it has already disowned.
    targetDate: ongoing ? "" : canonicalizeDateString(entry.targetDate || entry.dueDate || entry.completionDate),
    milestones,
    nextMilestone: deriveNextMilestoneFrom(milestones, entry.nextMilestone),
    lastUpdate: normalizeTextLike(entry.lastUpdate),
    // Newest first: the activity feed reads top-down, so the cap must drop the
    // oldest entry rather than the most recent one.
    eventIds: normalizeIdList(entry.eventIds, MAX_PROJECT_EVENT_IDS),
    linkedUnitIds: normalizeIdList(entry.linkedUnitIds, 12),
    linkedMarkerIds: normalizeIdList(entry.linkedMarkerIds, 12),
    focus: normalizeProjectCoords(entry.focus),
    note: normalizeTextLike(entry.note),
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    updatedAt: normalizeOptionalString(entry.updatedAt) || new Date().toISOString(),
    updatedRound: Number.isFinite(updatedRound) && updatedRound > 0 ? Math.trunc(updatedRound) : 0,
  };
};

// What to drop when the board is over its cap.
//
// This used to be .slice(0, MAX), i.e. "keep the first N" — so a board that went
// over lost whatever happened to be last, which is live work as often as not, and
// said nothing about it. Finished work goes first instead, oldest by last-touched,
// and only if that is not enough does anything still running get evicted.
// Survivors keep their original order: the list order is the board's order, and
// re-sorting it here would reshuffle the panel for reasons nobody can see.
const capProjectList = (list) => {
  if (list.length <= MAX_PROJECTS) return list;

  const evictionRank = (project) => (PROJECT_OPEN_STATUSES.has(project.status) ? 1 : 0);
  const doomed = new Set(
    [...list]
      .sort((a, b) => evictionRank(a) - evictionRank(b)
        || normalizeOptionalString(a.updatedAt).localeCompare(normalizeOptionalString(b.updatedAt)))
      .slice(0, list.length - MAX_PROJECTS)
      .map((project) => project.id),
  );
  return list.filter((project) => !doomed.has(project.id));
};

export const normalizeProjects = (projects) =>
  capProjectList(
    normalizeArray(projects)
      .map((entry, index) => normalizeProjectEntry(entry, index))
      .filter(Boolean)
      // Deduplicate by name, keeping the FIRST occurrence. Two entries for the same
      // programme are a model restating itself, and applyProjectOps has already
      // folded ops together in order, so the first is the merged one.
      .filter((entry, index, list) =>
        list.findIndex((other) => other.name.toLowerCase() === entry.name.toLowerCase()) === index),
  );

// The board's size limit, exported so the panel can warn the player as they
// approach it instead of work quietly vanishing.
export const PROJECT_BOARD_LIMIT = MAX_PROJECTS;

// Which raw keys map onto each project field, so a partially-specified op can be
// told apart from a fully-specified one. Mirrors the aliases normalizeProjectEntry
// accepts — keep the two in step or a field the normalizer understands will look
// "not provided" and be silently preserved instead of applied.
const PROJECT_FIELD_ALIASES = {
  name: ["name", "title", "project"],
  kind: ["kind", "type"],
  ownerCode: ["ownerCode", "owner", "code"],
  summary: ["summary", "description"],
  status: ["status"],
  progress: ["progress"],
  tags: ["tags"],
  secrecy: ["secrecy", "classification"],
  startedAt: ["startedAt", "startDate", "began"],
  ongoing: ["ongoing"],
  targetDate: ["targetDate", "dueDate", "completionDate"],
  milestones: ["milestones"],
  lastUpdate: ["lastUpdate"],
  linkedUnitIds: ["linkedUnitIds"],
  linkedMarkerIds: ["linkedMarkerIds"],
  focus: ["focus"],
  note: ["note"],
};

// A plain ARRAY, not a Set: normalized ops are persisted inside events.json and
// replayed by the staged reveal, so this has to survive a JSON round trip.
const listProvidedFields = (source) => {
  if (!source || typeof source !== "object") return [];
  return Object.entries(PROJECT_FIELD_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => source[alias] !== undefined))
    .map(([field]) => field);
};

// One AI-authored mutation to the projects board.
//
// The aliases are generous on purpose. markerOps learned this the hard way: a
// model asked for "build" writes "found" about a third of the time and the op is
// then dropped in silence. The vocabulary accepted here (start/launch,
// cancel/abandon) is what a model actually reaches for when narrating a
// programme, so take it rather than losing the update.
const normalizeProjectOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;

  const op = normalizeOptionalString(entry.op || entry.action).toLowerCase();
  const projectId = normalizeOptionalString(entry.projectId || entry.id);
  const name = normalizeOptionalString(entry.name || entry.project || entry.title);

  if (op === "create" || op === "start" || op === "launch" || op === "open" || op === "add") {
    // The payload may be nested under `project` or inlined on the op itself —
    // both shapes turn up, and markerOps accepts both for the same reason.
    const source = entry.project ?? entry;
    const project = normalizeProjectEntry(source, 0);
    if (!project) return null;
    // Re-normalizing an op that has already been through here (events.json is
    // replayed by the staged reveal) must not widen the field list to everything.
    const provided = Array.isArray(entry.provided) ? entry.provided : listProvidedFields(source);
    return { op: "create", project, provided };
  }

  if (op === "update" || op === "progress" || op === "edit") {
    if (!projectId && !name) return null;
    return { op: "update", projectId, name, patch: entry.patch ?? entry.project ?? entry };
  }

  if (op === "milestone") {
    if (!projectId && !name) return null;
    const milestone = normalizeProjectMilestone(entry.milestone ?? entry, 0);
    if (!milestone) return null;
    return { op: "milestone", projectId, name, milestone };
  }

  if (op === "complete" || op === "finish" || op === "completed") {
    if (!projectId && !name) return null;
    return { op: "close", status: "complete", projectId, name, note: normalizeOptionalString(entry.note) };
  }

  // Ending badly is still an outcome worth keeping on the board. These used to
  // alias to remove, which DELETED the entry — so the most natural way for a
  // model to say "we gave up on this" quietly erased it, and the Closed view it
  // should have appeared in stayed empty.
  if (op === "cancel" || op === "cancelled" || op === "abandon" || op === "shelve") {
    if (!projectId && !name) return null;
    return { op: "close", status: "cancelled", projectId, name, note: normalizeOptionalString(entry.note) };
  }

  if (op === "fail" || op === "failed") {
    if (!projectId && !name) return null;
    return { op: "close", status: "failed", projectId, name, note: normalizeOptionalString(entry.note) };
  }

  // The real erasure, for an entry that should never have been opened.
  if (op === "remove" || op === "delete" || op === "drop") {
    if (!projectId && !name) return null;
    return { op: "remove", projectId, name, note: normalizeOptionalString(entry.note) };
  }

  return null;
};

// Fields an `update` op may change. A whitelist rather than a spread, because the
// patch object is frequently the whole op (see normalizeProjectOp), so a blind
// merge would write `op`, `projectId` and friends straight into the project.
// Note the absence of `name`: an inlined update op carries the name it was
// matched BY, and matching is case-insensitive, so patching it would let
// {"op":"update","name":"project leviathan"} quietly rename Project Leviathan to
// lowercase. Renaming goes through an explicit `newName`, the same way a marker
// rename does.
const PROJECT_PATCHABLE_FIELDS = [
  "kind", "ownerCode", "summary", "status", "progress", "secrecy", "ongoing",
  "startedAt", "targetDate", "lastUpdate", "note", "focus",
  "linkedUnitIds", "linkedMarkerIds",
];

// Apply a batch of project ops (pure).
//
// Matching is by id first, then case-insensitive name — the same order
// applyMarkerOps uses, and for the same reason: the model reliably knows what it
// called something and only sometimes knows the id it was given.
//
// `ctx` carries the event that caused the change ({date, eventId, round}), which
// is what builds the activity feed without the model having to maintain it.
export const applyProjectOps = (projects, ops, ctx = {}) => {
  const { date = "", eventId = "", round = 0 } = ctx;
  const stamp = new Date().toISOString();
  let next = normalizeProjects(projects);

  const indexOf = (op) => {
    if (op.projectId) {
      const byId = next.findIndex((project) => project.id === op.projectId);
      if (byId !== -1) return byId;
    }
    if (!op.name) return -1;
    const wanted = op.name.toLowerCase();
    return next.findIndex((project) => project.name.toLowerCase() === wanted);
  };

  // Every mutation routes through here so the "when did this last move" fields
  // and the activity feed cannot be updated in one branch and forgotten in
  // another — which is exactly how a board like this goes quietly stale.
  const touch = (project) => ({
    ...project,
    updatedAt: stamp,
    updatedRound: round > 0 ? round : project.updatedRound,
    eventIds: eventId
      ? [eventId, ...project.eventIds.filter((id) => id !== eventId)].slice(0, MAX_PROJECT_EVENT_IDS)
      : project.eventIds,
  });

  // Normalize defensively. Ops arriving from applyEventImpactsToWorld have been
  // through normalizeEventImpacts already, but the advisor feeds this function a
  // freshly parsed ```projects block that has not -- and normalizeProjectOp is
  // idempotent, so running it twice costs nothing and skipping it drops the whole
  // advisor path on the floor.
  for (const raw of normalizeArray(ops)) {
    const op = normalizeProjectOp(raw);
    if (!op) continue;
    if (op.op === "create") {
      const existingIndex = indexOf({ projectId: op.project.id, name: op.project.name });
      if (existingIndex !== -1) {
        // Re-announcing a running project is a restatement, not a second one, so
        // treat it as an UPDATE — otherwise a chatty turn fills the board with
        // duplicate copies of Project Leviathan. Same rule applyMarkerOps applies
        // to rebuilding under an existing name.
        //
        // Crucially a merge, not a replace. This used to spread the whole
        // normalized op over the existing entry, so a jump that mentioned an
        // operation in passing — {"op":"create","name":"Standing Watch",
        // "summary":"The patrol continues."} — silently reset everything the
        // model had not bothered to restate: ongoing back to false, progress to
        // 0, status to active, secrecy to public, tags emptied, an operation
        // demoted to a project. Only apply what the op actually carried.
        const existing = next[existingIndex];
        const merged = { ...existing };
        for (const field of op.provided ?? []) {
          if (field === "name") continue; // matched BY the name; never rewrite it here
          merged[field] = op.project[field];
        }
        next = next.map((project, index) => (index === existingIndex
          ? touch({
            ...merged,
            id: existing.id,
            createdAt: existing.createdAt,
            // A restatement rarely repeats the history, so keep what we had.
            eventIds: existing.eventIds,
          })
          : project));
        continue;
      }
      next = [...next, touch({
        ...op.project,
        startedAt: op.project.startedAt || date,
        createdAt: stamp,
      })];
      continue;
    }

    // An op against a project that does not exist is dropped rather than
    // creating one: it usually means the model invented an id, and a phantom
    // project spawned from a typo is worse than a missed update.
    const index = indexOf(op);
    if (index === -1) continue;
    const current = next[index];

    if (op.op === "update") {
      const patch = op.patch && typeof op.patch === "object" ? op.patch : {};
      const merged = { ...current };
      for (const field of PROJECT_PATCHABLE_FIELDS) {
        if (patch[field] !== undefined) merged[field] = patch[field];
      }
      // tags follows the countryTags rule exactly: an ARRAY replaces the list
      // wholesale (so [] really does mean "this has no tags any more"), while an
      // absent value means unchanged. Truthiness would conflate the two.
      const renamed = normalizeOptionalString(patch.newName || patch.rename);
      if (renamed) merged.name = renamed;
      if (Array.isArray(patch.tags)) merged.tags = patch.tags;
      if (Array.isArray(patch.milestones)) merged.milestones = patch.milestones;
      const normalized = normalizeProjectEntry(
        { ...merged, id: current.id, createdAt: current.createdAt },
        index,
      );
      if (!normalized) continue;
      next = next.map((project, i) => (i === index ? touch(normalized) : project));
      continue;
    }

    if (op.op === "milestone") {
      const wanted = op.milestone.title.toLowerCase();
      const existing = current.milestones.find((entry) =>
        (op.milestone.id && entry.id === op.milestone.id) || entry.title.toLowerCase() === wanted);

      // Merge field by field rather than spreading the normalized op over the
      // entry. normalizeProjectMilestone fills every field, so a spread wrote
      // date:"" and note:"" whenever the model marked something done the natural
      // way — {"title":"Annual drill","status":"done"} — silently erasing when it
      // had been due and what it was. Only take what the op actually carried.
      const mergeInto = (entry) => {
        const merged = {
          ...entry,
          title: op.milestone.title || entry.title,
          date: op.milestone.date || entry.date,
          status: op.milestone.status,
          note: op.milestone.note || entry.note,
          repeat: op.milestone.repeat || entry.repeat,
          id: entry.id,
        };

        // A recurring commitment is never finished, only performed again. Roll it
        // to the next occurrence after whichever is later — the date it was due or
        // the date it was actually marked off — and set it pending, so the board
        // shows the next one instead of an empty "next milestone".
        if (merged.status === "done" && merged.repeat) {
          const rolled = advanceRecurringDate(merged.date, merged.repeat, date || merged.date);
          if (rolled) {
            return {
              ...merged,
              date: rolled,
              status: "pending",
              completedCount: (Number(entry.completedCount) || 0) + 1,
              lastCompletedAt: date || merged.date,
            };
          }
        }
        return merged;
      };

      const milestones = existing
        ? current.milestones.map((entry) => (entry === existing ? mergeInto(entry) : entry))
        : [...current.milestones, op.milestone];
      // nextMilestone is nulled so normalizeProjectEntry re-derives it from the
      // list it was just handed, rather than keeping a value the new milestone
      // may have superseded.
      const normalized = normalizeProjectEntry({ ...current, milestones, nextMilestone: null }, index);
      if (!normalized) continue;
      next = next.map((project, i) => (i === index ? touch(normalized) : project));
      continue;
    }

    if (op.op === "close") {
      const succeeded = op.status === "complete";
      next = next.map((project, i) => (i === index
        ? touch({
          ...project,
          status: op.status,
          // Only success implies the work is all done. A cancelled programme at
          // 40% stays at 40% — that is the informative number.
          progress: succeeded ? 100 : project.progress,
          // Nothing is still outstanding once a project has ended, whichever way
          // it ended. A leftover pending milestone would keep showing a "next"
          // that will never come and, once its date passed, an OVERDUE badge on
          // something already finished. Success marks them done; anything else
          // marks them missed, which is what actually happened.
          milestones: project.milestones.map((entry) =>
            (entry.status === "pending" ? { ...entry, status: succeeded ? "done" : "missed" } : entry)),
          nextMilestone: null,
          lastUpdate: op.note || project.lastUpdate,
        })
        : project));
      continue;
    }

    if (op.op === "remove") {
      next = next.filter((_, i) => i !== index);
    }
  }

  return next;
};

// One AI-authored mutation to the unit list: spawn | move | strength | remove.
// Why normalizeUnitOp refused an entry, in words a player can paste into a bug
// report. Mirrors the checks below — keep the two in step.
const describeUnitOpRejection = (entry) => {
  if (!entry || typeof entry !== "object") return "not an object";
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (!op) return "no op (expected spawn, move, strength or remove)";
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
    const posture = normalizeOptionalString(entry.posture).toLowerCase();
    return {
      op,
      unitId,
      toLng,
      toLat,
      regionId: normalizeOptionalString(entry.regionId),
      // Re-posturing on the move is how "this force is now massing rather than
      // in transit" reaches the map without a second op.
      posture: UNIT_POSTURE_SET.has(posture) ? posture : "",
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

// The owner's known footprint: every point on the map that power visibly holds.
// Region polygons are not available in the runtime layer (loadRegionCatalog
// yields names and ids, no geometry), so this is built from the point data world
// state actually carries — their units and their structures — plus whatever
// extra anchors a caller can supply.
export const buildOwnerFootprint = (world, ownerCode, extraAnchors = []) => {
  const owner = toCountryName(normalizeOptionalString(ownerCode));
  if (!owner) return [];
  const sameOwner = (value) =>
    toCountryName(normalizeOptionalString(value)).toLowerCase() === owner.toLowerCase();

  const points = [];
  for (const unit of normalizeArray(world?.units)) {
    if (sameOwner(unit?.ownerCode) && Number.isFinite(unit?.lng) && Number.isFinite(unit?.lat)) {
      points.push({ lng: unit.lng, lat: unit.lat });
    }
  }
  for (const marker of normalizeArray(world?.markers)) {
    if (sameOwner(marker?.ownerCode) && Number.isFinite(marker?.lng) && Number.isFinite(marker?.lat)) {
      points.push({ lng: marker.lng, lat: marker.lat });
    }
  }
  for (const anchor of normalizeArray(extraAnchors)) {
    if (Number.isFinite(anchor?.lng) && Number.isFinite(anchor?.lat)) {
      points.push({ lng: anchor.lng, lat: anchor.lat });
    }
  }
  return points;
};

const nearestKm = (point, anchors) => {
  let best = Infinity;
  for (const anchor of anchors) {
    const distance = haversineKm(point.lat, point.lng, anchor.lat, anchor.lng);
    if (distance < best) best = distance;
  }
  return best;
};

// Is a spawn supported by its owner's known footprint?
//
// The point is NOT to refuse implausible spawns. The unit layer is the player's
// intelligence picture, not ground truth: a submarine shadowing their fleet has
// been there for months, and the turn it appears is the turn they detected it.
// Refusing that would break exactly the stories worth telling. So nothing is ever
// dropped for being far from home — the distance only decides whether the unit is
// drawn as an established presence or an unconfirmed one.
//
// The threshold is "30 days of this type's travel", which makes it era- and
// type-aware off the same speed table for free: a modern navy reads as globally
// supported (~18,000 km, correct), a 1400 army does not (~420 km, also correct).
const isUnsupportedSpawn = (point, anchors, type, gameDate) => {
  // An unknown footprint is not a suspicious one — world.units is empty at the
  // start of most scenarios, and gating on that would ghost every first spawn.
  if (anchors.length === 0) return false;
  const radius = Math.max(600, Math.min(15000, maxTravelKm(type, gameDate, 30)));
  return nearestKm(point, anchors) > radius;
};

// How many rounds a minted patrol order runs for before it lapses. Long enough
// that stating posture "patrol" once keeps a fleet on station for a good while,
// short enough that it does not circle the same water forever.
const PATROL_ORDER_ROUNDS = 12;

const UNIT_SYSTEM_SET = new Set(["beta", "classic"]);

// Bring standing orders back into the present after time has passed under the
// classic system, which has no engine to advance or expire them.
//
// A patrol carries an ABSOLUTE expiry round, so ten rounds of classic play would
// leave every dormant patrol already past its untilRound — and the next beta jump
// would clear the lot at once, looking exactly like the orders had been lost when
// in fact they were preserved on disk the whole time. Rebasing gives each one the
// rest of its life from here instead. Move orders need nothing: they have no
// expiry and resume simply by being advanced again.
//
// `previousSystem` is the stamp the save carried BEFORE this turn, which the
// caller has to supply: by the time a world comes back from
// applyEventImpactsToWorld it has already been re-stamped "beta", so reading it
// off the world here would never fire.
//
// Idempotent, and a no-op unless the classic system is what last wrote the save.
export const resumeStandingOrders = (world, { round = 0, previousSystem = "" } = {}) => {
  if (previousSystem !== "classic" || !round) return world;
  const next = normalizeWorldState(world);
  const orders = next.pendingUnitOrders;
  if (orders.length === 0) return world;
  return {
    ...next,
    pendingUnitOrders: orders.map((order) =>
      (order.kind === "patrol" && order.untilRound && order.untilRound <= round
        ? { ...order, untilRound: round + PATROL_ORDER_ROUNDS }
        : order)),
  };
};

// Apply a batch of unit ops to a unit list AND the standing-order list (pure).
// Ops referencing unknown ids are silently ignored; units reduced to <=0 strength
// are dropped.
//
// context: { markers, gameDate, elapsedDays, round, extraAnchors, eventId, betaEngine }
//   elapsedDays === null | undefined  ->  no travel clamp (the old behaviour, and
//   what a non-Gregorian scenario date must fall back to).
//   betaEngine === false  ->  the classic unit system is running: no standing
//   orders are minted and a spawn is taken at face value. Defaults to true so
//   this stays directly callable — it is the caller (gameplay.js, time.jsx) that
//   knows which system the session is in, never this module. See
//   runtime/mapSettings.js isBetaUnits.
export const applyUnitOpBatch = (units, orders, ops, context = {}) => {
  const {
    gameDate = "", elapsedDays = null, round = 0, extraAnchors = [], eventId = "", betaEngine = true,
  } = context;
  let next = normalizeUnits(units);
  let nextOrders = normalizePendingUnitOrders(orders);
  const markers = normalizeArray(context.markers);
  const stamp = () => new Date().toISOString();
  // Normalize defensively. Ops arriving from applyEventImpactsToWorld have been
  // through normalizeEventImpacts already (and normalizeUnitOp is idempotent),
  // but the idle pulse and tests hand us raw model output — and a raw spawn has
  // none of the unit fields this function reads.
  const batch = normalizeArray(ops).map((op) => normalizeUnitOp(op)).filter(Boolean);

  const dropOrder = (unitId) => {
    nextOrders = nextOrders.filter((order) => order.unitId !== unitId);
  };
  const upsertOrder = (order) => {
    nextOrders = [...nextOrders.filter((entry) => entry.unitId !== order.unitId), order];
  };

  for (const op of batch) {
    if (op.op === "spawn") {
      // Idempotent: skip a spawn whose unit id is already present, so a re-applied
      // op batch can't duplicate a unit (mirrors the event-restatement de-dup).
      const spawnId = op.unit?.id;
      if (spawnId && next.some((unit) => unit.id === spawnId)) continue;

      const unit = { ...op.unit };
      const anchors = buildOwnerFootprint({ units: next, markers }, unit.ownerCode, extraAnchors);
      // Reach/supply feasibility is a beta-engine rule; the classic system takes a
      // spawn where the model put it, exactly as it always has.
      if (betaEngine && isUnsupportedSpawn(unit, anchors, unit.type, gameDate)) {
        // A fixed installation is the one thing that cannot simply be detected
        // into existence — it has to be built. Downgrade it to the troops it
        // would take rather than dropping the op, because a silently dropped op
        // leaves the event narrating a deployment the map never shows, which is
        // the failure describeUnitOpRejection exists to make visible.
        if (unit.type === "garrison") unit.type = "infantry";
        unit.covert = true;
        if (!unit.posture) unit.posture = "transit";
      }
      if (eventId && !unit.eventId) unit.eventId = eventId;
      next.push(unit);

      if (betaEngine && unit.posture === "patrol") {
        upsertOrder(
          normalizePendingUnitOrderEntry({
            unitId: unit.id,
            kind: "patrol",
            toLng: unit.lng,
            toLat: unit.lat,
            radiusKm: DEFAULT_PATROL_RADIUS_KM[unit.type] ?? 0,
            untilRound: round ? round + PATROL_ORDER_ROUNDS : 0,
            issuedRound: round,
          }),
        );
      }
      continue;
    }

    if (op.op === "move") {
      next = next.map((unit) => {
        if (unit.id !== op.unitId) return unit;
        // Garrisons are fixed by definition — a move op on one is a mistake, not
        // an order (the same doctrine buildMilitaryFeasibilityText already states).
        if (unit.type === "garrison") return unit;

        const budget =
          elapsedDays === null || elapsedDays === undefined
            ? Infinity
            : maxTravelKm(unit.type, gameDate, elapsedDays);
        const step = stepToward(unit, { lng: op.toLng, lat: op.toLat }, budget);
        const posture = op.posture || unit.posture;

        if (step.arrived) {
          dropOrder(unit.id);
          if (betaEngine && posture === "patrol") {
            upsertOrder(
              normalizePendingUnitOrderEntry({
                unitId: unit.id,
                kind: "patrol",
                toLng: step.lng,
                toLat: step.lat,
                radiusKm: DEFAULT_PATROL_RADIUS_KM[unit.type] ?? 0,
                untilRound: round ? round + PATROL_ORDER_ROUNDS : 0,
                issuedRound: round,
              }),
            );
          }
        } else {
          // Too far for the time that has passed. Move as far as the unit could
          // actually get and keep a standing order to the FULL destination, so
          // the journey continues by itself next turn. This is what makes
          // over-long move ops safe for the model to write.
          //
          // Unreachable in the classic system, which never clamps travel
          // (elapsedDays is null, so the budget is Infinity and every step
          // arrives). Guarded anyway so the rule is stated once, here, rather
          // than resting on that coincidence holding forever.
          if (betaEngine) {
            upsertOrder(
              normalizePendingUnitOrderEntry({
                unitId: unit.id,
                kind: "move",
                toLng: op.toLng,
                toLat: op.toLat,
                note: op.note,
                issuedAt: gameDate,
                issuedRound: round,
              }),
            );
          }
        }

        return {
          ...unit,
          lng: step.lng,
          lat: step.lat,
          regionId: op.regionId || unit.regionId,
          status: step.arrived && posture === "patrol" ? "idle" : "moving",
          posture,
          orderId: "",
          ...(eventId ? { eventId } : {}),
          updatedAt: stamp(),
        };
      });
      continue;
    }

    if (op.op === "strength") {
      next = next.map((unit) =>
        unit.id === op.unitId
          ? {
              ...unit,
              strength: op.strength,
              status: op.strength <= 0 ? "defeated" : unit.status,
              ...(eventId ? { eventId } : {}),
              updatedAt: stamp(),
            }
          : unit,
      );
      continue;
    }

    if (op.op === "remove") {
      next = next.filter((unit) => unit.id !== op.unitId);
      dropOrder(op.unitId);
    }
  }

  const survivors = next.filter((unit) => unit.strength > 0 && unit.status !== "defeated");
  return { units: survivors, orders: pruneSatisfiedUnitOrders(survivors, nextOrders) };
};

// Back-compat shape: units in, units out. applyUnitOpBatch is the real one and
// is what applyEventImpactsToWorld calls; this keeps the documented array
// contract for any caller that still expects it.
export const applyUnitOps = (units, ops, context = {}) =>
  applyUnitOpBatch(units, [], ops, context).units;

// Advance every standing order by the time that has passed. This is what makes
// units move realistically turn after turn without a single token being spent:
// a move order steps toward its destination at the unit's own pace, and a patrol
// order repositions deterministically around its station.
export const advanceStandingOrders = (
  world,
  { fromDate, toDate, round = 0, tick = 0, skipUnitIds = [] } = {},
) => {
  const units = normalizeUnits(world?.units);
  const orders = normalizePendingUnitOrders(world?.pendingUnitOrders);
  if (orders.length === 0) return world;

  const elapsed = daysBetweenDates(fromDate, toDate) ?? 0;
  const ordersByUnit = new Map(orders.map((order) => [order.unitId, order]));
  // Units the caller already moved this turn (an event's own unit ops). Advancing
  // them again here would move them twice for the same elapsed time — their step
  // was taken per-event, against that event's own budget.
  const skip = new Set(normalizeArray(skipUnitIds));
  const expired = new Set();
  const stamp = new Date().toISOString();

  const nextUnits = units.map((unit) => {
    const order = ordersByUnit.get(unit.id);
    if (!order || skip.has(unit.id)) return unit;

    if (order.untilRound && round > order.untilRound) {
      expired.add(order.id);
      return { ...unit, orderId: "", posture: "", status: "idle", updatedAt: stamp };
    }

    if (order.kind === "patrol") {
      const point = patrolPoint(
        { lng: order.toLng, lat: order.toLat },
        order.radiusKm || DEFAULT_PATROL_RADIUS_KM[unit.type] || 0,
        `${unit.id}|${round}|${tick}`,
      );
      return { ...unit, lng: point.lng, lat: point.lat, posture: "patrol", updatedAt: stamp };
    }

    if (unit.type === "garrison") return unit;
    const step = stepToward(
      unit,
      { lng: order.toLng, lat: order.toLat },
      maxTravelKm(unit.type, toDate || fromDate, elapsed),
    );
    return {
      ...unit,
      lng: step.lng,
      lat: step.lat,
      // On arrival the order is pruned below; the unit stops reading as "moving".
      status: step.arrived ? "idle" : "moving",
      updatedAt: stamp,
    };
  });

  const kept = orders.filter((order) => !expired.has(order.id));
  return {
    ...world,
    units: nextUnits,
    pendingUnitOrders: pruneSatisfiedUnitOrders(nextUnits, kept),
  };
};

// Keep the map legible. Applies to A.I. polities ONLY: the player's own forces
// are filtered out before anything is counted, so neither cap constrains them and
// their units never eat another power's headroom — the player manages their own
// order of battle by disbanding.
//
// Deliberately NOT run from normalizeWorldState: that runs on every read, and
// pruning there would delete units on a read racing a write and fight the map's
// 5s poll. Call it from the turn commit and the idle pulse instead.
export const enforceUnitVolume = (world, { playerCode = "" } = {}) => {
  const units = normalizeUnits(world?.units);
  const player = toCountryName(normalizeOptionalString(playerCode)).toLowerCase();
  const isPlayers = (unit) =>
    unit.source === "player" ||
    (player && toCountryName(unit.ownerCode).toLowerCase() === player);

  const mine = units.filter(isPlayers);
  const theirs = units.filter((unit) => !isPlayers(unit));
  if (theirs.length === 0) return world;

  // A total order, so the same world always prunes to the same list — a rollback
  // and re-run must not produce a different map.
  const significance = (a, b) =>
    b.strength - a.strength ||
    Number(a.covert) - Number(b.covert) ||
    String(a.createdAt).localeCompare(String(b.createdAt)) ||
    String(a.id).localeCompare(String(b.id));
  // Never prune a formation that is mid-fight or is a player deployment awaiting
  // adjudication — both are live story beats, not surplus scenery.
  const protectedUnit = (unit) => unit.status === "engaged" || unit.status === "pending";

  const byOwner = new Map();
  for (const unit of theirs) {
    const key = toCountryName(unit.ownerCode).toLowerCase();
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(unit);
  }

  let survivors = [];
  for (const owned of byOwner.values()) {
    const keep = owned.filter(protectedUnit);
    const trimmable = owned.filter((unit) => !protectedUnit(unit)).sort(significance);
    survivors = survivors.concat(keep, trimmable.slice(0, Math.max(0, MAX_UNITS_PER_POLITY - keep.length)));
  }

  if (survivors.length > MAX_UNITS_GLOBAL) {
    const keep = survivors.filter(protectedUnit);
    const trimmable = survivors.filter((unit) => !protectedUnit(unit)).sort(significance);
    survivors = keep.concat(trimmable.slice(0, Math.max(0, MAX_UNITS_GLOBAL - keep.length)));
  }

  if (survivors.length === theirs.length) return world;

  const nextUnits = [...mine, ...survivors];
  return {
    ...world,
    units: nextUnits,
    pendingUnitOrders: pruneSatisfiedUnitOrders(
      nextUnits,
      normalizePendingUnitOrders(world?.pendingUnitOrders),
    ),
  };
};

const normalizeEventImpacts = (value) => {
  if (!value || typeof value !== "object") {
    return {
      actionIds: [],
      createdChats: [],
      markerOps: [],
      polityChanges: [],
      projectOps: [],
      regionTransfers: [],
      unitOps: [],
    };
  }

  return {
    actionIds: normalizeActionParticipants(value.actionIds),
    createdChats: normalizeChats(value.createdChats),
    markerOps: normalizeArray(value.markerOps).map(normalizeMarkerOp).filter(Boolean),
    polityChanges: normalizeArray(value.polityChanges).map(normalizePolityChange).filter(Boolean),
    projectOps: normalizeArray(value.projectOps).map(normalizeProjectOp).filter(Boolean),
    regionTransfers: normalizeArray(value.regionTransfers).map(normalizeRegionTransfer).filter(Boolean),
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

export const normalizeWorldState = (world) => {
  const nextWorld = world && typeof world === "object" ? world : {};
  const polityOverrides = Object.fromEntries(
    Object.entries(nextWorld.polityOverrides ?? {})
      .map(([key, value]) => [key, normalizePolityOverride(key, value)])
      .filter(([, value]) => value),
  );

  // Canonicalise on READ too, so a save written before this migrated — or one
  // whose owners were split across a polity's token and its era display name by
  // a build that predates this — resolves to the same owner identity as
  // everything computed now. See ownerNames.js for why a name is an identity.
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(polityOverrides));

  const regionOwnershipOverrides = Object.fromEntries(
    Object.entries(nextWorld.regionOwnershipOverrides ?? {})
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), resolveOwner(ownerCode)])
      .filter(([regionId, ownerCode]) => regionId && ownerCode),
  );

  const regionClaimants = Object.fromEntries(
    Object.entries(nextWorld.regionClaimants ?? {})
      // Claimants share the owner namespace — they are compared against owners to
      // paint a disputed region's stripes (Nations.jsx).
      .map(([regionId, claimants]) => [
        normalizeOptionalString(regionId),
        normalizeArray(claimants).map((name) => resolveOwner(name)).filter(Boolean).slice(0, 4),
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

  // Persisted per-country stat sheets: keep each code -> sheet-object entry as-is (the
  // Stats pane tolerates missing fields). Explicit, not via the spread — new-field trap.
  const countryStats = Object.fromEntries(
    Object.entries(nextWorld.countryStats ?? {})
      .filter(([code, sheet]) => normalizeOptionalString(code) && sheet && typeof sheet === "object"),
  );

  const units = normalizeUnits(nextWorld.units);

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
    idlePulseTick: Number.isFinite(Number(nextWorld.idlePulseTick))
      ? Math.max(0, Math.trunc(Number(nextWorld.idlePulseTick)))
      : 0,
    notes: normalizeOptionalString(nextWorld.notes),
    polityOverrides,
    regionClaimants,
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
          // The raw model response a fallback turn failed to parse — empty on a
          // normal AI turn. See gameplay.js's runJsonTask/applySimulationResult.
          rawResponse: normalizeOptionalString(entry.rawResponse),
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
    // Explicit (not via the ...WORLD_DEFAULTS spread) so these new fields survive every
    // write path — the documented new-world-field trap.
    projects: normalizeProjects(nextWorld.projects),
    cityRenames: Object.fromEntries(
      Object.entries(nextWorld.cityRenames && typeof nextWorld.cityRenames === "object" ? nextWorld.cityRenames : {})
        .map(([key, value]) => [normalizeString(key).toLowerCase(), normalizeString(value)])
        .filter(([key, value]) => key && value),
    ),
    simulationRules: normalizeOptionalString(nextWorld.simulationRules),
    startingTimelineText: normalizeOptionalString(nextWorld.startingTimelineText),
    units,
    // Pruned against the units computed just above, on every read AND write, so
    // an order clears itself the moment its unit actually arrives — see
    // pruneSatisfiedUnitOrders.
    pendingUnitOrders: pruneSatisfiedUnitOrders(units, normalizePendingUnitOrders(nextWorld.pendingUnitOrders)),
    // Which unit system last took a turn on this save: "beta", "classic", or ""
    // for a save written before the two were distinguishable. Stamped by
    // applyEventImpactsToWorld, never by a normalizer — this module has no idea
    // which system is running and must not acquire one.
    //
    // It exists so resumeStandingOrders can tell that game time passed while the
    // beta engine was not running, and so a save can say what wrote it. Neither
    // system reads it to decide behaviour.
    unitSystem: UNIT_SYSTEM_SET.has(normalizeOptionalString(nextWorld.unitSystem))
      ? normalizeOptionalString(nextWorld.unitSystem)
      : "",
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

// The polity registry as it will stand once this event's changes land, used only
// to build the alias map. An event's transfers are applied before its polity
// changes, and a conquest routinely arrives in the same event as the rename that
// names its winner — so the new name has to be known before the transfers are
// read, or that one turn's regions land under a second, phantom owner.
const previewPolityOverrides = (polityOverrides, pendingChanges) => {
  if (pendingChanges.length === 0) {
    return polityOverrides;
  }

  const preview = { ...polityOverrides };
  for (const { change, code } of pendingChanges) {
    preview[code] = {
      ...(preview[code] ?? { aliases: [], code, name: "" }),
      ...(change.aliases?.length > 0 ? { aliases: change.aliases } : {}),
      ...(change.name ? { name: change.name } : {}),
    };
  }

  return preview;
};

// motion: { originDate, round, tick } enables realistic travel. Each event gets a
// budget of exactly the days between the previous event and its own date, so an
// op on day 3 of a 90-day jump only moves three days' worth. Passing motion: null
// (the default) leaves moves unclamped, i.e. exactly the old behaviour — which is
// also the right fallback for a scenario whose dates are not Gregorian.
// `round` stamps world.projects[].updatedRound so the board can say how long a
// programme has sat still. It defaults to 0 (meaning "leave the stamp alone")
// rather than being required, because the staged event reveal in time.jsx replays
// impacts purely for display and must not age the projects it is only redrawing.
// `betaEngine` reaches applyUnitOpBatch unchanged — see its context docs. Pass
// false alongside motion: null to run a jump entirely under the classic rules.
export const applyEventImpactsToWorld = ({
  colors = {}, events = [], world, motion = null, round = 0, betaEngine = true,
}) => {
  const nextColors = cloneValue(colors) ?? {};
  const nextWorld = normalizeWorldState(world);
  let cursorDate = motion ? normalizeOptionalString(motion.originDate) : "";
  // Every owner written below goes through here first. The model reads the story
  // it just wrote, so the turn after a polity is renamed it hands back the NEW
  // name — and storing that verbatim splits one country into two owners, one of
  // which has none of the country's colour, tags, reputation or stats (see
  // ownerNames.js). Rebuilt after each event's polityChanges, since a rename in
  // one event is a name the next event can already be using.
  let resolveOwner = createOwnerResolver(buildOwnerAliasMap(nextWorld.polityOverrides));

  for (const event of normalizeEvents(events)) {
    // Resolve this event's polity changes first — both to fold the renames they
    // make into the alias map before any owner is read through it, and so a
    // change addressed to a polity's current display name lands on that polity
    // rather than creating a second one beside it.
    const polityChanges = event.impacts.polityChanges.map((change) => ({
      change,
      code: resolveOwner(change.code) || change.code,
    }));

    if (polityChanges.length > 0) {
      resolveOwner = createOwnerResolver(buildOwnerAliasMap(
        previewPolityOverrides(nextWorld.polityOverrides, polityChanges),
      ));
    }

    for (const transfer of event.impacts.regionTransfers) {
      nextWorld.regionOwnershipOverrides[transfer.regionId] = resolveOwner(transfer.toCode);
      // A transfer resolves whatever dispute the scenario seed declared for this
      // region (regionClaimants — see Nations.jsx's stripe rendering): without
      // this, regionClaimants is never written by anything else, so a region
      // handed over cleanly (a negotiated cession, a conceded claim) kept
      // rendering permanently striped with its old claimant forever, out of step
      // with regionOwnershipOverrides (and the country panel's "Regions Owned")
      // agreeing the transfer already happened.
      delete nextWorld.regionClaimants[transfer.regionId];
    }

    for (const { change, code } of polityChanges) {
      nextWorld.polityOverrides[code] = {
        ...(nextWorld.polityOverrides[code] ?? {
          aliases: [],
          code,
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
          nextColors[code] = [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
          ];
        }
      }

      // Reputation the AI set this turn becomes the polity's authoritative value.
      if (Number.isFinite(change.reputation)) {
        nextWorld.internationalReputation[code] = change.reputation;
        // Keep the persisted sheet's reputation index in sync with the authoritative value.
        if (nextWorld.countryStats?.[code]?.indices) {
          nextWorld.countryStats[code] = {
            ...nextWorld.countryStats[code],
            indices: { ...nextWorld.countryStats[code].indices, internationalReputation: change.reputation },
          };
        }
      }

      // Persistent stat sheet: merge the AI's changed fields into the stored sheet so a
      // country's stats change ONLY when the AI changes them (not every date). Deep-merge
      // the nested groups and mirror the reputation index into the authoritative store.
      if (change.stats && typeof change.stats === "object") {
        if (!nextWorld.countryStats || typeof nextWorld.countryStats !== "object") nextWorld.countryStats = {};
        const prev = nextWorld.countryStats[code] && typeof nextWorld.countryStats[code] === "object"
          ? nextWorld.countryStats[code]
          : {};
        const merged = { ...prev, ...change.stats };
        for (const group of ["indices", "economy", "gdpBreakdown"]) {
          if (change.stats[group] && typeof change.stats[group] === "object") {
            merged[group] = { ...(prev[group] || {}), ...change.stats[group] };
          }
        }
        nextWorld.countryStats[code] = merged;
        const rep = Number(merged.indices?.internationalReputation);
        if (Number.isFinite(rep)) {
          nextWorld.internationalReputation[code] = Math.max(0, Math.min(100, Math.round(rep)));
        }
      }

      // Tags the AI set this turn replace the scenario's starting tags for this
      // country, wholesale — the model sends the complete list, so a revolution
      // that drops "socialist" must actually drop it. null means "unchanged",
      // which is why normalizePolityChange distinguishes null from [].
      if (Array.isArray(change.tags)) {
        if (!nextWorld.countryTags || typeof nextWorld.countryTags !== "object") {
          nextWorld.countryTags = {};
        }
        if (change.tags.length) nextWorld.countryTags[code] = change.tags;
        else delete nextWorld.countryTags[code];
      }
    }

    if (event.impacts.unitOps?.length) {
      // A battalion's owner is the same namespace: spawned under a display name
      // it would fly a phantom country's colours beside its own army.
      const applied = applyUnitOpBatch(
        nextWorld.units,
        nextWorld.pendingUnitOrders,
        event.impacts.unitOps.map((op) =>
          (op.op === "spawn" && op.unit?.ownerCode
            ? { ...op, unit: { ...op.unit, ownerCode: resolveOwner(op.unit.ownerCode) } }
            : op)),
        {
          markers: nextWorld.markers,
          gameDate: event.date || cursorDate,
          elapsedDays: motion ? daysBetweenDates(cursorDate, event.date) : null,
          round: motion?.round ?? 0,
          eventId: event.id,
          betaEngine,
        },
      );
      nextWorld.units = applied.units;
      nextWorld.pendingUnitOrders = applied.orders;
    }
    // Advance the cursor even for events that moved no units, so the NEXT event's
    // budget is measured from this event rather than from the start of the jump.
    if (motion && event.date) cursorDate = event.date;

    if (event.impacts.markerOps?.length) {
      const before = normalizeMarkers(nextWorld.markers);
      nextWorld.markers = applyMarkerOps(nextWorld.markers, event.impacts.markerOps.map((op) =>
        (op.op === "build" && op.marker?.ownerCode
          ? { ...op, marker: { ...op.marker, ownerCode: resolveOwner(op.marker.ownerCode) } }
          : op)));
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

    // Projects & Operations last, so the ops see the world this event has already
    // reshaped. The event's own id and date ride along: that is what stamps the
    // activity feed and dates a project the event has just started, without the
    // model having to restate either.
    if (event.impacts.projectOps?.length) {
      nextWorld.projects = applyProjectOps(nextWorld.projects, event.impacts.projectOps.map((op) =>
        (op.op === "create" && op.project?.ownerCode
          ? { ...op, project: { ...op.project, ownerCode: resolveOwner(op.project.ownerCode) } }
          : op)), {
        date: event.date,
        eventId: event.id,
        round,
      });
    }
  }

  return {
    colors: nextColors,
    // Record which system took this turn, so a later resume can tell that game
    // time passed while the beta engine was not running (resumeStandingOrders).
    world: { ...nextWorld, unitSystem: betaEngine ? "beta" : "classic" },
  };
};
