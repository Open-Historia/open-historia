/*! Open Historia — portions (reasoning-effort toggle persistence) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { logDebugEvent, logSettingMessage, setDebugLogContext } from "../../runtime/debugLog.js";
import { entryStatus } from "./fallbackRunner.js";

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

function isSupportedProvider(value) {
    return PROVIDER_OPTIONS.some((provider) => provider.value === value);
}

// The per-provider settings above are read by the migration to Connections
// and the Fallback list, and by nothing else (docs/adr/0002).
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

// An old task-scoped model override lived under `<provider>_model_<taskKey>`.
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

// The provider the old settings had active. Migration only.
function getStoredProvider() {
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

function getProviderField(provider, field) {
    const setting = getSettingConfig(provider, field);
    return setting ? readStoredValue(setting) : "";
}

// The tasks a player can give a pick of their own (ported from the
// abdulrahman-2005 fork's per-task routing). Every AI call names its task (a
// prompt-pack task key, or "advisor"/"diplomacy" for the chats); a task with a
// pick tries that Fallback entry first, then the list from the top. Keys
// outside this list still work — they just always start at the top.
export const AI_TASK_ROUTING = [
    { key: "jumpForward", label: "Time skip", hint: "Strongest model — the main simulation call", group: "Simulation" },
    { key: "autoJumpForward", label: "Auto time skip", hint: "Strongest model — the main simulation call", group: "Simulation" },
    // While AI requests are being saved (requestBudget.js) this ONE task does the
    // work of the curator, both directors, the projects pass and every spy
    // intercept below, and their own picks are not used.
    { key: "turnReview", label: "After-skip checks", hint: "Strong mid-tier: units, territory, timeline, board and agents in one request", group: "Simulation" },
    { key: "worldMotionRepair", label: "World motion repair", hint: "Mid-tier: rewrites a static jump", group: "Simulation" },
    { key: "worldBreadthRepair", label: "World breadth repair", hint: "Mid-tier: widens a narrow jump", group: "Simulation" },
    { key: "timelineCurator", label: "Timeline curator", hint: "Small/mid-tier: event pruning", group: "Simulation" },
    { key: "unitDirector", label: "Unit director", hint: "Mid-tier: unit movement", group: "Simulation" },
    { key: "territoryDirector", label: "Territory director", hint: "Mid-tier: front outcomes", group: "Simulation" },
    { key: "geographyResolver", label: "Geography resolver", hint: "Small model: place-name matching", group: "Simulation" },
    { key: "eventConsolidator", label: "Event consolidator", hint: "Small/mid-tier: pure summarization", group: "Simulation" },
    { key: "projects", label: "Projects & operations", hint: "Mid-tier model", group: "Simulation" },
    { key: "pregameHistory", label: "Pre-game history", hint: "Mid-tier model", group: "Simulation" },
    { key: "politicalWorldGeneration", label: "Political world generation", hint: "Mid/high-tier: bounded scenario political seeding", group: "Simulation" },
    { key: "politicalWorldVerification", label: "Political world verification", hint: "Mid/high-tier: exact-date identity cross-check", group: "Simulation" },
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

// The host of an endpoint, for the diagnostics log: "localhost:11434" or
// "openrouter.ai" says which server a report is about; the path, the query and
// any credentials in the URL say nothing a reader needs and can carry a token.
export function endpointHostForLog(value) {
    const text = String(value ?? "").trim();
    if (!text) return "(none)";
    try {
        return new URL(text).host || "(not a URL)";
    } catch {
        return "(not a URL)";
    }
}

// Which provider and model the game starts each call on, into the diagnostics
// log's header: the top of the Fallback list. Read from here rather than pushed
// in by the settings panel, because the panel is not the only writer (a
// migration on first read, a structured-output suggestion accepted after a
// turn) and a header that disagrees with the running config is worse than none.
//
// Names only, never the key or the endpoint's credentials — see redactSecrets
// in runtime/debugLog.js. Which entry actually ANSWERED each call is on that
// call's own log line.
export function syncAiDebugContext() {
    if (typeof localStorage === "undefined") return;
    const list = getResolvedFallbackList();
    const [top] = list;
    setDebugLogContext({
        provider: top
            ? `${getProviderMeta(top.provider).label}${list.length > 1 ? ` (top of a ${list.length}-entry Fallback list)` : ""}`
            : "(empty Fallback list)",
        model: top?.model || "(provider default)",
    });
}

// What a provider needs before a single call can go out: a hosted provider
// its key, a self-hosted one its endpoint (their key is optional). The game
// start prompt asks for it up front instead of letting the first turn fail.
export function providerSetupRequirement(provider) {
    const normalized = normalizeProvider(provider);
    return normalized === "openai-compatible" || normalized === "anthropic-compatible" ? "endpoint" : "apiKey";
}

export function describeProviderSetupNeed(provider) {
    return providerSetupRequirement(provider) === "endpoint" ? "a server endpoint" : "an API key";
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

// Starting points offered when adding a Connection: the stock profiles, as they
// were (ported from the abdulrahman-2005 fork), so a Groq or OpenRouter key is
// one click and a paste away.
export const CONNECTION_TEMPLATES = [
    { name: "Groq", provider: "openai-compatible", endpoint: "https://api.groq.com/openai/v1", suggestedModel: "llama-3.3-70b-versatile" },
    { name: "OpenRouter", provider: "openai-compatible", endpoint: "https://openrouter.ai/api/v1", suggestedModel: "" },
    { name: "Local Ollama", provider: "openai-compatible", endpoint: "http://localhost:11434/v1", suggestedModel: "" },
];

// The old configuration profiles, read by the migration only.
function readStoredPresets() {
    if (typeof localStorage === "undefined") return null;
    try {
        const stored = localStorage.getItem("ai_provider_presets");
        if (stored === null) return null;
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

// --- Connections and the Fallback list ---
//
// docs/world-state.md ("AI access") and docs/adr/0002. A Connection is a saved
// way to reach one provider: which provider, a name the player gives it, its
// key, its endpoint, and its custom parameters. A Fallback entry is one
// Connection and one model, at one place in the Fallback list. Every AI call
// starts at the top of the list (fallbackRunner.js). These, and nothing else,
// decide who answers a call: the per-provider settings above are read exactly
// once, to migrate them, and never again.

const CONNECTIONS_KEY = "ai_connections";
const FALLBACK_LIST_KEY = "ai_fallback_list";
const TASK_PICKS_KEY = "ai_task_picks";
const RATE_LIMIT_POLICY_KEY = "ai_fallback_rate_limit";
const ENTRY_STATES_KEY = "ai_fallback_states";

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const readJsonSetting = (key, fallback) => {
    if (typeof localStorage === "undefined") return fallback;
    try {
        const stored = localStorage.getItem(key);
        if (stored === null) return fallback;
        const parsed = JSON.parse(stored);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};

const writeJsonSetting = (key, value) => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
};

// Names and models are stored as typed — the Settings fields save on every
// keystroke — and trimmed where they are used.
const normalizeConnection = (connection) => ({
    id: String(connection?.id || newId("conn")),
    provider: normalizeProvider(connection?.provider),
    name: connection?.name == null ? getProviderMeta(connection?.provider).label : String(connection.name),
    apiKey: String(connection?.apiKey ?? ""),
    endpoint: String(connection?.endpoint ?? ""),
    customParams: String(connection?.customParams ?? ""),
    toolStrict: connection?.toolStrict === true,
    suggestedModel: String(connection?.suggestedModel ?? ""),
});

const normalizeEntry = (entry) => ({
    id: String(entry?.id || newId("entry")),
    connectionId: String(entry?.connectionId ?? ""),
    model: String(entry?.model ?? ""),
    customParamsOverride: String(entry?.customParamsOverride ?? ""),
    structuredMode: String(entry?.structuredMode ?? "").trim() || "auto",
});

// A value the player actually stored under an old per-provider key, as opposed
// to a default the old reader would have filled in.
const storedOldValue = (setting) => {
    if (!setting?.storageKey || typeof localStorage === "undefined") return null;
    for (const key of [setting.storageKey, ...(setting.legacyKeys ?? [])]) {
        const value = localStorage.getItem(key);
        if (value !== null) return value;
    }
    return null;
};

// Runs on the first read of the list, wherever that happens — the Settings
// screen, a time skip, or open-historia-harness, which imports the engine with
// no UI and old-style settings in a fresh storage. The old settings are left in
// storage untouched, so a rollback of this code still finds them.
function migrateFromProviderSettings() {
    const active = getStoredProvider();
    const connections = [];
    const connectionFor = {};
    for (const provider of Object.keys(PROVIDER_SETTINGS)) {
        const old = PROVIDER_SETTINGS[provider];
        const apiKey = storedOldValue(old.apiKey) ?? "";
        const endpoint = storedOldValue(old.endpoint) ?? "";
        if (provider !== active && !apiKey.trim() && !endpoint.trim()) continue;
        const connection = normalizeConnection({
            provider,
            apiKey,
            // The active self-hosted provider keeps the endpoint it was really
            // calling, default included.
            endpoint: endpoint || (provider === active ? getProviderField(provider, "endpoint") : ""),
            customParams: storedOldValue(old.customParams) ?? "",
            toolStrict: storedOldValue(old.toolStrict) === "1",
        });
        connections.push(connection);
        connectionFor[provider] = connection.id;
    }

    // Profiles become Connections, their model a suggestion. A stock profile
    // still without a key was never set up, so it is not carried over.
    for (const preset of readStoredPresets() ?? []) {
        if (String(preset?.id ?? "").startsWith("default_") && !preset?.settings?.apiKey) continue;
        connections.push(normalizeConnection({
            provider: preset?.provider,
            name: preset?.name,
            apiKey: preset?.settings?.apiKey,
            endpoint: preset?.settings?.endpoint,
            customParams: preset?.settings?.customParams,
            suggestedModel: preset?.settings?.model,
        }));
    }

    const oldActive = PROVIDER_SETTINGS[active];
    const activeModel = (storedOldValue(oldActive.model) ?? oldActive.model.defaultValue ?? "").trim();
    const list = [normalizeEntry({
        connectionId: connectionFor[active],
        model: activeModel,
        structuredMode: storedOldValue(oldActive.structuredMode) ?? "auto",
    })];

    // The active provider's per-task models were the ones in effect. Each
    // distinct one becomes an entry at the bottom that its tasks point at; one
    // naming the default model points at entry #1.
    const picks = {};
    for (const { key } of AI_TASK_ROUTING) {
        const model = (storedOldValue(getSettingConfig(active, `model_${key}`)) ?? "").trim();
        if (!model) continue;
        let target = list.find((entry) => entry.model === model);
        if (!target) {
            target = normalizeEntry({ connectionId: connectionFor[active], model });
            list.push(target);
        }
        picks[key] = target.id;
    }

    writeJsonSetting(CONNECTIONS_KEY, connections);
    writeJsonSetting(TASK_PICKS_KEY, picks);
    // Last: its presence is what marks the migration done.
    writeJsonSetting(FALLBACK_LIST_KEY, list);
}

const ensureMigrated = () => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(FALLBACK_LIST_KEY) === null) migrateFromProviderSettings();
};

export function getConnections() {
    ensureMigrated();
    const stored = readJsonSetting(CONNECTIONS_KEY, []);
    return Array.isArray(stored) ? stored.map(normalizeConnection) : [];
}

export function getFallbackList() {
    ensureMigrated();
    const stored = readJsonSetting(FALLBACK_LIST_KEY, []);
    return Array.isArray(stored) ? stored.map(normalizeEntry) : [];
}

// "gemini-3.5-flash (Main Google)": how an entry is named in notices, logs and
// errors.
export const describeEntry = (model, connectionName) => `${model || "default model"} (${connectionName})`;

// A Connection as the player reads it: the name they gave it, or the provider's.
export const connectionDisplayName = (connection) => String(connection?.name ?? "").trim() || getProviderMeta(connection?.provider).label;

// Everything one call on one entry needs. Custom parameters are the entry's
// own override when it has one, else its Connection's.
const resolveEntry = (entry, connectionsById) => {
    const connection = connectionsById.get(entry.connectionId);
    if (!connection) return null;
    const model = entry.model.trim();
    return {
        id: entry.id,
        connectionId: connection.id,
        provider: connection.provider,
        connectionName: connectionDisplayName(connection),
        apiKey: connection.apiKey,
        endpoint: connection.endpoint,
        model,
        customParams: entry.customParamsOverride.trim() ? entry.customParamsOverride : connection.customParams,
        structuredMode: entry.structuredMode,
        toolStrict: connection.toolStrict,
        label: describeEntry(model, connectionDisplayName(connection)),
    };
};

// The list in order, each entry resolved. An entry whose Connection is gone is
// left out rather than failing every call.
export function getResolvedFallbackList() {
    const connectionsById = new Map(getConnections().map((connection) => [connection.id, connection]));
    return getFallbackList().map((entry) => resolveEntry(entry, connectionsById)).filter(Boolean);
}

// Whether an entry has what its provider needs before a call can go out: a
// hosted provider its key, a self-hosted one its endpoint.
const entryIsConfigured = (entry) => String(entry[providerSetupRequirement(entry.provider)] ?? "").trim().length > 0;

export function isFallbackListConfigured() {
    return getResolvedFallbackList().some(entryIsConfigured);
}

const saveConnections = (connections) => {
    writeJsonSetting(CONNECTIONS_KEY, connections);
    syncAiDebugContext();
    notifyFallbackChange();
};

const saveFallbackList = (list) => {
    writeJsonSetting(FALLBACK_LIST_KEY, list);
    syncAiDebugContext();
    notifyFallbackChange();
};

const connectionName = (id) => {
    const connection = getConnections().find((candidate) => candidate.id === id);
    return connection ? connectionDisplayName(connection) : "(removed)";
};

export function addConnection(fields) {
    const connection = normalizeConnection({ ...fields, id: undefined });
    saveConnections([...getConnections(), connection]);
    logDebugEvent("setting", `AI connection "${connectionDisplayName(connection)}" (${getProviderMeta(connection.provider).label}) added.`, {
        hasKey: Boolean(connection.apiKey.trim()),
        endpoint: endpointHostForLog(connection.endpoint),
    });
    return connection.id;
}

export function addEntry(fields) {
    const entry = normalizeEntry({ ...fields, id: undefined });
    saveFallbackList([...getFallbackList(), entry]);
    logDebugEvent("setting", `Fallback list: added ${describeEntry(entry.model, connectionName(entry.connectionId))} as entry ${getFallbackList().length}.`);
    return entry.id;
}

// The Fill button: every model (strongest first) on every ticked Connection,
// model first — the strong model on A, then on B, then the next model on A … —
// so the list falls back to a weaker model only once the strong one has nowhere
// left to answer from. A convenience for typing a long list, nothing more: the
// list it builds is used like any other, from the top, one entry at a time
// (docs/adr/0001). Appended, skipping any pair already in the list, so pressing
// it twice adds nothing.
export function fillFallbackList(connectionIds, models) {
    const list = getFallbackList();
    const known = new Set(list.map((entry) => `${entry.connectionId}|${entry.model.trim()}`));
    const added = [];
    for (const model of models.map((name) => String(name ?? "").trim()).filter(Boolean)) {
        for (const connectionId of connectionIds) {
            const key = `${connectionId}|${model}`;
            if (known.has(key)) continue;
            known.add(key);
            added.push(normalizeEntry({ connectionId, model }));
        }
    }
    if (added.length) {
        saveFallbackList([...list, ...added]);
        logDebugEvent("setting", `Fallback list: Fill added ${added.length} entr${added.length === 1 ? "y" : "ies"}.`, {
            models: models.join(", "),
            connections: connectionIds.length,
        });
    }
    return added.length;
}

// The start-of-game prompt's one-step setup (GameUI/apiSetupPrompt.jsx): a
// provider, its key or endpoint, an optional model — saved so the very next
// call can go out. A Connection for that provider that lacks exactly what was
// typed (the migrated Gemini connection with no key, say) is completed rather
// than duplicated; otherwise a new Connection is added. Its entry goes to the
// TOP of the list, so what was just set up answers first instead of waiting
// behind an entry that could not. A typed model replaces the entry's; a blank
// one keeps it. Throws when the provider's requirement is missing. Returns
// { connectionId, entryId }.
export function applyQuickAiSetup({ provider, apiKey = "", endpoint = "", model = "" } = {}) {
    const normalized = normalizeProvider(provider);
    const requirement = providerSetupRequirement(normalized);
    const key = String(apiKey ?? "").trim();
    const url = String(endpoint ?? "").trim();
    const modelName = String(model ?? "").trim();
    if (requirement === "endpoint" ? !url : !key) {
        throw new Error(requirement === "endpoint" ? "Enter the server endpoint first." : "Paste an API key first.");
    }
    const connections = getConnections();
    const list = getFallbackList();
    const lacks = (connection) => !String(connection?.[requirement] ?? "").trim();
    const top = connections.find((connection) => connection.id === list[0]?.connectionId);
    const target = (top && top.provider === normalized && lacks(top) ? top : null)
        ?? connections.find((connection) => connection.provider === normalized && lacks(connection))
        ?? null;
    let connectionId;
    if (target) {
        updateConnection(target.id, {
            apiKey: key || target.apiKey,
            endpoint: url || target.endpoint,
            suggestedModel: modelName || target.suggestedModel,
        });
        connectionId = target.id;
    } else {
        connectionId = addConnection({ provider: normalized, apiKey: key, endpoint: url, suggestedModel: modelName });
    }
    const existing = getFallbackList().find((entry) => entry.connectionId === connectionId);
    let entryId;
    if (existing) {
        entryId = existing.id;
        if (modelName && existing.model.trim() !== modelName) updateEntry(existing.id, { model: modelName });
    } else {
        entryId = addEntry({ connectionId, model: modelName });
    }
    if (getFallbackList().findIndex((entry) => entry.id === entryId) > 0) moveEntry(entryId, 0);
    logDebugEvent("setting", `Quick AI setup: ${getProviderMeta(normalized).label} ${requirement === "endpoint" ? "endpoint" : "key"} saved from the start-of-game prompt.`, {
        model: modelName || "(unchanged)",
    });
    return { connectionId, entryId };
}

// --- Entry states: Spent, Unusable, busy, last answered ---
//
// Kept under their own key, apart from the list, so that marking an entry never
// rewrites what the player typed. The runner (fallbackRunner.js) reads and
// writes them through this store.
const readEntryStates = () => {
    const states = readJsonSetting(ENTRY_STATES_KEY, {});
    return states && typeof states === "object" && !Array.isArray(states) ? states : {};
};

export const fallbackStateStore = {
    get: (id) => readEntryStates()[id],
    set: (id, state) => {
        const states = readEntryStates();
        if (state && Object.keys(state).length) states[id] = state;
        else delete states[id];
        try { writeJsonSetting(ENTRY_STATES_KEY, states); } catch { /* storage full: the marks are advice, not settings */ }
        notifyFallbackChange();
    },
};

