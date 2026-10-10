/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Root of the standalone map editor (reachable at /?editor=1). Composes the
// OpenLayers surface with the editing toolbar, the side-panel managers (Types /
// Regions / Layers), the selection inspector, and the bottom status bar, all
// wired to the document state hook. Kept isolated from the game (its own React
// tree, its own map instance) so it can't disturb the game's MapLibre map.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import "ol/ol.css";
import OlMap from "./OlMap.jsx";
import Toolbar from "./Toolbar.jsx";
import BottomBar from "./BottomBar.jsx";
import TypeManager from "./TypeManager.jsx";
import RegionsPanel from "./RegionsPanel.jsx";
import PolitiesPanel from "./PolitiesPanel.jsx";
import GroupsPanel from "./GroupsPanel.jsx";
import BorderCleanupOverlay, { BorderCleanupChoice, BorderCleanupNote, lastCleanMode, rememberCleanMode } from "./BorderCleanupOverlay.jsx";
import { samePolityName } from "../../server/polityRename.js";
import { cleanupWidthOf, describeCleanupLeftAlone, describeCleanupResult, yieldToBrowser } from "./topologySweep.js";
import ProvinceImportPanel from "./ProvinceImportPanel.jsx";
import LayersPanel from "./LayersPanel.jsx";
import ReferencePanel from "./ReferencePanel.jsx";
import FeatureManager from "./FeatureManager.jsx";
import UnitsPanel from "./UnitsPanel.jsx";
import UnitPopup from "./UnitPopup.jsx";
import ClipboardPanel from "./ClipboardPanel.jsx";
import {
  buildClipboardPayload,
  clearRegionClipboard,
  getRegionClipboard,
  planClipboardMerge,
  readRegionClipboard,
  subscribeRegionClipboard,
  writeRegionClipboard,
} from "./regionClipboard.js";
import SelectionInspector from "./SelectionInspector.jsx";
import DocumentsMenu from "./DocumentsMenu.jsx";
import CityPopup from "./CityPopup.jsx";
import MarkerPopup from "./MarkerPopup.jsx";
import { isMapFeature, markerToFeature, newMapFeature } from "./mapFeatures.js";
import { removeRowStep } from "./documentUndo.js";
import SearchBar from "./SearchBar.jsx";
import BasemapPicker from "./BasemapPicker.jsx";
import FlagPicker from "./FlagPicker.jsx";
import { useMapDocument, createDocument, newId, openStoredDocument } from "./useMapDocument.js";
import { loadBackgroundFile, rebuildPersistedBackground, vectorLayerToGeoJSON } from "./customBackground.js";
import ProjectionPanel from "./ProjectionPanel.jsx";
import { DETAILED_MAP_CONVERSION_MESSAGE, DETAILED_MAP_PROJECTION_MESSAGE, detailedMapFits, hasDetailedMap, moveFeatureCoords, moveUnits, planBasemapChange } from "./projectionConvert.js";
import { reprojectPicture } from "./projectionImage.js";
import { convertPlane, normalizeProjection, sameProjection } from "../../server/mapProjection.js";
import { addBackgroundToLibrary, getBasemapPayload } from "../runtime/basemapLibrary.js";
import { saveDocument, loadDocument, downloadJson } from "./documentIO.js";
import { createSaveRunner, isUnsavedStatus, saveRetryDelay, settleUnsavedWork } from "./documentSaving.js";
import { OWNER_SCHEMA } from "./documentMigration.js";
import { useIsMobile } from "../runtime/useIsMobile.js";
import { useBackToClose } from "../runtime/backToClose.js";
import { ownMapHash } from "./ownMapHash.js";
import { DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE, buildGameSeed, gameCityToFeature, scenarioHasOwnMap } from "./exportPreset.js";
import { normalizeGroups } from "../runtime/groups.js";
import { normalizeRegionTypes } from "../runtime/regionTypes.js";
import { panelSurface, inputStyle } from "./editorStyles.js";
import FmgPanel from "./fmg/FmgPanel.jsx";
import SuggestionReviewPanel, { useSuggestionMarkup, useSuggestionReview } from "./SuggestionReviewPanel.jsx";
import { checkFmgAvailable, generateFmgWorld } from "./fmg/fmgDriver.js";
import { fmgToEditorSeed } from "./fmg/fmgImport.js";

