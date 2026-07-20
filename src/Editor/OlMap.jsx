/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// The OpenLayers map surface for the editor. Created once and driven imperatively
// through refs so it never tears down on React re-renders (the canvas lives
// outside React's render cycle). Owns the region vector source/
// layer, a region-label layer, the swappable reference basemap, click-selection,
// the editing interactions (draw / modify / move / snap / delete), and exposes an
// imperative API via onReady for the side panels.

import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import { editorBasemapById, esriXyzUrl } from "./basemaps.js";
import VectorLayer from "ol/layer/Vector";
import VectorImageLayer from "ol/layer/VectorImage";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import RegularShape from "ol/style/RegularShape";
import Point from "ol/geom/Point";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Translate from "ol/interaction/Translate";
import Snap from "ol/interaction/Snap";
import PointerInteraction from "ol/interaction/Pointer";
import { fromExtent as polygonFromExtent } from "ol/geom/Polygon";
import Feature from "ol/Feature";
import Collection from "ol/Collection";
import GeoJSON from "ol/format/GeoJSON";
import ImageLayer from "ol/layer/Image";
import ImageStatic from "ol/source/ImageStatic";
import { fromLonLat, toLonLat } from "ol/proj";
import { vectorLayerToGeoJSON } from "./customBackground.js";
import { defaults as defaultControls } from "ol/control/defaults";
import { makeRegionStyle } from "./olStyle.js";
import { loadSeedFeatures } from "./regionImport.js";
import { newId } from "./useMapDocument.js";
import { unionGeoms, translatedClone, subtractFrom, overlaps } from "./geometry.js";

const BASEMAP_BG = {
  dark: "#0b1020",
  black: "#000000",
  white: "#ffffff",
  grayscale: "#3a3a3f",
  osm: "#0b1020",
  light: "#0b1020",
};

// Web-Mercator world extent (±180° lon, ±85.0511° lat) — a custom image
// background is stretched across all of it so it fully replaces the basemap.
const WORLD_EXTENT_3857 = [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244];

const LABEL_MIN_ZOOM = 4;

// City markers. Module scope because the style cache below needs them and it
// outlives any single map instance; nothing here depends on the component.
const markerShape = (radius) =>
  new RegularShape({
    points: 4,
    radius,
    angle: Math.PI / 4,
    fill: new Fill({ color: "#ffd54a" }),
    stroke: new Stroke({ color: "#000", width: 1 }),
  });
const SHAPES = { large: markerShape(6), mid: markerShape(4.5), small: markerShape(3.5) };

// One Style per (size, label text) instead of a fresh Style + Text + Fill +
// Stroke for every city on every frame. SHAPES was already shared for exactly
// this reason — the Style wrapping it was not. The key collapses to just the size
// when the label is hidden, so a zoomed-out world uses three objects in total no
// matter how many cities were imported.
const cityStyleCache = new Map();
const cityStyle = (size, name) => {
  const key = name ? `${size}|${name}` : size;
  let style = cityStyleCache.get(key);
  if (!style) {
    style = new Style({
      image: SHAPES[size],
      text: name
        ? new Text({
            text: name,
            font: "600 11px sans-serif",
            offsetY: -11,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "rgba(0,0,0,0.85)", width: 3 }),
          })
        : undefined,
    });
    cityStyleCache.set(key, style);
  }
  return style;
};

// Same reasoning for region labels: the region styles are memoised (see
// olStyle.js) and these were the one place still allocating per feature per
// frame. Keyed on the text, the only thing that varies.
const labelStyleCache = new Map();
const labelStyle = (name) => {
  let style = labelStyleCache.get(name);
  if (!style) {
    style = new Style({
      text: new Text({
        text: name,
        font: "600 12px sans-serif",
        overflow: false,
        fill: new Fill({ color: "rgba(255,255,255,0.95)" }),
        stroke: new Stroke({ color: "rgba(0,0,0,0.85)", width: 3 }),
      }),
    });
    labelStyleCache.set(name, style);
  }
  return style;
};

const toTypesById = (types) => {
  const map = {};
  for (const t of types || []) map[t.id] = t;
  return map;
};

// A representative interior coordinate for a region (for lasso containment tests).
const interiorPoint = (geom) => {
  const type = geom.getType();
  if (type === "Polygon") {
    const c = geom.getInteriorPoint().getCoordinates();
    return [c[0], c[1]];
  }
  if (type === "MultiPolygon") {
    const pts = geom.getInteriorPoints().getCoordinates();
    return pts.length ? [pts[0][0], pts[0][1]] : null;
  }
  return null;
};