// Anything the Settings rows show changed: a mark, an answer, an edit.
const notifyFallbackChange = () => {
    try { window.dispatchEvent(new CustomEvent("ai:fallback-changed")); } catch { /* no window (tests, the harness) */ }
};

// The marks about an allowance: an edit that leaves the key, the address and
// the model as they were leaves these alone.
const KEPT_WHILE_THE_ALLOWANCE_IS_THE_SAME = ["spentUntil", "skipUntil", "skipReason"];

// What a Settings row, the Logging file and batching read about one entry.
export const getEntryStatus = (id, at = Date.now()) => entryStatus(fallbackStateStore.get(id), at);

// Clears a mark, keeping when it last answered. `keep` names the marks an edit
// leaves alone (a new name for a Connection says nothing about its allowance).
const clearMarks = (id, keep = []) => {
    const state = fallbackStateStore.get(id);
    if (!state) return;
    const next = {};
    for (const field of ["lastAnsweredAt", ...keep]) if (state[field] !== undefined) next[field] = state[field];
    fallbackStateStore.set(id, next);
};

// The reset button on a Spent (or Unusable, or busy) row.
export function resetEntryState(id) {
    clearMarks(id);
    const entry = getResolvedFallbackList().find((candidate) => candidate.id === id);
    logDebugEvent("setting", `Fallback list: ${entry?.label ?? id} reset by the player.`);
}

