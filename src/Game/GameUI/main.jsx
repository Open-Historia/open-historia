/*! Open Historia — portions (mobile HUD wiring + advisor/forces launchers) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { SettingsButton, SettingsMenu } from "./settings";
import { LibraryTopBar, TOP_BAR_OFFSET, openLibraryTab } from "./libraryBar";
import { useLibraryState } from "../../runtime/library.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { DateWidget } from "./time";
import { Other } from "./other";
import { Toolbar } from "./chat";
import { Search } from "./search";
import { ForcesPanel } from "./forces";
import { reportPerfOperation } from "../../runtime/assets.js";
import {
  getStoredProvider,
  loadProviderSettingsFormState,
  normalizeProvider,
  persistProviderSetting,
} from "../AI/providerConfig.js";

// The advisor drawer is user-resizable — drag its left edge (see advisor.jsx).
// Width is kept in px so the drag maps 1:1 to the pointer, persisted in
// localStorage, and clamped to a readable min and the current viewport.
const ADVISOR_MIN_WIDTH = 280;
const ADVISOR_DEFAULT_WIDTH = 344; // 20rem, the old fixed width
const clampAdvisorWidth = (px) => {
  const max = (typeof window !== "undefined" ? window.innerWidth : 1280) - 16;
  return Math.round(Math.min(Math.max(px, Math.min(ADVISOR_MIN_WIDTH, max)), max));
};
const readAdvisorWidth = () => {
  try {
    const saved = Number(localStorage.getItem("oh-advisor-width"));
    if (Number.isFinite(saved) && saved > 0) return clampAdvisorWidth(saved);
  } catch { /* private-mode storage — fall through to default */ }
  return clampAdvisorWidth(ADVISOR_DEFAULT_WIDTH);
};
const reportReactRender = (id, phase, actualDuration) => {
  reportPerfOperation(
    `React ${id} ${phase}`,
    Number(actualDuration) || 0,
    { warnAt: 40 },
  );
};

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

const AdvisorDockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
    <path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3" />
  </svg>
);

