/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The scale line on the Workshop's map: a line the author draws in the
// Projection panel and gives the distance it measures (projection.scale,
// server/mapDistance.js). Drawn in the accent with a bar across each end and
// its distance written beside it, the way a map's scale bar is; the Scale line
// tool draws one, showing what it measures as it is drawn.

import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { fromLonLat, transform } from "ol/proj";

export const SCALE_TOOL = "scale";
const ACCENT = "#2bc1f3";
const INK = "#06222d";

const round5 = (value) => Math.round(value * 1e5) / 1e5;
const toWorld = (coordinate) => {
  const [lng, lat] = transform(coordinate, "EPSG:3857", "EPSG:4326");
  return [round5(lng), round5(lat)];
};

// A line's two ends as the document keeps them ([lng, lat], five places): the
// first point drawn and the last.
export const endsOfLine = (geometry) => {
  const points = geometry?.getCoordinates?.() ?? [];
  return points.length >= 2 ? [toWorld(points[0]), toWorld(points[points.length - 1])] : null;
};

// A bar across the line at a point, 9 px either side of it at `resolution`
// (map units to a pixel).
const BAR_PX = 9;
const endBar = (at, angle, resolution) => {
  const reach = BAR_PX * (resolution || 1);
  const dx = -Math.sin(angle) * reach;
  const dy = Math.cos(angle) * reach;
  return new Style({
    geometry: new LineString([[at[0] - dx, at[1] - dy], [at[0] + dx, at[1] + dy]]),
    stroke: new Stroke({ color: ACCENT, width: 3, lineCap: "round" }),
  });
};

// The look of a scale line (or one being drawn), with `label` written beside it.
export const scaleLineStyles = (geometry, label, resolution = 1) => {
  const points = geometry?.getCoordinates?.() ?? [];
  if (points.length < 2) return [];
  const first = points[0];
  const last = points[points.length - 1];
  const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
  const line = new LineString([first, last]);
  return [
    new Style({ geometry: line, stroke: new Stroke({ color: "rgba(0,0,0,0.75)", width: 6, lineCap: "butt" }) }),
    new Style({ geometry: line, stroke: new Stroke({ color: ACCENT, width: 3, lineCap: "butt", lineDash: [14, 6] }) }),
    endBar(first, angle, resolution),
    endBar(last, angle, resolution),
    ...(label
      ? [new Style({
        geometry: new Point([(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]),
        text: new Text({
          text: label,
          font: "700 12px sans-serif",
          offsetY: -16,
          padding: [3, 6, 3, 6],
          fill: new Fill({ color: INK }),
          backgroundFill: new Fill({ color: ACCENT }),
          overflow: true,
        }),
      })]
      : []),
  ];
};

// Where the pointer is while a scale line is drawn.
export const scaleCursorStyle = new Style({
  image: new CircleStyle({ radius: 5, fill: new Fill({ color: ACCENT }), stroke: new Stroke({ color: INK, width: 1.5 }) }),
});

// A distance as the scale line writes it, in kilometres and miles: "≈" in
// front for what a line measures now, as against what it was said to be.
export const KM_PER_MILE = 1.609344;
const distanceText = (value) => {
  const digits = value < 10 ? 1 : 0;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
};
export const scaleLabelOf = (km, { about = false } = {}) => {
  const value = Number(km);
  if (!(value > 0)) return "";
  return `${about ? "≈ " : ""}${distanceText(value)} km · ${distanceText(value / KM_PER_MILE)} mi`;
};

// The layer the scale line is shown on, over the regions and the war's shapes.
export const createScaleLineLayer = () => {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    style: (feature, resolution) => scaleLineStyles(feature.getGeometry(), feature.get("label") || "", resolution),
    updateWhileInteracting: true,
    updateWhileAnimating: true,
  });
  layer.setZIndex(90);
  return { source, layer };
};

// Shows `line` ({ from, to } in [lng, lat]) with `label` beside it, or nothing.
export const showScaleLine = (source, line, label = "") => {
  source.clear();
  if (!line || !Array.isArray(line.from) || !Array.isArray(line.to)) return;
  const feature = new Feature({ geometry: new LineString([fromLonLat(line.from), fromLonLat(line.to)]) });
  feature.set("label", label);
  source.addFeature(feature);
};
