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
// THE BORDER. Where the run has moved the front, the map's borders between the
// two sides' regions are left out (vnext/politicalBoundaryTopology.js) and the
// border is drawn here, ONLY where one side's ground meets the other's: never
// at a coast, against a neutral's land or along the frame. It is traced from
// the front's own field (frontPaint.js writeFrontField: how far each cell is
// one side's, evened out, read smoothly between the cells' middles), as the
// line where that is half-way, and drawn as the map draws its own borders:
// the same width for the zoom, the same dark line over the same casing, the
// same edge, so many screen pixels wide wherever it runs. As the run plays the
// line moves with the ground.
//
// ON THE 3D TERRAIN. MapLibre lays its own fills, lines and pictures over the
// hills by drawing them into the terrain's own tiles; a layer that draws
// itself was drawn on the screen instead, at the sea's level, so with the map
// tilted the battlefield lay flat, apart from the country round it ("the war
// terrain is not 3d", the owner, 2026-11-09). The game's MapLibre lets such a
// layer draw into the terrain's tiles too (renderToTerrainTile): with the
// terrain on, the ground is drawn there, in its place among the fills, and lies
// on the hills as they do. It is drawn again only when what it shows changes
// (terrainTileRevision) or the map's own tiles are redrawn. With the terrain
// off it is drawn as it always was.
//
// The pure parts load in plain Node.

import { worldCopies } from "./strikeCustomLayer.js";
import { meshBounds } from "./terrainDrape.js";
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

// How solid a line of this width (px) and blur is at this distance (px) from
// its middle, as MapLibre's own line draws it (line.vertex.glsl and
// line.fragment.glsl: the edge is half a device pixel beyond the half width,
// and fades over the blur and one device pixel more). `ratio` is the
// device's pixels to a CSS pixel.
export const lineCoverage = (distance, width, blur = 0, ratio = 1) => {
  const outset = width / 2 + 0.5 / ratio;
  const fade = blur + 1 / ratio;
  return Math.max(0, Math.min(1, (outset - distance) / fade));
};

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

// The same, drawn into one of the 3D terrain's tiles: its corners put in the
// tile, which is (-1, -1) at its south-west corner and (1, 1) at its north-east.
const TILE_VERTEX = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_own;
// The tile's north-west corner on the sheet (xy), how many tiles the sheet is
// across at its zoom (z), and the copy of the world the regions are drawn in (w).
uniform vec4 u_tile;
uniform vec4 u_rect;
out vec2 v_uv;
out vec3 v_own;
void main() {
  v_uv = (a_pos - u_rect.xy) / (u_rect.zw - u_rect.xy);
  v_own = a_own;
  vec2 at = (a_pos + vec2(u_tile.w, 0.0) - u_tile.xy) * u_tile.z;
  gl_Position = vec4(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.0, 1.0);
}`;

// How many of a terrain tile's pixels one of the screen's is, the tile being
// `width` pixels and drawn `tileSize` (MapLibre's terrain tiles: 512) at its
// own zoom: as the map's own borders are drawn into the tile (a line's width
// in the tile's pixels at the map's zoom).
export const tilePixelsPerScreenPixel = (width, tileZoom, zoom, tileSize = 512) => width / (tileSize * 2 ** (zoom - tileZoom));

// The copies of the world (-1, 0, 1) in which a box on the sheet,
// [left, top, right, bottom], lies over a terrain tile's, [x0, y0, x1, y1].
export const copiesOverTile = (bounds, tile) => {
  if (!bounds) return [0];
  if (bounds[1] >= tile[3] || bounds[3] <= tile[1]) return [];
  return [-1, 0, 1].filter((copy) => bounds[0] + copy < tile[2] && bounds[2] + copy > tile[0]);
};

// The ground, and the border where the front's field is half-way. The field is
// read smoothly between the cells' middles, and how fast it changes across the
// screen (its derivatives) says how many pixels this one is from the half-way
// line, so the line is as wide on the screen at every zoom. Its edge is the
// one MapLibre gives its own lines (lineCoverage), in device pixels here.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_own;
uniform sampler2D u_paint;
uniform sampler2D u_front;
uniform float u_strength;
// The line's width, the casing's width and the casing's blur, in device pixels.
uniform vec3 u_line;
uniform vec4 u_core;
uniform vec4 u_casing;
out vec4 colour;

float coverage(float far, float width, float blur) {
  return clamp((0.5 * width + 0.5 - far) / (blur + 1.0), 0.0, 1.0);
}

vec4 over(vec3 rgb, float alpha, vec4 under) {
  return vec4(rgb * alpha, alpha) + under * (1.0 - alpha);
}

void main() {
  vec4 front = texture(u_front, v_uv);
  float side = front.r - 0.5;
  vec2 change = vec2(dFdx(side), dFdy(side));
  bool inside = v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
  vec4 paint = inside ? texture(u_paint, v_uv) : vec4(0.0);
  vec4 result = vec4((v_own * (1.0 - paint.a) + paint.rgb) * u_strength, u_strength);
  float steep = length(change);
  if (inside && u_line.x > 0.0 && front.g > 0.0 && steep > 0.0) {
    float far = abs(side) / steep;
    // Where the run has moved the front; past that the map's own border runs.
    float here = smoothstep(0.25, 0.75, front.g);
    result = over(u_casing.rgb, u_casing.a * here * coverage(far, u_line.y, u_line.z), result);
    result = over(u_core.rgb, u_core.a * here * coverage(far, u_line.x, 0.0), result);
  }
  colour = result;
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

const GROUND_UNIFORMS = ["world", "rect", "paint", "front", "strength", "line", "core", "casing"];
const TILE_UNIFORMS = ["tile", "rect", "paint", "front", "strength", "line", "core", "casing"];

// A number for each thing (a canvas, a field's pixels), so a new one under the same key is told apart.
let things = 0;
const thingIds = new WeakMap();
const thingId = (thing) => {
  if (!thing || (typeof thing !== "object" && typeof thing !== "function")) return 0;
  let id = thingIds.get(thing);
  if (!id) {
    id = (things += 1);
    thingIds.set(thing, id);
  }
  return id;
};
const PROJECTION_UNIFORMS = {
  matrix: "u_projection_matrix",
  fallback: "u_projection_fallback_matrix",
  tile: "u_projection_tile_mercator_coords",
  clip: "u_projection_clipping_plane",
  transition: "u_projection_transition",
};
const PLAIN = Object.freeze({
  variantName: "plain-mercator",
  define: "",
  vertexShaderPrelude: `uniform mat4 u_projection_matrix;