const AdvisorButton = ({ isAdvisorOpen, onToggle, embedded = false }) => (
  <button
    type="button"
    onClick={onToggle}
    title="Advisor"
    className={embedded ? `oh-dock-segment${isAdvisorOpen ? " oh-dock-segment-active" : ""}` : undefined}
    style={embedded ? {
      gap: "0.42rem",
      minWidth: "5.65rem",
      padding: "0 0.68rem",
    } : {
      ...baseStyle,
      bottom: "0.5rem",
      right: "0.5rem",
      height: "4rem",
      width: "4rem",
      cursor: "pointer",
      fontSize: "1.5rem",
    }}
  >
    <AdvisorDockIcon />
    {embedded && <span className="oh-dock-label-optional oh-dock-navigation-label">Advisor</span>}
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
  const [isCheatsOpen, setIsCheatsOpen] = useState(false);
  const [shouldLoadCheats, setShouldLoadCheats] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [advisorWidth, setAdvisorWidth] = useState(readAdvisorWidth);
  const [isForcesOpen, setIsForcesOpen] = useState(false);
  const [activeBottomPanel, setActiveBottomPanel] = useState(null);
  const [shouldLoadAdvisor, setShouldLoadAdvisor] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [showWebGLWarning, setShowWebGLWarning] = useState(false);

  const [apiProvider, setApiProvider] = useState(() => getStoredProvider());
  const [providerSettings, setProviderSettings] = useState(() => loadProviderSettingsFormState());
  const { activeGame, games, loaded, runtimeScenario } = useLibraryState();
  const activeCountryName = useCountryDisplayName(activeGame?.country || "");
  // No games -> nothing to simulate (the main menu covers the empty world).
  const hasNoGames = loaded && (games?.length ?? 0) === 0;

  useEffect(() => {
    if (!checkWebGL()) setShowWebGLWarning(true);
  }, []);

  // R5.0: keep heavy Advisor/Cheats dependency trees genuinely lazy. Browsing the
  // map must never suddenly compile Chart.js + gameplay.js just because an idle
  // timeout happened to fire while the player was dragging.

  // R5.0 removes the temporary global rAF/pointer performance watchdog from the
  // normal gameplay path. The map now profiles drag frames only while a drag is
  // actually active, rather than running another callback every rendered frame.

  // Idle diplomacy drip: each real-world minute the game is open (and has a
  // running game), there is a small chance a polity messages the player's
  // inbox unprompted. Everything that could break it is guarded inside
  // maybeSendIdleDiplomacy — it skips entirely while a time skip, game-master
  // command, or catalyst stage is in flight, never overlaps itself, and stays
  // silent on any failure. Hidden tabs don't roll the dice.
  useEffect(() => {
    if (hasNoGames) return undefined;
    let idleHandle = null;
    const run = () => {
      idleHandle = null;
      if (document.visibilityState !== "visible" || window.__OH_MAP_MOVING__) return;
      import("../AI/gameplay.js")
        .then(({ maybeSendIdleDiplomacy }) => maybeSendIdleDiplomacy())
        .catch(() => {});
    };
    const iv = setInterval(() => {
      if (document.visibilityState !== "visible" || window.__OH_MAP_MOVING__) return;
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(run, { timeout: 10000 });
      } else {
        idleHandle = window.setTimeout(run, 750);
      }
    }, 60000);
    return () => {
      clearInterval(iv);
      if (idleHandle != null) {
        window.cancelIdleCallback?.(idleHandle);
        window.clearTimeout?.(idleHandle);
      }
    };
  }, [hasNoGames]);

  // Spy reports follow the same idle lane as diplomacy. The once-a-minute tick
  // only schedules the roll; actual work waits until the tab is visible and the
  // map is not moving, so a lucky spy roll cannot randomly mug a drag frame.
  // Time skips also refresh every deployed spy explicitly.
  useEffect(() => {
    if (hasNoGames) return undefined;
    let idleHandle = null;
    const run = () => {
      idleHandle = null;
      if (document.visibilityState !== "visible" || window.__OH_MAP_MOVING__) return;
      import("../AI/gameplay.js")
        .then(({ maybeGatherIntelligence }) => maybeGatherIntelligence())
        .catch(() => {});
    };
    const iv = setInterval(() => {
      if (document.visibilityState !== "visible" || window.__OH_MAP_MOVING__) return;
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(run, { timeout: 10000 });
      } else {
        idleHandle = window.setTimeout(run, 750);
      }
    }, 60000);
    return () => {
      clearInterval(iv);
      if (idleHandle != null) {
        window.cancelIdleCallback?.(idleHandle);
        window.clearTimeout?.(idleHandle);
      }
    };
  }, [hasNoGames]);

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
    // Mobile Safari (iOS/iPad) exposes the Fullscreen API webkit-prefixed, and
    // iPhone Safari doesn't support element fullscreen at all — so probe for the
    // right methods and never call an undefined one (which threw before, so the
    // button silently failed on mobile).
    const el = document.documentElement;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      if (shouldBeFull) {
        if (!fsElement && request) {
          const result = request.call(el);
          if (result && typeof result.catch === "function") {
            result.catch((error) => console.error("Error with fullscreen", error));
          }
        }
      } else if (fsElement && exit) {
        exit.call(document);
      }
    } catch (error) {
      console.error("Error with fullscreen", error);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreenEnabled(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const openAdvisor = useCallback(() => {
    setActiveBottomPanel(null);
    setIsAdvisorOpen(true);
  }, []);
  const closeAdvisor = useCallback(() => setIsAdvisorOpen(false), []);
  const toggleAdvisor = useCallback(() => {
    setIsAdvisorOpen((open) => {
      const next = !open;
      if (next) setActiveBottomPanel(null);
      return next;
    });
  }, []);
  const toggleForces = useCallback(() => setIsForcesOpen((open) => !open), []);
  const closeCheats = useCallback(() => setIsCheatsOpen(false), []);
  const openForcesFromCheats = useCallback(() => {
    setIsCheatsOpen(false);
    setIsForcesOpen(true);
  }, []);

  // Called on every pointermove while the user drags the advisor's edge.
  const handleAdvisorResize = useCallback((px) => {
    setAdvisorWidth(() => {
      const w = clampAdvisorWidth(px);
      try { localStorage.setItem("oh-advisor-width", String(w)); } catch { /* ignore */ }
      return w;
    });
  }, []);

  // Keep the saved width valid if the window shrinks below it.
  useEffect(() => {
    const onResize = () => setAdvisorWidth((w) => clampAdvisorWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const rightShift = isAdvisorOpen ? `calc(${advisorWidth}px + 0.5rem)` : "0.5rem";
  const setGameplayPanel = useCallback((panelName) => {
    if (panelName) setIsAdvisorOpen(false);
    setActiveBottomPanel(panelName);
  }, []);
  const toggleBottomPanel = useCallback((panelName) => {
    setIsAdvisorOpen(false);
    setActiveBottomPanel((currentPanel) => (
      currentPanel === panelName ? null : panelName
    ));
  }, []);

  return (
    <React.Profiler id="MainUI" onRender={reportReactRender}>
    <>
      {showWebGLWarning && <WebGLWarningPopup />}
      <React.Profiler id="LibraryTopBar" onRender={reportReactRender}>
      <LibraryTopBar />
      </React.Profiler>
      <React.Profiler id="DateWidget" onRender={reportReactRender}>
      <DateWidget
        activePanel={activeBottomPanel}
        mapRef={mapRef}
        onSetPanel={setGameplayPanel}
        onTogglePanel={toggleBottomPanel}
        rightShift={rightShift}
        topOffset={TOP_BAR_OFFSET}
        dockLeading={(
          <React.Profiler id="OtherBadge" onRender={reportReactRender}>
            <Other embedded />
          </React.Profiler>
        )}
        dockMiddle={(
          <>
            <React.Profiler id="Toolbar" onRender={reportReactRender}>
              <Toolbar
                embedded
                onOpenAdvisor={openAdvisor}
                activePanel={activeBottomPanel}
                onTogglePanel={toggleBottomPanel}
              />
            </React.Profiler>
            <div className="oh-dock-divider" />
            <AdvisorButton
              embedded
              isAdvisorOpen={isAdvisorOpen}
              onToggle={toggleAdvisor}
            />
          </>
        )}
      />
      </React.Profiler>
      <React.Profiler id="Search" onRender={reportReactRender}>
      <Search mapRef={mapRef} placement="top-right" />
      </React.Profiler>
      <React.Profiler id="ForcesPanel" onRender={reportReactRender}>
      <ForcesPanel
        mapRef={mapRef}
        topOffset={TOP_BAR_OFFSET}
        open={isForcesOpen}
        onToggle={toggleForces}
      />
      </React.Profiler>
      <React.Profiler id="AdvisorPanel" onRender={reportReactRender}>
      <Suspense fallback={null}>
        {shouldLoadAdvisor && (
          <LazyAdvisorPanel isAdvisorOpen={isAdvisorOpen} onClose={closeAdvisor} width={advisorWidth} onResize={handleAdvisorResize} />
        )}
      </Suspense>
      </React.Profiler>
      <React.Profiler id="CheatsPanel" onRender={reportReactRender}>
      <Suspense fallback={null}>
        {shouldLoadCheats && (
          <LazyCheatsPanel open={isCheatsOpen} onClose={closeCheats} onOpenForces={openForcesFromCheats} />
        )}
      </Suspense>
      </React.Profiler>
      <SettingsButton
        topOffset={TOP_BAR_OFFSET}
        onToggle={() => setIsSettingsOpen(!isSettingsOpen)}
      />
      {isSettingsOpen && (
        <React.Profiler id="SettingsMenu" onRender={reportReactRender}>
        <SettingsMenu
          discordUrl="https://discord.gg/QaqAK7fQAg"
          redditUrl="https://www.reddit.com/r/OpenHistoria"
          githubUrl="https://github.com/Open-Historia/open-historia"
          reportBugUrl="https://github.com/Open-Historia/open-historia/issues/new"
          context={{
            gameName: activeGame?.name || "",
            scenarioName: runtimeScenario?.name || "",
            countryName: activeCountryName || activeGame?.country || "",
            date: activeGame?.currentDate || "",
          }}
          onClose={() => setIsSettingsOpen(false)}
          onOpenGameManagement={() => openLibraryTab("games")}
          onOpenEvents={() => setGameplayPanel("history")}
          onOpenCheats={() => {
            setShouldLoadCheats(true);
            setIsCheatsOpen(true);
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
        </React.Profiler>
      )}
    </>
    </React.Profiler>
  );
};

export default Main;
