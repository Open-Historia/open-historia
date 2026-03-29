import React, { useState, useEffect } from "react";
import { ADVISOR_PANEL_WIDTH, AdvisorButton, AdvisorPanel } from "./advisor";
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

const WebGLWarningPopup = ({ onDismiss }) => (
  <div style={{
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              zIndex: 9999,
  }}>
  <div style={{
    backgroundColor: "#1a1a2e",
    border: "1px solid #e94560",
    borderRadius: "12px",
    padding: "2rem",
    maxWidth: "420px",
    width: "90%",
    color: "#eaeaea",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                                              textAlign: "center",
  }}>
  <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>⚠️</div>
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

const Main = ({ mapRef }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [showWebGLWarning, setShowWebGLWarning] = useState(false);

  // API provider state
  const [apiProvider, setApiProvider] = useState(() => getStoredProvider());
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettingsFormState());

  const [isGlobeEnabled, setIsGlobeEnabled] = useState(() => {
    const saved = localStorage.getItem("Globe");
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [isTerrainEnabled, setIsTerrainEnabled] = useState(() => {
    const saved = localStorage.getItem("Terrain");
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    if (!checkWebGL()) setShowWebGLWarning(true);
  }, []);

    useEffect(() => { localStorage.setItem("Fullscreen", JSON.stringify(isFullscreenEnabled)); }, [isFullscreenEnabled]);
    useEffect(() => { localStorage.setItem("Globe", JSON.stringify(isGlobeEnabled)); }, [isGlobeEnabled]);
    useEffect(() => { localStorage.setItem("Terrain", JSON.stringify(isTerrainEnabled)); }, [isTerrainEnabled]);
    useEffect(() => { localStorage.setItem("api_provider", normalizeProvider(apiProvider)); }, [apiProvider]);
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
          .catch((e) => console.error("Error with fullscreen", e));
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    };

    useEffect(() => {
      const handleFullscreenChange = () => setIsFullscreenEnabled(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", handleFullscreenChange);
      return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    const rightShift = isAdvisorOpen ? `calc(${ADVISOR_PANEL_WIDTH} + 0.5rem)` : "0.5rem";

    return (
      <>
      {showWebGLWarning && <WebGLWarningPopup />}
      <DateWidget rightShift={rightShift} />
      <Toolbar onOpenAdvisor={() => setIsAdvisorOpen(true)} />
      <Other />
      <Search mapRef={mapRef} rightShift={rightShift} />
      <AdvisorButton
      isAdvisorOpen={isAdvisorOpen}
      rightShift={rightShift}
      onToggle={() => setIsAdvisorOpen(!isAdvisorOpen)}
      />
      <AdvisorPanel isAdvisorOpen={isAdvisorOpen} />
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
