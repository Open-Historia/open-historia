/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Root of the standalone map editor (reachable at /?editor=1). Composes the
// OpenLayers surface with the editing toolbar, the side-panel managers (Types /
// Regions / Layers), the selection inspector, and the bottom status bar, all
// wired to the document state hook. Kept isolated from the game (its own React
// tree, its own map instance) so it can't disturb the game's MapLibre map.

import { useEffect, useMemo, useRef, useState } from "react";
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
import BasemapPicker from "./BasemapPicker.jsx";
import FlagPicker from "./FlagPicker.jsx";
import { useMapDocument, createDocument, newId } from "./useMapDocument.js";
import { loadBackgroundFile, rebuildPersistedBackground, vectorLayerToGeoJSON } from "./customBackground.js";
import { addBackgroundToLibrary, getBasemapPayload } from "../runtime/basemapLibrary.js";
import { saveDocument, loadDocument, downloadJson } from "./documentIO.js";
import { buildGameSeed } from "./exportPreset.js";
import { panelSurface, inputStyle } from "./editorStyles.js";
import FmgPanel from "./fmg/FmgPanel.jsx";
import { generateFmgWorld } from "./fmg/fmgDriver.js";
import { fmgToEditorSeed } from "./fmg/fmgImport.js";

const MapEditor = ({ onClose, scenarioName, onApplyToScenario, initialMap } = {}) => {
  const d = useMapDocument();
  // Opened from a scenario: the scenario's own map (regions/cities/colors) is
  // loaded once it arrives, so never auto-seed the default world underneath it.
  const scenarioMode = Boolean(onApplyToScenario);
  const [api, setApi] = useState(null);
  const [openPanel, setOpenPanel] = useState(null); // 'types' | 'regions' | 'layers' | 'features' | null
  const [paintOwner, setPaintOwner] = useState(""); // owner code assigned by the paint tool
  const [docId, setDocId] = useState(null); // server document id (null until first save)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [applying, setApplying] = useState(false); // writing the map into the scenario
  const [cityPopup, setCityPopup] = useState(null); // {id, x, y, isNew} — inline city editor
  const [customBg, setCustomBg] = useState(null); // live background applied to the map
  const [customBgId, setCustomBgId] = useState(null); // library basemap id applied (null = built-in / doc's own)
  const [basemapPickerOpen, setBasemapPickerOpen] = useState(false);
  // Which country's flag we're picking, or null. Owned HERE, not in the inspector:
  // panelSurface has backdrop-filter, which makes a containing block for
  // position:fixed — an overlay rendered inside the panel gets clipped to it and
  // trapped under its z-index, whatever z-index the overlay itself asks for.
  const [flagPickerFor, setFlagPickerFor] = useState(null);
  const [fmgOpen, setFmgOpen] = useState(false); // FMG "Generate" drawer
  const [fmgBusy, setFmgBusy] = useState(false);
  const [fmgLog, setFmgLog] = useState([]);

  const togglePanel = (name) => setOpenPanel((cur) => (cur === name ? null : name));

  // An OpenLayers-loaded background in the persistable form the library stores.
  const normalizeBackground = (bg) => {
    if (bg?.kind === "image" && bg.dataUrl) return { kind: "image", dataUrl: bg.dataUrl, aspect: bg.aspect };
    if (bg?.kind === "vector" && bg.layer) return { kind: "vector", geojson: vectorLayerToGeoJSON(bg.layer) };
    return null;
  };

  // Pick a built-in ESRI preset: drop any custom background so the preset shows.
  const selectBuiltinBasemap = (id) => {
    d.setBasemap(id);
    setCustomBg(null);
    setCustomBgId(null);
    d.patchMetadata({ customBackground: null });
  };

  // Pick one of the user's saved basemaps: fetch its payload and apply it.
  const selectLibraryBasemap = async (bm) => {
    try {
      const payload = await getBasemapPayload(bm.id);
      const saved =
        bm.kind === "vector"
          ? { kind: "vector", geojson: payload.geojson }
          : { kind: "image", dataUrl: payload.dataUrl, aspect: bm.aspect };
      setCustomBg(rebuildPersistedBackground(saved, { persisted: false }));
      setCustomBgId(bm.id);
    } catch (e) {
      window.alert(`Could not load that basemap: ${e?.message || e}`);
    }
  };

  // Upload a new basemap: apply it now AND save it to the library for reuse.
  const uploadBasemap = async (file) => {
    if (!file) return;
    const bg = await loadBackgroundFile(file);
    setCustomBg(bg); // applies immediately (image / vector / raster)
    const normalized = normalizeBackground(bg);
    if (!normalized) {
      setCustomBgId(null); // raster (GeoTIFF/PMTiles) is session-only reference, not saved
      return;
    }
    const name = file.name ? file.name.replace(/\.[^.]+$/, "") : "Custom basemap";
    try {
      const meta = await addBackgroundToLibrary(normalized, name, { author: d.author || "" });
      setCustomBgId(meta?.id || null);
    } catch (e) {
      console.warn("[editor] save basemap to library failed:", e);
      setCustomBgId(null);
    }
  };

  // ---- Fantasy Map Generator: generate a world and import it into this map ----
  const fmgLogLine = (msg) => setFmgLog((l) => [...l, msg]);
  const generateFromFmg = async (params) => {
    if (!api || fmgBusy) return;
    setFmgBusy(true);
    setFmgLog([]);
    try {
      const raw = await generateFmgWorld(params, fmgLogLine);
      fmgLogLine("Building regions, countries and cities…");
      const seed = fmgToEditorSeed(raw, { groupBy: params.useProvinces ? "province" : "state" });
      api.loadRegions(seed.regions);
      d.setFeatures(
        seed.cities.features
          .map((f) => ({
            id: newId("feat"),
            name: f.properties?.city || "",
            type: "Coordinate",
            symbol: "square",
            coord: Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates.slice(0, 2) : null,
            country: "",
            owner: null,
            regionId: null,
            population: f.properties?.population || 0,
            tags: f.properties?.capital === "primary" ? ["city", "capital"] : ["city"],
          }))
          .filter((f) => Array.isArray(f.coord)),
      );
      d.mergeColors(seed.colors);
      const savedBg = { kind: "vector", geojson: seed.background.geojson };
      setCustomBg(rebuildPersistedBackground(savedBg, { persisted: false }));
      d.patchMetadata({ customBackground: savedBg });
      // Save the generated biome basemap to "Your basemaps" so it can be reused.
      try {
        const tmpl = params.template && params.template !== "random" ? params.template : "generated";
        const bmName = `${tmpl.charAt(0).toUpperCase()}${tmpl.slice(1)} world basemap`;
        const bm = await addBackgroundToLibrary(savedBg, bmName, { author: d.author || "" });
        setCustomBgId(bm?.id || null);
        if (bm?.id) fmgLogLine("Saved this basemap to “Your basemaps”.");
      } catch (e) {
        console.warn("[editor] save generated basemap to library failed:", e);
        setCustomBgId(null);
      }
      d.setSaveStatus("dirty");
      fmgLogLine(`✓ Imported ${seed.stats.regions} regions, ${seed.stats.polities} countries, ${seed.stats.cities} cities.`);
      api.fitToData?.();
    } catch (e) {
      fmgLogLine(`✗ ${e?.message || e}`);
      console.warn("[editor] FMG generate failed:", e);
    } finally {
      setFmgBusy(false);
    }
  };

  // Every field the document owns has to be listed here — this is a whitelist, and
  // anything missing is dropped on save without a word. That is what makes a new
  // doc field look like it works until the first reload.
  const buildPayload = () => ({
    name: d.name,
    metadata: d.metadata,
    types: d.types,
    features: d.features,
    colorOverrides: d.colorOverrides,
    flags: d.flags,
    tags: d.tags,
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
    setCustomBg(null);
    setCustomBgId(null);
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
        // Default to {} rather than leaving them undefined: a map saved before these
        // existed has neither key, and setColorOverride/setFlag spread the current
        // value.
        colorOverrides: doc.colorOverrides || {},
        flags: doc.flags || {},
        tags: doc.tags || {},
      });
      api?.loadRegions(doc.regions);
      setCustomBg(rebuildPersistedBackground(doc.metadata?.customBackground));
      setCustomBgId(null);
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

  // Hydrate the editor with the scenario's CURRENT map: its regions + owners
  // (custom geometry when it has one, else the stock world with the scenario's
  // ownership overrides stamped on), its cities, its palette, and its author —
  // so "edit this scenario's map" edits THAT map, not a fresh default world.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!api || !initialMap || hydratedRef.current) return;
    hydratedRef.current = true;
    const base = createDocument({ name: initialMap.name || "Scenario Map", kind: "import-world" });
    base.metadata.author = initialMap.author || "";
    // Restore the chosen built-in basemap so re-opening shows it (not the default).
    if (initialMap.basemap) base.metadata.basemap = initialMap.basemap;
    // Carry the restored background in the document metadata so Apply & Play
    // (buildGameSeed reads doc.metadata.customBackground) re-persists it instead of
    // clearing the scenario's background when the user re-opens and re-applies.
    if (initialMap.background) base.metadata.customBackground = initialMap.background;
    // Same reasoning as the background above, and it is data loss if missed:
    // buildGameSeed emits flags: null when the document has none, and
    // applyMapToScenario reads that null as "clear the scenario's flags.json".
    // So opening a scenario's map without its flags and pressing Apply & Play
    // deleted every author-set flag. Restore them so a round-trip is a no-op.
    if (initialMap.flags) base.flags = { ...initialMap.flags };
    // Same reasoning as flags: without this a round-trip clears the scenario's tags.
    if (initialMap.tags) base.tags = { ...initialMap.tags };
    base.features = (initialMap.cities?.features || [])
      .map((f) => ({
        id: newId("feat"),
        name: f.properties?.city ? String(f.properties.city) : "",
        type: "Coordinate",
        symbol: "square",
        coord: Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates.slice(0, 2) : null,
        country: "",
        owner: null,
        regionId: null,
        population: f.properties?.population || 0,
        tags: f.properties?.capital === "primary" ? ["city", "capital"] : ["city"],
      }))
      .filter((f) => Array.isArray(f.coord));
    d.setDoc(base);
    if (initialMap.colors) d.mergeColors(initialMap.colors);
    if (initialMap.regions) api.loadRegions(initialMap.regions);
    else api.reseedWorldWithOwners(initialMap.ownershipOverrides || {});
    // Restore the scenario's custom map background so re-opening its map editor
    // shows the uploaded map, not a blank basemap. It's marked persisted, so the
    // OlMap effect renders it without re-emitting (no dirty/autosave on open).
    setCustomBg(initialMap.background ? rebuildPersistedBackground(initialMap.background) : null);
    setCustomBgId(null);
    d.setSaveStatus("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, initialMap]);

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
        seedKind={scenarioMode ? "deferred" : d.metadata.kind}
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
        customBackground={customBg}
        onCustomBackgroundSave={(saved) => d.patchMetadata({ customBackground: saved })}
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
        colorOverrides={d.colorOverrides}
        setColorOverride={d.setColorOverride}
        flags={d.flags}
        setFlag={d.setFlag}
        onOpenFlagPicker={setFlagPickerFor}
        tags={d.tags}
        setTags={d.setTags}
        setSelection={d.setSelection}
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
        hasCustomBackground={Boolean(customBg)}
        onOpenBasemaps={() => setBasemapPickerOpen(true)}
        name={d.name}
        onNameChange={d.setName}
        saveStatus={d.saveStatus}
        openPanel={openPanel}
        onOpenPanel={togglePanel}
        search={
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
        }
      />

      <FlagPicker
        open={Boolean(flagPickerFor)}
        onClose={() => setFlagPickerFor(null)}
        ownerCode={flagPickerFor}
        currentFlag={flagPickerFor ? d.flags?.[flagPickerFor] : null}
        mapFlags={d.flags}
        author={d.author}
        onPick={(value) => d.setFlag(flagPickerFor, value)}
      />
      <BasemapPicker
        open={basemapPickerOpen}
        onClose={() => setBasemapPickerOpen(false)}
        currentBasemap={d.basemap}
        currentCustomId={customBgId}
        onSelectBuiltin={selectBuiltinBasemap}
        onSelectCustom={selectLibraryBasemap}
        onUpload={uploadBasemap}
      />

      <FmgPanel
        open={fmgOpen}
        onToggle={() => setFmgOpen((o) => !o)}
        busy={fmgBusy}
        log={fmgLog}
        onGenerate={generateFromFmg}
      />
    </div>
  );
};

export default MapEditor;
