/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Map Feature Manager — mirrors the official editor. Lists point features (mostly
// cities): search by name / type / owner / tags, per-feature edit (name, symbol,
// tags) + locate + delete, Delete All, and an "Import major cities" action that
// pulls capitals + large cities from cities.pmtiles.

import { useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton, inputStyle } from "./editorStyles.js";
import { TextField, SelectField } from "./fields.jsx";
import { importAllCities, importMajorCities } from "./citiesImport.js";
import { mergeImportedFeatures, parseFeatureImport } from "./featureImport.js";
import { acceptFor } from "../runtime/fileAccept.js";

const SYMBOLS = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "triangle", label: "Triangle" },
  { value: "star", label: "Star" },
];

const FeatureManager = ({ features, setFeatures, api, selection = [], setSelection, activeTool, setActiveTool, onClose }) => {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const fileInputRef = useRef(null);
  const [bulkTag, setBulkTag] = useState("");

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

  // Many at once: ticked rows and the map's box-select share one selection, and
  // the bar below tags or deletes everything in it together.
  const selectedSet = useMemo(() => new Set((selection || []).map(String)), [selection]);
  const selectedCount = selectedSet.size;
  const lastPickRef = useRef(null);
  const toggleSelected = (id, index, shiftKey) => {
    const ids = filtered.map((f) => String(f.id));
    const next = new Set(selectedSet);
    const from = lastPickRef.current == null ? -1 : ids.indexOf(String(lastPickRef.current));
    if (shiftKey && from >= 0 && index >= 0) {
      const [a, b] = from < index ? [from, index] : [index, from];
      for (let i = a; i <= b; i += 1) next.add(ids[i]);
    } else if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));
    lastPickRef.current = id;
    setSelection?.([...next]);
  };
  // The typed tag stays in its box after Add / Remove, so a slip can be taken
  // straight back off and the next selection can get the same tag.
  const addTagToSelected = () => {
    const tag = bulkTag.trim();
    if (!tag || !selectedCount) return;
    setFeatures((list) => list.map((f) => (selectedSet.has(String(f.id)) && !(f.tags || []).includes(tag) ? { ...f, tags: [...(f.tags || []), tag] } : f)));
  };
  const removeTagFromSelected = () => {
    const tag = bulkTag.trim();
    if (!tag || !selectedCount) return;
    setFeatures((list) => list.map((f) => (selectedSet.has(String(f.id)) ? { ...f, tags: (f.tags || []).filter((t) => t !== tag) } : f)));
  };
  const deleteSelected = () => {
    if (!selectedCount) return;
    if (!window.confirm(`Delete ${selectedCount} selected feature${selectedCount === 1 ? "" : "s"}?`)) return;
    setFeatures((list) => list.filter((f) => !selectedSet.has(String(f.id))));
    setSelection?.([]);
  };

  const doImport = async (mode) => {
    setImporting(true);
    const cities = mode === "all" ? await importAllCities() : await importMajorCities();
    setFeatures((list) => {
      const have = new Set(list.map((f) => `${f.name}|${f.coord?.join(",")}`));
      return [...list, ...cities.filter((c) => !have.has(`${c.name}|${c.coord?.join(",")}`))];
    });
    setImporting(false);
  };

  // The author's own features from a file — GeoJSON points, a Workshop document,
  // or plain lon/lat rows (featureImport.js) — merged like the city import, so
  // importing the same file twice adds nothing twice.
  const importFile = async (file) => {
    if (!file) return;
    setImportNote("");
    try {
      const { features: imported, skipped, format } = parseFeatureImport(await file.text());
      const outcome = mergeImportedFeatures(features, imported);
      setFeatures(outcome.features);
      setImportNote(
        `Imported ${outcome.added} feature${outcome.added === 1 ? "" : "s"} from ${file.name} (${format})`
        + (outcome.duplicates ? `, ${outcome.duplicates} already here` : "")
        + (skipped ? `, ${skipped} entr${skipped === 1 ? "y" : "ies"} without a usable point skipped` : "")
        + ".",
      );
    } catch (e) {
      setImportNote(`Import failed: ${e?.message || e}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          title="Your own features from a file: GeoJSON points, a Workshop document, or a JSON list of rows with lon/lat — each with a name and, optionally, a symbol, tags and a country"
          style={{ ...pillButton(false), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Icon name="plus" size={14} /> Import from file…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptFor(".json,.geojson,application/json,application/geo+json")}
          style={{ display: "none" }}
          onChange={(e) => importFile(e.target.files?.[0] || null)}
        />
      </div>
      {importNote && (
        <div style={{ fontSize: 11, lineHeight: 1.4, color: importNote.startsWith("Import failed") ? "#f87171" : "rgba(255,255,255,0.7)" }}>{importNote}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: selectedCount ? "rgba(250,204,21,0.06)" : "rgba(255,255,255,0.03)" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setActiveTool?.(activeTool === "feature-box" ? "select" : "feature-box")}
            style={{ ...pillButton(activeTool === "feature-box"), flex: 1 }}
            title="Hold the mouse down on the map and drag a rectangle over features to select them all; shift-drag adds to the selection"
          >
            {activeTool === "feature-box" ? "Drag-select is on: drag a box on the map" : "Drag-select on the map"}
          </button>
          <button type="button" onClick={() => setSelection?.(filtered.map((f) => f.id))} style={pillButton(false)} title="Select every feature the search shows">
            Select shown
          </button>
          <button type="button" onClick={() => setSelection?.([])} disabled={!selectedCount} style={{ ...pillButton(false), opacity: selectedCount ? 1 : 0.5 }}>
            Clear
          </button>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
          {selectedCount
            ? `${selectedCount} selected — tag them or delete them together.`
            : "Tick features below, or drag-select them on the map, to tag or delete many at once."}
        </div>
        {selectedCount > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTagToSelected(); }}
              placeholder="tag, e.g. fortress"
              style={{ ...inputStyle, padding: "6px 8px", flex: 1, minWidth: 120 }}
            />
            <button type="button" onClick={addTagToSelected} disabled={!bulkTag.trim()} style={pillButton(true)}>Add tag</button>
            <button type="button" onClick={removeTagFromSelected} disabled={!bulkTag.trim()} style={pillButton(false)}>Remove tag</button>
            <button type="button" onClick={deleteSelected} style={{ ...pillButton(false), color: "#f87171" }}>Delete {selectedCount}</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{filtered.length}{filtered.length >= 300 ? "+" : ""} shown</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {filtered.map((f, index) => {
          const open = expanded === f.id;
          return (
            <div key={f.id} style={{ border: selectedSet.has(String(f.id)) ? "1px solid rgba(250,204,21,0.6)" : "1px solid rgba(255,255,255,0.09)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                <input type="checkbox" checked={selectedSet.has(String(f.id))} onChange={() => {}} onClick={(e) => toggleSelected(f.id, index, e.shiftKey)} aria-label={`Select ${f.name}`} style={{ cursor: "pointer", margin: 0 }} />
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
