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
  onReviewSave, onReviewPlay, reviewBusy = false, reviewScenarioMode = false,
}) {
  const [selectedWorkspace, setSelectedWorkspace] = useState("overview");
  const activeWorkspaceId = openPanel ? workspaceOfPanel(openPanel, selectedWorkspace)?.id || selectedWorkspace : selectedWorkspace;
  const nativeCounts = {
    regions: counts.regions, polities: polityCount, groups: groupCount,
    types: counts.types, features: counts.features, units: counts.units || 0,
    clipboard: clipboardCount, suggestions: suggestionCount,
  };
  const activate = (id) => {
    if (id === "basemap") { onSetPanel?.(null); onOpenBasemaps?.(); }
    else if (id === "generator") { onSetPanel?.(null); onOpenGenerator?.(); }
    else onSetPanel?.(id);
    // Overview and Review have no external panel. Keep the mobile sidebar open
    // so their content and native Save/Apply actions remain accessible.
    if (id != null) onAfterNavigate?.();
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
        const showSectionHeader = workspace.section && workspace.section !== EDITOR_WORKSPACES[index - 1]?.section;
        return (
          <div key={workspace.id}>
            {showSectionHeader && (
              <div style={{ ...sectionLabel, padding: "10px 5px 7px", fontSize: 10 }}>
                {workspace.section}
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
                  {(counts.regions ?? 0).toLocaleString()} regions · {polityCount} polities · {groupCount} groups
                </p>
                <p style={{ color: "var(--oh-ui-muted, #b4c4d0)", fontSize: 11, lineHeight: 1.6, margin: "6px 0 0" }}>
                  Choose what to edit. The map's drawing tools remain in the compact icon toolbar.
                </p>
              </div>
            )}
            {active && workspace.id === "review" && (
              <div style={{ ...panelSurface, boxShadow: "none", padding: 11, borderRadius: 10, marginTop: 6 }}>
                <strong style={{ fontSize: 12 }}>Review scenario authoring</strong>
                <p style={{ color: "var(--oh-ui-muted, #b4c4d0)", fontSize: 11, lineHeight: 1.6, margin: "7px 0" }}>
                  Confirm the authored data below, then use the native Save or Apply action. This is a review, not a second save state.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6 }}>
                  {[
                    ["Regions", counts.regions],
                    ["Polities", polityCount],
                    ["Groups", groupCount],
                    ["Region types", counts.types],
                    ["Places", counts.features],
                    ["Starting units", counts.units || 0],
                  ].map(([label, value]) =>
                    <div key={label} style={{ padding: 7, borderRadius: 7, background: "var(--oh-ui-raised, rgba(255,255,255,0.05))" }}>
                      <strong style={{ fontSize: 14 }}>{Number(value || 0).toLocaleString()}</strong>
                      <div style={{ fontSize: 10, color: "var(--oh-ui-muted, #b4c4d0)" }}>{label}</div>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--oh-ui-muted, #b4c4d0)", paddingTop: 8 }}>
                  Working document: {saveLabel}
                </div>
                {scenarioDirty && <p style={{ color: "#fbbf24", fontSize: 11 }}>Changes have not yet been applied to the scenario.</p>}
                <p style={{ color: "var(--oh-ui-muted, #b4c4d0)", fontSize: 11, lineHeight: 1.6, margin: "6px 0" }}>
                  The working map and the playable scenario are saved separately. These buttons use the existing native Save and Apply paths.
                </p>
                <div style={{ display: "grid", gap: 6 }}>
                  <button type="button" disabled={reviewBusy || !onReviewSave} onClick={onReviewSave}
                    style={{ ...navButton(true), justifyContent: "center", minHeight: 36, opacity: reviewBusy ? .5 : 1 }}>
                    {reviewScenarioMode ? "Save changes to scenario" : "Save working map"}
                  </button>
                  {reviewScenarioMode && <button type="button" disabled={reviewBusy || !onReviewPlay} onClick={onReviewPlay}
                    style={{ ...navButton(false), justifyContent: "center", minHeight: 36, opacity: reviewBusy ? .5 : 1 }}>
                    Apply &amp; Play
                  </button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
