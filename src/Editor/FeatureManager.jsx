/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Map Feature Manager — mirrors the official editor. Lists point features (mostly
// cities): search by name / type / owner / tags, per-feature edit (name, symbol,
// tags) + locate + delete, Delete All, and an "Import major cities" action that
// pulls capitals + large cities from cities.pmtiles.

import { useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton, inputStyle } from "./editorStyles.js";
import { TextField, SelectField } from "./fields.jsx";
import { importAllCities, importMajorCities } from "./citiesImport.js";

const SYMBOLS = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "triangle", label: "Triangle" },
  { value: "star", label: "Star" },
];

const FeatureManager = ({ features, setFeatures, api, onClose }) => {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? features.filter((f) =>
          `${f.name} ${f.type} ${f.owner || ""} ${f.country || ""} ${(f.tags || []).join(" ")}`
            .toLowerCase()
            .includes(q),
        )
      : features;
    return list.slice(0, 300);
  }, [features, query]);

  const update = (id, patch) => setFeatures((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id) => setFeatures((list) => list.filter((f) => f.id !== id));

  const doImport = async (mode) => {
    setImporting(true);
    const cities = mode === "all" ? await importAllCities() : await importMajorCities();
    setFeatures((list) => {
      const have = new Set(list.map((f) => `${f.name}|${f.coord?.join(",")}`));
      return [...list, ...cities.filter((c) => !have.has(`${c.name}|${c.coord?.join(",")}`))];
    });
    setImporting(false);
  };

  return (
    <Panel
      title="Features"
      icon="pin"
      onClose={onClose}
      width={340}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{features.length} features total</span>
          {features.length > 0 && (
            <button onClick={() => setFeatures([])} style={{ ...pillButton(false), color: "#f87171" }}>
              Delete All
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="search" size={15} style={{ opacity: 0.6 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, tag, owner…"
          style={{ ...inputStyle, padding: "6px 8px" }}
        />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => doImport("all")}
          disabled={importing}
          style={{ ...pillButton(true), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: importing ? 0.6 : 1 }}
        >
          <Icon name="plus" size={14} /> {importing ? "Importing…" : "Import all cities"}
        </button>
        <button
          onClick={() => doImport("major")}
          disabled={importing}
          style={{ ...pillButton(false), display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: importing ? 0.6 : 1 }}
        >
          Major only
        </button>
      </div>

      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{filtered.length}{filtered.length >= 300 ? "+" : ""} shown</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {filtered.map((f) => {
          const open = expanded === f.id;
          return (
            <div key={f.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                <button onClick={() => setExpanded(open ? null : f.id)} style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", flex: 1, textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>
                    {f.type} · {f.country || f.owner || "—"} · {(f.tags || []).join(", ")}
                  </div>
                </button>
                <button onClick={() => api?.locateFeature(f.coord)} title="Locate" style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>
                  <Icon name="fit" size={14} />
                </button>
                <button onClick={() => remove(f.id)} title="Delete" style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer" }}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {open && (
                <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <TextField value={f.name} onChange={(v) => update(f.id, { name: v })} placeholder="Name" />
                  <SelectField value={f.symbol} onChange={(v) => update(f.id, { symbol: v })} options={SYMBOLS} width="100%" />
                  <TextField
                    value={(f.tags || []).join(", ")}
                    onChange={(v) => update(f.id, { tags: v.split(",").map((s) => s.trim()).filter(Boolean) })}
                    placeholder="tags, comma separated"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

export default FeatureManager;
