import React, { useState, useEffect } from "react";
import { ADVISOR_PANEL_WIDTH, AdvisorButton, AdvisorPanel } from "./advisor";
import { SettingsButton, SettingsMenu } from "./settings";
import { DateWidget, Other } from "./other";
import { Search } from "./search";

const Main = ({ mapRef }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => {
    return localStorage.getItem("gemini_api_key") || "";
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

  useEffect(() => {
    localStorage.setItem("gemini_api_key", geminiKey);
  }, [geminiKey]);

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
    const handleFullscreenChange = () => {
      setIsFullscreenEnabled(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const rightShift = isAdvisorOpen ? `calc(${ADVISOR_PANEL_WIDTH} + 0.5rem)` : "0.5rem";

  return (
    <>
    <DateWidget rightShift={rightShift} />
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
      geminiKey={geminiKey}
      onGeminiKeyChange={setGeminiKey}
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
      />
    )}
    </>
  );
};

export default Main;
