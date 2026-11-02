/*! Open Historia — a battlefield's ground drawn on the map, and the border that moves across it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// While a battlefield is on the map, its sides' regions in its frame are drawn
// here and not by the map's fills (frontGround.js says how the two hand them
// over). It is drawn the way the hand-over sweep draws a region changing hands
// (vnext/ownershipFloodCustomLayer.js): the regions themselves, cut into
// triangles by the regions worker, at the very strength the map gives a
// country's fill, each pixel in the colour of whoever holds that ground:
//
//   - where the battlefield's picture is painted, the colour it is painted in,
//     as solid as it is painted there, the region's own owner's colour under a
//     soft edge;
//   - everywhere else, the region's own owner's colour, as the map would have
//     drawn it.
//
// So taken ground looks like the taker's own land on any basemap, and nothing
// is copied from the screen to do it: the map's fill under it is not there.
//
// THE BORDER. The map's borders between the battlefield's regions are left out
// (vnext/politicalBoundaryTopology.js) and drawn here instead, where the
// holder changes: along the line halfway between one holder's colour and the
// next, as the picture and the regions' own colours give it read smoothly
// (bilinear) between their pixels, with the same width for the zoom and the
// same dark casing as the map's own borders, in screen pixels. As the paint
// spreads the line moves with it, and at the frame's edge it meets the map's
// border running on.
//
// The regions' own colours are drawn once into a picture of their own (the
// "field"), the size of the frame, so the border can see whose the ground on
// the other side of it is. That is redrawn only when the regions or their
// owners change; the battlefield's picture is taken up only when it is painted
// anew.
//
// The pure parts load in plain Node.

import { worldCopies } from "./strikeCustomLayer.js";
import { mercatorX, mercatorY } from "./vnext/battlefieldGround.js";
import {
  POLITY_BOUNDARY_SHADOW_BLUR_STOPS,
  POLITY_BOUNDARY_SHADOW_WIDTH_STOPS,
  POLITY_BOUNDARY_WIDTH_STOPS,
  politicalFillOpacityAtZoom,
  zoomStopValue,
} from "./vnext/presentationPolicy.js";
import { compile, projectionOf, shaderDataOf } from "./frontBasemapLayer.js";

export const FRONT_GROUND_LAYER_ID = "fronts-ground";
// The field is drawn this many times finer than the picture, and no larger
// than this each way.
export const FIELD_FINER = 4;
export const FIELD_LARGEST = 2048;
// The map's borders (Nations.jsx polity-boundaries): colour and how solid,
// the line's own opacity times its colour's.
export const BORDER_CORE = Object.freeze({ rgb: [5 / 255, 8 / 255, 13 / 255], alpha: 0.94 * 0.96 });
export const BORDER_CASING = Object.freeze({ rgb: [1 / 255, 4 / 255, 8 / 255], alpha: 0.52 * 0.72 });

// A picture's place on the flat sheet: [left, top, right, bottom], from its
// corners as the map is given them: [[west, north], [east, north], [east, south], [west, south]].
export const pictureRect = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 4) return null;
  const [[west, north], [east], [, south]] = coordinates;
  if (![west, north, east, south].every(Number.isFinite)) return null;
  return [mercatorX(west), mercatorY(north), mercatorX(east), mercatorY(south)];
};

// The border's widths at a zoom, in px: the line, its casing, the casing's blur.
export const groundBorderWidths = (zoom) => ({
  core: zoomStopValue(POLITY_BOUNDARY_WIDTH_STOPS, zoom),
  casing: zoomStopValue(POLITY_BOUNDARY_SHADOW_WIDTH_STOPS, zoom),
  blur: zoomStopValue(POLITY_BOUNDARY_SHADOW_BLUR_STOPS, zoom),
});

// Each corner's own colour (0 to 1), from its region's: `colours` is one
// [red, green, blue] (0 to 255) a region.
export const cornerColours = (regionOf, colours) => {
  const out = new Float32Array(regionOf.length * 3);
  for (let corner = 0; corner < regionOf.length; corner += 1) {
    const rgb = colours[regionOf[corner]] ?? [120, 120, 120];
    out[corner * 3] = rgb[0] / 255;
    out[corner * 3 + 1] = rgb[1] / 255;
    out[corner * 3 + 2] = rgb[2] / 255;
  }
  return out;
};

// The field's size for a picture of this size.
export const fieldSize = (width, height) => {
  const w = Math.max(1, Number(width) || 1) * FIELD_FINER;
  const h = Math.max(1, Number(height) || 1) * FIELD_FINER;
  const scale = Math.min(1, FIELD_LARGEST / w, FIELD_LARGEST / h);
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
};

const VERTEX = (data) => `#version 300 es
precision highp float;
${data.vertexShaderPrelude}
${data.define}
in vec2 a_pos;
in vec3 a_own;
uniform float u_world;
uniform vec4 u_rect;
out vec2 v_uv;
out vec3 v_own;
void main() {
  v_uv = (a_pos - u_rect.xy) / (u_rect.zw - u_rect.xy);
  v_own = a_own;
  gl_Position = projectTileWithElevation(a_pos + vec2(u_world, 0.0), 0.0);
}`;

// The ground, and the border where its holder changes. `holder` is whose the
// ground is at a place, as a colour: the picture's paint (its colour already
// weighed by how solid it is) over the regions' own colours; its alpha says
// whether there is land there at all. Along each way across the screen it
// looks out to the far edge of the casing for a change of holder; where there
// is one, how far along from the one colour to the other the ground is, and
// the nearest place each way where that is halfway, give how far the pixel is
// from the line.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_own;
uniform sampler2D u_paint;
uniform sampler2D u_field;
uniform float u_strength;
uniform vec3 u_line;
uniform vec4 u_core;
uniform vec4 u_casing;
out vec4 colour;

const int STEPS = 6;

// (The field read between a coast pixel and the sea is the land's colour weighed
// by how much land there is: its colour is had back whole, or a coast would
// read as a change of holder.)
vec4 holder(vec2 uv) {
  vec4 own = textureLod(u_field, uv, 0.0);
  vec4 paint = textureLod(u_paint, uv, 0.0);
  vec3 land = own.a > 0.0 ? own.rgb / own.a : vec3(0.0);
  return vec4(land * (1.0 - paint.a) + paint.rgb, own.a);
}

// How far from colour a to colour a + d, 0 to 1 (or otherwise, where there is no land).
float along(vec4 h, vec3 a, vec3 d, float dd, float otherwise) {
  return h.a < 0.5 ? otherwise : clamp(dot(h.rgb - a, d) / dd, 0.0, 1.0);
}

// The nearest distance, in px, along +-way (one px of the screen in the
// picture), at which the ground is halfway between a and a + d.
float halfway(vec2 uv, vec2 way, float stride, vec3 a, vec3 d, float dd, float here) {
  float best = 1e6;
  for (int side = -1; side <= 1; side += 2) {
    float before = here;
    for (int i = 1; i <= STEPS; i++) {
      float offset = float(i) * stride;
      float now = along(holder(uv + way * (offset * float(side))), a, d, dd, before);
      if ((before - 0.5) * (now - 0.5) <= 0.0 && before != now) {
        best = min(best, (float(i) - 1.0 + (before - 0.5) / (before - now)) * stride);
        break;
      }
      before = now;
    }
  }
  return best;
}

vec4 over(vec3 rgb, float alpha, vec4 under) {
  return vec4(rgb * alpha, alpha) + under * (1.0 - alpha);
}

void main() {
  vec2 dx = dFdx(v_uv);
  vec2 dy = dFdy(v_uv);
  bool inside = v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
  vec4 paint = inside ? textureLod(u_paint, v_uv, 0.0) : vec4(0.0);
  vec4 result = vec4((v_own * (1.0 - paint.a) + paint.rgb) * u_strength, u_strength);
  float reach = 0.5 * u_line.y + 0.5 * u_line.z + 1.0;
  if (inside && u_line.y > 0.0) {
    vec4 left = holder(v_uv - dx * reach);
    vec4 right = holder(v_uv + dx * reach);
    vec4 below = holder(v_uv - dy * reach);
    vec4 above = holder(v_uv + dy * reach);
    vec3 across = right.rgb - left.rgb;
    vec3 up = above.rgb - below.rgb;
    float sx = left.a > 0.5 && right.a > 0.5 ? dot(across, across) : 0.0;
    float sy = below.a > 0.5 && above.a > 0.5 ? dot(up, up) : 0.0;
    float dd = max(sx, sy);
    if (dd > 0.0016) {
      vec3 a = sx >= sy ? left.rgb : below.rgb;
      vec3 d = sx >= sy ? across : up;
      float here = along(holder(v_uv), a, d, dd, 0.5);
      float stride = reach / float(STEPS);
      float ex = here == 0.5 ? 0.0 : halfway(v_uv, dx, stride, a, d, dd, here);
      float ey = here == 0.5 ? 0.0 : halfway(v_uv, dy, stride, a, d, dd, here);
      float far = ex < 1e5 && ey < 1e5 ? ex * ey / max(1e-6, sqrt(ex * ex + ey * ey)) : min(ex, ey);
      if (far < 1e5) {
        float casing = 1.0 - smoothstep(0.5 * (u_line.y - u_line.z) - 0.5, 0.5 * (u_line.y + u_line.z) + 0.5, far);
        float core = 1.0 - smoothstep(0.5 * u_line.x - 0.5, 0.5 * u_line.x + 0.5, far);
        result = over(u_casing.rgb, u_casing.a * casing, result);
        result = over(u_core.rgb, u_core.a * core, result);
      }
    }
  }
  colour = result;
}`;

// The regions' own colours, laid flat over the frame: the field.
const FIELD_VERTEX = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_own;
uniform vec4 u_rect;
out vec3 v_own;
void main() {
  v_own = a_own;
  gl_Position = vec4((a_pos - u_rect.xy) / (u_rect.zw - u_rect.xy) * 2.0 - 1.0, 0.0, 1.0);
}`;
const FIELD_FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_own;
out vec4 colour;
void main() {
  colour = vec4(v_own, 1.0);
}`;

const link = (gl, vertexSource, fragmentSource, names) => {
  const handle = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(handle, vertex);
  gl.attachShader(handle, fragment);
  gl.linkProgram(handle);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle) || "unknown link error";
    gl.deleteProgram(handle);
    throw new Error(`Front ground layer program: ${log}`);
  }
  const out = { handle, pos: gl.getAttribLocation(handle, "a_pos"), own: gl.getAttribLocation(handle, "a_own") };
  for (const name of names) out[name] = gl.getUniformLocation(handle, `u_${name}`);
  return out;
};

const GROUND_UNIFORMS = ["world", "rect", "paint", "field", "strength", "line", "core", "casing"];
const PROJECTION_UNIFORMS = {
  matrix: "u_projection_matrix",
  fallback: "u_projection_fallback_matrix",
  tile: "u_projection_tile_mercator_coords",
  clip: "u_projection_clipping_plane",
  transition: "u_projection_transition",
};
const PLAIN_VARIANT = "plain-mercator";

const isWebGL2 = (gl) => typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

// The layer. `areas()` is asked each time the map draws: one a battlefield,
//   { key, canvas, version, coordinates, meshId, positions, regionOf,
//     colours, colourKey, ready }
// `version` changes when the picture is painted anew; `colourKey` when the
// regions' colours do; `ready` once the map's fill of every one of its regions
// is hidden (an area is not drawn before, so no region is drawn twice).
// `strength(zoom)` is how strongly the map lays a country's colour over the
// basemap. `onState(working)` is told whether the layer can draw at all, as
// soon as it is added and whenever that changes.
export const createFrontGroundLayer = ({ id = FRONT_GROUND_LAYER_ID, areas, strength = politicalFillOpacityAtZoom, onState, onError } = {}) => {
  let working = null;
  const tell = (now) => {
    if (working === now) return;
    working = now;
    queueMicrotask(() => onState?.(now));
  };
  const listed = () => {
    const list = typeof areas === "function" ? areas() : [];
    return Array.isArray(list) ? list.filter((area) => area?.canvas && area.positions?.length && area.regionOf?.length) : [];
  };

  return {
    id,
    type: "custom",
    renderingMode: "2d",
    _map: null,
    _ground: null,
    _variant: "",
    _failed: "",
    _field: null,
    _entries: new Map(),
    _matrices: { main: new Float32Array(16), fallback: new Float32Array(16) },
    drawn: 0,

    onAdd(map, gl) {
      this._map = map;
      if (!isWebGL2(gl)) {
        onError?.(new Error("The battlefield's ground needs WebGL 2."));
        tell(false);
        return;
      }
      try {
        this._field = link(gl, FIELD_VERTEX, FIELD_FRAGMENT, ["rect"]);
      } catch (error) {
        onError?.(error);
        tell(false);
        return;
      }
      // The flat map's program now, so the caller knows at once whether it can draw.
      tell(this._ensure(gl, { variantName: PLAIN_VARIANT, define: "", vertexShaderPrelude: `uniform mat4 u_projection_matrix;
vec4 projectTileWithElevation(vec2 p, float elevation) {
  return u_projection_matrix * vec4(p, elevation, 1.0);
}` }));
    },

    onRemove(map, gl) {
      try {
        if (this._ground) gl.deleteProgram(this._ground.handle);
        if (this._field) gl.deleteProgram(this._field.handle);
        for (const entry of this._entries.values()) this._release(gl, entry);
      } catch { /* the context is gone */ }
      this._ground = null;
      this._field = null;
      this._variant = "";
      this._failed = "";
      this._entries = new Map();
      this._map = null;
    },

    _ensure(gl, data) {
      if (this._ground && this._variant === data.variantName) return true;
      if (this._failed === data.variantName) return false;
      try {
        const program = link(gl, VERTEX(data), FRAGMENT, GROUND_UNIFORMS);
        for (const [key, name] of Object.entries(PROJECTION_UNIFORMS)) program[key] = gl.getUniformLocation(program.handle, name);
        if (this._ground) gl.deleteProgram(this._ground.handle);
        this._ground = program;
        this._variant = data.variantName;
        return true;
      } catch (error) {
        this._failed = data.variantName;
        onError?.(error);
        return false;
      }
    },

    _release(gl, entry) {
      for (const buffer of [entry.positions, entry.colours]) if (buffer) gl.deleteBuffer(buffer);
      for (const texture of [entry.paint, entry.field]) if (texture) gl.deleteTexture(texture);
      if (entry.frame) gl.deleteFramebuffer(entry.frame);
    },

    // An area's buffers, its picture and its field, made or brought up to date.
    _prepare(gl, area) {
      let entry = this._entries.get(area.key);
      if (!entry) {
        entry = { meshId: null, colourKey: null, count: 0, version: null, size: null, fieldKey: null };
        this._entries.set(area.key, entry);
      }
      entry.rect = pictureRect(area.coordinates);
      if (!entry.rect) return null;
      if (entry.meshId !== area.meshId) {
        entry.positions ??= gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions);
        gl.bufferData(gl.ARRAY_BUFFER, area.positions, gl.STATIC_DRAW);
        entry.count = area.positions.length / 2;
        entry.meshId = area.meshId;
        entry.colourKey = null;
      }
      if (entry.colourKey !== area.colourKey) {
        entry.colours ??= gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.colours);
        gl.bufferData(gl.ARRAY_BUFFER, cornerColours(area.regionOf, area.colours ?? []), gl.STATIC_DRAW);
        entry.colourKey = area.colourKey;
      }
      // The picture, taken up only when it has been painted anew.
      const { canvas } = area;
      if (!entry.paint || entry.version !== area.version || entry.canvas !== canvas) {
        entry.paint ??= gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.paint);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        entry.version = area.version;
        entry.canvas = canvas;
      }
      // The field, drawn again only when the regions, their colours or the frame change.
      const [width, height] = fieldSize(canvas.width, canvas.height);
      const fieldKey = `${area.meshId}|${area.colourKey}|${width}x${height}|${entry.rect.join(",")}`;
      if (entry.fieldKey !== fieldKey) {
        if (!entry.field || entry.size?.[0] !== width || entry.size?.[1] !== height) {
          if (entry.field) gl.deleteTexture(entry.field);
          entry.field = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.field);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          entry.frame ??= gl.createFramebuffer();
          entry.size = [width, height];
        }
        const before = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const viewport = gl.getParameter(gl.VIEWPORT);
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, entry.frame);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.field, 0);
          gl.viewport(0, 0, width, height);
          gl.disable(gl.BLEND);
          gl.disable(gl.DEPTH_TEST);
          gl.disable(gl.STENCIL_TEST);
          gl.disable(gl.CULL_FACE);
          gl.disable(gl.SCISSOR_TEST);
          gl.colorMask(true, true, true, true);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const program = this._field;
          gl.useProgram(program.handle);
          gl.uniform4f(program.rect, entry.rect[0], entry.rect[1], entry.rect[2], entry.rect[3]);
          this._attributes(gl, program, entry);
          gl.drawArrays(gl.TRIANGLES, 0, entry.count);
          gl.disableVertexAttribArray(program.pos);
          gl.disableVertexAttribArray(program.own);
        } finally {
          gl.bindFramebuffer(gl.FRAMEBUFFER, before);
          gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
        }
        entry.fieldKey = fieldKey;
      }
      return entry;
    },

    _attributes(gl, program, entry) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions);
      gl.enableVertexAttribArray(program.pos);
      gl.vertexAttribPointer(program.pos, 2, gl.FLOAT, false, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.colours);
      gl.enableVertexAttribArray(program.own);
      gl.vertexAttribPointer(program.own, 3, gl.FLOAT, false, 12, 0);
    },

    // Pictures and fields are made ready before the map's own drawing begins,
    // where MapLibre lets a layer draw into pictures of its own.
    prerender(gl) {
      if (!this._field || working === false) return;
      this._prepareAll(gl);
    },

    _prepareAll(gl) {
      const list = listed();
      const prepared = [];
      // (The map keeps count of how pictures are unpacked: left as they were found.)
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      try {
        gl.bindVertexArray(null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        const seen = new Set();
        for (const area of list) {
          seen.add(area.key);
          const entry = this._prepare(gl, area);
          if (entry && area.ready) prepared.push(entry);
        }
        // A battlefield that is gone gives its pictures back.
        for (const [key, entry] of this._entries) {
          if (seen.has(key)) continue;
          this._release(gl, entry);
          this._entries.delete(key);
        }
      } finally {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
      }
      return prepared;
    },

    render(gl, args) {
      this.drawn = 0;
      if (!this._field) return;
      const projection = projectionOf(args);
      if (!projection) return;
      if (!this._ensure(gl, shaderDataOf(args))) {
        tell(false);
        return;
      }
      const toFloat = (matrix, target) => {
        for (let index = 0; index < 16; index += 1) target[index] = Number(matrix[index]) || 0;
        return target;
      };
      try {
        const prepared = this._prepareAll(gl);
        if (prepared.length === 0) return;
        let copies = [0];
        try {
          const bounds = Number(projection.projectionTransition ?? 0) > 0 ? null : this._map?.getBounds?.();
          if (bounds) copies = worldCopies({ west: bounds.getWest(), east: bounds.getEast(), repeats: this._map.getRenderWorldCopies?.() !== false });
        } catch { /* the view cannot be read: the first copy alone */ }
        const program = this._ground;
        const zoom = this._map?.getZoom?.() ?? 0;
        const ratio = Number(this._map?.getPixelRatio?.() ?? globalThis.devicePixelRatio ?? 1) || 1;
        const widths = groundBorderWidths(zoom);
        const laid = Number(typeof strength === "function" ? strength(zoom) : 0.62);
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
        gl.uniform1f(program.strength, Number.isFinite(laid) ? Math.max(0, Math.min(1, laid)) : 0.62);
        gl.uniform3f(program.line, widths.core * ratio, widths.casing * ratio, widths.blur * ratio);
        gl.uniform4f(program.core, ...BORDER_CORE.rgb, BORDER_CORE.alpha);
        gl.uniform4f(program.casing, ...BORDER_CASING.rgb, BORDER_CASING.alpha);
        gl.uniform1i(program.paint, 0);
        gl.uniform1i(program.field, 1);
        for (const entry of prepared) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.paint);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, entry.field);
          gl.uniform4f(program.rect, entry.rect[0], entry.rect[1], entry.rect[2], entry.rect[3]);
          this._attributes(gl, program, entry);
          for (const copy of copies) {
            if (program.world) gl.uniform1f(program.world, copy);
            gl.drawArrays(gl.TRIANGLES, 0, entry.count);
          }
          this.drawn += entry.count;
        }
        gl.disableVertexAttribArray(program.pos);
        gl.disableVertexAttribArray(program.own);
        tell(true);
      } catch (error) {
        onError?.(error);
        tell(false);
      } finally {
        gl.activeTexture(gl.TEXTURE0);
      }
    },
  };
};
