/*! Open Historia — Fantasy Map Generator console © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Right-edge drawer for the map editor: a tab that expands into a console where
// you enter a few values (seed, template, size, #states…) and hit Generate. It
// hands those to the FMG driver, which runs Azgaar's generator headlessly and
// imports the result (regions + countries + cities + a vector basemap) into the
// editor. Pure presentation — the generation itself lives in fmgDriver.js.

import React, { useState } from "react";
import { panelSurface, inputStyle } from "../editorStyles.js";

// FMG's heightmap templates (drive its landmass shape). Kept in sync with the
// driver's template mapping; "random" lets FMG pick.
const TEMPLATES = [
  "random", "continents", "archipelago", "pangea", "isthmus", "atoll",
  "mediterranean", "peninsula", "volcano", "highIsland", "lowIsland",
];
const SIZES = [
  { id: "small", label: "Small (fast)", points: 4000 },
  { id: "medium", label: "Medium", points: 10000 },
  { id: "large", label: "Large (detailed)", points: 20000 },
];

const field = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12 };
const label = { color: "rgba(255,255,255,0.6)", fontSize: 11, letterSpacing: "0.02em" };

const FmgPanel = ({ open, onToggle, busy, log = [], onGenerate }) => {
  const [seed, setSeed] = useState("");
  const [template, setTemplate] = useState("random");
  const [size, setSize] = useState("medium");
  const [states, setStates] = useState(12);
  const [cultures, setCultures] = useState(8);
  const [useProvinces, setUseProvinces] = useState(true);

  const run = () => {
    if (busy) return;
    onGenerate?.({
      seed: seed.trim(),
      template,
      points: SIZES.find((s) => s.id === size)?.points || 10000,
      states: Math.max(1, Number(states) || 12),
      cultures: Math.max(1, Number(cultures) || 8),
      useProvinces,
    });
  };

  return (
    <>
      {/* right-edge tab — always visible, toggles the drawer */}
      <button
        type="button"
        onClick={onToggle}
        title="Generate a world with the Fantasy Map Generator"
        style={{
          ...panelSurface,
          position: "fixed",
          top: "50%",
          right: open ? 340 : 0,
          transform: "translateY(-50%)",
          zIndex: 36,
          writingMode: "vertical-rl",
          padding: "14px 7px",
          border: "1px solid rgba(147,197,253,0.4)",
          borderRight: open ? "1px solid rgba(147,197,253,0.4)" : "none",
          borderRadius: open ? "10px 0 0 10px" : "10px 0 0 10px",
          cursor: "pointer",
          color: "white",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "0.06em",
          transition: "right 160ms ease",
          background: "rgba(59,130,246,0.85)",
        }}
      >
        🗺 GENERATE {open ? "▸" : "◂"}
      </button>

      {open && (
        <div
          style={{
            ...panelSurface,
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: 340,
            zIndex: 35,
            borderRadius: 0,
            borderLeft: "1px solid rgba(147,197,253,0.35)",
            display: "flex",
            flexDirection: "column",
            padding: "16px 16px 12px",
            gap: 12,
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>Generate a world</div>
          <div style={{ ...label, marginTop: -6 }}>
            Azgaar's Fantasy Map Generator builds the land, countries and cities; they
            import straight into your map as vector regions + a biome basemap.
          </div>

          <div style={field}>
            <span style={label}>Seed (blank = random)</span>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. 174920" style={inputStyle} />
          </div>

          <div style={field}>
            <span style={label}>Landmass template</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value)} style={inputStyle}>
              {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={field}>
            <span style={label}>Detail</span>
            <select value={size} onChange={(e) => setSize(e.target.value)} style={inputStyle}>
              {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ ...field, flex: 1 }}>
              <span style={label}>Countries</span>
              <input type="number" min={1} max={100} value={states} onChange={(e) => setStates(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ ...field, flex: 1 }}>
              <span style={label}>Cultures</span>
              <input type="number" min={1} max={40} value={cultures} onChange={(e) => setCultures(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={useProvinces} onChange={(e) => setUseProvinces(e.target.checked)} />
            <span style={{ fontSize: 12 }}>Regions from provinces (finer than whole countries)</span>
          </label>

          <button
            type="button"
            onClick={run}
            disabled={busy}
            style={{
              ...panelSurface,
              marginTop: 2,
              padding: "10px 14px",
              cursor: busy ? "default" : "pointer",
              color: "white",
              fontWeight: 800,
              fontSize: 14,
              border: "1px solid rgba(147,197,253,0.5)",
              background: busy ? "rgba(59,130,246,0.35)" : "rgba(59,130,246,0.85)",
              opacity: busy ? 0.85 : 1,
            }}
          >
            {busy ? "Generating…" : "⚙ Generate & import"}
          </button>

          {/* console log */}
          <div
            style={{
              flex: 1,
              minHeight: 120,
              marginTop: 4,
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              fontSize: 11,
              lineHeight: 1.55,
              color: "rgba(180,230,190,0.92)",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {log.length ? log.map((line, i) => <div key={i}>{line}</div>) : <span style={{ color: "rgba(255,255,255,0.3)" }}>Console output appears here…</span>}
          </div>
        </div>
      )}
    </>
  );
};

export default FmgPanel;
