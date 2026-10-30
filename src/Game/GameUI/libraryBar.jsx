/*! Open Historia — portions (map-editor embed, apply-to-scenario, country picker) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, SCREEN_HEIGHT, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { Presence } from "./presence.jsx";
import {
  PROMPT_EDITOR_SECTIONS,
  PROMPT_GUIDANCE_DEFAULTS,
  localizedGuidanceDefaults,
  materializePromptPack,
  normalizePromptPack,
  serializePromptPack,
} from "../AI/gameplayPrompts.js";
import { guidanceSegmentsFor } from "../AI/promptGuidance.js";
import { promptTranslationsVersion, subscribePromptTranslations } from "../../runtime/promptTranslations.js";
import {
  activateGame,
  clearGameAsset,
  clearScenarioAsset,
  createGame,
  createScenario,
  downloadScenarioJsonAsset,
  emptyTrash,
  ensureLibraryCatalog,
  exportScenarioBundle,
  importGameBundle,
  importScenarioBundle,
  updateScenarioFromBundle,
  listTrash,
  loadGameDetails,
  loadScenarioDetails,
  refreshLibraryCatalog,
  removeGame,
  removeScenario,
  restoreFromTrash,
  saveGame,
  saveScenario,
  selectScenario,
  uploadGameAsset,
  uploadScenarioAsset,
  useLibraryState,
  withSingleLibraryRefresh,
  writeGameSnapshotsText,
} from "../../runtime/library.js";
import { enterGame, hasEnteredGame, leaveGame, useGameEntered } from "../../runtime/gameEntry.js";
import { loadCountryNames, normalizeOwnBasemaps, readJson, writeJson, JSON_URLS } from "../../runtime/assets.js";
import { ownBasemapsFromGame } from "../../Editor/ownBasemaps.js";
import { LABEL_FONT_SUGGESTIONS } from "../../runtime/mapSettings.js";
import FactionCreator from "./FactionCreator.jsx";
import { groupRegions, normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import FeaturesSectionEditor from "./FeaturesSectionEditor.jsx";
import StatsSheetEditor, { normalizeStatsEditorValue } from "./StatsSheetEditor.jsx";
import InstitutionAuthoringPanel from "./InstitutionAuthoringPanel.jsx";
import PrehistoryPanel from "./PrehistoryPanel.jsx";
import ScenarioFrontsPanel from "./ScenarioFrontsPanel.jsx";
import ScenarioWarSettings from "./ScenarioWarSettings.jsx";
import ScenarioMilitaryPanel from "./ScenarioMilitaryPanel.jsx";
import { compactWarSettings } from "./scenarioWarSettings.js";
import { militaryDefaultsFor } from "../../Editor/militaryForm.js";
import ScenarioMusicPanel, { ScenarioMusicCredits } from "./ScenarioMusicPanel.jsx";
import { normalizeScenarioMusic } from "../../runtime/scenarioMusic.js";
const PoliticalWorldAuthoringPanel = lazy(() => import("./PoliticalWorldAuthoringPanel.jsx"));
const PoliticalWorldGenerationPanel = lazy(() => import("./PoliticalWorldGenerationPanel.jsx"));
import { isFeatureEnabled, normalizeFeatureOverrides, normalizeFeatureSettings } from "../../runtime/gameFeatures.js";
import { flattenStatSheetRows, normalizeStatSheetDefinition, serializeStatSheet } from "../../runtime/statIndexDefinitions.js";
import { UNIT_TYPES } from "../../runtime/gameState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { DIFFICULTY_LEVELS } from "../../runtime/difficulty.js";
import { POLITICAL_WORLD_CAPABILITY, politicalWorldCapability } from "../../runtime/politicalWorldCapability.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { bundledFlagUrl, flagImageUrlFromGid, gidToAlpha2 } from "../../runtime/countryFlags.js";
import { splitScenarioBundleImage, unresolvedBundleBackground } from "../../runtime/communityBasemaps.js";
import { noteMissingBasemapTried, retryMissingBasemap } from "../../runtime/missingBasemap.js";
import { zipBundle, looksLikeZip } from "../../runtime/bundleZip.js";
import { SCENARIO_LICENSE_FILE, SCENARIO_LICENSE_TEXT, SCENARIO_LICENSE_URL } from "../../runtime/scenarioLicense.js";
import { splitBundleFiles } from "../../runtime/bundleFiles.js";
import { buildGameZipBlob, formatZipSize, readGameZip, saveGameZipToDisk } from "../../runtime/gameZip.js";
import { findScenarioCopyOfBundle } from "../../runtime/importedScenarioCopy.js";
import { createLatestRequest } from "../../runtime/latestRequest.js";
import { changedFields, followSavedFields, formDiffers } from "../../runtime/editorForm.js";
import { createActivationHandOff } from "../../runtime/afterActivation.js";
import { createWorkInProgress } from "../../runtime/workInProgress.js";
import { buildScenarioCountryOptions, isOfferedCountry, seededWorldOf, worldWithFaction, worldWithPlayerGroup } from "../../runtime/newGameWorld.js";
import { saveBlobToDisk } from "../../runtime/saveFile.js";
import { acceptFor } from "../../runtime/fileAccept.js";
import { playerCountryAfterSave, scenarioAfterWorkshopRenames } from "../../Editor/playerCountryAfterSave.js";
import { warGeographyOf, warGeographyWorldPatch } from "../../Editor/warGeographyDoc.js";
import { downloadHubScenario, fetchHubPosts, fetchPostComments, hubUpdateReason, readScenarioBundleBytes, refreshPublishedRecord } from "../../runtime/hubPosts.js";
import { isBlockedContributor, missingBasemapOfBundle, scenarioCopyOfHubFile, withContributorBlocked } from "../../../server/hubProvenance.js";
import { reconcileMapPolityAuthoringOps } from "../../../server/polityRename.js";
import { readSuggestionFile } from "../../runtime/scenarioSuggestion.js";
import {
  ScenarioCommunityCard,
  SuggestChangesDialog,
  SuggestionCountBadge,
  SuggestionReviewDialog,
  SuggestionsBanner,
  openSuggestionsOf,
} from "./ScenarioSuggestions.jsx";
import { CommunitySkeleton, LobbiesSkeleton, MenuCardSkeletons } from "./menuSkeleton.jsx";

const UNIT_TYPE_LABELS = {
  infantry: "Infantry",
  armor: "Armor",
  air: "Air Force",
  naval: "Naval",
  artillery: "Artillery",
  garrison: "Garrison",
};

// Lazy so OpenLayers only loads when the in-game map editor is opened.
const MapEditor = lazy(() => import("../../Editor/MapEditor.jsx"));
// Lazy so the GitHub-backed Community tab costs nothing until opened.
const CommunityPanel = lazy(() => import("./communityHub.jsx"));
// Lobbies: join a private one by invite code, host one, and the public list
// (multiplayer/).
const LobbiesTab = lazy(() => import("../../multiplayer/ui/LobbiesTab.jsx"));
// Every update to the game, on a timeline: opened from the menu's mark.
const UpdateHistory = lazy(() => import("./updates/UpdateHistory.jsx"));
// Lazy so OpenLayers only loads when the country picker map is opened.
const CountryPickerMap = lazy(() => import("./CountryPickerMap.jsx"));

// The accent a scenario or game falls back to when it carries none: the same
// default the stores hand out (server/libraryStore.js, web/storeConstants.js).
const DEFAULT_ACCENT_COLOR = "#2bc1f3";

const BAR_HEIGHT = 64;

// "#rrggbb" -> [r,g,b], the shape colors.json stores. Faults to a neutral grey
// rather than throwing, so a bad colour never blocks creating the faction.
const hexToRgbArray = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const gameShelfMemory = { search: "", sort: "recent", view: "active" };

// Set by the mounted LibraryTopBar; lets outside callers open the main menu
// on a specific tab.
let _openLibraryTab = null;
export const openLibraryTab = (tab) => {
  _openLibraryTab?.(tab);
};
// And lets them close it onto the game, as joining a shared game from the
// Lobbies tab does (multiplayer/ui/DiscordInvites.jsx).
let _enterActiveGame = null;
export const enterActiveGameFromOutside = () => {
  _enterActiveGame?.();
};

// Whether the main menu is showing. Lives at module scope because the whole UI
// tree (this component included) remounts whenever the active game changes —
// per-component state would reset to "open" mid game-start and the menu would
// pop back over the freshly activated game. The app boots into the menu, and
// with no game loaded behind it: one is loaded when the player opens it
// (runtime/gameEntry.js), which is also the only way the menu closes.
let menuOpenDefault = true;
// For background work that should not run for a game the player hasn't
// actually entered (e.g. pre-game history generation while browsing the menu).
export const isMainMenuOpen = () => menuOpenDefault;
// The reactive twin, for HUD pieces that portal to document.body above the
// menu's own layer (the diplomatic bell and toasts): they follow this rather
// than juggling z-indexes against the menu.
const mainMenuListeners = new Set();
const subscribeMainMenu = (listener) => {
  mainMenuListeners.add(listener);
  return () => mainMenuListeners.delete(listener);
};
export const useMainMenuOpen = () => useSyncExternalStore(subscribeMainMenu, isMainMenuOpen, isMainMenuOpen);
// What a flow that activated a game still owes the player once the UI has
// remounted around that game: offer the Apply & Play country picker, or open
// its editor to say why the rest of the setup failed (runtime/afterActivation.js).
const afterActivation = createActivationHandOff();
const handOffAfterActivation = (work) => afterActivation.put(work);
// The scenarios an Update is running on (runtime/workInProgress.js). Out here
// for the same reason as the menu flag: a game started while a post's file is
// still downloading remounts this tree, and the card must go on saying so.
const scenarioUpdates = createWorkInProgress();
// With the full-width in-game bar gone, top-anchored UI (settings ⋮, date
// widget, forces panel, editor drawer) starts at the screen edge, below a
// status bar or camera cutout the page is drawn under (Android Chrome in
// fullscreen, a home-screen app); the inset is 0 everywhere else.
const TOP_BAR_OFFSET = `calc(0.5rem + ${SAFE_TOP})`;

const DEFAULT_SCENARIO_COVER = "/scenario-placeholder.webp";

// The flat tint over a card's cover picture, so its text reads on any picture
// (an inset shadow, which lies over the picture). The Accent, the colour its
// author picked, glows in the corner over that: the one fade the interface
// keeps (noGradients.test.js).
const COVER_TINT = "inset 0 0 0 100vmax rgba(4,6,12,0.56)";
const CARD_COVER_FADE_STYLE = {
  bottom: 0,
  boxShadow: "inset 0 -0.8rem 0.5rem 0 #12141a",
  height: "1.2rem",
  inset: "auto 0 0 0",
  pointerEvents: "none",
  position: "absolute",
  zIndex: 1,
};
const accentGlowStyle = (accentColor, { at, alpha, reach }) => ({
  background: `radial-gradient(circle at ${at}, ${accentColor}${alpha}, transparent ${reach})`,
  inset: 0,
  opacity: 0.6,
  pointerEvents: "none",
  position: "absolute",
});

const surfaceStyle = {
  background:
    "rgba(34,34,37,0.53)",
  border: "1px solid var(--oh-hud-border)",
  boxShadow: "var(--oh-hud-shadow-soft)",
  backdropFilter: "var(--oh-hud-blur)",
  WebkitBackdropFilter: "var(--oh-hud-blur)",
};

const actionButtonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.82rem",
  fontWeight: 600,
  gap: "0.4rem",
  justifyContent: "center",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045), 0 6px 18px rgba(0,0,0,0.12)",
  minHeight: "2.2rem",
  padding: "0 1rem",
  transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
};

const themeButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "9px",
  boxShadow: "none",
};

const themeSurfaceStyle = {
  background: "#12141a",
  border: "1px solid rgba(255,255,255,0.09)",
  boxShadow: "0 14px 32px rgba(0,0,0,0.45)",
};

const APP_SHELL_MAX_WIDTH = "3000px";
// Let the library rail follow the available shell width instead of targeting
// one desktop class. auto-fill adds/removes columns as room changes, while the
// min track keeps cards readable from ordinary laptops through ultrawide.
const LIBRARY_GRID_TEMPLATE = "repeat(auto-fill, minmax(min(100%, 16.5rem), 1fr))";
const CARD_TEXT_SHADOW = "0 1px 2px rgba(0,0,0,0.9), 0 5px 16px rgba(0,0,0,0.72), 0 14px 30px rgba(0,0,0,0.55)";
const SCENARIO_CARD_TEXT_SHADOW = "0 1px 2px rgba(0,0,0,0.96), 0 6px 18px rgba(0,0,0,0.82), 0 16px 34px rgba(0,0,0,0.64)";

const ButtonIcon = ({ kind, size = 15, strokeWidth = 1.9 }) => {
  const common = {
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth,
    viewBox: "0 0 24 24",
    width: size,
  };

  switch (kind) {
    case "close":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      );
    case "settings":
      return (
        <svg aria-hidden="true" {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "refresh":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M20 12a8 8 0 1 1-8-8c2.24 0 4.38.89 6 2.44L20 8.5" />
          <path d="M20 4v4.5h-4.5" />
        </svg>
      );
    case "import":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M12 4v11" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M4.5 19.5h15" />
        </svg>
      );
    case "play":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "host":
      return (
        <svg aria-hidden="true" {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c.6-3.1 2.8-5 5.5-5s4.9 1.9 5.5 5" />
          <path d="M16 5.2a3 3 0 0 1 0 5.6" />
          <path d="M17.5 14.3c1.7.6 2.8 2.3 3 4.7" />
        </svg>
      );
    case "archive":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M4.5 7.5h15v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18.5z" />
          <path d="M3.5 4.5h17v3h-17z" />
          <path d="M9 12h6" />
        </svg>
      );
    case "edit":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M4.5 19.5 9 18l9-9a2.1 2.1 0 0 0-3-3l-9 9-1.5 4.5z" />
          <path d="m13.5 7.5 3 3" />
        </svg>
      );
    case "clone":
      return (
        <svg aria-hidden="true" {...common}>
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M6.5 15H6A2 2 0 0 1 4 13V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5" />
        </svg>
      );
    case "update":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M12 4v11" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M5 19.5h14" />
        </svg>
      );
    // A ring that turns while the button's work runs (styles.css
    // .oh-working-ring; still, under reduced motion).
    case "working":
      return (
        <svg aria-hidden="true" className="oh-working-ring" {...common}>
          <circle cx="12" cy="12" r="8" opacity="0.3" />
          <path d="M12 4a8 8 0 0 1 8 8" />
        </svg>
      );
    case "menu":
      return (
        <svg aria-hidden="true" {...common}>
          <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    // The main menu's pages, on the rail (MenuRail).
    case "games":
      return (
        <svg aria-hidden="true" {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="3" />
          <path d="m10.3 9.2 4.5 2.8-4.5 2.8z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "scenarios":
      return (
        <svg aria-hidden="true" {...common}>
          <path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" />
          <path d="M9 4.5v13M15 6.5v13" />
        </svg>
      );
    case "community":
      return (
        <svg aria-hidden="true" {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z" />
        </svg>
      );
    case "lobbies":
      return (
        <svg aria-hidden="true" {...common}>
          <circle cx="8.5" cy="8.5" r="3" />
          <circle cx="16.5" cy="9.5" r="2.4" />
          <path d="M3 19c.5-3 2.6-4.8 5.5-4.8s5 1.8 5.5 4.8" />
          <path d="M14.8 14.6c.5-.2 1.1-.3 1.7-.3 2.3 0 4 1.5 4.5 4.2" />
        </svg>
      );
    default:
      return null;
  }
};

// The main menu's pages, in the order the rail shows them (the owner,
// 2026-10-14: "restyle this ui so the tabs that are currently on top appear as
// semi square buttons on a menu on the left side of the screen").
const MENU_TABS = Object.freeze([
  Object.freeze({ id: "games", label: "Games" }),
  Object.freeze({ id: "scenarios", label: "Scenarios" }),
  Object.freeze({ id: "community", label: "Community" }),
  Object.freeze({ id: "lobbies", label: "Lobbies" }),
]);
const MENU_RAIL_WIDTH = "6.9rem";
const MENU_RAIL_ICON = 22;

// A page's button on the rail: a rounded square, its icon over its name.
const railButtonStyle = (active) => ({
  alignItems: "center",
  background: active ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.035)",
  border: `1px solid ${active ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.07)"}`,
  borderRadius: "16px",
  boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 20px rgba(0,0,0,0.28)" : "none",
  color: active ? "#ffffff" : "rgba(236,236,240,0.7)",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  fontSize: "0.74rem",
  fontWeight: 700,
  gap: "0.45rem",
  height: "5.1rem",
  justifyContent: "center",
  letterSpacing: "0.01em",
  padding: "0.5rem 0.3rem",
  transition: actionButtonStyle.transition,
  width: "5.4rem",
});

// The rail down the left of the main menu, on a screen wide enough for it: the
// mark and the name, a rounded square for each page, and Settings at its
// foot. A phone keeps the pages as a row across the top.
const MenuRail = ({ activeTab, onTab, onOpenSettings, onOpenHistory }) => (
  <nav
    style={{
      alignItems: "center",
      background: "#0b0b0d",
      borderRight: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      gap: "0.6rem",
      overflowY: "auto",
      padding: `calc(1rem + ${SAFE_TOP}) 0.75rem calc(1rem + ${SAFE_BOTTOM}) calc(0.75rem + ${SAFE_LEFT})`,
      scrollbarWidth: "none",
      width: `calc(${MENU_RAIL_WIDTH} + ${SAFE_LEFT})`,
    }}
  >
    {/* The mark opens the history of the game's updates (updates/UpdateHistory.jsx). */}
    <button
      aria-label="Update history"
      className="oh-tap"
      onClick={onOpenHistory}
      style={{ alignItems: "center", background: "none", border: "none", color: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", flexShrink: 0, gap: "0.45rem", padding: 0 }}
      title="Update history: every update to Open Historia"
      type="button"
    >
      <div style={{ alignItems: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "999px", display: "flex", height: "3.15rem", justifyContent: "center", overflow: "hidden", width: "3.15rem" }}>
        <img alt="" src="/logo.png" style={{ height: "2.05rem", width: "2.05rem" }} />
      </div>
      <div style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.15, textAlign: "center" }}>
        Open Historia
      </div>
    </button>
    <div style={{ flex: 1, minHeight: "0.6rem" }} />
    {MENU_TABS.map((tab) => (
      <button
        key={tab.id}
        aria-current={activeTab === tab.id ? "page" : undefined}
        className="oh-tap-row"
        onClick={() => onTab(tab.id)}
        style={railButtonStyle(activeTab === tab.id)}
        type="button"
      >
        <ButtonIcon kind={tab.id} size={MENU_RAIL_ICON} />
        <span>{tab.label}</span>
      </button>
    ))}
    <div style={{ flex: 1, minHeight: "0.6rem" }} />
    {typeof onOpenSettings === "function" && (
      <button className="oh-tap-row" onClick={onOpenSettings} style={railButtonStyle(false)} type="button">
        <ButtonIcon kind="settings" size={MENU_RAIL_ICON} />
        <span>Settings</span>
      </button>
    )}
  </nav>
);

// On a touch screen .oh-tap / .oh-tap-row (styles.css) make a control a
// finger's 44 px, but a min-height written inline beats a class, and every pill
// in this file writes one. So where a finger is the pointer the inline floor is
// left out and the class sets it (an icon button's min-width too); with a mouse
// the style is returned untouched.
const touchFit = (style, touch, { icon = false } = {}) => {
  if (!touch) return style;
  return icon ? { ...style, minHeight: undefined, minWidth: undefined } : { ...style, minHeight: undefined };
};

// A shelf card, never wider than the phone it is on: at 320 px a 21rem card ran
// past the edge of the screen and took the game card's ⋮ with it.
const SHELF_CARD_WIDTH = "min(21rem, calc(100vw - 2.4rem))";

const fieldLabelStyle = {
  color: "rgba(255,255,255,0.72)",
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  marginBottom: "0.45rem",
  textTransform: "uppercase",
};

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "#f8fafc",
  fontSize: "0.9rem",
  outline: "none",
  padding: "0.8rem 0.9rem",
  width: "100%",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "8rem",
  resize: "vertical",
};

const IMAGE_UPLOAD_ACCEPT = ".avif,.gif,.jpeg,.jpg,.png,.webp";

const scenarioBadgeLabels = {
  cities: "Cities PMTiles",
  colors: "Colors JSON",
  countries: "Countries PMTiles",
  regions: "Regions PMTiles",
};

const scenarioAssetLabels = {
  cover: "Cover Image",
  ...scenarioBadgeLabels,
};

const scenarioAssetAccept = {
  cover: IMAGE_UPLOAD_ACCEPT,
  cities: ".pmtiles",
  colors: ".json",
  countries: ".pmtiles",
  regions: ".pmtiles",
};

const gameAssetLabels = {
  cover: "Cover Image",
};

const gameAssetAccept = {
  cover: IMAGE_UPLOAD_ACCEPT,
};

const editorSectionLabels = {
  assets: "Assets",
  bundles: "Bundles",
  features: "Features",
  fronts: "Fronts",
  history: "Pre-history",
  music: "Music",
  overview: "Overview",
  politics: "Politics",
  prompts: "Prompts",
  stats: "Stats",
  world: "World",
};

const normalizeString = (value) => String(value ?? "").trim();

const buildScenarioEditorState = (details) => {
  const scenario = details?.scenario ?? {};
  const game = details?.data?.game ?? {};
  const prompts = normalizePromptPack(details?.data?.prompts ?? {});
  const world = details?.data?.world ?? {};

  return {
    accentColor: scenario.accentColor ?? DEFAULT_ACCENT_COLOR,
    allowedUnitTypes: Array.isArray(world.allowedUnitTypes) ? world.allowedUnitTypes : [...UNIT_TYPES],
    country: game.country ?? "",
    description: scenario.description ?? "",
    eyebrow: scenario.eyebrow ?? "",
    features: normalizeFeatureSettings(scenario.features),
    gameDate: game.gameDate ?? "",
    heroSubtitle: scenario.heroSubtitle ?? "",
    heroTitle: scenario.heroTitle ?? "",
    language: game.language ?? world.language ?? "English",
    // The hub tracks it plays, by situation (the Music tab), or null for none.
    music: normalizeScenarioMusic(scenario.music),
    name: scenario.name ?? "",
    prompts,
    labelFont: world.labelFont ?? "",
    labelHaloColor: world.labelHaloColor ?? "",
    labelTextColor: world.labelTextColor ?? "",
    simulationRules: world.simulationRules ?? "",
    startingTimelineText: world.startingTimelineText ?? "",
    subtitle: scenario.subtitle ?? "",
    // How its wars are fought (the Fronts tab: ScenarioWarSettings.jsx), compact:
    // null for a scenario that sets nothing (scenarioWarSettings.js).
    warSettings: compactWarSettings(world.warSettings),
  };
};

const buildGameEditorState = (details) => {
  const gameMeta = details?.game ?? {};
  const game = details?.data?.game ?? {};
  const prompts = normalizePromptPack(details?.data?.prompts ?? {});
  const world = details?.data?.world ?? {};

  return {
    accentColor: gameMeta.accentColor ?? DEFAULT_ACCENT_COLOR,
    country: game.country ?? "",
    description: gameMeta.description ?? "",
    eyebrow: gameMeta.eyebrow ?? "",
    features: normalizeFeatureOverrides(gameMeta.features),
    scenarioFeatures: normalizeFeatureSettings(details?.scenario?.features),
    gameDate: game.gameDate ?? "",
    heroSubtitle: gameMeta.heroSubtitle ?? "",
    heroTitle: gameMeta.heroTitle ?? "",
    language: game.language ?? world.language ?? "English",
    name: gameMeta.name ?? "",
    prompts,
    labelFont: world.labelFont ?? "",
    labelHaloColor: world.labelHaloColor ?? "",
    labelTextColor: world.labelTextColor ?? "",
    simulationRules: world.simulationRules ?? "",
    startingTimelineText: world.startingTimelineText ?? "",
    subtitle: gameMeta.subtitle ?? "",
  };
};

// Scenario exports and JSON bundles save through runtime/saveFile.js like every
// other file: the anchor with the deferred revoke in a browser, Downloads/Open
// Historia in the Android app. (The copy that lived here revoked the object URL in the
// same task as the click, which Firefox treats as a cancelled download.)

// Every save here is awaited: in the Android app the Downloads write and the
// share-sheet fallback can both fail, and the caller's catch has to see it.
const saveJsonBundleToDisk = async (bundle, fileName) => {
  await saveBlobToDisk(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), fileName);
};

// Prompt-pack files intentionally contain only scenario-author editable guidance.
// The technical/tooling portions of prompts are app-owned and are recomposed from
// the current defaults when the pack loads, so importing an older pack cannot
// freeze stale schemas or runtime contracts into a scenario. Accept a raw prompt
// pack, a small { prompts } wrapper, or a full scenario bundle's data.prompts.
const promptPackFromImport = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prompt import must be a JSON object.");
  }

  const candidate =
    value.data?.prompts && typeof value.data.prompts === "object" && !Array.isArray(value.data.prompts)
      ? value.data.prompts
      : value.prompts && typeof value.prompts === "object" && !Array.isArray(value.prompts)
        ? value.prompts
        : value;

  if (!("promptModel" in candidate) && !("guidance" in candidate)) {
    throw new Error("That file does not contain an Open Historia prompt pack.");
  }

  return candidate;
};

