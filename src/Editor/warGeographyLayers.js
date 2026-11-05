/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// What a scenario draws on its map for war (runtime/warGeography.js), on the
// Workshop's OpenLayers map:
//
//   terrain areas     a flat earthy fill, stronger the harder the ground, under
//                     a dashed outline
//   fortified lines   a thick dark line with short ticks along one side, the
//                     way a map marks a wall
//   climate zones     each zone's colour blended into its neighbours' across
//                     its blend width (climateBlend.js), under an outline in
//                     the zone's colour
//   frozen water      water regions that can freeze, hatched
//
// Each kind of shape has its own vector source, never the regions': the Draw
// tool carves regions out of whatever it is drawn over, and these tools must
// not. The document is where the shapes live (useMapDocument.js); the sources
// only show it, and syncShapes brings them up to date with it.

import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import ImageCanvas from "ol/ImageCanvas";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import ImageSource from "ol/source/Image";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { containsExtent, getHeight, getWidth } from "ol/extent";
import { fromLonLat, transform } from "ol/proj";
import { curveRing } from "../runtime/fronts/climate.js";
import { blendCellPixels, mercatorKmPerUnit, paintClimateBlend, prepareClimateZones } from "./climateBlend.js";

// ---------------------------------------------------------------------------
// Shapes between the document ([lng, lat], five places, as the world keeps
// them) and the map (Web Mercator). Back to [lng, lat] without wrapping the
// longitude, as the regions are written (OlMap serializeRegions): a shape
// drawn across the 180th meridian keeps its points in order.

const round5 = (value) => Math.round(value * 1e5) / 1e5;
const toWorld = (coordinate) => {
  const [lng, lat] = transform(coordinate, "EPSG:3857", "EPSG:4326");
  return [round5(lng), round5(lat)];
};
const closedRing = (ring) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

export const polygonOfRings = (rings) => {
  const kept = (Array.isArray(rings) ? rings : []).filter((ring) => Array.isArray(ring) && ring.length >= 3);
  return kept.length ? new Polygon(kept.map((ring) => closedRing(ring).map((point) => fromLonLat(point)))) : null;
};
// A polygon's rings, closed as GeoJSON closes them, the outer first.
export const ringsOfPolygon = (geometry) => geometry.getCoordinates().map((ring) => ring.map(toWorld));

export const lineOfPoints = (points) => (Array.isArray(points) && points.length >= 2 ? new LineString(points.map((point) => fromLonLat(point))) : null);
export const pointsOfLine = (geometry) => geometry.getCoordinates().map(toWorld);

// What each tool draws, as OpenLayers' Draw names it.
export const drawTypeOf = (kind) => (kind === "fortification" ? "LineString" : "Polygon");

// ---------------------------------------------------------------------------
// The sources follow the document.

// The document row each feature was last drawn from: a row that is the same
// object as last time is left alone, and a row whose shape is the same array
// keeps its geometry, so a feature being reshaped keeps its handles while its
// name or level changes.
const drawnFrom = new WeakMap();

export const syncShapes = (source, rows, kind) => {
  const line = kind === "fortification";
  const seen = new Set();
  const added = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let feature = source.getFeatureById(id);
    const before = feature ? drawnFrom.get(feature) : null;
    if (feature && before === row) continue;
    const reshaped = !before || (line ? before.points !== row.points : before.rings !== row.rings);
    if (reshaped) {
      const geometry = line ? lineOfPoints(row.points) : polygonOfRings(row.rings);
      if (!geometry) {
        if (feature) source.removeFeature(feature);
        continue;
      }
      if (feature) feature.setGeometry(geometry);
      else {
        feature = new Feature({ geometry });
        feature.setId(id);
        added.push(feature);
      }
    }
    feature.setProperties({ name: String(row.name || ""), level: row.level, color: row.color || "", owner: row.owner || "" });
    drawnFrom.set(feature, row);
  }
  for (const feature of source.getFeatures()) {
    if (!seen.has(String(feature.getId()))) source.removeFeature(feature);
  }
  if (added.length) source.addFeatures(added);
};

