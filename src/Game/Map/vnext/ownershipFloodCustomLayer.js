/*! Open Historia — GPU ownership frontier-distance flood presentation © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import { politicalFillOpacityAtZoom } from "./presentationPolicy.js";

export const OWNERSHIP_FLOOD_LAYER_ID = "ownership-transition-flood";
export const MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS = 8;

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Ownership flood shader compilation failed: ${log}`);
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
    throw new Error(`Ownership flood shader linking failed: ${log}`);
  }
  return program;
};

// --- Globe projection ---------------------------------------------------------
// `gl_Position = u_matrix * vec4(a_pos, 0, 1)` is mercator-only: under the globe
// that matrix expects the shader to have already mapped mercator onto the
// sphere, so the flood drew nothing and the animation vanished on the globe.
// MapLibre v5 injects a prelude defining projectTile(), which is correct under
// both projections and across the globe<->mercator transition. Vertex data is
// mercator [0,1] (ownershipTransitionWorker's mercatorPoint), which is what
// projectTile() takes, so only the shader changes.

// Pre-v5 MapLibre had no prelude, only a mercator matrix. Keep that working.
const LEGACY_SHADER_DATA = Object.freeze({
  variantName: "legacy-mercator",
  define: "",
  vertexShaderPrelude: `uniform mat4 u_projection_matrix;
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

const projectionDataFromRenderArgs = (args) => {
  const data = args?.defaultProjectionData;
  if (data?.mainMatrix) return data;
  const mainMatrix = args?.modelViewProjectionMatrix
    ?? (Array.isArray(args) || ArrayBuffer.isView(args) ? args : null);
  if (!mainMatrix) return null;
  return {
    mainMatrix,
    fallbackMatrix: mainMatrix,
    tileMercatorCoords: [0, 0, 1, 1],
    clippingPlane: [0, 0, 0, 0],
    projectionTransition: 0,
  };
};

// MapLibre hands custom layers 64-bit matrices to preserve CPU-side precision.
// uniformMatrix4fv wants Float32Array, and coercing a Float64Array every frame
// allocates, so convert into a buffer the layer owns.
const writeFloat32Matrix = (matrix, target) => {
  if (!matrix) return null;
  if (matrix instanceof Float32Array) return matrix;
  for (let index = 0; index < 16; index += 1) target[index] = Number(matrix[index]) || 0;
  return target;
};

// Under mercator only u_projection_matrix exists; the rest resolve to null
// locations, which WebGL treats as no-ops.
const applyProjectionUniforms = (gl, locations, projection, buffers) => {
  if (locations.matrix) {
    gl.uniformMatrix4fv(locations.matrix, false, writeFloat32Matrix(projection.mainMatrix, buffers.main));
  }
  if (locations.tileMercatorCoords) {
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
      writeFloat32Matrix(projection.fallbackMatrix ?? projection.mainMatrix, buffers.fallback),
    );
  }
};

const projectionUniformLocations = (gl, program) => ({
  matrix: gl.getUniformLocation(program, "u_projection_matrix"),
  tileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
  clippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
  transition: gl.getUniformLocation(program, "u_projection_transition"),
  fallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const easeOutMild = (value) => {
  const t = clamp01(value);
  return clamp01(t + (Math.sin(Math.PI * t) * 0.12));
};

const parseCssRgb = (value, fallback = [0.5, 0.5, 0.5]) => {
  const text = String(value ?? "").trim();
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Number(part) || 0)) / 255);
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i)?.[1];
  if (hex?.length === 3) return [...hex].map((char) => parseInt(`${char}${char}`, 16) / 255);
  if (hex?.length === 6) return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return fallback;
};

const releaseField = (gl, field) => {
  if (!field) return;
  try { if (field.texture) gl?.deleteTexture?.(field.texture); } catch {}
  try { if (field.buffer) gl?.deleteBuffer?.(field.buffer); } catch {}
  field.texture = null;
  field.buffer = null;
};

const buildFieldVertices = (bounds) => {
  const minX = Number(bounds?.minX);
  const minY = Number(bounds?.minY);
  const maxX = Number(bounds?.maxX);
  const maxY = Number(bounds?.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    return new Float32Array();
  }
  // Mercator y grows southward. UV row 0 is intentionally attached to minY
  // because the worker writes its first texture row at the north edge.
  return new Float32Array([
    minX, minY, 0, 0,
    maxX, minY, 1, 0,
    minX, maxY, 0, 1,
    minX, maxY, 0, 1,
    maxX, minY, 1, 0,
    maxX, maxY, 1, 1,
  ]);
};

const materializeField = (gl, raw) => {
  const width = Math.max(1, Number(raw?.width) | 0);
  const height = Math.max(1, Number(raw?.height) | 0);
  const textureData = raw?.textureData instanceof Uint8Array
    ? raw.textureData
    : new Uint8Array(raw?.textureData ?? []);
  if (textureData.length !== width * height * 4) return null;

  const vertices = buildFieldVertices(raw?.bounds);
  if (!vertices.length) return null;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    textureData,
  );

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  return {
    ...raw,
    width,
    height,
    durationMs: Math.max(1, Number(raw?.durationMs) || 480),
    delayMs: Math.max(0, Number(raw?.delayMs) || 0),
    feather: Math.max(0.002, Math.min(0.28, Number(raw?.feather) || 0.028)),
    fromRgb: parseCssRgb(raw?.fromColor),
    toRgb: parseCssRgb(raw?.toColor),
    texture,
    buffer,
  };
};

export const createOwnershipFloodCustomLayer = ({
  id = OWNERSHIP_FLOOD_LAYER_ID,
  onError = null,
} = {}) => ({
  id,
  type: "custom",
  renderingMode: "2d",
  _map: null,
  _gl: null,
  _program: null,
  _programVariant: "",
  _failedProgramVariant: "",
  _fragmentSource: "",
  _onError: onError,
  _locations: null,
  // Reused so the per-frame Float64 -> Float32 matrix conversion never allocates.
  _matrixBuffers: { main: new Float32Array(16), fallback: new Float32Array(16) },
  _fields: [],
  _pendingPayload: null,
  _startedAt: 0,
  _armed: false,
  _readyNotified: false,
  _completionQueued: false,
  _callbacks: null,

  onAdd(map, gl) {
    this._map = map;
    this._gl = gl;
    const fragmentSource = `#version 300 es
      precision mediump float;
      uniform sampler2D u_field;
      uniform vec3 u_fromColor;
      uniform vec3 u_toColor;
      uniform float u_progress;
      uniform float u_feather;
      uniform float u_opacity;
      in vec2 v_uv;
      out vec4 fragColor;
      void main() {
        vec4 field = texture(u_field, v_uv);
        float mask = field.a;
        if (mask <= 0.04) discard;
        float arrival = field.r;
        float detached = field.g;
        float feather = mix(u_feather, max(u_feather, 0.12), detached);
        float targetMix = 1.0 - smoothstep(u_progress - feather, u_progress + feather, arrival);
        vec3 color = mix(u_fromColor, u_toColor, targetMix);
        float edgeAlpha = smoothstep(0.04, 0.88, mask);
        fragColor = vec4(color, edgeAlpha * u_opacity);
      }
    `;
    this._fragmentSource = fragmentSource;
    // Compile the mercator variant now so Nations' `_program` readiness check
    // passes; render() swaps in the real prelude on the first frame.
    this._ensureProgram(gl, LEGACY_SHADER_DATA, onError);
  },

  _ensureProgram(gl, shaderData, onError = null) {
    if (this._program && this._programVariant === shaderData.variantName) return true;
    if (this._failedProgramVariant === shaderData.variantName) return false;

    const vertexSource = `#version 300 es
precision highp float;
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = projectTile(a_pos);
}
`;
    let program = null;
    try {
      program = createProgram(gl, vertexSource, this._fragmentSource);
    } catch (error) {
      // Keep whatever already linked rather than losing the layer outright.
      this._failedProgramVariant = shaderData.variantName;
      (onError ?? this._onError)?.(error);
      return Boolean(this._program);
    }

    try { if (this._program) gl.deleteProgram(this._program); } catch {}
    this._program = program;
    this._programVariant = shaderData.variantName;
    this._locations = {
      ...projectionUniformLocations(gl, program),
      field: gl.getUniformLocation(program, "u_field"),
      fromColor: gl.getUniformLocation(program, "u_fromColor"),
      toColor: gl.getUniformLocation(program, "u_toColor"),
      progress: gl.getUniformLocation(program, "u_progress"),
      feather: gl.getUniformLocation(program, "u_feather"),
      opacity: gl.getUniformLocation(program, "u_opacity"),
      position: gl.getAttribLocation(program, "a_pos"),
      uv: gl.getAttribLocation(program, "a_uv"),
    };
    return true;
  },

  startTransition(payload, callbacks = {}) {
    this.clearTransition();
    this._pendingPayload = payload;
    this._callbacks = callbacks;
    // Do not consume animation time while textures/buffers are still being
    // materialized. The clock starts only after the layer is ready and the
    // underlying old political fill has been hidden by Nations.
    this._startedAt = 0;
    this._armed = false;
    this._readyNotified = false;
    this._completionQueued = false;
    this._map?.triggerRepaint?.();
  },

  clearTransition() {
    for (const field of this._fields) releaseField(this._gl, field);
    this._fields = [];
    this._pendingPayload = null;
    this._callbacks = null;
    this._startedAt = 0;
    this._armed = false;
    this._readyNotified = false;
    this._completionQueued = false;
  },

  _materializePending() {
    if (!this._pendingPayload || !this._gl) return;
    const rawFields = Array.isArray(this._pendingPayload?.fields)
      ? this._pendingPayload.fields.slice(0, MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS)
      : [];
    const fields = [];
    try {
      for (const raw of rawFields) {
        const field = materializeField(this._gl, raw);
        if (field) fields.push(field);
      }
    } catch (error) {
      for (const field of fields) releaseField(this._gl, field);
      this._pendingPayload = null;
      this._fields = [];
      const callback = this._callbacks?.onError;
      queueMicrotask(() => callback?.(error));
      return;
    }
    this._pendingPayload = null;
    this._fields = fields;
    if (!fields.length) {
      const callback = this._callbacks?.onError;
      queueMicrotask(() => callback?.(new Error("Ownership flood contained no drawable fields")));
      return;
    }
  },

  render(gl, args) {
    const projection = projectionDataFromRenderArgs(args);
    if (!projection) return;
    // The prelude changes when the projection does, so recompile on the frame
    // the globe turns on rather than drawing mercator geometry onto a sphere.
    if (!this._ensureProgram(gl, shaderDataFromRenderArgs(args)) || !this._locations) return;
    if (this._pendingPayload) this._materializePending();
    if (!this._fields.length) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();

    // First render is a readiness barrier only. Do not draw the old-colour
    // flood over the still-visible old base fill (which darkens/flashes it),
    // and do not let preparation time advance the transition. Nations hides
    // the base in onReady, then the next repaint starts at progress ~= 0.
    if (!this._armed) {
      this._armed = true;
      this._startedAt = now;
      if (!this._readyNotified) {
        this._readyNotified = true;
        const callback = this._callbacks?.onReady;
        queueMicrotask(() => callback?.());
      }
      this._map?.triggerRepaint?.();
      return;
    }

    let complete = true;
    try {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this._program);
      applyProjectionUniforms(gl, this._locations, projection, this._matrixBuffers);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this._locations.field, 0);
      gl.enableVertexAttribArray(this._locations.position);
      gl.enableVertexAttribArray(this._locations.uv);

      const opacity = politicalFillOpacityAtZoom(this._map?.getZoom?.());
      gl.uniform1f(this._locations.opacity, opacity);

      for (const field of this._fields) {
        const localElapsed = Math.max(0, now - this._startedAt - field.delayMs);
        const rawProgress = clamp01(localElapsed / field.durationMs);
        const progress = easeOutMild(rawProgress);
        if (rawProgress < 1) complete = false;

        gl.uniform3fv(this._locations.fromColor, field.fromRgb);
        gl.uniform3fv(this._locations.toColor, field.toRgb);
        gl.uniform1f(this._locations.progress, progress);
        gl.uniform1f(this._locations.feather, field.feather);
        gl.bindTexture(gl.TEXTURE_2D, field.texture);
        gl.bindBuffer(gl.ARRAY_BUFFER, field.buffer);
        gl.vertexAttribPointer(this._locations.position, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(this._locations.uv, 2, gl.FLOAT, false, 16, 8);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    } catch (error) {
      if (!this._completionQueued) {
        this._completionQueued = true;
        const callback = this._callbacks?.onError;
        queueMicrotask(() => callback?.(error));
      }
      return;
    }

    if (!complete) {
      this._map?.triggerRepaint?.();
      return;
    }

    if (!this._completionQueued) {
      this._completionQueued = true;
      const callback = this._callbacks?.onComplete;
      queueMicrotask(() => callback?.());
    }
  },

  onRemove(_map, gl) {
    this.clearTransition();
    try { if (this._program) gl.deleteProgram(this._program); } catch {}
    this._program = null;
    this._programVariant = "";
    this._failedProgramVariant = "";
    this._locations = null;
    this._map = null;
    this._gl = null;
  },
});
