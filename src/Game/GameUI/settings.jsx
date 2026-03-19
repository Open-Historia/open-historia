import React, { useEffect } from "react";

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

const GeminiApiKeyInput = ({ apiKey, onKeyChange }) => (
    <div style={{ marginBottom: "1rem" }}>
    <label
    style={{
        display: "block",
        fontSize: "0.9rem",
        marginBottom: "0.5rem",
        color: "white",
        cursor: "text",
    }}
    >
    Gemini API Key
    </label>
    <input
    type="password"
    value={apiKey}
    onChange={(e) => onKeyChange(e.target.value)}
    placeholder="Enter API Key..."
    style={{
        width: "100%",
        padding: "0.6rem",
        borderRadius: "6px",
        border: "1px solid rgba(255,255,255,0.2)",
                                                        backgroundColor: "rgba(0,0,0,0.2)",
                                                        color: "white",
                                                        fontSize: "0.85rem",
                                                        outline: "none",
                                                        boxSizing: "border-box",
                                                        cursor: "text",
    }}
    />
    </div>
);

const SocialLinks = ({ discordUrl, githubUrl }) => (
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
        onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(88, 101, 242, 0.45)";
            e.currentTarget.style.borderColor = "rgba(88, 101, 242, 0.6)";
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(88, 101, 242, 0.2)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }}
        >
        {/* Discord SVG icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
        Discord
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
        onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }}
        >
        {/* GitHub SVG icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
        </svg>
        GitHub
        </a>
    )}
    </div>
);

const SettingsButton = ({ onToggle }) => (
    <button
    onClick={onToggle}
    style={{
        ...baseStyle,
        top: "0.5rem",
        left: "0.5rem",
        height: "4rem",
        width: "4rem",
        cursor: "pointer",
        fontSize: "1.5rem",
    }}
    >
    ⚙️
    </button>
);

const SettingsMenu = ({
    isFullscreenEnabled,
    isGlobeEnabled,
    isTerrainEnabled,
    onToggleFullscreen,
    onToggleGlobe,
    onToggleTerrain,
    geminiKey,
    onGeminiKeyChange,
    discordUrl,
    githubUrl,
}) => {
    useEffect(() => {
        const savedKey = localStorage.getItem("gemini_api_key");
        if (savedKey && !geminiKey) {
            onGeminiKeyChange(savedKey);
        }
    }, [geminiKey, onGeminiKeyChange]);

    const handleKeyUpdate = (newKey) => {
        onGeminiKeyChange(newKey);
        localStorage.setItem("gemini_api_key", newKey);
    };

    return (
        <div
        style={{
            ...baseStyle,
            top: "4.75rem",
            left: "0.5rem",
            width: "18rem",
            padding: "1rem",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            height: "auto",
        }}
        >
        <h3 style={{
            margin: "0 -1rem 1rem -1rem",
            padding: "0 1rem 1rem 1rem",
            fontSize: "1.1rem",
            textAlign: "left",
            borderBottom: "1px solid rgba(255,255,255,0.1)"
        }}>
        Game Settings
        </h3>

        <GeminiApiKeyInput
        apiKey={geminiKey}
        onKeyChange={handleKeyUpdate}
        />

        <Toggle label="Fullscreen" enabled={isFullscreenEnabled} onToggle={onToggleFullscreen} />
        <Toggle label="3D Globe" enabled={isGlobeEnabled} onToggle={onToggleGlobe} />
        <Toggle label="3D Terrain" enabled={isTerrainEnabled} onToggle={onToggleTerrain} />

        <SocialLinks discordUrl={discordUrl} githubUrl={githubUrl} />
        </div>
    );
};

export { Toggle, SettingsButton, SettingsMenu, GeminiApiKeyInput, SocialLinks };
