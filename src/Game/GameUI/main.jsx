import React, { useState, useEffect } from "react";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";

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

dayjs.extend(advancedFormat);

const Main = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(() => {
    return false;
  });

  const [isGlobeEnabled, setIsGlobeEnabled] = useState(() => {
    const saved = localStorage.getItem("Globe");
    return saved !== null ? JSON.parse(saved) : false;
  });

  const [isTerrainEnabled, setIsTerrainEnabled] = useState(() => {
    const saved = localStorage.getItem("Terrain");
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem("Fullscreen", JSON.stringify(isFullscreenEnabled));
  }, [isFullscreenEnabled]);

  useEffect(() => {
    localStorage.setItem("Globe", JSON.stringify(isGlobeEnabled));
  }, [isGlobeEnabled]);

  useEffect(() => {
    localStorage.setItem("Terrain", JSON.stringify(isTerrainEnabled));
  }, [isTerrainEnabled]);

  // FULLSCREEN FUNCTION
  const toggleFullscreen = (shouldBeFull) => {
    if (shouldBeFull) {
      if (!document.fullscreenElement) {
        document.documentElement
          .requestFullscreen()
          .catch((e) =>
            console.error("Error with fullscreen", e),
          );
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  return (
    <>
      {/* Date */}
      <div
        style={{
          ...baseStyle,
          top: "0.5rem",
          right: "0.5rem",
          height: "4rem",
          width: "18rem",
        }}
      >
        {dayjs().format("MMMM Do, YYYY")}
      </div>

      {/* Time */}
      <div
        style={{
          ...baseStyle,
          bottom: "0.5rem",
          left: "0.5rem",
          height: "4rem",
          width: "8.75rem",
        }}
      />

      {/* Advisor */}
      <button
        style={{
          ...baseStyle,
          bottom: "0.5rem",
          right: "0.5rem",
          height: "4rem",
          width: "4rem",
          cursor: "pointer",
        }}
      />

      {/* Settings */}
      <button
        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
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

      {/* Settings Menu */}
      {isSettingsOpen && (
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
          <h3
            style={{
              margin: "0 0 1.25rem 0",
              fontSize: "1.1rem",
              textAlign: "left",
            }}
          >
            Map Settings
          </h3>

          <Toggle
            label="Fullscreen"
            enabled={isFullscreenEnabled}
            onToggle={() => {
              const newState = !isFullscreenEnabled;
              setIsFullscreenEnabled(newState);
              toggleFullscreen(newState);
            }}
          />

          <Toggle
            label="3D Globe"
            enabled={isGlobeEnabled}
            onToggle={() => setIsGlobeEnabled(!isGlobeEnabled)}
          />

          <Toggle
            label="3D Terrain"
            enabled={isTerrainEnabled}
            onToggle={() => setIsTerrainEnabled(!isTerrainEnabled)}
          />
        </div>
      )}
    </>
  );
};

export default Main;