const OlMap = ({
  basemap = "dark",
  types,
  colors,
  selectionIds,
  activeTool,
  seedKind = "import-world",
  defaultTypeId = "land",
  paintOwner = "",
  features = [],
  onSelectionChange,
  onRegionCount,
  onRegionsChanged,
  onFeatureCreate,
  onFeatureEdit,
  onFeatureRemove,
  onHistory,
  onReady,
  customBackground = null,
  onCustomBackgroundSave,
  // Tracing aid: { dataUrl, aspect, opacity, visible } — session-only, never
  // exported. referenceAdjust turns on the move/resize frame; bumping
  // referencePlaceNonce re-centers the image on the current view.
  referenceImage = null,
  referenceAdjust = false,
  referencePlaceNonce = 0,
}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const regionSourceRef = useRef(null);
  const regionLayerRef = useRef(null);
  const labelLayerRef = useRef(null);
  const pointSourceRef = useRef(null);
  const pointLayerRef = useRef(null);
  const baseLayerRef = useRef(null);
  const onCustomBackgroundSaveRef = useRef(onCustomBackgroundSave);
  onCustomBackgroundSaveRef.current = onCustomBackgroundSave;
  // Reference image (tracing aid): extent lives in a ref, not React state —
  // it changes on every drag frame and nothing outside the map needs it.
  const refImageLayerRef = useRef(null);
  const refImageExtentRef = useRef(null);
  const refImageFrameSourceRef = useRef(null);
  const interactionsRef = useRef([]);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const onFeatureCreateRef = useRef(onFeatureCreate);
  onFeatureCreateRef.current = onFeatureCreate;
  const onFeatureEditRef = useRef(onFeatureEdit);
  onFeatureEditRef.current = onFeatureEdit;
  const onFeatureRemoveRef = useRef(onFeatureRemove);
  onFeatureRemoveRef.current = onFeatureRemove;
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;

  const typesByIdRef = useRef(toTypesById(types));
  const colorsRef = useRef(colors || {});
  const selectedIdsRef = useRef(new Set(selectionIds || []));
  const activeToolRef = useRef(activeTool);
  const defaultTypeIdRef = useRef(defaultTypeId);
  const paintOwnerRef = useRef(paintOwner);
  const onSelectionRef = useRef(onSelectionChange);
  const onRegionsChangedRef = useRef(onRegionsChanged);

  typesByIdRef.current = toTypesById(types);
  colorsRef.current = colors || {};
  activeToolRef.current = activeTool;
  defaultTypeIdRef.current = defaultTypeId;
  paintOwnerRef.current = paintOwner;
  onSelectionRef.current = onSelectionChange;
  onRegionsChangedRef.current = onRegionsChanged;

  const notifyRegions = () => {
    const n = regionSourceRef.current?.getFeatures().length ?? 0;
    onRegionsChangedRef.current?.(n);
  };

  // ---- undo/redo command stack (discrete region operations) ---------------
  const emitHistory = () =>
    onHistoryRef.current?.({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  const pushCmd = (cmd) => {
    undoStackRef.current.push(cmd);
    if (undoStackRef.current.length > 80) undoStackRef.current.shift();
    redoStackRef.current = [];
    emitHistory();
  };

  useEffect(() => {
    // wrapX:false — the single biggest thing the editor was doing wrong.
    //
    // OpenLayers defaults it to true, and the canvas vector renderer then loops
    // over world copies and redraws EVERY feature for each one
    // (renderer/canvas/VectorLayer.js: `endWorld`, plus extendX_ adding another
    // world on each side). So a zoomed-out world map painted all 3,662 regions
    // two or three times per frame. It looks like broken culling — an endless
    // horizontal band of map that never disappears — but it is the renderer
    // deliberately repeating the world sideways. There is nothing to repeat
    // vertically, which is why culling only ever LOOKED broken left-to-right.
    //
    // It is also what OL's own docs prescribe for this exact use case: "For
    // vector editing across the -180° and 180° meridians to work properly, this
    // should be set to false." So this is a correctness fix that happens to be
    // the performance fix.
    const regionSource = new VectorSource({ wrapX: false });
    const getZoom = (res) => mapRef.current?.getView().getZoomForResolution(res) ?? 3;

    // VectorImage, not Vector: the regions are ~3,662 separate filled+stroked
    // paths, and a plain vector layer re-rasterises every one of them on every
    // frame. That is the ~1.6s presentation delay after each interaction —
    // processing time is ~1ms, so it is the paint, not the JS. VectorImage
    // rasterises once and re-blits the image while panning, re-rendering only
    // when the view leaves the buffered image or the data changes.
    //
    // Safe for the tools: Draw/Modify/Snap bind to the SOURCE, not the layer, so
    // they still see full-resolution geometry. Translate and click-selection go
    // through forEachFeatureAtPixel, which VectorImage supports.
    //
    // imageRatio 2 renders twice the viewport, so short pans stay inside the
    // existing image instead of triggering a fresh rasterisation.
    const regionLayer = new VectorImageLayer({
      source: regionSource,
      imageRatio: 2,
      wrapX: false,
      style: makeRegionStyle({
        getTypesById: () => typesByIdRef.current,
        getColors: () => colorsRef.current,
        getSelectedIds: () => selectedIdsRef.current,
        getZoom,
      }),
      renderBuffer: 128,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
    });
    regionLayer.setZIndex(10);

    const labelLayer = new VectorLayer({
      source: regionSource,
      wrapX: false,
      declutter: true,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
      // Skip this whole layer below the zoom its labels appear at. The style
      // function already returned null there — but OpenLayers has to CALL it to
      // find that out, so a zoomed-out world paid 3,662 style calls plus a
      // declutter pass every frame to draw nothing. minZoom makes the renderer
      // skip the layer outright, and zoomed-out is exactly where the editor was
      // slowest, because that is when every region is on screen at once.
      minZoom: LABEL_MIN_ZOOM,
      style: (feature) => {
        const type = typesByIdRef.current[feature.get("typeId") || "land"];
        if (type && type.includedInLabels === false) return null;
        const name = feature.get("name");
        if (!name) return null;
        return labelStyle(name);
      },
    });
    labelLayer.setZIndex(20);

    // Point/symbol feature layer (cities). With ~70k cities available, dots and
    // labels are gated by zoom + prominence so the whole set never renders at once
    // (capitals/large cities appear first; everything shows when zoomed in).
    const pointSource = new VectorSource({ wrapX: false });
    const pointLayer = new VectorLayer({
      source: pointSource,
      wrapX: false,
      declutter: true,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
      style: (feature, resolution) => {
        const zoom = getZoom(resolution);
        const pop = feature.get("population") || 0;
        const tags = feature.get("tags") || [];
        const large = tags.includes("capital") || pop >= 1000000;
        const mid = pop >= 100000;
        if (!(large || (mid && zoom >= 3.5) || zoom >= 5)) return null;
        const size = large ? "large" : mid ? "mid" : "small";
        const showLabel = zoom >= 6 || (large && zoom >= 4.3) || (mid && zoom >= 5.3);
        return cityStyle(size, showLabel ? feature.get("name") || "" : "");
      },
    });
    pointLayer.setZIndex(30);

    const map = new Map({
      target: containerRef.current,
      controls: defaultControls({ rotate: false }),
      layers: [regionLayer, labelLayer, pointLayer],
      view: new View({ center: fromLonLat([0, 20]), zoom: 2.1, minZoom: 1, maxZoom: 20 }),
    });

    regionSourceRef.current = regionSource;
    regionLayerRef.current = regionLayer;
    labelLayerRef.current = labelLayer;
    pointSourceRef.current = pointSource;
    pointLayerRef.current = pointLayer;
    mapRef.current = map;
    requestAnimationFrame(() => map.updateSize());
    if (typeof window !== "undefined") window.__editorMap = map;

    const deleteFeature = (feature) => {
      if (!feature) return;
      const id = feature.getId();
      regionSource.removeFeature(feature);
      if (id != null && selectedIdsRef.current.has(id)) {
        onSelectionRef.current?.(Array.from(selectedIdsRef.current).filter((x) => x !== id));
      }
      notifyRegions();
      pushCmd({
        undo: () => regionSource.addFeature(feature),
        redo: () => regionSource.removeFeature(feature),
      });
    };

    // City/point feature under the cursor (generous tolerance — point markers
    // are small).
    const pointAtPixel = (pixel, tolerance = 8) => {
      let point = null;
      map.forEachFeatureAtPixel(
        pixel,
        (feature) => {
          point = feature;
          return true;
        },
        { layerFilter: (l) => l === pointLayerRef.current, hitTolerance: tolerance },
      );
      return point;
    };

    map.on("singleclick", (evt) => {
      const tool = activeToolRef.current;
      if (tool !== "select" && tool !== "delete" && tool !== "paint" && tool !== "feature" && tool !== "dissolve") return;
      let hit = null;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          hit = feature;
          return true;
        },
        { layerFilter: (l) => l === regionLayerRef.current, hitTolerance: 2 },
      );
      if (tool === "delete") {
        // Deleting works on cities too — a point hit wins over the region under it.
        const point = pointAtPixel(evt.pixel);
        if (point) {
          onFeatureRemoveRef.current?.(point.getId());
          return;
        }
        deleteFeature(hit);
        return;
      }
      if (tool === "paint") {
        if (hit) {
          const before = hit.get("owner") || null;
          // Trim, never case-fold: the owner IS the country's display name. This
          // line is why the six uppercasers had to go together — it re-folded
          // whatever the input handed it, so fixing the field alone looked fixed
          // and wasn't.
          const after = (paintOwnerRef.current || "").trim() || null;
          hit.set("owner", after);
          regionLayer.changed();
          labelLayer.changed();
          notifyRegions();
          pushCmd({ undo: () => hit.set("owner", before), redo: () => hit.set("owner", after) });
        }
        return;
      }
      if (tool === "feature") {
        // Clicking an existing city edits it (rename/resize/delete popup);
        // clicking empty map adds a new one right there.
        const point = pointAtPixel(evt.pixel);
        if (point) {
          onFeatureEditRef.current?.({ id: point.getId(), pixel: [...evt.pixel] });
          return;
        }
        const [lng, lat] = toLonLat(evt.coordinate);
        onFeatureCreateRef.current?.({
          coord: [Number(lng.toFixed(5)), Number(lat.toFixed(5))],
          regionId: hit ? hit.getId() : null,
          owner: hit ? hit.get("owner") || null : null,
          country: hit ? hit.get("country") || "" : "",
          pixel: [...evt.pixel],
        });
        return;
      }
      if (tool === "dissolve") {
        // Delete the border between the clicked region and the neighbour on the
        // other side of that border — i.e. merge the two into one region.
        if (!hit) return;
        const [px, py] = evt.pixel;
        let neighbor = null;
        for (const [dx, dy] of [[9, 0], [-9, 0], [0, 9], [0, -9], [7, 7], [-7, 7], [7, -7], [-7, -7], [14, 0], [-14, 0], [0, 14], [0, -14]]) {
          let f = null;
          map.forEachFeatureAtPixel([px + dx, py + dy], (ff) => { f = ff; return true; }, { layerFilter: (l) => l === regionLayerRef.current, hitTolerance: 1 });
          if (f && f !== hit) { neighbor = f; break; }
        }
        if (!neighbor) return;
        const oldGeom = hit.getGeometry().clone();
        try {
          hit.setGeometry(unionGeoms([hit.getGeometry(), neighbor.getGeometry()]));
        } catch (e) {
          console.warn("[editor] dissolve failed:", e);
          return;
        }
        regionSource.removeFeature(neighbor);
        regionLayer.changed();
        labelLayer.changed();
        onSelectionRef.current?.([hit.getId()]);
        notifyRegions();
        const mergedGeom = hit.getGeometry().clone();
        pushCmd({
          undo: () => { hit.setGeometry(oldGeom.clone()); regionSource.addFeature(neighbor); },
          redo: () => { hit.setGeometry(mergedGeom.clone()); regionSource.removeFeature(neighbor); },
        });
        return;
      }
      const hitId = hit ? hit.getId() : null;
      const oe = evt.originalEvent || {};
      const additive = oe.ctrlKey || oe.metaKey || oe.shiftKey;
      const cur = selectedIdsRef.current;
      let next;
      if (!hitId) next = additive ? Array.from(cur) : [];
      else if (additive)
        next = cur.has(hitId) ? Array.from(cur).filter((x) => x !== hitId) : [...cur, hitId];
      else next = [hitId];
      onSelectionRef.current?.(next);
    });

    // Double-click with Select = select the whole country. Picking one region at a
    // time to recolour or retag a country is the most common thing a map-maker does
    // here, and countries run to 35+ regions.
    //
    // Returning false is load-bearing: the map takes ol's default interactions,
    // which include DoubleClickZoom, and ol skips them entirely when a dblclick
    // listener returns false. Without it you'd select the country AND zoom into it.
    // singleclick needs no guard — ol holds it for 250ms and cancels it outright
    // when the second click arrives, so these two never both fire.
    map.on("dblclick", (evt) => {
      if (activeToolRef.current !== "select") return undefined; // let dbl-click zoom work
      let hit = null;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          hit = feature;
          return true;
        },
        { layerFilter: (l) => l === regionLayerRef.current, hitTolerance: 2 },
      );
      if (!hit) return undefined;
      const owner = hit.get("owner") || null;
      // Unowned land has no country to gather, so fall back to just this region —
      // "every unowned region on the map" is never what the double-click meant.
      const ids = owner
        ? regionSource.getFeatures().filter((f) => (f.get("owner") || null) === owner).map((f) => f.getId())
        : [hit.getId()];
      onSelectionRef.current?.(ids);
      return false;
    });

    map.on("pointermove", (evt) => {
      if (evt.dragging) return;
      const hit = map.hasFeatureAtPixel(evt.pixel, {
        layerFilter: (l) => l === regionLayerRef.current,
      });
      const tool = activeToolRef.current;
      if (tool === "lasso" || tool === "draw") {
        map.getTargetElement().style.cursor = "crosshair";
      } else if (tool === "feature" || tool === "delete") {
        // City-aware tools: pointer over an existing city (edit/remove target).
        const pointHit = map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (l) => l === pointLayerRef.current,
          hitTolerance: 8,
        });
        map.getTargetElement().style.cursor =
          pointHit || (hit && tool === "delete") ? "pointer" : tool === "feature" ? "crosshair" : "";
      } else {
        map.getTargetElement().style.cursor =
          hit && (tool === "select" || tool === "paint" || tool === "dissolve") ? "pointer" : "";
      }
    });

    const doUndo = () => {
      const c = undoStackRef.current.pop();
      if (!c) return;
      c.undo();
      redoStackRef.current.push(c);
      regionLayer.changed();
      labelLayer.changed();
      notifyRegions();
      emitHistory();
    };
    const doRedo = () => {
      const c = redoStackRef.current.pop();
      if (!c) return;
      c.redo();
      undoStackRef.current.push(c);
      regionLayer.changed();
      labelLayer.changed();
      notifyRegions();
      emitHistory();
    };

    const onKeyDown = (e) => {
      const ae = document.activeElement;
      const typing = ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
      // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
        if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); return; }
      }
      // Delete / Backspace removes the current selection
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (typing) return;
      const ids = Array.from(selectedIdsRef.current);
      if (!ids.length) return;
      e.preventDefault();
      const removed = [];
      for (const id of ids) {
        const f = regionSource.getFeatureById(id);
        if (f) {
          regionSource.removeFeature(f);
          removed.push(f);
        }
      }
      onSelectionRef.current?.([]);
      notifyRegions();
      if (removed.length) {
        pushCmd({
          undo: () => removed.forEach((f) => regionSource.addFeature(f)),
          redo: () => removed.forEach((f) => regionSource.removeFeature(f)),
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);

    const onResize = () => map.updateSize();
    window.addEventListener("resize", onResize);

    let alive = true;
    if (seedKind === "import-world") {
      loadSeedFeatures().then((features) => {
        if (!alive || !regionSourceRef.current) return;
        regionSourceRef.current.addFeatures(features);
        onRegionCount?.(regionSourceRef.current.getFeatures().length);
      });
    } else {
      onRegionCount?.(0);
    }

    const summarize = (f) => ({
      id: f.getId(),
      name: f.get("name") || "",
      owner: f.get("owner") || null,
      typeId: f.get("typeId") || "land",
      country: f.get("country") || "",
      claimants: f.get("claimants") || [],
    });
    onReady?.({
      map,
      regionSource,
      regionLayer,
      labelLayer,
      fitToData: () => {
        const extent = regionSource.getExtent();
        if (extent && extent[0] !== Infinity) {
          map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 300 });
        }
      },
      zoomToRegion: (id) => {
        const f = regionSource.getFeatureById(id);
        if (f) map.getView().fit(f.getGeometry().getExtent(), { padding: [80, 80, 80, 80], duration: 350, maxZoom: 8 });
      },
      zoomToSelection: (ids) => {
        const feats = (ids || []).map((id) => regionSource.getFeatureById(id)).filter(Boolean);
        if (!feats.length) return;
        let ext = feats[0].getGeometry().getExtent().slice();
        for (const f of feats) {
          const e = f.getGeometry().getExtent();
          ext = [Math.min(ext[0], e[0]), Math.min(ext[1], e[1]), Math.max(ext[2], e[2]), Math.max(ext[3], e[3])];
        }
        map.getView().fit(ext, { padding: [80, 80, 80, 80], duration: 350, maxZoom: 8 });
      },
      setRegionAttrs: (ids, patch) => {
        const undos = [];
        for (const id of ids) {
          const f = regionSource.getFeatureById(id);
          if (!f) continue;
          const before = {};
          if ("owner" in patch) { before.owner = f.get("owner") || null; f.set("owner", patch.owner || null); }
          if ("typeId" in patch) { before.typeId = f.get("typeId"); f.set("typeId", patch.typeId); }
          if ("name" in patch) { before.name = f.get("name"); f.set("name", patch.name); }
          if ("claimants" in patch) { before.claimants = f.get("claimants") || null; f.set("claimants", patch.claimants?.length ? patch.claimants : null); }
          undos.push([f, before]);
        }
        regionLayer.changed();
        labelLayer.changed();
        notifyRegions();
        if (undos.length) {
          const after = { ...patch };
          pushCmd({
            undo: () => undos.forEach(([f, b]) => Object.keys(b).forEach((k) => f.set(k, b[k]))),
            redo: () => undos.forEach(([f]) => {
              if ("owner" in after) f.set("owner", after.owner || null);
              if ("typeId" in after) f.set("typeId", after.typeId);
              if ("name" in after) f.set("name", after.name);
              if ("claimants" in after) f.set("claimants", after.claimants?.length ? after.claimants : null);
            }),
          });
        }
      },
      deleteRegions: (ids) => {
        const removed = [];
        for (const id of ids) {
          const f = regionSource.getFeatureById(id);
          if (f) {
            regionSource.removeFeature(f);
            removed.push(f);
          }
        }
        onSelectionRef.current?.([]);
        notifyRegions();
        if (removed.length) {
          pushCmd({
            undo: () => removed.forEach((f) => regionSource.addFeature(f)),
            redo: () => removed.forEach((f) => regionSource.removeFeature(f)),
          });
        }
      },
      mergeRegions: (ids) => {
        const feats = ids.map((id) => regionSource.getFeatureById(id)).filter(Boolean);
        if (feats.length < 2) return;
        const target = feats[0];
        const oldGeom = target.getGeometry().clone();
        const removed = feats.slice(1);
        let mergedGeom;
        try {
          mergedGeom = unionGeoms(feats.map((f) => f.getGeometry()));
          target.setGeometry(mergedGeom);
        } catch (e) {
          console.warn("[editor] merge failed:", e);
          return;
        }
        removed.forEach((f) => regionSource.removeFeature(f));
        regionLayer.changed();
        labelLayer.changed();
        onSelectionRef.current?.([target.getId()]);
        notifyRegions();
        pushCmd({
          undo: () => {
            target.setGeometry(oldGeom.clone());
            removed.forEach((f) => regionSource.addFeature(f));
          },
          redo: () => {
            target.setGeometry(mergedGeom.clone());
            removed.forEach((f) => regionSource.removeFeature(f));
          },
        });
      },
      copyRegions: (ids) => {
        const res = map.getView().getResolution() || 1;
        const off = res * 24;
        const createdFeats = [];
        for (const id of ids) {
          const f = regionSource.getFeatureById(id);
          if (!f) continue;
          const nf = new Feature({ geometry: translatedClone(f.getGeometry(), off, -off) });
          nf.setId(newId());
          nf.setProperties({
            typeId: f.get("typeId") || "land",
            owner: f.get("owner") || null,
            name: (f.get("name") || "Region") + " copy",
            gid0: f.get("gid0") || "",
            country: f.get("country") || "",
            claimants: f.get("claimants") || null,
          });
          regionSource.addFeature(nf);
          createdFeats.push(nf);
        }
        onSelectionRef.current?.(createdFeats.map((f) => f.getId()));
        notifyRegions();
        if (createdFeats.length) {
          pushCmd({
            undo: () => createdFeats.forEach((f) => regionSource.removeFeature(f)),
            redo: () => createdFeats.forEach((f) => regionSource.addFeature(f)),
          });
        }
      },
      getRegionSummary: (id) => {
        const f = regionSource.getFeatureById(id);
        return f ? summarize(f) : null;
      },
      // Every country currently on the map, sorted. Backs the Country field's
      // suggestions, so re-owning a region offers the names that already exist
      // rather than inviting a near-miss that forks a second country.
      listOwners: () => {
        const owners = new Set();
        for (const f of regionSource.getFeatures()) {
          const owner = f.get("owner");
          if (owner) owners.add(String(owner));
        }
        return [...owners].sort((a, b) => a.localeCompare(b));
      },
      queryRegions: (text, limit = 200) => {
        const q = (text || "").trim().toLowerCase();
        const out = [];
        for (const f of regionSource.getFeatures()) {
          if (q) {
            // `country` is gone from region props — owner IS the country name now.
            const hay = `${f.getId()} ${f.get("name") || ""} ${f.get("owner") || ""}`.toLowerCase();
            if (!hay.includes(q)) continue;
          }
          out.push(summarize(f));
          if (out.length >= limit) break;
        }
        return out;
      },
      countByType: () => {
        const m = {};
        for (const f of regionSource.getFeatures()) {
          const t = f.get("typeId") || "land";
          m[t] = (m[t] || 0) + 1;
        }
        return m;
      },
      setLayerVisibility: (key, visible) => {
        if (key === "regions") regionLayer.setVisible(visible);
        else if (key === "labels") labelLayer.setVisible(visible);
        else if (key === "features") pointLayer.setVisible(visible);
      },
      locateFeature: (coord) => {
        if (Array.isArray(coord)) map.getView().animate({ center: fromLonLat(coord), zoom: 6, duration: 350 });
      },
      // Serialize all region geometry to a GeoJSON FeatureCollection (WGS84) for
      // saving/exporting; load one back into the source.
      // writeFeaturesObject, NOT JSON.parse(writeFeatures(...)). OL's writeFeatures
      // is literally JSON.stringify(writeFeaturesObject(...)) (format/JSONFeature.js),
      // so parsing its result built an ~83MB string at z9 and immediately tore it
      // back apart — to reach the object writeFeaturesObject already had. And this
      // runs on the 2s autosave, so the editor did that on a loop while you worked;
      // saveDocument then stringifies the payload anyway, making it string -> objects
      // -> string. That churn is what ran the tab out of memory.
      serializeRegions: () =>
        new GeoJSON().writeFeaturesObject(regionSource.getFeatures(), {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
          decimals: 5,
        }),
      loadRegions: (fc) => {
        const fmt = new GeoJSON();
        regionSource.clear();
        if (fc && Array.isArray(fc.features)) {
          const feats = fmt.readFeatures(fc, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          });
          for (const f of feats) {
            const p = f.getProperties();
            if (f.getId() == null && p.id != null) f.setId(String(p.id));
            if (f.get("typeId") == null) f.set("typeId", "land");
          }
          regionSource.addFeatures(feats);
        }
        regionLayer.changed();
        labelLayer.changed();
        notifyRegions();
      },
      reseedWorld: () => {
        loadSeedFeatures().then((feats) => {
          regionSource.clear();
          regionSource.addFeatures(feats);
          regionLayer.changed();
          labelLayer.changed();
          notifyRegions();
        });
      },
      // Seed the modern world, then stamp a scenario's ownership overrides on
      // top — how a scenario WITHOUT custom geometry opens in the editor (its
      // tier-1 map is exactly "stock world + these overrides").
      reseedWorldWithOwners: (overrides = {}) => {
        loadSeedFeatures().then((feats) => {
          regionSource.clear();
          for (const f of feats) {
            const id = f.getId();
            if (id != null && overrides[id] !== undefined) f.set("owner", overrides[id] || null);
          }
          regionSource.addFeatures(feats);
          regionLayer.changed();
          labelLayer.changed();
          notifyRegions();
        });
      },
      undo: () => doUndo(),
      redo: () => doRedo(),
      restyle: () => {
        regionLayer.changed();
        labelLayer.changed();
      },
    });

    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      map.setTarget(null);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- mount/remove editing interactions when the active tool changes ------
  useEffect(() => {
    const map = mapRef.current;
    const source = regionSourceRef.current;
    const layer = regionLayerRef.current;
    if (!map || !source) return;

    // Split the region under a drawn line into two (or more) pieces; the largest
    // piece keeps the original id/attributes, the rest become new regions.
    // Split every region the freehand path FULLY crosses, following the exact
    // cursor path. A region is only cut where the path enters through one border
    // and exits through another; the path's dangling start/end inside a region is
    // ignored, so no half-border is ever left partway through a region.

    // Lasso: select every region whose interior falls inside the drawn shape.
    const selectWithinPolygon = (poly) => {
      const ids = [];
      source.forEachFeatureInExtent(poly.getExtent(), (f) => {
        const pt = interiorPoint(f.getGeometry());
        if (pt && poly.intersectsCoordinate(pt)) ids.push(f.getId());
      });
      onSelectionRef.current?.(ids);
    };

    const added = [];
    if (activeTool === "draw") {
      // trace: click a point on an existing border and the sketch FOLLOWS that
      // border as the cursor moves, instead of making the map-maker click every
      // vertex along a coastline. Click again to leave the border. Moving back
      // along the traced path un-traces it, so overshooting is just backing up.
      //
      // traceSource is the region source, so a new region snaps to its neighbours
      // and shares their exact vertices — which is what keeps borders gap-free.
      // Snap is still added below: trace follows a border once you are ON it,
      // Snap is what gets you onto it.
      const draw = new Draw({ source, type: "Polygon", trace: true, traceSource: source });
      draw.on("drawend", (e) => {
        const f = e.feature;
        f.setId(newId());
        if (f.get("typeId") == null) f.set("typeId", defaultTypeIdRef.current || "land");
        if (f.get("owner") === undefined) f.set("owner", null);
        if (!f.get("name")) f.set("name", "New Region");
        if (f.get("gid0") == null) f.set("gid0", "");
        if (f.get("country") == null) f.set("country", "");

        // Take the new region's land OUT of whatever it was drawn over. Two
        // regions covering the same ground is not a cosmetic problem: the place
        // is then owned twice, only the last-rendered owner is visible, and the
        // exported ownership map disagrees with the map the author was looking
        // at. Drawing inside a region leaves a hole in it; drawing across an
        // edge takes a bite; drawing over one entirely deletes it.
        const cutter = f.getGeometry();
        const carved = [];
        // Ask the source's R-tree for the handful of regions whose extents meet the
        // new one, rather than walking all 3,662 and running a full boolean op on
        // each. overlaps() is polygon-clipping, which builds sweep-line structures
        // per call — doing that against every region on the map allocated hard
        // enough to run the tab out of memory once the seed went to z9 and each
        // polygon carried ~1,116 vertices instead of ~156. The extent query is an
        // index lookup and rejects everything that cannot possibly touch.
        const candidates = [];
        source.forEachFeatureIntersectingExtent(cutter.getExtent(), (other) => {
          if (other !== f) candidates.push(other);
        });
        for (const other of candidates) {
          const geom = other.getGeometry();
          if (!geom || !overlaps(geom, cutter)) continue;
          const before = geom.clone();
          const after = subtractFrom(geom, cutter);
          if (!after) {
            // Fully covered: nothing of it is left to own.
            source.removeFeature(other);
            carved.push({ feature: other, before, after: null });
          } else {
            other.setGeometry(after);
            // Mark it edited so the exporter ships this geometry rather than
            // assuming the stock GADM shape still describes it.
            other.set("edited", true);
            carved.push({ feature: other, before, after: after.clone() });
          }
        }
        if (carved.length) {
          layer.changed();
          labelLayerRef.current?.changed();
        }

        // defer so drawend finishes adding to the source before we count
        setTimeout(notifyRegions, 0);
        pushCmd({
          undo: () => {
            source.removeFeature(f);
            for (const c of carved) {
              c.feature.setGeometry(c.before.clone());
              if (!c.after) source.addFeature(c.feature);
            }
            layer.changed();
          },
          redo: () => {
            source.addFeature(f);
            for (const c of carved) {
              if (!c.after) source.removeFeature(c.feature);
              else c.feature.setGeometry(c.after.clone());
            }
            layer.changed();
          },
        });
      });
      added.push(draw, new Snap({ source })); // Snap last so it sees events first
    } else if (activeTool === "modify") {
      const modify = new Modify({ source });
      modify.on("modifyend", notifyRegions);
      added.push(modify, new Snap({ source }));
    } else if (activeTool === "move") {
      const translate = new Translate({ layers: [layer], hitTolerance: 2 });
      translate.on("translateend", notifyRegions);
      added.push(translate);
    } else if (activeTool === "lasso") {
      // freehand circle/lasso: drag to enclose an area, release to select the
      // land regions inside it.
      const draw = new Draw({ type: "Polygon", features: new Collection(), freehand: true });
      draw.on("drawend", (e) => selectWithinPolygon(e.feature.getGeometry()));
      added.push(draw);
    }

    added.forEach((i) => map.addInteraction(i));
    interactionsRef.current = added;
    return () => {
      added.forEach((i) => map.removeInteraction(i));
      interactionsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  useEffect(() => {
    selectedIdsRef.current = new Set(selectionIds || []);
    regionLayerRef.current?.changed();
  }, [selectionIds]);

  useEffect(() => {
    typesByIdRef.current = toTypesById(types);
    colorsRef.current = colors || {};
    regionLayerRef.current?.changed();
    labelLayerRef.current?.changed();
  }, [types, colors]);

  // Rebuild the point/feature layer whenever the features list changes.
  useEffect(() => {
    const src = pointSourceRef.current;
    if (!src) return;
    src.clear();
    for (const f of features) {
      if (!Array.isArray(f.coord)) continue;
      const feat = new Feature({ geometry: new Point(fromLonLat(f.coord)) });
      feat.setId(f.id);
      feat.setProperties({ name: f.name, symbol: f.symbol, type: f.type, owner: f.owner, tags: f.tags, population: f.population || 0 });
      src.addFeature(feat);
    }
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    // A custom uploaded map (image or vector) replaces the basemap — don't load
    // any ESRI tiles at all while it's active, to save the requests.
    const customActive = customBackground?.kind === "image" || customBackground?.kind === "vector";
    const esri = customActive ? null : editorBasemapById(basemap);
    let base = null;
    if (esri) {
      base = new TileLayer({
        source: new XYZ({ url: esriXyzUrl(esri.service), maxZoom: esri.maxZoom, crossOrigin: "anonymous" }),
      });
    } else if (!customActive && (basemap === "osm" || basemap === "light")) {
      base = new TileLayer({ source: new OSM(), opacity: basemap === "light" ? 0.85 : 1 });
    }
    if (base) {
      base.setZIndex(0);
      map.addLayer(base);
      baseLayerRef.current = base;
    }
    const el = map.getTargetElement();
    if (el) el.style.background = customActive ? "#0b1a2b" : BASEMAP_BG[basemap] || "#0b1020";
  }, [basemap, customBackground]);

  // Custom uploaded background: a georeferenced vector/raster layer beneath the
  // regions, or a plain image placed with a draggable/resizable frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !customBackground) return undefined;
    const bg = customBackground;

    if (bg.kind === "vector" || bg.kind === "raster") {
      bg.layer.setZIndex(5);
      map.addLayer(bg.layer);
      if (bg.kind === "vector") {
        const ex = bg.layer.getSource().getExtent();
        if (ex && Number.isFinite(ex[0]) && ex[0] !== Infinity) {
          map.getView().fit(ex, { padding: [60, 60, 60, 60], duration: 300, maxZoom: 10 });
        }
        // Skip re-emitting a restored background (persisted) — only fresh uploads
        // need to be written into the document.
        if (!bg.persisted) onCustomBackgroundSaveRef.current?.({ kind: "vector", geojson: vectorLayerToGeoJSON(bg.layer) });
      }
      return () => {
        map.removeLayer(bg.layer);
        bg.cleanup?.();
      };
    }

    // Plain image: stretch it across the whole world so it fully replaces the
    // basemap (a fantasy map you draw regions on). No placement frame — it always
    // covers the entire map; the regions/labels sit above it (z >= 10).
    const imageLayer = new ImageLayer({
      source: new ImageStatic({ url: bg.url, imageExtent: WORLD_EXTENT_3857, projection: "EPSG:3857" }),
    });
    imageLayer.setZIndex(5);
    map.addLayer(imageLayer);
    // Only fresh uploads write back into the document; a restored (persisted)
    // background is already in the doc/scenario, so don't re-dirty it on open.
    if (!bg.persisted) onCustomBackgroundSaveRef.current?.({ kind: "image", dataUrl: bg.dataUrl });
    return () => {
      map.removeLayer(imageLayer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customBackground]);

  // ---- Reference image (tracing aid) ---------------------------------------
  // A semi-transparent image ABOVE the region fills (z40) that the map-maker
  // aligns a source map against and traces borders over. Never persisted,
  // never exported — its extent is session state in a ref.
  useEffect(() => {
    const map = mapRef.current;
    const dataUrl = referenceImage?.dataUrl;
    if (!map || !dataUrl) {
      refImageExtentRef.current = null;
      return undefined;
    }

    // Place (or re-place, when the nonce bumps) at the view centre, spanning
    // 60% of the visible width at the image's own aspect ratio.
    if (!refImageExtentRef.current || referencePlaceNonce > 0) {
      const view = map.getView();
      const center = view.getCenter();
      const resolution = view.getResolution();
      const size = map.getSize() || [1024, 768];
      const width = size[0] * resolution * 0.6;
      const height = width / (referenceImage.aspect || 1.5);
      refImageExtentRef.current = [
        center[0] - width / 2,
        center[1] - height / 2,
        center[0] + width / 2,
        center[1] + height / 2,
      ];
    }

    const layer = new ImageLayer({
      source: new ImageStatic({ url: dataUrl, imageExtent: refImageExtentRef.current, projection: "EPSG:3857" }),
    });
    layer.setZIndex(40);
    layer.setOpacity(referenceImage.visible === false ? 0 : (referenceImage.opacity ?? 0.5));
    map.addLayer(layer);
    refImageLayerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      refImageLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceImage?.dataUrl, referencePlaceNonce]);

  useEffect(() => {
    refImageLayerRef.current?.setOpacity(
      referenceImage?.visible === false ? 0 : (referenceImage?.opacity ?? 0.5),
    );
  }, [referenceImage?.opacity, referenceImage?.visible]);

  // The adjust frame: a dashed outline + corner handles, and a pointer
  // interaction where dragging a corner resizes (opposite corner anchored,
  // free aspect so a distorted source map can still be aligned) and dragging
  // inside moves. Mounted only while the Reference panel is open, and added
  // last so it wins the event race over the editing interactions.
  useEffect(() => {
    const map = mapRef.current;
    const dataUrl = referenceImage?.dataUrl;
    if (!map || !dataUrl || !referenceAdjust) return undefined;

    const frameSource = new VectorSource();
    refImageFrameSourceRef.current = frameSource;
    const frameLayer = new VectorLayer({
      source: frameSource,
      style: (feature) =>
        feature.getGeometry().getType() === "Point"
          ? new Style({
              image: new RegularShape({
                points: 4,
                radius: 7,
                angle: Math.PI / 4,
                fill: new Fill({ color: "#22d3ee" }),
                stroke: new Stroke({ color: "#083344", width: 1.5 }),
              }),
            })
          : new Style({ stroke: new Stroke({ color: "#22d3ee", width: 1.5, lineDash: [6, 6] }) }),
    });
    frameLayer.setZIndex(41);
    map.addLayer(frameLayer);

    const cornersOf = (extent) => [
      [extent[0], extent[1]],
      [extent[2], extent[1]],
      [extent[2], extent[3]],
      [extent[0], extent[3]],
    ];
    const redrawFrame = () => {
      const extent = refImageExtentRef.current;
      frameSource.clear();
      if (!extent) return;
      frameSource.addFeature(new Feature({ geometry: polygonFromExtent(extent) }));
      for (const corner of cornersOf(extent)) {
        frameSource.addFeature(new Feature({ geometry: new Point(corner) }));
      }
    };
    const refreshImage = () => {
      refImageLayerRef.current?.setSource(
        new ImageStatic({ url: dataUrl, imageExtent: refImageExtentRef.current, projection: "EPSG:3857" }),
      );
    };
    redrawFrame();

    let drag = null; // { mode: "move", last } | { mode: "resize", anchor }
    const interaction = new PointerInteraction({
      handleDownEvent: (event) => {
        const extent = refImageExtentRef.current;
        if (!extent) return false;
        const corners = cornersOf(extent);
        for (let index = 0; index < corners.length; index += 1) {
          const pixel = map.getPixelFromCoordinate(corners[index]);
          const dx = pixel[0] - event.pixel[0];
          const dy = pixel[1] - event.pixel[1];
          if (Math.sqrt(dx * dx + dy * dy) <= 11) {
            drag = { mode: "resize", anchor: corners[(index + 2) % 4] };
            return true;
          }
        }
        const [x, y] = event.coordinate;
        if (x >= extent[0] && x <= extent[2] && y >= extent[1] && y <= extent[3]) {
          drag = { mode: "move", last: event.coordinate };
          return true;
        }
        return false;
      },
      handleDragEvent: (event) => {
        const extent = refImageExtentRef.current;
        if (!drag || !extent) return;
        if (drag.mode === "move") {
          const dx = event.coordinate[0] - drag.last[0];
          const dy = event.coordinate[1] - drag.last[1];
          drag.last = event.coordinate;
          refImageExtentRef.current = [extent[0] + dx, extent[1] + dy, extent[2] + dx, extent[3] + dy];
        } else {
          const [ax, ay] = drag.anchor;
          const [cx, cy] = event.coordinate;
          // A collapsed extent breaks ImageStatic — enforce a minimum edge.
          const minEdge = map.getView().getResolution() * 8;
          const x1 = Math.min(ax, cx);
          const y1 = Math.min(ay, cy);
          refImageExtentRef.current = [
            x1,
            y1,
            Math.max(Math.max(ax, cx), x1 + minEdge),
            Math.max(Math.max(ay, cy), y1 + minEdge),
          ];
        }
        redrawFrame();
        refreshImage();
      },
      handleUpEvent: () => {
        drag = null;
        return false;
      },
    });
    map.addInteraction(interaction);

    return () => {
      map.removeInteraction(interaction);
      map.removeLayer(frameLayer);
      refImageFrameSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceAdjust, referenceImage?.dataUrl]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
};

export default OlMap;
