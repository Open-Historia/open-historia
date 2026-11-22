/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

import { useState } from "react";
import Icon from "./Icon.jsx";
import EditorWorkspaceNav from "./EditorWorkspaceNav.jsx";
import { TOOL_GROUPS, TOOLS } from "./editorToolCatalog.js";
import { EDITOR_CARD, EDITOR_NAV, inputStyle, navButton, panelSurface, sectionLabel, toolButton } from "./editorStyles.js";
import { useBackToClose } from "../runtime/backToClose.js";

export const SIDEBAR_WIDTH = 268;

const SAVE = {
  saved: { color: "#22c55e", label: "Working map saved" },
  dirty: { color: "#f59e0b", label: "Working map unsaved" },
  saving: { color: "#f59e0b", label: "Saving…" },
  error: { color: "#ef4444", label: "Save failed" },
};

const smallIconButton = (disabled = false) => ({
  ...toolButton(false, disabled),
  height: 28,
  minWidth: 28,
  padding: 0,
  borderRadius: 8,
});

const EditorSidebar = ({
  name,
  onNameChange,
  documents,
  search,
  activeTool,
  onToolChange,
  toolOptions = null,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onFit,
  counts,
  polityCount = 0,
  groupCount = 0,
  clipboardCount = 0,
  suggestionCount = null,
  openPanel,
  onSetPanel,
  onOpenBasemaps,
  onOpenGenerator,
  generatorAvailable = false,
  saveStatus,
  saveError = "",
  onRetrySave = null,
  scenarioDirty = false,
  actions = null,
  onReviewSave = null,
  onReviewPlay = null,
  reviewBusy = false,
  reviewScenarioMode = false,
  isMobile = false,
  mobileOpen = false,
  onMobileOpenChange,
  hidden = false,
  onHiddenChange,
  side = "right",
  onSideChange,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  useBackToClose(isMobile && mobileOpen, () => onMobileOpenChange?.(false));
  const onRight = side !== "left";
  const save = SAVE[saveStatus] || SAVE.saved;
  const tool = TOOLS.find((t) => t.id === activeTool) || null;
  const closeOnPhone = () => {
    if (isMobile) onMobileOpenChange?.(false);
  };
  const pickTool = (id) => {
    onToolChange(id);
    closeOnPhone();
  };
  const sidebar = (
    <aside
      style={{
        position: "fixed",
        top: 0,
        [onRight ? "right" : "left"]: 0,
        bottom: 0,
        width: isMobile ? "min(300px, 88vw)" : SIDEBAR_WIDTH,
        display: "flex",
        flexDirection: "column",
        background: EDITOR_NAV,
        [onRight ? "borderLeft" : "borderRight"]: "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))",
        boxShadow: isMobile ? "0 24px 70px rgba(0,0,0,0.55)" : "none",
        color: "var(--oh-ui-text, white)",
        fontFamily: "sans-serif",
        zIndex: isMobile ? 50 : 34,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 12px 12px", borderBottom: "1px solid var(--oh-ui-line, rgba(255,255,255,0.07))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, flexShrink: 0, borderRadius: 12, background: EDITOR_CARD, border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.09))" }}>
            <Icon name="map" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...sectionLabel, fontSize: 9.5, marginBottom: 3 }}>Map name</div>
            <input
              value={name || ""}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Untitled Map"
              style={{ ...inputStyle, padding: "4px 7px", borderRadius: 8, fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}
            />
          </div>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setSettingsOpen((was) => !was)}
              title="Settings"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              style={{ ...toolButton(settingsOpen, false), height: 32, minWidth: 32, padding: 0, borderRadius: 9 }}
            >
              <Icon name="settings" size={16} />
            </button>
            {settingsOpen && (
              // Keep the 200px menu inside either 268px desktop sidebar. On the
              // left, opening it outward placed the Right-side button underneath
              // adjacent editor panels (which have a higher stacking context).
              <div style={{ ...panelSurface, position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, width: 200, padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                <span style={{ ...sectionLabel, fontSize: 10 }}>Side</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {[["left", "Left"], ["right", "Right"]].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={(value === "right") === onRight}
                      onClick={() => {
                        onSideChange?.(value);
                        setSettingsOpen(false);
                      }}
                      style={{ ...toolButton((value === "right") === onRight, false), height: 32, fontSize: 12.5 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {documents}
          {search}
        </div>
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 18 }}>
        {(isMobile || toolOptions) && (<section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={sectionLabel}>Tools</span>
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo} style={smallIconButton(!canUndo)}>
                <Icon name="undo" size={15} />
              </button>
              <button type="button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo} style={smallIconButton(!canRedo)}>
                <Icon name="redo" size={15} />
              </button>
              <button type="button" title="Fit to data" aria-label="Fit to data" onClick={onFit} style={smallIconButton()}>
                <Icon name="fit" size={15} />
              </button>
            </span>
          </div>
          {isMobile && TOOL_GROUPS.map((group) => (
            <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ color: "var(--oh-ui-muted, rgba(255,255,255,0.55))", fontSize: 11.5, fontWeight: 600 }}>{group.label}</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 4 }}>
                {group.tools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={activeTool === t.id}
                    onClick={() => pickTool(t.id)}
                    style={{ ...toolButton(activeTool === t.id, false), minWidth: 0, width: "100%", padding: 0 }}
                  >
                    <Icon name={t.icon} size={17} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {tool && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 11px", borderRadius: 12, background: EDITOR_CARD, border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))", fontSize: 12, lineHeight: 1.4 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <Icon name={tool.icon} size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>{tool.label}</span>
              </div>
              {toolOptions}
            </div>
          )}
        </section>)}

        <EditorWorkspaceNav
          counts={counts}
          polityCount={polityCount}
          groupCount={groupCount}
          clipboardCount={clipboardCount}
          suggestionCount={suggestionCount}
          openPanel={openPanel}
          onSetPanel={onSetPanel}
          onOpenBasemaps={onOpenBasemaps}
          onOpenGenerator={onOpenGenerator}
          generatorAvailable={generatorAvailable}
          saveLabel={save.label}
          scenarioDirty={scenarioDirty}
          onReviewSave={onReviewSave}
          onReviewPlay={onReviewPlay}
          reviewBusy={reviewBusy}
          reviewScenarioMode={reviewScenarioMode}
          onAfterNavigate={closeOnPhone}
        />

      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "12px", borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.07))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          {saveStatus === "error" && onRetrySave ? (
            // A failed save says why and is its own Retry: the only other way was
            // the Documents menu's Save now, which nothing pointed to.
            <button
              type="button"
              onClick={onRetrySave}
              title={saveError ? `Save failed: ${saveError}. Click to try again.` : "Save failed. Click to try again."}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%", minWidth: 0, padding: 0, background: "transparent", border: "none", color: "inherit", fontSize: 12, cursor: "pointer" }}
            >
              <span style={{ flex: "0 0 auto", width: 9, height: 9, borderRadius: "50%", background: save.color }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline" }}>
                {saveError ? `Save failed: ${saveError} — Retry` : "Save failed — Retry"}
              </span>
            </button>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "rgba(255,255,255,0.8)" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: save.color }} />
              {save.label}
            </span>
          )}
          {scenarioDirty && (
            <span
              title="The editor document may be autosaved, but these changes have not yet been written into the scenario."
              style={{ marginLeft: "auto", padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.12)", color: "#fbbf24", fontSize: 11, fontWeight: 700 }}
            >
              Scenario unsaved
            </span>
          )}
        </div>
        {actions}
      </div>
    </aside>
  );

  const tab = (
    <button
      type="button"
      onClick={() => onHiddenChange?.(!hidden)}
      title={hidden ? "Show" : "Hide"}
      aria-label={hidden ? "Show" : "Hide"}
      aria-expanded={!hidden}
      style={{
        position: "fixed",
        top: "50%",
        [onRight ? "right" : "left"]: hidden ? 0 : SIDEBAR_WIDTH - 1,
        transform: "translateY(-50%)",
        zIndex: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 64,
        padding: 0,
        background: EDITOR_NAV,
        border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))",
        [onRight ? "borderRight" : "borderLeft"]: "none",
        borderRadius: onRight ? "10px 0 0 10px" : "0 10px 10px 0",
        boxShadow: onRight ? "-6px 0 18px rgba(0,0,0,0.3)" : "6px 0 18px rgba(0,0,0,0.3)",
        color: "rgba(255,255,255,0.75)",
        cursor: "pointer",
      }}
    >
      <Icon name={hidden === onRight ? "chevronLeft" : "chevronRight"} size={15} />
    </button>
  );

  if (!isMobile) {
    return (
      <>
        {!hidden && sidebar}
        {tab}
      </>
    );
  }
  return (
    <>
      <div style={{ position: "fixed", bottom: 16, [onRight ? "right" : "left"]: 12, zIndex: 40, display: "flex", flexDirection: onRight ? "row-reverse" : "row", gap: 6 }}>
        <button
          type="button"
          onClick={() => onMobileOpenChange?.(true)}
          title="Tools"
          aria-label="Tools"
          style={{ ...panelSurface, display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px", cursor: "pointer" }}
        >
          <Icon name="menu" size={18} />
          {tool && <Icon name={tool.icon} size={17} style={{ opacity: 0.8 }} />}
        </button>
        <button type="button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo} style={{ ...smallIconButton(!canUndo), ...panelSurface, height: 40, minWidth: 40, borderRadius: 12, color: canUndo ? "#fff" : "rgba(255,255,255,0.28)" }}>
          <Icon name="undo" size={17} />
        </button>
        <button type="button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo} style={{ ...smallIconButton(!canRedo), ...panelSurface, height: 40, minWidth: 40, borderRadius: 12, color: canRedo ? "#fff" : "rgba(255,255,255,0.28)" }}>
          <Icon name="redo" size={17} />
        </button>
      </div>
      {mobileOpen && (
        <>
          <div onClick={() => onMobileOpenChange?.(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 49 }} />
          {sidebar}
        </>
      )}
    </>
  );
};

export default EditorSidebar;
