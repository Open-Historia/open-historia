/*! Open Historia — portions (mobile HUD wiring + advisor/forces launchers) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GenerationRatingToast } from "./generationRatingToast.jsx";
import { SettingsButton, SettingsMenu } from "./settings";
import { Presence } from "./presence.jsx";
import { LibraryTopBar, TOP_BAR_OFFSET, openLibraryTab, useMainMenuOpen } from "./libraryBar";
import { ApiSetupPrompt } from "./apiSetupPrompt.jsx";
import { GameLoadingScreen, LOADING_CEILING_MS, useGameLoading } from "./gameLoadingScreen.jsx";
import { setOpenGameCountry, useLibraryState } from "../../runtime/library.js";
import { playerAtWar } from "../../runtime/playerAtWar.js";
import { enterGame, useGameEntered } from "../../runtime/gameEntry.js";
import { useActiveFeatures, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { brushedMetalUrl } from "./brushedMetal.js";
import { playerFrontsKey } from "./warRoomData.js";
import { presenceFor, useDiscordPresence } from "../../runtime/discordPresence.js";
import { musicSceneOf, setMusicScene } from "../../runtime/ambientMusic.js";
import { followScenarioMusic } from "../../runtime/scenarioMusic.js";
import { useWarRoom } from "../Map/warRoomStore.js";
import { DISCORD_URL, GITHUB_URL, REDDIT_URL } from "../../runtime/communityLinks.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { DateWidget } from "./time";
import { Other } from "./other";
import { Toolbar } from "./chat";
import MapModeSelector from "./MapModeSelector.jsx";
import { Search } from "./search";
import { ForcesPanel } from "./forces";
import { ADVISOR_SLIDE } from "./advisorSlide.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { MAP_CARD_OPENED, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT } from "../../runtime/mobileUi.js";
import { BESIDE_DOCK_LEFT, DOCK_BOTTOM_REM, DOCK_HEIGHT_REM, DOCK_LEFT_REM, WAR_ROOM_BUTTON_REM } from "./hudDock.js";
import { showEveryTroop } from "../Map/troopDetail.js";
import { dismissRegionPopup } from "../Selection/Regions.jsx";
import { dismissUnitPopup } from "../Selection/Units.jsx";
import { dismissFeaturePopup } from "../Selection/Features.jsx";
import { OPEN_COUNTRY_STATS_EVENT, openCountryPanel } from "../Selection/CountryPanel.jsx";
import { logDebugEvent, logSettingChange } from "../../runtime/debugLog.js";
import {
  describeProviderSetupNeed,
  getProviderMeta,
  getResolvedFallbackList,
  isFallbackListConfigured,
  syncAiDebugContext,
} from "../AI/providerConfig.js";
import { FallbackSwitchNotice } from "./fallbackSwitchNotice.jsx";
import { AgentWaitingNotice } from "./agentWaitingNotice.jsx";
import { BordersFallbackNotice } from "./bordersFallbackNotice.jsx";
import { WarAndPeaceCards } from "./warAndPeace.jsx";
import { PLAYER_ACTIVITY_EVENTS, createPlayerActivity } from "../../runtime/playerActivity.js";
import { inSharedGame, sharedGameRole, subscribeSharedGameRole } from "../../multiplayer/client/sharedGameBridge.js";

// Whether anything in the Fallback list has what its provider needs, and the
// top entry's provider for the start-of-game prompt's wording. Re-read whenever
// the list or a Connection changes (providerConfig.js announces it).
const readAiSetup = () => {
  const [top] = getResolvedFallbackList();
  return { ready: isFallbackListConfigured(), provider: top?.provider ?? "gemini" };
};

// The advisor drawer is user-resizable — drag its left edge (see advisor.jsx).
// Width is kept in px so the drag maps 1:1 to the pointer, persisted in
// localStorage, and clamped to a readable min and a max that keeps the HUD
// in view.
const ADVISOR_WIDTH_VAR = "--oh-advisor-width";
const RIGHT_DRAWER_SAFE_OFFSET_VAR = "--oh-right-drawer-safe-offset";
const ADVISOR_MIN_WIDTH = 280;
const ADVISOR_DEFAULT_WIDTH = 320; // 20rem, the old fixed width
// The drawer may cover the map but not the HUD on its left. The tightest fit is
// the top edge: the 18rem date widget moves left with the drawer and must stop
// short of the 4rem game-menu button at 0.5rem. 0.5 + 4 + 0.5 gap + 18 + 0.5 =
// 23.5rem, which also clears the bottom-left toolbar and search button.
const ADVISOR_LEFT_CLEARANCE_REM = 23.5;
const clampAdvisorWidth = (px) => {
  const viewport = typeof window !== "undefined" ? window.innerWidth : 1280;
  const rem = typeof document !== "undefined"
    ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    : 16;
  // A window too narrow to leave that room (a phone) still gets the default width.
  const max = Math.max(
    viewport - ADVISOR_LEFT_CLEARANCE_REM * rem,
    Math.min(ADVISOR_DEFAULT_WIDTH, viewport - 16),
  );
  return Math.round(Math.min(Math.max(px, Math.min(ADVISOR_MIN_WIDTH, max)), max));
};
const readAdvisorWidth = () => {
  try {
    const saved = Number(localStorage.getItem("oh-advisor-width"));
    if (Number.isFinite(saved) && saved > 0) return clampAdvisorWidth(saved);
  } catch { /* private-mode storage — fall through to default */ }
  return clampAdvisorWidth(ADVISOR_DEFAULT_WIDTH);
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
const LazyCountryPanel = lazy(() =>
  import("./countryPanel.jsx").then((module) => ({ default: module.CountryPanel })),
);
// The war room (warRoom.jsx): nothing of it loads until there is a war and the
// player opens it.
// A war's after-action report, put before the player once a battlefield of theirs closes (afterAction.jsx).
const LazyAfterActionReports = lazy(() =>
  import("./afterAction.jsx").then((module) => ({ default: module.AfterActionReports })),
);
const LazyWarRoomPanel = lazy(() =>
  import("./warRoom.jsx").then((module) => ({ default: module.WarRoomPanel })),
);
const LazyCheatsPanel = lazy(() =>
  import("./cheats").then((module) => ({ default: module.CheatsPanel })),
);
// The AI debug console (telemetry review) is a lazy chunk like the cheats
// panel: most sessions never open it.
const LazyDebugConsole = lazy(() =>
  import("./debugConsole.jsx").then((module) => ({ default: module.DebugConsole })),
);
// Interactive events (interactive.jsx): nothing of them loads until the player takes one up.
const LazyInteractivePanel = lazy(() =>
  import("./interactive.jsx").then((module) => ({ default: module.InteractivePanel })),
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
        backgroundColor: "#1a1a1e",
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
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          border: "1px solid #e94560",
          borderRadius: "8px",
          background: "#e94560",
          color: "#fff",
          padding: "0.55rem 1.2rem",
          fontSize: "0.9rem",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Reload
      </button>
    </div>
  </div>
);