// The Prompts tab. Each prompt is a fixed technical template with a few
// passages of guidance inside it (promptGuidance.js); only those passages are
// shown and edited, one textarea each, and a blank or default-identical
// passage stores nothing. The technical text never reaches the author, so it
// cannot be broken here and it stays current as the game changes.
const PromptSectionEditor = ({
  onChangePrompt,
  onExportPromptPack,
  onImportPromptPack,
  promptPack,
  promptSectionKey,
  setPromptSectionKey,
}) => {
  const promptFileInputRef = useRef(null);
  const [promptTransferStatus, setPromptTransferStatus] = useState(null);
  const touch = useTouchPrimary();
  const currentSection =
    PROMPT_EDITOR_SECTIONS.find((section) => section.key === promptSectionKey) ??
    PROMPT_EDITOR_SECTIONS[0];
  const segments = guidanceSegmentsFor(currentSection.key);
  // The passages in the player's language where the pack translates them
  // (runtime/promptTranslations.js; they arrive a moment after boot). They
  // are what the AI receives for a passage the author leaves alone, and an
  // edit that matches either them or the English is no edit.
  useSyncExternalStore(subscribePromptTranslations, promptTranslationsVersion, promptTranslationsVersion);
  const localizedDefaults = localizedGuidanceDefaults();
  const englishDefaults =
    currentSection.type === "root"
      ? PROMPT_GUIDANCE_DEFAULTS[currentSection.key] ?? {}
      : PROMPT_GUIDANCE_DEFAULTS.tasks[currentSection.key] ?? {};
  const defaults =
    currentSection.type === "root"
      ? localizedDefaults[currentSection.key] ?? {}
      : localizedDefaults.tasks?.[currentSection.key] ?? {};
  const edits =
    currentSection.type === "root"
      ? promptPack.guidance?.[currentSection.key] ?? {}
      : promptPack.guidance?.tasks?.[currentSection.key] ?? {};
  const isEdited = (segment) =>
    typeof edits[segment.id] === "string"
    && edits[segment.id].trim() !== (defaults[segment.id] ?? "").trim()
    && edits[segment.id].trim() !== (englishDefaults[segment.id] ?? "").trim();
  const editedCount = segments.filter(isEdited).length;
  const smallButtonStyle = { ...themeButtonStyle, fontSize: "0.72rem", minHeight: "1.7rem", padding: "0 0.6rem" };

  const handlePromptImportFile = async (event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file || !onImportPromptPack) return;

    try {
      const parsed = JSON.parse(await file.text());
      onImportPromptPack(promptPackFromImport(parsed));
      setPromptTransferStatus({
        error: false,
        text: `Imported ${file.name}. Save the scenario to persist these prompt edits.`,
      });
    } catch (error) {
      setPromptTransferStatus({ error: true, text: `Import failed: ${error.message}` });
    }
  };

  const handlePromptExport = () => {
    if (!onExportPromptPack) return;
    onExportPromptPack();
    setPromptTransferStatus({
      error: false,
      text: "Exported every editable prompt passage. Technical/tooling prompt text stays app-owned and is intentionally excluded.",
    });
  };

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "18px",
        padding: "0.9rem",
      }}
    >
      {(onExportPromptPack || onImportPromptPack) ? (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.45rem",
            justifyContent: "space-between",
            marginBottom: "0.85rem",
          }}
        >
          <div style={{ flex: "1 1 15rem" }}>
            <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.82rem", fontWeight: 700 }}>
              Prompt pack
            </div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.72rem", lineHeight: 1.4, marginTop: "0.15rem" }}>
              Move every scenario-authored prompt passage at once. Tooling and output contracts stay with the app.
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
            {onExportPromptPack ? (
              <button
                className="oh-tap-row"
                onClick={handlePromptExport}
                style={touchFit({ ...themeButtonStyle, minHeight: "2rem", padding: "0 0.8rem" }, touch)}
                type="button"
              >
                Export all prompts
              </button>
            ) : null}
            {onImportPromptPack ? (
              <>
                <button
                  className="oh-tap-row"
                  onClick={() => promptFileInputRef.current?.click()}
                  style={touchFit({ ...themeButtonStyle, minHeight: "2rem", padding: "0 0.8rem" }, touch)}
                  type="button"
                >
                  Import all prompts
                </button>
                <input
                  accept={acceptFor(".json,application/json")}
                  onChange={handlePromptImportFile}
                  ref={promptFileInputRef}
                  style={{ display: "none" }}
                  type="file"
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {promptTransferStatus ? (
        <div
          style={{
            background: promptTransferStatus.error ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.08)",
            border: `1px solid ${promptTransferStatus.error ? "rgba(239,68,68,0.28)" : "rgba(34,197,94,0.2)"}`,
            borderRadius: "10px",
            color: promptTransferStatus.error ? "#fca5a5" : "rgba(220,252,231,0.86)",
            fontSize: "0.72rem",
            lineHeight: 1.4,
            marginBottom: "0.8rem",
            padding: "0.5rem 0.65rem",
          }}
        >
          {promptTransferStatus.text}
        </div>
      ) : null}

      {(onExportPromptPack || onImportPromptPack) ? (
        <div style={{ margin: "0.1rem 0 0.75rem" }}>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginBottom: "0.6rem" }} />
          <div
            style={{
              color: "rgba(255,255,255,0.42)",
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Prompt passages
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.85rem" }}>
        {PROMPT_EDITOR_SECTIONS.map((section) => (
          <button
            key={section.key}
            className="oh-tap-row"
            onClick={() => setPromptSectionKey(section.key)}
            style={touchFit({
              ...themeButtonStyle,
              background:
                section.key === currentSection.key ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.05)",
              borderColor:
                section.key === currentSection.key ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)",
              minHeight: "2rem",
              padding: "0 0.8rem",
            }, touch)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
        {currentSection.description}
      </div>
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.11)",
          borderRadius: "12px",
          color: "rgba(255,255,255,0.62)",
          fontSize: "0.76rem",
          lineHeight: 1.45,
          marginBottom: "0.9rem",
          padding: "0.55rem 0.7rem",
        }}
      >
        Only the guidance is editable: the role, the tone, what to simulate and what makes a good result.
        The technical parts of every prompt (the placeholders that inject the world, the output contracts,
        the map rules) are fixed in the app, so every scenario and game keeps up with the game as it changes.
        A placeholder such as {"${PLAYER_POLITY}"} inside a passage is filled in by the game.
      </div>

      <div style={{ display: "grid", gap: "0.9rem" }}>
        {segments.map((segment) => {
          const value = typeof edits[segment.id] === "string" ? edits[segment.id] : defaults[segment.id] ?? "";
          const edited = isEdited(segment);
          return (
            <div key={segment.id}>
              <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>
                  {segment.label}
                  {edited ? <span style={{ color: "#e4e4e7", marginLeft: "0.4rem" }}>· edited</span> : null}
                </label>
                {edited ? (
                  <button
                    className="oh-tap-row"
                    onClick={() => onChangePrompt(currentSection, segment.id, null)}
                    style={touchFit(smallButtonStyle, touch)}
                    type="button"
                  >
                    Reset to default
                  </button>
                ) : null}
              </div>
              {segment.hint ? (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.76rem", margin: "0.25rem 0 0.35rem" }}>
                  {segment.hint}
                </div>
              ) : null}
              <textarea
                aria-label={`${currentSection.label}: ${segment.label}`}
                style={{ ...textareaStyle, minHeight: "7rem" }}
                value={value}
                onChange={(event) => onChangePrompt(currentSection, segment.id, event.target.value)}
              />
            </div>
          );
        })}
      </div>

      {editedCount > 0 ? (
        <div style={{ marginTop: "0.9rem" }}>
          <button className="oh-tap-row" onClick={() => onChangePrompt(currentSection, null, null)} style={touchFit(smallButtonStyle, touch)} type="button">
            Reset every passage in this section
          </button>
        </div>
      ) : null}
    </div>
  );
};

// Why a card asks for an Update, in words (runtime/hubPosts.js hubUpdateReason).
// A copy with an old link was downloaded from its post's own attachment, before
// the hub checked the files it gives out; the game no longer downloads those,
// so its card says so in the open, not only in a tooltip.
const UPDATE_NEWER_TITLE = "A newer version of this scenario is on the community hub. Updating replaces this copy (existing games keep working).";
const UPDATE_UNCHECKED_NOTE = "This copy was downloaded before the community hub started checking its files. Update it to get the checked copy.";

