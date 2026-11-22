/*! Open Historia — Map Mode Selector & Legend © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { memo, useEffect } from "react";
import { MAP_SETTING_KEYS, setMapSettingValue, useMapSettingValue } from "../../runtime/mapSettings.js";
import { getDiplomaticMapState, loadDiplomaticMapStateForGame, setDiplomaticMapState } from "../../runtime/diplomaticMapSettings.js";
import { useLibraryState } from "../../runtime/library.js";
import { SAFE_BOTTOM, SAFE_RIGHT } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useDiplomaticMapState } from "../Map/useDiplomaticView.js";
import { DiplomaticLegend, DiplomaticTooltip } from "./DiplomaticLegend.jsx";

const DEFAULT_DOCK_STYLE = { right: "0.5rem" };

const MAP_MODE_LABELS = Object.freeze({
  showLegend: "Show legend",
});

const MapIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
);

const DiplomaticIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const LegendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="4" width="5" height="4" rx="1" /><rect x="3" y="10" width="5" height="4" rx="1" /><rect x="3" y="16" width="5" height="4" rx="1" />
    <path d="M11 6h10M11 12h10M11 18h10" />
  </svg>
);

// The map mode and the diplomatic map's choices are kept for each game
// (runtime/diplomaticMapSettings.js): a game opens on the map it was left on,
// a new one on the political map.
const useMapModeKeptPerGame = (mapMode) => {
  const { activeGame } = useLibraryState();
  const gameId = String(activeGame?.id || "");
  useEffect(() => {
    const kept = loadDiplomaticMapStateForGame(gameId);
    setMapSettingValue(MAP_SETTING_KEYS.mapMode, kept.mode);
  }, [gameId]);
  useEffect(() => {
    const mode = mapMode === "diplomatic" ? "diplomatic" : "political";
    if (getDiplomaticMapState().mode !== mode) setDiplomaticMapState({ mode });
  }, [mapMode]);
};

export const MapModeSelector = memo(function MapModeSelector({ dockStyle = DEFAULT_DOCK_STYLE }) {
  const isMobile = useIsMobile();
  const mapMode = useMapSettingValue(MAP_SETTING_KEYS.mapMode, "political");
  useMapModeKeptPerGame(mapMode);
  const { legendOpen } = useDiplomaticMapState();

  const setMode = (mode) => {
    setMapSettingValue(MAP_SETTING_KEYS.mapMode, mode);
  };

  const isDiplo = mapMode === "diplomatic";
  const legendShown = isDiplo && legendOpen;

  return (
    <>
      {/* On a phone the legend stands above the advisor's button, clear of the dock and of search even when its
          bar is open (search.jsx: 5rem up, 3rem tall); on a wider screen it rides over the switch, beside the
          advisor's and the country's buttons. */}
      {legendShown && isMobile && (
        <div style={{ position: "fixed", right: `calc(0.5rem + ${SAFE_RIGHT})`, bottom: `calc(8.4rem + ${SAFE_BOTTOM})`, zIndex: 9997 }}>
          <DiplomaticLegend isMobile />
        </div>
      )}
      {isDiplo && <DiplomaticTooltip />}
      <div
        style={{
          ...dockStyle,
          position: "fixed",
          // At the foot of the right-hand stack, under the advisor's button and the country's (main.jsx AdvisorButton,
          // other.jsx), which stand above it: "have the map switch be under the advisor button" (the owner).
          bottom: `calc(0.5rem + ${SAFE_BOTTOM})`,
          zIndex: 9997,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "0.35rem",
          fontFamily: "sans-serif",
        }}
      >
        {legendShown && !isMobile && (
          // Beside the advisor's and the country's buttons, not over them: past their width and a gap.
          <div style={{ marginRight: "4.5rem" }}>
            <DiplomaticLegend />
          </div>
        )}

        {/* Mode switcher bar: the theme's glass, as the dock's tray (chat.jsx Toolbar). */}
        <div
          style={{
            background: "var(--oh-ui-glass-pill, var(--oh-hud-bg))",
            backdropFilter: "var(--oh-hud-blur)",
            WebkitBackdropFilter: "var(--oh-hud-blur)",
            border: "1px solid var(--oh-hud-border)",
            borderRadius: "12px",
            boxShadow: "var(--oh-hud-shadow-soft)",
            display: "flex",
            padding: "0.2rem",
            gap: "0.2rem",
          }}
        >
          <button
            type="button"
            onClick={() => setMode("political")}
            title="Political map mode"
            data-oh-theme-hud=""
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: isMobile ? "0.35rem 0.55rem" : "0.35rem 0.65rem",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              background: !isDiplo ? "var(--oh-ui-glass-active, rgba(255,255,255,0.14))" : "transparent",
              color: !isDiplo ? "#ffffff" : "rgba(255,255,255,0.55)",
              fontSize: "0.75rem",
              fontWeight: !isDiplo ? 600 : 400,
              transition: "all 0.15s ease",
            }}
          >
            <MapIcon />
            {!isMobile && <span>Political</span>}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("diplomatic");
              setDiplomaticMapState({ legendOpen: true });
            }}
            title="Diplomatic map mode"
            data-oh-theme-hud=""
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: isMobile ? "0.35rem 0.55rem" : "0.35rem 0.65rem",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              background: isDiplo ? "var(--oh-ui-glass-active, rgba(255,255,255,0.14))" : "transparent",
              color: isDiplo ? "var(--oh-ui-glass-active-text, #ffffff)" : "rgba(255,255,255,0.55)",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: isDiplo ? "var(--oh-ui-glass-active-line, rgba(255,255,255,0.28))" : "transparent",
              fontSize: "0.75rem",
              fontWeight: isDiplo ? 600 : 400,
              transition: "all 0.15s ease",
            }}
          >
            <DiplomaticIcon />
            {!isMobile && <span>Diplomatic</span>}
          </button>

          {/* The legend, hidden, comes back from here without leaving the diplomatic map. */}
          {isDiplo && !legendOpen && (
            <button
              type="button"
              onClick={() => setDiplomaticMapState({ legendOpen: true })}
              title={MAP_MODE_LABELS.showLegend}
              aria-label={MAP_MODE_LABELS.showLegend}
              data-oh-theme-hud=""
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0.35rem 0.5rem",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: "rgba(255,255,255,0.75)",
              }}
            >
              <LegendIcon />
            </button>
          )}
        </div>
      </div>
    </>
  );
});

export default MapModeSelector;
