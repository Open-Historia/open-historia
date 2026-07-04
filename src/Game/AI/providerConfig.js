/*! Open Historia — portions (reasoning-effort toggle persistence) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
];

const PROVIDER_SETTINGS = {
    gemini: {
        apiKey: { storageKey: "gemini_api_key", defaultValue: "" },
        model: { storageKey: "gemini_model", defaultValue: "gemini-3.1-flash-lite-preview" },
        customParams: { storageKey: "gemini_custom_params", defaultValue: "" },
    },
    openai: {
        apiKey: { storageKey: "openai_api_key", defaultValue: "" },
        model: { storageKey: "openai_model", defaultValue: "" },
        customParams: { storageKey: "openai_custom_params", defaultValue: "" },
    },
    anthropic: {
        apiKey: { storageKey: "anthropic_api_key", defaultValue: "" },
        // Empty means "use the real Anthropic API" (main.jsx's ANTHROPIC_API_ENDPOINT
        // default) — set this to point at a self-hosted Anthropic-compatible proxy.
        endpoint: { storageKey: "anthropic_endpoint", defaultValue: "" },
        model: { storageKey: "anthropic_model", defaultValue: "claude-haiku-4-5" },
        customParams: { storageKey: "anthropic_custom_params", defaultValue: "" },
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
    },
};

const FORM_FIELD_MAP = {
    geminiApiKey: { provider: "gemini", field: "apiKey" },
    geminiModel: { provider: "gemini", field: "model" },
    geminiCustomParams: { provider: "gemini", field: "customParams" },
    openaiApiKey: { provider: "openai", field: "apiKey" },
    openaiModel: { provider: "openai", field: "model" },
    openaiCustomParams: { provider: "openai", field: "customParams" },
    anthropicApiKey: { provider: "anthropic", field: "apiKey" },
    anthropicEndpoint: { provider: "anthropic", field: "endpoint" },
    anthropicModel: { provider: "anthropic", field: "model" },
    anthropicCustomParams: { provider: "anthropic", field: "customParams" },
    openaiCompatibleApiKey: { provider: "openai-compatible", field: "apiKey" },
    openaiCompatibleEndpoint: { provider: "openai-compatible", field: "endpoint" },
    openaiCompatibleModel: { provider: "openai-compatible", field: "model" },
    openaiCompatibleCustomParams: { provider: "openai-compatible", field: "customParams" },
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
    localStorage.setItem(setting.storageKey, value ?? "");
}

export function getProviderSettings(provider) {
    const normalized = normalizeProvider(provider);
    return {
        provider: normalized,
        apiKey: getProviderField(normalized, "apiKey"),
        endpoint: getProviderField(normalized, "endpoint"),
        model: getProviderField(normalized, "model"),
        customParams: getProviderField(normalized, "customParams"),
    };
}

// Global "model reasoning" toggle — applied by callAI in every provider mode
// (Gemini thinkingConfig, OpenAI/compatible reasoning_effort, Anthropic thinking).
const REASONING_STORAGE_KEY = "ai_reasoning_enabled";

export function getReasoningEnabled() {
    return localStorage.getItem(REASONING_STORAGE_KEY) === "1";
}

export function setReasoningEnabled(enabled) {
    localStorage.setItem(REASONING_STORAGE_KEY, enabled ? "1" : "0");
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
