/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Top editing toolbar. Tool selection is single-choice; the active tool drives
// which OpenLayers interactions are mounted (OlMap.jsx's interaction effect).
// Every tool has its own glyph: on a phone there are no tooltips, so the icon
// is all a player has to tell two tools apart.

import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import { panelSurface, toolButton } from "./editorStyles.js";

const TOOLS = [
  { id: "select", icon: "select", label: "Select" },
  { id: "lasso", icon: "lasso", label: "Lasso select (drag to circle regions)" },
  { id: "pan", icon: "pan", label: "Pan" },
  { sep: true },
  { id: "draw", icon: "split", label: "Draw region (click a border to trace along it)" },
  { id: "modify", icon: "modify", label: "Edit vertices (select regions first; snap + undo enabled)" },
  { id: "border", icon: "merge", label: "Shared border precision (select exactly 2 neighbouring regions)" },
  { id: "move", icon: "move", label: "Move" },
  { id: "delete", icon: "trash", label: "Delete (click a region)" },
  { sep: true },
  { id: "dissolve", icon: "eraser", label: "Delete border (merge two regions)" },
  { id: "paint", icon: "paint", label: "Paint polity (click or drag across regions; one stroke = one undo)" },
  { id: "feature", icon: "feature", label: "City tool (click map to add a city, click a city to edit it)" },
  { id: "marker", icon: "pin", label: "Map feature tool (click the map to place a base, port, landmark or other feature; click one to edit it)" },
  { id: "unit", icon: "unit", label: "Unit tool (click the map to place a starting unit, click a unit to edit it)" },
  { id: "feature-box", icon: "boxSelect", label: "Box-select features (drag a rectangle over cities and features to select them all)" },
];

// The CSS variable the side panels (Panel.jsx) read for their top edge, so a
// strip that wrapped into two rows pushes them down instead of sitting under
// them.
export const TOOLBAR_BOTTOM_VAR = "--editor-toolbar-bottom";

const Separator = () => (
  <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.14)", margin: "0 2px" }} />
);

// On desktop the strip sits in a band between the documents chip on the left
// and the Save / Apply / Close group on the right, centred in that band and
// wrapping into more rows when the band is narrower than the strip. Centring on
// the whole window instead let the last tools slide underneath the Save buttons
// on a ~1000px window, where a click on the City or Unit tool hit Save & Exit.
// On a phone the side groups are one icon wide, so the band is the window.
const Toolbar = ({ activeTool, onToolChange, onFit, onUndo, onRedo, canUndo, canRedo, isMobile = false }) => {
  const stripRef = useRef(null);

  useEffect(() => {
    const strip = stripRef.current;
    const root = document.documentElement;
    if (!strip || typeof ResizeObserver === "undefined") return undefined;
    const publish = () => {
      root.style.setProperty(TOOLBAR_BOTTOM_VAR, `${Math.ceil(strip.getBoundingClientRect().bottom) + 6}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(strip);
    return () => {
      observer.disconnect();
      root.style.removeProperty(TOOLBAR_BOTTOM_VAR);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: isMobile ? 6 : 130,
        right: isMobile ? 6 : 440,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 30,
      }}
    >
      <div
        ref={stripRef}
        style={{
          ...panelSurface,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: "100%",
          gap: 4,
          padding: "6px 8px",
          pointerEvents: "auto",
        }}
      >
        {TOOLS.map((t, i) =>
          t.sep ? (
            <Separator key={`sep-${i}`} />
          ) : (
            <button
              key={t.id}
              title={t.label}
              onClick={() => onToolChange(t.id)}
              style={toolButton(activeTool === t.id, false)}
            >
              <Icon name={t.icon} />
            </button>
          ),
        )}
        <Separator />
        <button title="Undo" disabled={!canUndo} onClick={onUndo} style={toolButton(false, !canUndo)}>
          <Icon name="undo" />
        </button>
        <button title="Redo" disabled={!canRedo} onClick={onRedo} style={toolButton(false, !canRedo)}>
          <Icon name="redo" />
        </button>
        <Separator />
        <button title="Fit to data" onClick={onFit} style={toolButton(false, false)}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
