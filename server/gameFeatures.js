/*! Open Historia — gameplay features a scenario can switch off and a game can override © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shared by the server store, the web store and the client, so it lives under
// server/ and imports nothing (server code never imports src/).
//
// A scenario carries a COMPLETE configuration — every feature, every setting —
// which is the default for every game made from it. A game carries only the
// fields it overrides, so a scenario edited later still reaches every game that
// never overrode that field. Add a feature here and it appears in both editors
// and in resolveFeatures with its defaults; gate the code it controls with
// isFeatureEnabled (client: isActiveFeatureEnabled in src/runtime/gameFeatures.js).

export const FEATURE_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "espionage",
    label: "Espionage",
    description: "Spies and what they intercept, cover stories, the intelligence readings behind them, and the agents other polities send. Off: the Spy tab is hidden, no service acts, and the simulator's spy orders are ignored.",
    settings: Object.freeze([]),
  }),
  Object.freeze({
    key: "puppetStates",
    label: "Puppet states",
    description: "Subordination between two countries: protectorates, puppet states and clients, openly known or covert, the loyalty underneath them, the demands an overlord makes of its own puppet, and the risings that follow a collapse. Off: no country can be made another's puppet by the simulator, the Game Master or a scenario's own start date, the simulator and every leader are never told the system exists, no demands can be made or answered, and nothing about subordination is shown on the map, in a country's panel or to the advisor. A game switched back on finds its ledger as it left it.",
    settings: Object.freeze([]),
  }),
  Object.freeze({
    key: "idleDiplomacy",
    label: "Idle diplomacy",
    description: "While the game sits open between turns, a polity with a live reason to speak may send the player an unprompted note. Every attempt is an AI request nobody pressed a button for, so it only runs while Background AI is on (Settings, AI, AI requests; on by default), and stops at that player's daily cap.",
    settings: Object.freeze([
      Object.freeze({
        key: "averageMinutes",
        label: "One attempt every",
        unit: "minutes, on average",
        min: 1,
        max: 720,
        step: 1,
        defaultValue: 8,
        description: "How often, on average, the model is asked whether some polity would write. Most attempts send nothing; the roll only runs while the game is on screen, and only while Background AI is on.",
      }),
    ]),
  }),
  Object.freeze({
    key: "pregameHistory",
    label: "Pre-game history",
    description: "When a fresh game first opens, turn the scenario's World Before Round One briefing into timeline events and use it to bootstrap the wars, relations, agreements and unresolved storylines already true on the start date. Off: no pre-game history AI request runs and no Round-One state is inferred from the briefing; canonical state authored directly into the scenario is left untouched.",
    settings: Object.freeze([]),
  }),
  // The director: what a scenario's author decides about HOW the world is run,
  // as numbers the engine reads and enforces rather than prose the model may or
  // may not follow (src/Game/AI/worldDirection.js). None of it costs a request:
  // each setting shapes the one request a time skip already makes, and what the
  // model gets wrong is told to it in the next turn's receipt.
  Object.freeze({
    key: "worldDirection",
    label: "World direction",
    description: "How the world is run in this scenario: how eventful a period is, how much of it belongs to the rest of the world rather than the player, and rules that outrank everything else the simulator is told. Off: the built-in pace, the built-in one-third floor in the simulator's guidance (unchecked), and no priority rules.",
    settings: Object.freeze([
      Object.freeze({
        key: "eventPace",
        label: "Pace",
        unit: "% of the usual number of events",
        min: 40,
        max: 250,
        step: 5,
        defaultValue: 100,
        description: "How many events a time skip writes. 100 is the built-in count (a month is 5 to 7). Lower for a slow, weighty chronicle; higher for a crowded world. It scales what the simulator is asked for and what it is checked against.",
      }),
      Object.freeze({
        key: "worldShare",
        label: "The world's share",
        unit: "% of events, at least, that are not about the player",
        min: 0,
        max: 80,
        step: 5,
        defaultValue: 35,
        description: "The least part of a period that must belong to powers other than the player's. The engine counts it on every skip; a skip that falls short is kept, and the simulator is told at the top of its next turn. 0 turns the count off.",
      }),
      Object.freeze({
        key: "priorityRules",
        type: "text",
        label: "Priority rules",
        maxLength: 2400,
        rows: 6,
        defaultValue: "",
        description: "Rules for this scenario that outrank every default the simulator is given, written last in its instructions and marked as such. Keep them few and absolute: \"No power may field nuclear weapons before 1945.\" \"The Ottoman Empire cannot collapse before 1918.\"",
      }),
      Object.freeze({
        key: "scriptedEvents",
        type: "text",
        label: "Scripted events",
        maxLength: 8000,
        rows: 8,
        defaultValue: "",
        description: "History that happens on its date whatever else the players do: one event per line, the date first (YYYY-MM-DD, a year before AD 1 with a leading minus), then what happens in your own words. The time skip that covers the date is asked to write it; if it does not, the engine writes it for you. \"1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.\"",
      }),
      Object.freeze({
        key: "territoryTempo",
        label: "The map's tempo",
        unit: "regions per 30 days, at most (0 = no ceiling)",
        min: 0,
        max: 60,
        step: 1,
        defaultValue: 0,
        description: "How fast borders may move. The engine counts a skip's transfers and captures in event order and withholds any beyond the ceiling for the period, telling the simulator to carry the front on next time. Set it for a slow war of attrition; leave it at 0 for the built-in behaviour.",
      }),
    ]),
  }),
  // How much of a time skip belongs to the player's own country
  // (src/Game/AI/playerFocus.js). The scenario sets the level a new game starts
  // on — a tight one-nation campaign wants a different default from a world
  // sandbox — and the player changes it for their own game in Settings, AI,
  // Generation behavior. Off: no minimum share of Player events at all; the
  // world's share above still applies.
  Object.freeze({
    key: "playerFocus",
    label: "Player focus",
    // No on/off: every game has some balance between the player and the world,
    // and switching a level off would only mean "ignore the level", which is
    // what World first already says in words a player understands.
    toggleable: false,
    description: "How much of each time skip is about the player's own country, as far as they have something going on — orders, Project dates due, wars, open threads. In a quiet stretch the world fills the skip whatever this says, and it never invents business for the player. The player can change it for their own game.",
    settings: Object.freeze([
      Object.freeze({
        key: "level",
        type: "choice",
        label: "The scenario starts on",
        defaultValue: "balanced",
        options: Object.freeze([
          Object.freeze({ value: "world-first", label: "World first", description: "At least a quarter of a skip is the player's when they have something going on." }),
          Object.freeze({ value: "balanced", label: "Balanced", description: "At least 40%. The built-in feel." }),
          Object.freeze({ value: "focused", label: "Focused", description: "At least 60%, and other powers' plans take less of what the simulator is shown." }),
          Object.freeze({ value: "spotlight", label: "Spotlight", description: "At least three quarters, and the wider world is kept to what matters most." }),
        ]),
        description: "Where a new game on this scenario starts. Players change it for their own game in Settings.",
      }),
    ]),
  }),
]);

export const FEATURE_KEYS = Object.freeze(FEATURE_DEFINITIONS.map((definition) => definition.key));

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "on", "yes", "enabled", "1"].includes(text)) return true;
    if (["false", "off", "no", "disabled", "0"].includes(text)) return false;
  }
  return null;
};

// A setting is a number unless it says `type: "text"`. Blank text is "not set":
// a scenario's blank is its default, and a game's blank follows the scenario.
const readSetting = (value, setting) => {
  // A choice is one of the values the setting lists. Anything else — a value
  // from an older build, a typo in an imported scenario — is "not set", so the
  // scenario's default (or the built-in one) stands rather than a level the
  // engine cannot read.
  if (setting.type === "choice") {
    const text = String(value ?? "").trim().toLowerCase();
    return setting.options.some((option) => option.value === text) ? text : null;
  }
  if (setting.type === "text") {
    if (typeof value !== "string") return null;
    const text = value.replace(/\r\n/g, "\n").trim().slice(0, setting.maxLength || 2000);
    return text || null;
  }
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const clamped = Math.min(setting.max, Math.max(setting.min, number));
  return setting.step >= 1 ? Math.round(clamped) : clamped;
};

// `{ espionage: false }` is accepted as shorthand for `{ espionage: { enabled: false } }`.
const readEntry = (entry) => (isRecord(entry) ? entry : { enabled: entry });

// The built-in defaults: everything on, every setting at its default.
export const featureDefaults = () => normalizeFeatureSettings(null);

// A scenario's configuration, made complete: every feature and every setting
// present, defaults filling anything missing or malformed.
export const normalizeFeatureSettings = (raw) => {
  const source = isRecord(raw) ? raw : {};
  const settings = {};
  for (const definition of FEATURE_DEFINITIONS) {
    const entry = readEntry(source[definition.key]);
    // A feature with no on/off is always on, whatever an older save stored.
    const resolved = { enabled: definition.toggleable === false ? true : readBoolean(entry.enabled) ?? true };
    for (const setting of definition.settings) {
      resolved[setting.key] = readSetting(entry[setting.key], setting) ?? setting.defaultValue;
    }
    settings[definition.key] = resolved;
  }
  return settings;
};

// A game's overrides: only what it explicitly sets, so an unset field keeps
// following the scenario. Unknown features and malformed values are dropped.
export const normalizeFeatureOverrides = (raw) => {
  const source = isRecord(raw) ? raw : {};
  const overrides = {};
  for (const definition of FEATURE_DEFINITIONS) {
    if (source[definition.key] === undefined || source[definition.key] === null) continue;
    const entry = readEntry(source[definition.key]);
    const resolved = {};
    const enabled = definition.toggleable === false ? null : readBoolean(entry.enabled);
    if (enabled !== null) resolved.enabled = enabled;
    for (const setting of definition.settings) {
      const value = readSetting(entry[setting.key], setting);
      if (value !== null) resolved[setting.key] = value;
    }
    if (Object.keys(resolved).length) overrides[definition.key] = resolved;
  }
  return overrides;
};

// What a game actually plays with: the scenario's configuration under the
// game's overrides.
export const resolveFeatures = (scenarioFeatures, gameFeatures) => {
  const base = normalizeFeatureSettings(scenarioFeatures);
  const overrides = normalizeFeatureOverrides(gameFeatures);
  const resolved = {};
  for (const definition of FEATURE_DEFINITIONS) {
    resolved[definition.key] = { ...base[definition.key], ...(overrides[definition.key] ?? {}) };
  }
  return resolved;
};

export const isFeatureEnabled = (features, key) => features?.[key]?.enabled !== false;

// The director's settings as the engine reads them: null when world direction is
// off for this game, so every caller's "nothing to enforce" is one check.
export const worldDirectionOf = (features) => {
  const direction = features?.worldDirection;
  if (!direction || direction.enabled === false) return null;
  const percent = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    eventPace: percent(direction.eventPace, 100),
    worldShare: percent(direction.worldShare, 35),
    priorityRules: typeof direction.priorityRules === "string" ? direction.priorityRules.trim() : "",
    scriptedEvents: typeof direction.scriptedEvents === "string" ? direction.scriptedEvents.trim() : "",
    territoryTempo: percent(direction.territoryTempo, 0),
  };
};

// The Player focus level this game plays with (src/Game/AI/playerFocus.js holds
// what each level means). Always a level: the feature has no on/off.
export const playerFocusOf = (features) => {
  const level = features?.playerFocus?.level;
  return typeof level === "string" && level ? level : "balanced";
};

// Idle diplomacy rolls once a minute while the game is on screen; an average
// interval of N minutes is a chance of 1/N per roll. 0 when the feature is off.
export const idleDiplomacyChancePerMinute = (features) => {
  const idle = features?.idleDiplomacy;
  if (!idle || idle.enabled === false) return 0;
  const minutes = Number(idle.averageMinutes);
  return 1 / Math.max(1, Number.isFinite(minutes) ? minutes : 8);
};
