/*! Open Historia — portions (reasoning toggle + small-screen menu) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { createPortal } from "react-dom";
import {
    AI_TASK_ROUTING,
    CONNECTION_TEMPLATES,
    DEFAULT_PROVIDER,
    GEMINI_DEFAULT_CHAIN,
    OPENAI_DEFAULT_MODEL,
    PROVIDER_OPTIONS,
    addConnection,
    addEntry,
    clearFallbackList,
    connectionDisplayName,
    entriesUsingConnection,
    fillFallbackList,
    getConnections,
    getEntryStatus,
    getFallbackList,
    getProviderMeta,
    getRateLimitPolicy,
    getReasoningEnabled,
    getRecentModels,
    getResolvedFallbackList,
    getTaskPick,
    moveEntry,
    providerSetupRequirement,
    removeConnection,
    removeEntry,
    resetEntryState,
    setRateLimitPolicy,
    setReasoningEnabled,
    setTaskPick,
    updateConnection,
    updateEntry,
} from "../AI/providerConfig.js";
import { formatResetTime } from "../AI/fallbackRunner.js";
import { REVIEW_SECTIONS, announceRequestBudgetChange, describeJumpCost, requestDay, requestSettings } from "../AI/requestBudget.js";
import { PLAYER_FOCUS_LEVELS, normalizePlayerFocus } from "../AI/playerFocus.js";
import { getActivePlayerFocus, useActiveFeatures } from "../../runtime/gameFeatures.js";
import { playerFocusOf } from "../../../server/gameFeatures.js";
import {
    isRatingEnabled,
    isTelemetryEnabled,
    setRatingEnabled,
    setTelemetryEnabled,
} from "../AI/telemetry.js";
import {
    STRUCTURED_MODES,
    STRUCTURED_MODE_HINTS,
    STRUCTURED_MODE_INTRO,
    STRUCTURED_MODE_LABELS,
    normalizeStructuredMode,
} from "../AI/structuredMode.js";
import {
    DEFAULT_LANGUAGE,
    getLanguageOptions,
    hasShippedPack,
    languageDisplayName,
    getStoredChatLanguage,
    getStoredLanguage,
    setStoredChatLanguage,
    setStoredLanguage,
} from "../../runtime/i18n.js";
import { LABEL_FONT_SUGGESTIONS, MAP_SETTING_KEYS, getMapSetting, getMapSettingDefaultOn, setMapSetting, setMapSettingValue, useMapSettingValue } from "../../runtime/mapSettings.js";
import { getLibraryState, saveGame, useLibraryState } from "../../runtime/library.js";
import { DISCORD_URL, REDDIT_URL } from "../../runtime/communityLinks.js";
import { CommunityTile, DISCORD_BLURPLE, DiscordMark, REDDIT_ORANGERED, RedditMark } from "./communityLogos.jsx";
import { copyToClipboard } from "../../runtime/clipboard.js";
import {
    buildLoggingFile,
    clearDebugLog,
    fetchDesktopLog,
    formatLogSize,
    getDebugLogBytes,
    getDebugLogLimitBytes,
    getDebugLogSize,
    getLoggingFileEntries,
    isDebugLogEnabled,
    isDebugLogVerbose,
    logDebugEvent,
    logSettingChange,
    setDebugLogEnabled,
    setDebugLogVerbose,
    subscribeToDebugLog,
} from "../../runtime/debugLog.js";
import { saveDebugLogFile } from "../../runtime/saveDebugLog.js";
import { buildGameZipBlob, formatZipSize, saveGameZipToDisk } from "../../runtime/gameZip.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { usePresenceLeaving } from "./presence.jsx";
import { ESRI_BASEMAPS, isBuiltinBasemapId } from "../../runtime/assets.js";
import PoliticalWorldABLab from "./PoliticalWorldABLab.jsx";

const baseStyle = {
    position: "fixed",
    backgroundColor: "var(--oh-hud-bg)",
    backdropFilter: "var(--oh-hud-blur)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "sans-serif",
    borderRadius: "14px",
    border: "1px solid var(--oh-hud-border)",
    boxShadow: "var(--oh-hud-shadow-soft)",
};

const labelStyle = {
    display: "block",
    fontSize: "0.82rem",
    marginBottom: "0.45rem",
    color: "rgba(255,255,255,0.92)",
    cursor: "text",
};

const inputStyle = {
    width: "100%",
    padding: "0.65rem 0.7rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.16)",
    backgroundColor: "rgba(0,0,0,0.22)",
    color: "white",
    fontSize: "0.85rem",
    outline: "none",
    boxSizing: "border-box",
    cursor: "text",
};

const helperStyle = {
    marginTop: "0.35rem",
    fontSize: "0.74rem",
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.45,
};

const fieldGroupStyle = {
    marginBottom: "0.85rem",
};

const smallButtonStyle = {
    padding: "0.4rem 0.7rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "white",
    fontSize: "0.78rem",
    cursor: "pointer",
};

const primaryButtonStyle = {
    ...smallButtonStyle,
    backgroundColor: "rgba(59,130,246,0.35)",
    borderColor: "rgba(59,130,246,0.6)",
};

const listCardStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    padding: "0.55rem 0.7rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.18)",
    marginBottom: "0.45rem",
};

// A <summary> is one line of small text, too thin for a thumb. On a touch
// screen its line is 44 px tall, which keeps the text and its ▸ centred (the
// tap classes set a min-height, and a summary would sit at the top of it).
const TOUCH_SUMMARY = { lineHeight: "2.75rem" };

function providerMatchesQuery(option, query) {
    if (!query) return true;

    const haystack = [
        option.label,
        option.group,
        option.description,
        ...(option.searchTerms ?? []),
    ]
    .join(" ")
    .toLowerCase();

    return haystack.includes(query);
}

function groupProviders(options) {
    const groups = [];

    for (const option of options) {
        let group = groups.find((entry) => entry.name === option.group);

        if (!group) {
            group = { name: option.group, items: [] };
            groups.push(group);
        }

        group.items.push(option);
    }

    return groups;
}

// A language whose interface ships translated (runtime/i18n.js): no AI request
// is spent on the game's own text in it.
const isBuiltInLanguage = (code) => code === DEFAULT_LANGUAGE || hasShippedPack(code);

const LanguagePicker = ({ label, current, onSelect, saving = false, helperText, markBuiltIn = false }) => {
    const [query, setQuery] = useState("");
    const options = getLanguageOptions();
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
        ? options.filter((option) =>
            `${option.name} ${option.native} ${option.code}`.toLowerCase().includes(normalizedQuery))
        : options;
    const listed = filtered.some((option) => option.code === current);

    return (
        <div style={fieldGroupStyle}>
        <label style={labelStyle}>{label}</label>
        <input
        style={{ ...inputStyle, marginBottom: "0.4rem" }}
        type="text"
        value={query}
        placeholder="Search languages..."
        onChange={(event) => setQuery(event.target.value)}
        />
        <select
        data-no-translate
        value={listed ? current : ""}
        onChange={(event) => onSelect(event.target.value)}
        style={{ ...inputStyle, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
        {!listed && (
            <option value="" disabled>
            {filtered.length ? `${filtered.length} matches — pick one` : "No matching language"}
            </option>
        )}
        {filtered.map((option) => (
            <option key={option.code} value={option.code} style={{ color: "black" }}>
            {option.name}{option.native && option.native !== option.name ? ` — ${option.native}` : ""}{markBuiltIn && isBuiltInLanguage(option.code) ? " ✓" : ""}
            </option>
        ))}
        </select>
        {helperText && (
            <div style={helperStyle}>
            {helperText}
            </div>
        )}
        </div>
    );
};

const LanguageSelector = () => {
    const [saving, setSaving] = useState(false);
    const current = getStoredLanguage();

    const applyLanguage = async (code) => {
        if (!code || code === current || saving) {
            return;
        }

        setSaving(true);
        // Before the reload below; the log is flushed on pagehide.
        logSettingChange("UI language", languageDisplayName(code));
        // Saves on the server too, so the phone app follows the same choice.
        await setStoredLanguage(code);
        // Reload so the translator starts (or stops) cleanly and every
        // already-rendered string goes through it from scratch.
        window.location.reload();
    };

    return (
        <LanguagePicker
        label="UI language"
        current={current}
        onSelect={applyLanguage}
        saving={saving}
        markBuiltIn
        helperText={isBuiltInLanguage(current)
            ? "Languages marked ✓ ship with the game translated. What scenarios add (names, descriptions, custom stats) is translated by your AI model, once."
            : "This language is translated by your AI model as you play, once per string. Languages marked ✓ ship with the game translated."}
        />
    );
};

// Steers prompts only, so no reload — the next message picks it up.
const ChatLanguageSelector = () => {
    const [current, setCurrent] = useState(getStoredChatLanguage);

    const applyLanguage = (code) => {
        if (!code || code === current) {
            return;
        }

        setStoredChatLanguage(code);
        setCurrent(code);
        logSettingChange("AI chat language", languageDisplayName(code));
    };

    return (
        <LanguagePicker
        label="AI chat language"
        current={current}
        onSelect={applyLanguage}
        helperText="What the advisor and diplomatic chats reply in. Defaults to your interface language."
        />
    );
};

// On a touch screen the whole row is the switch: the pill alone is 28 px tall,
// under a thumb's width, and the label beside it is what a thumb goes for. The
// pill keeps its size and stops shrinking when a long label wraps beside it.
const Toggle = ({ label, enabled, onToggle }) => {
    const touch = useTouchPrimary();
    return (
    <div
    className="oh-tap-row"
    onClick={touch ? onToggle : undefined}
    style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1rem",
        ...(touch ? { cursor: "pointer", gap: "0.75rem" } : null),
    }}
    >
    <span style={{ fontSize: "0.9rem" }}>{label}</span>
    <button
    onClick={touch ? undefined : onToggle}
    style={{
        width: "3.5rem",
        height: "1.75rem",
        borderRadius: "1rem",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "0.3s",
        backgroundColor: enabled ? "#3b82f6" : "#55555b",
        ...(touch ? { flexShrink: 0 } : null),
    }}
    >
    <div
    style={{
        position: "absolute",
        top: "2px",
        left: enabled ? "1.8rem" : "2px",
        width: "1.5rem",
        height: "1.5rem",
        backgroundColor: "white",
        borderRadius: "50%",
        transition: "0.3s",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        pointerEvents: "none",
    }}
    />
    </button>
    </div>
    );
};

const ApiProviderSelector = ({ provider, onProviderChange }) => {
    const [isCatalogOpen, setIsCatalogOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selectedProvider = getProviderMeta(provider);
    const normalizedQuery = query.trim().toLowerCase();
    const filteredProviders = PROVIDER_OPTIONS.filter((option) => providerMatchesQuery(option, normalizedQuery));
    const groupedProviders = groupProviders(filteredProviders);

    useEffect(() => {
        setQuery("");
        setIsCatalogOpen(false);
    }, [provider]);

    const handleProviderSelect = (value) => {
        onProviderChange(value);
        setQuery("");
        setIsCatalogOpen(false);
    };

    return (
        <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.6rem", color: "white" }}>
        AI Provider
        </label>

        <button
        onClick={() => setIsCatalogOpen((prev) => !prev)}
        style={{
            width: "100%",
            padding: "0.8rem 0.9rem",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.12)",
            backgroundColor: "rgba(0,0,0,0.18)",
            color: "white",
            cursor: "pointer",
            textAlign: "left",
        }}
        >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
        <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>
        {selectedProvider.label}
        </div>
        <div style={{ marginTop: "0.2rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.45 }}>
        {selectedProvider.group} · {selectedProvider.description}
        </div>
        </div>
        <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
        {isCatalogOpen ? "Hide" : "Change"}
        </div>
        </div>
        </button>

        <div style={{ ...helperStyle, marginBottom: isCatalogOpen ? "0.65rem" : 0 }}>
        Searchable catalog instead of a wall of provider buttons.
        </div>

        {isCatalogOpen && (
            <div
            style={{
                marginTop: "0.7rem",
                padding: "0.75rem",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.1)",
                backgroundColor: "rgba(255,255,255,0.04)",
            }}
            >
            <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search provider, protocol or gateway..."
            autoComplete="off"
            spellCheck={false}
            style={{
                ...inputStyle,
                marginBottom: "0.65rem",
            }}
            />

            <div style={{ maxHeight: "12rem", overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {groupedProviders.length > 0 ? groupedProviders.map((group) => (
                <div key={group.name}>
                <div style={{ marginBottom: "0.35rem", fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {group.name}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {group.items.map((option) => {
                    const selected = option.value === provider;

                    return (
                        <button
                        key={option.value}
                        onClick={() => handleProviderSelect(option.value)}
                        style={{
                            width: "100%",
                            padding: "0.7rem 0.75rem",
                            borderRadius: "8px",
                            border: "1px solid",
                            borderColor: selected ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)",
                            backgroundColor: selected ? "rgba(0,0,0,0.42)" : "rgba(0,0,0,0.16)",
                            color: "white",
                            cursor: "pointer",
                            textAlign: "left",
                        }}
                        >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                        <span style={{ fontSize: "0.84rem", fontWeight: selected ? 700 : 600 }}>
                        {option.label}
                        </span>
                        {selected && (
                            <span style={{ fontSize: "0.68rem", color: "#93c5fd", fontWeight: 700 }}>
                            Active
                            </span>
                        )}
                        </div>
                        <div style={{ marginTop: "0.18rem", fontSize: "0.72rem", lineHeight: 1.4, color: "rgba(255,255,255,0.6)" }}>
                        {option.description}
                        </div>
                        </button>
                    );
                })}
                </div>
                </div>
            )) : (
                <div style={{ ...helperStyle, marginTop: 0 }}>
                Nothing matched the search.
                </div>
            )}
            </div>
            </div>
        )}
        </div>
    );
};

// How to ask this provider for structured data. "Auto" tries the strongest
// method and steps down when a gateway ignores it, which is right for almost
// everyone — but that discovery costs a full generation per rung, and on a slow
// endpoint that accepts tool calling without honouring it, re-learning it on
// every call has been measured at half a turn. Setting it explicitly skips
// straight to what works.
//
// Never a lock: whatever is chosen, the ladder can still step down from it, so a
// setting made months ago cannot strand a campaign when a provider changes.
const StructuredModeSelect = ({ onChange, value }) => {
    const mode = normalizeStructuredMode(value);
    return (
        <div style={fieldGroupStyle}>
        <label style={labelStyle}>How the AI answers</label>
        <select
        data-no-translate
        value={mode}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...inputStyle, cursor: "pointer" }}
        >
        {["auto", ...STRUCTURED_MODES].map((option) => (
            <option key={option} value={option} style={{ color: "black" }}>
            {STRUCTURED_MODE_LABELS[option]}
            </option>
        ))}
        </select>
        <div style={helperStyle}>
        {/* The general point first, so it reads the same whatever is selected,
            then what THIS choice means. */}
        {mode === "auto" ? STRUCTURED_MODE_INTRO : STRUCTURED_MODE_HINTS[mode]}
        </div>
        </div>
    );
};

