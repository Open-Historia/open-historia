/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Top editing toolbar. Tool selection is single-choice; the active tool drives
// which OpenLayers interactions are mounted (see useEditorInteractions, later
// phases). P1 wires Select + Pan; the geometry tools are shown but disabled until
// their phases land, so the layout matches the official editor from the start.

import Icon from "./Icon.jsx";
import { panelSurface, toolButton } from "./editorStyles.js";

const TOOLS = [
  { id: "select", icon: "select", label: "Select", enabled: true },
  { id: "lasso", icon: "lasso", label: "Lasso select (drag to circle regions)", enabled: true },
  { id: "pan", icon: "pan", label: "Pan", enabled: true },
  { sep: true },
  { id: "draw", icon: "draw", label: "Draw region / land", enabled: true },
  { id: "modify", icon: "modify", label: "Edit vertices", enabled: true },
  { id: "move", icon: "move", label: "Move", enabled: true },
  { id: "delete", icon: "trash", label: "Delete (click a region)", enabled: true },
  { sep: true },
  { id: "split", icon: "split", label: "Split (drag across a region to cut it)", enabled: true },
  { id: "dissolve", icon: "eraser", label: "Delete border (merge two regions)", enabled: true },
  { id: "paint", icon: "paint", label: "Paint owner (click regions)", enabled: true },
  { id: "feature", icon: "feature", label: "City tool (click map to add a city, click a city to edit it)", enabled: true },
];

const Separator = () => (
  <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.14)", margin: "0 2px" }} />
);

const Toolbar = ({ activeTool, onToolChange, onFit, onUndo, onRedo, canUndo, canRedo }) => (
  <div
    style={{
      ...panelSurface,
      position: "fixed",
      top: 12,
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      // Wraps into extra rows on narrow (phone) screens instead of overflowing.
      flexWrap: "wrap",
      justifyContent: "center",
      maxWidth: "calc(100vw - 12px)",
      gap: 4,
      padding: "6px 8px",
      zIndex: 30,
    }}
  >
    {TOOLS.map((t, i) =>
      t.sep ? (
        <Separator key={`sep-${i}`} />
      ) : (
        <button
          key={t.id}
          title={t.enabled ? t.label : `${t.label} (coming soon)`}
          disabled={!t.enabled}
          onClick={() => t.enabled && onToolChange(t.id)}
          style={toolButton(activeTool === t.id, !t.enabled)}
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
);

export default Toolbar;
