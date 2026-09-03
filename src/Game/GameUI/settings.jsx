/*! Open Historia — portions (reasoning toggle + small-screen menu) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
    DEFAULT_PROVIDER,
    PROVIDER_OPTIONS,
    getProviderMeta,
    getReasoningEnabled,
    providerSupportsModelDiscovery,
    setReasoningEnabled,
} from "../AI/providerConfig.js";
import {
    getLanguageOptions,
    getStoredChatLanguage,
    getStoredLanguage,
    setStoredChatLanguage,
    setStoredLanguage,
} from "../../runtime/i18n.js";
import {
    MAP_SETTING_KEYS,
    getMapSetting,
    setMapSetting,
    setMapSettingValue,
    useMapSettingValue,
} from "../../runtime/mapSettings.js";
import { ESRI_BASEMAPS, isBuiltinBasemapId } from "../../runtime/assets.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";

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
        backgroundColor: enabled ? "#3b82f6" : "#4b5563",
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

const SettingsInput = ({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    helperText,
    multiline = false,
}) => (
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
        style={inputStyle}
        />
    )}
    {helperText && (
        <div style={helperStyle}>
        {helperText}
        </div>
    )}
    </div>
);

const ProviderSettingsPanel = ({ provider, settings, onSettingChange }) => {
    const meta = getProviderMeta(provider);
    const supportsModelDiscovery = providerSupportsModelDiscovery(provider);
    const [reasoningOn, setReasoningOn] = useState(() => getReasoningEnabled());
    const toggleReasoning = () => {
        const next = !reasoningOn;
        setReasoningOn(next);
        setReasoningEnabled(next);
    };

    return (
        <div
        style={{
            padding: "1rem",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.08)",
            backgroundColor: "rgba(255,255,255,0.025)",
        }}
        >
        <div style={{ fontSize: "0.9rem", fontWeight: 800, marginBottom: "0.25rem" }}>
        {meta.label} connection
        </div>
        <div style={{ ...helperStyle, marginTop: 0, marginBottom: "0.9rem" }}>
        {meta.description}
        </div>

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
        Lets thinking-capable models reason before answering. It can improve difficult decisions, but increases latency and token use.
        </div>
        </div>
        </div>
    );
};

const ProviderAdvancedSettingsPanel = ({ provider, settings, onSettingChange, onOpenAiSettings }) => {
    const meta = getProviderMeta(provider);
    const fields = {
        gemini: {
            key: "geminiCustomParams",
            placeholder: '{"generationConfig": {"topP": 0.9}}',
        },
        openai: {
            key: "openaiCustomParams",
            placeholder: '{"top_p": 0.9}',
        },
        anthropic: {
            key: "anthropicCustomParams",
            placeholder: '{"top_p": 0.9}',
        },
        "openai-compatible": {
            key: "openaiCompatibleCustomParams",
            placeholder: '{"top_p": 0.9}',
        },
        "anthropic-compatible": {
            key: "anthropicCompatibleCustomParams",
            placeholder: '{"top_p": 0.9}',
        },
    };
    const field = fields[provider] ?? fields[DEFAULT_PROVIDER];

    return (
        <div style={{ padding: "1rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
            <div style={{ alignItems: "center", display: "flex", gap: "0.75rem", justifyContent: "space-between", marginBottom: "0.9rem" }}>
                <div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 800 }}>Custom request parameters</div>
                    <div style={{ ...helperStyle, marginTop: "0.2rem" }}>Active provider: {meta.label}</div>
                </div>
                <button type="button" onClick={onOpenAiSettings} style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(96,165,250,0.24)", borderRadius: "8px", color: "#bfdbfe", cursor: "pointer", fontSize: "0.72rem", fontWeight: 750, padding: "0.45rem 0.65rem" }}>
                    AI settings
                </button>
            </div>
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={settings[field.key] ?? ""}
            onChange={(value) => onSettingChange(field.key, value)}
            placeholder={field.placeholder}
            helperText="Optional. Merged into the provider request body. Invalid JSON is ignored. Keep this empty unless you know the provider-specific parameter you need."
            />
            {provider === "openai-compatible" && (
                <>
                <Toggle
                label="Strict tool schema"
                enabled={settings.openaiCompatibleToolStrict === "1"}
                onToggle={() => onSettingChange(
                    "openaiCompatibleToolStrict",
                    settings.openaiCompatibleToolStrict === "1" ? "" : "1",
                )}
                />
                <div style={{ ...helperStyle, marginTop: "-0.6rem" }}>
                Sends strict:true with the tool call so a self-hosted backend constrains generation to the schema.
                Leave this off for OpenAI/Azure-compatible endpoints that reject strict schemas.
                </div>
                </>
            )}
        </div>
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

const SettingsButton = ({ onToggle, topOffset = "0.5rem" }) => (
    <button
    type="button"
    aria-label="Open game menu"
    title="Game menu"
    onClick={onToggle}
    style={{
        ...baseStyle,
        top: topOffset,
        left: "0.65rem",
        height: "3rem",
        width: "3rem",
        cursor: "pointer",
        fontSize: "1.18rem",
        fontWeight: 800,
        background: "linear-gradient(180deg, rgba(39,55,75,0.58), rgba(8,16,28,0.48))",
    }}
    >
    ☰
    </button>
);

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
        return <a href={href} target="_blank" rel="noopener noreferrer" style={common}>{content}</a>;
    }
    return <button type="button" onClick={onClick} style={common}>{content}</button>;
};

const SettingsSection = ({ title, description, children }) => (
    <section style={{ background: "rgba(255,255,255,0.022)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "1rem" }}>
        <div style={{ marginBottom: "0.9rem" }}>
            <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.88rem", fontWeight: 850 }}>{title}</div>
            {description && <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.66rem", lineHeight: 1.45, marginTop: "0.2rem" }}>{description}</div>}
        </div>
        {children}
    </section>
);

const SETTINGS_SECTIONS = [
    { key: "general", label: "General", icon: "◫", description: "Language, display and accessibility" },
    { key: "map", label: "Map", icon: "◇", description: "Basemap, labels, globe and camera" },
    { key: "ai", label: "AI", icon: "✦", description: "Provider, model, reasoning and limits" },
    { key: "advanced", label: "Advanced", icon: "⌘", description: "Provider parameters and expert controls" },
];

const SettingsWorkspace = ({
    activeSection,
    onSectionChange,
    onBack,
    onClose,
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
    context,
}) => {
    const isMobile = useIsMobile();

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

    const pageTitle = SETTINGS_SECTIONS.find((section) => section.key === activeSection)?.label ?? "Settings";
    const pageDescription = SETTINGS_SECTIONS.find((section) => section.key === activeSection)?.description ?? "";

    const content = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
                    <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", marginBottom: "0.6rem" }}>
                        <span style={{ backgroundColor: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)", borderRadius: "999px", color: "#fbbf24", fontSize: "0.58rem", fontWeight: 850, padding: "0.18rem 0.48rem" }}>Experimental</span>
                    </div>
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
                <SettingsSection title="Provider" description="Choose which model service Continuum uses. Provider-specific credentials stay with the selected provider.">
                    <ApiProviderSelector provider={selectedProvider} onProviderChange={onApiProviderChange ?? (() => {})} />
                </SettingsSection>
                <ProviderSettingsPanel provider={selectedProvider} settings={providerSettings ?? {}} onSettingChange={onProviderSettingChange ?? (() => {})} />
                <SettingsSection title="Generation behavior" description="Bound model waiting behavior without changing the deterministic fallback path.">
                    <Toggle label="Limit AI generation" enabled={mapSettings.limitAiGeneration} onToggle={() => updateMapSetting("limitAiGeneration", MAP_SETTING_KEYS.limitAiGeneration, !mapSettings.limitAiGeneration)} />
                    <div style={{ ...helperStyle, marginTop: "-0.55rem", marginBottom: 0 }}>On: time skips give the model 5 minutes, then fall back to canned events. Off: generation waits as long as the model needs. Cancel works either way.</div>
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
                <ProviderAdvancedSettingsPanel provider={selectedProvider} settings={providerSettings ?? {}} onSettingChange={onProviderSettingChange ?? (() => {})} onOpenAiSettings={() => onSectionChange("ai")} />
                </>
            )}
        </div>
    );

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="Game settings" style={{ alignItems: "center", background: "rgba(2,6,15,0.42)", backdropFilter: "blur(18px) saturate(1.2)", display: "flex", inset: 0, justifyContent: "center", padding: isMobile ? "0.45rem" : "clamp(0.8rem, 2vw, 1.6rem)", position: "fixed", zIndex: 2147483000 }}>
            <div style={{ background: "linear-gradient(180deg, rgba(32,48,67,0.72), rgba(8,16,28,0.62))", backdropFilter: "var(--oh-hud-blur)", WebkitBackdropFilter: "var(--oh-hud-blur)", border: "1px solid var(--oh-hud-border)", borderRadius: isMobile ? "12px" : "18px", boxShadow: "var(--oh-hud-shadow)", display: "flex", flexDirection: "column", height: isMobile ? "calc(100vh - 0.9rem)" : "min(800px, calc(100vh - 2.4rem))", maxWidth: "1120px", overflow: "hidden", width: isMobile ? "calc(100vw - 0.9rem)" : "min(94vw, 1120px)" }}>
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
                    <aside style={{ backgroundColor: "rgba(3,8,18,0.24)", borderBottom: isMobile ? "1px solid rgba(255,255,255,0.07)" : "none", borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.07)", minHeight: 0 }}>{nav}</aside>
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
    onOpenEvents,
    onOpenGameManagement,
    onClose,
    discordUrl,
    redditUrl,
    githubUrl,
    reportBugUrl,
    context,
}) => {
    const selectedProvider = apiProvider ?? DEFAULT_PROVIDER;
    const isMobile = useIsMobile();
    const [activeSettingsSection, setActiveSettingsSection] = useState(null);
    const [activeQuickTab, setActiveQuickTab] = useState("tools");
    const storedBasemapStyle = useMapSettingValue(MAP_SETTING_KEYS.basemapStyle);
    const basemapStyle = isBuiltinBasemapId(storedBasemapStyle) ? storedBasemapStyle : "";
    const [mapSettings, setMapSettingsState] = useState(() => ({
        hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
        disableIdleRotation: getMapSetting(MAP_SETTING_KEYS.disableIdleRotation),
        disableEventCamera: getMapSetting(MAP_SETTING_KEYS.disableEventCamera),
        limitAiGeneration: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration),
    }));

    useEffect(() => {
        if (activeSettingsSection) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [activeSettingsSection, onClose]);

    const updateMapSetting = (stateKey, settingKey, value) => {
        setMapSetting(settingKey, value);
        setMapSettingsState((current) => ({ ...current, [stateKey]: value }));
    };
    const updateBasemapStyle = (value) => setMapSettingValue(MAP_SETTING_KEYS.basemapStyle, value);
    const runAndClose = (action) => {
        action?.();
        onClose?.();
    };
    const openSettingsSection = (section) => setActiveSettingsSection(section);

    if (activeSettingsSection) {
        return (
            <SettingsWorkspace
            activeSection={activeSettingsSection}
            onSectionChange={setActiveSettingsSection}
            onBack={() => setActiveSettingsSection(null)}
            onClose={onClose}
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
            context={context}
            />
        );
    }

    let panelContent = null;
    if (activeQuickTab === "game") {
        panelContent = (
            <QuickMenuPanel title="Game" description="Campaign identity and management actions.">
                <ContextSummaryCard context={context} />
                <QuickAction title="Game Management" description="Switch, duplicate, import or manage campaigns" symbol="▦" onClick={() => runAndClose(onOpenGameManagement)} />
            </QuickMenuPanel>
        );
    } else if (activeQuickTab === "settings") {
        panelContent = (
            <QuickMenuPanel title="Settings" description="Jump straight into the options category you want.">
                <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" }}>
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
                <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" }}>
                    <QuickAction title="Guides" description="How-to pages and setup help" symbol="?" href="/guides/" />
                    <QuickAction title="Report a Bug" description="Open the issue/report page" symbol="!" tone="amber" href={reportBugUrl} />
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
                <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" }}>
                    <QuickAction title="Cheats" description="Game master tools and world editing" symbol="⌁" tone="violet" onClick={() => runAndClose(onOpenCheats)} />
                    <QuickAction title="Events / Timeline" description="Review the current turn and world history" symbol="◷" tone="blue" onClick={() => runAndClose(onOpenEvents)} />
                </div>
            </QuickMenuPanel>
        );
    }

    return (
        <div
        style={{
            ...baseStyle,
            top: `calc(${topOffset} + 3.45rem)`,
            left: "0.65rem",
            width: isMobile ? "calc(100vw - 1rem)" : "29rem",
            maxWidth: "calc(100vw - 1rem)",
            minHeight: isMobile ? "auto" : "22rem",
            maxHeight: `calc(100vh - ${topOffset} - 5.25rem)`,
            overflowY: "auto",
            padding: "0.85rem",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            height: "auto",
            background: "linear-gradient(180deg, rgba(32,48,67,0.68), rgba(8,16,28,0.58))",
            border: "1px solid var(--oh-hud-border)",
            boxShadow: "var(--oh-hud-shadow)",
        }}
        >
            <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "0.75rem", margin: "-0.1rem -0.1rem 0.75rem", padding: "0 0.1rem 0.7rem" }}>
                <div style={{ alignItems: "center", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(96,165,250,0.16)", borderRadius: "9px", color: "#bfdbfe", display: "flex", flexShrink: 0, fontSize: "0.8rem", fontWeight: 950, height: "2.25rem", justifyContent: "center", width: "2.25rem" }}>OH</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.35rem 0.55rem" }}>
                        <span style={{ color: "#f8fafc", fontSize: "0.92rem", fontWeight: 900 }}>{context?.scenarioName || context?.gameName || "Open Historia"}</span>
                        <span style={{ color: "rgba(147,197,253,0.62)", fontSize: "0.58rem", fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>Continuum</span>
                    </div>
                    <div data-no-translate style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem", marginTop: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[context?.countryName ? `Playing as ${context.countryName}` : "", context?.date || ""].filter(Boolean).join(" · ") || "Game menu"}
                    </div>
                </div>
                <button type="button" onClick={onClose} aria-label="Close game menu" style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "rgba(255,255,255,0.58)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2rem", justifyContent: "center", width: "2rem" }}>×</button>
            </div>

            <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", display: "flex", gap: "0.2rem", padding: "0.2rem", marginBottom: "0.8rem", overflowX: "auto", scrollbarWidth: "none" }}>
                {QUICK_MENU_TABS.map((tab) => (
                    <QuickMenuTabButton key={tab.key} label={tab.label} selected={activeQuickTab === tab.key} onClick={() => setActiveQuickTab(tab.key)} />
                ))}
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
                {panelContent}
            </div>
        </div>
    );
};

export { Toggle, SettingsButton, SettingsMenu, ApiProviderSelector, SocialLinks };
