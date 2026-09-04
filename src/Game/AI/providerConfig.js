/*! Open Historia — portions (reasoning-effort toggle persistence) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { logDebugEvent, setDebugLogContext } from "../../runtime/debugLog.js";

export const DEFAULT_PROVIDER = "gemini";

export const PROVIDER_OPTIONS = [
    {
        value: "gemini",
        label: "Gemini",
        group: "Native APIs",
        description: "Google AI Studio / Gemini API",
        searchTerms: ["google", "ai studio", "generativelanguage"],
    },
    {
        value: "openai",
        label: "OpenAI",
        group: "Native APIs",
        description: "Official OpenAI API",
        searchTerms: ["gpt", "o3", "o4", "responses", "chatgpt"],
    },
    {
        value: "anthropic",
        label: "Anthropic",
        group: "Native APIs",
        description: "Claude via Messages API",
        searchTerms: ["claude", "haiku", "sonnet", "opus"],
    },
    {
        value: "openai-compatible",
        label: "OpenAI Compatible",
        group: "Gateways and self-hosted",
        description: "Ollama, LM Studio, OpenRouter, local gateways",
        searchTerms: ["ollama", "lm studio", "openrouter", "vllm", "gateway", "proxy"],
    },
    {
        value: "anthropic-compatible",
        label: "Anthropic Compatible",
        group: "Gateways and self-hosted",
        description: "Self-hosted proxy that speaks the Anthropic Messages API",
        searchTerms: ["claude", "anthropic", "messages api", "proxy", "gateway", "self-hosted"],
    },
];

const PROVIDER_SETTINGS = {
    gemini: {
        apiKey: { storageKey: "gemini_api_key", defaultValue: "" },
        model: { storageKey: "gemini_model", defaultValue: "gemini-3.5-flash-lite" },
        customParams: { storageKey: "gemini_custom_params", defaultValue: "" },
        structuredMode: { storageKey: "gemini_structured_mode", defaultValue: "auto" },
    },
    openai: {
        apiKey: { storageKey: "openai_api_key", defaultValue: "" },
        model: { storageKey: "openai_model", defaultValue: "" },
        customParams: { storageKey: "openai_custom_params", defaultValue: "" },
        structuredMode: { storageKey: "openai_structured_mode", defaultValue: "auto" },
    },
    anthropic: {
        apiKey: { storageKey: "anthropic_api_key", defaultValue: "" },
        model: { storageKey: "anthropic_model", defaultValue: "claude-haiku-4-5" },
        customParams: { storageKey: "anthropic_custom_params", defaultValue: "" },
        structuredMode: { storageKey: "anthropic_structured_mode", defaultValue: "auto" },
    },
    // Self-hosted proxy speaking the Anthropic Messages API — called directly
    // from the browser first, falling back to the local relay only when the page
    // is served locally (see main.jsx providerFetch/callAnthropicCompatible). On
    // a hosted website the proxy must send its own CORS headers. Separate from
    // the native Anthropic API above.
    "anthropic-compatible": {
        apiKey: { storageKey: "anthropic_compatible_api_key", defaultValue: "" },
        endpoint: { storageKey: "anthropic_compatible_endpoint", defaultValue: "" },
        model: { storageKey: "anthropic_compatible_model", defaultValue: "claude-haiku-4-5" },
        customParams: { storageKey: "anthropic_compatible_custom_params", defaultValue: "" },
        structuredMode: { storageKey: "anthropic_compatible_structured_mode", defaultValue: "auto" },
    },
    "openai-compatible": {
        apiKey: { storageKey: "openai_compatible_api_key", defaultValue: "" },
        endpoint: {
            storageKey: "openai_compatible_endpoint",
            legacyKeys: ["custom_api_endpoint"],
            defaultValue: "http://localhost:11434/v1",
        },
        model: {
            storageKey: "openai_compatible_model",
            legacyKeys: ["custom_api_model"],
            defaultValue: "",
        },
        customParams: { storageKey: "openai_compatible_custom_params", defaultValue: "" },
        structuredMode: { storageKey: "openai_compatible_structured_mode", defaultValue: "auto" },
        toolStrict: { storageKey: "openai_compatible_tool_strict", defaultValue: "" },
    },
};

const FORM_FIELD_MAP = {
    geminiApiKey: { provider: "gemini", field: "apiKey" },
    geminiModel: { provider: "gemini", field: "model" },
    geminiCustomParams: { provider: "gemini", field: "customParams" },
    geminiStructuredMode: { provider: "gemini", field: "structuredMode" },
    openaiApiKey: { provider: "openai", field: "apiKey" },
    openaiModel: { provider: "openai", field: "model" },
    openaiCustomParams: { provider: "openai", field: "customParams" },
    openaiStructuredMode: { provider: "openai", field: "structuredMode" },
    anthropicApiKey: { provider: "anthropic", field: "apiKey" },
    anthropicModel: { provider: "anthropic", field: "model" },
    anthropicCustomParams: { provider: "anthropic", field: "customParams" },
    anthropicStructuredMode: { provider: "anthropic", field: "structuredMode" },
    anthropicCompatibleApiKey: { provider: "anthropic-compatible", field: "apiKey" },
    anthropicCompatibleEndpoint: { provider: "anthropic-compatible", field: "endpoint" },
    anthropicCompatibleModel: { provider: "anthropic-compatible", field: "model" },
    anthropicCompatibleCustomParams: { provider: "anthropic-compatible", field: "customParams" },
    anthropicCompatibleStructuredMode: { provider: "anthropic-compatible", field: "structuredMode" },
    openaiCompatibleApiKey: { provider: "openai-compatible", field: "apiKey" },
    openaiCompatibleEndpoint: { provider: "openai-compatible", field: "endpoint" },
    openaiCompatibleModel: { provider: "openai-compatible", field: "model" },
    openaiCompatibleCustomParams: { provider: "openai-compatible", field: "customParams" },
    openaiCompatibleStructuredMode: { provider: "openai-compatible", field: "structuredMode" },
    openaiCompatibleToolStrict: { provider: "openai-compatible", field: "toolStrict" },
};

function isSupportedProvider(value) {
    return PROVIDER_OPTIONS.some((provider) => provider.value === value);
}

function readStoredValue(setting) {
    if (!setting?.storageKey) return setting?.defaultValue ?? "";

    const primaryValue = localStorage.getItem(setting.storageKey);
    if (primaryValue !== null) return primaryValue;

    for (const legacyKey of setting.legacyKeys ?? []) {
        const legacyValue = localStorage.getItem(legacyKey);
        if (legacyValue !== null) return legacyValue;
    }

    return setting.defaultValue ?? "";
}

// A task-scoped model override lives under `model_<taskKey>`. Those fields are
// synthesized here rather than listed per task in PROVIDER_SETTINGS, so
// getProviderField/setProviderField work on them with no per-task schema and
// the task list stays open-ended. Only providers with a base model setting
// have anything for an override to inherit.
const TASK_MODEL_FIELD = /^model_([A-Za-z][A-Za-z0-9_]*)$/;

function getSettingConfig(provider, field) {
    const normalized = normalizeProvider(provider);
    const base = PROVIDER_SETTINGS[normalized];
    if (!base) return null;
    const direct = base[field];
    if (direct) return direct;
    const taskMatch = TASK_MODEL_FIELD.exec(String(field ?? ""));
    if (taskMatch && base.model) {
        return { storageKey: `${normalized}_model_${taskMatch[1]}`, defaultValue: "" };
    }
    return null;
}

export function normalizeProvider(provider) {
    if (provider === "custom") return "openai-compatible";
    return isSupportedProvider(provider) ? provider : DEFAULT_PROVIDER;
}

export function getStoredProvider() {
    return normalizeProvider(localStorage.getItem("api_provider"));
}

export function getProviderMeta(provider) {
    return PROVIDER_OPTIONS.find((option) => option.value === normalizeProvider(provider))
        ?? PROVIDER_OPTIONS[0];
}

export function providerSupportsModelDiscovery(provider) {
    const normalized = normalizeProvider(provider);
    return normalized === "openai" || normalized === "openai-compatible";
}

export function getProviderField(provider, field) {
    const setting = getSettingConfig(provider, field);
    return setting ? readStoredValue(setting) : "";
}

// Per-task model routing (ported from the abdulrahman-2005 fork). Every AI call
// names its task (a prompt-pack task key, or "advisor"/"diplomacy" for the
// chats); a task-scoped override wins, otherwise the provider's default model
// applies, so a player who never opens the advanced section keeps the exact
// single-model behaviour. Keys outside AI_TASK_ROUTING still resolve — they
// just always fall back to the default.
export const AI_TASK_ROUTING = [
    { key: "jumpForward", label: "Time skip", hint: "Strongest model — the main simulation call", group: "Simulation" },
    { key: "autoJumpForward", label: "Auto time skip", hint: "Strongest model — the main simulation call", group: "Simulation" },
    { key: "worldMotionRepair", label: "World motion repair", hint: "Mid-tier: rewrites a static jump", group: "Simulation" },
    { key: "worldBreadthRepair", label: "World breadth repair", hint: "Mid-tier: widens a narrow jump", group: "Simulation" },
    { key: "timelineCurator", label: "Timeline curator", hint: "Small/mid-tier: event pruning", group: "Simulation" },
    { key: "unitDirector", label: "Unit director", hint: "Mid-tier: unit movement", group: "Simulation" },
    { key: "territoryDirector", label: "Territory director", hint: "Mid-tier: front outcomes", group: "Simulation" },
    { key: "geographyResolver", label: "Geography resolver", hint: "Small model: place-name matching", group: "Simulation" },
    { key: "eventConsolidator", label: "Event consolidator", hint: "Small/mid-tier: pure summarization", group: "Simulation" },
    { key: "projects", label: "Projects & operations", hint: "Mid-tier model", group: "Simulation" },
    { key: "pregameHistory", label: "Pre-game history", hint: "Mid-tier model", group: "Simulation" },
    { key: "gameMaster", label: "Game Master", hint: "High-tier model (direct world edits)", group: "Player" },
    { key: "actions", label: "Action suggestions", hint: "Small/mid-tier: short suggestions", group: "Player" },
    { key: "descriptionToAction", label: "Action parsing", hint: "Small model: text to a structured command", group: "Player" },
    { key: "nextSpeaker", label: "Next speaker", hint: "Smallest model: single-field pick", group: "Player" },
    { key: "idleDiplomacy", label: "Idle diplomacy", hint: "Small/mid-tier model", group: "Player" },
    { key: "countryStatSheet", label: "Stat sheet", hint: "Mid-tier model", group: "Player" },
    { key: "catalystCreation", label: "Catalyst creation", hint: "Mid-tier model", group: "Player" },
    { key: "catalystExecutor", label: "Catalyst execution", hint: "Mid-tier model", group: "Player" },
    { key: "catalystSummary", label: "Catalyst summary", hint: "Small model", group: "Player" },
    { key: "spyIntercept", label: "Spy intercept", hint: "Small/mid-tier model", group: "Player" },
    { key: "advisor", label: "Advisor chat", hint: "Mid/high-tier: long conversational replies", group: "Chat" },
    { key: "diplomacy", label: "Leader chat", hint: "Mid/high-tier: in-character leaders", group: "Chat" },
];

export function getModelForTask(provider, taskKey) {
    const normalized = normalizeProvider(provider);
    const key = String(taskKey ?? "").trim();
    if (key && /^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        const taskSpecific = getProviderField(normalized, `model_${key}`);
        if (taskSpecific && taskSpecific.trim()) return taskSpecific.trim();
    }
    return getProviderField(normalized, "model");
}

export function setProviderField(provider, field, value) {
    const setting = getSettingConfig(provider, field);
    if (!setting?.storageKey) return;

    // Changing the MODEL retires an explicit structured-output choice.
    //
    // That choice is stored per provider (it belongs beside the endpoint and the
    // key, which is where a player looks for it), but the evidence behind it is
    // per MODEL: the same gateway can serve one model that honours tool calling
    // and one that ignores it. Carrying the old choice onto a new model would
    // silently start it in a weaker mode than it may well support, and because
    // the ladder only ever steps DOWN, nothing would ever discover otherwise.
    //
    // Reverting to "auto" costs at most one wasted attempt, after which the
    // ladder re-learns and offers the setting again. Getting it wrong the other
    // way costs enforced schemas on every call, silently, forever.
    if (field === "model") {
        const previous = getProviderField(provider, "model");
        const next = String(value ?? "");
        if (previous && previous !== next) {
            const modeSetting = getSettingConfig(provider, "structuredMode");
            if (modeSetting?.storageKey) localStorage.removeItem(modeSetting.storageKey);
        }
    }

    localStorage.setItem(setting.storageKey, value ?? "");
    syncAiDebugContext();
}

// Which provider and model the game is pointed at, into the diagnostics log's
// header. Read from here rather than pushed in by the settings panel, because
// the panel is not the only writer (a model picked from the discovery list, a
// legacy key migrated on read) and a header that disagrees with the running
// config is worse than no header at all.
//
// Names only, never the key or the endpoint's credentials — see redactSecrets
// in runtime/debugLog.js. The MODEL is the most useful line in an AI bug report
// and is not a secret; the key that reaches it never leaves this module.
export function syncAiDebugContext() {
    if (typeof localStorage === "undefined") return;
    const provider = getStoredProvider();
    setDebugLogContext({
        provider: getProviderMeta(provider)?.label || provider,
        model: getProviderField(provider, "model") || "(provider default)",
    });
}

// Called by the settings panel when the player picks a different provider — the
// switch itself is worth a line, because "it broke when I moved off Gemini" is a
// report the log should be able to answer on its own.
export function logProviderSwitch(provider) {
    const normalized = normalizeProvider(provider);
    logDebugEvent("setting", `AI provider set to ${getProviderMeta(normalized)?.label || normalized}.`, {
        model: getProviderField(normalized, "model") || "(provider default)",
        hasKey: Boolean(getProviderField(normalized, "apiKey")),
        hasEndpoint: Boolean(getProviderField(normalized, "endpoint")),
    });
    syncAiDebugContext();
}

export function getProviderSettings(provider) {
    const normalized = normalizeProvider(provider);
    return {
        provider: normalized,
        apiKey: getProviderField(normalized, "apiKey"),
        endpoint: getProviderField(normalized, "endpoint"),
        model: getProviderField(normalized, "model"),
        customParams: getProviderField(normalized, "customParams"),
        // Where structured-output attempts START on the ladder (see
        // structuredMode.js). "auto" means the strongest first, stepping down on
        // failure; anything else names a rung to begin at. Never a lock: the
        // ladder still walks down from wherever it starts, so a setting chosen
        // months ago cannot permanently break a campaign.
        structuredMode: getProviderField(normalized, "structuredMode") || "auto",
        // Opt-in, so anything other than an explicit "1" leaves it off. Independent
        // of the ladder above: this only decides whether the "tool" rung sends
        // strict:true with the schema, not which rung is tried first.
        toolStrict: getProviderField(normalized, "toolStrict") === "1",
    };
}

// Global "model reasoning" toggle — applied by callAI in every provider mode
// (Gemini thinkingConfig, OpenAI/compatible reasoning_effort, Anthropic thinking).
const REASONING_STORAGE_KEY = "ai_reasoning_enabled";

// Reasoning is ON by default: only an explicit "0" (the user turned it off) disables
// it, so a fresh install or cleared storage gets model reasoning without opting in.
export function getReasoningEnabled() {
    return localStorage.getItem(REASONING_STORAGE_KEY) !== "0";
}

export function setReasoningEnabled(enabled) {
    localStorage.setItem(REASONING_STORAGE_KEY, enabled ? "1" : "0");
    logDebugEvent("setting", `Model reasoning turned ${enabled ? "on" : "off"}.`);
}

export function loadProviderSettingsFormState() {
    const state = {};

    for (const [stateKey, mapping] of Object.entries(FORM_FIELD_MAP)) {
        state[stateKey] = getProviderField(mapping.provider, mapping.field);
    }

    return state;
}

export function persistProviderSetting(stateKey, value) {
    const mapping = FORM_FIELD_MAP[stateKey];
    if (!mapping) return;
    setProviderField(mapping.provider, mapping.field, value);
}

// --- Configuration profiles (ported from the abdulrahman-2005 fork) ---
//
// A profile is an endpoint + key + model + custom-params bundle for the two
// "compatible" providers, so a player who alternates between, say, a local
// Ollama and OpenRouter switches with one click instead of retyping four
// fields. Stored as one JSON array; the stock entries are written on first read
// so they can be edited or deleted like any other.

const PRESETS_STORAGE_KEY = "ai_provider_presets";

const DEFAULT_PRESETS = [
    {
        id: "default_groq",
        provider: "openai-compatible",
        name: "Groq",
        settings: { endpoint: "https://api.groq.com/openai/v1", apiKey: "", model: "llama-3.3-70b-versatile", customParams: "" },
    },
    {
        id: "default_openrouter",
        provider: "openai-compatible",
        name: "OpenRouter",
        settings: { endpoint: "https://openrouter.ai/api/v1", apiKey: "", model: "", customParams: "" },
    },
    {
        id: "default_ollama",
        provider: "openai-compatible",
        name: "Local Ollama",
        settings: { endpoint: "http://localhost:11434/v1", apiKey: "", model: "", customParams: "" },
    },
];

function readStoredPresets() {
    if (typeof localStorage === "undefined") return null;
    try {
        const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
        if (stored === null) return null;
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
        console.warn("Failed to load AI provider profiles", error);
        return null;
    }
}

function writeStoredPresets(presets) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function normalizePresetSettings(settings) {
    return {
        endpoint: String(settings?.endpoint ?? ""),
        apiKey: String(settings?.apiKey ?? ""),
        model: String(settings?.model ?? ""),
        customParams: String(settings?.customParams ?? ""),
    };
}

export function getSavedPresets() {
    const stored = readStoredPresets();
    if (stored) return stored;
    const seeded = DEFAULT_PRESETS.map((preset) => ({ ...preset, settings: { ...preset.settings } }));
    writeStoredPresets(seeded);
    return seeded;
}

export function savePreset(provider, name, settings) {
    const presets = getSavedPresets();
    const preset = {
        id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        provider: normalizeProvider(provider),
        name: String(name ?? "").trim(),
        settings: normalizePresetSettings(settings),
    };
    writeStoredPresets([...presets, preset]);
    logDebugEvent("setting", `AI profile "${preset.name}" saved for ${preset.provider}.`);
    return preset.id;
}

export function updatePreset(id, name, settings) {
    const presets = getSavedPresets();
    const index = presets.findIndex((preset) => preset.id === id);
    if (index === -1) return false;
    const next = { ...presets[index] };
    if (name !== undefined && name !== null) next.name = String(name).trim();
    if (settings) next.settings = normalizePresetSettings(settings);
    presets[index] = next;
    writeStoredPresets(presets);
    return true;
}

export function deletePreset(id) {
    const presets = getSavedPresets();
    const remaining = presets.filter((preset) => preset.id !== id);
    if (remaining.length === presets.length) return false;
    writeStoredPresets(remaining);
    return true;
}

// --- Recent models ---
//
// The last ten models each provider actually ran with, newest first, offered
// as suggestions under the model fields. Recorded by resolveModel (main.jsx),
// so discovered and task-routed models count too, not only typed ones.

const RECENT_MODELS_LIMIT = 10;

function recentModelsKey(provider) {
    return `ai_recent_models_${normalizeProvider(provider)}`;
}

export function getRecentModels(provider) {
    if (typeof localStorage === "undefined") return [];
    try {
        const stored = localStorage.getItem(recentModelsKey(provider));
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string" && entry) : [];
    } catch {
        return [];
    }
}

export function saveRecentModel(provider, model) {
    const name = String(model ?? "").trim();
    if (!name || typeof localStorage === "undefined") return;
    const current = getRecentModels(provider);
    // The common case — the same model as last call — costs no write at all.
    if (current[0] === name) return;
    const next = [name, ...current.filter((entry) => entry !== name)].slice(0, RECENT_MODELS_LIMIT);
    try {
        localStorage.setItem(recentModelsKey(provider), JSON.stringify(next));
    } catch {
        // Storage full or unavailable: suggestions are a convenience, not state.
    }
}