// --- Editing ---

const CONNECTION_EDIT_LOG = {
    name: (connection) => `renamed "${connectionDisplayName(connection)}"`,
    apiKey: (connection) => `key ${connection.apiKey.trim() ? "set" : "cleared"}`,
    endpoint: (connection) => `endpoint set to ${endpointHostForLog(connection.endpoint)}`,
    customParams: (connection) => `custom parameters ${connection.customParams.trim() ? `set (${connection.customParams.trim().length} characters)` : "cleared"}`,
    toolStrict: (connection) => `strict tool schema turned ${connection.toolStrict ? "on" : "off"}`,
    suggestedModel: (connection) => `suggested model set to ${connection.suggestedModel || "(none)"}`,
};

export function updateConnection(id, patch) {
    const connections = getConnections();
    const index = connections.findIndex((connection) => connection.id === id);
    if (index === -1) return false;
    const before = connections[index];
    const next = normalizeConnection({ ...before, ...patch, id });
    connections[index] = next;
    saveConnections(connections);
    // A new key or address may well have a fresh allowance, so every mark on
    // its entries goes; any other edit clears only Unusable.
    const newAllowance = next.apiKey !== before.apiKey || next.endpoint !== before.endpoint || next.provider !== before.provider;
    for (const entry of entriesUsingConnection(id)) clearMarks(entry.id, newAllowance ? [] : KEPT_WHILE_THE_ALLOWANCE_IS_THE_SAME);
    for (const field of Object.keys(CONNECTION_EDIT_LOG)) {
        if (next[field] !== before[field]) {
            logSettingMessage(`connection:${id}:${field}`, `AI connection "${connectionDisplayName(next)}": ${CONNECTION_EDIT_LOG[field](next)}.`, { settle: true });
        }
    }
    notifyFallbackChange();
    return true;
}

