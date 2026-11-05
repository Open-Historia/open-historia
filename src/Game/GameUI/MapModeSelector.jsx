/*! Open Historia — Map Mode Selector & Legend © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { memo, useState } from "react";
import { MAP_SETTING_KEYS, setMapSettingValue, useMapSettingValue } from "../../runtime/mapSettings.js";
import { DIPLO_COLORS } from "../../runtime/diplomaticStance.js";
import { SAFE_BOTTOM } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";

const DEFAULT_DOCK_STYLE = { right: "0.5rem" };

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

const LEGEND_ITEMS = [
  { label: "You", color: DIPLO_COLORS.player },
  { label: "Puppets", color: DIPLO_COLORS.puppet },
  { label: "Allies", color: DIPLO_COLORS.ally },
  { label: "Friendly / Trade", color: DIPLO_COLORS.friendly },
  { label: "Hostile", color: DIPLO_COLORS.hostile },
  { label: "At War", color: DIPLO_COLORS.enemy },
  { label: "Neutral", color: DIPLO_COLORS.neutral },
];

export const MapModeSelector = memo(function MapModeSelector({ dockStyle = DEFAULT_DOCK_STYLE }) {
  const isMobile = useIsMobile();
  const mapMode = useMapSettingValue(MAP_SETTING_KEYS.mapMode, "political");
  const [showLegend, setShowLegend] = useState(true);

  const setMode = (mode) => {
    setMapSettingValue(MAP_SETTING_KEYS.mapMode, mode);
  };

  const isDiplo = mapMode === "diplomatic";

  return (
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
      {/* Legend popup when diplomatic mode is active */}
      {isDiplo && showLegend && (
        <div
          style={{
            background: "var(--oh-hud-bg)",
            backdropFilter: "var(--oh-hud-blur)",
            WebkitBackdropFilter: "var(--oh-hud-blur)",
            border: "1px solid var(--oh-hud-border)",
            borderRadius: "10px",
            boxShadow: "var(--oh-hud-shadow-soft)",
            padding: "0.45rem 0.6rem",
            color: "white",
            fontSize: "0.72rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
            minWidth: "125px",
            // Beside the advisor's and the country's buttons, not over them: past their width and a gap.
            marginRight: "4.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: "0.25rem",
              marginBottom: "0.15rem",
              fontWeight: 700,
              color: "rgba(255,255,255,0.75)",
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              fontSize: "0.62rem",
            }}
          >
            <span>Diplomacy</span>
            <button
              type="button"
              onClick={() => setShowLegend(false)}
              title="Close legend"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
                padding: "0 0.15rem",
                fontSize: "0.75rem",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          {LEGEND_ITEMS.map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                lineHeight: 1.2,
              }}
            >
              <span
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  backgroundColor: item.color,
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${item.color}55`,
                }}
              />
              <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.7rem" }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Mode switcher bar */}
      <div
        style={{
          background: "var(--oh-hud-bg)",
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: isMobile ? "0.35rem 0.55rem" : "0.35rem 0.65rem",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            background: !isDiplo ? "rgba(255,255,255,0.14)" : "transparent",
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
            setShowLegend(true);
          }}
          title="Diplomatic map mode"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: isMobile ? "0.35rem 0.55rem" : "0.35rem 0.65rem",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            background: isDiplo ? "rgba(37,99,235,0.3)" : "transparent",
            color: isDiplo ? "#60a5fa" : "rgba(255,255,255,0.55)",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: isDiplo ? "rgba(96,165,250,0.4)" : "transparent",
            fontSize: "0.75rem",
            fontWeight: isDiplo ? 600 : 400,
            transition: "all 0.15s ease",
          }}
        >
          <DiplomaticIcon />
          {!isMobile && <span>Diplomatic</span>}
        </button>
      </div>
    </div>
  );
});

export default MapModeSelector;