// The shape whose outline (or line) passes within `tolerance` map units of
// `coordinate`, the nearest when several do; null when none does. The inside
// of an area does not count: a click there starts a new shape.
export const shapeNear = (source, coordinate, tolerance) => {
  let best = null;
  let bestDistance = tolerance;
  const [x, y] = coordinate;
  source.forEachFeatureIntersectingExtent([x - tolerance, y - tolerance, x + tolerance, y + tolerance], (feature) => {
    const [cx, cy] = feature.getGeometry().getClosestPoint(coordinate);
    const distance = Math.hypot(cx - x, cy - y);
    if (distance <= bestDistance) {
      best = feature;
      bestDistance = distance;
    }
  });
  return best;
};

// ---------------------------------------------------------------------------
// Styles. One Style per look, as the editor's other layers keep them (OlMap.jsx).

const SELECTED = "#facc15";
const halo = new Stroke({ color: "rgba(0,0,0,0.85)", width: 3 });

const terrainStyles = new Map();
const terrainStyle = (level, selected, label) => {
  const key = `${level}|${selected ? 1 : 0}|${label}`;
  let style = terrainStyles.get(key);
  if (!style) {
    style = new Style({
      fill: new Fill({ color: `rgba(164, 132, 96, ${(0.08 + level * 0.03).toFixed(2)})` }),
      stroke: new Stroke({ color: selected ? SELECTED : "rgba(232, 214, 186, 0.95)", width: selected ? 2.6 : 1.6, lineDash: [7, 5] }),
      text: label
        ? new Text({ text: label, font: "600 11px sans-serif", overflow: true, fill: new Fill({ color: "#f3e9da" }), stroke: halo })
        : undefined,
    });
    terrainStyles.set(key, style);
  }
  return style;
};

// Short ticks along the left of a fortified line, the way a map marks a wall,
// drawn on the canvas between the line's own points (pixels, as OpenLayers
// hands a custom renderer).
const wallTicks = (spacing, length, width) => (pixels, state) => {
  const context = state.context;
  const ratio = state.pixelRatio || 1;
  const gap = spacing * ratio;
  const reach = length * ratio;
  context.save();
  context.strokeStyle = "#2b2724";
  context.lineWidth = width * ratio;
  context.lineCap = "butt";
  context.beginPath();
  let carried = gap / 2;
  for (let i = 1; i < pixels.length; i += 1) {
    const [ax, ay] = pixels[i - 1];
    const [bx, by] = pixels[i];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const ux = dx / length;
    const uy = dy / length;
    let at = carried;
    while (at <= length) {
      const px = ax + ux * at;
      const py = ay + uy * at;
      context.moveTo(px, py);
      context.lineTo(px + uy * reach, py - ux * reach);
      at += gap;
    }
    carried = at - length;
  }
  context.stroke();
  context.restore();
};

const wallStyles = new Map();
const wallStyle = (level, selected, label) => {
  const key = `${level}|${selected ? 1 : 0}|${label}`;
  let style = wallStyles.get(key);
  if (!style) {
    const width = 2.5 + level * 0.35;
    style = [
      new Style({ stroke: new Stroke({ color: selected ? SELECTED : "rgba(236, 229, 216, 0.6)", width: width + 3, lineCap: "round", lineJoin: "round" }) }),
      new Style({ stroke: new Stroke({ color: "#2b2724", width, lineCap: "round", lineJoin: "round" }) }),
      new Style({ renderer: wallTicks(Math.max(9, 18 - level), width / 2 + 4, Math.max(1.5, width / 2)) }),
      ...(label
        ? [new Style({ text: new Text({ text: label, placement: "line", font: "600 11px sans-serif", offsetY: -12, fill: new Fill({ color: "#fff" }), stroke: halo }) })]
        : []),
    ];
    wallStyles.set(key, style);
  }
  return style;
};

const climateStyles = new Map();
// A zone drawn as the game reads it, its corners rounded off (runtime/fronts/
// climate.js curveRing); the points it was drawn with are still what is edited.
const curvedZone = (feature) => {
  const geometry = feature.getGeometry();
  return geometry?.getType?.() === "Polygon" ? new Polygon(geometry.getCoordinates().map((ring) => curveRing(ring))) : geometry;
};
const climateStyle = (color, selected, label) => {
  const key = `${color}|${selected ? 1 : 0}|${label}`;
  let style = climateStyles.get(key);
  if (!style) {
    style = [
      new Style({ geometry: curvedZone, stroke: new Stroke({ color: selected ? SELECTED : "rgba(10, 12, 16, 0.6)", width: selected ? 5 : 3.4 }) }),
      new Style({
        geometry: curvedZone,
        stroke: new Stroke({ color, width: selected ? 2.4 : 1.6, lineDash: [10, 5] }),
        text: label
          ? new Text({ text: label, font: "700 12px sans-serif", overflow: true, fill: new Fill({ color }), stroke: halo })
          : undefined,
      }),
    ];
    climateStyles.set(key, style);
  }
  return style;
};