vec4 projectTileWithElevation(vec2 p, float elevation) {
  return u_projection_matrix * vec4(p, elevation, 1.0);
}`,
});

const isWebGL2 = (gl) => typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

const linearTexture = (gl) => {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

// The layer. `areas()` is asked each time the map draws: one a battlefield,
//   { key, canvas, version, front, coordinates, meshId, positions, regionOf,
//     colours, colourKey, ready }
// `version` changes when the picture is painted anew; `front` is its field
// (frontPaint.js createFrontField), taken up when its own `version` changes;
// `colourKey` changes when the regions' colours do; `ready` once the map's
// fill of every one of its regions is hidden (an area is not drawn before, so
// no region is drawn twice). `strength(zoom)` is how strongly the map lays a
// country's colour over the basemap. `onState(working)` is told whether the
// layer can draw at all, as soon as it is added and whenever that changes.
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
  // What the ground shows, in a line: when it changes the terrain's tiles are drawn again.
  const showing = () => listed()
    .map((area) => [area.key, area.version, thingId(area.canvas), area.front?.version, thingId(area.front?.data), area.meshId, area.colourKey, area.ready ? 1 : 0].join("|"))
    .join(";");

  return {
    id,
    type: "custom",
    renderingMode: "2d",
    _map: null,
    _ground: null,
    _variant: "",
    _failed: "",
    _tile: null,
    _tileFailed: false,
    _entries: new Map(),
    _matrices: { main: new Float32Array(16), fallback: new Float32Array(16) },
    _revision: 0,
    _showing: null,
    _tilePrepared: [],
    _tilePreparedFor: -1,
    drawn: 0,
    uploads: 0,

    // Asked by MapLibre each frame while the 3D terrain is on: a new number has
    // the terrain's tiles under the ground drawn again.
    get terrainTileRevision() {
      let now = "";
      try {
        now = showing();
      } catch { /* nothing to read: as it was */
        now = this._showing;
      }
      if (now !== this._showing) {
        this._showing = now;
        this._revision += 1;
      }
      return this._revision;
    },

    onAdd(map, gl) {
      this._map = map;
      if (!isWebGL2(gl)) {
        onError?.(new Error("The battlefield's ground needs WebGL 2."));
        tell(false);
        return;
      }
      // The flat map's program now, so the caller knows at once whether it can draw.
      tell(this._ensure(gl, PLAIN));
    },

    onRemove(map, gl) {
      try {
        if (this._ground) gl.deleteProgram(this._ground.handle);
        if (this._tile) gl.deleteProgram(this._tile.handle);
        for (const entry of this._entries.values()) this._release(gl, entry);
      } catch { /* the context is gone */ }
      this._ground = null;
      this._variant = "";
      this._failed = "";
      this._tile = null;
      this._tileFailed = false;
      this._tilePrepared = [];
      this._tilePreparedFor = -1;
      this._entries = new Map();
      this._map = null;
    },

    // The program that draws into the terrain's tiles.
    _ensureTile(gl) {
      if (this._tile) return true;
      if (this._tileFailed) return false;
      try {
        this._tile = link(gl, TILE_VERTEX, FRAGMENT, TILE_UNIFORMS);
        return true;
      } catch (error) {
        this._tileFailed = true;
        onError?.(error);
        return false;
      }
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
      for (const texture of [entry.paint, entry.front]) if (texture) gl.deleteTexture(texture);
    },

    // An area's buffers and its two pictures, made or brought up to date: each
    // only when it has changed.
    _prepare(gl, area) {
      let entry = this._entries.get(area.key);
      if (!entry) {
        entry = { meshId: null, colourKey: null, count: 0, version: null, frontVersion: null };
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
        entry.bounds = meshBounds(area.positions);
      }
      if (entry.colourKey !== area.colourKey) {
        entry.colours ??= gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.colours);
        gl.bufferData(gl.ARRAY_BUFFER, cornerColours(area.regionOf, area.colours ?? []), gl.STATIC_DRAW);
        entry.colourKey = area.colourKey;
      }
      const { canvas, front } = area;
      if (!entry.paint || entry.version !== area.version || entry.canvas !== canvas) {
        entry.paint ??= linearTexture(gl);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.paint);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        entry.version = area.version;
        entry.canvas = canvas;
        this.uploads += 1;
      }
      if (front?.data && (!entry.front || entry.frontVersion !== front.version || entry.frontData !== front.data)) {
        entry.front ??= linearTexture(gl);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.front);
        // (The field is numbers, not a colour: taken up as it is.)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, front.width, front.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, front.data);
        entry.frontVersion = front.version;
        entry.frontData = front.data;
        this.uploads += 1;
      }
      return entry.front ? entry : null;
    },

    _attributes(gl, program, entry) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.positions);
      gl.enableVertexAttribArray(program.pos);
      gl.vertexAttribPointer(program.pos, 2, gl.FLOAT, false, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.colours);
      gl.enableVertexAttribArray(program.own);
      gl.vertexAttribPointer(program.own, 3, gl.FLOAT, false, 12, 0);
    },

    _prepareAll(gl) {
      const list = listed();
      const prepared = [];
      // (The map keeps count of how pictures are unpacked: left as they were found.)
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
      try {
        gl.bindVertexArray(null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
      }
      return prepared;
    },

    render(gl, args) {
      this.drawn = 0;
      if (!this._ground && working !== true) return;
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
        gl.uniform1i(program.front, 1);
        for (const entry of prepared) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.paint);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, entry.front);
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

    // With the 3D terrain on, MapLibre asks for the ground here, once for each
    // of the terrain's tiles it draws, instead of `render`: drawn into the
    // tile, it lies on the hills with the map's own fills. `tileID` is the
    // tile, `width` its pixels across.
    renderToTerrainTile(gl, { tileID, width } = {}) {
      if (!this._ground && working !== true) return;
      const canonical = tileID?.canonical;
      if (!canonical || !Number.isFinite(canonical.z)) return;
      if (!this._ensureTile(gl)) {
        tell(false);
        return;
      }
      try {
        // What is to be drawn is made ready once for each thing shown, not once a tile.
        if (this._tilePreparedFor !== this._revision) {
          this._tilePrepared = this._prepareAll(gl);
          this._tilePreparedFor = this._revision;
          // (Counted from here: the corners drawn into tiles since it last changed.)
          this.drawn = 0;
        }
        const prepared = this._tilePrepared;
        if (prepared.length === 0) return;
        const across = 2 ** canonical.z;
        const tile = [canonical.x / across, canonical.y / across, (canonical.x + 1) / across, (canonical.y + 1) / across];
        const program = this._tile;
        const zoom = this._map?.getZoom?.() ?? canonical.z;
        const tileSize = Number(this._map?.terrain?.tileManager?.tileSize) || 512;
        const scale = tilePixelsPerScreenPixel(Number(width) || tileSize * 2, canonical.z, zoom, tileSize);
        const widths = groundBorderWidths(zoom);
        const laid = Number(typeof strength === "function" ? strength(zoom) : 0.62);
        gl.bindVertexArray(null);
        gl.useProgram(program.handle);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.CULL_FACE);
        gl.uniform1f(program.strength, Number.isFinite(laid) ? Math.max(0, Math.min(1, laid)) : 0.62);
        gl.uniform3f(program.line, widths.core * scale, widths.casing * scale, widths.blur * scale);
        gl.uniform4f(program.core, ...BORDER_CORE.rgb, BORDER_CORE.alpha);
        gl.uniform4f(program.casing, ...BORDER_CASING.rgb, BORDER_CASING.alpha);
        gl.uniform1i(program.paint, 0);
        gl.uniform1i(program.front, 1);
        for (const entry of prepared) {
          const copies = copiesOverTile(entry.bounds, tile);
          if (copies.length === 0) continue;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.paint);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, entry.front);
          gl.uniform4f(program.rect, entry.rect[0], entry.rect[1], entry.rect[2], entry.rect[3]);
          this._attributes(gl, program, entry);
          for (const copy of copies) {
            gl.uniform4f(program.tile, tile[0], tile[1], across, copy);
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
