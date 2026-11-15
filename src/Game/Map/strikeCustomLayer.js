/*! Open Historia — strikes drawn on the map, in the air above it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The layer that draws what strikeScene.js says is to be seen: ribbons (a
// missile's trail, a shock wave's ring), points (a missile's head, an
// aircraft, a flash) and discs (a fireball on the ground), each vertex with
// its height above the ground.
//
// On the GLOBE that height is real: MapLibre's own projection is asked to put
// a point so many metres above the sphere (projectTileWithElevation, from the
// prelude it hands every custom layer), so a missile's arc is an arc in space
// and an aircraft is seen above the land. On the flat map nothing is lifted:
// the camera there looks straight down, a height would show as nothing, and a
// missile a thousand kilometres up would be above the camera and vanish.
//
// A flat map that repeats shows the world several times over, side by side,
// and MapLibre draws a custom layer on one of them only. So there the strike
// is drawn once for every copy of the world in view (worldCopies): whichever
// one is being looked at has it, and a way over the date line runs on from one
// copy into the next.
//
// Everything is worked out again each frame on the CPU (a strike is a few
// thousand vertices) and drawn with two small programs. No depth is used:
// what is beyond the globe's edge is cut off by the projection itself.

const FLOATS = 12;
const EARTH_M = 1000;
const TWO_PI = Math.PI * 2;

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Strike layer shader: ${log}`);
  }
  return shader;
};
const link = (gl, vertexSource, fragmentSource) => {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Strike layer program: ${log}`);
  }
  return program;
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
const shaderDataOf = (args) => (typeof args?.shaderData?.vertexShaderPrelude === "string" && args.shaderData.variantName ? { define: "", ...args.shaderData } : PLAIN);
const projectionOf = (args) => {
  const data = args?.defaultProjectionData;
  if (data?.mainMatrix) return data;
  const mainMatrix = args?.modelViewProjectionMatrix ?? (Array.isArray(args) || ArrayBuffer.isView(args) ? args : null);
  return mainMatrix ? { mainMatrix, fallbackMatrix: mainMatrix, tileMercatorCoords: [0, 0, 1, 1], clippingPlane: [0, 0, 0, 0], projectionTransition: 0 } : null;
};

const RIBBON_VERTEX = (data) => `#version 300 es
precision highp float;
${data.vertexShaderPrelude}
${data.define}
in vec2 a_pos;
in float a_height;
in vec2 a_other;
in float a_other_height;
in float a_side;
in float a_width;
in vec4 a_colour;
uniform vec2 u_viewport;
uniform float u_lift;
uniform float u_world;
out vec4 v_colour;
void main() {
  vec2 copy = vec2(u_world, 0.0);
  vec4 here = projectTileWithElevation(a_pos + copy, a_height * u_lift);
  if (a_side != 0.0) {
    // Widened on the screen: across the way from this point to its neighbour.
    vec4 there = projectTileWithElevation(a_other + copy, a_other_height * u_lift);
    vec2 along = (there.xy / max(there.w, 0.00001) - here.xy / max(here.w, 0.00001)) * u_viewport;
    float span = length(along);
    vec2 way = span > 0.0001 ? along / span : vec2(1.0, 0.0);
    here.xy += vec2(-way.y, way.x) * a_side * a_width / u_viewport * here.w;
  }
  v_colour = a_colour;
  gl_Position = here;
}`;
const RIBBON_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_colour;
out vec4 colour;
void main() {
  colour = vec4(v_colour.rgb * v_colour.a, v_colour.a);
}`;
const POINT_VERTEX = (data) => `#version 300 es
precision highp float;
${data.vertexShaderPrelude}
${data.define}
in vec2 a_pos;
in float a_height;
in vec2 a_other;
in float a_other_height;
in float a_shape;
in float a_size;
in vec4 a_colour;
uniform vec2 u_viewport;
uniform float u_lift;
uniform float u_world;
uniform float u_ratio;
out vec4 v_colour;
out float v_shape;
out vec2 v_way;
void main() {
  vec2 copy = vec2(u_world, 0.0);
  vec4 here = projectTileWithElevation(a_pos + copy, a_height * u_lift);
  vec4 there = projectTileWithElevation(a_other + copy, a_other_height * u_lift);
  vec2 along = (there.xy / max(there.w, 0.00001) - here.xy / max(here.w, 0.00001)) * u_viewport;
  float span = length(along);
  v_way = span > 0.0001 ? along / span : vec2(0.0, 1.0);
  v_colour = a_colour;
  v_shape = a_shape;
  gl_Position = here;
  gl_PointSize = a_size * u_ratio;
}`;
// A point is a glow, an aircraft seen from above and turned the way it flies,
// a flash, or a ring. (An aircraft has a dark edge so that it is seen on pale ground.)
const POINT_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_colour;
in float v_shape;
in vec2 v_way;
out vec4 colour;
float aircraft(vec2 q, float grow) {
  float side = abs(q.y);
  float body = step(side, 0.11 + grow) * step(-0.86 - grow, q.x) * step(q.x, 0.92 + grow);
  float wing = step(side, 0.9 + grow) * step(q.x, 0.26 - 0.55 * side + grow) * step(-0.06 - 0.36 * side - grow, q.x);
  float tail = step(side, 0.36 + grow) * step(-0.9 - grow, q.x) * step(q.x, -0.62 + grow);
  return max(body, max(wing, tail));
}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float far = length(p);
  vec3 tint = v_colour.rgb;
  float seen = 0.0;
  if (v_shape < 0.5) {
    seen = smoothstep(1.0, 0.0, far);
    seen *= seen;
  } else if (v_shape < 1.5) {
    vec2 q = vec2(dot(p, v_way), dot(p, vec2(-v_way.y, v_way.x)));
    float inner = aircraft(q, 0.0);
    seen = aircraft(q, 0.08);
    tint = mix(vec3(0.03, 0.05, 0.08), tint, inner);
  } else if (v_shape < 2.5) {
    seen = smoothstep(1.0, 0.22, far);
  } else {
    seen = smoothstep(0.6, 0.78, far) * smoothstep(1.0, 0.86, far);
  }
  float alpha = seen * v_colour.a;
  if (alpha < 0.004) discard;
  colour = vec4(tint * alpha, alpha);
}`;

// A longitude and a latitude as the map's own flat coordinates, 0 to 1 each
// way. The longitude is not wrapped: a way across the date line stays one way.
const mercatorX = (lng) => (lng + 180) / 360;
const mercatorY = (lat) => {
  const held = Math.max(-85.05, Math.min(85.05, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (held * Math.PI) / 360)) / TWO_PI;
};

// The vertices of a frame, for the two programs. Each vertex is twelve floats:
// its place (2) and height in metres (1), its neighbour's (2 + 1), then for a
// ribbon its side and width, for a point its shape and size, and its colour (4).
export const buildStrikeVertices = (items) => {
  const ribbons = [];
  const points = [];
  const put = (list, a, b, first, second, colour, alpha) => {
    list.push(mercatorX(a[0]), mercatorY(a[1]), (a[2] ?? 0) * EARTH_M, mercatorX(b[0]), mercatorY(b[1]), (b[2] ?? 0) * EARTH_M, first, second, colour[0], colour[1], colour[2], alpha);
  };
  for (const ribbon of items?.ribbons ?? []) {
    const { points: way, width, colour } = ribbon;
    const last = way.length - 1;
    for (let at = 0; at < last; at += 1) {
      const a = way[at];
      const b = way[at + 1];
      const alphaA = ribbon.from + ((ribbon.to - ribbon.from) * at) / last;
      const alphaB = ribbon.from + ((ribbon.to - ribbon.from) * (at + 1)) / last;
      // Two triangles a stretch. (A point's side is told from its own end of the stretch, so the far end's is turned.)
      put(ribbons, a, b, 1, width, colour, alphaA);
      put(ribbons, a, b, -1, width, colour, alphaA);
      put(ribbons, b, a, -1, width, colour, alphaB);
      put(ribbons, a, b, -1, width, colour, alphaA);
      put(ribbons, b, a, 1, width, colour, alphaB);
      put(ribbons, b, a, -1, width, colour, alphaB);
    }
  }
  for (const disc of items?.discs ?? []) {
    const centre = [disc.centre[0], disc.centre[1], 1];
    const rim = disc.rim ?? [];
    for (let at = 0; at + 1 < rim.length; at += 1) {
      put(ribbons, centre, centre, 0, 0, disc.colour, disc.alpha);
      put(ribbons, rim[at], centre, 0, 0, disc.colour, disc.alpha * 0.5);
      put(ribbons, rim[at + 1], centre, 0, 0, disc.colour, disc.alpha * 0.5);
    }
  }
  for (const point of items?.points ?? []) put(points, point.at, point.toward ?? point.at, point.shape, point.size, point.colour, point.alpha);
  return { ribbons: new Float32Array(ribbons), points: new Float32Array(points) };
};

const ATTRIBUTES = [["a_pos", 2, 0], ["a_height", 1, 2], ["a_other", 2, 3], ["a_other_height", 1, 5], ["a_colour", 4, 8]];

// Which copies of the world a flat map is showing, as how many worlds each is
// from the first: [0] on a globe, on a map that does not repeat, and where the
// view cannot be read. One to each side is added, since a way may run over
// the edge of its own copy into the next.
export const WORLD_COPIES_MOST = 9;
export const worldCopies = ({ west, east, repeats = true, globe = false } = {}) => {
  if (globe || !repeats || !Number.isFinite(west) || !Number.isFinite(east) || east < west) return [0];
  const first = Math.floor((west + 180) / 360) - 1;
  const last = Math.floor((east + 180) / 360) + 1;
  const copies = [];
  for (let copy = first; copy <= last && copies.length < WORLD_COPIES_MOST; copy += 1) copies.push(copy);
  return copies;
};

// The layer. `frame()` is asked each time the map draws: it answers with what
// is to be seen now (strikeScene items, each disc with its `rim` of points),
// or null when nothing is being played.
export const STRIKE_LAYER_ID = "strikes-flight";
export const createStrikeLayer = ({ id = STRIKE_LAYER_ID, frame, onError } = {}) => ({
  id,
  type: "custom",
  renderingMode: "2d",
  _map: null,
  _programs: null,
  _variant: "",
  _failed: "",
  _buffer: null,
  _matrices: { main: new Float32Array(16), fallback: new Float32Array(16) },
  drawn: 0,

  onAdd(map, gl) {
    this._map = map;
    this._buffer = gl.createBuffer();
  },
  onRemove(map, gl) {
    try {
      for (const program of Object.values(this._programs ?? {})) gl.deleteProgram(program.handle);
      if (this._buffer) gl.deleteBuffer(this._buffer);
    } catch { /* the context is gone */ }
    this._programs = null;
    this._buffer = null;
    this._map = null;
  },

  _ensure(gl, data) {
    if (this._programs && this._variant === data.variantName) return true;
    if (this._failed === data.variantName) return false;
    try {
      const made = {};
      for (const [name, vertex, fragment, extra] of [["ribbon", RIBBON_VERTEX(data), RIBBON_FRAGMENT, ["a_side", "a_width"]], ["point", POINT_VERTEX(data), POINT_FRAGMENT, ["a_shape", "a_size"]]]) {
        const handle = link(gl, vertex, fragment);
        const uniform = (key) => gl.getUniformLocation(handle, key);
        made[name] = {
          handle,
          attributes: [...ATTRIBUTES, [extra[0], 1, 6], [extra[1], 1, 7]].map(([key, size, offset]) => ({ at: gl.getAttribLocation(handle, key), size, offset })).filter((entry) => entry.at >= 0),
          matrix: uniform("u_projection_matrix"),
          fallback: uniform("u_projection_fallback_matrix"),
          tile: uniform("u_projection_tile_mercator_coords"),
          clip: uniform("u_projection_clipping_plane"),
          transition: uniform("u_projection_transition"),
          viewport: uniform("u_viewport"),
          lift: uniform("u_lift"),
          world: uniform("u_world"),
          ratio: uniform("u_ratio"),
        };
      }
      try {
        for (const program of Object.values(this._programs ?? {})) gl.deleteProgram(program.handle);
      } catch { /* nothing to free */ }
      this._programs = made;
      this._variant = data.variantName;
      return true;
    } catch (error) {
      this._failed = data.variantName;
      onError?.(error);
      return false;
    }
  },

  render(gl, args) {
    const items = typeof frame === "function" ? frame() : null;
    this.drawn = 0;
    if (!items) return;
    const projection = projectionOf(args);
    if (!projection || !this._ensure(gl, shaderDataOf(args))) return;
    const vertices = buildStrikeVertices(items);
    if (vertices.ribbons.length === 0 && vertices.points.length === 0) return;
    const toFloat = (matrix, target) => {
      for (let index = 0; index < 16; index += 1) target[index] = Number(matrix[index]) || 0;
      return target;
    };
    // Lifted on the globe only (and not while it is turning into the flat map).
    const globeness = Number(projection.projectionTransition ?? 0);
    const lift = globeness > 0.999 ? 1 : 0;
    let copies = [0];
    try {
      const bounds = globeness > 0 ? null : this._map?.getBounds?.();
      if (bounds) copies = worldCopies({ west: bounds.getWest(), east: bounds.getEast(), repeats: this._map.getRenderWorldCopies?.() !== false });
    } catch { /* the view cannot be read: the first copy alone */ }
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const ratio = this._map?.getCanvas ? gl.drawingBufferWidth / Math.max(1, this._map.getCanvas().clientWidth || gl.drawingBufferWidth) : 1;
    try {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
      const draw = (program, data, mode) => {
        if (data.length === 0) return;
        gl.useProgram(program.handle);
        if (program.matrix) gl.uniformMatrix4fv(program.matrix, false, toFloat(projection.mainMatrix, this._matrices.main));
        if (program.fallback) gl.uniformMatrix4fv(program.fallback, false, toFloat(projection.fallbackMatrix ?? projection.mainMatrix, this._matrices.fallback));
        if (program.tile) gl.uniform4fv(program.tile, projection.tileMercatorCoords ?? [0, 0, 1, 1]);
        if (program.clip) gl.uniform4fv(program.clip, projection.clippingPlane ?? [0, 0, 0, 0]);
        if (program.transition) gl.uniform1f(program.transition, Number(projection.projectionTransition ?? 0));
        // (Widths and sizes are given in the page's pixels: the buffer may be finer.)
        gl.uniform2f(program.viewport, width / ratio, height / ratio);
        gl.uniform1f(program.lift, lift);
        if (program.ratio) gl.uniform1f(program.ratio, ratio);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        for (const attribute of program.attributes) {
          gl.enableVertexAttribArray(attribute.at);
          gl.vertexAttribPointer(attribute.at, attribute.size, gl.FLOAT, false, FLOATS * 4, attribute.offset * 4);
        }
        for (const copy of copies) {
          if (program.world) gl.uniform1f(program.world, copy);
          gl.drawArrays(mode, 0, data.length / FLOATS);
        }
        for (const attribute of program.attributes) gl.disableVertexAttribArray(attribute.at);
        this.drawn += data.length / FLOATS;
      };
      draw(this._programs.ribbon, vertices.ribbons, gl.TRIANGLES);
      draw(this._programs.point, vertices.points, gl.POINTS);
    } catch (error) {
      onError?.(error);
    }
  },
});