const hexToRgb = (value) => {
  const m = /^#?([a-f0-9]{6})$/i.exec(String(value || "").trim());
  if (!m) return null;
  const hex = m[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

const normalizePolityKeyedMap = (input, polities) => {
  const out = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  for (const [key, record] of Object.entries(polities || {})) {
    if (out[key] !== undefined) continue;
    const candidates = [record?.name, ...(Array.isArray(record?.aliases) ? record.aliases : [])]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    const found = candidates.find((candidate) => out[candidate] !== undefined);
    if (found) out[key] = out[found];
  }
  return out;
};

// What a scenario save tells the host of the Workshop's identity operations
// (polityAuthoringOpsRef). The renames already travel as `renames`
// (useMapDocument polityRenames) and scenarioAfterWorkshopRenames replays them
// onto the scenario's world, its Political World included; a rename replayed
// a second time is refused as a clash with the name it has just made, and the
// save fails. So only the removals go this way, each under the name the
// scenario still has that polity by: its key walked back through the renames
// made before it since the last save. The host takes the removed polities'
// Political World profiles out first, then replays the renames (libraryBar.jsx
// writeMapToScenario).
const removalsForScenario = (operations) => {
  const removals = [];
  operations.forEach((operation, index) => {
    if (operation?.op !== "remove") return;
    let key = operation.key;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      const previous = operations[earlier];
      if (previous?.op === "rename" && samePolityName(previous.to, key)) key = previous.from;
    }
    removals.push({ op: "remove", key });
  });
  return removals;
};

// review: a suggestion to review in this map (libraryBar.jsx, from the Suggested
// changes dialog): { suggestion, decisions, onSaved(decisions) }.
const MapEditor = ({ onClose, scenarioName, onApplyToScenario, initialMap, review: reviewSource = null } = {}) => {
  const d = useMapDocument();
  const isMobile = useIsMobile();
  // Opened from a scenario: the scenario's own map (regions/cities/colors) is
  // loaded once it arrives, so never auto-seed the default world underneath it.
  const scenarioMode = Boolean(onApplyToScenario);
  const [api, setApi] = useState(null);
  const [openPanel, setOpenPanel] = useState(null); // 'types' | 'regions' | 'polities' | 'province-import' | 'layers' | 'features' | 'reference' | null
  const [paintOwner, setPaintOwner] = useState(""); // stable polity key assigned by the paint tool
  const [paintOnlyOwner, setPaintOnlyOwner] = useState("*"); // "*" | "__unowned__" | stable polity key
  const [docId, setDocId] = useState(null); // server document id (null until first save)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  // Bumps on ANY region mutation, including ownership/claimant edits where the
  // feature count does not change. Panels use this to refresh derived inventories.
  const [regionEpoch, setRegionEpoch] = useState(0);
  const [scenarioAction, setScenarioAction] = useState(""); // "save" | "save-exit" | "play" while writing scenario
  const [scenarioDirty, setScenarioDirty] = useState(false);
  // The "Cleaning up the borders" screen: progress from repairTopologyEverywhere
  // while a save runs, null otherwise; and the result left beside the buttons
  // for a few seconds after a plain Save, or an export from the standalone
  // editor, as its lines: what was repaired, then what the guards left alone.
  const [borderCleanup, setBorderCleanup] = useState(null);
  const [cleanupNote, setCleanupNote] = useState([]);
  // Set by the screen's "Save now" button; the sweep reads it between steps.
  const cleanupStopRef = useRef(false);
  // Map authoring can rename/remove a polity while Political World and other
  // scenario ledgers live outside the map document. Keep the explicit identity
  // operations until the scenario save lands so the host can migrate those
  // canonical records instead of mistaking a rename for a new country. What
  // the save sends of them, beside the renames it already logs, is
  // removalsForScenario above.
  const polityAuthoringOpsRef = useRef([]);
  // The question a save asks first (BorderCleanupChoice): quick clean or deep
  // clean. Up while `cleanChoice` is set; the ref holds what its answer goes to.
  const [cleanChoice, setCleanChoice] = useState(null);
  const cleanAnswerRef = useRef(null);
  useEffect(() => {
    if (!cleanupNote.length) return undefined;
    // Nine seconds for the result, and five more to read each line under it.
    const timer = setTimeout(() => setCleanupNote([]), 9000 + 5000 * (cleanupNote.length - 1));
    return () => clearTimeout(timer);
  }, [cleanupNote]);
  // Whether the scenario's own map has arrived and been loaded. The Workshop
  // opens EMPTY in scenario mode (no default world underneath) and the map
  // streams in afterwards — its geometry can be hundreds of MB — so until then
  // the document holds nothing to save.
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const [cityPopup, setCityPopup] = useState(null); // {id, x, y, isNew} — inline city editor
  const [unitPopup, setUnitPopup] = useState(null); // {id, x, y, isNew} — inline unit editor
  const [featureSelection, setFeatureSelection] = useState([]); // feature ids ticked in the Features panel or box-selected on the map
  const [customBg, setCustomBg] = useState(null); // live background applied to the map
  const [customBgId, setCustomBgId] = useState(null); // library basemap id applied (null = built-in / doc's own)
  const [basemapPickerOpen, setBasemapPickerOpen] = useState(false);
  // Which country's flag we're picking, or null. Owned HERE, not in the inspector:
  // panelSurface used to carry backdrop-filter, which makes a containing block
  // for position:fixed — an overlay rendered inside the panel was clipped to it
  // and trapped under its z-index. The panels are flat grey now, but this stays
  // owned here: a full-screen overlay belongs at the root either way.
  const [flagPickerFor, setFlagPickerFor] = useState(null);
  // Session-only tracing aid ({ dataUrl, aspect, opacity, visible }) — kept out
  // of the document on purpose so it can never leak into saves or game exports.
  const [refImage, setRefImage] = useState(null);
  const [refPlaceNonce, setRefPlaceNonce] = useState(0);
  const [fmgOpen, setFmgOpen] = useState(false); // FMG "Generate" drawer
  const [fmgBusy, setFmgBusy] = useState(false);
  const [fmgLog, setFmgLog] = useState([]);
  // Whether this build serves the generator (fmgDriver.js checkFmgAvailable):
  // null until asked once, and the GENERATE tab shows only on true.
  const [fmgAvailable, setFmgAvailable] = useState(null);
  useEffect(() => {
    let cancelled = false;
    checkFmgAvailable().then((ok) => { if (!cancelled) setFmgAvailable(ok); });
    return () => { cancelled = true; };
  }, []);

  // ---- reviewing a suggestion's map changes (SuggestionReviewPanel.jsx) -----
  // A suggested basemap goes on the map the way the Basemap picker puts one
  // there: OlMap renders it and hands the persistable form back to the document.
  const setReviewBackground = useCallback((saved) => {
    setCustomBgId(null);
    if (saved) {
      setCustomBg(rebuildPersistedBackground(saved, { persisted: false }));
    } else {
      setCustomBg(null);
      d.patchMetadata({ customBackground: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.patchMetadata]);
  // A suggestion's change of projection (suggestionReview.js): the map moved by
  // the rule convertProjection moves it by, the picture kept as it is and laid
  // where the suggestion says. Nothing is drawn again, so it happens at once,
  // and taking it back is the same call the other way round.
  const customBgRef = useRef(null);
  customBgRef.current = customBg;
  const convertForReview = useCallback((source, target, bounds = null) => {
    if (!api) return;
    const from = normalizeProjection(source);
    const to = normalizeProjection(target);
    if (sameProjection(from, to)) {
      // Only the two switches about how the game shows the map.
      d.patchMetadata({ projection: to });
      return;
    }
    const EARTH = 6378137; // the map's units are metres on the Mercator plane
    const moveXY = (x, y) => {
      const [X, Y] = convertPlane(from, to, x / EARTH, y / EARTH);
      return [X * EARTH, Y * EARTH];
    };
    const background = customBgRef.current;
    // A map with a detailed map never gets here: the review refuses the
    // change first (suggestionReview.js acceptMapChanges).
    const plan = planBasemapChange({ from, to, background, keepPicture: background?.kind === "image" });
    let nextBg = background;
    if (plan.kind === "bounds") {
      // Mercator with no bounds given: the picture fills the square, as it did.
      const lies = bounds ?? (to.type === "mercator" ? null : plan.bounds);
      nextBg = rebuildPersistedBackground({ kind: "image", dataUrl: background.dataUrl, aspect: background.aspect, bounds: lies }, { persisted: false });
    } else if (plan.kind === "vector") {
      for (const feature of background.layer.getSource().getFeatures()) {
        feature.getGeometry()?.applyTransform((input, output, stride = 2) => {
          const out = output ?? input;
          for (let i = 0; i < input.length; i += stride) {
            const [x, y] = moveXY(input[i], input[i + 1]);
            out[i] = x;
            out[i + 1] = y;
          }
          return out;
        });
      }
      nextBg = { ...background, persisted: false };
    } else if (plan.kind === "plain") {
      nextBg = { kind: "plain", persisted: false };
    } else if (plan.kind === "tiles") {
      nextBg = null;
    }
    api.transformRegions(moveXY);
    d.setFeatures((list) => moveFeatureCoords(list, from, to));
    d.setUnits((list) => moveUnits(list, from, to));
    d.patchMetadata({ projection: to, ...(plan.kind === "tiles" ? { customBackground: null } : {}) });
    if (nextBg !== background) setCustomBg(nextBg);
    api.fitToData?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, d.setFeatures, d.setUnits, d.patchMetadata]);
  const review = useSuggestionReview({ review: reviewSource, api, d, setBackground: setReviewBackground, convertProjection: convertForReview, regionEpoch });
  useSuggestionMarkup(api, review, regionEpoch);
  // The review opens beside the map once the scenario's map has loaded.
  useEffect(() => {
    if (hydrated && reviewSource) setOpenPanel("suggestions");
  }, [hydrated, reviewSource]);

  // ---- the region clipboard: pieces of one map pasted into another ----------
  // The clipboard lives in regionClipboard.js (IndexedDB behind a module
  // store), so it outlives this editor: copy on one map, paste on the next.
  const clipboard = useSyncExternalStore(subscribeRegionClipboard, getRegionClipboard, () => null);
  useEffect(() => {
    readRegionClipboard();
  }, []);
  const clipboardCount = clipboard?.regions?.features?.length ?? 0;
  const [clipboardResult, setClipboardResult] = useState(null);
  const copySelectionToClipboard = (ids = d.selection) => {
    if (!api || !ids?.length) return false;
    const regions = api.exportRegions(ids);
    if (!regions.features.length) return false;
    writeRegionClipboard(buildClipboardPayload({ regions, doc: d.doc, colors: d.colors, sourceName: d.name, sourceId: d.doc.id }));
    setClipboardResult({ kind: "copied", count: regions.features.length });
    return true;
  };
  const pasteClipboard = () => {
    if (!api || !clipboard) return false;
    // The document's side first (countries, colours, flags, tags, types and
    // groups this map lacks), then the map's: OlMap carves and adds, one undo step.
    const plan = planClipboardMerge(clipboard, { polities: d.polities, colors: d.colors, flags: d.flags, tags: d.tags, types: d.types, groups: d.groups });
    if (plan.types.length) d.setTypes((list) => [...list, ...plan.types]);
    if (Object.keys(plan.groups).length) d.setGroups((registry) => ({ ...plan.groups, ...registry }));
    for (const [key, record] of Object.entries(plan.upserts)) d.upsertPolity(key, record);
    for (const [key, rgb] of Object.entries(plan.colorOverrides)) d.setColorOverride(key, rgb);
    for (const [key, flag] of Object.entries(plan.flags)) d.setFlag(key, flag);
    for (const [key, list] of Object.entries(plan.tags)) d.setTags(key, list);
    const result = api.pasteRegions(clipboard.regions);
    if (result.added.length) {
      d.setSaveStatus("dirty");
      api.zoomToSelection(result.added);
    }
    setClipboardResult({ kind: "pasted", ...result });
    return result.added.length > 0;
  };
  const clipboardKeysRef = useRef({ copy: copySelectionToClipboard, paste: pasteClipboard });
  clipboardKeysRef.current = { copy: copySelectionToClipboard, paste: pasteClipboard };
  useEffect(() => {
    // Ctrl/Cmd+C copies the selected regions, Ctrl/Cmd+V pastes — unless the
    // author is typing in a field or has text selected, which stay the browser's.
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      const active = document.activeElement;
      if (active && (/^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable)) return;
      if (key === "c" && String(window.getSelection?.()?.toString() || "").length) return;
      const acted = key === "c" ? clipboardKeysRef.current.copy() : clipboardKeysRef.current.paste();
      if (acted) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    d.patchMetadata({ customBackground: null, tiledBasemap: null });
  };

  // Pick one of the user's saved basemaps: fetch its payload and apply it.
  const selectLibraryBasemap = async (bm) => {
    // A Tiled Basemap is named, not drawn here: the scenario keeps a vector
    // drawing on screen as its painted fallback (the Basemap's own, else the
    // one already in use), and the game draws the relief over it.
    if (bm.kind === "tiled") {
      if (!detailedMapFits(d.metadata?.projection)) {
        window.alert(DETAILED_MAP_PROJECTION_MESSAGE);
        return;
      }
      let fallback = null;
      try {
        fallback = (await getBasemapPayload(bm.id))?.geojson || null;
      } catch {
        fallback = null;
      }
      const current = normalizeBackground(customBg);
      const hasBasicMap = (fallback?.features?.length > 0) || (current?.kind === "vector" && current.geojson?.features?.length > 0);
      if (!hasBasicMap) {
        window.alert(DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE);
        return;
      }
      if (fallback?.features?.length > 0) {
        setCustomBg(rebuildPersistedBackground({ kind: "vector", geojson: fallback }, { persisted: false }));
      }
      setCustomBgId(bm.id);
      const previous = d.doc?.metadata?.tiledBasemap;
      // An official map is named by its id and the version on screen, the
      // lowest the scenario needs (docs/adr/0006); the author's own map, not on
      // the official list, by its checksum.
      d.patchMetadata({
        tiledBasemap: {
          ...(bm.official?.id ? { id: bm.official.id, version: bm.official.version } : { hash: bm.contentHash }),
          name: bm.name,
          ...(Array.isArray(previous?.fillOpacity) ? { fillOpacity: previous.fillOpacity } : {}),
        },
      });
      return;
    }
    d.patchMetadata({ tiledBasemap: null });
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

  // Take the scenario's detailed map off. The basemap drawn under it (the
  // custom background on screen) stays, so the scenario keeps its map, and the
  // projection can be converted again (projectionConvert.js).
  const removeDetailedMap = () => {
    d.patchMetadata({ tiledBasemap: null });
    setCustomBgId(null);
  };

  // Upload a new basemap: apply it now AND save it to the library for reuse.
  // Answers what the picker then tells the author, both of which used to go
  // unsaid: { sessionOnly: true } for a GeoTIFF or PMTiles background, which is
  // on the map for this session only (not saved with the map, not added to the
  // library, not shown by the game), and { libraryError } when the library
  // would not take it — it is on the map either way.
  const uploadBasemap = async (file) => {
    if (!file) return null;
    const bg = await loadBackgroundFile(file);
    d.patchMetadata({ tiledBasemap: null });
    setCustomBg(bg); // applies immediately (image / vector / raster)
    const normalized = normalizeBackground(bg);
    if (!normalized) {
      setCustomBgId(null); // raster (GeoTIFF/PMTiles) is session-only reference, not saved
      return { sessionOnly: true };
    }
    const name = file.name ? file.name.replace(/\.[^.]+$/, "") : "Custom basemap";
    try {
      const meta = await addBackgroundToLibrary(normalized, name, { author: d.author || "" });
      setCustomBgId(meta?.id || null);
      return { saved: true };
    } catch (e) {
      console.warn("[editor] save basemap to library failed:", e);
      setCustomBgId(null);
      return { libraryError: e?.message || String(e) };
    }
  };

  // ---- Projection: the whole map moved from one projection to another ----
  // The picture's own shape, for "Use the picture's own shape": a basemap
  // restored from a scenario does not carry it.
  const [pictureAspect, setPictureAspect] = useState(null);
  useEffect(() => {
    if (customBg?.kind !== "image" || !customBg.dataUrl) {
      setPictureAspect(null);
      return undefined;
    }
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive && image.naturalWidth && image.naturalHeight) setPictureAspect(image.naturalWidth / image.naturalHeight);
    };
    image.src = customBg.dataUrl;
    return () => { alive = false; };
  }, [customBg]);
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [projectionError, setProjectionError] = useState("");
  // A detailed map cannot be converted with the map (projectionConvert.js).
  const mapHasDetailedMap = hasDetailedMap(d.doc);
  // The saved own map's checksum, for the Maps window's "In use" mark
  // (ownMapHash.js): taken again only when that background changes.
  const savedBackground = d.doc?.metadata?.customBackground ?? null;
  const [savedOwnMapHash, setSavedOwnMapHash] = useState(null);
  useEffect(() => {
    let alive = true;
    ownMapHash(savedBackground).then((hash) => { if (alive) setSavedOwnMapHash(hash); }).catch(() => { if (alive) setSavedOwnMapHash(null); });
    return () => { alive = false; };
  }, [savedBackground]);
  // Regions, cities, units and basemap, each by its own rule
  // (projectionConvert.js). The basemap is made ready first: redrawing a
  // picture is the one step that can fail, and nothing has moved if it does.
  const convertProjection = async (target, { keepPicture = false } = {}) => {
    if (!api || projectionBusy) return;
    const from = normalizeProjection(d.metadata?.projection);
    const to = normalizeProjection(target);
    if (sameProjection(from, to)) return;
    setProjectionBusy(true);
    setProjectionError("");
    try {
      // Let "Converting the map…" reach the screen before the work starts.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const EARTH = 6378137; // the map's units are metres on the Mercator plane
      const moveXY = (x, y) => {
        const [X, Y] = convertPlane(from, to, x / EARTH, y / EARTH);
        return [X * EARTH, Y * EARTH];
      };
      const plan = planBasemapChange({ from, to, background: customBg, keepPicture, detailedMap: mapHasDetailedMap });
      if (plan.kind === "blocked") {
        setProjectionError(plan.reason);
        return;
      }
      let nextBg = customBg;
      if (plan.kind === "redraw") {
        const redrawn = await reprojectPicture({ dataUrl: customBg.dataUrl, from, to, bounds: customBg.bounds });
        nextBg = rebuildPersistedBackground({ kind: "image", dataUrl: redrawn.dataUrl, aspect: redrawn.aspect, bounds: redrawn.bounds }, { persisted: false });
      } else if (plan.kind === "bounds") {
        nextBg = rebuildPersistedBackground({ kind: "image", dataUrl: customBg.dataUrl, aspect: customBg.aspect, bounds: plan.bounds }, { persisted: false });
      } else if (plan.kind === "vector") {
        for (const feature of customBg.layer.getSource().getFeatures()) {
          feature.getGeometry()?.applyTransform((input, output, stride = 2) => {
            const out = output ?? input;
            for (let i = 0; i < input.length; i += stride) {
              const [x, y] = moveXY(input[i], input[i + 1]);
              out[i] = x;
              out[i + 1] = y;
            }
            return out;
          });
        }
        nextBg = { ...customBg, persisted: false };
      } else if (plan.kind === "plain") {
        nextBg = { kind: "plain", persisted: false };
      } else if (plan.kind === "tiles") {
        nextBg = null;
      }
      api.transformRegions(moveXY);
      d.setFeatures((list) => moveFeatureCoords(list, from, to));
      d.setUnits((list) => moveUnits(list, from, to));
      // The two switches about how the game shows the map stay as they were.
      d.patchMetadata({ projection: { ...to, ...(from.globe === false ? { globe: false } : {}), ...(from.wrap === false ? { wrap: false } : {}) }, ...(plan.kind === "tiles" ? { customBackground: null } : {}) });
      if (nextBg !== customBg) {
        setCustomBg(nextBg);
        // A redrawn picture is no longer the one in Your basemaps.
        if (plan.kind !== "bounds") setCustomBgId(null);
      }
      api.fitToData?.();
    } catch (error) {
      console.warn("[editor] the map could not be converted:", error);
      setProjectionError(error?.message || String(error));
    } finally {
      setProjectionBusy(false);
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
  // This list is a whitelist and it drops anything not named here, silently. A
  // field left off does not fail to save — it fails to EXIST, and only when someone
  // reopens the document. A field added here goes in DOCUMENT_FIELDS
  // (server/mapEditorFields.js) too, the list both stores create a document from.
  const buildDocumentFields = () => ({
    name: d.name,
    metadata: d.metadata,
    types: d.types,
    features: d.features,
    colorOverrides: d.colorOverrides,
    flags: d.flags,
    tags: d.tags,
    // Scenario Workshop: polity metadata keyed by stable identity, for the
    // every registered country, with regions or not. Display names
    // change here without re-owning every region.
    polities: d.polities,
    // The starting units and the groups: both were missing here, so a document's
    // units vanished on reopening it.
    units: d.units,
    groups: d.groups,
    puppets: d.puppets,
    // Without this the marker never persists, so a document migrates on every open,
    // forever — and, far worse, a document saved after being migrated still reads
    // as legacy to everything downstream.
    ownerSchema: d.doc?.ownerSchema ?? OWNER_SCHEMA,
  });

  // The whole document, map and all: what an export writes and what a save falls
  // back to. `regions` may be handed in when the caller has already written them,
  // so the map is never serialised twice for one save.
  const buildPayload = (regions = null) => ({
    ...buildDocumentFields(),
    regions: regions || api?.serializeRegions() || { type: "FeatureCollection", features: [] },
  });

  // Which clean a save is to run, asked of the author each time: "quick"
  // (cracks and slivers up to BORDER_CLEANUP.quickWidth, 500 m), "deep" (up
  // to BORDER_CLEANUP.maxWidth, 1.5 km), or null when the author backs out,
  // and then nothing is cleaned and nothing is saved. The question opens on
  // the answer given last time.
  const chooseClean = () => new Promise((resolve) => {
    cleanAnswerRef.current = resolve;
    setCleanChoice({ last: lastCleanMode() });
  });
  const answerClean = (mode) => {
    const resolve = cleanAnswerRef.current;
    cleanAnswerRef.current = null;
    setCleanChoice(null);
    if (mode) rememberCleanMode(mode);
    resolve?.(mode || null);
  };

  // Every save first runs the border repair over the WHOLE map, at the width
  // of the clean the author chose — enclosed cracks filled, thin overlaps
  // trimmed, one undo step — behind the "Cleaning up the borders" screen,
  // which is painted before the work starts and updated between its chunks.
  // Nothing else in the Workshop repairs borders, so this is also where a
  // merge that fails sends the author (OlMap.jsx). A failure here never
  // blocks the save: the map is then written as it is.
  //
  // Leaves the screen up, saying the map is being written; whoever writes it
  // takes the screen down (setBorderCleanup(null)). Resolves to the note for
  // after the save, as its lines: what was repaired, then what the two guards
  // passed over (topologySweep.js describeCleanupLeftAlone). `exporting`: the
  // map goes to a file, not into a scenario, and the screen says so.
  const cleanBorders = async ({ exporting = false, mode = "deep" } = {}) => {
    const maxWidth = cleanupWidthOf(mode);
    let cleanup = null;
    let cleanupError = "";
    cleanupStopRef.current = false;
    setBorderCleanup({ phase: "gaps", maxWidth, regionCount: 0, chunkIndex: 0, chunkCount: 0, startedAt: Date.now() });
    await yieldToBrowser();
    try {
      cleanup = (await api.repairTopologyEverywhere?.({
        maxWidth,
        onProgress: setBorderCleanup,
        stopRequested: () => cleanupStopRef.current,
      })) ?? null;
    } catch (e) {
      console.warn("[editor] border cleanup before saving failed; saving the map as it is:", e);
      cleanupError = e?.message || String(e);
    }
    setBorderCleanup((current) => ({ ...(current || {}), phase: "save", result: cleanup, error: cleanupError, exporting }));
    await yieldToBrowser();
    return [describeCleanupResult(cleanup, cleanupError), ...describeCleanupLeftAlone(cleanup)].filter(Boolean);
  };

  // Persist the Workshop map into the scenario without forcing a new game.
  // Playing is now an explicit third action instead of the only way to save.
  const persistScenario = async ({ play = false, closeAfter = false } = {}) => {
    if (!api || !onApplyToScenario || scenarioAction || cleanAnswerRef.current) return false;
    // Before the scenario's map has loaded the document is empty, and a save
    // then wrote an empty map over the scenario. That was the "save twice" bug:
    // the first click, made while the map was still downloading, wiped it, and
    // the second, once the map had appeared, wrote it back. The buttons are
    // disabled until hydration; this guards every other way in.
    if (scenarioMode && !hydrated) {
      console.warn("[editor] scenario save requested before its map loaded — ignored.");
      return false;
    }
    // Quick or deep, before anything is read. Backed out of, the save is off.
    const mode = await chooseClean();
    if (!mode) return false;
    const action = play ? "play" : closeAfter ? "save-exit" : "save";
    setScenarioAction(action);
    const note = await cleanBorders({ mode });
    try {
      const authoringOps = polityAuthoringOpsRef.current.slice();
      const seed = {
        ...buildGameSeed(
          d.doc,
          api.serializeRegions() || { type: "FeatureCollection", features: [] },
          d.colors,
        ),
        // The polities removed since the last save (removalsForScenario).
        polityAuthoringOps: removalsForScenario(authoringOps),
      };
      // The renames made since the last save, so the scenario's player country
      // and its name-keyed world records follow them (useMapDocument renamePolity).
      const renames = d.polityRenames;
      await onApplyToScenario(seed, { play, renames });
      d.settlePolityRenames(renames.length);
      // The scenario now owns these operations. A second Save from the same
      // still-open Workshop must not replay one already applied; any made
      // while the save ran stay for the next one, like the renames above.
      polityAuthoringOpsRef.current = polityAuthoringOpsRef.current.slice(authoringOps.length);
      // What the author decided about a suggestion's map changes is kept with
      // the scenario only now that the map it decided about is saved into it.
      if (reviewSource) {
        try { await reviewSource.onSaved?.(review.decisionsForSave()); } catch (e) { console.warn("[editor] could not record the review:", e); }
      }
      setScenarioDirty(false);
      setCleanupNote(note);
      if (!play && closeAfter) onClose?.();
      return true;
    } catch (e) {
      console.warn("[editor] scenario save failed:", e);
      window.alert(`Could not save the map into the scenario: ${e?.message || e}`);
      return false;
    } finally {
      // Apply & Play normally unmounts us before this matters; keeping the reset
      // makes failed/alternate hosts recover cleanly.
      setScenarioAction("");
      setBorderCleanup(null);
    }
  };

  // A save carries the document plus either the whole map or only the regions
  // that moved since the last one (OlMap serializeRegionChanges). That matters
  // because this runs every two seconds while the map is dirty: it used to write
  // the entire world each time, whether or not a polygon had moved.
  //
  // A store that cannot apply a difference — one built against another copy of
  // the map, or a document whose geometry it does not have — says so, and the
  // save is made again with the whole map. The record of what was last written is
  // committed only once the save has landed, so a failure is retried in full.
  //
  // Saves take turns (documentSaving.js createSaveRunner): one asked for while
  // another is running waits for it and then writes whatever is still unsaved,
  // so two never write at once — with no document id yet, both used to create a
  // document. The id a create returns goes into docIdRef at once, where the
  // save queued behind it reads it; the docId state only redraws the menu.
  const docIdRef = useRef(null);
  const adoptDocId = (id) => {
    docIdRef.current = id;
    setDocId(id);
  };
  // d.editCount() when the document last matched what is stored.
  const savedEditsRef = useRef(0);
  // Why the last save failed (the store's own words), for the "Save failed"
  // chip, and how many times it has been retried on its own since.
  const [saveError, setSaveError] = useState("");
  const autoRetriesRef = useRef(0);
  // Resolves true when the document is saved with no edit left over. An edit
  // made while the write was in flight is not in it: the status stays "dirty"
  // (it used to be overwritten with "saved", which also cancelled the autosave
  // the edit had armed) and the next save writes it.
  const attemptSave = async () => {
    if (!api) return false;
    const id = docIdRef.current;
    const edits = d.editCount();
    // Queued behind a save that has already written everything.
    if (id && edits === savedEditsRef.current) return true;
    try {
      d.setSaveStatus("saving");
      const changes = api.serializeRegionChanges?.() ?? null;
      const creating = !id;
      const payload = !changes || creating || changes.full
        ? buildPayload(changes?.full ?? null)
        : { ...buildDocumentFields(), regionsDelta: { changed: changes.changed, count: changes.count, removed: changes.removed } };
      let saved = await saveDocument(id, payload);
      if (saved?.needsFullRegions) {
        console.warn("[editor] the store could not apply the map difference; writing the whole map:", saved.needsFullRegions);
        api.forgetSavedRegions?.();
        saved = await saveDocument(saved.id ?? id, buildPayload());
      }
      if (!id) adoptDocId(saved.id);
      changes?.commit?.();
      if (d.editCount() !== edits) return false;
      savedEditsRef.current = edits;
      autoRetriesRef.current = 0;
      setSaveError("");
      d.setSaveStatus("saved");
      return true;
    } catch (e) {
      console.warn("[editor] save failed:", e);
      setSaveError(e?.message || String(e));
      d.setSaveStatus("error");
      return false;
    }
  };
  const attemptSaveRef = useRef(attemptSave);
  attemptSaveRef.current = attemptSave;
  const runSaveRef = useRef(null);
  if (!runSaveRef.current) runSaveRef.current = createSaveRunner(() => attemptSaveRef.current());
  const saveNow = () => runSaveRef.current();

  // The unload/visibility listeners below are registered once, so a closure would
  // freeze whatever the document was at that moment and flush THAT on the way out
  // — the same stale-closure bug the autosave effect above documents, except its
  // victim is the user's last edits. Refs re-point every render instead.
  const dRef = useRef(d);
  dRef.current = d;
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  // The two files the Documents menu writes: the document, map and all, and
  // the game's seed. The id is read from the ref because a first autosave can
  // create the document while the cleanup below is still running.
  const exportDocument = () => downloadJson({ ...buildPayload(), id: docIdRef.current, version: 1 });
  const exportGameSeed = () =>
    downloadJson(buildGameSeed(d.doc, api?.serializeRegions() || { type: "FeatureCollection", features: [] }, d.colors));

  // Export JSON and Export for game, from the Documents menu. In a scenario's
  // Workshop they write the file at once, as they always did: there the map
  // is saved by the buttons above, which clean its borders. The standalone
  // editor (/?editor=1) has no scenario and none of those buttons, so since
  // the panel that repaired a selection was removed nothing repaired borders
  // in it at all. A file is the only way a map leaves it, so there an export
  // is its save: the cleanup runs first, behind the same screen, and leaves
  // the same note.
  //
  // Save now is not one of them. It writes the stored map, which is the
  // editor's own working copy, and it is the autosave run early: the same
  // write is made every two seconds while the map has unsaved edits, when
  // the tab is hidden, and before Close, New and Open, none of which can wait
  // behind a loading screen. Cleaning on the one of them the author pressed
  // would leave the stored map repaired or not by which came first. (And on
  // the standalone editor's own default, the stock world, the sweep cannot
  // run at all: polygon-clipping refuses its first union, seconds in, and
  // Save now would spend them every time to say so.)
  const exportFromMenu = async (write) => {
    if (scenarioMode) {
      await write();
      return;
    }
    if (!api || borderCleanup || cleanAnswerRef.current) return;
    const mode = await chooseClean();
    if (!mode) return;
    try {
      const note = await cleanBorders({ exporting: true, mode });
      await write();
      setCleanupNote(note);
    } catch (e) {
      console.warn("[editor] the map could not be exported after its border cleanup:", e);
    } finally {
      setBorderCleanup(null);
    }
  };

  // The ✕, and on a phone Back (runtime/backToClose.js), which used to reach
  // past the Workshop to whatever was open under it. Answers false when the
  // player chooses to stay, and Back then leaves the Workshop open.
  const requestClose = async () => {
    if (scenarioMode && scenarioDirty) {
      const ok = window.confirm(
        "This scenario has Workshop changes that have not been saved into the scenario yet. Close without applying them?",
      );
      if (!ok) return false;
    }
    // Closing with edits still in the debounce window would drop them
    // silently — the button looks like "go back", not "discard". Save first
    // and ask only if that save does not land. The answer is what saveNow
    // returns: React state read after the await still said "saving" (the
    // re-render had not happened yet), so a save that worked asked anyway.
    const ok = await settleUnsavedWork({
      status: dRef.current.saveStatus,
      save: saveNow,
      confirm: (question) => window.confirm(question),
      question: "This map has changes that could not be saved. Close it and lose them?",
    });
    if (ok) onClose();
    return ok;
  };
  useBackToClose(Boolean(onClose), requestClose);
  // A side panel open in it (types, regions, layers…) closes first.
  useBackToClose(Boolean(openPanel), () => setOpenPanel(null));

  // A document just opened or started is what is stored (or has nothing to
  // store yet): the saves write to its id, and edits made before it no longer
  // count.
  const markLoaded = (id) => {
    adoptDocId(id);
    savedEditsRef.current = d.editCount();
    autoRetriesRef.current = 0;
    setSaveError("");
    d.setSaveStatus("saved");
  };

  // New and Open replace the map on screen, and used to do it with no save and
  // no question: edits in the autosave's two seconds were dropped, and after a
  // failed save every unsaved change went with no prompt. They now settle the
  // open map the way Close does, then wait for any save still writing it.
  const settleBeforeReplacing = async (question) => {
    const ok = await settleUnsavedWork({
      status: dRef.current.saveStatus,
      save: saveNow,
      confirm: (text) => window.confirm(text),
      question,
    });
    if (ok) await runSaveRef.current.idle();
    return ok;
  };

  // Loading the stock world is not an edit, but an edit made while it was still
  // downloading was saved with the map as it stood then: once the world is on
  // the map, it is written again.
  const writeAgainOnceLoaded = (loading) => {
    const editsAtStart = d.editCount();
    return Promise.resolve(loading).then((applied) => {
      if (applied && d.editCount() !== editsAtStart) d.setSaveStatus("dirty");
      return applied;
    });
  };

  const newDoc = async (kind) => {
    if (!(await settleBeforeReplacing("This map has changes that could not be saved. Start a new map and lose them?"))) return;
    d.setDoc(createDocument({ name: kind === "blank" ? "Untitled Map" : "World Map", kind }));
    if (kind === "blank") api?.loadRegions({ type: "FeatureCollection", features: [] });
    else writeAgainOnceLoaded(api?.reseedWorld());
    setCustomBg(null);
    setCustomBgId(null);
    markLoaded(null);
  };

  // Everything that can fail is done before anything on screen changes: the
  // document is fetched, migrated and built, and OlMap.loadRegions reads the
  // whole map before it clears the old one. A failed open used to leave the new
  // document's fields over an emptied map while the saves still wrote to the
  // old id, and said nothing.
  //
  // The open map is settled before the fetch: re-opening the map that is open
  // (its row in Saved maps) would otherwise read the stored copy from before
  // the flush and put it on screen over the edits just saved. An edit made
  // while the fetch runs is settled again before the swap.
  const openDoc = async (id) => {
    const question = "This map has changes that could not be saved. Open the other map and lose them?";
    if (!(await settleBeforeReplacing(question))) return;
    const editsSettled = d.editCount();
    let opened;
    let background;
    try {
      opened = openStoredDocument(await loadDocument(id));
      background = rebuildPersistedBackground(opened.doc.metadata.customBackground);
    } catch (e) {
      console.warn("[editor] open failed:", e);
      window.alert(`Could not open this map: ${e?.message || e}. Your current map is unchanged.`);
      return;
    }
    if (d.editCount() !== editsSettled && !(await settleBeforeReplacing(question))) return;
    try {
      api?.loadRegions(opened.regions);
    } catch (e) {
      console.warn("[editor] open failed:", e);
      window.alert(`Could not open this map: ${e?.message || e}. Your current map is unchanged.`);
      return;
    }
    d.setDoc(opened.doc);
    setCustomBg(background);
    setCustomBgId(null);
    markLoaded(opened.doc.id);
  };

  // Debounced autosave whenever the document is dirty.
  //
  // Depends on d.doc, not on a hand-listed set of its fields. That list had gone
  // stale — it named name/types/features/metadata but not colorOverrides, flags
  // or tags — and the failure was silent data loss, not a missed save: with the
  // document ALREADY dirty, changing a colour re-rendered but changed no listed
  // dep, so this effect did not re-run. The timer already pending then fired with
  // the saveNow closure from BEFORE the change, wrote the older payload, and set
  // the status to "saved" — leaving the new colour unsaved and the UI claiming
  // otherwise. d.doc is a new object on every document change, so it cannot fall
  // behind the way a field list does.
  useEffect(() => {
    if (!api || d.saveStatus !== "dirty") return;
    const t = setTimeout(() => {
      autoRetriesRef.current = 0;
      saveNow();
    }, 2000);
    return () => clearTimeout(t);
  }, [api, d.saveStatus, docId, d.doc]);


  // Standalone document autosave and scenario persistence are intentionally
  // separate. Once a hydrated scenario is edited, remember that it still needs
  // an explicit Save / Save & Exit / Apply & Play even if the editor document
  // itself has already autosaved.
  useEffect(() => {
    if (scenarioMode && hydratedRef.current && d.saveStatus === "dirty") {
      setScenarioDirty(true);
    }
  }, [scenarioMode, d.saveStatus]);

  // Don't let the tab close on unsaved work. The autosave debounce means up to
  // two seconds of edits exist only in memory at any moment, and on the website
  // a closed tab takes them with it — there is no server-side copy to recover.
  //
  // The browser shows its own generic wording and ignores ours; assigning
  // returnValue is what actually triggers the prompt (Chrome needs it even with
  // preventDefault). "saving" counts as unsaved: the write is in flight and has
  // not landed in IndexedDB yet, and so does "error": the work is still only in
  // memory, and on the website the IndexedDB copy is the only copy.
  useEffect(() => {
    if (!isUnsavedStatus(d.saveStatus)) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [d.saveStatus]);

  // Flush the moment the tab is hidden rather than waiting out the debounce.
  // Switching tabs or apps is the last event we reliably get before a phone or a
  // laptop suspends the page, and on mobile pagehide is often the ONLY one — so
  // this is what shrinks the loss window from "the last two seconds of work" to
  // "nothing", in the cases the beforeunload prompt above never gets to appear.
  useEffect(() => {
    if (!api) return;
    const flush = () => {
      const status = dRef.current.saveStatus;
      if (status === "dirty" || status === "error") saveNowRef.current();
    };
    const onVisibility = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [api]);

  // A failed save used to stay failed: the autosave and the hide flush ran only
  // on "dirty". It is tried again on its own after 5 s, 15 s and 60 s, then left
  // to the chip's Retry and the next edit. A retry of a map difference is safe:
  // the record of what was written is committed only after a save lands.
  useEffect(() => {
    if (!api || d.saveStatus !== "error") return undefined;
    const delay = saveRetryDelay(autoRetriesRef.current);
    if (delay == null) return undefined;
    const t = setTimeout(() => {
      autoRetriesRef.current += 1;
      saveNow();
    }, delay);
    return () => clearTimeout(t);
  }, [api, d.saveStatus]);

  // Hydrate the editor with the scenario's CURRENT map: its regions + owners
  // (custom geometry when it has one, else the stock world with the scenario's
  // ownership overrides stamped on), its cities, its palette, and its author —
  // so "edit this scenario's map" edits THAT map, not a fresh default world.
  useEffect(() => {
    if (!api || !initialMap || hydratedRef.current) return;
    hydratedRef.current = true;
    polityAuthoringOpsRef.current = [];
    const base = createDocument({ name: initialMap.name || "Scenario Map", kind: "import-world" });
    base.metadata.author = initialMap.author || "";
    // Restore the chosen built-in basemap so re-opening shows it (not the default).
    if (initialMap.basemap) base.metadata.basemap = initialMap.basemap;
    // And which built-in maps players may switch to, so Apply keeps the choice.
    if (Array.isArray(initialMap.allowedBasemaps)) base.metadata.allowedBasemaps = initialMap.allowedBasemaps;
    // Carry the restored background in the document metadata so Apply & Play
    // (buildGameSeed reads doc.metadata.customBackground) re-persists it instead of
    // clearing the scenario's background when the user re-opens and re-applies.
    if (initialMap.background) base.metadata.customBackground = initialMap.background;
    // And the Tiled Basemap it names, for the same reason (exportPreset.js).
    if (initialMap.tiledBasemap) base.metadata.tiledBasemap = initialMap.tiledBasemap;
    // And its projection, which the save writes back (exportPreset.js).
    if (initialMap.projection) base.metadata.projection = initialMap.projection;
    // Same reasoning as the background above, and it is data loss if missed:
    // buildGameSeed emits flags: null when the document has none, and
    // applyMapToScenario reads that null as "clear the scenario's flags.json".
    // So opening a scenario's map without its flags and pressing Apply & Play
    // deleted every author-set flag. Restore them so a round-trip is a no-op.
    if (initialMap.polities && typeof initialMap.polities === "object") {
      base.polities = structuredClone(initialMap.polities);
    }
    base.groups = normalizeGroups(initialMap.groups);
    // The scenario's puppet states, as its world has them (scenarioPuppets.js).
    base.puppets = Array.isArray(initialMap.puppets) ? structuredClone(initialMap.puppets) : [];
    // Its region types, so a round trip keeps them (the default Land and
    // Coastal for a scenario saved before they were).
    const regionTypes = normalizeRegionTypes(initialMap.regionTypes);
    if (regionTypes.length) base.types = regionTypes;
    if (initialMap.flags) base.flags = normalizePolityKeyedMap(initialMap.flags, base.polities);
    // Same reasoning as flags: without this a round-trip clears the scenario's tags.
    if (initialMap.tags) base.tags = normalizePolityKeyedMap(initialMap.tags, base.polities);
    // Keeps the city set the map's own even if the author empties it here.
    if (initialMap.customCities) base.metadata.citiesAuthored = true;
    // Each city with its size, population by year, tags, symbol and country
    // (exportPreset.js gameCityToFeature).
    base.features = (initialMap.cities?.features || [])
      .map((f) => gameCityToFeature(f, newId("feat")))
      .filter(Boolean);
    // The scenario's structures (world.markers) come back as map features, each
    // keeping its id and whatever the Workshop does not edit (mapFeatures.js).
    base.features.push(...(Array.isArray(initialMap.markers) ? initialMap.markers : [])
      .map((marker) => markerToFeature(marker, newId("feat")))
      .filter(Boolean));
    // The scenario's starting units come back into the Workshop too, so a
    // round-trip keeps them and the Units panel edits what the game starts with.
    base.units = (Array.isArray(initialMap.units) ? initialMap.units : [])
      .filter((u) => Number.isFinite(Number(u?.lng)) && Number.isFinite(Number(u?.lat)))
      .map((u) => ({
        id: String(u.id || newId("unit")),
        name: String(u.name || "Unit"),
        type: String(u.type || "infantry"),
        ownerCode: String(u.ownerCode || ""),
        lng: Number(u.lng),
        lat: Number(u.lat),
        strength: Number.isFinite(Number(u.strength)) ? Number(u.strength) : 100,
        composition: String(u.composition || ""),
        note: String(u.note || ""),
      }));
    d.setDoc(base);
    if (initialMap.colors) d.mergeColors(normalizePolityKeyedMap(initialMap.colors, initialMap.polities));
    // Some historical scenarios keep their authored colour only in the polity
    // registry. Make those visible in the editor palette too.
    if (initialMap.polities) {
      const polityColors = {};
      for (const [key, record] of Object.entries(initialMap.polities)) {
        const rgb = hexToRgb(record?.color);
        if (rgb) polityColors[key] = rgb;
      }
      d.mergeColors(polityColors);
    }
    // A scenario with no regions file of its own opens on the stock world, which
    // arrives seconds later: Save and Apply wait for it (hydrated, below).
    const mapLoaded = initialMap.regions
      ? api.loadRegions(initialMap.regions, initialMap.ownershipOverrides || {}, initialMap.claimOverrides || null)
      : writeAgainOnceLoaded(api.reseedWorldWithOwners(initialMap.ownershipOverrides || {}, initialMap.claimOverrides || null));
    // Restore the scenario's custom map background so re-opening its map editor
    // shows the uploaded map, not a blank basemap. It's marked persisted, so the
    // OlMap effect renders it without re-emitting (no dirty/autosave on open).
    setCustomBg(initialMap.background ? rebuildPersistedBackground(initialMap.background) : null);
    setCustomBgId(null);
    markLoaded(null);
    setScenarioDirty(false);
    Promise.resolve(mapLoaded).then(
      () => setHydrated(true),
      // Save stays disabled: writing a half-loaded map would replace the scenario's.
      (e) => console.warn("[editor] the scenario's map did not load:", e),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, initialMap]);

  // The city popup is anchored to a screen position; panning/zooming would leave
  // it floating over the wrong spot, so any map movement closes it.
  useEffect(() => {
    if (!api?.map) return undefined;
    const close = () => { setCityPopup(null); setUnitPopup(null); };
    api.map.on("movestart", close);
    return () => api.map.un("movestart", close);
  }, [api]);

  // Region-count-per-type for the Type Manager (recomputed on relevant changes).
  const typeUsage = useMemo(
    () => (api ? api.countByType() : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, d.types, d.selection, d.regionCount],
  );

  // The polity registry keeps every country that was registered — created in
  // the Countries panel, imported in a roster, or written by an owner field —
  // whether or not it holds a region right now. A country with no regions is
  // still a country to the game (buildGameSeed emits it), which is what lets an
  // author register one before painting it, or keep a government in exile.
  // Removing one is explicit: the Countries panel's "Remove from the map".

  const polityCount = useMemo(() => {
    const keys = new Set(Object.keys(d.polities || {}));
    for (const row of api?.listPolityUsage?.() || []) keys.add(row.key);
    return keys.size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, d.polities, d.regionCount, regionEpoch]);

  // Each group's tint colour, for the map (OlMap/olStyle.js). Memoised on the
  // colours themselves, not on d.groups: that changes with every keystroke in a
  // group's description, and each new object restyled the whole region layer
  // and rebuilt every group's outline.
  const groupColorsKey = useMemo(
    () => JSON.stringify(Object.entries(normalizeGroups(d.groups)).map(([name, group]) => [name, group.color])),
    [d.groups],
  );
  const groupColors = useMemo(() => Object.fromEntries(JSON.parse(groupColorsKey)), [groupColorsKey]);
  const groupCount = useMemo(
    () => new Set([...Object.keys(d.groups || {}), ...Object.keys(api?.listGroupUsage?.() || {})]).size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, d.groups, regionEpoch],
  );

  const polityChoices = useMemo(() => {
    const keys = new Set(Object.keys(d.polities || {}));
    for (const row of api?.listPolityUsage?.() || []) keys.add(row.key);
    if (paintOwner) keys.add(paintOwner);
    return [...keys]
      .filter(Boolean)
      .map((key) => ({ key, name: String(d.polities?.[key]?.name || key) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, d.polities, d.regionCount, regionEpoch, paintOwner]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#111113",
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
        scenarioMode={scenarioMode}
        defaultTypeId={d.types[0]?.id || "land"}
        paintOwner={paintOwner}
        paintOnlyOwner={paintOnlyOwner}
        units={d.units}
        groupColors={groupColors}
        featureSelectionIds={featureSelection}
        onFeatureSelectionChange={setFeatureSelection}
        features={d.features}
        onSelectionChange={d.setSelection}
        onRegionCount={d.setRegionCount}
        onRegionsChanged={(count, { loaded = false } = {}) => {
          d.setRegionCount(count);
          // A map being opened is not an edit (OlMap notifyRegions).
          if (!loaded) d.setSaveStatus("dirty");
          setRegionEpoch((n) => n + 1);
        }}
        onFeatureCreate={({ pixel, mapFeature = false, ...partial }) => {
          const id = newId("feat");
          // The Map feature tool: a base, a port, a landmark (mapFeatures.js).
          if (mapFeature) {
            d.setFeatures((list) => [...list, newMapFeature({ id, ...partial })]);
            d.setSaveStatus("dirty");
            setCityPopup({ id, x: pixel?.[0] ?? 80, y: pixel?.[1] ?? 80, isNew: true });
            return;
          }
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
          const step = removeRowStep(d.features, d.setFeatures, id);
          d.setSaveStatus("dirty");
          setCityPopup((p) => (p?.id === id ? null : p));
          return step;
        }}
        onUnitCreate={({ pixel, ...partial }) => {
          const id = newId("unit");
          d.setUnits((list) => [...list, { id, name: "New unit", type: "infantry", strength: 100, composition: "", note: "", ...partial }]);
          setUnitPopup({ id, x: pixel?.[0] ?? 80, y: pixel?.[1] ?? 80, isNew: true });
        }}
        onUnitEdit={({ id, pixel }) => setUnitPopup({ id, x: pixel[0], y: pixel[1], isNew: false })}
        onUnitRemove={(id) => {
          const step = removeRowStep(d.units, d.setUnits, id);
          setUnitPopup((p) => (p?.id === id ? null : p));
          return step;
        }}
        onHistory={setHistory}
        onReady={setApi}
        customBackground={customBg}
        onCustomBackgroundSave={(saved) => d.patchMetadata({ customBackground: saved })}
        referenceImage={refImage}
        referenceAdjust={openPanel === "reference" && Boolean(refImage)}
        referencePlaceNonce={refPlaceNonce}
      />

      <DocumentsMenu
        docName={d.name}
        onNameChange={d.setName}
        currentId={docId}
        author={d.author}
        onAuthorChange={d.setAuthor}
        onNew={newDoc}
        onSave={saveNow}
        onExport={() => exportFromMenu(exportDocument)}
        onExportGame={() => exportFromMenu(exportGameSeed)}
        onOpen={openDoc}
      />

      {(onClose || onApplyToScenario) && (
        // On a phone the buttons stack vertically (Apply above Close) and drop their
        // labels, so the block is one icon wide and does not overlap the centred
        // toolbar. On desktop it stays a labelled horizontal row.
        <div style={{ position: "fixed", top: 12, right: 12, zIndex: 40, display: "flex", flexDirection: isMobile ? "column" : "row", gap: 8 }}>
          {onApplyToScenario && (
            <>
              <button
                onClick={() => persistScenario({ play: false, closeAfter: false })}
                disabled={Boolean(scenarioAction) || !hydrated}
                title={!hydrated ? "The scenario’s map is still loading" : `Save this map into ${scenarioName || "the scenario"} and keep editing`}
                style={{
                  ...panelSurface,
                  padding: isMobile ? "9px 11px" : "8px 12px",
                  cursor: scenarioAction || !hydrated ? "default" : "pointer",
                  color: "white",
                  fontWeight: 700,
                  fontSize: isMobile ? 15 : 13,
                  opacity: scenarioAction || !hydrated ? 0.75 : 1,
                }}
              >
                {!hydrated ? (isMobile ? "⏳" : "Loading map…") : isMobile ? "💾" : scenarioAction === "save" ? "Saving…" : "💾 Save"}
              </button>
              <button
                onClick={() => persistScenario({ play: false, closeAfter: true })}
                disabled={Boolean(scenarioAction) || !hydrated}
                title={!hydrated ? "The scenario’s map is still loading" : `Save this map into ${scenarioName || "the scenario"} and leave the Workshop`}
                style={{
                  ...panelSurface,
                  padding: isMobile ? "9px 11px" : "8px 12px",
                  cursor: scenarioAction || !hydrated ? "default" : "pointer",
                  color: "white",
                  fontWeight: 700,
                  fontSize: isMobile ? 15 : 13,
                  opacity: scenarioAction || !hydrated ? 0.75 : 1,
                }}
              >
                {isMobile ? "↩" : scenarioAction === "save-exit" ? "Saving…" : "Save & Exit"}
              </button>
              <button
                onClick={() => persistScenario({ play: true })}
                disabled={Boolean(scenarioAction) || !hydrated}
                title={!hydrated ? "The scenario’s map is still loading" : `Save this map into ${scenarioName || "the scenario"} and start playing it`}
                style={{
                  ...panelSurface,
                  padding: isMobile ? "9px 11px" : "8px 15px",
                  cursor: scenarioAction || !hydrated ? "default" : "pointer",
                  color: "white",
                  fontWeight: 700,
                  fontSize: isMobile ? 16 : 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: isMobile ? 0 : 6,
                  background: scenarioAction ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.14)",
                  border: "1px solid rgba(255,255,255,0.23)",
                  opacity: scenarioAction || !hydrated ? 0.8 : 1,
                }}
              >
                {isMobile ? (scenarioAction === "play" ? "…" : "▶") : (scenarioAction === "play" ? "Applying…" : "▶ Apply & Play")}
              </button>
            </>
          )}
          {onClose && (
            <button
              onClick={() => { void requestClose(); }}
              title="Close map editor"
              aria-label="Close map editor"
              style={{
                ...panelSurface,
                padding: isMobile ? "9px 11px" : "8px 13px",
                cursor: "pointer",
                color: "white",
                fontWeight: 700,
                fontSize: isMobile ? 16 : 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: isMobile ? 0 : 6,
              }}
            >
              {isMobile ? "✕" : "✕ Close"}
            </button>
          )}
        </div>
      )}

      <Toolbar
        activeTool={d.activeTool}
        isMobile={isMobile}
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
            top: "var(--editor-toolbar-bottom, 58px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 31,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 8,
            padding: "7px 10px",
            fontSize: 12,
            maxWidth: "calc(100vw - 20px)",
          }}
        >
          <span style={{ color: "rgba(255,255,255,0.72)", fontWeight: 700 }}>Paint polity</span>
          {d.colors[paintOwner] && (
            <span style={{ width: 16, height: 16, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: `rgb(${d.colors[paintOwner].join(",")})` }} />
          )}
          <select
            value={paintOwner}
            onChange={(e) => setPaintOwner(e.target.value)}
            style={{ ...inputStyle, width: 220, padding: "4px 7px" }}
            title="Stable polity key to assign while painting"
          >
            <option value="">Unowned / erase ownership</option>
            {polityChoices.map((row) => (
              <option key={row.key} value={row.key}>
                {row.name}{row.name !== row.key ? ` — ${row.key}` : ""}
              </option>
            ))}
          </select>

          <span style={{ color: "rgba(255,255,255,0.48)" }}>paint over</span>
          <select
            value={paintOnlyOwner}
            onChange={(e) => setPaintOnlyOwner(e.target.value)}
            style={{ ...inputStyle, width: 190, padding: "4px 7px" }}
            title="Restrict a paint stroke to regions that currently have this owner"
          >
            <option value="*">Any region</option>
            <option value="__unowned__">Unowned regions only</option>
            {polityChoices.map((row) => (
              <option key={`filter-${row.key}`} value={row.key}>
                Only {row.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setOpenPanel("polities")}
            style={{ ...panelSurface, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
          >
            Manage polities…
          </button>
          <span style={{ color: "rgba(255,255,255,0.46)", whiteSpace: "nowrap" }}>
            click or drag · one stroke = one undo
          </span>
        </div>
      )}

      {d.activeTool === "modify" && (
        <div
          style={{
            ...panelSurface,
            position: "fixed",
            top: "var(--editor-toolbar-bottom, 58px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 31,
            padding: "7px 11px",
            maxWidth: "min(760px, calc(100vw - 24px))",
            fontSize: 11.5,
            color: d.selection.length ? "rgba(255,255,255,0.78)" : "#fbbf24",
            textAlign: "center",
          }}
        >
          <b>Manual vertex override:</b>{" "}
          {d.selection.length === 0
            ? "select the regions to edit first"
            : d.selection.length === 1
              ? "1 selected region · drag a vertex · drag an edge to insert · Alt-click a vertex to remove · snap magnet enabled · Ctrl/Cmd+Z undo"
              : `${d.selection.length} selected regions · drag a vertex · drag an edge to insert · Alt-click a vertex to remove · snap magnet enabled · Ctrl/Cmd+Z undo`}
        </div>
      )}

      {d.activeTool === "border" && (
        <div
          style={{
            ...panelSurface,
            position: "fixed",
            top: "var(--editor-toolbar-bottom, 58px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 31,
            padding: "7px 11px",
            maxWidth: "min(850px, calc(100vw - 24px))",
            fontSize: 11.5,
            color: d.selection.length === 2 ? "rgba(255,255,255,0.84)" : "#fbbf24",
            textAlign: "center",
          }}
        >
          <b>Shared border precision:</b>{" "}
          {d.selection.length === 2
            ? "drag a border vertex or edge on either selected region; the released point is welded into BOTH regions · cyan halo = shared-border magnet · Alt-click removes the corresponding shared vertex · a 100 m topology check runs after each edit · Ctrl/Cmd+Z undo"
            : `select exactly 2 neighbouring regions first (${d.selection.length} selected)`}
        </div>
      )}

      {openPanel === "types" && (
        <TypeManager types={d.types} setTypes={d.setTypes} usage={typeUsage} onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === "regions" && (
        <RegionsPanel api={api} polities={d.polities} selection={d.selection} setSelection={d.setSelection} onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === "polities" && (
        <PolitiesPanel
          api={api}
          polities={d.polities}
          selection={d.selection}
          setSelection={d.setSelection}
          regionEpoch={regionEpoch}
          colors={d.colors}
          flags={d.flags}
          tags={d.tags}
          upsertPolity={d.upsertPolity}
          // Renaming re-keys the polity on the map (regions, claims) and in the
          // document (record, colour, flag, tags, cities) in one go.
          // Answers whether the rename happened, so the panel follows only an
          // accepted one. A clash is with a registered polity or an owner or
          // claimant already on the map.
          renamePolity={(key, nextName) => {
            const from = String(key || "").trim();
            const to = String(nextName || "").trim();
            if (!from || !to || from === to) return false;
            const names = [...Object.keys(d.polities || {}), ...(api?.listPolityUsage?.() || []).map((row) => row.key)];
            const clash = names.find((other) => samePolityName(other, to) && !samePolityName(other, from));
            if (clash) {
              window.alert(`“${to}” is already the name of another polity (“${clash}”). A rename cannot merge two countries.`);
              return false;
            }
            api?.renameOwner?.(from, to);
            d.renamePolity(from, to);
            polityAuthoringOpsRef.current.push({ op: "rename", from, to });
            if (paintOwner === from) setPaintOwner(to);
            if (paintOnlyOwner === from) setPaintOnlyOwner(to);
            return true;
          }}
          removePolity={(key) => {
            const stableKey = String(key || "").trim();
            if (!stableKey) return;
            d.removePolity(stableKey);
            polityAuthoringOpsRef.current.push({ op: "remove", key: stableKey });
          }}
          removePolities={(keys) => {
            const stableKeys = [...new Set((keys || []).map((key) => String(key || "").trim()).filter(Boolean))];
            if (!stableKeys.length) return;
            d.removePolities(stableKeys);
            for (const key of stableKeys) polityAuthoringOpsRef.current.push({ op: "remove", key });
          }}
          puppets={d.puppets}
          setPuppets={d.setPuppets}
          importPolityRoster={d.importPolityRoster}
          setColorOverride={d.setColorOverride}
          setTags={d.setTags}
          onOpenFlagPicker={setFlagPickerFor}
          onPaintPolity={(key) => {
            setPaintOwner(key);
            setPaintOnlyOwner("*");
            d.setActiveTool("paint");
            setOpenPanel(null);
          }}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "groups" && (
        <GroupsPanel
          api={api}
          groups={d.groups}
          setGroups={d.setGroups}
          selection={d.selection}
          regionEpoch={regionEpoch}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "province-import" && (
        <ProvinceImportPanel
          api={api}
          polities={d.polities}
          flags={d.flags}
          importPolityRoster={d.importPolityRoster}
          importCityMarkers={d.importCityMarkers}
          currentPointFeatures={d.features}
          onApplied={() => {
            d.setSelection([]);
            setRegionEpoch((n) => n + 1);
          }}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "layers" && <LayersPanel api={api} onClose={() => setOpenPanel(null)} />}
      {openPanel === "projection" && (
        <ProjectionPanel
          projection={d.metadata?.projection}
          pictureAspect={pictureAspect}
          hasPicture={customBg?.kind === "image"}
          busy={projectionBusy}
          error={projectionError}
          blocked={mapHasDetailedMap ? DETAILED_MAP_CONVERSION_MESSAGE : ""}
          onConvert={convertProjection}
          onView={(patch) => {
            // { globe } or { wrap }: written only when switched off.
            const next = { ...normalizeProjection(d.metadata?.projection) };
            for (const [key, on] of Object.entries(patch)) {
              if (on) delete next[key];
              else next[key] = false;
            }
            d.patchMetadata({ projection: next });
          }}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "reference" && (
        <ReferencePanel
          refImage={refImage}
          setRefImage={setRefImage}
          onRecenter={() => setRefPlaceNonce((n) => n + 1)}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "features" && (
        <FeatureManager
          features={d.features}
          setFeatures={d.setFeatures}
          api={api}
          selection={featureSelection}
          setSelection={setFeatureSelection}
          activeTool={d.activeTool}
          setActiveTool={d.setActiveTool}
          onClose={() => {
            setOpenPanel(null);
            if (d.activeTool === "feature-box") d.setActiveTool("select");
          }}
        />
      )}
      {openPanel === "units" && (
        <UnitsPanel
          units={d.units}
          polityName={(key) => String(d.polities?.[key]?.name || key || "")}
          activeTool={d.activeTool}
          setActiveTool={d.setActiveTool}
          onLocate={(unit) => api?.locateFeature?.([unit.lng, unit.lat])}
          onEdit={(id) => {
            const unit = d.units.find((u) => u.id === id);
            if (!unit) return;
            api?.locateFeature?.([unit.lng, unit.lat]);
            setUnitPopup({ id, x: Math.round((window.innerWidth || 1200) / 2), y: Math.round((window.innerHeight || 800) / 2) - 160, isNew: false });
          }}
          onRemove={(id) => d.setUnits((list) => list.filter((u) => u.id !== id))}
          onRemoveAll={() => {
            if (window.confirm(`Remove all ${d.units.length} starting units from this map?`)) d.setUnits([]);
          }}
          onClose={() => {
            setOpenPanel(null);
            if (d.activeTool === "unit") d.setActiveTool("select");
          }}
        />
      )}

      {openPanel === "suggestions" && review.active && (
        <SuggestionReviewPanel
          review={review}
          doc={d.doc}
          api={api}
          suggestion={reviewSource?.suggestion}
          onClose={() => setOpenPanel(null)}
        />
      )}

      {openPanel === "clipboard" && (
        <ClipboardPanel
          clipboard={clipboard}
          selectionCount={d.selection.length}
          result={clipboardResult}
          onCopySelection={() => copySelectionToClipboard()}
          onPaste={pasteClipboard}
          onClear={() => {
            clearRegionClipboard();
            setClipboardResult(null);
          }}
          onClose={() => setOpenPanel(null)}
        />
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
        polities={d.polities}
        upsertPolity={d.upsertPolity}
        regionEpoch={regionEpoch}
        onOpenPolities={() => setOpenPanel("polities")}
        groups={d.groups}
        onOpenGroups={() => setOpenPanel("groups")}
        onCopyToClipboard={(ids) => copySelectionToClipboard(ids)}
      />

      {cityPopup && isMapFeature(d.features.find((f) => f.id === cityPopup.id)) && (
        <MarkerPopup
          feature={d.features.find((f) => f.id === cityPopup.id)}
          x={cityPopup.x}
          y={cityPopup.y}
          isNew={cityPopup.isNew}
          polities={polityChoices}
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
      {cityPopup && !isMapFeature(d.features.find((f) => f.id === cityPopup.id)) && (
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

      {unitPopup && (
        <UnitPopup
          unit={d.units.find((u) => u.id === unitPopup.id)}
          x={unitPopup.x}
          y={unitPopup.y}
          isNew={unitPopup.isNew}
          polities={polityChoices}
          onChange={(patch) => d.setUnits((list) => list.map((u) => (u.id === unitPopup.id ? { ...u, ...patch } : u)))}
          onDelete={() => {
            d.setUnits((list) => list.filter((u) => u.id !== unitPopup.id));
            setUnitPopup(null);
          }}
          onClose={() => setUnitPopup(null)}
        />
      )}

      <BottomBar
        counts={d.counts}
        polityCount={polityCount}
        groupCount={groupCount}
        clipboardCount={clipboardCount}
        suggestionCount={review.active ? review.pendingCount : null}
        basemap={d.basemap}
        hasCustomBackground={Boolean(customBg)}
        onOpenBasemaps={() => setBasemapPickerOpen(true)}
        detailedMapLabel={d.doc?.metadata?.tiledBasemap?.name || ""}
        name={d.name}
        onNameChange={d.setName}
        saveStatus={d.saveStatus}
        saveError={saveError}
        onRetrySave={() => {
          autoRetriesRef.current = 0;
          void saveNow();
        }}
        scenarioDirty={scenarioMode ? scenarioDirty : false}
        openPanel={openPanel}
        onOpenPanel={togglePanel}
        isMobile={isMobile}
        search={
          <SearchBar
            api={api}
            features={d.features}
            polities={d.polities}
            setSelection={d.setSelection}
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
        currentVectorGeojson={normalizeBackground(customBg)?.kind === "vector" ? normalizeBackground(customBg).geojson : null}
        allowedBasemaps={Array.isArray(d.doc?.metadata?.allowedBasemaps) ? d.doc.metadata.allowedBasemaps : null}
        onAllowedBasemapsChange={(value) => d.patchMetadata({ allowedBasemaps: value })}
        scenarioHasOwnMap={scenarioHasOwnMap(d.doc)}
        detailedMap={d.doc?.metadata?.tiledBasemap || null}
        ownMapHash={savedOwnMapHash}
        onRemoveDetailedMap={removeDetailedMap}
      />

      <BorderCleanupNote lines={cleanupNote} top={isMobile ? 200 : 56} />
      <BorderCleanupChoice choice={cleanChoice} onChoose={answerClean} />
      <BorderCleanupOverlay state={borderCleanup} onStop={() => { cleanupStopRef.current = true; }} />

      {fmgAvailable && (
        <FmgPanel
          open={fmgOpen}
          onToggle={() => setFmgOpen((o) => !o)}
          busy={fmgBusy}
          log={fmgLog}
          onGenerate={generateFromFmg}
        />
      )}
    </div>
  );
};

export default MapEditor;