export function entriesUsingConnection(connectionId) {
    return getFallbackList().filter((entry) => entry.connectionId === connectionId);
}

export function updateEntry(id, patch) {
    const list = getFallbackList();
    const index = list.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    const before = list[index];
    const next = normalizeEntry({ ...before, ...patch, id });
    // A structured-output mode is evidence about ONE model: carrying it onto a
    // new one could start that model in a weaker mode than it supports, and the
    // ladder only ever steps down, so nothing would find out otherwise.
    if (next.model !== before.model && patch.structuredMode === undefined) next.structuredMode = "auto";
    list[index] = next;
    saveFallbackList(list);
    // Any edit may be the fix for Unusable. Only a new model or Connection has
    // an allowance of its own, so only that clears Spent and busy: accepting a
    // structured-output suggestion must not bring a Spent model back.
    const newAllowance = next.model.trim() !== before.model.trim() || next.connectionId !== before.connectionId;
    clearMarks(id, newAllowance ? [] : KEPT_WHILE_THE_ALLOWANCE_IS_THE_SAME);
    if (next.model !== before.model || next.connectionId !== before.connectionId) {
        logSettingMessage(`entry:${id}:model`, `Fallback list: entry ${index + 1} is now ${describeEntry(next.model, connectionName(next.connectionId))}.`, { settle: true });
    }
    if (next.customParamsOverride !== before.customParamsOverride) {
        const size = next.customParamsOverride.trim().length;
        logSettingMessage(`entry:${id}:params`, `Fallback list: entry ${index + 1} custom parameters ${size ? `set (${size} characters)` : "follow its connection"}.`, { settle: true });
    }
    if (next.structuredMode !== before.structuredMode) {
        logSettingMessage(`entry:${id}:mode`, `Fallback list: entry ${index + 1} structured output set to ${next.structuredMode}.`, { settle: true });
    }
    notifyFallbackChange();
    return true;
}

