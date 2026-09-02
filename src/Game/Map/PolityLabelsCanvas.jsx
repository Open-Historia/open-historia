/*! Open Historia — shape-integrated polity label overlay © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect, useRef } from "react";

const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
// One wrapped copy on either side covers the repeated world at the supported
// minimum zoom. Projecting two additional invisible copies was a large part of
// the cost of the old whole-world label frame.
const WORLD_SHIFTS = [-360, 0, 360];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const cssFontStack = (fonts) => (fonts ?? [])
  .filter(Boolean)
  .map((font) => {
    const normalized = String(font).trim();
    if (GENERIC_FONTS.has(normalized.toLowerCase())) return normalized;
    return `"${normalized.replaceAll('"', "")}"`;
  })
  .join(", ");

const polylineMetrics = (points) => {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    ));
  }
  return { cumulative, length: cumulative.at(-1) ?? 0 };
};

const pointAlong = (points, cumulative, distance) => {
  if (!points.length) return null;
  const target = clamp(distance, 0, cumulative.at(-1) ?? 0);
  let index = 1;
  while (index < cumulative.length && cumulative[index] < target) index += 1;
  if (index >= points.length) index = points.length - 1;
  const previous = Math.max(0, index - 1);
  const segmentLength = Math.max(1e-6, cumulative[index] - cumulative[previous]);
  const ratio = (target - cumulative[previous]) / segmentLength;
  const a = points[previous];
  const b = points[index];
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
};

const angleSpreadScale = (points, cumulative, length) => {
  let previous = null;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index <= 8; index += 1) {
    const sample = pointAlong(points, cumulative, length * (0.18 + (index / 8) * 0.64));
    if (!sample) continue;
    let angle = sample.angle;
    if (previous !== null) {
      while (angle - previous > Math.PI) angle -= Math.PI * 2;
      while (angle - previous < -Math.PI) angle += Math.PI * 2;
    }
    previous = angle;
    minimum = Math.min(minimum, angle);
    maximum = Math.max(maximum, angle);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return 1;
  // Strongly bending interior spines need a little breathing room. This is
  // deliberately mild: France/Spain edge cases shrink, while long smooth
  // continental arcs retain their hierarchy.
  return clamp(1 - Math.max(0, maximum - minimum - 0.34) * 0.15, 0.84, 1);
};

const intersectsViewport = (points, width, height, padding = 80) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return maxX >= -padding && minX <= width + padding && maxY >= -padding && minY <= height + padding;
};

const labelOpacity = (zoom) => {
  if (zoom <= 2.25) return 0.74;
  if (zoom <= 3.5) return 0.74 + ((zoom - 2.25) / 1.25) * 0.13;
  if (zoom <= 5.8) return 0.87 - ((zoom - 3.5) / 2.3) * 0.07;
  if (zoom >= 7.1) return 0;
  return 0.8 * (1 - (zoom - 5.8) / 1.3);
};

const minimumVisibleSize = (zoom) => {
  if (zoom < 2.65) return 4.25;
  if (zoom < 3.5) return 5.1;
  return 6.25;
};

// Cartographic level of detail: at whole-world scale, only continental powers
// have enough screen territory to carry a useful name. Smaller states enter in
// deliberate bands as the camera approaches instead of all being forced into a
// minimum font size and colliding across Europe/Africa.
const minimumPriorityAtZoom = (zoom) => {
  const stops = [
    [2.25, 205000],
    [2.8, 135000],
    [3.3, 82000],
    [3.8, 50000],
    [4.4, 25000],
    [5.2, 8000],
    [6, 0],
  ];
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [rightZoom, rightValue] = stops[index];
    const [leftZoom, leftValue] = stops[index - 1];
    if (zoom > rightZoom) continue;
    const ratio = (zoom - leftZoom) / (rightZoom - leftZoom);
    return leftValue + (rightValue - leftValue) * ratio;
  }
  return 0;
};

const measureAdvances = (context, glyphs, fontSize, letterSpacingEm) => {
  const letterSpacing = fontSize * letterSpacingEm;
  const advances = glyphs.map((glyph) => (
    glyph === " "
      ? fontSize * 0.42 + letterSpacing
      : context.measureText(glyph).width + letterSpacing
  ));
  return {
    advances,
    total: advances.reduce((sum, advance) => sum + advance, 0),
  };
};

const drawPathLabel = ({
  context,
  map,
  feature,
  coordinates,
  longitudeShift,
  width,
  height,
  zoom,
  fontFamily,
  fillColor,
  haloColor,
  opacity,
  minimumPriority,
}) => {
  if ((Number(feature?.properties?.priorityScale) || 0) < minimumPriority) return;
  let points = coordinates.map(([lng, lat]) => map.project([Number(lng) + longitudeShift, Number(lat)]));
  if (points.length < 4 || !intersectsViewport(points, width, height)) return;
  if (points.at(-1).x < points[0].x) points = [...points].reverse();

  const { cumulative, length } = polylineMetrics(points);
  if (length < 12) return;

  const name = String(feature?.properties?.name ?? "").trim();
  if (!name) return;
  const glyphs = Array.from(name);
  const letterSpacingEm = clamp(Number(feature?.properties?.letterSpacing) || 0.1, 0.045, 0.18);
  const pathWidth = Number(feature?.properties?.pathWidth) || 0;
  const pathLength = Number(feature?.properties?.pathLength) || 1;
  const projectedThickness = pathWidth > 0 ? pathWidth * (length / pathLength) : Infinity;
  const estimatedUnits = glyphs.reduce((sum, glyph) => sum + (glyph === " " ? 0.44 : 0.62 + letterSpacingEm), 0);
  // Keep continental powers dominant without letting them consume the entire
  // composition. The lower readable-size threshold above then admits a second
  // tier of medium polities instead of making the map feel empty.
  const maximumSize = clamp(49 + Math.max(0, zoom - 2.5) * 9, 49, 82);
  let fontSize = Math.min(
    maximumSize,
    (length * 0.90) / Math.max(1, estimatedUnits),
    Number.isFinite(projectedThickness) ? projectedThickness * 0.62 : maximumSize,
  );
  fontSize *= angleSpreadScale(points, cumulative, length);
  if (fontSize < minimumVisibleSize(zoom)) return;

  const fontWeight = fontSize >= 14 ? 600 : 700;
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  let measured = measureAdvances(context, glyphs, fontSize, letterSpacingEm);
  const availableLength = length * 0.9;
  if (measured.total > availableLength) {
    fontSize *= availableLength / measured.total;
    if (fontSize < minimumVisibleSize(zoom)) return;
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    measured = measureAdvances(context, glyphs, fontSize, letterSpacingEm);
  }

  let cursor = (length - measured.total) / 2;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.miterLimit = 2;

  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const advance = measured.advances[index];
    const sampleDistance = cursor + advance / 2;
    const sample = pointAlong(points, cumulative, sampleDistance);
    cursor += advance;
    if (!sample || glyph === " ") continue;

    // Average the local tangent rather than snapping each glyph to one raw
    // polyline segment. Compact irregular states then bend smoothly instead of
    // producing a sharp kink between adjacent letters.
    const tangentSpan = Math.max(4, fontSize * 0.72);
    const before = pointAlong(points, cumulative, sampleDistance - tangentSpan);
    const after = pointAlong(points, cumulative, sampleDistance + tangentSpan);
    const smoothedAngle = before && after
      ? Math.atan2(after.y - before.y, after.x - before.x)
      : sample.angle;

    context.save();
    context.translate(sample.x, sample.y);
    context.rotate(smoothedAngle);
    context.globalAlpha = opacity;
    context.strokeStyle = haloColor;
    context.lineWidth = clamp(fontSize * 0.105, 1.15, 3.25);
    context.strokeText(glyph, 0, 0);
    context.fillStyle = fillColor;
    context.fillText(glyph, 0, 0);
    context.restore();
  }
};

const drawPointLabel = ({ context, map, feature, longitudeShift, width, height, zoom, fontFamily, fillColor, haloColor, opacity, minimumPriority }) => {
  if ((Number(feature?.properties?.priorityScale) || 0) < minimumPriority) return;
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  const point = map.project([lng + longitudeShift, lat]);
  if (point.x < -80 || point.x > width + 80 || point.y < -50 || point.y > height + 50) return;
  const name = String(feature?.properties?.name ?? "").trim();
  if (!name) return;
  const areaScale = Number(feature?.properties?.areaScale) || 1;
  const projectionScale = 2 ** (zoom - 3);
  const shapeWidth = (Number(feature?.properties?.shapeWidth) || 0) * projectionScale;
  const shapeHeight = (Number(feature?.properties?.shapeHeight) || 0) * projectionScale;
  const estimatedUnits = Array.from(name).reduce((sum, glyph) => sum + (glyph === " " ? 0.42 : 0.64), 0);
  const areaSize = areaScale * 0.86 * (2 ** (zoom - 16));
  const widthFit = shapeWidth > 0 ? (shapeWidth * 0.82) / Math.max(1, estimatedUnits) : areaSize;
  const heightFit = shapeHeight > 0 ? shapeHeight * 0.6 : areaSize;
  const fontSize = Math.min(areaSize, widthFit, heightFit, 54);
  // Never inflate a long legal name just to hit a minimum readable size. If it
  // cannot fit yet, its correct LOD is the next zoom band.
  if (fontSize < minimumVisibleSize(zoom)) return;
  context.save();
  context.translate(point.x, point.y);
  context.rotate((Number(feature?.properties?.rotation) || 0) * (Math.PI / 180));
  context.font = `700 ${fontSize}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.globalAlpha = opacity;
  context.strokeStyle = haloColor;
  context.lineWidth = clamp(fontSize * 0.11, 1.1, 2.8);
  context.strokeText(name, 0, 0);
  context.fillStyle = fillColor;
  context.fillText(name, 0, 0);
  context.restore();
};

const PolityLabelsCanvas = ({
  map,
  lineData,
  pointData,
  fontStack,
  fillColor = "rgba(247, 246, 240, 0.94)",
  haloColor = "rgba(7, 10, 14, 0.78)",
  visible = true,
}) => {
  const canvasRef = useRef(null);
  const drawRef = useRef(() => {});
  const configRef = useRef({});
  configRef.current = { lineData, pointData, fontStack, fillColor, haloColor, visible };

  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    const container = mapInstance?.getContainer?.();
    if (!mapInstance || !container) return undefined;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "2";
    canvas.style.transformOrigin = "0 0";
    canvas.style.willChange = "transform";
    const controls = container.querySelector(".maplibregl-control-container");
    container.insertBefore(canvas, controls || null);
    canvasRef.current = canvas;

    let cameraAnchor = null;
    const captureCameraAnchor = (cssWidth, cssHeight) => {
      if (!mapInstance.unproject || cssWidth <= 0 || cssHeight <= 0) return null;
      const lngLatAt = (x, y) => {
        const value = mapInstance.unproject([x, y]);
        return [Number(value.lng), Number(value.lat)];
      };
      return {
        width: cssWidth,
        height: cssHeight,
        topLeft: lngLatAt(0, 0),
        topRight: lngLatAt(cssWidth, 0),
        bottomLeft: lngLatAt(0, cssHeight),
      };
    };

    const draw = () => {
      const config = configRef.current;
      const cssWidth = container.clientWidth;
      const cssHeight = container.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      canvas.style.transform = "none";
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      if (!config.visible) {
        canvas.style.opacity = "0";
        cameraAnchor = null;
        return;
      }

      const zoom = mapInstance.getZoom?.() ?? 0;
      const opacity = labelOpacity(zoom);
      if (opacity <= 0) {
        canvas.style.opacity = "0";
        cameraAnchor = null;
        return;
      }
      canvas.style.opacity = "1";
      const minimumPriority = minimumPriorityAtZoom(zoom);
      const fontFamily = cssFontStack(config.fontStack) || "Georgia, serif";
      const lines = [...(config.lineData?.features ?? [])]
        .sort((a, b) => (Number(a?.properties?.priorityScale) || 0) - (Number(b?.properties?.priorityScale) || 0));
      const points = [...(config.pointData?.features ?? [])]
        .sort((a, b) => (Number(a?.properties?.priorityScale) || 0) - (Number(b?.properties?.priorityScale) || 0));

      for (const feature of lines) {
        const coordinates = feature?.geometry?.coordinates ?? [];
        for (const longitudeShift of WORLD_SHIFTS) {
          drawPathLabel({
            context,
            map: mapInstance,
            feature,
            coordinates,
            longitudeShift,
            width: cssWidth,
            height: cssHeight,
            zoom,
            fontFamily,
            fillColor: config.fillColor,
            haloColor: config.haloColor,
            opacity,
            minimumPriority,
          });
        }
      }
      for (const feature of points) {
        for (const longitudeShift of WORLD_SHIFTS) {
          drawPointLabel({
            context,
            map: mapInstance,
            feature,
            longitudeShift,
            width: cssWidth,
            height: cssHeight,
            zoom,
            fontFamily,
            fillColor: config.fillColor,
            haloColor: config.haloColor,
            opacity,
            minimumPriority,
          });
        }
      }
      cameraAnchor = captureCameraAnchor(cssWidth, cssHeight);
    };

    let scheduledFrame = 0;
    const scheduleDraw = () => {
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = 0;
        draw();
      });
    };
    let transformFrame = 0;
    const transformWithCamera = () => {
      transformFrame = 0;
      if (!cameraAnchor || !mapInstance.project) return;
      const topLeft = mapInstance.project(cameraAnchor.topLeft);
      const topRight = mapInstance.project(cameraAnchor.topRight);
      const bottomLeft = mapInstance.project(cameraAnchor.bottomLeft);
      const { width: anchorWidth, height: anchorHeight } = cameraAnchor;
      if (!anchorWidth || !anchorHeight) return;
      const a = (topRight.x - topLeft.x) / anchorWidth;
      const b = (topRight.y - topLeft.y) / anchorWidth;
      const c = (bottomLeft.x - topLeft.x) / anchorHeight;
      const d = (bottomLeft.y - topLeft.y) / anchorHeight;
      if (![a, b, c, d, topLeft.x, topLeft.y].every(Number.isFinite)) return;
      canvas.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${topLeft.x}, ${topLeft.y})`;
    };
    const scheduleCameraTransform = () => {
      if (transformFrame) return;
      transformFrame = requestAnimationFrame(transformWithCamera);
    };
    const finishCameraTransform = () => {
      if (transformFrame) cancelAnimationFrame(transformFrame);
      transformFrame = 0;
      scheduleDraw();
    };
    drawRef.current = scheduleDraw;
    // Transform the completed bitmap with the same flat-map camera motion, then
    // redraw once at rest for perfectly sharp glyphs. Labels stay geographically
    // bound without rebuilding every curved word on every animation frame.
    mapInstance.on("move", scheduleCameraTransform);
    mapInstance.on("moveend", finishCameraTransform);
    mapInstance.on("resize", scheduleDraw);
    scheduleDraw();

    return () => {
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
      if (transformFrame) cancelAnimationFrame(transformFrame);
      mapInstance.off("move", scheduleCameraTransform);
      mapInstance.off("moveend", finishCameraTransform);
      mapInstance.off("resize", scheduleDraw);
      drawRef.current = () => {};
      canvas.remove();
      canvasRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => drawRef.current());
    return () => cancelAnimationFrame(frame);
  }, [fillColor, fontStack, haloColor, lineData, pointData, visible]);

  return null;
};

export default PolityLabelsCanvas;