// Continuance's advisor glyph, drawn like the other HUD icons.
const AdvisorDockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
    <path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3" />
  </svg>
);

const AdvisorButton = ({ isAdvisorOpen, dockStyle, onToggle }) => (
  <button
    type="button"
    title="Advisor"
    aria-label="Advisor"
    onClick={onToggle}
    style={{
      ...baseStyle,
      ...dockStyle,
      // Above the map switch at the foot of the stack (MapModeSelector.jsx).
      bottom: `calc(3rem + ${SAFE_BOTTOM})`,
      // Rides beside the advisor drawer, so a wide drawer carries it over the
      // Actions/Projects/chat panels (9998); an open panel stays on top.
      zIndex: 9997,
      height: "4rem", width: "4rem",
      cursor: "pointer", fontSize: "1.5rem",
      background: isAdvisorOpen
        ? "rgba(255,255,255,0.085)"
        : "rgba(35,35,39,0.53)",
      transition: `${dockStyle.transition}, background 0.15s ease`,
    }}
  >
    <AdvisorDockIcon />
  </button>
);

// The war room's button: a disc of red metal brushed in circles
// (brushedMetal.js), with crossed swords cut into it. It is on screen only
// while the player's troops are on a battlefield, and stands beside the
// launcher dock where Search otherwise is (Search moves over: hudDock.js). On
// a phone there is no room beside the dock, so it stands above it.
const WarRoomIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* Cut into the metal: a pale lip under each stroke, the dark of the cut over it. */}
    <g stroke="rgba(255,214,214,0.5)" strokeWidth="2.1" transform="translate(0.45 0.6)">
      <path d="M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2" />
      <path d="M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2" />
    </g>
    <g stroke="rgba(34,4,6,0.88)" strokeWidth="2.1">
      <path d="M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2" />
      <path d="M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2" />
    </g>
  </svg>
);

// How far in from the corner it stands while the war room is open: clear of the frame's strips.
const WAR_ROOM_OPEN_INSET_REM = 1.1;
const WarRoomButton = ({ open, isMobile, onToggle }) => (
  <button
    type="button"
    title="War room"
    aria-label="War room"
    aria-pressed={open}
    data-oh-war-room-button=""
    onClick={onToggle}
    style={{
      ...baseStyle,
      // While the war room is open the dock it stood beside is out of sight, so
      // it goes to the corner of the screen, inside the frame round the map.
      left: `calc(${open ? `${WAR_ROOM_OPEN_INSET_REM}rem` : isMobile ? `${DOCK_LEFT_REM}rem` : BESIDE_DOCK_LEFT} + ${SAFE_LEFT})`,
      bottom: `calc(${open ? WAR_ROOM_OPEN_INSET_REM : isMobile ? DOCK_BOTTOM_REM + DOCK_HEIGHT_REM + 0.5 : DOCK_BOTTOM_REM}rem + ${SAFE_BOTTOM})`,
      height: `${WAR_ROOM_BUTTON_REM}rem`, width: `${WAR_ROOM_BUTTON_REM}rem`,
      borderRadius: "50%",
      cursor: "pointer",
      backdropFilter: "none",
      backgroundColor: "#a8181e",
      backgroundImage: `url(${brushedMetalUrl(160)})`,
      backgroundSize: "cover",
      border: "1px solid rgba(0,0,0,0.6)",
      boxShadow: open
        ? "0 0 0 2px rgba(255,255,255,0.85), 0 3px 12px rgba(0,0,0,0.55)"
        : "0 3px 12px rgba(0,0,0,0.55)",
      transition: "left 0.3s ease, bottom 0.3s ease, box-shadow 0.15s ease",
    }}
  >
    <WarRoomIcon />
  </button>
);