// Water that can freeze: thin pale strokes across it. A small tile of them,
// repeated (the canvas's own pattern fill), made the first time it is drawn.
let hatchStyle = null;
const frozenHatch = () => {
  if (hatchStyle) return hatchStyle;
  const tile = document.createElement("canvas");
  tile.width = 10;
  tile.height = 10;
  const context = tile.getContext("2d");
  context.strokeStyle = "rgba(226, 242, 255, 0.85)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(-1, 11);
  context.lineTo(11, -1);
  context.moveTo(-1, 1);
  context.lineTo(1, -1);
  context.moveTo(9, 11);
  context.lineTo(11, 9);
  context.stroke();
  hatchStyle = new Style({
    fill: new Fill({ color: context.createPattern(tile, "repeat") }),
    stroke: new Stroke({ color: "rgba(226, 242, 255, 0.55)", width: 1 }),
  });
  return hatchStyle;
};

// ---------------------------------------------------------------------------
// The climate zones' blended colours: one picture per view, painted when the
// map stops moving and stretched with it while it moves (OpenLayers asks an
// image layer for a new picture only then). The picture has a cell for every
// few screen pixels (blendCellPixels) and is declared that much coarser, so
// the map scales it up to the screen, smoothly, as it draws it.

class ClimateBlendSource extends ImageSource {
  constructor() {
    super({});
    this.zones_ = [];
    this.drawn_ = null;
  }

  setZones(zones) {
    this.zones_ = prepareClimateZones(zones, (point) => fromLonLat(point));
    this.changed();
  }

  hasZones() {
    return this.zones_.length > 0;
  }

  getImageInternal(extent, resolution) {
    const drawn = this.drawn_;
    if (drawn && drawn.revision === this.getRevision() && drawn.resolution === resolution && containsExtent(drawn.extent, extent)) {
      return drawn.image;
    }
    // A quarter of the view's width and height again on every side, so a
    // short pan stays inside the picture.
    const padX = getWidth(extent) / 4;
    const padY = getHeight(extent) / 4;
    const wanted = [extent[0] - padX, extent[1] - padY, extent[2] + padX, extent[3] + padY];
    const zones = this.zones_;
    const edges = zones.reduce((sum, zone) => sum + zone.edges.length / 4, 0);
    const pixels = (getWidth(wanted) / resolution) * (getHeight(wanted) / resolution);
    const cell = resolution * blendCellPixels(edges, pixels);
    const cols = Math.max(1, Math.ceil(getWidth(wanted) / cell));
    const rows = Math.max(1, Math.ceil(getHeight(wanted) / cell));
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    if (zones.length) {
      const bytes = paintClimateBlend({ zones, cols, rows, x0: wanted[0], y0: wanted[3], cell, kmPerUnit: mercatorKmPerUnit });
      canvas.getContext("2d").putImageData(new ImageData(bytes, cols, rows), 0, 0);
    }
    const image = new ImageCanvas([wanted[0], wanted[3] - rows * cell, wanted[0] + cols * cell, wanted[3]], cell, 1, canvas);
    this.drawn_ = { image, extent: image.getExtent(), resolution, revision: this.getRevision() };
    return image;
  }
}

// ---------------------------------------------------------------------------

