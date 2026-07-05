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
import { unionGeoms, splitByLine, translatedClone } from "./geometry.js";

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
    const regionSource = new VectorSource();
    const getZoom = (res) => mapRef.current?.getView().getZoomForResolution(res) ?? 3;

    const regionLayer = new VectorLayer({
      source: regionSource,
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
      declutter: true,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
      style: (feature, resolution) => {
        const zoom = getZoom(resolution);
        if (zoom < LABEL_MIN_ZOOM) return null;
        const type = typesByIdRef.current[feature.get("typeId") || "land"];
        if (type && type.includedInLabels === false) return null;
        const name = feature.get("name");
        if (!name) return null;
        return new Style({
          text: new Text({
            text: name,
            font: "600 12px sans-serif",
            overflow: false,
            fill: new Fill({ color: "rgba(255,255,255,0.95)" }),
            stroke: new Stroke({ color: "rgba(0,0,0,0.85)", width: 3 }),
          }),
        });
      },
    });
    labelLayer.setZIndex(20);

    // Point/symbol feature layer (cities). With ~70k cities available, dots and
    // labels are gated by zoom + prominence so the whole set never renders at once
    // (capitals/large cities appear first; everything shows when zoomed in).
    const pointSource = new VectorSource();
    const markerShape = (radius) =>
      new RegularShape({
        points: 4,
        radius,
        angle: Math.PI / 4,
        fill: new Fill({ color: "#ffd54a" }),
        stroke: new Stroke({ color: "#000", width: 1 }),
      });
    const SHAPES = { large: markerShape(6), mid: markerShape(4.5), small: markerShape(3.5) };
    const pointLayer = new VectorLayer({
      source: pointSource,
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
        return new Style({
          image: SHAPES[size],
          text: showLabel
            ? new Text({
                text: feature.get("name") || "",
                font: "600 11px sans-serif",
                offsetY: -11,
                fill: new Fill({ color: "#fff" }),
                stroke: new Stroke({ color: "rgba(0,0,0,0.85)", width: 3 }),
              })
            : undefined,
        });
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
          const after = (paintOwnerRef.current || "").toUpperCase() || null;
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

    map.on("pointermove", (evt) => {
      if (evt.dragging) return;
      const hit = map.hasFeatureAtPixel(evt.pixel, {
        layerFilter: (l) => l === regionLayerRef.current,
      });
      const tool = activeToolRef.current;
      if (tool === "lasso" || tool === "split" || tool === "draw") {
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
      queryRegions: (text, limit = 200) => {
        const q = (text || "").trim().toLowerCase();
        const out = [];
        for (const f of regionSource.getFeatures()) {
          if (q) {
            const hay = `${f.getId()} ${f.get("name") || ""} ${f.get("owner") || ""} ${f.get("country") || ""}`.toLowerCase();
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
      serializeRegions: () => {
        const fmt = new GeoJSON();
        return JSON.parse(
          fmt.writeFeatures(regionSource.getFeatures(), {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
            decimals: 5,
          }),
        );
      },
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
    const splitAlongPath = (rawPath) => {
      if (!rawPath || rawPath.length < 2) return;
      const res = map.getView().getResolution() || 1;

      // Decimate dense freehand points (keep ~every 3px, always keep the last).
      const minGap = res * 3;
      const path = [rawPath[0]];
      for (let k = 1; k < rawPath.length; k += 1) {
        const a = path[path.length - 1];
        const b = rawPath[k];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minGap || k === rawPath.length - 1) path.push(b);
      }
      if (path.length < 2) return;

      // Only consider regions the path actually passes over. (Note: `Map` is the
      // OpenLayers Map class in this file, so we use a Set + array here.)
      const seenIds = new Set();
      const touched = [];
      for (const pt of path) {
        source.forEachFeatureInExtent([pt[0] - 1, pt[1] - 1, pt[0] + 1, pt[1] + 1], (f) => {
          const id = f.getId();
          if (!seenIds.has(id)) {
            seenIds.add(id);
            touched.push(f);
          }
        });
      }

      const changes = [];
      const extend = res * 60;
      for (const target of touched) {
        const geom = target.getGeometry();
        const inside = path.map((pt) => geom.intersectsCoordinate(pt));
        // Find the first inside-span bracketed by outside vertices = a full crossing.
        let i = 0;
        while (i < path.length) {
          if (!inside[i]) {
            i += 1;
            continue;
          }
          let j = i;
          while (j + 1 < path.length && inside[j + 1]) j += 1;
          const fullCrossing = i > 0 && !inside[i - 1] && j < path.length - 1 && !inside[j + 1];
          if (fullCrossing) {
            const cutSub = path.slice(i - 1, j + 2); // include the bracketing outside points
            const pieces = splitByLine(geom, cutSub, { hw: 4, extend });
            if (pieces && pieces.length >= 2) {
              const oldGeom = geom.clone();
              const [big, ...rest] = pieces;
              target.setGeometry(big.geom);
              const bigGeom = big.geom.clone();
              const newFeats = [];
              for (const p of rest) {
                const nf = new Feature({ geometry: p.geom });
                nf.setId(newId());
                nf.setProperties({
                  typeId: target.get("typeId") || "land",
                  owner: target.get("owner") || null,
                  name: (target.get("name") || "Region") + " (split)",
                  gid0: target.get("gid0") || "",
                  country: target.get("country") || "",
                });
                source.addFeature(nf);
                newFeats.push(nf);
              }
              changes.push({ target, oldGeom, bigGeom, newFeats });
            }
            break; // one cut per region
          }
          i = j + 1;
        }
      }

      if (!changes.length) {
        console.warn("[editor] split: drag all the way across the region(s) you want to cut");
        return;
      }
      layer.changed();
      labelLayerRef.current?.changed();
      notifyRegions();
      pushCmd({
        undo: () =>
          changes.forEach((c) => {
            c.target.setGeometry(c.oldGeom.clone());
            c.newFeats.forEach((f) => source.removeFeature(f));
          }),
        redo: () =>
          changes.forEach((c) => {
            c.target.setGeometry(c.bigGeom.clone());
            c.newFeats.forEach((f) => source.addFeature(f));
          }),
      });
    };

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
      const draw = new Draw({ source, type: "Polygon" });
      draw.on("drawend", (e) => {
        const f = e.feature;
        f.setId(newId());
        if (f.get("typeId") == null) f.set("typeId", defaultTypeIdRef.current || "land");
        if (f.get("owner") === undefined) f.set("owner", null);
        if (!f.get("name")) f.set("name", "New Region");
        if (f.get("gid0") == null) f.set("gid0", "");
        if (f.get("country") == null) f.set("country", "");
        // defer so drawend finishes adding to the source before we count
        setTimeout(notifyRegions, 0);
        pushCmd({ undo: () => source.removeFeature(f), redo: () => source.addFeature(f) });
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
    } else if (activeTool === "split") {
      // freehand: hold and drag to draw the cut path; it follows the cursor and
      // splits the region along exactly that path on release.
      const draw = new Draw({ type: "LineString", features: new Collection(), freehand: true });
      draw.on("drawend", (e) => splitAlongPath(e.feature.getGeometry().getCoordinates()));
      added.push(draw);
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

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
};

export default OlMap;
