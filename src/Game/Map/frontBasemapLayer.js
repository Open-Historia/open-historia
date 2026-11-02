/*! Open Historia — the bare map put back under a battlefield's painted ground © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Taken ground is to look like the taker's own land, and a country's land is
// its colour laid over the BASEMAP. The painted ground lies over land that
// still carries the other country's colour, and colour on colour is neither.
// It used to be cleared to a pale grey first, which matched the game's own
// pale relief and nothing else: on a dark basemap the taken ground stood out
// pale beside the country it belonged to.
//
// So the territory's colour behind the paint is made to be SEEN THROUGH, to
// the basemap itself. Two layers do it, neither with anything of its own to
// show:
//
//   take   sits under every political fill. When the map draws, what is in
//          its picture at that moment is the basemap alone, and this keeps a
//          copy of it.
//   put    sits over every political fill. Wherever a battlefield's picture
//          is painted (by how solid the picture is there, soft edges and
//          all) it draws what that ground is to look like: the copy, pixel
//          for pixel where it was, with the picture's own colour laid over
//          it at the strength the map gives a country's fill.
//
// That is exactly how the taker's own land is drawn: the same on any basemap,
// a scenario's own background included, with the hills and rivers showing
// through it as they do everywhere else.
//
// The bare map and the paint are ONE drawing, from one reading of the picture.
// They were two at first (this layer put the map back, and the map's own
// picture layer laid the colour over it), and the two did not agree along the
// picture's edges: where the picture is half solid the bare map showed through
// more than on either side of the edge, a pale line along every border of the
// painted ground, and the map's copy of the picture could be a moment older
// than this layer's.
//
// The pure parts (the mesh, the copies of the world) load in plain Node.

import { worldCopies } from "./strikeCustomLayer.js";

export const FRONT_BASEMAP_TAKE_LAYER_ID = "fronts-basemap-take";
export const FRONT_BASEMAP_PUT_LAYER_ID = "fronts-basemap-put";
// How finely a picture is laid on the map: on a globe a flat picture has to bend.
export const MESH_STEPS = 24;
const FLOATS = 4;
const TWO_PI = Math.PI * 2;

const mercatorX = (lng) => (lng + 180) / 360;
const mercatorY = (lat) => {
  const held = Math.max(-85.05, Math.min(85.05, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (held * Math.PI) / 360)) / TWO_PI;
};

// A picture's mesh: its place on the map's own flat sheet (0 to 1 each way)
// and its place in the picture, four numbers a corner, two triangles a square.
// `coordinates` are the picture's corners as the map is given them:
// [[west, north], [east, north], [east, south], [west, south]]. Its rows are
// even on the flat sheet, as the map lays a picture.
export const pictureMesh = (coordinates, steps = MESH_STEPS) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 4) return new Float32Array(0);
  const [[west, north], [east], [, south]] = coordinates;
  if (![west, north, east, south].every(Number.isFinite)) return new Float32Array(0);
  const left = mercatorX(west);
  const right = mercatorX(east);
  const top = mercatorY(north);
  const bottom = mercatorY(south);
  const out = new Float32Array(steps * steps * 6 * FLOATS);
  let at = 0;
  const put = (u, v) => {
    out[at] = left + (right - left) * u;
    out[at + 1] = top + (bottom - top) * v;
    out[at + 2] = u;
    out[at + 3] = v;
    at += FLOATS;
  };
  for (let row = 0; row < steps; row += 1) {
    for (let col = 0; col < steps; col += 1) {
      const u0 = col / steps;
      const u1 = (col + 1) / steps;
      const v0 = row / steps;
      const v1 = (row + 1) / steps;
      put(u0, v0); put(u1, v0); put(u1, v1);
      put(u0, v0); put(u1, v1); put(u0, v1);
    }
  }
  return out;
};

export const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Front basemap layer shader: ${log}`);
  }
  return shader;
};

// What MapLibre gives a custom layer to project with; before it gave any, a matrix alone.
const PLAIN = Object.freeze({
  variantName: "plain-mercator",
  define: "",
  vertexShaderPrelude: `uniform mat4 u_projection_matrix;
vec4 projectTileWithElevation(vec2 p, float elevation) {
  return u_projection_matrix * vec4(p, elevation, 1.0);
}`,
});
export const shaderDataOf = (args) => (typeof args?.shaderData?.vertexShaderPrelude === "string" && args.shaderData.variantName ? { define: "", ...args.shaderData } : PLAIN);
export const projectionOf = (args) => {
  const data = args?.defaultProjectionData;
  if (data?.mainMatrix) return data;
  const mainMatrix = args?.modelViewProjectionMatrix ?? (Array.isArray(args) || ArrayBuffer.isView(args) ? args : null);
  return mainMatrix ? { mainMatrix, fallbackMatrix: mainMatrix, tileMercatorCoords: [0, 0, 1, 1], clippingPlane: [0, 0, 0, 0], projectionTransition: 0 } : null;
};

const VERTEX = (data) => `#version 300 es
precision highp float;
${data.vertexShaderPrelude}
${data.define}
in vec2 a_pos;
in vec2 a_uv;
uniform float u_world;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = projectTileWithElevation(a_pos + vec2(u_world, 0.0), 0.0);
}`;
// The basemap as it was at this very pixel with the picture's colour over it
// at the strength of a country's fill, as solid as the picture is painted
// there. (The picture is read with its colour already weighed by how solid it
// is, so a soft edge takes no dark from the empty picture beside it.)
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_mask;
uniform vec2 u_size;
uniform float u_strength;
out vec4 colour;
void main() {
  vec4 paint = texture(u_mask, v_uv);
  if (paint.a < 0.004) discard;
  vec3 base = texture(u_base, gl_FragCoord.xy / u_size).rgb;
  colour = vec4(base * (1.0 - u_strength) * paint.a + paint.rgb * u_strength, paint.a);
}`;

// How many times a picture's canvas has been drawn on: it goes to the GPU only when this moves.
const paintedTimes = new WeakMap();
export const markPicturePainted = (canvas) => paintedTimes.set(canvas, (paintedTimes.get(canvas) ?? 0) + 1);
// (The battlefield's own ground layer takes a picture up by the same count: frontGroundLayer.js.)
export const picturePaintedTimes = (canvas) => paintedTimes.get(canvas) ?? 0;

// The two layers, which share the copy. `pictures()` gives what is painted:
// [{ canvas, coordinates }]. `strength(zoom)` is how strongly the map lays a
// country's colour over the basemap at a zoom. `onState(working)` is told
// when the pair starts or stops being able to do its work, so the caller can
// fall back.
export const createFrontBasemapLayers = ({ pictures, strength, onState, onError } = {}) => {
  const shared = { texture: null, width: 0, height: 0, taken: false, copies: false, working: null };
  const tell = (working) => {
    if (shared.working === working) return;
    shared.working = working;
    onState?.(working);
  };
  const listed = () => {
    const list = typeof pictures === "function" ? pictures() : [];
    return Array.isArray(list) ? list.filter((picture) => picture?.canvas && Array.isArray(picture.coordinates)) : [];
  };

  const take = {
    id: FRONT_BASEMAP_TAKE_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    onAdd() {},
    onRemove(map, gl) {
      try {
        if (shared.texture) gl.deleteTexture(shared.texture);
      } catch { /* the context is gone */ }
      shared.texture = null;
      shared.taken = false;
      shared.copies = false;
    },
    render(gl) {
      shared.taken = false;
      if (listed().length === 0) return;
      try {
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        if (!shared.texture) {
          shared.texture = gl.createTexture();
          shared.copies = false;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, shared.texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, shared.texture);
        }
        // getError waits on the GPU process, so it is asked only until a copy has worked at this size.
        if (shared.copies && shared.width === width && shared.height === height) {
          gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
        } else {
          gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
          shared.width = width;
          shared.height = height;
          shared.copies = gl.getError() === gl.NO_ERROR;
        }
        shared.taken = shared.copies;
      } catch (error) {
        onError?.(error);
      }
    },
  };

  const put = {
    id: FRONT_BASEMAP_PUT_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    _map: null,
    _program: null,
    _variant: "",
    _failed: "",
    _masks: new Map(),
    _uploaded: new Map(),
    _meshes: new Map(),
    _buffers: new Map(),
    _matrices: { main: new Float32Array(16), fallback: new Float32Array(16) },
    drawn: 0,
    onAdd(map) {
      this._map = map;
      // Everything made on a context that was lost is gone: made again on the one given back.
      this._restored = () => {
        shared.texture = null;
        shared.copies = false;
        shared.taken = false;
        this._program = null;
        this._variant = "";
        this._failed = "";
        this._masks = new Map();
        this._uploaded = new Map();
        this._buffers = new Map();
      };
      this._canvas = map?.getCanvas?.() ?? null;
      this._canvas?.addEventListener?.("webglcontextrestored", this._restored);
    },
    onRemove(map, gl) {
      this._canvas?.removeEventListener?.("webglcontextrestored", this._restored);
      this._canvas = null;
      try {
        if (this._program) gl.deleteProgram(this._program.handle);
        for (const buffer of this._buffers.values()) gl.deleteBuffer(buffer);
        for (const texture of this._masks.values()) gl.deleteTexture(texture);
      } catch { /* the context is gone */ }
      this._program = null;
      this._masks = new Map();
      this._uploaded = new Map();
      this._meshes = new Map();
      this._buffers = new Map();
      this._map = null;
      tell(false);
    },
    _ensure(gl, data) {
      if (this._program && this._variant === data.variantName) return true;
      if (this._failed === data.variantName) return false;
      try {
        const handle = gl.createProgram();
        const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX(data));
        const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
        gl.attachShader(handle, vertex);
        gl.attachShader(handle, fragment);
        gl.linkProgram(handle);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(`Front basemap layer program: ${gl.getProgramInfoLog(handle) || "unknown link error"}`);
        const uniform = (key) => gl.getUniformLocation(handle, key);
        if (this._program) gl.deleteProgram(this._program.handle);
        this._program = {
          handle,
          pos: gl.getAttribLocation(handle, "a_pos"),
          uv: gl.getAttribLocation(handle, "a_uv"),
          matrix: uniform("u_projection_matrix"),
          fallback: uniform("u_projection_fallback_matrix"),
          tile: uniform("u_projection_tile_mercator_coords"),
          clip: uniform("u_projection_clipping_plane"),
          transition: uniform("u_projection_transition"),
          world: uniform("u_world"),
          base: uniform("u_base"),
          mask: uniform("u_mask"),
          size: uniform("u_size"),
          strength: uniform("u_strength"),
        };
        this._variant = data.variantName;
        return true;
      } catch (error) {
        this._failed = data.variantName;
        onError?.(error);
        return false;
      }
    },
    render(gl, args) {
      this.drawn = 0;
      const list = listed();
      if (list.length === 0) return;
      const projection = projectionOf(args);
      if (!shared.taken || !projection || !this._ensure(gl, shaderDataOf(args))) return tell(false);
      const program = this._program;
      const toFloat = (matrix, target) => {
        for (let index = 0; index < 16; index += 1) target[index] = Number(matrix[index]) || 0;
        return target;
      };
      let copies = [0];
      try {
        const bounds = Number(projection.projectionTransition ?? 0) > 0 ? null : this._map?.getBounds?.();
        if (bounds) copies = worldCopies({ west: bounds.getWest(), east: bounds.getEast(), repeats: this._map.getRenderWorldCopies?.() !== false });
      } catch { /* the view cannot be read: the first copy alone */ }
      // (The map keeps count of how pictures are unpacked: left as they were found.)
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      try {
        gl.useProgram(program.handle);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.CULL_FACE);
        if (program.matrix) gl.uniformMatrix4fv(program.matrix, false, toFloat(projection.mainMatrix, this._matrices.main));
        if (program.fallback) gl.uniformMatrix4fv(program.fallback, false, toFloat(projection.fallbackMatrix ?? projection.mainMatrix, this._matrices.fallback));
        if (program.tile) gl.uniform4fv(program.tile, projection.tileMercatorCoords ?? [0, 0, 1, 1]);
        if (program.clip) gl.uniform4fv(program.clip, projection.clippingPlane ?? [0, 0, 0, 0]);
        if (program.transition) gl.uniform1f(program.transition, Number(projection.projectionTransition ?? 0));
        gl.uniform2f(program.size, shared.width, shared.height);
        const laid = typeof strength === "function" ? Number(strength(this._map?.getZoom?.() ?? 0)) : 0.62;
        gl.uniform1f(program.strength, Number.isFinite(laid) ? Math.max(0, Math.min(1, laid)) : 0.62);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, shared.texture);
        gl.uniform1i(program.base, 0);
        gl.uniform1i(program.mask, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.enableVertexAttribArray(program.pos);
        gl.enableVertexAttribArray(program.uv);
        const seen = new Set();
        for (const picture of list) {
          const key = picture.key ?? picture.coordinates.join(",");
          seen.add(key);
          let texture = this._masks.get(key);
          gl.activeTexture(gl.TEXTURE1);
          if (texture) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
          } else {
            texture = gl.createTexture();
            this._masks.set(key, texture);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          }
          // The picture as it is painted this moment: it changes only while a turn is played.
          const painted = paintedTimes.get(picture.canvas) ?? 0;
          const uploaded = this._uploaded.get(key);
          if (uploaded?.canvas !== picture.canvas || uploaded.painted !== painted) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture.canvas);
            this._uploaded.set(key, { canvas: picture.canvas, painted });
          }
          let mesh = this._meshes.get(key);
          if (!mesh) {
            mesh = pictureMesh(picture.coordinates);
            this._meshes.set(key, mesh);
          }
          if (mesh.length === 0) continue;
          let buffer = this._buffers.get(key);
          if (buffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          } else {
            buffer = gl.createBuffer();
            this._buffers.set(key, buffer);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
          }
          gl.vertexAttribPointer(program.pos, 2, gl.FLOAT, false, FLOATS * 4, 0);
          gl.vertexAttribPointer(program.uv, 2, gl.FLOAT, false, FLOATS * 4, 8);
          for (const copy of copies) {
            if (program.world) gl.uniform1f(program.world, copy);
            gl.drawArrays(gl.TRIANGLES, 0, mesh.length / FLOATS);
          }
          this.drawn += mesh.length / FLOATS;
        }
        gl.disableVertexAttribArray(program.pos);
        gl.disableVertexAttribArray(program.uv);
        // A battlefield that is gone gives its picture back.
        for (const [key, texture] of this._masks) {
          if (seen.has(key)) continue;
          gl.deleteTexture(texture);
          if (this._buffers.has(key)) gl.deleteBuffer(this._buffers.get(key));
          this._masks.delete(key);
          this._uploaded.delete(key);
          this._meshes.delete(key);
          this._buffers.delete(key);
        }
        // The copy is this drawing's alone: the next has to take its own, or goes without
        // (a copy of the map as it was at another moment is not the map under the paint).
        shared.taken = false;
        tell(true);
      } catch (error) {
        onError?.(error);
        tell(false);
      } finally {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        gl.activeTexture(gl.TEXTURE0);
      }
    },
  };
  return { take, put };
};
