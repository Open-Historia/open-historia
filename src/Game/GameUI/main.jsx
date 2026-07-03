/*! Open Historia — portions (mobile HUD wiring + advisor/forces launchers) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { SettingsButton, SettingsMenu } from "./settings";
import { LibraryTopBar, TOP_BAR_OFFSET, openLibraryTab } from "./libraryBar";
import { useLibraryState } from "../../runtime/library.js";
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
const LazyCheatsPanel = lazy(() =>
  import("./cheats").then((module) => ({ default: module.CheatsPanel })),
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

// Fullscreen gate shown when the library has NO games: the map and HUD stay
// hidden behind it, and the player is walked into starting a game from a
// scenario (or grabbing new scenarios from the Community tab) instead of
// staring at a spectator world they aren't playing in. The top bar and its
// panels render above the gate, so the normal New Game flow works on top.
const NoGameGate = () => {
  useEffect(() => {
    // Land the player straight in the scenario list.
    openLibraryTab("scenarios");
  }, []);

  const gateButtonStyle = {
    alignItems: "center",
    background: "rgba(124,58,237,0.3)",
    border: "1px solid rgba(139,92,246,0.55)",
    borderRadius: "12px",
    color: "white",
    cursor: "pointer",
    display: "flex",
    fontSize: "0.95rem",
    fontWeight: 700,
    gap: "0.5rem",
    justifyContent: "center",
    padding: "0.85rem 1.4rem",
  };

  return (
    <div
      style={{
        alignItems: "center",
        background: "#0b1020",
        color: "white",
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif",
        inset: 0,
        justifyContent: "center",
        position: "fixed",
        textAlign: "center",
        zIndex: 10010,
      }}
    >
      <img alt="" src="/logo.png" style={{ height: "5rem", marginBottom: "1.2rem", opacity: 0.9, width: "5rem" }} />
      <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>No game yet</div>
      <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.95rem", lineHeight: 1.6, margin: "0.6rem 0 1.6rem", maxWidth: "26rem", padding: "0 1rem" }}>
        Start a new game from one of your scenarios, or grab new scenarios
        from the community first.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem", justifyContent: "center", padding: "0 1rem" }}>
        <button type="button" style={gateButtonStyle} onClick={() => openLibraryTab("scenarios")}>
          Start from a scenario
        </button>
        <button
          type="button"
          style={{ ...gateButtonStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)" }}
          onClick={() => openLibraryTab("community")}
        >
          Browse community scenarios
        </button>
      </div>
    </div>
  );
};

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
  const [isCheatsOpen, setIsCheatsOpen] = useState(false);
  const [shouldLoadCheats, setShouldLoadCheats] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [isForcesOpen, setIsForcesOpen] = useState(false);
  const [activeBottomPanel, setActiveBottomPanel] = useState(null);
  const [shouldLoadAdvisor, setShouldLoadAdvisor] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [showWebGLWarning, setShowWebGLWarning] = useState(false);

  const [apiProvider, setApiProvider] = useState(() => getStoredProvider());
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettingsFormState());
  const { games, loaded } = useLibraryState();
  // No games -> the map is hidden behind a start gate (see NoGameGate).
  const showNoGameGate = loaded && (games?.length ?? 0) === 0;

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
      {showNoGameGate && <NoGameGate />}
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
        {shouldLoadAdvisor && (
          <LazyAdvisorPanel isAdvisorOpen={isAdvisorOpen} onClose={() => setIsAdvisorOpen(false)} />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {shouldLoadCheats && (
          <LazyCheatsPanel open={isCheatsOpen} onClose={() => setIsCheatsOpen(false)} />
        )}
      </Suspense>
      <SettingsButton
        topOffset={TOP_BAR_OFFSET}
        onToggle={() => setIsSettingsOpen(!isSettingsOpen)}
      />
      {isSettingsOpen && (
        <SettingsMenu
          discordUrl="https://discord.gg/C3AVwHacZ4"
          githubUrl="https://github.com/Tommi-K/open-historia"
          onOpenCheats={() => {
            setShouldLoadCheats(true);
            setIsCheatsOpen(true);
            setIsSettingsOpen(false);
          }}
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