const SettingsInput = ({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    helperText,
    multiline = false,
    // Optional datalist entries (the provider's recent models): a hint, never a
    // constraint — the field still accepts anything typed.
    suggestions = null,
}) => {
    const listId = useId();
    const list = Array.isArray(suggestions) && suggestions.length ? suggestions : null;
    return (
        <div style={fieldGroupStyle}>
        <label style={labelStyle}>
        {label}
        </label>
        {multiline ? (
            <textarea
            rows={4}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
            />
        ) : (
            <input
            type={type}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            list={list ? listId : undefined}
            style={inputStyle}
            />
        )}
        {list && (
            <datalist id={listId}>
            {list.map((entry) => <option key={entry} value={entry} />)}
            </datalist>
        )}
        {helperText && (
            <div style={helperStyle}>
            {helperText}
            </div>
        )}
        </div>
    );
};

// --- The Fallback list (docs/world-state.md, "AI access") ---
//
// Settings → AI is the Fallback list: backup models, tried from the top, each
// one a Connection (a provider, a name, a key) and a model. With one entry it
// reads like the old single-provider form; "Add a backup" and Fill are the only
// new things a player who never uses them sees. Every field saves as it is
// typed (providerConfig.js), and every save announces itself, which is what
// re-renders this screen and the start-of-game prompt.

// What the screen shows, re-read on every change and every 15 seconds so a
// "back in 40s" counts down.
const readFallbackView = () => {
    const at = Date.now();
    const resolved = new Map(getResolvedFallbackList().map((entry) => [entry.id, entry]));
    return {
        at,
        connections: getConnections(),
        entries: getFallbackList().map((entry) => ({
            ...entry,
            resolved: resolved.get(entry.id) ?? null,
            status: getEntryStatus(entry.id, at),
        })),
        rateLimitPolicy: getRateLimitPolicy(),
    };
};

const useFallbackView = () => {
    const [view, setView] = useState(readFallbackView);
    useEffect(() => {
        const refresh = () => setView(readFallbackView());
        window.addEventListener("ai:fallback-changed", refresh);
        // The countdown only has to tick for someone watching it.
        const timer = setInterval(() => {
            if (document.visibilityState !== "hidden") refresh();
        }, 15000);
        return () => {
            window.removeEventListener("ai:fallback-changed", refresh);
            clearInterval(timer);
        };
    }, []);
    return view;
};