// The wrapper round the HUD's own controls: nothing of its own to lay out
// while they show, and all of them gone with it while the war room is open.
const HUD_IN_SIGHT = Object.freeze({ display: "contents" });
const HUD_OUT_OF_SIGHT = Object.freeze({ display: "none" });

// The country a game's own record names, or null while there is no record yet.
const selectPlayedCountry = (game) => (game ? String(game.country ?? "").trim() : null);

const Main = ({
  mapRef,
  isGlobeEnabled,
  isTerrainEnabled,
  setIsGlobeEnabled,
  setIsTerrainEnabled,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Which workspace section the menu opens on; null is the quick menu. Set by
  // the AI setup prompt's Configure button, cleared whenever the menu closes.
  const [settingsInitialSection, setSettingsInitialSection] = useState(null);
  // The main menu's Settings are for every game; a game's ☰ adds its own.
  const [settingsScope, setSettingsScope] = useState("game");
  const [isCheatsOpen, setIsCheatsOpen] = useState(false);
  const [shouldLoadCheats, setShouldLoadCheats] = useState(false);
  const [isDebugConsoleOpen, setIsDebugConsoleOpen] = useState(false);
  const [shouldLoadDebugConsole, setShouldLoadDebugConsole] = useState(false);
  const [isInteractiveOpen, setIsInteractiveOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [isCountryOpen, setIsCountryOpen] = useState(false);
  const [isWarRoomOpen, setIsWarRoomOpen] = useState(false);
  const [shouldLoadWarRoom, setShouldLoadWarRoom] = useState(false);
  const [advisorWidth, setAdvisorWidth] = useState(readAdvisorWidth);
  // A starter message queued for the advisor's input box — set when something
  // OUTSIDE the advisor panel (the Actions panel's "Help brainstorm actions"
  // button) opens it wanting to prime the conversation, rather than opening it
  // blank. Consumed (cleared) once AdvisorPanel has placed it in its input.
  const [pendingAdvisorPrompt, setPendingAdvisorPrompt] = useState("");
  // The polity a map card's Stats button asked the Country drawer to show.
  // Consumed (cleared) once the drawer's Stats pane has taken it, so the flag
  // button still opens the drawer on the player's own country.
  const [pendingCountryTarget, setPendingCountryTarget] = useState("");
  // Stable, so the memoized StatsPane still skips this component's re-renders.
  const consumeCountryTarget = useCallback(() => setPendingCountryTarget(""), []);
  const [isForcesOpen, setIsForcesOpen] = useState(false);
  const [activeBottomPanel, setActiveBottomPanel] = useState(null);
  const [shouldLoadAdvisor, setShouldLoadAdvisor] = useState(false);
  const [shouldLoadCountry, setShouldLoadCountry] = useState(false);
  const [isFullscreenEnabled, setIsFullscreenEnabled] = useState(false);
  const [showWebGLWarning, setShowWebGLWarning] = useState(false);

  const [aiSetup, setAiSetup] = useState(readAiSetup);
  const { activeGame, games, loaded, runtimeScenario } = useLibraryState();
  // The page starts on the main menu with no game loaded behind it, and this
  // UI is what draws that menu. Until the player opens a game
  // (runtime/gameEntry.js) the library's active game is only the one last
  // played: none of the game's own controls is mounted, and nothing here reads
  // it, reports it or runs anything for it.
  const gameEntered = useGameEntered();
  // Which country the open game is played as, from the game's own record: the
  // library's list has it as it stood when the list was last read, and it
  // changes in play (the Play As Country cheat first of all). Told to the
  // library, so everything that reads the list's entry, here and elsewhere,
  // names the country the game is really played as. Null until the record is
  // read; a game with no country says so with an empty name.
  const playedCountry = useRuntimeState("game", selectPlayedCountry);
  useEffect(() => {
    if (gameEntered && activeGame?.id && playedCountry !== null) setOpenGameCountry(activeGame.id, playedCountry);
  }, [gameEntered, activeGame?.id, playedCountry]);
  // The game menu names the campaign the way the library does. (Not before a
  // game is opened: looking the name up reads the game's world and the country
  // tiles.)
  const activeCountryName = useCountryDisplayName(activeGame?.country || "", { wait: !gameEntered });
  // No games -> nothing to simulate (the main menu covers the empty world).
  const hasNoGames = loaded && (games?.length ?? 0) === 0;

  // Starting a game with nothing to call the AI with: a prompt, once per game
  // per session, offering the AI settings. It goes away the moment a key is
  // typed into the settings, because every edit announces itself.
  const mainMenuOpen = useMainMenuOpen();
  // The menu was closed to open the page's first game, and that game has not
  // landed yet (the library enters it when it has; a flow that fails opens the
  // menu again). There is no game to show under the closed menu, so the cover
  // is up from the press itself.
  const awaitingGame = !gameEntered && !mainMenuOpen;
  // And it does not stay up over nothing: should the game never land and the
  // menu never come back, the game the library holds is entered once the
  // cover's own ceiling has passed.
  useEffect(() => {
    if (!awaitingGame) return undefined;
    const timer = setTimeout(enterGame, LOADING_CEILING_MS);
    return () => clearTimeout(timer);
  }, [awaitingGame]);
  // The screen a game opens under, until the map has drawn it (this UI is
  // remounted per game, so it starts over with every game opened).
  const gameLoading = useGameLoading();
  const showGameLoading = awaitingGame || (gameLoading.active && Boolean(activeGame?.id));
  // Discord's "Playing Open Historia", with who, where and when under it
  // (runtime/discordPresence.js; the desktop app and the local server only).
  useDiscordPresence(presenceFor({
    activeGame,
    playerName: activeCountryName || activeGame?.country || "",
    scenarioName: runtimeScenario?.name || "",
    inMenu: mainMenuOpen || hasNoGames || !gameEntered,
  }));
  const providerReady = aiSetup.ready;
  const [apiPromptAnsweredFor, setApiPromptAnsweredFor] = useState(() => {
    try { return sessionStorage.getItem("oh:api-setup-answered") || ""; } catch { return ""; }
  });
  const answerApiPrompt = () => {
    const id = String(activeGame?.id || "");
    setApiPromptAnsweredFor(id);
    try { sessionStorage.setItem("oh:api-setup-answered", id); } catch { /* the prompt just shows again next time */ }
  };
  // A guest in a shared game plays on the host's key: nothing to set up.
  const sharedRole = useSyncExternalStore(subscribeSharedGameRole, sharedGameRole, sharedGameRole);
  const showApiPrompt = loaded && Boolean(activeGame?.id) && !mainMenuOpen && !providerReady
    && apiPromptAnsweredFor !== String(activeGame?.id) && !isSettingsOpen && !showGameLoading
    && sharedRole !== "guest";
  // The game master's tools are not offered in a shared game (see onOpenCheats
  // below): a panel already open when one begins closes.
  useEffect(() => {
    if (sharedRole) setIsCheatsOpen(false);
  }, [sharedRole]);

  // Asked again while the warning is up. WebGL is refused for a moment while
  // the system's graphics process is being started again (a laptop changing
  // graphics card, a driver reset, a wake from sleep), and the one check made
  // at start left the warning on a game that could draw its map a second later.
  useEffect(() => {
    if (checkWebGL()) return undefined;
    setShowWebGLWarning(true);
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (checkWebGL()) {
        clearInterval(timer);
        // The map was created without a context: only a fresh page gives it one.
        window.location.reload();
      } else if (tries >= 20) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  // Where the player was looking, in detailed mode only.
  //
  // One effect over every panel flag rather than a call inside each handler:
  // these panels are opened from a dozen places (the toolbar, the advisor's own
  // buttons, a keyboard shortcut), and a per-handler call would miss most of
  // them the day it was written. The timeline's own panels log themselves in
  // time.jsx, which owns them.
  useEffect(() => {
    const open = [
      activeBottomPanel && `bottom:${activeBottomPanel}`,
      isSettingsOpen && "settings",
      isCheatsOpen && "cheats",
      isAdvisorOpen && "advisor",
      isCountryOpen && "country",
      isForcesOpen && "forces",
    ].filter(Boolean);
    logDebugEvent("ui", `Open panels: ${open.length ? open.join(", ") : "(none)"}`, undefined, { verbose: true });
  }, [activeBottomPanel, isSettingsOpen, isCheatsOpen, isAdvisorOpen, isCountryOpen, isForcesOpen]);

  // Idle diplomacy drip: each real-world minute the game is open (and has a
  // running game), there is a small chance a polity messages the player's
  // inbox unprompted. Everything that could break it is guarded inside
  // maybeSendIdleDiplomacy — it skips entirely while a time skip, game-master
  // command, or interactive event stage is in flight, never overlaps itself, and stays
  // silent on any failure. Hidden tabs don't roll the dice, and neither does a
  // window nobody has touched for ten minutes (runtime/playerActivity.js): each
  // attempt is a background request, and a window left open while the player
  // was away spent the day's cap on notes nobody was there to read.
  useEffect(() => {
    // The main menu owns Scenario Workshop / Map Editor as overlays while the
    // previously active campaign may still exist underneath. Idle diplomacy is
    // gameplay activity, not background app activity, so do not let a country
    // message the player while they are browsing/editing outside the campaign.
    // Nor for a game that has not been opened: the menu is closed for a moment
    // while the page's first game is on its way, and the active game is still
    // the one last played.
    if (hasNoGames || mainMenuOpen || !gameEntered) return undefined;
    const activity = createPlayerActivity();
    const listenerOptions = { capture: true, passive: true };
    for (const type of PLAYER_ACTIVITY_EVENTS) window.addEventListener(type, activity.note, listenerOptions);
    const iv = setInterval(() => {
      // A shared game's world is the host's to move (multiplayer/).
      if (document.visibilityState !== "visible" || inSharedGame()) return;
      if (!activity.isPresent()) return;
      import("../AI/gameplay.js")
        .then(({ maybeSendIdleDiplomacy }) => maybeSendIdleDiplomacy())
        .catch(() => {});
    }, 60000);
    return () => {
      clearInterval(iv);
      for (const type of PLAYER_ACTIVITY_EVENTS) window.removeEventListener(type, activity.note, listenerOptions);
    };
  }, [hasNoGames, mainMenuOpen, gameEntered]);

  // Spy reports, on the same rhythm and with the same guards: a roll each
  // minute the tab is visible, at odds that work out to roughly one report
  // every twenty minutes per deployed agent. Agents also report with time
  // skips (agentReports.js: in the skip's own answer, never a request of their
  // own); this is what makes
  // them tick while the player is simply playing, and it is why there is no
  // Gather button — an agent is a trickle of intelligence, not a thing to farm.
  // Not in the main menu or the Workshop: each report is an AI request, spent
  // on a campaign the player has not entered.
  useEffect(() => {
    if (hasNoGames || mainMenuOpen || !gameEntered) return undefined;
    const iv = setInterval(() => {
      if (document.visibilityState !== "visible" || inSharedGame()) return;
      import("../AI/gameplay.js")
        .then(({ maybeGatherIntelligence }) => maybeGatherIntelligence())
        .catch(() => {});
    }, 60000);
    return () => clearInterval(iv);
  }, [hasNoGames, mainMenuOpen, gameEntered]);

  useEffect(() => {
    if (isAdvisorOpen) setShouldLoadAdvisor(true);
  }, [isAdvisorOpen]);

  useEffect(() => {
    if (isCountryOpen) setShouldLoadCountry(true);
  }, [isCountryOpen]);

  // The report header names the top of the Fallback list from the moment the
  // game loads; every later change to the list keeps it in step.
  useEffect(() => {
    syncAiDebugContext();
    const refresh = () => setAiSetup(readAiSetup());
    window.addEventListener("ai:fallback-changed", refresh);
    return () => window.removeEventListener("ai:fallback-changed", refresh);
  }, []);

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

  const openAdvisor = useCallback((seedPrompt) => {
    setIsCountryOpen(false);
    setIsAdvisorOpen(true);
    if (typeof seedPrompt === "string" && seedPrompt) setPendingAdvisorPrompt(seedPrompt);
  }, []);

  // The drawer's width and the offset of the HUD beside it both read one CSS
  // variable, so they are always laid out from the same number in the same
  // frame. React state holds the width at rest; a drag writes the variable
  // directly and commits to state when it ends, so no pointermove re-renders
  // the game UI.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(ADVISOR_WIDTH_VAR, `${advisorWidth}px`);
  }, [advisorWidth]);

  // The width the current drag has reached, committed when it ends.
  const draggedAdvisorWidthRef = useRef(null);

  // Called on every pointermove while the user drags the advisor's edge.
  const handleAdvisorResize = useCallback((px) => {
    const w = clampAdvisorWidth(px);
    draggedAdvisorWidthRef.current = w;
    document.documentElement.style.setProperty(ADVISOR_WIDTH_VAR, `${w}px`);
  }, []);

  // Committed and saved once, when the drag ends. The variable already holds
  // it, so nothing moves on release.
  const handleAdvisorResizeEnd = useCallback(() => {
    const w = draggedAdvisorWidthRef.current;
    draggedAdvisorWidthRef.current = null;
    if (w === null) return;
    setAdvisorWidth(w);
    try { localStorage.setItem("oh-advisor-width", String(w)); } catch { /* ignore */ }
  }, []);

  // Keep the saved width valid if the window shrinks below it.
  useEffect(() => {
    const onResize = () => setAdvisorWidth((w) => clampAdvisorWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const advisorCssWidth = `var(${ADVISOR_WIDTH_VAR}, ${advisorWidth}px)`;
  // Where the HUD beside the drawer (date widget, flag, advisor button) sits.
  // It is always placed at the drawer's edge, and pushed back to the screen
  // edge while the drawer is shut by the same transform the drawer uses: the
  // same distance (the drawer's width), duration and easing, started in the
  // same frame and run by the compositor, so opening and closing move them as
  // one. A drag changes only the width, which `right` follows with no
  // transition at all. (Easing `right` instead made the HUD cover less
  // distance than the drawer in the same time, on the busy main thread.)
  //
  // Not on a phone. There the advisor is the whole screen (advisor.jsx), so
  // nothing rides beside it and the HUD stays at the edge. A phone-wide drawer
  // used to carry the advisor button off the left of the screen, leaving the
  // drawer's own ✕ as the only way back.
  const isMobile = useIsMobile();
  // (Either way it keeps clear of a notch or rounded corner on the right, like
  // the drawer; the inset is 0 on a desktop.)
  const rightDrawerOpen = isAdvisorOpen || isCountryOpen || isWarRoomOpen;
  // The diplomacy toasts (chat.jsx) sit left of the open drawer rather than
  // over the reply the player is reading in it; following the width variable
  // keeps them there through a drag. Not on a phone, where the drawer is the
  // whole screen.
  //
  // The same value serves the fixed workspaces that need to coexist with the
  // drawer (the diplomacy workspace in chat.jsx). It points at
  // --oh-advisor-width rather than copying pixels, so dragging the
  // Advisor/Country edge updates consumers in the same frame without a React
  // render.
  const rightDrawerSafeOffset = rightDrawerOpen && !isMobile
    ? `var(${ADVISOR_WIDTH_VAR}, ${advisorWidth}px)`
    : "0px";
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(RIGHT_DRAWER_SAFE_OFFSET_VAR, rightDrawerSafeOffset);
    return () => document.documentElement.style.removeProperty(RIGHT_DRAWER_SAFE_OFFSET_VAR);
  }, [rightDrawerSafeOffset]);
  // The country badge opens the drawer; on a phone, where the badge is hidden,
  // the country name in the date widget does.
  const toggleCountry = () => {
    setIsWarRoomOpen(false);
    setIsAdvisorOpen(false);
    setIsCountryOpen((open) => !open);
  };
  // The war room's button is there while the player's troops are on a
  // battlefield where a war is being fought or is frozen by a ceasefire
  // (warRoomData.js), and fronts are switched on for this game.
  useActiveFeatures();
  // Nobody is playing a game that has not been opened: no country, so no war.
  const playerCountry = gameEntered ? activeGame?.country || "" : "";
  const warFronts = useRuntimeState("world", (world) => playerFrontsKey(world?.battlefields, playerCountry), playerCountry);
  const atWar = Boolean(warFronts) && isActiveFeatureEnabled("fronts");
  // For the music, at war is wider than the war room's button: the player's
  // country on a side of a war being fought (the war ledger), whether or not
  // there is a battlefield for it or fronts are switched on.
  const inWar = useRuntimeState("world", (world) => playerAtWar(world?.wars, playerCountry), playerCountry);
  // The music plays the open game's scenario's own tracks where the scenario
  // names any (runtime/scenarioMusic.js). Told again only when the record
  // itself changes, since the library hands out a new object on every refresh;
  // and told before the scene below, so a game opening starts on the right
  // music rather than changing to it. No game is open before one is entered:
  // the game last played has no say in the music, and nothing of its
  // scenario's is asked of the hub.
  const scenarioMusicKey = JSON.stringify((gameEntered && activeGame?.id && runtimeScenario?.music) || null);
  useEffect(() => { followScenarioMusic(JSON.parse(scenarioMusicKey)); }, [scenarioMusicKey]);
  // And it follows where the player is (runtime/ambientMusic.js): the menu, a
  // game opening under its cover, the game, the game with the player at war,
  // and the war room or a battlefield being shown, which the war room's own
  // store knows.
  const battlefieldShown = useWarRoom((room) => room.open || Boolean(room.battlefield));
  const musicScene = musicSceneOf({ inMenu: mainMenuOpen || hasNoGames, loading: showGameLoading, atWar: atWar || inWar, war: battlefieldShown });
  useEffect(() => { setMusicScene(musicScene); }, [musicScene]);
  const closeWarRoomPanel = useCallback(() => setIsWarRoomOpen(false), []);
  const toggleWarRoom = () => {
    setShouldLoadWarRoom(true);
    setIsAdvisorOpen(false);
    setIsCountryOpen(false);
    setIsWarRoomOpen((open) => !open);
  };
  const advisorDockStyle = useMemo(() => (isMobile
    ? { right: `calc(0.5rem + ${SAFE_RIGHT})`, transform: "none", transition: `transform ${ADVISOR_SLIDE}` }
    : {
      right: `calc(${advisorCssWidth} + 0.5rem + ${SAFE_RIGHT})`,
      transform: rightDrawerOpen ? "none" : `translateX(${advisorCssWidth})`,
      transition: `transform ${ADVISOR_SLIDE}`,
    }), [advisorCssWidth, rightDrawerOpen, isMobile]);
  const toggleBottomPanel = useCallback((panelName) => {
    setActiveBottomPanel((currentPanel) => (
      currentPanel === panelName ? null : panelName
    ));
  }, []);

  // While the Events panel is open the map shows every troop of a battlefield
  // from far off, as the war room does (Map/troopDetail.js): what happened is
  // read in the panel, and where it happened is looked for on the map.
  const eventsOpen = activeBottomPanel === "history";
  useEffect(() => {
    showEveryTroop("events", eventsOpen);
    return () => showEveryTroop("events", false);
  }, [eventsOpen]);

  // On a phone, Back closes the panel on top instead of leaving the game
  // (runtime/backToClose.js; with a mouse nothing changes).
  useBackToClose(Boolean(activeBottomPanel), () => setActiveBottomPanel(null));
  useBackToClose(isAdvisorOpen, () => setIsAdvisorOpen(false));
  useBackToClose(isCountryOpen, () => setIsCountryOpen(false));
  useBackToClose(isWarRoomOpen, () => setIsWarRoomOpen(false));
  useBackToClose(isForcesOpen, () => setIsForcesOpen(false));
  useBackToClose(isCheatsOpen, () => setIsCheatsOpen(false));
  useBackToClose(isDebugConsoleOpen, () => setIsDebugConsoleOpen(false));
  useBackToClose(isInteractiveOpen, () => setIsInteractiveOpen(false));
  useBackToClose(isSettingsOpen, () => {
    setSettingsInitialSection(null);
    setIsSettingsOpen(false);
  });

  // On a phone a map card and a bottom panel take turns (runtime/mobileUi.js):
  // both sit at the bottom of the screen, and a card opened by a tap on the
  // strip of map above an open panel came up underneath it, unseen. A panel
  // opening also puts away the screen-sized sheets (the advisor, the country
  // drawer, a country's panel): a diplomacy toast, which shows above them,
  // opens the chat, and
  // the chat came up underneath them.
  useEffect(() => {
    if (!isMobile || !activeBottomPanel) return undefined;
    dismissRegionPopup();
    dismissUnitPopup();
    dismissFeaturePopup();
    openCountryPanel(null);
    setIsAdvisorOpen(false);
    setIsCountryOpen(false);
    const onCardOpened = () => setActiveBottomPanel(null);
    window.addEventListener(MAP_CARD_OPENED, onCardOpened);
    return () => window.removeEventListener(MAP_CARD_OPENED, onCardOpened);
  }, [isMobile, activeBottomPanel]);

  useEffect(() => {
    const openCountryStats = (event) => {
      const country = String(event?.detail?.country || "").trim();
      if (!country) return;
      setIsAdvisorOpen(false);
      setPendingCountryTarget(country);
      setIsCountryOpen(true);
    };
    window.addEventListener(OPEN_COUNTRY_STATS_EVENT, openCountryStats);
    return () => window.removeEventListener(OPEN_COUNTRY_STATS_EVENT, openCountryStats);
  }, []);

  // An interactive event opens from the card of the event a time skip offered,
  // and from the time panel's note while one is offered or in progress (time.jsx
  // dispatches this).
  useEffect(() => {
    const openInteractive = () => setIsInteractiveOpen(true);
    window.addEventListener("oh:open-interactive-event", openInteractive);
    return () => window.removeEventListener("oh:open-interactive-event", openInteractive);
  }, []);

  // While the war room is open it is the whole of the screen's business: every
  // other control is put out of sight, the bar across the top with the game's
  // name and the way out of it, the date, the launchers, Search, the forces,
  // the country badge, the advisor and the menu. Out of sight, not unmounted:
  // the date widget goes on running the game. They come back when it is shut.
  const warRoomShown = isWarRoomOpen && !mainMenuOpen && !hasNoGames;
  const hudStyle = warRoomShown ? HUD_OUT_OF_SIGHT : HUD_IN_SIGHT;

  return (
    <>
      {showWebGLWarning && <WebGLWarningPopup />}
      <div data-oh-hud="" style={hudStyle}>
        <LibraryTopBar onOpenSettings={() => {
          setSettingsScope("app");
          setSettingsInitialSection("general");
          setIsSettingsOpen(true);
        }} />
        {/* The game's own controls, and with them everything they run (the
            date widget runs the game), are mounted when a game is opened and
            not before: at startup the menu above is all there is. */}
        {gameEntered && (
          <>
            <DateWidget
              activePanel={activeBottomPanel}
              mapRef={mapRef}
              onSetPanel={setActiveBottomPanel}
              onTogglePanel={toggleBottomPanel}
              dockStyle={advisorDockStyle}
              topOffset={TOP_BAR_OFFSET}
              onToggleCountry={toggleCountry}
              countryOpen={isCountryOpen}
            />
            <Toolbar
              onOpenAdvisor={openAdvisor}
              activePanel={activeBottomPanel}
              onTogglePanel={toggleBottomPanel}
              mapRef={mapRef}
            />
            <MapModeSelector dockStyle={advisorDockStyle} />
            <Other
              dockStyle={advisorDockStyle}
              active={isCountryOpen}
              onToggle={toggleCountry}
            />
            <Search mapRef={mapRef} besideWarRoom={atWar} />
            <ForcesPanel
              mapRef={mapRef}
              topOffset={TOP_BAR_OFFSET}
              open={isForcesOpen}
              onToggle={() => setIsForcesOpen((v) => !v)}
            />
            <AdvisorButton
              isAdvisorOpen={isAdvisorOpen}
              dockStyle={advisorDockStyle}
              onToggle={() => {
                setIsWarRoomOpen(false);
                setIsCountryOpen(false);
                setIsAdvisorOpen((open) => !open);
              }}
            />
          </>
        )}
      </div>
      {(atWar || isWarRoomOpen) && (
        <WarRoomButton open={warRoomShown} isMobile={isMobile} onToggle={toggleWarRoom} />
      )}
      <Suspense fallback={null}>
        <LazyAfterActionReports />
      </Suspense>
      <Suspense fallback={null}>
        {shouldLoadWarRoom && (
          <LazyWarRoomPanel
            open={warRoomShown}
            onClose={closeWarRoomPanel}
            width={advisorCssWidth}
            onResize={handleAdvisorResize}
            onResizeEnd={handleAdvisorResizeEnd}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {shouldLoadAdvisor && (
          <LazyAdvisorPanel
            isAdvisorOpen={isAdvisorOpen}
            mapRef={mapRef}
            onClose={() => setIsAdvisorOpen(false)}
            width={advisorCssWidth}
            onResize={handleAdvisorResize}
            onResizeEnd={handleAdvisorResizeEnd}
            // A phone's advisor covers the screen, so it steps aside for the
            // panel it opens.
            onOpenActions={() => { setActiveBottomPanel("actions"); if (isMobile) setIsAdvisorOpen(false); }}
            onOpenProjects={() => { setActiveBottomPanel("projects"); if (isMobile) setIsAdvisorOpen(false); }}
            requestedPrompt={pendingAdvisorPrompt}
            onConsumeRequest={() => setPendingAdvisorPrompt("")}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {shouldLoadCountry && (
          <LazyCountryPanel
            open={isCountryOpen}
            onClose={() => setIsCountryOpen(false)}
            requestedTarget={pendingCountryTarget}
            onConsumeTarget={consumeCountryTarget}
            width={advisorCssWidth}
            onResize={handleAdvisorResize}
            onResizeEnd={handleAdvisorResizeEnd}
            mapRef={mapRef}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        <Presence open={isCheatsOpen}>
          <LazyCheatsPanel open={isCheatsOpen} onClose={() => setIsCheatsOpen(false)} onOpenForces={() => { setIsCheatsOpen(false); setIsForcesOpen(true); }} />
        </Presence>
      </Suspense>
      <Suspense fallback={null}>
        <Presence open={isDebugConsoleOpen}>
          <LazyDebugConsole open={isDebugConsoleOpen} onClose={() => setIsDebugConsoleOpen(false)} />
        </Presence>
      </Suspense>
      <Suspense fallback={null}>
        <Presence open={isInteractiveOpen}>
          <LazyInteractivePanel
            open={isInteractiveOpen}
            onClose={() => setIsInteractiveOpen(false)}
            onOpenTimeline={() => { setIsInteractiveOpen(false); setActiveBottomPanel("history"); }}
          />
        </Presence>
      </Suspense>
      <GenerationRatingToast />
      <Presence open={showGameLoading} leaveMs={450}>
        <GameLoadingScreen
          gameName={activeGame?.name || ""}
          scenarioName={runtimeScenario?.name || ""}
          countryName={activeCountryName || activeGame?.country || ""}
          // The game's own cover when it uploaded one, else its scenario's
          // (the server already folds the two into the game's coverImageUrl).
          coverUrl={activeGame?.coverImageUrl || runtimeScenario?.coverImageUrl || ""}          phase={gameLoading.phase}
        />
      </Presence>
      <Presence open={showApiPrompt}>
        <ApiSetupPrompt
          providerLabel={getProviderMeta(aiSetup.provider)?.label || "the selected provider"}
          missing={describeProviderSetupNeed(aiSetup.provider)}
          onDismiss={answerApiPrompt}
          onConfigure={() => {
            answerApiPrompt();
            setSettingsScope("game");
            setSettingsInitialSection("ai");
            setIsSettingsOpen(true);
          }}
        />
      </Presence>
      <SettingsButton
        topOffset={TOP_BAR_OFFSET}
        hidden={isSettingsOpen || warRoomShown}
        onToggle={() => {
          setSettingsScope("game");
          setSettingsInitialSection(null);
          setIsSettingsOpen(!isSettingsOpen);
        }}
      />
      <Presence open={isSettingsOpen} leaveMs={260}>
        <SettingsMenu
          discordUrl={DISCORD_URL}
          redditUrl={REDDIT_URL}
          githubUrl={GITHUB_URL}
          reportBugUrl="https://github.com/Open-Historia/open-historia/issues/new"
          context={{
            gameName: activeGame?.name || "",
            scenarioName: runtimeScenario?.name || "",
            countryName: activeCountryName || activeGame?.country || "",
            date: activeGame?.currentDate || "",
          }}
          initialSection={settingsInitialSection}
          scope={settingsScope}
          onClose={() => {
            setSettingsInitialSection(null);
            setIsSettingsOpen(false);
          }}
          onOpenGameManagement={() => openLibraryTab("games")}
          onOpenEvents={() => setActiveBottomPanel("history")}
          // The game master's tools write the game itself, which in a shared
          // game is the host's engine's alone: they are not offered there.
          onOpenCheats={sharedRole ? undefined : () => {
            setShouldLoadCheats(true);
            setIsCheatsOpen(true);
            setIsSettingsOpen(false);
          }}
          onOpenDebugConsole={() => {
            setShouldLoadDebugConsole(true);
            setIsDebugConsoleOpen(true);
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
            logSettingChange("Fullscreen", newState);
          }}
          onToggleGlobe={() => {
            setIsGlobeEnabled(!isGlobeEnabled);
            logSettingChange("3D Globe", !isGlobeEnabled);
          }}
          onToggleTerrain={() => {
            setIsTerrainEnabled(!isTerrainEnabled);
            logSettingChange("3D Terrain", !isTerrainEnabled);
          }}
        />
      </Presence>
      {/* Same place on screen: the lasting borders note goes first so a
          passing fallback-switch notice draws over it, not under it. */}
      <BordersFallbackNotice />
      <FallbackSwitchNotice />
      <AgentWaitingNotice />
      {/* An offer of peace or a call to arms that waits for the player's answer. */}
      <WarAndPeaceCards />
    </>
  );
};

export default Main;