// `updateReason` is why the copy should take its post's file again, or null.
// For a copy as it was downloaded, Update takes New Game's place, as it always
// has: nothing of the player's is lost by it. A copy the player has edited is
// only ever asked for the old link, and keeps New Game: its Update is a button
// of its own beside the reason, and asks before it replaces their changes
// (handleScenarioUpdate).
const ScenarioCard = ({ onClone, onEdit, onPlay, onSelect, onUpdate, scenario, selected, updateReason = null, updateNote = "", updating = false }) => {
  const updateAvailable = Boolean(updateReason);
  const updateIsPrimary = updateAvailable && !scenario.hubOrigin?.editedAt;
  const isBuiltIn = scenario.id === "default";
  const cardImageUrl = scenario.coverImageUrl || DEFAULT_SCENARIO_COVER;
  const touch = useTouchPrimary();

  return (
    <div
      style={{
        ...themeSurfaceStyle,
        background: "#12141a",
        borderColor: selected ? `${scenario.accentColor}88` : "rgba(255,255,255,0.09)",
        borderRadius: "24px",
        boxShadow: selected ? `0 0 0 1px ${scenario.accentColor}66, 0 16px 38px rgba(0,0,0,0.55)` : "0 14px 32px rgba(0,0,0,0.45)",
        display: "flex",
        flex: `0 0 ${SHELF_CARD_WIDTH}`,
        flexDirection: "column",
        minHeight: "22rem",
        overflow: "hidden",
        position: "relative",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
      }}
    >
      {/* ── Top Half: Artwork Cover Banner ── */}
      <div
        style={{
          height: "9.6rem",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        <button
          onClick={() => onSelect(scenario.id)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            inset: 0,
            padding: 0,
            position: "absolute",
            zIndex: 1,
          }}
          title={`Select ${scenario.name}`}
          type="button"
        />
        <div
          style={{
            background:
              `url("${cardImageUrl}") center/cover, ` +
              `url("${DEFAULT_SCENARIO_COVER}") center/cover`,
            boxShadow: COVER_TINT,
            inset: 0,
            opacity: 0.98,
            position: "absolute",
          }}
        />
        <div aria-hidden="true" style={accentGlowStyle(scenario.accentColor, { at: "14% 18%", alpha: "b8", reach: "34%" })} />
        <div aria-hidden="true" style={CARD_COVER_FADE_STYLE} />

        {/* Floating Badges over Cover */}
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            justifyContent: "space-between",
            padding: "0.8rem 0.9rem",
            position: "relative",
            width: "100%",
            zIndex: 2,
          }}
        >
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            <span
              style={{
                backdropFilter: "blur(8px)",
                background: selected ? `${scenario.accentColor}88` : "rgba(10,12,18,0.72)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "999px",
                color: "rgba(248,248,250,0.96)",
                display: "inline-flex",
                fontSize: "0.68rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "0.22rem 0.55rem",
                textShadow: SCENARIO_CARD_TEXT_SHADOW,
                textTransform: "uppercase",
              }}
            >
              {scenario.eyebrow || "Scenario"}
            </span>
            {isBuiltIn && (
              <span
                style={{
                  backdropFilter: "blur(8px)",
                  background: "rgba(10,12,18,0.72)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  borderRadius: "999px",
                  color: "#fff",
                  display: "inline-flex",
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "0.22rem 0.55rem",
                  textShadow: SCENARIO_CARD_TEXT_SHADOW,
                  textTransform: "uppercase",
                }}
              >
                Built-In
              </span>
            )}
          </div>
          <span style={{ alignItems: "center", display: "inline-flex", gap: "0.4rem" }}>
            <SuggestionCountBadge count={openSuggestionsOf(scenario).length} onClick={() => onEdit(scenario.id)} />
            <span
              style={{
                backdropFilter: "blur(8px)",
                background: "rgba(10,12,18,0.72)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "999px",
                color: "rgba(255,255,255,0.85)",
                fontSize: "0.69rem",
                fontWeight: 600,
                padding: "0.2rem 0.55rem",
              }}
            >
              {scenario.gameCount} game{scenario.gameCount === 1 ? "" : "s"}
            </span>
          </span>
        </div>
      </div>

      {/* ── Bottom Half: Sleek Dark Cockpit Panel (#12141a) ── */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "0.55rem",
          justifyContent: "space-between",
          padding: "0.85rem 1.05rem 1rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div>
          <div
            style={{
              color: "#fff",
              fontSize: "1.32rem",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              lineHeight: 1.2,
              marginBottom: "0.4rem",
            }}
          >
            {scenario.heroTitle || scenario.name}
          </div>
          <div
            style={{
              color: "rgba(228,228,235,0.78)",
              display: "-webkit-box",
              fontSize: "0.82rem",
              lineHeight: 1.45,
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
            }}
            title={scenario.heroSubtitle || scenario.description || scenario.subtitle || undefined}
          >
            {scenario.heroSubtitle || scenario.description || scenario.subtitle}
          </div>
        </div>

        <div>
          {scenario.subtitle && scenario.subtitle !== (scenario.heroSubtitle || scenario.description) && (
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                display: "-webkit-box",
                fontSize: "0.75rem",
                marginBottom: "0.45rem",
                overflow: "hidden",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 1,
              }}
              title={scenario.subtitle || undefined}
            >
              {scenario.subtitle}
            </div>
          )}

          {/* Action Bar */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", marginTop: "0.6rem" }}>
            <button
              aria-busy={updating || undefined}
              className="oh-tap-row"
              disabled={updating}
              onClick={() => (updateIsPrimary ? onUpdate(scenario) : onPlay(scenario))}
              style={touchFit({
                ...themeButtonStyle,
                background: updating || updateIsPrimary ? "#1d7f4ccc" : `${scenario.accentColor}`,
                borderColor: updating || updateIsPrimary ? "#27a663dd" : `${scenario.accentColor}`,
                borderRadius: "11px",
                boxShadow: `0 3px 12px ${scenario.accentColor}33`,
                color: "#fff",
                cursor: updating ? "progress" : "pointer",
                fontSize: "0.88rem",
                fontWeight: 700,
                minHeight: "2.35rem",
                width: "100%",
              }, touch)}
              title={updating || updateIsPrimary
                ? (updateReason === "unchecked" ? UPDATE_UNCHECKED_NOTE : UPDATE_NEWER_TITLE)
                : undefined}
              type="button"
            >
              {updating
                ? <><ButtonIcon kind="working" /> Updating…</>
                : updateIsPrimary ? <><ButtonIcon kind="update" /> Update</> : <><ButtonIcon kind="play" /> New Game</>}
            </button>
            <div style={{ display: "flex", gap: "0.45rem" }}>
              <button
                className="oh-tap-row"
                onClick={() => onEdit(scenario.id)}
                style={touchFit({
                  ...themeButtonStyle,
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.12)",
                  borderRadius: "9px",
                  flex: 1,
                  fontSize: "0.78rem",
                  minHeight: "2rem",
                  padding: "0 0.6rem",
                }, touch)}
                type="button"
              >
                <ButtonIcon kind="edit" /> Edit
              </button>
              <button
                className="oh-tap-row"
                onClick={() => onClone(scenario)}
                style={touchFit({
                  ...themeButtonStyle,
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.12)",
                  borderRadius: "9px",
                  flex: 1.3,
                  fontSize: "0.78rem",
                  minHeight: "2rem",
                  padding: "0 0.6rem",
                }, touch)}
                type="button"
              >
                <ButtonIcon kind="clone" /> Clone Scenario
              </button>
            </div>
          </div>
          {/* An old link, said in the open: why the copy should be updated,
              and for a copy the player has edited the Update itself (New Game
              stays above it: this Update replaces their changes, so it is
              never the button a hurried press lands on, and it asks first). */}
          {updateReason === "unchecked" && !updating && (
            <div
              role="note"
              style={{
                alignItems: "center",
                color: "#fde68a",
                display: "flex",
                flexWrap: "wrap",
                fontSize: "0.72rem",
                gap: "0.5rem",
                lineHeight: 1.4,
                marginTop: "0.55rem",
                textShadow: SCENARIO_CARD_TEXT_SHADOW,
              }}
            >
              <span style={{ flex: "1 1 10rem" }}>{UPDATE_UNCHECKED_NOTE}</span>
              {!updateIsPrimary && (
                <button
                  className="oh-tap-row"
                  onClick={() => onUpdate(scenario)}
                  style={touchFit({ ...themeButtonStyle, background: "#1d7f4ccc", borderColor: "#27a663dd", color: "#fff", minHeight: "2rem", padding: "0 0.8rem" }, touch)}
                  type="button"
                >
                  <ButtonIcon kind="update" /> Update
                </button>
              )}
            </div>
          )}
          {/* What came of the last Update when it did not simply work: it
              failed, or it went through without its new basemap. The ring
              going back to a plain button says neither, and the only other
              place the reason is shown is the editor drawer, which is shut
              when Update is pressed from a card. Only while the card still
              offers Update (a copy whose basemap is missing does): once the
              update has gone through, or the basemap has arrived, the note is
              old news. */}
          {updateNote && updateAvailable && !updating && (
            <div
              role="status"
              title={updateNote}
              style={{
                color: "#fecaca",
                display: "-webkit-box",
                fontSize: "0.72rem",
                lineHeight: 1.4,
                marginTop: "0.55rem",
                overflow: "hidden",
                textShadow: SCENARIO_CARD_TEXT_SHADOW,
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 4,
              }}
            >
              {updateNote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Edit, Clone and Export live behind the ⋮ in the corner rather than on the
// face of the card. Three verbs compete for width with Play, and Play is the one a
// player came to press; the other three are occasional, and none of them is
// destructive, which is why Archive stays out here on its own.
const GameCard = ({ active, busy, game, onActivate, onArchive, onClone, onDelete = null, onEdit, onExport }) => {
  const cardImageUrl = game.coverImageUrl || DEFAULT_SCENARIO_COVER;
  const touch = useTouchPrimary();
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  // Which row the pointer is over. These are plain buttons on a translucent
  // surface, so without this nothing moves under the cursor and there is no way
  // to tell which one is about to be clicked.
  const [hoveredMenuItem, setHoveredMenuItem] = useState(null);
  const cardMenuRef = useRef(null);
  const cardMenuButtonRef = useRef(null);

  // Export is the one that takes a moment — a second or two on a phone for a game
  // with roll-back points, longer when a map has to go in. So it keeps the menu
  // open and says so on the row that was pressed, rather than closing and leaving
  // the card looking like nothing happened. Edit and Clone are instant and close.
  const [exporting, setExporting] = useState(false);

  // Click-away. It used to be a fixed layer over the screen, but the card's
  // backdrop-filter makes the card the containing block of anything fixed
  // inside it, so the layer covered the card alone and a click anywhere else
  // left the menu open. A listener on the document hears the click wherever it
  // lands; it exists only while this card's menu is open, so a shelf of cards
  // still carries none. Presses on the menu and on its ⋮ are the menu's own.
  useEffect(() => {
    if (!cardMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (exporting) return;
      if (cardMenuRef.current?.contains(event.target) || cardMenuButtonRef.current?.contains(event.target)) return;
      setCardMenuOpen(false);
      setHoveredMenuItem(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [cardMenuOpen, exporting]);
  useBackToClose(cardMenuOpen, () => {
    setCardMenuOpen(false);
    setHoveredMenuItem(null);
  });

  const runExport = async () => {
    setExporting(true);
    try {
      await onExport(game);
    } finally {
      setExporting(false);
      setCardMenuOpen(false);
      setHoveredMenuItem(null);
    }
  };

  const cardMenuItems = [
    ["Edit", () => { setCardMenuOpen(false); onEdit(game.id); }, false],
    ["Clone", () => { setCardMenuOpen(false); onClone(game); }, false],
    // Offered everywhere, the Android app included: runtime/saveFile.js saves
    // the zip into Downloads/Open Historia there (runtime/native/fileSave.js).
    [exporting ? "Exporting…" : "Export", runExport, exporting],
  ];

  return (
    <div
      style={{
        ...themeSurfaceStyle,
        borderColor: active ? `${game.accentColor}88` : "rgba(255,255,255,0.09)",
        borderRadius: "24px",
        boxShadow: active ? `0 0 0 1px ${game.accentColor}66, 0 16px 38px rgba(0,0,0,0.55)` : "0 14px 32px rgba(0,0,0,0.45)",
        display: "flex",
        flex: `0 0 ${SHELF_CARD_WIDTH}`,
        flexDirection: "column",
        minHeight: "22rem",
        overflow: "visible",
        position: "relative",
      }}
    >
      <div style={{ borderRadius: "24px 24px 0 0", height: "9.6rem", overflow: "hidden", position: "relative", width: "100%" }}>
        <div
          style={{
            background:
              `url("${cardImageUrl}") center/cover, ` +
              `url("${DEFAULT_SCENARIO_COVER}") center/cover`,
            boxShadow: COVER_TINT,
            inset: 0,
            opacity: 0.98,
            position: "absolute",
          }}
        />
        <div aria-hidden="true" style={accentGlowStyle(game.accentColor, { at: "14% 18%", alpha: "b8", reach: "34%" })} />
        <div aria-hidden="true" style={CARD_COVER_FADE_STYLE} />
      </div>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          gap: "0.5rem",
          justifyContent: "space-between",
          left: 0,
          padding: "0.8rem 0.9rem",
          position: "absolute",
          right: 0,
          top: 0,
          zIndex: 3,
        }}
      >
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", minWidth: 0 }}>
          <span style={{
                backdropFilter: "blur(8px)",
                background: active ? `${game.accentColor}88` : "rgba(10,12,18,0.72)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "999px",
                color: "rgba(248,248,250,0.96)",
                display: "inline-flex",
                flex: "0 0 auto",
                fontSize: "0.68rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "0.22rem 0.55rem",
                textShadow: SCENARIO_CARD_TEXT_SHADOW,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}>
            {active ? "Current Game" : game.eyebrow || "Game"}
          </span>
          <span
            style={{
              backdropFilter: "blur(8px)",
              background: "rgba(10,12,18,0.72)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "999px",
              color: "rgba(255,255,255,0.85)",
              fontSize: "0.69rem",
              fontWeight: 600,
              maxWidth: "11rem",
              overflow: "hidden",
              padding: "0.2rem 0.55rem",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={game.scenarioName}
          >
            {game.scenarioName}
          </span>
        </div>

        <div style={{ flex: "0 0 auto", position: "relative" }}>
          <button
            ref={cardMenuButtonRef}
            aria-haspopup="menu"
            aria-expanded={cardMenuOpen}
            aria-label={busy ? "Working…" : `More for ${game.name}`}
            className="oh-tap"
            disabled={busy}
            onClick={() => setCardMenuOpen((open) => !open)}
            style={touchFit({
              ...themeButtonStyle,
              backdropFilter: "blur(8px)",
              background: cardMenuOpen ? "rgba(255,255,255,0.18)" : "rgba(10,12,18,0.72)",
              cursor: busy ? "progress" : "pointer",
              fontSize: "1.05rem",
              lineHeight: 1,
              minWidth: "2rem",
              opacity: busy ? 0.5 : 1,
              padding: "0.3rem 0.45rem",
            }, touch, { icon: true })}
            title={busy ? "Working…" : undefined}
            type="button"
          >
            <ButtonIcon kind="menu" size={16} />
          </button>
          {cardMenuOpen && (
            <div
              ref={cardMenuRef}
              role="menu"
              style={{
                ...themeSurfaceStyle,
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                minWidth: "13rem",
                overflow: "hidden",
                position: "absolute",
                right: 0,
                top: "calc(100% + 0.35rem)",
                zIndex: 4,
              }}
            >
              {cardMenuItems.map(([label, run, working]) => (
                <button
                  key={label}
                  className="oh-tap-row"
                  disabled={exporting}
                  onClick={() => { setHoveredMenuItem(null); run(); }}
                  onFocus={() => setHoveredMenuItem(label)}
                  onBlur={() => setHoveredMenuItem(null)}
                  onMouseEnter={() => setHoveredMenuItem(label)}
                  onMouseLeave={() => setHoveredMenuItem(null)}
                  role="menuitem"
                  style={touchFit({
                    ...themeButtonStyle,
                    background:
                      working || hoveredMenuItem === label ? "rgba(255,255,255,0.16)" : "transparent",
                    border: "none",
                    borderRadius: 0,
                    color: working || hoveredMenuItem === label ? "#fff" : "rgba(248,250,252,0.82)",
                    cursor: working ? "progress" : undefined,
                    justifyContent: "flex-start",
                    minWidth: "8rem",
                    opacity: exporting && !working ? 0.45 : 1,
                    padding: "0.55rem 0.8rem",
                    textAlign: "left",
                  }, touch)}
                  type="button"
                >
                  {label}
                </button>
              ))}
              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: "0.68rem",
                  lineHeight: 1.35,
                  padding: "0.5rem 0.8rem 0.55rem",
                }}
              >
                An exported game carries its conversations, advisors and events — worth a look before posting it publicly.
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "0.55rem",
          justifyContent: "space-between",
          padding: "0.85rem 1.05rem 1rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div>
          <div style={{ color: "#fff", fontSize: "1.32rem", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.2, marginBottom: "0.4rem" }}>
            {game.name}
          </div>
          <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.6fr)", marginBottom: "0.55rem" }}>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", gridColumn: "1 / -1", minWidth: 0, padding: "0.4rem 0.55rem" }}>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{"Country"}</div>
              <div style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={game.country || undefined}>{game.country || "No player country"}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", minWidth: 0, padding: "0.4rem 0.55rem" }}>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{"Date"}</div>
              <div style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{game.currentDate || "No date"}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", minWidth: 0, padding: "0.4rem 0.55rem" }}>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{"Round"}</div>
              <div style={{ color: "#fff", fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{game.round || 1}</div>
            </div>
          </div>
          <div
            style={{
              color: "rgba(228,228,235,0.78)",
              display: "-webkit-box",
              fontSize: "0.82rem",
              lineHeight: 1.45,
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
            }}
            title={game.description || undefined}
          >
            {game.description || "Playable campaign session."}
          </div>
        </div>

        <div>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" }}>
            {[["Actions", game.pendingActions], ["Events", game.eventCount]].map(([label, count]) => (
              <span key={label} style={{ alignItems: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "rgba(255,255,255,0.6)", display: "inline-flex", fontSize: "0.72rem", gap: "0.35rem", padding: "0.2rem 0.5rem" }}>
                {label}
                <span style={{ color: "#fff", fontWeight: 700 }}>{count ?? 0}</span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            <button
              className="oh-tap-row"
              onClick={() => onActivate(game.id)}
              style={touchFit({
                ...themeButtonStyle,
                background: active ? "rgba(255,255,255,0.06)" : game.accentColor,
                borderColor: active ? "rgba(255,255,255,0.22)" : game.accentColor,
                borderRadius: "11px",
                boxShadow: active ? "none" : `0 3px 12px ${game.accentColor}33`,
                color: "#fff",
                fontSize: "0.88rem",
                fontWeight: 700,
                minHeight: "2.35rem",
                width: "100%",
              }, touch)}
              type="button"
            >
              {active ? "Current" : <><ButtonIcon kind="play" /> Play</>}
            </button>
            <div style={{ display: "flex", gap: "0.45rem" }}>
              <button
                className="oh-tap-row"
                onClick={() => onArchive(game)}
                style={touchFit({
                  ...themeButtonStyle,
                  background: "rgba(255,255,255,0.06)",
                  flex: 1,
                  fontSize: "0.78rem",
                  minHeight: "2rem",
                  padding: "0 0.6rem",
                }, touch)}
                title={game.archived ? "Move back into your library" : "Hide from the library without deleting"}
                type="button"
              >
                <ButtonIcon kind="archive" /> {game.archived ? "Unarchive" : "Archive"}
              </button>
              {game.archived && onDelete && game.canDelete && (
                <button
                  className="oh-tap-row"
                  disabled={busy}
                  onClick={() => onDelete(game)}
                  style={touchFit({
                    ...themeButtonStyle,
                    background: "rgba(127,29,29,0.34)",
                    borderColor: "rgba(248,113,113,0.28)",
                    color: "#fecaca",
                    flex: 1,
                    fontSize: "0.78rem",
                    minHeight: "2rem",
                    padding: "0 0.6rem",
                  }, touch)}
                  type="button"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// A responsive shelf on the main menu. Desktop fills the available width with a
// clean grid; phones keep the original swipeable row. Rows that can be
// legitimately empty pass emptyText.
const MenuRow = ({ action, children, description, emptyText, icon, title }) => {
  const isMobile = useIsMobile();
  const hasChildren = React.Children.count(children) > 0;

  return (
    <section style={{ marginBottom: isMobile ? "1.75rem" : "2rem", width: "100%" }}>
      <div style={{ marginBottom: hasChildren ? "0.9rem" : "0.55rem" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "0.85rem" }}>
          <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "0.55rem" }}>
            {icon && <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1 }}>{icon}</span>}
            <div style={{ color: "rgba(255,255,255,0.94)", fontSize: isMobile ? "1rem" : "1.12rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
              {title}
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", flex: 1, height: 1 }} />
          {action}
        </div>
        {description && (
          <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.88rem", marginLeft: icon ? "1.55rem" : 0, marginTop: "0.32rem" }}>
            {description}
          </div>
        )}
      </div>
      {hasChildren ? (
        <div style={isMobile
          ? { display: "flex", gap: "0.9rem", overflowX: "auto", paddingBottom: "0.35rem", scrollbarWidth: "thin" }
          : { display: "grid", gap: "1rem", gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}>
          {children}
        </div>
      ) : (
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", padding: "0.4rem 0 0.6rem" }}>
          {emptyText || "Nothing here yet."}
        </div>
      )}
    </section>
  );
};

// When a trash entry was deleted, in calendar days on this device.
const DAY_MS = 24 * 60 * 60 * 1000;
const deletedWhen = (deletedAt) => {
  const startOfDay = (time) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(Date.now()) - startOfDay(Date.parse(deletedAt))) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return "Deleted today";
  return days === 1 ? "Deleted yesterday" : `Deleted ${days} days ago`;
};

const DeletedCard = ({ busy, entry, onRestore, touch }) => (
  <div
    style={{
      ...themeSurfaceStyle,
      borderRadius: "24px",
      display: "flex",
      flex: `0 0 ${SHELF_CARD_WIDTH}`,
      flexDirection: "column",
      gap: "0.8rem",
      justifyContent: "space-between",
      padding: "1.1rem 1.2rem",
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div data-no-translate style={{ fontSize: "1.02rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.name}>
        {entry.name}
      </div>
      <div style={{ color: "rgba(255,255,255,0.64)", display: "flex", flexWrap: "wrap", fontSize: "0.82rem", gap: "0.6rem", marginTop: "0.3rem" }}>
        <span>{deletedWhen(entry.deletedAt)}</span>
        {Number.isFinite(entry.bytes) && entry.bytes > 0 && <span data-no-translate>{formatZipSize(entry.bytes)}</span>}
      </div>
    </div>
    <button
      className="oh-tap-row"
      disabled={busy}
      onClick={() => onRestore(entry)}
      style={touchFit({ ...themeButtonStyle, alignSelf: "flex-start", cursor: busy ? "progress" : "pointer" }, touch)}
      type="button"
    >
      <ButtonIcon kind="refresh" /> Restore
    </button>
  </div>
);

// The Recently deleted shelf of one tab: the games or the scenarios that delete
// moved to the trash (GET /api/trash), each with Restore, and Empty for the
// shelf. The desktop keeps an entry trash.keepDays (30) and deletes it for
// good at startup after that; the web and Android store keeps a week and only
// the last trash.keepCount (5), since a phone's storage is small. Hidden while
// empty, and where the store will not serve the trash (the desktop serves it
// only to the machine it runs on).
const RecentlyDeletedRow = ({ kind, onChanged, trash }) => {
  const touch = useTouchPrimary();
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const entries = (trash?.entries ?? []).filter((entry) => entry.kind === kind);
  if (!entries.length) return null;

  const run = async (work) => {
    setBusy(true);
    setRowError(null);
    try {
      await work();
    } catch (nextError) {
      setRowError(nextError.message);
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const count = entries.length;
  const question = kind === "game"
    ? (count === 1 ? "Delete the game in Recently deleted for good? This cannot be undone." : `Delete the ${count} games in Recently deleted for good? This cannot be undone.`)
    : (count === 1 ? "Delete the scenario in Recently deleted for good? This cannot be undone." : `Delete the ${count} scenarios in Recently deleted for good? This cannot be undone.`);
  const handleEmpty = () => {
    setConfirmEmpty(false);
    run(() => emptyTrash(kind));
  };
  const description = trash.keepCount
    ? (kind === "game"
      ? `Deleted games can be restored for ${trash.keepDays} days, while they are among the last ${trash.keepCount} things you deleted.`
      : `Deleted scenarios can be restored for ${trash.keepDays} days, while they are among the last ${trash.keepCount} things you deleted.`)
    : (kind === "game"
      ? `Deleted games can be restored for ${trash.keepDays} days, then they are deleted for good.`
      : `Deleted scenarios can be restored for ${trash.keepDays} days, then they are deleted for good.`);

  return (
    <>
      {rowError && (
        <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: "14px", color: "#fecaca", marginBottom: "0.9rem", padding: "0.8rem 0.9rem" }}>
          {rowError}
        </div>
      )}
      <MenuRow
        action={confirmEmpty ? (
          <div style={{ display: "flex", flexShrink: 0, gap: "0.45rem" }}>
            <button className="oh-tap-row" disabled={busy} onClick={() => setConfirmEmpty(false)} style={touchFit({ ...themeButtonStyle }, touch)} type="button">
              Cancel
            </button>
            <button className="oh-tap-row" disabled={busy} onClick={handleEmpty} style={touchFit({ ...themeButtonStyle, background: "rgba(185,28,28,0.72)", borderColor: "rgba(248,113,113,0.4)", color: "#fff" }, touch)} type="button">
              Empty
            </button>
          </div>
        ) : (
          <button className="oh-tap-row" disabled={busy} onClick={() => setConfirmEmpty(true)} style={touchFit({ ...themeButtonStyle, flexShrink: 0 }, touch)} type="button">
            Empty
          </button>
        )}
        description={confirmEmpty ? question : description}
        icon="🗑️"
        title="Recently deleted"
      >
        {entries.map((entry) => (
          <DeletedCard key={entry.entry} busy={busy} entry={entry} onRestore={(target) => run(() => restoreFromTrash(target.entry))} touch={touch} />
        ))}
      </MenuRow>
    </>
  );
};

const browseControlStyle = {
  ...themeButtonStyle,
  minHeight: "2.35rem",
  padding: "0 0.85rem",
};

const BrowsePill = ({ active, children, onClick }) => (
  <button
    className="oh-tap-row"
    onClick={onClick}
    style={{
      ...browseControlStyle,
      background: active ? "var(--oh-grey-selected)" : "rgba(255,255,255,0.05)",
      borderColor: active ? "var(--oh-grey-border-strong)" : "rgba(255,255,255,0.08)",
      color: active ? "var(--oh-grey-text)" : "rgba(246,246,248,0.78)",
    }}
    type="button"
  >
    {children}
  </button>
);

const LibraryCollection = ({ children, controls, description, emptyText, title }) => {
  const isMobile = useIsMobile();
  const hasChildren = React.Children.count(children) > 0;
  return (
    <section style={{ marginBottom: isMobile ? "1.75rem" : "2.3rem", width: "100%" }}>
      <div style={{ alignItems: isMobile ? "stretch" : "flex-end", display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: isMobile ? undefined : "wrap", gap: "0.8rem", justifyContent: "space-between", marginBottom: "0.9rem" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.96)", fontSize: isMobile ? "1.08rem" : "1.22rem", fontWeight: 800, letterSpacing: "-0.025em" }}>{title}</div>
          {description ? <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.86rem", marginTop: "0.28rem" }}>{description}</div> : null}
        </div>
        {controls}
      </div>
      {hasChildren ? (
        <div style={isMobile
          ? { display: "flex", gap: "0.9rem", overflowX: "auto", paddingBottom: "0.35rem", scrollbarWidth: "thin" }
          : { display: "grid", gap: "1rem", gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}>
          {children}
        </div>
      ) : (
        <div style={{ border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "16px", color: "rgba(255,255,255,0.48)", fontSize: "0.86rem", padding: "1rem" }}>{emptyText || "Nothing here yet."}</div>
      )}
    </section>
  );
};

// First slot of "Your Scenarios": the big + that creates a blank scenario.
const CreateScenarioTile = ({ busy, onCreate }) => (
  <button
    disabled={busy}
    onClick={onCreate}
    type="button"
    style={{
      alignItems: "center",
      background: "rgba(255,255,255,0.03)",
      border: "2px dashed rgba(255,255,255,0.24)",
      borderRadius: "24px",
      color: "rgba(255,255,255,0.78)",
      cursor: busy ? "wait" : "pointer",
      display: "flex",
      flex: `0 0 ${SHELF_CARD_WIDTH}`,
      flexDirection: "column",
      gap: "0.55rem",
      justifyContent: "center",
      minHeight: "15rem",
      opacity: busy ? 0.6 : 1,
    }}
  >
    <span aria-hidden="true" style={{ fontSize: "4.6rem", fontWeight: 300, lineHeight: 1 }}>+</span>
    <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>Create Scenario</span>
  </button>
);

const EDITOR_SECTION_GROUPS = Object.freeze([
  Object.freeze({ label: "Presentation", sections: Object.freeze(["overview", "assets", "music"]) }),
  Object.freeze({ label: "Setting", sections: Object.freeze(["world", "history", "politics"]) }),
  Object.freeze({ label: "War", sections: Object.freeze(["fronts"]) }),
  Object.freeze({ label: "Rules and AI", sections: Object.freeze(["stats", "features", "prompts"]) }),
  Object.freeze({ label: "Sharing", sections: Object.freeze(["bundles"]) }),
]);

const EDITOR_SECTION_BLURBS = Object.freeze({
  overview: "How it appears in the library: its name, colour and the words on its card.",
  assets: "The cover and the files the map is drawn from.",
  music: "The hub's tracks it plays while a game opens, in the game, at war and in the war room.",
  world: "Where play begins: the player's country, the date, the troops and the story so far.",
  history: "The events that led to the start date.",
  politics: "Governments, parties and institutions.",
  fronts: "How its wars are fought, every country's military and the fronts it begins with.",
  stats: "The national stats every country is measured by.",
  features: "Which gameplay features are on.",
  prompts: "The instructions the AI follows.",
  bundles: "Download it as one file to share or keep.",
});

const EDITOR_PANEL = "#12141a";
const EDITOR_NAV = "#0d0f14";
const editorCardStyle = {
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  marginBottom: "0.95rem",
  padding: "1rem 1.05rem",
};
const editorCardTitleStyle = { color: "#fff", fontSize: "0.92rem", fontWeight: 800, letterSpacing: "-0.01em", marginBottom: "0.75rem" };

const EditorSectionIcon = ({ kind, size = 17 }) => {
  const common = { fill: "none", height: size, stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, viewBox: "0 0 24 24", width: size };
  const paths = {
    overview: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M7 9h10M7 13h6" /></>,
    assets: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></>,
    music: <><path d="M9 17.5V6l10-2v11.5" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" /></>,
    world: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z" /></>,
    history: <><path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" /><path d="M5 17.5a2 2 0 0 1 2-2h11.5M9 8.5h6" /></>,
    politics: <><path d="M4 9.5 12 5l8 4.5M5.5 19.5h13M7 10.5v7M12 10.5v7M17 10.5v7" /></>,
    fronts: <><path d="M5 5v15M5 5.5c4-2 7 2 11 0v8c-4 2-7-2-11 0" /></>,
    stats: <><path d="M5 19.5V11M10 19.5V6M15 19.5v-6M20 19.5V9" /></>,
    features: <><path d="M6 6.5h12M6 12h12M6 17.5h12" /><circle cx="9" cy="6.5" r="1.8" /><circle cx="15" cy="12" r="1.8" /><circle cx="10" cy="17.5" r="1.8" /></>,
    prompts: <><path d="M5 5.5h14v10H9.5L5 19.5z" /><path d="M8.5 9.5h7M8.5 12.5h4.5" /></>,
    bundles: <><path d="M12 4.5v10M8 10.5l4 4 4-4" /><path d="M5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[kind] ?? <circle cx="12" cy="12" r="3" />}</svg>;
};

const editorNavButtonStyle = (active) => ({
  ...themeButtonStyle,
  background: active ? "rgba(255,255,255,0.1)" : "transparent",
  border: `1px solid ${active ? "rgba(255,255,255,0.18)" : "transparent"}`,
  color: active ? "#fff" : "rgba(236,236,240,0.72)",
  fontWeight: active ? 700 : 600,
  gap: "0.6rem",
  justifyContent: "flex-start",
  minHeight: "2.3rem",
  padding: "0 0.7rem",
  textAlign: "left",
  width: "100%",
});

const SectionBadge = ({ text }) => (
  <span style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.28)", borderRadius: "999px", color: "#fde68a", flexShrink: 0, fontSize: "0.57rem", fontWeight: 800, marginLeft: "auto", padding: "0.12rem 0.35rem" }}>
    {text}
  </span>
);

const EditorDrawer = ({
  details,
  editorError,
  editorSection,
  fileInputsRef,
  formState,
  isBusy,
  kind,
  onChange,
  onChangePrompt,
  onClearAsset,
  onClose,
  onDelete,
  onExportBundle,
  onExportPrompts,
  onFileSelect,
  onImportPrompts,
  onDetailsChange,
  onOpenFileDialog,
  onOpenMapEditor,
  onSave,
  promptSectionKey,
  setEditorSection,
  setPromptSectionKey,
  statsValue,
  onStatsChange,
  communityCard = null,
  onSuggestChanges = null,
  countryOptions = [],
}) => {
  const isMobile = useIsMobile();
  const touch = useTouchPrimary();
  if (!details || !formState) {
    return null;
  }

  const record = kind === "scenario" ? details.scenario : details.game;
  const visibleSections =
    kind === "scenario"
      ? ["overview", "world", "history", "fronts", "politics", "stats", "features", "prompts", "assets", "music", "bundles"]
      : ["overview", "world", "features", "prompts", "assets"];
  const groups = EDITOR_SECTION_GROUPS
    .map((group) => ({ ...group, sections: group.sections.filter((key) => visibleSections.includes(key)) }))
    .filter((group) => group.sections.length > 0);
  const formColumns = isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";
  const editorPoliticalWorld = kind === "scenario"
    ? politicalWorldCapability(details?.data?.world ?? {}, {
      polityCount: Array.isArray(details?.data?.world?.ownerCodes) ? details.data.world.ownerCodes.length : 0,
    })
    : null;
  const sectionBadges = editorPoliticalWorld?.status === POLITICAL_WORLD_CAPABILITY.ABSENT
    ? { politics: "No world" }
    : editorPoliticalWorld?.status === POLITICAL_WORLD_CAPABILITY.SPARSE
      ? { politics: "Partial" }
      : {};
  const coverUrl = kind === "scenario"
    ? details.scenario?.coverImageUrl
    : details.game?.coverImageUrl || details.scenario?.coverImageUrl;
  const accent = record.accentColor || "#a1a1aa";

  const actions = (
    <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", flexWrap: isMobile ? "wrap" : undefined, gap: "0.45rem" }}>
      <button
        className="oh-tap-row"
        onClick={onSave}
        style={touchFit({ ...themeButtonStyle, background: accent, borderColor: accent, borderRadius: "11px", boxShadow: `0 3px 12px ${accent}33`, color: "#fff", flex: isMobile ? "1 1 7rem" : undefined, fontWeight: 700, minHeight: "2.4rem", width: isMobile ? undefined : "100%" }, touch)}
        type="button"
      >
        {isBusy ? "Saving..." : "Save"}
      </button>
      {kind === "scenario" && onOpenMapEditor && (
        <button
          className="oh-tap-row"
          onClick={onOpenMapEditor}
          style={touchFit({ ...themeButtonStyle, background: "rgba(255,255,255,0.08)", flex: isMobile ? "1 1 9rem" : undefined, width: isMobile ? undefined : "100%" }, touch)}
          type="button"
        >
          🗺️ Open Map Editor
        </button>
      )}
      {kind === "scenario" && onSuggestChanges && record.hubOrigin && (
        <button
          className="oh-tap-row"
          onClick={onSuggestChanges}
          title="Send your changes to this community scenario's author, who can accept or reject each one."
          style={touchFit({ ...themeButtonStyle, background: "rgba(43,193,243,0.18)", borderColor: "rgba(43,193,243,0.45)", color: "#fff", flex: isMobile ? "1 1 9rem" : undefined, width: isMobile ? undefined : "100%" }, touch)}
          type="button"
        >
          Suggest changes
        </button>
      )}
      {record.canDelete && (
        <button
          className="oh-tap-row"
          onClick={onDelete}
          style={touchFit({ ...themeButtonStyle, background: "rgba(127,29,29,0.34)", borderColor: "rgba(248,113,113,0.28)", color: "#fecaca", flex: isMobile ? "1 1 6rem" : undefined, width: isMobile ? undefined : "100%" }, touch)}
          type="button"
        >
          Delete
        </button>
      )}
    </div>
  );

  return (
    <div
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: isMobile ? 0 : `calc(1.25rem + ${SAFE_TOP}) calc(1.25rem + ${SAFE_RIGHT}) calc(1.25rem + ${SAFE_BOTTOM}) calc(1.25rem + ${SAFE_LEFT})`,
        position: "fixed",
        zIndex: 10048,
      }}
    >
      <div
        role="dialog"
        aria-label={`${kind === "scenario" ? "Scenario" : "Game"} Editor`}
        style={{
          background: EDITOR_PANEL,
          border: isMobile ? "none" : "1px solid rgba(255,255,255,0.09)",
          borderRadius: isMobile ? 0 : "22px",
          boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
          color: "#fff",
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          height: isMobile ? APP_HEIGHT : `min(56rem, calc(${APP_HEIGHT} - 2.5rem - ${SAFE_TOP} - ${SAFE_BOTTOM}))`,
          overflow: "hidden",
          maxWidth: isMobile ? undefined : "76rem",
          width: "100%",
        }}
      >
        <nav
          style={{
            background: EDITOR_NAV,
            borderBottom: isMobile ? "1px solid rgba(255,255,255,0.08)" : "none",
            borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            gap: isMobile ? "0.6rem" : "1rem",
            overflow: isMobile ? "visible" : "hidden",
            padding: isMobile ? `calc(0.8rem + ${SAFE_TOP}) calc(0.8rem + ${SAFE_RIGHT}) 0.7rem calc(0.8rem + ${SAFE_LEFT})` : "1.1rem 0.9rem",
            width: isMobile ? "100%" : "15.5rem",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: "0.7rem", minWidth: 0 }}>
            <div
              aria-hidden="true"
              style={{
                background: coverUrl ? `url("${coverUrl}") center/cover, #1c1f27` : "#1c1f27",
                border: `2px solid ${accent}`,
                borderRadius: "12px",
                flexShrink: 0,
                height: isMobile ? "2.6rem" : "3.1rem",
                width: isMobile ? "2.6rem" : "3.1rem",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {kind === "scenario" ? "Scenario" : "Game"} Editor
              </div>
              <div style={{ fontSize: "0.98rem", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={record.name}>
                {record.name}
              </div>
            </div>
            {isMobile && (
              <button
                aria-label={`Close the ${kind === "scenario" ? "scenario" : "game"} editor`}
                className="oh-tap"
                onClick={onClose}
                style={touchFit({ ...themeButtonStyle, minWidth: "2.35rem", padding: 0 }, touch, { icon: true })}
                type="button"
              >
                <ButtonIcon kind="close" />
              </button>
            )}
          </div>

          {isMobile ? (
            <div style={{ display: "flex", gap: "0.4rem", overflowX: "auto", scrollbarWidth: "none" }}>
              {groups.flatMap((group) => group.sections).map((sectionKey) => (
                <button
                  key={sectionKey}
                  aria-current={editorSection === sectionKey ? "page" : undefined}
                  className="oh-tap-row"
                  onClick={() => setEditorSection(sectionKey)}
                  style={touchFit({ ...editorNavButtonStyle(editorSection === sectionKey), border: `1px solid ${editorSection === sectionKey ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`, flexShrink: 0, width: "auto" }, touch)}
                  type="button"
                >
                  <EditorSectionIcon kind={sectionKey} size={15} />
                  {editorSectionLabels[sectionKey] || sectionKey}
                  {sectionBadges[sectionKey] && <SectionBadge text={sectionBadges[sectionKey]} />}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.9rem", minHeight: 0, overflowY: "auto", scrollbarWidth: "thin" }}>
              {groups.map((group) => (
                <div key={group.label}>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.09em", marginBottom: "0.35rem", padding: "0 0.7rem", textTransform: "uppercase" }}>
                    {group.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                    {group.sections.map((sectionKey) => (
                      <button
                        key={sectionKey}
                        aria-current={editorSection === sectionKey ? "page" : undefined}
                        className="oh-tap-row"
                        onClick={() => setEditorSection(sectionKey)}
                        style={touchFit(editorNavButtonStyle(editorSection === sectionKey), touch)}
                        type="button"
                      >
                        <EditorSectionIcon kind={sectionKey} />
                        <span>{editorSectionLabels[sectionKey] || sectionKey}</span>
                        {sectionBadges[sectionKey] && <SectionBadge text={sectionBadges[sectionKey]} />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isMobile && actions}
        </nav>

        <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          {!isMobile && (
            <div style={{ alignItems: "flex-start", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexShrink: 0, gap: "1rem", justifyContent: "space-between", padding: "1.15rem 1.4rem 1rem" }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ color: "#fff", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                  {editorSectionLabels[editorSection] || editorSection}
                </h2>
                {EDITOR_SECTION_BLURBS[editorSection] && (
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.8rem", lineHeight: 1.45, marginTop: "0.25rem" }}>
                    {EDITOR_SECTION_BLURBS[editorSection]}
                  </div>
                )}
              </div>
              <button
                aria-label={`Close the ${kind === "scenario" ? "scenario" : "game"} editor`}
                className="oh-tap"
                onClick={onClose}
                style={touchFit({ ...themeButtonStyle, flexShrink: 0, minWidth: "2.35rem", padding: 0 }, touch, { icon: true })}
                type="button"
              >
                <ButtonIcon kind="close" />
              </button>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? `1rem calc(0.9rem + ${SAFE_RIGHT}) 1rem calc(0.9rem + ${SAFE_LEFT})` : "1.2rem 1.4rem 1.6rem" }}>
      {editorSection === "overview" && kind === "scenario" && communityCard}
      {editorSection === "overview" && (
        <>
          <div style={editorCardStyle}>
            <div style={editorCardTitleStyle}>On its card</div>
            <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: formColumns }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={fieldLabelStyle}>Name</label>
                <input style={inputStyle} value={formState.name} onChange={(event) => onChange("name", event.target.value)} />
              </div>
              <div>
                <label style={fieldLabelStyle}>Eyebrow</label>
                <input style={inputStyle} value={formState.eyebrow} onChange={(event) => onChange("eyebrow", event.target.value)} />
              </div>
              <div>
                <label style={fieldLabelStyle}>Accent</label>
                <input style={{ ...inputStyle, height: "3.1rem", padding: "0.25rem 0.3rem" }} type="color" value={formState.accentColor} onChange={(event) => onChange("accentColor", event.target.value)} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={fieldLabelStyle}>Subtitle</label>
                <input style={inputStyle} value={formState.subtitle} onChange={(event) => onChange("subtitle", event.target.value)} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={fieldLabelStyle}>Description</label>
                <textarea style={{ ...textareaStyle, minHeight: "6rem" }} value={formState.description} onChange={(event) => onChange("description", event.target.value)} />
              </div>
            </div>
          </div>
          <div style={editorCardStyle}>
            <div style={editorCardTitleStyle}>Its headline</div>
            <div style={{ display: "grid", gap: "0.8rem" }}>
              <div>
                <label style={fieldLabelStyle}>Hero Title</label>
                <input style={inputStyle} value={formState.heroTitle} onChange={(event) => onChange("heroTitle", event.target.value)} />
              </div>
              <div>
                <label style={fieldLabelStyle}>Hero Subtitle</label>
                <textarea style={{ ...textareaStyle, minHeight: "5rem" }} value={formState.heroSubtitle} onChange={(event) => onChange("heroSubtitle", event.target.value)} />
              </div>
            </div>
          </div>
        </>
      )}

      {editorSection === "world" && (
        <>
          <div style={editorCardStyle}>
            <div style={editorCardTitleStyle}>Where play begins</div>
            <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: formColumns }}>
              <div>
                <label style={fieldLabelStyle}>Player Country</label>
                <input list="oh-player-country-options" style={inputStyle} value={formState.country} onChange={(event) => onChange("country", event.target.value)} />
                <datalist id="oh-player-country-options">
                  {countryOptions.map((option) => (
                    <option key={option.code} value={option.code} label={option.name !== option.code ? option.name : undefined} />
                  ))}
                </datalist>
                {!isOfferedCountry(formState.country, countryOptions) && (
                  <div style={{ color: "#fde68a", fontSize: "0.72rem", lineHeight: 1.4, marginTop: "0.4rem" }}>
                    No country or faction by this name is on this map, so the player would start with nothing. Pick one from the list.
                  </div>
                )}
              </div>
              <div>
                <label style={fieldLabelStyle}>Game Date</label>
                <input
                  style={inputStyle}
                  value={formState.gameDate}
                  onChange={(event) => onChange("gameDate", event.target.value)}
                  placeholder="YYYY-MM-DD — before AD 1 use a minus: -0218-03-01 is 1 March 218 BC"
                  title="Dates are YYYY-MM-DD. A year before AD 1 carries a leading minus and counts backwards with no year zero: -0218-03-01 is 1 March 218 BC, -0001-12-31 the last day of 1 BC."
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Language</label>
                <input style={inputStyle} value={formState.language} onChange={(event) => onChange("language", event.target.value)} />
              </div>
            </div>
          </div>
          {kind === "scenario" && (
            <div style={editorCardStyle}>
              <div style={editorCardTitleStyle}>Deployable Troop Types</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {UNIT_TYPES.map((unitType) => {
                  const checked = (formState.allowedUnitTypes ?? []).includes(unitType);
                  return (
                    <button
                      key={unitType}
                      type="button"
                      className="oh-tap-row"
                      onClick={() => {
                        const set = new Set(formState.allowedUnitTypes ?? []);
                        if (set.has(unitType)) set.delete(unitType);
                        else set.add(unitType);
                        onChange("allowedUnitTypes", UNIT_TYPES.filter((t) => set.has(t)));
                      }}
                      style={touchFit({
                        ...themeButtonStyle,
                        background: checked ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                        borderColor: checked ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
                        minHeight: "2rem",
                        padding: "0 0.7rem",
                      }, touch)}
                    >
                      {checked ? "✓ " : ""}
                      {UNIT_TYPE_LABELS[unitType] ?? unitType}
                    </button>
                  );
                })}
              </div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.5rem" }}>
                Uncheck types that don't fit the era — e.g. no Air Force in 1200. Players can only deploy the checked types.
              </div>
            </div>
          )}
          <div style={editorCardStyle}>
            <div style={editorCardTitleStyle}>The story so far</div>
            <div style={{ display: "grid", gap: "0.8rem" }}>
              <div>
                <label style={fieldLabelStyle}>World Before Round One</label>
                <textarea style={{ ...textareaStyle, minHeight: "8rem" }} value={formState.startingTimelineText} onChange={(event) => onChange("startingTimelineText", event.target.value)} />
              </div>
              <div>
                <label style={fieldLabelStyle}>Simulation Rules</label>
                <textarea style={{ ...textareaStyle, minHeight: "8rem" }} value={formState.simulationRules} onChange={(event) => onChange("simulationRules", event.target.value)} />
              </div>
            </div>
          </div>
          <div style={editorCardStyle}>
            <div style={editorCardTitleStyle}>Country labels on the map</div>
            <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
              <div>
                <label style={fieldLabelStyle}>Country Label Font</label>
                <input
                  list="oh-label-font-options"
                  placeholder="Georgia (default)"
                  style={inputStyle}
                  value={formState.labelFont}
                  onChange={(event) => onChange("labelFont", event.target.value)}
                />
                <datalist id="oh-label-font-options">
                  {LABEL_FONT_SUGGESTIONS.map((font) => (
                    <option key={font} value={font} />
                  ))}
                </datalist>
              </div>
              <div>
                <label style={fieldLabelStyle}>Label Letter Color</label>
                <input
                  type="color"
                  style={{ ...inputStyle, height: "2.4rem", padding: "0.2rem" }}
                  value={/^#[0-9a-fA-F]{6}$/.test(formState.labelTextColor) ? formState.labelTextColor : "#ffffff"}
                  onChange={(event) => onChange("labelTextColor", event.target.value)}
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Label Border Color</label>
                <input
                  type="color"
                  style={{ ...inputStyle, height: "2.4rem", padding: "0.2rem" }}
                  value={/^#[0-9a-fA-F]{6}$/.test(formState.labelHaloColor) ? formState.labelHaloColor : "#000000"}
                  onChange={(event) => onChange("labelHaloColor", event.target.value)}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {editorSection === "history" && kind === "scenario" && (
        <PrehistoryPanel
          details={details}
          onDetailsChange={onDetailsChange}
        />
      )}

      {/* How its wars are fought (ScenarioWarSettings.jsx): part of the form,
          which Save below writes. Then the fronts it begins with, which have
          a Save of their own. */}
      {editorSection === "fronts" && kind === "scenario" && (
        <ScenarioWarSettings
          value={formState.warSettings ?? null}
          gameDate={formState.gameDate}
          onChange={(next) => onChange("warSettings", next)}
        />
      )}

      {/* Every country's military figures, rated by the AI against the others twenty to a request
          (ScenarioMilitaryPanel.jsx): saved into the scenario batch by batch, as the Politics tab's are. */}
      {editorSection === "fronts" && kind === "scenario" && (
        <ScenarioMilitaryPanel
          details={details}
          onDetailsChange={onDetailsChange}
          gameDate={formState.gameDate}
          warSettings={formState.warSettings ?? null}
        />
      )}

      {editorSection === "fronts" && kind === "scenario" && (
        <ScenarioFrontsPanel
          details={details}
          onDetailsChange={onDetailsChange}
        />
      )}

      {editorSection === "politics" && kind === "scenario" && (
        <>
          <Suspense
            fallback={
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem", color: "rgba(255,255,255,0.6)", fontSize: "0.8rem" }}>
                Loading Political World tools...
              </div>
            }
          >
            <PoliticalWorldGenerationPanel
              details={details}
              formState={formState}
              onDetailsChange={onDetailsChange}
            />
          </Suspense>
          <Suspense
            fallback={
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem", color: "rgba(255,255,255,0.6)", fontSize: "0.8rem" }}>
                Loading manual Political World editor...
              </div>
            }
          >
            <PoliticalWorldAuthoringPanel
              details={details}
              onDetailsChange={onDetailsChange}
            />
          </Suspense>
          <InstitutionAuthoringPanel
            details={details}
            onDetailsChange={onDetailsChange}
          />
        </>
      )}

      {editorSection === "stats" && kind === "scenario" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.92rem", fontWeight: 800, marginBottom: "0.2rem" }}>National Stats</div>
          <div style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.7rem", lineHeight: 1.45, marginBottom: "0.8rem" }}>
            Define the entire National Stats sheet for this scenario. Sections, values, units, order, icons, colours and AI guidance are scenario data and travel with exports.
          </div>
          <StatsSheetEditor value={statsValue} onChange={onStatsChange} />
        </div>
      )}

      {editorSection === "features" && (
        <FeaturesSectionEditor
          kind={kind}
          features={formState.features}
          scenarioFeatures={kind === "scenario" ? formState.features : formState.scenarioFeatures}
          world={details?.data?.world ?? {}}
          onChange={(next) => onChange("features", next)}
          styles={{ actionButtonStyle: themeButtonStyle, fieldLabelStyle, inputStyle }}
          currentDate={formState.gameDate}
          firstSkipAhead={kind === "scenario" || !(details?.data?.world?.simulationHistory?.length > 0)}
        />
      )}

      {editorSection === "prompts" && (
        <PromptSectionEditor
          onChangePrompt={onChangePrompt}
          onExportPromptPack={kind === "scenario" ? onExportPrompts : null}
          onImportPromptPack={kind === "scenario" ? onImportPrompts : null}
          promptPack={formState.prompts}
          promptSectionKey={promptSectionKey}
          setPromptSectionKey={setPromptSectionKey}
        />
      )}

      {editorSection === "assets" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ display: "grid", gap: "0.7rem" }}>
            {Object.entries(kind === "scenario" ? scenarioAssetLabels : gameAssetLabels).map(([assetKey, label]) => {
              const isCoverAsset = assetKey === "cover";
              const hasOwnAsset = Boolean(details.assetStatus?.[assetKey]);
              const previewUrl = isCoverAsset
                ? kind === "scenario"
                  ? details.scenario?.coverImageUrl
                  : details.game?.coverImageUrl || details.scenario?.coverImageUrl
                : null;
              const fallbackText =
                kind === "scenario"
                  ? isCoverAsset
                    ? "Displayed on this scenario card."
                    : "Using default/base asset"
                  : details.scenario?.coverImageUrl
                    ? "Using the linked scenario cover image."
                    : "No custom cover image.";

              return (
                // On a phone the Upload and Reset buttons drop below the text
                // rather than squeezing it to a word per line.
                <div key={assetKey} style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", display: "flex", flexWrap: isMobile ? "wrap" : undefined, gap: "0.75rem", justifyContent: "space-between", padding: "0.72rem 0.78rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{label}</div>
                    <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.78rem", marginTop: "0.15rem" }}>
                      {hasOwnAsset
                        ? isCoverAsset
                          ? kind === "scenario"
                            ? "Stored in this scenario."
                            : "Stored in this session."
                          : "Stored in this scenario bundle"
                        : fallbackText}
                    </div>
                    {isCoverAsset && previewUrl && (
                      <img
                        alt={`${record.name} cover`}
                        src={previewUrl}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "12px",
                          display: "block",
                          height: "4.8rem",
                          marginTop: "0.7rem",
                          objectFit: "cover",
                          width: "8.6rem",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.45rem" }}>
                    <button className="oh-tap-row" onClick={() => onOpenFileDialog(assetKey)} style={touchFit(themeButtonStyle, touch)} type="button">
                      Upload
                    </button>
                    <button
                      className="oh-tap-row"
                      onClick={() => onClearAsset(assetKey)}
                      style={touchFit({
                        ...themeButtonStyle,
                        background: "rgba(255,255,255,0.03)",
                        color: hasOwnAsset ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.35)",
                      }, touch)}
                      disabled={!hasOwnAsset}
                      type="button"
                    >
                      Reset
                    </button>
                    <input
                      ref={(node) => {
                        fileInputsRef.current[assetKey] = node;
                      }}
                      accept={acceptFor((kind === "scenario" ? scenarioAssetAccept : gameAssetAccept)[assetKey])}
                      onChange={(event) => onFileSelect(assetKey, event)}
                      style={{ display: "none" }}
                      type="file"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The hub tracks the scenario plays in each situation of a game
          (ScenarioMusicPanel.jsx). Part of the form: Save below writes them. */}
      {editorSection === "music" && kind === "scenario" && (
        <ScenarioMusicPanel
          music={formState.music}
          onChange={(next) => onChange("music", next)}
        />
      )}

      {editorSection === "bundles" && kind === "scenario" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.85rem" }}>
            Download the scenario as one self-contained file — custom map geometry, cities and basemap all travel with it, ready to share or re-import. The <strong>.zip</strong> carries a custom basemap as a real image file (smaller, and the form the community hub expects); the <strong>JSON</strong> packs everything into one text file.
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "10px", color: "rgba(255,255,255,0.88)", fontSize: "0.8rem", lineHeight: 1.5, marginBottom: "0.85rem", padding: "0.55rem 0.7rem" }}>
            <div style={{ fontWeight: 700 }}>A scenario you post or share in any way is released under CC BY 4.0.</div>
            <div>The file says so.</div>
            <a href={SCENARIO_LICENSE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.88)" }}>About CC BY 4.0 ↗</a>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
            <button className="oh-tap-row" onClick={() => onExportBundle("zip")} style={touchFit(themeButtonStyle, touch)} type="button">
              Download .zip
            </button>
            <button className="oh-tap-row" onClick={() => onExportBundle("json")} style={touchFit(themeButtonStyle, touch)} type="button">
              Download JSON
            </button>
          </div>
        </div>
      )}

      {editorError && (
        <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: "14px", color: "#fecaca", marginTop: "0.4rem", padding: "0.8rem 0.9rem" }}>
          {editorError}
        </div>
      )}
          </div>

          {isMobile && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", flexShrink: 0, padding: `0.7rem calc(0.9rem + ${SAFE_RIGHT}) calc(0.7rem + ${SAFE_BOTTOM}) calc(0.9rem + ${SAFE_LEFT})` }}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const LibraryTopBar = ({ onOpenSettings }) => {
  const {
    activeGame,
    activeGameId,
    countryNames,
    error,
    games,
    loaded,
    loading,
    runtimeScenario,
    scenarios,
    selectedScenarioId,
  } = useLibraryState();
  const [activeTab, setActiveTab] = useState("games");
  // The history of the game's updates, opened from the menu's mark (updates/UpdateHistory.jsx).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [gameSearch, setGameSearch] = useState(() => gameShelfMemory.search);
  const [gameSort, setGameSort] = useState(() => gameShelfMemory.sort);
  const [gameView, setGameView] = useState(() => gameShelfMemory.view);
  useEffect(() => {
    gameShelfMemory.search = gameSearch;
    gameShelfMemory.sort = gameSort;
    gameShelfMemory.view = gameView;
  }, [gameSearch, gameSort, gameView]);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [scenarioSort, setScenarioSort] = useState("recent");
  const [scenarioView, setScenarioView] = useState("all");
  // The Lobbies tab's host settings, opened by its "Host a lobby" action.
  const [lobbyHosting, setLobbyHosting] = useState(false);
  const [menuOpen, setMenuOpenState] = useState(menuOpenDefault);
  // Whether the player has opened a game since the page started
  // (runtime/gameEntry.js). Until then the library's active game is only the
  // one last played, and nothing of it is loaded behind this menu.
  const gameEntered = useGameEntered();
  // Whether the menu was opened from inside a game (⌂ Exit Game, or the game
  // menu's Game Management), so that a phone's Back can close it again and
  // return to the game. Opened any other way, above all at boot, the menu is
  // the front page with nothing behind it, and there Back leaves the app as it
  // always has. Per instance on purpose: after a remount the game behind the
  // menu is not the one the player left.
  const [menuOverGame, setMenuOverGame] = useState(false);
  // The module-level default is the ONLY value that survives the keyed UI
  // remount a game activation triggers, so every open/close writes it first.
  // Flows that activate a game flip it BEFORE awaiting the request — the
  // remount happens mid-await, and the new instance must mount closed.
  // An instance the activation already unmounted must not write it: its own
  // copy is gone, and the live instance's would disagree with isMainMenuOpen().
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const setMenuOpen = (open) => {
    if (!mountedRef.current) return;
    menuOpenDefault = open;
    setMenuOpenState(open);
    if (!open) setMenuOverGame(false);
    mainMenuListeners.forEach((listener) => listener());
  };
  // The ⌂ Exit Game buttons: the menu, over the game the player is in.
  const exitToMenu = () => {
    setMenuOverGame(true);
    setMenuOpen(true);
  };
  // The menu closes over the game that is ALREADY the active one, with the
  // library opening nothing: hosting a lobby (the game the player has is the
  // lobby) and joining one (the host's game is shown in a stand-in that is
  // activated later, when the host has answered). At startup that game is not
  // loaded (runtime/gameEntry.js), and nothing else here would load it: every
  // other way out of the menu goes through activateGame or
  // createGame({ setActive }), which enter the game they open.
  const enterActiveGame = () => {
    enterGame();
    setMenuOpen(false);
  };
  _enterActiveGame = enterActiveGame;
  // Bridge for outside callers: open the main menu on a library tab.
  _openLibraryTab = (tab) => {
    setActiveTab(tab);
    if (!menuOpenDefault) setMenuOverGame(true);
    setMenuOpen(true);
  };
  const [editorKind, setEditorKind] = useState(null);
  const [editorDetails, setEditorDetails] = useState(null);
  const [editorState, setEditorState] = useState(null);
  // The scenario the drawer is open on, for work that ends later and has to
  // know whether the drawer still shows what it replaced (handleScenarioUpdate:
  // a download takes seconds, and the drawer can be closed or moved meanwhile).
  const editorScenarioIdRef = useRef(null);
  useEffect(() => {
    editorScenarioIdRef.current = editorKind === "scenario" ? editorDetails?.scenario?.id ?? null : null;
  }, [editorKind, editorDetails]);
  const [editorStats, setEditorStats] = useState(() => normalizeStatsEditorValue(null));
  // The Stats sheet as last loaded or saved, to tell an unsaved edit from none.
  const editorStatsSavedRef = useRef(editorStats);
  const adoptSavedStats = (value) => {
    editorStatsSavedRef.current = value;
    setEditorStats(value);
  };
  // The open scenario's Stats sheet failed to download: Save leaves it alone.
  const [editorStatsFailed, setEditorStatsFailed] = useState(false);
  const [editorError, setEditorError] = useState(null);
  // What delete moved to the trash (GET /api/trash), for the Recently deleted
  // shelves and the delete confirmation. null until it loads, and where the
  // store will not serve it: the shelves then stay hidden.
  const [trash, setTrash] = useState(null);
  const refreshTrash = () => listTrash().then(setTrash, () => setTrash(null));
  const [editorSection, setEditorSection] = useState("overview");
  const [promptSectionKey, setPromptSectionKey] = useState("leader");
  const [isBusy, setIsBusy] = useState(false);
  const assetFileInputsRef = useRef({});
  const importScenarioInputRef = useRef(null);
  const importGameInputRef = useRef(null);
  // The game whose map this library does not hold, while its prompt is up.
  const [missingScenarioGame, setMissingScenarioGame] = useState(null);

  useEffect(() => {
    if (!loaded) {
      ensureLibraryCatalog().catch(() => {});
    }
  }, [loaded]);

  // Read each time the menu opens: a delete, a restore and the startup purge
  // all change it.
  useEffect(() => {
    if (menuOpen) refreshTrash();
  }, [menuOpen]);

  // A game played on a scenario whose community basemap could not be
  // downloaded tries it again too (runtime/missingBasemap.js), once a session.
  // Played, not merely last played: at startup no game is open, and its
  // scenario's basemap is not this menu's to download.
  useEffect(() => {
    if (gameEntered && runtimeScenario?.missingBasemap) retryMissingBasemap(runtimeScenario);
  }, [gameEntered, runtimeScenario]);

  const resetEditor = () => {
    setEditorKind(null);
    setEditorDetails(null);
    setEditorState(null);
    adoptSavedStats(normalizeStatsEditorValue(null));
    setEditorStatsFailed(false);
    setEditorError(null);
    setEditorSection("overview");
    setPromptSectionKey("leader");
  };

  // The drawer's X and a phone's Back: asks first when the form or the Stats
  // sheet holds changes not saved. Returns false when the player stays, which
  // keeps Back's step (runtime/backToClose.js).
  const closeEditor = () => {
    const unsaved = Boolean(editorKind && editorDetails && editorState) && (
      formDiffers(editorState, editorKind === "scenario" ? buildScenarioEditorState(editorDetails) : buildGameEditorState(editorDetails))
      || formDiffers(editorStats, editorStatsSavedRef.current)
    );
    if (unsaved && !window.confirm("Close the editor? The changes you have not saved will be lost.")) return false;
    resetEditor();
    return true;
  };

  const openScenarioEditor = async (scenarioId) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      // A Stats sheet that failed to download (rather than one the scenario
      // does not have) must not read as "the standard sheet": Save would then
      // delete the author's custom one. It is left out of Save instead.
      let statsFailed = false;
      const [details, statsAsset] = await Promise.all([
        loadScenarioDetails(scenarioId),
        downloadScenarioJsonAsset(scenarioId, "stats").catch(() => {
          statsFailed = true;
          return null;
        }),
      ]);
      setEditorKind("scenario");
      setEditorDetails(details);
      setEditorState(buildScenarioEditorState(details));
      // Its community basemap, if the import could not download it: tried again
      // once a session (runtime/missingBasemap.js). The details only when it
      // lands, as for an uploaded asset: the form holds none.
      retryMissingBasemap(details.scenario).then((retry) => {
        if (!retry) return;
        if (retry.restored) {
          setEditorDetails((current) => (current?.scenario?.id === scenarioId ? retry.details : current));
        } else {
          setEditorError(`This scenario's community basemap could not be downloaded. ${retry.reason} The game tries again the next time you start it and open the scenario.`);
        }
      });
      adoptSavedStats(normalizeStatsEditorValue(statsAsset));
      setEditorStatsFailed(statsFailed);
      if (statsFailed) setEditorError("This scenario's Stats sheet could not be loaded, so Save leaves it as it is. Close the editor and open it again to edit it.");
      setEditorSection("overview");
      setPromptSectionKey("leader");
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const openGameEditor = async (gameId) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await loadGameDetails(gameId);
      setEditorKind("game");
      setEditorDetails(details);
      setEditorState(buildGameEditorState(details));
      setEditorSection("overview");
      setPromptSectionKey("leader");
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Create the game from the scenario with the starting country and difficulty
  // the player chose in the two-step picker, and go straight into it.
  const startGameForCountry = async (scenario, countryCode, difficulty) => {
    setCountryPicker(null);
    setCustomRegionData(null); setPickerOwnerOverrides(null); setPickerColors(null); setPickerBackground(null);
    setEditorError(null);
    setIsBusy(true);
    // Before the await: createGame({setActive}) remounts the UI mid-flight and
    // the remounted menu must come up closed, over the new game.
    setMenuOpen(false);
    try {
      // gamePatch merges — a full `game` write would REPLACE game.json and wipe
      // startDate/gameDate/round (the "Undated" bug). It rides on the create
      // itself: patched in a second request, after `setActive` had switched to
      // the game, the opening cover and the HUD named the scenario's default
      // country until it landed.
      const gamePatch = { ...(countryCode ? { country: countryCode } : null), ...(difficulty ? { difficulty } : null) };
      await createGame({
        name: `${scenario.name} Session`,
        scenarioId: scenario.id,
        ...(Object.keys(gamePatch).length ? { gamePatch } : null),
        setActive: true,
      });
      // The UI remounts around the new game, menu closed, and play begins. Its
      // editor is not opened: the call that did so ran in the instance being
      // unmounted and never showed, and players start straight into the game.
    } catch (nextError) {
      setMenuOpen(true);
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // The world a new game was seeded with, read to merge the player's polity
  // into; a read that fails stops the start (seededWorldOf).
  const readNewGameWorld = async (gameId, name) =>
    seededWorldOf(await loadGameDetails(gameId).catch(() => null), name);

  // Create a game led by a player-invented faction. It is written into the game's
  // OWN world/colors/flags — a game carries its own copies and falls back to the
  // scenario only for what it doesn't set, so the scenario is never touched.
  const startGameForFaction = async (scenario, faction, difficulty) => {
    setCountryPicker(null);
    setCustomRegionData(null); setPickerOwnerOverrides(null); setPickerColors(null); setPickerBackground(null);
    setEditorError(null);
    setIsBusy(true);
    setMenuOpen(false);
    let gameId = null;
    try {
      const details = await createGame({
        name: `${faction.name} — ${scenario.name}`,
        scenarioId: scenario.id,
        // The faction's name from the first moment the game is active (the
        // opening cover reads it); the save below writes it again once the
        // faction is in the world it resolves against.
        gamePatch: { country: faction.name, ...(difficulty ? { difficulty } : null) },
        setActive: true,
      });
      gameId = details.game.id;

      // Read the game's world, which createGame seeded from the scenario, and merge
      // the faction into its existing maps. This read-merge-write is load-bearing:
      // saveGame writes `world` whole (a worldPatch would SHALLOW-merge, replacing
      // polityOverrides/ownerCodes/regionOwnershipOverrides outright and wiping
      // every other country on the map).
      const { world, name, color: hexColor } = worldWithFaction(await readNewGameWorld(gameId, faction.name), faction);

      await saveGame(gameId, { world, gamePatch: { country: name, ...(difficulty ? { difficulty } : null) } });

      // Colour and flag live in their own runtime assets. createGame set this game
      // active, so JSON_URLS.colors/flags now resolve to it — and reading them gives
      // the EFFECTIVE asset (the scenario's, since a fresh game has none of its own).
      // Read-merge-write materialises that whole palette into the game with the
      // faction added; writing only the faction would shadow the scenario file and
      // leave every other country uncoloured. This is the "Add Country" cheat's path.
      try {
        const colors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
        await writeJson(JSON_URLS.colors, { ...colors, [name]: hexToRgbArray(hexColor) }, { pretty: true });
      } catch { /* colours are cosmetic — a landless faction paints nothing anyway */ }

      if (faction.flag) {
        try {
          const flags = await readJson(JSON_URLS.flags, { defaultValue: {}, force: true });
          await writeJson(JSON_URLS.flags, { ...flags, [name]: faction.flag }, { pretty: true });
        } catch { /* flag is cosmetic */ }
      }
    } catch (nextError) {
      if (gameId) {
        // Activated already: the remounted UI opens the game and says why.
        handOffAfterActivation({ gameId, editor: true, error: nextError.message });
      } else {
        setMenuOpen(true);
        setEditorError(nextError.message);
      }
    } finally {
      setIsBusy(false);
    }
  };

  // The groups a scenario has, for the picker's "Play as a group" tab: name,
  // colour, what it is and how much it controls (runtime/groups.js).
  const scenarioGroupsFor = (world) => {
    const groups = normalizeGroups(world?.groups);
    const areas = groupRegions(normalizeGroupAreas(world?.groupAreas, groups));
    return Object.values(groups).map((group) => ({ ...group, regionCount: (areas[group.name] ?? []).length }));
  };

  // Create a game led by a group rather than a country (runtime/groups.js). The
  // player's polity is a LANDLESS polity and the group of the same name: the polity
  // carries everything keyed by the player (flag, colour, diplomacy, orders), the
  // group the area the map draws and what the story knows the player is. Written
  // into the game's own world, like a faction, so the scenario is never touched.
  const startGameForGroup = async (scenario, group, difficulty) => {
    setCountryPicker(null);
    setCustomRegionData(null); setPickerOwnerOverrides(null); setPickerColors(null); setPickerBackground(null);
    setEditorError(null);
    setIsBusy(true);
    setMenuOpen(false);
    let gameId = null;
    try {
      const name = String(group.name ?? "").trim();
      const details = await createGame({
        name: `${name} — ${scenario.name}`,
        scenarioId: scenario.id,
        gamePatch: { country: name, ...(difficulty ? { difficulty } : null) },
        setActive: true,
      });
      gameId = details.game.id;
      // The same read-merge-write as a faction (see startGameForFaction): saveGame
      // writes `world` whole.
      const { world, key, color: hexColor } = worldWithPlayerGroup(await readNewGameWorld(gameId, name), group);

      await saveGame(gameId, { world, gamePatch: { country: key, ...(difficulty ? { difficulty } : null) } });

      try {
        const colors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
        await writeJson(JSON_URLS.colors, { ...colors, [key]: hexToRgbArray(hexColor) }, { pretty: true });
      } catch { /* colours are cosmetic — the group's area draws in its own colour */ }
      if (group.flag) {
        try {
          const flags = await readJson(JSON_URLS.flags, { defaultValue: {}, force: true });
          await writeJson(JSON_URLS.flags, { ...flags, [key]: group.flag }, { pretty: true });
        } catch { /* flag is cosmetic */ }
      }
    } catch (nextError) {
      if (gameId) {
        handOffAfterActivation({ gameId, editor: true, error: nextError.message });
      } else {
        setMenuOpen(true);
        setEditorError(nextError.message);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const getBaseCountryOptions = () =>
    Object.entries(countryNames ?? {}).map(([code, name]) => ({ code, name }));

  // "New Game" now opens a country picker first (the player chooses who to play).
  // The scenario's own basemap for the picker: the descriptor says whether
  // there is one, background.json carries it - the same two the game map reads
  // (useCustomBackground). Nothing to load means ESRI, as before.
  const loadPickerBackground = (scenarioId, descriptor, isCurrent) => {
    const kind = descriptor?.kind;
    if (kind === "plain") {
      setPickerBackground({ kind });
      return;
    }
    if (kind !== "image" && kind !== "vector") return;
    downloadScenarioJsonAsset(scenarioId, "backgroundData")
      .then((data) => {
        if (!isCurrent()) return;
        if (kind === "image" && data?.dataUrl) setPickerBackground({ kind, imageUrl: data.dataUrl, bounds: descriptor.bounds ?? null });
        else if (kind === "vector" && data?.geojson) setPickerBackground({ kind, geojson: data.geojson });
      })
      .catch(() => {});
  };

  const handleScenarioPlay = (scenario) => {
    // Loads for a picker the player has since closed, or opened on another
    // scenario, never land in this one (a late A could offer A's countries and
    // borders in B's picker, and start a B game as a country B does not have).
    const isCurrent = pickerRequest.begin();
    setCountryQuery("");
    setCountryOptions([]);
    setCustomRegionData(null); setPickerOwnerOverrides(null); setPickerColors(null); setPickerBackground(null);
    setPlayGameId(null);
    setPickerTab("country");
    setPickerGroups([]);
    setCountryPicker(scenario);
    // A community basemap the import could not download is tried again (once a
    // session), and shown in the picker when it lands.
    retryMissingBasemap(scenario).then((retry) => {
      if (retry?.restored && isCurrent()) loadPickerBackground(scenario.id, retry.details?.data?.world?.background, isCurrent);
    });
    Promise.all([loadCountryNames().catch(() => []), loadScenarioDetails(scenario.id).catch(() => null)])
      .then(([allCountries, details]) => {
        if (!isCurrent()) return;
        setCountryOptions(buildScenarioCountryOptions(
          details?.data?.world,
          [...getBaseCountryOptions(), ...allCountries],
          scenario.countryNameOverrides,
        ));
        // Needed whether or not the scenario has geometry of its own: with it the
        // stock seed is repainted in this scenario's owners, without it the picker
        // shows modern countries the scenario does not contain.
        setPickerOwnerOverrides(details?.data?.world?.regionOwnershipOverrides ?? null);
        downloadScenarioJsonAsset(scenario.id, "colors")
          .then((colors) => { if (colors && typeof colors === "object" && isCurrent()) setPickerColors(colors); })
          .catch(() => {});
        setPickerGroups(scenarioGroupsFor(details?.data?.world));
        // Load custom region geometry so the map renders the scenario's actual
        // boundaries instead of the stock world seed.
        if (details?.data?.world?.customRegions) {
          downloadScenarioJsonAsset(scenario.id, "regionsGeojson", { coarse: true })
            .then((geojson) => { if (geojson && isCurrent()) setCustomRegionData(geojson); })
            .catch(() => {});
        }
        // And the scenario's own basemap, when it has one, so the picker shows
        // the map the player is about to play on rather than the ESRI canvas.
        loadPickerBackground(scenario.id, details?.data?.world?.background, isCurrent);
      })
      .catch(() => { if (isCurrent()) setCountryOptions([]); });
  };

  // Hub update detection: scenarios imported straight from the community tab
  // carry hubOrigin, and those not modified since (no editedAt) can take the
  // post's newer file. One downloaded the old way, from an attachment the hub
  // had not checked (no hubOrigin.release), is asked to take the checked file
  // whether it was modified or not, and a modified one can be updated from
  // Suggest changes when the file it came from is gone. So when the Scenarios
  // tab shows any scenario from the hub, fetch the hub posts
  // (runtime/hubPosts.js; its 5-minute cache dedupes) and compare each post's
  // CURRENT bundle file against the one imported. A silent failure just means
  // no Update buttons — offline behaves exactly as before, and a post that is
  // no longer on the hub leaves its copies as they are.
  const [hubPostById, setHubPostById] = useState(null);
  useEffect(() => {
    if (!menuOpen || activeTab !== "scenarios" || !scenarios.some((entry) => entry.hubOrigin)) return undefined;
    let cancelled = false;
    fetchHubPosts()
      .then((posts) => {
        if (cancelled) return;
        const byId = {};
        for (const post of posts) byId[post.id] = post;
        setHubPostById(byId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [menuOpen, activeTab, scenarios]);

  // Why a scenario's card asks for an Update, or null. An edited copy is never
  // overwritten for a newer file: its player suggests their changes to the
  // post instead, and keeps their copy. Only an old link reaches one. The
  // Community tab's cards ask the same question (runtime/hubPosts.js).
  const scenarioUpdateReason = (scenario) =>
    hubUpdateReason(scenario, scenario.hubOrigin ? hubPostById?.[scenario.hubOrigin.postId] : null);

  // The scenarios being updated now: each one's cards (it can sit on both
  // shelves) show it and cannot be pressed again until it lands or fails.
  const updatingScenarioIds = useSyncExternalStore(scenarioUpdates.subscribe, scenarioUpdates.running, scenarioUpdates.running);
  // And what each one's last Update left to say, when it did not simply work.
  const scenarioUpdateNotes = useSyncExternalStore(scenarioUpdates.subscribe, scenarioUpdates.notes, scenarioUpdates.notes);
  // The Update waiting for the player's yes, { scenario, post }: one of a
  // scenario they have edited, which the Update would replace (the question
  // is drawn below, beside the missing-map prompt).
  const [replaceEditsTarget, setReplaceEditsTarget] = useState(null);

  // Pull the post's current bundle and replace this scenario in place. The
  // scenario keeps its local id, so existing games keep pointing at it; the
  // fresh hubOrigin stamp flips the card back to New Game on refresh. A failed
  // update leaves the card on Update, with the reason under its buttons and in
  // the editor's error; so does one that went through without its new basemap.
  //
  // A copy the player has edited is replaced like any other, changes and all,
  // so its Update asks first: the press only opens the question, and its yes
  // comes back here with `replaceEdits`. `post` is for a caller that has
  // already looked the post up (Suggest changes, which can be open while the
  // Scenarios tab, and so hubPostById, is not).
  const handleScenarioUpdate = async (scenario, { replaceEdits = false, post: knownPost = null } = {}) => {
    const post = knownPost ?? (scenario.hubOrigin ? hubPostById?.[scenario.hubOrigin.postId] : null);
    if (post?.bundleUrl && scenario.hubOrigin?.editedAt && !replaceEdits) {
      setReplaceEditsTarget({ scenario, post });
      return;
    }
    // A press that got in before the button redrew starts nothing either.
    if (!post?.bundleUrl || !scenarioUpdates.begin(scenario.id)) return;
    setEditorError(null);
    setIsBusy(true);
    // Said on the card as well as in the editor drawer, which is shut when
    // Update is pressed from a card.
    let outcome = "";
    const tell = (message) => {
      outcome = message;
      setEditorError(message);
    };

    try {
      // The checked copy of the post's file, stamped with the link to renew:
      // the post, its file, and the release copy that was downloaded.
      const bundle = await downloadHubScenario({ postId: post.id, bundleUrl: post.bundleUrl, title: post.title, author: post.author, flatMap: post.flatMap });
      // Noted before the Update: it refreshes the library, and when a game on
      // this scenario is running its effect would otherwise download the
      // basemap that just failed again at once.
      noteMissingBasemapTried({ id: scenario.id, missingBasemap: missingBasemapOfBundle(bundle) });
      await updateScenarioFromBundle(scenario.id, bundle);
      // A drawer open on this scenario still holds what was replaced. It is
      // loaded again, so its Save cannot write the old form over the new file.
      if (editorScenarioIdRef.current === scenario.id) await openScenarioEditor(scenario.id);
      // The stores keep the basemap the scenario had when the new one could not
      // be downloaded (updateScenarioFromBundle).
      const missingBasemap = unresolvedBundleBackground(bundle);
      if (missingBasemap) {
        tell(`The scenario was updated, but its new community basemap could not be downloaded, so it keeps the basemap it had. ${missingBasemap} The game tries again the next time you start it and open the scenario.`);
      }
    } catch (nextError) {
      tell(`Update failed: ${nextError.message}`);
    } finally {
      setIsBusy(false);
      scenarioUpdates.end(scenario.id, outcome);
    }
  };

  // ---- suggested changes (ScenarioSuggestions.jsx) ---------------------------
  // A downloaded scenario suggests its changes back to its post; a player's
  // own post collects the suggestions others leave on it as comments.
  const [suggestTarget, setSuggestTarget] = useState(null); // scenario id
  const [reviewTarget, setReviewTarget] = useState(null); // { scenarioId, source: { ref } | { suggestion } }
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityNote, setCommunityNote] = useState("");
  const scenarioById = (id) => scenarios.find((entry) => entry.id === id) ?? null;

  // A bookkeeping write, shown in the open drawer at once (its form is untouched).
  const adoptScenarioSummary = (details) => {
    if (!details?.scenario) return;
    setEditorDetails((current) => (current?.scenario?.id === details.scenario.id ? { ...current, scenario: details.scenario } : current));
  };

  // The posts carrying this scenario's key, and the suggestions left on them;
  // never a post the player unlinked it from (hubUnlinked). What comes back is
  // the record as the store kept it, which is the one that counts: it refuses
  // the record of a post unlinked while this was reading the hub.
  const refreshSuggestionsFor = async (scenario, { force = false } = {}) => {
    if (!scenario?.hubPublished) return null;
    const posts = await fetchHubPosts({ force });
    const { published, changed } = await refreshPublishedRecord(scenario.hubPublished, posts, {
      fetchComments: (postId) => fetchPostComments(postId, { force }),
      reviews: scenario.hubReviews,
      unlinked: scenario.hubUnlinked,
    });
    if (!changed) return published;
    const details = await saveScenario(scenario.id, { hubPublished: published });
    adoptScenarioSummary(details);
    return details?.scenario?.hubPublished ?? null;
  };

  // When the menu opens, an author learns of new suggestions on their posts:
  // one post list (the hub's index, kept five minutes, no API request) and a
  // post's comments only when its comment count moved, or while a suggestion
  // on it is still waiting for the hub's check (runtime/hubPosts.js
  // refreshPublishedRecord). Unauthenticated GitHub allows 60 requests an hour.
  const suggestionsCheckedAtRef = useRef(0);
  useEffect(() => {
    if (!menuOpen || !loaded) return;
    const mine = scenarios.filter((entry) => entry.hubPublished);
    if (!mine.length || Date.now() - suggestionsCheckedAtRef.current < 5 * 60 * 1000) return;
    suggestionsCheckedAtRef.current = Date.now();
    (async () => {
      try {
        const posts = await fetchHubPosts();
        for (const scenario of mine) {
          const { published, changed } = await refreshPublishedRecord(scenario.hubPublished, posts, {
            reviews: scenario.hubReviews,
            unlinked: scenario.hubUnlinked,
          });
          // The player may have unlinked the post while this was reading the
          // hub: the store then keeps it unlinked and drops this write.
          if (changed) await saveScenario(scenario.id, { hubPublished: published });
        }
      } catch (nextError) {
        console.warn("[hub] could not check for suggested changes:", nextError?.message || nextError);
      }
    })();
  }, [menuOpen, loaded, scenarios]);

  const handleSuggestChanges = async (scenario) => {
    // Suggest changes compares what is saved: edits still in the form go in first.
    if (editorKind === "scenario" && editorDetails?.scenario?.id === scenario.id && editorState
      && JSON.stringify(editorState) !== JSON.stringify(buildScenarioEditorState(editorDetails))) {
      if (!window.confirm("Save your changes to this scenario first? Only saved changes can be suggested.")) return;
      await handleSave();
    }
    setSuggestTarget(scenario.id);
  };

  // The two Unlinks. A link is made only by the game (a download stamps the
  // post it came from, Publish writes the key its post is found by) and the
  // player can only take one away, for good: the stores remember what was
  // unlinked and never attach it again (server/hubProvenance.js), so each
  // confirm says that it cannot be undone.
  const handleUnlinkOrigin = async (scenario) => {
    if (!window.confirm("Unlink this scenario from its community post? It becomes your own scenario: it no longer follows the post, and you can no longer suggest changes to it. This cannot be undone: a scenario cannot be linked to a post again.")) return;
    setCommunityBusy(true);
    try {
      adoptScenarioSummary(await saveScenario(scenario.id, { hubOrigin: null }));
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setCommunityBusy(false);
    }
  };

  const handleForgetPost = async (scenario) => {
    if (!window.confirm("Stop looking for suggested changes on your post? The post stays on the hub, but this cannot be undone: it can never be linked to this scenario again. Publishing the scenario again makes a new post.")) return;
    setCommunityBusy(true);
    try {
      adoptScenarioSummary(await saveScenario(scenario.id, { hubPublished: null }));
      setCommunityNote("");
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setCommunityBusy(false);
    }
  };

  const handleRefreshSuggestions = async (scenario) => {
    setCommunityBusy(true);
    setCommunityNote("");
    try {
      const published = await refreshSuggestionsFor(scenario, { force: true });
      const waiting = openSuggestionsOf({ ...scenario, hubPublished: published }).length;
      setCommunityNote(!published?.postIds?.length
        ? "Your post is not on the hub yet. Once you have posted it, the game finds it by itself."
        : waiting === 1 ? "1 suggestion waiting." : waiting ? `${waiting} suggestions waiting.` : "Checked just now: no suggested changes waiting.");
    } catch (nextError) {
      setCommunityNote(nextError.message);
    } finally {
      setCommunityBusy(false);
    }
  };

  // "Reject all from @…", for a contributor flooding a post with bad edits:
  // everything they suggested goes, on every post this player made, and what
  // they suggest later is hidden and never stored (server/hubProvenance.js).
  const handleRejectContributor = async (login) => {
    if (!window.confirm(`Reject everything @${login} suggested? Their suggestions are put away on all your posts, and anything they suggest later is hidden. You can unblock them in the scenario's Community card.`)) return;
    setCommunityBusy(true);
    try {
      for (const scenario of scenarios.filter((entry) => entry.hubPublished)) {
        const next = withContributorBlocked(scenario.hubPublished, login, true);
        if (next) adoptScenarioSummary(await saveScenario(scenario.id, { hubPublished: next }));
      }
      setReviewTarget((current) => (String(current?.source?.ref?.author ?? "").toLowerCase() === login.toLowerCase() ? null : current));
      setCommunityNote(`Rejected everything from @${login}.`);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setCommunityBusy(false);
    }
  };

  const handleUnblockContributor = async (login) => {
    setCommunityBusy(true);
    try {
      let drawerRecord = null;
      for (const scenario of scenarios.filter((entry) => isBlockedContributor(entry.hubPublished, login))) {
        const details = await saveScenario(scenario.id, { hubPublished: withContributorBlocked(scenario.hubPublished, login, false) });
        adoptScenarioSummary(details);
        if (details?.scenario?.id === editorDetails?.scenario?.id) drawerRecord = details.scenario;
      }
      // Their suggestions come back with the next look at the post's comments.
      if (drawerRecord) await refreshSuggestionsFor(drawerRecord, { force: true });
      setCommunityNote(`@${login} is unblocked.`);
    } catch (nextError) {
      setCommunityNote(nextError.message);
    } finally {
      setCommunityBusy(false);
    }
  };

  const handleOpenSuggestionFile = async (scenario, file) => {
    try {
      const suggestion = await readSuggestionFile(file);
      setReviewTarget({ scenarioId: scenario.id, source: { suggestion } });
    } catch (nextError) {
      setEditorError(nextError.message);
    }
  };

  // The map's changes open in the Workshop, listed and marked on the map
  // (src/Editor/SuggestionReviewPanel.jsx). The decisions made there are kept
  // with the review once the map is saved into the scenario.
  const openMapReview = async (scenarioId, suggestion, decisions, key) => {
    try {
      const details = await loadScenarioDetails(scenarioId);
      openMapEditorFor(details.scenario, details.data?.world ?? {}, {
        gameDate: details.data?.game?.gameDate ?? "",
        review: {
          suggestion,
          decisions: { accepted: [...decisions.accepted], rejected: [...decisions.rejected] },
          onSaved: async (mapDecisions) => {
            const latest = (await loadScenarioDetails(scenarioId)).scenario;
            const reviews = { ...(latest?.hubReviews ?? {}) };
            const record = reviews[key] ?? { status: "reviewing", accepted: [], rejected: [] };
            const accepted = new Set(record.accepted);
            const rejected = new Set(record.rejected);
            for (const change of suggestion.changes) {
              if (change.area !== "map") continue;
              accepted.delete(change.id);
              rejected.delete(change.id);
            }
            mapDecisions.accepted.forEach((id) => accepted.add(id));
            mapDecisions.rejected.forEach((id) => rejected.add(id));
            const everyDecided = suggestion.changes.every((change) => accepted.has(change.id) || rejected.has(change.id));
            reviews[key] = {
              status: everyDecided ? "done" : record.status === "dismissed" ? "dismissed" : "reviewing",
              accepted: [...accepted],
              rejected: [...rejected],
              updatedAt: new Date().toISOString(),
            };
            await saveScenario(scenarioId, { hubReviews: reviews });
          },
        },
      });
    } catch (nextError) {
      setEditorError(nextError.message);
    }
  };

  const handleScenarioClone = async (scenario) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await createScenario({
        accentColor: scenario.accentColor,
        name: `${scenario.name} Copy`,
        seedScenarioId: scenario.id,
        setActive: true,
        subtitle: scenario.subtitle,
      });
      await openScenarioEditor(details.scenario.id);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleGameClone = async (game) => {
    setEditorError(null);
    setIsBusy(true);
    setMenuOpen(false);

    try {
      await createGame({
        name: `${game.name} Copy`,
        seedGameId: game.id,
        setActive: true,
      });
    } catch (nextError) {
      setMenuOpen(true);
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Play an existing game from the menu: close the menu (module flag first —
  // the activation remounts the UI) and activate. Reopen only on failure.
  const handleGameArchive = async (game) => {
    setEditorError(null);
    try {
      await saveGame(game.id, { archived: !game.archived });
      if (!game.archived && game.id === activeGameId && hasEnteredGame()) leaveGame();
    } catch (nextError) {
      setEditorError(nextError.message);
    }
  };

  const gameDeleteQuestion = (name) => (!trash ? `Delete the game "${name}"?`
    : trash.keepCount ? `Delete the game "${name}"? You can restore it from Recently deleted for ${trash.keepDays} days, while it is among the last ${trash.keepCount} things you deleted.`
      : `Delete the game "${name}"? You can restore it from Recently deleted for ${trash.keepDays} days.`);

  const handleGameDelete = async (game) => {
    if (!game?.canDelete) return;
    setEditorError(null);
    setIsBusy(true);
    try {
      const wasOpen = game.id === activeGameId && hasEnteredGame();
      await removeGame(game.id);
      if (wasOpen) leaveGame();
      refreshTrash();
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleGameActivate = async (gameId) => {
    // A game whose scenario is not in this library has no map to open on — the
    // ordinary state of a game imported from someone else. Offer to go and get
    // it rather than dropping the player into a blank world.
    const game = games.find((entry) => entry.id === gameId);
    if (game?.scenarioMissing) {
      setMissingScenarioError("");
      setMissingScenarioGame(game);
      return;
    }

    setMenuOpen(false);
    try {
      await activateGame(gameId);
    } catch (nextError) {
      setMenuOpen(true);
      setEditorError(nextError.message);
    }
  };

  const handleGameExport = async (game) => {
    if (isBusy) return;
    setEditorError(null);
    setIsBusy(true);

    try {
      // The one case where the file can be big: nothing else can fetch this map,
      // so it has to travel. Asked BEFORE the map is fetched rather than after the
      // zip is built — a player who says no should not have waited for the work
      // first. Refusing outright is not an option either: it would leave them with
      // a game nobody else can ever open.
      const result = await buildGameZipBlob(game.id, {
        confirmCarryingScenario: ({ bytes, name }) =>
          window.confirm(
            `“${name}” isn't a scenario the other machine can download, so the map has to travel ` +
            `inside this file — about ${formatZipSize(bytes)} before it is compressed.\n\nExport it?`,
          ),
      });
      if (!result) return; // the player backed out

      const { blob, oversizeScenario } = result;
      if (oversizeScenario) {
        // Saved anyway: a game without its map still opens for anyone who has the
        // map, and is still the thing a maintainer needs. Refusing would leave the
        // player with nothing.
        setEditorError(
          `“${oversizeScenario.name}” is ${formatZipSize(oversizeScenario.bytes)} — too large to travel inside a game file, ` +
          `so this export carries everything except the map. Send the scenario separately from the Scenarios tab.`,
        );
      }
      // Awaited, so a failed write (the Android app's Downloads or share sheet)
      // reaches the catch below and the card stays busy until the file is out.
      await saveGameZipToDisk(blob, `${game.id}-game.zip`);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportGameFile = async (event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const buffer = await file.arrayBuffer();
      // By magic bytes, not by extension, so a renamed file still imports — the
      // same rule the scenario import uses.
      if (!looksLikeZip(new Uint8Array(buffer))) {
        throw new Error("That file isn't a game export. Pick the .zip you saved with Export.");
      }

      const { bundle, scenarioBundle, snapshotsText } = await readGameZip(buffer);

      // The scenario first, so the game's card names its map the moment it
      // appears. The carried map is imported unless this library already holds
      // a copy of it (importedScenarioCopy.js): an id match alone is no match,
      // since ids come from names and every "New Scenario" shares one. The game
      // names whichever id the map ends up under.
      let scenarioId = bundle.scenarioRef?.scenarioId ?? "";
      if (scenarioBundle) {
        scenarioId = await findScenarioCopyOfBundle(scenarioBundle, scenarios, loadScenarioDetails)
          ?? (await importScenarioBundle(scenarioBundle)).scenario.id;
      }

      const details = await importGameBundle({
        ...bundle,
        scenarioRef: { ...(bundle.scenarioRef ?? {}), scenarioId },
      });
      // Restore points go back as the text they arrived as, so neither side ever
      // parses ~21 MB of them.
      if (snapshotsText) await writeGameSnapshotsText(details.game.id, snapshotsText);

      await refreshLibraryCatalog({ force: true });
      setActiveTab("games");
      setMenuOpen(true);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // "Import & play" on the missing-map prompt: fetch the scenario the sender
  // recorded, import it, point the game at it, and go straight in. Offered only
  // when there is somewhere to fetch from — see handleGameActivate.
  //
  // What is fetched is the checked copy of the very file the game was played
  // on, from the hub's releases. When the hub no longer offers that file (its
  // post has a newer one, or was taken down) there is nothing to fetch: the
  // post's newer file is another map, and the game is not opened on it. The
  // reason is said in the prompt itself, which is all that is on screen then.
  const [missingScenarioError, setMissingScenarioError] = useState("");
  const handleMissingScenarioImport = async (game) => {
    setEditorError(null);
    setMissingScenarioError("");
    setIsBusy(true);

    try {
      const origin = game.importedScenarioOrigin;
      // A copy of that very file already in the library (fetched from the
      // Community tab since, or by an earlier try) is the map: every retry
      // importing another one piled up copies tens of MB each.
      let scenarioId = scenarioCopyOfHubFile(origin, scenarios)?.id ?? "";
      if (!scenarioId) {
        // Stamped with where it came from, exactly as the Community tab's own
        // import is (hubPosts.js downloadHubScenario). Without it the scenario
        // looks editor-made to every later export, which would try to carry the
        // whole map inside the next game exported from it — hundreds of
        // megabytes, built in the page.
        const bundle = await downloadHubScenario({ postId: origin.postId, bundleUrl: origin.bundleUrl, syncedAt: origin.syncedAt });
        const imported = await importScenarioBundle(bundle);
        scenarioId = imported.scenario.id;
      }
      // The import may land under another id than the one the game names (the
      // sender's id taken here already): the game follows the map it gets.
      await saveGame(game.id, { scenarioId });
      await refreshLibraryCatalog({ force: true });
      setMissingScenarioGame(null);
      setMenuOpen(false);
      await activateGame(game.id);
    } catch (nextError) {
      setMenuOpen(true);
      setEditorError(nextError.message);
      setMissingScenarioError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };


  // Blank scenario from the menu's + tile: create (seeded server-side from the
  // default scenario) and drop straight into its editor, above the menu.
  const handleCreateScenario = async () => {
    setEditorError(null);
    setIsBusy(true);
    try {
      const details = await createScenario({ name: "New Scenario", setActive: true });
      await openScenarioEditor(details.scenario.id);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorChange = (field, value) => {
    setEditorState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  // A guidance edit: the new text of one passage, null to drop that passage's
  // edit (back to the default), or a null passage to reset the whole section.
  const handlePromptChange = (section, segmentId, value) => {
    setEditorState((current) => {
      const guidance = current.prompts?.guidance ?? { advisor: {}, leader: {}, tasks: {} };
      const bucket =
        section.type === "root" ? guidance[section.key] ?? {} : guidance.tasks?.[section.key] ?? {};
      let nextBucket = {};
      if (segmentId !== null) {
        nextBucket = { ...bucket };
        if (value === null) delete nextBucket[segmentId];
        else nextBucket[segmentId] = value;
      }
      const nextGuidance =
        section.type === "root"
          ? { ...guidance, [section.key]: nextBucket }
          : { ...guidance, tasks: { ...(guidance.tasks ?? {}), [section.key]: nextBucket } };
      return { ...current, prompts: { ...current.prompts, guidance: nextGuidance } };
    });
  };

  const handleExportPrompts = async () => {
    if (editorKind !== "scenario" || !editorState || !editorDetails?.scenario) return;
    const scenario = editorDetails.scenario;
    const bundle = {
      schema: "open-historia-prompt-pack",
      version: 2,
      exportedAt: new Date().toISOString(),
      scenario: { id: scenario.id, name: scenario.name },
      prompts: materializePromptPack(editorState.prompts),
    };
    setEditorError(null);
    try {
      await saveJsonBundleToDisk(bundle, `${scenario.id}-prompts.json`);
    } catch (nextError) {
      setEditorError(nextError.message);
    }
  };

  const handleImportPrompts = (rawPromptPack) => {
    if (editorKind !== "scenario") return;
    setEditorState((current) => ({
      ...current,
      prompts: normalizePromptPack(rawPromptPack),
    }));
  };

  const handleSave = async () => {
    if (!editorKind || !editorDetails || !editorState) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const prompts = serializePromptPack(editorState.prompts);
      if (editorKind === "scenario") {
        const currentGame = editorDetails.data?.game ?? {};
        const currentWorld = editorDetails.data?.world ?? {};
        let details = await saveScenario(editorDetails.scenario.id, {
          accentColor: editorState.accentColor,
          description: editorState.description,
          eyebrow: editorState.eyebrow,
          features: editorState.features,
          game: {
            ...currentGame,
            country: editorState.country,
            gameDate: editorState.gameDate,
            language: editorState.language,
            startDate: editorState.gameDate || currentGame.startDate || "",
          },
          heroSubtitle: editorState.heroSubtitle,
          heroTitle: editorState.heroTitle,
          // null (no track in any situation) takes the scenario's music away.
          music: editorState.music ?? null,
          name: editorState.name,
          prompts,
          subtitle: editorState.subtitle,
          world: {
            ...currentWorld,
            allowedUnitTypes: Array.isArray(editorState.allowedUnitTypes)
              ? editorState.allowedUnitTypes
              : [...UNIT_TYPES],
            labelFont: editorState.labelFont,
            labelHaloColor: editorState.labelHaloColor,
            labelTextColor: editorState.labelTextColor,
            language: editorState.language,
            simulationRules: editorState.simulationRules,
            startingTimelineText: editorState.startingTimelineText,
            // How its wars are fought (runtime/warSettings.js). A scenario that
            // never set any is written none; one whose author took every
            // setting back has its old ones cleared.
            ...(editorState.warSettings || currentWorld.warSettings !== undefined
              ? { warSettings: compactWarSettings(editorState.warSettings) }
              : {}),
          },
        });
        if (editorStatsFailed) {
          // Never loaded, so never written: see openScenarioEditor.
        } else if (editorStats.custom) {
          if ((editorStats.sections || []).some((section) => !Array.isArray(section?.stats) || section.stats.length === 0)) {
            throw new Error("Each custom Stats section needs at least one statistic before saving.");
          }
          const definition = normalizeStatSheetDefinition(editorStats, { fallbackStandard: false });
          if (!definition.custom || !flattenStatSheetRows(definition).length) {
            throw new Error("A custom Stats sheet needs at least one valid statistic.");
          }
          const blob = new Blob([JSON.stringify(serializeStatSheet(definition), null, 2)], { type: "application/json" });
          details = await uploadScenarioAsset(editorDetails.scenario.id, "stats", blob);
          adoptSavedStats({ custom: true, version: definition.version, sections: definition.sections });
        } else {
          if (editorDetails.assetStatus?.stats || details.assetStatus?.stats) {
            details = await clearScenarioAsset(editorDetails.scenario.id, "stats");
          }
          adoptSavedStats(normalizeStatsEditorValue(null));
        }
        setEditorDetails(details);
        setEditorState(buildScenarioEditorState(details));
      } else {
        // Only what was changed in the form, as patches the store merges into
        // the files as they are now. The drawer can stay open over the game
        // while turns are played, and writing back the game.json and world.json
        // it loaded rolled back the date, round, borders, units and polities.
        const baseline = buildGameEditorState(editorDetails);
        const gamePatch = changedFields(editorState, baseline, ["country", "gameDate", "language"]);
        const worldPatch = changedFields(editorState, baseline, [
          "labelFont",
          "labelHaloColor",
          "labelTextColor",
          "language",
          "simulationRules",
          "startingTimelineText",
        ]);
        const details = await saveGame(editorDetails.game.id, {
          accentColor: editorState.accentColor,
          description: editorState.description,
          eyebrow: editorState.eyebrow,
          features: editorState.features,
          ...(Object.keys(gamePatch).length ? { gamePatch } : null),
          heroSubtitle: editorState.heroSubtitle,
          heroTitle: editorState.heroTitle,
          name: editorState.name,
          prompts,
          subtitle: editorState.subtitle,
          ...(Object.keys(worldPatch).length ? { worldPatch } : null),
        });
        setEditorDetails(details);
        setEditorState(buildGameEditorState(details));
      }
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editorDetails || !editorKind) {
      return;
    }

    const record = editorKind === "scenario" ? editorDetails.scenario : editorDetails.game;
    if (!record?.canDelete) {
      return;
    }

    // Where the trash can be listed, the question says how long the item can
    // be restored from the Recently deleted shelf.
    const question = editorKind === "scenario"
      ? (!trash ? `Delete the scenario "${record.name}"?`
        : trash.keepCount ? `Delete the scenario "${record.name}"? You can restore it from Recently deleted for ${trash.keepDays} days, while it is among the last ${trash.keepCount} things you deleted.`
          : `Delete the scenario "${record.name}"? You can restore it from Recently deleted for ${trash.keepDays} days.`)
      : gameDeleteQuestion(record.name);
    if (!window.confirm(question)) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      if (editorKind === "scenario") {
        await removeScenario(record.id);
      } else {
        const wasOpen = record.id === activeGameId && hasEnteredGame();
        await removeGame(record.id);
        if (wasOpen) leaveGame();
      }
      resetEditor();
      refreshTrash();
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorAssetSelect = async (assetKey, event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file || !editorKind || !editorDetails) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const details =
        editorKind === "scenario"
          ? await uploadScenarioAsset(editorDetails.scenario.id, assetKey, file)
          : await uploadGameAsset(editorDetails.game.id, assetKey, file);
      // The details only: the form holds no asset, and rebuilding it from the
      // saved record threw away everything typed since the last Save.
      setEditorDetails(details);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorAssetClear = async (assetKey) => {
    if (!editorKind || !editorDetails?.assetStatus?.[assetKey]) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const details =
        editorKind === "scenario"
          ? await clearScenarioAsset(editorDetails.scenario.id, assetKey)
          : await clearGameAsset(editorDetails.game.id, assetKey);
      // As an upload: the details only, so the form keeps what was typed.
      setEditorDetails(details);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportBundle = async (format = "json") => {
    if (editorKind !== "scenario" || !editorDetails) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const id = editorDetails.scenario.id;
      const bundle = await exportScenarioBundle(id);
      if (format === "zip") {
        // Package the scenario as a real .zip. When it carries a custom basemap, that
        // image/geojson rides inside as an actual file (+ a small preview) instead of a
        // base64 data URL bloating the JSON — the same self-contained form the community
        // hub shares. With no custom basemap there's nothing to split out, so the zip
        // just holds scenario.json (still a valid, self-contained bundle).
        const split = await splitScenarioBundleImage(bundle).catch(() => null);
        const files = {};
        if (split) {
          delete bundle.assets.backgroundData; // the basemap now travels as a real file
          files[split.imageName] = split.imageBytes;
          if (split.previewBytes) files[split.previewName] = split.previewBytes;
        }
        // The heavy assets — the region geometry, a custom tile archive — ride as
        // real entries too, so the zip actually compresses them instead of carrying
        // them as one long JSON string (src/runtime/bundleFiles.js).
        const lifted = splitBundleFiles(bundle);
        Object.assign(files, lifted.files);
        files["scenario.json"] = JSON.stringify(lifted.bundle);
        // Said in the file too, for whoever it reaches (scenarioLicense.js).
        files[SCENARIO_LICENSE_FILE] = SCENARIO_LICENSE_TEXT;
        await saveBlobToDisk(await zipBundle(files), `${id}-scenario.zip`);
      } else {
        await saveJsonBundleToDisk(bundle, `${id}-scenario.json`);
      }
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportScenarioFile = async (event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      // A .zip or a plain JSON bundle, read the way a hub download is
      // (runtime/hubPosts.js) — so a post's .zip downloaded by hand and imported
      // here still fetches the community basemap it references.
      const bundle = await readScenarioBundleBytes(await file.arrayBuffer());
      const details = await importScenarioBundle(bundle);
      // Not tried again straight away by the editor opening on it.
      noteMissingBasemapTried(details.scenario);
      setActiveTab("scenarios");
      setMenuOpen(true);
      await openScenarioEditor(details.scenario.id);
      // Shown in the drawer that just opened on it.
      const missingBasemap = unresolvedBundleBackground(bundle);
      if (missingBasemap) {
        setEditorError(`The scenario was imported, but its community basemap could not be downloaded. ${missingBasemap} The game tries again the next time you start it and open the scenario.`);
      }
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Full country name in the summary, never the code. The summary is the
  // in-game bar's, so nothing is looked up before a game is opened.
  const activeCountryName = useCountryDisplayName(activeGame?.country || "", { wait: !gameEntered });
  const summaryText = useMemo(() => {
    if (activeGame) {
      return `${activeGame.name} / ${activeCountryName || "No country"} / ${activeGame.currentDate || "No date"}`;
    }

    return "No active game";
  }, [activeGame, activeCountryName]);

  const isMobile = useIsMobile();
  const touch = useTouchPrimary();

  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [mapEditorScenario, setMapEditorScenario] = useState(null);
  const [mapEditorSeed, setMapEditorSeed] = useState(null); // the scenario's current map, loaded async
  // A suggestion being reviewed in the Workshop (openMapReview), or null.
  const [mapEditorReview, setMapEditorReview] = useState(null);
  // Which opening of the Workshop the map downloads in flight belong to. Every
  // open and every close moves it on, so a map still downloading for a
  // Workshop the player already left can never seed the next one: MapEditor
  // hydrates once, from the first map it is handed, and saves into its own
  // scenario whatever that map was.
  const [mapEditorRequest] = useState(createLatestRequest);

  // Open the Workshop on a scenario's CURRENT map (geometry + owners + cities +
  // palette) so it edits that map instead of the default world. Assets stream
  // in async; the editor hydrates the moment they arrive. `review` puts a
  // suggestion's map changes beside it (src/Editor/SuggestionReviewPanel.jsx).
  // `gameDate` and `warSettings` are the scenario's as its editor holds them,
  // saved or not (the world's settings where it holds none): what a country's
  // military figures left empty stand for in the Workshop.
  const openMapEditorFor = (scenario, world = {}, { review = null, gameDate = "", warSettings } = {}) => {
    const isCurrent = mapEditorRequest.begin();
    setMapEditorScenario(scenario);
    setMapEditorSeed(null);
    setMapEditorReview(review);
    setIsMapEditorOpen(true);
    if (!scenario) return;
    Promise.all([
      downloadScenarioJsonAsset(scenario.id, "regionsGeojson"),
      downloadScenarioJsonAsset(scenario.id, "citiesGeojson"),
      downloadScenarioJsonAsset(scenario.id, "colors"),
      // The author-set flags, for the same reason as the background below:
      // without them the editor opens with none, and Apply & Play cannot
      // tell "this map has no flags" from "this map never loaded them" —
      // so it clears the scenario's flags.json and the author's work is gone.
      downloadScenarioJsonAsset(scenario.id, "flags"),
      downloadScenarioJsonAsset(scenario.id, "tags"),
      // The custom map background so re-opening the editor restores it.
      // (A plain sea has a descriptor and nothing to download.)
      world.background?.kind === "image" || world.background?.kind === "vector"
        ? downloadScenarioJsonAsset(scenario.id, "backgroundData")
        : Promise.resolve(null),
      // Its other basemaps of its own, for the same reason.
      normalizeOwnBasemaps(world.ownBasemaps).length
        ? downloadScenarioJsonAsset(scenario.id, "ownBasemapsData").catch(() => null)
        : Promise.resolve(null),
    ]).then(([regions, cities, colors, flags, tags, bgData, ownBasemapsData]) => {
      if (!isCurrent()) return;
      const bgDesc = world.background;
      const background =
        bgDesc?.kind === "image" && bgData?.dataUrl
          ? { kind: "image", dataUrl: bgData.dataUrl, ...(bgDesc.bounds ? { bounds: bgDesc.bounds } : {}) }
          : bgDesc?.kind === "vector" && bgData?.geojson
            ? { kind: "vector", geojson: bgData.geojson }
            : bgDesc?.kind === "plain"
              ? { kind: "plain" }
              : null;
      // A named Tiled Basemap (with the scenario's own fill ramp) re-opens as
      // chosen, so Apply & Play keeps naming it.
      const tiledBasemap = bgDesc?.kind === "vector" && (bgDesc.tiled?.id || bgDesc.tiled?.hash)
        ? { ...bgDesc.tiled, ...(Array.isArray(bgDesc.fillOpacity) ? { fillOpacity: bgDesc.fillOpacity } : {}) }
        : null;
      setMapEditorSeed({
        tiledBasemap,
        name: scenario.name || "",
        author: world.author || "",
        ownershipOverrides: world.regionOwnershipOverrides || {},
        // The world's disputes, stamped over the map file's as the game
        // reads them, so the Workshop edits what the game shows.
        claimOverrides: {
          claimants: world.regionClaimants && typeof world.regionClaimants === "object" && !Array.isArray(world.regionClaimants)
            ? world.regionClaimants
            : {},
          settled: Array.isArray(world.settledRegionClaims) ? world.settledRegionClaims : [],
          // Which group's area each region is in; stamped with the disputes.
          groupAreas: world.groupAreas && typeof world.groupAreas === "object" && !Array.isArray(world.groupAreas)
            ? world.groupAreas
            : {},
        },
        groups: world.groups && typeof world.groups === "object" && !Array.isArray(world.groups) ? world.groups : {},
        regions: regions && Array.isArray(regions.features) && regions.features.length ? regions : null,
        cities: cities && Array.isArray(cities.features) ? cities : null,
        colors: colors && typeof colors === "object" && !Array.isArray(colors) ? colors : null,
        flags: flags && typeof flags === "object" && !Array.isArray(flags) ? flags : null,
        tags: tags && typeof tags === "object" && !Array.isArray(tags) ? tags : null,
        polities: world.polityOverrides && typeof world.polityOverrides === "object" && !Array.isArray(world.polityOverrides)
          ? world.polityOverrides
          : {},
        background,
        // The starting map's name (Editor/scenarioMaps.js).
        startingMapName: typeof bgDesc?.name === "string" ? bgDesc.name : "",
        // The map's projection (server/mapProjection.js), which the Workshop
        // shows, converts and saves back.
        projection: world.projection ?? null,
        basemap: world.basemap || null,
        allowedBasemaps: Array.isArray(world.allowedBasemaps) ? world.allowedBasemaps : null,
        ownBasemaps: ownBasemapsFromGame(world.ownBasemaps, ownBasemapsData),
        // Carried like the flags above: a round-trip must not reset it.
        customCities: Boolean(world.customCities),
        // The scenario's starting units, so the Units panel edits what the game starts with.
        units: Array.isArray(world.units) ? world.units : [],
        // Its structures, edited as map features that are not cities.
        markers: Array.isArray(world.markers) ? world.markers : [],
        // Its puppet states, for the Countries panel.
        puppets: Array.isArray(world.puppets) ? world.puppets : [],
        // Its region types, for the Region Types panel; null for a scenario
        // saved before they were, which opens with the default Land and Coastal.
        regionTypes: Array.isArray(world.regionTypes) && world.regionTypes.length ? world.regionTypes : null,
        // What a country's or a group's military figures left empty stand for
        // here, for the Countries and Groups panels: the era its wars are
        // fought in, and the scenario's own settings (militaryForm.js).
        militaryDefaults: militaryDefaultsFor(warSettings === undefined ? world.warSettings : warSettings, gameDate, { rules: world.simulationRules }),
        // What it draws on its map for war: terrain areas, fortified lines,
        // climate zones and the water that can freeze, for the War map panel.
        ...warGeographyOf(world),
      });
    }).catch((error) => {
      if (!isCurrent()) return;
      // A piece that failed to download is not a piece the map lacks: seeded
      // without it, the Workshop's save would clear the flags, tags and
      // background and write the stock world over the geometry. So the
      // Workshop closes before anything can be saved, and the drawer says why.
      console.warn("[editor] the scenario's map could not be loaded:", error);
      mapEditorRequest.cancel();
      setIsMapEditorOpen(false);
      setMapEditorScenario(null);
      setMapEditorSeed(null);
      setMapEditorReview(null);
      setEditorError(`The map editor was closed because this scenario's map could not be loaded, so nothing was saved over it. ${error?.message || error}`);
    });
  };
  const [countryPicker, setCountryPicker] = useState(null);
  const [countryOptions, setCountryOptions] = useState([]);
  const [customRegionData, setCustomRegionData] = useState(null);
  // The picked scenario's region-id -> owner map. Scenarios that reassign stock
  // geometry ship no regionsGeojson, so without this the picker draws the modern
  // world seed with its GADM owners — present-day Europe inside a scenario that
  // has none of it. See applyOwnerOverrides in CountryPickerMap.
  const [pickerOwnerOverrides, setPickerOwnerOverrides] = useState(null);
  const [pickerColors, setPickerColors] = useState(null);
  // The scenario's own basemap for the picker, when it has one (CountryPickerMap
  // customBackground); null draws the picker on ESRI as it always has.
  const [pickerBackground, setPickerBackground] = useState(null);
  const [countryQuery, setCountryQuery] = useState("");
  // Which tab of the new-game dialog: pick an existing country, or invent one.
  const [pickerTab, setPickerTab] = useState("country"); // "country" | "faction" | "group"
  const [pickerGroups, setPickerGroups] = useState([]);
  // "Play as a group" only for a scenario with groups switched on
  // (server/gameFeatures.js): a game made from one with them off has none.
  const pickerOffersGroups = isFeatureEnabled(normalizeFeatureSettings(countryPicker?.features), "groups");
  // When set, the country picker refines the country of this already-active game
  // (the Apply-&-Play flow) instead of creating a brand new game.
  const [playGameId, setPlayGameId] = useState(null);
  // Step two of the new-game dialog: the chosen country waits here while the
  // player picks a difficulty.
  const [difficultyPick, setDifficultyPick] = useState(null);
  // Which opening of the picker its loads belong to (handleScenarioPlay).
  const [pickerRequest] = useState(createLatestRequest);

  const closeCountryPicker = () => {
    pickerRequest.cancel();
    setCountryPicker(null);
    setPlayGameId(null);
    setDifficultyPick(null);
    setCustomRegionData(null);
    setPickerOwnerOverrides(null);
    setPickerColors(null);
    setPickerBackground(null);
  };

  // On a phone, Back closes what is on top (runtime/backToClose.js; with a
  // mouse nothing changes). Declared bottom-up, so surfaces opened together
  // stack in the order they are drawn. The drawer sits it out while the
  // Workshop covers it: Back there would otherwise throw away the drawer's
  // unsaved fields behind a screen the player cannot see through. The Workshop
  // itself has no Back of its own here: its close button saves first and asks
  // before dropping work, and that lives in src/Editor/MapEditor.jsx.
  // (Back to the game the menu was opened over, which is entered already: the
  // menu has no way to be closed at startup but by opening a game.)
  useBackToClose(menuOpen && menuOverGame && Boolean(activeGame), enterActiveGame);
  useBackToClose(Boolean(editorKind && editorDetails && editorState) && !isMapEditorOpen, closeEditor);
  useBackToClose(Boolean(countryPicker), closeCountryPicker);
  // The difficulty step goes back to the country step, as its own Back does.
  useBackToClose(Boolean(countryPicker && difficultyPick), () => setDifficultyPick(null));
  useBackToClose(Boolean(missingScenarioGame), () => setMissingScenarioGame(null));
  useBackToClose(Boolean(replaceEditsTarget), () => setReplaceEditsTarget(null));

  // Write a map built in the editor into its scenario (region geometry + ownership
  // + colors), then immediately spin up and activate a fresh game from it so the
  // player SEES the map right away — the stock country-level renderer can't show
  // per-region ownership, so every applied map ships its geometry and renders via
  // the custom GeoJSON layer.
  const applyMapToScenario = async (scenario, seed, { play = true, renames = [] } = {}) => {
    if (!scenario || !seed) return;
    const scenarioId = scenario.id;

    // A save is a scenario save and up to six asset writes. Each used to rebuild
    // the library catalog on its own (and could rotate the running map's asset
    // token half-way through the save); now the catalog is rebuilt once, after
    // the last write.
    const scenarioCountry = await withSingleLibraryRefresh(() => writeMapToScenario(scenarioId, seed, renames));

    // A Workshop save is complete by itself; Apply & Play opts into the fresh-game
    // flow below.
    if (!play) return { saved: true, scenarioId };
    await playAppliedMap(scenario, scenarioId, seed, scenarioCountry);
  };

  // Returns the scenario's player country as saved, for Apply & Play.
  const writeMapToScenario = async (scenarioId, seed, renames) => {
    const details = await loadScenarioDetails(scenarioId);
    const currentWorld = details?.data?.world ?? {};
    // The Workshop edits the polity registry, while Political World and several
    // other canonical ledgers live outside its map document. Its identity
    // operations are replayed onto the scenario's own world and game before the
    // map is written, so a rename moves the existing actor/relations instead of
    // leaving a stale actor behind and creating a second one later.
    //
    // First the polities it removed: each takes its Political World profile
    // with it. The seed names them as this world still does (MapEditor.jsx
    // removalsForScenario). Then the countries it renamed since its last save:
    // the player country and the world's name-keyed records, the Political
    // World profile among them, follow each rename (playerCountryAfterSave.js
    // scenarioAfterWorkshopRenames). A rename is replayed once, there: a second
    // replay is refused as a clash with the name the first one made.
    const { world: reconciledWorld, game: currentGame } = scenarioAfterWorkshopRenames(
      reconcileMapPolityAuthoringOps(currentWorld, seed.polityAuthoringOps),
      details?.data?.game ?? {},
      renames,
    );

    // A Workshop that has not finished loading the scenario's map holds an empty
    // document, and writing that over a scenario with territory is never what a
    // save meant. The Workshop disables its buttons until the map is in; this
    // is the second line of defence for any other way in.
    const seedRegionCount = Array.isArray(seed.regions?.features) ? seed.regions.features.length : 0;
    const hadTerritory = Object.keys(currentWorld.regionOwnershipOverrides ?? {}).length > 0;
    if (seedRegionCount === 0 && hadTerritory) {
      throw new Error("The map in the editor is empty while this scenario has territory — its map had not finished loading. Wait for it to appear, then save again.");
    }

    // The author's player country, not the seed's first owner (playerCountryAfterSave.js).
    const scenarioCountry = playerCountryAfterSave(currentGame.country, seed);
    const savedScenarioDetails = await saveScenario(scenarioId, {
      world: {
        ...reconciledWorld,
        regionOwnershipOverrides: seed.world?.regionOwnershipOverrides ?? {},
        // The Workshop is authoritative for the polity registry: it hydrated the
        // full current registry (landless polities included) before editing, so
        // merging here would resurrect deleted or renamed entries forever.
        polityOverrides: seed.world?.polityOverrides ?? {},
        // The Workshop is authoritative for the disputes too (exportPreset.js):
        // it opened with the world's rows stamped over the map file's, so the map
        // it saves is the whole of them.
        ...(seed.world?.regionClaimants
          ? { regionClaimants: seed.world.regionClaimants, settledRegionClaims: seed.world.settledRegionClaims ?? [] }
          : {}),
        ownerSchema: seed.world?.ownerSchema ?? currentWorld.ownerSchema,
        // Playable factions for the start-country picker.
        ownerCodes: [...new Set(Object.values(seed.world?.regionOwnershipOverrides ?? {}))].sort(),
        customRegions: true,
        customCities: seed.world?.customCities ?? false,
        author: seed.world?.author ?? "",
        mapCredit: seed.world?.mapCredit ?? "",
        // Custom map background descriptor (kind + placement); null clears it. The
        // heavy payload goes to the backgroundData asset just below.
        background: seed.world?.background ?? null,
        // The projection the Workshop left the map in; a map that never had one
        // keeps none, which is Mercator.
        ...(seed.world?.projection ? { projection: seed.world.projection } : {}),
        // The chosen built-in basemap so the game renders it (not always ocean).
        basemap: seed.world?.basemap ?? null,
        // Which built-in maps players may switch to (null = any).
        allowedBasemaps: seed.world?.allowedBasemaps ?? null,
        // Its other basemaps of its own; their payloads go to the
        // ownBasemapsData asset just below.
        ownBasemaps: seed.world?.ownBasemaps ?? null,
        // The starting units placed in the Workshop (world.units, source "scenario").
        units: seed.world?.units ?? [],
        // The groups and their areas: the Workshop opened with the world's, so
        // what it saves is the whole of them.
        ...(seed.world?.groups ? { groups: seed.world.groups, groupAreas: seed.world.groupAreas ?? {} } : {}),
        // The structures (world.markers): the Workshop opened with the scenario's
        // and edits them as map features, so it hands back the whole list.
        ...(Array.isArray(seed.world?.markers) ? { markers: seed.world.markers } : {}),
        // The puppet states, likewise opened with the scenario's own rows.
        ...(Array.isArray(seed.world?.puppets) ? { puppets: seed.world.puppets } : {}),
        // The region types, which the game draws and the AI's placement reads.
        ...(Array.isArray(seed.world?.regionTypes) ? { regionTypes: seed.world.regionTypes } : {}),
        // What it draws on its map for war, opened with the world's own and so
        // handed back whole (warGeographyDoc.js).
        ...warGeographyWorldPatch(seed.world),
      },
      game: {
        ...currentGame,
        country: scenarioCountry,
        // Guarantee a valid date so the timeline never shows "Invalid Date".
        gameDate:
          currentGame.gameDate || currentGame.startDate || seed.game?.gameDate || seed.game?.startDate || "2016-01-01",
        startDate:
          currentGame.startDate || currentGame.gameDate || seed.game?.startDate || seed.game?.gameDate || "2016-01-01",
      },
    }, { refresh: false });

    // The canonical scenario just written, kept in the drawer too when it is
    // open on this scenario; otherwise reopening the Workshop resurrects the old
    // world.json and a later ordinary scenario save can write the stale basemap
    // back. Its form follows the player country and date the save may have
    // moved (a deleted polity, a stamped date), or the drawer's next Save
    // writes the old ones back; a field the author changed there keeps theirs.
    if (editorKind === "scenario" && editorDetails?.scenario?.id === scenarioId) {
      const drawerGame = editorDetails.data?.game ?? {};
      setEditorDetails(savedScenarioDetails);
      setEditorState((current) => followSavedFields(current, drawerGame, savedScenarioDetails?.data?.game, ["country", "gameDate"]));
    }

    await uploadScenarioAsset(
      scenarioId,
      "colors",
      new Blob([JSON.stringify(seed.colors ?? {})], { type: "application/json" }),
      { refresh: false },
    );
    // Author-set country flags. Only written when the map actually has some: a map
    // with no flags must leave the scenario's flags.json alone rather than stamping
    // an empty one over it, and clearScenarioAsset is how a map that removed its
    // last flag gets back to the game's code-derived flags.
    if (seed.flags) {
      await uploadScenarioAsset(
        scenarioId,
        "flags",
        new Blob([JSON.stringify(seed.flags)], { type: "application/json" }),
        { refresh: false },
      );
    } else {
      await clearScenarioAsset(scenarioId, "flags", { refresh: false });
    }
    // Author-set country tags, same contract as flags.
    if (seed.tags) {
      await uploadScenarioAsset(
        scenarioId,
        "tags",
        new Blob([JSON.stringify(seed.tags)], { type: "application/json" }),
        { refresh: false },
      );
    } else {
      await clearScenarioAsset(scenarioId, "tags", { refresh: false });
    }
    await uploadScenarioAsset(
      scenarioId,
      "regionsGeojson",
      new Blob([JSON.stringify(seed.regions ?? { type: "FeatureCollection", features: [] })], {
        type: "application/json",
      }),
      { refresh: false },
    );
    await uploadScenarioAsset(
      scenarioId,
      "citiesGeojson",
      new Blob([JSON.stringify(seed.cities ?? { type: "FeatureCollection", features: [] })], {
        type: "application/json",
      }),
      { refresh: false },
    );

    // The custom background's heavy payload (image data URL / vector GeoJSON) is a
    // separate scenario asset so world.json stays light. Clear it when the map has
    // no background, so re-applying a map that dropped its background doesn't leave
    // a stale image behind.
    if (seed.backgroundData) {
      await uploadScenarioAsset(
        scenarioId,
        "backgroundData",
        new Blob([JSON.stringify(seed.backgroundData)], { type: "application/json" }),
        { refresh: false },
      );
    } else {
      await clearScenarioAsset(scenarioId, "backgroundData", { refresh: false });
    }
    // The other basemaps' payloads, the same way.
    if (seed.ownBasemapsData) {
      await uploadScenarioAsset(
        scenarioId,
        "ownBasemapsData",
        new Blob([JSON.stringify(seed.ownBasemapsData)], { type: "application/json" }),
        { refresh: false },
      );
    } else {
      await clearScenarioAsset(scenarioId, "ownBasemapsData", { refresh: false });
    }
    return scenarioCountry;
  };

  const playAppliedMap = async (scenario, scenarioId, seed, scenarioCountry) => {
    // Create + activate a fresh game so the running map reflects the edit. Relying
    // on the player finishing a follow-up picker left the old active game (and old
    // map) in place — this guarantees the new map is live. Menu flag first: the
    // activation remounts the UI and the remount must come up menu-closed. The
    // game starts as the scenario's own player country, just saved above, not
    // the seed's, which is only the map's first owner (a Japan scenario started
    // as Afghanistan whenever the picker was dismissed).
    setMenuOpen(false);
    let gameDetails;
    try {
      gameDetails = await createGame({
        name: `${scenario.name} Session`,
        scenarioId,
        ...(scenarioCountry ? { gamePatch: { country: scenarioCountry } } : null),
        setActive: true,
      });
    } catch (nextError) {
      // No game was opened: the menu is what is behind the Workshop again,
      // which says what went wrong. (A closed menu with no game behind it
      // would be the opening cover, over the Workshop and its message.)
      setMenuOpen(true);
      throw nextError;
    }
    const newGameId = gameDetails.game.id;

    // Tear down all the library UI so the freshly-activated game is visible.
    mapEditorRequest.cancel();
    setIsMapEditorOpen(false);
    setMapEditorScenario(null);
    setMapEditorSeed(null);
    resetEditor();
    setMenuOpen(false);

    // Optional: let the player pick who they control on the new game — limited to
    // the factions this map actually contains. Offered by the UI remounted
    // around the new game (openPlayCountryPicker), since this one is gone.
    handOffAfterActivation({
      gameId: newGameId,
      countryPicker: {
        scenario,
        seedWorld: {
          ownerCodes: [...new Set(Object.values(seed.world?.regionOwnershipOverrides ?? {}))].sort(),
          polityOverrides: seed.world?.polityOverrides ?? {},
        },
        background: seed.world?.background,
      },
    });
  };

  // The Apply-&-Play country picker over a game just made from `scenario`.
  const openPlayCountryPicker = (gameId, { scenario, seedWorld, background }) => {
    const isCurrent = pickerRequest.begin();
    setPlayGameId(gameId);
    setCountryQuery("");
    setCountryOptions([]);
    setCustomRegionData(null); setPickerOwnerOverrides(null); setPickerColors(null); setPickerBackground(null);
    setCountryPicker(scenario);
    loadCountryNames().catch(() => [])
      .then((allCountries) => {
        if (!isCurrent()) return;
        setCountryOptions(buildScenarioCountryOptions(
          seedWorld,
          [...getBaseCountryOptions(), ...allCountries],
          scenario.countryNameOverrides,
        ));
        setPickerOwnerOverrides(seedWorld.regionOwnershipOverrides ?? null);
        downloadScenarioJsonAsset(scenario.id, "colors")
          .then((colors) => { if (colors && typeof colors === "object" && isCurrent()) setPickerColors(colors); })
          .catch(() => {});
        // The map editor just saved custom region geometry — load it so the
        // country picker renders the scenario's actual map, not the stock seed.
        downloadScenarioJsonAsset(scenario.id, "regionsGeojson", { coarse: true })
          .then((geojson) => { if (geojson && isCurrent()) setCustomRegionData(geojson); })
          .catch(() => {});
        loadPickerBackground(scenario.id, background, isCurrent);
      })
      // Falling back to every real-world country here was the same bug by another
      // route: a scenario picker listing Germany and France because a name lookup
      // failed. The scenario's own world is already in hand — build from it.
      .catch(() => {
        if (!isCurrent()) return;
        setCountryOptions(buildScenarioCountryOptions(seedWorld, [], scenario.countryNameOverrides));
        setPickerOwnerOverrides(seedWorld.regionOwnershipOverrides ?? null);
      });
  };

  // Pick up what a flow owes the game it just activated (handOffAfterActivation):
  // only in the instance mounted for that game, whichever came first, the
  // hand-off or the remount.
  const pendingAfterActivation = useSyncExternalStore(afterActivation.subscribe, afterActivation.get, afterActivation.get);
  useEffect(() => {
    const work = afterActivation.take(activeGameId);
    if (!work) return;
    if (work.editor) {
      openGameEditor(work.gameId).then(() => {
        if (work.error) setEditorError(work.error);
      });
    }
    if (work.countryPicker) openPlayCountryPicker(work.gameId, work.countryPicker);
  }, [pendingAfterActivation, activeGameId]);

  // Country picker resolution: in the Apply-&-Play flow update the active game;
  // in the normal "New Game" flow create a new game.
  const choosePlayCountry = async (countryCode, difficulty) => {
    const gid = playGameId;
    setCountryPicker(null);
    setCustomRegionData(null); setPickerOwnerOverrides(null); setPickerColors(null); setPickerBackground(null);
    setPlayGameId(null);
    if (!gid) return;
    setMenuOpen(false);
    try {
      const gamePatch = { ...(countryCode ? { country: countryCode } : null), ...(difficulty ? { difficulty } : null) };
      if (Object.keys(gamePatch).length) {
        await saveGame(gid, { gamePatch });
      }
      await activateGame(gid);
    } catch (nextError) {
      setEditorError(nextError.message);
    }
  };

  // Picking a country moves to step two (difficulty); picking a difficulty
  // actually creates/updates the game.
  const pickCountry = (countryCode) => setDifficultyPick({ countryCode });
  // A created faction routes through the SAME difficulty step as a picked country —
  // it just carries a faction draft instead of a country code.
  const pickFaction = (faction) => setDifficultyPick({ faction });
  // A group (one of the scenario's, or one just made) takes the same step.
  const pickGroup = (group) => setDifficultyPick({ group });

  const pickDifficulty = (difficultyId) => {
    const draft = difficultyPick;
    setDifficultyPick(null);
    if (draft?.faction) {
      startGameForFaction(countryPicker, draft.faction, difficultyId);
      return;
    }
    if (draft?.group) {
      startGameForGroup(countryPicker, draft.group, difficultyId);
      return;
    }
    const countryCode = draft?.countryCode || "";
    if (playGameId) {
      choosePlayCountry(countryCode, difficultyId);
    } else {
      startGameForCountry(countryPicker, countryCode, difficultyId);
    }
  };

  const selectedCountryOption = difficultyPick?.countryCode
    ? countryOptions.find((country) => country.code === difficultyPick.countryCode)
    : null;

  // ---- Main-menu library ----------------------------------------------------
  // Each section now answers a different question. "Continue Playing" is the
  // short recency shelf; the browse grid below is the single canonical place
  // for the rest of the library. Sorting no longer creates duplicate shelves.
  const visibleGames = useMemo(() => games.filter((game) => !game.archived), [games]);
  const archivedGames = useMemo(
    () => games
      .filter((game) => game.archived)
      .sort((a, b) => String(b.lastPlayedAt ?? "").localeCompare(String(a.lastPlayedAt ?? ""))),
    [games],
  );
  const lastPlayedGames = useMemo(() => {
    const touchedAt = (game) => String(game.lastPlayedAt || game.importedAt || game.updatedAt || game.createdAt || "");
    return [...visibleGames].sort((a, b) => {
      if (a.id === activeGameId) return -1;
      if (b.id === activeGameId) return 1;
      return touchedAt(b).localeCompare(touchedAt(a));
    });
  }, [visibleGames, activeGameId]);

  const continueGames = useMemo(
    () => lastPlayedGames.slice(0, isMobile ? 5 : 6),
    [lastPlayedGames, isMobile],
  );

  const browsedGames = useMemo(() => {
    const query = gameSearch.trim().toLowerCase();
    const base = gameView === "archived"
      ? archivedGames
      : gameView === "all"
        ? [...visibleGames, ...archivedGames]
        : visibleGames;
    const filtered = query
      ? base.filter((game) => [game.name, game.heroTitle, game.scenarioName, game.country]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      : [...base];
    const touchedAt = (game) => String(game.lastPlayedAt || game.importedAt || game.updatedAt || game.createdAt || "");
    if (gameSort === "turns") return filtered.sort((a, b) => (b.round ?? 0) - (a.round ?? 0) || touchedAt(b).localeCompare(touchedAt(a)));
    if (gameSort === "played") return filtered.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0) || touchedAt(b).localeCompare(touchedAt(a)));
    if (gameSort === "name") return filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return filtered.sort((a, b) => {
      if (a.id === activeGameId) return -1;
      if (b.id === activeGameId) return 1;
      return touchedAt(b).localeCompare(touchedAt(a));
    });
  }, [activeGameId, archivedGames, gameSearch, gameSort, gameView, visibleGames]);

  const lastUpdatedScenarios = useMemo(
    () => [...scenarios].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))),
    [scenarios],
  );
  // "Yours", by the rule the old dedicated shelf used: scenarios the player
  // made or edited themselves — no hubOrigin (made here, or unlinked), or a
  // hub import they have edited (editedAt: the link stays, so they can suggest
  // their changes back). The stock built-in only counts once it has actually
  // been touched.
  const yourScenarios = useMemo(
    () => scenarios.filter(
      (scenario) => (!scenario.hubOrigin || scenario.hubOrigin.editedAt) && (scenario.id !== "default" || scenario.updatedAt !== scenario.createdAt),
    ),
    [scenarios],
  );
  const yourScenarioIds = useMemo(() => new Set(yourScenarios.map((scenario) => scenario.id)), [yourScenarios]);

  const recentScenarios = useMemo(() => {
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const seen = new Set();
    const recent = [];
    for (const game of lastPlayedGames) {
      const scenario = byId.get(game.scenarioId);
      if (!scenario || seen.has(scenario.id)) continue;
      seen.add(scenario.id);
      recent.push(scenario);
      if (recent.length >= (isMobile ? 5 : 6)) break;
    }
    for (const scenario of lastUpdatedScenarios) {
      if (seen.has(scenario.id)) continue;
      seen.add(scenario.id);
      recent.push(scenario);
      if (recent.length >= (isMobile ? 5 : 6)) break;
    }
    return recent;
  }, [isMobile, lastPlayedGames, lastUpdatedScenarios, scenarios]);

  const browsedScenarios = useMemo(() => {
    const query = scenarioSearch.trim().toLowerCase();
    let base = scenarios;
    if (scenarioView === "yours") base = scenarios.filter((scenario) => yourScenarioIds.has(scenario.id));
    else if (scenarioView === "community") base = scenarios.filter((scenario) => Boolean(scenario.hubOrigin));
    else if (scenarioView === "updates") base = scenarios.filter((scenario) => scenarioUpdateReason(scenario));
    let filtered = query
      ? base.filter((scenario) => [scenario.name, scenario.heroTitle, scenario.subtitle, scenario.description]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      : [...base];
    const recentRank = new Map(recentScenarios.map((scenario, index) => [scenario.id, index]));
    if (scenarioSort === "name") return filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    if (scenarioSort === "played") return filtered.sort((a, b) => (b.gameCount ?? 0) - (a.gameCount ?? 0) || (b.playCount ?? 0) - (a.playCount ?? 0));
    if (scenarioSort === "updated") return filtered.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return filtered.sort((a, b) => {
      const rankA = recentRank.has(a.id) ? recentRank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const rankB = recentRank.has(b.id) ? recentRank.get(b.id) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
    });
  }, [recentScenarios, scenarioSearch, scenarioSort, scenarioView, scenarios, yourScenarioIds]);

  // The countries the map open in the drawer offers: the scenario's, or the
  // game's own world (polities founded in play included).
  const editorCountryOptions = useMemo(
    () => (editorDetails?.data?.world
      ? buildScenarioCountryOptions(
        editorDetails.data.world,
        Object.entries(countryNames ?? {}).map(([code, name]) => ({ code, name })),
        editorDetails.scenario?.countryNameOverrides,
      )
      : []),
    [editorDetails, countryNames],
  );

  // The scenario open in the drawer as the catalog has it now: every hub
  // bookkeeping write refreshes the catalog, not the drawer's copy.
  const drawerScenario = editorKind === "scenario" && editorDetails?.scenario
    ? (scenarioById(editorDetails.scenario.id) ?? editorDetails.scenario)
    : null;

  // The open tab's own actions: in the bar on a desktop, heading the page on a
  // phone. The Community tab brings its own; the Lobbies tab's is hosting one.
  const tabActions = activeTab === "community" ? [] : activeTab === "lobbies" ? [
    { icon: "host", label: "Host a lobby", run: () => setLobbyHosting(true) },
  ] : [
    { icon: "refresh", label: "Refresh", run: () => { refreshTrash(); refreshLibraryCatalog({ force: true }).catch(() => {}); } },
    activeTab === "scenarios"
      ? { icon: "import", label: "Import Scenario", phoneLabel: "Import Scenario", run: () => importScenarioInputRef.current?.click() }
      : { icon: "import", label: "Import Game", phoneLabel: "Import Game", run: () => importGameInputRef.current?.click() },
  ];

  return (
    <>
      {/* In-game the full-width top bar is gone — the map gets the space. What
          remains is a compact floating cluster beside the ⋮ settings button: a
          small sleek pill with the session summary, plus Exit Game.
          Below the settings menu and date widget (z 9998/9999) so opening
          either covers it instead of the other way around, and below the
          desktop advisor drawer (9997) so a wide drawer covers it too. */}
      {!menuOpen && !isMobile && (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontFamily: "sans-serif",
            gap: "0.45rem",
            left: `calc(3.8rem + ${SAFE_LEFT})`,
            position: "fixed",
            top: TOP_BAR_OFFSET,
            zIndex: 9996,
          }}
        >
          <div
            style={{
              ...surfaceStyle,
              alignItems: "center",
              borderRadius: "12px",
              boxSizing: "border-box",
              color: "rgba(255,255,255,0.72)",
              display: "flex",
              gap: "0.55rem",
              height: "2.85rem",
              // Shrinks to nothing before it can reach under the date widget
              // on narrow desktop windows (the widget owns the top right).
              maxWidth: "min(34rem, max(0rem, calc(100vw - 44rem)))",
              overflow: "hidden",
              padding: "0 0.75rem",
            }}
          >
            <img alt="Open Historia" src="/logo.png" style={{ borderRadius: "7px", flexShrink: 0, height: "1.85rem", width: "1.85rem" }} />
            <div style={{ minWidth: 0, lineHeight: 1.15 }}>
              <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.72rem", fontWeight: 850 }}>Open Historia</div>
              <div style={{ color: "rgba(226,226,229,0.42)", fontSize: "0.6rem", marginTop: "0.12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summaryText}</div>
            </div>
          </div>
          <button
            onClick={exitToMenu}
            title="Leave this game and return to the main menu"
            type="button"
            style={{
              ...actionButtonStyle,
              ...surfaceStyle,
              borderRadius: "12px",
              boxSizing: "border-box",
              fontSize: "0.68rem",
              height: "2.85rem",
              minHeight: "2.85rem",
              padding: "0 0.85rem",
            }}
          >
            ⌂ Exit Game
          </button>
        </div>
      )}

      {/* Phones: the date widget spans the whole top row, so Exit Game sits
          in the left gutter under the ⋮ settings button instead, clear of the
          status bar and of a notch at the side. */}
      {!menuOpen && isMobile && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            gap: "0.45rem",
            left: `calc(0.5rem + ${SAFE_LEFT})`,
            position: "fixed",
            top: `calc(5rem + ${SAFE_TOP})`,
            zIndex: 9997,
          }}
        >
          <button
            aria-label="Exit to the main menu"
            className="oh-tap"
            onClick={exitToMenu}
            title="Leave this game and return to the main menu"
            type="button"
            style={touchFit({ ...actionButtonStyle, ...surfaceStyle, borderRadius: "12px", fontSize: "1rem", height: "2.6rem", minHeight: "0", minWidth: "0", padding: 0, width: "2.6rem" }, touch, { icon: true })}
          >
            ⌂
          </button>
        </div>
      )}

      {isMapEditorOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10050 }}>
          <Suspense
            fallback={
              <div style={{ position: "fixed", inset: 0, background: "#111113", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
                Loading map editor…
              </div>
            }
          >
            <MapEditor
              onClose={() => {
                mapEditorRequest.cancel();
                setIsMapEditorOpen(false);
                setMapEditorScenario(null);
                setMapEditorSeed(null);
                setMapEditorReview(null);
              }}
              scenarioName={mapEditorScenario?.name}
              initialMap={mapEditorSeed}
              review={mapEditorReview}
              onApplyToScenario={
                mapEditorScenario ? (seed, options) => applyMapToScenario(mapEditorScenario, seed, options) : undefined
              }
            />
          </Suspense>
        </div>
      )}

      {/* Suggested changes: sending one (a downloaded scenario), reviewing one
          (the author). The review steps aside while its map changes are open
          in the Workshop, and comes back when the Workshop closes. */}
      {suggestTarget && scenarioById(suggestTarget) && (
        <SuggestChangesDialog
          scenario={scenarioById(suggestTarget)}
          onClose={() => setSuggestTarget(null)}
          // The file the copy came from is gone from the hub: the dialog says
          // to update first, and hands over the post it found to update from.
          onUpdate={(post) => {
            const scenario = scenarioById(suggestTarget);
            setSuggestTarget(null);
            handleScenarioUpdate(scenario, { post });
          }}
        />
      )}
      {reviewTarget && !isMapEditorOpen && scenarioById(reviewTarget.scenarioId) && (
        <SuggestionReviewDialog
          key={`${reviewTarget.scenarioId}:${reviewTarget.source?.ref?.id || reviewTarget.source?.suggestion?.id || ""}`}
          scenario={scenarioById(reviewTarget.scenarioId)}
          source={reviewTarget.source}
          onClose={() => setReviewTarget(null)}
          onLoaded={(suggestion) => setReviewTarget((current) => (current ? { ...current, source: { ...current.source, suggestion } } : current))}
          onReviewMap={(suggestion, decisions, key) => openMapReview(reviewTarget.scenarioId, suggestion, decisions, key)}
          onRejectContributor={handleRejectContributor}
        />
      )}

      <Presence open={Boolean(countryPicker)} value={countryPicker}>
        {(countryPicker) => (
        <div
          onClick={closeCountryPicker}
          style={{ position: "fixed", inset: 0, zIndex: 10060, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "center", padding: `${SAFE_TOP} ${SAFE_RIGHT} ${SAFE_BOTTOM} ${SAFE_LEFT}` }}
        >
          {/* On a phone the card takes the whole screen height rather than 80%
              of it: the search, the map, the list and the buttons need every
              row a phone has. The SCREEN height, and pinned to the top: sized
              from the visible height and centred, the card shrank and jumped
              (above the top of the screen, for a moment) every time the
              keyboard came up for the search box, and squeezed its map
              (mobileUi.js SCREEN_HEIGHT). */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...themeSurfaceStyle,
              background: "#11141a",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
              borderRadius: 18,
              width: difficultyPick ? "min(460px, 92vw)" : isMobile ? "min(640px, 94vw)" : "min(1120px, 95vw)",
              maxHeight: isMobile ? `calc(${SCREEN_HEIGHT} - 1.5rem - ${SAFE_TOP} - ${SAFE_BOTTOM})` : "88vh",
              height: isMobile || difficultyPick ? undefined : "min(720px, 86vh)",
              marginTop: isMobile ? "0.75rem" : undefined,
              display: "flex",
              flexDirection: "column",
              padding: isMobile ? "1rem" : "1.25rem 1.5rem",
              color: "#fff",
              fontFamily: "sans-serif",
              overflow: difficultyPick ? "visible" : isMobile ? "auto" : "hidden",
            }}
          >
            {difficultyPick ? (
              <>
                <div style={{ fontWeight: 800, fontSize: "1.2rem", letterSpacing: "-0.01em" }}>Choose your difficulty</div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.8rem", margin: "0.2rem 0 0.85rem" }}>
                  How hard should the world fight back?
                </div>
                {selectedCountryOption && (() => {
                  const flagUrl = flagImageUrlFromGid(selectedCountryOption.code) || flagImageUrlFromGid(selectedCountryOption.name)
                    || (gidToAlpha2(selectedCountryOption.code) ? bundledFlagUrl(`https://flagcdn.com/${gidToAlpha2(selectedCountryOption.code)}.svg`) : null);
                  return (
                    <div style={{ alignItems: "center", display: "flex", fontSize: "0.95rem", fontWeight: 700, gap: "0.6rem", marginBottom: "0.85rem", padding: "0.6rem 0.85rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
                      {flagUrl ? (
                        <img
                          src={bundledFlagUrl(flagUrl)}
                          alt=""
                          style={{ borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", display: "block", flexShrink: 0, height: "1.2rem", objectFit: "cover", width: "1.75rem" }}
                        />
                      ) : (
                        <span aria-hidden="true" style={{ background: "rgba(255,255,255,0.15)", borderRadius: 3, display: "inline-block", flexShrink: 0, height: "1.2rem", width: "1.75rem" }} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span>{selectedCountryOption.name}</span>
                        <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>Selected Nation</span>
                      </div>
                    </div>
                  );
                })()}
                {difficultyPick?.group && (
                  <div style={{ alignItems: "center", display: "flex", fontSize: "0.95rem", fontWeight: 700, gap: "0.6rem", marginBottom: "0.85rem", padding: "0.6rem 0.85rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
                    <span aria-hidden="true" style={{ background: difficultyPick.group.color || "#a1a1aa", borderRadius: 4, display: "inline-block", height: 20, width: 20 }} />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span data-no-translate>{difficultyPick.group.name}</span>
                      <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>Selected Group</span>
                    </div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", overflowY: "auto" }}>
                  {DIFFICULTY_LEVELS.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      onClick={() => pickDifficulty(level.id)}
                      style={{
                        ...themeButtonStyle,
                        alignItems: "center",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.3rem",
                        padding: "0.9rem 0.6rem",
                        transition: "background 0.15s ease, border-color 0.15s ease",
                      }}
                    >
                      <span style={{ fontSize: "1.75rem", lineHeight: 1 }}>{level.emoji}</span>
                      <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>{level.label}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", textAlign: "center", lineHeight: 1.3 }}>{level.blurb}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="oh-tap-row" onClick={() => setDifficultyPick(null)} style={touchFit({ ...themeButtonStyle, marginTop: "0.85rem", borderRadius: 8, padding: "0.6rem" }, touch)}>
                  Back
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.75rem", flexShrink: 0 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                      <span style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.08)", padding: "0.15rem 0.45rem", borderRadius: 4 }}>
                        Scenario
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.82rem", fontWeight: 600 }}>
                        {countryPicker.name}
                      </span>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: isMobile ? "1.1rem" : "1.3rem", marginTop: "0.2rem", letterSpacing: "-0.01em" }}>
                      {pickerTab === "group" ? "Play as a group" : "Choose your country"}
                    </div>
                  </div>

                  {/* Mode switcher tabs */}
                  {!playGameId && (
                    <div
                      style={{
                        display: "flex",
                        background: "rgba(0,0,0,0.35)",
                        padding: 3,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.1)",
                        gap: 2,
                      }}
                    >
                      <button
                        type="button"
                        className="oh-tap-row"
                        onClick={() => setPickerTab("country")}
                        style={touchFit({
                          ...themeButtonStyle,
                          border: "none",
                          borderRadius: 7,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          background: pickerTab === "country" ? "rgba(255,255,255,0.14)" : "transparent",
                          color: pickerTab === "country" ? "#fff" : "rgba(255,255,255,0.6)",
                          padding: "0.4rem 0.85rem",
                        }, touch)}
                      >
                        Pick a country
                      </button>
                      <button
                        type="button"
                        className="oh-tap-row"
                        onClick={() => setPickerTab("group")}
                        style={touchFit({
                          ...themeButtonStyle,
                          border: "none",
                          borderRadius: 7,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          background: pickerTab === "group" ? "rgba(255,255,255,0.14)" : "transparent",
                          color: pickerTab === "group" ? "#fff" : "rgba(255,255,255,0.6)",
                          padding: "0.4rem 0.85rem",
                        }, touch)}
                      >
                        Play as a group
                      </button>
                    </div>
                  )}
                </div>

                {/* Scenario Music Credits */}
                <ScenarioMusicCredits music={countryPicker.music} style={{ flex: "0 0 auto", fontSize: "0.72rem", marginBottom: "0.6rem", maxHeight: "3.5rem", overflowY: "auto" }} />

                {pickerTab === "group" && pickerOffersGroups && !playGameId ? (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
                    {/* A group controls an area without owning it (runtime/groups.js):
                        lead one of the scenario's, or make one. */}
                    <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.76rem", lineHeight: 1.45, marginBottom: "0.6rem" }}>
                      Lead a group instead of a country: a cartel, a militia, a movement, an outbreak. It owns no land; it controls an area, and the world deals with it as what it is.
                    </div>
                    {pickerGroups.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.8rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.78rem", fontWeight: 700 }}>This scenario's groups</div>
                        {pickerGroups.map((entry) => (
                          <button
                            key={entry.name}
                            type="button"
                            className="oh-tap-row"
                            onClick={() => pickGroup({ name: entry.name, color: entry.color, description: entry.description, existing: true })}
                            style={touchFit({ ...themeButtonStyle, alignItems: "center", display: "flex", gap: "0.6rem", justifyContent: "flex-start", textAlign: "left" }, touch)}
                          >
                            <span aria-hidden="true" style={{ background: entry.color, borderRadius: 4, flex: "0 0 auto", height: 16, width: 16 }} />
                            <span style={{ display: "flex", flexDirection: "column", gap: "0.1rem", minWidth: 0 }}>
                              <span data-no-translate style={{ fontWeight: 700 }}>{entry.name}</span>
                              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem" }}>
                                {entry.regionCount === 1 ? "Controls 1 region" : entry.regionCount ? `Controls ${entry.regionCount} regions` : "Controls no area yet"}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.3rem" }}>
                      {pickerGroups.length ? "Or make a new group" : "Make a group"}
                    </div>
                    <FactionCreator
                      mode="group"
                      regionsGeojson={customRegionData}
                      ownerOverrides={pickerOwnerOverrides}
                      customBackground={pickerBackground}
                      colors={pickerColors}
                      busy={isBusy}
                      onCreate={(created) => pickGroup({ ...created, existing: false })}
                      onCancel={() => { closeCountryPicker(); setPickerTab("country"); }}
                    />
                  </div>
                ) : pickerTab === "group" && !playGameId ? (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
                    <FactionCreator
                      mode="group"
                      regionsGeojson={customRegionData}
                      ownerOverrides={pickerOwnerOverrides}
                      customBackground={pickerBackground}
                      colors={pickerColors}
                      busy={isBusy}
                      onCreate={(faction) => pickFaction(faction)}
                      onCancel={() => { closeCountryPicker(); setPickerTab("country"); }}
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flex: 1, minHeight: 0, width: "100%" }}>
                      <Suspense
                        fallback={
                          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", padding: "4rem 0", textAlign: "center", width: "100%" }}>
                            Loading map…
                          </div>
                        }
                      >
                        <CountryPickerMap
                          countryOptions={countryOptions}
                          regionsGeojson={customRegionData}
                          ownerOverrides={pickerOwnerOverrides}
                          customBackground={pickerBackground}
                          colors={pickerColors}
                          onPickCountry={(code) => pickCountry(code)}
                          onPickDefault={() => pickCountry("")}
                          playGameId={playGameId}
                        />
                      </Suspense>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: isMobile ? "0.6rem" : "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.6rem", flexShrink: 0 }}>
                      <button
                        type="button"
                        className="oh-tap-row"
                        onClick={closeCountryPicker}
                        style={touchFit({
                          ...themeButtonStyle,
                          background: "rgba(255,255,255,0.06)",
                          borderRadius: 8,
                          padding: "0.45rem 1.25rem",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                        }, touch)}
                      >
                        {playGameId ? "Done" : "Cancel"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        )}
      </Presence>

      {/* Pressing Play on a game whose scenario this library does not hold. The
          third button appears only when the sender recorded somewhere to fetch
          the map from: a button that cannot do anything is worse than two. */}
      <Presence open={Boolean(missingScenarioGame)} value={missingScenarioGame}>
        {(pending) => (
          <div
            onClick={() => setMissingScenarioGame(null)}
            style={{ alignItems: "center", background: "rgba(0,0,0,0.55)", display: "flex", inset: 0, justifyContent: "center", position: "fixed", zIndex: 10060 }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{ ...themeSurfaceStyle, borderRadius: 16, color: "#fff", fontFamily: "sans-serif", padding: "1.1rem", width: "min(430px, 92vw)" }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 800 }}>This game's scenario isn't here</div>
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.82rem", lineHeight: 1.5, margin: "0.5rem 0 1rem" }}>
                “{pending.name}” was played on{" "}
                <strong style={{ color: "rgba(255,255,255,0.86)" }}>
                  {pending.importedScenarioName || pending.scenarioName}
                </strong>
                , which isn't in your library — so there is no map to open it on.
                {pending.importedScenarioOrigin
                  ? " It's on the community hub, so it can be fetched now."
                  : " Ask whoever sent you the game for the scenario file, then import it from the Scenarios tab."}
              </div>
              {/* Why Import & play did not work. Said here because no editor is
                  open behind this prompt to show it, and one reason is not
                  cured by a second press: the hub no longer offers the file
                  the game was played on. */}
              {missingScenarioError && (
                <div role="alert" style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: "12px", color: "#fecaca", fontSize: "0.8rem", lineHeight: 1.45, marginBottom: "0.8rem", padding: "0.6rem 0.75rem" }}>
                  {missingScenarioError}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                {pending.importedScenarioOrigin && (
                  <button
                    className="oh-tap-row"
                    disabled={isBusy}
                    onClick={() => handleMissingScenarioImport(pending)}
                    style={touchFit({ ...themeButtonStyle, background: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.28)", minHeight: "2.6rem" }, touch)}
                    type="button"
                  >
                    {isBusy ? "Getting the scenario…" : "Import & play"}
                  </button>
                )}
                {/* The hub is only worth offering when the map is actually on it.
                    Otherwise the player has a file to import, and the Scenarios
                    tab is where importing one happens. */}
                <button
                  className="oh-tap-row"
                  onClick={() => {
                    setMissingScenarioGame(null);
                    setActiveTab(pending.importedScenarioOrigin ? "community" : "scenarios");
                  }}
                  style={touchFit({ ...themeButtonStyle, minHeight: "2.6rem" }, touch)}
                  type="button"
                >
                  {pending.importedScenarioOrigin ? "Browse the community hub" : "Go to scenarios"}
                </button>
                <button
                  className="oh-tap-row"
                  onClick={() => setMissingScenarioGame(null)}
                  style={touchFit({ ...themeButtonStyle, minHeight: "2.6rem" }, touch)}
                  type="button"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}
      </Presence>

      {/* Update pressed on a scenario the player has edited. An Update puts the
          hub's file in the scenario's place, so their changes go with it: it is
          asked here first, in the prompt above's own dress, and nothing happens
          on any answer but the first button's. */}
      <Presence open={Boolean(replaceEditsTarget)} value={replaceEditsTarget}>
        {(pending) => (
          <div
            onClick={() => setReplaceEditsTarget(null)}
            style={{ alignItems: "center", background: "rgba(0,0,0,0.55)", display: "flex", inset: 0, justifyContent: "center", position: "fixed", zIndex: 10060 }}
          >
            <div
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              style={{ ...themeSurfaceStyle, borderRadius: 16, color: "#fff", fontFamily: "sans-serif", padding: "1.1rem", width: "min(430px, 92vw)" }}
            >
              <div style={{ fontSize: "1rem", fontWeight: 800 }}>Replace your changes?</div>
              <div data-no-translate style={{ color: "rgba(255,255,255,0.86)", fontSize: "0.86rem", fontWeight: 700, marginTop: "0.35rem", overflowWrap: "anywhere" }}>
                {pending.scenario.name}
              </div>
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.82rem", lineHeight: 1.5, margin: "0.5rem 0 1rem" }}>
                You have changed this scenario since you downloaded it. Updating replaces it with the community hub's checked file, so your changes to it will be lost. To keep them, clone the scenario first. Games already started on it keep working.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                <button
                  className="oh-tap-row"
                  onClick={() => {
                    setReplaceEditsTarget(null);
                    handleScenarioUpdate(pending.scenario, { post: pending.post, replaceEdits: true });
                  }}
                  style={touchFit({ ...themeButtonStyle, background: "rgba(127,29,29,0.34)", borderColor: "rgba(248,113,113,0.28)", color: "#fecaca", minHeight: "2.6rem" }, touch)}
                  type="button"
                >
                  Update and replace my changes
                </button>
                <button
                  className="oh-tap-row"
                  onClick={() => setReplaceEditsTarget(null)}
                  style={touchFit({ ...themeButtonStyle, minHeight: "2.6rem" }, touch)}
                  type="button"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}
      </Presence>

      <input
        ref={importScenarioInputRef}
        accept={acceptFor(".json,application/json,.zip,application/zip")}
        onChange={handleImportScenarioFile}
        style={{ display: "none" }}
        type="file"
      />

      {/* A game export is always a .zip — the bundle alone is never a whole game,
          because its restore points and any map ride beside it. */}
      <input
        ref={importGameInputRef}
        accept={acceptFor(".zip,application/zip")}
        onChange={handleImportGameFile}
        style={{ display: "none" }}
        type="file"
      />

      {/* The Main Menu: a full page over everything in-game. Opens on app start
          (module default) and via Exit Game; closes only by entering a game.
          On a wide screen its pages are a rail down the left (MenuRail) and
          each page has a header of its own: its name, and its actions. On a
          phone the pages are a row across the top, and the actions head the
          page by name. */}
      <Presence open={menuOpen}>
        <div
          style={{
            background:
              "#0f0f11",
            color: "#fff",
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            fontFamily: "sans-serif",
            inset: 0,
            position: "fixed",
            zIndex: 10046,
          }}
        >
          {isMobile ? (
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "0.55rem",
                  height: `calc(${BAR_HEIGHT}px + ${SAFE_TOP})`,
                  overflowX: "auto",
                  padding: `${SAFE_TOP} calc(0.5rem + ${SAFE_RIGHT}) 0 calc(0.5rem + ${SAFE_LEFT})`,
                  scrollbarWidth: "none",
                }}
              >
                {/* On a phone too, the mark opens the history of the game's updates. */}
                <button aria-label="Update history" className="oh-tap" onClick={() => setHistoryOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "0 0.2rem" }} title="Update history: every update to Open Historia" type="button">
                  <img alt="" src="/logo.png" style={{ display: "block", height: "1.7rem", width: "1.7rem" }} />
                </button>
                {MENU_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    aria-current={activeTab === tab.id ? "page" : undefined}
                    className="oh-tap-row"
                    onClick={() => setActiveTab(tab.id)}
                    style={touchFit({
                      ...themeButtonStyle,
                      background: activeTab === tab.id ? "var(--oh-grey-selected)" : "rgba(255,255,255,0.05)",
                      borderColor: activeTab === tab.id ? "var(--oh-grey-border-strong)" : "rgba(255,255,255,0.08)",
                      minWidth: "0",
                      padding: "0.55rem 0.6rem",
                    }, touch)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MenuRail activeTab={activeTab} onOpenHistory={() => setHistoryOpen(true)} onOpenSettings={onOpenSettings} onTab={setActiveTab} />
          )}

          <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          {!isMobile && (
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "0.9rem",
                  justifyContent: "space-between",
                  margin: "0 auto",
                  maxWidth: APP_SHELL_MAX_WIDTH,
                  minHeight: `calc(${BAR_HEIGHT}px + ${SAFE_TOP})`,
                  padding: `calc(0.85rem + ${SAFE_TOP}) calc(1.6rem + ${SAFE_RIGHT}) 0.85rem 1.6rem`,
                  width: "100%",
                }}
              >
                <h1 style={{ color: "#fff", fontSize: "1.42rem", fontWeight: 800, letterSpacing: "-0.03em", margin: 0, minWidth: 0 }}>
                  {MENU_TABS.find((tab) => tab.id === activeTab)?.label ?? ""}
                </h1>
                <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "0.55rem", justifyContent: "flex-end" }}>
                  {tabActions.map(({ icon, label, run }) => (
                    <button key={label} className="oh-tap-row" onClick={run} style={touchFit({ ...themeButtonStyle, flexShrink: 0 }, touch)} type="button">
                      <ButtonIcon kind={icon} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            <div style={{ margin: "0 auto", maxWidth: APP_SHELL_MAX_WIDTH, padding: isMobile ? `1.1rem calc(0.8rem + ${SAFE_RIGHT}) calc(2.5rem + ${SAFE_BOTTOM}) calc(0.8rem + ${SAFE_LEFT})` : `1.5rem calc(1.6rem + ${SAFE_RIGHT}) calc(3rem + ${SAFE_BOTTOM}) 1.6rem`, width: "100%" }}>
            {/* Phones: the tab's actions head the page, by name. In the bar they
                would be icon-only controls named by a tooltip, which a finger
                never sees, and the bar has no room for words beside the tabs. */}
            {isMobile && (typeof onOpenSettings === "function" || tabActions.length > 0) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.1rem" }}>
                {typeof onOpenSettings === "function" && (
                  <button className="oh-tap-row" onClick={onOpenSettings} style={touchFit(themeButtonStyle, touch)} type="button">
                    <ButtonIcon kind="settings" />
                    Settings
                  </button>
                )}
                {tabActions.map(({ icon, label, phoneLabel, run }) => (
                  <button key={label} className="oh-tap-row" onClick={run} style={touchFit(themeButtonStyle, touch)} type="button">
                    <ButtonIcon kind={icon} />
                    {phoneLabel || label}
                  </button>
                ))}
              </div>
            )}
            {activeTab !== "community" && activeTab !== "lobbies" && (
              <SuggestionsBanner scenarios={scenarios} onOpen={(scenario) => openScenarioEditor(scenario.id)} />
            )}
            {/* While a page, or what it lists, is on its way: the outlines of
                its cards with a glimmer over them, never the word "Loading"
                (menuSkeleton.jsx). A screen reader is told in these words. */}
            {activeTab === "lobbies" ? (
              <Suspense fallback={<LobbiesSkeleton label="Loading lobbies…" />}>
                <LobbiesTab hosting={lobbyHosting} onHostingChange={setLobbyHosting} onEnterGame={enterActiveGame} />
              </Suspense>
            ) : activeTab === "community" ? (
              // The Community tab's browse grid has the library's template
              // (communityHub.jsx COMMUNITY_GRID_TEMPLATE), which cannot be
              // read from here without loading the tab.
              <Suspense fallback={<CommunitySkeleton count={isMobile ? 3 : 8} gridTemplate={LIBRARY_GRID_TEMPLATE} label="Loading Community…" withHeader />}>
                <CommunityPanel fullPage onPlay={handleScenarioPlay} />
              </Suspense>
            ) : activeTab === "games" ? (
              <>
              {loaded && visibleGames.length === 0 && archivedGames.length === 0 ? (
                <div style={{ alignItems: "center", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
                  <img alt="" src="/logo.png" style={{ height: "5rem", marginBottom: "1.2rem", opacity: 0.9, width: "5rem" }} />
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>No games yet</div>
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.95rem", lineHeight: 1.6, margin: "0.6rem 0 1.6rem", maxWidth: "26rem" }}>
                    Start a new game from one of your scenarios, or grab new scenarios from the community first.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem", justifyContent: "center" }}>
                    <button type="button" style={{ ...themeButtonStyle, background: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.28)", minHeight: "2.8rem", padding: "0 1.4rem" }} onClick={() => setActiveTab("scenarios")}>
                      Start from a scenario
                    </button>
                    <button type="button" style={{ ...themeButtonStyle, minHeight: "2.8rem", padding: "0 1.4rem" }} onClick={() => setActiveTab("community")}>
                      Browse community scenarios
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {continueGames.length > 0 && (
                    <MenuRow description="Pick up exactly where you left off." icon="▶" title="Continue Playing">
                      {continueGames.map((game) => (
                        <GameCard key={game.id} active={game.id === activeGameId} busy={isBusy} game={game} onActivate={handleGameActivate} onArchive={handleGameArchive} onClone={handleGameClone} onDelete={handleGameDelete} onEdit={openGameEditor} onExport={handleGameExport} />
                      ))}
                    </MenuRow>
                  )}
                  <LibraryCollection
                    title="All Games"
                    description="One library for every campaign. Search, sort or show archived saves without duplicating them into another shelf."
                    emptyText={gameSearch ? "No games match your search." : "No games in this view."}
                    controls={(
                      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                        <input aria-label="Search games" onChange={(event) => setGameSearch(event.target.value)} placeholder="Search games…" value={gameSearch} style={{ ...inputStyle, borderRadius: "9px", minHeight: "2.35rem", padding: "0 0.9rem", width: isMobile ? "100%" : "16rem" }} />
                        {[['active', 'Active'], ['all', 'All'], ['archived', 'Archived']].map(([value, label]) => (
                          <BrowsePill key={value} active={gameView === value} onClick={() => setGameView(value)}>{label}</BrowsePill>
                        ))}
                        <select aria-label="Sort games" onChange={(event) => setGameSort(event.target.value)} value={gameSort} style={{ ...inputStyle, borderRadius: "9px", minHeight: "2.35rem", padding: "0 0.85rem", width: "auto" }}>
                          <option value="recent">Recently played</option>
                          <option value="turns">Most turns</option>
                          <option value="played">Most played</option>
                          <option value="name">Name</option>
                        </select>
                      </div>
                    )}
                  >
                    {/* Until the library has come, its cards' outlines: one
                        child either way, so an empty view still says so. */}
                    {loaded
                      ? browsedGames.map((game) => (
                        <GameCard key={game.id} active={game.id === activeGameId} busy={isBusy} game={game} onActivate={handleGameActivate} onArchive={handleGameArchive} onClone={handleGameClone} onDelete={handleGameDelete} onEdit={openGameEditor} onExport={handleGameExport} />
                      ))
                      : <MenuCardSkeletons count={isMobile ? 3 : 8} kind="game" width={SHELF_CARD_WIDTH} />}
                  </LibraryCollection>
                </>
              )}
              <RecentlyDeletedRow kind="game" onChanged={refreshTrash} trash={trash} />
              </>
            ) : (
              <>
                {recentScenarios.length > 0 && (
                  <MenuRow description="The scenarios behind your latest games and edits." icon="🕐" title="Recently Used">
                    {recentScenarios.map((scenario) => (
                      <ScenarioCard
                        key={scenario.id}
                        onClone={handleScenarioClone}
                        onEdit={openScenarioEditor}
                        onPlay={handleScenarioPlay}
                        onSelect={selectScenario}
                        onUpdate={handleScenarioUpdate}
                        scenario={scenario}
                        selected={scenario.id === selectedScenarioId}
                        updateReason={scenarioUpdateReason(scenario)}
                        updateNote={scenarioUpdateNotes.get(scenario.id) ?? ""}
                        updating={updatingScenarioIds.has(scenario.id)}
                      />
                    ))}
                  </MenuRow>
                )}
                <LibraryCollection
                  title="Scenario Library"
                  description="Everything you can start a new game from, in one place."
                  emptyText={scenarioSearch ? "No scenarios match your search." : "No scenarios in this view."}
                  controls={(
                    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                      <input aria-label="Search scenarios" onChange={(event) => setScenarioSearch(event.target.value)} placeholder="Search scenarios…" value={scenarioSearch} style={{ ...inputStyle, borderRadius: "9px", minHeight: "2.35rem", padding: "0 0.9rem", width: isMobile ? "100%" : "16rem" }} />
                      {[['all', 'All'], ['yours', 'Yours'], ['community', 'Community'], ['updates', 'Updates']].map(([value, label]) => (
                        <BrowsePill key={value} active={scenarioView === value} onClick={() => setScenarioView(value)}>{label}</BrowsePill>
                      ))}
                      <select aria-label="Sort scenarios" onChange={(event) => setScenarioSort(event.target.value)} value={scenarioSort} style={{ ...inputStyle, borderRadius: "9px", minHeight: "2.35rem", padding: "0 0.85rem", width: "auto" }}>
                        <option value="recent">Recently used</option>
                        <option value="updated">Recently updated</option>
                        <option value="played">Most played</option>
                        <option value="name">Name</option>
                      </select>
                    </div>
                  )}
                >
                  {(scenarioView === "all" || scenarioView === "yours") && !scenarioSearch.trim() ? <CreateScenarioTile busy={isBusy} onCreate={handleCreateScenario} /> : null}
                  {/* Until the library has come, its cards' outlines, after the + that is already there. */}
                  {loaded
                    ? browsedScenarios.map((scenario) => (
                      <ScenarioCard
                        key={scenario.id}
                        onClone={handleScenarioClone}
                        onEdit={openScenarioEditor}
                        onPlay={handleScenarioPlay}
                        onSelect={selectScenario}
                        onUpdate={handleScenarioUpdate}
                        scenario={scenario}
                        selected={scenario.id === selectedScenarioId}
                        updateReason={scenarioUpdateReason(scenario)}
                        updateNote={scenarioUpdateNotes.get(scenario.id) ?? ""}
                        updating={updatingScenarioIds.has(scenario.id)}
                      />
                    ))
                    : <MenuCardSkeletons count={isMobile ? 3 : 7} kind="scenario" width={SHELF_CARD_WIDTH} />}
                </LibraryCollection>
                <RecentlyDeletedRow kind="scenario" onChanged={refreshTrash} trash={trash} />
              </>
            )}
            </div>
          </div>
          </div>
        </div>
      </Presence>
      {menuOpen && historyOpen && (
        <Suspense fallback={null}>
          <UpdateHistory onClose={() => setHistoryOpen(false)} />
        </Suspense>
      )}

      <EditorDrawer
        details={editorDetails}
        editorError={editorError || error}
        editorSection={editorSection}
        fileInputsRef={assetFileInputsRef}
        formState={editorState}
        isBusy={isBusy || loading}
        kind={editorKind}
        onChange={handleEditorChange}
        onChangePrompt={handlePromptChange}
        onClearAsset={handleEditorAssetClear}
        onClose={closeEditor}
        onDelete={handleDelete}
        onExportBundle={handleExportBundle}
        onExportPrompts={handleExportPrompts}
        onImportPrompts={handleImportPrompts}
        onDetailsChange={(nextDetails) => {
          setEditorDetails(nextDetails);
          setEditorState((current) => current ? { ...current } : current);
        }}
        onOpenMapEditor={() => openMapEditorFor(editorDetails?.scenario || null, editorDetails?.data?.world ?? {}, {
          gameDate: editorState?.gameDate ?? editorDetails?.data?.game?.gameDate ?? "",
          warSettings: editorState?.warSettings,
        })}
        communityCard={drawerScenario ? (
          <ScenarioCommunityCard
            scenario={drawerScenario}
            busy={communityBusy}
            refreshNote={communityNote}
            onSuggest={() => handleSuggestChanges(drawerScenario)}
            onUnlink={() => handleUnlinkOrigin(drawerScenario)}
            onReview={(source) => setReviewTarget({ scenarioId: drawerScenario.id, source })}
            onOpenFile={(file) => handleOpenSuggestionFile(drawerScenario, file)}
            onRefresh={() => handleRefreshSuggestions(drawerScenario)}
            onForgetPost={() => handleForgetPost(drawerScenario)}
            onRejectContributor={handleRejectContributor}
            onUnblockContributor={handleUnblockContributor}
          />
        ) : null}
        onSuggestChanges={drawerScenario?.hubOrigin?.editedAt ? () => handleSuggestChanges(drawerScenario) : null}
        countryOptions={editorCountryOptions}
        onFileSelect={handleEditorAssetSelect}
        onOpenFileDialog={(assetKey) => assetFileInputsRef.current[assetKey]?.click()}
        onSave={handleSave}
        promptSectionKey={promptSectionKey}
        setEditorSection={setEditorSection}
        setPromptSectionKey={setPromptSectionKey}
        statsValue={editorStats}
        onStatsChange={setEditorStats}
      />

      {/* Until the library has come the Games and Scenarios tabs show their
          cards' outlines (menuSkeleton.jsx), and nothing on the screen says
          "Loading": this says it to a screen reader alone. */}
      {!loaded && (
        <div className="oh-visually-hidden" role="status">
          Loading games and scenarios...
        </div>
      )}
    </>
  );
};

export { LibraryTopBar, TOP_BAR_OFFSET };
