import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { SettingsButton, SettingsMenu } from "./settings";
import { DateWidget } from "./time";
import { Other } from "./other";
import { Toolbar } from "./chat";
import { Search } from "./search";
import {
  getStoredProvider,
  loadProviderSettingsFormState,
  normalizeProvider,
  persistProviderSetting,
} from "../AI/providerConfig.js";

const ADVISOR_PANEL_WIDTH = "20rem";
const LazyAdvisorPanel = lazy(() =>
  import("./advisor").then((module) => ({ default: module.AdvisorPanel })),
);

const checkWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
};

const WarningIcon = () => (
  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3.5 20 18a1 1 0 0 1-.88 1.5H4.88A1 1 0 0 1 4 18l8-14.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="M12 9v4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="16.8" r="1" fill="currentColor" />
  </svg>
);

const AdvisorIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3.5a7.5 7.5 0 0 0-4.56 13.45c.42.32.68.82.73 1.35l.05.7h7.56l.05-.7c.05-.53.31-1.03.73-1.35A7.5 7.5 0 0 0 12 3.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 15c.52-.76 1.36-1.2 2.5-1.2s1.98.44 2.5 1.2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <circle cx="9.25" cy="10.25" r="1" fill="currentColor" />
    <circle cx="14.75" cy="10.25" r="1" fill="currentColor" />
    <path
      d="M10 21h4M10.7 18.9l.25 1.1m2.1-1.1-.25 1.1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const WebGLWarningPopup = () => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    }}
  >
    <div
      style={{
        backgroundColor: "#1a1a2e",
        border: "1px solid #e94560",
        borderRadius: "12px",
        padding: "2rem",
        maxWidth: "420px",
        width: "90%",
        color: "#eaeaea",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "3rem",
          marginBottom: "0.75rem",
          color: "#e94560",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <WarningIcon />
      </div>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.3rem", color: "#e94560" }}>
        WebGL Not Available
      </h2>
      <p style={{ margin: "0 0 0.5rem", lineHeight: 1.6, color: "#ccc", fontSize: "0.95rem" }}>
        This application requires <strong style={{ color: "#eaeaea" }}>WebGL</strong> to render
        the map, but it doesn't appear to be supported or enabled in your browser.
      </p>
      <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, color: "#999", fontSize: "0.85rem" }}>
        Try enabling hardware acceleration in your browser settings, updating your graphics
        drivers, or switching to a WebGL-supported browser such as Chrome or Firefox.
      </p>
    </div>
  </div>
);

const AdvisorButton = ({ isAdvisorOpen, onToggle, rightShift }) => (
  <button
    onClick={onToggle}
    title="Advisor"
    style={{
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
      border: isAdvisorOpen
        ? "1px solid rgba(96, 165, 250, 0.4)"
        : "1px solid rgba(255,255,255,0.1)",
      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
      bottom: "0.5rem",
      right: rightShift,
      height: "4rem",
      width: "4rem",
      cursor: "pointer",
      transition:
        "right 0.35s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease, background-color 0.2s ease",
    }}
  >
    <AdvisorIcon />
  </button>
);

const Main = ({
  mapRef,
  isGlobeEnabled,
  isTerrainEnabled,
  setIsGlobeEnabled,
  setIsTerrainEnabled,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [activeBottomPanel, setActiveBottomPanel] = useState(null);
  const [shouldLoadAdvisor, setShouldLoadAdvisor] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [showWebGLWarning, setShowWebGLWarning] = useState(false);

  const [apiProvider, setApiProvider] = useState(() => getStoredProvider());
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettingsFormState());

  useEffect(() => {
    if (!checkWebGL()) setShowWebGLWarning(true);
  }, []);

  useEffect(() => {
    if (isAdvisorOpen) setShouldLoadAdvisor(true);
  }, [isAdvisorOpen]);

  useEffect(() => {
    localStorage.setItem("Fullscreen", JSON.stringify(isFullscreenEnabled));
  }, [isFullscreenEnabled]);

  useEffect(() => {
    localStorage.setItem("api_provider", normalizeProvider(apiProvider));
  }, [apiProvider]);

  useEffect(() => {
    if (isSettingsOpen) {
      setApiProvider(getStoredProvider());
      setProviderSettings(loadProviderSettingsFormState());
    }
  }, [isSettingsOpen]);

  const handleProviderSettingChange = (key, value) => {
    setProviderSettings((prev) => ({ ...prev, [key]: value }));
    persistProviderSetting(key, value);
  };

  const toggleFullscreen = (shouldBeFull) => {
    if (shouldBeFull) {
      if (!document.fullscreenElement) {
        document.documentElement
          .requestFullscreen()
          .catch((error) => console.error("Error with fullscreen", error));
      }
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreenEnabled(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const openAdvisor = useCallback(() => {
    setIsAdvisorOpen(true);
  }, []);

  const rightShift = isAdvisorOpen ? `calc(${ADVISOR_PANEL_WIDTH} + 0.5rem)` : "0.5rem";
  const toggleBottomPanel = useCallback((panelName) => {
    setActiveBottomPanel((currentPanel) => (
      currentPanel === panelName ? null : panelName
    ));
  }, []);

  return (
    <>
      {showWebGLWarning && <WebGLWarningPopup />}
      <DateWidget
        rightShift={rightShift}
        isTimelineOpen={activeBottomPanel === "timeline"}
        onToggleTimeline={() => toggleBottomPanel("timeline")}
        onCloseTimeline={() => setActiveBottomPanel((panel) => (panel === "timeline" ? null : panel))}
      />
      <Toolbar
        onOpenAdvisor={openAdvisor}
        activePanel={activeBottomPanel}
        onTogglePanel={toggleBottomPanel}
      />
      <Other />
      <Search mapRef={mapRef} />
      <AdvisorButton
        isAdvisorOpen={isAdvisorOpen}
        rightShift={rightShift}
        onToggle={() => setIsAdvisorOpen(!isAdvisorOpen)}
      />
      <Suspense fallback={null}>
        {shouldLoadAdvisor && <LazyAdvisorPanel isAdvisorOpen={isAdvisorOpen} />}
      </Suspense>
      <SettingsButton onToggle={() => setIsSettingsOpen(!isSettingsOpen)} />
      {isSettingsOpen && (
        <SettingsMenu
          discordUrl="https://discord.gg/C3AVwHacZ4"
          githubUrl="https://github.com/Tommi-K/pax-historia"
          isFullscreenEnabled={isFullscreenEnabled}
          isGlobeEnabled={isGlobeEnabled}
          isTerrainEnabled={isTerrainEnabled}
          onToggleFullscreen={() => {
            const newState = !isFullscreenEnabled;
            setIsFullscreenEnabled(newState);
            toggleFullscreen(newState);
          }}
          onToggleGlobe={() => setIsGlobeEnabled(!isGlobeEnabled)}
          onToggleTerrain={() => setIsTerrainEnabled(!isTerrainEnabled)}
          apiProvider={apiProvider}
          onApiProviderChange={setApiProvider}
          providerSettings={providerSettings}
          onProviderSettingChange={handleProviderSettingChange}
        />
      )}
    </>
  );
};

export default Main;
