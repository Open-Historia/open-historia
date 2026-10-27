import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAP_KEYS = {
  defaultBasemap: "map_basemap_default",
  defaultBasemapOn: "map_basemap_default_on",
  mapMode: "map_mode",
  labelFont: "map_label_font",
  scenarioTerrain: "map_scenario_terrain",
  hideCountryLabels: "map_hide_country_labels",
  disableIdleRotation: "map_disable_idle_rotation",
  disableEventCamera: "map_disable_event_camera",
  limitAiGeneration: "ai_limit_generation",
  batchBackgroundTasks: "ai_batch_background_tasks",
  chunkLongJumps: "ai_chunk_long_jumps",
  lookupFunctions: "ai_lookup_functions",
  liveSkipEvents: "ai_live_skip_events",
  stopOnPlayerFailures: "ai_stop_on_player_failures",
  discordPresence: "privacy_discord_presence",
  ambientMusic: "audio_ambient_music",
  musicVolume: "audio_music_volume",
  soundEffects: "audio_sound_effects",
  vaultDoorAlways: "vault_door_every_time",
  seasonsWeather: "map_seasons_weather",
  weatherEffects: "map_weather_effects",
};

const DEFAULT_ON = new Set([
  MAP_KEYS.lookupFunctions, MAP_KEYS.liveSkipEvents, MAP_KEYS.discordPresence, MAP_KEYS.ambientMusic,
  MAP_KEYS.soundEffects, MAP_KEYS.seasonsWeather, MAP_KEYS.weatherEffects,
]);

const FLAG_LABELS = {
  [MAP_KEYS.hideCountryLabels]: "Hide country labels",
  [MAP_KEYS.disableIdleRotation]: "Disable idle globe rotation",
  [MAP_KEYS.disableEventCamera]: "Disable camera movement during events",
  [MAP_KEYS.limitAiGeneration]: "Limit AI generation",
  [MAP_KEYS.batchBackgroundTasks]: "Batch background AI tasks",
  [MAP_KEYS.chunkLongJumps]: "Generate long time skips in segments",
  [MAP_KEYS.lookupFunctions]: "AI lookup functions",
  [MAP_KEYS.liveSkipEvents]: "Show time skip events as they are written",
  [MAP_KEYS.stopOnPlayerFailures]: "Stop when my events fail",
  [MAP_KEYS.discordPresence]: "Show what I am playing on Discord",
  [MAP_KEYS.ambientMusic]: "Music",
  [MAP_KEYS.soundEffects]: "Sound effects",
  [MAP_KEYS.vaultDoorAlways]: "Vault door every time the game opens",
  [MAP_KEYS.seasonsWeather]: "Seasons and weather",
  [MAP_KEYS.weatherEffects]: "Weather effects",
  [MAP_KEYS.defaultBasemapOn]: "Use my default basemap",
};

const VALUE_LABELS = {
  [MAP_KEYS.defaultBasemap]: "Default basemap",
  [MAP_KEYS.labelFont]: "Label font",
  [MAP_KEYS.musicVolume]: "Music volume",
  [MAP_KEYS.scenarioTerrain]: "Scenario terrain",
};

const LANGUAGES = [
  ["en", "English", "English"], ["zh", "Chinese (Mandarin)", "中文"], ["hi", "Hindi", "हिन्दी"], ["es", "Spanish", "Español"],
  ["fr", "French", "Français"], ["ar", "Arabic", "العربية"], ["bn", "Bengali", "বাংলা"], ["pt", "Portuguese", "Português"],
  ["ru", "Russian", "Русский"], ["ur", "Urdu", "اردو"], ["id", "Indonesian", "Bahasa Indonesia"], ["de", "German", "Deutsch"],
  ["ja", "Japanese", "日本語"], ["sw", "Swahili", "Kiswahili"], ["mr", "Marathi", "मराठी"], ["te", "Telugu", "తెలుగు"],
  ["tr", "Turkish", "Türkçe"], ["ta", "Tamil", "தமிழ்"], ["vi", "Vietnamese", "Tiếng Việt"], ["ko", "Korean", "한국어"],
  ["it", "Italian", "Italiano"], ["ha", "Hausa", "Hausa"], ["th", "Thai", "ไทย"], ["gu", "Gujarati", "ગુજરાતી"],
  ["kn", "Kannada", "ಕನ್ನಡ"], ["fa", "Persian", "فارسی"], ["pl", "Polish", "Polski"], ["uk", "Ukrainian", "Українська"],
  ["ml", "Malayalam", "മലയാളം"], ["my", "Burmese", "မြန်မာ"], ["pa", "Punjabi", "ਪੰਜਾਬੀ"], ["ro", "Romanian", "Română"],
  ["nl", "Dutch", "Nederlands"], ["el", "Greek", "Ελληνικά"], ["cs", "Czech", "Čeština"], ["hu", "Hungarian", "Magyar"],
  ["sv", "Swedish", "Svenska"], ["he", "Hebrew", "עברית"], ["ms", "Malay", "Bahasa Melayu"], ["fil", "Filipino", "Filipino"],
  ["am", "Amharic", "አማርኛ"], ["ne", "Nepali", "नेपाली"], ["si", "Sinhala", "සිංහල"], ["km", "Khmer", "ខ្មែរ"],
  ["so", "Somali", "Soomaali"], ["az", "Azerbaijani", "Azərbaycanca"], ["uz", "Uzbek", "Oʻzbekcha"], ["yo", "Yoruba", "Yorùbá"],
  ["fi", "Finnish", "Suomi"], ["da", "Danish", "Dansk"],
].map(([code, name, native]) => ({ code, name, native }));

