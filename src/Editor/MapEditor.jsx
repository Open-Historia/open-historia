/*!
 * Pax Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Root of the standalone map editor (reachable at /?editor=1). Composes the
// OpenLayers surface with the editing toolbar, the side-panel managers (Types /
// Regions / Layers), the selection inspector, and the bottom status bar, all
// wired to the document state hook. Kept isolated from the game (its own React
// tree, its own map instance) so it can't disturb the game's MapLibre map.

import { useEffect, useMemo, useState } from "react";
import "ol/ol.css";
import OlMap from "./OlMap.jsx";
import Toolbar from "./Toolbar.jsx";
import BottomBar from "./BottomBar.jsx";
import TypeManager from "./TypeManager.jsx";
import RegionsPanel from "./RegionsPanel.jsx";
import LayersPanel from "./LayersPanel.jsx";
import FeatureManager from "./FeatureManager.jsx";
import SelectionInspector from "./SelectionInspector.jsx";
import DocumentsMenu from "./DocumentsMenu.jsx";
import CityPopup from "./CityPopup.jsx";
import SearchBar from "./SearchBar.jsx";
import { useMapDocument, createDocument, newId } from "./useMapDocument.js";
import { saveDocument, loadDocument, downloadJson } from "./documentIO.js";
import { buildGameSeed } from "./exportPreset.js";
import { panelSurface, inputStyle } from "./editorStyles.js";

const MapEditor = ({ onClose, scenarioName, onApplyToScenario } = {}) => {
  const d = useMapDocument();
  const [api, setApi] = useState(null);
  const [openPanel, setOpenPanel] = useState(null); // 'types' | 'regions' | 'layers' | 'features' | null
  const [paintOwner, setPaintOwner] = useState(""); // owner code assigned by the paint tool
  const [docId, setDocId] = useState(null); // server document id (null until first save)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [applying, setApplying] = useState(false); // writing the map into the scenario
  const [cityPopup, setCityPopup] = useState(null); // {id, x, y, isNew} — inline city editor

  const togglePanel = (name) => setOpenPanel((cur) => (cur === name ? null : name));

  const buildPayload = () => ({
    name: d.name,
    metadata: d.metadata,
    types: d.types,
    features: d.features,
    regions: api?.serializeRegions() || { type: "FeatureCollection", features: [] },
  });

  // Write the current map into the scenario it was opened from, then hand back to
  // the game to start playing it. onApplyToScenario is supplied by the library bar
  // (absent in the standalone ?editor=1 mode).
  const applyToScenario = async () => {
    if (!api || !onApplyToScenario || applying) return;
    setApplying(true);
    try {
      const seed = buildGameSeed(d.doc, api.serializeRegions() || { type: "FeatureCollection", features: [] }, d.colors);
      await onApplyToScenario(seed);
      // On success the library bar unmounts this editor and opens the play flow.
    } catch (e) {
      console.warn("[editor] apply-to-scenario failed:", e);
      window.alert(`Could not apply the map to the scenario: ${e?.message || e}`);
      setApplying(false);
    }
  };

  const saveNow = async () => {
    if (!api) return;
    try {
      d.setSaveStatus("saving");
      const saved = await saveDocument(docId, buildPayload());
      if (!docId) setDocId(saved.id);
      d.setSaveStatus("saved");
    } catch (e) {
      console.warn("[editor] save failed:", e);
      d.setSaveStatus("error");
    }
  };

  const newDoc = (kind) => {
    d.setDoc(createDocument({ name: kind === "blank" ? "Untitled Map" : "World Map", kind }));
    setDocId(null);
    if (kind === "blank") api?.loadRegions({ type: "FeatureCollection", features: [] });
    else api?.reseedWorld();
    d.setSaveStatus("saved");
  };

  const openDoc = async (id) => {
    try {
      const doc = await loadDocument(id);
      const base = createDocument();
      d.setDoc({
        id: doc.id,
        version: doc.version || 1,
        metadata: { ...base.metadata, ...(doc.metadata || {}), name: doc.name || doc.metadata?.name || "Map" },
        types: doc.types?.length ? doc.types : base.types,
        features: doc.features || [],
      });
      api?.loadRegions(doc.regions);
      setDocId(doc.id);
      d.setSaveStatus("saved");
    } catch (e) {
      console.warn("[editor] open failed:", e);
    }
  };

  // Debounced autosave whenever the document is dirty.
  useEffect(() => {
    if (!api || d.saveStatus !== "dirty") return;
    const t = setTimeout(() => saveNow(), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, d.saveStatus, docId, d.name, d.types, d.features, d.metadata]);

  // The city popup is anchored to a screen position; panning/zooming would leave
  // it floating over the wrong spot, so any map movement closes it.
  useEffect(() => {
    if (!api?.map) return undefined;
    const close = () => setCityPopup(null);
    api.map.on("movestart", close);
    return () => api.map.un("movestart", close);
  }, [api]);

  // Region-count-per-type for the Type Manager (recomputed on relevant changes).
  const typeUsage = useMemo(
    () => (api ? api.countByType() : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, d.types, d.selection, d.regionCount],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b1020",
        overflow: "hidden",
        fontFamily: "sans-serif",
        color: "white",
      }}
    >
      <OlMap
        basemap={d.basemap}
        types={d.types}
        colors={d.colors}
        selectionIds={d.selection}
        activeTool={d.activeTool}
        seedKind={d.metadata.kind}
        defaultTypeId={d.types[0]?.id || "land"}
        paintOwner={paintOwner}
        features={d.features}
        onSelectionChange={d.setSelection}
        onRegionCount={d.setRegionCount}
        onRegionsChanged={(count) => {
          d.setRegionCount(count);
          d.setSaveStatus("dirty");
        }}
        onFeatureCreate={({ pixel, ...partial }) => {
          const id = newId("feat");
          d.setFeatures((list) => [
            ...list,
            {
              id,
              name: "New City",
              type: "Coordinate",
              symbol: "square",
              tags: ["city"],
              population: 250000,
              ...partial,
            },
          ]);
          d.setSaveStatus("dirty");
          // Open the inline editor right where the city was dropped.
          setCityPopup({ id, x: pixel?.[0] ?? 80, y: pixel?.[1] ?? 80, isNew: true });
        }}
        onFeatureEdit={({ id, pixel }) => setCityPopup({ id, x: pixel[0], y: pixel[1], isNew: false })}
        onFeatureRemove={(id) => {
          d.setFeatures((list) => list.filter((f) => f.id !== id));
          d.setSaveStatus("dirty");
          setCityPopup((p) => (p?.id === id ? null : p));
        }}
        onHistory={setHistory}
        onReady={setApi}
      />

      <DocumentsMenu
        docName={d.name}
        currentId={docId}
        author={d.author}
        onAuthorChange={d.setAuthor}
        onNew={newDoc}
        onSave={saveNow}
        onExport={() => downloadJson({ ...buildPayload(), id: docId, version: 1 })}
        onExportGame={() =>
          downloadJson(
            buildGameSeed(d.doc, api?.serializeRegions() || { type: "FeatureCollection", features: [] }, d.colors),
          )
        }
        onOpen={openDoc}
      />

      {(onClose || onApplyToScenario) && (
        <div style={{ position: "fixed", top: 12, right: 12, zIndex: 40, display: "flex", gap: 8 }}>
          {onApplyToScenario && (
            <button
              onClick={applyToScenario}
              disabled={applying}
              title={`Save this map into ${scenarioName || "the scenario"} and start playing it`}
              style={{
                ...panelSurface,
                padding: "8px 15px",
                cursor: applying ? "default" : "pointer",
                color: "white",
                fontWeight: 700,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: applying ? "rgba(59,130,246,0.35)" : "rgba(59,130,246,0.85)",
                border: "1px solid rgba(147,197,253,0.5)",
                opacity: applying ? 0.8 : 1,
              }}
            >
              {applying ? "Applying…" : "▶ Apply & Play"}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="Close map editor"
              style={{
                ...panelSurface,
                padding: "8px 13px",
                cursor: "pointer",
                color: "white",
                fontWeight: 700,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ✕ Close
            </button>
          )}
        </div>
      )}

      <Toolbar
        activeTool={d.activeTool}
        onToolChange={d.setActiveTool}
        onFit={() => api?.fitToData()}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={() => api?.undo()}
        onRedo={() => api?.redo()}
      />

      {d.activeTool === "paint" && (
        <div
          style={{
            ...panelSurface,
            position: "fixed",
            top: 58,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 31,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            fontSize: 12,
          }}
        >
          <span style={{ color: "rgba(255,255,255,0.72)" }}>Paint owner</span>
          {d.colors[paintOwner] && (
            <span style={{ width: 16, height: 16, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: `rgb(${d.colors[paintOwner].join(",")})` }} />
          )}
          <input
            value={paintOwner}
            onChange={(e) => setPaintOwner(e.target.value.toUpperCase())}
            placeholder="e.g. FRA"
            style={{ ...inputStyle, width: 90, padding: "4px 7px" }}
          />
          <span style={{ color: "rgba(255,255,255,0.4)" }}>click regions · empty = unowned</span>
        </div>
      )}

      {openPanel === "types" && (
        <TypeManager types={d.types} setTypes={d.setTypes} usage={typeUsage} onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === "regions" && (
        <RegionsPanel api={api} selection={d.selection} setSelection={d.setSelection} onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === "layers" && <LayersPanel api={api} onClose={() => setOpenPanel(null)} />}
      {openPanel === "features" && (
        <FeatureManager features={d.features} setFeatures={d.setFeatures} api={api} onClose={() => setOpenPanel(null)} />
      )}

      <SelectionInspector
        api={api}
        selection={d.selection}
        types={d.types}
        colors={d.colors}
        setSelection={d.setSelection}
      />

      <SearchBar
        api={api}
        features={d.features}
        onAddCity={(c) => {
          const id = newId("feat");
          d.setFeatures((list) => [
            ...list,
            {
              id,
              name: c.name,
              type: "Coordinate",
              symbol: "square",
              coord: c.coord,
              country: c.country || "",
              owner: null,
              regionId: null,
              population: c.population || 0,
              tags: c.capital ? ["city", "capital"] : ["city"],
            },
          ]);
          api?.locateFeature(c.coord);
        }}
      />

      {cityPopup && (
        <CityPopup
          feature={d.features.find((f) => f.id === cityPopup.id)}
          x={cityPopup.x}
          y={cityPopup.y}
          isNew={cityPopup.isNew}
          onChange={(patch) =>
            d.setFeatures((list) => list.map((f) => (f.id === cityPopup.id ? { ...f, ...patch } : f)))
          }
          onDelete={() => {
            d.setFeatures((list) => list.filter((f) => f.id !== cityPopup.id));
            setCityPopup(null);
          }}
          onClose={() => setCityPopup(null)}
        />
      )}

      <BottomBar
        counts={d.counts}
        basemap={d.basemap}
        onBasemapChange={d.setBasemap}
        name={d.name}
        onNameChange={d.setName}
        saveStatus={d.saveStatus}
        openPanel={openPanel}
        onOpenPanel={togglePanel}
      />
    </div>
  );
};

export default MapEditor;
