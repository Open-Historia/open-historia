import { MercatorCoordinate } from "maplibre-gl";
import {
  canonicalSingleArcFromPolyline,
  cumulativeArcLengths,
  extractCenteredSubpathByArcLength,
  resamplePolylineByArcLength,
  sampleCubicBezier,
  smoothPolylineChaikin,
  signedBendMetrics,
  singleArcFromAxis,
} from "./polityTextSpline.js";
import { rasterizePolityText } from "./polityTextRasterizer.js";
import {
  planMetricTextSupport,
  planTerritorialTextSupport,
  polityTextOpacityAtZoom,
  scalePolityTextSupportPoints,
} from "./polityTextLayout.js";
import { optimizeTerritorialArcPlacement } from "./polityTextPlacement.js";

export const POLITY_TEXT_RENDERER_LAYER_ID = "polity-text-renderer";
const RASTER_FONT_SIZE_PX = 128;
const GPU_UPLOADS_PER_FRAME = 12;

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Polity text shader compilation failed: ${log}`);
  }
  return shader;
};

const createProgram = (gl, vertexSource, fragmentSource) => {
  const program = gl.createProgram();
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Polity text shader linking failed: ${log}`);
  }
  return program;
};

// ------------- Projection -------------
const PROJECTION_VERTEX_INPUT = "a_pos";

// Pre-v5 MapLibre had no shaderData/projection uniforms, only a mercator matrix.
// Keep a working mercator-only path there instead of failing to render.
const LEGACY_SHADER_DATA = Object.freeze({
  variantName: "legacy-mercator",
  define: "",
  vertexShaderPrelude: `const float PI = 3.141592653589793;
uniform mat4 u_projection_matrix;
vec4 projectTile(vec2 p) {
  return u_projection_matrix * vec4(p, 0.0, 1.0);
}`,
});

const shaderDataFromRenderArgs = (args) => {
  const shaderData = args?.shaderData;
  if (typeof shaderData?.vertexShaderPrelude === "string" && shaderData.variantName) {
    return { define: "", ...shaderData };
  }
  return LEGACY_SHADER_DATA;
};

const legacyMatrixFromRenderArgs = (args) => {
  if (args?.defaultProjectionData?.mainMatrix) return args.defaultProjectionData.mainMatrix;
  if (args?.modelViewProjectionMatrix) return args.modelViewProjectionMatrix;
  if (Array.isArray(args) || ArrayBuffer.isView(args)) return args;
  return null;
};

const projectionDataFromRenderArgs = (args) => {
  const data = args?.defaultProjectionData;
  if (data?.mainMatrix) return data;
  const mainMatrix = legacyMatrixFromRenderArgs(args);
  if (!mainMatrix) return null;
  return {
    mainMatrix,
    fallbackMatrix: mainMatrix,
    tileMercatorCoords: [0, 0, 1, 1],
    clippingPlane: [0, 0, 0, 0],
    projectionTransition: 0,
  };
};

// MapLibre deliberately hands custom layers 64-bit matrices so CPU-side
// transforms keep their precision. uniformMatrix4fv wants a Float32Array, and
// letting WebIDL coerce a Float64Array every frame allocates; convert into a
// buffer owned by the layer instead.
const writeFloat32Matrix = (matrix, target) => {
  if (!matrix) return null;
  if (matrix instanceof Float32Array) return matrix;
  for (let index = 0; index < 16; index += 1) target[index] = Number(matrix[index]) || 0;
  return target;
};

// > 0 means the globe is contributing to this frame (1 = fully globe, fractional
// during the globe<->mercator animation at high zoom).
const isGlobeContributing = (projection) => Number(projection?.projectionTransition ?? 0) > 0.0001;

const projectionUniformLocations = (gl, program) => ({
  matrix: gl.getUniformLocation(program, "u_projection_matrix"),
  tileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
  clippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
  transition: gl.getUniformLocation(program, "u_projection_transition"),
  fallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
});

// `#version` must be the first line; the prelude carries no version directive.
// `define` follows the prelude exactly as MapLibre's custom-layer docs specify.
const buildTextureVertexSource = (shaderData) => `#version 300 es
precision highp float;
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 ${PROJECTION_VERTEX_INPUT};
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = projectTile(${PROJECTION_VERTEX_INPUT});
  v_uv = a_uv;
}
`;

