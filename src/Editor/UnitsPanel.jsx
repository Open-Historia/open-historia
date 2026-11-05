/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The scenario's starting units: everything placed with the Unit tool, listed
// by owner, with locate / edit / delete. A unit placed here ships in the
// scenario's world.units and stands on the map from round one.

import { useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";

const TYPE_LABELS = { infantry: "Infantry", armor: "Armour", air: "Air", naval: "Naval", artillery: "Artillery", garrison: "Garrison" };

const UnitsPanel = ({ units = [], polityName = (key) => key, activeTool, setActiveTool, onLocate, onEdit, onRemove, onRemoveAll, onClose }) => {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? units.filter((u) => `${u.name} ${u.type} ${u.ownerCode} ${polityName(u.ownerCode)} ${u.composition || ""}`.toLowerCase().includes(q))
      : units;
    return [...list].sort((a, b) => polityName(a.ownerCode).localeCompare(polityName(b.ownerCode)) || String(a.name).localeCompare(String(b.name)));
  }, [units, query, polityName]);
  const placing = activeTool === "unit";

  return (
    <Panel
      title="Units"
      icon="unit"
      onClose={onClose}
      width={340}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{units.length} unit{units.length === 1 ? "" : "s"} at the start of the scenario</span>
          {units.length > 0 && (
            <button onClick={onRemoveAll} style={{ ...pillButton(false), color: "#f87171" }}>Delete All</button>
          )}
        </div>
      }
    >
      <button
        type="button"
        onClick={() => setActiveTool?.(placing ? "select" : "unit")}
        style={{ ...pillButton(placing), display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        title="Click the map to place a unit; click an existing unit to edit it"
      >
        <Icon name="unit" size={14} /> {placing ? "Placing units — click the map (click again to stop)" : "Place units on the map"}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="search" size={15} style={{ opacity: 0.6 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, type, owner…" style={{ ...inputStyle, padding: "6px 8px" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", padding: "6px 2px" }}>
            {units.length ? "No unit matches that search." : "No units yet."}
          </div>
        )}
        {filtered.map((u) => (
          <div key={u.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
            <button onClick={() => onEdit?.(u.id)} title="Edit" style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", flex: 1, textAlign: "left", padding: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name || "Unit"}</div>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>
                {TYPE_LABELS[u.type] || u.type} · {polityName(u.ownerCode) || "no owner"} · {u.strength ?? 100}%{u.composition ? ` · ${u.composition}` : ""}
              </div>
            </button>
            <button onClick={() => onLocate?.(u)} title="Locate" style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>
              <Icon name="fit" size={14} />
            </button>
            <button onClick={() => onRemove?.(u.id)} title="Delete" style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer" }}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
};

export default UnitsPanel;
