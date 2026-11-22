/*!
 * Open Historia Map Editor - native map layer visibility workspace.
 * The OpenLayers layers own visibility; the UI never writes scenario layer data.
 */
import { useState } from "react";
import Panel from "./Panel.jsx";
import { pillButton } from "./editorStyles.js";
import {
  WorkspaceActions, WorkspaceHeading, WorkspaceStats, workspaceCard, workspaceMuted,
} from "./EditorWorkspaceControls.jsx";
import { EDITOR_LAYER_DEFS, overlayVisibilityPatch } from "./editorLayerVisibility.js";

const MAP_EDITOR_LAYER_OPTIONS = EDITOR_LAYER_DEFS;

export default function LayersPanel({ api, onClose, streetReference = false, onStreetReferenceChange, hasCustomBackground = false }) {
  const [vis, setVis] = useState(() =>
    Object.fromEntries(MAP_EDITOR_LAYER_OPTIONS.map(({ key }) => [key, api?.getLayerVisibility?.(key) ?? true])),
  );
  const enabled = MAP_EDITOR_LAYER_OPTIONS.filter(({ key }) => vis[key]).length;
  const set = (key, value) => {
    api?.setLayerVisibility?.(key, value);
    setVis((current) => ({ ...current, [key]: value }));
  };
  const bulk = (mode) => {
    const patch = overlayVisibilityPatch(mode);
    for (const [key, show] of Object.entries(patch)) api?.setLayerVisibility?.(key, show);
    setVis(patch);
  };

  return <Panel title="Map layers" icon="layers" onClose={onClose} width={460}>
    <WorkspaceHeading title="Visibility & inspection" detail="Decide what you see while editing. These controls change only the editor canvas, not the saved scenario's geography."/>
    <WorkspaceStats items={[
      { label: "Available layers", value: MAP_EDITOR_LAYER_OPTIONS.length },
      { label: "Visible", value: enabled },
      { label: "Hidden", value: MAP_EDITOR_LAYER_OPTIONS.length - enabled },
    ]}/>
    <WorkspaceActions>
      <button type="button" style={pillButton(false)} onClick={() => bulk("show-all")}>Show all</button>
      <button type="button" style={pillButton(false)} onClick={() => bulk("regions-only")}>Focus on political regions</button>
    </WorkspaceActions>
    <WorkspaceHeading title="Modern streets reference"
      detail="Use OpenStreetMap street and modern boundary context while tracing. This is a temporary visual aid, not a replacement for your scenario's historical map."/>
    <label style={{ ...workspaceCard, display: "flex", alignItems: "center", gap: 12, cursor: hasCustomBackground ? "not-allowed" : "pointer" }}>
      <span style={{ flex: 1, display: "grid", gap: 3 }}>
        <strong style={{ fontSize: 12.5 }}>Show OpenStreetMap street reference</strong>
        <span style={workspaceMuted}>Online map detail and current geographical context; available boundaries depend on OSM zoom and styling.</span>
      </span>
      <input type="checkbox" aria-label="Show OpenStreetMap street reference" checked={Boolean(streetReference)}
        disabled={hasCustomBackground}
        onChange={(event) => onStreetReferenceChange?.(event.target.checked)}/>
    </label>
    <div style={workspaceMuted}>
      Online only. The temporary view is never stored in a map document or exported to a campaign.
      An imported custom background takes precedence. OpenStreetMap's modern boundaries are
      reference geography, not the historical borders being authored.
    </div>
    {["Geography", "Scenario objects", "War geography"].map((group) =>
      <section key={group} style={{ display: "grid", gap: 6 }} aria-label={group}>
        <WorkspaceHeading title={group}/>
        {MAP_EDITOR_LAYER_OPTIONS.filter((row) => row.group === group).map(({ key, label, description }) =>
          <label key={key} style={{ ...workspaceCard, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
              <strong style={{ fontSize: 12.5 }}>{label}</strong>
              <span style={workspaceMuted}>{description}</span>
            </span>
            <input type="checkbox" aria-label={label} checked={Boolean(vis[key])}
              onChange={(event) => set(key, event.target.checked)} />
          </label>,
        )}
      </section>,
    )}
    <div style={{ ...workspaceCard, ...workspaceMuted }}>
      Terrain areas and climate zones appear while their corresponding Terrain & War tab or drawing tool is active. They are not ordinary persistent visibility layers.
    </div>
  </Panel>;
}
