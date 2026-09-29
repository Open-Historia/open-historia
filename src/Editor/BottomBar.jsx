/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Bottom status bar: Regions / Features / Types counts (clickable to open their
// managers), a Layers button, the Basemap picker button (opens the full basemap
// overlay), the map name, and the save-status dot.

import { useState } from "react";
import Icon from "./Icon.jsx";
import { panelSurface, inputStyle } from "./editorStyles.js";
import { editorBasemapById } from "./basemaps.js";
import { useBackToClose } from "../runtime/backToClose.js";

const SAVE = {
  saved: { color: "#22c55e", label: "All saved" },
  dirty: { color: "#f59e0b", label: "Unsaved changes" },
  saving: { color: "#f59e0b", label: "Saving…" },
  error: { color: "#ef4444", label: "Save failed" },
};

const Chip = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    disabled={!onClick}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 10px",
      background: active ? "rgba(0,0,0,0.48)" : "rgba(255,255,255,0.06)",
      border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.1)",
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 600,
      color: "rgba(255,255,255,0.9)",
      cursor: onClick ? "pointer" : "default",
    }}
  >
    <Icon name={icon} size={14} />
    {label}
  </button>
);

const BottomBar = ({
  counts,
  polityCount = 0,
  groupCount = 0,
  clipboardCount = 0,
  // Set while a suggestion is being reviewed (SuggestionReviewPanel.jsx): the
  // changes still waiting for a decision. null hides the chip.
  suggestionCount = null,
  basemap,
  hasCustomBackground,
  onOpenBasemaps,
  name,
  onNameChange,
  saveStatus,
  scenarioDirty = false,
  openPanel,
  onOpenPanel,
  search,
  // On a phone the eleven chips, the basemap button, the name box and the
  // status wrapped into several rows over the map. There the chips fold into
  // one Panels menu that opens upward, the basemap button and the status keep
  // only their icon and dot, and the map's name is edited in the Documents
  // menu (DocumentsMenu.jsx).
  isMobile = false,
}) => {
  const [panelsOpen, setPanelsOpen] = useState(false);
  useBackToClose(isMobile && panelsOpen, () => setPanelsOpen(false));
  const save = SAVE[saveStatus] || SAVE.saved;
  const basemapLabel = hasCustomBackground ? "Custom" : editorBasemapById(basemap)?.label || "Basemap";
  const open = (panel) => {
    onOpenPanel(panel);
    setPanelsOpen(false);
  };
  const chips = (
    <>
      {suggestionCount !== null && (
        <Chip icon="list" label={`Suggested changes: ${suggestionCount}`} active={openPanel === "suggestions"} onClick={() => open("suggestions")} />
      )}
      <Chip icon="list" label={`Regions: ${counts.regions}`} active={openPanel === "regions"} onClick={() => open("regions")} />
      <Chip icon="list" label={`Countries: ${polityCount}`} active={openPanel === "polities"} onClick={() => open("polities")} />
      <Chip icon="list" label={`Groups: ${groupCount}`} active={openPanel === "groups"} onClick={() => open("groups")} />
      <Chip icon="layers" label="Topology" active={openPanel === "topology"} onClick={() => open("topology")} />
      <Chip icon="image" label="Import Map" active={openPanel === "province-import"} onClick={() => open("province-import")} />
      <Chip icon="pin" label={`Features: ${counts.features}`} active={openPanel === "features"} onClick={() => open("features")} />
      <Chip icon="unit" label={`Units: ${counts.units ?? 0}`} active={openPanel === "units"} onClick={() => open("units")} />
      <Chip icon="copy" label={`Clipboard: ${clipboardCount}`} active={openPanel === "clipboard"} onClick={() => open("clipboard")} />
      <Chip icon="types" label={`Types: ${counts.types}`} active={openPanel === "types"} onClick={() => open("types")} />
      <Chip icon="layers" label="Layers" active={openPanel === "layers"} onClick={() => open("layers")} />
      <Chip icon="image" label="Reference" active={openPanel === "reference"} onClick={() => open("reference")} />
    </>
  );
  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        bottom: 12,
        left: isMobile ? 8 : 12,
        right: isMobile ? 8 : 12,
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 6 : 8,
        padding: isMobile ? "6px 8px" : "8px 12px",
        zIndex: 30,
        flexWrap: "wrap",
      }}
    >
      {search}
      {isMobile ? (
        <Chip icon="list" label="Panels" active={panelsOpen} onClick={() => setPanelsOpen((was) => !was)} />
      ) : chips}
      {isMobile && panelsOpen && (
        <div
          style={{
            ...panelSurface,
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "calc(100% + 6px)",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: 8,
            maxHeight: "50vh",
            overflowY: "auto",
          }}
        >
          {chips}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={() => onOpenBasemaps?.()}
        title="Choose a built-in basemap, one of your uploaded basemaps, or upload a new one"
        aria-label={isMobile ? `Basemap: ${basemapLabel}` : undefined}
        style={{
          ...inputStyle,
          width: "auto",
          padding: isMobile ? "6px 8px" : "6px 11px",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="layers" size={14} style={{ opacity: 0.75 }} />
        {!isMobile && <>Basemap: {basemapLabel}</>}
      </button>

      {!isMobile && (
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Map name"
          style={{ ...inputStyle, width: 190 }}
        />
      )}

      <span title={isMobile ? save.label : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: save.color, boxShadow: `0 0 8px ${save.color}` }} />
        {!isMobile && save.label}
      </span>
      {scenarioDirty && (
        <span
          title="The editor document may be autosaved, but these changes have not yet been written into the scenario."
          style={{
            padding: "4px 8px",
            borderRadius: 999,
            border: "1px solid rgba(245,158,11,0.35)",
            background: "rgba(245,158,11,0.12)",
            color: "#fbbf24",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          Scenario unsaved
        </span>
      )}
    </div>
  );
};

export default BottomBar;
