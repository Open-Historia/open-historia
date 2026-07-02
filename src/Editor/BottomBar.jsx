/*!
 * Pax Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Bottom status bar: Regions / Features / Types counts (clickable to open their
// managers), a Layers button, the reference-map (basemap) selector, the map name,
// and the save-status dot — mirroring the official editor's bottom chrome.

import Icon from "./Icon.jsx";
import { panelSurface, inputStyle } from "./editorStyles.js";

const BASEMAPS = [
  { v: "osm", l: "Your Basemap" },
  { v: "light", l: "Light" },
  { v: "dark", l: "Dark" },
  { v: "white", l: "White" },
  { v: "grayscale", l: "Grayscale" },
  { v: "black", l: "Black" },
];

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
      background: active ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.06)",
      border: active ? "1px solid rgba(59,130,246,0.8)" : "1px solid rgba(255,255,255,0.1)",
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
  basemap,
  onBasemapChange,
  name,
  onNameChange,
  saveStatus,
  openPanel,
  onOpenPanel,
  search,
}) => {
  const save = SAVE[saveStatus] || SAVE.saved;
  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        bottom: 12,
        left: 12,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        zIndex: 30,
        flexWrap: "wrap",
      }}
    >
      {search}
      <Chip icon="list" label={`Regions: ${counts.regions}`} active={openPanel === "regions"} onClick={() => onOpenPanel("regions")} />
      <Chip icon="pin" label={`Features: ${counts.features}`} active={openPanel === "features"} onClick={() => onOpenPanel("features")} />
      <Chip icon="types" label={`Types: ${counts.types}`} active={openPanel === "types"} onClick={() => onOpenPanel("types")} />
      <Chip icon="layers" label="Layers" active={openPanel === "layers"} onClick={() => onOpenPanel("layers")} />

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="layers" size={15} style={{ opacity: 0.6 }} />
        <select
          value={basemap}
          onChange={(e) => onBasemapChange(e.target.value)}
          style={{ ...inputStyle, width: "auto", padding: "6px 8px", cursor: "pointer" }}
        >
          {BASEMAPS.map((b) => (
            <option key={b.v} value={b.v} style={{ color: "#000" }}>
              {b.l}
            </option>
          ))}
        </select>
      </div>

      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Map name"
        style={{ ...inputStyle, width: 190 }}
      />

      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: save.color, boxShadow: `0 0 8px ${save.color}` }} />
        {save.label}
      </span>
    </div>
  );
};

export default BottomBar;
