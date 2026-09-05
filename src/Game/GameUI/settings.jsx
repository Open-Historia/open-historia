/*! Open Historia — portions (reasoning toggle + small-screen menu) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    AI_TASK_ROUTING,
    DEFAULT_PROVIDER,
    PROVIDER_OPTIONS,
    deletePreset,
    getProviderField,
    getProviderMeta,
    getReasoningEnabled,
    getRecentModels,
    getSavedPresets,
    providerSupportsModelDiscovery,
    savePreset,
    setProviderField,
    setReasoningEnabled,
    updatePreset,
} from "../AI/providerConfig.js";
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
    getLanguageOptions,
    getStoredChatLanguage,
    getStoredLanguage,
    setStoredChatLanguage,
    setStoredLanguage,
} from "../../runtime/i18n.js";
import { MAP_SETTING_KEYS, applySaveBetaUnits, getMapSetting, isBetaUnits, resolveBetaUnits, setMapSetting, setMapSettingValue, useMapSettingValue } from "../../runtime/mapSettings.js";
import { getLibraryState } from "../../runtime/library.js";
import { readGameData, writeGameData } from "../../runtime/gameState.js";
import { copyToClipboard } from "../../runtime/clipboard.js";
import {
    buildDebugLogReport,
    clearDebugLog,
    debugLogFilename,
    formatLogSize,
    getDebugLogBytes,
    getDebugLogLimitBytes,
    getDebugLogSize,
    isDebugLogEnabled,
    isDebugLogVerbose,
    setDebugLogEnabled,
    setDebugLogVerbose,
    subscribeToDebugLog,
} from "../../runtime/debugLog.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { usePresenceLeaving } from "./presence.jsx";
import { ESRI_BASEMAPS, isBuiltinBasemapId } from "../../runtime/assets.js";

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

const profileCardStyle = {
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

const LanguagePicker = ({ label, current, onSelect, saving = false, helperText }) => {
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
            {option.name}{option.native && option.native !== option.name ? ` — ${option.native}` : ""}
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
        // Saves on the server too, so the phone app follows the same choice.
        await setStoredLanguage(code);
        // Reload so the translator starts (or stops) cleanly and every
        // already-rendered string goes through it from scratch.
        window.location.reload();
    };

    return (
        <LanguagePicker label="UI language" current={current} onSelect={applyLanguage} saving={saving} />
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

const Toggle = ({ label, enabled, onToggle }) => (
    <div
    style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1rem",
    }}
    >
    <span style={{ fontSize: "0.9rem" }}>{label}</span>
    <button
    onClick={onToggle}
    style={{
        width: "3.5rem",
        height: "1.75rem",
        borderRadius: "1rem",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "0.3s",
        backgroundColor: enabled ? "#3b82f6" : "#55555b",
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
                            borderColor: selected ? "rgba(59,130,246,0.8)" : "rgba(255,255,255,0.08)",
                            backgroundColor: selected ? "rgba(59,130,246,0.18)" : "rgba(0,0,0,0.16)",
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

// Configuration profiles (ported from the abdulrahman-2005 fork): saved
// endpoint/key/model/parameter bundles for the two "compatible" providers, so
// switching between a local server and a hosted gateway is one click.
const PROFILE_FORM_PREFIX = {
    "openai-compatible": "openaiCompatible",
    "anthropic-compatible": "anthropicCompatible",
};

const EMPTY_PROFILE_FORM = { name: "", endpoint: "", apiKey: "", model: "", customParams: "" };

const PresetManager = ({ provider, settings, onSettingChange }) => {
    const prefix = PROFILE_FORM_PREFIX[provider];
    const loadPresets = () => getSavedPresets().filter((preset) => preset.provider === provider);
    // Keyed by provider where it is mounted, so a provider switch remounts it
    // with fresh state instead of syncing in an effect.
    const [presets, setPresets] = useState(loadPresets);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_PROFILE_FORM);

    if (!prefix) return null;

    const currentEndpoint = settings[`${prefix}Endpoint`] ?? "";
    const currentModel = settings[`${prefix}Model`] ?? "";
    const setField = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

    const apply = (preset) => {
        onSettingChange(`${prefix}Endpoint`, preset.settings?.endpoint ?? "");
        // A profile saved without a key leaves the current key alone: the stock
        // profiles have none, and wiping a pasted key on "Apply" is never wanted.
        if (preset.settings?.apiKey) onSettingChange(`${prefix}ApiKey`, preset.settings.apiKey);
        onSettingChange(`${prefix}Model`, preset.settings?.model ?? "");
        onSettingChange(`${prefix}CustomParams`, preset.settings?.customParams ?? "");
    };

    const startCreate = () => {
        // Prefilled from the fields above, so "save this setup" is one click.
        setForm({
            name: "",
            endpoint: currentEndpoint,
            apiKey: settings[`${prefix}ApiKey`] ?? "",
            model: currentModel,
            customParams: settings[`${prefix}CustomParams`] ?? "",
        });
        setEditingId("new");
    };

    const startEdit = (preset) => {
        setForm({
            name: preset.name ?? "",
            endpoint: preset.settings?.endpoint ?? "",
            apiKey: preset.settings?.apiKey ?? "",
            model: preset.settings?.model ?? "",
            customParams: preset.settings?.customParams ?? "",
        });
        setEditingId(preset.id);
    };

    const saveForm = () => {
        const name = form.name.trim();
        if (!name) return;
        const values = { endpoint: form.endpoint, apiKey: form.apiKey, model: form.model, customParams: form.customParams };
        if (editingId === "new") savePreset(provider, name, values);
        else updatePreset(editingId, name, values);
        setPresets(loadPresets());
        setEditingId(null);
    };

    const remove = (preset) => {
        if (!window.confirm(`Delete the "${preset.name}" profile?`)) return;
        deletePreset(preset.id);
        setPresets(loadPresets());
    };

    const box = {
        marginBottom: "0.85rem",
        padding: "0.7rem",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.12)",
        backgroundColor: "rgba(0,0,0,0.12)",
    };

    if (editingId) {
        return (
            <div style={box}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.6rem" }}>
            {editingId === "new" ? "New profile" : "Edit profile"}
            </div>
            <SettingsInput label="Profile name" value={form.name} onChange={setField("name")} placeholder="My local server" />
            <SettingsInput label="API endpoint" value={form.endpoint} onChange={setField("endpoint")} placeholder="http://localhost:11434/v1" />
            <SettingsInput
            label="API key (optional)"
            type="password"
            value={form.apiKey}
            onChange={setField("apiKey")}
            placeholder="Leave empty to keep the current key when applied"
            />
            <SettingsInput label="Model" value={form.model} onChange={setField("model")} placeholder="Leave blank to auto-pick if supported" />
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={form.customParams}
            onChange={setField("customParams")}
            placeholder='{"top_p": 0.9}'
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={saveForm} disabled={!form.name.trim()} style={{ ...primaryButtonStyle, opacity: form.name.trim() ? 1 : 0.5 }}>
            Save profile
            </button>
            <button type="button" onClick={() => setEditingId(null)} style={smallButtonStyle}>
            Cancel
            </button>
            </div>
            </div>
        );
    }

    return (
        <div style={box}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Configuration profiles</div>
        <button type="button" onClick={startCreate} style={primaryButtonStyle}>+ Save current</button>
        </div>
        {presets.length === 0 ? (
            <div style={{ ...helperStyle, marginTop: 0 }}>No profiles yet. Save the current endpoint and model as one to switch back to it later.</div>
        ) : presets.map((preset) => {
            const active = (preset.settings?.endpoint ?? "") === currentEndpoint && (preset.settings?.model ?? "") === currentModel;
            return (
                <div key={preset.id} style={profileCardStyle}>
                <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {preset.name}
                {active && (
                    <span style={{ marginLeft: "0.4rem", fontSize: "0.68rem", fontWeight: 700, color: "rgba(147,197,253,0.95)" }}>ACTIVE</span>
                )}
                </div>
                <div style={{ ...helperStyle, marginTop: "0.1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {preset.settings?.endpoint || "Default endpoint"}
                {preset.settings?.model ? ` · ${preset.settings.model}` : ""}
                </div>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                {!active && <button type="button" onClick={() => apply(preset)} style={primaryButtonStyle}>Apply</button>}
                <button type="button" onClick={() => startEdit(preset)} style={smallButtonStyle}>Edit</button>
                <button type="button" onClick={() => remove(preset)} style={smallButtonStyle} title="Delete profile">✕</button>
                </div>
                </div>
            );
        })}
        <div style={{ ...helperStyle, marginTop: "0.2rem" }}>
        Stored only in this browser. A profile saved without a key keeps whatever key is entered above when applied.
        </div>
        </div>
    );
};

// Per-task model routing (ported from the abdulrahman-2005 fork). Collapsed by
// default: blank fields inherit the provider default, so the single-model
// experience is untouched until a player opts in. Hints are placeholders —
// nothing is written until the player types.
const TaskModelOverrides = ({ provider, suggestions }) => {
    const [expanded, setExpanded] = useState(false);
    // Keyed by provider at the mount site (see PresetManager).
    const [overrides, setOverrides] = useState(() => Object.fromEntries(AI_TASK_ROUTING.map(({ key }) => [
        key,
        getProviderField(provider, `model_${key}`),
    ])));

    const update = (key, value) => {
        setOverrides((current) => ({ ...current, [key]: value }));
        setProviderField(provider, `model_${key}`, value);
    };

    const activeCount = Object.values(overrides).filter((value) => value && value.trim()).length;
    const groups = [...new Set(AI_TASK_ROUTING.map((entry) => entry.group))];

    return (
        <div style={{ marginBottom: "0.85rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        style={{ ...smallButtonStyle, width: "100%", display: "flex", justifyContent: "space-between" }}
        >
        <span>Per-task models{activeCount ? ` (${activeCount} set)` : ""}</span>
        <span>{expanded ? "Hide" : "Show"}</span>
        </button>
        {expanded && (
            <div style={{ marginTop: "0.6rem" }}>
            <div style={{ ...helperStyle, marginTop: 0, marginBottom: "0.7rem" }}>
            Route individual AI tasks to a cheaper or a stronger model. Blank means the
            default model above. Saved per provider, so switching providers switches the
            whole set.
            </div>
            {groups.map((group) => (
                <div key={group}>
                <div style={{ fontSize: "0.76rem", fontWeight: 700, opacity: 0.8, margin: "0.5rem 0 0.4rem" }}>{group}</div>
                {AI_TASK_ROUTING.filter((entry) => entry.group === group).map(({ key, label, hint }) => (
                    <SettingsInput
                    key={key}
                    label={label}
                    value={overrides[key] ?? ""}
                    onChange={(value) => update(key, value)}
                    placeholder={hint}
                    suggestions={suggestions}
                    />
                ))}
                </div>
            ))}
            </div>
        )}
        </div>
    );
};

// Per-provider expert fields, keyed by the form-state names the settings host
// persists (providerConfig.js FORM_FIELD_MAP).
const PROVIDER_EXPERT_FIELDS = {
    gemini: { customParams: "geminiCustomParams", placeholder: '{"generationConfig": {"topP": 0.9}}' },
    openai: { customParams: "openaiCustomParams", placeholder: '{"top_p": 0.9}', structuredMode: "openaiStructuredMode" },
    anthropic: { customParams: "anthropicCustomParams", placeholder: '{"top_p": 0.9}' },
    "openai-compatible": {
        customParams: "openaiCompatibleCustomParams",
        placeholder: '{"top_p": 0.9}',
        structuredMode: "openaiCompatibleStructuredMode",
        toolStrict: "openaiCompatibleToolStrict",
    },
    "anthropic-compatible": {
        customParams: "anthropicCompatibleCustomParams",
        placeholder: '{"top_p": 0.9}',
        structuredMode: "anthropicCompatibleStructuredMode",
    },
};

// The connection: where the provider is and what runs there. Everything a
// player touches once (credentials, model, profiles, reasoning) lives here;
// request parameters, the structured-output ladder and per-task routing are
// in the Advanced section so routine setup stays readable.
const ProviderConnectionPanel = ({ provider, settings, onSettingChange }) => {
    const meta = getProviderMeta(provider);
    const supportsModelDiscovery = providerSupportsModelDiscovery(provider);
    const recentModels = getRecentModels(provider);
    // Global reasoning toggle — one switch, applied in every provider mode.
    const [reasoningOn, setReasoningOn] = useState(() => getReasoningEnabled());
    const toggleReasoning = () => {
        const next = !reasoningOn;
        setReasoningOn(next);
        setReasoningEnabled(next);
    };

    return (
        <SettingsSection title={`${meta.label} connection`} description={meta.description}>
        <PresetManager key={provider} provider={provider} settings={settings} onSettingChange={onSettingChange} />

        {provider === "gemini" && (
            <>
            <SettingsInput
            label="Gemini API Key"
            type="password"
            value={settings.geminiApiKey ?? ""}
            onChange={(value) => onSettingChange("geminiApiKey", value)}
            placeholder="Paste Gemini API key"
            helperText="Stored only in this browser."
            />
            <SettingsInput
            label="Model"
            value={settings.geminiModel ?? ""}
            onChange={(value) => onSettingChange("geminiModel", value)}
            suggestions={recentModels}
            placeholder="gemini-3.5-flash-lite"
            helperText="Leave blank to use the built-in Gemini default."
            />
            </>
        )}

        {provider === "openai" && (
            <>
            <SettingsInput
            label="OpenAI API Key"
            type="password"
            value={settings.openaiApiKey ?? ""}
            onChange={(value) => onSettingChange("openaiApiKey", value)}
            placeholder="Paste OpenAI API key"
            helperText="Stored only in this browser."
            />
            <SettingsInput
            label="Model"
            value={settings.openaiModel ?? ""}
            onChange={(value) => onSettingChange("openaiModel", value)}
            suggestions={recentModels}
            placeholder="gpt-..."
            helperText={
                supportsModelDiscovery
                    ? "Leave blank to auto-pick a chat-capable model from /v1/models."
                    : "Enter the exact model id."
            }
            />
            </>
        )}

        {provider === "anthropic" && (
            <>
            <SettingsInput
            label="Anthropic API Key"
            type="password"
            value={settings.anthropicApiKey ?? ""}
            onChange={(value) => onSettingChange("anthropicApiKey", value)}
            placeholder="Paste Anthropic API key"
            helperText="Stored only in this browser."
            />
            <SettingsInput
            label="Model"
            value={settings.anthropicModel ?? ""}
            onChange={(value) => onSettingChange("anthropicModel", value)}
            suggestions={recentModels}
            placeholder="claude-haiku-4-5"
            helperText="Claude model ids are manual here. Leave blank to use the built-in default."
            />
            </>
        )}

        {provider === "openai-compatible" && (
            <>
            <SettingsInput
            label="API Endpoint"
            value={settings.openaiCompatibleEndpoint ?? ""}
            onChange={(value) => onSettingChange("openaiCompatibleEndpoint", value)}
            placeholder="http://localhost:11434/v1"
            // A server on the player's own machine works from the website too, but only
            // if it allows this origin — otherwise the browser silently drops the reply.
            // Say so up front here rather than letting it surface as "Failed to fetch".
            helperText={import.meta.env.VITE_OH_WEB
                ? "Base URL that exposes /chat/completions and /models. A server on your own machine (Ollama, LM Studio) also has to allow this site: start Ollama with OLLAMA_ORIGINS set to this site's address, or use the desktop app."
                : "Base URL that exposes /chat/completions and /models."}
            />
            <SettingsInput
            label="API Key (optional)"
            type="password"
            value={settings.openaiCompatibleApiKey ?? ""}
            onChange={(value) => onSettingChange("openaiCompatibleApiKey", value)}
            placeholder="Leave empty for local Ollama"
            helperText="Use a bearer token if your gateway requires authentication."
            />
            <SettingsInput
            label="Model"
            value={settings.openaiCompatibleModel ?? ""}
            onChange={(value) => onSettingChange("openaiCompatibleModel", value)}
            suggestions={recentModels}
            placeholder="llama / qwen / gpt / mistral"
            helperText="Leave blank to auto-pick a model from /models."
            />
            </>
        )}

        {provider === "anthropic-compatible" && (
            <>
            <SettingsInput
            label="API Endpoint"
            value={settings.anthropicCompatibleEndpoint ?? ""}
            onChange={(value) => onSettingChange("anthropicCompatibleEndpoint", value)}
            placeholder="https://my-proxy.example/v1"
            helperText="Base URL of a self-hosted proxy that speaks the Anthropic Messages API (POST /messages). Routed through the game server to avoid CORS."
            />
            <SettingsInput
            label="API Key (optional)"
            type="password"
            value={settings.anthropicCompatibleApiKey ?? ""}
            onChange={(value) => onSettingChange("anthropicCompatibleApiKey", value)}
            placeholder="Sent as x-api-key if set"
            helperText="Leave empty if your proxy doesn't require a key."
            />
            <SettingsInput
            label="Model"
            value={settings.anthropicCompatibleModel ?? ""}
            onChange={(value) => onSettingChange("anthropicCompatibleModel", value)}
            suggestions={recentModels}
            placeholder="claude-haiku-4-5"
            helperText="The model id your proxy expects. Leave blank to use the built-in default."
            />
            </>
        )}

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: "0.35rem", paddingTop: "0.8rem" }}>
        <Toggle
        label="Model reasoning"
        enabled={reasoningOn}
        onToggle={toggleReasoning}
        />
        <div style={{ ...helperStyle, marginTop: "-0.6rem", marginBottom: 0 }}>
        Lets thinking-capable models reason before answering (Gemini thinking, OpenAI
        reasoning effort, Claude extended thinking). Slower and costs more tokens;
        needs a model that supports it.
        </div>
        </div>
        </SettingsSection>
    );
};

// Expert controls for the active provider: the request-body escape hatch, the
// structured-output ladder (structuredMode.js) and the strict tool schema.
const ProviderAdvancedPanel = ({ provider, settings, onSettingChange, onOpenAiSettings }) => {
    const meta = getProviderMeta(provider);
    const field = PROVIDER_EXPERT_FIELDS[provider] ?? PROVIDER_EXPERT_FIELDS[DEFAULT_PROVIDER];

    return (
        <SettingsSection
        title="Custom request parameters"
        description={`Active provider: ${meta.label}. These values go straight to the provider and should normally be left empty.`}
        right={(
            <button
            type="button"
            onClick={onOpenAiSettings}
            style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(96,165,250,0.24)", borderRadius: "8px", color: "#bfdbfe", cursor: "pointer", fontSize: "0.72rem", fontWeight: 750, padding: "0.45rem 0.65rem" }}
            >
            AI settings
            </button>
        )}
        >
        <SettingsInput
        label="Custom parameters (JSON)"
        multiline
        value={settings[field.customParams] ?? ""}
        onChange={(value) => onSettingChange(field.customParams, value)}
        placeholder={field.placeholder}
        helperText="Optional. Merged into the request body — e.g. to limit reasoning budget/effort. Invalid JSON is ignored."
        />
        {field.structuredMode && (
            <StructuredModeSelect
            value={settings[field.structuredMode] ?? "auto"}
            onChange={(value) => onSettingChange(field.structuredMode, value)}
            />
        )}
        {field.toolStrict && (
            <>
            <Toggle
            label="Strict tool schema"
            enabled={settings[field.toolStrict] === "1"}
            onToggle={() => onSettingChange(field.toolStrict, settings[field.toolStrict] === "1" ? "" : "1")}
            />
            <div style={{ ...helperStyle, marginTop: "-0.6rem" }}>
            Sends strict:true with the tool call so a self-hosted backend constrains
            generation to the schema (SGLang/xgrammar, vLLM). Stops malformed or
            mistyped tool arguments. Leave off for OpenAI and Azure: they reject a
            schema that does not list every property as required. Only affects the
            tool rung of the structured-output ladder above.
            </div>
            </>
        )}
        </SettingsSection>
    );
};

const SocialLinks = ({ discordUrl, redditUrl, githubUrl }) => {
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
                style={{
                    background: "rgba(255,255,255,0.035)",
                    border: "1px solid rgba(255,255,255,0.075)",
                    borderRadius: "7px",
                    color: "rgba(255,255,255,0.58)",
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    padding: "0.38rem 0.55rem",
                    textDecoration: "none",
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
        left: "0.5rem",
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
                <div key={address.url} style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
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
        const ok = await copyToClipboard(buildDebugLogReport());
        setCopyState(ok ? "copied" : "failed");
        setTimeout(() => setCopyState("idle"), 2500);
    };

    const handleDownload = () => {
        const blob = new Blob([buildDebugLogReport()], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = debugLogFilename();
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Revoked on the next tick, not immediately: Firefox cancels a download
        // whose blob URL is revoked in the same task as the click.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handleClear = () => {
        clearDebugLog();
        setCleared(true);
        setTimeout(() => setCleared(false), 2500);
    };

    return (
        <div>
        <div style={{ marginBottom: "0.55rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.35 }}>
        The game keeps a running log of what you did — saves opened, orders queued, turns taken, and anything that went wrong. Send it with a bug report and it says what happened, in order.
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", opacity: enabled ? 1 : 0.45 }}>
        <button
        type="button"
        onClick={handleCopy}
        disabled={copyState === "copying"}
        style={{ ...diagnosticsButton, flex: 1 }}
        >
        {copyState === "copied" ? "✓ Copied!" : copyState === "failed" ? "Couldn't copy" : copyState === "copying" ? "Copying…" : "📋 Copy log"}
        </button>
        <button type="button" onClick={handleDownload} style={{ ...diagnosticsButton, flex: 1 }}>
        💾 Save as file
        </button>
        </div>

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
        On by default. Off: nothing is recorded, and the log stored on this device is deleted. Remembered across save changes and restarts.
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
        The log gets a bigger allowance while this is on, but still fills faster. It now quotes your conversations word for word — read it before posting it somewhere public.
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
        neutral: { background: "rgba(255,255,255,0.035)", border: "rgba(255,255,255,0.08)", icon: "rgba(255,255,255,0.08)", color: "#f8fafc" },
        violet: { background: "rgba(124,58,237,0.09)", border: "rgba(167,139,250,0.18)", icon: "rgba(124,58,237,0.18)", color: "#ddd6fe" },
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

const SettingsSection = ({ title, description, right, children }) => (
    <section style={{ background: "rgba(255,255,255,0.022)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "1rem" }}>
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
    { key: "ai", label: "AI", icon: "✦", description: "Provider, model, reasoning and limits" },
    { key: "advanced", label: "Advanced", icon: "⌘", description: "Provider parameters and expert controls" },
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
    selectedProvider,
    onApiProviderChange,
    providerSettings,
    onProviderSettingChange,
    mapSettings,
    updateMapSetting,
    basemapStyle,
    updateBasemapStyle,
    updateBetaUnits,
    telemetryOn,
    onToggleTelemetry,
    ratingOn,
    onToggleRating,
    context,
}) => {
    const isMobile = useIsMobile();
    const leaving = usePresenceLeaving();
    const cardRef = useRef(null);
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

    const nav = (
        <nav style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: "0.35rem", overflowX: isMobile ? "auto" : "visible", padding: isMobile ? "0.65rem" : "0.85rem", scrollbarWidth: "none" }}>
            {SETTINGS_SECTIONS.map((section) => {
                const selected = section.key === activeSection;
                return (
                    <button
                    key={section.key}
                    type="button"
                    onClick={() => onSectionChange(section.key)}
                    style={{
                        alignItems: "center",
                        background: selected ? "rgba(59,130,246,0.12)" : "transparent",
                        border: `1px solid ${selected ? "rgba(96,165,250,0.22)" : "transparent"}`,
                        borderRadius: "9px",
                        color: selected ? "#e0f2fe" : "rgba(255,255,255,0.58)",
                        cursor: "pointer",
                        display: "flex",
                        flex: isMobile ? "0 0 auto" : "none",
                        fontFamily: "inherit",
                        gap: "0.65rem",
                        minWidth: isMobile ? "9.6rem" : 0,
                        padding: "0.62rem 0.65rem",
                        textAlign: "left",
                        width: isMobile ? "auto" : "100%",
                    }}
                    >
                        <span aria-hidden="true" style={{ alignItems: "center", background: selected ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.045)", borderRadius: "7px", display: "inline-flex", flexShrink: 0, fontSize: "0.76rem", fontWeight: 900, height: "1.8rem", justifyContent: "center", width: "1.8rem" }}>{section.icon}</span>
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
                <SettingsSection title="Provider" description="Choose which model service Open Historia uses. Provider-specific credentials stay with the selected provider.">
                    <ApiProviderSelector provider={selectedProvider} onProviderChange={onApiProviderChange ?? (() => {})} />
                </SettingsSection>
                <ProviderConnectionPanel provider={selectedProvider} settings={providerSettings ?? {}} onSettingChange={onProviderSettingChange ?? (() => {})} />
                <SettingsSection title="Generation behavior" description="Bound model waiting behavior without changing the deterministic fallback path.">
                    <Toggle label="Limit AI generation" enabled={mapSettings.limitAiGeneration} onToggle={() => updateMapSetting("limitAiGeneration", MAP_SETTING_KEYS.limitAiGeneration, !mapSettings.limitAiGeneration)} />
                    <div style={settingsHelper}>
                    Off (default): waits as long as the model needs, however stuck. On: the game stops waiting and falls back to canned events when the model goes quiet — 5 minutes of silence part-way through an answer, or 15 minutes with no answer at all. A model that is still writing is never interrupted, however long it takes. Cancel works either way.
                    </div>
                    <Toggle label="Generate long time skips in segments" enabled={mapSettings.chunkLongJumps} onToggle={() => updateMapSetting("chunkLongJumps", MAP_SETTING_KEYS.chunkLongJumps, !mapSettings.chunkLongJumps)} />
                    <div style={settingsHelper}>
                    Off (default): the whole skip is generated in a single request. On: skips of more than a few months are generated in several shorter requests and merged into one round — slower and costlier in tokens, but far less likely to time out on a hosted provider.
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
                <SettingsSection title="Expert controls" description="Uncommon provider-level overrides live here so routine configuration stays readable.">
                    <div style={{ color: "rgba(255,255,255,0.52)", fontSize: "0.7rem", lineHeight: 1.5 }}>
                        These values are passed directly to the selected AI provider. They can alter request behavior in provider-specific ways and should normally be left empty.
                    </div>
                </SettingsSection>
                <ProviderAdvancedPanel provider={selectedProvider} settings={providerSettings ?? {}} onSettingChange={onProviderSettingChange ?? (() => {})} onOpenAiSettings={() => onSectionChange("ai")} />
                <SettingsSection title="Per-task models" description="Route individual AI tasks to a cheaper or a stronger model. Blank means the provider's default model. Saved per provider.">
                    <TaskModelOverrides key={selectedProvider} provider={selectedProvider} suggestions={getRecentModels(selectedProvider)} />
                </SettingsSection>
                <SettingsSection
                title="Telemetry"
                description="What the AI debug console can show about every call."
                right={typeof onOpenDebugConsole === "function" ? (
                    <button
                    type="button"
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
                    A small 1-10 bar after each time skip, Game Master edit and catalyst. Ratings sit beside the call in the console and its exports.
                    </div>
                </SettingsSection>
                <SettingsSection title="Experimental" description="Work-in-progress systems. Stored with the save, so a copy of the campaign keeps the choice.">
                    <ExperimentalPill />
                    <Toggle label="Beta unit system" enabled={mapSettings.betaUnits} onToggle={() => updateBetaUnits(!mapSettings.betaUnits)} />
                    <div style={{ ...settingsHelper, marginBottom: mapSettings.betaUnits !== isBetaUnits() ? "0.6rem" : 0 }}>
                    On: the AI drives movement and combat, units hold a posture, and standing orders advance every turn. Expect bugs. Off (default): you move and attack your units yourself. Your save works with both, and switching back and forth loses nothing.
                    </div>
                    {/* The running session is pinned to what THIS SAVE said when it was opened
                        (see isBetaUnits), so a flip only means something after the page is
                        loaded again — the save already has the new value on disk by then.
                        Shown only while the two actually disagree. Nothing needs quitting: the
                        pin is module state in the page's own bundle, and every bit of campaign
                        state lives on the server, so a reload is the whole of it. */}
                    {mapSettings.betaUnits !== isBetaUnits() && (
                        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.72rem", color: "#ffd24a", lineHeight: 1.35 }}>
                        <span>Takes effect when the game reloads.</span>
                        <button
                        type="button"
                        onClick={() => window.location.reload()}
                        title="Reloads the page. Your campaign is saved on the server, so nothing is lost — but finish any turn that is still generating first."
                        style={{
                            background: "rgba(255,210,74,0.14)",
                            border: "1px solid rgba(255,210,74,0.5)",
                            borderRadius: "6px",
                            color: "#ffd24a",
                            cursor: "pointer",
                            fontFamily: "sans-serif",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            padding: "0.2rem 0.55rem",
                        }}
                        >
                        Reload now
                        </button>
                        </div>
                    )}
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

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="Game settings" className={leaving ? "oh-fade-out" : closing ? "oh-fade-out-slow" : fromRect ? undefined : "oh-fade-in"} style={{ alignItems: "center", background: "rgba(6,6,7,0.42)", backdropFilter: "blur(18px) saturate(1.2)", display: "flex", inset: 0, justifyContent: "center", padding: isMobile ? "0.45rem" : "clamp(0.8rem, 2vw, 1.6rem)", position: "fixed", zIndex: 2147483000 }}>
            <div ref={cardRef} className="oh-ws-card" style={{ background: "linear-gradient(180deg, rgba(46,46,50,0.72), rgba(17,17,19,0.62))", backdropFilter: "var(--oh-hud-blur)", WebkitBackdropFilter: "var(--oh-hud-blur)", border: "1px solid var(--oh-hud-border)", borderRadius: isMobile ? "12px" : "18px", boxShadow: "var(--oh-hud-shadow)", color: "white", display: "flex", flexDirection: "column", fontFamily: "sans-serif", height: isMobile ? "calc(100vh - 0.9rem)" : "min(800px, calc(100vh - 2.4rem))", maxWidth: "1120px", overflow: "hidden", width: isMobile ? "calc(100vw - 0.9rem)" : "min(94vw, 1120px)" }}>
                <div aria-hidden="true" className="oh-ws-tint" style={{ background: "linear-gradient(180deg, rgba(46,46,50,0.68), rgba(17,17,19,0.58))", borderRadius: "inherit", inset: 0, pointerEvents: "none", position: "absolute" }} />
                <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.75rem", padding: "0.8rem 0.9rem" }}>
                    <button type="button" onClick={onBack} aria-label="Back to game menu" title="Back to game menu" style={{ alignItems: "center", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "8px", color: "rgba(255,255,255,0.66)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2.25rem", justifyContent: "center", width: "2.25rem" }}>←</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.35rem 0.65rem" }}>
                            <span style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 900 }}>Settings</span>
                            {context?.scenarioName && <span style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.72rem", fontWeight: 700 }}>{context.scenarioName}</span>}
                        </div>
                        <div data-no-translate style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.61rem", marginTop: "0.12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[context?.countryName ? `Playing as ${context.countryName}` : "", context?.date || ""].filter(Boolean).join(" · ") || "Game preferences"}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close settings" style={{ alignItems: "center", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "8px", color: "rgba(255,255,255,0.62)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2.25rem", justifyContent: "center", width: "2.25rem" }}>×</button>
                </div>
                <div style={{ display: "grid", flex: 1, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "235px minmax(0, 1fr)", gridTemplateRows: isMobile ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", minHeight: 0 }}>
                    <aside style={{ backgroundColor: "rgba(9,9,10,0.24)", borderBottom: isMobile ? "1px solid rgba(255,255,255,0.07)" : "none", borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.07)", minHeight: 0, overflowY: isMobile ? "visible" : "auto" }}>{nav}</aside>
                    <main style={{ minHeight: 0, overflowY: "auto", padding: isMobile ? "0.8rem" : "1rem 1.05rem 1.2rem" }}>{content}</main>
                </div>
            </div>
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

const QuickMenuTabButton = ({ label, selected, onClick }) => (
    <button
    type="button"
    onClick={onClick}
    style={{
        background: selected ? "rgba(59,130,246,0.16)" : "transparent",
        border: `1px solid ${selected ? "rgba(96,165,250,0.28)" : "transparent"}`,
        borderRadius: "8px",
        color: selected ? "#e0f2fe" : "rgba(255,255,255,0.56)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.72rem",
        fontWeight: 850,
        padding: "0.5rem 0.8rem",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
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
        <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "11px", padding: "0.8rem 0.85rem" }}>
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
    apiProvider,
    onApiProviderChange,
    providerSettings,
    onProviderSettingChange,
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
    const selectedProvider = apiProvider ?? DEFAULT_PROVIDER;
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
        batchBackgroundTasks: getMapSetting(MAP_SETTING_KEYS.batchBackgroundTasks),
        // Not getMapSetting: this one belongs to the save, not the browser
        // profile (see mapSettings.js). resolveBetaUnits falls back to the
        // localStorage key for a save that has never chosen.
        betaUnits: resolveBetaUnits(),
    }));

    const updateMapSetting = (stateKey, settingKey, value) => {
        setMapSetting(settingKey, value);
        setMapSettingsState((current) => ({ ...current, [stateKey]: value }));
    };
    const updateBasemapStyle = (value) => setMapSettingValue(MAP_SETTING_KEYS.basemapStyle, value);

    // Telemetry switches (telemetry.js): their own keys, both on by default.
    const [telemetryOn, setTelemetryOn] = useState(() => isTelemetryEnabled());
    const [ratingOn, setRatingOn] = useState(() => isRatingEnabled());
    const toggleTelemetry = () => { const next = !telemetryOn; setTelemetryOn(next); setTelemetryEnabled(next); };
    const toggleRating = () => { const next = !ratingOn; setRatingOn(next); setRatingEnabled(next); };

    // The save's own value arrives asynchronously (library.js reads game.json),
    // and it changes again whenever a different save is activated — both of them
    // after this panel's state was seeded. Without this the checkbox keeps
    // showing the app-wide default, which for a beta save is the wrong box.
    useEffect(() => {
        const onUpdated = () =>
            setMapSettingsState((current) => {
                const next = resolveBetaUnits();
                return current.betaUnits === next ? current : { ...current, betaUnits: next };
            });
        onUpdated();
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, []);

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

    // The unit system is stored in the active save's game.json so it survives a
    // restart and travels with a copied or duplicated save. The localStorage write
    // still happens (through updateMapSetting): it is no longer where the setting
    // lives, only the default handed to the next save that has never chosen one.
    //
    // Order matters — applySaveBetaUnits first, because writeGameData re-stamps
    // the flag from it rather than from the object it is handed, which is what
    // makes this safe to do while a turn is generating.
    const updateBetaUnits = (value) => {
        updateMapSetting("betaUnits", MAP_SETTING_KEYS.betaUnits, value);
        const gameId = getLibraryState().activeGameId;
        // With no save open there is nothing to store it on, and writing game.json
        // anyway would have the server CREATE a session from the selected scenario
        // — a settings click must not start a campaign. The localStorage default
        // above is enough: the save the player opens next inherits it.
        if (!gameId) return;
        applySaveBetaUnits(gameId, value);
        readGameData({ force: true })
            .then((game) => writeGameData(game))
            .catch((error) => {
                console.warn("Failed to store the unit system on this save:", error);
            });
    };

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
            selectedProvider={selectedProvider}
            onApiProviderChange={onApiProviderChange}
            providerSettings={providerSettings}
            onProviderSettingChange={onProviderSettingChange}
            mapSettings={mapSettings}
            updateMapSetting={updateMapSetting}
            basemapStyle={basemapStyle}
            updateBasemapStyle={updateBasemapStyle}
            updateBetaUnits={updateBetaUnits}
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
                    <QuickAction title="AI" description="Provider, model, reasoning and limits" symbol="✦" onClick={() => openSettingsSection("ai")} />
                    <QuickAction title="Advanced" description="Provider parameters and expert controls" symbol="⌘" onClick={() => openSettingsSection("advanced")} />
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
                        <QuickAction title="Cheats" description="Game master tools and world editing" symbol="⌁" tone="violet" onClick={() => runAndClose(onOpenCheats)} />
                    )}
                    {typeof onOpenEvents === "function" && (
                        <QuickAction title="Events / Timeline" description="Review the current turn and world history" symbol="◷" tone="blue" onClick={() => runAndClose(onOpenEvents)} />
                    )}
                    {/* This branch's own tool, in the same row: every AI call with its prompt,
                        answer and cost. Continuum has no counterpart. */}
                    {typeof onOpenDebugConsole === "function" && (
                        <QuickAction title="AI debug console" description="Every AI call, its prompt, answer and cost" symbol="◈" onClick={() => runAndClose(onOpenDebugConsole)} />
                    )}
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
            left: "0.5rem",
            width: isMobile ? "calc(100vw - 1rem)" : "29rem",
            maxWidth: "calc(100vw - 1rem)",
            minHeight: isMobile ? "auto" : "22rem",
            // Never taller than the space below the panel's own top edge — the old
            // 100vh-5rem pushed the bottom (Discord/GitHub links) off short screens.
            maxHeight: `calc(100vh - ${topOffset} - 1rem)`,
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
                    <div data-no-translate style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem", marginTop: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[context?.countryName ? `Playing as ${context.countryName}` : "", context?.date || ""].filter(Boolean).join(" · ") || "Game menu"}
                    </div>
                </div>
                <button type="button" onClick={() => onClose?.()} aria-label="Close game menu" style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "rgba(255,255,255,0.58)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2rem", justifyContent: "center", width: "2rem" }}>×</button>
            </div>

            <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", display: "flex", gap: "0.2rem", padding: "0.2rem", marginBottom: "0.8rem", overflowX: "auto", scrollbarWidth: "none" }}>
                {QUICK_MENU_TABS.map((tab) => (
                    <QuickMenuTabButton key={tab.key} label={tab.label} selected={activeQuickTab === tab.key} onClick={() => setActiveQuickTab(tab.key)} />
                ))}
            </div>

            <div key={activeQuickTab} className="oh-surface-in" style={{ flex: 1, minHeight: 0 }}>
                {panelContent}
            </div>
        </div>
    );
};

export { Toggle, SettingsButton, SettingsMenu, ApiProviderSelector, SocialLinks };
