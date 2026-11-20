/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The region clipboard panel: what was copied (from which map, whose regions),
// Paste into this map, Clear. Copying happens from the selection panel or with
// Ctrl+C; pasting also with Ctrl+V. See regionClipboard.js for what travels.

import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton } from "./editorStyles.js";
import { describeClipboard, formatCopiedDay } from "./regionClipboard.js";
import { WorkspaceEmpty, WorkspaceHeading, WorkspaceStats, workspaceCard, workspaceMuted } from "./EditorWorkspaceControls.jsx";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ago = (iso) => {
  const then = Date.parse(iso || "");
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return formatCopiedDay(then);
};

const ClipboardPanel = ({ clipboard, selectionCount = 0, result = null, simplify = true, onSimplifyChange, onCopySelection, onPaste, onClear, onClose }) => {
  const summary = describeClipboard(clipboard);
  return (
    <Panel
      title="Clipboard"
      icon="copy"
      onClose={onClose}
      width={490}
      footer={
        summary ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{plural(summary.count, "region")} from {summary.source}</span>
            <button type="button" onClick={() => { if (window.confirm("Clear the copied regions from the cross-map clipboard? This does not delete map regions.")) onClear?.(); }} style={{ ...pillButton(false), color: "#f87171" }}>Clear clipboard</button>
          </div>
        ) : null
      }
    >
      <WorkspaceHeading title="Cross-map region clipboard" detail="Copy selected regions from one map and paste them into another. Political ownership and references travel with their regions."/>
      <WorkspaceStats items={[
        { label: "Copied regions", value: summary?.count || 0 },
        { label: "Source polities", value: summary?.owners?.length || 0 },
        { label: "Selected on this map", value: selectionCount },
      ]}/>
      {selectionCount > 0 && (
        <button
          type="button"
          onClick={() => onCopySelection?.()}
          style={{ ...pillButton(false), display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          title="Copy the selected regions to the clipboard (Ctrl+C)"
        >
          <Icon name="copy" size={14} /> Copy {plural(selectionCount, "selected region")}
        </button>
      )}

      {summary ? (
        <>
          <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {plural(summary.count, "region")} from {summary.source}
            </div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>copied {ago(summary.copiedAt)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
              {summary.owners.slice(0, 12).map((owner) => (
                <div key={owner.key || "__none__"} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                  <span style={{ color: owner.key ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.45)" }}>{owner.name}</span>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{plural(owner.count, "region")}</span>
                </div>
              ))}
              {summary.owners.length > 12 && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>and {summary.owners.length - 12} more</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onPaste?.()}
            style={{ ...pillButton(true), display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            title="Paste these regions into this map, replacing whatever territory they overlap (Ctrl+V)"
          >
            <Icon name="paint" size={14} /> Paste into this map
          </button>
          <div style={{ ...workspaceCard, ...workspaceMuted }}>
            Pasting may replace or trim existing territory. You will be asked to confirm. One native Undo reverses the pasted territory and its newly imported polity, group, type, flag, colour and tag metadata. Later edits to those records are preserved.
          </div>
          <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={simplify} onChange={(e) => onSimplifyChange?.(e.target.checked)} />
            Simplify to this map's detail
          </label>
        </>
      ) : (
        <WorkspaceEmpty title="Nothing copied yet"
          description="Select regions on the map, or select matching entries in the Regions workspace. Copy them with Ctrl+C or the selection inspector, then paste into another map."/>
      )}

      {result?.kind === "pasted" && (
        <div style={{ fontSize: 11.5, color: "#e4e4e7" }}>
          Pasted {plural(result.added.length, "region")}
          {result.trimmed ? ` · ${plural(result.trimmed, "region")} underneath trimmed` : ""}
          {result.removed ? ` · ${plural(result.removed, "region")} underneath replaced entirely` : ""}
          {result.added.length === 0 ? " — the clipboard had no polygons to paste" : "."}
        </div>
      )}
      {result?.kind === "copied" && (
        <div style={{ fontSize: 11.5, color: "#e4e4e7" }}>Copied {plural(result.count, "region")}. Open the map you are building and paste.</div>
      )}
    </Panel>
  );
};

export default ClipboardPanel;