// The layers, their sources and what OlMap does with them. `getZoom(resolution)`
// is the map's zoom; `selectedId(kind)` the id of the shape of that kind the
// designer has picked, or null.
export const createWarGeographyLayers = ({ getZoom, selectedId }) => {
  const sources = {
    terrain: new VectorSource({ wrapX: false }),
    fortification: new VectorSource({ wrapX: false }),
    climate: new VectorSource({ wrapX: false }),
  };
  const isSelected = (kind, feature) => selectedId(kind) === String(feature.getId());

  const terrainLayer = new VectorLayer({
    source: sources.terrain,
    visible: false,
    wrapX: false,
    updateWhileInteracting: false,
    updateWhileAnimating: false,
    style: (feature, resolution) => {
      const level = Number(feature.get("level")) || 0;
      const name = feature.get("name") || "";
      const label = getZoom(resolution) >= 3.5 ? (name ? `${name} · ${level}` : String(level)) : "";
      return terrainStyle(level, isSelected("terrain", feature), label);
    },
  });
  terrainLayer.setZIndex(13);

  const climateLayer = new VectorLayer({
    source: sources.climate,
    wrapX: false,
    updateWhileInteracting: false,
    updateWhileAnimating: false,
    style: (feature, resolution) => {
      const label = getZoom(resolution) >= 3 ? feature.get("name") || "" : "";
      return climateStyle(feature.get("color") || "#7f8c99", isSelected("climate", feature), label);
    },
  });
  climateLayer.setZIndex(14);

  const wallLayer = new VectorLayer({
    source: sources.fortification,
    wrapX: false,
    updateWhileInteracting: false,
    updateWhileAnimating: false,
    style: (feature, resolution) => {
      const level = Number(feature.get("level")) || 3;
      const label = getZoom(resolution) >= 4.5 ? feature.get("name") || "" : "";
      return wallStyle(level, isSelected("fortification", feature), label);
    },
  });
  wallLayer.setZIndex(15);

  const blendSource = new ClimateBlendSource();
  const blendLayer = new ImageLayer({ source: blendSource, visible: false });
  blendLayer.setZIndex(11);

  // Copies of the frozen regions' features sharing their geometry, so the
  // hatch follows a region's own edits; rebuilt whenever the regions change.
  const hatchSource = new VectorSource({ wrapX: false });
  const hatchLayer = new VectorLayer({
    source: hatchSource,
    wrapX: false,
    updateWhileInteracting: false,
    updateWhileAnimating: false,
    style: frozenHatch,
  });
  hatchLayer.setZIndex(11);

  // Terrain and climate zones are on the map only while the designer works on
  // them ("when your not in the climate or terrain menu, you dont see the
  // climate or the terrain to keep the map from clutter", the owner,
  // 2026-10-14): MapEditor.jsx says when, through showWorkingOn. The zones'
  // colours and outlines go on and off as one; the colours stay off while there
  // is no zone, so an old picture can never linger on the map.
  let climateShown = false;
  const showClimate = () => {
    climateLayer.setVisible(climateShown);
    blendLayer.setVisible(climateShown && blendSource.hasZones());
  };

  const shapeLayers = { terrain: terrainLayer, fortification: wallLayer, climate: climateLayer };

  return {
    sources,
    layers: [blendLayer, hatchLayer, terrainLayer, climateLayer, wallLayer],
    // Whether a kind of shape is on the map now: terrain and climate zones while
    // they are worked on, fortified lines unless hidden in the Layers panel.
    shown: (kind) => shapeLayers[kind]?.getVisible() ?? false,
    // The Layers panel's switches.
    toggles: {
      fortifications: wallLayer,
      freezing: hatchLayer,
    },
    // What the designer is working on: the War map panel open on the Terrain
    // or the Climate tab, or that tool picked.
    showWorkingOn: ({ terrain = false, climate = false } = {}) => {
      terrainLayer.setVisible(Boolean(terrain));
      climateShown = Boolean(climate);
      showClimate();
    },
    setClimateZones: (zones) => {
      blendSource.setZones(zones);
      showClimate();
    },
    // `ids`: the regions that can freeze; `isWater(feature)` whether a region
    // is of a water type now.
    rebuildHatch: (regionSource, ids, isWater) => {
      const copies = [];
      for (const id of ids || []) {
        const region = regionSource.getFeatureById(id);
        const geometry = region?.getGeometry();
        if (geometry && isWater(region)) copies.push(new Feature({ geometry }));
      }
      hatchSource.clear(true);
      if (copies.length) hatchSource.addFeatures(copies);
    },
    restyle: () => {
      terrainLayer.changed();
      climateLayer.changed();
      wallLayer.changed();
    },
  };
};