const buildLineVertexSource = (shaderData) => `#version 300 es
precision highp float;
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 ${PROJECTION_VERTEX_INPUT};
void main() {
  gl_Position = projectTile(${PROJECTION_VERTEX_INPUT});
}
`;

const TEXTURE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform float u_opacity;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 texel = texture(u_texture, v_uv);
  fragColor = vec4(texel.rgb, texel.a * u_opacity);
}
`;

const LINE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0, 0.86, 0.0, 0.58);
}
`;

const mercatorPointsFromLngLat = (lngLatPoints) => lngLatPoints.map(([lng, lat]) => {
  const coordinate = MercatorCoordinate.fromLngLat({ lng, lat });
  return [coordinate.x, coordinate.y];
});

export const buildRibbonVertices = ({ points, aspectRatio }) => {
  const { cumulative, total } = cumulativeArcLengths(points);
  if (points.length < 2 || total <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return new Float32Array();
  }

  // The support-window arc length is selected from the raster's natural width,
  // so one map-space scale factor drives both axes and the font cannot stretch.
  const ribbonHeight = total / aspectRatio;
  const halfHeight = ribbonHeight / 2;
  const vertices = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    let tx = next[0] - previous[0];
    let ty = next[1] - previous[1];
    const length = Math.hypot(tx, ty) || 1;
    tx /= length;
    ty /= length;
    const nx = ty;
    const ny = -tx;
    const [x, y] = points[index];
    const u = cumulative[index] / total;

    vertices.push(x + nx * halfHeight, y + ny * halfHeight, u, 1);
    vertices.push(x - nx * halfHeight, y - ny * halfHeight, u, 0);
  }

  return new Float32Array(vertices);
};

const buildLineVertices = (points) => new Float32Array(points.flat());

