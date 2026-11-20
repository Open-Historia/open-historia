/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
import { useState } from "react";
import Icon from "./Icon.jsx";
import { EDITOR_WORKSPACES, workspaceOfPanel } from "./editorWorkspaces.js";
import { EDITOR_CARD, navButton, panelSurface, sectionLabel } from "./editorStyles.js";

const LINK_STYLE = {
  ...navButton(false), minHeight: 34, fontSize: 11.5, padding: "0 9px",
};

export default function EditorWorkspaceNav({
  counts, polityCount, groupCount, clipboardCount, suggestionCount,
  openPanel, onSetPanel, onOpenBasemaps, onOpenGenerator, generatorAvailable,
  saveLabel, scenarioDirty, onAfterNavigate,
}) {
  const [selectedWorkspace, setSelectedWorkspace] = useState("overview");
  const activeWorkspaceId = openPanel ? workspaceOfPanel(openPanel)?.id || selectedWorkspace : selectedWorkspace;
  const nativeCounts = {
    regions: counts.regions, polities: polityCount, groups: groupCount,
    types: counts.types, features: counts.features, units: counts.units || 0,
    clipboard: clipboardCount, suggestions: suggestionCount,
  };
  const activate = (id) => {
    if (id === "basemap") { onSetPanel?.(null); onOpenBasemaps?.(); }
    else if (id === "generator") { onSetPanel?.(null); onOpenGenerator?.(); }
    else onSetPanel?.(id);
    onAfterNavigate?.();
  };
  const shownItems = (workspace) => workspace.items.filter((item) =>
    (item.id !== "suggestions" || suggestionCount !== null) &&
    (item.id !== "generator" || generatorAvailable)
  );
  const choose = (workspace) => {
    setSelectedWorkspace(workspace.id);
    activate(workspace.panel);
  };
  return (
    <section aria-label="Map editor workspaces" style={{ display: "grid", gap: 5 }}>
      {EDITOR_WORKSPACES.map((workspace, index) => {
        const active = activeWorkspaceId === workspace.id;
        const items = shownItems(workspace);
        return (
          <div key={workspace.id}>
            {(index === 0 || index === 1 || index === 7) && (
              <div style={{ ...sectionLabel, padding: "10px 5px 7px", fontSize: 10 }}>
                {index === 0 ? "Your world" : index === 1 ? "Edit the scenario" : "Finish & play"}
              </div>
            )}
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              aria-expanded={active && items.length > 1 ? true : undefined}
              title={workspace.description}
              onClick={() => choose(workspace)}
              style={{
                ...navButton(active), minHeight: 49, borderRadius: 10,
                padding: "8px 9px", alignItems: "center",
              }}
            >
              <Icon name={workspace.icon} size={18} style={{
                flexShrink: 0, color: active ? "var(--oh-ui-accent, #e7e7ea)" : "var(--oh-ui-muted, #b4c4d0)",
              }} />
              <span style={{ minWidth: 0, flex: 1, display: "grid", gap: 2 }}>
                <span style={{ fontSize: 12.5, fontWeight: 750 }}>{workspace.label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--oh-ui-muted, #b4c4d0)" }}>
                  {workspace.description}
                </span>
              </span>
              {nativeCounts[workspace.panel] !== undefined && (
                <span style={{
                  background: EDITOR_CARD, border: "1px solid var(--oh-ui-line, #444)",
                  padding: "2px 6px", borderRadius: 6, color: "var(--oh-ui-muted, #b4c4d0)",
                  fontSize: 10, fontWeight: 700,
                }}>{nativeCounts[workspace.panel]}</span>
              )}
            </button>
            {active && items.length > 1 && (
              <div style={{
                margin: "5px 0 8px 17px", paddingLeft: 8, display: "grid", gap: 3,
                borderLeft: "1px solid var(--oh-ui-line, #444)",
              }}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={openPanel === item.id}
                    onClick={() => activate(item.id)}
                    style={{
                      ...LINK_STYLE,
                      background: openPanel === item.id ? "var(--oh-ui-active, rgba(255,255,255,.12))" : "transparent",
                      borderColor: openPanel === item.id ? "var(--oh-ui-line, #444)" : "transparent",
                    }}
                  >
                    <Icon name={item.icon} size={15} style={{ flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>{item.label}</span>
                    {nativeCounts[item.id] !== undefined && <span style={{ fontSize: 10, opacity: .7 }}>{nativeCounts[item.id]}</span>}
                  </button>
                ))}
              </div>
            )}
            {active && workspace.id === "overview" && (
              <div style={{ ...panelSurface, boxShadow: "none", padding: 11, borderRadius: 10, marginTop: 6 }}>
                <strong style={{ fontSize: 12 }}>Current map</strong>
                <p style={{ color: "var(--oh-ui-muted, #b4c4d0)", fontSize: 11, lineHeight: 1.6, margin: "6px 0" }}>
                  {(counts.regions ?? 0).toLocaleString()} regions · {polityCount} countries · {groupCount} groups
                </p>
                <p style={{ color: "var(--oh-ui-muted, #b4c4d0)", fontSize: 11, lineHeight: 1.6, margin: "6px 0 0" }}>
                  Choose what to edit. The map's drawing tools remain in the compact icon toolbar.
                </p>
              </div>
            )}
            {active && workspace.id === "review" && (
              <div style={{ ...panelSurface, boxShadow: "none", padding: 11, borderRadius: 10, marginTop: 6 }}>
                <strong style={{ fontSize: 12 }}>Working map: {saveLabel}</strong>
                {scenarioDirty && <p style={{ color: "#fbbf24", fontSize: 11 }}>Changes have not yet been applied to the scenario.</p>}
                <p style={{ color: "var(--oh-ui-muted, #b4c4d0)", fontSize: 11, lineHeight: 1.6, margin: "6px 0" }}>
                  The working map and the playable scenario are saved separately. Use the actual Save or Apply &amp; Play controls below.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
