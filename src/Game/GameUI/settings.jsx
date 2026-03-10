import React from "react";

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
    }}
    />
    </button>
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
}) => (
    <div
    style={{
        ...baseStyle,
        top: "5rem",
        left: "0.5rem",
        width: "15rem",
        padding: "1rem",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        height: "auto",
    }}
    >
    <h3 style={{ margin: "0 0 1.25rem 0", fontSize: "1.1rem", textAlign: "left" }}>
    Map Settings
    </h3>
    <Toggle label="Fullscreen" enabled={isFullscreenEnabled} onToggle={onToggleFullscreen} />
    <Toggle label="3D Globe" enabled={isGlobeEnabled} onToggle={onToggleGlobe} />
    <Toggle label="3D Terrain" enabled={isTerrainEnabled} onToggle={onToggleTerrain} />
    </div>
);

export { Toggle, SettingsButton, SettingsMenu };