const dropTaskPicksFor = (entryIds) => {
    const gone = new Set(entryIds);
    const picks = readJsonSetting(TASK_PICKS_KEY, {});
    const kept = Object.fromEntries(Object.entries(picks ?? {}).filter(([, entryId]) => !gone.has(entryId)));
    writeJsonSetting(TASK_PICKS_KEY, kept);
};

export function removeEntry(id) {
    const list = getFallbackList();
    const removed = list.find((entry) => entry.id === id);
    if (!removed) return false;
    saveFallbackList(list.filter((entry) => entry.id !== id));
    dropTaskPicksFor([id]);
    fallbackStateStore.set(id, null);
    logDebugEvent("setting", `Fallback list: removed ${describeEntry(removed.model, connectionName(removed.connectionId))}.`);
    return true;
}

// Removes the Connection and every entry using it. The Settings screen asks
// first, naming those entries (entriesUsingConnection).
export function removeConnection(id) {
    const connections = getConnections();
    const removed = connections.find((connection) => connection.id === id);
    if (!removed) return false;
    const using = entriesUsingConnection(id).map((entry) => entry.id);
    saveFallbackList(getFallbackList().filter((entry) => entry.connectionId !== id));
    dropTaskPicksFor(using);
    for (const entryId of using) fallbackStateStore.set(entryId, null);
    saveConnections(connections.filter((connection) => connection.id !== id));
    logDebugEvent("setting", `AI connection "${connectionDisplayName(removed)}" removed, with ${using.length} entr${using.length === 1 ? "y" : "ies"}.`);
    return true;
}