const formatAgo = (ms, at) => {
    const minutes = Math.round(Math.max(0, at - ms) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(ms).toLocaleDateString();
};

const STATUS_COLORS = {
    ready: { color: "#86efac", border: "rgba(134,239,172,0.28)", background: "rgba(34,197,94,0.1)" },
    spent: { color: "#fbbf24", border: "rgba(245,158,11,0.32)", background: "rgba(245,158,11,0.1)" },
    unusable: { color: "#fca5a5", border: "rgba(248,113,113,0.34)", background: "rgba(239,68,68,0.1)" },
    busy: { color: "#93c5fd", border: "rgba(96,165,250,0.3)", background: "rgba(59,130,246,0.1)" },
};

const describeRowStatus = (status, at) => {
    if (status.status === "spent") return `Spent until ${formatResetTime(status.until)}`;
    if (status.status === "unusable") return `Unusable: ${status.reason}`;
    // Not a skip: the next call still starts here (fallbackRunner.js). It says
    // how long the provider asked for, which is how long it is likely to keep
    // handing the call to the backup.
    if (status.status === "busy") {
        const seconds = Math.max(1, Math.ceil((status.until - at) / 1000));
        return `${status.reason === "rate limited" ? "Rate limited" : "Busy"}, for about ${seconds < 90 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}`;
    }
    return "Ready";
};

const StatusChip = ({ status, at }) => {
    const colors = STATUS_COLORS[status.status] ?? STATUS_COLORS.ready;
    return (
        <span style={{ background: colors.background, border: `1px solid ${colors.border}`, borderRadius: "999px", color: colors.color, fontSize: "0.66rem", fontWeight: 750, padding: "0.12rem 0.5rem", whiteSpace: "nowrap" }}>
            {describeRowStatus(status, at)}
        </span>
    );
};

// The first Connection, made if there is none: an entry cannot exist without one.
const ensureConnectionId = (connections) => connections[0]?.id ?? addConnection({ provider: DEFAULT_PROVIDER });

// A Connection's own fields: where it is and what reaches it. Shared by every
// entry that uses it, which the editor says when it is more than one.
const ConnectionFields = ({ connection, sharedBy = 1 }) => {
    const set = (field) => (value) => updateConnection(connection.id, { [field]: value });
    const selfHosted = providerSetupRequirement(connection.provider) === "endpoint";
    const meta = getProviderMeta(connection.provider);
    return (
        <>
        <ApiProviderSelector provider={connection.provider} onProviderChange={set("provider")} />
        <SettingsInput label="Connection name" value={connection.name} onChange={set("name")} placeholder={meta.label} />
        {selfHosted && (
            <SettingsInput
            label="API endpoint"
            value={connection.endpoint}
            onChange={set("endpoint")}
            placeholder={connection.provider === "openai-compatible" ? "http://localhost:11434/v1" : "https://my-proxy.example/v1"}
            // A server on the player's own machine works from the website too, but only
            // if it allows this origin — otherwise the browser silently drops the reply.
            // Say so up front here rather than letting it surface as "Failed to fetch".
            helperText={connection.provider === "openai-compatible"
                ? (import.meta.env.VITE_OH_WEB
                    ? "Base URL that exposes /chat/completions and /models. A server on your own machine (Ollama, LM Studio) also has to allow this site: start Ollama with OLLAMA_ORIGINS set to this site's address, or use the desktop app."
                    : "Base URL that exposes /chat/completions and /models.")
                : "Base URL of a self-hosted proxy that speaks the Anthropic Messages API (POST /messages)."}
            />
        )}
        <SettingsInput
        label={selfHosted ? "API key (optional)" : `${meta.label} API key`}
        type="password"
        value={connection.apiKey}
        onChange={set("apiKey")}
        placeholder={selfHosted ? "Leave empty if your server needs none" : `Paste ${meta.label} API key`}
        helperText={`Stored only in this browser.${sharedBy > 1 ? ` Shared by ${sharedBy} entries in your list.` : ""}`}
        />
        <SettingsInput
        label="Custom parameters (JSON)"
        multiline
        value={connection.customParams}
        onChange={set("customParams")}
        placeholder={connection.provider === "gemini" ? '{"generationConfig": {"topP": 0.9}}' : '{"top_p": 0.9}'}
        helperText="Optional. Merged into every request this connection sends — e.g. to limit reasoning budget/effort. An entry can override them. Invalid JSON is ignored."
        />
        {connection.provider === "openai-compatible" && (
            <>
            <Toggle label="Strict tool schema" enabled={connection.toolStrict} onToggle={() => set("toolStrict")(!connection.toolStrict)} />
            <div style={{ ...helperStyle, marginTop: "-0.6rem" }}>
            Sends strict:true with the tool call so a self-hosted backend constrains
            generation to the schema (SGLang/xgrammar, vLLM). Leave off for OpenAI and
            Azure: they reject a schema that does not list every property as required.
            </div>
            </>
        )}
        </>
    );
};

// One entry: its Connection (and that Connection's fields, where a rejected key
// is fixed), its model, and the per-model knobs.
const EntryEditor = ({ entry, connections, entries }) => {
    const connection = connections.find((candidate) => candidate.id === entry.connectionId) ?? null;
    const provider = connection?.provider ?? DEFAULT_PROVIDER;
    const sharedBy = entries.filter((other) => other.connectionId === entry.connectionId).length;
    const suggestions = [...new Set([connection?.suggestedModel, ...getRecentModels(provider)].filter(Boolean))];
    const set = (field) => (value) => updateEntry(entry.id, { [field]: value });
    const touch = useTouchPrimary();
    return (
        <div>
        {connections.length > 1 && (
            <div style={fieldGroupStyle}>
            <label style={labelStyle}>Connection</label>
            <select data-no-translate value={entry.connectionId} onChange={(event) => set("connectionId")(event.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            {connections.map((candidate) => (
                <option key={candidate.id} value={candidate.id} style={{ color: "black" }}>
                {connectionDisplayName(candidate)} — {getProviderMeta(candidate.provider).label}
                </option>
            ))}
            </select>
            </div>
        )}
        {connection && <ConnectionFields connection={connection} sharedBy={sharedBy} />}
        <SettingsInput
        label="Model"
        value={entry.model}
        onChange={set("model")}
        suggestions={suggestions}
        placeholder={provider === "gemini" ? GEMINI_DEFAULT_CHAIN[0] : provider === "openai" ? OPENAI_DEFAULT_MODEL : provider.startsWith("anthropic") ? "claude-haiku-4-5" : "Model id"}
        helperText={provider === "openai-compatible"
            ? "Leave blank to auto-pick a chat-capable model from the server's /models."
            : "Leave blank to use the built-in default."}
        />
        <details style={{ marginBottom: "0.4rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.74rem", color: "rgba(255,255,255,0.62)", marginBottom: "0.6rem", ...(touch ? TOUCH_SUMMARY : null) }}>This model only</summary>
        <SettingsInput
        label="Custom parameters for this model (JSON)"
        multiline
        value={entry.customParamsOverride}
        onChange={set("customParamsOverride")}
        placeholder="Blank uses the connection's"
        helperText="Replaces the connection's custom parameters for this entry — e.g. the same model with a larger max_tokens, picked by the Time skip task."
        />
        <StructuredModeSelect value={entry.structuredMode} onChange={set("structuredMode")} />
        </details>
        </div>
    );
};

const rowButtonStyle = { ...smallButtonStyle, padding: "0.25rem 0.5rem", fontSize: "0.72rem" };

// The Fill button's panel: tick Connections, type models strongest first.
const FillPanel = ({ connections, onDone }) => {
    const [ticked, setTicked] = useState(() => connections.map((connection) => connection.id));
    const [models, setModels] = useState("");
    const [added, setAdded] = useState(null);
    const toggle = (id) => setTicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
    const fill = () => {
        const order = connections.map((connection) => connection.id).filter((id) => ticked.includes(id));
        setAdded(fillFallbackList(order, models.split(/[\n,]/)));
    };
    return (
        <div style={{ marginTop: "0.7rem", padding: "0.75rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.03)" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.4rem" }}>Fill the list</div>
        <div style={{ ...helperStyle, marginTop: 0, marginBottom: "0.6rem" }}>
        Every model on every ticked connection, strongest model first across all of
        them: the first model on each connection, then the second, and so on. Rows
        you already have are skipped.
        </div>
        {connections.map((connection) => (
            <label key={connection.id} className="oh-tap-row" style={{ alignItems: "center", display: "flex", gap: "0.5rem", fontSize: "0.8rem", marginBottom: "0.35rem", cursor: "pointer" }}>
            <input type="checkbox" checked={ticked.includes(connection.id)} onChange={() => toggle(connection.id)} />
            {connectionDisplayName(connection)} <span style={{ color: "rgba(255,255,255,0.45)" }}>({getProviderMeta(connection.provider).label})</span>
            </label>
        ))}
        <SettingsInput label="Models, strongest first (one per line)" multiline value={models} onChange={setModels} placeholder={GEMINI_DEFAULT_CHAIN.join("\n")} />
        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
        <button type="button" className="oh-tap-row" onClick={fill} disabled={!ticked.length || !models.trim()} style={{ ...primaryButtonStyle, opacity: ticked.length && models.trim() ? 1 : 0.5 }}>Fill</button>
        <button type="button" className="oh-tap-row" onClick={onDone} style={smallButtonStyle}>Close</button>
        {added !== null && <span style={{ ...helperStyle, marginTop: 0 }}>{added ? `Added ${added} entr${added === 1 ? "y" : "ies"}.` : "Nothing new to add."}</span>}
        </div>
        </div>
    );
};

const FallbackListSection = () => {
    const view = useFallbackView();
    const [editingId, setEditingId] = useState(null);
    const [filling, setFilling] = useState(false);
    const { at, connections, entries } = view;
    const single = entries.length === 1;

    const addBackup = () => {
        const connectionId = entries[entries.length - 1]?.connectionId ?? ensureConnectionId(connections);
        setEditingId(addEntry({ connectionId, model: "" }));
    };

    const remove = (entry) => {
        const label = entry.resolved?.label ?? "this entry";
        if (!window.confirm(`Remove ${label} from the list?`)) return;
        removeEntry(entry.id);
    };

    // For a Fill that went wrong. Asks first: until a model is added again,
    // nothing can answer.
    const clearAll = () => {
        const count = entries.length;
        if (!window.confirm(`Remove all ${count} entr${count === 1 ? "y" : "ies"} from the list? Your connections and keys are kept, so Fill can rebuild it. Until you add a model again, the game can't write turns or replies.`)) return;
        clearFallbackList();
        setEditingId(null);
        // An open Fill panel would still say "Added N entries" about rows that are gone.
        setFilling(false);
    };

    return (
        <SettingsSection
        title="Models"
        description="Backup models: when one runs out, the next one takes over. Every AI call starts at the top of the list and moves down only when a model can't answer — including the call right after a busy moment, so a model is back in use the moment it can answer again. One that has used up its allowance is passed over until it resets, and tried again only if nothing else answers."
        >
        {entries.length === 0 && (
            <div style={{ ...helperStyle, marginTop: 0, marginBottom: "0.7rem" }}>No models yet. Add one to let the game write turns and replies.</div>
        )}
        {single && (
            <>
            <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
            <StatusChip status={entries[0].status} at={at} />
            {entries[0].status.status !== "ready" && <button type="button" className="oh-tap-row" onClick={() => resetEntryState(entries[0].id)} style={rowButtonStyle}>Reset</button>}
            </div>
            <EntryEditor entry={entries[0]} connections={connections} entries={entries} />
            </>
        )}
        {!single && entries.map((entry, index) => (
            <div key={entry.id} style={{ ...listCardStyle, flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
            <div data-no-translate style={{ fontSize: "0.82rem", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "rgba(255,255,255,0.4)", marginRight: "0.4rem" }}>{index + 1}</span>
            {entry.resolved?.label ?? "(connection removed)"}
            </div>
            <div style={{ ...helperStyle, marginTop: "0.15rem" }}>
            {getProviderMeta(entry.resolved?.provider).label}
            {entry.status.lastAnsweredAt ? ` · answered ${formatAgo(entry.status.lastAnsweredAt, at)}` : ""}
            </div>
            </div>
            <StatusChip status={entry.status} at={at} />
            </div>
            <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.45rem", flexWrap: "wrap" }}>
            <button type="button" className="oh-tap" onClick={() => moveEntry(entry.id, index - 1)} disabled={index === 0} aria-label="Move up" title="Move up" style={{ ...rowButtonStyle, opacity: index === 0 ? 0.4 : 1 }}>↑</button>
            <button type="button" className="oh-tap" onClick={() => moveEntry(entry.id, index + 1)} disabled={index === entries.length - 1} aria-label="Move down" title="Move down" style={{ ...rowButtonStyle, opacity: index === entries.length - 1 ? 0.4 : 1 }}>↓</button>
            <button type="button" className="oh-tap-row" onClick={() => setEditingId(editingId === entry.id ? null : entry.id)} style={rowButtonStyle}>{editingId === entry.id ? "Done" : "Edit"}</button>
            {entry.status.status !== "ready" && <button type="button" className="oh-tap-row" onClick={() => resetEntryState(entry.id)} title="Clear this status. Every call tries this model again either way." style={rowButtonStyle}>Reset</button>}
            <button type="button" className="oh-tap" onClick={() => remove(entry)} aria-label="Remove" title="Remove from the list" style={rowButtonStyle}>✕</button>
            </div>
            {editingId === entry.id && (
                <div style={{ marginTop: "0.75rem" }}>
                <EntryEditor entry={entry} connections={connections} entries={entries} />
                </div>
            )}
            </div>
        ))}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
        <button type="button" className="oh-tap-row" onClick={addBackup} style={primaryButtonStyle}>{entries.length ? "+ Add a backup" : "+ Add a model"}</button>
        <button type="button" className="oh-tap-row" onClick={() => setFilling((open) => !open)} style={smallButtonStyle}>Fill…</button>
        {entries.length > 0 && <button type="button" className="oh-tap-row" onClick={clearAll} style={smallButtonStyle}>Clear list</button>}
        </div>
        {filling && <FillPanel connections={connections} onDone={() => setFilling(false)} />}
        <div style={{ ...fieldGroupStyle, marginTop: "0.9rem" }}>
        <label style={labelStyle}>When a model is rate limited</label>
        <select value={view.rateLimitPolicy} onChange={(event) => setRateLimitPolicy(event.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
        <option value="next" style={{ color: "black" }}>Use the next one straight away (default)</option>
        <option value="wait" style={{ color: "black" }}>Wait, then try it again</option>
        </select>
        <div style={helperStyle}>
        A rate limit is a short pause, not a used-up allowance, and it is usually
        over by the next call — which starts at the top of the list again. Waiting
        instead keeps your backups' daily allowance, at the cost of a slower turn.
        </div>
        </div>
        <div style={{ ...helperStyle, marginBottom: 0 }}>
        Mix a free key with a paid one, or with a local model. Each key is used under its provider's terms.
        </div>
        </SettingsSection>
    );
};

// Every saved Connection: add one (from a template or blank), edit it, or
// remove it along with the entries that use it.
const ConnectionsSection = () => {
    const { connections, entries } = useFallbackView();
    const [editingId, setEditingId] = useState(null);

    // Names the entries that go with it, so a Connection that half the list
    // hangs off is never removed by surprise.
    const remove = (connection) => {
        const usingIds = new Set(entriesUsingConnection(connection.id).map((entry) => entry.id));
        // Numbered by their place in the list, as the rows above are.
        const using = entries
            .map((entry, index) => (usingIds.has(entry.id) ? `${index + 1}. ${entry.resolved?.label ?? entry.model}` : null))
            .filter(Boolean);
        const name = connectionDisplayName(connection);
        const question = using.length
            ? `Remove "${name}"? These entries in your list use it and will be removed too:\n\n${using.join("\n")}`
            : `Remove "${name}"?`;
        if (!window.confirm(question)) return;
        removeConnection(connection.id);
    };

    return (
        <SettingsSection title="Connections" description="Saved ways to reach a provider: a name you choose, the key, and the endpoint if it needs one. Type a key once and use it in as many entries as you like.">
        {connections.map((connection) => {
            const using = entries.filter((entry) => entry.connectionId === connection.id).length;
            const selfHosted = providerSetupRequirement(connection.provider) === "endpoint";
            return (
                <div key={connection.id} style={{ ...listCardStyle, flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connectionDisplayName(connection)}</div>
                <div style={{ ...helperStyle, marginTop: "0.1rem" }}>
                {getProviderMeta(connection.provider).label}
                {selfHosted ? ` · ${connection.endpoint || "no endpoint"}` : ` · key ${connection.apiKey.trim() ? "set" : "not set"}`}
                {` · used by ${using} entr${using === 1 ? "y" : "ies"}`}
                </div>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                <button type="button" className="oh-tap-row" onClick={() => setEditingId(editingId === connection.id ? null : connection.id)} style={rowButtonStyle}>{editingId === connection.id ? "Done" : "Edit"}</button>
                <button type="button" className="oh-tap" onClick={() => remove(connection)} aria-label="Remove" title="Remove connection" style={rowButtonStyle}>✕</button>
                </div>
                </div>
                {editingId === connection.id && (
                    <div style={{ marginTop: "0.75rem" }}>
                    <ConnectionFields connection={connection} sharedBy={using} />
                    </div>
                )}
                </div>
            );
        })}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
        <button type="button" className="oh-tap-row" onClick={() => setEditingId(addConnection({ provider: DEFAULT_PROVIDER, name: "" }))} style={primaryButtonStyle}>+ New connection</button>
        {CONNECTION_TEMPLATES.map((template) => (
            <button key={template.name} type="button" className="oh-tap-row" onClick={() => setEditingId(addConnection(template))} style={smallButtonStyle}>+ {template.name}</button>
        ))}
        </div>
        </SettingsSection>
    );
};

// Per-task picks (ported from the abdulrahman-2005 fork's per-task routing):
// a task can start at an entry of its own, then falls back through the list
// from the top like every other call.
const TaskPicks = () => {
    const { entries } = useFallbackView();
    const [expanded, setExpanded] = useState(false);
    const [picks, setPicks] = useState(() => Object.fromEntries(AI_TASK_ROUTING.map(({ key }) => [key, getTaskPick(key)])));
    const groups = [...new Set(AI_TASK_ROUTING.map((entry) => entry.group))];
    const withConnection = entries.filter((entry) => entry.resolved);
    const activeCount = Object.values(picks).filter((id) => withConnection.some((entry) => entry.id === id)).length;

    const update = (key, entryId) => {
        setPicks((current) => ({ ...current, [key]: entryId }));
        setTaskPick(key, entryId);
    };

    return (
        <div>
        <button type="button" className="oh-tap-row" onClick={() => setExpanded((current) => !current)} style={{ ...smallButtonStyle, width: "100%", display: "flex", justifyContent: "space-between" }}>
        <span>Per-task models{activeCount ? ` (${activeCount} set)` : ""}</span>
        <span>{expanded ? "Hide" : "Show"}</span>
        </button>
        {expanded && (
            <div style={{ marginTop: "0.6rem" }}>
            {groups.map((group) => (
                <div key={group}>
                <div style={{ fontSize: "0.76rem", fontWeight: 700, opacity: 0.8, margin: "0.5rem 0 0.4rem" }}>{group}</div>
                {AI_TASK_ROUTING.filter((entry) => entry.group === group).map(({ key, label, hint }) => (
                    <div key={key} style={fieldGroupStyle}>
                    <label style={labelStyle}>{label}</label>
                    <select value={withConnection.some((entry) => entry.id === picks[key]) ? picks[key] : ""} onChange={(event) => update(key, event.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="" style={{ color: "black" }}>Start at the top of the list</option>
                    {withConnection.map((entry, index) => (
                        <option key={entry.id} value={entry.id} style={{ color: "black" }}>{index + 1}. {entry.resolved.label}</option>
                    ))}
                    </select>
                    <div style={helperStyle}>{hint}</div>
                    </div>
                ))}
                </div>
            ))}
            </div>
        )}
        </div>
    );
};

// The global reasoning switch: one toggle, applied in every provider mode.
const ReasoningSection = () => {
    const [reasoningOn, setReasoningOn] = useState(() => getReasoningEnabled());
    const toggleReasoning = () => {
        const next = !reasoningOn;
        setReasoningOn(next);
        setReasoningEnabled(next);
    };
    return (
        <SettingsSection title="Model reasoning" description="Applies to every model in the list.">
        <Toggle label="Model reasoning" enabled={reasoningOn} onToggle={toggleReasoning} />
        <div style={{ ...helperStyle, marginTop: "-0.6rem", marginBottom: 0 }}>
        Lets thinking-capable models reason before answering (Gemini thinking, OpenAI
        reasoning effort, Claude extended thinking). Slower and costs more tokens;
        needs a model that supports it.
        </div>
        </SettingsSection>
    );
};

// The request budget (AI/requestBudget.js): what today has cost, and the
// switches that decide what a time skip and an idle minute may spend. Its own
// storage and its own change event, so it sits outside mapSettings.
const REVIEW_SECTION_LABELS = {
    units: ["Move units to match the events", "Armies advance, retreat and take losses where the events say they did."],
    territory: ["Mark occupied and disputed land", "Captured towns change hands on the map; contested ones are striped."],
    structures: ["Put new structures on the map", "Bases, shipyards, data centres and ground stations appear where the events built them."],
    timeline: ["Take repeats and filler off the timeline", "Events that restate the record, or report a meeting with no outcome, are left out."],
    board: ["Keep the Projects board in step", "Progress, stalls and new long-term efforts follow from what happened."],
    spies: ["Collect your agents' reports", "Each agent files what it intercepted, at least every third skip."],
};

const useRequestDay = () => {
    const [day, setDay] = useState(() => requestDay());
    useEffect(() => {
        const refresh = () => setDay(requestDay());
        window.addEventListener("ai:request-budget", refresh);
        // The day turns over at midnight Pacific whether or not anything is sent.
        const timer = setInterval(refresh, 60000);
        return () => {
            window.removeEventListener("ai:request-budget", refresh);
            clearInterval(timer);
        };
    }, []);
    return day;
};

const RequestBudgetSection = () => {
    const day = useRequestDay();
    const [saving, setSaving] = useState(() => requestSettings.saveRequests());
    const [background, setBackground] = useState(() => requestSettings.backgroundAi());
    const [dailyLimit, setDailyLimit] = useState(() => String(requestSettings.dailyLimit()));
    const [backgroundCap, setBackgroundCap] = useState(() => String(requestSettings.backgroundDailyCap()));
    const [sections, setSections] = useState(() => Object.fromEntries(REVIEW_SECTIONS.map((section) => [section, requestSettings.reviewSection(section)])));

    const apply = (message, write) => {
        write();
        logDebugEvent("setting", message);
        announceRequestBudgetChange();
    };
    const cost = describeJumpCost({ saveRequests: saving });
    const share = day.limit > 0 ? Math.min(1, day.used / day.limit) : 0;
    const barColor = share >= 0.9 ? "#f87171" : share >= 0.7 ? "#fbbf24" : "#60a5fa";

    return (
        <SettingsSection
        title="AI requests"
        description="A free key allows a few hundred requests a day. These settings decide how many the game spends, and on what."
        >
            <div style={{ marginBottom: "0.95rem" }}>
                <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                    <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.82rem", fontWeight: 800 }}>
                        <span data-no-translate>{day.used}</span> of <span data-no-translate>{day.limit}</span> used today
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.64rem" }}>
                        resets at <span data-no-translate>{formatResetTime(day.resetAt)}</span>
                    </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: "999px", height: "6px", marginTop: "0.4rem", overflow: "hidden" }}>
                    <div style={{ background: barColor, height: "100%", width: `${Math.round(share * 100)}%` }} />
                </div>
                <div style={{ ...helperStyle, marginTop: "0.4rem" }}>
                    {day.lastJump ? <>Your last time skip used <span data-no-translate>{day.lastJump.used}</span>. </> : null}
                    {day.background > 0 ? <>Background AI has used <span data-no-translate>{day.background}</span> of its <span data-no-translate>{day.backgroundCap}</span>. </> : null}
                    {day.refused > 0 ? <>The provider turned away <span data-no-translate>{day.refused}</span> for coming too fast; those cost a wait, not allowance. </> : null}
                    Counted on this device, from midnight Pacific time, which is when a Gemini key&apos;s day begins.
                </div>
            </div>

            <Toggle
            label="Save AI requests"
            enabled={saving}
            onToggle={() => {
                const next = !saving;
                setSaving(next);
                apply(`Save AI requests turned ${next ? "on" : "off"}.`, () => requestSettings.setSaveRequests(next));
            }}
            />
            <div style={settingsHelper}>
                {saving
                    ? <>On (default): a time skip is one request, two when there is something to check afterwards, and never more than <span data-no-translate>{cost.max}</span>. The model is handed the names it needs instead of looking them up, a small mistake in its answer is cut out rather than asked for again, and the checks below go out together.</>
                    : <>Off: the most thorough turns, for a key with no daily limit. Every check after a skip makes its own request, the model may look things up (up to three extra requests per task), and a flawed answer is sent back to be redone. A busy skip can use twenty requests or more.</>}
            </div>

            <div style={fieldGroupStyle}>
                <label style={labelStyle} htmlFor="ai-daily-request-limit">Requests a day your key allows</label>
                <input
                id="ai-daily-request-limit"
                data-no-translate
                inputMode="numeric"
                style={{ ...inputStyle, maxWidth: "9rem" }}
                value={dailyLimit}
                onChange={(event) => setDailyLimit(event.target.value.replace(/[^\d]/g, ""))}
                onBlur={() => {
                    apply(`Daily request limit set to ${dailyLimit || "the default"}.`, () => requestSettings.setDailyLimit(dailyLimit));
                    setDailyLimit(String(requestSettings.dailyLimit()));
                }}
                />
                <div style={helperStyle}>Only used for the count above and to keep background AI from spending the end of your day. The game never stops you at the limit; your provider does.</div>
            </div>

            <Toggle
            label="Background AI"
            enabled={background}
            onToggle={() => {
                const next = !background;
                setBackground(next);
                apply(`Background AI turned ${next ? "on" : "off"}.`, () => requestSettings.setBackgroundAi(next));
            }}
            />
            <div style={settingsHelper}>
                {background
                    ? <>On (default): while you are not skipping time, countries may write to you unprompted, forces may reposition, agents may file extra reports, and a country you look at gets its first intelligence reading — each of those is a request nobody pressed a button for, and together they stop at the daily cap below.</>
                    : <>Off: the game only calls the model when you do something.</>}
            </div>
            {background && (
                <div style={fieldGroupStyle}>
                    <label style={labelStyle} htmlFor="ai-background-daily-cap">Background requests a day, at most</label>
                    <input
                    id="ai-background-daily-cap"
                    data-no-translate
                    inputMode="numeric"
                    style={{ ...inputStyle, maxWidth: "9rem" }}
                    value={backgroundCap}
                    onChange={(event) => setBackgroundCap(event.target.value.replace(/[^\d]/g, ""))}
                    onBlur={() => {
                        apply(`Background AI daily cap set to ${backgroundCap || "the default"}.`, () => requestSettings.setBackgroundDailyCap(backgroundCap));
                        setBackgroundCap(String(requestSettings.backgroundDailyCap()));
                    }}
                    />
                    <div style={helperStyle}>It also stops by itself once less than a tenth of your day is left.</div>
                </div>
            )}

            <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.74rem", fontWeight: 800, margin: "0.4rem 0 0.2rem" }}>Checks after a time skip</div>
            <div style={{ ...helperStyle, marginBottom: "0.7rem" }}>
                {saving
                    ? "All of these share ONE request, and only when the skip gave them something to look at. Turning one off never saves a request unless it was the only one with work to do; it does make that request smaller."
                    : "With Save AI requests off, each of these is its own request after every skip and these switches are not used."}
            </div>
            {REVIEW_SECTIONS.map((section, index) => (
                <React.Fragment key={section}>
                    <Toggle
                    label={REVIEW_SECTION_LABELS[section][0]}
                    enabled={sections[section]}
                    onToggle={() => {
                        const next = !sections[section];
                        setSections((current) => ({ ...current, [section]: next }));
                        apply(`After-skip check "${REVIEW_SECTION_LABELS[section][0]}" turned ${next ? "on" : "off"}.`, () => requestSettings.setReviewSection(section, next));
                    }}
                    />
                    <div style={{ ...settingsHelper, ...(index === REVIEW_SECTIONS.length - 1 ? { marginBottom: 0 } : {}) }}>{REVIEW_SECTION_LABELS[section][1]}</div>
                </React.Fragment>
            ))}
        </SettingsSection>
    );
};

const SocialLinks = ({ discordUrl, redditUrl, githubUrl }) => {
    // A link is not a button: its text would sit at the top of the 44 px the
    // tap class gives it, so on a touch screen it centres its own text.
    const touch = useTouchPrimary();
    const links = [
        discordUrl ? { label: "Discord", href: discordUrl } : null,
        redditUrl ? { label: "Reddit", href: redditUrl } : null,
        githubUrl ? { label: "GitHub", href: githubUrl } : null,
    ].filter(Boolean);

    if (!links.length) return null;

    return (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {links.map((link) => (
                <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="oh-tap-row"
                style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "7px",
                    color: "rgba(255,255,255,0.58)",
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    padding: "0.38rem 0.55rem",
                    textDecoration: "none",
                    ...(touch ? { alignItems: "center", display: "inline-flex" } : null),
                }}
                >
                {link.label}
                </a>
            ))}
        </div>
    );
};

// Same corner and size as always (the top bar's session pill is laid out from
// it), in the glass finish and with the menu glyph.
// `hidden` while the menu is open: the menu grows out of this button and
// shrinks back into it, so the button itself steps aside meanwhile.
const SettingsButton = ({ onToggle, topOffset = "0.5rem", hidden = false }) => (
    <button
    type="button"
    aria-label="Open game menu"
    title="Game menu"
    onClick={onToggle}
    style={{
        ...baseStyle,
        top: topOffset,
        left: `calc(0.5rem + ${SAFE_LEFT})`,
        height: "4rem",
        width: "4rem",
        cursor: "pointer",
        fontSize: "1.5rem",
        fontWeight: 800,
        background: "linear-gradient(180deg, rgba(53,53,58,0.58), rgba(17,17,19,0.48))",
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "opacity 180ms ease 40ms",
    }}
    >
    ☰
    </button>
);

// --- Network: let other devices connect -------------------------------------
// The server binds loopback by default, which is right for the desktop app and
// wrong for the two setups this game has always supported: the Android client
// pointed at a desktop, and a browser on another computer. Those used to work
// because the server was open to the network whether or not anyone wanted it.
// Now they work because the player says so, here — no environment variable, no
// restart, and the address to type into the phone is on screen instead of being
// something you go and look up.
//
// Server-backed builds only: the hosted website has no local server to share.
// Rendered inside its card in the Advanced section, which owns the heading.
const NetworkSharing = () => {
    const [state, setState] = useState(null);   // null until we know there is a server
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (import.meta.env.VITE_OH_WEB) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch("/api/server/network");
                if (!response.ok) return;
                const data = await response.json();
                if (!cancelled) setState(data);
            } catch {
                /* no server behind this build — leave the section hidden */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (!state) {
        return (
            <div style={{ ...helperStyle, marginTop: 0 }}>
            No local server is behind this build, so there is nothing to share.
            </div>
        );
    }

    const toggle = async () => {
        if (busy || state.lockedByEnv) return;
        setBusy(true);
        setError("");
        const next = !state.lanEnabled;
        try {
            const response = await fetch("/api/server/network", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lanEnabled: next }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || "Could not change this.");
            setState(data);
            logSettingChange("Let other devices connect", Boolean(data?.lanEnabled));
        } catch (nextError) {
            setError(nextError.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
        <div style={state.lockedByEnv ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <Toggle
        label="Let other devices connect"
        enabled={state.lanEnabled}
        onToggle={toggle}
        />
        </div>

        {state.lockedByEnv ? (
            <div style={helperTextStyle}>
            Set by the OH_HOST environment variable ({state.host}), so this switch is read-only. Unset it to control sharing from here.
            </div>
        ) : (
            <div style={helperTextStyle}>
            On: the Android app and browsers on other computers can reach this server. Off (default): only this machine can.
            </div>
        )}

        {state.lanEnabled && state.addresses?.length > 0 && (
            <div style={{
                background: "rgba(59,130,246,0.12)",
                border: "1px solid rgba(96,165,250,0.35)",
                borderRadius: "8px",
                fontSize: "0.74rem",
                lineHeight: 1.5,
                marginBottom: "0.5rem",
                padding: "0.5rem 0.6rem",
            }}>
            <div style={{ marginBottom: "0.25rem", opacity: 0.8 }}>Type this into the Android app:</div>
            {state.addresses.map((address) => (
                <div key={address.url} style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, overflowWrap: "anywhere" }}>
                {address.url}
                {state.addresses.length > 1 && (
                    <span style={{ fontWeight: 400, opacity: 0.55 }}> ({address.interface})</span>
                )}
                </div>
            ))}
            </div>
        )}

        {state.lanEnabled && (
            <div style={{
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.35)",
                borderRadius: "8px",
                color: "#fbbf24",
                fontSize: "0.72rem",
                lineHeight: 1.45,
                marginBottom: "0.4rem",
                padding: "0.45rem 0.6rem",
            }}>
            This server has no password. Anyone on the same network can open, change and delete your games while this is on — fine at home, not on public Wi-Fi.
            </div>
        )}

        {error && (
            <div style={{ color: "#fca5a5", fontSize: "0.72rem", lineHeight: 1.4, marginBottom: "0.4rem" }}>{error}</div>
        )}
        </div>
    );
};

// Settings → Diagnostics → View log: the Logging file's entries, newest first,
// so a player can look before they send — the page's own and, on desktop, the
// desktop app's and server's, exactly as the file would hold them
// (getLoggingFileEntries). Read once on opening and on Refresh rather than live:
// the Desktop log is a request away, and a list that reorders under the reader
// while a turn runs cannot be read.
const DiagnosticsLogViewer = () => {
    const [shown, setShown] = useState(null);
    const [desktopStatus, setDesktopStatus] = useState("");
    const [onlyProblems, setOnlyProblems] = useState(false);
    const [expanded, setExpanded] = useState(null);
    // Each line opens its detail; on a touch screen every line is a thumb tall,
    // with its text centred rather than on the baseline at the top.
    const touch = useTouchPrimary();

    const show = (desktop) => {
        setDesktopStatus(desktop.status);
        setShown(getLoggingFileEntries({ desktop }));
        setExpanded(null);
    };
    const load = () => fetchDesktopLog().then(show);

    // Read once on opening. `cancelled` because the menu can close before the
    // Desktop log answers.
    useEffect(() => {
        let cancelled = false;
        fetchDesktopLog().then((desktop) => { if (!cancelled) show(desktop); });
        return () => { cancelled = true; };
    }, []);

    const entries = (shown ?? []).filter((entry) => !onlyProblems || entry.problem);

    return (
        <div style={{ marginBottom: "0.8rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
        <button type="button" className="oh-tap-row" onClick={load} style={{ ...diagnosticsButton, flex: 1 }}>Refresh</button>
        <button type="button" className="oh-tap-row" onClick={() => setOnlyProblems((value) => !value)} style={{ ...diagnosticsButton, flex: 1 }}>
        {onlyProblems ? "Showing problems only" : "Showing everything"}
        </button>
        </div>
        {desktopStatus === "unavailable" && (
            <div style={{ fontSize: "0.68rem", color: "rgba(255,200,97,0.8)", marginBottom: "0.4rem" }}>
            The desktop app&apos;s own entries could not be read just now.
            </div>
        )}
        <div style={{ maxHeight: "18rem", overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px" }}>
        {shown === null && <div style={viewerNoteStyle}>Reading the log…</div>}
        {shown !== null && entries.length === 0 && (
            <div style={viewerNoteStyle}>{onlyProblems ? "No problems logged." : "Nothing logged yet."}</div>
        )}
        {entries.map((entry, index) => (
            <div key={`${entry.at}-${index}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0.3rem 0.45rem" }}>
            <div
            className="oh-tap-row"
            onClick={() => entry.detail && setExpanded(expanded === index ? null : index)}
            style={{ cursor: entry.detail ? "pointer" : "default", display: "flex", gap: "0.45rem", fontSize: "0.72rem", alignItems: touch ? "center" : "baseline" }}
            >
            <span style={{ color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>{String(entry.at || "").slice(11, 19)}</span>
            <span style={{ color: entry.problem ? "#ffb35c" : "rgba(255,255,255,0.55)", fontWeight: 700, whiteSpace: "nowrap" }}>{entry.category}</span>
            <span style={{ color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {entry.message}{entry.repeat > 1 ? ` (×${entry.repeat})` : ""}
            </span>
            {entry.detail && <span style={{ color: "rgba(255,255,255,0.35)" }}>{expanded === index ? "▾" : "▸"}</span>}
            </div>
            {expanded === index && (
                <pre style={{
                    background: "rgba(0,0,0,0.35)", borderRadius: 6, color: "rgba(255,255,255,0.8)",
                    fontSize: "0.68rem", margin: "0.3rem 0 0", maxHeight: "12rem", overflow: "auto", padding: "0.45rem",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>{entry.detail}</pre>
            )}
            </div>
        ))}
        </div>
        </div>
    );
};

const viewerNoteStyle = { padding: "0.6rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.45)" };

// The button picks its own game — whichever is being played — so both the tooltip
// and the result name it. A campaign name can be long; the button is one line.
const IDLE_ATTACH = { kind: "idle" };
const shortGameName = (name) => {
    const text = String(name ?? "").trim();
    return text.length > 28 ? `${text.slice(0, 27)}…` : text;
};
const attachGameTitle = (loggingOn, gameName) => {
    const which = gameName ? `“${gameName}”` : "the game you are playing";
    return loggingOn
        ? `Saves the log file, then ${which} as a .zip. Send both with the report: the log says what happened, the game is what it happened to.`
        : `Logging is off, so there is no log to save — this saves ${which} as a .zip.`;
};

// Settings → Advanced → Diagnostics: the log a player pastes into a bug report.
//
// Two ways out, because the two report routes want different things. Copy is for
// Discord, where a paste is one action and an attachment is four. Save is for a
// GitHub issue and for the long logs — a full buffer is a couple of hundred
// kilobytes, past what a Discord message will take, and an attached file is also
// the only form that survives being read a week later. Both sit above the
// toggles: getting the log out is what a player comes to this section to do, and
// the switches are set once and then left alone.
//
// The warning is not boilerplate. This log carries the names of the player's
// countries, their queued orders and their in-game dates, and some of that is
// campaign fiction they may not want in public. It never carries an API key
// (runtime/debugLog.js redacts on the way in), and saying so explicitly is what
// stops the more careful half of players from deciding not to send it at all.
const DiagnosticsPanel = () => {
    const [copyState, setCopyState] = useState("idle");
    const [cleared, setCleared] = useState(false);
    const [viewing, setViewing] = useState(false);
    const [attachState, setAttachState] = useState(IDLE_ATTACH);
    // Read at render rather than subscribed: this panel is remounted every time the
    // settings menu opens, and the name only has to be right when it is on screen.
    const activeGameName = String(getLibraryState().activeGame?.name ?? "").trim();
    // The count is the whole reason this section is visible when nothing is
    // wrong: "Entries: 0" after a crash means the log is not recording and the
    // player should say so, rather than pasting an empty report.
    const [count, setCount] = useState(() => getDebugLogSize());
    const [bytes, setBytes] = useState(() => getDebugLogBytes());
    // Both toggles are read from the module rather than held only here, because
    // the module is where the persisted answer lives — this panel is unmounted
    // every time the menu closes, and a useState default would otherwise be a
    // second, disagreeing copy of the setting.
    const [enabled, setEnabled] = useState(() => isDebugLogEnabled());
    const [verbose, setVerbose] = useState(() => isDebugLogVerbose());

    useEffect(() => subscribeToDebugLog(() => {
        setCount(getDebugLogSize());
        setBytes(getDebugLogBytes());
    }), []);

    const toggleEnabled = () => {
        const next = !enabled;
        setDebugLogEnabled(next);
        setEnabled(next);
        setCount(getDebugLogSize());
        setBytes(getDebugLogBytes());
    };

    const toggleVerbose = () => {
        const next = !verbose;
        setDebugLogVerbose(next);
        setVerbose(next);
    };

    const handleCopy = async () => {
        setCopyState("copying");
        // Through the shared helper: navigator.clipboard needs a secure context
        // and a browser reaching this game over plain http on the LAN (Settings →
        // Network) does not have one. Same reason clipboard.js exists at all.
        const ok = await copyToClipboard(await buildLoggingFile());
        setCopyState(ok ? "copied" : "failed");
        setTimeout(() => setCopyState("idle"), 2500);
    };

    // The same save the failure buttons use. Where the save fails it copies
    // instead, and says so on the Copy button beside it.
    const handleDownload = async () => {
        if (await saveDebugLogFile() !== "copied") return;
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 2500);
    };

    // Two files, deliberately, and the .txt first. GitHub and Discord both preview
    // a .txt inline, so a maintainer reads the log without downloading anything;
    // a log zipped in beside the game would be a file nobody opens. In the
    // Android app both go to Downloads/Open Historia (runtime/saveFile.js).
    const handleAttachGame = async () => {
        const { activeGame, activeGameId: gameId } = getLibraryState();
        if (!gameId) {
            setAttachState({ kind: "no game" });
            setTimeout(() => setAttachState(IDLE_ATTACH), 2500);
            return;
        }

        // The name, because this button picks its own game — whichever one is being
        // played, which is not necessarily the one the player was last looking at in
        // the library. Saying which was saved is the difference between a file they
        // can send with confidence and one they have to go and check.
        const name = String(activeGame?.name ?? "").trim() || gameId;

        setAttachState({ kind: "working" });
        try {
            // With logging off there is no log to send — saving an empty one would
            // be a file that says nothing, and the button above already says the
            // same thing by being dimmed. Just the game, and the label says so.
            if (enabled) await saveDebugLogFile();
            const { blob } = await buildGameZipBlob(gameId);
            saveGameZipToDisk(blob, `${gameId}-game.zip`);
            setAttachState({ kind: "saved", name, size: formatZipSize(blob.size) });
        } catch (error) {
            logDebugEvent("diagnostics", "Saving the game failed.", { error: error?.message || String(error) });
            setAttachState({ kind: "failed" });
        }
        setTimeout(() => setAttachState(IDLE_ATTACH), 4000);
    };

    const handleClear = () => {
        clearDebugLog();
        setCleared(true);
        setTimeout(() => setCleared(false), 2500);
    };

    return (
        <div>
        <div style={{ marginBottom: "0.55rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.35 }}>
        The game keeps a running log of what you did — saves opened, orders queued, turns taken, and anything that went wrong. Send it with a bug report and it says what happened, in order. Saving it with the game attaches the campaign it happened in, which is what lets a fix be tested against it.
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", opacity: enabled ? 1 : 0.45 }}>
        <button
        type="button"
        className="oh-tap-row"
        onClick={handleCopy}
        disabled={copyState === "copying"}
        style={{ ...diagnosticsButton, flex: 1 }}
        >
        {copyState === "copied" ? "✓ Copied!" : copyState === "failed" ? "Couldn't copy" : copyState === "copying" ? "Copying…" : "📋 Copy log"}
        </button>
        <button type="button" className="oh-tap-row" onClick={handleDownload} style={{ ...diagnosticsButton, flex: 1 }}>
        💾 Save log file
        </button>
        </div>

        {/* The save itself as a second file, for a report a maintainer has to
            reproduce: the log fingerprints the prompts, the game is what a prompt
            can be rebuilt from. Offered in the Android app too since files save
            to Downloads/Open Historia there (runtime/saveFile.js). */}
        {(
        <button
        type="button"
        className="oh-tap-row"
        onClick={handleAttachGame}
        disabled={attachState.kind === "working"}
        style={{ ...diagnosticsButton, width: "100%", marginBottom: "0.5rem" }}
        title={attachGameTitle(enabled, activeGameName)}
        >
        {attachState.kind === "working"
            ? "Packing the game…"
            : attachState.kind === "no game"
            ? "No game open"
            : attachState.kind === "failed"
            ? "Couldn't save the game"
            : attachState.kind === "saved"
            ? `✓ Saved ${enabled ? "log + " : ""}“${shortGameName(attachState.name)}” (${attachState.size})`
            : enabled ? "💾 Save log file + game" : "💾 Save game"}
        </button>
        )}

        <button
        type="button"
        className="oh-tap-row"
        onClick={() => setViewing((value) => !value)}
        style={{ ...diagnosticsButton, width: "100%", marginBottom: "0.5rem" }}
        >
        {viewing ? "Hide log" : "🔎 View log"}
        </button>
        {viewing && <DiagnosticsLogViewer />}

        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)" }}>
        {/* The size, not just the count, because the cap is otherwise invisible:
            a player watching the count sit still cannot tell a quiet game from a
            log that is silently rolling its oldest entries off the front. */}
        {!enabled
            ? "Not recording."
            : cleared
            ? "Cleared."
            : `${count} ${count === 1 ? "entry" : "entries"} · ${formatLogSize(bytes)} of ${formatLogSize(getDebugLogLimitBytes())}`}
        </span>
        <button
        type="button"
        className="oh-tap-row"
        onClick={handleClear}
        title="Empties the log. Do this just before reproducing a bug and the log will contain only the steps that caused it."
        style={{ ...diagnosticsButton, padding: "0.3rem 0.55rem", fontSize: "0.7rem" }}
        >
        Clear
        </button>
        </div>

        <div style={{ margin: "0.5rem 0 1rem", fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
        {/* The warning tracks the switch below rather than stating the worst
            case always: a player reading "your conversations are included" on a
            log that does not contain them learns to disbelieve this line, which
            is the one line here that has to be believed. */}
        Your API key is never included. Country names, your queued orders and error messages are{verbose ? ", and while detailed logging is on, everything you and the AI said to each other" : ""} — read it before posting it somewhere public.
        </div>

        <Toggle label="Keep a diagnostics log" enabled={enabled} onToggle={toggleEnabled} />
        <div style={helperTextStyle}>
        On by default. Off: nothing is recorded and the log on this device is deleted. The desktop app still notes its own start-up and server errors, which never include your campaign. Remembered across save changes and restarts.
        </div>

        <Toggle label="Detailed logging" enabled={verbose} onToggle={toggleVerbose} />
        <div style={helperTextStyle}>
        Off by default, and remembered like the switch above. Turn it on before reproducing a bug, then send the log. Adds:
        <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1rem" }}>
        <li>Every message to and from your advisor, in full</li>
        <li>Every diplomatic message, in full, with who said it to whom</li>
        <li>Letters the advisor drafted, and the notes countries send you</li>
        <li>Every AI task and what it answered, and why an answer was rejected</li>
        <li>What each turn changed in the world</li>
        <li>Every server request and every save, with sizes</li>
        <li>Which panels you opened</li>
        <li>Full error stacks and much longer details</li>
        <li>The game&apos;s routine console messages</li>
        </ul>
        <div style={{ marginTop: "0.3rem" }}>
        The log fills much faster while this is on, so it reaches less far back. It quotes your conversations word for word — read it before posting it somewhere public.
        </div>
        </div>

        </div>
    );
};

const helperTextStyle = {
    marginTop: "-0.7rem",
    marginBottom: "0.7rem",
    fontSize: "0.72rem",
    color: "rgba(255,255,255,0.45)",
    lineHeight: 1.35,
};

const diagnosticsButton = {
    alignItems: "center",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "8px",
    color: "white",
    cursor: "pointer",
    display: "flex",
    fontFamily: "sans-serif",
    fontSize: "0.78rem",
    fontWeight: 600,
    gap: "0.35rem",
    justifyContent: "center",
    padding: "0.45rem 0.6rem",
};

// --- The game menu -------------------------------------------------------------
// Ported from kernely's Continuum branch, kept as it is there: a compact quick
// menu anchored under the menu button (Game / Tools / Settings / Help), and a
// full-screen settings workspace with the same four sections — General, Map,
// AI, Advanced. The settings this branch has on top of Continuum's (profiles,
// per-task models, long-skip segments, batching, telemetry, the beta unit
// system, network sharing, diagnostics) sit inside those four sections rather
// than adding sections of their own.

const QuickAction = ({ title, description, symbol, tone = "neutral", onClick, href, compact = false }) => {
    const tones = {
        neutral: { background: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)", icon: "rgba(255,255,255,0.08)", color: "#f8fafc" },
        slate: { background: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.12)", icon: "rgba(255,255,255,0.08)", color: "#e4e4e7" },
        blue: { background: "rgba(59,130,246,0.08)", border: "rgba(96,165,250,0.18)", icon: "rgba(59,130,246,0.16)", color: "#dbeafe" },
        amber: { background: "rgba(245,158,11,0.07)", border: "rgba(251,191,36,0.17)", icon: "rgba(245,158,11,0.14)", color: "#fde68a" },
    };
    const palette = tones[tone] ?? tones.neutral;
    const common = {
        alignItems: "center",
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: compact ? "9px" : "11px",
        color: palette.color,
        cursor: "pointer",
        display: "flex",
        fontFamily: "inherit",
        gap: compact ? "0.6rem" : "0.75rem",
        minHeight: compact ? "3rem" : "4.35rem",
        padding: compact ? "0.55rem 0.65rem" : "0.72rem 0.8rem",
        textAlign: "left",
        textDecoration: "none",
        width: "100%",
    };
    const content = (
        <>
            <span aria-hidden="true" style={{ alignItems: "center", background: palette.icon, border: `1px solid ${palette.border}`, borderRadius: "8px", display: "inline-flex", flexShrink: 0, fontSize: compact ? "0.85rem" : "1rem", fontWeight: 900, height: compact ? "1.9rem" : "2.35rem", justifyContent: "center", width: compact ? "1.9rem" : "2.35rem" }}>{symbol}</span>
            <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: compact ? "0.78rem" : "0.84rem", fontWeight: 850 }}>{title}</span>
                {description && <span style={{ color: "rgba(255,255,255,0.38)", display: "block", fontSize: compact ? "0.61rem" : "0.64rem", lineHeight: 1.35, marginTop: "0.16rem" }}>{description}</span>}
            </span>
        </>
    );

    if (href) {
        return <a href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" style={common}>{content}</a>;
    }
    return <button type="button" onClick={onClick} style={common}>{content}</button>;
};

// How much of each time skip is about the player's own country (AI/playerFocus.js).
// Kept with the GAME rather than on this device, unlike its neighbours in this
// section: a Spotlight war campaign should not decide how the next sandbox game
// reads. Existing games have none stored and start on Balanced.
const PLAYER_FOCUS_HINTS = {
    "world-first": "The world comes first. At least a quarter of each skip is about you when you have something going on; the rest of the world gets the room.",
    balanced: "The default. At least 40% of each skip is about you when you have orders, Projects or open threads.",
    focused: "Your country leads. At least 60% of each skip is about you, and other powers' plans take up less of what the AI is shown.",
    spotlight: "The story follows you. At least three quarters of each skip is about you, and the wider world is kept to what matters most.",
};

const PlayerFocusSetting = () => {
    // The scenario's default under this game's own choice (server/gameFeatures.js).
    // Kept with the GAME, not on this device: a Spotlight war campaign should not
    // decide how the next sandbox game reads. A scenario author sets where new
    // games start, in the library's Features tab.
    useActiveFeatures();
    const library = useLibraryState();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const gameId = library.activeGameId;
    const scenarioLevel = normalizePlayerFocus(playerFocusOf(library.runtimeScenario?.features));
    const override = library.activeGame?.features?.playerFocus?.level;
    const focus = normalizePlayerFocus(getActivePlayerFocus());
    const following = !override;

    const choose = async (value) => {
        if (!gameId) { setError("No game is open, so there is nothing to set it on."); return; }
        setSaving(true);
        setError("");
        try {
            // undefined clears the override, so the game follows its scenario again.
            await saveGame(gameId, { features: { playerFocus: { level: value ?? undefined } } });
        } catch (problem) {
            setError(problem?.message || "That could not be saved.");
        } finally {
            setSaving(false);
        }
    };

    const scenarioLabel = PLAYER_FOCUS_LEVELS.find((level) => level.key === scenarioLevel)?.label ?? scenarioLevel;
    return (
        <div style={fieldGroupStyle}>
        <label style={{ ...labelStyle, fontWeight: 700 }}>Player focus — for this game</label>
        <select
        data-no-translate
        disabled={saving || !gameId}
        value={following ? "" : focus}
        onChange={(event) => choose(event.target.value || null)}
        style={{ ...inputStyle, cursor: "pointer" }}
        >
        <option value="" style={{ color: "black" }}>{`Scenario default (${scenarioLabel})`}</option>
        {PLAYER_FOCUS_LEVELS.map((level) => (
            <option key={level.key} value={level.key} style={{ color: "black" }}>
            {level.label}
            </option>
        ))}
        </select>
        <div style={helperStyle}>
        {/* Every level, not only the one selected: the choice is between four
            feels, and a player cannot compare them one at a time. */}
        {PLAYER_FOCUS_LEVELS.map((level) => (
            <div key={level.key} style={{ marginBottom: 4, opacity: level.key === focus ? 1 : 0.65 }}>
            <strong>{level.label}</strong> — {PLAYER_FOCUS_HINTS[level.key]}
            </div>
        ))}
        <div style={{ marginTop: 6 }}>
        It never invents events for you: in a quiet stretch the world fills the skip as usual, and what you have going on — orders, milestones due, wars, open threads — is what the share is measured against.
        </div>
        {error ? <div style={{ color: "#fca5a5", marginTop: 6 }}>{error}</div> : null}
        </div>
        </div>
    );
};

const SettingsSection = ({ title, description, right, children }) => (
    <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "1rem" }}>
        <div style={{ alignItems: "flex-start", display: "flex", gap: "0.75rem", justifyContent: "space-between", marginBottom: "0.9rem" }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.88rem", fontWeight: 850 }}>{title}</div>
                {description && <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.66rem", lineHeight: 1.45, marginTop: "0.2rem" }}>{description}</div>}
            </div>
            {right}
        </div>
        {children}
    </section>
);

const ExperimentalPill = ({ children = "Experimental" }) => (
    <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", marginBottom: "0.6rem" }}>
        <span style={{ backgroundColor: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)", borderRadius: "999px", color: "#fbbf24", fontSize: "0.58rem", fontWeight: 850, padding: "0.18rem 0.48rem" }}>{children}</span>
    </div>
);

const settingsHelper = { ...helperStyle, marginTop: "-0.55rem", marginBottom: "0.85rem" };

const SETTINGS_SECTIONS = [
    { key: "general", label: "General", icon: "◫", description: "Language, display and accessibility" },
    { key: "map", label: "Map", icon: "◇", description: "Basemap, labels, globe and camera" },
    { key: "ai", label: "AI", icon: "✦", description: "Models, backups, keys and reasoning" },
    { key: "advanced", label: "Advanced", icon: "⌘", description: "Per-task models and expert controls" },
];

// The small menu becoming the workspace. `fromRect` is the small menu's card
// as it was measured when the section opened; on mount the card is placed on
// that rectangle (a translate plus a non-uniform scale, top-left origin) and
// then eases to its own place, while the CSS lifts the small menu's tint off
// it and fades its contents in. `closing` runs the same journey backwards; the
// menu unmounts the workspace once it has arrived. No rectangle (the menu was
// opened straight onto a section) means a plain fade.
const useWorkspaceMorph = (cardRef, fromRect, closing) => {
    useLayoutEffect(() => {
        const el = cardRef.current;
        if (!el || !fromRect) return undefined;
        const to = el.getBoundingClientRect();
        if (!to.width || !to.height) return undefined;
        el.style.transformOrigin = "top left";
        el.style.transition = "none";
        el.style.transform = `translate(${fromRect.left - to.left}px, ${fromRect.top - to.top}px) scale(${fromRect.width / to.width}, ${fromRect.height / to.height})`;
        el.classList.add("oh-ws-morphing");
        // A forced style flush makes the small rectangle the "before" state, so
        // the assignments right after it transition instead of snapping. Done
        // synchronously rather than over animation frames: frames stall in a
        // background tab, and the card must never be left stuck at the small size.
        void el.offsetWidth;
        el.style.transition = "transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1)";
        el.style.transform = "none";
        el.classList.remove("oh-ws-morphing");
        return undefined;
    }, [cardRef, fromRect]);

    useLayoutEffect(() => {
        const el = cardRef.current;
        if (!closing || !el || !fromRect) return;
        const to = el.getBoundingClientRect();
        if (!to.width || !to.height) return;
        el.style.transformOrigin = "top left";
        el.style.transition = "transform 220ms ease-in";
        el.style.transform = `translate(${fromRect.left - to.left}px, ${fromRect.top - to.top}px) scale(${fromRect.width / to.width}, ${fromRect.height / to.height})`;
        el.classList.add("oh-ws-unmorph");
    }, [cardRef, closing, fromRect]);
};

const SettingsWorkspace = ({
    activeSection,
    onSectionChange,
    onBack,
    onClose,
    onOpenDebugConsole,
    fromRect = null,
    closing = false,
    isFullscreenEnabled,
    isGlobeEnabled,
    isTerrainEnabled,
    onToggleFullscreen,
    onToggleGlobe,
    onToggleTerrain,
    mapSettings,
    updateMapSetting,
    basemapStyle,
    updateBasemapStyle,
    labelFont,
    updateLabelFont,
    telemetryOn,
    onToggleTelemetry,
    ratingOn,
    onToggleRating,
    context,
}) => {
    const isMobile = useIsMobile();
    const leaving = usePresenceLeaving();
    const cardRef = useRef(null);
    const [politicalWorldLabOpen, setPoliticalWorldLabOpen] = useState(false);
    useWorkspaceMorph(cardRef, fromRect, closing);

    useEffect(() => {
        const priorOverflow = document?.body?.style?.overflow ?? "";
        if (document?.body) document.body.style.overflow = "hidden";
        const onKeyDown = (event) => {
            if (event.key === "Escape") onBack();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (document?.body) document.body.style.overflow = priorOverflow;
        };
    }, [onBack]);

    // On a phone the four categories share one row, each an icon over its name.
    // Side by side at 9.6rem each only two fitted, and nothing said the strip
    // scrolled to the other two.
    const nav = (
        <nav style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: "0.35rem", overflowX: isMobile ? "auto" : "visible", padding: isMobile ? "0.65rem" : "0.85rem", scrollbarWidth: "none" }}>
            {SETTINGS_SECTIONS.map((section) => {
                const selected = section.key === activeSection;
                return (
                    <button
                    key={section.key}
                    type="button"
                    className="oh-tap-row"
                    onClick={() => onSectionChange(section.key)}
                    style={{
                        alignItems: "center",
                        background: selected ? "rgba(0,0,0,0.42)" : "transparent",
                        border: `1px solid ${selected ? "rgba(255,255,255,0.28)" : "transparent"}`,
                        borderRadius: "9px",
                        color: selected ? "#f4f4f5" : "rgba(255,255,255,0.58)",
                        cursor: "pointer",
                        display: "flex",
                        flex: isMobile ? "1 1 0" : "none",
                        fontFamily: "inherit",
                        gap: "0.65rem",
                        minWidth: 0,
                        padding: "0.62rem 0.65rem",
                        textAlign: "left",
                        width: isMobile ? "auto" : "100%",
                        ...(isMobile ? { flexDirection: "column", gap: "0.3rem", justifyContent: "center", padding: "0.45rem 0.2rem", textAlign: "center" } : null),
                    }}
                    >
                        <span aria-hidden="true" style={{ alignItems: "center", background: selected ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.05)", borderRadius: "7px", display: "inline-flex", flexShrink: 0, fontSize: "0.76rem", fontWeight: 900, height: "1.8rem", justifyContent: "center", width: "1.8rem" }}>{section.icon}</span>
                        <span>
                            <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 850 }}>{section.label}</span>
                            {!isMobile && <span style={{ color: "rgba(255,255,255,0.3)", display: "block", fontSize: "0.57rem", lineHeight: 1.35, marginTop: "0.12rem" }}>{section.description}</span>}
                        </span>
                    </button>
                );
            })}
        </nav>
    );

    const page = SETTINGS_SECTIONS.find((section) => section.key === activeSection);
    const pageTitle = page?.label ?? "Settings";
    const pageDescription = page?.description ?? "";

    const content = (
        <div key={activeSection} className="oh-surface-in" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ marginBottom: "0.1rem" }}>
                <div style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 900 }}>{pageTitle}</div>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.66rem", marginTop: "0.18rem" }}>{pageDescription}</div>
            </div>

            {activeSection === "general" && (
                <>
                <SettingsSection title="Language" description="Interface language affects the UI. Chat language steers advisor and diplomatic replies.">
                    <LanguageSelector />
                    <ChatLanguageSelector />
                </SettingsSection>
                <SettingsSection title="Display" description="Window and presentation preferences that apply to the game client.">
                    <Toggle label="Fullscreen" enabled={isFullscreenEnabled} onToggle={onToggleFullscreen} />
                </SettingsSection>
                <SettingsSection title="Accessibility" description="Reduce automatic camera motion without changing simulation behavior.">
                    <Toggle
                    label="Reduce motion"
                    enabled={mapSettings.disableIdleRotation && mapSettings.disableEventCamera}
                    onToggle={() => {
                        const next = !(mapSettings.disableIdleRotation && mapSettings.disableEventCamera);
                        updateMapSetting("disableIdleRotation", MAP_SETTING_KEYS.disableIdleRotation, next);
                        updateMapSetting("disableEventCamera", MAP_SETTING_KEYS.disableEventCamera, next);
                    }}
                    />
                </SettingsSection>
                </>
            )}

            {activeSection === "map" && (
                <>
                <SettingsSection title="Map presentation" description="Choose the visual base and which political labels are shown.">
                    <div style={fieldGroupStyle}>
                        <label style={labelStyle} htmlFor="game-basemap-style">Basemap</label>
                        <select id="game-basemap-style" data-no-translate value={basemapStyle} onChange={(event) => updateBasemapStyle(event.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                            <option value="" style={{ color: "black" }}>Scenario default</option>
                            {ESRI_BASEMAPS.map((basemap) => <option key={basemap.id} value={basemap.id} style={{ color: "black" }}>{basemap.label}</option>)}
                        </select>
                        <div style={helperStyle}>Scenario default uses the map chosen by the scenario author. Overrides apply immediately.</div>
                    </div>
                    {/* Labels rasterize from the player's LOCAL fonts (the style
                        has no glyph server), so any installed family works - the
                        list only suggests common safe ones. Empty = whatever the
                        scenario set, which itself defaults to Georgia. */}
                    <div style={fieldGroupStyle}>
                        <label style={labelStyle} htmlFor="game-label-font">Country label font</label>
                        <input
                        id="game-label-font"
                        data-no-translate
                        list="oh-settings-label-font-options"
                        placeholder="Scenario default"
                        style={inputStyle}
                        value={labelFont}
                        onChange={(event) => updateLabelFont(event.target.value)}
                        />
                        <datalist id="oh-settings-label-font-options">
                            {LABEL_FONT_SUGGESTIONS.map((font) => <option key={font} value={font} />)}
                        </datalist>
                        <div style={helperStyle}>Empty uses the font the scenario author chose. Any font installed on this computer works; overrides apply immediately.</div>
                    </div>
                    <Toggle label="Hide country labels" enabled={mapSettings.hideCountryLabels} onToggle={() => updateMapSetting("hideCountryLabels", MAP_SETTING_KEYS.hideCountryLabels, !mapSettings.hideCountryLabels)} />
                </SettingsSection>
                <SettingsSection title="3D map" description="Globe and terrain rendering are presentation features; they do not change world state.">
                    <ExperimentalPill />
                    <Toggle label="3D Globe" enabled={isGlobeEnabled} onToggle={onToggleGlobe} />
                    <Toggle label="3D Terrain" enabled={isTerrainEnabled} onToggle={onToggleTerrain} />
                </SettingsSection>
                <SettingsSection title="Camera behavior" description="Fine-grained controls for automatic map movement.">
                    <Toggle label="Disable idle globe rotation" enabled={mapSettings.disableIdleRotation} onToggle={() => updateMapSetting("disableIdleRotation", MAP_SETTING_KEYS.disableIdleRotation, !mapSettings.disableIdleRotation)} />
                    <Toggle label="Disable camera movement during events" enabled={mapSettings.disableEventCamera} onToggle={() => updateMapSetting("disableEventCamera", MAP_SETTING_KEYS.disableEventCamera, !mapSettings.disableEventCamera)} />
                </SettingsSection>
                </>
            )}

            {activeSection === "ai" && (
                <>
                <FallbackListSection />
                <ConnectionsSection />
                <ReasoningSection />
                <RequestBudgetSection />
                <SettingsSection title="Generation behavior" description="Bound model waiting behavior without changing the deterministic fallback path.">
                    <PlayerFocusSetting />
                    <Toggle label="Limit AI generation" enabled={mapSettings.limitAiGeneration} onToggle={() => updateMapSetting("limitAiGeneration", MAP_SETTING_KEYS.limitAiGeneration, !mapSettings.limitAiGeneration)} />
                    <div style={settingsHelper}>
                    Off (default): waits as long as the model needs, however stuck. On: the game stops waiting and falls back to canned events when the model goes quiet — 5 minutes of silence part-way through an answer, or 15 minutes with no answer at all. A model that is still writing is never interrupted, however long it takes. Cancel works either way.
                    </div>
                    <Toggle label="Generate long time skips in segments" enabled={mapSettings.chunkLongJumps} onToggle={() => updateMapSetting("chunkLongJumps", MAP_SETTING_KEYS.chunkLongJumps, !mapSettings.chunkLongJumps)} />
                    <div style={settingsHelper}>
                    Off (default): the whole skip is generated in a single request. On: skips of more than a few months are generated in several shorter requests and merged into one round — slower and costlier in tokens, but far less likely to time out on a hosted provider.
                    </div>
                    <Toggle label="AI lookup functions" enabled={mapSettings.lookupFunctions} onToggle={() => updateMapSetting("lookupFunctions", MAP_SETTING_KEYS.lookupFunctions, !mapSettings.lookupFunctions)} />
                    <div style={settingsHelper}>
                    Only used while Save AI requests (above) is off, because every lookup is a whole extra request. On: before it answers, the model can call lookup functions — the exact power and region names, a region's neighbours, the war ledger, a chat — in up to three extra requests per task. Off: one request per task, with the region lists and ledgers written into the prompt instead. Needs a provider that supports function calling.
                    </div>
                    <Toggle label="Show time skip events as they are written" enabled={mapSettings.liveSkipEvents} onToggle={() => updateMapSetting("liveSkipEvents", MAP_SETTING_KEYS.liveSkipEvents, !mapSettings.liveSkipEvents)} />
                    <div style={settingsHelper}>
                    On (default): a skip opens the Events panel and fills it as the model writes, with the spinner and Cancel underneath. Reveal with Next event as they arrive, and the map and camera follow; wherever you get to is kept when the turn lands. Off: the skip stays behind the Timeline panel's spinner and the round appears at the end. The turn itself is the same either way, and Gemini arrives all at once regardless.
                    </div>
                    <Toggle label="Batch background AI tasks" enabled={mapSettings.batchBackgroundTasks} onToggle={() => updateMapSetting("batchBackgroundTasks", MAP_SETTING_KEYS.batchBackgroundTasks, !mapSettings.batchBackgroundTasks)} />
                    <div style={{ ...settingsHelper, marginBottom: 0 }}>
                    Anthropic only. On: history consolidation runs through the Message Batches API at about half the price and lands a little later, applied between turns. Off (default): every task answers in the same call. Other providers are unaffected either way.
                    </div>
                </SettingsSection>
                </>
            )}

            {activeSection === "advanced" && (
                <>
                <SettingsSection
                title="Per-task models"
                description="Route individual AI tasks to a cheaper or a stronger model from your list. A task tries its pick first, then the list from the top, so it only fails when every model is used up."
                right={(
                    <button
                    type="button"
                    className="oh-tap-row"
                    onClick={() => onSectionChange("ai")}
                    style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(96,165,250,0.24)", borderRadius: "8px", color: "#bfdbfe", cursor: "pointer", fontSize: "0.72rem", fontWeight: 750, padding: "0.45rem 0.65rem", whiteSpace: "nowrap" }}
                    >
                    AI settings
                    </button>
                )}
                >
                    <TaskPicks />
                </SettingsSection>
                <SettingsSection
                title="Political World A/B Lab"
                description="Run the same frozen diplomacy, Council, vote or event-generation task with Political World context on/off — or push one actor through HAWK/DOVE sensitivity variants. The lab never applies either candidate to the campaign."
                right={(
                    <button
                    type="button"
                    onClick={() => setPoliticalWorldLabOpen(true)}
                    style={{ background: "rgba(124,58,237,0.16)", border: "1px solid rgba(167,139,250,0.32)", borderRadius: "8px", color: "#ddd6fe", cursor: "pointer", fontSize: "0.72rem", fontWeight: 800, padding: "0.45rem 0.65rem", whiteSpace: "nowrap" }}
                    >
                    Open A/B Lab
                    </button>
                )}
                >
                    <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.68rem", lineHeight: 1.55 }}>
                    Pins every arm to one exact fallback-list entry, counterbalances run order, saves raw prompts/responses and proves the non-Political prompt hash matches before you interpret the result. Blind review is available to reduce confirmation bias.
                    </div>
                </SettingsSection>
                <SettingsSection
                title="Telemetry"
                description="What the AI debug console can show about every call."
                right={typeof onOpenDebugConsole === "function" ? (
                    <button
                    type="button"
                    className="oh-tap-row"
                    onClick={onOpenDebugConsole}
                    style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(96,165,250,0.24)", borderRadius: "8px", color: "#bfdbfe", cursor: "pointer", fontSize: "0.72rem", fontWeight: 750, padding: "0.45rem 0.65rem", whiteSpace: "nowrap" }}
                    >
                    Open console
                    </button>
                ) : null}
                >
                    <Toggle label="Record AI telemetry" enabled={telemetryOn} onToggle={onToggleTelemetry} />
                    <div style={settingsHelper}>
                    Keeps every AI call — prompt, answer, model, tokens, latency, validation verdict — in this browser for the AI debug console (200 across sessions). Off: the console sees this session only. Keys are never recorded.
                    </div>
                    <Toggle label="Rate AI generations" enabled={ratingOn} onToggle={onToggleRating} />
                    <div style={{ ...settingsHelper, marginBottom: 0 }}>
                    A small 1-10 bar after each time skip, Game Master edit and interactive event. Ratings sit beside the call in the console and its exports.
                    </div>
                </SettingsSection>
                {!import.meta.env.VITE_OH_WEB && (
                    <SettingsSection title="Network" description="Other devices — the Android app, a browser on another computer — reach this server only while you say so.">
                        <NetworkSharing />
                    </SettingsSection>
                )}
                <SettingsSection title="Diagnostics" description="The log a bug report needs. Copy it for Discord, save it for a GitHub issue.">
                    <DiagnosticsPanel />
                </SettingsSection>
                </>
            )}
        </div>
    );

    // On a phone the card is the whole screen less a thin margin, and that margin
    // is widened by the notch and the home indicator so neither covers the ←, the
    // ✕ or the bottom of the page.
    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="Game settings" className={leaving ? "oh-fade-out" : closing ? "oh-fade-out-slow" : fromRect ? undefined : "oh-fade-in"} style={{ alignItems: "center", background: "rgba(6,6,7,0.42)", backdropFilter: "blur(18px) saturate(1.2)", display: "flex", inset: 0, justifyContent: "center", padding: isMobile ? `calc(0.45rem + ${SAFE_TOP}) calc(0.45rem + ${SAFE_RIGHT}) calc(0.45rem + ${SAFE_BOTTOM}) calc(0.45rem + ${SAFE_LEFT})` : "clamp(0.8rem, 2vw, 1.6rem)", position: "fixed", zIndex: 2147483000 }}>
            <div ref={cardRef} className="oh-ws-card" style={{ background: "linear-gradient(180deg, rgba(46,46,50,0.72), rgba(17,17,19,0.62))", backdropFilter: "var(--oh-hud-blur)", WebkitBackdropFilter: "var(--oh-hud-blur)", border: "1px solid var(--oh-hud-border)", borderRadius: isMobile ? "12px" : "18px", boxShadow: "var(--oh-hud-shadow)", color: "white", display: "flex", flexDirection: "column", fontFamily: "sans-serif", height: isMobile ? `calc(${APP_HEIGHT} - 0.9rem - ${SAFE_TOP} - ${SAFE_BOTTOM})` : `min(800px, calc(${APP_HEIGHT} - 2.4rem))`, maxWidth: "1120px", overflow: "hidden", width: isMobile ? `calc(100vw - 0.9rem - ${SAFE_LEFT} - ${SAFE_RIGHT})` : "min(94vw, 1120px)" }}>
                <div aria-hidden="true" className="oh-ws-tint" style={{ background: "linear-gradient(180deg, rgba(46,46,50,0.68), rgba(17,17,19,0.58))", borderRadius: "inherit", inset: 0, pointerEvents: "none", position: "absolute" }} />
                <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.75rem", padding: "0.8rem 0.9rem" }}>
                    <button type="button" className="oh-tap" onClick={onBack} aria-label="Back to game menu" title="Back to game menu" style={{ alignItems: "center", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "8px", color: "rgba(255,255,255,0.66)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2.25rem", justifyContent: "center", width: "2.25rem" }}>←</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.35rem 0.65rem" }}>
                            <span style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 900 }}>Settings</span>
                            {context?.scenarioName && <span style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.72rem", fontWeight: 700 }}>{context.scenarioName}</span>}
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.61rem", marginTop: "0.12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[context?.countryName ? `Playing as ${context.countryName}` : "", context?.date || ""].filter(Boolean).join(" · ") || "Game preferences"}
                        </div>
                    </div>
                    <button type="button" className="oh-tap" onClick={onClose} aria-label="Close settings" style={{ alignItems: "center", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "8px", color: "rgba(255,255,255,0.62)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2.25rem", justifyContent: "center", width: "2.25rem" }}>×</button>
                </div>
                <div style={{ display: "grid", flex: 1, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "235px minmax(0, 1fr)", gridTemplateRows: isMobile ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", minHeight: 0 }}>
                    <aside style={{ backgroundColor: "rgba(9,9,10,0.24)", borderBottom: isMobile ? "1px solid rgba(255,255,255,0.07)" : "none", borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.07)", minHeight: 0, overflowY: isMobile ? "visible" : "auto" }}>{nav}</aside>
                    <main style={{ minHeight: 0, overflowY: "auto", padding: isMobile ? "0.8rem" : "1rem 1.05rem 1.2rem" }}>{content}</main>
                </div>
            </div>
            {politicalWorldLabOpen && <PoliticalWorldABLab onClose={() => setPoliticalWorldLabOpen(false)} />}
        </div>,
        document.body,
    );
};

const QUICK_MENU_TABS = [
    { key: "game", label: "Game" },
    { key: "tools", label: "Tools" },
    { key: "settings", label: "Settings" },
    { key: "help", label: "Help" },
];

// `fill` (a phone): the four tabs share the strip evenly, with room for all
// four down to a 320 px screen.
const QuickMenuTabButton = ({ label, selected, onClick, fill = false }) => (
    <button
    type="button"
    className="oh-tap-row"
    onClick={onClick}
    style={{
        background: selected ? "rgba(0,0,0,0.42)" : "transparent",
        border: `1px solid ${selected ? "rgba(255,255,255,0.28)" : "transparent"}`,
        borderRadius: "8px",
        color: selected ? "#f4f4f5" : "rgba(255,255,255,0.56)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.72rem",
        fontWeight: 850,
        padding: "0.5rem 0.8rem",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        ...(fill ? { flex: "1 1 auto", padding: "0.5rem 0.45rem" } : null),
    }}
    >
    {label}
    </button>
);

const QuickMenuPanel = ({ title, description, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
            <div style={{ color: "#f8fafc", fontSize: "0.82rem", fontWeight: 850 }}>{title}</div>
            {description && <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.64rem", lineHeight: 1.45, marginTop: "0.18rem" }}>{description}</div>}
        </div>
        {children}
    </div>
);

const ContextSummaryCard = ({ context }) => {
    const rows = [
        { label: "Scenario", value: context?.scenarioName || context?.gameName || "Open Historia" },
        { label: "Playing as", value: context?.countryName || "—" },
        { label: "Date", value: context?.date || "—" },
    ];

    return (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "11px", padding: "0.8rem 0.85rem" }}>
            <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.74rem", fontWeight: 800, marginBottom: "0.6rem" }}>Current session</div>
            <div style={{ display: "grid", gap: "0.45rem" }}>
                {rows.map((row) => (
                    <div key={row.label} style={{ alignItems: "baseline", display: "grid", gap: "0.4rem", gridTemplateColumns: "5.2rem minmax(0, 1fr)" }}>
                        <span style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.63rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{row.label}</span>
                        <span data-no-translate={row.label !== "Scenario" ? true : undefined} style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.72rem", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const SettingsMenu = ({
    topOffset = "0.5rem",
    isFullscreenEnabled,
    isGlobeEnabled,
    isTerrainEnabled,
    onToggleFullscreen,
    onToggleGlobe,
    onToggleTerrain,
    onOpenCheats,
    onOpenDebugConsole,
    onOpenEvents,
    onOpenGameManagement,
    onClose,
    discordUrl,
    redditUrl,
    githubUrl,
    reportBugUrl,
    context,
    // A workspace section to open on straight away (the AI setup prompt sends
    // the player to "ai"); null opens the quick menu.
    initialSection = null,
}) => {
    const isMobile = useIsMobile();
    const [activeSettingsSection, setActiveSettingsSection] = useState(initialSection || null);
    const [activeQuickTab, setActiveQuickTab] = useState(initialSection ? "settings" : "tools");
    // The small menu's card: measured when a section opens so the workspace can
    // grow out of it, and told the button's size so it can grow out of the
    // button (the --oh-grow-* ratios the CSS keyframes read). Coming back from
    // the workspace the card does not grow again — it is already there under
    // the shrinking workspace.
    const menuRef = useRef(null);
    const [fromRect, setFromRect] = useState(null);
    const [workspaceClosing, setWorkspaceClosing] = useState(false);
    const [menuEntrance, setMenuEntrance] = useState("oh-menu-grow");
    const backTimer = useRef(null);
    useEffect(() => () => clearTimeout(backTimer.current), []);
    useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        el.style.setProperty("--oh-grow-x", (64 / rect.width).toFixed(4));
        el.style.setProperty("--oh-grow-y", (64 / rect.height).toFixed(4));
    });
    // The basemap override is a value setting (a basemap id, or empty for the
    // scenario's own), read live so the picker follows a change made elsewhere.
    const storedBasemapStyle = useMapSettingValue(MAP_SETTING_KEYS.basemapStyle);
    const basemapStyle = isBuiltinBasemapId(storedBasemapStyle) ? storedBasemapStyle : "";

    const [mapSettings, setMapSettingsState] = useState(() => ({
        hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
        disableIdleRotation: getMapSetting(MAP_SETTING_KEYS.disableIdleRotation),
        disableEventCamera: getMapSetting(MAP_SETTING_KEYS.disableEventCamera),
        // Not getMapSetting: this one ships ON, and an absent key must read as
        // on rather than off (see mapSettings.js).
        limitAiGeneration: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration),
        // Same again: ships ON.
        chunkLongJumps: getMapSetting(MAP_SETTING_KEYS.chunkLongJumps),
        // Ships ON: an absent key reads as on (see mapSettings.js).
        lookupFunctions: getMapSettingDefaultOn(MAP_SETTING_KEYS.lookupFunctions),
        // Ships ON too.
        liveSkipEvents: getMapSettingDefaultOn(MAP_SETTING_KEYS.liveSkipEvents),
        batchBackgroundTasks: getMapSetting(MAP_SETTING_KEYS.batchBackgroundTasks),
    }));

    const updateMapSetting = (stateKey, settingKey, value) => {
        setMapSetting(settingKey, value);
        setMapSettingsState((current) => ({ ...current, [stateKey]: value }));
    };
    const updateBasemapStyle = (value) => setMapSettingValue(MAP_SETTING_KEYS.basemapStyle, value);
    const labelFont = useMapSettingValue(MAP_SETTING_KEYS.labelFont);
    // The field shows the keystrokes; the setting stores them trimmed. Storing
    // on every keystroke through setMapSettingValue's trim and echoing the
    // stored value back used to eat a space the moment it was typed, so "Times
    // New Roman" could not be typed at all. The draft is shown while it is the
    // stored value plus whitespace; a change made elsewhere wins over it.
    const [labelFontDraft, setLabelFontDraft] = useState(labelFont);
    const labelFontShown = labelFontDraft.trim() === labelFont ? labelFontDraft : labelFont;
    const updateLabelFont = (value) => {
        setLabelFontDraft(value);
        setMapSettingValue(MAP_SETTING_KEYS.labelFont, value);
    };

    // Telemetry switches (telemetry.js): their own keys, both on by default.
    const [telemetryOn, setTelemetryOn] = useState(() => isTelemetryEnabled());
    const [ratingOn, setRatingOn] = useState(() => isRatingEnabled());
    // Logged here rather than in telemetry.js, which imports nothing on purpose.
    const toggleTelemetry = () => { const next = !telemetryOn; setTelemetryOn(next); setTelemetryEnabled(next); logSettingChange("Record AI telemetry", next); };
    const toggleRating = () => { const next = !ratingOn; setRatingOn(next); setRatingEnabled(next); logSettingChange("Rate AI generations", next); };

    // Escape closes the quick menu; the workspace handles its own (it goes back
    // to the quick menu first).
    useEffect(() => {
        if (activeSettingsSection) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [activeSettingsSection, onClose]);

    const runAndClose = (action) => {
        action?.();
        onClose?.();
    };
    const openSettingsSection = (section) => {
        const rect = menuRef.current?.getBoundingClientRect();
        setFromRect(rect && rect.width ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null);
        setActiveSettingsSection(section);
    };
    const backToMenu = () => {
        if (workspaceClosing) return;
        if (!fromRect) { setActiveSettingsSection(null); return; }
        setWorkspaceClosing(true);
        backTimer.current = setTimeout(() => {
            setWorkspaceClosing(false);
            setMenuEntrance("oh-menu-return");
            setActiveSettingsSection(null);
        }, 230);
    };
    // On a phone, Back steps out of the workspace to the quick menu first, as
    // Escape does; the Back after that closes the menu (main.jsx).
    useBackToClose(Boolean(activeSettingsSection), backToMenu);

    if (activeSettingsSection) {
        return (
            <SettingsWorkspace
            activeSection={activeSettingsSection}
            onSectionChange={setActiveSettingsSection}
            onBack={backToMenu}
            fromRect={fromRect}
            closing={workspaceClosing}
            onClose={() => onClose?.()}
            onOpenDebugConsole={typeof onOpenDebugConsole === "function" ? () => runAndClose(onOpenDebugConsole) : undefined}
            isFullscreenEnabled={isFullscreenEnabled}
            isGlobeEnabled={isGlobeEnabled}
            isTerrainEnabled={isTerrainEnabled}
            onToggleFullscreen={onToggleFullscreen}
            onToggleGlobe={onToggleGlobe}
            onToggleTerrain={onToggleTerrain}
            mapSettings={mapSettings}
            updateMapSetting={updateMapSetting}
            basemapStyle={basemapStyle}
            updateBasemapStyle={updateBasemapStyle}
            labelFont={labelFontShown}
            updateLabelFont={updateLabelFont}
            telemetryOn={telemetryOn}
            onToggleTelemetry={toggleTelemetry}
            ratingOn={ratingOn}
            onToggleRating={toggleRating}
            context={context}
            />
        );
    }

    const grid = { display: "grid", gap: "0.55rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" };
    let panelContent = null;
    if (activeQuickTab === "game") {
        panelContent = (
            <QuickMenuPanel title="Game" description="Campaign identity and management actions.">
                <ContextSummaryCard context={context} />
                {typeof onOpenGameManagement === "function" && (
                    <QuickAction title="Game Management" description="Switch, duplicate, import or manage campaigns" symbol="▦" onClick={() => runAndClose(onOpenGameManagement)} />
                )}
            </QuickMenuPanel>
        );
    } else if (activeQuickTab === "settings") {
        panelContent = (
            <QuickMenuPanel title="Settings" description="Jump straight into the options category you want.">
                <div style={grid}>
                    <QuickAction title="General" description="Language, display and accessibility" symbol="◫" tone="blue" onClick={() => openSettingsSection("general")} />
                    <QuickAction title="Map" description="Basemap, labels, globe and camera" symbol="◇" tone="blue" onClick={() => openSettingsSection("map")} />
                    <QuickAction title="AI" description="Models, backups, keys and reasoning" symbol="✦" onClick={() => openSettingsSection("ai")} />
                    <QuickAction title="Advanced" description="Per-task models and expert controls" symbol="⌘" onClick={() => openSettingsSection("advanced")} />
                </div>
            </QuickMenuPanel>
        );
    } else if (activeQuickTab === "help") {
        panelContent = (
            <QuickMenuPanel title="Help" description="Guides, bug reporting and community links.">
                <div style={grid}>
                    <QuickAction title="Guides" description="How-to pages and setup help" symbol="?" href="/guides/" />
                    {reportBugUrl && <QuickAction title="Report a Bug" description="Open the issue/report page" symbol="!" tone="amber" href={reportBugUrl} />}
                </div>
                <div style={{ alignItems: isMobile ? "stretch" : "center", display: "flex", flexDirection: isMobile ? "column" : "row", gap: "0.55rem", justifyContent: "space-between" }}>
                    <span style={{ color: "rgba(255,255,255,0.24)", fontSize: "0.6rem" }}>Community</span>
                    <SocialLinks discordUrl={discordUrl} redditUrl={redditUrl} githubUrl={githubUrl} />
                </div>
            </QuickMenuPanel>
        );
    } else {
        panelContent = (
            <QuickMenuPanel title="Tools" description="High-frequency in-game tools should stay one click away.">
                <div style={grid}>
                    {typeof onOpenCheats === "function" && (
                        <QuickAction title="Cheats" description="Game master tools and world editing" symbol="⌁" tone="slate" onClick={() => runAndClose(onOpenCheats)} />
                    )}
                    {typeof onOpenEvents === "function" && (
                        <QuickAction title="Events / Timeline" description="Review the current turn and world history" symbol="◷" tone="blue" onClick={() => runAndClose(onOpenEvents)} />
                    )}
                    {/* This branch's own tool, in the same row: every AI call with its prompt,
                        answer and cost. Continuum has no counterpart. */}
                    {typeof onOpenDebugConsole === "function" && (
                        <QuickAction title="AI debug console" description="Every AI call, its prompt, answer and cost" symbol="◈" onClick={() => runAndClose(onOpenDebugConsole)} />
                    )}
                    {/* The last slot of the row is the community's: two half-width
                        tiles, each nothing but the brand's own mark on the brand's own
                        colour. No words - the logos say where they go. */}
                    <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                        <CommunityTile href={DISCORD_URL} label="Join the Discord" color={DISCORD_BLURPLE}><DiscordMark /></CommunityTile>
                        <CommunityTile href={REDDIT_URL} label="Open r/OpenHistoria on Reddit" color={REDDIT_ORANGERED}><RedditMark /></CommunityTile>
                    </div>
                </div>
            </QuickMenuPanel>
        );
    }

    return (
        <div
        ref={menuRef}
        className={`oh-menu-card ${menuEntrance}`}
        style={{
            ...baseStyle,
            // On the button's own corner: the menu is the button, grown.
            top: topOffset,
            left: `calc(0.5rem + ${SAFE_LEFT})`,
            width: isMobile ? `calc(100vw - 1rem - ${SAFE_LEFT} - ${SAFE_RIGHT})` : "29rem",
            maxWidth: `calc(100vw - 1rem - ${SAFE_LEFT} - ${SAFE_RIGHT})`,
            minHeight: isMobile ? "auto" : "22rem",
            // Never taller than the space below the panel's own top edge — the old
            // 100vh-5rem pushed the bottom (Discord/GitHub links) off short screens.
            maxHeight: `calc(${APP_HEIGHT} - ${topOffset} - 1rem)`,
            overflowY: "auto",
            padding: "0.85rem",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            height: "auto",
            background: "linear-gradient(180deg, rgba(46,46,50,0.68), rgba(17,17,19,0.58))",
            border: "1px solid var(--oh-hud-border)",
            boxShadow: "var(--oh-hud-shadow)",
        }}
        >
            <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "0.75rem", margin: "-0.1rem -0.1rem 0.75rem", padding: "0 0.1rem 0.7rem" }}>
                <img alt="Open Historia" src="/logo.png" style={{ borderRadius: "8px", flexShrink: 0, height: "2.25rem", width: "2.25rem" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.35rem 0.55rem" }}>
                        <span style={{ color: "#f8fafc", fontSize: "0.92rem", fontWeight: 900 }}>{context?.scenarioName || context?.gameName || "Open Historia"}</span>
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem", marginTop: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[context?.countryName ? `Playing as ${context.countryName}` : "", context?.date || ""].filter(Boolean).join(" · ") || "Game menu"}
                    </div>
                </div>
                <button type="button" className="oh-tap" onClick={() => onClose?.()} aria-label="Close game menu" style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "rgba(255,255,255,0.58)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2rem", justifyContent: "center", width: "2rem" }}>×</button>
            </div>

            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", display: "flex", gap: "0.2rem", padding: "0.2rem", marginBottom: "0.8rem", overflowX: "auto", scrollbarWidth: "none" }}>
                {QUICK_MENU_TABS.map((tab) => (
                    <QuickMenuTabButton key={tab.key} label={tab.label} selected={activeQuickTab === tab.key} onClick={() => setActiveQuickTab(tab.key)} fill={isMobile} />
                ))}
            </div>

            <div key={activeQuickTab} className="oh-surface-in" style={{ flex: 1, minHeight: 0 }}>
                {panelContent}
            </div>
        </div>
    );
};

export { Toggle, SettingsButton, SettingsMenu, ApiProviderSelector, SocialLinks };