const boundsFromRibbonVertices = (vertices) => {
  if (!vertices?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < vertices.length; index += 4) {
    const x = Number(vertices[index]);
    const y = Number(vertices[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
};

const viewportMercatorBounds = (map) => {
  const bounds = map?.getBounds?.();
  if (!bounds) return null;
  const west = Number(bounds.getWest?.());
  const east = Number(bounds.getEast?.());
  const south = Number(bounds.getSouth?.());
  const north = Number(bounds.getNorth?.());
  if (![west, east, south, north].every(Number.isFinite)) return null;
  const span = east - west;
  // Wrapped/world-scale views can legitimately display more than one world
  // copy. Skip culling there rather than risking a missing label. Regional
  // views are where culling pays off and where these bounds are unambiguous.
  if (!(span > 0 && span < 170) || west < -180 || east > 180) return null;
  const sw = MercatorCoordinate.fromLngLat({ lng: west, lat: south });
  const ne = MercatorCoordinate.fromLngLat({ lng: east, lat: north });
  const minX = Math.min(sw.x, ne.x);
  const maxX = Math.max(sw.x, ne.x);
  const minY = Math.min(sw.y, ne.y);
  const maxY = Math.max(sw.y, ne.y);
  const padX = Math.max(0.002, (maxX - minX) * 0.04);
  const padY = Math.max(0.002, (maxY - minY) * 0.04);
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
};

const boundsOverlap = (left, right) => Boolean(
  !left
  || !right
  || (
    left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minY <= right.maxY
    && left.maxY >= right.minY
  )
);

const sortPreparedEntries = (entries) => [...entries].sort((left, right) => (
  Number(left?.record?.priorityScale ?? 0) - Number(right?.record?.priorityScale ?? 0)
));

const releaseEntryGpuResources = (gl, entry) => {
  if (!entry) return;
  if (gl && !gl.isContextLost?.()) {
    try { if (entry.ribbonBuffer) gl.deleteBuffer(entry.ribbonBuffer); } catch {}
    try { if (entry.lineBuffer) gl.deleteBuffer(entry.lineBuffer); } catch {}
    try { if (entry.texture) gl.deleteTexture(entry.texture); } catch {}
  }
  entry.ribbonBuffer = null;
  entry.lineBuffer = null;
  entry.texture = null;
};

const defaultPtr0Record = () => ({
  id: "ptr0-russia-proof",
  owner: "Russian Federation",
  text: "RUSSIAN FEDERATION",
  baseline: sampleCubicBezier({
    p0: [37, 52.0],
    p1: [55, 62.6],
    p2: [98, 63.0],
    p3: [120, 54.0],
    samples: 256,
  }),
  minZoom: 0,
  maxZoom: 24,
  priorityScale: 1,
  fontPxAtZoom4: 64,
  letterSpacingEm: 0.055,
});

export const measurePolityTextRenderRecord = ({
  record,
  fontFamilies,
  fillStyle,
  haloStyle,
  haloWidthPx = 5,
  samples = 128,
}) => {
  const baselineLngLat = Array.isArray(record?.baseline) ? record.baseline : [];
  const anchorLngLat = Array.isArray(record?.anchor) && record.anchor.length >= 2
    ? record.anchor
    : null;
  const hasTerritorialEnvelope = (
    anchorLngLat
    && Number(record?.ptrAxisSpanWorld) > 0
    && Number(record?.ptrCrossSpanWorld) > 0
  );
  if (baselineLngLat.length < 2 && !hasTerritorialEnvelope) return null;

  const raster = rasterizePolityText({
    text: record.text,
    fontFamilies,
    fontSizePx: RASTER_FONT_SIZE_PX,
    letterSpacingEm: record.letterSpacingEm,
    fillStyle,
    haloStyle,
    haloWidthPx,
  });

  const requestedFontPxAtZoom4 = Math.max(6, Number(record.fontPxAtZoom4) || 24);
  const rawMercator = baselineLngLat.length >= 2
    ? mercatorPointsFromLngLat(baselineLngLat)
    : [];
  const smoothMercator = rawMercator.length >= 2
    ? smoothPolylineChaikin(rawMercator, 4)
    : [];
  const denseMercator = smoothMercator.length >= 2
    ? resamplePolylineByArcLength(smoothMercator, Math.max(192, samples * 2))
    : [];
  const measuredBaselineLength = denseMercator.length >= 2
    ? cumulativeArcLengths(denseMercator).total
    : 0;
  const baselineLength = measuredBaselineLength > 0
    ? measuredBaselineLength
    : Number(record?.ptrAxisSpanWorld) || 0;
  if (!(baselineLength > 0)) return null;

  if (hasTerritorialEnvelope) {
    const metricPlan = planTerritorialTextSupport({
      rasterWidthPx: raster.width,
      rasterHeightPx: raster.height,
      rasterFontSizePx: raster.fontSizePx,
      axisSpanWorld: Number(record.ptrAxisSpanWorld),
      crossSpanWorld: Number(record.ptrCrossSpanWorld),
      targetSpanFraction: 0.93,
      maxHeightFraction: 0.42,
    });
    const anchorCoordinate = MercatorCoordinate.fromLngLat({
      lng: Number(anchorLngLat[0]),
      lat: Number(anchorLngLat[1]),
    });
    const sourceBend = denseMercator.length >= 2
      ? signedBendMetrics(denseMercator)
      : { sign: 1, bendRatio: 0 };
    const bendSign = sourceBend.sign || 1;
    const bendRatio = Math.min(
      0.085,
      Math.max(0.022, Number(sourceBend.bendRatio || 0) * 1.2),
    );
    const heightLimitedSupport = metricPlan.maxHeightWorld > 0
      ? metricPlan.maxHeightWorld * raster.aspectRatio
      : Number(record.ptrAxisSpanWorld) * 0.98;
    const placementTask = record.ptrCoverageGrid && record.placementMode !== "fast"
      ? {
          anchor: [anchorCoordinate.x, anchorCoordinate.y],
          preferredAngleDeg: Number(record.ptrPreferredAngle) || 0,
          axisSpanWorld: Number(record.ptrAxisSpanWorld),
          crossSpanWorld: Number(record.ptrCrossSpanWorld),
          desiredSupportLength: metricPlan.supportLength,
          maxSupportLength: Math.min(
            Number(record.ptrAxisSpanWorld) * 0.98,
            heightLimitedSupport,
          ),
          bendRatio,
          bendSign,
          aspectRatio: raster.aspectRatio,
          coverageGrid: record.ptrCoverageGrid,
          samples,
        }
      : null;
    const fallbackSupportPoints = singleArcFromAxis({
      center: [anchorCoordinate.x, anchorCoordinate.y],
      angleDeg: Number(record.ptrPreferredAngle) || 0,
      chordLength: metricPlan.supportLength,
      bendRatio,
      bendSign,
      samples,
    });

    return {
      record,
      raster,
      samples,
      hasTerritorialEnvelope: true,
      baselineLength,
      renderBaselineLength: Number(record.ptrAxisSpanWorld),
      requestedFontPxAtZoom4,
      metricPlan,
      placementTask,
      fallbackSupportPoints,
      visualScaleCenter: [anchorCoordinate.x, anchorCoordinate.y],
    };
  }

  const metricPlan = planMetricTextSupport({
    rasterWidthPx: raster.width,
    rasterFontSizePx: raster.fontSizePx,
    requestedFontPxAtZoom4,
    baselineLength,
    minSupportFraction: 0.86,
    maxSupportFraction: 0.97,
    maxUpscaleFactor: 3.5,
  });
  const rawSupportPoints = extractCenteredSubpathByArcLength(
    denseMercator,
    metricPlan.supportLength,
    { samples: Math.max(64, samples), centerFraction: 0.5 },
  );
  const supportPoints = canonicalSingleArcFromPolyline(rawSupportPoints, {
    samples,
    bendScale: 1.02,
    minBendRatio: 0.006,
    maxBendRatio: 0.072,
  });

  return {
    record,
    raster,
    samples,
    hasTerritorialEnvelope: false,
    baselineLength,
    renderBaselineLength: baselineLength,
    requestedFontPxAtZoom4,
    metricPlan,
    placementTask: null,
    fallbackSupportPoints: supportPoints,
  };
};

export const finalizePolityTextRenderRecord = ({
  plan,
  optimizedPlacement = null,
  placementResolved = false,
} = {}) => {
  if (!plan) return null;

  const {
    record,
    raster,
    metricPlan,
    baselineLength,
    renderBaselineLength,
    requestedFontPxAtZoom4,
    placementTask,
    fallbackSupportPoints,
    visualScaleCenter,
  } = plan;

  // The production PTR path resolves territorial search in a dedicated worker.
  // Direct callers/tests still retain the synchronous fallback for compatibility,
  // but custom-layer construction no longer needs to perform expensive search.
  const optimized = placementTask
    ? (placementResolved ? optimizedPlacement : optimizeTerritorialArcPlacement(placementTask))
    : null;
  const placedSupportPoints = optimized?.points ?? fallbackSupportPoints;
  const supportPoints = plan.hasTerritorialEnvelope
    ? scalePolityTextSupportPoints({
        points: placedSupportPoints,
        center: optimized?.center ?? visualScaleCenter,
      })
    : placedSupportPoints;
  const supportLength = cumulativeArcLengths(supportPoints).total;
  if (!(supportLength > 0)) return null;

  const effectiveFontPxAtZoom4 = metricPlan.effectiveFontPxAtZoom4
    * (supportLength / Math.max(metricPlan.supportLength, 1e-15));
  const placementDiagnostics = optimized ? {
    score: optimized.score,
    evaluated: optimized.evaluated,
    coarseEvaluated: optimized.coarseEvaluated,
    refinedSeeds: optimized.refinedSeeds,
    ownCoverage: optimized.ownCoverage,
    centerlineCoverage: optimized.centerlineCoverage,
    internalGapFraction: optimized.internalGapFraction,
    edgeOutsideFraction: optimized.edgeOutsideFraction,
    chordLength: optimized.chordLength,
    spanUsage: optimized.spanUsage,
    crossCentering: optimized.crossCentering,
    axisCentering: optimized.axisCentering,
    selectedAngle: optimized.angleDeg,
    preferredAngle: optimized.preferredAngleDeg,
    center: optimized.center,
  } : null;

  const ribbonVertices = buildRibbonVertices({ points: supportPoints, aspectRatio: raster.aspectRatio });
  return {
    record,
    raster,
    supportPoints,
    ribbonVertices,
    mercatorBounds: boundsFromRibbonVertices(ribbonVertices),
    lineVertices: buildLineVertices(supportPoints),
    supportLength,
    baselineLength: renderBaselineLength,
    effectiveFontPxAtZoom4,
    requestedFontPxAtZoom4,
    supportFraction: renderBaselineLength > 0
      ? supportLength / renderBaselineLength
      : metricPlan.supportFraction,
    naturalSupportFraction: metricPlan.naturalSupportFraction ?? null,
    placementDiagnostics,
    texture: null,
    ribbonBuffer: null,
    lineBuffer: null,
    ribbonVertexCount: supportPoints.length * 2,
    lineVertexCount: supportPoints.length,
  };
};

export const preparePolityTextRenderRecord = (options) => {
  const plan = measurePolityTextRenderRecord(options);
  return finalizePolityTextRenderRecord({ plan });
};


const ensureEntryGpuResources = (gl, entry, { debugBaseline = false } = {}) => {
  if (!entry || entry.texture || entry.ribbonBuffer) return Boolean(entry?.texture && entry?.ribbonBuffer);
  if (gl.isContextLost?.()) return false;

  const ribbonBuffer = gl.createBuffer();
  const lineBuffer = debugBaseline ? gl.createBuffer() : null;
  const texture = gl.createTexture();
  if (!ribbonBuffer || !texture || (debugBaseline && !lineBuffer)) {
    if (ribbonBuffer) gl.deleteBuffer(ribbonBuffer);
    if (lineBuffer) gl.deleteBuffer(lineBuffer);
    if (texture) gl.deleteTexture(texture);
    return false;
  }

  try {
    gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, entry.ribbonVertices, gl.STATIC_DRAW);

    if (debugBaseline) {
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, entry.lineVertices, gl.STATIC_DRAW);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.raster.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);

    entry.ribbonBuffer = ribbonBuffer;
    entry.lineBuffer = lineBuffer;
    entry.texture = texture;
    return true;
  } catch (error) {
    gl.deleteBuffer(ribbonBuffer);
    if (lineBuffer) gl.deleteBuffer(lineBuffer);
    gl.deleteTexture(texture);
    entry.ribbonBuffer = null;
    entry.lineBuffer = null;
    entry.texture = null;
    throw error;
  } finally {
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
};

export const createPolityTextCustomLayer = ({
  id = POLITY_TEXT_RENDERER_LAYER_ID,
  records = null,
  preparedEntries = null,
  fontFamilies = ["Georgia", "Times New Roman", "serif"],
  fillStyle = "rgba(255, 52, 214, 1)",
  haloStyle = "rgba(0, 0, 0, 0.96)",
  haloWidthPx = 5,
  samples = 128,
  debugBaseline = true,
  // diagnostics only
  isGlobe = false,
} = {}) => {
  const sourceRecords = Array.isArray(records) && records.length ? records : [defaultPtr0Record()];
  const prepared = Array.isArray(preparedEntries)
    ? preparedEntries.filter(Boolean)
    : sourceRecords
      .map((record) => preparePolityTextRenderRecord({
        record,
        fontFamilies,
        fillStyle,
        haloStyle,
        haloWidthPx,
        samples,
      }))
      .filter(Boolean);
  // Draw priority changes only when the prepared entry set changes. Sorting at
  // construction / atomic entry replacement avoids allocating + sorting the
  // same label list on every animation frame.
  const drawOrder = sortPreparedEntries(prepared);

  return {
    id,
    type: "custom",
    renderingMode: "2d",
    _map: null,
    _gl: null,
    _textureProgram: null,
    _lineProgram: null,
    _entries: prepared,
    _drawOrder: drawOrder,
    _pendingEntries: null,
    _pendingDrawOrder: null,
    _visibleEntries: new Array(drawOrder.length),
    _visibleOpacity: new Float32Array(drawOrder.length),
    _textureLocations: null,
    _lineLocations: null,
    _programVariant: null,
    _failedProgramVariant: null,
    _mainMatrixF32: new Float32Array(16),
    _fallbackMatrixF32: new Float32Array(16),
    _didLogFirstRender: false,
    _didWarnMissingMatrix: false,

    onAdd(map, gl) {
      this._map = map;
      this._gl = gl;
      console.info("[map] PTR custom layer onAdd", {
        labels: prepared.map((entry) => ({
          owner: entry.record.owner,
          text: entry.record.text,
          requestedFontPxAtZoom4: Number(entry.requestedFontPxAtZoom4.toFixed(2)),
          effectiveFontPxAtZoom4: Number(entry.effectiveFontPxAtZoom4.toFixed(2)),
          supportShare: Number((entry.supportLength / entry.baselineLength).toFixed(3)),
          plannedSupportShare: Number((entry.supportFraction ?? 0).toFixed(3)),
          naturalSupportShare: Number((entry.naturalSupportFraction ?? 0).toFixed(3)),
          placement: entry.placementDiagnostics ? {
            ownCoverage: Number(entry.placementDiagnostics.ownCoverage.toFixed(3)),
            centerlineCoverage: Number(entry.placementDiagnostics.centerlineCoverage.toFixed(3)),
            internalGapFraction: Number(entry.placementDiagnostics.internalGapFraction.toFixed(3)),
            edgeOutsideFraction: Number(entry.placementDiagnostics.edgeOutsideFraction.toFixed(3)),
            spanUsage: Number(entry.placementDiagnostics.spanUsage.toFixed(3)),
            crossCentering: Number(entry.placementDiagnostics.crossCentering.toFixed(3)),
            selectedAngle: Number(entry.placementDiagnostics.selectedAngle.toFixed(1)),
            preferredAngle: Number(entry.placementDiagnostics.preferredAngle.toFixed(1)),
            candidates: entry.placementDiagnostics.evaluated,
          } : null,
        })),
      });

      // Shaders are NOT compiled here. Their source depends on the projection
      // prelude MapLibre supplies per frame, and the projection can change
      // without the layer being re-added. They are compiled on first render and
      // recompiled whenever the projection variant changes.
      this._programVariant = null;
      this._failedProgramVariant = null;

      // Do NOT eagerly allocate every polity texture/buffer here. A historical
      // world can carry 200+ labels, and initial mount / style remount must stay
      // bounded even though mid-campaign ownership updates are now incremental.
      // Uploading the whole atlas in one WebGL turn caused large transient GPU
      // allocation spikes and could lose the map's context while the surrounding
      // React UI stayed alive. Resources are created lazily for visible labels
      // in small per-frame batches below.
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },

    // Compile against the CURRENT projection's prelude. MapLibre changes
    // `shaderData.variantName` whenever that prelude changes, so it is the cache
    // key. A globe/mercator toggle therefore swaps programs without touching any
    // prepared label geometry.
    _ensurePrograms(gl, shaderData) {
      if (this._textureProgram && this._programVariant === shaderData.variantName) return true;
      if (this._failedProgramVariant === shaderData.variantName) return false;
      if (gl.isContextLost?.()) return false;

      let textureProgram = null;
      let lineProgram = null;
      try {
        textureProgram = createProgram(gl, buildTextureVertexSource(shaderData), TEXTURE_FRAGMENT_SOURCE);
        lineProgram = debugBaseline
          ? createProgram(gl, buildLineVertexSource(shaderData), LINE_FRAGMENT_SOURCE)
          : null;
      } catch (error) {
        if (textureProgram) gl.deleteProgram(textureProgram);
        if (lineProgram) gl.deleteProgram(lineProgram);
        this._failedProgramVariant = shaderData.variantName;
        console.warn("[map] PTR could not compile shaders for projection variant", {
          variantName: shaderData.variantName,
          error: String(error?.message ?? error ?? "unknown"),
        });
        return false;
      }

      if (this._textureProgram) gl.deleteProgram(this._textureProgram);
      if (this._lineProgram) gl.deleteProgram(this._lineProgram);

      this._textureProgram = textureProgram;
      this._lineProgram = lineProgram;
      this._textureLocations = {
        ...projectionUniformLocations(gl, textureProgram),
        texture: gl.getUniformLocation(textureProgram, "u_texture"),
        opacity: gl.getUniformLocation(textureProgram, "u_opacity"),
        position: gl.getAttribLocation(textureProgram, PROJECTION_VERTEX_INPUT),
        uv: gl.getAttribLocation(textureProgram, "a_uv"),
      };
      this._lineLocations = lineProgram ? {
        ...projectionUniformLocations(gl, lineProgram),
        position: gl.getAttribLocation(lineProgram, PROJECTION_VERTEX_INPUT),
      } : null;
      this._programVariant = shaderData.variantName;
      this._failedProgramVariant = null;
      console.info("[map] PTR shaders compiled for projection", {
        variantName: shaderData.variantName,
        reactIsGlobe: Boolean(isGlobe),
      });
      return true;
    },

    // Under mercator only `u_projection_matrix` exists and the rest resolve to
    // null locations, which WebGL treats as no-ops.
    _applyProjectionUniforms(gl, locations, projection) {
      if (!locations) return;
      if (locations.matrix) {
        gl.uniformMatrix4fv(
          locations.matrix,
          false,
          writeFloat32Matrix(projection.mainMatrix, this._mainMatrixF32),
        );
      }
      if (locations.tileMercatorCoords) {
        // Custom-layer projection data is always set up so projectTile() takes
        // mercator [0,1] directly, which is exactly what the ribbon buffers hold.
        gl.uniform4fv(locations.tileMercatorCoords, projection.tileMercatorCoords ?? [0, 0, 1, 1]);
      }
      if (locations.clippingPlane) {
        gl.uniform4fv(locations.clippingPlane, projection.clippingPlane ?? [0, 0, 0, 0]);
      }
      if (locations.transition) {
        gl.uniform1f(locations.transition, Number(projection.projectionTransition ?? 0));
      }
      if (locations.fallbackMatrix) {
        gl.uniformMatrix4fv(
          locations.fallbackMatrix,
          false,
          writeFloat32Matrix(projection.fallbackMatrix ?? projection.mainMatrix, this._fallbackMatrixF32),
        );
      }
    },

    replacePreparedEntries(nextEntries = []) {
      const next = Array.isArray(nextEntries) ? nextEntries.filter(Boolean) : [];
      const keep = new Set([...this._entries, ...next]);
      for (const entry of this._pendingEntries ?? []) {
        if (!keep.has(entry)) releaseEntryGpuResources(this._gl, entry);
      }
      // Do not tear down the accepted snapshot immediately. The render loop
      // uploads GPU resources for any NEW visible entries first, while the old
      // labels remain on screen. Only then is the entry set swapped atomically.
      // This removes the final one-frame PTR disappearance after geometry prep.
      this._pendingEntries = next;
      this._pendingDrawOrder = sortPreparedEntries(next);
      this._map?.triggerRepaint?.();
    },

    render(gl, args) {
      const projection = projectionDataFromRenderArgs(args);
      if (!projection) {
        if (!this._didWarnMissingMatrix) {
          this._didWarnMissingMatrix = true;
          console.warn("[map] PTR render received no projection data", args);
        }
        return;
      }
      if (!this._ensurePrograms(gl, shaderDataFromRenderArgs(args))) return;

      const zoom = Number(this._map?.getZoom?.() ?? 0);
      // The mercator AABB cull is only meaningful while the view IS a mercator
      // plane. On the globe, getBounds() describes a lat/lng box around a curved
      // visible cap, and near the horizon or the antimeridian that box can
      // exclude labels that are genuinely on screen. Skip it and let the globe's
      // own clipping plane (applied inside projectTile) discard the far side of
      // the planet instead; a null bounds makes boundsOverlap() pass everything.
      const viewportBounds = isGlobeContributing(projection)
        ? null
        : viewportMercatorBounds(this._map);

      if (this._pendingEntries && this._pendingDrawOrder) {
        let pendingUploads = 0;
        let pendingVisibleMissing = false;
        for (const entry of this._pendingDrawOrder) {
          const opacity = polityTextOpacityAtZoom({
            zoom,
            minZoom: entry.record.minZoom,
            maxZoom: entry.record.maxZoom,
            fadeInZoomSpan: entry.record.fadeInZoomSpan,
            fadeOutStartZoom: entry.record.fadeOutStartZoom,
          });
          if (opacity <= 0.002 || !boundsOverlap(entry.mercatorBounds, viewportBounds)) continue;
          if (entry.texture && entry.ribbonBuffer) continue;
          pendingVisibleMissing = true;
          if (pendingUploads >= GPU_UPLOADS_PER_FRAME) continue;
          try {
            if (ensureEntryGpuResources(gl, entry, { debugBaseline })) pendingUploads += 1;
          } catch (error) {
            if (!gl.isContextLost?.()) {
              console.warn("[map] PTR pending replacement GPU upload failed", {
                owner: entry?.record?.owner ?? "",
                error: String(error?.message ?? error ?? "unknown"),
              });
            }
          }
        }

        // Recheck after this frame's uploads. Until every NEW visible entry is
        // drawable, retain the complete old snapshot rather than exposing a
        // legacy/fallback flash.
        pendingVisibleMissing = this._pendingDrawOrder.some((entry) => {
          const opacity = polityTextOpacityAtZoom({
            zoom,
            minZoom: entry.record.minZoom,
            maxZoom: entry.record.maxZoom,
            fadeInZoomSpan: entry.record.fadeInZoomSpan,
            fadeOutStartZoom: entry.record.fadeOutStartZoom,
          });
          return opacity > 0.002
            && boundsOverlap(entry.mercatorBounds, viewportBounds)
            && !(entry.texture && entry.ribbonBuffer);
        });

        if (!pendingVisibleMissing) {
          const next = this._pendingEntries;
          const nextSet = new Set(next);
          for (const entry of this._entries) {
            if (!nextSet.has(entry)) releaseEntryGpuResources(gl, entry);
          }
          this._entries = next;
          this._drawOrder = this._pendingDrawOrder;
          this._pendingEntries = null;
          this._pendingDrawOrder = null;
          this._visibleEntries = new Array(this._drawOrder.length);
          this._visibleOpacity = new Float32Array(this._drawOrder.length);
        } else if (!gl.isContextLost?.()) {
          this._map?.triggerRepaint?.();
        }
      }

      let visibleCount = 0;
      for (const entry of this._drawOrder) {
        const opacity = polityTextOpacityAtZoom({
          zoom,
          minZoom: entry.record.minZoom,
          maxZoom: entry.record.maxZoom,
          fadeInZoomSpan: entry.record.fadeInZoomSpan,
          fadeOutStartZoom: entry.record.fadeOutStartZoom,
        });
        if (opacity <= 0.002 || !boundsOverlap(entry.mercatorBounds, viewportBounds)) continue;
        this._visibleEntries[visibleCount] = entry;
        this._visibleOpacity[visibleCount] = opacity;
        visibleCount += 1;
      }
      if (!visibleCount) return;

      let uploadsThisFrame = 0;
      let pendingVisibleResources = false;
      for (let index = 0; index < visibleCount; index += 1) {
        const entry = this._visibleEntries[index];
        if (!entry || (entry.texture && entry.ribbonBuffer)) continue;
        if (uploadsThisFrame >= GPU_UPLOADS_PER_FRAME) {
          pendingVisibleResources = true;
          continue;
        }
        try {
          if (ensureEntryGpuResources(gl, entry, { debugBaseline })) uploadsThisFrame += 1;
          else pendingVisibleResources = true;
        } catch (error) {
          pendingVisibleResources = true;
          if (!gl.isContextLost?.()) {
            console.warn("[map] PTR deferred GPU upload failed", {
              owner: entry?.record?.owner ?? "",
              error: String(error?.message ?? error ?? "unknown"),
            });
          }
        }
      }
      if (pendingVisibleResources && !gl.isContextLost?.()) this._map?.triggerRepaint?.();

      if (!this._didLogFirstRender) {
        this._didLogFirstRender = true;
        console.info("[map] PTR first WebGL render", {
          zoom,
          projectionVariant: this._programVariant,
          projectionTransition: Number(projection.projectionTransition ?? 0),
          visibleOwners: this._visibleEntries.slice(0, visibleCount).map((entry) => entry.record.owner),
        });
      }

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      if (debugBaseline && this._lineProgram && this._lineLocations) {
        gl.useProgram(this._lineProgram);
        this._applyProjectionUniforms(gl, this._lineLocations, projection);
        gl.enableVertexAttribArray(this._lineLocations.position);
        for (let index = 0; index < visibleCount; index += 1) {
          const entry = this._visibleEntries[index];
          if (!entry?.lineBuffer) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.lineBuffer);
          gl.vertexAttribPointer(this._lineLocations.position, 2, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.LINE_STRIP, 0, entry.lineVertexCount);
        }
      }

      if (!this._textureLocations) return;
      gl.useProgram(this._textureProgram);
      this._applyProjectionUniforms(gl, this._textureLocations, projection);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this._textureLocations.texture, 0);
      gl.enableVertexAttribArray(this._textureLocations.position);
      gl.enableVertexAttribArray(this._textureLocations.uv);

      for (let index = 0; index < visibleCount; index += 1) {
        const entry = this._visibleEntries[index];
        if (!entry?.texture || !entry.ribbonBuffer) continue;
        gl.uniform1f(this._textureLocations.opacity, this._visibleOpacity[index]);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.ribbonBuffer);
        gl.vertexAttribPointer(this._textureLocations.position, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(this._textureLocations.uv, 2, gl.FLOAT, false, 16, 8);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, entry.ribbonVertexCount);
      }
    },

    onRemove(_map, gl) {
      for (const entry of new Set([...this._entries, ...(this._pendingEntries ?? [])])) {
        releaseEntryGpuResources(gl, entry);
      }
      if (this._textureProgram) gl.deleteProgram(this._textureProgram);
      if (this._lineProgram) gl.deleteProgram(this._lineProgram);
      this._map = null;
      this._gl = null;
      this._textureProgram = null;
      this._lineProgram = null;
      this._textureLocations = null;
      this._lineLocations = null;
      this._programVariant = null;
      this._failedProgramVariant = null;
      this._pendingEntries = null;
      this._pendingDrawOrder = null;
      this._visibleEntries.length = 0;
    },
  };
};
