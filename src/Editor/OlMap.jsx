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
import CircleStyle from "ol/style/Circle";
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
import {
  unionGeoms,
  translatedClone,
  subtractFrom,
  overlaps,
  planarGeometryArea,
  enclosedGapGeoms,
  overlapGeoms,
} from "./geometry.js";

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


// Manual-override handles are intentionally larger than OpenLayers' defaults.
// The old editor exposed every microscopic vertex on the map and made accurate
// surgery harder than the geometry itself. R2 edits selected regions only and
// gives the handles enough hit area to be usable at human zoom levels.
const manualVertexStyle = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: "rgba(59,130,246,0.95)" }),
    stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 2 }),
  }),
});

// Shared-border precision aid. The cyan halo is preview-only and never exported.
const sharedBorderAssistStyle = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: "rgba(34,211,238,0.20)" }),
    stroke: new Stroke({ color: "rgba(34,211,238,1)", width: 2.5 }),
  }),
});

// R2.7 drag-paint preview. Recolouring the 4k+ region VectorImage layer on
// every pointer event is expensive, so the stroke is previewed in this tiny
// overlay and committed to the real features only when the pointer is released.
const paintPreviewStyleCache = new globalThis.Map();
const paintPreviewStyleFor = (owner, colors) => {
  const rgb = owner ? colors?.[owner] : null;
  const key = rgb ? `rgb:${rgb.join(",")}` : owner ? `owner:${owner}` : "erase";
  if (!paintPreviewStyleCache.has(key)) {
    const fill = rgb
      ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.70)`
      : owner
        ? "rgba(96,165,250,0.68)"
        : "rgba(15,23,42,0.72)";
    paintPreviewStyleCache.set(
      key,
      new Style({
        fill: new Fill({ color: fill }),
        stroke: new Stroke({ color: "rgba(255,255,255,0.88)", width: 1.25 }),
      }),
    );
  }
  return paintPreviewStyleCache.get(key);
};

const cloneCoords = (value) => (Array.isArray(value) ? value.map(cloneCoords) : value);

const closestPointOnSegment = (p, a, b) => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const vv = vx * vx + vy * vy;
  const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
  const point = [a[0] + t * vx, a[1] + t * vy];
  return { point, distance: Math.hypot(p[0] - point[0], p[1] - point[1]), t };
};

const ringRefs = (geom) => {
  if (!geom) return [];
  const type = geom.getType?.();
  const coords = geom.getCoordinates?.() || [];
  if (type === "Polygon") return coords.map((ring, ringIndex) => ({ path: [ringIndex], ring }));
  if (type === "MultiPolygon") {
    const rows = [];
    coords.forEach((poly, polygonIndex) =>
      poly.forEach((ring, ringIndex) => rows.push({ path: [polygonIndex, ringIndex], ring })),
    );
    return rows;
  }
  return [];
};

const getRingAtPath = (coords, type, path) =>
  type === "Polygon" ? coords[path[0]] : coords[path[0]]?.[path[1]];

const nearestBoundarySegment = (geom, point) => {
  let best = null;
  for (const row of ringRefs(geom)) {
    const ring = row.ring || [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const hit = closestPointOnSegment(point, ring[i], ring[i + 1]);
      if (!best || hit.distance < best.distance) {
        best = { ...hit, path: row.path, index: i, a: ring[i], b: ring[i + 1] };
      }
    }
  }
  return best;
};

const sharedBorderPoint = (features, point, tolerance) => {
  if (!Array.isArray(features) || features.length !== 2 || !point) return null;
  const a = nearestBoundarySegment(features[0]?.getGeometry?.(), point);
  const b = nearestBoundarySegment(features[1]?.getGeometry?.(), point);
  if (!a || !b || a.distance > tolerance || b.distance > tolerance) return null;
  return {
    point: [(a.point[0] + b.point[0]) / 2, (a.point[1] + b.point[1]) / 2],
    a,
    b,
  };
};

const nearestBoundaryVertex = (geom, point) => {
  let best = null;
  for (const row of ringRefs(geom)) {
    const ring = row.ring || [];
    for (let i = 0; i < Math.max(0, ring.length - 1); i += 1) {
      const coord = ring[i];
      const distance = Math.hypot(point[0] - coord[0], point[1] - coord[1]);
      if (!best || distance < best.distance) best = { distance, path: row.path, index: i, coord };
    }
  }
  return best;
};

const setRingVertex = (ring, index, coord) => {
  if (!ring?.length || index < 0 || index >= ring.length) return false;
  ring[index] = coord.slice();
  // Polygon rings repeat vertex 0 as their final coordinate. Keep closure exact.
  if (index === 0) ring[ring.length - 1] = coord.slice();
  if (index === ring.length - 1) ring[0] = coord.slice();
  return true;
};

const weldPointIntoFeature = (feature, point, tolerance) => {
  const geom = feature?.getGeometry?.();
  if (!geom || !point) return false;
  const type = geom.getType?.();
  if (type !== "Polygon" && type !== "MultiPolygon") return false;

  const coords = cloneCoords(geom.getCoordinates());
  const vertex = nearestBoundaryVertex(geom, point);
  if (vertex && vertex.distance <= tolerance * 0.38) {
    const ring = getRingAtPath(coords, type, vertex.path);
    if (!setRingVertex(ring, vertex.index, point)) return false;
    geom.setCoordinates(coords);
    feature.set("edited", true);
    return true;
  }

  const segment = nearestBoundarySegment(geom, point);
  if (!segment || segment.distance > tolerance) return false;
  const ring = getRingAtPath(coords, type, segment.path);
  if (!ring) return false;
  ring.splice(segment.index + 1, 0, point.slice());
  geom.setCoordinates(coords);
  feature.set("edited", true);
  return true;
};

const removeSharedVertexNear = (feature, point, tolerance) => {
  const geom = feature?.getGeometry?.();
  if (!geom || !point) return false;
  const type = geom.getType?.();
  if (type !== "Polygon" && type !== "MultiPolygon") return false;
  const vertex = nearestBoundaryVertex(geom, point);
  if (!vertex || vertex.distance > tolerance) return false;

  const coords = cloneCoords(geom.getCoordinates());
  const ring = getRingAtPath(coords, type, vertex.path);
  if (!ring || ring.length <= 4) return false;
  let index = vertex.index;
  // Removing the closure duplicate means removing vertex zero instead.
  if (index === ring.length - 1) index = 0;
  ring.splice(index, 1);
  if (index === 0) ring[ring.length - 1] = ring[0].slice();
  geom.setCoordinates(coords);
  feature.set("edited", true);
  return true;
};

const topologyDiagnosticStyle = (feature) => {
  const kind = feature.get("kind");
  const gap = kind === "gap";
  return new Style({
    fill: new Fill({ color: gap ? "rgba(245,158,11,0.42)" : "rgba(239,68,68,0.42)" }),
    stroke: new Stroke({ color: gap ? "rgba(251,191,36,1)" : "rgba(248,113,113,1)", width: 2 }),
  });
};

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
  paintOnlyOwner = "*",
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
  const topologySourceRef = useRef(null);
  const topologyLayerRef = useRef(null);
  const importPreviewLayerRef = useRef(null);
  const paintPreviewSourceRef = useRef(null);
  const paintPreviewLayerRef = useRef(null);
  const topologyAnalysisRef = useRef(null);
  const analyzeTopologyRef = useRef(null);
  const borderAssistSourceRef = useRef(null);
  const borderAssistLayerRef = useRef(null);
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
  // The live Draw interaction and the points the map-maker has actually CLICKED
  // during the current sketch. Tracked here rather than read off the sketch
  // geometry because trace mode appends a run of vertices per click: "the point
  // you just placed" means the click, not each traced vertex.
  const activeDrawRef = useRef(null);
  const placedPointsRef = useRef([]);
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
  const paintOnlyOwnerRef = useRef(paintOnlyOwner);
  const onSelectionRef = useRef(onSelectionChange);
  const onRegionsChangedRef = useRef(onRegionsChanged);
  const selectionKey = (selectionIds || []).join("|");

  typesByIdRef.current = toTypesById(types);
  colorsRef.current = colors || {};
  activeToolRef.current = activeTool;
  defaultTypeIdRef.current = defaultTypeId;
  paintOwnerRef.current = paintOwner;
  paintOnlyOwnerRef.current = paintOnlyOwner;
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

    // Province-raster alignment preview. It is display-only and never becomes
    // part of the document. The importer swaps the source as the geographic
    // bounds change, then hides it before the vector regions are committed.
    const importPreviewLayer = new ImageLayer({ visible: false, opacity: 0.46 });
    importPreviewLayer.setZIndex(55);

    // Drag-paint preview. Only the regions touched by the current stroke are
    // rendered here, so painting a 4,500-region imported map stays responsive.
    const paintPreviewSource = new VectorSource({ wrapX: false });
    const paintPreviewLayer = new VectorLayer({
      source: paintPreviewSource,
      wrapX: false,
      style: (feature) => paintPreviewStyleFor(feature.get("__paintOwner") || null, colorsRef.current),
      updateWhileInteracting: true,
      updateWhileAnimating: false,
    });
    paintPreviewLayer.setZIndex(58);

    // Selection-scoped topology diagnostics. Nothing here participates in save
    // or export: yellow/red geometry is a preview overlay only.
    const topologySource = new VectorSource({ wrapX: false });
    const topologyLayer = new VectorLayer({
      source: topologySource,
      wrapX: false,
      style: topologyDiagnosticStyle,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
    });
    topologyLayer.setZIndex(60);

    const borderAssistSource = new VectorSource({ wrapX: false });
    const borderAssistLayer = new VectorLayer({
      source: borderAssistSource,
      wrapX: false,
      style: sharedBorderAssistStyle,
      updateWhileInteracting: true,
      updateWhileAnimating: false,
    });
    borderAssistLayer.setZIndex(70);

    const map = new Map({
      target: containerRef.current,
      controls: defaultControls({ rotate: false }),
      layers: [regionLayer, labelLayer, pointLayer, importPreviewLayer, paintPreviewLayer, topologyLayer, borderAssistLayer],
      view: new View({ center: fromLonLat([0, 20]), zoom: 2.1, minZoom: 1, maxZoom: 20 }),
    });

    regionSourceRef.current = regionSource;
    regionLayerRef.current = regionLayer;
    labelLayerRef.current = labelLayer;
    pointSourceRef.current = pointSource;
    pointLayerRef.current = pointLayer;
    topologySourceRef.current = topologySource;
    topologyLayerRef.current = topologyLayer;
    importPreviewLayerRef.current = importPreviewLayer;
    paintPreviewSourceRef.current = paintPreviewSource;
    paintPreviewLayerRef.current = paintPreviewLayer;
    borderAssistSourceRef.current = borderAssistSource;
    borderAssistLayerRef.current = borderAssistLayer;
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
        // R2.7 paint is handled by a PointerInteraction so a click and a whole
        // drag stroke use the same one-operation Undo/Redo transaction.
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
      if (tool === "lasso" || tool === "draw" || tool === "modify" || tool === "paint") {
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
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          // Mid-sketch, Ctrl+Z belongs to the sketch. Undoing a whole region
          // operation out from under an unfinished outline is never what the
          // map-maker meant, and there is no way back to the half-drawn shape.
          if (activeDrawRef.current && placedPointsRef.current.length > 0) {
            activeDrawRef.current.removeLastPoint();
            placedPointsRef.current.pop();
            return;
          }
          doUndo();
          return;
        }
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


    const nameOf = (f) => String(f?.get("name") || f?.getId?.() || "region");
    const expandExtent = (extent, pad) => [extent[0] - pad, extent[1] - pad, extent[2] + pad, extent[3] + pad];

    const pointSegmentDistance = (p, a, b) => {
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const wx = p[0] - a[0];
      const wy = p[1] - a[1];
      const vv = vx * vx + vy * vy;
      const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
      const x = a[0] + t * vx;
      const y = a[1] + t * vy;
      return Math.hypot(p[0] - x, p[1] - y);
    };

    const geometryRings = (geom) => {
      if (!geom) return [];
      const type = geom.getType?.();
      const coords = geom.getCoordinates?.() || [];
      if (type === "Polygon") return coords;
      if (type === "MultiPolygon") return coords.flat();
      return [];
    };

    const boundaryTouchScore = (gapGeom, regionGeom, epsilon) => {
      const gapRing = geometryRings(gapGeom)[0] || [];
      const rings = geometryRings(regionGeom);
      if (!gapRing.length || !rings.length) return 0;
      const step = Math.max(1, Math.floor(gapRing.length / 80));
      let score = 0;
      for (let i = 0; i < gapRing.length; i += step) {
        const p = gapRing[i];
        let best = Infinity;
        for (const ring of rings) {
          for (let j = 1; j < ring.length; j += 1) {
            best = Math.min(best, pointSegmentDistance(p, ring[j - 1], ring[j]));
            if (best <= epsilon) break;
          }
          if (best <= epsilon) break;
        }
        if (best <= epsilon) score += 1;
      }
      return score;
    };

    const clearTopologyDiagnostics = () => {
      topologySource.clear();
      topologyAnalysisRef.current = null;
    };

    const analyzeTopology = (ids, { maxWidth = 500 } = {}) => {
      const width = Math.max(1, Number(maxWidth) || 500);
      const feats = (ids || []).map((id) => regionSource.getFeatureById(id)).filter(Boolean);
      topologySource.clear();
      if (feats.length < 2) {
        const empty = { maxWidth: width, gaps: [], overlaps: [], selectionCount: feats.length };
        topologyAnalysisRef.current = empty;
        return empty;
      }

      const gaps = [];
      const overlapsFound = [];
      let serial = 0;

      // R2.4 large-area acceleration. OpenLayers VectorSource already maintains
      // a spatial index, so do not compare every selected region with every other
      // selected region. This keeps the SAME conservative topology rules while
      // allowing much larger country / empire / continental selections.
      const selectedSet = new Set(feats);
      const featureOrder = new globalThis.Map(feats.map((feature, index) => [feature, index]));
      const areaCache = new globalThis.Map();
      const areaOf = (feature) => {
        if (!feature) return -1;
        if (!areaCache.has(feature)) areaCache.set(feature, planarGeometryArea(feature.getGeometry()));
        return areaCache.get(feature);
      };
      let spatialPairs = 0;

      // Fully enclosed holes in the selection union are the only gap class R2
      // auto-fills. Open coastline defects are preview/manual territory for now.
      for (const row of enclosedGapGeoms(feats.map((f) => f.getGeometry()), { maxWidth: width })) {
        const ext = expandExtent(row.geom.getExtent(), Math.max(4, width * 1.5));
        const neighbors = regionSource
          .getFeaturesInExtent(ext)
          .filter((feature) => selectedSet.has(feature))
          .sort((a, b) => featureOrder.get(a) - featureOrder.get(b));
        let target = null;
        let bestScore = -1;
        const epsilon = Math.max(4, width * 0.08);
        for (const f of neighbors) {
          const score = boundaryTouchScore(row.geom, f.getGeometry(), epsilon);
          if (score > bestScore || (score === bestScore && areaOf(f) > areaOf(target))) {
            target = f;
            bestScore = score;
          }
        }
        if (!target || bestScore <= 0) continue;
        const id = `gap-${++serial}`;
        const item = {
          id,
          kind: "gap",
          geom: row.geom.clone(),
          area: row.area,
          width: row.width,
          targetId: target.getId(),
          targetName: nameOf(target),
        };
        gaps.push(item);
        const overlay = new Feature({ geometry: row.geom.clone(), kind: "gap" });
        overlay.setId(`topology-${id}`);
        topologySource.addFeature(overlay);
      }

      // Pairwise narrow overlaps. R2.4 asks the VectorSource spatial index only
      // for selected features whose extents can actually meet A. Sorting by the
      // original selection order keeps repair proposals deterministic.
      for (let i = 0; i < feats.length; i += 1) {
        const a = feats[i];
        const aExtent = a.getGeometry().getExtent();
        const nearby = regionSource
          .getFeaturesInExtent(aExtent)
          .map((feature) => ({ feature, index: featureOrder.get(feature) }))
          .filter((row) => Number.isInteger(row.index) && row.index > i)
          .sort((x, y) => x.index - y.index);

        for (const { feature: b } of nearby) {
          spatialPairs += 1;
          let pieces = [];
          try {
            pieces = overlapGeoms(a.getGeometry(), b.getGeometry(), { maxWidth: width });
          } catch (e) {
            console.warn("[editor] topology overlap analysis failed:", e);
            continue;
          }
          if (!pieces.length) continue;
          const aArea = areaOf(a);
          const bArea = areaOf(b);
          // Deterministic conservative rule: the larger region keeps the tiny
          // overlap; the smaller one is trimmed to its exact boundary. This is
          // only proposed for narrow overlap candidates and always previews first.
          const winner = aArea >= bArea ? a : b;
          const loser = winner === a ? b : a;
          for (const row of pieces) {
            const id = `overlap-${++serial}`;
            const item = {
              id,
              kind: "overlap",
              geom: row.geom.clone(),
              area: row.area,
              width: row.width,
              aId: a.getId(),
              bId: b.getId(),
              aName: nameOf(a),
              bName: nameOf(b),
              winnerId: winner.getId(),
              loserId: loser.getId(),
            };
            overlapsFound.push(item);
            const overlay = new Feature({ geometry: row.geom.clone(), kind: "overlap" });
            overlay.setId(`topology-${id}`);
            topologySource.addFeature(overlay);
          }
        }
      }

      const report = {
        maxWidth: width,
        selectionCount: feats.length,
        spatialPairs,
        gaps,
        overlaps: overlapsFound,
      };
      topologyAnalysisRef.current = report;
      topologyLayer.changed();
      return {
        ...report,
        // React only needs summaries; keep heavyweight OL geometries private.
        gaps: gaps.map(({ geom, ...item }) => item),
        overlaps: overlapsFound.map(({ geom, ...item }) => item),
      };
    };

    analyzeTopologyRef.current = analyzeTopology;

    const repairTopology = (ids, { maxWidth = 500 } = {}) => {
      // Re-analyze at apply-time. The user may have edited a vertex after preview;
      // stale geometry must never be committed blindly.
      analyzeTopology(ids, { maxWidth });
      const report = topologyAnalysisRef.current;
      if (!report) return { changed: false, gaps: 0, overlaps: 0 };

      const before = new globalThis.Map();
      const remember = (f) => {
        if (!f || before.has(f.getId())) return;
        before.set(f.getId(), { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") });
      };

      let overlapRepairs = 0;
      for (const item of report.overlaps || []) {
        const winner = regionSource.getFeatureById(item.winnerId);
        const loser = regionSource.getFeatureById(item.loserId);
        if (!winner || !loser) continue;
        remember(loser);
        let after;
        try {
          after = subtractFrom(loser.getGeometry(), winner.getGeometry());
        } catch (e) {
          console.warn("[editor] topology overlap repair failed:", e);
          continue;
        }
        if (!after) continue;
        loser.setGeometry(after);
        loser.set("edited", true);
        overlapRepairs += 1;
      }

      let gapRepairs = 0;
      for (const item of report.gaps || []) {
        const target = regionSource.getFeatureById(item.targetId);
        if (!target) continue;
        remember(target);
        try {
          const merged = unionGeoms([target.getGeometry(), item.geom]);
          target.setGeometry(merged);
          target.set("edited", true);
          gapRepairs += 1;
        } catch (e) {
          console.warn("[editor] topology gap repair failed:", e);
        }
      }

      if (!before.size) {
        clearTopologyDiagnostics();
        return { changed: false, gaps: 0, overlaps: 0 };
      }

      const after = new globalThis.Map();
      for (const [id, row] of before.entries()) {
        const f = regionSource.getFeatureById(id);
        if (f) after.set(id, { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") });
      }

      const restore = (snapshot) => {
        for (const row of snapshot.values()) {
          row.feature.setGeometry(row.geometry.clone());
          if (row.edited === undefined) row.feature.unset("edited", true);
          else row.feature.set("edited", row.edited);
        }
        regionLayer.changed();
        labelLayer.changed();
      };

      pushCmd({
        undo: () => restore(before),
        redo: () => restore(after),
      });
      clearTopologyDiagnostics();
      regionLayer.changed();
      labelLayer.changed();
      notifyRegions();
      return { changed: true, gaps: gapRepairs, overlaps: overlapRepairs, affectedRegions: before.size };
    };

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
      // Stable-polity inventory for the Scenario Workshop. Regions store the
      // stable polity KEY; presentation names live in doc.polities/world.polityOverrides.
      listPolityUsage: () => {
        const rows = new globalThis.Map();
        const ensure = (key) => {
          const stableKey = String(key || "").trim();
          if (!stableKey) return null;
          if (!rows.has(stableKey)) rows.set(stableKey, { key: stableKey, regionCount: 0, claimantCount: 0 });
          return rows.get(stableKey);
        };
        for (const f of regionSource.getFeatures()) {
          const owner = ensure(f.get("owner"));
          if (owner) owner.regionCount += 1;
          for (const claimant of Array.isArray(f.get("claimants")) ? f.get("claimants") : []) {
            const row = ensure(claimant);
            if (row) row.claimantCount += 1;
          }
        }
        return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
      },
      selectOwner: (ownerKey, { zoom = false } = {}) => {
        const key = String(ownerKey || "").trim();
        if (!key) return [];
        const ids = regionSource.getFeatures()
          .filter((f) => String(f.get("owner") || "").trim() === key)
          .map((f) => f.getId());
        onSelectionRef.current?.(ids);
        if (zoom && ids.length) {
          const feats = ids.map((id) => regionSource.getFeatureById(id)).filter(Boolean);
          let ext = feats[0].getGeometry().getExtent().slice();
          for (const f of feats.slice(1)) {
            const e = f.getGeometry().getExtent();
            ext = [Math.min(ext[0], e[0]), Math.min(ext[1], e[1]), Math.max(ext[2], e[2]), Math.max(ext[3], e[3])];
          }
          map.getView().fit(ext, { padding: [80, 80, 80, 80], duration: 300, maxZoom: 7 });
        }
        return ids;
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
      analyzeTopology,
      repairTopology,
      clearTopologyDiagnostics,

      // Province Map Importer preview. Bounds arrive as WGS84 lon/lat and are
      // projected here so the source image can be checked against the live map
      // BEFORE any region geometry is replaced.
      showProvinceImportPreview: ({ url, bounds, opacity = 0.46 } = {}) => {
        if (!url || !bounds || !importPreviewLayerRef.current) return false;
        const west = Number(bounds.west);
        const east = Number(bounds.east);
        const north = Math.max(-85.05112878, Math.min(85.05112878, Number(bounds.north)));
        const south = Math.max(-85.05112878, Math.min(85.05112878, Number(bounds.south)));
        if (![west, east, north, south].every(Number.isFinite) || east <= west || north <= south) return false;
        const sw = fromLonLat([west, south]);
        const ne = fromLonLat([east, north]);
        const layer = importPreviewLayerRef.current;
        layer.setSource(new ImageStatic({
          url,
          imageExtent: [sw[0], sw[1], ne[0], ne[1]],
          projection: "EPSG:3857",
        }));
        layer.setOpacity(Math.max(0.05, Math.min(0.95, Number(opacity) || 0.46)));
        layer.setVisible(true);
        return true;
      },
      clearProvinceImportPreview: () => {
        const layer = importPreviewLayerRef.current;
        if (!layer) return;
        layer.setVisible(false);
        layer.setSource(null);
      },

      // Whole-map geometry replacement used by the Province Map Importer.
      // This intentionally does NOT retain the old world in the in-memory Undo
      // stack: a 10k+ province import can already be large, and keeping two
      // complete worlds alive at once is an avoidable tab-killer. The panel
      // downloads the old FeatureCollection before calling this method.
      replaceRegionsFromImport: (fc, { inheritOwners = true } = {}) => {
        if (!fc || !Array.isArray(fc.features)) return { count: 0, inheritedOwners: 0 };
        const fmt = new GeoJSON();
        let feats;
        try {
          feats = fmt.readFeatures(fc, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          });
        } catch (e) {
          console.warn("[editor] province import GeoJSON parse failed:", e);
          return { count: 0, inheritedOwners: 0 };
        }
        feats = feats.filter((f) => {
          const type = f.getGeometry?.()?.getType?.();
          return type === "Polygon" || type === "MultiPolygon";
        });
        if (!feats.length) return { count: 0, inheritedOwners: 0 };

        const usedIds = new Set();
        let inheritedOwners = 0;
        for (let i = 0; i < feats.length; i += 1) {
          const f = feats[i];
          const p = f.getProperties();
          let id = f.getId() ?? p.id ?? `imp-${i + 1}`;
          id = String(id);
          let unique = id;
          let suffix = 2;
          while (usedIds.has(unique)) unique = `${id}-${suffix++}`;
          usedIds.add(unique);
          f.setId(unique);
          if (f.get("typeId") == null) f.set("typeId", "land");

          // Preserve an explicit owner carried by imported GeoJSON. Raster
          // imports intentionally arrive ownerless; for those, inherit the old
          // stable polity key from whichever current region contains the new
          // province's interior point.
          if (inheritOwners && !f.get("owner") && (f.get("typeId") || "land") !== "water") {
            const coord = interiorPoint(f.getGeometry());
            if (coord) {
              const epsilon = 0.01;
              const candidates = regionSource.getFeaturesInExtent([
                coord[0] - epsilon,
                coord[1] - epsilon,
                coord[0] + epsilon,
                coord[1] + epsilon,
              ]);
              const hit = candidates.find((old) => old.getGeometry?.()?.intersectsCoordinate?.(coord));
              if (hit) {
                const owner = hit.get("owner") || null;
                if (owner) {
                  f.set("owner", owner);
                  inheritedOwners += 1;
                }
                const claimants = hit.get("claimants");
                if (Array.isArray(claimants) && claimants.length) f.set("claimants", claimants.slice());
              }
            }
          }
        }

        clearTopologyDiagnostics();
        const preview = importPreviewLayerRef.current;
        if (preview) {
          preview.setVisible(false);
          preview.setSource(null);
        }
        onSelectionRef.current?.([]);
        selectedIdsRef.current = new Set();
        undoStackRef.current = [];
        redoStackRef.current = [];
        emitHistory();

        regionSource.clear();
        regionSource.addFeatures(feats);
        regionLayer.changed();
        labelLayer.changed();
        notifyRegions();
        return { count: feats.length, inheritedOwners };
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
      loadRegions: (fc, ownershipOverrides = null) => {
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
            // Runtime ownership is authoritative. A custom regions.geojson may
            // carry an older display-name owner while ownerSchema 4 world state
            // points the same region at a stable polity key. Stamp that key into
            // the editor so authoring cannot fork the polity on the next save.
            const id = f.getId();
            if (ownershipOverrides && id != null && Object.prototype.hasOwnProperty.call(ownershipOverrides, id)) {
              f.set("owner", ownershipOverrides[id] || null);
            }
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
      analyzeTopologyRef.current = null;
      importPreviewLayerRef.current = null;
      paintPreviewSourceRef.current = null;
      paintPreviewLayerRef.current = null;
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
    if (activeTool === "paint") {
      // High-speed polity authoring. One pointer stroke may cross hundreds of
      // imported provinces, but it is committed as ONE history command.
      //
      // We deliberately do not recolour the full VectorImage layer per mouse
      // move. Touched regions are shown in a lightweight overlay; actual owner
      // attributes are set silently on pointer-up, followed by one redraw.
      const previewSource = paintPreviewSourceRef.current;
      previewSource?.clear();

      let stroke = null;

      const ownerAllowed = (feature) => {
        const filter = paintOnlyOwnerRef.current || "*";
        const owner = feature?.get?.("owner") || null;
        if (filter === "*") return true;
        if (filter === "__unowned__") return !owner;
        return owner === filter;
      };

      const featureAtCoordinate = (coordinate) => {
        const hits = source.getFeaturesAtCoordinate(coordinate) || [];
        if (!hits.length) return null;
        // Match the usual "topmost" editing expectation when malformed source
        // geometry overlaps: later source features are generally rendered last.
        return hits[hits.length - 1] || null;
      };

      const previewFeature = (feature, after) => {
        if (!previewSource || !feature?.getGeometry?.()) return;
        const ghost = new Feature({ geometry: feature.getGeometry() });
        ghost.set("__paintOwner", after, true);
        previewSource.addFeature(ghost);
      };

      const touchCoordinate = (coordinate) => {
        if (!stroke) return;
        const feature = featureAtCoordinate(coordinate);
        if (!feature) return;
        const id = feature.getId();
        const key = id == null ? feature : id;
        if (stroke.visited.has(key)) return;
        stroke.visited.add(key);

        const before = feature.get("owner") || null;
        if (!ownerAllowed(feature) || before === stroke.after) return;

        stroke.rows.push({ feature, before });
        previewFeature(feature, stroke.after);
      };

      const touchSegment = (fromPixel, toPixel) => {
        const dx = toPixel[0] - fromPixel[0];
        const dy = toPixel[1] - fromPixel[1];
        const distance = Math.hypot(dx, dy);
        // Sampling every ~5 screen pixels prevents thin provinces from being
        // skipped when the pointer moves quickly across a dense imported map.
        const steps = Math.max(1, Math.ceil(distance / 5));
        for (let i = 1; i <= steps; i += 1) {
          const pixel = [
            fromPixel[0] + (dx * i) / steps,
            fromPixel[1] + (dy * i) / steps,
          ];
          touchCoordinate(map.getCoordinateFromPixel(pixel));
        }
      };

      const finishStroke = () => {
        if (!stroke) return;
        const finished = stroke;
        stroke = null;
        previewSource?.clear();

        if (!finished.rows.length) return;

        // Commit every touched region without firing thousands of feature
        // change events; one layer redraw follows.
        for (const row of finished.rows) row.feature.set("owner", finished.after, true);

        const restore = (useAfter) => {
          for (const row of finished.rows) {
            row.feature.set("owner", useAfter ? finished.after : row.before, true);
          }
        };

        pushCmd({
          undo: () => restore(false),
          redo: () => restore(true),
        });
        layer.changed();
        labelLayerRef.current?.changed();
        notifyRegions();
      };

      const paintInteraction = new PointerInteraction({
        handleDownEvent: (event) => {
          const original = event.originalEvent;
          if (original && typeof original.button === "number" && original.button !== 0) return false;

          const after = (paintOwnerRef.current || "").trim() || null;
          stroke = {
            after,
            rows: [],
            visited: new Set(),
            lastPixel: [...event.pixel],
          };
          touchCoordinate(event.coordinate);
          // Capture the pointer sequence so DragPan does not move the map while
          // the author is painting. Switch to the Pan tool when navigation is
          // desired.
          return true;
        },
        handleDragEvent: (event) => {
          if (!stroke) return;
          touchSegment(stroke.lastPixel, event.pixel);
          stroke.lastPixel = [...event.pixel];
        },
        handleUpEvent: (event) => {
          if (stroke) {
            touchSegment(stroke.lastPixel, event.pixel);
            finishStroke();
          }
          return false;
        },
        stopDown: () => true,
      });

      added.push(paintInteraction);
      added.push({
        __continuumCleanup: () => {
          stroke = null;
          previewSource?.clear();
        },
      });
    } else if (activeTool === "draw") {
      // trace: click a point on an existing border and the sketch FOLLOWS that
      // border as the cursor moves, instead of making the map-maker click every
      // vertex along a coastline. Click again to leave the border. Moving back
      // along the traced path un-traces it, so overshooting is just backing up.
      //
      // traceSource is the region source, so a new region snaps to its neighbours
      // and shares their exact vertices — which is what keeps borders gap-free.
      // Snap is still added below: trace follows a border once you are ON it,
      // Snap is what gets you onto it.
      // Clicking the point you just placed takes it back, rather than finishing
      // the polygon on it (OL's default). Overshooting a corner is the common
      // mistake and it had no cheap fix — the shape had to be finished wrong and
      // redrawn. Finishing still works by clicking the FIRST point or by
      // double-clicking, so there are two ways out.
      const CLICK_SLOP_PX = 12;
      const atLastPlaced = (event) => {
        const placed = placedPointsRef.current;
        // Needs at least two points: taking back the only point would leave a
        // sketch with nothing in it, which OL has no state for.
        if (placed.length < 2 || !event.map) return false;
        const lastPixel = event.map.getPixelFromCoordinate(placed[placed.length - 1]);
        if (!lastPixel || !event.pixel) return false;
        return Math.hypot(event.pixel[0] - lastPixel[0], event.pixel[1] - lastPixel[1]) <= CLICK_SLOP_PX;
      };

      const draw = new Draw({
        source,
        type: "Polygon",
        trace: true,
        traceSource: source,
        condition: (event) => {
          // Modifier-clicks stay OL's business (this mirrors its default
          // noModifierKeys) so ctrl-click never silently drops a point.
          const oe = event.originalEvent;
          if (oe && (oe.ctrlKey || oe.metaKey || oe.altKey || oe.shiftKey)) return false;
          if (atLastPlaced(event)) {
            draw.removeLastPoint();
            placedPointsRef.current.pop();
            return false; // consumed: take the point back instead of adding one
          }
          placedPointsRef.current.push(event.coordinate);
          return true;
        },
        // No finishCondition on purpose. OL evaluates condition on pointerdown
        // and only reaches the finish check if it returned TRUE, so a click that
        // takes the last point back can never also finish the polygon — the
        // remove already short-circuits it. Adding one here actively broke
        // closing: condition pushes the clicked coordinate, and a finishCondition
        // recomputed in the same event then sees that point as "the last placed"
        // and refuses to close on the first vertex.
      });
      activeDrawRef.current = draw;
      draw.on("drawstart", () => {
        // The click that starts a sketch already went through condition above,
        // so the first point is recorded; anything left from an aborted sketch
        // is not.
        placedPointsRef.current = placedPointsRef.current.slice(-1);
      });
      draw.on("drawabort", () => { placedPointsRef.current = []; });
      draw.on("drawend", (e) => {
        placedPointsRef.current = [];
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
      // Manual override mode. If the author selected regions first, expose ONLY
      // those vertices instead of the entire 3,500-region world. Snapping still
      // sees every region, so a human can deliberately align a corrected border
      // to its neighbour without being buried in unrelated handles.
      const selectedFeatures = (selectionIds || [])
        .map((id) => source.getFeatureById(id))
        .filter(Boolean);
      const selectedCollection = selectedFeatures.length ? new Collection(selectedFeatures) : null;
      const modify = new Modify({
        ...(selectedCollection ? { features: selectedCollection } : { source }),
        pixelTolerance: 18,
        style: manualVertexStyle,
      });
      let beforeModify = null;
      modify.on("modifystart", (e) => {
        beforeModify = new globalThis.Map();
        for (const f of e.features?.getArray?.() ?? []) {
          beforeModify.set(f.getId(), {
            feature: f,
            geometry: f.getGeometry().clone(),
            edited: f.get("edited"),
          });
        }
      });
      modify.on("modifyend", (e) => {
        const afterModify = new globalThis.Map();
        for (const f of e.features?.getArray?.() ?? []) {
          // Dragging a vertex changes the region's geometry, so the stock GADM
          // tile no longer describes it. Export the authored geometry instead.
          f.set("edited", true);
          afterModify.set(f.getId(), {
            feature: f,
            geometry: f.getGeometry().clone(),
            edited: true,
          });
        }
        if (beforeModify?.size && afterModify.size) {
          const beforeSnapshot = beforeModify;
          const afterSnapshot = afterModify;
          const restore = (snapshot) => {
            for (const row of snapshot.values()) {
              row.feature.setGeometry(row.geometry.clone());
              if (row.edited === undefined) row.feature.unset("edited", true);
              else row.feature.set("edited", row.edited);
            }
          };
          pushCmd({
            undo: () => restore(beforeSnapshot),
            redo: () => restore(afterSnapshot),
          });
        }
        notifyRegions();
      });
      // High-tolerance magnet against the complete region source. The selected
      // polygon is what moves; its neighbour is the reference target.
      added.push(modify, new Snap({ source, pixelTolerance: 18 }));
    } else if (activeTool === "border") {
      // Shared-border precision mode is deliberately pair-scoped. A human picks
      // the two neighbouring regions that define the border; every released
      // vertex/edge edit is then mirrored as an EXACT shared anchor in both.
      const pair = (selectionIds || [])
        .map((id) => source.getFeatureById(id))
        .filter(Boolean);
      const assistSource = borderAssistSourceRef.current;
      assistSource?.clear();

      if (pair.length === 2) {
        const selectedCollection = new Collection(pair);
        const modify = new Modify({
          features: selectedCollection,
          pixelTolerance: 24,
          style: manualVertexStyle,
        });
        let beforePair = null;

        const snapshotPair = () => new globalThis.Map(
          pair.map((f) => [
            f.getId(),
            { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") },
          ]),
        );
        const restorePair = (snapshot) => {
          for (const row of snapshot.values()) {
            row.feature.setGeometry(row.geometry.clone());
            if (row.edited === undefined) row.feature.unset("edited", true);
            else row.feature.set("edited", row.edited);
          }
          layer.changed();
          labelLayerRef.current?.changed();
        };

        modify.on("modifystart", () => {
          beforePair = snapshotPair();
          assistSource?.clear();
        });

        modify.on("modifyend", (e) => {
          const mapEvent = e.mapBrowserEvent;
          const point = mapEvent?.coordinate;
          const resolution = map.getView().getResolution() || 1;
          const tolerance = Math.max(8, resolution * 24);
          const altRemove = Boolean(mapEvent?.originalEvent?.altKey);
          const modifiedIds = new Set((e.features?.getArray?.() ?? []).map((f) => f.getId()));

          if (point) {
            if (altRemove) {
              // OpenLayers already removed the clicked vertex from whichever
              // feature(s) it modified. Mirror that removal only into the OTHER
              // selected polygon, avoiding a second accidental deletion.
              pair.forEach((f) => {
                if (!modifiedIds.has(f.getId())) removeSharedVertexNear(f, point, tolerance);
              });
            } else {
              const shared = sharedBorderPoint(pair, point, tolerance);
              if (shared) {
                // Use the midpoint between the two nearest boundary projections,
                // which is exactly what the cyan halo previews. Both polygons
                // receive the same coordinate, creating a canonical shared anchor.
                pair.forEach((f) => weldPointIntoFeature(f, shared.point, tolerance));
              }
            }
          }

          pair.forEach((f) => f.set("edited", true));
          const afterPair = snapshotPair();
          if (beforePair?.size && afterPair.size) {
            const beforeSnapshot = beforePair;
            const afterSnapshot = afterPair;
            pushCmd({
              undo: () => restorePair(beforeSnapshot),
              redo: () => restorePair(afterSnapshot),
            });
          }

          layer.changed();
          labelLayerRef.current?.changed();
          notifyRegions();
          assistSource?.clear();

          // Immediate preview-only sanity check: yellow/red diagnostics appear
          // after every shared-border edit if a <=100 m crack/overlap remains.
          // Nothing is auto-repaired here.
          try {
            analyzeTopologyRef.current?.(pair.map((f) => f.getId()), { maxWidth: 100 });
          } catch (error) {
            console.warn("[editor] shared-border local topology check failed:", error);
          }
        });

        // Cyan magnet preview: shown only when BOTH selected boundaries are
        // within the tool's hit radius. This is the release point that will be
        // welded into both polygons.
        const onPointerMove = (evt) => {
          assistSource?.clear();
          const resolution = map.getView().getResolution() || 1;
          const tolerance = Math.max(8, resolution * 24);
          const shared = sharedBorderPoint(pair, evt.coordinate, tolerance);
          if (!shared) return;
          const marker = new Feature({ geometry: new Point(shared.point) });
          marker.set("kind", "shared-border-assist");
          assistSource?.addFeature(marker);
        };
        map.on("pointermove", onPointerMove);

        const snap = new Snap({ source, pixelTolerance: 24 });
        added.push(modify, snap);
        // Store a tiny pseudo-interaction cleanup hook alongside real OL
        // interactions; the cleanup below recognises it.
        added.push({
          __continuumCleanup: () => {
            map.un("pointermove", onPointerMove);
            assistSource?.clear();
          },
        });
      }
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

    added.forEach((i) => {
      if (i?.__continuumCleanup) return;
      map.addInteraction(i);
    });
    interactionsRef.current = added.filter((i) => !i?.__continuumCleanup);
    return () => {
      added.forEach((i) => {
        if (i?.__continuumCleanup) i.__continuumCleanup();
        else map.removeInteraction(i);
      });
      borderAssistSourceRef.current?.clear();
      interactionsRef.current = [];
      // Switching tools abandons any half-drawn sketch, so Ctrl+Z has to go back
      // to meaning "undo the last region operation" rather than calling into a
      // Draw the map no longer owns.
      activeDrawRef.current = null;
      placedPointsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectionKey]);

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
        opacity: Number.isFinite(esri.editorOpacity) ? esri.editorOpacity : 1,
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
    if (el) {
      el.style.background = customActive
        ? "#0b1a2b"
        : esri?.editorBackground || BASEMAP_BG[basemap] || "#0b1020";
    }
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