// The Clear list button, for undoing a Fill that went wrong: every entry goes,
// with its marks and any task pick pointing at it. The Connections stay, so
// the keys do not have to be pasted again — Fill can rebuild from them. An
// empty list stays empty (the migration only runs when the list was never
// stored), and until something is added nothing can answer, which the Settings
// screen asks about first.
export function clearFallbackList() {
    const ids = getFallbackList().map((entry) => entry.id);
    if (!ids.length) return 0;
    saveFallbackList([]);
    dropTaskPicksFor(ids);
    for (const id of ids) fallbackStateStore.set(id, null);
    logDebugEvent("setting", `Fallback list cleared: ${ids.length} entr${ids.length === 1 ? "y" : "ies"} removed.`);
    return ids.length;
}

export function moveEntry(id, toIndex) {
    const list = getFallbackList();
    const from = list.findIndex((entry) => entry.id === id);
    if (from === -1) return false;
    const [moved] = list.splice(from, 1);
    const target = Math.max(0, Math.min(list.length, Number(toIndex) || 0));
    list.splice(target, 0, moved);
    saveFallbackList(list);
    logDebugEvent("setting", `Fallback list: ${describeEntry(moved.model, connectionName(moved.connectionId))} moved to entry ${target + 1}.`);
    notifyFallbackChange();
    return true;
}

