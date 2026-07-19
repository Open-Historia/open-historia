/*! Open Historia — portions (reasoning toggle + small-screen menu) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
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
    getStoredLanguage,
    setStoredLanguage,
} from "../../runtime/i18n.js";
import {
    MAP_SETTING_KEYS,
    getMapSetting,
    setMapSetting,
} from "../../runtime/mapSettings.js";

const baseStyle = {
    position: "fixed",
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    backdropFilter: "blur(4px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "sans-serif",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
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

const LanguageSelector = () => {
    const [query, setQuery] = useState("");
    const [saving, setSaving] = useState(false);
    const current = getStoredLanguage();
    const options = getLanguageOptions();
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
        ? options.filter((option) =>
            `${option.name} ${option.native} ${option.code}`.toLowerCase().includes(normalizedQuery))
        : options;

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
        <div style={fieldGroupStyle}>
        <label style={labelStyle}>Language</label>
        <input
        style={{ ...inputStyle, marginBottom: "0.4rem" }}
        type="text"
        value={query}
        placeholder="Search languages..."
        onChange={(event) => setQuery(event.target.value)}
        />
        <select
        data-no-translate
        value={filtered.some((option) => option.code === current) ? current : ""}
        onChange={(event) => applyLanguage(event.target.value)}
        style={{ ...inputStyle, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
        {!filtered.some((option) => option.code === current) && (
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
        </div>
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
    // Global reasoning toggle — one switch, applied in every provider mode.
    const [reasoningOn, setReasoningOn] = useState(() => getReasoningEnabled());
    const toggleReasoning = () => {
        const next = !reasoningOn;
        setReasoningOn(next);
        setReasoningEnabled(next);
    };

    return (
        <div
        style={{
            marginBottom: "1rem",
            padding: "0.85rem",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.1)",
            backgroundColor: "rgba(255,255,255,0.04)",
        }}
        >
        <div style={{ fontSize: "0.84rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        {meta.label} Settings
        </div>
        <div style={{ ...helperStyle, marginTop: 0, marginBottom: "0.85rem" }}>
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
            placeholder="gemini-3.1-flash-lite-preview"
            helperText="Leave blank to use the built-in Gemini default."
            />
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={settings.geminiCustomParams ?? ""}
            onChange={(value) => onSettingChange("geminiCustomParams", value)}
            placeholder='{"generationConfig": {"topP": 0.9}}'
            helperText="Optional. Merged into the request body — e.g. to limit reasoning budget/effort. Invalid JSON is ignored."
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
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={settings.openaiCustomParams ?? ""}
            onChange={(value) => onSettingChange("openaiCustomParams", value)}
            placeholder='{"top_p": 0.9}'
            helperText="Optional. Merged into the request body — e.g. to limit reasoning budget/effort. Invalid JSON is ignored."
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
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={settings.anthropicCustomParams ?? ""}
            onChange={(value) => onSettingChange("anthropicCustomParams", value)}
            placeholder='{"top_p": 0.9}'
            helperText="Optional. Merged into the request body — e.g. to limit reasoning budget/effort. Invalid JSON is ignored."
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
            placeholder="llama / qwen / gpt / mistral"
            helperText="Leave blank to auto-pick a model from /models."
            />
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={settings.openaiCompatibleCustomParams ?? ""}
            onChange={(value) => onSettingChange("openaiCompatibleCustomParams", value)}
            placeholder='{"top_p": 0.9}'
            helperText="Optional. Merged into the request body — e.g. to limit reasoning budget/effort. Invalid JSON is ignored."
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
            <SettingsInput
            label="Custom parameters (JSON)"
            multiline
            value={settings.anthropicCompatibleCustomParams ?? ""}
            onChange={(value) => onSettingChange("anthropicCompatibleCustomParams", value)}
            placeholder='{"top_p": 0.9}'
            helperText="Optional. Merged into the request body — e.g. to limit reasoning budget/effort. Invalid JSON is ignored."
            />
            </>
        )}

        <div style={{ marginTop: "0.5rem" }}>
        <Toggle
        label="Model reasoning"
        enabled={reasoningOn}
        onToggle={toggleReasoning}
        />
        <div style={{ ...helperStyle, marginTop: "-0.6rem" }}>
        Lets thinking-capable models reason before answering (Gemini thinking, OpenAI
        reasoning effort, Claude extended thinking). Slower and costs more tokens;
        needs a model that supports it.
        </div>
        </div>
        </div>
    );
};

const SocialLinks = ({ discordUrl, redditUrl, githubUrl }) => (
    <div
    style={{
        display: "flex",
        gap: "0.5rem",
        marginTop: "0.25rem",
        paddingTop: "1rem",
        borderTop: "1px solid rgba(255,255,255,0.1)",
    }}
    >
    {discordUrl && (
        <a
        href={discordUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Join our Discord"
        style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            padding: "0.5rem",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)",
            backgroundColor: "rgba(88, 101, 242, 0.2)",
            color: "white",
            textDecoration: "none",
            fontSize: "0.8rem",
            fontWeight: 500,
            transition: "background-color 0.2s, border-color 0.2s",
            cursor: "pointer",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(88, 101, 242, 0.45)";
            event.currentTarget.style.borderColor = "rgba(88, 101, 242, 0.6)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(88, 101, 242, 0.2)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }}
        >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
        Discord
        </a>
    )}
    {redditUrl && (
        <a
        href={redditUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Join the subreddit"
        style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            padding: "0.5rem",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)",
            backgroundColor: "rgba(255, 69, 0, 0.2)",
            color: "white",
            textDecoration: "none",
            fontSize: "0.8rem",
            fontWeight: 500,
            transition: "background-color 0.2s, border-color 0.2s",
            cursor: "pointer",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(255, 69, 0, 0.45)";
            event.currentTarget.style.borderColor = "rgba(255, 69, 0, 0.6)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(255, 69, 0, 0.2)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }}
        >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12c-.687 0-1.248.561-1.248 1.25 0 .686.561 1.248 1.249 1.248.688 0 1.249-.562 1.249-1.249 0-.688-.561-1.249-1.25-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .686.561 1.248 1.249 1.248.688 0 1.249-.562 1.249-1.249 0-.688-.561-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.095.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.197-2.512-.73a.326.326 0 0 0-.232-.095z"/>
        </svg>
        Reddit
        </a>
    )}
    {githubUrl && (
        <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="View on GitHub"
        style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            padding: "0.5rem",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)",
            backgroundColor: "rgba(255,255,255,0.07)",
            color: "white",
            textDecoration: "none",
            fontSize: "0.8rem",
            fontWeight: 500,
            transition: "background-color 0.2s, border-color 0.2s",
            cursor: "pointer",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }}
        >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
        </svg>
        GitHub
        </a>
    )}
    </div>
);

const SettingsButton = ({ onToggle, topOffset = "0.5rem" }) => (
    <button
    onClick={onToggle}
    style={{
        ...baseStyle,
        top: topOffset,
        left: "0.5rem",
        height: "4rem",
        width: "4rem",
        cursor: "pointer",
        fontSize: "1.8rem",
        fontWeight: 700,
    }}
    >
    ⋮
    </button>
);

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
    discordUrl,
    redditUrl,
    githubUrl,
}) => {
    const selectedProvider = apiProvider ?? DEFAULT_PROVIDER;

    const [mapSettings, setMapSettingsState] = useState(() => ({
        hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
        disableIdleRotation: getMapSetting(MAP_SETTING_KEYS.disableIdleRotation),
        disableEventCamera: getMapSetting(MAP_SETTING_KEYS.disableEventCamera),
        limitAiGeneration: getMapSetting(MAP_SETTING_KEYS.limitAiGeneration),
    }));

    const updateMapSetting = (stateKey, settingKey, value) => {
        setMapSetting(settingKey, value);
        setMapSettingsState((current) => ({ ...current, [stateKey]: value }));
    };

    return (
        <div
        style={{
            ...baseStyle,
            top: `calc(${topOffset} + 4.25rem)`,
            left: "0.5rem",
            width: "22rem",
            maxWidth: "calc(100vw - 1rem)",
            // Never taller than the space below the panel's own top edge — the old
            // 100vh-5rem pushed the bottom (Discord/GitHub links) off short screens.
            maxHeight: `calc(100vh - ${topOffset} - 5.25rem)`,
            overflowY: "auto",
            padding: "1rem",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            height: "auto",
        }}
        >
        <h3
        style={{
            margin: "0 -1rem 1rem -1rem",
            padding: "0 1rem 1rem 1rem",
            fontSize: "1.1rem",
            textAlign: "left",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
        >
        Game Settings
        </h3>

        <ApiProviderSelector
        provider={selectedProvider}
        onProviderChange={onApiProviderChange ?? (() => {})}
        />

        <ProviderSettingsPanel
        provider={selectedProvider}
        settings={providerSettings ?? {}}
        onSettingChange={onProviderSettingChange ?? (() => {})}
        />

        <LanguageSelector />

        <Toggle label="Fullscreen" enabled={isFullscreenEnabled} onToggle={onToggleFullscreen} />
        <Toggle label="3D Globe" enabled={isGlobeEnabled} onToggle={onToggleGlobe} />
        <div style={{ marginTop: "-0.85rem", marginBottom: "1rem" }}>
        <span
        style={{
            backgroundColor: "rgba(245,158,11,0.16)",
            border: "1px solid rgba(245,158,11,0.45)",
            borderRadius: "999px",
            color: "#fbbf24",
            fontSize: "0.66rem",
            fontWeight: 700,
            letterSpacing: "0.02em",
            padding: "0.16rem 0.55rem",
        }}
        >
        Very Experimental
        </span>
        </div>
        <Toggle label="3D Terrain" enabled={isTerrainEnabled} onToggle={onToggleTerrain} />
        <div style={{ margin: "0.5rem 0 1rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: "0.84rem", fontWeight: 700, marginBottom: "0.6rem" }}>Map</div>
        <Toggle
        label="Hide country labels"
        enabled={mapSettings.hideCountryLabels}
        onToggle={() => updateMapSetting("hideCountryLabels", MAP_SETTING_KEYS.hideCountryLabels, !mapSettings.hideCountryLabels)}
        />
        <Toggle
        label="Reduce motion"
        enabled={mapSettings.disableIdleRotation && mapSettings.disableEventCamera}
        onToggle={() => {
            // Umbrella accessibility control: on = stop both the idle globe spin
            // and the fly-to during events; the two toggles below stay for
            // granular control and reflect the result.
            const next = !(mapSettings.disableIdleRotation && mapSettings.disableEventCamera);
            updateMapSetting("disableIdleRotation", MAP_SETTING_KEYS.disableIdleRotation, next);
            updateMapSetting("disableEventCamera", MAP_SETTING_KEYS.disableEventCamera, next);
        }}
        />
        <Toggle
        label="Disable idle globe rotation"
        enabled={mapSettings.disableIdleRotation}
        onToggle={() => updateMapSetting("disableIdleRotation", MAP_SETTING_KEYS.disableIdleRotation, !mapSettings.disableIdleRotation)}
        />
        <Toggle
        label="Disable camera movement during events"
        enabled={mapSettings.disableEventCamera}
        onToggle={() => updateMapSetting("disableEventCamera", MAP_SETTING_KEYS.disableEventCamera, !mapSettings.disableEventCamera)}
        />
        </div>

        <div style={{ margin: "0.5rem 0 1rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: "0.84rem", fontWeight: 700, marginBottom: "0.6rem" }}>AI</div>
        <Toggle
        label="Limit AI generation"
        enabled={mapSettings.limitAiGeneration}
        onToggle={() => updateMapSetting("limitAiGeneration", MAP_SETTING_KEYS.limitAiGeneration, !mapSettings.limitAiGeneration)}
        />
        <div style={{ marginTop: "-0.7rem", marginBottom: "0.4rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.35 }}>
        On: time skips give the model 5 minutes, then fall back to canned events. Off (default): generation waits as long as the model needs. Cancel works either way.
        </div>
        </div>

        {typeof onOpenCheats === "function" && (
            <button
            type="button"
            onClick={onOpenCheats}
            style={{
                alignItems: "center",
                background: "rgba(124,58,237,0.22)",
                border: "1px solid rgba(139,92,246,0.45)",
                borderRadius: "8px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                fontSize: "0.9rem",
                fontWeight: 600,
                gap: "0.5rem",
                justifyContent: "center",
                marginBottom: "1rem",
                padding: "0.6rem 0.7rem",
                width: "100%",
            }}
            >
            🧪 Cheats
            </button>
        )}

        <a
        href="/guides/"
        style={{
            alignItems: "center",
            background: "rgba(59,130,246,0.18)",
            border: "1px solid rgba(96,165,250,0.4)",
            borderRadius: "8px",
            color: "white",
            cursor: "pointer",
            display: "flex",
            fontSize: "0.9rem",
            fontWeight: 600,
            gap: "0.5rem",
            justifyContent: "center",
            marginBottom: "1rem",
            padding: "0.6rem 0.7rem",
            textDecoration: "none",
            width: "100%",
        }}
        >
        📖 Guides
        </a>

        <SocialLinks discordUrl={discordUrl} redditUrl={redditUrl} githubUrl={githubUrl} />
        </div>
    );
};

export { Toggle, SettingsButton, SettingsMenu, ApiProviderSelector, SocialLinks };
