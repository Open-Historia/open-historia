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

function getSettingConfig(provider, field) {
    return PROVIDER_SETTINGS[normalizeProvider(provider)]?.[field] ?? null;
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