// --- Per-task picks ---

// A task's own pick: the id of the entry it tries first, or "" for none.
export function getTaskPick(taskKey) {
    ensureMigrated();
    const picks = readJsonSetting(TASK_PICKS_KEY, {});
    return typeof picks?.[taskKey] === "string" ? picks[taskKey] : "";
}

export function setTaskPick(taskKey, entryId) {
    ensureMigrated();
    const picks = { ...readJsonSetting(TASK_PICKS_KEY, {}) };
    if (entryId) picks[taskKey] = entryId;
    else delete picks[taskKey];
    writeJsonSetting(TASK_PICKS_KEY, picks);
    const task = AI_TASK_ROUTING.find((entry) => entry.key === taskKey)?.label || taskKey;
    const entry = getResolvedFallbackList().find((candidate) => candidate.id === entryId);
    logDebugEvent("setting", `${task} ${entry ? `tries ${entry.label} first` : "uses the Fallback list from the top"}.`);
    notifyFallbackChange();
}

// Resolve the effective starting entry for a task without mutating the player's
// stored Fallback list. Political World verification inherits the generation
// task's pick when it has no dedicated choice so both halves of one authored
// bootstrap use the same model by default. A dedicated verification pick still
// wins. All other tasks keep Beta's ordinary Fallback-list behavior.
export function resolveTaskFallbackEntries(taskKey, sourceEntries = null) {
    const key = String(taskKey ?? "").trim();
    const entries = Array.isArray(sourceEntries) ? [...sourceEntries] : getResolvedFallbackList();
    if (!key || entries.length === 0) return { entries, preferredEntryId: "", implicit: false };

    const explicitPick = getTaskPick(key);
    if (explicitPick && entries.some((entry) => entry.id === explicitPick)) {
        return { entries, preferredEntryId: explicitPick, implicit: false };
    }

    if (key === "politicalWorldVerification") {
        const generationPick = getTaskPick("politicalWorldGeneration");
        if (generationPick && entries.some((entry) => entry.id === generationPick)) {
            return { entries, preferredEntryId: generationPick, implicit: true };
        }
    }

    return { entries, preferredEntryId: "", implicit: false };
}

// --- When an entry is Rate limited ---

// One setting for the whole list. "wait" (the default) retries the same entry
// as the game always did, protecting the backups' daily allowance; "next"
// moves straight on.
export function getRateLimitPolicy() {
    return typeof localStorage !== "undefined" && localStorage.getItem(RATE_LIMIT_POLICY_KEY) === "next" ? "next" : "wait";
}

export function setRateLimitPolicy(policy) {
    const next = policy === "next" ? "next" : "wait";
    localStorage.setItem(RATE_LIMIT_POLICY_KEY, next);
    logDebugEvent("setting", `When a model is rate limited: ${next === "next" ? "try the next one" : "wait"}.`);
    notifyFallbackChange();
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
