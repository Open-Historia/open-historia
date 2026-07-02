import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { SettingsButton, SettingsMenu } from "./settings";
import { LibraryTopBar, TOP_BAR_OFFSET } from "./libraryBar";
import { DateWidget } from "./time";
import { Other } from "./other";
import { Toolbar } from "./chat";
import { Search } from "./search";
import { ForcesPanel } from "./forces";
import {
  getStoredProvider,
  loadProviderSettingsFormState,
  normalizeProvider,
  persistProviderSetting,
} from "../AI/providerConfig.js";

const ADVISOR_PANEL_WIDTH = "min(20rem, calc(100vw - 1rem))";
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
        ⚠️
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

const AdvisorButton = ({ isAdvisorOpen, rightShift, onToggle }) => (
  <button onClick={onToggle} style={{
    ...baseStyle,
    bottom: "0.5rem", right: rightShift,
    height: "4rem", width: "4rem",
    cursor: "pointer", fontSize: "1.5rem",
    transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
  }}>🧭</button>
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
  const [isForcesOpen, setIsForcesOpen] = useState(false);
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
      <LibraryTopBar />
      <DateWidget
        activePanel={activeBottomPanel}
        mapRef={mapRef}
        onSetPanel={setActiveBottomPanel}
        onTogglePanel={toggleBottomPanel}
        rightShift={rightShift}
        topOffset={TOP_BAR_OFFSET}
      />
      <Toolbar
        onOpenAdvisor={openAdvisor}
        activePanel={activeBottomPanel}
        onTogglePanel={toggleBottomPanel}
        forcesOpen={isForcesOpen}
        onToggleForces={() => setIsForcesOpen((v) => !v)}
      />
      <Other topOffset={TOP_BAR_OFFSET} />
      <Search mapRef={mapRef} />
      <ForcesPanel
        mapRef={mapRef}
        topOffset={TOP_BAR_OFFSET}
        open={isForcesOpen}
        onToggle={() => setIsForcesOpen((v) => !v)}
      />
      <AdvisorButton
        isAdvisorOpen={isAdvisorOpen}
        rightShift={rightShift}
        onToggle={() => setIsAdvisorOpen(!isAdvisorOpen)}
      />
      <Suspense fallback={null}>
        {shouldLoadAdvisor && <LazyAdvisorPanel isAdvisorOpen={isAdvisorOpen} />}
      </Suspense>
      <SettingsButton
        topOffset={TOP_BAR_OFFSET}
        onToggle={() => setIsSettingsOpen(!isSettingsOpen)}
      />
      {isSettingsOpen && (
        <SettingsMenu
          discordUrl="https://discord.gg/C3AVwHacZ4"
          githubUrl="https://github.com/Tommi-K/pax-historia"
          topOffset={TOP_BAR_OFFSET}
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