const SHIPPED_PACKS = new Set(["ar", "bn", "de", "es", "fa", "fr", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv", "th", "tr", "uk", "ur", "vi", "zh"]);

const PLAYER_FOCUS_LEVELS = [
  { key: "world-first", label: "World first" },
  { key: "balanced", label: "Balanced" },
  { key: "focused", label: "Focused" },
  { key: "spotlight", label: "Spotlight" },
];

const OTHER_REQUEST_TASKS = [
  { key: "translation", label: "Translation" },
  { key: "other", label: "Other" },
  { key: "direct", label: "Other" },
];

const STRUCTURED_MODE_LABELS = {
  auto: "Automatic (recommended)",
  tool: "Tool calling",
  json_schema: "JSON schema",
  json_object: "JSON object",
  text_json: "Plain text",
};

const STRUCTURED_MODE_INTRO = "How the game asks your AI for answers it can read. Leave this on Automatic — "
  + "the game works out what your model supports, and will offer to speed things "
  + "up if it finds a better fit.";

const STRUCTURED_MODE_HINTS = {
  auto: "The game tries the best method first and falls back if your model can't use it. Right for almost everyone.",
  tool: "For models that follow instructions strictly. Most paid models do. Changing your model resets this to Automatic.",
  json_schema: "For models that struggle with the strictest method. Common on free and self-hosted models. Changing your model resets this to Automatic.",
  json_object: "For older or simpler models. Changing your model resets this to Automatic.",
  text_json: "Last resort, for models that can't manage anything stricter. Changing your model resets this to Automatic.",
};

const CSV_COLUMNS = [
  "id", "startedAt", "provider", "model", "taskKey", "attempt", "maxAttempts",
  "batch", "simulatedDays", "promptTokens", "outputTokens", "cachedTokens",
  "thinkingTokens", "latencyMs", "firstByteMs", "systemPromptChars",
  "responseChars", "staticPrefixEnd", "ok", "validationError", "rating",
  "eventCount", "stopDate", "lookupRounds", "lookupCalls", "lookupNames",
  "requestsOk", "requestsRefused", "requestsFailed",
];

const isLocalHostname = (hostname) => {
  const host = String(hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  if (host.endsWith(".local")) return true;
  return /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
};

const endpointIsLocal = (endpoint) => {
  const value = String(endpoint ?? "").trim();
  if (!value) return false;
  try {
    return isLocalHostname(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname);
  } catch {
    return false;
  }
};

const formatTokens = (tokens) => (tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens));

const describeRememberedWindow = (known) => {
  const formatDate = (ms) => new Date(ms).toLocaleDateString();
  if (!known) return "Leave blank and the game learns this model's window from its own refusal. Set it only if you know it.";
  if (known.source === "declared") return `You set this model's window to ${formatTokens(known.limitTokens)} tokens. A request too big for it is not sent to it.`;
  if (known.limitTokens > 0) return `The model said its window is ${formatTokens(known.limitTokens)} tokens. A request too big for it is not sent to it until ${formatDate(known.until)}.`;
  return `The model refused a request of about ${formatTokens(known.tooBigTokens)} tokens. One that big is not sent to it until ${formatDate(known.until)}.`;
};

const contextWindowKey = (entry) => [entry?.provider, entry?.endpoint, entry?.model].map((value) => String(value ?? "").trim().toLowerCase()).join("|");

const normalizePlayerFocus = (value) => {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return PLAYER_FOCUS_LEVELS.some((level) => level.key === key) ? key : "balanced";
};

const playerFocusOf = (features) => {
  const level = features?.playerFocus?.level;
  return typeof level === "string" && level ? level : "balanced";
};

const formatCacheSize = (bytes) => (bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`);

const formatZipSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtInt = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value).toLocaleString() : "—");
const fmtMs = (value) => (Number.isFinite(Number(value)) && value !== null ? `${(Number(value) / 1000).toFixed(1)}s` : "—");
const fmtTime = (ms) => {
  if (!Number.isFinite(ms)) return "—";
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const requestCount = (record) => {
  const requests = record?.requests;
  if (!requests || typeof requests !== "object") return null;
  return (Number(requests.ok) || 0) + (Number(requests.refused) || 0) + (Number(requests.failed) || 0);
};

const requestsTitle = (record) => {
  const requests = record?.requests ?? {};
  return `${requests.ok ?? 0} answered · ${requests.refused ?? 0} refused (429) · ${requests.failed ?? 0} failed`;
};

const emptyRow = (label) => ({ label, calls: 0, failed: 0, lookups: 0, requests: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, latencySum: 0, latencyN: 0, ratingSum: 0, ratingN: 0 });

const addRecordToRow = (row, record) => {
  row.calls += 1;
  if (record.ok === false) row.failed += 1;
  row.lookups += record.lookups?.calls ?? 0;
  row.requests += requestCount(record) ?? 0;
  if (record.usage) {
    row.tokensIn += record.usage.promptTokens ?? 0;
    row.tokensOut += record.usage.outputTokens ?? 0;
    row.cacheRead += record.usage.cachedTokens ?? 0;
  }
  if (Number.isFinite(record.latencyMs)) { row.latencySum += record.latencyMs; row.latencyN += 1; }
  if (Number.isFinite(record.rating)) { row.ratingSum += record.rating; row.ratingN += 1; }
};

const rowView = (row) => ({
  label: row.label,
  calls: String(row.calls),
  failed: row.failed ? String(row.failed) : "",
  lookups: row.lookups ? String(row.lookups) : "",
  requests: row.requests ? String(row.requests) : "",
  tokensIn: fmtInt(row.tokensIn),
  tokensOut: fmtInt(row.tokensOut),
  cacheRead: fmtInt(row.cacheRead),
  avgLatency: row.latencyN ? fmtMs(row.latencySum / row.latencyN) : "—",
  avgRating: row.ratingN ? (row.ratingSum / row.ratingN).toFixed(1) : "—",
  tokensInValue: row.tokensIn,
});

export const register = (ctx) => {
  const { engine, api, emit, plain, storage, clean, list } = ctx;
  const pc = () => engine.providerConfig;
  const rb = () => engine.requestBudget;
  const dl = () => engine.debugLog;
  const ms = () => engine.mapSettings;
  let activeRequests = 0;
  let generationCount = 0;

  const dispatch = (name, detail) => {
    try {
      globalThis.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));
    } catch {
      return;
    }
  };

  const logSetting = (label, value) => {
    try {
      dl()?.logSettingChange?.(label, value);
    } catch {
      return;
    }
  };

  const logEvent = (category, message) => {
    try {
      dl()?.logDebugEvent?.(category, message);
    } catch {
      return;
    }
  };

  const readFlag = (key) => {
    if (ms()?.getMapSetting && !DEFAULT_ON.has(key)) return ms().getMapSetting(key);
    if (ms()?.getMapSettingDefaultOn && DEFAULT_ON.has(key)) return ms().getMapSettingDefaultOn(key);
    const stored = storage.getItem(key);
    return DEFAULT_ON.has(key) ? stored !== "0" : stored === "1";
  };

  const writeFlag = (key, value) => {
    if (ms()?.setMapSetting) {
      ms().setMapSetting(key, Boolean(value));
    } else {
      storage.setItem(key, value ? "1" : "0");
      logEvent("setting", `${FLAG_LABELS[key] || key} turned ${value ? "on" : "off"}.`);
      dispatch("mapSettings:updated");
    }
    storage.flush();
  };

  const readValue = (key, fallback = "") => {
    if (ms()?.getMapSettingValue) return ms().getMapSettingValue(key, fallback);
    const stored = storage.getItem(key);
    return stored === null ? fallback : stored;
  };

  const writeValue = (key, value) => {
    if (ms()?.setMapSettingValue) {
      ms().setMapSettingValue(key, value);
    } else {
      const normalized = String(value ?? "").trim();
      if (normalized !== readValue(key, "")) logSetting(VALUE_LABELS[key] || key, normalized || "scenario default");
      if (normalized && key !== MAP_KEYS.mapMode) storage.setItem(key, normalized);
      else storage.removeItem(key);
      dispatch("mapSettings:updated", { key, value: normalized });
    }
    storage.flush();
  };

  const readJsonFlag = (key, fallback) => {
    const saved = storage.getItem(key);
    if (saved === null) return fallback;
    try {
      return Boolean(JSON.parse(saved));
    } catch {
      return fallback;
    }
  };

  const libraryState = () => engine.getLibraryState?.() ?? {};

  const context = () => {
    const library = libraryState();
    const game = library.activeGame ?? null;
    return {
      gameId: clean(library.activeGameId ?? game?.id),
      gameName: clean(game?.name),
      scenarioName: clean(library.runtimeScenario?.name),
      countryName: clean(game?.country),
      date: clean(game?.currentDate),
    };
  };

  const values = () => {
    const flags = {};
    for (const key of Object.values(MAP_KEYS)) {
      if ([MAP_KEYS.defaultBasemap, MAP_KEYS.mapMode, MAP_KEYS.labelFont, MAP_KEYS.scenarioTerrain, MAP_KEYS.musicVolume].includes(key)) continue;
      flags[key] = readFlag(key);
    }
    const volumeText = String(readValue(MAP_KEYS.musicVolume, "")).trim();
    const volumeNumber = volumeText === "" ? Number.NaN : Number(volumeText);
    const uiLanguage = clean(storage.getItem("ui_language")) || "en";
    const chatLanguage = clean(storage.getItem("ai_chat_language")) || uiLanguage;
    const telemetryStored = storage.getItem("ai_debug_telemetry");
    const deviceOverride = clean(storage.getItem("oh_device_profile"));
    return {
      flags,
      mapMode: readValue(MAP_KEYS.mapMode, "political") || "political",
      labelFont: readValue(MAP_KEYS.labelFont, ""),
      scenarioTerrain: readValue(MAP_KEYS.scenarioTerrain, "") === "painted" ? "painted" : "",
      defaultBasemap: readValue(MAP_KEYS.defaultBasemap, ""),
      musicVolume: Number.isFinite(volumeNumber) ? Math.max(0, Math.min(100, Math.round(volumeNumber))) : 25,
      globe: readJsonFlag("Globe", false),
      terrain: readJsonFlag("Terrain", true),
      reasoning: storage.getItem("ai_reasoning_enabled") !== "0",
      telemetry: telemetryStored !== "0",
      rating: storage.getItem("ai_rate_generations") === "1",
      uiLanguage,
      chatLanguage,
      languages: LANGUAGES.map((entry) => ({ ...entry, builtIn: entry.code === "en" || SHIPPED_PACKS.has(entry.code) })),
      deviceProfile: deviceOverride === "constrained" || deviceOverride === "full" ? deviceOverride : "",
      labelFonts: list(ms()?.LABEL_FONT_SUGGESTIONS).length ? [...ms().LABEL_FONT_SUGGESTIONS] : ["Georgia", "Times New Roman", "Garamond", "Palatino Linotype", "Impact", "Arial Black", "Arial", "Trebuchet MS", "Verdana", "Courier New", "Comic Sans MS"],
      basemaps: list(engine.assets?.ESRI_BASEMAPS).map((entry) => ({ id: clean(entry?.id), label: clean(entry?.label) })),
      defaultBasemapId: clean(engine.assets?.DEFAULT_BASEMAP_ID),
      context: context(),
    };
  };

  const formatResetTime = (when) => {
    if (engine.fallbackRunner?.formatResetTime) return engine.fallbackRunner.formatResetTime(when);
    return new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatAgo = (when, at) => {
    const minutes = Math.round(Math.max(0, at - when) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(when).toLocaleDateString();
  };

  const describeRowStatus = (status, at) => {
    if (status.status === "spent") return `Spent until ${formatResetTime(status.until)}`;
    if (status.status === "unusable") return `Unusable: ${status.reason}`;
    if (status.status === "busy") {
      const seconds = Math.max(1, Math.ceil((status.until - at) / 1000));
      return `${status.reason === "rate limited" ? "Rate limited" : "Busy"}, for about ${seconds < 90 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}`;
    }
    return "Ready";
  };

  const providerView = (provider) => {
    const meta = pc().getProviderMeta(provider);
    return { value: meta.value, label: meta.label, group: meta.group, description: meta.description, searchTerms: list(meta.searchTerms) };
  };

  const fallbackView = () => {
    const config = pc();
    const at = Date.now();
    const connections = config.getConnections();
    const resolvedList = config.getResolvedFallbackList();
    const resolved = new Map(resolvedList.map((entry) => [entry.id, entry]));
    const listEntries = config.getFallbackList();
    const windows = engine.aiMain?.contextWindows ?? null;
    const entries = listEntries.map((entry, index) => {
      const own = resolved.get(entry.id) ?? null;
      const status = config.getEntryStatus(entry.id, at);
      let windowView = null;
      if (own && own.provider !== config.AGENT_PROVIDER) {
        const known = windows?.remembered ? windows.remembered(contextWindowKey(own), { trustLearned: !endpointIsLocal(own.endpoint) }) : null;
        windowView = {
          available: Boolean(windows?.remembered),
          value: known?.source === "declared" ? String(known.limitTokens) : "",
          helper: describeRememberedWindow(known),
          known: Boolean(known),
        };
      }
      return {
        id: entry.id,
        index,
        connectionId: entry.connectionId,
        model: entry.model,
        customParamsOverride: entry.customParamsOverride,
        structuredMode: entry.structuredMode,
        resolved: own ? { label: own.label, provider: own.provider, providerLabel: config.getProviderMeta(own.provider).label, endpoint: own.endpoint } : null,
        providerLabel: config.getProviderMeta(own?.provider).label,
        status: status.status,
        statusText: describeRowStatus(status, at),
        answered: status.lastAnsweredAt ? ` · answered ${formatAgo(status.lastAnsweredAt, at)}` : "",
        window: windowView,
      };
    });
    const connectionViews = connections.map((connection) => {
      const using = listEntries.filter((entry) => entry.connectionId === connection.id).length;
      const meta = config.getProviderMeta(connection.provider);
      const selfHosted = config.providerSetupRequirement(connection.provider) === "endpoint";
      const agent = connection.provider === config.AGENT_PROVIDER;
      const detail = agent
        ? (connection.paused ? " · paused" : " · answers through /answer")
        : selfHosted ? ` · ${connection.endpoint || "no endpoint"}` : ` · key ${connection.apiKey.trim() ? "set" : "not set"}`;
      return {
        ...connection,
        displayName: config.connectionDisplayName(connection),
        providerLabel: meta.label,
        provider: meta.value,
        providerMeta: providerView(connection.provider),
        selfHosted,
        agent,
        using,
        summary: `${meta.label}${detail} · used by ${using} entr${using === 1 ? "y" : "ies"}`,
        recentModels: [...new Set([connection.suggestedModel, ...config.getRecentModels(connection.provider)].filter(Boolean))],
      };
    });
    const picks = {};
    for (const { key } of config.AI_TASK_ROUTING) picks[key] = config.getTaskPick(key);
    return {
      at,
      entries,
      connections: connectionViews,
      rateLimitPolicy: config.getRateLimitPolicy(),
      providers: config.providerOptionsFor({ localServer: true }).map((option) => ({ value: option.value, label: option.label, group: option.group, description: option.description, searchTerms: list(option.searchTerms) })),
      templates: config.CONNECTION_TEMPLATES.map((template) => ({ ...template })),
      routing: config.AI_TASK_ROUTING.map((entry) => ({ ...entry })),
      picks,
      geminiChain: [...config.GEMINI_DEFAULT_CHAIN],
      openaiDefault: config.OPENAI_DEFAULT_MODEL,
      agentProvider: config.AGENT_PROVIDER,
      defaultProvider: config.DEFAULT_PROVIDER,
      structuredLabels: STRUCTURED_MODE_LABELS,
      structuredHints: STRUCTURED_MODE_HINTS,
      structuredIntro: STRUCTURED_MODE_INTRO,
      contextWindowsAvailable: Boolean(windows?.remembered),
    };
  };

  const requestsView = () => {
    const budget = rb();
    const day = budget.requestDay();
    const labels = Object.fromEntries([...pc().AI_TASK_ROUTING, ...OTHER_REQUEST_TASKS].map(({ key, label }) => [key, label]));
    const control = engine.aiRequestControl ?? null;
    const active = control?.getActiveAiRequestCount ? control.getActiveAiRequestCount() : activeRequests;
    const share = day.limit > 0 ? Math.min(1, day.used / day.limit) : 0;
    return {
      used: day.used,
      limit: day.limit,
      share,
      resetText: formatResetTime(day.resetAt),
      lastJump: day.lastJump ? day.lastJump.used : null,
      background: day.background,
      backgroundCap: day.backgroundCap,
      refused: day.refused,
      failed: day.failed,
      tasks: budget.requestsByTask(day.byTask, labels),
      saving: budget.requestSettings.saveRequests(),
      backgroundOn: budget.requestSettings.backgroundAi(),
      dailyLimit: String(budget.requestSettings.dailyLimit()),
      backgroundDailyCap: String(budget.requestSettings.backgroundDailyCap()),
      lookupCap: budget.describeJumpCost({ lookups: true }).max,
      active,
      canCancel: typeof control?.cancelAllAiRequests === "function",
    };
  };

  const focusView = () => {
    const library = libraryState();
    const gameId = clean(library.activeGameId);
    const focusOf = engine.cmServerFeatures?.playerFocusOf ?? playerFocusOf;
    const scenarioLevel = normalizePlayerFocus(focusOf(library.runtimeScenario?.features));
    const override = clean(library.activeGame?.features?.playerFocus?.level);
    const active = engine.gameFeatures?.getActivePlayerFocus ? engine.gameFeatures.getActivePlayerFocus() : (override || scenarioLevel);
    const focus = normalizePlayerFocus(active);
    const scenarioLabel = PLAYER_FOCUS_LEVELS.find((level) => level.key === scenarioLevel)?.label ?? scenarioLevel;
    return { gameId, scenarioLevel, scenarioLabel, override, following: !override, focus, levels: PLAYER_FOCUS_LEVELS };
  };

  const diagnosticsView = () => {
    const log = dl();
    const bytes = Number(log?.getDebugLogBytes?.() ?? 0);
    const limit = Number(log?.getDebugLogLimitBytes?.() ?? 0);
    const formatLogSize = log?.formatLogSize ?? ((chars) => (chars < 1024 ? "<1 KB" : `${Math.round(chars / 1024)} KB`));
    const library = libraryState();
    return {
      available: Boolean(log?.isDebugLogEnabled),
      enabled: Boolean(log?.isDebugLogEnabled?.()),
      verbose: Boolean(log?.isDebugLogVerbose?.()),
      count: Number(log?.getDebugLogSize?.() ?? 0),
      bytesText: formatLogSize(bytes),
      limitText: formatLogSize(limit),
      dropped: Number(log?.getDebugLogDroppedCount?.() ?? 0),
      gameName: clean(library.activeGame?.name),
      gameId: clean(library.activeGameId),
    };
  };

  const exportDir = (dir) => {
    const target = clean(dir) || path.join(os.homedir(), "Downloads");
    fs.mkdirSync(target, { recursive: true });
    return target;
  };

  const writeExport = (dir, fileName, content) => {
    const target = path.join(exportDir(dir), fileName);
    fs.writeFileSync(target, content);
    return target;
  };

  const telemetryModule = () => engine.telemetry ?? engine.shellTelemetry ?? null;

  const telemetryRecords = async () => {
    return list(await telemetryModule().getAiRecords());
  };

  const summaryOf = (record) => ({
    id: record.id,
    startedAt: record.startedAt,
    time: fmtTime(record.startedAt),
    taskKey: record.taskKey || "direct",
    batch: Boolean(record.batch),
    attempt: record.attempt,
    maxAttempts: record.maxAttempts,
    model: record.model || "",
    provider: record.provider || "",
    ok: record.ok === true ? "ok" : record.ok === false ? "failed" : "pending",
    lookupCalls: record.lookups?.calls ?? 0,
    lookupRounds: record.lookups?.rounds ?? 0,
    requests: requestCount(record),
    requestsTitle: requestsTitle(record),
    usage: record.usage ? `↑${fmtInt(record.usage.promptTokens)} ↓${fmtInt(record.usage.outputTokens)}` : "no usage",
    latency: fmtMs(record.latencyMs),
    skip: record.skip ? `skip ${fmtMs(record.skip.totalMs)}` : "",
    skipTitle: record.skip ? `The request ${fmtMs(record.latencyMs)}; the whole time skip ${fmtMs(record.skip.totalMs)}` : "",
    rating: record.rating ? `${record.rating}/10` : "",
  });

  const detailOf = (record) => {
    const usage = record.usage ?? {};
    return {
      ...summaryOf(record),
      header: `${fmtTime(record.startedAt)} · ${record.provider || "?"} · ${record.model || "?"} · attempt ${record.attempt}/${record.maxAttempts}${record.batch ? " · batch" : ""}${Number.isFinite(record.staticPrefixEnd) && record.staticPrefixEnd > 0 ? ` · cacheable prefix ${fmtInt(record.staticPrefixEnd)} chars` : ""}`,
      tokensIn: fmtInt(usage.promptTokens),
      tokensInSub: usage.cachedTokens ? `${fmtInt(usage.cachedTokens)} from cache` : "",
      tokensOut: fmtInt(usage.outputTokens),
      tokensOutSub: usage.thinkingTokens ? `${fmtInt(usage.thinkingTokens)} thinking` : "",
      latencySub: Number.isFinite(record.firstByteMs) ? `first byte ${fmtMs(record.firstByteMs)}` : "",
      wholeSkip: record.skip ? fmtMs(record.skip.totalMs) : "",
      wholeSkipSub: record.skip ? `this request ${fmtMs(record.latencyMs)}` : "",
      requestsValue: requestCount(record) != null ? fmtInt(requestCount(record)) : "",
      phases: list(record.skip?.phases).map((line) => `${line.label} · ${fmtMs(line.ms)}${line.requests ? ` · ${line.requests} request${line.requests === 1 ? "" : "s"}` : ""}`),
      lookupsValue: record.lookups?.calls ? fmtInt(record.lookups.calls) : "",
      lookupsSub: record.lookups?.calls ? `${record.lookups.rounds} round${record.lookups.rounds === 1 ? "" : "s"} · ${fmtInt(record.lookups.chars)} chars answered` : "",
      status: record.ok === false ? "Failed" : record.ok === true ? "OK" : "Pending",
      statusSub: record.error ? "call error" : record.validationError ? "rejected by validation" : record.simulatedDays != null ? `${record.simulatedDays}d simulated` : "",
      parsedSummary: record.parsedSummary ?? null,
      validationError: record.validationError || "",
      error: record.error || "",
      ratingValue: Number(record.rating) || 0,
      lookupRoundsText: record.lookups?.entries?.length ? `${record.lookups.rounds} round${record.lookups.rounds === 1 ? "" : "s"} before the answer` : "",
      roundUsage: list(record.lookups?.roundUsage).map((round) => (round.cachedTokens
        ? `round ${round.round} · ↑${fmtInt(round.promptTokens)} ↓${fmtInt(round.outputTokens)} · ${fmtInt(round.cachedTokens)} cached · ${fmtMs(round.elapsedMs)}`
        : `round ${round.round} · ↑${fmtInt(round.promptTokens)} ↓${fmtInt(round.outputTokens)} · ${fmtMs(round.elapsedMs)}`)),
      lookupEntries: list(record.lookups?.entries).map((entry) => {
        let text = typeof entry.response === "string" ? entry.response : "";
        try {
          if (text) text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          text = entry.response;
        }
        return {
          title: `round ${entry.round} · ${entry.label || entry.name}${entry.error ? " · ERROR" : ""}${Number.isFinite(entry.ms) ? ` · ${entry.ms} ms` : ""} · ${fmtInt(entry.responseChars)} chars`,
          text,
        };
      }),
      systemPrompt: record.systemPrompt || "",
      userMessage: record.userMessage || "",
      rawResponse: record.rawResponse || "",
    };
  };

  const analyticsOf = (records) => {
    const byTask = new Map();
    const byModel = new Map();
    let tokensIn = 0;
    let tokensOut = 0;
    let cacheRead = 0;
    let latencyN = 0;
    let latencySum = 0;
    let failed = 0;
    let ratingSum = 0;
    let ratingN = 0;
    let simulatedDays = 0;
    for (const record of records) {
      const task = String(record.taskKey ?? "") || "direct";
      const taskRow = byTask.get(task) ?? emptyRow(task);
      addRecordToRow(taskRow, record);
      byTask.set(task, taskRow);
      const model = String(record.model ?? "") || "(unknown)";
      const modelRow = byModel.get(model) ?? emptyRow(model);
      addRecordToRow(modelRow, record);
      byModel.set(model, modelRow);
      if (record.usage) {
        tokensIn += record.usage.promptTokens ?? 0;
        tokensOut += record.usage.outputTokens ?? 0;
        cacheRead += record.usage.cachedTokens ?? 0;
      }
      if (record.ok === false) failed += 1;
      if (Number.isFinite(record.latencyMs)) { latencySum += record.latencyMs; latencyN += 1; }
      if (Number.isFinite(record.rating)) { ratingSum += record.rating; ratingN += 1; }
      if (Number.isFinite(record.simulatedDays) && record.ok === true) simulatedDays += record.simulatedDays;
    }
    const tasks = [...byTask.values()].sort((a, b) => b.tokensIn - a.tokensIn);
    const models = [...byModel.values()].sort((a, b) => b.calls - a.calls);
    const avgRating = ratingN ? ratingSum / ratingN : null;
    return {
      cards: {
        generations: fmtInt(records.length),
        failed: fmtInt(failed),
        failedSub: `${records.length ? Math.round(100 * failed / records.length) : 0}% of calls`,
        tokensIn: fmtInt(tokensIn),
        tokensInSub: cacheRead ? `${fmtInt(cacheRead)} from cache` : "",
        tokensOut: fmtInt(tokensOut),
        avgLatency: fmtMs(latencyN ? latencySum / latencyN : null),
        avgRating: avgRating != null ? `${avgRating.toFixed(1)}/10` : "—",
        ratingSub: `${ratingN} rated`,
        simulated: simulatedDays ? `${fmtInt(simulatedDays)}d` : "—",
      },
      tasks: tasks.map(rowView),
      models: models.map(rowView),
      maxTokensByTask: Math.max(1, ...tasks.map((entry) => entry.tokensIn)),
    };
  };

  const filterRecords = (records, { task = "all", model = "", status = "all", search = "", sort = "newest" } = {}) => {
    const needle = clean(search).toLowerCase();
    return [...records]
      .reverse()
      .filter((record) => {
        if (task !== "all" && String(record.taskKey ?? "") !== task) return false;
        if (model && String(record.model ?? "") !== model) return false;
        if (status === "ok" && record.ok !== true) return false;
        if (status === "failed" && record.ok !== false) return false;
        if (needle) {
          const haystack = `${record.taskKey} ${record.model} ${list(record.lookups?.entries).map((entry) => entry.label || entry.name).join(" ")} ${record.systemPrompt ?? ""} ${record.rawResponse ?? ""} ${record.validationError ?? ""}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => (sort === "requests" ? (requestCount(b) ?? -1) - (requestCount(a) ?? -1) : 0))
      .slice(0, 200);
  };

  const exportCsv = (records) => {
    const clip = (text, max) => {
      const value = typeof text === "string" ? text : "";
      return value.length > max ? value.slice(0, max) : value;
    };
    const rows = [CSV_COLUMNS.join(",")];
    for (const record of records) {
      rows.push([
        record.id, new Date(record.startedAt ?? 0).toISOString(), record.provider, record.model, record.taskKey, record.attempt,
        record.maxAttempts, record.batch ? "batch" : "", record.simulatedDays, record.usage?.promptTokens ?? "",
        record.usage?.outputTokens ?? "", record.usage?.cachedTokens ?? "", record.usage?.thinkingTokens ?? "", record.latencyMs,
        record.firstByteMs, record.systemPromptChars, record.responseChars, record.staticPrefixEnd,
        record.ok === true ? "ok" : record.ok === false ? "failed" : "", clip(record.validationError, 200).replace(/\s+/g, " "),
        record.rating ?? "", record.parsedSummary?.eventCount ?? "", record.parsedSummary?.stopDate ?? "", record.lookups?.rounds ?? "",
        record.lookups?.calls ?? "", list(record.lookups?.entries).map((entry) => entry.name).join(" "), record.requests?.ok ?? "",
        record.requests?.refused ?? "", record.requests?.failed ?? "",
      ].map(csvCell).join(","));
    }
    return rows.join("\n");
  };

  let emitTimer = null;
  const pending = new Set();
  const announce = (name) => {
    pending.add(name);
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      const names = [...pending];
      pending.clear();
      for (const event of names) emit(event, {});
    }, 200);
  };

  try {
    globalThis.addEventListener("ai:fallback-changed", () => announce("settings.fallback_changed"));
    globalThis.addEventListener("ai:request-budget", () => announce("settings.requests_changed"));
    globalThis.addEventListener("ai:request-control", (event) => {
      const active = Number(event?.detail?.active);
      if (Number.isFinite(active)) activeRequests = active;
      announce("settings.requests_changed");
    });
    globalThis.addEventListener("oh:ai-generation-complete", () => {
      generationCount += 1;
      announce("telemetry.changed");
    });
  } catch {
    activeRequests = 0;
  }

  const methods = {
    "settings.context": async () => context(),
    "settings.values": async () => values(),
    "settings.flag": async ({ key, value }) => {
      if (!Object.values(MAP_KEYS).includes(key)) throw new Error(`Unknown setting: ${key}`);
      writeFlag(key, Boolean(value));
      return values();
    },
    "settings.value": async ({ key, value }) => {
      if (![MAP_KEYS.mapMode, MAP_KEYS.labelFont, MAP_KEYS.scenarioTerrain, MAP_KEYS.defaultBasemap, MAP_KEYS.musicVolume].includes(key)) throw new Error(`Unknown setting: ${key}`);
      writeValue(key, value);
      return { key, value: readValue(key, "") };
    },
    "settings.reduceMotion": async ({ value }) => {
      writeFlag(MAP_KEYS.disableIdleRotation, Boolean(value));
      writeFlag(MAP_KEYS.disableEventCamera, Boolean(value));
      return values();
    },
    "settings.reasoning": async ({ value }) => {
      pc().setReasoningEnabled(Boolean(value));
      storage.flush();
      return values();
    },
    "settings.telemetry": async ({ value }) => {
      storage.setItem("ai_debug_telemetry", value ? "1" : "0");
      dispatch("oh:telemetry-settings");
      logSetting("Record AI telemetry", Boolean(value));
      storage.flush();
      return values();
    },
    "settings.rating": async ({ value }) => {
      storage.setItem("ai_rate_generations", value ? "1" : "0");
      dispatch("oh:telemetry-settings");
      logSetting("Rate AI generations", Boolean(value));
      storage.flush();
      return values();
    },
    "settings.chatLanguage": async ({ code }) => {
      const value = clean(code);
      if (!value) storage.removeItem("ai_chat_language");
      else storage.setItem("ai_chat_language", value);
      logSetting("AI chat language", LANGUAGES.find((entry) => entry.code === value)?.name || value);
      storage.flush();
      return values();
    },
    "settings.fallback": async () => fallbackView(),
    "settings.connection.add": async ({ fields = {} } = {}) => {
      const id = pc().addConnection(fields);
      storage.flush();
      return { id, view: fallbackView() };
    },
    "settings.connection.ensure": async () => {
      const connections = pc().getConnections();
      const id = connections[0]?.id ?? pc().addConnection({ provider: pc().DEFAULT_PROVIDER });
      storage.flush();
      return { id };
    },
    "settings.connection.update": async ({ id, patch = {} }) => {
      pc().updateConnection(id, patch);
      storage.flush();
      return fallbackView();
    },
    "settings.connection.remove": async ({ id }) => {
      pc().removeConnection(id);
      storage.flush();
      return fallbackView();
    },
    "settings.connection.removeQuestion": async ({ id }) => {
      const config = pc();
      const connection = config.getConnections().find((candidate) => candidate.id === id);
      if (!connection) return { question: "" };
      const resolved = new Map(config.getResolvedFallbackList().map((entry) => [entry.id, entry]));
      const usingIds = new Set(config.entriesUsingConnection(id).map((entry) => entry.id));
      const using = config.getFallbackList()
        .map((entry, index) => (usingIds.has(entry.id) ? `${index + 1}. ${resolved.get(entry.id)?.label ?? entry.model}` : null))
        .filter(Boolean);
      const name = config.connectionDisplayName(connection);
      return {
        question: using.length
          ? `Remove "${name}"? These entries in your list use it and will be removed too:\n\n${using.join("\n")}`
          : `Remove "${name}"?`,
      };
    },
    "settings.entry.add": async ({ connectionId = "", model = "" } = {}) => {
      const config = pc();
      const entries = config.getFallbackList();
      const connections = config.getConnections();
      const target = clean(connectionId) || entries[entries.length - 1]?.connectionId || connections[0]?.id || config.addConnection({ provider: config.DEFAULT_PROVIDER });
      const id = config.addEntry({ connectionId: target, model });
      storage.flush();
      return { id, view: fallbackView() };
    },
    "settings.entry.update": async ({ id, patch = {} }) => {
      pc().updateEntry(id, patch);
      storage.flush();
      return fallbackView();
    },
    "settings.entry.remove": async ({ id }) => {
      pc().removeEntry(id);
      storage.flush();
      return fallbackView();
    },
    "settings.entry.move": async ({ id, to }) => {
      pc().moveEntry(id, Number(to));
      storage.flush();
      return fallbackView();
    },
    "settings.entry.reset": async ({ id }) => {
      pc().resetEntryState(id);
      storage.flush();
      return fallbackView();
    },
    "settings.entry.window": async ({ id, tokens = null, forget = false }) => {
      const windows = engine.aiMain?.contextWindows;
      if (!windows) throw new Error("The context window memory is not in the native engine yet.");
      const entry = pc().getResolvedFallbackList().find((candidate) => candidate.id === id);
      if (!entry) throw new Error("That entry is gone.");
      const key = contextWindowKey(entry);
      if (forget) windows.forget(key);
      else windows.declare(key, Number(tokens));
      storage.flush();
      return fallbackView();
    },
    "settings.fallback.fill": async ({ connectionIds = [], models = "" }) => {
      const added = pc().fillFallbackList(list(connectionIds), String(models ?? "").split(/[\n,]/));
      storage.flush();
      return { added, view: fallbackView() };
    },
    "settings.fallback.clear": async () => {
      pc().clearFallbackList();
      storage.flush();
      return fallbackView();
    },
    "settings.fallback.policy": async ({ policy }) => {
      pc().setRateLimitPolicy(policy);
      storage.flush();
      return fallbackView();
    },
    "settings.taskPick": async ({ key, entryId = "" }) => {
      pc().setTaskPick(key, entryId);
      storage.flush();
      return fallbackView();
    },
    "settings.agentFolder": async () => {
      try {
        return { path: await engine.agentConnection.readAgentFolder() };
      } catch {
        return { path: "" };
      }
    },
    "settings.agentFolder.open": async () => ({ opened: Boolean(await engine.agentConnection?.openAgentFolder?.()) }),
    "settings.requests": async () => requestsView(),
    "settings.requests.set": async ({ field, value }) => {
      const settings = rb().requestSettings;
      let message = "";
      if (field === "saveRequests") {
        settings.setSaveRequests(Boolean(value));
        message = `Save AI requests turned ${value ? "on" : "off"}.`;
      } else if (field === "backgroundAi") {
        settings.setBackgroundAi(Boolean(value));
        message = `Background AI turned ${value ? "on" : "off"}.`;
      } else if (field === "dailyLimit") {
        settings.setDailyLimit(String(value ?? ""));
        message = `Daily request limit set to ${clean(value) || "the default"}.`;
      } else if (field === "backgroundDailyCap") {
        settings.setBackgroundDailyCap(String(value ?? ""));
        message = `Background AI daily cap set to ${clean(value) || "the default"}.`;
      } else {
        throw new Error(`Unknown request setting: ${field}`);
      }
      logEvent("setting", message);
      rb().announceRequestBudgetChange();
      storage.flush();
      return requestsView();
    },
    "settings.requests.cancelAll": async () => {
      const control = engine.aiRequestControl;
      if (typeof control?.cancelAllAiRequests !== "function") throw new Error("The native engine cannot cancel every AI request yet.");
      const cancelled = control.cancelAllAiRequests();
      logEvent("ai", cancelled
        ? `Player cancelled ${cancelled} active AI request${cancelled === 1 ? "" : "s"} from Settings.`
        : "Player pressed Cancel all AI requests, but none were active.");
      return { cancelled, view: requestsView() };
    },
    "settings.focus": async () => focusView(),
    "settings.focus.set": async ({ level = "" } = {}) => {
      await engine.refreshLibraryCatalog({ force: true });
      const library = libraryState();
      const gameId = clean(library.activeGameId);
      if (!gameId) throw new Error("No game is open, so there is nothing to set it on.");
      let features = { ...(library.activeGame?.features ?? {}) };
      if (engine.cmServerFeatures?.withFeatureOverride) {
        features = engine.cmServerFeatures.withFeatureOverride(library.activeGame?.features, "playerFocus", clean(level) ? { level: clean(level) } : null);
      } else if (clean(level)) {
        features.playerFocus = { level: clean(level) };
      } else {
        delete features.playerFocus;
      }
      await engine.library.saveGame(gameId, { features });
      return focusView();
    },
    "settings.diagnostics": async () => diagnosticsView(),
    "settings.log.enabled": async ({ value }) => {
      dl().setDebugLogEnabled(Boolean(value));
      storage.flush();
      return diagnosticsView();
    },
    "settings.log.verbose": async ({ value }) => {
      dl().setDebugLogVerbose(Boolean(value));
      storage.flush();
      return diagnosticsView();
    },
    "settings.log.clear": async () => {
      dl().clearDebugLog();
      return diagnosticsView();
    },
    "settings.log.text": async () => ({ text: await dl().buildLoggingFile() }),
    "settings.log.save": async ({ dir = "" } = {}) => {
      const text = await dl().buildLoggingFile();
      return { path: writeExport(dir, dl().debugLogFilename(), text) };
    },
    "settings.log.saveGame": async ({ dir = "" } = {}) => {
      const library = libraryState();
      const gameId = clean(library.activeGameId);
      if (!gameId) return { kind: "no game" };
      const name = clean(library.activeGame?.name) || gameId;
      const enabled = Boolean(dl().isDebugLogEnabled());
      const saved = [];
      try {
        if (enabled) saved.push(writeExport(dir, dl().debugLogFilename(), await dl().buildLoggingFile()));
        const { blob } = await engine.gameZip.buildGameZipBlob(gameId);
        const bytes = Buffer.from(await blob.arrayBuffer());
        saved.push(writeExport(dir, `${gameId}-game.zip`, bytes));
        return { kind: "saved", name, size: formatZipSize(blob.size), enabled, paths: saved };
      } catch (error) {
        logEvent("diagnostics", "Saving the game failed.");
        return { kind: "failed", error: clean(error?.message ?? error) };
      }
    },
    "settings.log.entries": async () => {
      const log = dl();
      const desktop = await log.fetchDesktopLog();
      const entries = list(log.getLoggingFileEntries({ desktop })).map((entry) => ({
        at: clean(entry?.at),
        time: String(entry?.at || "").slice(11, 19),
        category: clean(entry?.category),
        message: String(entry?.message ?? ""),
        repeat: Number(entry?.repeat) || 0,
        problem: Boolean(entry?.problem),
        detail: typeof entry?.detail === "string" ? entry.detail : entry?.detail ? JSON.stringify(entry.detail, null, 2) : "",
      }));
      return { status: desktop.status, entries };
    },
    "settings.network": async () => {
      try {
        return { state: await api("/api/server/network") };
      } catch {
        return { state: null };
      }
    },
    "settings.network.set": async ({ body = {}, label = "", key = "" }) => {
      const state = await api("/api/server/network", { method: "POST", body });
      if (label) logSetting(label, Boolean(state?.[key]));
      return { state };
    },
    "settings.cache": async () => {
      try {
        const usage = await api("/api/hub/cache");
        return { usage, size: usage ? formatCacheSize(Number(usage.bytes) || 0) : "" };
      } catch {
        return { usage: null };
      }
    },
    "settings.cache.clear": async () => {
      const usage = await api("/api/hub/cache", { method: "DELETE" });
      try {
        dl()?.logSettingMessage?.("download-cache", "Download cache cleared.");
      } catch {
        logEvent("setting", "Download cache cleared.");
      }
      return { usage, size: formatCacheSize(Number(usage?.bytes) || 0) };
    },
    "settings.music": async () => {
      try {
        const usage = await api("/api/music");
        return { usage, size: usage ? formatCacheSize(Number(usage.bytes) || 0) : "" };
      } catch {
        return { usage: null };
      }
    },
    "settings.music.clear": async () => {
      try {
        const usage = await api("/api/music", { method: "DELETE" });
        try {
          dl()?.logSettingMessage?.("downloaded-music", "Downloaded music cleared.");
        } catch {
          logEvent("setting", "Downloaded music cleared.");
        }
        return { usage, size: formatCacheSize(Number(usage?.bytes) || 0) };
      } catch {
        return { usage: null };
      }
    },
    "settings.window": async ({ key, value }) => {
      if (key === "Globe" || key === "Terrain") {
        storage.setItem(key, JSON.stringify(Boolean(value)));
        logSetting(key === "Globe" ? "3D Globe" : "3D Terrain", Boolean(value));
        storage.flush();
      } else if (key === "Fullscreen") {
        logSetting("Fullscreen", Boolean(value));
      } else {
        throw new Error(`Unknown setting: ${key}`);
      }
      return values();
    },
    "settings.aiSetup": async () => {
      const config = pc();
      const [top] = config.getResolvedFallbackList();
      const provider = top?.provider ?? "gemini";
      return {
        ready: config.isFallbackListConfigured(),
        provider,
        providerLabel: config.getProviderMeta(provider)?.label || "the selected provider",
        missing: config.describeProviderSetupNeed(provider),
        providers: config.providerOptionsFor({ localServer: false }).map((option) => ({ value: option.value, label: option.label, group: option.group, description: option.description, requirement: config.providerSetupRequirement(option.value) })),
        recentModels: Object.fromEntries(config.PROVIDER_OPTIONS.map((option) => [option.value, config.getRecentModels(option.value)])),
        geminiChain: [...config.GEMINI_DEFAULT_CHAIN],
        openaiDefault: config.OPENAI_DEFAULT_MODEL,
        defaultProvider: config.DEFAULT_PROVIDER,
      };
    },
    "settings.quickSetup": async ({ provider, apiKey = "", endpoint = "", model = "" }) => {
      pc().applyQuickAiSetup({ provider, apiKey, endpoint, model });
      storage.flush();
      return { ready: pc().isFallbackListConfigured() };
    },
    "telemetry.records": async ({ task = "all", model = "", status = "all", search = "", sort = "newest" } = {}) => {
      const records = await telemetryRecords();
      const filtered = filterRecords(records, { task, model, status, search, sort });
      return {
        available: true,
        count: records.length,
        completed: generationCount,
        filtered: filtered.map(summaryOf),
        tasks: [...new Set(records.map((record) => record.taskKey).filter(Boolean))].sort(),
        models: [...new Set(records.map((record) => record.model).filter(Boolean))].sort(),
        analytics: analyticsOf(records),
      };
    },
    "telemetry.record": async ({ id }) => {
      const records = await telemetryRecords();
      const record = list(records).find((candidate) => candidate.id === id);
      return record ? plain(detailOf(record)) : null;
    },
    "telemetry.rate": async ({ id, rating }) => {
      const telemetry = telemetryModule();
      if (!telemetry?.setGenerationRating) throw new Error("The native engine does not hand over its AI telemetry yet.");
      return { ok: await telemetry.setGenerationRating(id, Number(rating)) };
    },
    "telemetry.clear": async () => {
      const telemetry = telemetryModule();
      if (!telemetry?.clearAiRecords) throw new Error("The native engine does not hand over its AI telemetry yet.");
      await telemetry.clearAiRecords();
      return { ok: true };
    },
    "telemetry.release": async () => {
      telemetryModule()?.releaseAiRecords?.();
      return true;
    },
    "telemetry.export": async ({ kind, dir = "" }) => {
      const stamp = Date.now();
      if (kind === "world") {
        const state = await engine.gameState.readWorldState({ force: true });
        return { path: writeExport(dir, `oh-world-state-${stamp}.json`, JSON.stringify(state, null, 2)) };
      }
      const records = await telemetryRecords();
      if (kind === "csv") {
        const telemetry = telemetryModule();
        const text = telemetry?.exportTelemetryCsv ? telemetry.exportTelemetryCsv(records) : exportCsv(records);
        return { path: writeExport(dir, `oh-debug-telemetry-${stamp}.csv`, text) };
      }
      return { path: writeExport(dir, `oh-debug-telemetry-${stamp}.json`, JSON.stringify(records, null, 2)) };
    },
  };

  methods["settings.basemaps"] = async () => {
    const assets = engine.assets;
    const world = await engine.gameState.readWorldState({ force: true }).catch(() => ({}));
    const background = world?.background ?? null;
    const ownMap = Boolean(background?.kind);
    const builtinName = (id) => list(assets?.ESRI_BASEMAPS).find((basemap) => basemap.id === id)?.label || id;
    const maps = [];
    const detailedStart = background?.kind === "vector" && background.tiled && typeof background.tiled === "object";
    const startingName = clean(background?.name) || "Scenario map";
    if (detailedStart) {
      maps.push({ pick: "", name: clean(background.tiled.name) || "Detailed map", starting: true, detailed: true });
      maps.push({ pick: "start:drawn", name: startingName, starting: false, detailed: false });
    } else if (ownMap) {
      maps.push({ pick: "", name: startingName, starting: true, detailed: false });
    } else {
      const id = assets?.isBuiltinBasemapId?.(world?.basemap) ? world.basemap : clean(assets?.DEFAULT_BASEMAP_ID) || "ocean";
      maps.push({ pick: "", name: builtinName(id), starting: true, detailed: false, builtinId: id });
    }
    const own = typeof world?.ownBasemaps === "string" ? list(assets?.decodeOwnBasemaps?.(world.ownBasemaps)) : list(assets?.normalizeOwnBasemaps?.(world?.ownBasemaps));
    for (const entry of own) {
      if (entry.kind === "tiled" && entry.over === "" && background?.kind !== "vector") continue;
      maps.push({ pick: `own:${entry.id}`, name: clean(entry.name), starting: false, detailed: entry.kind === "tiled" });
    }
    const allowedRaw = world?.allowedBasemaps;
    const allowed = Array.isArray(allowedRaw) ? allowedRaw : typeof allowedRaw === "string" ? list(assets?.decodeAllowedBasemaps?.(allowedRaw)) : null;
    const startingBuiltin = ownMap ? "" : maps[0].builtinId;
    for (const choice of list(assets?.builtinBasemapChoices?.(allowed, { scenarioHasOwnMap: ownMap }))) {
      if (choice.id !== startingBuiltin) maps.push({ pick: choice.id, name: clean(choice.label), starting: false, detailed: false, builtin: true });
    }
    return { maps: maps.map((map) => ({ ...map, label: map.starting ? `${map.name} (starting map)` : map.detailed ? `${map.name} (detailed map)` : map.name })) };
  };
  return methods;
};
