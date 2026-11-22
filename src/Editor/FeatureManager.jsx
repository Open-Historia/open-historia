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
import { estimateJsonBytes, importAllCities, importMajorCities } from "./citiesImport.js";
import { mergeImportedFeatures, parseFeatureImport } from "./featureImport.js";
import { acceptFor } from "../runtime/fileAccept.js";
import { removeRowStep, removeRowsStep } from "./documentUndo.js";
import { isCityFeature } from "./cityMarkers.js";
import { filterMapFeaturesForWorkspace, pageOf, WORKSPACE_PAGE_SIZE } from "./editorWorkspaceFilters.js";
import {
  WorkspaceActions, WorkspaceHeading, WorkspaceMore, WorkspaceSearch,
  WorkspaceSelect, WorkspaceStats, WorkspaceEmpty, workspaceMuted, workspaceCard,
} from "./EditorWorkspaceControls.jsx";
import { confirmDialog } from "../runtime/uiDialog.js";

// "All cities…" asks first from this many new cities on.
const LARGE_CITY_IMPORT = 1000;

const SYMBOLS = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "triangle", label: "Triangle" },
  { value: "star", label: "Star" },
];

const FeatureManager = ({ features, setFeatures, api, selection = [], setSelection, activeTool, setActiveTool, onEdit, onClose }) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("*");
  const [ownerFilter, setOwnerFilter] = useState("*");
  const [onlySelected, setOnlySelected] = useState(false);
  const [shown, setShown] = useState(WORKSPACE_PAGE_SIZE);
  const [expanded, setExpanded] = useState(null);
  const [importing, setImporting] = useState(false);
  // What the last import said, and whether it failed: the kind is set with the
  // words, never read back out of them (a note starting "Import failed" was red).
  const [importNote, setImportNoteLine] = useState({ text: "", failed: false });
  const setImportNote = (text, kind = "ok") => setImportNoteLine({ text: String(text ?? ""), failed: kind === "error" });
  const fileInputRef = useRef(null);
  const [bulkTag, setBulkTag] = useState("");

  const filtered = useMemo(() => filterMapFeaturesForWorkspace(features, {
    query, category, owner: ownerFilter, selectedOnly: onlySelected, selectedIds: selection,
  }), [features, query, category, ownerFilter, onlySelected, selection]);
  const visible = useMemo(() => pageOf(filtered, shown), [filtered, shown]);
  const categories = useMemo(() => [...new Set(features.filter((f) => !isCityFeature(f))
    .map((f) => String(f.kind || "").trim()).filter(Boolean))].sort(), [features]);
  const ownerKeys = useMemo(() => [...new Set(features.map((f) => String(f.owner || f.country || "").trim())
    .filter(Boolean))].sort(), [features]);
  const coordinatesOf = (f) => {
    if (!Array.isArray(f.coord) || f.coord.length < 2 || !f.coord.slice(0, 2).every((n) => Number.isFinite(Number(n)))) return "Coordinates not set";
    return `${Number(f.coord[0]).toFixed(3)}°, ${Number(f.coord[1]).toFixed(3)}°`;
  };

  const update = (id, patch) => setFeatures((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  // Deleting is one step on the Workshop's undo stack (OlMap pushStep), so
  // Ctrl+Z or Undo brings the rows back where they were (documentUndo.js).
  // The rows go at once: a panel opened before the map handed over its API
  // still deletes, only without the undo step.
  const pushUndoStep = (step) => {
    if (step) api?.pushStep?.(step);
  };
  const remove = (id) => pushUndoStep(removeRowStep(features, setFeatures, id));

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
  const confirmingRef = useRef(false);
  const liveFeaturesRef = useRef({ features, selectedSet });
  liveFeaturesRef.current = { features, selectedSet };

  const deleteSelected = async () => {
    if (!selectedCount || confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      if (!(await confirmDialog(`Delete ${selectedCount} selected feature${selectedCount === 1 ? "" : "s"}?`, { danger: true, confirmLabel: "Delete" }))) return;
      const latest = liveFeaturesRef.current;
      if (!latest.selectedSet.size) return;
      pushUndoStep(removeRowsStep(latest.features, setFeatures, (f) => latest.selectedSet.has(String(f.id))));
      setSelection?.([]);
    } finally {
      confirmingRef.current = false;
    }
  };
  // Every city, base, port and landmark at once. It still asks first, but it is
  // one undo step now: the autosave writes the empty list two seconds later,
  // and Ctrl+Z or Undo writes them all back.
  const deleteAll = async () => {
    const n = features.length;
    if (!n || confirmingRef.current) return;
    const question = n === 1
      ? "Delete the one city or map feature on this map? Undo brings it back."
      : `Delete all ${n} cities and map features on this map? Undo brings them back.`;
    confirmingRef.current = true;
    try {
      if (!(await confirmDialog(question, { danger: true, confirmLabel: "Delete all" }))) return;
      const latestFeatures = liveFeaturesRef.current.features;
      if (!latestFeatures.length) return;
      pushUndoStep(removeRowsStep(latestFeatures, setFeatures, () => true));
      setSelection?.([]);
    } finally {
      confirmingRef.current = false;
    }
  };

  // The city seed, merged like a file import. It says what it added, and says
  // so when the seed could not be downloaded, rather than adding nothing. The
  // whole seed is ~70k points, which every save, the scenario and the game then
  // carry, so that one asks first with the count and a size.
  const doImport = async (mode) => {
    setImporting(true);
    setImportNote("");
    try {
      const cities = mode === "all" ? await importAllCities() : await importMajorCities();
      const added = mergeImportedFeatures(features, cities).added;
      // Only a large addition asks: topping up a map that already holds the
      // seed adds a handful, which neither weighs anything nor reads as
      // "so many cities".
      if (mode === "all" && added >= LARGE_CITY_IMPORT) {
        const mb = (estimateJsonBytes(cities) * (added / cities.length)) / 1e6;
        const megabytes = mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
        const question = `Add ${added.toLocaleString()} cities to this map? That is about ${megabytes} MB more in the map, its saves and the scenario, and so many cities can make the Workshop and the game slow, especially on phones.`;
        if (!(await confirmDialog(question))) return;
      }
      setFeatures((list) => mergeImportedFeatures(list, cities).features);
      setImportNote(
        added === 0
          ? "Every one of those cities is already on this map."
          : added === 1 ? "Added 1 city." : `Added ${added} cities.`,
      );
    } catch (e) {
      console.warn("[editor] city import failed:", e);
      setImportNote("Import failed: the city list could not be downloaded. Check the connection and try again.", "error");
    } finally {
      setImporting(false);
    }
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
      setImportNote(`Import failed: ${e?.message || e}`, "error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Not the bare "Features": that string is the scenario and game editors' tab
  // of gameplay features, and a language pack has one translation per string.
  return (
    <Panel
      title="Map features"
      icon="pin"
      onClose={onClose}
      width={490}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{features.length} features total</span>
          {features.length > 0 && (
            <button onClick={deleteAll} style={{ ...pillButton(false), color: "#f87171" }}>
              Delete All
            </button>
          )}
        </div>
      }
    >
      <WorkspaceHeading title="Geographic assets" detail="Cities, capitals, landmarks, ports, bases and other point features. Find and inspect places directly on the map." />
      <WorkspaceStats items={[
        { label: "Total places", value: features.length.toLocaleString() },
        { label: "Matching", value: filtered.length.toLocaleString() },
        { label: "Selected", value: selection.length.toLocaleString() },
      ]} />
      <WorkspaceSearch value={query} onChange={(value) => { setQuery(value); setShown(WORKSPACE_PAGE_SIZE); }} placeholder="Find name, type, ID, tags or owner..." />
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <WorkspaceSelect label="Category" value={category} onChange={(value) => { setCategory(value); setShown(WORKSPACE_PAGE_SIZE); }}
          options={[
            { value: "*", label: "All categories" },
            { value: "city", label: "Cities / settlements" },
            { value: "feature", label: "Other map features" },
            ...categories.map((kind) => ({ value: kind, label: kind })),
          ]} />
        <WorkspaceSelect label="Owner / country" value={ownerFilter} onChange={(value) => { setOwnerFilter(value); setShown(WORKSPACE_PAGE_SIZE); }}
          options={[{ value: "*", label: "All owners" }, ...ownerKeys.map((key) => ({ value: key, label: key }))]} />
      </div>
      <label style={{ ...workspaceMuted, display: "flex", alignItems: "center", gap: 7 }}>
        <input type="checkbox" checked={onlySelected} onChange={(e) => { setOnlySelected(e.target.checked); setShown(WORKSPACE_PAGE_SIZE); }} />
        Only selected features
      </label>
      <WorkspaceActions>
        <button type="button" style={pillButton(activeTool === "feature")}
          onClick={() => setActiveTool?.(activeTool === "feature" ? "select" : "feature")}>
          {activeTool === "feature" ? "✓ City placement active" : "+ Place city on map"}
        </button>
        <button type="button" style={pillButton(activeTool === "marker")}
          onClick={() => setActiveTool?.(activeTool === "marker" ? "select" : "marker")}>
          {activeTool === "marker" ? "✓ Feature placement active" : "+ Place landmark / base"}
        </button>
      </WorkspaceActions>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => doImport("major")}
          disabled={importing}
          title="Capitals and cities of 500,000 people or more"
          style={{ ...pillButton(true), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: importing ? 0.6 : 1 }}
        >
          <Icon name="plus" size={14} /> {importing ? "Importing…" : "Import major cities"}
        </button>
        <button
          onClick={() => doImport("all")}
          disabled={importing}
          title="Every city and place in the world list, about 70,000 of them; asks first"
          style={{ ...pillButton(false), display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: importing ? 0.6 : 1 }}
        >
          All cities…
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
      {importNote.text && (
        <div style={{ fontSize: 11, lineHeight: 1.4, color: importNote.failed ? "#f87171" : "rgba(255,255,255,0.7)" }}>{importNote.text}</div>
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
          <button type="button" onClick={() => setSelection?.(filtered.map((f) => f.id))} style={pillButton(false)} title="Select all matching features, not just the current page">
            Select matching
          </button>
          <button type="button" onClick={() => setSelection?.([])} disabled={!selectedCount} style={{ ...pillButton(false), opacity: selectedCount ? 1 : 0.5 }}>
            Clear
          </button>
        </div>
        {selectedCount > 0 && (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
            {`${selectedCount} selected — tag them or delete them together.`}
          </div>
        )}
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
      <WorkspaceHeading title="Feature browser" detail={`Showing ${visible.length.toLocaleString()} of ${filtered.length.toLocaleString()} matches. Click a row for details; checkbox or Shift-click selects.`} />
      {!filtered.length && <WorkspaceEmpty title="No matching places" description="Change the filters or add a place using the map placement tools." />}

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {visible.map((f, index) => {
          const open = expanded === f.id;
          return (
            <div key={f.id} style={{ border: selectedSet.has(String(f.id)) ? "1px solid rgba(250,204,21,0.6)" : "1px solid rgba(255,255,255,0.09)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                <input type="checkbox" checked={selectedSet.has(String(f.id))} onChange={() => {}} onClick={(e) => toggleSelected(f.id, index, e.shiftKey)} aria-label={`Select ${f.name}`} style={{ cursor: "pointer", margin: 0 }} />
                <button onClick={() => setExpanded(open ? null : f.id)} style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", flex: 1, textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>
                    {isCityFeature(f) ? "City / settlement" : f.kind || "Map feature"} · {f.owner || f.country || "Unassigned"} · {coordinatesOf(f)}
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
                  <div style={{ ...workspaceCard, display: "grid", gap: 3 }}>
                    <div style={workspaceMuted}>ID: {f.id}</div>
                    <div style={workspaceMuted}>Position: {coordinatesOf(f)}</div>
                    <div style={workspaceMuted}>Map region: {f.regionId || "Not assigned"}</div>
                    <div style={workspaceMuted}>Category: {isCityFeature(f) ? "Settlement" : f.kind || "Other feature"}</div>
                    {isCityFeature(f)
                      ? <div style={workspaceMuted}>Population: {f.population == null ? "Not specified" : Number(f.population).toLocaleString()} · {f.tags?.includes("capital") ? "Capital" : "Not marked as capital"}</div>
                      : <>
                          <div style={workspaceMuted}>Operational state: {f.status || "active"}</div>
                          <div style={workspaceMuted}>Scenario note: {f.note || "No scenario context authored"}</div>
                        </>}
                  </div>
                  <button type="button" style={pillButton(true)} onClick={() => onEdit?.(f.id)}>
                    {isCityFeature(f) ? "Open full city editor" : "Open full map feature editor"}
                  </button>
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
      <WorkspaceMore shown={visible.length} total={filtered.length}
        onMore={() => setShown((count) => count + WORKSPACE_PAGE_SIZE)} />
    </Panel>
  );
};

export default FeatureManager;
