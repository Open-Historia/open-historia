/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Native map tools in a compact, Photoshop-style floating palette. The tools
// remain the existing OlMap modes, not a second editing or selection engine.

import Icon from "./Icon.jsx";
import { TOOL_GROUPS, TOOLS } from "./editorToolCatalog.js";
import { EDITOR_NAV, toolButton } from "./editorStyles.js";

export default function EditorToolDock({ activeTool, onToolChange, onUndo, onRedo, canUndo, canRedo, onFit, visible = true }) {
  if (!visible) return null;
  const current = TOOLS.find((tool) => tool.id === activeTool);
  const chrome = { ...toolButton(false, false), width: 38, minWidth: 38, height: 38, padding: 0, flexShrink: 0 };
  return (
    <div
      style={{
        position: "fixed",
        left: "var(--editor-dock-left, 0px)",
        right: "var(--editor-dock-right, 0px)",
        bottom: 14,
        zIndex: 33,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        padding: "0 12px",
      }}
    >
      <div
        aria-label="Map drawing and editing tools"
        role="toolbar"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: "100%",
          gap: 8,
          padding: "7px 10px",
          background: EDITOR_NAV,
          border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.18))",
          boxShadow: "0 12px 42px rgba(0,0,0,0.4)",
          borderRadius: 14,
          pointerEvents: "auto",
        }}
      >
        {TOOL_GROUPS.map((group, index) => (
          <div
            key={group.label}
            aria-label={group.label + " tools"}
            role="group"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              paddingLeft: index ? 8 : 0,
              borderLeft: index ? "1px solid var(--oh-ui-line, rgba(255,255,255,0.16))" : "none",
            }}
          >
            {group.tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                title={`${tool.label} (${tool.hotkey})`}
                aria-label={`${tool.label} — ${tool.hotkey}`}
                aria-keyshortcuts={tool.hotkey}
                aria-pressed={activeTool === tool.id}
                onClick={() => onToolChange(tool.id)}
                style={{ ...toolButton(activeTool === tool.id, false), position: "relative", width: 43, minWidth: 43, height: 43, padding: 0 }}
              >
                <Icon name={tool.icon} size={18} />
                <span aria-hidden="true" style={{
                  position: "absolute", right: 3, bottom: 1,
                  fontSize: 9, lineHeight: "12px", fontWeight: 800,
                  color: "var(--oh-ui-text, #f6f6f8)", opacity: 0.85,
                  pointerEvents: "none",
                }}>{tool.hotkey}</span>
              </button>
            ))}
          </div>
        ))}
        <div role="group" aria-label="Map history and view" style={{
          display: "flex", alignItems: "center", gap: 3,
          borderLeft: "1px solid var(--oh-ui-line, rgba(255,255,255,0.16))", paddingLeft: 8,
        }}>
          <button title="Undo region edit" aria-label="Undo region edit" type="button" disabled={!canUndo} onClick={onUndo}
            style={{ ...chrome, opacity: canUndo ? 1 : .38 }}>
            <Icon name="undo" size={16} />
          </button>
          <button title="Redo region edit" aria-label="Redo region edit" type="button" disabled={!canRedo} onClick={onRedo}
            style={{ ...chrome, opacity: canRedo ? 1 : .38 }}>
            <Icon name="redo" size={16} />
          </button>
          <button title="Fit map to all regions" aria-label="Fit map to all regions" type="button" onClick={onFit} style={chrome}>
            <Icon name="fit" size={16} />
          </button>
        </div>
        {current && <span
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 8px)",
            transform: "translateX(-50%)",
            maxWidth: "min(250px, 90vw)",
            padding: "5px 10px",
            borderRadius: 9,
            border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.18))",
            background: EDITOR_NAV,
            boxShadow: "0 5px 18px rgba(0,0,0,0.24)",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--oh-ui-text, #f6f6f8)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >{current.label.split(" (")[0]}</span>}
      </div>
    </div>
  );
}
